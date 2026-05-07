/**
 * Projects module — Asana-like project & task management.
 *
 * Phase 1.1: project CRUD (name, dates, status, description, participants).
 * Phase 1.2 layered on top adds a richer participant chip editor.
 * Phase 2.1: tasks within a project — inline add, row list with inline status
 *   dropdown, slide-in detail panel for the full edit.
 *
 * The module owns one DOM host element and renders one of three modes into
 * it: `list` (all projects), `detail` (one project + its tasks), or `form`
 * (create/edit a project). The slide-in task panel is rendered into the
 * document body and animates over the detail view.
 */

import { state } from '../../state.js';
import { currentUser } from '../../firebase-sync.js';
import {
    PROJECT_STATUSES,
    TASK_STATUSES,
    TASK_PRIORITIES,
    DEFAULT_PARTICIPANTS,
    createProject,
    sanitiseProject,
    validateProject,
    addProjectToList,
    updateProjectInList,
    deleteProjectFromList,
    findProject,
    createTask,
    validateTask,
    addTaskToList,
    updateTaskInList,
    deleteTaskFromList,
    findTask,
    findTasksByProject,
    findSubtasks,
    promoteSubtasksInList,
    deleteTaskCascadeFromList,
    addDependency,
    removeDependency,
    wouldCreateCycle,
    countBlockingDeps,
    createComment,
    addCommentToTask,
    createEvent,
    addEventToTask,
    taskPatchEvents,
    createFileAttachment,
    createUrlAttachment,
    validateFileAttachment,
    validateUrlAttachment,
    addAttachmentToTask,
    removeAttachmentFromTask,
    taskAttachmentSize,
    formatBytes,
    MAX_INLINE_ATTACHMENT_SIZE,
    TASK_ATTACHMENT_WARN_SIZE,
    sortTasks,
    filterTasks,
    groupTopLevelTasks,
    TASK_SORT_FIELDS,
    TASK_GROUP_OPTIONS,
    saveProjects,
} from './data.js';

const STATUS_LABELS = {
    'planning': 'Planning',
    'active': 'Active',
    'on-hold': 'On hold',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
};

const TASK_STATUS_LABELS = {
    'not-started': 'Not started',
    'in-progress': 'In progress',
    'review': 'Review',
    'done': 'Done',
    'blocked': 'Blocked',
};

const TASK_PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High' };

const TASK_SORT_LABELS = { dueDate: 'Due date', name: 'Name', priority: 'Priority' };
const TASK_GROUP_LABELS = { none: 'None', status: 'Status', assignee: 'Assignee' };
const DEFAULT_TASK_SORT = { by: 'dueDate', dir: 'asc' };
const DEFAULT_TASK_GROUP = 'none';

const PARTICIPANT_LABELS = { brad: 'Brad', diana: 'Diana' };

let host = null;
let mode = freshListMode();
let mounted = false;
let openTaskPanelId = null;

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

function ensureProjectsData() {
    if (!state.projectsData || !Array.isArray(state.projectsData.items)) {
        state.projectsData = { items: [], tasks: [] };
    }
    if (!Array.isArray(state.projectsData.tasks)) {
        state.projectsData.tasks = [];
    }
}

function getProjects() {
    ensureProjectsData();
    return state.projectsData.items;
}

function getTasks() {
    ensureProjectsData();
    return state.projectsData.tasks;
}

function setProjects(items) {
    ensureProjectsData();
    state.projectsData = { ...state.projectsData, items };
    saveProjects(state.projectsData);
}

function setTasks(tasks) {
    ensureProjectsData();
    state.projectsData = { ...state.projectsData, tasks };
    saveProjects(state.projectsData);
}

/** Single save for combined item+task mutations (e.g. cascade delete). */
function setBoth(items, tasks) {
    ensureProjectsData();
    state.projectsData = { ...state.projectsData, items, tasks };
    saveProjects(state.projectsData);
}

/**
 * Patch a task and auto-log audit events for any tracked field that changed
 * (status / assignee / due-date — see TRACKED_FIELD_EVENT_KINDS in data.js).
 * Every UI site that mutates a task should go through here so the activity
 * feed stays consistent. One save per call.
 */
function applyTaskPatch(taskId, patch) {
    const tasks = getTasks();
    const prev = findTask(tasks, taskId);
    if (!prev) return;
    const events = taskPatchEvents(prev, patch, currentUserEmail());
    let next = updateTaskInList(tasks, taskId, patch);
    for (const e of events) next = addEventToTask(next, taskId, e);
    setTasks(next);
}

/** Add a dep + log a `dependency_added` event in one save. Returns boolean. */
function applyAddDependency(taskId, depId) {
    const tasks = getTasks();
    const next = addDependency(tasks, taskId, depId);
    if (next === tasks) return false;
    const evt = createEvent({
        kind: 'dependency_added',
        by: currentUserEmail(),
        after: depId,
    });
    setTasks(addEventToTask(next, taskId, evt));
    return true;
}

/** Remove a dep + log a `dependency_removed` event in one save. */
function applyRemoveDependency(taskId, depId) {
    const tasks = getTasks();
    const next = removeDependency(tasks, taskId, depId);
    if (next === tasks) return false;
    const evt = createEvent({
        kind: 'dependency_removed',
        by: currentUserEmail(),
        before: depId,
    });
    setTasks(addEventToTask(next, taskId, evt));
    return true;
}

/** Append an attachment + log `attachment_added` in one save. */
function applyAddAttachment(taskId, attachment) {
    const tasks = getTasks();
    const next = addAttachmentToTask(tasks, taskId, attachment);
    if (next === tasks) return false;
    const evt = createEvent({
        kind: 'attachment_added',
        by: currentUserEmail(),
        after: attachment.name,
    });
    setTasks(addEventToTask(next, taskId, evt));
    return true;
}

/** Remove an attachment + log `attachment_removed` in one save. */
function applyRemoveAttachment(taskId, attachment) {
    const tasks = getTasks();
    const next = removeAttachmentFromTask(tasks, taskId, attachment.id);
    if (next === tasks) return false;
    const evt = createEvent({
        kind: 'attachment_removed',
        by: currentUserEmail(),
        before: attachment.name,
    });
    setTasks(addEventToTask(next, taskId, evt));
    return true;
}

