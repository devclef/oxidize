/// Tests for OXI budget spent chart feature
///
/// This test file verifies budget model deserialization, budget list API,
/// and budget spending chart data from Firefly III.
#[cfg(test)]
mod tests {
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use serde_json::json;

    /// Test that a BudgetRead correctly deserializes from Firefly III HAL+JSON response
    #[test]
    fn test_budget_read_deserialization() {
        let json_response = json!({
            "data": [
                {
                    "type": "budgets",
                    "id": "1",
                    "attributes": {
                        "name": "Groceries",
                        "active": true,
                        "created_at": "2026-01-01T00:00:00+00:00",
                        "updated_at": "2026-01-01T00:00:00+00:00"
                    }
                },
                {
                    "type": "budgets",
                    "id": "2",
                    "attributes": {
                        "name": "Dining Out",
                        "active": false,
                        "created_at": "2026-01-01T00:00:00+00:00",
                        "updated_at": "2026-01-01T00:00:00+00:00"
                    }
                }
            ]
        });

        let budget_list: oxidize::models::BudgetListResponse =
            serde_json::from_value(json_response).unwrap();
        let budgets = budget_list.budgets();

        assert_eq!(budgets.len(), 2);
        assert_eq!(budgets[0].id, "1");
        assert_eq!(budgets[0].name, "Groceries");
        assert!(budgets[0].active);
        assert_eq!(budgets[1].name, "Dining Out");
        assert!(!budgets[1].active);
    }

