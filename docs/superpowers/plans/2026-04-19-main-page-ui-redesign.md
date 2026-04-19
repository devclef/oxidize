# Main Page UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the main page (index.html, style.css) with a clean & minimal aesthetic, improving account selection UX and typography/spacing consistency without breaking any functionality.

**Architecture:** Pure HTML/CSS/JS changes — no new dependencies, no backend changes. The existing event handlers, DOM IDs, and JS function signatures are preserved. We restructure HTML elements and rewrite CSS.

**Tech Stack:** Vanilla HTML, CSS (CSS variables for theming), vanilla JS.

---

### Task 1: Rewrite CSS with clean & minimal design system

**Files:**
- Modify: `static/style.css`

This is the biggest change. We rewrite the entire CSS file with a clean & minimal design system. Key changes:

- 8px spacing grid system (use `--space-*` variables: 4, 8, 12, 16, 24, 32, 48)
- Reduced shadows: `0 1px 2px rgba(0,0,0,0.05)` for cards
- Consistent border radius: `--radius-sm` (4px), `--radius-md` (6px), `--radius-lg` (8px)
- Font sizes: `--text-xs` (0.75rem), `--text-sm` (0.875rem), `--text-base` (1rem), `--text-lg` (1.125rem), `--text-xl` (1.25rem), `--text-2xl` (1.5rem)
- Line heights: 1.5 for body, 1.3 for headings
- Nav: border-bottom instead of shadow, active state uses underline indicator
- Account pills: horizontal pill-style buttons for type filter
- Search input: clean search bar with icon
- Account cards: reduced padding, thinner left accent bar
- Chart controls: compact primary row + collapsible advanced section
- Save-as-widget: secondary position below chart
- All existing class names preserved for backward compatibility with JS

