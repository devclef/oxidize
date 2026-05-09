use actix_web::{web, App, HttpServer};
use log::info;
use oxidize::client::FireflyClient;
use oxidize::config::Config;
use oxidize::handlers;
use oxidize::storage;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let config = Config::from_env();
    let host = config.host.clone();
    let port = config.port;

    info!("Starting server at http://{}:{}", host, port);
    info!("Auto-fetch accounts: {}", config.auto_fetch_accounts);
    info!("Data directory: {}", config.data_dir);

    // Initialize storage with data directory
    storage::init_data_dir(config.data_dir.clone());

    let firefly_client = web::Data::new(FireflyClient::new(config.clone()));

    HttpServer::new(move || {
        App::new()
            .app_data(firefly_client.clone())
            .app_data(web::Data::new(config.clone()))
            .service(handlers::account::get_accounts)
            .service(handlers::account::get_balance_history)
            .service(handlers::account::refresh_accounts)
            .service(handlers::account::refresh_balance_history)
            .service(handlers::account::refresh_all)
            .service(handlers::account::get_earned_spent)
            .service(handlers::account::get_earned_spent_since)
            .service(handlers::account::get_expenses_by_category)
            .service(handlers::account::get_net_worth)
            .service(handlers::account::get_budget_spent)
            .service(handlers::account::get_budget_list)
            .service(handlers::dashboard::dashboard)
            .service(handlers::summary::get_monthly_summary)
            .service(handlers::summary::summary)
            .service(handlers::widget::list_widgets)
            .service(handlers::widget::create_widget)
            .service(handlers::widget::update_widget)
            .service(handlers::widget::delete_widget)
            .service(handlers::group::list_groups)
            .service(handlers::group::create_group)
            .service(handlers::group::update_group)
            .service(handlers::group::delete_group)
            .route("/", web::get().to(handlers::index::index))
            .route("/api/manifest", web::get().to(handlers::index::manifest))
            .service(actix_files::Files::new("/static", "./static"))
    })
    .bind((host, port))?
    .run()
    .await
}
