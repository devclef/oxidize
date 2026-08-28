use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Dashboard {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    /// Categories/budgets globally excluded from every widget on this
    /// dashboard (merged with each widget's own exclusions).
    #[serde(default)]
    pub exclude_categories: Vec<String>,
    /// Budget names globally excluded from every widget on this dashboard.
    #[serde(default)]
    pub exclude_budgets: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}
