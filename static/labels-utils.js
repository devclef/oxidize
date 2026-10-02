/**
 * Pure helpers for the Spending Labels page (/labels).
 *
 *  - Labels.currentYearMonth()   {year, month} of the local calendar month
 *  - Labels.periodRange(id)      {start, end} "YYYY-MM-DD" for a period id:
 *                                'this-month', 'last-month', 'last-3m',
 *                                'last-6m', 'last-12m', 'ytd'; null unknown
 *  - Labels.entryForSelection(parent, sub)  "Parent" or "Parent:Sub"
 *  - Labels.donutData(parts, total)  {labels, values, colors} for a
 *                                budget-composition donut (Unlabeled gray)
 *  - Labels.trendToChartJs(chartLine)  {labels, datasets} for the spend
 *                                trend chart from a ChartLine response
 *  - Labels.REVISION             version of this file's API
 *
 * No DOM access here: everything is unit-testable under jsdom/plain Node.
 */
(function () {
    'use strict';

    var MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function ymd(year, month, day) {
        // month is 1-based
        return year + '-' + pad2(month) + '-' + pad2(day);
    }

    function currentYearMonth() {
        var now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }

    function today() {
        var now = new Date();
        return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }

    function daysInMonth(year, month) {
        return new Date(year, month, 0).getDate(); // month 1-based: 0-day of next
    }

    function monthStart(year, month) {
        return ymd(year, month, 1);
    }

    function monthEnd(year, month) {
        return ymd(year, month, daysInMonth(year, month));
    }

    /** Shift {year, month} by d months (can be negative). */
    function shiftMonth(year, month, d) {
        var total = (year * 12 + (month - 1)) + d;
        var y = Math.floor(total / 12);
        var m = ((total % 12) + 12) % 12 + 1;
        return { year: y, month: m };
    }

    /**
     * Resolve a period id to a concrete date range.
     * 'this-month' starts at the 1st of the current month and ends today;
     * 'ytd' starts January 1st of the current year and ends today.
     * Unknown ids return null so callers can fall back to defaults.
     */
    function periodRange(periodId) {
        var cur = currentYearMonth();
        switch (periodId) {
            case 'this-month':
                return { start: monthStart(cur.year, cur.month), end: today() };
            case 'last-month': {
                var prev = shiftMonth(cur.year, cur.month, -1);
                return { start: monthStart(prev.year, prev.month), end: monthEnd(prev.year, prev.month) };
            }
            case 'last-3m': {
                var s3 = shiftMonth(cur.year, cur.month, -3);
                return { start: monthStart(s3.year, s3.month), end: today() };
            }
            case 'last-6m': {
                var s6 = shiftMonth(cur.year, cur.month, -6);
                return { start: monthStart(s6.year, s6.month), end: today() };
            }
            case 'last-12m': {
                var s12 = shiftMonth(cur.year, cur.month, -12);
                return { start: monthStart(s12.year, s12.month), end: today() };
            }
            case 'ytd':
                return { start: ymd(cur.year, 1, 1), end: today() };
            default:
                return null;
        }
    }

    /** Friendly label for a period id. */
    function periodLabel(periodId) {
        switch (periodId) {
            case 'this-month': return 'This month';
            case 'last-month': return 'Last month';
            case 'last-3m': return 'Last 3 months';
            case 'last-6m': return 'Last 6 months';
            case 'last-12m': return 'Last 12 months';
            case 'ytd': return 'Year to date';
            default: return 'Custom';
        }
    }

    /**
     * Entry string for the entry picker: whole parent category or one
     * subcategory. Matches the backend entry semantics exactly.
     */
    function entryForSelection(parent, sub) {
        var p = (parent || '').trim();
        var s = (sub || '').trim();
        if (!p) return '';
        return s && s !== 'all' ? p + ':' + s : p;
    }

    var UNLABELED_COLOR = '#9ca3af';

    /**
     * Build Chart.js donut inputs from a budget-composition response.
     * parts: [{label, color, amount, pct}] as returned by the API.
     */
    function donutData(parts, total) {
        var labels = [];
        var values = [];
        var colors = [];
        (parts || []).forEach(function (p) {
            if (p.amount <= 0) return;
            labels.push(p.label);
            values.push(p.amount);
            colors.push(p.label === 'Unlabeled' ? UNLABELED_COLOR : (p.color || '#3b82f6'));
        });
        return { labels: labels, values: values, colors: colors, total: total || 0 };
    }

    /**
     * Format a period bucket key for the x-axis. Keys are month-end
     * (or day) timestamps like "2026-01-31T00:00:00+00:00": month-grained
     * buckets (key on the last day of the month) show as "2026-01",
     * finer buckets as "YYYY-MM-DD".
     */
    function formatPeriodKey(key) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key || '');
        if (!m) return key;
        var y = parseInt(m[1], 10);
        var mo = parseInt(m[2], 10);
        var d = parseInt(m[3], 10);
        var lastDay = new Date(y, mo, 0).getDate(); // 1-based month
        if (d === lastDay) return m[1] + '-' + m[2];
        return m[1] + '-' + m[2] + '-' + m[3];
    }

    /**
     * Convert a ChartLine (array of {label, entries: {periodKey: amount}})
     * into Chart.js line inputs: one sorted x-axis (formatted keys) and one
     * aligned data array per dataset (null where a dataset has no value for
     * a bucket).
     */
    function trendToChartJs(chartLine) {
        var keys = {};
        (chartLine || []).forEach(function (ds) {
            var entries = ds.entries || {};
            Object.keys(entries).forEach(function (k) {
                keys[k] = true;
            });
        });
        var rawLabels = Object.keys(keys).sort();
        var labels = rawLabels.map(formatPeriodKey);
        var datasets = (chartLine || []).map(function (ds) {
            var entries = ds.entries || {};
            return {
                label: ds.label,
                data: rawLabels.map(function (k) {
                    return entries[k] !== undefined ? entries[k] : null;
                })
            };
        });
        return { labels: labels, datasets: datasets };
    }

    /** Format an amount with the currency symbol, tolerating missing values. */
    function formatAmount(amount, symbol) {
        if (amount === null || amount === undefined || isNaN(amount)) return '—';
        var s = (symbol || '').trim() || '';
        var n = Number(amount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return s ? s + n : n;
    }

    var API = {
        REVISION: '2026-10-02.1',
        MONTH_NAMES: MONTH_NAMES,
        ymd: ymd,
        pad2: pad2,
        currentYearMonth: currentYearMonth,
        today: today,
        daysInMonth: daysInMonth,
        monthStart: monthStart,
        monthEnd: monthEnd,
        shiftMonth: shiftMonth,
        periodRange: periodRange,
        periodLabel: periodLabel,
        entryForSelection: entryForSelection,
        donutData: donutData,
        formatPeriodKey: formatPeriodKey,
        trendToChartJs: trendToChartJs,
        formatAmount: formatAmount,
        UNLABELED_COLOR: UNLABELED_COLOR
    };

    window.Labels = window.Labels || {};
    Object.keys(API).forEach(function (k) {
        window.Labels[k] = API[k];
    });
})();
