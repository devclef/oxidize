//! Types for the Reimbursements page (`/reimbursements`,
//! `/api/reimbursements/summary`).
//!
//! Tracks work expenses (spent journals whose category or budget matches
//! user-configured markers) against reimbursements (earned journals whose
//! category matches user-configured markers), bucketed by calendar month.
//!
//! All monetary values are **positive magnitudes**: Firefly journal amounts
//! are signed (the withdrawal side is negative), so the aggregation takes
//! `abs()`. `net = reimbursed - spent`; a negative net is money still owed.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::client::{journal_counts_earned, journal_counts_spent, journal_exclusion_names};
use crate::models::Exclusions;

/// One calendar month of the period.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ReimbursementMonth {
    /// "YYYY-MM", chronological.
    pub label: String,
    /// Work expenses spent in the month (positive).
    pub spent: f64,
    /// Reimbursed in the month (positive).
    pub reimbursed: f64,
    /// reimbursed - spent (negative = still owed).
    pub net: f64,
}

/// One row of a breakdown list: a (category, budget) group of work expenses,
/// or a category group of reimbursements (`budget` is then `None`).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ReimbursementBreakdownItem {
    /// Full Firefly category name (`"Parent:Sub"`), or `"Uncategorized"`.
    pub category: String,
    /// Budget name when the journals carry one.
    pub budget: Option<String>,
    /// Summed positive amount.
    pub amount: f64,
}

/// Response for GET /api/reimbursements/summary.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ReimbursementSummary {
    /// "YYYY-MM-DD" (inclusive), as requested / defaulted.
    pub start: String,
    /// "YYYY-MM-DD" (inclusive), as requested / defaulted.
    pub end: String,
    /// Total work expenses over the period (positive).
    pub spent: f64,
    /// Total reimbursements over the period (positive).
    pub reimbursed: f64,
    /// reimbursed - spent (negative = still owed).
    pub net: f64,
    /// reimbursed / spent * 100, or None when spent is 0.
    pub pct_reimbursed: Option<f64>,
    /// One bucket per calendar month in [start, end], even empty months.
    pub months: Vec<ReimbursementMonth>,
    /// Work expenses grouped by (category, budget), amount desc.
    pub expense_breakdown: Vec<ReimbursementBreakdownItem>,
    /// Reimbursements grouped by category, amount desc.
    pub reimbursement_breakdown: Vec<ReimbursementBreakdownItem>,
    pub currency_code: Option<String>,
    pub currency_symbol: Option<String>,
}

/// "YYYY-MM" labels for every calendar month in [start, end] (inclusive).
///
/// Pure and unit-testable (no I/O, no "now"): handles ranges that cross a
/// year boundary and single-day ranges.
pub fn month_bucket_labels(start: NaiveDate, end: NaiveDate) -> Vec<String> {
    let mut labels = Vec::new();
    let mut cursor = start;
    while cursor <= end {
        labels.push(format!("{:04}-{:02}", cursor.year(), cursor.month()));
        cursor = next_month_first_day(cursor);
    }
    labels
}

/// First day of the month after `d`.
fn next_month_first_day(d: NaiveDate) -> NaiveDate {
    if d.month() == 12 {
        NaiveDate::from_ymd_opt(d.year() + 1, 1, 1).expect("valid first of January")
    } else {
        NaiveDate::from_ymd_opt(d.year(), d.month() + 1, 1).expect("valid first of month")
    }
}

/// True when the journal is a *spent* journal (see `journal_counts_spent`)
/// and its category or budget matches the work-expense markers.
pub fn is_work_expense(journal: &serde_json::Value, expense_markers: &Exclusions) -> bool {
    let selected: std::collections::HashSet<String> = std::collections::HashSet::new();
    if !journal_counts_spent(journal, &selected) {
        return false;
    }
    let (category, budget) = journal_exclusion_names(journal);
    expense_markers.is_journal_excluded(category, budget)
}

/// True when the journal is an *earned* journal (see `journal_counts_earned`)
/// and its category matches one of the reimbursement markers.
pub fn is_reimbursement(journal: &serde_json::Value, reimbursement_markers: &Exclusions) -> bool {
    let selected: std::collections::HashSet<String> = std::collections::HashSet::new();
    if !journal_counts_earned(journal, &selected) {
        return false;
    }
    let (category, _) = journal_exclusion_names(journal);
    reimbursement_markers.is_journal_excluded(category, None)
}

