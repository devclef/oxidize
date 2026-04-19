# Widget Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable per-widget reordering (drag-and-drop), resizable chart heights (drag-to-resize), and configurable widths (1-12 columns) on the dashboard, all persisted to the database.

**Architecture:** Three new integer columns on the `widgets` table store `display_order`, `width`, and `chart_height`. The Rust backend serializes/deserializes these via serde. The frontend uses SortableJS for drag reordering, interact.js for chart resize, and a dropdown in the settings panel for width selection. All changes save via the existing PUT endpoint.

**Tech Stack:** Rust/Actix-Web, SQLite/rusqlite, vanilla JS, SortableJS (CDN), interact.js (CDN), Chart.js (CDN), CSS Grid.

---

### Task 1: Update Widget Rust model with new fields

**Files:**
- Modify: `src/models/widget.rs`

- [ ] **Step 1: Add display_order, width, chart_height to Widget struct**

Add three new fields to the `Widget` struct in `src/models/widget.rs`, after the `chart_options` field and before `created_at`:

```rust
    #[serde(default = "default_display_order")]
    pub display_order: i32,
    #[serde(default = "default_width")]
    pub width: i32,
    #[serde(default = "default_chart_height")]
    pub chart_height: i32,
```

Add three default functions after the `default_pct_mode` function:

```rust
fn default_display_order() -> i32 {
    0
}

fn default_width() -> i32 {
    12
}

fn default_chart_height() -> i32 {
    300
}
```

The full updated struct should look like:

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Widget {
    pub id: String,
    pub name: String,
    pub accounts: Vec<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub interval: Option<String>,
    pub chart_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widget_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_options: Option<ChartOptions>,
    #[serde(default = "default_display_order")]
    pub display_order: i32,
    #[serde(default = "default_width")]
    pub width: i32,
    #[serde(default = "default_chart_height")]
    pub chart_height: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}
```

- [ ] **Step 2: Verify the model compiles**

Run: `cargo check`
Expected: No errors, exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add src/models/widget.rs
git commit -m "feat: add display_order, width, chart_height fields to Widget model"
```

---

### Task 2: Update database schema with new columns

**Files:**
- Modify: `src/storage/mod.rs`

- [ ] **Step 1: Update CREATE TABLE to include new columns**

In the `init_db` function, update the CREATE TABLE statement to include the three new columns. Replace the existing table definition:

```sql
CREATE TABLE IF NOT EXISTS widgets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    accounts TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    interval TEXT,
    chart_mode TEXT,
    widget_type TEXT,
    chart_options TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 12,
    chart_height INTEGER NOT NULL DEFAULT 300,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
```

- [ ] **Step 2: Add migration for existing databases**

After the existing widget_type migration in `init_db`, add three more migrations (each wrapped in `let _ = ...` to ignore "column already exists" errors):

```rust
    // Migration: Add display_order column if it doesn't exist
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0",
        [],
    );

    // Migration: Add width column if it doesn't exist
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN width INTEGER NOT NULL DEFAULT 12",
        [],
    );

    // Migration: Add chart_height column if it doesn't exist
    let _ = conn.execute(
        "ALTER TABLE widgets ADD COLUMN chart_height INTEGER NOT NULL DEFAULT 300",
        [],
    );
```

- [ ] **Step 3: Verify the storage compiles**

Run: `cargo check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/storage/mod.rs
git commit -m "feat: add display_order, width, chart_height columns to widgets table"
```

---

### Task 3: Update storage CRUD operations for new fields

**Files:**
- Modify: `src/storage/mod.rs`

- [ ] **Step 1: Update SELECT query in get_all_widgets**

Replace the SELECT statement to include the three new columns:

```rust
"SELECT id, name, accounts, start_date, end_date, interval, chart_mode,
        widget_type, chart_options, display_order, width, chart_height, created_at, updated_at
 FROM widgets ORDER BY display_order ASC, created_at DESC"
```

Also update the `query_map` closure. Replace the row reading section:

```rust
let chart_options_json: Option<String> = row.get(8)?;
let display_order: i32 = row.get(9)?;
let width: i32 = row.get(10)?;
let chart_height: i32 = row.get(11)?;
let created_at: Option<String> = row.get(12)?;
let updated_at: Option<String> = row.get(13)?;
```

And update the `Widget` construction:

```rust
Ok(Widget {
    id,
    name,
    accounts,
    start_date,
    end_date,
    interval,
    chart_mode,
    widget_type,
    chart_options,
    display_order,
    width,
    chart_height,
    created_at,
    updated_at,
})
```

