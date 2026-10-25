const DASHBOARD_WIDGETS_KEY = 'oxidize_dashboard_widgets';
const SAVED_LISTS_KEY = 'firefly_saved_account_lists';
let widgetCharts = {};
let widgetSankeyData = {};
let widgetDatasetVisibility = {};
let widgetsCache = [];
let dashboardsCache = [];
let currentDashboardId = null;
let dashboardLocked = true;
let dashboardGrid = null;
let dashboardDates = { start: null, end: null };
// Dashboard-level exclusions: applied to every widget on the current dashboard
let dashboardExclusions = { categories: [], budgets: [] };
// One-time fetch of available category/budget names for exclusion selectors
let exclusionOptionsPromise = null;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str === undefined || str === null ? '' : String(str);
    return div.innerHTML;
}

function buildCategoryOptionNames(categories) {
    // Offer main categories (excludes all their subcategories) plus each
    // subcategory as a full "Parent:Sub" name for fine-grained exclusion.
    const names = new Set();
    for (const c of categories || []) {
        if (c && c.name) names.add(c.name);
        for (const sub of c.subcategories || []) {
            names.add(`${c.name}:${sub}`);
        }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function getExclusionOptions() {
    if (!exclusionOptionsPromise) {
        exclusionOptionsPromise = Promise.all([
            fetch('/api/categories/list').then(r => (r.ok ? r.json() : [])),
            fetch('/api/budgets/list').then(r => (r.ok ? r.json() : []))
        ])
            .then(([categories, budgets]) => ({
                categories: buildCategoryOptionNames(categories),
                // Main categories with their subcategories (category picker)
                categoryTree: (categories || [])
                    .filter(c => c && c.name)
                    .map(c => ({ name: c.name, subcategories: (c.subcategories || []).slice().sort((a, b) => a.localeCompare(b)) }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                budgets: (budgets || []).map(b => b.name).sort((a, b) => a.localeCompare(b))
            }))
            .catch(e => {
                console.error('Failed to load exclusion options:', e);
                exclusionOptionsPromise = null; // allow retry on next open
                return { categories: [], categoryTree: [], budgets: [] };
            });
    }
    return exclusionOptionsPromise;
}

/// Merge dashboard-level exclusions with a widget's own exclusions.
function mergeExclusions(dashExclusions, widget) {
    const categories = new Set([...(dashExclusions?.categories || []), ...(widget?.exclude_categories || [])]);
    const budgets = new Set([...(dashExclusions?.budgets || []), ...(widget?.exclude_budgets || [])]);
    return { categories: Array.from(categories), budgets: Array.from(budgets) };
}

/// Append exclusion params to a URLSearchParams built for a chart request.
function appendExclusionParams(params, exclusions) {
    for (const c of exclusions?.categories || []) params.append('exclude_categories[]', c);
    for (const b of exclusions?.budgets || []) params.append('exclude_budgets[]', b);
}

// ── Dashboard management ──────────────────────────────────────────────

async function fetchDashboards() {
    try {
        const res = await fetch('/api/dashboards');
        if (!res.ok) return [];
        return await res.json();
    } catch {
        return [];
    }
}

async function loadDashboards() {
    dashboardsCache = await fetchDashboards();
    // Restore or pick default
    const saved = localStorage.getItem('oxidize_current_dashboard');
    if (saved && dashboardsCache.find(d => d.id === saved)) {
        currentDashboardId = saved;
    } else if (dashboardsCache.length > 0) {
        currentDashboardId = dashboardsCache[0].id;
    }
    renderNavDropdown();
}

function renderNavDropdown() {
    const list = document.getElementById('nav-dashboard-list');
    if (!list) return;
    list.innerHTML = '';
    dashboardsCache.forEach(d => {
        const item = document.createElement('button');
        item.className = 'nav-dropdown-item' + (d.id === currentDashboardId ? ' active' : '');
        item.textContent = d.name;
        item.addEventListener('click', () => switchDashboard(d.id));
        list.appendChild(item);
    });

    // Update nav button label
    const btn = document.getElementById('nav-dashboard-btn');
    if (btn) {
        const current = dashboardsCache.find(d => d.id === currentDashboardId);
        btn.childNodes[0].textContent = (current ? current.name : 'Dashboard') + ' ';
    }
}

async function switchDashboard(id) {
    if (id === currentDashboardId) { closeNavDropdown(); return; }
    currentDashboardId = id;
    localStorage.setItem('oxidize_current_dashboard', id);
    closeNavDropdown();

    const current = dashboardsCache.find(d => d.id === id);
    const titleEl = document.getElementById('dashboard-title');
    if (titleEl) titleEl.textContent = current ? current.name : 'Dashboard';

    await loadDashboardDates();
    populateDashboardDateInputs();
    await renderDashboard();
}

function closeNavDropdown() {
    const menu = document.getElementById('nav-dropdown-menu');
    if (menu) menu.classList.remove('open');
}

// ── Dashboard-level date range ────────────────────────────────────────

async function loadDashboardDates() {
    if (!currentDashboardId) return;
    try {
        const res = await fetch('/api/dashboards');
        if (!res.ok) return;
        const dashboards = await res.json();
        const dash = dashboards.find(d => d.id === currentDashboardId);
        if (dash) {
            dashboardDates.start = dash.start_date || null;
            dashboardDates.end = dash.end_date || null;
            dashboardExclusions = {
                categories: dash.exclude_categories || [],
                budgets: dash.exclude_budgets || []
            };
        }
    } catch (e) {
        console.error('Failed to load dashboard dates:', e);
    }
}

async function saveDashboardDates() {
    if (!currentDashboardId) return;
    const startEl = document.getElementById('dashboard-start-date');
    const endEl = document.getElementById('dashboard-end-date');
    const start = startEl ? startEl.value || null : null;
    const end = endEl ? endEl.value || null : null;

    dashboardDates.start = start;
    dashboardDates.end = end;

    try {
        const dashboards = await fetchDashboards();
        const dash = dashboards.find(d => d.id === currentDashboardId);
        if (!dash) return;

        dash.start_date = start;
        dash.end_date = end;

        const res = await fetch(`/api/dashboards/${currentDashboardId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dash)
        });
        if (!res.ok) throw new Error(await res.text());
    } catch (e) {
        console.error('Failed to save dashboard dates:', e);
        OxiUI.toast('Failed to save date range: ' + e.message, 'error');
    }
}

function applyDashboardDateRange() {
    saveDashboardDates();
    // Refresh date inputs on all widgets that use dashboard range
    refreshDashboardDateInputs();
    // Refresh charts for widgets using dashboard range
    refreshWidgetsUsingDashboardRange();
}

function refreshDashboardDateInputs() {
    if (!widgetsCache) return;
    widgetsCache.forEach(w => {
        const source = w.date_range_source || 'custom';
        if (source === 'dashboard') {
            const startEl = document.getElementById(`${w.id}-start`);
            const endEl = document.getElementById(`${w.id}-end`);
            if (startEl) startEl.value = dashboardDates.start || '';
            if (endEl) endEl.value = dashboardDates.end || '';
        }
    });
}

async function refreshWidgetsUsingDashboardRange() {
    const allAccounts = await fetchAccounts();
    const allGroups = await fetchDashboardGroups();
    for (const w of widgetsCache) {
        if ((w.date_range_source || 'custom') === 'dashboard') {
            await renderWidgetChart(w, w.id, allAccounts, allGroups);
        }
    }
}

function populateDashboardDateInputs() {
    const startEl = document.getElementById('dashboard-start-date');
    const endEl = document.getElementById('dashboard-end-date');
    if (startEl) startEl.value = dashboardDates.start || '';
    if (endEl) endEl.value = dashboardDates.end || '';
}

// ── Dashboard-level exclusions ────────────────────────────────────────

async function openDashboardExclusionsModal() {
    const overlay = document.getElementById('exclusions-modal-overlay');
    if (!overlay) return;
    const options = await getExclusionOptions();
    const catSel = document.getElementById('dash-exclude-categories');
    const budgetSel = document.getElementById('dash-exclude-budgets');
    if (catSel) {
        catSel.innerHTML = options.categories.map(c =>
            `<option value="${escapeHtml(c)}" ${dashboardExclusions.categories.includes(c) ? 'selected' : ''}>${escapeHtml(c)}</option>`
        ).join('');
    }
    if (budgetSel) {
        budgetSel.innerHTML = options.budgets.map(b =>
            `<option value="${escapeHtml(b)}" ${dashboardExclusions.budgets.includes(b) ? 'selected' : ''}>${escapeHtml(b)}</option>`
        ).join('');
    }
    overlay.style.display = 'flex';
}

function closeDashboardExclusionsModal() {
    const overlay = document.getElementById('exclusions-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function saveDashboardExclusions() {
    if (!currentDashboardId) return;
    const catSel = document.getElementById('dash-exclude-categories');
    const budgetSel = document.getElementById('dash-exclude-budgets');
    dashboardExclusions = {
        categories: catSel ? Array.from(catSel.selectedOptions).map(o => o.value) : [],
        budgets: budgetSel ? Array.from(budgetSel.selectedOptions).map(o => o.value) : []
    };
    try {
        const dashboards = await fetchDashboards();
        const dash = dashboards.find(d => d.id === currentDashboardId);
        if (!dash) return;
        dash.exclude_categories = dashboardExclusions.categories;
        dash.exclude_budgets = dashboardExclusions.budgets;
        const res = await fetch(`/api/dashboards/${currentDashboardId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dash)
        });
        if (!res.ok) throw new Error(await res.text());
        closeDashboardExclusionsModal();
        OxiUI.toast('Dashboard exclusions saved', 'success');
        // Re-render all widgets so the new global exclusions take effect
        await renderDashboard();
    } catch (e) {
        console.error('Failed to save dashboard exclusions:', e);
        OxiUI.toast('Failed to save exclusions: ' + e.message, 'error');
    }
}

// ── New dashboard modal ───────────────────────────────────────────────

function openNewDashboardModal() {
    closeNavDropdown();
    const overlay = document.getElementById('new-dashboard-modal-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        const input = document.getElementById('new-dashboard-name');
        if (input) { input.value = ''; input.focus(); }
    }
}

function closeNewDashboardModal() {
    const overlay = document.getElementById('new-dashboard-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function createNewDashboard() {
    const input = document.getElementById('new-dashboard-name');
    const name = (input ? input.value.trim() : '');
    if (!name) { input.focus(); return; }

    const id = 'dash_' + Date.now();
    try {
        const res = await fetch('/api/dashboards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name })
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || 'Failed to create');
        }
        dashboardsCache = await fetchDashboards();
        renderNavDropdown();
        closeNewDashboardModal();
        await switchDashboard(id);
    } catch (e) {
        OxiUI.toast('Failed to create dashboard: ' + e.message, 'error');
    }
}

// ── Manage dashboards modal ───────────────────────────────────────────

function openManageModal() {
    closeNavDropdown();
    const overlay = document.getElementById('manage-modal-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        renderManageList();
    }
}

function closeManageModal() {
    const overlay = document.getElementById('manage-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function renderManageList() {
    const container = document.getElementById('manage-dashboard-list');
    if (!container) return;

    const dashboards = dashboardsCache;
    const allWidgets = await getDashboardWidgets();

    container.innerHTML = '';
    dashboards.forEach(d => {
        const widgetCount = allWidgets.filter(w => (w.dashboard_ids || []).includes(d.id)).length;
        const isCurrent = d.id === currentDashboardId;
        const isDefault = d.id === 'default';

        const item = document.createElement('div');
        item.className = 'manage-dashboard-item' + (isCurrent ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'manage-dashboard-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'manage-dashboard-name';
        nameSpan.textContent = d.name;

        const countSpan = document.createElement('span');
        countSpan.className = 'manage-dashboard-count';
        countSpan.textContent = `${widgetCount} widget${widgetCount !== 1 ? 's' : ''}`;

        info.appendChild(nameSpan);
        info.appendChild(countSpan);

        const actions = document.createElement('div');
        actions.className = 'manage-dashboard-actions';

        if (!isCurrent) {
            const switchBtn = document.createElement('button');
            switchBtn.className = 'btn btn-sm';
            switchBtn.textContent = 'Switch';
            switchBtn.addEventListener('click', () => {
                switchDashboard(d.id);
                closeManageModal();
            });
            actions.appendChild(switchBtn);
        } else {
            const badge = document.createElement('span');
            badge.className = 'current-badge';
            badge.textContent = 'Current';
            actions.appendChild(badge);
        }

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn btn-sm btn-secondary';
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', () => renameDashboard(d.id, d.name));
        actions.appendChild(renameBtn);

        if (!isDefault) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-danger';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => deleteDashboardConfirm(d.id, d.name));
            actions.appendChild(deleteBtn);
        }

        item.appendChild(info);
        item.appendChild(actions);
        container.appendChild(item);
    });
}

async function renameDashboard(id, oldName) {
    const name = await OxiUI.prompt({
        title: 'Rename Dashboard',
        message: 'Enter a new name for this dashboard.',
        defaultValue: oldName,
        confirmLabel: 'Rename',
        validate: (v) => (v.trim() === '' ? 'Name cannot be empty.' : null)
    });
    if (!name || name.trim() === '' || name.trim() === oldName) return;
    try {
        const res = await fetch(`/api/dashboards/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name: name.trim() })
        });
        if (!res.ok) throw new Error(await res.text());
        dashboardsCache = await fetchDashboards();
        renderNavDropdown();
        renderManageList();
        const titleEl = document.getElementById('dashboard-title');
        if (titleEl && id === currentDashboardId) {
            const d = dashboardsCache.find(dd => dd.id === id);
            titleEl.textContent = d ? d.name : 'Dashboard';
        }
    } catch (e) {
        OxiUI.toast('Failed to rename: ' + e.message, 'error');
    }
}

async function deleteDashboardConfirm(id, name) {
    const ok = await OxiUI.confirm({
        title: 'Delete Dashboard',
        message: `Delete "${name}"? Widgets will lose this dashboard assignment.`,
        confirmLabel: 'Delete',
        danger: true
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/dashboards/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        dashboardsCache = await fetchDashboards();

        // If we deleted the current one, switch to first available
        if (id === currentDashboardId) {
            if (dashboardsCache.length > 0) {
                currentDashboardId = dashboardsCache[0].id;
                localStorage.setItem('oxidize_current_dashboard', currentDashboardId);
                const titleEl = document.getElementById('dashboard-title');
                if (titleEl) {
                    const d = dashboardsCache.find(dd => dd.id === currentDashboardId);
                    titleEl.textContent = d ? d.name : 'Dashboard';
                }
                await renderDashboard();
            } else {
                // No dashboards left — clear state gracefully
                currentDashboardId = null;
                localStorage.removeItem('oxidize_current_dashboard');
                const titleEl = document.getElementById('dashboard-title');
                if (titleEl) titleEl.textContent = 'Dashboard';
                document.getElementById('dashboard-container').innerHTML =
                    '<div class="empty-dashboard"><h3>No dashboards</h3><p>Open the <strong>Dashboard</strong> menu in the navigation bar and choose <strong>New dashboard</strong> to get started.</p></div>';
            }
        }
        renderNavDropdown();
        renderManageList();
    } catch (e) {
        OxiUI.toast('Failed to delete dashboard: ' + e.message, 'error');
    }
}

// ── Widget-to-dashboard assignment (in widget settings) ───────────────

function buildDashboardCheckboxes(widget) {
    const widgetDashIds = widget.dashboard_ids || [];
    let html = '<div class="widget-dashboard-assignment">';
    dashboardsCache.forEach(d => {
        const checked = widgetDashIds.includes(d.id) ? 'checked' : '';
        html += `
            <label class="checkbox-label dashboard-checkbox">
                <input type="checkbox" id="${widget.id}-dash-${d.id}" value="${d.id}" ${checked}>
                ${d.name}
            </label>
        `;
    });
    html += '</div>';
    return html;
}

async function saveWidgetDashboardAssignment(widgetId) {
    const checkboxes = document.querySelectorAll(`[id^="${widgetId}-dash-"]:checked`);
    const newDashIds = Array.from(checkboxes).map(cb => cb.value);

    const widgets = await getDashboardWidgets();
    const w = widgets.find(ww => ww.id === widgetId);
    if (!w) return;

    w.dashboard_ids = newDashIds;
    w.updated_at = new Date().toISOString();

    try {
        const res = await fetch(`/api/widgets/${widgetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(w)
        });
        if (!res.ok) throw new Error(await res.text());

        // If this widget was removed from the current dashboard, re-render
        if (!newDashIds.includes(currentDashboardId)) {
            await renderDashboard();
        }
    } catch (e) {
        OxiUI.toast('Failed to update dashboard assignment: ' + e.message, 'error');
    }
}

// ── End dashboard management ──────────────────────────────────────────

// Chart.js plugin: sort tooltip items by value descending (OXI-43)
// and bold the hovered legend items (OXI-44)
const tooltipSortAndLegendPlugin = {
    id: 'tooltipSortAndLegend',
    afterTooltipDraw(chart) {
        const tooltip = chart.tooltip;
        if (!tooltip || !tooltip._active || !tooltip._active.length) {
            // Clear any bold state when tooltip is not active
            const legendItems = document.querySelectorAll('.legend-item.active');
            legendItems.forEach(item => item.classList.remove('legend-highlight'));
            return;
        }

        // Get the widget ID from the chart canvas
        const canvas = chart.canvas;
        const match = canvas.id ? canvas.id.match(/(.+)-chart$/) : null;
        const widgetId = match ? match[1] : null;
        if (!widgetId) return;

        // Get hovered dataset indices from tooltip active elements
        const hoveredIndices = tooltip._active.map(el => el.datasetIndex);

        // Highlight legend items for hovered datasets
        const legendContainer = document.getElementById(widgetId + '-legend');
        if (legendContainer) {
            const items = legendContainer.querySelectorAll('.legend-item');
            items.forEach((item, idx) => {
                if (hoveredIndices.includes(idx)) {
                    item.classList.add('legend-highlight');
                } else {
                    item.classList.remove('legend-highlight');
                }
            });
        }
    },
};
function parseChartLabel(label) {
    if (typeof label !== 'string') return new Date(label);
    const qMatch = label.match(/^(\d{4})-Q(\d)$/);
    if (qMatch) {
        const year = parseInt(qMatch[1], 10);
        const quarter = parseInt(qMatch[2], 10);
        const month = (quarter - 1) * 3 + 1;
        return new Date(year, month - 1, 1);
    }
    return new Date(label);
}

// Percentage change settings (per-widget, stored in chart_options)
const PCT_ENABLED_KEY = 'show_pct';
const PCT_MODE_KEY = 'pct_mode';

function computePercentChange(data, mode) {
    return OxiUI.computePercentChange(data, mode);
}

function formatPct(value) {
    if (value === null || value === undefined) return null;
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(1) + '%';
}

// Linear regression helper for forecast
function linearRegression(points) {
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (const p of points) {
        sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null; // all x values identical — no meaningful slope
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
}

// Compute forecast data points using linear regression on recent balance history
function computeForecast(absoluteData, labels, forecastDays) {
    if (absoluteData.length < 2) return null;

    const regressionWindow = Math.min(absoluteData.length, 30);
    const windowStart = absoluteData.length - regressionWindow;

    const points = [];
    for (let i = windowStart; i < absoluteData.length; i++) {
        if (absoluteData[i] !== null && absoluteData[i] !== undefined && !isNaN(absoluteData[i])) {
            points.push({ x: i, y: absoluteData[i] });
        }
    }

    if (points.length < 2) return null;

    const regression = linearRegression(points);
    if (!regression) return null;
    const { slope, intercept } = regression;

    const lastDate = parseChartLabel(labels[labels.length - 1]);
    let periodDays = 1;
    if (labels.length >= 2) {
        const prevDate = parseChartLabel(labels[labels.length - 2]);
        const diffMs = lastDate - prevDate;
        periodDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }

    // Cap forecast points so they don't overwhelm the chart:
    // never add more forecast points than existing data points.
    const maxForecast = Math.min(forecastDays, absoluteData.length, 60);

    const forecastValues = [];
    const forecastLabels = [];

    for (let i = 1; i <= maxForecast; i++) {
        const futureIndex = absoluteData.length - 1 + i;
        const predictedY = slope * futureIndex + intercept;
        forecastValues.push(isNaN(predictedY) ? null : predictedY);

        const futureDate = new Date(lastDate);
        futureDate.setDate(futureDate.getDate() + periodDays * i);
        forecastLabels.push(futureDate.toISOString().split('T')[0]);
    }

    return { values: forecastValues, labels: forecastLabels };
}

// Persist pct settings for a widget to the server
// Normalize chart_options to include pct defaults for old widgets
function normalizeChartOptions(opts) {
    opts = opts || {};
    return {
        show_points: opts.show_points ?? false,
        show_grid: opts.show_grid ?? true,
        x_axis_limit: opts.x_axis_limit ?? 6,
        y_axis_limit: opts.y_axis_limit ?? 4,
        fill_area: opts.fill_area ?? true,
        tension: opts.tension ?? 0.1,
        begin_at_zero: opts.begin_at_zero ?? false,
        show_pct: opts.show_pct ?? false,
        pct_mode: opts.pct_mode || 'from_previous',
        enable_comparison: opts.enable_comparison ?? false,
        comparison_start_date: opts.comparison_start_date ?? null,
        comparison_end_date: opts.comparison_end_date ?? null,
        enable_forecast: opts.enable_forecast ?? false,
        forecast_days: opts.forecast_days ?? 30,
        show_trendline: opts.show_trendline ?? false,
        trendline_window: opts.trendline_window ?? 7,
        stacked: opts.stacked ?? false
    };
}

// Chart.js plugin for percentage change labels
const pctLabelPlugin = {
    id: 'percentLabels',
    afterDatasetsDraw(chart) {
        const opts = chart.__pctOpts;
        if (!opts || !opts.enabled) return;

        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = chartColors().textColor;

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!dataset.data || dataset.hidden) return;
            if (dataset.isTrendline) return; // no % labels on trend lines

            let absoluteData = dataset.absoluteData || dataset.data;
            if (!Array.isArray(absoluteData)) return;

            const pctLabels = computePercentChange(absoluteData, opts.mode);

            const meta = chart.getDatasetMeta(datasetIndex);
            if (!meta || !meta.data) return;

            ctx.save();
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';

            meta.data.forEach((point, pointIndex) => {
                const pctLabel = pctLabels[pointIndex];
                if (pctLabel === null) return;

                const formatted = formatPct(pctLabel);
                if (!formatted) return;

                const x = point.x;
                const y = point.y;

                ctx.fillStyle = textColor;
                ctx.fillText(formatted, x, y - 8);
            });

            ctx.restore();
        });
    }
};

// Get config from server or use defaults
const CONFIG = window.OXIDIZE_CONFIG || {
    accountTypes: ['asset', 'cash', 'expense', 'revenue', 'liability'],
    autoFetchAccounts: false
};

// Theme-aware chart colors from the shared UI kit (light fallback when the
// kit is not loaded, e.g. in isolated unit tests).
const FALLBACK_CHART_COLORS = {
    textColor: '#475569', gridColor: '#e2e8f0', tooltipBg: '#ffffff',
    tooltipBorder: '#e2e8f0', tooltipText: '#1e293b', accent: '#0f766e',
    earned: '#15803d', spent: '#dc2626', neutral: '#94a3b8',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    seriesExtra: ['#0e7490', '#a16207', '#9d174d', '#475569', '#4d7c0f', '#7c3aed', '#b45309']
};

function chartColors() {
    if (typeof OxiUI !== 'undefined' && OxiUI.getChartColors) {
        const c = OxiUI.getChartColors();
        if (c && c.series) return c;
    }
    return FALLBACK_CHART_COLORS;
}

function seriesPalette() {
    const c = chartColors();
    return c.series.concat(c.seriesExtra);
}

function seriesColor(i) {
    const palette = seriesPalette();
    return palette[i % palette.length];
}

// '#rrggbb' + alpha (0..1) -> '#rrggbbaa'
function withAlpha(hex, alpha) {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
    return hex + a;
}

// Theme management
window.addEventListener("themeChanged", (e) => { updateWidgetChartsTheme(e.detail); });
function updateWidgetChartsTheme(theme) {
    const isDark = theme === 'dark';
    const textColor = chartColors().textColor;
    const gridColor = chartColors().gridColor;

    Object.values(widgetCharts).forEach(chart => {
        if (!chart) return;
        // Pie charts have no scales; rebuild their styling for the new theme
        if (OxiUI.restylePieChart(chart)) return;
        const scales = chart.options && chart.options.scales;
        if (scales && scales.x && scales.y) {
            scales.x.grid = { color: gridColor };
            scales.x.ticks = { color: textColor };
            scales.y.grid = { color: gridColor };
            scales.y.ticks = { color: textColor };
            chart.update('none');
        }
    });

    // Sankey widgets are D3 SVGs that capture theme colors at render time; redraw them.
    Object.entries(widgetSankeyData).forEach(([widgetId, data]) => {
        const container = document.getElementById(`${widgetId}-sankey`);
        if (container) renderSankeyChart(container, data);
    });
}

async function getDashboardWidgets() {
    try {
        const response = await fetch('/api/widgets');
        if (!response.ok) return [];
        return await response.json();
    } catch (e) {
        console.error('Failed to fetch widgets:', e);
        return [];
    }
}

async function getWidgetsForDashboard(dashboardId) {
    try {
        const response = await fetch(`/api/dashboards/${dashboardId}/widgets`);
        if (!response.ok) return [];
        return await response.json();
    } catch (e) {
        console.error('Failed to fetch widgets for dashboard:', e);
        return [];
    }
}

async function deleteWidget(id) {
    const ok = await OxiUI.confirm({ title: 'Delete Widget', message: 'Delete this widget? This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;

    // Destroy chart if exists
    if (widgetCharts[id]) {
        widgetCharts[id].destroy();
        delete widgetCharts[id];
    }
    delete widgetSankeyData[id];

    try {
        await fetch(`/api/widgets/${id}`, { method: 'DELETE' });
        await renderDashboard();
    } catch (e) {
        console.error('Failed to delete widget:', e);
        OxiUI.toast(`Failed to delete widget: ${e.message}`, 'error');
    }
}

async function updateWidgetOrder(widgetIds) {
    // Fetch all widgets so we have the full objects (including fields not in the
    // dashboard-scoped widgetsCache) and avoid corrupting order on other dashboards.
    const allWidgets = await getDashboardWidgets();

    const updates = widgetIds.map((id, index) => {
        const w = allWidgets.find(w => w.id === id);
        if (!w) return null;
        w.display_order = index;
        w.updated_at = new Date().toISOString();
        return fetch(`/api/widgets/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(w)
        });
    }).filter(Boolean);

    await Promise.all(updates);

    // Refresh the cache so downstream code (width selector, etc.) has fresh data
    widgetsCache = allWidgets;
}

function toggleWidgetSettings(id) {
    const settingsEl = document.getElementById(`${id}-settings`);
    if (settingsEl.style.display === 'none' || settingsEl.style.display === '') {
        settingsEl.style.display = 'flex';
    } else {
        settingsEl.style.display = 'none';
    }
}

// Apply the values of a widget's settings panel to the widget object
// (mutates and returns it). Controls missing from the panel - options that
// do not apply to the widget type - leave their field untouched.
function readWidgetSettings(widgetId, widget) {
    const el = (suffix) => document.getElementById(`${widgetId}-${suffix}`);
    const selectedValues = (suffix) => Array.from(el(suffix).selectedOptions).map(o => o.value);

    const dateSourceRadio = document.querySelector(`input[name="${widgetId}-date-source"]:checked`);
    if (dateSourceRadio) {
        widget.date_range_source = dateSourceRadio.value === 'dashboard' ? 'dashboard' : 'custom';
    }
    if (el('widget-type')) widget.widget_type = el('widget-type').value;
    if (el('start')) widget.start_date = el('start').value || null;
    if (el('end')) widget.end_date = el('end').value || null;
    if (el('time-range')) {
        widget.relative_range = el('time-range').dataset.relativeRange || null;
        widget.round_end_mode = widget.relative_range && el('round-end')?.checked
            ? (el('round-end-mode')?.value || null) : null;
    }
    if (el('categories')) {
        widget.subcategories = selectedValues('categories');
        widget.parent_categories = [...new Set(widget.subcategories.map(full => full.split(':')[0]))];
    }
    if (el('interval')) widget.interval = el('interval').value || null;
    if (el('chart-mode')) widget.chart_mode = el('chart-mode').value;
    if (el('accounts')) widget.accounts = selectedValues('accounts');
    if (el('groups')) widget.group_ids = selectedValues('groups');

    // Update chart options — read from DOM with null guards
    const byId = (id) => document.getElementById(id);
    widget.chart_options = normalizeChartOptions(widget.chart_options);
    const showPoints = byId(`${widgetId}-show-points`);
    if (showPoints) widget.chart_options.show_points = showPoints.checked;
    const showGrid = byId(`${widgetId}-show-grid`);
    if (showGrid) {
        widget.chart_options.show_grid = showGrid.checked;
        const chartEl = document.querySelector(`.widget[data-widget-id="${widgetId}"] .widget-chart`);
        if (chartEl) chartEl.dataset.grid = showGrid.checked ? 'on' : 'off';
    }
    const xLimit = byId(`${widgetId}-x-limit`);
    if (xLimit) widget.chart_options.x_axis_limit = parseInt(xLimit.value);
    const yLimit = byId(`${widgetId}-y-limit`);
    if (yLimit) widget.chart_options.y_axis_limit = parseInt(yLimit.value);
    const fillArea = byId(`${widgetId}-fill-area`);
    if (fillArea) widget.chart_options.fill_area = fillArea.checked;
    const tension = byId(`${widgetId}-tension`);
    if (tension) widget.chart_options.tension = parseFloat(tension.value);
    const beginZero = byId(`${widgetId}-begin-zero`);
    if (beginZero) widget.chart_options.begin_at_zero = beginZero.checked;
    const showPct = byId(`${widgetId}-show-pct`);
    if (showPct) widget.chart_options[PCT_ENABLED_KEY] = showPct.checked;
    const pctMode = byId(`${widgetId}-pct-mode`);
    if (pctMode) widget.chart_options[PCT_MODE_KEY] = pctMode.value;
    const enableForecastEl = byId(`${widgetId}-enable-forecast`);
    const forecastDaysEl = byId(`${widgetId}-forecast-days`);
    if (enableForecastEl) widget.chart_options.enable_forecast = enableForecastEl.checked;
    if (forecastDaysEl) widget.chart_options.forecast_days = parseInt(forecastDaysEl.value, 10) || 30;
    const enableTrendlineEl = byId(`${widgetId}-enable-trendline`);
    const trendlineWindowEl = byId(`${widgetId}-trendline-window`);
    if (enableTrendlineEl) widget.chart_options.show_trendline = enableTrendlineEl.checked;
    if (trendlineWindowEl) widget.chart_options.trendline_window = parseInt(trendlineWindowEl.value, 10) || 7;
    const stackedEl = byId(`${widgetId}-stacked`);
    if (stackedEl) widget.chart_options.stacked = stackedEl.checked;

    const graphModeEl = document.getElementById(`${widgetId}-graph-mode`);
    if (graphModeEl) widget.category_graph_mode = graphModeEl.value;

    const enableComparisonEl = byId(`${widgetId}-enable-comparison`);
    if (enableComparisonEl) {
        widget.chart_options.enable_comparison = enableComparisonEl.checked;
        const compStartEl = byId(`${widgetId}-comparison-start`);
        const compEndEl = byId(`${widgetId}-comparison-end`);
        widget.chart_options.comparison_start_date = enableComparisonEl.checked ? (compStartEl ? (compStartEl.value || null) : null) : null;
        widget.chart_options.comparison_end_date = enableComparisonEl.checked ? (compEndEl ? (compEndEl.value || null) : null) : null;
    }

    const earnedChartTypeEl = document.getElementById(`${widgetId}-earned-chart-type`);
    if (earnedChartTypeEl) widget.earned_chart_type = earnedChartTypeEl.value;

    const chartTypeEl = document.getElementById(`${widgetId}-chart-type`);
    if (chartTypeEl) widget.chart_type = chartTypeEl.value;

    const sankeyFlowTypeEl = document.getElementById(`${widgetId}-sankey-flow-type`);
    if (sankeyFlowTypeEl) widget.sankey_flow_type = sankeyFlowTypeEl.value;

    const includeUnlabeledEl = document.getElementById(`${widgetId}-include-unlabeled`);
    if (includeUnlabeledEl) widget.include_unlabeled = includeUnlabeledEl.checked;

    const subsEl = document.getElementById(`${widgetId}-subscriptions`);
    if (subsEl) {
        widget.subscription_ids = Array.from(subsEl.selectedOptions).map(o => o.value);
    }
    const subGroupsEl = document.getElementById(`${widgetId}-subscription-groups`);
    if (subGroupsEl) {
        widget.subscription_group_ids = Array.from(subGroupsEl.selectedOptions).map(o => o.value);
    }
    const subSplitEl = document.getElementById(`${widgetId}-subscription-split`);
    if (subSplitEl) widget.subscription_split_groups = subSplitEl.checked;

    const widgetBudgetsEl = document.getElementById(`${widgetId}-budgets`);
    if (widgetBudgetsEl) {
        widget.budget_names = Array.from(widgetBudgetsEl.selectedOptions).map(o => o.value);
    }
    const bdByEl = document.getElementById(`${widgetId}-budget-breakdown-by`);
    if (bdByEl) widget.budget_breakdown_by = bdByEl.value;

    const exclCatsEl = document.getElementById(`${widgetId}-exclude-categories`);
    if (exclCatsEl) {
        widget.exclude_categories = Array.from(exclCatsEl.selectedOptions).map(o => o.value);
    }
    const exclBudgetsEl = document.getElementById(`${widgetId}-exclude-budgets`);
    if (exclBudgetsEl) {
        widget.exclude_budgets = Array.from(exclBudgetsEl.selectedOptions).map(o => o.value);
    }

    return widget;
}

async function updateWidgetDateRange(widgetId) {
    const widgets = await getDashboardWidgets();
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;

    readWidgetSettings(widgetId, widget);
    widget.updated_at = new Date().toISOString();

    // Same requirement as the Graph Builder: balance, card paydown and
    // sankey widgets chart accounts, so they need at least one account or group
    const widgetType = widget.widget_type || 'balance';
    if ((widgetType === 'balance' || widgetType === 'card_paydown' || widgetType === 'sankey') &&
        (widget.accounts || []).length === 0 && (widget.group_ids || []).length === 0) {
        OxiUI.toast('Please select at least one account or group', 'error');
        return;
    }
    if (widgetType === 'budget_breakdown' && (widget.budget_names || []).length === 0) {
        OxiUI.toast('Please select at least one budget', 'error');
        return;
    }
    if (widgetType === 'category_subcat' && (widget.subcategories || []).length === 0) {
        OxiUI.toast('Please select at least one category', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/widgets/${widgetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(widget)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `HTTP ${response.status}`);
        }

        // Keep the cached copy in sync: width / height edits PUT the cached
        // widget and would otherwise revert these settings
        const cacheIndex = widgetsCache.findIndex(w => w.id === widgetId);
        if (cacheIndex !== -1) widgetsCache[cacheIndex] = widget;

        // Header tags, badges and the (closed) settings panel follow the
        // saved widget right away
        refreshWidgetCard(widget);

        // Re-render the chart
        const allAccounts = await fetchAccounts();
        const allGroups = await fetchDashboardGroups();
        await renderWidgetChart(widget, widgetId, allAccounts, allGroups);
    } catch (e) {
        console.error('Failed to update widget:', e);
        OxiUI.toast(`Failed to update widget: ${e.message}`, 'error');
    }
}

async function fetchAccounts() {
    const allAccounts = [];

    for (const type of CONFIG.accountTypes) {
        const response = await fetch(`/api/accounts?type=${type}`);
        if (response.ok) {
            const accounts = await response.json();
            allAccounts.push(...accounts);
        }
    }

    return allAccounts;
}

async function fetchDashboardGroups() {
    try {
        const response = await fetch('/api/groups');
        if (!response.ok) return [];
        return await response.json();
    } catch {
        return [];
    }
}

async function fetchChartData(accountIds, startDate, endDate, interval) {
    const params = new URLSearchParams();

    accountIds.forEach(id => params.append('accounts[]', id));
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    if (interval && interval !== 'auto') params.append('period', interval);

    const url = `/api/accounts/balance-history?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

function generateColors(count) {
    const colors = [];
    for (let i = 0; i < count; i++) {
        colors.push(seriesColor(i));
    }
    return colors;
}

// Show or hide the trend line(s) belonging to one dataset (matched via
// trendOf) so they never outlive their source series in the legend.
function setTrendlineHidden(widgetId, sourceIndex, hidden) {
    const chart = widgetCharts[widgetId];
    if (!chart) return;
    chart.data.datasets.forEach((d) => {
        if (d && d.isTrendline && d.trendOf === sourceIndex) {
            d.hidden = hidden;
        }
    });
}

function selectAllDatasets(widgetId) {
    if (!widgetDatasetVisibility[widgetId]) {
        widgetDatasetVisibility[widgetId] = {};
    }

    const legendItems = document.getElementById(`${widgetId}-legend-items`);
    if (!legendItems) return;

    const items = legendItems.querySelectorAll('.legend-item');
    items.forEach((item) => {
        const index = parseInt(item.dataset.accountIndex, 10);
        widgetDatasetVisibility[widgetId][index] = true;
        item.classList.remove('hidden');
        item.classList.add('active');
    });

    if (widgetCharts[widgetId]) {
        items.forEach((item) => {
            const index = parseInt(item.dataset.accountIndex, 10);
            widgetCharts[widgetId].data.datasets[index].hidden = false;
            // Keep the matching trend line in sync
            setTrendlineHidden(widgetId, index, false);
        });
        widgetCharts[widgetId].update();
    }
}

function deselectAllDatasets(widgetId) {
    if (!widgetDatasetVisibility[widgetId]) {
        widgetDatasetVisibility[widgetId] = {};
    }

    const legendItems = document.getElementById(`${widgetId}-legend-items`);
    if (!legendItems) return;

    const items = legendItems.querySelectorAll('.legend-item');
    items.forEach((item) => {
        const index = parseInt(item.dataset.accountIndex, 10);
        widgetDatasetVisibility[widgetId][index] = false;
        item.classList.remove('active');
        item.classList.add('hidden');
    });

    if (widgetCharts[widgetId]) {
        items.forEach((item) => {
            const index = parseInt(item.dataset.accountIndex, 10);
            widgetCharts[widgetId].data.datasets[index].hidden = true;
            // Keep the matching trend line in sync
            setTrendlineHidden(widgetId, index, true);
        });
        widgetCharts[widgetId].update();
    }
}

function renderSplitLegend(widgetId, accountInfo, datasets) {
    const legendContainer = document.getElementById(`${widgetId}-legend`);
    const legendItems = document.getElementById(`${widgetId}-legend-items`);

    // Clear previous legend
    legendItems.innerHTML = '';

    if (accountInfo.length === 0) {
        legendContainer.style.display = 'none';
        return;
    }

    legendContainer.style.display = 'block';

    // Preserve existing visibility state; only initialise new entries.
    // This prevents the user's toggle choices from being wiped on re-render.
    if (!widgetDatasetVisibility[widgetId]) {
        widgetDatasetVisibility[widgetId] = {};
    }
    accountInfo.forEach((_, index) => {
        if (widgetDatasetVisibility[widgetId][index] === undefined) {
            widgetDatasetVisibility[widgetId][index] = true;
        }
    });

    // Add Select All / Deselect All buttons
    const controlRow = document.createElement('div');
    controlRow.className = 'legend-controls';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'legend-control-btn';
    selectAllBtn.textContent = 'Select all';
    selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAllDatasets(widgetId);
    });

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.className = 'legend-control-btn';
    deselectAllBtn.textContent = 'Deselect all';
    deselectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deselectAllDatasets(widgetId);
    });

    controlRow.appendChild(selectAllBtn);
    controlRow.appendChild(deselectAllBtn);
    legendItems.prepend(controlRow);

    // Create legend item for each account
    accountInfo.forEach((info, index) => {
        const dataset = datasets[index];
        if (!dataset) return;

        const item = document.createElement('div');
        item.className = `legend-item ${widgetDatasetVisibility[widgetId][index] ? 'active' : 'hidden'}`;
        item.dataset.accountIndex = index;

        const colorDiv = document.createElement('div');
        colorDiv.className = 'legend-color';
        colorDiv.style.backgroundColor = dataset.borderColor;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'legend-name';
        nameSpan.textContent = info.name;

        const toggleIcon = document.createElement('span');
        toggleIcon.className = 'legend-toggle-icon';
        toggleIcon.textContent = '▼';

        item.appendChild(colorDiv);
        item.appendChild(nameSpan);
        item.appendChild(toggleIcon);

        // Click handler to toggle visibility
        item.addEventListener('click', () => {
            // Toggle visibility
            widgetDatasetVisibility[widgetId][index] = !widgetDatasetVisibility[widgetId][index];
            if (widgetCharts[widgetId]) {
                widgetCharts[widgetId].data.datasets[index].hidden = !widgetDatasetVisibility[widgetId][index];
                // Keep the matching trend line in sync
                setTrendlineHidden(widgetId, index, !widgetDatasetVisibility[widgetId][index]);
            }
            item.classList.toggle('active');
            item.classList.toggle('hidden');

            // Update chart
            if (widgetCharts[widgetId]) {
                widgetCharts[widgetId].update();
            }
        });

        legendItems.appendChild(item);
    });
}

function getChartOptions(widget) {
    const raw = normalizeChartOptions(widget.chart_options);
    return {
        showPoints: raw.show_points,
        showGrid: raw.show_grid,
        xAxisLimit: raw.x_axis_limit,
        yAxisLimit: raw.y_axis_limit,
        fillArea: raw.fill_area,
        tension: raw.tension,
        beginAtZero: raw.begin_at_zero,
        showPct: raw.show_pct,
        pctMode: raw.pct_mode,
        enableForecast: raw.enable_forecast,
        forecastDays: raw.forecast_days,
        showTrendline: raw.show_trendline,
        trendlineWindow: raw.trendline_window,
        stacked: raw.stacked,
        enableComparison: raw.enable_comparison,
        comparisonStartDate: raw.comparison_start_date,
        comparisonEndDate: raw.comparison_end_date
    };
}

// Append a dotted moving-average "trend line" dataset per series when the
// widget has the trend line option enabled (mutates `datasets`).
function appendWidgetTrendlines(datasets, opts) {
    if (!Array.isArray(datasets) || !opts || !opts.showTrendline) return;
    OxiUI.addTrendlineDatasets(datasets, { window: opts.trendlineWindow })
        .forEach(d => datasets.push(d));
}

async function renderEarnedSpentChart(ctx, widget, labels, history, _canvasId, chartType = 'bars') {
    if (chartType === 'delta_line') {
        renderDeltaLineChartDashboard(ctx, widget, labels, history);
    } else if (chartType === 'delta_bar') {
        renderDeltaBarChartDashboard(ctx, widget, labels, history);
    } else {
        renderEarnedSpentBarsChartDashboard(ctx, widget, labels, history);
    }
}

function renderEarnedSpentBarsChartDashboard(ctx, widget, labels, history) {
    const opts = getChartOptions(widget);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = chartColors().textColor;
    const chartGridColor = chartColors().gridColor;

    // Find earned and spent datasets from history
    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels) : new Array(labels.length).fill(0);

    // Earned is typically positive (income), spent is typically positive (expense)
    // We'll show earned in green and spent in red
    const earnedColor = chartColors().earned;
    const spentColor = chartColors().spent;

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    const datasets = [
        {
            label: 'Earned',
            data: earnedData,
            backgroundColor: earnedColor,
            borderColor: earnedColor,
            borderWidth: 1
        },
        {
            label: 'Spent',
            data: spentData,
            backgroundColor: spentColor,
            borderColor: spentColor,
            borderWidth: 1
        }
    ];

    // Trend line: dotted moving average per series
    appendWidgetTrendlines(datasets, opts);

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.yAxisLimit,
                        callback: function(value) {
                            return Math.abs(value).toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.xAxisLimit,
                        autoSkip: true,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            const date = parseChartLabel(label);
                            return date.toLocaleDateString();
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: chartTextColor }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.parsed.y !== null) {
                                return context.dataset.label + ': ' + Math.abs(context.parsed.y).toLocaleString();
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

function renderDeltaLineChartDashboard(ctx, widget, labels, history) {
    const opts = getChartOptions(widget);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = chartColors().textColor;
    const chartGridColor = chartColors().gridColor;

    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels) : new Array(labels.length).fill(0);

    const deltaData = earnedData.map((earned, i) => earned - spentData[i]);

    const lineColor = chartColors().accent;
    const pointColor = deltaData.map(v => v >= 0 ? chartColors().earned : chartColors().spent);

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    const chartDatasets = [{
        label: 'Delta (Earned - Spent)',
        data: deltaData,
        borderColor: lineColor,
        backgroundColor: lineColor + '33',
        tension: 0.3,
        pointBackgroundColor: pointColor,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: false
    }];

    // Trend line: dotted moving average
    appendWidgetTrendlines(chartDatasets, opts);

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'line',
        plugins: [OxiUI.hoverValueGuidePlugin],
        data: {
            labels: labels,
            datasets: chartDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: opts.beginAtZero,
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.yAxisLimit,
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.xAxisLimit,
                        autoSkip: true,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            const date = parseChartLabel(label);
                            return date.toLocaleDateString();
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: chartTextColor }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value !== null) {
                                const sign = value >= 0 ? '+' : '';
                                return 'Delta: ' + sign + value.toLocaleString();
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

function renderDeltaBarChartDashboard(ctx, widget, labels, history) {
    const opts = getChartOptions(widget);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = chartColors().textColor;
    const chartGridColor = chartColors().gridColor;

    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels) : new Array(labels.length).fill(0);

    const deltaData = earnedData.map((earned, i) => earned - spentData[i]);

    const greenColor = chartColors().earned;
    const redColor = chartColors().spent;

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    const chartDatasets = [{
        label: 'Delta (Earned - Spent)',
        data: deltaData,
        backgroundColor: deltaData.map(v => v >= 0 ? greenColor : redColor),
        borderColor: deltaData.map(v => v >= 0 ? greenColor : redColor),
        borderWidth: 1
    }];

    // Trend line: dotted moving average
    appendWidgetTrendlines(chartDatasets, opts);

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: chartDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.yAxisLimit,
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.xAxisLimit,
                        autoSkip: true,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            const date = parseChartLabel(label);
                            return date.toLocaleDateString();
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: chartTextColor }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value !== null) {
                                const sign = value >= 0 ? '+' : '';
                                return 'Delta: ' + sign + value.toLocaleString();
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

function extractChartData(entries, labels) {
    // Build a lookup map from date key to numeric value
    const valueMap = {};
    if (Array.isArray(entries)) {
        for (const e of entries) {
            const key = e.key || e.date || e.timestamp || '';
            valueMap[key] = parseFloat(e.value || 0);
        }
    } else if (typeof entries === 'object' && entries !== null) {
        for (const [key, v] of Object.entries(entries)) {
            if (typeof v === 'object' && v !== null) {
                valueMap[key] = parseFloat(v.value || 0);
            } else {
                valueMap[key] = parseFloat(v);
            }
        }
    }

    // Align data to labels so each value lands at the correct x-axis position
    return (labels || []).map(label => {
        const val = valueMap[label];
        return val === undefined ? 0 : (isNaN(val) ? 0 : val);
    });
}

// Filter ChartLine datasets by budget names (matches by label)
function filterChartLineByNames(chartLine, budgetNames) {
    const nameSet = new Set(budgetNames);
    return chartLine.filter(ds => nameSet.has(ds.label));
}

// Render a pie chart for widget data
function renderPieChartWidget(ctx, widget, labels, data, colors = null, pieOpts = {}) {
    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }
    widgetCharts[widget.id] = OxiUI.createPieChart(ctx, labels, data, Object.assign({ colors }, pieOpts));
}

async function refreshWidget(widgetId) {
    const btn = document.querySelector(`[data-widget-id="${widgetId}"] .refresh-btn`);
    if (btn) {
        btn.textContent = '⟳ Refreshing...';
        btn.disabled = true;
    }

    try {
        const widgets = await getDashboardWidgets();
        const widget = widgets.find(w => w.id === widgetId);
        if (!widget) return;

        const widgetType = widget.widget_type || 'balance';
        const groupIds = widget.group_ids || [];
        const allGroups = await fetchDashboardGroups();
        const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
        const groupAccountIds = new Set();
        widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
        const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];
        const allAccounts = await fetchAccounts();

        // Determine the since date from widget's updated_at
        const sinceDate = widget.updated_at
            ? widget.updated_at.split('T')[0]
            : null;

        // Always do a full re-fetch for all widget types.
        // Incremental refresh was problematic: the backend seeds all period keys with 0.0,
        // which overwrites existing data when merged via {...existing, ...partial}.
        await renderWidgetChart(widget, widgetId, allAccounts, allGroups);
    } catch (e) {
        console.error('Failed to refresh widget:', e);
        OxiUI.toast(`Failed to refresh widget: ${e.message}`, 'error');
    } finally {
        if (btn) {
            btn.textContent = '⟳ Refresh';
            btn.disabled = false;
        }
    }
}

// Merge partial chart data (from since-date fetch) into existing chart data
function mergePartialChartIntoExisting(chartInstance, partialChart) {
    const existingDatasets = chartInstance.config.data.datasets;
    const partialDatasets = partialChart || [];

    // Build a map of partial entries by dataset label
    const partialEntriesMap = {};
    for (const dataset of partialDatasets) {
        partialEntriesMap[dataset.label] = dataset.entries || {};
    }

    // Merge: update entries that exist in partial chart, keep existing entries for others
    const merged = existingDatasets.map(dataset => {
        const partialEntries = partialEntriesMap[dataset.label] || {};
        const mergedEntries = { ...dataset.entries, ...partialEntries };
        return { ...dataset, entries: mergedEntries };
    });

    return merged;
}

// Helper: extract labels from chart history data
function extractChartLabels(history) {
    let labels = [];
    const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
    if (firstDataset) {
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }
    return labels;
}

async function renderSankeyWidget(widget, canvasId, allGroups, effectiveStart, effectiveEnd) {
    const sankeyDiv = document.getElementById(canvasId + '-sankey');
    if (!sankeyDiv) return;
    sankeyDiv.innerHTML = '';

    const errorDiv = document.getElementById(canvasId + '-error');
    if (errorDiv) errorDiv.textContent = '';

    // Resolve account IDs from groups + individual
    const groupIds = widget.group_ids || [];
    const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
    const groupAccountIds = new Set();
    widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
    const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];

    if (allWidgetAccountIds.length === 0) {
        if (errorDiv) errorDiv.textContent = 'No accounts selected for Sankey flow';
        return;
    }

    // d3 comes from a CDN: say so instead of failing with a vague error
    // when it is blocked
    if (typeof OxiSankey === 'undefined' || !OxiSankey.available()) {
        if (errorDiv) {
            errorDiv.textContent = typeof OxiSankey === 'undefined'
                ? 'The Sankey chart script could not be loaded. Refresh the page.'
                : OxiSankey.unavailableMessage;
        }
        return;
    }

    const flowType = widget.sankey_flow_type || 'destination';
    const params = new URLSearchParams();
    params.append('flow_type', flowType);
    if (effectiveStart) params.append('start', effectiveStart);
    if (effectiveEnd) params.append('end', effectiveEnd);
    allWidgetAccountIds.forEach(id => params.append('accounts[]', id));

    try {
        appendExclusionParams(params, mergeExclusions(dashboardExclusions, widget));
        const response = await fetch('/api/sankey/flows?' + params.toString());
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        widgetSankeyData[widget.id] = data;
        OxiSankey.render(sankeyDiv, data, { tooltip: document.getElementById('sankey-tooltip') });
    } catch (e) {
        if (errorDiv) errorDiv.textContent = 'Failed to load Sankey data: ' + e.message;
    }
}

