/// Widgets can follow a relative date range ("Last 30 days", "custom:6:months")
/// with optional end-date rounding instead of fixed dates
/// (docs/chart-options-audit.md, findings O1 + O2):
/// - `relative_range` / `round_end_mode` persist through create, list and
///   update, and legacy widgets read back as `None`
/// - invalid values are rejected with 400 on create and update
///
/// The storage layer is process-wide, so the test uses a process-specific
/// temp database.
#[cfg(test)]
mod tests {
    use actix_web::test as awt;
    use actix_web::App;
    use oxidize::handlers::widget::{create_widget, list_widgets, update_widget};
    use oxidize::models::Widget;
    use oxidize::storage::Storage;
    use serde_json::json;
    use std::sync::Once;

    fn init_storage_once() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let dir = format!("/tmp/oxidize-relative-range-test-{}", std::process::id());
            let _ = std::fs::remove_dir_all(&dir);
            oxidize::storage::init_data_dir(dir);
        });
    }

    macro_rules! build_app {
        () => {{
            init_storage_once();
            awt::init_service(
                App::new()
                    .service(create_widget)
                    .service(update_widget)
                    .service(list_widgets),
            )
            .await
        }};
    }

    fn find(id: &str) -> Widget {
        Storage::get_all_widgets()
            .unwrap()
            .into_iter()
            .find(|w| w.id == id)
            .expect("widget persisted")
    }

    #[actix_web::test]
    async fn relative_range_and_round_end_round_trip() {
        let app = build_app!();
        let widget = json!({
            "id": "rel-range-1",
            "name": "Last 3 months",
            "accounts": ["1"],
            "start_date": "2026-07-25",
            "end_date": "2026-10-31",
            "relative_range": "3m",
            "round_end_mode": "end_of_current_month",
            "dashboard_ids": ["default"]
        });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&widget)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 201);

        let req = awt::TestRequest::get().uri("/api/widgets").to_request();
        let widgets: Vec<Widget> = awt::call_and_read_body_json(&app, req).await;
        let got = widgets.iter().find(|w| w.id == "rel-range-1").unwrap();
        assert_eq!(got.relative_range.as_deref(), Some("3m"));
        assert_eq!(got.round_end_mode.as_deref(), Some("end_of_current_month"));
        // The fixed dates are kept as the fallback
        assert_eq!(got.start_date.as_deref(), Some("2026-07-25"));

        // Switch to a custom relative range without rounding
        let mut updated = got.clone();
        updated.relative_range = Some("custom:6:weeks".into());
        updated.round_end_mode = None;
        let req = awt::TestRequest::put()
            .uri("/api/widgets/rel-range-1")
            .set_json(&updated)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 200);
        let got = find("rel-range-1");
        assert_eq!(got.relative_range.as_deref(), Some("custom:6:weeks"));
        assert_eq!(got.round_end_mode, None);

        // Back to fixed dates
        let mut fixed = got.clone();
        fixed.relative_range = None;
        let req = awt::TestRequest::put()
            .uri("/api/widgets/rel-range-1")
            .set_json(&fixed)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 200);
        assert_eq!(find("rel-range-1").relative_range, None);

        let _ = Storage::delete_widget("rel-range-1");
    }

    #[actix_web::test]
    async fn date_range_source_is_saved_on_create() {
        let app = build_app!();
        let widget = json!({
            "id": "rel-range-source",
            "name": "Inherits",
            "accounts": ["1"],
            "date_range_source": "dashboard",
            "dashboard_ids": ["default"]
        });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&widget)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 201);
        assert_eq!(
            find("rel-range-source").date_range_source.as_deref(),
            Some("dashboard")
        );
        let _ = Storage::delete_widget("rel-range-source");
    }

    #[actix_web::test]
    async fn legacy_widget_has_no_relative_range() {
        let app = build_app!();
        let widget = json!({
            "id": "rel-range-legacy",
            "name": "Legacy",
            "accounts": ["1"],
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "dashboard_ids": ["default"]
        });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&widget)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 201);
        let got = find("rel-range-legacy");
        assert_eq!(got.relative_range, None);
        assert_eq!(got.round_end_mode, None);
        let _ = Storage::delete_widget("rel-range-legacy");
    }

    #[actix_web::test]
    async fn invalid_values_are_rejected() {
        let app = build_app!();
        let bad_range = json!({
            "id": "rel-range-bad", "name": "Bad", "accounts": [],
            "relative_range": "since forever"
        });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&bad_range)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 400);

        let bad_mode = json!({
            "id": "rel-range-bad", "name": "Bad", "accounts": [],
            "relative_range": "30d", "round_end_mode": "end_of_decade"
        });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&bad_mode)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 400);

        // Nothing was stored, and updates are validated too
        assert!(Storage::get_all_widgets()
            .unwrap()
            .iter()
            .all(|w| w.id != "rel-range-bad"));
        let ok = json!({ "id": "rel-range-bad", "name": "Ok", "accounts": [] });
        let req = awt::TestRequest::post()
            .uri("/api/widgets")
            .set_json(&ok)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 201);
        let req = awt::TestRequest::put()
            .uri("/api/widgets/rel-range-bad")
            .set_json(&bad_mode)
            .to_request();
        assert_eq!(awt::call_service(&app, req).await.status(), 400);
        assert_eq!(find("rel-range-bad").round_end_mode, None);
        let _ = Storage::delete_widget("rel-range-bad");
    }
}
