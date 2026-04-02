use crate::config::Config;
use crate::models::{AccountArray, SimpleAccount, ChartLine};
use crate::cache::DataCache;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, ACCEPT};
use chrono::{Utc, Duration, Datelike};
use log::{error, info, debug};
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

    pub async fn get_accounts(&self, type_filter: Option<String>) -> Result<Vec<SimpleAccount>, String> {
        // Try to get from cache first
        if let Some(cached_json) = self.cache.get_accounts(type_filter.clone()) {
            debug!("Cache hit for accounts (type: {:?})", type_filter);
            return serde_json::from_str(&cached_json)
                .map_err(|e| format!("Failed to deserialize cached accounts: {}", e));
        }

        debug!("Cache miss for accounts (type: {:?}), fetching from Firefly III", type_filter);

        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap()
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        let mut url = format!("{}/v1/accounts", self.config.firefly_url);
        if let Some(ref t) = type_filter {
            url = format!("{}?type={}", url, t);
        }

        let response = self.client.get(url)
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

        let account_array: AccountArray = response.json()
            .await
            .map_err(|e| {
                error!("Failed to parse JSON: {}", e);
                e.to_string()
            })?;

        let simple_accounts = account_array.data.into_iter().map(|a| {
            SimpleAccount {
                id: a.id,
                name: a.attributes.name,
                balance: a.attributes.current_balance,
                currency: a.attributes.currency_symbol,
                account_type: a.attributes.account_type,
            }
        }).collect();

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
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap()
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
            (Utc::now() - Duration::days(30)).format("%Y-%m-%d").to_string()
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

        let response = self.client.get(&url)
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

        let chart_line: ChartLine = response.json()
            .await
            .map_err(|e| {
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
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap()
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        // Use provided dates or default to last 30 days
        let end = end_date.unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
        let start = start_date.unwrap_or_else(|| {
            (Utc::now() - Duration::days(30)).format("%Y-%m-%d").to_string()
        });

        let period = period.unwrap_or_else(|| "1D".to_string());

        // Fetch all transactions (optionally filtered by account IDs)
        let all_transactions = self.fetch_all_transactions(&headers, &start, &end, account_ids.as_ref()).await?;

        // Filter by transaction type
        let spent_transactions: Vec<_> = all_transactions.iter()
            .filter(|tx| {
                tx.get("attributes")
                    .and_then(|a| a.get("transactions"))
                    .and_then(|t| t.as_array())
                    .map(|trans| trans.iter().any(|t| t.get("type").and_then(|ty| ty.as_str()) == Some("withdrawal")))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        let earned_transactions: Vec<_> = all_transactions.iter()
            .filter(|tx| {
                tx.get("attributes")
                    .and_then(|a| a.get("transactions"))
                    .and_then(|t| t.as_array())
                    .map(|trans| trans.iter().any(|t| t.get("type").and_then(|ty| ty.as_str()) == Some("deposit")))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();

        info!("Fetched {} spent (withdrawal) transactions and {} earned (deposit) transactions", spent_transactions.len(), earned_transactions.len());

        // Aggregate by period
        let (earned_entries, spent_entries, currency_symbol, currency_code) =
            self.aggregate_transactions_by_period(earned_transactions, spent_transactions, &period).await;

        info!("Aggregated earned entries: {} data points", earned_entries.len());
        info!("Aggregated spent entries: {} data points", spent_entries.len());

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
            }
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
        let mut query_params = vec![
            ("start".to_string(), start.to_string()),
            ("end".to_string(), end.to_string()),
        ];

        // Add account filter if provided
        if let Some(ids) = account_ids {
            for id in ids {
                query_params.push(("accounts[]".to_string(), id.clone()));
            }
        }

        let mut all_transactions = Vec::new();
        let mut offset = 0;
        let page_size = 500;

        loop {
            let mut params_with_offset = query_params.clone();
            params_with_offset.push(("offset".to_string(), offset.to_string()));

            let response = self.client.get(&url)
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
            let data = json.get("data").and_then(|d| d.as_array()).unwrap_or(&empty);

            if data.is_empty() {
                break;
            }

            all_transactions.extend(data.clone());
            offset += page_size;

            if data.len() < page_size {
                break;
            }
        }

        Ok(all_transactions)
    }

    /// Aggregate transactions by period
    async fn aggregate_transactions_by_period(
        &self,
        earned_transactions: Vec<serde_json::Value>,
        spent_transactions: Vec<serde_json::Value>,
        period: &str,
    ) -> (
        std::collections::HashMap<String, f64>,
        std::collections::HashMap<String, f64>,
        Option<String>,
        Option<String>,
    ) {
        let mut earned_entries: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
        let mut spent_entries: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
        let mut currency_symbol: Option<String> = None;
        let mut currency_code: Option<String> = None;

        // Helper to get period key from date
        let get_period_key = |date_str: &str, period: &str| -> String {
            if let Ok(date) = chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00") {
                match period {
                    "1M" => date.format("%Y-%m-01T00:00:00+00:00").to_string(),
                    "1W" => {
                        let monday = date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
                        monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                    }
                    _ => date.format("%Y-%m-%dT00:00:00+00:00").to_string(),
                }
            } else {
                date_str.to_string()
            }
        };

        // Process earned transactions (deposits)
        for tx in &earned_transactions {
            if let Some(transactions) = tx.get("attributes").and_then(|a| a.get("transactions")).and_then(|t| t.as_array()) {
                for t in transactions {
                    if let Some(amount_str) = t.get("amount").and_then(|a| a.as_str()) {
                        if let Ok(amount) = amount_str.parse::<f64>() {
                            if let Some(date) = t.get("date").and_then(|d| d.as_str()) {
                                let period_key = get_period_key(date, period);
                                *earned_entries.entry(period_key).or_insert(0.0) += amount;

                                if currency_symbol.is_none() {
                                    currency_symbol = t.get("currency_symbol").and_then(|s| s.as_str()).map(String::from);
                                    currency_code = t.get("currency_code").and_then(|s| s.as_str()).map(String::from);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Process spent transactions (withdrawals)
        for tx in &spent_transactions {
            if let Some(transactions) = tx.get("attributes").and_then(|a| a.get("transactions")).and_then(|t| t.as_array()) {
                for t in transactions {
                    if let Some(amount_str) = t.get("amount").and_then(|a| a.as_str()) {
                        if let Ok(amount) = amount_str.parse::<f64>() {
                            if let Some(date) = t.get("date").and_then(|d| d.as_str()) {
                                let period_key = get_period_key(date, period);
                                // Spent is positive in the data, but we want it as positive for display
                                *spent_entries.entry(period_key).or_insert(0.0) += amount;

                                if currency_symbol.is_none() {
                                    currency_symbol = t.get("currency_symbol").and_then(|s| s.as_str()).map(String::from);
                                    currency_code = t.get("currency_code").and_then(|s| s.as_str()).map(String::from);
                                }
                            }
                        }
                    }
                }
            }
        }

        (earned_entries, spent_entries, currency_symbol, currency_code)
    }
}
