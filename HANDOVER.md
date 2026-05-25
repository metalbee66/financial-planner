# Family Planner — Handover Notes

> **State as of 2026-05-25 — v2.0.0 SHIPPED + five patch releases on top.** v1.0.0 (Financial Planner) was renamed to **Family Planner** and restructured as a **modular monolith** across eight phases. v2.0.0 (the modular monolith + Projects module) tagged 2026-05-24. Five content / fix patches followed in 24 hours:
>
> - **v2.0.1** — Seeded the SenseAi "Business transformation & scale — SPEC v2.0" project tree (10 projects + ~280 tasks) via `seed-businesstransform.js`. Replaces the deferred Asana importer plan from v2.0.0; the data came from a Claude transcript Brad recovered after Asana subscription-gated him out of the original board.
> - **v2.0.2** — Deleted the legacy `pm_dlbooks` Firebase + localStorage key now that Brad signed off on the Phase 8.1 migration. Drops the pm_dlbooks load/save from `initialSync`. Also lands `tasks/BUSINESS-TRANSFORM-HANDOVER.md` so a different Claude session can pick up progress on the seeded project content (separate doc from this one — that one's about the planner's *contents*, this one's about the planner's *code*).
> - **v2.0.3** — Applied an off-repo agent's 2026-05-25 progress report against the v2.0.1 seed: 16 patches (Streams 1/2/4 + 4 milestones) marking what's actually shipped on the SenseAi side. "UNCHANGED — needs Brad confirmation" rows left for verbal review.
> - **v2.0.4** — Auth hotfix. Brad hit a Google sign-in loop in production. Root cause: PB.6 (2026-05-19) switched `signInWithGoogle` to `signInWithRedirect` to silence COOP warnings, but the Firebase v8 compat layer needs an explicit `getRedirectResult()` call we never added. Reverted to `signInWithPopup`. The COOP console warnings PB.6 fixed are back — they're cosmetic.
> - **v2.0.5** — Applied the three "Recommended additions" from the 2026-05-25 report that v2.0.3 deliberately skipped (flagged Optional). New `add-businesstransform-extras-20260525.js` appends 10 new tasks: Document Services platform (1 parent + 7 children, incl. blocked Phase 1.5) under Stream 4, public-surface security hardening as a child of Phase 1 Auth under Stream 1, and Header nav IA refactor Phase 2 as a top-level under Stream 1.
>
> **Pattern shared across v2.0.1 / v2.0.2 / v2.0.3 / v2.0.5** — each one is a one-shot runner in `shell.js` gated by a flag on the projects root (`business_transform_seeded`, `pm_dlbooks_cleaned`, `business_transform_update_20260525_applied`, `business_transform_extras_20260525_applied`). Flags thread through `DEFAULT_PROJECTS` / `loadProjects` / the firebase-sync realtime listener / `initialSync`, so the idempotency survives Firebase round-trips and works across devices. The E2E `beforeEach` pre-sets every flag to `true` so the auto-runners don't pollute existing tests; each release's own describe re-flips the relevant flag.
>
> **Test harness:** Playwright E2E now runs **171 tests** (was 154 at v2.0.0) plus a `tests.html` driver that executes the in-browser data-layer unit suite (~372 cases). Single `npm run test:e2e` covers both layers in ~13 min. `server.py` uses `ThreadingHTTPServer` (eliminated the `ERR_CONNECTION_REFUSED` / `ERR_ABORTED` flake); `FAMILY_PLANNER_NO_BROWSER` env var suppresses the auto-open browser tab during test runs.
>
> **v2.1 work queued in [tasks/user-actions.md](tasks/user-actions.md):** the two n8n workflow builds (instant email-queue drainer every 60s + daily 08:00 digest sender) blocked on the SenseAi-shared n8n + M365 Outlook infra on the SEi14 Geekom box; Checkpoint G two-user end-to-end notification flow; the manual two-tab Firebase smoke owed from the 2026-05-21 polish-round close-out. The Asana importer item is now ticked off via v2.0.1.

---

## v2.0.x architecture notes (one-shot runners + auth)

Worth carrying forward — same pattern will apply to any future content seed, data migration, or bulk update.

**One-shot runners.** v2.0.1 / v2.0.2 / v2.0.3 each shipped a one-shot function in `shell.js` (`maybeRunBusinessTransformSeed`, `maybeCleanupLegacyPMData`, `maybeApplyBusinessTransformUpdate20260525`) that fires once per device per release, gated by a flag on the projects root. Phase 8.1's `maybeRunPMMigration` is the original of the pattern. To add a fifth: (1) drop a new pure module under `js/modules/projects/`, (2) add a `*_applied` (or `_seeded` / `_cleaned`) flag to `DEFAULT_PROJECTS` in `data.js`, (3) backfill it in `loadProjects`, (4) mirror it through the realtime listener and `initialSync` in `firebase-sync.js`, (5) wire the runner in `shell.js` after the existing runners in the runner chain, (6) add `<flag>: true` to the E2E `beforeEach` so existing tests don't trip the new auto-runner. The runner chain order matters — `maybeApplyBusinessTransformUpdate20260525` is explicitly gated on `business_transform_seeded === true` so it never fires on a device that hasn't seeded; ordering keeps prereqs deterministic.

**Match by name, not source ID.** The seed file generates fresh task IDs via `makeTaskId()`. The `id: 's1_t1'` strings in the source JSON are documentation pointers — they are NOT persisted as `task.id`. v2.0.3's update module matches by `(projectName, taskName)` for top-level patches and `(projectName, parentTaskName, taskName)` for child patches. Future patches should do the same. If a user has manually renamed a project or task in the UI, the patch will fail the match and show up in `report.unmatched` (console.warn) — not silently rewrite the wrong row.

**v2.0.3 idempotency caveat.** If a user manually reverts a status after an update has run, the runner does NOT re-overwrite on subsequent loads. The flag is per-projects-root, not per-task — once it's true, the runner short-circuits. Verified by E2E (`update is idempotent` test). Future bulk-update patches inherit this property by design; if you ever want a re-apply path, you'd need a per-task flag.

**Sign-in: `signInWithPopup` (NOT redirect).** v2.0.4 reverted PB.6's redirect switch after a production sign-in loop. The Firebase v8 compat layer doesn't auto-consume `getRedirectResult()` and Chrome's tightening third-party cookie behaviour drops the in-flight auth state between hops. Popup is the right default. The COOP warnings PB.6 silenced are cosmetic — accept them. If you ever revisit the redirect approach, you must call `firebase.auth().getRedirectResult()` explicitly in `initFirebase` (or wrap it as a separate post-init step) to finalise the post-redirect sign-in, AND you need to verify it works across Chrome / Firefox / Safari with strict cookie settings before merging.

**`pm_dlbooks` is gone.** As of v2.0.2 the legacy `pm_dlbooks` Firebase key is deleted on first boot after migration via `deleteLegacyPMData()` in `firebase-sync.js`. The `loadPM` import is still in `shell.js` so the Phase 8.1 migration can source `state.pmData` on the rare fresh-device boot that hasn't migrated yet (gracefully returns DEFAULT_PM, runner short-circuits on the migration flag). The `pm-legacy/` source files stay on disk, archived. `initialSync` no longer loads or pushes `pm_dlbooks` — fresh-Firebase installs don't recreate the key.

---

## Polish round architecture notes (PB.7 / PB.8 / PB.9)

Worth carrying forward — these patterns now sit in the data layer and any future module change should respect them.

**PB.7 — `effectiveProjectStatus(project, tasks)`** is the single read path for project status. The form's status dropdown initialises to the effective value when override is OFF so toggling ON freezes that value into stored; toggling OFF snaps the dropdown back to the about-to-derive value. `sanitiseProject` defaults `statusOverride=true` on legacy records whose stored status is `on-hold` or `cancelled` (those aren't derivable), `false` otherwise. Read-path consumers wired through `resolveProjectStatuses(projects, tasks)` in `index.js`: Overview cards, sort-by-status, Dashboard `activeProjects` count, project detail header.

**PB.9 — `readAssignees(task)`** is the canonical reader for assignees. Returns the `assignees` array if non-empty; falls back to `[t.assignee]` if the legacy string is set; else `[]`. Every consumer in `data.js`, `notifications.js`, and `index.js` reads through it — the legacy `assignee` field is never written for new tasks but is tolerated forever on read. `sanitiseTask` drops the legacy field on output, so storage normalises after the first load. `filterTasks` uses intersection semantics (selecting "Brad" includes joint tasks). `groupTopLevelTasks` buckets by sorted-comma-joined key; `groupLabelFor` collapses the canonical `'brad,diana'` to "Joint", comma-joins other multi-ID keys. `renderAssigneeChipsHtml(task)` is the shared chip-rendering helper.

**PB.8 — `DASHBOARD_VIEWS` + `DASHBOARD_CARD_VIEWS`** in `data.js`. `filterTasks(list, { dashboardView, today, flat })` picks a date-aware predicate; window edges exactly mirror `computeDashboardMetrics` so card counts and drill-row counts match. The `flat: true` option skips the scaffold-keep so cross-project drill lists don't inflate above the headline. Dashboard cards listed in `DASHBOARD_CARD_VIEWS` are drillable; `activeProjects` is deliberately absent.

---

## Phase 6 + 7.1 architecture notes (notifications, email, celebrations)

These patterns landed across the 6.2 → 7.1 commits and are now the canonical shape — respect them when building 7.2 / 8.x.

**Storage layout.** Everything Phase-6 added is a sibling under the existing single `projects` Firebase key, except `email_queue` which is a sibling of `projects` (top-level). One blob per save preserves the Phase-1 single-listener pattern; the per-user buckets just live inside it.

```
/household/family/
├── projects/
│   ├── items[]              Projects
│   ├── tasks[]              Tasks (flat, joined by projectId)
│   ├── notifications/       { [participantId]: [bell entries, oldest→newest, cap 30] }   (6.2)
│   ├── prefs/               { [participantId]: { master, mode, kinds } }                 (6.2)
│   └── digest_pending/      { [participantId]: [digest entries, append-only] }           (6.4)
└── email_queue/             { [eq_id]: full email-queue entry }                          (6.3)
```

`email_queue` is **top-level** (sibling of `projects`) because the n8n drainer reads it with a separate Bearer scope and the schema is unrelated to project data — co-locating would force n8n to know about projects/items shape. Browser writes go per-entry (`enqueueEmail(entry)` / `removeEmailQueueEntries(ids)`) so they can't clobber concurrent n8n PATCHes. The new `email_queue` realtime listener in `firebase-sync.js` mirrors n8n changes into a localStorage `email_queue` map and re-renders the admin tab via the new `renderEmailQueueAdmin` render hook (registered in `shell.js` alongside the existing hooks).

