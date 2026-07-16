# Summary Page — Bug Inventory and Fix Plan

This document catalogs all identified issues with the summary page (`/summary` → `static/summary.html`, `src/handlers/summary.rs`, `src/client/mod.rs::get_monthly_summary`, `src/models/summary.rs`).

Items are ordered by severity: **Critical** (produces wrong or broken data), **High** (silently incorrect behavior), **Medium** (degraded UX or missing features), **Low** (cosmetic or minor).

---

## Critical (ALL FIXED)

### 1. Inverted filter logic in `sum_filtered_transaction_amounts`

**Files:** `src/client/mod.rs:1440–1462`

**Problem:** The function that filters and sums transaction amounts checks the *wrong side* of each journal entry:

- **Income (deposits):** It filters on `source_id` ("ignore if source is a selected account"). For a deposit, the source is a revenue/external account. This means deposits *into* selected asset accounts are included, which is accidentally correct for the "no accounts selected" default path (all accounts are fetched as an exclude list). But when *specific* account IDs are passed (user checked some accounts), this logic is backwards: it includes deposits whose source is NOT a selected account, rather than deposits whose *destination* IS a selected account.
- **Expenses (withdrawals):** It filters on `destination_id` ("ignore if destination is a selected account"). For a withdrawal, the destination is an expense account. This means withdrawals *from* selected asset accounts are included when no accounts are selected (because expense accounts are in the exclude list), but the semantics are wrong: it should check `source_id` for withdrawals.

**Root cause:** The filter checks the *opposite* field from what it should:
- Income → should check `destination_id` (money flowing INTO selected account)
- Expenses → should check `source_id` (money flowing OUT OF selected account)

Compare with the working `get_earned_spent` function (`src/client/mod.rs:402–430`) which correctly uses:
```rust
// Working earned_spent logic:
"deposit" => selected_ids.contains(dest_id) && !selected_ids.contains(source_id)
"withdrawal" => selected_ids.contains(source_id) && !selected_ids.contains(dest_id)
```

The summary's `sum_filtered_transaction_amounts` uses the exclude-list approach instead of the include-list approach, and checks the wrong fields.

**Impact:** Income and expense numbers are silently wrong for any non-trivial account selection. When the user selects specific asset accounts, income may be 0 (because revenue accounts are not in the selected set, so all deposits are excluded) and expenses may be 0 (because expense accounts are not in the selected set, so all withdrawals are excluded).

**Fix:** Rewrite `sum_filtered_transaction_amounts` to use the same include-list logic as `get_earned_spent`:
- For income (deposits): include if `destination_id` IS in selected accounts AND `source_id` is NOT (to avoid counting transfers between selected accounts)
- For expenses (withdrawals): include if `source_id` IS in selected accounts AND `destination_id` is NOT

---

### 2. Firefly III API query params `destination_id`, `source_id`, `account_type` not supported

**Files:** `src/client/mod.rs:765–772`

**Problem:** The `get_monthly_summary` function sends `destination_id`, `source_id`, and `account_type` as query parameters to the `/v1/transactions` endpoint:

```rust
income_query.push(("destination_id".to_string(), ids.join(",")));
expense_query.push(("source_id".to_string(), ids.join(",")));
// ...
income_query.push(("account_type".to_string(), t.clone()));
expense_query.push(("account_type".to_string(), t.clone()));
```

The Firefly III OpenAPI spec for `GET /v1/transactions` only supports: `limit`, `page`, `start`, `end`, `type`. It does **not** support `destination_id`, `source_id`, or `account_type` as query parameters. Firefly III silently ignores unknown parameters.

