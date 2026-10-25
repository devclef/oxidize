/// Tests for the Budget Breakdown widget feature
/// (plans/budget-breakdown-widget.md):
/// - /api/budgets/breakdown aggregation (mocked /v1/transactions):
///   by-category and by-destination datasets, month buckets, budget
///   filtering (selected budgets only; empty = all budgeted spend),
///   unbudgeted + deposits dropped, account filtering, exclusions
/// - widget model field budget_breakdown_by persisting through storage
///
/// The storage layer is process-wide, so the stateful test serializes on
/// TEST_LOCK and uses a process-specific temp database.
#[cfg(test)]
mod tests {
    #![allow(clippy::await_holding_lock)] // TEST_LOCK serializes the whole test, by design

    use actix_web::test as awt;
    use actix_web::{web, App};
    use oxidize::client::FireflyClient;
    use oxidize::config::{Config, FireflyUrl};
    use oxidize::handlers::account::get_budget_breakdown;
    use oxidize::handlers::widget::{create_widget, list_widgets};
    use oxidize::models::Widget;
    use oxidize::storage::Storage;
    use serde_json::json;
    use std::sync::{Mutex, Once};

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn init_storage_once() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let dir = format!("/tmp/oxidize-budget-breakdown-test-{}", std::process::id());
            let _ = std::fs::remove_dir_all(&dir);
            oxidize::storage::init_data_dir(dir);
        });
    }

    fn make_test_config(url: String) -> Config {
        Config {
            firefly_url: FireflyUrl::validate(url).unwrap(),
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

    macro_rules! build_app {
        ($config:expr, $client:expr) => {{
            init_storage_once();
            awt::init_service(
                App::new()
                    .app_data($client.clone())
                    .app_data(web::Data::new($config.clone()))
                    .app_data(web::JsonConfig::default())
                    .service(get_budget_breakdown)
                    .service(create_widget)
                    .service(list_widgets),
            )
            .await
        }};
    }

    /// A withdrawal journal (a "spent" journal) with category, budget and
    /// destination account.
    #[allow(clippy::too_many_arguments)]
    fn withdrawal_tx(
        id: &str,
        date: &str,
        amount: f64,
        source: &str,
        dest: &str,
        dest_name: Option<&str>,
        category: Option<&str>,
        budget: Option<&str>,
    ) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "withdrawal",
                    "amount": format!("{:.2}", amount),
                    "description": "budgeted spend",
                    "category_name": category,
                    "budget_name": budget,
                    "source_id": source,
                    "destination_id": dest,
                    "destination_name": dest_name,
                    "date": date,
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    /// A transfer journal (spent when the source is in the selection and
    /// the destination is not).
    #[allow(clippy::too_many_arguments)]
    fn transfer_tx(
        id: &str,
        date: &str,
        amount: f64,
        source: &str,
        dest: &str,
        dest_name: Option<&str>,
        category: Option<&str>,
        budget: Option<&str>,
    ) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "transfer",
                    "amount": format!("{:.2}", amount),
                    "description": "budgeted transfer",
                    "category_name": category,
                    "budget_name": budget,
                    "source_id": source,
                    "destination_id": dest,
                    "destination_name": dest_name,
                    "date": date,
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    /// A deposit journal (never "spent", must not appear in the chart).
    fn deposit_tx(id: &str, date: &str, amount: f64) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "deposit",
                    "amount": format!("{:.2}", amount),
                    "description": "salary",
                    "source_id": "revenue-1",
                    "destination_id": "asset-1",
                    "date": date,
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    fn tx_list(txs: Vec<serde_json::Value>) -> String {
        serde_json::to_string(&json!({ "data": txs })).unwrap()
    }

    async fn mock_tx(server: &mut mockito::Server, txs: Vec<serde_json::Value>) {
        server
            .mock("GET", "/v1/transactions")
            .match_query(mockito::Matcher::Regex(r".*".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(tx_list(txs))
            .create_async()
            .await;
    }

    /// The standard fixture: spend in the "Groceries" and "Dining Out"
    /// budgets across Jan/Feb 2026 (two categories, three destination
    /// accounts), one unbudgeted expense and one deposit.
    fn fixture_txs() -> Vec<serde_json::Value> {
        vec![
            withdrawal_tx(
                "t1",
                "2026-01-15T12:00:00+00:00",
                -50.0,
                "asset-1",
                "expense-1",
                Some("Safeway"),
                Some("Groceries:Supermarkets"),
                Some("Groceries"),
            ),
            withdrawal_tx(
                "t2",
                "2026-02-15T12:00:00+00:00",
                -30.0,
                "asset-1",
                "expense-2",
                Some("Trader Joe's"),
                Some("Groceries:Supermarkets"),
                Some("Groceries"),
            ),
            withdrawal_tx(
                "t3",
                "2026-01-20T12:00:00+00:00",
                -20.0,
                "asset-1",
                "expense-3",
                Some("O'Bar"),
                Some("Dining:Bars"),
                Some("Groceries"),
            ),
            withdrawal_tx(
                "t4",
                "2026-02-10T12:00:00+00:00",
                -40.0,
                "asset-1",
                "expense-4",
                Some("O'Charley's"),
                Some("Dining:Restaurants"),
                Some("Dining Out"),
            ),
            withdrawal_tx(
                "t5",
                "2026-02-11T12:00:00+00:00",
                -25.0,
                "asset-1",
                "expense-5",
                Some("Cashier"),
                None,
                None,
            ),
            deposit_tx("t6", "2026-02-01T12:00:00+00:00", 100.0),
        ]
    }

    /// GET /api/budgets/breakdown with the standard fixture, returning
    /// the parsed chart datasets.
    async fn get_breakdown(uri: &str) -> serde_json::Value {
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        client.clear_budget_breakdown_cache();
        mock_tx(&mut server, fixture_txs()).await;

        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        awt::read_body_json(resp).await
    }

    fn labels(chart: &serde_json::Value) -> Vec<&str> {
        chart
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["label"].as_str().unwrap())
            .collect()
    }

    #[actix_web::test]
    async fn breakdown_by_category_selected_budgets() {
        let _guard = TEST_LOCK.lock().unwrap();
        let chart = get_breakdown(
            "/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M\
             &budgets[]=Groceries",
        )
        .await;
        let datasets = chart.as_array().unwrap();
        // Only the Groceries budget's categories: Supermarkets (80) > Bars
        // (20). The "Dining Out" budget and the unbudgeted expense are
        // dropped; deposits never count. Sorted by total descending.
        assert_eq!(
            labels(&chart),
            vec!["Groceries:Supermarkets", "Dining:Bars"]
        );
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -50.0);
        assert_eq!(datasets[0]["entries"]["2026-02-28T00:00:00+00:00"], -30.0);
        assert_eq!(datasets[1]["entries"]["2026-01-31T00:00:00+00:00"], -20.0);
        assert!(datasets[1]["entries"]
            .get("2026-02-28T00:00:00+00:00")
            .is_none());
        assert_eq!(datasets[0]["currency_code"], "USD");
    }

    #[actix_web::test]
    async fn breakdown_by_destination() {
        let _guard = TEST_LOCK.lock().unwrap();
        let chart = get_breakdown(
            "/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M\
             &by=destination&budgets[]=Groceries",
        )
        .await;
        // One series per destination account of the Groceries budget's
        // spend: Safeway (50) > Trader Joe's (30) > O'Bar (20), sorted by
        // total desc.
        assert_eq!(labels(&chart), vec!["Safeway", "Trader Joe's", "O'Bar"]);
        let datasets = chart.as_array().unwrap();
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -50.0);
        assert!(datasets[0]["entries"]
            .get("2026-02-28T00:00:00+00:00")
            .is_none());
        assert_eq!(datasets[1]["entries"]["2026-02-28T00:00:00+00:00"], -30.0);
        assert_eq!(datasets[2]["entries"]["2026-01-31T00:00:00+00:00"], -20.0);
    }

    #[actix_web::test]
    async fn breakdown_by_destination_fallback_label() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);
        client.clear_budget_breakdown_cache();

        // A budgeted spend whose destination_name is missing
        let txs = vec![withdrawal_tx(
            "t1",
            "2026-01-15T12:00:00+00:00",
            -10.0,
            "asset-1",
            "expense-1",
            None,
            Some("Misc"),
            Some("Groceries"),
        )];
        mock_tx(&mut server, txs).await;

        let uri = "/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M\
             &by=destination&budgets[]=Groceries";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart = awt::read_body_json(resp).await;
        assert_eq!(labels(&chart), vec!["Unknown account"]);
    }

    #[actix_web::test]
    async fn breakdown_empty_budget_selection_is_all_budgeted() {
        let _guard = TEST_LOCK.lock().unwrap();
        let chart =
            get_breakdown("/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M").await;
        // All budgeted categories: Supermarkets (80) > Restaurants (40) >
        // Bars (20); the unbudgeted expense (25) is still dropped.
        assert_eq!(
            labels(&chart),
            vec![
                "Groceries:Supermarkets",
                "Dining:Restaurants",
                "Dining:Bars"
            ]
        );
    }

    #[actix_web::test]
    async fn breakdown_account_filtering() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);
        client.clear_budget_breakdown_cache();

        // One spend touching asset-1 (withdrawal) and one touching asset-9
        // (transfer), both charged to the same budget/category.
        let txs = vec![
            withdrawal_tx(
                "t1",
                "2026-01-15T12:00:00+00:00",
                -50.0,
                "asset-1",
                "expense-1",
                Some("Safeway"),
                Some("Groceries:Supermarkets"),
                Some("Groceries"),
            ),
            transfer_tx(
                "t2",
                "2026-01-16T12:00:00+00:00",
                -10.0,
                "asset-9",
                "expense-2",
                Some("Other Store"),
                Some("Groceries:Supermarkets"),
                Some("Groceries"),
            ),
        ];
        mock_tx(&mut server, txs).await;

        // With accounts[]=asset-1 only the first journal is visible:
        // 50 in Jan.
        let uri = "/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M\
             &budgets[]=Groceries&accounts[]=asset-1";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        assert_eq!(datasets.len(), 1);
        assert_eq!(datasets[0]["label"], "Groceries:Supermarkets");
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -50.0);

        // Without an account filter both count: 60 in Jan.
        client.clear_budget_breakdown_cache();
        let uri = "/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M\
             &budgets[]=Groceries";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -60.0);
    }

    #[actix_web::test]
    async fn breakdown_exclusions() {
        let _guard = TEST_LOCK.lock().unwrap();
        let chart = get_breakdown(
            "/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M\
             &budgets[]=Groceries&exclude_categories[]=Dining%3ABars",
        )
        .await;
        // The excluded category series disappears entirely.
        assert_eq!(labels(&chart), vec!["Groceries:Supermarkets"]);

        // Budget exclusion: both budgets selected, one excluded -> only
        // the other remains.
        let chart2 = get_breakdown(
            "/api/budgets/breakdown?start=2026-01-01&end=2026-02-28&period=1M\
             &budgets[]=Groceries&budgets[]=Dining%20Out\
             &exclude_budgets[]=Dining%20Out",
        )
        .await;
        assert_eq!(
            labels(&chart2),
            vec!["Groceries:Supermarkets", "Dining:Bars"]
        );
    }

    #[actix_web::test]
    async fn widget_budget_breakdown_by_round_trips_through_storage() {
        let _guard = TEST_LOCK.lock().unwrap();
        init_storage_once();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        let widget = json!({
            "id": "bd-widget-test-1",
            "name": "Groceries Breakdown",
            "accounts": [],
            "widget_type": "budget_breakdown",
            "budget_ids": ["1"],
            "budget_names": ["Groceries"],
            "budget_breakdown_by": "destination",
            "dashboard_ids": ["default"],
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "interval": "1M"
        });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&widget)
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 201);

        // Read back through the list endpoint
        let req = awt::TestRequest::get().uri("/api/widgets").to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let widgets: Vec<Widget> = awt::read_body_json(resp).await;
        let got = widgets
            .iter()
            .find(|w| w.id == "bd-widget-test-1")
            .expect("widget persisted");
        assert_eq!(got.widget_type.as_deref(), Some("budget_breakdown"));
        assert_eq!(got.budget_names, vec!["Groceries".to_string()]);
        assert_eq!(got.budget_breakdown_by, Some("destination".to_string()));

        // Update: switch to category mode and verify persistence
        let mut updated: Widget = got.clone();
        updated.budget_breakdown_by = Some("category".to_string());
        Storage::update_widget(&updated).unwrap();
        let all = Storage::get_all_widgets().unwrap();
        let got = all
            .iter()
            .find(|w| w.id == "bd-widget-test-1")
            .expect("widget persisted");
        assert_eq!(got.budget_breakdown_by, Some("category".to_string()));

        // Legacy widgets (created before the field existed) read back as
        // None and omit the field on serialization.
        let legacy = json!({
            "id": "bd-widget-test-legacy",
            "name": "Legacy",
            "accounts": [],
            "widget_type": "budget_breakdown",
            "budget_names": ["Groceries"],
            "dashboard_ids": ["default"]
        });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&legacy)
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 201);
        let all = Storage::get_all_widgets().unwrap();
        let got = all
            .iter()
            .find(|w| w.id == "bd-widget-test-legacy")
            .expect("legacy widget persisted");
        assert_eq!(got.budget_breakdown_by, None);

        // Cleanup
        let _ = Storage::delete_widget("bd-widget-test-1");
        let _ = Storage::delete_widget("bd-widget-test-legacy");
    }
}
