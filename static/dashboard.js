const DASHBOARD_WIDGETS_KEY = 'oxidize_dashboard_widgets';
const SAVED_LISTS_KEY = 'firefly_saved_account_lists';
let widgetCharts = {};
let widgetDatasetVisibility = {};
let widgetsCache = [];
let dashboardLocked = true;
let dashboardGrid = null;

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
        pct_mode: opts.pct_mode || 'from_previous'
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
    const chartMode = document.getElementById(`${widgetId}-chart-mode`).value;

    const widgets = await getDashboardWidgets();
    const widgetIndex = widgets.findIndex(w => w.id === widgetId);

    if (widgetIndex === -1) return;

    const widget = widgets[widgetIndex];
    widget.start_date = startDate || null;
    widget.end_date = endDate || null;
    widget.interval = interval || null;
    widget.chart_mode = chartMode;
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
        await renderWidgetChart(widget, widgetId, allAccounts);
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
        pctMode: raw.pct_mode
    };
}

async function renderEarnedSpentChart(ctx, widget, labels, history, containerId) {
    const opts = getChartOptions(widget);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    // Find earned and spent datasets from history
    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels.length) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels.length) : new Array(labels.length).fill(0);

    // Earned is typically positive (income), spent is typically negative (expense)
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
                            const date = new Date(label);
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