/// reimbursed / spent * 100, or None when spent is 0 (avoid div-by-zero).
pub fn pct_reimbursed(reimbursed: f64, spent: f64) -> Option<f64> {
    if spent > 0.0 {
        Some(reimbursed / spent * 100.0)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    /// Minimal journal fixture. `amount` signed like the Firefly API
    /// (withdrawal side negative, deposit side positive).
    #[allow(clippy::too_many_arguments)] // fixture helper: one arg per field
    fn journal(
        jtype: &str,
        amount: &str,
        category: Option<&str>,
        budget: Option<&str>,
        source: &str,
        dest: &str,
    ) -> serde_json::Value {
        json!({
            "type": jtype,
            "amount": amount,
            "category_name": category.unwrap_or(""),
            "budget_name": budget.unwrap_or(""),
            "source_id": source,
            "destination_id": dest,
            "date": "2026-08-15T12:00:00.000000",
        })
    }

    // ── month_bucket_labels ────────────────────────────────────────────

    #[test]
    fn test_month_labels_single_month() {
        assert_eq!(
            month_bucket_labels(d("2026-08-10"), d("2026-08-20")),
            vec!["2026-08"]
        );
    }

    #[test]
    fn test_month_labels_partial_range() {
        assert_eq!(
            month_bucket_labels(d("2026-07-15"), d("2026-09-10")),
            vec!["2026-07", "2026-08", "2026-09"]
        );
    }

    #[test]
    fn test_month_labels_crosses_year_boundary() {
        assert_eq!(
            month_bucket_labels(d("2025-12-01"), d("2026-01-31")),
            vec!["2025-12", "2026-01"]
        );
    }

    #[test]
    fn test_month_labels_single_day() {
        assert_eq!(
            month_bucket_labels(d("2026-02-28"), d("2026-02-28")),
            vec!["2026-02"]
        );
    }

    // ── is_work_expense ────────────────────────────────────────────────

    #[test]
    fn test_work_expense_withdrawal_in_marked_category() {
        let markers = Exclusions::new(vec!["Work".to_string()], vec![]);
        let j = journal("withdrawal", "-100.00", Some("Work"), None, "1", "2");
        assert!(is_work_expense(&j, &markers));
    }

    #[test]
    fn test_work_expense_parent_marker_covers_subcategory() {
        let markers = Exclusions::new(vec!["Work".to_string()], vec![]);
        let j = journal("withdrawal", "-100.00", Some("Work:Travel"), None, "1", "2");
        assert!(is_work_expense(&j, &markers));
    }

    #[test]
    fn test_work_expense_subcategory_marker_matches_exact_only() {
        let markers = Exclusions::new(vec!["Work:Travel".to_string()], vec![]);
        // Exact subcategory match
        let j = journal("withdrawal", "-100.00", Some("Work:Travel"), None, "1", "2");
        assert!(is_work_expense(&j, &markers));
        // Sibling subcategory must NOT match
        let j2 = journal("withdrawal", "-50.00", Some("Work:Meals"), None, "1", "2");
        assert!(!is_work_expense(&j2, &markers));
        // Parent-only journal does not match a sub-only marker
        let j3 = journal("withdrawal", "-50.00", Some("Work"), None, "1", "2");
        assert!(!is_work_expense(&j3, &markers));
    }

    #[test]
    fn test_work_expense_budget_marker_matches() {
        let markers = Exclusions::new(vec![], vec!["Client X".to_string()]);
        // Category is unmarked, budget is marked -> work expense
        let j = journal(
            "withdrawal",
            "-100.00",
            Some("Groceries"),
            Some("Client X"),
            "1",
            "2",
        );
        assert!(is_work_expense(&j, &markers));
        // Same category, unmarked budget -> not
        let j2 = journal("withdrawal", "-100.00", Some("Groceries"), None, "1", "2");
        assert!(!is_work_expense(&j2, &markers));
    }

    #[test]
    fn test_work_expense_neither_marker_matches() {
        let markers = Exclusions::new(vec!["Work".to_string()], vec!["Client X".to_string()]);
        let j = journal("withdrawal", "-100.00", Some("Groceries"), None, "1", "2");
        assert!(!is_work_expense(&j, &markers));
    }

    #[test]
    fn test_work_expense_earned_journals_never_count() {
        let markers = Exclusions::new(vec!["Work".to_string()], vec![]);
        let deposit = journal("deposit", "100.00", Some("Work"), None, "1", "2");
        assert!(!is_work_expense(&deposit, &markers));
    }

    #[test]
    fn test_work_expense_transfer_never_counts_without_selection() {
        let markers = Exclusions::new(vec!["Work".to_string()], vec![]);
        let transfer = journal("transfer", "-100.00", Some("Work"), None, "1", "2");
        assert!(!is_work_expense(&transfer, &markers));
    }

    // ── is_reimbursement ───────────────────────────────────────────────

    #[test]
    fn test_reimbursement_deposit_in_marked_category() {
        let markers = Exclusions::new(vec!["Reimbursed".to_string()], vec![]);
        let j = journal("deposit", "500.00", Some("Reimbursed"), None, "1", "2");
        assert!(is_reimbursement(&j, &markers));
    }

    #[test]
    fn test_reimbursement_parent_marker_covers_subcategory() {
        let markers = Exclusions::new(vec!["Reimbursed".to_string()], vec![]);
        let j = journal(
            "deposit",
            "500.00",
            Some("Reimbursed:2026-08"),
            None,
            "1",
            "2",
        );
        assert!(is_reimbursement(&j, &markers));
    }

    #[test]
    fn test_reimbursement_unmarked_category_never_counts() {
        let markers = Exclusions::new(vec!["Reimbursed".to_string()], vec![]);
        let j = journal("deposit", "500.00", Some("Salary"), None, "1", "2");
        assert!(!is_reimbursement(&j, &markers));
        let uncategorized = journal("deposit", "500.00", None, None, "1", "2");
        assert!(!is_reimbursement(&uncategorized, &markers));
    }

    #[test]
    fn test_reimbursement_spent_journals_never_count() {
        let markers = Exclusions::new(vec!["Work".to_string()], vec![]);
        let withdrawal = journal("withdrawal", "-500.00", Some("Work"), None, "1", "2");
        assert!(!is_reimbursement(&withdrawal, &markers));
    }

    // ── pct_reimbursed ─────────────────────────────────────────────────

    #[test]
    fn test_pct_reimbursed_math() {
        assert!((pct_reimbursed(85.0, 100.0).unwrap() - 85.0).abs() < 1e-9);
        assert!((pct_reimbursed(120.0, 100.0).unwrap() - 120.0).abs() < 1e-9);
        assert!(pct_reimbursed(50.0, 0.0).is_none());
    }
}
