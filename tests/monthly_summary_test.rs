/// Tests for the Monthly Summary feature (/summary + /api/summary/month).
///
/// Covers:
/// - Pure date/budget math helpers (month_range, shift_months, pct_change,
///   project_full_month, budget_status) and bulk budget-limit parsing.
/// - FireflyClient::get_month_summary against a mocked Firefly III:
///   a completed past month (exact totals, categories, budgets, net worth,
///   trend, top expenses) and the current partial month (days elapsed,
///   projections), plus category-exclusion consistency and error cases.
/// - Route registration for the new page and API endpoint.
#[cfg(test)]
mod tests {
    use chrono::Datelike;
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use oxidize::models::summary::{
        budget_status, month_range, pct_change, project_full_month, shift_months, BulkBudgetLimit,
    };
    use oxidize::models::Exclusions;
    use serde_json::json;

    // ── Pure helper tests ────────────────────────────────────────────────

    #[test]
    fn test_month_range_common_months() {
        let (start, end, days) = month_range(2026, 9).unwrap();
        assert_eq!(start.format("%Y-%m-%d").to_string(), "2026-09-01");
        assert_eq!(end.format("%Y-%m-%d").to_string(), "2026-09-30");
        assert_eq!(days, 30);
    }

    #[test]
    fn test_month_range_leap_and_non_leap_february() {
        let (_, end, days) = month_range(2024, 2).unwrap();
        assert_eq!(days, 29);
        assert_eq!(end.format("%Y-%m-%d").to_string(), "2024-02-29");

        let (_, end, days) = month_range(2026, 2).unwrap();
        assert_eq!(days, 28);
        assert_eq!(end.format("%Y-%m-%d").to_string(), "2026-02-28");
    }

    #[test]
    fn test_month_range_december_and_invalid_months() {
        let (_, end, days) = month_range(2026, 12).unwrap();
        assert_eq!(end.format("%Y-%m-%d").to_string(), "2026-12-31");
        assert_eq!(days, 31);

        assert!(month_range(2026, 0).is_err());
        assert!(month_range(2026, 13).is_err());
    }

    #[test]
    fn test_shift_months() {
        assert_eq!(shift_months(2026, 9, -1), (2026, 8));
        assert_eq!(shift_months(2026, 1, -1), (2025, 12));
        assert_eq!(shift_months(2026, 12, 1), (2027, 1));
        assert_eq!(shift_months(2026, 9, -11), (2025, 10));
        assert_eq!(shift_months(2026, 9, 12), (2027, 9));
    }

    #[test]
    fn test_pct_change() {
        assert!((pct_change(110.0, Some(100.0)).unwrap() - 10.0).abs() < 1e-9);
        assert!((pct_change(90.0, Some(100.0)).unwrap() - -10.0).abs() < 1e-9);
        assert!(pct_change(50.0, Some(0.0)).is_none());
        assert!(pct_change(50.0, None).is_none());
    }

    #[test]
    fn test_project_full_month() {
        // 500 spent in 10 of 30 days -> 1500 projected
        assert!((project_full_month(500.0, 10, 30).unwrap() - 1500.0).abs() < 1e-9);
        assert!(project_full_month(500.0, 0, 30).is_none());
        // Full month elapsed projects to itself
        assert!((project_full_month(800.0, 31, 31).unwrap() - 800.0).abs() < 1e-9);
    }

    #[test]
    fn test_budget_status_matrix() {
        assert_eq!(budget_status(10.0, None, None), "no-limit");
        assert_eq!(budget_status(1500.01, Some(1500.0), None), "over");
        // Exactly at the limit is fully used but not over
        assert_eq!(budget_status(1500.0, Some(1500.0), None), "ok");
        assert_eq!(budget_status(100.0, Some(1500.0), Some(2000.0)), "warning");
        assert_eq!(budget_status(100.0, Some(1500.0), Some(1400.0)), "ok");
        assert_eq!(budget_status(100.0, Some(1500.0), None), "ok");
        // Zero limit is not meaningful
        assert_eq!(budget_status(100.0, Some(0.0), None), "no-limit");
    }

