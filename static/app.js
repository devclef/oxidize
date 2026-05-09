let allAccounts = [];
let balanceChart = null;
let enableComparison = false;
const DASHBOARD_WIDGETS_KEY = 'oxidize_dashboard_widgets';
let selectedTypes = new Set(['all']);
let chartErrorEl = null;
let groups = [];
let editingGroupId = null;
const GROUPS_STORAGE_KEY = 'oxidize_groups';
let groupsLoadedPromise = null;

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

// UUID polyfill for browsers that don't support crypto.randomUUID
function generateUUID() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback implementation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function loadGroups() {
    try {
        const stored = localStorage.getItem(GROUPS_STORAGE_KEY);
        if (stored) {
            groups = JSON.parse(stored);
        }
    } catch {
        groups = [];
    }
}

function saveGroups() {
    try {
        localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups));
    } catch {
        // ignore
    }
}

async function fetchGroups() {
    try {
        const response = await fetch('/api/groups');
        if (!response.ok) return [];
        return await response.json();
    } catch (e) {
        console.error('Failed to fetch groups:', e);
        return [];
    }
}

async function saveGroupToBackend(group) {
    if (group.id) {
        const response = await fetch(`/api/groups/${group.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(group)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to update group');
        }
        return response.json();
    } else {
        group.id = group.id || generateUUID();
        const response = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(group)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to save group');
        }
        return response.json();
    }
}

async function deleteGroupFromBackend(id) {
    const response = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to delete group');
    }
}

// Get config from server or use defaults
const CONFIG = window.OXIDIZE_CONFIG || {
    accountTypes: ['asset', 'cash', 'expense', 'revenue', 'liability'],
    autoFetchAccounts: false
};

window.addEventListener("themeChanged", (e) => { updateChartTheme(e.detail); });

function updateChartTheme(theme) {
    const isDark = theme === 'dark';
    const textColor = isDark ? '#eaeaea' : '#333';
    const gridColor = isDark ? '#444' : '#ddd';

    if (balanceChart && balanceChart.options && balanceChart.options.scales) {
        balanceChart.options.scales.x.grid = { color: gridColor };
        balanceChart.options.scales.x.ticks = { color: textColor };
        balanceChart.options.scales.y.grid = { color: gridColor };
        balanceChart.options.scales.y.ticks = { color: textColor };

        // Update legend colors if present
        if (balanceChart.options.plugins && balanceChart.options.plugins.legend) {
            balanceChart.options.plugins.legend.labels = { color: textColor };
        }

        balanceChart.update('none');
    }
}

async function fetchAccounts() {
    const app = document.getElementById('app');
    const types = Array.from(selectedTypes);

    app.innerHTML = '<div class="loading">Loading accounts...</div>';

    try {
        // If 'all' is selected or nothing is selected, fetch all configured account types
        if (types.length === 0 || types.includes('all')) {
            allAccounts = [];
            for (const type of CONFIG.accountTypes) {
                const response = await fetch(`/api/accounts?type=${type}`);
                if (!response.ok) {
                    throw new Error(`Error: ${response.status} ${response.statusText}`);
                }
                const accounts = await response.json();
                allAccounts = allAccounts.concat(accounts);
            }
        } else {
            // Fetch accounts for each selected type and combine results
            allAccounts = [];
            for (const type of types) {
                const response = await fetch(`/api/accounts?type=${type}`);
                if (!response.ok) {
                    throw new Error(`Error: ${response.status} ${response.statusText}`);
                }
                const accounts = await response.json();
                allAccounts = allAccounts.concat(accounts);
            }
        }

        if (allAccounts.length === 0) {
            app.innerHTML = '<div class="loading">No accounts found for selected filters.</div>';
            document.getElementById('account-count').textContent = '';
            return;
        }

        // Update account count badge
        document.getElementById('account-count').textContent = allAccounts.length + ' accounts';

        let html = '<div class="account-list">';
        allAccounts.forEach(account => {
            const isNegative = parseFloat(account.balance) < 0;
            html += `
                <div class="account-card">
                    <input type="checkbox" class="account-select" value="${account.id}">
                    <div class="account-info">
                        <span class="account-name">${account.name}</span>
                        <span class="account-type-tag">${account.account_type}</span>
                    </div>
                    <span class="account-balance ${isNegative ? 'negative' : ''}">
                        ${account.currency}${account.balance}
                    </span>
                </div>
            `;
        });
        html += '</div>';
        app.innerHTML = html;

        // Show the collapse/expand button after accounts are loaded
        document.getElementById('toggle-accounts-btn').style.display = 'inline-block';
    } catch (error) {
        app.innerHTML = `<div class="error">Failed to load accounts: ${error.message}</div>`;
        console.error('Fetch error:', error);
    }
}

async function fetchChartData() {
    const chartContainer = document.querySelector('.chart-wrapper');
    chartErrorEl = document.getElementById('chart-error');
    const chartMode = document.querySelector('input[name="chart-mode"]:checked')?.value || 'combined';

    // Clear previous errors
    if (chartErrorEl) chartErrorEl.innerHTML = '';

    // Wait for groups to load so split-mode legend has group data
    if (groupsLoadedPromise) {
        await groupsLoadedPromise;
    }

    // Ensure we have accounts for the anchor balances
    if (allAccounts.length === 0) {
        try {
            const response = await fetch('/api/accounts');
            if (response.ok) {
                allAccounts = await response.json();
            }
        } catch (e) {
            console.warn('Failed to pre-fetch accounts for chart anchors:', e);
        }
    }

    const selectedCheckboxes = document.querySelectorAll('.account-select:checked');
    const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    // Get widget type
    const widgetType = document.getElementById('widget-type-select')?.value || 'balance';

    // Get date range and interval
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const interval = document.getElementById('interval-select').value;
    

    // Get comparison dates if enabled
    const comparisonStartDate = enableComparison ? document.getElementById('comparison-start-date').value : null;
    const comparisonEndDate = enableComparison ? document.getElementById('comparison-end-date').value : null;

    try {
        const params = new URLSearchParams();

        // For earned_spent widget type, use the dedicated endpoint
        if (widgetType === 'earned_spent') {
            // Add selected account IDs to filter earned/spent data
            selectedIds.forEach(id => params.append('accounts[]', id));

            if (startDate) params.append('start', startDate);
            if (endDate) params.append('end', endDate);
            if (interval && interval !== 'auto') params.append('period', interval);

            let url = '/api/earned-spent';
            if (params.toString()) {
                url += `?${params.toString()}`;
            }

            console.log('=== FETCHING EARNED/SPENT DATA ===');
            console.log('URL:', url);
            console.log('Selected account IDs:', selectedIds);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            const history = await response.json();

            console.log('=== EARNED/SPENT DATA FETCHED ===');
            console.log('Received history:', history);

            if (!history || history.length === 0) {
                console.warn('No earned/spent data returned from API');
                chartErrorEl.innerHTML = '<div class="info">No earned/spent data found for the current date range.</div>';
                chartContainer.style.display = 'block';
                if (balanceChart) {
                    balanceChart.destroy();
                    balanceChart = null;
                }
                return;
            }

            chartContainer.style.display = 'block';
            renderChart(history, widgetType);
            return;
        }

        // For expenses_by_category widget type
        if (widgetType === 'expenses_by_category') {
            selectedIds.forEach(id => params.append('accounts[]', id));

            if (startDate) params.append('start', startDate);
            if (endDate) params.append('end', endDate);

            let url = '/api/expenses-by-category';
            if (params.toString()) {
                url += `?${params.toString()}`;
            }

            console.log('=== FETCHING EXPENSES BY CATEGORY DATA ===');
            console.log('URL:', url);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            const categories = await response.json();

            console.log('=== EXPENSES BY CATEGORY DATA FETCHED ===');
            console.log('Received categories:', categories);

            if (!categories || categories.length === 0) {
                console.warn('No expenses by category data returned from API');
                chartErrorEl.innerHTML = '<div class="info">No expenses by category data found for the current date range.</div>';
                chartContainer.style.display = 'block';
                if (balanceChart) {
                    balanceChart.destroy();
                    balanceChart = null;
                }
                return;
            }

            chartContainer.style.display = 'block';
            renderChart(categories, widgetType);
            return;
        }

        // For net_worth widget type
        if (widgetType === 'net_worth') {
            if (startDate) params.append('start', startDate);
            if (endDate) params.append('end', endDate);
            if (interval && interval !== 'auto') params.append('period', interval);

            let url = '/api/net-worth';
            if (params.toString()) {
                url += `?${params.toString()}`;
            }

            console.log('=== FETCHING NET WORTH DATA ===');
            console.log('URL:', url);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            const netWorth = await response.json();

            console.log('=== NET WORTH DATA FETCHED ===');
            console.log('Received net worth:', netWorth);

            if (!netWorth || netWorth.length === 0) {
                console.warn('No net worth data returned from API');
                chartErrorEl.innerHTML = '<div class="info">No net worth data found for the current date range.</div>';
                chartContainer.style.display = 'block';
                if (balanceChart) {
                    balanceChart.destroy();
                    balanceChart = null;
                }
                return;
            }

            chartContainer.style.display = 'block';
            renderChart(netWorth, widgetType);
            return;
        }

        // For budget_spent widget type - time series bar chart with dates on x-axis
        if (widgetType === 'budget_spent') {
            if (startDate) params.append('start', startDate);
            if (endDate) params.append('end', endDate);

            const url = '/api/budgets/spent';
            const fullUrl = params.toString() ? `${url}?${params.toString()}` : url;

            console.log('=== FETCHING BUDGET SPENT DATA ===');
            console.log('URL:', fullUrl);

            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            let budgetData = await response.json();

            // Filter by selected budget names
            const selectedBudgetCheckboxes = document.querySelectorAll('.budget-select:checked');
            const selectedBudgetNames = Array.from(selectedBudgetCheckboxes).map(cb => cb.dataset.name);
            if (selectedBudgetNames.length > 0) {
                const nameSet = new Set(selectedBudgetNames);
                budgetData = budgetData.filter(ds => nameSet.has(ds.label));
            }

            console.log('=== BUDGET SPENT DATA FETCHED ===');
            console.log('Received budget data:', budgetData);

            if (!budgetData || budgetData.length === 0) {
                console.warn('No budget spent data returned from API');
                chartErrorEl.innerHTML = '<div class="info">No budget spent data found for the current date range.</div>';
                chartContainer.style.display = 'block';
                if (balanceChart) {
                    balanceChart.destroy();
                    balanceChart = null;
                }
                return;
            }

            // Collect all unique dates across all budgets
            const allDates = new Set();
            budgetData.forEach(ds => {
                if (ds.entries && typeof ds.entries === 'object') {
                    Object.keys(ds.entries).forEach(k => allDates.add(k));
                }
            });
            const sortedDates = Array.from(allDates).sort();

            console.log('Budget chart dates:', sortedDates);

            // Build datasets: one per budget, aligned to sortedDates
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const chartTextColor = isDark ? '#eaeaea' : '#333';
            const chartGridColor = isDark ? '#444' : '#ddd';
            const hueStep = 360 / budgetData.length;

            const datasets = budgetData.map((ds, idx) => {
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

            if (balanceChart) {
                balanceChart.destroy();
            }

            chartContainer.style.display = 'block';
            const ctx = document.getElementById('balanceChart').getContext('2d');
            balanceChart = new Chart(ctx, {
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
                            display: budgetData.length > 1,
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
                            beginAtZero: true,
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

        if (selectedIds.length > 0) {
            selectedIds.forEach(id => params.append('accounts[]', id));
        } else if (chartMode === 'split') {
            // If in split mode and no accounts selected, include all relevant accounts
            // so that the backend returns per-account data for the graph
            let addedCount = 0;
            allAccounts.forEach(account => {
                if (!account.account_type) return;
                const type = account.account_type.toLowerCase();
                // Include broad range of asset/balance-based accounts
                if (type.includes('asset') || type.includes('checking') || type.includes('savings') ||
                    type.includes('cash') || type.includes('credit') || type.includes('investment') ||
                    type.includes('default-asset') || type.includes('bank')) {
                    params.append('accounts[]', account.id);
                    addedCount++;
                }
            });
            console.log(`Added ${addedCount} accounts to split mode request automatically`);

            // If still nothing added, just add all of them if there aren't too many
            if (addedCount === 0 && allAccounts.length > 0) {
                console.warn('No asset accounts found for split mode default, adding all accounts instead');
                allAccounts.forEach(account => params.append('accounts[]', account.id));
            }
        }

        if (startDate) params.append('start', startDate);
        if (endDate) params.append('end', endDate);
        if (interval && interval !== 'auto') params.append('period', interval);

        let url = '/api/accounts/balance-history';
        if (params.toString()) {
            url += `?${params.toString()}`;
        }

        console.log('=== FETCHING CHART DATA ===');
        console.log('URL:', url);
        console.log('Selected account IDs:', selectedIds);

        
        // If comparison mode is enabled, fetch comparison data
        let comparisonHistory = null;
        if (enableComparison && comparisonStartDate && comparisonEndDate) {
            const compParams = new URLSearchParams();
            selectedIds.forEach(id => compParams.append('accounts[]', id));
            compParams.append('start', comparisonStartDate);
            compParams.append('end', comparisonEndDate);
            if (interval && interval !== 'auto') compParams.append('period', interval);
            
            const compUrl = '/api/accounts/balance-history?' + compParams.toString();
            console.log('=== FETCHING COMPARISON DATA ===');
            console.log('URL:', compUrl);
            
            try {
                const compResponse = await fetch(compUrl);
                if (compResponse.ok) {
                    comparisonHistory = await compResponse.json();
                    console.log('Comparison data fetched:', comparisonHistory);
                }
            } catch (compErr) {
                console.warn('Failed to fetch comparison data:', compErr);
            }
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error: ${response.status} ${response.statusText}`);
        }
        const history = await response.json();

        console.log('=== CHART DATA FETCHED ===');
        console.log('Selected account IDs:', selectedIds);
        console.log('Received history:', history);

        if (!history || history.length === 0) {
            console.warn('No history data returned from API');
            chartErrorEl.innerHTML = '<div class="info">No balance history data found for the current selection and date range.</div>';
            chartContainer.style.display = 'block';
            if (balanceChart) {
                balanceChart.destroy();
                balanceChart = null;
            }
            return;
        }

        chartContainer.style.display = 'block';
        // Render comparison chart if comparison data is available
        if (enableComparison && comparisonHistory && comparisonHistory.length > 0) {
            const ctx = document.getElementById('balanceChart').getContext('2d');
            renderComparisonChart(ctx, history, comparisonHistory);
        } else {
            renderChart(history);
        }
    } catch (error) {
        console.error('Fetch chart error:', error);
        chartErrorEl.innerHTML = `<div class="error">Failed to load chart data: ${error.message}</div>`;
    }
}

