/**
 * Projects module — Asana-like project & task management.
 *
 * Phase 1.1: project CRUD (name, dates, status, description, participants).
 * Phase 1.2 layered on top adds a richer participant chip editor.
 *
 * The module owns one DOM host element and renders either the project list
 * or the create/edit form into it on each `render()` call. There is no
 * router — `mode` tracks which view is active. Tasks/views/notifications
 * arrive in Phases 2–7.
 */

import { state } from '../../state.js';
import {
    PROJECT_STATUSES,
    DEFAULT_PARTICIPANTS,
    createProject,
    sanitiseProject,
    validateProject,
    addProjectToList,
    updateProjectInList,
    deleteProjectFromList,
    findProject,
    saveProjects,
} from './data.js';

const STATUS_LABELS = {
    'planning': 'Planning',
    'active': 'Active',
    'on-hold': 'On hold',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
};

const PARTICIPANT_LABELS = { brad: 'Brad', diana: 'Diana' };

let host = null;
let mode = { view: 'list', editingId: null };
let mounted = false;

export function mount(hostEl) {
    if (mounted) return;
    host = hostEl;
    mounted = true;
    render();
}

/** External entry — called by firebase-sync's realtime listener after a remote update. */
export function renderProjectsTab() {
    render();
}

function getProjects() {
    if (!state.projectsData || !Array.isArray(state.projectsData.items)) {
        state.projectsData = { items: [] };
    }
    return state.projectsData.items;
}

function setProjects(items) {
    state.projectsData = { ...(state.projectsData || {}), items };
    saveProjects(state.projectsData);
}

function render() {
    if (!host) return;
    if (mode.view === 'form') {
        renderForm();
    } else {
        renderList();
    }
}

// ── List view ──

function renderList() {
    const items = getProjects().filter(p => !p.archivedAt);

    if (items.length === 0) {
        host.innerHTML = `
            <div class="projects-empty-state">
                <div class="projects-empty-icon">📋</div>
                <h2>No projects yet</h2>
                <p>Track work, milestones, and tasks across the family.</p>
                <button class="projects-new-btn" id="projects-new-btn">+ New Project</button>
            </div>
        `;
        host.querySelector('#projects-new-btn').addEventListener('click', goCreate);
        return;
    }

    host.innerHTML = `
        <div class="projects-toolbar">
            <h2 class="projects-title">Projects</h2>
            <button class="projects-new-btn" id="projects-new-btn">+ New Project</button>
        </div>
        <div class="projects-grid" id="projects-grid"></div>
    `;
    host.querySelector('#projects-new-btn').addEventListener('click', goCreate);

    const grid = host.querySelector('#projects-grid');
    items
        .slice()
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .forEach(p => grid.appendChild(renderCard(p)));
}

function renderCard(p) {
    const card = document.createElement('article');
    card.className = 'project-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open project ${p.name}`);

    const dateRange = formatDateRange(p.startDate, p.endDate);
    const participants = renderChipsHtml(p.participants);

    card.innerHTML = `
        <div class="project-card-head">
            <h3 class="project-card-name">${escapeHtml(p.name)}</h3>
            <span class="status-badge status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
        </div>
        ${dateRange ? `<div class="project-card-dates">${escapeHtml(dateRange)}</div>` : ''}
        ${p.description ? `<p class="project-card-desc">${escapeHtml(p.description)}</p>` : ''}
        <div class="project-card-foot">
            <div class="project-card-chips">${participants}</div>
        </div>
    `;
    card.addEventListener('click', () => goEdit(p.id));
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goEdit(p.id); }
    });
    return card;
}

// ── Form view (create or edit) ──