    #[test]
    fn test_bulk_budget_limit_from_value() {
        let value = json!({
            "type": "budget_limits",
            "id": "7",
            "attributes": {
                "start": "2026-03-01T00:00:00+00:00",
                "end": "2026-03-31T23:59:59+00:00",
                "budget_id": "3",
                "amount": "1234.56",
                "currency_code": "EUR",
                "currency_symbol": "\u{20ac}"
            }
        });
        let limit = BulkBudgetLimit::from_value(&value).unwrap();
        assert_eq!(limit.budget_id, "3");
        assert_eq!(limit.period_start, "2026-03-01");
        assert_eq!(limit.period_end, "2026-03-31");
        assert!((limit.amount - 1234.56).abs() < 1e-9);
        assert_eq!(limit.currency_code.as_deref(), Some("EUR"));

        // Missing required fields -> None
        assert!(
            BulkBudgetLimit::from_value(&json!({"attributes": {"start": "2026-03-01"}})).is_none()
        );
        assert!(BulkBudgetLimit::from_value(&json!({})).is_none());
    }

    // ── Mocked Firefly fixtures ──────────────────────────────────────────

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

    /// A withdrawal journal.
    #[allow(clippy::too_many_arguments)] // fixture helper: one arg per field
    fn withdrawal_tx(
        id: &str,
        date: &str,
        amount: f64,
        description: &str,
        category: &str,
        budget: &str,
        source: &str,
        dest: &str,
    ) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "withdrawal",
                    "amount": format!("{:.2}", amount),
                    "description": description,
                    "category_name": category,
                    "budget_name": budget,
                    "source_id": source,
                    "destination_id": dest,
                    "date": date,
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    /// A deposit journal.
    fn deposit_tx(
        id: &str,
        date: &str,
        amount: f64,
        description: &str,
        category: &str,
        source: &str,
        dest: &str,
    ) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "deposit",
                    "amount": format!("{:.2}", amount),
                    "description": description,
                    "category_name": category,
                    "source_id": source,
                    "destination_id": dest,
                    "date": date,
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    /// A transfer journal (asset -> asset, e.g. moving money to savings).
    fn transfer_tx(
        id: &str,
        date: &str,
        amount: f64,
        description: &str,
        source: &str,
        dest: &str,
    ) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "transfer",
                    "amount": format!("{:.2}", amount),
                    "description": description,
                    "source_id": source,
                    "destination_id": dest,
                    "date": date,
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    fn tx_list(txs: Vec<serde_json::Value>) -> serde_json::Value {
        json!({ "data": txs })
    }

    /// Completed-month fixture for month `y`-`m`:
    ///   earned:  3000 salary deposit (day 1)
    ///   spent:   100 groceries (5th) + 500 rent (10th) + 250 groceries (12th)
    ///            + 1200 car repair (20th) = 2050
    ///   transfer: 999 to savings (15th) -- must NOT count as spending
    fn month_fixture(y: i32, m: u32) -> serde_json::Value {
        let d = |day: u32| format!("{}-{:02}-{:02}", y, m, day);
        tx_list(vec![
            deposit_tx("m-sal", &d(1), 3000.0, "Salary", "Income:Salary", "20", "1"),
            withdrawal_tx(
                "m-gro1",
                &d(5),
                100.0,
                "Groceries A",
                "Food & Drink:Groceries",
                "Groceries",
                "1",
                "10",
            ),
            withdrawal_tx(
                "m-rent",
                &d(10),
                500.0,
                "Rent",
                "Housing:Rent",
                "Rent",
                "1",
                "11",
            ),
            withdrawal_tx(
                "m-gro2",
                &d(12),
                250.0,
                "Groceries B",
                "Food & Drink:Groceries",
                "Groceries",
                "1",
                "10",
            ),
            transfer_tx("m-save", &d(15), 999.0, "Move to savings", "1", "2"),
            withdrawal_tx(
                "m-car",
                &d(20),
                1200.0,
                "Car repair",
                "Cars:Repairs",
                "",
                "1",
                "12",
            ),
        ])
    }

