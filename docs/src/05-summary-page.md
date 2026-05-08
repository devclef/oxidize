# Summary Page

The summary page (`/summary`) provides a monthly and quarterly overview of your financial activity. It shows income, expenses, savings, and savings rate in a clean tabular format.

## Monthly Overview

The monthly view displays a table where each row represents a month and shows:

| Column | Description |
|--------|-------------|
| **Month** | The month and year (e.g., "January 2026") |
| **Income** | Total money earned/inflow for the month |
| **Expenses** | Total money spent/outflow for the month |
| **Savings** | Income minus expenses |
| **Savings Rate** | Savings as a percentage of income |

## Quarterly View

When you select the **3M** (quarterly) period, the summary aggregates monthly data into quarters:

- Four months are grouped into each quarter
- Income and expenses are summed within each quarter
- Savings rate is recalculated from the quarterly totals

## Filters

The summary page supports several filters:

### Month/Year Picker

Select a specific month to view its summary details. Navigating between months updates the table to show data from that month forward (or backward, depending on your range).

### Account Filter

Filter the summary to include only specific accounts:

- **All accounts** — includes all account types in the calculation
- **Specific accounts** — select individual accounts to include
- **Account groups** — if you've created groups, they appear as filter options

### Account Type Filter

Like the main page, you can filter by account type (asset, cash, expense, revenue, liability). This controls which accounts appear in the selector dropdown.

## How Savings Rate is Calculated

```
savings_rate = ((income - expenses) / income) * 100
```

If income is zero, the savings rate is displayed as `0.00%`. Negative savings (expenses exceed income) are shown as a negative percentage.
