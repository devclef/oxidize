// @vitest-environment jsdom
/**
 * Dashboard fixes for the open findings of docs/chart-options-audit.md:
 *  O1/O2  relative date ranges + end-date rounding are saved and worked
 *         out at render time
 *  O3     category selection and widget type can be changed in settings
 *  O4     header tags/badges follow a saved update without a reload
 *  O6     % change previews live but is only saved on "Update"
 *  O11    sankey widgets explain a blocked d3 instead of a vague error
 *
 * The real shipped scripts are evaluated (classic scripts -> globals) with
 * Chart.js and fetch stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (f) => readFileSync(path.resolve(process.cwd(), f), 'utf8');

class MockChart {
    constructor(ctx, config) {
        this.config = config;
        this.data = config.data;
        this.options = config.options;
        this.update = vi.fn();
        this.destroy = vi.fn();
        this.resize = vi.fn();
    }
}

let dash;

beforeAll(() => {
    window.OXIDIZE_CONFIG = { accountTypes: [], timeRanges: ['7d', '30d', 'ytd'] };
    global.Chart = MockChart;
    HTMLCanvasElement.prototype.getContext = () => ({});
    (0, eval)(read('static/date-utils.js'));
    (0, eval)(read('static/ui.js'));
    (0, eval)(read('static/sankey-chart.js'));
    (0, eval)(read('static/dashboard.js') + `
;window.__oxiDash = {
    buildWidgetCardHtml, wireWidgetSettings, readWidgetSettings, updateWidgetDateRange,
    changeWidgetSettingsType, renderWidgetChart, refreshWidgetCard,
    get widgetCharts() { return widgetCharts; },
    setWidgetsCache(v) { widgetsCache = v; },
    setContext(v) { widgetSettingsContext = v; },
    setDashboardDates(v) { dashboardDates = v; }
};`);
    dash = window.__oxiDash;
});

const CONTEXT = {
    allAccounts: [{ id: '1', name: 'Checking' }],
    allGroups: [],
    exclusionOptions: {
        categories: ['Dining', 'Dining:Bars'],
        categoryTree: [
            { name: 'Dining', subcategories: ['Bars', 'Takeout'] },
            { name: 'Groceries', subcategories: ['Market'] }
        ],
        budgets: ['Fun', 'Food']
    },
    subscriptionOptions: { subscriptions: [], groups: [] }
};

function mountCard(widget) {
    dash.setContext(CONTEXT);
    dash.setWidgetsCache([widget]);
    document.body.innerHTML = '<div class="dashboard-grid">' + dash.buildWidgetCardHtml(widget, CONTEXT) + '</div>';
    dash.wireWidgetSettings(widget, CONTEXT);
}

const $ = (id) => document.getElementById(id);
const change = (el) => el.dispatchEvent(new Event('change'));

// fetch router: GET /api/widgets returns `stored`, PUT echoes, the rest is empty
function mockApi(stored) {
    global.fetch = vi.fn(async (url, init) => {
        if (init && init.method === 'PUT') return { ok: true, json: async () => JSON.parse(init.body), text: async () => '' };
        if (url === '/api/widgets') return { ok: true, json: async () => stored };
        return { ok: true, json: async () => [] };
    });
    return global.fetch;
}

function putBody() {
    const call = global.fetch.mock.calls.find(([, init]) => init && init.method === 'PUT');
    return call ? JSON.parse(call[1].body) : null;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    dash.setDashboardDates({ start: null, end: null });
    window.OxiUI.toast = vi.fn();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('O1/O2: relative date ranges in the widget settings', () => {
    it('shows a saved relative range and its rounding, with today\'s dates', () => {
        mountCard({ id: 'r1', widget_type: 'balance', accounts: ['1'], relative_range: '30d',
            round_end_mode: 'end_of_current_month', start_date: '2026-01-01', end_date: '2026-01-31' });
        expect($('r1-time-range').value).toBe('30d');
        expect($('r1-time-range').dataset.relativeRange).toBe('30d');
        expect($('r1-round-end').checked).toBe(true);
        expect($('r1-round-end-mode').value).toBe('end_of_current_month');
        expect($('r1-start').value).toBe('2026-09-25');
        expect($('r1-end').value).toBe('2026-10-31');
    });

    it('saves the picked preset and rounding mode', () => {
        const widget = { id: 'r2', widget_type: 'balance', accounts: ['1'], start_date: '2026-01-01', end_date: '2026-01-31' };
        mountCard(widget);
        expect($('r2-time-range').value).toBe('__fixed__');
        $('r2-time-range').value = '7d';
        change($('r2-time-range'));
        $('r2-round-end').checked = true;
        change($('r2-round-end'));
        $('r2-round-end-mode').value = 'start_of_next_month';
        change($('r2-round-end-mode'));
        const saved = dash.readWidgetSettings('r2', { ...widget });
        expect(saved.relative_range).toBe('7d');
        expect(saved.round_end_mode).toBe('start_of_next_month');
        expect(saved.start_date).toBe('2026-10-18');
        expect(saved.end_date).toBe('2026-11-01');
    });

    it('saves a custom "last N" range', () => {
        const widget = { id: 'r3', widget_type: 'earned_spent', accounts: [] };
        mountCard(widget);
        $('r3-time-range').value = '__none__';
        change($('r3-time-range'));
        expect($('r3-custom-range').style.display).toBe('block');
        $('r3-custom-count').value = '3';
        $('r3-custom-unit').value = 'weeks';
        $('r3-apply-custom-range').click();
        const saved = dash.readWidgetSettings('r3', { ...widget });
        expect(saved.relative_range).toBe('custom:3:weeks');
        expect(saved.round_end_mode).toBeNull();
        expect(saved.start_date).toBe('2026-10-04');
    });

    it('restores a saved custom range into the "last N" inputs', () => {
        mountCard({ id: 'r4', widget_type: 'balance', accounts: ['1'], relative_range: 'custom:6:months' });
        expect($('r4-time-range').value).toBe('__none__');
        expect($('r4-custom-count').value).toBe('6');
        expect($('r4-custom-unit').value).toBe('months');
        expect($('r4-start').value).toBe('2026-04-25');
    });

    it('typing a date pins the range (fixed dates, no rounding saved)', () => {
        const widget = { id: 'r5', widget_type: 'balance', accounts: ['1'], relative_range: '30d', round_end_mode: 'end_of_current_month' };
        mountCard(widget);
        $('r5-start').value = '2026-02-01';
        change($('r5-start'));
        expect($('r5-time-range').value).toBe('__fixed__');
        const saved = dash.readWidgetSettings('r5', { ...widget });
        expect(saved.relative_range).toBeNull();
        expect(saved.round_end_mode).toBeNull();
        expect(saved.start_date).toBe('2026-02-01');
    });

    it('treats an older widget whose dates are exactly a preset today as that preset', () => {
        const d = window.resolveRelativeRange('30d');
        const widget = { id: 'r6', widget_type: 'balance', accounts: ['1'], start_date: d.start, end_date: d.end };
        mountCard(widget);
        expect($('r6-time-range').value).toBe('30d');
        expect(dash.readWidgetSettings('r6', { ...widget }).relative_range).toBe('30d');
    });

    it('adds a saved preset that is not in the configured list', () => {
        mountCard({ id: 'r7', widget_type: 'balance', accounts: ['1'], relative_range: '2w' });
        expect($('r7-time-range').value).toBe('2w');
        expect($('r7-time-range').selectedOptions[0].textContent).toBe('2 Weeks');
    });

    it('disables the own range while inheriting, and restores it when switching back', () => {
        dash.setDashboardDates({ start: '2026-01-01', end: '2026-03-31' });
        mountCard({ id: 'r8', widget_type: 'balance', accounts: ['1'], date_range_source: 'dashboard', relative_range: '7d' });
        expect($('r8-start').value).toBe('2026-01-01');
        expect($('r8-time-range').disabled).toBe(true);
        expect($('r8-round-end').disabled).toBe(true);
        const custom = document.querySelector('input[name="r8-date-source"][value="custom"]');
        custom.checked = true;
        change(custom);
        expect($('r8-time-range').disabled).toBe(false);
        expect($('r8-start').value).toBe('2026-10-18');
    });

    it('charts the relative range worked out for today, not the stale saved dates', async () => {
        document.body.innerHTML = '<div id="w-error"></div><canvas id="w"></canvas>';
        const fetch = mockApi([]);
        await dash.renderWidgetChart({ id: 'w', widget_type: 'balance', accounts: ['1'], relative_range: '30d',
            start_date: '2025-01-01', end_date: '2025-01-31' }, 'w', [], []);
        const url = fetch.mock.calls.map(c => c[0]).find(u => u.startsWith('/api/accounts/balance-history'));
        expect(url).toContain('start=2026-09-25');
        expect(url).toContain('end=2026-10-25');
    });
});

describe('O3: categories and widget type in the dashboard settings', () => {
    it('offers the category tree and saves subcategories with their main categories', () => {
        const widget = { id: 'c1', widget_type: 'category_subcat', accounts: [],
            parent_categories: ['Dining', 'Old'], subcategories: ['Dining:Bars', 'Old:Gone'] };
        mountCard(widget);
        const select = $('c1-categories');
        expect(Array.from(select.querySelectorAll('optgroup')).map(g => g.label)).toEqual(['Dining', 'Groceries', 'Old']);
        // A subcategory the category list no longer has stays selected
        expect(Array.from(select.selectedOptions).map(o => o.value)).toEqual(['Dining:Bars', 'Old:Gone']);
        Array.from(select.options).forEach(o => { o.selected = ['Dining:Takeout', 'Groceries:Market'].includes(o.value); });
        const saved = dash.readWidgetSettings('c1', { ...widget });
        expect(saved.subcategories).toEqual(['Dining:Takeout', 'Groceries:Market']);
        expect(saved.parent_categories).toEqual(['Dining', 'Groceries']);
    });

    it('only shows the category picker for category subcategory widgets', () => {
        mountCard({ id: 'c2', widget_type: 'expenses_by_category', accounts: [] });
        expect($('c2-categories')).toBeNull();
    });

    it('switching the type rebuilds the panel with that type\'s controls and keeps it open', async () => {
        const widget = { id: 't1', widget_type: 'expenses_by_category', accounts: ['1'], interval: '1W', chart_options: {} };
        mountCard(widget);
        $('t1-settings').style.display = 'flex';
        expect($('t1-graph-mode')).not.toBeNull();
        expect($('t1-budgets')).toBeNull();
        $('t1-interval').value = '1M';

        $('t1-widget-type').value = 'budget_breakdown';
        change($('t1-widget-type'));
        await vi.waitFor(() => expect($('t1-budgets')).not.toBeNull());
        expect($('t1-graph-mode')).toBeNull();
        expect($('t1-budget-breakdown-by')).not.toBeNull();
        expect($('t1-settings').style.display).toBe('flex');
        expect($('t1-widget-type').value).toBe('budget_breakdown');
        // What was entered before the switch is kept
        expect($('t1-interval').value).toBe('1M');
    });

    it('saves the new type on "Update" and refreshes the badges (O4)', async () => {
        const widget = { id: 't2', name: 'W', widget_type: 'balance', accounts: ['1'], chart_options: {} };
        mountCard(widget);
        expect(document.querySelector('.widget-type-badge').textContent).toBe('Balance');
        mockApi([widget]);
        $('t2-widget-type').value = 'net_worth';
        change($('t2-widget-type'));
        await vi.waitFor(() => expect($('t2-accounts')).toBeNull()); // net worth ignores accounts
        await dash.updateWidgetDateRange('t2');
        expect(putBody().widget_type).toBe('net_worth');
        expect(document.querySelector('.widget-type-badge').textContent).toBe('Net Worth');
        expect(document.querySelector('.widget-mode-badge')).toBeNull();
        expect($('t2-widget-type').value).toBe('net_worth');
        expect($('t2-settings').style.display).toBe('none');
    });

    it('requires a category for category subcategory widgets', async () => {
        const widget = { id: 'c3', widget_type: 'category_subcat', accounts: [], subcategories: ['Dining:Bars'] };
        mountCard(widget);
        mockApi([widget]);
        Array.from($('c3-categories').options).forEach(o => { o.selected = false; });
        await dash.updateWidgetDateRange('c3');
        expect(putBody()).toBeNull();
        expect(window.OxiUI.toast).toHaveBeenCalledWith('Please select at least one category', 'error');
    });
});

describe('O4: header tags follow a saved update', () => {
    it('updates the budget tags and layout badge without a reload', async () => {
        const widget = { id: 'h1', name: 'B', widget_type: 'balance', accounts: ['1'], chart_mode: 'combined', chart_options: {} };
        mountCard(widget);
        expect(document.querySelector('.widget-mode-badge').textContent).toBe('combined');
        mockApi([widget]);
        $('h1-chart-mode').value = 'split';
        await dash.updateWidgetDateRange('h1');
        expect(document.querySelector('.widget-mode-badge').textContent).toBe('split');
        expect(document.querySelector('.widget-account-tag').textContent).toBe('Checking');
    });

    it('drops the Chart.js chart when the widget becomes a sankey', () => {
        mountCard({ id: 'h3', widget_type: 'balance', accounts: ['1'] });
        const chart = new MockChart({}, { data: { datasets: [] }, options: {} });
        dash.widgetCharts.h3 = chart;
        dash.refreshWidgetCard({ id: 'h3', widget_type: 'sankey', accounts: ['1'] });
        expect(chart.destroy).toHaveBeenCalled();
        expect(dash.widgetCharts.h3).toBeUndefined();
        expect($('h3').style.display).toBe('none');
        expect($('h3-sankey').style.display).toBe('');
    });

    it('escapes names in tags and titles', () => {
        mountCard({ id: 'h2', name: '<b>x</b>', widget_type: 'balance', accounts: ['9'], budget_names: ['<i>y</i>'] });
        expect(document.querySelector('.widget-title').innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;');
        dash.refreshWidgetCard({ id: 'h2', widget_type: 'budget_spent', accounts: [], budget_names: ['<i>y</i>'] });
        expect(document.querySelector('.widget-type-badge').textContent).toBe('Budget Spent');
    });
});

describe('O6: % change is saved with the other settings', () => {
    it('previews immediately but does not save on its own', () => {
        const widget = { id: 'p1', widget_type: 'net_worth', accounts: [], chart_options: {} };
        mountCard(widget);
        const chart = new MockChart({}, { data: { datasets: [] }, options: {} });
        dash.widgetCharts.p1 = chart;
        const fetch = mockApi([widget]);
        $('p1-show-pct').checked = true;
        change($('p1-show-pct'));
        expect(chart.__pctOpts).toEqual({ enabled: true, mode: 'from_previous' });
        expect(chart.update).toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(dash.readWidgetSettings('p1', { ...widget }).chart_options.show_pct).toBe(true);
    });
});

describe('O11: sankey widgets without d3', () => {
    it('explains that the chart library is blocked and does not fetch', async () => {
        delete global.d3;
        document.body.innerHTML = '<div id="s-error"></div><canvas id="s"></canvas><div id="s-sankey"></div>';
        const fetch = mockApi([]);
        await dash.renderWidgetChart({ id: 's', widget_type: 'sankey', accounts: ['1'] }, 's', [], []);
        expect($('s-error').textContent).toBe(window.OxiSankey.unavailableMessage);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('OxiSankey.render shows the same message and the empty state', () => {
        const el = document.createElement('div');
        expect(window.OxiSankey.render(el, { links: [] })).toBe('unavailable');
        expect(el.textContent).toContain('could not be loaded');
        global.d3 = { sankey: () => {}, sankeyLinkHorizontal: () => {} };
        expect(window.OxiSankey.available()).toBe(true);
        expect(window.OxiSankey.render(el, { links: [] })).toBe('empty');
        expect(el.textContent).toBe('No flow data for the selected filters.');
        delete global.d3;
    });
});
