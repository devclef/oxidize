/// Tests for the runtime Settings feature (/settings page + /api/settings)
/// and the feature on/off switches (Monthly Summary off by default; Sankey
/// Flow, Reimbursements, Budget Comparison and Avg Cost on by default):
/// - defaults
/// - pure nav-stripping helpers
/// - route registration in main.rs
/// - end-to-end: disabled features 404 with nav links hidden, PATCH
///   toggles features on/off (pages served again, nav links restored)
#[cfg(test)]
mod tests {
    use actix_web::test as awt;
    use actix_web::{web, App};

    use oxidize::client::FireflyClient;
    use oxidize::config::{Config, FireflyUrl};
    use oxidize::handlers::account::get_budget_comparison;
    use oxidize::handlers::avg_cost::{avg_cost_page, get_avg_cost};
    use oxidize::handlers::budget_comparison::budget_comparison;
    use oxidize::handlers::index::index;
    use oxidize::handlers::reimbursement::{get_reimbursements_summary_api, reimbursements_page};
    use oxidize::handlers::sankey::{get_sankey_flows, sankey_page};
    use oxidize::handlers::settings::{get_settings_api, settings_page, update_settings_api};
    use oxidize::handlers::summary::{get_month_summary_api, summary_page};
    use oxidize::handlers::{strip_nav_link, strip_summary_nav};
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
                    .service(sankey_page)
                    .service(get_sankey_flows)
                    .service(reimbursements_page)
                    .service(get_reimbursements_summary_api)
                    .service(budget_comparison)
                    .service(get_budget_comparison)
                    .service(avg_cost_page)
                    .service(get_avg_cost)
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
    fn test_optional_pages_enabled_by_default() {
        let s = Settings::default();
        assert!(s.sankey_enabled);
        assert!(s.reimbursements_enabled);
        assert!(s.budget_comparison_enabled);
        assert!(s.avg_cost_enabled);

        // And the same defaults apply to rows with missing keys.
        let empty = std::collections::HashMap::new();
        let s = Settings::from_rows(&empty);
        assert!(s.sankey_enabled);
        assert!(s.reimbursements_enabled);
        assert!(s.budget_comparison_enabled);
        assert!(s.avg_cost_enabled);
        assert!(!s.monthly_summary_enabled);
    }

    #[test]
    fn test_settings_update_applies_only_provided_fields() {
        let mut s = Settings {
            monthly_summary_enabled: false,
            ..Default::default()
        };
        SettingsUpdate::default().apply(&mut s);
        assert!(!s.monthly_summary_enabled, "empty update must be a no-op");
        assert!(s.sankey_enabled, "empty update must be a no-op");

        SettingsUpdate {
            monthly_summary_enabled: Some(true),
            avg_cost_enabled: Some(false),
            ..Default::default()
        }
        .apply(&mut s);
        assert!(s.monthly_summary_enabled);
        assert!(!s.avg_cost_enabled);
        assert!(s.sankey_enabled, "unprovided fields must stay untouched");
    }

