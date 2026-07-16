# Dashboard Bugs & Issues

Review date: 2026-07-16

---

## Critical

### 1. XSS vulnerability in dashboard management inline handlers

**Files:** `static/dashboard.js` — `renderManageList()` (line ~147)

Dashboard names are interpolated directly into `onclick` attributes with only single-quote escaping:

```js
onclick="renameDashboard('${d.id}', '${d.name.replace(/'/g, "\\'")}')">
```

A dashboard name containing `"; alert(1);//` or similar payloads can break out of the string and execute arbitrary JS. Need proper HTML escaping or, better, use `addEventListener` with data attributes instead of inline handlers.

**Affected:** `renameDashboard()`, `deleteDashboardConfirm()` calls in the manage modal.

---

### 2. `widgetsCache` scope mismatch with `updateWidgetOrder` — cross-dashboard ordering corruption

**Files:** `static/dashboard.js` — `renderDashboard()` (line ~1960), `updateWidgetOrder()` (line ~508)

`renderDashboard()` sets `widgetsCache = widgets` where `widgets` is filtered to only the current dashboard's widgets. But `updateWidgetOrder()` (called after drag-and-drop) looks up widgets in `widgetsCache` and sets `display_order = index` (0, 1, 2, …) which is persisted globally in the DB.

If two dashboards share the same widget, reordering on Dashboard A assigns `display_order = 0` to that widget. On Dashboard B, a different widget may already have `display_order = 0`. The global `ORDER BY display_order` query in `get_all_widgets()` now returns widgets in the wrong order for Dashboard B.

**Fix:** Either scope `display_order` per-dashboard, or always fetch the full widget list before computing order updates, or use a separate per-dashboard ordering mechanism.

---

### 3. `deleteDashboardConfirm` — null access when last dashboard is deleted

**Files:** `static/dashboard.js` — `deleteDashboardConfirm()` (line ~183)

```js
if (id === currentDashboardId) {
    currentDashboardId = dashboardsCache[0] ? dashboardsCache[0].id : null;
```

The backend prevents deleting the last dashboard, but if the backend check races or is bypassed (e.g. direct API call), `dashboardsCache` could be empty and `dashboardsCache[0].id` would throw. The ternary guard helps but then `currentDashboardId` becomes `null` and `renderDashboard()` will fail silently or show an empty state with no recovery path.

---

## High

### 4. `renderSplitLegend` resets visibility on every render — user toggles are lost

**Files:** `static/dashboard.js` — `renderSplitLegend()` (line ~770)

Every time the legend is rendered (which happens on every widget update and dashboard re-render), visibility state is reset to all-visible:

```js
widgetDatasetVisibility[widgetId] = {};
accountInfo.forEach((_, index) => {
    widgetDatasetVisibility[widgetId][index] = true;
});
```

If a user toggles off an account in the split legend and then clicks "Update" in widget settings, the full re-render resets the legend and the account reappears. The user's toggle choice is lost.

**Fix:** Preserve `widgetDatasetVisibility` state across renders — only reset if the set of datasets actually changed.

---

### 5. Dashboard deletion doesn't clean up widget `dashboard_ids`

**Files:** `src/storage/mod.rs` — `delete_dashboard()` (line ~490)

When a dashboard is deleted, the backend removes it from the `dashboards` table but does **not** remove the deleted dashboard ID from any widget's `dashboard_ids` JSON array. Orphaned references accumulate. The frontend silently shows widgets assigned to a non-existent dashboard if the user somehow navigates there, and the manage modal may miscount widgets.

**Fix:** In `delete_dashboard`, update all widgets to remove the deleted ID from their `dashboard_ids` array.

---

### 6. `extractChartData` assumes array length matches label count

**Files:** `static/dashboard.js` — `extractChartData()` (line ~1170), used in earned/spent chart renderers

