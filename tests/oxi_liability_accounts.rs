/// Regression tests: liability accounts must appear in the Graph Builder
/// account list across Firefly III versions.
///
/// Firefly III v5 and earlier report the liability family (credit cards,
/// loans, debts, mortgages) as `type: "liability"`. Firefly III v6 renamed
/// the family: `GET /v1/accounts?type=liability` still selects those
/// accounts, but each is reported as `type: "liabilities"` (plural). The
/// client-side type filter in `get_accounts` must treat both spellings as
/// the same family, otherwise a `type=liability` request returns zero
/// accounts on v6 and the Graph Builder list loses every liability account.

#[cfg(test)]
mod tests {
    use mockito::Server;
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use serde_json::json;

    fn make_test_config(url: String) -> Config {
        Config {
            firefly_url: oxidize::config::FireflyUrl::validate(url).unwrap(),
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            account_types: vec![
                "asset".to_string(),
                "cash".to_string(),
                "expense".to_string(),
                "revenue".to_string(),
                "liability".to_string(),
            ],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
            cache_ttl: 300,
            time_ranges: vec!["30d".to_string()],
            default_time_range: "30d".to_string(),
        }
    }

    /// Firefly III v6: `?type=liability` returns accounts whose reported
    /// type is "liabilities" (plural). They must NOT be dropped by the
    /// client-side filter.
    #[tokio::test]
    async fn test_get_accounts_liability_matches_v6_liabilities_type() {
        let mut server = Server::new_async().await;

        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::UrlEncoded(
                "type".to_string(),
                "liability".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "data": [
                        {
                            "id": "10",
                            "attributes": {
                                "name": "Credit Card",
                                "type": "liabilities",
                                "current_balance": "-5000",
                                "currency_symbol": "$"
                            }
                        },
                        {
                            "id": "11",
                            "attributes": {
                                "name": "Mortgage",
                                "type": "liabilities",
                                "current_balance": "-250000",
                                "currency_symbol": "$"
                            }
                        }
                    ]
                })
                .to_string(),
            )
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let accounts = client
            .get_accounts(Some("liability".to_string()))
            .await
            .unwrap();

        assert_eq!(
            accounts.len(),
            2,
            "Firefly III v6 reports liability accounts as 'liabilities'; \
             a type=liability request must not filter them out"
        );
        let names: Vec<&str> = accounts.iter().map(|a| a.name.as_str()).collect();
        assert!(names.contains(&"Credit Card"));
        assert!(names.contains(&"Mortgage"));
    }

    /// Firefly III v5: `?type=liability` returns accounts reported as
    /// "liability" (singular). That behavior must keep working.
    #[tokio::test]
    async fn test_get_accounts_liability_v5_type_still_works() {
        let mut server = Server::new_async().await;

        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::UrlEncoded(
                "type".to_string(),
                "liability".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "data": [
                        {
                            "id": "10",
                            "attributes": {
                                "name": "Credit Card",
                                "type": "liability",
                                "current_balance": "-5000",
                                "currency_symbol": "$"
                            }
                        }
                    ]
                })
                .to_string(),
            )
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let accounts = client
            .get_accounts(Some("liability".to_string()))
            .await
            .unwrap();

        assert_eq!(accounts.len(), 1, "v5 'liability' type must still match");
        assert_eq!(accounts[0].name, "Credit Card");
    }

    /// The inverse direction: a `?type=liabilities` request (used by some
    /// code paths) must also match v5-style singular "liability" accounts.
    #[tokio::test]
    async fn test_get_accounts_liabilities_filter_matches_v5_type() {
        let mut server = Server::new_async().await;

        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::UrlEncoded(
                "type".to_string(),
                "liabilities".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "data": [
                        {
                            "id": "12",
                            "attributes": {
                                "name": "Car Loan",
                                "type": "liability",
                                "current_balance": "-12000",
                                "currency_symbol": "$"
                            }
                        }
                    ]
                })
                .to_string(),
            )
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let accounts = client
            .get_accounts(Some("liabilities".to_string()))
            .await
            .unwrap();

        assert_eq!(
            accounts.len(),
            1,
            "liability family must match both spellings"
        );
        assert_eq!(accounts[0].name, "Car Loan");
    }

    /// Non-liability types must remain strictly filtered: a stray
    /// liability account in an `?type=asset` response must be dropped.
    #[tokio::test]
    async fn test_get_accounts_non_liability_types_still_filtered() {
        let mut server = Server::new_async().await;

        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::UrlEncoded(
                "type".to_string(),
                "asset".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "data": [
                        {
                            "id": "1",
                            "attributes": {
                                "name": "Checking",
                                "type": "asset",
                                "current_balance": "10000",
                                "currency_symbol": "$"
                            }
                        },
                        {
                            "id": "10",
                            "attributes": {
                                "name": "Credit Card",
                                "type": "liabilities",
                                "current_balance": "-5000",
                                "currency_symbol": "$"
                            }
                        }
                    ]
                })
                .to_string(),
            )
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let accounts = client
            .get_accounts(Some("asset".to_string()))
            .await
            .unwrap();

        assert_eq!(
            accounts.len(),
            1,
            "type=asset must not return liability-family accounts"
        );
        assert_eq!(accounts[0].name, "Checking");
    }
}
