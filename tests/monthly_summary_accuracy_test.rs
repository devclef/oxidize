/// Data-quality tests for the Monthly Summary (/api/summary/month).
///
/// Every transaction-derived figure is built in one pass over one
/// transaction set, so the sections must agree with each other:
/// - budget spend + unbudgeted spend == total spending == category sum
/// - the 12-month trend's selected month == the headline totals
/// - the previous-month comparison covers the same days for a partial
///   month (never a half month against a whole one)
/// - net worth change includes changes made on the 1st
/// - budgets: matched by id, excluded budgets hidden, inactive budgets
///   without spend hidden, unknown budgets kept visible
/// - mixed currencies are flagged; results are cached per month + filters
#[cfg(test)]
mod tests {
    use chrono::Datelike;
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use oxidize::models::summary::{comparison_window_days, month_range, shift_months};
    use oxidize::models::Exclusions;
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

    /// One-journal transaction. `extra` fields are merged into the journal.
    fn tx(
        id: &str,
        kind: &str,
        date: &str,
        amount: f64,
        extra: serde_json::Value,
    ) -> serde_json::Value {
        let mut journal = json!({
            "type": kind,
            "amount": format!("{:.2}", amount),
            "description": id,
            "source_id": if kind == "deposit" { "20" } else { "1" },
            "destination_id": if kind == "deposit" { "1" } else { "10" },
            "date": date,
            "currency_code": "USD",
            "currency_symbol": "$"
        });
        if let (Some(j), Some(e)) = (journal.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                j.insert(k.clone(), v.clone());
            }
        }
        json!({ "type": "transactions", "id": id, "attributes": { "transactions": [journal] } })
    }

    struct Fixture {
        txs: Vec<serde_json::Value>,
        budgets: serde_json::Value,
        limits: serde_json::Value,
        nw_assets: serde_json::Value,
    }

    /// Mock every Firefly endpoint the summary uses. Transactions use a
    /// catch-all (the client de-duplicates by id across monthly chunks).
    async fn serve(server: &mut mockito::Server, f: &Fixture) -> mockito::Mock {
        let txs = server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({ "data": f.txs }).to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/budgets")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(f.budgets.to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/budget-limits")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(f.limits.to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex("preselected=assets".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(f.nw_assets.to_string())
            .create_async()
            .await;
        server
            .mock("GET", "/v1/chart/account/overview")
            .match_query(mockito::Matcher::Regex(
                "preselected=liabilities".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body("[]")
            .create_async()
            .await;
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({ "data": [
                    { "id": "1", "attributes": { "name": "Checking", "type": "asset", "current_balance": "0", "currency_symbol": "$" } },
                    { "id": "10", "attributes": { "name": "Shop", "type": "expense", "current_balance": "0", "currency_symbol": "$" } },
                    { "id": "20", "attributes": { "name": "Employer", "type": "revenue", "current_balance": "0", "currency_symbol": "$" } }
                ]})
                .to_string(),
            )
            .create_async()
            .await;
        txs
    }

    fn past_month() -> (i32, u32) {
        let now = chrono::Utc::now();
        shift_months(now.year(), now.month(), -3)
    }

    fn day(y: i32, m: u32, d: u32) -> String {
        format!("{}-{:02}-{:02}", y, m, d)
    }

    /// Completed month with budgeted, unbudgeted and previous-month spend.
    fn completed_fixture(y: i32, m: u32) -> Fixture {
        let (py, pm) = shift_months(y, m, -1);
        let (_, p_end, _) = month_range(py, pm).unwrap();
        let p_end_s = p_end.format("%Y-%m-%d").to_string();
        Fixture {
            txs: vec![
                tx(
                    "sal",
                    "deposit",
                    &day(y, m, 1),
                    3000.0,
                    json!({ "category_name": "Salary" }),
                ),
                // Budget matched by id even though the name changed since.
                tx(
                    "gro",
                    "withdrawal",
                    &day(y, m, 3),
                    200.0,
                    json!({
                        "category_name": "Groceries", "budget_id": "1", "budget_name": "Old name",
                        "destination_name": "Supermarket"
                    }),
                ),
                tx(
                    "gro2",
                    "withdrawal",
                    &day(y, m, 9),
                    100.0,
                    json!({
                        "category_name": "Groceries", "budget_id": "1"
                    }),
                ),
                // Budget only known by name.
                tx(
                    "rent",
                    "withdrawal",
                    &day(y, m, 2),
                    900.0,
                    json!({
                        "category_name": "Housing", "budget_name": "Rent"
                    }),
                ),
                // Unbudgeted, empty category -> "Uncategorized".
                tx(
                    "misc",
                    "withdrawal",
                    &day(y, m, 15),
                    50.0,
                    json!({ "category_name": "" }),
                ),
                // Spend on a budget the budget list does not contain.
                tx(
                    "gone",
                    "withdrawal",
                    &day(y, m, 20),
                    25.0,
                    json!({
                        "category_name": "Fun", "budget_id": "99", "budget_name": "Deleted budget"
                    }),
                ),
                // Previous month (full month is the comparison window).
                tx(
                    "p-gro",
                    "withdrawal",
                    &day(py, pm, 4),
                    150.0,
                    json!({
                        "category_name": "Groceries", "budget_id": "1"
                    }),
                ),
                tx(
                    "p-late",
                    "withdrawal",
                    &p_end_s,
                    400.0,
                    json!({ "category_name": "Housing" }),
                ),
                tx("p-sal", "deposit", &day(py, pm, 1), 2500.0, json!({})),
            ],
            budgets: json!({ "data": [
                { "id": "1", "attributes": { "name": "Groceries", "active": true } },
                { "id": "2", "attributes": { "name": "Rent", "active": true } },
                { "id": "3", "attributes": { "name": "Retired", "active": false } },
                { "id": "4", "attributes": { "name": "Travel", "active": true } }
            ]}),
            limits: json!({ "data": [
                { "id": "10", "attributes": {
                    "start": format!("{}T00:00:00+00:00", day(y, m, 1)),
                    "end": format!("{}T23:59:59+00:00", day(y, m, 28)),
                    "budget_id": "1", "amount": "250.00"
                }}
            ]}),
            // Balance at the end of the previous month, the 1st, and the end.
            nw_assets: json!([{ "label": "Assets", "entries": {
                p_end_s: 1000.0,
                day(y, m, 1): 4000.0,
                day(y, m, 28): 1725.0
            }}]),
        }
    }

    #[test]
    fn test_comparison_window_days() {
        // Partial month: same days of the previous month...
        assert_eq!(comparison_window_days(true, 12, 30), 12);
        // ...capped at the previous month's length (31 Mar vs Feb).
        assert_eq!(comparison_window_days(true, 31, 28), 28);
        // Completed month: the whole previous month.
        assert_eq!(comparison_window_days(false, 31, 30), 30);
    }

    #[tokio::test]
    async fn test_sections_reconcile_for_completed_month() {
        let (y, m) = past_month();
        let mut server = mockito::Server::new_async().await;
        serve(&mut server, &completed_fixture(y, m)).await;
        let client = FireflyClient::new(make_test_config(server.url()));
        let s = client
            .get_month_summary(y, m, None, None, &Exclusions::new(vec![], vec![]))
            .await
            .unwrap();

        let t = &s.totals;
        assert!((t.spent - 1275.0).abs() < 1e-6);
        assert!((t.earned - 3000.0).abs() < 1e-6);
        assert_eq!(t.spent_count, 5);

        // Budget spend + unbudgeted == total == categories.
        let bt = &s.budget_totals;
        assert!((bt.unbudgeted - 50.0).abs() < 1e-6);
        assert!((bt.spent + bt.unbudgeted - t.spent).abs() < 1e-6);
        let cat_sum: f64 = s.categories.iter().map(|c| c.amount).sum();
        assert!((cat_sum - t.spent).abs() < 1e-6);

        // Trend's selected month == headline totals; previous month too.
        assert!((s.trend_12m.spent[11] - t.spent).abs() < 1e-6);
        assert!((s.trend_12m.earned[11] - t.earned).abs() < 1e-6);
        assert!((s.trend_12m.spent[10] - 550.0).abs() < 1e-6);

        // Daily series covers every day and sums to the totals.
        assert_eq!(s.daily.dates.len(), t.days_in_month as usize);
        let daily_sum: f64 = s.daily.spent.iter().sum();
        assert!((daily_sum - t.spent).abs() < 1e-6);
        assert!((s.daily.cumulative_spent.last().unwrap() - t.spent).abs() < 1e-6);

        // Completed month: compared with the whole previous month.
        let (_, _, prev_days) =
            month_range(shift_months(y, m, -1).0, shift_months(y, m, -1).1).unwrap();
        assert_eq!(t.comparison_days, Some(prev_days));
        assert!((t.prev_period_spent.unwrap() - 550.0).abs() < 1e-6);
        assert!((t.prev_month_spent.unwrap() - 550.0).abs() < 1e-6);
        assert!((t.spent_delta_pct.unwrap() - (1275.0 - 550.0) / 550.0 * 100.0).abs() < 1e-6);
        assert!(t.projected_spent.is_none());

        // Net worth delta is measured from the end of the previous month.
        assert!((t.net_worth.unwrap() - 1725.0).abs() < 1e-6);
        assert!((t.net_worth_delta.unwrap() - 725.0).abs() < 1e-6);

        // Budgets.
        let by_name = |n: &str| s.budgets.iter().find(|b| b.name == n);
        let groceries = by_name("Groceries").expect("groceries");
        assert!(
            (groceries.spent - 300.0).abs() < 1e-6,
            "matched by budget_id"
        );
        assert_eq!(groceries.status, "over");
        assert!((by_name("Rent").unwrap().spent - 900.0).abs() < 1e-6);
        assert!(
            by_name("Retired").is_none(),
            "inactive budget without spend hidden"
        );
        assert!(
            by_name("Travel").is_some(),
            "active budget without spend shown"
        );
        assert!((by_name("Deleted budget").unwrap().spent - 25.0).abs() < 1e-6);
        assert_eq!(s.budgets[0].name, "Groceries", "over-budget sorted first");
        assert_eq!(bt.over_count, 1);

        // Categories: empty name -> Uncategorized, counts and prev amounts.
        let cat = |n: &str| s.categories.iter().find(|c| c.name == n).unwrap();
        assert!((cat("Uncategorized").amount - 50.0).abs() < 1e-6);
        assert_eq!(cat("Groceries").count, 2);
        assert!((cat("Groceries").prev_amount.unwrap() - 150.0).abs() < 1e-6);
        assert!((cat("Housing").prev_amount.unwrap() - 400.0).abs() < 1e-6);
        assert!((cat("Fun").prev_amount.unwrap() - 0.0).abs() < 1e-6);

        // Top expenses: journal names preferred, account lookup as fallback.
        let top = &s.top_expenses;
        assert_eq!(top[0].description, "rent");
        assert_eq!(top[0].budget.as_deref(), Some("Rent"));
        assert_eq!(top[0].account.as_deref(), Some("Shop"));
        assert_eq!(top[0].source.as_deref(), Some("Checking"));
        let gro = top.iter().find(|e| e.description == "gro").unwrap();
        assert_eq!(gro.account.as_deref(), Some("Supermarket"));

        assert!(s.warnings.is_empty(), "{:?}", s.warnings);
    }

    #[tokio::test]
    async fn test_excluded_budget_is_hidden() {
        let (y, m) = past_month();
        let mut server = mockito::Server::new_async().await;
        serve(&mut server, &completed_fixture(y, m)).await;
        let client = FireflyClient::new(make_test_config(server.url()));
        let s = client
            .get_month_summary(
                y,
                m,
                None,
                None,
                &Exclusions::new(vec![], vec!["Rent".into()]),
            )
            .await
            .unwrap();
        assert!(!s.budgets.iter().any(|b| b.name == "Rent"));
        assert!((s.totals.spent - 375.0).abs() < 1e-6);
        assert!((s.budget_totals.spent + s.budget_totals.unbudgeted - s.totals.spent).abs() < 1e-6);
    }

    #[tokio::test]
    async fn test_current_month_compares_same_days_and_ignores_future_dates() {
        let now = chrono::Utc::now();
        let (y, m) = (now.year(), now.month());
        let today = now.day();
        let (_, m_end, days_in_month) = month_range(y, m).unwrap();
        let (py, pm) = shift_months(y, m, -1);
        let (_, p_end, prev_days) = month_range(py, pm).unwrap();

        let mut txs = vec![
            tx(
                "c1",
                "withdrawal",
                &day(y, m, 1),
                100.0,
                json!({ "category_name": "Food" }),
            ),
            // Previous month: inside the comparison window (day 1)...
            tx(
                "p1",
                "withdrawal",
                &day(py, pm, 1),
                80.0,
                json!({ "category_name": "Food" }),
            ),
        ];
        // ...and outside it (last day), unless today covers the whole month.
        let window = today.min(prev_days);
        if window < prev_days {
            txs.push(tx(
                "p2",
                "withdrawal",
                &p_end.format("%Y-%m-%d").to_string(),
                1000.0,
                json!({}),
            ));
        }
        // A future-dated (scheduled) withdrawal later this month.
        if today < days_in_month {
            txs.push(tx(
                "future",
                "withdrawal",
                &m_end.format("%Y-%m-%d").to_string(),
                5000.0,
                json!({}),
            ));
        }

        let mut server = mockito::Server::new_async().await;
        serve(
            &mut server,
            &Fixture {
                txs,
                budgets: json!({ "data": [] }),
                limits: json!({ "data": [] }),
                nw_assets: json!([]),
            },
        )
        .await;
        let client = FireflyClient::new(make_test_config(server.url()));
        let s = client
            .get_month_summary(y, m, None, None, &Exclusions::new(vec![], vec![]))
            .await
            .unwrap();

        let t = &s.totals;
        assert!(
            (t.spent - 100.0).abs() < 1e-6,
            "future-dated spend not counted"
        );
        assert!(
            (s.trend_12m.spent[11] - 100.0).abs() < 1e-6,
            "trend agrees with totals"
        );
        assert_eq!(s.daily.dates.len(), today as usize);
        assert_eq!(t.comparison_days, Some(window));
        assert!((t.prev_period_spent.unwrap() - 80.0).abs() < 1e-6);
        assert!((t.spent_delta_pct.unwrap() - 25.0).abs() < 1e-6);
        let expected_projection = 100.0 * days_in_month as f64 / today as f64;
        assert!((t.projected_spent.unwrap() - expected_projection).abs() < 1e-6);
        assert!((s.categories[0].prev_amount.unwrap() - 80.0).abs() < 1e-6);
    }

    #[tokio::test]
    async fn test_mixed_currencies_are_flagged() {
        let (y, m) = past_month();
        let mut server = mockito::Server::new_async().await;
        serve(
            &mut server,
            &Fixture {
                txs: vec![
                    tx("usd", "withdrawal", &day(y, m, 2), 10.0, json!({})),
                    tx(
                        "eur",
                        "withdrawal",
                        &day(y, m, 3),
                        20.0,
                        json!({
                            "currency_code": "EUR", "currency_symbol": "€"
                        }),
                    ),
                ],
                budgets: json!({ "data": [] }),
                limits: json!({ "data": [] }),
                nw_assets: json!([]),
            },
        )
        .await;
        let client = FireflyClient::new(make_test_config(server.url()));
        let s = client
            .get_month_summary(y, m, None, None, &Exclusions::new(vec![], vec![]))
            .await
            .unwrap();
        assert!(
            s.warnings.iter().any(|w| w.contains("EUR, USD")),
            "{:?}",
            s.warnings
        );
    }

    #[tokio::test]
    async fn test_summary_is_cached_per_month_and_filters() {
        let (y, m) = past_month();
        let mut server = mockito::Server::new_async().await;
        let txs_mock = serve(&mut server, &completed_fixture(y, m)).await;
        let client = FireflyClient::new(make_test_config(server.url()));
        let none = Exclusions::new(vec![], vec![]);

        let first = client
            .get_month_summary(y, m, None, None, &none)
            .await
            .unwrap();
        // Turn transactions into an error: a cached summary must not refetch.
        txs_mock.remove_async().await;
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Any)
            .with_status(500)
            .create_async()
            .await;
        let second = client
            .get_month_summary(y, m, None, None, &none)
            .await
            .unwrap();
        assert!((first.totals.spent - second.totals.spent).abs() < 1e-9);

        // Different exclusions -> different cache entry -> refetch (fails).
        let other = Exclusions::new(vec!["Groceries".into()], vec![]);
        assert!(client
            .get_month_summary(y, m, None, None, &other)
            .await
            .is_err());
    }
}
