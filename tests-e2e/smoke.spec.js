/**
 * End-to-end smoke tests for Family Planner.
 *
 * Runs against the static site served by `python server.py` on :8080.
 * Firebase scripts are blocked at the network layer so the app falls back
 * to localStorage-only mode (`initFirebase` catches the `firebase is not
 * defined` ReferenceError and returns false in shell.js). This means
 * tests are deterministic, hermetic, and never touch real Firebase data.
 *
 * Coverage matrix vs. tasks/plan.md:
 *   Phase 1.1 — project CRUD: create / edit / delete / validation
 *   Phase 1.2 — participant editor: built-in toggle, external add/remove
 *   Phase 2.1 — tasks: inline add (Enter + focus retention), inline status
 *               change, slide-in panel, delete, cascade delete, sort,
 *               overdue styling, persistence round-trip via localStorage.
 *   Phase 2.2 — subtasks: + Subtask UI on parent panel only, indented render,
 *               delete-parent prompt (cascade vs promote), persistence.
 *   Phase 3.1 — task dependencies: add/remove via panel picker, cycle attempt
 *               rejected with inline error, "Blocked by N" badge appears on
 *               row and clears when prerequisite is marked done.
 *   Phase 3.2 — comments: append-only thread on task panel, empty rejected,
 *               persists across reload.
 *   Phase 3.3 — activity feed: status / assignee / due-date changes log
 *               events, dep add/remove log events, comments + events
 *               render interleaved by timestamp.
 *   Phase 3.4 — file attachments: file picker accepts ≤500 KB, oversize
 *               rejected, URL refs accepted, chips render with download/
 *               open links, remove + audit-event integration, persistence.
 *   Phase 3.5 — milestones: panel toggle, row diamond glyph, "milestones
 *               only" filter, persistence.
 *
 * Plus a `tests.html` driver that runs the in-browser data-layer unit suite
 * and asserts 0 failures — keeps unit + e2e in one CI command.
 *
 * What this does NOT cover (still smoke-test manually):
 *   - Real Firebase round-trip across browser tabs
 *   - Two-user concurrent editing
 *   - Visual layout / spacing on different screen sizes
 */

import { test, expect } from '@playwright/test';

// Block Firebase SDK + clear localStorage so each test starts from a known state
test.beforeEach(async ({ page }) => {
    await page.route('**/firebase-*-compat.js', route => route.abort());
    await page.goto('/');
    await page.evaluate(() => {
        localStorage.clear();
        // Phase 8.1 / v2.0.1: pre-mark both one-shot migrations as done so
        // tests that expect an empty Projects bucket don't get the demo
        // "Macro Initiatives" / "DLBooks — Reed Cranes" projects (from
        // DEFAULT_PM) or the SenseAi "Business transformation & scale"
        // seed (10 projects) pre-loaded. The Phase 8.1 + v2.0.1 describes
        // re-enable their migration explicitly via their own helpers.
        localStorage.setItem('projects', JSON.stringify({
            items: [], tasks: [], notifications: {}, prefs: {},
            digest_pending: {},
            pm_dlbooks_migrated_to_projects: true,
            business_transform_seeded: true,
            pm_dlbooks_cleaned: true,
            business_transform_update_20260525_applied: true,
            business_transform_extras_20260525_applied: true,
        }));
    });
    await page.reload();
    await page.waitForSelector('#module-host', { state: 'attached' });
    // Switch to Projects tab — Finance is the default
    await page.locator('.top-nav-btn[data-module="projects"]').click();
});

// Helpers — keep at module scope so each test reads cleanly
async function createProject(page, { name, status = 'active', startDate, endDate, description } = {}) {
    await page.locator('#projects-new-btn').click();
    await page.locator('#pf-name').fill(name);
    await page.locator('#pf-status').selectOption(status);
    if (startDate) await page.locator('#pf-start').fill(startDate);
    if (endDate) await page.locator('#pf-end').fill(endDate);
    if (description) await page.locator('#pf-desc').fill(description);
    await page.locator('#pf-save').click();
    // Submit jumps into the new project's detail view
    await expect(page.locator('.tasks-add-row')).toBeVisible();
}

async function backToList(page) {
    await page.locator('#projects-back-btn').click();
    await expect(page.locator('.projects-grid, .projects-empty-state')).toBeVisible();
}

/**
 * PB.9: the panel assignee picker became a checkbox group. This helper reproduces
 * the single-assignee semantics the old `selectOption('brad')` style had —
 * uncheck everything, then check the requested one. Pass '' / null for unassigned.
 */
