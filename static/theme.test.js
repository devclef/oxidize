// @vitest-environment jsdom
/**
 * Tests for static/theme.js: dark/light toggle persistence and PWA
 * theme-color meta sync.
 *
 * theme.js is a classic script (top-level functions plus an initTheme()
 * that runs at load time), not an ES module, so we evaluate the actual
 * shipped file here the same way ui.test.js does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const themeSource = readFileSync(path.resolve(process.cwd(), 'static/theme.js'), 'utf8');

function mockMatchMedia(matches) {
    window.matchMedia = vi.fn(() => ({
        matches,
        addEventListener() {},
        removeEventListener() {},
    }));
}

// The jsdom environment here does not surface a usable localStorage
// (Node's own disabled webstorage global shadows it), so install a
// minimal in-memory Storage for theme.js to use.
function installMemoryStorage() {
    const store = new Map();
    const storage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(String(k), String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
    };
    for (const target of [window, globalThis]) {
        Object.defineProperty(target, 'localStorage', {
            value: storage,
            configurable: true,
            writable: true,
        });
    }
    return storage;
}

let storage;

beforeEach(() => {
    storage = installMemoryStorage();
    mockMatchMedia(false);

    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '<meta name="theme-color" content="#3b82f6">';
    document.body.innerHTML = `
        <button id="theme-toggle"></button>
        <span id="theme-icon-sun"></span>
        <span id="theme-icon-moon"></span>
    `;

    // Runs initTheme() against the current DOM / localStorage state.
    (0, eval)(themeSource);
});

function metaColor() {
    return document.querySelector('meta[name="theme-color"]').getAttribute('content');
}

describe('theme init', () => {
    it('defaults to light and syncs the theme-color meta', () => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(metaColor()).toBe('#3b82f6');
    });

    it('uses the saved theme from localStorage', () => {
        storage.setItem('oxidize_theme', 'dark');
        (0, eval)(themeSource);
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(metaColor()).toBe('#1e1b4b');
    });

    it('falls back to prefers-color-scheme when nothing is saved', () => {
        mockMatchMedia(true);
        (0, eval)(themeSource);
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(metaColor()).toBe('#1e1b4b');
    });
});

describe('theme toggle', () => {
    it('switches to dark and updates the theme-color meta', () => {
        document.querySelector('#theme-toggle').click();
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(metaColor()).toBe('#1e1b4b');
        expect(storage.getItem('oxidize_theme')).toBe('dark');
    });

    it('switches back to light and restores the light chrome color', () => {
        document.querySelector('#theme-toggle').click();
        document.querySelector('#theme-toggle').click();
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(metaColor()).toBe('#3b82f6');
    });

    it('dispatches themeChanged with the new theme', () => {
        const seen = [];
        window.addEventListener('themeChanged', (e) => seen.push(e.detail));
        document.querySelector('#theme-toggle').click();
        document.querySelector('#theme-toggle').click();
        expect(seen).toEqual(['dark', 'light']);
    });

    it('flips the sun/moon icons', () => {
        const sun = document.querySelector('#theme-icon-sun');
        const moon = document.querySelector('#theme-icon-moon');
        expect(sun.style.display).toBe('block');
        expect(moon.style.display).toBe('none');
        document.querySelector('#theme-toggle').click();
        expect(sun.style.display).toBe('none');
        expect(moon.style.display).toBe('block');
    });
});
