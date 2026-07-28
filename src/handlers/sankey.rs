use actix_web::{get, web, HttpRequest, HttpResponse, Responder};

use crate::client::FireflyClient;
use crate::config::Config;
use crate::models::SankeyFlowType;

/// GET endpoint for the sankey page
#[get("/sankey")]
pub async fn sankey_page(config: web::Data<Config>) -> HttpResponse {
    let html = std::fs::read_to_string("static/sankey.html")
        .unwrap_or_else(|_| include_str!("../../static/sankey.html").to_string());

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

/// GET endpoint for sankey flow data
#[get("/api/sankey/flows")]
pub async fn get_sankey_flows(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut account_ids: Vec<String> = Vec::new();
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut flow_type: Option<String> = None;

    for (k, v) in params {
        match k.as_str() {
            "accounts[]" | "accounts" => {
                account_ids.push(v);
            }
            "start" => start = Some(v),
            "end" => end = Some(v),
            "flow_type" => flow_type = Some(v),
            _ => {}
        }
    }

    let flow_type = match flow_type.as_deref() {
        Some("budget") => SankeyFlowType::Budget,
        Some("category") => SankeyFlowType::Category,
        Some("subcategory") => SankeyFlowType::Subcategory,
        _ => SankeyFlowType::Destination,
    };

    match client
        .get_sankey_flows(account_ids, flow_type, start, end)
        .await
    {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "message": e
        })),
    }
}
