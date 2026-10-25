# Improvement Plan

Findings from a codebase review (2026-10-25), written as self-contained work
items for agents and contributors. Each item states the problem, the files
involved, the steps, and how to know it is done.

## How to use this file

- Work items in priority order unless told otherwise. **P0** items are small
  and close real security or stability holes; do them first.
- Do one item per branch/PR (small related items may share a PR, as noted).
- Follow `CLAUDE.md`: TDD where possible, `Result<T, String>` errors,
  `rustfmt`, conventional commits, integration tests named
  `tests/oxi_<n>_<description>.rs`.
- Before pushing, all of these must pass:
  ```bash
  cargo fmt -- --check
  cargo clippy -- -D warnings
  cargo test
  npm test -- --run
  ```
- When an item is finished, tick its checkbox here in the same PR and add a
  short note (PR link or commit).
- Line numbers below were correct at review time; search by symbol name if
  they have drifted.

## Status

| ID | Priority | Title | Done |
|----|----------|-------|------|
| S1 | P0 | Real URL validation (SSRF) | [ ] |
| S2 | P0 | Optional authentication | [ ] |
| S3 | P0 | Escape untrusted data in `innerHTML` | [ ] |
| R1 | P0 | Timeouts on the Firefly HTTP client | [ ] |
| R2 | P1 | Cache raw transactions + parallel chunk fetch | [ ] |
| R3 | P1 | Bounded cache with eviction | [ ] |
| R4 | P1 | SQLite WAL + busy timeout | [ ] |
| R5 | P2 | Remove `unwrap()` from the client | [ ] |
| M1 | P2 | Split oversized modules | [ ] |
| M2 | P1 | Correct `CLAUDE.md` | [ ] |
| M3 | P3 | Small cleanups | [ ] |

Suggested PR grouping: **S1 + S2 + R1** (backend hardening), **S3** (frontend),
**R2 + R3** (caching), **R4 + R5**, **M2** (can go with any PR), **M1**, **M3**.

---

## S1 — Real URL validation (SSRF) · P0

**Problem.** `CLAUDE.md` says `FireflyUrl` blocks localhost, loopback and
private IPs. It does not. `FireflyUrl::validate` (`src/config.rs:10`) only
checks the `http://` / `https://` prefix. The `url` crate is not a dependency.
`POST /api/settings/test-firefly` (`src/handlers/settings.rs`) makes the
server send a request to any URL the caller gives it and report the outcome.
That lets anyone on the network probe internal hosts.

**Constraint.** Many users run Firefly III on their LAN or in the same Docker
network (`http://firefly:8080`, `http://192.168.x.x`). Blocking private
addresses unconditionally would break them.

**Steps.**
1. Add `url = "2"` to `Cargo.toml`.
2. Rewrite `FireflyUrl::validate` to:
   - parse with `url::Url::parse` and reject parse errors;
   - require scheme `http` or `https` and a non-empty host;
   - reject URLs with embedded credentials (`user:pass@`);
   - when the host is an IP literal or `localhost`, reject loopback,
     private (RFC 1918), link-local (incl. `169.254.169.254` metadata),
     unspecified and IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`),
     **unless** the env var `ALLOW_PRIVATE_FIREFLY_URL=true` is set.
3. Read `ALLOW_PRIVATE_FIREFLY_URL` in `Config::from_env`. It is an env var
   only and must not be settable from `/settings`. Pass it to validation, e.g.
   `FireflyUrl::validate(raw, allow_private)`.
4. Update every call site: `Config::from_env`, `Config::with_settings`, the
   `PATCH /api/settings` validation, and `test_firefly_api`.
5. Decide the default. **Recommended:** default `true` when the startup env
   URL is itself private, so existing LAN setups keep working. Otherwise
   default `false`. Log at startup which mode is active.
6. Document the variable in `CLAUDE.md`, `.env.example` (if present) and the
   README.

DNS names that resolve to private IPs are out of scope. Mention this in a code
comment; S2 is the real defence.

**Acceptance / tests.** Add unit tests in `src/config.rs` covering:
- accepted: public `https://`, `http://` hostnames, ports, paths;
- rejected: `ftp://`, `javascript:`, empty host, `user:pass@host`,
  `http://127.0.0.1`, `http://localhost`, `http://10.0.0.1`,
  `http://169.254.169.254`, `http://[::1]`;