// ── Card Paydown Widget ──────────────────────────────────────────────────

async function renderCardPaydownWidget(widget, canvasId, allGroups, effectiveStart, effectiveEnd) {
    const canvasEl = document.getElementById(canvasId);
    const ctx = canvasEl.getContext('2d');
    const errorEl = document.getElementById(`${canvasId}-error`);
    if (errorEl) errorEl.textContent = '';

    // Resolve account IDs from widget + groups
    const groupIds = widget.group_ids || [];
    const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
    const groupAccountIds = new Set();
    widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
    const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];

    // Fetch card paydown data
    const params = new URLSearchParams();
    allWidgetAccountIds.forEach(id => params.append('accounts[]', id));
    if (effectiveStart) params.append('start', effectiveStart);
    if (effectiveEnd) params.append('end', effectiveEnd);

    try {
        const response = await fetch(`/api/card-paydown?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        renderCardPaydownChart(ctx, widget, data, canvasId);
    } catch (e) {
        if (errorEl) errorEl.textContent = e.message;
    }
}

function renderCardPaydownChart(ctx, widget, data, canvasId) {
    if (!(data.monthly_activity || []).length) {
        showWidgetMessage(canvasId, 'No card activity found for the selected accounts and date range');
        return;
    }
    if (widgetCharts[canvasId]) {
        widgetCharts[canvasId].destroy();
    }
    // Same chart as the Widget Builder preview (OxiUI.cardPaydownChartConfig)
    widgetCharts[canvasId] = new Chart(ctx, OxiUI.cardPaydownChartConfig(data, getChartOptions(widget)));
}

// Compare-with-previous-period view for balance widgets: primary line plus a
// dashed line for the comparison range (same behavior as the Graph Builder's
// "Compare with previous period" option).
function renderBalanceComparisonChart(ctx, widget, history, comparisonHistory) {
    const opts = getChartOptions(widget);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = chartColors().textColor;
    const chartGridColor = chartColors().gridColor;

    // Same series as the builder preview: total or per account (following
    // the layout), each with its previous period
    const { labels, datasets } = OxiUI.balanceComparisonChart(
        history, comparisonHistory, { split: (widget.chart_mode || 'combined') === 'split' });
    if (labels.length === 0) return;
    OxiUI.styleComparisonDatasets(datasets, opts);
    appendWidgetTrendlines(datasets, opts);

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'line',
        plugins: [OxiUI.hoverValueGuidePlugin],
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: chartTextColor }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toLocaleString();
                        }
                    }
                }
            },
            scales: OxiUI.applyStackedScales({
                y: {
                    beginAtZero: opts.beginAtZero,
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.yAxisLimit,
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.xAxisLimit,
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }, false)
        }
    });
}

// Net worth widget (line chart) — mirrors the Graph Builder's net worth view.
function renderNetWorthChartDashboard(ctx, widget, history) {
    const opts = getChartOptions(widget);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = chartColors().textColor;
    const chartGridColor = chartColors().gridColor;
    const netWorthColor = chartColors().earned;

    let labels = [];
    let data = [];

    if (history && history.length > 0) {
        const dataset = history[0];

        if (Array.isArray(dataset.entries)) {
            labels = dataset.entries.map(e => e.date || e.key);
            data = dataset.entries.map(e => parseFloat(e.ba || e.value || 0));
        } else if (typeof dataset.entries === 'object') {
            labels = Object.keys(dataset.entries);
            data = Object.values(dataset.entries).map(v => {
                if (typeof v === 'object' && v !== null) {
                    return parseFloat(v.ba || v.value || 0);
                }
                return parseFloat(v);
            });
        }
    }

    if (labels.length === 0) {
        const errorEl = document.getElementById(`${widget.id}-error`);
        if (errorEl) errorEl.textContent = 'No net worth data available';
        return;
    }

    const chartDatasets = [{
        label: 'Net Worth',
        data: data,
        absoluteData: data,
        borderColor: netWorthColor,
        backgroundColor: netWorthColor + '20',
        borderWidth: 2,
        tension: opts.tension,
        fill: opts.fillArea,
        pointRadius: opts.showPoints ? 4 : 0
    }];

    // Trend line: dotted moving average
    appendWidgetTrendlines(chartDatasets, opts);

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'line',
        plugins: [OxiUI.hoverValueGuidePlugin],
        data: {
            labels: labels,
            datasets: chartDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: opts.beginAtZero,
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.yAxisLimit,
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: opts.xAxisLimit,
                        maxRotation: 45,
                        minRotation: 45,
                        callback: function(value) {
                            const date = parseChartLabel(value);
                            return date.toLocaleDateString();
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: chartTextColor }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.parsed.y !== null) {
                                return 'Net Worth: ' + context.parsed.y.toLocaleString();
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
    widgetCharts[widget.id].__pctOpts = { enabled: opts.showPct, mode: opts.pctMode };
}

function formatTileMoney(value, symbol) {
    const n = Number.isFinite(value) ? value : 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sign + (symbol || '') + abs;
}

function formatTileRange(start, end) {
    const parse = (str) => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
    try {
        const a = parse(start), b = parse(end);
        const mo = (dt) => dt.toLocaleString(undefined, { month: 'short' });
        return `${mo(a)} ${a.getDate()} \u2013 ${mo(b)} ${b.getDate()}`;
    } catch {
        return '';
    }
}

// Builds the markup for the "Saved This Month" tile (dashboard variant).
function buildSavedTileHtml(data) {
    const cur = data.current_month || {};
    const prev = data.previous_month || {};
    const symbol = data.currency_symbol || '';
    const saved = Number(cur.saved) || 0;
    const diff = Number(data.difference) || 0;
    const up = diff >= 0;
    const range = formatTileRange(data.current_month_start, data.current_month_end);

    return `
        <div class="stat-tile">
            <div class="stat-tile-value ${saved < 0 ? 'negative' : 'positive'}">${formatTileMoney(saved, symbol)}</div>
            <div class="stat-tile-label">Saved in ${escapeHtml(cur.label || 'this month')}</div>
            ${range ? `<div class="stat-tile-sub">${range}</div>` : ''}
            <div class="stat-tile-breakdown">
                <div class="stat-tile-row"><span>Income</span><strong>${formatTileMoney(cur.earned || 0, symbol)}</strong></div>
                <div class="stat-tile-row"><span>Expenses</span><strong>${formatTileMoney(cur.spent || 0, symbol)}</strong></div>
            </div>
            <div class="stat-tile-compare ${up ? 'up' : 'down'}">
                <span class="stat-tile-delta">${up ? '\u25b2' : '\u25bc'} ${formatTileMoney(Math.abs(diff), symbol)}</span>
                <span class="stat-tile-compare-note">vs ${escapeHtml(prev.label || 'last month')} (${formatTileMoney(prev.saved || 0, symbol)})</span>
            </div>
        </div>`;
}

// Renders the "Saved This Month" stat tile in place of a chart canvas.
async function renderSavedTileWidget(widget, canvasId, allGroups = []) {
    // Resolve account IDs from groups + individual
    const groupIds = widget.group_ids || [];
    const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
    const groupAccountIds = new Set();
    widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
    const allWidgetAccountIds = [...new Set([...(widget.accounts || []), ...groupAccountIds])];

    const errorDiv = document.getElementById(canvasId + '-error');
    if (errorDiv) errorDiv.textContent = '';

    // Hide the canvas and inject a tile container into the chart area
    const canvas = document.getElementById(canvasId);
    if (canvas) canvas.style.display = 'none';
    const chartEl = document.querySelector(`.widget[data-widget-id="${widget.id}"] .widget-chart`);
    let tileEl = document.getElementById(canvasId + '-tile');
    if (!tileEl && chartEl) {
        tileEl = document.createElement('div');
        tileEl.id = canvasId + '-tile';
        tileEl.style.height = '100%';
        chartEl.appendChild(tileEl);
    }
    if (!tileEl) return;
    tileEl.innerHTML = '<div class="loading">' + OxiUI.spinnerHtml('Loading savings\u2026') + '</div>';

    const params = new URLSearchParams();
    allWidgetAccountIds.forEach(id => params.append('accounts[]', id));
    let url = '/api/saved-this-month';
    if (params.toString()) url += `?${params.toString()}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);
        const data = await response.json();
        tileEl.innerHTML = buildSavedTileHtml(data);
    } catch (e) {
        if (errorDiv) errorDiv.textContent = 'Failed to load savings: ' + e.message;
        tileEl.innerHTML = '';
    }

    // The tile has no date range, chart type, or display options to tweak,
    // so hide those parts of the widget settings.
    const settingsEl = document.getElementById(widget.id + '-settings');
    if (settingsEl) {
        const firstSection = settingsEl.querySelector('.widget-settings-section');
        if (firstSection) firstSection.style.display = 'none';
        settingsEl.querySelectorAll('.widget-settings-section').forEach(sec => {
            const strong = sec.querySelector('strong');
            if (strong) {
                const label = strong.textContent.trim();
                if (label === 'Display Options' || label === 'Exclusions') {
                    sec.style.display = 'none';
                }
            }
        });
    }
}

