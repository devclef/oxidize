// @vitest-environment jsdom
/**
 * Relative widget date ranges (docs/chart-options-audit.md, O1 + O2): a
 * widget may store `relative_range` ('30d', 'ytd', 'custom:6:months') and
 * `round_end_mode`; the dates are worked out when the widget renders.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

beforeAll(() => {
    (0, eval)(readFileSync(path.resolve(process.cwd(), 'static/date-utils.js'), 'utf8'));
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('parseRelativeRange', () => {
    it('accepts preset keys and custom ranges', () => {
        expect(window.parseRelativeRange('30d')).toEqual({ kind: 'preset', key: '30d' });
        expect(window.parseRelativeRange('ytd')).toEqual({ kind: 'preset', key: 'ytd' });
        expect(window.parseRelativeRange('2w')).toEqual({ kind: 'preset', key: '2w' });
        expect(window.parseRelativeRange('custom:6:months')).toEqual({ kind: 'custom', count: 6, unit: 'months' });
    });

    it('rejects anything else (same rules as the backend)', () => {
        for (const bad of [null, undefined, '', '0d', '1000d', 'YTD', '30', 'custom:0:days',
            'custom:6:fortnights', 'custom:6', 'custom:1000:days', 42]) {
            expect(window.parseRelativeRange(bad), String(bad)).toBeNull();
        }
    });
});

describe('customRelativeRangeKey', () => {
    it('builds the stored key and rejects invalid input', () => {
        expect(window.customRelativeRangeKey(6, 'months')).toBe('custom:6:months');
        expect(window.customRelativeRangeKey('3', 'weeks')).toBe('custom:3:weeks');
        expect(window.customRelativeRangeKey(0, 'days')).toBeNull();
        expect(window.customRelativeRangeKey(5, 'decades')).toBeNull();
    });
});

describe('resolveRelativeRange', () => {
    it('works the range out for today', () => {
        expect(window.resolveRelativeRange('30d')).toEqual({ start: '2026-09-25', end: '2026-10-25' });
        expect(window.resolveRelativeRange('ytd')).toEqual({ start: '2026-01-01', end: '2026-10-25' });
        expect(window.resolveRelativeRange('custom:2:weeks')).toEqual({ start: '2026-10-11', end: '2026-10-25' });
    });

    it('moves forward with time', () => {
        vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
        expect(window.resolveRelativeRange('30d')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    });

    it('handles preset keys outside the built-in list', () => {
        expect(window.resolveRelativeRange('2w')).toEqual({ start: '2026-10-11', end: '2026-10-25' });
        expect(window.resolveRelativeRange('2y').start).toBe('2024-10-25');
    });

    it('rounds the end date to a month boundary', () => {
        expect(window.resolveRelativeRange('3m', 'end_of_current_month').end).toBe('2026-10-31');
        expect(window.resolveRelativeRange('3m', 'start_of_current_month').end).toBe('2026-10-01');
        expect(window.resolveRelativeRange('3m', 'start_of_next_month').end).toBe('2026-11-01');
    });

    it('returns null for a missing or invalid range', () => {
        expect(window.resolveRelativeRange(null)).toBeNull();
        expect(window.resolveRelativeRange('forever')).toBeNull();
    });
});

describe('widgetEffectiveDates', () => {
    const dash = { start: '2026-01-01', end: '2026-06-30' };

    it('uses the dashboard range when the widget inherits it', () => {
        expect(window.widgetEffectiveDates(
            { date_range_source: 'dashboard', relative_range: '30d', start_date: '2025-01-01' }, dash
        )).toEqual(dash);
    });

    it('falls back to the widget dates when the dashboard has none', () => {
        expect(window.widgetEffectiveDates(
            { date_range_source: 'dashboard', start_date: '2025-01-01', end_date: '2025-02-01' }, {}
        )).toEqual({ start: '2025-01-01', end: '2025-02-01' });
    });

    it('resolves a relative range instead of the stale stored dates', () => {
        expect(window.widgetEffectiveDates(
            { relative_range: '30d', round_end_mode: 'end_of_current_month', start_date: '2026-01-01', end_date: '2026-01-31' }, dash
        )).toEqual({ start: '2026-09-25', end: '2026-10-31' });
    });

    it('keeps fixed dates for widgets without a relative range', () => {
        expect(window.widgetEffectiveDates({ start_date: '2026-01-01', end_date: '2026-01-31' }, dash))
            .toEqual({ start: '2026-01-01', end: '2026-01-31' });
        expect(window.widgetEffectiveDates({ relative_range: 'nonsense', start_date: '2026-01-01' }, dash))
            .toEqual({ start: '2026-01-01', end: null });
    });
});

describe('calculatePreviousPeriod via applyDateRange', () => {
    it('pre-fills the adjacent previous period when comparison is on', () => {
        document.body.innerHTML = `
            <input id="start-date"><input id="end-date">
            <input id="comparison-start-date"><input id="comparison-end-date">`;
        window.enableComparison = true;
        window.applyDateRange('30d');
        expect(document.getElementById('comparison-end-date').value).toBe('2026-09-24');
        expect(document.getElementById('comparison-start-date').value).toBe('2026-08-25'); // same 31-day length
        delete window.enableComparison;
    });
});
