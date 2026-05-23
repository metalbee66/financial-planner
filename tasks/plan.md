# Implementation Plan: Family Planner — Modular Monolith

**Last updated:** 2026-04-27 (v2 — restructured into modular monolith, email via n8n)
**Author / planner:** Claude (planning-and-task-breakdown skill)
**Status:** DRAFT — pending human review

---

## Overview

Restructure the existing app into a **modular monolith called "Family Planner"** with two initial modules and room for more:

| Module | Origin | Status |
|---|---|---|
| **Finance** | existing Budget CY/NY, Planner, Accounts, Import tabs | Keep, repackage as a module |
| **Projects** (Asana-like PM) | NEW | Build from scratch — covers the full feature set requested |
| _(future)_ | TBD | Architecture must support drop-in addition |

The existing `PM DLBooks` tab is rolled into the Projects module as one project (DLBooks → DLBooks Macro + DLBooks Customers).

The Projects module covers projects with participants/dates/status, hierarchical tasks with dependencies/comments/attachments/audit trail, six cross-cutting views (overview / list / timeline / calendar / dashboard / per-user summary), **email notifications via n8n + M365 Outlook (sensei infrastructure)** plus a lightweight in-app bell, milestone indicators, and on-screen celebrations. AI is supported via local heuristics only — no external API calls.

---

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| App shape | Modular monolith — top-level `Family Planner`, modules as self-contained sub-apps mounted into nav | Allows clean addition of new modules without touching existing ones |
| Module split | Two initial: `Finance` (existing) + `Projects` (new); future modules slot into the same registry | Each module owns its data namespace, render entry, save/sync wiring |
| JS architecture | **Native ES modules** (`<script type="module">`), no bundler, no build step | Gives proper imports/encapsulation needed for monolithic modules; deploys identically to current GitHub Pages flow |
| Module registry | One central `modules.js` that lists modules, their nav label, mount target, render entry, save/load functions | New modules added in one line |
| Storage | Firebase RTDB; `finance/*` keys preserved; new `projects/*` namespace for Projects module; module data stays segregated | Existing paths preserved, no migration of finance data |
| Per-project storage | Project metadata + tasks bundled per project; sharded if large | Avoids loading all tasks for the overview screens |
| Attachments | Inline base64 (≤500 KB per file) + URL/title references | Avoids requiring Firebase Storage upgrade |
| Identity / participants | `brad` and `diana` only (from existing `ALLOWED_EMAILS`); no external participants in v1 | Matches existing two-user auth; user confirmed |
| AI | Local heuristics: templated summaries, suggested task names from history, smart-sort by urgency, stale-project flagging, due-date guess from project span | Static site, no API budget |
| **Notifications** | **Email via n8n + M365 Outlook (sensei infrastructure)**, queued through Firebase RTDB; in-app bell for online sessions; no browser-permission notifications | User wants email; sensei has the n8n+Outlook stack already planned |
| Timeline | Vanilla SVG/divs, horizontal Gantt bars, month zoom v1 (day/week/quarter later) | No build tools, no chart libs |
| Calendar | Month grid, click day to filter | Same constraint |
| Celebrations | CSS keyframe confetti + emoji burst pool, optional WebAudio chime | Pure browser, no deps |
| Audit trail | Append-only event log per task; rendered as activity feed beneath comments | Standard Asana pattern |
| Rename | Visible labels only (`<title>`, `<h1>`, login card). Repo + Firebase project IDs unchanged for v1 | Renaming repo breaks GitHub Pages URL; manual op tracked in user-actions.md |

---

## Module Architecture

The app shell becomes thin: an authentication shim, a top nav rendered from a module registry, and a content host. Each module is a self-contained ES-module file exporting a standard interface.

```
app/
├── index.html                        Thin shell: nav placeholder + module mount point
├── js/
│   ├── shell.js                      Boot: init Firebase, render nav from registry, mount active module
│   ├── modules.js                    Registry: array of { id, label, entry, dataKeys[] }
│   ├── data-helpers.js               Currency fmt, date helpers, NBSP padding (extracted from current data.js)
│   ├── firebase-sync.js              Generic save/load/listen by key — modules register their keys
│   ├── modules/
│   │   ├── finance/
│   │   │   ├── index.js              exports renderFinance(), default routes between Budget/Planner/Accounts/Import sub-tabs
│   │   │   ├── budget.js             (existing logic, modularised)
│   │   │   ├── planner.js
│   │   │   ├── accounts.js
│   │   │   └── import.js
│   │   └── projects/
│   │       ├── index.js              exports renderProjects(), default routes between Overview/List/Timeline/Calendar/Dashboard/MyTasks sub-tabs
│   │       ├── data.js               schema, CRUD, audit logging
│   │       ├── views/
│   │       │   ├── overview.js
│   │       │   ├── list.js
│   │       │   ├── timeline.js
│   │       │   ├── calendar.js
│   │       │   ├── dashboard.js
│   │       │   ├── my-tasks.js
│   │       │   └── files.js
│   │       ├── notifications.js      enqueue-to-firebase wrapper + in-app bell
│   │       ├── celebrate.js
│   │       └── local-ai.js
│   └── auth.js                       Existing Firebase Google sign-in, brad+diana whitelist
```

