# Introduction

## What is Oxidize?

Oxidize is a lightweight web dashboard for [Firefly III](https://www.firefly-iii.org/). It connects to your Firefly III instance and presents your financial data through interactive charts and views.

Instead of navigating Firefly III's interface, Oxidize provides:

- **Widget Builder** - build a chart (balance, earned vs spent, budgets, categories, net worth, card paydown, Sankey flows, spending labels, subscription cost, budget breakdown, …) and save it as a dashboard widget
- **Configurable dashboards** - pin widgets to one or more dashboards, each with its own date range and exclusions
- **Budget comparison** - this year vs last year per budget, with projections against budget limits
- **Average cost** - average monthly cost per budget
- **Monthly summary** - one page for the month: income vs spending, budgets, categories, top expenses and a 12-month trend
- **Reimbursements** - work expenses vs the reimbursements that paid them back
- **Spending labels** - your own lenses over categories (e.g. "wants" vs "needs")

Oxidize acts as a proxy between your browser and the Firefly III API. Your token stays server-side, and data is cached to reduce load on Firefly III. Firefly III is never modified.

## Features

- **Multiple chart types** - line, bar and part-to-whole (doughnut) charts plus Sankey flows, powered by Chart.js and d3
- **Shared chart options** - the Widget Builder and every widget's Settings panel offer the same options (style, stacking, % change, comparison with the previous period, trend line, points/fill/smoothness, grid lines, axis limits, exclusions)
- **Relative date ranges** - "Last 30 days", "YTD" or "last N months" widgets keep moving with time
- **Category & budget exclusions** - drop categories or budgets entirely from charts, per widget or per dashboard
- **Account groups** - bundle accounts together for reuse across widgets
- **Dark/light theme** - "Slate & Teal" themes with colorblind-validated chart colors; preference persists in the browser
- **Caching** - in-memory TTL cache (default 1 hour, configurable)
- **Runtime settings** - change the Firefly III connection, account types, cache TTL, time ranges and optional pages without a restart
- **SQLite persistence** - dashboards, widgets, groups, labels and settings stored locally
- **PWA** - installable on Android, with an offline UI shell
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
    ├─► API endpoints (accounts, charts, budgets, labels, widgets, etc.)
    │       │
    │       ▼
    │   FireflyClient
    │       ├─► In-memory DataCache (TTL: CACHE_TTL, default 1 h)
    │       └─► Firefly III REST API
    │
    └─► Storage (SQLite)
            └─► Dashboards, Widgets, Groups, Labels, Settings
```

Key design points:

- **Proxy pattern**: Oxidize forwards requests to Firefly III, avoiding CORS issues and keeping your API token server-side.
- **Cache-aside**: Data is cached in memory for the configured TTL. Manual refresh is available from the UI and via POST endpoints.
- **Date chunking**: Large date ranges are split into 90-day chunks to prevent API timeouts.
- **SSRF protection**: The Firefly III URL is validated to prevent pointing at internal/private addresses.
