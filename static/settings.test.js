// @vitest-environment jsdom
/**
 * Tests for the /settings page toggle switches.
 *
 * Regression guard: the switch is a zero-visual <input type="checkbox">
 * overlaid on a decorative .slider span. The input must cover the whole
 * switch area (position:absolute; inset:0; z-index above the slider) with
 * a non-zero size — a `width: 0; height: 0` input has no clickable area,
 * so only the text label on the left could toggle it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const html = readFileSync(path.resolve(process.cwd(), 'static/settings.html'), 'utf8');
const css = readFileSync(path.resolve(process.cwd(), 'static/style.css'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

/** Return the body of the first CSS rule whose selector matches exactly. */
function cssRule(selector) {
    const idx = css.indexOf(selector + ' {');
    if (idx === -1) return null;
    const start = css.indexOf('{', idx);
    return css.slice(start + 1, css.indexOf('}', start));
}

describe('settings page switch markup', () => {
    it('renders one switch per feature toggle, input before slider', () => {
        const ids = [
            'monthly-summary-toggle',
            'sankey-toggle',
            'reimbursements-toggle',
            'budget-comparison-toggle',
            'avg-cost-toggle',
            'labels-toggle',
            'auto-fetch-toggle',
        ];

        const switches = doc.querySelectorAll('.switch');
        expect(switches.length).toBe(ids.length);

        for (const id of ids) {
            const input = doc.getElementById(id);
            expect(input, `${id} must exist`).not.toBeNull();
            expect(input.getAttribute('type')).toBe('checkbox');

            // The text label on the left must target the input.
            const label = doc.querySelector(`label[for="${id}"]`);
            expect(label, `label[for=${id}] must exist`).not.toBeNull();

            // The input must be the first child of .switch and immediately
            // precede .slider: the "input:checked + .slider" selectors rely
            // on that adjacency.
            const sw = input.closest('.switch');
            expect(sw, `${id} must live inside a .switch`).not.toBeNull();
            expect(sw.children[0]).toBe(input);
            expect(input.nextElementSibling).toBe(sw.querySelector('.slider'));
        }
    });

    it('makes the hidden input cover the whole switch so it is clickable', () => {
        const swRule = cssRule('.switch');
        expect(swRule, '.switch rule must exist').not.toBeNull();
        expect(swRule).toContain('position: relative');

        const rule = cssRule('.switch input');
        expect(rule, '.switch input rule must exist').not.toBeNull();
        expect(rule).toContain('position: absolute');
        expect(rule).toContain('inset: 0');
        expect(rule).toContain('z-index: 1');
        expect(rule).toContain('opacity: 0');
        expect(rule).toContain('cursor: pointer');
        // A zero-size input is not hit-testable: that is the bug this
        // guards against (only the label text could toggle the switch).
        expect(rule).not.toMatch(/width:\s*0/);
        expect(rule).not.toMatch(/height:\s*0/);
    });

    it('PATCHes the API key for every toggle it renders', () => {
        const keys = [
            'monthly_summary_enabled',
            'sankey_enabled',
            'reimbursements_enabled',
            'budget_comparison_enabled',
            'avg_cost_enabled',
            'labels_enabled',
            'firefly_url',
            'firefly_token',
            'account_types',
            'auto_fetch_accounts',
            'cache_ttl',
            'time_ranges',
            'default_time_range',
        ];
        const script = [...doc.querySelectorAll('script')]
            .map((s) => s.textContent)
            .join('\n');
        for (const key of keys) {
            expect(script, `inline script must reference ${key}`).toContain(key);
        }
        // The test-connection button must hit the dedicated endpoint.
        expect(script).toContain('/api/settings/test-firefly');
    });

    it('renders the env-moved settings as form fields', () => {
        // Firefly connection (FIREFLY_III_URL / FIREFLY_III_ACCESS_TOKEN)
        const url = doc.getElementById('firefly-url');
        expect(url, '#firefly-url must exist').not.toBeNull();
        expect(url.getAttribute('type')).toBe('text');
        const token = doc.getElementById('firefly-token');
        expect(token, '#firefly-token must exist').not.toBeNull();
        expect(token.getAttribute('type')).toBe('password');
        expect(doc.getElementById('firefly-test'), '#firefly-test must exist').not.toBeNull();

        // Accounts (ACCOUNT_TYPES checkbox group + AUTO_FETCH_ACCOUNTS switch)
        expect(
            doc.getElementById('account-type-checks'),
            '#account-type-checks must exist',
        ).not.toBeNull();
        const autoFetch = doc.getElementById('auto-fetch-toggle');
        expect(autoFetch, '#auto-fetch-toggle must exist').not.toBeNull();

        // Caching (CACHE_TTL)
        const ttl = doc.getElementById('cache-ttl');
        expect(ttl, '#cache-ttl must exist').not.toBeNull();
        expect(ttl.getAttribute('type')).toBe('number');

        // Time ranges (TIME_RANGES / DEFAULT_TIME_RANGE)
        const ranges = doc.getElementById('time-ranges');
        expect(ranges, '#time-ranges must exist').not.toBeNull();
        const defRange = doc.getElementById('default-time-range');
        expect(defRange, '#default-time-range must exist').not.toBeNull();
        expect(defRange.tagName).toBe('SELECT');

        // Server facts are shown read-only (HOST/PORT, DATA_DIR, RUST_LOG)
        expect(doc.getElementById('server-host'), '#server-host must exist').not.toBeNull();
        expect(doc.getElementById('server-datadir'), '#server-datadir must exist').not.toBeNull();
        expect(doc.getElementById('server-loglevel'), '#server-loglevel must exist').not.toBeNull();
    });
});
