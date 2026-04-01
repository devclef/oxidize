# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Oxidize is a Rust web application that serves as a lightweight frontend for Firefly III, a personal finance manager. It fetches account data and balance history from the Firefly III API and presents it in a simple web interface with account listings and balance charts.

## Commands

### Development
```bash
# Run the application
cargo run

# Run with custom logging level
RUST_LOG=debug cargo run
```

### Build
```bash
# Build for development
cargo build

# Build for release
cargo build --release

# Run tests
cargo test
```

### Docker
```bash
# Build image
docker build -t oxidize .

# Run container
docker run -p 8080:8080 --env-file .env oxidize
```

## Architecture

### Backend (Rust/Actix-Web)

**Entry Point**: `src/main.rs`
- Initializes Actix-Web server
- Sets up shared `FireflyClient` data
- Registers routes for accounts, balance history, and static files

**Configuration**: `src/config.rs`
- `Config` struct holds `firefly_url`, `firefly_token`, `host`, `port`, `account_types`, and `auto_fetch_accounts`
- Loads from environment variables via dotenv

**Client Layer**: `src/client/mod.rs`
- `FireflyClient` wraps reqwest for Firefly III API communication
- `get_accounts()` - Fetches accounts with optional type filter
- `get_balance_history()` - Fetches chart data with date range and account filters

**API Handlers**: `src/handlers/`
- `account.rs` - `/api/accounts` and `/api/accounts/balance-history` endpoints
- `index.rs` - Serves the main HTML page

**Data Models**: `src/models/`
- `account.rs` - `AccountArray`, `AccountRead`, `AccountAttributes`, `SimpleAccount`
- `chart.rs` - `ChartLine` (alias for `Vec<ChartDataSet>`)

### Frontend (Vanilla JS)

**Static Files**: `static/`
- `index.html` - Main UI with account filter, account list, saved lists, and chart
- `app.js` - Client-side logic:
  - `fetchAccounts()` - Calls `/api/accounts` endpoint
  - `fetchChartData()` - Calls `/api/accounts/balance-history` endpoint
  - `renderChart()` - Uses Chart.js to render balance history
  - Saved account lists stored in localStorage

### Key Design Patterns

1. **API Proxy Pattern**: Backend proxies requests to Firefly III, avoiding CORS issues
2. **Data Aggregation**: Chart data from multiple datasets is aggregated into a single line
3. **Anchor Balance Calculation**: Converts flow data to absolute balances by calculating backwards from current balance
4. **Saved Lists**: Account selections persisted to browser localStorage

## Environment Variables

Required in `.env`:
- `FIREFLY_III_URL` - Firefly III API base URL (default: https://demo.firefly-iii.org/api)
- `FIREFLY_III_ACCESS_TOKEN` - API access token
- `HOST` - Server bind address (default: 0.0.0.0)
- `PORT` - Server port (default: 8080)
- `RUST_LOG` - Logging level (default: info)

Optional:
- `ACCOUNT_TYPES` - Comma-separated list of account types to show in the filter dropdown (default: asset,cash,expense,revenue,liability)
- `AUTO_FETCH_ACCOUNTS` - If true, automatically fetch accounts and render chart on page load (default: false)

## API Endpoints

- `GET /` - Serves index.html
- `GET /api/accounts?type=<type>` - Returns list of accounts
- `GET /api/accounts/balance-history?accounts[]=&start=&end=&period=` - Returns chart data

## Dependencies

- **actix-web** - HTTP server
- **actix-files** - Static file serving
- **reqwest** - HTTP client for Firefly III API
- **serde/serde_json** - JSON serialization
- **chrono** - Date handling
- **Chart.js** - Frontend charting (via CDN)

## Editing Guidelines

### CSS Updates
When updating `static/style.css`, use CSS variables for theming features. After each edit, verify the file was updated before proceeding with subsequent edits to avoid stale content mismatches.

### File Editing
- Always read the file before editing to ensure you have the latest content
- If an edit fails with a parameter error, re-read the file and retry with the exact current content
- For multi-step edits, consider using `replace_all` for repetitive pattern changes
