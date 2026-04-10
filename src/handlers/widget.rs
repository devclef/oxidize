use actix_web::{delete, get, post, put, web, HttpResponse, Responder};

use crate::models::Widget;
use crate::storage::Storage;

// Widget endpoints

#[get("/api/widgets")]
pub async fn list_widgets() -> impl Responder {
    match Storage::get_all_widgets() {
        Ok(widgets) => HttpResponse::Ok().json(widgets),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/api/widgets")]
pub async fn create_widget(body: web::Json<Widget>) -> impl Responder {
    let widget = body.into_inner();

    match Storage::create_widget(&widget) {
        Ok(()) => HttpResponse::Created().json(widget),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

#[put("/api/widgets/{id}")]
pub async fn update_widget(path: web::Path<String>, body: web::Json<Widget>) -> impl Responder {
    let path_id = path.into_inner();
    let widget = body.into_inner();

    // Validate that the path ID matches the widget ID
    if path_id != widget.id {
        return HttpResponse::BadRequest().body("ID mismatch between path and body");
    }

    match Storage::update_widget(&widget) {
        Ok(()) => HttpResponse::Ok().json(widget),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

#[delete("/api/widgets/{id}")]
pub async fn delete_widget(path: web::Path<String>) -> impl Responder {
    let id = path.into_inner();

    match Storage::delete_widget(&id) {
        Ok(()) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::NotFound().body(e),
    }
}
