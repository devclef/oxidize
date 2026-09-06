//! Monthly Summary page and API (see src/models/summary.rs).

use chrono::Datelike;
use crate::client::FireflyClient;
use crate::config::Config;
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};

/// GET /summary — the Monthly Summary page.
#[get("/summary")]
pub async fn summary_page(config: web::Data<Config>) -> HttpResponse {
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
///   current), accounts[] (optional account filter), exclude_categories[],
///   exclude_budgets[] (same semantics as the chart endpoints).
///
/// Future months are rejected with 400; upstream failures with 500
/// ({ "message": ... }).
#[get("/api/summary/month")]
pub async fn get_month_summary_api(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();
    let exclusions = crate::handlers::parse_exclusions(&params);

    let now = chrono::Utc::now();
    let mut year = now.year();
    let mut month = now.month();
    let mut account_ids: Vec<String> = Vec::new();

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
            _ => {}
        }
    }

    let ids = if account_ids.is_empty() {
        None
    } else {
        Some(account_ids)
    };

    match client
        .get_month_summary(year, month, ids, &exclusions)
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
