# Spending Labels

Spending labels (`/labels`) are your own named lenses over Firefly III categories, such as "wants" vs "needs" or "fixed" vs "variable". Labels live in Oxidize's own database; Firefly III is never modified.

## Defining labels

Click **+ New label**, give it a name, a color and an optional description, then add categories:

- A **whole category** (`Dining`) covers all of its subcategories.
- A **subcategory** (`Dining:Bars`) covers only that subcategory.

Labels are perspectives, not partitions: a category may sit in several labels (and is counted in each), and spend matching no label is reported as **Unlabeled**.

## Reports

- **Unlabeled spend** - every category with spend in a period that matches no label, across all budgets at once (amount, share of total, budgets charged to), so you can label it without switching budgets.
- **Budget composition** - a doughnut showing how one budget's spend splits across your labels, with a per-category breakdown.
- **Spend trend by label** - one line per label over time, optionally filtered by budget and with an Unlabeled series.
- **Transactions for a label** - every individual transaction matching a label in a period (date, payee, description, category, budget, account, amount), newest first, with optional unbudgeted spend. This is the drill-down that explains the aggregates.

## Editing from the breakdown

Click any row of the per-category breakdown to assign or remove labels for exactly that category or subcategory, or to create a new label on the spot. Removing a subcategory that is covered by a whole-category entry narrows that entry to the other subcategories instead of unlabeling them all.

## Dashboard widget

Labels are also available as the **Spending by Label** widget type: one line or doughnut slice per label (in each label's color), plus an optional Unlabeled series, optionally limited to certain budgets.

## Enabling

Enabled by default; toggle `labels_enabled` under [Settings](./14-settings.md).

## API

See [API Reference → Spending Labels](./08-api-reference.md#spending-labels).
