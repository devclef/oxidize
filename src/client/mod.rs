use crate::config::Config;
use crate::models::{AccountArray, SimpleAccount, ChartLine};
use crate::cache::DataCache;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, ACCEPT};
use chrono::{Utc, Duration};
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
}
