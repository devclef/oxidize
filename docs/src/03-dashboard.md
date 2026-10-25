# Dashboard

The dashboard (`/dashboard`) is your customizable financial overview. It displays widgets -- individual chart cards that show balance history, earned/spent data, and more.

## Widgets

### Adding Widgets

Widgets are built in the Widget Builder (`/`): configure a chart, then click
**"Save as widget"**. Every widget type is built there, including **Sankey
Flow** diagrams.

Every widget's **Settings** panel can change everything it was built with:
its type, accounts/groups, categories, budgets, subscriptions, date range
(a relative preset, "last N", fixed dates or the dashboard's range, with
optional end-of-month rounding), interval, display options and exclusions.
Changes are saved with **Update**; the card's tags and badges update right
away.

### Widget Types

| Type | Shows |
|------|-------|
| **Balance** | Account balances over time, anchored to current balances; optionally compared with the previous period (total or per account) |
| **Earned & Spent** | Income and expenses over time as lines, bars or a delta view |
| **Budget Spent** | Spend per budget over time |
| **Expenses by Category** | Spend grouped by category |
| **Category / Subcategory** | Spend per subcategory of selected categories |
| **Net Worth** | Assets minus liabilities over time |
| **Card Paydown** | Credit card balances and paydown progress |
| **Saved this Month** | A stat tile with this month's savings |
| **Sankey Flow** | Money flowing from accounts to destinations, categories, subcategories or budgets (see [Sankey Flow](./07-sankey.md)) |
| **Spending by Label** | One series per [spending label](./13-spending-labels.md), plus an optional "Unlabeled" series |
| **Subscription Cost** | Cost over time of selected Firefly III subscriptions ("bills") or subscription groups; empty selection = all subscriptions. Groups chart as one total each unless **Split groups** is on |
| **Budget Breakdown** | Where a budget's money goes: one series per full category (`Parent:Sub`), per main category, or per destination account |

### Chart Types

Most widgets can be drawn as:

- **Line** (default) - with configurable smoothness, fill, points and optional stacking
- **Pie** - a doughnut with the total in the center, slices sorted largest-first and anything past the eighth slice folded into a neutral "Other"

### Managing Widgets

Each widget has inline controls:

| Action | Description |
|--------|-------------|
| **Settings** | Change type, name, accounts, dates, period, chart settings |
| **Delete** | Remove permanently |
| **Refresh** | Fetch fresh data from Firefly III (bypasses cache) |
| **Drag** | Reorder on the grid |

Widgets are displayed in a responsive CSS grid. Each widget can be 6 columns (half-width) or 12 columns (full-width).

## Groups

### Creating Groups

Groups bundle accounts together for reuse across widgets.

1. On the dashboard, click **"Manage Groups"**
2. Click **"Create New Group"**
3. Enter a name (e.g., "Checking Accounts", "Investments")
4. Select accounts to include
5. Click **Save**

### Using Groups

When creating or editing a widget, you can select a group instead of picking individual accounts. Groups appear in the account selection dropdown.

## Chart Settings

A widget's **Settings** panel offers the same options as the Widget Builder; only the options that apply to the widget's type are shown.

| Setting | Description |
|---------|-------------|
| **Style / chart type** | Line, bar or pie (depends on the widget type) |
| **Stacked** | Stack series on line charts |
| **% change** | Show values as percentage change |
| **Compare with previous period** | Overlay the previous period (balance widgets) |
| **Trend line** | Dotted moving-average line |
| **Points / Fill / Smoothness** | Line appearance |
| **Grid lines** | Per-chart grid lines (on by default) |
| **Axis limits / Begin at zero** | Override the axis bounds |
| **Exclusions** | Categories or budgets to drop from this widget |

Changes are saved with **Update** and persist across reloads.

## Exclusions

Categories or budgets can be excluded *entirely* from charts - for example a "Work expenses" category that is later reimbursed:

- **Per dashboard** - the gear button next to the dashboard's date range applies exclusions to every widget on it.
- **Per widget** - in the widget's Settings panel.

The effective set is the union of both. A category entry matches a whole category (all subcategories) or a single `Parent:Sub` subcategory.
