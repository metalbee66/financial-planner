# Family Planner — Manual Action Tracker

Manual ops Brad needs to do that aren't code changes. I (Claude) maintained this list throughout the project and walked through it with Brad at project completion (Phase 8 sign-off).

> **Convention:** items are checked off when **you** confirm they're done; I won't tick them speculatively. Items added by me along the way appear with the date and the task that surfaced them.

**Phase 8 walkthrough — 2026-05-24.** Decisions resolved with Brad; items in-scope for the v2.0.0 release are ticked, deferred items are flagged and rolled forward into the v2.1 backlog at the bottom.

---

## Decisions still pending

| # | Decision | Resolution (2026-05-24) | Notes |
|---|---|---|---|
| D1 | Firebase project rename: keep `financial-planner-e85d4-default-rtdb` or migrate? | **Keep existing.** | Cosmetic mismatch with the new app name accepted; no migration risk taken. Revisit if/when Firebase costs or naming becomes blocking. |
| D2 | GitHub repo rename: `financial-planner` → `family-planner`? | **Keep existing.** | Live URL `metalbee66.github.io/financial-planner/` stays stable. Defer indefinitely. |
| D3 | Email from-address: personal Gmail vs M365 business email? | **M365 business email once that mailbox exists; personal Gmail via app-password SMTP until then.** | Default accepted. Resolved in practice when the n8n workflow is built. |
| D4 | Celebration sound: own asset files, or WebAudio-synthesized? | **WebAudio tones.** | Shipped this way in Task 7.1 — no external assets, opt-in via prefs. |

---

## Pre-Phase-0 (before any code)

- [x] Confirmed editable copy of the plans; Brad reviewed [plan.md](plan.md) + [todo.md](todo.md) throughout.
- [x] Confirmed happy with **native ES modules** as the JS architecture (no bundler, no build step). Shipped in Task 0.2.

## Pre-Phase-6 (n8n infrastructure for email) — DONE 2026-05-26

> All Pre-Phase-6 infra prerequisites cleared in the 2026-05-25/26 session. Both n8n workflows live; Checkpoint G end-to-end verified. See `routines.md` for the live workflow inventory + the auth credential.

- [x] **n8n container running on Geekom** — shared with SenseAi (`https://n8n.dlbooks.com.au/`, Caddy reverse-proxy to `127.0.0.1:5678`, container TZ Australia/Melbourne since 2026-05-26 via `GENERIC_TIMEZONE`).
- [x] **n8n reachable via Tailscale / HTTPS** — `https://n8n.dlbooks.com.au` (Caddy + Cloudflare DNS-01 cert).
- [x] **n8n admin account** — SenseAi-owned, pre-existed.
- [x] **n8n base URL recorded** — `routines.md`.
- [ ] **M365 Outlook credential** — **deferred** (using D3 fallback). The drainer + digest workflows both use the existing `Gmail SMTP (bradsmyrkai)` credential, sending from `bradsmyrkai@gmail.com`. If/when an Azure AD App Registration with `Mail.Send` Graph scope is set up, swap the credential on the two `Send an Email` nodes — no other workflow changes needed.
- [x] **D3 resolved** — using Gmail SMTP fallback in production. Migrate to M365 mailbox when convenient.
- [x] **Firebase REST API auth** — used the legacy **Database Secret** (40-char shared secret) rather than a service-account JSON. Wired in n8n as the HTTP Query Auth credential **`Family Planner - Firebase RTDB`** (param `auth`). Secret was generated 2026-05-25 via Firebase Console → Project Settings → Service Accounts → Database secrets. Note: deprecated by Firebase but still works; revisit if it stops working someday.
- [x] **Firebase RTDB rules** — **no change needed** under the Database Secret auth path. The secret bypasses rules entirely, so n8n has admin-level read/write without per-path rule grants. The browser already has the right brad/diana auth scope.
- [x] **Test email arrives end-to-end** — verified 2026-05-26 in the Checkpoint G end-to-end test (see below).

## Pre-Phase-8 (migration sign-off)

- [x] **Backup of existing `pm_dlbooks` Firebase data** — Skipped. Task 8.2 deliberately preserved the legacy `pm_dlbooks` RTDB key intact, so the data is still in the Firebase console; a separate export wasn't needed for this migration. (Brad confirmed 2026-05-24 — "don't actually need it".)
- [x] **Verify migrated data** in the new Projects module matches the old PM DLBooks state — verified on the live site after the Task 8.1 push (2026-05-24).
- [x] **Sign off on retiring the legacy PM DLBooks tab** — confirmed 2026-05-24 (Task 8.2 shipped).

## At project completion (Phase 8 wrap)

- [x] Walked through this whole file with Brad; ticked or deferred every line. (2026-05-24)
- [x] Decided D1 + D2 (Firebase / repo rename) — both **keep existing**.
- [x] Tagged **v2.0.0** release in the repo.
- [x] Updated [CHANGELOG.md](../CHANGELOG.md) with full release notes.
- [x] Updated [HANDOVER.md](../HANDOVER.md) — modular monolith, email pipeline, where to add a new module.
- [x] Confirmed GitHub Pages live site reflects all changes after final push.

