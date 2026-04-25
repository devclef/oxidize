# Account Groups Design

## Overview

Allow users to create named groups of accounts that appear as a single line on balance history charts. Groups let users compare aggregated account sets (e.g., "all credit cards" vs "checking/savings") alongside individual accounts.

## Architecture

Groups are stored as named lists of account IDs in the existing SQLite storage layer. The backend returns per-account data as usual; the frontend aggregates member account data into group lines when rendering charts. No backend-side aggregation is needed.

## Data Model

### `Group` struct (`src/models/group.rs`)

```rust
pub struct Group {
    id: String,          // UUID
    name: String,        // Display name (e.g., "Credit Cards")
    account_ids: Vec<String>, // Firefly III account IDs in this group
    created_at: Option<String>,
    updated_at: Option<String>,
}
```

Same serialization pattern as `Widget` — JSON stored in SQLite via rusqlite.

## Storage Layer

### Changes to `src/storage/mod.rs`

Add group CRUD methods alongside existing widget methods:

- `list_groups() -> Result<Vec<Group>>`
- `create_group(group: &Group) -> Result<Group>`
- `update_group(id: &str, group: &Group) -> Result<Group>`
- `delete_group(id: &str) -> Result<()>`

Uses the same SQLite connection and error handling patterns as widgets.

## Backend API

### New file: `src/handlers/group.rs`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | List all groups |
| POST | `/api/groups` | Create a group (body: `{name, account_ids}`) |
| PUT | `/api/groups/{id}` | Update a group (rename, add/remove accounts) |
| DELETE | `/api/groups/{id}` | Delete a group |

Register routes in `src/handlers/mod.rs` alongside widget routes.

### No changes to existing endpoints

The balance-history, accounts, and other endpoints remain unchanged. They continue to return per-account data.

## Frontend UI

### "My Groups" section

A new section above the account list in `index.html`:

```html
<div id="groups-section">
    <div class="section-header">
        <h3>My Groups</h3>
        <button id="create-group-btn">+ Create Group</button>
    </div>
    <div id="groups-list"></div>
</div>
```

Each group item shows:
- Checkbox (toggles all member accounts when checked)
- Group name
- Member count (e.g., "3 accounts")
- Edit and delete icons

### Group creation flow

1. User clicks "+ Create Group"
2. Modal appears with:
   - Name input field
   - Account list (pre-populated with fetched accounts) with checkboxes
3. User names the group and selects member accounts
4. On save: POST to `/api/groups`, re-render group list

### Group editing/deletion

- Edit: Click edit icon → modal pre-populated with current group data → PUT to `/api/groups/{id}`
- Delete: Click delete icon → confirm dialog → DELETE to `/api/groups/{id}`

### Group selection in chart

When a group checkbox is checked:
1. Frontend collects all member account IDs
2. Marks them as "from group X" for later aggregation
3. Also checks the individual account checkboxes (so they appear selected)

When fetching chart data, the frontend sends all selected account IDs (individual + group members, deduplicated) to the balance-history endpoint.

## Chart Integration

### Combined mode

No changes needed. All selected accounts are aggregated into one line regardless of group membership.

### Split mode

When rendering split mode:
1. Frontend groups datasets by their source (individual account or group)
2. For group datasets: aggregate all member account data points by summing values at each time step
3. Group anchor balance = sum of member account `current_balance` values
4. Each group renders as one line labeled with the group name
5. Individual accounts and groups can be mixed on the same chart

Example: If "Credit Cards" group has Chase CC ($2000 balance) and Amex CC ($1500 balance), the group line shows the sum of both accounts' balance histories, labeled "Credit Cards", with anchor $3500.

### Data flow for split mode with groups

```
User checks "Credit Cards" group + "Checking" account
  → Frontend collects account IDs: [cc1, cc2, checking1]
  → Sends to /api/accounts/balance-history?accounts[]=cc1&accounts[]=cc2&accounts[]=checking1
  → Backend returns 3 datasets (one per account)
  → Frontend matches datasets to accounts by name/ID
  → For cc1 and cc2: sums data points → "Credit Cards" line
  → For checking1: uses directly → "Checking" line
  → Renders 2 lines in split mode
```

## Error Handling

- Empty group (no accounts): prevent creation, show error
- Group with deleted accounts: silently exclude orphaned account IDs on fetch
- API failure: show error toast, same pattern as widget save failures

## Testing

### Backend
- `cargo test`: CRUD operations for groups in SQLite
- Test empty group rejection
- Test group deletion cascades

### Frontend
- `npm test`: group creation, selection, chart rendering
- Test group checkbox toggles member accounts
- Test split mode aggregation produces correct summed values

## Files Changed

| File | Change |
|------|--------|
| `src/models/group.rs` | **New** - Group struct |
| `src/models/mod.rs` | Add `pub mod group;` |
| `src/storage/mod.rs` | Add group CRUD methods |
| `src/handlers/group.rs` | **New** - group API handlers |
| `src/handlers/mod.rs` | Register group routes |
| `static/index.html` | Add "My Groups" section + modal |
| `static/app.js` | Group management + chart aggregation logic |
| `static/style.css` | Group section styles |
| `static/app.test.js` | Group-related tests |
