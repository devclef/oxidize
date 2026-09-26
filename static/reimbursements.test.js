// @vitest-environment jsdom
/**
 * Reimbursements page (/reimbursements): the page must let the user mark
 * work-expense categories/budgets and reimbursement categories, pick a
 * period, persist both in localStorage, and send the markers to the API as
 * expense_categories[] / expense_budgets[] / reimbursement_categories[].
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = readFileSync(path.resolve(root, 'static/reimbursements.html'), 'utf8');

describe('reimbursements page markup', () => {
    it('links to the page from the main nav', () => {
        expect(html).toContain('<a href="/reimbursements" class="active">Reimbursements</a>');
    });

    it('has the three marker check lists', () => {
        expect(html).toContain('id="expense-category-list"');
        expect(html).toContain('id="expense-budget-list"');
        expect(html).toContain('id="reimbursement-category-list"');
    });

    it('offers select-all/clear actions per marker list', () => {
        expect(html).toContain('data-target="expense_categories" data-action="select-all"');
        expect(html).toContain('data-target="expense_categories" data-action="clear"');
        expect(html).toContain('data-target="expense_budgets" data-action="select-all"');
        expect(html).toContain('data-target="expense_budgets" data-action="clear"');
        expect(html).toContain('data-target="reimbursement_categories" data-action="select-all"');
        expect(html).toContain('data-target="reimbursement_categories" data-action="clear"');
    });

    it('has period presets plus custom start/end date inputs', () => {
        for (const preset of ['this-month', 'last-month', '3m', '6m', '12m', 'ytd']) {
            expect(html).toContain(`data-preset="${preset}"`);
        }
        expect(html).toContain('id="custom-start"');
        expect(html).toContain('id="custom-end"');
    });

    it('has KPI cards, chart, monthly table and both breakdowns', () => {
        expect(html).toContain('id="kpi-cards"');
        expect(html).toContain('id="reimbChart"');
        expect(html).toContain('id="monthly-body"');
        expect(html).toContain('id="expense-breakdown"');
        expect(html).toContain('id="reimb-breakdown"');
    });
});

describe('reimbursements page wiring', () => {
    it('persists markers and the period in localStorage', () => {
        expect(html).toContain("const STORAGE_KEY = 'oxidize.reimbursements'");
        expect(html).toContain('localStorage.getItem(STORAGE_KEY)');
        expect(html).toContain('localStorage.setItem(STORAGE_KEY');
    });

    it('sends the markers as repeatable query params', () => {
        expect(html).toContain("params.set('start', state.range.start)");
        expect(html).toContain("params.set('end', state.range.end)");
        expect(html).toMatch(/params\.append\('expense_categories\[\]', c\)/);
        expect(html).toMatch(/params\.append\('expense_budgets\[\]', b\)/);
        expect(html).toMatch(/params\.append\('reimbursement_categories\[\]', c\)/);
    });

    it('hits the summary endpoint and registers the service worker', () => {
        expect(html).toContain('/api/reimbursements/summary?');
        expect(html).toContain('navigator.serviceWorker.register');
    });

    it('loads marker options from the category and budget list endpoints', () => {
        expect(html).toContain("fetch('/api/categories/list')");
        expect(html).toContain("fetch('/api/budgets/list')");
    });

    it('renders parent and Parent:Sub category checkboxes', () => {
        // Parent checkbox value is the bare name...
        expect(html).toMatch(/data-list="' \+ key \+ '" value="' \+ parentVal/);
        // ...and sub checkboxes use the full "Parent:Sub" name
        expect(html).toContain("c.name + ':' + sub");
    });
});
