use chrono::Datelike;
use serde::{Deserialize, Serialize};

/// Single budget from Firefly III
#[derive(Debug, Deserialize, Clone, Serialize)]
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

// ── Budget Period Limit ────────────────────────────────────────────────────

/// Single period limit from Firefly III /v1/budget/limit response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetPeriodLimit {
    pub period_start: String,
    pub period_end: String,
    pub currency_code: String,
    pub currency_symbol: String,
    pub period_limit: f64,
    pub period_spent: f64,
}

impl BudgetPeriodLimit {
    /// Parse a single budget limit entry from a Firefly III JSON Value.
    /// Returns None if the entry is missing required fields.
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        let data = value.get("data")?.get("attributes")?;

        let period_start = data.get("period_start")?.as_str()?.to_string();
        let period_end = data.get("period_end")?.as_str()?.to_string();

        let currency_code = data
            .get("currency_code")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let currency_symbol = data
            .get("currency_symbol")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();

        let period_limit = data
            .get("period_limit")
            .and_then(|l| l.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);

        let period_spent = data
            .get("period_spent")
            .and_then(|s| s.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);

        Some(Self {
            period_start,
            period_end,
            currency_code,
            currency_symbol,
            period_limit,
            period_spent,
        })
    }

    /// Extract the month index (1-12) from the period_start date.
    pub fn month_index(&self) -> Option<u32> {
        // Accept "2026-01-01" or "2026-01-01T00:00:00+00:00"
        let date_str = self.period_start.split('T').next()?;
        let date = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
        Some(date.month())
    }

    /// Extract the year from the period_start date.
    pub fn year(&self) -> Option<i32> {
        let date_str = self.period_start.split('T').next()?;
        let date = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
        Some(date.year())
    }
}

// ── Budget Comparison Response ─────────────────────────────────────────────

/// Projection data for a single budget comparison
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetComparisonProjections {
    /// Sum of actual spending in current year (only months with data)
    pub current_year_total: f64,
    /// Projected full-year total based on average monthly spend
    pub current_year_projected: f64,
    /// Sum of actual spending in previous year (only months with data)
    pub previous_year_total: f64,
    /// Sum of budget limits in current year (if configured)
    pub current_year_limit_total: Option<f64>,
    /// Sum of budget limits in previous year (if configured)
    pub previous_year_limit_total: Option<f64>,
    /// Percentage difference projected vs last year (e.g. "+12.5" means 12.5% more)
    pub vs_last_year: String,
    /// Percentage difference projected vs limit (e.g. "-5.0" means 5% under budget)
    pub vs_limit: Option<String>,
    /// True if projected spending is within budget limit
    pub on_track: bool,
}

/// Comparison data for a single budget
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetComparison {
    /// Name of the budget
    pub budget_name: String,
    /// Current year being compared
    pub current_year: i32,
    /// Previous year being compared
    pub previous_year: i32,
    /// Month labels
    pub months: Vec<String>,
    /// Monthly spent amounts for current year (null for future months)
    pub current_year_spent: Vec<Option<f64>>,
    /// Monthly spent amounts for previous year (null if no data)
    pub previous_year_spent: Vec<Option<f64>>,
    /// Monthly limit amounts for current year (null if no limit)
    pub current_year_limit: Vec<Option<f64>>,
    /// Monthly limit amounts for previous year (null if no limit)
    pub previous_year_limit: Vec<Option<f64>>,
    /// Running totals for current year (cumulative)
    pub current_year_running: Vec<Option<f64>>,
    /// Running totals for previous year (cumulative)
    pub previous_year_running: Vec<Option<f64>>,
    /// Projection calculations
    pub projections: BudgetComparisonProjections,
    /// Currency symbol
    pub currency_symbol: Option<String>,
    /// Currency code
    pub currency_code: Option<String>,
}
