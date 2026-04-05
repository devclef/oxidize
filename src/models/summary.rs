use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthlySummary {
    pub month: String,
    pub year: i32,
    pub total_income: f64,
    pub total_expenses: f64,
    pub savings: f64,
    pub savings_rate: f64,
    pub currency_symbol: Option<String>,
    pub currency_code: Option<String>,
}
