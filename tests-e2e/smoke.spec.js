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