// ---- Spending by Label (label_spend widget type) -------------------------

/** Color of the implicit "Unlabeled" remainder series (matches the /labels page). */
const UNLABELED_SERIES_COLOR = '#9ca3af';

/**
 * Resolve the line color for one label spend dataset: the user-picked label
 * color when known, the standard gray for "Unlabeled", otherwise null (the
 * caller falls back to the generated palette).
 */
function labelDatasetColor(datasetLabel, colorMap) {
    if (datasetLabel === 'Unlabeled') return UNLABELED_SERIES_COLOR;
    if (colorMap && colorMap[datasetLabel]) return colorMap[datasetLabel];
    return null;
}

/** {name: color} map from label definitions (labels without a color are omitted). */
function labelColorMap(labels) {
    const map = {};
    (labels || []).forEach(l => {
        if (l && l.name && l.color) map[l.name] = l.color;
    });
    return map;
}

/** Label definitions (for series colors); null when the API is unavailable. */
async function fetchLabelDefinitions() {
    try {
        const response = await fetch('/api/labels');
        if (!response.ok) return null;
        const labels = await response.json();
        return Array.isArray(labels) ? labels : null;
    } catch (e) {
        return null;
    }
}

/**
 * Query params for a label_spend widget's /api/labels/spend fetch (pure,
 * testable). widget.budget_names empty = all budgets; widget.include_unlabeled
 * absent = include; dashboard + widget exclusions are merged.
 */
