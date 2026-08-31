// @vitest-environment jsdom
/**
 * Accounts section collapse persistence - the Graph Builder must remember
 * whether the user collapsed the accounts list: if they left it collapsed,
 * the next visit starts with it collapsed as well.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appSource = readFileSync(path.resolve(root, 'static/app.js'), 'utf8');
const indexHtml = readFileSync(path.resolve(root, 'static/index.html'), 'utf8');

describe('Accounts section collapse persistence', () => {
    it('uses a dedicated oxidize_* localStorage key', () => {
        expect(appSource).toMatch(/ACCOUNTS_COLLAPSED_KEY\s*=\s*'oxidize_accounts_collapsed'/);
    });

    it('saves the state on every toggle (collapsed -> "true", expanded -> "false")', () => {
        const start = appSource.indexOf('function toggleAccountsSection(');
        expect(start).toBeGreaterThan(-1);
        const end = appSource.indexOf('\n}', start);
        const fn = appSource.slice(start, end);

        // collapsed branch
        const collapsedBranch = fn.split(/\}/)[1] ?? '';
        expect(fn).toContain("localStorage.setItem(ACCOUNTS_COLLAPSED_KEY, 'true')");
        expect(fn).toContain("localStorage.setItem(ACCOUNTS_COLLAPSED_KEY, 'false')");
        expect(fn).toMatch(/content\.style\.display = 'none';[\s\S]*ACCOUNTS_COLLAPSED_KEY, 'true'/);
        expect(fn).toMatch(/content\.style\.display = 'block';[\s\S]*ACCOUNTS_COLLAPSED_KEY, 'false'/);
    });

    it('restores a collapsed section on page load', () => {
        const restoreStart = appSource.indexOf('localStorage.getItem(ACCOUNTS_COLLAPSED_KEY)');
        expect(restoreStart).toBeGreaterThan(-1);
        const restoreBlock = appSource.slice(restoreStart, restoreStart + 600);
        expect(restoreBlock).toMatch(/===\s*'true'/);
        expect(restoreBlock).toContain("getElementById('accounts-content')");
        expect(restoreBlock).toMatch(/style\.display = 'none'/);
        expect(restoreBlock).toContain("'Expand'");
        expect(restoreBlock).toContain("aria-expanded', 'false'");
    });

    it('has the toggle button and content container in the markup', () => {
        expect(indexHtml).toContain('id="toggle-accounts-btn"');
        expect(indexHtml).toContain('id="accounts-content"');
    });
});
