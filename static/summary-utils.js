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
        currentYearMonth: currentYearMonth,
        shiftMonth: shiftMonth,
        monthKey: monthKey,
        monthLabel: monthLabel,
        shortMonthLabel: shortMonthLabel,
        daysInMonth: daysInMonth,
        pctDelta: pctDelta,
        isFuture: isFuture,
        escapeHtml: escapeHtml
    };
})();
