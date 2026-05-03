# Family Planner — Handover Notes

> **State as of 2026-05-04:** v1.0.0 (Financial Planner) was renamed to **Family Planner** and restructured as a **modular monolith**. Phases 0, 1, 2 (Tasks 2.1 + 2.2), and Phase 3 Task 3.1 (task dependencies + cycle detection) of v2.0.0 are complete and merged to master. The Playwright E2E harness runs 29 tests including a `tests.html` driver that executes the in-browser unit suite (52 cases) — single `npm run test:e2e` covers both layers in ~2.5 min. Real-Firebase + two-user smoke still unverified. Remaining Phase 3 work (comments / audit feed / attachments / milestones) and Phases 4–8 build out the rest of the Projects module — see [tasks/plan.md](../tasks/plan.md).

---

## Architecture

**Stack:** Vanilla HTML/CSS/JS, native ES modules, no build tools, no Node.js required.

**Hosting:** GitHub Pages (static) + Firebase Realtime Database (auth + data sync).

**Repo:** https://github.com/metalbee66/financial-planner (public; renaming this would break the GitHub Pages URL — deferred decision, see [tasks/user-actions.md](../tasks/user-actions.md))

**Live:** https://metalbee66.github.io/financial-planner/

**Deploy:** push to `master` → GitHub Pages rebuilds in ~30 seconds. There is no build step.

**Plan & status docs:**
- [tasks/plan.md](../tasks/plan.md) — full v2.0.0 implementation plan, 8 phases, ~25 tasks
- [tasks/todo.md](../tasks/todo.md) — flat checklist with done/pending state
- [tasks/user-actions.md](../tasks/user-actions.md) — manual ops Brad needs to do (n8n setup, Firebase rules, etc.)

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
│       │   ├── index.js                Module entry: list / detail / form views, task panel, subtask wiring, all event handlers
│       │   ├── data.js                 Project + task schemas, validation, list mutators, sanitisers, subtask helpers, load/save
│       │   └── data.test.js            Unit tests for the data layer (run via /tests.html, 36 tests)
│       └── pm-legacy/
│           ├── index.js                Wrapper for the existing pm.js
│           └── pm.js                   DLBooks PM (retired in Phase 8 → migrated into projects)
├── tests-e2e/
│   └── smoke.spec.js                   Playwright E2E smoke tests (Phase 1 + 2.1 acceptance criteria)
├── playwright.config.js                Chromium-only, reuses dev server on :8080
├── package.json                        Dev-only deps (Playwright). The deployed site stays vanilla JS.
├── package-lock.json                   npm lockfile
├── server.py                           Local dev server (`python server.py`)
├── tests.html                          In-browser unit-test runner for data.test.js
├── sample-data/                        Sample CSV for testing import
├── CHANGELOG.md                        Version history
├── HANDOVER.md                         This file
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
- Database URL: `https://financial-planner-e85d4-default-rtdb.asia-southeast1.firebasedatabase.app` (still has the `financial-planner` slug — see [user-actions.md](../tasks/user-actions.md) D1 for the deferred rename decision)
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
- Single Firebase RTDB key `projects` under `household/family/`, holding `{ items: [...projects], tasks: [...tasks] }`. Phase 6 will add `prefs` and `notifications` siblings under the same root — the current single-blob shape is fine because each module's realtime listener only fires once per save and the per-event-kind splits aren't useful until then.
- A project: `{ id, name, status, startDate, endDate, participants[], description, createdAt, updatedAt, archivedAt }`. Status enum: `planning|active|on-hold|completed|cancelled`. IDs are `p_<base36-time>_<6 random base36>`.
- A task: `{ id, projectId, name, description, status, assignee, startDate, dueDate, priority, parentTaskId, dependsOn[], comments[], events[], attachments[], createdAt, updatedAt, completedAt }`. Status enum: `not-started|in-progress|review|done|blocked`. Priority enum: `low|normal|high`. IDs are `t_<base36-time>_<6 random base36>`. Tasks live as a **flat array** keyed by `projectId` rather than nested under each project — this keeps cross-project aggregate views (Phase 5) trivial.
- **Subtasks** (Task 2.2): a subtask is just a task with `parentTaskId` set to the parent's id. **One level deep** — gated by the UI (the "+ Subtask" button only renders on top-level task panels), not by the data validator. The data layer stays loose so older shapes load without migration. Helpers: `findSubtasks(list, parentId)`, `promoteSubtasksInList(list, parentId)` (sets `parentTaskId = null` on every child of `parentId`, returns same ref if no children), `deleteTaskCascadeFromList(list, taskId)` (removes the task and any of its children).
- **Dependencies** (Task 3.1): tasks reference prerequisites via `dependsOn[]` (array of task ids in the same project). Helpers: `wouldCreateCycle(list, taskId, depId)` (DFS from `depId` looking for `taskId`; treats deleted tasks as leaves so a deleted prerequisite isn't a phantom cycle), `addDependency` / `removeDependency` (immutable; same-ref no-ops for self-dep, duplicates, missing target, and cycle attempts on add / absent dep on remove), `countBlockingDeps(list, task)` (counts deps that exist in the list and aren't `done`; deleted prerequisites are skipped, not counted as blocking). Cycle attempts in the UI are not silently filtered — the picker offers all candidates except self/already-added, and the cycle check fires on submit so the user sees the rejection inline.
- `updateTaskInList` auto-stamps `completedAt` on the not-done → done transition and clears it on the reverse. The UI relies on this for sorting and the "Done" strikethrough.
- All list mutators in `app/js/modules/projects/data.js` are immutable (return new arrays). UI calls `setProjects(items)` / `setTasks(tasks)` / `setBoth(items, tasks)` (single-save batched). Each writes via `saveProjects` → `fbSave('projects', ...)`. Cascade delete (project → its tasks) goes through `setBoth` so it's one atomic save and one toast.
- `sanitiseProject(p)` and `sanitiseTask(t)` backfill missing fields when older shapes load — no migration script needed for v1's single-version schema. Tasks default to `tasks: []` when older payloads (pre-2.1) load.
- Participants in v1 are constrained to `brad` and `diana` plus free-text strings. There is no per-user record; participant IDs are bare strings. Task `assignee` follows the same convention but can also be `null` (Unassigned).

