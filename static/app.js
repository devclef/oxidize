let allAccounts = [];
let balanceChart = null;
let enableComparison = false;
const SAVED_LISTS_KEY = 'firefly_saved_account_lists';
const DASHBOARD_WIDGETS_KEY = 'oxidize_dashboard_widgets';

// UUID polyfill for browsers that don't support crypto.randomUUID
function generateUUID() {
    if (crypto.randomUUID) {
        return generateUUID();
    }
    // Fallback implementation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Get config from server or use defaults
const CONFIG = window.OXIDIZE_CONFIG || {
    accountTypes: ['asset', 'cash', 'expense', 'revenue', 'liability'],
    autoFetchAccounts: false
};

// Theme management
const THEME_KEY = 'oxidize_theme';

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

    // Update chart colors if chart exists
    if (balanceChart) {
        updateChartTheme(newTheme);
    }
}

function showSunIcon() {
    document.getElementById('theme-icon-sun').style.display = 'block';
    document.getElementById('theme-icon-moon').style.display = 'none';
}

function showMoonIcon() {
    document.getElementById('theme-icon-sun').style.display = 'none';
    document.getElementById('theme-icon-moon').style.display = 'block';
}

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
    const typeFilter = document.getElementById('type-filter');
    const selectedTypes = Array.from(typeFilter.selectedOptions).map(opt => opt.value);

    app.innerHTML = '<div class="loading">Loading accounts...</div>';

    try {
        // If 'all' is selected or nothing is selected, fetch all configured account types
        if (selectedTypes.length === 0 || selectedTypes.includes('all')) {
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
            for (const type of selectedTypes) {
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
            return;
        }

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
    const chartContainer = document.querySelector('.chart-container');
    const chartError = document.getElementById('chart-error');
    const chartMode = document.querySelector('input[name="chart-mode"]:checked')?.value || 'combined';

    // Clear previous errors
    chartError.innerHTML = '';

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
                chartError.innerHTML = '<div class="info">No earned/spent data found for the current date range.</div>';
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
                chartError.innerHTML = '<div class="info">No expenses by category data found for the current date range.</div>';
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
                chartError.innerHTML = '<div class="info">No net worth data found for the current date range.</div>';
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
            chartError.innerHTML = '<div class="info">No balance history data found for the current selection and date range.</div>';
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
        chartError.innerHTML = `<div class="error">Failed to load chart data: ${error.message}</div>`;
    }
}

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
function renderEarnedSpentChart(ctx, history) {
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
        const dateA = new Date(labels[a]);
        const dateB = new Date(labels[b]);
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
                            const date = new Date(value);
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

function renderChart(history, widgetType = 'balance') {
    const ctx = document.getElementById('balanceChart').getContext('2d');
    const chartMode = document.querySelector('input[name="chart-mode"]:checked')?.value || 'combined';

    // For earned_spent widget type, render as a bar chart
    if (widgetType === 'earned_spent') {
        renderEarnedSpentChart(ctx, history);
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
    const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
    if (firstDataset) {
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key || e.date || e.timestamp);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }

    if (labels.length === 0) {
        console.warn('No labels found in chart data');
        chartError.innerHTML = '<div class="error">No data points found for the selected date range.</div>';
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

    // Generate colors for accounts
    accountColors = generateColors(uniqueAccountInfo.length);

    // Initialize visibility tracking by index - all visible by default
    uniqueAccountInfo.forEach((info, index) => {
        datasetVisibility[index] = true;
    });

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
            // Create individual datasets for each account
            // The backend now returns per-account data with account name as the label
            currentDatasets = uniqueAccountInfo.map((info, index) => {
                // Find the dataset for this account by matching the account name
                // Use normalization to handle potential (In)/(Out) suffixes
                const dataset = filteredHistory.find(ds => {
                    const normalizedDsLabel = ds.label
                        .replace(/ - In$/, '')
                        .replace(/ - Out$/, '')
                        .replace(/ \(In\)$/, '')
                        .replace(/ \(Out\)$/, '')
                        .replace(/ Income$/, '')
                        .replace(/ Expense$/, '')
                        .replace(/ Earned$/, '')
                        .replace(/ Spent$/, '');
                    return normalizedDsLabel === info.name || ds.label === info.name;
                });

                if (!dataset) {
                    console.warn(`No data found for account: ${info.name}`);
                    // No data for this account, return empty dataset
                    return {
                        label: info.name,
                        data: new Array(labels.length).fill(null),
                        borderColor: accountColors[index].border,
                        backgroundColor: accountColors[index].background,
                        borderWidth: 2,
                        tension: 0.1,
                        fill: false
                    };
                }

                console.log(`Found dataset for: ${info.name}`);

                // Get flow data from the dataset
                let datasetFlowData = [];
                if (Array.isArray(dataset.entries)) {
                    datasetFlowData = dataset.entries.map(e => {
                        const val = e.value || e.amount || e.balance || 0;
                        return parseFloat(val);
                    });
                } else {
                    datasetFlowData = Object.values(dataset.entries).map(v => {
                        if (typeof v === 'object' && v !== null) {
                            return parseFloat(v.value || v.amount || v.balance || 0);
                        }
                        return parseFloat(v);
                    });
                }
                console.log(`Dataset "${dataset.label}" flowData:`, datasetFlowData);

                // Determine if the data is absolute balance or flow.
                // Firefly III's chart/account/overview endpoint returns balance snapshots (absolute),
                // except for "earned" and "spent" which are flow data.
                const lastValue = datasetFlowData[datasetFlowData.length - 1];
                const anchorBalance = parseFloat(info.balance);

                // "earned" and "spent" are always flow data
                const isFlowLabel = info.name === 'earned' || info.name === 'spent';

                let isAbsolute;
                if (isFlowLabel) {
                    isAbsolute = false;
                } else {
                    // For account datasets, assume absolute balance unless clear evidence otherwise.
                    // Check if data looks like flow: all values are small and same-sign (typical for transactions)
                    const allPositive = datasetFlowData.every(v => v >= 0);
                    const allNegative = datasetFlowData.every(v => v <= 0);
                    const maxAbsValue = Math.max(...datasetFlowData.map(Math.abs));

                    // If all values are same-sign and relatively small, might be flow data
                    // But only if the last value is also very different from anchor
                    const relativeDiff = anchorBalance !== 0 ? Math.abs(lastValue - anchorBalance) / Math.abs(anchorBalance) : Infinity;

                    // Heuristic: treat as flow only if:
                    // 1. All values are same sign (typical for earned/spent type flows)
                    // 2. Values are small relative to anchor (transactions vs balances)
                    // 3. Last value is significantly different from anchor
                    const looksLikeFlow = (allPositive || allNegative) && maxAbsValue < Math.abs(anchorBalance) * 0.1 && relativeDiff > 0.5;

                    isAbsolute = !looksLikeFlow;
                }

                console.log(`Account ${info.name}: lastValue=${lastValue}, anchorBalance=${anchorBalance}, isAbsolute=${isAbsolute}`);

                let absoluteData;
                if (isAbsolute) {
                    absoluteData = datasetFlowData;
                } else {
                    // Calculate absolute running balance backwards from the anchor balance
                    absoluteData = new Array(datasetFlowData.length);
                    let runningBalance = anchorBalance;
                    for (let i = datasetFlowData.length - 1; i >= 0; i--) {
                        absoluteData[i] = runningBalance;
                        runningBalance -= datasetFlowData[i];
                    }
                }
                console.log(`Account ${info.name}: absoluteData=`, absoluteData.slice(0, 5), '...');

                return {
                    label: info.name,
                    data: absoluteData,
                    borderColor: accountColors[index].border,
                    backgroundColor: accountColors[index].background,
                    borderWidth: 2,
                    tension: 0.1,
                    fill: false
                };
            });
        }

        // Apply visibility settings to datasets
        currentDatasets.forEach((dataset, index) => {
            dataset.hidden = !datasetVisibility[index];
        });

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const chartTextColor = isDark ? '#eaeaea' : '#333';
        const chartGridColor = isDark ? '#444' : '#ddd';

        balanceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
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
        renderSplitLegend(uniqueAccountInfo, currentDatasets);
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

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const chartTextColor = isDark ? '#eaeaea' : '#333';
        const chartGridColor = isDark ? '#444' : '#ddd';
        const color = isDark ? '#5dade2' : '#3498db';

        const chartDatasets = [{
            label: 'Total Balance',
            data: absoluteData,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            tension: 0.1,
            fill: true
        }];

        balanceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
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

function renderSplitLegend(accountInfo, datasets) {
    const legendContainer = document.getElementById('split-legend');
    const legendItems = document.getElementById('legend-items');
    const chartError = document.getElementById('chart-error');

    // Clear previous legend
    legendItems.innerHTML = '';

    if (accountInfo.length === 0) {
        legendContainer.style.display = 'none';
        return;
    }

    legendContainer.style.display = 'block';
    chartError.style.display = 'none';

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

async function getSavedLists() {
    try {
        const response = await fetch('/api/saved-lists');
        if (!response.ok) return [];
        return await response.json();
    } catch (e) {
        console.error('Failed to fetch saved lists:', e);
        return [];
    }
}

async function saveListToStorage(list) {
    try {
        const response = await fetch('/api/saved-lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(list)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to save list');
        }
        return response.json();
    } catch (e) {
        console.error('Failed to save list:', e);
        throw e;
    }
}

async function deleteListFromStorage(id) {
    try {
        const response = await fetch(`/api/saved-lists/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to delete list');
        }
    } catch (e) {
        console.error('Failed to delete list:', e);
        throw e;
    }
}

async function updateSavedListsDropdown() {
    const select = document.getElementById('saved-lists-select');
    const lists = await getSavedLists();

    select.innerHTML = '<option value="">-- Select saved list --</option>';
    lists.forEach(list => {
        const option = document.createElement('option');
        option.value = list.id;
        option.textContent = list.name;
        select.appendChild(option);
    });
}

async function saveCurrentSelection() {
    const listName = document.getElementById('list-name-input').value.trim();
    if (!listName) {
        alert('Please enter a name for the list');
        return;
    }

    const selectedCheckboxes = document.querySelectorAll('.account-select:checked');
    const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
        alert('Please select at least one account');
        return;
    }

    // Also save account details for reference
    const selectedAccounts = selectedIds.map(id => {
        const account = allAccounts.find(a => a.id === id);
        return {
            id: id,
            name: account ? account.name : 'Unknown',
            type: account ? account.account_type : 'Unknown'
        };
    });

    const list = {
        id: generateUUID(),
        name: listName,
        accounts: {
            ids: selectedIds,
            accounts: selectedAccounts,
            savedAt: new Date().toISOString()
        },
        created_at: new Date().toISOString()
    };

    try {
        await saveListToStorage(list);
        await updateSavedListsDropdown();
        document.getElementById('list-name-input').value = '';
        alert(`Saved list "${listName}" with ${selectedIds.length} accounts`);
    } catch (e) {
        alert(`Failed to save list: ${e.message}`);
    }
}

async function loadSavedList() {
    const select = document.getElementById('saved-lists-select');
    const listId = select.value;

    if (!listId) {
        alert('Please select a list to load');
        return;
    }

    const lists = await getSavedLists();
    const listData = lists.find(l => l.id === listId);

    if (!listData) {
        alert('List not found');
        return;
    }

    // Extract account IDs from the stored data
    const accountData = listData.accounts;
    const accountIds = accountData.ids || (Array.isArray(accountData) ? accountData : []);

    // Fetch all accounts if we don't have any loaded
    if (allAccounts.length === 0) {
        await fetchAccounts();
    }

    // Uncheck all checkboxes first
    document.querySelectorAll('.account-select').forEach(cb => cb.checked = false);

    // Check the saved accounts
    let foundCount = 0;
    accountIds.forEach(id => {
        const checkbox = document.querySelector(`.account-select[value="${id}"]`);
        if (checkbox) {
            checkbox.checked = true;
            foundCount++;
        }
    });

    if (foundCount === 0) {
        alert('None of the accounts in this list were found. You may need to fetch accounts first.');
    } else if (foundCount < accountIds.length) {
        alert(`Loaded ${foundCount} of ${accountIds.length} accounts from the list.`);
    }
}

async function deleteSavedList() {
    const select = document.getElementById('saved-lists-select');
    const listId = select.value;

    if (!listId) {
        alert('Please select a list to delete');
        return;
    }

    const lists = await getSavedLists();
    const listData = lists.find(l => l.id === listId);

    if (!listData) {
        alert('List not found');
        return;
    }

    if (confirm(`Delete list "${listData.name}"?`)) {
        try {
            await deleteListFromStorage(listId);
            await updateSavedListsDropdown();
        } catch (e) {
            alert(`Failed to delete list: ${e.message}`);
        }
    }
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

    // Only balance widget type requires accounts
    if (widgetType === 'balance' && selectedIds.length === 0) {
        alert('Please select at least one account');
        return;
    }

    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const interval = document.getElementById('interval-select').value;
    const interval = document.getElementById('interval-select').value;

    // Get comparison dates if enabled
    const comparisonStartDate = enableComparison ? document.getElementById('comparison-start-date').value : null;
    const comparisonEndDate = enableComparison ? document.getElementById('comparison-end-date').value : null;
    const chartMode = document.querySelector('input[name="chart-mode"]:checked')?.value || 'combined';

    const widget = {
        id: generateUUID(),
        name: widgetName,
        accounts: selectedIds,
        start_date: startDate || null,
        end_date: endDate || null,
        interval: interval || null,
        chart_mode: chartMode,
        widget_type: widgetType
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
        btn.textContent = '▼ Collapse';
    } else {
        content.style.display = 'none';
        btn.textContent = '▶ Expand';
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
    const comparisonControls = document.querySelector('.comparison-controls');
    
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
    // Initialize theme
    initTheme();

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
    }

    const fetchAccountsBtn = document.getElementById('fetch-accounts-btn');
    const updateChartBtn = document.getElementById('update-chart-btn');
    const refreshDataBtn = document.getElementById('refresh-data-btn');
    const saveListBtn = document.getElementById('save-list-btn');
    const loadListBtn = document.getElementById('load-list-btn');
    const deleteListBtn = document.getElementById('delete-list-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const toggleAccountsBtn = document.getElementById('toggle-accounts-btn');
    const app = document.getElementById('app');
    const typeFilter = document.getElementById('type-filter');

    // Populate type filter with configured account types
    typeFilter.innerHTML = '<option value="all" selected>All</option>';
    CONFIG.accountTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
        typeFilter.appendChild(option);
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
    saveListBtn.addEventListener('click', saveCurrentSelection);
    loadListBtn.addEventListener('click', loadSavedList);
    deleteListBtn.addEventListener('click', deleteSavedList);
    selectAllBtn.addEventListener('click', selectAllAccounts);
    deselectAllBtn.addEventListener('click', deselectAllAccounts);
    toggleAccountsBtn.addEventListener('click', toggleAccountsSection);

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

    // Handle widget type change
    const widgetTypeSelect = document.getElementById('widget-type-select');
    if (widgetTypeSelect) {
        widgetTypeSelect.addEventListener('change', () => {
            const widgetType = widgetTypeSelect.value;
            const chartTitle = document.getElementById('chart-title');
            if (chartTitle) {
                const titles = {
                    'balance': 'Account Balance History',
                    'earned_spent': 'Earned vs Spent',
                    'expenses_by_category': 'Expenses by Category',
                    'net_worth': 'Net Worth'
                };
                chartTitle.textContent = titles[widgetType] || 'Account Balance History';
            }
            fetchChartData();
        });
    }

    // Load saved lists dropdown
    updateSavedListsDropdown();

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
});
