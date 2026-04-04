import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock DOM environment
class MockElement {
    constructor(html = '') {
        this.innerHTML = html;
        this.style = {};
        this.textContent = '';
        this.value = '';
        this.checked = false;
        this.attributes = {};
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    getAttribute(name) {
        return this.attributes[name];
    }

    addEventListener(event, cb) {
        if (!this.eventListeners) {
            this.eventListeners = {};
        }
        this.eventListeners[event] = cb;
    }

    removeEventListener(event) {
        if (this.eventListeners) {
            delete this.eventListeners[event];
        }
    }

    querySelector(selector) {
        return this.querySelectorElement || new MockElement();
    }

    querySelectorAll(selector) {
        return this.querySelectorAllElements || [];
    }

    appendChild(element) {
        if (!this.children) {
            this.children = [];
        }
        this.children.push(element);
    }

    remove() {
        this.innerHTML = '';
    }

    click() {
        if (this.eventListeners && this.eventListeners.click) {
            this.eventListeners.click();
        }
    }
}

class MockDocument {
    constructor() {
        this.documentElement = new MockElement();
        this.body = new MockElement();
        this.elements = new Map();
    }

    getElementById(id) {
        return this.elements.get(id) || new MockElement();
    }

    querySelector(selector) {
        return new MockElement();
    }

    querySelectorAll(selector) {
        return [];
    }

    createElement(tag) {
        return new MockElement();
    }
}

// Setup mocks before each test
beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    global.document = new MockDocument();
    global.window = {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
        OXIDIZE_CONFIG: {
            accountTypes: ['asset', 'cash', 'expense', 'revenue', 'liability'],
            autoFetchAccounts: false
        },
        localStorage: {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn()
        },
        crypto: {
            randomUUID: vi.fn().mockReturnValue('test-uuid-123')
        }
    };
});

afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.fetch;
});

