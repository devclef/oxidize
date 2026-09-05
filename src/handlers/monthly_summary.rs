use actix_web::{get, web, HttpRequest, HttpResponse, Responder};

use crate::client::FireflyClient;
use crate::config::Config;

/// GET endpoint for the monthly summary HTML page
#[get("/monthly-summary")]
pub async fn monthly_summary_page(config: web::Data<Config>) -> HttpResponse {
    let html = std::fs::read_to_string("static/monthly-summary.html")
        .unwrap_or_else(|_| include_str!("../../static/monthly-summary.html").to_string());

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

/// GET endpoint for monthly summary JSON data
#[get("/api/monthly-summary")]
pub async fn get_monthly_summary(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let exclusions = crate::handlers::parse_exclusions(&params);

    let mut month_opt: Option<String> = None;
    for (k, v) in &params {
        if k == "month" {
            month_opt = Some(v.clone());
        }
    }

    let month = month_opt.unwrap_or_else(|| {
        chrono::Local::now().format("%Y-%m").to_string()
    });

    match client.get_monthly_summary(&month, &exclusions).await {
        Ok(summary) => HttpResponse::Ok().json(summary),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "message": e.to_string()
        })),
    }
}