The shell renders nav by iterating `modules.js`. Each module's `index.js` returns a sub-nav for its own tabs — finance has Budget CY / Budget NY / Planner / Accounts / Import, projects has Overview / List / Timeline / Calendar / Dashboard / My Tasks.

---

## Email Notification Pipeline (n8n + M365)

```
Family Planner (browser)
  │ writes via Firebase auth (brad/diana only)
  ▼
Firebase RTDB:
  /household/family/email_queue/{eventId} = {
    to, subject, bodyHtml, kind, sourceUrl,
    queuedAt, sent: false, attempts: 0
  }
  │ polled every 60s via HTTP Request node
  ▼
n8n on SEi14 Geekom (sensei infrastructure)
  - Schedule trigger (every 60s)
  - HTTP Request: GET Firebase REST API for unsent items
  - Loop over results
  - Microsoft Outlook node: Send mail (Graph API, Mail.Send)
  - On success: PATCH RTDB with sent=true, sentAt
  - On failure: increment attempts, give up after 3
```

**Triggering events** (each enqueues an email):
- Task assigned to me
- New comment on a task I'm assigned to or watching
- Task I'm dependent on becomes done (unblocked)
- Task due in 24h and not done
- Task overdue
- Project marked complete (celebration email to all participants)
- Milestone reached

**Per-user email preferences** (stored in `/household/family/projects/prefs/{user}`):
- Master on/off
- Per-event-kind on/off
- Digest mode (instant vs daily 8am summary instead)

**Failure modes:**
- n8n down: queue grows in Firebase, drains when n8n returns
- M365 send fails: retry up to 3 times, then mark `failed: true` and surface in admin panel inside the app
- Firebase down: enqueue falls back to localStorage queue, drains to Firebase when reconnected

---

## Dependency Graph

```
Phase 0 ─ Rebrand + ES-modules conversion + module registry shell
    │       (Finance module repackaged from existing files)
    │
Phase 1 ─ Projects module scaffold + project CRUD
    │
Phase 2 ─ Tasks + subtasks within a project
    │
Phase 3 ─ Task richness (deps, comments, audit, attachments, milestones)
    │
Phase 4 ─ Per-project views (list / timeline / calendar)
    │
Phase 5 ─ Cross-project views (overview / dashboard / my-tasks / files)
    │
Phase 6 ─ Email notifications via n8n + in-app bell
    │       (also per-user prefs + email queue admin panel)
    │
Phase 7 ─ Celebrations + local AI
    │
Phase 8 ─ Migrate PM DLBooks → Projects, retire old tab, tag v2.0.0
```

Phase 0 is heavier than the original draft because the modular-monolith conversion is real work — it means moving existing finance JS into modules and wiring a registry. Once done, every subsequent phase plugs in cleanly.

---

## Task List

### Phase 0 — Rebrand & Modular-Monolith Conversion

> **Phase 0 is the riskiest single phase** because it refactors existing working code. Every task has a "no regression on Finance module" verification step. Commit + push before each task.

#### Task 0.1: Rebrand visible labels to "Family Planner"

**Description:** Replace user-visible "Financial Planner" strings with "Family Planner" across `index.html`, login card, page title, and `app/CHANGELOG.md` header. Do NOT rename the repo, Firebase project, or live URL (tracked separately in [user-actions.md](user-actions.md)).

**Acceptance criteria:**
- [ ] `<title>` reads "Family Planner"
- [ ] Header `<h1>` reads "Family Planner"
- [ ] Login card heading reads "Family Planner"
- [ ] CHANGELOG.md adds a v2.0.0-pending header

**Verification:**
- [ ] `grep -ri "Financial Planner" app/` returns zero hits outside CHANGELOG history
- [ ] Manual check: load locally, header + login card show new name
- [ ] Bracket-check all touched JS files

**Dependencies:** None
**Files likely touched:** `app/index.html`, `app/CHANGELOG.md`, `app/HANDOVER.md`
**Estimated scope:** XS

---

#### Task 0.2: Convert existing JS to native ES modules (no behaviour change)

**Description:** Switch all `<script src="...">` to `<script type="module" src="...">`. Replace globals with `import`/`export`. The order: `data.js` → `firebase-config.js` → `firebase-sync.js` → `budget.js`/`planner.js`/`accounts.js`/`import.js`/`pm.js` → `app.js`. Each file's externally-used functions get `export`; consumers `import` them. Toast helper `showToast` stays in a shared `data-helpers.js`. **No new functionality.** Pure mechanical refactor.

**Acceptance criteria:**
- [ ] All `<script>` tags use `type="module"`
- [ ] No file references a global that isn't imported
- [ ] App boots and behaves identically to pre-refactor (full smoke test of every tab)
- [ ] Firebase sync works (Google sign-in, multi-device data sync)

**Verification:**
- [ ] Local server smoke test: every tab renders, all CRUD works (add a budget item, confirm a planner week, edit an account, import a CSV, edit a PM task)
- [ ] Bracket-check all JS files
- [ ] Console has zero errors after a full session
- [ ] Compare against pre-refactor commit by hand-checking each tab

