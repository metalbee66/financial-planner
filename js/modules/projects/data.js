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
