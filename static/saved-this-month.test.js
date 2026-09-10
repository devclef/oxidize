// @vitest-environment jsdom
/**
 * Tests for the "Saved this Month" stat tile + the Widget Builder rename.
 *
 * We evaluate the real shipped app.js in a jsdom environment (classic
 * script -> top-level functions become globals) and exercise the tile
 * builder with the exact payload shape /api/saved-this-month returns.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appSource = readFileSync(path.resolve(root, 'static/app.js'), 'utf8');
const indexHtml = readFileSync(path.resolve(root, 'static/index.html'), 'utf8');

beforeAll(() => {
    window.OXIDIZE_CONFIG = { accountTypes: [], autoFetchAccounts: false };
    (0, eval)(appSource); // indirect eval: top-level functions become globals
});

// A payload exactly like the live endpoint returns (verified against a mock).
const SAMPLE = {
    currency_symbol: '$',
    currency_code: 'USD',
    current_month: { label: 'September 2026', earned: 5000, spent: 3200, saved: 1800 },
    previous_month: { label: 'August 2026', earned: 4800, spent: 3500, saved: 1300 },
    difference: 500,
    current_month_start: '2026-09-01',
    current_month_end: '2026-09-10'
};

describe('formatMoney', () => {
    it('formats with the currency symbol and two decimals', () => {
        expect(window.formatMoney(1800, '$')).toBe('$1,800.00');
        expect(window.formatMoney(0, '$')).toBe('$0.00');
    });

    it('falls back to 0 for non-finite values and omits a missing symbol', () => {
        expect(window.formatMoney(NaN, '$')).toBe('$0.00');
        expect(window.formatMoney(42, undefined)).toBe('42.00');
    });
});

describe('formatSavingsRange', () => {
    it('renders a compact month-day range', () => {
        const out = window.formatSavingsRange('2026-09-01', '2026-09-10');
        // Shape: "<Mon> <day> - <Mon> <day>"
        const parts = out.split(/\s+/);
        expect(parts).toHaveLength(5);
        expect(parts[1]).toBe('1');
        expect(parts[4]).toBe('10');
        // Same month -> the month name is repeated
        expect(parts[0]).toBe(parts[3]);
    });
});

describe('buildSavedTileHtml', () => {
    it('renders the saved amount, income/expenses, and the vs-previous line', () => {
        const html = window.buildSavedTileHtml(SAMPLE);
        expect(html).toContain('stat-tile');
        // Big number = current saved
        expect(html).toContain('$1,800.00');
        // Supporting income / expenses
        expect(html).toContain('$5,000.00');
        expect(html).toContain('$3,200.00');
        // Vs previous month: +$500 and the prior saved value
        expect(html).toContain('$500.00');
        expect(html).toContain('$1,300.00');
        expect(html).toContain('August 2026');
        // Positive difference uses the "up" styling and a up arrow
        expect(html).toContain('stat-tile-compare up');
        expect(html).toContain('\u25b2');
    });

    it('marks a negative saved amount and a negative delta', () => {
        const negative = {
            ...SAMPLE,
            current_month: { label: 'September 2026', earned: 1000, spent: 2500, saved: -1500 },
            previous_month: { label: 'August 2026', earned: 4800, spent: 3500, saved: 1300 },
            difference: -2800
        };
        const html = window.buildSavedTileHtml(negative);
        expect(html).toContain('stat-tile-value negative');
        expect(html).toContain('$1,500.00');
        expect(html).toContain('stat-tile-compare down');
        expect(html).toContain('\u25bc');
    });
});

describe('Widget Builder rename + Saved This Month wiring', () => {
    it('renames the builder page to Widget Builder', () => {
        expect(indexHtml).toContain('<title>Oxidize - Widget Builder</title>');
        expect(indexHtml).toContain('<a href="/" class="active">Widget Builder</a>');
        expect(indexHtml).toContain('<h1>Widget Builder</h1>');
    });

    it('offers the Saved This Month widget type and a tile preview area', () => {
        expect(indexHtml).toContain('<option value="saved_this_month">Saved This Month</option>');
        expect(indexHtml).toContain('id="tile-preview"');
        // Graph-specific groups are addressable so the tile can hide them
        expect(indexHtml).toContain('id="date-range-group"');
        expect(indexHtml).toContain('id="display-group"');
    });

    it('routes the tile through a dedicated fetch in app.js', () => {
        expect(appSource).toContain("if (widgetType === 'saved_this_month')");
        expect(appSource).toContain('/api/saved-this-month');
        expect(appSource).toContain('async function fetchSavedThisMonthTile');
    });
});
