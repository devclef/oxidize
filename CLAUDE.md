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
```

### Run tests
```bash
# Run backend tests
cargo test

# Run frontend tests
npm test
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
- `get_earned_spent()` - Fetches earned/spent transaction data aggregated by period

**API Handlers**: `src/handlers/`
- `account.rs` - `/api/accounts`, `/api/accounts/balance-history`, and `/api/earned-spent` endpoints
- `index.rs` - Serve the main HTML page
- `dashboard.rs` - Serve the dashboard page
- `widget.rs` - CRUD endpoints for widgets

**Cache Layer**: `src/cache.rs`
- `DataCache` provides in-memory caching for accounts and balance history
- Cache keys include account type filter, date range, and period

**Storage Layer**: `src/storage.rs`
- Uses `dirs` crate to determine data directory location

**Data Models**: `src/models/`
- `account.rs` - `AccountArray`, `AccountRead`, `AccountAttributes`, `SimpleAccount`
- `chart.rs` - `ChartLine` (alias for `Vec<ChartDataSet>`)
- `widget.rs` - `Widget`, `ChartOptions`

### Frontend (Vanilla JS)

**Static Files**: `static/`
- `index.html` - Main UI with account filter, account list, and chart
- `dashboard.html` - Dashboard page for viewing saved widgets
- `app.js` - Client-side logic for main page:
  - `fetchAccounts()` - Calls `/api/accounts` endpoint
  - `fetchChartData()` - Calls `/api/accounts/balance-history` endpoint
  - `renderChart()` - Uses Chart.js to render balance history
  - `saveGraphAsWidget()` - Saves current chart configuration as a widget
- `dashboard.js` - Client-side logic for dashboard:
  - `renderDashboard()` - Renders all saved widgets
  - `renderWidgetChart()` - Renders chart for a specific widget
  - `updateWidgetDateRange()` - Updates widget settings and re-renders
- `style.css` - Shared styles with dark mode support via CSS variables

## Key Design Patterns

1. **API Proxy Pattern**: Backend proxies requests to Firefly III, avoiding CORS issues
2. **Data Aggregation**: Chart data from multiple datasets is aggregated into a single line
3. **Anchor Balance Calculation**: Converts flow data to absolute balances by calculating backwards from current balance

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

### Main Page
- `GET /` - Serves index.html

### Dashboard
- `GET /dashboard` - Serves dashboard.html

### Accounts
- `GET /api/accounts?type=<type>` - Returns list of accounts (optional type filter)
- `POST /api/accounts/refresh` - Clears accounts cache

### Chart Data
- `GET /api/accounts/balance-history?accounts[]=&start=&end=&period=` - Returns chart data
- `POST /api/accounts/balance-history/refresh` - Clears balance history cache

### Earned/Spent
- `GET /api/earned-spent?start=&end=&period=&accounts[]=` - Returns earned/spent transaction data

### Widgets
- `GET /api/widgets` - Lists all saved widgets
- `POST /api/widgets` - Creates a new widget
- `PUT /api/widgets/{id}` - Updates an existing widget
- `DELETE /api/widgets/{id}` - Deletes a widget

### Cache
- `POST /api/refresh` - Clears all caches

## Dependencies

### Backend
- **actix-web** - HTTP server
- **actix-files** - Static file serving
- **reqwest** - HTTP client for Firefly III
- **serde/serde_json** - JSON serialization
- **chrono** - Date handling
- **dotenv** - Environment variable loading
- **env_logger** - Logging
- **serde_urlencoded** - URL parameter parsing
- **rusqlite** - SQLite database interaction
- **dirs** - Directory path utilities
- **once_cell** - Lazy initialization

### Frontend
- **Chart.js** - Frontend charting (via CDN)
- **Vitest** - Frontend test runner

## Testing

### Backend Testing
- **Framework**: `cargo test`
- **Mocking**: `mockito` is used to mock external Firefly III API calls.
- **Integration Tests**: Located in `tests/`.

### Frontend Testing
- **Framework**: `Vitest` with `jsdom`.
- **Command**: `npm test`
- **Location**: Tests are located in `static/app.test.js`.

## Editing Guidelines

### CSS Updates
When updating `static/style.css`, use CSS variables for theming features. After each edit, verify the file was updated before proceeding with subsequent edits to avoid stale content mismatches.

### File Editing
 - Always read the file before editing to ensure you have the latest content
 - Use `apply_patch` with the following format:
   - `@@ <context_line>`: A line that exists exactly as-is in the file
   - `- <old_line>`: The line to remove
   - `+ <new_line>`: The line to add
 - If an edit fails with a parameter error, re-read the file and retry with the exact current content
 - For multi-step edits, consider using `replace_all` for repetitive pattern changes

### Testing Mandate
- **Always** write tests for new logic.
- **Backend**: Use `cargo test`.
- **Frontend**: Use `npm test`.
- Verify that all tests pass before completing a task.
- Follow Test Driven Development (TDD) where possible.

### Commit and Push Discipline
- After completing any task or fix, commit the changes with a clear, descriptive message.
- Push the commit to the remote branch unless the user explicitly asks to hold.
- Use conventional commit style: `fix:`, `feat:`, `refactor:`, `test:`, `chore:`.
- Always include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` in the commit message.
