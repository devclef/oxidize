// @vitest-environment jsdom
/**
 * Chart options & settings audit: every option the Graph Builder and the
 * dashboard widget settings expose must (a) be offered for the same widget
 * types on both pages, (b) be saved with the widget and (c) actually change
 * the rendered chart. The shared rules live in OxiUI.widgetOptionSupport
 * (static/ui.js); see docs/chart-options-audit.md for the findings.
 *
 * The real shipped scripts are evaluated (classic scripts -> globals) with
 * Chart.js and fetch stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (f) => readFileSync(path.resolve(root, f), 'utf8');
const indexHtml = read('static/index.html');

class MockChart {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.data = config.data;
        this.options = config.options;
        this.update = vi.fn();
        this.destroy = vi.fn();
        this.resize = vi.fn();
        MockChart.instances.push(this);
    }
}
MockChart.instances = [];

let dash;

beforeAll(() => {
    window.OXIDIZE_CONFIG = { accountTypes: [], autoFetchAccounts: false, timeRanges: ['30d', 'ytd'] };
    global.Chart = MockChart;
    HTMLCanvasElement.prototype.getContext = () => ({});
    (0, eval)(read('static/date-utils.js'));
    (0, eval)(read('static/ui.js'));
    (0, eval)(read('static/app.js') + `
;window.__oxiApp = {
    applyBuilderOptionVisibility, saveGraphAsWidget, renderExpensesByCategoryChart,
    getDisplayOptions, toggleComparisonControls, fetchChartData,
    get balanceChart() { return balanceChart; }
};`);
    (0, eval)(read('static/dashboard.js') + `
;window.__oxiDash = {
    buildWidgetSettingsHtml, readWidgetSettings, updateWidgetSettingsVisibility,
    wireWidgetSettingsVisibility, renderMultiSeriesWidget, renderWidgetChart,
    showWidgetMessage, updateWidgetDateRange, renderBalanceComparisonChart, matchingTimeRangePreset,
    normalizeChartOptions, getChartOptions, computePercentChange,
    get widgetCharts() { return widgetCharts; },
    get widgetDatasetVisibility() { return widgetDatasetVisibility; },
    get widgetsCache() { return widgetsCache; },
    setWidgetsCache(v) { widgetsCache = v; }
};`);
    dash = window.__oxiDash;
});

const ALL_TYPES = ['balance', 'earned_spent', 'expenses_by_category', 'net_worth', 'budget_spent',
    'category_subcat', 'card_paydown', 'saved_this_month', 'label_spend', 'subscription_cost',
    'budget_breakdown', 'sankey'];
const MULTI_SERIES = ['budget_spent', 'expenses_by_category', 'category_subcat', 'label_spend',
    'subscription_cost', 'budget_breakdown'];

describe('OxiUI.widgetOptionSupport (shared option matrix)', () => {
    const support = (t, s) => window.OxiUI.widgetOptionSupport(t, s);

    it('offers the full line option set for every multi-series type', () => {
        for (const t of MULTI_SERIES) {
            const s = support(t, { chartType: 'line' });
            for (const key of ['chartType', 'stacked', 'pct', 'trendline', 'lineStyle', 'ticks', 'beginAtZero', 'exclusions', 'interval', 'dateRange', 'accounts']) {
                expect(s[key], `${t}.${key}`).toBe(true);
            }
            expect(s.forecast, t).toBe(false);
            expect(s.comparison, t).toBe(false);
            expect(s.layout, t).toBe(false);
        }
    });

    it('drops every line-only option for pie charts', () => {
        for (const t of [...MULTI_SERIES, 'balance', 'earned_spent']) {
            const s = support(t, { chartType: 'pie', chartMode: 'split' });
            expect(s.chartType, t).toBe(true);
            for (const key of ['stacked', 'pct', 'trendline', 'lineStyle', 'ticks', 'beginAtZero', 'forecast', 'comparison', 'layout', 'variant']) {
                expect(s[key], `${t}.${key}`).toBe(false);
            }
        }
    });

    it('keeps forecast, comparison and layout balance-only', () => {
        for (const t of ALL_TYPES) {
            const s = support(t, { chartType: 'line', chartMode: 'split' });
            expect(s.forecast, t).toBe(t === 'balance');
            expect(s.comparison, t).toBe(t === 'balance');
            expect(s.layout, t).toBe(t === 'balance');
        }
    });

    it('only offers stacking for a split balance chart (a combined chart has one series)', () => {
        expect(support('balance', { chartMode: 'combined' }).stacked).toBe(false);
        expect(support('balance', { chartMode: 'split' }).stacked).toBe(true);
    });

    it('does not offer Line/Pie where no pie is implemented', () => {
        for (const t of ['net_worth', 'card_paydown', 'saved_this_month', 'sankey']) {
            expect(support(t).chartType, t).toBe(false);
        }
    });

    it('treats card paydown, sankey and the saved tile as fixed-style views', () => {
        for (const t of ['card_paydown', 'saved_this_month', 'sankey']) {
            const s = support(t);
            for (const key of ['stacked', 'pct', 'trendline', 'lineStyle', 'ticks', 'beginAtZero', 'interval']) {
                expect(s[key], `${t}.${key}`).toBe(false);
            }
        }
        expect(support('saved_this_month').dateRange).toBe(false);
        expect(support('sankey').exclusions).toBe(true);
        expect(support('sankey').sankeyFlow).toBe(true);
    });

    it('limits the earned vs spent line options to what its variants render', () => {
        const bars = support('earned_spent', { variant: 'bars' });
        expect(bars.variant).toBe(true);
        expect(bars.trendline).toBe(true);
        expect(bars.ticks).toBe(true);
        expect(bars.lineStyle).toBe(false);
        expect(bars.pct).toBe(false);
        expect(bars.beginAtZero).toBe(false); // bars always start at zero
        expect(support('earned_spent', { variant: 'delta_line' }).beginAtZero).toBe(true);
    });

    it('net worth has no accounts, budgets or stacking', () => {
        const s = support('net_worth');
        expect(s.accounts).toBe(false);
        expect(s.stacked).toBe(false);
        expect(s.pct).toBe(true);
        expect(s.lineStyle).toBe(true);
    });

    it('scopes type-specific data controls', () => {
        expect(ALL_TYPES.filter(t => support(t).budgets)).toEqual(['budget_spent', 'label_spend', 'budget_breakdown']);
        expect(ALL_TYPES.filter(t => support(t).groupBy)).toEqual(['expenses_by_category', 'category_subcat']);
        expect(ALL_TYPES.filter(t => support(t).includeUnlabeled)).toEqual(['label_spend']);
        expect(ALL_TYPES.filter(t => support(t).breakdownBy)).toEqual(['budget_breakdown']);
        expect(ALL_TYPES.filter(t => support(t).subscriptions)).toEqual(['subscription_cost']);
    });

    it('defaults missing types to balance', () => {
        expect(support(undefined)).toEqual(support('balance'));
    });
});

describe('OxiUI line / axis helpers', () => {
    it('applyLineStyle sets points, fill and smoothness on real series only', () => {
        const ds = [{ label: 'a' }, { label: 'b' }, { label: 'avg', isTrendline: true, tension: 0.3, fill: false }];
        window.OxiUI.applyLineStyle(ds, { showPoints: true, fillArea: true, tension: 0.6, stacked: false });
        expect(ds[0]).toMatchObject({ tension: 0.6, pointRadius: 3, fill: 'origin' });
        expect(ds[1]).toMatchObject({ tension: 0.6, pointRadius: 3, fill: 'origin' });
        expect(ds[2]).toMatchObject({ tension: 0.3, fill: false });
    });

    it('applyLineStyle stacks the fill onto the series below when stacked', () => {
        const ds = [{}, {}, { isForecast: true }, {}];
        window.OxiUI.applyLineStyle(ds, { showPoints: false, fillArea: true, tension: 0, stacked: true });
        expect(ds.map(d => d.fill)).toEqual(['origin', '-1', undefined, '-1']);
        expect(ds[0].pointRadius).toBe(0);
    });

    it('applyLineStyle keeps overlapping fills light and stacked areas stronger', () => {
        const flat = [{ borderColor: '#2a78d6' }];
        window.OxiUI.applyLineStyle(flat, { fillArea: true, stacked: false });
        expect(flat[0].backgroundColor).toBe('#2a78d61a');
        const stacked = [{ borderColor: '#2a78d6' }];
        window.OxiUI.applyLineStyle(stacked, { fillArea: true, stacked: true });
        expect(stacked[0].backgroundColor).toBe('#2a78d659');
    });

    it('applyLineStyle without fill leaves lines unfilled', () => {
        const ds = [{}, {}];
        window.OxiUI.applyLineStyle(ds, { fillArea: false, tension: 0.1 });
        expect(ds.map(d => d.fill)).toEqual([false, false]);
    });

    it('applyAxisOptions sets tick limits and the y baseline', () => {
        const scales = window.OxiUI.applyAxisOptions(
            { x: { ticks: { color: 'c' } }, y: { ticks: {} } },
            { xAxisLimit: 3, yAxisLimit: 5, beginAtZero: true }
        );
        expect(scales.x.ticks).toMatchObject({ color: 'c', maxTicksLimit: 3, autoSkip: true });
        expect(scales.y.ticks.maxTicksLimit).toBe(5);
        expect(scales.y.beginAtZero).toBe(true);
    });

    it('computePercentChange divides by the magnitude of the base', () => {
        expect(window.OxiUI.computePercentChange([100, 110, 99], 'from_previous')).toEqual([null, 10, -10]);
        expect(window.OxiUI.computePercentChange([100, 150, 50], 'from_first')).toEqual([null, 50, -50]);
        // A debt shrinking from -100 to -50 is a +50% improvement
        expect(window.OxiUI.computePercentChange([-100, -50], 'from_previous')).toEqual([null, 50]);
        expect(window.OxiUI.computePercentChange([0, 10, null, 5], 'from_previous')).toEqual([null, null, null, null]);
    });

    it('the dashboard uses the same % change math as the builder', () => {
        expect(dash.computePercentChange([-100, -50], 'from_first')).toEqual([null, 50]);
    });
});

describe('calculatePreviousPeriod (compare with previous period)', () => {
    it('returns the adjacent period of the same length', () => {
        expect(window.calculatePreviousPeriod('2026-03-01', '2026-03-31'))
            .toEqual({ start: '2026-01-29', end: '2026-02-28' });
        expect(window.calculatePreviousPeriod('2026-01-10', '2026-01-10'))
            .toEqual({ start: '2026-01-09', end: '2026-01-09' });
    });

    it('rejects missing or inverted ranges', () => {
        expect(window.calculatePreviousPeriod('', '2026-01-01')).toBeNull();
        expect(window.calculatePreviousPeriod('2026-02-01', '2026-01-01')).toBeNull();
    });
});

// Dashboard setting control (id suffix) <-> Graph Builder control (id) for
// each option key: both pages must show exactly the controls the matrix
// allows for the selected type and style.
const CONTROL_MAP = {
    interval: { dash: 'interval', builder: 'interval-select' },
    layout: { dash: 'chart-mode', builder: 'layout-toggle-group' },
    groupBy: { dash: 'graph-mode', builder: 'category-graph-mode-group' },
    variant: { dash: 'earned-chart-type', builder: 'earned-chart-type-group' },
    includeUnlabeled: { dash: 'include-unlabeled', builder: 'label-spend-options-group' },
    breakdownBy: { dash: 'budget-breakdown-by', builder: 'budget-breakdown-options-group' },
    stacked: { dash: 'stacked', builder: 'stacked-toggle' },
    pct: { dash: 'show-pct', builder: 'show-pct-toggle' },
    comparison: { dash: 'enable-comparison', builder: 'enable-comparison' },
    forecast: { dash: 'enable-forecast', builder: 'enable-forecast' },
    trendline: { dash: 'enable-trendline', builder: 'enable-trendline' },
    lineStyle: { dash: 'show-points', builder: 'show-points-toggle' },
    beginAtZero: { dash: 'begin-zero', builder: 'begin-zero-toggle' },
    ticks: { dash: 'x-limit', builder: 'x-axis-limit' },
    exclusions: { dash: 'exclude-categories', builder: 'exclude-categories-select' }
};

function isShown(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (node.style && node.style.display === 'none') return false;
    }
    return true;
}

function renderDashSettings(widget) {
    document.body.innerHTML = dash.buildWidgetSettingsHtml(widget, {
        allAccounts: [{ id: '1', name: 'Checking' }],
        allGroups: [{ id: 'g1', name: 'Cards', account_ids: ['1'] }],
        exclusionOptions: { categories: ['Dining'], budgets: ['Fun'] }
    });
    dash.wireWidgetSettingsVisibility(widget.id, widget.widget_type);
    document.getElementById(`${widget.id}-settings`).style.display = 'flex'; // open the panel
}

function dashControlShown(widgetId, suffix) {
    const el = document.getElementById(`${widgetId}-${suffix}`);
    return !!el && isShown(el);
}

const BUILDER_TYPES = ['balance', 'earned_spent', 'expenses_by_category', 'net_worth', 'budget_spent',
    'category_subcat', 'card_paydown', 'saved_this_month', 'label_spend', 'subscription_cost',
    'budget_breakdown'];
const STATES = [
    { chartType: 'line', chartMode: 'combined', variant: 'bars' },
    { chartType: 'line', chartMode: 'split', variant: 'delta_line' },
    { chartType: 'pie', chartMode: 'split', variant: 'bars' }
];

function setBuilderState(type, state) {
    document.getElementById('widget-type-select').value = type;
    document.querySelector(`input[name="chart-type"][value="${state.chartType}"]`).checked = true;
    document.querySelector(`input[name="chart-mode"][value="${state.chartMode}"]`).checked = true;
    document.querySelector(`input[name="earned-chart-type"][value="${state.variant}"]`).checked = true;
    window.__oxiApp.applyBuilderOptionVisibility();
}

function loadBuilderDom() {
    const body = indexHtml.slice(indexHtml.indexOf('<body'), indexHtml.lastIndexOf('</body>'));
    document.body.innerHTML = body.replace(/^<body[^>]*>/, '');
}

describe('dashboard widget settings follow the option matrix', () => {
    for (const type of ALL_TYPES) {
        for (const state of STATES) {
            it(`${type} / ${state.chartType} / ${state.chartMode} / ${state.variant}`, () => {
                const id = 'w-' + type;
                const widget = {
                    id, widget_type: type, accounts: ['1'], chart_type: state.chartType,
                    chart_mode: state.chartMode, earned_chart_type: state.variant,
                    chart_options: { show_pct: true, enable_comparison: true }
                };
                renderDashSettings(widget);
                const support = window.OxiUI.widgetOptionSupport(type, state);
                for (const [key, ids] of Object.entries(CONTROL_MAP)) {
                    expect(dashControlShown(id, ids.dash), `${key}`).toBe(!!support[key]);
                }
            });
        }
    }

    it('shows % mode and comparison dates only while enabled', () => {
        renderDashSettings({ id: 'p', widget_type: 'balance', accounts: ['1'], chart_options: {} });
        expect(dashControlShown('p', 'pct-mode')).toBe(false);
        expect(dashControlShown('p', 'comparison-start')).toBe(false);
        const pct = document.getElementById('p-show-pct');
        pct.checked = true;
        pct.dispatchEvent(new Event('change'));
        expect(dashControlShown('p', 'pct-mode')).toBe(true);
    });

    it('re-evaluates visibility when the style changes to pie', () => {
        renderDashSettings({ id: 'q', widget_type: 'budget_spent', accounts: [], chart_options: {} });
        expect(dashControlShown('q', 'show-points')).toBe(true);
        const style = document.getElementById('q-chart-type');
        style.value = 'pie';
        style.dispatchEvent(new Event('change'));
        expect(dashControlShown('q', 'show-points')).toBe(false);
        expect(dashControlShown('q', 'stacked')).toBe(false);
    });

    it('pre-fills the previous period when comparison is enabled', () => {
        document.body.innerHTML = '';
        renderDashSettings({ id: 'c', widget_type: 'balance', accounts: ['1'], start_date: '2026-03-01', end_date: '2026-03-31', chart_options: {} });
        document.getElementById('c-start').value = '2026-03-01';
        document.getElementById('c-end').value = '2026-03-31';
        const cb = document.getElementById('c-enable-comparison');
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));
        expect(document.getElementById('c-comparison-start').value).toBe('2026-01-29');
        expect(document.getElementById('c-comparison-end').value).toBe('2026-02-28');
    });

    it('has no date controls for the Saved This Month tile', () => {
        renderDashSettings({ id: 't', widget_type: 'saved_this_month', accounts: ['1'] });
        expect(document.getElementById('t-start')).toBeNull();
        expect(document.querySelector('[data-section="display"]')).toBeNull();
    });

    it('uses the builder wording for every option (sentence case)', () => {
        renderDashSettings({ id: 'b', widget_type: 'balance', accounts: ['1'], chart_mode: 'split', chart_options: {} });
        const text = document.body.textContent;
        for (const label of ['Layout:', 'Style:', 'Stacked', 'Show % change', 'Show points', 'Fill area',
            'Y-axis from zero', 'X-axis ticks:', 'Y-axis ticks:', 'Line smoothness:', 'Forecast trend',
            'Trend line (moving average)', 'Window (points):', 'Compare with previous period', 'Accounts:', 'Groups:']) {
            expect(text, label).toContain(label);
        }
        for (const old of ['Chart Mode', 'Chart Type', 'Stack Values', 'Show Points', 'Fill Area', 'Trend Window']) {
            expect(text, old).not.toContain(old);
        }
    });
});

describe('Graph Builder controls follow the same option matrix', () => {
    beforeEach(loadBuilderDom);

    for (const type of BUILDER_TYPES) {
        for (const state of STATES) {
            it(`${type} / ${state.chartType} / ${state.chartMode} / ${state.variant}`, () => {
                setBuilderState(type, state);
                const support = window.OxiUI.widgetOptionSupport(type, state);
                for (const [key, ids] of Object.entries(CONTROL_MAP)) {
                    const el = document.getElementById(ids.builder);
                    expect(el, ids.builder).not.toBeNull();
                    expect(isShown(el), key).toBe(!!support[key]);
                }
            });
        }
    }

    it('hides the advanced section entirely for card paydown', () => {
        setBuilderState('card_paydown', STATES[0]);
        expect(isShown(document.getElementById('advanced-section'))).toBe(false);
        expect(isShown(document.getElementById('display-group'))).toBe(false);
    });

    it('drops the Saved This Month preview when another type is charted', async () => {
        global.fetch = vi.fn(async () => ({ ok: false, status: 500, statusText: 'x', json: async () => [] }));
        const tile = document.getElementById('tile-preview');
        tile.style.display = 'block';
        tile.innerHTML = 'Failed to load savings data';
        setBuilderState('net_worth', STATES[0]);
        await window.__oxiApp.fetchChartData();
        expect(tile.style.display).toBe('none');
    });

    it('hides the date range for the Saved This Month tile', () => {
        setBuilderState('saved_this_month', STATES[0]);
        expect(isShown(document.getElementById('date-range-group'))).toBe(false);
    });

    it('fills the comparison range with the adjacent previous period', () => {
        setBuilderState('balance', STATES[0]);
        document.getElementById('start-date').value = '2026-03-01';
        document.getElementById('end-date').value = '2026-03-31';
        document.getElementById('enable-comparison').checked = true;
        window.__oxiApp.toggleComparisonControls();
        expect(document.getElementById('comparison-start-date').value).toBe('2026-01-29');
        expect(document.getElementById('comparison-end-date').value).toBe('2026-02-28');
    });
});

describe('Graph Builder saves every chart option with the widget', () => {
    beforeEach(() => {
        loadBuilderDom();
        global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    });

    it('persists display, % change, stacking and trend line settings', async () => {
        setBuilderState('net_worth', STATES[0]);
        document.getElementById('widget-name-input').value = 'NW';
        document.getElementById('show-points-toggle').checked = true;
        document.getElementById('fill-area-toggle').checked = false;
        document.getElementById('begin-zero-toggle').checked = true;
        document.getElementById('x-axis-limit').value = '9';
        document.getElementById('y-axis-limit').value = '3';
        document.getElementById('tension-range').value = '0.5';
        document.getElementById('show-pct-toggle').checked = true;
        document.getElementById('pct-mode-select').value = 'from_first';
        document.getElementById('enable-trendline').checked = true;
        document.getElementById('trendline-window').value = '12';

        await window.__oxiApp.saveGraphAsWidget();

        const post = global.fetch.mock.calls.find(([url, init]) => url === '/api/widgets' && init?.method === 'POST');
        expect(post).toBeTruthy();
        const saved = JSON.parse(post[1].body);
        expect(saved.chart_options).toMatchObject({
            show_points: true, fill_area: false, begin_at_zero: true,
            x_axis_limit: 9, y_axis_limit: 3, tension: 0.5,
            show_pct: true, pct_mode: 'from_first',
            show_trendline: true, trendline_window: 12
        });
    });
});

describe('Graph Builder multi-series charts honor the display options', () => {
    beforeEach(loadBuilderDom);

    it('applies points, fill, smoothness and ticks to category series', () => {
        setBuilderState('expenses_by_category', STATES[0]);
        document.getElementById('show-points-toggle').checked = true;
        document.getElementById('fill-area-toggle').checked = true;
        document.getElementById('tension-range').value = '0.7';
        document.getElementById('x-axis-limit').value = '4';
        window.__oxiApp.renderExpensesByCategoryChart({}, [
            { label: 'Food', entries: { '2026-01-01': 10, '2026-02-01': 20 } },
            { label: 'Fun', entries: { '2026-01-01': 5, '2026-02-01': 1 } }
        ]);
        const chart = window.__oxiApp.balanceChart;
        const series = chart.data.datasets.filter(d => !d.isTrendline);
        expect(series.map(d => d.tension)).toEqual([0.7, 0.7]);
        expect(series.map(d => d.pointRadius)).toEqual([3, 3]);
        expect(series.map(d => d.fill)).toEqual(['origin', 'origin']);
        expect(chart.options.scales.x.ticks.maxTicksLimit).toBe(4);
    });
});

const HISTORY = [
    { label: 'Groceries', entries: { '2026-01-01': '-10', '2026-02-01': { value: -30 } } },
    { label: 'Fun', entries: { '2026-01-01': 5, '2026-02-01': 7 } }
];

function widgetDom(id) {
    document.body.innerHTML = `
        <div id="${id}-error"></div>
        <canvas id="${id}"></canvas>
        <div id="${id}-legend" style="display:none"><div id="${id}-legend-items"></div></div>`;
}

describe('dashboard multi-series widgets honor every display option', () => {
    beforeEach(() => {
        MockChart.instances = [];
        widgetDom('m1');
    });

    it('applies points, fill, smoothness, ticks, baseline, % change and stacking', () => {
        const widget = {
            id: 'm1', widget_type: 'budget_spent', chart_options: {
                show_points: true, fill_area: true, tension: 0.4, x_axis_limit: 3, y_axis_limit: 2,
                begin_at_zero: true, show_pct: true, pct_mode: 'from_first', stacked: true
            }
        };
        dash.renderMultiSeriesWidget({}, widget, HISTORY);
        const chart = dash.widgetCharts.m1;
        const [a, b] = chart.data.datasets;
        expect(a).toMatchObject({ tension: 0.4, pointRadius: 3, fill: 'origin', stack: 'data' });
        expect(b.fill).toBe('-1');
        expect(a.data).toEqual([10, 30]);
        expect(chart.options.scales.x.ticks.maxTicksLimit).toBe(3);
        expect(chart.options.scales.y.ticks.maxTicksLimit).toBe(2);
        expect(chart.options.scales.y.beginAtZero).toBe(true);
        expect(chart.options.scales.y.stacked).toBe(true);
        expect(chart.__pctOpts).toEqual({ enabled: true, mode: 'from_first' });
    });

    it('defaults match the builder (no points, filled, tension 0.1)', () => {
        dash.renderMultiSeriesWidget({}, { id: 'm1', chart_options: null }, HISTORY);
        const [a] = dash.widgetCharts.m1.data.datasets;
        expect(a).toMatchObject({ tension: 0.1, pointRadius: 0, fill: 'origin' });
    });

    it('adds trend lines and keeps legend-hidden series hidden on re-render', () => {
        dash.widgetDatasetVisibility.m1 = { 0: false, 1: true };
        dash.renderMultiSeriesWidget({}, { id: 'm1', chart_options: { show_trendline: true, trendline_window: 2 } }, HISTORY);
        const datasets = dash.widgetCharts.m1.data.datasets;
        expect(datasets[0].hidden).toBe(true);
        expect(datasets[1].hidden).toBe(false);
        const trend0 = datasets.find(d => d.isTrendline && d.trendOf === 0);
        expect(trend0.hidden).toBe(true);
        delete dash.widgetDatasetVisibility.m1;
    });

    it('renders a pie of per-series totals with explicit colors', () => {
        dash.renderMultiSeriesWidget({}, { id: 'm1', chart_type: 'pie' }, HISTORY, ds => ds.label === 'Fun' ? '#123456' : null);
        const chart = dash.widgetCharts.m1;
        expect(chart.config.type).toBe('pie');
        expect(chart.data.labels).toEqual(['Groceries', 'Fun']);
        expect(chart.data.datasets[0].data).toEqual([40, 12]);
        expect(chart.data.datasets[0].borderColor[1]).toBe('#123456');
    });
});

describe('compare with previous period honors the display options', () => {
    it('dashboard comparison chart uses points, fill and smoothness', () => {
        widgetDom('cmp');
        const hist = [{ label: 'Checking', entries: { '2026-03-01': 1, '2026-03-02': 2 } }];
        dash.renderBalanceComparisonChart({}, { id: 'cmp', chart_options: { show_points: true, fill_area: true, tension: 0.6 } }, hist, hist);
        const [primary, prev] = dash.widgetCharts.cmp.data.datasets;
        expect(primary).toMatchObject({ pointRadius: 4, fill: true, tension: 0.6 });
        expect(prev).toMatchObject({ pointRadius: 4, fill: false, borderDash: [5, 5] });
    });
});

describe('dashboard widget rendering state', () => {
    beforeEach(() => widgetDom('r1'));

    it('showWidgetMessage replaces the chart with the message', () => {
        dash.renderMultiSeriesWidget({}, { id: 'r1' }, HISTORY);
        const chart = dash.widgetCharts.r1;
        dash.showWidgetMessage('r1', 'No data');
        expect(chart.destroy).toHaveBeenCalled();
        expect(dash.widgetCharts.r1).toBeUndefined();
        expect(document.getElementById('r1-error').textContent).toBe('No data');
    });

    it('a successful re-render clears the previous message and stale legend', async () => {
        document.getElementById('r1-error').textContent = 'Error loading data';
        document.getElementById('r1-legend').style.display = 'block';
        global.fetch = vi.fn(async () => ({ ok: true, json: async () => HISTORY }));
        await dash.renderWidgetChart(
            { id: 'r1', widget_type: 'expenses_by_category', accounts: [], chart_type: 'pie' }, 'r1', [], []
        );
        expect(document.getElementById('r1-error').textContent).toBe('');
        expect(document.getElementById('r1-legend').style.display).toBe('none');
        expect(dash.widgetCharts.r1.config.type).toBe('pie');
    });

    it('treats a balance widget without chart_mode as combined (what the settings show)', async () => {
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => [{ label: 'Checking', entries: { '2026-01-01': 1, '2026-01-02': 2 } }]
        }));
        await dash.renderWidgetChart({ id: 'r1', widget_type: 'balance', accounts: ['1'] }, 'r1',
            [{ id: '1', name: 'Checking', balance: '2' }], []);
        expect(dash.widgetCharts.r1.data.datasets[0].label).toBe('Total Balance');
    });
});

describe('dashboard widget settings are saved with the widget', () => {
    const ACCOUNTS = [{ id: '1', name: 'Checking' }, { id: '2', name: 'Savings' }];

    function render(widget) {
        document.body.innerHTML = dash.buildWidgetSettingsHtml(widget, {
            allAccounts: ACCOUNTS,
            allGroups: [{ id: 'g1', name: 'Cards', account_ids: ['2'] }],
            exclusionOptions: { categories: ['Dining'], budgets: ['Fun', 'Food'] },
            startDate: widget.start_date, endDate: widget.end_date
        });
    }
    const set = (id, prop, value) => { document.getElementById(id)[prop] = value; };
    const select = (id, values) => Array.from(document.getElementById(id).options)
        .forEach(o => { o.selected = values.includes(o.value); });

    it('reads every chart option back from the panel', () => {
        const widget = { id: 'x', widget_type: 'balance', accounts: ['1'], chart_mode: 'split', chart_options: null };
        render(widget);
        set('x-show-points', 'checked', true);
        set('x-fill-area', 'checked', false);
        set('x-begin-zero', 'checked', true);
        set('x-x-limit', 'value', '8');
        set('x-y-limit', 'value', '5');
        set('x-tension', 'value', '0.3');
        set('x-show-pct', 'checked', true);
        set('x-pct-mode', 'value', 'from_first');
        set('x-enable-forecast', 'checked', true);
        set('x-forecast-days', 'value', '45');
        set('x-enable-trendline', 'checked', true);
        set('x-trendline-window', 'value', '9');
        set('x-stacked', 'checked', true);
        set('x-enable-comparison', 'checked', true);
        set('x-comparison-start', 'value', '2025-01-01');
        set('x-comparison-end', 'value', '2025-01-31');
        set('x-interval', 'value', '1W');
        set('x-chart-type', 'value', 'pie');
        select('x-accounts', ['2']);
        select('x-groups', ['g1']);

        dash.readWidgetSettings('x', widget);

        expect(widget.chart_options).toMatchObject({
            show_points: true, fill_area: false, begin_at_zero: true, x_axis_limit: 8, y_axis_limit: 5,
            tension: 0.3, show_pct: true, pct_mode: 'from_first', enable_forecast: true, forecast_days: 45,
            show_trendline: true, trendline_window: 9, stacked: true, enable_comparison: true,
            comparison_start_date: '2025-01-01', comparison_end_date: '2025-01-31'
        });
        expect(widget.interval).toBe('1W');
        expect(widget.chart_type).toBe('pie');
        expect(widget.accounts).toEqual(['2']);
        expect(widget.group_ids).toEqual(['g1']);
    });

    it('keeps accounts that are missing from the account list selected', () => {
        const widget = { id: 'y', widget_type: 'balance', accounts: ['99'], chart_options: {} };
        render(widget);
        dash.readWidgetSettings('y', widget);
        expect(widget.accounts).toEqual(['99']);
    });

    it('edits the budget filter of budget spent widgets', () => {
        const widget = { id: 'z', widget_type: 'budget_spent', accounts: [], budget_names: ['Fun'] };
        render(widget);
        select('z-budgets', ['Food']);
        dash.readWidgetSettings('z', widget);
        expect(widget.budget_names).toEqual(['Food']);
    });

    it('leaves fields of options the type does not offer untouched', () => {
        const widget = { id: 'n', widget_type: 'net_worth', accounts: ['1'], group_ids: ['g1'], chart_options: { stacked: true } };
        render(widget);
        expect(document.getElementById('n-accounts')).toBeNull();
        dash.readWidgetSettings('n', widget);
        expect(widget.accounts).toEqual(['1']);
        expect(widget.group_ids).toEqual(['g1']);
        expect(widget.chart_options.stacked).toBe(true);
    });

    it('refuses to save a balance widget without accounts or groups', async () => {
        const widget = { id: 'v', widget_type: 'balance', accounts: ['1'], chart_options: {} };
        render(widget);
        select('v-accounts', []);
        global.fetch = vi.fn(async (url, init) => ({ ok: true, json: async () => [widget], text: async () => '' }));
        window.OxiUI.toast = vi.fn();
        await dash.updateWidgetDateRange('v');
        expect(window.OxiUI.toast).toHaveBeenCalledWith('Please select at least one account or group', 'error');
        expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    });

    it('updates the cached widget so width / height edits do not revert settings', async () => {
        const widget = { id: 'u', widget_type: 'net_worth', accounts: [], chart_options: {} };
        render(widget);
        document.body.insertAdjacentHTML('beforeend', '<div id="u-error"></div><canvas id="u"></canvas><div id="u-legend"></div>');
        dash.setWidgetsCache([{ ...widget, interval: 'auto' }]);
        set('u-interval', 'value', '1M');
        global.fetch = vi.fn(async (url) => ({
            ok: true,
            json: async () => url === '/api/widgets' ? [{ ...widget }] : [],
            text: async () => ''
        }));
        await dash.updateWidgetDateRange('u');
        expect(dash.widgetsCache[0].interval).toBe('1M');
    });
});

describe('dashboard date preset matches the stored range', () => {
    it('selects the preset whose range equals the widget dates', () => {
        const d = window.calculateRelativeDates('30d');
        expect(dash.matchingTimeRangePreset(['7d', '30d'], d.start, d.end)).toBe('30d');
        expect(dash.matchingTimeRangePreset(['7d', '30d'], '2020-01-01', '2020-02-01')).toBe('__none__');
        expect(dash.matchingTimeRangePreset(['7d'], '', '')).toBe('__none__');
    });
});

describe('normalizeChartOptions', () => {
    it('fills every default for widgets saved without chart options', () => {
        expect(dash.normalizeChartOptions(null)).toMatchObject({
            show_points: false, x_axis_limit: 6, y_axis_limit: 4, fill_area: true, tension: 0.1,
            begin_at_zero: false, show_pct: false, pct_mode: 'from_previous', enable_forecast: false,
            forecast_days: 30, show_trendline: false, trendline_window: 7, stacked: false, enable_comparison: false
        });
    });
});
