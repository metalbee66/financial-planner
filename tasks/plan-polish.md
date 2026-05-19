# Implementation Plan: Polish Round — PB.7, PB.8, PB.9

> Companion to [SPEC-polish.md](SPEC-polish.md). Vertical slices, each leaves the app green and shippable. Total estimate: **9 tasks across 3 phases + wrap**, ~1 polish-week of focused sessions.

## Overview

Close the three open Polish Backlog items from Checkpoint F (2026-05-15). Phase ordering: PB.7 first (smallest, independent), then PB.9 (largest blast radius), then PB.8 (depends on PB.9's final filter shape). Wrap step refreshes the planning docs and CHANGELOG.

## Architecture Decisions

- **PB.7 — Hybrid via `statusOverride` flag.** `effectiveProjectStatus(project, tasks)` is the single read path. Override `false` → derive between `planning`/`active`/`completed`. Override `true` → use stored `status` exactly, including the manual-only `on-hold` and `cancelled`. _Rationale: keeps `cancelled`/`on-hold` as intent rather than state; preserves user control._
- **PB.9 — Lazy backfill via `sanitiseTask`.** On load, `sanitiseTask` populates `assignees = [assignee]` if legacy field present. No one-shot migration. Every consumer reads via `readAssignees(task)`. _Rationale: matches the existing sanitiser pattern and avoids touching Firebase outside the normal write path._
- **PB.9 — Bucket key = sorted comma-joined IDs; label "Joint" when canonical.** Group-by-assignee buckets are keyed on the sorted joined string (`"brad,diana"`). Display layer renders "Joint" for that exact pair, otherwise comma-joined display names. _Rationale: generalises beyond two participants; no special joint-only value to migrate later._
- **PB.8 — New `dashboardView` filter primitive (enum), not new persistent UI.** `filterTasks` accepts `f.dashboardView` ∈ `{ 'overdue', 'dueThisWeek', 'completedLast30Days', 'upcomingMilestones', 'open' }`. Cards navigate to the List view with this preset; Reset Filters button (PB.3) clears it. _Rationale: every card maps to a pure data predicate; no need for separate date-window UI._
- **All three PBs land sequentially on `master`.** Each phase's checkpoint is a real merge, not a feature branch. The existing CLAUDE.md rule (commit + push before edits) gives us the rollback point.

## Dependency Graph

```
data.js / data.test.js                  ← Foundation, no deps
    │
    ├── effectiveProjectStatus()        T1 (PB.7 data)
    │       │
    │       └── Project form + reads    T2 (PB.7 UI)
    │
    ├── readAssignees() + filter/group  T3 (PB.9 data)
    │       │
    │       ├── Task form + panel       T4 (PB.9 form/panel)
    │       │       │
    │       │       └── List/MyTasks    T5 (PB.9 list)
    │       │               │
    │       │               └── Audit + notifications  T6 (PB.9 wrap)
    │
    └── dashboardView filter            T7 (PB.8 data)
            │
            └── Dashboard click-through T8 (PB.8 UI)

Wrap: HANDOVER + todo.md + CHANGELOG    T9
```

PB.7 and PB.9 are independent at the data layer (different schemas). PB.8 should land after PB.9 so the dashboard filter dispatch sees the final intersection-aware `filterTasks`.

---

## Phase 1 — PB.7: Hybrid project-status derivation

### T1: PB.7 data layer

**Description:** Add `statusOverride` to the project schema (default `false`) and ship the `effectiveProjectStatus(project, tasks)` helper. Pure functions only — no UI changes yet. Existing project records still load cleanly via `sanitiseProject`.

**Acceptance criteria:**
- [ ] `PROJECT_STATUSES` unchanged. `statusOverride: boolean` added to `createProject` (default `false`), `validateProject` (boolean check only).
- [ ] `sanitiseProject` defaults `statusOverride`: missing/`false` for status ∈ `{planning, active, completed}` → `false`; for status ∈ `{on-hold, cancelled}` → `true`. Explicit existing value always wins.
- [ ] `effectiveProjectStatus(project, tasks)` exported from `data.js`. Override-on returns stored `status`. Override-off with empty/missing task list returns stored `status`. Override-off with tasks: 0 done → `planning`, all done → `completed`, otherwise → `active`. Stored `status` of `on-hold`/`cancelled` is preserved verbatim when override is on.
- [ ] No UI consumers yet — verified via `git grep effectiveProjectStatus` showing only `data.js` + `data.test.js`.

**Verification:**
- [ ] Unit: `npm run test:e2e -- --grep tests.html` (the in-browser unit runner is part of the harness). New cases ≥8: override on×3 statuses, override off × {empty, 0-done, partial, all-done, all-cancelled}.
- [ ] Build sanity: `python server.py`, open app, projects load and render existing status badges unchanged (because UI still reads `project.status` directly).

**Dependencies:** None.

**Files likely touched:**
- `app/js/modules/projects/data.js`
- `app/js/modules/projects/data.test.js`

**Estimated scope:** S (2 files).

---

### T2: PB.7 UI — toggle + read-path migration

**Description:** Project edit form gains "Manage status manually" checkbox. Every render that displays project status routes through `effectiveProjectStatus`. New E2E block.

**Acceptance criteria:**
- [ ] Project form has a labelled checkbox bound to `statusOverride`. Off by default for new projects. Edit form reflects the current value.
- [ ] Toggling override ON keeps the currently-displayed (derived) status as the new stored `status`. Toggling OFF re-derives on the next render.
- [ ] All four status-displaying surfaces use `effectiveProjectStatus`: Projects list, Overview tab, Dashboard `activeProjects` card count, Project detail header.
- [ ] Status-dependent filters (Projects list "active only", Dashboard "active projects" count) use effective status, not stored.
- [ ] CSS: the toggle inherits existing form-control styling; no new CSS rules unless absolutely required.

**Verification:**
- [ ] Unit: regressions in `data.test.js` green (T1's cases still pass).
- [ ] E2E: new `pb7-status-derive` block in `tests-e2e/smoke.spec.js`. (1) Create project, add task, mark done → project shows `completed`. (2) Toggle override ON, set status to `on-hold` → reload, status sticks. (3) Toggle override OFF → status re-derives to `completed`.
- [ ] Full `npm run test:e2e` green.
- [ ] Manual: two-tab Firebase round-trip — toggle override in tab A, verify tab B sees the change within ~3s.

**Dependencies:** T1.

**Files likely touched:**
- `app/js/modules/projects/index.js`
- `app/css/style.css` (only if the existing checkbox style needs a tweak)
- `app/tests-e2e/smoke.spec.js`

**Estimated scope:** M (3 files).

---

### Polish Checkpoint 1 — PB.7 complete

- [ ] `npm run test:e2e` green (112 + new block, expect ≤30s additional runtime).
- [ ] Two-tab Firebase smoke clean.
- [ ] Visual sanity: existing project status badges unchanged for override-on records; derived for override-off.
- [ ] User review + merge to `master`.
- [ ] `todo.md` row PB.7 ticked with commit hash.

---

## Phase 2 — PB.9: Joint-assignee (multi-select)

### T3: PB.9 data layer

**Description:** Schema change `assignee: string` → `assignees: string[]`. Lazy backfill via `sanitiseTask`. New helpers. `filterTasks` learns intersection semantics. `groupTopLevelTasks` learns the joint-key bucket. Legacy `assignee` field tolerated forever on read.

**Acceptance criteria:**
- [ ] `createTask` writes `assignees: string[]` (from `input.assignees` or `[input.assignee]` or `[]`). Stops writing `assignee`.
- [ ] `sanitiseTask` backfills `assignees` if missing/empty using legacy `assignee`. Preserves any existing `assignees` array.
- [ ] `validateTask` validates `assignees` (array of strings) instead of `assignee`.
- [ ] `readAssignees(task)` returns the canonical array regardless of which field is populated.
- [ ] `filterTasks`: `f.assignee = 'brad'` matches every task where `'brad' ∈ readAssignees(t)`. Original single-assignee behaviour preserved.
- [ ] `groupTopLevelTasks(..., 'assignee')`: bucket key is `readAssignees(t).slice().sort().join(',')`; empty array → `''` (unassigned). Order: `brad`, `diana`, `brad,diana` (joint), other single-IDs alphabetically, other multi-IDs alphabetically, unassigned.
- [ ] No UI changes yet.

**Verification:**
- [ ] Unit: ≥10 new cases — backfill from legacy, intersection filter (single + joint task), group bucket order, joint key sort stability, empty input.
- [ ] In-browser tests green.

**Dependencies:** None (independent of PB.7).

**Files likely touched:**
- `app/js/modules/projects/data.js`
- `app/js/modules/projects/data.test.js`

**Estimated scope:** M (2 files, dense logic).

---

### T4: PB.9 task form + task panel UI

**Description:** Replace the single assignee dropdown in the task form with a multi-select. Task panel renders one chip per assignee, or a single "Joint" chip when the canonical Brad+Diana pair is selected.

**Acceptance criteria:**
- [ ] Task form assignee control becomes a checkbox group (or chip picker — pick whichever fits closest existing UI vocabulary). Reads/writes `assignees` array.
- [ ] On submit, form writes `assignees` and omits `assignee` (legacy field).
- [ ] Task panel header chip area: one `chip` per assignee using existing `chip` / `chip-external` styles. When `assignees` is exactly `['brad', 'diana']`, render one "Joint" chip instead.
- [ ] Unassigned tasks render "Unassigned" exactly as today.

**Verification:**
- [ ] Build sanity: open existing tasks (some with legacy `assignee`, some new) and confirm chips render correctly.
- [ ] Full `npm run test:e2e` green — existing assignee-related E2E should pass against the new shape thanks to T3's compatibility.

**Dependencies:** T3.

**Files likely touched:**
- `app/js/modules/projects/index.js`
- `app/css/style.css` (if multi-select needs new styles)

**Estimated scope:** M (2 files).

---

### T5: PB.9 list view, group, filter UI, My Tasks

**Description:** List view row uses the same "Joint" rule. Group-by-assignee bucket labels render "Joint" for the canonical key. Filter dropdown stays single-select but consumers the intersection semantics from T3. My Tasks per-user view includes any task where current user ∈ `assignees`.

**Acceptance criteria:**
- [ ] List view row chip column applies the same chip rule as the task panel.
- [ ] Group-by-assignee bucket headers render display names (e.g. "Brad", "Diana", "Joint", "Alex (external)", "Unassigned").
- [ ] Filter "Assignee" dropdown options unchanged in shape; semantics now match T3's intersection rule (selecting "Brad" includes joint tasks).
- [ ] My Tasks view picks up joint tasks for the current user.

**Verification:**
- [ ] Full `npm run test:e2e` green.
- [ ] Manual: create a joint task, verify it appears in Brad's My Tasks AND Diana's My Tasks; verify group-by-assignee renders the "Joint" bucket; verify single-assignee filter still shows joint tasks.

**Dependencies:** T3, T4.

**Files likely touched:**
- `app/js/modules/projects/index.js`

**Estimated scope:** M (1 file, multiple call sites).

---

### T6: PB.9 audit feed + notifications + E2E

**Description:** Audit feed renders assignee-change events as comma-joined display names. `notifications.js` recipient resolver returns every assignee, not just the first. Ship the E2E block. Two-tab Firebase smoke.

**Acceptance criteria:**
- [ ] Audit-event payload for assignee changes captures `before: string[]` and `after: string[]` (or null for legacy). Render "Brad → Brad, Diana".
- [ ] `notifications.js` `resolveRecipients(...)` includes every member of `assignees` for task-level events. Backwards-compatible read path on legacy events.
- [ ] Notification-trigger unit tests in `data.test.js` updated to cover joint-assignee recipient resolution.

**Verification:**
- [ ] Unit: ≥3 new cases on `notifications.js` recipient resolution (single, joint, unassigned).
- [ ] E2E: new `pb9-joint-assignee` block. (1) Create task with both Brad + Diana selected. (2) Assert row renders "Joint". (3) Filter by Brad — task is present. (4) Filter by Diana — task is present.
- [ ] Manual two-tab Firebase: Brad creates a joint task, Diana sees it on My Tasks within ~3s. Brad changes assignees to Diana-only, audit feed shows "Brad, Diana → Diana".

**Dependencies:** T5.

**Files likely touched:**
- `app/js/modules/projects/index.js` (audit render)
- `app/js/modules/projects/notifications.js`
- `app/js/modules/projects/data.test.js`
- `app/tests-e2e/smoke.spec.js`

**Estimated scope:** M (4 files).

---

### Polish Checkpoint 2 — PB.9 complete

- [ ] `npm run test:e2e` green.
- [ ] Two-tab Firebase smoke clean (joint task round-trips Brad ↔ Diana).
- [ ] Spot-check: every assignee-touching code path in `git grep assignee` either uses `readAssignees()` or has an explicit reason not to.
- [ ] No regression on existing single-assignee tasks (both legacy-stored and newly-written).
- [ ] `todo.md` row PB.9 ticked with commit hash.
- [ ] User review + merge to `master`.

---

## Phase 3 — PB.8: Dashboard card drill-down

### T7: PB.8 filter primitive (`dashboardView`)

**Description:** Extend `filterTasks` with a `dashboardView` enum that resolves to a pure date-aware predicate against a reference `today` ISO date. Card-to-view mapping established.

**Acceptance criteria:**
- [ ] `filterTasks(list, { dashboardView, today })` supports views: `'overdue'`, `'dueThisWeek'`, `'completedLast30Days'`, `'upcomingMilestones'`, `'open'` (open = status not done). Returns `list` unchanged when `dashboardView` absent.
- [ ] Combines with existing filters via AND (e.g. `{ dashboardView: 'overdue', assignee: 'brad' }`).
- [ ] `dashboardView` filter is "scaffold-aware" the same way the existing filter is — non-matching parents kept when their subtasks match.
- [ ] `today` defaults to current ISO date if omitted; explicit `today` parameter exposed for deterministic tests.
- [ ] Card-to-view map exported from `data.js` (or `index.js` Dashboard section) so card click handlers stay declarative.

**Verification:**
- [ ] Unit: ≥5 new cases — one per `dashboardView` value, plus AND-with-assignee combination.
- [ ] In-browser tests green.

**Dependencies:** T3 (PB.9 must land first so intersection semantics interact correctly with the new filter).

**Files likely touched:**
- `app/js/modules/projects/data.js`
- `app/js/modules/projects/data.test.js`

**Estimated scope:** S (2 files).

---

### T8: PB.8 dashboard click-through UI + E2E

**Description:** Five task-subset Dashboard cards become clickable. Clicking applies the corresponding `dashboardView` and switches to the List view. `activeProjects` stays a non-clickable headline metric. Card count and filtered list count must match.

**Acceptance criteria:**
- [ ] Five task-subset cards (`openTasks`, `overdueTasks`, `dueThisWeek`, `completedLast30Days`, `upcomingMilestones`) render as clickable elements with `role="button"` and keyboard activation (`Enter` / `Space`).
- [ ] `activeProjects` card stays non-clickable — no hover affordance, no `role="button"` (Resolved Decision 1).
- [ ] Click navigates to the List view tab and applies `filters = { dashboardView: '<card.view>' }`. The Reset Filters button (PB.3) clears it.
- [ ] CSS: hover affordance (cursor: pointer + subtle background) on the five clickable cards only.
- [ ] Card count visible on the Dashboard equals the row count rendered in the List view immediately after navigation.

**Verification:**
- [ ] Full `npm run test:e2e` green.
- [ ] E2E: new `pb8-drill-down` block. For each task-subset card: assert clickable, click, assert List view shown, assert list length === card count.
- [ ] Manual: keyboard nav (Tab → Enter) lands on the same filtered List view.

**Dependencies:** T7.

**Files likely touched:**
- `app/js/modules/projects/index.js`
- `app/css/style.css`
- `app/tests-e2e/smoke.spec.js`

**Estimated scope:** M (3 files).

---

### Polish Checkpoint 3 — PB.8 complete

- [ ] `npm run test:e2e` green.
- [ ] Dashboard cards visually distinguish clickable vs. headline.
- [ ] Keyboard nav verified.
- [ ] `todo.md` row PB.8 ticked with commit hash.
- [ ] User review + merge to `master`.

---

## Phase 4 — Wrap

### T9: Update planning docs and CHANGELOG

**Description:** Reflect the closed polish round in the canonical project docs.

**Acceptance criteria:**
- [ ] `tasks/todo.md` Polish-backlog section: PB.7, PB.8, PB.9 ticked with commit hashes.
- [ ] `HANDOVER.md` opening paragraph updated: "9 of 9 polish-backlog items resolved" (or equivalent) and any architecture note worth carrying forward (esp. PB.9's `readAssignees()` compatibility rule and PB.7's `effectiveProjectStatus()`).
- [ ] `CHANGELOG.md` entry under Unreleased (or v2.0.0-rc if you want to cut one): three bullets for PB.7/8/9 with one-liner summaries.
- [ ] No code changes in this task — docs only.

**Verification:**
- [ ] `npm run test:e2e` still green after the merge (no code changed but sanity-check the latest tip).
- [ ] Read-through: HANDOVER opening matches reality.

**Dependencies:** Checkpoints 1, 2, 3 all closed.

**Files likely touched:**
- `app/tasks/todo.md`
- `app/HANDOVER.md`
- `app/CHANGELOG.md`

**Estimated scope:** XS (docs only).

---

### Polish Checkpoint DONE

- [ ] All three PBs merged and tested in production.
- [ ] Planning docs reflect reality.
- [ ] Brad + Diana have done a real-use sanity pass on the live site.
- [ ] Ready to start Phase 6 — Email Notifications.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PB.9 misses an `assignee` read site → renders incorrectly for joint tasks | High | T3 ships `readAssignees()` first; before T5 closes, `git grep -n "\.assignee\b" app/js` and triage every hit. |
| PB.9 group-by-assignee creates too many buckets in real data | Low | Brad+Diana+small set of externals → at most ~5 buckets in practice. Sort-and-join key keeps order stable. |
| PB.7 derivation surprises user (auto-promote to `completed` they didn't expect) | Med | Toggle defaults to off (derived) on *new* projects only; existing projects load with override defaulting to `false` *unless* their stored status is `on-hold` or `cancelled`, in which case `sanitiseProject` sets override = `true` so we don't flip non-derivable statuses. **Open Question 2 confirms this.** |
| PB.8 `activeProjects` card is a project subset, not task subset | Low | Open Question 1 — pick "not clickable" or "drill to Overview". |
| New E2E blocks push the suite over a comfortable runtime | Low | Three new blocks at ~30s each → ~10.5 min total. Still under the manual-test threshold. |
| Lazy backfill leaves stale `assignee` strings in Firebase forever | Low | Acceptable — `readAssignees()` makes it transparent. Optional cleanup task in a future phase if it bothers anyone. |

## Resolved Decisions (2026-05-19)

1. **PB.8 `activeProjects` card → NOT clickable.** Headline metric only. The other five cards (`openTasks`, `overdueTasks`, `dueThisWeek`, `completedLast30Days`, `upcomingMilestones`) are the drillable set. T8 acceptance updated accordingly.
2. **PB.7 sanitise-time default → split by status.** When loading existing records: status ∈ `{on-hold, cancelled}` → `statusOverride = true`. Status ∈ `{planning, active, completed}` → `statusOverride = false` (will derive). T1 acceptance updated accordingly.
3. **PB.9 assignee picker → inline checkbox group.** Matches existing form vocabulary. T4 implementation note locked.
4. **PB.9 backfill → lazy via `sanitiseTask`.** Per SPEC-polish.md. No one-shot migration.