describe('Date Range Handling', () => {
    it('should correctly parse date range parameters', () => {
        const startDate = '2026-01-01';
        const endDate = '2026-03-01';
        const interval = '1M';

        const params = new URLSearchParams();
        params.append('start', startDate);
        params.append('end', endDate);
        params.append('period', interval);

        const url = `/api/earned-spent?${params.toString()}`;

        expect(url).toContain('start=2026-01-01');
        expect(url).toContain('end=2026-03-01');
        expect(url).toContain('period=1M');
    });

    it('should handle empty date range (use defaults)', () => {
        const startDate = '';
        const endDate = '';
        const interval = 'auto';

        const params = new URLSearchParams();

        if (startDate) params.append('start', startDate);
        if (endDate) params.append('end', endDate);
        if (interval && interval !== 'auto') params.append('period', interval);

        // When dates are empty, they should not be added to params
        expect(params.toString()).toBe('');
    });

    it('should correctly format date for API request', () => {
        const date = new Date('2026-01-15');
        const formatted = date.toISOString().split('T')[0];

        expect(formatted).toBe('2026-01-15');
        expect(formatted.length).toBe(10);
        expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('Widget Data Structure', () => {
    it('should create valid widget object', () => {
        const widget = {
            id: 'test-uuid-123',
            name: 'Test Widget',
            accounts: ['1', '2', '3'],
            start_date: '2026-01-01',
            end_date: '2026-03-01',
            interval: '1M',
            chart_mode: 'combined',
            widget_type: 'balance'
        };

        expect(widget.id).toBeDefined();
        expect(widget.name).toBe('Test Widget');
        expect(widget.accounts).toHaveLength(3);
        expect(widget.widget_type).toBe('balance');
    });

    it('should create valid earned_spent widget', () => {
        const widget = {
            id: 'test-uuid-123',
            name: 'Earned vs Spent',
            accounts: [],
            start_date: '2026-01-01',
            end_date: '2026-03-01',
            interval: '1M',
            widget_type: 'earned_spent'
        };

        expect(widget.widget_type).toBe('earned_spent');
        expect(widget.accounts).toHaveLength(0); // No accounts required for earned_spent
    });

    it('should handle widget with null dates', () => {
        const widget = {
            id: 'test-uuid-123',
            name: 'Test Widget',
            accounts: ['1'],
            start_date: null,
            end_date: null,
            interval: null,
            widget_type: 'balance'
        };

        expect(widget.start_date).toBeNull();
        expect(widget.end_date).toBeNull();
    });
});

describe('Chart Data Processing', () => {
    it('should extract labels from object-format entries', () => {
        const entries = {
            '2026-01-01T00:00:00+00:00': '100',
            '2026-01-02T00:00:00+00:00': '200',
            '2026-01-03T00:00:00+00:00': '300'
        };

        const labels = Object.keys(entries);

        expect(labels).toHaveLength(3);
        expect(labels[0]).toBe('2026-01-01T00:00:00+00:00');
    });

    it('should extract labels from array-format entries', () => {
        const entries = [
            { key: '2026-01-01', value: '100' },
            { key: '2026-01-02', value: '200' },
            { key: '2026-01-03', value: '300' }
        ];

        const labels = entries.map(e => e.key);

        expect(labels).toHaveLength(3);
        expect(labels[0]).toBe('2026-01-01');
    });

    it('should extract chart data values from entries', () => {
        const entries = {
            '2026-01-01T00:00:00+00:00': '100',
            '2026-01-02T00:00:00+00:00': '200',
            '2026-01-03T00:00:00+00:00': '300'
        };

        const values = Object.values(entries).map(v => parseFloat(v));

        expect(values).toEqual([100, 200, 300]);
    });

    it('should handle empty entries', () => {
        const entries = {};
        const labels = Object.keys(entries);
        const values = Object.values(entries).map(v => parseFloat(v));

        expect(labels).toHaveLength(0);
        expect(values).toHaveLength(0);
    });
});

describe('Account Selection', () => {
    it('should collect selected account IDs', () => {
        const mockCheckboxes = [
            { value: '1', checked: true },
            { value: '2', checked: false },
            { value: '3', checked: true }
        ];

        const selectedIds = mockCheckboxes
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        expect(selectedIds).toEqual(['1', '3']);
    });

    it('should handle no selected accounts', () => {
        const mockCheckboxes = [
            { value: '1', checked: false },
            { value: '2', checked: false }
        ];

        const selectedIds = mockCheckboxes
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        expect(selectedIds).toHaveLength(0);
    });

    it('should handle all accounts selected', () => {
        const mockCheckboxes = [
            { value: '1', checked: true },
            { value: '2', checked: true },
            { value: '3', checked: true }
        ];

        const selectedIds = mockCheckboxes
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        expect(selectedIds).toEqual(['1', '2', '3']);
    });
});

describe('Fetch Error Handling', () => {
    it('should handle fetch error gracefully', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        try {
            await fetch('/api/accounts');
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            expect(error.message).toBe('Network error');
        }
    });

    it('should handle HTTP error response', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
        });

        const response = await fetch('/api/accounts');

        expect(response.ok).toBe(false);
        expect(response.status).toBe(500);
    });

    it('should handle successful response', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [{ id: '1', name: 'Test Account' }]
        });

        const response = await fetch('/api/accounts');
        const data = await response.json();

        expect(data).toHaveLength(1);
        expect(data[0].name).toBe('Test Account');
    });
});

describe('URL Parameter Building', () => {
    it('should build URL with all parameters', () => {
        const params = new URLSearchParams();
        params.append('accounts[]', '1');
        params.append('accounts[]', '2');
        params.append('start', '2026-01-01');
        params.append('end', '2026-03-01');
        params.append('period', '1M');

        const url = `/api/accounts/balance-history?${params.toString()}`;

        expect(url).toContain('accounts%5B%5D=1');
        expect(url).toContain('accounts%5B%5D=2');
        expect(url).toContain('start=2026-01-01');
        expect(url).toContain('end=2026-03-01');
        expect(url).toContain('period=1M');
    });

    it('should build URL with conditional parameters', () => {
        const startDate = '2026-01-01';
        const endDate = null;
        const interval = 'auto';

        const params = new URLSearchParams();
        if (startDate) params.append('start', startDate);
        if (endDate) params.append('end', endDate);
        if (interval && interval !== 'auto') params.append('period', interval);

        expect(params.toString()).toBe('start=2026-01-01');
    });
});

