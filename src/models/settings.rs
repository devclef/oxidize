//! User settings that can be changed at runtime from the /settings page.
//!
//! Settings persist in the SQLite `settings` table. Any key that has not
//! been saved yet falls back to the default in [`Settings::default`].

use serde::{Deserialize, Serialize};

/// Runtime user settings.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Whether the Monthly Summary page is available. Default: disabled, so
    /// the page and its nav link are hidden until explicitly enabled.
    pub monthly_summary_enabled: bool,
}

impl Settings {
    /// Build settings from raw key/value rows, applying defaults for any
    /// missing keys.
    pub fn from_rows(rows: &std::collections::HashMap<String, String>) -> Self {
        let mut s = Self::default();
        if let Some(v) = rows.get("monthly_summary_enabled") {
            s.monthly_summary_enabled = v == "true" || v == "1";
        }
        s
    }

    /// Serialize the settings to raw key/value rows for storage.
    pub fn to_rows(&self) -> std::collections::HashMap<String, String> {
        let mut rows = std::collections::HashMap::new();
        rows.insert(
            "monthly_summary_enabled".to_string(),
            self.monthly_summary_enabled.to_string(),
        );
        rows
    }
}

/// Partial update body for `PATCH /api/settings`. Only the provided fields
/// are changed.
#[derive(Clone, Debug, Deserialize, Default)]
pub struct SettingsUpdate {
    pub monthly_summary_enabled: Option<bool>,
}

impl SettingsUpdate {
    /// Apply this update to `current` in place.
    pub fn apply(self, current: &mut Settings) {
        if let Some(v) = self.monthly_summary_enabled {
            current.monthly_summary_enabled = v;
        }
    }
}
