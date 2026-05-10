use crate::client::FireflyClient;
use actix_web::{get, post, web, HttpRequest, HttpResponse, Responder};
use log::info;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct AccountQuery {
    #[serde(rename = "type")]
    pub account_type: Option<String>,
}

#[get("/api/accounts")]
pub async fn get_accounts(
    client: web::Data<FireflyClient>,
    query: web::Query<AccountQuery>,
) -> impl Responder {
    match client.get_accounts(query.account_type.clone()).await {
        Ok(accounts) => HttpResponse::Ok().json(accounts),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// POST endpoint to refresh/clear the accounts cache
#[post("/api/accounts/refresh")]
pub async fn refresh_accounts(client: web::Data<FireflyClient>) -> impl Responder {
    client.clear_accounts_cache();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": "Accounts cache cleared"
    }))
}

#[get("/api/accounts/balance-history")]
pub async fn get_balance_history(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut account_ids: Vec<String> = Vec::new();
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;

    for (k, v) in params {
        match k.as_str() {
            "accounts[]" | "accounts" => {
                account_ids.push(v);
            }
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            _ => {
                // Check for URL-encoded variants of accounts[]
                if k == "accounts%5B%5D" {
                    account_ids.push(v);
                }
            }
        }
    }

    let ids = if account_ids.is_empty() {
        None
    } else {
        Some(account_ids)
    };

    match client.get_balance_history(ids, start, end, period).await {
        Ok(history) => HttpResponse::Ok().json(history),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// POST endpoint to refresh/clear the balance history cache
#[post("/api/accounts/balance-history/refresh")]
pub async fn refresh_balance_history(client: web::Data<FireflyClient>) -> impl Responder {
    client.clear_balance_history_cache();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": "Balance history cache cleared"
    }))
}

/// POST endpoint to refresh/clear all caches
#[post("/api/refresh")]
pub async fn refresh_all(client: web::Data<FireflyClient>) -> impl Responder {
    client.clear_cache();
    info!("All caches cleared via API");
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": "All caches cleared"
    }))
}

/// POST endpoint to refresh/clear the budget spent cache
#[post("/api/budgets/spent/refresh")]
pub async fn refresh_budget_spent(client: web::Data<FireflyClient>) -> impl Responder {
    client.clear_budget_spent_cache();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "message": "Budget spent cache cleared"
    }))
}

/// GET endpoint for earned vs spent chart data
#[get("/api/earned-spent")]
pub async fn get_earned_spent(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            "accounts[]" | "accounts" => {
                account_ids.push(v);
            }
            _ => {
                // Check for URL-encoded variants of accounts[]
                if k == "accounts%5B%5D" {
                    account_ids.push(v);
                }
            }
        }
    }

    match client
        .get_earned_spent(start, end, period, Some(account_ids))
        .await
    {
        Ok(history) => HttpResponse::Ok().json(history),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for earned vs spent with a start date filter
/// Used for incremental refresh - only returns chart data for transactions since the given date
#[get("/api/earned-spent/since")]
pub async fn get_earned_spent_since(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut since: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "since" => since = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            "accounts[]" | "accounts" => {
                account_ids.push(v);
            }
            _ => {
                if k == "accounts%5B%5D" {
                    account_ids.push(v);
                }
            }
        }
    }

    let since = match since {
        Some(s) => s,
        None => {
            return HttpResponse::BadRequest().body("missing 'since' parameter");
        }
    };

    match client
        .get_earned_spent(Some(since), end, period, Some(account_ids))
        .await
    {
        Ok(history) => HttpResponse::Ok().json(history),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for expense by category chart data
#[get("/api/expenses-by-category")]
pub async fn get_expenses_by_category(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "accounts[]" | "accounts" => {
                account_ids.push(v);
            }
            _ => {
                // Check for URL-encoded variants of accounts[]
                if k == "accounts%5B%5D" {
                    account_ids.push(v);
                }
            }
        }
    }

    match client
        .get_expenses_by_category(start, end, Some(account_ids))
        .await
    {
        Ok(categories) => HttpResponse::Ok().json(categories),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for net worth chart data (assets - liabilities)
#[get("/api/net-worth")]
pub async fn get_net_worth(client: web::Data<FireflyClient>, req: HttpRequest) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            _ => {}
        }
    }

    match client.get_net_worth(start, end, period).await {
        Ok(net_worth) => HttpResponse::Ok().json(net_worth),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for budget spending chart data
#[get("/api/budgets/spent")]
pub async fn get_budget_spent(client: web::Data<FireflyClient>, req: HttpRequest) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            _ => {}
        }
    }

    match client.get_budget_spent(start, end).await {
        Ok(chart) => HttpResponse::Ok().json(chart),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for budget spending history (time-series)
#[get("/api/budgets/spent-history")]
pub async fn get_budget_spent_history(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            "accounts[]" | "accounts" => account_ids.push(v),
            _ => {}
        }
    }

    match client
        .get_budget_spent_history(start, end, period, if account_ids.is_empty() { None } else { Some(account_ids) })
        .await
    {
        Ok(chart) => HttpResponse::Ok().json(chart),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET endpoint for budget list (for widget selector)
#[get("/api/budgets/list")]
pub async fn get_budget_list(client: web::Data<FireflyClient>, req: HttpRequest) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            _ => {}
        }
    }

    match client.get_budgets(start, end).await {
        Ok(budgets) => HttpResponse::Ok().json(budgets),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
