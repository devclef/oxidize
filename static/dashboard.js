const DASHBOARD_WIDGETS_KEY = 'oxidize_dashboard_widgets';
const SAVED_LISTS_KEY = 'firefly_saved_account_lists';
let widgetCharts = {};

// Get config from server or use defaults
const CONFIG = window.OXIDIZE_CONFIG || {
    accountTypes: ['asset', 'cash', 'expense', 'revenue', 'liability'],
    autoFetchAccounts: false
};

function getDashboardWidgets() {
    const saved = localStorage.getItem(DASHBOARD_WIDGETS_KEY);
    return saved ? JSON.parse(saved) : [];
}

function deleteWidget(id) {
    if (confirm('Delete this widget?')) {
        // Destroy chart if exists
        if (widgetCharts[id]) {
            widgetCharts[id].destroy();
            delete widgetCharts[id];
        }

        const widgets = getDashboardWidgets().filter(w => w.id !== id);
        localStorage.setItem(DASHBOARD_WIDGETS_KEY, JSON.stringify(widgets));
        renderDashboard();
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

    const widgets = getDashboardWidgets();
    const widgetIndex = widgets.findIndex(w => w.id === widgetId);

    if (widgetIndex === -1) return;

    widgets[widgetIndex].startDate = startDate;
    widgets[widgetIndex].endDate = endDate;
    widgets[widgetIndex].interval = interval;
    widgets[widgetIndex].updatedAt = new Date().toISOString();

    localStorage.setItem(DASHBOARD_WIDGETS_KEY, JSON.stringify(widgets));

    // Close settings panel
    document.getElementById(`${widgetId}-settings`).style.display = 'none';

    // Re-render the chart
    const allAccounts = await fetchAccounts();
    await renderWidgetChart(widgets[widgetIndex], widgetId, allAccounts);
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

async function renderWidgetChart(widget, containerId, allAccounts) {
    const ctx = document.getElementById(containerId).getContext('2d');

    try {
        const history = await fetchChartData(
            widget.accounts,
            widget.startDate,
            widget.endDate,
            widget.interval
        );

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

        if (widget.chartMode === 'combined') {
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
            const isAbsolute = Math.abs(lastTotalValue - totalAnchorBalance) < (Math.abs(lastTotalValue) * 0.5 + 50.0);

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
                        borderColor: '#3498db',
                        backgroundColor: '#3498db20',
                        borderWidth: 2,
                        tension: 0.1,
                        fill: true,
                        pointRadius: 0
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
                            beginAtZero: false,
                            ticks: {
                                maxTicksLimit: 4,
                                callback: function(value) {
                                    return value.toLocaleString();
                                }
                            }
                        },
                        x: {
                            display: false
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

                if (!dataset) {
                    return {
                        label: info.name,
                        data: new Array(labels.length).fill(null),
                        borderColor: colors[index],
                        borderWidth: 2,
                        tension: 0.1,
                        pointRadius: 0
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
                const isAbsolute = Math.abs(lastValue - anchorBalance) < (Math.abs(lastValue) * 0.5 + 50.0);

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
                    tension: 0.1,
                    pointRadius: 0
                };
            });

            if (widgetCharts[widget.id]) {
                widgetCharts[widget.id].destroy();
            }

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
                            beginAtZero: false,
                            ticks: {
                                maxTicksLimit: 4,
                                callback: function(value) {
                                    return value.toLocaleString();
                                }
                            }
                        },
                        x: {
                            display: false
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
    const widgets = getDashboardWidgets();

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

    widgets.forEach(widget => {
        const accountNames = widget.accounts.map(id => {
            const account = allAccounts.find(a => a.id === id);
            return account ? account.name : 'Unknown';
        }).join(', ');

        const accountTags = widget.accounts.map(id => {
            const account = allAccounts.find(a => a.id === id);
            return account ? `<span class="widget-account-tag">${account.name}</span>` : '';
        }).join('');

        const startDate = widget.startDate || '';
        const endDate = widget.endDate || '';
        const interval = widget.interval || 'auto';

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
                    <button onclick="updateWidgetDateRange('${widget.id}')">Update</button>
                </div>
                <div class="widget-body">
                    <div id="${widget.id}-error" style="color: #e74c3c; font-size: 0.85rem;"></div>
                    <div class="widget-chart">
                        <canvas id="${widget.id}"></canvas>
                    </div>
                    <div class="widget-info">
                        <div class="widget-accounts">
                            ${accountTags}
                        </div>
                        <div class="widget-mode">
                            <span class="widget-mode-badge">${widget.chartMode}</span>
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
    renderDashboard();
});