- [ ] **Step 2: Update INSERT in create_widget**

Replace the INSERT statement to include the three new fields. The widget's `display_order` should be auto-assigned: find the max existing order, or use 0 if no widgets exist.

First, add a helper to compute the next order:

```rust
fn next_display_order(conn: &Connection) -> Result<i32, String> {
    let max_order: Option<i32> = conn.query_row(
        "SELECT MAX(display_order) FROM widgets",
        [],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(max_order.unwrap_or(-1) + 1)
}
```

Then update the `create_widget` method to use this:

```rust
pub fn create_widget(widget: &Widget) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let accounts_json = serde_json::to_string(&widget.accounts).map_err(|e| e.to_string())?;
    let chart_options_json = widget
        .chart_options
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    let display_order = next_display_order(&rusqlite::Connection::open(get_db_path())?)
        .unwrap_or(0);

    with_db(|conn| {
        conn.execute(
            "INSERT INTO widgets (id, name, accounts, start_date, end_date, interval,
                                  chart_mode, widget_type, chart_options, display_order, width, chart_height, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                &widget.id,
                &widget.name,
                &accounts_json,
                &widget.start_date,
                &widget.end_date,
                &widget.interval,
                &widget.chart_mode,
                &widget.widget_type,
                &chart_options_json,
                &display_order,
                &widget.width,
                &widget.chart_height,
                &now,
                &now
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}
```

- [ ] **Step 3: Update UPDATE in update_widget**

Add the three new fields to the SET clause:

```rust
"UPDATE widgets SET
    name = ?1, accounts = ?2, start_date = ?3, end_date = ?4,
    interval = ?5, chart_mode = ?6, widget_type = ?7, chart_options = ?8,
    display_order = ?9, width = ?10, chart_height = ?11, updated_at = ?12
 WHERE id = ?13",
```

And update the params:

```rust
params![
    &widget.name,
    &accounts_json,
    &widget.start_date,
    &widget.end_date,
    &widget.interval,
    &widget.chart_mode,
    &widget.widget_type,
    &chart_options_json,
    &widget.display_order,
    &widget.width,
    &widget.chart_height,
    &now,
    &widget.id
]
```

- [ ] **Step 4: Verify the storage compiles**

Run: `cargo check`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/storage/mod.rs
git commit -m "feat: update storage CRUD to handle display_order, width, chart_height"
```

---

### Task 4: Add backend tests for new fields

**Files:**
- Create: `tests/widget_layout_test.rs`

- [ ] **Step 1: Write tests for model serialization/deserialization**

Create `tests/widget_layout_test.rs`:

```rust
use oxidize::models::widget::{ChartOptions, Widget};

#[test]
fn test_widget_deserialize_with_defaults() {
    // Simulate an old widget record without the new fields
    let json = r#"{
        "id": "test-1",
        "name": "Test Widget",
        "accounts": ["acc-1"],
        "start_date": null,
        "end_date": null,
        "interval": null,
        "chart_mode": null,
        "widget_type": null,
        "chart_options": null,
        "created_at": null,
        "updated_at": null
    }"#;

    let widget: Widget = serde_json::from_str(json).unwrap();
    assert_eq!(widget.display_order, 0);
    assert_eq!(widget.width, 12);
    assert_eq!(widget.chart_height, 300);
}

#[test]
fn test_widget_deserialize_with_new_fields() {
    let json = r#"{
        "id": "test-2",
        "name": "Test Widget",
        "accounts": ["acc-1"],
        "start_date": null,
        "end_date": null,
        "interval": null,
        "chart_mode": null,
        "widget_type": null,
        "chart_options": null,
        "display_order": 5,
        "width": 6,
        "chart_height": 400,
        "created_at": null,
        "updated_at": null
    }"#;

    let widget: Widget = serde_json::from_str(json).unwrap();
    assert_eq!(widget.display_order, 5);
    assert_eq!(widget.width, 6);
    assert_eq!(widget.chart_height, 400);
}

#[test]
fn test_widget_serialization_includes_new_fields() {
    let widget = Widget {
        id: "test-3".to_string(),
        name: "Test".to_string(),
        accounts: vec!["acc-1".to_string()],
        start_date: None,
        end_date: None,
        interval: None,
        chart_mode: None,
        widget_type: None,
        chart_options: None,
        display_order: 3,
        width: 4,
        chart_height: 350,
        created_at: None,
        updated_at: None,
    };

    let json = serde_json::to_string(&widget).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed["display_order"], 3);
    assert_eq!(parsed["width"], 4);
    assert_eq!(parsed["chart_height"], 350);
}

