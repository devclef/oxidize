use actix_web::{get, web, HttpRequest, HttpResponse, Responder};

use crate::client::FireflyClient;
use crate::models::SankeyFlowType;

/// The Sankey Flow page was retired: sankey widgets are built in the Widget
/// Builder now. Old bookmarks land there instead of on a 404.
#[get("/sankey")]
pub async fn sankey_page() -> HttpResponse {
    HttpResponse::Found()
        .insert_header(("Location", "/"))
        .finish()
}

/// GET endpoint for sankey flow data.
///
/// Used by sankey widgets on the dashboard and the Widget Builder preview.
#[get("/api/sankey/flows")]
pub async fn get_sankey_flows(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let exclusions = crate::handlers::parse_exclusions(&params);

    let mut account_ids: Vec<String> = Vec::new();
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut flow_type: Option<String> = None;
    let mut categories: Vec<String> = Vec::new();
    let mut subcategories: Vec<String> = Vec::new();
    let mut budgets: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "accounts[]" | "accounts" => {
                account_ids.push(v);
            }
            "start" => start = Some(v),
            "end" => end = Some(v),
            "flow_type" => flow_type = Some(v),
            "categories[]" => categories.push(v),
            "subcategories[]" => subcategories.push(v),
            "budgets[]" => budgets.push(v),
            _ => {}
        }
    }

    let flow_type = match flow_type.as_deref() {
        Some("budget") => SankeyFlowType::Budget,
        Some("category") => SankeyFlowType::Category,
        Some("subcategory") => SankeyFlowType::Subcategory,
        _ => SankeyFlowType::Destination,
    };

    let categories_opt = if categories.is_empty() {
        None
    } else {
        Some(categories)
    };
    let subcategories_opt = if subcategories.is_empty() {
        None
    } else {
        Some(subcategories)
    };
    let budgets_opt = if budgets.is_empty() {
        None
    } else {
        Some(budgets)
    };

    match client
        .get_sankey_flows(
            account_ids,
            flow_type,
            start,
            end,
            categories_opt,
            subcategories_opt,
            budgets_opt,
            &exclusions,
        )
        .await
    {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "message": e
        })),
    }
}
