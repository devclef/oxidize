// Date utility functions for relative date range calculations

function calculateRelativeDates(range) {
    const endDate = new Date();
    const startDate = new Date();

    switch (range) {
        case '7d':
            startDate.setDate(startDate.getDate() - 7);
            break;
        case '30d':
            startDate.setDate(startDate.getDate() - 30);
            break;
        case '3m':
            startDate.setMonth(startDate.getMonth() - 3);
            break;
        case '6m':
            startDate.setMonth(startDate.getMonth() - 6);
            break;
        case '12m':
            startDate.setMonth(startDate.getMonth() - 12);
            break;
        case '1y':
            startDate.setFullYear(startDate.getFullYear() - 1);
            break;
        case 'ytd':
            startDate.setMonth(0, 1);
            break;
        case 'custom':
        default:
            return null;
    }

    return {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };
}

function calculateRelativeDatesFromCustom(count, unit) {
    const endDate = new Date();
    const startDate = new Date();
    const num = parseInt(count, 10);

    switch (unit) {
        case 'days':
            startDate.setDate(startDate.getDate() - num);
            break;
        case 'weeks':
            startDate.setDate(startDate.getDate() - (num * 7));
            break;
        case 'months':
            const day = startDate.getDate();
            startDate.setDate(1);
            startDate.setMonth(startDate.getMonth() - num);
            const maxDay = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
            startDate.setDate(Math.min(day, maxDay));
            break;
        case 'years':
            startDate.setFullYear(startDate.getFullYear() - num);
            break;
        default:
            return null;
    }

    return {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
    };
}

function roundEndDate(dateStr, mode) {
    const date = new Date(dateStr);
    const now = new Date();

    switch (mode) {
        case 'start_of_current_month':
            date.setDate(1);
            date.setHours(0, 0, 0, 0);
            break;
        case 'end_of_current_month':
            date.setMonth(date.getMonth() + 1, 0);
            date.setHours(23, 59, 59, 999);
            break;
        case 'start_of_next_month':
            date.setMonth(date.getMonth() + 1, 1);
            date.setHours(0, 0, 0, 0);
            break;
        default:
            return dateStr;
    }

    return date.toISOString().split('T')[0];
}

function applyDateRange(range) {
    const dates = calculateRelativeDates(range);
    if (dates) {
        document.getElementById('start-date').value = dates.start;
        document.getElementById('end-date').value = dates.end;

        // Also update comparison dates if comparison is enabled
        if (typeof enableComparison !== 'undefined' && enableComparison) {
            const previous = calculatePreviousPeriod(dates.start, dates.end);
            if (previous) {
                document.getElementById('comparison-start-date').value = previous.start;
                document.getElementById('comparison-end-date').value = previous.end;
            }
        }
    }
}

// Attach to window for regular script loading
if (typeof window !== 'undefined') {
    window.calculateRelativeDates = calculateRelativeDates;
    window.calculateRelativeDatesFromCustom = calculateRelativeDatesFromCustom;
    window.roundEndDate = roundEndDate;
    window.applyDateRange = applyDateRange;
}

// The period of the same length immediately before start..end (inclusive
// YYYY-MM-DD dates), used as the default "compare with previous period"
// range. Returns null for missing or inverted dates.
function calculatePreviousPeriod(start, end) {
    if (!start || !end) return null;
    const dayMs = 24 * 60 * 60 * 1000;
    const s = Date.parse(start + 'T00:00:00Z');
    const e = Date.parse(end + 'T00:00:00Z');
    if (isNaN(s) || isNaN(e) || e < s) return null;
    const lengthDays = Math.round((e - s) / dayMs) + 1;
    const prevEnd = new Date(s - dayMs);
    const prevStart = new Date(s - lengthDays * dayMs);
    return {
        start: prevStart.toISOString().split('T')[0],
        end: prevEnd.toISOString().split('T')[0]
    };
}

// ── Relative widget date ranges ────────────────────────────────────────
// A widget may store `relative_range` instead of fixed dates: a preset key
// ('30d', '3m', '1y', 'ytd', ...) or 'custom:<count>:<unit>'. The dates are
// worked out when the widget renders, so "Last 30 days" keeps moving
// forward. `round_end_mode` (see roundEndDate) rounds the end date.

const RELATIVE_UNITS = { d: 'days', w: 'weeks', m: 'months', y: 'years' };

function customRelativeRangeKey(count, unit) {
    const n = parseInt(count, 10);
    if (!(n >= 1 && n <= 999) || !Object.values(RELATIVE_UNITS).includes(unit)) return null;
    return `custom:${n}:${unit}`;
}

// { kind: 'preset', key } | { kind: 'custom', count, unit } | null
function parseRelativeRange(range) {
    if (typeof range !== 'string' || !range) return null;
    if (range === 'ytd') return { kind: 'preset', key: range };
    const custom = range.match(/^custom:(\d{1,3}):(days|weeks|months|years)$/);
    if (custom) {
        const count = parseInt(custom[1], 10);
        return count >= 1 ? { kind: 'custom', count, unit: custom[2] } : null;
    }
    const preset = range.match(/^(\d{1,3})([dwmy])$/);
    if (preset && parseInt(preset[1], 10) >= 1) return { kind: 'preset', key: range };
    return null;
}

// Dates for a relative range (optionally rounding the end), or null when the
// range is missing or invalid.
function resolveRelativeRange(range, roundEndMode) {
    const parsed = parseRelativeRange(range);
    if (!parsed) return null;
    let dates;
    if (parsed.kind === 'custom') {
        dates = calculateRelativeDatesFromCustom(parsed.count, parsed.unit);
    } else {
        dates = calculateRelativeDates(parsed.key);
        if (!dates) {
            const m = parsed.key.match(/^(\d+)([dwmy])$/);
            dates = m ? calculateRelativeDatesFromCustom(m[1], RELATIVE_UNITS[m[2]]) : null;
        }
    }
    if (!dates) return null;
    if (roundEndMode) dates.end = roundEndDate(dates.end, roundEndMode);
    return dates;
}

// The dates a widget charts: the dashboard's range when it inherits it,
// else its relative range worked out for today, else its fixed dates.
function widgetEffectiveDates(widget, dashboardDates) {
    const fixed = { start: widget.start_date || null, end: widget.end_date || null };
    if ((widget.date_range_source || 'custom') === 'dashboard') {
        const d = dashboardDates || {};
        return { start: d.start || fixed.start, end: d.end || fixed.end };
    }
    return resolveRelativeRange(widget.relative_range, widget.round_end_mode) || fixed;
}

if (typeof window !== 'undefined') {
    window.calculatePreviousPeriod = calculatePreviousPeriod;
    window.customRelativeRangeKey = customRelativeRangeKey;
    window.parseRelativeRange = parseRelativeRange;
    window.resolveRelativeRange = resolveRelativeRange;
    window.widgetEffectiveDates = widgetEffectiveDates;
}
