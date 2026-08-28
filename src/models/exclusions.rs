use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// Categories and budgets that are entirely excluded from chart aggregation.
///
/// A category entry matches a journal when the journal's full category name
/// (e.g. `"Work Expenses:Reimbursed"`) either equals the entry or has the
/// entry as its parent (e.g. excluding `"Work Expenses"` also excludes every
/// subcategory of it). A budget entry matches when the journal's budget name
/// equals it.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct Exclusions {
    /// Excluded category names: parent names or full "Parent:Sub" names.
    #[serde(default)]
    pub categories: Vec<String>,
    /// Excluded budget names.
    #[serde(default)]
    pub budgets: Vec<String>,
}

impl Exclusions {
    pub fn new(categories: Vec<String>, budgets: Vec<String>) -> Self {
        Self {
            categories,
            budgets,
        }
    }

    /// True when nothing is excluded.
    pub fn is_empty(&self) -> bool {
        self.categories.is_empty() && self.budgets.is_empty()
    }

    /// Build a combined `Exclusions` from two sets (e.g. dashboard-level
    /// exclusions merged with widget-level exclusions).
    pub fn union(&self, other: &Exclusions) -> Exclusions {
        let mut categories = self.categories.clone();
        categories.extend(other.categories.iter().cloned());
        categories.dedup();
        let mut budgets = self.budgets.clone();
        budgets.extend(other.budgets.iter().cloned());
        budgets.dedup();
        Exclusions::new(categories, budgets)
    }

    /// True when the journal's category is excluded.
    /// `full_category` is the Firefly category name, e.g. `"Work Expenses"`
    /// or `"Work Expenses:Reimbursed"`.
    pub fn is_category_excluded(&self, full_category: &str) -> bool {
        if full_category.is_empty() || self.categories.is_empty() {
            return false;
        }
        if self.categories.iter().any(|c| c == full_category) {
            return true;
        }
        let parent = full_category.split(':').next().unwrap_or(full_category);
        self.categories.iter().any(|c| c == parent)
    }

    /// True when the journal's budget is excluded.
    pub fn is_budget_excluded(&self, budget_name: &str) -> bool {
        if self.budgets.is_empty() {
            return false;
        }
        self.budgets.iter().any(|b| b == budget_name)
    }

    /// True when a journal entry should be dropped from aggregation.
    pub fn is_journal_excluded(
        &self,
        category_name: Option<&str>,
        budget_name: Option<&str>,
    ) -> bool {
        let category_hit = category_name
            .map(|c| self.is_category_excluded(c))
            .unwrap_or(false);
        let budget_hit = budget_name
            .map(|b| self.is_budget_excluded(b))
            .unwrap_or(false);
        category_hit || budget_hit
    }

    /// Stable, compact representation used as part of cache keys.
    /// Empty string when no exclusions are configured so that cache keys
    /// stay identical to the pre-exclusion format.
    pub fn cache_key(&self) -> String {
        if self.is_empty() {
            return String::new();
        }
        let mut parts: Vec<String> = Vec::new();
        let cats: HashSet<&str> = self.categories.iter().map(|s| s.as_str()).collect();
        for c in cats.iter() {
            parts.push(format!("c={}", c));
        }
        let budgets: HashSet<&str> = self.budgets.iter().map(|s| s.as_str()).collect();
        for b in budgets.iter() {
            parts.push(format!("b={}", b));
        }
        parts.sort();
        parts.join("&")
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_exclusions_exclude_nothing() {
        let ex = Exclusions::default();
        assert!(ex.is_empty());
        assert!(!ex.is_category_excluded("Work Expenses"));
        assert!(!ex.is_category_excluded("Work Expenses:Reimbursed"));
        assert!(!ex.is_budget_excluded("Work"));
        assert!(!ex.is_journal_excluded(Some("Work Expenses"), Some("Work")));
        assert!(ex.cache_key().is_empty());
    }

    #[test]
    fn parent_exclusion_covers_subcategories() {
        let ex = Exclusions::new(vec!["Work Expenses".into()], vec![]);
        assert!(ex.is_category_excluded("Work Expenses"));
        assert!(ex.is_category_excluded("Work Expenses:Reimbursed"));
        assert!(!ex.is_category_excluded("Work"));
        assert!(!ex.is_category_excluded("Groceries"));
        assert!(!ex.is_category_excluded(""));
    }

    #[test]
    fn full_name_exclusion_is_exact() {
        let ex = Exclusions::new(vec!["Work Expenses:Reimbursed".into()], vec![]);
        assert!(ex.is_category_excluded("Work Expenses:Reimbursed"));
        assert!(!ex.is_category_excluded("Work Expenses:Other"));
        assert!(!ex.is_category_excluded("Work Expenses"));
    }

    #[test]
    fn budget_exclusion_is_exact() {
        let ex = Exclusions::new(vec![], vec!["Work".into()]);
        assert!(ex.is_budget_excluded("Work"));
        assert!(!ex.is_budget_excluded("Work Expenses"));
        assert!(!ex.is_budget_excluded("Unbudgeted"));
    }

    #[test]
    fn journal_exclusion_matches_either_dimension() {
        let ex = Exclusions::new(vec!["Work Expenses".into()], vec!["Work".into()]);
        assert!(ex.is_journal_excluded(Some("Work Expenses:Reimbursed"), None));
        assert!(ex.is_journal_excluded(None, Some("Work")));
        assert!(ex.is_journal_excluded(Some("Work Expenses"), Some("Work")));
        assert!(!ex.is_journal_excluded(Some("Groceries"), Some("Groceries Budget")));
        assert!(!ex.is_journal_excluded(None, None));
        // Category not excluded but budget excluded -> dropped
        assert!(ex.is_journal_excluded(Some("Groceries:Home"), Some("Work")));
        // Neither matches -> kept
        assert!(!ex.is_journal_excluded(Some("Groceries:Home"), Some("Dining")));
    }

    #[test]
    fn union_merges_and_dedupes() {
        let a = Exclusions::new(vec!["A".into(), "B".into()], vec!["X".into()]);
        let b = Exclusions::new(vec!["B".into(), "C".into()], vec!["X".into(), "Y".into()]);
        let merged = a.union(&b);
        assert_eq!(
            merged.categories,
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
        assert_eq!(merged.budgets, vec!["X".to_string(), "Y".to_string()]);
    }

    #[test]
    fn cache_key_is_sorted_and_stable() {
        let ex1 = Exclusions::new(vec!["B".into(), "A".into()], vec!["X".into()]);
        let ex2 = Exclusions::new(vec!["A".into(), "B".into(), "B".into()], vec!["X".into()]);
        assert_eq!(ex1.cache_key(), ex2.cache_key());
        assert_eq!(ex1.cache_key(), "b=X&c=A&c=B");
    }

    #[test]
    fn exclusions_round_trip_json() {
        let json = r#"{"categories": ["Work Expenses"], "budgets": ["Work"]}"#;
        let ex: Exclusions = serde_json::from_str(json).unwrap();
        assert_eq!(ex.categories, vec!["Work Expenses".to_string()]);
        assert_eq!(ex.budgets, vec!["Work".to_string()]);
        // Legacy payloads without the fields default to empty
        let legacy: Exclusions = serde_json::from_str("{}").unwrap();
        assert!(legacy.is_empty());
    }
}
