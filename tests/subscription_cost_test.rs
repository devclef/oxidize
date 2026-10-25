/// Tests for the Subscription Cost widget feature
/// (plans/subscription-cost-widget.md):
/// - /api/subscriptions list (mocked /v1/bills)
/// - /api/subscriptions/spend aggregation (mocked /v1/transactions):
///   per-subscription datasets, period buckets, selection filtering
///   (explicit ids, object-group expansion, empty = all), account filter,
///   category/budget exclusions, deposits never count
/// - widget model fields persisting through storage
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
    use oxidize::handlers::subscription::{
        get_subscription_groups, get_subscription_spend, get_subscriptions,
    };
    use oxidize::handlers::widget::{create_widget, list_widgets};
    use oxidize::models::{Subscription, SubscriptionGroup, Widget};
    use oxidize::storage::Storage;
    use serde_json::json;
    use std::sync::{Mutex, Once};

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn init_storage_once() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let dir = format!("/tmp/oxidize-subscriptions-test-{}", std::process::id());
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
                    .service(get_subscriptions)
                    .service(get_subscription_groups)
                    .service(get_subscription_spend)
                    .service(create_widget)
                    .service(list_widgets),
            )
            .await
        }};
    }

    /// A withdrawal journal linked to a subscription (a "spent" journal).
    #[allow(clippy::too_many_arguments)]
    fn withdrawal_tx(
        id: &str,
        date: &str,
        amount: f64,
        source: &str,
        category: Option<&str>,
        budget: Option<&str>,
        bill_id: Option<&str>,
        bill_name: Option<&str>,
    ) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "withdrawal",
                    "amount": format!("{:.2}", amount),
                    "description": "subscription payment",
                    "category_name": category,
                    "budget_name": budget,
                    "source_id": source,
                    "destination_id": "expense-1",
                    "bill_id": bill_id,
                    "bill_name": bill_name,
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

    fn bill(id: &str, name: &str) -> serde_json::Value {
        json!({
            "type": "bills",
            "id": id,
            "attributes": {
                "name": name,
                "currency_code": "USD",
                "currency_symbol": "$",
                "amount_min": "9.99",
                "amount_max": "12.99",
                "amount_avg": "11.00",
                "next_expected_match": "2026-11-01T00:00:00+00:00",
                "active": true
            }
        })
    }

    async fn mock_bills(server: &mut mockito::Server, bills: Vec<serde_json::Value>) {
        server
            .mock("GET", "/v1/bills")
            .match_query(mockito::Matcher::Regex(r".*".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::to_string(&json!({ "data": bills })).unwrap())
            .create_async()
            .await;
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

    /// The standard fixture: two subscriptions (Netflix, Spotify) with
    /// monthly payments in Jan-Mar 2026, one deposit, and one unlinked
    /// expense.
    fn fixture_txs() -> Vec<serde_json::Value> {
        vec![
            withdrawal_tx(
                "t1",
                "2026-01-15T12:00:00+00:00",
                -9.99,
                "asset-1",
                None,
                None,
                Some("7"),
                Some("Netflix"),
            ),
            withdrawal_tx(
                "t2",
                "2026-02-15T12:00:00+00:00",
                -9.99,
                "asset-1",
                None,
                None,
                Some("7"),
                Some("Netflix"),
            ),
            withdrawal_tx(
                "t3",
                "2026-03-15T12:00:00+00:00",
                -14.99,
                "asset-1",
                None,
                None,
                Some("8"),
                Some("Spotify"),
            ),
            withdrawal_tx(
                "t4",
                "2026-01-16T12:00:00+00:00",
                -14.99,
                "asset-1",
                None,
                None,
                Some("8"),
                Some("Spotify"),
            ),
            deposit_tx("t5", "2026-01-31T12:00:00+00:00", 3000.0),
            withdrawal_tx(
                "t6",
                "2026-02-20T12:00:00+00:00",
                -5.00,
                "asset-2",
                Some("Groceries"),
                Some("Food"),
                None,
                None,
            ),
        ]
    }

    #[actix_web::test]
    async fn subscription_list_shape() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        client.clear_subscription_cache();
        mock_bills(
            &mut server,
            vec![bill("8", "Spotify"), bill("7", "Netflix")],
        )
        .await;

        let req = awt::TestRequest::get()
            .uri("/api/subscriptions")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let subs: Vec<Subscription> = awt::read_body_json(resp).await;
        // Sorted by name
        assert_eq!(
            subs.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["Netflix", "Spotify"]
        );
        let netflix = &subs[0];
        assert_eq!(netflix.id, "7");
        assert_eq!(netflix.amount_avg, Some(11.0));
        assert!(netflix.active);
    }

    #[actix_web::test]
    async fn spend_chart_explicit_selection() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        client.clear_subscription_cache();
        mock_tx(&mut server, fixture_txs()).await;

        // Only Netflix (id 7), monthly buckets
        let uri =
            "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&subscriptions[]=7";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        assert_eq!(datasets.len(), 1, "only the selected subscription: {chart}");
        assert_eq!(datasets[0]["label"], "Netflix");
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -9.99);
        assert_eq!(datasets[0]["entries"]["2026-02-28T00:00:00+00:00"], -9.99);
        assert!(datasets[0]["entries"]
            .get("2026-03-31T00:00:00+00:00")
            .is_none());
        assert_eq!(datasets[0]["currency_code"], "USD");
    }

    #[actix_web::test]
    async fn spend_chart_empty_selection_is_all() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        client.clear_subscription_cache();
        mock_tx(&mut server, fixture_txs()).await;

        let uri = "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        // Netflix (2x -9.99) and Spotify (2x -14.99); the unlinked expense
        // and the deposit must not appear. Sorted by total descending.
        let labels: Vec<&str> = datasets
            .iter()
            .map(|d| d["label"].as_str().unwrap())
            .collect();
        assert_eq!(labels, vec!["Spotify", "Netflix"]);
        let spotify = &datasets[0];
        assert_eq!(spotify["entries"]["2026-01-31T00:00:00+00:00"], -14.99);
        assert_eq!(spotify["entries"]["2026-03-31T00:00:00+00:00"], -14.99);
    }

    #[actix_web::test]
    async fn spend_chart_group_expansion() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        client.clear_subscription_cache();
        mock_tx(&mut server, fixture_txs()).await;

        // One object group containing Spotify (bill 8)
        server
            .mock("GET", "/v1/object-groups")
            .match_query(mockito::Matcher::Regex(r".*".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::to_string(&json!({
                    "data": [{
                        "type": "object_groups",
                        "id": "og1",
                        "attributes": { "title": "Streaming" }
                    }]
                }))
                .unwrap(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/v1/object-groups/og1/bills")
            .match_query(mockito::Matcher::Regex(r".*".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::to_string(&json!({ "data": [bill("8", "Spotify")] })).unwrap())
            .create_async()
            .await;

        // Groups endpoint exposes the group
        let req = awt::TestRequest::get()
            .uri("/api/subscriptions/groups")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let groups: Vec<SubscriptionGroup> = awt::read_body_json(resp).await;
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].id, "og1");
        assert_eq!(groups[0].name, "Streaming");
        assert_eq!(groups[0].bill_count, 1);
        assert_eq!(groups[0].bill_ids, vec!["8".to_string()]);

        // The spend chart with groups[]=og1 includes only the group's
        // bills — and by default the group is charted as one total
        // labelled with the group name.
        let uri = "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&groups[]=og1";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        assert_eq!(
            datasets.len(),
            1,
            "group expansion includes only its bills: {chart}"
        );
        assert_eq!(datasets[0]["label"], "Streaming");
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -14.99);

        // With split_groups=1 the group expands to one dataset per bill.
        let uri =
            "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&groups[]=og1&split_groups=1";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        assert_eq!(datasets.len(), 1, "one bill in the group: {chart}");
        assert_eq!(datasets[0]["label"], "Spotify");
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -14.99);
    }

    #[actix_web::test]
    async fn spend_chart_group_split_toggle() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        client.clear_subscription_cache();
        mock_tx(&mut server, fixture_txs()).await;

        // One object group containing BOTH subscriptions (bills 7 + 8)
        server
            .mock("GET", "/v1/object-groups")
            .match_query(mockito::Matcher::Regex(r".*".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::to_string(&json!({
                    "data": [{
                        "type": "object-groups",
                        "id": "og1",
                        "attributes": { "title": "Streaming" }
                    }]
                }))
                .unwrap(),
            )
            .create_async()
            .await;
        server
            .mock("GET", "/v1/object-groups/og1/bills")
            .match_query(mockito::Matcher::Regex(r".*".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::to_string(&json!({
                    "data": [bill("8", "Spotify"), bill("7", "Netflix")]
                }))
                .unwrap(),
            )
            .create_async()
            .await;

        // Default (no split_groups): one dataset per selected group,
        // labelled with the group name, holding the group's total cost.
        let uri = "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&groups[]=og1";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        assert_eq!(datasets.len(), 1, "unsplit group is one total: {chart}");
        assert_eq!(datasets[0]["label"], "Streaming");
        // Jan: Netflix -9.99 + Spotify -14.99; Feb: Netflix only; Mar:
        // Spotify only.
        assert_eq!(datasets[0]["entries"]["2026-01-31T00:00:00+00:00"], -24.98);
        assert_eq!(datasets[0]["entries"]["2026-02-28T00:00:00+00:00"], -9.99);
        assert_eq!(datasets[0]["entries"]["2026-03-31T00:00:00+00:00"], -14.99);

        // split_groups=1: one dataset per bill (previous behavior), sorted
        // by total desc.
        let uri =
            "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&groups[]=og1&split_groups=1";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let labels: Vec<&str> = chart
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["label"].as_str().unwrap())
            .collect();
        assert_eq!(labels, vec!["Spotify", "Netflix"]);

        // A subscription that is both individually selected AND a member
        // of a selected group merges into the group total when not split.
        let uri =
            "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&groups[]=og1&subscriptions[]=7";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let datasets = chart.as_array().unwrap();
        assert_eq!(
            datasets.len(),
            1,
            "member of a selected group merges into the group total: {chart}"
        );
        assert_eq!(datasets[0]["label"], "Streaming");
        assert_eq!(datasets[0]["entries"]["2026-02-28T00:00:00+00:00"], -9.99);
    }

    #[actix_web::test]
    async fn spend_chart_exclusions_and_accounts() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        client.clear_subscription_cache();
        mock_tx(&mut server, fixture_txs()).await;

        // Excluding the "Groceries" category drops the unlinked expense
        // (which isn't a subscription anyway) - and with accounts[]=asset-1
        // only journals touching asset-1 survive.
        let uri = "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&accounts[]=asset-1&exclude_categories[]=Groceries";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        let labels: Vec<&str> = chart
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["label"].as_str().unwrap())
            .collect();
        assert_eq!(labels, vec!["Spotify", "Netflix"]);

        // Excluding a budget: Netflix payments had no budget, so excluding
        // "Food" leaves both subscriptions intact (the t6 expense is not a
        // subscription), while excluding the subscription's own category
        // would drop it - sanity-check with a category on the subscription.
        let uri = "/api/subscriptions/spend?start=2026-01-01&end=2026-03-31&period=1M&exclude_budgets[]=Food";
        let req = awt::TestRequest::get().uri(uri).to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let chart: serde_json::Value = awt::read_body_json(resp).await;
        assert_eq!(chart.as_array().unwrap().len(), 2);
    }

    #[actix_web::test]
    async fn widget_subscription_fields_round_trip_through_storage() {
        let _guard = TEST_LOCK.lock().unwrap();
        init_storage_once();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        let widget = json!({
            "id": "sub-widget-test-1",
            "name": "My Subs",
            "accounts": [],
            "widget_type": "subscription_cost",
            "subscription_ids": ["7", "8"],
            "subscription_group_ids": ["og1"],
            "subscription_split_groups": true,
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
            .find(|w| w.id == "sub-widget-test-1")
            .expect("widget persisted");
        assert_eq!(got.subscription_ids, vec!["7".to_string(), "8".to_string()]);
        assert_eq!(got.subscription_group_ids, vec!["og1".to_string()]);
        assert_eq!(got.subscription_split_groups, Some(true));
        assert_eq!(got.widget_type.as_deref(), Some("subscription_cost"));

        // Update: change the selections and verify persistence
        let mut updated: Widget = got.clone();
        updated.subscription_ids = vec!["7".to_string()];
        updated.subscription_group_ids = vec![];
        updated.subscription_split_groups = Some(false);
        Storage::update_widget(&updated).unwrap();
        let all = Storage::get_all_widgets().unwrap();
        let got = all
            .iter()
            .find(|w| w.id == "sub-widget-test-1")
            .expect("widget persisted");
        assert_eq!(got.subscription_ids, vec!["7".to_string()]);
        assert!(got.subscription_group_ids.is_empty());
        assert_eq!(got.subscription_split_groups, Some(false));

        // Cleanup
        let _ = Storage::delete_widget("sub-widget-test-1");
    }
}
