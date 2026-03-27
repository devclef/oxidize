let allAccounts = [];
let balanceChart = null;
const SAVED_LISTS_KEY = 'firefly_saved_account_lists';

async function fetchAccounts() {
    const app = document.getElementById('app');
    const typeFilter = document.getElementById('type-filter');
    const selectedTypes = Array.from(typeFilter.selectedOptions).map(opt => opt.value);

    app.innerHTML = '<div class="loading">Loading accounts...</div>';

    try {
        // If 'all' is selected or nothing is selected, fetch all accounts
        if (selectedTypes.length === 0 || selectedTypes.includes('all')) {
            const response = await fetch('/api/accounts');
            if (!response.ok) {
                throw new Error(`Error: ${response.status} ${response.statusText}`);
            }
            allAccounts = await response.json();
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

    // Get date range and interval
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const interval = document.getElementById('interval-select').value;

    try {
        const params = new URLSearchParams();

        if (selectedIds.length > 0) {
            selectedIds.forEach(id => params.append('accounts[]', id));
        }

        if (startDate) params.append('start', startDate);
        if (endDate) params.append('end', endDate);
        if (interval && interval !== 'auto') params.append('period', interval);

        let url = '/api/accounts/balance-history';
        if (params.toString()) {
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

function getSavedLists() {
    const saved = localStorage.getItem(SAVED_LISTS_KEY);
    return saved ? JSON.parse(saved) : {};
}

function saveListToStorage(name, accountIds) {
    const lists = getSavedLists();
    lists[name] = accountIds;
    localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists));
}

function deleteListFromStorage(name) {
    const lists = getSavedLists();
    delete lists[name];
    localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists));
}

function updateSavedListsDropdown() {
    const select = document.getElementById('saved-lists-select');
    const lists = getSavedLists();

    select.innerHTML = '<option value="">-- Select saved list --</option>';
    Object.keys(lists).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

function saveCurrentSelection() {
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

    saveListToStorage(listName, {
        ids: selectedIds,
        accounts: selectedAccounts,
        savedAt: new Date().toISOString()
    });
    updateSavedListsDropdown();
    document.getElementById('list-name-input').value = '';
    alert(`Saved list "${listName}" with ${selectedIds.length} accounts`);
}

async function loadSavedList() {
    const select = document.getElementById('saved-lists-select');
    const listName = select.value;

    if (!listName) {
        alert('Please select a list to load');
        return;
    }

    const lists = getSavedLists();
    const listData = lists[listName];

    if (!listData) {
        alert('List not found');
        return;
    }

    // Handle both old format (array of IDs) and new format (object with ids)
    const accountIds = Array.isArray(listData) ? listData : listData.ids;

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

function deleteSavedList() {
    const select = document.getElementById('saved-lists-select');
    const listName = select.value;

    if (!listName) {
        alert('Please select a list to delete');
        return;
    }

    if (confirm(`Delete list "${listName}"?`)) {
        deleteListFromStorage(listName);
        updateSavedListsDropdown();
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const fetchAccountsBtn = document.getElementById('fetch-accounts-btn');
    const updateChartBtn = document.getElementById('update-chart-btn');
    const saveListBtn = document.getElementById('save-list-btn');
    const loadListBtn = document.getElementById('load-list-btn');
    const deleteListBtn = document.getElementById('delete-list-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const toggleAccountsBtn = document.getElementById('toggle-accounts-btn');
    const app = document.getElementById('app');

    // Set default dates (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    document.getElementById('end-date').valueAsDate = endDate;
    document.getElementById('start-date').valueAsDate = startDate;

    app.innerHTML = '<div class="loading">Select a type and click "Fetch Accounts" to begin.</div>';

    fetchAccountsBtn.addEventListener('click', fetchAccounts);
    updateChartBtn.addEventListener('click', fetchChartData);
    saveListBtn.addEventListener('click', saveCurrentSelection);
    loadListBtn.addEventListener('click', loadSavedList);
    deleteListBtn.addEventListener('click', deleteSavedList);
    selectAllBtn.addEventListener('click', selectAllAccounts);
    deselectAllBtn.addEventListener('click', deselectAllAccounts);
    toggleAccountsBtn.addEventListener('click', toggleAccountsSection);

    // Load saved lists dropdown
    updateSavedListsDropdown();

    // Initial chart load
    fetchChartData();
});
