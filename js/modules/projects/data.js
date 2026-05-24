/**
 * Projects module — data layer.
 *
 * Pure CRUD helpers + persistence wrapper. Storage: single Firebase RTDB key
 * `projects` (under `household/family/`) holding `{ items: [...] }`. Phase 6
 * will add `prefs` and `notifications` siblings under the same root.
 *
 * Pure functions (createProject, validateProject, list mutators, sanitiseProject)
 * are covered by data.test.js; persistence (loadProjects/saveProjects) is
 * verified manually via Firebase round-trip on the live site.
 */

import { fbSave } from '../../firebase-sync.js';
import { showToast } from '../../data.js';

export const PROJECTS_KEY = 'projects';
export const PROJECT_STATUSES = ['planning', 'active', 'on-hold', 'completed', 'cancelled'];
export const TASK_STATUSES = ['not-started', 'in-progress', 'review', 'done', 'blocked'];
export const TASK_PRIORITIES = ['low', 'normal', 'high'];
export const DEFAULT_PARTICIPANTS = ['brad', 'diana'];
export const DEFAULT_PROJECTS = {
    items: [],
    tasks: [],
    notifications: {},
    prefs: {},
    digest_pending: {},
    // Phase 8.1 idempotency flag — set true after the one-shot PM DLBooks
    // migration has appended its projects + tasks to this bucket.
    pm_dlbooks_migrated_to_projects: false,
    // v2.0.1 idempotency flag — set true after the one-shot SenseAi
    // "Business transformation & scale" project seed has been imported.
    business_transform_seeded: false,
    // v2.0.2 idempotency flag — set true after the one-shot delete of the
    // legacy `pm_dlbooks` Firebase + localStorage key. Only runs when the
    // Phase 8.1 migration has already completed (flag above is true).
    pm_dlbooks_cleaned: false,
};

const STATUS_SET = new Set(PROJECT_STATUSES);
const TASK_STATUS_SET = new Set(TASK_STATUSES);
const TASK_PRIORITY_SET = new Set(TASK_PRIORITIES);

function nowIso() { return new Date().toISOString(); }

function generateId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function generateTaskId() {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function generateCommentId() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function generateEventId() {
    return 'e_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function generateAttachmentId() {
    return 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function trim(s) {
    return typeof s === 'string' ? s.trim() : '';
}

/** Build a fresh project from form input. Caller should validate before save. */
export function createProject(input) {
    const inStatus = input && input.status;
    const inParticipants = input && input.participants;
    const inOverride = input && input.statusOverride;
    const at = nowIso();
    return {
        id: generateId(),
        name: trim(input && input.name),
        status: STATUS_SET.has(inStatus) ? inStatus : 'planning',
        statusOverride: inOverride === true,
        startDate: (input && input.startDate) || null,
        endDate: (input && input.endDate) || null,
        participants: Array.isArray(inParticipants) && inParticipants.length
            ? inParticipants.slice()
            : DEFAULT_PARTICIPANTS.slice(),
        description: trim(input && input.description),
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
    };
}

/**
 * Backfill defaults for projects loaded from storage. Future-proofs against
 * shape drift between schema versions without a migration script.
 *
 * `statusOverride` (PB.7): when missing on legacy records, default true for
 * non-derivable statuses (`on-hold`, `cancelled`) so we don't fight the user
 * by auto-flipping them to derived values; default false otherwise.
 */
export function sanitiseProject(p) {
    if (!p || typeof p !== 'object') return null;
    const at = nowIso();
    const status = STATUS_SET.has(p.status) ? p.status : 'planning';
    const explicitOverride = typeof p.statusOverride === 'boolean';
    const overrideDefault = (status === 'on-hold' || status === 'cancelled');
    return {
        id: p.id || generateId(),
        name: trim(p.name),
        status,
        statusOverride: explicitOverride ? p.statusOverride : overrideDefault,
        startDate: p.startDate || null,
        endDate: p.endDate || null,
        participants: Array.isArray(p.participants) && p.participants.length
            ? p.participants.slice()
            : DEFAULT_PARTICIPANTS.slice(),
        description: trim(p.description),
        createdAt: p.createdAt || at,
        updatedAt: p.updatedAt || at,
        archivedAt: p.archivedAt || null,
    };
}

/** Returns an error message or null if valid. */
export function validateProject(p) {
    if (!p || !trim(p.name)) return 'Name is required';
    if (!STATUS_SET.has(p.status)) return `Invalid status: ${p.status}`;
    if (typeof p.statusOverride !== 'boolean') return 'statusOverride must be a boolean';
    if (!Array.isArray(p.participants) || p.participants.length === 0) {
        return 'At least one participant is required';
    }
    if (p.startDate && p.endDate && p.endDate < p.startDate) {
        return 'End date must be on or after start date';
    }
    return null;
}

/**
 * Resolve the effective project status (PB.7).
 *
 * Override on → stored `status` wins (including non-derivable `on-hold` /
 * `cancelled`). Override off + no tasks → stored `status`. Otherwise derive
 * from task completion: 0 done → 'planning', all done → 'completed',
 * partial → 'active'. Caller is expected to pass the slice of tasks
 * belonging to this project.
 */
export function effectiveProjectStatus(project, tasks) {
    if (!project) return null;
    if (project.statusOverride) return project.status;
    if (!Array.isArray(tasks) || tasks.length === 0) return project.status;
    let done = 0;
    for (const t of tasks) if (t && t.status === 'done') done++;
    if (done === 0) return 'planning';
    if (done === tasks.length) return 'completed';
    return 'active';
}

// ── List mutators (return new arrays; never mutate input) ──

export function addProjectToList(list, project) {
    return list.concat([project]);
}

export function updateProjectInList(list, id, patch) {
    const idx = list.findIndex(p => p.id === id);
    if (idx < 0) return list;
    const updated = { ...list[idx], ...patch, id, updatedAt: nowIso() };
    const next = list.slice();
    next[idx] = updated;
    return next;
}

export function deleteProjectFromList(list, id) {
    return list.filter(p => p.id !== id);
}

export function findProject(list, id) {
    return list.find(p => p.id === id) || null;
}

// ── Task helpers ──

/** Build a fresh task. Caller should validate before save. */
export function createTask(input) {
    const inStatus = input && input.status;
    const inPriority = input && input.priority;
    const inAssignees = input && input.assignees;
    const inAssignee = input && input.assignee;
    // PB.9: stop writing the legacy `assignee` field. Backfill from it if a
    // caller still supplies the old single-string shape.
    const assignees = Array.isArray(inAssignees)
        ? inAssignees.slice()
        : (typeof inAssignee === 'string' && inAssignee ? [inAssignee] : []);
    const at = nowIso();
    return {
        id: generateTaskId(),
        projectId: (input && input.projectId) || null,
        name: trim(input && input.name),
        description: trim(input && input.description),
        status: TASK_STATUS_SET.has(inStatus) ? inStatus : 'not-started',
        assignees,
        startDate: (input && input.startDate) || null,
        dueDate: (input && input.dueDate) || null,
        priority: TASK_PRIORITY_SET.has(inPriority) ? inPriority : 'normal',
        parentTaskId: (input && input.parentTaskId) || null,
        dependsOn: Array.isArray(input && input.dependsOn) ? input.dependsOn.slice() : [],
        comments: Array.isArray(input && input.comments) ? input.comments.slice() : [],
        events: Array.isArray(input && input.events) ? input.events.slice() : [],
        attachments: Array.isArray(input && input.attachments) ? input.attachments.slice() : [],
        isMilestone: (input && input.isMilestone) === true,
        createdAt: at,
        updatedAt: at,
        completedAt: null,
    };
}

/**
 * Canonical reader for a task's assignees (PB.9). Returns the `assignees`
 * array if present and non-empty; otherwise backfills from the legacy
 * single-string `assignee` field; otherwise returns `[]`. Safe on null /
 * undefined / unknown shape.
 */
export function readAssignees(task) {
    if (!task) return [];
    if (Array.isArray(task.assignees) && task.assignees.length > 0) return task.assignees;
    if (typeof task.assignee === 'string' && task.assignee) return [task.assignee];
    return [];
}

export function sanitiseTask(t) {
    if (!t || typeof t !== 'object') return null;
    const at = nowIso();
    // PB.9: prefer non-empty assignees array; otherwise backfill from the
    // legacy assignee string; otherwise empty. Drop the legacy field on
    // output so storage normalises to assignees-only after first load.
    const existing = Array.isArray(t.assignees) ? t.assignees.slice() : null;
    const assignees = existing && existing.length > 0
        ? existing
        : (typeof t.assignee === 'string' && t.assignee ? [t.assignee] : []);
    return {
        id: t.id || generateTaskId(),
        projectId: t.projectId || null,
        name: trim(t.name),
        description: trim(t.description),
        status: TASK_STATUS_SET.has(t.status) ? t.status : 'not-started',
        assignees,
        startDate: t.startDate || null,
        dueDate: t.dueDate || null,
        priority: TASK_PRIORITY_SET.has(t.priority) ? t.priority : 'normal',
        parentTaskId: t.parentTaskId || null,
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.slice() : [],
        comments: Array.isArray(t.comments) ? t.comments.slice() : [],
        events: Array.isArray(t.events) ? t.events.slice() : [],
        attachments: Array.isArray(t.attachments) ? t.attachments.slice() : [],
        isMilestone: t.isMilestone === true,
        createdAt: t.createdAt || at,
        updatedAt: t.updatedAt || at,
        completedAt: t.completedAt || null,
    };
}

export function validateTask(t) {
    if (!t || !trim(t.name)) return 'Name is required';
    if (!t.projectId) return 'projectId is required';
    if (!TASK_STATUS_SET.has(t.status)) return `Invalid status: ${t.status}`;
    if (!TASK_PRIORITY_SET.has(t.priority)) return `Invalid priority: ${t.priority}`;
    if (!Array.isArray(t.assignees)) return 'assignees must be an array';
    for (const a of t.assignees) {
        if (typeof a !== 'string' || !a) return 'assignees must contain non-empty strings';
    }
    if (t.startDate && t.dueDate && t.dueDate < t.startDate) {
        return 'Due date must be on or after start date';
    }
    return null;
}

export function addTaskToList(list, task) {
    return list.concat([task]);
}

/**
 * Patch a task by id. Bumps `updatedAt`. If the patch sets `status` to 'done'
 * and the task wasn't already done, stamp `completedAt`; if it transitions
 * away from 'done', clear `completedAt`.
 */
export function updateTaskInList(list, id, patch) {
    const idx = list.findIndex(t => t.id === id);
    if (idx < 0) return list;
    const prev = list[idx];
    const merged = { ...prev, ...patch, id, updatedAt: nowIso() };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'status')) {
        if (patch.status === 'done' && prev.status !== 'done') {
            merged.completedAt = nowIso();
        } else if (patch.status !== 'done' && prev.status === 'done') {
            merged.completedAt = null;
        }
    }
    const next = list.slice();
    next[idx] = merged;
    return next;
}

