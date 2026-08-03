/// Tests for budget comparison feature: current year vs previous year
#[cfg(test)]
mod tests {
    use oxidize::models::BudgetPeriodLimit;

    /// Test BudgetPeriodLimit from_value with standard Firefly III response
    #[test]
    fn test_budget_period_limit_from_value() {
        let value = serde_json::json!({
            "data": {
                "attributes": {
                    "period_start": "2026-01-01T00:00:00+00:00",
                    "period_end": "2026-01-31T23:59:59+00:00",
                    "currency_code": "USD",
                    "currency_symbol": "$",
                    "period_limit": "500.00",
                    "period_spent": "420.50"
                }
            }
        });

        let limit = BudgetPeriodLimit::from_value(&value).expect("should parse");
        assert_eq!(limit.currency_code, "USD");
        assert_eq!(limit.currency_symbol, "$");
        assert!((limit.period_limit - 500.00).abs() < f64::EPSILON);
        assert!((limit.period_spent - 420.50).abs() < f64::EPSILON);
        assert_eq!(limit.month_index(), Some(1));
        assert_eq!(limit.year(), Some(2026));
    }

    /// Test BudgetPeriodLimit with plain date format (no time)
    #[test]
    fn test_budget_period_limit_plain_date() {
        let value = serde_json::json!({
            "data": {
                "attributes": {
                    "period_start": "2026-07-01",
                    "period_end": "2026-07-31",
                    "currency_code": "SEK",
                    "currency_symbol": "kr",
                    "period_limit": "3000",
                    "period_spent": "2750"
                }
            }
        });

        let limit = BudgetPeriodLimit::from_value(&value).expect("should parse");
        assert_eq!(limit.month_index(), Some(7));
        assert_eq!(limit.year(), Some(2026));
        assert!((limit.period_limit - 3000.0).abs() < f64::EPSILON);
    }

    /// Test BudgetPeriodLimit with missing optional fields defaults gracefully
    #[test]
    fn test_budget_period_limit_missing_optional_fields() {
        let value = serde_json::json!({
            "data": {
                "attributes": {
                    "period_start": "2025-03-01T00:00:00+00:00",
                    "period_end": "2025-03-31T23:59:59+00:00",
                    "currency_code": "EUR",
                    "currency_symbol": "",
                    "period_limit": "100.00",
                    "period_spent": "0.00"
                }
            }
        });

        let limit = BudgetPeriodLimit::from_value(&value).expect("should parse");
        assert_eq!(limit.month_index(), Some(3));
        assert_eq!(limit.year(), Some(2025));
        assert_eq!(limit.currency_symbol, "");
        assert!((limit.period_spent - 0.0).abs() < f64::EPSILON);
    }

    /// Test BudgetPeriodLimit returns None when missing required fields
    #[test]
    fn test_budget_period_limit_missing_required_field() {
        let value = serde_json::json!({
            "data": {
                "attributes": {
                    "period_end": "2026-01-31T23:59:59+00:00",
                    "currency_code": "USD"
                }
            }
        });

        let result = BudgetPeriodLimit::from_value(&value);
        assert!(result.is_none(), "should fail without period_start");
    }

    /// Test BudgetPeriodLimit serialization/deserialization round-trip
    #[test]
    fn test_budget_period_limit_roundtrip() {
        let original = BudgetPeriodLimit {
            period_start: "2026-06-01T00:00:00+00:00".to_string(),
            period_end: "2026-06-30T23:59:59+00:00".to_string(),
            currency_code: "USD".to_string(),
            currency_symbol: "$".to_string(),
            period_limit: 450.0,
            period_spent: 320.75,
        };

        let serialized = serde_json::to_string(&original).expect("should serialize");
        let deserialized: BudgetPeriodLimit =
            serde_json::from_str(&serialized).expect("should deserialize");

        assert_eq!(deserialized.period_start, original.period_start);
        assert_eq!(deserialized.period_end, original.period_end);
        assert_eq!(deserialized.currency_code, original.currency_code);
        assert_eq!(deserialized.currency_symbol, original.currency_symbol);
        assert!((deserialized.period_limit - original.period_limit).abs() < f64::EPSILON);
        assert!((deserialized.period_spent - original.period_spent).abs() < f64::EPSILON);
    }