function buildLabelSpendWidgetParams(widget, effectiveStart, effectiveEnd, allGroups, dashExclusions) {
    const groupIds = widget.group_ids || [];
    const groupAccountIds = new Set();
    groupIds.forEach(gid => {
        const g = (allGroups || []).find(gg => gg.id === gid);
        if (g) (g.account_ids || []).forEach(id => groupAccountIds.add(id));
    });
    const accountIds = [...new Set([...(widget.accounts || []), ...groupAccountIds])];

    const params = new URLSearchParams();
    if (effectiveStart) params.append('start', effectiveStart);
    if (effectiveEnd) params.append('end', effectiveEnd);
    if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
    (widget.budget_names || []).forEach(name => params.append('budgets[]', name));
    accountIds.forEach(id => params.append('accounts[]', id));
    params.append('include_unlabeled', widget.include_unlabeled === false ? '0' : '1');
    appendExclusionParams(params, mergeExclusions(dashExclusions, widget));
    return params;
}

/**
 * Query params for a subscription_cost widget's /api/subscriptions/spend
 * fetch (pure, testable). widget.subscription_ids /
 * widget.subscription_group_ids empty = all subscriptions; dashboard +
 * widget exclusions are merged.
 */
function buildSubscriptionWidgetParams(widget, effectiveStart, effectiveEnd, allGroups, dashExclusions) {
    const groupIds = widget.group_ids || [];
    const groupAccountIds = new Set();
    groupIds.forEach(gid => {
        const g = (allGroups || []).find(gg => gg.id === gid);
        if (g) (g.account_ids || []).forEach(id => groupAccountIds.add(id));
    });
    const accountIds = [...new Set([...(widget.accounts || []), ...groupAccountIds])];

    const params = new URLSearchParams();
    if (effectiveStart) params.append('start', effectiveStart);
    if (effectiveEnd) params.append('end', effectiveEnd);
    if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
    (widget.subscription_ids || []).forEach(id => params.append('subscriptions[]', id));
    (widget.subscription_group_ids || []).forEach(id => params.append('groups[]', id));
    // Default (falsy/absent): each selected group is charted as one total.
    params.append('split_groups', widget.subscription_split_groups ? '1' : '0');
    accountIds.forEach(id => params.append('accounts[]', id));
    appendExclusionParams(params, mergeExclusions(dashExclusions, widget));
    return params;
}

/**
 * Query params for a budget_breakdown widget's /api/budgets/breakdown
 * fetch (pure, testable). widget.budget_breakdown_by absent/"category" =
 * one series per full category (Parent:Sub), "main_category" = one series
 * per main category, "destination" = one series per destination account; dashboard + widget exclusions are merged.
 */
function buildBudgetBreakdownWidgetParams(widget, effectiveStart, effectiveEnd, allGroups, dashExclusions) {
    const groupIds = widget.group_ids || [];
    const groupAccountIds = new Set();
    groupIds.forEach(gid => {
        const g = (allGroups || []).find(gg => gg.id === gid);
        if (g) (g.account_ids || []).forEach(id => groupAccountIds.add(id));
    });
    const accountIds = [...new Set([...(widget.accounts || []), ...groupAccountIds])];

    const params = new URLSearchParams();
    if (effectiveStart) params.append('start', effectiveStart);
    if (effectiveEnd) params.append('end', effectiveEnd);
    if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
    const by = widget.budget_breakdown_by;
    params.append('by', by === 'destination' || by === 'main_category' ? by : 'category');
    (widget.budget_names || []).forEach(name => params.append('budgets[]', name));
    accountIds.forEach(id => params.append('accounts[]', id));
    appendExclusionParams(params, mergeExclusions(dashExclusions, widget));
    return params;
}

let subscriptionOptionsPromise = null;

/**
 * Picker data for subscription_cost widget settings (fetched once per
 * page load; the backend caches both lists).
 */
function getSubscriptionOptions() {
    if (!subscriptionOptionsPromise) {
        subscriptionOptionsPromise = Promise.all([
            fetch('/api/subscriptions').then(r => (r.ok ? r.json() : [])),
            fetch('/api/subscriptions/groups').then(r => (r.ok ? r.json() : []))
        ])
            .then(([subscriptions, groups]) => ({
                subscriptions: Array.isArray(subscriptions) ? subscriptions : [],
                groups: Array.isArray(groups) ? groups : []
            }))
            .catch(e => {
                console.error('Failed to load subscription options:', e);
                subscriptionOptionsPromise = null; // allow retry on next open
                return { subscriptions: [], groups: [] };
            });
    }
    return subscriptionOptionsPromise;
}

// Widget types rendered by renderMultiSeriesWidget without extra filtering
const MULTI_SERIES_WIDGET_TYPES = ['expenses_by_category', 'category_subcat', 'subscription_cost', 'budget_breakdown'];

// Show a message in place of a widget's chart (no data, feature disabled,
// ...) and drop the previous chart so stale data is not left on screen.
function showWidgetMessage(widgetId, message) {
    const errorEl = document.getElementById(`${widgetId}-error`);
    if (errorEl) errorEl.textContent = message;
    if (widgetCharts[widgetId]) {
        widgetCharts[widgetId].destroy();
        delete widgetCharts[widgetId];
    }
}

// One ChartLine entry ({value} object or plain number) as a magnitude
// (spend series are charted as positive amounts).
function entryMagnitude(v) {
    const num = typeof v === 'object' && v !== null ? parseFloat(v.value) : parseFloat(v);
    return isNaN(num) ? 0 : Math.abs(num);
}

// Shared renderer for the multi-series widgets (budget spent, labels,
// categories, subscriptions, budget breakdown): a pie of per-series totals,
// or one line per series honoring every display option of the widget
// settings and the legend's saved selection.
function renderMultiSeriesWidget(ctx, widget, history, colorFor = null) {
    const palette = generateColors(history.length);
    const colorAt = (ds, i) => (colorFor && colorFor(ds, i)) || palette[i];

    if ((widget.chart_type || 'line') === 'pie') {
        const totals = history.map(ds =>
            Object.values(ds.entries || {}).reduce((sum, v) => sum + entryMagnitude(v), 0));
        renderPieChartWidget(ctx, widget, history.map(ds => ds.label), totals,
            colorFor ? history.map(colorAt) : null);
        return;
    }

    const opts = getChartOptions(widget);
    const chartTextColor = chartColors().textColor;
    const chartGridColor = chartColors().gridColor;

    const dateSet = new Set();
    history.forEach(ds => {
        if (ds.entries && typeof ds.entries === 'object') {
            Object.keys(ds.entries).forEach(date => dateSet.add(date));
        }
    });
    const allDates = Array.from(dateSet).sort();

    const savedVisibility = widgetDatasetVisibility[widget.id] || {};
    const datasets = history.map((ds, i) => {
        const data = allDates.map(date => entryMagnitude(ds.entries?.[date]));
        const color = colorAt(ds, i);
        return {
            label: ds.label,
            data: data,
            absoluteData: data,
            borderColor: color,
            backgroundColor: color + '33',
            borderWidth: 2,
            order: 1,
            hidden: savedVisibility[i] === false
        };
    });
    const legendInfo = history.map(ds => ({ name: ds.label }));

    OxiUI.applyLineStyle(datasets, opts);
    appendWidgetTrendlines(datasets, opts);
    datasets.forEach(ds => {
        if (ds.isTrendline && savedVisibility[ds.trendOf] === false) ds.hidden = true;
    });
    const stackedDatasets = OxiUI.applyStacking(datasets, opts.stacked);

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    const scales = OxiUI.applyAxisOptions({
        y: {
            grid: { color: chartGridColor },
            ticks: {
                color: chartTextColor,
                callback: function(value) {
                    return value.toLocaleString();
                }
            }
        },
        x: {
            grid: { color: chartGridColor },
            ticks: {
                color: chartTextColor,
                maxRotation: 45,
                callback: function(value) {
                    const label = this.getLabelForValue(value);
                    const date = parseChartLabel(label);
                    return date.toLocaleDateString();
                }
            }
        }
    }, opts);

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allDates,
            datasets: stackedDatasets
        },
        plugins: [OxiUI.hoverValueGuidePlugin, tooltipSortAndLegendPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    itemSort: (a, b) => {
                        const va = Math.abs(a.parsed.y || 0);
                        const vb = Math.abs(b.parsed.y || 0);
                        return vb - va;
                    },
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toLocaleString();
                        }
                    }
                }
            },
            scales: OxiUI.applyStackedScales(scales, opts.stacked)
        }
    });
    widgetCharts[widget.id].__pctOpts = { enabled: opts.showPct, mode: opts.pctMode };

    renderSplitLegend(widget.id, legendInfo, stackedDatasets);
}

