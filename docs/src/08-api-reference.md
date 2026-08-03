# API Reference

All API endpoints return JSON. Query parameters use `YYYY-MM-DD` date format unless noted.

## Accounts

### List Accounts

```
GET /api/accounts?type=asset
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `type` | No | Comma-separated account types to include |

**Response:** Array of `SimpleAccount` objects:

```json
[
  {"id": "1", "name": "Checking", "balance": "1234.56", "currency": "USD", "account_type": "asset"}
]
```

### Balance History

```
GET /api/accounts/balance-history?accounts[]=1&start=2026-01-01&end=2026-06-01&period=1M
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `accounts[]` | Yes | Account IDs (repeatable) |
| `start` | Yes | Start date |
| `end` | Yes | End date |
| `period` | No | `1D`, `1W`, `1M`, `3M` (default: `1M`) |

**Response:** `ChartLine` with labeled datasets and date-value entries.

## Charts

### Earned & Spent

```
GET /api/earned-spent?start=2026-01-01&end=2026-06-01&period=1M&accounts[]=1
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `start` | Yes | Start date |
| `end` | Yes | End date |
| `period` | No | `1D`, `1W`, `1M`, `3M` |
| `accounts[]` | No | Account IDs to include |

### Earned & Spent (Since)

```
GET /api/earned-spent/since?start=2026-01-01&period=1M&accounts[]=1
```

Same as earned-spent but uses today as the end date.

### Expenses by Category

```
GET /api/expenses-by-category?start=2026-01-01&end=2026-06-01&accounts[]=1
```

Returns expenses grouped by category.

### Net Worth

```
GET /api/net-worth?start=2026-01-01&end=2026-06-01&period=1M
```

Returns net worth (assets minus liabilities) over time.

## Budgets

### Current Spending

```
GET /api/budgets/spent?budget_id=1&start=2026-01-01&end=2026-01-31&accounts[]=1
```

Returns spending against a specific budget for a date range.

### Spending History

```
GET /api/budgets/spent-history?budget_id=1&start=2026-01-01&end=2026-06-01&period=1M
```

Returns budget spending broken down by period.

### Budget List

```
GET /api/budgets/list?start=2026-01-01&end=2026-01-31&accounts[]=1
```

Returns all budgets with their allocated amounts for a period.

### Budget Comparison

```
GET /api/budgets/comparison?start=2026-01-01&end=2026-01-31&accounts[]=1
```

Returns budgeted vs actual spending for all budgets in the period.

### Average Cost

```
GET /api/budgets/avg-cost?account_id=1&start=2026-01-01&end=2026-06-01
```

Returns average cost per transaction for an account over a date range.

### Refresh Budget Cache

```
POST /api/budgets/spent/refresh
```

Clears the budget spent cache.

## Categories

### Category List

```
GET /api/categories/list
```

Returns all transaction categories from Firefly III.

### Subcategory Spending

```
GET /api/categories/subcategory-spend?start=2026-01-01&end=2026-06-01&accounts[]=1
```

Returns spending broken down by subcategory.

## Dashboards

### List Dashboards

```
GET /api/dashboards
```

Returns all dashboards.

### Get Dashboard Widgets

```
GET /api/dashboards/{id}/widgets
```

Returns widgets for a specific dashboard.

### Create Dashboard

```
POST /api/dashboards
Content-Type: application/json

{"name": "My Dashboard"}
```

### Update Dashboard

```
PUT /api/dashboards/{id}
Content-Type: application/json

{"name": "Updated Name"}
```

### Delete Dashboard

```
DELETE /api/dashboards/{id}
```

## Sankey

### Flow Data

```
GET /api/sankey/flows?start=2026-01-01&end=2026-06-01&accounts[]=1
```

Returns source-to-destination flow data for the Sankey diagram.

## Widgets

### List

```
GET /api/widgets
```

Returns all widgets ordered by `display_order`, then `created_at` descending.

### Create

```
POST /api/widgets
Content-Type: application/json

{
  "id": "uuid-here",
  "name": "My Chart",
  "accounts": ["1", "2"],
  "start_date": "2026-01-01",
  "end_date": "2026-06-01",
  "interval": "1M",
  "widget_type": "balance",
  "chart_type": "line",
  "chart_options": {"show_points": true, "fill_area": false, "tension": 0.4},
  "display_order": 0,
  "width": 12,
  "chart_height": 300
}
```

### Update

```
PUT /api/widgets/{id}
```

Path `id` must match body `id`. Partial updates supported.

### Delete

```
DELETE /api/widgets/{id}
```

## Groups

### List

```
GET /api/groups
```

Returns all groups ordered by `created_at` descending.

### Create

```
POST /api/groups
Content-Type: application/json

{"id": "uuid-here", "name": "Checking", "account_ids": ["1", "2"]}
```

At least one `account_id` is required.

### Update

```
PUT /api/groups/{id}
```

Path `id` must match body `id`.

### Delete

```
DELETE /api/groups/{id}
```

## Cache Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/refresh` | Clear all caches |
| POST | `/api/accounts/refresh` | Clear accounts cache |
| POST | `/api/accounts/balance-history/refresh` | Clear balance history cache |

All return `{"success": true, "message": "..."}`.

## Static

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/manifest` | PWA manifest |
| GET | `/favicon.ico` | Favicon |
| GET | `/static/*` | Static files from `./static/` |