    /// Test BudgetPeriodLimit with December month index
    #[test]
    fn test_budget_period_limit_december() {
        let value = serde_json::json!({
            "data": {
                "attributes": {
                    "period_start": "2025-12-01T00:00:00+00:00",
                    "period_end": "2025-12-31T23:59:59+00:00",
                    "currency_code": "USD",
                    "currency_symbol": "$",
                    "period_limit": "800.00",
                    "period_spent": "750.00"
                }
            }
        });

        let limit = BudgetPeriodLimit::from_value(&value).expect("should parse");
        assert_eq!(limit.month_index(), Some(12));
        assert_eq!(limit.year(), Some(2025));
    }

    /// Test BudgetComparisonProjections serialization
    #[test]
    fn test_budget_comparison_projections_serialization() {
        let proj = oxidize::models::BudgetComparisonProjections {
            current_year_total: 1500.0,
            current_year_projected: 6000.0,
            previous_year_total: 5500.0,
            current_year_limit_total: Some(5800.0),
            previous_year_limit_total: Some(5000.0),
            vs_last_year: "+9.1%".to_string(),
            vs_limit: Some("+3.4%".to_string()),
            on_track: false,
        };

        let json = serde_json::to_string(&proj).expect("should serialize");
        assert!(json.contains("1500.0"));
        assert!(json.contains("6000.0"));
        assert!(json.contains("+9.1%"));
        assert!(json.contains("false"));
    }

    /// Test BudgetComparison serialization
    #[test]
    fn test_budget_comparison_serialization() {
        let comparison = oxidize::models::BudgetComparison {
            budget_name: "Groceries".to_string(),
            current_year: 2026,
            previous_year: 2025,
            months: vec![
                "Jan".to_string(),
                "Feb".to_string(),
                "Mar".to_string(),
                "Apr".to_string(),
                "May".to_string(),
                "Jun".to_string(),
                "Jul".to_string(),
                "Aug".to_string(),
                "Sep".to_string(),
                "Oct".to_string(),
                "Nov".to_string(),
                "Dec".to_string(),
            ],
            current_year_spent: vec![
                Some(450.0),
                Some(520.0),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ],
            previous_year_spent: vec![
                Some(400.0),
                Some(480.0),
                Some(510.0),
                Some(390.0),
                Some(420.0),
                Some(380.0),
                Some(440.0),
                Some(460.0),
                Some(430.0),
                Some(410.0),
                Some(450.0),
                Some(400.0),
            ],
            current_year_limit: vec![
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
                Some(500.0),
            ],
            previous_year_limit: vec![
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
                Some(400.0),
            ],
            current_year_running: vec![
                Some(450.0),
                Some(970.0),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ],
            previous_year_running: vec![
                Some(400.0),
                Some(880.0),
                Some(1390.0),
                Some(1780.0),
                Some(2200.0),
                Some(2580.0),
                Some(3020.0),
                Some(3480.0),
                Some(3910.0),
                Some(4320.0),
                Some(4770.0),
                Some(5170.0),
            ],
            projections: oxidize::models::BudgetComparisonProjections {
                current_year_total: 970.0,
                current_year_projected: 5820.0,
                previous_year_total: 5170.0,
                current_year_limit_total: Some(6000.0),
                previous_year_limit_total: Some(4800.0),
                vs_last_year: "+12.6%".to_string(),
                vs_limit: Some("-2.9%".to_string()),
                on_track: true,
            },
            currency_symbol: Some("$".to_string()),
            currency_code: Some("USD".to_string()),
        };

        let json = serde_json::to_string(&comparison).expect("should serialize");
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

        assert_eq!(parsed["budget_name"], "Groceries");
        assert_eq!(parsed["current_year"], 2026);
        assert_eq!(parsed["months"].as_array().unwrap().len(), 12);
        assert!(parsed["current_year_spent"][0].is_f64());
        assert!(parsed["current_year_spent"][2].is_null());
        assert_eq!(parsed["projections"]["on_track"], true);
    }
}

/// Test AvgCostMode serialization
#[test]
fn test_avg_cost_mode_serialization() {
    let mode_last_n = oxidize::models::AvgCostMode::LastNMonths;
    let json = serde_json::to_string(&mode_last_n).expect("should serialize");
    assert_eq!(json, "\"last_n_months\"");

    let mode_prev = oxidize::models::AvgCostMode::PreviousYearSameMonth;
    let json = serde_json::to_string(&mode_prev).expect("should serialize");
    assert_eq!(json, "\"previous_year_same_month\"");
}