**Emission pipeline — `foldTriggersIntoBuckets(triggers)`** in `projects/index.js` is the single fan-out point. It takes one or more `{event, task, project}` triggers (audit events + synthetic kinds like `comment_added` / `project_completed`), resolves recipients per trigger via `candidateRecipientsForEvent`, and for each recipient:
  1. Checks `shouldNotifyUser(prefs[user], kind)` — gate on master + per-kind toggle. Fails → skip everything below.
  2. Adds a bell entry to the notifications bucket map.
  3. If `shouldEnqueueInstantEmail(prefs[user], kind)` — also write to `email_queue` via `enqueueEmail`. Mode is `instant` and recipient maps to an email via `participantEmail` (external assignees with no email on file are dropped silently).
  4. If `shouldAccumulateDigest(prefs[user], kind)` — also append to `digest_pending[user]`. Mode is `digest`; mutually exclusive with #3.

Returns `{notifications, digest_pending}`. Both callers (`commitTasksWithTriggers`, `commitProjectsWithStatusTrigger`) spread the result into `state.projectsData` and save once. **One mutation = one save = one bell + optional one email enqueue or digest append.**

**Notification record shape** (bell + n8n entries derive from this):
```js
{ id: 'n_…', kind, to, by, taskId, projectId, title, summary, at, read: false }
```
Kinds: `task_assigned`, `comment_added`, `dependency_unblocked`, `task_due_soon`, `task_overdue`, `milestone_completed`, `project_completed`. The full canonical list is `NOTIFICATION_KINDS` — adding a kind there + a row in `BELL_KIND_LABELS` / `DIGEST_KIND_LABELS` / `KIND_SUBJECT_PREFIX` / `QUEUE_KIND_LABELS` is the surface area to extend. `shouldNotifyUser` default-allows unknown kinds when master is on so new kinds don't silently mute existing users.

