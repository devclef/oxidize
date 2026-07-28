use serde::{Deserialize, Serialize};

/// A single flow link in a Sankey diagram, from one node to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SankeyLink {
    pub source: String,
    pub target: String,
    pub amount: f64,
}

/// A single node in a Sankey diagram.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SankeyNode {
    pub name: String,
}

/// Complete Sankey flow data ready for rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SankeyFlowData {
    pub nodes: Vec<SankeyNode>,
    pub links: Vec<SankeyLink>,
    pub total: f64,
    pub currency_symbol: Option<String>,
    pub currency_code: Option<String>,
    pub flow_type: String,
}

/// Supported flow groupings for Sankey diagrams.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SankeyFlowType {
    Budget,
    Category,
    Subcategory,
    Destination,
}
