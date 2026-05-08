# Getting Started

## Prerequisites

Before installing Oxidize, ensure you have:

- A running [Firefly III](https://www.firefly-iii.org/) instance (v6.x recommended)
- A personal access token from Firefly III (Settings → User details → Add new token)
- Rust 1.88+ (if building from source) **or** Docker (if using the prebuilt image)

## Installation

### Option 1: Cargo

Build and run directly from source:

```bash
# Clone the repository
git clone https://github.com/your-org/oxidize.git
cd oxidize

# Run with default settings
cargo run
```

The server starts on `http://0.0.0.0:8080` by default. Open `http://localhost:8080` in your browser.

For a release build:

```bash
cargo build --release
./target/release/oxidize
```

### Option 2: Docker

Build and run with Docker:

```bash
# Build the image
docker build -t oxidize .

# Run with environment variables
docker run -p 8080:8080 \
  -e FIREFLY_III_URL=https://firefly.your-domain.com \
  -e FIREFLY_III_ACCESS_TOKEN=your-token-here \
  -v oxidize-data:/app/data \
  oxidize
```

Or use a `.env` file:

```bash
docker run -p 8080:8080 --env-file .env -v oxidize-data:/app/data oxidize
```

The SQLite database file is stored in the mounted volume at `/app/data`.

## Configuration

### Environment Variables

All configuration is done through environment variables. There is no config file.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIREFLY_III_URL` | **Yes** | — | Base URL of your Firefly III instance (e.g., `https://firefly.example.com`). Must use `http` or `https`. |
| `FIREFLY_III_ACCESS_TOKEN` | **Yes** | — | Your Firefly III personal access token. |
| `HOST` | No | `0.0.0.0` | Network interface to bind to. |
| `PORT` | No | `8080` | Port to listen on. |
| `ACCOUNT_TYPES` | No | `asset,cash,expense,revenue,liability` | Comma-separated list of account types shown in the filter dropdown. |
| `AUTO_FETCH_ACCOUNTS` | No | `false` | Automatically load accounts and chart data on page load. |
| `DATA_DIR` | No | `./data` | Directory where the SQLite database is stored. |
| `RUST_LOG` | No | `info` | Logging level: `trace`, `debug`, `info`, `warn`, `error`. |

### .env File

Create a `.env` file in the project root to avoid typing environment variables on the command line:

```env
FIREFLY_III_URL=https://firefly.your-domain.com
FIREFLY_III_ACCESS_TOKEN=abc123def456...
PORT=8080
DATA_DIR=./data
RUST_LOG=info
```

The application automatically loads `.env` from the current working directory at startup.

> [!WARNING]
> Never commit your `.env` file to version control. Add it to `.gitignore` if it's not already excluded.

## First Launch

After installing and configuring Oxidize:

1. Start the server (`cargo run` or `docker run`)
2. Navigate to `http://localhost:8080` (or your configured host/port)
3. You'll see the main page with an empty balance chart area
4. Select accounts from the dropdown, choose a date range, and pick a period to view your balance history
5. Click **"Save as Widget"** to pin the chart to your dashboard
6. Visit `/dashboard` to manage your widgets and groups
