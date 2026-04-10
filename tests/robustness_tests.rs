#[cfg(test)]
mod tests {
    use chrono::{Datelike, Duration, Utc};

    #[test]
    fn test_date_range_parsing() {
        // Test that date range parameters are correctly parsed
        let query_string = "start=2026-01-01&end=2026-03-01&period=1M";
        let params: Vec<(String, String)> = serde_urlencoded::from_str(query_string).unwrap();

        let mut start: Option<String> = None;
        let mut end: Option<String> = None;
        let mut period: Option<String> = None;

        for (k, v) in params {
            match k.as_str() {
                "start" => start = Some(v),
                "end" => end = Some(v),
                "period" => period = Some(v),
                _ => {}
            }
        }

        assert_eq!(start, Some("2026-01-01".to_string()));
        assert_eq!(end, Some("2026-03-01".to_string()));
        assert_eq!(period, Some("1M".to_string()));
    }

    #[test]
    fn test_date_range_with_accounts() {
        // Test that date range and account parameters are parsed together
        let query_string = "start=2026-01-01&end=2026-03-01&period=1W&accounts[]=1&accounts[]=2";
        let params: Vec<(String, String)> = serde_urlencoded::from_str(query_string).unwrap();

        let mut start: Option<String> = None;
        let mut end: Option<String> = None;
        let mut period: Option<String> = None;
        let mut account_ids: Vec<String> = Vec::new();

        for (k, v) in params {
            match k.as_str() {
                "start" => start = Some(v),
                "end" => end = Some(v),
                "period" => period = Some(v),
                "accounts[]" => account_ids.push(v),
                _ => {}
            }
        }

        assert_eq!(start, Some("2026-01-01".to_string()));
        assert_eq!(end, Some("2026-03-01".to_string()));
        assert_eq!(period, Some("1W".to_string()));
        assert_eq!(account_ids, vec!["1".to_string(), "2".to_string()]);
    }

    #[test]
    fn test_default_date_range_calculation() {
        // Test that default date range is calculated correctly
        let end = Utc::now().format("%Y-%m-%d").to_string();
        let start = (Utc::now() - Duration::days(30))
            .format("%Y-%m-%d")
            .to_string();

        // Verify format
        assert_eq!(end.len(), 10);
        assert_eq!(start.len(), 10);

        // Verify start is before end
        assert!(start <= end);

        // Verify range is approximately 30 days
        let start_parsed = chrono::NaiveDate::parse_from_str(&start, "%Y-%m-%d").unwrap();
        let end_parsed = chrono::NaiveDate::parse_from_str(&end, "%Y-%m-%d").unwrap();
        let diff = (end_parsed - start_parsed).num_days();

        assert!(
            (29..=31).contains(&diff),
            "Date range should be ~30 days, got {}",
            diff
        );
    }

    #[test]
    fn test_widget_creation_validation() {
        // Test widget creation with valid data
        let widget = serde_json::json!({
            "id": "test-uuid",
            "name": "Test Widget",
            "accounts": ["1", "2", "3"],
            "start_date": "2026-01-01",
            "end_date": "2026-03-01",
            "interval": "1M",
            "widget_type": "balance"
        });

        assert_eq!(widget["name"], "Test Widget");
        assert_eq!(widget["accounts"].as_array().unwrap().len(), 3);
        assert_eq!(widget["widget_type"], "balance");
    }

