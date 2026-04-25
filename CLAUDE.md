# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other AI assistants when working with code in this repository.

## Project Overview

Oxidize is a Rust web application that serves as a lightweight dashboard frontend for [Firefly III](https://www.firefly-iii.org/), a personal finance manager. It proxies requests to the Firefly III API, aggregates financial data (balance history, earned/spent, expenses by category, net worth, monthly summaries), and presents it via a web UI with configurable chart widgets and account groups. Local state (widgets, groups) is persisted in a SQLite database.

## Commands

### Development
```bash
# Run the application (reads .env for configuration)
cargo run

# Run with custom logging level
RUST_LOG=debug cargo run
```

### Build
```bash
cargo build            # dev build
cargo build --release  # release build
```

### Testing
```bash
# Run ALL backend tests (unit + integration)
cargo test

# Run a specific test file
cargo test --test oxi_37_earned_spent_date_parsing

# Run frontend tests (Vitest + jsdom)
npm test
```

### Docker
```bash
docker build -t oxidize .
docker run -p 8080:8080 --env-file .env oxidize
```

The Dockerfile uses a multi-stage build: `rust:1.88-slim-bookworm` → `debian:bookworm-slim`. The final image only contains the binary, static files, and runtime deps (libssl3, ca-certificates).

## Architecture

### High-Level Data Flow

```
Browser (vanilla JS + Chart.js)
    │
    ▼
Actix-Web Server (main.rs)
    │
    ├─► Static file serving (/static/*)
    ├─► HTML page handlers (/, /dashboard, /summary)
    ├─► API handlers (/api/*)
    │       │
    │       ▼
    │   FireflyClient (src/client/mod.rs)
    │       ├─► In-memory DataCache (src/cache.rs)
    │       └─► Firefly III REST API (external)
    │
    └─► Storage (src/storage/mod.rs)
            └─► SQLite database (oxidize.db)
```

### Source Code Layout

```
src/
├── main.rs           # Actix-Web server setup, route registration
├── lib.rs            # Crate root: re-exports all modules
├── config.rs         # Config struct loaded from env vars
├── cache.rs          # In-memory TTL cache (RwLock<HashMap>)
├── client/
│   └── mod.rs        # FireflyClient: all Firefly III API interactions
├── handlers/
│   ├── mod.rs        # Handler module declarations
│   ├── account.rs    # /api/accounts, /api/balance-history, /api/earned-spent, etc.
│   ├── dashboard.rs  # GET /dashboard (serves static HTML)
│   ├── index.rs      # GET / (serves index.html with injected config)
│   ├── group.rs      # CRUD for account groups
│   ├── summary.rs    # GET /summary page + GET /api/summary/monthly
│   └── widget.rs     # CRUD for dashboard widgets
├── models/
│   ├── mod.rs        # Re-exports all model types
│   ├── account.rs    # AccountArray, AccountRead, AccountAttributes, SimpleAccount
│   ├── chart.rs      # ChartLine (Vec<ChartDataSet>), CategoryExpense
│   ├── group.rs      # Group (id, name, account_ids)
│   ├── summary.rs    # MonthlySummary
│   └── widget.rs     # Widget, ChartOptions (with custom null-safe deserializer)
└── storage/
    └── mod.rs        # SQLite CRUD for widgets and groups

static/               # Frontend assets (served at /static/)
├── index.html        # Main page
├── dashboard.html    # Dashboard page
├── summary.html      # Summary page
├── app.js            # Main page JS logic
├── dashboard.js      # Dashboard JS logic
├── date-utils.js     # Shared date utility functions
├── theme.js          # Dark/light theme toggle
├── style.css         # Shared styles with CSS variables for theming
├── app.test.js       # Vitest tests for app.js
├── dashboard.test.js # Vitest tests for dashboard.js
├── manifest.json     # PWA manifest
└── sw.js             # Service worker

tests/                # Backend integration tests (cargo test)
├── oxi_*.rs          # Named after YouTrack ticket IDs (e.g., oxi_37_earned_spent_date_parsing.rs)
├── chart_integration_test.rs
├── earned_spent_time_range_test.rs
├── robustness_tests.rs
└── widget_layout_test.rs

api_specs/            # OpenAPI spec for Firefly III (reference)
docs/superpowers/     # Internal docs: plans/ and specs/
```

### Backend Modules in Detail

#### Configuration (`src/config.rs`)

`Config` struct loaded entirely from environment variables (via `dotenv`):

| Field | Env Var | Default | Description |
|-------|---------|---------|-------------|
| `firefly_url` | `FIREFLY_III_URL` | `https://demo.firefly-iii.org` | Firefly III base URL |
| `firefly_token` | `FIREFLY_III_ACCESS_TOKEN` | *(empty string)* | API access token |
| `host` | `HOST` | `0.0.0.0` | Server bind address |
| `port` | `PORT` | `8080` | Server port |
| `account_types` | `ACCOUNT_TYPES` | `asset,cash,expense,revenue,liability` | Comma-separated list for UI filter dropdown |
| `auto_fetch_accounts` | `AUTO_FETCH_ACCOUNTS` | `false` | Auto-fetch accounts on page load |
| `data_dir` | `DATA_DIR` | `./data` | Directory for the SQLite database file |

The `firefly_url` is wrapped in a `FireflyUrl` newtype that validates the URL on construction:
- Must parse as a valid URL
- Must use `http` or `https` scheme
- Must not point to localhost/loopback/private IPs (SSRF protection)
- Validation is **skipped in `#[cfg(test)]`** mode for testing convenience

#### FireflyClient (`src/client/mod.rs`) — ~1080 lines

The central data-fetching layer. All methods are `async` and return `Result<T, String>`.

**Public API methods:**
| Method | Description |
|--------|-------------|
| `get_accounts(type_filter)` | Fetches accounts from Firefly III, maps to `SimpleAccount` |
| `get_balance_history(account_ids, start, end, period)` | Fetches balance chart data, aggregates multiple datasets into one line, anchors to current balance |
| `get_earned_spent(start, end, period, account_ids)` | Fetches transactions and aggregates into earned/spent chart lines by period |
| `get_expenses_by_category(start, end, account_ids)` | Fetches transactions and groups expenses by category |
| `get_net_worth(start, end, period)` | Calculates net worth (assets minus liabilities) over time |
| `get_monthly_summary(month, year, account_ids, account_type)` | Computes monthly income, expenses, savings, and savings rate |

**Internal helper methods:**
| Method | Description |
|--------|-------------|
| `chunk_date_range(start, end)` | Splits date ranges into 90-day chunks for the Firefly III API |
| `fetch_all_transactions(start, end, account_ids)` | Paginates through all transaction pages with date chunking |
| `transaction_involves_account(tx, account_ids)` | Checks if a transaction involves any of the specified accounts |
| `aggregate_transactions_by_period(earned, spent, period, start, end)` | Groups transactions into period buckets (1D, 1W, 1M, 3M) |
| `generate_period_keys(start, end, period)` | Generates all period labels between two dates |
| `sum_filtered_transaction_amounts(data, account_ids, is_income)` | Sums transaction amounts filtered by account |
| `aggregate_monthly_to_quarterly(chart_line)` | Converts monthly chart data to quarterly |

**Key patterns:**
- Period values: `"1D"` (daily), `"1W"` (weekly), `"1M"` (monthly), `"3M"` (quarterly)
- Date format: `"YYYY-MM-DD"` throughout the API
- The client caches serialized JSON strings in `DataCache`, not typed objects
- Balance history uses "anchor balance" calculation: works backwards from current balance using flow deltas
- Transaction fetching uses 90-day chunking because the Firefly III API can be slow for large date ranges

#### Cache (`src/cache.rs`)

`DataCache` — in-memory TTL cache using `RwLock<HashMap<String, CacheEntry<String>>>`:
- Default TTL: 300 seconds (5 minutes)
- Two separate caches: `accounts` and `balance_history`
- Cache keys are constructed from query parameters (account type, account IDs, dates, period)
- Expiry is checked on read; no background cleanup
- Can be cleared per-cache or all at once via `/api/refresh`, `/api/accounts/refresh`, `/api/accounts/balance-history/refresh`

#### Storage (`src/storage/mod.rs`)

SQLite persistence for widgets and groups:
- Database file: `{DATA_DIR}/oxidize.db`
- `DATA_DIR` is set once via `OnceLock` at startup from `config.data_dir`
- `with_db(closure)` pattern: opens a new connection per operation (no connection pool)
- Uses `rusqlite` with positional params
- Vec fields (accounts, account_ids) are stored as JSON strings in TEXT columns
- `ChartOptions` is stored as a JSON string in a TEXT column
- Has inline migrations using `ALTER TABLE ADD COLUMN` (errors are silently ignored if column already exists)

**SQLite tables:**
```sql
-- widgets table
CREATE TABLE widgets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    accounts TEXT NOT NULL,          -- JSON array of account ID strings
    start_date TEXT,
    end_date TEXT,
    interval TEXT,
    chart_mode TEXT,
    widget_type TEXT,                -- "balance" or "earned_spent"
    chart_options TEXT,              -- JSON object (ChartOptions)
    display_order INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 12,
    chart_height INTEGER NOT NULL DEFAULT 300,
    created_at TEXT NOT NULL,        -- RFC 3339 timestamp
    updated_at TEXT NOT NULL
);

-- groups table
CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_ids TEXT NOT NULL,       -- JSON array of account ID strings
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

#### Models (`src/models/`)

**`Widget`** — configurable dashboard chart widget:
- `widget_type`: `"balance"` (default) or `"earned_spent"`
- `chart_options`: optional `ChartOptions` struct with display settings (show_points, fill_area, tension, x/y axis limits, begin_at_zero, show_pct, pct_mode)
- Has a custom deserializer (`deserialize_chart_options_for_widget`) that strips null fields before deserializing, so partial updates work correctly
- `display_order`, `width` (1-12 grid), `chart_height` (pixels) control layout

**`Group`** — named collection of account IDs for filtering

**`MonthlySummary`** — computed monthly financial summary (total_income, total_expenses, savings, savings_rate)

**`ChartLine`** = `Vec<ChartDataSet>` where each dataset has a label, currency info, and entries (a `serde_json::Value` map of date→number)

**`SimpleAccount`** — flattened account (id, name, balance, currency, account_type) derived from the Firefly III nested API response

### Frontend (Vanilla JS)

No build step or bundler — plain JavaScript files served from `/static/`.

**`app.js`** — Main page logic:
- `fetchAccounts()` → `GET /api/accounts?type=`
- `fetchChartData()` → `GET /api/accounts/balance-history`
- `renderChart()` → Chart.js line chart
- `saveGraphAsWidget()` → `POST /api/widgets`
- Account selection, date range picker, period selector

**`dashboard.js`** — Dashboard page logic:
- `renderDashboard()` → fetches widgets and renders each
- `renderWidgetChart()` → fetches chart data per widget and renders
- Widget CRUD (create, update, delete, reorder)
- Group management (create, update, delete)

**`date-utils.js`** — Shared date formatting and range calculation utilities

**`theme.js`** — Dark/light mode toggle, persisted to localStorage

**`style.css`** — Uses CSS custom properties (variables) for theming:
- `:root` for light mode defaults
- `[data-theme="dark"]` selector for dark mode overrides
- When modifying styles, always use the existing CSS variables

### HTML Pages and Config Injection

The index (`/`) and summary (`/summary`) handlers inject server-side config into HTML before serving:
```html
<script>
    window.OXIDIZE_CONFIG = {
        accountTypes: [...],
        autoFetchAccounts: true/false
    };
</script>
```
- `index.rs` reads `./static/index.html` from the filesystem at runtime (`std::fs::read_to_string`)
- `summary.rs` uses `include_str!("../../static/summary.html")` (compiled into the binary)
- `dashboard.rs` uses `include_str!("../../static/dashboard.html")` (no config injection)

## API Endpoints Reference

### HTML Pages
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Main page (index.html with injected config) |
| `GET` | `/dashboard` | Dashboard page |
| `GET` | `/summary` | Summary page (with injected config) |

### Account Data (proxied from Firefly III)
| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/accounts` | `type` (optional) | List accounts, filtered by type |
| `GET` | `/api/accounts/balance-history` | `accounts[]`, `start`, `end`, `period` | Balance chart data |
| `GET` | `/api/earned-spent` | `start`, `end`, `period`, `accounts[]` | Earned vs spent chart data |
| `GET` | `/api/expenses-by-category` | `start`, `end`, `accounts[]` | Expenses grouped by category |
| `GET` | `/api/net-worth` | `start`, `end`, `period` | Net worth over time |
| `GET` | `/api/summary/monthly` | `month`, `year`, `account_ids` (comma-separated), `account_type` | Monthly financial summary |

### Cache Management
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/refresh` | Clear ALL caches |
| `POST` | `/api/accounts/refresh` | Clear accounts cache only |
| `POST` | `/api/accounts/balance-history/refresh` | Clear balance history cache only |

### Widget CRUD
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/widgets` | List all widgets (ordered by display_order, then created_at DESC) |
| `POST` | `/api/widgets` | Create widget (JSON body: `Widget`) |
| `PUT` | `/api/widgets/{id}` | Update widget (path ID must match body ID) |
| `DELETE` | `/api/widgets/{id}` | Delete widget |

### Group CRUD
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/groups` | List all groups (ordered by created_at DESC) |
| `POST` | `/api/groups` | Create group (must have ≥1 account_id) |
| `PUT` | `/api/groups/{id}` | Update group (path ID must match body ID, ≥1 account_id) |
| `DELETE` | `/api/groups/{id}` | Delete group |

### Static Files
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/static/*` | Serves files from `./static/` directory |

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `FIREFLY_III_URL` | Firefly III base URL (e.g., `https://firefly.example.com`) — **not** the `/api` path |
| `FIREFLY_III_ACCESS_TOKEN` | Personal access token from Firefly III |

### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8080` | Server port |
| `RUST_LOG` | `info` | Log level (trace, debug, info, warn, error) |
| `ACCOUNT_TYPES` | `asset,cash,expense,revenue,liability` | Account types for the UI filter dropdown |
| `AUTO_FETCH_ACCOUNTS` | `false` | Auto-load accounts and chart on page load |
| `DATA_DIR` | `./data` | Directory for the SQLite database (`oxidize.db`) |

## Dependencies

### Backend (Cargo.toml)
| Crate | Purpose |
|-------|---------|
| `actix-web` | HTTP server framework |
| `actix-files` | Static file serving |
| `reqwest` | HTTP client for Firefly III API calls (with `rustls-tls`) |
| `serde` / `serde_json` | JSON serialization/deserialization |
| `serde_urlencoded` | URL query parameter parsing |
| `chrono` | Date/time handling |
| `dotenv` | `.env` file loading |
| `env_logger` / `log` | Logging |
| `rusqlite` (bundled) | SQLite database |
| `url` | URL parsing and validation |

### Dev Dependencies
| Crate | Purpose |
|-------|---------|
| `mockito` | HTTP mock server for integration tests |
| `tokio` (test) | Async test runtime |
| `tempfile` | Temporary directories for test databases |

### Frontend
| Library | Purpose |
|---------|---------|
| Chart.js (CDN) | Chart rendering |
| Vitest + jsdom | Frontend test framework |

## Testing

### Backend Tests

**Unit tests** are inline in source files (e.g., `cache.rs` has `#[cfg(test)] mod tests`).

**Integration tests** are in `tests/` and follow the naming convention `oxi_<ticket_number>_<description>.rs`, referencing YouTrack ticket IDs. They use:
- `mockito` to mock the Firefly III API
- `tempfile` for isolated SQLite databases
- `tokio::test` for async test execution

To run all backend tests:
```bash
cargo test
```

To run a specific integration test:
```bash
cargo test --test oxi_37_earned_spent_date_parsing
```

### Frontend Tests

Located in `static/app.test.js` and `static/dashboard.test.js`. Run with:
```bash
npm test
```

Uses Vitest with jsdom environment. Config is in `vite.config.js`.

## Key Design Patterns

1. **API Proxy Pattern**: The backend proxies all Firefly III requests, avoiding CORS issues and enabling server-side caching and data aggregation.

2. **Anchor Balance Calculation**: Balance history from Firefly III returns daily flow deltas. The client converts these to absolute balances by anchoring to the current account balance and working backwards.

3. **Date Range Chunking**: Large date ranges are split into 90-day chunks (`chunk_date_range`) because the Firefly III API can time out on long ranges. Transactions are fetched per-chunk and merged.

4. **Period Aggregation**: Transaction data is bucketed into periods (1D, 1W, 1M, 3M). `generate_period_keys` creates all buckets for a range; `aggregate_transactions_by_period` fills them. Quarterly data can also be derived from monthly data via `aggregate_monthly_to_quarterly`.

5. **Cache-aside Pattern**: `DataCache` stores serialized JSON strings keyed by query parameters. Cache is checked before API calls; on miss, data is fetched, serialized, and cached. TTL is 5 minutes. Cache can be manually invalidated via POST refresh endpoints.

6. **Static-method Storage**: `Storage` is a unit struct with all static methods. It uses `with_db(|conn| { ... })` to open a fresh SQLite connection per operation (no connection pooling). `DATA_DIR` is set once at startup via `OnceLock`.

7. **Config Injection**: Server-side config is injected into HTML pages as a `window.OXIDIZE_CONFIG` script tag before serving. This allows the frontend to access server configuration without an extra API call.

8. **SSRF Protection**: `FireflyUrl` validates that the configured Firefly III URL does not point to localhost, loopback, or private IP ranges. This validation is disabled in test mode.

## Editing Guidelines

### Code Style
- Rust code follows standard `rustfmt` formatting
- Error handling uses `Result<T, String>` throughout (not custom error types)
- Handlers return `impl Responder` or `HttpResponse`
- All Firefly III API interaction is in `FireflyClient` — handlers should not make HTTP calls directly
- Models use `serde` derive macros with rename/skip/default attributes as needed
- Comments are sparse; don't add comments unless they explain non-obvious logic

### CSS Updates
- Use CSS custom properties (variables) for all colors and theming
- Light mode variables in `:root`, dark mode in `[data-theme="dark"]`
- After editing `style.css`, verify the file content before making further edits

### Adding New Endpoints
1. Add the handler function in the appropriate file under `src/handlers/`
2. Register the route in `src/main.rs` (either `.service()` for attributed routes or `.route()`)
3. If it needs Firefly III data, add the data method to `FireflyClient`
4. If it needs persistent storage, add methods to `Storage` and update the SQLite schema in `init_db`

### Adding New Models
1. Create the model file in `src/models/`
2. Add `pub mod` and `pub use` in `src/models/mod.rs`
3. If stored in SQLite, Vec/struct fields should be JSON-serialized to TEXT columns

### Testing Mandate
- **Always** write tests for new logic
- **Backend**: Use `cargo test` — name integration test files after the relevant ticket (e.g., `oxi_42_new_feature.rs`)
- **Frontend**: Use `npm test`
- Verify all tests pass before completing a task
- Follow TDD where possible
- Use `mockito` for mocking Firefly III API responses in backend tests
- Use `tempfile` for test database isolation

### Commit and Push Discipline
- Commit with clear, descriptive messages after completing tasks
- Push to the remote branch unless asked to hold
- Use conventional commit style: `fix:`, `feat:`, `refactor:`, `test:`, `chore:`
- Include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` in commit messages
