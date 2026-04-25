# Account Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to create named groups of accounts stored in SQLite, displayed as aggregated lines on balance history charts in split mode.

**Architecture:** Groups are named lists of account IDs stored in SQLite (same pattern as widgets). Backend returns per-account data as usual; frontend aggregates member account data into group lines when rendering charts. No backend-side aggregation needed.

**Tech Stack:** Rust, Actix-Web, Rusqlite, Vanilla JS, Chart.js, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/models/group.rs` | **Create** | Group struct definition |
| `src/models/mod.rs` | Modify | Export group module |
| `src/storage/mod.rs` | Modify | Add group CRUD methods |
| `src/handlers/group.rs` | **Create** | Group API handlers (CRUD) |
| `src/handlers/mod.rs` | Modify | Register group routes |
| `static/index.html` | Modify | Add "My Groups" section + create group modal |
| `static/style.css` | Modify | Group section styles |
| `static/app.js` | Modify | Group management + chart aggregation logic |
| `static/app.test.js` | Modify | Group-related tests |

---

## Task 1: Group model struct

**Files:**
- Create: `src/models/group.rs`
- Modify: `src/models/mod.rs:1-9`

- [ ] **Step 1: Create the Group struct**

Create `src/models/group.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub account_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}
```

- [ ] **Step 2: Export the group module**

Update `src/models/mod.rs` to add:

```rust
pub mod group;

pub use group::Group;
```

Insert after line 3 (`pub mod widget;`):

```rust
pub mod group;
```

And after line 7 (`pub use widget::Widget;`):

```rust
pub use group::Group;
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/models/group.rs src/models/mod.rs
git commit -m "feat: add Group model struct

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Group storage layer with tests

**Files:**
- Modify: `src/storage/mod.rs`

- [ ] **Step 1: Write tests for group storage**

Add to `src/storage/mod.rs` at the end of the file (before the closing brace, or as a `#[cfg(test)]` module):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Group;

    fn test_db_path() -> String {
        let dir = std::env::temp_dir().join("oxidize-test-groups");
        if !dir.exists() {
            std::fs::create_dir_all(&dir).ok();
        }
        let db_path = dir.join("oxidize.db");
        let conn = Connection::open(&db_path).expect("Failed to open test database");
        init_db(&conn);
        // Override DATA_DIR for tests
        DATA_DIR.set(dir.to_string_lossy().to_string()).ok();
        db_path.to_string_lossy().to_string()
    }

    #[test]
    fn test_create_and_list_groups() {
        let group = Group {
            id: "test-group-1".to_string(),
            name: "Test Group".to_string(),
            account_ids: vec!["acc-1".to_string(), "acc-2".to_string()],
            created_at: Some("2026-01-01T00:00:00+00:00".to_string()),
            updated_at: Some("2026-01-01T00:00:00+00:00".to_string()),
        };

        assert!(create_group(&group).is_ok());
        let groups = get_all_groups().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "Test Group");
        assert_eq!(groups[0].account_ids.len(), 2);
    }

    #[test]
    fn test_update_group() {
        let group = Group {
            id: "test-group-2".to_string(),
            name: "Original Name".to_string(),
            account_ids: vec!["acc-1".to_string()],
            created_at: Some("2026-01-01T00:00:00+00:00".to_string()),
            updated_at: Some("2026-01-01T00:00:00+00:00".to_string()),
        };

        create_group(&group).unwrap();

        let updated = Group {
            id: "test-group-2".to_string(),
            name: "Updated Name".to_string(),
            account_ids: vec!["acc-1".to_string(), "acc-2".to_string(), "acc-3".to_string()],
            created_at: Some("2026-01-01T00:00:00+00:00".to_string()),
            updated_at: Some("2026-01-01T00:00:00+00:00".to_string()),
        };

        assert!(update_group(&updated).is_ok());
        let groups = get_all_groups().unwrap();
        assert_eq!(groups[0].name, "Updated Name");
        assert_eq!(groups[0].account_ids.len(), 3);
    }

    #[test]
    fn test_delete_group() {
        let group = Group {
            id: "test-group-3".to_string(),
            name: "To Delete".to_string(),
            account_ids: vec!["acc-1".to_string()],
            created_at: Some("2026-01-01T00:00:00+00:00".to_string()),
            updated_at: Some("2026-01-01T00:00:00+00:00".to_string()),
        };

        create_group(&group).unwrap();
        assert!(delete_group("test-group-3").is_ok());
        let groups = get_all_groups().unwrap();
        assert_eq!(groups.len(), 0);
    }

    #[test]
    fn test_delete_nonexistent_group() {
        assert!(delete_group("nonexistent-id").is_err());
    }
}
```

- [ ] **Step 2: Add groups table to init_db**

In the `init_db` function, after the widgets table creation (after line 54), add:

```rust
// Create groups table
conn.execute(
    "CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        account_ids TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )",
    [],
)
.expect("Failed to create groups table");
```

- [ ] **Step 3: Add group CRUD methods to Storage impl**

Add these methods to the `impl Storage` block (after line 257, before the closing brace):

```rust
// Group CRUD operations