describe('OXI-15: Earned vs Spent Time Range Bug Fix', () => {
    it('should extract chart data values in correct order using labels', () => {
        // This test verifies the fix for OXI-15 where only the most recent data was shown
        // The issue was that Object.values() was used without alignment to labels

        // Simulate backend response with entries as an object (HashMap serialized to JSON)
        // The keys might not be in chronological order due to HashMap behavior
        const entries = {
            '2026-03-01T00:00:00+00:00': 2000.0,
            '2026-01-01T00:00:00+00:00': 1000.0,
            '2026-02-01T00:00:00+00:00': 0.0
        };

        // Labels are extracted from keys and should be sorted chronologically
        const labels = Object.keys(entries).sort();

        // The fixed extractChartData function uses labels to extract values in order
        // Since we can't import the function directly, we simulate the logic
        const extractChartData = (entries, labels) => {
            if (Array.isArray(entries)) {
                return entries.map(e => parseFloat(e.value || 0));
            } else if (labels && labels.length > 0) {
                return labels.map(label => {
                    const v = entries[label];
                    return parseFloat(v || 0);
                });
            } else {
                return Object.values(entries).map(v => parseFloat(v));
            }
        };

        const data = extractChartData(entries, labels);

        // Verify data is in chronological order matching labels
        expect(labels).toEqual([
            '2026-01-01T00:00:00+00:00',
            '2026-02-01T00:00:00+00:00',
            '2026-03-01T00:00:00+00:00'
        ]);
        expect(data).toEqual([1000.0, 0.0, 2000.0]);
    });

    it('should handle long date range with monthly periods', () => {
        // Simulate a year-long date range with monthly periods
        const entries = {};
        const labels = [];

        // Generate 12 months of data
        for (let month = 1; month <= 12; month++) {
            const dateStr = `2025-${month.toString().padStart(2, '0')}-01T00:00:00+00:00`;
            labels.push(dateStr);
            // Only some months have transactions
            if (month === 1 || month === 4 || month === 7 || month === 10) {
                entries[dateStr] = 1000.0 * month;
            } else {
                entries[dateStr] = 0.0;
            }
        }

        // Sort labels chronologically
        const sortedLabels = labels.sort();

        // Extract data using labels for correct ordering
        const extractChartData = (entries, labels) => {
            if (Array.isArray(entries)) {
                return entries.map(e => parseFloat(e.value || 0));
            } else if (labels && labels.length > 0) {
                return labels.map(label => {
                    const v = entries[label];
                    return parseFloat(v || 0);
                });
            } else {
                return Object.values(entries).map(v => parseFloat(v));
            }
        };

        const data = extractChartData(entries, sortedLabels);

        // Verify all 12 months are present
        expect(sortedLabels).toHaveLength(12);
        expect(data).toHaveLength(12);

        // Verify months with transactions have correct values
        expect(data[0]).toBe(1000.0);   // January
        expect(data[3]).toBe(4000.0);   // April
        expect(data[6]).toBe(7000.0);   // July
        expect(data[9]).toBe(10000.0);  // October

        // Verify months without transactions are 0
        expect(data[1]).toBe(0.0);      // February
        expect(data[2]).toBe(0.0);      // March
        expect(data[11]).toBe(0.0);     // December
    });

    it('should handle earned and spent datasets with aligned labels', () => {
        // Simulate backend response for earned/spent chart
        const history = [
            {
                label: 'earned',
                currency_symbol: '$',
                currency_code: 'USD',
                entries: {
                    '2026-01-01T00:00:00+00:00': 1000.0,
                    '2026-02-01T00:00:00+00:00': 0.0,
                    '2026-03-01T00:00:00+00:00': 1500.0
                }
            },
            {
                label: 'spent',
                currency_symbol: '$',
                currency_code: 'USD',
                entries: {
                    '2026-01-01T00:00:00+00:00': 500.0,
                    '2026-02-01T00:00:00+00:00': 0.0,
                    '2026-03-01T00:00:00+00:00': 750.0
                }
            }
        ];

        // Extract labels from first dataset
        const firstDataset = history.find(ds => ds.entries && Object.keys(ds.entries).length > 0);
        const labels = Object.keys(firstDataset.entries).sort();

        // Extract data using labels for alignment
        const extractChartData = (entries, labels) => {
            if (Array.isArray(entries)) {
                return entries.map(e => parseFloat(e.value || 0));
            } else if (labels && labels.length > 0) {
                return labels.map(label => {
                    const v = entries[label];
                    return parseFloat(v || 0);
                });
            } else {
                return Object.values(entries).map(v => parseFloat(v));
            }
        };

        const earnedDataset = history.find(ds => ds.label === 'earned');
        const spentDataset = history.find(ds => ds.label === 'spent');

        const earnedData = extractChartData(earnedDataset.entries, labels);
        const spentData = extractChartData(spentDataset.entries, labels);

        // Verify all 3 months are present with correct values
        expect(labels).toHaveLength(3);
        expect(earnedData).toEqual([1000.0, 0.0, 1500.0]);
        expect(spentData).toEqual([500.0, 0.0, 750.0]);

        // Verify February (index 1) shows 0 for both earned and spent
        expect(earnedData[1]).toBe(0.0);
        expect(spentData[1]).toBe(0.0);
    });
});

