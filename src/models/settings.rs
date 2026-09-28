//! User settings that can be changed at runtime from the /settings page.
//!
//! Settings persist in the SQLite `settings` table. Any key that has not
//! been saved yet falls back to the default in [`Settings::default`].
//!
//! Feature flags are **enabled by default** so a fresh install behaves
//! exactly like the always-on pages; `monthly_summary_enabled` is the
//! one exception (off by default).
//!
//! The `Option` fields mirror settings that used to be configured with
//! environment variables at startup (Firefly URL/token, account types,
//! auto-fetch, cache TTL, time ranges). `None` means "not saved in the
//! settings page, use the value from the server environment" — see
//! [`Settings::with_defaults_from`] for how the effective value is
//! resolved.

use serde::{Deserialize, Serialize};

use crate::config::{Config, FireflyUrl};
use crate::models::account::ALL_FIRELY_ACCOUNT_TYPES;

/// Maximum allowed chart cache TTL (one year).
pub const MAX_CACHE_TTL: u64 = 31_536_000;

/// Runtime user settings.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Whether the Monthly Summary page is available. Default: disabled, so
    /// the page and its nav link are hidden until explicitly enabled.
    pub monthly_summary_enabled: bool,
    /// Whether the Sankey Flow page is available. Default: enabled.
    pub sankey_enabled: bool,
    /// Whether the Reimbursements page is available. Default: enabled.
    pub reimbursements_enabled: bool,
    /// Whether the Budget Comparison page is available. Default: enabled.
    pub budget_comparison_enabled: bool,
    /// Whether the Avg Cost page is available. Default: enabled.
    pub avg_cost_enabled: bool,
    /// Firefly III base URL. `None` = use the `FIREFLY_III_URL` env value.
    pub firefly_url: Option<String>,
    /// Firefly III access token. `None` = use `FIREFLY_III_ACCESS_TOKEN`.
    pub firefly_token: Option<String>,
    /// Account types shown in the account type filter. `None` = use
    /// `ACCOUNT_TYPES`.
    pub account_types: Option<Vec<String>>,
    /// Auto-fetch accounts on page load. `None` = use
    /// `AUTO_FETCH_ACCOUNTS`.
    pub auto_fetch_accounts: Option<bool>,
    /// Chart cache TTL in seconds. `None` = use `CACHE_TTL`.
    pub cache_ttl: Option<u64>,
    /// Relative time range presets. `None` = use `TIME_RANGES`.
    pub time_ranges: Option<Vec<String>>,
    /// Pre-selected time range preset. `None` = use `DEFAULT_TIME_RANGE`.
    pub default_time_range: Option<String>,
}

/// Payload for `GET /api/settings`: the effective values the app actually
/// uses (saved values layered over the env-based defaults), plus the
/// metadata the settings form needs to render its options.
#[derive(Clone, Debug, Serialize)]
pub struct SettingsResponse {
    #[serde(flatten)]
    pub settings: Settings,
    /// Every account type Firefly III supports (for the account type
    /// checkboxes).
    pub account_type_options: Vec<String>,
    /// Read-only server facts (changing them requires a restart).
    pub server: ServerInfo,
}

/// Read-only information about the running server. These values come from
/// the process environment (`.env` / container env vars) and only take
/// effect after a restart.
#[derive(Clone, Debug, Serialize)]
pub struct ServerInfo {
    pub host: String,
    pub port: u16,
    pub data_dir: String,
    pub log_level: String,
}

/// Body for `POST /api/settings/test-firefly`.
#[derive(Clone, Debug, Deserialize, Default)]
pub struct FireflyTestRequest {
    pub url: Option<String>,
    pub token: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            monthly_summary_enabled: false,
            sankey_enabled: true,
            reimbursements_enabled: true,
            budget_comparison_enabled: true,
            avg_cost_enabled: true,
            firefly_url: None,
            firefly_token: None,
            account_types: None,
            auto_fetch_accounts: None,
            cache_ttl: None,
            time_ranges: None,
            default_time_range: None,
        }
    }
}