---

## Surfaced during implementation (added by Claude as we go)

<!-- Template:
- [ ] **2026-MM-DD** — During Task X.Y: <action>. Why it matters: <reason>.
-->

### Shipped 2026-05-26 (n8n delivery layer)

- [x] **2026-05-21 → done 2026-05-26** — Task 6.3: **n8n workflow draining `/household/family/email_queue/`** is **live as `FamilyPlanner: instant email drainer`**. Bumped from the originally-specced 60s cadence to **every 30 min** because per-minute fires were spamming the n8n execution log — the family-planner SLA tolerates the longer delay. Implementation note: instead of a Loop / SplitInBatches step, the workflow uses a single Code node that splits the Firebase map into items AND filters `sent !== true && failed !== true` in one pass. Uses the existing `Gmail SMTP (bradsmyrkai)` cred (D3 fallback), not the M365 Outlook node. Per-iteration shape:
  1. **Schedule Trigger** — every 30 min (Australia/Melbourne).
  2. **HTTP Request (GET)** — `https://financial-planner-e85d4-default-rtdb.asia-southeast1.firebasedatabase.app/household/family/email_queue.json` via the `Family Planner - Firebase RTDB` Query Auth credential.
  3. **Code in JavaScript** — splits the map into items, filters unsent + unfailed, adds `_id` (the Firebase key) for the PATCH.
  4. **Send an Email** — Gmail SMTP cred, From `bradsmyrkai@gmail.com`, To/Subject/HTML from each item.
  5. **HTTP Request (success branch)** — PATCH `email_queue/{_id}.json` with `{ "sent": true, "sentAt": "<iso>" }`.
  6. **HTTP Request (error branch)** — PATCH `email_queue/{_id}.json` with `{ "attempts": <n+1>, "failed": <n+1 >= 3> }`. Reach 3 → `failed: true` → Code filter drops it next cycle. Admin sub-tab surfaces the failure.

  **Old (still-true) why-it-matters:** without n8n the queue grows unboundedly. Now flushed every 30 min.

