use actix_web::{get, HttpResponse, Responder};

#[get("/dashboard")]
pub async fn dashboard(config: actix_web::web::Data<crate::config::Config>) -> impl Responder {
    let mut html = include_str!("../../static/dashboard.html").to_string();

    let config_script = format!(
        r#"
    <script>
        window.OXIDIZE_CONFIG = {{
            accountTypes: {},
            autoFetchAccounts: {},
            timeRanges: {},
            defaultTimeRange: "{}"
        }};
    </script>
    "#,
        serde_json::to_string(&config.account_types).unwrap_or_else(|_| "[]".to_string()),
        config.auto_fetch_accounts,
        serde_json::to_string(&config.time_ranges).unwrap_or_else(|_| "[]".to_string()),
        config.default_time_range
    );

    html = html.replace("</body>", &format!("{} </body>", config_script));

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}
