use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::OnceLock;

use crate::models::widget::ChartOptions;
use crate::models::{SavedList, Widget};

static DATA_DIR: OnceLock<String> = OnceLock::new();

pub fn init_data_dir(dir: String) {
    let db_path = PathBuf::from(&dir).join("oxidize.db");

    // Create directory if it doesn't exist
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    // Initialize the database
    let conn = Connection::open(&db_path).expect("Failed to open database");
    init_db(&conn);

    DATA_DIR.set(dir).ok();
}

fn get_db_path() -> String {
    let dir = DATA_DIR.get().expect("Data directory not initialized");
    PathBuf::from(dir)
        .join("oxidize.db")
        .to_string_lossy()
        .to_string()
}

fn init_db(conn: &Connection) {
    // Create widgets table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS widgets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            accounts TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            interval TEXT,
            chart_mode TEXT,
            widget_type TEXT,
            chart_options TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .expect("Failed to create widgets table");

    // Migration: Add widget_type column if it doesn't exist (for existing databases)
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN widget_type TEXT DEFAULT 'balance'",
        [],
    ); // Ignore error if column already exists

    // Create saved_lists table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS saved_lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            accounts TEXT NOT NULL,
            created_at TEXT NOT NULL
        )",
        [],
    )
    .expect("Failed to create saved_lists table");
}

// Helper function to deserialize chart options from JSON string
fn deserialize_chart_options(json: Option<&str>) -> Result<Option<ChartOptions>, String> {
    match json {
        Some(s) if !s.is_empty() => serde_json::from_str(s)
            .map(Some)
            .map_err(|e| format!("Failed to parse chart_options JSON: {}", e)),
        _ => Ok(None),
    }
}

fn with_db<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&Connection) -> Result<R, String>,
{
    let db_path = get_db_path();
    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;
    f(&conn)
}

pub struct Storage;

impl Storage {
    // Widget CRUD operations

    pub fn get_all_widgets() -> Result<Vec<Widget>, String> {
        with_db(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, accounts, start_date, end_date, interval, chart_mode,
                            widget_type, chart_options, created_at, updated_at
                     FROM widgets ORDER BY created_at DESC",
                )
                .map_err(|e| e.to_string())?;

            let widgets = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let name: String = row.get(1)?;
                    let accounts_json: String = row.get(2)?;
                    let start_date: Option<String> = row.get(3)?;
                    let end_date: Option<String> = row.get(4)?;
                    let interval: Option<String> = row.get(5)?;
                    let chart_mode: Option<String> = row.get(6)?;
                    let widget_type: Option<String> = row.get(7)?;
                    let chart_options_json: Option<String> = row.get(8)?;
                    let created_at: Option<String> = row.get(9)?;
                    let updated_at: Option<String> = row.get(10)?;

                    let accounts: Vec<String> =
                        serde_json::from_str(&accounts_json).unwrap_or_default();

                    let chart_options =
                        deserialize_chart_options(chart_options_json.as_deref()).unwrap_or(None);

                    Ok(Widget {
                        id,
                        name,
                        accounts,
                        start_date,
                        end_date,
                        interval,
                        chart_mode,
                        widget_type,
                        chart_options,
                        created_at,
                        updated_at,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r: Result<Widget, _>| r.ok())
                .collect();

            Ok(widgets)
        })
    }

    pub fn create_widget(widget: &Widget) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let accounts_json = serde_json::to_string(&widget.accounts).map_err(|e| e.to_string())?;
        let chart_options_json = widget
            .chart_options
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;

        with_db(|conn| {
            conn.execute(
                "INSERT INTO widgets (id, name, accounts, start_date, end_date, interval,
                                      chart_mode, widget_type, chart_options, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    &widget.id,
                    &widget.name,
                    &accounts_json,
                    &widget.start_date,
                    &widget.end_date,
                    &widget.interval,
                    &widget.chart_mode,
                    &widget.widget_type,
                    &chart_options_json,
                    &now,
                    &now
                ],
            )
            .map_err(|e| e.to_string())?;

            Ok(())
        })
    }

    pub fn update_widget(widget: &Widget) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let accounts_json = serde_json::to_string(&widget.accounts).map_err(|e| e.to_string())?;
        let chart_options_json = widget
            .chart_options
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;

        with_db(|conn| {
            let rows = conn.execute(
                "UPDATE widgets SET
                    name = ?1, accounts = ?2, start_date = ?3, end_date = ?4,
                    interval = ?5, chart_mode = ?6, widget_type = ?7, chart_options = ?8, updated_at = ?9
                 WHERE id = ?10",
                params![
                    &widget.name,
                    &accounts_json,
                    &widget.start_date,
                    &widget.end_date,
                    &widget.interval,
                    &widget.chart_mode,
                    &widget.widget_type,
                    &chart_options_json,
                    &now,
                    &widget.id
                ],
            )
            .map_err(|e| e.to_string())?;

            if rows == 0 {
                return Err(format!("Widget with id {} not found", widget.id));
            }

            Ok(())
        })
    }

    pub fn delete_widget(id: &str) -> Result<(), String> {
        with_db(|conn| {
            let rows = conn
                .execute("DELETE FROM widgets WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;

            if rows == 0 {
                return Err(format!("Widget with id {} not found", id));
            }

            Ok(())
        })
    }

    // Saved Lists CRUD operations

    pub fn get_all_saved_lists() -> Result<Vec<SavedList>, String> {
        with_db(|conn| {
            let mut stmt = conn
                .prepare("SELECT id, name, accounts, created_at FROM saved_lists ORDER BY created_at DESC")
                .map_err(|e| e.to_string())?;

            let lists = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let name: String = row.get(1)?;
                    let accounts_json: String = row.get(2)?;
                    let created_at: String = row.get(3)?;

                    let accounts: serde_json::Value =
                        serde_json::from_str(&accounts_json).unwrap_or(serde_json::Value::Null);

                    Ok(SavedList {
                        id,
                        name,
                        accounts,
                        created_at,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r: Result<SavedList, _>| r.ok())
                .collect();

            Ok(lists)
        })
    }

    pub fn create_saved_list(list: &SavedList) -> Result<(), String> {
        with_db(|conn| {
            conn.execute(
                "INSERT INTO saved_lists (id, name, accounts, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![&list.id, &list.name, &list.accounts, &list.created_at],
            )
            .map_err(|e| e.to_string())?;

            Ok(())
        })
    }

    pub fn delete_saved_list(id: &str) -> Result<(), String> {
        with_db(|conn| {
            let rows = conn
                .execute("DELETE FROM saved_lists WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;

            if rows == 0 {
                return Err(format!("Saved list with id {} not found", id));
            }

            Ok(())
        })
    }
}
