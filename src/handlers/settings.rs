//! Settings page (/settings) and runtime settings API (/api/settings).
//!
//! The settings page can override the env-based startup settings
//! (Firefly URL/token, account types, auto-fetch, cache TTL, time
//! ranges). Saved values win over the environment; clearing a field
//! reverts to the env value. `HOST`/`PORT`/`DATA_DIR`/`RUST_LOG` still
//! need a restart to change.

use actix_web::{get, patch, post, web, HttpResponse, Responder};

use crate::client::FireflyClient;
use crate::config::{Config, FireflyUrl};
use crate::models::account::ALL_FIRELY_ACCOUNT_TYPES;
use crate::models::settings::{
    FireflyTestRequest, ServerInfo, Settings, SettingsResponse, SettingsUpdate,
};
use crate::storage::Storage;

/// GET /settings — the Settings page.
#[get("/settings")]
pub async fn settings_page() -> HttpResponse {
    // Read HTML from filesystem at runtime, fall back to the compiled copy.
    let html = std::fs::read_to_string("static/settings.html")
        .unwrap_or_else(|_| include_str!("../../static/settings.html").to_string());

    // Hide the Monthly Summary nav link when the feature is disabled.
    let html = crate::handlers::hide_disabled_nav(&html);

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

/// GET /api/settings — the effective settings (saved values layered over
/// the env defaults) plus the metadata the form needs.
#[get("/api/settings")]
pub async fn get_settings_api(config: web::Data<Config>) -> impl Responder {
    let saved = Storage::get_settings_unchecked().unwrap_or_default();
    HttpResponse::Ok().json(build_response(&saved, &config))
}

/// PATCH /api/settings — update one or more settings, returns the new
/// effective state.
#[patch("/api/settings")]
pub async fn update_settings_api(
    client: web::Data<FireflyClient>,
    config: web::Data<Config>,
    body: web::Json<SettingsUpdate>,
) -> impl Responder {
    let update = body.into_inner();

    let mut settings = match Storage::get_settings() {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({ "message": e }))
        }
    };

    if let Err(message) = update.validate(&settings, &config) {
        return HttpResponse::BadRequest().json(serde_json::json!({ "message": message }));
    }

    let before = settings.with_defaults_from(&config);

    update.apply(&mut settings);

    // Compare the effective connection before/after the update so both
    // "saved a new value" and "cleared back to the env value" are caught.
    let after = settings.with_defaults_from(&config);
    let connection_changed =
        before.firefly_url != after.firefly_url || before.firefly_token != after.firefly_token;

    match Storage::save_settings(&settings) {
        Ok(()) => {
            // The Firefly connection may have changed: drop cached data
            // that was fetched from the old instance.
            if connection_changed {
                client.clear_cache();
            }
            HttpResponse::Ok().json(build_response(&settings, &config))
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "message": e })),
    }
}

/// Build the API payload for the current effective settings.
fn build_response(settings: &Settings, config: &Config) -> SettingsResponse {
    SettingsResponse {
        settings: settings.with_defaults_from(config),
        account_type_options: ALL_FIRELY_ACCOUNT_TYPES
            .iter()
            .map(|s| s.to_string())
            .collect(),
        server: ServerInfo {
            host: config.host.clone(),
            port: config.port,
            data_dir: config.data_dir.clone(),
            log_level: std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        },
    }
}

/// POST /api/settings/test-firefly — check whether the given URL/token
/// combination can actually be used (settings page "Test connection").
#[post("/api/settings/test-firefly")]
pub async fn test_firefly_api(body: web::Json<FireflyTestRequest>) -> impl Responder {
    let body = body.into_inner();
    let url = body.url.as_deref().unwrap_or("").trim().to_string();
    let token = body.token.as_deref().unwrap_or("").trim().to_string();

    if url.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({ "message": "url is required" }));
    }
    if let Err(e) = FireflyUrl::validate(url.clone()) {
        return HttpResponse::BadRequest().json(serde_json::json!({ "message": e }));
    }

    match FireflyClient::test_connection(&url, &token).await {
        Ok(()) => HttpResponse::Ok()
            .json(serde_json::json!({ "ok": true, "message": "Connection successful." })),
        Err(message) => {
            HttpResponse::Ok().json(serde_json::json!({ "ok": false, "message": message }))
        }
    }
}
