/// Tests for the account CSV export endpoint (GET /api/accounts/export).
///
/// The export must include every account Firefly III reports for the
/// requested type — including types that are not in the configured
/// ACCOUNT_TYPES — because its purpose is to export data straight from
/// Firefly III.
#[cfg(test)]
mod tests {
    use actix_web::{test, web, App};

    use mockito::Server;
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use oxidize::handlers::account::export_accounts_csv;
    use serde_json::json;
    use std::ops::RangeInclusive;

    fn make_test_config(url: String) -> Config {
        Config {
            firefly_url: oxidize::config::FireflyUrl::validate(url).unwrap(),
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            // Deliberately a restricted subset: the export must still offer
            // every Firefly III account type.
            account_types: vec!["asset".to_string()],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
            cache_ttl: 300,
            time_ranges: vec!["30d".to_string()],
            default_time_range: "30d".to_string(),
        }
    }

    fn full_accounts_body() -> String {
        json!({
            "data": [
                {
                    "id": "1",
                    "attributes": {
                        "name": "Checking",
                        "type": "asset",
                        "current_balance": "100.50",
                        "currency_symbol": "$",
                        "currency_code": "USD",
                        "iban": null,
                        "account_number": "12345678",
                        "include_net_worth": true,
                        "notes": "Main, daily account"
                    }
                },
                {
                    "id": "2",
                    "attributes": {
                        "name": "Credit Card",
                        "type": "liabilities",
                        "current_balance": "-5000.00",
                        "currency_symbol": "$",
                        "currency_code": "USD",
                        "liability_type": "creditcard",
                        "notes": "Card \"Platinum\""
                    }
                }
            ]
        })
        .to_string()
    }

