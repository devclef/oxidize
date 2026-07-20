use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::OnceLock;

use crate::models::dashboard::Dashboard;
use crate::models::group::Group;
use crate::models::widget::ChartOptions;
use crate::models::Widget;

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
    seed_default_dashboard(&conn);

    DATA_DIR.set(dir).ok();
}

fn get_db_path() -> String {
    let dir = DATA_DIR.get().expect("Data directory not initialized");
    PathBuf::from(dir)
        .join("oxidize.db")
        .to_string_lossy()
        .to_string()
}

/// Like with_db but returns Ok(None) if data dir is not initialized.
/// Used by PersistentCache so tests that don't call init_data_dir still work.
fn with_db_optional<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&Connection) -> R,
{
    let db_path = PathBuf::from(DATA_DIR.get()?.as_str()).join("oxidize.db");
    let conn = Connection::open(&db_path).ok()?;
    // Checkpoint WAL so this connection sees writes from previous connections.
    // Important for test isolation where each operation opens a fresh connection.
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE)");
    Some(f(&conn))
}

fn init_db(conn: &Connection) {
    // Create widgets table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS widgets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            accounts TEXT NOT NULL,
            group_ids TEXT NOT NULL DEFAULT '[]',
            budget_ids TEXT NOT NULL DEFAULT '[]',
            budget_names TEXT NOT NULL DEFAULT '[]',
            start_date TEXT,
            end_date TEXT,
            interval TEXT,
            chart_mode TEXT,
            widget_type TEXT,
            chart_options TEXT,
            display_order INTEGER NOT NULL DEFAULT 0,
            width INTEGER NOT NULL DEFAULT 12,
            chart_height INTEGER NOT NULL DEFAULT 300,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .expect("Failed to create widgets table");

    // Create groups table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            account_ids TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .expect("Failed to create groups table");

    // Create dashboards table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS dashboards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .expect("Failed to create dashboards table");

    // Migrations: Add columns if they don't exist
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN widget_type TEXT DEFAULT 'balance'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN width INTEGER NOT NULL DEFAULT 12",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN chart_height INTEGER NOT NULL DEFAULT 300",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN group_ids TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN earned_chart_type TEXT DEFAULT 'bars'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN budget_ids TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN budget_names TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN parent_categories TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN subcategories TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    // Migration: Add dashboard_ids column if it does not exist
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN dashboard_ids TEXT NOT NULL DEFAULT '[]'",
        [],
    );
    // Migration: Add category_graph_mode column if it does not exist
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN category_graph_mode TEXT DEFAULT 'subcategory'",
        [],
    );
    // Initialize persistent chart cache table
    PersistentCache::init(conn);
}