function renderForm() {
    const editing = mode.editingId
        ? findProject(getProjects(), mode.editingId)
        : null;
    const draft = editing
        ? sanitiseProject(editing)
        : createProject({});

    host.innerHTML = `
        <div class="projects-toolbar">
            <button class="projects-back-btn" id="projects-back-btn" aria-label="Back to projects">← Back</button>
            <h2 class="projects-title">${editing ? 'Edit project' : 'New project'}</h2>
        </div>
        <form class="project-form" id="project-form" novalidate>
            <div class="form-row">
                <label for="pf-name">Name</label>
                <input type="text" id="pf-name" required maxlength="200" value="${escapeAttr(draft.name)}" autocomplete="off" />
            </div>
            <div class="form-row form-row-grid">
                <div>
                    <label for="pf-status">Status</label>
                    <select id="pf-status">
                        ${PROJECT_STATUSES.map(s =>
                            `<option value="${s}"${s === draft.status ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`
                        ).join('')}
                    </select>
                </div>
                <div>
                    <label for="pf-start">Start date</label>
                    <input type="date" id="pf-start" value="${escapeAttr(draft.startDate || '')}" />
                </div>
                <div>
                    <label for="pf-end">End date</label>
                    <input type="date" id="pf-end" value="${escapeAttr(draft.endDate || '')}" />
                </div>
            </div>
            <div class="form-row" id="pf-participants-row">
                <label>Participants</label>
                <div class="participants-editor" id="pf-participants"></div>
            </div>
            <div class="form-row">
                <label for="pf-desc">Description</label>
                <textarea id="pf-desc" rows="4" maxlength="2000">${escapeHtml(draft.description)}</textarea>
            </div>
            <div class="form-error" id="pf-error" role="alert" aria-live="polite"></div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="pf-cancel">Cancel</button>
                ${editing
                    ? `<button type="button" class="btn-danger" id="pf-delete">Delete</button>`
                    : ''}
                <button type="submit" class="btn-primary" id="pf-save">${editing ? 'Save changes' : 'Create project'}</button>
            </div>
        </form>
    `;

    // Wire participant editor (Task 1.2 component)
    renderParticipantEditor(host.querySelector('#pf-participants'), draft.participants);

    host.querySelector('#projects-back-btn').addEventListener('click', goList);
    host.querySelector('#pf-cancel').addEventListener('click', goList);

    if (editing) {
        host.querySelector('#pf-delete').addEventListener('click', () => onDelete(editing));
    }

    host.querySelector('#project-form').addEventListener('submit', (e) => {
        e.preventDefault();
        onSubmit(editing && editing.id);
    });
}

function readForm() {
    return {
        name: host.querySelector('#pf-name').value,
        status: host.querySelector('#pf-status').value,
        startDate: host.querySelector('#pf-start').value || null,
        endDate: host.querySelector('#pf-end').value || null,
        participants: getParticipantEditorValue(host.querySelector('#pf-participants')),
        description: host.querySelector('#pf-desc').value,
    };
}

function showFormError(msg) {
    const el = host.querySelector('#pf-error');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? '' : 'none';
}

function onSubmit(editingId) {
    showFormError('');
    const form = readForm();

    let next;
    if (editingId) {
        const existing = findProject(getProjects(), editingId);
        if (!existing) {
            showFormError('Project no longer exists.');
            return;
        }
        next = { ...existing, ...form };
    } else {
        next = createProject(form);
    }

    const err = validateProject(next);
    if (err) { showFormError(err); return; }

    if (editingId) {
        setProjects(updateProjectInList(getProjects(), editingId, form));
    } else {
        setProjects(addProjectToList(getProjects(), next));
    }

    goList();
}

function onDelete(p) {
    if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
    setProjects(deleteProjectFromList(getProjects(), p.id));
    goList();
}

// ── View transitions ──

function goList() { mode = { view: 'list', editingId: null }; render(); }
function goCreate() { mode = { view: 'form', editingId: null }; render(); }
function goEdit(id) { mode = { view: 'form', editingId: id }; render(); }

// ── Participant editor (Task 1.2) ──

/**
 * Renders an editable participants control: built-in Brad/Diana checkboxes
 * plus a free-text "+ add" input for external participants. The element's
 * `dataset.participants` holds the JSON-serialised array; reads use
 * `getParticipantEditorValue()`.
 */
function renderParticipantEditor(root, initial) {
    const set = new Set(Array.isArray(initial) && initial.length ? initial : DEFAULT_PARTICIPANTS);
    root.innerHTML = '';
    root.dataset.participants = JSON.stringify(Array.from(set));

    const builtins = document.createElement('div');
    builtins.className = 'participants-builtins';
    DEFAULT_PARTICIPANTS.forEach(id => {
        const lbl = document.createElement('label');
        lbl.className = 'participant-toggle';
        lbl.innerHTML = `<input type="checkbox" data-builtin="${id}"${set.has(id) ? ' checked' : ''}/> ${PARTICIPANT_LABELS[id] || id}`;
        const cb = lbl.querySelector('input');
        cb.addEventListener('change', () => {
            const arr = JSON.parse(root.dataset.participants);
            const updated = cb.checked
                ? Array.from(new Set(arr.concat([id])))
                : arr.filter(x => x !== id);
            commitParticipants(root, updated);
        });
        builtins.appendChild(lbl);
    });
    root.appendChild(builtins);

    const chipBox = document.createElement('div');
    chipBox.className = 'participants-chips';
    root.appendChild(chipBox);

    const adder = document.createElement('div');
    adder.className = 'participants-adder';
    adder.innerHTML = `
        <input type="text" class="participant-add-input" placeholder="Add participant…" maxlength="60" autocomplete="off" />
        <button type="button" class="btn-secondary participant-add-btn">Add</button>
    `;
    const input = adder.querySelector('input');
    const btn = adder.querySelector('button');
    const addExternal = () => {
        const v = input.value.trim();
        if (!v) return;
        const arr = JSON.parse(root.dataset.participants);
        if (arr.includes(v)) {
            input.value = '';
            return;
        }
        commitParticipants(root, arr.concat([v]));
        input.value = '';
        input.focus();
    };
    btn.addEventListener('click', addExternal);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addExternal(); }
    });
    root.appendChild(adder);

    // Render the external chip list (built-ins live in their checkboxes;
    // external participants render here so they can be removed individually)
    drawExternalChips(root);
}