### View structure (Projects module)
- The module's `index.js` renders one of three modes into its host element: **`list`** (project cards grid), **`detail`** (one project + its tasks), or **`form`** (create/edit project). `mode` is a small object held in the module — there is no router.
- The **task slide-in panel** (`#task-panel`) lives in `document.body` rather than the module host, so it can overlay any view. CSS transform animates it in from the right; backdrop click / Esc / Cancel close without saving. When a task panel is open and the underlying view re-renders (e.g. after a state change), `render()` re-attaches the panel from the latest task data, or closes it if the task disappeared.
- **Subtask UI**: the parent task's panel includes an inline "+ Subtask" section (button hides for subtask panels). Adding a subtask re-renders the panel so the new row appears in the panel's subtask list and as an indented `.task-row-subtask` row in the detail view. Inside the panel the subtask list is compact (name + status dropdown + delete); clicking a subtask name opens its own panel (which has no "+ Subtask" button — that's the depth gate).
- **Dependencies UI**: every task panel (top-level and subtask) has a Dependencies section after the description — a same-project picker (excluding self and already-added deps), an inline error line, and a list of current deps showing each prerequisite's name, status pill, and × to remove. Cycle attempts surface a clear "Cannot add dependency on \"X\" — it would create a cycle." error in the panel rather than being silently filtered. Task rows render an `⛔ Blocked by N` pill alongside the name when `countBlockingDeps > 0` and the task isn't done — the badge clears automatically via the standard re-render after every mutation.
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
- **Run `npm run test:e2e` before committing any UI change.** 29 tests, ~2.5 min. The suite includes a `tests.html` driver that runs the in-browser data-layer unit suite (52 cases) — both layers verified in one command. If anything fails, fix the code or update the test — do not commit red.
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

The much larger v2.0.0 backlog (Projects module: CRUD, views, notifications, AI, celebrations, migration) lives in [tasks/plan.md](../tasks/plan.md) and [tasks/todo.md](../tasks/todo.md).

---

## Where to pick up

- **Active branch:** `master` (Phases 0, 1, 2, and Phase 3 Task 3.1 all merged and pushed to origin; deployed via GitHub Pages).
- **Last commit:** `116db1e` — Task dependencies + cycle detection (Task 3.1)
- **Phase 3 commits on master (newest first):**
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
- **Next task:** Phase 3, Task 3.2 — Comments thread on a task ([plan §3.2](../tasks/plan.md#task-32-comments-thread-on-a-task)). Append-only `comments[]` on tasks (`{ id, author, text, createdAt }`), input at the bottom of the task panel, render newest-last with relative timestamps, Firebase listener delivers near-realtime updates to the other browser. Author = current Firebase user email or `anonymous` fallback. S-sized — XS/S can go direct to master per branch convention. (Checkpoint C + the new Checkpoint D for Phase 3 still pending — see verification notes below.)
- **Branch convention:** L/M-sized tasks land on `family-planner/<slug>` feature branches with a full `npm run test:e2e` pass before fast-forward merge to master. XS/S tasks can go direct to master.

### Manual smoke on the deployed site (Checkpoints C + D)

The Playwright suite (`npm run test:e2e`, 29 tests, ~2.5 min) covers the **functional** acceptance criteria for Phase 1.1, 1.2, 2.1, 2.2, and 3.1 plus a Phase 0 module-shell regression check, plus a `tests.html` driver that runs all 52 data-layer unit cases. Firebase is blocked at the network layer in tests so they run hermetically against localStorage.

What the harness **doesn't** cover (verify manually on https://metalbee66.github.io/financial-planner/ after the GitHub Pages rebuild):

1. **Real-Firebase round-trip.** Sign in as Brad, create a project, add a parent task with subtasks **and a dependency on another task in the project**, hard-refresh: everything persists. Open the Firebase console → payload at `household/family/projects` has `items[]` and `tasks[]`. Tasks with deps have `dependsOn: ["t_..."]`; subtasks have `parentTaskId` set; promoted tasks have `parentTaskId: null`.
2. **Two-browser realtime sync.** Browser A signs in as Brad, B as Diana (or two private windows). A creates a project + two tasks; A sets task 2 to depend on task 1; B sees the "⛔ Blocked by 1" badge on task 2 within ~2 sec. A marks task 1 done; B sees the badge clear. A removes the dep; B's panel reflects the empty deps list. (Subtask + cascade/promote sync from Phase 2.2 still wants verification too.)
3. **Cycle rejection wording.** In one browser, set up A→B→C and try to add C→A — the inline error should read "Cannot add dependency on \"A task\" — it would create a cycle." (or whatever the dep is named). Picker stays usable; deps list stays empty.
4. **Cascade vs promote behaviour (Phase 2.2).** Both confirms are native browser dialogs — verify the wording reads sensibly on Chrome (the second one should make it obvious that OK = delete subtasks and Cancel = promote, since native confirms can't have custom button labels).
5. **Visual layout.** Spot-check Projects list, detail view, slide-in panel on desktop. Subtask rows should have a clear left indent + border. The Dependencies section sits between the description and the subtasks list inside the panel; the "⛔ Blocked by N" pill should fit on the row without breaking the grid. Mobile breakpoint at <600px stacks the deps-add row and drops the badge below the name.
6. **Console check.** Zero red errors on either browser after the above. (Browser-extension `asynchronous response… message channel closed` chatter is not an app issue — ignore it.)

If any of those regress, the rollback is `git revert 116db1e` (Task 3.1) on master, then push. Earlier-phase rollbacks: `git revert c276906` (Task 2.2), `git revert 38261be 76a8678` (Task 2.1 + harness).

### Branch cleanup

All four feature branches (`family-planner/phase-1-projects-crud`, `phase-2-tasks`, `phase-2-subtasks`, `phase-3-deps`) have been deleted locally as of 2026-05-04 — the cleanup script in this very session ran `git branch -d` on each after verifying ancestry of `origin/master`.

Remote-side state on origin (`git ls-remote --heads origin 'family-planner/*'`):
- `family-planner/phase-2-tasks` is the only feature branch still on origin. A cleanup routine for it should already be scheduled per the prior handover. If it isn't, schedule one at <https://claude.ai/code/routines/>: 4–7 days out, check `git merge-base --is-ancestor origin/family-planner/phase-2-tasks origin/master`, delete on success.
- `family-planner/phase-3-deps` was never pushed (the work landed on master via local fast-forward + push of master). No remote cleanup needed.
- The Phase-1 cleanup routine `trig_01M8Bsfuv8XL1PgoQsz9EfHr` (fires 2026-05-06) is satisfied — that branch is already absent from origin.

### Tests

Two layers of automated tests, but a single command runs both:

1. **`npm run test:e2e`** (~2.5 min, chromium-only, runs against the local dev server which auto-starts if not already up). 29 tests in `tests-e2e/smoke.spec.js`:
   - Phase 1.1 / 1.2 / 2.1 / 2.2 / 3.1 acceptance criteria (UI through-and-through).
   - Phase 0 module-shell regression check.
   - **In-browser unit-suite driver** — visits `/tests.html` and asserts the summary reports 0 failures. This is what runs the 52 pure-data tests in `js/modules/projects/data.test.js` (project + task + subtask + dependency helpers: create / validate / list mutators / sanitisers / `completedAt` transitions / `findSubtasks` / `promoteSubtasksInList` / `deleteTaskCascadeFromList` / `addDependency` / `removeDependency` / `wouldCreateCycle` / `countBlockingDeps`).

2. **Optionally** open <http://localhost:8080/tests.html> directly when you want a faster signal on a pure-data change without booting Playwright. Same suite, same expected result.

The `page.goto: timeout` flake on Phase 2.1's "panel save updates the task row" test is a known intermittent — it's the dev-server-startup race in `webServer.timeout: 10_000`. If it fires, re-run the failing test in isolation with `npx playwright test --grep "panel save updates the task row"` to confirm it's the flake and not a real regression.

What the test layers do **not** cover (still manual): real-Firebase round-trip, two-user concurrent editing, visual sanity. Those need real network conditions and human eyes — see "Manual smoke on the deployed site" above.

To add tests for the next phase: append a new `test.describe(...)` block to `tests-e2e/smoke.spec.js`. Use the existing `createProject()` helper at the top of the file. For subtask flows, reuse the `openTaskPanel` + `addSubtask` helpers in the Phase 2.2 block. For dep flows, the Phase 3.1 block's `openTaskPanel` is scoped via `.task-row` then `.task-row-name` to avoid matching the "Blocked by N" badge — copy that pattern. Watch out for `hasText` substring matching colliding with status-dropdown option labels (e.g. a task named "One" matches "Done" — use distinctive names like "Task A", "Task B"). Watch out for parent-delete dialog ordering: the handler fires **two** confirms back-to-back — collect them with a `dialogs[]` array and inspect by index, see Phase 2.2 tests for the pattern.

### Quick session onboarding

If you (or another agent) come back to this project cold:

1. Read this file top-to-bottom.
2. `cd app && git status && git log --oneline -10` — confirm what's actually committed.
3. `git branch --show-current` — am I on `master` or the active feature branch?
4. Check [tasks/todo.md](../tasks/todo.md) and [tasks/user-actions.md](../tasks/user-actions.md) for the active checklist and any deferred manual ops.
5. `cd app && npm install` (one-time) → `npm run test:e2e` to sanity-check both data and UI layers are green. Then open <http://localhost:8080/tests.html> for the data-only layer.
6. Then pick up the "Next task" pointer above.
