use crate::config::Config;
use actix_web::{get, web, HttpResponse};

pub async fn index(config: web::Data<Config>) -> HttpResponse {
    // Env vars are only the defaults: apply runtime settings from the
    // /settings page (Firefly connection, account types, cache TTL, time ranges).
    let config = crate::config::Config::effective(&config);
    let html = std::fs::read_to_string("./static/index.html")
        .unwrap_or_else(|_| "<h1>Error loading page</h1>".to_string());

    // Inject config as a script tag before the closing head tag
    let config_script = format!(
        r#"
    <script>
        window.OXIDIZE_CONFIG = {{
            accountTypes: {},
            allAccountTypes: {},
            autoFetchAccounts: {},
            timeRanges: {},
            defaultTimeRange: "{}"
        }};
    </script>
    "#,
        serde_json::to_string(&config.account_types).unwrap_or_else(|_| "[]".to_string()),
        serde_json::to_string(&crate::models::ALL_FIRELY_ACCOUNT_TYPES)
            .unwrap_or_else(|_| "[]".to_string()),
        config.auto_fetch_accounts,
        serde_json::to_string(&config.time_ranges).unwrap_or_else(|_| "[]".to_string()),
        config.default_time_range
    );

    let html = html.replace("</head>", &format!("{} </head>", config_script));

    let html = crate::handlers::hide_disabled_nav(&html);

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

pub async fn manifest() -> HttpResponse {
    let content = std::fs::read_to_string("./static/manifest.json").unwrap_or_default();
    HttpResponse::Ok()
        .content_type("application/manifest+json")
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .insert_header(("Cache-Control", "public, max-age=3600"))
        .body(content)
}

/// Serve the service worker with `Service-Worker-Allowed: /` so the pages
/// can register it with root scope even though it lives under /static/.
#[get("/static/sw.js")]
pub async fn service_worker() -> HttpResponse {
    match std::fs::read_to_string("./static/sw.js") {
        Ok(content) => HttpResponse::Ok()
            .content_type("application/javascript; charset=utf-8")
            .insert_header(("Service-Worker-Allowed", "/"))
            .insert_header(("Cache-Control", "no-cache"))
            .body(content),
        Err(_) => HttpResponse::NotFound().finish(),
    }
}

#[get("/favicon.ico")]
pub async fn favicon() -> HttpResponse {
    // Browsers accept a PNG served at /favicon.ico.
    match std::fs::read("./static/icons/favicon-32x32.png") {
        Ok(bytes) => HttpResponse::Ok()
            .content_type("image/png")
            .insert_header(("Cache-Control", "public, max-age=86400"))
            .body(bytes),
        Err(_) => HttpResponse::NoContent().finish(),
    }
}
