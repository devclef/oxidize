# Chart options & widget settings audit

I went through every chart option and setting on the **Graph Builder** (`/`,
`static/index.html` + `static/app.js`) and in the **dashboard widget
settings** (`/dashboard`, `static/dashboard.js`), for every widget type, and
checked three things for each one: is it offered, is it saved with the
widget, and does it actually change the chart.

Both pages now use one rule table, `OxiUI.widgetOptionSupport(type, state)`
in `static/ui.js`. It decides which options apply to a widget type, given
whether the chart is a line or a pie, the layout (combined or split) and the
earned/spent variant. The builder tags its controls with `data-opt="<key>"`,
and the dashboard settings panel is built from the same keys
(`buildWidgetSettingsHtml`). So a control appears on both pages or on
neither, and every control that appears has an effect.

Tests: `static/widget-options.test.js` (option table, builder/dashboard
parity for every type and state, saving, rendering) and
`src/models/widget.rs` (every `ChartOptions` field round-trips).

## Option matrix

✓ = offered and applied · – = not offered (hidden on both pages)

| Option | balance | earned_spent | multi-series¹ | net_worth | card_paydown | saved_this_month | sankey |
|---|---|---|---|---|---|---|---|
| Accounts / groups | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| Date range | ✓ | ✓ | ✓ | ✓ | ✓ | – (always current month) | ✓ |
| Interval | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Layout (combined/split) | ✓ (line) | – | – | – | – | – | – |
| Style (line/pie) | ✓ | ✓ | ✓ | – (no pie) | – | – | – |
| Variant | – | ✓ (line) | – | – | – | – | – |
| Stacked | split line only | – | ✓ (line) | – | – | – | – |
| Show % change + mode | ✓ (line) | – | ✓ (line) | ✓ | – | – | – |
| Compare with previous period | ✓ (line) | – | – | – | – | – | – |
| Show points / fill area / smoothness | ✓ (line) | – | ✓ (line) | ✓ | – | – | – |
| Y-axis from zero | ✓ (line) | delta line only | ✓ (line) | ✓ | – | – | – |
| X/Y-axis ticks | ✓ (line) | ✓ (line) | ✓ (line) | ✓ | – | – | – |
| Forecast | ✓ (line) | – | – | – | – | – | – |
| Trend line | ✓ (line) | ✓ (line) | ✓ (line) | ✓ | – | – | – |
| Exclusions | – | ✓ | ✓ | – | – | – | ✓ |

¹ `budget_spent`, `expenses_by_category`, `category_subcat`, `label_spend`,
`subscription_cost`, `budget_breakdown`. Type-specific data controls: budgets
(`budget_spent`, `label_spend`, `budget_breakdown`), group by
(`expenses_by_category`, `category_subcat`), include unlabeled
(`label_spend`), break down by (`budget_breakdown`), subscriptions
(`subscription_cost`), flow type (`sankey`).

## Fixed in this change

### Options that did nothing or were not saved
1. **Builder did not save the trend line.** `show_trendline` and
   `trendline_window` were never sent with a new widget, so a trend line
   built on `/` disappeared on the dashboard.
2. **Dashboard multi-series widgets ignored most display options.** Show
   points, fill area, line smoothness (hard-coded to 0.3), X/Y-axis ticks and
   show % change had no effect on budget spent, category, label,
   subscription and budget breakdown widgets. All six now go through one
   renderer, `renderMultiSeriesWidget`, which replaces four near-identical
   copies.
3. **Builder multi-series charts ignored points, fill and smoothness**
   (also hard-coded). They now use `OxiUI.applyLineStyle`. Stacked + fill
   draws a stacked area.
4. **% change never showed on dashboard net worth widgets** (the chart's
   `__pctOpts` was never set).
5. **Y-axis from zero was ignored by the earned/spent delta line** on both
   pages.
6. **Comparison charts** ignored "Show points" on the dashboard. On the
   builder they ignored "Fill area" and always drew points.

### Wrong behaviour
7. **% change had the wrong sign on the dashboard for negative values.** It
   divided by the signed base: a debt going from −100 to −50 showed −50%.
   Both pages now share `OxiUI.computePercentChange`, which divides by the
   size of the base, as the builder already did.
8. **The builder's "Compare with previous period" pre-fill was not the
   previous period.** It ended half a period before the start date, leaving
   a gap. Both pages now use `calculatePreviousPeriod` (`date-utils.js`): the
   same-length range that ends the day before. The dashboard now also
   pre-fills these dates when you enable the comparison.
9. **A balance widget with no `chart_mode` rendered as split**, while its
   settings said "Combined" and its badge said "undefined". It is now
   treated as combined everywhere.
10. **Changing the % change setting on the dashboard crashed** for widgets
    without a chart (no data or an error).