function render() {
    if (!host) return;
    if (mode.view === 'form') {
        renderForm();
    } else if (mode.view === 'detail') {
        renderDetail();
    } else {
        renderList();
    }
    // Re-attach the panel if a task was open before a re-render
    if (openTaskPanelId) {
        const t = findTask(getTasks(), openTaskPanelId);
        if (t) renderTaskPanel(t);
        else closeTaskPanel();
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
    const projectTasks = findTasksByProject(getTasks(), p.id);
    const openCount = projectTasks.filter(t => t.status !== 'done').length;
    const totalCount = projectTasks.length;
    const taskStats = totalCount > 0
        ? `<span class="project-card-stats">${openCount}/${totalCount} open</span>`
        : '<span class="project-card-stats project-card-stats-empty">No tasks yet</span>';

    card.innerHTML = `
        <div class="project-card-head">
            <h3 class="project-card-name">${escapeHtml(p.name)}</h3>
            <span class="status-badge status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
        </div>
        ${dateRange ? `<div class="project-card-dates">${escapeHtml(dateRange)}</div>` : ''}
        ${p.description ? `<p class="project-card-desc">${escapeHtml(p.description)}</p>` : ''}
        <div class="project-card-foot">
            <div class="project-card-chips">${participants}</div>
            ${taskStats}
        </div>
    `;
    card.addEventListener('click', () => goDetail(p.id));
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goDetail(p.id); }
    });
    return card;
}

// ── Detail view (one project + its tasks) ──

function renderDetail() {
    const p = findProject(getProjects(), mode.detailProjectId);
    if (!p) {
        // Project was deleted out from under us — bounce to list
        goList();
        return;
    }

    const dateRange = formatDateRange(p.startDate, p.endDate);
    const participants = renderChipsHtml(p.participants);
    const allTasks = findTasksByProject(getTasks(), p.id);
    const openCount = allTasks.filter(t => t.status !== 'done').length;
    const totalCount = allTasks.length;

    const filters = mode.taskFilters || {};
    const sort = mode.taskSort || DEFAULT_TASK_SORT;
    const group = mode.taskGroup || DEFAULT_TASK_GROUP;
    const assigneeOptions = collectAssigneeOptions(p, allTasks);

    host.innerHTML = `
        <div class="projects-toolbar">
            <button class="projects-back-btn" id="projects-back-btn" aria-label="Back to projects">← Back</button>
            <h2 class="projects-title">${escapeHtml(p.name)}</h2>
            <span class="status-badge status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
            <button class="btn-secondary" id="projects-edit-btn">Edit project</button>
        </div>
        <div class="project-detail-meta">
            ${dateRange ? `<div class="project-detail-dates">${escapeHtml(dateRange)}</div>` : ''}
            <div class="project-detail-chips">${participants}</div>
            ${p.description ? `<p class="project-detail-desc">${escapeHtml(p.description)}</p>` : ''}
        </div>
        <div class="project-detail-tasks">
            <div class="tasks-header">
                <h3 class="tasks-title">Tasks</h3>
                <span class="tasks-count">${totalCount === 0 ? 'No tasks yet' : `${openCount} open · ${totalCount} total`}</span>
                <label class="tasks-filter-toggle">
                    <input type="checkbox" id="tasks-filter-milestones"${filters.milestonesOnly ? ' checked' : ''} />
                    <span class="task-row-milestone-glyph" aria-hidden="true">◆</span>
                    <span>Milestones only</span>
                </label>
            </div>
            <div class="tasks-toolbar" role="toolbar" aria-label="Task list controls">
                <label class="tasks-toolbar-field">
                    <span class="tasks-toolbar-label">Sort</span>
                    <select id="tasks-sort-by" aria-label="Sort tasks by">
                        ${TASK_SORT_FIELDS.map(f =>
                            `<option value="${f}"${f === sort.by ? ' selected' : ''}>${escapeHtml(TASK_SORT_LABELS[f] || f)}</option>`
                        ).join('')}
                    </select>
                    <button type="button" class="tasks-toolbar-dir" id="tasks-sort-dir" aria-label="Toggle sort direction" title="Toggle sort direction">${sort.dir === 'desc' ? '↓' : '↑'}</button>
                </label>
                <label class="tasks-toolbar-field">
                    <span class="tasks-toolbar-label">Group</span>
                    <select id="tasks-group-by" aria-label="Group tasks by">
                        ${TASK_GROUP_OPTIONS.map(g =>
                            `<option value="${g}"${g === group ? ' selected' : ''}>${escapeHtml(TASK_GROUP_LABELS[g] || g)}</option>`
                        ).join('')}
                    </select>
                </label>
                <label class="tasks-toolbar-field">
                    <span class="tasks-toolbar-label">Assignee</span>
                    <select id="tasks-filter-assignee" aria-label="Filter by assignee">
                        <option value="">All</option>
                        ${assigneeOptions.map(a =>
                            `<option value="${escapeAttr(a.value)}"${a.value === (filters.assignee || '') ? ' selected' : ''}>${escapeHtml(a.label)}</option>`
                        ).join('')}
                    </select>
                </label>
                <label class="tasks-toolbar-field">
                    <span class="tasks-toolbar-label">Status</span>
                    <select id="tasks-filter-status" aria-label="Filter by status">
                        <option value="">All</option>
                        ${TASK_STATUSES.map(s =>
                            `<option value="${s}"${s === (filters.status || '') ? ' selected' : ''}>${escapeHtml(TASK_STATUS_LABELS[s] || s)}</option>`
                        ).join('')}
                    </select>
                </label>
            </div>
            <div class="tasks-add-row" id="tasks-add-row"></div>
            <div class="tasks-list" id="tasks-list"></div>
        </div>
    `;

    host.querySelector('#projects-back-btn').addEventListener('click', goList);
    host.querySelector('#projects-edit-btn').addEventListener('click', () => goEdit(p.id));
    host.querySelector('#tasks-filter-milestones').addEventListener('change', (e) => {
        mode.taskFilters = { ...(mode.taskFilters || {}), milestonesOnly: e.target.checked };
        render();
    });
    host.querySelector('#tasks-sort-by').addEventListener('change', (e) => {
        mode.taskSort = { ...(mode.taskSort || DEFAULT_TASK_SORT), by: e.target.value };
        render();
    });
    host.querySelector('#tasks-sort-dir').addEventListener('click', () => {
        const cur = mode.taskSort || DEFAULT_TASK_SORT;
        mode.taskSort = { ...cur, dir: cur.dir === 'desc' ? 'asc' : 'desc' };
        render();
    });
    host.querySelector('#tasks-group-by').addEventListener('change', (e) => {
        mode.taskGroup = e.target.value || DEFAULT_TASK_GROUP;
        render();
    });
    host.querySelector('#tasks-filter-assignee').addEventListener('change', (e) => {
        const v = e.target.value;
        mode.taskFilters = { ...(mode.taskFilters || {}), assignee: v ? v : null };
        render();
    });
    host.querySelector('#tasks-filter-status').addEventListener('change', (e) => {
        const v = e.target.value;
        mode.taskFilters = { ...(mode.taskFilters || {}), status: v ? v : null };
        render();
    });

    renderAddTaskRow(host.querySelector('#tasks-add-row'), p);
    const filteredTasks = filterTasks(allTasks, filters);
    renderTasksList(host.querySelector('#tasks-list'), p, filteredTasks, allTasks.length);
}

