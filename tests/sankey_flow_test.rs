/// Tests for the Sankey flow feature: models, serialization, and flow data structures.

#[test]
fn test_sankey_link_serialization() {
    let link = oxidize::models::SankeyLink {
        source: "Checking".to_string(),
        target: "Groceries".to_string(),
        amount: 250.50,
    };

    let json = serde_json::to_string(&link).expect("should serialize");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

    assert_eq!(parsed["source"], "Checking");
    assert_eq!(parsed["target"], "Groceries");
    assert!((parsed["amount"].as_f64().unwrap() - 250.50).abs() < f64::EPSILON);
}

#[test]
fn test_sankey_link_deserialization() {
    let json = r#"{"source":"Savings","target":"Rent","amount":1200.0}"#;
    let link: oxidize::models::SankeyLink =
        serde_json::from_str(json).expect("should deserialize");

    assert_eq!(link.source, "Savings");
    assert_eq!(link.target, "Rent");
    assert!((link.amount - 1200.0).abs() < f64::EPSILON);
}

#[test]
fn test_sankey_node_serialization() {
    let node = oxidize::models::SankeyNode {
        name: "SEB Checking".to_string(),
    };

    let json = serde_json::to_string(&node).expect("should serialize");
    assert!(json.contains("SEB Checking"));

    let parsed: oxidize::models::SankeyNode =
        serde_json::from_str(&json).expect("should deserialize");
    assert_eq!(parsed.name, "SEB Checking");
}

