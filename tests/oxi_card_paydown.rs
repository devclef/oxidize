/// Tests for the credit card paydown analysis endpoint.
///
/// Verifies that transactions for liability (credit card) accounts are correctly
/// classified as payments (debt-reducing), spending (debt-increasing), and interest.

#[cfg(test)]
mod tests {
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use serde_json::json;

    fn make_test_config(url: String) -> Config {
        Config {
            firefly_url: oxidize::config::FireflyUrl::validate(url).unwrap(),
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            account_types: vec!["liability".to_string()],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
            cache_ttl: 300,
            time_ranges: vec!["30d".to_string()],
            default_time_range: "30d".to_string(),
        }
    }

    async fn mock_transactions(
        server: &mut mockito::Server,
        transactions: serde_json::Value,
    ) {
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

    async fn mock_balance_history(
        server: &mut mockito::Server,
        balance_data: serde_json::Value,
    ) {
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(
                r"period=1M".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(balance_data.to_string())
            .create_async()
            .await;
    }

    /// Test: A transfer from card to checking should be classified as a payment (debt-reducing).
    #[tokio::test]
    async fn test_card_paydown_transfer_to_asset_is_payment() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // Transfer: card(99) paid from checking(1). Firefly returns 2 journals.
        // The journal with source_id=99 (card) is classified as a payment.
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

        mock_balance_history(&mut server, json!([])).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        // Find January 2026 entry
        let jan_entry = activity
            .iter()
            .find(|m| m["month"] == "2026-01")
            .unwrap();

        assert!(
            (jan_entry["payments"].as_f64().unwrap() - 500.0).abs() < 0.01,
            "Expected $500 payment, got ${}",
            jan_entry["payments"].as_f64().unwrap()
        );
        assert!(
            jan_entry["spending"].as_f64().unwrap() == 0.0,
            "Expected $0 spending"
        );
        assert!(
            (jan_entry["net_paydown"].as_f64().unwrap() - 500.0).abs() < 0.01,
            "Expected $500 net paydown"
        );
    }

    /// Test: A withdrawal from the card should be classified as spending (debt-increasing).
    #[tokio::test]
    async fn test_card_paydown_withdrawal_is_spending() {
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
                                    "amount": "150.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "88",
                                    "destination_name": "Restaurant",
                                    "category_name": "Dining",
                                    "date": "2026-02-10",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "withdrawal",
                                    "amount": "150.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "88",
                                    "destination_name": "Restaurant",
                                    "category_name": "Dining",
                                    "date": "2026-02-10",
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

        mock_balance_history(&mut server, json!([])).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-02-01".to_string()),
                Some("2026-02-28".to_string()),
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let feb_entry = activity
            .iter()
            .find(|m| m["month"] == "2026-02")
            .unwrap();

        // Both journals are classified as spending (Firefly returns 2 for withdrawals)
        assert!(
            (feb_entry["spending"].as_f64().unwrap() - 300.0).abs() < 0.01,
            "Expected $300 spending (2 journals x $150), got ${}",
            feb_entry["spending"].as_f64().unwrap()
        );
        assert!(
            feb_entry["payments"].as_f64().unwrap() == 0.0,
            "Expected $0 payments"
        );
    }

    /// Test: Transfer from card with "interest" in destination/category should be classified as interest.
    #[tokio::test]
    async fn test_card_paydown_interest_classification() {
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
                                    "amount": "25.50",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "77",
                                    "destination_name": "Interest Expense",
                                    "category_name": "Credit Card Interest",
                                    "date": "2026-03-01",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "25.50",
                                    "source_id": "77",
                                    "source_name": "Interest Expense",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "category_name": "Credit Card Interest",
                                    "date": "2026-03-01",
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

        mock_balance_history(&mut server, json!([])).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-03-01".to_string()),
                Some("2026-03-31".to_string()),
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let mar_entry = activity
            .iter()
            .find(|m| m["month"] == "2026-03")
            .unwrap();

        assert!(
            mar_entry["payments"].as_f64().unwrap() == 0.0,
            "Expected $0 payments"
        );
        assert!(
            mar_entry["spending"].as_f64().unwrap() == 0.0,
            "Expected $0 spending"
        );
        assert!(
            (mar_entry["interest"].as_f64().unwrap() - 25.50).abs() < 0.01,
            "Expected $25.50 interest, got ${}",
            mar_entry["interest"].as_f64().unwrap()
        );
        assert!(
            (mar_entry["net_paydown"].as_f64().unwrap() - (-25.50)).abs() < 0.01,
            "Expected -$25.50 net paydown (interest increases debt)"
        );
    }

    /// Test: Mixed activity in a single month with correct net paydown calculation.
    #[tokio::test]
    async fn test_card_paydown_mixed_activity() {
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
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "date": "2026-04-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "1000.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "date": "2026-04-15",
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
                                    "type": "withdrawal",
                                    "amount": "200.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "88",
                                    "destination_name": "Grocery Store",
                                    "date": "2026-04-20",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "withdrawal",
                                    "amount": "200.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "88",
                                    "destination_name": "Grocery Store",
                                    "date": "2026-04-20",
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

        mock_balance_history(&mut server, json!([])).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-04-01".to_string()),
                Some("2026-04-30".to_string()),
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let apr_entry = activity
            .iter()
            .find(|m| m["month"] == "2026-04")
            .unwrap();

        assert!(
            (apr_entry["payments"].as_f64().unwrap() - 1000.0).abs() < 0.01,
            "Expected $1000 payments"
        );
        assert!(
            (apr_entry["spending"].as_f64().unwrap() - 400.0).abs() < 0.01,
            "Expected $400 spending (2 journals x $200)"
        );
        assert!(
            (apr_entry["net_paydown"].as_f64().unwrap() - 600.0).abs() < 0.01,
            "Expected $600 net paydown ($1000 payments - $400 spending)"
        );

        // Check summary
        let summary = &result["summary"];
        assert!(
            (summary["total_payments"].as_f64().unwrap() - 1000.0).abs() < 0.01,
        );
        assert!(
            (summary["total_spending"].as_f64().unwrap() - 400.0).abs() < 0.01,
        );
        assert!(
            (summary["total_net_paydown"].as_f64().unwrap() - 600.0).abs() < 0.01,
        );
    }

    /// Test: Error when no card accounts are specified.
    #[tokio::test]
    async fn test_card_paydown_no_accounts() {
        let server = mockito::Server::new_async().await;

        let config = make_test_config(server.url());
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec![],
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
            )
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No card accounts specified"));
    }

