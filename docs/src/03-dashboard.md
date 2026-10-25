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

**Balance** - Account balances over time as a line or pie chart. Balances are anchored to current values and calculated backwards using daily flow deltas. Multiple accounts are aggregated into a single line.

**Earned & Spent** - Income and expenses over time as dual lines, bars, or a delta view. Calculated from Firefly III transactions, grouped by the selected period.

### Chart Types

Widgets support multiple chart renderings:

- **Line** (default) - standard line chart with configurable tension, fill, and point display
- **Pie** - slice data by value, sorted largest-first

### Managing Widgets

Each widget has inline controls:

| Action | Description |
|--------|-------------|
| **Edit** | Change name, accounts, dates, period, chart settings |
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

Click the settings icon on a widget to adjust:

| Setting | Default | Description |
|---------|---------|-------------|
| **Line Tension** | `0.4` | Smoothness. `0` = straight, `1` = fully curved |
| **Show Points** | `true` | Display data point markers |
| **Fill Area** | `false` | Fill area under the line |
| **Y-Axis Min/Max** | *auto* | Override axis bounds |
| **X-Axis Min/Max** | *auto* | Override axis bounds |
| **Begin At Zero** | `false` | Force Y axis to start at 0 |
| **Show Percentage** | `false` | Display as percentages (Earned & Spent) |

Changes save immediately and persist across reloads.
