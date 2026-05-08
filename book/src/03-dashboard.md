# Dashboard

The dashboard (`/dashboard`) is your customizable financial overview. It displays widgets — individual chart cards that show balance history, earned/spent data, and more.

## Widgets

### Adding Widgets

You have two ways to add widgets to your dashboard:

1. **From the main page**: After configuring a balance chart on the home page (`/`), click **"Save as Widget"** to create a dashboard widget from your current selection.

2. **From the dashboard**: Click the **"Add Widget"** button to create a new widget. You'll be prompted to:
   - Choose a widget type (Balance or Earned & Spent)
   - Give it a name
   - Select accounts (or use a group)
   - Set a date range
   - Choose a time period (1D, 1W, 1M, 3M)
   - Configure chart display settings

### Balance Chart

The **Balance** widget shows your account balances over time as a line chart.

- Data is fetched from Firefly III's balance chart endpoint
- Balances are calculated using an "anchor balance" method: the chart starts from your current balance and works backward using daily flow deltas
- Multiple accounts are aggregated into a single line (sum of all selected account balances)
- Supports periods: daily (1D), weekly (1W), monthly (1M), quarterly (3M)

### Earned & Spent

The **Earned & Spent** widget displays income and expenses over time as dual lines on a chart.

- Income (earned) and expenses (spent) are calculated from your Firefly III transactions
- Each period bucket shows the total earned and total spent for that interval
- The period granularity (1D, 1W, 1M, 3M) determines how data is grouped
- Only accounts you select are included in the calculation

### Managing Widgets

On the dashboard page, each widget has inline controls:

| Action | Description |
|--------|-------------|
| **Edit** | Open the widget editor to change name, accounts, dates, period, and chart settings |
| **Delete** | Remove the widget from the dashboard (permanently) |
| **Refresh** | Force a fresh data fetch from Firefly III (bypasses the 5-minute cache) |
| **Drag** | Drag the widget header to reorder it on the grid |

Widgets are displayed in a responsive CSS grid. Each widget can be 6 columns (half-width) or 12 columns (full-width).

## Groups

### Creating Groups

Groups let you bundle accounts together for reuse across widgets. To create a group:

1. On the dashboard, click **"Manage Groups"**
2. Click **"Create New Group"**
3. Enter a group name (e.g., "Checking Accounts", "Investments")
4. Select the accounts to include
5. Click **Save**

### Using Groups

When creating or editing a widget, you can select a group instead of picking individual accounts. This makes it easy to:

- Apply the same account filter to multiple widgets
- Quickly switch between different account groupings
- Keep widget configuration clean and semantic

Groups are listed at the bottom of the account selection dropdown when creating or editing a widget.

## Chart Settings

Each widget supports detailed chart customization. Click the **settings** icon (gear) on a widget to adjust:

| Setting | Default | Description |
|---------|---------|-------------|
| **Line Tension** | `0.4` | Smoothness of the chart line. `0` = straight segments, `1` = fully curved |
| **Show Points** | `true` | Display data point markers on the line |
| **Fill Area** | `false` | Fill the area under the line with a semi-transparent color |
| **Y-Axis Min** | *auto* | Minimum value for the Y axis. Leave empty for auto |
| **Y-Axis Max** | *auto* | Maximum value for the Y axis. Leave empty for auto |
| **X-Axis Min** | *auto* | Minimum value for the X axis. Leave empty for auto |
| **X-Axis Max** | *auto* | Maximum value for the X axis. Leave empty for auto |
| **Begin At Zero** | `false` | Force the Y axis to start at zero |
| **Show Percentage** | `false` | Display values as percentages (Earned & Spent only) |
| **Percentage Mode** | *—* | How percentages are calculated (Earned & Spent only) |

Changes are saved immediately and persist across page reloads.
