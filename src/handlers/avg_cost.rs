use actix_web::{get, web, HttpResponse};
use serde::Deserialize;

use crate::client::FireflyClient;
use crate::config::Config;
use crate::models::AvgCostMode;

#[derive(Deserialize)]
pub struct AvgCostQuery {
    budget_names: Vec<String>,
    mode: Option<String>,
    months: Option<u32>,
    account_ids: Option<String>,
}

/// GET endpoint for the average cost page
#[get("/avg-cost")]
pub async fn avg_cost_page(config: web::Data<Config>) -> HttpResponse {
    let html = std::fs::read_to_string("static/avg-cost.html")
        .unwrap_or_else(|_| include_str!("../../static/avg-cost.html").to_string());

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

/// GET endpoint for average cost API data
#[get("/api/budgets/avg-cost")]
pub async fn get_avg_cost(
    client: web::Data<FireflyClient>,
    query: web::Query<AvgCostQuery>,
) -> HttpResponse {
    let mode = match query.mode.as_deref() {
        Some("previous_year_same_month") => AvgCostMode::PreviousYearSameMonth,
        _ => AvgCostMode::LastNMonths,
    };

    let months_count = query.months.unwrap_or(6);

    let account_ids = query.account_ids.as_ref().map(|ids| {
        ids.split(',')
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .collect::<Vec<String>>()
    });

    let budget_names = query.budget_names.clone();

    match client
        .get_avg_cost(budget_names, mode, months_count, account_ids)
        .await
    {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "message": e
        })),
    }
}