/// Test AvgCostMode deserialization
#[test]
fn test_avg_cost_mode_deserialization() {
    let mode: oxidize::models::AvgCostMode =
        serde_json::from_str("\"last_n_months\"").expect("should deserialize");
    match mode {
        oxidize::models::AvgCostMode::LastNMonths => {}
        _ => panic!("expected LastNMonths"),
    }

    let mode: oxidize::models::AvgCostMode =
        serde_json::from_str("\"previous_year_same_month\"").expect("should deserialize");
    match mode {
        oxidize::models::AvgCostMode::PreviousYearSameMonth => {}
        _ => panic!("expected PreviousYearSameMonth"),
    }
}

/// Test AvgCostBudget serialization
#[test]
fn test_avg_cost_budget_serialization() {
    let budget = oxidize::models::AvgCostBudget {
        budget_name: "Groceries".to_string(),
        mode: oxidize::models::AvgCostMode::LastNMonths,
        months_count: 6,
        monthly_data: vec![
            oxidize::models::AvgCostMonthlyPoint {
                label: "Jan 2026".to_string(),
                amount: 450.0,
            },
            oxidize::models::AvgCostMonthlyPoint {
                label: "Feb 2026".to_string(),
                amount: 520.0,
            },
        ],
        average_cost: 485.0,
        total_spend: 970.0,
        min_spend: 450.0,
        max_spend: 520.0,
        currency_symbol: Some("$".to_string()),
        currency_code: Some("USD".to_string()),
    };

    let json = serde_json::to_string(&budget).expect("should serialize");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

    assert_eq!(parsed["budget_name"], "Groceries");
    assert_eq!(parsed["mode"], "last_n_months");
    assert_eq!(parsed["months_count"], 6);
    assert_eq!(parsed["average_cost"], 485.0);
    assert_eq!(parsed["total_spend"], 970.0);
    assert_eq!(parsed["monthly_data"].as_array().unwrap().len(), 2);
    assert_eq!(parsed["monthly_data"][0]["label"], "Jan 2026");
    assert_eq!(parsed["monthly_data"][0]["amount"], 450.0);
}

/// Test AvgCostResponse serialization
#[test]
fn test_avg_cost_response_serialization() {
    let response = oxidize::models::AvgCostResponse {
        budgets: vec![oxidize::models::AvgCostBudget {
            budget_name: "Groceries".to_string(),
            mode: oxidize::models::AvgCostMode::LastNMonths,
            months_count: 6,
            monthly_data: vec![],
            average_cost: 500.0,
            total_spend: 3000.0,
            min_spend: 400.0,
            max_spend: 600.0,
            currency_symbol: Some("$".to_string()),
            currency_code: Some("USD".to_string()),
        }],
        mode: oxidize::models::AvgCostMode::LastNMonths,
        months_count: 6,
        start_date: "2026-01-01".to_string(),
        end_date: "2026-06-30".to_string(),
        target_month: None,
        target_year: None,
    };

    let json = serde_json::to_string(&response).expect("should serialize");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

    assert_eq!(parsed["budgets"].as_array().unwrap().len(), 1);
    assert_eq!(parsed["mode"], "last_n_months");
    assert_eq!(parsed["months_count"], 6);
    assert_eq!(parsed["start_date"], "2026-01-01");
    assert_eq!(parsed["end_date"], "2026-06-30");
}

/// Test AvgCostBudget with empty monthly data
#[test]
fn test_avg_cost_budget_empty_data() {
    let budget = oxidize::models::AvgCostBudget {
        budget_name: "Unused".to_string(),
        mode: oxidize::models::AvgCostMode::PreviousYearSameMonth,
        months_count: 7,
        monthly_data: vec![],
        average_cost: 0.0,
        total_spend: 0.0,
        min_spend: 0.0,
        max_spend: 0.0,
        currency_symbol: Some("$".to_string()),
        currency_code: Some("USD".to_string()),
    };

    let json = serde_json::to_string(&budget).expect("should serialize");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

    assert_eq!(parsed["average_cost"], 0.0);
    assert_eq!(parsed["total_spend"], 0.0);
    assert!(parsed["monthly_data"].as_array().unwrap().is_empty());
}

/// Test AvgCostMonthlyPoint serialization
#[test]
fn test_avg_cost_monthly_point_serialization() {
    let point = oxidize::models::AvgCostMonthlyPoint {
        label: "Mar 2025".to_string(),
        amount: 375.50,
    };

    let json = serde_json::to_string(&point).expect("should serialize");
    let parsed: serde_json::Value = serde_json::from_str(&json).expect("should parse");

    assert_eq!(parsed["label"], "Mar 2025");
    assert!((parsed["amount"].as_f64().unwrap() - 375.50).abs() < f64::EPSILON);
}
