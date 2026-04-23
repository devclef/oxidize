use crate::cache::DataCache;
use crate::config::Config;
use crate::models::{AccountArray, CategoryExpense, ChartLine, MonthlySummary, SimpleAccount};
use chrono::{Datelike, Duration, Utc};
use log::{debug, error, info};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use std::sync::Arc;

pub struct FireflyClient {
    client: reqwest::Client,
    config: Config,
    cache: Arc<DataCache>,
}

impl FireflyClient {
    pub fn new(config: Config) -> Self {
        Self::with_cache(config, DataCache::default())
    }

    pub fn with_cache(config: Config, cache: DataCache) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Oxidize/0.1.0")
            .build()
            .unwrap();

        Self {
            client,
            config,
            cache: Arc::new(cache),
        }
    }

    pub fn clear_cache(&self) {
        self.cache.clear_all();
        info!("Cache cleared");
    }

    pub fn clear_accounts_cache(&self) {
        self.cache.clear_accounts();
        info!("Accounts cache cleared");
    }

    pub fn clear_balance_history_cache(&self) {
        self.cache.clear_balance_history();
        info!("Balance history cache cleared");
    }

    pub async fn get_accounts(
        &self,
        type_filter: Option<String>,
    ) -> Result<Vec<SimpleAccount>, String> {
        let type_filter = if type_filter.as_deref() == Some("all") {
            None
        } else {
            type_filter
        };

        if let Some(cached_json) = self.cache.get_accounts(type_filter.clone()) {
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached accounts: {}", e));
        }

        let headers = self.get_headers();
        let mut url = format!("{}/v1/accounts", self.config.firefly_url.as_str());
        if let Some(ref t) = type_filter {
            url = format!("{}?type={}", url, t);
        }

        let response = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("API request failed with status: {}. Body: {}", status, body);
            return Err(format!("API request failed with status: {}", status));
        }

        let account_array: AccountArray = response.json().await.map_err(|e| e.to_string())?;
        let simple_accounts = account_array
            .data
            .into_iter()
            .map(|a| SimpleAccount {
                id: a.id,
                name: a.attributes.name,
                balance: a.attributes.current_balance,
                currency: a.attributes.currency_symbol,
                account_type: a.attributes.account_type,
            })
            .collect();

        if let Ok(json) = serde_json::to_string(&simple_accounts) {
            self.cache.set_accounts(type_filter, json);
        }

        Ok(simple_accounts)
    }

    pub async fn get_balance_history(
        &self,
        account_ids: Option<Vec<String>>,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Result<ChartLine, String> {
        if let Some(cached_json) = self.cache.get_balance_history(
            account_ids.clone(),
            start_date.clone(),
            end_date.clone(),
            period.clone(),
        ) {
            debug!("Cache hit for balance history");
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached balance history: {}", e));
        }

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.unwrap_or_else(|| "1D".to_string());

        let mut query_params = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("period".to_string(), period_val.clone()),
        ];

        if let Some(ref ids) = account_ids {
            if !ids.is_empty() {
                for id in ids {
                    query_params.push(("accounts[]".to_string(), id.clone()));
                }
            } else {
                query_params.push(("preselected".to_string(), "assets".to_string()));
            }
        } else {
            query_params.push(("preselected".to_string(), "assets".to_string()));
        }

        let url = format!(
            "{}/v1/chart/account/overview",
            self.config.firefly_url.as_str()
        );
        let response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&query_params)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!(
                "API request failed with status: {}",
                response.status()
            ));
        }

        let chart_line: ChartLine = response.json().await.map_err(|e| e.to_string())?;

        if let Ok(json) = serde_json::to_string(&chart_line) {
            self.cache.set_balance_history(
                account_ids,
                Some(start),
                Some(end),
                Some(period_val),
                json,
            );
        }

        Ok(chart_line)
    }

    pub async fn get_earned_spent(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Result<ChartLine, String> {
        use crate::models::chart::ChartDataSet;

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.unwrap_or_else(|| "1D".to_string());

        let all_transactions = self
            .fetch_all_transactions(&start, &end, account_ids.as_ref())
            .await?;

        let spent_transactions: Vec<_> = all_transactions
            .iter()
            .filter(|tx| {
                tx.get("attributes")
                    .and_then(|a| a.get("transactions"))
                    .and_then(|t| t.as_array())
                    .map(|trans| {
                        trans
                            .iter()
                            .any(|t| t.get("type").and_then(|ty| ty.as_str()) == Some("withdrawal"))
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        let earned_transactions: Vec<_> = all_transactions
            .iter()
            .filter(|tx| {
                tx.get("attributes")
                    .and_then(|a| a.get("transactions"))
                    .and_then(|t| t.as_array())
                    .map(|trans| {
                        trans
                            .iter()
                            .any(|t| t.get("type").and_then(|ty| ty.as_str()) == Some("deposit"))
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        let (earned_entries, spent_entries, currency_symbol, currency_code) = self
            .aggregate_transactions_by_period(
                &earned_transactions,
                &spent_transactions,
                &period_val,
                &start,
                &end,
            )
            .await;

        Ok(vec![
            ChartDataSet {
                label: "earned".to_string(),
                currency_symbol: currency_symbol.clone(),
                currency_code: currency_code.clone(),
                entries: serde_json::to_value(earned_entries).unwrap(),
            },
            ChartDataSet {
                label: "spent".to_string(),
                currency_symbol,
                currency_code,
                entries: serde_json::to_value(spent_entries).unwrap(),
            },
        ])
    }

    pub async fn get_expenses_by_category(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Result<Vec<CategoryExpense>, String> {
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });

        let all_transactions = self
            .fetch_all_transactions(&start, &end, account_ids.as_ref())
            .await?;

        let expense_transactions: Vec<_> = all_transactions
            .iter()
            .filter(|tx| {
                tx.get("attributes")
                    .and_then(|a| a.get("transactions"))
                    .and_then(|t| t.as_array())
                    .map(|trans| {
                        trans
                            .iter()
                            .any(|t| t.get("type").and_then(|ty| ty.as_str()) == Some("withdrawal"))
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        let mut category_expenses: std::collections::HashMap<String, (f64, String, String)> =
            std::collections::HashMap::new();

        for tx in &expense_transactions {
            if let Some(transactions) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for t in transactions {
                    if let Some(amount_str) = t.get("amount").and_then(|a| a.as_str()) {
                        if let Ok(amount) = amount_str.parse::<f64>() {
                            let category_name = t
                                .get("category_name")
                                .and_then(|c| c.as_str())
                                .map(String::from)
                                .unwrap_or_else(|| "Uncategorized".to_string());
                            let entry = category_expenses.entry(category_name).or_insert((
                                0.0,
                                String::new(),
                                String::new(),
                            ));
                            entry.0 += amount;
                            if entry.1.is_empty() {
                                entry.1 = t
                                    .get("currency_symbol")
                                    .and_then(|s| s.as_str())
                                    .map(String::from)
                                    .unwrap_or_default();
                                entry.2 = t
                                    .get("currency_code")
                                    .and_then(|s| s.as_str())
                                    .map(String::from)
                                    .unwrap_or_default();
                            }
                        }
                    }
                }
            }
        }

        let mut result: Vec<CategoryExpense> = category_expenses
            .into_iter()
            .map(
                |(name, (amount, currency_symbol, currency_code))| CategoryExpense {
                    name,
                    amount,
                    currency_symbol,
                    currency_code,
                },
            )
            .collect();
        result.sort_by(|a, b| {
            b.amount
                .partial_cmp(&a.amount)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(result)
    }

    pub async fn get_net_worth(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Result<ChartLine, String> {
        use crate::models::chart::ChartDataSet;

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period_val = period.unwrap_or_else(|| "1M".to_string());

        let url = format!(
            "{}/v1/chart/account/overview",
            self.config.firefly_url.as_str()
        );

        let asset_query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("period".to_string(), period_val.clone()),
            ("preselected".to_string(), "assets".to_string()),
        ];
        let asset_response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&asset_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let asset_data: ChartLine = asset_response.json().await.map_err(|e| e.to_string())?;

        let liability_query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("period".to_string(), period_val.clone()),
            ("preselected".to_string(), "liabilities".to_string()),
        ];
        let liability_response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&liability_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let liability_data: ChartLine =
            liability_response.json().await.map_err(|e| e.to_string())?;

        let mut net_worth_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        for dataset in &asset_data {
            if let Some(entries) = dataset.entries.as_array() {
                for entry in entries {
                    if let (Some(date), Some(amount)) = (
                        entry.get("date").and_then(|d| d.as_str()),
                        entry.get("ba").and_then(|b| b.as_f64()),
                    ) {
                        *net_worth_entries.entry(date.to_string()).or_insert(0.0) += amount;
                        if currency_symbol.is_none() {
                            currency_symbol = dataset.currency_symbol.clone();
                            currency_code = dataset.currency_code.clone();
                        }
                    }
                }
            }
        }

        for dataset in &liability_data {
            if let Some(entries) = dataset.entries.as_array() {
                for entry in entries {
                    if let (Some(date), Some(amount)) = (
                        entry.get("date").and_then(|d| d.as_str()),
                        entry.get("ba").and_then(|b| b.as_f64()),
                    ) {
                        *net_worth_entries.entry(date.to_string()).or_insert(0.0) -= amount;
                    }
                }
            }
        }

        let mut entries_vec: Vec<serde_json::Value> = net_worth_entries
            .into_iter()
            .map(|(date, ba)| serde_json::json!({"date": date, "ba": ba}))
            .collect();
        entries_vec.sort_by(|a, b| {
            a["date"]
                .as_str()
                .unwrap_or("")
                .cmp(b["date"].as_str().unwrap_or(""))
        });

        Ok(vec![ChartDataSet {
            label: "Net Worth".to_string(),
            currency_symbol,
            currency_code,
            entries: serde_json::Value::Array(entries_vec),
        }])
    }

    pub async fn get_monthly_summary(
        &self,
        month: u32,
        year: i32,
        account_ids: Option<Vec<String>>,
        account_type: Option<String>,
    ) -> Result<MonthlySummary, String> {
        let start_date = chrono::NaiveDate::from_ymd_opt(year, month, 1)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .ok_or_else(|| format!("Invalid date for month {} year {}", month, year))?;

        let end_date = if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
                .map(|d| d.pred_opt().unwrap().format("%Y-%m-%d").to_string())
                .ok_or_else(|| format!("Invalid date for end of month {} year {}", month, year))?
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
                .map(|d| d.pred_opt().unwrap().format("%Y-%m-%d").to_string())
                .ok_or_else(|| format!("Invalid date for end of month {} year {}", month, year))?
        };

        let mut income_query = vec![
            ("start".to_string(), start_date.clone()),
            ("end".to_string(), end_date.clone()),
            ("type".to_string(), "deposit".to_string()),
        ];
        let mut expense_query = vec![
            ("start".to_string(), start_date.clone()),
            ("end".to_string(), end_date.clone()),
            ("type".to_string(), "withdrawal".to_string()),
        ];

        if let Some(ref ids) = account_ids {
            if !ids.is_empty() {
                income_query.push(("destination_id".to_string(), ids.join(",")));
                expense_query.push(("source_id".to_string(), ids.join(",")));
            }
        } else if let Some(ref t) = account_type {
            if t != "all" {
                income_query.push(("account_type".to_string(), t.clone()));
                expense_query.push(("account_type".to_string(), t.clone()));
            }
        }

        let mut selected_account_ids = std::collections::HashSet::new();
        if let Some(ref ids) = account_ids {
            for id in ids {
                selected_account_ids.insert(id.clone());
            }
        } else if let Some(ref t) = account_type {
            if t != "all" {
                if let Ok(accounts) = self.get_accounts(Some(t.clone())).await {
                    for acc in accounts {
                        selected_account_ids.insert(acc.id);
                    }
                }
            } else {
                if let Ok(accounts) = self.get_accounts(None).await {
                    for acc in accounts {
                        selected_account_ids.insert(acc.id);
                    }
                }
            }
        } else {
            if let Ok(accounts) = self.get_accounts(None).await {
                for acc in accounts {
                    selected_account_ids.insert(acc.id);
                }
            }
        }

        let url = format!("{}/v1/transactions", self.config.firefly_url.as_str());
        let income_response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&income_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let income_data: serde_json::Value =
            income_response.json().await.map_err(|e| e.to_string())?;

        let expense_response = self
            .client
            .get(&url)
            .headers(self.get_headers())
            .query(&expense_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let expense_data: serde_json::Value =
            expense_response.json().await.map_err(|e| e.to_string())?;

        let total_income =
            Self::sum_filtered_transaction_amounts(&income_data, &selected_account_ids, true);
        let total_expenses =
            Self::sum_filtered_transaction_amounts(&expense_data, &selected_account_ids, false);
        let savings = total_income - total_expenses;
        let savings_rate = if total_income > 0.0 {
            (savings / total_income) * 100.0
        } else {
            0.0
        };
        let (currency_symbol, currency_code) =
            Self::get_currency_from_transactions(&income_data, &expense_data);

        let month_name = match month {
            1 => "January",
            2 => "February",
            3 => "March",
            4 => "April",
            5 => "May",
            6 => "June",
            7 => "July",
            8 => "August",
            9 => "September",
            10 => "October",
            11 => "November",
            12 => "December",
            _ => "Unknown",
        };

        Ok(MonthlySummary {
            month: month_name.to_string(),
            year,
            total_income,
            total_expenses,
            savings,
            savings_rate,
            currency_symbol,
            currency_code,
        })
    }

    fn get_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));
        headers
    }

    fn chunk_date_range(start: &str, end: &str) -> Result<Vec<(String, String)>, String> {
        let start =
            chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let end = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").map_err(|e| e.to_string())?;

        let mut chunks = Vec::new();
        let mut current = start;

        while current <= end {
            let chunk_start = current;
            // Find the first day of the next month
            let mut next_month = current.with_day(1).unwrap();
            if next_month.month() == 12 {
                next_month = next_month
                    .with_year(next_month.year() + 1)
                    .unwrap()
                    .with_month(1)
                    .unwrap();
            } else {
                next_month = next_month.with_month(next_month.month() + 1).unwrap();
            }
            // Last day of current month = day before first day of next month
            let chunk_end = next_month.pred_opt().unwrap();

            // Clamp chunk_end to the overall end date
            let actual_end = if chunk_end > end { end } else { chunk_end };

            chunks.push((
                chunk_start.format("%Y-%m-%d").to_string(),
                actual_end.format("%Y-%m-%d").to_string(),
            ));

            // Move to the first day of the next month, or past end to stop
            current = if next_month > end {
                end + chrono::Duration::days(1)
            } else {
                next_month
            };
        }

        Ok(chunks)
    }

    async fn fetch_all_transactions(
        &self,
        start: &str,
        end: &str,
        account_ids: Option<&Vec<String>>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let chunks = Self::chunk_date_range(start, end)?;
        let mut all_transactions = std::collections::HashMap::new();

        for (chunk_start, chunk_end) in &chunks {
            let url = format!("{}/v1/transactions", self.config.firefly_url.as_str());
            let mut offset = 0;
            let page_size = 500;

            loop {
                let params = vec![
                    ("start".to_string(), chunk_start.clone()),
                    ("end".to_string(), chunk_end.clone()),
                    ("offset".to_string(), offset.to_string()),
                ];

                let response = self
                    .client
                    .get(&url)
                    .headers(self.get_headers())
                    .query(&params)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !response.status().is_success() {
                    return Err(format!(
                        "Failed to fetch transactions: {}",
                        response.status()
                    ));
                }

                let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
                let data = json
                    .get("data")
                    .and_then(|d| d.as_array())
                    .cloned()
                    .unwrap_or_default();

                if data.is_empty() {
                    break;
                }
                for tx in &data {
                    if let Some(id) = tx.get("id").and_then(|i| i.as_str()) {
                        all_transactions.insert(id.to_string(), tx.clone());
                    }
                }
                offset += page_size;
                if data.len() < page_size {
                    break;
                }
            }
        }

        let mut all_transactions: Vec<serde_json::Value> = all_transactions.into_values().collect();

        if let Some(ids) = account_ids {
            if !ids.is_empty() {
                let id_set: std::collections::HashSet<String> = ids.iter().cloned().collect();
                all_transactions.retain(|tx| self.transaction_involves_account(tx, &id_set));
            }
        }
        Ok(all_transactions)
    }

    fn transaction_involves_account(
        &self,
        tx: &serde_json::Value,
        account_ids: &std::collections::HashSet<String>,
    ) -> bool {
        tx.get("attributes")
            .and_then(|a| a.get("transactions"))
            .and_then(|t| t.as_array())
            .map(|transactions| {
                transactions.iter().any(|t| {
                    let source_match = t
                        .get("source_id")
                        .and_then(|s| s.as_str())
                        .map(|s| account_ids.contains(s))
                        .unwrap_or(false);
                    let dest_match = t
                        .get("destination_id")
                        .and_then(|d| d.as_str())
                        .map(|d| account_ids.contains(d))
                        .unwrap_or(false);
                    source_match || dest_match
                })
            })
            .unwrap_or(false)
    }

    async fn aggregate_transactions_by_period(
        &self,
        earned_transactions: &[serde_json::Value],
        spent_transactions: &[serde_json::Value],
        period: &str,
        start_date: &str,
        end_date: &str,
    ) -> (
        std::collections::HashMap<String, f64>,
        std::collections::HashMap<String, f64>,
        Option<String>,
        Option<String>,
    ) {
        let mut earned_entries = std::collections::HashMap::new();
        let mut spent_entries = std::collections::HashMap::new();
        let mut currency_symbol = None;
        let mut currency_code = None;

        if let Ok(period_keys) = Self::generate_period_keys(start_date, end_date, period) {
            for key in period_keys {
                earned_entries.insert(key.clone(), 0.0);
                spent_entries.insert(key, 0.0);
            }
        }

        fn parse_transaction_date(date_str: &str) -> Option<chrono::NaiveDateTime> {
            // Try multiple ISO 8601 formats that Firefly III might return
            chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
                .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%SZ"))
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.3f+00:00")
                })
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.3fZ")
                })
                .or_else(|_| {
                    // Try parsing just the date portion and default to midnight UTC
                    chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                        .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
                })
                .ok()
        }

        let get_period_key = |date_str: &str, period: &str| -> String {
            if let Some(date) = parse_transaction_date(date_str) {
                match period {
                    "1M" => date.format("%Y-%m-01T00:00:00+00:00").to_string(),
                    "1Q" => {
                        let quarter_month = match date.month() {
                            1..=3 => 1,
                            4..=6 => 4,
                            7..=9 => 7,
                            10..=12 => 10,
                            _ => 1,
                        };
                        date.with_month(quarter_month)
                            .unwrap()
                            .format("%Y-%m-%dT00:00:00+00:00")
                            .to_string()
                    }
                    "1W" => {
                        let monday = date
                            - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
                        monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                    }
                    _ => date.format("%Y-%m-%dT00:00:00+00:00").to_string(),
                }
            } else {
                // If all parsing fails, try to extract just the date portion
                if let Some(date_part) = date_str.split('T').next() {
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d") {
                        return date.format("%Y-%m-%dT00:00:00+00:00").to_string();
                    }
                }
                date_str.to_string()
            }
        };

        let mut process =
            |transactions: &[serde_json::Value],
             entries: &mut std::collections::HashMap<String, f64>| {
                for tx in transactions {
                    if let Some(transactions_arr) = tx
                        .get("attributes")
                        .and_then(|a| a.get("transactions"))
                        .and_then(|t| t.as_array())
                    {
                        for t in transactions_arr {
                            if let Some(amount_str) = t.get("amount").and_then(|a| a.as_str()) {
                                if let Ok(amount) = amount_str.parse::<f64>() {
                                    if let Some(date) = t.get("date").and_then(|d| d.as_str()) {
                                        let key = get_period_key(date, period);
                                        *entries.entry(key).or_insert(0.0) += amount;
                                        if currency_symbol.is_none() {
                                            currency_symbol = t
                                                .get("currency_symbol")
                                                .and_then(|s| s.as_str())
                                                .map(String::from);
                                            currency_code = t
                                                .get("currency_code")
                                                .and_then(|s| s.as_str())
                                                .map(String::from);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };

        process(earned_transactions, &mut earned_entries);
        process(spent_transactions, &mut spent_entries);

        (
            earned_entries,
            spent_entries,
            currency_symbol,
            currency_code,
        )
    }

    fn generate_period_keys(
        start_date: &str,
        end_date: &str,
        period: &str,
    ) -> Result<Vec<String>, String> {
        let start =
            chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let end =
            chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d").map_err(|e| e.to_string())?;
        let mut keys = Vec::new();
        let mut current = start;
        while current <= end {
            let key = match period {
                "1M" => current.format("%Y-%m-01T00:00:00+00:00").to_string(),
                "1Q" => {
                    let quarter_month = match current.month() {
                        1..=3 => 1,
                        4..=6 => 4,
                        7..=9 => 7,
                        10..=12 => 10,
                        _ => 1,
                    };
                    current
                        .with_month(quarter_month)
                        .unwrap()
                        .format("%Y-%m-%dT00:00:00+00:00")
                        .to_string()
                }
                "1W" => {
                    let monday = current
                        - chrono::Duration::days(current.weekday().num_days_from_monday() as i64);
                    monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
                _ => current.format("%Y-%m-%dT00:00:00+00:00").to_string(),
            };
            keys.push(key);
            match period {
                "1M" => {
                    if current.month() == 12 {
                        current = current
                            .with_year(current.year() + 1)
                            .unwrap()
                            .with_month(1)
                            .unwrap();
                    } else {
                        current = current.with_month(current.month() + 1).unwrap();
                    }
                }
                "1Q" => {
                    let current_quarter = ((current.month() - 1) / 3) + 1;
                    let next_quarter_start = current_quarter * 3 + 1;
                    if next_quarter_start > 12 {
                        current = current
                            .with_year(current.year() + 1)
                            .unwrap()
                            .with_month(1)
                            .unwrap();
                    } else {
                        current = current.with_month(next_quarter_start).unwrap();
                    }
                }
                "1W" => current += chrono::Duration::days(7),
                _ => current += chrono::Duration::days(1),
            }
        }
        Ok(keys)
    }

    fn sum_filtered_transaction_amounts(
        data: &serde_json::Value,
        selected_account_ids: &std::collections::HashSet<String>,
        is_income: bool,
    ) -> f64 {
        data.get("data")
            .and_then(|d| d.as_array())
            .map(|transactions| {
                transactions
                    .iter()
                    .filter_map(|t| t.get("attributes"))
                    .filter_map(|attr| attr.get("transactions"))
                    .filter_map(|trans_array| trans_array.as_array())
                    .flatten()
                    .filter(|t| {
                        if is_income {
                            // For income (deposits), ignore if source is a selected account
                            let source_id = t.get("source_id").and_then(|s| s.as_str());
                            if let Some(id) = source_id {
                                return !selected_account_ids.contains(id);
                            }
                        } else {
                            // For expenses (withdrawals), ignore if destination is a selected account
                            let dest_id = t.get("destination_id").and_then(|d| d.as_str());
                            if let Some(id) = dest_id {
                                return !selected_account_ids.contains(id);
                            }
                        }
                        true
                    })
                    .filter_map(|trans| trans.get("amount"))
                    .filter_map(|amt| amt.as_str())
                    .filter_map(|amt_str| amt_str.parse::<f64>().ok())
                    .sum()
            })
            .unwrap_or(0.0)
    }

    fn get_currency_from_transactions(
        income_data: &serde_json::Value,
        expense_data: &serde_json::Value,
    ) -> (Option<String>, Option<String>) {
        let currency = Self::extract_currency(income_data);
        if currency.0.is_some() || currency.1.is_some() {
            return currency;
        }
        Self::extract_currency(expense_data)
    }

    fn extract_currency(data: &serde_json::Value) -> (Option<String>, Option<String>) {
        data.get("data")
            .and_then(|d| d.as_array())
            .and_then(|transactions| transactions.first())
            .and_then(|t| t.get("attributes"))
            .and_then(|attr| attr.get("transactions"))
            .and_then(|trans_array| trans_array.as_array())
            .and_then(|trans| trans.first())
            .map(|trans| {
                let symbol = trans
                    .get("currency_symbol")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                let code = trans
                    .get("currency_code")
                    .and_then(|s| s.as_str())
                    .map(String::from);
                (symbol, code)
            })
            .unwrap_or((None, None))
    }
}
