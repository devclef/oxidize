use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Widget {
    pub id: String,
    pub name: String,
    pub accounts: Vec<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub interval: Option<String>,
    pub chart_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widget_type: Option<String>, // "balance" (default) or "earned_spent"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_options: Option<ChartOptions>,
    #[serde(default = "default_display_order")]
    pub display_order: i32,
    #[serde(default = "default_width")]
    pub width: i32,
    #[serde(default = "default_chart_height")]
    pub chart_height: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChartOptions {
    pub show_points: bool,
    pub x_axis_limit: i32,
    pub y_axis_limit: i32,
    pub fill_area: bool,
    pub tension: f64,
    pub begin_at_zero: bool,
    #[serde(default)]
    pub show_pct: bool,
    #[serde(default = "default_pct_mode")]
    pub pct_mode: String,
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