impl Settings {
    /// Build settings from raw key/value rows, applying defaults for any
    /// missing keys. Missing or empty values for the env-mirroring fields
    /// stay `None` (i.e. "use the server environment value").
    pub fn from_rows(rows: &std::collections::HashMap<String, String>) -> Self {
        let mut s = Self::default();
        for (key, field) in [
            ("monthly_summary_enabled", &mut s.monthly_summary_enabled),
            ("sankey_enabled", &mut s.sankey_enabled),
            ("reimbursements_enabled", &mut s.reimbursements_enabled),
            (
                "budget_comparison_enabled",
                &mut s.budget_comparison_enabled,
            ),
            ("avg_cost_enabled", &mut s.avg_cost_enabled),
        ] {
            if let Some(v) = rows.get(key) {
                *field = v == "true" || v == "1";
            }
        }

        let text = |key: &str| -> Option<String> {
            rows.get(key)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let list = |key: &str| -> Option<Vec<String>> {
            text(key).map(|v| {
                v.split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect()
            })
        };

        s.firefly_url = text("firefly_url");
        s.firefly_token = text("firefly_token");
        s.account_types = list("account_types");
        s.time_ranges = list("time_ranges");
        s.default_time_range = text("default_time_range");
        s.cache_ttl = text("cache_ttl").and_then(|v| v.parse::<u64>().ok());
        match rows.get("auto_fetch_accounts").map(|v| v.trim()) {
            Some("true" | "1") => s.auto_fetch_accounts = Some(true),
            Some("false" | "0") => s.auto_fetch_accounts = Some(false),
            _ => {}
        }
        s
    }

    /// Serialize the settings to raw key/value rows for storage. Unset
    /// fields are stored as empty strings so that clearing a value on the
    /// settings page (reverting to the env value) is persisted.
    pub fn to_rows(&self) -> std::collections::HashMap<String, String> {
        let mut map: std::collections::HashMap<String, String> = [
            ("monthly_summary_enabled", self.monthly_summary_enabled),
            ("sankey_enabled", self.sankey_enabled),
            ("reimbursements_enabled", self.reimbursements_enabled),
            ("budget_comparison_enabled", self.budget_comparison_enabled),
            ("avg_cost_enabled", self.avg_cost_enabled),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

        map.insert(
            "firefly_url".into(),
            self.firefly_url.clone().unwrap_or_default(),
        );
        map.insert(
            "firefly_token".into(),
            self.firefly_token.clone().unwrap_or_default(),
        );
        map.insert(
            "account_types".into(),
            self.account_types.clone().unwrap_or_default().join(","),
        );
        map.insert(
            "auto_fetch_accounts".into(),
            match self.auto_fetch_accounts {
                Some(true) => "true".to_string(),
                Some(false) => "false".to_string(),
                None => String::new(),
            },
        );
        map.insert(
            "cache_ttl".into(),
            self.cache_ttl.map(|t| t.to_string()).unwrap_or_default(),
        );
        map.insert(
            "time_ranges".into(),
            self.time_ranges.clone().unwrap_or_default().join(","),
        );
        map.insert(
            "default_time_range".into(),
            self.default_time_range.clone().unwrap_or_default(),
        );
        map
    }

    /// Resolve every env-mirroring field to the value the app actually
    /// uses: the saved value when present, otherwise the env-based default
    /// from `config`. All `Option` fields come back as `Some(..)` so the
    /// settings page can display what is in effect.
    pub fn with_defaults_from(&self, config: &Config) -> Settings {
        Settings {
            monthly_summary_enabled: self.monthly_summary_enabled,
            sankey_enabled: self.sankey_enabled,
            reimbursements_enabled: self.reimbursements_enabled,
            budget_comparison_enabled: self.budget_comparison_enabled,
            avg_cost_enabled: self.avg_cost_enabled,
            firefly_url: Some(
                self.firefly_url
                    .clone()
                    .unwrap_or_else(|| config.firefly_url.as_str().to_string()),
            ),
            firefly_token: Some(
                self.firefly_token
                    .clone()
                    .unwrap_or_else(|| config.firefly_token.clone()),
            ),
            account_types: Some(
                self.account_types
                    .clone()
                    .filter(|v| !v.is_empty())
                    .unwrap_or_else(|| config.account_types.clone()),
            ),
            auto_fetch_accounts: Some(
                self.auto_fetch_accounts
                    .unwrap_or(config.auto_fetch_accounts),
            ),
            cache_ttl: Some(self.cache_ttl.unwrap_or(config.cache_ttl)),
            time_ranges: Some(
                self.time_ranges
                    .clone()
                    .filter(|v| !v.is_empty())
                    .unwrap_or_else(|| config.time_ranges.clone()),
            ),
            default_time_range: Some(
                self.default_time_range
                    .clone()
                    .unwrap_or_else(|| config.default_time_range.clone()),
            ),
        }
    }
}

/// Partial update body for `PATCH /api/settings`. Only the provided fields
/// are changed. For the env-mirroring fields, an **empty** string / empty
/// list / `0` clears the saved value (reverting to the server environment);
/// a missing key (JSON `null`) leaves it untouched.
#[derive(Clone, Debug, Deserialize, Default)]
pub struct SettingsUpdate {
    pub monthly_summary_enabled: Option<bool>,
    pub sankey_enabled: Option<bool>,
    pub reimbursements_enabled: Option<bool>,
    pub budget_comparison_enabled: Option<bool>,
    pub avg_cost_enabled: Option<bool>,
    pub firefly_url: Option<String>,
    pub firefly_token: Option<String>,
    pub account_types: Option<Vec<String>>,
    pub auto_fetch_accounts: Option<bool>,
    pub cache_ttl: Option<u64>,
    pub time_ranges: Option<Vec<String>>,
    pub default_time_range: Option<String>,
}

impl SettingsUpdate {
    /// Validate this update against the known account types and the current
    /// effective state (saved settings + env-based defaults). Rejects
    /// invalid URLs, unknown account types, out-of-range TTLs and
    /// time-range/default mismatches.
    pub fn validate(&self, current: &Settings, config: &Config) -> Result<(), String> {
        if let Some(raw) = self.firefly_url.as_deref() {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                FireflyUrl::validate(trimmed.to_string())?;
            }
        }

        if let Some(types) = &self.account_types {
            for t in types {
                let t = t.trim();
                if !t.is_empty() && !ALL_FIRELY_ACCOUNT_TYPES.contains(&t) {
                    return Err(format!(
                        "account_types: unknown account type '{}' (valid: {})",
                        t,
                        ALL_FIRELY_ACCOUNT_TYPES.join(", ")
                    ));
                }
            }
        }

        if let Some(ttl) = self.cache_ttl {
            if ttl != 0 && ttl > MAX_CACHE_TTL {
                return Err(format!(
                    "cache_ttl: must be 0 (keep the server default) or at most {} seconds",
                    MAX_CACHE_TTL
                ));
            }
        }

        let new_ranges = self
            .time_ranges
            .as_ref()
            .map(|list| {
                list.iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .filter(|list| !list.is_empty());

        let effective_default = self
            .default_time_range
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| current.default_time_range.clone())
            .unwrap_or_else(|| config.default_time_range.clone());

        let effective_ranges = new_ranges
            .clone()
            .or_else(|| current.time_ranges.clone().filter(|v| !v.is_empty()))
            .unwrap_or_else(|| config.time_ranges.clone());

        if !effective_ranges.contains(&effective_default) {
            return Err(format!(
                "default_time_range: '{}' is not one of the time ranges ({})",
                effective_default,
                effective_ranges.join(", ")
            ));
        }

        Ok(())
    }

    /// Apply this update to `current` in place.
    pub fn apply(self, current: &mut Settings) {
        if let Some(v) = self.monthly_summary_enabled {
            current.monthly_summary_enabled = v;
        }
        if let Some(v) = self.sankey_enabled {
            current.sankey_enabled = v;
        }
        if let Some(v) = self.reimbursements_enabled {
            current.reimbursements_enabled = v;
        }
        if let Some(v) = self.budget_comparison_enabled {
            current.budget_comparison_enabled = v;
        }
        if let Some(v) = self.avg_cost_enabled {
            current.avg_cost_enabled = v;
        }

        if let Some(v) = self.firefly_url {
            let t = v.trim().to_string();
            current.firefly_url = if t.is_empty() { None } else { Some(t) };
        }
        if let Some(v) = self.firefly_token {
            let t = v.trim().to_string();
            current.firefly_token = if t.is_empty() { None } else { Some(t) };
        }
        if let Some(v) = self.account_types {
            let t = v
                .iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            current.account_types = if t.is_empty() { None } else { Some(t) };
        }
        if let Some(v) = self.auto_fetch_accounts {
            current.auto_fetch_accounts = Some(v);
        }
        if let Some(v) = self.cache_ttl {
            current.cache_ttl = if v == 0 { None } else { Some(v) };
        }
        if let Some(v) = self.time_ranges {
            let t = v
                .iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            current.time_ranges = if t.is_empty() { None } else { Some(t) };
        }
        if let Some(v) = self.default_time_range {
            let t = v.trim().to_string();
            current.default_time_range = if t.is_empty() { None } else { Some(t) };
        }
    }
}