- [x] **2026-05-21 → done 2026-05-26** — Task 6.4: **daily-8am n8n workflow draining `/household/family/projects/digest_pending/{user}`** is **live as `FamilyPlanner: daily digest sender`**. Schedule Trigger daily 08:00 Australia/Melbourne. Code node mirrors the browser-side `composeDigestSummary` + `buildDigestEmail` helpers (same canonical NOTIFICATION_KINDS order, same plural-aware labels, same HTML structure with bullets + Open Family Planner link). PATCH clears each user's bucket only on send success.

  **Concurrent-write caveat still applies** (browser writes whole `projects` subtree, can race with n8n PATCH that clears `digest_pending/{user}` — edge-case overlap replays last night's entries the next day). Monitor `digest_pending/` in the Firebase console occasionally for stuck buckets.

### Deferred to v2.1 (n8n / Outlook layer) — superseded

- [x] ~~**2026-05-21** — During Task 6.3~~ — superseded by the 2026-05-26 build above.
- [x] ~~**2026-05-21** — During Task 6.4~~ — superseded by the 2026-05-26 build above.

### Carried into v2.1 backlog

- [x] **Checkpoint G** — **DONE 2026-05-26.** Both halves verified end-to-end.
  - **Browser-side half (5/5 pass, 2026-05-25):** (1) bell badge cross-tab + dropdown + deep-link; (2) instant-mode writes email_queue with `to`/`subject`/`status:pending`; (3) digest-mode bypasses email_queue while bell still fires; (4) master-off short-circuits both bell and queue; (5) self-action excludes the actor while still notifying co-assignees on a joint task.
  - **n8n delivery half (3/3 pass, 2026-05-26):** (1) drainer end-to-end — Diana posts a comment, Brad's bell ticks live, drainer fires within ~30 min, real email lands in `metalbee66@gmail.com`, Admin sub-tab flips that row to "sent"; (2) digest manual-execute — `composeDigestSummary` mirrored correctly (subject "1 new comment", body lists the comment as a bullet with the Family Planner deep link), `digest_pending/brad` cleared after; (3) bucket-bypass — flipping prefs back to Instant routes the next event to email_queue without entering `digest_pending`.

### Gaps surfaced 2026-05-26 (resolved)

- [x] **Architecture gap — new-task creation doesn't fire notifications** — **fixed 2026-05-26.** New-task and subtask submit paths now route through `commitTasksWithTriggers` with a synthetic `assignee_changed` trigger built from `t.assignees`; no event written to `task.events[]` (initial assignment is implicit). Self-action suppression handled downstream by `isSelfAction`. Seeder gating concern was moot — `maybeRunBusinessTransformSeed` etc. write the full task list via direct `state.projectsData.tasks = … ; fbSave(...)` and never enter the submit path.
- [x] **dependency_added notification kind** — **decided not to ship.** Considered as a v2.2 candidate; rejected because dependencies are typically added by the dependent task's own assignee, and a "you have a new dependency" bell wasn't worth the surface area.

### Open — n8n cron heartbeats (v2.2)

> The original "ping per fire doesn't suit 1,440 fires/day" concern was tied to the 60s drainer cadence. At the current **30-min** cadence the drainer fires 48×/day, well within healthchecks.io free-tier (no per-check rate cap; 20-check account limit; SenseAi uses 2 of those today). Per-fire heartbeat is fine; matches the existing `SenseAi-RecurringTasksCron` pattern in `routines.md`.

- [ ] **Wire heartbeats on both Family Planner workflows.** Two healthchecks.io checks + one trailing `Heartbeat` HTTP Request node per workflow. **The digest workflow is the more important one** (a silent 08:00 failure means Diana just doesn't get her digest and nobody notices for days). About 10 min of UI work.

  **Step 1 — healthchecks.io.** Sign in at <https://healthchecks.io> (Google SSO as `metalbee66@gmail.com` — same account as the SenseAi checks). Create two new checks via **Add Check**:

  | Check name | Schedule type | Period | Grace |
  |------------|---------------|--------|-------|
  | `FamilyPlanner-InstantDrainerCron` | Simple | 30 min | 30 min |
  | `FamilyPlanner-DailyDigestCron` | Simple | 1 day | 2 hours |

  Period+grace tuning: drainer alerts after ~1h of silence (two missed fires); digest alerts at ~10:00 if the 08:00 fire didn't ping. Each check returns a ping URL of the form `https://hc-ping.com/<uuid>`. Copy the URL from each check's **Settings → Ping URLs** panel — the URL itself is the secret, so keep it out of any committed file.

  **Step 2 — n8n drainer workflow.** Open `https://n8n.dlbooks.com.au/`, edit `FamilyPlanner: instant email drainer`. Add a new node at the **very end** of the success path (downstream of every other node):
  - Type: **HTTP Request**
  - Name: `Heartbeat`
  - Method: `GET`
  - URL: the `FamilyPlanner-InstantDrainerCron` ping URL from Step 1
  - Authentication: None
  - Leave all other defaults

  Position it so a workflow-level error (Firebase REST 500, n8n container restart mid-execution, etc.) prevents it from running — that's what makes it a dead-man's-switch. If the workflow does per-item branching, place `Heartbeat` after the branches converge (or off a "workflow finished" anchor) so it fires regardless of whether individual emails succeeded — what we're monitoring is **the schedule trigger ran the workflow to completion**, not per-email outcomes.

  **Step 3 — n8n digest workflow.** Same as Step 2 on `FamilyPlanner: daily digest sender`, using the `FamilyPlanner-DailyDigestCron` ping URL.

  **Step 4 — verify.** For each workflow: click **Execute Workflow** in n8n. Within ~5 seconds the corresponding healthchecks.io check should flip green ("up"). Wait for the next scheduled fire (~30 min for the drainer, next 08:00 for the digest) and confirm the check stays green. Then deliberately break the workflow once (e.g. temporarily disable the Firebase REST credential) and execute — the run should error before reaching `Heartbeat`, and healthchecks.io should email `metalbee66@gmail.com` after the grace window. Re-enable, execute, confirm green again.

  **Step 5 — update `routines.md`.** Flip the `**Healthchecks heartbeat:** not yet wired` paragraph in the Family Planner section to list both live checks (name + period × grace), matching the SenseAi pattern at the top of the file.

  **Defer:** the separate "queue-stuck check" workflow (hourly GET of `email_queue`, alert if any entry has `sent:false` AND `queuedAt > now() - 1h`). That's a different failure mode (drainer runs but Gmail SMTP is broken → silent backlog). For a household-volume app the in-UI bell badge already surfaces backlog visibility; revisit if it ever actually bites.
- [x] **Manual two-tab Firebase smoke** owed from the polish-round close-out (2026-05-21) — **done 2026-05-25.** Chrome regular (Brad) + Incognito (Diana) on live site. 7/7 checks passed: real-Firebase round-trip persisted comments + inline file + URL ref + milestone + dep; cross-tab realtime sync (deps clear on done, comments + milestone toggles propagate ~2 sec); PB.9 joint-assignee Joint chip + `Joint · 1` group + intersection-filter cross-tab; PB.7 status-derive ON→on-hold + OFF→snap-to-derived cross-tab; PB.8 Dashboard drill-down on Open tasks + Completed (last 30d) + Active-projects-correctly-inert + live re-render on Diana's status change. Surfaced one polish bug: Dashboard chart was stretching vertically on wide screens (preserveAspectRatio="none" + fixed height) — fixed in `d31ad98`.
- [x] **2026-05-24** — During Task 8.3 walkthrough: **build a one-off Asana → Projects importer**. Brad was locked out of his Asana project by a subscription gate; the original Claude-generated project tree lived in the shared chat at `https://claude.ai/share/d162fea2-bb74-48f1-a15a-4525bcb143e4`. **Resolved in v2.0.1.** Brad pasted the recovered JSON inline; instead of building a generic Asana fetcher, we embedded the literal payload in `seed-businesstransform.js` and applied the same `migrate-pm.js` idempotency pattern. The 9-stream + Milestones import shipped under the `business_transform_seeded` flag.
