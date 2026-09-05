pub mod account;
pub mod avg_cost;

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

pub mod monthly_summary;
pub mod sankey;
