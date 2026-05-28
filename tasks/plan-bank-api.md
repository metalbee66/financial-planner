# Implementation Plan: Bank API — Backlog #4 (PocketSmith)

> ## ⛔ SUPERSEDED 2026-05-28 — Do not implement
>
> Companion plan to the now-superseded [SPEC-bank-api.md](SPEC-bank-api.md). Abandoned the same day it was written because Brad's hands-on PocketSmith trial revealed HSBC loan accounts aren't shareable via CDR — the load-bearing piece of the value case. Pivot is to [Backlog #3 — CSV parsers](todo.md#v24--csv-parsers-for-hsbc--anz--westpac--bankwest).
>
> Kept on disk as a record. None of the tasks below should be picked up. If the bank-API question is ever revisited, start from a fresh discovery — the assumptions in here (PocketSmith works for the household, CDR covers HSBC loans) have all changed.
>
> ---

> Companion to [SPEC-bank-api.md](SPEC-bank-api.md). Vertical slices; each task leaves the app green and shippable. Total estimate: **9 code tasks + 8 user-actions across 4 phases + wrap**, ~1 implementation week split across 2–3 sessions with user-action waits between.

## Overview

Wire PocketSmith → n8n → Firebase → Family Planner so Brad sees yesterday's NAB / HSBC / Westpac transactions in the Import tab automatically each morning, with a manual "Pull now" override. Lands as a tagged release (candidate v2.4) once the four spec checkpoints (J → K → L → M) all pass. CSV import path stays in place unchanged.

Phase ordering is gated by Brad's user-actions, not just code dependencies: nothing in Phase 1 can be merged until PocketSmith is stood up and a real NAB connection exists (Checkpoint J), because the daily poller needs a real upstream to write meaningful data into Firebase. Subsequent phases unlock as Brad connects each new bank.

## Architecture Decisions

- **Vendor: PocketSmith** (resells Basiq CDR feed at consumer pricing). Pivoted from direct Basiq after research confirmed Basiq's A$500/mo floor. See [SPEC-bank-api.md](SPEC-bank-api.md) opening note.
- **One household PocketSmith account; one developer key; one Firebase user record.** No per-participant fan-out. Joint accounts come through Brad's consent provided Diana opts in at the bank portal.
- **Polling only — no webhooks.** PocketSmith doesn't expose webhooks; daily 06:00 cron + manual "Pull now" trigger covers it.
- **Static developer-key auth** via `X-Developer-Key` header. No OAuth refresh, no token-mint workflow. Major simplification vs the eliminated direct-Basiq path.
- **Dedup by PocketSmith's stable `transaction.id`.** Source coexistence with the existing CSV pipeline via key namespacing (`csv:<hash>` vs `pocketsmith:<id>`) in `state.storedTransactionHashes`. Lazy migration: `loadStoredHashes` prefixes existing entries on read; new writes always carry a prefix.
- **Reuse the existing import-review UI.** `renderImportTab` is bank-agnostic — feeding it the output of `parsePocketsmithTransactions(rows)` produces the same review/assign/apply experience CSV provides today. No new render path.
- **Apply-to-Planner writes back `applied: true` + `appliedAt` + `glLine` into the inbox row** in addition to the existing `weekActuals` mutation. Re-polls don't resurrect applied rows because the dedup key matches.
- **n8n is the only server-side surface.** Same Geekom instance, same Firebase RTDB credential (`Family Planner - Firebase RTDB`), same healthchecks.io account, same heartbeat pattern as the email drainer + daily digest.
- **All code lands directly on `master` with scoped per-task commits.** Same convention as v2.3. The CLAUDE.md "commit before edits" rule gives the rollback point; no feature branch.

## Dependency Graph

```
Phase 0 — User-actions (PocketSmith account + bank consent + n8n credential)
    │
    └── Checkpoint J unlocked
            │
Phase 1 — NAB end-to-end in Family Planner
    │
    ├── T1: data.js — bank_inbox shape + helpers + parsePocketsmithTransactions
    │       │
    │       ├── T2: firebase-sync.js — realtime listener + initialSync + render hook
    │       │       │
    │       │       └── T4: Browser — Bank inbox sub-tab + UI plumbing
    │       │               │
    │       │               └── T5: Browser — Apply-to-Planner writeback
    │       │
    │       └── T3: n8n Workflow 1 (daily poller) + healthcheck
    │               │
    │               └── (T2 listener picks up its writes — feedback loop closes)
    │
    └── Checkpoint K unlocked
            │
Phase 2 — Multi-bank rollout (HSBC, Westpac)
    │
    └── User-action only; no code change.
            │
            └── Checkpoint L unlocked
                    │
Phase 3 — Manual pull + resilience
    │
    ├── T6: firebase-config.js + n8n Workflow 2 (manual pull webhook)
    │       │
    │       └── T7: Browser — "Pull now" button + fetch handler
    │
    └── T8: n8n Workflow 1 error branch — 3-day streak → bell + email
            │
            └── Checkpoint M unlocked

Phase 4 — Wrap
    │
    └── T9: routines.md + HANDOVER + CHANGELOG + tag candidate v2.4
```

T1 → T2 → T4 → T5 is the browser-side vertical. T3 is the server-side vertical; it can land in parallel with T1/T2 but doesn't unlock useful behaviour until T4 wires the inbox UI. T6 → T7 is the manual-pull vertical. T8 is independent.

---

## Phase 0 — Stand up PocketSmith (user-actions only)

> No code. Brad-owned. Checkpoint J unlocks Phase 1.

### UA1: Verify PocketSmith API tier

**Description:** Email PocketSmith support asking whether the **Premium** tier ($9.95 USD/mo) includes developer-key generation, or whether it's gated to **Super** ($19.95 USD/mo). The public pricing page does not list "API access" as a feature row; this is a 30-second support question that prevents a tier upgrade after subscribing.

**Acceptance:** Email reply confirms which tier exposes `my.pocketsmith.com/api_keys`.

**Verification:** Reply email saved or pasted into [tasks/user-actions.md](user-actions.md).

**Dependencies:** None.

### UA2: Diana enables joint-account CDR data sharing

**Description:** Diana logs into NAB online banking → Settings → Data Sharing (CDR) → enables joint-account sharing for the shared accounts. Repeats at HSBC online banking. Without this step, PocketSmith's Basiq backend returns zero eligible joint accounts when Brad consents.

**Acceptance:** NAB + HSBC online portals both show joint-account data sharing as "Enabled" for Diana.

**Verification:** Screenshot in Brad's records (no need to commit to repo).

**Dependencies:** None — can run in parallel with UA1.

### UA3: Subscribe and connect NAB

**Description:** Brad signs up at `pocketsmith.com`, subscribes to the tier confirmed by UA1, and uses PocketSmith's "Add Bank Feed" flow to connect NAB. PocketSmith handles the Basiq consent UI internally.

**Acceptance:** Inside PocketSmith, BOTH Brad's personal NAB accounts AND the joint NAB accounts are listed under the NAB connection. Recent transactions visible inside PocketSmith.

**Verification:** Screenshot or note. If joint accounts are missing, UA2 didn't take — re-check the bank portal opt-in.

**Dependencies:** UA1 (tier confirmed), UA2 (joint opt-in done).

### UA4: Generate developer key + capture user_id

**Description:** At `my.pocketsmith.com/api_keys` generate a developer key. Call `GET https://api.pocketsmith.com/v2/me` with the key in `X-Developer-Key` (curl is fine) and capture the returned `id` field.

**Acceptance:** Developer key string + numeric `pocketsmithUserId` recorded in Brad's password manager.

**Verification:** A second curl `GET /v2/users/{id}/transactions?per_page=1` returns a 200 with a real transaction in the response body.

**Dependencies:** UA3.

### UA5: Configure n8n credential + write user_id to Firebase

**Description:** In n8n, create a new HTTP Header Auth credential `Family Planner - PocketSmith API` with header name `X-Developer-Key` and the key value from UA4. Then PATCH `https://financial-planner-e85d4-default-rtdb.asia-southeast1.firebasedatabase.app/household/family/bank_inbox/user.json?auth=<database secret>` with body `{"pocketsmithUserId": <id>, "lastPolledAt": null, "lastManualPullAt": null, "lastError": null}` to seed the Firebase user record.

**Acceptance:** n8n credential listed; Firebase `bank_inbox/user` reads back the seeded shape in the Firebase console.

**Verification:** A throwaway n8n workflow (one HTTP Request node using the new credential, GET `https://api.pocketsmith.com/v2/me`) executes successfully.

**Dependencies:** UA4.

### Checkpoint J — PocketSmith stood up

- [ ] UA1 confirmed (tier)
- [ ] UA2 confirmed (joint opt-in on NAB + HSBC)
- [ ] UA3 confirmed (NAB connection, joint accounts visible)
- [ ] UA4 confirmed (dev key + user_id captured)
- [ ] UA5 confirmed (n8n credential + Firebase user record seeded)
- [ ] Throwaway n8n workflow successfully calls `GET /v2/me`

→ unlocks Phase 1.

---

## Phase 1 — NAB end-to-end in Family Planner

> Wires the data layer + Firebase listener + n8n workflow + browser UI so Brad sees real NAB transactions in the Import tab after the next morning's poll. Each task leaves the app green.

### T1: Data layer — `bank_inbox` schema + helpers

**Description:** Add the `bank_inbox` data shape, source-namespaced dedup helpers, and the pure `parsePocketsmithTransactions(rows)` mapper into `data.js`. Pure functions only — no UI consumers yet. Unit tests cover schema sanitisation + mapper + dedup namespacing.

**Acceptance criteria:**
- [ ] New exports in `data.js`: `DEFAULT_BANK_INBOX` (object: `{ user: {...}, transactions: {} }` with user shape per SPEC §5), `sanitiseBankInbox(obj)` (backfills missing fields and drops non-conforming transactions), `parsePocketsmithTransactions(rowsObj)` (maps the `{[id]: row}` map into the same array shape `parseNabCsv` returns), `namespaceCsvHash(hash)` (returns `"csv:" + hash` if no `:` prefix, identity otherwise), `namespacePocketsmithId(id)` (returns `"pocketsmith:" + id`).
- [ ] `parsePocketsmithTransactions` field mapping matches SPEC §7: `date → date/dateStr`, `amountAud → amount + isRefund`, `accountName → account`, `institution → source`, `payee → details + merchant`, `category → category`. `applied === true` rows are returned with `isDuplicate: true`.
- [ ] `sanitiseBankInbox` ignores transactions where `id` is missing/falsy or `date` is not parseable; tolerates missing optional fields by defaulting (`category: ''`, `glLine: null`, etc.).
- [ ] No UI consumers yet — `grep` shows only `data.js` + `data.test.js` reference the new exports.

**Verification:**
- [ ] Unit tests in `data.test.js` (or a new `bank-inbox.test.js` if `data.test.js` is too large to land cleanly): ≥10 cases covering sanitiser tolerance, parser field mapping, dedup namespacing identity behaviour, empty-input handling, applied-row → isDuplicate flag.
- [ ] `npm run test:fast` (~9s) green.
- [ ] Bracket-check `data.js` per CLAUDE.md.

**Dependencies:** None (Phase 0 user-actions don't gate code-only data-layer work; T1 could land first if Brad hits a Phase 0 wait).

**Files likely touched:**
- `app/js/data.js`
- `app/js/data.test.js` (or new `app/js/data.test.js` block / `bank-inbox.test.js`)

**Estimated scope:** S.

---

### T2: `firebase-sync.js` — realtime listener + initialSync + render hook

**Description:** Add a realtime listener on `bank_inbox` and an `initialSync` branch that loads it. Register a new render hook `renderImportTab` so the Finance module re-renders the Import tab when remote changes land.

**Acceptance criteria:**
- [ ] `firebase-sync.js`: new `fbListen('bank_inbox', data => { ... })` block that runs `sanitiseBankInbox(data)`, writes to `state.bankInbox`, and invokes the new `renderImportTab` hook if registered.
- [ ] `initialSync` loads `bank_inbox` after the existing `email_queue` load, applies the same sanitisation, and writes to `state.bankInbox`. If absent, defaults to `DEFAULT_BANK_INBOX`.
- [ ] The empty-Firebase branch pushes `DEFAULT_BANK_INBOX` so fresh-Firebase installs don't break the listener.
- [ ] `registerRenderHooks` accepts a new `renderImportTab` callback and stores it locally; pre-existing hooks unaffected.
- [ ] `state.bankInbox` initialised in `state.js` to `{ user: { pocketsmithUserId: null, lastPolledAt: null, lastManualPullAt: null, lastError: null }, transactions: {} }`.
- [ ] `shell.js`: `registerRenderHooks({ ..., renderImportTab })` passes a fresh import of the Finance module's render-import hook (added in T4 — wire stub for now that no-ops, T4 fills it).

**Verification:**
- [ ] `npm run test:fast` green (Phase 0 module-shell regression must still pass — the listener addition mustn't shift module-mount timing).
- [ ] Manual: start dev server (`python server.py`), open `http://localhost:8080`, sign in, console shows `Firebase loaded: bank_inbox` (or `Firebase empty for: bank_inbox` then a push).
- [ ] Manual: in Firebase console, edit `bank_inbox/user/lastPolledAt` → browser console logs the listener fired.

**Dependencies:** T1.

**Files likely touched:**
- `app/js/firebase-sync.js`
- `app/js/state.js`
- `app/js/shell.js`

**Estimated scope:** S.

---

### T3: n8n Workflow 1 — daily poller + healthcheck

**Description:** Build the daily transaction-poller workflow on `https://n8n.dlbooks.com.au`. Schedule trigger 06:00 Australia/Melbourne. Reads `bank_inbox/user`, calls PocketSmith `GET /v2/users/{id}/transactions?updated_since=<lastPolledAt>&per_page=1000`, paginates via `Link` headers, filters `status !== 'posted'`, PATCHes new rows into `bank_inbox/transactions/{id}`, updates `lastPolledAt`. Adds a trailing Heartbeat node to a new healthchecks.io check.

**Acceptance criteria:**
- [ ] New n8n workflow `FamilyPlanner: bank inbox daily poll`. Schedule Trigger every day 06:00 Australia/Melbourne.
- [ ] HTTP Request node GET `bank_inbox/user.json` using `Family Planner - Firebase RTDB` credential.
- [ ] HTTP Request node GET `https://api.pocketsmith.com/v2/users/{id}/transactions?updated_since={lastPolledAt}&per_page=1000` using new `Family Planner - PocketSmith API` credential.
- [ ] Pagination: follow `Link: <…>; rel="next"` header until absent (Code node or n8n built-in pagination feature).
- [ ] Code node filters `status === 'posted'` only and maps each tx to SPEC §5 shape with `applied: false, appliedAt: null, glLine: null, ingestedAt: <now ISO>`.
- [ ] HTTP Request node PATCH `bank_inbox/transactions.json` with the new-rows object — Firebase merges by key (idempotent on re-pull).
- [ ] HTTP Request node PATCH `bank_inbox/user/lastPolledAt.json` with the current ISO timestamp.
- [ ] Healthchecks.io check `FamilyPlanner-BankPollerCron` created (1d × 2h grace) under `metalbee66@gmail.com` account; trailing HTTP Request node hits the heartbeat URL on success path.
- [ ] On first run (`lastPolledAt: null`), the GET uses no `updated_since` and pulls everything Basiq has — back-window cap of 90 days enforced via `transaction.date.gte` filter to avoid pulling years of history on first run.

**Verification:**
- [ ] Manual execute (without waiting for 06:00): workflow runs end-to-end without errors; Firebase `bank_inbox/transactions/` populates with real NAB transactions; `lastPolledAt` updates.
- [ ] Re-run immediately: no duplicate rows (PATCH is idempotent on Basiq id key); `lastPolledAt` refreshes.
- [ ] Heartbeat check shows green in healthchecks.io after manual execute.
- [ ] [routines.md](file:///C:/Users/brads/.claude/routines.md) updated with the workflow + heartbeat entry (per the "update routines.md in the same turn" rule).

**Dependencies:** Phase 0 complete (UA5). Independent of T1/T2 at the code level but unlocks Checkpoint K only once T1/T2/T4/T5 also land.

**Files likely touched:** None in the repo. n8n + healthchecks.io config + `routines.md` outside `app/`.

**Estimated scope:** M (n8n config is fiddly; pagination + Firebase auth + error-branch wiring add up).

---

### T4: Browser — Bank inbox sub-tab UI

**Description:** Replace the existing "Bank API (Coming Soon)" placeholder in the Import tab template with a real "Bank inbox" section that reads from `state.bankInbox.transactions`, runs them through `parsePocketsmithTransactions`, renders them via the existing `renderImportTab` table, and applies the dedup-namespace migration to `loadStoredHashes`.

**Acceptance criteria:**
- [ ] `app/js/modules/finance/index.js` TEMPLATE: remove the "Bank API (Coming Soon)" `.section-card` and replace with a `.section-card` holding `<h2>Bank inbox</h2>`, the count summary, and a `<div id="bank-inbox-preview">` container. Keep the existing CSV upload `.section-card` above it unchanged.
- [ ] New exported function `renderBankInboxTab()` in `app/js/modules/finance/import.js` that: filters `state.bankInbox.transactions` to `applied === false`, runs through `parsePocketsmithTransactions`, calls `autoSuggest` (existing) against the result, then renders into `#bank-inbox-preview` via a slightly-adjusted clone of `renderImportTab` (or `renderImportTab` accepts a target-element-id param).
- [ ] `setupImport` wires the same GL-assign and "Remember mapping" event handlers for `#bank-inbox-preview` rows. Reuse, not duplicate.
- [ ] `loadStoredHashes()`: lazy migration — any hash without a `:` prefix gets a `csv:` prefix on read. New writes via `saveStoredHashes` carry the prefix already (callers updated in T5).
- [ ] Finance module's `mount(host)` calls `renderBankInboxTab()` on initial render so the inbox is populated immediately when the Import sub-tab opens (not just on remote-listener fires).
- [ ] Finance module's sub-tab switch handler refreshes the bank-inbox view when the Import sub-tab is re-activated (same pattern as `renderMappings` today).
- [ ] `shell.js` wires `renderImportTab` render hook to a function that calls both `renderMappings` AND `renderBankInboxTab` so remote bank_inbox changes refresh the live view.

**Verification:**
- [ ] `npm run test:fast` green.
- [ ] Manual: in dev tools, run `localStorage.setItem('bank_inbox', JSON.stringify({user: {pocketsmithUserId: 1}, transactions: {123: {id: 123, date: '2026-05-27', amountAud: -45.50, payee: 'Test merchant', accountName: 'NAB Card', institution: 'NAB', type: 'debit', status: 'posted', applied: false, appliedAt: null, glLine: null, ingestedAt: '2026-05-27T06:00:00Z'}}}))` then reload + open Import tab; the Bank inbox section shows the test row.
- [ ] New `tests-e2e/smoke.spec.js` block `bank-api — inbox render` (~3 tests): seed `bank_inbox` via `localStorage`, reload, verify row appears in `#bank-inbox-preview`; verify clicking the GL dropdown assigns a line; verify the dedup-hash migration prefixes pre-existing entries.
- [ ] Bracket-check `import.js` + `index.js` per CLAUDE.md.

**Dependencies:** T1, T2.

**Files likely touched:**
- `app/js/modules/finance/index.js` (TEMPLATE + mount)
- `app/js/modules/finance/import.js` (new render function + loadStoredHashes migration)
- `app/js/shell.js` (renderImportTab hook gets a real implementation)
- `app/tests-e2e/smoke.spec.js` (new describe block)

**Estimated scope:** M (touches the most live UI surface in this phase).

---

### T5: Browser — Apply-to-Planner writeback

**Description:** When Brad clicks "Apply to Planner" with bank-inbox rows assigned, the existing `applyToPlanner` runs unchanged (it operates on the parsed-tx array) AND new code PATCHes `applied: true` + `appliedAt: <now>` + the chosen `glLine` back into each `bank_inbox/transactions/{id}` row. The dedup hash for each Basiq-sourced row is written with the `pocketsmith:` prefix.

**Acceptance criteria:**
- [ ] New function `markBankInboxApplied(ids, glLines)` in `import.js` (or `firebase-sync.js` if cross-cutting): for each id in the assigned set, PATCH `bank_inbox/transactions/{id}` with `{applied: true, appliedAt: <iso>, glLine: <chosen>}` via `dbRef`.
- [ ] The "Apply to Planner" click handler, when called from the bank-inbox surface (not the CSV surface), additionally calls `markBankInboxApplied`. Detect surface via the `data-source="bank-inbox"` attribute on the row OR by tracking which review-list the assigned txs came from.
- [ ] `applyToPlanner` writes namespaced dedup keys: `pocketsmith:<basiqId>` for bank-inbox-sourced rows, `csv:<txHash>` for CSV-sourced rows. (Inferred from the parsed-tx object — bank-inbox rows have a numeric `id` field from the original Basiq row carried through; CSV rows don't.)
- [ ] `state.bankInbox.transactions` is updated locally to reflect `applied: true` so the inbox re-renders without waiting for the remote echo.
- [ ] CSV path unchanged: a CSV-only Apply-to-Planner round-trip behaves identically to today.

**Verification:**
- [ ] E2E test in `bank-api` describe: seed two bank-inbox rows, assign GLs, click Apply to Planner, verify (a) `weekActuals` rows populated, (b) the two `bank_inbox/transactions/{id}` rows now have `applied: true` in `state.bankInbox` (assert via `page.evaluate`), (c) the inbox view filters them out on next render.
- [ ] E2E test: simulate a re-poll by re-seeding the same row → it does NOT re-appear in the inbox view (filter on `applied === false`).
- [ ] Manual: end-to-end against a real Firebase entry — Apply to Planner; Firebase console shows the row's `applied: true` echo within ~2s.

**Dependencies:** T4.

**Files likely touched:**
- `app/js/modules/finance/import.js`
- `app/js/firebase-sync.js` (export a tiny PATCH helper if needed)
- `app/tests-e2e/smoke.spec.js`

**Estimated scope:** S.

---

### Checkpoint K — NAB live end-to-end

- [ ] T1–T5 merged on master, `npm run test:e2e` green (full suite).
- [ ] T3 workflow has executed at least once on its real cron (06:00) or via manual-execute against the live NAB connection.
- [ ] Firebase `bank_inbox/transactions/` contains real NAB transactions.
- [ ] Browser Import tab → Bank inbox section shows those transactions with auto-suggested GL lines.
- [ ] Apply to Planner with one row → that row flips to `applied: true` in Firebase and disappears from the inbox view.
- [ ] Next morning's automatic poll happens silently (heartbeat shows green); no duplicates appear.

→ unlocks Phase 2.

---

## Phase 2 — Multi-bank rollout

> No code changes. User-action only — connecting more banks in the PocketSmith UI; Workflow 1 picks them up automatically because it pulls all transactions across all connected institutions in one call.

### UA6: Connect HSBC

**Description:** Brad opens PocketSmith → "Add Bank Feed" → HSBC. Authenticates via PocketSmith's hosted Basiq consent UI. Verifies joint HSBC accounts surface (depends on UA2 having taken at HSBC's portal).

**Acceptance:** HSBC accounts (personal + joint) listed inside PocketSmith. Next morning's Workflow 1 run pulls HSBC transactions into Firebase, visible in the Family Planner inbox alongside NAB.

**Verification:** Bank inbox in Family Planner shows transactions with `source: "HSBC Bank Australia"` (or whatever HSBC AU's institution title is in PocketSmith) the morning after.

**Dependencies:** Checkpoint K.

### UA7: Connect Westpac

**Description:** Same flow as UA6 but for Westpac. Westpac is Brad-only — no joint opt-in required.

**Acceptance + verification:** Same shape as UA6 but `source: "Westpac"`.

**Dependencies:** UA6 (sequential is fine; can also be done same day as UA6).

### Checkpoint L — All three banks live

- [ ] UA6 + UA7 done.
- [ ] One Workflow 1 run after both connections; Firebase `bank_inbox/transactions/` shows rows from all three institutions.
- [ ] Family Planner Bank inbox renders rows from all three; existing GL mappings transfer (no mapping is bank-specific).
- [ ] No duplicate transactions; Brad's existing CSV-imported NAB rows do not collide with newly-pulled Basiq NAB rows (namespacing holds).

→ unlocks Phase 3.

---

## Phase 3 — Manual pull + resilience

> Adds the "Pull now" button + the error-streak notification so Brad doesn't have to babysit the daily poller.

### UA8: Generate manual-pull shared secret

**Description:** Generate a 32+ random char shared secret (e.g. `openssl rand -hex 32` or `python -c "import secrets; print(secrets.token_hex(32))"`). Save to password manager.

**Acceptance:** Secret captured.

**Verification:** N/A.

**Dependencies:** None — can run anytime before T6.

### T6: Shared secret + n8n Workflow 2 (manual pull webhook)

**Description:** Add the shared secret to `firebase-config.js`. Build n8n Workflow 2: webhook trigger at `/webhook/bank-pull-now`, gate on `X-FamilyPlanner-Token` header, rate-limit via `lastManualPullAt`, invoke Workflow 1's pull logic as a sub-workflow (extract the pull steps into a sub-workflow during this task), update `lastManualPullAt`, return `{pulled: <n>}` JSON.

**Acceptance criteria:**
- [ ] `firebase-config.js`: new export `BANK_PULL_WEBHOOK = { url: 'https://n8n.dlbooks.com.au/webhook/bank-pull-now', secret: '<the UA8 value>' }`. Comment clarifying the threat model (secret is browser-readable; protects against drive-by quota burn, not against motivated attackers).
- [ ] n8n: extract Workflow 1's pull-logic steps (the GET-bank_inbox/user → GET-PocketSmith-transactions → paginate → filter → PATCH-Firebase block) into a sub-workflow `FamilyPlanner: bank inbox pull (shared)`. Workflow 1 calls it via Execute Sub-workflow.
- [ ] n8n: new Workflow 2 `FamilyPlanner: bank inbox manual pull`. Webhook node `/webhook/bank-pull-now`. Code node verifies `headers['x-familyplanner-token']` matches a workflow-static-data secret (stored separately in n8n; mirrors UA8 value). HTTP Request node GET `bank_inbox/user/lastManualPullAt.json`; Code node rejects if less than 5 min ago (returns 429 with `{error: 'rate-limited'}`). Execute-Sub-workflow node fires the shared pull. HTTP Request node PATCHes `lastManualPullAt`. Webhook Response node returns `{pulled: <n>, errors: []}`.
- [ ] No heartbeat (user-initiated).

**Verification:**
- [ ] Manual: `curl -X POST -H 'X-FamilyPlanner-Token: <secret>' https://n8n.dlbooks.com.au/webhook/bank-pull-now` returns 200 + `{pulled: N}`. New rows (if any) appear in Firebase.
- [ ] Manual: same curl without the header → 401. With wrong secret → 401. Twice in 5 min → second call returns 429.
- [ ] Workflow 1 still runs daily without regression (shared sub-workflow extract didn't break the cron path).
- [ ] [routines.md](file:///C:/Users/brads/.claude/routines.md) updated with Workflow 2 + sub-workflow entries.

**Dependencies:** T3 (Workflow 1 to extract from), UA8.

**Files likely touched:**
- `app/js/firebase-config.js`
- n8n + `routines.md` outside `app/`.

**Estimated scope:** M.

---

### T7: Browser — "Pull now" button

**Description:** Add a "Pull now" button to the Bank inbox section header. On click: `fetch(BANK_PULL_WEBHOOK.url, { method: 'POST', headers: { 'X-FamilyPlanner-Token': BANK_PULL_WEBHOOK.secret } })`. Spinner-class on the button while in flight. Toast result (`Pulled N transactions` or `Pull failed: <message>`). The realtime listener handles the re-render automatically when new rows land.

**Acceptance criteria:**
- [ ] Button `#bank-inbox-pull-btn` in the Bank inbox section (CSS class `add-revision-btn` for visual consistency with Apply to Planner).
- [ ] Click handler in `setupImport`: fetch POST with shared secret; while in flight, `disabled` + `.is-loading` class; on response, parse `{pulled, errors}` and `showToast`.
- [ ] 429 response → toast "Try again in a few minutes (rate-limited)."
- [ ] 401 response → toast "Pull failed — check shared secret." (Should never happen in normal use; logged loud for misconfiguration.)
- [ ] Network error → toast "Pull failed — n8n unreachable."
- [ ] No re-render code in the click handler — the realtime listener does that work when PATCHes land.

**Verification:**
- [ ] E2E test in `bank-api`: intercept the webhook fetch via `page.route`, return `{pulled: 3, errors: []}` → button shows spinner during fetch, toast appears with `3`. Test the 429 + 401 + network-error paths via different route stubs.
- [ ] Manual against the live webhook: click Pull now → spinner → toast within ~5s (depends on PocketSmith API latency).

**Dependencies:** T6.

**Files likely touched:**
- `app/js/modules/finance/import.js`
- `app/js/modules/finance/index.js` (template addition for the button)
- `app/tests-e2e/smoke.spec.js`

**Estimated scope:** S.

---

### T8: n8n Workflow 1 error branch — 3-day streak notification

**Description:** Extend Workflow 1 with an error branch that increments a failure counter on `bank_inbox/user/lastError` shape, and after 3 consecutive failed days writes a notification into `notifications/brad` so the existing bell + email pipeline surfaces it.

**Acceptance criteria:**
- [ ] `bank_inbox/user/lastError` extended shape: `{lastError: null}` becomes `{lastError: {message: <str>, count: <int>, firstAt: <iso>, lastAt: <iso>}}` when a failure happens; cleared back to `null` on the next success.
- [ ] On the workflow's failure branch (any non-2xx from PocketSmith or Firebase): Code node reads current `lastError`, increments `count` + updates `lastAt`, PATCHes back.
- [ ] When `count >= 3`: build a notification record matching the existing `task_due_soon`-shape (see `applyAddNotification` / `eventToNotification` in `app/js/modules/projects/notifications.js`) — `{kind: 'task_due_soon', to: 'brad', by: 'system', title: 'Bank feed needs attention', summary: '<lastError.message>; <count> consecutive failures since <firstAt>', at: <iso>, read: false}`. PATCH it into `notifications/brad.json` via Firebase PATCH (Firebase merge — n8n constructs a sub-object keyed by the new notification id).
- [ ] The notification path triggers the existing bell + email pipeline because `firebase-sync.js`'s `projects` listener picks it up and re-renders the bell.
- [ ] On the next successful run, `lastError` is cleared. No notification is sent for the recovery (existing pipeline doesn't have a "recovered" kind).

**Verification:**
- [ ] Manual: temporarily set the workflow's PocketSmith credential to an invalid key. Manual-execute three times. After the third execute, the bell badge in Brad's open browser ticks up; an email lands via the existing drainer within 30 min.
- [ ] Restore the credential; manual-execute → `lastError` clears to `null`; no recovery email.
- [ ] [routines.md](file:///C:/Users/brads/.claude/routines.md) reflects the error-branch behaviour.

**Dependencies:** T3.

**Files likely touched:** None in the repo. n8n + `routines.md`.

**Estimated scope:** M.

---

### Checkpoint M — Manual pull + resilience live

- [ ] T6–T8 merged + n8n workflows updated.
- [ ] Manual `curl` to the pull-now webhook works end-to-end.
- [ ] "Pull now" button in the Family Planner UI fires the webhook + toasts the result.
- [ ] Simulated 3-day streak (forced bad credential × 3 manual executes) produces a bell + email.
- [ ] No regression to the daily-poll path.

→ unlocks Phase 4.

---

## Phase 4 — Wrap

### T9: Routines + handover + changelog + tag

**Description:** Refresh planning docs and tag the release.

**Acceptance criteria:**
- [ ] `routines.md` lists Workflow 1, Workflow 2, the shared sub-workflow, the `FamilyPlanner-BankPollerCron` heartbeat, and the error-branch behaviour.
- [ ] [HANDOVER.md](../HANDOVER.md) status block at the top updated: new section "v2.4 — Bank API (PocketSmith)" summarising the four workflows + the data shape + the four checkpoints + the cost reality.
- [ ] [CHANGELOG.md](../CHANGELOG.md) entry for v2.4.
- [ ] [tasks/todo.md](todo.md) — tick every item in the new Bank API section.
- [ ] [tasks/user-actions.md](user-actions.md) — Pre-Bank-API section ticked.
- [ ] Outstanding-items list in `HANDOVER.md` § Outstanding Items: mark Backlog #4 closed; Backlog #3 (CSV parsers) remains open for the banks PocketSmith doesn't cover (currently ANZ + Bankwest from the spec's out-of-scope list).
- [ ] Tag `v2.4` created and pushed.
- [ ] Manual two-tab Firebase smoke (Brad + Diana) — Bank inbox renders identically in both tabs; an Apply-to-Planner from Brad's tab propagates the `applied: true` to Diana's view within ~3s.

**Verification:**
- [ ] `npm run test:e2e` green pre-tag.
- [ ] Tag visible on origin: `git ls-remote --tags origin | grep v2.4`.
- [ ] GitHub Pages live site shows the new Bank inbox section after the auto-rebuild.

**Dependencies:** All checkpoints (J/K/L/M) passed.

**Files likely touched:**
- `routines.md` (in `C:\Users\brads\.claude\`)
- `app/HANDOVER.md`
- `app/CHANGELOG.md`
- `app/tasks/todo.md`
- `app/tasks/user-actions.md`

**Estimated scope:** XS (docs only).

---

## Risk + rollback

- **Rollback per phase:** Phase 1 is a single revert range — `git revert <T1-hash>..<T5-hash>` plus disabling Workflow 1 in n8n. Phase 3 is similar — revert T6/T7 + disable Workflow 2. The empty `bank_inbox/transactions/` map is harmless if left in Firebase post-rollback.
- **`feature_flag_bank_api_enabled`** is NOT introduced; SPEC §11 mentions it as a possibility but adding a flag for a no-impact-when-empty feature is over-engineering. If the inbox section visually offends after rollback, hide it via the `mount()` template instead.
- **Heartbeat coverage:** the daily-poll heartbeat catches silent failures within 26 hours; the 3-day streak notification adds a second signal layer.
- **Token rotation:** dev key compromise is mitigated by regenerating at `my.pocketsmith.com/api_keys` + updating the n8n credential — no code change required.

## Open implementation questions

None blocking. Two minor questions worth flagging during code review:

- **Q1 — first-run back window.** T3 spec'd a 90-day cap on the first-ever pull (`lastPolledAt: null` branch). Confirm with Brad that 90 days is the right cap — too short risks missing transactions that fell outside PocketSmith's own pull window; too long risks pulling a year of history Brad doesn't want surfaced in the planner.
- **Q2 — bank-inbox sort order.** Default = newest first. Confirm via the existing import-table convention (`parseNabCsv` sorts ascending by date — `transactions.sort((a, b) => a.date - b.date)` at the end of `parseNabCsv`). For consistency, `parsePocketsmithTransactions` should also sort ascending. The bank-inbox render can flip to descending if Brad prefers — small CSS or `.reverse()` change.
