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
| Widget type (dashboard) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Accounts / groups | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| Date range (fixed or relative, end rounding) | ✓ | ✓ | ✓ | ✓ | ✓ | – (always current month) | ✓ |
| Interval | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Layout (combined/split) | ✓ (line) | – | – | – | – | – | – |
| Style (line/pie) | ✓ | ✓ | ✓ | – (no pie) | – | – | – |
| Variant | – | ✓ (line) | – | – | – | – | – |
| Stacked | split line only | – | ✓ (line) | – | – | – | – |
| Show % change + mode | ✓ (line) | – | ✓ (line) | ✓ | – | – | – |
| Compare with previous period | ✓ (line) | – | – | – | – | – | – |
| Show points / fill area / smoothness | ✓ (line) | – | ✓ (line) | ✓ | – | – | – |
| Show grid lines | ✓ (line) | ✓ (line) | ✓ (line) | ✓ | ✓ | – | – |
| Y-axis from zero | ✓ (line) | delta line only | ✓ (line) | ✓ | – | – | – |
| X/Y-axis ticks | ✓ (line) | ✓ (line) | ✓ (line) | ✓ | ✓ | – | – |
| Forecast | ✓ (line) | – | – | – | – | – | – |
| Trend line | ✓ (line) | ✓ (line) | ✓ (line) | ✓ | – | – | – |
| Exclusions | – | ✓ | ✓ | – | – | – | ✓ |

¹ `budget_spent`, `expenses_by_category`, `category_subcat`, `label_spend`,
`subscription_cost`, `budget_breakdown`. Type-specific data controls: budgets
(`budget_spent`, `label_spend`, `budget_breakdown`), group by
(`expenses_by_category`, `category_subcat`), include unlabeled
(`label_spend`), break down by (`budget_breakdown`), subscriptions
(`subscription_cost`), categories (`category_subcat`), flow type (`sankey`).

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

17a. **The card paydown widget crashed on the dashboard** ("canvasEl is not
    defined") and, once fixed, looked different from the builder: two
    separate charts plus a summary strip, against the builder's one
    combined chart. Both pages now draw the same chart from
    `OxiUI.cardPaydownChartConfig`: payment/spending bars, a net paydown
    line, and the balance as a dashed line on a right-hand axis.

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
    change, Show points, Show grid lines, Fill area, Y-axis from zero, X/Y-axis ticks, Line
    smoothness, Window (points), and so on. The dashboard groups its
    settings as Data / Date range / Display / Exclusions / Width / Assign to
    dashboards.

> **Visible change for existing widgets:** the multi-series widgets now
> follow the saved options. With the defaults (fill area on, points off,
> smoothness 0.1) their lines are now lightly filled and have no point
> markers. Unstacked fills are drawn at 10% opacity so the lines stay easy
> to read.

## Open findings — fixed in the follow-up

Every finding the first pass left open is now fixed. Tests:
`static/audit-dashboard.test.js`, `static/audit-builder.test.js`,
`static/date-utils.test.js`, the parity checks in
`static/widget-options.test.js`, `tests/widget_relative_range_test.rs` and
the `Widget::validate` unit tests in `src/models/widget.rs`.

| # | Where | Finding | Fix |
|---|---|---|---|
| O1 | both | **Relative date presets were not stored.** "Last 30 days" stayed fixed to the day it was saved. | New widget field `relative_range` (a preset key like `30d`/`ytd`, or `custom:<count>:<unit>`). The dates are worked out when the widget renders (`widgetEffectiveDates` / `resolveRelativeRange` in `date-utils.js`); `start_date`/`end_date` are still saved as a fallback. The preset list gains a "Fixed dates" entry: typing a date, or picking it, pins the range. Older widgets whose dates are exactly a preset today open as that preset. The backend rejects malformed values (400). |
| O2 | both | **"Round end date to month boundary" was a one-off helper** (and hidden in the builder). | Saved as `round_end_mode` together with the relative range and applied at render time. The builder shows the control again; the per-widget localStorage copy on the dashboard is gone. |
| O3 | dashboard | **Category selection and widget type could not be changed.** | Settings now have a "Type" selector (switching rebuilds the panel with that type's controls, keeping what was entered; saved on "Update") and, for category subcategory widgets, a category picker grouped by main category. Both pages require at least one category for that type. |
| O4 | dashboard | **Header tags and badges only updated after a reload.** | After "Update" the card's tags, badges and settings panel are rebuilt from the saved widget (`refreshWidgetCard`). Names in titles, tags and badges are now HTML-escaped. |
| O5 | both | **The comparison preview did not match the saved widget**, and the previous period was looked up by the current period's dates, so it was drawn as all zeros on both pages. | One shared builder, `OxiUI.balanceComparisonChart`: combined → a total line + its previous period, split → one line per account + its previous period, aligned by position. Trend lines skip the previous-period series on both pages. |
| O6 | dashboard | **% change saved immediately.** | It still previews live, but is saved with everything else on "Update". |
| O7 | builder | **Accounts showed for Net worth.** | The Accounts, Groups, Categories, Budgets and Subscriptions sections now follow `widgetOptionSupport` (`data-opt`), like every other control. |
| O8 | builder | **Sankey widgets could not be built in the Widget Builder.** | "Sankey Flow" is a builder type with a flow type control, a live preview and saving. The d3 drawing moved to `static/sankey-chart.js` (`OxiSankey`), shared with the dashboard (tooltips now escape names). |
| O9 | both | **Card paydown styling was fixed.** | Card paydown honours the X/Y-axis tick counts on both pages (`cardPaydownChartConfig(data, opts)`). Points/fill/smoothness stay fixed: its bars and lines have their own fixed roles. Sankey has no axes or lines to style. |
| O10 | builder | **Builder display options carried over between widgets** with no way back. | "Reset to defaults" in the advanced options puts every remembered option back to its default. |
| O11 | dashboard | **A blocked d3 failed with a misleading error.** | Sankey widgets (and the builder preview) say the chart library could not be loaded, without fetching. |

Also fixed on the way: the builder's preset/custom range buttons pre-filled
the comparison range with the old, gapped "previous period" math, and the
builder started on "last 30 days" whatever the configured default preset was.
