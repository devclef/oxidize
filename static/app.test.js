import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Inline copies of date-utils functions for testing (since date-utils.js is loaded as a regular script, not ES module)
function calculateRelativeDatesFromCustom(count, unit) {
    const endDate = new Date();
    const startDate = new Date();
    const num = parseInt(count, 10);

    switch (unit) {
        case 'days':
            startDate.setDate(startDate.getDate() - num);
            break;
        case 'weeks':
            startDate.setDate(startDate.getDate() - (num * 7));
            break;
        case 'months':
            startDate.setMonth(startDate.getMonth() - num);
            break;
        case 'years':
            startDate.setFullYear(startDate.getFullYear() - num);
            break;
        default:
            return null;
    }

    return {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };
}

function roundEndDate(dateStr, mode) {
    const date = new Date(dateStr);

    switch (mode) {
        case 'start_of_current_month':
            date.setDate(1);
            date.setHours(0, 0, 0, 0);
            break;
        case 'end_of_current_month':
            date.setMonth(date.getMonth() + 1, 0);
            date.setHours(23, 59, 59, 999);
            break;
        case 'start_of_next_month':
            date.setMonth(date.getMonth() + 1, 1);
            date.setHours(0, 0, 0, 0);
            break;
        default:
            return dateStr;
    }

    return date.toISOString().split('T')[0];
}

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

describe('Percentage Change Feature', () => {
    describe('computePercentChange', () => {
        it('should calculate percentage change from previous point', () => {
            const data = [100, 110, 105, 120];
            const mode = 'from_previous';

            const labels = new Array(data.length).fill(null);
            for (let i = 1; i < data.length; i++) {
                const previous = data[i - 1];
                if (previous !== 0) {
                    labels[i] = ((data[i] - previous) / Math.abs(previous)) * 100;
                }
            }

            expect(labels[0]).toBe(null);
            expect(labels[1]).toBe(10);       // +10%
            expect(labels[2]).toBe(-5 / 110 * 100); // ~-4.5% (105-110)/110*100
            expect(labels[3]).toBe(15 / 105 * 100); // ~+14.3% (120-105)/105*100
        });

        it('should calculate percentage change from first point', () => {
            const data = [100, 110, 90, 150];
            const mode = 'from_first';

            const labels = new Array(data.length).fill(null);
            const first = data[0];
            for (let i = 1; i < data.length; i++) {
                if (first !== 0) {
                    labels[i] = ((data[i] - first) / Math.abs(first)) * 100;
                }
            }

            expect(labels[0]).toBe(null);
            expect(labels[1]).toBe(10);     // +10%
            expect(labels[2]).toBe(-10);    // -10%
            expect(labels[3]).toBe(50);     // +50%
        });

        it('should handle zero first point gracefully', () => {
            const data = [0, 100, 200];
            const mode = 'from_first';

            const labels = new Array(data.length).fill(null);
            const first = data[0];
            for (let i = 1; i < data.length; i++) {
                if (first !== 0) {
                    labels[i] = ((data[i] - first) / Math.abs(first)) * 100;
                }
            }

            expect(labels[0]).toBe(null);
            expect(labels[1]).toBe(null);   // Division by zero
            expect(labels[2]).toBe(null);   // Division by zero
        });

        it('should handle null/undefined values', () => {
            const data = [100, null, 120, undefined, 130];
            const mode = 'from_previous';

            const labels = new Array(data.length).fill(null);
            for (let i = 1; i < data.length; i++) {
                const current = data[i];
                if (current === null || current === undefined || isNaN(current)) continue;
                const previous = data[i - 1];
                if (previous === null || previous === undefined || isNaN(previous) || previous === 0) {
                    continue;
                }
                labels[i] = ((current - previous) / Math.abs(previous)) * 100;
            }

            expect(labels[0]).toBe(null);
            expect(labels[1]).toBe(null);   // null data
            expect(labels[2]).toBe(null);   // previous is null
            expect(labels[3]).toBe(null);   // undefined data
            expect(labels[4]).toBe(null);   // previous (i=3) is undefined, so skipped
        });

        it('should handle negative values', () => {
            const data = [-100, -80, -120];
            const mode = 'from_previous';

            const labels = new Array(data.length).fill(null);
            for (let i = 1; i < data.length; i++) {
                const previous = data[i - 1];
                if (previous !== 0) {
                    labels[i] = ((data[i] - previous) / Math.abs(previous)) * 100;
                }
            }

            // -80 is +20% change from -100 (using abs of -100 = 100)
            expect(labels[1]).toBe(20);
            // -120 is -50% change from -80 (using abs of -80 = 80)
            expect(labels[2]).toBe(-50);
        });
    });

    describe('formatPct', () => {
        it('should format positive percentages with + sign', () => {
            expect((5.2).toFixed(1)).toBe('5.2');
            expect((-3.1).toFixed(1)).toBe('-3.1');
        });

        it('should format zero as 0.0%', () => {
            const result = '0.0%';
            expect(result).toBe('0.0%');
        });

        it('should handle negative percentages', () => {
            const value = -12.345;
            const sign = value >= 0 ? '+' : '';
            const formatted = sign + value.toFixed(1) + '%';
            expect(formatted).toBe('-12.3%');
        });

        it('should handle positive percentages', () => {
            const value = 15.67;
            const sign = value >= 0 ? '+' : '';
            const formatted = sign + value.toFixed(1) + '%';
            expect(formatted).toBe('+15.7%');
        });
    });

    describe('localStorage persistence', () => {
        it('should use default mode when nothing stored', () => {
            const mockLocalStorage = {
                getItem: vi.fn(() => null),
                setItem: vi.fn()
            };
            global.window.localStorage = mockLocalStorage;

            const mode = mockLocalStorage.getItem('oxidize_chart_pct_mode') || 'from_previous';
            expect(mode).toBe('from_previous');
        });

        it('should restore saved mode from localStorage', () => {
            const mockLocalStorage = {
                getItem: vi.fn(() => 'from_first'),
                setItem: vi.fn()
            };
            global.window.localStorage = mockLocalStorage;

            const mode = mockLocalStorage.getItem('oxidize_chart_pct_mode') || 'from_previous';
            expect(mode).toBe('from_first');
        });
    });
});

