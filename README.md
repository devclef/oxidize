# Oxidize

A lightweight Rust web application that serves as a frontend for [Firefly III](https://firefly-iii.org/), a personal finance manager. Oxidize fetches account data and balance history from the Firefly III API and presents it in an intuitive web interface with account listings, interactive charts, and a customizable dashboard.

## Features

- **Account Management**: Browse and filter accounts by type (asset, cash, expense, revenue, liability)
- **Balance Charts**: Visualize account balances over time with customizable date ranges and intervals
- **Chart Modes**: View combined totals or split views to see individual account contributions
- **Saved Lists**: Persist favorite account selections for quick access
- **Widgets**: Save custom chart configurations as reusable widgets
- **Dashboard**: Build a personalized dashboard with saved widgets
- **Data Caching**: Local SQLite storage for improved performance
- **Refresh Controls**: Clear cache and fetch fresh data directly from Firefly III

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- A running Firefly III instance with API access

### Configuration

Create a `.env` file in the project root:

```env
# Firefly III API configuration
FIREFLY_III_URL=https://demo.firefly-iii.org/api
FIREFLY_III_ACCESS_TOKEN=your_access_token_here

# Server configuration
HOST=0.0.0.0
PORT=8080

# Optional settings
ACCOUNT_TYPES=asset,cash,expense,revenue,liability
AUTO_FETCH_ACCOUNTS=false
DATA_DIR=~/.oxidize/data
RUST_LOG=info
```

### Running Locally

```bash
# Development mode
cargo run

# With debug logging
RUST_LOG=debug cargo run

# Production build
cargo build --release
./target/release/oxidize
```

### Docker

```bash
# Build the image
docker build -t oxidize .

# Run with environment file
docker run -p 8080:8080 --env-file .env oxidize

# Or pass environment variables directly
docker run -p 8080:8080 \
  -e FIREFLY_III_URL=https://your-firefly-iii.org/api \
  -e FIREFLY_III_ACCESS_TOKEN=your_token \
  oxidize
```

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `FIREFLY_III_URL` | `https://demo.firefly-iii.org/api` | Firefly III API base URL |
| `FIREFLY_III_ACCESS_TOKEN` | `""` | API access token (required) |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8080` | Server port |
| `ACCOUNT_TYPES` | `asset,cash,expense,revenue,liability` | Comma-separated account types for filter dropdown |
| `AUTO_FETCH_ACCOUNTS` | `false` | Auto-fetch accounts and render chart on page load |
| `DATA_DIR` | `~/.oxidize/data` | Directory for SQLite database storage |
| `RUST_LOG` | `info` | Logging level (trace, debug, info, warn, error) |

## API Endpoints

### Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/accounts` | List accounts (optional `?type=` filter) |
| `GET` | `/api/accounts/balance-history` | Get balance history chart data |
| `POST` | `/api/accounts/refresh` | Clear cache and refresh accounts |
| `POST` | `/api/accounts/refresh-balance-history` | Clear cache and refresh balance history |
| `POST` | `/api/accounts/refresh-all` | Clear all caches and refresh everything |

### Widgets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/widgets` | List all saved widgets |
| `POST` | `/api/widgets` | Create a new widget |
| `PUT` | `/api/widgets/{id}` | Update an existing widget |
| `DELETE` | `/api/widgets/{id}` | Delete a widget |

### Saved Lists

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/saved-lists` | List all saved account lists |
| `POST` | `/api/saved-lists` | Create a new saved list |
| `DELETE` | `/api/saved-lists/{id}` | Delete a saved list |

## Architecture

```
Oxidize
├── src/
│   ├── main.rs          # Application entry point, Actix-Web server setup
│   ├── config.rs        # Configuration management from environment variables
│   ├── client/
│   │   └── mod.rs       # Firefly III API client (reqwest wrapper)
│   ├── handlers/
│   │   ├── account.rs   # Account and balance history endpoints
│   │   ├── dashboard.rs # Dashboard page handler
│   │   ├── index.rs     # Main page handler
│   │   └── widget.rs    # Widget and saved list CRUD endpoints
│   ├── models/
│   │   ├── account.rs   # Account data structures
│   │   ├── chart.rs     # Chart data structures
│   │   └── mod.rs       # Model exports
│   ├── cache/
│   │   └── mod.rs       # In-memory caching layer
│   └── storage/
│       └── mod.rs       # SQLite persistence for widgets and saved lists
└── static/
    ├── index.html       # Graph Builder page
    ├── dashboard.html   # Dashboard page
    ├── app.js           # Graph Builder client-side logic
    ├── dashboard.js     # Dashboard client-side logic
    └── style.css        # Shared styles
```

### Key Design Patterns

1. **API Proxy Pattern**: Backend proxies requests to Firefly III, avoiding CORS issues
2. **Data Aggregation**: Chart data from multiple datasets is aggregated into a single combined line
3. **Anchor Balance Calculation**: Converts flow data to absolute balances by calculating backwards from current balance
4. **Persistent Storage**: Widgets and saved lists stored in SQLite for cross-session persistence

## Frontend

The frontend uses vanilla JavaScript with Chart.js for visualization:

- **Graph Builder** (`/`): Create and customize balance charts
  - Select accounts by type filter
  - Configure date range and time intervals
  - Toggle between combined and split chart views
  - Save configurations as widgets

- **Dashboard** (`/dashboard`): Build custom dashboards
  - Add saved widgets to your dashboard
  - Arrange multiple charts on one page
  - Real-time updates from cached data

## Getting a Firefly III Access Token

1. Log into your Firefly III instance
2. Go to **Settings** > **Developer** (or **API** in older versions)
3. Click **Create a new access token**
4. Give it a name (e.g., "Oxidize")
5. Copy the token and add it to your `.env` file

For more information, see the [Firefly III API documentation](https://docs.firefly-iii.org/how-to/api/).

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