**Dependencies:** 0.1
**Files likely touched:** `app/index.html`, every file under `app/js/`
**Estimated scope:** L (mechanical but spans ~3000 LOC across 9 files)

**Risk note:** This is the riskiest task. Two mitigations:
1. Do it on a feature branch with full local testing before merging to master
2. If any single tab regresses, revert and split into two passes: (a) data + helpers + firebase only; (b) UI files. Then merge.

---

#### Task 0.3: Introduce module registry + thin shell

**Description:** Create `app/js/modules.js` exporting an array `MODULES = [...]` with `{ id, label, render(), dataKeys[] }` for each module. Refactor `app.js` into `shell.js` that: (a) initialises Firebase, (b) renders the top nav by mapping over `MODULES`, (c) mounts the active module's render output into a content host. The existing tab-switch logic moves into module-specific sub-nav. **One module at this point: a single `Finance` module wrapping all existing finance tabs as its sub-tabs.**

**Acceptance criteria:**
- [ ] `app/index.html` has only a top-nav placeholder + content host (no inline tab content)
- [ ] All existing finance functionality is inside `app/js/modules/finance/index.js`
- [ ] Top nav shows: `Finance` (just one module for now)
- [ ] Inside Finance, sub-nav: Budget CY / Budget NY / Planner / Accounts / Import
- [ ] PM DLBooks tab still accessible — temporarily mounted as a second module called `PM DLBooks (legacy)` until Phase 8 retires it
- [ ] All save/load wiring still works

**Verification:**
- [ ] Full smoke test of every existing feature
- [ ] Two-browser test: Firebase sync still works
- [ ] Reload from production (post-deploy) verifies nothing broke

**Dependencies:** 0.2
**Files likely touched:** `app/index.html`, `app/js/shell.js` (new), `app/js/modules.js` (new), `app/js/modules/finance/*` (moved from `app/js/`), `app/js/modules/pm-legacy/*` (moved from `pm.js`), `app/css/style.css`
**Estimated scope:** L

**Risk note:** Combined with 0.2, this is the bulk of the refactor work. Strongly recommend a checkpoint after 0.2 before starting 0.3 — the user does a full feature pass on the live deployed site.

---

#### Task 0.4: Bootstrap `Projects` module skeleton

**Description:** Create `app/js/modules/projects/index.js` with empty render (just an empty-state "+ New Project" button), register it in `modules.js`, ensure top nav shows three modules: Finance, Projects, PM DLBooks (legacy). No real CRUD yet — that's Phase 1.

**Acceptance criteria:**
- [ ] Top nav: Finance | Projects | PM DLBooks (legacy)
- [ ] Clicking Projects shows empty state with "+ New Project" button
- [ ] Click button → console.log stub
- [ ] No regressions

**Verification:**
- [ ] All three modules switch cleanly
- [ ] No console errors
- [ ] Bracket-check

**Dependencies:** 0.3
**Files likely touched:** `app/js/modules.js`, `app/js/modules/projects/index.js` (new), `app/css/style.css`
**Estimated scope:** S

---

### Checkpoint A — After 0.1–0.4

- [ ] App rebranded
- [ ] Modular monolith shape in place — Finance, Projects, PM-Legacy modules
- [ ] All existing finance functionality works on production
- [ ] **Full live-site smoke test pass by user before proceeding**
- [ ] User reviews and approves before Phase 1

---

### Phase 1 — Projects CRUD

#### Task 1.1: Project entity — create / read / update / delete

**Description:** Implement project data model (`{ id, name, status, startDate, endDate, participants[], description, createdAt, updatedAt, archivedAt }`), list view rendering, create-project modal/inline form (name, dates, participants, status, description), edit on click of project card, delete with confirm. Status enum: `planning|active|on-hold|completed|cancelled`. Default participants = `['brad','diana']`. Persist via existing save flow.

**Acceptance criteria:**
- [ ] Can create a project with name + dates + status; appears in list
- [ ] Project card shows name, status badge, date range, participant chips
- [ ] Edit dialog updates all fields and persists
- [ ] Delete prompts confirmation and removes from list
- [ ] Invalid date ranges (end < start) rejected with inline error

**Verification:**
- [ ] Create 3 projects, edit one, delete one → list reflects changes
- [ ] Refresh + Firebase round-trip preserves data
- [ ] `JSON.parse(localStorage.getItem('projects'))` matches displayed state

**Dependencies:** 0.2
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

#### Task 1.2: Participant management on a project

**Description:** Allow per-project participant editing — toggle `brad` / `diana` plus add/remove free-text external participant strings. Render avatar-style chips (initial-circle) consistently. Reuse this chip component for task assignees later.

**Acceptance criteria:**
- [ ] Project edit dialog has multi-select for `brad`, `diana` and a "+ add participant" inline input
- [ ] Removing a participant who's assigned to tasks prompts a warning (don't auto-reassign yet)
- [ ] Chip renderer is in a shared helper for reuse

**Verification:**
- [ ] Toggle each built-in user; add and remove an external one → persists
- [ ] Warning fires when removing a user with assigned tasks (mock for now)

**Dependencies:** 1.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** S

---

### Checkpoint B — After 1.1, 1.2

- [ ] Project CRUD round-trips through Firebase
- [ ] Two real demo projects exist for downstream phases to operate on
- [ ] Reviewed by user

