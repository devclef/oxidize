//! Spending Labels page and API (see plans/spending-labels.md).
//!
//! User-defined labels classify Firefly III categories (whole categories or
//! single subcategories) into lenses like "wants" / "needs". Labels persist
//! in Oxidize's own SQLite database. The feature is optional via the
//! `labels_enabled` setting (default: enabled); when disabled the page and
//! its APIs return 404 and the nav link is hidden on every page.

use crate::client::FireflyClient;
use crate::config::Config;
use crate::models::Label;
use actix_web::{delete, get, post, put, web, HttpRequest, HttpResponse, Responder};

/// True when the Spending Labels feature is enabled in the settings.
/// (Unreadable settings are treated as enabled: the default is on.)
fn labels_enabled() -> bool {
    crate::storage::Storage::get_settings()
        .map(|s| s.labels_enabled)
        .unwrap_or(true)
}

/// GET /labels — the Spending Labels page. Returns 404 when the feature
/// is disabled.
#[get("/labels")]
pub async fn labels_page(config: web::Data<Config>) -> HttpResponse {
    // Env vars are only the defaults: apply runtime settings from the
    // /settings page (Firefly connection, account types, cache TTL, time ranges).
    let config = crate::config::Config::effective(&config);
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }

    // Read HTML from filesystem at runtime, fall back to the compiled copy.
    let html = std::fs::read_to_string("static/labels.html")
        .unwrap_or_else(|_| include_str!("../../static/labels.html").to_string());

    let config_script = format!(
        r#"
    <script>
        window.OXIDIZE_CONFIG = {{
            accountTypes: {}
        }};
    </script>
    "#,
        serde_json::to_string(&config.account_types).unwrap_or_else(|_| "[]".to_string())
    );

    let html = html.replace("</head>", &format!("{} </head>", config_script));
    let html = crate::handlers::hide_disabled_nav(&html);

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

/// GET /api/labels — list all labels (newest first).
#[get("/api/labels")]
pub async fn list_labels() -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }
    match crate::storage::Storage::get_all_labels() {
        Ok(labels) => HttpResponse::Ok().json(labels),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// POST /api/labels — create a label. The client generates the id
/// (crypto.randomUUID, same as groups and widgets).
#[post("/api/labels")]
pub async fn create_label(body: web::Json<Label>) -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }
    let label = body.into_inner();

    if label.id.trim().is_empty() {
        return HttpResponse::BadRequest().body("Label id is required");
    }
    if label.name.trim().is_empty() {
        return HttpResponse::BadRequest().body("Label name is required");
    }
    if label.entries.is_empty() {
        return HttpResponse::BadRequest().body("Label must have at least one category");
    }

    match crate::storage::Storage::create_label(&label) {
        Ok(()) => HttpResponse::Created().json(label),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

/// PUT /api/labels/{id} — update a label (name, description, color, entries).
#[put("/api/labels/{id}")]
pub async fn update_label(path: web::Path<String>, body: web::Json<Label>) -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }
    let path_id = path.into_inner();
    let label = body.into_inner();

    if path_id != label.id {
        return HttpResponse::BadRequest().body("ID mismatch between path and body");
    }
    if label.name.trim().is_empty() {
        return HttpResponse::BadRequest().body("Label name is required");
    }

    match crate::storage::Storage::update_label(&label) {
        Ok(()) => HttpResponse::Ok().json(label),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

/// DELETE /api/labels/{id}
#[delete("/api/labels/{id}")]
pub async fn delete_label(path: web::Path<String>) -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }
    let id = path.into_inner();

    match crate::storage::Storage::delete_label(&id) {
        Ok(()) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::NotFound().body(e),
    }
}