async function setPanelAssignee(page, assignee) {
    const checkboxes = page.locator('#tp-assignees input[type="checkbox"]');
    const n = await checkboxes.count();
    for (let i = 0; i < n; i++) {
        const cb = checkboxes.nth(i);
        if (await cb.isChecked()) await cb.uncheck();
    }
    if (assignee) {
        await page.locator(`#tp-assignees input[type="checkbox"][value="${assignee}"]`).check();
    }
}

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 1.1 — Project CRUD', () => {

    test('empty state shows the new-project CTA', async ({ page }) => {
        await expect(page.locator('.projects-empty-state')).toBeVisible();
        await expect(page.locator('.projects-empty-state h2')).toHaveText('No projects yet');
    });

    test('can create a project and it appears in the list', async ({ page }) => {
        await createProject(page, { name: 'Reno', status: 'active', startDate: '2026-05-10', endDate: '2026-06-10' });
        await backToList(page);
        const card = page.locator('.project-card', { hasText: 'Reno' });
        await expect(card).toBeVisible();
        await expect(card.locator('.status-badge')).toHaveText('Active');
        await expect(card.locator('.project-card-dates')).toContainText('10/05/2026');
    });

    test('end-date before start-date is rejected with inline error', async ({ page }) => {
        await page.locator('#projects-new-btn').click();
        await page.locator('#pf-name').fill('Bad dates');
        await page.locator('#pf-start').fill('2026-06-01');
        await page.locator('#pf-end').fill('2026-05-01');
        await page.locator('#pf-save').click();
        await expect(page.locator('#pf-error')).toContainText('End date must be on or after start date');
        // Form stays open on validation error
        await expect(page.locator('#project-form')).toBeVisible();
    });

    test('edit dialog updates fields and persists', async ({ page }) => {
        await createProject(page, { name: 'Original', status: 'planning' });
        await backToList(page);
        await page.locator('.project-card', { hasText: 'Original' }).click();
        await page.locator('#projects-edit-btn').click();
        await page.locator('#pf-name').fill('Renamed');
        await page.locator('#pf-status').selectOption('on-hold');
        await page.locator('#pf-save').click();
        // Save returns to detail view
        await expect(page.locator('.projects-title')).toHaveText('Renamed');
        await expect(page.locator('.projects-toolbar .status-badge')).toHaveText('On hold');
    });

    test('delete confirms and removes the project', async ({ page }) => {
        await createProject(page, { name: 'Doomed' });
        await backToList(page);
        await page.locator('.project-card', { hasText: 'Doomed' }).click();
        await page.locator('#projects-edit-btn').click();
        page.once('dialog', d => d.accept());
        await page.locator('#pf-delete').click();
        await expect(page.locator('.projects-empty-state')).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 1.2 — Participants', () => {

    test('default participants are brad + diana', async ({ page }) => {
        await page.locator('#projects-new-btn').click();
        await expect(page.locator('input[data-builtin="brad"]')).toBeChecked();
        await expect(page.locator('input[data-builtin="diana"]')).toBeChecked();
    });

    test('can toggle a built-in off, add an external, remove the external', async ({ page }) => {
        await page.locator('#projects-new-btn').click();
        await page.locator('#pf-name').fill('Mixed crew');
        await page.locator('input[data-builtin="diana"]').uncheck();
        await page.locator('.participant-add-input').fill('Alex');
        await page.locator('.participants-adder .participant-add-btn').click();
        await expect(page.locator('.participants-chips .chip', { hasText: 'Alex' })).toBeVisible();
        // Save
        await page.locator('#pf-save').click();
        await expect(page.locator('.tasks-add-row')).toBeVisible();
        // Detail view chips reflect the choice
        const chips = page.locator('.project-detail-chips .chip');
        await expect(chips).toHaveCount(2); // Brad + Alex
        await expect(chips.filter({ hasText: 'Brad' })).toBeVisible();
        await expect(chips.filter({ hasText: 'Alex' })).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 2.1 — Tasks within a project', () => {

    test('clicking a project card opens the detail view', async ({ page }) => {
        await createProject(page, { name: 'Detail nav' });
        await backToList(page);
        await page.locator('.project-card', { hasText: 'Detail nav' }).click();
        await expect(page.locator('.tasks-header .tasks-title')).toHaveText('Tasks');
        await expect(page.locator('.tasks-empty')).toContainText('No tasks. Add one above.');
    });

    test('inline add via Enter key, with focus retention for rapid entry', async ({ page }) => {
        await createProject(page, { name: 'Many tasks' });
        // Add three tasks via Enter
        const nameInput = page.locator('#task-add-name');
        for (const n of ['First', 'Second', 'Third']) {
            await nameInput.fill(n);
            await nameInput.press('Enter');
        }
        // All three rendered
        const rows = page.locator('.task-row');
        await expect(rows).toHaveCount(3);
        // Focus retained on the name input
        await expect(nameInput).toBeFocused();
        // Stats line updated
        await expect(page.locator('.tasks-count')).toContainText('3 open · 3 total');
    });

    test('inline status change persists and re-sorts done to bottom', async ({ page }) => {
        await createProject(page, { name: 'Sort check' });
        await page.locator('#task-add-name').fill('Alpha');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('Beta');
        await page.locator('#task-add-name').press('Enter');

        const alphaRow = page.locator('.task-row', { hasText: 'Alpha' });
        await alphaRow.locator('.task-row-status').selectOption('done');

        // Alpha now at bottom (after Beta)
        const rowNames = page.locator('.task-row .task-row-name');
        await expect(rowNames.nth(0)).toHaveText('Beta');
        await expect(rowNames.nth(1)).toHaveText('Alpha');
        // Done row gets the dimmed class
        await expect(alphaRow).toHaveClass(/task-row-done/);
    });

    test('clicking a task name opens the slide-in panel; Esc closes it', async ({ page }) => {
        await createProject(page, { name: 'Panel test' });
        await page.locator('#task-add-name').fill('Inspect me');
        await page.locator('#task-add-name').press('Enter');

        await page.locator('.task-row .task-row-name', { hasText: 'Inspect me' }).click();
        const panel = page.locator('#task-panel');
        await expect(panel).toHaveClass(/task-panel-open/);
        await expect(panel.locator('#tp-name')).toHaveValue('Inspect me');

        await panel.locator('#tp-name').press('Escape');
        await expect(page.locator('#task-panel')).toHaveCount(0);
    });

    test('panel save updates the task row', async ({ page }) => {
        await createProject(page, { name: 'Edit task' });
        await page.locator('#task-add-name').fill('Old name');
        await page.locator('#task-add-name').press('Enter');

        await page.locator('.task-row-name', { hasText: 'Old name' }).click();
        await page.locator('#tp-name').fill('New name');
        await page.locator('#tp-priority').selectOption('high');
        await page.locator('#tp-save').click();

        await expect(page.locator('.task-row-name', { hasText: 'New name' })).toBeVisible();
        await expect(page.locator('.task-row-name', { hasText: 'Old name' })).toHaveCount(0);
    });

    test('backdrop click closes the panel without saving', async ({ page }) => {
        await createProject(page, { name: 'Backdrop test' });
        await page.locator('#task-add-name').fill('Should not change');
        await page.locator('#task-add-name').press('Enter');

        await page.locator('.task-row-name', { hasText: 'Should not change' }).click();
        await page.locator('#tp-name').fill('Modified');
        await page.locator('#task-panel-backdrop').click();

        // Panel gone, task name unchanged
        await expect(page.locator('#task-panel')).toHaveCount(0);
        await expect(page.locator('.task-row-name', { hasText: 'Should not change' })).toBeVisible();
    });

    test('overdue task gets red styling on the row', async ({ page }) => {
        await createProject(page, { name: 'Overdue test' });
        await page.locator('#task-add-name').fill('Late');
        await page.locator('#task-add-due').fill('2020-01-01');
        await page.locator('#task-add-name').press('Enter');
        const due = page.locator('.task-row', { hasText: 'Late' }).locator('.task-row-due');
        await expect(due).toHaveClass(/task-row-due-overdue/);
    });

    test('cascade delete: deleting a project also deletes its tasks', async ({ page }) => {
        await createProject(page, { name: 'Will be deleted' });
        await page.locator('#task-add-name').fill('Doomed task');
        await page.locator('#task-add-name').press('Enter');
        await expect(page.locator('.task-row')).toHaveCount(1);

        await page.locator('#projects-edit-btn').click();
        page.once('dialog', d => d.accept());
        await page.locator('#pf-delete').click();
        await expect(page.locator('.projects-empty-state')).toBeVisible();

        // No orphan tasks in storage
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('projects')));
        expect(stored.tasks).toEqual([]);
    });

    test('persists across reload (localStorage round-trip)', async ({ page }) => {
        await createProject(page, { name: 'Persistent' });
        await page.locator('#task-add-name').fill('Survives reload');
        await page.locator('#task-add-due').fill('2026-12-01');
        await page.locator('#task-add-name').press('Enter');
        await expect(page.locator('.task-row')).toHaveCount(1);

        await page.reload();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Persistent' }).click();
        const row = page.locator('.task-row', { hasText: 'Survives reload' });
        await expect(row).toBeVisible();
        await expect(row.locator('.task-row-due')).toContainText('01/12/2026');
    });

    test('project card shows task counts', async ({ page }) => {
        await createProject(page, { name: 'Count check' });
        // Use distinctive names — `hasText` does substring matching, and the
        // status select inside each row contains the option "Done" which
        // would otherwise spuriously match a name like "One".
        for (const n of ['Task A', 'Task B', 'Task C']) {
            await page.locator('#task-add-name').fill(n);
            await page.locator('#task-add-name').press('Enter');
        }
        await page.locator('.task-row', { hasText: 'Task A' }).locator('.task-row-status').selectOption('done');

        await backToList(page);
        // Overview cards render progress as "{percent}% · {done}/{total} done".
        // 1 done out of 3 = 33%.
        const progress = page.locator('.project-card', { hasText: 'Count check' })
            .locator('.project-card-progress-label');
        await expect(progress).toHaveText('33% · 1/3 done');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 2.2 — Subtasks', () => {

    async function openTaskPanel(page, taskName) {
        await page.locator('.task-row-name', { hasText: taskName }).click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
    }

    async function addSubtask(page, name) {
        await page.locator('#tp-add-subtask-btn').click();
        await page.locator('#tp-subtask-name').fill(name);
        await page.locator('#tp-subtask-name').press('Enter');
    }

    test('+ Subtask button is shown on parent panels but hidden on subtask panels', async ({ page }) => {
        await createProject(page, { name: 'Nest test' });
        await page.locator('#task-add-name').fill('Parent');
        await page.locator('#task-add-name').press('Enter');

        await openTaskPanel(page, 'Parent');
        await expect(page.locator('#tp-add-subtask-btn')).toBeVisible();
        await addSubtask(page, 'Child A');
        // Re-render leaves the section in place; reopen panel to be safe
        await page.locator('.task-panel-close').click();

        // Open the subtask's panel — no + Subtask button (one level deep)
        await openTaskPanel(page, 'Child A');
        await expect(page.locator('#tp-add-subtask-btn')).toHaveCount(0);
    });

    test('subtask renders indented under its parent', async ({ page }) => {
        await createProject(page, { name: 'Indent test' });
        await page.locator('#task-add-name').fill('Top');
        await page.locator('#task-add-name').press('Enter');

        await openTaskPanel(page, 'Top');
        await addSubtask(page, 'Under Top');
        await page.locator('.task-panel-close').click();

        const rows = page.locator('.task-row');
        await expect(rows).toHaveCount(2);
        // Subtask row is the second one and carries the subtask class
        await expect(rows.nth(1)).toHaveClass(/task-row-subtask/);
        await expect(rows.nth(1).locator('.task-row-name')).toHaveText('Under Top');
    });

    test('delete parent → promote: subtasks become top-level', async ({ page }) => {
        await createProject(page, { name: 'Promote test' });
        await page.locator('#task-add-name').fill('Boss');
        await page.locator('#task-add-name').press('Enter');

        await openTaskPanel(page, 'Boss');
        await addSubtask(page, 'Sub 1');
        await addSubtask(page, 'Sub 2');
        await addSubtask(page, 'Sub 3');
        await page.locator('.task-panel-close').click();

        // Sanity: 1 parent + 3 indented subtasks
        await expect(page.locator('.task-row')).toHaveCount(4);
        await expect(page.locator('.task-row-subtask')).toHaveCount(3);

        // Delete parent: confirm 1 = OK (proceed), confirm 2 = Cancel (promote)
        const dialogs = [];
        page.on('dialog', d => {
            dialogs.push(d.message());
            if (dialogs.length === 1) d.accept();
            else d.dismiss();
        });
        await page.locator('.task-row', { hasText: 'Boss' }).locator('.task-row-delete').click();

        // Wait for both confirms to fire
        await expect.poll(() => dialogs.length).toBe(2);
        expect(dialogs[0]).toContain('3 subtasks');
        expect(dialogs[1]).toContain('promote');

        // 3 rows remain, all top-level (no subtask class)
        await expect(page.locator('.task-row')).toHaveCount(3);
        await expect(page.locator('.task-row-subtask')).toHaveCount(0);
        // All 3 names persist
        for (const n of ['Sub 1', 'Sub 2', 'Sub 3']) {
            await expect(page.locator('.task-row-name', { hasText: n })).toBeVisible();
        }
    });

    test('delete parent → cascade: subtasks deleted too', async ({ page }) => {
        await createProject(page, { name: 'Cascade test' });
        await page.locator('#task-add-name').fill('Boss');
        await page.locator('#task-add-name').press('Enter');

        await openTaskPanel(page, 'Boss');
        await addSubtask(page, 'Sub A');
        await addSubtask(page, 'Sub B');
        await page.locator('.task-panel-close').click();
        await expect(page.locator('.task-row')).toHaveCount(3);

        // Both confirms = OK → cascade
        page.on('dialog', d => d.accept());
        await page.locator('.task-row', { hasText: 'Boss' }).locator('.task-row-delete').click();

        await expect(page.locator('.task-row')).toHaveCount(0);
        await expect(page.locator('.tasks-empty')).toBeVisible();
    });

    test('subtask state survives reload', async ({ page }) => {
        await createProject(page, { name: 'Persist subs' });
        await page.locator('#task-add-name').fill('Parent');
        await page.locator('#task-add-name').press('Enter');

        await openTaskPanel(page, 'Parent');
        await addSubtask(page, 'Child');
        await page.locator('.task-panel-close').click();

        await page.reload();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Persist subs' }).click();
        const rows = page.locator('.task-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(1)).toHaveClass(/task-row-subtask/);
        await expect(rows.nth(1).locator('.task-row-name')).toHaveText('Child');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 3.1 — Task dependencies', () => {

    async function openTaskPanel(page, taskName) {
        // Use a CSS selector + has-text to avoid matching the "Blocked by N"
        // badge inside the same button when it appears in later tests.
        await page.locator('.task-row', { hasText: taskName })
            .locator('.task-row-name').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
    }

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    test('panel exposes a Dependencies section with picker + empty list', async ({ page }) => {
        await createProject(page, { name: 'Dep panel' });
        await addTask(page, 'Solo');
        await openTaskPanel(page, 'Solo');
        await expect(page.locator('#tp-deps-section')).toBeVisible();
        await expect(page.locator('#tp-deps-picker')).toBeVisible();
        await expect(page.locator('.task-panel-deps-empty')).toContainText('No dependencies');
    });

    test('add a dependency: appears in list, badge appears on the dependent row', async ({ page }) => {
        await createProject(page, { name: 'Add dep' });
        await addTask(page, 'Prereq');
        await addTask(page, 'Dependent');

        await openTaskPanel(page, 'Dependent');
        // Picker should offer "Prereq" and not "Dependent"
        const optionLabels = await page.locator('#tp-deps-picker option').allTextContents();
        expect(optionLabels).toContain('Prereq');
        expect(optionLabels).not.toContain('Dependent');

        await page.locator('#tp-deps-picker').selectOption({ label: 'Prereq' });
        await page.locator('#tp-deps-add-btn').click();

        // Dep listed in the panel; empty-state gone
        await expect(page.locator('.task-panel-deps-empty')).toHaveCount(0);
        await expect(page.locator('.task-panel-dep-name', { hasText: 'Prereq' })).toBeVisible();

        // Close panel and check the row badge
        await page.locator('.task-panel-close').click();
        const dependentRow = page.locator('.task-row', { hasText: 'Dependent' });
        await expect(dependentRow.locator('.task-row-blocked')).toContainText('Blocked by 1');
        // Prereq row has no badge
        await expect(page.locator('.task-row', { hasText: 'Prereq' }).locator('.task-row-blocked')).toHaveCount(0);
    });

    test('marking prerequisite done clears the blocked badge', async ({ page }) => {
        await createProject(page, { name: 'Unblock' });
        await addTask(page, 'Prereq');
        await addTask(page, 'Dependent');

        await openTaskPanel(page, 'Dependent');
        await page.locator('#tp-deps-picker').selectOption({ label: 'Prereq' });
        await page.locator('#tp-deps-add-btn').click();
        await page.locator('.task-panel-close').click();

        // Confirm badge is there
        await expect(
            page.locator('.task-row', { hasText: 'Dependent' }).locator('.task-row-blocked')
        ).toBeVisible();

        // Mark Prereq done via the inline status select
        await page.locator('.task-row', { hasText: 'Prereq' })
            .locator('.task-row-status').selectOption('done');

        // Badge gone (Prereq is no longer unmet)
        await expect(
            page.locator('.task-row', { hasText: 'Dependent' }).locator('.task-row-blocked')
        ).toHaveCount(0);
    });

    test('removing a dependency clears the badge', async ({ page }) => {
        await createProject(page, { name: 'Remove dep' });
        await addTask(page, 'Prereq');
        await addTask(page, 'Dependent');

        await openTaskPanel(page, 'Dependent');
        await page.locator('#tp-deps-picker').selectOption({ label: 'Prereq' });
        await page.locator('#tp-deps-add-btn').click();
        await expect(page.locator('.task-panel-dep-name', { hasText: 'Prereq' })).toBeVisible();

        // Click the × on the dep row inside the panel
        await page.locator('.task-panel-dep', { hasText: 'Prereq' })
            .locator('.task-panel-dep-remove').click();

        await expect(page.locator('.task-panel-deps-empty')).toBeVisible();
        await page.locator('.task-panel-close').click();
        await expect(
            page.locator('.task-row', { hasText: 'Dependent' }).locator('.task-row-blocked')
        ).toHaveCount(0);
    });

    test('cycle attempt is rejected with a clear inline error', async ({ page }) => {
        await createProject(page, { name: 'Cycle check' });
        await addTask(page, 'A task');
        await addTask(page, 'B task');
        await addTask(page, 'C task');

        // A depends on B
        await openTaskPanel(page, 'A task');
        await page.locator('#tp-deps-picker').selectOption({ label: 'B task' });
        await page.locator('#tp-deps-add-btn').click();
        await page.locator('.task-panel-close').click();

        // B depends on C
        await openTaskPanel(page, 'B task');
        await page.locator('#tp-deps-picker').selectOption({ label: 'C task' });
        await page.locator('#tp-deps-add-btn').click();
        await page.locator('.task-panel-close').click();

        // Now attempt C -> A (would form A->B->C->A): rejected with error,
        // dep list stays empty.
        await openTaskPanel(page, 'C task');
        await page.locator('#tp-deps-picker').selectOption({ label: 'A task' });
        await page.locator('#tp-deps-add-btn').click();
        await expect(page.locator('#tp-deps-error')).toContainText(/cycle/i);
        await expect(page.locator('.task-panel-deps-empty')).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 3.2 — Task comments', () => {

    async function openTaskPanel(page, taskName) {
        await page.locator('.task-row', { hasText: taskName })
            .locator('.task-row-name').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
    }

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    test('panel exposes an Activity section with empty state', async ({ page }) => {
        await createProject(page, { name: 'Comments empty' });
        await addTask(page, 'Solo');
        await openTaskPanel(page, 'Solo');
        await expect(page.locator('#tp-activity-section')).toBeVisible();
        await expect(page.locator('.task-panel-comment-empty')).toContainText('No activity yet');
    });

    test('post a comment: appears in list with author + relative time', async ({ page }) => {
        await createProject(page, { name: 'Add comment' });
        await addTask(page, 'Discuss');
        await openTaskPanel(page, 'Discuss');

        await page.locator('#tp-comment-text').fill('Looks good');
        await page.locator('#tp-comment-submit').click();

        await expect(page.locator('.task-panel-comment-empty')).toHaveCount(0);
        const comment = page.locator('.task-panel-comment').first();
        await expect(comment.locator('.task-panel-comment-text')).toHaveText('Looks good');
        // No Firebase user → falls back to 'anonymous'
        await expect(comment.locator('.task-panel-comment-author')).toHaveText('anonymous');
        await expect(comment.locator('.task-panel-comment-time')).toContainText(/just now|sec ago/);
        // Composer cleared after re-render
        await expect(page.locator('#tp-comment-text')).toHaveValue('');
    });

    test('empty input is rejected with inline error', async ({ page }) => {
        await createProject(page, { name: 'Empty reject' });
        await addTask(page, 'A task');
        await openTaskPanel(page, 'A task');

        await page.locator('#tp-comment-text').fill('   ');
        await page.locator('#tp-comment-submit').click();

        await expect(page.locator('#tp-comment-error')).toContainText(/empty/i);
        await expect(page.locator('.task-panel-comment')).toHaveCount(0);
    });

    test('comments render in chronological order (oldest first)', async ({ page }) => {
        await createProject(page, { name: 'Order check' });
        await addTask(page, 'Thread');
        await openTaskPanel(page, 'Thread');

        for (const msg of ['First', 'Second', 'Third']) {
            await page.locator('#tp-comment-text').fill(msg);
            await page.locator('#tp-comment-submit').click();
            // Wait for the re-render to clear the composer before posting next
            await expect(page.locator('#tp-comment-text')).toHaveValue('');
        }
        const texts = await page.locator('.task-panel-comment-text').allTextContents();
        expect(texts).toEqual(['First', 'Second', 'Third']);
    });

    test('comments persist across reload', async ({ page }) => {
        await createProject(page, { name: 'Persist comments' });
        await addTask(page, 'Saved');
        await openTaskPanel(page, 'Saved');
        await page.locator('#tp-comment-text').fill('Survives reload');
        await page.locator('#tp-comment-submit').click();
        await expect(page.locator('.task-panel-comment-text')).toHaveText('Survives reload');

        await page.reload();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Persist comments' }).click();
        await page.locator('.task-row', { hasText: 'Saved' }).locator('.task-row-name').click();
        await expect(page.locator('.task-panel-comment-text')).toHaveText('Survives reload');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 3.3 — Activity / audit-trail feed', () => {

    async function openTaskPanel(page, taskName) {
        await page.locator('.task-row', { hasText: taskName })
            .locator('.task-row-name').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
    }

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    test('inline status change appends a status_changed event', async ({ page }) => {
        await createProject(page, { name: 'Status audit' });
        await addTask(page, 'Job');

        await page.locator('.task-row', { hasText: 'Job' })
            .locator('.task-row-status').selectOption('in-progress');

        await openTaskPanel(page, 'Job');
        const event = page.locator('.task-panel-event[data-kind="status_changed"]');
        await expect(event).toHaveCount(1);
        await expect(event).toContainText(/Not started/);
        await expect(event).toContainText(/In progress/);
    });

    test('panel save logs separate events for assignee and due-date changes', async ({ page }) => {
        await createProject(page, { name: 'Field audit' });
        await addTask(page, 'Plan');
        await openTaskPanel(page, 'Plan');

        await setPanelAssignee(page, 'brad');
        await page.locator('#tp-due').fill('2026-12-31');
        await page.locator('#tp-save').click();

        // Reopen the panel — closing on save destroys the panel DOM
        await openTaskPanel(page, 'Plan');
        await expect(page.locator('.task-panel-event[data-kind="assignee_changed"]')).toHaveCount(1);
        await expect(page.locator('.task-panel-event[data-kind="due_date_changed"]')).toHaveCount(1);
        await expect(page.locator('.task-panel-event[data-kind="due_date_changed"]'))
            .toContainText('31/12/2026');
    });

    test('adding and removing a dependency each log an event', async ({ page }) => {
        await createProject(page, { name: 'Dep audit' });
        await addTask(page, 'Pre');
        await addTask(page, 'Post');

        await openTaskPanel(page, 'Post');
        await page.locator('#tp-deps-picker').selectOption({ label: 'Pre' });
        await page.locator('#tp-deps-add-btn').click();
        await expect(page.locator('.task-panel-event[data-kind="dependency_added"]'))
            .toContainText('Pre');

        await page.locator('.task-panel-dep', { hasText: 'Pre' })
            .locator('.task-panel-dep-remove').click();
        await expect(page.locator('.task-panel-event[data-kind="dependency_removed"]'))
            .toContainText('Pre');
    });

    test('comment + events render interleaved in chronological order', async ({ page }) => {
        await createProject(page, { name: 'Interleave' });
        await addTask(page, 'Item');

        // 1. Status change via inline dropdown
        await page.locator('.task-row', { hasText: 'Item' })
            .locator('.task-row-status').selectOption('in-progress');
        // 2. Comment via panel
        await openTaskPanel(page, 'Item');
        await page.locator('#tp-comment-text').fill('Mid-flight comment');
        await page.locator('#tp-comment-submit').click();
        await expect(page.locator('.task-panel-comment-text')).toHaveText('Mid-flight comment');
        // 3. Due-date change via panel save
        await page.locator('#tp-due').fill('2026-08-15');
        await page.locator('#tp-save').click();

        await openTaskPanel(page, 'Item');
        // Three entries in the order: status event → comment → due-date event
        const entries = page.locator('#tp-activity-list > li');
        await expect(entries).toHaveCount(3);
        await expect(entries.nth(0)).toHaveClass(/task-panel-event/);
        await expect(entries.nth(0)).toHaveAttribute('data-kind', 'status_changed');
        await expect(entries.nth(1)).toHaveClass(/task-panel-comment/);
        await expect(entries.nth(2)).toHaveClass(/task-panel-event/);
        await expect(entries.nth(2)).toHaveAttribute('data-kind', 'due_date_changed');
    });

    test('untracked field changes (name, priority) do not log events', async ({ page }) => {
        await createProject(page, { name: 'No noise' });
        await addTask(page, 'Original');
        await openTaskPanel(page, 'Original');

        await page.locator('#tp-name').fill('Renamed');
        await page.locator('#tp-priority').selectOption('high');
        await page.locator('#tp-save').click();

        await openTaskPanel(page, 'Renamed');
        await expect(page.locator('.task-panel-event')).toHaveCount(0);
        // Activity feed shows the empty-state since no events or comments yet
        await expect(page.locator('.task-panel-comment-empty')).toContainText('No activity yet');
    });

    test('events persist across reload', async ({ page }) => {
        await createProject(page, { name: 'Persist events' });
        await addTask(page, 'Long-lived');
        await page.locator('.task-row', { hasText: 'Long-lived' })
            .locator('.task-row-status').selectOption('done');

        await page.reload();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Persist events' }).click();
        await page.locator('.task-row', { hasText: 'Long-lived' }).locator('.task-row-name').click();
        await expect(page.locator('.task-panel-event[data-kind="status_changed"]')).toHaveCount(1);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 3.4 — File attachments', () => {

    async function openTaskPanel(page, taskName) {
        await page.locator('.task-row', { hasText: taskName })
            .locator('.task-row-name').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
    }

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    test('section shows the empty state and ≤500 KB hint', async ({ page }) => {
        await createProject(page, { name: 'Att empty' });
        await addTask(page, 'Solo');
        await openTaskPanel(page, 'Solo');
        await expect(page.locator('#tp-attachments-section')).toBeVisible();
        await expect(page.locator('.task-panel-attachment-empty')).toContainText('No attachments');
        await expect(page.locator('.task-panel-attachments-hint')).toContainText('500 KB');
    });

    test('inline file ≤500 KB attaches with download link + audit event', async ({ page }) => {
        await createProject(page, { name: 'Att file' });
        await addTask(page, 'Doc job');
        await openTaskPanel(page, 'Doc job');

        await page.locator('#tp-attachments-file-input').setInputFiles({
            name: 'notes.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('hello attachment'),
        });

        const item = page.locator('.task-panel-attachment-file', { hasText: 'notes.txt' });
        await expect(item).toBeVisible();
        const link = item.locator('.task-panel-attachment-name');
        await expect(link).toHaveAttribute('download', 'notes.txt');
        await expect(link).toHaveAttribute('href', /^data:/);

        // Audit event logged in activity feed
        await expect(
            page.locator('.task-panel-event[data-kind="attachment_added"]')
        ).toContainText('notes.txt');
    });

    test('files larger than 500 KB are rejected with size message', async ({ page }) => {
        await createProject(page, { name: 'Att big' });
        await addTask(page, 'Big upload');
        await openTaskPanel(page, 'Big upload');

        // 600 KB of zeros → exceeds the 500 KB cap
        await page.locator('#tp-attachments-file-input').setInputFiles({
            name: 'big.bin',
            mimeType: 'application/octet-stream',
            buffer: Buffer.alloc(600 * 1024, 0),
        });

        await expect(page.locator('#tp-attachments-error')).toContainText(/too large|500 KB/i);
        // No chip created
        await expect(page.locator('.task-panel-attachment')).toHaveCount(0);
        // No audit event either
        await expect(page.locator('.task-panel-event[data-kind="attachment_added"]')).toHaveCount(0);
    });

    test('URL ref attaches with target=_blank link', async ({ page }) => {
        await createProject(page, { name: 'Att url' });
        await addTask(page, 'Link job');
        await openTaskPanel(page, 'Link job');

        await page.locator('details.task-panel-attachments-url').click();
        await page.locator('#tp-attachments-url-name').fill('Spec doc');
        await page.locator('#tp-attachments-url-url').fill('https://example.com/spec');
        await page.locator('#tp-attachments-url-add').click();

        const item = page.locator('.task-panel-attachment-url', { hasText: 'Spec doc' });
        await expect(item).toBeVisible();
        const link = item.locator('.task-panel-attachment-name');
        await expect(link).toHaveAttribute('href', 'https://example.com/spec');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(
            page.locator('.task-panel-event[data-kind="attachment_added"]')
        ).toContainText('Spec doc');
    });

    test('URL ref rejects bad URL with inline error', async ({ page }) => {
        await createProject(page, { name: 'Att bad url' });
        await addTask(page, 'Link job');
        await openTaskPanel(page, 'Link job');

        await page.locator('details.task-panel-attachments-url').click();
        await page.locator('#tp-attachments-url-name').fill('No scheme');
        await page.locator('#tp-attachments-url-url').fill('example.com');
        await page.locator('#tp-attachments-url-add').click();

        await expect(page.locator('#tp-attachments-error')).toContainText(/http/i);
        await expect(page.locator('.task-panel-attachment')).toHaveCount(0);
    });

    test('removing an attachment logs an attachment_removed event', async ({ page }) => {
        await createProject(page, { name: 'Att remove' });
        await addTask(page, 'Job');
        await openTaskPanel(page, 'Job');

        await page.locator('details.task-panel-attachments-url').click();
        await page.locator('#tp-attachments-url-name').fill('Doomed');
        await page.locator('#tp-attachments-url-url').fill('https://example.com/x');
        await page.locator('#tp-attachments-url-add').click();
        await expect(page.locator('.task-panel-attachment')).toHaveCount(1);

        page.once('dialog', d => d.accept());
        await page.locator('.task-panel-attachment-remove').click();

        await expect(page.locator('.task-panel-attachment')).toHaveCount(0);
        await expect(page.locator('.task-panel-attachment-empty')).toBeVisible();
        await expect(
            page.locator('.task-panel-event[data-kind="attachment_removed"]')
        ).toContainText('Doomed');
    });

    test('attachments persist across reload', async ({ page }) => {
        await createProject(page, { name: 'Persist atts' });
        await addTask(page, 'Saved');
        await openTaskPanel(page, 'Saved');

        await page.locator('#tp-attachments-file-input').setInputFiles({
            name: 'note.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('persists'),
        });
        await expect(page.locator('.task-panel-attachment', { hasText: 'note.txt' })).toBeVisible();

        await page.reload();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Persist atts' }).click();
        await page.locator('.task-row', { hasText: 'Saved' }).locator('.task-row-name').click();
        await expect(page.locator('.task-panel-attachment', { hasText: 'note.txt' })).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 3.5 — Milestones', () => {

    async function openTaskPanel(page, taskName) {
        await page.locator('.task-row', { hasText: taskName })
            .locator('.task-row-name').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
    }

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    test('panel toggle is unchecked by default; checking it adds a diamond glyph to the row', async ({ page }) => {
        await createProject(page, { name: 'Milestone toggle' });
        await addTask(page, 'Launch');
        await openTaskPanel(page, 'Launch');

        const toggle = page.locator('#tp-milestone');
        await expect(toggle).not.toBeChecked();

        await toggle.check();
        await page.locator('#tp-save').click();

        const row = page.locator('.task-row', { hasText: 'Launch' });
        await expect(row).toHaveClass(/task-row-milestone/);
        await expect(row.locator('.task-row-milestone-glyph')).toHaveText('◆');
    });

    test('un-checking the toggle removes the diamond on the next save', async ({ page }) => {
        await createProject(page, { name: 'Unset milestone' });
        await addTask(page, 'Phase');
        await openTaskPanel(page, 'Phase');
        await page.locator('#tp-milestone').check();
        await page.locator('#tp-save').click();
        await expect(
            page.locator('.task-row', { hasText: 'Phase' }).locator('.task-row-milestone-glyph')
        ).toBeVisible();

        await openTaskPanel(page, 'Phase');
        await page.locator('#tp-milestone').uncheck();
        await page.locator('#tp-save').click();

        await expect(
            page.locator('.task-row', { hasText: 'Phase' }).locator('.task-row-milestone-glyph')
        ).toHaveCount(0);
    });

    test('Milestones only filter hides non-milestone tasks', async ({ page }) => {
        await createProject(page, { name: 'Filter test' });
        await addTask(page, 'Regular A');
        await addTask(page, 'Regular B');
        await addTask(page, 'Big launch');

        // Mark only "Big launch" as milestone
        await openTaskPanel(page, 'Big launch');
        await page.locator('#tp-milestone').check();
        await page.locator('#tp-save').click();

        // All three rows visible by default
        await expect(page.locator('.task-row')).toHaveCount(3);

        // Apply filter — only the milestone row remains
        await page.locator('#tasks-filter-milestones').check();
        await expect(page.locator('.task-row')).toHaveCount(1);
        await expect(page.locator('.task-row-name')).toHaveText('◆Big launch');

        // Toggle back off — all visible again
        await page.locator('#tasks-filter-milestones').uncheck();
        await expect(page.locator('.task-row')).toHaveCount(3);
    });

    test('milestone state persists across reload', async ({ page }) => {
        await createProject(page, { name: 'Persist milestone' });
        await addTask(page, 'Anchor');
        await openTaskPanel(page, 'Anchor');
        await page.locator('#tp-milestone').check();
        await page.locator('#tp-save').click();
        await expect(
            page.locator('.task-row', { hasText: 'Anchor' }).locator('.task-row-milestone-glyph')
        ).toBeVisible();

        await page.reload();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Persist milestone' }).click();
        await expect(
            page.locator('.task-row', { hasText: 'Anchor' }).locator('.task-row-milestone-glyph')
        ).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 4.1 — List view (sort, group, filter)', () => {

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    async function setTaskFields(page, taskName, fields) {
        await page.locator('.task-row-name', { hasText: taskName }).click();
        if (fields.priority) await page.locator('#tp-priority').selectOption(fields.priority);
        if (fields.assignee !== undefined) {
            await setPanelAssignee(page, fields.assignee || '');
        }
        if (fields.status) await page.locator('#tp-status').selectOption(fields.status);
        await page.locator('#tp-save').click();
    }

    async function rowNames(page) {
        return page.locator('.task-row .task-row-name').allTextContents();
    }

    test('default sort is due-date asc; toolbar selectors reflect defaults', async ({ page }) => {
        await createProject(page, { name: 'Sort defaults' });
        await expect(page.locator('#tasks-sort-by')).toHaveValue('dueDate');
        await expect(page.locator('#tasks-sort-dir')).toHaveText('↑');
        await expect(page.locator('#tasks-group-by')).toHaveValue('none');
        await expect(page.locator('#tasks-filter-assignee')).toHaveValue('');
        await expect(page.locator('#tasks-filter-status')).toHaveValue('');
    });

    test('sort by name asc puts tasks alphabetical; flipping direction reverses', async ({ page }) => {
        await createProject(page, { name: 'Name sort' });
        for (const n of ['Charlie', 'Alpha', 'Bravo']) await addTask(page, n);
        await page.locator('#tasks-sort-by').selectOption('name');
        await expect(page.locator('.task-row .task-row-name')).toHaveText(['Alpha', 'Bravo', 'Charlie']);
        await page.locator('#tasks-sort-dir').click();
        await expect(page.locator('#tasks-sort-dir')).toHaveText('↓');
        await expect(page.locator('.task-row .task-row-name')).toHaveText(['Charlie', 'Bravo', 'Alpha']);
    });

    test('sort by priority orders high → normal → low among open tasks', async ({ page }) => {
        await createProject(page, { name: 'Priority sort' });
        for (const n of ['Lo', 'Hi', 'No']) await addTask(page, n);
        await setTaskFields(page, 'Lo', { priority: 'low' });
        await setTaskFields(page, 'Hi', { priority: 'high' });
        // 'No' stays at default normal
        await page.locator('#tasks-sort-by').selectOption('priority');
        await expect(page.locator('.task-row .task-row-name')).toHaveText(['Hi', 'No', 'Lo']);
    });

    test('done tasks always pin to bottom regardless of sort field', async ({ page }) => {
        await createProject(page, { name: 'Done pinning' });
        for (const n of ['Aaa', 'Bbb', 'Ccc']) await addTask(page, n);
        // Mark Aaa done — it should drop to bottom even though name-sort would put it first
        await page.locator('.task-row', { hasText: 'Aaa' })
            .locator('.task-row-status').selectOption('done');
        await page.locator('#tasks-sort-by').selectOption('name');
        const names = await rowNames(page);
        expect(names[names.length - 1]).toBe('Aaa');
    });

    test('group by status renders section headers in canonical order', async ({ page }) => {
        await createProject(page, { name: 'Group by status' });
        for (const n of ['Plan it', 'Doing now', 'Backlog']) await addTask(page, n);
        await setTaskFields(page, 'Doing now', { status: 'in-progress' });
        await setTaskFields(page, 'Plan it', { status: 'review' });

        await page.locator('#tasks-group-by').selectOption('status');
        const headers = page.locator('.tasks-group-header');
        await expect(headers).toHaveCount(3);
        // Canonical order in TASK_STATUSES: not-started → in-progress → review → done → blocked
        await expect(headers.nth(0)).toContainText('Not started');
        await expect(headers.nth(1)).toContainText('In progress');
        await expect(headers.nth(2)).toContainText('Review');
    });

    test('group by assignee orders brad → diana → unassigned, with bucket counts', async ({ page }) => {
        await createProject(page, { name: 'Group by assignee' });
        for (const n of ['Diana task', 'Brad task', 'Loose task']) await addTask(page, n);
        await setTaskFields(page, 'Brad task', { assignee: 'brad' });
        await setTaskFields(page, 'Diana task', { assignee: 'diana' });

        await page.locator('#tasks-group-by').selectOption('assignee');
        const headers = page.locator('.tasks-group-header');
        await expect(headers.nth(0)).toContainText('Brad · 1');
        await expect(headers.nth(1)).toContainText('Diana · 1');
        await expect(headers.nth(2)).toContainText('Unassigned · 1');
    });

    test('filtering by assignee narrows the visible rows', async ({ page }) => {
        await createProject(page, { name: 'Filter assignee' });
        for (const n of ['Brad only', 'Diana only', 'Loose']) await addTask(page, n);
        await setTaskFields(page, 'Brad only', { assignee: 'brad' });
        await setTaskFields(page, 'Diana only', { assignee: 'diana' });

        await page.locator('#tasks-filter-assignee').selectOption('brad');
        await expect(page.locator('.task-row .task-row-name')).toHaveText(['Brad only']);
    });

    test('filtering by status narrows the visible rows', async ({ page }) => {
        await createProject(page, { name: 'Filter status' });
        for (const n of ['Open A', 'Open B', 'Reviewed']) await addTask(page, n);
        await setTaskFields(page, 'Reviewed', { status: 'review' });

        await page.locator('#tasks-filter-status').selectOption('review');
        await expect(page.locator('.task-row .task-row-name')).toHaveText(['Reviewed']);
    });

    test('filters compose with AND semantics (assignee + status + milestonesOnly)', async ({ page }) => {
        await createProject(page, { name: 'Compose filters' });
        for (const n of ['target', 'wrongAssignee', 'wrongStatus', 'notMilestone']) {
            await addTask(page, n);
        }
        await setTaskFields(page, 'target', { assignee: 'brad', status: 'in-progress' });
        await setTaskFields(page, 'wrongAssignee', { assignee: 'diana', status: 'in-progress' });
        await setTaskFields(page, 'wrongStatus', { assignee: 'brad', status: 'review' });
        await setTaskFields(page, 'notMilestone', { assignee: 'brad', status: 'in-progress' });

        // Only 'target' is also a milestone
        await page.locator('.task-row-name', { hasText: 'target' }).click();
        await page.locator('#tp-milestone').check();
        await page.locator('#tp-save').click();

        await page.locator('#tasks-filter-assignee').selectOption('brad');
        await page.locator('#tasks-filter-status').selectOption('in-progress');
        await page.locator('#tasks-filter-milestones').check();

        await expect(page.locator('.task-row .task-row-name')).toHaveText(['◆target']);
    });

    test('empty state distinguishes "no tasks at all" from "no tasks match filters"', async ({ page }) => {
        await createProject(page, { name: 'Empty states' });
        await expect(page.locator('.tasks-empty')).toContainText('No tasks. Add one above.');

        for (const n of ['Brad work']) await addTask(page, n);
        await setTaskFields(page, 'Brad work', { assignee: 'brad' });

        await page.locator('#tasks-filter-assignee').selectOption('diana');
        await expect(page.locator('.tasks-empty')).toContainText('No tasks match these filters.');
        await expect(page.locator('.task-row')).toHaveCount(0);
    });

    test('sort/group/filter reset when switching to a different project', async ({ page }) => {
        // First project — set non-default toolbar state
        await createProject(page, { name: 'Project A' });
        await addTask(page, 'A1');
        await page.locator('#tasks-sort-by').selectOption('name');
        await page.locator('#tasks-group-by').selectOption('status');
        await page.locator('#tasks-filter-status').selectOption('done');

        // Navigate to a different project
        await backToList(page);
        await page.locator('#projects-new-btn').click();
        await page.locator('#pf-name').fill('Project B');
        await page.locator('#pf-status').selectOption('active');
        await page.locator('#pf-save').click();

        // Toolbar reset to defaults
        await expect(page.locator('#tasks-sort-by')).toHaveValue('dueDate');
        await expect(page.locator('#tasks-group-by')).toHaveValue('none');
        await expect(page.locator('#tasks-filter-status')).toHaveValue('');
        await expect(page.locator('#tasks-filter-assignee')).toHaveValue('');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 4.2 — Timeline view (Gantt)', () => {

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    async function setTaskDates(page, taskName, { startDate, dueDate, isMilestone } = {}) {
        await page.locator('.task-row-name', { hasText: taskName }).click();
        if (startDate !== undefined) await page.locator('#tp-start').fill(startDate || '');
        if (dueDate !== undefined) await page.locator('#tp-due').fill(dueDate || '');
        if (isMilestone) await page.locator('#tp-milestone').check();
        await page.locator('#tp-save').click();
    }

    test('view tabs render with List active by default', async ({ page }) => {
        await createProject(page, { name: 'Tabs default' });
        const tabs = page.locator('.view-tabs .view-tab');
        await expect(tabs).toHaveCount(3);
        await expect(tabs.nth(0)).toHaveText('List');
        await expect(tabs.nth(1)).toHaveText('Timeline');
        await expect(tabs.nth(2)).toHaveText('Calendar');
        await expect(tabs.nth(0)).toHaveClass(/active/);
        await expect(page.locator('#tasks-list')).toBeVisible();
    });

    test('switching to Timeline reveals the month-axis scaffolding', async ({ page }) => {
        await createProject(page, { name: 'Switch to timeline' });
        await addTask(page, 'Pour foundation');
        // 06-15..06-20: pad → 06-01..07-04 → snap → June + July
        await setTaskDates(page, 'Pour foundation', { startDate: '2026-06-15', dueDate: '2026-06-20' });

        await page.locator('.view-tab[data-view="timeline"]').click();
        await expect(page.locator('.timeline-axis')).toBeVisible();
        await expect(page.locator('.timeline-axis-month')).toHaveCount(2); // June + July
    });

    test('a task with both dates renders as a positioned bar', async ({ page }) => {
        await createProject(page, { name: 'Bar render' });
        await addTask(page, 'Frame walls');
        await setTaskDates(page, 'Frame walls', { startDate: '2026-06-10', dueDate: '2026-06-16' });

        await page.locator('.view-tab[data-view="timeline"]').click();
        const bar = page.locator('.timeline-bar', { hasText: 'Frame walls' });
        await expect(bar).toHaveCount(1);
        const style = await bar.getAttribute('style');
        expect(style).toMatch(/left:\s*[0-9.]+%/);
        expect(style).toMatch(/width:\s*[0-9.]+%/);
    });

    test('a task without any dates does NOT render as a bar (and surfaces in unscheduled count)', async ({ page }) => {
        await createProject(page, { name: 'Unscheduled' });
        await addTask(page, 'Pick paint colour');     // no dates
        await addTask(page, 'Inspector visit');
        await setTaskDates(page, 'Inspector visit', { startDate: '2026-06-10', dueDate: '2026-06-10' });

        await page.locator('.view-tab[data-view="timeline"]').click();
        await expect(page.locator('.timeline-bar', { hasText: 'Pick paint colour' })).toHaveCount(0);
        await expect(page.locator('.timeline-bar', { hasText: 'Inspector visit' })).toHaveCount(1);
        await expect(page.locator('.timeline-unscheduled')).toContainText('1 unscheduled');
    });

    test('clicking a bar opens the task detail panel', async ({ page }) => {
        await createProject(page, { name: 'Bar click' });
        await addTask(page, 'Order tiles');
        await setTaskDates(page, 'Order tiles', { startDate: '2026-06-10', dueDate: '2026-06-15' });

        await page.locator('.view-tab[data-view="timeline"]').click();
        await page.locator('.timeline-bar', { hasText: 'Order tiles' }).click();
        await expect(page.locator('#task-panel')).toBeVisible();
        await expect(page.locator('#tp-name')).toHaveValue('Order tiles');
    });

    test('empty timeline shows a helpful message when no task has dates', async ({ page }) => {
        await createProject(page, { name: 'Empty timeline' });
        await addTask(page, 'No dates');

        await page.locator('.view-tab[data-view="timeline"]').click();
        await expect(page.locator('.timeline-empty')).toContainText(/no scheduled tasks/i);
    });

    test('switching list → timeline → list preserves toolbar state', async ({ page }) => {
        await createProject(page, { name: 'Tab toggle preserves' });
        await addTask(page, 'X');
        await page.locator('#tasks-sort-by').selectOption('name');
        await page.locator('#tasks-group-by').selectOption('status');

        await page.locator('.view-tab[data-view="timeline"]').click();
        await page.locator('.view-tab[data-view="list"]').click();

        await expect(page.locator('#tasks-sort-by')).toHaveValue('name');
        await expect(page.locator('#tasks-group-by')).toHaveValue('status');
    });

    test('milestone tasks render as diamonds, not as bars', async ({ page }) => {
        await createProject(page, { name: 'Milestone diamond' });
        await addTask(page, 'Permit approval');
        await setTaskDates(page, 'Permit approval', { dueDate: '2026-06-15', isMilestone: true });

        await page.locator('.view-tab[data-view="timeline"]').click();
        // Milestone shows as a .timeline-milestone marker, NOT as a regular .timeline-bar
        await expect(page.locator('.timeline-milestone', { hasText: 'Permit approval' })).toHaveCount(1);
        await expect(page.locator('.timeline-bar', { hasText: 'Permit approval' })).toHaveCount(0);
    });

    test('clicking a milestone diamond opens the task detail panel', async ({ page }) => {
        await createProject(page, { name: 'Milestone click' });
        await addTask(page, 'Final inspection');
        await setTaskDates(page, 'Final inspection', { dueDate: '2026-06-15', isMilestone: true });

        await page.locator('.view-tab[data-view="timeline"]').click();
        await page.locator('.timeline-milestone', { hasText: 'Final inspection' }).click();
        await expect(page.locator('#task-panel')).toBeVisible();
        await expect(page.locator('#tp-name')).toHaveValue('Final inspection');
    });

    // Dependency-arrow rendering on the Timeline view was removed (PB.4 shelved
    // — straight diagonals cut through intervening rows; Manhattan routing was
    // out of scope). The dep relationship still lives on the data model and on
    // the per-task panel; only the Timeline-overlay visualisation is gone.
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 4.3 — Calendar view (month grid)', () => {

    async function addTask(page, name) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
    }

    async function setTaskDates(page, taskName, { startDate, dueDate } = {}) {
        await page.locator('.task-row-name', { hasText: taskName }).click();
        if (startDate !== undefined) await page.locator('#tp-start').fill(startDate || '');
        if (dueDate !== undefined) await page.locator('#tp-due').fill(dueDate || '');
        await page.locator('#tp-save').click();
    }

    async function gotoCalendar(page, { year, month } = {}) {
        await page.locator('.view-tab[data-view="calendar"]').click();
        if (year != null && month != null) {
            // Jump to a known month via direct state set so navigation tests are deterministic.
            await page.evaluate(({ y, m }) => {
                // The projects module is the only thing rendering on this tab; reach in via render hook.
                window.__testJumpCal = { y, m };
            }, { y: year, m: month });
        }
    }

    test('view tabs include a Calendar option', async ({ page }) => {
        await createProject(page, { name: 'Cal tab' });
        const tabs = page.locator('.view-tabs .view-tab');
        await expect(tabs).toHaveCount(3);
        await expect(tabs.nth(2)).toHaveText('Calendar');
    });

    test('calendar grid renders 7 columns × 5–6 rows with weekday header', async ({ page }) => {
        await createProject(page, { name: 'Cal grid' });
        await page.locator('.view-tab[data-view="calendar"]').click();
        await expect(page.locator('.cal-weekday-header')).toBeVisible();
        // 7 weekday header cells, Mon..Sun
        await expect(page.locator('.cal-weekday')).toHaveCount(7);
        const cellCount = await page.locator('.cal-day').count();
        expect([35, 42]).toContain(cellCount);
    });

    test('a task with a dueDate renders as a pill on the matching day cell', async ({ page }) => {
        await createProject(page, { name: 'Cal pills' });
        await addTask(page, 'Pay rent');
        // Pick today's month in the test environment so we know it's visible
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dueDate = `${yyyy}-${mm}-15`;
        await setTaskDates(page, 'Pay rent', { dueDate });

        await page.locator('.view-tab[data-view="calendar"]').click();
        const cell = page.locator(`.cal-day[data-date="${dueDate}"]`);
        await expect(cell.locator('.cal-pill', { hasText: 'Pay rent' })).toHaveCount(1);
        await expect(cell.locator('.cal-pill.cal-pill-start')).toHaveCount(0);
    });

    test('a multi-day task renders a due pill on dueDate AND a dimmer start pill on startDate', async ({ page }) => {
        await createProject(page, { name: 'Cal multi-day' });
        await addTask(page, 'Reno week');
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const startDate = `${yyyy}-${mm}-10`;
        const dueDate = `${yyyy}-${mm}-15`;
        await setTaskDates(page, 'Reno week', { startDate, dueDate });

        await page.locator('.view-tab[data-view="calendar"]').click();
        const startCell = page.locator(`.cal-day[data-date="${startDate}"]`);
        const dueCell = page.locator(`.cal-day[data-date="${dueDate}"]`);
        // Start pill: dimmer variant
        await expect(startCell.locator('.cal-pill.cal-pill-start', { hasText: 'Reno week' })).toHaveCount(1);
        // Due pill: full
        await expect(dueCell.locator('.cal-pill.cal-pill-due', { hasText: 'Reno week' })).toHaveCount(1);
    });

    test('clicking a task pill opens the task detail panel', async ({ page }) => {
        await createProject(page, { name: 'Cal pill click' });
        await addTask(page, 'Inspector');
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dueDate = `${yyyy}-${mm}-12`;
        await setTaskDates(page, 'Inspector', { dueDate });

        await page.locator('.view-tab[data-view="calendar"]').click();
        await page.locator('.cal-pill', { hasText: 'Inspector' }).click();
        await expect(page.locator('#task-panel')).toBeVisible();
        await expect(page.locator('#tp-name')).toHaveValue('Inspector');
    });

    test('clicking a day cell opens a popover listing that day\'s tasks', async ({ page }) => {
        await createProject(page, { name: 'Cal day click' });
        await addTask(page, 'A');
        await addTask(page, 'B');
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const date = `${yyyy}-${mm}-08`;
        await setTaskDates(page, 'A', { dueDate: date });
        await setTaskDates(page, 'B', { dueDate: date });

        await page.locator('.view-tab[data-view="calendar"]').click();
        // Click the day-number, not the cell center (the cell may be filled with pills,
        // and pill clicks deliberately stopPropagation to open the panel directly).
        await page.locator(`.cal-day[data-date="${date}"] .cal-day-number`).click();
        const popover = page.locator('.cal-day-popover');
        await expect(popover).toBeVisible();
        await expect(popover.locator('.cal-day-popover-task')).toHaveCount(2);
        await expect(popover.locator('.cal-day-popover-task').nth(0)).toContainText(/A|B/);
    });

    test('prev / next month navigation updates the header', async ({ page }) => {
        await createProject(page, { name: 'Cal nav' });
        await page.locator('.view-tab[data-view="calendar"]').click();
        const header = page.locator('.cal-month-header-label');
        const start = (await header.textContent()).trim();

        await page.locator('.cal-nav-next').click();
        const next = (await header.textContent()).trim();
        expect(next).not.toBe(start);

        await page.locator('.cal-nav-prev').click();
        const back = (await header.textContent()).trim();
        expect(back).toBe(start);
    });

    test('today is highlighted with a distinguishing class', async ({ page }) => {
        await createProject(page, { name: 'Cal today' });
        await page.locator('.view-tab[data-view="calendar"]').click();
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayIso = `${yyyy}-${mm}-${dd}`;
        await expect(page.locator(`.cal-day[data-date="${todayIso}"]`)).toHaveClass(/is-today/);
    });

    test('tasks across 3 months are all visible by navigating between months', async ({ page }) => {
        await createProject(page, { name: 'Cal 3 months' });
        await addTask(page, 'M1 task');
        await addTask(page, 'M2 task');
        await addTask(page, 'M3 task');
        const today = new Date();
        const isoFor = (year, month, day) =>
            `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // Use day=15 — well past the calendar's max trailing-pad (6 days),
        // so a task in month N never shows up while viewing month N-1.
        const m1 = { y: today.getFullYear(), m: today.getMonth() + 1 };
        const advance = (ym) => (ym.m === 12 ? { y: ym.y + 1, m: 1 } : { y: ym.y, m: ym.m + 1 });
        const m2 = advance(m1);
        const m3 = advance(m2);
        await setTaskDates(page, 'M1 task', { dueDate: isoFor(m1.y, m1.m, 15) });
        await setTaskDates(page, 'M2 task', { dueDate: isoFor(m2.y, m2.m, 15) });
        await setTaskDates(page, 'M3 task', { dueDate: isoFor(m3.y, m3.m, 15) });

        await page.locator('.view-tab[data-view="calendar"]').click();
        await expect(page.locator('.cal-pill', { hasText: 'M1 task' })).toHaveCount(1);
        await expect(page.locator('.cal-pill', { hasText: 'M2 task' })).toHaveCount(0);

        await page.locator('.cal-nav-next').click();
        await expect(page.locator('.cal-pill', { hasText: 'M2 task' })).toHaveCount(1);
        await expect(page.locator('.cal-pill', { hasText: 'M3 task' })).toHaveCount(0);

        await page.locator('.cal-nav-next').click();
        await expect(page.locator('.cal-pill', { hasText: 'M3 task' })).toHaveCount(1);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 5.1 — Overview tab (cross-project cards)', () => {

    async function addTaskWithStatus(page, name, status) {
        await page.locator('#task-add-name').fill(name);
        await page.locator('#task-add-name').press('Enter');
        if (status && status !== 'not-started') {
            await page.locator('.task-row', { hasText: name }).locator('.task-row-status').selectOption(status);
        }
    }

    test('card shows progress bar with percent + done/total', async ({ page }) => {
        await createProject(page, { name: 'Progress check' });
        await addTaskWithStatus(page, 'TA', 'done');
        await addTaskWithStatus(page, 'TB', 'in-progress');
        await addTaskWithStatus(page, 'TC', 'in-progress');
        await addTaskWithStatus(page, 'TD', 'done');
        await backToList(page);

        const card = page.locator('.project-card', { hasText: 'Progress check' });
        await expect(card.locator('.project-card-progress-label')).toHaveText('50% · 2/4 done');
        await expect(card.locator('.project-card-progress-fill')).toHaveAttribute('style', /width:\s*50%/);
    });

    test('card with no tasks shows the empty-state hint', async ({ page }) => {
        await createProject(page, { name: 'Untouched' });
        await backToList(page);
        const card = page.locator('.project-card', { hasText: 'Untouched' });
        await expect(card.locator('.project-card-progress-empty')).toContainText('No tasks yet');
    });

    test('overdue badge counts tasks with dueDate < today and not done', async ({ page }) => {
        await createProject(page, { name: 'Overdue check' });
        // Past due, not done → overdue
        await page.locator('#task-add-name').fill('Late');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row-name', { hasText: 'Late' }).click();
        await page.locator('#tp-due').fill('2024-01-01');
        await page.locator('#tp-save').click();
        // Past due, but done → ignored
        await page.locator('#task-add-name').fill('LateDone');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row-name', { hasText: 'LateDone' }).click();
        await page.locator('#tp-due').fill('2024-01-01');
        await page.locator('#tp-status').selectOption('done');
        await page.locator('#tp-save').click();

        await backToList(page);
        const card = page.locator('.project-card', { hasText: 'Overdue check' });
        await expect(card.locator('.project-card-overdue')).toHaveText('⚠ 1 overdue');
    });

    test('next milestone date renders in the flags row', async ({ page }) => {
        await createProject(page, { name: 'MS check' });
        await page.locator('#task-add-name').fill('Launch');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row-name', { hasText: 'Launch' }).click();
        await page.locator('#tp-due').fill('2099-06-15');
        await page.locator('#tp-milestone').check();
        await page.locator('#tp-save').click();

        await backToList(page);
        const card = page.locator('.project-card', { hasText: 'MS check' });
        await expect(card.locator('.project-card-milestone')).toContainText('15/06/2099');
    });

    test('sort selector reorders cards by % complete', async ({ page }) => {
        // Project A: 0 done / 2 = 0%
        await createProject(page, { name: 'Aproj' });
        await addTaskWithStatus(page, 'a1', 'in-progress');
        await addTaskWithStatus(page, 'a2', 'in-progress');
        await backToList(page);
        // Project B: 2 done / 2 = 100%
        await createProject(page, { name: 'Bproj' });
        await addTaskWithStatus(page, 'b1', 'done');
        await addTaskWithStatus(page, 'b2', 'done');
        await backToList(page);

        await page.locator('#overview-sort-by').selectOption('percent');

        // First card is Bproj (100%), second is Aproj (0%)
        const cardNames = page.locator('.project-card .project-card-name');
        await expect(cardNames.nth(0)).toHaveText('Bproj');
        await expect(cardNames.nth(1)).toHaveText('Aproj');
    });

    test('clicking an Overview card navigates to project detail', async ({ page }) => {
        await createProject(page, { name: 'Click target' });
        await backToList(page);
        await page.locator('.project-card', { hasText: 'Click target' }).click();
        await expect(page.locator('.tasks-add-row')).toBeVisible();
        await expect(page.locator('.projects-title')).toHaveText('Click target');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 5.2 — My Tasks (per-user summary tab)', () => {

    /**
     * Helper: open a task panel from the detail view, set its assignee + due
     * date, and save. Used to seed the My Tasks view from a fresh project.
     */
    async function setTaskAssigneeDue(page, taskName, { assignee, dueDate, status } = {}) {
        await page.locator('.task-row-name', { hasText: taskName }).click();
        if (assignee !== undefined) {
            await setPanelAssignee(page, assignee || '');
        }
        if (dueDate !== undefined) {
            await page.locator('#tp-due').fill(dueDate || '');
        }
        if (status !== undefined) {
            await page.locator('#tp-status').selectOption(status);
        }
        await page.locator('#tp-save').click();
    }

    async function gotoMyTasks(page) {
        await page.locator('.projects-subtab[data-subtab="mytasks"]').click();
        await expect(page.locator('.mytasks-section')).toHaveCount(4);
    }

    test('My Tasks sub-tab is reachable from the projects list', async ({ page }) => {
        // No projects yet — sub-tab should still be present
        await expect(page.locator('.projects-subtab[data-subtab="overview"]')).toBeVisible();
        await expect(page.locator('.projects-subtab[data-subtab="mytasks"]')).toBeVisible();
        await page.locator('.projects-subtab[data-subtab="mytasks"]').click();
        await expect(page.locator('.mytasks-section')).toHaveCount(4);
    });

    test('defaults to brad when no Firebase user is signed in', async ({ page }) => {
        await page.locator('.projects-subtab[data-subtab="mytasks"]').click();
        await expect(page.locator('#mytasks-user-select')).toHaveValue('brad');
    });

    test('user selector switches the visible task set', async ({ page }) => {
        await createProject(page, { name: 'Cross-user' });
        // One task each for brad and diana, both due far in the future
        await page.locator('#task-add-name').fill('Brad-task');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Brad-task', { assignee: 'brad', dueDate: '2099-01-15' });
        await page.locator('#task-add-name').fill('Diana-task');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Diana-task', { assignee: 'diana', dueDate: '2099-01-15' });
        await backToList(page);

        await gotoMyTasks(page);
        // Brad sees only their task
        await expect(page.locator('.mytasks-task-row', { hasText: 'Brad-task' })).toHaveCount(1);
        await expect(page.locator('.mytasks-task-row', { hasText: 'Diana-task' })).toHaveCount(0);
        // Switch to Diana
        await page.locator('#mytasks-user-select').selectOption('diana');
        await expect(page.locator('.mytasks-task-row', { hasText: 'Diana-task' })).toHaveCount(1);
        await expect(page.locator('.mytasks-task-row', { hasText: 'Brad-task' })).toHaveCount(0);
    });

    test('sections bucket tasks by date relative to today', async ({ page }) => {
        await createProject(page, { name: 'Bucketing' });
        // Past-due → overdue
        await page.locator('#task-add-name').fill('Late');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Late', { assignee: 'brad', dueDate: '2024-01-01' });
        // Far-future → upcoming
        await page.locator('#task-add-name').fill('Future');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Future', { assignee: 'brad', dueDate: '2099-01-15' });
        // Done → completed
        await page.locator('#task-add-name').fill('Finished');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Finished', { assignee: 'brad', status: 'done' });
        await backToList(page);

        await gotoMyTasks(page);
        const overdue = page.locator('.mytasks-section[data-bucket="overdue"]');
        const upcoming = page.locator('.mytasks-section[data-bucket="upcoming"]');
        const completed = page.locator('.mytasks-section[data-bucket="completed"]');
        await expect(overdue.locator('.mytasks-task-row', { hasText: 'Late' })).toHaveCount(1);
        await expect(upcoming.locator('.mytasks-task-row', { hasText: 'Future' })).toHaveCount(1);
        await expect(completed.locator('.mytasks-task-row', { hasText: 'Finished' })).toHaveCount(1);
    });

    test('completed section is collapsed by default and can be toggled open', async ({ page }) => {
        await createProject(page, { name: 'Toggle' });
        await page.locator('#task-add-name').fill('Done-task');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Done-task', { assignee: 'brad', status: 'done' });
        await backToList(page);

        await gotoMyTasks(page);
        const completed = page.locator('.mytasks-section[data-bucket="completed"]');
        // Collapsed: completed task is not visible
        await expect(completed.locator('.mytasks-task-row', { hasText: 'Done-task' })).not.toBeVisible();
        // Toggle open
        await completed.locator('.mytasks-section-header').click();
        await expect(completed.locator('.mytasks-task-row', { hasText: 'Done-task' })).toBeVisible();
    });

    test('clicking a My Tasks row opens the task detail panel (cross-project nav)', async ({ page }) => {
        await createProject(page, { name: 'Source proj' });
        await page.locator('#task-add-name').fill('Click me');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Click me', { assignee: 'brad', dueDate: '2099-01-15' });
        await backToList(page);

        await gotoMyTasks(page);
        await page.locator('.mytasks-task-row', { hasText: 'Click me' }).click();
        // The shared task panel should open with the task name pre-filled
        await expect(page.locator('#task-panel')).toBeVisible();
        await expect(page.locator('#tp-name')).toHaveValue('Click me');
    });

    test('each row shows the project name so the user knows where the task lives', async ({ page }) => {
        await createProject(page, { name: 'Origin proj' });
        await page.locator('#task-add-name').fill('Wandering task');
        await page.locator('#task-add-name').press('Enter');
        await setTaskAssigneeDue(page, 'Wandering task', { assignee: 'brad', dueDate: '2099-01-15' });
        await backToList(page);

        await gotoMyTasks(page);
        const row = page.locator('.mytasks-task-row', { hasText: 'Wandering task' });
        await expect(row.locator('.mytasks-task-project')).toHaveText('Origin proj');
    });

    test('empty state when the selected user has no tasks anywhere', async ({ page }) => {
        await createProject(page, { name: 'No-assignee proj' });
        await page.locator('#task-add-name').fill('Unassigned');
        await page.locator('#task-add-name').press('Enter');
        await backToList(page);

        await gotoMyTasks(page);
        await expect(page.locator('.mytasks-empty')).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 5.3 — Dashboard tab', () => {

    async function gotoDashboard(page) {
        await page.locator('.projects-subtab[data-subtab="dashboard"]').click();
        await expect(page.locator('.dashboard-cards')).toBeVisible();
    }

    async function setTaskMeta(page, taskName, { dueDate, status, milestone } = {}) {
        await page.locator('.task-row-name', { hasText: taskName }).click();
        if (dueDate !== undefined) await page.locator('#tp-due').fill(dueDate || '');
        if (status !== undefined) await page.locator('#tp-status').selectOption(status);
        if (milestone === true) await page.locator('#tp-milestone').check();
        if (milestone === false) await page.locator('#tp-milestone').uncheck();
        await page.locator('#tp-save').click();
    }

    test('Dashboard sub-tab is reachable from the projects list', async ({ page }) => {
        await expect(page.locator('.projects-subtab[data-subtab="dashboard"]')).toBeVisible();
        await gotoDashboard(page);
        await expect(page.locator('.dashboard-cards')).toBeVisible();
        await expect(page.locator('.dashboard-card')).toHaveCount(6);
    });

    test('all six metric cards render with the expected labels', async ({ page }) => {
        await gotoDashboard(page);
        const labels = [
            'Active projects', 'Open tasks', 'Overdue',
            'Due this week', 'Completed (last 30d)', 'Upcoming milestones',
        ];
        for (const label of labels) {
            await expect(page.locator('.dashboard-card', { hasText: label })).toHaveCount(1);
        }
    });

    test('active-projects count reflects status-active projects only', async ({ page }) => {
        await createProject(page, { name: 'A', status: 'active' });
        await backToList(page);
        await createProject(page, { name: 'B', status: 'planning' });
        await backToList(page);
        await createProject(page, { name: 'C', status: 'active' });
        await backToList(page);

        await gotoDashboard(page);
        const activeCard = page.locator('.dashboard-card[data-metric="activeProjects"] .dashboard-card-value');
        await expect(activeCard).toHaveText('2');
    });

    test('open-tasks count includes every non-done task across all projects', async ({ page }) => {
        await createProject(page, { name: 'Proj1' });
        await page.locator('#task-add-name').fill('t1');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('t2');
        await page.locator('#task-add-name').press('Enter');
        await setTaskMeta(page, 't2', { status: 'done' });
        await backToList(page);

        await gotoDashboard(page);
        const openCard = page.locator('.dashboard-card[data-metric="openTasks"] .dashboard-card-value');
        await expect(openCard).toHaveText('1');
    });

    test('overdue card flags red and counts past-due open tasks', async ({ page }) => {
        await createProject(page, { name: 'Proj' });
        await page.locator('#task-add-name').fill('Late');
        await page.locator('#task-add-name').press('Enter');
        await setTaskMeta(page, 'Late', { dueDate: '2024-01-01' });
        await backToList(page);

        await gotoDashboard(page);
        const card = page.locator('.dashboard-card[data-metric="overdueTasks"]');
        await expect(card.locator('.dashboard-card-value')).toHaveText('1');
        await expect(card).toHaveClass(/dashboard-card-flag/);
    });

    test('overdue card has no flag class when count is zero', async ({ page }) => {
        await gotoDashboard(page);
        const card = page.locator('.dashboard-card[data-metric="overdueTasks"]');
        await expect(card).not.toHaveClass(/dashboard-card-flag/);
    });

    test('upcoming-milestones card counts non-done milestones in the next 14 days', async ({ page }) => {
        // Pick a date that is unambiguously in the next 14 days regardless of when
        // the test runs — far-future dates would not count as "upcoming". We
        // can't control "today", so seed a milestone with today's date via the
        // browser's clock and verify the count is at least 1 only when the
        // dueDate is within the window. Instead, assert the inverse: a milestone
        // dated 1 year out is NOT counted (out of window), and the count stays 0.
        await createProject(page, { name: 'Proj' });
        await page.locator('#task-add-name').fill('Far ms');
        await page.locator('#task-add-name').press('Enter');
        await setTaskMeta(page, 'Far ms', { dueDate: '2099-01-01', milestone: true });
        await backToList(page);

        await gotoDashboard(page);
        const card = page.locator('.dashboard-card[data-metric="upcomingMilestones"] .dashboard-card-value');
        await expect(card).toHaveText('0');
    });

    test('weekly bar chart renders 8 bars in chronological order with no errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        await gotoDashboard(page);
        await expect(page.locator('.dashboard-chart')).toBeVisible();
        await expect(page.locator('.dashboard-bar-group')).toHaveCount(8);
        // Filter out unrelated noise
        const real = errors.filter(e => !/firebase/i.test(e) && !/net::ERR_FAILED/i.test(e) && !/asynchronous response/i.test(e));
        expect(real).toEqual([]);
    });

    test('dashboard auto-refreshes when underlying data changes', async ({ page }) => {
        await gotoDashboard(page);
        const activeVal = page.locator('.dashboard-card[data-metric="activeProjects"] .dashboard-card-value');
        await expect(activeVal).toHaveText('0');

        // Switch to Overview tab to create a project, then back to Dashboard.
        // Each render reads the current state — covers the "auto-refresh"
        // acceptance criterion since any state change re-renders the module.
        await page.locator('.projects-subtab[data-subtab="overview"]').click();
        await createProject(page, { name: 'New active', status: 'active' });
        await backToList(page);

        await gotoDashboard(page);
        await expect(activeVal).toHaveText('1');
    });

    test('switching to a different project resets list sub-tab to overview', async ({ page }) => {
        // After clicking into a project, going back returns the user to the
        // list with their previously-selected sub-tab preserved (per goList).
        await createProject(page, { name: 'Persist' });
        await backToList(page);
        await gotoDashboard(page);
        await page.locator('.projects-subtab[data-subtab="overview"]').click();
        await page.locator('.project-card', { hasText: 'Persist' }).click();
        await backToList(page);
        // Overview was the active sub-tab when leaving — should still be active
        await expect(page.locator('.projects-subtab[data-subtab="overview"]')).toHaveClass(/active/);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 5.4 — Files summary by project', () => {

    async function gotoFiles(page) {
        await page.locator('.projects-subtab[data-subtab="files"]').click();
        await expect(page.locator('.files-groups')).toBeVisible();
    }

    async function addUrlAttachmentToTask(page, taskName, { name, url }) {
        await page.locator('.task-row', { hasText: taskName }).locator('.task-row-name').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
        await page.locator('details.task-panel-attachments-url').click();
        await page.locator('#tp-attachments-url-name').fill(name);
        await page.locator('#tp-attachments-url-url').fill(url);
        await page.locator('#tp-attachments-url-add').click();
        await expect(page.locator('.task-panel-attachment', { hasText: name })).toBeVisible();
        await page.locator('.task-panel-close').click();
    }

    test('Files sub-tab is reachable from the projects list', async ({ page }) => {
        await expect(page.locator('.projects-subtab[data-subtab="files"]')).toBeVisible();
        await gotoFiles(page);
        await expect(page.locator('.files-total')).toContainText(/No files yet/i);
        await expect(page.locator('.files-empty')).toBeVisible();
    });

    test('renders attachments grouped by project', async ({ page }) => {
        await createProject(page, { name: 'Alpha' });
        await page.locator('#task-add-name').fill('A1');
        await page.locator('#task-add-name').press('Enter');
        await addUrlAttachmentToTask(page, 'A1', { name: 'spec', url: 'https://example.com/spec' });
        await backToList(page);

        await createProject(page, { name: 'Beta' });
        await page.locator('#task-add-name').fill('B1');
        await page.locator('#task-add-name').press('Enter');
        await addUrlAttachmentToTask(page, 'B1', { name: 'design', url: 'https://example.com/design' });
        await backToList(page);

        await gotoFiles(page);
        await expect(page.locator('.files-group')).toHaveCount(2);
        // Sorted alphabetically: Alpha first, Beta second
        const groups = page.locator('.files-group-name');
        await expect(groups.nth(0)).toHaveText('Alpha');
        await expect(groups.nth(1)).toHaveText('Beta');
        await expect(page.locator('.files-row[data-task-id]')).toHaveCount(2);
        await expect(page.locator('.files-cell-name', { hasText: 'spec' })).toBeVisible();
        await expect(page.locator('.files-cell-name', { hasText: 'design' })).toBeVisible();
    });

    test('projects with no attachments are not listed', async ({ page }) => {
        await createProject(page, { name: 'WithFile' });
        await page.locator('#task-add-name').fill('T');
        await page.locator('#task-add-name').press('Enter');
        await addUrlAttachmentToTask(page, 'T', { name: 'doc', url: 'https://example.com/doc' });
        await backToList(page);

        await createProject(page, { name: 'Empty' });
        await page.locator('#task-add-name').fill('Bare');
        await page.locator('#task-add-name').press('Enter');
        await backToList(page);

        await gotoFiles(page);
        await expect(page.locator('.files-group')).toHaveCount(1);
        await expect(page.locator('.files-group-name')).toHaveText('WithFile');
    });

    test('inline files render with type "File" and a non-empty size', async ({ page }) => {
        await createProject(page, { name: 'Files proj' });
        await page.locator('#task-add-name').fill('Doc job');
        await page.locator('#task-add-name').press('Enter');

        await page.locator('.task-row', { hasText: 'Doc job' }).locator('.task-row-name').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
        await page.locator('#tp-attachments-file-input').setInputFiles({
            name: 'notes.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('hello attachment'),
        });
        await expect(page.locator('.task-panel-attachment-file', { hasText: 'notes.txt' })).toBeVisible();
        await page.locator('.task-panel-close').click();
        await backToList(page);

        await gotoFiles(page);
        const row = page.locator('.files-row[data-task-id]');
        await expect(row).toHaveCount(1);
        await expect(row.locator('.files-cell-kind')).toHaveText('File');
        await expect(row.locator('.files-cell-size')).not.toHaveText('—');
        await expect(row.locator('.files-cell-name')).toHaveText('notes.txt');
    });

    test('URL refs render with type "URL" and size dash', async ({ page }) => {
        await createProject(page, { name: 'URL proj' });
        await page.locator('#task-add-name').fill('Link');
        await page.locator('#task-add-name').press('Enter');
        await addUrlAttachmentToTask(page, 'Link', { name: 'spec doc', url: 'https://example.com/x' });
        await backToList(page);

        await gotoFiles(page);
        const row = page.locator('.files-row[data-task-id]');
        await expect(row.locator('.files-cell-kind')).toHaveText('URL');
        await expect(row.locator('.files-cell-size')).toHaveText('—');
    });

    test('clicking a row jumps to the source task by opening its panel', async ({ page }) => {
        await createProject(page, { name: 'Nav proj' });
        await page.locator('#task-add-name').fill('Target');
        await page.locator('#task-add-name').press('Enter');
        await addUrlAttachmentToTask(page, 'Target', { name: 'open me', url: 'https://example.com/open' });
        await backToList(page);

        await gotoFiles(page);
        await page.locator('.files-row[data-task-id]').click();
        await expect(page.locator('#task-panel')).toHaveClass(/task-panel-open/);
        await expect(page.locator('#tp-name')).toHaveValue('Target');
    });

    test('attachments from multiple tasks within one project share a group', async ({ page }) => {
        await createProject(page, { name: 'Multi' });
        await page.locator('#task-add-name').fill('T1');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('T2');
        await page.locator('#task-add-name').press('Enter');
        await addUrlAttachmentToTask(page, 'T1', { name: 'one', url: 'https://example.com/1' });
        await addUrlAttachmentToTask(page, 'T2', { name: 'two', url: 'https://example.com/2' });
        await backToList(page);

        await gotoFiles(page);
        await expect(page.locator('.files-group')).toHaveCount(1);
        await expect(page.locator('.files-row[data-task-id]')).toHaveCount(2);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('PB.7 — Project status derivation', () => {

    test('status auto-derives through planning → active → completed as tasks land', async ({ page }) => {
        await createProject(page, { name: 'Derive', status: 'planning' });
        // Add two tasks so we can demonstrate the partial = active transition.
        await page.locator('#task-add-name').fill('Step 1');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('Step 2');
        await page.locator('#task-add-name').press('Enter');

        const detailBadge = page.locator('.projects-toolbar > .status-badge');
        // Two tasks, 0 done → planning
        await expect(detailBadge).toHaveText('Planning');

        // 1/2 done → active
        await page.locator('.task-row', { hasText: 'Step 1' }).locator('.task-row-status').selectOption('done');
        await expect(detailBadge).toHaveText('Active');

        // 2/2 done → completed
        await page.locator('.task-row', { hasText: 'Step 2' }).locator('.task-row-status').selectOption('done');
        await expect(detailBadge).toHaveText('Completed');

        // Card on the Overview also reflects the derived value
        await backToList(page);
        await expect(page.locator('.project-card', { hasText: 'Derive' }).locator('.status-badge')).toHaveText('Completed');
    });

    test('toggling override ON freezes status and survives reload', async ({ page }) => {
        await createProject(page, { name: 'Frozen', status: 'planning' });
        await page.locator('#task-add-name').fill('Done task');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row').first().locator('.task-row-status').selectOption('done');
        const detailBadge = page.locator('.projects-toolbar > .status-badge');
        await expect(detailBadge).toHaveText('Completed');

        // Edit form: with override off, the dropdown shows the effective value so
        // toggling override on freezes that value into stored.
        await page.locator('#projects-edit-btn').click();
        await expect(page.locator('#pf-status')).toHaveValue('completed');

        // Toggle override on, then pick on-hold.
        await page.locator('#pf-status-override').check();
        await page.locator('#pf-status').selectOption('on-hold');
        await page.locator('#pf-save').click();
        await expect(detailBadge).toHaveText('On hold');

        // Reload: sanitiseProject preserves the explicit override=true on the loaded record.
        await page.reload();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Frozen' }).click();
        await expect(detailBadge).toHaveText('On hold');
    });

    test('toggling override OFF re-derives immediately', async ({ page }) => {
        await createProject(page, { name: 'Rederive', status: 'planning' });
        await page.locator('#task-add-name').fill('Done task');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row').first().locator('.task-row-status').selectOption('done');
        const detailBadge = page.locator('.projects-toolbar > .status-badge');

        // Bring it manually to on-hold via the override path.
        await page.locator('#projects-edit-btn').click();
        await page.locator('#pf-status-override').check();
        await page.locator('#pf-status').selectOption('on-hold');
        await page.locator('#pf-save').click();
        await expect(detailBadge).toHaveText('On hold');

        // Untick override: dropdown snaps to the about-to-derive value, save, status flips.
        await page.locator('#projects-edit-btn').click();
        await page.locator('#pf-status-override').uncheck();
        await expect(page.locator('#pf-status')).toHaveValue('completed');
        await page.locator('#pf-save').click();
        await expect(detailBadge).toHaveText('Completed');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('PB.8 — Dashboard drill-down', () => {

    async function gotoDashboard(page) {
        await page.locator('.projects-subtab[data-subtab="dashboard"]').click();
        await expect(page.locator('.dashboard-cards')).toBeVisible();
    }

    test('activeProjects card is not clickable (Resolved Decision 1)', async ({ page }) => {
        await createProject(page, { name: 'P', status: 'active' });
        await backToList(page);
        await gotoDashboard(page);
        const card = page.locator('.dashboard-card[data-metric="activeProjects"]');
        await expect(card).not.toHaveAttribute('role', 'button');
        await expect(card).not.toHaveClass(/dashboard-card-clickable/);
    });

    test('clicking openTasks opens an inline list whose row count matches the card', async ({ page }) => {
        await createProject(page, { name: 'Drill' });
        await page.locator('#task-add-name').fill('t1');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('t2');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('done one');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'done one' }).locator('.task-row-status').selectOption('done');
        await backToList(page);

        await gotoDashboard(page);
        const card = page.locator('.dashboard-card[data-metric="openTasks"]');
        await expect(card.locator('.dashboard-card-value')).toHaveText('2');

        await card.click();
        await expect(page.locator('.dashboard-drill')).toBeVisible();
        await expect(page.locator('.dashboard-drill-title')).toHaveText('Open tasks');
        await expect(page.locator('.dashboard-drill-row')).toHaveCount(2);
        // Card receives the active state
        await expect(card).toHaveClass(/dashboard-card-active/);
    });

    test('keyboard activation opens the drill via Enter on a focused card', async ({ page }) => {
        await createProject(page, { name: 'Drill kb' });
        await page.locator('#task-add-name').fill('t1');
        await page.locator('#task-add-name').press('Enter');
        await backToList(page);
        await gotoDashboard(page);

        await page.locator('.dashboard-card[data-metric="openTasks"]').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.dashboard-drill')).toBeVisible();
    });

    test('clicking the active card again closes the drill', async ({ page }) => {
        await createProject(page, { name: 'Toggle' });
        await page.locator('#task-add-name').fill('t1');
        await page.locator('#task-add-name').press('Enter');
        await backToList(page);
        await gotoDashboard(page);

        const card = page.locator('.dashboard-card[data-metric="openTasks"]');
        await card.click();
        await expect(page.locator('.dashboard-drill')).toBeVisible();
        await card.click();
        await expect(page.locator('.dashboard-drill')).toHaveCount(0);
        // Chart re-appears
        await expect(page.locator('.dashboard-chart-card')).toBeVisible();
    });

    test('drill row click opens the task panel', async ({ page }) => {
        await createProject(page, { name: 'Open panel' });
        await page.locator('#task-add-name').fill('Findme');
        await page.locator('#task-add-name').press('Enter');
        await backToList(page);
        await gotoDashboard(page);

        await page.locator('.dashboard-card[data-metric="openTasks"]').click();
        await page.locator('.dashboard-drill-row').click();
        await expect(page.locator('#task-panel')).toBeVisible();
        await expect(page.locator('#tp-name')).toHaveValue('Findme');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('PB.9 — Joint assignee', () => {

    test('joint task renders Joint chip and matches each individual assignee filter', async ({ page }) => {
        await createProject(page, { name: 'Joint test' });
        await page.locator('#task-add-name').fill('Joint task');
        await page.locator('#task-add-name').press('Enter');

        // Open the panel and check both Brad + Diana via the multi-select.
        await page.locator('.task-row', { hasText: 'Joint task' }).locator('.task-row-name').click();
        await page.locator('#tp-assignees input[type="checkbox"][value="brad"]').check();
        await page.locator('#tp-assignees input[type="checkbox"][value="diana"]').check();
        await page.locator('#tp-save').click();

        // Row collapses the canonical pair into a single "Joint" chip.
        const row = page.locator('.task-row', { hasText: 'Joint task' });
        await expect(row.locator('.chip')).toHaveCount(1);
        await expect(row.locator('.chip .chip-label')).toHaveText('Joint');

        // Filter by Brad — joint task is present (intersection semantics).
        await page.locator('#tasks-filter-assignee').selectOption('brad');
        await expect(page.locator('.task-row', { hasText: 'Joint task' })).toBeVisible();

        // Filter by Diana — same task still present.
        await page.locator('#tasks-filter-assignee').selectOption('diana');
        await expect(page.locator('.task-row', { hasText: 'Joint task' })).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 6.2 — Notification bell + preferences', () => {

    // Seed localStorage with a project, a task, and a couple of brad-bound
    // notifications. Without Firebase the implicit current user is 'brad'
    // (defaultMyTasksUser('') → 'brad'), so notifications addressed to brad
    // are what the bell will render in the test environment.
    async function seedProjectsWithNotifications(page, { unread = 2, read = 0 } = {}) {
        const notifs = [];
        for (let i = 0; i < read; i++) {
            notifs.push({
                id: `nr${i}`, kind: 'task_assigned', to: 'brad', by: 'diana',
                taskId: 'task1', projectId: 'proj1',
                title: `Old assignment ${i}`, summary: 'Already-read summary',
                at: '2026-05-01T00:00:00.000Z', read: true,
            });
        }
        for (let i = 0; i < unread; i++) {
            notifs.push({
                id: `nu${i}`, kind: 'task_assigned', to: 'brad', by: 'diana',
                taskId: 'task1', projectId: 'proj1',
                title: `New assignment ${i}`, summary: 'Diana assigned this to you.',
                at: '2026-05-10T00:00:00.000Z', read: false,
            });
        }
        await page.evaluate((seed) => {
            localStorage.setItem('projects', JSON.stringify({
                items: [{
                    id: 'proj1', name: 'Seeded Project', status: 'active', statusOverride: false,
                    startDate: '2026-05-01', endDate: '2026-06-01',
                    participants: ['brad', 'diana'], description: '',
                    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
                    archivedAt: null,
                }],
                tasks: [{
                    id: 'task1', projectId: 'proj1', name: 'Seeded Task',
                    description: '', status: 'not-started', assignees: ['brad'],
                    startDate: null, dueDate: '2026-06-01', priority: 'normal',
                    parentTaskId: null, dependsOn: [], comments: [], events: [], attachments: [],
                    isMilestone: false,
                    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
                    completedAt: null,
                }],
                notifications: { brad: seed },
                prefs: {},
            }));
        }, notifs);
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
    }

    test('bell renders with an unread badge counting brad-bound entries', async ({ page }) => {
        await seedProjectsWithNotifications(page, { unread: 3, read: 1 });
        const bell = page.locator('#notif-bell-btn');
        await expect(bell).toBeVisible();
        await expect(bell.locator('.notif-bell-badge')).toHaveText('3');
    });

    test('bell renders without a badge when there are zero unread', async ({ page }) => {
        await seedProjectsWithNotifications(page, { unread: 0, read: 2 });
        const bell = page.locator('#notif-bell-btn');
        await expect(bell).toBeVisible();
        await expect(bell.locator('.notif-bell-badge')).toHaveCount(0);
    });

    test('bell shows the empty state in the dropdown when no notifications exist', async ({ page }) => {
        // Default load — no notifications, no prefs.
        await page.locator('#notif-bell-btn').click();
        await expect(page.locator('#notif-bell-dropdown')).toBeVisible();
        await expect(page.locator('.notif-empty')).toContainText('No notifications yet.');
    });

    test('bell is visible across all modules, not just Projects', async ({ page }) => {
        // Switch back to Finance and confirm the bell is still in the header.
        // Task 8.2 retired pm-legacy so there are only two top-level modules now.
        await page.locator('.top-nav-btn[data-module="finance"]').click();
        await expect(page.locator('#notif-bell-btn')).toBeVisible();
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await expect(page.locator('#notif-bell-btn')).toBeVisible();
    });

    test('dropdown lists notifications newest-first and marks unread visually', async ({ page }) => {
        await seedProjectsWithNotifications(page, { unread: 2, read: 1 });
        await page.locator('#notif-bell-btn').click();
        const items = page.locator('.notif-item');
        await expect(items).toHaveCount(3);
        // Newest unread items render first; the dropdown order is descending by at.
        await expect(items.first()).toHaveClass(/notif-item-unread/);
    });

    test('clicking an unread item marks it read, decrements the badge, and opens the task panel', async ({ page }) => {
        await seedProjectsWithNotifications(page, { unread: 2, read: 0 });
        const bell = page.locator('#notif-bell-btn');
        await expect(bell.locator('.notif-bell-badge')).toHaveText('2');

        await bell.click();
        await page.locator('.notif-item').first().click();

        // Dropdown closes, panel opens on Seeded Task
        await expect(page.locator('#notif-bell-dropdown')).toHaveCount(0);
        await expect(page.locator('#task-panel')).toBeVisible();
        await expect(page.locator('#tp-name')).toHaveValue('Seeded Task');
        // Badge decrements
        await expect(bell.locator('.notif-bell-badge')).toHaveText('1');
    });

    test('bell click from Finance routes back to Projects when a notification has a project', async ({ page }) => {
        await seedProjectsWithNotifications(page, { unread: 1, read: 0 });
        await page.locator('.top-nav-btn[data-module="finance"]').click();
        await expect(page.locator('#module-finance')).toBeVisible();

        await page.locator('#notif-bell-btn').click();
        await page.locator('.notif-item').first().click();

        await expect(page.locator('.top-nav-btn[data-module="projects"]')).toHaveClass(/active/);
        await expect(page.locator('#task-panel')).toBeVisible();
    });

    test('"Mark all read" clears the badge and disables itself', async ({ page }) => {
        await seedProjectsWithNotifications(page, { unread: 3, read: 0 });
        const bell = page.locator('#notif-bell-btn');
        await expect(bell.locator('.notif-bell-badge')).toHaveText('3');

        await bell.click();
        await page.locator('#notif-mark-all').click();
        await expect(bell.locator('.notif-bell-badge')).toHaveCount(0);
        await expect(page.locator('#notif-mark-all')).toBeDisabled();
    });

    test('preferences modal opens, saves, and persists prefs across reload', async ({ page }) => {
        await page.locator('#notif-bell-btn').click();
        await page.locator('#notif-prefs-btn').click();
        await expect(page.locator('#notif-prefs-modal')).toBeVisible();

        // Flip master off and toggle one event kind.
        await page.locator('#np-master').uncheck();
        await page.locator('input[data-kind="task_assigned"]').uncheck();
        await page.locator('input[name="np-mode"][value="digest"]').check();
        await page.locator('#np-save').click();

        // Modal closes
        await expect(page.locator('#notif-prefs-modal')).toHaveCount(0);

        // Persisted to localStorage (brad is the implicit current user)
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('projects')));
        expect(stored.prefs.brad.master).toBe(false);
        expect(stored.prefs.brad.mode).toBe('digest');
        expect(stored.prefs.brad.kinds.task_assigned).toBe(false);
        // Untouched kinds remain on
        expect(stored.prefs.brad.kinds.task_overdue).toBe(true);

        // Reload — re-open modal and confirm fields are restored
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('#notif-bell-btn').click();
        await page.locator('#notif-prefs-btn').click();
        await expect(page.locator('#np-master')).not.toBeChecked();
        await expect(page.locator('input[name="np-mode"][value="digest"]')).toBeChecked();
        await expect(page.locator('input[data-kind="task_assigned"]')).not.toBeChecked();
    });

    test('prefs filter — kind toggle off prevents future bell entries of that kind', async ({ page }) => {
        // Seed prefs with task_assigned disabled, then run a real assignment flow.
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {},
                prefs: { brad: { master: true, mode: 'instant', kinds: { task_assigned: false } } },
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();

        // Create a project and add a task assigned to Brad. Without the
        // prefs filter, this would emit a brad-bound task_assigned notification.
        await createProject(page, { name: 'Prefs filter' });
        await page.locator('#task-add-name').fill('Should-be-silent');
        await page.locator('#task-add-name').press('Enter');
        // Open panel, assign to brad (toggling the assignee array fires assignee_changed)
        await page.locator('.task-row', { hasText: 'Should-be-silent' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'brad');
        await page.locator('#tp-save').click();

        // Bell still shows no badge — the kind was disabled in prefs.
        await expect(page.locator('#notif-bell-btn .notif-bell-badge')).toHaveCount(0);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 6.3 — Email queue (browser-side enqueue)', () => {

    async function readEmailQueue(page) {
        return await page.evaluate(() => {
            const raw = localStorage.getItem('email_queue');
            if (!raw) return {};
            try { return JSON.parse(raw); } catch { return {}; }
        });
    }

    test('assigning a task to Diana writes one instant email-queue entry for her', async ({ page }) => {
        await createProject(page, { name: 'Email round-trip' });
        await page.locator('#task-add-name').fill('Pour foundation');
        await page.locator('#task-add-name').press('Enter');

        // Reassign to Diana via the panel checkbox group — fires assignee_changed,
        // which the trigger mapper turns into a task_assigned for diana.
        await page.locator('.task-row', { hasText: 'Pour foundation' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'diana');
        await page.locator('#tp-save').click();

        const queue = await readEmailQueue(page);
        const entries = Object.values(queue);
        expect(entries.length).toBe(1);
        expect(entries[0].to).toBe('dianaleshcheva@gmail.com');
        expect(entries[0].kind).toBe('task_assigned');
        expect(entries[0].subject).toBe('[Family Planner] Task assigned: Pour foundation');
        expect(entries[0].sent).toBe(false);
        expect(entries[0].attempts).toBe(0);
        expect(entries[0].sourceUrl).toContain('#/projects/');
    });

    test('digest-mode users defer to Phase 6.4 — no instant queue entry written for them', async ({ page }) => {
        // Seed Diana with mode='digest' before the assignment.
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {},
                prefs: {
                    diana: { master: true, mode: 'digest', kinds: {} },
                },
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();

        await createProject(page, { name: 'Digest-mode' });
        await page.locator('#task-add-name').fill('Quiet task');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'Quiet task' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'diana');
        await page.locator('#tp-save').click();

        const queue = await readEmailQueue(page);
        expect(Object.keys(queue).length).toBe(0);
    });

    test('master-off recipient receives neither bell entry nor email', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {},
                prefs: {
                    diana: { master: false, mode: 'instant', kinds: {} },
                },
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();

        await createProject(page, { name: 'Silent' });
        await page.locator('#task-add-name').fill('Should not email');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'Should not email' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'diana');
        await page.locator('#tp-save').click();

        expect(Object.keys(await readEmailQueue(page)).length).toBe(0);
        // Bell stays empty for the actor (brad) too.
        await expect(page.locator('#notif-bell-btn .notif-bell-badge')).toHaveCount(0);
    });

    test('external assignees with no email on file are skipped silently', async ({ page }) => {
        await createProject(page, { name: 'External' });
        // Add an external participant to the project so the panel can assign to it.
        await page.locator('#projects-edit-btn').click();
        await page.locator('.participant-add-input').fill('consultant');
        await page.locator('.participants-adder .participant-add-btn').click();
        await page.locator('#pf-save').click();

        await page.locator('#task-add-name').fill('Site visit');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'Site visit' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'consultant');
        await page.locator('#tp-save').click();

        // Notification fires (external is a valid recipient id) but email is skipped
        // because participantEmail('consultant') === null.
        expect(Object.keys(await readEmailQueue(page)).length).toBe(0);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 6.4 — Daily digest accumulation', () => {

    async function readEmailQueue(page) {
        return await page.evaluate(() => {
            const raw = localStorage.getItem('email_queue');
            if (!raw) return {};
            try { return JSON.parse(raw); } catch { return {}; }
        });
    }
    async function readDigestPending(page) {
        return await page.evaluate(() => {
            const raw = localStorage.getItem('projects');
            if (!raw) return {};
            try { return JSON.parse(raw).digest_pending || {}; } catch { return {}; }
        });
    }
    async function seedPrefs(page, prefs) {
        await page.evaluate((p) => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: p, digest_pending: {},
            }));
        }, prefs);
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
    }

    test('digest-mode recipient accumulates into digest_pending instead of email_queue', async ({ page }) => {
        await seedPrefs(page, {
            diana: { master: true, mode: 'digest', kinds: {} },
        });

        await createProject(page, { name: 'Digest accumulation' });
        await page.locator('#task-add-name').fill('First task');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'First task' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'diana');
        await page.locator('#tp-save').click();

        // No instant email
        expect(Object.keys(await readEmailQueue(page)).length).toBe(0);
        // One digest entry for Diana
        const digest = await readDigestPending(page);
        expect(Array.isArray(digest.diana)).toBe(true);
        expect(digest.diana.length).toBe(1);
        expect(digest.diana[0].kind).toBe('task_assigned');
        expect(digest.diana[0].title).toBe('Task assigned: First task');
    });

    test('digest entries accumulate across multiple events for the same user', async ({ page }) => {
        await seedPrefs(page, {
            diana: { master: true, mode: 'digest', kinds: {} },
        });

        await createProject(page, { name: 'Repeated digest' });
        for (const name of ['Task A', 'Task B', 'Task C']) {
            await page.locator('#task-add-name').fill(name);
            await page.locator('#task-add-name').press('Enter');
            await page.locator('.task-row', { hasText: name }).locator('.task-row-name').click();
            await setPanelAssignee(page, 'diana');
            await page.locator('#tp-save').click();
            // The slide-in panel closes after save; loop to next task.
        }

        const digest = await readDigestPending(page);
        expect(digest.diana.length).toBe(3);
        // Email queue stays empty
        expect(Object.keys(await readEmailQueue(page)).length).toBe(0);
    });

    test('flipping prefs from digest to instant routes the next event to email_queue', async ({ page }) => {
        await seedPrefs(page, {
            diana: { master: true, mode: 'digest', kinds: {} },
        });

        await createProject(page, { name: 'Switcher' });
        await page.locator('#task-add-name').fill('Digest task');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'Digest task' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'diana');
        await page.locator('#tp-save').click();

        // First event lands in the digest bucket
        let digest = await readDigestPending(page);
        expect(digest.diana.length).toBe(1);
        expect(Object.keys(await readEmailQueue(page)).length).toBe(0);

        // Flip Diana to instant by editing the stored prefs directly + reload.
        // (The prefs modal is keyed to the current user — Brad in localStorage
        // mode — so we mutate Diana's record via storage like the seed helper.)
        await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            data.prefs.diana = { master: true, mode: 'instant', kinds: {} };
            localStorage.setItem('projects', JSON.stringify(data));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Switcher' }).click();

        await page.locator('#task-add-name').fill('Instant task');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'Instant task' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'diana');
        await page.locator('#tp-save').click();

        // Second event lands in the email queue, not the digest bucket
        digest = await readDigestPending(page);
        expect(digest.diana.length).toBe(1, 'digest entries from before the switch are preserved');
        const queue = await readEmailQueue(page);
        const entries = Object.values(queue);
        expect(entries.length).toBe(1);
        expect(entries[0].subject).toContain('Instant task');
    });

    test('digest entries persist across reload (localStorage round-trip)', async ({ page }) => {
        await seedPrefs(page, {
            diana: { master: true, mode: 'digest', kinds: {} },
        });

        await createProject(page, { name: 'Persist digest' });
        await page.locator('#task-add-name').fill('Something');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'Something' }).locator('.task-row-name').click();
        await setPanelAssignee(page, 'diana');
        await page.locator('#tp-save').click();

        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        const digest = await readDigestPending(page);
        expect(digest.diana.length).toBe(1);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 6.5 — Email-queue admin panel', () => {

    // Helper: seed N queue entries in mixed states and reload.
    async function seedQueue(page, entries) {
        await page.evaluate((seed) => {
            const map = {};
            for (const e of seed) map[e.id] = e;
            localStorage.setItem('email_queue', JSON.stringify(map));
        }, entries);
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
    }

    function mkEntry(id, opts = {}) {
        return {
            id,
            to: opts.to || 'metalbee66@gmail.com',
            subject: opts.subject || '[Family Planner] Task assigned: ' + id,
            bodyHtml: '<p>...</p>',
            kind: opts.kind || 'task_assigned',
            notificationId: null,
            taskId: null,
            projectId: null,
            sourceUrl: '',
            queuedAt: opts.queuedAt || '2026-05-21T10:00:00.000Z',
            sent: !!opts.sent,
            sentAt: opts.sentAt || null,
            attempts: opts.attempts == null ? 0 : opts.attempts,
            failed: !!opts.failed,
        };
    }

    test('admin sub-tab is visible to brad (the default admin)', async ({ page }) => {
        // No Firebase = no signed-in user, defaultMyTasksUser('') === 'brad' = admin.
        await expect(page.locator('.projects-subtab[data-subtab="admin"]')).toBeVisible();
    });

    test('admin tab renders empty state when the queue is empty', async ({ page }) => {
        await page.locator('.projects-subtab[data-subtab="admin"]').click();
        // Two admin panels now share .admin-title (Project seeds + Email queue);
        // target the heading by its accessible name.
        await expect(page.getByRole('heading', { name: 'Email queue' })).toBeVisible();
        await expect(page.locator('.admin-empty-row')).toContainText('Email queue is empty.');
    });

    test('admin tab renders entries newest-first with status pills', async ({ page }) => {
        await seedQueue(page, [
            mkEntry('a', { sent: true, sentAt: '2026-05-21T11:00:00.000Z', queuedAt: '2026-05-19T10:00:00.000Z' }),
            mkEntry('b', { failed: true, attempts: 3, queuedAt: '2026-05-21T10:00:00.000Z' }),
            mkEntry('c', { queuedAt: '2026-05-20T10:00:00.000Z' }),
        ]);
        await page.locator('.projects-subtab[data-subtab="admin"]').click();

        const rows = page.locator('.admin-row');
        await expect(rows).toHaveCount(3);
        // Newest-queued first: b → c → a
        await expect(rows.nth(0)).toHaveAttribute('data-id', 'b');
        await expect(rows.nth(1)).toHaveAttribute('data-id', 'c');
        await expect(rows.nth(2)).toHaveAttribute('data-id', 'a');
        await expect(rows.nth(0).locator('.admin-status-pill')).toHaveText('failed');
        await expect(rows.nth(1).locator('.admin-status-pill')).toHaveText('pending');
        await expect(rows.nth(2).locator('.admin-status-pill')).toHaveText('sent');
    });

    test('filter pills narrow the visible entries and reflect the active state', async ({ page }) => {
        await seedQueue(page, [
            mkEntry('p1'), mkEntry('p2'),
            mkEntry('s1', { sent: true, sentAt: '2026-05-21T11:00:00.000Z' }),
            mkEntry('f1', { failed: true, attempts: 3 }),
            mkEntry('f2', { failed: true, attempts: 3 }),
        ]);
        await page.locator('.projects-subtab[data-subtab="admin"]').click();

        // Default = All (5)
        await expect(page.locator('.admin-row')).toHaveCount(5);
        await expect(page.locator('.admin-filter-pill[data-status="all"]')).toHaveClass(/active/);

        await page.locator('.admin-filter-pill[data-status="failed"]').click();
        await expect(page.locator('.admin-row')).toHaveCount(2);
        await expect(page.locator('.admin-filter-pill[data-status="failed"]')).toHaveClass(/active/);

        await page.locator('.admin-filter-pill[data-status="sent"]').click();
        await expect(page.locator('.admin-row')).toHaveCount(1);
        await expect(page.locator('.admin-row .admin-status-pill')).toHaveText('sent');
    });

    test('Retry on a failed entry flips it back to pending in storage and UI', async ({ page }) => {
        await seedQueue(page, [
            mkEntry('f1', { failed: true, attempts: 3 }),
        ]);
        await page.locator('.projects-subtab[data-subtab="admin"]').click();

        const row = page.locator('.admin-row[data-id="f1"]');
        await expect(row.locator('.admin-status-pill')).toHaveText('failed');
        await row.locator('.admin-retry-btn').click();

        // UI flips
        await expect(row.locator('.admin-status-pill')).toHaveText('pending');
        // Retry button is hidden on pending rows
        await expect(row.locator('.admin-retry-btn')).toHaveCount(0);

        // Storage flips: sent stays false, failed=false, attempts=0
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('email_queue')));
        expect(stored.f1.sent).toBe(false);
        expect(stored.f1.failed).toBe(false);
        expect(stored.f1.attempts).toBe(0);
    });

    test('Clear sent older than 7 days removes only sent entries past the threshold', async ({ page }) => {
        // Dates relative to "now" so the 7-day boundary doesn't drift as the
        // calendar moves (a hardcoded "fresh" date eventually ages past 7 days).
        const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
        // One old-sent (well past 7 days), one fresh-sent (within 7 days), one pending, one failed
        await seedQueue(page, [
            mkEntry('oldSent', { sent: true, sentAt: daysAgo(30), queuedAt: daysAgo(31) }),
            mkEntry('freshSent', { sent: true, sentAt: daysAgo(1), queuedAt: daysAgo(2) }),
            mkEntry('pending', { queuedAt: daysAgo(1) }),
            mkEntry('failed', { failed: true, attempts: 3, queuedAt: daysAgo(1) }),
        ]);
        await page.locator('.projects-subtab[data-subtab="admin"]').click();

        // Button shows "Clear 1 sent entry older than 7 days"
        const clearBtn = page.locator('#admin-clear-sent-btn');
        await expect(clearBtn).toContainText('Clear 1 sent entry older than 7 days');
        await clearBtn.click();

        // Old-sent gone; the other three remain
        await expect(page.locator('.admin-row[data-id="oldSent"]')).toHaveCount(0);
        await expect(page.locator('.admin-row')).toHaveCount(3);
        // Button now disabled (nothing older than 7 days)
        await expect(clearBtn).toBeDisabled();

        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('email_queue')));
        expect(stored.oldSent).toBeUndefined();
        expect(stored.freshSent).toBeDefined();
        expect(stored.pending).toBeDefined();
        expect(stored.failed).toBeDefined();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 7.1 — Celebrations', () => {

    test('marking a regular task done shows a light celebration overlay', async ({ page }) => {
        await createProject(page, { name: 'Celebrate small' });
        await page.locator('#task-add-name').fill('Mow lawn');
        await page.locator('#task-add-name').press('Enter');
        // Add a second task so marking the first done isn't also the last —
        // otherwise classifyCelebration would escalate to 'full'.
        await page.locator('#task-add-name').fill('Edge garden');
        await page.locator('#task-add-name').press('Enter');

        const row = page.locator('.task-row', { hasText: 'Mow lawn' });
        await row.locator('.task-row-status').selectOption('done');

        const overlay = page.locator('.celebrate-overlay').first();
        await expect(overlay).toBeVisible();
        await expect(overlay).toHaveAttribute('data-intensity', 'light');
        // Auto-clears within 3s — celebrate.js timeout is 3000ms.
        await expect(page.locator('.celebrate-overlay')).toHaveCount(0, { timeout: 4500 });
    });

    test('marking a milestone task done shows a medium celebration', async ({ page }) => {
        await createProject(page, { name: 'Celebrate milestone' });
        await page.locator('#task-add-name').fill('Pour slab');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'Pour slab' }).locator('.task-row-name').click();
        await page.locator('#tp-milestone').check();
        await page.locator('#tp-save').click();

        // Add another task so finishing the milestone isn't also "all tasks done"
        await page.locator('#task-add-name').fill('Followup');
        await page.locator('#task-add-name').press('Enter');

        const row = page.locator('.task-row', { hasText: 'Pour slab' });
        await row.locator('.task-row-status').selectOption('done');

        const overlay = page.locator('.celebrate-overlay').first();
        await expect(overlay).toBeVisible();
        await expect(overlay).toHaveAttribute('data-intensity', 'medium');
    });

    test('completing the last open task in a project shows a full celebration', async ({ page }) => {
        await createProject(page, { name: 'Celebrate finale' });
        await page.locator('#task-add-name').fill('Only task');
        await page.locator('#task-add-name').press('Enter');

        const row = page.locator('.task-row', { hasText: 'Only task' });
        await row.locator('.task-row-status').selectOption('done');

        const overlay = page.locator('.celebrate-overlay').first();
        await expect(overlay).toBeVisible();
        await expect(overlay).toHaveAttribute('data-intensity', 'full');
    });

    test('celebration does not block interaction (pointer-events: none on overlay)', async ({ page }) => {
        await createProject(page, { name: 'Celebrate noblock' });
        await page.locator('#task-add-name').fill('T1');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('T2');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('.task-row', { hasText: 'T1' }).locator('.task-row-status').selectOption('done');

        // Overlay should be visible AND clickable through — adding T3 should still work.
        await expect(page.locator('.celebrate-overlay').first()).toBeVisible();
        await page.locator('#task-add-name').fill('T3 during celebration');
        await page.locator('#task-add-name').press('Enter');
        await expect(page.locator('.task-row', { hasText: 'T3 during celebration' })).toBeVisible();
    });

    test('celebration sound toggle in the prefs modal persists across reload', async ({ page }) => {
        await page.locator('#notif-bell-btn').click();
        await page.locator('#notif-prefs-btn').click();
        await expect(page.locator('#np-celebrate-sound')).toBeVisible();
        await expect(page.locator('#np-celebrate-sound')).not.toBeChecked();
        await page.locator('#np-celebrate-sound').check();
        await page.locator('#np-save').click();

        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('#notif-bell-btn').click();
        await page.locator('#notif-prefs-btn').click();
        await expect(page.locator('#np-celebrate-sound')).toBeChecked();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 7.2 — Local AI helpers', () => {

    test('task-name input exposes a <datalist> populated from existing task names', async ({ page }) => {
        await createProject(page, { name: 'AI autocomplete' });
        // Seed two tasks so the datalist has something to offer.
        await page.locator('#task-add-name').fill('Mow lawn');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#task-add-name').fill('Edge garden');
        await page.locator('#task-add-name').press('Enter');

        // The add row re-renders after each submit; the latest datalist should
        // include both historical names.
        const list = page.locator('#task-name-suggestions');
        await expect(list.locator('option[value="Mow lawn"]')).toHaveCount(1);
        await expect(list.locator('option[value="Edge garden"]')).toHaveCount(1);
        // And the name input is wired to it via the `list` attribute.
        await expect(page.locator('#task-add-name')).toHaveAttribute('list', 'task-name-suggestions');
    });

    test('due-date "Suggest" pill appears after a project has at least one dated task and applies on click', async ({ page }) => {
        await createProject(page, { name: 'AI due-date suggester' });
        // No suggest pill yet — no historical data, just fallback. The
        // implementation still surfaces the +7-day fallback, so the pill
        // should appear immediately on a fresh project too.
        await expect(page.locator('#task-add-due-suggest')).toBeVisible();
        const initialText = (await page.locator('#task-add-due-suggest').textContent()).trim();
        expect(initialText).toMatch(/^Suggest: /);

        // Seed a dated task so we have one real datapoint.
        await page.locator('#task-add-name').fill('Prep tools');
        await page.locator('#task-add-due').fill('2026-06-15');
        await page.locator('#task-add-submit').click();

        // The pill now reflects the historical median. Click it and the
        // due-date input fills in.
        await expect(page.locator('#task-add-due-suggest')).toBeVisible();
        await page.locator('#task-add-due-suggest').click();
        await expect(page.locator('#task-add-due')).not.toHaveValue('');
    });

    test('Dashboard shows a plain-English daily digest paragraph above the cards', async ({ page }) => {
        // No tasks → "All clear" sentence.
        await page.locator('.projects-subtab[data-subtab="dashboard"]').click();
        await expect(page.locator('#dashboard-digest')).toBeVisible();
        await expect(page.locator('#dashboard-digest')).toContainText('All clear');
    });

    test('Stale project gets an orange ⏳ Stale badge on the Overview card', async ({ page }) => {
        await createProject(page, { name: 'Idle reno' });
        await backToList(page);
        // Simulate "no activity in over 14 days" by reaching into localStorage,
        // back-dating updatedAt on both the project and any tasks, then reloading.
        await page.evaluate(() => {
            const raw = JSON.parse(localStorage.getItem('projects'));
            raw.items.forEach(p => { p.updatedAt = '2025-01-01T00:00:00.000Z'; });
            (raw.tasks || []).forEach(t => { t.updatedAt = '2025-01-01T00:00:00.000Z'; });
            localStorage.setItem('projects', JSON.stringify(raw));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await expect(page.locator('.project-card-stale')).toBeVisible();
    });

    test('Smart sort option appears in the list-view Sort dropdown and reorders tasks by urgency', async ({ page }) => {
        await createProject(page, { name: 'Smart sort' });
        // Three tasks: an overdue low-priority, a future high-priority, and a future low-priority.
        await page.locator('#task-add-name').fill('Overdue low');
        await page.locator('#task-add-due').fill('2025-01-01');
        await page.locator('#task-add-submit').click();

        await page.locator('#task-add-name').fill('Future high');
        await page.locator('#task-add-due').fill('2099-01-01');
        await page.locator('#task-add-submit').click();
        // Bump priority to high via the slide-in panel.
        await page.locator('.task-row', { hasText: 'Future high' }).locator('.task-row-name').click();
        await page.locator('#tp-priority').selectOption('high');
        await page.locator('#tp-save').click();

        await page.locator('#task-add-name').fill('Future low');
        await page.locator('#task-add-due').fill('2099-01-01');
        await page.locator('#task-add-submit').click();

        // Switch to smart sort.
        await page.locator('#tasks-sort-by').selectOption('smart');
        // Direction toggle hides while smart is active.
        await expect(page.locator('#tasks-sort-dir')).toHaveCount(0);

        // Order: overdue (3 + 1 low = 4) > future-high (3 priority) > future-low (1 priority)
        const names = await page.locator('.task-row .task-row-name').allTextContents();
        const indexOf = (s) => names.findIndex(n => n.includes(s));
        expect(indexOf('Overdue low')).toBe(0);
        expect(indexOf('Future high')).toBe(1);
        expect(indexOf('Future low')).toBe(2);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 8.1 — PM DLBooks → Projects migration', () => {

    // The beforeEach in this file clears localStorage and reloads on `/`. To
    // exercise the migration we need to seed `pm_dlbooks` AFTER the initial
    // clear+reload but before the projects module first mounts. The shell
    // re-runs `maybeRunPMMigration` on each load, so seeding + reloading is
    // the simplest way to drive it.
    async function seedPMAndReload(page, pmData) {
        // The describe-level beforeEach has already triggered one boot that
        // migrated whatever PM defaults were lying around. Wipe `projects`
        // back to an empty bucket (flag off) so we exercise a clean migration
        // from our seed data — otherwise the prior-boot migration shows up as
        // duplicate "Macro Initiatives" cards.
        await page.evaluate((data) => {
            localStorage.setItem('pm_dlbooks', JSON.stringify(data));
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {}, pm_dlbooks_migrated_to_projects: false,
            }));
        }, pmData);
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
    }

    test('first boot after upgrade migrates Macro Initiatives + customer projects', async ({ page }) => {
        await seedPMAndReload(page, {
            macro: [
                { id: 'm1', name: 'Migrate to SharePoint', status: 'not-started', assignee: 'both', notes: '', createdAt: '2026-03-26' },
            ],
            customers: [
                { id: 'c1', name: 'Reed Cranes', tasks: [
                    { id: 't1', name: 'Xero vendor review', status: 'in-progress', assignee: 'brad', notes: 'review the catalogue', subtasks: [
                        { name: 'Pull current list', done: true },
                        { name: 'Confirm with Reed', done: false },
                    ], createdAt: '2026-03-26' },
                ] },
                { id: 'c2', name: 'A1 Showers', tasks: [] },
            ],
        });

        await expect(page.locator('.project-card', { hasText: 'Macro Initiatives' })).toBeVisible();
        await expect(page.locator('.project-card', { hasText: 'DLBooks — Reed Cranes' })).toBeVisible();
        await expect(page.locator('.project-card', { hasText: 'DLBooks — A1 Showers' })).toBeVisible();
    });

    test('migration is idempotent — reloading does not duplicate projects', async ({ page }) => {
        const pmData = {
            macro: [{ id: 'm1', name: 'One macro', status: 'not-started', assignee: 'brad', createdAt: '2026-03-26' }],
            customers: [],
        };
        await seedPMAndReload(page, pmData);
        await expect(page.locator('.project-card', { hasText: 'Macro Initiatives' })).toHaveCount(1);

        // Reload without flipping the flag back — migration should NOT re-run.
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await expect(page.locator('.project-card', { hasText: 'Macro Initiatives' })).toHaveCount(1);
    });

    // Note: the original "legacy pm_dlbooks key is preserved after migration"
    // test was retired in v2.0.2 when the cleanup runner started removing the
    // key in the same boot. Post-cleanup behavior is covered by the
    // `v2.0.2 — Legacy pm_dlbooks cleanup` describe further down. The
    // migration itself is still append-only — that's exercised by the
    // "first boot after upgrade migrates ..." and "is idempotent ..." tests
    // above, both of which would notice if migration accidentally deleted
    // upstream data before re-running.

    test('migrated tasks land in the project detail view with the right metadata', async ({ page }) => {
        await seedPMAndReload(page, {
            macro: [],
            customers: [{
                id: 'c1', name: 'Reed Cranes', tasks: [
                    { id: 't1', name: 'Time sheet automation', status: 'in-progress', assignee: 'both', notes: 'kick-off this week', subtasks: [
                        { name: 'Draft spec', done: true },
                    ], createdAt: '2026-03-26' },
                ],
            }],
        });
        // Open the migrated project
        await page.locator('.project-card', { hasText: 'DLBooks — Reed Cranes' }).click();
        const parentRow = page.locator('.task-row', { hasText: 'Time sheet automation' });
        await expect(parentRow).toBeVisible();
        // Indented sub-task is also rendered
        await expect(page.locator('.task-row', { hasText: 'Draft spec' })).toBeVisible();
        // Task panel shows the migrated notes as the description
        await parentRow.locator('.task-row-name').click();
        await expect(page.locator('#tp-desc')).toHaveValue('kick-off this week');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('v2.0.1 — Business transformation seed', () => {

    // Seeds no longer auto-apply on boot — they are pulled from the admin
    // "Project seeds" panel. Start from a clean bucket with the seed pending,
    // pull it via Run now, then return to the overview to see the cards.
    async function resetSeedFlagAndReload(page) {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                business_transform_seeded: false,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.projects-subtab[data-subtab="admin"]').click();
        await page.locator('.seed-row[data-seed-id="business-transform"] .seed-run-btn').click();
        await page.locator('.projects-subtab[data-subtab="overview"]').click();
    }

    test('first boot seeds the Milestones + 8 stream projects', async ({ page }) => {
        await resetSeedFlagAndReload(page);
        await expect(page.locator('.project-card', { hasText: 'Milestones' })).toBeVisible();
        await expect(page.locator('.project-card', { hasText: 'Stream 1 — CRM build' })).toBeVisible();
        await expect(page.locator('.project-card', { hasText: 'Stream 8 — Growth & acquisition' })).toBeVisible();
        await expect(page.locator('.project-card', { hasText: 'Adhoc — Diana' })).toBeVisible();
    });

    test('seed is idempotent — reloading does not duplicate any project', async ({ page }) => {
        await resetSeedFlagAndReload(page);
        await expect(page.locator('.project-card', { hasText: 'Milestones' })).toHaveCount(1);
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await expect(page.locator('.project-card', { hasText: 'Milestones' })).toHaveCount(1);
        await expect(page.locator('.project-card', { hasText: 'Stream 1 — CRM build' })).toHaveCount(1);
    });

    test('Stream 1 — CRM build opens to seeded tasks with their migrated subtasks', async ({ page }) => {
        await resetSeedFlagAndReload(page);
        await page.locator('.project-card', { hasText: 'Stream 1 — CRM build' }).click();
        const parentRow = page.locator('.task-row', { hasText: 'Phase 1: Auth module' });
        await expect(parentRow).toBeVisible();
        // Subtask from the JSON appears indented under its parent.
        await expect(page.locator('.task-row', { hasText: 'auth/routes.py — login/logout Blueprint' })).toBeVisible();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Admin — Project seeds queue (manual pull)', () => {

    async function openSeedsPanelUnseeded(page) {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                business_transform_seeded: false,
                subpoena_brauer_seeded: false,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.projects-subtab[data-subtab="admin"]').click();
    }

    test('lists registered seeds as pending with a Run now action when unseeded', async ({ page }) => {
        await openSeedsPanelUnseeded(page);
        await expect(page.locator('table[aria-label="Project seeds"]')).toBeVisible();
        const brauer = page.locator('.seed-row[data-seed-id="subpoena-brauer"]');
        await expect(brauer.locator('.admin-status-pill')).toHaveText('Pending');
        await expect(brauer.locator('.seed-run-btn')).toBeVisible();
        await expect(page.locator('#seed-run-all-btn')).toContainText('Run 2 pending');
    });

    test('Run now applies a pending seed live (no reload) and flips it to Applied', async ({ page }) => {
        await openSeedsPanelUnseeded(page);
        await page.locator('.seed-row[data-seed-id="subpoena-brauer"] .seed-run-btn').click();
        const brauer = page.locator('.seed-row[data-seed-id="subpoena-brauer"]');
        await expect(brauer.locator('.admin-status-pill')).toHaveText('Applied');
        await expect(brauer.locator('.seed-run-btn')).toHaveCount(0);
        // Flag persisted + the project landed in storage, without a reload.
        const stored = await page.evaluate(() => {
            const d = JSON.parse(localStorage.getItem('projects'));
            return { flag: d.subpoena_brauer_seeded, hasProject: d.items.some(p => /Brauer/i.test(p.name)) };
        });
        expect(stored.flag).toBe(true);
        expect(stored.hasProject).toBe(true);
    });

    test('applied seeds show Applied with no action and Run-all is disabled at 0 pending', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                business_transform_seeded: true,
                subpoena_brauer_seeded: true,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.projects-subtab[data-subtab="admin"]').click();
        await expect(page.locator('.seed-row .admin-status-pill', { hasText: 'Pending' })).toHaveCount(0);
        await expect(page.locator('.seed-run-btn')).toHaveCount(0);
        await expect(page.locator('#seed-run-all-btn')).toBeDisabled();
        await expect(page.locator('#seed-run-all-btn')).toContainText('Run 0 pending');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('v2.0.2 — Legacy pm_dlbooks cleanup', () => {

    test('cleanup removes the legacy pm_dlbooks key from localStorage on first boot after migration', async ({ page }) => {
        // Seed both pm_dlbooks data AND the migration flag, but leave the
        // cleanup flag off so maybeCleanupLegacyPMData runs on next reload.
        await page.evaluate(() => {
            localStorage.setItem('pm_dlbooks', JSON.stringify({
                macro: [{ id: 'm1', name: 'Leftover', status: 'not-started', assignee: 'brad' }],
                customers: [],
            }));
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                business_transform_seeded: true,
                pm_dlbooks_cleaned: false,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        // After the boot, pm_dlbooks should be gone and the cleanup flag set.
        const after = await page.evaluate(() => ({
            pm: localStorage.getItem('pm_dlbooks'),
            flag: JSON.parse(localStorage.getItem('projects')).pm_dlbooks_cleaned,
        }));
        expect(after.pm).toBeNull();
        expect(after.flag).toBe(true);
    });

    test('cleanup is gated on the migration flag — does not run if migration never happened', async ({ page }) => {
        // Migration flag false → cleanup must NOT run.
        await page.evaluate(() => {
            localStorage.setItem('pm_dlbooks', JSON.stringify({ macro: [], customers: [] }));
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: false,
                business_transform_seeded: true,
                pm_dlbooks_cleaned: false,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        // Migration will run (migrating an empty payload), then cleanup runs in
        // the same boot since the migration set its flag to true.
        // The key SHOULD be cleared in this case — gating is "won't run UNTIL
        // migration is done", not "won't run if both happen on the same boot".
        // Assert the resulting cleaned state.
        const after = await page.evaluate(() => ({
            pm: localStorage.getItem('pm_dlbooks'),
            migrated: JSON.parse(localStorage.getItem('projects')).pm_dlbooks_migrated_to_projects,
            cleaned: JSON.parse(localStorage.getItem('projects')).pm_dlbooks_cleaned,
        }));
        expect(after.migrated).toBe(true);
        expect(after.cleaned).toBe(true);
        expect(after.pm).toBeNull();
    });

    test('cleanup is idempotent — reloading after the flag is set does not error', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                business_transform_seeded: true,
                pm_dlbooks_cleaned: true,
            }));
        });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        const realErrors = errors.filter(e =>
            !/firebase/i.test(e) && !/net::ERR_FAILED/i.test(e) && !/asynchronous response/i.test(e)
        );
        expect(realErrors).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('v2.0.3 — Business transform status update 2026-05-25', () => {

    // The update only runs on boot when (a) the seed is present and (b) the
    // update flag is false. Seeds no longer auto-apply on boot, so: start with
    // both flags off, pull the seed via the admin panel (sets the seed flag +
    // adds the projects), then reload so the boot-time update one-shot patches
    // the freshly-seeded tasks.
    async function seedAndApplyUpdate(page) {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                pm_dlbooks_cleaned: true,
                business_transform_seeded: false,
                business_transform_update_20260525_applied: false,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.projects-subtab[data-subtab="admin"]').click();
        await page.locator('.seed-row[data-seed-id="business-transform"] .seed-run-btn').click();
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
    }

    test('after seed + update, Phase 1 auth task is done with the expected completedAt', async ({ page }) => {
        await seedAndApplyUpdate(page);
        const tasksState = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            return data.tasks.find(t => t.name === 'Phase 1: Auth module');
        });
        expect(tasksState.status).toBe('done');
        expect(tasksState.completedAt).toBe('2026-04-18T00:00:00.000Z');
    });

    test('Phase 3 parent task is in-progress with null completedAt', async ({ page }) => {
        await seedAndApplyUpdate(page);
        const phase3 = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            return data.tasks.find(t => t.name === 'Phase 3: Quote builder + PDF + pipeline reports');
        });
        expect(phase3.status).toBe('in-progress');
        expect(phase3.completedAt).toBeNull();
    });

    test('update is idempotent — reloading after the flag is set does not re-patch', async ({ page }) => {
        await seedAndApplyUpdate(page);
        // Manually flip the Phase 1 auth task back to in-progress to simulate
        // a user reverting it; the update must NOT re-overwrite it on reload.
        await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            const t = data.tasks.find(x => x.name === 'Phase 1: Auth module');
            t.status = 'in-progress';
            t.completedAt = null;
            localStorage.setItem('projects', JSON.stringify(data));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        const after = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            return data.tasks.find(t => t.name === 'Phase 1: Auth module');
        });
        // Update did not re-fire — the user's manual revert is preserved.
        expect(after.status).toBe('in-progress');
        expect(after.completedAt).toBeNull();
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('v2.0.5 — Business transform extras 2026-05-25', () => {

    // Same shape as the v2.0.3 helper: seeds no longer auto-apply on boot, so
    // pull the seed via the admin panel, then reload so the boot-time extras
    // one-shot appends its rows to the freshly-seeded tasks.
    async function seedAndApplyExtras(page) {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {}, prefs: {},
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                pm_dlbooks_cleaned: true,
                business_transform_seeded: false,
                business_transform_update_20260525_applied: true,
                business_transform_extras_20260525_applied: false,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.projects-subtab[data-subtab="admin"]').click();
        await page.locator('.seed-row[data-seed-id="business-transform"] .seed-run-btn').click();
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
    }

    test('Document Services platform top-level task lands under Stream 4 as done', async ({ page }) => {
        await seedAndApplyExtras(page);
        const docServices = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            const stream4 = data.items.find(p => p.name === 'Stream 4 — AI agents & automation');
            return data.tasks.find(t =>
                t.projectId === stream4.id &&
                /Document Services platform/.test(t.name) &&
                !t.parentTaskId
            );
        });
        expect(docServices).toBeTruthy();
        expect(docServices.status).toBe('done');
        expect(docServices.completedAt).toBe('2026-05-22T00:00:00.000Z');
    });

    test('Document Services has 7 children including a blocked Phase 1.5 row', async ({ page }) => {
        await seedAndApplyExtras(page);
        const children = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            const stream4 = data.items.find(p => p.name === 'Stream 4 — AI agents & automation');
            const docServices = data.tasks.find(t =>
                t.projectId === stream4.id &&
                /Document Services platform/.test(t.name) &&
                !t.parentTaskId
            );
            return data.tasks.filter(t => t.parentTaskId === docServices.id);
        });
        expect(children).toHaveLength(7);
        const phase15 = children.find(c => /Phase 1\.5/.test(c.name));
        expect(phase15).toBeTruthy();
        expect(phase15.status).toBe('blocked');
        expect(phase15.completedAt).toBeNull();
    });

    test('Public-surface security hardening is a child of the Phase 1 Auth task', async ({ page }) => {
        await seedAndApplyExtras(page);
        const security = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            const stream1 = data.items.find(p => p.name === 'Stream 1 — CRM build');
            const auth = data.tasks.find(t =>
                t.projectId === stream1.id &&
                t.name === 'Phase 1: Auth module' &&
                !t.parentTaskId
            );
            return data.tasks.find(t =>
                t.parentTaskId === auth.id &&
                /Public-surface security hardening/.test(t.name)
            );
        });
        expect(security).toBeTruthy();
        expect(security.status).toBe('done');
        expect(security.completedAt).toBe('2026-05-21T00:00:00.000Z');
    });

    test('Header nav IA refactor Phase 2 is a top-level not-started task in Stream 1', async ({ page }) => {
        await seedAndApplyExtras(page);
        const navPhase2 = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            const stream1 = data.items.find(p => p.name === 'Stream 1 — CRM build');
            return data.tasks.find(t =>
                t.projectId === stream1.id &&
                /Header nav IA refactor — Phase 2/.test(t.name) &&
                !t.parentTaskId
            );
        });
        expect(navPhase2).toBeTruthy();
        expect(navPhase2.status).toBe('not-started');
        expect(navPhase2.completedAt).toBeNull();
    });

    test('extras runner is idempotent — reloading after the flag is set does not re-add', async ({ page }) => {
        await seedAndApplyExtras(page);
        // Count Document Services parents immediately after the runner fired.
        const before = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            return data.tasks.filter(t => /Document Services platform/.test(t.name) && !t.parentTaskId).length;
        });
        expect(before).toBe(1);
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        const after = await page.evaluate(() => {
            const data = JSON.parse(localStorage.getItem('projects'));
            return data.tasks.filter(t => /Document Services platform/.test(t.name) && !t.parentTaskId).length;
        });
        expect(after).toBe(1);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('v2.2 — New-task task_assigned notification', () => {

    async function readEmailQueue(page) {
        return await page.evaluate(() => {
            const raw = localStorage.getItem('email_queue');
            if (!raw) return {};
            try { return JSON.parse(raw); } catch { return {}; }
        });
    }

    test('creating a task already-assigned to Diana writes a task_assigned email entry for her', async ({ page }) => {
        await createProject(page, { name: 'New-task notif' });
        await page.locator('#task-add-name').fill('Site survey');
        await page.locator('#task-add-assignee').selectOption('diana');
        await page.locator('#task-add-submit').click();

        const entries = Object.values(await readEmailQueue(page));
        expect(entries.length).toBe(1);
        expect(entries[0].to).toBe('dianaleshcheva@gmail.com');
        expect(entries[0].kind).toBe('task_assigned');
        expect(entries[0].subject).toBe('[Family Planner] Task assigned: Site survey');
        expect(entries[0].sent).toBe(false);
    });

    test('creating an unassigned task writes no email queue entry', async ({ page }) => {
        await createProject(page, { name: 'No-assignee' });
        await page.locator('#task-add-name').fill('Drafting');
        await page.locator('#task-add-submit').click();

        expect(Object.keys(await readEmailQueue(page)).length).toBe(0);
        await expect(page.locator('#notif-bell-btn .notif-bell-badge')).toHaveCount(0);
    });

    test('digest-mode recipient gets a digest_pending entry, no email_queue', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('projects', JSON.stringify({
                items: [], tasks: [], notifications: {},
                prefs: { diana: { master: true, mode: 'digest', kinds: {} } },
                digest_pending: {},
                pm_dlbooks_migrated_to_projects: true,
                business_transform_seeded: true,
                pm_dlbooks_cleaned: true,
                business_transform_update_20260525_applied: true,
                business_transform_extras_20260525_applied: true,
            }));
        });
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();

        await createProject(page, { name: 'Digest at create' });
        await page.locator('#task-add-name').fill('Quiet drop');
        await page.locator('#task-add-assignee').selectOption('diana');
        await page.locator('#task-add-submit').click();

        expect(Object.keys(await readEmailQueue(page)).length).toBe(0);
        const digest = await page.evaluate(() => {
            const raw = localStorage.getItem('projects');
            return raw ? (JSON.parse(raw).digest_pending || {}) : {};
        });
        expect(Array.isArray(digest.diana)).toBe(true);
        expect(digest.diana.length).toBe(1);
        expect(digest.diana[0].kind).toBe('task_assigned');
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('In-browser data-layer unit suite', () => {

    test('tests.html runs all data-layer tests with 0 failures', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto('/tests.html');
        // The runner appends a `.test-summary` element when done
        const summary = page.locator('.test-summary');
        await expect(summary).toBeVisible({ timeout: 10_000 });
        await expect(summary).toHaveClass(/ok/);
        await expect(summary).toContainText(/^\d+ passed, 0 failed$/);
        // No script errors loading the test modules
        expect(errors).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Phase 0 — Module shell regression', () => {

    test('both top-level tabs mount without console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        // Visit each tab. Task 8.2 retired the PM DLBooks (legacy) module
        // so the nav only renders Finance + Projects now.
        for (const id of ['finance', 'projects']) {
            await page.locator(`.top-nav-btn[data-module="${id}"]`).click();
            await expect(page.locator(`#module-${id}`)).toBeVisible();
        }
        await expect(page.locator('.top-nav-btn[data-module="pm-legacy"]')).toHaveCount(0);
        // Filter out the noisy Firebase-unavailable network errors and
        // browser extension chatter — we deliberately blocked Firebase.
        const real = errors.filter(e =>
            !/firebase/i.test(e) &&
            !/net::ERR_FAILED/i.test(e) &&
            !/asynchronous response/i.test(e)
        );
        expect(real).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────────────────
test.describe('Projects overview — sort persistence, status filter, archive, shift', () => {

    test('On Hold sticks on a project that has tasks (auto override)', async ({ page }) => {
        // Reproduces the bug: with tasks present and no override, on-hold would
        // re-derive to Planning. Selecting on-hold must now auto-enable override.
        await createProject(page, { name: 'Held' });
        await page.locator('#task-add-name').fill('A task');
        await page.locator('#task-add-name').press('Enter');
        await page.locator('#projects-edit-btn').click();
        await page.locator('#pf-status').selectOption('on-hold');
        // Override checkbox auto-ticks
        await expect(page.locator('#pf-status-override')).toBeChecked();
        await page.locator('#pf-save').click();
        await expect(page.locator('.projects-toolbar .status-badge')).toHaveText('On hold');
        // Survives reload
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await page.locator('.project-card', { hasText: 'Held' }).click();
        await expect(page.locator('.projects-toolbar .status-badge')).toHaveText('On hold');
    });

    test('overview sort choice persists across reload', async ({ page }) => {
        await createProject(page, { name: 'Sortpref' });
        await backToList(page);
        await page.locator('#overview-sort-by').selectOption('name');
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await expect(page.locator('#overview-sort-by')).toHaveValue('name');
    });

    test('status filter hides non-matching projects and persists', async ({ page }) => {
        await createProject(page, { name: 'ActiveOne', status: 'active' });
        await backToList(page);
        await createProject(page, { name: 'PlanOne', status: 'planning' });
        await backToList(page);
        await page.locator('#overview-status-filter').selectOption('active');
        await expect(page.locator('.project-card', { hasText: 'ActiveOne' })).toBeVisible();
        await expect(page.locator('.project-card', { hasText: 'PlanOne' })).toHaveCount(0);
        // Persists across reload
        await page.reload();
        await page.waitForSelector('#module-host', { state: 'attached' });
        await page.locator('.top-nav-btn[data-module="projects"]').click();
        await expect(page.locator('#overview-status-filter')).toHaveValue('active');
        await expect(page.locator('.project-card', { hasText: 'PlanOne' })).toHaveCount(0);
    });

    test('archive removes from overview; Archived sub-tab restores it', async ({ page }) => {
        await createProject(page, { name: 'ToArchive' });
        await page.locator('#projects-archive-btn').click();
        // Back on the overview, the card is gone
        await expect(page.locator('.project-card', { hasText: 'ToArchive' })).toHaveCount(0);
        // Archived sub-tab lists it
        await page.locator('.projects-subtab[data-subtab="archived"]').click();
        const row = page.locator('.archived-row', { hasText: 'ToArchive' });
        await expect(row).toBeVisible();
        // Restore puts it back in the overview
        await row.locator('.archived-row-restore').click();
        await page.locator('.projects-subtab[data-subtab="overview"]').click();
        await expect(page.locator('.project-card', { hasText: 'ToArchive' })).toBeVisible();
    });

    test('project-level Shift dates moves project + task dates forward', async ({ page }) => {
        await createProject(page, { name: 'Shifty', startDate: '2026-06-01', endDate: '2026-06-30' });
        await page.locator('#task-add-name').fill('Dated task');
        await page.locator('#task-add-name').press('Enter');
        // Give the task a due date via the panel
        await page.locator('.task-row .task-row-name', { hasText: 'Dated task' }).click();
        await page.locator('#tp-due').fill('2026-06-10');
        await page.locator('#tp-save').click();
        // Shift everything +5 days
        await page.locator('#projects-shift-btn').click();
        await page.locator('#shift-days').fill('5');
        await page.locator('#shift-apply').click();
        // Project end date moved to 05/07/2026 (shown on edit form)
        await page.locator('#projects-edit-btn').click();
        await expect(page.locator('#pf-start')).toHaveValue('2026-06-06');
        await expect(page.locator('#pf-end')).toHaveValue('2026-07-05');
        await page.locator('#projects-back-btn').click();
        // Task due date moved to 2026-06-15
        await page.locator('.task-row .task-row-name', { hasText: 'Dated task' }).click();
        await expect(page.locator('#tp-due')).toHaveValue('2026-06-15');
    });
});
