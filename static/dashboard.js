const DASHBOARD_WIDGETS_KEY = 'oxidize_dashboard_widgets';
const SAVED_LISTS_KEY = 'firefly_saved_account_lists';
let widgetCharts = {};
let widgetDatasetVisibility = {};
let widgetsCache = [];
let dashboardLocked = true;
let dashboardGrid = null;

// Parse a chart label that may be a date string or quarterly format like "2025-Q1"
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
    const labels = new Array(data.length).fill(null);

    for (let i = 1; i < data.length; i++) {
        const current = data[i];
        if (current === null || current === undefined || isNaN(current)) continue;

        if (mode === 'from_first') {
            const first = data[0];
            if (first === null || first === undefined || isNaN(first) || first === 0) {
                labels[i] = null;
            } else {
                labels[i] = ((current - first) / Math.abs(first)) * 100;
            }
        } else {
            const previous = data[i - 1];
            if (previous === null || previous === undefined || isNaN(previous) || previous === 0) {
                labels[i] = null;
            } else {
                labels[i] = ((current - previous) / Math.abs(previous)) * 100;
            }
        }
    }

    return labels;
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
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
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

    const { slope, intercept } = linearRegression(points);

    const lastDate = parseChartLabel(labels[labels.length - 1]);
    let periodDays = 1;
    if (labels.length >= 2) {
        const prevDate = parseChartLabel(labels[labels.length - 2]);
        const diffMs = lastDate - prevDate;
        periodDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }

    const forecastValues = [];
    const forecastLabels = [];

    for (let i = 1; i <= forecastDays; i++) {
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
async function persistPctSettings(widgetId, showPct, pctMode) {
    try {
        const widgets = await getDashboardWidgets();
        const w = widgets.find(w => w.id === widgetId);
        if (!w) return;
        w.chart_options = normalizeChartOptions(w.chart_options);
        w.chart_options[PCT_ENABLED_KEY] = showPct;
        w.chart_options[PCT_MODE_KEY] = pctMode;
        w.updated_at = new Date().toISOString();
        await fetch(`/api/widgets/${widgetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(w)
        });
    } catch (e) {
        console.error('Failed to persist % settings:', e);
    }
}

// Normalize chart_options to include pct defaults for old widgets
function normalizeChartOptions(opts) {
    if (!opts) return { show_pct: false, pct_mode: 'from_previous' };
    return {
        show_points: opts.show_points ?? false,
        x_axis_limit: opts.x_axis_limit ?? 6,
        y_axis_limit: opts.y_axis_limit ?? 4,
        fill_area: opts.fill_area ?? true,
        tension: opts.tension ?? 0.1,
        begin_at_zero: opts.begin_at_zero ?? false,
        show_pct: opts.show_pct ?? false,
        pct_mode: opts.pct_mode || 'from_previous',
        enable_forecast: opts.enable_forecast ?? false,
        forecast_days: opts.forecast_days ?? 30
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
        const textColor = isDark ? '#b0b0b0' : '#666';

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!dataset.data || dataset.hidden) return;

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

// Theme management
window.addEventListener("themeChanged", (e) => { updateWidgetChartsTheme(e.detail); });
function updateWidgetChartsTheme(theme) {
    const isDark = theme === 'dark';
    const textColor = isDark ? '#eaeaea' : '#333';
    const gridColor = isDark ? '#444' : '#ddd';

    Object.values(widgetCharts).forEach(chart => {
        if (chart && chart.options && chart.options.scales) {
            chart.options.scales.x.grid = { color: gridColor };
            chart.options.scales.x.ticks = { color: textColor };
            chart.options.scales.y.grid = { color: gridColor };
            chart.options.scales.y.ticks = { color: textColor };
            chart.update('none');
        }
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

async function deleteWidget(id) {
    if (!confirm('Delete this widget?')) return;

    // Destroy chart if exists
    if (widgetCharts[id]) {
        widgetCharts[id].destroy();
        delete widgetCharts[id];
    }

    try {
        await fetch(`/api/widgets/${id}`, { method: 'DELETE' });
        await renderDashboard();
    } catch (e) {
        console.error('Failed to delete widget:', e);
        alert(`Failed to delete widget: ${e.message}`);
    }
}

async function updateWidgetOrder(widgetIds) {
    const updates = widgetIds.map((id, index) => {
        const w = widgetsCache.find(w => w.id === id);
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
    widgetsCache = widgetsCache.sort((a, b) => a.display_order - b.display_order);
}

function toggleWidgetSettings(id) {
    const settingsEl = document.getElementById(`${id}-settings`);
    if (settingsEl.style.display === 'none' || settingsEl.style.display === '') {
        settingsEl.style.display = 'flex';
    } else {
        settingsEl.style.display = 'none';
    }
}

async function updateWidgetDateRange(widgetId) {
    const startDate = document.getElementById(`${widgetId}-start`).value;
    const endDate = document.getElementById(`${widgetId}-end`).value;
    const interval = document.getElementById(`${widgetId}-interval`).value;
    const chartModeEl = document.getElementById(`${widgetId}-chart-mode`);
    const chartMode = chartModeEl ? chartModeEl.value : undefined;

    const widgets = await getDashboardWidgets();
    const widgetIndex = widgets.findIndex(w => w.id === widgetId);

    if (widgetIndex === -1) return;

    const widget = widgets[widgetIndex];
    widget.start_date = startDate || null;
    widget.end_date = endDate || null;
    widget.interval = interval || null;
    if (chartMode !== undefined) widget.chart_mode = chartMode;
    widget.updated_at = new Date().toISOString();

    // Update chart options
    if (widget.chart_options === undefined) {
        widget.chart_options = {};
    }
    widget.chart_options.show_points = document.getElementById(`${widgetId}-show-points`).checked;
    widget.chart_options.x_axis_limit = parseInt(document.getElementById(`${widgetId}-x-limit`).value);
    widget.chart_options.y_axis_limit = parseInt(document.getElementById(`${widgetId}-y-limit`).value);
    widget.chart_options.fill_area = document.getElementById(`${widgetId}-fill-area`).checked;
    widget.chart_options.tension = parseFloat(document.getElementById(`${widgetId}-tension`).value);
    widget.chart_options.begin_at_zero = document.getElementById(`${widgetId}-begin-zero`).checked;
    widget.chart_options[PCT_ENABLED_KEY] = document.getElementById(`${widgetId}-show-pct`).checked;
    widget.chart_options[PCT_MODE_KEY] = document.getElementById(`${widgetId}-pct-mode`).value;
    const enableForecastEl = document.getElementById(`${widgetId}-enable-forecast`);
    const forecastDaysEl = document.getElementById(`${widgetId}-forecast-days`);
    if (enableForecastEl) widget.chart_options.enable_forecast = enableForecastEl.checked;
    if (forecastDaysEl) widget.chart_options.forecast_days = parseInt(forecastDaysEl.value, 10) || 30;

    const earnedChartTypeEl = document.getElementById(`${widgetId}-earned-chart-type`);
    if (earnedChartTypeEl) widget.earned_chart_type = earnedChartTypeEl.value;

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

        // Close settings panel
        document.getElementById(`${widgetId}-settings`).style.display = 'none';

        // Re-render the chart
        const allAccounts = await fetchAccounts();
        const allGroups = await fetchDashboardGroups();
        await renderWidgetChart(widget, widgetId, allAccounts, allGroups);
    } catch (e) {
        console.error('Failed to update widget:', e);
        alert(`Failed to update widget: ${e.message}`);
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
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        const hue = Math.round(i * hueStep);
        colors.push(`hsl(${hue}, 70%, 50%)`);
    }
    return colors;
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

    // Reset visibility to all datasets (select all) on each render
    widgetDatasetVisibility[widgetId] = {};
    accountInfo.forEach((_, index) => {
        widgetDatasetVisibility[widgetId][index] = true;
    });

    // Reset chart dataset visibility if chart exists
    if (widgetCharts[widgetId]) {
        widgetCharts[widgetId].data.datasets.forEach((ds) => {
            ds.hidden = false;
        });
        widgetCharts[widgetId].update();
    }

    // Add Select All / Deselect All buttons
    const controlRow = document.createElement('div');
    controlRow.className = 'legend-controls';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'legend-control-btn';
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAllDatasets(widgetId);
    });

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.className = 'legend-control-btn';
    deselectAllBtn.textContent = 'Deselect All';
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
        xAxisLimit: raw.x_axis_limit,
        yAxisLimit: raw.y_axis_limit,
        fillArea: raw.fill_area,
        tension: raw.tension,
        beginAtZero: raw.begin_at_zero,
        showPct: raw.show_pct,
        pctMode: raw.pct_mode,
        enableForecast: raw.enable_forecast,
        forecastDays: raw.forecast_days
    };
}

async function renderEarnedSpentChart(ctx, widget, labels, history, containerId, chartType = 'bars') {
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
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    // Find earned and spent datasets from history
    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels.length) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels.length) : new Array(labels.length).fill(0);

    // Earned is typically positive (income), spent is typically positive (expense)
    // We'll show earned in green and spent in red
    const earnedColor = isDark ? '#58d68d' : '#27ae60';
    const spentColor = isDark ? '#ec7063' : '#e74c3c';

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
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
            ]
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
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels.length) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels.length) : new Array(labels.length).fill(0);

    const deltaData = earnedData.map((earned, i) => earned - spentData[i]);

    const lineColor = isDark ? '#3498db' : '#2980b9';
    const pointColor = deltaData.map(v => v >= 0 ? '#27ae60' : '#e74c3c');

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Delta (Earned - Spent)',
                data: deltaData,
                borderColor: lineColor,
                backgroundColor: lineColor + '33',
                tension: 0.3,
                pointBackgroundColor: pointColor,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
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
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels.length) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels.length) : new Array(labels.length).fill(0);

    const deltaData = earnedData.map((earned, i) => earned - spentData[i]);

    const greenColor = isDark ? '#58d68d' : '#27ae60';
    const redColor = isDark ? '#ec7063' : '#e74c3c';

    if (widgetCharts[widget.id]) {
        widgetCharts[widget.id].destroy();
    }

    widgetCharts[widget.id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Delta (Earned - Spent)',
                data: deltaData,
                backgroundColor: deltaData.map(v => v >= 0 ? greenColor : redColor),
                borderColor: deltaData.map(v => v >= 0 ? greenColor : redColor),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
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

function extractChartData(entries, length) {
    if (Array.isArray(entries)) {
        return entries.map(e => parseFloat(e.value || 0));
    } else {
        return Object.values(entries).map(v => {
            if (typeof v === 'object' && v !== null) {
                return parseFloat(v.value || 0);
            }
            return parseFloat(v);
        });
    }
}

// Filter ChartLine datasets by budget names (matches by label)
function filterChartLineByNames(chartLine, budgetNames) {
    const nameSet = new Set(budgetNames);
    return chartLine.filter(ds => nameSet.has(ds.label));
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

        if (widgetType === 'earned_spent' && sinceDate) {
            // Incremental refresh: fetch partial chart from since date, merge into existing
            const params = new URLSearchParams();
            params.append('since', sinceDate);
            if (widget.end_date) params.append('end', widget.end_date);
            if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);
            allWidgetAccountIds.forEach(id => params.append('accounts[]', id));

            const response = await fetch(`/api/earned-spent/since?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }

            const partialChart = await response.json();

            // Merge partial chart entries into existing chart data
            let history;
            const chartInstance = Chart.getChart(widgetId);
            if (chartInstance) {
                // Use existing chart data as base, overlay partial chart entries
                history = mergePartialChartIntoExisting(chartInstance, partialChart);
            } else {
                // No existing chart, use partial data directly
                history = partialChart;
            }

            // Re-render with merged data
            const ctx = document.getElementById(widgetId).getContext('2d');
            const labels = extractChartLabels(history);
            const earnedChartType = widget.earned_chart_type || 'bars';
            await renderEarnedSpentChart(ctx, widget, labels, history, widgetId, earnedChartType);
        } else {
            // Balance widgets or no since date: full re-fetch
            await renderWidgetChart(widget, widgetId, allAccounts, allGroups);
        }
    } catch (e) {
        console.error('Failed to refresh widget:', e);
        alert(`Failed to refresh widget: ${e.message}`);
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

async function renderWidgetChart(widget, containerId, allAccounts, allGroups = []) {
    const ctx = document.getElementById(containerId).getContext('2d');

    try {
        // Determine widget type (default to "balance" for backwards compatibility)
        const widgetType = widget.widget_type || 'balance';

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
            if (widget.start_date) params.append('start', widget.start_date);
            if (widget.end_date) params.append('end', widget.end_date);
            if (widget.interval && widget.interval !== 'auto') params.append('period', widget.interval);

            const url = `/api/earned-spent?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            history = await response.json();
        } else if (widgetType === 'budget_spent') {
            // For budget spent, use the budget-spent endpoint
            const params = new URLSearchParams();
            if (widget.start_date) params.append('start', widget.start_date);
            if (widget.end_date) params.append('end', widget.end_date);

            const url = `/api/budgets/spent?${params.toString()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            history = await response.json();
        } else {
            // For balance widgets, fetch with all relevant accounts (individual + group members)
            const groupIds = widget.group_ids || [];
            const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
            const groupAccountIds = new Set();
            widgetGroups.forEach(g => g.account_ids.forEach(id => groupAccountIds.add(id)));
            const allWidgetAccountIds = [...new Set([...widget.accounts, ...groupAccountIds])];

            history = await fetchChartData(
                allWidgetAccountIds,
                widget.start_date,
                widget.end_date,
                widget.interval
            );
        }

        if (!history || history.length === 0) {
            document.getElementById(`${containerId}-error`).textContent = 'No data available';
            return;
        }

        // Extract labels
        let labels = [];
        const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
        if (firstDataset) {
            if (Array.isArray(firstDataset.entries)) {
                labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
            } else {
                labels = Object.keys(firstDataset.entries);
            }
        }

        // Handle earned vs spent widget type
        if (widgetType === 'earned_spent') {
            const earnedChartType = widget.earned_chart_type || 'bars';
            await renderEarnedSpentChart(ctx, widget, labels, history, containerId, earnedChartType);
            return;
        }

       // Handle budget_spent widget type - time series bar chart with dates on x-axis
        if (widgetType === 'budget_spent') {
            const budgetNames = widget.budget_names || [];
            let filteredHistory = history;
            if (budgetNames.length > 0) {
                filteredHistory = filterChartLineByNames(history, budgetNames);
            }

            if (!filteredHistory || filteredHistory.length === 0) {
                document.getElementById(`${containerId}-error`).textContent = 'No budget data available';
                return;
            }

            // Collect all unique dates across all budgets
            const allDates = new Set();
            filteredHistory.forEach(ds => {
                if (ds.entries && typeof ds.entries === 'object') {
                    Object.keys(ds.entries).forEach(k => allDates.add(k));
                }
            });
            const sortedDates = Array.from(allDates).sort();

            const opts = getChartOptions(widget);
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const chartTextColor = isDark ? '#eaeaea' : '#333';
            const chartGridColor = isDark ? '#444' : '#ddd';
            const hueStep = 360 / filteredHistory.length;

            const datasets = filteredHistory.map((ds, idx) => {
                const data = sortedDates.map(date => {
                    const raw = ds.entries?.[date];
                    let num = 0;
                    if (typeof raw === 'object' && raw !== null && raw.value !== undefined) {
                        num = parseFloat(raw.value);
                    } else {
                        num = parseFloat(raw);
                    }
                    return isNaN(num) ? null : Math.abs(num);
                });
                return {
                    label: ds.label,
                    data: data,
                    backgroundColor: `hsl(${Math.round(idx * hueStep)}, 70%, 50%)CC`,
                    borderColor: `hsl(${Math.round(idx * hueStep)}, 70%, 50%)`,
                    borderWidth: 1,
                    borderRadius: 4
                };
            });

            if (widgetCharts[widget.id]) {
                widgetCharts[widget.id].destroy();
            }

            widgetCharts[widget.id] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: sortedDates,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: filteredHistory.length > 1,
                            position: 'top',
                            labels: { color: chartTextColor }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    if (context.parsed.y === null) return '';
                                    return context.dataset.label + ': ' + context.parsed.y.toLocaleString();
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: opts.beginAtZero,
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
                                maxTicksLimit: 12,
                                autoSkip: true,
                                callback: function(value) {
                                    const label = this.getLabelForValue(value);
                                    if (!label) return '';
                                    const parts = label.split('-');
                                    if (parts.length === 3) {
                                        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                                        if (!isNaN(d.getTime())) return d.toLocaleDateString();
                                    }
                                    return label;
                                }
                            }
                        }
                    }
                }
            });
            return;
        }

        if (widget.chart_mode === 'combined') {
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
            const chartTextColor = isDark ? '#eaeaea' : '#333';
            const chartGridColor = isDark ? '#444' : '#ddd';
            const chartColor = isDark ? '#5dade2' : '#3498db';
            const forecastColor = isDark ? '#a0a0a0' : '#888';

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

            widgetCharts[widget.id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: combinedDatasets
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
                    }
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
            const chartTextColor = isDark ? '#eaeaea' : '#333';
            const chartGridColor = isDark ? '#444' : '#ddd';

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

            widgetCharts[widget.id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: splitLabels,
                    datasets: splitDatasets
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
                                        return context.dataset.label + ': ' + context.parsed.y.toLocaleString();
                                    }
                                    return '';
                                }
                            }
                        }
                    },
                    scales: {
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
                    }
                }
            });
            widgetCharts[widget.id].__pctOpts = { enabled: opts2.showPct, mode: opts2.pctMode };

            // Render the legend after chart is created
            renderSplitLegend(widget.id, legendInfo, datasets);
        }
    } catch (error) {
        console.error('Error rendering widget chart:', error);
        const errorDiv = document.getElementById(`${containerId}-error`);
        if (errorDiv) {
            errorDiv.textContent = 'Error loading data';
        }
    }
}