/// GET /api/labels/budget-composition — how one budget's spend in a period
/// is composed of the user's labels.
///
/// Query params:
///   budget (required, exact name), start, end (default: current calendar
///   month), accounts[] (optional), exclude_categories[], exclude_budgets[]
///   (same semantics as the chart endpoints).
#[get("/api/labels/budget-composition")]
pub async fn get_label_budget_composition_api(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }

    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();
    let exclusions = crate::handlers::parse_exclusions(&params);

    let mut budget: Option<String> = None;
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "budget" => budget = Some(v),
            "start" => start = Some(v),
            "end" => end = Some(v),
            "accounts[]" | "accounts" => account_ids.push(v),
            _ => {}
        }
    }

    let Some(budget) = budget.filter(|b| !b.trim().is_empty()) else {
        return HttpResponse::BadRequest().body("budget query parameter is required");
    };

    let labels = match crate::storage::Storage::get_all_labels() {
        Ok(l) => l,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    match client
        .get_label_budget_composition(
            labels,
            budget.clone(),
            start,
            end,
            if account_ids.is_empty() {
                None
            } else {
                Some(account_ids)
            },
            &exclusions,
        )
        .await
    {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET /api/labels/unlabeled-categories — every spend category of a
/// period that matches no user label, across all budgets at once (so
/// they can be labeled without switching between budgets). Spend not
/// charged to a budget is excluded (it would skew the shares).
///
/// Query params:
///   start, end (default: current calendar month), budgets[] (optional:
///   only spend charged to these budgets), accounts[] (optional),
///   exclude_categories[], exclude_budgets[] (same semantics as the chart
///   endpoints).
///
/// Response: total / unlabeled / uncategorized totals plus one entry per
/// unlabeled category (amount, share of total, budgets it was charged to),
/// sorted by amount descending.
#[get("/api/labels/unlabeled-categories")]
pub async fn get_unlabeled_categories_api(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }

    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();
    let exclusions = crate::handlers::parse_exclusions(&params);

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut budgets: Vec<String> = Vec::new();
    let mut account_ids: Vec<String> = Vec::new();

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "budgets[]" | "budgets" => budgets.push(v),
            "accounts[]" | "accounts" => account_ids.push(v),
            _ => {}
        }
    }

    let labels = match crate::storage::Storage::get_all_labels() {
        Ok(l) => l,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    match client
        .get_unlabeled_categories(
            labels,
            start,
            end,
            budgets,
            if account_ids.is_empty() {
                None
            } else {
                Some(account_ids)
            },
            &exclusions,
        )
        .await
    {
        Ok(report) => HttpResponse::Ok().json(report),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET /api/labels/spend — time series of spend per label.
///
/// Query params:
///   start, end (default: last 365 days / today), period (default "1M"),
///   budgets[] (optional: only spend assigned to these budgets),
///   accounts[] (optional), exclude_categories[], exclude_budgets[],
///   include_unlabeled ("0"/"false" to hide the Unlabeled series).
///   Spend not charged to a budget is always excluded.
///
/// Response: standard ChartLine (one dataset per label, sorted by total
/// spend descending), renderable like /api/expenses-by-category.
#[get("/api/labels/spend")]
pub async fn get_label_spend_api(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }

    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();
    let exclusions = crate::handlers::parse_exclusions(&params);

    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut period: Option<String> = None;
    let mut budgets: Vec<String> = Vec::new();
    let mut account_ids: Vec<String> = Vec::new();
    let mut include_unlabeled = true;

    for (k, v) in params {
        match k.as_str() {
            "start" => start = Some(v),
            "end" => end = Some(v),
            "period" => period = Some(v),
            "budgets[]" | "budgets" => budgets.push(v),
            "accounts[]" | "accounts" => account_ids.push(v),
            "include_unlabeled" => include_unlabeled = !(v == "0" || v == "false"),
            _ => {}
        }
    }

    let labels = match crate::storage::Storage::get_all_labels() {
        Ok(l) => l,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };

    match client
        .get_label_spend_chart(
            labels,
            start,
            end,
            period,
            budgets,
            if account_ids.is_empty() {
                None
            } else {
                Some(account_ids)
            },
            include_unlabeled,
            &exclusions,
        )
        .await
    {
        Ok(chart) => HttpResponse::Ok().json(chart),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

/// GET /api/labels/transactions — every transaction matching one label in a
/// period (OXI-48): the drill-down behind the label aggregates.
///
/// Query params:
///   label (required: label id),
///   start, end (default: last 365 days / today),
///   budgets[] (optional: only spend charged to these budgets),
///   accounts[] (optional),
///   include_unbudgeted ("1"/"true" to include spend not charged to a
///   budget; excluded by default, consistent with the other label reports),
///   exclude_categories[], exclude_budgets[] (same semantics as the chart
///   endpoints).
///
/// Response: { label, start, end, count, total (positive spend),
/// currency_symbol, currency_code, transactions: [{ id, date, amount
/// (signed, negative = spend), category, budget, payee, description,
/// account }] }, sorted by date newest first.
#[get("/api/labels/transactions")]
pub async fn get_label_transactions_api(
    client: web::Data<FireflyClient>,
    req: HttpRequest,
) -> impl Responder {
    if !labels_enabled() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Spending Labels is disabled. Enable it under Settings."
        }));
    }

    let query_string = req.query_string();
    let params: Vec<(String, String)> =
        serde_urlencoded::from_str(query_string).unwrap_or_default();
    let exclusions = crate::handlers::parse_exclusions(&params);

    let mut label_id: Option<String> = None;
    let mut start: Option<String> = None;
    let mut end: Option<String> = None;
    let mut budgets: Vec<String> = Vec::new();
    let mut account_ids: Vec<String> = Vec::new();
    let mut include_unbudgeted = false;

    for (k, v) in params {
        match k.as_str() {
            "label" => label_id = Some(v),
            "start" => start = Some(v),
            "end" => end = Some(v),
            "budgets[]" | "budgets" => budgets.push(v),
            "accounts[]" | "accounts" => account_ids.push(v),
            "include_unbudgeted" => include_unbudgeted = v == "1" || v == "true",
            _ => {}
        }
    }

    let Some(label_id) = label_id else {
        return HttpResponse::BadRequest().body("label parameter is required");
    };

    let labels = match crate::storage::Storage::get_all_labels() {
        Ok(l) => l,
        Err(e) => return HttpResponse::InternalServerError().body(e),
    };
    if !labels.iter().any(|l| l.id == label_id) {
        return HttpResponse::NotFound().json(serde_json::json!({
            "message": "Label not found"
        }));
    }

    match client
        .get_label_transactions(
            labels,
            &label_id,
            start,
            end,
            budgets,
            if account_ids.is_empty() {
                None
            } else {
                Some(account_ids)
            },
            include_unbudgeted,
            &exclusions,
        )
        .await
    {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
