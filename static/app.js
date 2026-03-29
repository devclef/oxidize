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

    // Get date range and interval
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const interval = document.getElementById('interval-select').value;

    try {
        const params = new URLSearchParams();

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
        renderChart(history);
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

function renderChart(history) {
    const ctx = document.getElementById('balanceChart').getContext('2d');
    const chartMode = document.querySelector('input[name="chart-mode"]:checked')?.value || 'combined';

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
                // For account-based datasets in Firefly III, they are almost always absolute balances.
                // We use a generous threshold (50% of the value) to account for transactions that
                // occurred since the last chart data point was calculated or for period mismatches.
                const lastValue = datasetFlowData[datasetFlowData.length - 1];
                const anchorBalance = parseFloat(info.balance);
                
                // If the dataset label is "earned" or "spent", it's always flow.
                // Otherwise, for account-named datasets, we check if it's "close enough" to the anchor balance.
                const isFlowLabel = info.name === 'earned' || info.name === 'spent';
                const isAbsolute = !isFlowLabel && (Math.abs(lastValue - anchorBalance) < (Math.abs(lastValue) * 0.5 + 50.0));

                console.log(`Account ${info.name}: lastValue=${lastValue}, anchorBalance=${anchorBalance}, isAbsolute=${isAbsolute}`);

                let absoluteData;
                if (isAbsolute) {
                    absoluteData = datasetFlowData;
                } else {
                    // Calculate absolute running balance backwards from the anchor balance
                    absoluteData = new Array(datasetFlowData.length);
                    let current = parseFloat(info.balance);
                    for (let i = datasetFlowData.length - 1; i >= 0; i--) {
                        absoluteData[i] = current;
                        current -= datasetFlowData[i];
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
        // Similar to the split mode, we use a generous threshold for detection.
        const lastTotalValue = totalFlowData[totalFlowData.length - 1];
        
        // Combined view usually sums account balances, so it should be absolute.
        // We only treat it as flow if the values are very small compared to the anchor balance.
        const isAbsolute = Math.abs(lastTotalValue - totalAnchorBalance) < (Math.abs(lastTotalValue) * 0.5 + 50.0);

        console.log(`Combined Mode: lastTotalValue=${lastTotalValue}, totalAnchorBalance=${totalAnchorBalance}, isAbsolute=${isAbsolute}`);

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

    // Load saved lists dropdown
    updateSavedListsDropdown();

    // Initial chart load
    fetchAccounts().then(() => {
        fetchChartData();
    });
});
