use actix_web::{get, web, HttpResponse, Responder, HttpRequest};
use crate::client::FireflyClient;
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

#[get("/api/accounts/balance-history")]
pub async fn get_balance_history(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    let query_string = req.query_string();
    let params: Vec<(String, String)> = serde_urlencoded::from_str(query_string).unwrap_or_default();

    let mut account_ids: Vec<String> = Vec::new();
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;

    log::info!("Received balance history request with query: {}", query_string);

    for (k, v) in params {
        log::info!("Query param received: {} = {}", k, v);
        match k.as_str() {
            "accounts[]" | "accounts" => {
                log::info!("Found account ID: {}", v);
                account_ids.push(v);
            },
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            _ => {
                // Check for URL-encoded variants of accounts[]
                if k == "accounts%5B%5D" {
                    log::info!("Found URL-encoded account ID: {}", v);
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
