use actix_web::{get, web, HttpResponse};

use crate::config::Config;

/// GET endpoint for the budget comparison page
#[get("/budget-comparison")]
pub async fn budget_comparison(config: web::Data<Config>) -> HttpResponse {
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

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html.to_string())
}