// Percentage change settings
const PCT_MODE_KEY = 'oxidize_chart_pct_mode';
let pctEnabled = false;
let pctMode = 'from_previous'; // 'from_previous' or 'from_first'

function loadPctMode() {
    try {
        pctMode = localStorage.getItem(PCT_MODE_KEY) || 'from_previous';
    } catch {
        pctMode = 'from_previous';
    }
}

function savePctMode() {
    try {
        localStorage.setItem(PCT_MODE_KEY, pctMode);
    } catch {
        // ignore
    }
}

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
            // from_previous
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

// Chart.js plugin for percentage change labels
const pctLabelPlugin = {
    id: 'percentLabels',
    afterDatasetsDraw(chart) {
        if (!pctEnabled) return;

        const { ctx, chartArea } = chart;
        if (!chartArea) return;

        // Respect theme for label colors
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#b0b0b0' : '#666';

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!dataset.data || dataset.hidden) return;

            const data = dataset.data;
            if (data.length === 0) return;

            // Get absolute data values (not flow) - use the stored absoluteData if available
            let absoluteData = dataset.absoluteData || data;
            if (!Array.isArray(absoluteData)) {
                absoluteData = data;
            }

            const pctLabels = computePercentChange(absoluteData, pctMode);

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

                // Draw label slightly above the point
                ctx.fillStyle = textColor;
                ctx.fillText(formatted, x, y - 8);
            });

            ctx.restore();
        });
    }
};

// Track visibility of each dataset in split mode by index
let datasetVisibility = {};
let accountColors = [];
let currentDatasets = [];

function generateColors(count) {
    const colors = [];
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
        const hue = Math.round(i * hueStep);
        colors.push({
            border: `hsl(${hue}, 70%, 50%)`,
            background: `hsl(${hue}, 70%, 50%, 0.1)`
        });
    }
    return colors;
}

// Extract chart data from entries (handles both object and array formats)
// For object format, data is extracted in the order of the provided labels to ensure alignment
function extractChartData(entries, labels = []) {
    if (Array.isArray(entries)) {
        return entries.map(e => parseFloat(e.value || 0));
    } else if (labels && labels.length > 0) {
        // Use labels to extract values in the correct order
        return labels.map(label => {
            const v = entries[label];
            if (typeof v === 'object' && v !== null) {
                return parseFloat(v.value || 0);
            }
            return parseFloat(v || 0);
        });
    } else {
        // Fallback: use Object.values (may not preserve order for all cases)
        return Object.values(entries).map(v => {
            if (typeof v === 'object' && v !== null) {
                return parseFloat(v.value || 0);
            }
            return parseFloat(v);
        });
    }
}

// Render earned vs spent bar chart
function renderEarnedSpentChart(ctx, history, chartType = 'bars') {
    if (chartType === 'delta_line') {
        renderDeltaLineChart(ctx, history);
    } else if (chartType === 'delta_bar') {
        renderDeltaBarChart(ctx, history);
    } else {
        renderEarnedSpentBarsChart(ctx, history);
    }
}

