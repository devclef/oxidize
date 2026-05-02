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
            startDate.setMonth(startDate.getMonth() - num);
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
