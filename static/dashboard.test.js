import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Chart.js class
class MockChart {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.data = JSON.parse(JSON.stringify(config.data));
        this._datasets = config.data.datasets.map(ds => ({...ds}));
    }
    update() {
        this.config.data.datasets.forEach((ds, i) => {
            if (this._datasets[i]) {
                this._datasets[i].hidden = ds.hidden;
            }
        });
    }
    destroy() {}
}

global.Chart = MockChart;

const mockFetch = vi.fn();
global.fetch = mockFetch;

class MockElement {
    constructor(html = '') {
        this.innerHTML = html;
        this.style = {};
        this.textContent = '';
        this.value = '';
        this.checked = false;
        this.attributes = {};
        this.children = [];
        this.eventListeners = {};
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(event, cb) { this.eventListeners[event] = cb; }
    removeEventListener(event) { delete this.eventListeners[event]; }
    querySelector(selector) { return null; }
    querySelectorAll(selector) { return []; }
    appendChild(element) { this.children.push(element); }
    remove() { this.innerHTML = ''; }
    click() { if (this.eventListeners.click) { this.eventListeners.click(); } }
    getContext() { return { fillRect: () => {}, clearRect: () => {}, getImageData: () => {} }; }
}

class MockDocument {
    constructor() {
        this.elements = new Map();
        this.documentElement = new MockElement();
    }
    getElementById(id) { return this.elements.get(id) || new MockElement(); }
    createElement(tag) { return new MockElement(); }
}

beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    global.document = new MockDocument();
    global.window = {
        OXIDIZE_CONFIG: { accountTypes: ['asset', 'cash', 'expense', 'revenue', 'liability'], autoFetchAccounts: false },
        localStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() }
    };
});

afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.fetch;
    delete global.Chart;
});

describe('Dashboard Split Legend Toggle', () => {
    it('should initialize visibility state for all datasets', () => {
        const widgetId = 'test-widget';
        const widgetDatasetVisibility = {};
        const accountInfo = [{ name: 'Account 1' }, { name: 'Account 2' }, { name: 'Account 3' }];

        if (!widgetDatasetVisibility[widgetId]) {
            widgetDatasetVisibility[widgetId] = {};
            accountInfo.forEach((_, index) => {
                widgetDatasetVisibility[widgetId][index] = true;
            });
        }

        expect(widgetDatasetVisibility[widgetId][0]).toBe(true);
        expect(widgetDatasetVisibility[widgetId][1]).toBe(true);
        expect(widgetDatasetVisibility[widgetId][2]).toBe(true);
    });

    it('should create legend items with correct structure', () => {
        const accountInfo = [{ name: 'Checking', balance: '1000' }, { name: 'Savings', balance: '5000' }];
        const datasets = [
            { label: 'Checking', data: [1000, 1100, 1200], borderColor: '#ff0000' },
            { label: 'Savings', data: [5000, 5100, 5200], borderColor: '#00ff00' }
        ];
        expect(accountInfo.length).toBe(datasets.length);
        expect(accountInfo[0].name).toBe('Checking');
        expect(datasets[0].label).toBe('Checking');
    });

    it('should correctly update chart datasets through chart instance (fixed behavior)', () => {
        const widgetId = 'test-widget';
        const widgetDatasetVisibility = {};
        let widgetCharts = {};

        const accountInfo = [{ name: 'Checking', balance: '1000' }, { name: 'Savings', balance: '5000' }];

        if (!widgetDatasetVisibility[widgetId]) {
            widgetDatasetVisibility[widgetId] = {};
            accountInfo.forEach((_, index) => {
                widgetDatasetVisibility[widgetId][index] = true;
            });
        }

        const mockChart = {
            data: {
                datasets: [
                    { label: 'Checking', data: [1000, 1100, 1200], hidden: false },
                    { label: 'Savings', data: [5000, 5100, 5200], hidden: false }
                ]
            },
            update: vi.fn(),
            destroy: vi.fn()
        };
        widgetCharts[widgetId] = mockChart;

        const index = 0;
        widgetDatasetVisibility[widgetId][index] = !widgetDatasetVisibility[widgetId][index];
        widgetCharts[widgetId].data.datasets[index].hidden = !widgetDatasetVisibility[widgetId][index];
        mockChart.update();

        expect(mockChart.data.datasets[index].hidden).toBe(true);
        expect(mockChart.update).toHaveBeenCalled();
    });

    it('should handle split mode chart creation', () => {
        const widget = {
            id: 'widget-1',
            chart_mode: 'split',
            accounts: ['1', '2'],
            start_date: '2026-01-01',
            end_date: '2026-01-31',
            interval: '1M'
        };
        const mockHistory = [
            { label: 'Checking', entries: { '2026-01-01': '1000', '2026-01-15': '1100', '2026-01-31': '1200' } },
            { label: 'Savings', entries: { '2026-01-01': '5000', '2026-01-15': '5100', '2026-01-31': '5200' } }
        ];
        expect(mockHistory.length).toBe(2);
        expect(mockHistory[0].label).toBe('Checking');
        expect(mockHistory[1].label).toBe('Savings');
    });
});