export function deleteTaskFromList(list, id) {
    return list.filter(t => t.id !== id);
}

export function findTask(list, id) {
    return list.find(t => t.id === id) || null;
}

export function findTasksByProject(list, projectId) {
    return list.filter(t => t.projectId === projectId);
}

// ── Subtasks (Task 2.2) ──

/** Tasks whose `parentTaskId` matches the given id. Order preserved from input. */
export function findSubtasks(list, parentId) {
    if (!parentId) return [];
    return list.filter(t => t.parentTaskId === parentId);
}

/**
 * Set `parentTaskId = null` on every child of `parentId`, promoting them to
 * top-level. Returns same ref if there are no children (so callers can avoid
 * a redundant Firebase save).
 */
export function promoteSubtasksInList(list, parentId) {
    const at = nowIso();
    let touched = false;
    const next = list.map(t => {
        if (t.parentTaskId === parentId) {
            touched = true;
            return { ...t, parentTaskId: null, updatedAt: at };
        }
        return t;
    });
    return touched ? next : list;
}

/** Remove a task and any of its children. One-level model so no recursion. */
export function deleteTaskCascadeFromList(list, taskId) {
    return list.filter(t => t.id !== taskId && t.parentTaskId !== taskId);
}

// ── Dependencies (Task 3.1) ──

/**
 * Returns true if adding `candidateDepId` to `taskId.dependsOn[]` would form
 * a cycle in the directed graph of `dependsOn` edges. Self-deps are cycles.
 * Missing tasks are treated as leaves (so referencing a deleted prerequisite
 * is harmless rather than a phantom cycle).
 */
export function wouldCreateCycle(list, taskId, candidateDepId) {
    if (!taskId || !candidateDepId) return false;
    if (taskId === candidateDepId) return true;
    // A new edge taskId -> candidateDepId is a cycle iff candidateDepId can
    // already reach taskId via existing edges. DFS from candidateDepId.
    const byId = new Map(list.map(t => [t.id, t]));
    const seen = new Set();
    const stack = [candidateDepId];
    while (stack.length) {
        const id = stack.pop();
        if (id === taskId) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        const node = byId.get(id);
        if (!node || !Array.isArray(node.dependsOn)) continue;
        for (const next of node.dependsOn) stack.push(next);
    }
    return false;
}

/**
 * Add `depId` to `taskId.dependsOn[]`. Returns same list ref when:
 *   - taskId not found
 *   - depId is the same as taskId (self-dep)
 *   - depId is already in dependsOn
 *   - adding it would create a cycle
 * Otherwise returns a new list with the dep appended and updatedAt bumped.
 */
export function addDependency(list, taskId, depId) {
    const idx = list.findIndex(t => t.id === taskId);
    if (idx < 0) return list;
    if (!depId || depId === taskId) return list;
    const task = list[idx];
    const existing = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    if (existing.includes(depId)) return list;
    if (wouldCreateCycle(list, taskId, depId)) return list;
    const next = list.slice();
    next[idx] = { ...task, dependsOn: existing.concat([depId]), updatedAt: nowIso() };
    return next;
}

