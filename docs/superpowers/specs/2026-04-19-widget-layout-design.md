# Widget Layout Design

## Overview

Add reordering, resizing, and configurable width to dashboard widgets. Users can drag widgets to reorder them, drag chart edges to resize heights, and set per-widget widths from 1-12 columns on a 12-column grid. All changes persist to the database.

## Requirements

- **Drag-and-drop reordering**: Reorder widgets by dragging them in the grid
- **Drag-to-resize charts**: Resize chart canvas heights by dragging the bottom edge
- **Per-widget width selector**: Set each widget to span 1-12 columns, with quick presets (Full/12, Half/6, Third/4, Quarter/3) and a custom option
- **Database persistence**: All layout changes saved to the widget record, restored on page load

## Decisions

### Library Choice: SortableJS + interact.js
- SortableJS for drag-and-drop reordering (polished, lightweight, well-maintained)
- interact.js for drag-to-resize (mature library with good touch support)
- Trade-off: Adds ~80KB to the bundle, but saves significant custom code and provides better UX than native APIs

### Grid: Fixed 12-column CSS Grid
- Replace `repeat(auto-fill, minmax(400px, 1fr))` with `repeat(12, 1fr)`
- Each widget uses `grid-column: span N` based on its `width` setting
- Default width: 12 (full row)

### Persistence: Database-backed
- Three new integer columns on the `widgets` table
- No localStorage needed -- the database is the source of truth
- Backward compatible: existing widgets get sensible defaults

## Data Model

### New database columns

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `display_order` | INTEGER | 0 | Sort position (0 = first). Recalculated on reorder. |
| `width` | INTEGER | 12 | Grid column span (1-12). |
| `chart_height` | INTEGER | 300 | Chart canvas height in pixels. |

### Rust model changes (`src/models/widget.rs`)

Add to `Widget` struct:
```rust
pub display_order: i32,
pub width: i32,
pub chart_height: i32,
```

All fields use `#[serde(default)]` for backward compatibility with existing DB records.

### Database migration

Single migration adding all three columns:
```sql
ALTER TABLE widgets ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE widgets ADD COLUMN width INTEGER NOT NULL DEFAULT 12;
ALTER TABLE widgets ADD COLUMN chart_height INTEGER NOT NULL DEFAULT 300;
```

Existing widgets get defaults. The `list_widgets` query changes from `ORDER BY created_at DESC` to `ORDER BY display_order ASC, created_at DESC`.

## Frontend Design

### Libraries (CDN)

```html
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/interactjs@1.19.0/dist/interact.min.js"></script>
```

### Drag-and-drop reordering (SortableJS)

- The `.dashboard-grid` container is initialized with `Sortable.create()`
- `onEnd` event handler computes new order from DOM positions
- Sends a batch update to recalculate `display_order` for affected widgets
- SortableJS provides visual feedback (ghost element, drag placeholder) automatically

### Per-widget width selector

- Added to the existing widget settings panel (collapsible)
- Dropdown with presets: "Full (12)" | "Half (6)" | "Third (4)" | "Quarter (3)" | "Custom..."
- "Custom" opens a number input (1-12)
- On change: immediately update `data-cols` attribute on the widget card, which triggers CSS `grid-column: span N`
- Save via existing PUT `/api/widgets/{id}` endpoint

### Chart resize (interact.js)

- Each `.widget-chart` container gets an interact.js resize handler
- Resize only on the bottom edge (height only, no width resize)
- Range: 150px - 800px
- On `resizestop`: update canvas height inline, save `chart_height` via PUT
- Visual: subtle resize handle indicator at bottom-right of chart container

## Backend Design

### Storage layer (`src/storage/mod.rs`)

- `init_db()`: Add three new columns with defaults
- `create_widget()`: Auto-assign `display_order` to max existing + 1 (or 0 if none)
- `update_widget()`: Accept and store `display_order`, `width`, `chart_height`
- `list_widgets()`: Change ORDER BY to `display_order ASC, created_at DESC`

### API handler (`src/handlers/widget.rs`)

- `create_widget`: Auto-assign `display_order`
- `update_widget`: Accept the three new fields in the JSON body
- No new endpoints needed -- existing PUT handles all updates

### Rust model (`src/models/widget.rs`)

- Add three new fields with `#[serde(default)]`
- Add `#[serde(skip_serializing_if = "is_default")]` to avoid sending defaults in API responses

## CSS Design

### Grid layout

Replace current `.dashboard-grid`:
```css
.dashboard-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 1.5rem;
    margin-top: 1.5rem;
}

.dashboard-grid .widget {
    grid-column: span 12;
}

.dashboard-grid .widget[data-cols="6"]  { grid-column: span 6; }
.dashboard-grid .widget[data-cols="4"]  { grid-column: span 4; }
.dashboard-grid .widget[data-cols="3"]  { grid-column: span 3; }
.dashboard-grid .widget[data-cols="2"]  { grid-column: span 2; }
.dashboard-grid .widget[data-cols="1"]  { grid-column: span 1; }
```

### Resize handle

```css
.widget-chart {
    position: relative;
}

.widget-chart::after {
    content: '';
    position: absolute;
    bottom: 0; right: 0;
    width: 16px; height: 16px;
    cursor: ns-resize;
    background: linear-gradient(135deg, transparent 50%, var(--text-muted) 50%);
}
```

## Files to modify

1. `src/models/widget.rs` -- Add three new fields
2. `src/storage/mod.rs` -- Migration, new fields in CRUD operations, reorder query
3. `src/handlers/widget.rs` -- Accept new fields in create/update
4. `static/dashboard.html` -- Add CDN script tags for SortableJS and interact.js
5. `static/dashboard.js` -- SortableJS init, interact.js resize, width selector UI, order update logic
6. `static/style.css` -- New grid layout, resize handle, widget width spans

## Testing

### Backend
- Test that new fields serialize/deserialize correctly with `#[serde(default)]`
- Test that `list_widgets` returns widgets in correct order
- Test that `create_widget` auto-assigns `display_order`
- Test migration runs without error on existing databases

### Frontend
- Test that SortableJS reorder triggers correct API calls
- Test that interact.js resize stays within bounds (150-800px)
- Test that width selector updates CSS grid span correctly
- Test that settings are persisted and restored on page reload
