/**
 * Pure helpers for the Monthly Summary page (/summary).
 *
 *  - MonthSummary.currentYearMonth()  {year, month} of the local calendar month
 *  - MonthSummary.shiftMonth(y, m, d) {year, month} shifted by d months
 *  - MonthSummary.monthKey(y, m)      "YYYY-MM"
 *  - MonthSummary.monthLabel(y, m)    "September 2026"
 *  - MonthSummary.shortMonthLabel(ym) "2026-09" -> "Sep"
 *  - MonthSummary.daysInMonth(y, m)   28-31
 *  - MonthSummary.pctDelta(cur, prev) (cur-prev)/prev*100, null when undefined
 *  - MonthSummary.isFuture(y, m)      true when strictly after the current month
 *  - MonthSummary.buildAccountFilterParams(mode, ids)  URL params for the
 *    account filter (accounts[] include / exclude_accounts[] exclude)
 *  - MonthSummary.parseAccountFilter(stored)  normalize a persisted filter
 *  - MonthSummary.describeAccountFilter(mode, count)  badge text
 *
 * Account filter: { mode: 'all' | 'include' | 'exclude', ids: string[] },
 * persisted under MonthSummary.ACCOUNT_FILTER_KEY in localStorage.
 */
(function () {
    'use strict';

    var MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    function currentYearMonth() {
        var now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }

    function shiftMonth(year, month, delta) {
        var total = year * 12 + (month - 1) + delta;
        return {
            year: Math.floor(total / 12),
            month: ((total % 12) + 12) % 12 + 1
        };
    }

    function monthKey(year, month) {
        return year + '-' + String(month).padStart(2, '0');
    }

    function monthLabel(year, month) {
        return MONTH_NAMES[month - 1] + ' ' + year;
    }

    // "2026-09" -> "Sep"
    function shortMonthLabel(ym) {
        var parts = String(ym).split('-');
        var m = parseInt(parts[1], 10);
        if (parts.length < 2 || !isFinite(m) || m < 1 || m > 12) return String(ym);
        return MONTH_NAMES[m - 1].slice(0, 3);
    }

    function daysInMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    // Percentage change; null when previous is null/0 (undefined change).
    function pctDelta(current, previous) {
        if (previous == null || previous === 0) return null;
        return (current - previous) / previous * 100;
    }

    // True when (year, month) is strictly after the current local month.
    function isFuture(year, month) {
        var cur = currentYearMonth();
        return year > cur.year || (year === cur.year && month > cur.month);
    }

    // localStorage key for the persisted account filter.
    var ACCOUNT_FILTER_KEY = 'oxidize_summary_account_filter';

    // Normalize a list of account ids: keep non-empty, trimmed, stringified,
    // de-duplicated ids in order of first appearance.
    function normalizeIds(ids) {
        if (!Array.isArray(ids)) return [];
        var seen = {};
        var out = [];
        for (var i = 0; i < ids.length; i++) {
            var raw = ids[i];
            if (raw == null) continue;
            var id = String(raw).trim();
            if (!id || seen[id]) continue;
            seen[id] = true;
            out.push(id);
        }
        return out;
    }

    // URL query params for the account filter. 'all' (or no selection)
    // produces no params.
    function buildAccountFilterParams(mode, ids) {
        var normalized = normalizeIds(ids);
        if (normalized.length === 0) return [];
        if (mode !== 'include' && mode !== 'exclude') return [];
        var key = mode === 'include' ? 'accounts[]' : 'exclude_accounts[]';
        return normalized.map(function (id) { return [key, id]; });
    }

    // Normalize persisted filter data (localStorage JSON). Anything missing
    // or malformed falls back to { mode: 'all', ids: [] }.
    function parseAccountFilter(stored) {
        var fallback = { mode: 'all', ids: [] };
        if (typeof stored === 'string') {
            try {
                stored = JSON.parse(stored);
            } catch (e) {
                return fallback;
            }
        }
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
            return fallback;
        }
        if (stored.mode !== 'include' && stored.mode !== 'exclude') {
            return fallback;
        }
        var ids = normalizeIds(stored.ids);
        if (ids.length === 0) return fallback;
        return { mode: stored.mode, ids: ids };
    }

    // Human-readable badge text for the active filter ('' when none).
    function describeAccountFilter(mode, count) {
        var n = parseInt(count, 10);
        if (!isFinite(n) || n <= 0) n = 0;
        var word = n === 1 ? 'account' : 'accounts';
        if (mode === 'include') return n + ' ' + word + ' included';
        if (mode === 'exclude') return n + ' ' + word + ' excluded';
        return '';
    }

    // Escape text for safe interpolation into innerHTML.
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    window.MonthSummary = {
        ACCOUNT_FILTER_KEY: ACCOUNT_FILTER_KEY,
        currentYearMonth: currentYearMonth,
        shiftMonth: shiftMonth,
        monthKey: monthKey,
        monthLabel: monthLabel,
        shortMonthLabel: shortMonthLabel,
        daysInMonth: daysInMonth,
        pctDelta: pctDelta,
        isFuture: isFuture,
        buildAccountFilterParams: buildAccountFilterParams,
        parseAccountFilter: parseAccountFilter,
        describeAccountFilter: describeAccountFilter,
        escapeHtml: escapeHtml
    };
})();
