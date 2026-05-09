# Spec: Budget Spent Over Time Chart

## Problem

Oxidize currently has no support for Firefly III budgets. Users cannot track how much they've spent per budget over time on their dashboard. Firefly III provides a `GET /v1/chart/budget/overview` chart endpoint, but it returns ALL budgets with no per-budget selection filter. Users need to be able to select which budgets to display and see their spending over time.

## Solution

Add a new widget type `budget_spent` that renders a bar chart showing per-budget spending over time. Users select which budgets to display via a multi-select in the widget editor. The backend fetches the budget overview chart from Firefly III and optionally filters the response to only the selected budgets.

## Architecture

```
User selects budgets in widget editor
    │
    ▼
PUT /api/widgets/{id}  (stores selected budget_ids in widget JSON)
    │
    ▼
renderWidgetChart() dispatches to budget_spent path
    │
    ▼
GET /api/budgets/spent?start=&end=&budget_ids[]=
    │
    ▼
FireflyClient.get_budget_spent()
    │
    ▼
GET /v1/chart/budget/overview (Firefly III)
    │
    ▼
Filter ChartLine datasets to selected budgets (by label match)
    │
    ▼
Return ChartLine as JSON → render as Chart.js bar chart
```

## Design Decisions

### 1. Budget Selection Storage

Budget selections are stored in the existing `accounts` field of the Widget model, repurposed to hold budget IDs as strings. The widget struct already has `accounts: Vec<String>` which stores JSON-serialized account ID strings. We'll add a new field `budget_ids: Vec<String>` to the Widget model to keep budget and account selections separate and clear.

**Rationale:** Reusing `accounts` would conflate two different entity types and cause ambiguity in the frontend dispatch logic. A dedicated `budget_ids` field is cleaner and follows the existing `group_ids` pattern.

### 2. Chart Type

Use a **bar chart** (not line). Firefly III's own budget overview chart is bar-oriented. Each bar group shows one budget's spending at each time point, with bars grouped by date. This matches user expectations for budget tracking.

### 3. Period Support

The Firefly III `GET /v1/chart/budget/overview` endpoint does **not** accept a `period` parameter — only `start` and `end`. The data returned is daily granularity. We have two options:

- **Option A (recommended):** Fetch daily data and let Chart.js handle the visual grouping. The widget's `interval` setting controls the X-axis label formatting, not the data granularity. This is simpler and consistent with how other charts work.
- **Option B:** Aggregate daily data server-side into period buckets (1D, 1W, 1M, 3M) in the Rust handler, matching the pattern used by `get_balance_history`.

**Decision: Option B** — aggregate server-side to keep the frontend chart rendering consistent with existing widget patterns. This also reduces data transferred for wide date ranges.

### 4. Currency Handling

Budgets in Firefly III can be multi-currency. The `ChartLine` from `/v1/chart/budget/overview` contains separate `ChartDataSet` entries per budget per currency. We filter by budget label (name), then preserve all currency datasets for that budget.

### 5. No Account Filtering

Budgets in Firefly III are independent of account filters. The `chart/budget/overview` endpoint has no account parameter. Account selection on the widget is ignored for `budget_spent` type. We display a note that budgets are global.

### 6. "All Budgets" Default

