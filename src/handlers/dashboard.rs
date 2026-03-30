use actix_web::{get, HttpResponse, Responder};

#[get("/dashboard")]
pub async fn dashboard() -> impl Responder {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(include_str!("../../static/dashboard.html").to_string())
}
