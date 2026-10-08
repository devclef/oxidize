// @vitest-environment jsdom
/**
 * Tests for the "Spending by Label" widget type (label_spend) in the
 * Widget Builder. We evaluate the real shipped app.js in a jsdom
 * environment (classic script -> top-level functions become globals)
 * and exercise its label spend helpers (same approach as
 * saved-this-month.test.js).
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

describe('buildLabelSpendParams (GET /api/labels/spend)', () => {
    it('builds the full query string with all options', () => {
        const params = window.buildLabelSpendParams({
            startDate: '2026-01-01',
            endDate: '2026-03-31',
            interval: '1M',
            budgetNames: ['Food', 'Travel'],
            accountIds: ['acc-1', 'acc-2'],
            includeUnlabeled: false,
            excludedCategories: ['Dining:Bars'],
            excludedBudgets: ['Work']
        });
        const q = params.toString();
        expect(q).toContain('start=2026-01-01');
        expect(q).toContain('end=2026-03-31');
        expect(q).toContain('period=1M');
        expect(q).toContain('budgets%5B%5D=Food');
        expect(q).toContain('budgets%5B%5D=Travel');
        expect(q).toContain('accounts%5B%5D=acc-1');
        expect(q).toContain('accounts%5B%5D=acc-2');
        expect(q).toContain('include_unlabeled=0');
        expect(q).toContain('exclude_categories%5B%5D=Dining%3ABars');
        expect(q).toContain('exclude_budgets%5B%5D=Work');
    });

    it('defaults include_unlabeled to 1 and omits "auto" period', () => {
        const params = window.buildLabelSpendParams({
            startDate: null,
            endDate: null,
            interval: 'auto',
            budgetNames: [],
            accountIds: [],
            includeUnlabeled: undefined,
            excludedCategories: [],
            excludedBudgets: []
        });
        const p = params;
        expect(p.get('include_unlabeled')).toBe('1');
        expect(p.get('period')).toBeNull();
        expect(p.get('start')).toBeNull();
        expect(p.get('end')).toBeNull();
        expect(p.getAll('budgets[]')).toEqual([]);
        expect(p.getAll('accounts[]')).toEqual([]);
        expect(p.getAll('exclude_categories[]')).toEqual([]);
        expect(p.getAll('exclude_budgets[]')).toEqual([]);
    });

    it('repeats repeatable params for multiple budgets/accounts', () => {
        const params = window.buildLabelSpendParams({
            startDate: null, endDate: null, interval: null,
            budgetNames: ['A', 'B', 'C'],
            accountIds: ['x'],
            includeUnlabeled: true,
            excludedCategories: [], excludedBudgets: []
        });
        expect(params.getAll('budgets[]')).toEqual(['A', 'B', 'C']);
        expect(params.getAll('accounts[]')).toEqual(['x']);
        expect(params.get('include_unlabeled')).toBe('1');
    });
});

describe('labelDatasetColor', () => {
    const map = { wants: '#f59e0b', needs: '#10b981' };

    it('uses the user-picked color when the label is known', () => {
        expect(window.labelDatasetColor('wants', map)).toBe('#f59e0b');
        expect(window.labelDatasetColor('needs', map)).toBe('#10b981');
    });

    it('always renders "Unlabeled" in the standard gray', () => {
        expect(window.labelDatasetColor('Unlabeled', map)).toBe('#9ca3af');
        expect(window.labelDatasetColor('Unlabeled', null)).toBe('#9ca3af');
        expect(window.labelDatasetColor('Unlabeled', { Unlabeled: '#ff0000' })).toBe('#9ca3af');
    });

    it('returns null for unknown labels (caller falls back to the palette)', () => {
        expect(window.labelDatasetColor('mystery', map)).toBe(null);
        expect(window.labelDatasetColor('wants', null)).toBe(null);
    });
});

describe('labelColorMap', () => {
    it('maps label names to colors and skips colorless labels', () => {
        const map = window.labelColorMap([
            { name: 'wants', color: '#f59e0b' },
            { name: 'needs', color: null },
            { name: 'home', color: '#3b82f6' }
        ]);
        expect(map).toEqual({ wants: '#f59e0b', home: '#3b82f6' });
    });

    it('tolerates null/undefined input', () => {
        expect(window.labelColorMap(null)).toEqual({});
        expect(window.labelColorMap(undefined)).toEqual({});
    });
});

describe('index.html wiring', () => {
    it('offers the Spending by Label widget type', () => {
        expect(indexHtml).toContain('<option value="label_spend">Spending by Label</option>');
    });

    it('has the include-unlabeled control (hidden group, checked by default)', () => {
        expect(indexHtml).toContain('id="label-spend-options-group" style="display: none;"');
        expect(indexHtml).toContain('id="include-unlabeled-checkbox" checked');
    });
});
