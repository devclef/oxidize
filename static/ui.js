/**
 * Shared UI helpers for Oxidize.
 * Loaded on every page before page scripts (app.js / dashboard.js / inline).
 *
 *  - OxiUI.toast(message, type)      non-blocking notifications
 *  - OxiUI.confirm(opts)             Promise<boolean> confirm dialog
 *  - OxiUI.prompt(opts)              Promise<string|null> input dialog
 *  - OxiUI.formatCurrency(v, opts)   consistent amount formatting (no currency symbol)
 *  - OxiUI.getChartColors()          theme-aware chart colors
 *  - OxiUI.getSeriesPalette()        ordered categorical series colors
 *  - OxiUI.chartGridPlugin           hides grid lines inside [data-grid="off"]
 *  - OxiUI.pieChartConfig(l, d, o)  shared doughnut config (folds the tail)
 *  - OxiUI.createPieChart / restylePieChart  build it / re-theme it
 *  - OxiUI.spinnerHtml(label)        inline loading spinner
 *  - OxiUI.movingAverage(v, w)      trailing moving average (null-safe)
 *  - OxiUI.trendlineDataset(...)    dotted moving-average dataset
 *  - OxiUI.addTrendlineDatasets(..) trend lines for a set of datasets
 *  - OxiUI.applyStacking(ds, on)    Chart.js stack groups for line charts
 *  - OxiUI.applyStackedScales(s,on) stacked flag on all chart axes
 *  - OxiUI.widgetOptionSupport(t,s) which chart options apply to a widget type
 *  - OxiUI.applyLineStyle(ds, opts) points / fill / smoothness on series
 *  - OxiUI.applyAxisOptions(sc, o)  tick limits / y-from-zero on scales
 *  - OxiUI.computePercentChange(..) % change labels (from previous / first)
 *  - OxiUI.cardPaydownChartConfig(d) card paydown chart (builder + dashboard)
 *  - OxiUI.balanceComparisonChart(..) balance vs previous period series
 */
