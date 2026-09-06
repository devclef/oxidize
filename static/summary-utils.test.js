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
