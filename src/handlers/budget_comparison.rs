use actix_web::{get, web, HttpResponse};

use crate::config::Config;

/// True when the Budget Comparison feature is enabled in the settings.
/// (Unreadable settings are treated as enabled: the default is on.)
fn budget_comparison_enabled() -> bool {
    crate::storage::Storage::get_settings()
        .map(|s| s.budget_comparison_enabled)
        .unwrap_or(true)
}

/// GET endpoint for the budget comparison page. Returns 404 when the
/// feature is disabled (toggle under /settings).
#[get("/budget-comparison")]
pub async fn budget_comparison(config: web::Data<Config>) -> HttpResponse {
    // Env vars are only the defaults: apply runtime settings from the
    // /settings page (Firefly connection, account types, cache TTL, time ranges).
    let config = crate::config::Config::effective(&config);
    if !budget_comparison_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Budget Comparison is disabled. Enable it under Settings."
        }));
    }

    // Read HTML from filesystem at runtime
    let html = std::fs::read_to_string("static/budget-comparison.html")
        .unwrap_or_else(|_| include_str!("../../static/budget-comparison.html").to_string());

    let config_script = format!(
        r#"
    <script>
        window.OXIDIZE_CONFIG = {{
            accountTypes: {}
        }};
    </script>
    "#,
        serde_json::to_string(&config.account_types).unwrap_or_else(|_| "[]".to_string())
    );

    let html = html.replace("</head>", &format!("{} </head>", config_script));

    let html = crate::handlers::hide_disabled_nav(&html);

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html.to_string())
}
