use serde::{Deserialize, Serialize};

/// Single category from Firefly III
#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct CategoryRead {
    pub id: String,
    pub name: String,
}

/// Inner object from Firefly III /v1/categories response
#[derive(Debug, Deserialize)]
struct CategoryDataItem {
    id: String,
    #[serde(rename = "attributes")]
    attrs: CategoryAttrs,
}

#[derive(Debug, Deserialize)]
struct CategoryAttrs {
    name: String,
}

impl From<CategoryDataItem> for CategoryRead {
    fn from(item: CategoryDataItem) -> Self {
        Self {
            id: item.id,
            name: item.attrs.name,
        }
    }
}

/// Response from GET /v1/categories
#[derive(Debug, Deserialize)]
pub struct CategoryListResponse {
    #[serde(rename = "data")]
    items: Vec<CategoryDataItem>,
}

impl CategoryListResponse {
    pub fn categories(self) -> Vec<CategoryRead> {
        self.items.into_iter().map(CategoryRead::from).collect()
    }
}

/// A parent category (before the colon) with its subcategories (after the colon).
/// Categories without a colon are treated as having a single subcategory named "Other".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParentCategory {
    pub name: String,
    #[serde(rename = "type")]
    pub category_type: String,
    pub subcategories: Vec<String>,
}
