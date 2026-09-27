//! Settings page (/settings) and runtime settings API (/api/settings).

use actix_web::{get, patch, web, HttpResponse, Responder};

use crate::models::SettingsUpdate;
use crate::storage::Storage;

/// GET /settings — the Settings page.
#[get("/settings")]
pub async fn settings_page() -> HttpResponse {
    // Read HTML from filesystem at runtime, fall back to the compiled copy.
    let html = std::fs::read_to_string("static/settings.html")
        .unwrap_or_else(|_| include_str!("../../static/settings.html").to_string());

    // Hide the Monthly Summary nav link when the feature is disabled.
    let html = crate::handlers::hide_summary_nav_if_disabled(&html);

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

/// GET /api/settings — current settings with defaults applied.
#[get("/api/settings")]
pub async fn get_settings_api() -> impl Responder {
    match Storage::get_settings() {
        Ok(settings) => HttpResponse::Ok().json(settings),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "message": e })),
    }
}

/// PATCH /api/settings — update one or more settings, returns the new state.
#[patch("/api/settings")]
pub async fn update_settings_api(body: web::Json<SettingsUpdate>) -> impl Responder {
    let mut settings = match Storage::get_settings() {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({ "message": e }))
        }
    };

    body.into_inner().apply(&mut settings);

    match Storage::save_settings(&settings) {
        Ok(()) => HttpResponse::Ok().json(settings),
        Err(e) => HttpResponse::BadRequest().json(serde_json::json!({ "message": e })),
    }
}
