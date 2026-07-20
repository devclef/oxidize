use crate::client::FireflyClient;
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct CategorySpendQuery {
    #[serde(default)]
    pub parent_categories: Vec<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub period: Option<String>,
    #[serde(default)]
    pub account_ids: Vec<String>,
}

/// GET endpoint for category list (parent categories with subcategories)
#[get("/api/categories/list")]
pub async fn get_category_list(client: web::Data<FireflyClient>) -> impl Responder {
    match client.get_categories().await {
        Ok(categories) => HttpResponse::Ok().json(categories),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for subcategory spend chart data
#[get("/api/categories/subcategory-spend")]
pub async fn get_subcategory_spend(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;
    let mut graph_mode: Option<String> = None;
    let mut parent_categories: Vec<String> = Vec::new();
    let mut subcategories: Vec<String> = Vec::new();
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            "graph_mode" => graph_mode = Some(v),
            "parent_categories[]" | "parent_categories" => {
                parent_categories.push(v);
            }
            "subcategories[]" | "subcategories" => {
                subcategories.push(v);
            }
            "accounts[]" | "accounts" => {
                account_ids.push(v);
            }
            _ => {}
        }
    }

    match client
        .get_subcategory_spend_chart(
            parent_categories,
            subcategories,
            start,
            end,
            period,
            if account_ids.is_empty() {
                None
            } else {
                Some(account_ids)
            },
            graph_mode,
        )
        .await
    {
        Ok(chart) => HttpResponse::Ok().json(chart),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
