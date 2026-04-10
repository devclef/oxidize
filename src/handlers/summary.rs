use actix_web::{get, web, HttpResponse};
use chrono::Datelike;
use serde::Deserialize;

use crate::client::FireflyClient;
use crate::config::Config;

#[derive(Deserialize)]
pub struct SummaryQuery {
    month: Option<u32>,
    year: Option<i32>,
    account_ids: Option<String>,
    account_type: Option<String>,
}

/// GET endpoint for monthly summary data
#[get("/api/summary/monthly")]
pub async fn get_monthly_summary(
    client: web::Data<FireflyClient>,
    query: web::Query<SummaryQuery>,
) -> HttpResponse {
    // Default to current month/year if not provided
    let now = chrono::Utc::now();
    let month = query.month.unwrap_or(now.month());
    let year = query.year.unwrap_or(now.year());

    // Parse account IDs if provided
    let account_ids = query.account_ids.as_ref().map(|ids| {
        ids.split(',')
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .collect()
    });

    match client
        .get_monthly_summary(month, year, account_ids, query.account_type.clone())
        .await
    {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for the summary page
#[get("/summary")]
pub async fn summary(config: web::Data<Config>) -> HttpResponse {
    let html = include_str!("../../static/summary.html");

    // Inject config as a script tag before the closing head tag
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
        .body(html.to_string())
}