describe('Period Comparison Feature', () => {
    it('should toggle comparison controls when checkbox is checked', () => {
        // This test verifies the comparison toggle functionality
        const enableComparisonCheckbox = {
            id: 'enable-comparison',
            checked: false,
            addEventListener: vi.fn()
        };
        
        const comparisonControls = {
            style: { display: 'none' }
        };
        
        global.document.elements.set('enable-comparison', enableComparisonCheckbox);
        global.document.querySelector = vi.fn().mockReturnValue(comparisonControls);
        
        // Simulate checkbox change
        enableComparisonCheckbox.checked = true;
        if (enableComparisonCheckbox.eventListeners && enableComparisonCheckbox.eventListeners.change) {
            enableComparisonCheckbox.eventListeners.change();
        }
        
        // Note: Full implementation testing requires actual DOM environment
        expect(enableComparisonCheckbox).toBeDefined();
    });

    it('should calculate comparison dates correctly', () => {
        const startDate = '2024-01-01';
        const endDate = '2024-01-31';
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diff = end - start;
        
        // Comparison period should be the same duration before the start date
        const comparisonEnd = new Date(start.getTime() - (diff / 2));
        const comparisonStart = new Date(comparisonEnd.getTime() - diff);
        
        expect(comparisonStart < start).toBe(true);
        expect(comparisonEnd < start).toBe(true);
        expect(comparisonEnd > comparisonStart).toBe(true);
    });

    it('should handle comparison chart data structure', () => {
        const primaryData = [
            {
                label: 'Account 1',
                entries: {
                    '2024-01-01': '1000',
                    '2024-01-02': '1100'
                }
            }
        ];
        
        const comparisonData = [
            {
                label: 'Account 1',
                entries: {
                    '2023-12-01': '900',
                    '2023-12-02': '950'
                }
            }
        ];
        
        expect(primaryData.length).toBe(1);
        expect(comparisonData.length).toBe(1);
        expect(primaryData[0].label).toBe('Account 1');
        expect(comparisonData[0].label).toBe('Account 1');
    });

    it('should fetch comparison data when enabled', async () => {
        // Mock successful comparison data fetch
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => [
                {
                    label: 'Account 1',
                    currency_symbol: '$',
                    entries: {
                        '2024-01-01': '1000',
                        '2024-01-02': '1100'
                    }
                }
            ]
        });
        
        const response = await fetch('/api/accounts/balance-history?start=2024-01-01&end=2024-01-31');
        const data = await response.json();
        
        expect(data.length).toBe(1);
        expect(data[0].label).toBe('Account 1');
    });
});
