// @vitest-environment jsdom
/**
 * Tests for the "Subscription Cost" widget type (subscription_cost) in the
 * Widget Builder. We evaluate the real shipped app.js in a jsdom
 * environment (classic script -> top-level functions become globals)
 * and exercise its subscription helpers (same approach as
 * label-spend-app.test.js).
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

describe('buildSubscriptionSpendParams (GET /api/subscriptions/spend)', () => {
    it('builds the full query string with all options', () => {
        const params = window.buildSubscriptionSpendParams({
            startDate: '2026-01-01',
            endDate: '2026-03-31',
            interval: '1M',
            subscriptionIds: ['7', '8'],
            groupIds: ['og1'],
            accountIds: ['acc-1'],
            excludedCategories: ['Dining:Bars'],
            excludedBudgets: ['Work']
        });
        const q = params.toString();
        expect(q).toContain('start=2026-01-01');
        expect(q).toContain('end=2026-03-31');
        expect(q).toContain('period=1M');
        expect(q).toContain('subscriptions%5B%5D=7');
        expect(q).toContain('subscriptions%5B%5D=8');
        expect(q).toContain('groups%5B%5D=og1');
        expect(q).toContain('accounts%5B%5D=acc-1');
        expect(q).toContain('exclude_categories%5B%5D=Dining%3ABars');
        expect(q).toContain('exclude_budgets%5B%5D=Work');
    });

    it('omits empty selections (no selection = all subscriptions) and "auto" period', () => {
        const params = window.buildSubscriptionSpendParams({
            startDate: null,
            endDate: null,
            interval: 'auto',
            subscriptionIds: [],
            groupIds: [],
            accountIds: [],
            excludedCategories: [],
            excludedBudgets: []
        });
        expect(params.get('start')).toBeNull();
        expect(params.get('end')).toBeNull();
        expect(params.get('period')).toBeNull();
        expect(params.getAll('subscriptions[]')).toEqual([]);
        expect(params.getAll('groups[]')).toEqual([]);
        expect(params.getAll('accounts[]')).toEqual([]);
        expect(params.getAll('exclude_categories[]')).toEqual([]);
        expect(params.getAll('exclude_budgets[]')).toEqual([]);
    });

    it('tolerates missing option lists (undefined)', () => {
        const params = window.buildSubscriptionSpendParams({});
        // Only the split flag is always present (default: groups not split)
        expect(params.toString()).toBe('split_groups=0');
    });

    it('appends split_groups=0 by default and 1 when splitting groups', () => {
        const base = {
            startDate: '2026-01-01',
            endDate: '2026-03-31',
            interval: '1M',
            subscriptionIds: ['7'],
            groupIds: ['og1'],
            accountIds: [],
            excludedCategories: [],
            excludedBudgets: []
        };
        const def = window.buildSubscriptionSpendParams(base);
        expect(def.get('split_groups')).toBe('0');
        const split = window.buildSubscriptionSpendParams({ ...base, splitGroups: true });
        expect(split.get('split_groups')).toBe('1');
    });

    it('repeats repeatable params for multiple subscriptions/groups', () => {
        const params = window.buildSubscriptionSpendParams({
            subscriptionIds: ['1', '2', '3'],
            groupIds: ['a', 'b']
        });
        expect(params.getAll('subscriptions[]')).toEqual(['1', '2', '3']);
        expect(params.getAll('groups[]')).toEqual(['a', 'b']);
    });
});

describe('index.html wiring', () => {
    it('offers the Subscription Cost widget type', () => {
        expect(indexHtml).toContain('<option value="subscription_cost">Subscription Cost</option>');
    });

    it('has the subscriptions section (hidden by default) with picker + groups', () => {
        expect(indexHtml).toContain('id="subscriptions-section"');
        expect(indexHtml).toContain('id="subscriptions-list"');
        expect(indexHtml).toContain('id="subscription-groups-list"');
        expect(indexHtml).toContain('id="subscription-search-input"');
        expect(indexHtml).toContain('id="select-all-subscriptions-btn"');
        expect(indexHtml).toContain('id="deselect-all-subscriptions-btn"');
    });

    it('offers the split-groups display toggle', () => {
        expect(indexHtml).toContain('id="subscription-split-checkbox"');
        expect(indexHtml).toContain('Split selected groups into individual subscriptions');
    });
});
