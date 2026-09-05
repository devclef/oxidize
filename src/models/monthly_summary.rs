use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlySummaryResponse {
    pub month: String, // "YYYY-MM"
    pub start_date: String, // "YYYY-MM-DD"
    pub end_date: String, // "YYYY-MM-DD"
    pub prev_month: String, // "YYYY-MM"
    pub next_month: String, // "YYYY-MM"
    pub days_in_month: u32,
    pub currency_symbol: String,
    pub currency_code: String,
    pub total_income: f64,
    pub total_expenses: f64,
    pub net_savings: f64,
    pub savings_rate: f64,
    pub total_transfers: f64,
    pub total_budgeted: f64,
    pub total_budget_spent: f64,
    pub budgets: Vec<MonthlyBudgetSummary>,
    pub top_categories: Vec<MonthlyCategorySummary>,
    pub income_sources: Vec<MonthlyIncomeSourceSummary>,
    pub daily_chart: Vec<MonthlyDailyPoint>,
    pub recent_transactions: Vec<MonthlyTransactionItem>,
    pub accounts: Vec<MonthlyAccountSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyBudgetSummary {
    pub budget_id: String,
    pub budget_name: String,
    pub budgeted: f64,
    pub spent: f64,
    pub remaining: f64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyCategorySummary {
    pub category_id: String,
    pub category_name: String,
    pub spent: f64,
    pub percentage: f64,
    pub transaction_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyIncomeSourceSummary {
    pub source_name: String,
    pub amount: f64,
    pub percentage: f64,
    pub transaction_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyDailyPoint {
    pub date: String,
    pub income: f64,
    pub expenses: f64,
    pub cumulative_net: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyTransactionItem {
    pub id: String,
    pub date: String,
    pub description: String,
    pub amount: f64,
    pub transaction_type: String,
    pub category_name: Option<String>,
    pub source_name: String,
    pub destination_name: String,
    pub currency_symbol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonthlyAccountSummary {
    pub account_id: String,
    pub account_name: String,
    pub current_balance: f64,
    pub monthly_income: f64,
    pub monthly_expenses: f64,
}
