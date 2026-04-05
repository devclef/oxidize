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
        // Try to get from cache first
        if let Some(cached_json) = self.cache.get_accounts(type_filter.clone()) {
            debug!("Cache hit for accounts (type: {:?})", type_filter);
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached accounts: {}", e));
        }

        debug!(
            "Cache miss for accounts (type: {:?}), fetching from Firefly III",
            type_filter
        );

        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        let mut url = format!("{}/v1/accounts", self.config.firefly_url);
        if let Some(ref t) = type_filter {
            url = format!("{}?type={}", url, t);
        }

        let response = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to send request: {}", e);
                e.to_string()
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("API request failed with status: {}. Body: {}", status, body);
            return Err(format!("API request failed with status: {}", status));
        }

        let account_array: AccountArray = response.json().await.map_err(|e| {
            error!("Failed to parse JSON: {}", e);
            e.to_string()
        })?;

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

        // Cache the result as JSON
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
        // Try to get from cache first
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

        debug!("Cache miss for balance history, fetching from Firefly III");

        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        // Clone params before using them, since we need them for caching later
        let cache_start_date = start_date.clone();
        let cache_end_date = end_date.clone();
        let cache_period = period.clone();

        // Use provided dates or default to last 30 days
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });

        let period = period.unwrap_or_else(|| "1D".to_string());

        let url = format!("{}/v1/chart/account/overview", self.config.firefly_url);

        // Build query params based on whether specific accounts are provided
        let mut query_params = vec![
            ("start".to_string(), start),
            ("end".to_string(), end),
            ("period".to_string(), period.clone()),
        ];

        if let Some(ref ids) = account_ids {
            if !ids.is_empty() {
                // When specific accounts are provided, add them to the query
                // Firefly III will return balance data for those accounts
                for id in ids {
                    query_params.push(("accounts[]".to_string(), id.clone()));
                }
            } else {
                // No specific accounts - use preselected assets
                query_params.push(("preselected".to_string(), "assets".to_string()));
            }
        } else {
            // No accounts provided - use preselected assets
            query_params.push(("preselected".to_string(), "assets".to_string()));
        }

        let response = self
            .client
            .get(&url)
            .headers(headers)
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to send request: {}", e);
                e.to_string()
            })?;

        let full_url = response.url().to_string();
        info!("Firefly API request URL: {}", full_url);

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("API request failed with status: {}. Body: {}", status, body);
            return Err(format!("API request failed with status: {}", status));
        }

        let chart_line: ChartLine = response.json().await.map_err(|e| {
            error!("Failed to parse chart JSON: {}", e);
            e.to_string()
        })?;

        info!("Chart API returned {} datasets", chart_line.len());
        for ds in &chart_line {
            info!("  Dataset: {}", ds.label);
        }

        // Cache the result as JSON
        if let Ok(json) = serde_json::to_string(&chart_line) {
            self.cache.set_balance_history(
                account_ids,
                cache_start_date,
                cache_end_date,
                cache_period,
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

        // Use transactions API to get actual flow data (earned/spent)
        // The chart API returns balance data, not flow data
        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        // Use provided dates or default to last 30 days
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string()
        });

        let period = period.unwrap_or_else(|| "1D".to_string());

        log::info!(
            "Fetching earned/spent data: start={}, end={}, period={}, account_ids={:?}",
            start,
            end,
            period,
            account_ids
        );

        // Fetch all transactions (optionally filtered by account IDs)
        let all_transactions = self
            .fetch_all_transactions(&headers, &start, &end, account_ids.as_ref())
            .await?;

        // Filter by transaction type
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

        info!(
            "Fetched {} spent (withdrawal) transactions and {} earned (deposit) transactions",
            spent_transactions.len(),
            earned_transactions.len()
        );

        // Aggregate by period
        let (earned_entries, spent_entries, currency_symbol, currency_code) = self
            .aggregate_transactions_by_period(
                earned_transactions,
                spent_transactions,
                &period,
                &start,
                &end,
            )
            .await;

        info!(
            "Aggregated earned entries: {} data points",
            earned_entries.len()
        );
        info!(
            "Aggregated spent entries: {} data points",
            spent_entries.len()
        );

        let earned_json: serde_json::Value = serde_json::to_value(earned_entries).unwrap();
        let spent_json: serde_json::Value = serde_json::to_value(spent_entries).unwrap();

        let result: ChartLine = vec![
            ChartDataSet {
                label: "earned".to_string(),
                currency_symbol: currency_symbol.clone(),
                currency_code: currency_code.clone(),
                entries: earned_json,
            },
            ChartDataSet {
                label: "spent".to_string(),
                currency_symbol,
                currency_code,
                entries: spent_json,
            },
        ];

        Ok(result)
    }

    /// Fetch all transactions in date range, optionally filtered by account IDs
    async fn fetch_all_transactions(
        &self,
        headers: &HeaderMap,
        start: &str,
        end: &str,
        account_ids: Option<&Vec<String>>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let url = format!("{}/v1/transactions", self.config.firefly_url);
        let query_params = vec![
            ("start".to_string(), start.to_string()),
            ("end".to_string(), end.to_string()),
        ];

        let mut all_transactions = Vec::new();
        let mut offset = 0;
        let page_size = 500;

        loop {
            let mut params_with_offset = query_params.clone();
            params_with_offset.push(("offset".to_string(), offset.to_string()));

            let response = self
                .client
                .get(&url)
                .headers(headers.clone())
                .query(&params_with_offset)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                error!("Failed to fetch transactions: {}. Body: {}", status, body);
                return Err(format!("Failed to fetch transactions: {}", status));
            }

            let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
            let empty: Vec<serde_json::Value> = Vec::new();
            let data = json
                .get("data")
                .and_then(|d| d.as_array())
                .unwrap_or(&empty);

            if data.is_empty() {
                break;
            }

            all_transactions.extend(data.clone());
            offset += page_size;

            if data.len() < page_size {
                break;
            }
        }

        // If account IDs are provided, filter transactions to only include those
        // that involve the specified accounts
        if let Some(ids) = account_ids {
            if !ids.is_empty() {
                let id_set: std::collections::HashSet<String> = ids.iter().cloned().collect();
                let before_count = all_transactions.len();
                all_transactions.retain(|tx| self.transaction_involves_account(tx, &id_set));
                let after_count = all_transactions.len();
                info!(
                    "Filtered {} transactions to {} based on account IDs",
                    before_count, after_count
                );
            }
        }

        Ok(all_transactions)
    }

    /// Check if a transaction involves any of the specified account IDs
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
                    // Check source account
                    let source_match = t
                        .get("source_id")
                        .and_then(|s| s.as_str())
                        .map(|s| account_ids.contains(s))
                        .unwrap_or(false);

                    // Check destination account
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

    /// Generate all period keys for a date range
    fn generate_period_keys(
        start_date: &str,
        end_date: &str,
        period: &str,
    ) -> Result<Vec<String>, String> {
        use chrono::Datelike;

        let start = chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
            .map_err(|e| format!("Failed to parse start date: {}", e))?;
        let end = chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d")
            .map_err(|e| format!("Failed to parse end date: {}", e))?;

        let mut keys = Vec::new();
        let mut current = start;

        while current <= end {
            let key = match period {
                "1M" => {
                    // First day of the month
                    current.format("%Y-%m-01T00:00:00+00:00").to_string()
                }
                "1W" => {
                    // Monday of the week containing current date
                    let monday = current
                        - chrono::Duration::days(current.weekday().num_days_from_monday() as i64);
                    monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
                _ => {
                    // Daily (1D) or default
                    current.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
            };

            keys.push(key);

            // Move to next period
            match period {
                "1M" => {
                    // Move to first day of next month
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
                "1W" => {
                    // Move to next Monday
                    current += chrono::Duration::days(7);
                }
                _ => {
                    // Move to next day
                    current += chrono::Duration::days(1);
                }
            }
        }

        Ok(keys)
    }

    /// Aggregate transactions by period
    async fn aggregate_transactions_by_period(
        &self,
        earned_transactions: Vec<serde_json::Value>,
        spent_transactions: Vec<serde_json::Value>,
        period: &str,
        start_date: &str,
        end_date: &str,
    ) -> (
        std::collections::HashMap<String, f64>,
        std::collections::HashMap<String, f64>,
        Option<String>,
        Option<String>,
    ) {
        let mut earned_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        let mut spent_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        // Generate all period keys for the date range and initialize with 0
        if let Ok(period_keys) = Self::generate_period_keys(start_date, end_date, period) {
            for key in period_keys {
                earned_entries.insert(key.clone(), 0.0);
                spent_entries.insert(key, 0.0);
            }
        }

        // Helper to get period key from date
        let get_period_key = |date_str: &str, period: &str| -> String {
            if let Ok(date) =
                chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
            {
                match period {
                    "1M" => date.format("%Y-%m-01T00:00:00+00:00").to_string(),
                    "1W" => {
                        let monday = date
                            - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
                        monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                    }
                    _ => date.format("%Y-%m-%dT00:00:00+00:00").to_string(),
                }
            } else {
                date_str.to_string()
            }
        };

        // Process earned transactions (deposit)
        for tx in &earned_transactions {
            if let Some(transactions) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for t in transactions {
                    if let Some(amount_str) = t.get("amount").and_then(|a| a.as_str()) {
                        if let Ok(amount) = amount_str.parse::<f64>() {
                            if let Some(date) = t.get("date").and_then(|d| d.as_str()) {
                                let period_key = get_period_key(date, period);
                                *earned_entries.entry(period_key).or_insert(0.0) += amount;

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

        // Process spent transactions (withdrawal)
        for tx in &spent_transactions {
            if let Some(transactions) = tx
                .get("attributes")
                .and_then(|a| a.get("transactions"))
                .and_then(|t| t.as_array())
            {
                for t in transactions {
                    if let Some(amount_str) = t.get("amount").and_then(|a| a.as_str()) {
                        if let Ok(amount) = amount_str.parse::<f64>() {
                            if let Some(date) = t.get("date").and_then(|d| d.as_str()) {
                                let period_key = get_period_key(date, period);
                                // Spent is positive in the data, but we want it as positive for display
                                *spent_entries.entry(period_key).or_insert(0.0) += amount;

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

        (
            earned_entries,
            spent_entries,
            currency_symbol,
            currency_code,
        )
    }

    /// Get expenses aggregated by category
    #[allow(dead_code)]
    pub async fn get_expenses_by_category(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        account_ids: Option<Vec<String>>,
    ) -> Result<Vec<CategoryExpense>, String> {
        use crate::models::chart::CategoryExpense;

        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });

        log::info!(
            "Fetching expenses by category: start={}, end={}",
            start,
            end
        );

        let all_transactions = self
            .fetch_all_transactions(&headers, &start, &end, account_ids.as_ref())
            .await?;

        // Filter for withdrawal (expense) transactions
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

        log::info!("Found {} expense transactions", expense_transactions.len());

        // Aggregate by category
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
                            // Get category name
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

        // Convert to vector and sort by amount descending
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

    /// Get net worth data (assets - liabilities)
    #[allow(dead_code)]
    pub async fn get_net_worth(
        &self,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Result<ChartLine, String> {
        use crate::models::chart::ChartDataSet;

        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string()
        });
        let period = period.unwrap_or_else(|| "1M".to_string());

        log::info!(
            "Fetching net worth: start={}, end={}, period={}",
            start,
            end,
            period
        );

        // Fetch assets balance history
        let url = format!("{}/v1/chart/account/overview", self.config.firefly_url);
        let asset_query = vec![
            ("start".to_string(), start.clone()),
            ("end".to_string(), end.clone()),
            ("period".to_string(), period.clone()),
            ("preselected".to_string(), "assets".to_string()),
        ];

        let asset_response = self
            .client
            .get(&url)
            .headers(headers.clone())
            .query(&asset_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let asset_data: ChartLine = asset_response.json().await.map_err(|e| e.to_string())?;

        // Fetch liabilities balance history
        let liability_query = vec![
            ("start".to_string(), start),
            ("end".to_string(), end),
            ("period".to_string(), period),
            ("preselected".to_string(), "liabilities".to_string()),
        ];

        let liability_response = self
            .client
            .get(&url)
            .headers(headers)
            .query(&liability_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let liability_data: ChartLine =
            liability_response.json().await.map_err(|e| e.to_string())?;

        // Calculate net worth (assets - liabilities)
        let mut net_worth_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        // Process assets (add)
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

        // Process liabilities (subtract)
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

        // Convert to ChartDataSet format
        let mut entries_vec: Vec<serde_json::Value> = net_worth_entries
            .into_iter()
            .map(|(date, ba)| {
                serde_json::json!({
                    "date": date,
                    "ba": ba
                })
            })
            .collect();

        entries_vec.sort_by(|a, b| {
            let date_a = a.get("date").and_then(|d| d.as_str()).unwrap_or("");
            let date_b = b.get("date").and_then(|d| d.as_str()).unwrap_or("");
            date_a.cmp(date_b)
        });

        Ok(vec![ChartDataSet {
            label: "Net Worth".to_string(),
            currency_symbol,
            currency_code,
            entries: serde_json::Value::Array(entries_vec),
        }])
    }

    /// Get monthly summary data (income, expenses, savings)
    pub async fn get_monthly_summary(
        &self,
        month: u32,
        year: i32,
        account_ids: Option<Vec<String>>,
    ) -> Result<MonthlySummary, String> {

        // Calculate start and end dates for the month
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

        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap(),
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        // Build base query params
        let mut income_query = vec![
            ("start".to_string(), start_date.clone()),
            ("end".to_string(), end_date.clone()),
            ("type".to_string(), "deposit".to_string()), // deposits = income
        ];

        let mut expense_query = vec![
            ("start".to_string(), start_date.clone()),
            ("end".to_string(), end_date.clone()),
            ("type".to_string(), "withdrawal".to_string()), // withdrawals = expenses
        ];

        // Add account filters if specified
        if let Some(ref ids) = account_ids {
            if !ids.is_empty() {
                // For deposits (income): filter by destination account
                income_query.push(("destination_id".to_string(), ids.join(",")));
                // For withdrawals (expenses): filter by source account
                expense_query.push(("source_id".to_string(), ids.join(",")));
            }
        }

        let url = format!("{}/v1/transactions", self.config.firefly_url);

        let income_response = self
            .client
            .get(&url)
            .headers(headers.clone())
            .query(&income_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !income_response.status().is_success() {
            return Err(format!(
                "Failed to fetch income data: {}",
                income_response.status()
            ));
        }

        let income_data: serde_json::Value = income_response.json().await.map_err(|e| e.to_string())?;

        let expense_response = self
            .client
            .get(&url)
            .headers(headers.clone())
            .query(&expense_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !expense_response.status().is_success() {
            return Err(format!(
                "Failed to fetch expense data: {}",
                expense_response.status()
            ));
        }

        let expense_data: serde_json::Value = expense_response.json().await.map_err(|e| e.to_string())?;

        // Calculate totals
        let total_income = Self::sum_transaction_amounts(&income_data);
        let total_expenses = Self::sum_transaction_amounts(&expense_data);
        let savings = total_income - total_expenses;
        let savings_rate = if total_income > 0.0 {
            (savings / total_income) * 100.0
        } else {
            0.0
        };

        // Get currency info from first transaction
        let (currency_symbol, currency_code) =
            Self::get_currency_from_transactions(&income_data, &expense_data);


        // Format month name
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

    fn sum_transaction_amounts(data: &serde_json::Value) -> f64 {
        data.get("data")
            .and_then(|d| d.as_array())
            .map(|transactions| {
                transactions
                    .iter()
                    .filter_map(|t| t.get("attributes"))
                    .filter_map(|attr| attr.get("transactions"))
                    .filter_map(|trans_array| trans_array.as_array())
                    .flatten()
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
        // Try income data first
        let currency = Self::extract_currency(income_data);
        if currency.0.is_some() || currency.1.is_some() {
            return currency;
        }
        // Fall back to expense data
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
