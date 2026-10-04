//! User-defined spending labels (see plans/spending-labels.md).
//!
//! A *label* is a named lens over Firefly III categories, e.g. "wants" or
//! "needs". Each label's `entries` are category names with exactly the same
//! matching semantics as the existing category exclusions:
//!
//! - `"Groceries"` matches the whole category (every subcategory)
//! - `"Dining:Restaurants"` matches only that subcategory
//!
//! Labels are perspectives, not partitions: a category may belong to
//! several labels, and spend matching several labels is counted in each of
//! them. Spend that matches no label (including uncategorized spend) is
//! reported as "Unlabeled".

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One user-defined label. Persisted in the `labels` table of Oxidize's
/// own SQLite database; Firefly III is never modified.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Label {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub color: Option<String>,
    /// Category name patterns: parent names (whole category) or full
    /// "Parent:Sub" names (single subcategory).
    pub entries: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

impl Label {
    pub fn new(id: String, name: String, entries: Vec<String>) -> Self {
        Self {
            id,
            name,
            description: String::new(),
            color: None,
            entries,
            created_at: None,
            updated_at: None,
        }
    }
}

/// Whether a label entry matches a journal's full category name.
///
/// "Dining" matches "Dining" and "Dining:Bars"; "Dining:Bars" matches only
/// "Dining:Bars". Comparison is exact (case-sensitive), matching the
/// exclusion behavior.
pub fn entry_matches(entry: &str, full_category: &str) -> bool {
    let entry = entry.trim();
    let full = full_category.trim();
    if entry.is_empty() || full.is_empty() {
        return false;
    }
    if entry == full {
        return true;
    }
    // Entry is a parent name covering all of its subcategories:
    // "Dining" must match "Dining:Bars" but not "DiningRoom".
    full.strip_prefix(entry)
        .and_then(|rest| rest.strip_prefix(':'))
        .is_some()
}

/// Names of all labels whose entries match the given full category name.
pub fn matching_label_names(full_category: &str, labels: &[Label]) -> Vec<String> {
    let mut out = Vec::new();
    for label in labels {
        if label
            .entries
            .iter()
            .any(|e| entry_matches(e, full_category))
        {
            out.push(label.name.clone());
        }
    }
    out
}

/// Result of classifying a set of spend amounts against labels.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ClassifiedSpend {
    /// Sum of every (labeled and unlabeled) amount.
    pub total: f64,
    /// Amount per label; only labels with amount > 0 are present.
    /// Sum may exceed `total` when labels overlap.
    pub by_label: BTreeMap<String, f64>,
    /// Amount matching no label at all (includes uncategorized spend).
    pub unlabeled: f64,
}

/// Classify spend amounts against labels.
///
/// `entries` are (full category name, amount) pairs; a `None`/empty
/// category is spend without a category and can never be labeled.
pub fn classify(entries: &[(Option<String>, f64)], labels: &[Label]) -> ClassifiedSpend {
    let mut result = ClassifiedSpend::default();
    for (category, amount) in entries {
        result.total += amount;
        let Some(cat) = category.as_deref().filter(|c| !c.trim().is_empty()) else {
            result.unlabeled += amount;
            continue;
        };
        let mut matched = false;
        for label in labels {
            if label.entries.iter().any(|e| entry_matches(e, cat)) {
                *result.by_label.entry(label.name.clone()).or_insert(0.0) += amount;
                matched = true;
            }
        }
        if !matched {
            result.unlabeled += amount;
        }
    }
    result
}

/// One label's share of a budget's spend in a period.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LabelPart {
    pub label: String,
    pub color: Option<String>,
    pub amount: f64,
    /// amount / total * 100 (0 when total is 0).
    pub pct: f64,
}

/// One category's share of a budget's spend in a period.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LabelCategoryPart {
    /// Full category name as stored on the journal ("Parent:Sub", or the
    /// plain parent name when the category has no subcategory).
    pub category: String,
    pub amount: f64,
    /// amount / total * 100 (0 when total is 0).
    pub pct: f64,
    /// Names of the labels matching this category (empty = unlabeled).
    pub labels: Vec<String>,
}