/** Build the assignee filter options: project participants + any extra assignee values currently in use. */
function collectAssigneeOptions(project, tasks) {
    const seen = new Set();
    const out = [];
    const add = (value, label) => {
        if (seen.has(value)) return;
        seen.add(value);
        out.push({ value, label });
    };
    (project.participants || []).forEach(p => add(p, participantLabel(p)));
    tasks.forEach(t => {
        if (t.assignee) add(t.assignee, participantLabel(t.assignee));
    });
    return out;
}

function renderAddTaskRow(root, project) {
    root.innerHTML = `
        <input type="text" class="task-add-name" id="task-add-name" placeholder="+ Add a task…" maxlength="200" autocomplete="off" />
        <select class="task-add-assignee" id="task-add-assignee">
            <option value="">Unassigned</option>
            ${project.participants.map(p =>
                `<option value="${escapeAttr(p)}">${escapeHtml(participantLabel(p))}</option>`
            ).join('')}
        </select>
        <input type="date" class="task-add-due" id="task-add-due" aria-label="Due date" />
        <button type="button" class="btn-primary task-add-submit" id="task-add-submit">Add</button>
    `;
    const nameEl = root.querySelector('#task-add-name');
    const assigneeEl = root.querySelector('#task-add-assignee');
    const dueEl = root.querySelector('#task-add-due');
    const btn = root.querySelector('#task-add-submit');

    const submit = () => {
        const name = nameEl.value.trim();
        if (!name) { nameEl.focus(); return; }
        const t = createTask({
            name,
            projectId: project.id,
            assignee: assigneeEl.value || null,
            dueDate: dueEl.value || null,
        });
        const err = validateTask(t);
        if (err) { alert(err); return; }
        setTasks(addTaskToList(getTasks(), t));
        render();
        // Restore focus to the name input for rapid entry
        const nx = host.querySelector('#task-add-name');
        if (nx) nx.focus();
    };
    btn.addEventListener('click', submit);
    nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
}

function renderTasksList(root, project, tasks, totalTasksInProject) {
    if (tasks.length === 0) {
        const msg = totalTasksInProject > 0
            ? 'No tasks match these filters.'
            : 'No tasks. Add one above.';
        root.innerHTML = `<div class="tasks-empty">${msg}</div>`;
        return;
    }
    root.innerHTML = '';

    // Render order rules:
    //   - Top-level open tasks sort by user choice (mode.taskSort).
    //   - Top-level done tasks always pin to bottom of their bucket, sorted by
    //     completedAt desc (newest done first).
    //   - Subtasks always render indented under their parent in createdAt asc.
    //     Subtasks are NOT sorted/grouped independently — they travel with their
    //     parent's slot.
    const sortOpts = mode.taskSort || DEFAULT_TASK_SORT;
    const groupBy = mode.taskGroup || DEFAULT_TASK_GROUP;

    const tops = tasks.filter(t => !t.parentTaskId);
    const buckets = groupTopLevelTasks(tops, groupBy);

    buckets.forEach(bucket => {
        if (groupBy !== 'none') {
            const header = document.createElement('div');
            header.className = 'tasks-group-header';
            header.dataset.groupKey = bucket.key;
            header.textContent = `${groupLabelFor(bucket.key, groupBy)} · ${bucket.tasks.length}`;
            root.appendChild(header);
        }
        const open = bucket.tasks.filter(t => t.status !== 'done');
        const done = bucket.tasks.filter(t => t.status === 'done');
        const sortedOpen = sortTasks(open, sortOpts);
        const sortedDone = done.slice().sort(
            (a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')
        );
        sortedOpen.concat(sortedDone).forEach(t => {
            root.appendChild(renderTaskRow(t, project, false));
            const subs = findSubtasks(tasks, t.id)
                .slice()
                .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
            subs.forEach(s => root.appendChild(renderTaskRow(s, project, true)));
        });
    });
}

function groupLabelFor(key, groupBy) {
    if (groupBy === 'status') return TASK_STATUS_LABELS[key] || key;
    if (groupBy === 'assignee') return key === '' ? 'Unassigned' : participantLabel(key);
    return 'Tasks';
}

function renderTaskRow(t, project, isSubtask) {
    const row = document.createElement('div');
    row.className = 'task-row'
        + (t.status === 'done' ? ' task-row-done' : '')
        + (isSubtask ? ' task-row-subtask' : '')
        + (t.isMilestone ? ' task-row-milestone' : '');
    row.dataset.taskId = t.id;

    const assigneeHtml = t.assignee
        ? `<span class="chip${DEFAULT_PARTICIPANTS.includes(t.assignee) ? '' : ' chip-external'}"><span class="chip-avatar">${escapeHtml(initialOf(participantLabel(t.assignee)))}</span><span class="chip-label">${escapeHtml(participantLabel(t.assignee))}</span></span>`
        : '<span class="task-row-unassigned">Unassigned</span>';

    const dueHtml = t.dueDate
        ? `<span class="task-row-due${isOverdue(t) ? ' task-row-due-overdue' : ''}">${escapeHtml(formatDate(t.dueDate))}</span>`
        : '<span class="task-row-due task-row-due-empty">—</span>';

    const blockedCount = t.status === 'done' ? 0 : countBlockingDeps(getTasks(), t);
    const blockedBadge = blockedCount > 0
        ? `<span class="task-row-blocked" title="Blocked by ${blockedCount} unmet ${blockedCount === 1 ? 'dependency' : 'dependencies'}">⛔ Blocked by ${blockedCount}</span>`
        : '';

    const milestoneGlyph = t.isMilestone
        ? '<span class="task-row-milestone-glyph" title="Milestone" aria-label="Milestone">◆</span>'
        : '';

    row.innerHTML = `
        <button type="button" class="task-row-name" aria-label="Open task">${milestoneGlyph}${escapeHtml(t.name)}${blockedBadge}</button>
        <select class="task-row-status status-${t.status}" aria-label="Status">
            ${TASK_STATUSES.map(s =>
                `<option value="${s}"${s === t.status ? ' selected' : ''}>${TASK_STATUS_LABELS[s]}</option>`
            ).join('')}
        </select>
        <span class="task-row-assignee">${assigneeHtml}</span>
        ${dueHtml}
        <button type="button" class="task-row-delete" aria-label="Delete task">×</button>
    `;

    row.querySelector('.task-row-name').addEventListener('click', () => openTaskPanel(t.id));
    row.querySelector('.task-row-status').addEventListener('change', (e) => {
        applyTaskPatch(t.id, { status: e.target.value });
        render();
    });
    row.querySelector('.task-row-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTaskWithSubtaskPrompt(t);
    });

    return row;
}

