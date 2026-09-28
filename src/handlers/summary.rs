//! Monthly Summary page and API (see src/models/summary.rs).
//!
//! The whole feature is optional: it is disabled by default and only
//! served when `monthly_summary_enabled` is on in the runtime settings
//! (changeable at /settings). When disabled, the page and its API both
//! return 404 and the nav link is hidden on every page.

use crate::client::FireflyClient;
use crate::config::Config;
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use chrono::Datelike;

/// True when the Monthly Summary feature is enabled in the settings.
/// (Unreadable settings are treated as disabled: the default is off.)
fn summary_enabled() -> bool {
    crate::storage::Storage::get_settings()
        .map(|s| s.monthly_summary_enabled)
        .unwrap_or(false)
}

/// GET /summary — the Monthly Summary page. Returns 404 when the feature
/// is disabled.
#[get("/summary")]
pub async fn summary_page(config: web::Data<Config>) -> HttpResponse {
    // Env vars are only the defaults: apply runtime settings from the
    // /settings page (Firefly connection, account types, cache TTL, time ranges).
    let config = crate::config::Config::effective(&config);
    if !summary_enabled() {
        return HttpResponse::NotFound()
            .json(serde_json::json!({ "message": "Monthly Summary is disabled. Enable it under Settings." }));
    }

    // Read HTML from filesystem at runtime, fall back to the compiled copy.
    let html = std::fs::read_to_string("static/summary.html")
        .unwrap_or_else(|_| include_str!("../../static/summary.html").to_string());

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

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

/// GET /api/summary/month — all data for one calendar month.
///
/// Query params:
///   year (optional, defaults to current), month (1-12, optional, defaults to
///   current), accounts[] (optional: only these accounts),
///   exclude_accounts[] (optional: drop transactions touching these
///   accounts; wins over accounts[] on overlap), exclude_categories[],
///   exclude_budgets[] (same semantics as the chart endpoints).
///
/// Future months are rejected with 400; upstream failures with 500
/// ({ "message": ... }).
#[get("/api/summary/month")]
pub async fn get_month_summary_api(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    if !summary_enabled() {
        return HttpResponse::NotFound()
            .json(serde_json::json!({ "message": "Monthly Summary is disabled. Enable it under Settings." }));
    }

    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();
    let exclusions = crate::handlers::parse_exclusions(&params);

    let now = chrono::Utc::now();
    let mut year = now.year();
    let mut month = now.month();
    let mut account_ids: Vec<String> = Vec::new();
    let mut excluded_account_ids: Vec<String> = Vec::new();

    for (k, v) in &params {
        match k.as_str() {
            "year" => {
                if let Ok(y) = v.parse::<i32>() {
                    year = y;
                }
            }
            "month" => {
                if let Ok(m) = v.parse::<u32>() {
                    month = m;
                }
            }
            "accounts[]" | "accounts" => account_ids.push(v.clone()),
            "exclude_accounts[]" | "exclude_accounts" => excluded_account_ids.push(v.clone()),
            _ => {}
        }
    }

    let ids = if account_ids.is_empty() {
        None
    } else {
        Some(account_ids)
    };
    let excl_ids = if excluded_account_ids.is_empty() {
        None
    } else {
        Some(excluded_account_ids)
    };

    match client
        .get_month_summary(year, month, ids, excl_ids, &exclusions)
        .await
    {
        Ok(summary) => HttpResponse::Ok().json(summary),
        Err(e) => {
            let status = if e.contains("Invalid") || e.contains("future") {
                actix_web::http::StatusCode::BAD_REQUEST
            } else {
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR
            };
            HttpResponse::build(status).json(serde_json::json!({ "message": e }))
        }
    }
}
