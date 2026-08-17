# Oxidize — UX Review & Improvement Notes

Date: 2026-08-17
Scope: full pass over all 5 pages (Graph Builder `/`, Dashboard `/dashboard`, Budget
Comparison `/budget-comparison`, Avg Cost `/avg-cost`, Sankey Flow `/sankey`) plus the
shared CSS/JS, service worker, PWA manifest, and the page-serving handlers.

Goal: make the app feel like one cohesive product instead of five independently-grown pages.

---

## What was changed

### Global (all pages)

1. **Shared UI kit — `static/ui.js` (new)**
   - `OxiUI.toast(msg, type)` — stacked, dismissible toasts (bottom-right). Errors stay
     longer (6s) than info/success (3.5s).
   - `OxiUI.confirm({...})` and `OxiUI.prompt({...})` — promise-based modal dialogs
     reusing the existing modal visual language. Esc = cancel, Enter = confirm,
     focus is moved into the dialog and restored on close, inline validation errors
     supported.
   - `OxiUI.formatCurrency(value, {symbol, decimals, compact})` — one consistent
     currency formatter (was 4 divergent implementations: symbol+toFixed in avg-cost,
     `'$'`-defaulting in budget-comparison, M-abbreviated in sankey, inline
     toLocaleString in app.js/dashboard.js).
   - `OxiUI.getChartColors()` — theme-aware chart colors (previously copy-pasted in
     three places).
   - `OxiUI.spinnerHtml(label)` — consistent loading indicator.

   **Every `alert()` / `confirm()` / prompt() in the app was replaced** (15+ call sites
   in app.js, dashboard.js, sankey.html). Errors/successes now show as toasts;
   destructive asks use the confirm dialog with a red danger button; the two
   `prompt()` usages (dashboard rename, "select some categories") use the prompt
   dialog with inline validation.

2. **Navigation**
   - Added an "Oxidize" flame brand mark to the left of the nav on every page
     (previously the nav was just 5 links and there was no visual anchor for the app).
   - Removed the fragile active-link underline (`.nav a.active::after` at `bottom: -13px`,
     which silently breaks whenever nav padding changes); the pill highlight is now the
     single active indicator everywhere.
   - Dashboard nav dropdown button now carries `aria-haspopup`/`aria-expanded` and
     closes on Escape.

3. **Theme handling unified**
   - Avg Cost, Budget Comparison and Sankey each carried their own duplicated inline
     theme init + toggle code and did **not** dispatch `themeChanged`. They now all use
     `static/theme.js`; chart redraws on theme change are wired through the
     `themeChanged` event (behavior preserved: sankey re-renders, budget-comparison
     re-renders both charts).
   - **Fixed a real rendering bug**: the sun icon SVG path was corrupted on the
     avg-cost, budget-comparison and sankey pages (mangled coordinates in the two lower
     rays — the light-mode toggle glyph was visibly distorted on those three pages).
     All pages now share the correct path.
   - `dashboard.html` head was reordered (charset/meta first, theme.js before the
     stylesheet) — previously the manifest/theme script came before the charset meta.

4. **Page headers unified**
   - Avg Cost / Budget Comparison / Sankey used centered bare `<h1>`s; index used
     title+subtitle. All pages now use the same `.page-header` (left-aligned title,
     one-line subtitle describing what the page does, actions on the right):
     - Graph Builder: "Select accounts, pick a chart type, and save your graphs as
       dashboard widgets."
     - Average Cost per Budget: "What your budgets really cost per month, over a
       configurable period."
     - Budget Comparison: "This year vs last year, and where you're headed against
       your budget limits."
     - Sankey Flow: "See where your money flows — between accounts, by category,
       subcategory, or budget."