async function renderWidgetChart(widget, canvasId, allAccounts, allGroups = []) {
    // Effective dates: the dashboard's range if the widget inherits it, else
    // the widget's relative range (worked out for today), else its fixed dates
    const { start: effectiveStart, end: effectiveEnd } = widgetEffectiveDates(widget, dashboardDates);

    // Clear the previous render's message and legend; renderers that need
    // a legend show it again
    const errorEl = document.getElementById(`${canvasId}-error`);
    if (errorEl) errorEl.textContent = '';
    const legendEl = document.getElementById(`${canvasId}-legend`);
    if (legendEl) legendEl.style.display = 'none';

    try {
        // Determine widget type (default to "balance" for backwards compatibility)
        const widgetType = widget.widget_type || 'balance';

        // Handle sankey widget type separately (uses d3, not Chart.js canvas)
        if (widgetType === 'sankey') {
            await renderSankeyWidget(widget, canvasId, allGroups, effectiveStart, effectiveEnd);
            return;
        }

        // Handle card_paydown widget type separately
        if (widgetType === 'card_paydown') {
            await renderCardPaydownWidget(widget, canvasId, allGroups, effectiveStart, effectiveEnd);
            return;
        }

        // Handle the Saved This Month stat tile (a number, not a chart)
        if (widgetType === 'saved_this_month') {
            await renderSavedTileWidget(widget, canvasId, allGroups);
            return;
        }

        const ctx = document.getElementById(canvasId).getContext('2d');

        let history;
        if (widgetType === 'earned_spent') {
            // For earned vs spent, use the dedicated earned-spent endpoint
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const groupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
            const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];

            const params = new URLSearchParams();
            // Add account IDs if specified
            if (allWidgetAccountIds && Array.isArray(allWidgetAccountIds)) {
                allWidgetAccountIds.forEach(id => params.append('accounts[]', id));
            }
            if (effectiveStart) params.append('start', effectiveStart);
            if (effectiveEnd) params.append('end', effectiveEnd);
            if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
            appendExclusionParams(params, mergeExclusions(dashboardExclusions, widget));

            const url = `/api/earned-spent?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            history = await response.json();
      } else if (widgetType === 'budget_spent') {
            // For budget spent history, use the spent-history endpoint
            const params = new URLSearchParams();
            if (effectiveStart) params.append('start', effectiveStart);
            if (effectiveEnd) params.append('end', effectiveEnd);
            if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
            // Add account IDs for filtering
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const groupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
            const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];
            allWidgetAccountIds.forEach(id => params.append('accounts[]', id));
            appendExclusionParams(params, mergeExclusions(dashboardExclusions, widget));

            const url = `/api/budgets/spent-history?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            history = await response.json();
      } else if (widgetType === 'category_subcat') {
            // For category subcategory spend, use the subcategory-spend endpoint
            const params = new URLSearchParams();
            if (effectiveStart) params.append('start', effectiveStart);
            if (effectiveEnd) params.append('end', effectiveEnd);
            if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
            // Add parent categories
            const parentCategories = widget.parent_categories || [];
            parentCategories.forEach(name => params.append('parent_categories[]', name));
            // Add specific subcategories if any were selected
            const widgetSubcategories = widget.subcategories || [];
            widgetSubcategories.forEach(name => params.append('subcategories[]', name));
            // Add graph mode (parent or subcategory)
            const graphMode = widget.category_graph_mode || 'subcategory';
            params.append('graph_mode', graphMode);
            // Add account IDs for filtering
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const groupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
            const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];
            allWidgetAccountIds.forEach(id => params.append('accounts[]', id));
            appendExclusionParams(params, mergeExclusions(dashboardExclusions, widget));

            const url = `/api/categories/subcategory-spend?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            history = await response.json();
      } else if (widgetType === 'expenses_by_category') {
            // For expenses by category, use the expenses-by-category endpoint
            const params = new URLSearchParams();
            if (effectiveStart) params.append('start', effectiveStart);
            if (effectiveEnd) params.append('end', effectiveEnd);
            if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
            if (widget.category_graph_mode) params.append('graph_mode', widget.category_graph_mode);
            // Add account IDs for filtering
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const groupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
            const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];
            allWidgetAccountIds.forEach(id => params.append('accounts[]', id));
            appendExclusionParams(params, mergeExclusions(dashboardExclusions, widget));

            const url = `/api/expenses-by-category?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            history = await response.json();
        } else if (widgetType === 'net_worth') {
            // For net worth, use the dedicated net-worth endpoint
            const params = new URLSearchParams();
            if (effectiveStart) params.append('start', effectiveStart);
            if (effectiveEnd) params.append('end', effectiveEnd);
            if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);

            const url = `/api/net-worth?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            history = await response.json();
        } else if (widgetType === 'label_spend') {
            // Spending per user-defined label via the Spending Labels API
            // (standard ChartLine with one dataset per label)
            const params = buildLabelSpendWidgetParams(
                widget, effectiveStart, effectiveEnd, allGroups, dashboardExclusions
            );
            const url = `/api/labels/spend?${params.toString()}`;
            const response = await fetch(url);
            if (response.status === 404) {
                showWidgetMessage(canvasId, 'Spending Labels is disabled. Enable it under Settings.');
                return;
            }
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            const labelData = await response.json();
            if (!labelData || labelData.length === 0) {
                const labelDefs = await fetchLabelDefinitions();
                const msg = (labelDefs && labelDefs.length === 0)
                    ? 'No labels defined yet - create some on the Spending Labels page.'
                    : 'No budgeted spend found for this range. Labels only count spend charged to a budget.';
                showWidgetMessage(canvasId, msg);
                return;
            }
            history = labelData;
        } else if (widgetType === 'subscription_cost') {
            // Cost over time per subscription (standard ChartLine with one
            // dataset per subscription)
            const params = buildSubscriptionWidgetParams(
                widget, effectiveStart, effectiveEnd, allGroups, dashboardExclusions
            );
            const url = `/api/subscriptions/spend?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            const subData = await response.json();
            if (!subData || subData.length === 0) {
                let hasAnySubscriptions = false;
                try {
                    const listResp = await fetch('/api/subscriptions');
                    if (listResp.ok) {
                        const list = await listResp.json();
                        hasAnySubscriptions = Array.isArray(list) && list.length > 0;
                    }
                } catch (e) {
                    // keep the generic message
                }
                showWidgetMessage(canvasId, hasAnySubscriptions
                    ? 'No subscription spend found for this range.'
                    : 'No subscriptions found in Firefly III.');
                return;
            }
            history = subData;
        } else if (widgetType === 'budget_breakdown') {
            // Selected budgets' spend over time, one series per category
            // or per destination account (standard ChartLine)
            const params = buildBudgetBreakdownWidgetParams(
                widget, effectiveStart, effectiveEnd, allGroups, dashboardExclusions
            );
            const url = `/api/budgets/breakdown?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            const bdData = await response.json();
            if (!bdData || bdData.length === 0) {
                showWidgetMessage(canvasId, 'No budgeted spend found for this range.');
                return;
            }
            history = bdData;
        } else {
            // For balance widgets, fetch with all relevant accounts (individual + group members)
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const groupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
            const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];

            history = await fetchChartData(
                allWidgetAccountIds,
                effectiveStart,
                effectiveEnd,
                widget.interval
            );
        }

        if (!history || history.length === 0) {
            showWidgetMessage(canvasId, 'No data available');
            return;
        }

        // Extract labels
        let labels = extractChartLabels(history);

        // Handle earned vs spent widget type
        if (widgetType === 'earned_spent') {
            const chartType = widget.chart_type || 'line';
            if (chartType === 'pie') {
                const earnedDataset = history.find(ds => ds.label === 'earned');
                const spentDataset = history.find(ds => ds.label === 'spent');
                let earnedTotal = 0, spentTotal = 0;
                if (earnedDataset) {
                    const vals = extractChartData(earnedDataset.entries, labels);
                    earnedTotal = vals.reduce((a, v) => a + Math.abs(v), 0);
                }
                if (spentDataset) {
                    const vals = extractChartData(spentDataset.entries, labels);
                    spentTotal = vals.reduce((a, v) => a + Math.abs(v), 0);
                }
                renderPieChartWidget(ctx, widget, ['Earned', 'Spent'], [earnedTotal, spentTotal], ['earned', 'spent'], { showTotal: false });
            } else {
                const earnedChartType = widget.earned_chart_type || 'bars';
                await renderEarnedSpentChart(ctx, widget, labels, history, canvasId, earnedChartType);
            }
            return;
        }

        // Multi-series widgets: one line (or pie slice) per budget, label,
        // category or subscription
        if (widgetType === 'budget_spent') {
            const budgetNames = widget.budget_names || [];
            const filteredHistory = budgetNames.length > 0
                ? filterChartLineByNames(history, budgetNames)
                : history;
            if (!filteredHistory || filteredHistory.length === 0) {
                showWidgetMessage(canvasId, 'No budget data available');
                return;
            }
            renderMultiSeriesWidget(ctx, widget, filteredHistory);
            return;
        }

        if (widgetType === 'label_spend') {
            const colorMap = labelColorMap(await fetchLabelDefinitions());
            renderMultiSeriesWidget(ctx, widget, history, ds => labelDatasetColor(ds.label, colorMap));
            return;
        }

        if (MULTI_SERIES_WIDGET_TYPES.includes(widgetType)) {
            renderMultiSeriesWidget(ctx, widget, history);
            return;
        }

        // Handle net_worth widget type
        if (widgetType === 'net_worth') {
            renderNetWorthChartDashboard(ctx, widget, history);
            return;
        }

        // Pie chart for balance widgets: show balance distribution by account
        const chartType = widget.chart_type || 'line';
        // Compare with previous period (balance only): replace the regular
        // view with primary + dashed comparison lines, like the Graph Builder.
        {
            const compOpts = getChartOptions(widget);
            if (compOpts.enableComparison && compOpts.comparisonStartDate && compOpts.comparisonEndDate) {
                let comparisonHistory = null;
                try {
                    const groupIds = widget.group_ids || [];
                    const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
                    const groupAccountIds = new Set();
                    widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
                    const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];
                    comparisonHistory = await fetchChartData(
                        allWidgetAccountIds,
                        compOpts.comparisonStartDate,
                        compOpts.comparisonEndDate,
                        widget.interval
                    );
                } catch (e) {
                    console.warn('Failed to fetch comparison data:', e);
                }
                if (comparisonHistory && comparisonHistory.length > 0) {
                    renderBalanceComparisonChart(ctx, widget, history, comparisonHistory);
                    return;
                }
            }
        }

        if (chartType === 'pie' && widgetType === 'balance') {
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const widgetGroupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => widgetGroupAccountIds.add(id)));
            const individualAccounts = widget.accounts.filter(id => !widgetGroupAccountIds.has(id))
                .map(id => allAccounts.find(a => a.id === id)).filter(Boolean);

            const pieLabels = [];
            const pieData = [];
            widgetGroups.forEach(g => {
                const totalBalance = g.account_ids.reduce((sum, accId) => {
                    const acc = allAccounts.find(a => a.id === accId);
                    return sum + (acc ? Math.abs(parseFloat(acc.balance) || 0) : 0);
                }, 0);
                pieLabels.push(g.name);
                pieData.push(totalBalance);
            });
            individualAccounts.forEach(acc => {
                pieLabels.push(acc.name);
                pieData.push(Math.abs(parseFloat(acc.balance) || 0));
            });
            renderPieChartWidget(ctx, widget, pieLabels, pieData);
            return;
        }

        if ((widget.chart_mode || 'combined') === 'combined') {
            // Aggregate all datasets
            const totalFlowData = new Array(labels.length).fill(0);

            history.forEach(ds => {
                let flowData = [];
                if (Array.isArray(ds.entries)) {
                    flowData = ds.entries.map(e => parseFloat(e.value || 0));
                } else {
                    flowData = Object.values(ds.entries).map(v => {
                        if (typeof v === 'object' && v !== null) {
                            return parseFloat(v.value || 0);
                        }
                        return parseFloat(v);
                    });
                }

                flowData.forEach((val, i) => {
                    if (i < totalFlowData.length) {
                        totalFlowData[i] += val;
                    }
                });
            });

            // The Firefly III chart API returns absolute balance data, not flow data
            // So we can use the totalFlowData directly without any conversion
            const absoluteData = totalFlowData;
            const lastTotalValue = absoluteData[absoluteData.length - 1];

            console.log(`[Combined mode] Using totalFlowData directly as absolute. lastTotalValue=${lastTotalValue}`);

            const opts = getChartOptions(widget);
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const chartTextColor = chartColors().textColor;
            const chartGridColor = chartColors().gridColor;
            const chartColor = chartColors().accent;
            const forecastColor = chartColors().neutral;

            // Forecast
            let chartLabels = labels;
            let chartData = absoluteData;
            let forecastDataset = null;

            if (opts.enableForecast) {
                const result = computeForecast(absoluteData, labels, opts.forecastDays);
                if (result) {
                    chartData = [...absoluteData, ...result.values];
                    chartLabels = [...labels, ...result.labels];
                    forecastDataset = {
                        label: 'Forecast',
                        data: result.values,
                        isForecast: true,
                        borderColor: forecastColor,
                        backgroundColor: forecastColor + '10',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        tension: opts.tension,
                        fill: false,
                        pointRadius: 0,
                        order: 1
                    };
                }
            }

            if (widgetCharts[widget.id]) {
                widgetCharts[widget.id].destroy();
            }

            const combinedDatasets = [{
                label: 'Total Balance',
                data: chartData,
                absoluteData: absoluteData,
                borderColor: chartColor,
                backgroundColor: chartColor + '20',
                borderWidth: 2,
                tension: opts.tension,
                fill: opts.fillArea,
                pointRadius: opts.showPoints ? 4 : 0
            }];
            if (forecastDataset) {
                combinedDatasets.push(forecastDataset);
            }

            // Trend line: dotted moving average over the real (non-forecast) data
            if (opts.showTrendline) {
                const trendDs = OxiUI.trendlineDataset('Total Balance', absoluteData, {
                    window: opts.trendlineWindow,
                    sourceColor: chartColor
                });
                trendDs.trendOf = 0;
                combinedDatasets.push(trendDs);
            }

            // Stacking (#24): group series for stacked rendering
            const stackedDatasets = OxiUI.applyStacking(combinedDatasets, opts.stacked);

            widgetCharts[widget.id] = new Chart(ctx, {
                type: 'line',
                plugins: [OxiUI.hoverValueGuidePlugin],
                data: {
                    labels: chartLabels,
                    datasets: stackedDatasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    if (context.parsed.y !== null) {
                                        return context.parsed.y.toLocaleString();
                                    }
                                    return '';
                                }
                            }
                        }
                    },
                    scales: OxiUI.applyStackedScales({
                        y: {
                            beginAtZero: opts.beginAtZero,
                            grid: { color: chartGridColor },
                            ticks: {
                                color: chartTextColor,
                                maxTicksLimit: opts.yAxisLimit,
                                callback: function(value) {
                                    return value.toLocaleString();
                                }
                            }
                        },
                        x: {
                            display: true,
                            grid: { color: chartGridColor },
                            ticks: {
                                color: chartTextColor,
                                maxTicksLimit: opts.xAxisLimit,
                                autoSkip: true,
                                callback: function(value) {
                                    // value is an index into labels array
                                    const label = this.getLabelForValue(value);
                                    const date = parseChartLabel(label);
                                    return date.toLocaleDateString();
                                }
                            }
                        }
                    }, opts.stacked)
                }
            });
            widgetCharts[widget.id].__pctOpts = { enabled: opts.showPct, mode: opts.pctMode };
        } else {
            // Split mode - multiple lines
            const filteredHistory = history.filter(ds => ds.label !== 'earned' && ds.label !== 'spent');

            // Build display items: groups first (from widget.group_ids), then individual accounts
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const widgetGroupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => widgetGroupAccountIds.add(id)));

            const individualAccounts = widget.accounts
                .filter(id => !widgetGroupAccountIds.has(id))
                .map(id => {
                    const account = allAccounts.find(a => a.id === id);
                    return account ? { id, name: account.name, balance: account.balance } : null;
                })
                .filter(Boolean);

            const totalDisplayItems = widgetGroups.length + individualAccounts.length;
            const colors = generateColors(totalDisplayItems);

            // Helper: find dataset for an account name
            const findDatasetForName = (name) => {
                return filteredHistory.find(ds => {
                    const normalizedDsLabel = ds.label.replace(/ - In$/, '').replace(/ - Out$/, '').replace(/ \(In\)$/, '').replace(/ \(Out\)$/, '');
                    return normalizedDsLabel === name || ds.label === name;
                });
            };

            const datasets = [];
            const legendInfo = [];

            // Add group datasets (aggregated)
            widgetGroups.forEach((group, idx) => {
                let summedData = null;
                let totalBalance = 0;

                group.account_ids.forEach(accId => {
                    const acc = allAccounts.find(a => a.id === accId);
                    if (!acc) return;
                    const dataset = findDatasetForName(acc.name);
                    if (!dataset) return;

                    let flowData = [];
                    if (Array.isArray(dataset.entries)) {
                        flowData = dataset.entries.map(e => parseFloat(e.value || 0));
                    } else {
                        flowData = Object.values(dataset.entries).map(v => {
                            if (typeof v === 'object' && v !== null) return parseFloat(v.value || 0);
                            return parseFloat(v);
                        });
                    }

                    if (!summedData) {
                        summedData = flowData.map(v => v);
                    } else {
                        flowData.forEach((v, i) => {
                            if (summedData[i] !== undefined) summedData[i] += v;
                        });
                    }
                    totalBalance += parseFloat(acc.balance || 0);
                });

                if (!summedData) return;

                const lastValue = summedData[summedData.length - 1];

                // The Firefly III chart API returns absolute balance data, not flow data
                const absoluteData = summedData;

                console.log(`[Split mode] Group "${group.name}": Using aggregated data. lastValue=${lastValue}, totalBalance=${totalBalance}`);

                datasets.push({
                    label: group.name,
                    data: absoluteData,
                    absoluteData: absoluteData,
                    borderColor: colors[idx],
                    borderWidth: 2,
                    tension: getChartOptions(widget).tension,
                    fill: getChartOptions(widget).fillArea,
                    pointRadius: getChartOptions(widget).showPoints ? 4 : 0
                });
                legendInfo.push({ name: group.name, balance: totalBalance.toString() });
            });

            // Add individual account datasets
            individualAccounts.forEach((info, idx) => {
                const dataset = findDatasetForName(info.name);
                const colorIdx = widgetGroups.length + idx;

                if (!dataset) {
                    datasets.push({
                        label: info.name,
                        data: new Array(labels.length).fill(null),
                        absoluteData: new Array(labels.length).fill(null),
                        borderColor: colors[colorIdx],
                        borderWidth: 2,
                        tension: getChartOptions(widget).tension,
                        fill: getChartOptions(widget).fillArea,
                        pointRadius: getChartOptions(widget).showPoints ? 4 : 0
                    });
                    legendInfo.push({ name: info.name, balance: info.balance });
                    return;
                }

                let flowData = [];
                if (Array.isArray(dataset.entries)) {
                    flowData = dataset.entries.map(e => parseFloat(e.value || 0));
                } else {
                    flowData = Object.values(dataset.entries).map(v => {
                        if (typeof v === 'object' && v !== null) return parseFloat(v.value || 0);
                        return parseFloat(v);
                    });
                }

                const anchorBalance = parseFloat(info.balance);
                const absoluteData = flowData;

                console.log(`[Split mode] Account "${info.name}": Using flowData directly as absolute. lastValue=${flowData[flowData.length - 1]}, anchorBalance=${anchorBalance}`);

                datasets.push({
                    label: info.name,
                    data: absoluteData,
                    absoluteData: absoluteData,
                    borderColor: colors[colorIdx],
                    borderWidth: 2,
                    tension: getChartOptions(widget).tension,
                    fill: getChartOptions(widget).fillArea,
                    pointRadius: getChartOptions(widget).showPoints ? 4 : 0
                });
                legendInfo.push({ name: info.name, balance: info.balance });
            });

            if (widgetCharts[widget.id]) {
                widgetCharts[widget.id].destroy();
            }

            const opts2 = getChartOptions(widget);
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const chartTextColor = chartColors().textColor;
            const chartGridColor = chartColors().gridColor;

            // Trend line: dotted moving average per dataset (real data only;
            // appended after the forecast extension below)
            let splitTrendlines = [];
            if (opts2.showTrendline) {
                datasets.forEach((dataset, index) => {
                    const trendDs = OxiUI.trendlineDataset(dataset.label, dataset.data, {
                        window: opts2.trendlineWindow,
                        sourceColor: typeof dataset.borderColor === 'string' ? dataset.borderColor : undefined
                    });
                    trendDs.trendOf = index;
                    splitTrendlines.push(trendDs);
                });
            }

            // Forecast for split mode
            let splitLabels = labels;
            let splitDatasets = datasets;

            if (opts2.enableForecast) {
                const firstVisible = datasets.find(d => d.data && d.data.length > 0 && d.data.some(v => v !== null));
                if (firstVisible) {
                    const result = computeForecast(firstVisible.absoluteData || firstVisible.data, labels, opts2.forecastDays);
                    if (result) {
                        splitLabels = [...labels, ...result.labels];
                        splitDatasets = datasets.map(dataset => {
                            if (!dataset.data || dataset.data.length === 0) return dataset;
                            const forecastResult = computeForecast(dataset.absoluteData || dataset.data, labels, opts2.forecastDays);
                            if (!forecastResult) return dataset;
                            return {
                                ...dataset,
                                data: [...dataset.data, ...forecastResult.values],
                                absoluteData: [...(dataset.absoluteData || dataset.data), ...forecastResult.values]
                            };
                        });
                    }
                }
            }

            if (splitTrendlines.length > 0) {
                splitDatasets.push(...splitTrendlines);
            }

            // Apply the legend's saved selection state so a re-render
            // (refresh, date change, settings edit) keeps deselected series
            // hidden - including their trend lines.
            const savedVisibility = widgetDatasetVisibility[widget.id] || {};
            splitDatasets.forEach((dataset, index) => {
                if (dataset.isTrendline) {
                    if (dataset.trendOf != null && savedVisibility[dataset.trendOf] === false) {
                        dataset.hidden = true;
                    }
                } else if (savedVisibility[index] === false) {
                    dataset.hidden = true;
                }
            });

            // Stacking (#24): group series for stacked rendering
            const stackedDatasets = OxiUI.applyStacking(splitDatasets, opts2.stacked);

            widgetCharts[widget.id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: splitLabels,
                    datasets: stackedDatasets
                },
                plugins: [OxiUI.hoverValueGuidePlugin, tooltipSortAndLegendPlugin],
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            itemSort: (a, b) => {
                                const va = Math.abs(a.parsed.y || 0);
                                const vb = Math.abs(b.parsed.y || 0);
                                return vb - va;
                            },
                            callbacks: {
                                label: function(context) {
                                    if (context.parsed.y !== null) {
                                        return context.dataset.label + ': ' + context.parsed.y.toLocaleString();
                                    }
                                    return '';
                                }
                            }
                        }
                    },
                    scales: OxiUI.applyStackedScales({
                        y: {
                            beginAtZero: opts2.beginAtZero,
                            grid: { color: chartGridColor },
                            ticks: {
                                color: chartTextColor,
                                maxTicksLimit: opts2.yAxisLimit,
                                callback: function(value) {
                                    return value.toLocaleString();
                                }
                            }
                        },
                        x: {
                            display: true,
                            grid: { color: chartGridColor },
                            ticks: {
                                color: chartTextColor,
                                maxTicksLimit: opts2.xAxisLimit,
                                autoSkip: true,
                                callback: function(value) {
                                    // value is an index into labels array
                                    const label = this.getLabelForValue(value);
                                    const date = parseChartLabel(label);
                                    return date.toLocaleDateString();
                                }
                            }
                        }
                    }, opts2.stacked)
                }
            });
            widgetCharts[widget.id].__pctOpts = { enabled: opts2.showPct, mode: opts2.pctMode };

            // Render the legend after chart is created
            renderSplitLegend(widget.id, legendInfo, stackedDatasets);
        }
    } catch (error) {
        console.error('Error rendering widget chart:', error);
        const errorDiv = document.getElementById(`${canvasId}-error`);
        if (errorDiv) {
            errorDiv.textContent = 'Error loading data';
        }
    }
}

// Every option a widget type can expose in its settings panel (the union
// over line/pie, combined/split and all earned variants); which of them are
// visible for the current selection is decided by
// updateWidgetSettingsVisibility.
function widgetSettingsCapabilities(widgetType) {
    return OxiUI.widgetOptionSupport(widgetType, { chartType: 'line', chartMode: 'split', variant: 'delta_line' });
}

// Settings panel of one dashboard widget. Mirrors the Graph Builder's
// controls (same names, order and per-type rules via
// OxiUI.widgetOptionSupport) so a widget can be edited with the options it
// was built with.
function buildWidgetSettingsHtml(widget, context) {
    const {
        allAccounts = [], allGroups = [],
        exclusionOptions = { categories: [], budgets: [] },
        subscriptionOptions = { subscriptions: [], groups: [] },
        startDate = '', endDate = ''
    } = context || {};
    const id = widget.id;
    const widgetType = widget.widget_type || 'balance';
    const caps = widgetSettingsCapabilities(widgetType);
    const chartOpts = getChartOptions(widget);
    const interval = widget.interval || 'auto';
    const sel = (cond) => cond ? 'selected' : '';
    const chk = (cond) => cond ? 'checked' : '';

    // Accounts the widget references but the account list does not contain
    // (e.g. a type outside ACCOUNT_TYPES) stay selectable so saving the
    // settings never silently drops them.
    const accountOptions = allAccounts.map(a => ({ id: a.id, name: a.name }));
    (widget.accounts || []).forEach(accId => {
        if (!accountOptions.some(a => a.id === accId)) accountOptions.push({ id: accId, name: `Account #${accId}` });
    });
    const groupOptions = allGroups.map(g => ({ id: g.id, name: g.name }));
    (widget.group_ids || []).forEach(gid => {
        if (!groupOptions.some(g => g.id === gid)) groupOptions.push({ id: gid, name: `Group ${gid}` });
    });

    const dataControls = [`
                        <label>Type:
                            <select id="${id}-widget-type">
                                ${Object.entries(WIDGET_TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${sel(value === widgetType)}>${label}</option>`).join('')}
                            </select>
                        </label>`];
    if (caps.categories) {
        // Subcategories grouped by main category; selections the category
        // list no longer has stay selectable so saving never drops them
        const tree = (exclusionOptions.categoryTree || []).map(c => ({ name: c.name, subcategories: c.subcategories.slice() }));
        (widget.subcategories || []).forEach(full => {
            const idx = full.indexOf(':');
            if (idx < 0) return;
            const parent = full.slice(0, idx);
            const sub = full.slice(idx + 1);
            let node = tree.find(c => c.name === parent);
            if (!node) tree.push(node = { name: parent, subcategories: [] });
            if (!node.subcategories.includes(sub)) node.subcategories.push(sub);
        });
        dataControls.push(`
                        <label data-opt="categories">Categories:
                            <select multiple size="8" id="${id}-categories" class="exclusion-select">
                                ${tree.filter(c => c.subcategories.length).map(c => `<optgroup label="${escapeHtml(c.name)}">${c.subcategories.map(sub => {
                                    const full = `${c.name}:${sub}`;
                                    return `<option value="${escapeHtml(full)}" ${sel((widget.subcategories || []).includes(full))}>${escapeHtml(sub)}</option>`;
                                }).join('')}</optgroup>`).join('')}
                            </select>
                        </label>`);
    }
    if (caps.accounts) {
        dataControls.push(`
                        <label data-opt="accounts">Accounts:
                            <select multiple size="5" id="${id}-accounts" class="exclusion-select">
                                ${accountOptions.map(a => `<option value="${escapeHtml(a.id)}" ${sel((widget.accounts || []).includes(a.id))}>${escapeHtml(a.name)}</option>`).join('')}
                            </select>
                        </label>
                        <label data-opt="accounts">Groups:
                            <select multiple size="5" id="${id}-groups" class="exclusion-select">
                                ${groupOptions.map(g => `<option value="${escapeHtml(g.id)}" ${sel((widget.group_ids || []).includes(g.id))}>${escapeHtml(g.name)}</option>`).join('')}
                            </select>
                        </label>`);
    }
    if (caps.budgets) {
        dataControls.push(`
                        <label data-opt="budgets">Budgets:
                            <select multiple size="5" id="${id}-budgets" class="exclusion-select">
                                ${exclusionOptions.budgets.map(b => `<option value="${escapeHtml(b)}" ${sel((widget.budget_names || []).includes(b))}>${escapeHtml(b)}</option>`).join('')}
                            </select>
                        </label>`);
    }
    if (caps.subscriptions) {
        dataControls.push(`
                        <label data-opt="subscriptions">Subscriptions:
                            <select multiple size="5" id="${id}-subscriptions" class="exclusion-select">
                                ${subscriptionOptions.subscriptions.map(sub => `<option value="${escapeHtml(sub.id)}" ${sel((widget.subscription_ids || []).includes(sub.id))}>${escapeHtml(sub.name)}</option>`).join('')}
                            </select>
                        </label>
                        <label data-opt="subscriptions">Subscription groups:
                            <select multiple size="4" id="${id}-subscription-groups" class="exclusion-select">
                                ${subscriptionOptions.groups.map(g => `<option value="${escapeHtml(g.id)}" ${sel((widget.subscription_group_ids || []).includes(g.id))}>${escapeHtml(g.name)} (${g.bill_count})</option>`).join('')}
                            </select>
                        </label>
                        <label class="checkbox-label" data-opt="subscriptions" title="By default each selected group is one series showing the group's total cost; enable to show each subscription in the group as its own series instead.">
                            <input type="checkbox" id="${id}-subscription-split" ${chk(widget.subscription_split_groups)}>
                            Split selected groups into individual subscriptions
                        </label>`);
    }
    if (caps.breakdownBy) {
        const by = widget.budget_breakdown_by === 'destination' || widget.budget_breakdown_by === 'main_category'
            ? widget.budget_breakdown_by : 'category';
        dataControls.push(`
                        <label data-opt="breakdownBy">Break down by:
                            <select id="${id}-budget-breakdown-by">
                                <option value="category" ${sel(by === 'category')}>Full categories</option>
                                <option value="main_category" ${sel(by === 'main_category')}>Main categories</option>
                                <option value="destination" ${sel(by === 'destination')}>Destination accounts</option>
                            </select>
                        </label>`);
    }
    if (caps.groupBy) {
        dataControls.push(`
                        <label data-opt="groupBy">Group by:
                            <select id="${id}-graph-mode">
                                <option value="subcategory" ${sel(widget.category_graph_mode !== 'parent')}>Subcategories</option>
                                <option value="parent" ${sel(widget.category_graph_mode === 'parent')}>Main categories</option>
                            </select>
                        </label>`);
    }
    if (caps.includeUnlabeled) {
        dataControls.push(`
                        <label class="checkbox-label" data-opt="includeUnlabeled" title="Also chart budgeted spend that matches no label as an 'Unlabeled' series"><input type="checkbox" id="${id}-include-unlabeled" ${chk(widget.include_unlabeled !== false)}> Include unlabeled</label>`);
    }
    if (caps.sankeyFlow) {
        const flow = widget.sankey_flow_type || 'destination';
        dataControls.push(`
                        <label data-opt="sankeyFlow">Flow type:
                            <select id="${id}-sankey-flow-type">
                                <option value="destination" ${sel(flow === 'destination')}>By destination account</option>
                                <option value="category" ${sel(flow === 'category')}>By category</option>
                                <option value="subcategory" ${sel(flow === 'subcategory')}>By subcategory</option>
                                <option value="budget" ${sel(flow === 'budget')}>By budget</option>
                            </select>
                        </label>`);
    }

    const dateSection = caps.dateRange ? `
                    <div class="widget-settings-section" data-section="date-range">
                        <strong>Date range</strong>
                        <div class="widget-date-range-source">
                            <label>
                                <input type="radio" name="${id}-date-source" value="dashboard" ${chk(widget.date_range_source === 'dashboard')}>
                                Use dashboard range
                            </label>
                            <label>
                                <input type="radio" name="${id}-date-source" value="custom" ${chk(widget.date_range_source !== 'dashboard')}>
                                Custom
                            </label>
                        </div>
                        <label>Preset:
                            <select id="${id}-time-range">
                                <option value="__fixed__">Fixed dates</option>
                                <option value="__none__">Custom (last N)</option>
                            </select>
                        </label>
                        <button id="${id}-apply-time-range">Apply</button>
                        <div id="${id}-custom-range" style="display: none;">
                            <label>Last
                                <input type="number" id="${id}-custom-count" value="1" min="1" max="999" style="width:60px">
                                <select id="${id}-custom-unit">
                                    <option value="days">days</option>
                                    <option value="weeks">weeks</option>
                                    <option value="months" selected>months</option>
                                    <option value="years">years</option>
                                </select>
                            </label>
                            <button id="${id}-apply-custom-range">Apply</button>
                        </div>
                        <label>
                            <input type="checkbox" id="${id}-round-end"> Round end date to month boundary
                            <select id="${id}-round-end-mode" style="display: none;">
                                <option value="start_of_current_month">Start of current month</option>
                                <option value="end_of_current_month" selected>End of current month</option>
                                <option value="start_of_next_month">Start of next month</option>
                            </select>
                        </label>
                        <label>Start: <input type="date" id="${id}-start" value="${startDate}"></label>
                        <label>End: <input type="date" id="${id}-end" value="${endDate}"></label>
                        ${caps.interval ? `
                        <label data-opt="interval">Interval:
                            <select id="${id}-interval">
                                <option value="auto" ${sel(interval === 'auto')}>Auto</option>
                                <option value="1D" ${sel(interval === '1D')}>Day</option>
                                <option value="1W" ${sel(interval === '1W')}>Week</option>
                                <option value="1M" ${sel(interval === '1M')}>Month</option>
                                <option value="1Q" ${sel(interval === '1Q')}>Quarter</option>
                                <option value="1Y" ${sel(interval === '1Y')}>Year</option>
                            </select>
                        </label>` : ''}
                    </div>` : '';

    const display = [];
    if (caps.layout) {
        display.push(`
                        <label data-opt="layout">Layout:
                            <select id="${id}-chart-mode">
                                <option value="combined" ${sel((widget.chart_mode || 'combined') === 'combined')}>Combined</option>
                                <option value="split" ${sel(widget.chart_mode === 'split')}>Split</option>
                            </select>
                        </label>`);
    }
    if (caps.chartType) {
        display.push(`
                        <label data-opt="chartType">Style:
                            <select id="${id}-chart-type">
                                <option value="line" ${sel(widget.chart_type !== 'pie')}>Line</option>
                                <option value="pie" ${sel(widget.chart_type === 'pie')}>Pie</option>
                            </select>
                        </label>`);
    }
    if (caps.variant) {
        const variant = widget.earned_chart_type || 'bars';
        display.push(`
                        <label data-opt="variant">Variant:
                            <select id="${id}-earned-chart-type">
                                <option value="bars" ${sel(variant === 'bars')}>Earned vs Spent</option>
                                <option value="delta_line" ${sel(variant === 'delta_line')}>Delta Line</option>
                                <option value="delta_bar" ${sel(variant === 'delta_bar')}>Delta Bar</option>
                            </select>
                        </label>`);
    }
    if (caps.stacked) {
        display.push(`
                        <label class="checkbox-label" data-opt="stacked" title="Stack series values vertically (line charts only; per-series trend lines stay unstacked)"><input type="checkbox" id="${id}-stacked" ${chk(chartOpts.stacked)}> Stacked</label>`);
    }
    if (caps.pct) {
        display.push(`
                        <label class="checkbox-label" data-opt="pct"><input type="checkbox" id="${id}-show-pct" ${chk(chartOpts.showPct)}> Show % change</label>
                        <label data-opt="pct" data-requires="${id}-show-pct">Mode:
                            <select id="${id}-pct-mode">
                                <option value="from_previous" ${sel(chartOpts.pctMode === 'from_previous')}>From previous</option>
                                <option value="from_first" ${sel(chartOpts.pctMode === 'from_first')}>From first point</option>
                            </select>
                        </label>`);
    }
    if (caps.comparison) {
        display.push(`
                        <label class="checkbox-label" data-opt="comparison"><input type="checkbox" id="${id}-enable-comparison" ${chk(chartOpts.enableComparison)}> Compare with previous period</label>
                        <div id="${id}-comparison-dates" data-opt="comparison" data-requires="${id}-enable-comparison">
                            <label>Comparison start: <input type="date" id="${id}-comparison-start" value="${chartOpts.comparisonStartDate || ''}"></label>
                            <label>Comparison end: <input type="date" id="${id}-comparison-end" value="${chartOpts.comparisonEndDate || ''}"></label>
                        </div>`);
    }
    if (caps.lineStyle) {
        display.push(`
                        <label class="checkbox-label" data-opt="lineStyle"><input type="checkbox" id="${id}-show-points" ${chk(chartOpts.showPoints)}> Show points</label>
                        <label class="checkbox-label" data-opt="lineStyle"><input type="checkbox" id="${id}-fill-area" ${chk(chartOpts.fillArea)}> Fill area</label>`);
    }
    if (caps.grid) {
        display.push(`
                        <label class="checkbox-label" data-opt="grid"><input type="checkbox" id="${id}-show-grid" ${chk(chartOpts.showGrid)}> Show grid lines</label>`);
    }
    if (caps.beginAtZero) {
        display.push(`
                        <label class="checkbox-label" data-opt="beginAtZero"><input type="checkbox" id="${id}-begin-zero" ${chk(chartOpts.beginAtZero)}> Y-axis from zero</label>`);
    }
    if (caps.ticks) {
        display.push(`
                        <label data-opt="ticks">X-axis ticks: <input type="number" id="${id}-x-limit" value="${chartOpts.xAxisLimit}" min="1" max="20" style="width: 60px;"></label>
                        <label data-opt="ticks">Y-axis ticks: <input type="number" id="${id}-y-limit" value="${chartOpts.yAxisLimit}" min="1" max="10" style="width: 60px;"></label>`);
    }
    if (caps.lineStyle) {
        display.push(`
                        <label data-opt="lineStyle">Line smoothness: <input type="range" id="${id}-tension" value="${chartOpts.tension}" min="0" max="1" step="0.1" style="width: 100px;"></label>`);
    }
    if (caps.forecast) {
        display.push(`
                        <label class="checkbox-label" data-opt="forecast"><input type="checkbox" id="${id}-enable-forecast" ${chk(chartOpts.enableForecast)}> Forecast trend</label>
                        <label data-opt="forecast">Days: <input type="number" id="${id}-forecast-days" value="${chartOpts.forecastDays}" min="1" max="365" style="width: 60px;"></label>`);
    }
    if (caps.trendline) {
        display.push(`
                        <label class="checkbox-label" data-opt="trendline"><input type="checkbox" id="${id}-enable-trendline" ${chk(chartOpts.showTrendline)}> Trend line (moving average)</label>
                        <label data-opt="trendline">Window (points): <input type="number" id="${id}-trendline-window" value="${chartOpts.trendlineWindow}" min="1" max="90" style="width: 60px;"></label>`);
    }

    return `
                <div class="widget-settings" id="${id}-settings" style="display: none;">
                    ${dataControls.length ? `
                    <div class="widget-settings-section" data-section="data">
                        <strong>Data</strong>
                        ${dataControls.join('')}
                    </div>` : ''}
                    ${dateSection}
                    ${display.length ? `
                    <div class="widget-settings-section" data-section="display">
                        <strong>Display</strong>
                        ${display.join('')}
                    </div>` : ''}
                    ${caps.exclusions ? `
                    <div class="widget-settings-section" data-section="exclusions">
                        <strong>Exclusions</strong>
                        <div class="exclusions-hint">Entirely removed from this widget's data, in addition to dashboard-level exclusions.</div>
                        <label>Exclude categories:
                            <select multiple size="5" id="${id}-exclude-categories" class="exclusion-select">
                                ${exclusionOptions.categories.map(c => `<option value="${escapeHtml(c)}" ${sel((widget.exclude_categories || []).includes(c))}>${escapeHtml(c)}</option>`).join('')}
                            </select>
                        </label>
                        <label>Exclude budgets:
                            <select multiple size="5" id="${id}-exclude-budgets" class="exclusion-select">
                                ${exclusionOptions.budgets.map(b => `<option value="${escapeHtml(b)}" ${sel((widget.exclude_budgets || []).includes(b))}>${escapeHtml(b)}</option>`).join('')}
                            </select>
                        </label>
                    </div>` : ''}
                    <div class="widget-settings-section" data-section="width">
                        <strong>Width</strong>
                        <label>
                            <select id="${id}-width" style="width: 120px;">
                                <option value="12" ${sel(widget.width === undefined || widget.width === 12)}>Full (12)</option>
                                <option value="6" ${sel(widget.width === 6)}>Half (6)</option>
                                <option value="4" ${sel(widget.width === 4)}>Third (4)</option>
                                <option value="3" ${sel(widget.width === 3)}>Quarter (3)</option>
                                <option value="2" ${sel(widget.width === 2)}>Half third (2)</option>
                                <option value="1" ${sel(widget.width === 1)}>Narrow (1)</option>
                            </select>
                        </label>
                    </div>
                    <div class="widget-settings-section" data-section="dashboards">
                        <strong>Assign to dashboards</strong>
                        ${buildDashboardCheckboxes(widget)}
                        <button class="widget-dash-save-btn" onclick="saveWidgetDashboardAssignment('${id}')">Save assignment</button>
                    </div>
                    <button id="${id}-update-btn" onclick="updateWidgetDateRange('${id}')">Update</button>
                </div>`;
}

// Current line/pie, layout and variant picked in a widget's settings panel
function widgetSettingsState(widgetId) {
    const val = (suffix, fallback) => document.getElementById(`${widgetId}-${suffix}`)?.value || fallback;
    return {
        chartType: val('chart-type', 'line'),
        chartMode: val('chart-mode', 'combined'),
        variant: val('earned-chart-type', 'bars')
    };
}

// Show only the settings that apply to the current selection (e.g. no
// line options for a pie, no stacking for a combined balance line), and
// dependent inputs (% mode, comparison dates) only while enabled.
function updateWidgetSettingsVisibility(widgetId, widgetType) {
    const panel = document.getElementById(`${widgetId}-settings`);
    if (!panel) return;
    const support = OxiUI.widgetOptionSupport(widgetType, widgetSettingsState(widgetId));
    panel.querySelectorAll('[data-opt]').forEach(el => {
        let visible = !!support[el.dataset.opt];
        const requires = el.dataset.requires && document.getElementById(el.dataset.requires);
        if (requires && !requires.checked) visible = false;
        el.style.display = visible ? '' : 'none';
    });
}

// Wire the controls that change which settings apply
function wireWidgetSettingsVisibility(widgetId, widgetType) {
    ['chart-type', 'chart-mode', 'earned-chart-type', 'show-pct', 'enable-comparison'].forEach(suffix => {
        document.getElementById(`${widgetId}-${suffix}`)
            ?.addEventListener('change', () => updateWidgetSettingsVisibility(widgetId, widgetType));
    });
    // Like the Graph Builder: enabling the comparison pre-fills the period
    // right before the widget's range when no comparison dates are set
    const comparisonEl = document.getElementById(`${widgetId}-enable-comparison`);
    comparisonEl?.addEventListener('change', () => {
        const startEl = document.getElementById(`${widgetId}-comparison-start`);
        const endEl = document.getElementById(`${widgetId}-comparison-end`);
        if (!comparisonEl.checked || !startEl || !endEl || startEl.value || endEl.value) return;
        const previous = calculatePreviousPeriod(startInputValue(widgetId), endInputValue(widgetId));
        if (previous) {
            startEl.value = previous.start;
            endEl.value = previous.end;
        }
    });
    updateWidgetSettingsVisibility(widgetId, widgetType);
}

// Preset key (e.g. '30d') whose relative range equals start/end, else '__fixed__'
function matchingTimeRangePreset(timeRanges, start, end) {
    if (!start || !end) return '__fixed__';
    const match = (timeRanges || []).find(key => {
        const dates = resolveRelativeRange(key);
        return dates && dates.start === start && dates.end === end;
    });
    return match || '__fixed__';
}

function startInputValue(widgetId) {
    return document.getElementById(`${widgetId}-start`)?.value || '';
}

function endInputValue(widgetId) {
    return document.getElementById(`${widgetId}-end`)?.value || '';
}

// ── Widget cards ─────────────────────────────────────────────────────

// Lists the settings panels are built from (accounts, groups, exclusion /
// category / budget options, subscriptions); kept so a single card can be
// rebuilt after an update or a type change.
let widgetSettingsContext = { allAccounts: [], allGroups: [] };

// Widget types in the order of the Graph Builder's type list
const WIDGET_TYPE_LABELS = {
    balance: 'Balance',
    earned_spent: 'Earned vs Spent',
    expenses_by_category: 'Expenses by Category',
    net_worth: 'Net Worth',
    budget_spent: 'Budget Spent',
    category_subcat: 'Category Subcategories',
    card_paydown: 'Card Paydown',
    saved_this_month: 'Saved This Month',
    label_spend: 'Spending by Label',
    subscription_cost: 'Subscription Cost',
    budget_breakdown: 'Budget Breakdown',
    sankey: 'Sankey Flow'
};

function widgetTypeBadgeHtml(widget) {
    const widgetType = widget.widget_type || 'balance';
    const badge = (cls, text) => `<span class="widget-type-badge ${cls}">${escapeHtml(text)}</span>`;
    switch (widgetType) {
        case 'earned_spent': return badge('earned-spent', 'Earned vs Spent');
        case 'budget_spent': return badge('budget-spent', 'Budget Spent');
        case 'expenses_by_category':
            return badge('category-subcat', widget.category_graph_mode === 'parent' ? 'Main Categories' : 'Category Expenses');
        case 'category_subcat':
            return badge('category-subcat', widget.category_graph_mode === 'parent' ? 'Main Categories' : 'Category Subcategories');
        case 'sankey': return badge('sankey', 'Sankey Flow');
        case 'card_paydown': return badge('card-paydown', 'Card Paydown');
        case 'net_worth': return badge('net-worth', 'Net Worth');
        case 'saved_this_month': return badge('saved', 'Saved This Month');
        case 'label_spend': return badge('label-spend', 'Spending by Label');
        case 'subscription_cost': return badge('subscription-cost', 'Subscription Cost');
        case 'budget_breakdown': {
            const mode = widget.budget_breakdown_by === 'destination' ? 'Destinations'
                : widget.budget_breakdown_by === 'main_category' ? 'Main Categories' : 'Categories';
            return badge('budget-breakdown', `Budget: ${mode}`);
        }
        default: return badge('balance', 'Balance');
    }
}

// Tags and badges under a widget's chart (accounts, budgets, type, layout,
// dashboards)
function buildWidgetInfoHtml(widget, context) {
    const { allAccounts = [], allGroups = [] } = context || {};
    const widgetType = widget.widget_type || 'balance';
    const widgetGroups = (widget.group_ids || []).map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
    const individualAccounts = (widget.accounts || [])
        .map(id => allAccounts.find(a => a.id === id))
        .filter(Boolean);
    const tag = (text, extra = '') => `<span class="widget-account-tag${extra}">${escapeHtml(text)}</span>`;
    const accountTags = [
        ...widgetGroups.map(g => tag(g.name)),
        ...individualAccounts.map(a => tag(a.name)),
        ...(widget.budget_names || []).map(b => tag(b, ' budget-tag'))
    ].join('');
    const dashBadges = (widget.dashboard_ids || []).map(did => {
        const d = dashboardsCache.find(dd => dd.id === did);
        return d ? `<span class="widget-dash-badge ${did === currentDashboardId ? 'active' : ''}">${escapeHtml(d.name)}</span>` : '';
    }).join('');
    return `
                        ${widgetType === 'balance' ? `<div class="widget-accounts">${accountTags}</div>` : ''}
                        <div class="widget-mode">
                            ${widgetTypeBadgeHtml(widget)}
                            ${widgetType === 'balance' ? `<span class="widget-mode-badge">${escapeHtml(widget.chart_mode || 'combined')}</span>` : ''}
                            ${dashBadges ? `<div class="widget-dash-badges">${dashBadges}</div>` : ''}
                        </div>`;
}

function buildWidgetCardHtml(widget, context) {
    const widgetType = widget.widget_type || 'balance';
    const dates = widgetEffectiveDates(widget, dashboardDates);
    return `
            <div class="widget" data-widget-id="${widget.id}" data-cols="${widget.width || 12}">
                <div class="widget-header">
                    <span class="widget-title">${escapeHtml(widget.name)}</span>
                    <div class="widget-actions">
                        <button class="refresh-btn" onclick="refreshWidget('${widget.id}')">⟳ Refresh</button>
                        <button class="settings-toggle" onclick="toggleWidgetSettings('${widget.id}')">▼ Settings</button>
                        <button onclick="deleteWidget('${widget.id}')">Delete</button>
                    </div>
                </div>
                ${buildWidgetSettingsHtml(widget, Object.assign({}, context, { startDate: dates.start || '', endDate: dates.end || '' }))}
                <div class="widget-body">
                    <div id="${widget.id}-error" class="widget-error"></div>
                    <div class="widget-chart" data-grid="${getChartOptions(widget).showGrid ? 'on' : 'off'}" style="height: ${widget.chart_height || 300}px;">
                        <canvas id="${widget.id}" ${widgetType === 'sankey' ? 'style="display:none"' : ''}></canvas>
                        <div id="${widget.id}-sankey" ${widgetType === 'sankey' ? '' : 'style="display:none"'}></div>
                        <div class="widget-chart-resize-handle"></div>
                    </div>
                    <div class="chart-legend" id="${widget.id}-legend" style="display: none;">
                        <div class="legend-container" id="${widget.id}-legend-items"></div>
                    </div>
                    <div class="widget-info">${buildWidgetInfoHtml(widget, context)}
                    </div>
                </div>
            </div>
        `;
}

// Load the option lists a widget type's settings need but the dashboard
// did not (it only fetches subscriptions when it has such a widget)
async function ensureWidgetSettingsContext(widgetType) {
    const ctx = widgetSettingsContext;
    if (!ctx.exclusionOptions) ctx.exclusionOptions = await getExclusionOptions();
    if (widgetType === 'subscription_cost' && !(ctx.subscriptionOptions?.subscriptions || []).length) {
        ctx.subscriptionOptions = await getSubscriptionOptions();
    }
    return ctx;
}

// Rebuild one widget's settings panel (after an update, or to show the
// controls of another widget type) and wire it
function rebuildWidgetSettingsPanel(widget, keepOpen) {
    const panel = document.getElementById(`${widget.id}-settings`);
    if (!panel) return;
    const dates = widgetEffectiveDates(widget, dashboardDates);
    const holder = document.createElement('div');
    holder.innerHTML = buildWidgetSettingsHtml(widget, Object.assign({}, widgetSettingsContext, {
        startDate: dates.start || '', endDate: dates.end || ''
    }));
    const fresh = holder.firstElementChild;
    if (keepOpen) fresh.style.display = 'flex';
    panel.replaceWith(fresh);
    wireWidgetSettings(widget, widgetSettingsContext);
}

// After a successful update: refresh the card's header tags, badges and
// settings panel so they match what was saved (no page reload needed)
function refreshWidgetCard(widget) {
    const card = document.querySelector(`.widget[data-widget-id="${widget.id}"]`);
    if (!card) return;
    const info = card.querySelector('.widget-info');
    if (info) info.innerHTML = buildWidgetInfoHtml(widget, widgetSettingsContext);
    const sankey = (widget.widget_type || 'balance') === 'sankey';
    if (sankey && widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
        delete widgetCharts[widget.id];
    }
    const canvas = document.getElementById(widget.id);
    if (canvas) canvas.style.display = sankey ? 'none' : '';
    const sankeyDiv = document.getElementById(`${widget.id}-sankey`);
    if (sankeyDiv) {
        sankeyDiv.style.display = sankey ? '' : 'none';
        if (!sankey) sankeyDiv.innerHTML = '';
    }
    rebuildWidgetSettingsPanel(widget, false);
}

// Switch the settings panel to another widget type: keep what was
// entered, show that type's controls; saved on "Update"
async function changeWidgetSettingsType(widgetId, newType) {
    const cached = widgetsCache.find(w => w.id === widgetId);
    if (!cached) return;
    const draft = readWidgetSettings(widgetId, JSON.parse(JSON.stringify(cached)));
    draft.widget_type = newType;
    await ensureWidgetSettingsContext(newType);
    rebuildWidgetSettingsPanel(draft, true);
}

// Wire everything inside one widget's settings panel
function wireWidgetSettings(widget, context) {
    const id = widget.id;
    const widgetType = widget.widget_type || 'balance';
    wireWidgetSettingsVisibility(id, widgetType);

    // % change previews live; like every other setting it is saved on "Update"
    const showPctCheckbox = document.getElementById(`${id}-show-pct`);
    const pctModeSelect = document.getElementById(`${id}-pct-mode`);
    const previewPct = () => {
        const chart = widgetCharts[id];
        if (!chart) return;
        chart.__pctOpts = { enabled: !!showPctCheckbox?.checked, mode: pctModeSelect?.value || 'from_previous' };
        chart.update();
    };
    showPctCheckbox?.addEventListener('change', previewPct);
    pctModeSelect?.addEventListener('change', previewPct);

    document.getElementById(`${id}-widget-type`)?.addEventListener('change', (e) => {
        changeWidgetSettingsType(id, e.target.value);
    });

    const widthSelect = document.getElementById(`${id}-width`);
    widthSelect?.addEventListener('change', async () => {
        const cols = parseInt(widthSelect.value, 10);
        const widgetCard = document.querySelector(`.widget[data-widget-id="${id}"]`);
        if (widgetCard) widgetCard.setAttribute('data-cols', String(cols));
        const w = widgetsCache.find(w => w.id === id);
        if (!w) return;
        w.width = cols;
        w.updated_at = new Date().toISOString();
        try {
            const response = await fetch(`/api/widgets/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(w)
            });
            if (!response.ok) console.error('Failed to save widget width:', await response.text());
        } catch (e) {
            console.error('Failed to save widget width:', e);
        }
    });

    wireWidgetDateRangeControls(widget);
}

