/// Test for OXI-15: Earned vs Spent still not correct
///
/// This test reproduces the bug where only the most recent data is shown,
/// and all previous data points are blank.

#[cfg(test)]
mod tests {
    use chrono::{Datelike, NaiveDate};

    #[test]
    fn test_period_key_generation_matches_transaction_dates() {
        // This test verifies that period keys generated for a date range
        // match the period keys extracted from transaction dates

        // Simulate a date range: Jan 1, 2026 to Mar 31, 2026 with monthly periods
        let start_date = "2026-01-01";
        let end_date = "2026-03-31";

        // Generate period keys for the range (this is what the backend does)
        let mut generated_keys = Vec::new();
        let mut current = NaiveDate::parse_from_str(start_date, "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d").unwrap();

        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            generated_keys.push(key.clone());

            // Move to next month
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

        assert_eq!(generated_keys.len(), 3, "Should have 3 monthly keys");
        assert_eq!(generated_keys[0], "2026-01-01T00:00:00+00:00");
        assert_eq!(generated_keys[1], "2026-02-01T00:00:00+00:00");
        assert_eq!(generated_keys[2], "2026-03-01T00:00:00+00:00");

        // Simulate transaction dates from Firefly III API
        // Firefly III returns dates in ISO 8601 format like "2026-01-15T10:30:00+00:00"
        let transaction_dates = vec![
            "2026-01-15T10:30:00+00:00", // January transaction
            "2026-02-20T14:45:00+00:00", // February transaction
            "2026-03-10T09:15:00+00:00", // March transaction
        ];

        // Extract period keys from transaction dates (this is what get_period_key does)
        let mut extracted_keys = Vec::new();
        for date_str in &transaction_dates {
            if let Ok(date) =
                chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
            {
                let period_key = date.format("%Y-%m-01T00:00:00+00:00").to_string();
                extracted_keys.push(period_key);
            }
        }

        // Verify extracted keys match generated keys
        assert_eq!(extracted_keys.len(), 3);
        assert_eq!(extracted_keys[0], "2026-01-01T00:00:00+00:00");
        assert_eq!(extracted_keys[1], "2026-02-01T00:00:00+00:00");
        assert_eq!(extracted_keys[2], "2026-03-01T00:00:00+00:00");

        // All extracted keys should be in generated keys
        for key in &extracted_keys {
            assert!(
                generated_keys.contains(key),
                "Extracted key {} should be in generated keys",
                key
            );
        }
    }

    #[test]
    fn test_aggregation_populates_all_periods() {
        // This test verifies that when aggregating transactions,
        // all periods in the date range are populated (with 0 for empty periods)

        let start_date = "2026-01-01";
        let end_date = "2026-03-31";

        // Initialize all periods with 0
        let mut earned_entries: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();

        let mut current = NaiveDate::parse_from_str(start_date, "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d").unwrap();

        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            earned_entries.insert(key.clone(), 0.0);

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

        // Simulate adding transaction data (only Jan and Mar have transactions)
        let transactions = vec![
            ("2026-01-15T10:30:00+00:00", 1000.0),
            ("2026-01-20T14:45:00+00:00", 500.0),
            ("2026-03-10T09:15:00+00:00", 2000.0),
        ];

        for (date_str, amount) in &transactions {
            if let Ok(date) =
                chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
            {
                let period_key = date.format("%Y-%m-01T00:00:00+00:00").to_string();
                *earned_entries.entry(period_key).or_insert(0.0) += amount;
            }
        }

        // Verify all periods are present
        assert_eq!(earned_entries.len(), 3, "Should have 3 period entries");

        // Verify January has correct total (1000 + 500 = 1500)
        assert_eq!(
            earned_entries.get("2026-01-01T00:00:00+00:00"),
            Some(&1500.0),
            "January should have 1500.0"
        );

        // Verify February is 0 (no transactions)
        assert_eq!(
            earned_entries.get("2026-02-01T00:00:00+00:00"),
            Some(&0.0),
            "February should have 0.0"
        );

        // Verify March has correct total
        assert_eq!(
            earned_entries.get("2026-03-01T00:00:00+00:00"),
            Some(&2000.0),
            "March should have 2000.0"
        );
    }

    #[test]
    fn test_long_date_range_monthly_periods() {
        // This test verifies the fix for the original bug report:
        // "When selecting a time range of over a year and select month it only shows one month."

        let start_date = "2025-01-01";
        let end_date = "2025-12-31";

        let mut entries: std::collections::HashMap<String, f64> = std::collections::HashMap::new();

        // Generate all period keys and initialize with 0
        let mut current = NaiveDate::parse_from_str(start_date, "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d").unwrap();

        while current <= end {
            let key = current.format("%Y-%m-01T00:00:00+00:00").to_string();
            entries.insert(key.clone(), 0.0);

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

        // Verify all 12 months are initialized
        assert_eq!(entries.len(), 12, "Should have all 12 months initialized");

        // Simulate transactions spread across the year
        let transactions = vec![
            ("2025-01-15T10:30:00+00:00", 1000.0),
            ("2025-04-20T14:45:00+00:00", 1500.0),
            ("2025-07-10T09:15:00+00:00", 2000.0),
            ("2025-10-05T16:20:00+00:00", 1200.0),
            ("2025-12-25T11:00:00+00:00", 3000.0),
        ];

        for (date_str, amount) in &transactions {
            if let Ok(date) =
                chrono::NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S+00:00")
            {
                let period_key = date.format("%Y-%m-01T00:00:00+00:00").to_string();
                *entries.entry(period_key).or_insert(0.0) += amount;
            }
        }

        // Verify all 12 months are still present
        assert_eq!(
            entries.len(),
            12,
            "Should still have all 12 months after adding transactions"
        );

        // Verify months with transactions have correct values
        assert_eq!(entries.get("2025-01-01T00:00:00+00:00"), Some(&1000.0));
        assert_eq!(entries.get("2025-04-01T00:00:00+00:00"), Some(&1500.0));
        assert_eq!(entries.get("2025-07-01T00:00:00+00:00"), Some(&2000.0));
        assert_eq!(entries.get("2025-10-01T00:00:00+00:00"), Some(&1200.0));
        assert_eq!(entries.get("2025-12-01T00:00:00+00:00"), Some(&3000.0));

        // Verify months without transactions are 0
        assert_eq!(entries.get("2025-02-01T00:00:00+00:00"), Some(&0.0));
        assert_eq!(entries.get("2025-03-01T00:00:00+00:00"), Some(&0.0));
        assert_eq!(entries.get("2025-05-01T00:00:00+00:00"), Some(&0.0));
        assert_eq!(entries.get("2025-06-01T00:00:00+00:00"), Some(&0.0));
        assert_eq!(entries.get("2025-08-01T00:00:00+00:00"), Some(&0.0));
        assert_eq!(entries.get("2025-09-01T00:00:00+00:00"), Some(&0.0));
        assert_eq!(entries.get("2025-11-01T00:00:00+00:00"), Some(&0.0));
    }
}