    /// Test: Balance data is correctly included from the balance history API.
    #[tokio::test]
    async fn test_card_paydown_includes_balance() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(&mut server, json!({"data": []})).await;

        // Mock balance history with card balance data
        mock_balance_history(
            &mut server,
            json!([
                {
                    "label": "Credit Card",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": [
                        {"date": "2026-01-31", "ba": 5000.00},
                        {"date": "2026-02-28", "ba": 4500.00},
                        {"date": "2026-03-31", "ba": 3800.00}
                    ]
                }
            ]),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-01-01".to_string()),
                Some("2026-03-31".to_string()),
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let jan_balance = activity
            .iter()
            .find(|m| m["month"] == "2026-01")
            .unwrap()["balance"]
            .as_f64()
            .unwrap();
        let feb_balance = activity
            .iter()
            .find(|m| m["month"] == "2026-02")
            .unwrap()["balance"]
            .as_f64()
            .unwrap();
        let mar_balance = activity
            .iter()
            .find(|m| m["month"] == "2026-03")
            .unwrap()["balance"]
            .as_f64()
            .unwrap();

        assert!((jan_balance - 5000.0).abs() < 0.01, "Jan balance should be $5000");
        assert!((feb_balance - 4500.0).abs() < 0.01, "Feb balance should be $4500");
        assert!((mar_balance - 3800.0).abs() < 0.01, "Mar balance should be $3800");

        // Check summary current balance
        assert!(
            (result["summary"]["current_balance"].as_f64().unwrap() - 3800.0).abs() < 0.01,
            "Current balance should be $3800"
        );
    }

    /// Test: Projected payoff months is calculated correctly.
    #[tokio::test]
    async fn test_card_paydown_projected_payoff() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // $500 payment in January, no spending
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
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "date": "2026-01-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "500.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
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

        mock_balance_history(
            &mut server,
            json!([
                {
                    "label": "Credit Card",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": [
                        {"date": "2026-01-31", "ba": 4500.00},
                        {"date": "2026-02-28", "ba": 4500.00}
                    ]
                }
            ]),
        )
        .await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-01-01".to_string()),
                Some("2026-02-28".to_string()),
            )
            .await
            .unwrap();

        // With $500/month avg paydown and $4500 balance, projected payoff = 9 months
        let projected = result["summary"]["projected_payoff_months"]
            .as_i64()
            .unwrap();
        assert_eq!(projected, 9, "Expected 9 months to payoff");
    }
}
