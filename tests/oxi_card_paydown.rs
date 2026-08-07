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

    async fn mock_balance_history(server: &mut mockito::Server, balance_data: serde_json::Value) {
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(r"period=1M".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(balance_data.to_string())
            .create_async()
            .await;
    }

    /// Mock the /v1/accounts endpoint to provide account type info for transaction classification.
    async fn mock_accounts(server: &mut mockito::Server, accounts: serde_json::Value) {
        // The card-paydown endpoint fetches accounts per type.
        // Register a mock for each type-filtered request, returning only matching accounts.
        let all_accounts = accounts.clone();
        for atype in &["asset", "expense", "revenue", "liability", "liabilities", "cash", "loan"] {
            let filtered: Vec<serde_json::Value> = all_accounts["data"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|a| {
                    a["attributes"]["type"]
                        .as_str()
                        .map(|t| t == *atype)
                        .unwrap_or(false)
                })
                .cloned()
                .collect();
            server
                .mock("GET", "/v1/accounts")
                .match_query(mockito::Matcher::UrlEncoded(
                    "type".to_string(),
                    atype.to_string(),
                ))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(serde_json::json!({ "data": filtered }).to_string())
                .create_async()
                .await;
        }
        // Also register the base URL mock (no type filter) for other endpoints.
        server
            .mock("GET", "/v1/accounts")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(accounts.to_string())
            .create_async()
            .await;
    }

    /// Standard account mock data used across tests.
    /// Card(99)=liability, Checking(1)=asset, Restaurant(88)=expense, Grocery(77)=expense.
    fn default_accounts_mock() -> serde_json::Value {
        json!({
            "data": [
                {
                    "id": "99",
                    "attributes": {
                        "name": "Credit Card",
                        "type": "liability",
                        "current_balance": "5000.00",
                        "currency_symbol": "$"
                    }
                },
                {
                    "id": "1",
                    "attributes": {
                        "name": "Checking",
                        "type": "asset",
                        "current_balance": "10000.00",
                        "currency_symbol": "$"
                    }
                },
                {
                    "id": "88",
                    "attributes": {
                        "name": "Restaurant",
                        "type": "expense",
                        "current_balance": "0",
                        "currency_symbol": "$"
                    }
                },
                {
                    "id": "77",
                    "attributes": {
                        "name": "Grocery Store",
                        "type": "expense",
                        "current_balance": "0",
                        "currency_symbol": "$"
                    }
                },
                {
                    "id": "55",
                    "attributes": {
                        "name": "Credit Card Spending",
                        "type": "revenue",
                        "current_balance": "0",
                        "currency_symbol": "$"
                    }
                }
            ]
        })
    }

    /// Test: A transfer from card to checking (asset) should be classified as a payment (debt-reducing).
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

        mock_accounts(&mut server, default_accounts_mock()).await;
        mock_balance_history(&mut server, json!([])).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                false,
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        // Find January 2026 entry
        let jan_entry = activity.iter().find(|m| m["month"] == "2026-01").unwrap();

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
    /// Firefly III returns a single journal for withdrawals.
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
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        mock_accounts(&mut server, default_accounts_mock()).await;
        mock_balance_history(&mut server, json!([])).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-02-01".to_string()),
                Some("2026-02-28".to_string()),
                false,
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let feb_entry = activity.iter().find(|m| m["month"] == "2026-02").unwrap();

        assert!(
            (feb_entry["spending"].as_f64().unwrap() - 150.0).abs() < 0.01,
            "Expected $150 spending, got ${}",
            feb_entry["spending"].as_f64().unwrap()
        );
        assert!(
            feb_entry["payments"].as_f64().unwrap() == 0.0,
            "Expected $0 payments"
        );
    }

    /// Test: A transfer from card to an expense account should be classified as spending
    /// (debt-increasing), NOT as a payment. This is the default Firefly III behavior for
    /// credit card purchases (when default destination is "use a revenue account").
    #[tokio::test]
    async fn test_card_paydown_transfer_to_revenue_is_spending() {
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
                                    "amount": "200.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "55",
                                    "destination_name": "Credit Card Spending",
                                    "date": "2026-03-15",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "200.00",
                                    "source_id": "55",
                                    "source_name": "Credit Card Spending",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "date": "2026-03-15",
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

        mock_accounts(&mut server, default_accounts_mock()).await;
        mock_balance_history(&mut server, json!([])).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-03-01".to_string()),
                Some("2026-03-31".to_string()),
                false,
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let mar_entry = activity.iter().find(|m| m["month"] == "2026-03").unwrap();

        assert!(
            (mar_entry["spending"].as_f64().unwrap() - 200.0).abs() < 0.01,
            "Expected $200 spending (transfer to revenue), got ${}",
            mar_entry["spending"].as_f64().unwrap()
        );
        assert!(
            mar_entry["payments"].as_f64().unwrap() == 0.0,
            "Expected $0 payments (transfer to revenue is spending, not payment)"
        );
    }

    /// Test: Interest is detected from "Interest:" transaction descriptions.
    /// Given: start_balance=5000, spending=300, payments=1000, interest=50, end_balance=4350
    /// Expected net_paydown = 1000 - 300 - 50 = 650
    #[tokio::test]
    async fn test_card_paydown_interest_from_balance_delta() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // Spending of $300, payment of $1000, interest of $50 in March
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
                                    "amount": "300.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "88",
                                    "destination_name": "Grocery Store",
                                    "date": "2026-03-15",
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
                                    "amount": "1000.00",
                                    "source_id": "1",
                                    "source_name": "Checking",
                                    "destination_id": "99",
                                    "destination_name": "Credit Card",
                                    "date": "2026-03-20",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                },
                                {
                                    "type": "transfer",
                                    "amount": "1000.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "1",
                                    "destination_name": "Checking",
                                    "date": "2026-03-20",
                                    "currency_code": "USD",
                                    "currency_symbol": "$"
                                }
                            ]
                        }
                    },
                    {
                        "type": "transactions",
                        "id": "3",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "withdrawal",
                                    "amount": "50.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "90",
                                    "destination_name": "Interest",
                                    "date": "2026-03-01",
                                    "currency_code": "USD",
                                    "currency_symbol": "$",
                                    "description": "Interest: Credit Card"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        // Balance data in Firefly III array format with key/value
        // Interest = 4350 - 5000 - 300 + 1000 = 50
        mock_balance_history(
            &mut server,
            json!([
                {
                    "label": "Credit Card",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": [
                        {"key": "2026-02-28", "value": "5000.00"},
                        {"key": "2026-03-31", "value": "4350.00"}
                    ]
                }
            ]),
        )
        .await;

        mock_accounts(&mut server, default_accounts_mock()).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-03-01".to_string()),
                Some("2026-03-31".to_string()),
                false,
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let mar_entry = activity.iter().find(|m| m["month"] == "2026-03").unwrap();

        assert!(
            (mar_entry["spending"].as_f64().unwrap() - 300.0).abs() < 0.01,
            "Expected $300 spending, got ${}",
            mar_entry["spending"].as_f64().unwrap()
        );
        assert!(
            (mar_entry["payments"].as_f64().unwrap() - 1000.0).abs() < 0.01,
            "Expected $1000 payments, got ${}",
            mar_entry["payments"].as_f64().unwrap()
        );
        assert!(
            (mar_entry["interest"].as_f64().unwrap() - 50.0).abs() < 0.01,
            "Expected $50 interest (from Interest: transaction), got ${}",
            mar_entry["interest"].as_f64().unwrap()
        );
        assert!(
            (mar_entry["net_paydown"].as_f64().unwrap() - 650.0).abs() < 0.01,
            "Expected $650 net paydown (1000 - 300 - 50), got ${}",
            mar_entry["net_paydown"].as_f64().unwrap()
        );
        assert!(
            (mar_entry["balance"].as_f64().unwrap() - 4350.0).abs() < 0.01,
            "Expected $4350 balance"
        );
    }

    /// Test: Mixed activity in a single month with correct net paydown calculation.
    /// Includes balance data and interest transaction.
    /// Uses Firefly III key/value format for balance entries.
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
                                }
                            ]
                        }
                    },
                    {
                        "type": "transactions",
                        "id": "3",
                        "attributes": {
                            "transactions": [
                                {
                                    "type": "withdrawal",
                                    "amount": "225.00",
                                    "source_id": "99",
                                    "source_name": "Credit Card",
                                    "destination_id": "90",
                                    "destination_name": "Interest",
                                    "date": "2026-04-01",
                                    "currency_code": "USD",
                                    "currency_symbol": "$",
                                    "description": "Interest: Credit Card"
                                }
                            ]
                        }
                    }
                ]
            }),
        )
        .await;

        // Balance in Firefly III object format: {"date": value}
        // net_paydown = 1000 - 200 - 225 = 575
        mock_balance_history(
            &mut server,
            json!([
                {
                    "label": "Credit Card",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": [
                        {"key": "2026-03-31", "value": "8000.00"},
                        {"key": "2026-04-30", "value": "7425.00"}
                    ]
                }
            ]),
        )
        .await;

        mock_accounts(&mut server, default_accounts_mock()).await;

        let config = make_test_config(url);
        let client = FireflyClient::new(config);

        let result = client
            .get_card_paydown(
                vec!["99".to_string()],
                Some("2026-04-01".to_string()),
                Some("2026-04-30".to_string()),
                false,
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let apr_entry = activity.iter().find(|m| m["month"] == "2026-04").unwrap();

        assert!(
            (apr_entry["payments"].as_f64().unwrap() - 1000.0).abs() < 0.01,
            "Expected $1000 payments"
        );
        assert!(
            (apr_entry["spending"].as_f64().unwrap() - 200.0).abs() < 0.01,
            "Expected $200 spending, got ${}",
            apr_entry["spending"].as_f64().unwrap()
        );
        assert!(
            (apr_entry["interest"].as_f64().unwrap() - 225.0).abs() < 0.01,
            "Expected $225 interest (from Interest: transaction), got ${}",
            apr_entry["interest"].as_f64().unwrap()
        );
        assert!(
            (apr_entry["net_paydown"].as_f64().unwrap() - 575.0).abs() < 0.01,
            "Expected $575 net paydown (1000 - 200 - 225), got ${}",
            apr_entry["net_paydown"].as_f64().unwrap()
        );

        // Check summary
        let summary = &result["summary"];
        assert!((summary["total_payments"].as_f64().unwrap() - 1000.0).abs() < 0.01,);
        assert!((summary["total_spending"].as_f64().unwrap() - 200.0).abs() < 0.01,);
        assert!(
            (summary["total_interest"].as_f64().unwrap() - 225.0).abs() < 0.01,
            "Expected $225 total interest"
        );
        assert!(
            (summary["total_net_paydown"].as_f64().unwrap() - 575.0).abs() < 0.01,
            "Expected $575 total net paydown"
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
                false,
            )
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No card accounts specified"));
    }

    /// Test: Balance data is correctly included from the balance history API.
    /// Uses Firefly III object format for entries: {"date": value}
    #[tokio::test]
    async fn test_card_paydown_includes_balance() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(&mut server, json!({"data": []})).await;
        mock_accounts(&mut server, default_accounts_mock()).await;

        // Mock balance history with card balance data in Firefly III key/value format
        mock_balance_history(
            &mut server,
            json!([
                {
                    "label": "Credit Card",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": [
                        {"key": "2026-01-31", "value": "5000.00"},
                        {"key": "2026-02-28", "value": "4500.00"},
                        {"key": "2026-03-31", "value": "3800.00"}
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
                false,
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let jan_balance = activity.iter().find(|m| m["month"] == "2026-01").unwrap()["balance"]
            .as_f64()
            .unwrap();
        let feb_balance = activity.iter().find(|m| m["month"] == "2026-02").unwrap()["balance"]
            .as_f64()
            .unwrap();
        let mar_balance = activity.iter().find(|m| m["month"] == "2026-03").unwrap()["balance"]
            .as_f64()
            .unwrap();

        assert!(
            (jan_balance - 5000.0).abs() < 0.01,
            "Jan balance should be $5000"
        );
        assert!(
            (feb_balance - 4500.0).abs() < 0.01,
            "Feb balance should be $4500"
        );
        assert!(
            (mar_balance - 3800.0).abs() < 0.01,
            "Mar balance should be $3800"
        );

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

        mock_accounts(&mut server, default_accounts_mock()).await;

        mock_balance_history(
            &mut server,
            json!([
                {
                    "label": "Credit Card",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": [
                        {"key": "2026-01-31", "value": "4500.00"},
                        {"key": "2026-02-28", "value": "4500.00"}
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
                false,
            )
            .await
            .unwrap();

        // With $500/month avg paydown and $4500 balance, projected payoff = 9 months
        let projected = result["summary"]["projected_payoff_months"]
            .as_i64()
            .unwrap();
        assert_eq!(projected, 9, "Expected 9 months to payoff");
    }

    /// Test: Balance parsing works with Firefly III object format entries.
    #[tokio::test]
    async fn test_card_paydown_balance_object_format() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        mock_transactions(&mut server, json!({"data": []})).await;
        mock_accounts(&mut server, default_accounts_mock()).await;

        // Balance data in object format: {"date": value}
        mock_balance_history(
            &mut server,
            json!([
                {
                    "label": "Credit Card",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": {
                        "2026-01-31T00:00:00+00:00": "5000",
                        "2026-02-28T00:00:00+00:00": "4500",
                        "2026-03-31T00:00:00+00:00": "3800"
                    }
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
                false,
            )
            .await
            .unwrap();

        let activity = result["monthly_activity"].as_array().unwrap();
        let jan_balance = activity.iter().find(|m| m["month"] == "2026-01").unwrap()["balance"]
            .as_f64()
            .unwrap();
        let feb_balance = activity.iter().find(|m| m["month"] == "2026-02").unwrap()["balance"]
            .as_f64()
            .unwrap();

        assert!(
            (jan_balance - 5000.0).abs() < 0.01,
            "Jan balance should be $5000 from object format"
        );
        assert!(
            (feb_balance - 4500.0).abs() < 0.01,
            "Feb balance should be $4500 from object format"
        );
    }
}
