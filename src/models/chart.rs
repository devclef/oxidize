use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub type ChartLine = Vec<ChartDataSet>;

/// Deserializes budget overview response which can be either:
/// - An array of ChartDataSet (spec format)
/// - An object where values are arrays of ChartDataSet (some FF versions)
pub fn deserialize_budget_chart_line<'de, D>(deserializer: D) -> Result<ChartLine, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Array(arr) => {
            // Direct array format: [...ChartDataSet...]
            serde_json::from_value(Value::Array(arr))
                .map_err(serde::de::Error::custom)
        }
        Value::Object(map) => {
            // Object format: {"metric1": [...], "metric2": [...]}
            // Collect all arrays into a single ChartLine
            let mut all_datasets = Vec::new();
            for (key, val) in map {
                if let Value::Array(arr) = val {
                    // Each value might be an array of ChartDataSets
                    // Use the key as label prefix if datasets lack labels
                    for item in arr {
                        if let Ok(ds) =
                            serde_json::from_value::<ChartDataSet>(item.clone())
                        {
                            if ds.label.is_empty() || ds.label == key {
                                // Keep as-is
                            }
                            all_datasets.push(ds);
                        }
                    }
                }
            }
            Ok(all_datasets)
        }
        _ => Err(serde::de::Error::custom(
            "Expected array or object for budget chart data",
        )),
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChartDataSet {
    pub label: String,
    pub currency_symbol: Option<String>,
    pub currency_code: Option<String>,
    // entries: labels are dates, values are numbers.
    // The spec is confusing, so we use Value for now to be safe.
    pub entries: Value,
}

/// Expense aggregated by category
#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct CategoryExpense {
    pub name: String,
    pub amount: f64,
    pub currency_symbol: String,
    pub currency_code: String,
}