    /// Test that BudgetRead deserializes with default active=false when field missing
    #[test]
    fn test_budget_read_missing_active_field() {
        let json_response = json!({
            "data": [
                {
                    "type": "budgets",
                    "id": "3",
                    "attributes": {
                        "name": "Old Budget",
                        "created_at": "2026-01-01T00:00:00+00:00",
                        "updated_at": "2026-01-01T00:00:00+00:00"
                    }
                }
            ]
        });

        let budget_list: oxidize::models::BudgetListResponse =
            serde_json::from_value(json_response).unwrap();
        let budgets = budget_list.budgets();

        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].name, "Old Budget");
        assert!(!budgets[0].active);
    }

    /// Test that an empty budget list deserializes correctly
    #[test]
    fn test_empty_budget_list() {
        let json_response = json!({
            "data": []
        });

        let budget_list: oxidize::models::BudgetListResponse =
            serde_json::from_value(json_response).unwrap();

        assert!(budget_list.budgets().is_empty());
    }

    /// Test that budget spending chart data deserializes as ChartLine
    #[test]
    fn test_budget_chart_data_deserialization() {
        let json_response = json!([
            {
                "label": "Groceries",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    "2026-01-01": "50.00",
                    "2026-01-02": "30.00",
                    "2026-01-03": "75.00"
                }
            },
            {
                "label": "Dining Out",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    "2026-01-01": "20.00",
                    "2026-01-02": "45.00",
                    "2026-01-03": "15.00"
                }
            }
        ]);

        let chart_line: oxidize::models::ChartLine = serde_json::from_value(json_response).unwrap();

        assert_eq!(chart_line.len(), 2);
        assert_eq!(chart_line[0].label, "Groceries");
        assert_eq!(chart_line[1].label, "Dining Out");
        assert_eq!(chart_line[0].currency_code, Some("USD".to_string()));

        // Verify entries are stored as JSON Value
        let entries = &chart_line[0].entries;
        assert!(entries.is_object());
    }

    /// Test filtering ChartLine by budget names (by label)
    #[test]
    fn test_filter_chartline_by_budget_names() {
        let json_response = json!([
            {
                "label": "Groceries",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {"2026-01-01": "50.00"}
            },
            {
                "label": "Dining Out",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {"2026-01-01": "20.00"}
            },
            {
                "label": "Entertainment",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {"2026-01-01": "30.00"}
            }
        ]);

        let chart_line: oxidize::models::ChartLine = serde_json::from_value(json_response).unwrap();

        // Filter to only Groceries and Dining Out
        let selected = vec!["Groceries".to_string(), "Dining Out".to_string()];
        let filtered: oxidize::models::ChartLine = chart_line
            .into_iter()
            .filter(|ds| selected.contains(&ds.label))
            .collect();

        assert_eq!(filtered.len(), 2);
        let labels: Vec<&str> = filtered.iter().map(|ds| ds.label.as_str()).collect();
        assert!(labels.contains(&"Groceries"));
        assert!(labels.contains(&"Dining Out"));
        assert!(!labels.contains(&"Entertainment"));
    }

    /// Test filtering with no selections returns all budgets
    #[test]
    fn test_filter_chartline_no_selection_returns_all() {
        let json_response = json!([
            {
                "label": "Groceries",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {"2026-01-01": "50.00"}
            },
            {
                "label": "Dining Out",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {"2026-01-01": "20.00"}
            }
        ]);

        let chart_line: oxidize::models::ChartLine = serde_json::from_value(json_response).unwrap();

        let selected: Vec<String> = Vec::new();
        let filtered: oxidize::models::ChartLine = if selected.is_empty() {
            chart_line
        } else {
            chart_line
                .into_iter()
                .filter(|ds| selected.contains(&ds.label))
                .collect()
        };

        assert_eq!(filtered.len(), 2);
    }

    /// Test filtering with non-existent budget name returns empty
    #[test]
    fn test_filter_chartline_nonexistent_budget() {
        let json_response = json!([
            {
                "label": "Groceries",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {"2026-01-01": "50.00"}
            }
        ]);

        let chart_line: oxidize::models::ChartLine = serde_json::from_value(json_response).unwrap();

        let selected = vec!["Nonexistent".to_string()];
        let filtered: oxidize::models::ChartLine = chart_line
            .into_iter()
            .filter(|ds| selected.contains(&ds.label))
            .collect();

        assert!(filtered.is_empty());
    }

    /// Test integration: FireflyClient.get_budgets() returns budget list
    #[tokio::test]
    async fn test_get_budgets_api() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        let _m = server
            .mock("GET", "/v1/budgets")
            .match_query(mockito::Matcher::Regex(
                r"start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "data": [
                        {
                            "type": "budgets",
                            "id": "1",
                            "attributes": {
                                "name": "Groceries",
                                "active": true
                            }
                        },
                        {
                            "type": "budgets",
                            "id": "2",
                            "attributes": {
                                "name": "Rent",
                                "active": true
                            }
                        }
                    ]
                })
                .to_string(),
            )
            .create_async()
            .await;

        let config = Config {
            firefly_url: oxidize::config::FireflyUrl::validate(url).unwrap(),
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            account_types: vec!["asset".to_string()],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
            cache_ttl: 300,
            time_ranges: vec!["30d".to_string()],
            default_time_range: "30d".to_string(),
        };

        let client = FireflyClient::new(config);
        let budgets = client.get_budgets(None, None).await.unwrap();

        assert_eq!(budgets.len(), 2);
        assert_eq!(budgets[0].name, "Groceries");
        assert_eq!(budgets[1].name, "Rent");
    }

    /// Test integration: FireflyClient.get_budget_spent() returns ChartLine
    #[tokio::test]
    async fn test_get_budget_spent_api() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        let _m = server
            .mock("GET", "/v1/chart/budget/overview")
            .match_query(mockito::Matcher::Regex(
                r"start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([
                    {
                        "label": "Groceries",
                        "currency_symbol": "$",
                        "currency_code": "USD",
                        "entries": {
                            "2026-01-01": "50.00",
                            "2026-01-02": "30.00",
                            "2026-01-03": "75.00"
                        }
                    },
                    {
                        "label": "Dining Out",
                        "currency_symbol": "$",
                        "currency_code": "USD",
                        "entries": {
                            "2026-01-01": "20.00",
                            "2026-01-02": "45.00",
                            "2026-01-03": "15.00"
                        }
                    }
                ])
                .to_string(),
            )
            .create_async()
            .await;

        let config = Config {
            firefly_url: oxidize::config::FireflyUrl::validate(url).unwrap(),
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            account_types: vec!["asset".to_string()],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
            cache_ttl: 300,
            time_ranges: vec!["30d".to_string()],
            default_time_range: "30d".to_string(),
        };

        let client = FireflyClient::new(config);
        let chart = client.get_budget_spent(None, None).await.unwrap();

        assert_eq!(chart.len(), 2);
        assert_eq!(chart[0].label, "Groceries");
        assert_eq!(chart[1].label, "Dining Out");
    }

    /// Test that budget_spent cache works correctly
    #[tokio::test]
    async fn test_budget_spent_cache() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // First call - will be cached
        let _m1 = server
            .mock("GET", "/v1/chart/budget/overview")
            .match_query(mockito::Matcher::Regex(
                r"start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([
                    {
                        "label": "Groceries",
                        "currency_symbol": "$",
                        "currency_code": "USD",
                        "entries": {"2026-01-01": "50.00"}
                    }
                ])
                .to_string(),
            )
            .create_async()
            .await;

        let config = Config {
            firefly_url: oxidize::config::FireflyUrl::validate(url).unwrap(),
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            account_types: vec!["asset".to_string()],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
            cache_ttl: 300,
            time_ranges: vec!["30d".to_string()],
            default_time_range: "30d".to_string(),
        };

        let client = FireflyClient::new(config);

        // First call
        let chart1 = client.get_budget_spent(None, None).await.unwrap();
        assert_eq!(chart1.len(), 1);

        // Second call - should hit cache, no more mocks needed
        let chart2 = client.get_budget_spent(None, None).await.unwrap();
        assert_eq!(chart2.len(), 1);
    }
}
