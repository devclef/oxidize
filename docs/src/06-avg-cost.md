# Average Cost

The average cost page (`/avg-cost`) calculates the average monthly cost of each selected budget.

## Overview

1. Select one or more **budgets** (and optionally restrict to certain **accounts**).
2. Pick a mode:
   - **Last N months** - the average over the last N months (default 6).
   - **Same month last year** - compare a month with the same month a year earlier; step months with the ◀ / ▶ buttons.
3. Click **Compute**.

Each budget's result shows the total and the monthly average for the window, and can be sorted. Category and budget exclusions are honored.

This page is optional: it is enabled by default and can be turned off under [Settings](./14-settings.md).

## Use Cases

- How much do groceries cost in an average month?
- Is this December more expensive than last December?
- Set realistic budget limits from real history

## API

```
GET /api/budgets/avg-cost?budget_names=Groceries&mode=last_n_months&months=6
GET /api/budgets/avg-cost?budget_names=Groceries&mode=previous_year_same_month&month=12&year=2026
```

`account_ids` (comma-separated) restricts the calculation to certain accounts.
