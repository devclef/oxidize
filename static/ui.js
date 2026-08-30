/**
 * Shared UI helpers for Oxidize.
 * Loaded on every page before page scripts (app.js / dashboard.js / inline).
 *
 *  - OxiUI.toast(message, type)      non-blocking notifications
 *  - OxiUI.confirm(opts)             Promise<boolean> confirm dialog
 *  - OxiUI.prompt(opts)              Promise<string|null> input dialog
 *  - OxiUI.formatCurrency(v, opts)   consistent amount formatting (no currency symbol)
 *  - OxiUI.getChartColors()          theme-aware chart colors
 *  - OxiUI.spinnerHtml(label)        inline loading spinner
 *  - OxiUI.movingAverage(v, w)      trailing moving average (null-safe)
 *  - OxiUI.trendlineDataset(...)    dotted moving-average dataset
 *  - OxiUI.addTrendlineDatasets(..) trend lines for a set of datasets
 *  - OxiUI.applyStacking(ds, on)    Chart.js stack groups for line charts
 *  - OxiUI.applyStackedScales(s,on) stacked flag on all chart axes
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
    function getChartColors() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        return isDark
            ? {
                textColor: '#d4d4de',
                gridColor: 'rgba(255, 255, 255, 0.08)',
                tooltipBg: '#1e1e28',
                tooltipBorder: 'rgba(255, 255, 255, 0.15)',
                tooltipText: '#e7e7ec'
            }
            : {
                textColor: '#333',
                gridColor: '#ddd',
                tooltipBg: '#ffffff',
                tooltipBorder: '#e5e7eb',
                tooltipText: '#1a1a2e'
            };
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
            if (!ds || ds.isTrendline || !Array.isArray(ds.data)) return;
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
    // that belongs to a line dataset (falling back to the first
    // hovered element), which keeps it correct on mixed bar/line
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
            const el = active.find(fromLineDataset) || active[0];
            if (!el || typeof el.y !== 'number') return;

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
            ctx.moveTo(area.left, el.y);
            ctx.lineTo(area.right, el.y);
            ctx.stroke();
            ctx.restore();
        }
    };

    window.OxiUI = {
        toast: toast,
        confirm: confirmDialog,
        prompt: promptDialog,
        formatCurrency: formatCurrency,
        getChartColors: getChartColors,
        spinnerHtml: spinnerHtml,
        movingAverage: movingAverage,
        trendlineDataset: trendlineDataset,
        addTrendlineDatasets: addTrendlineDatasets,
        applyStacking: applyStacking,
        applyStackedScales: applyStackedScales,
        hoverValueGuidePlugin: hoverValueGuidePlugin
    };
})();