function renderEarnedSpentBarsChart(ctx, history) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    // Find earned and spent datasets from history
    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    // Extract labels from the first dataset that has entries
    let labels = [];
    const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
    if (firstDataset) {
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }

    if (labels.length === 0) {
        console.warn('No labels found in earned/spent chart data');
        return;
    }

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels) : new Array(labels.length).fill(0);

    // Earned is typically positive (income), spent is typically positive (expense)
    // We'll show earned in green and spent in red
    const earnedColor = isDark ? '#58d68d' : '#27ae60';
    const spentColor = isDark ? '#ec7063' : '#e74c3c';

    // Destroy existing chart to avoid memory leaks
    if (balanceChart) {
        balanceChart.destroy();
    }

    balanceChart = new Chart(ctx, {
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
                        maxTicksLimit: 4,
                        callback: function(value) {
                            return Math.abs(value).toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: 6,
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

function renderDeltaLineChart(ctx, history) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    // Find earned and spent datasets from history
    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    // Extract labels from the first dataset that has entries
    let labels = [];
    const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
    if (firstDataset) {
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }

    if (labels.length === 0) {
        console.warn('No labels found in earned/spent chart data');
        return;
    }

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels) : new Array(labels.length).fill(0);

    // Calculate delta: earned - spent (positive = earned more, negative = spent more)
    const deltaData = earnedData.map((earned, i) => earned - spentData[i]);

    const lineColor = isDark ? '#3498db' : '#2980b9';
    const pointColor = deltaData.map(v => v >= 0 ? '#27ae60' : '#e74c3c');

    if (balanceChart) {
        balanceChart.destroy();
    }

    balanceChart = new Chart(ctx, {
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
                        maxTicksLimit: 6,
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: 6,
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

function renderDeltaBarChart(ctx, history) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    // Find earned and spent datasets from history
    const earnedDataset = history.find(ds => ds.label === 'earned');
    const spentDataset = history.find(ds => ds.label === 'spent');

    // Extract labels from the first dataset that has entries
    let labels = [];
    const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
    if (firstDataset) {
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }

    if (labels.length === 0) {
        console.warn('No labels found in earned/spent chart data');
        return;
    }

    const earnedData = earnedDataset ? extractChartData(earnedDataset.entries, labels) : new Array(labels.length).fill(0);
    const spentData = spentDataset ? extractChartData(spentDataset.entries, labels) : new Array(labels.length).fill(0);

    // Calculate delta: earned - spent (positive = earned more, negative = spent more)
    const deltaData = earnedData.map((earned, i) => earned - spentData[i]);

    const greenColor = isDark ? '#58d68d' : '#27ae60';
    const redColor = isDark ? '#ec7063' : '#e74c3c';

    if (balanceChart) {
        balanceChart.destroy();
    }

    balanceChart = new Chart(ctx, {
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
                        maxTicksLimit: 6,
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        maxTicksLimit: 6,
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

// Render expenses by category chart (horizontal bar chart)
function renderExpensesByCategoryChart(ctx, categories) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    // Categories is an array of {name, amount, currency_symbol, currency_code}
    if (!categories || categories.length === 0) {
        console.warn('No category data to render');
        return;
    }

    // Sort by amount descending for better visualization
    const sortedCategories = [...categories].sort((a, b) => b.amount - a.amount);

    const labels = sortedCategories.map(c => c.name);
    const data = sortedCategories.map(c => c.amount);
    const currencySymbol = sortedCategories[0]?.currency_symbol || '';

    // Generate colors for each category
    const colors = [];
    const hues = [210, 280, 330, 120, 60, 30, 190, 260, 300, 40]; // Blue, Purple, Pink, Green, Orange, Red, etc.
    sortedCategories.forEach((_, i) => {
        const hue = hues[i % hues.length];
        colors.push(isDark ? `hsl(${hue}, 60%, 60%)` : `hsl(${hue}, 70%, 50%)`);
    });

    // Destroy existing chart
    if (balanceChart) {
        balanceChart.destroy();
    }

    balanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Expenses',
                data: data,
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace('60%', '40%').replace('50%', '40%')),
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y', // Horizontal bar chart
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        callback: function(value) {
                            return currencySymbol + value.toLocaleString();
                        }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: chartTextColor,
                        maxRotation: 0
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return currencySymbol + context.parsed.x.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// Render net worth chart (line chart)
function renderNetWorthChart(ctx, history) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';

    // Extract labels and data from history
    let labels = [];
    let data = [];
    let currencySymbol = '';

    if (history && history.length > 0) {
        const dataset = history[0];
        currencySymbol = dataset.currency_symbol || '';

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
        console.warn('No net worth data to render');
        return;
    }

    // Sort by date
    const sortedIndices = labels.map((_, i) => i).sort((a, b) => {
        const dateA = parseChartLabel(labels[a]);
        const dateB = parseChartLabel(labels[b]);
        return dateA - dateB;
    });

    labels = sortedIndices.map(i => labels[i]);
    data = sortedIndices.map(i => data[i]);

    const netWorthColor = isDark ? '#5dade2' : '#3498db';

    // Destroy existing chart
    if (balanceChart) {
        balanceChart.destroy();
    }

    balanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Net Worth',
                data: data,
                borderColor: netWorthColor,
                backgroundColor: netWorthColor + '20',
                borderWidth: 2,
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
                        callback: function(value) {
                            return currencySymbol + value.toLocaleString();
                        }
                    }
                },
                x: {
                    grid: { color: chartGridColor },
                    ticks: {
                        color: chartTextColor,
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
                                return 'Net Worth: ' + currencySymbol + context.parsed.y.toLocaleString();
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

// Aggregate account data into groups for split mode rendering
function aggregateGroupData(history, groups, allAccountsList) {
    // Build a map of account name -> { data, balance }
    const nameDataMap = new Map();
    history.forEach(ds => {
        let flowData = [];
        if (Array.isArray(ds.entries)) {
            flowData = ds.entries.map(e => parseFloat(e.value || 0));
        } else {
            flowData = Object.values(ds.entries || {}).map(v => parseFloat(v?.value || v || 0));
        }
        nameDataMap.set(ds.label, { data: flowData, balance: '0' });
    });

    // Also build account name -> balance map from allAccountsList
    const accountBalanceMap = new Map();
    allAccountsList.forEach(a => {
        accountBalanceMap.set(a.name, a.balance);
    });

    // Find checked groups
    const checkedGroups = groups.filter(g => g._checked);

    // Track which account names are consumed by groups
    const groupMemberNames = new Set();
    checkedGroups.forEach(g => {
        g.account_ids.forEach(accId => {
            const acc = allAccountsList.find(a => a.id === accId);
            if (acc) groupMemberNames.add(acc.name);
        });
    });

    // Build display items
    const displayItems = [];

    // Add group items first
    checkedGroups.forEach(group => {
        let summedData = null;
        let totalBalance = 0;

        group.account_ids.forEach(accId => {
            const acc = allAccountsList.find(a => a.id === accId);
            if (!acc) return;

            const ds = nameDataMap.get(acc.name);
            if (!ds) return;

            if (!summedData) {
                summedData = ds.data.map(v => v);
            } else {
                ds.data.forEach((v, i) => {
                    if (summedData[i] !== undefined) summedData[i] += v;
                });
            }
            totalBalance += parseFloat(acc.balance || 0);
        });

        if (summedData) {
            displayItems.push({
                type: 'group',
                label: group.name,
                data: summedData,
                absoluteData: summedData,
                balance: totalBalance.toString()
            });
        }
    });

    // Add individual (non-group) accounts
    // uniqueAccountInfo already contains all selected accounts;
    // we need to filter out those consumed by groups
    // This is handled by the caller passing the right uniqueAccountInfo

    return displayItems;
}

// Linear regression: y = slope * x + intercept
function linearRegression(points) {
    const n = points.length;
    if (n < 2) return { slope: 0, intercept: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumX2 += p.x * p.x;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return { slope: 0, intercept: sumY / n };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
}

// Compute forecast data points using linear regression on recent balance history
function computeForecast(absoluteData, labels, forecastDays) {
    if (absoluteData.length < 2) return null;

    // Use up to last 30 data points for regression
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

    // Determine the period from the last two labels
    const lastDate = parseChartLabel(labels[labels.length - 1]);
    let periodDays = 1;
    if (labels.length >= 2) {
        const prevDate = parseChartLabel(labels[labels.length - 2]);
        const diffMs = lastDate - prevDate;
        periodDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }

    // Generate forecast points
    const forecastValues = [];
    const forecastLabels = [];

    for (let i = 1; i <= forecastDays; i++) {
        const futureIndex = absoluteData.length - 1 + i;
        const predictedY = slope * futureIndex + intercept;
        const forecastValue = isNaN(predictedY) ? null : predictedY;
        forecastValues.push(forecastValue);

        const futureDate = new Date(lastDate);
        futureDate.setDate(futureDate.getDate() + periodDays * i);
        forecastLabels.push(futureDate.toISOString().split('T')[0]);
    }

    return { values: forecastValues, labels: forecastLabels };
}

function renderChart(history, widgetType = 'balance') {
    const ctx = document.getElementById('balanceChart').getContext('2d');
    const chartMode = document.querySelector('input[name="chart-mode"]:checked')?.value || 'combined';

    // For earned_spent widget type, render based on selected chart type
    if (widgetType === 'earned_spent') {
        const earnedChartType = document.querySelector('input[name="earned-chart-type"]:checked')?.value || 'bars';
        renderEarnedSpentChart(ctx, history, earnedChartType);
        return;
    }

    // For expenses_by_category widget type, render as a horizontal bar chart
    if (widgetType === 'expenses_by_category') {
        renderExpensesByCategoryChart(ctx, history);
        return;
    }

    // For net_worth widget type, render as a line chart
    if (widgetType === 'net_worth') {
        renderNetWorthChart(ctx, history);
        return;
    }

    // Destroy existing chart to avoid memory leaks
    if (balanceChart) {
        balanceChart.destroy();
    }

    // Extract labels from the first dataset that has entries
    let labels = [];
    const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries || {}).length > 0));
    if (firstDataset) {
        console.log('First dataset entries type:', Array.isArray(firstDataset.entries) ? 'array' : 'object');
        console.log('First dataset entries:', JSON.stringify(firstDataset.entries));
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }
    console.log('Extracted labels:', labels);

    if (labels.length === 0) {
        console.warn('No labels found in chart data');
        console.warn('History:', JSON.stringify(history.slice(0, 2)));
        if (chartErrorEl) chartErrorEl.innerHTML = '<div class="error">No data points found for the selected date range.</div>';
        return;
    }

    // Process datasets
    const processedDatasets = [];
    const totalFlowData = new Array(labels.length).fill(0);

    // For split mode, get account info from selected checkboxes (authoritative source)
    // For combined mode, build accountInfo from history data
    let accountInfo = [];
    const selectedCheckboxes = document.querySelectorAll('.account-select:checked');

    console.log('=== RENDERING CHART ===');
    console.log('Mode:', chartMode);
    console.log('All accounts available:', allAccounts.length);
    if (allAccounts.length > 0) {
        console.log('Sample account structure:', allAccounts[0]);
    }

    if (chartMode === 'split' && selectedCheckboxes.length > 0) {
        // In split mode, use selected accounts directly
        selectedCheckboxes.forEach(cb => {
            const account = allAccounts.find(a => a.id === cb.value);
            if (account) {
                accountInfo.push({
                    id: account.id,
                    name: account.name,
                    balance: account.balance
                });
            }
        });
    }

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

        // Sum the data into the aggregated dataset for combined mode
        if (ds.label !== 'earned' && ds.label !== 'spent') {
            flowData.forEach((val, i) => {
                if (i < totalFlowData.length) {
                    totalFlowData[i] += val;
                }
            });
        }

        // Find matching account for this dataset to include in anchor balance
        // Normalize label to match account name
        let baseLabel = ds.label
            .replace(/ - In$/, '')
            .replace(/ - Out$/, '')
            .replace(/ \(In\)$/, '')
            .replace(/ \(Out\)$/, '')
            .replace(/ Income$/, '')
            .replace(/ Expense$/, '')
            .replace(/ Earned$/, '')
            .replace(/ Spent$/, '');

        const account = allAccounts.find(a => a.name === baseLabel || a.name === ds.label);
        if (account) {
            accountInfo.push({
                id: account.id,
                name: account.name,
                balance: account.balance
            });
        } else {
            console.warn(`Could not find account matching label: ${ds.label} (base: ${baseLabel})`);
        }
    });

    // If no accounts matched (maybe it's a "Net Worth" or "Assets" pre-selection),
    // and we have selected accounts in the UI, use those.
    if (accountInfo.length === 0) {
        if (selectedCheckboxes.length > 0) {
            selectedCheckboxes.forEach(cb => {
                const account = allAccounts.find(a => a.id === cb.value);
                if (account) {
                    accountInfo.push({
                        id: account.id,
                        name: account.name,
                        balance: account.balance
                    });
                }
            });
        } else {
            // Fallback to all asset accounts if nothing selected
            let addedCount = 0;
            allAccounts.forEach(account => {
                if (!account.account_type) return;
                const type = account.account_type.toLowerCase();
                if (type.includes('asset') || type.includes('checking') || type.includes('savings') ||
                    type.includes('cash') || type.includes('credit') || type.includes('investment') ||
                    type.includes('default-asset') || type.includes('bank')) {
                    accountInfo.push({
                        id: account.id,
                        name: account.name,
                        balance: account.balance
                    });
                    addedCount++;
                }
            });

            // If still nothing, just take all of them
            if (addedCount === 0 && allAccounts.length > 0) {
                console.warn('Fallback: No asset accounts found in allAccounts, using everything');
                allAccounts.forEach(account => {
                    accountInfo.push({
                        id: account.id,
                        name: account.name,
                        balance: account.balance
                    });
                });
            }
        }
    }

    // Deduplicate accountInfo (remove duplicates based on id)
    let uniqueAccountInfo = [];
    const seenIds = new Set();
    accountInfo.forEach(info => {
        if (!seenIds.has(info.id)) {
            seenIds.add(info.id);
            uniqueAccountInfo.push(info);
        }
    });

    // Generate colors for accounts (accounts + groups)
    const checkedGroups = groups.filter(g => g._checked);
    const groupMemberNames = new Set();
    checkedGroups.forEach(g => {
        g.account_ids.forEach(accId => {
            const acc = allAccounts.find(a => a.id === accId);
            if (acc) groupMemberNames.add(acc.name);
        });
    });
    const individualAccounts = uniqueAccountInfo.filter(info => !groupMemberNames.has(info.name));
    const totalDisplayItems = checkedGroups.length + individualAccounts.length;
    accountColors = generateColors(totalDisplayItems);

    // Initialize visibility tracking by index - all visible by default
    for (let i = 0; i < totalDisplayItems; i++) {
        datasetVisibility[i] = true;
    }

    if (chartMode === 'split') {
        console.log('=== SPLIT MODE DEBUG ===');
        console.log('Selected accounts:', uniqueAccountInfo.map(a => a.name));
        console.log('All datasets labels:', history.map(ds => ds.label));
        console.log('All accounts:', allAccounts.map(a => a.name));

        const filteredHistory = history.filter(ds => ds.label !== 'earned' && ds.label !== 'spent');
        console.log('Filtered datasets:', filteredHistory.map(ds => ds.label));

        if (filteredHistory.length === 0 && history.length > 0) {
            console.warn('Split mode: No per-account data in history, showing aggregate instead');
            const colors = generateColors(history.length);
            currentDatasets = history.map((ds, index) => {
                let flowData = [];
                if (Array.isArray(ds.entries)) {
                    flowData = ds.entries.map(e => parseFloat(e.value || e.amount || e.balance || 0));
                } else {
                    flowData = Object.values(ds.entries).map(v => {
                        if (typeof v === 'object' && v !== null) {
                            return parseFloat(v.value || v.amount || v.balance || 0);
                        }
                        return parseFloat(v);
                    });
                }
                return {
                    label: ds.label,
                    data: flowData,
                    borderColor: colors[index].border,
                    backgroundColor: colors[index].background,
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false
                };
            });

            // Set visibility to all true
            currentDatasets.forEach((_, i) => datasetVisibility[i] = true);

            // Update account info to match the aggregate datasets for the legend
            uniqueAccountInfo = history.map(ds => ({
                id: ds.label,
                name: ds.label,
                balance: '0'
            }));
        } else {
            // Build display items: groups first, then individual (non-group) accounts
            currentDatasets = [];
            let colorIndex = 0;

            // Helper: find dataset for an account name
            const findDatasetForName = (name) => {
                return filteredHistory.find(ds => {
                    const normalizedDsLabel = ds.label
                        .replace(/ - In$/, '')
                        .replace(/ - Out$/, '')
                        .replace(/ \(In\)$/, '')
                        .replace(/ \(Out\)$/, '')
                        .replace(/ Income$/, '')
                        .replace(/ Expense$/, '')
                        .replace(/ Earned$/, '')
                        .replace(/ Spent$/, '');
                    return normalizedDsLabel === name || ds.label === name;
                });
            };

            // Helper: process a dataset into a Chart.js dataset
            const processDataset = (dataset, name, anchorBalance, idx) => {
                let datasetFlowData = [];
                if (Array.isArray(dataset.entries)) {
                    datasetFlowData = dataset.entries.map(e => parseFloat(e.value || e.amount || e.balance || 0));
                } else {
                    datasetFlowData = Object.values(dataset.entries).map(v => {
                        if (typeof v === 'object' && v !== null) {
                            return parseFloat(v.value || v.amount || v.balance || 0);
                        }
                        return parseFloat(v);
                    });
                }

                const lastValue = datasetFlowData[datasetFlowData.length - 1];

                let isAbsolute;
                if (anchorBalance === 0 && lastValue === 0) {
                    isAbsolute = true;
                } else if (anchorBalance === 0) {
                    const allSameSign = datasetFlowData.every(v => v >= 0) || datasetFlowData.every(v => v <= 0);
                    isAbsolute = !allSameSign;
                } else {
                    const allPositive = datasetFlowData.every(v => v >= 0);
                    const allNegative = datasetFlowData.every(v => v <= 0);
                    const maxAbsValue = Math.max(...datasetFlowData.map(Math.abs));
                    const relativeDiff = Math.abs(lastValue - anchorBalance) / Math.abs(anchorBalance);
                    const looksLikeFlow = (allPositive || allNegative) && maxAbsValue < Math.abs(anchorBalance) * 0.1 && relativeDiff > 0.5;
                    isAbsolute = !looksLikeFlow;
                }

                let absoluteData;
                if (isAbsolute) {
                    absoluteData = datasetFlowData;
                } else {
                    absoluteData = new Array(datasetFlowData.length);
                    let runningBalance = anchorBalance;
                    for (let i = datasetFlowData.length - 1; i >= 0; i--) {
                        absoluteData[i] = runningBalance;
                        runningBalance -= datasetFlowData[i];
                    }
                }

                return {
                    label: name,
                    data: absoluteData,
                    absoluteData: absoluteData,
                    borderColor: accountColors[idx].border,
                    backgroundColor: accountColors[idx].background,
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false
                };
            };

            // Add group datasets (aggregated)
            checkedGroups.forEach(group => {
                let summedData = null;
                let totalBalance = 0;
                const memberDatasets = [];

                group.account_ids.forEach(accId => {
                    const acc = allAccounts.find(a => a.id === accId);
                    if (!acc) return;
                    const dataset = findDatasetForName(acc.name);
                    if (!dataset) return;
                    memberDatasets.push({ dataset, balance: acc.balance, name: acc.name });
                    totalBalance += parseFloat(acc.balance || 0);
                });

                if (memberDatasets.length === 0) return;

                // Aggregate data points
                memberDatasets.forEach(({ dataset, balance, name }) => {
                    let flowData = [];
                    if (Array.isArray(dataset.entries)) {
                        flowData = dataset.entries.map(e => parseFloat(e.value || e.amount || e.balance || 0));
                    } else {
                        flowData = Object.values(dataset.entries).map(v => {
                            if (typeof v === 'object' && v !== null) {
                                return parseFloat(v.value || v.amount || v.balance || 0);
                            }
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
                });

                // Determine isAbsolute for the group (use last member's logic as proxy)
                const lastMember = memberDatasets[memberDatasets.length - 1];
                const lastValue = summedData ? summedData[summedData.length - 1] : 0;
                let isAbsolute;
                if (totalBalance === 0 && lastValue === 0) {
                    isAbsolute = true;
                } else if (totalBalance === 0) {
                    const allSameSign = summedData.every(v => v >= 0) || summedData.every(v => v <= 0);
                    isAbsolute = !allSameSign;
                } else {
                    const allPositive = summedData.every(v => v >= 0);
                    const allNegative = summedData.every(v => v <= 0);
                    const maxAbsValue = Math.max(...summedData.map(Math.abs));
                    const relativeDiff = Math.abs(lastValue - totalBalance) / Math.abs(totalBalance);
                    const looksLikeFlow = (allPositive || allNegative) && maxAbsValue < Math.abs(totalBalance) * 0.1 && relativeDiff > 0.5;
                    isAbsolute = !looksLikeFlow;
                }

                let absoluteData;
                if (isAbsolute) {
                    absoluteData = summedData;
                } else {
                    absoluteData = new Array(summedData.length);
                    let runningBalance = totalBalance;
                    for (let i = summedData.length - 1; i >= 0; i--) {
                        absoluteData[i] = runningBalance;
                        runningBalance -= summedData[i];
                    }
                }

                currentDatasets.push({
                    label: group.name,
                    data: absoluteData,
                    absoluteData: absoluteData,
                    borderColor: accountColors[colorIndex].border,
                    backgroundColor: accountColors[colorIndex].background,
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false
                });
                colorIndex++;
            });

            // Add individual (non-group) account datasets
            individualAccounts.forEach((info, index) => {
                const dataset = findDatasetForName(info.name);

                if (!dataset) {
                    console.warn(`No data found for account: ${info.name}`);
                    currentDatasets.push({
                        label: info.name,
                        data: new Array(labels.length).fill(null),
                        borderColor: accountColors[colorIndex].border,
                        backgroundColor: accountColors[colorIndex].background,
                        borderWidth: 2,
                        tension: 0.1,
                        fill: false
                    });
                    colorIndex++;
                    return;
                }

                const processed = processDataset(dataset, info.name, parseFloat(info.balance), colorIndex);
                currentDatasets.push(processed);
                colorIndex++;
            });
        }

        // Apply visibility settings to datasets
        currentDatasets.forEach((dataset, index) => {
            dataset.hidden = !datasetVisibility[index];
        });

        // Forecast for split mode: extend each visible dataset with its own forecast data
        const enableForecastEl = document.getElementById('enable-forecast');
        const forecastDaysEl = document.getElementById('forecast-days');
        const showForecast = enableForecastEl && enableForecastEl.checked;
        const forecastDays = forecastDaysEl ? parseInt(forecastDaysEl.value, 10) || 30 : 30;

        let splitChartLabels = labels;

        if (showForecast) {
            // Compute shared forecast labels from the first visible dataset
            const firstVisible = currentDatasets.find(d => !d.hidden);
            if (firstVisible) {
                const result = computeForecast(firstVisible.data, labels, forecastDays);
                if (result) {
                    splitChartLabels = [...labels, ...result.labels];
                }
            }

            // Extend each visible dataset with its own forecast
            currentDatasets.forEach((dataset) => {
                if (dataset.hidden) return;
                const result = computeForecast(dataset.data, labels, forecastDays);
                if (result) {
                    dataset.data = [...dataset.data, ...result.values];
                }
            });
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const chartTextColor = isDark ? '#eaeaea' : '#333';
        const chartGridColor = isDark ? '#444' : '#ddd';

        balanceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: splitChartLabels,
                datasets: currentDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false // We'll create our own legend
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toLocaleString();
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
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
                            minRotation: 45
                        }
                    }
                }
            }
        });

        // Render the legend after chart is created
        // Build legend info matching currentDatasets (groups + individuals)
        const legendInfo = [];
        checkedGroups.forEach(g => {
            legendInfo.push({ name: g.name, balance: '0' });
        });
        individualAccounts.forEach(a => {
            legendInfo.push({ name: a.name, balance: a.balance });
        });
        renderSplitLegend(legendInfo, currentDatasets);
    } else {
        // Combined mode - aggregate all datasets
        // Calculate total anchor balance from unique accounts
        let totalAnchorBalance = 0;
        uniqueAccountInfo.forEach(info => {
            totalAnchorBalance += parseFloat(info.balance);
        });

        // Determine if the aggregated data is absolute balance or flow.
        // Firefly III's chart endpoint returns balance snapshots (absolute) for accounts.
        const lastTotalValue = totalFlowData[totalFlowData.length - 1];

        let isAbsolute;
        if (totalAnchorBalance === 0 && lastTotalValue === 0) {
            isAbsolute = true;
        } else if (totalAnchorBalance === 0) {
            // If anchor is zero but data isn't, check if data looks like flow
            const allSameSign = totalFlowData.every(v => v >= 0) || totalFlowData.every(v => v <= 0);
            isAbsolute = !allSameSign;
        } else {
            // Check if data looks like flow vs balance
            const allPositive = totalFlowData.every(v => v >= 0);
            const allNegative = totalFlowData.every(v => v <= 0);
            const maxAbsValue = Math.max(...totalFlowData.map(Math.abs));
            const relativeDiff = Math.abs(lastTotalValue - totalAnchorBalance) / Math.abs(totalAnchorBalance);

            // Heuristic: treat as flow only if all values same-sign, small relative to anchor, and last differs significantly
            const looksLikeFlow = (allPositive || allNegative) && maxAbsValue < Math.abs(totalAnchorBalance) * 0.1 && relativeDiff > 0.5;
            isAbsolute = !looksLikeFlow;
        }

        console.log(`Combined Mode: lastTotalValue=${lastTotalValue}, totalAnchorBalance=${totalAnchorBalance}, isAbsolute=${isAbsolute}`);

        let absoluteData;
        if (isAbsolute) {
            absoluteData = totalFlowData;
        } else {
            // Calculate absolute running balance backwards from the anchor balance
            absoluteData = new Array(totalFlowData.length);
            let runningBalance = totalAnchorBalance;
            for (let i = totalFlowData.length - 1; i >= 0; i--) {
                absoluteData[i] = runningBalance;
                runningBalance -= totalFlowData[i];
            }
        }

        // Forecast
        const enableForecastEl = document.getElementById('enable-forecast');
        const forecastDaysEl = document.getElementById('forecast-days');
        const showForecast = enableForecastEl && enableForecastEl.checked;
        const forecastDays = forecastDaysEl ? parseInt(forecastDaysEl.value, 10) || 30 : 30;

        let forecastLabels = [];
        let forecastData = [];
        let chartLabels = labels;
        let chartAbsoluteData = absoluteData;

        if (showForecast) {
            const result = computeForecast(absoluteData, labels, forecastDays);
            if (result) {
                chartAbsoluteData = [...absoluteData, ...result.values];
                chartLabels = [...labels, ...result.labels];
                forecastData = result.values;
                forecastLabels = result.labels;
            }
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const chartTextColor = isDark ? '#eaeaea' : '#333';
        const chartGridColor = isDark ? '#444' : '#ddd';
        const color = isDark ? '#5dade2' : '#3498db';
        const forecastColor = isDark ? '#a0a0a0' : '#888';

        const chartDatasets = [{
            label: 'Total Balance',
            data: chartAbsoluteData,
            absoluteData: absoluteData,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            tension: 0.1,
            fill: true
        }];

        if (showForecast && forecastData.length > 0) {
            chartDatasets.push({
                label: 'Forecast',
                data: forecastData,
                borderColor: forecastColor,
                backgroundColor: forecastColor + '10',
                borderWidth: 2,
                borderDash: [6, 4],
                tension: 0.1,
                fill: false,
                pointRadius: 0,
                order: 1
            });
        }

        balanceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartLabels,
                datasets: chartDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: chartTextColor }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
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
                            minRotation: 45
                        }
                    }
                }
            }
        });
    }
}

