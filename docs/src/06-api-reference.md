# API Reference

Oxidize exposes REST API endpoints for account data, cache management, widgets, and groups. All API endpoints return JSON (except the HTML page routes).

## Account Data

### List Accounts

```
GET /api/accounts?type=asset,cash
```

Returns a list of accounts from Firefly III. Optionally filter by comma-separated account types.

**Response:** Array of `SimpleAccount` objects

```json
[
  {
    "id": "1",
    "name": "Checking Account",
    "balance": "1234.56",
    "currency": "USD",
    "account_type": "asset"
  }
]
```

### Balance History

```
GET /api/accounts/balance-history?accounts[]=1&accounts[]=2&start=2026-01-01&end=2026-06-01&period=1M
```

Returns balance history data for the specified accounts and date range.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `accounts[]` | Yes | Account IDs to include (can be repeated) |
| `start` | Yes | Start date in `YYYY-MM-DD` format |
| `end` | Yes | End date in `YYYY-MM-DD` format |
| `period` | No | Aggregation period: `1D`, `1W`, `1M`, `3M` (default: `1M`) |

**Response:** `ChartLine` object with labeled datasets and date-value entries.

### Earned & Spent

```
GET /api/earned-spent?start=2026-01-01&end=2026-06-01&period=1M&accounts[]=1
```

Returns earned (income) and spent (expenses) data grouped by period.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `start` | Yes | Start date (`YYYY-MM-DD`) |
| `end` | Yes | End date (`YYYY-MM-DD`) |
| `period` | No | Aggregation period (`1D`, `1W`, `1M`, `3M`) |
| `accounts[]` | No | Account IDs to include |

### Expenses by Category

```
GET /api/expenses-by-category?start=2026-01-01&end=2026-06-01&accounts[]=1
```

Returns expenses grouped by category for the given date range.

### Net Worth

```
GET /api/net-worth?start=2026-01-01&end=2026-06-01&period=1M
```

Returns net worth (assets minus liabilities) over time.

### Monthly Summary

```
GET /api/summary/monthly?month=5&year=2026&account_ids=1,2&account_type=asset
```

Returns monthly income, expenses, savings, and savings rate.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `month` | Yes | Month number (1–12) |
| `year` | Yes | Year (e.g., `2026`) |
| `account_ids` | No | Comma-separated account IDs |
| `account_type` | No | Comma-separated account types |

## Cache Management

Oxidize caches Firefly III responses in memory for 5 minutes. You can manually invalidate caches:

### Clear All Caches

```
POST /api/refresh
```

### Clear Accounts Cache

```
POST /api/accounts/refresh
```

### Clear Balance History Cache

```
POST /api/accounts/balance-history/refresh
```

All three endpoints return a JSON success response:

```json
{"success": true, "message": "Cache cleared"}
```

## Widget CRUD

### List Widgets

```
GET /api/widgets
```

Returns all widgets ordered by `display_order`, then `created_at` descending.

### Create Widget

```
POST /api/widgets
Content-Type: application/json

{
  "id": "uuid-here",
  "name": "My Balance Chart",
  "accounts": ["1", "2"],
  "start_date": "2026-01-01",
  "end_date": "2026-06-01",
  "interval": "1M",
  "chart_mode": "line",
  "widget_type": "balance",
  "chart_options": {
    "show_points": true,
    "fill_area": false,
    "tension": 0.4
  },
  "display_order": 0,
  "width": 12,
  "chart_height": 300
}
```

### Update Widget

```
PUT /api/widgets/{id}
Content-Type: application/json

{
  "id": "uuid-here",
  "name": "Updated Name",
  ...
}
```

The path parameter `id` must match the `id` in the request body.

### Delete Widget

```
DELETE /api/widgets/{id}
```

## Group CRUD

### List Groups

```
GET /api/groups
```

Returns all groups ordered by `created_at` descending.

### Create Group

```
POST /api/groups
Content-Type: application/json

{
  "id": "uuid-here",
  "name": "Checking Accounts",
  "account_ids": ["1", "2", "3"]
}
```

At least one `account_id` is required.

### Update Group

```
PUT /api/groups/{id}
Content-Type: application/json

{
  "id": "uuid-here",
  "name": "Updated Group Name",
  "account_ids": ["1", "2"]
}
```

### Delete Group

```
DELETE /api/groups/{id}
```
