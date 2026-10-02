// @vitest-environment jsdom
/**
 * Tests for static/labels-utils.js: the pure helpers used by the
 * Spending Labels page (/labels).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.resolve(process.cwd(), 'static/labels-utils.js'), 'utf8');

beforeEach(() => {
    (0, eval)(source);
});

describe('entryForSelection', () => {
    it('returns the parent name for the whole category', () => {
        expect(window.Labels.entryForSelection('Dining', 'all')).toBe('Dining');
        expect(window.Labels.entryForSelection('Dining', '')).toBe('Dining');
    });

    it('returns the full Parent:Sub name for one subcategory', () => {
        expect(window.Labels.entryForSelection('Dining', 'Bars')).toBe('Dining:Bars');
    });

    it('ignores surrounding whitespace', () => {
        expect(window.Labels.entryForSelection('  Dining  ', '  Bars ')).toBe('Dining:Bars');
    });

    it('returns empty string without a parent', () => {
        expect(window.Labels.entryForSelection('', 'Bars')).toBe('');
    });
});

describe('periodRange', () => {
    it('resolves this-month from the 1st to today', () => {
        const r = window.Labels.periodRange('this-month');
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        expect(r.start).toBe(window.Labels.ymd(y, m, 1));
        expect(r.end).toBe(window.Labels.ymd(y, m, now.getDate()));
    });

    it('resolves last-month to the full previous calendar month', () => {
        const r = window.Labels.periodRange('last-month');
        const now = new Date();
        const prev = window.Labels.shiftMonth(now.getFullYear(), now.getMonth() + 1, -1);
        expect(r.start).toBe(window.Labels.monthStart(prev.year, prev.month));
        expect(r.end).toBe(window.Labels.monthEnd(prev.year, prev.month));
    });

    it('resolves ytd from January 1st to today', () => {
        const r = window.Labels.periodRange('ytd');
        const now = new Date();
        expect(r.start).toBe('' + now.getFullYear() + '-01-01');
        expect(r.end).toBe(window.Labels.today());
    });

    it('starts trailing ranges at the first of the shifted month', () => {
        const r = window.Labels.periodRange('last-3m');
        expect(r.start.endsWith('-01')).toBe(true);
        expect(r.end).toBe(window.Labels.today());
    });

    it('returns null for unknown ids', () => {
        expect(window.Labels.periodRange('nonsense')).toBeNull();
    });
});

describe('shiftMonth', () => {
    it('wraps across year boundaries', () => {
        expect(window.Labels.shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
        expect(window.Labels.shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
        // 30 months before Sep 2026 is Mar 2024 (12+12+6).
        expect(window.Labels.shiftMonth(2026, 9, -30)).toEqual({ year: 2024, month: 3 });
    });
});

describe('donutData', () => {
    it('maps parts to labels/values/colors', () => {
        const parts = [
            { label: 'wants', color: '#f59e0b', amount: 400, pct: 32.4 },
            { label: 'needs', color: '#22c55e', amount: 600, pct: 48.6 }
        ];
        const d = window.Labels.donutData(parts, 1200);
        expect(d.labels).toEqual(['wants', 'needs']);
        expect(d.values).toEqual([400, 600]);
        expect(d.colors).toEqual(['#f59e0b', '#22c55e']);
        expect(d.total).toBe(1200);
    });

    it('uses gray for the Unlabeled part', () => {
        const d = window.Labels.donutData([{ label: 'Unlabeled', color: null, amount: 10, pct: 5 }], 200);
        expect(d.colors).toEqual([window.Labels.UNLABELED_COLOR]);
    });

    it('drops zero-amount parts', () => {
        const d = window.Labels.donutData([{ label: 'wants', color: null, amount: 0, pct: 0 }], 0);
        expect(d.labels).toEqual([]);
        expect(d.values).toEqual([]);
    });
});

describe('formatPeriodKey', () => {
    it('shows month-grained buckets (key on the last day) as YYYY-MM', () => {
        expect(window.Labels.formatPeriodKey('2026-01-31T00:00:00+00:00')).toBe('2026-01');
        expect(window.Labels.formatPeriodKey('2026-02-28T00:00:00+00:00')).toBe('2026-02');
        expect(window.Labels.formatPeriodKey('2026-12-31T00:00:00+00:00')).toBe('2026-12');
    });

    it('shows finer buckets as YYYY-MM-DD', () => {
        expect(window.Labels.formatPeriodKey('2026-01-15T00:00:00+00:00')).toBe('2026-01-15');
    });

    it('passes through unparseable keys', () => {
        expect(window.Labels.formatPeriodKey('weird')).toBe('weird');
        expect(window.Labels.formatPeriodKey('')).toBe('');
    });
});

describe('trendToChartJs', () => {
    it('aligns datasets to the sorted union of period keys', () => {
        const chartLine = [
            { label: 'wants', entries: { '2026-08': 10, '2026-10': 30 } },
            { label: 'needs', entries: { '2026-09': 20 } }
        ];
        const r = window.Labels.trendToChartJs(chartLine);
        expect(r.labels).toEqual(['2026-08', '2026-09', '2026-10']);
        expect(r.datasets[0].data).toEqual([10, null, 30]);
        expect(r.datasets[1].data).toEqual([null, 20, null]);
    });

    it('formats month-end bucket keys for the axis', () => {
        const chartLine = [
            { label: 'wants', entries: { '2026-01-31T00:00:00+00:00': 10, '2026-02-28T00:00:00+00:00': 30 } },
            { label: 'needs', entries: { '2026-02-28T00:00:00+00:00': 20 } }
        ];
        const r = window.Labels.trendToChartJs(chartLine);
        expect(r.labels).toEqual(['2026-01', '2026-02']);
        expect(r.datasets[0].data).toEqual([10, 30]);
        expect(r.datasets[1].data).toEqual([null, 20]);
    });

    it('handles empty input', () => {
        const r = window.Labels.trendToChartJs([]);
        expect(r.labels).toEqual([]);
        expect(r.datasets).toEqual([]);
    });
});

describe('formatAmount', () => {
    it('prepends the currency symbol when present', () => {
        expect(window.Labels.formatAmount(1234.5, '$')).toBe('$1,234.50');
    });

    it('renders missing amounts as an em dash', () => {
        expect(window.Labels.formatAmount(null)).toBe('—');
        expect(window.Labels.formatAmount(undefined, '$')).toBe('—');
    });
});

describe('entryMatches', () => {
    it('matches exact names', () => {
        expect(window.Labels.entryMatches('Groceries', 'Groceries')).toBe(true);
        expect(window.Labels.entryMatches('Dining:Bars', 'Dining:Bars')).toBe(true);
    });

    it('matches a parent entry against all of its subcategories', () => {
        expect(window.Labels.entryMatches('Dining', 'Dining:Bars')).toBe(true);
        expect(window.Labels.entryMatches('Dining', 'Dining:Takeout')).toBe(true);
    });

    it('does not match sibling prefixes or longer names', () => {
        expect(window.Labels.entryMatches('Dining', 'DiningRoom')).toBe(false);
        expect(window.Labels.entryMatches('Dining:Bars', 'Dining:Bars&Grill')).toBe(false);
        expect(window.Labels.entryMatches('Dining:Bars', 'Dining')).toBe(false);
    });

    it('rejects empty values', () => {
        expect(window.Labels.entryMatches('', 'Dining')).toBe(false);
        expect(window.Labels.entryMatches('Dining', '')).toBe(false);
        expect(window.Labels.entryMatches(null, 'Dining')).toBe(false);
    });
});

describe('coverageOf', () => {
    it('reports exact coverage', () => {
        const cov = window.Labels.coverageOf(['Dining:Bars', 'Toys'], 'Dining:Bars');
        expect(cov).toEqual({ exact: true, whole: null });
    });

    it('reports whole-category coverage', () => {
        const cov = window.Labels.coverageOf(['Dining', 'Toys'], 'Dining:Bars');
        expect(cov).toEqual({ exact: false, whole: 'Dining' });
    });

    it('reports both when both entries exist', () => {
        const cov = window.Labels.coverageOf(['Dining', 'Dining:Bars'], 'Dining:Bars');
        expect(cov).toEqual({ exact: true, whole: 'Dining' });
    });

    it('reports no coverage', () => {
        const cov = window.Labels.coverageOf(['Dining:Bars'], 'Dining:Takeout');
        expect(cov).toEqual({ exact: false, whole: null });
    });
});

describe('addCategoryToEntries', () => {
    it('adds the most specific entry when the category is uncovered', () => {
        const r = window.Labels.addCategoryToEntries(['Groceries'], 'Dining:Bars');
        expect(r).toEqual({ entries: ['Groceries', 'Dining:Bars'], changed: true });
    });

    it('is a no-op when covered exactly', () => {
        const r = window.Labels.addCategoryToEntries(['Dining:Bars'], 'Dining:Bars');
        expect(r.changed).toBe(false);
        expect(r.entries).toEqual(['Dining:Bars']);
    });

    it('is a no-op when covered by a whole-category entry', () => {
        const r = window.Labels.addCategoryToEntries(['Dining'], 'Dining:Bars');
        expect(r.changed).toBe(false);
        expect(r.entries).toEqual(['Dining']);
    });

    it('does not mutate the input', () => {
        const input = ['Groceries'];
        window.Labels.addCategoryToEntries(input, 'Dining');
        expect(input).toEqual(['Groceries']);
    });
});

describe('removeCategoryFromEntries', () => {
    const diningSubs = ['Bars', 'Takeout', 'Restaurants'];
    const subsOf = (parent) =>
        parent === 'Dining' ? diningSubs
        : parent === 'Gym' ? ['Other']
        : null;

    it('removes the exact entry', () => {
        const r = window.Labels.removeCategoryFromEntries(
            ['Dining:Bars', 'Toys'], 'Dining:Bars', subsOf);
        expect(r.entries).toEqual(['Toys']);
        expect(r.split).toBeNull();
    });

    it('returns not-covered when nothing covers the category', () => {
        const r = window.Labels.removeCategoryFromEntries(['Toys'], 'Dining:Bars', subsOf);
        expect(r).toEqual({ error: 'not-covered' });
    });

    it('splits a whole-category entry into its other subcategories', () => {
        const r = window.Labels.removeCategoryFromEntries(
            ['Dining', 'Toys'], 'Dining:Bars', subsOf);
        expect(r.entries).toEqual(['Dining:Takeout', 'Dining:Restaurants', 'Toys']);
        expect(r.split).toEqual({ entry: 'Dining', siblings: ['Takeout', 'Restaurants'] });
    });

    it('removes the whole-category entry when the sub is its only one', () => {
        const r = window.Labels.removeCategoryFromEntries(
            ['Gym', 'Toys'], 'Gym:Other', subsOf);
        expect(r.entries).toEqual(['Toys']);
        expect(r.split).toEqual({ entry: 'Gym', siblings: [] });
    });

    it('still drops the category when the sub is missing from the sub list', () => {
        // Firefly list lacks the sub: replacing "Dining" with all listed
        // subs no longer covers "Dining:New".
        const r = window.Labels.removeCategoryFromEntries(
            ['Dining'], 'Dining:New', subsOf);
        expect(r.entries).toEqual(['Dining:Bars', 'Dining:Takeout', 'Dining:Restaurants']);
    });

    it('fails with cannot-split when the sub list is unknown', () => {
        const r = window.Labels.removeCategoryFromEntries(
            ['Mystery'], 'Mystery:Bars', subsOf);
        expect(r).toEqual({ error: 'cannot-split', entry: 'Mystery' });
    });

    it('removes the exact entry and splits the whole entry when both exist', () => {
        const r = window.Labels.removeCategoryFromEntries(
            ['Dining', 'Dining:Bars'], 'Dining:Bars', subsOf);
        expect(r.entries).toEqual(['Dining:Takeout', 'Dining:Restaurants']);
        expect(r.split).toEqual({ entry: 'Dining', siblings: ['Takeout', 'Restaurants'] });
    });

    it('deduplicates when a sibling is already an entry', () => {
        const r = window.Labels.removeCategoryFromEntries(
            ['Dining', 'Dining:Takeout'], 'Dining:Bars', subsOf);
        expect(r.entries).toEqual(['Dining:Takeout', 'Dining:Restaurants']);
    });

    it('leaves top-level categories with only an exact-entry removal', () => {
        const r = window.Labels.removeCategoryFromEntries(
            ['Groceries', 'Toys'], 'Groceries', subsOf);
        expect(r.entries).toEqual(['Toys']);
        expect(r.split).toBeNull();
    });
});

describe('labels page: per-category label editor wiring', () => {
    const html = readFileSync(path.resolve(process.cwd(), 'static/labels.html'), 'utf8');

    it('makes breakdown rows clickable and opens the editor', () => {
        expect(html).toContain('openCategoryEditor(c)');
        expect(html).toContain('tr.className = \'cat-row\'');
        expect(html).toContain('tr.setAttribute(\'role\', \'button\')');
    });

    it('has the editor dialog with checklist, create row and apply', () => {
        expect(html).toContain('id="cat-editor-overlay"');
        expect(html).toContain('id="cat-editor-list"');
        expect(html).toContain('id="cat-editor-new-name"');
        expect(html).toContain('id="cat-editor-new-btn"');
        expect(html).toContain('id="cat-editor-apply"');
    });

    it('drives assignment changes through the pure entry helpers', () => {
        expect(html).toContain('L.coverageOf(');
        expect(html).toContain('L.addCategoryToEntries(');
        expect(html).toContain('L.removeCategoryFromEntries(');
    });

    it('keeps the labels-utils.js script tag version in sync with REVISION', () => {
        const m = html.match(/labels-utils\.js\?v=([\d.\-]+)/);
        expect(m).not.toBeNull();
        expect(m[1]).toBe(window.Labels.REVISION);
    });
});
