// @vitest-environment jsdom
/**
 * Tests for the "Subscription Cost" widget type (subscription_cost) on the
 * Dashboard. We evaluate the real shipped dashboard.js in a jsdom
 * environment (classic script -> top-level functions become globals)
 * and exercise its subscription helpers (same approach as
 * label-spend-dashboard.test.js).
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

describe('buildSubscriptionWidgetParams (GET /api/subscriptions/spend)', () => {
    const allGroups = [
        { id: 'grp-1', name: 'Everyday', account_ids: ['acc-1', 'acc-2'] },
        { id: 'grp-2', name: 'Unused group', account_ids: ['acc-9'] }
    ];

    it('maps widget fields to the endpoint query', () => {
        const widget = {
            accounts: ['acc-3'],
            group_ids: ['grp-1'],
            subscription_ids: ['7', '8'],
            subscription_group_ids: ['og1'],
            interval: '1M'
        };
        const params = window.buildSubscriptionWidgetParams(
            widget, '2026-01-01', '2026-03-31', allGroups,
            { categories: [], budgets: [] }
        );
        expect(params.get('start')).toBe('2026-01-01');
        expect(params.get('end')).toBe('2026-03-31');
        expect(params.get('period')).toBe('1M');
        expect(params.getAll('subscriptions[]')).toEqual(['7', '8']);
        expect(params.getAll('groups[]')).toEqual(['og1']);
        // Widget accounts merged with group members (deduped)
        expect(params.getAll('accounts[]').sort()).toEqual(['acc-1', 'acc-2', 'acc-3']);
    });

    it('omits empty selections (no selection = all subscriptions) and "auto" period', () => {
        const widget = {
            accounts: [],
            group_ids: [],
            subscription_ids: [],
            subscription_group_ids: [],
            interval: 'auto'
        };
        const params = window.buildSubscriptionWidgetParams(
            widget, null, null, allGroups, null
        );
        expect(params.get('start')).toBeNull();
        expect(params.get('end')).toBeNull();
        expect(params.get('period')).toBeNull();
        expect(params.getAll('subscriptions[]')).toEqual([]);
        expect(params.getAll('groups[]')).toEqual([]);
        expect(params.getAll('accounts[]')).toEqual([]);
    });

    it('merges dashboard-level exclusions with the widget exclusions', () => {
        const widget = {
            accounts: ['acc-1'],
            group_ids: [],
            subscription_ids: [],
            subscription_group_ids: [],
            interval: '1M',
            exclude_categories: ['Dining:Bars'],
            exclude_budgets: ['Work']
        };
        const params = window.buildSubscriptionWidgetParams(
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
        const params = window.buildSubscriptionWidgetParams(
            legacy, null, '2026-12-31', allGroups, null
        );
        expect(params.get('end')).toBe('2026-12-31');
        expect(params.getAll('subscriptions[]')).toEqual([]);
        expect(params.getAll('groups[]')).toEqual([]);
        expect(params.getAll('accounts[]')).toEqual(['acc-5']);
    });

    it('appends split_groups=0 by default and 1 when the widget splits groups', () => {
        const widget = {
            accounts: [],
            group_ids: [],
            subscription_ids: [],
            subscription_group_ids: ['og1'],
            interval: '1M'
        };
        const def = window.buildSubscriptionWidgetParams(
            widget, '2026-01-01', '2026-03-31', allGroups, null
        );
        expect(def.get('split_groups')).toBe('0');

        widget.subscription_split_groups = true;
        const split = window.buildSubscriptionWidgetParams(
            widget, '2026-01-01', '2026-03-31', allGroups, null
        );
        expect(split.get('split_groups')).toBe('1');
    });
});

describe('dashboard.js wiring', () => {
    it('fetches subscription cost from /api/subscriptions/spend', () => {
        expect(dashboardSource).toContain("widgetType === 'subscription_cost'");
        expect(dashboardSource).toContain('/api/subscriptions/spend?');
    });

    it('shows the Subscription Cost type badge', () => {
        expect(dashboardSource).toContain('widget-type-badge subscription-cost');
    });

    it('offers subscription + group pickers in the widget settings', () => {
        expect(dashboardSource).toContain('id="${widget.id}-subscriptions"');
        expect(dashboardSource).toContain('id="${widget.id}-subscription-groups"');
    });

    it('persists the selections on update', () => {
        expect(dashboardSource).toContain('widget.subscription_ids = Array.from(subsEl.selectedOptions).map(o => o.value);');
        expect(dashboardSource).toContain('widget.subscription_group_ids = Array.from(subGroupsEl.selectedOptions).map(o => o.value);');
    });

    it('offers a split-groups toggle in the widget settings and persists it', () => {
        expect(dashboardSource).toContain('id="${widget.id}-subscription-split"');
        expect(dashboardSource).toContain('Split selected groups into individual subscriptions');
        expect(dashboardSource).toContain('widget.subscription_split_groups = subSplitEl.checked;');
    });

    it('supports stacking and exclusions for subscription_cost', () => {
        expect(dashboardSource).toContain("'label_spend', 'subscription_cost', 'budget_breakdown'].includes(widgetType) ? `");
    });
});
