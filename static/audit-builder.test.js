// @vitest-environment jsdom
/**
 * Widget Builder fixes for the open findings of docs/chart-options-audit.md:
 *  O1/O2  presets / "last N" ranges and end-date rounding are saved
 *  O7     the Accounts section hides for widget types that ignore accounts
 *  O8     Sankey widgets can be built here (flow type, preview, save)
 *  O10    "Reset to defaults" for the remembered display options
 *
 * The page is booted for real: index.html's body, the shipped scripts and a
 * DOMContentLoaded event, with Chart.js and fetch stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const read = (f) => readFileSync(path.resolve(process.cwd(), f), 'utf8');
const indexHtml = read('static/index.html');

class MockChart {
    constructor(ctx, config) {
        this.config = config;
        this.data = config.data;
        this.options = config.options;
        this.update = vi.fn();
        this.destroy = vi.fn();
    }
    static register() {}
}

const $ = (id) => document.getElementById(id);
const change = (el) => el.dispatchEvent(new Event('change'));

let app;

function mockApi() {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' }));
    return global.fetch;
}

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    localStorage.clear();
    window.OXIDIZE_CONFIG = { accountTypes: ['asset'], autoFetchAccounts: false, timeRanges: ['7d', '30d', 'ytd'], defaultTimeRange: 'ytd' };
    global.Chart = MockChart;
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    HTMLCanvasElement.prototype.getContext = () => ({});
    mockApi();
    const body = indexHtml.slice(indexHtml.indexOf('<body'), indexHtml.lastIndexOf('</body>'));
    document.body.innerHTML = body.replace(/^<body[^>]*>/, '');
    (0, eval)(read('static/theme.js'));
    (0, eval)(read('static/date-utils.js'));
    (0, eval)(read('static/ui.js'));
    (0, eval)(read('static/sankey-chart.js'));
    (0, eval)(read('static/app.js') + `
;window.__oxiApp = {
    saveGraphAsWidget, fetchChartData, applyBuilderOptionVisibility,
    get relativeRange() { return builderRelativeRange; }
};`);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    app = window.__oxiApp;
});

afterAll(() => {
    vi.useRealTimers();
});

beforeEach(() => {
    mockApi();
    window.OxiUI.toast = vi.fn();
});

function selectType(type) {
    $('widget-type-select').value = type;
    change($('widget-type-select'));
}

function addAccount(id) {
    $('app').innerHTML = `<input type="checkbox" class="account-select" value="${id}" checked>`;
}

async function savedWidget(name = 'W') {
    $('widget-name-input').value = name;
    await app.saveGraphAsWidget();
    const post = global.fetch.mock.calls.find(([url, init]) => url === '/api/widgets' && init?.method === 'POST');
    return post ? JSON.parse(post[1].body) : null;
}

describe('O1/O2: the builder saves relative ranges', () => {
    it('starts on the configured default preset with matching dates', () => {
        expect($('time-range-select').value).toBe('ytd');
        expect($('start-date').value).toBe('2026-01-01');
        expect($('end-date').value).toBe('2026-10-25');
        expect(app.relativeRange).toBe('ytd');
    });

    it('saves the preset and the rounding mode', async () => {
        selectType('balance');
        addAccount('1');
        $('time-range-select').value = '30d';
        change($('time-range-select'));
        expect($('round-end-controls').style.display).not.toBe('none');
        $('round-end-checkbox').checked = true;
        change($('round-end-checkbox'));
        expect($('end-date').value).toBe('2026-10-31');
        const w = await savedWidget();
        expect(w.relative_range).toBe('30d');
        expect(w.round_end_mode).toBe('end_of_current_month');
        expect(w.start_date).toBe('2026-09-25');
        $('round-end-checkbox').checked = false;
        change($('round-end-checkbox'));
    });

    it('saves a custom "last N" range', async () => {
        selectType('balance');
        addAccount('1');
        $('time-range-select').value = '__none__';
        change($('time-range-select'));
        $('custom-range-count').value = '2';
        $('custom-range-unit').value = 'weeks';
        $('apply-custom-range-btn').click();
        expect($('start-date').value).toBe('2026-10-11');
        const w = await savedWidget();
        expect(w.relative_range).toBe('custom:2:weeks');
        expect(w.round_end_mode).toBeNull();
    });

    it('typing a date saves fixed dates', async () => {
        selectType('balance');
        addAccount('1');
        $('time-range-select').value = '7d';
        change($('time-range-select'));
        $('start-date').value = '2026-03-01';
        change($('start-date'));
        expect($('time-range-select').value).toBe('__fixed__');
        const w = await savedWidget();
        expect(w.relative_range).toBeNull();
        expect(w.start_date).toBe('2026-03-01');
    });

    it('keeps the comparison on the period right before a new preset', () => {
        selectType('balance');
        $('enable-comparison').checked = true;
        change($('enable-comparison'));
        $('time-range-select').value = '7d';
        change($('time-range-select'));
        expect($('comparison-end-date').value).toBe('2026-10-17');
        expect($('comparison-start-date').value).toBe('2026-10-10'); // same 8-day length
        $('enable-comparison').checked = false;
        change($('enable-comparison'));
    });
});

describe('O7: sections follow the option matrix', () => {
    it('hides accounts and groups for net worth', () => {
        selectType('net_worth');
        expect($('account-section').style.display).toBe('none');
        expect($('groups-section').style.display).toBe('none');
        selectType('balance');
        expect($('account-section').style.display).toBe('');
        expect($('groups-section').style.display).toBe('');
    });

    it('shows categories, budgets and subscriptions only for their types', () => {
        selectType('category_subcat');
        expect($('categories-section').style.display).toBe('');
        expect($('budgets-section').style.display).toBe('none');
        selectType('label_spend');
        expect($('categories-section').style.display).toBe('none');
        expect($('budgets-section').style.display).toBe('');
        selectType('subscription_cost');
        expect($('subscriptions-section').style.display).toBe('');
    });
});

describe('O8: Sankey widgets in the builder', () => {
    it('offers the type with its flow type control', () => {
        selectType('sankey');
        expect($('sankey-flow-options-group').style.display).toBe('');
        expect($('interval-select').closest('[data-opt]').style.display).toBe('none');
        expect($('exclusions-row').style.display).toBe('');
        selectType('balance');
        expect($('sankey-flow-options-group').style.display).toBe('none');
    });

    it('saves the flow type and requires an account', async () => {
        selectType('sankey');
        $('app').innerHTML = '';
        expect(await savedWidget()).toBeNull();
        expect(window.OxiUI.toast).toHaveBeenCalledWith('Please select at least one account', 'error');
        addAccount('7');
        $('sankey-flow-type-select').value = 'budget';
        const w = await savedWidget('Flows');
        expect(w.widget_type).toBe('sankey');
        expect(w.sankey_flow_type).toBe('budget');
        expect(w.accounts).toEqual(['7']);
        // Same height the retired Sankey page saved its widgets with
        expect(w.chart_height).toBe(500);
    });

    it('previews the flows with the shared renderer', async () => {
        selectType('sankey');
        addAccount('7');
        global.d3 = { sankey: () => {}, sankeyLinkHorizontal: () => {} };
        const render = vi.spyOn(window.OxiSankey, 'render').mockReturnValue('ok');
        global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ links: [{ source: 'A', target: 'B', amount: 5 }] }) }));
        $('sankey-flow-type-select').value = 'category';
        $('exclude-categories-select').innerHTML = '<option value="Work" selected>Work</option>';
        await app.fetchChartData();
        const url = global.fetch.mock.calls.map(c => c[0]).find(u => u.startsWith('/api/sankey/flows'));
        expect(url).toContain('flow_type=category');
        expect(url).toContain('exclude_categories%5B%5D=Work');
        expect(url).toContain('accounts%5B%5D=7');
        expect(render).toHaveBeenCalledWith($('sankey-preview'), { links: [{ source: 'A', target: 'B', amount: 5 }] }, expect.any(Object));
        expect($('sankey-preview').style.display).toBe('block');
        expect($('chart-wrapper').style.display).toBe('none');
        render.mockRestore();
        delete global.d3;

        // Leaving the type hides the preview again
        selectType('net_worth');
        await app.fetchChartData();
        expect($('sankey-preview').style.display).toBe('none');
    });

    it('explains a blocked d3 instead of drawing', async () => {
        selectType('sankey');
        addAccount('7');
        await app.fetchChartData();
        expect($('sankey-preview').textContent).toBe(window.OxiSankey.unavailableMessage);
        expect(global.fetch.mock.calls.some(c => String(c[0]).startsWith('/api/sankey/flows'))).toBe(false);
    });
});

describe('the Sankey Flow tab is gone (built here instead)', () => {
    it('no page links to the retired /sankey page', () => {
        const pages = readdirSync(path.resolve(process.cwd(), 'static')).filter(f => f.endsWith('.html'));
        expect(pages).not.toContain('sankey.html');
        for (const page of pages) {
            expect(read(`static/${page}`), page).not.toContain('href="/sankey"');
        }
    });

    it('other widget types keep the default height', async () => {
        selectType('balance');
        addAccount('1');
        const w = await savedWidget('Bal');
        expect(w.chart_height).toBeUndefined();
    });
});

describe('O10: reset the remembered display options', () => {
    it('puts every option back to its default and remembers that', () => {
        selectType('balance');
        const set = (id, prop, value) => { $(id)[prop] = value; change($(id)); };
        set('show-points-toggle', 'checked', true);
        set('fill-area-toggle', 'checked', false);
        set('x-axis-limit', 'value', '11');
        set('tension-range', 'value', '0.7');
        set('enable-trendline', 'checked', true);
        set('trendline-window', 'value', '20');
        set('stacked-toggle', 'checked', true);
        expect(localStorage.getItem('oxidize_show_points')).toBe('true');

        $('reset-display-options-btn').click();

        expect($('show-points-toggle').checked).toBe(false);
        expect($('fill-area-toggle').checked).toBe(true);
        expect($('x-axis-limit').value).toBe('6');
        expect($('tension-range').value).toBe('0.1');
        expect($('enable-trendline').checked).toBe(false);
        expect($('trendline-window').value).toBe('7');
        expect($('stacked-toggle').checked).toBe(false);
        expect(localStorage.getItem('oxidize_show_points')).toBe('false');
        expect(localStorage.getItem('oxidize_trendline_enabled')).toBe('false');
        expect(window.OxiUI.toast).toHaveBeenCalledWith('Display options reset to defaults', 'success');
    });
});