    #[test]
    fn test_settings_rows_roundtrip_and_defaults() {
        let rows = Settings {
            monthly_summary_enabled: true,
            sankey_enabled: false,
            ..Default::default()
        }
        .to_rows();
        assert_eq!(
            rows.get("monthly_summary_enabled").map(String::as_str),
            Some("true")
        );
        assert_eq!(
            rows.get("sankey_enabled").map(String::as_str),
            Some("false")
        );
        assert_eq!(
            rows.get("avg_cost_enabled").map(String::as_str),
            Some("true")
        );

        let parsed = Settings::from_rows(&rows);
        assert!(parsed.monthly_summary_enabled);
        assert!(!parsed.sankey_enabled);
        assert!(parsed.reimbursements_enabled);
        assert!(parsed.budget_comparison_enabled);
        assert!(parsed.avg_cost_enabled);

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

    #[test]
    fn test_strip_nav_link_removes_both_variants() {
        let html = "<nav>\
            <a href=\"/sankey\">Sankey Flow</a>\
            <a href=\"/reimbursements\" class=\"active\">Reimbursements</a>\
            <a href=\"/budget-comparison\">Budget Comparison</a>\
            <a href=\"/avg-cost\">Avg Cost</a>\
            <a href=\"/dashboard\">Dashboard</a></nav>";

        let out = strip_nav_link(html, "/sankey", "Sankey Flow");
        assert!(!out.contains("/sankey"));
        assert!(out.contains("/reimbursements"));
        assert!(out.contains("/dashboard"));

        let out = strip_nav_link(&out, "/budget-comparison", "Budget Comparison");
        assert!(!out.contains("/budget-comparison"));

        let out = strip_nav_link(&out, "/avg-cost", "Avg Cost");
        assert!(!out.contains("/avg-cost"));

        // The "active" variant is stripped too.
        let active = "<a href=\"/reimbursements\" class=\"active\">Reimbursements</a>";
        assert_eq!(
            strip_nav_link(active, "/reimbursements", "Reimbursements"),
            ""
        );

        // Unknown links are left untouched.
        assert_eq!(
            strip_nav_link("<a href=\"/x\">Y</a>", "/x", "Other"),
            "<a href=\"/x\">Y</a>"
        );
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
    async fn test_feature_gating_end_to_end() {
        let service = build_service!();

        // Start from the default state: monthly summary disabled, all other
        // optional pages enabled.
        init_storage_once();
        assert!(Storage::save_settings(&Settings::default()).is_ok());

        // 1) Defaults: API reports monthly=false and the four pages enabled;
        //    /summary 404s while the other pages are served.
        let resp = awt::call_service(
            &service,
            awt::TestRequest::get().uri("/api/settings").to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = awt::read_body_json(resp).await;
        assert_eq!(body["monthly_summary_enabled"], json!(false));
        assert_eq!(body["sankey_enabled"], json!(true));
        assert_eq!(body["reimbursements_enabled"], json!(true));
        assert_eq!(body["budget_comparison_enabled"], json!(true));
        assert_eq!(body["avg_cost_enabled"], json!(true));

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

        for (uri, what) in [
            ("/sankey", "sankey page"),
            ("/reimbursements", "reimbursements page"),
            ("/budget-comparison", "budget comparison page"),
            ("/avg-cost", "avg cost page"),
        ] {
            let resp =
                awt::call_service(&service, awt::TestRequest::get().uri(uri).to_request()).await;
            assert_eq!(resp.status(), 200, "{what} must be served by default");
        }

        let resp = awt::call_service(&service, awt::TestRequest::get().uri("/").to_request()).await;
        assert_eq!(resp.status(), 200);
        let body = awt::read_body(resp).await;
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(
            !html.contains("Monthly Summary</a>"),
            "nav link must be hidden while disabled"
        );
        assert!(
            html.contains("Sankey Flow</a>"),
            "sankey nav link visible by default"
        );
        assert!(
            html.contains("Reimbursements</a>"),
            "reimbursements nav link visible by default"
        );
        assert!(
            html.contains("Budget Comparison</a>"),
            "budget comparison nav link visible by default"
        );
        assert!(
            html.contains("Avg Cost</a>"),
            "avg cost nav link visible by default"
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
        assert!(
            html.contains("monthly-summary-toggle"),
            "settings page must offer a monthly summary toggle"
        );
        assert!(
            html.contains("sankey-toggle"),
            "settings page must offer a sankey toggle"
        );
        assert!(
            html.contains("reimbursements-toggle"),
            "settings page must offer a reimbursements toggle"
        );
        assert!(
            html.contains("budget-comparison-toggle"),
            "settings page must offer a budget comparison toggle"
        );
        assert!(
            html.contains("avg-cost-toggle"),
            "settings page must offer an avg cost toggle"
        );

        // 2) Enable the monthly summary via PATCH.
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
        assert_eq!(body["sankey_enabled"], json!(true));

        // 5) Disable all four default-on features at once.
        let resp = awt::call_service(
            &service,
            awt::TestRequest::patch()
                .uri("/api/settings")
                .insert_header(("content-type", "application/json"))
                .set_payload(
                    json!({
                        "sankey_enabled": false,
                        "reimbursements_enabled": false,
                        "budget_comparison_enabled": false,
                        "avg_cost_enabled": false
                    })
                    .to_string(),
                )
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = awt::read_body_json(resp).await;
        assert_eq!(body["sankey_enabled"], json!(false));
        assert_eq!(body["reimbursements_enabled"], json!(false));
        assert_eq!(body["budget_comparison_enabled"], json!(false));
        assert_eq!(body["avg_cost_enabled"], json!(false));

        for (uri, what) in [
            ("/sankey", "sankey page"),
            ("/reimbursements", "reimbursements page"),
            ("/budget-comparison", "budget comparison page"),
            ("/avg-cost", "avg cost page"),
        ] {
            let resp =
                awt::call_service(&service, awt::TestRequest::get().uri(uri).to_request()).await;
            assert_eq!(resp.status(), 404, "{what} must 404 while disabled");
        }

        // The pages' own APIs 404 as well (the sankey flows endpoint is the
        // exception: the dashboard sankey widget shares it).
        let resp = awt::call_service(
            &service,
            awt::TestRequest::get()
                .uri("/api/reimbursements/summary")
                .to_request(),
        )
        .await;
        assert_eq!(
            resp.status(),
            404,
            "reimbursements API must 404 while disabled"
        );

        let resp = awt::call_service(
            &service,
            awt::TestRequest::get()
                .uri("/api/budgets/comparison")
                .to_request(),
        )
        .await;
        assert_eq!(
            resp.status(),
            404,
            "budget comparison API must 404 while disabled"
        );

        let resp = awt::call_service(
            &service,
            awt::TestRequest::get()
                .uri("/api/budgets/avg-cost")
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 404, "avg cost API must 404 while disabled");

        let resp = awt::call_service(
            &service,
            awt::TestRequest::get()
                .uri("/api/sankey/flows")
                .to_request(),
        )
        .await;
        assert_ne!(
            resp.status(),
            404,
            "sankey flows API stays available for dashboard widgets"
        );

        // Nav links are hidden everywhere (incl. the settings page) while
        // the features are off; the enabled ones stay visible.
        for uri in ["/", "/settings"] {
            let resp =
                awt::call_service(&service, awt::TestRequest::get().uri(uri).to_request()).await;
            let body = awt::read_body(resp).await;
            let html = String::from_utf8(body.to_vec()).unwrap();
            assert!(!html.contains("Sankey Flow</a>"), "sankey nav link hidden");
            assert!(
                !html.contains("Reimbursements</a>"),
                "reimbursements nav link hidden"
            );
            assert!(
                !html.contains("Budget Comparison</a>"),
                "budget comparison nav link hidden"
            );
            assert!(!html.contains("Avg Cost</a>"), "avg cost nav link hidden");
            assert!(
                html.contains("Monthly Summary</a>"),
                "enabled monthly summary link stays visible"
            );
            assert!(
                html.contains("Settings</a>"),
                "settings nav link must exist"
            );
        }

        // 6) Re-enable the four features: pages and APIs are served again.
        let resp = awt::call_service(
            &service,
            awt::TestRequest::patch()
                .uri("/api/settings")
                .insert_header(("content-type", "application/json"))
                .set_payload(
                    json!({
                        "sankey_enabled": true,
                        "reimbursements_enabled": true,
                        "budget_comparison_enabled": true,
                        "avg_cost_enabled": true
                    })
                    .to_string(),
                )
                .to_request(),
        )
        .await;
        assert_eq!(resp.status(), 200);

        for (uri, what) in [
            ("/sankey", "sankey page"),
            ("/reimbursements", "reimbursements page"),
            ("/budget-comparison", "budget comparison page"),
            ("/avg-cost", "avg cost page"),
        ] {
            let resp =
                awt::call_service(&service, awt::TestRequest::get().uri(uri).to_request()).await;
            assert_eq!(
                resp.status(),
                200,
                "{what} must be served again when re-enabled"
            );
        }

        let resp = awt::call_service(&service, awt::TestRequest::get().uri("/").to_request()).await;
        let body = awt::read_body(resp).await;
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("Sankey Flow</a>"));
        assert!(html.contains("Reimbursements</a>"));
        assert!(html.contains("Budget Comparison</a>"));
        assert!(html.contains("Avg Cost</a>"));

        // Leave the shared temp database in the default state.
        let _ = Storage::save_settings(&Settings::default());
    }
}
