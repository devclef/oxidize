use std::env;
use dotenv::dotenv;

#[derive(Clone, Debug)]
pub struct Config {
    pub firefly_url: String,
    pub firefly_token: String,
    pub host: String,
    pub port: u16,
    pub account_types: Vec<String>,
    pub auto_fetch_accounts: bool,
    pub data_dir: String,
}

impl Config {
    pub fn from_env() -> Self {
        dotenv().ok();

        let firefly_url = env::var("FIREFLY_III_URL")
            .unwrap_or_else(|_| "https://demo.firefly-iii.org/api".to_string());
        let firefly_token = env::var("FIREFLY_III_ACCESS_TOKEN")
            .unwrap_or_else(|_| "".to_string());
        let host = env::var("HOST")
            .unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse::<u16>()
            .unwrap_or(8080);

        // Parse ACCOUNT_TYPES: comma-separated list of account types to show in the filter
        // Default to common Firefly III account types
        let account_types = env::var("ACCOUNT_TYPES")
            .unwrap_or_else(|_| "asset,cash,expense,revenue,liability".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        // Parse AUTO_FETCH_ACCOUNTS: if true, automatically fetch accounts on page load
        let auto_fetch_accounts = env::var("AUTO_FETCH_ACCOUNTS")
            .map(|v| v.trim().to_lowercase() == "true" || v.trim() == "1")
            .unwrap_or(false);

        // Parse DATA_DIR: directory for SQLite database storage
        let data_dir = env::var("DATA_DIR")
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .map(|h| format!("{}/.oxidize/data", h.display()))
                    .unwrap_or("./data".to_string())
            });

        Self {
            firefly_url,
            firefly_token,
            host,
            port,
            account_types,
            auto_fetch_accounts,
            data_dir,
        }
    }
}
