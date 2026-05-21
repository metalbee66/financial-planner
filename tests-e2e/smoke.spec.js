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
    await page.evaluate(() => localStorage.clear());
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
        await page.locator('.top-nav-btn[data-module="finance"]').click();
        await expect(page.locator('#notif-bell-btn')).toBeVisible();
        await page.locator('.top-nav-btn[data-module="pm-legacy"]').click();
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

    test('all three top-level tabs mount without console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        // Visit each tab
        for (const id of ['finance', 'projects', 'pm-legacy']) {
            await page.locator(`.top-nav-btn[data-module="${id}"]`).click();
            await expect(page.locator(`#module-${id}`)).toBeVisible();
        }
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
