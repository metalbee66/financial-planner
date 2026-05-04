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
        const stats = page.locator('.project-card', { hasText: 'Count check' }).locator('.project-card-stats');
        await expect(stats).toHaveText('2/3 open');
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

        await page.locator('#tp-assignee').selectOption('brad');
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
