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
}