```js
function extractChartData(entries, length) {
    if (Array.isArray(entries)) {
        return entries.map(e => parseFloat(e.value || 0));
    } else {
        return Object.values(entries).map(v => { ... });
    }
}
```

The `length` parameter is passed but never used. If the API returns fewer/more entries than labels (which happens with sparse data or different period granularities), the data array and labels array will be misaligned, producing wrong values at wrong x-axis positions.

**Fix:** Align entries to labels by date key, padding missing values with `null` or `0`.

---

### 7. `computePercentChange` uses `Math.abs()` for denominator — wrong sign for negative values

**Files:** `static/dashboard.js` — `computePercentChange()` (line ~237)

```js
labels[i] = ((current - first) / Math.abs(first)) * 100;
```

Using `Math.abs(first)` as denominator discards the sign of the base value. For a value going from `-100` to `-150`, the correct change is **-50%** (it got more negative), but `Math.abs(-100)` = 100 gives `(-150 - (-100)) / 100 = +50%` — the sign is inverted.

**Fix:** Use the raw value as denominator (with zero-check), not `Math.abs()`.

---

### 8. `linearRegression` — no guard against division by zero

**Files:** `static/dashboard.js` — `linearRegression()` (line ~264)

```js
const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
```

If all x values are identical (e.g. all data points have the same index), the denominator is zero, producing `NaN` or `Infinity`. This propagates through `computeForecast()` and produces garbage forecast data.

**Fix:** Return `null` or early-exit when denominator is zero.

---

## Medium

### 9. `/api/dashboards/{id}/widgets` endpoint exists but is never used by frontend

**Files:** `src/handlers/dashboard_api.rs` (line ~18), `static/dashboard.js` — `getDashboardWidgets()` (line ~480)

The backend has a `GET /api/dashboards/{id}/widgets` endpoint that returns widgets filtered by dashboard. But the frontend's `getDashboardWidgets()` always calls `GET /api/widgets` (all widgets) and filters client-side. With many widgets across dashboards, this wastes bandwidth and makes the dashboard load slower.

**Fix:** Use the dedicated endpoint in `getDashboardWidgets(currentDashboardId)`.

---

### 10. `saveGraphAsWidget` from main page doesn't set `dashboard_ids`

**Files:** `static/app.js` — `saveGraphAsWidget()` (line ~2590)

The widget object built in `saveGraphAsWidget()` doesn't include `dashboard_ids`. The backend `create_widget()` auto-assigns to the "default" dashboard, but this means:

- Widgets are always saved to "Main" regardless of which dashboard the user is currently viewing
- If the user has renamed or switched away from "Main", the widget appears on the wrong dashboard

**Fix:** Include `dashboard_ids: [currentDashboardId]` or let the user choose which dashboard to save to.

---

### 11. Theme toggle event listener registered twice

**Files:** `static/theme.js` (line ~34), `static/dashboard.js` (line ~2376)

Both `theme.js` and `dashboard.js` add a `DOMContentLoaded` listener that attaches a click handler to `#theme-toggle`. The toggle function fires twice per click, causing the theme to flip back and forth (net effect: no change) or to flicker.

**Fix:** Remove the duplicate listener from `dashboard.js` since `theme.js` already handles it.

---

### 12. Responsive grid missing for small widget widths on mobile

**Files:** `static/style.css` (line ~868)

```css
@media (max-width: 900px) {
    .dashboard-grid .widget[data-cols="6"] { grid-column: span 12; }
}
```

Only `data-cols="6"` gets a mobile override. Widgets with widths 1, 2, 3, and 4 stay at their narrow width on mobile, making them unreadable.

**Fix:** Add mobile breakpoints for all widths < 6 to span 12 columns.

---

### 13. `updateWidgetDateRange` reads from DOM elements that may not exist

**Files:** `static/dashboard.js` — `updateWidgetDateRange()` (line ~523)