function renderGroups() {
    const groupsSection = document.getElementById('groups-section');
    const groupsList = document.getElementById('groups-list');

    // Always show the section so the "Create Group" button is visible
    groupsSection.style.display = 'block';
    groupsList.innerHTML = '';

    if (groups.length === 0) {
        groupsList.innerHTML = '<p style="opacity: 0.7; padding: 0.5rem;">No groups yet. Click "+ Create Group" to get started.</p>';
        return;
    }

    groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'group-item';
        item.dataset.groupId = group.id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'group-select';
        checkbox.value = group.id;
        checkbox.checked = group._checked || false;

        checkbox.addEventListener('change', () => {
            group._checked = checkbox.checked;
            if (checkbox.checked) {
                group.account_ids.forEach(accId => {
                    const cb = document.querySelector(`.account-select[value="${accId}"]`);
                    if (cb) cb.checked = true;
                });
            } else {
                group.account_ids.forEach(accId => {
                    const cb = document.querySelector(`.account-select[value="${accId}"]`);
                    if (cb) cb.checked = false;
                });
            }
            fetchChartData();
        });

        const info = document.createElement('div');
        info.className = 'group-info';

        const name = document.createElement('span');
        name.className = 'group-name';
        name.textContent = group.name;

        const count = document.createElement('span');
        count.className = 'group-account-count';
        count.textContent = ` (${group.account_ids.length} accounts)`;

        info.appendChild(name);
        info.appendChild(count);

        const actions = document.createElement('div');
        actions.className = 'group-actions';

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openGroupModal(group.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
            if (confirm(`Delete group "${group.name}"?`)) {
                try {
                    await deleteGroupFromBackend(group.id);
                    groups = groups.filter(g => g.id !== group.id);
                    saveGroups();
                    renderGroups();
                } catch (e) {
                    alert(`Failed to delete group: ${e.message}`);
                }
            }
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(checkbox);
        item.appendChild(info);
        item.appendChild(actions);
        groupsList.appendChild(item);
    });
}