/**
 * Delete a task. If it has subtasks, ask whether to also delete them or
 * promote them to top-level. Two sequential confirms keep this consistent
 * with the rest of the codebase's native-confirm style — no custom modal.
 *
 *   confirm 1: "Delete task X? (it has N subtasks)"   → OK proceed, Cancel abort
 *   confirm 2: "Also delete the N subtasks?"          → OK cascade,  Cancel promote
 */
function deleteTaskWithSubtaskPrompt(t) {
    const tasks = getTasks();
    const subs = findSubtasks(tasks, t.id);
    if (subs.length === 0) {
        if (!confirm(`Delete task "${t.name}"?`)) return;
        setTasks(deleteTaskFromList(tasks, t.id));
        if (openTaskPanelId === t.id) closeTaskPanel();
        render();
        return;
    }
    const n = subs.length;
    if (!confirm(`Delete task "${t.name}"? It has ${n} subtask${n === 1 ? '' : 's'}.`)) return;
    const cascade = confirm(
        `Also delete the ${n} subtask${n === 1 ? '' : 's'}?\n\n` +
        `OK = delete them too.\nCancel = promote them to top-level tasks.`
    );
    let next;
    if (cascade) {
        next = deleteTaskCascadeFromList(tasks, t.id);
    } else {
        const promoted = promoteSubtasksInList(tasks, t.id);
        next = deleteTaskFromList(promoted, t.id);
    }
    setTasks(next);
    if (openTaskPanelId === t.id) closeTaskPanel();
    render();
}

function isOverdue(t) {
    if (!t.dueDate || t.status === 'done') return false;
    const today = new Date().toISOString().slice(0, 10);
    return t.dueDate < today;
}

function participantLabel(p) {
    return PARTICIPANT_LABELS[p] || p;
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

    host.querySelector('#projects-back-btn').addEventListener('click', goAfterForm);
    host.querySelector('#pf-cancel').addEventListener('click', goAfterForm);

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
        goAfterForm();
    } else {
        setProjects(addProjectToList(getProjects(), next));
        // For new projects, jump straight into the detail view so the user
        // can start adding tasks. detailProjectId wasn't set before save.
        goDetail(next.id);
    }
}

function onDelete(p) {
    if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
    // Cascade: drop the project's tasks too. They have no other anchor.
    const remainingTasks = getTasks().filter(t => t.projectId !== p.id);
    const remainingProjects = deleteProjectFromList(getProjects(), p.id);
    setBoth(remainingProjects, remainingTasks);
    closeTaskPanel();
    goList();
}

// ── View transitions ──

function freshListMode() {
    return {
        view: 'list',
        editingId: null,
        detailProjectId: null,
        taskFilters: {},
        taskSort: { ...DEFAULT_TASK_SORT },
        taskGroup: DEFAULT_TASK_GROUP,
    };
}

function goList() {
    mode = freshListMode();
    closeTaskPanel();
    render();
}
function goCreate() {
    mode = { ...mode, view: 'form', editingId: null };
    render();
}
function goEdit(id) {
    mode = { ...mode, view: 'form', editingId: id };
    render();
}
function goDetail(id) {
    // Sort, grouping and filters reset when switching to a different project so
    // state from one project's list view doesn't leak into another. Same-project
    // re-entry preserves the user's current toolbar settings across renders.
    const sameProject = mode.detailProjectId === id;
    mode = {
        view: 'detail',
        editingId: null,
        detailProjectId: id,
        taskFilters: sameProject ? (mode.taskFilters || {}) : {},
        taskSort: sameProject && mode.taskSort ? mode.taskSort : { ...DEFAULT_TASK_SORT },
        taskGroup: sameProject && mode.taskGroup ? mode.taskGroup : DEFAULT_TASK_GROUP,
    };
    render();
}

/** After form save/cancel: go back to detail if we came from there, else list. */
function goAfterForm() {
    if (mode.detailProjectId && findProject(getProjects(), mode.detailProjectId)) {
        goDetail(mode.detailProjectId);
    } else {
        goList();
    }
}

// ── Task slide-in panel (Task 2.1) ──

/**
 * The task panel lives in document.body (not in `host`) so it can overlay any
 * project view and animate from off-screen via CSS transform. It manages its
 * own form state via direct DOM reads on save; the panel is destroyed on
 * close so there's no stale state to clean up.
 */

function openTaskPanel(taskId) {
    openTaskPanelId = taskId;
    const t = findTask(getTasks(), taskId);
    if (!t) { closeTaskPanel(); return; }
    renderTaskPanel(t);
}

function closeTaskPanel() {
    openTaskPanelId = null;
    const existing = document.getElementById('task-panel');
    if (existing) existing.remove();
    const backdrop = document.getElementById('task-panel-backdrop');
    if (backdrop) backdrop.remove();
}

