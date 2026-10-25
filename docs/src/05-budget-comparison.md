# Budget Comparison

The budget comparison page (`/budget-comparison`) compares this year's spending per budget with last year's, and projects the year against your Firefly III budget limits.

## Overview

Select one or more budgets (**Select all** / **Deselect all** are available) to see:

- **Monthly spending comparison** - this year vs last year, month by month
- **Cumulative spending** - running totals for both years
- **Summary per budget** - year-to-date spend, projected annual spend, previous year's total, and how the projection compares with the budget limit and with last year

Category and budget exclusions are honored, so excluded spend never reaches the comparison.

This page is optional: it is enabled by default and can be turned off under [Settings](./14-settings.md).

## API

```
GET /api/budgets/comparison?start=2026-01-01&end=2026-12-31&budget_names=Groceries&budget_names=Dining
```
