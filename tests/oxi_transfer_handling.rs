/// Tests for transfer handling in expense charts and Sankey flows.
///
/// Verifies that transfers from selected accounts to non-selected accounts
/// are correctly counted as "spent" (outgoing expenses) in:
/// - get_expenses_by_category
/// - Sankey category/budget/subcategory flows
///
/// Also verifies that transfers between two selected accounts are excluded
/// (internal transfers should not count as spending).

#[cfg(test)]
mod tests {
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use oxidize::models::Exclusions;
    use oxidize::models::SankeyFlowType;
    use serde_json::json;

    /// Helper to create a test config pointing to a mockito server.
    fn make_test_config(url: String) -> Config {
        Config {
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
        }
    }

    /// Helper to set up a mock transactions endpoint that returns the given transactions.
    async fn mock_transactions(server: &mut mockito::Server, transactions: serde_json::Value) {
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(
                r"start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(transactions.to_string())
            .create_async()
            .await;
    }

    /// Test: get_expenses_by_category should include transfers from selected
    /// accounts to non-selected accounts as expenses with their category.
    #[tokio::test]
    async fn test_expenses_by_category_includes_outbound_transfers() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // Transaction: transfer from checking(1) to credit_card(99) with category "Credit Card Payments"
        // Account 1 is selected, account 99 is NOT selected.
        // This transfer SHOULD show up as an expense in the "Credit Card Payments" category.
        // Note: Firefly III returns 2 journals per transaction - one from each account's perspective.
        // Only the journal with source_id=1 (checking) counts as "spent".
        mock_transactions(
            &mut server,
            json!({
                "data": [
                    {
                        "type": "transactions",
                        "id": "1",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "transfer",
                                    "amount": "500.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "category_name": "Credit Card Payments",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "500.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "category_name": "Credit Card Payments",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        // Only account 1 (checking) is selected
        let chart = client
            .get_expenses_by_category(
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                Some("1M".to_string()),
                Some(vec!["1".to_string()]),
                None,
                &Exclusions::default(),
            )
            .await
            .unwrap();

        // Should have one dataset: "Credit Card Payments" with $500
        assert_eq!(chart.len(), 1, "Should have 1 category");
        assert_eq!(chart[0].label, "Credit Card Payments");

        let entries = &chart[0].entries;
        assert!(entries.is_object());
        let total: f64 = entries
            .as_object()
            .unwrap()
            .values()
            .filter_map(|v| v.as_f64())
            .sum();
        assert!(
            (total - 500.0).abs() < 0.01,
            "Expected $500, got ${}",
            total
        );
    }

    /// Test: get_expenses_by_category should NOT include transfers between
    /// two selected accounts (internal transfer).
    #[tokio::test]
    async fn test_expenses_by_category_excludes_internal_transfers() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // Transaction: transfer from checking(1) to savings(2), both selected.
        // This is an internal transfer and should NOT show up as an expense.
        mock_transactions(
            &mut server,
            json!({
                "data": [
                    {
                        "type": "transactions",
                        "id": "1",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "transfer",
                                    "amount": "1000.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "2",
                                    "destination_name": "Savings",
                                    "category_name": "Savings Transfer",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "1000.00",
                                    "source_id": "2",
                                    "source_name": "Savings",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "category_name": "Savings Transfer",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        // Both accounts 1 and 2 are selected
        let chart = client
            .get_expenses_by_category(
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                Some("1M".to_string()),
                Some(vec!["1".to_string(), "2".to_string()]),
                None,
                &Exclusions::default(),
            )
            .await
            .unwrap();

        // Should have no datasets (internal transfer excluded)
        assert_eq!(chart.len(), 0, "Internal transfers should be excluded");
    }

    /// Test: Sankey category flow should include transfers from selected
    /// accounts to non-selected accounts.
    #[tokio::test]
    async fn test_sankey_category_includes_outbound_transfers() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(
            &mut server,
            json!({
                "data": [
                    {
                        "type": "transactions",
                        "id": "1",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "transfer",
                                    "amount": "500.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "category_name": "Payments:Credit Card",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "500.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "category_name": "Payments:Credit Card",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let flows = client
            .get_sankey_flows(
                vec!["1".to_string()],
                SankeyFlowType::Category,
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                None,
                None,
                None,
                &Exclusions::default(),
            )
            .await
            .unwrap();

        // Should have 1 link: Checking -> Payments with $500
        assert_eq!(flows.links.len(), 1, "Should have 1 link");
        assert_eq!(flows.links[0].source, "Checking");
        assert_eq!(flows.links[0].target, "Payments");
        assert!(
            (flows.links[0].amount - 500.0).abs() < 0.01,
            "Expected $500, got ${}",
            flows.links[0].amount
        );
    }

    /// Test: Sankey category flow should NOT include transfers between
    /// two selected accounts.
    #[tokio::test]
    async fn test_sankey_category_excludes_internal_transfers() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(
            &mut server,
            json!({
                "data": [
                    {
                        "type": "transactions",
                        "id": "1",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "transfer",
                                    "amount": "1000.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "2",
                                    "destination_name": "Savings",
                                    "category_name": "Savings Transfer",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "1000.00",
                                    "source_id": "2",
                                    "source_name": "Savings",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "category_name": "Savings Transfer",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        // Both accounts selected
        let flows = client
            .get_sankey_flows(
                vec!["1".to_string(), "2".to_string()],
                SankeyFlowType::Category,
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                None,
                None,
                None,
                &Exclusions::default(),
            )
            .await
            .unwrap();

        assert_eq!(
            flows.links.len(),
            0,
            "Internal transfers should not appear in Sankey category flow"
        );
    }

    /// Test: Sankey budget flow should include transfers with a budget
    /// from selected to non-selected accounts.
    #[tokio::test]
    async fn test_sankey_budget_includes_outbound_transfers() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(
            &mut server,
            json!({
                "data": [
                    {
                        "type": "transactions",
                        "id": "1",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "transfer",
                                    "amount": "300.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "budget_name": "Credit Card Payments",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "300.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "budget_name": "Credit Card Payments",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let flows = client
            .get_sankey_flows(
                vec!["1".to_string()],
                SankeyFlowType::Budget,
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                None,
                None,
                None,
                &Exclusions::default(),
            )
            .await
            .unwrap();

        assert_eq!(flows.links.len(), 1);
        assert_eq!(flows.links[0].source, "Checking");
        assert_eq!(flows.links[0].target, "Credit Card Payments");
        assert!(
            (flows.links[0].amount - 300.0).abs() < 0.01,
            "Expected $300, got ${}",
            flows.links[0].amount
        );
    }

    /// Test: Sankey subcategory flow should include transfers with a category
    /// from selected to non-selected accounts.
    #[tokio::test]
    async fn test_sankey_subcategory_includes_outbound_transfers() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(
            &mut server,
            json!({
                "data": [
                    {
                        "type": "transactions",
                        "id": "1",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "transfer",
                                    "amount": "250.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "category_name": "Payments:Credit Card",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "250.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "category_name": "Payments:Credit Card",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let flows = client
            .get_sankey_flows(
                vec!["1".to_string()],
                SankeyFlowType::Subcategory,
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                None,
                None,
                None,
                &Exclusions::default(),
            )
            .await
            .unwrap();

        assert_eq!(flows.links.len(), 1);
        assert_eq!(flows.links[0].source, "Checking");
        assert_eq!(flows.links[0].target, "Payments > Credit Card");
        assert!(
            (flows.links[0].amount - 250.0).abs() < 0.01,
            "Expected $250, got ${}",
            flows.links[0].amount
        );
    }

    /// Test: withdrawals should still work correctly alongside transfers.
    #[tokio::test]
    async fn test_expenses_by_category_mix_of_withdrawals_and_transfers() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(
            &mut server,
            json!({
                "data": [
                    {
                        "type": "transactions",
                        "id": "1",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "withdrawal",
                                    "amount": "100.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "88",
                                    "destination_name": "Grocery Store",
                                    "category_name": "Groceries",
                                    "date": "2026-01-10",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "withdrawal",
                                    "amount": "100.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "88",
                                    "destination_name": "Grocery Store",
                                    "category_name": "Groceries",
                                    "date": "2026-01-10",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    },
                    {
                        "type": "transactions",
                        "id": "2",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "transfer",
                                    "amount": "500.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "category_name": "Credit Card Payments",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "500.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "category_name": "Credit Card Payments",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let chart = client
            .get_expenses_by_category(
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                Some("1M".to_string()),
                Some(vec!["1".to_string()]),
                None,
                &Exclusions::default(),
            )
            .await
            .unwrap();

        // Should have 2 datasets: Credit Card Payments ($500) and Groceries ($200)
        assert_eq!(chart.len(), 2, "Should have 2 categories");

        // Find each category
        let labels: Vec<&str> = chart.iter().map(|ds| ds.label.as_str()).collect();
        assert!(labels.contains(&"Credit Card Payments"));
        assert!(labels.contains(&"Groceries"));

        // Check amounts
        for ds in &chart {
            let total: f64 = ds
                .entries
                .as_object()
                .unwrap()
                .values()
                .filter_map(|v| v.as_f64())
                .sum();
            if ds.label == "Credit Card Payments" {
                assert!(
                    (total - 500.0).abs() < 0.01,
                    "Credit Card Payments should be $500, got ${}",
                    total
                );
            } else if ds.label == "Groceries" {
                // Both withdrawal journals count (Firefly III returns 2 for the same withdrawal)
                assert!(
                    (total - 200.0).abs() < 0.01,
                    "Groceries should be $200, got ${}",
                    total
                );
            }
        }
    }
}
