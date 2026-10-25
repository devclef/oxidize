// @vitest-environment jsdom
/**
 * Tests for the "Budget Breakdown" widget type (budget_breakdown) on the
 * Dashboard. We evaluate the real shipped dashboard.js in a jsdom
 * environment (classic script -> top-level functions become globals)
 * and exercise its budget breakdown helpers (same approach as
 * subscription-cost-dashboard.test.js).
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

describe('buildBudgetBreakdownWidgetParams (GET /api/budgets/breakdown)', () => {
    const allGroups = [
        { id: 'grp-1', name: 'Everyday', account_ids: ['acc-1', 'acc-2'] },
        { id: 'grp-2', name: 'Unused group', account_ids: ['acc-9'] }
    ];

    it('maps widget fields to the endpoint query (default category mode)', () => {
        const widget = {
            accounts: ['acc-3'],
            group_ids: ['grp-1'],
            budget_names: ['Groceries', 'Dining Out'],
            interval: '1M'
        };
        const params = window.buildBudgetBreakdownWidgetParams(
            widget, '2026-01-01', '2026-03-31', allGroups,
            { categories: [], budgets: [] }
        );
        expect(params.get('start')).toBe('2026-01-01');
        expect(params.get('end')).toBe('2026-03-31');
        expect(params.get('period')).toBe('1M');
        expect(params.get('by')).toBe('category');
        expect(params.getAll('budgets[]')).toEqual(['Groceries', 'Dining Out']);
        // Widget accounts merged with group members (deduped)
        expect(params.getAll('accounts[]').sort()).toEqual(['acc-1', 'acc-2', 'acc-3']);
    });

    it('sends by=destination for destination-mode widgets', () => {
        const widget = {
            accounts: [],
            group_ids: [],
            budget_names: ['Groceries'],
            budget_breakdown_by: 'destination',
            interval: '1M'
        };
        const params = window.buildBudgetBreakdownWidgetParams(
            widget, '2026-01-01', '2026-03-31', allGroups, null
        );
        expect(params.get('by')).toBe('destination');
    });

    it('sends by=main_category for main-category widgets', () => {
        const widget = {
            accounts: [],
            group_ids: [],
            budget_names: ['Groceries'],
            budget_breakdown_by: 'main_category',
            interval: '1M'
        };
        const params = window.buildBudgetBreakdownWidgetParams(
            widget, '2026-01-01', '2026-03-31', allGroups, null
        );
        expect(params.get('by')).toBe('main_category');
    });

    it('falls back to by=category for unknown modes', () => {
        const widget = { budget_names: ['Groceries'], budget_breakdown_by: 'bogus' };
        const params = window.buildBudgetBreakdownWidgetParams(widget, null, null, allGroups, null);
        expect(params.get('by')).toBe('category');
    });

    it('omits empty selections and "auto" period', () => {
        const widget = {
            accounts: [],
            group_ids: [],
            budget_names: [],
            interval: 'auto'
        };
        const params = window.buildBudgetBreakdownWidgetParams(
            widget, null, null, allGroups, null
        );
        expect(params.get('start')).toBeNull();
        expect(params.get('end')).toBeNull();
        expect(params.get('period')).toBeNull();
        expect(params.get('by')).toBe('category');
        expect(params.getAll('budgets[]')).toEqual([]);
        expect(params.getAll('accounts[]')).toEqual([]);
    });

    it('merges dashboard-level exclusions with the widget exclusions', () => {
        const widget = {
            accounts: ['acc-1'],
            group_ids: [],
            budget_names: ['Groceries'],
            interval: '1M',
            exclude_categories: ['Dining:Bars'],
            exclude_budgets: ['Work']
        };
        const params = window.buildBudgetBreakdownWidgetParams(
            widget, '2026-01-01', '2026-12-31', allGroups,
            { categories: ['Rent'], budgets: ['Food'] }
        );
        expect(params.getAll('exclude_categories[]').sort()).toEqual(['Dining:Bars', 'Rent']);
        expect(params.getAll('exclude_budgets[]').sort()).toEqual(['Food', 'Work']);
    });

    it('ignores unknown group ids and legacy widgets without the fields', () => {
        const legacy = {
            accounts: ['acc-5'],
            group_ids: ['grp-missing'],
            interval: '1M'
        };
        const params = window.buildBudgetBreakdownWidgetParams(
            legacy, null, '2026-12-31', allGroups, null
        );
        expect(params.get('end')).toBe('2026-12-31');
        expect(params.get('by')).toBe('category');
        expect(params.getAll('budgets[]')).toEqual([]);
        expect(params.getAll('accounts[]')).toEqual(['acc-5']);
    });
});

describe('dashboard.js wiring', () => {
    it('fetches budget breakdowns from /api/budgets/breakdown', () => {
        expect(dashboardSource).toContain("widgetType === 'budget_breakdown'");
        expect(dashboardSource).toContain('/api/budgets/breakdown?');
    });

    it('shows the Budget Breakdown type badge', () => {
        expect(dashboardSource).toContain('widget-type-badge budget-breakdown');
    });

    it('renders budget_breakdown with the multi-series branch', () => {
        expect(dashboardSource).toContain(
            "widgetType === 'expenses_by_category' || widgetType === 'subscription_cost' || widgetType === 'budget_breakdown'"
        );
    });

    it('offers budget pickers + breakdown mode in the widget settings', () => {
        expect(dashboardSource).toContain('id="${widget.id}-budgets"');
        expect(dashboardSource).toContain('id="${widget.id}-budget-breakdown-by"');
        expect(dashboardSource).toContain('<option value="main_category"');
    });

    it('persists the budget selection and breakdown mode on update', () => {
        expect(dashboardSource).toContain('widget.budget_names = Array.from(widgetBudgetsEl.selectedOptions).map(o => o.value);');
        expect(dashboardSource).toContain('widget.budget_breakdown_by = bdByEl.value;');
    });

    it('supports stacking for budget_breakdown', () => {
        expect(dashboardSource).toContain(
            "'label_spend', 'subscription_cost', 'budget_breakdown'].includes(widgetType) ? `"
        );
    });
});
