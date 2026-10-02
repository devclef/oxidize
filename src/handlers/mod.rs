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
pub mod label;
pub mod widget;

pub mod reimbursement;
pub mod sankey;
pub mod summary;

/// Remove one nav link (plain and `class="active"` variants) from a
/// page's HTML. Pure helper so it can be tested without a database.
pub fn strip_nav_link(html: &str, href: &str, label: &str) -> String {
    html.replace(
        &format!(r#"<a href="{href}" class="active">{label}</a>"#),
        "",
    )
    .replace(&format!(r#"<a href="{href}">{label}</a>"#), "")
}

/// Remove the "Monthly Summary" nav link from a page's HTML. Pure helper so
/// it can be tested without a database.
pub fn strip_summary_nav(html: &str) -> String {
    strip_nav_link(html, "/summary", "Monthly Summary")
}

/// Remove the nav links of all optional features that are disabled in the
/// runtime settings. Links of enabled features are kept. When settings
/// cannot be read, only links whose built-in default is off (Monthly
/// Summary) are stripped — the other pages would be served anyway.
pub fn hide_disabled_nav(html: &str) -> String {
    match crate::storage::Storage::get_settings() {
        Ok(s) => {
            let mut out = html.to_string();
            if !s.monthly_summary_enabled {
                out = strip_nav_link(&out, "/summary", "Monthly Summary");
            }
            if !s.sankey_enabled {
                out = strip_nav_link(&out, "/sankey", "Sankey Flow");
            }
            if !s.reimbursements_enabled {
                out = strip_nav_link(&out, "/reimbursements", "Reimbursements");
            }
            if !s.budget_comparison_enabled {
                out = strip_nav_link(&out, "/budget-comparison", "Budget Comparison");
            }
            if !s.avg_cost_enabled {
                out = strip_nav_link(&out, "/avg-cost", "Avg Cost");
            }
            if !s.labels_enabled {
                out = strip_nav_link(&out, "/labels", "Spending Labels");
            }
            out
        }
        Err(_) => strip_summary_nav(html),
    }
}
