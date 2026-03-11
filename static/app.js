let allAccounts = [];
let balanceChart = null;

async function fetchAccounts() {
    const app = document.getElementById('app');
    const typeFilter = document.getElementById('type-filter').value;

    app.innerHTML = '<div class="loading">Loading accounts...</div>';

    try {
        let url = '/api/accounts';
        if (typeFilter !== 'all') {
            url += `?type=${typeFilter}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error: ${response.status} ${response.statusText}`);
        }
        const accounts = await response.json();
        allAccounts = accounts; // Store globally for chart calculation

        if (accounts.length === 0) {
            app.innerHTML = '<div class="loading">No accounts found for this filter.</div>';
            return;
        }

        let html = '<div class="account-list">';
        accounts.forEach(account => {
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
    } catch (error) {
        app.innerHTML = `<div class="error">Failed to load accounts: ${error.message}</div>`;
        console.error('Fetch error:', error);
    }
}

async function fetchChartData() {
    const chartContainer = document.querySelector('.chart-container');
    const chartError = document.getElementById('chart-error');

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

    try {
        let url = '/api/accounts/balance-history';
        if (selectedIds.length > 0) {
            const params = new URLSearchParams();
            selectedIds.forEach(id => params.append('accounts[]', id));
            url += `?${params.toString()}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error: ${response.status} ${response.statusText}`);
        }
        const history = await response.json();

        if (!history || history.length === 0) {
            // If we selected specific accounts and got nothing, show error
            if (selectedIds.length > 0) {
                 chartError.innerHTML = '<div class="error">No data returned for selected accounts.</div>';
            } else {
                 chartContainer.style.display = 'none';
            }
            return;
        }

        chartContainer.style.display = 'block';
        renderChart(history);
    } catch (error) {
        console.error('Fetch chart error:', error);
        chartError.innerHTML = `<div class="error">Failed to load chart data: ${error.message}</div>`;
    }
}

function renderChart(history) {
    const ctx = document.getElementById('balanceChart').getContext('2d');

    // Destroy existing chart to avoid memory leaks
    if (balanceChart) {
        balanceChart.destroy();
    }

    // Extract labels from the first dataset that has entries
    let labels = [];
    const firstDataset = history.find(ds => ds.entries && (Array.isArray(ds.entries) ? ds.entries.length > 0 : Object.keys(ds.entries).length > 0));
    if (firstDataset) {
        if (Array.isArray(firstDataset.entries)) {
            labels = firstDataset.entries.map(e => e.key);
        } else {
            labels = Object.keys(firstDataset.entries);
        }
    }

    if (labels.length === 0) return;

    // Aggregate all datasets into a single data series
    const totalFlowData = new Array(labels.length).fill(0);
    let totalAnchorBalance = 0;
    const includedAccounts = new Set();

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

        // Sum the data into the aggregated dataset
        flowData.forEach((val, i) => {
            if (i < totalFlowData.length) {
                totalFlowData[i] += val;
            }
        });

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
        if (account && !includedAccounts.has(account.id)) {
            totalAnchorBalance += parseFloat(account.balance);
            includedAccounts.add(account.id);
        }
    });

    // If no accounts matched (maybe it's a "Net Worth" or "Assets" pre-selection),
    // and we have selected accounts in the UI, use those.
    if (includedAccounts.size === 0) {
        const selectedCheckboxes = document.querySelectorAll('.account-select:checked');
        if (selectedCheckboxes.length > 0) {
            selectedCheckboxes.forEach(cb => {
                const account = allAccounts.find(a => a.id === cb.value);
                if (account) {
                    totalAnchorBalance += parseFloat(account.balance);
                }
            });
        } else {
            // Fallback to all asset accounts if nothing selected
            allAccounts.forEach(account => {
                const type = account.account_type.toLowerCase();
                if (['asset', 'checking', 'savings', 'cash', 'default-asset'].includes(type)) {
                    totalAnchorBalance += parseFloat(account.balance);
                }
            });
        }
    }

    // Determine if the aggregated data is absolute balance or flow
    const lastTotalValue = totalFlowData[totalFlowData.length - 1];
    const isAbsolute = Math.abs(lastTotalValue - totalAnchorBalance) < 1.0;

    let absoluteData;
    if (isAbsolute) {
        absoluteData = totalFlowData;
    } else {
        // Calculate absolute running balance backwards from the anchor balance
        absoluteData = new Array(totalFlowData.length);
        let current = totalAnchorBalance;
        for (let i = totalFlowData.length - 1; i >= 0; i--) {
            absoluteData[i] = current;
            current -= totalFlowData[i];
        }
    }

    const color = '#3498db';

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
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const fetchAccountsBtn = document.getElementById('fetch-accounts-btn');
    const updateChartBtn = document.getElementById('update-chart-btn');
    const app = document.getElementById('app');

    app.innerHTML = '<div class="loading">Select a type and click "Fetch Accounts" to begin.</div>';

    fetchAccountsBtn.addEventListener('click', fetchAccounts);
    updateChartBtn.addEventListener('click', fetchChartData);

    // Initial chart load
    fetchChartData();
});