/** Remove `depId` from `taskId.dependsOn[]`. Same-ref no-op when absent. */
export function removeDependency(list, taskId, depId) {
    const idx = list.findIndex(t => t.id === taskId);
    if (idx < 0) return list;
    const task = list[idx];
    const existing = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    if (!existing.includes(depId)) return list;
    const next = list.slice();
    next[idx] = { ...task, dependsOn: existing.filter(d => d !== depId), updatedAt: nowIso() };
    return next;
}

/**
 * Number of unmet prerequisites for `task`. A dep is "unmet" when the
 * referenced task exists in `list` and its status is not 'done'. Deleted
 * prerequisites (id no longer in list) are skipped, not counted as blocking.
 */
export function countBlockingDeps(list, task) {
    if (!task || !Array.isArray(task.dependsOn) || task.dependsOn.length === 0) return 0;
    const byId = new Map(list.map(t => [t.id, t]));
    let n = 0;
    for (const depId of task.dependsOn) {
        const dep = byId.get(depId);
        if (dep && dep.status !== 'done') n++;
    }
    return n;
}

// ── Comments (Task 3.2) ──

/**
 * Build a fresh comment. Append-only — there is intentionally no
 * updateComment / deleteComment helper; comments are part of the audit trail.
 * Empty/whitespace-only authors fall back to 'anonymous' so the UI can pass
 * the current user's email straight through without null-checking.
 */
export function createComment(input) {
    const author = trim(input && input.author);
    return {
        id: generateCommentId(),
        author: author || 'anonymous',
        text: trim(input && input.text),
        createdAt: nowIso(),
    };
}

/**
 * Append `comment` to `taskId.comments[]`. Returns same list ref when the
 * task isn't found so callers can avoid a redundant Firebase save. Bumps
 * the task's `updatedAt` because the comment thread is part of the task.
 */
export function addCommentToTask(list, taskId, comment) {
    const idx = list.findIndex(t => t.id === taskId);
    if (idx < 0) return list;
    const task = list[idx];
    const existing = Array.isArray(task.comments) ? task.comments : [];
    const next = list.slice();
    next[idx] = { ...task, comments: existing.concat([comment]), updatedAt: nowIso() };
    return next;
}

// ── Activity / audit-trail (Task 3.3) ──

/**
 * Map of scalar task field → event kind. Per plan §3.3 we log status and
 * dueDate changes here; assignee changes are array-shaped and handled
 * separately in taskPatchEvents (PB.9). Dependency add/remove have their
 * own helpers because they're list deltas, not field overwrites.
 * Untracked fields (name, description, priority, startDate) intentionally
 * don't generate events to keep the feed focused on user-meaningful changes.
 */
const TRACKED_FIELD_EVENT_KINDS = {
    status: 'status_changed',
    dueDate: 'due_date_changed',
};

/**
 * Build a fresh audit event. Like createComment, blank `by` falls back to
 * `'anonymous'` so the UI can pass the current user's email straight through.
 */
export function createEvent(input) {
    const by = trim(input && input.by);
    const before = (input && Object.prototype.hasOwnProperty.call(input, 'before')) ? input.before : null;
    const after = (input && Object.prototype.hasOwnProperty.call(input, 'after')) ? input.after : null;
    return {
        id: generateEventId(),
        kind: (input && input.kind) || 'unknown',
        by: by || 'anonymous',
        at: nowIso(),
        before: before == null ? null : before,
        after: after == null ? null : after,
    };
}

/**
 * Append `event` to `taskId.events[]`. Same-ref no-op when the task isn't
 * found. Bumps `updatedAt` because the activity feed is part of the task.
 */
export function addEventToTask(list, taskId, event) {
    const idx = list.findIndex(t => t.id === taskId);
    if (idx < 0) return list;
    const task = list[idx];
    const existing = Array.isArray(task.events) ? task.events : [];
    const next = list.slice();
    next[idx] = { ...task, events: existing.concat([event]), updatedAt: nowIso() };
    return next;
}

/**
 * Diff `prev` against `patch` over the audit-tracked fields and return one
 * event per actual change. Empty array for untracked fields, no-op patches,
 * or null inputs. Caller appends each via `addEventToTask`.
 *
 * Scalar fields (status, dueDate) compare with ===. Assignees (PB.9) is an
 * array — handled separately: if the patch touches assignees (new shape) or
 * assignee (legacy), we read both sides via readAssignees and emit an event
 * with array payloads when the sorted sets differ.
 */
export function taskPatchEvents(prev, patch, by) {
    if (!prev || !patch) return [];
    const events = [];
    for (const [field, kind] of Object.entries(TRACKED_FIELD_EVENT_KINDS)) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
        const before = prev[field] == null ? null : prev[field];
        const after = patch[field] == null ? null : patch[field];
        if (before === after) continue;
        events.push(createEvent({ kind, by, before, after }));
    }
    const patchTouchesAssignees = Object.prototype.hasOwnProperty.call(patch, 'assignees')
        || Object.prototype.hasOwnProperty.call(patch, 'assignee');
    if (patchTouchesAssignees) {
        const before = readAssignees(prev);
        const after = readAssignees({ ...prev, ...patch });
        const beforeKey = before.slice().sort().join(',');
        const afterKey = after.slice().sort().join(',');
        if (beforeKey !== afterKey) {
            events.push(createEvent({ kind: 'assignee_changed', by, before, after }));
        }
    }
    return events;
}

// ── Attachments (Task 3.4) ──

/**
 * Hard limit for inline (base64-encoded) files. Per plan §3.4: "drag-drop
 * or file-picker for files ≤500 KB". Anything bigger should be added as a
 * URL reference instead — Firebase RTDB row sizes get unworkable past this
 * point even for a single attachment, let alone several per task.
 */
export const MAX_INLINE_ATTACHMENT_SIZE = 500 * 1024;

/** Soft warning threshold for cumulative inline-file bytes per task. */
export const TASK_ATTACHMENT_WARN_SIZE = 1024 * 1024;

/** Human-readable byte formatting shared by error messages and the UI. */
export function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** Build an inline (base64) file attachment. Caller should validate first. */
export function createFileAttachment(input) {
    const addedBy = trim(input && input.addedBy);
    return {
        id: generateAttachmentId(),
        kind: 'file',
        name: trim(input && input.name),
        size: (input && Number.isFinite(input.size)) ? input.size : 0,
        type: trim(input && input.type),
        dataUri: (input && input.dataUri) || '',
        addedBy: addedBy || 'anonymous',
        addedAt: nowIso(),
    };
}

/** Build a URL-reference attachment. Caller should validate first. */
export function createUrlAttachment(input) {
    const addedBy = trim(input && input.addedBy);
    return {
        id: generateAttachmentId(),
        kind: 'url',
        name: trim(input && input.name),
        url: trim(input && input.url),
        addedBy: addedBy || 'anonymous',
        addedAt: nowIso(),
    };
}

