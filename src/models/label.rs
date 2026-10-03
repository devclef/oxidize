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
}