- private addresses accepted when allow-private is on.

Add an integration test showing `POST /api/settings/test-firefly` with
`http://127.0.0.1` returns 400 when allow-private is off.

---

## S2 — Optional authentication · P0

**Problem.** No endpoint requires authentication. Anyone who can reach the
port can `PATCH /api/settings` and point `firefly_url` at a server they
control. The server then sends the stored Firefly token there on the next
request (token exfiltration). They can also read all financial data, and
delete dashboards, widgets, groups and labels.

**Steps.**
1. Add an optional env var `OXIDIZE_AUTH_TOKEN` (restart required, not
   settable from `/settings`).
2. Add actix middleware (`actix_web::middleware::from_fn` or a small
   `Transform`) registered in `src/main.rs`:
   - If the var is unset or empty, allow everything (keeps today's behavior)
     and log a startup warning that the instance is unauthenticated.
   - If set, require one of:
     `Authorization: Bearer <token>`, or a cookie `oxidize_auth=<token>`.
     Compare in constant time (e.g. compare SHA-256 digests or use a
     byte-wise constant-time compare).
   - Exempt `/static/*`, `/favicon*`, `/api/manifest` and `/login`.
3. Add a minimal `GET /login` page and `POST /login`. The POST takes the
   token, sets an `HttpOnly; SameSite=Strict` cookie (`Secure` when the
   request came in over https) and redirects to `/`. Unauthenticated HTML
   page requests redirect to `/login`. Unauthenticated `/api/*` requests get
   401 JSON.
4. Even when auth is disabled, require the header `Content-Type:
   application/json` on `PATCH /api/settings` and
   `POST /api/settings/test-firefly`. A cross-site HTML form cannot send this
   header, so it blocks simple CSRF. Check whether actix's `web::Json`
   already enforces it and add a test either way.
5. Never return `firefly_token` in plain text from `GET /api/settings`. Check
   the current behavior and mask it (e.g. `"••••abcd"`) if it is returned.
6. Document in `CLAUDE.md` and README.

**Acceptance / tests** (`tests/oxi_<n>_auth.rs`):
- With no token set, existing routes behave exactly as before.
- With a token set: `/api/accounts` without credentials → 401; with a valid
  bearer header → 200; with a wrong token → 401; with a valid cookie → 200;
  `/static/style.css` → 200 without credentials; `/dashboard` without
  credentials → 302 to `/login`.
- `GET /api/settings` never contains the raw token.

---

## S3 — Escape untrusted data in `innerHTML` · P0

**Problem.** The frontend makes about 150 `innerHTML` assignments. Some escape
their input (`escapeHtmlAttr` in `static/app.js:231`) and many do not.
Firefly III data such as account, budget, category, label and subscription
names is attacker-controllable: anyone who can create an object in Firefly
can name it `<img src=x onerror=alert(1)>`. Known unescaped spots:

- `static/app.js:211` — `${account.name}`
- `static/app.js:4595-4597` — `${budget.name}` in both an attribute and text
- `static/app.js:226`, `:636`, `:690`, `:1020` — `${error.message}` / `${msg}`
- Every inline-script page also needs auditing: `labels.html` (17),
  `reimbursements.html` (14), `sankey.html` (13), `summary.html` (13),
  `avg-cost.html` (9), `budget-comparison.html` (7), `settings.html` (2),
  plus `static/dashboard.js` (16).

**Steps.**
1. Add `OxiUI.escapeHtml(value)` to `static/ui.js`. It converts `null` and
   `undefined` to `''`, stringifies the value, and escapes
   `& < > " '`. Test it in `static/ui.test.js`.
2. Replace the page-local helpers (`escapeHtmlAttr` in `app.js` and any
   others found with `grep -n "function esc" static/`) with the shared one,
   or make them thin aliases.
3. Audit **every** `innerHTML` and `insertAdjacentHTML` call
   (`grep -n "innerHTML\|insertAdjacentHTML" static/*.js static/*.html`).
   For each interpolated value that is not a hard-coded constant or a number,
   either:
   - wrap it in `OxiUI.escapeHtml(...)`, or
   - better, when the markup is small, build it with `textContent` /
     `document.createElement`.
4. Chart.js labels are drawn on a canvas and are safe. Chart.js HTML tooltips
   or custom legends are not, so check them too.
5. Add a `Content-Security-Policy` header with
   `actix_web::middleware::DefaultHeaders` in `src/main.rs`. Inline scripts
   and the injected `window.OXIDIZE_CONFIG` exist, so start with
   `default-src 'self'; script-src 'self' 'unsafe-inline' <chart.js CDN host>;
   style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';
   object-src 'none'; base-uri 'self'; frame-ancestors 'none'`. Verify every
   page still loads in a browser (see the `run` skill / Playwright). Also add
   `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.

**Acceptance / tests.**
- Vitest tests that render a list (accounts, budgets, labels) with a name
  containing `<img src=x onerror=...>`. They assert that no `img` element is
  created and that the text appears literally.
- `grep` review notes in the PR description: list every `innerHTML` site
  touched, or state that it only interpolates constants.
- Manual or Playwright smoke check that all pages render with the CSP header.

---

## R1 — Timeouts on the Firefly HTTP client · P0

**Problem.** The shared `reqwest::Client` in `FireflyClient::with_cache`
(`src/client/mod.rs:187`) has no timeout. If Firefly III hangs, requests hang
forever and tie up actix workers. Only `test_connection` sets a 10s timeout.
The builder also ends in `.unwrap()`, and the user agent is hard-coded as
`Oxidize/0.1.0`.

**Steps.**
1. Configure `.connect_timeout(Duration::from_secs(10))` and
   `.timeout(Duration::from_secs(60))`. 60s leaves room for slow transaction
   pages. Optionally make the request timeout an env var
   `FIREFLY_TIMEOUT_SECS` (default 60).
2. Use `.user_agent(concat!("Oxidize/", env!("CARGO_PKG_VERSION")))`.
3. Map timeout errors to a clear message (`reqwest::Error::is_timeout()` →
   `"Firefly III did not respond within 60s"`) so the UI shows something
   useful.

**Acceptance / tests.** An integration test with a `mockito` endpoint and a
deliberately short configured timeout. Use the env var or a constructor
parameter so the test does not take 60s. The test should get an error
containing "did not respond" and must not hang.

---

## R2 — Cache raw transactions + parallel chunk fetch · P1

**Problem.** `fetch_all_transactions` (`src/client/mod.rs`, around line 2800)
walks 90-day chunks and then pages, one request at a time, and does not cache
the raw result. Only each endpoint's final aggregated JSON is cached. A
dashboard with N transaction-based widgets (earned/spent, category, budget
history, labels, subscriptions, sankey, summary) downloads the same history N
times on a cold cache.

**Steps.**
1. Introduce a raw-transaction cache keyed on
   `(start, end, type_filter)`. Account filtering
   (`account_ids` / `excluded_account_ids`) is applied in memory *after*
   fetching, so leave it out of the key. That way all widgets over the same
   range share one download. Use a short TTL (e.g. `min(cache_ttl, 300)`).
   Clear it from `/api/refresh`.
2. Deduplicate requests already in flight. If two widgets ask for the same
   key at the same time, only one download should happen. Use a
   `tokio::sync::Mutex`/`OnceCell` per key, or `moka`'s `get_with` (see R3).
3. Fetch the 90-day chunks concurrently with a small bound, e.g.
   `futures::stream::iter(chunks).map(fetch_chunk).buffer_unordered(4)`.
   Keep page iteration within a chunk sequential. Preserve result ordering if
   any caller depends on it, and sort by date afterwards if unsure.
4. Store typed data (`Arc<Vec<Value>>` or a typed struct), not re-serialized
   JSON strings, so callers do not parse the same payload repeatedly.

**Acceptance / tests.**
- Integration test: a `mockito` server with `.expect(1)` on the transactions
  endpoint. Call two different aggregate methods (e.g. `get_earned_spent` and
  `get_expenses_by_category`) over the same range and assert the mock was hit
  once per chunk/page, not twice.
- Existing tests for every transaction-based endpoint still pass unchanged.
  Results must be identical.

---

## R3 — Bounded cache with eviction · P1

**Problem.** `src/cache.rs` (about 1600 lines) holds 20+ separate
`RwLock<HashMap<String, CacheEntry<String>>>` fields, each with hand-written
get/set/clear methods. Expired entries are only skipped on read and are never
removed. Keys come from user-supplied query parameters, so memory grows
without limit as distinct queries arrive.

**Steps.**
1. Replace the per-endpoint maps with a single generic cache keyed by
   `(namespace, key)`. `moka::future::Cache` with `max_capacity` and
   `time_to_live` is recommended. A hand-rolled
   `HashMap` + periodic `retain(|_, e| e.expires_at > now)` would also work.
2. Keep the public `DataCache` method names as thin wrappers at first so call
   sites do not all change in one PR. Then migrate call sites and delete the
   wrappers in a follow-up.
3. Keep the per-write TTL behavior: the TTL comes from the effective config
   (`Config::effective`) at write time.
4. Keep the existing refresh endpoints' semantics: clear one namespace, or
   clear everything.

**Acceptance / tests.**
- Existing `cache.rs` unit tests pass, adapted to the new API where needed.
- New test: inserting more than `max_capacity` entries keeps the size
  bounded.
- New test: an expired entry is not returned, and is eventually removed
  (call `run_pending_tasks()` for moka).

---

## R4 — SQLite WAL + busy timeout · P1

**Problem.** `with_db` / `with_db_optional` (`src/storage/mod.rs:40`, `:284`)
open a new connection per operation with no `busy_timeout` and the default
rollback journal. Concurrent writes, such as reordering several widgets or
writing the chart cache while saving settings, can fail with `SQLITE_BUSY`.

**Steps.**
1. In `init_db`, run `PRAGMA journal_mode=WAL;` once. The setting persists in
   the database file.
2. On every opened connection, call `conn.busy_timeout(Duration::from_secs(5))`.
   Put this in one helper used by both `with_db` variants.
3. Optional follow-up: switch to `r2d2_sqlite` pooling. Only do this if
   profiling shows connection opening matters.

**Acceptance / tests.** A test that spawns several threads, each creating and
updating widgets against a `tempfile` database at the same time. Assert that
none of them returns an error.

---

## R5 — Remove `unwrap()` from the client · P2

**Problem.** `src/client/mod.rs` contains 51 `unwrap()` calls. Handlers and
storage have none. A panic inside a handler future fails that request with an
opaque 500 and a stack trace in the logs, instead of the project's usual
`Result<T, String>` error.

**Steps.**
1. `grep -n "unwrap()" src/client/mod.rs`. For each call:
   - when the value really cannot fail (e.g. `NaiveDate::from_ymd_opt` on
     constants), use `expect("reason")` with a short justification;
   - otherwise convert it to `?` with `.map_err(|e| e.to_string())` or
     `.ok_or("...")?`.
2. Pay particular attention to date parsing of user input and JSON field
   access on Firefly responses (`["data"]` etc.). Malformed upstream data
   must not panic.

**Acceptance / tests.** A test that feeds a malformed Firefly response
(missing `data`, non-numeric `amount`) into one transaction-based endpoint and
gets an error response, not a panic.

---

## M1 — Split oversized modules · P2

**Problem.** Very large files are hard to review and to navigate:
`src/client/mod.rs` (about 5.9k lines), `static/app.js` (about 5.2k),
`static/dashboard.js` (about 4.7k), and large inline scripts in
`static/labels.html` (about 1.4k) and `static/summary.html` (about 1.1k).

**Steps.** Do one file per PR and move code without changing behavior.
1. `src/client/` → `mod.rs` (struct, constructor, shared HTTP helpers),
   `transactions.rs` (`fetch_all_transactions`, chunking, the shared
   spent/exclusion pipeline), `accounts.rs`, `budgets.rs`, `categories.rs`,
   `labels.rs`, `sankey.rs`, `subscriptions.rs`, `summary.rs`,
   `reimbursements.rs`, `card_paydown.rs`. Keep it as a single
   `impl FireflyClient` spread over several files (`impl` blocks per file).
2. Move pure helpers out of `app.js` / `dashboard.js` into `*-utils.js` files
   with Vitest coverage, following the `summary-utils.js` and
   `labels-utils.js` pattern.
3. Move inline page scripts into `static/<page>.js`. If you add or rename
   static files, update `static/sw.js`'s precache list and follow the
   versioning rules in `CLAUDE.md` ("Frontend versioning").
4. Update the source layout in `CLAUDE.md`.

**Acceptance.** No functional diff, and all tests pass. `git diff --stat`
should show mostly moves. In the PR description, state that no logic changed.

---

## M2 — Correct `CLAUDE.md` · P1

**Problem.** `CLAUDE.md` is the reference other agents rely on, and parts of
it are wrong:

- It claims SSRF protection that does not exist (fixed by S1; describe the
  real behavior once S1 lands).
- It lists the `url` and `tempfile` crates as dependencies; neither is in
  `Cargo.toml`. It says `dotenv`, but the crate is `dotenvy`. It omits `dirs`,
  `once_cell` and `tokio-test`.
- It says the cache TTL is 5 minutes / 300s; the default `CACHE_TTL` is 3600s.
- It says "All five page handlers" inject config; there are more pages now
  (summary, reimbursements, labels, settings).
- `src/handlers/settings.rs`, `src/models/settings.rs` and
  `static/settings.html` / `labels.html` / `labels-utils.js` are missing from
  the source layout. `/labels` and `/settings` are missing from the HTML
  pages table.
- It references a `plans/` directory that does not exist.
- The "Testing" section says integration tests use `tempfile`.
- The commit trailer instruction names a specific model. Consider making it
  generic.

**Steps.** Verify each claim against the code and fix it. Keep the existing
structure. Add a link to this file under a "Known issues / roadmap" heading.

**Acceptance.** Every crate, file, env var, default value and route named in
`CLAUDE.md` exists in the repo as described.

---

## M3 — Small cleanups · P3

- Replace `once_cell` with `std::sync::LazyLock` / `OnceLock` (stable since
  Rust 1.80; the Dockerfile uses 1.88) and drop the dependency.
- CI (`.github/workflows/ci.yml`) runs `cargo test` twice: once in parallel
  and once with `--test-threads=1`. Find out which tests need serial
  execution. Likely culprits are shared global state such as the
  `DATA_DIR` `OnceLock` in storage and env vars. Isolate them (e.g. a
  per-test data dir, or the `serial_test` crate on the few that need it) and
  then remove the duplicate run.
- Pin `actix-web = "4"` and similar to minor versions (`"4.17"`) so Dependabot
  PRs are visible and reviewable. `Cargo.lock` already pins builds; this is
  only about declared intent.

**Acceptance.** CI is green with a single `cargo test` run. `once_cell` no
longer appears in `Cargo.toml`.