export function validateFileAttachment(input) {
    if (!input || !trim(input.name)) return 'File name is required';
    if (!Number.isFinite(input.size) || input.size <= 0) return 'File size must be greater than zero';
    if (input.size > MAX_INLINE_ATTACHMENT_SIZE) {
        return `File too large — limit is ${formatBytes(MAX_INLINE_ATTACHMENT_SIZE)}, this one is ${formatBytes(input.size)}.`;
    }
    if (!trim(input.dataUri)) return 'File data is missing';
    return null;
}

export function validateUrlAttachment(input) {
    if (!input || !trim(input.name)) return 'Title is required';
    const url = trim(input && input.url);
    if (!url) return 'URL is required';
    if (!/^https?:\/\//i.test(url)) return 'URL must start with http:// or https://';
    return null;
}

export function addAttachmentToTask(list, taskId, attachment) {
    const idx = list.findIndex(t => t.id === taskId);
    if (idx < 0) return list;
    const task = list[idx];
    const existing = Array.isArray(task.attachments) ? task.attachments : [];
    const next = list.slice();
    next[idx] = { ...task, attachments: existing.concat([attachment]), updatedAt: nowIso() };
    return next;
}

export function removeAttachmentFromTask(list, taskId, attachmentId) {
    const idx = list.findIndex(t => t.id === taskId);
    if (idx < 0) return list;
    const task = list[idx];
    const existing = Array.isArray(task.attachments) ? task.attachments : [];
    if (!existing.some(a => a.id === attachmentId)) return list;
    const next = list.slice();
    next[idx] = {
        ...task,
        attachments: existing.filter(a => a.id !== attachmentId),
        updatedAt: nowIso(),
    };
    return next;
}

/** Sum of inline-file `size` bytes on a task. URL refs contribute nothing. */
export function taskAttachmentSize(task) {
    if (!task || !Array.isArray(task.attachments)) return 0;
    let total = 0;
    for (const a of task.attachments) {
        if (a && a.kind === 'file' && Number.isFinite(a.size)) total += a.size;
    }
    return total;
}

// ── Sort / filter / group (Task 4.1) ──

/**
 * Fields the list view supports sorting by. Order matters — first entry is
 * the default. The UI renders these in the same order in its dropdown.
 */
export const TASK_SORT_FIELDS = ['dueDate', 'name', 'priority'];

/** Group-by options surfaced in the list view. */
export const TASK_GROUP_OPTIONS = ['none', 'status', 'assignee'];

/**
 * PB.8 — drillable Dashboard cards. Each key is the metric on the card; each
 * value is the `dashboardView` enum filterTasks understands. The non-drillable
 * `activeProjects` card is deliberately absent (Resolved Decision 1).
 */
export const DASHBOARD_CARD_VIEWS = {
    openTasks: 'open',
    overdueTasks: 'overdue',
    dueThisWeek: 'dueThisWeek',
    completedLast30Days: 'completedLast30Days',
    upcomingMilestones: 'upcomingMilestones',
};

export const DASHBOARD_VIEWS = Object.values(DASHBOARD_CARD_VIEWS);
const DASHBOARD_VIEW_SET = new Set(DASHBOARD_VIEWS);

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

/**
 * Resolve a dashboardView enum to a per-task predicate. Returns null for an
 * unknown view so callers can skip the dimension. `today` is a YYYY-MM-DD
 * string used for date-window arithmetic; window edges match
 * computeDashboardMetrics so card counts and filtered list counts agree.
 */
function dashboardViewPredicate(view, today) {
    if (!DASHBOARD_VIEW_SET.has(view)) return null;
    const weekEnd = today ? addDaysIso(today, 6) : null;
    const milestoneEnd = today ? addDaysIso(today, 13) : null;
    const thirtyDaysAgo = today ? addDaysIso(today, -30) : null;
    switch (view) {
        case 'open':
            return (t) => t.status !== 'done';
        case 'overdue':
            return (t) => t.status !== 'done' && t.dueDate && today && t.dueDate < today;
        case 'dueThisWeek':
            return (t) => t.status !== 'done' && t.dueDate && today
                && t.dueDate >= today && t.dueDate <= weekEnd;
        case 'completedLast30Days':
            return (t) => {
                if (t.status !== 'done') return false;
                if (!t.completedAt || !today || !thirtyDaysAgo) return false;
                const cd = isoDatePart(t.completedAt);
                return cd && cd >= thirtyDaysAgo && cd <= today;
            };
        case 'upcomingMilestones':
            return (t) => t.isMilestone === true && t.status !== 'done'
                && t.dueDate && today && t.dueDate >= today && t.dueDate <= milestoneEnd;
        default:
            return null;
    }
}

/**
 * Pure sort: returns a new array. Tasks with no `dueDate` always sort to the
 * end regardless of direction (predictable display rather than flipping when
 * the user clicks desc). `createdAt` is the universal tiebreaker so equal
 * sort-keys still produce a stable, deterministic order.
 */
export function sortTasks(tasks, opts) {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    const by = opts && TASK_SORT_FIELDS.includes(opts.by) ? opts.by : 'dueDate';
    const sign = opts && opts.dir === 'desc' ? -1 : 1;
    const tiebreak = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');

    const cmp = (a, b) => {
        let primary = 0;
        if (by === 'name') {
            primary = sign * (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        } else if (by === 'priority') {
            const ao = Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, a.priority) ? PRIORITY_ORDER[a.priority] : 1;
            const bo = Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, b.priority) ? PRIORITY_ORDER[b.priority] : 1;
            primary = sign * (ao - bo);
        } else {
            const aMissing = !a.dueDate;
            const bMissing = !b.dueDate;
            if (aMissing && !bMissing) return 1;
            if (!aMissing && bMissing) return -1;
            if (!aMissing && !bMissing) primary = sign * a.dueDate.localeCompare(b.dueDate);
        }
        return primary !== 0 ? primary : tiebreak(a, b);
    };
    return tasks.slice().sort(cmp);
}

/**
 * Apply assignee / status / milestonesOnly filters with AND semantics. A task
 * passes if it directly matches every active filter. A non-matching parent is
 * still included when one of its subtasks matches, so the indented list-view
 * render isn't left with an orphaned subtask. Subtasks of a parent that's
 * only present as scaffolding are NOT auto-included — each task is judged on
 * its own merits.
 *
 * `null` / `undefined` filter values mean "no filter on that dimension".
 */
