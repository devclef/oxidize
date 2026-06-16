use actix_web::{delete, get, post, put, web, HttpResponse, Responder};

use crate::models::Dashboard;

use crate::storage::Storage;

#[get("/api/dashboards")]
pub async fn list_dashboards() -> impl Responder {
    match Storage::get_all_dashboards() {
        Ok(dashboards) => HttpResponse::Ok().json(dashboards),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// Get widgets for a specific dashboard
#[get("/api/dashboards/{id}/widgets")]
pub async fn get_dashboard_widgets(path: web::Path<String>) -> impl Responder {
    let dashboard_id = path.into_inner();
    match Storage::get_widgets_for_dashboard(&dashboard_id) {
        Ok(widgets) => HttpResponse::Ok().json(widgets),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/api/dashboards")]
pub async fn create_dashboard(body: web::Json<Dashboard>) -> impl Responder {
    let dashboard = body.into_inner();
    if dashboard.name.trim().is_empty() {
        return HttpResponse::BadRequest().body("Dashboard name is required");
    }
    match Storage::create_dashboard(&dashboard) {
        Ok(()) => HttpResponse::Created().json(dashboard),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

#[put("/api/dashboards/{id}")]
pub async fn update_dashboard(
    path: web::Path<String>,
    body: web::Json<Dashboard>,
) -> impl Responder {
    let path_id = path.into_inner();
    let dashboard = body.into_inner();

    if path_id != dashboard.id {
        return HttpResponse::BadRequest().body("ID mismatch between path and body");
    }

    if dashboard.name.trim().is_empty() {
        return HttpResponse::BadRequest().body("Dashboard name is required");
    }

    match Storage::update_dashboard(&dashboard) {
        Ok(()) => HttpResponse::Ok().json(dashboard),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

#[delete("/api/dashboards/{id}")]
pub async fn delete_dashboard(path: web::Path<String>) -> impl Responder {
    let id = path.into_inner();
    match Storage::delete_dashboard(&id) {
        Ok(()) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}