/// How a single budget's spend is composed of labels in a period.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct LabelBudgetComposition {
    pub budget: String,
    pub start: String,
    pub end: String,
    /// Total spend in the budget for the period.
    pub total: f64,
    /// Total spend matching at least one label (total - unlabeled).
    pub labeled: f64,
    /// One entry per label with spend, plus an implicit "Unlabeled" entry
    /// when the remainder is > 0. Sorted by amount, descending.
    pub parts: Vec<LabelPart>,
    /// One entry per category with spend in the budget, sorted by amount
    /// descending. Categories without matching labels have `labels: []`.
    pub by_category: Vec<LabelCategoryPart>,
    pub currency_code: Option<String>,
    pub currency_symbol: Option<String>,
}

/// Build the parts list (per label + implicit "Unlabeled") for a
/// composition report. Pure so it can be unit tested.
pub fn composition_parts(
    labels: &[Label],
    by_label: &BTreeMap<String, f64>,
    total: f64,
    unlabeled: f64,
) -> Vec<LabelPart> {
    let pct = |amount: f64| {
        if total > 0.0 {
            amount / total * 100.0
        } else {
            0.0
        }
    };
    let mut parts: Vec<LabelPart> = labels
        .iter()
        .filter_map(|l| {
            by_label.get(&l.name).map(|amount| LabelPart {
                label: l.name.clone(),
                color: l.color.clone(),
                amount: *amount,
                pct: pct(*amount),
            })
        })
        .collect();
    if unlabeled > 0.0 {
        parts.push(LabelPart {
            label: "Unlabeled".to_string(),
            color: None,
            amount: unlabeled,
            pct: pct(unlabeled),
        });
    }
    parts.sort_by(|a, b| {
        b.amount
            .partial_cmp(&a.amount)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    parts
}

/// One unlabeled category: spend in a period that matches no label,
/// grouped by full category name.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnlabeledCategory {
    /// Full category name as stored on the journal ("Parent:Sub", or the
    /// plain parent name when the category has no subcategory).
    pub category: String,
    pub amount: f64,
    /// amount / total * 100 (0 when total is 0).
    pub pct: f64,
    /// Names of the budgets this spend was charged to, sorted and
    /// deduplicated. Always non-empty for client data: unbudgeted spend is
    /// excluded before aggregation.
    pub budgets: Vec<String>,
}

/// Every spend category of a period that matches no user label, across
/// all budgets at once. Categories matching at least one label are
/// omitted entirely; spend without a category is counted in
/// `uncategorized` and can never be labeled.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnlabeledCategoriesReport {
    pub start: String,
    pub end: String,
    /// Total spend in the period (after account/budget/exclusion filters).
    pub total: f64,
    /// Spend matching no label at all (includes uncategorized spend).
    pub unlabeled: f64,
    /// Spend without a category (subset of `unlabeled`; not labelable).
    pub uncategorized: f64,
    /// Categories matching no label, sorted by amount descending.
    pub categories: Vec<UnlabeledCategory>,
    pub currency_code: Option<String>,
    pub currency_symbol: Option<String>,
}