---

### Phase 2 — Tasks & Subtasks

#### Task 2.1: Task entity within a project

**Description:** Open a project → view its tasks list. Task model: `{ id, projectId, name, description, status, assignee, startDate, dueDate, priority, parentTaskId, dependsOn[], comments[], events[], attachments[], createdAt, updatedAt, completedAt }`. Status: `not-started|in-progress|review|done|blocked`. CRUD: create, edit (slide-in panel, Asana-style), delete (with confirm).

**Acceptance criteria:**
- [ ] Click project → opens project detail view with task list
- [ ] Add task: name + assignee + due date inline
- [ ] Click task → detail panel with all fields editable
- [ ] Status dropdown updates immediately, persists
- [ ] Delete confirms before removing

**Verification:**
- [ ] Create 5 tasks in one project, edit each field type, delete one
- [ ] Refresh + Firebase preserve all fields

**Dependencies:** 1.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

#### Task 2.2: Subtasks (one level deep, `parentTaskId`)

**Description:** Allow tasks to have child tasks via `parentTaskId`. Render as nested rows under parent in list view. Cap at one level of nesting (no grandchildren) for v1 — Asana itself only loosely supports deeper nesting.

**Acceptance criteria:**
- [ ] "+ Subtask" button on task detail panel
- [ ] Subtasks render indented under parent
- [ ] Cannot make a subtask a parent of another subtask (UI prevents)
- [ ] Deleting a parent prompts whether to delete subtasks or promote them

**Verification:**
- [ ] Create parent, add 3 subtasks, delete parent → choose promote → all 3 are now top-level tasks
- [ ] Persist + reload matches

**Dependencies:** 2.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

### Checkpoint C — After 2.1, 2.2

- [ ] Project + task hierarchy works end-to-end
- [ ] Reviewed by user

---

### Phase 3 — Task Richness

#### Task 3.1: Task dependencies & cycle detection