    /// Previous-month fixture: 3000 salary (day 1), 2000 spent (day 5).
    fn prev_month_fixture(y: i32, m: u32) -> serde_json::Value {
        let d = |day: u32| format!("{}-{:02}-{:02}", y, m, day);
        tx_list(vec![
            deposit_tx("p-sal", &d(1), 3000.0, "Salary", "Income:Salary", "20", "1"),
            withdrawal_tx(
                "p-misc",
                &d(5),
                2000.0,
                "Misc",
                "Household:Misc",
                "",
                "1",
                "13",
            ),
        ])
    }

    fn budget_list_body() -> String {
        json!({
            "data": [
                { "id": "1", "attributes": { "name": "Groceries", "active": true } },
                { "id": "2", "attributes": { "name": "Rent", "active": true } },
                { "id": "3", "attributes": { "name": "Utilities", "active": true } }
            ]
        })
        .to_string()
    }

    /// Budget spent chart: Groceries 350, Rent 500 (Utilities: none -> 0).
    fn budget_spent_body(y: i32, m: u32) -> String {
        let key = format!("{}-{:02}-01T00:00:00+00:00", y, m);
        json!([
            {
                "label": "Groceries",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": { key.clone(): 350.0 }
            },
            {
                "label": "Rent",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": { key: 500.0 }
            }
        ])
        .to_string()
    }

    /// Limits: Groceries 800, Rent 1500 for exactly the given month.
    fn budget_limits_body(start: &str, end: &str) -> String {
        json!({
            "data": [
                {
                    "id": "10",
                    "attributes": {
                        "start": format!("{}T00:00:00+00:00", start),
                        "end": format!("{}T23:59:59+00:00", end),
                        "budget_id": "1",
                        "amount": "800.00",
                        "currency_code": "USD",
                        "currency_symbol": "$"
                    }
                },
                {
                    "id": "11",
                    "attributes": {
                        "start": format!("{}T00:00:00+00:00", start),
                        "end": format!("{}T23:59:59+00:00", end),
                        "budget_id": "2",
                        "amount": "1500.00",
                        "currency_code": "USD",
                        "currency_symbol": "$"
                    }
                }
            ]
        })
        .to_string()
    }