export function filterTasks(list, filters) {
    if (!Array.isArray(list)) return [];
    const f = filters || {};
    const hasAssignee = f.assignee != null;
    const hasStatus = f.status != null;
    const hasMilestone = !!f.milestonesOnly;
    // PB.8: dashboardView is a date-aware predicate set chosen by the
    // Dashboard card click. `today` defaults to the current date for live UI;
    // tests pass an explicit value for determinism.
    const today = f.today || new Date().toISOString().slice(0, 10);
    const viewPredicate = f.dashboardView ? dashboardViewPredicate(f.dashboardView, today) : null;
    if (!hasAssignee && !hasStatus && !hasMilestone && !viewPredicate) return list.slice();

    const passes = (t) => {
        // PB.9: intersection semantics — selecting "brad" includes joint tasks
        // where brad is one of multiple assignees. Legacy single-assignee tasks
        // still match via readAssignees' backfill from the old field.
        if (hasAssignee && !readAssignees(t).includes(f.assignee)) return false;
        if (hasStatus && t.status !== f.status) return false;
        if (hasMilestone && !t.isMilestone) return false;
        if (viewPredicate && !viewPredicate(t)) return false;
        return true;
    };

    const matched = new Set();
    for (const t of list) if (passes(t)) matched.add(t.id);

    // PB.8: dashboard drill needs a flat predicate filter so list-row count
    // matches the headline card count. `flat: true` skips the scaffold-keep.
    if (f.flat) return list.filter(t => matched.has(t.id));

    const scaffolded = new Set();
    for (const t of list) {
        if (matched.has(t.id) && t.parentTaskId) scaffolded.add(t.parentTaskId);
    }
    return list.filter(t => matched.has(t.id) || scaffolded.has(t.id));
}

/**
 * Bucket top-level tasks for the list-view group-by toggle.
 *
 * - `none`: single bucket containing every task in input order.
 * - `status`: buckets in canonical TASK_STATUSES order; empty buckets dropped.
 * - `assignee`: brad → diana → other participants alphabetically → unassigned
 *   (key = ''). Empty input always yields an empty array.
 *
 * Caller is expected to pass the already-filtered top-level slice. Subtasks
 * are not bucketed here — the render layer interleaves them under their
 * parent within whatever group their parent landed in.
 */
export function groupTopLevelTasks(list, by) {
    if (!Array.isArray(list) || list.length === 0) return [];
    if (by === 'status') {
        const buckets = new Map(TASK_STATUSES.map(s => [s, []]));
        for (const t of list) {
            if (buckets.has(t.status)) buckets.get(t.status).push(t);
        }
        return TASK_STATUSES
            .filter(s => buckets.get(s).length > 0)
            .map(s => ({ key: s, tasks: buckets.get(s) }));
    }
    if (by === 'assignee') {
        // PB.9: bucket key is the sorted-comma-joined assignees list, so joint
        // tasks land in their own bucket (e.g. "brad,diana") rather than
        // appearing under each individual. Empty assignees → "" (unassigned).
        const buckets = new Map();
        for (const t of list) {
            const k = readAssignees(t).slice().sort().join(',');
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(t);
        }
        const order = [];
        // 1. Default participants individually (brad, then diana).
        for (const id of DEFAULT_PARTICIPANTS) if (buckets.has(id)) order.push(id);
        // 2. Canonical joint pair (brad,diana under the current defaults).
        const jointKey = DEFAULT_PARTICIPANTS.slice().sort().join(',');
        if (buckets.has(jointKey) && jointKey !== '' && !order.includes(jointKey)) {
            order.push(jointKey);
        }
        const placed = new Set(order);
        const remaining = Array.from(buckets.keys()).filter(k => k !== '' && !placed.has(k));
        // 3. Other single-IDs (no comma) alphabetically.
        const singleOthers = remaining.filter(k => !k.includes(',')).sort();
        // 4. Other multi-IDs alphabetically.
        const multiOthers = remaining.filter(k => k.includes(',')).sort();
        order.push(...singleOthers, ...multiOthers);
        // 5. Unassigned last.
        if (buckets.has('')) order.push('');
        return order.map(k => ({ key: k, tasks: buckets.get(k) }));
    }
    return [{ key: 'all', tasks: list.slice() }];
}

// ── Timeline / Gantt geometry (Task 4.2) ──

const ONE_DAY_MS = 86400000;

function parseISODate(s) {
    if (!s || typeof s !== 'string') return NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function formatISODate(ms) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function taskDateBounds(t) {
    const sMs = parseISODate(t && t.startDate);
    const eMs = parseISODate(t && t.dueDate);
    const lo = !Number.isNaN(sMs) ? sMs : eMs;
    const hi = !Number.isNaN(eMs) ? eMs : sMs;
    if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
    return { lo, hi };
}

/**
 * Compute the date axis for the timeline view.
 *
 * - Range expands to `min(startDate)` − 14 days … `max(dueDate)` + 14 days,
 *   then snaps to month start/end so the axis aligns to month gridlines.
 * - Tasks with only `startDate` or only `dueDate` are treated as a 1-day span.
 * - Returns `null` when no task has any usable date — caller renders an
 *   empty-state message.
 *
 * `months` is precomputed (one entry per calendar month in the range) with
 * percentage offsets so the renderer just maps over it.
 */
export function computeTimelineRange(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) return null;
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const t of tasks) {
        const b = taskDateBounds(t);
        if (!b) continue;
        if (b.lo < minMs) minMs = b.lo;
        if (b.hi > maxMs) maxMs = b.hi;
    }
    if (minMs === Infinity || maxMs === -Infinity) return null;

    const lo = new Date(minMs - 14 * ONE_DAY_MS);
    const startMs = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1);
    const hi = new Date(maxMs + 14 * ONE_DAY_MS);
    // day 0 of next month = last day of `this` month
    const endMs = Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth() + 1, 0);

    const totalDays = Math.round((endMs - startMs) / ONE_DAY_MS) + 1;

    const months = [];
    let cursor = new Date(startMs);
    while (Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1) <= endMs) {
        const y = cursor.getUTCFullYear();
        const m = cursor.getUTCMonth() + 1;
        const firstOfMonth = Date.UTC(y, m - 1, 1);
        const lastOfMonth = Date.UTC(y, m, 0);
        const daysInMonth = Math.round((lastOfMonth - firstOfMonth) / ONE_DAY_MS) + 1;
        const offsetDays = Math.round((firstOfMonth - startMs) / ONE_DAY_MS);
        months.push({
            year: y,
            month: m,
            label: new Date(firstOfMonth).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
            daysInMonth,
            leftPct: (offsetDays / totalDays) * 100,
            widthPct: (daysInMonth / totalDays) * 100,
        });
        cursor = new Date(Date.UTC(y, m, 1));
    }

    return {
        startDate: formatISODate(startMs),
        endDate: formatISODate(endMs),
        startMs,
        endMs,
        totalDays,
        months,
    };
}

/**
 * Project tasks onto a precomputed range. Tasks with no usable date are
 * dropped (the timeline view will surface them in a separate "unscheduled"
 * count). Tasks with only one date become a 1-day bar.
 *
 * Returned bars carry a reference to the source task so the click-to-open
 * handler can dispatch without a second lookup.
 */
export function computeTaskBars(tasks, range) {
    if (!range || !Array.isArray(tasks)) return [];
    const out = [];
    for (const t of tasks) {
        const b = taskDateBounds(t);
        if (!b) continue;
        const days = Math.round((b.hi - b.lo) / ONE_DAY_MS) + 1;
        const offsetDays = Math.round((b.lo - range.startMs) / ONE_DAY_MS);
        out.push({
            id: t.id,
            name: t.name,
            status: t.status,
            assignee: t.assignee,
            isMilestone: t.isMilestone === true,
            parentTaskId: t.parentTaskId || null,
            startDate: t.startDate || t.dueDate,
            dueDate: t.dueDate || t.startDate,
            days,
            leftPct: (offsetDays / range.totalDays) * 100,
            widthPct: (days / range.totalDays) * 100,
            task: t,
        });
    }
    return out;
}