**Description:** Add `dependsOn[]` array on tasks. Picker UI to add/remove dependencies (only tasks within same project, can't depend on self or descendants). Reject cycles via DFS check on save. Show "blocked by" badges on task list.

**Acceptance criteria:**
- [ ] Add dep: shows other tasks in project as picker
- [ ] Cycle attempt rejected with clear message
- [ ] Task with unmet deps shows badge: "Blocked by [count]"
- [ ] Removing a dep updates badge

**Verification:**
- [ ] Try to make A→B→C→A → rejected
- [ ] Mark prerequisite done → blocking badge clears

**Dependencies:** 2.1
**Files likely touched:** `app/js/projects.js`
**Estimated scope:** M

---

#### Task 3.2: Comments thread on a task

**Description:** Append-only comments on tasks. Each comment: `{ id, author, text, createdAt }`. Render newest-last; cannot edit/delete (audit-trail requirement). Author = current Firebase user email or local fallback "anonymous".

**Acceptance criteria:**
- [ ] Comment input at bottom of task detail panel
- [ ] Comment renders with author + relative timestamp
- [ ] Refreshes from Firebase listener so other user sees in near-real-time
- [ ] Empty input rejected

**Verification:**
- [ ] Two-browser test: post comment in one → appears in other within ~2 sec

**Dependencies:** 2.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** S

---

#### Task 3.3: Activity / audit-trail feed on a task

**Description:** Each mutating action on a task (status change, assignee change, due-date change, dep add/remove, attachment add/remove) appends an `event` to `task.events[]` with `{ kind, by, at, before, after }`. Render below comments in chronological order, interleaved with comments via timestamp.

**Acceptance criteria:**
- [ ] All listed mutations log an event
- [ ] Activity feed renders both comments and events sorted by timestamp
- [ ] Author derived from current user
- [ ] Events are not editable

**Verification:**
- [ ] Change status, change assignee, add comment, change due → 4 entries in feed in correct order

**Dependencies:** 3.2
**Files likely touched:** `app/js/projects.js`
**Estimated scope:** M

---

#### Task 3.4: File attachments (inline + URL refs)

**Description:** Attach files to tasks. Two modes: (a) drag-drop or file-picker for files ≤500 KB, stored as base64 string with `{ name, size, type, dataUri, addedBy, addedAt }`; (b) URL reference with `{ name, url, addedBy, addedAt }`. Render as chips with download/open. Reject files >500 KB with clear size-limit message.

**Acceptance criteria:**
- [ ] Drag-drop area on task detail panel accepts ≤500 KB files
- [ ] Files >500 KB rejected with explanation
- [ ] URL ref form accepts title + URL
- [ ] Inline files downloadable; URL refs open in new tab
- [ ] Logs an event in activity feed

**Verification:**
- [ ] Attach 100 KB image, 600 KB PDF (rejected), URL link → all behaviors as expected
- [ ] Persists via Firebase (mind RTDB row size limits — surface warning if approaching 1 MB total per task)

**Dependencies:** 3.3
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

**Risk note:** Firebase RTDB has a 256 MB limit per write but practical limit is much smaller for performance; if a task exceeds ~2 MB total attachments, fall back to localStorage-only and surface warning.

---

#### Task 3.5: Milestone flag on tasks

**Description:** Tasks can be marked `isMilestone: true` (boolean toggle). Milestone tasks render with a diamond icon + special highlight in list, timeline, and calendar.

**Acceptance criteria:**
- [ ] Toggle exists in task detail panel
- [ ] Milestone tasks show diamond glyph in all relevant views
- [ ] Filter "milestones only" available in list view

**Verification:**
- [ ] Toggle 2 tasks as milestones → all views reflect

**Dependencies:** 2.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** S

---

### Checkpoint D — After 3.1–3.5

- [ ] Tasks have full Asana-equivalent richness (deps, comments, audit, attachments, milestones)
- [ ] Real two-user smoke test on Firebase passes
- [ ] Reviewed by user

---

### Phase 4 — Per-Project Views

#### Task 4.1: List view (with filtering & grouping)

**Description:** Default view inside a project. Render task list with columns: name, assignee, due date, priority, status, milestone flag. Group-by toggle: status / assignee / none. Sort: due date asc default, name, priority. Filter: by assignee, by status, milestones-only.

**Acceptance criteria:**
- [ ] All columns sortable
- [ ] Group-by toggle changes layout
- [ ] Filters compose (multiple at once)
- [ ] Empty state when filters return nothing

**Verification:**
- [ ] Project with 10 tasks across all statuses → group/sort/filter all behave

**Dependencies:** 2.2
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

#### Task 4.2: Timeline view (Gantt-style, month zoom)

**Description:** Horizontal date axis at month-zoom. Each task = a bar from `startDate` to `dueDate`. Bars colored by status. Dependencies render as arrows from end of predecessor to start of successor. Milestones render as diamonds. Click bar → task detail panel.

**Acceptance criteria:**
- [ ] Date axis spans `min(task starts)` → `max(task dues)` plus 2-week padding
- [ ] Bars positioned correctly; resizing window reflows
- [ ] Dependency arrows visible (SVG) and don't visually cross when avoidable
- [ ] Click bar opens task detail
- [ ] Milestones rendered as diamonds at their date

**Verification:**
- [ ] 10-task project with 3 dependencies + 2 milestones → renders correctly
- [ ] Performance: 100-task project renders in <500 ms

**Dependencies:** 3.1, 3.5
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** L

**Risk note:** This is the largest single task. If it overruns, split into 4.2a (bars only, no deps) and 4.2b (dependency arrows + milestones).

---

#### Task 4.3: Calendar view (month grid)

**Description:** Standard month-grid layout. Tasks render on their `dueDate` (and also on `startDate` if multi-day, dimmer). Click a day → filtered task list for that day. Click a task pill → task detail. Prev/next month navigation.

**Acceptance criteria:**
- [ ] Month grid 7 cols × 5–6 rows, current day highlighted
- [ ] Tasks pill on due date; multi-day faded pill on start
- [ ] Click day → task list popover
- [ ] Click pill → task detail panel
- [ ] Prev/next month navigation works

**Verification:**
- [ ] Project with tasks across 3 months → navigate each, all visible

**Dependencies:** 2.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

### Checkpoint E — After 4.1, 4.2, 4.3

- [ ] All three project views render against the same task data
- [ ] Reviewed by user

---

### Phase 5 — Cross-Project Views

#### Task 5.1: Overview tab (all projects at a glance)

**Description:** Sub-tab inside Projects (or separate tab — TBD with user). Cards for each project: name, % complete (done tasks / total), date range, participants, status, next milestone date, overdue task count.

**Acceptance criteria:**
- [ ] Renders all non-archived projects
- [ ] % complete derived from task statuses
- [ ] Click card → opens project detail
- [ ] Sortable by status / due date / % complete

**Verification:**
- [ ] 3 demo projects with mixed task statuses → percentages correct

**Dependencies:** 2.1, 1.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

#### Task 5.2: Per-user summary tab

**Description:** "My Tasks" view — filter all tasks across all projects by assignee = current user (or selected user). Sections: overdue, due this week, upcoming, completed (collapsed).

**Acceptance criteria:**
- [ ] Defaults to logged-in user (or "Brad" if no Firebase user)
- [ ] User selector switches view
- [ ] Sections correctly bucketed by date relative to today
- [ ] Click task → detail panel (cross-project navigation)

**Verification:**
- [ ] 2-user data → switch between them, counts match expected

**Dependencies:** 5.1
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

#### Task 5.3: Dashboard tab

**Description:** High-level metrics across all projects. Cards: total active projects, total open tasks, overdue tasks, tasks due this week, completion rate (last 30 days), upcoming milestones (next 14 days). Mini bar chart of completion rate per week (last 8 weeks).

**Acceptance criteria:**
- [ ] All 6 metric cards render with correct numbers
- [ ] Mini bar chart renders (CSS-only or inline SVG, no chart lib)
- [ ] Auto-refreshes when underlying data changes (Firebase listener)

**Verification:**
- [ ] Modify task status → dashboard counts update without manual refresh

**Dependencies:** 5.1, 5.2
**Files likely touched:** `app/js/projects.js`, `app/css/style.css`
**Estimated scope:** M

---

#### Task 5.4: Files summary by project

**Description:** Sub-tab listing all attachments grouped by project. Columns: project, task, file/URL name, type, size, added by, added on. Click row → jump to task. Useful for "where did I attach the X doc?"

**Acceptance criteria:**
- [ ] Renders all attachments across all projects
- [ ] Group-by project header
- [ ] Click row navigates to task

**Verification:**
- [ ] Attachments from 2 projects, 5 tasks → all listed and grouped correctly

**Dependencies:** 3.4
**Files likely touched:** `app/js/projects.js`
**Estimated scope:** S

---

### Checkpoint F — After 5.1–5.4

- [ ] All cross-project surfaces work
- [ ] Performance acceptable on 5+ projects, 50+ tasks
- [ ] Reviewed by user

---

### Phase 6 — Email Notifications via n8n + In-App Bell

> **External dependency**: this phase needs n8n running on SEi14 with M365 Outlook credentials configured. If n8n isn't ready when we get here, Tasks 6.1, 6.2, 6.4 still work in app — only 6.3 (the n8n workflow) depends on the infra. Phase 6 can land in any order with respect to the n8n setup itself.

#### Task 6.1: Audit-event → notification trigger map

**Description:** Centralise the rule "what triggers a notification" in one place — `notifications.js` exports a function `eventToNotification(event, task, project, user)` that returns a notification object or null. Map covers: assigned-to-me, comment-on-my-task, dependency-unblocked, due-in-24h, overdue, milestone-done, project-complete. Wire so every audit event written by Phase 3.3 is also passed through this mapper.

**Acceptance criteria:**
- [ ] All seven trigger types fire correctly when their conditions are met
- [ ] Each user only gets notifications for events relevant to them (no global broadcasts)
- [ ] Self-actions don't notify self (don't email Brad when Brad assigns a task to Brad)