function openGroupModal(groupId = null) {
    editingGroupId = groupId;
    const modal = document.getElementById('group-modal');
    const title = document.getElementById('group-modal-title');
    const nameInput = document.getElementById('group-name-input');
    const accountsList = document.getElementById('group-accounts-list');

    nameInput.value = '';
    accountsList.innerHTML = '';

    if (groupId) {
        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        title.textContent = 'Edit Group';
        nameInput.value = group.name;

        allAccounts.forEach(account => {
            const item = document.createElement('div');
            item.className = 'group-account-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = account.id;
            checkbox.checked = group.account_ids.includes(account.id);

            const label = document.createElement('span');
            label.textContent = `${account.name} (${account.balance})`;

            item.appendChild(checkbox);
            item.appendChild(label);
            accountsList.appendChild(item);
        });
    } else {
        title.textContent = 'Create Group';

        if (allAccounts.length === 0) {
            accountsList.innerHTML = '<p style="opacity: 0.7;">Fetch accounts first to create groups.</p>';
        } else {
            allAccounts.forEach(account => {
                const item = document.createElement('div');
                item.className = 'group-account-item';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = account.id;

                const label = document.createElement('span');
                label.textContent = `${account.name} (${account.balance})`;

                item.appendChild(checkbox);
                item.appendChild(label);
                accountsList.appendChild(item);
            });
        }
    }

    modal.style.display = 'flex';
}