// ── Calendar grid + per-date task buckets (Task 4.3) ──

/**
 * Build a 7-column month grid with Monday-first weeks. Returns a flat array
 * of cells (multiple of 7) covering the requested month plus leading/trailing
 * pad days from the surrounding months so every row is full.
 *
 * Each cell: { date: 'YYYY-MM-DD', day, inMonth, isToday, weekday (0=Mon..6=Sun) }.
 */
export function getMonthGridCells(year, month, todayIso = null) {
    const firstMs = Date.UTC(year, month - 1, 1);
    // getUTCDay() returns 0=Sun..6=Sat; convert so Mon=0..Sun=6.
    const firstWeekdayMon = (new Date(firstMs).getUTCDay() + 6) % 7;
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const startMs = firstMs - firstWeekdayMon * ONE_DAY_MS;
    const totalDaysIncLead = firstWeekdayMon + lastDayOfMonth;
    const trailingPad = (7 - (totalDaysIncLead % 7)) % 7;
    const cellCount = totalDaysIncLead + trailingPad;

    const cells = [];
    for (let i = 0; i < cellCount; i++) {
        const d = new Date(startMs + i * ONE_DAY_MS);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const dateIso = `${yyyy}-${mm}-${dd}`;
        cells.push({
            date: dateIso,
            day: d.getUTCDate(),
            inMonth: d.getUTCMonth() + 1 === month && d.getUTCFullYear() === year,
            isToday: todayIso ? dateIso === todayIso : false,
            weekday: i % 7,
        });
    }
    return cells;
}

/**
 * Group tasks onto calendar dates for the month-grid view.
 *
 * - Multi-day task (`startDate < dueDate`): emits a `due` pill on `dueDate`
 *   and a `start` (dimmer) pill on `startDate`.
 * - Single-day task (start == due, OR only one date set): emits a single
 *   `due` pill on whichever date is present.
 * - Tasks with no dates are excluded.
 *
 * Returns Map<dateIso, Array<{ task, kind }>>. Insertion-order iteration
 * matches input task order so callers can render predictably.
 */
export function bucketCalendarTasks(tasks) {
    const byDate = new Map();
    if (!Array.isArray(tasks)) return byDate;
    const push = (date, entry) => {
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push(entry);
    };
    for (const t of tasks) {
        const s = t && t.startDate;
        const d = t && t.dueDate;
        if (d) {
            push(d, { task: t, kind: 'due' });
            if (s && s !== d) push(s, { task: t, kind: 'start' });
        } else if (s) {
            push(s, { task: t, kind: 'due' });
        }
    }
    return byDate;
}

// ── Cross-project Overview helpers (Task 5.1) ──

/** Sort dimensions surfaced in the Overview toolbar; first entry is the default. */
export const OVERVIEW_SORT_OPTIONS = ['updated', 'status', 'dueDate', 'percent'];

const PROJECT_STATUS_ORDER = Object.fromEntries(
    PROJECT_STATUSES.map((s, i) => [s, i])
);

/**
 * Done-vs-total task counts for one project. Subtasks count toward both — the
 * Overview card shows a single % across the full task tree. Empty projects
 * report `percent: 0` so the UI can render "0%" rather than NaN.
 */
export function computeProjectProgress(projectId, tasks) {
    if (!projectId || !Array.isArray(tasks) || tasks.length === 0) {
        return { done: 0, total: 0, percent: 0 };
    }
    let total = 0;
    let done = 0;
    for (const t of tasks) {
        if (t.projectId !== projectId) continue;
        total++;
        if (t.status === 'done') done++;
    }
    if (total === 0) return { done: 0, total: 0, percent: 0 };
    return { done, total, percent: Math.round((done / total) * 100) };
}

/** Tasks with `dueDate < todayIso` and `status !== 'done'`, scoped to project. */
export function countOverdueTasks(projectId, tasks, todayIso) {
    if (!projectId || !Array.isArray(tasks) || !todayIso) return 0;
    let n = 0;
    for (const t of tasks) {
        if (t.projectId !== projectId) continue;
        if (t.status === 'done') continue;
        if (!t.dueDate) continue;
        if (t.dueDate < todayIso) n++;
    }
    return n;
}

/**
 * Earliest non-done milestone with a `dueDate` for this project. Prefers the
 * next upcoming milestone (dueDate >= today); falls back to the earliest past
 * milestone if every milestone is overdue. Milestones without a dueDate are
 * skipped — there's nothing meaningful to show without a date. Returns null
 * when no eligible milestone exists.
 */
export function findNextMilestone(projectId, tasks, todayIso) {
    if (!projectId || !Array.isArray(tasks)) return null;
    const eligible = tasks.filter(t =>
        t.projectId === projectId &&
        t.isMilestone === true &&
        t.status !== 'done' &&
        t.dueDate
    );
    if (eligible.length === 0) return null;
    const upcoming = eligible
        .filter(t => !todayIso || t.dueDate >= todayIso)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (upcoming.length > 0) return upcoming[0];
    return eligible.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
}

/**
 * Sort projects for the Overview grid. Returns a new array; never mutates.
 *
 *   - `updated` (default): newest `updatedAt` first.
 *   - `status`: canonical PROJECT_STATUSES order (planning → … → cancelled).
 *   - `dueDate`: project `endDate` ascending; missing endDate sorts to end.
 *   - `percent`: completion % descending; empty projects (no tasks) sort to
 *      end so they don't masquerade as "0% done".
 *
 * `name` is the universal tiebreaker so equal sort-keys still produce a
 * stable, deterministic order.
 */
export function sortProjectsForOverview(projects, tasks, opts) {
    if (!Array.isArray(projects) || projects.length === 0) return [];
    const by = opts && OVERVIEW_SORT_OPTIONS.includes(opts.by) ? opts.by : 'updated';
    const tiebreak = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });

    const cmp = (a, b) => {
        let primary = 0;
        if (by === 'status') {
            const ao = Object.prototype.hasOwnProperty.call(PROJECT_STATUS_ORDER, a.status) ? PROJECT_STATUS_ORDER[a.status] : PROJECT_STATUSES.length;
            const bo = Object.prototype.hasOwnProperty.call(PROJECT_STATUS_ORDER, b.status) ? PROJECT_STATUS_ORDER[b.status] : PROJECT_STATUSES.length;
            primary = ao - bo;
        } else if (by === 'dueDate') {
            const aMissing = !a.endDate;
            const bMissing = !b.endDate;
            if (aMissing && !bMissing) return 1;
            if (!aMissing && bMissing) return -1;
            if (!aMissing && !bMissing) primary = a.endDate.localeCompare(b.endDate);
        } else if (by === 'percent') {
            const ap = computeProjectProgress(a.id, tasks || []);
            const bp = computeProjectProgress(b.id, tasks || []);
            // Empty projects (total == 0) sort to end regardless of direction.
            if (ap.total === 0 && bp.total > 0) return 1;
            if (bp.total === 0 && ap.total > 0) return -1;
            if (ap.total === 0 && bp.total === 0) primary = 0;
            else primary = bp.percent - ap.percent; // desc
        } else {
            // updated, desc
            primary = (b.updatedAt || '').localeCompare(a.updatedAt || '');
        }
        return primary !== 0 ? primary : tiebreak(a, b);
    };
    return projects.slice().sort(cmp);
}

