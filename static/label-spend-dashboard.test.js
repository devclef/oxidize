// @vitest-environment jsdom
/**
 * Tests for the "Spending by Label" widget type (label_spend) on the
 * Dashboard. We evaluate the real shipped dashboard.js in a jsdom
 * environment (classic script -> top-level functions become globals)
 * and exercise its label spend helpers (same approach as
 * exclusions.test.js).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dashboardSource = readFileSync(path.resolve(root, 'static/dashboard.js'), 'utf8');

beforeAll(() => {
    window.OXIDIZE_CONFIG = { accountTypes: [], autoFetchAccounts: false };
    (0, eval)(dashboardSource); // indirect eval: top-level functions become globals
});

describe('buildLabelSpendWidgetParams (GET /api/labels/spend)', () => {
    const allGroups = [
        { id: 'grp-1', name: 'Everyday', account_ids: ['acc-1', 'acc-2'] },
        { id: 'grp-2', name: 'Unused group', account_ids: ['acc-9'] }
    ];

    it('maps widget fields to the endpoint query', () => {
        const widget = {
            accounts: ['acc-3'],
            group_ids: ['grp-1'],
            budget_names: ['Food'],
            interval: '1M',
            start_date: '2026-01-01',
            end_date: '2026-03-31'
        };
        const params = window.buildLabelSpendWidgetParams(
            widget, '2026-01-01', '2026-03-31', allGroups,
            { categories: [], budgets: [] }
        );
        expect(params.get('start')).toBe('2026-01-01');
        expect(params.get('end')).toBe('2026-03-31');
        expect(params.get('period')).toBe('1M');
        expect(params.getAll('budgets[]')).toEqual(['Food']);
        // Widget accounts merged with group members (deduped)
        expect(params.getAll('accounts[]').sort()).toEqual(['acc-1', 'acc-2', 'acc-3']);
        // Legacy widget without include_unlabeled -> include it
        expect(params.get('include_unlabeled')).toBe('1');
    });

    it('respects include_unlabeled=false and omits auto period', () => {
        const widget = {
            accounts: [],
            group_ids: [],
            budget_names: [],
            interval: 'auto',
            include_unlabeled: false
        };
        const params = window.buildLabelSpendWidgetParams(
            widget, null, null, allGroups, null
        );
        expect(params.get('include_unlabeled')).toBe('0');
        expect(params.get('period')).toBeNull();
        expect(params.get('start')).toBeNull();
        expect(params.getAll('budgets[]')).toEqual([]);
        expect(params.getAll('accounts[]')).toEqual([]);
    });

    it('merges dashboard-level and widget-level exclusions', () => {
        const widget = {
            accounts: [],
            group_ids: [],
            budget_names: [],
            interval: null,
            exclude_categories: ['Dining:Bars'],
            exclude_budgets: ['Work']
        };
        const dashExclusions = {
            categories: ['Dining:Bars', 'Travel'],
            budgets: ['Travel']
        };
        const params = window.buildLabelSpendWidgetParams(
            widget, null, null, allGroups, dashExclusions
        );
        const cats = params.getAll('exclude_categories[]').sort();
        const budgets = params.getAll('exclude_budgets[]').sort();
        expect(cats).toEqual(['Dining:Bars', 'Travel']);
        expect(budgets).toEqual(['Travel', 'Work']);
    });

    it('ignores group ids that do not resolve to a known group', () => {
        const widget = {
            accounts: ['acc-3'],
            group_ids: ['grp-2', 'grp-missing'],
            budget_names: [],
            interval: null
        };
        const params = window.buildLabelSpendWidgetParams(
            widget, null, null, allGroups, null
        );
        expect(params.getAll('accounts[]').sort()).toEqual(['acc-3', 'acc-9']);
    });
});

describe('labelDatasetColor', () => {
    const map = { wants: '#f59e0b' };

    it('uses the user-picked color when known', () => {
        expect(window.labelDatasetColor('wants', map)).toBe('#f59e0b');
    });

    it('always renders "Unlabeled" in the standard gray', () => {
        expect(window.labelDatasetColor('Unlabeled', map)).toBe('#9ca3af');
        expect(window.labelDatasetColor('Unlabeled', {})).toBe('#9ca3af');
    });

    it('returns null for unknown labels', () => {
        expect(window.labelDatasetColor('mystery', map)).toBe(null);
    });
});

describe('dashboard.js wiring', () => {
    it('fetches label spend from the Spending Labels API', () => {
        expect(dashboardSource).toContain('const url = `/api/labels/spend?${params.toString()}`;');
        expect(dashboardSource).toContain("fetch('/api/labels')");
    });

    it('shows a "Spending by Label" widget type badge', () => {
        expect(dashboardSource).toContain(
            '<span class="widget-type-badge label-spend">Spending by Label</span>'
        );
    });

    it('exposes the include-unlabeled control in widget settings', () => {
        expect(dashboardSource).toContain('id="${widget.id}-include-unlabeled"');
        expect(dashboardSource).toContain('widget.include_unlabeled = includeUnlabeledEl.checked');
    });

    it('makes exclusions and stacking available for label_spend widgets', () => {
        expect(dashboardSource).toMatch(
            /\['balance', 'budget_spent', 'expenses_by_category', 'category_subcat', 'label_spend'\]/
        );
        expect(dashboardSource).toMatch(
            /\['earned_spent', 'budget_spent', 'expenses_by_category', 'category_subcat', 'sankey', 'label_spend'\]/
        );
    });
});
