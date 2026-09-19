//! Types for the Monthly Summary page (`/summary`, `/api/summary/month`).
//!
//! All monetary values are aggregated server-side from the same transaction
//! set (and the same account/exclusion filters), so the KPI totals, the
//! category breakdown and the daily chart are always consistent with each
//! other. Budget figures come from Firefly III's own budget endpoints.

use serde::{Deserialize, Serialize};

/// Currency reported for the month (taken from the transactions themselves).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct MonthCurrency {
    pub code: Option<String>,
    pub symbol: Option<String>,
}

/// Headline figures for the month.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthTotals {
    /// Total earned (income) in the period.
    pub earned: f64,
    /// Total spent (expenses) in the period.
    pub spent: f64,
    /// earned - spent.
    pub net: f64,
    /// (net / earned) * 100, or None when earned is 0.
    pub savings_rate: Option<f64>,
    /// Days in the calendar month (28-31).
    pub days_in_month: u32,
    /// Days that actually have data: `days_in_month` for a completed month,
    /// today's day-of-month for the current (partial) month.
    pub days_elapsed: u32,
    /// spent / days_elapsed (0 when nothing elapsed yet).
    pub daily_average_spent: f64,
    /// Previous month figures (None when unknown / no data).
    pub prev_month_earned: Option<f64>,
    pub prev_month_spent: Option<f64>,
    pub prev_month_net: Option<f64>,
    /// (earned - prev) / prev * 100, or None when prev is 0/unknown.
    pub earned_delta_pct: Option<f64>,
    pub spent_delta_pct: Option<f64>,
    /// Net worth at the latest date with data in the month.
    pub net_worth: Option<f64>,
    /// Change in net worth across the month (latest - first datapoint).
    pub net_worth_delta: Option<f64>,
}

/// One budget's position for the month.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthBudget {
    pub id: String,
    pub name: String,
    /// Spent in the period per Firefly III's budget aggregation.
    pub spent: f64,
    /// Monthly limit for the month, when configured.
    pub limit: Option<f64>,
    /// spent / limit * 100, or None without a limit.
    pub pct_of_limit: Option<f64>,
    /// Projected full-month spend (current month only, based on daily pace).
    pub projected: Option<f64>,
    /// "ok" | "warning" (projected to exceed limit) | "over" | "no-limit".
    pub status: String,
    pub currency_code: Option<String>,
    pub currency_symbol: Option<String>,
}

/// Aggregates across all budgets for the month.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct MonthBudgetTotals {
    /// Number of budgets returned (with or without spend).
    pub count: usize,
    /// Number of budgets that have a limit configured for the month.
    pub with_limit: usize,
    /// Total spent across ALL budgets.
    pub spent: f64,
    /// Sum of limits for budgets that have one.
    pub limited: f64,
    /// Total spent on budgets that have a limit.
    pub limited_spent: f64,
    /// Number of budgets over their limit.
    pub over_count: usize,
}

/// One category's share of the month's spending.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthCategory {
    pub name: String,
    pub amount: f64,
    /// amount / total spent * 100 (0 when total spent is 0).
    pub pct: f64,
}

/// Day-by-day cash flow for the month.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthDaily {
    /// "YYYY-MM-DD" labels, one per day with data (chronological).
    pub dates: Vec<String>,
    pub earned: Vec<f64>,
    pub spent: Vec<f64>,
    /// Running total of spent.
    pub cumulative_spent: Vec<f64>,
}

/// Trailing 12-month income vs spending (selected month last, possibly partial).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthTrend {
    /// "YYYY-MM" labels, oldest first.
    pub labels: Vec<String>,
    pub earned: Vec<f64>,
    pub spent: Vec<f64>,
}

/// One of the largest single expenses of the month.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthTopExpense {
    /// "YYYY-MM-DD".
    pub date: String,
    pub description: String,
    pub category: Option<String>,
    pub amount: f64,
    /// Destination account name (expense account, or transfer destination).
    pub account: Option<String>,
}

/// Full response for GET /api/summary/month.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthSummary {
    pub year: i32,
    pub month: u32,
    /// "YYYY-MM-01".
    pub start_date: String,
    /// Last day of the month, "YYYY-MM-DD".
    pub end_date: String,
    /// True when this is the month that is currently in progress.
    pub is_current_month: bool,
    pub totals: MonthTotals,
    pub budgets: Vec<MonthBudget>,
    pub budget_totals: MonthBudgetTotals,
    pub categories: Vec<MonthCategory>,
    pub daily: MonthDaily,
    pub trend_12m: MonthTrend,
    pub top_expenses: Vec<MonthTopExpense>,
    pub currency: MonthCurrency,
    /// Non-fatal problems while loading sub-sections (budgets, net worth,
    /// previous-month comparison, ...). The rest of the response is valid.
    #[serde(default)]
    pub warnings: Vec<String>,
}

// ── Bulk budget limits ─────────────────────────────────────────────────────

/// One budget limit from Firefly III `/v1/budget-limits`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkBudgetLimit {
    pub budget_id: String,
    /// "YYYY-MM-DD" (limit start, usually the 1st of the month).
    pub period_start: String,
    /// "YYYY-MM-DD" (limit end, usually the last day of the month).
    pub period_end: String,
    pub amount: f64,
    pub currency_code: Option<String>,
    pub currency_symbol: Option<String>,
}

