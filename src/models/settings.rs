//! User settings that can be changed at runtime from the /settings page.
//!
//! Settings persist in the SQLite `settings` table. Any key that has not
//! been saved yet falls back to the default in [`Settings::default`].
//!
//! Feature flags are **enabled by default** so a fresh install behaves
//! exactly like the always-on pages; `monthly_summary_enabled` is the
//! one exception (off by default).

use serde::{Deserialize, Serialize};

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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            monthly_summary_enabled: false,
            sankey_enabled: true,
            reimbursements_enabled: true,
            budget_comparison_enabled: true,
            avg_cost_enabled: true,
        }
    }
}

impl Settings {
    /// Build settings from raw key/value rows, applying defaults for any
    /// missing keys.
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
        s
    }

    /// Serialize the settings to raw key/value rows for storage.
    pub fn to_rows(&self) -> std::collections::HashMap<String, String> {
        [
            ("monthly_summary_enabled", self.monthly_summary_enabled),
            ("sankey_enabled", self.sankey_enabled),
            ("reimbursements_enabled", self.reimbursements_enabled),
            ("budget_comparison_enabled", self.budget_comparison_enabled),
            ("avg_cost_enabled", self.avg_cost_enabled),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }
}

/// Partial update body for `PATCH /api/settings`. Only the provided fields
/// are changed.
#[derive(Clone, Debug, Deserialize, Default)]
pub struct SettingsUpdate {
    pub monthly_summary_enabled: Option<bool>,
    pub sankey_enabled: Option<bool>,
    pub reimbursements_enabled: Option<bool>,
    pub budget_comparison_enabled: Option<bool>,
    pub avg_cost_enabled: Option<bool>,
}

impl SettingsUpdate {
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
    }
}
