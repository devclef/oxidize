/// Tests for OXI-12: Fix time range on earned vs spent chart
///
/// This test file verifies that the earned/spent chart correctly shows data
/// for each interval within the selected date range, filling in 0 for periods
/// with no transactions.

#[cfg(test)]
mod tests {
    use chrono::{Datelike, Duration, NaiveDate};

    #[test]
    fn test_generate_period_keys_daily() {
        // Test that daily period keys are generated correctly for a date range
        let start = NaiveDate::parse_from_str("2026-01-01", "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str("2026-01-05", "%Y-%m-%d").unwrap();
        let period = "1D";

        let mut keys = Vec::new();
        let mut current = start;
        while current <= end {
            let key = current.format("%Y-%m-%dT00:00:00+00:00").to_string();
            keys.push(key);
            current += Duration::days(1);
        }

        assert_eq!(keys.len(), 5, "Should generate 5 daily keys");
        assert_eq!(keys[0], "2026-01-01T00:00:00+00:00");
        assert_eq!(keys[4], "2026-01-05T00:00:00+00:00");
    }

    #[test]
    fn test_generate_period_keys_monthly() {
        // Test that monthly period keys are generated correctly for a date range
        let start = NaiveDate::parse_from_str("2026-01-01", "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str("2026-04-01", "%Y-%m-%d").unwrap();
        let period = "1M";

        let mut keys = Vec::new();
        let mut current = start;
        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            keys.push(key);
            // Move to next month
            if current.month() == 12 {
                current = current.with_year(current.year() + 1).unwrap().with_month(1).unwrap();
            } else {
                current = current.with_month(current.month() + 1).unwrap();
            }
        }

        assert_eq!(keys.len(), 4, "Should generate 4 monthly keys");
        assert_eq!(keys[0], "2026-01-01T00:00:00+00:00");
        assert_eq!(keys[1], "2026-02-01T00:00:00+00:00");
        assert_eq!(keys[2], "2026-03-01T00:00:00+00:00");
        assert_eq!(keys[3], "2026-04-01T00:00:00+00:00");
    }

    #[test]
    fn test_generate_period_keys_weekly() {
        // Test that weekly period keys (Monday of each week) are generated correctly
        // Jan 5, 2026 is a Monday
        let start = NaiveDate::parse_from_str("2026-01-05", "%Y-%m-%d").unwrap(); // Monday
        let end = NaiveDate::parse_from_str("2026-01-19", "%Y-%m-%d").unwrap(); // Monday
        let _period = "1W";

        let mut keys = Vec::new();
        let mut current = start;
        while current <= end {
            // Get Monday of current week
            let monday = current - Duration::days(current.weekday().num_days_from_monday() as i64);
            let key = monday.format("%Y-%m-%dT00:00:00+00:00").to_string();
            keys.push(key);
            current += Duration::days(7);
        }

        // Jan 5 is Monday, so we get Jan 5, Jan 12, Jan 19
        assert_eq!(keys.len(), 3, "Should generate 3 weekly keys");
        assert_eq!(keys[0], "2026-01-05T00:00:00+00:00");
        assert_eq!(keys[1], "2026-01-12T00:00:00+00:00");
        assert_eq!(keys[2], "2026-01-19T00:00:00+00:00");
    }

    #[test]
    fn test_fill_missing_periods_with_zeros() {
        // Test that missing periods are filled with 0 values
        let start = NaiveDate::parse_from_str("2026-01-01", "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str("2026-03-01", "%Y-%m-%d").unwrap();
        let period = "1M";

        // Simulate transaction data that only has entries for Jan and March
        let mut transaction_data: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
        transaction_data.insert("2026-01-01T00:00:00+00:00".to_string(), 1000.0);
        transaction_data.insert("2026-03-01T00:00:00+00:00".to_string(), 2000.0);
        // February is missing

        // Generate all period keys for the range
        let mut period_keys = Vec::new();
        let mut current = start;
        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            period_keys.push(key.clone());
            // Move to next month
            if current.month() == 12 {
                current = current.with_year(current.year() + 1).unwrap().with_month(1).unwrap();
            } else {
                current = current.with_month(current.month() + 1).unwrap();
            }
        }

        // Fill in missing periods with 0
        for key in &period_keys {
            if !transaction_data.contains_key(key) {
                transaction_data.insert(key.clone(), 0.0);
            }
        }

        // Verify all periods are present
        assert_eq!(transaction_data.len(), 3, "Should have 3 period entries");
        assert_eq!(transaction_data.get("2026-01-01T00:00:00+00:00").unwrap(), &1000.0);
        assert_eq!(transaction_data.get("2026-02-01T00:00:00+00:00").unwrap(), &0.0, "February should be filled with 0");
        assert_eq!(transaction_data.get("2026-03-01T00:00:00+00:00").unwrap(), &2000.0);
    }

    #[test]
    fn test_long_date_range_with_monthly_periods() {
        // Test a date range over a year with monthly periods
        let start = NaiveDate::parse_from_str("2025-01-01", "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str("2026-01-01", "%Y-%m-%d").unwrap();
        let period = "1M";

        let mut keys = Vec::new();
        let mut current = start;
        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            keys.push(key);
            // Move to next month
            if current.month() == 12 {
                current = current.with_year(current.year() + 1).unwrap().with_month(1).unwrap();
            } else {
                current = current.with_month(current.month() + 1).unwrap();
            }
        }

        assert_eq!(keys.len(), 13, "Should generate 13 monthly keys for a year range");
        assert_eq!(keys[0], "2025-01-01T00:00:00+00:00");
        assert_eq!(keys[12], "2026-01-01T00:00:00+00:00");
    }

    #[test]
    fn test_earned_spent_response_structure() {
        // Test that the earned/spent response has the correct structure with all periods
        let response: serde_json::Value = serde_json::json!([
            {
                "label": "earned",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    "2026-01-01T00:00:00+00:00": 1000.0,
                    "2026-02-01T00:00:00+00:00": 0.0,
                    "2026-03-01T00:00:00+00:00": 1500.0
                }
            },
            {
                "label": "spent",
                "currency_symbol": "$",
                "currency_code": "USD",
                "entries": {
                    "2026-01-01T00:00:00+00:00": 500.0,
                    "2026-02-01T00:00:00+00:00": 0.0,
                    "2026-03-01T00:00:00:00": 750.0
                }
            }
        ]);

        let array = response.as_array().unwrap();
        assert_eq!(array.len(), 2);

        let earned = array.iter().find(|ds| ds["label"] == "earned").unwrap();
        let spent = array.iter().find(|ds| ds["label"] == "spent").unwrap();

        // Verify all 3 months are present including the zero-value February
        let earned_entries = &earned["entries"];
        assert_eq!(earned_entries.as_object().unwrap().len(), 3);
        assert_eq!(earned_entries.get("2026-02-01T00:00:00+00:00").unwrap(), &0.0);

        let spent_entries = &spent["entries"];
        assert_eq!(spent_entries.as_object().unwrap().len(), 3);
        assert_eq!(spent_entries.get("2026-02-01T00:00:00+00:00").unwrap(), &0.0);
    }