```css
:root {
    /* Clean & minimal light theme */
    --bg-color: #fafbfc;
    --card-bg: #ffffff;
    --text-color: #1a1a2e;
    --text-muted: #6b7280;
    --text-secondary: #4b5563;
    --heading-color: #111827;
    --border-color: #e5e7eb;
    --border-light: #f3f4f6;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
    --shadow-md: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
    --shadow-hover: 0 4px 6px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.04);
    --accent-color: #3b82f6;
    --accent-hover: #2563eb;
    --accent-light: #eff6ff;
    --accent-text: #1d4ed8;
    --success-color: #10b981;
    --success-hover: #059669;
    --success-light: #ecfdf5;
    --warning-color: #f59e0b;
    --warning-hover: #d97706;
    --warning-light: #fffbeb;
    --error-color: #ef4444;
    --error-bg: #fef2f2;
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 8px;
    --radius-full: 9999px;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --space-6: 32px;
    --space-8: 48px;
    --transition-fast: 150ms ease;
    --transition-normal: 200ms ease;
}

[data-theme="dark"] {
    --bg-color: #0f172a;
    --card-bg: #1e293b;
    --text-color: #e2e8f0;
    --text-muted: #94a3b8;
    --text-secondary: #cbd5e1;
    --heading-color: #f8fafc;
    --border-color: #334155;
    --border-light: #283548;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-md: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-hover: 0 4px 6px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2);
    --accent-color: #60a5fa;
    --accent-hover: #3b82f6;
    --accent-light: #1e3a5f;
    --accent-text: #93c5fd;
    --success-color: #34d399;
    --success-hover: #10b981;
    --success-light: #1a3a2e;
    --warning-color: #fbbf24;
    --warning-hover: #f59e0b;
    --warning-light: #3a2e1a;
    --error-color: #f87171;
    --error-bg: #3a1a1a;
}

/* Base */
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.5;
    color: var(--text-color);
    max-width: 1280px;
    margin: 0 auto;
    padding: var(--space-6);
    background-color: var(--bg-color);
    transition: background-color var(--transition-normal), color var(--transition-normal);
}

/* Navigation */
.nav {
    display: flex;
    gap: var(--space-5);
    margin-bottom: var(--space-6);
    background: var(--card-bg);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border-bottom: 1px solid var(--border-color);
}

.nav a {
    color: var(--text-secondary);
    text-decoration: none;
    font-weight: 500;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
    position: relative;
}

.nav a:hover {
    color: var(--accent-color);
    background: var(--accent-light);
}

.nav a.active {
    color: var(--accent-color);
    background: var(--accent-light);
}

.nav a.active::after {
    content: '';
    position: absolute;
    bottom: -13px;
    left: var(--space-3);
    right: var(--space-3);
    height: 2px;
    background: var(--accent-color);
    border-radius: 1px;
}

/* Page title */
h1 {
    color: var(--heading-color);
    text-align: left;
    font-size: var(--text-2xl);
    font-weight: 600;
    margin: 0 0 var(--space-5) 0;
    letter-spacing: -0.025em;
}

/* Theme toggle */
.theme-toggle {
    position: fixed;
    top: var(--space-4);
    right: var(--space-4);
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: var(--shadow-md);
    transition: all var(--transition-fast);
    z-index: 1000;
}

.theme-toggle:hover {
    box-shadow: var(--shadow-hover);
    transform: scale(1.05);
}

.theme-toggle svg {
    width: 18px;
    height: 18px;
    fill: var(--text-color);
    transition: fill var(--transition-fast);
}

/* Section cards */
.account-section,
.controls {
    margin: var(--space-4) 0;
    background: var(--card-bg);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--border-color);
}

/* Account type pills */
.type-filter-pills {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
}

.type-pill {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 500;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    background: var(--card-bg);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition-fast);
    user-select: none;
}

.type-pill:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

.type-pill.active {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: white;
}

/* Search input */
.account-search {
    position: relative;
    margin-bottom: var(--space-3);
}

.account-search input {
    width: 100%;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-8);
    font-size: var(--text-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-color);
    color: var(--text-color);
    transition: border-color var(--transition-fast);
    box-sizing: border-box;
}

.account-search input:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px var(--accent-light);
}

.account-search::before {
    content: '';
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--text-muted);
    border-radius: var(--radius-full);
    pointer-events: none;
}

/* Section headers */
.account-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
}

.account-section-header h3 {
    margin: 0;
    color: var(--heading-color);
    font-size: var(--text-base);
    font-weight: 600;
}

.account-count-badge {
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--border-light);
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    margin-left: var(--space-2);
}

/* Collapse button */
.toggle-btn {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
}

.toggle-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

/* Select all / deselect all links */
.account-actions {
    margin: var(--space-2) 0 var(--space-3) 0;
    display: flex;
    gap: var(--space-3);
}

.account-actions button {
    padding: 0;
    background: none;
    border: none;
    font-size: var(--text-sm);
    color: var(--accent-color);
    cursor: pointer;
    font-weight: 500;
    text-decoration: none;
    padding: var(--space-1) 0;
}

.account-actions button:hover {
    text-decoration: underline;
    background: none;
    border: none;
    color: var(--accent-hover);
}

/* Account cards */
.account-list {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

.account-card {
    background: var(--card-bg);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    transition: all var(--transition-fast);
    position: relative;
}

.account-card:hover {
    box-shadow: var(--shadow-md);
    border-color: var(--accent-color);
}

.account-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent-color);
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.account-card input[type="checkbox"] {
    margin: 0;
    width: 16px;
    height: 16px;
    cursor: pointer;
    flex-shrink: 0;
}

.account-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex-grow: 1;
}

.account-name {
    font-weight: 500;
    font-size: var(--text-sm);
    color: var(--text-color);
}

.account-type-tag {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-muted);
    background-color: var(--border-light);
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    width: fit-content;
    letter-spacing: 0.025em;
}

.account-balance {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--success-color);
    white-space: nowrap;
}

.negative {
    color: var(--error-color);
}

/* Buttons */
button {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: 500;
    background-color: var(--accent-color);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--transition-fast);
}

button:hover {
    background-color: var(--accent-hover);
}

/* Fetch / refresh buttons */
.controls {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
}

.controls label {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
}

#fetch-accounts-btn,
#refresh-data-btn {
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
}

#refresh-data-btn {
    background-color: var(--warning-color);
}

#refresh-data-btn:hover {
    background-color: var(--warning-hover);
}

#refresh-data-btn:disabled {
    background-color: var(--text-muted);
    cursor: not-allowed;
    opacity: 0.6;
}

/* Chart section */
.chart-header {
    margin: var(--space-5) 0 var(--space-4) 0;
}

.chart-header h2 {
    margin: 0 0 var(--space-3) 0;
    text-align: left;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--heading-color);
    letter-spacing: -0.025em;
}

/* Chart controls primary row */
.chart-controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-light);
}

.chart-controls label {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
}

.chart-controls input[type="date"],
.chart-controls select {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-color);
}

.chart-controls input[type="date"]:focus,
.chart-controls select:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px var(--accent-light);
}

#update-chart-btn {
    margin-left: auto;
}

/* Mode toggle (pill-style radios) */
.chart-mode-toggle {
    display: flex;
    gap: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
}

.mode-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all var(--transition-fast);
    background: var(--card-bg);
    color: var(--text-secondary);
    border-right: 1px solid var(--border-color);
    margin: 0;
}

.mode-label:last-child {
    border-right: none;
}

.mode-label input[type="radio"],
.mode-label input[type="checkbox"] {
    margin: 0;
    width: 14px;
    height: 14px;
}

.chart-mode-toggle .mode-label:has(input:checked) {
    background: var(--accent-color);
    color: white;
}

/* Advanced options collapsible */
.advanced-options {
    display: none;
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-light);
}

.advanced-options.visible {
    display: block;
}

.advanced-row {
    display: flex;
    gap: var(--space-5);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
}

.advanced-group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.advanced-group label {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
}

.more-options-toggle {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: var(--space-1) 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    text-decoration: none;
}

.more-options-toggle:hover {
    color: var(--accent-color);
    background: none;
}

/* Comparison controls */
.comparison-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.comparison-controls input[type="date"],
.comparison-controls select {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-color);
}

/* % toggle */
.pct-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.pct-toggle select {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-color);
}

/* Save as widget section */
.widget-save-section {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-light);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.widget-save-section input[type="text"] {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    min-width: 200px;
}

.widget-save-section select {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    color: var(--text-color);
}

.save-graph-btn {
    background-color: var(--success-color);
}

.save-graph-btn:hover {
    background-color: var(--success-hover);
}

/* Chart wrapper */
.chart-wrapper {
    position: relative;
    height: 384px;
    width: 100%;
    margin-top: var(--space-4);
}

/* Legend */
.chart-legend {
    margin-top: var(--space-3);
    padding: var(--space-3);
    background: var(--border-light);
    border-radius: var(--radius-md);
}

.legend-container {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.legend-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--card-bg);
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid var(--border-color);
    transition: all var(--transition-fast);
}

.legend-item:hover {
    border-color: var(--accent-color);
    box-shadow: var(--shadow-sm);
}

.legend-item.hidden {
    opacity: 0.4;
    text-decoration: line-through;
}

.legend-color {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}

.legend-name {
    font-size: var(--text-xs);
    color: var(--text-color);
}

.legend-toggle-icon {
    font-size: 0.65rem;
    color: var(--text-muted);
}

/* Loading / error / info */
.loading {
    text-align: center;
    font-style: italic;
    color: var(--text-muted);
    padding: var(--space-5) 0;
}

.error {
    color: var(--error-color);
    background: var(--error-bg);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    margin-top: var(--space-3);
    font-size: var(--text-sm);
}

.info {
    color: var(--accent-color);
    background: var(--accent-light);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    margin-top: var(--space-3);
    font-size: var(--text-sm);
}

/* Responsive */
@media (max-width: 768px) {
    body {
        padding: var(--space-4);
    }

    .nav {
        gap: var(--space-3);
        flex-wrap: wrap;
    }

    .controls {
        flex-direction: column;
    }

    .chart-controls {
        flex-direction: column;
        align-items: flex-start;
    }

    #update-chart-btn {
        margin-left: 0;
        width: 100%;
    }

    .advanced-row {
        flex-direction: column;
        gap: var(--space-2);
    }

    .widget-save-section {
        flex-direction: column;
        align-items: flex-start;
    }
}

/* Dashboard styles (preserved from existing) */
.dashboard-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.dashboard-lock-btn {
    background: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-2);
    cursor: pointer;
    color: var(--text-color);
    display: flex;
    align-items: center;
    transition: background-color var(--transition-fast);
}

.dashboard-lock-btn:hover {
    background-color: var(--border-light);
}

.dashboard-lock-btn.locked svg {
    fill: var(--text-color);
}

.dashboard-lock-btn.unlocked svg {
    fill: none;
    stroke: var(--accent-color);
}

.dashboard-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: var(--space-4);
    margin-top: var(--space-4);
}

.dashboard-grid .widget[data-cols="1"]  { grid-column: span 1; }
.dashboard-grid .widget[data-cols="2"]  { grid-column: span 2; }
.dashboard-grid .widget[data-cols="3"]  { grid-column: span 3; }
.dashboard-grid .widget[data-cols="4"]  { grid-column: span 4; }
.dashboard-grid .widget[data-cols="6"]  { grid-column: span 6; }
.dashboard-grid .widget[data-cols="12"] { grid-column: span 12; }

@media (max-width: 900px) {
    .dashboard-grid .widget[data-cols="6"] { grid-column: span 12; }
}

.widget {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--border-color);
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.widget-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: var(--border-light);
    border-bottom: 1px solid var(--border-color);
}

.widget-title {
    font-weight: 600;
    color: var(--heading-color);
    font-size: var(--text-sm);
}

.widget-actions {
    display: flex;
    gap: var(--space-2);
}

.widget-actions button {
    padding: 2px var(--space-2);
    font-size: 12px;
}

.widget-body {
    padding: var(--space-3);
    flex: 1;
}

.widget-chart {
    position: relative;
    width: 100%;
}

.widget-chart-resize-handle {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 8px;
    cursor: ns-resize;
    background: transparent;
}

.widget-chart-resize-handle::after {
    content: '';
    position: absolute;
    bottom: 3px;
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 2px;
    border-radius: 1px;
    background: var(--text-muted);
    opacity: 0.4;
    transition: opacity var(--transition-fast);
}

.widget-chart-resize-handle:hover::after {
    opacity: 0.8;
}

.widget-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-color);
    font-size: 12px;
    color: var(--text-muted);
}

.widget-accounts {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.widget-account-tag {
    background: var(--accent-light);
    color: var(--accent-text);
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: 11px;
}

.widget-mode {
    display: flex;
    align-items: center;
    gap: 4px;
}

.widget-mode-badge {
    background: var(--accent-color);
    color: white;
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: 10px;
    text-transform: uppercase;
}

.widget-type-badge {
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 600;
}

.widget-type-badge.balance {
    background: var(--accent-color);
    color: white;
}

.widget-type-badge.earned-spent {
    background: linear-gradient(135deg, var(--success-color), var(--error-color));
    color: white;
}

.empty-dashboard {
    text-align: center;
    padding: var(--space-8) 0;
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--border-color);
}

.empty-dashboard h3 {
    color: var(--heading-color);
    margin-top: 0;
}

.empty-dashboard p {
    color: var(--text-muted);
}

.empty-dashboard a {
    color: var(--accent-color);
    text-decoration: none;
}

.empty-dashboard a:hover {
    text-decoration: underline;
}

/* Widget Settings */
.widget-settings {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-2) var(--space-4);
    background: var(--border-light);
    border-bottom: 1px solid var(--border-color);
    flex-wrap: wrap;
}

.widget-settings-section {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-color);
}

.widget-settings-section:last-child {
    border-bottom: none;
    padding-bottom: 0;
}

.widget-settings-section strong {
    color: var(--heading-color);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.widget-settings label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--text-color);
}

.widget-settings .checkbox-label {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
}

.widget-settings .checkbox-label input[type="checkbox"] {
    width: 14px;
    height: 14px;
    cursor: pointer;
}

.widget-settings input[type="date"],
.widget-settings select {
    padding: 2px;
    font-size: var(--text-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
}

.widget-settings button {
    padding: 2px var(--space-2);
    font-size: var(--text-sm);
    background: var(--accent-color);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
}

.widget-settings button:hover {
    background: var(--accent-hover);
}

.settings-toggle {
    background: var(--text-muted);
}

.settings-toggle:hover {
    background: var(--border-color);
}

/* SortableJS drag styles */
.dashboard-grid .sortable-ghost {
    opacity: 0.4;
    background: var(--card-bg);
    border: 2px dashed var(--border-color);
}

.dashboard-grid .sortable-chosen {
    box-shadow: var(--shadow-hover);
}

.dashboard-grid .sortable-drag {
    opacity: 0.9;
}
```

