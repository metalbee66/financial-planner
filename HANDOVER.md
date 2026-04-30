# Family Planner — Handover Notes

> **State as of 2026-04-30:** v1.0.0 (Financial Planner) was renamed to **Family Planner** and restructured as a **modular monolith**. Phases 0–1 of v2.0.0 are complete (rebrand + ES modules + module shell + Projects CRUD with participants). Phases 2–8 build out the rest of the Projects module — see [tasks/plan.md](../tasks/plan.md).

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
│       │   ├── index.js                Module entry: list/form views, CRUD + participant editor
│       │   ├── data.js                 Schema, validation, list mutators, sanitiser, load/save
│       │   └── data.test.js            Unit tests for the data layer (run via /tests.html)
│       └── pm-legacy/
│           ├── index.js                Wrapper for the existing pm.js
│           └── pm.js                   DLBooks PM (retired in Phase 8 → migrated into projects)
├── server.py                           Local dev server (`python server.py`)
├── sample-data/                        Sample CSV for testing import
├── CHANGELOG.md                        Version history
└── HANDOVER.md                         This file
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
- Single Firebase RTDB key `projects` under `household/family/`, holding `{ items: [...] }`. Phase 6 will add `prefs` and `notifications` siblings under the same root — the current single-blob shape is fine because each module's realtime listener only fires once per save and the per-event-kind splits aren't useful until then.
- A project: `{ id, name, status, startDate, endDate, participants[], description, createdAt, updatedAt, archivedAt }`. Status enum: `planning|active|on-hold|completed|cancelled`. IDs are `p_<base36-time>_<6 random base36>`.
- All list mutators in `app/js/modules/projects/data.js` are immutable (return new arrays). UI calls `setProjects(items)` which writes via `saveProjects` → `fbSave('projects', ...)`.
- `sanitiseProject(p)` backfills missing fields when older shapes load — no migration script needed for v1's single-version schema.
- Participants in v1 are constrained to `brad` and `diana` plus free-text strings. There is no per-user record; participant IDs are bare strings.

---

## How to Deploy Changes

1. Edit files locally in `e:/Projects/Family Planner/app/`
2. Test at http://localhost:8080 (`python server.py`)
3. For risky changes (refactors, schema-affecting edits), use a feature branch + smoke test before merging to master. Phase 0 followed this pattern; see git log for examples.
4. `git add ...` (specific files, not `-A`), commit, `git push`
5. GitHub Pages rebuilds in ~30 seconds
6. Hard refresh (Ctrl+Shift+R) on the live site

---

## Conventions

- **No build tools.** ES modules served directly.
- **Bracket-check JS files** before commit (`node --input-type=module --check < file.js` or visual scan).
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

- **Active branch:** `family-planner/phase-1-projects-crud` (Phase 1 complete, awaiting Checkpoint B before merge to master)
- **Last commit:** `0a50020` — Docs: log Phase 1 in CHANGELOG + update HANDOVER
- **Phase 1 commits on the branch (newest first):**
  - `0a50020` — Docs: CHANGELOG + HANDOVER updates
  - `fd8055d` — Participant management on a project (Task 1.2)
  - `0c93b0f` — Project entity CRUD with tests (Task 1.1)
- **Next task:** Phase 2, Task 2.1 — Task entity within a project ([plan §2.1](../tasks/plan.md#task-21-task-entity-within-a-project))
- **Branch convention:** L/M-sized tasks land on `family-planner/<slug>` feature branches with a smoke test before fast-forward merge to master. XS/S tasks can go direct to master.

### Checkpoint B — to run before merging Phase 1

Per [tasks/plan.md → Checkpoint B](../tasks/plan.md#checkpoint-b--after-11-12). Steps to run on the deployed live site (after fast-forward merge + `git push`):

1. Sign in as Brad on browser A and Diana on browser B (or two private windows).
2. **Create:** click `+ New Project`, fill name + start + end + status + description, save. Card appears.
3. **Participants:** open the project, toggle Brad off then back on, add an external participant (e.g. "accountant"), remove the external chip with the × button. Save. The card reflects the chip changes.
4. **Edit:** click an existing card, change the status, save. Status badge updates. Refresh — change persists.
5. **Validation:** create a project with end date earlier than start date. Inline error: "End date must be on or after start date". No save.
6. **Delete:** click delete on an existing card. Confirm prompt fires. Card disappears.
7. **Two-browser sync:** with both browsers signed in, create a project in A. It should appear in B within ~2 seconds (realtime listener). Edit in B, refresh A.
8. **Console check:** zero errors after the above flow on either browser.
9. **Tests still green:** open <http://localhost:8080/tests.html> against your local copy → 20/20 pass.

If anything regresses, do NOT merge — investigate on the branch.

### Branch cleanup is automated

A scheduled remote agent (`trig_01M8Bsfuv8XL1PgoQsz9EfHr`) fires once at **2026-05-06 23:00 UTC = 9am Sydney Mon 2026-05-07**. It checks `git merge-base --is-ancestor origin/family-planner/phase-1-projects-crud origin/master` and:
- if reachable → `git push origin --delete family-planner/phase-1-projects-crud`
- if not → posts a one-line nudge and does nothing.

So after a successful Checkpoint B + merge, the origin branch will clean itself up. The local branch is your own to delete (`git branch -d family-planner/phase-1-projects-crud`).

Manage at <https://claude.ai/code/routines/trig_01M8Bsfuv8XL1PgoQsz9EfHr>.

### Tests

The Projects module has the first automated tests in this repo. Run them
two ways:

- **Browser:** start `python server.py`, open <http://localhost:8080/tests.html>. The page imports `js/modules/projects/data.test.js` and reports pass/fail counts for the data layer.
- **CLI:** `node --input-type=module -e "import('./js/modules/projects/data.test.js').then(async m => { const r = await m.runProjectsDataTests(); console.log(r.pass + '/' + (r.pass + r.fail)); if (r.fail) process.exit(1); });"`

Tests cover pure functions only (createProject, validateProject, list mutators, sanitiseProject). DOM and Firebase paths are still verified by manual smoke testing on the live deploy.

### Quick session onboarding

If you (or another agent) come back to this project cold:

1. Read this file top-to-bottom.
2. `cd app && git status && git log --oneline -10` — confirm what's actually committed.
3. `git branch --show-current` — am I on `master` or the Phase 1 branch?
4. Check [tasks/todo.md](../tasks/todo.md) and [tasks/user-actions.md](../tasks/user-actions.md) for the active checklist and any deferred manual ops.
5. Run the test CLI one-liner above to sanity-check the data layer is green.
6. Then pick up the "Next task" pointer above.