**Verification:**
- [ ] Unit-style: a test list of synthetic events produces the expected notification list per user

**Dependencies:** 3.3
**Files likely touched:** `app/js/modules/projects/notifications.js` (new), `app/js/modules/projects/data.js`
**Estimated scope:** M

---

#### Task 6.2: In-app bell + per-user preferences UI

**Description:** Bell icon in shell header (visible across all modules) with unread count. Click → dropdown of last 30 notifications for current user, newest first. Mark-as-read on click; "Mark all read" link. Settings cog → preferences modal: master on/off, per-event-kind toggles, instant vs daily-digest mode. Stored at `/household/family/projects/prefs/{user}`. Notifications stored at `/household/family/projects/notifications/{user}/{id}`.

**Acceptance criteria:**
- [ ] Bell + count badge in header (top-level, all modules)
- [ ] Dropdown lists last 30 notifications for current user
- [ ] Click notification → navigates to source task (cross-module nav)
- [ ] Preferences modal saves per-user prefs
- [ ] Two-browser real-time: user A's action surfaces in user B's bell within ~2 sec

**Verification:**
- [ ] Two-browser smoke test
- [ ] Refresh: bell state persists from Firebase

**Dependencies:** 6.1
**Files likely touched:** `app/index.html`, `app/js/shell.js`, `app/js/modules/projects/notifications.js`, `app/css/style.css`
**Estimated scope:** M

---

#### Task 6.3: Email queue write + n8n workflow

**Description:** When `eventToNotification()` produces a notification AND user prefs allow email AND mode is "instant", also write to `/household/family/email_queue/{eventId}`:

```json
{
  "to": "user@email.com",
  "subject": "[Family Planner] Task assigned: <name>",
  "bodyHtml": "<rendered HTML>",
  "kind": "task_assigned",
  "sourceUrl": "https://metalbee66.github.io/financial-planner/#/projects/<id>/tasks/<tid>",
  "queuedAt": "2026-04-27T..",
  "sent": false,
  "attempts": 0
}
```

Build the corresponding n8n workflow (using the n8n MCP tools): Schedule trigger every 60s → HTTP node fetching unsent items from Firebase REST API → Loop → Microsoft Outlook (Send Email) node → PATCH RTDB to mark sent. On HTTP failure, increment `attempts`; after 3, mark `failed: true`.

**Acceptance criteria:**
- [ ] Browser-side: queue entry appears in Firebase when an "instant" notification fires
- [ ] n8n workflow runs every 60s
- [ ] Email arrives in target inbox within ~2 minutes of trigger
- [ ] Sent items marked `sent: true` with `sentAt`
- [ ] Failed items retried up to 3x then marked `failed: true`

**Verification:**
- [ ] Trigger an assignment in app → email lands in target inbox within 2 minutes
- [ ] Stop n8n: queue grows. Restart: queue drains
- [ ] Check Firebase RTDB after each run for correct state

**Dependencies:** 6.2; n8n + M365 Outlook configured (manual ops in user-actions.md)
**Files likely touched:** `app/js/modules/projects/notifications.js`; n8n workflow (created via MCP)
**Estimated scope:** M

---

#### Task 6.4: Daily digest mode

**Description:** For users with `mode: "digest"`, instead of enqueuing per-event, accumulate notifications into `/household/family/projects/digest_pending/{user}/`. A separate n8n workflow runs daily at 8:00am Australia/Melbourne: reads each user's digest, if non-empty composes a single summary email ("3 tasks assigned, 2 overdue, 1 milestone reached"), sends, clears the bucket.

