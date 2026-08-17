use serde::{Deserialize, Deserializer, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Widget {
    pub id: String,
    pub name: String,
    pub accounts: Vec<String>,
    #[serde(default)]
    pub group_ids: Vec<String>,
    #[serde(default)]
    pub budget_ids: Vec<String>,
    #[serde(default)]
    pub budget_names: Vec<String>,
    #[serde(default)]
    pub parent_categories: Vec<String>,
    #[serde(default)]
    pub subcategories: Vec<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_graph_mode: Option<String>, // "subcategory" (default) or "parent"
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub interval: Option<String>,
    pub chart_mode: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub earned_chart_type: Option<String>, // "bars", "delta_line", "delta_bar
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widget_type: Option<String>, // "balance" (default) or "earned_spent"
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "deserialize_chart_options_for_widget")]
    pub chart_options: Option<ChartOptions>,
    #[serde(default = "default_display_order")]
    pub display_order: i32,
    #[serde(default = "default_width")]
    pub width: i32,
    #[serde(default = "default_chart_height")]
    pub chart_height: i32,
    #[serde(default)]
    pub dashboard_ids: Vec<String>,
    /// "dashboard" means use the dashboard-level date range;
    /// "custom" (or absent) means use the widget's own start_date/end_date.
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_range_source: Option<String>,
    /// Sankey flow grouping type: "destination", "budget", "category", or "subcategory".
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sankey_flow_type: Option<String>,
    /// Chart rendering type: "line" (default) or "pie".
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChartOptions {
    #[serde(default = "default_show_points")]
    pub show_points: bool,
    #[serde(default = "default_x_axis_limit")]
    pub x_axis_limit: i32,
    #[serde(default = "default_y_axis_limit")]
    pub y_axis_limit: i32,
    #[serde(default = "default_fill_area")]
    pub fill_area: bool,
    #[serde(default = "default_tension")]
    pub tension: f64,
    #[serde(default = "default_begin_at_zero")]
    pub begin_at_zero: bool,
    #[serde(default = "default_show_pct")]
    pub show_pct: bool,
    #[serde(default = "default_pct_mode")]
    pub pct_mode: String,
    #[serde(default = "default_enable_forecast")]
    pub enable_forecast: bool,
    #[serde(default = "default_forecast_days")]
    pub forecast_days: i32,
    #[serde(default = "default_show_trendline")]
    pub show_trendline: bool,
    #[serde(default = "default_trendline_window")]
    pub trendline_window: i32,
}

fn default_pct_mode() -> String {
    "from_previous".to_string()
}

fn default_display_order() -> i32 {
    0
}

fn default_width() -> i32 {
    12
}

fn default_chart_height() -> i32 {
    300
}

fn default_show_points() -> bool {
    false
}
fn default_x_axis_limit() -> i32 {
    6
}
fn default_y_axis_limit() -> i32 {
    4
}
fn default_fill_area() -> bool {
    true
}
fn default_tension() -> f64 {
    0.1
}
fn default_begin_at_zero() -> bool {
    false
}
fn default_show_pct() -> bool {
    false
}
fn default_enable_forecast() -> bool {
    false
}
fn default_forecast_days() -> i32 {
    30
}
fn default_show_trendline() -> bool {
    false
}
fn default_trendline_window() -> i32 {
    7
}

/// Custom deserializer for Option<ChartOptions> that handles null values.
fn deserialize_chart_options_for_widget<'de, D>(
    deserializer: D,
) -> Result<Option<ChartOptions>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(None),
        _ => deserialize_chart_options_inner(value)
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

fn deserialize_chart_options_inner(
    value: serde_json::Value,
) -> Result<ChartOptions, serde_json::Error> {
    let mut map = serde_json::Map::new();
    if let serde_json::Value::Object(obj) = value {
        for (key, val) in obj {
            if val != serde_json::Value::Null {
                map.insert(key, val);
            }
        }
    }
    serde_json::from_value(serde_json::Value::Object(map))
}

/// Deserialize ChartOptions from a Deserializer, treating null values as missing fields.
pub fn deserialize_chart_options_from_deserializer<'de, D>(
    deserializer: D,
) -> Result<ChartOptions, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    deserialize_chart_options_inner(value).map_err(serde::de::Error::custom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chart_options_defaults_for_legacy_json() {
        // Widgets saved before the trend line option existed must still
        // deserialize, picking up the new defaults.
        let json = r#"{"show_points": false, "x_axis_limit": 6, "y_axis_limit": 4, "fill_area": true, "tension": 0.1, "begin_at_zero": false, "show_pct": false, "pct_mode": "from_previous", "enable_forecast": false, "forecast_days": 30}"#;
        let opts: ChartOptions = serde_json::from_str(json).unwrap();
        assert!(!opts.show_trendline);
        assert_eq!(opts.trendline_window, 7);
    }

    #[test]
    fn chart_options_round_trips_trendline_fields() {
        let json = r#"{"show_trendline": true, "trendline_window": 14}"#;
        let opts: ChartOptions = serde_json::from_str(json).unwrap();
        assert!(opts.show_trendline);
        assert_eq!(opts.trendline_window, 14);

        let out = serde_json::to_value(&opts).unwrap();
        assert_eq!(out["show_trendline"], true);
        assert_eq!(out["trendline_window"], 14);
    }

    #[test]
    fn widget_deserializes_with_null_chart_options() {
        let json = r#"{
            "id": "w1",
            "name": "Test",
            "accounts": [],
            "chart_options": null
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert!(widget.chart_options.is_none());
    }
}
