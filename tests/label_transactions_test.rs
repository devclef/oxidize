/// OXI-48: Spending Labels — list all transactions of a label for a period.
///
/// - /api/labels/transactions returns every spend journal whose category
///   matches the label's entries (whole-category and Parent:Sub semantics)
/// - deposits and excluded journals never appear
/// - unbudgeted spend is excluded by default, included on request
/// - budgets[] / accounts[] filters, exclusions, date-descending sort
/// - 400 missing label param, 404 unknown label, 404 when feature disabled
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
    use oxidize::handlers::label::{
        create_label, delete_label, get_label_transactions_api, labels_page, list_labels,
        update_label,
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
            let dir = format!("/tmp/oxidize-labels-tx-test-{}", std::process::id());
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
                    .service(get_label_transactions_api)
                    .service(get_settings_api)
                    .service(update_settings_api),
            )
            .await
        }};
    }

    /// A withdrawal journal (a "spent" journal) with the extra fields the
    /// transaction list needs. Mirrors the real Firefly III v6 list
    /// response: the wrapper's "attributes" block holds group metadata
    /// ("group_title") plus the journal array; the transaction description
    /// is repeated on every journal (the wrapper has no description of
    /// its own), and the list response carries no payee object — the
    /// journal's payee_name is the only payee data available.
    #[allow(clippy::too_many_arguments)]
    fn withdrawal_tx(
        id: &str,
        date: &str,
        amount: f64,
        category: Option<&str>,
        budget: Option<&str>,
        source_id: &str,
        source_name: &str,
        payee: Option<&str>,
        description: &str,
    ) -> serde_json::Value {
        json!({
            "id": id,
            "attributes": {
                "group_title": null,
                "transactions": [{
                    "type": "withdrawal",
                    "id": format!("j-{id}"),
                    "amount": format!("{:.2}", amount),
                    "description": description,
                    "payee_name": payee,
                    "category_name": category,
                    "budget_name": budget,
                    "source_id": source_id,
                    "source_name": source_name,
                    "destination_id": "expense-1",
                    "destination_name": "Expense",
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
            "id": id,
            "attributes": {
                "group_title": null,
                "transactions": [{
                    "type": "deposit",
                    "id": format!("j-{id}"),
                    "amount": format!("{:.2}", amount),
                    "description": "salary",
                    "payee_name": null,
                    "category_name": null,
                    "budget_name": null,
                    "source_id": "revenue-1",
                    "source_name": "Salary",
                    "destination_id": "asset-1",
                    "destination_name": "Main",
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

    /// Create a label through the API (asserts 201).
    macro_rules! create_api_label {
        ($app:expr, $id:expr, $name:expr, $entries:expr) => {{
            let req = awt::TestRequest::post()
                .uri("/api/labels")
                .set_json(make_label($id, $name, $entries))
                .to_request();
            let resp = awt::call_service($app, req).await;
            assert_eq!(resp.status(), 201, "label {} should be created", $id);
        }};
    }

    /// GET and parse the JSON body.
    macro_rules! get_json {
        ($app:expr, $uri:expr $(,)?) => {{
            let req = awt::TestRequest::get().uri($uri).to_request();
            let resp = awt::call_service($app, req).await;
            let data: serde_json::Value = awt::read_body_json(resp).await;
            data
        }};
    }

    /// The two Dining journals shared by several tests: one subcategory
    /// match and one whole-category match.
    fn dining_txs() -> Vec<serde_json::Value> {
        vec![
            withdrawal_tx(
                "w1",
                "2026-10-01",
                -10.0,
                Some("Dining:Bars"),
                Some("Food"),
                "asset-1",
                "Main",
                Some("Bar X"),
                "drinks",
            ),
            withdrawal_tx(
                "w2",
                "2026-10-02",
                -5.5,
                Some("Dining"),
                Some("Food"),
                "asset-1",
                "Main",
                Some("Cafe Y"),
                "lunch",
            ),
        ]
    }

    #[actix_web::test]
    async fn tx_list_matches_label_entries() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-1", "wants", &["Dining"]);

        let mut d = dining_txs();
        mock_tx(
            &mut server,
            vec![
                d.remove(0),
                d.remove(0),
                withdrawal_tx(
                    "w3",
                    "2026-10-03",
                    -20.0,
                    Some("Groceries"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("Supermarket"),
                    "groceries",
                ),
                withdrawal_tx(
                    "w4",
                    "2026-10-04",
                    -7.0,
                    None,
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("Unknown"),
                    "uncategorized spend",
                ),
            ],
        )
        .await;

        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-1&start=2026-09-01&end=2026-10-31",
        );

        assert_eq!(data["label"], "wants");
        assert_eq!(data["start"], "2026-09-01");
        assert_eq!(data["end"], "2026-10-31");
        assert_eq!(data["count"], 2);
        assert!((data["total"].as_f64().unwrap() - 15.5).abs() < 1e-9);
        assert_eq!(data["currency_symbol"], "$");
        assert_eq!(data["currency_code"], "USD");

        let txs = data["transactions"].as_array().unwrap();
        assert_eq!(txs.len(), 2);
        // Newest first.
        assert_eq!(txs[0]["date"], "2026-10-02");
        assert_eq!(txs[1]["date"], "2026-10-01");
        // Subcategory "Dining:Bars" matched by the whole-category entry.
        assert_eq!(txs[1]["category"], "Dining:Bars");
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_subcategory_entry_is_exact() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-2", "bars", &["Dining:Bars"]);

        mock_tx(
            &mut server,
            vec![
                withdrawal_tx(
                    "b1",
                    "2026-10-01",
                    -10.0,
                    Some("Dining:Bars"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("Bar X"),
                    "drinks",
                ),
                withdrawal_tx(
                    "b2",
                    "2026-10-02",
                    -4.0,
                    Some("Dining:Restaurants"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("Restaurant Z"),
                    "dinner",
                ),
                withdrawal_tx(
                    "b3",
                    "2026-10-03",
                    -2.0,
                    Some("Dining"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("Cafe Y"),
                    "coffee",
                ),
            ],
        )
        .await;

        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-2&start=2026-09-01&end=2026-10-31",
        );

        assert_eq!(data["count"], 1);
        let txs = data["transactions"].as_array().unwrap();
        assert_eq!(txs[0]["category"], "Dining:Bars");
        assert!((data["total"].as_f64().unwrap() - 10.0).abs() < 1e-9);
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_overlap_counts_in_each_label() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-w", "wants", &["Dining"]);
        create_api_label!(&app, "lbl-tx-f", "fun", &["Dining:Bars"]);

        mock_tx(
            &mut server,
            vec![dining_txs().remove(0)], // "Dining:Bars", -10.00
        )
        .await;

        let wants = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-w&start=2026-09-01&end=2026-10-31",
        );
        assert_eq!(wants["count"], 1);

        let fun = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-f&start=2026-09-01&end=2026-10-31",
        );
        assert_eq!(fun["count"], 1);
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_deposits_never_listed() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-3", "wants", &["Dining"]);

        mock_tx(
            &mut server,
            vec![
                dining_txs().remove(0),
                deposit_tx("d1", "2026-10-05", 2000.0),
            ],
        )
        .await;

        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-3&start=2026-09-01&end=2026-10-31",
        );
        assert_eq!(data["count"], 1);
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_unbudgeted_excluded_by_default_and_budget_filter() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-4", "all-dining", &["Dining"]);

        mock_tx(
            &mut server,
            vec![
                dining_txs().remove(0), // "Dining:Bars", budget Food, -10.00
                withdrawal_tx(
                    "f1",
                    "2026-10-06",
                    -4.0,
                    Some("Dining"),
                    Some("Fun"),
                    "asset-1",
                    "Main",
                    Some("Cafe Y"),
                    "snack",
                ),
                withdrawal_tx(
                    "n1",
                    "2026-10-07",
                    -6.0,
                    Some("Dining"),
                    None,
                    "asset-1",
                    "Main",
                    Some("Street food"),
                    "no budget",
                ),
            ],
        )
        .await;

        // Default: unbudgeted spend excluded.
        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-4&start=2026-09-01&end=2026-10-31",
        );
        assert_eq!(data["count"], 2);
        assert!((data["total"].as_f64().unwrap() - 14.0).abs() < 1e-9);

        // include_unbudgeted=1: the budgetless one shows up too.
        let data = get_json!(&app,
            "/api/labels/transactions?label=lbl-tx-4&start=2026-09-01&end=2026-10-31&include_unbudgeted=1",
);
        assert_eq!(data["count"], 3);
        assert!((data["total"].as_f64().unwrap() - 20.0).abs() < 1e-9);

        // budgets[]=Fun: only the Fun-budgeted one.
        let data =
            get_json!(&app,
            "/api/labels/transactions?label=lbl-tx-4&start=2026-09-01&end=2026-10-31&budgets[]=Fun",
);
        assert_eq!(data["count"], 1);
        let txs = data["transactions"].as_array().unwrap();
        assert_eq!(txs[0]["budget"], "Fun");
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_sorted_date_descending() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-5", "wants", &["Dining"]);

        mock_tx(
            &mut server,
            vec![
                withdrawal_tx(
                    "s1",
                    "2026-10-01",
                    -1.0,
                    Some("Dining"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("A"),
                    "a",
                ),
                withdrawal_tx(
                    "s3",
                    "2026-10-15",
                    -3.0,
                    Some("Dining"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("C"),
                    "c",
                ),
                withdrawal_tx(
                    "s2",
                    "2026-10-05",
                    -2.0,
                    Some("Dining"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("B"),
                    "b",
                ),
            ],
        )
        .await;

        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-5&start=2026-09-01&end=2026-10-31",
        );
        let txs = data["transactions"].as_array().unwrap();
        assert_eq!(txs[0]["date"], "2026-10-15");
        assert_eq!(txs[1]["date"], "2026-10-05");
        assert_eq!(txs[2]["date"], "2026-10-01");
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_respects_exclusions() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-6", "mixed", &["Dining", "Groceries"]);

        mock_tx(
            &mut server,
            vec![
                dining_txs().remove(0), // "Dining:Bars" -10.00
                withdrawal_tx(
                    "g1",
                    "2026-10-08",
                    -12.0,
                    Some("Groceries:DiscountStore"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("Supermarket"),
                    "groceries",
                ),
            ],
        )
        .await;

        // Without exclusions: both.
        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-6&start=2026-09-01&end=2026-10-31",
        );
        assert_eq!(data["count"], 2);

        // exclude_categories[]="Dining" drops every Dining journal (whole
        // category or subcategory).
        let data = get_json!(&app,
            "/api/labels/transactions?label=lbl-tx-6&start=2026-09-01&end=2026-10-31&exclude_categories[]=Dining",
);
        assert_eq!(data["count"], 1);
        let txs = data["transactions"].as_array().unwrap();
        assert_eq!(txs[0]["category"], "Groceries:DiscountStore");
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_account_filter() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-7", "wants", &["Dining"]);

        mock_tx(
            &mut server,
            vec![
                withdrawal_tx(
                    "a1",
                    "2026-10-01",
                    -10.0,
                    Some("Dining"),
                    Some("Food"),
                    "asset-1",
                    "Main",
                    Some("Bar X"),
                    "drinks",
                ),
                withdrawal_tx(
                    "a2",
                    "2026-10-02",
                    -5.0,
                    Some("Dining"),
                    Some("Food"),
                    "asset-2",
                    "Savings",
                    Some("Cafe Y"),
                    "lunch",
                ),
            ],
        )
        .await;

        let data = get_json!(&app,
            "/api/labels/transactions?label=lbl-tx-7&start=2026-09-01&end=2026-10-31&accounts[]=asset-1",
);
        assert_eq!(data["count"], 1);
        let txs = data["transactions"].as_array().unwrap();
        assert_eq!(txs[0]["account"], "Main");
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_fields_populated() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-8", "wants", &["Dining"]);

        mock_tx(&mut server, vec![dining_txs().remove(0)]).await;

        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-8&start=2026-09-01&end=2026-10-31",
        );
        let tx = &data["transactions"].as_array().unwrap()[0];
        assert_eq!(tx["id"], "j-w1");
        assert_eq!(tx["date"], "2026-10-01");
        assert!((tx["amount"].as_f64().unwrap() - (-10.0)).abs() < 1e-9);
        assert_eq!(tx["category"], "Dining:Bars");
        assert_eq!(tx["budget"], "Food");
        assert_eq!(tx["payee"], "Bar X");
        assert_eq!(tx["description"], "drinks");
        assert_eq!(tx["account"], "Main");
        assert_eq!(tx["destination"], "Expense");
        clear_labels();
    }

    /// The description comes from the journal (where the v6 list API
    /// keeps it), the payee from the journal's payee_name, and the
    /// destination account is reported alongside the source account.
    /// When a journal has no description of its own, the group wrapper's
    /// "attributes" block is used as a fallback.
    #[actix_web::test]
    async fn tx_fields_come_from_journal() {
        let _guard = TEST_LOCK.lock().unwrap();
        let mut server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        create_api_label!(&app, "lbl-tx-9", "wants", &["Dining"]);

        // Real v6 shape: no description on the wrapper, the journal
        // carries both the description and the payee_name. A second
        // journal with no description of its own falls back to the
        // wrapper's "attributes.description".
        mock_tx(
            &mut server,
            vec![
                json!({
                    "id": "attr-1",
                    "attributes": {
                        "group_title": null,
                        "transactions": [{
                            "type": "withdrawal",
                            "id": "j-attr-1",
                            "amount": "-3.00",
                            "description": "journal desc",
                            "payee_name": "Tram Stop",
                            "category_name": "Dining",
                            "budget_name": "Food",
                            "source_id": "asset-1",
                            "source_name": "Main",
                            "destination_id": "expense-9",
                            "destination_name": "Food:Transport",
                            "date": "2026-10-03",
                            "currency_code": "USD",
                            "currency_symbol": "$"
                        }]
                    }
                }),
                json!({
                    "id": "attr-2",
                    "attributes": {
                        "description": "group desc",
                        "group_title": null,
                        "transactions": [{
                            "type": "withdrawal",
                            "id": "j-attr-2",
                            "amount": "-2.00",
                            "category_name": "Dining",
                            "budget_name": "Food",
                            "source_id": "asset-1",
                            "source_name": "Main",
                            "destination_id": "expense-9",
                            "destination_name": "Food:Transport",
                            "date": "2026-10-04",
                            "currency_code": "USD",
                            "currency_symbol": "$"
                        }]
                    }
                }),
            ],
        )
        .await;

        let data = get_json!(
            &app,
            "/api/labels/transactions?label=lbl-tx-9&start=2026-09-01&end=2026-10-31",
        );
        assert_eq!(data["count"], 2);
        let txs = data["transactions"].as_array().unwrap();
        // Newest first: the wrapper-fallback journal (2026-10-04).
        assert_eq!(txs[0]["id"], "j-attr-2");
        assert_eq!(txs[0]["description"], "group desc");
        assert!(txs[0]["payee"].is_null());
        // The journal-level one (2026-10-03).
        assert_eq!(txs[1]["id"], "j-attr-1");
        assert_eq!(txs[1]["description"], "journal desc");
        assert_eq!(txs[1]["payee"], "Tram Stop");
        assert_eq!(txs[1]["account"], "Main");
        assert_eq!(txs[1]["destination"], "Food:Transport");
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_missing_label_param_is_400() {
        let _guard = TEST_LOCK.lock().unwrap();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        let req = awt::TestRequest::get()
            .uri("/api/labels/transactions?start=2026-09-01&end=2026-10-31")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);
    }

    #[actix_web::test]
    async fn tx_unknown_label_is_404() {
        let _guard = TEST_LOCK.lock().unwrap();
        let server = mockito::Server::new_async().await;
        let config = make_test_config(server.url());
        let client = web::Data::new(FireflyClient::new(config.clone()));
        let app = build_app!(config, client);

        clear_labels();
        let req = awt::TestRequest::get()
            .uri("/api/labels/transactions?label=does-not-exist")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);
        clear_labels();
    }

    #[actix_web::test]
    async fn tx_disabled_feature_returns_404() {
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

        let req = awt::TestRequest::get()
            .uri("/api/labels/transactions?label=lbl-x")
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 404, "expected 404 when disabled");

        // Re-enable for the other tests (shared settings row).
        let req = awt::TestRequest::patch()
            .uri("/api/settings")
            .set_json(json!({ "labels_enabled": true }))
            .to_request();
        let resp = awt::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
    }
}