function closeGroupModal() {
    document.getElementById('group-modal').style.display = 'none';
    editingGroupId = null;
}

async function handleGroupSave() {
    const nameInput = document.getElementById('group-name-input');
    const accountsList = document.getElementById('group-accounts-list');
    const name = nameInput.value.trim();

    if (!name) {
        alert('Please enter a group name');
        return;
    }

    const selectedCheckboxes = accountsList.querySelectorAll('input[type="checkbox"]:checked');
    const accountIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (accountIds.length === 0) {
        alert('Please select at least one account');
        return;
    }

    const group = {
        id: editingGroupId || null,
        name,
        account_ids: accountIds
    };

    try {
        const saved = await saveGroupToBackend(group);
        const idx = groups.findIndex(g => g.id === saved.id);
        if (idx >= 0) {
            groups[idx] = saved;
        } else {
            groups.push(saved);
        }
        saveGroups();
        renderGroups();
        closeGroupModal();
    } catch (e) {
        alert(`Failed to save group: ${e.message}`);
    }
}

function renderSplitLegend(accountInfo, datasets) {
    const legendContainer = document.getElementById('split-legend');
    const legendItems = document.getElementById('legend-items');

    // Clear previous legend
    legendItems.innerHTML = '';

    if (accountInfo.length === 0) {
        legendContainer.style.display = 'none';
        return;
    }

    legendContainer.style.display = 'block';
    chartErrorEl.style.display = 'none';

    // Create legend item for each account
    accountInfo.forEach((info, index) => {
        const dataset = datasets[index];
        if (!dataset) return;

        const item = document.createElement('div');
        item.className = `legend-item ${datasetVisibility[index] ? 'active' : 'hidden'}`;
        item.dataset.accountIndex = index;

        const colorDiv = document.createElement('div');
        colorDiv.className = 'legend-color';
        const borderColor = typeof dataset.borderColor === 'string' ? dataset.borderColor : dataset.borderColor.border;
        colorDiv.style.backgroundColor = borderColor;

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
            datasetVisibility[index] = !datasetVisibility[index];
            dataset.hidden = !datasetVisibility[index];
            item.classList.toggle('active');
            item.classList.toggle('hidden');

            // Update chart
            if (balanceChart) {
                balanceChart.update();
            }
        });

        legendItems.appendChild(item);
    });
}


// Dashboard widget functions
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

async function saveWidgetToStorage(widget) {
    widget.id = widget.id || generateUUID();
    widget.updated_at = new Date().toISOString();

    try {
        const response = await fetch('/api/widgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(widget)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to save widget');
        }
        return response.json();
    } catch (e) {
        console.error('Failed to save widget:', e);
        throw e;
    }
}

async function deleteWidgetFromStorage(id) {
    try {
        const response = await fetch(`/api/widgets/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to delete widget');
        }
    } catch (e) {
        console.error('Failed to delete widget:', e);
        throw e;
    }
}

async function updateWidgetInStorage(updatedWidget) {
    updatedWidget.updated_at = new Date().toISOString();

    try {
        const response = await fetch(`/api/widgets/${updatedWidget.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedWidget)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to update widget');
        }
        return response.json();
    } catch (e) {
        console.error('Failed to update widget:', e);
        throw e;
    }
}

async function saveGraphAsWidget() {
    const widgetName = document.getElementById('widget-name-input').value.trim();
    if (!widgetName) {
        alert('Please enter a name for the widget');
        return;
    }

    const widgetType = document.getElementById('widget-type-select').value;
    const selectedCheckboxes = document.querySelectorAll('.account-select:checked');
    const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    // Get selected budget IDs and names
    const selectedBudgetCheckboxes = document.querySelectorAll('.budget-select:checked');
    const selectedBudgetIds = Array.from(selectedBudgetCheckboxes).map(cb => cb.value);
    const selectedBudgetNames = Array.from(selectedBudgetCheckboxes).map(cb => cb.dataset.name);

    // Only balance widget type requires accounts
    if (widgetType === 'balance' && selectedIds.length === 0) {
        alert('Please select at least one account');
        return;
    }

    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const interval = document.getElementById('interval-select').value;
    

    // Get comparison dates if enabled
    const comparisonStartDate = enableComparison ? document.getElementById('comparison-start-date').value : null;
    const comparisonEndDate = enableComparison ? document.getElementById('comparison-end-date').value : null;
    const chartMode = document.querySelector('input[name="chart-mode"]:checked')?.value || 'combined';
    const earnedChartType = document.querySelector('input[name="earned-chart-type"]:checked')?.value || 'bars';

    // Identify which selected accounts belong to checked groups
    const checkedGroups = groups.filter(g => g._checked);
    const groupMemberIds = new Set();
    checkedGroups.forEach(g => {
        g.account_ids.forEach(id => groupMemberIds.add(id));
    });

    // Separate group member IDs from individual account IDs
    const groupIds = checkedGroups.map(g => g.id);
    const individualAccountIds = selectedIds.filter(id => !groupMemberIds.has(id));

    // Get forecast settings
    const enableForecastEl = document.getElementById('enable-forecast');
    const forecastDaysEl = document.getElementById('forecast-days');
    const showPctToggle = document.getElementById('show-pct-toggle');
    const pctModeSelect = document.getElementById('pct-mode-select');

    const chartOptions = {
        enable_forecast: enableForecastEl ? enableForecastEl.checked : false,
        forecast_days: forecastDaysEl ? (parseInt(forecastDaysEl.value, 10) || 30) : 30,
        show_pct: showPctToggle ? showPctToggle.checked : false,
        pct_mode: pctModeSelect ? pctModeSelect.value : 'from_previous'
    };

    const widget = {
        id: generateUUID(),
        name: widgetName,
        accounts: individualAccountIds,
        group_ids: groupIds,
        budget_ids: selectedBudgetIds,
        budget_names: selectedBudgetNames,
        start_date: startDate || null,
        end_date: endDate || null,
        interval: interval || null,
        chart_mode: chartMode,
        earned_chart_type: earnedChartType,
        widget_type: widgetType,
        chart_options: chartOptions
    };

    try {
        await saveWidgetToStorage(widget);
        document.getElementById('widget-name-input').value = '';
        alert(`Widget "${widgetName}" saved! View it on the Dashboard.`);
    } catch (e) {
        alert(`Failed to save widget: ${e.message}`);
    }
}

function selectAllAccounts() {
    document.querySelectorAll('.account-select').forEach(cb => cb.checked = true);
}

function deselectAllAccounts() {
    document.querySelectorAll('.account-select').forEach(cb => cb.checked = false);
}

function toggleAccountsSection() {
    const content = document.getElementById('accounts-content');
    const btn = document.getElementById('toggle-accounts-btn');

    if (content.style.display === 'none') {
        content.style.display = 'block';
        btn.textContent = 'Collapse';
    } else {
        content.style.display = 'none';
        btn.textContent = 'Expand';
    }
}

