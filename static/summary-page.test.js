// @vitest-environment jsdom
/**
 * Monthly Summary page (/summary) rendering and navigation:
 * like-for-like comparison labels, unbudgeted spend, per-category change,
 * largest-expense details, the ?month= URL, arrow-key navigation, the
 * Refresh button, and discarding stale responses on fast month changes.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function summaryFor(year, month, overrides = {}) {
    const mm = String(month).padStart(2, '0');
    return {
        year, month, start_date: `${year}-${mm}-01`, end_date: `${year}-${mm}-28`,
        is_current_month: false, currency: { code: 'USD', symbol: '$' },
        totals: {
            earned: 3000, spent: 1275, net: 1725, savings_rate: 57.5,
            days_in_month: 28, days_elapsed: 28, daily_average_spent: 45.5,
            prev_month_earned: 2500, prev_month_spent: 550, prev_month_net: 1950,
            prev_period_earned: 2500, prev_period_spent: 550, prev_period_net: 1950,
            comparison_days: 31, earned_delta_pct: 20, spent_delta_pct: 131.8,
            projected_spent: null, spent_count: 5,
            net_worth: 1725, net_worth_delta: 725,
        },
        budgets: [
            { id: '1', name: 'Groceries', spent: 100, limit: 400, pct_of_limit: 25,
              projected: null, status: 'ok' },
        ],
        budget_totals: {
            count: 1, with_limit: 1, spent: 100, limited: 400, limited_spent: 100,
            over_count: 0, unbudgeted: 1175,
        },
        categories: [
            { name: 'Housing', amount: 900, pct: 70.6, count: 1, prev_amount: 400 },
            { name: 'Fun', amount: 25, pct: 2, count: 1, prev_amount: 0 },
        ],
        daily: { dates: [`${year}-${mm}-01`], earned: [0], spent: [0], cumulative_spent: [0] },
        trend_12m: { labels: [], earned: [], spent: [] },
        top_expenses: [
            { date: `${year}-${mm}-02`, description: 'Rent', category: 'Housing',
              budget: 'Rent', amount: 900, account: 'Landlord', source: 'Checking' },
        ],
        warnings: [],
        ...overrides,
    };
}

async function runPage({ url = 'http://localhost/summary', respond } = {}) {
    const htmlSrc = readFileSync(path.resolve(root, 'static/summary.html'), 'utf8');
    const utilsSrc = readFileSync(path.resolve(root, 'static/summary-utils.js'), 'utf8');
    const pageHtml = htmlSrc.replace(
        /<script src="\/static\/summary-utils\.js(\?v=\d+)?"><\/script>/,
        `<script>${utilsSrc}</script>`
    );
    const dom = new JSDOM(pageHtml, {
        url, runScripts: 'dangerously', virtualConsole: new VirtualConsole(),
    });
    const win = dom.window;
    const calls = [];
    win.fetch = (u, opts) => {
        const s = String(u);
        calls.push({ url: s, method: (opts && opts.method) || 'GET' });
        if (s.includes('/api/accounts')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (s.includes('/api/refresh')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        const q = new URL(s, 'http://localhost').searchParams;
        const y = Number(q.get('year'));
        const m = Number(q.get('month'));
        const body = respond ? respond(y, m) : summaryFor(y, m);
        return Promise.resolve(body).then((b) => ({ ok: true, json: () => Promise.resolve(b) }));
    };
    const toasts = [];
    win.OxiUI = {
        formatCurrency: (v) => String(Math.round(v * 100) / 100),
        getChartColors: () => ({}),
        spinnerHtml: () => '',
        toast: (msg, type) => toasts.push({ msg, type }),
    };
    win.Chart = class { constructor() { this.options = {}; } destroy() {} };
    await new Promise((r) => setTimeout(r, 30));
    return { win, doc: win.document, calls, toasts };
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const summaryCalls = (calls) => calls.filter((c) => c.url.includes('/api/summary/month'));

describe('summary page rendering', () => {
    it('labels a completed month comparison as "last month"', async () => {
        const { doc } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        const kpis = doc.getElementById('kpi-grid').textContent;
        expect(kpis).toContain('2500 last month');
        expect(kpis).toContain('Saved');
        expect(kpis).not.toContain('Saved so far');
        expect(kpis).toContain('since end of February');
    });

    it('labels the current month comparison as the same days of last month', async () => {
        const { doc } = await runPage({
            respond: (y, m) => summaryFor(y, m, {
                is_current_month: true,
                totals: {
                    ...summaryFor(y, m).totals,
                    days_elapsed: 12, comparison_days: 12, projected_spent: 2975,
                },
            }),
        });
        const kpis = doc.getElementById('kpi-grid').textContent;
        expect(kpis).toContain('in first 12 days of last month');
        expect(kpis).toContain('On pace for 2975 by month end');
        expect(kpis).toContain('Saved so far');
        // Budgets show what is left per remaining day (28 - 12 + 1 = 17 days).
        const budgets = doc.getElementById('budget-list').textContent;
        expect(budgets).toContain('300 left (17.65/day)');
    });

    it('shows unbudgeted spend next to the budget totals', async () => {
        const { doc } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        expect(doc.getElementById('budget-summary').textContent).toContain('1175 unbudgeted');
    });

    it('shows each category change vs last month', async () => {
        const { doc } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        const cats = doc.getElementById('category-list');
        expect(cats.textContent).toContain('▲ 125%');
        expect(cats.textContent).toContain('new');
        expect(cats.querySelector('.cat-name').getAttribute('title')).toBe('1 transaction');
    });

    it('shows the accounts and budget of the largest expenses', async () => {
        const { doc } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        const text = doc.getElementById('top-expenses').textContent;
        expect(text).toContain('Checking → Landlord');
        expect(text).toContain('Rent');
    });

    it('renders older responses without the new fields', async () => {
        const { doc } = await runPage({
            respond: (y, m) => {
                const s = summaryFor(y, m);
                delete s.totals.prev_period_spent;
                delete s.budget_totals.unbudgeted;
                s.categories = s.categories.map(({ name, amount, pct }) => ({ name, amount, pct }));
                return s;
            },
        });
        expect(doc.getElementById('summary-content').style.display).toBe('block');
        expect(doc.getElementById('kpi-grid').textContent).toContain('2500 last month');
        expect(doc.getElementById('budget-summary').textContent).not.toContain('unbudgeted');
    });
});

describe('summary page navigation', () => {
    it('opens the month from the ?month= URL parameter', async () => {
        const { calls, doc } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        expect(summaryCalls(calls)[0].url).toContain('year=2024&month=3');
        expect(doc.getElementById('month-picker').value).toBe('2024-03');
    });

    it('ignores an invalid or future ?month= parameter', async () => {
        const { calls } = await runPage({ url: 'http://localhost/summary?month=2999-01' });
        const now = new Date();
        expect(summaryCalls(calls)[0].url)
            .toContain(`year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
    });

    it('keeps the selected month in the URL', async () => {
        const { win, doc } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        doc.getElementById('prev-month').click();
        await settle();
        expect(win.location.search).toBe('?month=2024-02');
        doc.getElementById('this-month').click();
        await settle();
        expect(win.location.search).toBe('');
    });

    it('steps months with the arrow keys, but not while typing', async () => {
        const { win, doc, calls } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        await settle();
        expect(summaryCalls(calls).pop().url).toContain('year=2024&month=2');
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await settle();
        expect(summaryCalls(calls).pop().url).toContain('year=2024&month=3');

        const before = summaryCalls(calls).length;
        const search = doc.getElementById('account-filter-search');
        search.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        await settle();
        expect(summaryCalls(calls).length).toBe(before);
    });

    it('Refresh clears the server cache and reloads the month', async () => {
        const { doc, calls, toasts } = await runPage({ url: 'http://localhost/summary?month=2024-03' });
        doc.getElementById('summary-refresh').click();
        await settle();
        const refresh = calls.find((c) => c.url.includes('/api/refresh'));
        expect(refresh && refresh.method).toBe('POST');
        expect(summaryCalls(calls).length).toBe(2);
        expect(toasts[0].type).toBe('success');
    });

    it('discards a slow response that a newer month request superseded', async () => {
        let releaseSlow;
        const slow = new Promise((r) => { releaseSlow = r; });
        const { doc } = await runPage({
            url: 'http://localhost/summary?month=2024-03',
            respond: (y, m) => {
                if (m === 2) return slow.then(() => summaryFor(y, m, { totals: { ...summaryFor(y, m).totals, earned: 222 } }));
                return summaryFor(y, m, { totals: { ...summaryFor(y, m).totals, earned: m === 1 ? 111 : 3000 } });
            },
        });
        doc.getElementById('prev-month').click(); // Feb (slow)
        doc.getElementById('prev-month').click(); // Jan (fast)
        await settle();
        releaseSlow();
        await settle();
        expect(doc.getElementById('month-picker').value).toBe('2024-01');
        const kpis = doc.getElementById('kpi-grid').textContent;
        expect(kpis).toContain('111');
        expect(kpis).not.toContain('222');
    });
});
