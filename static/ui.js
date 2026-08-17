/**
 * Shared UI helpers for Oxidize.
 * Loaded on every page before page scripts (app.js / dashboard.js / inline).
 *
 *  - OxiUI.toast(message, type)      non-blocking notifications
 *  - OxiUI.confirm(opts)             Promise<boolean> confirm dialog
 *  - OxiUI.prompt(opts)              Promise<string|null> input dialog
 *  - OxiUI.formatCurrency(v, opts)   consistent currency formatting
 *  - OxiUI.getChartColors()          theme-aware chart colors
 *  - OxiUI.spinnerHtml(label)        inline loading spinner
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

    // ── Currency formatting ─────────────────────────────────────────────
    // opts: { symbol, code, decimals, compact }
    // compact: abbreviate 1,234 -> 1.2K and 1,234,567 -> 1.2M
    function formatCurrency(value, opts) {
        const num = typeof value === 'number' ? value : parseFloat(value);
        if (!isFinite(num)) return '\u2014';
        opts = opts || {};
        const decimals = opts.decimals != null ? opts.decimals : 2;
        const symbol = opts.symbol || '';
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
        return sign + symbol + body;
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

    window.OxiUI = {
        toast: toast,
        confirm: confirmDialog,
        prompt: promptDialog,
        formatCurrency: formatCurrency,
        getChartColors: getChartColors,
        spinnerHtml: spinnerHtml
    };
})();
