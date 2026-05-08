# Introduction

## What is Oxidize?

Oxidize is a lightweight web dashboard that gives you a clear, visual view of your personal finances. It connects to [Firefly III](https://www.firefly-iii.org/) — an open-source personal finance manager — and transforms its raw data into beautiful, interactive charts.

Instead of navigating Firefly III's interface, Oxidize provides:

- **At-a-glance balance history** — see how your net worth trends over time
- **Earned vs. spent breakdowns** — track income and expenses by day, week, month, or quarter
- **Customizable dashboard** — add, remove, and arrange widgets to show exactly what matters to you
- **Monthly summaries** — quick snapshots of income, expenses, and savings rate

Oxidize acts as a proxy between your browser and the Firefly III API. Your credentials never leave your server, and data is cached locally to reduce load on Firefly III.

## Features

- **Real-time charts** powered by Chart.js — balance history, earned/spent, expenses by category, and net worth
- **Configurable dashboard** — drag, resize, and customize widgets with per-chart settings (line tension, point display, area fill, axis limits)
- **Account groups** — bundle accounts together for easier filtering across widgets
- **Dark/light theme** — toggle between themes; your preference persists in the browser
- **Server-side caching** — in-memory cache with 5-minute TTL reduces Firefly III API calls
- **SQLite persistence** — widgets and groups are stored locally in a SQLite database
- **Docker support** — single-command deployment with a multi-stage build for a minimal final image
- **No build step** — the frontend is vanilla JavaScript with no framework dependencies

## Architecture Overview

```
Browser (vanilla JS + Chart.js)
    │
    ▼
Oxidize Server (Actix-Web, Rust)
    │
    ├─► Static file serving (HTML, CSS, JS)
    ├─► API endpoints (account data, widgets, groups)
    │       │
    │       ▼
    │   FireflyClient
    │       ├─► In-memory DataCache (TTL: 5 min)
    │       └─► Firefly III REST API
    │
    └─► Storage (SQLite)
            └─► Widgets & Groups
```

Key design points:

- **Proxy pattern**: Oxidize forwards requests to Firefly III, avoiding CORS issues and keeping your API token server-side.
- **Cache-aside**: Data is cached in memory for 5 minutes. You can manually refresh any cache via POST endpoints.
- **Date chunking**: Large date ranges are automatically split into 90-day chunks to prevent API timeouts.
- **SSRF protection**: The Firefly III URL is validated to prevent pointing at internal/private addresses.
