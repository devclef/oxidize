use crate::config::Config;
use crate::models::{AccountArray, SimpleAccount, ChartLine};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, ACCEPT};
use chrono::{Utc, Duration};
use log::error;

pub struct FireflyClient {
    client: reqwest::Client,
    config: Config,
}

impl FireflyClient {
    pub fn new(config: Config) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Oxidize/0.1.0")
            .build()
            .unwrap();

        Self { client, config }
    }

    pub async fn get_accounts(&self, type_filter: Option<String>) -> Result<Vec<SimpleAccount>, String> {
        let mut headers = HeaderMap::new();
        if !self.config.firefly_token.is_empty() {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", self.config.firefly_token)).unwrap()
            );
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.api+json"));

        let mut url = format!("{}/v1/accounts", self.config.firefly_url);
        if let Some(t) = type_filter {
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

        Ok(simple_accounts)
    }

    pub async fn get_balance_history(
        &self,
        account_ids: Option<Vec<String>>,
        start_date: Option<String>,
        end_date: Option<String>,
        period: Option<String>,
    ) -> Result<ChartLine, String> {
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

        let url = format!("{}/v1/chart/balance/balance", self.config.firefly_url);

        let mut query_params = vec![
            ("start".to_string(), start),
            ("end".to_string(), end),
            ("period".to_string(), period.unwrap_or_else(|| "1D".to_string())),
        ];

        if let Some(ids) = account_ids {
            if ids.is_empty() {
                query_params.push(("preselected".to_string(), "assets".to_string()));
            } else {
                for id in ids {
                    query_params.push(("accounts[]".to_string(), id));
                }
            }
        } else {
            query_params.push(("preselected".to_string(), "assets".to_string()));
        }

        let response = self.client.get(url)
            .headers(headers)
            .query(&query_params)
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

        let chart_line: ChartLine = response.json()
            .await
            .map_err(|e| {
                error!("Failed to parse chart JSON: {}", e);
                e.to_string()
            })?;

        Ok(chart_line)
    }
}
