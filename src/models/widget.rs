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
    /// Categories/budgets entirely excluded from this widget's data.
    /// Category entries may be parent names (excludes all subcategories)
    /// or full "Parent:Sub" names.
    #[serde(default)]
    pub exclude_categories: Vec<String>,
    /// Budget names entirely excluded from this widget's data.
    #[serde(default)]
    pub exclude_budgets: Vec<String>,
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
    /// "balance" (default), "earned_spent", "budget_spent",
    /// "expenses_by_category", "category_subcat", "net_worth", "card_paydown",
    /// "saved_this_month", "sankey", "label_spend" (per-label spend
    /// trend), "subscription_cost" (per-subscription cost over time) or
    /// "budget_breakdown" (selected budgets' spend by category or
    /// destination account over time).
    pub widget_type: Option<String>,
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
    /// Budget breakdown widgets: what the selected budgets' spend is
    /// charted over time by: "category" (default; absent = full category
    /// incl. subcategory), "main_category" (subcategories rolled up into
    /// their main category) or "destination" (the destination account).
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_breakdown_by: Option<String>,
    /// Chart rendering type: "line" (default) or "pie".
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_type: Option<String>,
    /// Label spend widgets: include the "Unlabeled" remainder series.
    /// `None` (widgets saved before this field existed) means include it.
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_unlabeled: Option<bool>,
    /// Subscription cost widgets: Firefly III subscription (bill) IDs
    /// selected for the widget. Empty (with no groups) means "all
    /// subscriptions".
    #[serde(default)]
    pub subscription_ids: Vec<String>,
    /// Subscription cost widgets: object-group IDs whose subscriptions are
    /// included in the widget.
    #[serde(default)]
    pub subscription_group_ids: Vec<String>,
    /// Subscription cost widgets: whether selected subscription groups are
    /// split into one series per subscription. `None` (widgets saved before
    /// this field existed) means groups are charted as one total each.
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_split_groups: Option<bool>,
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
    #[serde(default = "default_stacked")]
    pub stacked: bool,
    /// Overlay a previous date range (balance widgets) for comparison.
    #[serde(default = "default_enable_comparison")]
    pub enable_comparison: bool,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison_start_date: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison_end_date: Option<String>,
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
fn default_stacked() -> bool {
    false
}

