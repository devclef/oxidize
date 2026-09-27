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
        ];
        const script = [...doc.querySelectorAll('script')]
            .map((s) => s.textContent)
            .join('\n');
        for (const key of keys) {
            expect(script, `inline script must reference ${key}`).toContain(key);
        }
    });
});
