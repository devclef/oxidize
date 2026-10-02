/// Tests for the Spending Labels feature (plans/spending-labels.md):
/// - label CRUD API (validation + persistence)
/// - budget-composition report (aggregation against mocked transactions,
///   subcategory matching, overlap, unlabeled remainder, budget filter)
/// - spend trend report (ChartLine shape, period buckets, budget filter)
/// - settings toggle: disabled => 404 everywhere + nav link stripped
///
/// The storage layer (and the shared settings row) is process-wide, so the
/// stateful tests serialize on TEST_LOCK and use unique label ids.
#[cfg(test)]
mod tests {
    #![allow(clippy::await_holding_lock)] // TEST_LOCK serializes the whole test, by design

    use actix_web::test as awt;
    use actix_web::{web, App};
    use std::sync::Mutex;

    use oxidize::client::FireflyClient;
    use oxidize::config::{Config, FireflyUrl};
    use oxidize::handlers::index::index;
    use oxidize::handlers::label::{
        create_label, delete_label, get_label_budget_composition_api, get_label_spend_api,
        labels_page, list_labels, update_label,
    };
    use oxidize::handlers::settings::{get_settings_api, update_settings_api};
    use oxidize::models::Label;
    use oxidize::storage::Storage;
    use serde_json::json;
    use std::sync::Once;

