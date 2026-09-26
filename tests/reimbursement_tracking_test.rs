/// Tests for the Reimbursement Tracking feature (/reimbursements +
/// /api/reimbursements/summary).
///
/// Covers:
/// - FireflyClient::get_reimbursement_summary against a mocked Firefly III:
///   totals, month buckets (including empty months), category/budget marker
///   matching, breakdowns, and the cache.
/// - Error cases (invalid range) and route registration.
///
/// Pure classification/bucketing helpers are unit-tested in
/// src/models/reimbursement.rs.
#[cfg(test)]
mod tests {
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;

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

    /// A single-journal transaction in the Firefly API shape.
    /// `amount` is signed like the API reports it (withdrawal side negative).
    #[allow(clippy::too_many_arguments)] // fixture helper: one arg per field
    fn journal_tx(
        id: &str,
        jtype: &str,
        date: &str,
        amount: f64,
        category: Option<&str>,
        budget: Option<&str>,
    ) -> serde_json::Value {
        serde_json::json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": jtype,
                    "amount": format!("{:.2}", amount),
                    "description": "test",
                    "category_name": category.unwrap_or(""),
                    "budget_name": budget.unwrap_or(""),
                    "source_id": "1",
                    "destination_id": "2",
                    "date": format!("{}T12:00:00.000000", date),
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    fn tx_list(txs: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({ "data": txs })
    }

    fn expense_markers() -> (Vec<String>, Vec<String>) {
        (vec!["Work".to_string()], vec!["Client X".to_string()])
    }

    // ── Integration: totals, buckets, breakdowns ───────────────────────

    #[tokio::test]
    async fn test_reimbursement_summary_totals_and_buckets() {
        let mut server = mockito::Server::new_async().await;
        let client = FireflyClient::new(make_test_config(server.url()));
        client.clear_reimbursement_cache();

        // fetch_all_transactions chunks by calendar month, so a range that
        // spans July/August/September makes exactly three requests.
        let chunks: [(&str, Vec<serde_json::Value>); 3] = [
            (
                "start=2026-07-15&end=2026-07-31",
                vec![
                    // Work expense in a marked main category
                    journal_tx(
                        "t1",
                        "withdrawal",
                        "2026-07-20",
                        -300.00,
                        Some("Work"),
                        None,
                    ),
                    // Reimbursement in a marked category
                    journal_tx(
                        "t2",
                        "deposit",
                        "2026-07-25",
                        250.00,
                        Some("Reimbursed"),
                        None,
                    ),
                    // Noise: unmarked category, unmarked budget
                    journal_tx(
                        "t3",
                        "withdrawal",
                        "2026-07-28",
                        -42.00,
                        Some("Groceries"),
                        None,
                    ),
                ],
            ),
            (
                "start=2026-08-01&end=2026-08-31",
                vec![
                    // Parent marker covers the subcategory
                    journal_tx(
                        "t4",
                        "withdrawal",
                        "2026-08-05",
                        -150.50,
                        Some("Work:Travel"),
                        None,
                    ),
                    // Unmarked category, marked budget
                    journal_tx(
                        "t5",
                        "withdrawal",
                        "2026-08-20",
                        -200.00,
                        Some("Groceries"),
                        Some("Client X"),
                    ),
                    // Noise: salary deposit
                    journal_tx("t6", "deposit", "2026-08-01", 5000.00, Some("Salary"), None),
                ],
            ),
            (
                "start=2026-09-01&end=2026-09-10",
                vec![
                    // Parent marker covers the subcategory on the earned side
                    journal_tx(
                        "t7",
                        "deposit",
                        "2026-09-05",
                        200.00,
                        Some("Reimbursed:2026-09"),
                        None,
                    ),
                ],
            ),
        ];

        for (query, txs) in &chunks {
            server
                .mock("GET", "/v1/transactions")
                .match_query(mockito::Matcher::Regex(query.to_string()))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(tx_list(txs.clone()).to_string())
                .expect(1)
                .create_async()
                .await;
        }

        let (cats, budgets) = expense_markers();
        let summary = client
            .get_reimbursement_summary(
                "2026-07-15",
                "2026-09-10",
                &cats,
                &budgets,
                &["Reimbursed".to_string()],
            )
            .await
            .expect("summary should succeed");

        // Headline totals (positive magnitudes)
        assert!(
            (summary.spent - 650.50).abs() < 1e-6,
            "spent: {}",
            summary.spent
        );
        assert!((summary.reimbursed - 450.00).abs() < 1e-6);
        assert!((summary.net - (-200.50)).abs() < 1e-6);
        let pct = summary.pct_reimbursed.expect("pct");
        assert!((pct - 450.00 / 650.50 * 100.0).abs() < 1e-6);
        assert_eq!(summary.currency_code.as_deref(), Some("USD"));
        assert_eq!(summary.currency_symbol.as_deref(), Some("$"));

        // Month buckets: July partial, August full, September partial
        assert_eq!(
            summary
                .months
                .iter()
                .map(|m| m.label.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-07", "2026-08", "2026-09"]
        );
        let jul = &summary.months[0];
        assert!((jul.spent - 300.00).abs() < 1e-6);
        assert!((jul.reimbursed - 250.00).abs() < 1e-6);
        assert!((jul.net - (-50.00)).abs() < 1e-6);
        let aug = &summary.months[1];
        assert!((aug.spent - 350.50).abs() < 1e-6);
        assert!((aug.reimbursed - 0.0).abs() < 1e-6);
        assert!((aug.net - (-350.50)).abs() < 1e-6);
        let sep = &summary.months[2];
        assert!((sep.spent - 0.0).abs() < 1e-6);
        assert!((sep.reimbursed - 200.00).abs() < 1e-6);
        assert!((sep.net - 200.00).abs() < 1e-6);

        // Expense breakdown, sorted by amount desc
        assert_eq!(summary.expense_breakdown.len(), 3);
        assert_eq!(summary.expense_breakdown[0].category, "Work");
        assert!(summary.expense_breakdown[0].budget.is_none());
        assert!((summary.expense_breakdown[0].amount - 300.00).abs() < 1e-6);
        assert_eq!(summary.expense_breakdown[1].category, "Groceries");
        assert_eq!(
            summary.expense_breakdown[1].budget.as_deref(),
            Some("Client X")
        );
        assert!((summary.expense_breakdown[1].amount - 200.00).abs() < 1e-6);
        assert_eq!(summary.expense_breakdown[2].category, "Work:Travel");
        assert!((summary.expense_breakdown[2].amount - 150.50).abs() < 1e-6);

        // Reimbursement breakdown: grouped by the journal's actual
        // category (marker matching already decided what counts)
        assert_eq!(summary.reimbursement_breakdown.len(), 2);
        assert_eq!(summary.reimbursement_breakdown[0].category, "Reimbursed");
        assert!(summary.reimbursement_breakdown[0].budget.is_none());
        assert!((summary.reimbursement_breakdown[0].amount - 250.00).abs() < 1e-6);
        assert_eq!(
            summary.reimbursement_breakdown[1].category,
            "Reimbursed:2026-09"
        );
        assert!((summary.reimbursement_breakdown[1].amount - 200.00).abs() < 1e-6);
    }

    // ── Cache: second call must not hit Firefly again ───────────────────

    #[tokio::test]
    async fn test_reimbursement_summary_uses_cache() {
        let mut server = mockito::Server::new_async().await;
        let client = FireflyClient::new(make_test_config(server.url()));
        client.clear_reimbursement_cache();

        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(
                "start=2026-04-01&end=2026-04-30".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                tx_list(vec![journal_tx(
                    "c1",
                    "withdrawal",
                    "2026-04-10",
                    -100.00,
                    Some("Work"),
                    None,
                )])
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;

        let (cats, budgets) = expense_markers();
        let first = client
            .get_reimbursement_summary("2026-04-01", "2026-04-30", &cats, &budgets, &[])
            .await
            .expect("first call should fetch");
        assert!((first.spent - 100.00).abs() < 1e-6);

        // Different reimbursement markers must NOT share the cache entry.
        let miss = client
            .get_reimbursement_summary(
                "2026-04-01",
                "2026-04-30",
                &cats,
                &budgets,
                &["Other".to_string()],
            )
            .await
            .expect("different markers should miss the cache");
        assert!((miss.spent - 100.00).abs() < 1e-6);

        // Same params -> cache hit (no extra upstream call; mockito's
        // expect(1) above would fail otherwise).
        let second = client
            .get_reimbursement_summary("2026-04-01", "2026-04-30", &cats, &budgets, &[])
            .await
            .expect("cached call should succeed");
        assert!((second.spent - 100.00).abs() < 1e-6);
        assert!((second.reimbursed - 0.0).abs() < 1e-6);

        client.clear_reimbursement_cache();
    }

    // ── Empty period (no matching journals) ─────────────────────────────

    #[tokio::test]
    async fn test_reimbursement_summary_empty_period() {
        let mut server = mockito::Server::new_async().await;
        let client = FireflyClient::new(make_test_config(server.url()));
        client.clear_reimbursement_cache();

        for (start, end) in [("2026-05-01", "2026-05-31"), ("2026-06-01", "2026-06-30")] {
            server
                .mock("GET", "/v1/transactions")
                .match_query(mockito::Matcher::Regex(format!(
                    "start={}&end={}",
                    start, end
                )))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(tx_list(vec![]).to_string())
                .create_async()
                .await;
        }

        let (cats, budgets) = expense_markers();
        let summary = client
            .get_reimbursement_summary(
                "2026-05-01",
                "2026-06-30",
                &cats,
                &budgets,
                &["Reimbursed".to_string()],
            )
            .await
            .expect("summary should succeed");

        assert!((summary.spent - 0.0).abs() < 1e-6);
        assert!((summary.reimbursed - 0.0).abs() < 1e-6);
        assert!((summary.net - 0.0).abs() < 1e-6);
        assert!(summary.pct_reimbursed.is_none());
        assert_eq!(summary.months.len(), 2);
        assert!(summary.expense_breakdown.is_empty());
        assert!(summary.reimbursement_breakdown.is_empty());

        client.clear_reimbursement_cache();
    }

    // ── Error cases ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_reimbursement_summary_rejects_end_before_start() {
        let server = mockito::Server::new_async().await;
        let client = FireflyClient::new(make_test_config(server.url()));
        let (cats, budgets) = expense_markers();
        let err = client
            .get_reimbursement_summary("2026-06-01", "2026-05-01", &cats, &budgets, &[])
            .await
            .expect_err("end before start must fail");
        assert!(err.contains("Invalid"), "unexpected error: {}", err);
    }

    #[tokio::test]
    async fn test_reimbursement_summary_rejects_bad_dates() {
        let server = mockito::Server::new_async().await;
        let client = FireflyClient::new(make_test_config(server.url()));
        let (cats, budgets) = expense_markers();
        let err = client
            .get_reimbursement_summary("not-a-date", "2026-05-01", &cats, &budgets, &[])
            .await
            .expect_err("bad start date must fail");
        assert!(err.contains("Invalid"), "unexpected error: {}", err);
    }

    // ── Firefly pagination: the category list must not stop at one page ─

    /// One category in the Firefly JSON:API shape.
    fn category_item(id: i32, name: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "categories",
            "id": id.to_string(),
            "attributes": { "name": name }
        })
    }