(function () {
    'use strict';

    // ── Toasts ──────────────────────────────────────────────────────────
    let toastContainer = null;

    function ensureToastContainer() {
        if (toastContainer && document.body.contains(toastContainer)) {
            return toastContainer;
        }
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        toastContainer.setAttribute('role', 'status');
        toastContainer.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastContainer);
        return toastContainer;
    }

    const TOAST_ICONS = { success: '\u2713', error: '\u2715', info: '\u2139' };

    function toast(message, type) {
        if (!type || !TOAST_ICONS[type]) type = 'info';
        const container = ensureToastContainer();

        const el = document.createElement('div');
        el.className = 'toast toast-' + type;
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = TOAST_ICONS[type];

        const text = document.createElement('span');
        text.className = 'toast-message';
        text.textContent = String(message == null ? '' : message);

        el.appendChild(icon);
        el.appendChild(text);

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            el.classList.add('toast-leaving');
            setTimeout(() => el.remove(), 250);
        };
        el.addEventListener('click', dismiss);

        container.appendChild(el);
        while (container.children.length > 4) {
            container.firstChild.remove();
        }
        setTimeout(dismiss, type === 'error' ? 6000 : 3500);
        return el;
    }

    // ── Modal dialogs (confirm / prompt) ────────────────────────────────
    let dialogOverlay = null;
    let dialogState = null;
    let lastFocused = null;

    function ensureDialog() {
        if (dialogOverlay && document.body.contains(dialogOverlay)) {
            return dialogOverlay;
        }
        dialogOverlay = document.createElement('div');
        dialogOverlay.className = 'modal-overlay dialog-overlay';
        dialogOverlay.style.display = 'none';
        dialogOverlay.innerHTML =
            '<div class="modal dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">' +
            '    <div class="modal-header">' +
            '        <h3 id="dialog-title" class="dialog-title"></h3>' +
            '        <button class="modal-close dialog-close" type="button" aria-label="Close dialog">&times;</button>' +
            '    </div>' +
            '    <div class="modal-body">' +
            '        <p class="dialog-message"></p>' +
            '        <div class="dialog-input-row" style="display: none;">' +
            '            <input type="text" class="dialog-input" autocomplete="off">' +
            '            <div class="dialog-error"></div>' +
            '        </div>' +
            '    </div>' +
            '    <div class="modal-footer dialog-actions">' +
            '        <button class="btn btn-secondary dialog-cancel" type="button">Cancel</button>' +
            '        <button class="btn btn-primary dialog-confirm" type="button">OK</button>' +
            '    </div>' +
            '</div>';
        document.body.appendChild(dialogOverlay);

        dialogOverlay.querySelector('.dialog-close').addEventListener('click', () => settle(false));
        dialogOverlay.querySelector('.dialog-cancel').addEventListener('click', () => settle(false));
        dialogOverlay.querySelector('.dialog-confirm').addEventListener('click', () => attemptConfirm());
        dialogOverlay.addEventListener('mousedown', (e) => {
            if (e.target === dialogOverlay) settle(false);
        });
        document.addEventListener('keydown', (e) => {
            if (!dialogState || !dialogOverlay || dialogOverlay.style.display === 'none') return;
            if (e.key === 'Escape') {
                e.preventDefault();
                settle(false);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                attemptConfirm();
            }
        });
        return dialogOverlay;
    }

    function currentInput() {
        return dialogOverlay ? dialogOverlay.querySelector('.dialog-input') : null;
    }

    function currentError() {
        return dialogOverlay ? dialogOverlay.querySelector('.dialog-error') : null;
    }

    function settle(confirmed) {
        const state = dialogState;
        if (!state) return;
        dialogState = null;
        dialogOverlay.style.display = 'none';
        if (lastFocused && typeof lastFocused.focus === 'function') {
            lastFocused.focus();
        }
        let result;
        if (state.isPrompt) {
            result = confirmed ? state.getValue() : null;
        } else {
            result = confirmed;
        }
        if (state.resolve) state.resolve(result);
    }

    function attemptConfirm() {
        const state = dialogState;
        if (!state) return;
        if (state.isPrompt && state.validate) {
            const error = state.validate(state.getValue());
            if (error) {
                const errEl = currentError();
                if (errEl) errEl.textContent = error;
                const input = currentInput();
                if (input) input.focus();
                return;
            }
        }
        const errEl = currentError();
        if (errEl) errEl.textContent = '';
        settle(true);
    }

    function openDialog(options) {
        return new Promise((resolve) => {
            const overlay = ensureDialog();
            // Replace any pending dialog with a cancel result.
            if (dialogState && dialogState.resolve) {
                dialogState.resolve(dialogState.isPrompt ? null : false);
            }
            dialogState = null;

            const titleEl = overlay.querySelector('.dialog-title');
            const messageEl = overlay.querySelector('.dialog-message');
            const inputRow = overlay.querySelector('.dialog-input-row');
            const cancelBtn = overlay.querySelector('.dialog-cancel');
            const confirmBtn = overlay.querySelector('.dialog-confirm');
            const errEl = overlay.querySelector('.dialog-error');

            titleEl.textContent = options.title || 'Confirm';
            messageEl.textContent = options.message || '';
            messageEl.style.display = options.message ? '' : 'none';

            const isPrompt = !!options.input;
            inputRow.style.display = isPrompt ? '' : 'none';
            errEl.textContent = '';

            cancelBtn.textContent = options.cancelLabel || (isPrompt ? 'Cancel' : 'Cancel');
            confirmBtn.textContent = options.confirmLabel || (isPrompt ? 'OK' : 'Confirm');
            confirmBtn.classList.toggle('danger', !!options.danger);

            lastFocused = document.activeElement;

            let value = options.defaultValue || '';
            if (isPrompt) {
                const input = currentInput();
                input.value = value;
                input.placeholder = options.placeholder || '';
            }

            dialogState = {
                resolve: resolve,
                isPrompt: isPrompt,
                validate: isPrompt ? options.validate : null,
                getValue: () => (isPrompt ? currentInput().value.trim() : true)
            };

            overlay.style.display = 'flex';
            const focusTarget = isPrompt ? currentInput() : confirmBtn;
            setTimeout(() => {
                focusTarget.focus();
                if (isPrompt) focusTarget.select();
            }, 0);
        });
    }

    function confirmDialog(options) {
        return openDialog({
            title: options.title || 'Are you sure?',
            message: options.message || '',
            confirmLabel: options.confirmLabel || 'Confirm',
            cancelLabel: options.cancelLabel || 'Cancel',
            danger: options.danger
        });
    }

    function promptDialog(options) {
        return openDialog({
            title: options.title || 'Input',
            message: options.message || '',
            input: true,
            defaultValue: options.defaultValue || '',
            placeholder: options.placeholder,
            confirmLabel: options.confirmLabel || 'OK',
            cancelLabel: options.cancelLabel || 'Cancel',
            validate: options.validate
        });
    }

    // ── Amount formatting ───────────────────────────────────────────────
    // No currency symbol is rendered on purpose: amounts stay generic for
    // whatever currency the user's Firefly instance uses.
    // opts: { decimals, compact }
    // compact: abbreviate 1,234 -> 1.2K and 1,234,567 -> 1.2M
    function formatCurrency(value, opts) {
        const num = typeof value === 'number' ? value : parseFloat(value);
        if (!isFinite(num)) return '\u2014';
        opts = opts || {};
        const decimals = opts.decimals != null ? opts.decimals : 2;
        const abs = Math.abs(num);
        const sign = num < 0 ? '-' : '';
        let body;
        if (opts.compact) {
            if (abs >= 1000000) body = (abs / 1000000).toFixed(1) + 'M';
            else if (abs >= 1000) body = (abs / 1000).toFixed(1) + 'K';
            else body = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        } else {
            body = abs.toLocaleString('en-US', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            });
        }
        return sign + body;
    }

    // ── Theme-aware chart colors ────────────────────────────────────────
    // Mirrors the --chart-* tokens in style.css. `series` is a categorical
    // palette validated for color-vision deficiency on each theme's surface;
    // `seriesExtra` only kicks in past eight series.
    const CHART_THEMES = {
        light: {
            textColor: '#475569',
            gridColor: '#e2e8f0',
            tooltipBg: '#ffffff',
            tooltipBorder: '#e2e8f0',
            tooltipText: '#1e293b',
            surface: '#ffffff',
            headingColor: '#0f172a',
            accent: '#0f766e',
            earned: '#15803d',
            spent: '#dc2626',
            neutral: '#94a3b8',
            series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
            seriesExtra: ['#0e7490', '#a16207', '#9d174d', '#475569', '#4d7c0f', '#7c3aed', '#b45309']
        },
        dark: {
            textColor: '#aab6c3',
            gridColor: 'rgba(148, 163, 184, 0.12)',
            tooltipBg: '#212a33',
            tooltipBorder: 'rgba(148, 163, 184, 0.22)',
            tooltipText: '#d3dbe4',
            surface: '#1a2129',
            headingColor: '#e9eef3',
            accent: '#4fb8aa',
            earned: '#5cc98a',
            spent: '#ef8a8a',
            neutral: '#6b7888',
            series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
            seriesExtra: ['#22d3ee', '#facc15', '#f472b6', '#94a3b8', '#a3e635', '#c084fc', '#fb923c']
        }
    };

    function getChartColors() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const theme = CHART_THEMES[isDark ? 'dark' : 'light'];
        return Object.assign({}, theme, {
            series: theme.series.slice(),
            seriesExtra: theme.seriesExtra.slice()
        });
    }

    // Per-chart grid lines: a chart whose canvas sits inside an element
    // marked data-grid="off" (a dashboard widget or the builder preview,
    // driven by the widget's chart_options.show_grid) draws no grid lines.
    function isGridHidden(canvas) {
        return !!(canvas && canvas.closest && canvas.closest('[data-grid="off"]'));
    }

    const chartGridPlugin = {
        id: 'oxiChartGrid',
        beforeUpdate(chart) {
            if (!isGridHidden(chart.canvas)) return;
            const scales = (chart.options && chart.options.scales) || {};
            Object.values(scales).forEach((scale) => {
                if (scale && scale.grid) scale.grid.display = false;
            });
        }
    };

    if (typeof Chart !== 'undefined' && typeof Chart.register === 'function') {
        Chart.register(chartGridPlugin);
    }

    // Full ordered series palette (validated slots first, then extras).
    function getSeriesPalette() {
        const c = getChartColors();
        return c.series.concat(c.seriesExtra);
    }

    // ── Pie / doughnut charts ───────────────────────────────────────────
    // Shared config for every part-to-whole chart: a doughnut (far less
    // solid color than a pie) with the total in the hole, slices separated
    // by a surface-colored gap, slice colors softened toward the surface in
    // dark mode, and the long tail folded into one neutral "Other" slice.
    const PIE_MAX_SLICES = 8;

    // Blend '#rrggbb' toward another '#rrggbb' by t (0..1).
    function mixHex(color, toward, t) {
        const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(toward)) return color;
        const a = parse(color);
        const b = parse(toward);
        return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
    }

    // Sort slices largest-first and fold everything past the cap into
    // "Other". Explicit per-slice colors follow their slice.
    function pieSlices(labels, data, colors, maxSlices) {
        const cap = maxSlices || PIE_MAX_SLICES;
        const items = (labels || []).map((label, i) => {
            const raw = Number(data && data[i]);
            return {
                label: label,
                value: isFinite(raw) ? Math.abs(raw) : 0,
                color: (colors && colors[i]) || null
            };
        }).filter((item) => item.value > 0);
        items.sort((a, b) => b.value - a.value);
        if (items.length <= cap) return items;
        const kept = items.slice(0, cap - 1);
        const rest = items.slice(cap - 1);
        kept.push({
            label: 'Other',
            value: rest.reduce((sum, item) => sum + item.value, 0),
            color: null,
            isOther: true,
            members: rest.map((item) => item.label)
        });
        return kept;
    }

    const pieCenterTotalPlugin = {
        id: 'oxiPieCenterTotal',
        // `format` is a plain function, not a Chart.js scriptable option.
        descriptors: { _scriptable: false, _indexable: false },
        afterDraw(chart) {
            const opts = chart.options.plugins && chart.options.plugins.oxiPieCenterTotal;
            if (!opts || !opts.display) return;
            const meta = chart.getDatasetMeta(0);
            const arc = meta && meta.data && meta.data[0];
            if (!arc || !arc.innerRadius || arc.innerRadius < 28) return;
            const visibleTotal = chart.data.datasets[0].data.reduce((sum, v, i) =>
                sum + (chart.getDataVisibility(i) ? (Number(v) || 0) : 0), 0);
            const ctx = chart.ctx;
            const x = arc.x;
            const y = arc.y;
            const valueSize = Math.max(12, Math.min(22, Math.round(arc.innerRadius / 3.2)));
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = opts.labelColor;
            ctx.font = '500 ' + Math.max(10, Math.round(valueSize * 0.55)) + 'px ' + Chart.defaults.font.family;
            ctx.fillText(opts.label || 'Total', x, y - valueSize * 0.62);
            ctx.fillStyle = opts.valueColor;
            ctx.font = '650 ' + valueSize + 'px ' + Chart.defaults.font.family;
            ctx.fillText(opts.format(visibleTotal), x, y + valueSize * 0.35);
            ctx.restore();
        }
    };

    if (typeof Chart !== 'undefined' && typeof Chart.register === 'function') {
        Chart.register(pieCenterTotalPlugin);
    }

    /**
     * Chart.js config for a part-to-whole chart.
     * opts: { colors?: per-slice colors ('#rrggbb' or a getChartColors()
     *         key such as 'earned'), format?: (n) => string,
     *         maxSlices?: number, centerLabel?: string,
     *         tooltipLabel?: (context) => string,
     *         showTotal?: false to leave the hole empty when a sum of the
     *         slices is meaningless (e.g. earned vs spent) }
     */
    function pieChartConfig(labels, data, opts) {
        opts = opts || {};
        const c = getChartColors();
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const palette = c.series.concat(c.seriesExtra);
        const format = opts.format || ((v) => formatCurrency(v));
        const slices = pieSlices(labels, data, opts.colors, opts.maxSlices);
        let paletteIndex = 0;
        const sliceColors = slices.map((slice) => {
            // A slice color may name a theme color ('earned', 'spent', ...)
            // so it follows light/dark switches.
            const named = slice.color && typeof c[slice.color] === 'string' ? c[slice.color] : slice.color;
            const base = slice.isOther ? c.neutral : (named || palette[paletteIndex++ % palette.length]);
            return isDark ? mixHex(base, c.surface, 0.18) : base;
        });
        const total = slices.reduce((sum, s) => sum + s.value, 0);

        return {
            type: 'doughnut',
            data: {
                labels: slices.map((s) => s.label),
                datasets: [{
                    data: slices.map((s) => s.value),
                    backgroundColor: sliceColors,
                    hoverBackgroundColor: sliceColors,
                    borderColor: c.surface,
                    hoverBorderColor: c.surface,
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                layout: { padding: 6 },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            color: c.textColor,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 14,
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: c.tooltipBg,
                        borderColor: c.tooltipBorder,
                        borderWidth: 1,
                        titleColor: c.tooltipText,
                        bodyColor: c.tooltipText,
                        usePointStyle: true,
                        callbacks: {
                            label: opts.tooltipLabel || ((context) => {
                                const value = Number(context.parsed) || 0;
                                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                                return ' ' + context.label + ': ' + format(value) + ' (' + pct + '%)';
                            }),
                            afterLabel: (context) => {
                                const slice = slices[context.dataIndex];
                                if (!slice || !slice.isOther) return '';
                                const names = slice.members.slice(0, 6).join(', ');
                                const more = slice.members.length > 6 ? ' +' + (slice.members.length - 6) + ' more' : '';
                                return '   ' + names + more;
                            }
                        }
                    },
                    oxiPieCenterTotal: {
                        display: opts.showTotal !== false,
                        label: opts.centerLabel || 'Total',
                        format: format,
                        labelColor: c.textColor,
                        valueColor: c.headingColor
                    }
                }
            }
        };
    }

    function createPieChart(ctx, labels, data, opts) {
        const chart = new Chart(ctx, pieChartConfig(labels, data, opts));
        chart.$oxiPie = { labels: labels, data: data, opts: opts || {} };
        return chart;
    }

    // Re-apply the shared doughnut styling (e.g. after a theme switch).
    function restylePieChart(chart) {
        if (!chart || !chart.$oxiPie) return false;
        const src = chart.$oxiPie;
        const config = pieChartConfig(src.labels, src.data, src.opts);
        chart.data.labels = config.data.labels;
        Object.assign(chart.data.datasets[0], config.data.datasets[0]);
        chart.options.plugins.legend.labels = config.options.plugins.legend.labels;
        chart.options.plugins.tooltip = config.options.plugins.tooltip;
        chart.options.plugins.oxiPieCenterTotal = config.options.plugins.oxiPieCenterTotal;
        chart.update('none');
        return true;
    }

    // ── Loading spinner ─────────────────────────────────────────────────
    function spinnerHtml(label) {
        return '<span class="spinner" aria-hidden="true"></span><span>' +
            (label || '') + '</span>';
    }


    // ── Trend line (moving average) ────────────────────────────────────
    // Trailing moving average over a fixed window of points. Null /
    // non-numeric entries are ignored; an entry is null only when its
    // whole window contains no usable value. The line starts at the
    // first point (averaging whatever is available so far).
    function movingAverage(values, window) {
        if (!Array.isArray(values) || values.length === 0) return [];
        let w = Math.floor(Number(window));
        if (!isFinite(w) || w < 1) w = 7;
        const out = new Array(values.length);
        for (let i = 0; i < values.length; i++) {
            const start = Math.max(0, i - w + 1);
            let sum = 0;
            let count = 0;
            for (let j = start; j <= i; j++) {
                const v = parseFloat(values[j]);
                if (isFinite(v)) {
                    sum += v;
                    count++;
                }
            }
            out[i] = count > 0 ? sum / count : null;
        }
        return out;
    }

    // Build a dotted "trend line" Chart.js dataset showing the moving
    // average of a source series.
    //   sourceLabel  label of the series being averaged (used for the name)
    //   values       numeric series (may contain nulls)
    //   opts         { window, color, sourceColor }
    //   opts.sourceColor  if a plain string, the trend line matches the
    //                     series color; otherwise the fallback color is used
    function trendlineDataset(sourceLabel, values, opts) {
        opts = opts || {};
        const isDark = document.documentElement &&
            document.documentElement.getAttribute('data-theme') === 'dark';
        const fallbackColor = opts.color || (isDark ? '#fbbf24' : '#d97706');
        const useSourceColor = typeof opts.sourceColor === 'string' && opts.sourceColor.length > 0;
        const name = sourceLabel ? sourceLabel + ' (avg)' : 'Average';
        return {
            label: name,
            data: movingAverage(values, opts.window != null ? opts.window : 7),
            type: 'line',
            borderColor: useSourceColor ? opts.sourceColor : fallbackColor,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [2, 4],
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHitRadius: 6,
            fill: false,
            spanGaps: true,
            order: -1,
            isTrendline: true
        };
    }

    // Return trend line datasets for every non-trendline dataset in the
    // given array (does not mutate it). Each result carries
    // `trendOf: <source index>` so callers can sync visibility.
    function addTrendlineDatasets(datasets, opts) {
        opts = opts || {};
        if (!Array.isArray(datasets)) return [];
        const window = opts.window != null ? opts.window : 7;
        const additions = [];
        datasets.forEach((ds, i) => {
            if (!ds || ds.isTrendline || ds.isComparison || !Array.isArray(ds.data)) return;
            const t = trendlineDataset(ds.label, ds.data, {
                window: window,
                color: opts.color,
                sourceColor: ds.borderColor
            });
            t.trendOf = i;
            additions.push(t);
        });
        return additions;
    }

    // ── Stacking (line charts, #24) ──────────────────────────────────
    // Assign Chart.js `stack` groups to datasets so a line chart can be
    // drawn stacked. Real series share one group ("data") so their values
    // stack vertically; auxiliary series (trend lines, forecasts) get a
    // private group each so they are never stacked on top of anything.
    // Returns copies - the input array and its datasets are not mutated.
    // When disabled (or for non-array input) the original array is
    // returned untouched.
    function applyStacking(datasets, enabled) {
        if (!enabled || !Array.isArray(datasets)) return datasets;
        let auxCount = 0;
        return datasets.map(function (ds) {
            if (!ds) return ds;
            const copy = Object.assign({}, ds);
            if (ds.isTrendline || ds.isForecast) {
                copy.stack = 'aux-' + (auxCount++);
            } else {
                copy.stack = 'data';
            }
            return copy;
        });
    }

    // Return a copy of a Chart.js scales config with `stacked: true` on
    // every axis. When disabled (or for null input) the original object
    // is returned untouched.
    function applyStackedScales(scales, enabled) {
        if (!enabled || !scales || typeof scales !== 'object') return scales;
        const out = {};
        Object.keys(scales).forEach(function (key) {
            out[key] = Object.assign({}, scales[key]);
            out[key].stacked = true;
        });
        return out;
    }

    // ── Widget chart options ─────────────────────────────────────────
    // Single source of truth for which chart options apply to which widget
    // type, shared by the Graph Builder and the dashboard widget settings
    // so both expose the same controls and every visible control works.
    const MULTI_SERIES_TYPES = ['balance', 'budget_spent', 'expenses_by_category',
        'category_subcat', 'label_spend', 'subscription_cost', 'budget_breakdown'];
    const PIE_CAPABLE_TYPES = MULTI_SERIES_TYPES.concat(['earned_spent']);
    const EXCLUSION_TYPES = ['earned_spent', 'budget_spent', 'expenses_by_category',
        'category_subcat', 'sankey', 'label_spend', 'subscription_cost', 'budget_breakdown'];
    const BUDGET_FILTER_TYPES = ['budget_spent', 'label_spend', 'budget_breakdown'];

    // state: { chartType: 'line'|'pie', chartMode: 'combined'|'split',
    //          variant: earned chart type ('bars'|'delta_line'|'delta_bar') }
    function widgetOptionSupport(widgetType, state) {
        const t = widgetType || 'balance';
        state = state || {};
        const pie = state.chartType === 'pie' && PIE_CAPABLE_TYPES.includes(t);
        const lineChart = !pie && (MULTI_SERIES_TYPES.includes(t) || t === 'net_worth');
        const earnedLine = !pie && t === 'earned_spent';
        const variant = state.variant || 'bars';
        return {
            dateRange: t !== 'saved_this_month',
            interval: !['saved_this_month', 'sankey', 'card_paydown'].includes(t),
            accounts: t !== 'net_worth',
            budgets: BUDGET_FILTER_TYPES.includes(t),
            layout: t === 'balance' && !pie,
            groupBy: t === 'expenses_by_category' || t === 'category_subcat',
            variant: earnedLine,
            chartType: PIE_CAPABLE_TYPES.includes(t),
            stacked: lineChart && t !== 'net_worth' &&
                !(t === 'balance' && (state.chartMode || 'combined') !== 'split'),
            pct: lineChart,
            comparison: t === 'balance' && !pie,
            forecast: t === 'balance' && !pie,
            trendline: lineChart || earnedLine,
            lineStyle: lineChart,
            grid: !pie && !['saved_this_month', 'sankey'].includes(t),
            ticks: lineChart || earnedLine || t === 'card_paydown',
            beginAtZero: lineChart || (earnedLine && variant === 'delta_line'),
            exclusions: EXCLUSION_TYPES.includes(t),
            includeUnlabeled: t === 'label_spend',
            breakdownBy: t === 'budget_breakdown',
            subscriptions: t === 'subscription_cost',
            categories: t === 'category_subcat',
            sankeyFlow: t === 'sankey'
        };
    }

    // Apply the line display options to every real series (trend lines and
    // forecasts keep their own style). With stacking + fill each series
    // fills down to the one below it (stacked area); otherwise to zero.
    // opts: { showPoints, fillArea, tension, stacked, pointRadius }
    function applyLineStyle(datasets, opts) {
        if (!Array.isArray(datasets) || !opts) return datasets;
        const radius = opts.pointRadius != null ? opts.pointRadius : 3;
        let seriesIndex = 0;
        datasets.forEach(function (ds) {
            if (!ds || ds.isTrendline || ds.isForecast) return;
            if (isFinite(opts.tension)) ds.tension = opts.tension;
            ds.pointRadius = opts.showPoints ? radius : 0;
            ds.pointHoverRadius = Math.max(radius, 4);
            ds.fill = opts.fillArea
                ? (opts.stacked && seriesIndex > 0 ? '-1' : 'origin')
                : false;
            // Overlapping fills stay light so lower series remain readable;
            // stacked areas do not overlap and can be stronger
            if (opts.fillArea && /^#[0-9a-f]{6}$/i.test(ds.borderColor || '')) {
                ds.backgroundColor = ds.borderColor + (opts.stacked ? '59' : '1a');
            }
            seriesIndex++;
        });
        return datasets;
    }

    // Apply tick limits and the y-from-zero baseline to a Chart.js scales
    // config (mutates and returns it). opts: { xAxisLimit, yAxisLimit, beginAtZero }
    function applyAxisOptions(scales, opts) {
        if (!scales || !opts) return scales;
        if (scales.x) {
            scales.x.ticks = Object.assign({}, scales.x.ticks);
            if (opts.xAxisLimit > 0) {
                scales.x.ticks.maxTicksLimit = opts.xAxisLimit;
                scales.x.ticks.autoSkip = true;
            }
        }
        if (scales.y) {
            scales.y.ticks = Object.assign({}, scales.y.ticks);
            if (opts.yAxisLimit > 0) scales.y.ticks.maxTicksLimit = opts.yAxisLimit;
            if (opts.beginAtZero != null) scales.y.beginAtZero = !!opts.beginAtZero;
        }
        return scales;
    }

    // Percentage change per point: 'from_previous' (default) or 'from_first'.
    // Divides by the magnitude of the base so a move from -100 to -50 reads
    // +50% (an improvement), not -50%. Index 0 and zero/missing bases -> null.
    function computePercentChange(data, mode) {
        const values = Array.isArray(data) ? data : [];
        const out = new Array(values.length).fill(null);
        const usable = function (v) { return v !== null && v !== undefined && !isNaN(v); };
        for (let i = 1; i < values.length; i++) {
            const current = values[i];
            if (!usable(current)) continue;
            const base = mode === 'from_first' ? values[0] : values[i - 1];
            if (!usable(base) || base === 0) continue;
            out[i] = ((current - base) / Math.abs(base)) * 100;
        }
        return out;
    }

    // ── Hover value guide (line charts) ───────────────────────────
    // Chart.js plugin: while the user hovers a point, draw a dotted
    // horizontal line across the full plot area at the hovered point's
    // value, so it is easy to see how that value compares to the rest
    // of the series (its historical context).
    //
    // Attach it per chart (not via Chart.register) so bar/pie-only
    // charts never get the guide:
    //   new Chart(ctx, { ..., plugins: [OxiUI.hoverValueGuidePlugin] })
    //
    // The line is placed at the pixel Y of the first hovered element
    // from a line dataset (falling back to the first hovered element),
    // which keeps it correct on mixed bar/line
    // charts and on charts with dual y-axes.
    const hoverValueGuidePlugin = {
        id: 'oxiHoverValueGuide',
        afterDatasetsDraw(chart) {
            let active = [];
            try {
                active = chart.getActiveElements() || [];
            } catch (e) {
                return;
            }
            if (active.length === 0) return;

            const datasets = chart.data.datasets || [];
            const fromLineDataset = function (entry) {
                const ds = datasets[entry.datasetIndex];
                return !!ds && (ds.type === 'line' || chart.config.type === 'line');
            };
            const entry = active.find(fromLineDataset) || active[0];
            // Chart.js active elements are { datasetIndex, index, element };
            // pixel coordinates live on the element itself.
            const point = entry && (entry.element || entry);
            if (!point || typeof point.y !== 'number') return;

            const area = chart.chartArea;
            if (!area) return;

            const isDark = !!(document.documentElement &&
                document.documentElement.getAttribute('data-theme') === 'dark');
            const ctx = chart.ctx;
            ctx.save();
            ctx.strokeStyle = isDark ? 'rgba(124, 131, 247, 0.65)' : 'rgba(41, 128, 185, 0.55)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(area.left, point.y);
            ctx.lineTo(area.right, point.y);
            ctx.stroke();
            ctx.restore();
        }
    };

    // ── Card paydown chart ─────────────────────────────────────────
    // One combined chart, shared by the Graph Builder preview and the
    // dashboard widget so both look the same: monthly payments (up) and
    // spending (down) as bars, net paydown as a line, and the card balance
    // as a dashed line on its own right-hand axis.
    //   data  /api/card-paydown response ({ monthly_activity: [...] })
    // opts (optional): { xAxisLimit, yAxisLimit } tick limits
    function cardPaydownChartConfig(data, opts) {
        const activity = (data && data.monthly_activity) || [];
        const c = getChartColors();
        const alpha = function (hex, a) {
            return hex + Math.round(a * 255).toString(16).padStart(2, '0');
        };
        const money = function (v) {
            return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        const config = {
            type: 'bar',
            plugins: [hoverValueGuidePlugin],
            data: {
                labels: activity.map(function (a) { return a.month; }),
                datasets: [
                    {
                        label: 'Payments',
                        data: activity.map(function (a) { return a.payments || 0; }),
                        backgroundColor: alpha(c.earned, 0.8),
                        borderColor: c.earned,
                        borderWidth: 1
                    },
                    {
                        label: 'Spending',
                        data: activity.map(function (a) { return (a.spending || 0) * -1; }),
                        backgroundColor: alpha(c.spent, 0.8),
                        borderColor: c.spent,
                        borderWidth: 1
                    },
                    {
                        label: 'Net Paydown',
                        type: 'line',
                        data: activity.map(function (a) { return a.net_paydown || 0; }),
                        borderColor: c.accent,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.3,
                        pointRadius: 3,
                        pointBackgroundColor: c.accent,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Balance',
                        type: 'line',
                        data: activity.map(function (a) { return a.balance || 0; }),
                        borderColor: c.series[6],
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        tension: 0.3,
                        pointRadius: 2,
                        pointBackgroundColor: c.series[6],
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: c.textColor, boxWidth: 12, padding: 10, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const val = context.parsed.y;
                                return context.dataset.label + ': ' + (val >= 0 ? '+' : '-') + money(Math.abs(val));
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: c.textColor, maxTicksLimit: 8 },
                        grid: { color: c.gridColor }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        ticks: {
                            color: c.textColor,
                            callback: function (value) {
                                return (value < 0 ? '-' : '') + Math.abs(value).toLocaleString();
                            }
                        },
                        grid: { color: c.gridColor },
                        title: { display: true, text: 'Monthly Activity', color: c.textColor }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: {
                            color: c.textColor,
                            callback: function (value) { return value.toLocaleString(); }
                        },
                        grid: { display: false },
                        title: { display: true, text: 'Balance', color: c.textColor }
                    }
                }
            }
        };
        if (opts) {
            const scales = config.options.scales;
            applyAxisOptions(scales, { xAxisLimit: opts.xAxisLimit, yAxisLimit: opts.yAxisLimit });
            if (opts.yAxisLimit > 0) scales.y1.ticks.maxTicksLimit = opts.yAxisLimit;
        }
        return config;
    }

    // ── Balance comparison ──────────────────────────────────────────
    // "Compare with previous period" for balance charts, shared by the
    // builder preview and the dashboard widget. Follows the layout:
    // combined -> one total line + the previous period's total; split -> one
    // line per account + that account's previous period. The previous
    // period has its own dates, so its values are aligned by position (day
    // 1 with day 1), not looked up by the current period's labels.
    //   history, comparison  /api/accounts/balance-history responses
    //   opts  { split }
    // Returns { labels, datasets } (comparison series carry isComparison).
    function seriesValues(entries) {
        if (Array.isArray(entries)) {
            return entries.map(function (e) { return parseFloat(e && e.value != null ? e.value : e) || 0; });
        }
        if (!entries || typeof entries !== 'object') return [];
        return Object.keys(entries).sort().map(function (k) {
            const v = entries[k];
            return parseFloat(v !== null && typeof v === 'object' ? v.value : v) || 0;
        });
    }

    function seriesLabels(entries) {
        if (Array.isArray(entries)) {
            return entries.map(function (e) { return e.key || e.date || e.timestamp; });
        }
        return entries && typeof entries === 'object' ? Object.keys(entries).sort() : [];
    }

    function fitLength(values, length) {
        const out = values.slice(0, length);
        while (out.length < length) out.push(null);
        return out;
    }

    function balanceComparisonChart(history, comparison, opts) {
        opts = opts || {};
        const current = (history || []).filter(function (ds) { return ds && ds.entries; });
        const previous = (comparison || []).filter(function (ds) { return ds && ds.entries; });
        const first = current.find(function (ds) { return seriesLabels(ds.entries).length > 0; });
        const labels = first ? seriesLabels(first.entries) : [];
        if (labels.length === 0) return { labels: [], datasets: [] };

        const c = getChartColors();
        const palette = getSeriesPalette();
        const line = function (label, data, color, isComparison) {
            return {
                label: label,
                data: fitLength(data, labels.length),
                borderColor: color,
                backgroundColor: color + (isComparison ? '1a' : '33'),
                borderWidth: 2,
                borderDash: isComparison ? [5, 5] : undefined,
                fill: false,
                isComparison: !!isComparison
            };
        };
        const total = function (series) {
            const sum = new Array(labels.length).fill(0);
            series.forEach(function (ds) {
                seriesValues(ds.entries).forEach(function (v, i) {
                    if (i < sum.length) sum[i] += v;
                });
            });
            return sum;
        };

        if (!opts.split) {
            const datasets = [line('Total balance', total(current), c.accent, false)];
            if (previous.length) {
                datasets.push(line('Total balance (prev period)', total(previous), c.neutral, true));
            }
            return { labels: labels, datasets: datasets };
        }

        const datasets = current.map(function (ds, i) {
            return line(ds.label, seriesValues(ds.entries), palette[i % palette.length], false);
        });
        current.forEach(function (ds, i) {
            const prev = previous.find(function (p) { return p.label === ds.label; }) ||
                (previous.length === current.length ? previous[i] : null);
            if (!prev) return;
            datasets.push(line(ds.label + ' (prev period)', seriesValues(prev.entries),
                palette[i % palette.length], true));
        });
        return { labels: labels, datasets: datasets };
    }

    // Line display options for a comparison chart: the current period gets
    // the usual points / fill / smoothness, the previous period the same
    // points and smoothness but never a fill (it would hide the current one).
    function styleComparisonDatasets(datasets, opts) {
        opts = opts || {};
        applyLineStyle(datasets.filter(function (d) { return !d.isComparison; }),
            { showPoints: opts.showPoints, fillArea: opts.fillArea, tension: opts.tension, stacked: false });
        datasets.filter(function (d) { return d.isComparison; }).forEach(function (d) {
            if (isFinite(opts.tension)) d.tension = opts.tension;
            d.pointRadius = opts.showPoints ? 3 : 0;
            d.fill = false;
        });
        return datasets;
    }

    window.OxiUI = {
        toast: toast,
        confirm: confirmDialog,
        prompt: promptDialog,
        formatCurrency: formatCurrency,
        getChartColors: getChartColors,
        getSeriesPalette: getSeriesPalette,
        chartGridPlugin: chartGridPlugin,
        pieChartConfig: pieChartConfig,
        createPieChart: createPieChart,
        restylePieChart: restylePieChart,
        pieSlices: pieSlices,
        mixHex: mixHex,
        spinnerHtml: spinnerHtml,
        movingAverage: movingAverage,
        trendlineDataset: trendlineDataset,
        addTrendlineDatasets: addTrendlineDatasets,
        applyStacking: applyStacking,
        applyStackedScales: applyStackedScales,
        widgetOptionSupport: widgetOptionSupport,
        applyLineStyle: applyLineStyle,
        applyAxisOptions: applyAxisOptions,
        computePercentChange: computePercentChange,
        cardPaydownChartConfig: cardPaydownChartConfig,
        balanceComparisonChart: balanceComparisonChart,
        styleComparisonDatasets: styleComparisonDatasets,
        hoverValueGuidePlugin: hoverValueGuidePlugin
    };
})();