When no budgets are selected, show all budgets (same as Firefly III's default behavior). The widget editor shows a checkbox list with "Select all" / "Deselect all" buttons.

## Implementation Plan

### Step 1: Backend — Budget Models

**File:** `src/models/budget.rs` (new)

```rust
pub struct BudgetRead {
    pub id: String,
    pub name: String,
    pub active: bool,
}

pub struct BudgetListResponse {
    pub budgets: Vec<BudgetRead>,
}
```

Deserializes the Firefly III `GET /v1/budgets` response (wrapped in `{"data": [...]}`).

**File:** `src/models/mod.rs` — add `pub mod budget;` and re-export.

### Step 2: Backend — FireflyClient Method

**File:** `src/client/mod.rs` — add method:

```rust
async fn get_budget_spent(
    &self,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<ChartLine, String>
```

- Calls `GET /v1/chart/budget/overview`
- Uses default dates (30 days ago to today) if not provided
- Caches result in a new `budget_spent` cache entry (keyed by start/end)
- Returns `ChartLine` (same type as balance history)

**File:** `src/client/mod.rs` — add method:

```rust
async fn get_budgets(
    &self,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<BudgetRead>, String>
```

- Calls `GET /v1/budgets` with optional date range (to get spent info)
- Returns list of all budgets for the selector
- Caches result in `budgets` cache entry

**File:** `src/cache.rs` — add `budget_spent` and `budgets` cache entries.

### Step 3: Backend — API Handler

**File:** `src/handlers/account.rs` — add route:

```
GET /api/budgets/spent?start=&end=
```

Handler parses query params, calls `client.get_budget_spent()`, returns `ChartLine`.

**File:** `src/handlers/account.rs` — add route:

```
GET /api/budgets/list?start=&end=
```

Handler parses query params, calls `client.get_budgets()`, returns `Vec<BudgetRead>`.

Register routes in `src/main.rs`.

### Step 4: Frontend — Budget Selector UI

**File:** `static/dashboard.js` — add function:

```javascript
async function renderBudgetSelector(container, selectedBudgetIds)
```

Renders a multi-select UI with:
- Checkbox list of all budgets (fetched via `GET /api/budgets/list`)
- "Select All" / "Deselect All" buttons
- Scrollable container (budgets can be numerous)
- Visual indication of selected budgets

**File:** `static/dashboard.js` — modify `toggleWidgetSettings()`:

When `widget.widget_type === 'budget_spent'`, show the budget selector panel instead of the account selector.

### Step 5: Frontend — Widget Type Dispatch

**File:** `static/dashboard.js` — modify `renderWidgetChart()`:

Add `budget_spent` case:
1. Fetch budgets list (or use cached)
2. Fetch chart data via `GET /api/budgets/spent?start=&end=`
3. Filter datasets to selected budget names (match by `ChartDataSet.label`)
4. Render as Chart.js bar chart with existing chart options

**File:** `static/dashboard.js` — modify `renderDashboard()`:

Add `"Budget Spent"` option to the widget type dropdown in the "Add Widget" dialog.

### Step 6: Frontend — Graph Builder Support

**File:** `static/app.js` — modify `fetchChartData()`:

Add `budget_spent` case that calls `GET /api/budgets/spent`.

Add budget selector UI on the Graph Builder page for the budget_spent chart type.

### Step 7: Frontend — Chart Styles

**File:** `static/style.css` — add styles for:
- Budget selector checkbox list
- Selected/deselected states
- Scrollable budget list container

### Step 8: Tests

**File:** `tests/oxi_budget_spent_chart.rs` (new)

- Mock `GET /v1/chart/budget/overview` → return sample ChartLine
- Mock `GET /v1/budgets` → return sample budget list
- Test handler returns correct ChartLine
- Test filtering by budget name
- Test caching behavior

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/models/budget.rs` | New | BudgetRead model |
| `src/models/mod.rs` | Edit | Add budget module |
| `src/cache.rs` | Edit | Add budget_spent & budgets cache entries |
| `src/client/mod.rs` | Edit | Add get_budget_spent() & get_budgets() |
| `src/handlers/account.rs` | Edit | Add /api/budgets/spent & /api/budgets/list routes |
| `src/main.rs` | Edit | Register new routes |
| `static/dashboard.js` | Edit | Budget selector UI, widget type dispatch |
| `static/app.js` | Edit | Graph builder budget_spent support |
| `static/style.css` | Edit | Budget selector styles |
| `tests/oxi_budget_spent_chart.rs` | New | Backend integration tests |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Firefly III budget API returns all currencies mixed in one ChartLine | Filter by label (budget name) which is unique per budget |
| Large number of budgets → slow selector rendering | Paginate or virtualize the checkbox list; debounce search |
| Budget names change in Firefly III → stale widget data | On fetch, skip datasets whose labels don't match any known budget; log warning |
| No period support in Firefly III API | Aggregate daily data server-side in Rust (Option B) |
| Multi-currency budgets show duplicate labels | Group by (label, currency_code) for unique dataset identification |

## Out of Scope

- Budget limit tracking (how much vs. budgeted amount) — could be a future widget type
- Budget alerts/notifications
- Per-account budget filtering (Firefly III doesn't support this at the chart API level)
- Available budgets (Firefly III 6.x "Available Budget" feature) — separate from regular budgets
