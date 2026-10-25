# Monthly Summary

The Monthly Summary page (`/summary`) shows one month at a glance:

- **Totals** - income, spending and net, with month-over-month deltas (for the current month, compared with the same days of last month)
- **Budgets** - spend per budget against its limit
- **Spending by category**
- **Largest expenses**
- **Daily cash flow**
- **12-month trend**
- **Net worth**, measured from the end of the previous month

Everything is built from one pass over the same transactions, so budget spend plus unbudgeted spend equals the category total equals total spending, and the trend matches the totals.

## Navigation

- The selected month lives in the URL (`/summary?month=2026-10`), so it can be bookmarked.
- Step months with the ‹ / › buttons or the left/right arrow keys; **This month** jumps back.
- **Refresh** clears the server-side cache and reloads.
- Future months cannot be selected.

## Account filter

The **Accounts** picker can either include only certain accounts or exclude accounts (any transaction touching an excluded account is dropped). The filter is remembered in the browser; **Reset** clears it. Budget limits and net worth always cover all accounts.

## Enabling

The page is **disabled by default**. Turn it on under [Settings](./14-settings.md) (`monthly_summary_enabled`).

## API

```
GET /api/summary/month?year=2026&month=10&exclude_accounts[]=12
```
