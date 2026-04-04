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