#[test]
fn test_chart_options_with_defaults() {
    let json = r#"{}"#;
    let opts: ChartOptions = serde_json::from_str(json).unwrap();
    assert!(!opts.show_pct);
    assert_eq!(opts.pct_mode, "from_previous");
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test widget_layout_test`
Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/widget_layout_test.rs
git commit -m "test: add serialization tests for new widget layout fields"
```

---

### Task 5: Add CDN scripts to dashboard.html

**Files:**
- Modify: `static/dashboard.html`

- [ ] **Step 1: Add SortableJS and interact.js CDN scripts**

Add these two script tags before the `dashboard.js` script tag in `static/dashboard.html`:

```html
    <script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/interactjs@1.19.0/dist/interact.min.js"></script>
    <script src="/static/dashboard.js"></script>
```

- [ ] **Step 2: Verify the change**

No build step needed for HTML. Just confirm the file looks correct:
Run: `cat static/dashboard.html`
Expected: Both CDN script tags present before dashboard.js.

- [ ] **Step 3: Commit**

```bash
git add static/dashboard.html
git commit -m "feat: add SortableJS and interact.js CDN scripts to dashboard"
```

---

### Task 6: Update CSS grid layout and add resize handle

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: Replace the dashboard grid CSS**

Find the `.dashboard-grid` rule (around line 401) and replace it:

Old:
```css
.dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 1.5rem;
    margin-top: 1.5rem;
}
```

New:
```css
.dashboard-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 1.5rem;
    margin-top: 1.5rem;
}

/* Widget width spans for 12-column grid */
.dashboard-grid .widget[data-cols="1"]  { grid-column: span 1; }
.dashboard-grid .widget[data-cols="2"]  { grid-column: span 2; }
.dashboard-grid .widget[data-cols="3"]  { grid-column: span 3; }
.dashboard-grid .widget[data-cols="4"]  { grid-column: span 4; }
.dashboard-grid .widget[data-cols="6"]  { grid-column: span 6; }
.dashboard-grid .widget[data-cols="12"] { grid-column: span 12; }
```

Note: Default behavior (no `data-cols` attribute or `data-cols="12"`) already spans full width via the 12-column grid.

- [ ] **Step 2: Update .widget-chart for resize handle**

Find the `.widget-chart` rule (around line 447) and update it:

Old:
```css
.widget-chart {
    position: relative;
    height: 200px;
    width: 100%;
}
```

New:
```css
.widget-chart {
    position: relative;
    width: 100%;
}
```

Remove the fixed `height: 200px` since heights will now be set inline per-widget.

- [ ] **Step 3: Add resize handle style**

Add this new rule after the `.widget-chart` rule:

```css
/* Resize handle for chart height */
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
    transition: opacity 0.2s;
}

.widget-chart-resize-handle:hover::after {
    opacity: 0.8;
}
```

- [ ] **Step 4: Verify CSS syntax**

No automated check available. Manually verify the CSS file has no syntax errors by checking that braces are balanced and there are no missing semicolons.

- [ ] **Step 5: Commit**

```bash
git add static/style.css
git commit -m "feat: update CSS grid to 12-column layout with resize handle"
```

---

### Task 7: Add width selector to widget settings panel

**Files:**
- Modify: `static/dashboard.js` (in the `renderDashboard` function)

- [ ] **Step 1: Add width selector to the settings panel HTML**

In the `renderDashboard` function, inside the `.widget-settings` div, add a width selector section before the "Update" button. Find the line:

```html
<button onclick="updateWidgetDateRange('${widget.id}')">Update</button>
```

Add the width selector right before the Update button. Replace the Update button line with:

```html
                        <div class="widget-settings-section" style="border-bottom: none; padding-bottom: 0;">
                            <strong>Width</strong>
                            <label>
                                <select id="${widget.id}-width" style="width: 120px;">
                                    <option value="12" ${widget.width === undefined || widget.width === 12 ? 'selected' : ''}>Full (12)</option>
                                    <option value="6" ${widget.width === 6 ? 'selected' : ''}>Half (6)</option>
                                    <option value="4" ${widget.width === 4 ? 'selected' : ''}>Third (4)</option>
                                    <option value="3" ${widget.width === 3 ? 'selected' : ''}>Quarter (3)</option>
                                    <option value="2" ${widget.width === 2 ? 'selected' : ''}>Half Third (2)</option>
                                    <option value="1" ${widget.width === 1 ? 'selected' : ''}>Narrow (1)</option>
                                </select>
                            </label>
                        </div>
                        <button onclick="updateWidgetDateRange('${widget.id}')">Update</button>
```

- [ ] **Step 2: Wire up width selector to update the grid span immediately**

After the `widgets.forEach` block that wires up percentage change controls (around line 985), add width selector change handlers:

```javascript
    // Wire up width selector for each widget
    widgets.forEach(widget => {
        const widthSelect = document.getElementById(`${widget.id}-width`);
        if (widthSelect) {
            widthSelect.addEventListener('change', async () => {
                const cols = parseInt(widthSelect.value, 10);
                const widgetCard = document.querySelector(`.widget[data-widget-id="${widget.id}"]`);
                if (widgetCard) {
                    widgetCard.setAttribute('data-cols', String(cols));
                }
                // Update the widget's width and save
                const w = widgets.find(w => w.id === widget.id);
                if (w) {
                    w.width = cols;
                    w.updated_at = new Date().toISOString();
                    try {
                        await fetch(`/api/widgets/${widget.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(w)
                        });
                    } catch (e) {
                        console.error('Failed to save widget width:', e);
                    }
                }
            });
        }
    });
