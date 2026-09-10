/// Tests for the "Saved this Month" stat tile.
///
/// Covers:
/// - The month-boundary math (current partial month vs previous full month,
///   including the January -> December-of-previous-year rollover).
/// - Route/handler registration so the endpoint cannot 404.
/// - The SavedThisMonth payload shape (saved = earned - spent, difference).
#[cfg(test)]
mod tests {
    use chrono::NaiveDate;
    use oxidize::models::{MonthStats, SavedThisMonth};

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    // ── Month range math ───────────────────────────────────────────────

    #[test]
    fn test_ranges_mid_year() {
        let (cur_start, cur_end, prev_start, prev_end) =
            oxidize::client::FireflyClient::saved_this_month_ranges(d("2026-09-10"));
        assert_eq!(cur_start, d("2026-09-01"));
        assert_eq!(cur_end, d("2026-09-10"));
        assert_eq!(prev_start, d("2026-08-01"));
        assert_eq!(prev_end, d("2026-08-31"));
    }

    #[test]
    fn test_ranges_first_day_of_month() {
        let (cur_start, cur_end, prev_start, prev_end) =
            oxidize::client::FireflyClient::saved_this_month_ranges(d("2026-03-01"));
        assert_eq!(cur_start, d("2026-03-01"));
        // A partial month that is only one day long
        assert_eq!(cur_end, d("2026-03-01"));
        assert_eq!(prev_start, d("2026-02-01"));
        // 2026 is not a leap year
        assert_eq!(prev_end, d("2026-02-28"));
    }

    #[test]
    fn test_ranges_january_rolls_back_a_year() {
        let (cur_start, cur_end, prev_start, prev_end) =
            oxidize::client::FireflyClient::saved_this_month_ranges(d("2026-01-05"));
        assert_eq!(cur_start, d("2026-01-01"));
        assert_eq!(cur_end, d("2026-01-05"));
        // Previous month is December of the prior year
        assert_eq!(prev_start, d("2025-12-01"));
        assert_eq!(prev_end, d("2025-12-31"));
    }

    // ── Payload shape ──────────────────────────────────────────────────

    #[test]
    fn test_saved_payload_math_and_serialization() {
        let payload = SavedThisMonth {
            currency_symbol: Some("$".to_string()),
            currency_code: Some("USD".to_string()),
            current_month: MonthStats {
                label: "September 2026".to_string(),
                earned: 5000.0,
                spent: 3200.0,
                saved: 1800.0,
            },
            previous_month: MonthStats {
                label: "August 2026".to_string(),
                earned: 4800.0,
                spent: 3500.0,
                saved: 1300.0,
            },
            difference: 500.0,
            current_month_start: "2026-09-01".to_string(),
            current_month_end: "2026-09-10".to_string(),
        };

        // saved must equal earned - spent for both months
        assert!((payload.current_month.saved
            - (payload.current_month.earned - payload.current_month.spent))
            .abs()
            < 1e-9);
        assert!((payload.previous_month.saved
            - (payload.previous_month.earned - payload.previous_month.spent))
            .abs()
            < 1e-9);
        // difference must equal current.saved - previous.saved
        assert!((payload.difference
            - (payload.current_month.saved - payload.previous_month.saved))
            .abs()
            < 1e-9);

        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["current_month"]["saved"], 1800.0);
        assert_eq!(json["previous_month"]["saved"], 1300.0);
        assert_eq!(json["difference"], 500.0);
        assert_eq!(json["current_month_start"], "2026-09-01");
        assert_eq!(json["current_month_end"], "2026-09-10");

        // Round-trips back
        let back: SavedThisMonth = serde_json::from_value(json).unwrap();
        assert_eq!(back.current_month.label, "September 2026");
        assert_eq!(back.previous_month.label, "August 2026");
    }

    // ── Route / handler registration ───────────────────────────────────

    #[test]
    fn test_saved_this_month_route_registered() {
        let main_rs = include_str!("../src/main.rs");
        assert!(
            main_rs.contains("handlers::account::get_saved_this_month"),
            "get_saved_this_month must be registered in main.rs"
        );
    }

    #[test]
    fn test_saved_this_month_handler_exists() {
        let account_rs = include_str!("../src/handlers/account.rs");
        assert!(
            account_rs.contains("pub async fn get_saved_this_month"),
            "get_saved_this_month handler must exist"
        );
        assert!(
            account_rs.contains("#[get(\"/api/saved-this-month\")]"),
            "route attribute /api/saved-this-month must exist"
        );
        assert!(
            account_rs.contains("client.get_saved_this_month"),
            "handler must call the client method"
        );
    }
}
