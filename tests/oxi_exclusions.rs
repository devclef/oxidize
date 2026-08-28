/// Tests for category/budget exclusions in chart aggregation.
///
/// Verifies that journals whose category or budget is excluded are dropped
/// from:
/// - get_earned_spent (spent line)
/// - get_budget_spent_history (budget datasets)
/// - get_budget_spent (Firefly-side aggregation, post-filtered)
/// - get_sankey_flows (category flow)
/// - get_subcategory_spend_chart
///
/// Also verifies that empty exclusions leave results unchanged and that the
/// cache key distinguishes excluded from non-excluded queries.

#[cfg(test)]
mod tests {
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use oxidize::models::{Exclusions, SankeyFlowType};
    use serde_json::json;

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

    /// Two withdrawals: "Work Expenses:Reimbursed" $500 and "Groceries" $300,
    /// plus the budget names that map to them.
    fn work_and_groceries_txs() -> serde_json::Value {
        json!({
            "data": [
                {
                    "type": "transactions",
                    "id": "1",
                    "attributes": {
                        "transactions": [
                            {
                                "type": "withdrawal",
                                "amount": "500.00",
                                "source_id": "1",
                                "source_name": "Checking",
                                "destination_id": "50",
                                "destination_name": "Work Vendor",
                                "category_name": "Work Expenses:Reimbursed",
                                "budget_name": "Work",
                                "date": "2026-01-15",
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
                                "amount": "300.00",
                                "source_id": "1",
                                "source_name": "Checking",
                                "destination_id": "51",
                                "destination_name": "Market",
                                "category_name": "Groceries",
                                "budget_name": "Groceries Budget",
                                "date": "2026-01-16",
                                "currency_code": "USD",
                                "currency_symbol": "$"
                            }
                        ]
                    }
                }
            ]
        })
    }

    fn sum_of(dataset: &oxidize::models::ChartDataSet) -> f64 {
        dataset
            .entries
            .as_object()
            .map(|m| m.values().filter_map(|v| v.as_f64()).sum::<f64>())
            .unwrap_or(0.0)
    }

    /// Excluding a parent category drops all of its subcategories from the
    /// spent line, while other categories remain.
    #[tokio::test]
    async fn test_earned_spent_excludes_category() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();
        mock_transactions(&mut server, work_and_groceries_txs()).await;
        let client = FireflyClient::new(make_test_config(url));

        // No exclusions: both withdrawals count
        let all = client
            .get_earned_spent(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                &Exclusions::default(),
            )
            .await
            .unwrap();
        let spent = all.iter().find(|ds| ds.label == "spent").unwrap();
        assert!((sum_of(spent) - 800.0).abs() < 0.01);

