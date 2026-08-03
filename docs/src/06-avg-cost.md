# Average Cost

The average cost page (`/avg-cost`) calculates the average cost per transaction for a selected account and date range.

## Overview

Select an account and date range to compute:

- **Average cost per transaction** - total spending divided by transaction count
- **Total spending** - sum of all outgoing transactions in the range
- **Transaction count** - number of transactions in the range

## Use Cases

- Track average spending per grocery store visit
- Calculate average monthly utility costs
- Analyze recurring expense patterns

## API

```
GET /api/budgets/avg-cost?account_id=1&start=2026-01-01&end=2026-06-01
```
