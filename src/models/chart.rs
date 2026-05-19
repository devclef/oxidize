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