// Readable preset label: '30d' -> '30 Days', 'ytd' -> 'YTD'
function timeRangeLabel(key) {
    const match = key.match(/^(\d+)([dmwy])$/);
    if (!match) return key.toUpperCase();
    const unitLabels = { d: 'Days', w: 'Weeks', m: 'Months', y: 'Years' };
    return `${match[1]} ${unitLabels[match[2]]}`;
}

// Date range controls of one widget's settings. A preset or "Custom (last
// N)" makes the widget follow that relative range (stored as
// relative_range, worked out at render time); typing a date, or "Fixed
// dates", pins the dates. The chosen range lives in the preset select's
// data-relative-range until "Update" saves it.
function wireWidgetDateRangeControls(widget) {
    const id = widget.id;
    const el = (suffix) => document.getElementById(`${id}-${suffix}`);
    const select = el('time-range');
    // Widgets without a date range (Saved This Month tile) have no controls
    if (!select) return;
    const applyBtn = el('apply-time-range');
    const customDiv = el('custom-range');
    const customCount = el('custom-count');
    const customUnit = el('custom-unit');
    const applyCustomBtn = el('apply-custom-range');
    const roundEndCheckbox = el('round-end');
    const roundEndMode = el('round-end-mode');
    const startInput = el('start');
    const endInput = el('end');
    const timeRanges = CONFIG.timeRanges || ['7d', '30d', '3m', '6m', '1y', 'ytd'];

    const addPreset = (key) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = timeRangeLabel(key);
        select.appendChild(option);
    };
    timeRanges.forEach(addPreset);

    const setRelative = (range) => {
        if (range) select.dataset.relativeRange = range;
        else delete select.dataset.relativeRange;
    };
    const showControls = (value) => {
        if (customDiv) customDiv.style.display = value === '__none__' ? 'block' : 'none';
        if (applyBtn) applyBtn.style.display = value === '__none__' || value === '__fixed__' ? 'none' : '';
    };
    const roundMode = () => (roundEndCheckbox && roundEndCheckbox.checked ? roundEndMode.value : null);
    const applyRange = (range) => {
        const dates = resolveRelativeRange(range, roundMode());
        if (!dates) return;
        startInput.value = dates.start;
        endInput.value = dates.end;
        setRelative(range);
    };

    // Initial state from the saved widget
    if (roundEndCheckbox) {
        roundEndCheckbox.checked = !!widget.round_end_mode;
        roundEndMode.value = widget.round_end_mode || 'end_of_current_month';
        roundEndMode.style.display = roundEndCheckbox.checked ? 'inline-block' : 'none';
    }
    const inherit = (widget.date_range_source || 'custom') === 'dashboard';
    const parsed = parseRelativeRange(widget.relative_range);
    if (parsed && parsed.kind === 'preset') {
        if (!timeRanges.includes(parsed.key)) addPreset(parsed.key);
        select.value = parsed.key;
        setRelative(parsed.key);
    } else if (parsed) {
        select.value = '__none__';
        customCount.value = String(parsed.count);
        customUnit.value = parsed.unit;
        setRelative(widget.relative_range);
    } else {
        // Older widgets only have fixed dates: a range that is exactly a
        // preset today was almost certainly picked as that preset
        const match = inherit ? '__fixed__'
            : matchingTimeRangePreset(timeRanges, startInput.value, endInput.value);
        select.value = match;
        if (match !== '__fixed__') setRelative(match);
    }
    showControls(select.value);

    select.addEventListener('change', () => {
        const value = select.value;
        showControls(value);
        if (value === '__fixed__') setRelative(null);
        else if (value !== '__none__') applyRange(value);
    });
    applyBtn?.addEventListener('click', () => applyRange(select.value));
    applyCustomBtn?.addEventListener('click', () => {
        applyRange(customRelativeRangeKey(parseInt(customCount.value, 10) || 1, customUnit.value));
    });
    const reapply = () => {
        if (select.dataset.relativeRange) applyRange(select.dataset.relativeRange);
    };
    roundEndCheckbox?.addEventListener('change', () => {
        roundEndMode.style.display = roundEndCheckbox.checked ? 'inline-block' : 'none';
        reapply();
    });
    roundEndMode?.addEventListener('change', reapply);
    [startInput, endInput].forEach(input => input?.addEventListener('change', () => {
        setRelative(null);
        select.value = '__fixed__';
        showControls('__fixed__');
    }));

    // With the dashboard range the widget's own range controls are inert
    const dateSourceRadios = document.querySelectorAll(`input[name="${id}-date-source"]`);
    function updateDateInputsForSource(source) {
        const inheritNow = source === 'dashboard';
        if (inheritNow) {
            startInput.value = dashboardDates.start || '';
            endInput.value = dashboardDates.end || '';
        } else {
            const own = resolveRelativeRange(select.dataset.relativeRange, roundMode()) ||
                { start: widget.start_date || '', end: widget.end_date || '' };
            startInput.value = own.start || '';
            endInput.value = own.end || '';
        }
        [startInput, endInput, select, applyBtn, customCount, customUnit,
            applyCustomBtn, roundEndCheckbox, roundEndMode].forEach(input => {
            if (input) input.disabled = inheritNow;
        });
    }
    if (inherit) updateDateInputsForSource('dashboard');
    dateSourceRadios.forEach(radio => {
        radio.addEventListener('change', () => updateDateInputsForSource(radio.value));
    });
}