// Seed a default "Main" dashboard if none exist
fn seed_default_dashboard(conn: &Connection) {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM dashboards", [], |row| row.get(0))
        .unwrap_or(0);
    if count == 0 {
        let id = "default";
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO dashboards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, "Main", &now, &now],
        )
        .ok();

        // Assign all existing widgets to the default dashboard
        conn.execute(
            "UPDATE widgets SET dashboard_ids = '[]' WHERE dashboard_ids IS NULL OR dashboard_ids = ''",
            [],
        )
        .ok();
        conn.execute(
            "UPDATE widgets SET dashboard_ids = '[\"default\"]' WHERE dashboard_ids = '[]'",
            [],
        )
        .ok();
    }
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
                    "SELECT id, name, accounts, group_ids, budget_ids, budget_names, parent_categories, subcategories, category_graph_mode, start_date, end_date, interval, chart_mode,
                            widget_type, chart_options, display_order, width, chart_height, created_at, updated_at, earned_chart_type, dashboard_ids
                     FROM widgets ORDER BY display_order ASC, created_at DESC",
                )
                .map_err(|e| e.to_string())?;

            let widgets = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let name: String = row.get(1)?;
                    let accounts_json: String = row.get(2)?;
                    let group_ids_json: String = row.get(3)?;
                    let budget_ids_json: String = row.get(4)?;
                    let budget_names_json: String = row.get(5)?;
                    let parent_categories_json: String = row.get(6)?;
                    let subcategories_json: String = row.get(7)?;
                    let category_graph_mode: Option<String> = row.get(8)?;
                    let start_date: Option<String> = row.get(9)?;
                    let end_date: Option<String> = row.get(10)?;
                    let interval: Option<String> = row.get(11)?;
                    let chart_mode: Option<String> = row.get(12)?;
                    let widget_type: Option<String> = row.get(13)?;
                    let chart_options_json: Option<String> = row.get(14)?;
                    let display_order: i32 = row.get(15)?;
                    let width: i32 = row.get(16)?;
                    let chart_height: i32 = row.get(17)?;
                    let created_at: Option<String> = row.get(18)?;
                    let updated_at: Option<String> = row.get(19)?;
                    let earned_chart_type: Option<String> = row.get(20)?;
                    let dashboard_ids_json: String = row.get(21)?;

                    let accounts: Vec<String> =
                        serde_json::from_str(&accounts_json).unwrap_or_default();
                    let group_ids: Vec<String> =
                        serde_json::from_str(&group_ids_json).unwrap_or_default();
                    let budget_ids: Vec<String> =
                        serde_json::from_str(&budget_ids_json).unwrap_or_default();
                    let budget_names: Vec<String> =
                        serde_json::from_str(&budget_names_json).unwrap_or_default();
                    let parent_categories: Vec<String> =
                        serde_json::from_str(&parent_categories_json).unwrap_or_default();
                    let subcategories: Vec<String> =
                        serde_json::from_str(&subcategories_json).unwrap_or_default();
                    let dashboard_ids: Vec<String> =
                        serde_json::from_str(&dashboard_ids_json).unwrap_or_default();
                    let chart_options =
                        deserialize_chart_options(chart_options_json.as_deref()).unwrap_or(None);

                    Ok(Widget {
                        id,
                        name,
                        accounts,
                        group_ids,
                        budget_ids,
                        budget_names,
                        parent_categories,
                        subcategories,
                        category_graph_mode,
                        start_date,
                        end_date,
                        interval,
                        chart_mode,
                        earned_chart_type,
                        widget_type,
                        chart_options,
                        display_order,
                        width,
                        chart_height,
                        dashboard_ids,
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

    /// Get widgets filtered by dashboard ID
    pub fn get_widgets_for_dashboard(dashboard_id: &str) -> Result<Vec<Widget>, String> {
        Self::get_all_widgets().map(|widgets| {
            widgets
                .into_iter()
                .filter(|w| w.dashboard_ids.contains(&dashboard_id.to_string()))
                .collect()
        })
    }

    pub fn create_widget(widget: &Widget) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let accounts_json = serde_json::to_string(&widget.accounts).map_err(|e| e.to_string())?;
        let group_ids_json = serde_json::to_string(&widget.group_ids).map_err(|e| e.to_string())?;
        let budget_ids_json =
            serde_json::to_string(&widget.budget_ids).map_err(|e| e.to_string())?;
        let budget_names_json =
            serde_json::to_string(&widget.budget_names).map_err(|e| e.to_string())?;
        let chart_options_json = widget
            .chart_options
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;
        let parent_categories_json =
            serde_json::to_string(&widget.parent_categories).map_err(|e| e.to_string())?;
        let subcategories_json =
            serde_json::to_string(&widget.subcategories).map_err(|e| e.to_string())?;
        with_db(|conn| {
            // If the widget has no dashboard_ids, auto-assign it to the default dashboard
            let dashboard_ids_json = if widget.dashboard_ids.is_empty() {
                let default_id: Option<String> = conn
                    .query_row(
                        "SELECT id FROM dashboards WHERE id = 'default' LIMIT 1",
                        [],
                        |row| row.get(0),
                    )
                    .ok();
                match default_id {
                    Some(id) => serde_json::to_string(&[id]).map_err(|e| e.to_string())?,
                    None => "[]".to_string(),
                }
            } else {
                serde_json::to_string(&widget.dashboard_ids).map_err(|e| e.to_string())?
            };

            conn.execute(
                "INSERT INTO widgets (id, name, accounts, group_ids, budget_ids, budget_names, parent_categories, subcategories, category_graph_mode, start_date, end_date, interval,
                                      chart_mode, widget_type, chart_options, earned_chart_type, display_order, width, chart_height, dashboard_ids, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
                params![
                    &widget.id,
                    &widget.name,
                    &accounts_json,
                    &group_ids_json,
                    &budget_ids_json,
                    &budget_names_json,
                    &parent_categories_json,
                    &subcategories_json,
                    &widget.category_graph_mode,
                    &widget.start_date,
                    &widget.end_date,
                    &widget.interval,
                    &widget.chart_mode,
                    &widget.widget_type,
                    &chart_options_json,
                    &widget.earned_chart_type,
                    &widget.display_order,
                    &widget.width,
                    &widget.chart_height,
                    &dashboard_ids_json,
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
        let group_ids_json = serde_json::to_string(&widget.group_ids).map_err(|e| e.to_string())?;
        let budget_ids_json =
            serde_json::to_string(&widget.budget_ids).map_err(|e| e.to_string())?;
        let budget_names_json =
            serde_json::to_string(&widget.budget_names).map_err(|e| e.to_string())?;
        let chart_options_json = widget
            .chart_options
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;
        let parent_categories_json =
            serde_json::to_string(&widget.parent_categories).map_err(|e| e.to_string())?;
        let subcategories_json =
            serde_json::to_string(&widget.subcategories).map_err(|e| e.to_string())?;
        let dashboard_ids_json =
            serde_json::to_string(&widget.dashboard_ids).map_err(|e| e.to_string())?;

        with_db(|conn| {
            let rows = conn
                .execute(
                    "UPDATE widgets SET
                    name = ?1, accounts = ?2, group_ids = ?3, budget_ids = ?4, budget_names = ?5, parent_categories = ?6, subcategories = ?7, category_graph_mode = ?8,
                    start_date = ?9, end_date = ?10, interval = ?11, chart_mode = ?12,
                    widget_type = ?13, chart_options = ?14, earned_chart_type = ?15,
                    display_order = ?16, width = ?17, chart_height = ?18, dashboard_ids = ?19, updated_at = ?20
                 WHERE id = ?21",
                    params![
                        &widget.name,
                        &accounts_json,
                        &group_ids_json,
                        &budget_ids_json,
                        &budget_names_json,
                        &parent_categories_json,
                        &subcategories_json,
                        &widget.category_graph_mode,
                        &widget.start_date,
                        &widget.end_date,
                        &widget.interval,
                        &widget.chart_mode,
                        &widget.widget_type,
                        &chart_options_json,
                        &widget.earned_chart_type,
                        &widget.display_order,
                        &widget.width,
                        &widget.chart_height,
                        &dashboard_ids_json,
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

    // Group CRUD operations

    pub fn get_all_groups() -> Result<Vec<Group>, String> {
        with_db(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, account_ids, created_at, updated_at
                     FROM groups ORDER BY created_at DESC",
                )
                .map_err(|e| e.to_string())?;

            let groups = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let name: String = row.get(1)?;
                    let account_ids_json: String = row.get(2)?;
                    let created_at: Option<String> = row.get(3)?;
                    let updated_at: Option<String> = row.get(4)?;

                    let account_ids: Vec<String> =
                        serde_json::from_str(&account_ids_json).unwrap_or_default();

                    Ok(Group {
                        id,
                        name,
                        account_ids,
                        created_at,
                        updated_at,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r: Result<Group, _>| r.ok())
                .collect();

            Ok(groups)
        })
    }

    pub fn create_group(group: &Group) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let account_ids_json =
            serde_json::to_string(&group.account_ids).map_err(|e| e.to_string())?;

        with_db(|conn| {
            conn.execute(
                "INSERT INTO groups (id, name, account_ids, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![&group.id, &group.name, &account_ids_json, &now, &now],
            )
            .map_err(|e| e.to_string())?;

            Ok(())
        })
    }

    pub fn update_group(group: &Group) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let account_ids_json =
            serde_json::to_string(&group.account_ids).map_err(|e| e.to_string())?;

        with_db(|conn| {
            let rows = conn
                .execute(
                    "UPDATE groups SET name = ?1, account_ids = ?2, updated_at = ?3 WHERE id = ?4",
                    params![&group.name, &account_ids_json, &now, &group.id],
                )
                .map_err(|e| e.to_string())?;

            if rows == 0 {
                return Err(format!("Group with id {} not found", group.id));
            }

            Ok(())
        })
    }

    pub fn delete_group(id: &str) -> Result<(), String> {
        with_db(|conn| {
            let rows = conn
                .execute("DELETE FROM groups WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;

            if rows == 0 {
                return Err(format!("Group with id {} not found", id));
            }

            Ok(())
        })
    }

    // Dashboard CRUD operations

    pub fn get_all_dashboards() -> Result<Vec<Dashboard>, String> {
        with_db(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, created_at, updated_at FROM dashboards ORDER BY created_at ASC",
                )
                .map_err(|e| e.to_string())?;

            let dashboards = stmt
                .query_map([], |row| {
                    let id: String = row.get(0)?;
                    let name: String = row.get(1)?;
                    let created_at: Option<String> = row.get(2)?;
                    let updated_at: Option<String> = row.get(3)?;
                    Ok(Dashboard {
                        id,
                        name,
                        created_at,
                        updated_at,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r: Result<Dashboard, _>| r.ok())
                .collect();

            Ok(dashboards)
        })
    }

    pub fn create_dashboard(dashboard: &Dashboard) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        with_db(|conn| {
            conn.execute(
                "INSERT INTO dashboards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![&dashboard.id, &dashboard.name, &now, &now],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn update_dashboard(dashboard: &Dashboard) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        with_db(|conn| {
            let rows = conn
                .execute(
                    "UPDATE dashboards SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    params![&dashboard.name, &now, &dashboard.id],
                )
                .map_err(|e| e.to_string())?;

            if rows == 0 {
                return Err(format!("Dashboard with id {} not found", dashboard.id));
            }
            Ok(())
        })
    }

    pub fn delete_dashboard(id: &str) -> Result<(), String> {
        with_db(|conn| {
            // Prevent deleting the last dashboard
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM dashboards", [], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            if count <= 1 {
                return Err("Cannot delete the last dashboard".to_string());
            }

            let rows = conn
                .execute("DELETE FROM dashboards WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;

            if rows == 0 {
                return Err(format!("Dashboard with id {} not found", id));
            }

            // Remove this dashboard_id from all widgets' dashboard_ids arrays
            let mut stmt = conn
                .prepare("SELECT id, dashboard_ids FROM widgets")
                .map_err(|e| e.to_string())?;
            let widget_rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<_>>();

            for (wid, dash_ids_json) in widget_rows {
                let dash_ids: Vec<String> =
                    serde_json::from_str(&dash_ids_json).unwrap_or_default();
                let original_len = dash_ids.len();
                let filtered: Vec<String> = dash_ids.into_iter().filter(|d| d != id).collect();
                if filtered.len() != original_len {
                    let new_json = serde_json::to_string(&filtered).map_err(|e| e.to_string())?;
                    conn.execute(
                        "UPDATE widgets SET dashboard_ids = ?1 WHERE id = ?2",
                        params![new_json, wid],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }

            Ok(())
        })
    }
}

// ── Persistent chart cache ──────────────────────────────────────────────

/// Persistent cache for chart data fetched from Firefly.
/// Survives restarts, so the dashboard loads instantly after a break.
pub struct PersistentCache;

impl PersistentCache {
    /// Initialize the chart_cache table. Safe to call multiple times.
    pub fn init(conn: &Connection) {
        let _ = conn.execute(
            "CREATE TABLE IF NOT EXISTS chart_cache (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )",
            [],
        );
        // Index on expires_at for cleanup queries
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_chart_cache_expires ON chart_cache(expires_at)",
            [],
        );
    }

    /// Get cached data by key. Returns None if missing or expired.
    pub fn get(key: &str) -> Option<String> {
        with_db_optional(|conn| {
            let now = chrono::Utc::now().to_rfc3339();
            let mut stmt = conn
                .prepare("SELECT data FROM chart_cache WHERE key = ?1 AND expires_at > ?2 LIMIT 1")
                .ok()?;
            stmt.query_row(params![key, &now], |row| row.get(0)).ok()
        })
        .flatten()
    }

    /// Set cached data with a TTL in seconds. No-op if DB not available.
    pub fn set(key: &str, data: &str, ttl_seconds: u64) {
        let now = chrono::Utc::now();
        let fetched_at = now.to_rfc3339();
        let expires_at = (now + chrono::Duration::seconds(ttl_seconds as i64)).to_rfc3339();
        let _ = with_db_optional(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO chart_cache (key, data, fetched_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
                params![key, data, &fetched_at, &expires_at],
            ).ok();
        });
    }

    /// Remove a specific key from the cache. No-op if DB not available.
    pub fn remove(key: &str) {
        let _ = with_db_optional(|conn| {
            conn.execute("DELETE FROM chart_cache WHERE key = ?1", params![key])
                .ok();
        });
    }

    /// Clear all expired entries and optionally all entries.
    pub fn clear_all() {
        let _ = with_db_optional(|conn| {
            conn.execute("DELETE FROM chart_cache", []).ok();
        });
    }

    /// Clear only expired entries (background cleanup).
    pub fn cleanup_expired() {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = with_db_optional(|conn| {
            conn.execute(
                "DELETE FROM chart_cache WHERE expires_at <= ?1",
                params![&now],
            )
            .ok();
        });
    }

    /// Delete a prefix-matched set of keys (e.g., "balance:*").
    pub fn clear_prefix(prefix: &str) {
        let pattern = format!("{}%", prefix);
        let _ = with_db_optional(|conn| {
            conn.execute(
                "DELETE FROM chart_cache WHERE key LIKE ?1",
                params![&pattern],
            )
            .ok();
        });
    }
}
