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
GET /api/budgets/spent?start=2026-01-01&end=2026-01-31&exclude_budgets[]=Work
```

Returns spent per budget for the period.

### Spending History

```
GET /api/budgets/spent-history?start=2026-01-01&end=2026-06-01&period=1M&accounts[]=1
```

Returns spend per budget broken down by period. Supports exclusions.

### Budget Breakdown

```
GET /api/budgets/breakdown?start=2026-01-01&end=2026-06-01&period=1M&by=category&budgets[]=Groceries
```

Selected budgets' spend over time, one series per full category (`by=category`, default), per main category (`by=main_category`) or per destination account (`by=destination`). Empty `budgets[]` = all budgeted spend. Supports `accounts[]` and exclusions.

### Budget List

```
GET /api/budgets/list?start=2026-01-01&end=2026-01-31
```

Returns all budgets.

### Budget Comparison

```
GET /api/budgets/comparison?start=2026-01-01&end=2026-12-31&budget_names=Groceries
```

Returns this year vs last year per budget, with projections against budget limits. `budget_names` is repeatable. Supports exclusions.

### Average Cost

```
GET /api/budgets/avg-cost?budget_names=Groceries&mode=last_n_months&months=6
GET /api/budgets/avg-cost?budget_names=Groceries&mode=previous_year_same_month&month=12&year=2026
```

Returns the average monthly cost per budget. `account_ids` (comma-separated) restricts accounts. Supports exclusions.

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
GET /api/sankey/flows?start=2026-01-01&end=2026-06-01&accounts[]=1&flow_type=category
```

Returns source-to-destination flow data for the Sankey widget. `flow_type` is `destination` (default), `category`, `subcategory` or `budget`; optional `categories[]`, `subcategories[]`, `budgets[]` and exclusions.

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

## Card Paydown

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/card-paydown` | Credit card paydown analysis (`start`, `end`, `accounts[]`) |
| POST | `/api/card-paydown/refresh` | Clear card paydown cache |

## Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/subscriptions` | All Firefly III subscriptions (bills) |
| GET | `/api/subscriptions/groups` | Object groups that contain subscriptions (with their bill ids) |
| GET | `/api/subscriptions/spend` | Cost over time per subscription (`start`, `end`, `period`, `subscriptions[]`, `groups[]`, `accounts[]`, `split_groups`, exclusions). Empty selection = all subscriptions; each selected group is one series unless `split_groups=1` |

## Spending Labels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/labels` | List labels |
| POST | `/api/labels` | Create a label (name, color, description, category entries) |
| PUT | `/api/labels/{id}` | Update a label |
| DELETE | `/api/labels/{id}` | Delete a label |
| GET | `/api/labels/budget-composition` | Per-label shares of one budget's spend + per-category breakdown (`budget`, `start`, `end`) |
| GET | `/api/labels/spend` | Spend per label over time (`start`, `end`, `period`, `budgets[]`, `include_unlabeled`) |
| GET | `/api/labels/unlabeled-categories` | Categories with spend that match no label, across all budgets (`start`, `end`, `budgets[]`) |
| GET | `/api/labels/transactions` | Every transaction matching one label (`label`, `start`, `end`, `budgets[]`, `include_unbudgeted`) |

## Monthly Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/summary/month` | One month's totals, budgets, categories, daily series, 12-month trend and top expenses (`year`, `month`, `accounts[]`, `exclude_accounts[]`, exclusions). Future months return 400 |

## Reimbursements

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reimbursements/summary` | Work expenses vs reimbursements (`start`, `end`, `expense_categories[]`, `expense_budgets[]`, `reimbursement_categories[]`) |
| POST | `/api/reimbursements/refresh` | Clear reimbursement cache |

## Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Effective settings (saved values over env defaults) + form metadata |
| PATCH | `/api/settings` | Update settings; an empty value reverts to the env default |
| POST | `/api/settings/test-firefly` | Test a URL/token pair against Firefly III |

Optional pages that are disabled in Settings return 404 from their page and API endpoints.

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