// ── My Tasks per-user summary helpers (Task 5.2) ──

/**
 * Maps a Firebase auth email to the corresponding `assignee` key used in tasks.
 * Falls back to 'brad' for empty / unknown emails so the My Tasks view always
 * has a sensible default user even before Google sign-in has resolved.
 */
const EMAIL_TO_USER = {
    'metalbee66@gmail.com': 'brad',
    'dianaleshcheva@gmail.com': 'diana',
};
export function defaultMyTasksUser(email) {
    if (email && EMAIL_TO_USER[email]) return EMAIL_TO_USER[email];
    return 'brad';
}

/**
 * Strict email → participant id resolver. Returns null for unknown / empty
 * emails. Use this when you need to compare an actor (event.by, comment author)
 * to a participant id — defaultMyTasksUser's "fallback to brad" is wrong for
 * that check because it would silently match brad against any unknown email.
 */
export function emailToParticipantId(email) {
    if (!email) return null;
    return EMAIL_TO_USER[email] || null;
}

/**
 * Built-in participant id → inbox address. Inverse of EMAIL_TO_USER. Returns
 * null for unknown ids (external assignees aren't on file), letting callers
 * cleanly skip enqueueing email for participants without a contact.
 */
const USER_TO_EMAIL = Object.freeze(Object.fromEntries(
    Object.entries(EMAIL_TO_USER).map(([email, id]) => [id, email])
));
export function participantEmail(participantId) {
    if (!participantId) return null;
    return USER_TO_EMAIL[participantId] || null;
}

/**
 * Participant ids allowed to see the Email-queue admin sub-tab (Task 6.5).
 * Hard-coded — the app has exactly two real users, so a runtime config would
 * be overkill. To grant Diana access, append 'diana' here.
 */
export const ADMIN_USER_IDS = Object.freeze(['brad']);
const ADMIN_USER_SET = new Set(ADMIN_USER_IDS);
export function isAdminUser(participantId) {
    if (!participantId) return false;
    return ADMIN_USER_SET.has(participantId);
}

/**
 * Selectable users for the My Tasks view: brad and diana always come first
 * (in canonical order), then any external assignees seen in the task list,
 * sorted alphabetically and deduped.
 */
export function collectMyTasksUserOptions(tasks) {
    const builtIn = DEFAULT_PARTICIPANTS.slice();
    const seen = new Set(builtIn);
    const externals = [];
    for (const t of (tasks || [])) {
        // PB.9: pick external IDs out of the assignees array (still tolerates legacy).
        for (const a of readAssignees(t)) {
            if (!a || seen.has(a)) continue;
            seen.add(a);
            externals.push(a);
        }
    }
    externals.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return builtIn.concat(externals).map(v => ({ value: v, label: v }));
}

/**
 * Bucket a user's tasks into overdue / thisWeek / upcoming / completed,
 * relative to `todayIso` (YYYY-MM-DD).
 *
 *   - overdue:   not done AND dueDate < today
 *   - thisWeek:  not done AND today <= dueDate <= today + 6 days
 *   - upcoming:  not done AND (no dueDate OR dueDate > today + 6 days)
 *   - completed: status === 'done'
 *
 * Sort within bucket: overdue + thisWeek + upcoming all asc by dueDate
 * (undated tasks last in upcoming); completed by completedAt desc with
 * updatedAt as a fallback.
 */
export function bucketTasksForUser(tasks, userId, todayIso) {
    const empty = { overdue: [], thisWeek: [], upcoming: [], completed: [] };
    if (!Array.isArray(tasks) || tasks.length === 0) return empty;
    // PB.9: joint tasks (multi-assignee) show up for each member of the team.
    const mine = tasks.filter(t => t && readAssignees(t).includes(userId));
    if (mine.length === 0) return empty;

    const weekEnd = todayIso ? addDaysIso(todayIso, 6) : null;
    const overdue = [];
    const thisWeek = [];
    const upcoming = [];
    const completed = [];

    for (const t of mine) {
        if (t.status === 'done') {
            completed.push(t);
        } else if (!t.dueDate) {
            upcoming.push(t);
        } else if (todayIso && t.dueDate < todayIso) {
            overdue.push(t);
        } else if (todayIso && weekEnd && t.dueDate <= weekEnd) {
            thisWeek.push(t);
        } else {
            upcoming.push(t);
        }
    }

    const byDueAsc = (a, b) => (a.dueDate || '').localeCompare(b.dueDate || '');
    const upcomingCmp = (a, b) => {
        const aMissing = !a.dueDate, bMissing = !b.dueDate;
        if (aMissing && !bMissing) return 1;
        if (!aMissing && bMissing) return -1;
        return byDueAsc(a, b);
    };
    const completedCmp = (a, b) => {
        const ak = a.completedAt || a.updatedAt || '';
        const bk = b.completedAt || b.updatedAt || '';
        return bk.localeCompare(ak);
    };

    overdue.sort(byDueAsc);
    thisWeek.sort(byDueAsc);
    upcoming.sort(upcomingCmp);
    completed.sort(completedCmp);
    return { overdue, thisWeek, upcoming, completed };
}

// ── Dashboard cross-project metrics (Task 5.3) ──

export const DASHBOARD_WEEKS = 8;

/**
 * Single sweep over projects + tasks producing the six headline numbers shown
 * on the Dashboard tab. `todayIso` is YYYY-MM-DD; date comparisons stay in
 * lexicographic ISO so we never cross UTC/local timezone boundaries.
 *
 *   - activeProjects:       status === 'active' AND not archived
 *   - openTasks:            status !== 'done'
 *   - overdueTasks:         status !== 'done' AND dueDate < today
 *   - dueThisWeek:          status !== 'done' AND today <= dueDate <= today+6
 *   - completedLast30Days:  status === 'done' AND completedAt within last 30 days inclusive
 *   - upcomingMilestones:   isMilestone AND status !== 'done' AND today <= dueDate <= today+13
 */