#[test]
fn test_sankey_flow_data_full_serialization() {
    let data = oxidize::models::SankeyFlowData {
        nodes: vec![
            oxidize::models::SankeyNode { name: "Checking".to_string() },
            oxidize::models::SankeyNode { name: "Groceries".to_string() },
            oxidize::models::SankeyNode { name: "Transport".to_string() },
        ],
        links: vec![
            oxidize::models::SankeyLink {
                source: "Checking".to_string(),
                target: "Groceries".to_string(),
                amount: 450.0,
            },
            oxidize::models::SankeyLink {
                source: "Checking".to_string(),
                target: "Transport".to_string(),
                amount: 120.0,
            },
        ],
        total: 570.0,
        currency_symbol: Some("$".to_string()),
        currency_code: Some("USD".to_string()),
        flow_type: "destination".to_string(),
    };

    let json = serde_json::to_string(&data).expect("should serialize");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

    assert_eq!(parsed["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(parsed["links"].as_array().unwrap().len(), 2);
    assert!((parsed["total"].as_f64().unwrap() - 570.0).abs() < f64::EPSILON);
    assert_eq!(parsed["currency_symbol"], "$");
    assert_eq!(parsed["flow_type"], "destination");
}

#[test]
fn test_sankey_flow_data_roundtrip() {
    let original = oxidize::models::SankeyFlowData {
        nodes: vec![
            oxidize::models::SankeyNode { name: "A".to_string() },
            oxidize::models::SankeyNode { name: "B".to_string() },
        ],
        links: vec![oxidize::models::SankeyLink {
            source: "A".to_string(),
            target: "B".to_string(),
            amount: 1000.0,
        }],
        total: 1000.0,
        currency_symbol: Some("kr".to_string()),
        currency_code: Some("SEK".to_string()),
        flow_type: "category".to_string(),
    };

    let json = serde_json::to_string(&original).expect("should serialize");
    let deserialized: oxidize::models::SankeyFlowData =
        serde_json::from_str(&json).expect("should deserialize");

    assert_eq!(deserialized.nodes.len(), 2);
    assert_eq!(deserialized.links.len(), 1);
    assert!((deserialized.total - 1000.0).abs() < f64::EPSILON);
    assert_eq!(deserialized.flow_type, "category");
    assert_eq!(deserialized.currency_symbol.as_deref(), Some("kr"));
}

#[test]
fn test_sankey_flow_data_empty() {
    let data = oxidize::models::SankeyFlowData {
        nodes: vec![],
        links: vec![],
        total: 0.0,
        currency_symbol: None,
        currency_code: None,
        flow_type: "budget".to_string(),
    };

    let json = serde_json::to_string(&data).expect("should serialize");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

    assert!(parsed["nodes"].as_array().unwrap().is_empty());
    assert!(parsed["links"].as_array().unwrap().is_empty());
    assert!(parsed["currency_symbol"].is_null());
}

#[test]
fn test_sankey_flow_type_enum_serialization() {
    assert_eq!(
        serde_json::to_string(&oxidize::models::SankeyFlowType::Budget).unwrap(),
        "\"budget\""
    );
    assert_eq!(
        serde_json::to_string(&oxidize::models::SankeyFlowType::Category).unwrap(),
        "\"category\""
    );
    assert_eq!(
        serde_json::to_string(&oxidize::models::SankeyFlowType::Subcategory).unwrap(),
        "\"subcategory\""
    );
    assert_eq!(
        serde_json::to_string(&oxidize::models::SankeyFlowType::Destination).unwrap(),
        "\"destination\""
    );
}

#[test]
fn test_sankey_flow_type_enum_deserialization() {
    let t: oxidize::models::SankeyFlowType =
        serde_json::from_str("\"budget\"").expect("should deserialize");
    assert!(matches!(t, oxidize::models::SankeyFlowType::Budget));

    let t: oxidize::models::SankeyFlowType =
        serde_json::from_str("\"subcategory\"").expect("should deserialize");
    assert!(matches!(t, oxidize::models::SankeyFlowType::Subcategory));
}

#[test]
fn test_sankey_total_calculation() {
    let links = vec![
        oxidize::models::SankeyLink {
            source: "Checking".to_string(),
            target: "Food".to_string(),
            amount: 300.0,
        },
        oxidize::models::SankeyLink {
            source: "Checking".to_string(),
            target: "Utilities".to_string(),
            amount: 150.0,
        },
        oxidize::models::SankeyLink {
            source: "Savings".to_string(),
            target: "Food".to_string(),
            amount: 50.0,
        },
    ];

    let total: f64 = links.iter().map(|l| l.amount).sum();
    assert!((total - 500.0).abs() < f64::EPSILON);
}

#[test]
fn test_sankey_query_param_parsing() {
    // Simulate the query parameter parsing in the sankey handler
    let query_string = "accounts[]=1&accounts[]=2&flow_type=category&start=2025-01-01&end=2025-12-31";

    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).expect("should parse");

    let mut account_ids: Vec<String> = Vec::new();
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut flow_type: Option<String> = None;

    for (k, v) in params {
        match k.as_str() {
            "accounts[]" | "accounts" => account_ids.push(v),
            "start" => start = Some(v),
            "end" => end = Some(v),
            "flow_type" => flow_type = Some(v),
            _ => {}
        }
    }

    assert_eq!(account_ids, vec!["1".to_string(), "2".to_string()]);
    assert_eq!(start, Some("2025-01-01".to_string()));
    assert_eq!(end, Some("2025-12-31".to_string()));
    assert_eq!(flow_type, Some("category".to_string()));
}

#[test]
fn test_sanquery_param_defaults() {
    // When no flow_type is provided, it should default to "destination"
    let query_string = "accounts[]=5";

    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).expect("should parse");

    let mut account_ids: Vec<String> = Vec::new();
    let mut flow_type: Option<String> = None;

    for (k, v) in params {
        match k.as_str() {
            "accounts[]" | "accounts" => account_ids.push(v),
            "flow_type" => flow_type = Some(v),
            _ => {}
        }
    }

    assert_eq!(account_ids, vec!["5".to_string()]);
    assert!(flow_type.is_none());

    // Simulate default logic
    let resolved = flow_type.as_deref().unwrap_or("destination");
    assert_eq!(resolved, "destination");
}
