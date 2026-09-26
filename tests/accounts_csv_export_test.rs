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
            .match_query(mockito::Matcher::UrlEncoded(
                "type".to_string(),
                "liability".to_string(),
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
}
