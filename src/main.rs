mod config;
mod models;
mod client;
mod handlers;

use actix_web::{web, App, HttpServer};
use crate::config::Config;
use crate::client::FireflyClient;
use log::info;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let config = Config::from_env();
    let host = config.host.clone();
    let port = config.port;

    info!("Starting server at http://{}:{}", host, port);
    info!("Account types: {:?}", config.account_types);
    info!("Auto-fetch accounts: {}", config.auto_fetch_accounts);

    let firefly_client = web::Data::new(FireflyClient::new(config.clone()));

    HttpServer::new(move || {
        App::new()
            .app_data(firefly_client.clone())
            .app_data(web::Data::new(config.clone()))
            .service(handlers::account::get_accounts)
            .service(handlers::account::get_balance_history)
            .service(handlers::dashboard::dashboard)
            .route("/", web::get().to(handlers::index::index))
            .service(actix_files::Files::new("/static", "./static"))
    })
    .bind((host, port))?
    .run()
    .await
}
