#[cfg(test)]
mod tests {
    use oxidize::client::FireflyClient;
    use oxidize::config::Config;
    use mockito::Server;
    use serde_json::json;

    #[tokio::test]
    async fn test_get_accounts_all_should_behave_like_none() {
        let mut server = Server::new_async().await;
        let url = server.url();

        // Mock for /v1/accounts?type=all - might return empty list
        let _m_all = server.mock("GET", "/v1/accounts")
            .match_query(mockito::Matcher::UrlEncoded("type".into(), "all".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({
                "data": []
            }).to_string())
            .create_async()
            .await;

        // Mock for /v1/accounts (no params) - should return 1 account
        let _m_none = server.mock("GET", "/v1/accounts")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({
                "data": [
                    {
                        "id": "acc1",
                        "attributes": {
                            "name": "Test Account",
                            "type": "asset",
                            "current_balance": "100.00",
                            "currency_symbol": "$"
                        }
                    }
                ]
            }).to_string())
            .create_async()
            .await;

        let config = Config {
            firefly_url: url,
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            account_types: vec!["asset".to_string()],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
        };

        let client = FireflyClient::new(config);

        // Test None
        let accounts_none: Vec<oxidize::models::SimpleAccount> = client.get_accounts(None).await.unwrap();
        assert_eq!(accounts_none.len(), 1, "get_accounts(None) should return 1 account");

        // Clear cache to ensure the next call doesn't hit the cache
        client.clear_accounts_cache();

        // Test Some("all") - this is expected to fail currently because it calls ?type=all
        let accounts_all: Vec<oxidize::models::SimpleAccount> = client.get_accounts(Some("all".to_string())).await.unwrap();
        println!("accounts_all len: {}", accounts_all.len());
        assert_eq!(accounts_all.len(), 1, "get_accounts(Some('all')) should behave like get_accounts(None) and return 1 account");
    }
}
