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
export const DEFAULT_PROJECTS = { items: [], tasks: [] };

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
    const at = nowIso();
    return {
        id: generateId(),
        name: trim(input && input.name),
        status: STATUS_SET.has(inStatus) ? inStatus : 'planning',
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
 */
export function sanitiseProject(p) {
    if (!p || typeof p !== 'object') return null;
    const at = nowIso();
    return {
        id: p.id || generateId(),
        name: trim(p.name),
        status: STATUS_SET.has(p.status) ? p.status : 'planning',
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
    if (!Array.isArray(p.participants) || p.participants.length === 0) {
        return 'At least one participant is required';
    }
    if (p.startDate && p.endDate && p.endDate < p.startDate) {
        return 'End date must be on or after start date';
    }
    return null;
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
    const at = nowIso();
    return {
        id: generateTaskId(),
        projectId: (input && input.projectId) || null,
        name: trim(input && input.name),
        description: trim(input && input.description),
        status: TASK_STATUS_SET.has(inStatus) ? inStatus : 'not-started',
        assignee: (input && input.assignee) || null,
        startDate: (input && input.startDate) || null,
        dueDate: (input && input.dueDate) || null,
        priority: TASK_PRIORITY_SET.has(inPriority) ? inPriority : 'normal',
        parentTaskId: (input && input.parentTaskId) || null,
        dependsOn: Array.isArray(input && input.dependsOn) ? input.dependsOn.slice() : [],
        comments: Array.isArray(input && input.comments) ? input.comments.slice() : [],
        events: Array.isArray(input && input.events) ? input.events.slice() : [],
        attachments: Array.isArray(input && input.attachments) ? input.attachments.slice() : [],
        createdAt: at,
        updatedAt: at,
        completedAt: null,
    };
}

export function sanitiseTask(t) {
    if (!t || typeof t !== 'object') return null;
    const at = nowIso();
    return {
        id: t.id || generateTaskId(),
        projectId: t.projectId || null,
        name: trim(t.name),
        description: trim(t.description),
        status: TASK_STATUS_SET.has(t.status) ? t.status : 'not-started',
        assignee: t.assignee || null,
        startDate: t.startDate || null,
        dueDate: t.dueDate || null,
        priority: TASK_PRIORITY_SET.has(t.priority) ? t.priority : 'normal',
        parentTaskId: t.parentTaskId || null,
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.slice() : [],
        comments: Array.isArray(t.comments) ? t.comments.slice() : [],
        events: Array.isArray(t.events) ? t.events.slice() : [],
        attachments: Array.isArray(t.attachments) ? t.attachments.slice() : [],
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
 * Map of task field → event kind for the audit-tracked subset. Per plan §3.3
 * we log status/assignee/dueDate changes plus dependency add/remove (those
 * have their own helpers because they're list deltas, not field overwrites).
 * Untracked fields (name, description, priority, startDate) intentionally
 * don't generate events to keep the feed focused on user-meaningful changes.
 */
const TRACKED_FIELD_EVENT_KINDS = {
    status: 'status_changed',
    assignee: 'assignee_changed',
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