    /// All stateful tests share one temp database and the settings row,
    /// so they must not run concurrently.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Initialize the storage layer once per test binary (DATA_DIR is a
    /// process-wide OnceLock, so all tests here share one temp database).
    fn init_storage_once() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let dir = format!("/tmp/oxidize-labels-test-{}", std::process::id());
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
                    .service(labels_page)
                    .service(list_labels)
                    .service(create_label)
                    .service(update_label)
                    .service(delete_label)
                    .service(get_label_budget_composition_api)
                    .service(get_label_spend_api)
                    .service(get_settings_api)
                    .service(update_settings_api)
                    .route("/", web::get().to(index)),
            )
            .await
        }};
    }

    /// A withdrawal journal (a "spent" journal).
    #[allow(clippy::too_many_arguments)]
    fn withdrawal_tx(
        id: &str,
        date: &str,
        amount: f64,
        category: Option<&str>,
        budget: Option<&str>,
        source: &str,
    ) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "withdrawal",
                    "amount": format!("{:.2}", amount),
                    "description": "test",
                    "category_name": category,
                    "budget_name": budget,
                    "source_id": source,
                    "destination_id": "expense-1",
                    "date": date,
                    "currency_code": "USD",
                    "currency_symbol": "$"
                }]
            }
        })
    }

    /// A deposit journal (earned; must never count as spend).
    fn deposit_tx(id: &str, date: &str, amount: f64) -> serde_json::Value {
        json!({
            "type": "transactions",
            "id": id,
            "attributes": {
                "transactions": [{
                    "type": "deposit",
                    "amount": format!("{:.2}", amount),
                    "description": "salary",
                    "category_name": null,
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

    /// Mock every /v1/transactions request (any query string: the client
    /// chunks the date range into monthly requests with start/end params).
    /// Duplicate ids across chunks are deduplicated by the client.
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

    fn make_label(id: &str, name: &str, entries: &[&str]) -> Label {
        Label {
            id: id.to_string(),
            name: name.to_string(),
            description: String::new(),
            color: Some("#3b82f6".to_string()),
            entries: entries.iter().map(|s| s.to_string()).collect(),
            created_at: None,
            updated_at: None,
        }
    }

    /// Remove every label so tests start from a clean slate (via the
    /// storage layer directly; callers hold TEST_LOCK).
    fn clear_labels() {
        if let Ok(list) = Storage::get_all_labels() {
            for l in list {
                let _ = Storage::delete_label(&l.id);
            }
        }
    }

    /// Read a response body as an HTML string.
    async fn html_of<B>(resp: actix_web::dev::ServiceResponse<B>) -> String
    where
        B: actix_web::body::MessageBody,
    {
        let body = awt::read_body(resp).await;
        String::from_utf8(body.to_vec()).unwrap_or_default()
    }

    #[actix_web::test]
    async fn crud_create_list_update_delete() {
        let _guard = TEST_LOCK.lock().unwrap();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();

        // Create
        let body = json!({
            "id": "lbl-crud-1",
            "name": "wants",
            "description": "discretionary",
            "color": "#f59e0b",
            "entries": ["Dining", "Entertainment"]
        });
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(&body)
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 201);
        let created: Label = awt::read_body_json(resp).await;
        assert_eq!(created.name, "wants");
        assert_eq!(created.entries.len(), 2);

        // List
        let req = awt::TestRequest::get().uri("/api/labels").to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let list: Vec<Label> = awt::read_body_json(resp).await;
        assert!(list.iter().any(|l| l.id == "lbl-crud-1"));

        // Update (rename + change entries)
        let mut updated = created.clone();
        updated.name = "wants-renamed".to_string();
        updated.entries = vec!["Dining:Bars".to_string()];
        let req = awt::TestRequest::put()
            .uri("/api/labels/lbl-crud-1")
            .set_json(&updated)
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let got: Label = awt::read_body_json(resp).await;
        assert_eq!(got.name, "wants-renamed");
        assert_eq!(got.entries, vec!["Dining:Bars".to_string()]);

        // Delete
        let req = awt::TestRequest::delete().uri("/api/labels/lbl-crud-1").to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);

        // Delete again -> 404
        let req = awt::TestRequest::delete().uri("/api/labels/lbl-crud-1").to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);
    }

    #[actix_web::test]
    async fn crud_validation() {
        let _guard = TEST_LOCK.lock().unwrap();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();

        // Missing id -> 400
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(json!({ "id": "", "name": "x", "entries": ["A"] }))
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 400);

        // Empty name -> 400
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(json!({ "id": "lbl-v-a", "name": "  ", "entries": ["A"] }))
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 400);

        // No entries -> 400
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(json!({ "id": "lbl-v-b", "name": "no-entries", "entries": [] }))
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 400);

        // Create "dup", then a second label with the same name -> 400
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(json!({ "id": "lbl-v-c", "name": "dup", "entries": ["A"] }))
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 201);
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(json!({ "id": "lbl-v-d", "name": "dup", "entries": ["B"] }))
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        // Update with id mismatch -> 400
        let existing: Label = {
            let req = awt::TestRequest::get().uri("/api/labels").to_request();
            let resp = awt::call_service(&app, req).await;
            let list: Vec<Label> = awt::read_body_json(resp).await;
            list.into_iter().find(|l| l.id == "lbl-v-c").unwrap()
        };
        let mut mismatched = existing.clone();
        mismatched.id = "other-id".to_string();
        let req = awt::TestRequest::put()
            .uri("/api/labels/lbl-v-c")
            .set_json(&mismatched)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 400);

        // Renaming onto another label's name -> 400
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(json!({ "id": "lbl-v-e", "name": "taken", "entries": ["B"] }))
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 201);
        let mut renamed = existing.clone();
        renamed.name = "taken".to_string();
        let req = awt::TestRequest::put()
            .uri("/api/labels/lbl-v-c")
            .set_json(&renamed)
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        clear_labels();
    }

    #[actix_web::test]
    async fn budget_composition_aggregation() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        for l in [
            make_label("lbl-comp-wants", "wants", &["Dining", "Toys"]),
            make_label("lbl-comp-needs", "needs", &["Groceries"]),
        ] {
            let req = awt::TestRequest::post()
                .uri("/api/labels")
                .set_json(&l)
                .to_request();
            assert_eq!(awt::call_service(&app, req).await.status(), 201);
        }

        // January 2026 fixture.
        mock_tx(
            &mut server,
            vec![
                withdrawal_tx("t1", "2026-01-05", 100.0, Some("Dining:Bars"), Some("Food"), "a1"),
                withdrawal_tx("t2", "2026-01-06", 200.0, Some("Groceries"), Some("Food"), "a1"),
                withdrawal_tx("t3", "2026-01-07", 50.0, Some("Health"), Some("Food"), "a1"),
                // Different budget: must be excluded from Food's composition.
                withdrawal_tx("t4", "2026-01-08", 30.0, Some("Dining"), Some("Travel"), "a1"),
                // No budget: must be excluded.
                withdrawal_tx("t5", "2026-01-09", 40.0, Some("Groceries"), None, "a1"),
                // Income: never counts as spend.
                deposit_tx("t6", "2026-01-10", 5000.0),
            ],
        )
        .await;

        let req = awt::TestRequest::get()
            .uri("/api/labels/budget-composition?budget=Food&start=2026-01-01&end=2026-01-31")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        let status = resp.status();
        let body_bytes = awt::read_body(resp).await;
        assert_eq!(status, 200);
        let data: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();

        assert_eq!(data["budget"], "Food");
        assert!((data["total"].as_f64().unwrap() - 350.0).abs() < 1e-9);
        // wants: 100 (Dining:Bars matches "Dining"); needs: 200;
        // Health (50) is unlabeled.
        assert!((data["labeled"].as_f64().unwrap() - 300.0).abs() < 1e-9);

        let parts = data["parts"].as_array().unwrap();
        let by_name: std::collections::HashMap<String, f64> = parts
            .iter()
            .map(|p| (p["label"].as_str().unwrap().to_string(), p["amount"].as_f64().unwrap()))
            .collect();
        assert!((by_name["wants"] - 100.0).abs() < 1e-9);
        assert!((by_name["needs"] - 200.0).abs() < 1e-9);
        assert!((by_name["Unlabeled"] - 50.0).abs() < 1e-9);
        // Sorted descending: needs first.
        assert_eq!(parts[0]["label"], "needs");
        // Percentages of the total.
        let needs_pct = parts
            .iter()
            .find(|p| p["label"] == "needs")
            .unwrap()["pct"]
            .as_f64()
            .unwrap();
        assert!((needs_pct - 200.0 / 350.0 * 100.0).abs() < 1e-9);
        assert_eq!(data["currency_symbol"], "$");

        let cats = data["by_category"].as_array().unwrap();
        assert_eq!(cats.len(), 3);
        assert_eq!(cats[0]["category"], "Groceries");
        assert_eq!(cats[0]["labels"], json!(["needs"]));
        let dining = cats.iter().find(|c| c["category"] == "Dining:Bars").unwrap();
        assert_eq!(dining["labels"], json!(["wants"]));
        let health = cats.iter().find(|c| c["category"] == "Health").unwrap();
        assert_eq!(health["labels"], json!([]));

        clear_labels();
    }

    #[actix_web::test]
    async fn budget_composition_requires_budget_param() {
        let _guard = TEST_LOCK.lock().unwrap();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        let req = awt::TestRequest::get()
            .uri("/api/labels/budget-composition?start=2026-01-01&end=2026-01-31")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);
    }

    #[actix_web::test]
    async fn spend_trend_chart_shape() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        for l in [
            make_label("lbl-trend-wants", "wants", &["Dining"]),
            make_label("lbl-trend-needs", "needs", &["Groceries"]),
        ] {
            let req = awt::TestRequest::post()
                .uri("/api/labels")
                .set_json(&l)
                .to_request();
            assert_eq!(awt::call_service(&app, req).await.status(), 201);
        }

        mock_tx(
            &mut server,
            vec![
                withdrawal_tx("t1", "2026-01-05", 100.0, Some("Dining:Bars"), None, "a1"),
                withdrawal_tx("t2", "2026-01-06", 200.0, Some("Groceries"), None, "a1"),
                withdrawal_tx("t3", "2026-02-03", 300.0, Some("Dining"), None, "a1"),
                withdrawal_tx("t4", "2026-02-04", 10.0, Some("Toys"), None, "a1"),
            ],
        )
        .await;

        let req = awt::TestRequest::get()
            .uri("/api/labels/spend?start=2026-01-01&end=2026-02-28&period=1M")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        let status = resp.status();
        let body_bytes = awt::read_body(resp).await;
        assert_eq!(status, 200);
        let chart: Vec<serde_json::Value> = serde_json::from_slice(&body_bytes).unwrap();

        assert_eq!(chart.len(), 3); // wants, needs, Unlabeled
        let by_label: std::collections::HashMap<String, serde_json::Value> = chart
            .iter()
            .map(|ds| (ds["label"].as_str().unwrap().to_string(), ds.clone()))
            .collect();

        // Period keys are month-end timestamps (see get_period_key).
        let jan = "2026-01-31T00:00:00+00:00";
        let feb = "2026-02-28T00:00:00+00:00";
        let wants = &by_label["wants"]["entries"];
        assert!((wants[jan].as_f64().unwrap() - 100.0).abs() < 1e-9);
        assert!((wants[feb].as_f64().unwrap() - 300.0).abs() < 1e-9);
        let needs = &by_label["needs"]["entries"];
        assert!((needs[jan].as_f64().unwrap() - 200.0).abs() < 1e-9);
        assert!(needs.get(feb).is_none());
        let unlabeled = &by_label["Unlabeled"]["entries"];
        assert!((unlabeled[feb].as_f64().unwrap() - 10.0).abs() < 1e-9);
        assert!(unlabeled.get(jan).is_none());
        // Sorted by total descending: wants (400) first.
        assert_eq!(chart[0]["label"], "wants");
        assert_eq!(chart[0]["currency_symbol"], "$");

        clear_labels();
    }

    #[actix_web::test]
    async fn spend_trend_budget_filter_and_unlabeled_toggle() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        let l = make_label("lbl-filter-wants", "wants", &["Dining"]);
        let req = awt::TestRequest::post()
            .uri("/api/labels")
            .set_json(&l)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 201);

        mock_tx(
            &mut server,
            vec![
                withdrawal_tx("t1", "2026-01-05", 100.0, Some("Dining"), Some("Food"), "a1"),
                withdrawal_tx("t2", "2026-01-06", 90.0, Some("Dining"), Some("Travel"), "a1"),
                withdrawal_tx("t3", "2026-01-07", 50.0, Some("Health"), Some("Food"), "a1"),
            ],
        )
        .await;

        // With budget filter: only Food's spend (100 wants + 50 unlabeled).
        let req = awt::TestRequest::get()
            .uri("/api/labels/spend?start=2026-01-01&end=2026-01-31&period=1M&budgets[]=Food")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        let chart: Vec<serde_json::Value> = awt::read_body_json(resp).await;
        let by_label: std::collections::HashMap<String, f64> = chart
            .iter()
            .map(|ds| {
                (
                    ds["label"].as_str().unwrap().to_string(),
                    ds["entries"]["2026-01-31T00:00:00+00:00"].as_f64().unwrap(),
                )
            })
            .collect();
        assert!((by_label["wants"] - 100.0).abs() < 1e-9);
        assert!((by_label["Unlabeled"] - 50.0).abs() < 1e-9);

        // Without the Unlabeled series it must be absent.
        let req = awt::TestRequest::get()
            .uri("/api/labels/spend?start=2026-01-01&end=2026-01-31&period=1M&budgets[]=Food&include_unlabeled=0")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        let chart: Vec<serde_json::Value> = awt::read_body_json(resp).await;
        assert_eq!(chart.len(), 1);
        assert_eq!(chart[0]["label"], "wants");

        clear_labels();
    }

    #[actix_web::test]
    async fn disabled_feature_returns_404_and_strips_nav() {
        let _guard = TEST_LOCK.lock().unwrap();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        // Disable via the settings API (PATCH /api/settings).
        let req = awt::TestRequest::patch()
            .uri("/api/settings")
            .set_json(json!({ "labels_enabled": false }))
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);

        for uri in [
            "/labels",
            "/api/labels",
            "/api/labels/budget-composition?budget=Food",
            "/api/labels/spend",
        ] {
            let req = awt::TestRequest::get().uri(uri).to_request();
            let resp = awt::call_service(&app, req).await;
            assert_eq!(resp.status(), 404, "expected 404 for {uri} when disabled");
        }

        // Nav link stripped on the index page.
        let req = awt::TestRequest::get().uri("/").to_request();
        let resp = awt::call_service(&app, req).await;
        let html = html_of(resp).await;
        assert!(!html.contains("href=\"/labels\""), "nav link should be stripped");

        // Re-enable: page served again with the nav link present.
        let req = awt::TestRequest::patch()
            .uri("/api/settings")
            .set_json(json!({ "labels_enabled": true }))
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);

        let req = awt::TestRequest::get().uri("/labels").to_request();
        let resp = awt::call_service(&app, req).await;
        let status = resp.status();
        let html = html_of(resp).await;
        assert_eq!(status, 200);
        assert!(html.contains("href=\"/labels\" class=\"active\""));
        assert!(html.contains("Spending Labels"));

        let req = awt::TestRequest::get().uri("/").to_request();
        let resp = awt::call_service(&app, req).await;
        let html = html_of(resp).await;
        assert!(html.contains("href=\"/labels\""));
    }

    #[test]
    fn settings_default_labels_enabled_is_true() {
        let _guard = TEST_LOCK.lock().unwrap();
        init_storage_once();
        // A fresh settings store (no saved row for this key) must default
        // the feature on.
        let s = oxidize::models::Settings::default();
        assert!(s.labels_enabled);
        let rows = Storage::get_setting("labels_enabled");
        match rows {
            Ok(None) => {}
            Ok(Some(v)) => assert_eq!(v, "true"),
            Err(e) => panic!("settings store unavailable: {e}"),
        }
    }
}