5. **Consistent loading / empty / error states**
   - All "Loading …" placeholders now use the shared spinner (`.spinner`) instead of
     plain italic text.
   - Empty states use the shared `.empty-state` card consistently (e.g. "No accounts
     found for the selected filters" was previously styled as a loading message, which
     read as "still working" instead of "nothing here").
   - Graph Builder "Update Graph" now shows a spinner in the chart status area and
     disables/labels the button ("Updating…") while data is fetched, then restores it.
   - Error styling consolidated on the global `.error`/`.info`/`.error-msg` classes;
     the conflicting per-page redefinitions were removed when the pages were reworked.

6. **Buttons & controls**
   - "Select All / Deselect All / All / None" on the tool pages now use the shared
     `.ghost-btn` style (previously unstyled ad-hoc buttons).
   - Dashboard widget action buttons (Refresh/Settings/Delete) changed from solid gray
     pills to subtle ghost buttons so the widget header reads as one surface.
   - Avg Cost sort indicators (`↕`) are now real `<button>`s (keyboard accessible);
     the ◀/▶ month steppers use the new `.icon-btn` style.
   - Sankey "Flow Type" options are now `<button role="radio">` instead of `onclick`
     divs.
   - Added global `:focus-visible` outlines for links/buttons/pills.
   - Added `prefers-reduced-motion` support.
   - Fixed the search-field magnifier glyph (was a bare circle; now has a handle).

7. **Styles consolidated into `style.css`**
   - The three tool pages each had large inline `<style>` blocks (~300-500 lines) that
     partially redefined shared classes (`.loading`, `.error`, `h1`, `.nav`…). All of
     that is now in `style.css` under a "Tool pages" section using the existing design
     tokens (`--space-*`, `--radius-*`, `--text-*`), so the pages can't drift out of
     style silently. Class names in the DOM were kept where JS depends on them.

8. **Service worker & PWA (these were actually broken)**
   - `sw.js` cached `/static/summary.html`, a file that no longer exists. Because
     `cache.addAll` fails atomically, **the service worker never installed at all** —
     the PWA install/offline story was silently dead. Fixed.
   - Old strategy was cache-first for everything, which would have served stale pages
     forever after a deploy. New strategy: network-first for page navigations (with
     offline fallback to the last cached copy), cache-first for static assets, and API
     requests are never intercepted. Cache bumped to `v6`, asset list now matches the
     actual pages, and `clients.claim()` was added.
   - `manifest.json` colors updated to the current palette (was old blue `#3498db` /
     `#f4f7f6`), plus `description`, `id`, `scope`.
   - All pages now link a favicon (192px app icon) — previously `/favicon.ico`
     returned 204 and browsers showed a blank tab icon.
   - Chart.js is now pinned to 4.4.7 on all pages (index/dashboard loaded floating
     "latest" while budget-comparison pinned 4.4.7 — a latent drift risk).

9. **Backend**
   - `src/handlers/dashboard.rs` injected `window.OXIDIZE_CONFIG` right before
     `</body>` — i.e. **after** `dashboard.js` executed. Result: the dashboard page
     always fell back to the default config (all 5 account types) even when
     `ACCOUNT_TYPES=asset,liability` is set, unlike every other page. Injection now
     happens before `</head>` like the other handlers. **Behavior change**: the
     dashboard's account fetching now honors `ACCOUNT_TYPES` from the environment
     (this was almost certainly the intended behavior; flagging it explicitly).

10. **Smaller consistency fixes**
    - Missing CSS for two widget type badges (`.category-subcat`, `.sankey`) — they
      rendered as unstyled text chips; both now have colors matching the badge palette.
    - "No Dashboards" empty state now points at the Dashboard nav dropdown to create
      one.
    - Budget Comparison supports up to 6 distinct budget colors (was 3; more budgets
      just cycled and looked confusing).
    - Dashboard date-range inputs have aria-labels.
    - Avg Cost: table headers use `scope="col"`, sort buttons have titles.

---

## Bugs found along the way (fixed)

