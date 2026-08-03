# Dashboard

The dashboard (`/dashboard`) is your customizable financial overview. It displays widgets -- individual chart cards that show balance history, earned/spent data, and more.

## Widgets

### Adding Widgets

You have two ways to add widgets:

1. **From the main page**: After configuring a chart on the home page (`/`), click **"Save as Widget"**.

2. **From the dashboard**: Click **"Add Widget"** and configure:
   - Widget type (Balance or Earned & Spent)
   - Name
   - Accounts (or use a group)
   - Date range
   - Period (1D, 1W, 1M, 3M)
   - Chart display settings

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