11. **Saving settings could be undone.** After "Update", changing the width
    or dragging the height saved an old cached copy of the widget, which
    reverted the settings just saved.
12. **Error messages stayed after a successful re-render**, and a "no data"
    message left the previous chart on screen.
13. **The legend from a split or multi-series chart stayed visible** after
    switching the widget to pie or combined.
14. **Hidden legend entries came back on re-render.** Series you hid in a
    multi-series widget's legend reappeared after a refresh or settings
    update, while the legend still showed them as hidden.
15. **The dashboard preset dropdown showed the default preset** ("30 Days")
    whatever the widget's stored dates were. It now selects the matching
    preset, or "Custom".
16. **"Use dashboard range" left the widget's own preset, custom range and
    round-end controls active**, so they edited dates that were then ignored.
    They are now disabled.
17. **The "Saved This Month" preview (including any error) stayed under
    other charts** in the builder after switching type.

### Settings missing or offered where they do not apply (harmonised)
18. The dashboard settings had **no way to change accounts or groups**, and
    **no budget filter for budget spent or label spend** widgets (the builder
    has both). Added. Accounts outside the account list stay selected, so
    saving never drops them. Balance and card paydown require at least one
    account or group, and budget breakdown requires a budget — the same
    checks as the builder.
19. **Options offered where they do nothing are now hidden on both pages:**
    the line/pie choice for net worth (no pie exists), all display options
    for card paydown, sankey and the saved tile, line options while "Pie" is
    selected, stacking on a single-series (combined) balance chart, % change
    on earned/spent bars, and date and interval controls on the saved tile.
    The dashboard re-checks visibility live when style, layout or variant
    changes. "% change mode" and the comparison dates only show while they
    are enabled.
20. **Same wording on both pages, in sentence case** (per CLAUDE.md):
    Layout, Style, Variant, Group by, Stacked (was "Stack Values"), Show %
    change, Show points, Fill area, Y-axis from zero, X/Y-axis ticks, Line
    smoothness, Window (points), and so on. The dashboard groups its
    settings as Data / Date range / Display / Exclusions / Width / Assign to
    dashboards.

> **Visible change for existing widgets:** the multi-series widgets now
> follow the saved options. With the defaults (fill area on, points off,
> smoothness 0.1) their lines are now lightly filled and have no point
> markers. Unstacked fills are drawn at 10% opacity so the lines stay easy
> to read.

## Open findings (to fix later)

| # | Where | Finding | Suggested fix |
|---|---|---|---|
| O1 | both | **Relative date presets are not stored.** A widget saves absolute `start_date`/`end_date`, so "Last 30 days" stays fixed to the day it was saved and never moves forward. Only "Use dashboard range" keeps a widget current. | Add a `relative_range` widget field (e.g. `30d`, or `{count, unit}`) and work out the dates at render time. |
| O2 | both | **"Round end date to month boundary" is only a one-off date helper.** The checkbox is not saved; on the dashboard only the mode is remembered, in localStorage per widget. | Save it together with O1. |
| O3 | dashboard | **You cannot change the category selection** (`parent_categories` / `subcategories`) of `category_subcat` widgets, or the widget type. | Reuse the builder's category tree in a settings dialog, or add an "Edit in Widget Builder" link that loads the widget into `/`. |
| O4 | dashboard | **The header tags and badges** (accounts, budgets, type mode) only update after a page reload when settings change. | Re-render the widget card header after a successful update. |
| O5 | both | **The builder's comparison preview draws every account plus its "(prev)" line**, while the dashboard draws one "Total Balance" line plus its previous period. The preview does not match the saved widget. | Pick one view (probably the total, following combined/split) and use it on both pages. |
| O6 | dashboard | **% change saves immediately** (for a live preview), while every other setting waits for "Update". | Make it preview-only and save on "Update", or save every display option live. |
| O7 | builder | **The Accounts section still shows for Net worth**, which ignores accounts (it always covers all assets and liabilities). | Hide it when `widgetOptionSupport(...).accounts` is false. |
| O8 | builder | **Sankey widgets can't be created in the Widget Builder** (they come from the Sankey page), but they are a dashboard widget type. | Add `sankey` to the builder type list, or note on the dashboard where they come from. |
| O9 | both | **Card paydown and sankey have fixed styling** (ticks, smoothness, points). The controls are hidden, so this is consistent, but they can't be customised. | Use `applyLineStyle`/`applyAxisOptions` in the card paydown renderer if wanted. |
| O10 | both | **Builder display options are remembered per browser** (localStorage) and carry over into the next widget you build. Dashboard options are per widget. | Fine as a convenience; maybe add a "reset to defaults" button in the builder. |
| O11 | dashboard | **Sankey widgets need d3 from the CDN.** If d3 is blocked, the widget fails with "No flow data for the selected filters", which is misleading. | Detect `typeof d3 === 'undefined'` and show a specific error. |
