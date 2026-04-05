use actix_web::{get, web, HttpResponse, Responder};
use chrono::Datelike;
use serde::Deserialize;

use crate::client::FireflyClient;

#[derive(Deserialize)]
pub struct SummaryQuery {
    month: Option<u32>,
    year: Option<i32>,
}

/// GET endpoint for monthly summary data
#[get("/api/summary/monthly")]
pub async fn get_monthly_summary(
    client: web::Data<FireflyClient>,
    query: web::Query<SummaryQuery>,
) -> impl Responder {
    // Default to current month/year if not provided
    let now = chrono::Utc::now();
    let month = query.month.unwrap_or(now.month());
    let year = query.year.unwrap_or(now.year());

    match client.get_monthly_summary(month, year).await {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for the summary page
#[get("/summary")]
pub async fn summary() -> impl Responder {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(include_str!("../../static/summary.html").to_string())
}