**Acceptance criteria:**
- [ ] Toggle digest mode in preferences
- [ ] Events collect in digest_pending instead of email_queue
- [ ] Daily n8n workflow sends one summary email per user with non-empty digest
- [ ] Bucket clears after send
- [ ] Empty digests don't send

**Verification:**
- [ ] Switch user to digest mode, generate 5 events, manually trigger the digest workflow → one summary email arrives
- [ ] Empty digest → no email sent

**Dependencies:** 6.3
**Files likely touched:** `app/js/modules/projects/notifications.js`; second n8n workflow
**Estimated scope:** M

---

#### Task 6.5: Email queue admin panel

**Description:** Hidden admin sub-tab inside Projects (only visible to logged-in admin user, default = Brad). Lists last 50 queue items with status (pending/sent/failed), timestamps, retry count, and a "retry" button for failed items. Helps debug n8n workflow issues without touching Firebase console.

**Acceptance criteria:**
- [ ] Admin tab visible only to whitelisted admin user(s)
- [ ] Renders last 50 queue items
- [ ] Filter: pending / sent / failed
- [ ] "Retry" sets `sent: false, attempts: 0` so n8n picks it up again
- [ ] "Clear sent" purges items where sent=true and older than 7 days

**Verification:**
- [ ] Force a failure (bad email address) → appears with status failed → retry button works after fixing data

**Dependencies:** 6.3
**Files likely touched:** `app/js/modules/projects/views/email-queue-admin.js` (new)
**Estimated scope:** S

---

### Checkpoint G — After 6.1–6.5

- [ ] Two-user notification flow works end-to-end (in-app + email)
- [ ] Daily digest tested
- [ ] Admin panel can debug a forced failure
- [ ] Reviewed by user

---

### Phase 7 — Celebrations & Local AI

#### Task 7.1: Celebration animations on task complete / milestone / project complete

**Description:** Pool of 5+ randomized celebrations triggered by `task → done` (and stronger variants on milestone-done and all-tasks-done): confetti shower (canvas), emoji rain (DOM), badge pop-in, optional WebAudio chime (off by default, user-toggleable). Pool variety so users don't see the same one twice in a row.

**Acceptance criteria:**
- [ ] Marking a non-milestone task done triggers a small celebration (e.g. emoji burst)
- [ ] Marking a milestone done triggers a stronger celebration (confetti)
- [ ] Last project task done triggers full-screen celebration
- [ ] Animation auto-clears within 3 sec; doesn't block interaction
- [ ] User setting toggle to disable/enable sound

**Verification:**
- [ ] Mark 5 tasks done in a row → all 5 celebrations are different
- [ ] Manual check: animations look polished, don't lag

**Dependencies:** 2.1
**Files likely touched:** `app/js/projects.js`, `app/js/celebrate.js` (new), `app/css/style.css`
**Estimated scope:** M

---

#### Task 7.2: Local AI helpers (no API calls)

**Description:** Heuristic-only assist features:
1. Suggest task names from history (autocomplete on task-create input from past task names with frequency weight)
2. Auto-suggest due date from project span (median offset from past tasks)
3. Daily digest text on dashboard: template-generated summary ("You have 3 tasks due today, 1 overdue, 2 milestones next week")
4. Stale-project flag: project has had no task updates in >14 days → orange badge
5. Smart-sort tasks by urgency: weighted (overdue × 3) + (due-soon × 2) + (priority × 1) + (deps-blocking-others × 2)

**Acceptance criteria:**
- [ ] Task-create input shows autocomplete suggestions from history
- [ ] Due-date suggestion populates as a default (user can override)
- [ ] Dashboard shows daily digest paragraph
- [ ] Stale flag appears on projects with no recent activity
- [ ] Smart-sort option available in list view

**Verification:**
- [ ] All 5 heuristics produce plausible output on demo data
- [ ] No external network requests in DevTools Network tab while using these features

**Dependencies:** 5.3, 4.1
**Files likely touched:** `app/js/projects.js`, `app/js/local-ai.js` (new)
**Estimated scope:** M

---

### Checkpoint H — After 7.1, 7.2

- [ ] Celebrations feel good across multiple completions
- [ ] AI helpers add value without API calls
- [ ] Reviewed by user

---

### Phase 8 — Migrate PM DLBooks → Projects, Retire Old Tab

#### Task 8.1: Data migration

**Description:** One-time migration: read existing `pm_dlbooks` Firebase/localStorage data, convert each macro initiative + each customer-task into a project under the new schema, preserving status/assignee/notes/subtasks. Macro becomes a project named "Macro Initiatives"; each customer becomes a project named "DLBooks — {customer}". Migration runs once and writes a `pm_dlbooks_migrated_to_projects: true` flag.