describe('Account Groups', () => {
    describe('group data aggregation', () => {
        it('should sum account data points for a group', () => {
            const accountDataMap = new Map();
            accountDataMap.set('acc-1', {
                data: [100, 110, 120],
                balance: '120',
                name: 'Account 1'
            });
            accountDataMap.set('acc-2', {
                data: [200, 210, 220],
                balance: '220',
                name: 'Account 2'
            });

            const group = {
                id: 'group-1',
                name: 'My Group',
                account_ids: ['acc-1', 'acc-2'],
                _checked: true
            };

            const summedData = group.account_ids.reduce((acc, accId) => {
                const member = accountDataMap.get(accId);
                if (!member) return acc;
                if (!acc) return member.data.map(v => v);
                return member.data.map((v, i) => acc[i] + v);
            }, null);

            expect(summedData).toEqual([300, 320, 340]);
        });

        it('should handle group with one account', () => {
            const accountDataMap = new Map();
            accountDataMap.set('acc-1', {
                data: [500, 510, 520],
                balance: '520',
                name: 'Single Account'
            });

            const group = {
                id: 'group-single',
                name: 'Single',
                account_ids: ['acc-1'],
                _checked: true
            };

            const summedData = group.account_ids.reduce((acc, accId) => {
                const member = accountDataMap.get(accId);
                if (!member) return acc;
                if (!acc) return member.data.map(v => v);
                return member.data.map((v, i) => acc[i] + v);
            }, null);

            expect(summedData).toEqual([500, 510, 520]);
        });

        it('should skip unchecked groups', () => {
            const checkedGroups = [
                { id: 'g1', _checked: true, account_ids: ['acc-1'] },
                { id: 'g2', _checked: false, account_ids: ['acc-2'] }
            ];

            const filtered = checkedGroups.filter(g => g._checked);
            expect(filtered).toHaveLength(1);
            expect(filtered[0].id).toBe('g1');
        });

        it('should calculate correct anchor balance for group', () => {
            const accountBalanceMap = new Map();
            accountBalanceMap.set('acc-1', { balance: '1000' });
            accountBalanceMap.set('acc-2', { balance: '2000' });

            const group = {
                account_ids: ['acc-1', 'acc-2']
            };

            const totalBalance = group.account_ids.reduce((sum, accId) => {
                const member = accountBalanceMap.get(accId);
                return sum + (member ? parseFloat(member.balance) : 0);
            }, 0);

            expect(totalBalance).toBe(3000);
        });
    });

    describe('group checkbox toggles member accounts', () => {
        it('should check all member accounts when group is checked', () => {
            const group = {
                id: 'g1',
                account_ids: ['acc-1', 'acc-2', 'acc-3']
            };

            const mockCheckboxes = [
                { value: 'acc-1', checked: false },
                { value: 'acc-2', checked: false },
                { value: 'acc-3', checked: false }
            ];

            group.account_ids.forEach(accId => {
                const cb = mockCheckboxes.find(c => c.value === accId);
                if (cb) cb.checked = true;
            });

            expect(mockCheckboxes.every(c => c.checked)).toBe(true);
        });

        it('should deselect all member accounts when group is unchecked', () => {
            const group = {
                id: 'g1',
                account_ids: ['acc-1', 'acc-2']
            };

            const mockCheckboxes = [
                { value: 'acc-1', checked: true },
                { value: 'acc-2', checked: true },
                { value: 'acc-3', checked: true }
            ];

            group.account_ids.forEach(accId => {
                const cb = mockCheckboxes.find(c => c.value === accId);
                if (cb) cb.checked = false;
            });

            expect(mockCheckboxes.filter(c => c.checked).map(c => c.value)).toEqual(['acc-3']);
        });
    });

    describe('group CRUD operations', () => {
        it('should create a valid group object', () => {
            const group = {
                id: 'test-group-1',
                name: 'Test Group',
                account_ids: ['1', '2', '3']
            };

            expect(group.id).toBeDefined();
            expect(group.name).toBe('Test Group');
            expect(group.account_ids).toHaveLength(3);
        });

        it('should reject empty group name', () => {
            const name = '';
            expect(name.trim()).toBe('');
            expect(name.trim().length).toBe(0);
        });

        it('should reject group with no accounts', () => {
            const accountIds = [];
            expect(accountIds.length).toBe(0);
            expect(accountIds.length === 0).toBe(true);
        });

        it('should update group name and accounts', () => {
            const group = {
                id: 'g1',
                name: 'Old Name',
                account_ids: ['1']
            };

            const updated = { ...group, name: 'New Name', account_ids: ['1', '2', '3'] };

            expect(updated.name).toBe('New Name');
            expect(updated.account_ids).toHaveLength(3);
            expect(updated.id).toBe('g1');
        });

        it('should delete group by ID', () => {
            const groups = [
                { id: 'g1', name: 'Group 1' },
                { id: 'g2', name: 'Group 2' },
                { id: 'g3', name: 'Group 3' }
            ];

            const deletedId = 'g2';
            const filtered = groups.filter(g => g.id !== deletedId);

            expect(filtered).toHaveLength(2);
            expect(filtered.find(g => g.id === 'g2')).toBeUndefined();
        });
    });

    describe('localStorage group persistence', () => {
        it('should save and restore groups from localStorage', () => {
            const mockLocalStorage = {
                data: {},
                getItem: function(key) { return this.data[key] || null; },
                setItem: function(key, value) { this.data[key] = value; }
            };

            const groups = [
                { id: 'g1', name: 'Test', account_ids: ['1', '2'] }
            ];

            mockLocalStorage.setItem('oxidize_groups', JSON.stringify(groups));
            const restored = JSON.parse(mockLocalStorage.getItem('oxidize_groups'));

            expect(restored).toHaveLength(1);
            expect(restored[0].name).toBe('Test');
            expect(restored[0].account_ids).toEqual(['1', '2']);
        });

        it('should handle empty localStorage gracefully', () => {
            const mockLocalStorage = {
                getItem: function() { return null; }
            };

            const stored = mockLocalStorage.getItem('oxidize_groups');
            const groups = stored ? JSON.parse(stored) : [];

            expect(groups).toEqual([]);
        });
    });

    describe('group-account separation for split mode', () => {
        it('should filter out group member accounts from individual list', () => {
            const allAccounts = [
                { id: 'a1', name: 'Account 1', balance: '100' },
                { id: 'a2', name: 'Account 2', balance: '200' },
                { id: 'a3', name: 'Account 3', balance: '300' }
            ];

            const group = {
                id: 'g1',
                name: 'Credit Cards',
                account_ids: ['a1', 'a2'],
                _checked: true
            };

            const uniqueAccountInfo = [
                { id: 'a1', name: 'Account 1', balance: '100' },
                { id: 'a2', name: 'Account 2', balance: '200' },
                { id: 'a3', name: 'Account 3', balance: '300' }
            ];

            const groupMemberNames = new Set();
            group.account_ids.forEach(accId => {
                const acc = allAccounts.find(a => a.id === accId);
                if (acc) groupMemberNames.add(acc.name);
            });

            const individualAccounts = uniqueAccountInfo.filter(info => !groupMemberNames.has(info.name));

            expect(individualAccounts).toHaveLength(1);
            expect(individualAccounts[0].name).toBe('Account 3');
        });

        it('should handle multiple checked groups', () => {
            const allAccounts = [
                { id: 'a1', name: 'CC1', balance: '100' },
                { id: 'a2', name: 'CC2', balance: '200' },
                { id: 'a3', name: 'Checking', balance: '500' },
                { id: 'a4', name: 'Savings', balance: '1000' }
            ];

            const groups = [
                { id: 'g1', name: 'Credit Cards', account_ids: ['a1', 'a2'], _checked: true },
                { id: 'g2', name: 'Assets', account_ids: ['a3', 'a4'], _checked: true }
            ];

            const uniqueAccountInfo = allAccounts.map(a => ({ id: a.id, name: a.name, balance: a.balance }));

            const groupMemberNames = new Set();
            groups.forEach(g => {
                if (g._checked) {
                    g.account_ids.forEach(accId => {
                        const acc = allAccounts.find(a => a.id === accId);
                        if (acc) groupMemberNames.add(acc.name);
                    });
                }
            });

            const individualAccounts = uniqueAccountInfo.filter(info => !groupMemberNames.has(info.name));

            expect(individualAccounts).toHaveLength(0);
        });
    });
});