fn default_enable_comparison() -> bool {
    false
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
        assert!(!opts.stacked);
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
    fn chart_options_round_trips_stacked_field() {
        // #24: line chart stacking option must persist on saved widgets
        let json = r#"{"stacked": true}"#;
        let opts: ChartOptions = serde_json::from_str(json).unwrap();
        assert!(opts.stacked);

        let out = serde_json::to_value(&opts).unwrap();
        assert_eq!(out["stacked"], true);

        // Legacy widgets without the field default to unstacked
        let legacy: ChartOptions = serde_json::from_str(r#"{"show_pct": false}"#).unwrap();
        assert!(!legacy.stacked);
    }

    #[test]
    fn chart_options_round_trips_comparison_fields() {
        let json = r#"{"enable_comparison": true, "comparison_start_date": "2025-01-01", "comparison_end_date": "2025-06-30"}"#;
        let opts: ChartOptions = serde_json::from_str(json).unwrap();
        assert!(opts.enable_comparison);
        assert_eq!(opts.comparison_start_date.as_deref(), Some("2025-01-01"));
        assert_eq!(opts.comparison_end_date.as_deref(), Some("2025-06-30"));

        let out = serde_json::to_value(&opts).unwrap();
        assert_eq!(out["enable_comparison"], true);
        assert_eq!(out["comparison_start_date"], "2025-01-01");
        assert_eq!(out["comparison_end_date"], "2025-06-30");

        // Legacy widgets without the fields default to disabled / no dates
        let legacy: ChartOptions = serde_json::from_str(r#"{"show_pct": false}"#).unwrap();
        assert!(!legacy.enable_comparison);
        assert!(legacy.comparison_start_date.is_none());
        assert!(legacy.comparison_end_date.is_none());
    }

    #[test]
    fn widget_legacy_json_defaults_exclusion_fields() {
        // Widgets saved before exclusions existed must still deserialize,
        // picking up empty exclusion lists.
        let json = r#"{
            "id": "w1",
            "name": "Test",
            "accounts": []
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert!(widget.exclude_categories.is_empty());
        assert!(widget.exclude_budgets.is_empty());

        let out = serde_json::to_value(&widget).unwrap();
        assert_eq!(out["exclude_categories"].as_array().unwrap().len(), 0);
        assert_eq!(out["exclude_budgets"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn widget_legacy_json_defaults_subscription_fields() {
        // Widgets saved before the subscription fields existed must still
        // deserialize, picking up empty selection lists.
        let json = r#"{
            "id": "w1",
            "name": "Test",
            "accounts": []
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert!(widget.subscription_ids.is_empty());
        assert!(widget.subscription_group_ids.is_empty());
    }

    #[test]
    fn widget_subscription_fields_round_trip() {
        let json = r#"{
            "id": "w2",
            "name": "Subs",
            "accounts": [],
            "widget_type": "subscription_cost",
            "subscription_ids": ["11", "12"],
            "subscription_group_ids": ["3"]
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert_eq!(
            widget.subscription_ids,
            vec!["11".to_string(), "12".to_string()]
        );
        assert_eq!(widget.subscription_group_ids, vec!["3".to_string()]);

        let out = serde_json::to_value(&widget).unwrap();
        let ids: Vec<&str> = out["subscription_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["11", "12"]);
        let groups: Vec<&str> = out["subscription_group_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(groups, vec!["3"]);
    }

    #[test]
    fn widget_legacy_json_defaults_subscription_split_groups() {
        // Widgets saved before the split flag existed must still
        // deserialize with the field absent (rendered as "not split").
        let json = r#"{
            "id": "w1",
            "name": "Test",
            "accounts": [],
            "widget_type": "subscription_cost"
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert_eq!(widget.subscription_split_groups, None);

        let out = serde_json::to_value(&widget).unwrap();
        assert!(out.get("subscription_split_groups").is_none());
    }

    #[test]
    fn widget_subscription_split_groups_round_trips() {
        let json = r#"{
            "id": "w2",
            "name": "Subs",
            "accounts": [],
            "widget_type": "subscription_cost",
            "subscription_group_ids": ["3"],
            "subscription_split_groups": true
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert_eq!(widget.subscription_split_groups, Some(true));

        let out = serde_json::to_value(&widget).unwrap();
        assert_eq!(out["subscription_split_groups"].as_bool(), Some(true));
    }

    #[test]
    fn widget_legacy_json_defaults_include_unlabeled() {
        // Widgets saved before include_unlabeled existed must still
        // deserialize with the field absent (rendered as "include").
        let json = r#"{
            "id": "w1",
            "name": "Test",
            "accounts": [],
            "widget_type": "label_spend"
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert_eq!(widget.include_unlabeled, None);

        // And it is skipped on serialization, so the saved JSON shape is
        // unchanged for widgets that never set it.
        let out = serde_json::to_value(&widget).unwrap();
        assert!(out.get("include_unlabeled").is_none());
    }

    #[test]
    fn widget_label_spend_include_unlabeled_round_trips() {
        let json = r#"{
            "id": "w2",
            "name": "Labels",
            "accounts": [],
            "widget_type": "label_spend",
            "include_unlabeled": false
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert_eq!(widget.include_unlabeled, Some(false));

        let out = serde_json::to_value(&widget).unwrap();
        assert_eq!(out["include_unlabeled"].as_bool(), Some(false));
    }

    #[test]
    fn widget_legacy_json_defaults_budget_breakdown_by() {
        // Widgets saved before budget_breakdown_by existed must still
        // deserialize with the field absent (rendered as "category").
        let json = r#"{
            "id": "w1",
            "name": "Test",
            "accounts": []
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert_eq!(widget.budget_breakdown_by, None);

        // And it is skipped on serialization, so the saved JSON shape is
        // unchanged for widgets that never set it.
        let out = serde_json::to_value(&widget).unwrap();
        assert!(out.get("budget_breakdown_by").is_none());
    }

    #[test]
    fn widget_budget_breakdown_by_round_trips() {
        let json = r#"{
            "id": "w2",
            "name": "Budgets",
            "accounts": [],
            "widget_type": "budget_breakdown",
            "budget_names": ["Groceries"],
            "budget_breakdown_by": "destination"
        }"#;
        let widget: Widget = serde_json::from_str(json).unwrap();
        assert_eq!(widget.budget_breakdown_by, Some("destination".to_string()));

        let out = serde_json::to_value(&widget).unwrap();
        assert_eq!(out["budget_breakdown_by"].as_str(), Some("destination"));
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