    fn net_worth_asset_body(y: i32, m: u32) -> String {
        let first = format!("{}-{:02}-01", y, m);
        let last = format!("{}-{:02}-28", y, m);
        json!([
            {
                "label": "Assets",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    first: 10000.0,
                    last: 10800.0
                }
            }
        ])
        .to_string()
    }

    /// Firefly III reports debt liability balances as NEGATIVE values
    /// (a $2,000 debt has balance -2000), so net worth = assets + liabilities.
    fn net_worth_liability_body(y: i32, m: u32) -> String {
        let first = format!("{}-{:02}-01", y, m);
        let last = format!("{}-{:02}-28", y, m);
        json!([
            {
                "label": "Liabilities",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    first: -2000.0,
                    last: -1900.0
                }
            }
        ])
        .to_string()
    }

    fn accounts_body() -> String {
        json!({
            "data": [
                { "id": "1", "attributes": { "name": "Checking", "type": "asset", "current_balance": "5000.00", "currency_symbol": "$" } },
                { "id": "2", "attributes": { "name": "Savings", "type": "asset", "current_balance": "9000.00", "currency_symbol": "$" } },
                { "id": "10", "attributes": { "name": "Supermarket", "type": "expense", "current_balance": "-100.00", "currency_symbol": "$" } },
                { "id": "11", "attributes": { "name": "Landlord", "type": "expense", "current_balance": "-500.00", "currency_symbol": "$" } },
                { "id": "12", "attributes": { "name": "Garage", "type": "expense", "current_balance": "-1200.00", "currency_symbol": "$" } },
                { "id": "13", "attributes": { "name": "Odd Jobs", "type": "expense", "current_balance": "-2000.00", "currency_symbol": "$" } },
                { "id": "20", "attributes": { "name": "Employer", "type": "revenue", "current_balance": "3000.00", "currency_symbol": "$" } }
            ]
        })
        .to_string()
    }

    /// Create an empty-transaction mock for every full-month trend chunk in
    /// the 12 months ending at (y, m), except ranges in `skip` (those get
    /// their own specific mocks). With one mock per exact query there is no
    /// matching-order ambiguity in mockito.
    async fn mock_trend_chunks(
        server: &mut mockito::Server,
        y: i32,
        m: u32,
        skip: &[(String, String)],
    ) {
        for i in 0..12i32 {
            let total = (y - 2000) * 12 + (m as i32) - 1 + (i - 11);
            let cy = 2000 + total / 12;
            let cm = ((total % 12) + 12) % 12 + 1;
            let (cstart, cend, _) = month_range(cy, cm as u32).unwrap();
            let cs = cstart.format("%Y-%m-%d").to_string();
            let ce = cend.format("%Y-%m-%d").to_string();
            if skip.iter().any(|(a, b)| a == &cs && b == &ce) {
                continue;
            }
            server
                .mock("GET", "/v1/transactions")
                .match_query(mockito::Matcher::Regex(format!(r"start={}&end={}", cs, ce)))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(tx_list(vec![]).to_string())
                .create_async()
                .await;
        }
    }

    // ── Completed (past) month integration test ──────────────────────────

    #[tokio::test]
    async fn test_month_summary_completed_month() {
        let now = chrono::Utc::now();
        let (y, m) = shift_months(now.year(), now.month(), -6);
        let (m_start, m_end, days_in_month) = month_range(y, m).unwrap();
        let (py, pm) = shift_months(y, m, -1);
        let (p_start, p_end, _) = month_range(py, pm).unwrap();
        let (ty, tm) = shift_months(y, m, -11);

        let m_start_s = m_start.format("%Y-%m-%d").to_string();
        let m_end_s = m_end.format("%Y-%m-%d").to_string();
        let p_start_s = p_start.format("%Y-%m-%d").to_string();
        let p_end_s = p_end.format("%Y-%m-%d").to_string();

        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // Transactions mocks: one mock per exact query (no catch-all), so
        // there is no matching-order ambiguity in mockito.
        mock_trend_chunks(
            &mut server,
            y,
            m,
            &[
                (p_start_s.clone(), p_end_s.clone()),
                (m_start_s.clone(), m_end_s.clone()),
            ],
        )
        .await;
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                p_start_s, p_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(prev_month_fixture(py, pm).to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(month_fixture(y, m).to_string())
            .create_async()
            .await;

        server
            .mock("GET", "/v1/budgets")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(budget_list_body())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/budget/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(budget_spent_body(y, m))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/budget-limits")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(budget_limits_body(&m_start_s, &m_end_s))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}&period=1D&preselected=assets",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(net_worth_asset_body(y, m))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}&period=1D&preselected=liabilities",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(net_worth_liability_body(y, m))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/accounts")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(accounts_body())
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(url));
        let summary = client
            .get_month_summary(y, m, None, &Exclusions::new(vec![], vec![]))
            .await
            .unwrap();

        // ── Envelope ──
        assert_eq!(summary.year, y);
        assert_eq!(summary.month, m);
        assert_eq!(summary.start_date, m_start_s);
        assert_eq!(summary.end_date, m_end_s);
        assert!(!summary.is_current_month);
        assert!(
            summary.warnings.is_empty(),
            "unexpected warnings: {:?}",
            summary.warnings
        );

        // ── Headline totals ──
        let t = &summary.totals;
        assert!((t.earned - 3000.0).abs() < 1e-6);
        assert!((t.spent - 2050.0).abs() < 1e-6); // transfer 999 excluded
        assert!((t.net - 950.0).abs() < 1e-6);
        assert!((t.savings_rate.unwrap() - 950.0 / 3000.0 * 100.0).abs() < 1e-6);
        assert_eq!(t.days_in_month, days_in_month);
        assert_eq!(t.days_elapsed, days_in_month);
        assert!((t.daily_average_spent - 2050.0 / days_in_month as f64).abs() < 1e-6);

        // ── Month-over-month ──
        assert!((t.prev_month_earned.unwrap() - 3000.0).abs() < 1e-6);
        assert!((t.prev_month_spent.unwrap() - 2000.0).abs() < 1e-6);
        assert!((t.prev_month_net.unwrap() - 1000.0).abs() < 1e-6);
        assert!((t.earned_delta_pct.unwrap() - 0.0).abs() < 1e-9);
        assert!((t.spent_delta_pct.unwrap() - 2.5).abs() < 1e-9);

        // ── Net worth: 10800 + (-1900) = 8900 end, 10000 + (-2000) = 8000 start ──
        assert!((t.net_worth.unwrap() - 8900.0).abs() < 1e-6);
        assert!((t.net_worth_delta.unwrap() - 900.0).abs() < 1e-6);

        // ── Daily series ──
        assert_eq!(summary.daily.dates.len(), days_in_month as usize);
        assert_eq!(summary.daily.dates.first(), Some(&m_start_s));
        let earned_sum: f64 = summary.daily.earned.iter().sum();
        let spent_sum: f64 = summary.daily.spent.iter().sum();
        assert!((earned_sum - 3000.0).abs() < 1e-6);
        assert!((spent_sum - 2050.0).abs() < 1e-6);
        let last_cum = *summary.daily.cumulative_spent.last().unwrap();
        assert!((last_cum - 2050.0).abs() < 1e-6);

        // ── Categories sum exactly to spent ──
        let cat_sum: f64 = summary.categories.iter().map(|c| c.amount).sum();
        assert!((cat_sum - 2050.0).abs() < 1e-6);
        assert_eq!(summary.categories.len(), 3);
        assert_eq!(summary.categories[0].name, "Cars:Repairs");
        assert!((summary.categories[0].amount - 1200.0).abs() < 1e-6);
        assert!((summary.categories[0].pct - 1200.0 / 2050.0 * 100.0).abs() < 1e-6);
        assert_eq!(summary.categories[1].name, "Housing:Rent");
        assert_eq!(summary.categories[2].name, "Food & Drink:Groceries");
        assert!((summary.categories[2].amount - 350.0).abs() < 1e-6);

        // ── Budgets ──
        assert_eq!(summary.budgets.len(), 3);
        // Worst-first sort: Groceries (43.75%) before Rent (33.3%), then no-limit
        assert_eq!(summary.budgets[0].name, "Groceries");
        assert!((summary.budgets[0].spent - 350.0).abs() < 1e-6);
        assert!((summary.budgets[0].limit.unwrap() - 800.0).abs() < 1e-6);
        assert!((summary.budgets[0].pct_of_limit.unwrap() - 43.75).abs() < 1e-6);
        assert_eq!(summary.budgets[0].status, "ok");
        assert!(summary.budgets[0].projected.is_none()); // completed month

        assert_eq!(summary.budgets[1].name, "Rent");
        assert!((summary.budgets[1].pct_of_limit.unwrap() - 500.0 / 1500.0 * 100.0).abs() < 1e-6);
        assert_eq!(summary.budgets[1].status, "ok");

        assert_eq!(summary.budgets[2].name, "Utilities");
        assert!((summary.budgets[2].spent - 0.0).abs() < 1e-6);
        assert!(summary.budgets[2].limit.is_none());
        assert_eq!(summary.budgets[2].status, "no-limit");

        let bt = &summary.budget_totals;
        assert_eq!(bt.count, 3);
        assert_eq!(bt.with_limit, 2);
        assert!((bt.limited - 2300.0).abs() < 1e-6);
        assert!((bt.limited_spent - 850.0).abs() < 1e-6);
        assert!((bt.spent - 850.0).abs() < 1e-6);
        assert_eq!(bt.over_count, 0);

        // ── Top expenses (transfer 999 excluded) ──
        assert_eq!(summary.top_expenses.len(), 4);
        assert!((summary.top_expenses[0].amount - 1200.0).abs() < 1e-6);
        assert_eq!(summary.top_expenses[0].description, "Car repair");
        assert_eq!(summary.top_expenses[0].account.as_deref(), Some("Garage"));
        assert_eq!(
            summary.top_expenses[0].category.as_deref(),
            Some("Cars:Repairs")
        );
        assert!((summary.top_expenses[1].amount - 500.0).abs() < 1e-6);
        assert!((summary.top_expenses[2].amount - 250.0).abs() < 1e-6);
        assert!((summary.top_expenses[3].amount - 100.0).abs() < 1e-6);
        assert!(!summary
            .top_expenses
            .iter()
            .any(|t| (t.amount - 999.0).abs() < 1e-6));

        // ── 12-month trend: oldest 10 months empty, prior month has data ──
        let trend = &summary.trend_12m;
        assert_eq!(trend.labels.len(), 12);
        let expected_first = format!("{}-{:02}", ty, tm);
        assert_eq!(trend.labels[0], expected_first);
        let expected_last = format!("{}-{:02}", y, m);
        assert_eq!(trend.labels[11], expected_last);
        for i in 0..10 {
            assert!(
                (trend.earned[i] - 0.0).abs() < 1e-6,
                "month {}",
                trend.labels[i]
            );
            assert!(
                (trend.spent[i] - 0.0).abs() < 1e-6,
                "month {}",
                trend.labels[i]
            );
        }
        // Prior month (mocked with salary 3000 + 2000 spent)
        assert!((trend.earned[10] - 3000.0).abs() < 1e-6);
        assert!((trend.spent[10] - 2000.0).abs() < 1e-6);
        assert!((trend.earned[11] - 3000.0).abs() < 1e-6);
        assert!((trend.spent[11] - 2050.0).abs() < 1e-6);

        // ── Currency ──
        assert_eq!(summary.currency.code.as_deref(), Some("USD"));
        assert_eq!(summary.currency.symbol.as_deref(), Some("$"));
    }

    // ── Current (partial) month integration test ─────────────────────────

    #[tokio::test]
    async fn test_month_summary_current_month() {
        let now = chrono::Utc::now();
        let y = now.year();
        let m = now.month();
        let days_elapsed = now.day();
        let (m_start, m_end, days_in_month) = month_range(y, m).unwrap();
        let m_start_s = m_start.format("%Y-%m-%d").to_string();
        let m_end_s = m_end.format("%Y-%m-%d").to_string();
        let today_s = now.format("%Y-%m-%d").to_string();

        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        // Current month transactions: 100 spent + 3000 earned on day 1 (always <= today).
        let d1 = format!("{}-{:02}-01", y, m);
        let current_txs = tx_list(vec![
            deposit_tx("c-sal", &d1, 3000.0, "Salary", "Income:Salary", "20", "1"),
            withdrawal_tx(
                "c-sub",
                &d1,
                100.0,
                "Subscription",
                "Software:Subs",
                "Subs",
                "1",
                "10",
            ),
        ]);

        // Transactions mocks: one mock per exact query (no catch-all).
        mock_trend_chunks(
            &mut server,
            y,
            m,
            &[
                (m_start_s.clone(), today_s.clone()),
                (m_start_s.clone(), m_end_s.clone()),
            ],
        )
        .await;
        // Current month, end clamped to today (daily + top-expenses fetch).
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                m_start_s, today_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(current_txs.to_string())
            .create_async()
            .await;
        // Current month, end at calendar month end (12-month trend window).
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(current_txs.to_string())
            .create_async()
            .await;

        server
            .mock("GET", "/v1/budgets")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "data": [
                        { "id": "5", "attributes": { "name": "Subs", "active": true } }
                    ]
                })
                .to_string(),
            )
            .create_async()
            .await;
        let budget_key = d1.clone();
        server
            .mock("GET", "/v1/chart/budget/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                m_start_s, today_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([{
                    "label": "Subs",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": { budget_key: 100.0 }
                }])
                .to_string(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/v1/budget-limits")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                m_start_s, today_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "data": [{
                        "id": "50",
                        "attributes": {
                            "start": format!("{}T00:00:00+00:00", m_start_s),
                            "end": format!("{}T23:59:59+00:00", m_end_s),
                            "budget_id": "5",
                            "amount": "100.00",
                            "currency_code": "USD",
                            "currency_symbol": "$"
                        }
                    }]
                })
                .to_string(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}&period=1D&preselected=assets",
                m_start_s, today_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([{
                    "label": "Assets",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": { d1.clone(): 10000.0, today_s.clone(): 10100.0 }
                }])
                .to_string(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}&period=1D&preselected=liabilities",
                m_start_s, today_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([{
                    "label": "Liabilities",
                    "currency_symbol": "$",
                    "currency_code": "USD",
                    "entries": { d1.clone(): -2000.0, today_s.clone(): -2000.0 }
                }])
                .to_string(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/v1/accounts")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(accounts_body())
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(url));
        let summary = client
            .get_month_summary(y, m, None, &Exclusions::new(vec![], vec![]))
            .await
            .unwrap();

        assert!(summary.is_current_month);
        assert_eq!(summary.end_date, m_end_s); // full calendar month end
        assert!(
            summary.warnings.is_empty(),
            "unexpected warnings: {:?}",
            summary.warnings
        );

        let t = &summary.totals;
        assert_eq!(t.days_elapsed, days_elapsed);
        assert_eq!(t.days_in_month, days_in_month);
        assert!((t.earned - 3000.0).abs() < 1e-6);
        assert!((t.spent - 100.0).abs() < 1e-6);
        assert!((t.net - 2900.0).abs() < 1e-6);
        assert!((t.daily_average_spent - 100.0 / days_elapsed as f64).abs() < 1e-6);

        // Previous month was empty: totals Some(0), deltas undefined.
        assert!((t.prev_month_earned.unwrap() - 0.0).abs() < 1e-6);
        assert!(t.earned_delta_pct.is_none());
        assert!(t.spent_delta_pct.is_none());

        // Net worth: 10100 + (-2000) = 8100, delta 100.
        assert!((t.net_worth.unwrap() - 8100.0).abs() < 1e-6);
        assert!((t.net_worth_delta.unwrap() - 100.0).abs() < 1e-6);

        // Budget: 100 spent of 100 limit, projected by daily pace.
        assert_eq!(summary.budgets.len(), 1);
        let b = &summary.budgets[0];
        assert_eq!(b.name, "Subs");
        assert!((b.spent - 100.0).abs() < 1e-6);
        assert!((b.limit.unwrap() - 100.0).abs() < 1e-6);
        let expected_proj = 100.0 * days_in_month as f64 / days_elapsed as f64;
        assert!((b.projected.unwrap() - expected_proj).abs() < 1e-6);
        // spent == limit is not "over"; projected > limit -> at risk
        assert_eq!(b.status, "warning");

        // Trend: only the current (last) month has data.
        assert_eq!(summary.trend_12m.labels.len(), 12);
        for i in 0..11 {
            assert!(
                (summary.trend_12m.spent[i] - 0.0).abs() < 1e-6,
                "month {}",
                summary.trend_12m.labels[i]
            );
            assert!(
                (summary.trend_12m.earned[i] - 0.0).abs() < 1e-6,
                "month {}",
                summary.trend_12m.labels[i]
            );
        }
        assert!((summary.trend_12m.spent[11] - 100.0).abs() < 1e-6);
        assert!((summary.trend_12m.earned[11] - 3000.0).abs() < 1e-6);
    }

    // ── Category exclusion consistency ───────────────────────────────────

    #[tokio::test]
    async fn test_month_summary_category_exclusions() {
        let now = chrono::Utc::now();
        let (y, m) = shift_months(now.year(), now.month(), -6);
        let (m_start, m_end, _) = month_range(y, m).unwrap();
        let (py, pm) = shift_months(y, m, -1);
        let (p_start, p_end, _) = month_range(py, pm).unwrap();

        let m_start_s = m_start.format("%Y-%m-%d").to_string();
        let m_end_s = m_end.format("%Y-%m-%d").to_string();
        let p_start_s = p_start.format("%Y-%m-%d").to_string();
        let p_end_s = p_end.format("%Y-%m-%d").to_string();

        let mut server = mockito::Server::new_async().await;
        let url = server.url();

        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}",
                p_start_s, p_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(prev_month_fixture(py, pm).to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(r".*".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(month_fixture(y, m).to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/budgets")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(budget_list_body())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/budget/overview")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(budget_spent_body(y, m))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/budget-limits")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(budget_limits_body(&m_start_s, &m_end_s))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}&period=1D&preselected=assets",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(net_worth_asset_body(y, m))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(format!(
                r"start={}&end={}&period=1D&preselected=liabilities",
                m_start_s, m_end_s
            )))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(net_worth_liability_body(y, m))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/accounts")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(accounts_body())
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(url));
        let exclusions = Exclusions::new(vec!["Cars".to_string()], vec![]);
        let summary = client
            .get_month_summary(y, m, None, &exclusions)
            .await
            .unwrap();

        // Cars:Repairs (1200) excluded from everything transaction-derived.
        assert!((summary.totals.spent - 850.0).abs() < 1e-6);
        assert!((summary.totals.net - 2150.0).abs() < 1e-6);

        let cat_sum: f64 = summary.categories.iter().map(|c| c.amount).sum();
        assert!((cat_sum - 850.0).abs() < 1e-6);
        assert!(!summary.categories.iter().any(|c| c.name == "Cars:Repairs"));
        assert_eq!(summary.categories.len(), 2);
        // Pct now relative to the reduced total
        let top = &summary.categories[0];
        assert_eq!(top.name, "Housing:Rent");
        assert!((top.pct - 500.0 / 850.0 * 100.0).abs() < 1e-6);

        assert!(!summary
            .top_expenses
            .iter()
            .any(|t| t.description == "Car repair"));
        assert!((summary.top_expenses[0].amount - 500.0).abs() < 1e-6);
    }

    // ── Error cases ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_month_summary_rejects_future_month() {
        let server = mockito::Server::new_async().await;
        let url = server.url();
        let client = FireflyClient::new(make_test_config(url));
        let err = client
            .get_month_summary(2099, 12, None, &Exclusions::new(vec![], vec![]))
            .await
            .unwrap_err();
        assert!(err.contains("future"), "unexpected error: {}", err);
    }

    #[tokio::test]
    async fn test_month_summary_rejects_invalid_month() {
        let server = mockito::Server::new_async().await;
        let url = server.url();
        let client = FireflyClient::new(make_test_config(url));
        let err = client
            .get_month_summary(2026, 13, None, &Exclusions::new(vec![], vec![]))
            .await
            .unwrap_err();
        assert!(err.contains("Invalid month"), "unexpected error: {}", err);
    }

    // ── Route registration ───────────────────────────────────────────────

    #[test]
    fn test_summary_routes_registered() {
        let main_rs = include_str!("../src/main.rs");
        assert!(
            main_rs.contains("summary::summary_page"),
            "/summary page handler should be registered"
        );
        assert!(
            main_rs.contains("summary::get_month_summary_api"),
            "/api/summary/month handler should be registered"
        );

        let handlers_mod = include_str!("../src/handlers/mod.rs");
        assert!(
            handlers_mod.contains("pub mod summary;"),
            "summary module should be declared"
        );
    }
}