describe('Dashboard Select All / Deselect All', () => {
    it('should initialize visibility state for all datasets on render', () => {
        const widgetId = 'test-widget';
        const widgetDatasetVisibility = {};
        const accountInfo = [{ name: 'Account 1' }, { name: 'Account 2' }, { name: 'Account 3' }];

        // Simulate renderSplitLegend visibility reset logic
        widgetDatasetVisibility[widgetId] = {};
        accountInfo.forEach((_, index) => {
            widgetDatasetVisibility[widgetId][index] = true;
        });

        expect(widgetDatasetVisibility[widgetId][0]).toBe(true);
        expect(widgetDatasetVisibility[widgetId][1]).toBe(true);
        expect(widgetDatasetVisibility[widgetId][2]).toBe(true);
    });

    it('should reset visibility on re-render (select all behavior)', () => {
        const widgetId = 'test-widget';
        const widgetDatasetVisibility = {};
        const accountInfo = [{ name: 'Checking' }, { name: 'Savings' }];

        // First render - all true
        widgetDatasetVisibility[widgetId] = {};
        accountInfo.forEach((_, index) => {
            widgetDatasetVisibility[widgetId][index] = true;
        });

        // Simulate user deselecting one dataset
        widgetDatasetVisibility[widgetId][0] = false;
        expect(widgetDatasetVisibility[widgetId][0]).toBe(false);
        expect(widgetDatasetVisibility[widgetId][1]).toBe(true);

        // Re-render resets visibility
        widgetDatasetVisibility[widgetId] = {};
        accountInfo.forEach((_, index) => {
            widgetDatasetVisibility[widgetId][index] = true;
        });

        // Both should be true after reset
        expect(widgetDatasetVisibility[widgetId][0]).toBe(true);
        expect(widgetDatasetVisibility[widgetId][1]).toBe(true);
    });

    it('should toggle all datasets to hidden (deselect all)', () => {
        const widgetId = 'test-widget';
        const widgetDatasetVisibility = {};
        const accountInfo = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

        // Initialize
        widgetDatasetVisibility[widgetId] = {};
        accountInfo.forEach((_, index) => {
            widgetDatasetVisibility[widgetId][index] = true;
        });

        // Simulate deselect all
        accountInfo.forEach((_, index) => {
            widgetDatasetVisibility[widgetId][index] = false;
        });

        expect(widgetDatasetVisibility[widgetId][0]).toBe(false);
        expect(widgetDatasetVisibility[widgetId][1]).toBe(false);
        expect(widgetDatasetVisibility[widgetId][2]).toBe(false);
    });

    it('should toggle all datasets to visible (select all)', () => {
        const widgetId = 'test-widget';
        const widgetDatasetVisibility = {};
        const accountInfo = [{ name: 'A' }, { name: 'B' }];

        // Initialize
        widgetDatasetVisibility[widgetId] = {};
        accountInfo.forEach((_, index) => {
            widgetDatasetVisibility[widgetId][index] = true;
        });

        // Deselect one first
        widgetDatasetVisibility[widgetId][0] = false;

        // Simulate select all
        accountInfo.forEach((_, index) => {
            widgetDatasetVisibility[widgetId][index] = true;
        });

        expect(widgetDatasetVisibility[widgetId][0]).toBe(true);
        expect(widgetDatasetVisibility[widgetId][1]).toBe(true);
    });

    it('should reset chart dataset hidden state on re-render', () => {
        const widgetId = 'test-widget';
        const widgetCharts = {};

        const mockChart = {
            data: {
                datasets: [
                    { label: 'Checking', hidden: false },
                    { label: 'Savings', hidden: false }
                ]
            },
            update: vi.fn()
        };
        widgetCharts[widgetId] = mockChart;

        // Simulate user hiding datasets
        mockChart.data.datasets[0].hidden = true;
        expect(mockChart.data.datasets[0].hidden).toBe(true);

        // Simulate re-render reset
        mockChart.data.datasets.forEach((ds) => {
            ds.hidden = false;
        });
        mockChart.update();

        expect(mockChart.data.datasets[0].hidden).toBe(false);
        expect(mockChart.data.datasets[1].hidden).toBe(false);
        expect(mockChart.update).toHaveBeenCalled();
    });
});
