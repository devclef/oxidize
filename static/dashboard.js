const DASHBOARD_WIDGETS_KEY = 'oxidize_dashboard_widgets';
const SAVED_LISTS_KEY = 'firefly_saved_account_lists';
const THEME_KEY = 'oxidize_theme';
let widgetCharts = {};

// Get config from server or use defaults
const CONFIG = window.OXIDIZE_CONFIG || {
    accountTypes: ['asset', 'cash', 'expense', 'revenue', 'liability'],
    autoFetchAccounts: false
};

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
        showMoonIcon();
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        showSunIcon();
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(THEME_KEY, newTheme);

    if (newTheme === 'dark') {
        showMoonIcon();
    } else {
        showSunIcon();
    }

    // Update all widget charts
    updateWidgetChartsTheme(newTheme);
}

function showSunIcon() {
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    if (sunIcon) sunIcon.style.display = 'block';
    if (moonIcon) moonIcon.style.display = 'none';
}

function showMoonIcon() {
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'block';
}

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

    try {
        await fetch(`/api/widgets/${widgetId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(widget)
        });

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

function getChartOptions(widget) {
    // Default chart options
    const defaults = {
        showPoints: false,
        xAxisLimit: 6,
        yAxisLimit: 4,
        fillArea: true,
        tension: 0.1,
        beginAtZero: false
    };
    const opts = widget.chart_options || {};
    return {
        showPoints: opts.show_points ?? defaults.showPoints,
        xAxisLimit: opts.x_axis_limit ?? defaults.xAxisLimit,
        yAxisLimit: opts.y_axis_limit ?? defaults.yAxisLimit,
        fillArea: opts.fill_area ?? defaults.fillArea,
        tension: opts.tension ?? defaults.tension,
        beginAtZero: opts.begin_at_zero ?? defaults.beginAtZero
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

            // Calculate anchor balance
            let totalAnchorBalance = 0;
            widget.accounts.forEach(id => {
                const account = allAccounts.find(a => a.id === id);
                if (account) {
                    totalAnchorBalance += parseFloat(account.balance || 0);
                }
            });

            const lastTotalValue = totalFlowData[totalFlowData.length - 1];
            const totalDiff = Math.abs(lastTotalValue - totalAnchorBalance);
            const totalThreshold = Math.abs(lastTotalValue) * 0.5 + 50.0;
            const isAbsolute = totalDiff < totalThreshold;

            console.log(`[Combined mode] lastTotalValue=${lastTotalValue}, totalAnchorBalance=${totalAnchorBalance}, diff=${totalDiff}, threshold=${totalThreshold}, isAbsolute=${isAbsolute}`);

            let absoluteData;
            if (isAbsolute) {
                absoluteData = totalFlowData;
            } else {
                absoluteData = new Array(totalFlowData.length);
                let current = totalAnchorBalance;
                for (let i = totalFlowData.length - 1; i >= 0; i--) {
                    absoluteData[i] = current;
                    current -= totalFlowData[i];
                }
            }

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
                const diff = Math.abs(lastValue - anchorBalance);
                const threshold = Math.abs(lastValue) * 0.5 + 50.0;
                const isAbsolute = diff < threshold;

                console.log(`[Split mode] Account "${info.name}": lastValue=${lastValue}, anchorBalance=${anchorBalance}, diff=${diff}, threshold=${threshold}, isAbsolute=${isAbsolute}`);

                let absoluteData;
                if (isAbsolute) {
                    absoluteData = flowData;
                } else {
                    absoluteData = new Array(flowData.length);
                    let current = anchorBalance;
                    for (let i = flowData.length - 1; i >= 0; i--) {
                        absoluteData[i] = current;
                        current -= flowData[i];
                    }
                }

                return {
                    label: info.name,
                    data: absoluteData,
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

    // Fetch all accounts once
    const allAccounts = await fetchAccounts();

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
            <div class="widget" data-widget-id="${widget.id}">
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
                        <label>X-Axis Ticks: <input type="number" id="${widget.id}-x-limit" value="${chartOpts.xAxisLimit}" min="1" max="20" style="width: 60px;"></label>
                        <label>Y-Axis Ticks: <input type="number" id="${widget.id}-y-limit" value="${chartOpts.yAxisLimit}" min="1" max="10" style="width: 60px;"></label>
                        <label>Line Smoothness: <input type="range" id="${widget.id}-tension" value="${chartOpts.tension}" min="0" max="1" step="0.1" style="width: 100px;"></label>
                    </div>
                    <button onclick="updateWidgetDateRange('${widget.id}')">Update</button>
                </div>
                <div class="widget-body">
                    <div id="${widget.id}-error" style="color: #e74c3c; font-size: 0.85rem;"></div>
                    <div class="widget-chart">
                        <canvas id="${widget.id}"></canvas>
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
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize theme
    initTheme();

    // Theme toggle button
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    renderDashboard();
});