function commitParticipants(root, arr) {
    root.dataset.participants = JSON.stringify(arr);

    // Sync built-in checkboxes
    root.querySelectorAll('input[data-builtin]').forEach(cb => {
        cb.checked = arr.includes(cb.dataset.builtin);
    });
    drawExternalChips(root);
}

function drawExternalChips(root) {
    const chipBox = root.querySelector('.participants-chips');
    const arr = JSON.parse(root.dataset.participants);
    const externals = arr.filter(p => !DEFAULT_PARTICIPANTS.includes(p));
    chipBox.innerHTML = externals.length === 0
        ? '<span class="participants-empty">No external participants</span>'
        : '';
    externals.forEach(p => {
        const chip = document.createElement('span');
        chip.className = 'chip chip-external';
        chip.innerHTML = `<span class="chip-avatar">${escapeHtml(initialOf(p))}</span><span class="chip-label">${escapeHtml(p)}</span><button type="button" class="chip-remove" aria-label="Remove ${escapeAttr(p)}">×</button>`;
        chip.querySelector('.chip-remove').addEventListener('click', () => {
            const cur = JSON.parse(root.dataset.participants);
            const wasAssigned = isParticipantAssignedToTasks(p);
            if (wasAssigned && !confirm(`${p} is assigned to tasks in this project. Remove anyway? (Tasks will keep their current assignee until you reassign them.)`)) {
                return;
            }
            commitParticipants(root, cur.filter(x => x !== p));
        });
        chipBox.appendChild(chip);
    });
}

function getParticipantEditorValue(root) {
    try {
        const arr = JSON.parse(root.dataset.participants || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

/**
 * Phase 1.2 placeholder — tasks live in the data model from Phase 2.1 onward;
 * until then this always returns false. Wiring the warning now keeps the UI
 * code stable when assignment data lands.
 */
function isParticipantAssignedToTasks(_participant) {
    return false;
}

// ── Helpers ──

/** Shared chip renderer — used by project cards and other surfaces. */
export function renderChipsHtml(participants) {
    if (!Array.isArray(participants) || participants.length === 0) return '';
    return participants.map(p => {
        const label = PARTICIPANT_LABELS[p] || p;
        const cls = DEFAULT_PARTICIPANTS.includes(p) ? 'chip' : 'chip chip-external';
        return `<span class="${cls}"><span class="chip-avatar">${escapeHtml(initialOf(label))}</span><span class="chip-label">${escapeHtml(label)}</span></span>`;
    }).join('');
}

function initialOf(name) {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function formatDateRange(startDate, endDate) {
    if (!startDate && !endDate) return '';
    const fmt = (iso) => {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return `${d}/${m}/${y}`;
    };
    if (startDate && endDate) return `${fmt(startDate)} → ${fmt(endDate)}`;
    if (startDate) return `from ${fmt(startDate)}`;
    return `until ${fmt(endDate)}`;
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