export function computeDashboardMetrics(projects, tasks, todayIso) {
    const out = {
        activeProjects: 0,
        openTasks: 0,
        overdueTasks: 0,
        dueThisWeek: 0,
        completedLast30Days: 0,
        upcomingMilestones: 0,
    };

    const projectList = Array.isArray(projects) ? projects : [];
    for (const p of projectList) {
        if (p && p.status === 'active' && !p.archivedAt) out.activeProjects++;
    }

    const taskList = Array.isArray(tasks) ? tasks : [];
    if (taskList.length === 0) return out;

    const today = todayIso || null;
    const weekEnd = today ? addDaysIso(today, 6) : null;
    const milestoneEnd = today ? addDaysIso(today, 13) : null;
    const thirtyDaysAgo = today ? addDaysIso(today, -30) : null;

    for (const t of taskList) {
        if (!t) continue;
        const isDone = t.status === 'done';
        if (!isDone) {
            out.openTasks++;
            if (t.dueDate && today) {
                if (t.dueDate < today) out.overdueTasks++;
                else if (t.dueDate <= weekEnd) out.dueThisWeek++;
            }
            if (t.isMilestone && t.dueDate && today
                && t.dueDate >= today && t.dueDate <= milestoneEnd) {
                out.upcomingMilestones++;
            }
        } else if (t.completedAt && today && thirtyDaysAgo) {
            const completedDate = isoDatePart(t.completedAt);
            if (completedDate && completedDate >= thirtyDaysAgo && completedDate <= today) {
                out.completedLast30Days++;
            }
        }
    }
    return out;
}

/**
 * Per-week task completion counts for the last `weeks` rolling 7-day windows
 * ending at `todayIso` (inclusive). Returned oldest → newest so the SVG bar
 * chart reads left to right chronologically. Each bucket is `[startIso, endIso]`
 * inclusive of both endpoints.
 *
 * A task counts toward exactly one bucket: the one whose range contains its
 * `completedAt` date portion. Tasks without `completedAt`, not-done tasks, and
 * tasks completed before the chart window are skipped.
 */
export function computeWeeklyCompletionBars(tasks, todayIso, weeks = DASHBOARD_WEEKS) {
    const n = Number.isInteger(weeks) && weeks > 0 ? weeks : DASHBOARD_WEEKS;
    const bars = [];
    if (!todayIso) {
        for (let i = 0; i < n; i++) bars.push({ startIso: '', endIso: '', completed: 0 });
        return bars;
    }
    // Build oldest → newest. Newest bucket: [today-6, today]. Each older bucket
    // shifts back 7 days.
    for (let i = n - 1; i >= 0; i--) {
        const endIso = addDaysIso(todayIso, -7 * i);
        const startIso = addDaysIso(endIso, -6);
        bars.push({ startIso, endIso, completed: 0 });
    }
    if (!Array.isArray(tasks) || tasks.length === 0) return bars;

    const windowStart = bars[0].startIso;
    const windowEnd = bars[bars.length - 1].endIso;
    for (const t of tasks) {
        if (!t || t.status !== 'done' || !t.completedAt) continue;
        const day = isoDatePart(t.completedAt);
        if (!day || day < windowStart || day > windowEnd) continue;
        // Bucket index: how many full 7-day strides from today the day sits in.
        const stride = isoDayDiff(windowEnd, day); // days from windowEnd back to day; non-negative within window
        const idxFromEnd = Math.floor(stride / 7);
        const idx = bars.length - 1 - idxFromEnd;
        if (idx >= 0 && idx < bars.length) bars[idx].completed++;
    }
    return bars;
}

/** Strip an ISO timestamp (or YYYY-MM-DD) to its date portion. Returns null on malformed input. */
function isoDatePart(value) {
    if (!value || typeof value !== 'string') return null;
    if (value.length >= 10 && value[4] === '-' && value[7] === '-') return value.slice(0, 10);
    return null;
}

/** Whole-day difference `a - b` for two YYYY-MM-DD strings. */
function isoDayDiff(aIso, bIso) {
    const [ay, am, ad] = aIso.split('-').map(Number);
    const [by, bm, bd] = bIso.split('-').map(Number);
    const am0 = Date.UTC(ay, am - 1, ad);
    const bm0 = Date.UTC(by, bm - 1, bd);
    return Math.round((am0 - bm0) / ONE_DAY_MS);
}

/** YYYY-MM-DD + n days → YYYY-MM-DD. Tolerates malformed input by returning the original. */
function addDaysIso(iso, n) {
    if (!iso || typeof iso !== 'string') return iso;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

// ── Cross-project Files summary (Task 5.4) ──

/**
 * Flatten every task's attachments into one project-grouped list for the
 * Files tab. Groups are sorted by project name (case-insensitive); within
 * each group items are sorted by `addedAt` desc so the freshest uploads
 * sit at the top. Projects with no attachments and orphaned tasks (whose
 * project no longer exists) are dropped.
 *
 * Returns: [{ projectId, projectName, items: [{ attachment, taskId, taskName }] }]
 */
export function collectAttachmentsByProject(projects, tasks) {
    if (!Array.isArray(projects) || !Array.isArray(tasks)) return [];
    const byProject = new Map();
    for (const p of projects) {
        if (p && p.id) byProject.set(p.id, { projectId: p.id, projectName: p.name || '', items: [] });
    }
    for (const t of tasks) {
        if (!t || !Array.isArray(t.attachments) || t.attachments.length === 0) continue;
        const group = byProject.get(t.projectId);
        if (!group) continue;
        for (const a of t.attachments) {
            if (!a) continue;
            group.items.push({ attachment: a, taskId: t.id, taskName: t.name || '' });
        }
    }
    const groups = [];
    for (const g of byProject.values()) {
        if (g.items.length === 0) continue;
        g.items.sort((a, b) => (b.attachment.addedAt || '').localeCompare(a.attachment.addedAt || ''));
        groups.push(g);
    }
    groups.sort((a, b) => (a.projectName || '').localeCompare(b.projectName || '', undefined, { sensitivity: 'base' }));
    return groups;
}

// ── Persistence ──

export function loadProjects() {
    try {
        const raw = localStorage.getItem(PROJECTS_KEY);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PROJECTS));
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.items)) {
            return JSON.parse(JSON.stringify(DEFAULT_PROJECTS));
        }
        return {
            items: parsed.items.map(sanitiseProject).filter(Boolean),
            tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(sanitiseTask).filter(Boolean) : [],
            notifications: (parsed.notifications && typeof parsed.notifications === 'object' && !Array.isArray(parsed.notifications))
                ? parsed.notifications
                : {},
            prefs: (parsed.prefs && typeof parsed.prefs === 'object' && !Array.isArray(parsed.prefs))
                ? parsed.prefs
                : {},
            digest_pending: (parsed.digest_pending && typeof parsed.digest_pending === 'object' && !Array.isArray(parsed.digest_pending))
                ? parsed.digest_pending
                : {},
            pm_dlbooks_migrated_to_projects: parsed.pm_dlbooks_migrated_to_projects === true,
            business_transform_seeded: parsed.business_transform_seeded === true,
            pm_dlbooks_cleaned: parsed.pm_dlbooks_cleaned === true,
        };
    } catch (e) {
        console.error('loadProjects parse error:', e);
        return JSON.parse(JSON.stringify(DEFAULT_PROJECTS));
    }
}

export function saveProjects(data) {
    fbSave(PROJECTS_KEY, data);
    showToast('Saved');
}
