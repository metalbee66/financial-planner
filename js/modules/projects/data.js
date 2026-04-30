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
export const DEFAULT_PARTICIPANTS = ['brad', 'diana'];
export const DEFAULT_PROJECTS = { items: [] };

const STATUS_SET = new Set(PROJECT_STATUSES);

function nowIso() { return new Date().toISOString(); }

function generateId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
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

// ── Persistence ──

export function loadProjects() {
    try {
        const raw = localStorage.getItem(PROJECTS_KEY);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PROJECTS));
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.items)) {
            return JSON.parse(JSON.stringify(DEFAULT_PROJECTS));
        }
        return { items: parsed.items.map(sanitiseProject).filter(Boolean) };
    } catch (e) {
        console.error('loadProjects parse error:', e);
        return JSON.parse(JSON.stringify(DEFAULT_PROJECTS));
    }
}

export function saveProjects(data) {
    fbSave(PROJECTS_KEY, data);
    showToast('Saved');
}