async function renderDashboard() {
    const container = document.getElementById('dashboard-container');
    const widgets = await getDashboardWidgets();

    if (widgets.length === 0) {
        container.innerHTML = `
            <div class="empty-dashboard">
                <h3>No Widgets Yet</h3>
                <p>Go to the <a href="/">Graph Builder</a> to create your first widget.</p>
            </div>
        `;
        return;
    }

    widgetsCache = widgets;

    // Fetch all accounts and groups
    const allAccounts = await fetchAccounts();
    const allGroups = await fetchDashboardGroups();

    // Normalize chart_options on all widgets (handles old widgets without pct fields)
    widgets.forEach(widget => {
        if (widget.chart_options) {
            widget.chart_options = normalizeChartOptions(widget.chart_options);
        }
    });

    let html = '<div class="dashboard-grid">';

    // Determine widget type (default to "balance" for backwards compatibility)

    widgets.forEach(widget => {
        const widgetType = widget.widget_type || 'balance';

        // Build account/group display info
        const groupIds = widget.group_ids || [];
        const widgetGroups = groupIds.map(gid => allGroups.find(g => g.id === gid)).filter(Boolean);
        const widgetGroupAccountIds = new Set();
        widgetGroups.forEach(g => g.account_ids.forEach(id => widgetGroupAccountIds.add(id)));

        const individualAccounts = widget.accounts
            .map(id => allAccounts.find(a => a.id === id))
            .filter(Boolean);

        const accountNames = [
            ...widgetGroups.map(g => g.name),
            ...individualAccounts.map(a => a.name)
        ].join(', ');

        const accountTags = [
            ...widgetGroups.map(g => `<span class="widget-account-tag">${g.name}</span>`),
            ...individualAccounts.map(a => `<span class="widget-account-tag">${a.name}</span>`),
            ...(widget.budget_names || []).map(b => `<span class="widget-account-tag budget-tag">${b}</span>`)
        ].join('');

        const startDate = widget.start_date || '';
        const endDate = widget.end_date || '';
        const interval = widget.interval || 'auto';

        // Get chart options with defaults
        const chartOpts = getChartOptions(widget);

        // Widget type badge
        let widgetTypeBadge;
        if (widgetType === 'earned_spent') {
            widgetTypeBadge = '<span class="widget-type-badge earned-spent">Earned vs Spent</span>';
        } else if (widgetType === 'budget_spent') {
            widgetTypeBadge = '<span class="widget-type-badge budget-spent">Budget Spent</span>';
        } else {
            widgetTypeBadge = '<span class="widget-type-badge balance">Balance</span>';
        }

        html += `
            <div class="widget" data-widget-id="${widget.id}" data-cols="${widget.width || 12}">
                <div class="widget-header">
                    <span class="widget-title">${widget.name}</span>
                    <div class="widget-actions">
                        <button class="refresh-btn" onclick="refreshWidget('${widget.id}')">⟳ Refresh</button>
                        <button class="settings-toggle" onclick="toggleWidgetSettings('${widget.id}')">▼ Settings</button>
                        <button onclick="deleteWidget('${widget.id}')">Delete</button>
                    </div>
                </div>
                <div class="widget-settings" id="${widget.id}-settings" style="display: none;">
                    <div class="widget-settings-section">
                        <strong>Date Range</strong>
                        <label>Time Range:
                            <select id="${widget.id}-time-range">
                                <option value="__none__">Custom</option>
                            </select>
                        </label>
                        <button id="${widget.id}-apply-time-range" style="margin-bottom: 0.5rem;">Apply</button>
                        <div id="${widget.id}-custom-range" style="display: none; margin-bottom: 0.5rem;">
                            <label>Last
                                <input type="number" id="${widget.id}-custom-count" value="1" min="1" max="999" style="width:60px">
                                <select id="${widget.id}-custom-unit">
                                    <option value="days">days</option>
                                    <option value="weeks">weeks</option>
                                    <option value="months" selected>months</option>
                                    <option value="years">years</option>
                                </select>
                            </label>
                            <button id="${widget.id}-apply-custom-range">Apply</button>
                        </div>
                        <label style="display: block; margin-bottom: 0.5rem;">
                            <input type="checkbox" id="${widget.id}-round-end"> Round end date to month boundary
                            <select id="${widget.id}-round-end-mode" style="display: none; margin-left: 0.5rem;">
                                <option value="start_of_current_month">Start of current month</option>
                                <option value="end_of_current_month" selected>End of current month</option>
                                <option value="start_of_next_month">Start of next month</option>
                            </select>
                        </label>
                        <label>Start: <input type="date" id="${widget.id}-start" value="${startDate}"></label>
                        <label>End: <input type="date" id="${widget.id}-end" value="${endDate}"></label>
                        <label>Interval:
                            <select id="${widget.id}-interval">
                                <option value="auto" ${interval === 'auto' ? 'selected' : ''}>Auto</option>
                                <option value="1D" ${interval === '1D' ? 'selected' : ''}>Day</option>
                                <option value="1W" ${interval === '1W' ? 'selected' : ''}>Week</option>
                                <option value="1M" ${interval === '1M' ? 'selected' : ''}>Month</option>
                                <option value="1Q" ${interval === '1Q' ? 'selected' : ''}>Quarter</option>
                                <option value="1Y" ${interval === '1Y' ? 'selected' : ''}>Year</option>
                            </select>
                        </label>
                        ${widgetType === 'balance' ? `
                        <label>Chart Mode:
                            <select id="${widget.id}-chart-mode">
                                <option value="combined" ${widget.chart_mode === 'combined' || !widget.chart_mode ? 'selected' : ''}>Combined</option>
                                <option value="split" ${widget.chart_mode === 'split' ? 'selected' : ''}>Split</option>
                            </select>
                        </label>
                        ` : ''}
                        ${widgetType === 'earned_spent' ? `
                        <label>Earned Chart Type:
                            <select id="${widget.id}-earned-chart-type">
                                <option value="bars" ${widget.earned_chart_type === 'bars' || !widget.earned_chart_type ? 'selected' : ''}>Earned vs Spent</option>
                                <option value="delta_line" ${widget.earned_chart_type === 'delta_line' ? 'selected' : ''}>Delta Line</option>
                                <option value="delta_bar" ${widget.earned_chart_type === 'delta_bar' ? 'selected' : ''}>Delta Bar</option>
                            </select>
                        </label>
                        ` : ''}
                    </div>
                    <div class="widget-settings-section">
                        <strong>Display Options</strong>
                        <label class="checkbox-label"><input type="checkbox" id="${widget.id}-show-points" ${chartOpts.showPoints ? 'checked' : ''}> Show Points</label>
                        <label class="checkbox-label"><input type="checkbox" id="${widget.id}-fill-area" ${chartOpts.fillArea ? 'checked' : ''}> Fill Area</label>
                        <label class="checkbox-label"><input type="checkbox" id="${widget.id}-begin-zero" ${chartOpts.beginAtZero ? 'checked' : ''}> Y-Axis from Zero</label>
                        <label class="checkbox-label"><input type="checkbox" id="${widget.id}-show-pct" ${chartOpts.showPct ? 'checked' : ''}> Show % Change</label>
                        <label>Percentage Mode:
                            <select id="${widget.id}-pct-mode">
                                <option value="from_previous" ${chartOpts.pctMode === 'from_previous' ? 'selected' : ''}>From Previous</option>
                                <option value="from_first" ${chartOpts.pctMode === 'from_first' ? 'selected' : ''}>From First Point</option>
                            </select>
                        </label>
                        <label>X-Axis Ticks: <input type="number" id="${widget.id}-x-limit" value="${chartOpts.xAxisLimit}" min="1" max="20" style="width: 60px;"></label>
                        <label>Y-Axis Ticks: <input type="number" id="${widget.id}-y-limit" value="${chartOpts.yAxisLimit}" min="1" max="10" style="width: 60px;"></label>
                        <label>Line Smoothness: <input type="range" id="${widget.id}-tension" value="${chartOpts.tension}" min="0" max="1" step="0.1" style="width: 100px;"></label>
                        ${widgetType === 'balance' ? `
                        <label class="checkbox-label"><input type="checkbox" id="${widget.id}-enable-forecast" ${chartOpts.enableForecast ? 'checked' : ''}> Forecast Trend</label>
                        <label>Forecast Days: <input type="number" id="${widget.id}-forecast-days" value="${chartOpts.forecastDays}" min="1" max="365" style="width: 60px;"></label>
                        ` : ''}
                    </div>
                        <div class="widget-settings-section" style="border-bottom: none; padding-bottom: 0;">
                            <strong>Width</strong>
                            <label>
                                <select id="${widget.id}-width" style="width: 120px;">
                                    <option value="12" ${widget.width === undefined || widget.width === 12 ? 'selected' : ''}>Full (12)</option>
                                    <option value="6" ${widget.width === 6 ? 'selected' : ''}>Half (6)</option>
                                    <option value="4" ${widget.width === 4 ? 'selected' : ''}>Third (4)</option>
                                    <option value="3" ${widget.width === 3 ? 'selected' : ''}>Quarter (3)</option>
                                    <option value="2" ${widget.width === 2 ? 'selected' : ''}>Half Third (2)</option>
                                    <option value="1" ${widget.width === 1 ? 'selected' : ''}>Narrow (1)</option>
                                </select>
                            </label>
                        </div>
                        <button onclick="updateWidgetDateRange('${widget.id}')">Update</button>
                </div>
                <div class="widget-body">
                    <div id="${widget.id}-error" style="color: #e74c3c; font-size: 0.85rem;"></div>
                    <div class="widget-chart" style="height: ${widget.chart_height || 300}px;">
                        <canvas id="${widget.id}"></canvas>
                        <div class="widget-chart-resize-handle"></div>
                    </div>
                    <div class="chart-legend" id="${widget.id}-legend" style="display: none;">
                        <div class="legend-container" id="${widget.id}-legend-items"></div>
                    </div>
                    <div class="widget-info">
                        ${widgetType === 'balance' ? `<div class="widget-accounts">${accountTags}</div>` : ''}
                        <div class="widget-mode">
                            ${widgetTypeBadge}
                            ${widgetType === 'balance' ? `<span class="widget-mode-badge">${widget.chart_mode}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;

    // Render charts for each widget
    for (const widget of widgets) {
        await renderWidgetChart(widget, widget.id, allAccounts, allGroups);
    }

    // Wire up percentage change controls for each widget
    widgets.forEach(widget => {
        const showPctCheckbox = document.getElementById(`${widget.id}-show-pct`);
        const pctModeSelect = document.getElementById(`${widget.id}-pct-mode`);

        if (showPctCheckbox) {
            showPctCheckbox.addEventListener('change', async () => {
                if (widgetCharts[widget.id]) {
                    widgetCharts[widget.id].__pctOpts = {
                        enabled: showPctCheckbox.checked,
                        mode: widgetCharts[widget.id].__pctOpts?.mode || 'from_previous'
                    };
                    widgetCharts[widget.id].update();
                }
                await persistPctSettings(widget.id, showPctCheckbox.checked, widgetCharts[widget.id].__pctOpts.mode);
            });
        }

        if (pctModeSelect) {
            pctModeSelect.addEventListener('change', async () => {
                if (widgetCharts[widget.id]) {
                    widgetCharts[widget.id].__pctOpts = {
                        enabled: widgetCharts[widget.id].__pctOpts?.enabled ?? false,
                        mode: pctModeSelect.value
                    };
                    widgetCharts[widget.id].update();
                }
                await persistPctSettings(widget.id, widgetCharts[widget.id].__pctOpts.enabled, pctModeSelect.value);
            });
        }
    });

    // Wire up width selector for each widget
    widgets.forEach(widget => {
        const widthSelect = document.getElementById(`${widget.id}-width`);
        if (widthSelect) {
            widthSelect.addEventListener('change', async () => {
                const cols = parseInt(widthSelect.value, 10);
                const widgetCard = document.querySelector(`.widget[data-widget-id="${widget.id}"]`);
                if (widgetCard) {
                    widgetCard.setAttribute('data-cols', String(cols));
                }
                const w = widgetsCache.find(w => w.id === widget.id);
                if (w) {
                    w.width = cols;
                    w.updated_at = new Date().toISOString();
                    try {
                        const response = await fetch(`/api/widgets/${widget.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(w)
                        });
                        if (!response.ok) {
                            const errorText = await response.text();
                            console.error('Failed to save widget width:', errorText);
                        }
                    } catch (e) {
                        console.error('Failed to save widget width:', e);
                    }
                }
            });
        }
    });

    // Wire up time range controls for each widget
    const timeRanges = CONFIG.timeRanges || ['7d', '30d', '3m', '6m', '1y', 'ytd'];
    const defaultTimeRange = CONFIG.defaultTimeRange || '30d';

    widgets.forEach(widget => {
        const timeRangeSelect = document.getElementById(`${widget.id}-time-range`);
        const applyTimeRangeBtn = document.getElementById(`${widget.id}-apply-time-range`);
        const customRangeDiv = document.getElementById(`${widget.id}-custom-range`);
        const customCount = document.getElementById(`${widget.id}-custom-count`);
        const customUnit = document.getElementById(`${widget.id}-custom-unit`);
        const applyCustomRangeBtn = document.getElementById(`${widget.id}-apply-custom-range`);
        const roundEndCheckbox = document.getElementById(`${widget.id}-round-end`);
        const roundEndMode = document.getElementById(`${widget.id}-round-end-mode`);
        const ROLL_END_KEY = `oxidize_widget_${widget.id}_round_end`;

        // Build time range dropdown
        timeRanges.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            const match = key.match(/^(\d+)([dmwy])$/);
            if (match) {
                const num = match[1];
                const unit = match[2];
                const unitLabels = { d: 'Days', w: 'Weeks', m: 'Months', y: 'Years' };
                option.textContent = `${num} ${unitLabels[unit]}`;
            } else {
                option.textContent = key.toUpperCase();
            }
            if (key === defaultTimeRange) option.selected = true;
            timeRangeSelect.appendChild(option);
        });

        // Apply preset time range to widget
        function applyPreset(key) {
            const dates = calculateRelativeDates(key);
            if (!dates) return;
            const startEl = document.getElementById(`${widget.id}-start`);
            const endEl = document.getElementById(`${widget.id}-end`);
            startEl.value = dates.start;
            endEl.value = dates.end;
            if (roundEndCheckbox && roundEndCheckbox.checked) {
                endEl.value = roundEndDate(dates.end, roundEndMode.value);
            }
        }

        // Apply custom range to widget
        function applyCustom() {
            const count = parseInt(customCount.value, 10) || 1;
            const unit = customUnit.value;
            const dates = calculateRelativeDatesFromCustom(count, unit);
            if (!dates) return;
            const startEl = document.getElementById(`${widget.id}-start`);
            const endEl = document.getElementById(`${widget.id}-end`);
            startEl.value = dates.start;
            endEl.value = dates.end;
            if (roundEndCheckbox && roundEndCheckbox.checked) {
                endEl.value = roundEndDate(dates.end, roundEndMode.value);
            }
        }

        // Time range select handler
        timeRangeSelect.addEventListener('change', () => {
            const value = timeRangeSelect.value;
            if (value === '__none__') {
                customRangeDiv.style.display = 'block';
                applyTimeRangeBtn.style.display = 'none';
            } else {
                customRangeDiv.style.display = 'none';
                applyTimeRangeBtn.style.display = 'inline-block';
                applyPreset(value);
            }
        });

        // Apply button for preset
        if (applyTimeRangeBtn) {
            applyTimeRangeBtn.addEventListener('click', () => applyPreset(timeRangeSelect.value));
        }

        // Apply button for custom range
        if (applyCustomRangeBtn) {
            applyCustomRangeBtn.addEventListener('click', applyCustom);
        }

        // Round end checkbox handler
        if (roundEndCheckbox) {
            const savedMode = localStorage.getItem(ROLL_END_KEY) || 'end_of_current_month';
            roundEndMode.value = savedMode;

            roundEndCheckbox.addEventListener('change', () => {
                roundEndMode.style.display = roundEndCheckbox.checked ? 'inline-block' : 'none';
                const currentValue = timeRangeSelect.value;
                if (currentValue !== '__none__') {
                    applyPreset(currentValue);
                } else {
                    applyCustom();
                }
            });
        }

        // Round end mode change handler
        if (roundEndMode) {
            roundEndMode.addEventListener('change', () => {
                localStorage.setItem(ROLL_END_KEY, roundEndMode.value);
                const currentValue = timeRangeSelect.value;
                if (currentValue !== '__none__') {
                    applyPreset(currentValue);
                } else {
                    applyCustom();
                }
            });
        }
    });

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
                grid.querySelectorAll('.widget').forEach(el => {
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
document.addEventListener('DOMContentLoaded', () => {
    // Register percentage labels plugin
    if (typeof Chart !== 'undefined') {
        Chart.register(pctLabelPlugin);
    }

    // Initialize theme
    initTheme();

    // Theme toggle button
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

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
