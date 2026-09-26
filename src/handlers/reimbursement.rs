//! Reimbursements page and API (see src/models/reimbursement.rs).

use crate::client::FireflyClient;
use actix_web::{get, post, web, HttpRequest, HttpResponse, Responder};

/// GET /reimbursements — the Reimbursements page.
#[get("/reimbursements")]
pub async fn reimbursements_page() -> HttpResponse {
    // Read HTML from filesystem at runtime, fall back to the compiled copy.
    let html = std::fs::read_to_string("static/reimbursements.html")
        .unwrap_or_else(|_| include_str!("../../static/reimbursements.html").to_string());

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

/// GET /api/reimbursements/summary — work expenses vs reimbursements for a
/// period.
///
/// Query params:
///   start / end (YYYY-MM-DD; start defaults to first of the current month,
///   end defaults to today),
///   expense_categories[] — work-expense category markers (parent or
///   "Parent:Sub" names),
///   expense_budgets[] — work-expense budget markers,
///   reimbursement_categories[] — reimbursement category markers.
///
/// At least one marker of any kind is required (400 without). Invalid dates
/// or `end < start` return 400; upstream failures return 500
/// ({ "message": ... }).
#[get("/api/reimbursements/summary")]
pub async fn get_reimbursements_summary_api(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let now = chrono::Utc::now().date_naive();
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut expense_categories: Vec<String> = Vec::new();
    let mut expense_budgets: Vec<String> = Vec::new();
    let mut reimbursement_categories: Vec<String> = Vec::new();

    for (k, v) in &params {
        match k.as_str() {
            "start" => start = Some(v.clone()),
            "end" => end = Some(v.clone()),
            "expense_categories[]" | "expense_categories" => expense_categories.push(v.clone()),
            "expense_budgets[]" | "expense_budgets" => expense_budgets.push(v.clone()),
            "reimbursement_categories[]" | "reimbursement_categories" => {
                reimbursement_categories.push(v.clone())
            }
            _ => {}
        }
    }

    let start_s = start.unwrap_or_else(|| format!("{}-01", now.format("%Y-%m")));
    let end_s = end.unwrap_or_else(|| now.format("%Y-%m-%d").to_string());

    if expense_categories.is_empty()
        && expense_budgets.is_empty()
        && reimbursement_categories.is_empty()
    {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "message": "Configure at least one work expense category/budget or reimbursement category"
        }));
    }

    match client
        .get_reimbursement_summary(
            &start_s,
            &end_s,
            &expense_categories,
            &expense_budgets,
            &reimbursement_categories,
        )
        .await
    {
        Ok(summary) => HttpResponse::Ok().json(summary),
        Err(e) => {
            let status = if e.contains("Invalid") {
                actix_web::http::StatusCode::BAD_REQUEST
            } else {
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR
            };
            HttpResponse::build(status).json(serde_json::json!({ "message": e }))
        }
    }
}

/// POST /api/reimbursements/refresh — clear the reimbursement summary cache.
#[post("/api/reimbursements/refresh")]
pub async fn refresh_reimbursements(client: web::Data<FireflyClient>) -> impl Responder {
    client.clear_reimbursement_cache();
    HttpResponse::Ok().json(serde_json::json!({
        "message": "Reimbursement summary cache cleared"
    }))
}
