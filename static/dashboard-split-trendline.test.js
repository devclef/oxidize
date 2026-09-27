// @vitest-environment jsdom
/**
 * Regression tests for split-mode dashboard widgets: the per-series trend
 * lines must follow the legend selection. Deselected items (single click,
 * or "Deselect All") must hide their trend line, and a re-render (widget
 * refresh, date change, settings edit) must keep the saved selection -
 * trend lines included.
 *
 * dashboard.js is a classic script, so the actual shipped file is evaluated
 * here (same approach as ui.test.js) with Chart.js and fetch stubbed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ui.js defines window.OxiUI (trendline/stacking helpers used by dashboard.js)
(0, eval)(readFileSync(path.resolve(process.cwd(), 'static/ui.js'), 'utf8'));

// Chart.js stub: keep dataset object identity so `hidden` mutations on
// chart.data.datasets are observable here (real Chart.js stores references).
class MockChart {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.data = config.data;
        this.update = vi.fn();
        this.destroy = vi.fn();
    }
}
global.Chart = MockChart;

// jsdom has no 2D context; dashboard.js only passes the context to Chart.js.
HTMLCanvasElement.prototype.getContext = () => ({});

// Evaluate the real dashboard.js and expose its private state/functions.
const dashSource = readFileSync(path.resolve(process.cwd(), 'static/dashboard.js'), 'utf8');
(0, eval)(dashSource + `
;window.__oxiDash = {
    get widgetCharts() { return widgetCharts; },
    get widgetDatasetVisibility() { return widgetDatasetVisibility; },
    resetWidgetDatasetVisibility(v) { widgetDatasetVisibility = v; },
    renderWidgetChart,
    selectAllDatasets,
    deselectAllDatasets
};`);
const oxi = window.__oxiDash;

const ACCOUNTS = [
    { id: '1', name: 'Checking', balance: '1000' },
    { id: '2', name: 'Savings', balance: '5000' },
    { id: '3', name: 'Cash', balance: '200' }
];

const HISTORY = ACCOUNTS.map((acc, i) => ({
    label: acc.name,
    currency_symbol: '$',
    currency_code: 'USD',
    entries: Array.from({ length: 10 }, (_, j) => ({
        date: `2026-09-0${j + 1}`,
        value: parseFloat(acc.balance) + j * (i + 1)
    }))
}));

const WIDGET = {
    id: 'w1',
    name: 'Split Balance',
    accounts: ['1', '2', '3'],
    group_ids: [],
    widget_type: 'balance',
    chart_mode: 'split',
    chart_type: 'line',
    start_date: null,
    end_date: null,
    interval: null,
    chart_options: { show_trendline: true, trendline_window: 3 }
};

function setupDom() {
    document.body.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.id = 'w1';
    document.body.appendChild(canvas);
    for (const id of ['w1-error', 'w1-legend', 'w1-legend-items']) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
}

async function renderWidget() {
    await oxi.renderWidgetChart(WIDGET, 'w1', ACCOUNTS, []);
    const chart = oxi.widgetCharts['w1'];
    expect(chart, 'widget chart should have been created').toBeTruthy();
    return chart;
}

function mainDatasets(chart) {
    return chart.data.datasets.filter(d => !d.isTrendline);
}

function trendlineFor(chart, sourceIndex) {
    return chart.data.datasets.find(d => d.isTrendline && d.trendOf === sourceIndex);
}

beforeEach(() => {
    oxi.resetWidgetDatasetVisibility({});
    setupDom();
    global.fetch = vi.fn(async (url) => ({
        ok: true,
        json: async () => (String(url).includes('balance-history') ? HISTORY : [])
    }));
});

describe('Split widget trend line follows legend selection', () => {
    it('renders a trend line per series, all visible initially', async () => {
        const chart = await renderWidget();
        const main = mainDatasets(chart);
        const trends = chart.data.datasets.filter(d => d.isTrendline);

        expect(main.map(d => d.label)).toEqual(['Checking', 'Savings', 'Cash']);
        expect(trends).toHaveLength(3);
        main.forEach(d => expect(d.hidden).toBeFalsy());
        trends.forEach(t => expect(t.hidden).toBeFalsy());
    });

    it('hides the matching trend line when a legend item is toggled off', async () => {
        const chart = await renderWidget();
        const items = document.querySelectorAll('#w1-legend-items .legend-item');
        expect(items).toHaveLength(3);

        items[1].click(); // deselect Savings

        expect(chart.data.datasets[1].hidden).toBe(true);
        expect(trendlineFor(chart, 1).hidden).toBe(true);
        // the other series and their trend lines stay visible
        expect(chart.data.datasets[0].hidden).toBeFalsy();
        expect(trendlineFor(chart, 0).hidden).toBeFalsy();
        expect(trendlineFor(chart, 2).hidden).toBeFalsy();
    });

    it('hides every trend line on "Deselect All"', async () => {
        const chart = await renderWidget();

        oxi.deselectAllDatasets('w1');

        mainDatasets(chart).forEach(d => expect(d.hidden).toBe(true));
        chart.data.datasets.filter(d => d.isTrendline).forEach(t => expect(t.hidden).toBe(true));
        expect(chart.update).toHaveBeenCalled();
    });

    it('shows every trend line again on "Select All"', async () => {
        const chart = await renderWidget();
        oxi.deselectAllDatasets('w1');
        mainDatasets(chart).forEach(d => expect(d.hidden).toBe(true));

        oxi.selectAllDatasets('w1');

        mainDatasets(chart).forEach(d => expect(d.hidden).toBe(false));
        chart.data.datasets.filter(d => d.isTrendline).forEach(t => expect(t.hidden).toBe(false));
        expect(chart.update).toHaveBeenCalled();
    });

    it('keeps deselected series and their trend lines hidden across a re-render', async () => {
        const chart = await renderWidget();
        document.querySelectorAll('#w1-legend-items .legend-item')[1].click(); // deselect Savings
        expect(chart.data.datasets[1].hidden).toBe(true);

        // e.g. the widget's Refresh button or a dashboard date change
        await oxi.renderWidgetChart(WIDGET, 'w1', ACCOUNTS, []);
        const chart2 = oxi.widgetCharts['w1'];

        const savings = mainDatasets(chart2).find(d => d.label === 'Savings');
        expect(savings.hidden).toBe(true);
        expect(trendlineFor(chart2, 1).hidden).toBe(true);
        const checking = mainDatasets(chart2).find(d => d.label === 'Checking');
        expect(checking.hidden).toBeFalsy();
        expect(trendlineFor(chart2, 0).hidden).toBeFalsy();

        // legend UI agrees with the chart
        const items = document.querySelectorAll('#w1-legend-items .legend-item');
        expect(items[1].className).toContain('hidden');
        expect(items[0].className).toContain('active');
    });
});
