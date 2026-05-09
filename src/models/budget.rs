use serde::Deserialize;

/// Single budget from Firefly III
#[derive(Debug, Deserialize, Clone)]
pub struct BudgetRead {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub active: bool,
}

/// Inner object from Firefly III /v1/budgets response
#[derive(Debug, Deserialize)]
struct BudgetDataItem {
    id: String,
    #[serde(rename = "attributes")]
    attrs: BudgetAttrs,
}

#[derive(Debug, Deserialize)]
struct BudgetAttrs {
    name: String,
    #[serde(default)]
    active: bool,
}

impl From<BudgetDataItem> for BudgetRead {
    fn from(item: BudgetDataItem) -> Self {
        Self {
            id: item.id,
            name: item.attrs.name,
            active: item.attrs.active,
        }
    }
}

/// Response from GET /v1/budgets
#[derive(Debug, Deserialize)]
pub struct BudgetListResponse {
    #[serde(rename = "data")]
    items: Vec<BudgetDataItem>,
}

impl BudgetListResponse {
    /// Extract budget records from the HAL+JSON response
    pub fn budgets(self) -> Vec<BudgetRead> {
        self.items.into_iter().map(BudgetRead::from).collect()
    }
}