function renderTaskPanel(t) {
    // Replace any existing panel so each render reflects current data
    const existing = document.getElementById('task-panel');
    if (existing) existing.remove();
    const existingBackdrop = document.getElementById('task-panel-backdrop');
    if (existingBackdrop) existingBackdrop.remove();

    const project = findProject(getProjects(), t.projectId);
    const projectName = project ? project.name : '(unknown project)';
    const assigneeOptions = project ? project.participants : DEFAULT_PARTICIPANTS;

    const backdrop = document.createElement('div');
    backdrop.id = 'task-panel-backdrop';
    backdrop.className = 'task-panel-backdrop';
    backdrop.addEventListener('click', closeTaskPanel);
    document.body.appendChild(backdrop);

    const panel = document.createElement('aside');
    panel.id = 'task-panel';
    panel.className = 'task-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Task: ${t.name}`);
    panel.innerHTML = `
        <div class="task-panel-head">
            <span class="task-panel-project">${escapeHtml(projectName)}</span>
            <button type="button" class="task-panel-close" aria-label="Close panel">×</button>
        </div>
        <div class="task-panel-body">
            <div class="form-row">
                <label for="tp-name">Name</label>
                <input type="text" id="tp-name" maxlength="200" value="${escapeAttr(t.name)}" />
            </div>
            <div class="form-row form-row-grid">
                <div>
                    <label for="tp-status">Status</label>
                    <select id="tp-status">
                        ${TASK_STATUSES.map(s =>
                            `<option value="${s}"${s === t.status ? ' selected' : ''}>${TASK_STATUS_LABELS[s]}</option>`
                        ).join('')}
                    </select>
                </div>
                <div>
                    <label for="tp-priority">Priority</label>
                    <select id="tp-priority">
                        ${TASK_PRIORITIES.map(p =>
                            `<option value="${p}"${p === t.priority ? ' selected' : ''}>${TASK_PRIORITY_LABELS[p]}</option>`
                        ).join('')}
                    </select>
                </div>
                <div>
                    <label for="tp-assignee">Assignee</label>
                    <select id="tp-assignee">
                        <option value=""${!t.assignee ? ' selected' : ''}>Unassigned</option>
                        ${assigneeOptions.map(p =>
                            `<option value="${escapeAttr(p)}"${p === t.assignee ? ' selected' : ''}>${escapeHtml(participantLabel(p))}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row form-row-grid">
                <div>
                    <label for="tp-start">Start date</label>
                    <input type="date" id="tp-start" value="${escapeAttr(t.startDate || '')}" />
                </div>
                <div>
                    <label for="tp-due">Due date</label>
                    <input type="date" id="tp-due" value="${escapeAttr(t.dueDate || '')}" />
                </div>
            </div>
            <div class="form-row">
                <label for="tp-desc">Description</label>
                <textarea id="tp-desc" rows="6" maxlength="4000">${escapeHtml(t.description)}</textarea>
            </div>
            <div class="form-row">
                <label class="task-panel-milestone-toggle">
                    <input type="checkbox" id="tp-milestone"${t.isMilestone ? ' checked' : ''} />
                    <span class="task-panel-milestone-glyph" aria-hidden="true">◆</span>
                    <span>Mark as milestone</span>
                </label>
            </div>
            <div class="form-error" id="tp-error" role="alert" aria-live="polite"></div>
            <div class="task-panel-deps" id="tp-deps-section">
                <div class="task-panel-deps-head">
                    <h4>Dependencies</h4>
                </div>
                <div class="task-panel-deps-add">
                    <select id="tp-deps-picker" aria-label="Choose a task to depend on">
                        <option value="">— Add a dependency —</option>
                    </select>
                    <button type="button" class="btn-secondary" id="tp-deps-add-btn">+ Add</button>
                </div>
                <div class="form-error" id="tp-deps-error" role="alert" aria-live="polite"></div>
                <ul class="task-panel-deps-list" id="tp-deps-list"></ul>
            </div>
            <div class="task-panel-attachments" id="tp-attachments-section">
                <h4>Attachments</h4>
                <ul class="task-panel-attachments-list" id="tp-attachments-list"></ul>
                <div class="task-panel-attachments-warn" id="tp-attachments-warn" hidden></div>
                <div class="task-panel-attachments-controls">
                    <div class="task-panel-attachments-dropzone" id="tp-attachments-dropzone">
                        <input type="file" id="tp-attachments-file-input" hidden />
                        <button type="button" class="btn-secondary" id="tp-attachments-pick-btn">Choose file</button>
                        <span class="task-panel-attachments-hint">or drop a file (max ${escapeHtml(formatBytes(MAX_INLINE_ATTACHMENT_SIZE))})</span>
                    </div>
                    <details class="task-panel-attachments-url">
                        <summary>Add URL link</summary>
                        <div class="task-panel-attachments-url-form">
                            <input type="text" id="tp-attachments-url-name" placeholder="Title" maxlength="200" />
                            <input type="url" id="tp-attachments-url-url" placeholder="https://…" maxlength="500" />
                            <button type="button" class="btn-primary" id="tp-attachments-url-add">Add link</button>
                        </div>
                    </details>
                </div>
                <div class="form-error" id="tp-attachments-error" role="alert" aria-live="polite"></div>
            </div>
            ${t.parentTaskId ? '' : `
                <div class="task-panel-subtasks" id="tp-subtasks-section">
                    <div class="task-panel-subtasks-head">
                        <h4>Subtasks</h4>
                        <button type="button" class="btn-secondary" id="tp-add-subtask-btn">+ Subtask</button>
                    </div>
                    <div class="task-panel-subtask-add" id="tp-subtask-add" hidden>
                        <input type="text" id="tp-subtask-name" placeholder="Subtask name" maxlength="200" autocomplete="off" />
                        <button type="button" class="btn-primary" id="tp-subtask-submit">Add</button>
                        <button type="button" class="btn-secondary" id="tp-subtask-cancel">Cancel</button>
                    </div>
                    <ul class="task-panel-subtask-list" id="tp-subtask-list"></ul>
                </div>
            `}
            <div class="task-panel-activity" id="tp-activity-section">
                <h4>Activity</h4>
                <ul class="task-panel-activity-list" id="tp-activity-list"></ul>
                <div class="task-panel-comments-composer">
                    <textarea id="tp-comment-text" rows="2" maxlength="2000" placeholder="Add a comment…"></textarea>
                    <div class="form-error" id="tp-comment-error" role="alert" aria-live="polite"></div>
                    <button type="button" class="btn-primary" id="tp-comment-submit">Post comment</button>
                </div>
            </div>
            <div class="task-panel-meta">
                Created ${escapeHtml(formatDateTime(t.createdAt))}
                ${t.completedAt ? `· Completed ${escapeHtml(formatDateTime(t.completedAt))}` : ''}
            </div>
        </div>
        <div class="task-panel-foot">
            <button type="button" class="btn-danger" id="tp-delete">Delete</button>
            <div class="task-panel-foot-right">
                <button type="button" class="btn-secondary" id="tp-cancel">Cancel</button>
                <button type="button" class="btn-primary" id="tp-save">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // Slide-in: add the open class on next frame so the transition runs
    requestAnimationFrame(() => {
        panel.classList.add('task-panel-open');
        backdrop.classList.add('task-panel-backdrop-open');
    });

    panel.querySelector('.task-panel-close').addEventListener('click', closeTaskPanel);
    panel.querySelector('#tp-cancel').addEventListener('click', closeTaskPanel);
    panel.querySelector('#tp-delete').addEventListener('click', () => deleteTaskWithSubtaskPrompt(t));
    panel.querySelector('#tp-save').addEventListener('click', () => onTaskPanelSave(t));

    wireDepsSection(panel, t);
    wireAttachmentsSection(panel, t);
    if (!t.parentTaskId) wireSubtaskSection(panel, t);
    wireActivitySection(panel, t);

    // Esc closes
    panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeTaskPanel(); }
    });
    panel.querySelector('#tp-name').focus();
}

