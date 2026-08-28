// @vitest-environment jsdom
/**
 * Tests for the category/budget exclusion feature.
 *
 * dashboard.js is a classic script, so we evaluate the actual shipped file
 * in a jsdom environment and exercise its exclusion helpers directly
 * (same approach as ui.test.js). We also assert that the HTML pages wire
 * the exclusion controls into the right places.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dashboardSource = readFileSync(path.resolve(root, 'static/dashboard.js'), 'utf8');
const dashboardHtml = readFileSync(path.resolve(root, 'static/dashboard.html'), 'utf8');
const indexHtml = readFileSync(path.resolve(root, 'static/index.html'), 'utf8');
const sankeyHtml = readFileSync(path.resolve(root, 'static/sankey.html'), 'utf8');

beforeAll(() => {
    // Provide the config the script expects, then load the real dashboard.js.
    window.OXIDIZE_CONFIG = { accountTypes: [], autoFetchAccounts: false };
    (0, eval)(dashboardSource); // indirect eval: top-level functions become globals
});

describe('mergeExclusions (dashboard + widget)', () => {
    it('merges dashboard-level and widget-level exclusions', () => {
        const merged = window.mergeExclusions(
            { categories: ['Work Expenses'], budgets: ['Work'] },
            { exclude_categories: ['Travel'], exclude_budgets: ['Dining'] }
        );
        expect(merged.categories).toContain('Work Expenses');
        expect(merged.categories).toContain('Travel');
        expect(merged.budgets).toContain('Work');
        expect(merged.budgets).toContain('Dining');
    });

    it('dedupes overlapping entries', () => {
        const merged = window.mergeExclusions(
            { categories: ['Work Expenses'], budgets: [] },
            { exclude_categories: ['Work Expenses'], exclude_budgets: [] }
        );
        expect(merged.categories.filter(c => c === 'Work Expenses')).toHaveLength(1);
    });

    it('handles missing fields on legacy widgets and dashboards', () => {
        const merged = window.mergeExclusions({ categories: [], budgets: [] }, {});
        expect(merged.categories).toHaveLength(0);
        expect(merged.budgets).toHaveLength(0);
    });

    it('handles null dashboard exclusions', () => {
        const merged = window.mergeExclusions(null, { exclude_categories: ['A'], exclude_budgets: [] });
        expect(merged.categories).toEqual(['A']);
    });
});

describe('appendExclusionParams', () => {
    it('appends repeatable exclude_categories[] and exclude_budgets[] params', () => {
        const params = new URLSearchParams();
        params.append('start', '2026-01-01');
        window.appendExclusionParams(params, {
            categories: ['Work Expenses', 'Travel'],
            budgets: ['Work']
        });
        expect(params.getAll('exclude_categories[]')).toEqual(['Work Expenses', 'Travel']);
        expect(params.getAll('exclude_budgets[]')).toEqual(['Work']);
        expect(params.get('start')).toBe('2026-01-01');
    });

    it('appends nothing when there are no exclusions', () => {
        const params = new URLSearchParams();
        window.appendExclusionParams(params, { categories: [], budgets: [] });
        expect(params.toString()).toBe('');
    });
});

describe('buildCategoryOptionNames', () => {
    it('offers main categories plus Parent:Sub entries', () => {
        const names = window.buildCategoryOptionNames([
            { name: 'Work Expenses', subcategories: ['Reimbursed', 'Travel'] },
            { name: 'Groceries', subcategories: [] }
        ]);
        expect(names).toContain('Work Expenses');
        expect(names).toContain('Work Expenses:Reimbursed');
        expect(names).toContain('Work Expenses:Travel');
        expect(names).toContain('Groceries');
        expect(names).toHaveLength(4);
    });
});

describe('HTML wiring', () => {
    it('dashboard page has the exclusions modal and header button', () => {
        expect(dashboardHtml).toContain('id="exclusions-modal-overlay"');
        expect(dashboardHtml).toContain('id="dash-exclude-categories"');
        expect(dashboardHtml).toContain('id="dash-exclude-budgets"');
        expect(dashboardHtml).toContain('id="dashboard-exclusions-toggle"');
    });

    it('dashboard.js renders per-widget exclusion selects and sends them to the API', () => {
        expect(dashboardSource).toContain('${widget.id}-exclude-categories');
        expect(dashboardSource).toContain('${widget.id}-exclude-budgets');
        // Every category/budget-aware widget type must send exclusions
        const urlCount =
            (dashboardSource.match(/appendExclusionParams\(params, mergeExclusions\(dashboardExclusions, widget\)\);/g) || []).length;
        expect(urlCount).toBeGreaterThanOrEqual(5); // earned_spent, spent-history, subcat, expenses, sankey
        // Widget update persists the fields
        expect(dashboardSource).toContain('widget.exclude_categories = Array.from(exclCatsEl.selectedOptions)');
        expect(dashboardSource).toContain('widget.exclude_budgets = Array.from(exclBudgetsEl.selectedOptions)');
    });

    it('graph builder exposes exclusion selects and wires them into chart + save', () => {
        expect(indexHtml).toContain('id="exclude-categories-select"');
        expect(indexHtml).toContain('id="exclude-budgets-select"');
        const appSource = readFileSync(path.resolve(root, 'static/app.js'), 'utf8');
        expect(appSource).toContain('exclude_categories: getExcludedCategories(),');
        expect(appSource).toContain('exclude_budgets: getExcludedBudgets(),');
    });

    it('sankey page exposes exclusion selects and wires them into the flow request', () => {
        expect(sankeyHtml).toContain('id="exclude-categories-select"');
        expect(sankeyHtml).toContain('id="exclude-budgets-select"');
        expect(sankeyHtml).toContain('appendSankeyExclusionParams(params);');
        expect(sankeyHtml).toContain('exclude_categories: getSankeyExcludedCategories(),');
        expect(sankeyHtml).toContain('exclude_budgets: getSankeyExcludedBudgets(),');
    });
});
