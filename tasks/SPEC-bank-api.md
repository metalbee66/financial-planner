# Spec: Bank API — Pre-Phase-1 Backlog #4

> ## ⛔ SUPERSEDED 2026-05-28 — Do not implement
>
> Brad subscribed to PocketSmith, attempted to connect his real banks, and found **HSBC loan accounts are not shareable via CDR** (HSBC's CDR scope structurally excludes loan products as of 2026-05). With HSBC loans dropped, PocketSmith's value collapses to NAB-only coverage at ~A$120/yr — bad trade vs the existing free NAB CSV parser.
>
> **Decision:** abandon the Bank API integration entirely. Pivot to [Backlog #3 — CSV parsers](todo.md#v24--csv-parsers-for-hsbc--anz--westpac--bankwest) for HSBC + ANZ + Westpac + Bankwest. Free, manual, but covers every account Brad has including the HSBC loans this spec would have missed.
>
> **Kept on disk** as a record of the discovery path: Basiq direct → too expensive → PocketSmith → wrong coverage. Useful if the CDR landscape changes (HSBC starts sharing loans, Basiq launches a household tier, a new consumer aggregator emerges). See [memory: project_bank_api_decisions.md](file:///C:/Users/brads/.claude/projects/e--Projects-Family-Planner/memory/project_bank_api_decisions.md) for the full trail + the "don't go back here without new market info" guardrail.
>
> ---

> Discovery spec for pulling transaction data from Australian banks via **PocketSmith's REST API** (which sources from Basiq's CDR feed under the hood) into the existing Import tab pipeline. Owner: Brad. Reviewer: Brad. Status: **SUPERSEDED** — see banner above.
>
> **Pivot note (2026-05-28):** Earlier drafts of this spec assumed direct Basiq integration. Basiq's actual production tier has a confirmed **A$500/mo minimum floor + 12-mo commit** (~A$6,000/yr min), which is uneconomical for a 2-user household. PocketSmith uses Basiq under the hood and resells at consumer pricing (~A$180–360/yr depending on tier), amortising the Basiq enterprise fee across their whole user base. Same CDR compliance posture, ~50× cheaper, simpler auth (static developer key vs OAuth2 client credentials).

## Objective

Replace the manual "download CSV from netbank → upload to Import tab" loop with an automated daily pull from PocketSmith's REST API, writing transactions into a new `bank_inbox` Firebase key that the browser-side Import tab consumes alongside (or in place of) CSV uploads.

**In scope (v1):**

- One n8n credential + two n8n workflows on the Geekom (`https://n8n.dlbooks.com.au`) — daily transaction poller + manual "Pull now" webhook.
- One new top-level Firebase RTDB key `bank_inbox` (sibling of `projects`, `email_queue`) holding PocketSmith-sourced transactions plus minimal account metadata.
- Browser-side Import tab changes: load PocketSmith-sourced transactions from `bank_inbox`, surface them in the same review/assign UI the CSV flow uses today, dedup by PocketSmith's stable `transaction.id`.
- Three institutions wired in order: **NAB, then HSBC, then Westpac** — all CDR-live in PocketSmith via the Basiq backend.
- Manual user-actions list (PocketSmith signup, tier verification, bank-by-bank UI consent, developer-key generation, joint-account opt-in for Diana).

**Out of scope (v1):**

- ANZ + Bankwest. Deferred to v2 — Bankwest's CDR brand may not survive the CBA merger (mid-2026).
- Webhook-based ingestion. PocketSmith doesn't expose webhooks; polling is the only option. Daily cadence accepted.
- Migrating existing CSV-imported `imported_tx_hashes` to PocketSmith IDs. CSV records stay keyed by `csv:<date>|<amount>|<details>|<account>`; PocketSmith records key on `pocketsmith:<id>`. Brief overlap during cutover accepted.
- Removing the NAB CSV parser. Stays in place as a fallback.
- Direct Basiq integration. Eliminated by the pricing reality (Basiq min A$500/mo). Revisit only if PocketSmith becomes non-viable.
- Direct bank CDR-ADR integration. Requires AU ADR accreditation (~A$250k to apply). Out of scope forever for a household app.
- Pending transactions. PocketSmith exposes `status` but v1 only ingests `posted`.

**Done state:** Brad sees yesterday's NAB transactions appear in the Import tab automatically the next morning, with the same merchant / GL-suggestion / apply-to-planner UX as today's CSV flow. Once green, add HSBC then Westpac (no n8n code change — just connect them in the PocketSmith UI). Manual two-tab Firebase smoke + Playwright E2E green (no new E2E required for v1 — PocketSmith + n8n are external services not modelled in the harness; coverage lives at the Firebase-key boundary).

## Decisions made (2026-05-28)

See [memory: project_bank_api_decisions.md](file:///C:/Users/brads/.claude/projects/e--Projects-Family-Planner/memory/project_bank_api_decisions.md). Summary:

- **Vendor:** PocketSmith (consumer reseller of Basiq's CDR feed).
- **Compliance:** CDR via PocketSmith's Basiq contract — no screen-scrape fallback.
- **Server-side layer:** n8n on the Geekom. Two new workflows alongside the existing email drainer + digest sender.
- **Polling cadence:** daily, 06:00 Australia/Melbourne (matches `FamilyPlanner: daily digest sender`) **plus a manual "Pull now" trigger** in the Import tab.
- **Household model:** ONE PocketSmith account holds both Brad's and Diana's bank credentials (PocketSmith's "Collaborator" feature gives Diana a free secondary login if she wants direct UI access). NAB + HSBC are joint; Westpac is Brad-only.
- **Joint-account opt-in:** required on the bank side (NAB + HSBC online portals). CDR rule applies upstream of PocketSmith.
- **Cost:** ~A$180/yr (Premium tier $9.95 USD/mo) or ~A$360/yr (Super tier $19.95 USD/mo). Tier needed for API key generation must be confirmed with PocketSmith support before subscribing.
- **Rollout:** NAB → HSBC → Westpac. ANZ + Bankwest in v2.
- **PocketSmith account state:** none yet.

## Tech stack additions

- **PocketSmith** REST API. Base URL `https://api.pocketsmith.com/v2`. Auth: static developer key via `X-Developer-Key` header (no OAuth refresh, no token mint workflow). OpenAPI 3 spec at `github.com/pocketsmith/api`. Pagination via `Per-Page` / `Total` / RFC 5988 `Link` headers; default 30, max 1000 per page.
- **n8n credentials** — one new credential `Family Planner - PocketSmith API` (HTTP Header Auth holding the `X-Developer-Key` value). Existing `Family Planner - Firebase RTDB` query-auth credential unchanged.
- **No new browser-side deps.** The vanilla-JS + Firebase-v8-compat baseline doesn't move.

## Architecture

```
┌──────────────────────────┐                  ┌──────────────────────────┐
│ Browser (GitHub Pages)   │                  │ n8n on the Geekom        │
│                          │                  │                          │
│  Finance / Import tab    │                  │  1. Daily poll (cron 6am)│
│   ├ CSV upload (existing)│                  │  2. Manual pull (webhook)│
│   └ Bank inbox (new)     │                  │        ↓                 │
│        ↑                 │                  │     write                │
│        │ read            │                  └──────────┬───────────────┘
└────────┼─────────────────┘                             │
         │                                               ▼
         ▼                                  ┌────────────────────────────┐
   ┌────────────────────────────┐           │ PocketSmith REST API       │
   │ Firebase RTDB —            │           │   GET /users/{id}/         │
   │ household/family/          │           │       transactions         │
   │                            │           │   X-Developer-Key auth     │
   │  projects/      (existing) │           └─────────┬──────────────────┘
   │  email_queue/   (existing) │                     │
   │  digest_pending/(existing) │            uses Basiq CDR under the hood
   │  bank_inbox/    (NEW)      │                     │
   │     ├ user/                │                     ▼
   │     └ transactions/{id}/   │            ┌────────────────────┐
   │                            │            │ NAB / HSBC / Westpac
   └────────────────────────────┘            │ (CDR data holders) │
                                             └────────────────────┘
```

`bank_inbox` is top-level (sibling of `projects` and `email_queue`) — same reason as `email_queue`: n8n owns it, browser reads it, schema unrelated to project data. Under the existing Database Secret auth (n8n's `Family Planner - Firebase RTDB` credential), n8n bypasses RTDB rules with admin scope.

## Data model

### `bank_inbox/user`

Single object (not keyed) — PocketSmith holds one household account, so there's no per-participant fan-out at the Firebase layer. Per-bank metadata lives inside PocketSmith and is fetchable on demand if needed.

```js
{
  pocketsmithUserId: 12345,        // PocketSmith's numeric user id (from GET /me)
  lastPolledAt: '2026-MM-DDTHH:mm:ssZ',
  lastManualPullAt: '2026-MM-DDTHH:mm:ssZ',
  lastError: null,                  // populated when 3-day error streak hits
}
```

### `bank_inbox/transactions/{pocketsmithTxId}`

One row per PocketSmith transaction. PocketSmith's `id` is the stable primary key.

```js
{
  id: 9876543,                              // PocketSmith's tx id (number, not string)
  date: '2026-05-25',                        // ISO date
  amountAud: -139.98,                         // PocketSmith already returns numbers; sign matches direction
  payee: 'WOOLWORTHS METRO 1234',
  originalPayee: 'WOOLWORTHS METRO 1234',
  category: 'Groceries',                      // PocketSmith's user-categorisation if set; '' otherwise
  accountName: 'NAB Classic Banking',         // PocketSmith's transaction_account.name
  institution: 'National Australia Bank',     // PocketSmith's transaction_account.institution.title
  type: 'debit',                              // mirrors PocketSmith's `type` field
  status: 'posted',                           // 'posted' only ingested; 'pending' filtered out
  ingestedAt: '2026-05-26T06:00:13Z',
  applied: false,                              // browser flips to true after "Apply to Planner"
  appliedAt: null,
  glLine: null,                                // browser writes after GL assignment
}
```

Schema invariants:

- `applied: false` rows are the v1 equivalent of the CSV flow's "unassigned + assigned" buckets — visible in the Import tab review UI.
- `applied: true` rows persist in `bank_inbox/transactions/` so re-polling doesn't re-create them. Browser filters them out of the active review list; they remain in the dedup set.
- The n8n poller PATCHes new rows keyed by PocketSmith id — Firebase merge-by-key makes re-pulls idempotent.
- Rows older than 365 days with `applied: true` are eligible for a sweep (same admin-panel pattern as `email_queue`); deferred to v2.

### Source coexistence

CSV and PocketSmith sources coexist via key namespacing in `state.storedTransactionHashes`:

```js
{ "csv:2026-05-24|45.99|woolworths|cardA": true,
  "pocketsmith:9876543": true }
```

One-time migration to namespace existing CSV entries is a 4-line patch in `loadStoredHashes`. CSV hashes without a `csv:` prefix get one on load; new hashes always written with prefix. No collision risk — the namespaces are disjoint by construction.

## Server-side: n8n workflows

### Workflow 1 — Daily transaction poller (cron)

**Purpose:** pull yesterday's transactions from PocketSmith and PATCH new rows into `bank_inbox/transactions/`.

- **Trigger:** Schedule, daily 06:00 Australia/Melbourne (same TZ as the digest sender).
- **Steps:**
  1. HTTP GET `bank_inbox/user.json` from Firebase — read `pocketsmithUserId` and `lastPolledAt`.
  2. HTTP GET `https://api.pocketsmith.com/v2/users/{pocketsmithUserId}/transactions?updated_since={lastPolledAt}&per_page=1000` with `X-Developer-Key` header.
  3. Follow `Link: <…>; rel="next"` headers until exhausted (paginate).
  4. Code node — for each transaction: skip `status !== 'posted'`; build the `bank_inbox/transactions/{id}` row per §5 schema.
  5. PATCH all new rows into `bank_inbox/transactions.json` in one round-trip (Firebase merges by key — idempotent if a row already exists with the same id).
  6. PATCH `bank_inbox/user/lastPolledAt` to current ISO timestamp.
- **Error branch:** if the PocketSmith call returns 4xx/5xx three consecutive days, PATCH `bank_inbox/user/lastError` and write a `task_due_soon`-shaped notification into `notifications/brad` (reuses existing bell + email pipeline). 401 = developer key revoked; 5xx = PocketSmith outage; both surface the same way.
- **Heartbeat:** healthchecks.io `FamilyPlanner-BankPollerCron` (1d × 2h grace), same pattern as the existing two Family Planner cron heartbeats.

### Workflow 2 — Manual pull (webhook trigger)

**Purpose:** Brad clicks "Pull now" in the Import tab to refresh on demand.

- **Trigger:** Webhook (n8n public URL `https://n8n.dlbooks.com.au/webhook/bank-pull-now`).
- **Steps:**
  1. Verify a shared-secret header `X-FamilyPlanner-Token` matches the secret stored in `firebase-config.js`. Reject with 401 otherwise. (Threat model: a leaked secret only lets the attacker burn the PocketSmith API quota; they can't read data because the response goes into Brad's Firebase, not theirs.)
  2. Rate-limit: reject if `bank_inbox/user/lastManualPullAt` was less than 5 min ago.
  3. Execute sub-workflow → invokes Workflow 1's transaction-pull steps (single source of truth for the pull logic).
  4. PATCH `bank_inbox/user/lastManualPullAt`.
  5. Return 200 + `{ pulled: <n>, errors: [...] }` JSON so the browser can toast the result.
- **No heartbeat** — user-initiated, not scheduled.

## Browser-side ingestion

Two new functions in `js/modules/finance/import.js`:

1. **`loadBankInbox()`** — analogous to `loadGlMappings()`. Reads from `state.bankInbox` (populated by a new `firebase-sync.js` realtime listener on `bank_inbox/transactions`).
2. **`parsePocketsmithTransactions(rows)`** — pure mapper from the §5 Firebase shape into the existing `{date, dateStr, amount, isRefund, account, source, txType, details, category, merchant, glLine, isDuplicate}` shape that `autoSuggest` + `applyToPlanner` already consume. Mapping rules:
   - `date` = parse `date` as `Date`
   - `dateStr` = original `date` ISO string (no conversion needed)
   - `amount` = `Math.abs(amountAud)`
   - `isRefund` = `amountAud > 0` (or `type === 'credit'`)
   - `account` = `accountName`
   - `source` = `institution`
   - `txType` = `''` (PocketSmith's `type` is just credit/debit; not used)
   - `details` = `payee`
   - `category` = `category` (PocketSmith's user-categorisation if set)
   - `merchant` = `payee` (or fall back to `originalPayee.substring(0, 30)`)
   - `glLine = ''` (filled by `autoSuggest`)
   - `isDuplicate` = `applied === true`

A new Import-tab sub-tab: **"Bank inbox"** alongside "CSV upload" + "Mappings". The bank-inbox view renders the same table as the CSV review (`renderImportTab` reused) but driven by `state.bankInbox.transactions` filtered to `applied === false`. A "Pull now" button next to "Apply to Planner" fires the Workflow 2 webhook with the shared secret, shows a spinner, then toasts the result. The realtime listener on `bank_inbox/transactions` re-renders the list automatically as new rows land — no manual reload. "Apply to Planner" PATCHes `applied: true` + `appliedAt` + `glLine` back into the inbox row in addition to the existing `weekActuals` mutation.

`firebase-sync.js` gets one new realtime listener on `bank_inbox/transactions` (mirrors the `email_queue` listener pattern) — re-renders the Import tab via the existing `renderImportTab` render hook (registered in `shell.js` per gl-mappings work in `30ece9d`).

## User-actions

Net-new manual ops for Brad (and one for Diana). Add to [tasks/user-actions.md](user-actions.md) under a new **"Pre-Bank-API"** section.

1. **Verify which PocketSmith tier exposes API key generation** — email PocketSmith support before paying. Premium ($9.95 USD/mo) is the working assumption per research; Super ($19.95 USD/mo) is the fallback. 30-second question; saves a tier-upgrade later.
2. Sign up at `pocketsmith.com` — start on the free tier, upgrade to the API-enabled tier once step 1 confirms which.
3. **Diana enables joint-account CDR data sharing on NAB + HSBC.** Log into NAB online banking → Settings → Data Sharing → enable joint-account sharing for the shared accounts. Repeat at HSBC. **Without this step, PocketSmith's Basiq backend will return zero eligible joint accounts.** One-time, ~2 min per bank. Westpac is Brad-only — no joint opt-in needed there.
4. Inside PocketSmith's web UI, connect NAB via their "Add Bank Feed" flow — PocketSmith handles the Basiq consent UI internally. Confirm both Brad's personal NAB accounts AND the joint accounts appear. Repeat for HSBC (joint) then Westpac (Brad-only).
5. Generate a developer key at `my.pocketsmith.com/api_keys` → store in n8n credential `Family Planner - PocketSmith API` (HTTP Header Auth, header `X-Developer-Key`, value the key string).
6. Get the PocketSmith user_id (`GET /v2/me` returns it as `id`, or it's in the URL when logged in) → PATCH it to `bank_inbox/user/pocketsmithUserId` in Firebase.
7. **Generate a manual-pull shared secret** (32+ random chars) → store in `firebase-config.js` next to the existing public API key, and as a workflow variable on Workflow 2.
8. (Optional) Add Diana as a Collaborator on the PocketSmith account if she wants to log in directly to add/modify bank connections herself. Free.
9. **Verify Bankwest + ANZ presence in PocketSmith** for the deferred v2 expansion — connect them later when v2 rolls.

## Resolved decisions

All open decisions resolved 2026-05-28 with Brad. Spec is implementation-ready.

| # | Decision | Resolution |
|---|---|---|
| OD-1 | **Vendor + pricing tier.** | **PocketSmith Premium ($9.95 USD/mo) — pending tier-API-access verification.** Pivoted from direct Basiq after research confirmed Basiq's A$500/mo floor. ~A$180–360/yr instead of A$6,000/yr. Single household account holds both Brad's + Diana's banks via Collaborator access. |
| OD-2 | **Polling vs webhooks.** | **Daily poll + manual pull webhook.** PocketSmith doesn't expose webhooks; polling is the only option. Cadence: 06:00 Australia/Melbourne. |
| OD-3 | **Consent re-auth UX.** | **Bell + email via existing notification pipeline.** PocketSmith surfaces re-auth prompts in its own UI; Workflow 1's error branch detects upstream failures and writes a notification when a connection drops. |
| OD-4 | **Pending transactions.** | **Excluded from v1.** Posted only. |
| OD-5 | **CSV coexistence after the API is live.** | **Keep both flows.** Dedup namespaces (`csv:…` vs `pocketsmith:…`) don't collide. |
| OD-6 | **Household model.** | **One PocketSmith account, one developer key, both people's banks attached.** NAB + HSBC come through as joint accounts (after the bank-side opt-in in user-action §8.3); Westpac is Brad-only. Diana as a free Collaborator if she wants UI access; otherwise her involvement is just the bank-portal opt-in. |

## Risk + rollback

- **Tier-gating surprise** — PocketSmith's pricing page doesn't list "API access" as a feature row. Premium ($9.95) is the working assumption per research; could be Super-only ($19.95). Email support before subscribing.
- **Upstream outage** — PocketSmith uses Basiq + Yodlee. A Basiq outage breaks our feed too. Less control than direct Basiq, but direct Basiq isn't viable, so this is the same risk we'd carry via PocketSmith vs accept loss-of-feature for a few hours. The error branch + notifications make the failure visible.
- **PocketSmith viability** — smaller company than the enterprise vendors. Been around since 2008, NZ-owned, profitable. Not zero risk but reasonable. Mitigation: nothing breaks if we lose them — the CSV import path stays in place, Brad falls back to manual download for the affected window.
- **CDR consent drops** — third-party operators report consent practically lapses annually even where the rules allow longer. PocketSmith handles the re-auth prompts in their UI; Brad logs into PocketSmith and re-authorises when prompted. The error branch in Workflow 1 catches it within 3 days if Brad ignores their email.
- **n8n cron drift** — already mitigated via healthchecks.io for the existing two Family Planner workflows; new workflow inherits the same dead-man's-switch pattern.
- **Rollback path** — Workflows are isolated. Disabling both + ignoring `bank_inbox/` in the browser is a `feature_flag_bank_api_enabled` read-side check away. If v1 lands badly, flipping the flag off restores pre-v1 behaviour without touching CSV imports.

## Verification checkpoints

- **Checkpoint J — PocketSmith account stood up**: tier confirmed, NAB connected via PocketSmith UI, both Brad's personal AND joint accounts visible in PocketSmith. Developer key generated. `bank_inbox/user/pocketsmithUserId` written to Firebase. No transactions in Firebase yet.
- **Checkpoint K — NAB live in Family Planner**: Workflow 1 + browser-side ingestion shipped. Daily poll runs once; NAB transactions appear in the Import tab "Bank inbox" sub-tab with correct GL suggestions. Apply to planner; row flips to `applied: true`; planner reflects.
- **Checkpoint L — HSBC + Westpac live**: connected in PocketSmith UI. Next day's poll picks them up automatically (no n8n change needed — Workflow 1 pulls all transactions across all connected institutions in one call).
- **Checkpoint M — Manual pull + re-auth dry-run**: "Pull now" button fires Workflow 2, returns a count, list refreshes via realtime listener. Force a re-auth prompt by leaving a connection idle past PocketSmith's threshold (or break it deliberately if their sandbox supports it); confirm Workflow 1's error branch writes a bell + email after the 3-day streak.

Pass all four → mark Backlog #4 done in [HANDOVER.md](../HANDOVER.md), tag a release (v2.4 candidate), update `routines.md` with the two new workflow entries.

---

**Next step:** Translate this spec into [tasks/plan-bank-api.md](plan-bank-api.md) with ordered implementation steps + acceptance criteria, following the same pattern as `plan-polish.md`. Plan should ordering-respect the four-checkpoint structure above (J → K → L → M) and surface which steps are user-action-blocked (e.g. K requires §8.1–§8.6 first).