async function refreshData() {
    const btn = document.getElementById('refresh-data-btn');
    const originalText = btn.textContent;

    btn.textContent = 'Refreshing...';
    btn.disabled = true;

    try {
        // Clear all caches on the backend
        const response = await fetch('/api/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        console.log('Cache refresh result:', result);

        // Show brief success message
        btn.textContent = 'Refreshed!';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 1000);

        // Re-fetch accounts and chart data if there's data loaded
        if (allAccounts.length > 0) {
            await fetchAccounts();
            await fetchChartData();
        }
    } catch (error) {
        console.error('Refresh error:', error);
        alert(`Failed to refresh data: ${error.message}`);
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// Initialize

// Toggle comparison controls visibility
function toggleComparisonControls() {
    const enableComparisonCheckbox = document.getElementById('enable-comparison');
    const comparisonControls = document.getElementById('comparison-controls-wrapper');

    if (enableComparisonCheckbox && comparisonControls) {
        if (enableComparisonCheckbox.checked) {
            comparisonControls.style.display = 'inline-flex';
            enableComparison = true;
            
            const startDateInput = document.getElementById('start-date');
            const endDateInput = document.getElementById('end-date');
            const comparisonStartDateInput = document.getElementById('comparison-start-date');
            const comparisonEndDateInput = document.getElementById('comparison-end-date');
            
            if (startDateInput.value && endDateInput.value) {
                const start = new Date(startDateInput.value);
                const end = new Date(endDateInput.value);
                const diff = end - start;
                const comparisonEnd = new Date(start.getTime() - (diff / 2));
                const comparisonStart = new Date(comparisonEnd.getTime() - diff);
                comparisonEndDateInput.valueAsDate = comparisonEnd;
                comparisonStartDateInput.valueAsDate = comparisonStart;
            }
        } else {
            comparisonControls.style.display = 'none';
            enableComparison = false;
        }
    }
}

// Render comparison chart with primary and comparison data
function renderComparisonChart(ctx, primaryData, comparisonData) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chartTextColor = isDark ? '#eaeaea' : '#333';
    const chartGridColor = isDark ? '#444' : '#ddd';
    
    let labels = [];
    const firstDataset = primaryData.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
    if (firstDataset) {
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }
    
    if (labels.length === 0) {
        console.warn('No labels found in comparison chart data');
        return;
    }
    
    const chartDatasets = [];
    const colors = ['#3498db', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b'];
    
    primaryData.forEach((ds, idx) => {
        const data = extractChartData(ds.entries, labels);
        const color = colors[idx % colors.length];
        chartDatasets.push({
            label: ds.label,
            data: data,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            fill: false,
            tension: 0.1
        });
    });
    
    comparisonData.forEach((ds, idx) => {
        const data = extractChartData(ds.entries, labels);
        const color = colors[(idx + primaryData.length) % colors.length];
        chartDatasets.push({
            label: ds.label + ' (prev)' ,
            data: data,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            tension: 0.1
        });
    });
    
    if (balanceChart) {
        balanceChart.destroy();
    }
    
    balanceChart = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: chartDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: false, grid: { color: chartGridColor }, ticks: { color: chartTextColor } },
                x: { grid: { color: chartGridColor }, ticks: { color: chartTextColor, maxRotation: 45, minRotation: 45 } }
            },
            plugins: { legend: { display: true, position: 'bottom', labels: { color: chartTextColor } } }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Register percentage labels plugin
    if (typeof Chart !== 'undefined') {
        Chart.register(pctLabelPlugin);
    }

    // Load saved percentage mode
    loadPctMode();

    // Initialize theme
    initTheme();

    // Time range setup
    const timeRangeSelect = document.getElementById('time-range-select');
    const applyTimeRangeBtn = document.getElementById('apply-time-range-btn');
    const customRangeControls = document.getElementById('custom-range-controls');
    const customRangeCount = document.getElementById('custom-range-count');
    const customRangeUnit = document.getElementById('custom-range-unit');
    const applyCustomRangeBtn = document.getElementById('apply-custom-range-btn');
    const roundEndControls = document.getElementById('round-end-controls');
    const roundEndCheckbox = document.getElementById('round-end-checkbox');
    const roundEndMode = document.getElementById('round-end-mode');
    const ROLL_END_MODE_KEY = 'oxidize_round_end_mode';

    // Build time range dropdown from config
    const timeRanges = CONFIG.timeRanges || ['7d', '30d', '3m', '6m', '1y', 'ytd'];
    const defaultTimeRange = CONFIG.defaultTimeRange || '30d';

    timeRanges.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        // Convert key to readable label: '7d' -> '7 Days', '30d' -> '30 Days', 'ytd' -> 'YTD'
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

    // Apply selected time range preset
    function applyPresetTimeRange(key) {
        const dates = calculateRelativeDates(key);
        if (!dates) return;
        document.getElementById('start-date').value = dates.start;
        document.getElementById('end-date').value = dates.end;

        // Update comparison dates if enabled
        if (typeof enableComparison !== 'undefined' && enableComparison) {
            const durationMs = new Date(dates.end) - new Date(dates.start);
            const comparisonEndDate = new Date(new Date(dates.start).getTime() - durationMs);
            const comparisonStart = new Date(comparisonEndDate.getTime() - durationMs);
            document.getElementById('comparison-start-date').value = comparisonStart.toISOString().split('T')[0];
            document.getElementById('comparison-end-date').value = comparisonEndDate.toISOString().split('T')[0];
        }

        // Apply round end date if enabled
        if (roundEndCheckbox && roundEndCheckbox.checked) {
            const roundedEnd = roundEndDate(dates.end, roundEndMode.value);
            document.getElementById('end-date').value = roundedEnd;
        }

        fetchChartData();
    }

    // Apply custom relative range
    function applyCustomRange() {
        const count = parseInt(customRangeCount.value, 10) || 1;
        const unit = customRangeUnit.value;
        const dates = calculateRelativeDatesFromCustom(count, unit);
        if (!dates) return;
        document.getElementById('start-date').value = dates.start;
        document.getElementById('end-date').value = dates.end;

        // Apply round end date if enabled
        if (roundEndCheckbox && roundEndCheckbox.checked) {
            const roundedEnd = roundEndDate(dates.end, roundEndMode.value);
            document.getElementById('end-date').value = roundedEnd;
        }

        fetchChartData();
    }

    // Time range select handler
    timeRangeSelect.addEventListener('change', () => {
        const value = timeRangeSelect.value;
        if (value === '__none__') {
            // Show custom range inputs
            customRangeControls.style.display = 'inline-flex';
            applyTimeRangeBtn.style.display = 'none';
        } else {
            // Hide custom range inputs
            customRangeControls.style.display = 'none';
            applyTimeRangeBtn.style.display = 'inline-block';
            applyPresetTimeRange(value);
        }
    });

    // Apply button for preset
    if (applyTimeRangeBtn) {
        applyTimeRangeBtn.addEventListener('click', () => {
            applyPresetTimeRange(timeRangeSelect.value);
        });
    }

    // Apply button for custom range
    if (applyCustomRangeBtn) {
        applyCustomRangeBtn.addEventListener('click', applyCustomRange);
    }

    // Round end date checkbox handler
    if (roundEndCheckbox) {
        const savedRoundMode = localStorage.getItem(ROLL_END_MODE_KEY) || 'end_of_current_month';
        roundEndMode.value = savedRoundMode;

        roundEndCheckbox.addEventListener('change', () => {
            roundEndMode.style.display = roundEndCheckbox.checked ? 'inline-block' : 'none';
            if (roundEndCheckbox.checked) {
                // Re-apply current range with rounding
                const currentValue = timeRangeSelect.value;
                if (currentValue !== '__none__') {
                    applyPresetTimeRange(currentValue);
                } else {
                    applyCustomRange();
                }
            } else {
                // Re-apply without rounding
                const currentValue = timeRangeSelect.value;
                if (currentValue !== '__none__') {
                    applyPresetTimeRange(currentValue);
                } else {
                    applyCustomRange();
                }
            }
        });
    }

    // Round end mode change handler
    if (roundEndMode) {
        roundEndMode.addEventListener('change', () => {
            localStorage.setItem(ROLL_END_MODE_KEY, roundEndMode.value);
            // Re-apply current range with new rounding
            const currentValue = timeRangeSelect.value;
            if (currentValue !== '__none__') {
                applyPresetTimeRange(currentValue);
            } else {
                applyCustomRange();
            }
        });
    }

    // Theme toggle button
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    // Comparison toggle
    const enableComparisonCheckbox = document.getElementById('enable-comparison');
    if (enableComparisonCheckbox) {
        enableComparisonCheckbox.addEventListener('change', toggleComparisonControls);
    }

    const fetchAccountsBtn = document.getElementById('fetch-accounts-btn');
    const updateChartBtn = document.getElementById('update-chart-btn');
    const refreshDataBtn = document.getElementById('refresh-data-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const toggleAccountsBtn = document.getElementById('toggle-accounts-btn');
    const app = document.getElementById('app');

    // Build type filter pills
    const typeFilterPills = document.getElementById('type-filter-pills');
    const allPill = document.createElement('button');
    allPill.type = 'button';
    allPill.className = 'type-pill active';
    allPill.textContent = 'All';
    allPill.dataset.type = 'all';
    typeFilterPills.appendChild(allPill);

    CONFIG.accountTypes.forEach(type => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'type-pill';
        pill.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        pill.dataset.type = type;
        typeFilterPills.appendChild(pill);
    });

    // Pill click handler
    typeFilterPills.addEventListener('click', (e) => {
        const pill = e.target.closest('.type-pill');
        if (!pill) return;

        const type = pill.dataset.type;

        if (type === 'all') {
            // Select all, deselect others
            selectedTypes.clear();
            selectedTypes.add('all');
            typeFilterPills.querySelectorAll('.type-pill').forEach(p => p.classList.add('active'));
        } else {
            // Deselect "all"
            selectedTypes.delete('all');
            allPill.classList.remove('active');

            // Toggle this pill
            pill.classList.toggle('active');
            if (pill.classList.contains('active')) {
                selectedTypes.add(type);
            } else {
                selectedTypes.delete(type);
            }

            // If no types selected, select all
            if (selectedTypes.size === 0) {
                selectedTypes.add(type);
                pill.classList.add('active');
            }
        }
    });

    // Account search input
    const searchInput = document.getElementById('account-search-input');
    let searchTimeout = null;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.account-card').forEach(card => {
                const name = card.querySelector('.account-name')?.textContent.toLowerCase() || '';
                card.style.display = name.includes(query) ? 'flex' : 'none';
            });
        }, 300);
    });

    // Advanced options toggle
    const advancedOptions = document.getElementById('advanced-options');
    const toggleAdvancedBtn = document.createElement('button');
    toggleAdvancedBtn.type = 'button';
    toggleAdvancedBtn.className = 'more-options-toggle';
    toggleAdvancedBtn.id = 'toggle-advanced-btn';
    toggleAdvancedBtn.textContent = 'Show advanced options';
    advancedOptions.prepend(toggleAdvancedBtn);

    let advancedVisible = false;
    toggleAdvancedBtn.addEventListener('click', () => {
        advancedVisible = !advancedVisible;
        advancedOptions.classList.toggle('visible', advancedVisible);
        toggleAdvancedBtn.textContent = advancedVisible ? 'Hide advanced options' : 'Show advanced options';
    });

    // Set default dates (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    document.getElementById('end-date').valueAsDate = endDate;
    document.getElementById('start-date').valueAsDate = startDate;

    app.innerHTML = '<div class="loading">Select a type and click "Fetch Accounts" to begin.</div>';

    fetchAccountsBtn.addEventListener('click', fetchAccounts);
    updateChartBtn.addEventListener('click', fetchChartData);
    refreshDataBtn.addEventListener('click', refreshData);
    selectAllBtn.addEventListener('click', selectAllAccounts);
    deselectAllBtn.addEventListener('click', deselectAllAccounts);
    toggleAccountsBtn.addEventListener('click', toggleAccountsSection);

    // Budget select/deselect buttons
    const selectAllBudgetsBtn = document.getElementById('select-all-budgets-btn');
    const deselectAllBudgetsBtn = document.getElementById('deselect-all-budgets-btn');
    if (selectAllBudgetsBtn) {
        selectAllBudgetsBtn.addEventListener('click', selectAllBudgets);
    }
    if (deselectAllBudgetsBtn) {
        deselectAllBudgetsBtn.addEventListener('click', deselectAllBudgets);
    }

    // Load and render groups
    loadGroups();
    groupsLoadedPromise = fetchGroups().then(backendGroups => {
        if (backendGroups.length > 0) {
            groups = backendGroups.map(bg => {
                const existing = groups.find(g => g.id === bg.id);
                return existing ? { ...bg, _checked: existing._checked } : bg;
            });
        }
        renderGroups();
    });

    document.getElementById('create-group-btn').addEventListener('click', () => openGroupModal());

    document.getElementById('group-modal').addEventListener('click', (e) => {
        if (e.target.id === 'group-modal' || e.target.classList.contains('modal-close')) {
            closeGroupModal();
        }
    });
    document.getElementById('group-modal-cancel').addEventListener('click', closeGroupModal);
    document.getElementById('group-modal-save').addEventListener('click', handleGroupSave);

    // Handle chart mode change
    document.querySelectorAll('input[name="chart-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'split' && radio.checked) {
                // When switching to split mode, if no accounts are selected,
                // select all accounts by default to ensure the graph shows something
                const selected = document.querySelectorAll('.account-select:checked');
                if (selected.length === 0) {
                    selectAllAccounts();
                }
            }
            fetchChartData();
        });
    });

    // Budget state
    let allBudgets = [];

    async function fetchBudgets() {
        try {
            const response = await fetch('/api/budgets/list');
            if (!response.ok) {
                console.warn('Failed to load budgets:', response.status);
                return;
            }
            allBudgets = await response.json();
            renderBudgets();
        } catch (e) {
            console.warn('Failed to load budgets:', e);
        }
    }

    function renderBudgets() {
        const container = document.getElementById('budgets-list');
        if (!container || !allBudgets.length) return;

        let html = '<div class="account-list">';
        allBudgets.forEach(budget => {
            html += `
                <div class="account-card">
                    <input type="checkbox" class="budget-select" value="${budget.id}" data-name="${budget.name}">
                    <div class="account-info">
                        <span class="account-name">${budget.name}</span>
                        ${budget.active ? '<span class="account-type-tag active">Active</span>' : '<span class="account-type-tag inactive">Inactive</span>'}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function selectAllBudgets() {
        document.querySelectorAll('.budget-select').forEach(cb => cb.checked = true);
    }

    function deselectAllBudgets() {
        document.querySelectorAll('.budget-select').forEach(cb => cb.checked = false);
    }

    // Handle widget type change
    const widgetTypeSelect = document.getElementById('widget-type-select');
    if (widgetTypeSelect) {
        widgetTypeSelect.addEventListener('change', async () => {
            const widgetType = widgetTypeSelect.value;
            const chartTitle = document.getElementById('chart-title');
            if (chartTitle) {
                const titles = {
                    'balance': 'Account Balance History',
                    'earned_spent': 'Earned vs Spent',
                    'expenses_by_category': 'Expenses by Category',
                    'net_worth': 'Net Worth',
                    'budget_spent': 'Budget Spent Over Time'
                };
                chartTitle.textContent = titles[widgetType] || 'Account Balance History';
            }
            // Toggle earned chart type selector visibility
            const earnedSelector = document.getElementById('earned-chart-type-selector');
            if (earnedSelector) {
                earnedSelector.style.display = widgetType === 'earned_spent' ? 'flex' : 'none';
            }
            // Toggle budgets section visibility
            const budgetsSection = document.getElementById('budgets-section');
            if (budgetsSection) {
                budgetsSection.style.display = widgetType === 'budget_spent' ? 'block' : 'none';
                if (widgetType === 'budget_spent' && allBudgets.length === 0) {
                    await fetchBudgets();
                }
            }
            fetchChartData();
        });
    }

    // Handle earned chart type change
    document.querySelectorAll('input[name="earned-chart-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            fetchChartData();
        });
    });

    // Load saved lists dropdown

    // Auto-fetch accounts if configured
    if (CONFIG.autoFetchAccounts) {
        console.log('Auto-fetch enabled, fetching accounts...');
        fetchAccounts().then(() => {
            fetchChartData();
        });
    }

    // Save graph as widget
    const saveGraphBtn = document.getElementById('save-graph-btn');
    if (saveGraphBtn) {
        saveGraphBtn.addEventListener('click', saveGraphAsWidget);
    }

    // Percentage change toggle
    const showPctToggle = document.getElementById('show-pct-toggle');
    const pctModeSelect = document.getElementById('pct-mode-select');

    if (showPctToggle) {
        showPctToggle.addEventListener('change', () => {
            pctEnabled = showPctToggle.checked;
            if (pctModeSelect) {
                pctModeSelect.style.display = pctEnabled ? 'inline-block' : 'none';
            }
            if (balanceChart) {
                balanceChart.update();
            }
        });
    }

    if (pctModeSelect) {
        pctModeSelect.addEventListener('change', () => {
            pctMode = pctModeSelect.value;
            savePctMode();
            if (balanceChart) {
                balanceChart.update();
            }
        });
        // Restore saved mode
        pctModeSelect.value = pctMode;
    }

    // Forecast toggle
    const enableForecastEl = document.getElementById('enable-forecast');
    const forecastDaysEl = document.getElementById('forecast-days');
    const FORECAST_KEY = 'oxidize_forecast_enabled';
    const FORECAST_DAYS_KEY = 'oxidize_forecast_days';

    let forecastEnabled = localStorage.getItem(FORECAST_KEY) === 'true';
    let forecastDays = parseInt(localStorage.getItem(FORECAST_DAYS_KEY), 10) || 30;

    if (enableForecastEl) {
        enableForecastEl.checked = forecastEnabled;
        enableForecastEl.addEventListener('change', () => {
            forecastEnabled = enableForecastEl.checked;
            localStorage.setItem(FORECAST_KEY, forecastEnabled);
            if (balanceChart) {
                balanceChart.update();
            }
        });
    }

    if (forecastDaysEl) {
        forecastDaysEl.value = forecastDays;
        forecastDaysEl.addEventListener('change', () => {
            forecastDays = parseInt(forecastDaysEl.value, 10) || 30;
            localStorage.setItem(FORECAST_DAYS_KEY, forecastDays);
            if (balanceChart) {
                balanceChart.update();
            }
        });
    }
});