async function renderDashboard() {
    const container = document.getElementById('dashboard-container');
    const widgets = await getWidgetsForDashboard(currentDashboardId);

    if (widgets.length === 0) {
        const dashName = dashboardsCache.find(d => d.id === currentDashboardId)?.name || 'this dashboard';
        container.innerHTML = `
            <div class="empty-dashboard">
                <h3>No widgets on ${escapeHtml(dashName)}</h3>
                <p>Go to the <a href="/">Widget Builder</a> to create your first widget, then assign it to this dashboard in widget settings.</p>
            </div>
        `;
        // Update widget count
        const countEl = document.getElementById('dashboard-widget-count');
        if (countEl) countEl.textContent = '';
        return;
    }

    widgetsCache = widgets;

    // Update widget count badge
    const countEl = document.getElementById('dashboard-widget-count');
    if (countEl) countEl.textContent = `${widgets.length} widget${widgets.length !== 1 ? 's' : ''}`;

    // Fetch all accounts and groups
    const allAccounts = await fetchAccounts();
    const allGroups = await fetchDashboardGroups();
    const exclusionOptions = await getExclusionOptions();

    // Subscription picker data, only when this dashboard has a
    // subscription_cost widget (both lists are backend-cached)
    const hasSubscriptionWidget = widgets.some(w => (w.widget_type || 'balance') === 'subscription_cost');
    const subscriptionOptions = hasSubscriptionWidget
        ? await getSubscriptionOptions()
        : { subscriptions: [], groups: [] };

    // Normalize chart_options on all widgets (handles old widgets without pct fields)
    widgets.forEach(widget => {
        if (widget.chart_options) {
            widget.chart_options = normalizeChartOptions(widget.chart_options);
        }
    });

    const context = { allAccounts, allGroups, exclusionOptions, subscriptionOptions };
    widgetSettingsContext = context;
    container.innerHTML = '<div class="dashboard-grid">' +
        widgets.map(widget => buildWidgetCardHtml(widget, context)).join('') +
        '</div>';

    // Render charts for each widget
    for (const widget of widgets) {
        await renderWidgetChart(widget, widget.id, allAccounts, allGroups);
    }

    widgets.forEach(widget => wireWidgetSettings(widget, context));

    // Initialize SortableJS for drag-and-drop reordering (only if unlocked)
    dashboardGrid = document.querySelector('.dashboard-grid');
    if (dashboardGrid && !dashboardLocked && typeof Sortable !== 'undefined') {
        dashboardGrid._sortable = Sortable.create(dashboardGrid, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onEnd: function(evt) {
                const newOrder = [];
                dashboardGrid.querySelectorAll('.widget').forEach(el => {
                    const id = el.getAttribute('data-widget-id');
                    if (id) newOrder.push(id);
                });

                if (newOrder.length > 0) {
                    updateWidgetOrder(newOrder);
                }
            }
        });
    }

    // Initialize interact.js resize handles on chart containers
    if (typeof interact !== 'undefined') {
        widgets.forEach(widget => {
            const chartContainer = document.querySelector(`.widget[data-widget-id="${widget.id}"] .widget-chart`);
            if (!chartContainer) return;

            interact(chartContainer).resizable({
                edges: { bottom: true, left: false, right: false, top: false },
                listeners: {
                    move: function(event) {
                        const newHeight = Math.round(event.rect.height);
                        const clampedHeight = Math.max(150, Math.min(800, newHeight));
                        event.target.style.height = clampedHeight + 'px';
                        const canvas = chartContainer.querySelector('canvas');
                        if (canvas) {
                            canvas.style.height = clampedHeight + 'px';
                        }
                    }
                },
                modifiers: [
                    interact.modifiers.restrictSize({
                        min: { width: 0, height: 150 },
                        max: { width: 0, height: 800 }
                    })
                ],
                inertia: false,
                onend: function(event) {
                    const newHeight = Math.round(event.target.getBoundingClientRect().height);
                    const clampedHeight = Math.max(150, Math.min(800, newHeight));
                    event.target.style.height = clampedHeight + 'px';

                    // Resize the Chart.js instance to match new container height
                    if (widgetCharts[widget.id]) {
                        widgetCharts[widget.id].resize();
                    }

                    const w = widgetsCache.find(w => w.id === widget.id);
                    if (w) {
                        w.chart_height = clampedHeight;
                        w.updated_at = new Date().toISOString();
                        fetch(`/api/widgets/${widget.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(w)
                        }).catch(e => console.error('Failed to save chart height:', e));
                    }
                }
            });
        });
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Register percentage labels plugin
    if (typeof Chart !== 'undefined') {
        Chart.register(pctLabelPlugin);
    }

    // Theme init and toggle are handled by theme.js; avoid duplicate listeners.

    // Load dashboards and set up nav dropdown
    await loadDashboards();

    // Load and display dashboard date range
    await loadDashboardDates();
    populateDashboardDateInputs();

    // Dashboard date range Apply button
    const applyDateRangeBtn = document.getElementById('dashboard-apply-date-range');
    if (applyDateRangeBtn) {
        applyDateRangeBtn.addEventListener('click', applyDashboardDateRange);
    }

    // Dashboard exclusions modal
    const exclusionsToggle = document.getElementById('dashboard-exclusions-toggle');
    if (exclusionsToggle) {
        exclusionsToggle.addEventListener('click', openDashboardExclusionsModal);
    }
    document.getElementById('exclusions-modal-close')?.addEventListener('click', closeDashboardExclusionsModal);
    document.getElementById('exclusions-modal-cancel')?.addEventListener('click', closeDashboardExclusionsModal);
    document.getElementById('exclusions-modal-save')?.addEventListener('click', saveDashboardExclusions);
    document.getElementById('exclusions-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDashboardExclusionsModal();
    });

    // Set dashboard title
    const current = dashboardsCache.find(d => d.id === currentDashboardId);
    const titleEl = document.getElementById('dashboard-title');
    if (titleEl) titleEl.textContent = current ? current.name : 'Dashboard';

    // Nav dropdown toggle
    const navBtn = document.getElementById('nav-dashboard-btn');
    const navMenu = document.getElementById('nav-dropdown-menu');
    if (navBtn && navMenu) {
        navBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = navMenu.classList.toggle('open');
            navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!navMenu.contains(e.target) && e.target !== navBtn) {
                navMenu.classList.remove('open');
                navBtn.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && navMenu.classList.contains('open')) {
                navMenu.classList.remove('open');
                navBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // New dashboard button
    const newDashBtn = document.getElementById('nav-new-dashboard-btn');
    if (newDashBtn) newDashBtn.addEventListener('click', openNewDashboardModal);

    // Manage dashboards button
    const manageDashBtn = document.getElementById('nav-manage-dashboards-btn');
    if (manageDashBtn) manageDashBtn.addEventListener('click', openManageModal);

    // New dashboard modal events
    document.getElementById('new-dashboard-modal-close')?.addEventListener('click', closeNewDashboardModal);
    document.getElementById('new-dashboard-cancel')?.addEventListener('click', closeNewDashboardModal);
    document.getElementById('new-dashboard-create')?.addEventListener('click', createNewDashboard);
    document.getElementById('new-dashboard-name')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createNewDashboard();
    });

    // Manage modal close
    document.getElementById('manage-modal-close')?.addEventListener('click', closeManageModal);

    // Close modals on overlay click
    document.getElementById('new-dashboard-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeNewDashboardModal();
    });
    document.getElementById('manage-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeManageModal();
    });

    // Dashboard lock/unlock toggle
    const lockToggle = document.getElementById('dashboard-lock-toggle');
    if (lockToggle) {
        lockToggle.addEventListener('click', () => {
            dashboardLocked = !dashboardLocked;
            lockToggle.classList.toggle('locked', dashboardLocked);
            lockToggle.classList.toggle('unlocked', !dashboardLocked);
            lockToggle.title = dashboardLocked
                ? 'Unlock dashboard to reorder widgets'
                : 'Lock dashboard to prevent reordering';

            // Re-initialize SortableJS based on lock state
            if (dashboardGrid) {
                if (dashboardLocked && dashboardGrid._sortable) {
                    dashboardGrid._sortable.destroy();
                    dashboardGrid._sortable = null;
                } else if (!dashboardLocked && typeof Sortable !== 'undefined') {
                    if (dashboardGrid._sortable) {
                        dashboardGrid._sortable.destroy();
                    }
                    dashboardGrid._sortable = Sortable.create(dashboardGrid, {
                        animation: 150,
                        ghostClass: 'sortable-ghost',
                        chosenClass: 'sortable-chosen',
                        dragClass: 'sortable-drag',
                        onEnd: function(evt) {
                            const newOrder = [];
                            dashboardGrid.querySelectorAll('.widget').forEach(el => {
                                const id = el.getAttribute('data-widget-id');
                                if (id) newOrder.push(id);
                            });

                            if (newOrder.length > 0) {
                                updateWidgetOrder(newOrder);
                            }
                        }
                    });
                }
            }
        });
        // Start in locked state
        lockToggle.classList.add('locked');
    }

    renderDashboard();
});