The function reads from elements like `${widgetId}-show-points`, `${widgetId}-x-limit`, etc. without checking if they exist. If the settings panel was never opened (elements exist in HTML but values may be stale) or if a widget type doesn't have certain controls (e.g. earned_spent doesn't have chart-mode), `document.getElementById()` returns `null` and `.checked` / `.value` throws.

Some fields are guarded (`chartModeEl ? chartModeEl.value : undefined`, `enableForecastEl`), but many are not.

**Fix:** Add null checks for all DOM element reads, or read from the widget object in `widgetsCache` instead of the DOM.

---

### 14. `computeForecast` can add up to 365 forecast points — overwhelms chart

**Files:** `static/dashboard.js` — `computeForecast()` (line ~280)

`forecast_days` allows values up to 365. On a daily chart, that adds 365 forecast data points on top of existing data, making the chart crowded and slow to render. No visual distinction between actual and forecast data in split mode (forecast is applied per-dataset).

**Fix:** Cap forecast points, or add a visual separator, or warn when forecast would add more points than existing data.

---

### 15. `toggleWidgetSettings` — settings panel state not synced with DOM after re-render

**Files:** `static/dashboard.js` — `toggleWidgetSettings()` (line ~519)

The function toggles `style.display` between `'none'` and `'flex'`. After `renderDashboard()` re-renders the whole container, all settings panels are reset to `display: none` (from the inline style in the HTML template). If a user had a settings panel open and triggered a re-render (e.g. by updating another widget), their open panel closes unexpectedly.

**Fix:** Track which widget's settings are open and restore after re-render.

---

### 16. `renderWidgetChart` parameter named `containerId` but used as canvas ID

**Files:** `static/dashboard.js` — `renderWidgetChart()` (line ~1195)

```js
async function renderWidgetChart(widget, containerId, allAccounts, allGroups = []) {
    const ctx = document.getElementById(containerId).getContext('2d');
```

The parameter is named `containerId` suggesting it targets a container div, but `.getContext('2d')` is a `<canvas>` method. The canvas element has `id="${widget.id}"` and the function is called with `widget.id`. The naming is misleading and could cause confusion during maintenance.

**Fix:** Rename parameter to `canvasId`.

---

## Low / Cosmetic

### 17. `renderDashboard` closes settings panel after update but doesn't restore focus

**Files:** `static/dashboard.js` — `updateWidgetDateRange()` (line ~580)

```js
document.getElementById(`${widgetId}-settings`).style.display = 'none';
```

After updating a widget, the settings panel is closed and focus is lost. Keyboard users have no indication of where focus went.

**Fix:** Return focus to the widget title or the update button.

---

### 18. Widget chart canvas doesn't resize after interact.js height change

**Files:** `static/dashboard.js` — interact.js `onend` handler (line ~2340)

When the user resizes a chart container via the resize handle, the container height is updated but `chart.resize()` is never called on the Chart.js instance. The chart rendering area doesn't match the new container dimensions until the next full re-render.

**Fix:** Call `widgetCharts[widget.id].resize()` after the height change.

---

### 19. `get_dashboard_widgets` backend endpoint returns widgets but frontend uses `get_all_widgets`

**Files:** `src/handlers/dashboard_api.rs` (line ~18)

Related to #9 but from the backend perspective: the endpoint exists and works correctly but is dead code from the frontend's perspective. Consider either using it or removing it to reduce API surface confusion.

---

### 20. Dashboard widget count badge not updated after widget deletion from another widget's re-render

**Files:** `static/dashboard.js` — `deleteWidget()` (line ~485)

`deleteWidget()` calls `renderDashboard()` which updates the count, but if the deletion triggers a partial re-render path (e.g. from `saveWidgetDashboardAssignment`), the count badge may not reflect the removal until the next full load.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| Critical | 3 | #1, #2, #3 |
| High | 5 | #4, #5, #6, #7, #8 |
| Medium | 6 | #9, #10, #11, #12, #13, #14 |
| Low | 4 | #17, #18, #19, #20 |
