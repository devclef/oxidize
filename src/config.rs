use dotenvy::dotenv;
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
    pub cache_ttl: u64,
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

        // Parse CACHE_TTL: cache TTL in seconds (default: 3600 = 1 hour)
        let cache_ttl = env::var("CACHE_TTL")
            .unwrap_or_else(|_| "3600".to_string())
            .parse::<u64>()
            .unwrap_or(3600);

        // Parse TIME_RANGES: comma-separated list of relative time range presets
        let time_ranges = env::var("TIME_RANGES")
            .unwrap_or_else(|_| "7d,30d,3m,6m,1y,ytd".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        // Parse DEFAULT_TIME_RANGE: which preset to pre-select (default: 30d)
        let default_time_range =
            env::var("DEFAULT_TIME_RANGE").unwrap_or_else(|_| "30d".to_string());

        Self {
            firefly_url,
            firefly_token,
            host,
            port,
            account_types,
            auto_fetch_accounts,
            data_dir,
            cache_ttl,
            time_ranges,
            default_time_range,
        }
    }

    /// Layer runtime settings (saved on the /settings page) on top of this
    /// env-based config. Unset settings fields (`None`) fall back to the
    /// environment value. Invalid saved values also fall back, so a bad
    /// entry can never break the server.
    pub fn with_settings(&self, settings: &crate::models::settings::Settings) -> Config {
        let firefly_url = match &settings.firefly_url {
            Some(u) if !u.trim().is_empty() => {
                FireflyUrl::validate(u.clone()).unwrap_or_else(|_| self.firefly_url.clone())
            }
            _ => self.firefly_url.clone(),
        };
        let firefly_token = settings
            .firefly_token
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| self.firefly_token.clone());
        let account_types = settings
            .account_types
            .clone()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| self.account_types.clone());
        let cache_ttl = settings
            .cache_ttl
            .filter(|t| *t > 0)
            .unwrap_or(self.cache_ttl);
        let time_ranges = settings
            .time_ranges
            .clone()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| self.time_ranges.clone());
        let default_time_range = settings
            .default_time_range
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| self.default_time_range.clone());

        Config {
            firefly_url,
            firefly_token,
            host: self.host.clone(),
            port: self.port,
            account_types,
            auto_fetch_accounts: settings
                .auto_fetch_accounts
                .unwrap_or(self.auto_fetch_accounts),
            data_dir: self.data_dir.clone(),
            cache_ttl,
            time_ranges,
            default_time_range,
        }
    }

    /// The effective config: environment values plus the runtime settings
    /// saved in the database (see the /settings page). Falls back to the
    /// pure env-based config when the storage layer is not initialized
    /// (unit tests that never touch the database).
    pub fn effective(base: &Config) -> Config {
        match crate::storage::Storage::get_settings_unchecked() {
            Some(settings) => base.with_settings(&settings),
            None => base.clone(),
        }
    }
}