**Bell + prefs UI (6.2).** Bell lives in the shell header (visible across all modules — `<div id="notif-bell-host">` in `index.html`). Owned by the projects module — `mountBell({ host, onActivateProjects })` is called once by `shell.js` and is responsible for the button + dropdown. `refreshBell()` is the public hook called by `renderProjectsTab` (so firebase-sync's realtime listener picks up remote changes) and by every browser-side write that touches `notifications` or `prefs`. The dropdown survives a refresh because `refreshBell` updates the button in-place and re-renders only the dropdown body when open. Outside-click close uses `composedPath()` so mid-bubble DOM rewrites (e.g. clicking "Mark all read" rewrites the dropdown body before the bubble reaches the document) don't false-fire close. Prefs modal lives at document.body level under `#notif-prefs-modal` with three fieldsets: Delivery mode (radio), Events (per-kind checkboxes), Celebrations (sound checkbox — added in 7.1, see below). Cross-module nav on a bell-item click: the projects module exports `openTaskByIds(projectId, taskId)`, the shell wires `onActivateProjects` to flip the top-nav, then the bell handler calls `openTaskByIds` which flips to the detail view and slides the task panel open.

**Email queue (6.3) + digest (6.4).** Both are derived from the bell notification at emission time via `buildEmailQueueEntry(n, project, task, baseUrl)` and `buildDigestEntry(n)`. Subjects come from `KIND_SUBJECT_PREFIX` (e.g. `[Family Planner] Task assigned: <name>`), body HTML embeds the summary + a deep-link to the source task via `sourceUrl: <baseUrl>#/projects/<id>/tasks/<tid>`. Everything HTML-escapes user input (`escapeHtmlForEmail`) so a `<script>` in a comment can never break the email. The digest helpers (`composeDigestSummary` for "3 tasks assigned, 2 tasks overdue, 1 milestone completed" — canonical NOTIFICATION_KINDS order, plural-aware — and `buildDigestEmail` for the full `{to, subject, bodyHtml}`) are referenced by the deferred n8n daily workflow but also unit-testable in browser.

**Admin panel (6.5).** Hidden sub-tab under Projects, visible only when `isAdminUser(currentUserId())` is true. `ADMIN_USER_IDS = ['brad']` is hard-coded in `data.js` (two-user app — runtime config is overkill). UI: status filter pills with live counts → table of last 50 entries via `getQueueEntriesForAdmin(map, {status})` → Retry button on failed rows (resets `sent: false, attempts: 0, failed: false` via `retryQueueEntry` + writes back through `enqueueEmail`, which overwrites the same id so n8n picks it up next cycle) → footer "Clear sent older than 7 days" via `clearSentOlderThan(map, isoDaysAgo(7))` + `removeEmailQueueEntries(ids)`. `classifyQueueEntry` ranks `sent` > `failed` > `pending` so a previously-failed entry that eventually delivered renders sent.

**Celebrations (7.1).** New `celebrate.js` module — entirely browser-side. Three intensities (`light` / `medium` / `full`) classified by `classifyCelebration({wasMilestone, allTasksDoneAfter})` — all-tasks-done wins over milestone wins over light. `pickCelebrationVariant(intensity)` rotates a shuffled queue per intensity with anti-repeat across cycle boundaries (the first pick of a fresh cycle is swapped with the second if it would equal the previous cycle's last pick — guarantees no two-in-a-row even when wrapping). `triggerCelebration({intensity})` injects an overlay into `document.body`, runs CSS keyframes (confetti fall + emoji rise + center-screen badge/banner pop), and auto-clears after 3s. Overlay is `pointer-events: none` so it never blocks interaction. Wired into `applyTaskPatch` on status → done (with project-tasks lookup to detect all-done) and `commitProjectsWithStatusTrigger` on explicit project → completed flip; no double-fire on the derived-completion path because the all-done branch in `applyTaskPatch` covers it. Opt-in WebAudio chime (sine-wave arpeggio, 2/3/4 tones for light/medium/full — no external assets) toggled via the prefs modal's Celebrations fieldset; stored as `celebrate_sound_enabled` in localStorage, default false. `prefers-reduced-motion` shortens animation durations.

---

## Architecture

**Stack:** Vanilla HTML/CSS/JS, native ES modules, no build tools, no Node.js required.

**Hosting:** GitHub Pages (static) + Firebase Realtime Database (auth + data sync).

**Repo:** https://github.com/metalbee66/financial-planner (public; renaming this would break the GitHub Pages URL — deferred decision, see [tasks/user-actions.md](tasks/user-actions.md))

**Live:** https://metalbee66.github.io/financial-planner/

**Deploy:** push to `master` → GitHub Pages rebuilds in ~30 seconds. There is no build step.

**Plan & status docs:**
- [tasks/plan.md](tasks/plan.md) — full v2.0.0 implementation plan, 8 phases, ~25 tasks
- [tasks/todo.md](tasks/todo.md) — flat checklist with done/pending state
- [tasks/user-actions.md](tasks/user-actions.md) — manual ops Brad needs to do (n8n setup, Firebase rules, etc.)

---

## File Structure (post-Phase-0)

```
app/
├── index.html                          Thin shell: header + #top-nav + #module-host
├── css/style.css                       All styles
├── js/
│   ├── shell.js                        Entry point: Firebase init, mounts modules into #module-host
│   ├── modules.js                      Module registry (id, label, mount fn, dataKeys)
│   ├── state.js                        Single shared mutable state object across modules
│   ├── data.js                         Currency fmt, date helpers, budget defaults, save fns
│   ├── firebase-config.js              Firebase project config + allowed emails
│   ├── firebase-sync.js                Auth, fbSave/fbLoad/fbListen, realtime listeners
│   └── modules/
│       ├── finance/
│       │   ├── index.js                mount() + DOM template + sub-nav switching
│       │   ├── budget.js               Budget render + setupBudgetEditing
│       │   ├── planner.js              Planner render + setupPlannerEditing + schedule calc
│       │   ├── accounts.js             Accounts render + setupAccountsEditing
│       │   └── import.js               CSV parse + render + setupImport
│       ├── projects/
│       │   ├── index.js                            Module entry: list/detail/form views, task panel, subtask + dep + attachment + milestone + bell + admin panel + celebration wiring, activity feed, prefs modal, all event handlers
│       │   ├── data.js                             Project + task schemas, validation, list mutators, sanitisers, subtask + dep + comment + event + attachment + milestone helpers, load/save (incl. notifications + prefs + digest_pending siblings + the v2.0.x flag set), email↔participant resolvers, ADMIN_USER_IDS / isAdminUser
│       │   ├── notifications.js                    Notification pipeline: trigger map (6.1) + prefs helpers + read-state (6.2) + email-queue helpers + entry builder (6.3) + digest helpers + summary composer (6.4) + admin queue helpers (6.5)
│       │   ├── celebrate.js                        Celebration animations (7.1): classify, pick variant with anti-repeat, trigger CSS keyframe overlay, opt-in WebAudio chime
│       │   ├── local-ai.js                         Local heuristics (7.2): suggestTaskNames, suggestDueDate, composeDashboardDigest, isProjectStale, smartSortTasks — zero external API calls
│       │   ├── migrate-pm.js                       Phase 8.1: one-shot pure mapper from legacy `pm_dlbooks` shape → Projects shape
│       │   ├── seed-businesstransform.js           v2.0.1: literal SenseAi project payload + pure mapper; produces 10 projects + ~280 tasks on first boot
│       │   ├── update-businesstransform-20260525.js  v2.0.3: literal patch list + name-based matcher for the 2026-05-25 progress update
│       │   └── data.test.js                        Unit tests for everything above (run via /tests.html, ~364 cases)
│       └── pm-legacy/
│           ├── index.js                            Wrapper for pm.js — retired from the module registry in Task 8.2 but kept on disk
│           └── pm.js                               DLBooks PM source — migrated into projects in Phase 8.1, deleted from Firebase in v2.0.2; loadPM stays imported so the migration runner can source pmData on a fresh device
├── tests-e2e/
│   └── smoke.spec.js                   Playwright E2E smoke tests (166 tests covering Phase 1 → Phase 8 + v2.0.1 / v2.0.2 / v2.0.3 + unit-suite driver)
├── playwright.config.js                Chromium-only, reuses dev server on :8080
├── package.json                        Dev-only deps (Playwright). The deployed site stays vanilla JS.
├── package-lock.json                   npm lockfile
├── server.py                           Local dev server (`python server.py`) — ThreadingHTTPServer, respects FAMILY_PLANNER_NO_BROWSER
├── tests.html                          In-browser unit-test runner for data.test.js
├── sample-data/                        Sample CSV for testing import
├── CHANGELOG.md                        Version history (v1.0.0 → v2.0.4)
├── HANDOVER.md                         This file (planner code orientation)
├── tasks/BUSINESS-TRANSFORM-HANDOVER.md  Sister handover for the seeded SenseAi project *content* (10 projects, ~280 tasks) — for a different Claude session doing verbal progress updates with Brad
└── CLAUDE.md                           Project rules (deploy, test, code style)
```

---

## Module Architecture

A **module** is a self-contained sub-app that the shell mounts into a slot under the top-level nav.

### Adding a new module

1. Create `app/js/modules/<id>/index.js` exposing `export function mount(host) { ... }`. The host is a fresh `<div class="module-content">` you can fill via `host.innerHTML = TEMPLATE`.
2. Add an entry to `app/js/modules.js`:
   ```js
   import { mount as mountX } from './modules/x/index.js';
   // ... append to MODULES array:
   { id: 'x', label: 'X', mount: mountX, dataKeys: ['x_data'] }
   ```
3. The shell's top-nav, mounting, and visibility-toggle logic picks up the new entry automatically.

### Module lifecycle

- `mount(host)` is called **once** on app boot for each module.
- Switching top-nav buttons toggles `display: none/''` — no remount, so event handlers persist.
- Within a module, sub-nav and rendering are the module's own responsibility.

### Cross-module shared state

`app/js/state.js` exports a single `state` object. Every module imports it and reads/writes properties:
```js
import { state } from '../../state.js';
state.budgetCY = loadBudgetCY();
```
This replaced the pre-Phase-0 cross-file globals. ES module bindings are read-only, so the property-on-shared-object pattern is what gives us mutability across modules.

### Render hooks (for Firebase realtime sync)

`firebase-sync.js`'s realtime listeners need to call back into UI code without a hard import cycle. The shell registers callbacks at module-load time via `registerRenderHooks({ renderBudgetTab, renderAccountsTab, renderPMTab, renderProjectsTab })`. When another user changes data, the listener fires the appropriate hook.

---

## Key Design Decisions

### Data model (Finance module)
- All amounts stored as **weekly** base rates internally
- Conversion to monthly/quarterly/annual is computed on display
- **Revisions** are date-based overrides on any item:
  - `item.revisions = [{ fromDate, weekly, reason }]`
  - `getEffectiveWeekly(item, date)` returns the correct rate for a given date
- **contributionItems** is an array (auto-migrated from old flat object)
- **weekActuals** stores per-week confirmed/adjusted values with comments

### Persistence
- Save functions in `data.js` always call `fbSave(key, data)`
- `fbSave` writes `localStorage` and conditionally pushes to Firebase based on `useFirebase && currentUser`
- The pre-Phase-0 `patchSaveFunctions()` swap-after-sign-in trick was removed; ES module bindings are read-only

### Firebase
- Config in `firebase-config.js` (API key is safe to be public)
- Database URL: `https://financial-planner-e85d4-default-rtdb.asia-southeast1.firebasedatabase.app` (still has the `financial-planner` slug — see [user-actions.md](tasks/user-actions.md) D1 for the deferred rename decision)
- Auth: Google Sign-In, restricted to `metalbee66@gmail.com` and `dianaleshcheva@gmail.com`
- Data path: `household/family/{key}`
- Falls back to localStorage if Firebase is unavailable

### Currency formatting (in `data.js`)
- `fmt(n)` → `$1,234.56` or `$-` (NBSP-padded for monospace alignment)
- `fmtPlain(n)` → `$1,234.56` for inputs (no padding)
- `fmtSigned(n)` → ` $1,234.56` or `-$1,234.56`
- `parseCurrency(str)` → number

### Payment scheduling
- `calcPaymentSchedule(item, weekDates)` returns a 52-week array
- Respects revisions: uses `getEffectiveWeekly(item, paymentDate)` per payment
- Mid-week revisions snap to the containing week's Monday

### Data model (Projects module)
- Single Firebase RTDB key `projects` under `household/family/`, holding `{ items, tasks, notifications, prefs, digest_pending }` — sibling sub-objects added through Phase 6 (see [Phase 6 + 7.1 architecture notes](#phase-6--71-architecture-notes-notifications-email-celebrations) above for the full layout, including the top-level `email_queue` key). The single-blob shape works because one mutation = one save, and the realtime listener that fires on remote changes re-renders everything in turn. Per-key splits weren't useful — every mutation has to update at least two of these atomically (mark-read updates notifications + retains digest_pending unchanged, etc.).
- A project: `{ id, name, status, startDate, endDate, participants[], description, createdAt, updatedAt, archivedAt }`. Status enum: `planning|active|on-hold|completed|cancelled`. IDs are `p_<base36-time>_<6 random base36>`.
- A task: `{ id, projectId, name, description, status, assignee, startDate, dueDate, priority, parentTaskId, dependsOn[], comments[], events[], attachments[], createdAt, updatedAt, completedAt }`. Status enum: `not-started|in-progress|review|done|blocked`. Priority enum: `low|normal|high`. IDs are `t_<base36-time>_<6 random base36>`. Tasks live as a **flat array** keyed by `projectId` rather than nested under each project — this keeps cross-project aggregate views (Phase 5) trivial.
- **Subtasks** (Task 2.2): a subtask is just a task with `parentTaskId` set to the parent's id. **One level deep** — gated by the UI (the "+ Subtask" button only renders on top-level task panels), not by the data validator. The data layer stays loose so older shapes load without migration. Helpers: `findSubtasks(list, parentId)`, `promoteSubtasksInList(list, parentId)` (sets `parentTaskId = null` on every child of `parentId`, returns same ref if no children), `deleteTaskCascadeFromList(list, taskId)` (removes the task and any of its children).
- **Dependencies** (Task 3.1): tasks reference prerequisites via `dependsOn[]` (array of task ids in the same project). Helpers: `wouldCreateCycle(list, taskId, depId)` (DFS from `depId` looking for `taskId`; treats deleted tasks as leaves so a deleted prerequisite isn't a phantom cycle), `addDependency` / `removeDependency` (immutable; same-ref no-ops for self-dep, duplicates, missing target, and cycle attempts on add / absent dep on remove), `countBlockingDeps(list, task)` (counts deps that exist in the list and aren't `done`; deleted prerequisites are skipped, not counted as blocking). Cycle attempts in the UI are not silently filtered — the picker offers all candidates except self/already-added, and the cycle check fires on submit so the user sees the rejection inline.
- **Comments** (Task 3.2): append-only comment thread per task (`comments[]`), one entry per `{ id: 'c_…', author, text, createdAt }`. Helpers: `createComment` (trims text, blank author falls back to `'anonymous'`), `addCommentToTask` (immutable append, bumps `updatedAt`, same-ref no-op when target task is missing). No edit/delete UI — by design, comments are part of the audit trail.
- **Activity / audit-trail feed** (Task 3.3): every task carries an append-only `events[]` of `{ id: 'e_…', kind, by, at, before, after }`. Tracked-mutation set is `{status, assignee, dueDate}` plus `{dependency_added, dependency_removed, attachment_added, attachment_removed}`. Helpers: `createEvent`, `addEventToTask`, and `taskPatchEvents(prev, patch, by)` — diffs a patch over the audit-tracked subset and returns one event per actual change. **All UI mutation sites flow through wrapper helpers** in `index.js` — `applyTaskPatch` (which auto-logs events), `applyAddDependency`, `applyRemoveDependency`, `applyAddAttachment`, `applyRemoveAttachment`. New code that mutates a task should go through these, not call `updateTaskInList` directly. Untracked field changes (name, description, priority, startDate) deliberately produce no events. The Comments section (3.2) was renamed to **Activity** in the panel — comments and events are merged and sorted by timestamp ascending so the newest entry sits at the bottom right above the composer.
- **Attachments** (Task 3.4): two shapes share a single `attachments[]` array:
  - `{ id: 'a_…', kind: 'file', name, size, type, dataUri, addedBy, addedAt }` — inline base64 file, hard cap at `MAX_INLINE_ATTACHMENT_SIZE = 500 KB` enforced at the input boundary so we never read an oversize file into memory.
  - `{ id: 'a_…', kind: 'url', name, url, addedBy, addedAt }` — http(s) URL reference; opens in a new tab.

  Helpers: `createFileAttachment`, `createUrlAttachment`, `validateFileAttachment`, `validateUrlAttachment`, `addAttachmentToTask`, `removeAttachmentFromTask`, `taskAttachmentSize` (sums inline-file bytes; URL refs contribute zero). Shared `formatBytes` is exported from `data.js` for both error messages and UI. A soft warning banner appears in the panel when cumulative inline-file bytes on a task exceed `TASK_ATTACHMENT_WARN_SIZE = 1 MB` (RTDB practical row limit). The "fall back to localStorage-only over 2 MB" path mentioned in plan §3.4's risk note is **not implemented** — current behavior is to just keep saving and the user can act on the warning.
- **Milestone flag** (Task 3.5): `isMilestone: false` boolean on the task schema; sanitiser backfills `false` for legacy payloads. Toggling milestone is **not** in the audit-tracked set, so it doesn't log an event. `mode.taskFilters.milestonesOnly` filters the per-project task list to milestones plus any non-milestone parent of a milestone subtask (so the indented render stays anchored). Filter state resets when navigating to a different project but persists across renders within the same project.
- **List-view sort / filter / group helpers** (Task 4.1): three pure helpers in `data.js` consume the entire per-project view layer.
  - `sortTasks(tasks, { by, dir })` — supports `by ∈ TASK_SORT_FIELDS = ['dueDate', 'name', 'priority']` × `dir ∈ {'asc','desc'}`. Tasks with no `dueDate` always sort to the end regardless of direction (predictable display rather than flipping); `name` uses `localeCompare` with `sensitivity: 'base'` (case-insensitive); `priority` orders `high → normal → low` for asc; `createdAt` is the universal tiebreaker. Returns a new array; pure — never mutates.
  - `filterTasks(tasks, { assignee, status, milestonesOnly })` — AND semantics. `null` filter values mean "no filter on that dimension". The legacy `applyTaskFilters` parent-of-matching-subtask scaffolding rule is generalised: a non-matching parent is included when one of its subtasks matches, so the indented render isn't orphaned. Subtasks of a parent that's only present as scaffolding are NOT auto-included — each task is judged on its own merits.
  - `groupTopLevelTasks(tasks, by)` — `by ∈ TASK_GROUP_OPTIONS = ['none', 'status', 'assignee']`. Returns `[{ key, tasks }]`. `status` uses canonical TASK_STATUSES order; `assignee` uses brad → diana → other participants alphabetically → unassigned (key `''`). Empty input always returns `[]`. Empty buckets are dropped.
- `updateTaskInList` auto-stamps `completedAt` on the not-done → done transition and clears it on the reverse. The UI relies on this for sorting and the "Done" strikethrough.
- All list mutators in `app/js/modules/projects/data.js` are immutable (return new arrays). UI calls `setProjects(items)` / `setTasks(tasks)` / `setBoth(items, tasks)` (single-save batched). Each writes via `saveProjects` → `fbSave('projects', ...)`. Cascade delete (project → its tasks) goes through `setBoth` so it's one atomic save and one toast.
- `sanitiseProject(p)` and `sanitiseTask(t)` backfill missing fields when older shapes load — no migration script needed for v1's single-version schema. Tasks default to `tasks: []` when older payloads (pre-2.1) load.
- Participants in v1 are constrained to `brad` and `diana` plus free-text strings. There is no per-user record; participant IDs are bare strings. Task `assignee` follows the same convention but can also be `null` (Unassigned).

### View structure (Projects module)
- The module's `index.js` renders one of three modes into its host element: **`list`** (project cards grid), **`detail`** (one project + its tasks), or **`form`** (create/edit project). `mode` is a small object held in the module — there is no router.
- The **task slide-in panel** (`#task-panel`) lives in `document.body` rather than the module host, so it can overlay any view. CSS transform animates it in from the right; backdrop click / Esc / Cancel close without saving. When a task panel is open and the underlying view re-renders (e.g. after a state change), `render()` re-attaches the panel from the latest task data, or closes it if the task disappeared.
- **Panel section order** (top to bottom): name → status/priority/assignee row → start/due dates row → description → milestone toggle → Dependencies → Attachments → Subtasks (top-level panels only) → Activity feed (events + comments interleaved) → composer → meta → footer (Delete / Cancel / Save). New panel sections always wire through `wireXSection(panel, t)` from `renderTaskPanel`.
- **Subtask UI**: the parent task's panel includes an inline "+ Subtask" section (button hides for subtask panels). Adding a subtask re-renders the panel so the new row appears in the panel's subtask list and as an indented `.task-row-subtask` row in the detail view. Inside the panel the subtask list is compact (name + status dropdown + delete); clicking a subtask name opens its own panel (which has no "+ Subtask" button — that's the depth gate).
- **Dependencies UI**: every task panel (top-level and subtask) has a Dependencies section after the description — a same-project picker (excluding self and already-added deps), an inline error line, and a list of current deps showing each prerequisite's name, status pill, and × to remove. Cycle attempts surface a clear "Cannot add dependency on \"X\" — it would create a cycle." error in the panel rather than being silently filtered. Task rows render an `⛔ Blocked by N` pill alongside the name when `countBlockingDeps > 0` and the task isn't done — the badge clears automatically via the standard re-render after every mutation.
- **Attachments UI**: per task panel, between Dependencies and Subtasks. A drop-zone + file picker (one shared hidden `<input type="file">`) handles inline files, a `<details>`-wrapped form handles URL refs (title + URL fields). Inline files render as chips with `<a download>` pointing at the dataUri; URL refs render with `target="_blank" rel="noopener noreferrer"`. The × on each chip prompts a native confirm before removing. Soft warning banner above the controls when total inline-file bytes exceed 1 MB.
- **Activity feed UI**: replaces the per-task Comments section. Comments + audit events are merged into one `#tp-activity-list` sorted by timestamp ascending — newest at bottom right above the composer. Comments render as cards with author + relative time. Events render as one-liners with kind-specific icon (◇/👤/📅/🔗/✂/📎/🗑) and a humanised summary ("Brad changed status from Not started to In progress"). Dep-event summaries resolve dep-ids against the current task list and fall back to "a deleted task" if the prerequisite is gone. Composer empty-input rejection is inline; Ctrl/Cmd+Enter posts.
- **Milestone UI**: a "Mark as milestone" checkbox in the task panel below the description. Milestone task rows pick up a `task-row-milestone` class (soft accent-coloured highlight) and a leading ◆ glyph in the task name. The per-project task header shows a "◆ Milestones only" filter checkbox; checking it hides non-milestones via `filterTasks` (preserves non-milestone parents of milestone subtasks). Filter state lives on `mode.taskFilters` and resets when navigating to a different project.
- **List-view toolbar UI** (Task 4.1): a `.tasks-toolbar` row sits between the task header and the add-task row, with four labelled fields: **Sort** (field dropdown `#tasks-sort-by` + `↑`/`↓` direction toggle button `#tasks-sort-dir`), **Group** (`#tasks-group-by`), **Assignee** filter (`#tasks-filter-assignee`), **Status** filter (`#tasks-filter-status`). The existing milestones-only checkbox stays in the header. State lives on `mode.taskSort` (`{by, dir}`), `mode.taskGroup` (string), and `mode.taskFilters` (extended with `assignee` + `status` keys; `null` = no filter). Sort/group/filter all reset when navigating to a different project. When `mode.taskGroup !== 'none'`, `.tasks-group-header` rows render between buckets with `Label · count` (status uses TASK_STATUS_LABELS; assignee uses participantLabel + "Unassigned"). Subtasks always travel with their parent's bucket regardless of group/sort. Done top-level tasks always pin to the bottom of their bucket sorted by `completedAt` desc. Empty-state text now distinguishes "no tasks at all" from "no tasks match these filters." The assignee filter dropdown auto-includes the project's participants plus any extra assignee values currently in use on tasks.
- **View-tab strip + Timeline (Gantt) view** (Task 4.2): a `.view-tabs` strip sits between the project meta and the task body with three tabs — `List`, `Timeline`, `Calendar`. Active view persists on same-project re-entry but resets to `List` when navigating to a different project (`mode.detailView`). The list-view toolbar (sort/group/filter) is now scoped inside the list body; switching tabs preserves toolbar state across renders. Timeline body lives in `renderTimelineBody(root, p, allTasks)` and uses two new pure helpers from `data.js`: `computeTimelineRange` (returns `{startDate, endDate, totalDays, months[], startMs, endMs}` from min/max task dates with 14-day padding snapped to month boundaries; `null` when no task has any usable date) and `computeTaskBars` (per-task `{leftPct, widthPct, days, isMilestone, parentTaskId, task, …}`; tasks with only one of start/due become 1-day bars; tasks with neither are excluded). Layout: a 32 px-tall `.timeline-axis` row with each month a `.timeline-axis-month` slice positioned by `leftPct/widthPct`, then `.timeline-rows` (one row per scheduled task) where each row is a 200 px label gutter + flex `.timeline-row-track`. Bars are status-coloured `.timeline-bar` `<button>`s (rgba palette mirrors the list-view status pills) — clicking opens `openTaskPanel`. Milestones render as `.timeline-milestone` (rotated diamond glyph centered on the date with `translateX(-50%)`) instead of bars — gold by default, green when done, red when blocked. **Dependency arrows were removed (PB.4 shelved 2026-05-19)** — straight diagonals cut through intervening rows; proper Manhattan routing was out of scope. Dep relationships still live on the data model and are surfaced via the per-task panel + the `⛔ Blocked by N` row badge. Tasks with no dates surface as a `.timeline-unscheduled` count below the chart; full empty-state (`.timeline-empty`) when no task has any dates.
- **Calendar (month grid) view** (Task 4.3): third view in the tab strip. Body lives in `renderCalendarBody(root, p, allTasks)` and uses two new helpers from `data.js`: `getMonthGridCells(year, month, todayIso)` (Monday-first 7-col grid; multiple-of-7 cells with `{date, day, inMonth, isToday, weekday}`; pads leading/trailing weeks from surrounding months) and `bucketCalendarTasks(tasks)` (`Map<dateIso, [{task, kind: 'due'|'start'}]>`; multi-day → due pill on dueDate + dimmer start pill on startDate; single-day or sole-date → one due pill; date-less tasks excluded). State: `mode.calendarYear` / `mode.calendarMonth` (default to today, persist on same-project re-entry, reset to today on project switch); `mode.calendarSelectedDate` carries the popover's anchor date. Layout: `.cal-month-header` (prev / `Month YYYY` label / next / `Today` button) + `.cal-weekday-header` (Mon..Sun) + `.cal-grid` (7-col CSS grid, rows auto-sized to ≥96 px). Each `.cal-day` cell carries `data-date="YYYY-MM-DD"`, holds a `.cal-day-number` plus a vertical `.cal-pills` stack of status-coloured `.cal-pill`s (the start variant gets `.cal-pill-start` for italic + 50% opacity). Today gets `.is-today`, out-of-month pad cells get `.is-outside`, and the current popover anchor cell gets `.is-selected`. Pill clicks `stopPropagation` so they only open `openTaskPanel`; clicking the cell anywhere else toggles a `.cal-day-popover` (absolute-positioned card top-right of the grid) that lists every pill on that day with `Due`/`Start` chips, each opening the task panel.
- **Overview tab — cross-project cards** (Task 5.1): the project list view (`mode.view === 'list'`) renders the existing `.projects-grid` but with three new derived stats per card. Three pure helpers in `data.js`: `computeProjectProgress(projectId, tasks)` (returns `{done, total, percent}` across the project's full task tree, subtasks included; empty project reports 0%/0/0 instead of NaN), `countOverdueTasks(projectId, tasks, todayIso)` (per-project count of `dueDate < today` non-done tasks; equal-to-today is NOT overdue), `findNextMilestone(projectId, tasks, todayIso)` (earliest non-done milestone with a `dueDate ≥ today`, falling back to the earliest past milestone if every milestone is overdue; null when no eligible milestone). Cards now render: a `.project-card-progress` bar (`{percent}% · {done}/{total} done`, fill width via inline `style="width:X%"`) when the project has tasks, or a `.project-card-progress-empty` "No tasks yet" hint otherwise; below that, an optional `.project-card-flags` row containing `.project-card-milestone` (`◆ DD/MM/YYYY`) and/or `.project-card-overdue` (`⚠ N overdue`). The toolbar gets a Sort dropdown driven by `sortProjectsForOverview(projects, tasks, opts)` with modes `updated|status|dueDate|percent` (`OVERVIEW_SORT_OPTIONS`); name is the universal tiebreaker; empty/0% projects sort to the end under percent so they don't masquerade as 0% done. Sort persists on `mode.overviewSort` across `goList()` round-trips so clicking into a project and back preserves ordering.
- **Dashboard tab — cross-project metrics** (Task 5.3): the project list view's sub-tab list is now driven by `LIST_SUBTABS = ['overview', 'mytasks', 'dashboard']` — `renderList` renders all three buttons from this array and dispatches to `renderOverviewBody` / `renderMyTasksBody` / `renderDashboardBody`. Two new pure helpers in `data.js`: `computeDashboardMetrics(projects, tasks, todayIso)` returns `{activeProjects, openTasks, overdueTasks, dueThisWeek, completedLast30Days, upcomingMilestones}` (active = status `'active'` AND not archived; open = status !== 'done'; overdue = dueDate < today not done; due-this-week = today..today+6 inclusive not done; completed-last-30 = status done AND completedAt within today-30..today inclusive; upcoming-milestones = milestone AND not done AND today..today+13). `computeWeeklyCompletionBars(tasks, todayIso, weeks=8)` returns rolling 7-day buckets in chronological order (oldest first, newest last) with `{startIso, endIso, completed}` per bucket. Plus a `DASHBOARD_WEEKS = 8` constant. UI: a `.dashboard-cards` grid (CSS auto-fit, 160 px min) with one `.dashboard-card[data-metric="<key>"]` per metric — large monospace value + label; the Overdue card flips red (`.dashboard-card-flag`) when count > 0. Below the cards, a single `<svg class="dashboard-chart" viewBox="0 0 400 120">` holds 8 `.dashboard-bar-group`s (each = `<rect class="dashboard-bar">` + value `<text>` if non-zero + bucket-start `<text>` x-axis label + hover `<title>`). Auto-refresh comes for free via the existing Firebase listener — every state change re-renders the module.
- **Files tab — cross-project attachments** (Task 5.4): the project list view's fourth sub-tab — `LIST_SUBTABS = ['overview', 'mytasks', 'dashboard', 'files']`. One new pure helper in `data.js`: `collectAttachmentsByProject(projects, tasks)` flattens every task's `attachments[]` into project groups, returning `[{projectId, projectName, items: [{attachment, taskId, taskName}]}]`. Groups sorted by project name case-insensitive (`localeCompare` with `sensitivity: 'base'`); items within a group sorted by `addedAt` desc so the newest uploads sit at the top. Projects with zero attachments and **orphaned tasks** (whose `projectId` no longer maps to a project) are dropped. UI: one `.files-group` per project with a `.files-group-head` (name + count badge) and a 6-column `.files-table` (Task / Name / Type / Size / Added by / Added on). Each `.files-row[data-task-id="..."]` is keyboard-focusable; click or Enter opens the source task via `openTaskPanel(taskId)` directly — same cross-project nav pattern as My Tasks (no view-switch needed; panel works regardless of which view is active). Inline files render type `File` + human-readable size via `formatBytes`; URL refs render type `URL` and size `—`. Empty state when no project has any attachments. Mobile breakpoint at <720px reflows to a 2-col grid via `grid-template-areas`.
- **My Tasks tab — per-user summary** (Task 5.2): the project list view dispatches between Overview and **My Tasks** sub-tabs (`.projects-subtab[data-subtab="overview"|"mytasks"]`) — `renderList` renders the sub-tab nav and forwards to either `renderOverviewBody` (the cards above) or `renderMyTasksBody`. State on `mode.listSubtab` (`'overview'|'mytasks'`), `mode.myTasksUser` (the selected assignee), `mode.myTasksCollapsed` (`{ <bucketKey>: bool }`, default `{ completed: true }`); all three persist across `goList()`. Three new pure helpers in `data.js`: `bucketTasksForUser(tasks, userId, todayIso)` returns `{overdue, thisWeek, upcoming, completed}` — overdue = `dueDate < today` not done, thisWeek = today through today+6 days, upcoming = `dueDate > today+6` OR no dueDate, completed = `status === 'done'`; sorted by dueDate asc within bucket, completed by `completedAt` desc with `updatedAt` fallback. `defaultMyTasksUser(email)` maps `metalbee66@gmail.com` → `brad`, `dianaleshcheva@gmail.com` → `diana`, fallback `brad`. `collectMyTasksUserOptions(tasks)` always emits brad+diana first, then external assignees alphabetically, deduped, ignoring `null`/empty. Layout: a toolbar with `#mytasks-user-select` dropdown, then four `.mytasks-section[data-bucket="..."]` cards in fixed order — Overdue (red count badge), Due this week, Upcoming, Completed (collapsed by default; click `.mytasks-section-header` to toggle). Each row is `.mytasks-task-row` with grid columns `project · name · due · status` (mobile breakpoint reflows to 2-col with grid-areas); click or Enter calls `openTaskPanel(task.id)` directly — the task panel works regardless of which view is active so cross-project nav requires no view-switch. Empty state (`.mytasks-empty`) renders inside the sections host when the selected user has zero tasks total. **`PARTICIPANT_LABELS`** + the existing `participantLabel(value)` helper (single source of truth — do not introduce a duplicate, the syntax check in `node --check` will catch it but cost a debug round) drive the dropdown labels.
- **Notification trigger map** (Task 6.1): every audit event written by Phase 3.3 (status_changed, assignee_changed, due_date_changed, dependency_added/removed, attachment_added/removed) is fanned out through `eventToNotification(event, task, project, user)` in `app/js/modules/projects/notifications.js`. Comments don't write audit events (3.2 contract unchanged) — the comment-add site fires a synthetic `comment_added` trigger directly. Project-status transitions to `completed` fire a synthetic `project_completed` trigger from the form-save site. **Seven notification kinds**: `task_assigned` (assignee_changed, new assignee), `comment_added` (comment_added, task.assignee), `dependency_unblocked` (derived from status_changed→done via `deriveDependencyUnblockedTriggers`, dependent.assignee), `task_due_soon` / `task_overdue` (synthesised by `computeTimeBasedTriggers` for scan-based polling — 6.2/6.4 will wire when to call it), `milestone_completed` (status_changed→done where task.isMilestone, all participants), `project_completed` (all participants). Self-actions never notify the actor — `isSelfAction` bridges the email-vs-participant-id namespace gap using `emailToParticipantId` (strict mapping, returns null for unknown emails; do **not** use `defaultMyTasksUser` for this check — its fallback-to-brad would silently match brad against any unrecognised email). Notifications persist as `state.projectsData.notifications = { <participantId>: [...notif] }` inside the existing `projects` RTDB blob (the same single-blob shape the rest of the module uses); per-user bucket is capped at `MAX_NOTIFICATIONS_PER_USER = 30` (matches §6.2's "last 30" bell UI plan, oldest trimmed off the front). **Where wiring lives**: `applyTaskPatch` collects every event from `taskPatchEvents` plus dep-unblock derivations, `applyAddDependency` / `applyRemoveDependency` / `applyAddAttachment` / `applyRemoveAttachment` pass their event through, `applyAddComment` (new wrapper used by the activity composer) fires the synthetic comment trigger, and `commitProjectsWithStatusTrigger` handles the project-completion case. All five flow through `commitTasksWithTriggers` / `commitProjectsWithStatusTrigger` which fold notifications into the bucket map alongside the originating mutation in **one save**. Notification record shape: `{ id: 'n_…', kind, to, by, taskId, projectId, title, summary, at, read: false }` — designed to roughly match the §6.3 email queue shape so the queue step is mostly a format change, not new fields. **Display-name resolution** (`actorLabel(by)`) prefers PARTICIPANT_LABELS for brad/diana and falls back to the raw value (email or external string) for unknown actors. No UI consumes notifications yet — that's Task 6.2 (in-app bell + preferences).
- **Delete-parent UX**: deleting a task that has no subtasks is a single `confirm()`. Deleting a task that *has* subtasks runs two sequential confirms — first to confirm the delete, then **OK = cascade-delete subtasks**, **Cancel = promote them to top-level**. Native confirms throughout (matches the rest of the codebase's aesthetic; no custom modal).
- Navigation: card click → `goDetail(id)`; "Edit project" button → `goEdit(id)` (form remembers `detailProjectId` so save returns to detail). Saving a *new* project jumps straight into the detail view so the user can start adding tasks.

---

## How to Deploy Changes

1. Edit files locally in `e:/Projects/Family Planner/app/`
2. Test at http://localhost:8080 (`python server.py`)
3. For risky changes (refactors, schema-affecting edits), use a feature branch + smoke test before merging to master. Phase 0 followed this pattern; see git log for examples.
4. `git add ...` (specific files, not `-A`), commit, fast-forward merge to master, `git push`
5. GitHub Pages rebuilds in ~30 seconds
6. Hard refresh (Ctrl+Shift+R) on the live site

---

## Conventions

- **No build tools** for the deployed app. ES modules served directly. Playwright is dev-tooling only (gitignored `node_modules/`).
- **Bracket-check JS files** before commit (`node --check <file>` or visual scan).
- **Run `npm run test:e2e` before committing any UI change.** 81 tests, ~6 min. The suite includes a `tests.html` driver that runs the in-browser data-layer unit suite (144 cases) — both layers verified in one command. If anything fails, fix the code or update the test — do not commit red. Use `--grep "<phase>"` (e.g. `npx playwright test --grep "Phase 4.3"`) for fast subset runs during dev — full suite once at the end.
- **Don't run multiple `npm run test:e2e` invocations in parallel.** Each spawns its own `python server.py` + chromium because two runs racing both decide no server exists yet (despite `reuseExistingServer: true`). Wait for one to finish before kicking off another.
- **Edit specific files, not `-A`** — avoids accidentally committing local-only artefacts.
- **Touch only what the task requires.** Refactors get their own commit/branch.

---

## Outstanding Items (pre-Phase-1 backlog)

These predate the v2.0.0 restructure and are still pending:

1. **Section alignment** — columns don't perfectly align between Income/Outgoings/Split/Residual sections
2. **Planner charges** — expandable charge entries per planner line (like revisions in budget), populating YTD actuals from those charges
3. **CSV parsers** for HSBC, ANZ, Westpac, Bankwest statement formats (NAB only currently)
4. **Bank API** — placeholder exists, no integration yet
5. **GL mappings Firebase sync** — was localStorage-only; check whether Phase-0 ES-module conversion incidentally fixed this (`saveGlMappings` now calls `fbSave`)
6. **Contribution auto-calc** — Brad/Diana Regular marked `autoCalc:true` but not yet recalculated when outgoings change
7. **Mobile polish** — responsive breakpoints exist but could be refined

The much larger v2.0.0 backlog (Projects module: CRUD, views, notifications, AI, celebrations, migration) lives in [tasks/plan.md](tasks/plan.md) and [tasks/todo.md](tasks/todo.md).

---

## Where to pick up

- **Active branch:** `master`. **v2.0.4 is the latest tag** (auth hotfix on top of v2.0.0 + 3 content patches). All five tags pushed to origin: `v2.0.0` `v2.0.1` `v2.0.2` `v2.0.3` `v2.0.4`. Live site: https://metalbee66.github.io/financial-planner/.
- **Latest verified state on the live site (2026-05-25):** Brad signed in OK after the v2.0.4 popup revert. All v2.0.1 → v2.0.3 one-shot runners have fired on his device — projects bucket has the seeded SenseAi content with the 2026-05-25 status patches applied, and `pm_dlbooks` Firebase key is gone.
- **v2.1 backlog (queued, no work in progress):**
  - **n8n / Outlook delivery layer** — two workflow builds are fully specced in [tasks/user-actions.md](tasks/user-actions.md): the 60-second instant email-queue drainer (Task 6.3) and the daily 08:00 digest sender (Task 6.4). Both block on the Pre-Phase-6 manual ops (n8n container on SEi14 Geekom, M365 Outlook credential, Firebase service-account Bearer, RTDB rules) — none of which are ticked yet. Workflow node graphs + the concurrent-write caveat are documented so an agent can author them via the n8n MCP tools once the Tailscale IP + creds are available.
  - **Checkpoint G** — two-user end-to-end notification flow + daily digest tested live. Blocks on the same n8n infra.
  - **Manual two-tab Firebase smoke** still owed from the 2026-05-21 polish-round close-out.
  - **Business-transform progress updates** — the off-repo agent will likely produce more progress reports (next one likely 2026-06-XX). Each one ships as its own `update-businesstransform-YYYYMMDD.js` + new flag + runner, following the v2.0.3 pattern. The "UNCHANGED — needs Brad confirmation" rows from 2026-05-25 are still in `not-started` waiting for Brad's verbal review.
  - **Recommended additions from the 2026-05-25 update report** (deliberately skipped in v2.0.3 because the doc flagged them as "Optional"): add a Document Services platform task under Stream 4 (shipped 2026-05-20, Reed first instance smoked 2026-05-22), the public-surface security hardening sub-item, and the header-nav IA refactor Phase 2. Surfaced for the user to opt in to via a future v2.0.x patch if desired.
- **Resolved this session that was on the v2.1 backlog:**
  - ~~Asana → Projects importer~~ — shipped as v2.0.1 with the literal JSON Brad recovered instead of building a generic fetcher.
- **Earlier outstanding items:** Polish round 9-of-9 done (commits up to `8b25366`); PB.4 timeline dep arrows shelved.
- **Deploy-pipeline incident from 2026-05-15** still relevant: the repo was silently flipped private at some point, disabling Pages from 2026-04-11. Re-enabled by flipping back to public + `POST /repos/.../pages`. Captured in [tasks/lessons.md → L1](tasks/lessons.md).
- **Other handover docs:** [tasks/BUSINESS-TRANSFORM-HANDOVER.md](tasks/BUSINESS-TRANSFORM-HANDOVER.md) orients a different Claude session to the SenseAi project *contents* (10 projects + ~280 tasks) for verbal progress walkthroughs with Brad. That doc is self-contained — readable without repo access — and is separate from this one (which is about the planner's code).
- **v2.0.x patch commits on master (newest first):**
  - `fbc35c0` — v2.0.4 Auth hotfix: revert sign-in to popup
  - `21260f2` — v2.0.3 Business-transform status update 2026-05-25
  - `11d46cd` — v2.0.2 Delete legacy pm_dlbooks data + business-transform handover doc
  - `73595eb` — v2.0.1 SenseAi business-transformation seed
  - `12ccdc4` — v2.0.0 wrap (Task 8.3)
- **Phase 8 commits on master (newest first):**
  - `f26b826` — Retire PM DLBooks (legacy) tab (Task 8.2)
  - `d94230f` — PM DLBooks → Projects data migration (Task 8.1)
- **Phase 7 commits on master (newest first):**
  - `a7657c8` — Local AI helpers (Task 7.2)
  - `905e0ef` — Celebrations + Beelink→Geekom doc fix (Task 7.1)
- **Phase 6 commits on master (newest first):**
  - `445f5cf` — Email-queue admin panel (Task 6.5)
  - `e3563c4` — Digest mode: browser-side accumulation (Task 6.4 partial)
  - `6a46680` — Email queue: browser-side enqueue (Task 6.3 partial)
  - `d2e56af` — Notifications: in-app bell + per-user preferences (Task 6.2)
  - `4cd8605` — Notifications: audit-event → notification trigger map (Task 6.1)
- **Polish backlog commits on master (newest first):**
  - `8b25366` — PB Wrap.T9: docs catch up on the polish round close-out
  - `f1b5836` — PB.8.T8: dashboard cards drill into an inline task list
  - `babb18f` — PB.8.T7: dashboardView filter primitive for card drill-down
  - `f69a85c` — PB.9.T6: audit + notifications go array-shaped, dual-write dropped
  - `61acc36` — PB.9.T5: group-by-assignee labels render Joint / multi-ID names
  - `41012fc` — PB.9.T4: assignee checkbox group + Joint chip render
  - `d40aa93` — PB.9.T3: assignees[] array + readAssignees + joint-aware data helpers
  - `b3cc3e5` — PB.7.T2: project form override toggle + derive status everywhere
  - `a152f59` — PB.7.T1: add statusOverride field + effectiveProjectStatus() helper
  - `b8846e8` — Polish round: spec + plan for PB.7/8/9
  - `1cf8adb` — Remove timeline dep arrows (PB.4 shelved)
  - `cb17652` — Polish: dashboard chart headroom so tallest bar's label fits (PB.5)
  - `1f28614` — Polish: dark-theme dropdown option contrast (PB.2)
  - `94cbe78` — Polish: autofocus new-project name, reset-filters button, COOP-safe sign-in (PB.1, PB.3, PB.6)
- **Phase 5 commits on master (newest first):**
  - `a6dadf9` — Handover: Phase 5.4 (Files tab) complete + harness now 112 tests
  - `58973af` — Files tab: cross-project attachments grouped by project (Task 5.4)
  - `84d256e` — Handover: record Phase 5.3 push
  - `9fa80d7` — Handover: Phase 5.3 (Dashboard tab) complete + harness now 105 tests
  - `b0564a2` — Dashboard tab: cross-project metrics + weekly completion chart (Task 5.3)
  - `9f7d1fa` — Handover: Phase 5.1 + 5.2 complete, harness now 95 tests
  - `0c9f15e` — My Tasks tab: cross-project per-user summary view (Task 5.2)
  - `17e316f` — Add favicon (carries the `favicon.svg` rebrand asset; pre-existing dirty worktree from before this session)
  - `1f3b3af` — Overview tab: percent complete, overdue + next-milestone, sort selector (Task 5.1)
- **Phase 4 commits on master (newest first):**
  - `00a5e63` — Handover: record Phase 4.3 commit hash
  - `c0c0f47` — Calendar (month grid) view (Task 4.3) + suppress dev-server browser auto-open during tests
  - `4c169c8` — Handover: record Phase 4.2 commit hash
  - `5c90cfd` — Timeline (Gantt) view (Task 4.2)
  - `686bc0b` — Handover: record Phase 4.1 commit hash
  - `f558f41` — List view sort/group/filter (Task 4.1) + dev-server threading fix
- **Phase 3 commits on master (newest first):**
  - `b8fd221` — Handover: Phase 3 complete (3.2–3.5) + harness now 51 tests
  - `7c47901` — Milestone flag on tasks (Task 3.5)
  - `618310d` — File attachments — inline + URL refs (Task 3.4)
  - `67cf64f` — Activity / audit-trail feed (Task 3.3)
  - `7ea9693` — Comments thread on tasks (Task 3.2)
  - `fdaacf7` — Handover: Phase 3.1 (deps + cycle detection) merged + harness now 29 tests
  - `116db1e` — Task dependencies + cycle detection (Task 3.1)
- **Phase 2 commits on master (newest first):**
  - `74ef283` — Handover: Phase 2.2 (subtasks) merged + harness now 24 tests
  - `c276906` — Subtasks within a task (Task 2.2)
  - `bc5aabb` — Handover: Phase 2.1 + Playwright harness
  - `76a8678` — Add Playwright smoke-test harness (18 E2E tests, Firebase blocked for hermetic runs)
  - `38261be` — Task entity CRUD inside a project (Task 2.1)
- **Phase 1 commits on master (newest first):**
  - `7ad3848` — Handover: Phase 1 wrap-up details
  - `0a50020` — Docs: log Phase 1 in CHANGELOG + update HANDOVER
  - `fd8055d` — Participant management on a project (Task 1.2)
  - `0c93b0f` — Project entity CRUD with tests (Task 1.1)
- **Next task:** none in v2.0.0 — release is shipped. v2.1 picks up from the backlog above (Asana importer + n8n delivery layer + Checkpoint G + the two-tab smoke).
- **Branch convention:** L/M-sized tasks went direct to master with scoped per-task commits and a green test suite before push from Task 3.2 onward. Same pattern continues into v2.1.

### Manual smoke on the deployed site (Checkpoint F — Phase 5 feature-complete)

> **Done 2026-05-15.** All 16 steps run through; verdict 14 clean / 2 pass-with-caveat / 0 fail. The two caveats (PB.4 Timeline dep arrows, PB.5 Dashboard chart scaling) are tracked in [tasks/todo.md → Polish backlog](tasks/todo.md). The session also surfaced a deploy-pipeline incident (Pages had been silently disabled since 2026-04-11 because the repo went private) — re-enabled and captured in [tasks/lessons.md → L1](tasks/lessons.md). The 16-step procedure below is kept as the reference template for the next checkpoint.

The Playwright suite (`npm run test:e2e`, 112 tests, ~9 min) covers the **functional** acceptance criteria for Phase 1.1, 1.2, 2.1, 2.2, 3.1–3.5, 4.1, 4.2, 4.3, **5.1**, **5.2**, **5.3**, and **5.4** plus a Phase 0 module-shell regression check, plus a `tests.html` driver that runs all 190 data-layer unit cases. Firebase is blocked at the network layer in tests so they run hermetically against localStorage.

What the harness **doesn't** cover (verify manually on https://metalbee66.github.io/financial-planner/ after the GitHub Pages rebuild):

1. **Real-Firebase round-trip.** Sign in as Brad, create a project, add a parent task with subtasks, **a dependency on another task in the project, a comment, an inline file attachment (~10 KB), a URL ref, and a milestone flag**, hard-refresh: everything persists. Open the Firebase console → payload at `household/family/projects` has `items[]` and `tasks[]`. Tasks with deps have `dependsOn: ["t_..."]`; subtasks have `parentTaskId` set; promoted tasks have `parentTaskId: null`; tasks with comments have `comments: [{id, author, text, createdAt}]`; tasks with audit events have `events: [...]`; attachments have `attachments: [...]` with `kind: 'file'` (and base64 `dataUri`) or `kind: 'url'`; milestones have `isMilestone: true`.
2. **Two-browser realtime sync.** Browser A signs in as Brad, B as Diana (or two private windows). A creates a project + two tasks; A sets task 2 to depend on task 1 → B sees the "⛔ Blocked by 1" badge on task 2 within ~2 sec. A marks task 1 done → B sees the badge clear. A removes the dep → B's panel reflects the empty deps list. **A posts a comment → B's activity feed shows it within ~2 sec with A's email as author.** **A toggles task 1 to milestone → B sees the ◆ glyph appear on the row.** **A attaches a small URL ref → B sees the chip appear in B's panel for the same task.**
3. **Cycle rejection wording.** In one browser, set up A→B→C and try to add C→A — the inline error should read "Cannot add dependency on \"A task\" — it would create a cycle." (or whatever the dep is named). Picker stays usable; deps list stays empty.
4. **Cascade vs promote behaviour (Phase 2.2).** Both confirms are native browser dialogs — verify the wording reads sensibly on Chrome (the second one should make it obvious that OK = delete subtasks and Cancel = promote, since native confirms can't have custom button labels).
5. **Activity feed ordering (Phase 3.3).** In one browser, on a single task: change status, post a comment, change due date — three entries should appear in the Activity feed in that order (newest at bottom right above the composer). The status and due-date entries render with their kind icons and an inline "Brad changed X from Y to Z" summary. Untracked field changes (renaming the task, changing priority) should produce **no** event.
6. **Attachment limits (Phase 3.4).** Drag-drop a 100 KB image → chip appears with download link. Try a 600 KB file → input rejects with a "File too large — limit is 500 KB, this one is 600 KB" message; no chip created and no `attachment_added` event in the feed. Add a URL ref with a malformed URL ("example.com") → rejected with "URL must start with http:// or https://". Cumulative inline files exceeding ~1 MB on one task should surface the soft warning banner.
7. **Milestone filter (Phase 3.5).** Mark 2 of 5 tasks as milestone, toggle "◆ Milestones only" → 2 rows. Toggle off → 5 rows. Switch projects and back → filter is reset (intentional — see View structure notes). Filter persistence across reload while on the same project is **not** wired (filters are session-state only).
8. **Visual layout.** Spot-check Projects list, detail view, slide-in panel on desktop. Subtask rows should have a clear left indent + border. The Activity / Attachments / Subtasks sections sit between the description and the panel footer in that order. The "⛔ Blocked by N" pill should fit on the row without breaking the grid. Milestone rows show a soft accent-coloured highlight + leading ◆ glyph. Mobile breakpoint at <600px stacks the deps-add and URL-ref forms, drops the attachment sub-meta column, and drops the badge below the name.
9. **List-view toolbar (Phase 4.1).** In a project with ≥5 tasks across mixed assignees and statuses (and 1 milestone): switch sort to `Name`, click `↑` → flip to `↓` and confirm reverse order; switch sort to `Priority` and confirm high → normal → low among open tasks (done still pinned to bottom). Switch group to `Status` and confirm headers appear in canonical order with `Label · count`; switch group to `Assignee` and confirm Brad → Diana → Unassigned ordering. Pick an assignee + a status → narrow the list; toggle milestones-only → narrow further. With filters that match nothing, confirm the empty state reads "No tasks match these filters." Back to the project list and into a different project — the toolbar resets to defaults (`dueDate ↑`, group `none`, filters cleared).
10. **Timeline view (Phase 4.2).** In the same project with mixed dates: switch the view-tab from `List` to `Timeline` → month-axis appears with at least one `MMM YYYY` slice; bars appear for every task with a start or due date, status-coloured. **Milestones**: render as ◆ diamonds (gold) at their date, not as bars. **Click a bar / diamond** → task panel opens with the right task. Add a task with neither start nor due date → it does NOT render as a bar; the `.timeline-unscheduled` line below the chart shows `N unscheduled tasks`. Switch back to `List` → toolbar state preserved. Switch projects → view resets to `List`. Resize the browser → bars reflow proportionally. Console clean. (Dep-arrow overlay was attempted and removed — see PB.4 in [tasks/todo.md](tasks/todo.md). Dep relationships still surface on the per-task panel and via the `⛔ Blocked by N` row badge.)
11. **Calendar view (Phase 4.3).** Same project. Switch to `Calendar` → month grid for the current month, weekday header Mon..Sun, today's cell highlighted. **Pills**: a single-day task shows one full pill on its `dueDate`; a multi-day task shows a faded italic pill on `startDate` and a full pill on `dueDate`. **Click pill** → task panel opens. **Click a day cell (avoid pills)** → a popover appears top-right of the grid listing every task that day with `Due` / `Start` chips; click a task there → panel opens. **Prev / Next** arrows navigate months and update the header label; **Today** snaps back. Add tasks across this month, next month, and 2 months ahead → all three appear when navigated to. Switch to a different project → view resets to `List` and calendar month resets to today. Console clean.
12. **Overview cards (Phase 5.1).** With ≥3 projects (mixed empty / partial / fully done) and at least one task with `dueDate < today`: the project list shows a percent-complete bar reading `{percent}% · {done}/{total} done` (or "No tasks yet" hint), an `⚠ N overdue` flag where applicable, and `◆ DD/MM/YYYY` next-milestone date for projects with at least one upcoming non-done milestone. Switch the Sort dropdown through `Updated`/`Status`/`Due date`/`% complete` and confirm cards reorder; click into a project and back — sort survives. Empty (`0/0`) projects sort to the **end** of the percent ordering, not as 0%. Console clean.
13. **My Tasks tab (Phase 5.2).** Sub-tab nav (Overview | My Tasks | Dashboard) appears at the top of the Projects module — including when zero projects exist. Click `My Tasks`: dropdown defaults to **Brad** (when not signed in) or to the user matching the signed-in email (`metalbee66@gmail.com` → Brad, `dianaleshcheva@gmail.com` → Diana). With ~5 tasks across two projects assigned to Brad with mixed due dates: confirm rows land in the right buckets — `dueDate < today` not done → Overdue (red count), today through today+6 → Due this week, beyond / undated → Upcoming, `done` → Completed. Completed section starts collapsed; click the header to expand. Each row shows project name + task name + due + status badge; click → existing task panel opens with the right task pre-loaded (cross-project nav works — closing the panel returns to My Tasks). Switch dropdown to Diana → tasks filter to Diana's; switch back. Click into a project and back — selected user + collapse state persist. Console clean.
14. **Dashboard tab (Phase 5.3).** Click `Dashboard`: six metric cards render in a wrap grid with monospace value + label — Active projects, Open tasks, Overdue, Due this week, Completed (last 30d), Upcoming milestones. Seed data: ≥2 active projects, ≥1 planning project, ≥4 tasks (one overdue, one due tomorrow, one done with `completedAt` today, one upcoming non-done milestone within 14 days) → confirm Active projects = 2, Open tasks = 3, Overdue = 1 (card flips red), Due this week ≥ 1, Completed (last 30d) = 1, Upcoming milestones = 1. Below the cards, the SVG bar chart shows 8 bars left→right (oldest → newest); the rightmost bar should be ≥ 1 once you've completed a task today. Hover a bar → native `<title>` tooltip "Week of MMM D — N completed". Modify a task status (e.g. mark another task done) → return to Dashboard → counts and chart bars update without manual refresh. Switch sub-tab back to Overview → Overview cards still render correctly. Console clean.
15. **Files tab (Phase 5.4).** Empty state first: with a project that has zero attachments anywhere, click `Files` → `.files-empty` card shows "Attach a file or URL to any task and it will appear here." Now: across **two** projects (Alpha, Beta), attach a mix on different tasks — Alpha/Task-A1 gets a small inline file (e.g. notes.txt ≤500 KB) and a URL ref (https://example.com/spec); Beta/Task-B1 gets one URL ref. Back to `Files`: two `.files-group` sections appear in alphabetical order (Alpha then Beta) each with a count badge; the table inside each shows columns Task / Name / Type / Size / Added by / Added on. File rows show type `File` + a non-empty size; URL rows show type `URL` + `—` for size. Items within a group sort newest-first by `addedAt`. Click any row → the existing `#task-panel` opens with the correct task pre-loaded; close it → still on Files (cross-project nav, no view-switch). Add a third project with **no** attachments → it does **not** appear in Files. Console clean.
16. **Console check.** Zero red errors on either browser after the above. (Browser-extension `asynchronous response… message channel closed` chatter is not an app issue — ignore it.)

If Phase 5.4 regresses, rollback is `git revert 58973af` — single self-contained commit. Earlier-phase rollbacks unchanged: 5.3 → `b0564a2`, 5.2 → `0c9f15e`, 5.1 → `1f3b3af`, 4.3 → `c0c0f47`, 4.2 → `5c90cfd`, 4.1 → `f558f41`, 3.5 → `7c47901`, 3.4 → `618310d`, 3.3 → `67cf64f`, 3.2 → `7ea9693`.

### Branch cleanup

Phase 4.3 landed direct on local master, no feature branch. Nothing to clean up locally.
- Local feature branches (`family-planner/phase-1-projects-crud`, `phase-2-tasks`, `phase-2-subtasks`, `phase-3-deps`) were deleted on 2026-05-04 after merge.
- The lingering `origin/family-planner/phase-2-tasks` was deleted on 2026-05-07.
- `family-planner/phase-3-deps` was never pushed.
- The Phase-1 cleanup routine `trig_01M8Bsfuv8XL1PgoQsz9EfHr` (fires 2026-05-06) is satisfied.

### Tests

Two layers of automated tests, but a single command runs both:

1. **`npm run test:e2e`** (~12 min, chromium-only, runs against the local dev server which auto-starts if not already up). 149 tests in `tests-e2e/smoke.spec.js`:
   - Phases 1.1 / 1.2 / 2.1 / 2.2 / 3.1 / 3.2 / 3.3 / 3.4 / 3.5 / 4.1 / 4.2 / 4.3 / 5.1 / 5.2 / 5.3 / 5.4 acceptance criteria (UI through-and-through).
   - Polish-round blocks: **PB.7 status-derive (3)**, **PB.8 drill-down (5)**, **PB.9 joint-assignee (1)**.
   - **Phase 6.2 — Notification bell + preferences (10)**: badge counts, dropdown rendering, cross-module nav, "Mark all read", prefs save/reload, prefs filter blocks future events.
   - **Phase 6.3 — Email queue browser-side (4)**: instant enqueue, digest defers, master-off skips email + bell, external assignees skipped silently.
   - **Phase 6.4 — Daily digest accumulation (4)**: digest mode skips email queue, multi-event accumulation, switch digest→instant routes next event to queue, persists across reload.
   - **Phase 6.5 — Email-queue admin panel (6)**: admin sub-tab visibility, empty state, newest-first table, filter pills, Retry button, Clear sent older than 7 days.
   - **Phase 7.1 — Celebrations (5)**: light/medium/full intensity selection, pointer-events non-blocking, sound toggle persists.
   - Phase 0 module-shell regression check.
   - **In-browser unit-suite driver** — visits `/tests.html` and asserts the summary reports 0 failures. This is what runs the **~317** pure-data tests in `js/modules/projects/data.test.js` (all the Phase-1–5 helpers plus the full Phase-6 + 7.1 notification / email-queue / digest / admin / celebrate helpers).

2. **Optionally** open <http://localhost:8080/tests.html> directly when you want a faster signal on a pure-data change without booting Playwright. Same suite, same expected result.

**Known flakes.** None currently. The previous `ERR_CONNECTION_REFUSED` / `ERR_ABORTED` intermittent (~1-in-3 full runs) was rooted in Python's single-threaded `http.server` choking under fast-fire ES-module asset load; **fixed in Phase 4.1 by switching `server.py` to `ThreadingHTTPServer`**. If a similar flake reappears, it's worth profiling the dev server again rather than reaching for `retries: 1`.

**Phase 6.2–6.5 / 7.1 test selectors (cheat sheet for 7.2 + 8.x tests):**

- Bell button: `#notif-bell-btn`; unread badge: `.notif-bell-badge`. Click the button to open the dropdown (`#notif-bell-dropdown`); items are `.notif-item` with `.notif-item-unread` for new entries. Mark-all-read is `#notif-mark-all`; settings cog is `#notif-prefs-btn`.
- Prefs modal: `#notif-prefs-modal`. Inputs: `#np-master`, radios `input[name="np-mode"][value="instant|digest"]`, per-kind checkboxes `input[data-kind="<kind>"]`, celebration sound `#np-celebrate-sound`, save `#np-save`, cancel `#np-cancel`.
- Email queue (localStorage-mode E2E): `localStorage.getItem('email_queue')` is a `{[id]: entry}` map. The browser writes per-entry both to Firebase and to localStorage — tests can seed the map directly via `page.evaluate(seed => localStorage.setItem('email_queue', JSON.stringify(seed)), entries)` then reload.
- Admin panel: `.projects-subtab[data-subtab="admin"]` (visible only when current user is in `ADMIN_USER_IDS`). Filter pills: `.admin-filter-pill[data-status="all|pending|sent|failed"]`. Rows: `.admin-row[data-id="..."]` with `[data-status="..."]`. Retry button: `.admin-retry-btn[data-id="..."]`. Clear-sent: `#admin-clear-sent-btn`.
- Celebrations: overlay element is `.celebrate-overlay` with `[data-intensity="light|medium|full"]` and `[data-variant="<id>"]`. Auto-clears after 3000 ms; use `toHaveCount(0, { timeout: 4500 })` to assert clear. Multi-task tests: if you mark the only-task done, classify escalates to `full`. To get `light`, add a second task first so the first-done isn't also all-done.

**Two-task-done test gotcha (7.1):** `applyTaskPatch` checks `findTasksByProject(next, project.id).every(t => t.status === 'done')` for the all-done detection. A project with only one task can never produce a `light` or `medium` celebration — the single done is always also "all done". Test plans that need `light` MUST add ≥2 tasks before completing one.

To add tests for the next phase: append a new `test.describe(...)` block to `tests-e2e/smoke.spec.js`. Use the existing `createProject()` helper at the top of the file. For subtask flows, reuse the `openTaskPanel` + `addSubtask` helpers in the Phase 2.2 block. For dep flows, the Phase 3.1 block's `openTaskPanel` is scoped via `.task-row` then `.task-row-name` to avoid matching the "Blocked by N" badge — copy that pattern. Watch out for `hasText` substring matching colliding with status-dropdown option labels (e.g. a task named "One" matches "Done" — use distinctive names like "Task A", "Task B"). Watch out for parent-delete dialog ordering: the handler fires **two** confirms back-to-back — collect them with a `dialogs[]` array and inspect by index, see Phase 2.2 tests for the pattern. **For attachments**: use Playwright's `setInputFiles({ name, mimeType, buffer })` against `#tp-attachments-file-input` to feed synthetic files — see the Phase 3.4 block for the 600 KB oversize-rejection example. **For activity events**: assert on `.task-panel-event[data-kind="..."]` — each event carries a `data-kind` attribute matching the schema (`status_changed`, `assignee_changed`, `due_date_changed`, `dependency_added`, `dependency_removed`, `attachment_added`, `attachment_removed`). **For list-view toolbar (4.1)**: read state from `#tasks-sort-by` / `#tasks-sort-dir` (button text is `↑`/`↓`) / `#tasks-group-by` / `#tasks-filter-assignee` / `#tasks-filter-status` / `#tasks-filter-milestones`. Group headers are `.tasks-group-header` with text format `Label · count`. **For timeline (4.2)**: switch with `.view-tab[data-view="timeline"]`. Bars are `.timeline-bar` `<button>`s with `hasText` matching the task name (also has `data-task-id`). Milestones are `.timeline-milestone` (also click-target, also matches `hasText` task name). Month axis cells are `.timeline-axis-month`. Empty-state is `.timeline-empty`; unscheduled count line is `.timeline-unscheduled`. Bar position lives in inline `style="left:X%; width:Y%"`. (Dependency-arrow SVG overlay was attempted as PB.4 then removed — no `.timeline-arrows` / `.timeline-arrow` selectors in the current build.) **For calendar (4.3)**: switch with `.view-tab[data-view="calendar"]`. Day cells carry `data-date="YYYY-MM-DD"` so tests address them directly. Today is `.cal-day.is-today`; pad days are `.cal-day.is-outside`; selected (popover-anchor) cell is `.cal-day.is-selected`. Pills are `.cal-pill` (`.cal-pill-due` for the full variant, `.cal-pill-start` for the dimmer multi-day-start variant). To click a day cell without hitting a pill (pill clicks `stopPropagation`), target `.cal-day-number` inside the cell. Popover is `.cal-day-popover` containing `.cal-day-popover-task` items. Nav buttons: `.cal-nav-prev` / `.cal-nav-next` / `.cal-nav-today`; the month label is `.cal-month-header-label`. **Date math gotcha for calendar tests**: the trailing pad of one month can cover up to 6 days of the next month, so a task on day ≤ 6 of month N can show up while viewing month N-1 — pick day=15+ for cross-month-isolation tests. **For Overview (5.1)**: progress bar label is `.project-card-progress-label` with text `{percent}% · {done}/{total} done`; fill width on `.project-card-progress-fill` style attr matches `/width:\s*N%/`. Overdue flag is `.project-card-overdue` (`⚠ N overdue`); next-milestone is `.project-card-milestone` (`◆ DD/MM/YYYY`). Sort dropdown is `#overview-sort-by` with values `updated|status|dueDate|percent`. **For My Tasks (5.2)**: switch sub-tab via `.projects-subtab[data-subtab="mytasks"]`. The user dropdown is `#mytasks-user-select` (values are bare assignee strings — `brad`, `diana`, or external). Sections are `.mytasks-section[data-bucket="overdue"|"thisWeek"|"upcoming"|"completed"]`; the completed section starts with `.mytasks-section.collapsed` so its rows are not visible until the `.mytasks-section-header` is clicked. Rows are `.mytasks-task-row` with sub-elements `.mytasks-task-project` / `.mytasks-task-name` / `.mytasks-task-due` / `.mytasks-task-status`; click any row to open the existing `#task-panel`. Empty state is `.mytasks-empty`. **Helper gotcha for 5.2 tests**: `#tp-assignee` is a `<select>`, not an input — use `selectOption(value)` not `fill(value)`. Future cross-project tests can reuse the `setTaskAssigneeDue(page, name, {assignee, dueDate, status})` helper inside the Phase 5.2 describe block. **For Dashboard (5.3)**: switch sub-tab via `.projects-subtab[data-subtab="dashboard"]`. Each metric card is `.dashboard-card[data-metric="<key>"]` where `<key>` is one of `activeProjects`, `openTasks`, `overdueTasks`, `dueThisWeek`, `completedLast30Days`, `upcomingMilestones`. The big number lives in `.dashboard-card-value` and the label in `.dashboard-card-label`. The Overdue card adds `.dashboard-card-flag` when count > 0 (assert with `toHaveClass(/dashboard-card-flag/)`). The bar chart is a single `<svg class="dashboard-chart">` containing 8 `.dashboard-bar-group`s. **Date gotcha for 5.3**: tests can't control "today", so don't seed dates relative to today (the `dueThisWeek` window shifts). Use far-future or far-past dates and assert that the metric is **0** (out-of-window) or **N** (where N is independent of today). The "auto-refresh" test simulates this by switching sub-tab back to Overview, mutating state, and re-entering Dashboard — every state change re-renders the module. **For Files (5.4)**: switch sub-tab via `.projects-subtab[data-subtab="files"]`. Each project group is `.files-group[data-project-id="..."]` with a `.files-group-name` heading and `.files-group-count` badge. Data rows are `.files-row[data-task-id="..."]` (the header row has no `data-task-id`, so locator `.files-row[data-task-id]` reliably scopes to clickable rows). Per-row cells are `.files-cell-task` / `.files-cell-name` / `.files-cell-kind` / `.files-cell-size` / `.files-cell-by` / `.files-cell-when`. Kind cell is the literal string `File` or `URL`; URL refs render size as the em-dash `—` literal. Empty state is `.files-empty`; the totals line is `.files-total`. **Helper for 5.4 tests**: reuse `addUrlAttachmentToTask(page, taskName, { name, url })` in the Phase 5.4 describe block — it opens the task panel, fills the URL form, asserts the chip appears, then closes the panel so subsequent test steps don't trip over the modal.

### Quick session onboarding

If you (or another agent) come back to this project cold:

1. Read this file top-to-bottom.
2. `cd app && git status && git log --oneline -10` — confirm what's actually committed.
3. `git branch --show-current` — am I on `master` or the active feature branch?
4. Check [tasks/todo.md](tasks/todo.md) and [tasks/user-actions.md](tasks/user-actions.md) for the active checklist and any deferred manual ops.
5. `cd app && npm install` (one-time) → `npm run test:e2e` to sanity-check both data and UI layers are green. Then open <http://localhost:8080/tests.html> for the data-only layer.
6. Then pick up the "Next task" pointer above.
