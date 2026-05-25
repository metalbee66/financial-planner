/**
 * One-shot append of three "Recommended additions" from the 2026-05-25
 * off-repo agent report — work that postdates the v2.0.1 seed and was
 * deliberately skipped in the v2.0.3 update pass because the report
 * flagged it as Optional. Brad opted in during the v2.0.5 walkthrough.
 *
 * Source doc: `family-planner-status-update-2026-05-25.md` (in the SenseAi
 * repo at `tasks/family-planner-status-update-2026-05-25.md`),
 * §"New work not in the seed — recommend adding" items 1, 2, 3.
 *
 * The runner is idempotent via `business_transform_extras_20260525_applied`
 * on the projects root, mirrored across devices through firebase-sync's
 * projects listener (same pattern as the v2.0.1 / v2.0.3 flags).
 *
 * Manual edits made after the flag flips true are NOT re-overwritten — same
 * caveat as the v2.0.3 patch. If Brad deletes one of these additions, it
 * stays gone.
 */

const SHIPPED_AT_ISO = '2026-05-25T00:00:00.000Z';
const DOCSERVICES_COMPLETED = '2026-05-22T00:00:00.000Z';
const SECURITY_HARDENING_COMPLETED = '2026-05-21T00:00:00.000Z';

function makeTaskId(slug = '') {
    const tag = slug ? `${slug}_` : '';
    return 't_btx_' + tag + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function buildAddition({
    name,
    status,
    projectId,
    parentTaskId = null,
    description = '',
    completedAt = null,
}) {
    return {
        id: makeTaskId(),
        projectId,
        parentTaskId,
        name,
        description,
        status,
        assignees: ['brad', 'diana'],
        startDate: null,
        dueDate: null,
        priority: 'normal',
        dependsOn: [],
        comments: [],
        events: [],
        attachments: [],
        isMilestone: false,
        createdAt: SHIPPED_AT_ISO,
        updatedAt: SHIPPED_AT_ISO,
        completedAt,
    };
}

/**
 * What to add. Kept as data so tests can introspect it and so the surface
 * area is greppable from the report doc that motivated it.
 */
export const ADDITIONS = [
    // (1) Document Services platform — new top-level under Stream 4, with
    //     six "done" child rows for the shipped pieces + one "blocked"
    //     child for Phase 1.5 (real Xero Payroll AU integration).
    {
        kind: 'top-level',
        projectName: 'Stream 4 — AI agents & automation',
        name: 'Document Services platform (generic shell + Reed payroll first instance)',
        status: 'done',
        completedAt: DOCSERVICES_COMPLETED,
        description: 'Generic intake → preview → approve → dispatch shell with Reed weekly-payroll as the first instance. Shipped 2026-05-20; owner-auth 2026-05-21; Reed first instance smoked 2026-05-22; owner-page + admin polish 2026-05-23; operational polish (cancel/purge/completed-log/retained owner link) 2026-05-24.',
        children: [
            { name: 'Schema + state machine', status: 'done', completedAt: DOCSERVICES_COMPLETED },
            { name: 'Intake → preview → dispatch flow', status: 'done', completedAt: DOCSERVICES_COMPLETED },
            { name: 'n8n transform + dispatch (echo MVP)', status: 'done', completedAt: DOCSERVICES_COMPLETED },
            { name: 'Owner magic-link surface', status: 'done', completedAt: DOCSERVICES_COMPLETED },
            { name: 'Admin: Copy Owner Link', status: 'done', completedAt: DOCSERVICES_COMPLETED },
            { name: '/approvals top-level route', status: 'done', completedAt: DOCSERVICES_COMPLETED },
            { name: 'Phase 1.5: real Xero Payroll AU integration (blocked on sandbox access)', status: 'blocked' },
        ],
    },

    // (2) Public-surface security hardening — child of s1_t1 Auth, matching
    //     the report's "could fit ... as a sub-item under s1_t1 Auth" hint.
    {
        kind: 'child',
        projectName: 'Stream 1 — CRM build',
        parentTaskName: 'Phase 1: Auth module',
        name: 'Public-surface security hardening',
        status: 'done',
        completedAt: SECURITY_HARDENING_COMPLETED,
        description: 'Login audit + lockout alert + Xero token ACL + Caddy security headers + n8n MFA. Shipped 2026-05-21.',
    },

    // (3) Header nav IA refactor — Phase 2 — new top-level under Stream 1.
    //     Phase 1 (14 flat anchors → 8 top-level + 4 dropdowns) already
    //     shipped 2026-05-24; Phase 2 (`crm` → `practice` rename + new
    //     subdomain) is queued, not started.
    {
        kind: 'top-level',
        projectName: 'Stream 1 — CRM build',
        name: 'Header nav IA refactor — Phase 2 (crm → practice module rename + new subdomain)',
        status: 'not-started',
        description: 'Phase 1 shipped 2026-05-24 (commits c7454b8, c3f913f) — collapsed 14 flat anchors into 8 top-level items with 4 dropdowns. Phase 2 renames the CRM module to practice/ + moves to a new subdomain. Queued, not started.',
    },
];

/**
 * Append the three "Recommended additions" to a copy of `(items, tasks)`.
 * Returns the new arrays plus a report listing what landed / what couldn't
 * be matched so the runner can surface rename drift.
 *
 * Mutates neither input array — task list is returned with new entries
 * appended; items are returned untouched.
 */
export function applyBusinessTransformExtras20260525(items, tasks) {
    const safeItems = Array.isArray(items) ? items : [];
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const report = { added: [], unmatched: [], addedCount: 0 };

    const projectByName = new Map();
    for (const p of safeItems) if (p && p.name) projectByName.set(p.name, p);

    const newTasks = [];

    for (const add of ADDITIONS) {
        const project = projectByName.get(add.projectName);
        if (!project) {
            report.unmatched.push(`project not found: ${add.projectName}`);
            continue;
        }

        let parentTaskId = null;
        if (add.kind === 'child') {
            const parent = safeTasks.find(t =>
                t.projectId === project.id &&
                t.name === add.parentTaskName &&
                !t.parentTaskId
            );
            if (!parent) {
                report.unmatched.push(`parent task not found in "${add.projectName}": ${add.parentTaskName}`);
                continue;
            }
            parentTaskId = parent.id;
        }

        const newTask = buildAddition({
            name: add.name,
            status: add.status,
            projectId: project.id,
            parentTaskId,
            description: add.description || '',
            completedAt: add.completedAt || null,
        });
        newTasks.push(newTask);
        const label = add.kind === 'child'
            ? `${add.projectName} :: ${add.parentTaskName} > ${add.name}`
            : `${add.projectName} :: ${add.name} → ${add.status}`;
        report.added.push(label);
        report.addedCount++;

        if (add.kind === 'top-level' && Array.isArray(add.children)) {
            for (const child of add.children) {
                const childTask = buildAddition({
                    name: child.name,
                    status: child.status,
                    projectId: project.id,
                    parentTaskId: newTask.id,
                    description: '',
                    completedAt: child.completedAt || null,
                });
                newTasks.push(childTask);
                report.added.push(`${add.projectName} :: ${add.name} > ${child.name}`);
                report.addedCount++;
            }
        }
    }

    return {
        items: safeItems,
        tasks: safeTasks.concat(newTasks),
        report,
    };
}

/** Exposed for tests + the runner's log line. */
export const ADDITION_COUNT = ADDITIONS.length;
export const TOTAL_TASK_COUNT = ADDITIONS.reduce(
    (acc, a) => acc + 1 + (Array.isArray(a.children) ? a.children.length : 0),
    0
);