/**
 * Wires the Dependencies section in the task panel. The picker lists other
 * tasks in the same project that aren't already a dep and aren't this task.
 * Cycle attempts surface a clear error in `#tp-deps-error` rather than being
 * silently filtered, so the user understands why the dep was rejected.
 */
function wireDepsSection(panel, task) {
    const picker = panel.querySelector('#tp-deps-picker');
    const addBtn = panel.querySelector('#tp-deps-add-btn');
    const errEl = panel.querySelector('#tp-deps-error');
    const list = panel.querySelector('#tp-deps-list');

    redrawDeps();

    addBtn.addEventListener('click', () => {
        const depId = picker.value;
        if (!depId) return;
        showDepsError('');
        if (wouldCreateCycle(getTasks(), task.id, depId)) {
            const dep = findTask(getTasks(), depId);
            const depName = dep ? dep.name : 'that task';
            showDepsError(`Cannot add dependency on "${depName}" — it would create a cycle.`);
            return;
        }
        if (!applyAddDependency(task.id, depId)) return;
        // Re-render the panel via the host render so the row badges + dep
        // list both reflect the new state. render() re-attaches the panel
        // from the latest task data via the openTaskPanelId guard.
        render();
    });

    function redrawDeps() {
        const tasks = getTasks();
        const fresh = findTask(tasks, task.id) || task;
        const deps = (fresh.dependsOn || [])
            .map(id => findTask(tasks, id))
            .filter(Boolean);

        // Build picker options: same project, not self, not already a dep
        const existingIds = new Set(fresh.dependsOn || []);
        const candidates = tasks.filter(t =>
            t.projectId === fresh.projectId &&
            t.id !== fresh.id &&
            !existingIds.has(t.id)
        );
        picker.innerHTML = '<option value="">— Add a dependency —</option>'
            + candidates.map(c =>
                `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}</option>`
            ).join('');

        if (deps.length === 0) {
            list.innerHTML = '<li class="task-panel-deps-empty">No dependencies.</li>';
            return;
        }
        list.innerHTML = '';
        deps.forEach(d => {
            const li = document.createElement('li');
            li.className = 'task-panel-dep' + (d.status === 'done' ? ' task-panel-dep-done' : '');
            li.innerHTML = `
                <span class="task-panel-dep-name">${escapeHtml(d.name)}</span>
                <span class="task-panel-dep-status status-${d.status}">${TASK_STATUS_LABELS[d.status] || d.status}</span>
                <button type="button" class="task-panel-dep-remove" aria-label="Remove dependency">×</button>
            `;
            li.querySelector('.task-panel-dep-remove').addEventListener('click', () => {
                if (!applyRemoveDependency(task.id, d.id)) return;
                render();
            });
            list.appendChild(li);
        });
    }

    function showDepsError(msg) {
        errEl.textContent = msg || '';
        errEl.style.display = msg ? '' : 'none';
    }
}

/**
 * Wires the Attachments section. Two attachment shapes per plan §3.4:
 *
 *   - file: drop-zone or file picker reads ≤500 KB into a base64 dataUri,
 *     stored inline on the task. Larger files are rejected at the input
 *     boundary with a clear size-limit message.
 *   - url: title + http(s) URL stored as a reference; opens in a new tab.
 *
 * Attachments render as chips with a download/open link plus a × remove
 * button. Both add and remove flow through applyAddAttachment / applyRemove
 * Attachment so they auto-log audit events. A cumulative-size warning surfaces
 * when inline files on this task exceed TASK_ATTACHMENT_WARN_SIZE (1 MB) so
 * the user knows they're approaching Firebase RTDB's practical row limit.
 */
