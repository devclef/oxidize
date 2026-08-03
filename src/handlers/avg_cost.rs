use actix_web::{get, web, HttpRequest, HttpResponse};

use crate::client::FireflyClient;
use crate::config::Config;
use crate::models::AvgCostMode;

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
pub async fn get_avg_cost(client: web::Data<FireflyClient>, req: HttpRequest) -> HttpResponse {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut budget_names: Vec<String> = Vec::new();
    let mut mode: Option<String> = None;
    let mut months: Option<u32> = None;
    let mut account_ids: Vec<String> = Vec::new();
    let mut target_month: Option<u32> = None;
    let mut target_year: Option<i32> = None;

    for (k, v) in params {
        match k.as_str() {
            "budget_names" => budget_names.push(v),
            "mode" => mode = Some(v),
            "months" => {
                if let Ok(m) = v.parse::<u32>() {
                    months = Some(m);
                }
            }
            "account_ids" => {
                for id in v.split(',').filter(|s| !s.trim().is_empty()) {
                    account_ids.push(id.trim().to_string());
                }
            }
            "month" => {
                if let Ok(m) = v.parse::<u32>() {
                    target_month = Some(m);
                }
            }
            "year" => {
                if let Ok(y) = v.parse::<i32>() {
                    target_year = Some(y);
                }
            }
            _ => {}
        }
    }

    let avg_mode = match mode.as_deref() {
        Some("previous_year_same_month") => AvgCostMode::PreviousYearSameMonth,
        _ => AvgCostMode::LastNMonths,
    };

    let months_count = months.unwrap_or(6);

    let account_ids_opt = if account_ids.is_empty() {
        None
    } else {
        Some(account_ids)
    };

    match client
        .get_avg_cost(budget_names, avg_mode, months_count, account_ids_opt, target_month, target_year)
        .await
    {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "message": e
        })),
    }
}