/// Inner object from a Firefly III `/v1/budget-limits` response item.
#[derive(Debug, Deserialize)]
struct BulkBudgetLimitData {
    id: String,
    #[serde(rename = "attributes")]
    attrs: BulkBudgetLimitAttrs,
}

#[derive(Debug, Deserialize)]
struct BulkBudgetLimitAttrs {
    #[serde(default)]
    start: Option<String>,
    #[serde(default)]
    end: Option<String>,
    #[serde(default)]
    budget_id: Option<String>,
    #[serde(default)]
    amount: Option<String>,
    #[serde(default)]
    currency_code: Option<String>,
    #[serde(default)]
    currency_symbol: Option<String>,
}

impl From<BulkBudgetLimitData> for BulkBudgetLimit {
    fn from(item: BulkBudgetLimitData) -> Self {
        let date_part = |v: &Option<String>| {
            v.as_ref()
                .and_then(|s| s.split('T').next())
                .map(str::to_string)
        };
        Self {
            budget_id: item.attrs.budget_id.unwrap_or(item.id),
            period_start: date_part(&item.attrs.start).unwrap_or_default(),
            period_end: date_part(&item.attrs.end).unwrap_or_default(),
            amount: item
                .attrs
                .amount
                .and_then(|a| a.parse::<f64>().ok())
                .unwrap_or(0.0),
            currency_code: item.attrs.currency_code,
            currency_symbol: item.attrs.currency_symbol,
        }
    }
}

impl BulkBudgetLimit {
    /// Parse one limit from a Firefly III HAL+JSON item
    /// (`{id, attributes: {start, end, budget_id, amount, ...}}`).
    /// Returns None when required fields are missing.
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        let data = value.get("attributes")?;
        let get = |f: &str| data.get(f).and_then(|v| v.as_str()).map(str::to_string);
        let date_part = |s: &str| s.split('T').next().map(str::to_string);

        let start = get("start").and_then(|s| date_part(&s))?;
        let end = get("end").and_then(|s| date_part(&s)).unwrap_or_default();
        let budget_id = get("budget_id")?;
        let amount = get("amount")?.parse::<f64>().ok()?;

        Some(Self {
            budget_id,
            period_start: start,
            period_end: end,
            amount,
            currency_code: get("currency_code"),
            currency_symbol: get("currency_symbol"),
        })
    }
}

/// Response envelope from GET /v1/budget-limits.
///
/// Some Firefly III versions return a bare array instead of the
/// HAL+JSON envelope; both are handled by the client.
#[derive(Debug, Deserialize)]
pub struct BulkBudgetLimitResponse {
    #[serde(rename = "data")]
    items: Vec<BulkBudgetLimitData>,
}

impl BulkBudgetLimitResponse {
    pub fn limits(self) -> Vec<BulkBudgetLimit> {
        self.items.into_iter().map(BulkBudgetLimit::from).collect()
    }
}

// ── Pure helpers (shared by client + tests) ───────────────────────────────

/// First and last day of a calendar month, plus the number of days.
/// Returns Err for an invalid month (not 1-12).
pub fn month_range(
    year: i32,
    month: u32,
) -> Result<(chrono::NaiveDate, chrono::NaiveDate, u32), String> {
    if !(1..=12).contains(&month) {
        return Err(format!("Invalid month: {} (expected 1-12)", month));
    }
    let start = chrono::NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| format!("Invalid date: {}-{:02}-01", year, month))?;
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let next_start = chrono::NaiveDate::from_ymd_opt(ny, nm, 1).unwrap();
    let end = next_start - chrono::Duration::days(1);
    let days = (end - start).num_days() + 1;
    Ok((start, end, days as u32))
}

/// Shift a (year, month) pair by `delta` months (negative = backwards).
/// Month is 1-based in both input and output.
pub fn shift_months(year: i32, month: u32, delta: i64) -> (i32, u32) {
    let total = (year - 2000) as i64 * 12 + (month as i64) - 1 + delta;
    let y = 2000 + total / 12;
    let m = (total % 12) as u32 + 1;
    (y as i32, m)
}

/// Percentage change from `previous` to `current`.
/// None when the previous value is unknown or zero (change is undefined).
pub fn pct_change(current: f64, previous: Option<f64>) -> Option<f64> {
    let prev = previous?;
    if prev == 0.0 {
        return None;
    }
    Some((current - prev) / prev * 100.0)
}

/// Project a full-month total from elapsed data using the daily pace:
/// `spent * days_in_month / days_elapsed`. None when nothing has elapsed.
pub fn project_full_month(spent: f64, days_elapsed: u32, days_in_month: u32) -> Option<f64> {
    if days_elapsed == 0 || days_in_month == 0 {
        return None;
    }
    Some(spent * days_in_month as f64 / days_elapsed as f64)
}

/// Classify a budget's position for the month.
/// - no limit           -> "no-limit"
/// - spent > limit      -> "over"
/// - projected > limit  -> "warning" (on pace to exceed the limit)
/// - otherwise          -> "ok"
pub fn budget_status(spent: f64, limit: Option<f64>, projected: Option<f64>) -> String {
    match limit {
        None => "no-limit".to_string(),
        Some(l) if l > 0.0 && spent > l => "over".to_string(),
        Some(l) if l > 0.0 => match projected {
            Some(p) if p > l => "warning".to_string(),
            _ => "ok".to_string(),
        },
        // Zero/negative limit is not meaningful; treat as no limit.
        _ => "no-limit".to_string(),
    }
}