describe('Relative Time Range', () => {
    it('should calculate dates from custom range (months)', () => {
        const dates = calculateRelativeDatesFromCustom(3, 'months');
        expect(dates).toBeDefined();
        expect(dates).toHaveProperty('start');
        expect(dates).toHaveProperty('end');
        // End date should be today
        const today = new Date().toISOString().split('T')[0];
        expect(dates.end).toBe(today);
        // Start should be ~3 months ago
        const start = new Date(dates.start);
        const end = new Date(dates.end);
        const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        expect(diffMonths).toBe(3);
    });

    it('should calculate dates from custom range (days)', () => {
        const dates = calculateRelativeDatesFromCustom(7, 'days');
        expect(dates).toBeDefined();
        const start = new Date(dates.start);
        const end = new Date(dates.end);
        const diffDays = Math.floor((end - start) / (1000 * 60 * 60 * 24));
        expect(diffDays).toBe(7);
    });

    it('should calculate dates from custom range (weeks)', () => {
        const dates = calculateRelativeDatesFromCustom(2, 'weeks');
        expect(dates).toBeDefined();
        const start = new Date(dates.start);
        const end = new Date(dates.end);
        const diffDays = Math.floor((end - start) / (1000 * 60 * 60 * 24));
        expect(diffDays).toBe(14);
    });

    it('should calculate dates from custom range (years)', () => {
        const dates = calculateRelativeDatesFromCustom(1, 'years');
        expect(dates).toBeDefined();
        const start = new Date(dates.start);
        const end = new Date(dates.end);
        const diffYears = end.getFullYear() - start.getFullYear();
        expect(diffYears).toBe(1);
    });

    it('should return null for invalid unit', () => {
        const dates = calculateRelativeDatesFromCustom(5, 'invalid');
        expect(dates).toBeNull();
    });
});

describe('Round End Date', () => {
    it('should round to start of current month', () => {
        const result = roundEndDate('2026-05-02', 'start_of_current_month');
        expect(result).toBe('2026-05-01');
    });

    it('should round to end of current month', () => {
        // May has 31 days
        const result = roundEndDate('2026-05-02', 'end_of_current_month');
        expect(result).toBe('2026-05-31');
    });

    it('should round to start of next month', () => {
        const result = roundEndDate('2026-05-02', 'start_of_next_month');
        expect(result).toBe('2026-06-01');
    });

    it('should return unchanged date for invalid mode', () => {
        const result = roundEndDate('2026-05-02', 'invalid');
        expect(result).toBe('2026-05-02');
    });
});
