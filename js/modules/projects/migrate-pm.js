/**
 * Phase 8.1 — one-time migration from the legacy PM DLBooks tab into the
 * new Projects module.
 *
 * Schema mapping:
 *   - pmData.macro[]          → one project "Macro Initiatives" + one task per item
 *   - pmData.customers[]      → one project per customer "DLBooks — <name>" with
 *                               each customer task mapped to a project task and
 *                               each pm-subtask `{name, done}` mapped to a real
 *                               child task with parentTaskId set.
 *   - pm.status (4 values)    → projects.status — direct match (not-started /
 *                               in-progress / done / blocked).
 *   - pm.assignee (brad/diana/both) → assignees array (`['brad','diana']` for both).
 *   - pm.notes                → task.description (Projects has no notes field).
 *   - pm.createdAt YYYY-MM-DD → ISO timestamp by appending T00:00:00.000Z.
 *
 * Pure function — accepts a snapshot of `state.pmData`, returns the projects
 * and tasks to append. Idempotency is the runner's responsibility (a flag on
 * the projects root). Caller never mutates the input.
 */

const VALID_STATUSES = new Set(['not-started', 'in-progress', 'done', 'blocked']);

function nowIso() { return new Date().toISOString(); }

function makeProjectId() {
    return 'p_pm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function makeTaskId(suffix = '') {
    const tag = suffix ? `_${suffix}` : '';
    return 't_pm' + tag + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function trim(s) { return typeof s === 'string' ? s.trim() : ''; }

function mapAssignee(a) {
    if (a === 'brad' || a === 'diana') return [a];
    if (a === 'both') return ['brad', 'diana'];
    return [];
}

function mapStatus(s) {
    return VALID_STATUSES.has(s) ? s : 'not-started';
}

function isoFromDate(d) {
    const v = trim(d);
    if (!v) return null;
    // PM dates are YYYY-MM-DD; appending a fixed time keeps the round-trip
    // deterministic and avoids "createdAt was Date.now() so it sorts wrong".
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`;
    // Tolerate full timestamps already.
    return v;
}

function buildProject(name) {
    const at = nowIso();
    return {
        id: makeProjectId(),
        name,
        status: 'active',
        statusOverride: false,
        startDate: null,
        endDate: null,
        participants: ['brad', 'diana'],
        description: '',
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
    };
}

function buildTask(pmTask, projectId, parentTaskId = null) {
    const createdAt = isoFromDate(pmTask.createdAt) || nowIso();
    const status = mapStatus(pmTask.status);
    return {
        id: makeTaskId(),
        projectId,
        parentTaskId,
        name: trim(pmTask.name),
        description: trim(pmTask.notes),
        status,
        assignees: mapAssignee(pmTask.assignee),
        startDate: null,
        dueDate: null,
        priority: 'normal',
        dependsOn: [],
        comments: [],
        events: [],
        attachments: [],
        isMilestone: false,
        createdAt,
        updatedAt: createdAt,
        completedAt: status === 'done' ? createdAt : null,
    };
}

function buildSubtaskAsTask(subtask, parent, projectId) {
    const at = parent.createdAt;
    const status = subtask && subtask.done ? 'done' : 'not-started';
    return {
        id: makeTaskId('st'),
        projectId,
        parentTaskId: parent.id,
        name: trim(subtask && subtask.name),
        description: '',
        status,
        assignees: parent.assignees.slice(),
        startDate: null,
        dueDate: null,
        priority: 'normal',
        dependsOn: [],
        comments: [],
        events: [],
        attachments: [],
        isMilestone: false,
        createdAt: at,
        updatedAt: at,
        completedAt: status === 'done' ? at : null,
    };
}

/**
 * Convert a PM DLBooks snapshot into the projects-module shape. Returns
 * `{ projects: [...], tasks: [...] }` — the caller appends these to
 * `state.projectsData.items` / `.tasks`. Never mutates `pmData`.
 *
 * Empty buckets are silently skipped (an empty `macro` array doesn't produce
 * a "Macro Initiatives" project, and customers with no tasks still become
 * empty projects so the user can keep adding work there).
 */
export function migratePMDLBooksToProjects(pmData) {
    const out = { projects: [], tasks: [] };
    if (!pmData || typeof pmData !== 'object') return out;

    const macro = Array.isArray(pmData.macro) ? pmData.macro : [];
    if (macro.length > 0) {
        const proj = buildProject('Macro Initiatives');
        out.projects.push(proj);
        for (const m of macro) {
            if (!m || !trim(m.name)) continue;
            out.tasks.push(buildTask(m, proj.id, null));
        }
    }

    const customers = Array.isArray(pmData.customers) ? pmData.customers : [];
    for (const cust of customers) {
        if (!cust || !trim(cust.name)) continue;
        const proj = buildProject(`DLBooks — ${trim(cust.name)}`);
        out.projects.push(proj);
        const tasks = Array.isArray(cust.tasks) ? cust.tasks : [];
        for (const t of tasks) {
            if (!t || !trim(t.name)) continue;
            const parentTask = buildTask(t, proj.id, null);
            out.tasks.push(parentTask);
            const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
            for (const st of subs) {
                if (!st || !trim(st.name)) continue;
                out.tasks.push(buildSubtaskAsTask(st, parentTask, proj.id));
            }
        }
    }

    return out;
}