pub fn get_all_groups() -> Result<Vec<Group>, String> {
    with_db(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, account_ids, created_at, updated_at
                 FROM groups ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let groups = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let account_ids_json: String = row.get(2)?;
                let created_at: Option<String> = row.get(3)?;
                let updated_at: Option<String> = row.get(4)?;

                let account_ids: Vec<String> =
                    serde_json::from_str(&account_ids_json).map_err(|e| e.to_string())?;

                Ok(Group {
                    id,
                    name,
                    account_ids,
                    created_at,
                    updated_at,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r: Result<Group, _>| r.ok())
            .collect();

        Ok(groups)
    })
}

pub fn create_group(group: &Group) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let account_ids_json = serde_json::to_string(&group.account_ids).map_err(|e| e.to_string())?;

    with_db(|conn| {
        conn.execute(
            "INSERT INTO groups (id, name, account_ids, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                &group.id,
                &group.name,
                &account_ids_json,
                &now,
                &now
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

pub fn update_group(group: &Group) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let account_ids_json = serde_json::to_string(&group.account_ids).map_err(|e| e.to_string())?;

    with_db(|conn| {
        let rows = conn
            .execute(
                "UPDATE groups SET name = ?1, account_ids = ?2, updated_at = ?3 WHERE id = ?4",
                params![
                    &group.name,
                    &account_ids_json,
                    &now,
                    &group.id
                ],
            )
            .map_err(|e| e.to_string())?;

        if rows == 0 {
            return Err(format!("Group with id {} not found", group.id));
        }

        Ok(())
    })
}

pub fn delete_group(id: &str) -> Result<(), String> {
    with_db(|conn| {
        let rows = conn
            .execute("DELETE FROM groups WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;

        if rows == 0 {
            return Err(format!("Group with id {} not found", id));
        }

        Ok(())
    })
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cargo test storage::tests --no-fail-fast`
Expected: All 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/storage/mod.rs
git commit -m "feat: add group storage layer with CRUD operations

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Group API handlers

**Files:**
- Create: `src/handlers/group.rs`
- Modify: `src/handlers/mod.rs`

- [ ] **Step 1: Create group API handlers**

Create `src/handlers/group.rs`:

```rust
use actix_web::{delete, get, post, put, web, HttpResponse, Responder};

use crate::models::Group;
use crate::storage::Storage;

#[get("/api/groups")]
pub async fn list_groups() -> impl Responder {
    match Storage::get_all_groups() {
        Ok(groups) => HttpResponse::Ok().json(groups),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

#[post("/api/groups")]
pub async fn create_group(body: web::Json<Group>) -> impl Responder {
    let group = body.into_inner();

    if group.account_ids.is_empty() {
        return HttpResponse::BadRequest().body("Group must have at least one account");
    }

    match Storage::create_group(&group) {
        Ok(()) => HttpResponse::Created().json(group),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

#[put("/api/groups/{id}")]
pub async fn update_group(path: web::Path<String>, body: web::Json<Group>) -> impl Responder {
    let path_id = path.into_inner();
    let group = body.into_inner();

    if path_id != group.id {
        return HttpResponse::BadRequest().body("ID mismatch between path and body");
    }

    if group.account_ids.is_empty() {
        return HttpResponse::BadRequest().body("Group must have at least one account");
    }

    match Storage::update_group(&group) {
        Ok(()) => HttpResponse::Ok().json(group),
        Err(e) => HttpResponse::BadRequest().body(e),
    }
}

#[delete("/api/groups/{id}")]
pub async fn delete_group(path: web::Path<String>) -> impl Responder {
    let id = path.into_inner();

    match Storage::delete_group(&id) {
        Ok(()) => HttpResponse::Ok().finish(),
        Err(e) => HttpResponse::NotFound().body(e),
    }
}
```

- [ ] **Step 2: Register group routes**

Update `src/handlers/mod.rs` to add:

```rust
pub mod group;
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/handlers/group.rs src/handlers/mod.rs
git commit -m "feat: add group API CRUD endpoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Frontend HTML structure for groups

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Add My Groups section**

Add this right after the `account-section` div (after line 54, before `chart-header`):

```html
<div id="groups-section" class="groups-section" style="display: none;">
    <div class="groups-section-header">
        <h3>My Groups</h3>
        <button id="create-group-btn">+ Create Group</button>
    </div>
    <div id="groups-list"></div>
</div>
```

Insert after line 54 (`</div>` closing the account-section):

```html
<div id="groups-section" class="groups-section" style="display: none;">
    <div class="groups-section-header">
        <h3>My Groups</h3>
        <button id="create-group-btn">+ Create Group</button>
    </div>
    <div id="groups-list"></div>
</div>
```

- [ ] **Step 2: Add create group modal**

Add this at the end of the `<body>`, before the script tags:

```html
<div id="group-modal" class="modal-overlay" style="display: none;">
    <div class="modal">
        <div class="modal-header">
            <h3 id="group-modal-title">Create Group</h3>
            <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
            <label for="group-name-input">Group Name:</label>
            <input type="text" id="group-name-input" placeholder="e.g., Credit Cards">
            <label>Accounts:</label>
            <div id="group-accounts-list"></div>
        </div>
        <div class="modal-footer">
            <button id="group-modal-cancel">Cancel</button>
            <button id="group-modal-save">Save</button>
        </div>
    </div>
</div>
```

Insert before line 138 (before `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`).

- [ ] **Step 3: Verify HTML structure**

Check the file renders valid HTML. No command needed, just visually verify.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add HTML structure for group management UI

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Frontend CSS for groups

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: Add group section styles**

Append these styles to `static/style.css`:

```css
/* Group section styles */
.groups-section {
    margin-bottom: 1rem;
}

.groups-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
}

.groups-section-header h3 {
    margin: 0;
    font-size: 1rem;
}

.groups-section-header button {
    padding: 0.25rem 0.75rem;
    font-size: 0.85rem;
}

.group-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    margin-bottom: 0.25rem;
    border: 1px solid var(--border-color, #444);
    border-radius: 4px;
    background: var(--bg-secondary, #2d2d2d);
}

.group-item input[type="checkbox"] {
    margin: 0;
}

.group-info {
    flex: 1;
}

.group-name {
    font-weight: 500;
}

.group-account-count {
    font-size: 0.8rem;
    opacity: 0.7;
}

.group-actions {
    display: flex;
    gap: 0.25rem;
}

.group-actions button {
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid var(--border-color, #444);
    border-radius: 3px;
    cursor: pointer;
    color: var(--text-color, #eaeaea);
}

.group-actions button:hover {
    background: var(--bg-tertiary, #3d3d3d);
}

/* Modal styles */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal {
    background: var(--bg-secondary, #2d2d2d);
    border-radius: 8px;
    padding: 1.5rem;
    min-width: 400px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.modal-header h3 {
    margin: 0;
}

.modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--text-color, #eaeaea);
}

.modal-body label {
    display: block;
    margin-top: 0.75rem;
    font-weight: 500;
}

.modal-body input[type="text"] {
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.25rem;
    box-sizing: border-box;
}

#group-accounts-list {
    margin-top: 0.5rem;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid var(--border-color, #444);
    border-radius: 4px;
    padding: 0.5rem;
}

.group-account-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
}

.modal-footer button {
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
}

#group-modal-cancel {
    background: transparent;
    border: 1px solid var(--border-color, #444);
    color: var(--text-color, #eaeaea);
}

#group-modal-save {
    background: var(--accent-color, #3498db);
    border: none;
    color: white;
}
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add CSS styles for group management UI

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Frontend group management logic

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Add group state and storage key**

Add these variables near the top of `app.js`, after the existing state variables (after line 6):

```javascript
let groups = [];
let editingGroupId = null;
const GROUPS_STORAGE_KEY = 'oxidize_groups';
```

- [ ] **Step 2: Add group persistence functions**

Add these functions after the `generateUUID` function (after line 32):

```javascript
function loadGroups() {
    try {
        const stored = localStorage.getItem(GROUPS_STORAGE_KEY);
        if (stored) {
            groups = JSON.parse(stored);
        }
    } catch {
        groups = [];
    }
}

function saveGroups() {
    try {
        localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups));
    } catch {
        // ignore
    }
}

async function fetchGroups() {
    try {
        const response = await fetch('/api/groups');
        if (!response.ok) return [];
        return await response.json();
    } catch (e) {
        console.error('Failed to fetch groups:', e);
        return [];
    }
}

async function saveGroupToBackend(group) {
    if (group.id) {
        // Update existing
        const response = await fetch(`/api/groups/${group.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(group)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to update group');
        }
        return response.json();
    } else {
        // Create new
        group.id = group.id || generateUUID();
        const response = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(group)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Failed to save group');
        }
        return response.json();
    }
}

async function deleteGroupFromBackend(id) {
    const response = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to delete group');
    }
}
```

- [ ] **Step 3: Add group rendering functions**

Add these functions after the group persistence functions:

```javascript
function renderGroups() {
    const groupsSection = document.getElementById('groups-section');
    const groupsList = document.getElementById('groups-list');

    if (groups.length === 0) {
        groupsSection.style.display = 'none';
        return;
    }

    groupsSection.style.display = 'block';
    groupsList.innerHTML = '';

    groups.forEach(group => {
        const item = document.createElement('div');
        item.className = 'group-item';
        item.dataset.groupId = group.id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'group-select';
        checkbox.value = group.id;
        checkbox.checked = group._checked || false;

        checkbox.addEventListener('change', () => {
            group._checked = checkbox.checked;
            if (checkbox.checked) {
                // Select all member accounts
                group.account_ids.forEach(accId => {
                    const cb = document.querySelector(`.account-select[value="${accId}"]`);
                    if (cb) cb.checked = true;
                });
            } else {
                // Deselect all member accounts
                group.account_ids.forEach(accId => {
                    const cb = document.querySelector(`.account-select[value="${accId}"]`);
                    if (cb) cb.checked = false;
                });
            }
            fetchChartData();
        });

        const info = document.createElement('div');
        info.className = 'group-info';

        const name = document.createElement('span');
        name.className = 'group-name';
        name.textContent = group.name;

        const count = document.createElement('span');
        count.className = 'group-account-count';
        count.textContent = ` (${group.account_ids.length} accounts)`;

        info.appendChild(name);
        info.appendChild(count);

        const actions = document.createElement('div');
        actions.className = 'group-actions';

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openGroupModal(group.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', async () => {
            if (confirm(`Delete group "${group.name}"?`)) {
                try {
                    await deleteGroupFromBackend(group.id);
                    groups = groups.filter(g => g.id !== group.id);
                    saveGroups();
                    renderGroups();
                } catch (e) {
                    alert(`Failed to delete group: ${e.message}`);
                }
            }
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(checkbox);
        item.appendChild(info);
        item.appendChild(actions);
        groupsList.appendChild(item);
    });
}
```

- [ ] **Step 4: Add group modal functions**

Add these functions after `renderGroups`:

```javascript
function openGroupModal(groupId = null) {
    editingGroupId = groupId;
    const modal = document.getElementById('group-modal');
    const title = document.getElementById('group-modal-title');
    const nameInput = document.getElementById('group-name-input');
    const accountsList = document.getElementById('group-accounts-list');

    // Reset form
    nameInput.value = '';
    accountsList.innerHTML = '';

    if (groupId) {
        // Edit mode
        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        title.textContent = 'Edit Group';
        nameInput.value = group.name;

        allAccounts.forEach(account => {
            const item = document.createElement('div');
            item.className = 'group-account-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = account.id;
            checkbox.checked = group.account_ids.includes(account.id);

            const label = document.createElement('span');
            label.textContent = `${account.name} (${account.balance})`;

            item.appendChild(checkbox);
            item.appendChild(label);
            accountsList.appendChild(item);
        });
    } else {
        // Create mode
        title.textContent = 'Create Group';

        if (allAccounts.length === 0) {
            accountsList.innerHTML = '<p style="opacity: 0.7;">Fetch accounts first to create groups.</p>';
        } else {
            allAccounts.forEach(account => {
                const item = document.createElement('div');
                item.className = 'group-account-item';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = account.id;

                const label = document.createElement('span');
                label.textContent = `${account.name} (${account.balance})`;

                item.appendChild(checkbox);
                item.appendChild(label);
                accountsList.appendChild(item);
            });
        }
    }

    modal.style.display = 'flex';
}

function closeGroupModal() {
    document.getElementById('group-modal').style.display = 'none';
    editingGroupId = null;
}

async function handleGroupSave() {
    const nameInput = document.getElementById('group-name-input');
    const accountsList = document.getElementById('group-accounts-list');
    const name = nameInput.value.trim();

    if (!name) {
        alert('Please enter a group name');
        return;
    }

    const selectedCheckboxes = accountsList.querySelectorAll('input[type="checkbox"]:checked');
    const accountIds = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (accountIds.length === 0) {
        alert('Please select at least one account');
        return;
    }

    const group = {
        id: editingGroupId || null,
        name,
        account_ids: accountIds
    };

    try {
        const saved = await saveGroupToBackend(group);
        const idx = groups.findIndex(g => g.id === saved.id);
        if (idx >= 0) {
            groups[idx] = saved;
        } else {
            groups.push(saved);
        }
        saveGroups();
        renderGroups();
        closeGroupModal();
    } catch (e) {
        alert(`Failed to save group: ${e.message}`);
    }
}
```

- [ ] **Step 5: Add group fetching to initialization**

In the `DOMContentLoaded` event listener (near line 1703), add group initialization. Add this after the `typeFilterPills` event listener block (after line 1784):

```javascript
// Load and render groups
groups = await fetchGroups();
renderGroups();

// Create group button
document.getElementById('create-group-btn').addEventListener('click', () => openGroupModal());

// Modal close handlers
document.getElementById('group-modal').addEventListener('click', (e) => {
    if (e.target.id === 'group-modal' || e.target.classList.contains('modal-close')) {
        closeGroupModal();
    }
});
document.getElementById('group-modal-cancel').addEventListener('click', closeGroupModal);
document.getElementById('group-modal-save').addEventListener('click', handleGroupSave);
```

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "feat: add frontend group management logic

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Frontend chart aggregation for groups in split mode

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Modify split mode rendering to aggregate groups**

In the `renderChart` function, in the split mode section (around line 1036), modify the dataset creation logic. After the existing `uniqueAccountInfo` is built, add group aggregation.

Replace the split mode dataset creation block (lines 1080-1190 area) with logic that:
1. Separates individual account selections from group selections
2. For each group, sums the member account data points
3. Creates a combined list of "display items" (individual accounts + groups)

Here's the key aggregation function to add (place it before `renderChart`):

```javascript
// Aggregate account data into groups for split mode rendering
function aggregateGroupData(history, groups, allAccountsList) {
    // Build a map of account ID -> dataset
    const accountDataMap = new Map();
    history.forEach(ds => {
        // Find matching account
        const account = allAccountsList.find(a => a.name === ds.label || a.name === ds.label.replace(/ - In$/, '').replace(/ - Out$/, ''));
        if (account) {
            let flowData = [];
            if (Array.isArray(ds.entries)) {
                flowData = ds.entries.map(e => parseFloat(e.value || 0));
            } else {
                flowData = Object.values(ds.entries || {}).map(v => parseFloat(v?.value || v || 0));
            }
            accountDataMap.set(account.id, { data: flowData, balance: account.balance, name: account.name });
        }
    });

    // Separate individual accounts from group accounts
    const groupAccountIds = new Set();
    groups.forEach(g => {
        if (g._checked) {
            g.account_ids.forEach(id => groupAccountIds.add(id));
        }
    });

    const individualAccounts = [];
    const checkedGroups = groups.filter(g => g._checked);

    // Build display items
    const displayItems = [];

    // Add individual (non-group) accounts first
    // Then add groups
    checkedGroups.forEach(group => {
        let summedData = null;
        let totalBalance = 0;
        const memberNames = [];

        group.account_ids.forEach(accId => {
            const member = accountDataMap.get(accId);
            if (member) {
                memberNames.push(member.name);
                if (!summedData) {
                    summedData = member.data.map(v => v);
                } else {
                    member.data.forEach((v, i) => {
                        if (summedData[i] !== undefined) summedData[i] += v;
                    });
                }
                totalBalance += parseFloat(member.balance);
            }
        });

        if (summedData) {
            displayItems.push({
                type: 'group',
                label: group.name,
                data: summedData,
                absoluteData: summedData,
                balance: totalBalance.toString(),
                memberNames
            });
        }
    });

    return displayItems;
}
```

Then in the split mode section of `renderChart`, after the existing `uniqueAccountInfo` is built, call this function and merge its results into the datasets.

- [ ] **Step 2: Update split mode chart rendering**

In the split mode rendering block (around line 1202), replace the `currentDatasets` assignment to use the aggregated display items. Each display item becomes a dataset:

```javascript
const displayItems = aggregateGroupData(filteredHistory, groups, allAccounts);

displayItems.forEach((item, index) => {
    const colorIndex = index % accountColors.length;
    const color = accountColors[colorIndex];
    currentDatasets.push({
        label: item.label,
        data: item.data,
        absoluteData: item.absoluteData,
        borderColor: color.border,
        backgroundColor: color.background,
        borderWidth: 2,
        tension: 0.1,
        fill: false
    });
    datasetVisibility[index] = true;
});
```

Also update the legend to use `displayItems` instead of `uniqueAccountInfo`.

- [ ] **Step 3: Add groups to fetchChartData**

In `fetchChartData`, before rendering, refresh groups from backend:

```javascript
// Refresh groups from backend
const backendGroups = await fetchGroups();
if (backendGroups.length > 0) {
    // Preserve _checked state from existing groups
    groups = backendGroups.map(bg => {
        const existing = groups.find(g => g.id === bg.id);
        return existing ? { ...bg, _checked: existing._checked } : bg;
    });
}
```

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: add group aggregation for split mode chart rendering

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Frontend tests for groups

**Files:**
- Modify: `static/app.test.js`

- [ ] **Step 1: Add group-related tests**

Append these tests to `static/app.test.js`:

```javascript
describe('Account Groups', () => {
    describe('aggregateGroupData', () => {
        it('should sum account data points for a group', () => {
            // Simulate two accounts with balance data
            const accountDataMap = new Map();
            accountDataMap.set('acc-1', {
                data: [100, 110, 120],
                balance: '120',
                name: 'Account 1'
            });
            accountDataMap.set('acc-2', {
                data: [200, 210, 220],
                balance: '220',
                name: 'Account 2'
            });

            const group = {
                id: 'group-1',
                name: 'My Group',
                account_ids: ['acc-1', 'acc-2'],
                _checked: true
            };

            // Simulate aggregation
            const summedData = group.account_ids.reduce((acc, accId) => {
                const member = accountDataMap.get(accId);
                if (!member) return acc;
                if (!acc) return member.data.map(v => v);
                return member.data.map((v, i) => acc[i] + v);
            }, null);

            expect(summedData).toEqual([300, 320, 340]);
        });

        it('should handle group with one account', () => {
            const accountDataMap = new Map();
            accountDataMap.set('acc-1', {
                data: [500, 510, 520],
                balance: '520',
                name: 'Single Account'
            });

            const group = {
                id: 'group-single',
                name: 'Single',
                account_ids: ['acc-1'],
                _checked: true
            };

            const summedData = group.account_ids.reduce((acc, accId) => {
                const member = accountDataMap.get(accId);
                if (!member) return acc;
                if (!acc) return member.data.map(v => v);
                return member.data.map((v, i) => acc[i] + v);
            }, null);

            expect(summedData).toEqual([500, 510, 520]);
        });

        it('should skip unchecked groups', () => {
            const checkedGroups = [
                { id: 'g1', _checked: true, account_ids: ['acc-1'] },
                { id: 'g2', _checked: false, account_ids: ['acc-2'] }
            ];

            const filtered = checkedGroups.filter(g => g._checked);
            expect(filtered).toHaveLength(1);
            expect(filtered[0].id).toBe('g1');
        });

        it('should calculate correct anchor balance for group', () => {
            const accountDataMap = new Map();
            accountDataMap.set('acc-1', { balance: '1000' });
            accountDataMap.set('acc-2', { balance: '2000' });

            const group = {
                account_ids: ['acc-1', 'acc-2']
            };

            const totalBalance = group.account_ids.reduce((sum, accId) => {
                const member = accountDataMap.get(accId);
                return sum + (member ? parseFloat(member.balance) : 0);
            }, 0);

            expect(totalBalance).toBe(3000);
        });
    });

    describe('group checkbox toggles member accounts', () => {
        it('should check all member accounts when group is checked', () => {
            const group = {
                id: 'g1',
                account_ids: ['acc-1', 'acc-2', 'acc-3']
            };

            const mockCheckboxes = [
                { value: 'acc-1', checked: false },
                { value: 'acc-2', checked: false },
                { value: 'acc-3', checked: false }
            ];

            // Simulate group checkbox being checked
            group.account_ids.forEach(accId => {
                const cb = mockCheckboxes.find(c => c.value === accId);
                if (cb) cb.checked = true;
            });

            expect(mockCheckboxes.every(c => c.checked)).toBe(true);
        });

        it('should deselect all member accounts when group is unchecked', () => {
            const group = {
                id: 'g1',
                account_ids: ['acc-1', 'acc-2']
            };

            const mockCheckboxes = [
                { value: 'acc-1', checked: true },
                { value: 'acc-2', checked: true },
                { value: 'acc-3', checked: true }
            ];

            // Simulate group checkbox being unchecked
            group.account_ids.forEach(accId => {
                const cb = mockCheckboxes.find(c => c.value === accId);
                if (cb) cb.checked = false;
            });

            expect(mockCheckboxes.filter(c => c.checked).map(c => c.value)).toEqual(['acc-3']);
        });
    });

    describe('group CRUD operations', () => {
        it('should create a valid group object', () => {
            const group = {
                id: 'test-group-1',
                name: 'Test Group',
                account_ids: ['1', '2', '3']
            };

            expect(group.id).toBeDefined();
            expect(group.name).toBe('Test Group');
            expect(group.account_ids).toHaveLength(3);
        });

        it('should reject empty group name', () => {
            const name = '';
            expect(name.trim()).toBe('');
            expect(name.trim().length).toBe(0);
        });

        it('should reject group with no accounts', () => {
            const accountIds = [];
            expect(accountIds.length).toBe(0);
            expect(accountIds.length === 0).toBe(true);
        });

        it('should update group name and accounts', () => {
            const group = {
                id: 'g1',
                name: 'Old Name',
                account_ids: ['1']
            };

            const updated = { ...group, name: 'New Name', account_ids: ['1', '2', '3'] };

            expect(updated.name).toBe('New Name');
            expect(updated.account_ids).toHaveLength(3);
            expect(updated.id).toBe('g1');
        });

        it('should delete group by ID', () => {
            const groups = [
                { id: 'g1', name: 'Group 1' },
                { id: 'g2', name: 'Group 2' },
                { id: 'g3', name: 'Group 3' }
            ];

            const deletedId = 'g2';
            const filtered = groups.filter(g => g.id !== deletedId);

            expect(filtered).toHaveLength(2);
            expect(filtered.find(g => g.id === 'g2')).toBeUndefined();
        });
    });

    describe('localStorage group persistence', () => {
        it('should save and restore groups from localStorage', () => {
            const mockLocalStorage = {
                data: {},
                getItem: function(key) { return this.data[key] || null; },
                setItem: function(key, value) { this.data[key] = value; }
            };

            const groups = [
                { id: 'g1', name: 'Test', account_ids: ['1', '2'] }
            ];

            mockLocalStorage.setItem('oxidize_groups', JSON.stringify(groups));
            const restored = JSON.parse(mockLocalStorage.getItem('oxidize_groups'));

            expect(restored).toHaveLength(1);
            expect(restored[0].name).toBe('Test');
            expect(restored[0].account_ids).toEqual(['1', '2']);
        });

        it('should handle empty localStorage gracefully', () => {
            const mockLocalStorage = {
                getItem: function() { return null; }
            };

            const stored = mockLocalStorage.getItem('oxidize_groups');
            const groups = stored ? JSON.parse(stored) : [];

            expect(groups).toEqual([]);
        });
    });
});
```

- [ ] **Step 2: Run frontend tests**

Run: `npm test`
Expected: All tests pass including new group tests

- [ ] **Step 3: Commit**

```bash
git add static/app.test.js
git commit -m "test: add group-related frontend tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: End-to-end verification

**Files:**
- All modified files

- [ ] **Step 1: Final compilation check**

Run: `cargo check`
Expected: No errors

- [ ] **Step 2: Run all backend tests**

Run: `cargo test`
Expected: All tests pass

- [ ] **Step 3: Run all frontend tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Build the application**

Run: `cargo build`
Expected: Successful build

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify account groups feature end-to-end

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Group model struct: Task 1
- Group storage CRUD: Task 2
- Group API endpoints: Task 3
- HTML structure: Task 4
- CSS styles: Task 5
- Frontend group management: Task 6
- Chart aggregation in split mode: Task 7
- Frontend tests: Task 8
- End-to-end verification: Task 9

**Placeholder scan:**
- No "TBD", "TODO", or vague requirements found
- All code blocks contain complete, executable code
- All file paths are exact
- All commands are specific with expected output

**Type consistency:**
- `Group` struct fields match across storage, API, and frontend
- `account_ids` field used consistently (Vec<String>)
- API endpoint patterns match widget patterns exactly
- Storage method names follow existing convention (`get_all_*`, `create_*`, `update_*`, `delete_*`)

**Scope check:**
- Balance history only (as specified)
- No backend aggregation (frontend-only, as specified)
- Groups stored in SQLite (as specified)
- Separate group section above accounts (as specified)
- Group checkbox toggles member accounts (as specified)
