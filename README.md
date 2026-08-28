# Oxidize

A lightweight Rust web dashboard for [Firefly III](https://firefly-iii.org/). Oxidize proxies the Firefly III API, aggregates financial data, and presents it through a configurable web UI with chart widgets, account groups, and multiple views.

## Features

- **Balance Charts** - account balances over time with configurable date ranges and periods
- **Earned vs Spent** - income and expense breakdowns by day, week, month, or quarter
- **Budget Comparison** - visualize spending vs budgeted amounts
- **Sankey Flow** - d3-powered flow visualization of money movement between accounts and categories
- **Average Cost** - calculate average cost per transaction
- **Pie Charts** - optional pie chart view for widget data
- **Dashboard** - custom multi-widget dashboards with per-chart settings
- **Category & Budget Exclusions** - exclude categories or budgets entirely from historical charts, per widget or as a dashboard-wide global option
- **Account Groups** - named collections of accounts for reuse across widgets
- **Dark/Light Theme** - persisted in browser localStorage
- **In-memory Caching** - 5-minute TTL reduces Firefly III API load
- **SQLite Persistence** - widgets and groups stored locally
- **Docker Support** - multi-stage build, minimal runtime image

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.88+)
- A running Firefly III instance with API access

### Configuration

Create a `.env` file in the project root:

```env
FIREFLY_III_URL=https://firefly.your-domain.com
FIREFLY_III_ACCESS_TOKEN=your_access_token_here
HOST=0.0.0.0
PORT=8080
```

### Running

```bash
cargo run                  # development
RUST_LOG=debug cargo run   # with debug logging
cargo build --release      # production build
```

### Docker

```bash
docker build -t oxidize .
docker run -p 8080:8080 --env-file .env -v oxidize-data:/app/data oxidize
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FIREFLY_III_URL` | `https://demo.firefly-iii.org` | Firefly III base URL (not the `/api` path) |
| `FIREFLY_III_ACCESS_TOKEN` | *(required)* | Personal access token from Firefly III |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8080` | Server port |
| `ACCOUNT_TYPES` | `asset,cash,expense,revenue,liability` | Account types for filter dropdown |
| `AUTO_FETCH_ACCOUNTS` | `false` | Auto-load accounts on page load |
| `DATA_DIR` | `./data` | SQLite database directory |
| `RUST_LOG` | `info` | Log level (trace, debug, info, warn, error) |

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main page - explore accounts and balance charts |
| `/dashboard` | Custom dashboard with saved widgets |
| `/avg-cost` | Average cost per transaction |
| `/budget-comparison` | Budget vs actual spending |
| `/sankey` | Sankey flow visualization |

## API Endpoints

### Accounts and Balances

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/accounts` | List accounts (`?type=` filter) |
| GET | `/api/accounts/balance-history` | Balance chart data |

### Charts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/earned-spent` | Earned vs spent chart data |
| GET | `/api/earned-spent/since` | Earned vs spent from a start date |
| GET | `/api/expenses-by-category` | Expenses grouped by category |
| GET | `/api/net-worth` | Net worth over time |

Chart endpoints that aggregate transactions accept optional
`exclude_categories[]` (repeatable) and `exclude_budgets[]` (repeatable)
query parameters. A category entry may be a main category name (excludes all
of its subcategories) or a full `Parent:Sub` name; matching transactions are
dropped from the aggregation entirely.

### Budgets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/budgets/spent` | Current budget spending (supports `exclude_budgets[]`) |
| GET | `/api/budgets/spent-history` | Budget spending over time (supports `exclude_categories[]`, `exclude_budgets[]`) |
| GET | `/api/budgets/list` | List all budgets |
| GET | `/api/budgets/comparison` | Budget vs actual comparison data (supports exclusions) |
| GET | `/api/budgets/avg-cost` | Average cost calculation (supports exclusions) |
| POST | `/api/budgets/spent/refresh` | Clear budget spent cache |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories/list` | List all categories |
| GET | `/api/categories/subcategory-spend` | Spending by subcategory (supports exclusions) |

### Dashboards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboards` | List all dashboards |
| GET | `/api/dashboards/{id}/widgets` | Widgets for a dashboard |
| POST | `/api/dashboards` | Create dashboard |
| PUT | `/api/dashboards/{id}` | Update dashboard |
| DELETE | `/api/dashboards/{id}` | Delete dashboard |

### Sankey

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sankey/flows` | Sankey flow data (supports exclusions) |

### Widgets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/widgets` | List all widgets |
| POST | `/api/widgets` | Create widget |
| PUT | `/api/widgets/{id}` | Update widget |
| DELETE | `/api/widgets/{id}` | Delete widget |

Widgets and dashboards support `exclude_categories` and `exclude_budgets`
arrays. On the dashboard page, exclusions can be configured globally per
dashboard (gear button next to the date range) and per widget (widget
Settings panel); effective exclusions are the union of both.

### Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | List all groups |
| POST | `/api/groups` | Create group |
| PUT | `/api/groups/{id}` | Update group |
| DELETE | `/api/groups/{id}` | Delete group |

### Cache

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/refresh` | Clear all caches |
| POST | `/api/accounts/refresh` | Clear accounts cache |
| POST | `/api/accounts/balance-history/refresh` | Clear balance history cache |

### Misc

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/manifest` | PWA manifest |
| GET | `/static/*` | Static file serving |

## Architecture

```
Oxidize
├── src/
│   ├── main.rs          # Server setup, route registration
│   ├── config.rs        # Config from env vars
│   ├── client/mod.rs    # Firefly III API client with caching
│   ├── cache.rs         # In-memory TTL cache
│   ├── handlers/        # Request handlers
│   │   ├── account.rs   # Accounts, balances, earned/spent, budgets
│   │   ├── avg_cost.rs  # Average cost page and API
│   │   ├── budget_comparison.rs  # Budget comparison page
│   │   ├── category.rs  # Category list and subcategory spending
│   │   ├── dashboard.rs # Dashboard page handler
│   │   ├── dashboard_api.rs     # Dashboard CRUD API
│   │   ├── group.rs     # Group CRUD
│   │   ├── index.rs     # Main page, manifest, favicon
│   │   ├── sankey.rs    # Sankey page and flow data
│   │   └── widget.rs    # Widget CRUD
│   ├── models/          # Data types
│   └── storage/mod.rs   # SQLite persistence (widgets, groups, dashboards)
└── static/              # Frontend (vanilla JS, Chart.js, d3)
```

## Getting a Firefly III Access Token

1. Log into Firefly III
2. Go to **Settings** > **Developer** (or **API** in older versions)
3. Click **Create a new access token**
4. Give it a name (e.g., "Oxidize")
5. Copy the token into your `.env` file

See the [Firefly III API docs](https://docs.firefly-iii.org/how-to/api/) for details.

## License

MIT
