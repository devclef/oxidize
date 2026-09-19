/// Regression tests: net worth must account for liabilities.
///
/// Firefly III reports liability (debt) accounts — credit cards, loans,
/// debts, mortgages — with NEGATIVE balances: a $2,000 credit card debt
/// has a balance of -2000. Firefly III's own net worth calculation
/// (NetWorth::byAccounts) simply SUMS the balances of all asset and
/// liability accounts, which only yields "assets minus debt" because debt
/// balances are negative.
///
/// The account overview chart endpoint (`/v1/chart/account/overview`)
/// returns the same balance sign: `preselected=assets` gives positive
/// asset balances and `preselected=liabilities` gives negative debt
/// balances. Net worth is therefore assets + liability balances (adding,
/// NOT subtracting, the liability series). Subtracting the negative debt
/// balances instead of adding them used to inflate net worth by twice the
/// debt on the Monthly Summary page and every net worth widget.
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

    /// The object form Firefly III uses for the account overview chart:
    /// entries are keyed by date with the raw (signed) balance.
    fn chart_body(label: &str, balances: &[(&str, f64)]) -> String {
        let mut entries = serde_json::Map::new();
        for (date, balance) in balances {
            entries.insert(date.to_string(), json!(balance));
        }
        json!([{
            "label": label,
            "currency_symbol": "$",
            "currency_code": "USD",
            "entries": entries,
        }])
        .to_string()
    }

    /// Debt liabilities come back with negative balances and must reduce
    /// net worth (assets + negative liability = assets - debt).
    #[tokio::test]
    async fn test_net_worth_subtracts_negative_debt_balances() {
        let mut server = mockito::Server::new_async().await;

        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(
                r"start=2026-01-01&end=2026-01-31&period=1M&preselected=assets".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(chart_body(
                "Assets",
                &[
                    ("2026-01-01T00:00:00+00:00", 10000.0),
                    ("2026-01-31T00:00:00+00:00", 10800.0),
                ],
            ))
            .create_async()
            .await;

        // Firefly III reports a $2,000 -> $1,900 debt as -2000 -> -1900.
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(
                r"start=2026-01-01&end=2026-01-31&period=1M&preselected=liabilities".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(chart_body(
                "Liabilities",
                &[
                    ("2026-01-01T00:00:00+00:00", -2000.0),
                    ("2026-01-31T00:00:00+00:00", -1900.0),
                ],
            ))
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let line = client
            .get_net_worth(
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                Some("1M".to_string()),
            )
            .await
            .unwrap();

        assert_eq!(line.len(), 1, "net worth is a single merged dataset");
        assert_eq!(line[0].label, "Net Worth");

        let entries: Vec<(String, f64)> = line[0]
            .entries
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["date"].as_str().unwrap().to_string(),
                    e["ba"].as_f64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            entries,
            vec![
                ("2026-01-01".to_string(), 8000.0),
                ("2026-01-31".to_string(), 8900.0),
            ],
            "net worth must be assets + (negative) debt balances: \
             10000-2000=8000 and 10800-1900=8900"
        );
    }

    /// Multiple asset accounts, a credit card debt (negative) and a
    /// "you are owed" liability (positive) must all sum to net worth.
    #[tokio::test]
    async fn test_net_worth_sums_assets_and_liability_families() {
        let mut server = mockito::Server::new_async().await;

        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(r"preselected=assets".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([
                    { "label": "Checking", "currency_symbol": "$", "currency_code": "USD",
                      "entries": { "2026-01-01T00:00:00+00:00": 5000.0 } },
                    { "label": "Savings", "currency_symbol": "$", "currency_code": "USD",
                      "entries": { "2026-01-01T00:00:00+00:00": 7000.0 } },
                ])
                .to_string(),
            )
            .create_async()
            .await;

        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(
                r"preselected=liabilities".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([
                    { "label": "Credit Card", "currency_symbol": "$", "currency_code": "USD",
                      "entries": { "2026-01-01T00:00:00+00:00": -3000.0 } },
                    { "label": "IOU from friend", "currency_symbol": "$", "currency_code": "USD",
                      "entries": { "2026-01-01T00:00:00+00:00": 200.0 } },
                ])
                .to_string(),
            )
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let line = client
            .get_net_worth(
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                Some("1M".to_string()),
            )
            .await
            .unwrap();

        let entry = line[0].entries.as_array().unwrap()[0].clone();
        assert_eq!(entry["date"], "2026-01-01");
        // 5000 + 7000 - 3000 + 200 = 9200
        assert!(
            (entry["ba"].as_f64().unwrap() - 9200.0).abs() < 1e-6,
            "expected 9200, got {}",
            entry["ba"]
        );
    }

    /// With no liability accounts the chart endpoint returns an empty
    /// dataset list; net worth then equals the assets untouched.
    #[tokio::test]
    async fn test_net_worth_without_liabilities() {
        let mut server = mockito::Server::new_async().await;

        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(r"preselected=assets".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(chart_body(
                "Assets",
                &[("2026-01-01T00:00:00+00:00", 4200.0)],
            ))
            .create_async()
            .await;

        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(
                r"preselected=liabilities".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body("[]")
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let line = client
            .get_net_worth(
                Some("2026-01-01".to_string()),
                Some("2026-01-31".to_string()),
                Some("1M".to_string()),
            )
            .await
            .unwrap();

        let entry = line[0].entries.as_array().unwrap()[0].clone();
        assert_eq!(entry["date"], "2026-01-01");
        assert!((entry["ba"].as_f64().unwrap() - 4200.0).abs() < 1e-6);
    }
}
