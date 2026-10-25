use actix_web::{test as atest, App};

#[actix_web::test]
async fn service_worker_allows_root_scope() {
    let app =
        atest::init_service(App::new().service(oxidize::handlers::index::service_worker)).await;
    let req = atest::TestRequest::get().uri("/static/sw.js").to_request();
    let resp = atest::call_service(&app, req).await;

    assert!(resp.status().is_success());
    assert_eq!(
        resp.headers()
            .get("Service-Worker-Allowed")
            .and_then(|v| v.to_str().ok()),
        Some("/")
    );
    let content_type = resp
        .headers()
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(content_type.starts_with("application/javascript"));

    let body = atest::read_body(resp).await;
    assert!(String::from_utf8_lossy(&body).contains("CACHE_NAME"));
}

#[test]
fn service_worker_route_is_registered_before_static_files() {
    let main_rs = include_str!("../src/main.rs");
    let sw = main_rs
        .find("handlers::index::service_worker")
        .expect("service_worker should be registered");
    let files = main_rs
        .find("actix_files::Files::new(\"/static\"")
        .expect("static files should be registered");
    assert!(
        sw < files,
        "sw.js route must win over the static file service"
    );
}

#[actix_web::test]
async fn favicon_serves_the_app_logo() {
    let app = atest::init_service(App::new().service(oxidize::handlers::index::favicon)).await;
    let req = atest::TestRequest::get().uri("/favicon.ico").to_request();
    let resp = atest::call_service(&app, req).await;

    assert!(resp.status().is_success());
    assert_eq!(
        resp.headers()
            .get("Content-Type")
            .and_then(|v| v.to_str().ok()),
        Some("image/png")
    );
    let body = atest::read_body(resp).await;
    assert!(body.starts_with(b"\x89PNG"), "favicon must be a PNG");
}

#[test]
fn every_page_uses_the_logo() {
    for page in [
        "index",
        "dashboard",
        "summary",
        "budget-comparison",
        "avg-cost",
        "reimbursements",
        "labels",
        "settings",
    ] {
        let html = std::fs::read_to_string(format!("static/{page}.html")).unwrap();
        assert!(
            html.contains(r#"<img class="nav-brand-logo" src="/static/icons/logo.svg""#),
            "{page}.html nav brand should use the logo"
        );
        assert!(
            html.contains(
                r#"<link rel="icon" type="image/svg+xml" href="/static/icons/logo.svg">"#
            ),
            "{page}.html should use the SVG favicon"
        );
    }
}