**Acceptance criteria:**
- [ ] Migration runs once on first load after upgrade
- [ ] Existing PM DLBooks data appears in Projects tab as projects
- [ ] Original `pm_dlbooks` data preserved (not deleted) until user confirms
- [ ] Migration is idempotent (re-running doesn't double-create)

**Verification:**
- [ ] Run on a backup of real `pm_dlbooks` data → verify all tasks present
- [ ] Refresh → no second migration run

**Dependencies:** All of Phase 1–3
**Files likely touched:** `app/js/projects.js`, `app/js/pm.js` (read only)
**Estimated scope:** S

---

#### Task 8.2: Retire PM DLBooks tab

**Description:** Once 8.1 verified by user, remove `PM DLBooks` tab nav button + section in `index.html`; remove `pm.js` import from index; archive (don't delete) `pm.js` and `loadPM`/`savePM` references. Remove from `firebase-sync.js` listeners. Update CHANGELOG.

**Acceptance criteria:**
- [ ] PM DLBooks tab no longer visible
- [ ] No console errors from missing pm.js refs
- [ ] CHANGELOG documents the migration
- [ ] Old `pm_dlbooks` Firebase key untouched (manual cleanup later)

**Verification:**
- [ ] Full smoke test: all remaining tabs work, no console errors
- [ ] User confirms migration acceptable

**Dependencies:** 8.1 + user sign-off
**Files likely touched:** `app/index.html`, `app/js/app.js`, `app/js/firebase-sync.js`, `app/CHANGELOG.md`
**Estimated scope:** XS

---

### Checkpoint I — After 8.1, 8.2 — DONE

- [ ] All acceptance criteria across all phases met
- [ ] Smoke test on production after deploy
- [ ] User reviews and signs off
- [ ] Tag a release in CHANGELOG (v2.0.0 — Family Planner with Projects)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Total scope is huge for a vanilla-JS, single-dev cadence | High | Each phase is independently shippable. After Phase 3, the module is already useful even without views or email. |
| **Phase 0 ES-module + monolith conversion regresses Finance** | High | Done on a feature branch with full smoke test; Task 0.2 splittable into halves if any tab regresses |
| Firebase RTDB row-size limits with attachments + comments | Medium | Cap inline attachments at 500 KB; warn at 2 MB total per task; offer URL refs as alternative |
| Timeline (Gantt) is the riskiest single feature task (4.2) | Medium | Pre-split fallback into 4.2a (bars) and 4.2b (deps + milestones) |
| Real-time multi-user races (two users editing same task) | Medium | Use Firebase `transaction()` for status changes; last-write-wins on free-text fields with toast warning |
| **n8n + M365 not yet running on SEi14** | Medium | Phase 6 designed so 6.1, 6.2, 6.4 (in-app + queue logic) work before n8n is up; only 6.3 (the n8n workflow itself) blocks on infra. Tracked in user-actions.md. |
| **Email send rate / spam reputation** | Low | Daily digest mode caps per-user email volume; M365 Outlook handles deliverability |
| Migration of PM DLBooks data may surprise user | Medium | Migration preserves original key, gated behind explicit user sign-off in 8.2 |
| Vanilla JS bracket bugs | Low | Bracket-check rule already in CLAUDE.md; enforce before each commit |

---

## Resolved Decisions (from review)

| # | Question | Resolution |
|---|---|---|
| 1 | PM DLBooks: replace or coexist? | **Modular monolith** — DLBooks rolled into Projects in Phase 8, Finance preserved as a module |
| 2 | External participant identifier | **None for v1** — `brad` and `diana` only; revisit if family/business members are added later |
| 3 | Archive vs hard delete | **Archive default**, hard delete behind a second confirm |
| 4 | Time tracking | **Out of scope** for v1 |
| 5 | Custom fields | **Out of scope** for v1 |
| 6 | Tags / labels | **Out of scope** for v1 |
| 7 | Notifications channel | **Email via n8n + M365 Outlook (sensei infra)** + lightweight in-app bell. Browser Notification API dropped. |
| 8 | Build tools | **Native ES modules**, no bundler, no transpiler — keeps the "git push to deploy" workflow |
| 9 | Tracking of manual ops | **[user-actions.md](user-actions.md)** maintained throughout; reviewed at project completion |

---

## Still-Open Questions

1. **Firebase project rename**: stay on `financial-planner-e85d4-default-rtdb` (keeps existing data, mismatches new branding), or migrate to a new `family-planner-*` project (clean naming, requires data migration)? Recommendation: stay; cosmetic mismatch is fine. Tracked as a deferred decision in user-actions.md.
2. **GitHub Pages URL**: same tradeoff — rename repo `financial-planner` → `family-planner` breaks the URL until redirect. Recommendation: defer indefinitely; visible name "Family Planner" inside the app is enough.
3. **Email from-address**: Personal Gmail (`metalbee66@gmail.com`) or M365 business email (`info@<businessdomain>`)? Affects credential setup in n8n. Tracked in user-actions.md.
4. **Celebration sound source**: Bring your own asset files, or WebAudio-synthesized tones? Default plan: WebAudio tones (zero deps).

---

## Parallelization Opportunities

If multiple sessions are available:
- **Safe to parallelize after Phase 0:** Phase 4 sub-views (4.1, 4.2, 4.3), Phase 5 sub-views (5.1–5.4), Phase 7 (7.1, 7.2)
- **Must be sequential:** Phase 0 (the four sub-tasks must run in order) → 1 → 2 → 3 → 6.1 → 6.2; Phase 8 last
- **Needs coordination:** Phase 6 builds on the audit-event schema from 3.3 — settle that contract first
