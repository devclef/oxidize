pub mod account;
pub mod avg_cost;
pub mod settings;

use crate::models::Exclusions;

/// Parse `exclude_categories[]` / `exclude_budgets[]` (and their
/// bracket-less variants) from a decoded query string into an `Exclusions`.
pub fn parse_exclusions(params: &[(String, String)]) -> Exclusions {
    let mut categories = Vec::new();
    let mut budgets = Vec::new();
    for (k, v) in params {
        match k.as_str() {
            "exclude_categories[]" | "exclude_categories" => categories.push(v.clone()),
            "exclude_budgets[]" | "exclude_budgets" => budgets.push(v.clone()),
            _ => {}
        }
    }
    Exclusions::new(categories, budgets)
}
pub mod budget_comparison;
pub mod category;
pub mod dashboard;
pub mod dashboard_api;
pub mod group;
pub mod index;
pub mod widget;

pub mod reimbursement;
pub mod sankey;
pub mod summary;

/// Remove the "Monthly Summary" nav link from a page's HTML. Pure helper so
/// it can be tested without a database.
pub fn strip_summary_nav(html: &str) -> String {
    html.replace(
        "<a href=\"/summary\" class=\"active\">Monthly Summary</a>",
        "",
    )
    .replace("<a href=\"/summary\">Monthly Summary</a>", "")
}

/// Remove the "Monthly Summary" nav link from a page's HTML when that
/// feature is disabled in the runtime settings. Returns the HTML unchanged
/// when the feature is enabled (or settings cannot be read: in that case
/// the summary page itself would 404 anyway).
pub fn hide_summary_nav_if_disabled(html: &str) -> String {
    let enabled = crate::storage::Storage::get_settings()
        .map(|s| s.monthly_summary_enabled)
        .unwrap_or(false);
    if enabled {
        html.to_string()
    } else {
        strip_summary_nav(html)
    }
}
