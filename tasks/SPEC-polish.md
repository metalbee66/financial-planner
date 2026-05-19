# Spec: Polish Round — Phase 5 → Phase 6 Bridge

> Picks up the three open items left in the [Polish backlog](todo.md#polish-backlog--phase-5-smoke-findings-2026-05-15) from the 2026-05-15 Checkpoint F smoke test. Lands as a self-contained polish round before Phase 6 (email notifications) begins. Owner: Brad. Reviewer: Brad.

## Objective

Close out PB.7, PB.8, and PB.9 so Phase 6 starts from a clean Checkpoint F. Each item turns a real friction surfaced in two-user testing into a built, tested, deployed behaviour.

**In scope:**

- **PB.7 — Project status auto-derivation (hybrid).** Project status is *derived* from task completion by default; user can break the link with a manual override.
- **PB.8 — Dashboard card drill-down.** Every Dashboard card that names a task subset opens the List view filtered to that subset.
- **PB.9 — Joint-assignee.** `task.assignee` (string) becomes `task.assignees` (array of participant IDs). Renders "Joint" in UI when both Brad + Diana are selected.

**Out of scope:**

- Phase 6 work (in-app bell, n8n wiring, email queue). PB.7/8/9 must not regress notifications.
- Reviving the shelved Timeline dependency arrows (PB.4) — explicitly deferred.
- Any new tabs, views, or data entities.

**Done state:** Checkpoint F can be re-smoked against the three reopened items and pass cleanly, plus `npm run test:e2e` green, plus the in-browser unit suite green.

## Tech Stack

Unchanged from project baseline:

- Vanilla HTML / CSS / ES modules. No build step. No frameworks. No new runtime deps.
- Firebase Realtime DB (auth + sync).
- Playwright (dev-only) for E2E. In-browser test runner at `/tests.html` for the data layer.

## Commands

Run from `app/`:

```bash
python server.py          # Local dev at http://localhost:8080
npm run test:e2e          # Playwright E2E (~9 min, 112 tests + tests.html driver, 251 unit cases)
npm run test:e2e -- --grep "PB.7"   # During dev: scoped runs only
```

Manual:

- Two-tab Firebase round-trip smoke (Brad-tab + Diana-tab) before merging PB.9.
- Visual sanity pass on Dashboard, List view, Task panel after each PB lands.

## Project Structure

No new top-level files. Everything lands in the existing Projects module:

```
app/js/modules/projects/
├── data.js                 ← schema + helpers (assignees array, derived-status helper)
├── data.test.js            ← unit cases for new helpers
├── index.js                ← UI: list/detail/form, task panel, dashboard, render hooks
└── notifications.js        ← audit-event map (touch only if assignees array changes payload shape)

app/css/style.css           ← styles for the override toggle + drill-down hover affordance

app/tests-e2e/smoke.spec.js ← new blocks: pb7-status-derive, pb8-drill-down, pb9-joint-assignee
```

## Code Style

Match the existing `data.js` style: small pure functions, explicit named exports, no classes, comments only where the *why* isn't obvious. Example shape for the new helpers:

```js
// data.js

/**
 * Resolve the effective project status.
 *
 * If the project has `statusOverride` set, that wins. Otherwise derive from
 * the task list: 0% done → 'planning', >0% & <100% → 'active', 100% → 'completed'.
 * Empty task list returns the stored status (still 'planning' by default).
 */
export function effectiveProjectStatus(project, tasks) {
    if (project.statusOverride) return project.status;
    if (!tasks || tasks.length === 0) return project.status;
    const done = tasks.filter(t => t.status === 'done').length;
    if (done === 0) return 'planning';
    if (done === tasks.length) return 'completed';
    return 'active';
}

/**
 * Normalise legacy `task.assignee` (string) into the new `task.assignees`
 * (array). Pure, idempotent, safe to call on any task shape.
 */
export function readAssignees(task) {
    if (Array.isArray(task.assignees)) return task.assignees;
    if (typeof task.assignee === 'string' && task.assignee) return [task.assignee];
    return [];
}
```

Conventions to keep:

- Currency via `fmt()` / `fmtPlain()` / `fmtSigned()` from `data.js`. (Not relevant here but still the rule.)
- Bracket-check every JS file before commit.
- One feature per commit. Conventional-ish messages: `pb7: derive project status from task completion`.

## Testing Strategy

**Unit (data.test.js, in-browser):**

- `effectiveProjectStatus(project, tasks)` — covers all 5 statuses × override on/off × empty/partial/full task list.
- `readAssignees(task)` — legacy string, new array, missing field, empty string.
- `setTaskAssignees(task, ids)` — replaces field, bumps `updatedAt`, validates IDs against the project's participants.
- Filter / group helpers updated to consume `assignees` array (intersection semantics: a task with assignees `[brad,diana]` matches a filter on `brad` AND a filter on `diana`).
- Target: ≥15 new unit cases added across the three PBs.

**E2E (Playwright):**

One block per PB in `smoke.spec.js`:

- `pb7-status-derive` — create project with one task; flip task to done; assert project list shows `completed`. Toggle override on, set status to `on-hold` manually; assert override sticks across reload.
- `pb8-drill-down` — open Dashboard; click "Due this week" card; assert List view opens with the matching filter applied and the correct task count rendered.
- `pb9-joint-assignee` — open a task; select both Brad and Diana; save; assert task row in List view renders "Joint"; assert filtering by Brad and filtering by Diana both include this task.

**Coverage gate:** all new behaviour has unit + E2E coverage. No PB ships green-on-manual-smoke-only.

## Boundaries

**Always do:**

- Commit + push the current state before starting each PB (CLAUDE.md rule).
- Run `npm run test:e2e` green before each merge to `master`.
- Two-tab Firebase smoke before PB.9 ships (legacy assignee → array migration must not strand existing tasks).
- Keep `task.assignee` reads working via `readAssignees()` so historic Firebase data round-trips.
- Update `data.test.js` *in the same commit* as the helper it covers.

**Ask first:**

- Any change to Firebase schema beyond adding `task.assignees` and `project.statusOverride` (e.g. migration scripts, data backfill).
- Any change to the notification trigger map in `notifications.js` (touching Phase 6.1 work).
- Renaming or removing existing exports from `data.js` (consumers in `index.js` and possibly the legacy `pm.js` could break).
- Adding a third assignee identity beyond Brad / Diana / external participants.

**Never do:**

- Revive Timeline dep arrows under cover of this round. They are shelved (PB.4).
- Hard-delete the legacy `task.assignee` field from any record. Tolerate both shapes on read forever.
- Skip the bracket-check before commit.
- Commit red. If E2E is failing, fix the code or the test in the same session — do not defer.

## Success Criteria

Each PB is "done" when *every* line below is true.

**PB.7 — Project status auto-derive (hybrid):**

- `project` schema gains `statusOverride: boolean` (default `false`). Persisted to Firebase.
- `effectiveProjectStatus(project, tasks)` is the single read path for status display across List / Overview / Dashboard / Detail.
- With override OFF and tasks exist: status auto-promotes through `planning` → `active` → `completed` as tasks flip to done.
- With override ON: status is exactly what the user picked, including the non-derived values `on-hold` and `cancelled`.
- The project edit form has a clear UI toggle ("Manage status manually") that controls `statusOverride`. Toggling it ON freezes whatever the derived status currently is; toggling OFF re-derives immediately.
- Unit + E2E coverage as above.

**PB.8 — Dashboard card drill-down:**

- Every Dashboard card that represents a task subset (e.g. "Due this week", "Overdue", "Completed this week", "Blocked", per-status counts) is clickable.
- Clicking a card switches to the List view *and* applies the filter that produces exactly that card's count. Card count and resulting list count must match.
- Non-task cards (e.g. summary headlines that aren't a task subset, if any) are not clickable — no broken affordances.
- A hover affordance (cursor + subtle background) signals which cards are clickable.
- Unit + E2E coverage as above.

**PB.9 — Joint-assignee (multi-select):**

- `task` schema gains `assignees: string[]` (participant IDs). `task.assignee` field is preserved on existing records and read via `readAssignees()` but no longer written for new tasks.
- Task form replaces the single assignee dropdown with a multi-select (checkboxes or chip picker — pick whichever fits the existing UI vocabulary best).
- List view row renders "Joint" when assignees = `['brad','diana']` (exact set). Otherwise renders the comma-joined display names.
- List view filter on assignee uses array-intersection: filtering by Brad includes tasks where Brad is *one of* the assignees.
- My Tasks view (per-user summary) includes any task where the current user is *one of* the assignees.
- Audit feed entries for assignee changes show the before/after as comma-joined display names.
- Notification trigger map (`notifications.js`) recipient resolver returns *every* assignee, not just the first.
- Two-tab Firebase smoke: Brad creates a joint task, Diana sees it on My Tasks within ~3s.
- Unit + E2E coverage as above.

**Overall:**

- Full `npm run test:e2e` run green.
- All three blocks added to `tests-e2e/smoke.spec.js`.
- `tasks/todo.md` updated: PB.7, PB.8, PB.9 ticked with commit hashes.
- `HANDOVER.md` Polish-backlog summary updated to reflect 9 of 9 resolved.
- `CHANGELOG.md` entry under "Unreleased" (or v2.0.0 if cutting tag soon).

## Open Questions

1. **PB.8 card inventory.** I'll enumerate the current Dashboard cards during planning and confirm which are subset-cards (drillable) vs. headline metrics (not). Worth a 2-minute look at `index.js` Dashboard render before tasking.
2. **PB.7 + cancelled/on-hold semantics.** Spec says these only appear via override. Is that desired, or should there be a derive rule for `cancelled` (e.g. all tasks cancelled → project cancelled)? Default in spec is *no*: `cancelled` and `on-hold` are intent, not state, so they stay manual-only.
3. **PB.9 assignee chip UI.** Checkboxes in a dropdown vs. inline chip-picker vs. tag-input. I'll pick whichever matches the closest existing pattern in the app; flag in PR if no good precedent.
4. **PB.9 migration cadence.** Should we backfill `assignees = [assignee]` on first write per task (lazy), or run a one-shot migration in `shell.js` boot? Lazy is simpler; recommend lazy unless there's a query that needs the field present.
