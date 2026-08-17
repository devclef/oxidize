// @vitest-environment jsdom
/**
 * Tests for the shared UI kit (static/ui.js): toasts, confirm/prompt dialogs,
 * amount formatting, theme-aware chart colors and the loading spinner.
 *
 * ui.js is a classic script (IIFE attaching window.OxiUI), not an ES module,
 * so we evaluate the actual shipped file here instead of copying the
 * implementation into the test (app.test.js / dashboard.test.js use inline
 * copies for the same reason).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Resolved from the project root (npm test runs vitest from there), which
// keeps this working under the jsdom environment where import.meta.url is
// not a file: URL.
const uiSource = readFileSync(path.resolve(process.cwd(), 'static/ui.js'), 'utf8');
(0, eval)(uiSource); // indirect eval: runs in global scope, attaches window.OxiUI

function pressKey(key) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function click(selector) {
    document.querySelector(selector).click();
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
});

// ── Toasts ──────────────────────────────────────────────────────────────────
describe('OxiUI.toast', () => {
    it('creates a single aria-live container, reused across toasts', () => {
        OxiUI.toast('a');
        OxiUI.toast('b');
        const containers = document.querySelectorAll('.toast-container');
        expect(containers.length).toBe(1);
        expect(containers[0].getAttribute('role')).toBe('status');
        expect(containers[0].getAttribute('aria-live')).toBe('polite');
        expect(containers[0].children.length).toBe(2);
    });

    it('defaults to the info type with its icon and message text', () => {
        const el = OxiUI.toast('hello');
        expect(el.classList.contains('toast')).toBe(true);
        expect(el.classList.contains('toast-info')).toBe(true);
        expect(el.getAttribute('role')).toBe('status');
        expect(el.querySelector('.toast-icon').textContent).toBe('\u2139');
        expect(el.querySelector('.toast-message').textContent).toBe('hello');
    });

    it('renders success and error types with their icons; error is an alert', () => {
        const ok = OxiUI.toast('done', 'success');
        expect(ok.classList.contains('toast-success')).toBe(true);
        expect(ok.querySelector('.toast-icon').textContent).toBe('\u2713');

        const err = OxiUI.toast('boom', 'error');
        expect(err.classList.contains('toast-error')).toBe(true);
        expect(err.getAttribute('role')).toBe('alert');
        expect(err.querySelector('.toast-icon').textContent).toBe('\u2715');
    });

    it('falls back to info for unknown types and stringifies non-strings', () => {
        const el = OxiUI.toast(42, 'bogus');
        expect(el.classList.contains('toast-info')).toBe(true);
        expect(el.querySelector('.toast-message').textContent).toBe('42');
    });

    it('auto-dismisses after 3.5s for info, 6s for error (250ms exit)', () => {
        const info = OxiUI.toast('info');
        vi.advanceTimersByTime(3499);
        expect(info.classList.contains('toast-leaving')).toBe(false);
        vi.advanceTimersByTime(1);
        expect(info.classList.contains('toast-leaving')).toBe(true);
        vi.advanceTimersByTime(249);
        expect(document.body.contains(info)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(document.body.contains(info)).toBe(false);

        const err = OxiUI.toast('error', 'error');
        vi.advanceTimersByTime(6000);
        expect(err.classList.contains('toast-leaving')).toBe(true);
        vi.advanceTimersByTime(250);
        expect(document.body.contains(err)).toBe(false);
    });

    it('dismisses on click', () => {
        const el = OxiUI.toast('click me');
        el.click();
        expect(el.classList.contains('toast-leaving')).toBe(true);
        vi.advanceTimersByTime(250);
        expect(document.body.contains(el)).toBe(false);
    });

    it('caps the stack at 4 toasts, dropping the oldest', () => {
        const t1 = OxiUI.toast('1');
        OxiUI.toast('2');
        OxiUI.toast('3');
        OxiUI.toast('4');
        OxiUI.toast('5');
        const container = document.querySelector('.toast-container');
        expect(container.children.length).toBe(4);
        expect(document.body.contains(t1)).toBe(false);
    });
});

// ── Confirm dialog ──────────────────────────────────────────────────────────
describe('OxiUI.confirm', () => {
    it('shows a modal dialog with title, message and default labels', async () => {
        const p = OxiUI.confirm({ title: 'Delete graph?', message: 'This cannot be undone.' });
        const overlay = document.querySelector('.dialog-overlay');
        const dialog = document.querySelector('.dialog');
        expect(overlay.style.display).toBe('flex');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.querySelector('.dialog-title').textContent).toBe('Delete graph?');
        expect(document.querySelector('.dialog-message').textContent).toBe('This cannot be undone.');
        expect(document.querySelector('.dialog-confirm').textContent).toBe('Confirm');
        expect(document.querySelector('.dialog-cancel').textContent).toBe('Cancel');
        // No input row for a plain confirm
        expect(document.querySelector('.dialog-input-row').style.display).toBe('none');
        await click('.dialog-confirm');
        await expect(p).resolves.toBe(true);
    });

    it('uses default title "Are you sure?" and hides the message when omitted', () => {
        OxiUI.confirm({});
        expect(document.querySelector('.dialog-title').textContent).toBe('Are you sure?');
        expect(document.querySelector('.dialog-message').style.display).toBe('none');
    });

    it('focuses the confirm button and restores focus to the trigger on close', async () => {
        const trigger = document.createElement('button');
        trigger.id = 'trigger';
        document.body.appendChild(trigger);
        trigger.focus();

        const p = OxiUI.confirm({});
        await vi.advanceTimersByTimeAsync(0);
        expect(document.activeElement).toBe(document.querySelector('.dialog-confirm'));

        click('.dialog-cancel');
        await expect(p).resolves.toBe(false);
        expect(document.activeElement).toBe(trigger);
    });

    it('resolves false on cancel, close button, Escape, and backdrop click', async () => {
        let p = OxiUI.confirm({});
        click('.dialog-cancel');
        await expect(p).resolves.toBe(false);

        p = OxiUI.confirm({});
        click('.dialog-close');
        await expect(p).resolves.toBe(false);

        p = OxiUI.confirm({});
        pressKey('Escape');
        await expect(p).resolves.toBe(false);

        p = OxiUI.confirm({});
        document.querySelector('.dialog-overlay')
            .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await expect(p).resolves.toBe(false);
    });

    it('stays open when mousedown lands on the dialog itself', async () => {
        const p = OxiUI.confirm({});
        document.querySelector('.dialog')
            .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(document.querySelector('.dialog-overlay').style.display).not.toBe('none');
        pressKey('Escape');
        await expect(p).resolves.toBe(false);
    });

    it('confirms on Enter', async () => {
        const p = OxiUI.confirm({});
        pressKey('Enter');
        await expect(p).resolves.toBe(true);
    });

    it('supports custom labels and the danger styling', () => {
        OxiUI.confirm({ confirmLabel: 'Yes, delete', cancelLabel: 'Keep it', danger: true });
        expect(document.querySelector('.dialog-confirm').textContent).toBe('Yes, delete');
        expect(document.querySelector('.dialog-cancel').textContent).toBe('Keep it');
        expect(document.querySelector('.dialog-confirm').classList.contains('danger')).toBe(true);

        document.querySelector('.dialog-cancel').click();
        OxiUI.confirm({});
        expect(document.querySelector('.dialog-confirm').classList.contains('danger')).toBe(false);
    });
});

// ── Prompt dialog ───────────────────────────────────────────────────────────
describe('OxiUI.prompt', () => {
    it('shows an input pre-filled from defaultValue, focused and selected', async () => {
        const p = OxiUI.prompt({ title: 'Rename', message: 'New name:', defaultValue: 'old' });
        await vi.advanceTimersByTimeAsync(0);
        const input = document.querySelector('.dialog-input');
        expect(input.value).toBe('old');
        expect(input.placeholder).toBe('');
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(3);
        click('.dialog-cancel');
        await expect(p).resolves.toBe(null);
    });

    it('resolves the trimmed value on OK', async () => {
        const p = OxiUI.prompt({});
        await vi.advanceTimersByTimeAsync(0);
        document.querySelector('.dialog-input').value = '  My Budget  ';
        click('.dialog-confirm');
        await expect(p).resolves.toBe('My Budget');
    });

    it('resolves null on cancel and Escape', async () => {
        let p = OxiUI.prompt({});
        click('.dialog-cancel');
        await expect(p).resolves.toBe(null);

        p = OxiUI.prompt({});
        pressKey('Escape');
        await expect(p).resolves.toBe(null);
    });

    it('supports validation: blocks confirm, shows inline error, then accepts', async () => {
        const p = OxiUI.prompt({
            validate: (v) => (v ? null : 'Please enter a name')
        });
        await vi.advanceTimersByTimeAsync(0);
        const input = document.querySelector('.dialog-input');
        const errEl = document.querySelector('.dialog-error');

        click('.dialog-confirm');
        expect(errEl.textContent).toBe('Please enter a name');
        expect(document.querySelector('.dialog-overlay').style.display).not.toBe('none');
        expect(document.activeElement).toBe(input);

        input.value = 'Utilities';
        click('.dialog-confirm');
        await expect(p).resolves.toBe('Utilities');
        expect(errEl.textContent).toBe('');
    });

    it('confirms via Enter when the value is valid', async () => {
        const p = OxiUI.prompt({
            validate: (v) => (v ? null : 'required')
        });
        await vi.advanceTimersByTimeAsync(0);
        document.querySelector('.dialog-input').value = 'ok';
        pressKey('Enter');
        await expect(p).resolves.toBe('ok');
    });

    it('hides the input row when no input is requested (confirm reuses same shell)', () => {
        OxiUI.confirm({ message: 'm' });
        expect(document.querySelector('.dialog-input-row').style.display).toBe('none');
        expect(document.querySelector('.dialog-message').textContent).toBe('m');
    });
});

// ── Dialog stacking ─────────────────────────────────────────────────────────
describe('dialog stacking', () => {
    it('opening a second dialog settles the first with its cancel value', async () => {
        const p1 = OxiUI.confirm({ message: 'first' });
        const p2 = OxiUI.prompt({ message: 'second' });

        await expect(p1).resolves.toBe(false);

        // The single overlay now hosts the prompt.
        expect(document.querySelectorAll('.dialog-overlay').length).toBe(1);
        expect(document.querySelector('.dialog-message').textContent).toBe('second');
        expect(document.querySelector('.dialog-input-row').style.display).not.toBe('none');

        click('.dialog-cancel');
        await expect(p2).resolves.toBe(null);
    });

    it('a prompt opening over a prompt also cancels the earlier prompt', async () => {
        const p1 = OxiUI.prompt({ message: 'a' });
        const p2 = OxiUI.confirm({ message: 'b' });
        await expect(p1).resolves.toBe(null);
        expect(document.querySelector('.dialog-message').textContent).toBe('b');
        click('.dialog-confirm');
        await expect(p2).resolves.toBe(true);
    });
});

// ── Amount formatting ───────────────────────────────────────────────────────
describe('OxiUI.formatCurrency', () => {
    it('formats with thousands separators and 2 decimals by default', () => {
        expect(OxiUI.formatCurrency(1234.5)).toBe('1,234.50');
        expect(OxiUI.formatCurrency(0)).toBe('0.00');
        expect(OxiUI.formatCurrency(42)).toBe('42.00');
    });

    it('keeps a leading minus sign without a symbol', () => {
        expect(OxiUI.formatCurrency(-1234.5)).toBe('-1,234.50');
    });

    it('accepts numeric strings and honors the decimals option', () => {
        expect(OxiUI.formatCurrency('42')).toBe('42.00');
        expect(OxiUI.formatCurrency(1234.56, { decimals: 0 })).toBe('1,235');
        expect(OxiUI.formatCurrency(1234.44, { decimals: 0 })).toBe('1,234');
        expect(OxiUI.formatCurrency(-1234.56, { decimals: 0 })).toBe('-1,235');
    });

    it('abbreviates with K/M when compact', () => {
        expect(OxiUI.formatCurrency(999, { compact: true })).toBe('999');
        expect(OxiUI.formatCurrency(1234, { compact: true })).toBe('1.2K');
        expect(OxiUI.formatCurrency(123456, { compact: true })).toBe('123.5K');
        expect(OxiUI.formatCurrency(1234567, { compact: true })).toBe('1.2M');
        expect(OxiUI.formatCurrency(-1234, { compact: true })).toBe('-1.2K');
    });

    it('never renders a currency symbol (generic for the user)', () => {
        expect(OxiUI.formatCurrency(100)).not.toContain('$');
        // Even if a caller still passes a symbol, it is ignored.
        expect(OxiUI.formatCurrency(100, { symbol: '$' })).toBe('100.00');
        expect(OxiUI.formatCurrency(1234567, { symbol: '€', compact: true })).toBe('1.2M');
    });

    it('renders an em dash for non-finite values', () => {
        expect(OxiUI.formatCurrency(NaN)).toBe('\u2014');
        expect(OxiUI.formatCurrency(Infinity)).toBe('\u2014');
        expect(OxiUI.formatCurrency('abc')).toBe('\u2014');
        expect(OxiUI.formatCurrency(null)).toBe('\u2014');
    });
});

// ── Theme-aware chart colors ────────────────────────────────────────────────
describe('OxiUI.getChartColors', () => {
    it('returns the light palette by default and when data-theme is light', () => {
        const light = {
            textColor: '#333',
            gridColor: '#ddd',
            tooltipBg: '#ffffff',
            tooltipBorder: '#e5e7eb',
            tooltipText: '#1a1a2e'
        };
        expect(OxiUI.getChartColors()).toEqual(light);
        document.documentElement.setAttribute('data-theme', 'light');
        expect(OxiUI.getChartColors()).toEqual(light);
    });

    it('returns the dark palette when data-theme is dark', () => {
        document.documentElement.setAttribute('data-theme', 'dark');
        expect(OxiUI.getChartColors()).toEqual({
            textColor: '#d4d4de',
            gridColor: 'rgba(255, 255, 255, 0.08)',
            tooltipBg: '#1e1e28',
            tooltipBorder: 'rgba(255, 255, 255, 0.15)',
            tooltipText: '#e7e7ec'
        });
    });
});

// ── Spinner ─────────────────────────────────────────────────────────────────
describe('OxiUI.spinnerHtml', () => {
    it('wraps an optional label in the shared spinner markup', () => {
        expect(OxiUI.spinnerHtml()).toBe(
            '<span class="spinner" aria-hidden="true"></span><span></span>'
        );
        expect(OxiUI.spinnerHtml('Loading…')).toBe(
            '<span class="spinner" aria-hidden="true"></span><span>Loading…</span>'
        );
    });
});

// ── Trend line (moving average) ─────────────────────────────────────────────
describe('OxiUI.movingAverage', () => {
    it('computes a trailing window average, starting with partial windows', () => {
        // values: 1..10, window 3
        const out = OxiUI.movingAverage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
        expect(out).toEqual([
            1,           // avg(1)
            1.5,         // avg(1,2)
            2,           // avg(1,2,3)
            3,           // avg(2,3,4)
            4,
            5,
            6,
            7,
            8,
            9            // avg(8,9,10)
        ]);
    });

    it('window of 1 returns the values unchanged', () => {
        expect(OxiUI.movingAverage([4, 8, 15], 1)).toEqual([4, 8, 15]);
    });

    it('ignores null / non-numeric entries inside the window', () => {
        const out = OxiUI.movingAverage([2, null, 4, 'x', 8], 3);
        // i=0: avg(2)=2
        // i=1: avg(2, null)=2
        // i=2: avg(2, null, 4)=3
        // i=3: window null,4,'x' -> avg(4)=4
        // i=4: window 4,'x',8 -> avg(4,8)=6
        expect(out).toEqual([2, 2, 3, 4, 6]);
    });

    it('returns null where the whole window has no usable value', () => {
        expect(OxiUI.movingAverage([null, null, 5], 2)).toEqual([null, null, 5]);
    });

    it('falls back to the default window of 7 for invalid windows', () => {
        const long = Array.from({ length: 10 }, (_, i) => i + 1);
        expect(OxiUI.movingAverage(long, 0)).toEqual(OxiUI.movingAverage(long, 7));
        expect(OxiUI.movingAverage(long, -3)).toEqual(OxiUI.movingAverage(long, 7));
        expect(OxiUI.movingAverage(long, 'bogus')).toEqual(OxiUI.movingAverage(long, 7));
    });

    it('handles empty and non-array input', () => {
        expect(OxiUI.movingAverage([], 5)).toEqual([]);
        expect(OxiUI.movingAverage(null, 5)).toEqual([]);
    });
});

describe('OxiUI.trendlineDataset', () => {
    it('builds a dotted line dataset over the moving average', () => {
        const ds = OxiUI.trendlineDataset('Total Balance', [1, 2, 3, 4], { window: 2 });
        expect(ds.label).toBe('Total Balance (avg)');
        expect(ds.data).toEqual([1, 1.5, 2.5, 3.5]);
        expect(ds.type).toBe('line');
        expect(ds.borderDash).toEqual([2, 4]);
        expect(ds.pointRadius).toBe(0);
        expect(ds.fill).toBe(false);
        expect(ds.spanGaps).toBe(true);
        expect(ds.isTrendline).toBe(true);
        expect(ds.order).toBe(-1); // drawn on top
    });

    it('matches the source color when it is a plain string', () => {
        const ds = OxiUI.trendlineDataset('A', [1, 2, 3], { window: 1, sourceColor: '#3498db' });
        expect(ds.borderColor).toBe('#3498db');
    });

    it('falls back to the theme-aware amber color for non-string source colors', () => {
        document.documentElement.removeAttribute('data-theme');
        expect(OxiUI.trendlineDataset('A', [1, 2], { window: 1, sourceColor: ['#a', '#b'] }).borderColor).toBe('#d97706');
        document.documentElement.setAttribute('data-theme', 'dark');
        expect(OxiUI.trendlineDataset('A', [1, 2], { window: 1, sourceColor: null }).borderColor).toBe('#fbbf24');
    });

    it('uses an explicit color override and defaults to window 7', () => {
        const long = Array.from({ length: 10 }, (_, i) => i + 1);
        const ds = OxiUI.trendlineDataset('A', long, { color: '#123456' });
        expect(ds.borderColor).toBe('#123456');
        expect(ds.data).toEqual(OxiUI.movingAverage(long, 7));
    });

    it('names unlabeled series "Average"', () => {
        expect(OxiUI.trendlineDataset(undefined, [1], {}).label).toBe('Average');
    });
});

describe('OxiUI.addTrendlineDatasets', () => {
    it('adds one trend line per source dataset and records trendOf', () => {
        const datasets = [
            { label: 'A', data: [1, 2, 3, 4, 5], borderColor: '#111' },
            { label: 'B', data: [10, 20, 30, 40, 50], borderColor: ['#222'] }
        ];
        const additions = OxiUI.addTrendlineDatasets(datasets, { window: 2 });
        expect(additions.length).toBe(2);
        expect(additions[0].label).toBe('A (avg)');
        expect(additions[0].trendOf).toBe(0);
        expect(additions[0].borderColor).toBe('#111');
        expect(additions[1].label).toBe('B (avg)');
        expect(additions[1].trendOf).toBe(1);
        expect(additions[1].borderColor).toBe('#d97706'); // non-string source color
        expect(additions[1].data).toEqual(OxiUI.movingAverage([10, 20, 30, 40, 50], 2));
        // does not mutate the input
        expect(datasets.length).toBe(2);
    });

    it('skips existing trend lines and datasets without array data', () => {
        const datasets = [
            { label: 'A', data: [1, 2], isTrendline: true },
            { label: 'B', data: 'nope' }
        ];
        expect(OxiUI.addTrendlineDatasets(datasets, { window: 2 })).toEqual([]);
    });

    it('returns an empty list for non-array input', () => {
        expect(OxiUI.addTrendlineDatasets(null, { window: 2 })).toEqual([]);
    });
});
