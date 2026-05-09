use oxidize::models::widget::Widget;

#[test]
fn test_widget_deserialize_with_defaults() {
    // Simulate an old widget record without the new fields
    let json = r#"{
        "id": "test-1",
        "name": "Test Widget",
        "accounts": ["acc-1"],
        "start_date": null,
        "end_date": null,
        "interval": null,
        "chart_mode": null,
        "widget_type": null,
        "chart_options": null,
        "created_at": null,
        "updated_at": null
    }"#;

    let widget: Widget = serde_json::from_str(json).unwrap();
    assert_eq!(widget.display_order, 0);
    assert_eq!(widget.width, 12);
    assert_eq!(widget.chart_height, 300);
}

#[test]
fn test_widget_deserialize_with_new_fields() {
    let json = r#"{
        "id": "test-2",
        "name": "Test Widget",
        "accounts": ["acc-1"],
        "start_date": null,
        "end_date": null,
        "interval": null,
        "chart_mode": null,
        "widget_type": null,
        "chart_options": null,
        "display_order": 5,
        "width": 6,
        "chart_height": 400,
        "created_at": null,
        "updated_at": null
    }"#;

    let widget: Widget = serde_json::from_str(json).unwrap();
    assert_eq!(widget.display_order, 5);
    assert_eq!(widget.width, 6);
    assert_eq!(widget.chart_height, 400);
    assert_eq!(widget.group_ids, Vec::<String>::new());
}

#[test]
fn test_widget_deserialize_with_group_ids() {
    let json = r#"{
        "id": "test-4",
        "name": "Group Widget",
        "accounts": ["acc-3"],
        "group_ids": ["grp-1", "grp-2"],
        "start_date": null,
        "end_date": null,
        "interval": null,
        "chart_mode": null,
        "widget_type": null,
        "chart_options": null,
        "created_at": null,
        "updated_at": null
    }"#;

    let widget: Widget = serde_json::from_str(json).unwrap();
    assert_eq!(
        widget.group_ids,
        vec!["grp-1".to_string(), "grp-2".to_string()]
    );
    assert_eq!(widget.accounts, vec!["acc-3".to_string()]);
}

#[test]
fn test_widget_serialization_includes_new_fields() {
    let widget = Widget {
        id: "test-3".to_string(),
        name: "Test".to_string(),
        accounts: vec!["acc-1".to_string()],
        group_ids: vec![],
        budget_ids: vec![],
        budget_names: vec![],
        start_date: None,
        end_date: None,
        interval: None,
        chart_mode: None,
        earned_chart_type: None,
        widget_type: None,
        chart_options: None,
        display_order: 3,
        width: 4,
        chart_height: 350,
        created_at: None,
        updated_at: None,
    };

    let json = serde_json::to_string(&widget).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed["display_order"], 3);
    assert_eq!(parsed["width"], 4);
    assert_eq!(parsed["chart_height"], 350);
}