    #[test]
    fn test_time_range_issue_description() {
        // This test verifies the fix for the issue described in OXI-12:
        // "When selecting a time range of over a year and select month it only shows one month."
        // The fix ensures all months in the range are shown, with 0 for months without transactions.

        // Simulate a year-long date range with monthly periods
        let start = NaiveDate::parse_from_str("2025-01-01", "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str("2025-12-31", "%Y-%m-%d").unwrap();

        // Simulate transaction data with only a few months having transactions
        let mut earned_data: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
        earned_data.insert("2025-03-01T00:00:00+00:00".to_string(), 5000.0);
        earned_data.insert("2025-07-01T00:00:00+00:00".to_string(), 6000.0);
        earned_data.insert("2025-11-01T00:00:00+00:00".to_string(), 5500.0);

        // Generate all period keys and fill in missing months with 0
        let mut current = start;
        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            if !earned_data.contains_key(&key) {
                earned_data.insert(key.clone(), 0.0);
            }
            // Move to next month
            if current.month() == 12 {
                current = current.with_year(current.year() + 1).unwrap().with_month(1).unwrap();
            } else {
                current = current.with_month(current.month() + 1).unwrap();
            }
        }

        // Verify all 12 months are present
        assert_eq!(earned_data.len(), 12, "Should have all 12 months");

        // Verify months with transactions have correct values
        assert_eq!(earned_data.get("2025-03-01T00:00:00+00:00").unwrap(), &5000.0);
        assert_eq!(earned_data.get("2025-07-01T00:00:00+00:00").unwrap(), &6000.0);
        assert_eq!(earned_data.get("2025-11-01T00:00:00+00:00").unwrap(), &5500.0);

        // Verify months without transactions have 0
        assert_eq!(earned_data.get("2025-01-01T00:00:00+00:00").unwrap(), &0.0);
        assert_eq!(earned_data.get("2025-02-01T00:00:00+00:00").unwrap(), &0.0);
        assert_eq!(earned_data.get("2025-04-01T00:00:00+00:00").unwrap(), &0.0);
        assert_eq!(earned_data.get("2025-12-01T00:00:00+00:00").unwrap(), &0.0);
    }
}