    /// Firefly III v6 reports the liability family as "liabilities"; an
    /// export for type=liability must include them, and CSV quoting must
    /// keep embedded commas and quotes intact.
    #[tokio::test]
    async fn test_export_csv_by_type_returns_csv_download() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex(
                "^limit=100&page=1&type=liability$".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(full_accounts_body())
            .create_async()
            .await;

        let service = test::init_service(
            App::new()
                .app_data(web::Data::new(FireflyClient::new(make_test_config(
                    server.url(),
                ))))
                .service(export_accounts_csv),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/accounts/export?type=liability")
            .to_request();
        let resp = test::call_service(&service, req).await;

        assert_eq!(resp.status(), 200);
        let content_type = resp
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(content_type.starts_with("text/csv"), "{}", content_type);

        let disposition = resp
            .headers()
            .get("content-disposition")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(
            disposition.starts_with("attachment; filename=\""),
            "{}",
            disposition
        );
        assert!(
            disposition.contains("firefly-iii-accounts-liability-"),
            "{}",
            disposition
        );
        assert!(disposition.ends_with(".csv\""), "{}", disposition);

        let body = test::read_body(resp).await;
        let text = String::from_utf8(body.to_vec()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2, "header + 1 liability account: {}", text);
        assert!(
            lines[0].starts_with("id,name,account_type,iban,account_number,currency_code,"),
            "{}",
            lines[0]
        );
        assert!(
            lines[1].starts_with("2,Credit Card,liabilities,"),
            "{}",
            lines[1]
        );
        assert!(
            lines[1].contains("\"Card \"\"Platinum\"\"\""),
            "{}",
            lines[1]
        );
        assert!(lines[1].contains("creditcard"), "{}", lines[1]);
    }

    /// Without a type filter every account is exported, including types
    /// that are not in the configured ACCOUNT_TYPES (asset only).
    #[tokio::test]
    async fn test_export_csv_without_type_exports_all_accounts() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(full_accounts_body())
            .create_async()
            .await;

        let service = test::init_service(
            App::new()
                .app_data(web::Data::new(FireflyClient::new(make_test_config(
                    server.url(),
                ))))
                .service(export_accounts_csv),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/accounts/export")
            .to_request();
        let resp = test::call_service(&service, req).await;

        assert_eq!(resp.status(), 200);
        let body = test::read_body(resp).await;
        let text = String::from_utf8(body.to_vec()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3, "header + 2 accounts: {}", text);
        assert!(lines[1].contains("Checking"), "{}", lines[1]);
        assert!(lines[1].contains("asset"), "{}", lines[1]);
        assert!(lines[1].contains("USD"), "{}", lines[1]);
        assert!(lines[1].contains("12345678"), "{}", lines[1]);
        assert!(lines[1].contains("true"), "{}", lines[1]);
        assert!(lines[1].contains("\"Main, daily account\""), "{}", lines[1]);
        assert!(lines[2].contains("Credit Card"), "{}", lines[2]);
    }

    /// Unknown types are rejected with 400 and the list of valid types,
    /// instead of a confusing upstream API error.
    #[tokio::test]
    async fn test_export_csv_rejects_unknown_type() {
        let server = Server::new_async().await;
        let service = test::init_service(
            App::new()
                .app_data(web::Data::new(FireflyClient::new(make_test_config(
                    server.url(),
                ))))
                .service(export_accounts_csv),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/accounts/export?type=vault")
            .to_request();
        let resp = test::call_service(&service, req).await;

        assert_eq!(resp.status(), 400);
        let body = test::read_body(resp).await;
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains("Invalid account type 'vault'"), "{}", text);
        assert!(text.contains("asset"), "{}", text);
        assert!(text.contains("cash"), "{}", text);
        assert!(text.contains("revenue"), "{}", text);
        assert!(text.contains("expense"), "{}", text);
    }

    /// "all" is accepted as an explicit alias for the unfiltered export.
    #[tokio::test]
    async fn test_export_csv_type_all_is_accepted() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(full_accounts_body())
            .create_async()
            .await;

        let service = test::init_service(
            App::new()
                .app_data(web::Data::new(FireflyClient::new(make_test_config(
                    server.url(),
                ))))
                .service(export_accounts_csv),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/accounts/export?type=all")
            .to_request();
        let resp = test::call_service(&service, req).await;

        assert_eq!(resp.status(), 200);
        let body = test::read_body(resp).await;
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert_eq!(text.lines().count(), 3);
    }

    /// Build a Firefly-style account list body with sequential ids.
    /// `account_type` may vary per index via the `types` map (default "asset").
    fn account_page(
        ids: RangeInclusive<i64>,
        types: &std::collections::HashMap<i64, &str>,
    ) -> String {
        let items: Vec<serde_json::Value> = ids
            .map(|id| {
                json!({
                    "id": id.to_string(),
                    "attributes": {
                        "name": format!("Account {}", id),
                        "type": types.get(&id).copied().unwrap_or("asset"),
                        "current_balance": "10.00",
                        "currency_symbol": "$"
                    }
                })
            })
            .collect();
        json!({ "data": items }).to_string()
    }

    /// Regression: Firefly III paginates GET /v1/accounts (default first
    /// page only), so an export of 217 accounts used to stop at the first
    /// page. The client must loop limit=100 + page until a short page.
    #[tokio::test]
    async fn test_get_all_accounts_paginates_until_short_page() {
        let mut server = Server::new_async().await;
        let e1 = server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=1$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(1..=100, &std::collections::HashMap::new()))
            .create_async()
            .await;
        let e2 = server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=2$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(101..=200, &std::collections::HashMap::new()))
            .create_async()
            .await;
        let e3 = server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=3$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(201..=217, &std::collections::HashMap::new()))
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let accounts = client.get_all_accounts(None).await.unwrap();

        assert_eq!(accounts.len(), 217, "all three pages must be exported");
        assert_eq!(accounts[0].id, "1");
        assert_eq!(accounts[216].id, "217");
        e1.assert();
        e2.assert();
        e3.assert();
    }

    /// A count that is an exact multiple of the page size must still fetch
    /// the (empty) next page to know it is done.
    #[tokio::test]
    async fn test_get_all_accounts_stops_after_exact_page_multiple() {
        let mut server = Server::new_async().await;
        let e1 = server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=1$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(1..=100, &std::collections::HashMap::new()))
            .create_async()
            .await;
        let e2 = server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=2$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(101..=200, &std::collections::HashMap::new()))
            .create_async()
            .await;
        let e3 = server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=3$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"data": []}).to_string())
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let accounts = client.get_all_accounts(None).await.unwrap();

        assert_eq!(accounts.len(), 200);
        e1.assert();
        e2.assert();
        e3.assert();
    }

    /// The type filter is sent to the API AND applied per page: mixed-type
    /// pages must contribute only their matching accounts, and the
    /// liability family matches both "liability" and v6 "liabilities".
    #[tokio::test]
    async fn test_get_all_accounts_applies_type_filter_across_pages() {
        let mut server = Server::new_async().await;
        let mut types = std::collections::HashMap::new();
        for id in 1..=102i64 {
            types.insert(id, "liability");
        }
        for id in [103i64, 104] {
            types.insert(id, "asset");
        }
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex(
                "^limit=100&page=1&type=liability$".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(1..=104, &types))
            .create_async()
            .await;
        let mut types2 = std::collections::HashMap::new();
        for id in 105..=107 {
            types2.insert(id, "liabilities");
        }
        types2.insert(108, "cash");
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex(
                "^limit=100&page=2&type=liability$".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(105..=108, &types2))
            .create_async()
            .await;

        let client = FireflyClient::new(make_test_config(server.url()));
        let accounts = client
            .get_all_accounts(Some("liability".to_string()))
            .await
            .unwrap();

        // Page 1: 102 liabilities (103-104 are assets); page 2: 3 v6
        // "liabilities" (108 is cash) -> 105 total.
        assert_eq!(
            accounts.len(),
            105,
            "non-matching accounts on every page must be dropped"
        );
        assert!(
            accounts
                .iter()
                .all(|a| matches!(a.account_type.as_str(), "liability" | "liabilities")),
            "only the liability family may remain"
        );
    }

    /// End-to-end: the export endpoint returns every row from every page.
    #[tokio::test]
    async fn test_export_csv_returns_every_page() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=1$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(1..=100, &std::collections::HashMap::new()))
            .create_async()
            .await;
        server
            .mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::Regex("^limit=100&page=2$".to_string()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(account_page(101..=150, &std::collections::HashMap::new()))
            .create_async()
            .await;

        let service = test::init_service(
            App::new()
                .app_data(web::Data::new(FireflyClient::new(make_test_config(
                    server.url(),
                ))))
                .service(export_accounts_csv),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/accounts/export")
            .to_request();
        let resp = test::call_service(&service, req).await;

        assert_eq!(resp.status(), 200);
        let body = test::read_body(resp).await;
        let text = String::from_utf8(body.to_vec()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 151, "header + 150 accounts from both pages");
        assert!(lines[1].starts_with("1,Account 1,asset,"), "{}", lines[1]);
        assert!(
            lines[150].starts_with("150,Account 150,asset,"),
            "{}",
            lines[150]
        );
    }
}