    fn category_list(items: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({ "data": items })
    }

    /// Firefly III paginates GET /v1/categories with `limit` + `page`
    /// (default 50 per page). Before the fix, oxidize sent no pagination
    /// params at all, so users with >50 categories only saw the first page
    /// (the list "stopped at R"). This mocks two pages and asserts that
    /// every category beyond the first page is fetched and grouped.
    #[tokio::test]
    async fn test_category_list_paginates_beyond_first_page() {
        let mut server = mockito::Server::new_async().await;
        let client = FireflyClient::new(make_test_config(server.url()));
        client.clear_categories_cache();

        // Page 1: a full 100 categories (the limit we request).
        let page1: Vec<serde_json::Value> = (1..=100)
            .map(|i| category_item(i, &format!("Cat{:03}", i)))
            .collect();
        // Page 2: 30 more, including one "Parent:Sub" name.
        let page2: Vec<serde_json::Value> = (101..=130)
            .map(|i| category_item(i, &format!("Cat{:03}", i)))
            .chain(std::iter::once(category_item(131, "Work:Travel")))
            .collect();

        server
            .mock("GET", "/v1/categories")
            .match_query(mockito::Matcher::Regex("^limit=100&page=1$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(category_list(page1).to_string())
            .expect(1)
            .create_async()
            .await;
        server
            .mock("GET", "/v1/categories")
            .match_query(mockito::Matcher::Regex("^limit=100&page=2$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(category_list(page2).to_string())
            .expect(1)
            .create_async()
            .await;

        let parents = client
            .get_categories()
            .await
            .expect("paginated category fetch should succeed");

        // 131 categories: 130 bare names + "Work:Travel" grouping under
        // the "Work" parent -> 131 parent entries.
        assert_eq!(parents.len(), 131, "expected 131 parent categories");
        // The regression itself: names from page 2 must be present.
        let names: std::collections::HashSet<&str> =
            parents.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains("Cat130"), "page-2 category missing");
        assert!(names.contains("Cat101"), "page-2 category missing");
        assert!(names.contains("Cat001"), "page-1 category missing");
        // Parent/sub grouping still works across pages.
        let work = parents
            .iter()
            .find(|p| p.name == "Work")
            .expect("'Work' parent should exist");
        assert_eq!(work.subcategories, vec!["Travel".to_string()]);

        client.clear_categories_cache();
    }

    /// A monthly chunk with more than one Firefly page of transactions
    /// (limit=500) must be fully fetched via 1-based `page` params.
    /// Before the fix oxidize sent `offset`, which Firefly ignores: page 1
    /// would be re-fetched forever (hang) whenever a chunk had >500
    /// transactions.
    #[tokio::test]
    async fn test_transaction_fetch_paginates_within_chunk() {
        let mut server = mockito::Server::new_async().await;
        let client = FireflyClient::new(make_test_config(server.url()));
        client.clear_reimbursement_cache();

        let single_month_txs = |ids: std::ops::Range<i32>| {
            ids.map(|i| {
                journal_tx(
                    &format!("p2-{}", i),
                    "withdrawal",
                    "2026-03-10",
                    -1.00,
                    Some("Work"),
                    None,
                )
            })
            .collect::<Vec<_>>()
        };

        // Page 1: exactly 500 (a full page, so the client must ask for more)
        let page1 = single_month_txs(1..501);
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(
                "^start=2026-03-01&end=2026-03-31&limit=500&page=1$".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(tx_list(page1).to_string())
            .expect(1)
            .create_async()
            .await;
        // Page 2: 2 more, ending the fetch.
        let page2 = single_month_txs(501..503);
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(
                "^start=2026-03-01&end=2026-03-31&limit=500&page=2$".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(tx_list(page2).to_string())
            .expect(1)
            .create_async()
            .await;

        let (cats, budgets) = expense_markers();
        let summary = client
            .get_reimbursement_summary("2026-03-01", "2026-03-31", &cats, &budgets, &[])
            .await
            .expect("summary with a multi-page chunk should succeed");

        // All 502 work expenses counted, including the two from page 2.
        assert!(
            (summary.spent - 502.00).abs() < 1e-6,
            "spent: {}",
            summary.spent
        );

        client.clear_reimbursement_cache();
    }

    // ── Route registration ──────────────────────────────────────────────

    #[test]
    fn test_reimbursement_routes_registered() {
        let main_rs = include_str!("../src/main.rs");
        assert!(
            main_rs.contains("reimbursement::reimbursements_page"),
            "/reimbursements page handler should be registered"
        );
        assert!(
            main_rs.contains("reimbursement::get_reimbursements_summary_api"),
            "/api/reimbursements/summary handler should be registered"
        );
        assert!(
            main_rs.contains("reimbursement::refresh_reimbursements"),
            "/api/reimbursements/refresh handler should be registered"
        );

        let handlers_mod = include_str!("../src/handlers/mod.rs");
        assert!(
            handlers_mod.contains("pub mod reimbursement;"),
            "reimbursement module should be declared"
        );
    }
}
