// @vitest-environment jsdom
/**
 * Tests for the "Budget Breakdown" widget type (budget_breakdown) in the
 * Widget Builder. We evaluate the real shipped app.js in a jsdom
 * environment (classic script -> top-level functions become globals)
 * and exercise its budget breakdown helpers (same approach as
 * subscription-cost-app.test.js).
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

describe('buildBudgetBreakdownParams (GET /api/budgets/breakdown)', () => {
    it('builds the full query string with all options', () => {
        const params = window.buildBudgetBreakdownParams({
            startDate: '2026-01-01',
            endDate: '2026-03-31',
            interval: '1M',
            budgetNames: ['Groceries', 'Dining Out'],
            by: 'destination',
            accountIds: ['acc-1'],
            excludedCategories: ['Dining:Bars'],
            excludedBudgets: ['Work']
        });
        const q = params.toString();
        expect(q).toContain('start=2026-01-01');
        expect(q).toContain('end=2026-03-31');
        expect(q).toContain('period=1M');
        expect(q).toContain('by=destination');
        expect(q).toContain('budgets%5B%5D=Groceries');
        expect(q).toContain('budgets%5B%5D=Dining+Out');
        expect(q).toContain('accounts%5B%5D=acc-1');
        expect(q).toContain('exclude_categories%5B%5D=Dining%3ABars');
        expect(q).toContain('exclude_budgets%5B%5D=Work');
    });

    it('defaults to by=category when "category" or anything else is passed', () => {
        expect(window.buildBudgetBreakdownParams({ by: 'category' }).get('by')).toBe('category');
        expect(window.buildBudgetBreakdownParams({ by: 'destination' }).get('by')).toBe('destination');
        expect(window.buildBudgetBreakdownParams({ by: undefined }).get('by')).toBe('category');
    });

    it('passes by=main_category through (subcategories rolled up)', () => {
        expect(window.buildBudgetBreakdownParams({ by: 'main_category' }).get('by')).toBe('main_category');
        expect(window.buildBudgetBreakdownParams({ by: 'bogus' }).get('by')).toBe('category');
    });

    it('titles the chart per breakdown mode', () => {
        expect(window.budgetBreakdownTitle('category')).toBe('Budget Breakdown: Categories');
        expect(window.budgetBreakdownTitle('main_category')).toBe('Budget Breakdown: Main Categories');
        expect(window.budgetBreakdownTitle('destination')).toBe('Budget Breakdown: Destination Accounts');
    });

    it('offers full vs main category radios in the builder', () => {
        expect(indexHtml).toContain('name="budget-breakdown-by" value="category"');
        expect(indexHtml).toContain('name="budget-breakdown-by" value="main_category"');
        expect(indexHtml).toContain('name="budget-breakdown-by" value="destination"');
    });

    it('omits empty selections and "auto" period', () => {
        const params = window.buildBudgetBreakdownParams({
            startDate: null,
            endDate: null,
            interval: 'auto',
            budgetNames: [],
            accountIds: [],
            excludedCategories: [],
            excludedBudgets: []
        });
        expect(params.get('start')).toBeNull();
        expect(params.get('end')).toBeNull();
        expect(params.get('period')).toBeNull();
        expect(params.getAll('budgets[]')).toEqual([]);
        expect(params.getAll('accounts[]')).toEqual([]);
        expect(params.toString()).not.toContain('exclude_');
    });
});

describe('builder UI wiring (index.html)', () => {
    it('offers the budget_breakdown widget type', () => {
        expect(indexHtml).toContain('<option value="budget_breakdown">Budget Breakdown</option>');
    });

    it('has a "break down by" radio group with category (checked) and destination', () => {
        expect(indexHtml).toContain('id="budget-breakdown-options-group"');
        expect(indexHtml).toContain('name="budget-breakdown-by" value="category" checked');
        expect(indexHtml).toContain('name="budget-breakdown-by" value="destination"');
    });

    it('registers budget_breakdown as excludable and stackable in app.js', () => {
        expect(appSource).toMatch(/const EXCLUDABLE_WIDGET_TYPES = \[[^\]]*'budget_breakdown'\];/);
        expect(appSource).toMatch(/const STACKABLE_WIDGET_TYPES = \[[^\]]*'budget_breakdown'\];/);
    });

    it('shows the budgets section for budget_breakdown', () => {
        expect(appSource).toContain(
            "const budgetsApplies = widgetType === 'budget_spent' || widgetType === 'label_spend' || widgetType === 'budget_breakdown';"
        );
    });

    it('requires a budget selection when saving a budget_breakdown widget', () => {
        expect(appSource).toContain(
            "if (widgetType === 'budget_breakdown' && selectedBudgetNames.length === 0) {"
        );
        expect(appSource).toContain("OxiUI.toast('Please select at least one budget', 'error');");
    });

    it('persists budget_breakdown_by for the type when saving', () => {
        expect(appSource).toContain(
            "budget_breakdown_by: widgetType === 'budget_breakdown' ? getBudgetBreakdownBy() : null,"
        );
    });
});