**Impact:** All three API-level filters are dead code. The API returns all transactions matching only `start`, `end`, and `type`. The local filtering in `sum_filtered_transaction_amounts` is supposed to compensate, but since that function is also broken (see item #1), the data is wrong.

**Fix:** Remove the unsupported query parameters. The correct approach is:
1. Fetch all transactions for the month with only `start`, `end`, `type` parameters
2. Filter locally using correct logic (see fix for item #1)

---

### 3. No pagination — only first 50 transactions fetched

**Files:** `src/client/mod.rs:805–822`

**Problem:** `get_monthly_summary` makes a single API call to `/v1/transactions` per type (deposit and withdrawal). The Firefly III API paginates at 50 items per page with a maximum of 200. If a month has more than 50 transactions of either type, the excess is silently dropped.

Compare with `fetch_all_transactions` (`src/client/mod.rs:682–720`) which properly handles pagination with a `while` loop and offset tracking. The summary function does not use `fetch_all_transactions`.

**Impact:** Monthly totals are silently truncated for any month with >50 deposits or >50 withdrawals. This is common for active accounts.

**Fix:** Use `fetch_all_transactions` instead of direct paginated calls, or implement proper pagination in `get_monthly_summary`. The cleaner approach is to refactor `get_monthly_summary` to:
1. Call `fetch_all_transactions` with `type=deposit` and `type=withdrawal` (or fetch all types and filter)
2. Process all journal entries with the corrected filtering logic

Note: `fetch_all_transactions` currently doesn't accept a `type` parameter. It would need to be extended, or `get_monthly_summary` should iterate through all pages itself.

---

## High (ALL FIXED)

### 4. `savings_rate` double-multiplied by 100 in frontend

**Files:** `src/client/mod.rs:831` (backend), `static/summary.html` (frontend JS)

**Problem:** The backend calculates `savings_rate` as a percentage:
```rust
let savings_rate = if total_income > 0.0 {
    (savings / total_income) * 100.0  // Already a percentage, e.g. 25.0 for 25%
} else {
    0.0
};
```

The frontend then multiplies by 100 again:
```javascript
document.getElementById('savings-rate').textContent =
    (data.savings_rate * 100).toFixed(1) + '%';  // 25.0 * 100 = 2500% !!!
```

**Impact:** The displayed savings rate is 100x the actual value. A 25% savings rate shows as "2500.0%".

**Fix:** Remove `* 100` from the frontend. The backend already returns a percentage:
```javascript
document.getElementById('savings-rate').textContent =
    data.savings_rate.toFixed(1) + '%';
```

---

### 5. Error container never becomes visible

**Files:** `static/summary.html`

**Problem:** The error container has `display: none` inline and the error handler sets the text but never changes the display style:

```javascript
// Error container: <div id="error-container" class="error" style="display: none;"></div>

// In fetchChartData catch block:
errorContainer.textContent = 'Failed to fetch summary data.';
// Missing: errorContainer.style.display = 'block';
```

**Impact:** When the API call fails, the error is written to the DOM but never shown. The user sees no feedback.

**Fix:** Add `errorContainer.style.display = 'block';` when setting error text, and add `errorContainer.style.display = 'none';` on successful data fetch.

---

### 6. Empty account list produces all-zero summary

**Files:** `static/summary.html` (JS `fetchChartData`), `src/client/mod.rs:775–800`

**Problem:** When no accounts are checked in the UI, `getSelectedAccountIds()` returns `[]`. The `account_ids` query parameter is empty, so the backend takes the "else" branch and fetches ALL accounts, building `selected_account_ids` from every account. With the inverted filter logic (item #1), every deposit and withdrawal gets filtered out → all zeros.

Even with the filter logic fixed, the semantics of "no accounts selected = show all accounts" need clarification. Currently the code fetches all accounts as an *exclude* list. With the corrected include-list approach, it should instead include all transactions.

**Impact:** Summary cards show $0.00 for everything when no accounts are selected (which is the initial page state before the user checks any boxes).

**Fix:** When `account_ids` is `None` or empty, either:
- (A) Return data for all accounts (don't filter at all), OR
- (B) Frontend should auto-select all accounts on initial load

Option (A) is simpler and matches user expectations: no filter = show everything.

---

## Medium (#10 REMAINING)

### 7. Account type filter has no effect on summary data

**Files:** `src/client/mod.rs:770–800`, `static/summary.html`

**Problem:** The account type dropdown in the UI (`#account-type-filter`) controls which accounts appear in the checkbox list, but it does NOT affect the summary calculation. When the user selects a type like "asset" from the dropdown:
- The `account_type` parameter is sent to the API (item #2 — silently ignored)
- The backend builds `selected_account_ids` from accounts of that type, but...
- The `account_type` UI selector doesn't trigger `fetchChartData()`, only `renderAccountList()`
- The actual summary fetch is triggered only by checkbox changes or month/year changes

The `account_type` parameter in the URL (`accountTypeParam`) is built from `typeFilterSelect.value` but it's only meaningful if no specific accounts are checked. If accounts ARE checked, `accountIdsParam` takes priority and `accountTypeParam` is ignored.

**Impact:** The type filter only affects the account list display, not the actual summary numbers. Users may be confused that selecting "asset" doesn't change the totals.

**Fix:** When no checkboxes are selected but a type filter is active, use the type filter to determine which accounts to include. Alternatively, auto-check all accounts of the selected type when the type filter changes.

---

### 8. No loading state for summary data fetch

**Files:** `static/summary.html`

**Problem:** When `fetchChartData()` is called, the existing card values are shown until the new data arrives. There's no loading indicator, spinner, or disabled state. If the API is slow, the user sees stale data with no indication that a refresh is in progress.

**Impact:** Poor UX — users can't tell if the page is loading, reloading, or finished.

**Fix:** Show a loading overlay or spinner on the summary cards when a fetch is in progress. Reset to normal on success or error.

---

### 9. API error responses don't show meaningful messages

**Files:** `src/handlers/summary.rs:44`

**Problem:** When `get_monthly_summary` returns an error, the handler does:
```rust
Err(e) => HttpResponse::InternalServerError().body(e),
```

This returns the error as plain text with a 500 status. The frontend just shows "Failed to fetch summary data." without any detail. The actual error message (e.g., "API request failed with status: 401") is lost.

**Impact:** Debugging summary failures requires checking server logs.

**Fix:** Return a JSON error response with a message field, or include the error text in the response body and display it in the frontend error container.

---

### 10. No caching for monthly summary

**Files:** `src/client/mod.rs`, `src/cache.rs`

**Problem:** Unlike other data methods (balance history, earned/spent, expenses by category), `get_monthly_summary` has no cache layer. Each page load or month change triggers fresh API calls to Firefly III.

**Impact:** Slow page loads, unnecessary API load on Firefly III, especially problematic since the data doesn't change within a month.

**Fix:** Add a `get_monthly_summary` cache method to `DataCache` and use it in `get_monthly_summary`. The cache key should include `month`, `year`, `account_ids`, and `account_type`.

---

## Low

### 11. `amount` field parsed as string only

**Files:** `src/client/mod.rs:1458–1460`

**Problem:** The `sum_filtered_transaction_amounts` function parses amounts as strings:
```rust
.filter_map(|trans| trans.get("amount"))
.filter_map(|amt| amt.as_str())
.filter_map(|amt_str| amt_str.parse::<f64>().ok())
```

If Firefly III returns `amount` as a JSON number (some endpoints do), `.as_str()` will return `None` and the amount will be silently dropped.

**Impact:** Transactions may be silently excluded if the amount format differs from expected.

**Fix:** Use a more robust parser:
```rust
.filter_map(|amt| amt.as_f64().or_else(|| amt.as_str()?.parse::<f64>().ok()))
```

---

### 12. Month/year validation not checked at handler level

**Files:** `src/handlers/summary.rs:27–29`

**Problem:** The handler defaults `month` and `year` to current values if not provided, but doesn't validate the ranges. Invalid values like `month=13` or `year=-1` are passed to the client, where `from_ymd_opt` will return `None` and produce an error.

**Impact:** Invalid month/year parameters produce a 500 error with a generic message instead of a 400 Bad Request.

**Fix:** Validate `month` is 1–12 and `year` is reasonable (e.g., 1900–2100) and return `HttpResponse::BadRequest` for invalid values.

---

### 13. Inline styles in summary.html should use CSS variables

**Files:** `static/summary.html`

**Problem:** The error styling uses hardcoded colors:
```css
.error { background: #ffebee; color: #c62828; ... }
.dark .error { background: #421818; color: #ef9a9a; ... }
```

These should use CSS variables from `style.css` for consistency with the theme system.

**Impact:** Minor visual inconsistency in dark mode.

**Fix:** Use `var(--card-bg)`, `var(--text-color)`, etc. or define `.error` styles in `style.css`.

---

### 14. Config injection uses `include_str!` vs filesystem read

**Files:** `src/handlers/summary.rs:48`, `src/handlers/index.rs`

**Problem:** The summary handler uses `include_str!("../../static/summary.html")` (compiled into the binary at build time), while the index handler reads `static/index.html` from the filesystem at runtime. This means changes to `summary.html` require a rebuild, while changes to `index.html` do not.

**Impact:** Inconsistency in development workflow — summary.html changes require `cargo build` to take effect.

**Fix:** Use `std::fs::read_to_string` for summary.html (like index.rs does) or document the inconsistency.

---

### 15. Service worker registration in summary.html may not work

**Files:** `static/summary.html:132`

**Problem:** The service worker registration script is inline in the HTML body rather than in a separate JS file. It uses `window.addEventListener('load', ...)` but the summary page loads data immediately on DOMContentLoaded in the inline script below. The service worker may not be registered before data fetches start, meaning cached resources may not be available for offline use.

**Impact:** PWA offline functionality may not work for the summary page.

**Fix:** Register the service worker earlier (in `<head>`) or register it in the `DOMContentLoaded` handler alongside the main logic.

---

## Summary of Fixes (Priority Order)
## Summary of Fixes (Priority Order)

| # | Severity | Description | Status |
|---|----------|-------------|--------|
| 1 | Critical | Fix inverted filter logic in `sum_filtered_transaction_amounts` | ✅ Fixed (a23a27d) |
| 2 | Critical | Remove unsupported API query params | ✅ Fixed (c7666ad) |
| 3 | Critical | Add pagination to fetch all transactions | ✅ Fixed (894b802) |
| 4 | High | Fix double-multiplication of `savings_rate` | ✅ Fixed (9aadd2e) |
| 5 | High | Make error container visible on errors | ✅ Fixed (adb5588) |
| 6 | High | Handle "no accounts selected" case | ✅ Fixed (a23a27d, asset-only filtering) |
| 7 | Medium | Make account type filter affect summary data | ✅ Fixed (backend account_type handling) |
| 8 | Medium | Add loading state for data fetch | ✅ Fixed (adb5588) |
| 9 | Medium | Return meaningful error messages | ✅ Fixed (adb5588) |
| 10 | Medium | Add caching for monthly summary | ⏳ Remaining |
| 11 | Low | Handle `amount` as number or string | ✅ Fixed (894b802) |
| 12 | Low | Validate month/year parameters | ✅ Fixed (330513a) |
| 13 | Low | Use CSS variables for error styles | ✅ Fixed (330513a) |
| 14 | Low | Use filesystem read for summary.html | ✅ Fixed (330513a) |
| 15 | Low | Move service worker registration | ✅ Fixed (330513a) |
