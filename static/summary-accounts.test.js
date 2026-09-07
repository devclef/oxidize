// @vitest-environment jsdom
/**
 * Account include/exclude filter on the Monthly Summary page (/summary):
 * the page must let the user choose which accounts the summary counts,
 * persist that choice, and send it to the API as accounts[] (include) or
 * exclude_accounts[] (exclude).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = readFileSync(path.resolve(root, 'static/summary.html'), 'utf8');
const css = readFileSync(path.resolve(root, 'static/style.css'), 'utf8');
const utils = readFileSync(path.resolve(root, 'static/summary-utils.js'), 'utf8');

describe('summary page account filter markup', () => {
    it('has an Accounts toggle button in the page header', () => {
        expect(html).toContain('id="account-filter-toggle"');
        expect(html).toContain('id="account-filter-badge"');
        expect(html).toContain('aria-controls="account-filter-panel"');
    });

    it('has a filter panel with mode, account list, and actions', () => {
        expect(html).toContain('id="account-filter-panel"');
        expect(html).toContain('id="account-filter-mode"');
        expect(html).toContain('id="account-filter-accounts"');
        expect(html).toContain('id="account-filter-apply"');
        expect(html).toContain('id="account-filter-reset"');
        expect(html).toContain('id="account-filter-select-all"');
        expect(html).toContain('id="account-filter-clear"');
    });

    it('offers all-accounts, include-only and exclude modes', () => {
        const modeSelect = html.slice(
            html.indexOf('id="account-filter-mode"'),
            html.indexOf('</select>', html.indexOf('id="account-filter-mode"'))
        );
        expect(modeSelect).toContain('value="all"');
        expect(modeSelect).toContain('value="include"');
        expect(modeSelect).toContain('value="exclude"');
    });

    it('has the account list as a multi-select', () => {
        const tag = html.slice(
            html.lastIndexOf('<select', html.indexOf('id="account-filter-accounts"')),
            html.indexOf('id="account-filter-accounts"') + 50
        );
        expect(tag).toContain('multiple');
    });
});

describe('summary page account filter wiring', () => {
    it('sends the account filter with the API request', () => {
        expect(html).toContain('MonthSummary.buildAccountFilterParams(');
        expect(html).toMatch(/buildAccountFilterParams\(accountFilter\.mode,\s*accountFilter\.ids\)/);
    });

    it('persists and restores the filter via localStorage', () => {
        expect(html).toContain('MonthSummary.ACCOUNT_FILTER_KEY');
        expect(html).toMatch(/localStorage\.getItem\(MonthSummary\.ACCOUNT_FILTER_KEY\)/);
        expect(html).toMatch(/localStorage\.setItem\(MonthSummary\.ACCOUNT_FILTER_KEY/);
    });

    it('applies the filter on Apply and clears it on Reset', () => {
        // The apply handler is bound in the page script (last occurrence).
        const applyIdx = html.lastIndexOf('getElementById(\'account-filter-apply\')');
        expect(applyIdx).toBeGreaterThan(-1);
        const handler = html.slice(applyIdx, applyIdx + 1200);
        expect(handler).toContain('saveAccountFilter()');
        expect(handler).toContain('loadSummary()');

        const resetIdx = html.lastIndexOf('getElementById(\'account-filter-reset\')');
        expect(resetIdx).toBeGreaterThan(-1);
        const resetHandler = html.slice(resetIdx, resetIdx + 600);
        expect(resetHandler).toContain("mode: 'all'");
        expect(resetHandler).toContain('loadSummary()');
    });

    it('loads the account list before first render', () => {
        expect(html).toMatch(/loadAccounts\(\)\s*\.then\(/);
        expect(html).toContain("/api/accounts");
    });

    it('shows the active filter in the summary meta line', () => {
        expect(html).toContain('MonthSummary.describeAccountFilter(');
    });
});

describe('summary page account filter helpers', () => {
    it('summary-utils exposes the filter helpers and storage key', () => {
        expect(utils).toContain('buildAccountFilterParams');
        expect(utils).toContain('parseAccountFilter');
        expect(utils).toContain('describeAccountFilter');
        expect(utils).toMatch(/ACCOUNT_FILTER_KEY\s*=\s*'oxidize_summary_account_filter'/);
        expect(utils).toContain('exclude_accounts[]');
        expect(utils).toContain('accounts[]');
    });
});

describe('summary page account filter styles', () => {
    it('styles the panel, badge and grid', () => {
        expect(css).toContain('.account-filter-panel');
        expect(css).toContain('.filter-badge');
        expect(css).toContain('.account-filter-grid');
        expect(css).toContain('.page-header-actions');
    });
});

describe('summary page account filter (functional)', () => {
    /**
     * Loads the real page script into a jsdom document with stubbed
     * dependencies and returns the fetch URLs observed during init.
     */
    async function runPage({ filter, accounts, summary } = {}) {
        // Minimal page DOM: only the elements the init path touches.
        const ids = [
            'summary-error', 'summary-warnings', 'summary-loading', 'summary-content',
            'kpi-grid', 'summary-meta', 'budget-summary', 'budget-list',
            'category-list', 'top-expenses',
            'prev-month', 'next-month', 'this-month', 'month-picker',
            'account-filter-toggle', 'account-filter-badge', 'account-filter-panel',
            'account-filter-select-all', 'account-filter-clear',
            'account-filter-mode', 'account-filter-accounts',
            'account-filter-count', 'account-filter-reset', 'account-filter-apply',
        ];
        document.body.innerHTML = ids.map((id) =>
            id === 'account-filter-accounts'
                ? `<select multiple id="${id}"></select>`
                : id === 'month-picker'
                    ? `<input type="month" id="${id}">`
                    : `<div id="${id}"></div>`
        ).join('');
        // The mode select needs its options for the value assignment.
        document.getElementById('account-filter-mode').innerHTML =
            '<option value="all"></option><option value="include"></option><option value="exclude"></option>';

        const utilsSrc = readFileSync(path.resolve(root, 'static/summary-utils.js'), 'utf8');
        const htmlSrc = readFileSync(path.resolve(root, 'static/summary.html'), 'utf8');
        const script = htmlSrc
            .split('<script>')
            .pop()
            .split('</' + 'script>')[0];

        const summaryBody = summary || {
            year: 2026, month: 6, start_date: '2026-06-01', end_date: '2026-06-30',
            is_current_month: false, currency: { code: 'USD', symbol: '$' },
            totals: {
                earned: 0, spent: 0, net: 0, savings_rate: null,
                days_in_month: 30, days_elapsed: 30, daily_average_spent: 0,
                prev_month_earned: null, prev_month_spent: null, prev_month_net: null,
                earned_delta_pct: null, spent_delta_pct: null,
                net_worth: null, net_worth_delta: null,
            },
            budgets: [], budget_totals: {
                count: 0, with_limit: 0, spent: 0, limited: 0,
                limited_spent: 0, over_count: 0,
            },
            categories: [],
            daily: { dates: [], earned: [], spent: [], cumulative_spent: [] },
            trend_12m: {
                labels: [], earned: [], spent: [],
            },
            top_expenses: [], warnings: [],
        };
        const accountsBody = accounts || [
            { id: '1', name: 'Checking', account_type: 'asset', balance: '5000', currency: '$' },
            { id: '3', name: 'Credit Card', account_type: 'liability', balance: '-250', currency: '$' },
        ];

        // jsdom in this setup does not surface a usable localStorage
        // (see theme.test.js); stub it so the page script's persistence
        // path runs.
        if (!window.localStorage) {
            const store = {};
            Object.defineProperty(window, 'localStorage', {
                configurable: true,
                value: {
                    getItem: (k) => (k in store ? store[k] : null),
                    setItem: (k, v) => { store[k] = String(v); },
                    removeItem: (k) => { delete store[k]; },
                    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
                },
            });
        }

        const fetched = [];
        window.fetch = (url) => {
            fetched.push(String(url));
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(
                    String(url).includes('/api/accounts') ? accountsBody : summaryBody
                ),
            });
        };
        window.OxiUI = {
            formatCurrency: (v) => String(v),
            getChartColors: () => ({}),
            spinnerHtml: () => '',
        };
        window.Chart = class {
            constructor() { this.options = {}; }
            destroy() {}
        };
        window.localStorage.clear();
        if (filter) {
            window.localStorage.setItem('oxidize_summary_account_filter', JSON.stringify(filter));
        }
        // Service worker registration must not fail the init path.
        Object.defineProperty(window.navigator, 'serviceWorker', {
            value: { register: () => Promise.resolve() },
            configurable: true,
        });

        (0, eval)(utilsSrc);
        (0, eval)(script);
        document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
        // Let the init promises settle.
        await new Promise((r) => setTimeout(r, 20));
        return { fetched, doc: document };
    }

    it('loads without a filter: no account params in the summary request', async () => {
        const { fetched } = await runPage();
        const summaryUrl = fetched.find((u) => u.includes('/api/summary/month'));
        expect(summaryUrl).toBeTruthy();
        expect(summaryUrl).not.toContain('accounts');
        expect(summaryUrl).not.toContain('exclude_accounts');
    });

    it('sends exclude_accounts[] when an exclude filter is persisted', async () => {
        const { fetched, doc } = await runPage({ filter: { mode: 'exclude', ids: ['3'] } });
        const summaryUrl = fetched.find((u) => u.includes('/api/summary/month'));
        expect(summaryUrl).toContain('exclude_accounts[]=3');
        // Badge and meta reflect the active filter.
        expect(doc.getElementById('account-filter-badge').textContent).toBe('1 account excluded');
        expect(doc.getElementById('account-filter-badge').style.display).not.toBe('none');
        expect(doc.getElementById('summary-meta').textContent).toContain('1 account excluded');
    });

    it('sends accounts[] when an include filter is persisted', async () => {
        const { fetched, doc } = await runPage({ filter: { mode: 'include', ids: ['1', '3'] } });
        const summaryUrl = fetched.find((u) => u.includes('/api/summary/month'));
        expect(summaryUrl).toContain('accounts[]=1');
        expect(summaryUrl).toContain('accounts[]=3');
        expect(doc.getElementById('account-filter-badge').textContent).toBe('2 accounts included');
    });

    it('restores the selection into the account list grouped by type', async () => {
        const { doc } = await runPage({ filter: { mode: 'exclude', ids: ['3'] } });
        const sel = doc.getElementById('account-filter-accounts');
        const opts = Array.from(sel.options);
        expect(opts.length).toBe(2);
        const groups = Array.from(new Set(opts.map((o) => o.parentElement.label)));
        expect(groups).toEqual(['Assets', 'Liabilities']);
        const cardOpt = opts.find((o) => o.value === '3');
        expect(cardOpt.selected).toBe(true);
        const checkingOpt = opts.find((o) => o.value === '1');
        expect(checkingOpt.selected).toBe(false);
        expect(doc.getElementById('account-filter-mode').value).toBe('exclude');
    });
});
