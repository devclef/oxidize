// @vitest-environment jsdom
/**
 * Tests for static/summary-utils.js: the pure month/date helpers used by
 * the Monthly Summary page (/summary).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.resolve(process.cwd(), 'static/summary-utils.js'), 'utf8');

beforeEach(() => {
    (0, eval)(source);
});

describe('shiftMonth', () => {
    it('shifts back one month', () => {
        expect(window.MonthSummary.shiftMonth(2026, 9, -1)).toEqual({ year: 2026, month: 8 });
    });

    it('wraps from January to previous December', () => {
        expect(window.MonthSummary.shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    });

    it('wraps from December to next January', () => {
        expect(window.MonthSummary.shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    });

    it('shifts a full year back and forward', () => {
        expect(window.MonthSummary.shiftMonth(2026, 9, -12)).toEqual({ year: 2025, month: 9 });
        expect(window.MonthSummary.shiftMonth(2026, 9, 12)).toEqual({ year: 2027, month: 9 });
    });

    it('handles multi-step shifts across years', () => {
        expect(window.MonthSummary.shiftMonth(2026, 2, -5)).toEqual({ year: 2025, month: 9 });
        expect(window.MonthSummary.shiftMonth(2025, 11, 4)).toEqual({ year: 2026, month: 3 });
    });
});

describe('monthKey / monthLabel / shortMonthLabel', () => {
    it('formats zero-padded month keys', () => {
        expect(window.MonthSummary.monthKey(2026, 9)).toBe('2026-09');
        expect(window.MonthSummary.monthKey(2026, 3)).toBe('2026-03');
        expect(window.MonthSummary.monthKey(1999, 1)).toBe('1999-01');
    });

    it('formats full month labels', () => {
        expect(window.MonthSummary.monthLabel(2026, 9)).toBe('September 2026');
        expect(window.MonthSummary.monthLabel(2025, 12)).toBe('December 2025');
    });

    it('formats short labels from YYYY-MM', () => {
        expect(window.MonthSummary.shortMonthLabel('2026-09')).toBe('Sep');
        expect(window.MonthSummary.shortMonthLabel('2025-01')).toBe('Jan');
        expect(window.MonthSummary.shortMonthLabel('2024-12')).toBe('Dec');
    });

    it('passes invalid labels through unchanged', () => {
        expect(window.MonthSummary.shortMonthLabel('garbage')).toBe('garbage');
        expect(window.MonthSummary.shortMonthLabel('2026-13')).toBe('2026-13');
    });
});

describe('daysInMonth', () => {
    it('knows leap and non-leap February', () => {
        expect(window.MonthSummary.daysInMonth(2024, 2)).toBe(29);
        expect(window.MonthSummary.daysInMonth(2026, 2)).toBe(28);
    });

    it('handles 30- and 31-day months', () => {
        expect(window.MonthSummary.daysInMonth(2026, 4)).toBe(30);
        expect(window.MonthSummary.daysInMonth(2026, 12)).toBe(31);
        expect(window.MonthSummary.daysInMonth(2026, 5)).toBe(31);
    });
});

describe('pctDelta', () => {
    it('computes percentage change', () => {
        expect(window.MonthSummary.pctDelta(110, 100)).toBeCloseTo(10, 10);
        expect(window.MonthSummary.pctDelta(90, 100)).toBeCloseTo(-10, 10);
    });

    it('returns null when the previous value is zero or missing', () => {
        expect(window.MonthSummary.pctDelta(50, 0)).toBeNull();
        expect(window.MonthSummary.pctDelta(50, null)).toBeNull();
        expect(window.MonthSummary.pctDelta(50, undefined)).toBeNull();
    });
});

describe('currentYearMonth / isFuture', () => {
    it('current month is never in the future', () => {
        const cur = window.MonthSummary.currentYearMonth();
        expect(window.MonthSummary.isFuture(cur.year, cur.month)).toBe(false);
    });

    it('previous month is never in the future', () => {
        const cur = window.MonthSummary.currentYearMonth();
        const prev = window.MonthSummary.shiftMonth(cur.year, cur.month, -1);
        expect(window.MonthSummary.isFuture(prev.year, prev.month)).toBe(false);
    });

    it('next month is in the future', () => {
        const cur = window.MonthSummary.currentYearMonth();
        const next = window.MonthSummary.shiftMonth(cur.year, cur.month, 1);
        expect(window.MonthSummary.isFuture(next.year, next.month)).toBe(true);
    });

    it('returns a sane {year, month} shape', () => {
        const cur = window.MonthSummary.currentYearMonth();
        expect(cur.year).toBeGreaterThanOrEqual(2020);
        expect(cur.month).toBeGreaterThanOrEqual(1);
        expect(cur.month).toBeLessThanOrEqual(12);
    });
});

describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(window.MonthSummary.escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
    });

    it('handles null and non-strings', () => {
        expect(window.MonthSummary.escapeHtml(null)).toBe('');
        expect(window.MonthSummary.escapeHtml(42)).toBe('42');
    });
});

describe('account filter helpers', () => {
    it('exposes a stable storage key', () => {
        expect(typeof window.MonthSummary.ACCOUNT_FILTER_KEY).toBe('string');
        expect(window.MonthSummary.ACCOUNT_FILTER_KEY.length).toBeGreaterThan(0);
    });

    it('builds include params from account ids', () => {
        const pairs = window.MonthSummary.buildAccountFilterParams(
            'include',
            ['1', '2', '3']
        );
        expect(pairs).toEqual([
            ['accounts[]', '1'],
            ['accounts[]', '2'],
            ['accounts[]', '3'],
        ]);
    });

    it('builds exclude params from account ids', () => {
        const pairs = window.MonthSummary.buildAccountFilterParams(
            'exclude',
            ['7']
        );
        expect(pairs).toEqual([['exclude_accounts[]', '7']]);
    });

    it('returns no params for all-accounts mode', () => {
        expect(window.MonthSummary.buildAccountFilterParams('all', ['1', '2'])).toEqual([]);
    });

    it('returns no params when the selection is empty', () => {
        expect(window.MonthSummary.buildAccountFilterParams('include', [])).toEqual([]);
        expect(window.MonthSummary.buildAccountFilterParams('exclude', [])).toEqual([]);
    });

    it('normalizes ids to trimmed, de-duplicated strings', () => {
        const pairs = window.MonthSummary.buildAccountFilterParams(
            'exclude',
            [' 1 ', '1', 2, '', null, '3']
        );
        expect(pairs).toEqual([
            ['exclude_accounts[]', '1'],
            ['exclude_accounts[]', '2'],
            ['exclude_accounts[]', '3'],
        ]);
    });

    it('parses a stored filter object', () => {
        const parsed = window.MonthSummary.parseAccountFilter(
            { mode: 'exclude', ids: ['1', '2'] }
        );
        expect(parsed).toEqual({ mode: 'exclude', ids: ['1', '2'] });
    });

    it('falls back to all-accounts for missing or invalid stored data', () => {
        const fallback = { mode: 'all', ids: [] };
        expect(window.MonthSummary.parseAccountFilter(null)).toEqual(fallback);
        expect(window.MonthSummary.parseAccountFilter(undefined)).toEqual(fallback);
        expect(window.MonthSummary.parseAccountFilter('nonsense')).toEqual(fallback);
        expect(window.MonthSummary.parseAccountFilter({})).toEqual(fallback);
        expect(window.MonthSummary.parseAccountFilter({ mode: 'bogus', ids: ['1'] })).toEqual(fallback);
        expect(window.MonthSummary.parseAccountFilter({ mode: 'include', ids: 'nope' })).toEqual(fallback);
    });

    it('coerces an include/exclude mode with no ids to all-accounts', () => {
        expect(window.MonthSummary.parseAccountFilter({ mode: 'include', ids: [] })).toEqual(
            { mode: 'all', ids: [] }
        );
        expect(window.MonthSummary.parseAccountFilter({ mode: 'exclude', ids: [] })).toEqual(
            { mode: 'all', ids: [] }
        );
    });

    it('describes the active filter for display', () => {
        expect(window.MonthSummary.describeAccountFilter('all')).toBe('');
        expect(window.MonthSummary.describeAccountFilter('include', 3)).toBe('3 accounts included');
        expect(window.MonthSummary.describeAccountFilter('include', 1)).toBe('1 account included');
        expect(window.MonthSummary.describeAccountFilter('exclude', 2)).toBe('2 accounts excluded');
        expect(window.MonthSummary.describeAccountFilter('exclude', 1)).toBe('1 account excluded');
    });
});

describe('groupAccounts', () => {
    const accounts = [
        { id: '1', name: 'Credit Card', account_type: 'liability' },
        { id: '2', name: 'Z Checking', account_type: 'asset' },
        { id: '3', name: 'A Savings', account_type: 'asset' },
        { id: '4', name: 'Salary', account_type: 'revenue' },
        { id: '5', name: 'Groceries', account_type: 'expense' },
        { id: '6', name: 'Cash Wallet', account_type: 'cash' },
        { id: '7', name: 'Mystery', account_type: 'weird' },
    ];

    it('groups by type in display order: asset, cash, liability, expense, revenue', () => {
        const groups = window.MonthSummary.groupAccounts(accounts);
        expect(groups.map((g) => g.key)).toEqual([
            'asset', 'cash', 'liability', 'expense', 'revenue', 'weird',
        ]);
    });

    it('uses friendly labels and leaves unknown types as-is', () => {
        const groups = window.MonthSummary.groupAccounts(accounts);
        expect(groups.map((g) => g.label)).toEqual([
            'Assets', 'Cash', 'Liabilities', 'Expenses', 'Income', 'weird',
        ]);
    });

    it('sorts accounts inside a group by name (case-insensitive)', () => {
        const groups = window.MonthSummary.groupAccounts(accounts);
        const assets = groups.find((g) => g.key === 'asset');
        expect(assets.accounts.map((a) => a.name)).toEqual(['A Savings', 'Z Checking']);
    });

    it('treats missing types as "other" and tolerates bad input', () => {
        expect(window.MonthSummary.groupAccounts([
            { id: '1', name: 'X' },
            { id: '2', name: 'Y', account_type: null },
        ]).map((g) => g.key)).toEqual(['other']);
        expect(window.MonthSummary.groupAccounts(null)).toEqual([]);
        expect(window.MonthSummary.groupAccounts('nope')).toEqual([]);
    });

    it('normalizes case in account types', () => {
        const groups = window.MonthSummary.groupAccounts([
            { id: '1', name: 'X', account_type: 'ASSET' },
            { id: '2', name: 'Y', account_type: 'Asset' },
        ]);
        expect(groups.length).toBe(1);
        expect(groups[0].key).toBe('asset');
        expect(groups[0].accounts).toHaveLength(2);
    });
});

describe('REVISION', () => {
    it('exposes an integer REVISION that summary.html verifies at load', () => {
        expect(Number.isInteger(window.MonthSummary.REVISION)).toBe(true);
        expect(window.MonthSummary.REVISION).toBeGreaterThan(0);
    });
});

describe('resolveFilterMode', () => {
    it('an empty selection always means all accounts', () => {
        expect(window.MonthSummary.resolveFilterMode('include', 0)).toBe('all');
        expect(window.MonthSummary.resolveFilterMode('exclude', 0)).toBe('all');
        expect(window.MonthSummary.resolveFilterMode('all', 0)).toBe('all');
    });

    it('a selection from all-accounts mode becomes an include', () => {
        expect(window.MonthSummary.resolveFilterMode('all', 3)).toBe('include');
        expect(window.MonthSummary.resolveFilterMode(undefined, 1)).toBe('include');
    });

    it('an explicit include or exclude stays what it is', () => {
        expect(window.MonthSummary.resolveFilterMode('include', 2)).toBe('include');
        expect(window.MonthSummary.resolveFilterMode('exclude', 2)).toBe('exclude');
    });
});
