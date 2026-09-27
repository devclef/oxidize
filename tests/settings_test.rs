/// Tests for the runtime Settings feature (/settings page + /api/settings)
/// and the Monthly Summary on/off switch:
/// - defaults (monthly summary disabled by default)
/// - pure nav-stripping helper
/// - route registration in main.rs
/// - end-to-end: disabled by default (page + API 404, nav link hidden),
///   PATCH toggles it on (page served, nav link restored)
#[cfg(test)]
mod tests {
    use actix_web::test as awt;
    use actix_web::{web, App};

    use oxidize::client::FireflyClient;
    use oxidize::config::{Config, FireflyUrl};
    use oxidize::handlers::index::index;
    use oxidize::handlers::settings::{get_settings_api, settings_page, update_settings_api};
    use oxidize::handlers::strip_summary_nav;
    use oxidize::handlers::summary::{get_month_summary_api, summary_page};
    use oxidize::models::{Settings, SettingsUpdate};
    use oxidize::storage::Storage;
    use serde_json::json;
    use std::sync::Once;

    /// Initialize the storage layer once per test binary (DATA_DIR is a
    /// process-wide OnceLock, so all tests here share one temp database).
    fn init_storage_once() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let dir = format!("/tmp/oxidize-settings-test-{}", std::process::id());
            let _ = std::fs::remove_dir_all(&dir);
            oxidize::storage::init_data_dir(dir);
        });
    }

    fn make_test_config() -> Config {
        Config {
            firefly_url: FireflyUrl::validate("http://127.0.0.1:1".to_string()).unwrap(),
            firefly_token: "test_token".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            account_types: vec!["asset".to_string()],
            auto_fetch_accounts: false,
            data_dir: "/tmp".to_string(),
            cache_ttl: 300,
            time_ranges: vec!["30d".to_string()],
            default_time_range: "30d".to_string(),
        }
    }

    macro_rules! build_service {
        () => {{
            init_storage_once();
            awt::init_service(
                App::new()
                    .app_data(web::Data::new(FireflyClient::new(make_test_config())))
                    .app_data(web::Data::new(make_test_config()))
                    .service(settings_page)
                    .service(get_settings_api)
                    .service(update_settings_api)
                    .service(summary_page)
                    .service(get_month_summary_api)
                    .route("/", web::get().to(index)),
            )
            .await
        }};
    }

    // ── Defaults & pure helpers ─────────────────────────────────────────

    #[test]
    fn test_monthly_summary_disabled_by_default() {
        let s = Settings::default();
        assert!(!s.monthly_summary_enabled);
    }

    #[test]
    fn test_settings_update_applies_only_provided_fields() {
        let mut s = Settings {
            monthly_summary_enabled: false,
        };
        SettingsUpdate::default().apply(&mut s);
        assert!(!s.monthly_summary_enabled, "empty update must be a no-op");

        SettingsUpdate {
            monthly_summary_enabled: Some(true),
        }
        .apply(&mut s);
        assert!(s.monthly_summary_enabled);
    }

    #[test]
    fn test_settings_rows_roundtrip_and_defaults() {
        let rows = Settings {
            monthly_summary_enabled: true,
        }
        .to_rows();
        assert_eq!(
            rows.get("monthly_summary_enabled").map(String::as_str),
            Some("true")
        );

        let parsed = Settings::from_rows(&rows);
        assert!(parsed.monthly_summary_enabled);

        // Missing keys fall back to defaults.
        assert!(!Settings::from_rows(&std::collections::HashMap::new()).monthly_summary_enabled);
        assert!(
            Settings::from_rows(
                &[("monthly_summary_enabled".to_string(), "1".to_string())]
                    .into_iter()
                    .collect()
            )
            .monthly_summary_enabled
        );
    }

    #[test]
    fn test_strip_summary_nav_removes_both_variants() {
        let html = "<nav>\
            <a href=\"/\">Widget Builder</a>\
            <a href=\"/summary\">Monthly Summary</a>\
            <a href=\"/settings\">Settings</a></nav>";
        let out = strip_summary_nav(html);
        assert!(!out.contains("/summary"));
        assert!(out.contains("/settings"));
        assert!(out.contains("Widget Builder"));

        // The "active" variant is stripped too.
        let active = "<a href=\"/summary\" class=\"active\">Monthly Summary</a>";
        assert_eq!(strip_summary_nav(active), "");
    }

    // ── Route registration ──────────────────────────────────────────────

    #[test]
    fn test_settings_routes_registered_in_main() {
        let main_rs = include_str!("../src/main.rs");
        assert!(
            main_rs.contains("settings_page"),
            "settings page route should be registered"
        );
        assert!(
            main_rs.contains("get_settings_api"),
            "GET /api/settings should be registered"
        );
        assert!(
            main_rs.contains("update_settings_api"),
            "PATCH /api/settings should be registered"
        );
    }

    // ── End-to-end gating ───────────────────────────────────────────────

    /// One test drives the whole sequence so the shared settings row is
    /// never mutated by parallel tests.
    #[tokio::test]
    async fn test_monthly_summary_gating_end_to_end() {
        let service = build_service!();

        // Start from the default state: disabled.
        init_storage_once();
        assert!(Storage::save_settings(&Settings::default()).is_ok());

        // 1) Disabled by default: API reports false, page + summary API 404,
        //    and the nav link is hidden on the other pages.
        let resp = awt::call_service(
            &service,
            awt::TestRequest::get().uri("/api/settings").to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = awt::read_body_json(resp).await;
        assert_eq!(body["monthly_summary_enabled"], json!(false));

        let resp = awt::call_service(
            &service,
            awt::TestRequest::get().uri("/summary").to_request(),
        )
        .await;
        assert_eq!(resp.status(), 404, "summary page must 404 while disabled");

        let resp = awt::call_service(
            &service,
            awt::TestRequest::get()
                .uri("/api/summary/month")
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 404, "summary API must 404 while disabled");

        let resp = awt::call_service(&service, awt::TestRequest::get().uri("/").to_request()).await;
        assert_eq!(resp.status(), 200);
        let body = awt::read_body(resp).await;
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(
            !html.contains("Monthly Summary</a>"),
            "nav link must be hidden while disabled"
        );
        assert!(
            html.contains("Settings</a>"),
            "settings nav link must exist"
        );

        // The settings page itself must be reachable while disabled.
        let resp = awt::call_service(
            &service,
            awt::TestRequest::get().uri("/settings").to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        let body = awt::read_body(resp).await;
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(
            html.contains("Beta"),
            "settings page must carry the beta warning"
        );
        assert!(
            !html.contains("Monthly Summary</a>"),
            "summary nav link must be hidden on the settings page while disabled"
        );

        // 2) Enable it via PATCH.
        let resp = awt::call_service(
            &service,
            awt::TestRequest::patch()
                .uri("/api/settings")
                .insert_header(("content-type", "application/json"))
                .set_payload(json!({ "monthly_summary_enabled": true }).to_string())
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = awt::read_body_json(resp).await;
        assert_eq!(body["monthly_summary_enabled"], json!(true));

        // 3) Enabled: page and API are served again, nav link restored.
        let resp = awt::call_service(
            &service,
            awt::TestRequest::get().uri("/summary").to_request(),
        )
        .await;
        assert_eq!(
            resp.status(),
            200,
            "summary page must be served when enabled"
        );
        let body = awt::read_body(resp).await;
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(
            html.contains("Monthly Summary</a>"),
            "nav link must be back when enabled"
        );

        let resp = awt::call_service(&service, awt::TestRequest::get().uri("/").to_request()).await;
        let body = awt::read_body(resp).await;
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("Monthly Summary</a>"));

        // 4) PATCH with an empty body is a no-op (nothing reverts).
        let resp = awt::call_service(
            &service,
            awt::TestRequest::patch()
                .uri("/api/settings")
                .insert_header(("content-type", "application/json"))
                .set_payload("{}")
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = awt::read_body_json(resp).await;
        assert_eq!(body["monthly_summary_enabled"], json!(true));

        // Leave the shared temp database in the default (disabled) state.
        let _ = Storage::save_settings(&Settings::default());
    }
}
