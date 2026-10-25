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
    (0, eval)(readFileSync(path.resolve(root, 'static/ui.js'), 'utf8')); // window.OxiUI
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


function renderSettings(widget, context = {}) {
    document.body.innerHTML = window.buildWidgetSettingsHtml(widget, {
        exclusionOptions: { categories: ['Dining', 'Dining:Bars'], budgets: ['Groceries', 'Fun'] },
        ...context
    });
    return document.getElementById(`${widget.id}-settings`);
}

describe('dashboard.js wiring', () => {
    it('fetches subscription cost from /api/subscriptions/spend', () => {
        expect(dashboardSource).toContain("widgetType === 'subscription_cost'");
        expect(dashboardSource).toContain('/api/subscriptions/spend?');
    });

    it('shows the Subscription Cost type badge', () => {
        expect(globalThis.widgetTypeBadgeHtml({ widget_type: 'subscription_cost' }))
            .toBe('<span class="widget-type-badge subscription-cost">Subscription Cost</span>');
    });

    it('offers subscription + group pickers in the widget settings', () => {
        const panel = renderSettings(
            { id: 's1', widget_type: 'subscription_cost', accounts: [], subscription_ids: ['b2'], subscription_group_ids: ['g1'] },
            { subscriptionOptions: {
                subscriptions: [{ id: 'b1', name: 'Netflix' }, { id: 'b2', name: 'Spotify' }],
                groups: [{ id: 'g1', name: 'Streaming', bill_count: 2 }]
            } }
        );
        expect(Array.from(panel.querySelector('#s1-subscriptions').selectedOptions).map(o => o.value)).toEqual(['b2']);
        expect(Array.from(panel.querySelector('#s1-subscription-groups').selectedOptions).map(o => o.value)).toEqual(['g1']);
    });

    it('persists the selections on update', () => {
        expect(dashboardSource).toContain('widget.subscription_ids = Array.from(subsEl.selectedOptions).map(o => o.value);');
        expect(dashboardSource).toContain('widget.subscription_group_ids = Array.from(subGroupsEl.selectedOptions).map(o => o.value);');
    });

    it('offers a split-groups toggle in the widget settings and persists it', () => {
        const widget = { id: 's2', widget_type: 'subscription_cost', accounts: [] };
        const panel = renderSettings(widget);
        const split = panel.querySelector('#s2-subscription-split');
        expect(split.closest('label').textContent).toContain('Split selected groups into individual subscriptions');
        split.checked = true;
        window.readWidgetSettings('s2', widget);
        expect(widget.subscription_split_groups).toBe(true);
    });

    it('supports stacking and exclusions for subscription_cost', () => {
        const panel = renderSettings({ id: 's3', widget_type: 'subscription_cost', accounts: [] });
        expect(panel.querySelector('#s3-stacked')).not.toBeNull();
        expect(panel.querySelector('#s3-exclude-categories')).not.toBeNull();
    });
});
