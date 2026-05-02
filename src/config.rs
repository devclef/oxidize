use dotenv::dotenv;
use std::env;

/// A validated Firefly III URL. Only http/https URLs are allowed.
/// This type guarantees the URL has been validated to prevent SSRF.
#[derive(Clone, Debug)]
pub struct FireflyUrl(String);

impl FireflyUrl {
    pub fn validate(raw: String) -> Result<Self, String> {
        if raw.starts_with("http://") || raw.starts_with("https://") {
            Ok(Self(raw))
        } else {
            Err(format!(
                "FIREFLY_III_URL must be a valid HTTP/HTTPS URL. Got: {}",
                raw
            ))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub firefly_url: FireflyUrl,
    pub firefly_token: String,
    pub host: String,
    pub port: u16,
    pub account_types: Vec<String>,
    pub auto_fetch_accounts: bool,
    pub data_dir: String,
    pub time_ranges: Vec<String>,
    pub default_time_range: String,
}

impl Config {
    pub fn from_env() -> Self {
        dotenv().ok();

        let firefly_url = env::var("FIREFLY_III_URL")
            .unwrap_or_else(|_| "https://demo.firefly-iii.org/api".to_string());
        let firefly_url = FireflyUrl::validate(firefly_url).expect("Invalid FIREFLY_III_URL");
        let firefly_token = env::var("FIREFLY_III_ACCESS_TOKEN").unwrap_or_else(|_| "".to_string());
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
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
        let data_dir = env::var("DATA_DIR").unwrap_or_else(|_| {
            dirs::home_dir()
                .map(|h| format!("{}/.oxidize/data", h.display()))
                .unwrap_or("./data".to_string())
        });

        // Parse TIME_RANGES: comma-separated list of relative time range presets
        let time_ranges = env::var("TIME_RANGES")
            .unwrap_or_else(|_| "7d,30d,3m,6m,1y,ytd".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        // Parse DEFAULT_TIME_RANGE: which preset to pre-select (default: 30d)
        let default_time_range = env::var("DEFAULT_TIME_RANGE")
            .unwrap_or_else(|_| "30d".to_string());

        Self {
            firefly_url,
            firefly_token,
            host,
            port,
            account_types,
            auto_fetch_accounts,
            data_dir,
            time_ranges,
            default_time_range,
        }
    }
}
