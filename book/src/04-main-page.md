# Main Page

The main page (`/`) is the landing view when you first open Oxidize. It provides a quick way to explore your financial data and save charts as dashboard widgets.

## Balance Chart

The main page renders a balance history chart using Chart.js. The chart:

- Shows your account balance trends over a configurable date range
- Aggregates multiple accounts into a single line
- Supports four time periods: **1D** (daily), **1W** (weekly), **1M** (monthly), **3M** (quarterly)
- Anchors to your current balance — the rightmost point reflects your actual account balance right now

## Account Selection

At the top of the page, you'll find an account selector:

- **All Accounts** — shows the combined balance of all selected account types
- **Individual accounts** — filter to a specific account by name
- **Account type filter** — a dropdown above the selector limits which account types are shown (assets, cash, expense, revenue, liability)

To change which account types appear, adjust the `ACCOUNT_TYPES` environment variable when starting Oxidize.

## Date Ranges & Periods

### Date Range

Use the date range picker to select the start and end dates for your chart. Common presets:

| Preset | Range |
|--------|-------|
| Last 30 days | Today − 30 days → Today |
| Last 90 days | Today − 90 days → Today |
| This year | January 1 → Today |
| Custom | Any start/end combination |

The Firefly III API handles date ranges up to 90 days at a time. Oxidize automatically splits longer ranges into chunks behind the scenes.

### Period

The period selector determines how data is grouped on the chart:

| Period | Label | Description |
|--------|-------|-------------|
| `1D` | Daily | One data point per day |
| `1W` | Weekly | One data point per week |
| `1M` | Monthly | One data point per month |
| `3M` | Quarterly | One data point per quarter |

## Saving to Widget

Once you've configured a chart you like, click **"Save as Widget"** to add it to your dashboard:

1. Select your accounts
2. Set your date range
3. Choose a period
4. Click **"Save as Widget"**
5. A dialog appears asking for a widget name and chart settings
6. Confirm, and the widget is created and added to your dashboard

You can then visit `/dashboard` to see your new widget alongside any others.
