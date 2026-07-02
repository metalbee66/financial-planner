# Family Planner — Modular Monolith — Task Checklist

Working list derived from [plan.md](plan.md). Manual ops tracked separately in [user-actions.md](user-actions.md). Mark a task complete only when its acceptance criteria + verification both pass.

> **Pre-flight (every session):** commit + push current state per CLAUDE.md before edits. Bracket-check JS files before commit.

---

## Phase 0 — Rebrand & Modular-Monolith Conversion

> **Highest-risk phase.** Refactors existing working code; needs a feature branch and full smoke test.

- [x] **0.1** Rebrand visible labels to "Family Planner" — XS — [plan §0.1](plan.md#task-01-rebrand-visible-labels-to-family-planner) — _done 2026-04-28, commit 5a988f7_
- [x] **0.2** Convert existing JS to native ES modules (no behaviour change) — L — [plan §0.2](plan.md#task-02-convert-existing-js-to-native-es-modules-no-behaviour-change) — _done 2026-04-28, commit 2f8c88f_
- [x] **0.3** Introduce module registry + thin shell (Finance + PM-Legacy modules) — L — [plan §0.3](plan.md#task-03-introduce-module-registry--thin-shell) — _done 2026-04-28, commit 83bcd04_
- [x] **0.4** Bootstrap Projects module skeleton — S — [plan §0.4](plan.md#task-04-bootstrap-projects-module-skeleton) — _done 2026-04-28, commit 3b73808_
- [x] **Checkpoint A**: app rebranded, monolith shape live, full Finance smoke test passes; user reviewed and merged each task

## Phase 1 — Projects CRUD

- [x] **1.1** Project entity CRUD (name, dates, status, description) — M — [plan §1.1](plan.md#task-11-project-entity--create--read--update--delete) — _done 2026-04-30, commit 0c93b0f_
- [x] **1.2** Participant management (brad/diana + external + remove-warning hook) — S — [plan §1.2](plan.md#task-12-participant-management-on-a-project) — _done 2026-04-30, commit fd8055d_
- [ ] **Checkpoint B**: project CRUD round-trips Firebase; user reviews

## Phase 2 — Tasks & Subtasks

- [x] **2.1** Task entity CRUD inside a project — M — [plan §2.1](plan.md#task-21-task-entity-within-a-project) — _done 2026-05-02, commit 38261be (Playwright harness in 76a8678)_
- [x] **2.2** Subtasks (one level deep, `parentTaskId`) — M — [plan §2.2](plan.md#task-22-subtasks-one-level-deep-parenttaskid) — _done 2026-05-03, commit c276906_
- [ ] **Checkpoint C**: task hierarchy persists correctly; user reviews

## Phase 3 — Task Richness

- [x] **3.1** Task dependencies + cycle detection — M — [plan §3.1](plan.md#task-31-task-dependencies--cycle-detection) — _done 2026-05-04, commit 116db1e_
- [x] **3.2** Comments thread (append-only) — S — [plan §3.2](plan.md#task-32-comments-thread-on-a-task) — _done 2026-05-04_
- [x] **3.3** Activity / audit-trail feed — M — [plan §3.3](plan.md#task-33-activity--audit-trail-feed-on-a-task) — _done 2026-05-04_
- [x] **3.4** File attachments (inline ≤500 KB + URL refs) — M — [plan §3.4](plan.md#task-34-file-attachments-inline--url-refs) — _done 2026-05-04_
- [x] **3.5** Milestone flag — S — [plan §3.5](plan.md#task-35-milestone-flag-on-tasks) — _done 2026-05-04_
- [ ] **Checkpoint D**: full task richness in two-user smoke test; user reviews

## Phase 4 — Per-Project Views

- [x] **4.1** List view (sort, group, filter) — M — [plan §4.1](plan.md#task-41-list-view-with-filtering--grouping) — _done 2026-05-07_
- [x] **4.2** Timeline (Gantt, month zoom + milestones; dep-arrow overlay removed 2026-05-19 — see PB.4 below) — L — [plan §4.2](plan.md#task-42-timeline-view-gantt-style-month-zoom) — _done 2026-05-07_
  - [x] 4.2a Bars only, no deps — _done 2026-05-07_
  - [x] 4.2b Dependency arrows + milestones overlay — _done 2026-05-07_
- [x] **4.3** Calendar (month grid) — M — [plan §4.3](plan.md#task-43-calendar-view-month-grid) — _done 2026-05-07_
- [ ] **Checkpoint E**: three views render against same data; user reviews

## Phase 5 — Cross-Project Views

- [x] **5.1** Overview tab (all projects at a glance) — M — [plan §5.1](plan.md#task-51-overview-tab-all-projects-at-a-glance) — _done 2026-05-07_
- [x] **5.2** Per-user summary tab — M — [plan §5.2](plan.md#task-52-per-user-summary-tab) — _done 2026-05-08_
- [x] **5.3** Dashboard tab (metrics + mini bar chart) — M — [plan §5.3](plan.md#task-53-dashboard-tab) — _done 2026-05-09_
- [x] **5.4** Files summary by project — S — [plan §5.4](plan.md#task-54-files-summary-by-project) — _done 2026-05-12_
- [x] **Checkpoint F**: aggregate views perform on 5+ projects, 50+ tasks; user reviewed _2026-05-15_ — 14 clean passes, 2 pass-with-caveat (Timeline dep arrows PB.4, Dashboard chart scaling PB.5), 0 fails. Backlog of polish findings below.

### Polish backlog — Phase 5 smoke findings (2026-05-15)

Not blocking Phase 6 — pick up between phases or as standalone polish.

- [x] **PB.1** Autofocus Name field on new-project form — XS — _smoke ad hoc_ — _done 2026-05-19, `94cbe78`_
- [x] **PB.2** Dropdown options low contrast / hard to read across the app (deps picker + others) — S — _smoke steps 5, 9_ — _done 2026-05-19, `1f28614`_
- [x] **PB.3** "Reset filters" button on list-view toolbar — XS — _smoke step 9_ — _done 2026-05-19, `94cbe78` (button only renders when state is non-default)_
- [x] **PB.4** Timeline dep arrows: **SHELVED 2026-05-19.** Three rounds of fixes (`16b4f10` y-offset + arrowheads, `70ca556` SVG-width, `7fe169e` visibility boost) all produced straight diagonals that cut through intervening rows. Arrows removed entirely from the Timeline view in the shelving commit. Dep relationships still surface on the per-task panel (Dependencies section) and via the `⛔ Blocked by N` row badge in List view. Proper visualisation would need Manhattan routing (right-angle doglegs) — not in PB-scope; revive under a Phase 7+ task if Brad wants it back.
- [x] **PB.5** Dashboard chart: bar/label scaling distorts when one bucket dominates (label clips, no headroom) — S — _smoke step 14_ — _done 2026-05-19, `cb17652` (chartMax rounds up ≥ max+1 or 1.2× max)_
- [x] **PB.6** Firebase SDK Cross-Origin-Opener-Policy warnings on sign-in popup (cosmetic; consider SDK upgrade or `signInWithRedirect`) — XS — _smoke step 16_ — _done 2026-05-19, `94cbe78` (switched popup → redirect)_
> **Polish round 2026-05-19:** PB.7/8/9 specced and planned. See [SPEC-polish.md](SPEC-polish.md) + [plan-polish.md](plan-polish.md). Hybrid PB.7 (`statusOverride` flag + `effectiveProjectStatus()`), multi-select array PB.9 (`task.assignees` + `readAssignees()`), and `dashboardView`-filter PB.8. Phase order: PB.7 → PB.9 → PB.8 → wrap.

- [x] **PB.7** Project status — hybrid derived default + `statusOverride` flag — _done 2026-05-20, `a152f59` + `b3cc3e5`_
  - [x] **PB.7.T1** Data layer — `statusOverride` field + `effectiveProjectStatus()` + 14 unit cases — _done 2026-05-19, `a152f59`_
  - [x] **PB.7.T2** UI toggle + read-path migration + `pb7-status-derive` E2E block (3 scenarios) — _done 2026-05-20, `b3cc3e5`_
- [x] **PB.9** Joint-assignee — multi-select `task.assignees` array, "Joint" chip for canonical Brad+Diana — _done 2026-05-20, `d40aa93` → `f69a85c`_
  - [x] **PB.9.T3** Data layer — `assignees` array + `readAssignees()` + intersection filter + joint-key group + MyTasks/options consumers + 22 unit cases — _done 2026-05-20, `d40aa93`_
  - [x] **PB.9.T4** Task form checkbox group + panel head chips + row chip helper — _done 2026-05-20, `41012fc`_
  - [x] **PB.9.T5** Group-by-assignee labels: canonical "Joint" + multi-ID comma-joined — _done 2026-05-20, `61acc36`_
  - [x] **PB.9.T6** taskPatchEvents arrays + notifications.js readAssignees + audit render Joint + dropped dual-write + `pb9-joint-assignee` E2E + 10 unit cases — _done 2026-05-20, `f69a85c`_
- [x] **PB.8** Dashboard cards drill down — `dashboardView` filter + inline list — _done 2026-05-21, `babb18f` + `f1b5836`_
  - [x] **PB.8.T7** `dashboardView` enum on `filterTasks` + `DASHBOARD_CARD_VIEWS` map + 11 unit cases — _done 2026-05-20, `babb18f`_
  - [x] **PB.8.T8** Clickable cards + keyboard nav + inline drill list + `pb8-drill-down` E2E (5 scenarios) — _done 2026-05-21, `f1b5836`_
- [x] **PB Wrap.T9** todo.md / HANDOVER.md / CHANGELOG.md refreshed for the polish round — _done 2026-05-21_
- [ ] **Polish Checkpoint DONE**: 9 of 9 PB items resolved. Manual two-tab Firebase smoke still owed (deferred by user during the round); run before declaring Phase 6 ready to start.

## Phase 6 — Email Notifications via n8n + In-App Bell

> Needs n8n + M365 set up — see [user-actions.md → Pre-Phase-6](user-actions.md#pre-phase-6-n8n--m365-infrastructure-for-email).

- [x] **6.1** Audit-event → notification trigger map — M — [plan §6.1](plan.md#task-61-audit-event--notification-trigger-map) — _done 2026-05-15, pure mapper + 61 new unit tests; harness now 251 unit cases (still 112 E2E)_
- [x] **6.2** In-app bell + per-user preferences UI — M — [plan §6.2](plan.md#task-62-in-app-bell--per-user-preferences-ui) — _done 2026-05-21, bell + badge in header, dropdown + cross-module nav + prefs modal; +19 unit cases / +10 E2E (now 130 E2E)_
- [x] **6.3** Email queue write + n8n workflow — M — [plan §6.3](plan.md#task-63-email-queue-write--n8n-workflow) — _browser-side enqueue done 2026-05-21 (+9 unit cases / +4 E2E, now 134 E2E). **n8n workflow build deferred** until SEi14 / M365 infra is ready — surfaced in [user-actions.md](user-actions.md) with the full workflow shape._
- [x] **6.4** Daily digest mode — M — [plan §6.4](plan.md#task-64-daily-digest-mode) — _browser-side accumulation done 2026-05-21 (+13 unit cases / +4 E2E, now 138 E2E). **Daily-8am n8n workflow build deferred** to [user-actions.md](user-actions.md) with the full workflow shape + concurrent-write caveat._
- [x] **6.5** Email queue admin panel — S — [plan §6.5](plan.md#task-65-email-queue-admin-panel) — _done 2026-05-21, admin-only sub-tab with status filter pills + retry + clear-sent sweep (+15 unit cases / +6 E2E, now 144 E2E)_
- [ ] **Checkpoint G**: two-user notification flow + daily digest tested end-to-end; user reviews (depends on Pre-Phase-6 n8n + M365 infra in [user-actions.md](user-actions.md))

## Phase 7 — Celebrations & Local AI

- [x] **7.1** Celebrations (confetti / emoji rain / chime, randomized pool) — M — [plan §7.1](plan.md#task-71-celebration-animations-on-task-complete--milestone--project-complete) — _done 2026-05-22, light/medium/full intensities + 5 light variants no-repeat queue + WebAudio chime opt-in via prefs modal (+9 unit cases / +5 E2E, now 149 E2E)_
- [x] **7.2** Local AI helpers (autocomplete, due-date guess, daily digest, stale flag, smart-sort) — M — [plan §7.2](plan.md#task-72-local-ai-helpers-no-api-calls) — _done 2026-05-24, five pure heuristics in new `local-ai.js`: frequency-weighted task-name datalist, median-offset due-date "Suggest" pill, Dashboard digest paragraph, ⏳ Stale badge on Overview cards, "Smart (urgency)" entry in the list Sort dropdown (+24 unit cases / +5 E2E, now 154 E2E)_
- [ ] **Checkpoint H**: celebrations + AI feel polished; user reviews

## Phase 8 — Migrate PM DLBooks → Projects

- [x] **8.1** Data migration (idempotent, preserves original) — S — [plan §8.1](plan.md#task-81-data-migration) — _done 2026-05-24, pure `migratePMDLBooksToProjects` in new `migrate-pm.js` + `maybeRunPMMigration` runner in `shell.js` gated by `pm_dlbooks_migrated_to_projects` flag on the projects root; legacy `pm_dlbooks` preserved (+10 unit / +4 E2E, now 158 E2E)_
- [x] **8.2** Retire PM DLBooks legacy module + update CHANGELOG — XS — [plan §8.2](plan.md#task-82-retire-pm-dlbooks-tab) — _done 2026-05-24, pm-legacy entry removed from `modules.js`, `renderPMTab` hook + `pm_dlbooks` listener dropped, `loadPM` kept in `shell.js` for the Phase 8.1 migration on fresh devices; Phase 0 regression test updated; legacy `pm_dlbooks` RTDB key preserved for 8.3 cleanup decision_
- [x] **8.3** Walk through [user-actions.md](user-actions.md) with user, tick or defer every item, tag v2.0.0 — _done 2026-05-24, D1/D2 resolved keep-existing, D3/D4 accepted defaults, Pre-Phase-6 + the two n8n workflows + Checkpoint G + two-tab smoke + Asana importer all carried into v2.1 backlog; CHANGELOG + HANDOVER refreshed; `v2.0.0` tag created_
- [x] **Checkpoint I — DONE**: tagged v2.0.0, HANDOVER updated, live site current

## v2.0.1 — Business transformation seed (content-only patch)

- [x] **v2.0.1** Import the SenseAi "Business transformation & scale — SPEC v2.0" project tree into Projects via a one-shot seed — _done 2026-05-24, `seed-businesstransform.js` + `maybeRunBusinessTransformSeed` runner in `shell.js` gated by `business_transform_seeded` flag; produces 10 projects (9 streams + Milestones) and ~280 tasks (+9 unit / +3 E2E, now 161 E2E); released as tag `v2.0.1`_
- [x] **v2.0.2** Delete the legacy `pm_dlbooks` data (Firebase + localStorage) — _done 2026-05-25, `deleteLegacyPMData` in firebase-sync + `maybeCleanupLegacyPMData` runner in `shell.js` gated by `pm_dlbooks_cleaned` flag; only runs after migration is complete; also drops vestigial pm_dlbooks load/save from `initialSync` (+3 E2E, now 164 E2E); released as tag `v2.0.2`_
- [x] **v2.0.3** Apply 2026-05-25 progress update from off-repo agent — _done 2026-05-25, `update-businesstransform-20260525.js` + `maybeApplyBusinessTransformUpdate20260525` runner gated by `business_transform_update_20260525_applied`; 16 patches (15 top-level + 1 child) covering Streams 1/2/4 + 4 milestones; UNCHANGED rows left for Brad's verbal confirmation (+4 unit / +3 E2E, now 166 E2E); released as tag `v2.0.3`_
- [x] **v2.0.4** Auth hotfix: revert `signInWithGoogle` to popup — _done 2026-05-25, Brad hit a sign-in loop in production after PB.6's redirect switch; Firebase compat layer didn't consume `getRedirectResult` and Chrome third-party cookie policy was dropping the in-flight auth state. Popup is more reliable; the COOP warnings PB.6 silenced are cosmetic. No test surface (Firebase blocked in E2E); released as tag `v2.0.4`_
- [x] **v2.0.5** Business-transform extras: three "Recommended additions" from the 2026-05-25 report — _done 2026-05-25, `add-businesstransform-extras-20260525.js` + `maybeAddBusinessTransformExtras20260525` runner gated by `business_transform_extras_20260525_applied`; 10 new tasks: Document Services platform (parent + 7 children incl. blocked Phase 1.5) under Stream 4, Public-surface security hardening child under Stream 1 / Phase 1 Auth, Header nav IA refactor Phase 2 top-level under Stream 1 (+8 unit / +5 E2E, now 171 E2E); released as tag `v2.0.5`_

## v2.1 hotfix — n8n cron heartbeats short-circuit on empty queue

- [x] **v2.1.1** Fix `FamilyPlanner-InstantDrainerCron` heartbeat — XS — _**FIXED LIVE 2026-06-23.** Confirmed the bug from the live wiring (`Code → Send → HTTP Request1 → Heartbeat`; empty queue → Code emits `[]` → whole chain skipped → no ping). **The planned Merge→Set tail was abandoned — PROVEN it does NOT work** (a `[]`-emitting node halts the chain; `alwaysOutputData` doesn't rescue zero-input). Applied the **dual-filter sentinel** instead: Code emits rows OR one `{_sentinel:true}`; Rows-only→Send→HTTP Request1→Heartbeat (busy, gated on success — and the all-fail error branch HTTP Request2 still does NOT reach the heartbeat, so an all-send-failure cycle correctly alerts), Sentinel-only→Heartbeat (empty queue). 9 nodes, active. Heartbeat URL preserved._
  - **Bug (original):** healthchecks.io fired DOWN at 2026-05-26 17:22 +1000. n8n's per-item model: when the Code filter outputs 0 items, the Send → PATCH → Heartbeat chain runs against 0 items so `Heartbeat` never fires, yet n8n reports Success.
  - **Verify:** healthchecks.io `FamilyPlanner-InstantDrainerCron` flips/stays UP after the next empty-queue fire (every 30 min). Brad: watch the dashboard / confirm DOWN alerts stop.
- [x] **v2.1.2** Fix `FamilyPlanner-DailyDigestCron` for the same bug — XS — _**FIXED LIVE 2026-06-23.** Same dual-filter sentinel applied (digest's Code emits per-user digest rows OR one sentinel on empty `digest_pending`; Rows-only→Send→PATCH→Heartbeat, Sentinel-only→Heartbeat). Preserved the `onError: continueErrorOutput` on Send + the per-user `_user` PATCH. 8 nodes, active. Verify: healthchecks.io `FamilyPlanner-DailyDigestCron` stays UP after the 08:00 fire even on days with an empty digest bucket._
- [x] **v2.1.3** Update [routines.md](file:///C:/Users/brads/.claude/routines.md) with the empty-items pitfall + the dual-filter sentinel shape — XS — _done 2026-06-23 (note added in the Family Planner healthchecks section; **corrected** to the dual-filter sentinel, NOT the Merge/Set tail which was proven not to work). Also documented the CLI-activation-needs-restart gotcha._

---

## v2.2 hotfix — overdue / due-soon notifications never generated

- [x] **v2.2.1** Wire a daily server-side overdue/due-soon scan in n8n — S — _**LIVE + VERIFIED 2026-06-23** via SSH→`docker exec n8n` (no API key). Workflow `Family Planner: overdue/due-soon scan` (n8n id `fpOverdueScan01`), **active**, instant-only, 07:00 Melbourne, healthcheck `FamilyPlanner-OverdueScanCron` ping URL wired. Logic in [`n8n/overdue-scan.code-node.js`](../n8n/overdue-scan.code-node.js) (24/24); deployed JSON [`n8n/overdue-scan.workflow.json`](../n8n/overdue-scan.workflow.json) (ping URL is the secret — kept out of git, placeholder in repo). **Verified by read-only dry-run against REAL Firebase data**: 389 tasks → 11 emails (8 brad, 3 diana), routing + prefs gating correct, 0 muted/digest/no-email skips. Heartbeat uses the **dual-filter sentinel** topology (Scan emits rows OR a `{_sentinel}` item; Rows-only→Write→Heartbeat on busy days, Sentinel-only→Heartbeat on quiet days) — PROVEN live that the originally-planned Merge→Set tail does NOT work (a `[]`-emitting node halts the chain; `alwaysOutputData` doesn't rescue zero-input). **Open: digest-mode deferred (instant-only); delete leftover `probeEmptyItems01` + `fpOverdueDryRun01` scaffolding via n8n UI trash (no `delete:workflow` CLI in 2.19.5). NOTE: CLI activation needs a `docker restart n8n` to take effect (UI toggle is hot) — see [routines.md](file:///C:/Users/brads/.claude/routines.md).**_
  - **Bug:** Brad reported (2026-06-23) not receiving email notifications for overdue items. Root cause: the scan that detects overdue tasks is never run. [`computeTimeBasedTriggers`](../js/modules/projects/notifications.js#L361) (the pure detector that turns `dueDate < today` non-done tasks into `task_overdue` events, and same-day/tomorrow into `task_due_soon`) is fully written + unit-tested but has **zero call sites** outside its own tests. Every other notification kind (`task_assigned`, `comment_added`, milestone/project-complete, dep-unblock) is emitted at a user-action site via [`applyTaskPatch`](../js/modules/projects/index.js#L383) → [`foldTriggersIntoBuckets`](../js/modules/projects/index.js#L330) → email_queue. Overdue is the only **time-based** kind — nothing happens in the browser when a due date passes, so it needs a scheduled scan. HANDOVER.md §6.1 even flags this: _"task_due_soon / task_overdue … 6.2/6.4 will wire when to call it"_ — that wiring was deferred and never built. Net effect: no `task_overdue` event → no bell entry → no email_queue row → n8n drainer has nothing to send. **Distinct from v2.1.x** (that's about the heartbeat not pinging on an empty queue; this is about the queue rows never being written at all).
  - **Decision (2026-06-23):** scan runs **server-side in n8n, daily** — NOT browser-on-load. Brad's call: a browser scan only fires when someone opens the app, so "overdue" emails could lag days if the app sits unopened. A daily n8n cron guarantees they go out regardless.
  - **Fix shape:** new scheduled n8n workflow `FamilyPlanner: overdue/due-soon scan` (Schedule, daily ~07:00 Australia/Melbourne — before the 08:00 digest so an instant-mode user's overdue email and a digest-mode user's roll-up don't collide). GET `projects.json` (the single-blob projects state via the `Family Planner - Firebase RTDB` cred) → Code node that ports `computeTimeBasedTriggers` (overdue wins over due-soon; skip done/unassigned/dateless) **and** the per-recipient prefs gate — for each candidate recipient resolve `prefs[user]`, honour master + per-kind toggle, and split instant vs digest:
    - **instant-mode** recipients → write an `email_queue` row (mirror [`buildEmailQueueEntry`](../js/modules/projects/notifications.js#L518) shape exactly: `to`, `subject` `[Family Planner] Overdue: <name>`, `bodyHtml` with escaped summary + deep link, `sent:false`, `attempts:0`, `failed:false`) so the existing InstantDrainerCron sends it.
    - **digest-mode** recipients → append to `digest_pending[user]` (mirror [`buildDigestEntry`](../js/modules/projects/notifications.js#L757)) so the 08:00 DailyDigestCron rolls it in.
  - **Cadence (decided 2026-06-23):** re-notify **every day, no cap, no dedupe.** Brad's explicit call — an overdue item should keep nagging daily until it's done or its due date changes. This removes all marker/`scan_state` complexity: the scan is stateless, just runs daily and emails every qualifying task to its assignee every time. (Trade-off accepted: a task ignored for two weeks generates ~14 emails. That's the intended "keep nagging" behaviour for overdue items.)
  - **Heartbeat (AS BUILT):** the v2.1.1 Merge→Set (Always Output Data, Execute Once) tail was the plan, but PROVEN live on n8n 2.19.5 that it does NOT work — a node emitting `[]` halts the whole downstream chain and `alwaysOutputData` does not rescue a zero-input node. Replaced with a **dual-filter sentinel**: Scan emits real rows OR one `{_sentinel:true}` item on a quiet day; a "Rows only" Filter → Write → Heartbeat (busy days, heartbeat gated on write success = dead-man's-switch holds) and a "Sentinel only" Filter → Heartbeat (quiet days). Healthcheck `FamilyPlanner-OverdueScanCron` (1 day / 2 h). **This supersedes the v2.1.1 Merge→Set advice — the daily-digest fix (v2.1.2) should use the same dual-filter sentinel shape, NOT Merge→Set.**
  - **Verified (2026-06-23):** read-only dry-run (a temporary webhook workflow using the real Firebase cred, NO email_queue write) ran against live data → 389 tasks, 10 overdue + 1 due-soon, 11 would-send (brad 8 / diana 3), 0 skipped. Activated live after the dry-run confirmed the blast radius. (CLI executor races n8n on port 5679 so direct headless `n8n execute` is unavailable; the webhook dry-run was the workaround.)
- [x] **v2.2.2** Update [routines.md](file:///C:/Users/brads/.claude/routines.md) Family Planner table + healthchecks table with the new `FamilyPlanner: overdue/due-soon scan` workflow + `FamilyPlanner-OverdueScanCron` check — XS — _done 2026-06-23; also recorded the empty-items pitfall + dual-filter fix + the CLI-activation-needs-restart gotcha as reusable lessons._
- [ ] **v2.2.3** (consider) Port the scan into the browser-on-load path too as a fallback, deduped against the same marker — XS — deferred unless the daily cron proves unreliable; logged so the option isn't lost. The pure detector already exists, so this is just a call site + dedupe check.

---

## v2.4 — Browser-automated scraping pilot: HSBC + Selfwealth + AMP

> Pivoted twice in 24 hours: original PocketSmith plan abandoned (HSBC loans not CDR-shareable); CSV-parser-only plan replaced when Brad opted for browser-automated scraping from the Geekom. Plan at [`C:\Users\brads\.claude\plans\i-want-to-discuss-dapper-trinket.md`](file:///C:/Users/brads/.claude/plans/i-want-to-discuss-dapper-trinket.md). 3 scrapers covering 3 architectural patterns (multi-account transactions, balance-only, hybrid) — pilot validates the approach before scaling to the other 6 logins (NAB1, NAB2, Westpac, ANZ, Bankwest, IBKR).
>
> See [memory: project_bank_api_decisions.md](file:///C:/Users/brads/.claude/projects/e--Projects-Family-Planner/memory/project_bank_api_decisions.md) for the full discovery trail (Basiq → PocketSmith → CSV → scraping) and the rationale.

**Stack:** Playwright (headless) + Windows Task Scheduler + KeePass CLI + n8n on Geekom + Firebase `bank_inbox/{transactions,balances}/` + browser realtime listener → Import tab (transactions) / `accounts.js` (balances).

### Phase 0 — Brad's setup (no app code)

- [ ] **UA1** Confirm KeePass flavour (KeePass2 vs KeePassXC) — affects CLI choice
- [ ] **UA2** Create 3 KeePass entries: `Family Planner - HSBC netbank`, `Family Planner - Selfwealth`, `Family Planner - AMP`
- [ ] **UA3** Headed-browser login to each of HSBC, Selfwealth, AMP from the Geekom + enroll trusted-device where offered (establishes the `storageState` baseline)
- [ ] **UA4** Create 3 healthchecks.io checks: `FamilyPlanner-{Hsbc,Selfwealth,Amp}ScraperCron` (1d × 2h grace)
- [ ] **UA5** Create folders: `C:\BankScrapes\{hsbc,selfwealth,amp}\`, `C:\BankScrapes\logs\`, `C:\Vault\fp-state\`
- [ ] **Checkpoint J** — three throwaway scripts confirm KeePass read + healthcheck POST work

### Phase 1 — Scrapers (server-side)

- [ ] **T1** Bootstrap `scrapers/` top-level folder (sibling of `app/`); `package.json`; `npm install @playwright/test`; `npx playwright install chromium`; smoke-test `hello.spec.js` — M
- [ ] **T2** `scrapers/hsbc.spec.js` — login + 6-account randomised-order loop + per-account CSV export to `C:\BankScrapes\hsbc\YYYY-MM-DD\<slug>.csv`; partial-run exit code 5 — M
- [ ] **T2.5** `scrapers/selfwealth.spec.js` — login + 2-account balance loop + JSON per account — S
- [ ] **T2.6** `scrapers/amp.spec.js` — login + balance extraction + transactions CSV export (hybrid) — S
- [ ] **T3** `scrapers/lib/keepass.js` — CLI wrapper, password never logged — S
- [ ] **T4** `scrapers/lib/healthcheck.js` — POST to healthchecks.io URL on success — S
- [ ] **T5** Three PowerShell wrappers (`run-{hsbc,selfwealth,amp}.ps1`) with 0–90 min jitter sleep + shared `lib/wrapper-common.ps1` — S
- [ ] **T6** Three Windows Task Scheduler entries at 06:00 daily — S
- [ ] **Checkpoint K** — manual-trigger each scraper end-to-end; expected files present in dated folders; KeePass read works; healthchecks fire on success

### Phase 2 — Ingestion pipeline + browser UI

- [x] **T7** n8n ingest workflows (hsbc CSV, nab CSV, + authored-but-undeployed selfwealth/amp) — M — **HSBC + NAB LIVE on the Geekom 2026-07-02** (every 8 h). Code-node logic in [`../n8n/bank-ingest.code-node.js`](../n8n/bank-ingest.code-node.js) (self-check 50/50, incl. real-fs directory-ingest + NAB 10-col). Deploy: added `C:\BankScrapes:/data/bankscrapes:ro` bind-mount + `NODE_FUNCTION_ALLOW_BUILTIN=fs,path` to `n8n-compose.yml`, imported + activated both, wired `FamilyPlanner-{Hsbc,Nab}IngestCron` (8h/2h). First run wrote **243 tx** to `bank_inbox`; confirmed surfacing in the app Import → Bank inbox card. Single fs-reading Code node off the Schedule item (empty-items trap avoided; dual-filter-sentinel heartbeat). Idempotent `txKey` PUTs (no dedupe state); date-only storage (tz-shift guarded). **Selfwealth + AMP ingest JSONs authored but undeployed — waiting on their scrapers (T2.5/T2.6).**
- [x] **T8** Data layer in `app/js/data.js`: `DEFAULT_BANK_INBOX`, `sanitiseBankInbox`, `parseHsbcCsv`, `parseAmpCsv`, `isValidBalanceRecord` + unit cases — S — _shipped (data.test.js + import.js); box was stale_
- [x] **T9** `app/js/firebase-sync.js` realtime listener + initialSync + `state.bankInbox` init + render hooks — S — _shipped (firebase-sync.js `fbListen('bank_inbox')`); box was stale_
- [x] **T10** Browser Import tab Bank inbox sub-section (`renderBankInboxCard` + load-into-review) — M — _shipped (import.js + finance/index.js); box was stale_
- [x] **T10.5** Browser `accounts.js` auto-populate from `state.bankInbox.balances` with "auto" tag + asOf + manual-override — S — _shipped (accounts.js `autoBalances`/`autoRecordForAccount` + STALE_MS); box was stale_
- [x] **T11** E2E `bank-api — HSBC inbox` + `bank-api — auto-populated balances` — S — _shipped (smoke.spec.js describes at L3657/L3724); box was stale_
- [x] **Checkpoint L** — Firebase shows bank_inbox rows from real scraper runs (HSBC + NAB, 243 tx, 2026-07-02); browser surfaces them in the Import → Bank inbox card (Brad confirmed). Apply-to-Planner / manual balance override paths shipped in T10/T10.5 + E2E-covered (T11).

### Phase 3 — Burn-in (4 weeks)

- [ ] **UA6** Manual trigger all 3 scrapers end-to-end; verify CSVs/JSONs → Firebase → UI flow
- [ ] **UA7** 4-week burn-in: per-bank daily flow; watch for partial-runs, MFA expiry, UI changes, anti-bot signals
- [ ] **UA8** Week-4 per-bank decision gate: ship working scrapers, fall back to manual for fragile ones, write follow-up plan for remaining 6 logins if architecture validates

### Phase 4 — Wrap (only after Phase 3 decision gate)

- [ ] **T12** `routines.md` + `HANDOVER.md` v2.4 section + `CHANGELOG.md` + tag `v2.4` + two-tab Firebase smoke — XS

**Estimated effort:** ~18–22 hr for the 3-scraper pilot end-to-end; future bank rollouts amortise ~3–5 hr per added login.

---

## Resolved decisions (from review)

See [plan.md → Resolved Decisions](plan.md#resolved-decisions-from-review). The four still-open items are tracked as "Decisions still pending" in [user-actions.md](user-actions.md).