```

- [ ] **Step 3: Apply width span to widget cards during render**

In the `widgets.forEach(widget => { ... })` block that builds the HTML (around line 881), add the `data-cols` attribute to the widget div. Change:

```html
<div class="widget" data-widget-id="${widget.id}">
```

To:

```html
<div class="widget" data-widget-id="${widget.id}" data-cols="${widget.width || 12}">
```

- [ ] **Step 4: Commit**

```bash
git add static/dashboard.js
git commit -m "feat: add per-widget width selector to settings panel"
```

---

### Task 8: Implement SortableJS drag-and-drop reordering

**Files:**
- Modify: `static/dashboard.js`

- [ ] **Step 1: Add reorder function**

Add this new function after the `deleteWidget` function (around line 177):

```javascript
// Reorder widgets by updating display_order on the server
async function reorderWidgets(widgetIds) {
    const updates = widgetIds.map((id, index) => ({
        id,
        display_order: index
    }));

    // Send each update individually
    await Promise.all(updates.map(update =>
        fetch(`/api/widgets/${update.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // Fetch the full widget first to avoid overwriting other fields
                ...widgetsCache.find(w => w.id === update.id),
                display_order: update.display_order,
                updated_at: new Date().toISOString()
            })
        })
    ));
}
```

- [ ] **Step 2: Maintain a widgets cache**

Add a module-level variable near the top of the file, after `let widgetDatasetVisibility = {};`:

```javascript
let widgetsCache = [];
```

- [ ] **Step 3: Populate the cache after fetching widgets**

In the `renderDashboard` function, after `const widgets = await getDashboardWidgets();`, add:

```javascript
    widgetsCache = widgets;
```

- [ ] **Step 4: Initialize SortableJS after rendering widgets**

In the `renderDashboard` function, after all charts are rendered (after the `for...await renderWidgetChart` loop around line 980), add:

```javascript
    // Initialize SortableJS for drag-and-drop reordering
    const grid = document.querySelector('.dashboard-grid');
    if (grid && typeof Sortable !== 'undefined') {
        // Destroy existing instance if present
        if (grid._sortable) {
            grid._sortable.destroy();
        }

        grid._sortable = Sortable.create(grid, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onEnd: function(evt) {
                // Get the new order from DOM
                const newOrder = [];
                grid.querySelectorAll('.widget').forEach(el => {
                    const id = el.getAttribute('data-widget-id');
                    if (id) newOrder.push(id);
                });

                if (newOrder.length > 0) {
                    reorderWidgets(newOrder);
                }
            }
        });
    }
```

- [ ] **Step 5: Add SortableJS CSS classes**

Add these styles to `static/style.css` (after the resize handle styles):

```css
/* SortableJS drag styles */
.dashboard-grid .sortable-ghost {
    opacity: 0.4;
    background: var(--card-bg);
    border: 2px dashed var(--border-color);
}

.dashboard-grid .sortable-chosen {
    box-shadow: 0 8px 16px var(--shadow-color);
}

.dashboard-grid .sortable-drag {
    opacity: 0.9;
}
```

- [ ] **Step 6: Commit**

```bash
git add static/dashboard.js static/style.css
git commit -m "feat: add drag-and-drop reordering with SortableJS"
```

---

### Task 9: Implement interact.js chart resize

**Files:**
- Modify: `static/dashboard.js`
- Modify: `static/style.css`

- [ ] **Step 1: Add resize handle to widget-chart HTML**

In the `renderDashboard` function, find the widget-chart div:

```html
<div class="widget-chart">
    <canvas id="${widget.id}"></canvas>
</div>
```

Add a resize handle inside it:

```html
<div class="widget-chart">
    <canvas id="${widget.id}"></canvas>
    <div class="widget-chart-resize-handle"></div>
</div>
```

- [ ] **Step 2: Apply saved chart height to canvas**

In the `renderDashboard` function, after setting the HTML and before rendering charts, apply the saved chart height to each canvas:

```javascript
    // Apply saved chart heights
    widgets.forEach(widget => {
        const canvas = document.getElementById(widget.id);
        if (canvas && widget.chart_height) {
            canvas.parentElement.style.height = widget.chart_height + 'px';
        }
    });
```

- [ ] **Step 3: Initialize interact.js resize on each chart**

After the chart rendering loop (after the `for...await renderWidgetChart` loop), add:

```javascript
    // Initialize interact.js resize handles
    if (typeof interact !== 'undefined') {
        widgets.forEach(widget => {
            const chartContainer = document.querySelector(`.widget[data-widget-id="${widget.id}"] .widget-chart`);
            if (!chartContainer) return;

            interact(chartContainer).resizable({
                edges: { bottom: true, left: false, right: false, top: false },
                listeners: {
                    move: function(event) {
                        const newHeight = Math.round(event.rect.height);
                        const clampedHeight = Math.max(150, Math.min(800, newHeight));
                        event.target.style.height = clampedHeight + 'px';
                        const canvas = chartContainer.querySelector('canvas');
                        if (canvas) {
                            canvas.style.height = clampedHeight + 'px';
                        }
                    }
                },
                modifiers: [
                    interact.modifiers.restrictSize({
                        min: { width: 0, height: 150 },
                        max: { width: 0, height: 800 }
                    })
                ],
                inertia: false
            });
        });
    }
```

- [ ] **Step 4: Save chart height on resize stop**

Extend the interact.js resize setup to save on stop. Replace the `listeners` section:

```javascript
                listeners: {
                    move: function(event) {
                        const newHeight = Math.round(event.rect.height);
                        const clampedHeight = Math.max(150, Math.min(800, newHeight));
                        event.target.style.height = clampedHeight + 'px';
                        const canvas = chartContainer.querySelector('canvas');
                        if (canvas) {
                            canvas.style.height = clampedHeight + 'px';
                        }
                    }
                },
                onend: function(event) {
                    const newHeight = Math.round(event.target.getBoundingClientRect().height);
                    const clampedHeight = Math.max(150, Math.min(800, newHeight));
                    event.target.style.height = clampedHeight + 'px';

                    // Save chart height to server
                    const w = widgetsCache.find(w => w.id === widget.id);
                    if (w) {
                        w.chart_height = clampedHeight;
                        w.updated_at = new Date().toISOString();
                        fetch(`/api/widgets/${widget.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(w)
                        }).catch(e => console.error('Failed to save chart height:', e));
                    }
                }
```

- [ ] **Step 5: Commit**

```bash
git add static/dashboard.js static/style.css
git commit -m "feat: add drag-to-resize chart heights with interact.js"
```

---

### Task 10: Run full build and test suite

**Files:**
- All modified files

- [ ] **Step 1: Run backend build**

Run: `cargo build`
Expected: Clean build with no errors or warnings related to our changes.

- [ ] **Step 2: Run all backend tests**

Run: `cargo test`
Expected: All tests pass, including the new `widget_layout_test` tests.

- [ ] **Step 3: Verify frontend loads**

Start the dev server: `cargo run`
Expected: Server starts successfully on port 8080.

- [ ] **Step 4: Manual verification**

Open `http://localhost:8080/dashboard` in a browser:
- Verify widgets load in `display_order` order
- Verify width selector dropdown appears in settings
- Verify width changes update the grid span
- Verify drag-and-drop reordering works
- Verify drag-to-resize works within bounds (150-800px)
- Refresh the page and verify all settings persist

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: add widget layout features - reorder, resize, and configurable width"
```