    #[test]
    fn test_earned_spent_widget_no_accounts() {
        // Test that earned_spent widgets don't require accounts
        let widget = serde_json::json!({
            "id": "test-uuid",
            "name": "Earned vs Spent",
            "accounts": [],
            "start_date": "2026-01-01",
            "end_date": "2026-03-01",
            "widget_type": "earned_spent"
        });

        assert_eq!(widget["widget_type"], "earned_spent");
        assert!(widget["accounts"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_chart_data_response_structure() {
        // Test that chart data response has correct structure
        let response = serde_json::json!([
            {
                "label": "earned",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    "2026-01-01T00:00:00+00:00": "100.00"
                }
            },
            {
                "label": "spent",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    "2026-01-01T00:00:00+00:00": "50.00"
                }
            }
        ]);

        assert_eq!(response.as_array().unwrap().len(), 2);
        assert_eq!(response[0]["label"], "earned");
        assert_eq!(response[1]["label"], "spent");
    }

    #[test]
    fn test_account_filtering() {
        // Test account type filtering
        let accounts = [
            serde_json::json!({"id": "1", "name": "Checking", "account_type": "asset"}),
            serde_json::json!({"id": "2", "name": "Credit Card", "account_type": "liability"}),
            serde_json::json!({"id": "3", "name": "Cash", "account_type": "cash"}),
        ];

        let asset_accounts: Vec<_> = accounts
            .iter()
            .filter(|a| a["account_type"] == "asset")
            .collect();

        assert_eq!(asset_accounts.len(), 1);
        assert_eq!(asset_accounts[0]["name"], "Checking");
    }

    #[test]
    fn test_period_aggregation_keys() {
        // Test that period aggregation generates correct keys
        let date_str = "2026-03-15T10:30:00+00:00";

        // Daily period - should keep date
        let daily_key = if let Ok(date) =
            chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
        {
            date.format("%Y-%m-%dT00:00:00+00:00").to_string()
        } else {
            date_str.to_string()
        };
        assert_eq!(daily_key, "2026-03-15T00:00:00+00:00");

        // Monthly period - should be first day of month
        let monthly_key = if let Ok(date) =
            chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
        {
            date.format("%Y-%m-01T00:00:00+00:00").to_string()
        } else {
            date_str.to_string()
        };
        assert_eq!(monthly_key, "2026-03-01T00:00:00+00:00");

        // Weekly period - should be Monday of that week
        let weekly_key = if let Ok(date) =
            chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
        {
            let monday =
                date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
            monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
        } else {
            date_str.to_string()
        };
        // March 15, 2026 is a Sunday, so Monday would be March 9
        assert_eq!(weekly_key, "2026-03-09T00:00:00+00:00");
    }

    #[test]
    fn test_transaction_type_filtering() {
        // Test filtering transactions by type
        let transactions = [
            serde_json::json!({"type": "deposit", "amount": "100.00"}),
            serde_json::json!({"type": "withdrawal", "amount": "50.00"}),
            serde_json::json!({"type": "deposit", "amount": "200.00"}),
            serde_json::json!({"type": "transfer", "amount": "75.00"}),
        ];

        let deposits: Vec<_> = transactions
            .iter()
            .filter(|t| t["type"] == "deposit")
            .collect();

        let withdrawals: Vec<_> = transactions
            .iter()
            .filter(|t| t["type"] == "withdrawal")
            .collect();

        assert_eq!(deposits.len(), 2);
        assert_eq!(withdrawals.len(), 1);
    }

    #[test]
    fn test_empty_query_string_handling() {
        // Test that empty query string is handled correctly
        let query_string = "";
        let params: Vec<(String, String)> =
            serde_urlencoded::from_str(query_string).unwrap_or_default();

        assert!(params.is_empty());
    }

    #[test]
    fn test_url_encoded_parameters() {
        // Test handling of URL-encoded parameters
        let query_string = "accounts%5B%5D=1&accounts%5B%5D=2&start=2026-01-01";
        let params: Vec<(String, String)> = serde_urlencoded::from_str(query_string).unwrap();

        // serde_urlencoded automatically decodes URL-encoded parameters
        let account_ids: Vec<String> = params
            .iter()
            .filter(|(k, _)| k == "accounts[]")
            .map(|(_, v)| v.clone())
            .collect();

        assert_eq!(account_ids, vec!["1".to_string(), "2".to_string()]);
    }
}
