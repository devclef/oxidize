use crate::config::Config;
use actix_web::{web, HttpResponse};

pub async fn index(config: web::Data<Config>) -> HttpResponse {
    let html = std::fs::read_to_string("./static/index.html")
        .unwrap_or_else(|_| "<h1>Error loading page</h1>".to_string());

    // Inject config as a script tag before the closing head tag
    let config_script = format!(
        r#"
    <script>
        window.OXIDIZE_CONFIG = {{
            accountTypes: {},
            autoFetchAccounts: {}
        }};
    </script>
    "#,
        serde_json::to_string(&config.account_types).unwrap_or_else(|_| "[]".to_string()),
        config.auto_fetch_accounts
    );

    let html = html.replace("</head>", &format!("{} </head>", config_script));

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

pub async fn manifest() -> HttpResponse {
    let content = std::fs::read_to_string("./static/manifest.json").unwrap_or_default();
    HttpResponse::Ok()
        .content_type("application/manifest+json")
        .body(content)
}
