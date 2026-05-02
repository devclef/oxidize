# Relative Time Range Design

## Config

- New env var `TIME_RANGES` (default: `7d,30d,3m,6m,1y,ytd`) — comma-separated list of preset keys
- New env var `DEFAULT_TIME_RANGE` (optional, default: `30d`) — pre-selected preset on page load
- Both values passed to frontend via `window.OXIDIZE_CONFIG`

## Round End Date

- Checkbox: "Round end date to month boundary"
- When checked, a dropdown appears with three options:
  - Start of current month
  - End of current month
  - Start of next month
- Only applies when a relative range preset or custom range is selected

## UI Changes

### index.html
- Add `<select id="time-range-select">` above the existing date inputs
- Options built dynamically from `TIME_RANGES` config values
- "Custom" option at the bottom
- Add "Round end date" checkbox and month-boundary dropdown (initially hidden)
- Add custom range inputs (number + unit dropdown, initially hidden)

### app.js
- On time range select change: call `applyDateRange()`, fill date inputs, trigger `fetchChartData()`
- On "Custom" selection: show inline number + unit inputs
- On round-end checkbox: show/hide month-boundary dropdown
- On any change (custom inputs, round-end): recalculate dates and update chart

### date-utils.js
- Keep existing `calculateRelativeDates()` and `applyDateRange()` unchanged
- Add `calculateRelativeDatesFromCustom(count, unit)` for custom ranges — unit is one of: `days`, `weeks`, `months`, `years`
- Add `roundEndDate(date, mode)` for month boundary rounding

## Backend Changes

### src/config.rs
- Add `time_ranges: Vec<String>` and `default_time_range: String` fields
- Parse from env vars `TIME_RANGES` and `DEFAULT_TIME_RANGE`

### src/handlers/index.rs
- Inject `timeRanges` and `defaultTimeRange` into `window.OXIDIZE_CONFIG`

## Data Flow

```
Env var → Config struct → OXIDIZE_CONFIG JSON → Frontend dropdown
Time range select → applyDateRange() → fill date inputs → fetchChartData() → chart updates
```

## Backwards Compatibility

- Manual date editing remains fully supported
- Date inputs remain the source of truth
- Existing behavior unchanged when env vars are not set (uses defaults)