        // Exclude parent category "Work Expenses"
        let excl = Exclusions::new(vec!["Work Expenses".into()], vec![]);
        let filtered = client
            .get_earned_spent(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                &excl,
            )
            .await
            .unwrap();
        let spent = filtered.iter().find(|ds| ds.label == "spent").unwrap();
        assert!(
            (sum_of(spent) - 300.0).abs() < 0.01,
            "expected only the $300 groceries spend, got {}",
            sum_of(spent)
        );
    }

    /// Excluding a subcategory by full name only drops that subcategory.
    #[tokio::test]
    async fn test_earned_spent_excludes_subcategory_by_full_name() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();
        mock_transactions(&mut server, work_and_groceries_txs()).await;
        let client = FireflyClient::new(make_test_config(url));

        let excl = Exclusions::new(vec!["Work Expenses:Reimbursed".into()], vec![]);
        let filtered = client
            .get_earned_spent(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                &excl,
            )
            .await
            .unwrap();
        let spent = filtered.iter().find(|ds| ds.label == "spent").unwrap();
        assert!((sum_of(spent) - 300.0).abs() < 0.01);

        // A different subcategory of the same parent is NOT excluded
        let excl_other = Exclusions::new(vec!["Work Expenses:Other".into()], vec![]);
        let kept = client
            .get_earned_spent(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                &excl_other,
            )
            .await
            .unwrap();
        let spent = kept.iter().find(|ds| ds.label == "spent").unwrap();
        assert!((sum_of(spent) - 800.0).abs() < 0.01);
    }

    /// Excluding a budget drops the matching journal from spent.
    #[tokio::test]
    async fn test_earned_spent_excludes_budget() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();
        mock_transactions(&mut server, work_and_groceries_txs()).await;
        let client = FireflyClient::new(make_test_config(url));

        let excl = Exclusions::new(vec![], vec!["Work".into()]);
        let filtered = client
            .get_earned_spent(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                &excl,
            )
            .await
            .unwrap();
        let spent = filtered.iter().find(|ds| ds.label == "spent").unwrap();
        assert!((sum_of(spent) - 300.0).abs() < 0.01);
    }

    /// Budget spent history drops excluded budgets entirely.
    #[tokio::test]
    async fn test_budget_spent_history_excludes_budget() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();
        mock_transactions(&mut server, work_and_groceries_txs()).await;
        let client = FireflyClient::new(make_test_config(url));

        let excl = Exclusions::new(vec![], vec!["Work".into()]);
        let chart = client
            .get_budget_spent_history(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                &excl,
            )
            .await
            .unwrap();
        let labels: Vec<&str> = chart.iter().map(|ds| ds.label.as_str()).collect();
        assert_eq!(labels, vec!["Groceries Budget"]);
        assert!((sum_of(&chart[0]) - 300.0).abs() < 0.01);
    }

    /// Category exclusion also removes spend from budget history (the journal
    /// is dropped before it is attributed to its budget).
    #[tokio::test]
    async fn test_budget_spent_history_excludes_category() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();
        mock_transactions(&mut server, work_and_groceries_txs()).await;
        let client = FireflyClient::new(make_test_config(url));

        let excl = Exclusions::new(vec!["Work Expenses".into()], vec![]);
        let chart = client
            .get_budget_spent_history(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                &excl,
            )
            .await
            .unwrap();
        let labels: Vec<&str> = chart.iter().map(|ds| ds.label.as_str()).collect();
        assert_eq!(labels, vec!["Groceries Budget"]);
    }

    /// get_budget_spent (Firefly-side aggregation) post-filters excluded
    /// budget datasets.
    #[tokio::test]
    async fn test_budget_spent_excludes_budget_datasets() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        server
            .mock("GET", "/v1/chart/budget/overview")
            .match_query(mockito::Matcher::Regex(
                r"start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([
                    {
                        "label": "Work",
                        "entries": { "2026-01-31T00:00:00+00:00": 500.0 }
                    },
                    {
                        "label": "Groceries Budget",
                        "entries": { "2026-01-31T00:00:00+00:00": 300.0 }
                    }
                ])
                .to_string(),
            )
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(url));
        let chart = client
            .get_budget_spent(
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                &Exclusions::new(vec![], vec!["Work".into()]),
            )
            .await
            .unwrap();
        let labels: Vec<&str> = chart.iter().map(|ds| ds.label.as_str()).collect();
        assert_eq!(labels, vec!["Groceries Budget"]);
    }

    /// Sankey category flow drops excluded categories from the links.
    #[tokio::test]
    async fn test_sankey_excludes_category() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();
        mock_transactions(&mut server, work_and_groceries_txs()).await;
        let client = FireflyClient::new(make_test_config(url));

        let excl = Exclusions::new(vec!["Work Expenses".into()], vec![]);
        let flows = client
            .get_sankey_flows(
                vec!["1".into()],
                SankeyFlowType::Category,
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                None,
                None,
                None,
                &excl,
            )
            .await
            .unwrap();
        let targets: Vec<&str> = flows.links.iter().map(|l| l.target.as_str()).collect();
        assert_eq!(targets, vec!["Groceries"]);
        assert!((flows.total - 300.0).abs() < 0.01);
    }

    /// Subcategory spend chart drops journals of excluded categories.
    #[tokio::test]
    async fn test_subcategory_spend_excludes_category() {
        let mut server = mockito::Server::new_async().await;
        let url = server.url();
        mock_transactions(&mut server, work_and_groceries_txs()).await;
        let client = FireflyClient::new(make_test_config(url));

        let excl = Exclusions::new(vec!["Work Expenses".into()], vec![]);
        let chart = client
            .get_subcategory_spend_chart(
                vec!["Work Expenses".into(), "Groceries".into()],
                vec![],
                Some("2026-01-01".into()),
                Some("2026-01-31".into()),
                Some("1M".into()),
                Some(vec!["1".into()]),
                Some("parent".into()),
                &excl,
            )
            .await
            .unwrap();
        let labels: Vec<&str> = chart.iter().map(|ds| ds.label.as_str()).collect();
        assert_eq!(labels, vec!["Groceries"]);
    }

    /// Cache keys must differ between excluded and non-excluded queries so
    /// one does not serve the other's data.
    #[test]
    fn test_cache_keys_differ_with_exclusions() {
        let plain = oxidize::cache::DataCache::earned_spent_key_for_test(
            None,
            None,
            Some("1M"),
            Some(&["1".to_string()]),
            &Exclusions::default(),
        );
        let excluded = oxidize::cache::DataCache::earned_spent_key_for_test(
            None,
            None,
            Some("1M"),
            Some(&["1".to_string()]),
            &Exclusions::new(vec!["Work Expenses".into()], vec![]),
        );
        assert_ne!(plain, excluded);
        // Default exclusions produce the same key format as before (no suffix)
        assert!(!plain.contains("c="));
        assert!(excluded.contains("c=Work Expenses"));
    }
}