| # | Bug | Impact |
|---|-----|--------|
| 1 | `sw.js` cached nonexistent `/static/summary.html` | Service worker install failed atomically → no PWA/offline at all |
| 2 | Corrupted sun-icon SVG path on 3 of 5 pages | Distorted theme-toggle glyph in light mode |
| 3 | Dashboard config injected after `dashboard.js` ran | `ACCOUNT_TYPES` env setting silently ignored on the dashboard page |
| 4 | Floating Chart.js version on 2 of 3 chart pages | Latent breaking-change risk |
| 5 | Unstyled `.category-subcat` / `.sankey` badges | Inconsistent widget headers |
| 6 | `--card-shadow` referenced but never defined (tool pages) | Tool-page cards silently had no shadow; now fall back to `--shadow-sm` like everything else |
| 7 | `alert()`/`confirm()`/`prompt()` everywhere | Blocking, off-brand dialogs; jarring in a PWA |

---

## Comments

- I deliberately did **not** change any API contracts, data shapes, widget JSON
  fields, or backend computation logic. All changes are presentation/interaction
  layer plus the two config/SW fixes above.
- The Vitest suites (`static/app.test.js`, `static/dashboard.test.js`) are
  self-contained simulations (they don't import the real page scripts), so they
  can't regress from this work — they were run and pass. I also wrote a throwaway
  jsdom harness exercising the new `ui.js` (toasts, confirm, prompt + validation,
  dialog stacking, focus restore, currency formatting, theme colors) — all passed;
  the harness was not committed (see "Questions" re: making it permanent).
- `OxiUI.confirm/prompt` replace native dialogs 1:1 semantically (cancel → null/false,
  confirm → true/value). If a future page needs a multi-choice dialog, the same
  overlay can be extended.
- Currency format stays "symbol first" (`$1,234.56`) — that matches the existing
  Firefly symbol data and the previous dominant convention. Firefly supports symbol
  positions per currency; see question 1.
- The `.env` has `RUST_LOG=debug`; I left it alone, but note every request will be
  logged verbosely in production.

## Questions / open items for you

1. **Currency symbol placement** — should symbols ever render *after* the amount
   (e.g. for some EU currencies in Firefly)? The shared formatter currently always
   prefixes. If yes, I'd add a `symbolAfter` option driven by the currency data.
2. **Permanently test `ui.js`?** I verified it with a throwaway jsdom script. Worth
   committing `static/ui.test.js` (Vitest is already set up for `static/**/*.test.js`)
   so the dialog/toast logic is covered in CI — say the word and I'll add it.
3. **`ACCOUNT_TYPES` on the dashboard** — with the injection-position fix, the
   dashboard now only fetches the configured account types (e.g. `asset,liability`)
   when building widget account tags. If any of your dashboards rely on widget
   account tags for other types, add them to `ACCOUNT_TYPES` in `.env`.
4. **PWA theme-color** — `<meta name="theme-color">` is static `#3b82f6`. I could
   swap it on theme change (light blue ↔ dark indigo) if you want the mobile
   browser chrome to match dark mode.
5. **Brand mark** — I used a simple flame line-icon (oxidation theme). If you'd
   rather reuse the PWA icon or a different glyph, it's a one-line swap per page
   (or I can pull it into a shared include — though these pages are static, so that
   would mean either duplication or a small fetch).
6. **Docs drift** — `CLAUDE.md` still describes `static/summary.html`,
   `handlers/summary.rs` and `models/summary.rs`, which no longer exist. Want me to
   update the doc in a separate commit?
7. **Dependabot config** (`.github/dependabot.yml`) has an empty
   `package-ecosystem: ""` — it likely never runs. I left it untouched; happy to fix.

## Verification performed

- `cargo test` — all backend suites pass
- `npm test -- --run` — 75/75 frontend tests pass
- `cargo clippy` — clean (CI runs with `-D warnings`)
- `cargo fmt -- --check` — clean
- `node --check` on every JS file (including all inline page scripts)
- Live smoke test on a running server: all 5 pages + `/static/ui.js` +
  `/api/manifest` return 200; config injection, brand, ui.js, theme.js placement
  verified on the served HTML of every page.
