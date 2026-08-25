// @vitest-environment jsdom
/**
 * #24 stacking option - regression tests for placement and update policy.
 *
 * The Stacked toggle must be visible in the Graph Builder's primary Style
 * controls (not buried in the collapsed "Advanced options"), and the
 * service worker must activate new versions immediately so deployed
 * changes actually reach the browser on the next page load.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const indexHtml = readFileSync(path.resolve(root, 'static/index.html'), 'utf8');
const swSource = readFileSync(path.resolve(root, 'static/sw.js'), 'utf8');

describe('Graph Builder stacked toggle placement (#24)', () => {
    it('renders exactly one #stacked-toggle', () => {
        expect((indexHtml.match(/id="stacked-toggle"/g) || []).length).toBe(1);
    });

    it('sits in the primary Style controls, before the Update Graph button', () => {
        const toggleIdx = indexHtml.indexOf('id="stacked-toggle"');
        const styleIdx = indexHtml.indexOf('id="chart-type-selector"');
        const btnIdx = indexHtml.indexOf('id="update-chart-btn"');
        expect(toggleIdx).toBeGreaterThan(-1);
        expect(toggleIdx).toBeGreaterThan(styleIdx);
        expect(toggleIdx).toBeLessThan(btnIdx);
    });

    it('is not hidden inside the collapsed advanced options block', () => {
        const toggleIdx = indexHtml.indexOf('id="stacked-toggle"');
        const advIdx = indexHtml.indexOf('id="advanced-options"');
        expect(toggleIdx).toBeGreaterThanOrEqual(0);
        expect(toggleIdx).toBeLessThan(advIdx);
    });
});

describe('service worker update policy (#24)', () => {
    it('skips waiting so a new cache activates immediately on next load', () => {
        expect(swSource).toMatch(/self\.skipWaiting\(\)/);
    });

    it('claims clients and keeps precaching the app scripts', () => {
        expect(swSource).toContain('clients.claim()');
        for (const asset of ['/static/ui.js', '/static/app.js', '/static/dashboard.js']) {
            expect(swSource).toContain(asset);
        }
    });
});
