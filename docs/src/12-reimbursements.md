# Reimbursements

The Reimbursements page (`/reimbursements`) compares work expenses you paid yourself with the reimbursements that paid them back.

## Markers

Under **Markers — what counts as what**, choose:

- **Work expense categories** and/or **work expense budgets** - spending in these counts as a work expense
- **Reimbursement categories** - income in these counts as a reimbursement

Category entries can be a whole category or a single `Parent:Sub` subcategory. Markers and the selected period are remembered in your browser.

## Report

Pick a period (this month, last month, 3/6/12 months, YTD) to see:

- Totals: work expenses, reimbursed, and what is still **outstanding** (or over-reimbursed)
- A month-by-month chart of work expenses vs reimbursed, with a monthly detail table
- Work expenses by category / budget and reimbursements by category

Tip: combine this with [category & budget exclusions](./03-dashboard.md#exclusions) to keep reimbursed work expenses out of your regular spending charts.

This page is optional: it is enabled by default and can be turned off under [Settings](./14-settings.md).

## API

```
GET /api/reimbursements/summary?start=2026-01-01&end=2026-06-30&expense_categories[]=Work&reimbursement_categories[]=Reimbursements
POST /api/reimbursements/refresh
```
