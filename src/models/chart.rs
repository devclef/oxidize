use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type ChartLine = Vec<ChartDataSet>;

#[derive(Serialize, Deserialize, Debug)]
pub struct ChartDataSet {
    pub label: String,
    pub currency_symbol: Option<String>,
    pub currency_code: Option<String>,
    // entries: labels are dates, values are numbers.
    // The spec is confusing, so we use Value for now to be safe.
    pub entries: Value,
}

/// A single month's earned/spent/saved totals for the "Saved this Month" tile.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonthStats {
    /// Human label, e.g. "September 2026".
    pub label: String,
    /// Total income for the month.
    pub earned: f64,
    /// Total spending for the month.
    pub spent: f64,
    /// Net saved (earned - spent) for the month.
    pub saved: f64,
}

/// Payload for the "Saved this Month" stat tile. Always compares the current
/// calendar month (start of month to today) against the previous full month.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SavedThisMonth {
    pub currency_symbol: Option<String>,
    pub currency_code: Option<String>,
    pub current_month: MonthStats,
    pub previous_month: MonthStats,
    /// current_month.saved - previous_month.saved (positive = saved more).
    pub difference: f64,
    /// Start of the current month, e.g. "2026-09-01".
    pub current_month_start: String,
    /// Today's date (end of the current partial month), e.g. "2026-09-10".
    pub current_month_end: String,
}
