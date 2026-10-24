//! Subscription Cost widgets (plans/subscription-cost-widget.md).
//!
//! Firefly III calls subscriptions "bills" in the v1 API. These endpoints
//! back the `subscription_cost` dashboard widget: the subscription and
//! subscription-group pickers, plus the cost-over-time chart series.

use crate::client::FireflyClient;
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};

/// GET /api/subscriptions — every Firefly III subscription (bill), sorted
/// by name. Backs the widget builder's subscription picker.
#[get("/api/subscriptions")]
pub async fn get_subscriptions(client: web::Data<FireflyClient>) -> impl Responder {
    match client.get_subscriptions().await {
        Ok(subs) => HttpResponse::Ok().json(subs),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET /api/subscriptions/groups — object groups that contain at least one
/// subscription, with each group's bill ids/names. Backs the picker's
/// "groups of subscriptions".
#[get("/api/subscriptions/groups")]
pub async fn get_subscription_groups(client: web::Data<FireflyClient>) -> impl Responder {
    match client.get_subscription_groups().await {
        Ok(groups) => HttpResponse::Ok().json(groups),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET /api/subscriptions/spend — cost over time as a standard `ChartLine`
/// with one dataset per subscription, sorted by total descending.
///
/// Query params:
///   start, end (default: last 365 days / today),
///   period (default 1M),
///   subscriptions[] (bill ids; repeatable),
///   groups[] (object-group ids whose bills are included; repeatable),
///   accounts[] (optional source-account filter; repeatable),
///   exclude_categories[], exclude_budgets[] (same semantics as the other
///   chart endpoints).
///
/// Empty subscription + group selections mean "all subscriptions".
#[get("/api/subscriptions/spend")]
pub async fn get_subscription_spend(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();
    let exclusions = crate::handlers::parse_exclusions(&params);

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;
    let mut subscription_ids: Vec<String> = Vec::new();
    let mut group_ids: Vec<String> = Vec::new();
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            "subscriptions[]" | "subscriptions" => subscription_ids.push(v),
            "groups[]" | "groups" => group_ids.push(v),
            "accounts[]" | "accounts" => account_ids.push(v),
            _ => {}
        }
    }

    match client
        .get_subscription_spend_chart(
            subscription_ids,
            group_ids,
            start,
            end,
            period,
            if account_ids.is_empty() {
                None
            } else {
                Some(account_ids)
            },
            &exclusions,
        )
        .await
    {
        Ok(chart) => HttpResponse::Ok().json(chart),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