### Task 2: Restructure index.html for clean layout

**Files:**
- Modify: `static/index.html`

Key changes:
1. **Nav bar**: Keep as-is (IDs don't change)
2. **Account section**: Replace multi-select `<select>` with pill-style buttons + search input
3. **Chart controls**: Reorganize into primary row + collapsible advanced section
4. **Save as widget**: Move to a separate section below chart
5. **All existing IDs preserved** for JS compatibility

The new HTML structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Oxidize - Firefly III Accounts</title>
    <link rel="stylesheet" href="/static/style.css">
</head>
<body>
    <button id="theme-toggle" class="theme-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">
        <svg id="theme-icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="display: none;">
            <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zm5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/>
        </svg>
        <svg id="theme-icon-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
        </svg>
    </button>
    <nav class="nav">
        <a href="/" class="active">Graph Builder</a>
        <a href="/dashboard">Dashboard</a>
        <a href="/summary">Summary</a>
    </nav>
    <h1>Firefly III Account Balances</h1>

    <div class="controls">
        <label>Quick actions:</label>
        <button id="fetch-accounts-btn">Fetch Accounts</button>
        <button id="refresh-data-btn" title="Clear cache and fetch fresh data from Firefly III">Refresh Data</button>
    </div>

    <div class="account-section">
        <div class="account-section-header">
            <h3>Accounts<span id="account-count" class="account-count-badge"></span></h3>
            <button id="toggle-accounts-btn" class="toggle-btn" style="display: none;">Collapse</button>
        </div>

        <!-- Account type pills (replaces multi-select) -->
        <div id="type-filter-pills" class="type-filter-pills"></div>

        <!-- Search input -->
        <div class="account-search">
            <input type="text" id="account-search-input" placeholder="Search accounts..." autocomplete="off">
        </div>

        <div id="accounts-content">
            <div class="account-actions">
                <button id="select-all-btn">Select all</button>
                <button id="deselect-all-btn">Deselect all</button>
            </div>
            <div id="app">
                <div class="loading">Select a type and click "Fetch Accounts" to begin.</div>
            </div>
        </div>
    </div>

    <div class="chart-header">
        <div class="dashboard-header">
            <h2 id="chart-title">Account Balance History</h2>
            <select id="widget-type-select">
                <option value="balance">Balance</option>
                <option value="earned_spent">Earned vs Spent</option>
                <option value="expenses_by_category">Expenses by Category</option>
                <option value="net_worth">Net Worth</option>
            </select>
        </div>

        <!-- Primary chart controls -->
        <div class="chart-controls">
            <label for="start-date">Start:</label>
            <input type="date" id="start-date">
            <label for="end-date">End:</label>
            <input type="date" id="end-date">
            <label for="interval-select">Interval:</label>
            <select id="interval-select">
                <option value="auto">Auto</option>
                <option value="1D">Day</option>
                <option value="1W">Week</option>
                <option value="1M">Month</option>
                <option value="1Y">Year</option>
            </select>
            <div class="chart-mode-toggle">
                <label class="mode-label">
                    <input type="radio" name="chart-mode" value="combined" checked>
                    Combined
                </label>
                <label class="mode-label">
                    <input type="radio" name="chart-mode" value="split">
                    Split
                </label>
            </div>
            <button id="update-chart-btn">Update Graph</button>
        </div>

        <!-- Advanced options (collapsible) -->
        <div id="advanced-options" class="advanced-options">
            <button id="toggle-advanced-btn" class="more-options-toggle" type="button">
                Hide advanced options
            </button>
            <div class="advanced-row">
                <div class="pct-toggle">
                    <label class="mode-label" style="border: none; background: none;">
                        <input type="checkbox" id="show-pct-toggle">
                        Show % Change
                    </label>
                    <select id="pct-mode-select" style="display: none;">
                        <option value="from_previous">From Previous</option>
                        <option value="from_first">From First Point</option>
                    </select>
                </div>
                <div class="advanced-group">
                    <label>
                        <input type="checkbox" id="enable-comparison">
                        Compare with previous period
                    </label>
                </div>
            </div>
            <div id="comparison-controls-wrapper" class="comparison-controls" style="display: none;">
                <label for="comparison-start-date">Comparison Start:</label>
                <input type="date" id="comparison-start-date">
                <label for="comparison-end-date">Comparison End:</label>
                <input type="date" id="comparison-end-date">
            </div>
        </div>

        <div id="chart-error"></div>
        <div class="chart-wrapper">
            <canvas id="balanceChart"></canvas>
        </div>
        <div id="split-legend" class="chart-legend" style="display: none;">
            <div class="legend-container" id="legend-items"></div>
        </div>

        <!-- Save as widget section -->
        <div class="widget-save-section">
            <input type="text" id="widget-name-input" placeholder="Widget name">
            <button id="save-graph-btn" class="save-graph-btn">Save as Widget</button>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="/static/app.js"></script>
    <script src="/static/theme.js"></script>
</body>
</html>
```

### Task 3: Update app.js for new account selection & chart controls

**Files:**
- Modify: `static/app.js`

Key changes to the DOMContentLoaded handler and related functions:

1. **Replace multi-select type filter with pill-based filter**:
   - Build pill buttons from `CONFIG.accountTypes`
   - Track selected types in a Set
   - "All" pill selects all types
   - Clicking a pill toggles its state
   - Update `fetchAccounts()` to use the pill-based selection instead of `<select multiple>`

2. **Add account search functionality**:
   - Listen for input on `#account-search-input`
   - Filter account cards by name when typing
   - Debounce the search input (300ms)

3. **Update account count badge**:
   - After accounts are fetched, update `#account-count` text

4. **Advanced options toggle**:
   - Add click handler for `#toggle-advanced-btn` (or create one)
   - Toggle `.visible` class on `#advanced-options`
   - Change button text between "Show advanced options" / "Hide advanced options"

5. **Comparison controls wrapper**:
   - Change ID from `comparison-controls` to `comparison-controls-wrapper` in the JS toggle function
   - Or keep the existing ID and just update the selector reference

6. **Remove old comparison toggle div** from HTML (it's now inside advanced options)

Since we're changing the DOM structure, we need to update the JS event handlers. The key functions that need changes:

- `fetchAccounts()`: Change from reading `<select multiple>` to reading pill-based selection
- `DOMContentLoaded` handler: Replace type-filter event listener with pill-based logic, add search listener, add advanced toggle listener
- `toggleComparisonControls()`: Update selector from `.comparison-controls` to `#comparison-controls-wrapper`

The exact code changes:

```javascript
// In DOMContentLoaded, replace the type-filter population and event handling:

// Build type filter pills
const typeFilterPills = document.getElementById('type-filter-pills');
const selectedTypes = new Set(['all']); // Default: all selected
const allPill = document.createElement('button');
allPill.type = 'button';
allPill.className = 'type-pill active';
allPill.textContent = 'All';
allPill.dataset.type = 'all';
typeFilterPills.appendChild(allPill);

CONFIG.accountTypes.forEach(type => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'type-pill';
    pill.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    pill.dataset.type = type;
    typeFilterPills.appendChild(pill);
});

// Pill click handler
typeFilterPills.addEventListener('click', (e) => {
    const pill = e.target.closest('.type-pill');
    if (!pill) return;

    const type = pill.dataset.type;

    if (type === 'all') {
        // Select all, deselect others
        selectedTypes.clear();
        selectedTypes.add('all');
        typeFilterPills.querySelectorAll('.type-pill').forEach(p => p.classList.add('active'));
    } else {
        // Deselect "all"
        selectedTypes.delete('all');
        allPill.classList.remove('active');

        // Toggle this pill
        pill.classList.toggle('active');
        if (pill.classList.contains('active')) {
            selectedTypes.add(type);
        } else {
            selectedTypes.delete(type);
        }

        // If no types selected, select all
        if (selectedTypes.size === 0) {
            selectedTypes.add(type);
            pill.classList.add('active');
        }
    }
});

// Account search input
const searchInput = document.getElementById('account-search-input');
let searchTimeout = null;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.account-card').forEach(card => {
            const name = card.querySelector('.account-name')?.textContent.toLowerCase() || '';
            card.style.display = name.includes(query) ? 'flex' : 'none';
        });
    }, 300);
});

// Advanced options toggle
const toggleAdvancedBtn = document.createElement('button');
toggleAdvancedBtn.type = 'button';
toggleAdvancedBtn.className = 'more-options-toggle';
toggleAdvancedBtn.id = 'toggle-advanced-btn';
toggleAdvancedBtn.textContent = 'Show advanced options';
document.getElementById('advanced-options').prepend(toggleAdvancedBtn);

let advancedVisible = false;
toggleAdvancedBtn.addEventListener('click', () => {
    advancedVisible = !advancedVisible;
    document.getElementById('advanced-options').classList.toggle('visible', advancedVisible);
    toggleAdvancedBtn.textContent = advancedVisible ? 'Hide advanced options' : 'Show advanced options';
});

// Update fetchAccounts to use pill-based selection
// Replace the typeFilter reading:
// OLD: const typeFilter = document.getElementById('type-filter');
//      const selectedTypes = Array.from(typeFilter.selectedOptions).map(opt => opt.value);
// NEW: (already using pill-based `selectedTypes` Set above)
```

### Task 4: Run tests to verify nothing is broken

**Files:**
- Run: `npm test` (frontend tests)
- Run: `cargo test` (backend tests — should be unaffected)

### Task 5: Commit all changes

**Files:**
- `static/index.html`
- `static/style.css`
- `static/app.js`

```bash
git add static/index.html static/style.css static/app.js
git commit -m "feat: redesign main page with clean & minimal UI

- Replace multi-select account type filter with pill-style buttons
- Add searchable account list with debounced filtering
- Reorganize chart controls into primary row + collapsible advanced section
- Move save-as-widget to secondary section below chart
- Implement 8px spacing grid, consistent typography, reduced shadows
- All existing functionality preserved

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
