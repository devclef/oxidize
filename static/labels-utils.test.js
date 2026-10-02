// @vitest-environment jsdom
/**
 * Tests for static/labels-utils.js: the pure helpers used by the
 * Spending Labels page (/labels).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.resolve(process.cwd(), 'static/labels-utils.js'), 'utf8');

beforeEach(() => {
    (0, eval)(source);
});

describe('entryForSelection', () => {
    it('returns the parent name for the whole category', () => {
        expect(window.Labels.entryForSelection('Dining', 'all')).toBe('Dining');
        expect(window.Labels.entryForSelection('Dining', '')).toBe('Dining');
    });

    it('returns the full Parent:Sub name for one subcategory', () => {
        expect(window.Labels.entryForSelection('Dining', 'Bars')).toBe('Dining:Bars');
    });

    it('ignores surrounding whitespace', () => {
        expect(window.Labels.entryForSelection('  Dining  ', '  Bars ')).toBe('Dining:Bars');
    });

    it('returns empty string without a parent', () => {
        expect(window.Labels.entryForSelection('', 'Bars')).toBe('');
    });
});

describe('periodRange', () => {
    it('resolves this-month from the 1st to today', () => {
        const r = window.Labels.periodRange('this-month');
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        expect(r.start).toBe(window.Labels.ymd(y, m, 1));
        expect(r.end).toBe(window.Labels.ymd(y, m, now.getDate()));
    });

    it('resolves last-month to the full previous calendar month', () => {
        const r = window.Labels.periodRange('last-month');
        const now = new Date();
        const prev = window.Labels.shiftMonth(now.getFullYear(), now.getMonth() + 1, -1);
        expect(r.start).toBe(window.Labels.monthStart(prev.year, prev.month));
        expect(r.end).toBe(window.Labels.monthEnd(prev.year, prev.month));
    });

    it('resolves ytd from January 1st to today', () => {
        const r = window.Labels.periodRange('ytd');
        const now = new Date();
        expect(r.start).toBe('' + now.getFullYear() + '-01-01');
        expect(r.end).toBe(window.Labels.today());
    });

    it('starts trailing ranges at the first of the shifted month', () => {
        const r = window.Labels.periodRange('last-3m');
        expect(r.start.endsWith('-01')).toBe(true);
        expect(r.end).toBe(window.Labels.today());
    });

    it('returns null for unknown ids', () => {
        expect(window.Labels.periodRange('nonsense')).toBeNull();
    });
});

describe('shiftMonth', () => {
    it('wraps across year boundaries', () => {
        expect(window.Labels.shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
        expect(window.Labels.shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
        // 30 months before Sep 2026 is Mar 2024 (12+12+6).
        expect(window.Labels.shiftMonth(2026, 9, -30)).toEqual({ year: 2024, month: 3 });
    });
});

describe('donutData', () => {
    it('maps parts to labels/values/colors', () => {
        const parts = [
            { label: 'wants', color: '#f59e0b', amount: 400, pct: 32.4 },
            { label: 'needs', color: '#22c55e', amount: 600, pct: 48.6 }
        ];
        const d = window.Labels.donutData(parts, 1200);
        expect(d.labels).toEqual(['wants', 'needs']);
        expect(d.values).toEqual([400, 600]);
        expect(d.colors).toEqual(['#f59e0b', '#22c55e']);
        expect(d.total).toBe(1200);
    });

    it('uses gray for the Unlabeled part', () => {
        const d = window.Labels.donutData([{ label: 'Unlabeled', color: null, amount: 10, pct: 5 }], 200);
        expect(d.colors).toEqual([window.Labels.UNLABELED_COLOR]);
    });

    it('drops zero-amount parts', () => {
        const d = window.Labels.donutData([{ label: 'wants', color: null, amount: 0, pct: 0 }], 0);
        expect(d.labels).toEqual([]);
        expect(d.values).toEqual([]);
    });
});

describe('formatPeriodKey', () => {
    it('shows month-grained buckets (key on the last day) as YYYY-MM', () => {
        expect(window.Labels.formatPeriodKey('2026-01-31T00:00:00+00:00')).toBe('2026-01');
        expect(window.Labels.formatPeriodKey('2026-02-28T00:00:00+00:00')).toBe('2026-02');
        expect(window.Labels.formatPeriodKey('2026-12-31T00:00:00+00:00')).toBe('2026-12');
    });

    it('shows finer buckets as YYYY-MM-DD', () => {
        expect(window.Labels.formatPeriodKey('2026-01-15T00:00:00+00:00')).toBe('2026-01-15');
    });

    it('passes through unparseable keys', () => {
        expect(window.Labels.formatPeriodKey('weird')).toBe('weird');
        expect(window.Labels.formatPeriodKey('')).toBe('');
    });
});

describe('trendToChartJs', () => {
    it('aligns datasets to the sorted union of period keys', () => {
        const chartLine = [
            { label: 'wants', entries: { '2026-08': 10, '2026-10': 30 } },
            { label: 'needs', entries: { '2026-09': 20 } }
        ];
        const r = window.Labels.trendToChartJs(chartLine);
        expect(r.labels).toEqual(['2026-08', '2026-09', '2026-10']);
        expect(r.datasets[0].data).toEqual([10, null, 30]);
        expect(r.datasets[1].data).toEqual([null, 20, null]);
    });

    it('formats month-end bucket keys for the axis', () => {
        const chartLine = [
            { label: 'wants', entries: { '2026-01-31T00:00:00+00:00': 10, '2026-02-28T00:00:00+00:00': 30 } },
            { label: 'needs', entries: { '2026-02-28T00:00:00+00:00': 20 } }
        ];
        const r = window.Labels.trendToChartJs(chartLine);
        expect(r.labels).toEqual(['2026-01', '2026-02']);
        expect(r.datasets[0].data).toEqual([10, 30]);
        expect(r.datasets[1].data).toEqual([null, 20]);
    });

    it('handles empty input', () => {
        const r = window.Labels.trendToChartJs([]);
        expect(r.labels).toEqual([]);
        expect(r.datasets).toEqual([]);
    });
});

describe('formatAmount', () => {
    it('prepends the currency symbol when present', () => {
        expect(window.Labels.formatAmount(1234.5, '$')).toBe('$1,234.50');
    });

    it('renders missing amounts as an em dash', () => {
        expect(window.Labels.formatAmount(null)).toBe('—');
        expect(window.Labels.formatAmount(undefined, '$')).toBe('—');
    });
});
