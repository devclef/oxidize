/// Tests for OXI-38: Date range chunking for large date ranges
///
/// These tests verify that chunk_date_range correctly splits date ranges
/// into monthly intervals, which is needed because Firefly III has a hard
/// limit on the number of transactions returned per API call (~500).
#[cfg(test)]
mod tests {
    use chrono::{Datelike, Duration, NaiveDate};

    fn chunk_date_range(start: &str, end: &str) -> Vec<(String, String)> {
        let start = NaiveDate::parse_from_str(start, "%Y-%m-%d").unwrap();
        let end = NaiveDate::parse_from_str(end, "%Y-%m-%d").unwrap();

        let mut chunks = Vec::new();
        let mut current = start;

        while current <= end {
            let chunk_start = current;
            // Find the last day of the current month
            let mut next_month = current.with_day(1).unwrap();
            if next_month.month() == 12 {
                next_month = next_month
                    .with_year(next_month.year() + 1)
                    .unwrap()
                    .with_month(1)
                    .unwrap();
            } else {
                next_month = next_month.with_month(next_month.month() + 1).unwrap();
            }
            let chunk_end = next_month.pred_opt().unwrap();

            // Clamp chunk_end to the overall end date
            let actual_end = if chunk_end > end { end } else { chunk_end };

            chunks.push((
                chunk_start.format("%Y-%m-%d").to_string(),
                actual_end.format("%Y-%m-%d").to_string(),
            ));

            // Move to the first day of the next month
            current = if next_month > end {
                end + Duration::days(1)
            } else {
                next_month
            };
        }

        chunks
    }

    #[test]
    fn test_single_month_range() {
        let chunks = chunk_date_range("2026-01-01", "2026-01-31");
        assert_eq!(chunks.len(), 1);
        assert_eq!(
            chunks[0],
            ("2026-01-01".to_string(), "2026-01-31".to_string())
        );
    }

    #[test]
    fn test_single_day_range() {
        let chunks = chunk_date_range("2026-06-15", "2026-06-15");
        assert_eq!(chunks.len(), 1);
        assert_eq!(
            chunks[0],
            ("2026-06-15".to_string(), "2026-06-15".to_string())
        );
    }

    #[test]
    fn test_two_month_range() {
        let chunks = chunk_date_range("2026-01-15", "2026-03-10");
        assert_eq!(chunks.len(), 3);
        assert_eq!(
            chunks[0],
            ("2026-01-15".to_string(), "2026-01-31".to_string())
        );
        assert_eq!(
            chunks[1],
            ("2026-02-01".to_string(), "2026-02-28".to_string())
        );
        assert_eq!(
            chunks[2],
            ("2026-03-01".to_string(), "2026-03-10".to_string())
        );
    }

    #[test]
    fn test_cross_year_range() {
        let chunks = chunk_date_range("2025-11-01", "2026-02-28");
        assert_eq!(chunks.len(), 4);
        assert_eq!(
            chunks[0],
            ("2025-11-01".to_string(), "2025-11-30".to_string())
        );
        assert_eq!(
            chunks[1],
            ("2025-12-01".to_string(), "2025-12-31".to_string())
        );
        assert_eq!(
            chunks[2],
            ("2026-01-01".to_string(), "2026-01-31".to_string())
        );
        assert_eq!(
            chunks[3],
            ("2026-02-01".to_string(), "2026-02-28".to_string())
        );
    }

    #[test]
    fn test_multi_year_range() {
        let chunks = chunk_date_range("2024-06-01", "2026-06-30");
        assert_eq!(chunks.len(), 25);
        assert_eq!(
            chunks[0],
            ("2024-06-01".to_string(), "2024-06-30".to_string())
        );
        assert_eq!(
            chunks[1],
            ("2024-07-01".to_string(), "2024-07-31".to_string())
        );
        // Last chunk should end at June 30, 2026
        assert_eq!(
            chunks[24],
            ("2026-06-01".to_string(), "2026-06-30".to_string())
        );
    }

    #[test]
    fn test_leap_year_feb() {
        let chunks = chunk_date_range("2024-02-01", "2024-02-29");
        assert_eq!(chunks.len(), 1);
        assert_eq!(
            chunks[0],
            ("2024-02-01".to_string(), "2024-02-29".to_string())
        );
    }

    #[test]
    fn test_full_year_range() {
        let chunks = chunk_date_range("2025-01-01", "2025-12-31");
        assert_eq!(chunks.len(), 12);
        assert_eq!(
            chunks[0],
            ("2025-01-01".to_string(), "2025-01-31".to_string())
        );
        assert_eq!(
            chunks[11],
            ("2025-12-01".to_string(), "2025-12-31".to_string())
        );
    }
}
