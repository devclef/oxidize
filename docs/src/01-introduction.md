# Introduction

## What is Oxidize?

Oxidize is a lightweight web dashboard for [Firefly III](https://www.firefly-iii.org/). It connects to your Firefly III instance and presents your financial data through interactive charts and views.

Instead of navigating Firefly III's interface, Oxidize provides:

- **Balance history** - track account balances over time
- **Earned vs spent** - income and expenses by day, week, month, or quarter
- **Budget comparison** - spending vs budgeted amounts
- **Sankey flows** - visualize money movement between accounts and categories
- **Average cost** - calculate average cost per transaction
- **Configurable dashboard** - pin chart widgets to a custom dashboard

Oxidize acts as a proxy between your browser and the Firefly III API. Your token stays server-side, and data is cached locally to reduce load on Firefly III.

## Features

- **Multiple chart types** - line charts, pie charts, and Sankey flows powered by Chart.js and d3
- **Configurable dashboard** - add, remove, and arrange widgets with per-chart settings (line tension, point display, area fill, axis limits)
- **Account groups** - bundle accounts together for reuse across widgets
- **Dark/light theme** - preference persists in the browser
- **In-memory caching** - 5-minute TTL reduces Firefly III API calls
- **SQLite persistence** - widgets, groups, and dashboards stored locally
- **Docker support** - multi-stage build for a minimal runtime image
- **No frontend build step** - vanilla JavaScript with Chart.js and d3

## Architecture Overview

```
Browser (vanilla JS + Chart.js + d3)
    │
    ▼
Oxidize Server (Actix-Web, Rust)
    │
    ├─► Static file serving (HTML, CSS, JS)
    ├─► API endpoints (accounts, charts, budgets, widgets, etc.)
    │       │
    │       ▼
    │   FireflyClient
    │       ├─► In-memory DataCache (TTL: 5 min)
    │       └─► Firefly III REST API
    │
    └─► Storage (SQLite)
            └─► Widgets, Groups, Dashboards
```

Key design points:

- **Proxy pattern**: Oxidize forwards requests to Firefly III, avoiding CORS issues and keeping your API token server-side.
- **Cache-aside**: Data is cached in memory for 5 minutes. Manual refresh available via POST endpoints.
- **Date chunking**: Large date ranges are split into 90-day chunks to prevent API timeouts.
- **SSRF protection**: The Firefly III URL is validated to prevent pointing at internal/private addresses.