/// Aggregate spend items into the unlabeled-categories report.
///
/// `items` are (full category name or None, amount, budget name or None)
/// triples, already filtered to spent journals. Pure so it can be unit
/// tested; the transaction parsing lives in the client.
pub fn unlabeled_report(
    start: String,
    end: String,
    items: &[(Option<String>, f64, Option<String>)],
    labels: &[Label],
    currency_code: Option<String>,
    currency_symbol: Option<String>,
) -> UnlabeledCategoriesReport {
    use std::collections::BTreeSet;

    let mut total = 0.0;
    let mut unlabeled = 0.0;
    let mut uncategorized = 0.0;
    let mut by_category: BTreeMap<String, (f64, BTreeSet<String>)> = BTreeMap::new();

    for (category, amount, budget) in items {
        total += amount;
        let Some(cat) = category.as_deref().filter(|c| !c.trim().is_empty()) else {
            // No category at all: never labelable.
            unlabeled += amount;
            uncategorized += amount;
            continue;
        };
        let labeled = labels
            .iter()
            .any(|l| l.entries.iter().any(|e| entry_matches(e, cat)));
        if labeled {
            continue;
        }
        unlabeled += amount;
        let entry = by_category
            .entry(cat.to_string())
            .or_insert((0.0, BTreeSet::new()));
        entry.0 += amount;
        if let Some(b) = budget.as_deref().filter(|b| !b.trim().is_empty()) {
            entry.1.insert(b.to_string());
        }
    }

    let mut categories: Vec<UnlabeledCategory> = by_category
        .into_iter()
        .map(|(category, (amount, budgets))| UnlabeledCategory {
            category,
            amount,
            pct: if total > 0.0 {
                amount / total * 100.0
            } else {
                0.0
            },
            budgets: budgets.into_iter().collect(),
        })
        .collect();
    categories.sort_by(|a, b| {
        b.amount
            .partial_cmp(&a.amount)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    UnlabeledCategoriesReport {
        start,
        end,
        total,
        unlabeled,
        uncategorized,
        categories,
        currency_code,
        currency_symbol,
    }
}

/// One transaction matching a label's category entries (OXI-48): the
/// drill-down behind the label aggregates.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LabelTransaction {
    /// Firefly III journal entry id (stable across refetches).
    pub id: String,
    /// "YYYY-MM-DD" as reported by Firefly III.
    pub date: String,
    /// Signed Firefly III amount (negative = spend).
    pub amount: f64,
    /// Full category name as stored on the journal.
    pub category: Option<String>,
    /// Budget the spend was charged to, if any.
    pub budget: Option<String>,
    /// Payee name from the transaction, if any.
    pub payee: Option<String>,
    /// Transaction description.
    pub description: Option<String>,
    /// Name of the account the money went out of (the spend journal's
    /// source account).
    pub account: Option<String>,
}

/// Every transaction of one label in a period.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct LabelTransactions {
    /// Name of the label the list was built for.
    pub label: String,
    pub start: String,
    pub end: String,
    /// Number of listed transactions.
    pub count: usize,
    /// Positive total spend for the listed transactions (Firefly III
    /// reports spend amounts as negative).
    pub total: f64,
    pub currency_symbol: Option<String>,
    pub currency_code: Option<String>,
    /// Sorted by date, newest first.
    pub transactions: Vec<LabelTransaction>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(name: &str, entries: &[&str]) -> Label {
        let mut l = Label::new(name.to_string(), name.to_string(), Vec::new());
        l.entries = entries.iter().map(|s| s.to_string()).collect();
        l
    }

    #[test]
    fn entry_matching_exact_and_parent() {
        assert!(entry_matches("Groceries", "Groceries"));
        assert!(entry_matches("Dining", "Dining:Bars"));
        assert!(entry_matches("Dining:Bars", "Dining:Bars"));
        // Parent entry must not swallow similarly-named categories.
        assert!(!entry_matches("Dining", "DiningRoom"));
        assert!(!entry_matches("Dining:Bars", "Dining:Bars&Grill"));
        assert!(!entry_matches("Dining:Bars", "Dining"));
        assert!(!entry_matches("", "Dining"));
        assert!(!entry_matches("Dining", ""));
    }

    #[test]
    fn matching_label_names_finds_all_overlapping() {
        let labels = vec![
            label("wants", &["Dining:Bars"]),
            label("fun", &["Dining", "Toys"]),
        ];
        let names = matching_label_names("Dining:Bars", &labels);
        assert_eq!(names, vec!["wants", "fun"]);
        assert_eq!(matching_label_names("Toys", &labels), vec!["fun"]);
        assert!(matching_label_names("Groceries", &labels).is_empty());
    }

    #[test]
    fn classify_counts_overlap_in_each_label() {
        let labels = vec![
            label("wants", &["Dining:Bars"]),
            label("needs", &["Groceries"]),
        ];
        let entries = vec![
            (Some("Dining:Bars".to_string()), 100.0),
            (Some("Groceries".to_string()), 50.0),
            (Some("Health".to_string()), 25.0),
            (None, 15.0),
        ];
        let r = classify(&entries, &labels);
        assert!((r.total - 190.0).abs() < 1e-9);
        assert!((r.by_label["wants"] - 100.0).abs() < 1e-9);
        assert!((r.by_label["needs"] - 50.0).abs() < 1e-9);
        // Health (no label) + uncategorized (15) = 40 unlabeled.
        assert!((r.unlabeled - 40.0).abs() < 1e-9);
    }

    #[test]
    fn classify_with_no_labels_is_all_unlabeled() {
        let entries = vec![(Some("Groceries".to_string()), 50.0)];
        let r = classify(&entries, &[]);
        assert!((r.total - 50.0).abs() < 1e-9);
        assert!(r.by_label.is_empty());
        assert!((r.unlabeled - 50.0).abs() < 1e-9);
    }

    #[test]
    fn composition_parts_sorts_and_includes_unlabeled() {
        let labels = vec![label("wants", &["Dining"]), label("needs", &["Groceries"])];
        let mut by_label = BTreeMap::new();
        by_label.insert("wants".to_string(), 400.0);
        by_label.insert("needs".to_string(), 600.0);
        let parts = composition_parts(&labels, &by_label, 1000.0, 100.0);
        assert_eq!(
            parts.iter().map(|p| p.label.as_str()).collect::<Vec<_>>(),
            vec!["needs", "wants", "Unlabeled"]
        );
        assert!((parts[0].pct - 60.0).abs() < 1e-9);
        assert!((parts[1].pct - 40.0).abs() < 1e-9);
        assert!((parts[2].pct - 10.0).abs() < 1e-9);
        assert!(parts[2].color.is_none());
    }

    #[test]
    fn composition_parts_omits_zero_labels_and_zero_unlabeled() {
        let labels = vec![label("wants", &["Dining"])];
        let mut by_label = BTreeMap::new();
        by_label.insert("wants".to_string(), 100.0);
        let parts = composition_parts(&labels, &by_label, 100.0, 0.0);
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].label, "wants");
    }

    #[test]
    fn composition_parts_zero_total_has_zero_pct() {
        let labels = vec![label("wants", &["Dining"])];
        let by_label = BTreeMap::new();
        let parts = composition_parts(&labels, &by_label, 0.0, 0.0);
        assert!(parts.is_empty());
    }

    #[test]
    fn unlabeled_report_drops_labeled_and_tracks_budgets() {
        let labels = vec![
            label("wants", &["Dining"]),
            label("needs", &["Groceries:Supermarkets"]),
        ];
        let items = vec![
            (
                Some("Dining:Bars".to_string()),
                100.0,
                Some("Food".to_string()),
            ),
            (
                Some("Groceries:Supermarkets".to_string()),
                200.0,
                Some("Food".to_string()),
            ),
            (Some("Health".to_string()), 50.0, Some("Food".to_string())),
            (Some("Dining".to_string()), 30.0, Some("Travel".to_string())),
            (
                Some("Groceries:DiscountStore".to_string()),
                80.0,
                Some("Travel".to_string()),
            ),
            (None, 20.0, Some("Food".to_string())),
            (Some("Health".to_string()), 10.0, Some("Travel".to_string())),
        ];
        let r = unlabeled_report(
            "2026-01-01".to_string(),
            "2026-01-31".to_string(),
            &items,
            &labels,
            Some("USD".to_string()),
            Some("$".to_string()),
        );
        assert!((r.total - 490.0).abs() < 1e-9);
        // Health 50+10, DiscountStore 80, uncategorized 20.
        assert!((r.unlabeled - 160.0).abs() < 1e-9);
        assert!((r.uncategorized - 20.0).abs() < 1e-9);
        assert_eq!(
            r.categories
                .iter()
                .map(|c| c.category.as_str())
                .collect::<Vec<_>>(),
            vec!["Groceries:DiscountStore", "Health"]
        );
        let health = &r.categories[1];
        assert!((health.amount - 60.0).abs() < 1e-9);
        assert_eq!(
            health.budgets,
            vec!["Food".to_string(), "Travel".to_string()]
        );
        assert!((health.pct - 60.0 / 490.0 * 100.0).abs() < 1e-9);
        assert!((r.categories[0].pct - 80.0 / 490.0 * 100.0).abs() < 1e-9);
        assert_eq!(r.categories[0].budgets, vec!["Travel".to_string()]);
        assert_eq!(r.currency_code.as_deref(), Some("USD"));
    }

    #[test]
    fn unlabeled_report_with_no_labels_lists_everything() {
        let items = vec![
            (Some("A".to_string()), 5.0, None),
            (Some("B".to_string()), 7.0, Some("x".to_string())),
        ];
        let r = unlabeled_report("s".to_string(), "e".to_string(), &items, &[], None, None);
        assert!((r.total - 12.0).abs() < 1e-9);
        assert!((r.unlabeled - 12.0).abs() < 1e-9);
        assert!((r.uncategorized - 0.0).abs() < 1e-9);
        assert_eq!(r.categories.len(), 2);
        assert_eq!(r.categories[0].category, "B");
        assert!(r.categories[1].budgets.is_empty());
    }

    #[test]
    fn unlabeled_report_zero_total_has_zero_pct() {
        let r = unlabeled_report("s".to_string(), "e".to_string(), &[], &[], None, None);
        assert!(r.categories.is_empty());
        assert!((r.total - 0.0).abs() < 1e-9);
    }
}