async function renderWidgetChart(widget, containerId, allAccounts) {
    const ctx = document.getElementById(containerId).getContext('2d');

    try {
        // Determine widget type (default to "balance" for backwards compatibility)
        const widgetType = widget.widget_type || 'balance';

        let history;
        if (widgetType === 'earned_spent') {
            // For earned vs spent, use the dedicated earned-spent endpoint
            const params = new URLSearchParams();
            // Add account IDs if specified
            if (widget.accounts && Array.isArray(widget.accounts)) {
                widget.accounts.forEach(id => params.append('accounts[]', id));
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
        } else {
            // For balance widgets, fetch with specific accounts
            history = await fetchChartData(
                widget.accounts,
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
            await renderEarnedSpentChart(ctx, widget, labels, history, containerId);
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

            if (widgetCharts[widget.id]) {
                widgetCharts[widget.id].destroy();
            }

            widgetCharts[widget.id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Total Balance',
                        data: absoluteData,
                        absoluteData: absoluteData,
                        borderColor: chartColor,
                        backgroundColor: chartColor + '20',
                        borderWidth: 2,
                        tension: opts.tension,
                        fill: opts.fillArea,
                        pointRadius: opts.showPoints ? 4 : 0
                    }]
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
                                    // label is ISO date string like "2024-01-15T00:00:00Z"
                                    const date = new Date(label);
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
            const colors = generateColors(widget.accounts.length);

            const accountInfo = widget.accounts.map(id => {
                const account = allAccounts.find(a => a.id === id);
                return {
                    id: id,
                    name: account ? account.name : 'Unknown',
                    balance: account ? account.balance : '0'
                };
            });

            const datasets = accountInfo.map((info, index) => {
                const dataset = filteredHistory.find(ds => {
                    const normalizedDsLabel = ds.label.replace(/ - In$/, '').replace(/ - Out$/, '').replace(/ \(In\)$/, '').replace(/ \(Out\)$/, '');
                    return normalizedDsLabel === info.name || ds.label === info.name;
                });

                const opts = getChartOptions(widget);

                if (!dataset) {
                    return {
                        label: info.name,
                        data: new Array(labels.length).fill(null),
                        absoluteData: new Array(labels.length).fill(null),
                        borderColor: colors[index],
                        borderWidth: 2,
                        tension: opts.tension,
                        fill: opts.fillArea,
                        pointRadius: opts.showPoints ? 4 : 0
                    };
                }

                let flowData = [];
                if (Array.isArray(dataset.entries)) {
                    flowData = dataset.entries.map(e => parseFloat(e.value || 0));
                } else {
                    flowData = Object.values(dataset.entries).map(v => {
                        if (typeof v === 'object' && v !== null) {
                            return parseFloat(v.value || 0);
                        }
                        return parseFloat(v);
                    });
                }

                const lastValue = flowData[flowData.length - 1];
                const anchorBalance = parseFloat(info.balance);

                // The Firefly III chart API returns absolute balance data, not flow data
                // So we can use the flowData directly without any conversion
                const absoluteData = flowData;

                console.log(`[Split mode] Account "${info.name}": Using flowData directly as absolute. lastValue=${lastValue}, anchorBalance=${anchorBalance}`);

                return {
                    label: info.name,
                    data: absoluteData,
                    absoluteData: absoluteData,
                    borderColor: colors[index],
                    borderWidth: 2,
                    tension: opts.tension,
                    fill: opts.fillArea,
                    pointRadius: opts.showPoints ? 4 : 0
                };
            });

            if (widgetCharts[widget.id]) {
                widgetCharts[widget.id].destroy();
            }

            const opts2 = getChartOptions(widget);
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const chartTextColor = isDark ? '#eaeaea' : '#333';
            const chartGridColor = isDark ? '#444' : '#ddd';

            widgetCharts[widget.id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: datasets
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
                                    // label is ISO date string like "2024-01-15T00:00:00Z"
                                    const date = new Date(label);
                                    return date.toLocaleDateString();
                                }
                            }
                        }
                    }
                }
            });
            widgetCharts[widget.id].__pctOpts = { enabled: opts2.showPct, mode: opts2.pctMode };

            // Render the legend after chart is created
            renderSplitLegend(widget.id, accountInfo, datasets);
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

    // Fetch all accounts once
    const allAccounts = await fetchAccounts();

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

        const accountNames = widget.accounts.map(id => {
            const account = allAccounts.find(a => a.id === id);
            return account ? account.name : 'Unknown';
        }).join(', ');

        const accountTags = widget.accounts.map(id => {
            const account = allAccounts.find(a => a.id === id);
            return account ? `<span class="widget-account-tag">${account.name}</span>` : '';
        }).join('');

        const startDate = widget.start_date || '';
        const endDate = widget.end_date || '';
        const interval = widget.interval || 'auto';

        // Get chart options with defaults
        const chartOpts = getChartOptions(widget);

        // Widget type badge
        const widgetTypeBadge = widgetType === 'earned_spent'
            ? '<span class="widget-type-badge earned-spent">Earned vs Spent</span>'
            : '<span class="widget-type-badge balance">Balance</span>';

        html += `
            <div class="widget" data-widget-id="${widget.id}" data-cols="${widget.width || 12}">
                <div class="widget-header">
                    <span class="widget-title">${widget.name}</span>
                    <div class="widget-actions">
                        <button class="settings-toggle" onclick="toggleWidgetSettings('${widget.id}')">▼ Settings</button>
                        <button onclick="deleteWidget('${widget.id}')">Delete</button>
                    </div>
                </div>
                <div class="widget-settings" id="${widget.id}-settings" style="display: none;">
                    <div class="widget-settings-section">
                        <strong>Date Range</strong>
                        <label>Start: <input type="date" id="${widget.id}-start" value="${startDate}"></label>
                        <label>End: <input type="date" id="${widget.id}-end" value="${endDate}"></label>
                        <label>Interval:
                            <select id="${widget.id}-interval">
                                <option value="auto" ${interval === 'auto' ? 'selected' : ''}>Auto</option>
                                <option value="1D" ${interval === '1D' ? 'selected' : ''}>Day</option>
                                <option value="1W" ${interval === '1W' ? 'selected' : ''}>Week</option>
                                <option value="1M" ${interval === '1M' ? 'selected' : ''}>Month</option>
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
        await renderWidgetChart(widget, widget.id, allAccounts);
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
