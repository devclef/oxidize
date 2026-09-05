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
    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const date = new Date(Date.UTC(year, month, day));

    switch (mode) {
        case 'start_of_current_month':
            date.setUTCDate(1);
            break;
        case 'end_of_current_month':
            date.setUTCMonth(date.getUTCMonth() + 1, 0);
            break;
        case 'start_of_next_month':
            date.setUTCMonth(date.getUTCMonth() + 1, 1);
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
            const durationMs = new Date(dates.end) - new Date(dates.start);
            const comparisonEndDate = new Date(new Date(dates.start).getTime() - durationMs);
            const comparisonStart = new Date(comparisonEndDate.getTime() - durationMs);

            document.getElementById('comparison-start-date').value = comparisonStart.toISOString().split('T')[0];
            document.getElementById('comparison-end-date').value = comparisonEndDate.toISOString().split('T')[0];
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
