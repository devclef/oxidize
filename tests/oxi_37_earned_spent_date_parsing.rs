/// Tests for OXI-37: Earned vs spent chart date parsing
///
/// This test verifies that the earned/spent chart correctly handles
/// multiple date formats that Firefly III might return.
#[cfg(test)]
mod tests {
    use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};

    /// Simulates the parse_transaction_date function from the backend
    fn parse_transaction_date(date_str: &str) -> Option<NaiveDateTime> {
        chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%SZ"))
            .or_else(|_| {
                chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.3f+00:00")
            })
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.3fZ"))
            .or_else(|_| {
                chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                    .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
            })
            .ok()
    }

    /// Simulates the get_period_key function from the backend
    fn get_period_key(date_str: &str, period: &str) -> String {
        if let Some(date) = parse_transaction_date(date_str) {
            match period {
                "1M" => date.format("%Y-%m-01T00:00:00+00:00").to_string(),
                "1W" => {
                    let monday =
                        date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
                    monday.format("%Y-%m-%dT00:00:00+00:00").to_string()
                }
                _ => date.format("%Y-%m-%dT00:00:00+00:00").to_string(),
            }
        } else {
            // Fallback: try to extract just the date portion
            if let Some(date_part) = date_str.split('T').next() {
                if let Ok(date) = NaiveDate::parse_from_str(date_part, "%Y-%m-%d") {
                    return date.format("%Y-%m-%dT00:00:00+00:00").to_string();
                }
            }
            date_str.to_string()
        }
    }

    #[test]
    fn test_parse_date_with_timezone_offset() {
        let result = parse_transaction_date("2026-01-15T10:30:00+00:00");
        assert!(result.is_some());
        let date = result.unwrap();
        assert_eq!(date.day(), 15);
        assert_eq!(date.month(), 1);
        assert_eq!(date.year(), 2026);
    }

    #[test]
    fn test_parse_date_with_z_suffix() {
        let result = parse_transaction_date("2026-01-15T10:30:00Z");
        assert!(result.is_some());
        let date = result.unwrap();
        assert_eq!(date.day(), 15);
        assert_eq!(date.month(), 1);
    }

    #[test]
    fn test_parse_date_with_milliseconds() {
        let result = parse_transaction_date("2026-01-15T10:30:00.123+00:00");
        assert!(result.is_some());
        let date = result.unwrap();
        assert_eq!(date.day(), 15);
        assert_eq!(date.month(), 1);
    }

    #[test]
    fn test_parse_date_with_different_timezone() {
        // Non-UTC timezone offset falls back to date-only parsing
        let result = parse_transaction_date("2026-01-15T10:30:00+05:30");
        assert!(result.is_none());
        let period_key = get_period_key("2026-01-15T10:30:00+05:30", "1D");
        assert_eq!(period_key, "2026-01-15T00:00:00+00:00");
    }

    #[test]
    fn test_parse_date_date_only() {
        let result = parse_transaction_date("2026-01-15");
        assert!(result.is_some());
        let date = result.unwrap();
        assert_eq!(date.day(), 15);
        assert_eq!(date.month(), 1);
        assert_eq!(date.hour(), 0);
        assert_eq!(date.minute(), 0);
        assert_eq!(date.second(), 0);
    }

    #[test]
    fn test_period_key_monthly_matching() {
        let mut generated_keys = Vec::new();
        let mut current = NaiveDate::parse_from_str("2026-01-01", "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str("2026-03-31", "%Y-%m-%d").unwrap();
        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            generated_keys.push(key.clone());
            if current.month() == 12 {
                current = current
                    .with_year(current.year() + 1)
                    .unwrap()
                    .with_month(1)
                    .unwrap();
            } else {
                current = current.with_month(current.month() + 1).unwrap();
            }
        }

        let transaction_dates = vec![
            "2026-01-15T10:30:00+00:00",
            "2026-02-20T14:45:00Z",
            "2026-03-10T09:15:00.123+00:00",
        ];

        for date_str in &transaction_dates {
            let key = get_period_key(date_str, "1M");
            assert!(
                generated_keys.contains(&key),
                "Period key {} from transaction date {} should be in generated keys {:?}",
                key,
                date_str,
                generated_keys
            );
        }
    }

    #[test]
    fn test_period_key_daily_matching() {
        let transaction_dates = vec![
            ("2026-01-15T10:30:00+00:00", "2026-01-15T00:00:00+00:00"),
            ("2026-02-20T14:45:00Z", "2026-02-20T00:00:00+00:00"),
            ("2026-03-10", "2026-03-10T00:00:00+00:00"),
        ];

        for (input, expected) in transaction_dates {
            let key = get_period_key(input, "1D");
            assert_eq!(
                key, expected,
                "Daily period key for {} should be {}",
                input, expected
            );
        }
    }

    #[test]
    fn test_period_key_weekly_matching() {
        let transaction_dates = vec![
            ("2026-01-05T10:30:00+00:00", "2026-01-05T00:00:00+00:00"),
            ("2026-01-07T14:45:00Z", "2026-01-05T00:00:00+00:00"),
            ("2026-01-12T09:15:00", "2026-01-12T00:00:00+00:00"),
        ];

        for (input, expected) in transaction_dates {
            let key = get_period_key(input, "1W");
            assert_eq!(
                key, expected,
                "Weekly period key for {} should be {}",
                input, expected
            );
        }
    }

    #[test]
    fn test_aggregation_with_mixed_date_formats() {
        let mut entries: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
        entries.insert("2026-01-01T00:00:00+00:00".to_string(), 0.0);

        let transactions = vec![
            ("2026-01-15T10:30:00+00:00", 100.0),
            ("2026-01-20T14:45:00Z", 200.0),
            ("2026-01-25T09:15:00.123+00:00", 300.0),
        ];

        for (date_str, amount) in &transactions {
            let key = get_period_key(date_str, "1M");
            *entries.entry(key).or_insert(0.0) += amount;
        }

        assert_eq!(
            entries.get("2026-01-01T00:00:00+00:00"),
            Some(&600.0),
            "All January transactions should be aggregated"
        );
    }
}
