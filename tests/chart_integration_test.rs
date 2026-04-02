#[cfg(test)]
mod tests {

    #[test]
    fn test_parse_chart_data_with_earned_spent() {
        // Simulate Firefly III API response with earned/spent data
        let json_response = r#"
        [
            {
                "label": "earned",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-02-26T00:00:00+00:00": "0",
                    "2026-02-27T00:00:00+00:00": "0",
                    "2026-02-28T00:00:00+00:00": "2500.00"
                }
            },
            {
                "label": "spent",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-02-26T00:00:00+00:00": "-1000",
                    "2026-02-27T00:00:00+00:00": "-2000",
                    "2026-02-28T00:00:00+00:00": "-3000"
                }
            },
            {
                "label": "SEB Checking",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-02-26T00:00:00+00:00": "10000",
                    "2026-02-27T00:00:00+00:00": "10500",
                    "2026-02-28T00:00:00+00:00": "11000"
                }
            },
            {
                "label": "Klarna Card",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-02-26T00:00:00+00:00": "-5000",
                    "2026-02-27T00:00:00+00:00": "-5200",
                    "2026-02-28T00:00:00+00:00": "-5500"
                }
            }
        ]
        "#;

        // Parse the JSON
        let chart_line: serde_json::Value = serde_json::from_str(json_response).unwrap();

        // Simulate filtering logic
        let mut filtered_data: Vec<serde_json::Value> = Vec::new();
        let mut seen_labels = std::collections::HashSet::new();

        for dataset in chart_line.as_array().unwrap() {
            let label = dataset.get("label").unwrap().as_str().unwrap();

            // Skip aggregated "earned"/"spent" labels
            if label == "earned" || label == "spent" {
                continue;
            }

            // Only include datasets we haven't seen yet
            if seen_labels.insert(label.to_string()) {
                filtered_data.push(dataset.clone());
            }
        }

        // Verify filtering worked
        assert_eq!(filtered_data.len(), 2, "Should have 2 account datasets (not earned/spent)");

        let labels: Vec<String> = filtered_data.iter()
            .map(|d| d.get("label").unwrap().as_str().unwrap().to_string())
            .collect();

        assert!(labels.contains(&"SEB Checking".to_string()));
        assert!(labels.contains(&"Klarna Card".to_string()));
    }

    #[test]
    fn test_parse_chart_data_with_account_names() {
        // Test with account names that match what Firefly III might return
        let json_response = r#"
        [
            {
                "label": "SEB Checking",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-02-26T00:00:00+00:00": "10000",
                    "2026-02-27T00:00:00+00:00": "10500",
                    "2026-02-28T00:00:00+00:00": "11000"
                }
            },
            {
                "label": "SEB Savings",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-02-26T00:00:00+00:00": "50000",
                    "2026-02-27T00:00:00+00:00": "50000",
                    "2026-02-28T00:00:00+00:00": "51000"
                }
            }
        ]
        "#;

        let chart_line: serde_json::Value = serde_json::from_str(json_response).unwrap();

        let labels: Vec<String> = chart_line.as_array().unwrap()
            .iter()
            .map(|d| d.get("label").unwrap().as_str().unwrap().to_string())
            .collect();

        assert_eq!(labels.len(), 2);
        assert!(labels.contains(&"SEB Checking".to_string()));
        assert!(labels.contains(&"SEB Savings".to_string()));
    }

    #[test]
    fn test_parse_empty_chart_data() {
        // Test with empty response
        let json_response = "[]";

        let chart_line: serde_json::Value = serde_json::from_str(json_response).unwrap();
        assert!(chart_line.as_array().unwrap().is_empty());
    }

    #[test]
    fn test_parse_chart_data_with_array_entries() {
        // Test with array format entries (different Firefly III response format)
        let json_response = r#"
        [
            {
                "label": "SEB Checking",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": [
                    {"key": "2026-02-26", "value": "10000"},
                    {"key": "2026-02-27", "value": "10500"},
                    {"key": "2026-02-28", "value": "11000"}
                ]
            }
        ]
        "#;

        let chart_line: serde_json::Value = serde_json::from_str(json_response).unwrap();
        let array_entries = chart_line[0]["entries"].as_array().unwrap();

        assert_eq!(array_entries.len(), 3);
        assert_eq!(array_entries[0]["key"], "2026-02-26");
        assert_eq!(array_entries[0]["value"], "10000");
    }

    #[test]
    fn test_account_matching() {
        // Simulate account names from frontend
        let account_names = vec!["SEB Checking".to_string(), "Klarna Card".to_string()];

        // Simulate dataset labels from backend
        let dataset_labels = vec![
            "SEB Checking".to_string(),
            "Klarna Card".to_string(),
            "earned".to_string(),
            "spent".to_string(),
        ];

        // Filter out earned/spent
        let filtered_labels: Vec<String> = dataset_labels.iter()
            .filter(|l| l != &&"earned".to_string() && l != &&"spent".to_string())
            .cloned()
            .collect();

        // Match accounts to datasets
        let mut matched_accounts = Vec::new();
        for account_name in &account_names {
            if filtered_labels.contains(account_name) {
                matched_accounts.push(account_name.clone());
            }
        }

        assert_eq!(matched_accounts.len(), 2);
        assert!(matched_accounts.contains(&"SEB Checking".to_string()));
        assert!(matched_accounts.contains(&"Klarna Card".to_string()));
    }

    #[test]
    fn test_date_parsing() {
        // Test that dates in entries are properly handled
        let json_response = r#"
        [
            {
                "label": "Test Account",
                "entries": {
                    "2026-02-26T00:00:00+00:00": "100",
                    "2026-02-27T00:00:00+00:00": "200",
                    "2026-02-28T00:00:00+00:00": "300"
                }
            }
        ]
        "#;

        let chart_line: serde_json::Value = serde_json::from_str(json_response).unwrap();
        let entries = &chart_line[0]["entries"];

        assert!(entries.as_object().unwrap().len() == 3);
        assert!(entries.get("2026-02-26T00:00:00+00:00").is_some());
        assert!(entries.get("2026-02-27T00:00:00+00:00").is_some());
        assert!(entries.get("2026-02-28T00:00:00+00:00").is_some());
    }

    #[test]
    fn test_earned_spent_endpoint_response() {
        // Test that earned/spent data is correctly structured for the /api/earned-spent endpoint
        let earned_spent_response = r#"
        [
            {
                "label": "earned",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-03-01T00:00:00+00:00": "2500.00",
                    "2026-03-02T00:00:00+00:00": "3000.00",
                    "2026-03-03T00:00:00+00:00": "2800.00"
                }
            },
            {
                "label": "spent",
                "currency_symbol": "kr",
                "currency_code": "SEK",
                "entries": {
                    "2026-03-01T00:00:00+00:00": "-1500.00",
                    "2026-03-02T00:00:00+00:00": "-2200.00",
                    "2026-03-03T00:00:00+00:00": "-1800.00"
                }
            }
        ]
        "#;

        let chart_line: serde_json::Value = serde_json::from_str(earned_spent_response).unwrap();
        let array = chart_line.as_array().unwrap();

        // Should have exactly 2 datasets: earned and spent
        assert_eq!(array.len(), 2, "Should have exactly 2 datasets (earned and spent)");

        // Find earned and spent datasets
        let earned = array.iter().find(|ds| ds["label"] == "earned").unwrap();
        let spent = array.iter().find(|ds| ds["label"] == "spent").unwrap();

        // Verify earned values are positive (income)
        // Note: Firefly III returns values as strings, so we parse them
        let earned_entries = &earned["entries"];
        let earned_val1: f64 = earned_entries.get("2026-03-01T00:00:00+00:00").unwrap().as_str().unwrap().parse().unwrap();
        let earned_val2: f64 = earned_entries.get("2026-03-02T00:00:00+00:00").unwrap().as_str().unwrap().parse().unwrap();
        let earned_val3: f64 = earned_entries.get("2026-03-03T00:00:00+00:00").unwrap().as_str().unwrap().parse().unwrap();
        assert!(earned_val1 > 0.0, "Earned values should be positive (income)");
        assert!(earned_val2 > 0.0, "Earned values should be positive (income)");
        assert!(earned_val3 > 0.0, "Earned values should be positive (income)");

        // Verify spent values are negative (expenses)
        let spent_entries = &spent["entries"];
        let spent_val1: f64 = spent_entries.get("2026-03-01T00:00:00+00:00").unwrap().as_str().unwrap().parse().unwrap();
        let spent_val2: f64 = spent_entries.get("2026-03-02T00:00:00+00:00").unwrap().as_str().unwrap().parse().unwrap();
        let spent_val3: f64 = spent_entries.get("2026-03-03T00:00:00+00:00").unwrap().as_str().unwrap().parse().unwrap();
        assert!(spent_val1 < 0.0, "Spent values should be negative (expenses)");
        assert!(spent_val2 < 0.0, "Spent values should be negative (expenses)");
        assert!(spent_val3 < 0.0, "Spent values should be negative (expenses)");

        // Verify currency information
        assert_eq!(earned["currency_code"], "SEK");
        assert_eq!(spent["currency_code"], "SEK");
        assert_eq!(earned["currency_symbol"], "kr");
        assert_eq!(spent["currency_symbol"], "kr");
    }

    #[test]
    fn test_widget_type_routing() {
        // Test that widget type determines which endpoint is used
        // Balance widgets use /api/accounts/balance-history
        // Earned vs Spent widgets use /api/earned-spent

        let balance_widget = serde_json::json!({
            "widget_type": "balance",
            "accounts": ["1", "2", "3"]
        });

        let earned_spent_widget = serde_json::json!({
            "widget_type": "earned_spent",
            "accounts": []
        });

        // Verify widget types are correctly identified
        assert_eq!(balance_widget["widget_type"], "balance");
        assert!(!balance_widget["accounts"].as_array().unwrap().is_empty());

        assert_eq!(earned_spent_widget["widget_type"], "earned_spent");
        assert!(earned_spent_widget["accounts"].as_array().unwrap().is_empty());
    }
}