function wireAttachmentsSection(panel, task) {
    const list = panel.querySelector('#tp-attachments-list');
    const warnEl = panel.querySelector('#tp-attachments-warn');
    const errEl = panel.querySelector('#tp-attachments-error');
    const dropzone = panel.querySelector('#tp-attachments-dropzone');
    const fileInput = panel.querySelector('#tp-attachments-file-input');
    const pickBtn = panel.querySelector('#tp-attachments-pick-btn');
    const urlNameEl = panel.querySelector('#tp-attachments-url-name');
    const urlUrlEl = panel.querySelector('#tp-attachments-url-url');
    const urlAddBtn = panel.querySelector('#tp-attachments-url-add');

    redrawAttachments();

    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
            ingestFile(fileInput.files[0]);
            fileInput.value = '';
        }
    });

    // Drag & drop. We listen on the dropzone but treat the panel as the
    // visual target — keeps the hover state subtle.
    ['dragenter', 'dragover'].forEach(ev => {
        dropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('task-panel-attachments-dropzone-active');
        });
    });
    ['dragleave', 'drop'].forEach(ev => {
        dropzone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('task-panel-attachments-dropzone-active');
        });
    });
    dropzone.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) ingestFile(f);
    });

    urlAddBtn.addEventListener('click', addUrl);
    urlUrlEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addUrl(); }
    });

    function ingestFile(file) {
        showError('');
        if (file.size > MAX_INLINE_ATTACHMENT_SIZE) {
            // Reject at the boundary so we never read an oversize file into memory
            showError(`File too large — limit is ${formatBytes(MAX_INLINE_ATTACHMENT_SIZE)}, "${file.name}" is ${formatBytes(file.size)}. Try adding a URL link instead.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const draft = {
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
                dataUri: reader.result,
                addedBy: currentUserEmail(),
            };
            const err = validateFileAttachment(draft);
            if (err) { showError(err); return; }
            const att = createFileAttachment(draft);
            applyAddAttachment(task.id, att);
            render();
        };
        reader.onerror = () => showError('Could not read file.');
        reader.readAsDataURL(file);
    }

    function addUrl() {
        showError('');
        const draft = {
            name: urlNameEl.value,
            url: urlUrlEl.value,
            addedBy: currentUserEmail(),
        };
        const err = validateUrlAttachment(draft);
        if (err) { showError(err); urlNameEl.focus(); return; }
        const att = createUrlAttachment(draft);
        applyAddAttachment(task.id, att);
        // Clear form and re-render
        urlNameEl.value = '';
        urlUrlEl.value = '';
        render();
    }

    function showError(msg) {
        errEl.textContent = msg || '';
        errEl.style.display = msg ? '' : 'none';
    }

    function redrawAttachments() {
        const fresh = findTask(getTasks(), task.id) || task;
        const items = Array.isArray(fresh.attachments) ? fresh.attachments : [];

        const total = taskAttachmentSize(fresh);
        if (total > TASK_ATTACHMENT_WARN_SIZE) {
            warnEl.hidden = false;
            warnEl.textContent = `⚠ ${formatBytes(total)} of inline files on this task. Consider URL links to keep saves fast.`;
        } else {
            warnEl.hidden = true;
            warnEl.textContent = '';
        }

        if (items.length === 0) {
            list.innerHTML = '<li class="task-panel-attachment-empty">No attachments.</li>';
            return;
        }
        list.innerHTML = '';
        items.forEach(a => list.appendChild(renderAttachmentItem(a)));
    }
}

function renderAttachmentItem(a) {
    const li = document.createElement('li');
    li.className = 'task-panel-attachment task-panel-attachment-' + (a.kind === 'url' ? 'url' : 'file');
    li.dataset.attachmentId = a.id;

    const icon = a.kind === 'url' ? '🔗' : '📎';
    const sub = a.kind === 'file'
        ? `${escapeHtml(formatBytes(a.size))} · ${escapeHtml(a.type || 'file')}`
        : escapeHtml(a.url);

    // Anchor: download for inline files (download attribute + dataUri href),
    // open-in-new-tab for URL refs.
    const anchorAttrs = a.kind === 'url'
        ? `href="${escapeAttr(a.url)}" target="_blank" rel="noopener noreferrer"`
        : `href="${escapeAttr(a.dataUri)}" download="${escapeAttr(a.name)}"`;

    li.innerHTML = `
        <span class="task-panel-attachment-icon" aria-hidden="true">${icon}</span>
        <a class="task-panel-attachment-name" ${anchorAttrs}>${escapeHtml(a.name || '(untitled)')}</a>
        <span class="task-panel-attachment-sub">${sub}</span>
        <button type="button" class="task-panel-attachment-remove" aria-label="Remove attachment">×</button>
    `;
    li.querySelector('.task-panel-attachment-remove').addEventListener('click', () => {
        if (!confirm(`Remove "${a.name}"?`)) return;
        applyRemoveAttachment(openTaskPanelId, a);
        render();
    });
    return li;
}

function wireSubtaskSection(panel, parent) {
    const addBtn = panel.querySelector('#tp-add-subtask-btn');
    const addRow = panel.querySelector('#tp-subtask-add');
    const nameEl = panel.querySelector('#tp-subtask-name');
    const submitBtn = panel.querySelector('#tp-subtask-submit');
    const cancelBtn = panel.querySelector('#tp-subtask-cancel');
    const list = panel.querySelector('#tp-subtask-list');

    addBtn.addEventListener('click', () => {
        addRow.hidden = false;
        addBtn.hidden = true;
        nameEl.focus();
    });
    cancelBtn.addEventListener('click', () => {
        addRow.hidden = true;
        addBtn.hidden = false;
        nameEl.value = '';
    });
    const submit = () => {
        const name = nameEl.value.trim();
        if (!name) { nameEl.focus(); return; }
        const sub = createTask({
            name,
            projectId: parent.projectId,
            parentTaskId: parent.id,
        });
        const err = validateTask(sub);
        if (err) { alert(err); return; }
        setTasks(addTaskToList(getTasks(), sub));
        nameEl.value = '';
        // Re-render the panel so the new subtask appears in its list, then
        // refocus the input so the user can keep adding.
        render();
        const refocused = document.querySelector('#tp-subtask-name');
        if (refocused) refocused.focus();
    };
    submitBtn.addEventListener('click', submit);
    nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    // Render existing subtasks (compact: name + status + delete)
    const subs = findSubtasks(getTasks(), parent.id)
        .slice()
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    if (subs.length === 0) {
        list.innerHTML = '<li class="task-panel-subtask-empty">No subtasks yet.</li>';
        return;
    }
    list.innerHTML = '';
    subs.forEach(s => {
        const li = document.createElement('li');
        li.className = 'task-panel-subtask' + (s.status === 'done' ? ' task-panel-subtask-done' : '');
        li.innerHTML = `
            <button type="button" class="task-panel-subtask-name" aria-label="Open subtask">${escapeHtml(s.name)}</button>
            <select class="task-panel-subtask-status status-${s.status}" aria-label="Status">
                ${TASK_STATUSES.map(st =>
                    `<option value="${st}"${st === s.status ? ' selected' : ''}>${TASK_STATUS_LABELS[st]}</option>`
                ).join('')}
            </select>
            <button type="button" class="task-panel-subtask-delete" aria-label="Delete subtask">×</button>
        `;
        li.querySelector('.task-panel-subtask-name').addEventListener('click', () => openTaskPanel(s.id));
        li.querySelector('.task-panel-subtask-status').addEventListener('change', (e) => {
            applyTaskPatch(s.id, { status: e.target.value });
            render();
        });
        li.querySelector('.task-panel-subtask-delete').addEventListener('click', () => {
            if (!confirm(`Delete subtask "${s.name}"?`)) return;
            setTasks(deleteTaskFromList(getTasks(), s.id));
            render();
        });
        list.appendChild(li);
    });
}

/**
 * Wires the Activity section in the task panel. Combined feed of audit
 * events (status/assignee/dueDate/dep changes — see TRACKED_FIELD_EVENT_KINDS)
 * and append-only comments, sorted by timestamp ascending so the newest
 * entry sits at the bottom right above the composer.
 *
 * Comments stay append-only (no edit/delete UI) because the feed is the
 * audit trail. Author of a new comment is the signed-in Firebase user's
 * email when available, else 'anonymous'.
 */
function wireActivitySection(panel, task) {
    const list = panel.querySelector('#tp-activity-list');
    const textEl = panel.querySelector('#tp-comment-text');
    const submitBtn = panel.querySelector('#tp-comment-submit');
    const errEl = panel.querySelector('#tp-comment-error');

    redrawActivity();

    const submit = () => {
        const text = textEl.value.trim();
        if (!text) {
            errEl.textContent = 'Comment cannot be empty.';
            errEl.style.display = '';
            textEl.focus();
            return;
        }
        errEl.textContent = '';
        errEl.style.display = 'none';
        const c = createComment({
            author: currentUserEmail(),
            text,
        });
        const next = addCommentToTask(getTasks(), task.id, c);
        if (next === getTasks()) return;
        setTasks(next);
        // render() re-attaches the panel from the latest task data via the
        // openTaskPanelId guard, so the new comment renders without a manual
        // redraw here.
        render();
    };
    submitBtn.addEventListener('click', submit);
    textEl.addEventListener('keydown', (e) => {
        // Ctrl/Cmd+Enter posts, plain Enter inserts a newline.
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
        }
    });

    function redrawActivity() {
        const tasks = getTasks();
        const fresh = findTask(tasks, task.id) || task;
        const comments = (Array.isArray(fresh.comments) ? fresh.comments : [])
            .map(c => ({ kind: 'comment', at: c.createdAt, data: c }));
        const events = (Array.isArray(fresh.events) ? fresh.events : [])
            .map(e => ({ kind: 'event', at: e.at, data: e }));
        const merged = comments.concat(events).sort(
            (a, b) => (a.at || '').localeCompare(b.at || '')
        );
        if (merged.length === 0) {
            list.innerHTML = '<li class="task-panel-comment-empty">No activity yet.</li>';
            return;
        }
        list.innerHTML = '';
        for (const entry of merged) {
            list.appendChild(
                entry.kind === 'comment'
                    ? renderCommentEntry(entry.data)
                    : renderEventEntry(entry.data, tasks)
            );
        }
    }
}

function renderCommentEntry(c) {
    const li = document.createElement('li');
    li.className = 'task-panel-comment';
    li.innerHTML = `
        <div class="task-panel-comment-meta">
            <span class="task-panel-comment-author">${escapeHtml(c.author || 'anonymous')}</span>
            <span class="task-panel-comment-time" title="${escapeAttr(formatDateTime(c.createdAt))}">${escapeHtml(formatRelativeTime(c.createdAt))}</span>
        </div>
        <div class="task-panel-comment-text">${escapeHtml(c.text)}</div>
    `;
    return li;
}

function renderEventEntry(e, tasks) {
    const li = document.createElement('li');
    li.className = 'task-panel-event';
    li.dataset.kind = e.kind;
    const summary = formatEventSummary(e, tasks);
    li.innerHTML = `
        <span class="task-panel-event-icon" aria-hidden="true">${eventIconFor(e.kind)}</span>
        <span class="task-panel-event-text">${summary}</span>
        <span class="task-panel-event-time" title="${escapeAttr(formatDateTime(e.at))}">${escapeHtml(formatRelativeTime(e.at))}</span>
    `;
    return li;
}

function eventIconFor(kind) {
    switch (kind) {
        case 'status_changed': return '↻';
        case 'assignee_changed': return '👤';
        case 'due_date_changed': return '📅';
        case 'dependency_added': return '🔗';
        case 'dependency_removed': return '✂';
        case 'attachment_added': return '📎';
        case 'attachment_removed': return '🗑';
        default: return '·';
    }
}

/**
 * Render an event as inline HTML. `before`/`after` semantics depend on kind:
 *   - status_changed / assignee_changed / due_date_changed: literal field values
 *   - dependency_added: `after` = depId; dependency_removed: `before` = depId
 * Looks up dep task names against the current task list — falls back to a
 * neutral label if the referenced task has been deleted.
 */
function formatEventSummary(e, tasks) {
    const author = `<strong>${escapeHtml(e.by || 'anonymous')}</strong>`;
    switch (e.kind) {
        case 'status_changed':
            return `${author} changed status from <em>${escapeHtml(TASK_STATUS_LABELS[e.before] || e.before || '—')}</em> to <em>${escapeHtml(TASK_STATUS_LABELS[e.after] || e.after || '—')}</em>`;
        case 'assignee_changed': {
            const before = e.before ? participantLabel(e.before) : 'unassigned';
            const after = e.after ? participantLabel(e.after) : 'unassigned';
            return `${author} changed assignee from <em>${escapeHtml(before)}</em> to <em>${escapeHtml(after)}</em>`;
        }
        case 'due_date_changed': {
            const before = e.before ? formatDate(e.before) : 'no due date';
            const after = e.after ? formatDate(e.after) : 'no due date';
            return `${author} changed due date from <em>${escapeHtml(before)}</em> to <em>${escapeHtml(after)}</em>`;
        }
        case 'dependency_added': {
            const dep = tasks.find(t => t.id === e.after);
            const name = dep ? dep.name : 'a deleted task';
            return `${author} added dependency on <em>${escapeHtml(name)}</em>`;
        }
        case 'dependency_removed': {
            const dep = tasks.find(t => t.id === e.before);
            const name = dep ? dep.name : 'a deleted task';
            return `${author} removed dependency on <em>${escapeHtml(name)}</em>`;
        }
        case 'attachment_added':
            return `${author} attached <em>${escapeHtml(e.after || 'a file')}</em>`;
        case 'attachment_removed':
            return `${author} removed attachment <em>${escapeHtml(e.before || 'a file')}</em>`;
        default:
            return `${author} ${escapeHtml(e.kind)}`;
    }
}

/** Best-effort author identity. Empty when no Firebase user (data layer falls back to 'anonymous'). */
function currentUserEmail() {
    return (currentUser && currentUser.email) || '';
}

/** "5 min ago" style. Falls back to absolute date for older items. */
function formatRelativeTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return iso;
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec} sec ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
    return formatDateTime(iso);
}

function onTaskPanelSave(orig) {
    const panel = document.getElementById('task-panel');
    if (!panel) return;
    const patch = {
        name: panel.querySelector('#tp-name').value.trim(),
        status: panel.querySelector('#tp-status').value,
        priority: panel.querySelector('#tp-priority').value,
        assignee: panel.querySelector('#tp-assignee').value || null,
        startDate: panel.querySelector('#tp-start').value || null,
        dueDate: panel.querySelector('#tp-due').value || null,
        description: panel.querySelector('#tp-desc').value,
        isMilestone: panel.querySelector('#tp-milestone').checked,
    };
    const merged = { ...orig, ...patch };
    const err = validateTask(merged);
    if (err) {
        const errEl = panel.querySelector('#tp-error');
        errEl.textContent = err;
        errEl.style.display = '';
        return;
    }
    applyTaskPatch(orig.id, patch);
    closeTaskPanel();
    render();
}

function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

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
