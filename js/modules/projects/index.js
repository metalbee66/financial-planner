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
import { currentUser, enqueueEmail, removeEmailQueueEntries } from '../../firebase-sync.js';
import {
    PROJECT_STATUSES,
    TASK_STATUSES,
    TASK_PRIORITIES,
    DEFAULT_PARTICIPANTS,
    isAdminUser,
    createProject,
    sanitiseProject,
    validateProject,
    addProjectToList,
    updateProjectInList,
    deleteProjectFromList,
    findProject,
    effectiveProjectStatus,
    readAssignees,
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
    computeTimelineRange,
    computeTaskBars,
    getMonthGridCells,
    bucketCalendarTasks,
    computeProjectProgress,
    countOverdueTasks,
    findNextMilestone,
    sortProjectsForOverview,
    OVERVIEW_SORT_OPTIONS,
    bucketTasksForUser,
    defaultMyTasksUser,
    collectMyTasksUserOptions,
    computeDashboardMetrics,
    computeWeeklyCompletionBars,
    DASHBOARD_WEEKS,
    DASHBOARD_CARD_VIEWS,
    collectAttachmentsByProject,
    saveProjects,
} from './data.js';
import {
    triggerCelebration,
    classifyCelebration,
    isCelebrationSoundEnabled,
    setCelebrationSoundEnabled,
} from './celebrate.js';
import {
    suggestTaskNames,
    suggestDueDate,
    composeDashboardDigest,
    isProjectStale,
    smartSortTasks,
} from './local-ai.js';
import {
    NOTIFICATION_KINDS,
    NOTIFICATION_MODES,
    eventToNotificationsForRecipients,
    candidateRecipientsForEvent,
    addNotificationToBucket,
    deriveDependencyUnblockedTriggers,
    createDefaultPrefs,
    sanitiseNotificationPrefs,
    shouldNotifyUser,
    shouldEnqueueInstantEmail,
    buildEmailQueueEntry,
    shouldAccumulateDigest,
    appendDigestEntry,
    buildDigestEntry,
    markNotificationRead,
    markAllNotificationsRead,
    unreadCount,
    getUserNotifications,
    EMAIL_QUEUE_STATUSES,
    ADMIN_QUEUE_PAGE_SIZE,
    classifyQueueEntry,
    countQueueByStatus,
    getQueueEntriesForAdmin,
    retryQueueEntry,
    clearSentOlderThan,
} from './notifications.js';

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

// 7.2.e — 'smart' is rendered alongside the data.js TASK_SORT_FIELDS but
// uses local-ai.smartSortTasks (a single ordering — direction toggle is hidden
// when active because urgency is inherently descending).
const TASK_SORT_LABELS = { dueDate: 'Due date', name: 'Name', priority: 'Priority', smart: 'Smart (urgency)' };
const SMART_SORT_KEY = 'smart';
const TASK_GROUP_LABELS = { none: 'None', status: 'Status', assignee: 'Assignee' };
const OVERVIEW_SORT_LABELS = {
    updated: 'Updated',
    status: 'Status',
    dueDate: 'Due date',
    percent: '% complete',
};
const DEFAULT_OVERVIEW_SORT = 'updated';
const DEFAULT_TASK_SORT = { by: 'dueDate', dir: 'asc' };
const DEFAULT_TASK_GROUP = 'none';
const DEFAULT_DETAIL_VIEW = 'list';
const DETAIL_VIEW_OPTIONS = [
    { value: 'list', label: 'List' },
    { value: 'timeline', label: 'Timeline' },
    { value: 'calendar', label: 'Calendar' },
];

const CAL_WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CAL_MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function todayIso() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function todayYearMonth() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

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
    refreshBell();
}

function ensureProjectsData() {
    if (!state.projectsData || !Array.isArray(state.projectsData.items)) {
        state.projectsData = { items: [], tasks: [], notifications: {} };
    }
    if (!Array.isArray(state.projectsData.tasks)) {
        state.projectsData.tasks = [];
    }
    if (!state.projectsData.notifications || typeof state.projectsData.notifications !== 'object' || Array.isArray(state.projectsData.notifications)) {
        state.projectsData.notifications = {};
    }
    if (!state.projectsData.prefs || typeof state.projectsData.prefs !== 'object' || Array.isArray(state.projectsData.prefs)) {
        state.projectsData.prefs = {};
    }
    if (!state.projectsData.digest_pending || typeof state.projectsData.digest_pending !== 'object' || Array.isArray(state.projectsData.digest_pending)) {
        state.projectsData.digest_pending = {};
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

function getNotifications() {
    ensureProjectsData();
    return state.projectsData.notifications;
}

function getPrefsMap() {
    ensureProjectsData();
    return state.projectsData.prefs;
}

function getDigestPending() {
    ensureProjectsData();
    return state.projectsData.digest_pending;
}

/** Resolve the current Family Planner participant id from the auth user. */
function currentUserId() {
    return defaultMyTasksUser(currentUserEmail());
}

/** Resolved prefs for the current user (defaults when nothing's saved yet). */
function currentUserPrefs() {
    const id = currentUserId();
    const map = getPrefsMap();
    return sanitiseNotificationPrefs(map[id] || null);
}

/** Persist prefs for one user into state + Firebase. */
function saveUserPrefs(userId, prefs) {
    ensureProjectsData();
    const nextPrefs = { ...getPrefsMap(), [userId]: sanitiseNotificationPrefs(prefs) };
    state.projectsData = { ...state.projectsData, prefs: nextPrefs };
    saveProjects(state.projectsData);
    refreshBell();
}

/** Persist the notifications bucket map (after mark-as-read mutations). */
function saveNotifications(nextMap) {
    ensureProjectsData();
    if (nextMap === getNotifications()) return;
    state.projectsData = { ...state.projectsData, notifications: nextMap };
    saveProjects(state.projectsData);
    refreshBell();
}

/**
 * Fold one or more trigger events into the per-user notification + digest
 * buckets without saving. Returns `{notifications, digest_pending}` — caller
 * persists both via a combined save with the originating mutation. Also
 * side-effects the email queue (Phase 6.3) for instant-mode recipients.
 *
 * Each trigger is `{event, task, project}`. Recipients are resolved per
 * trigger; each gets at most one bell entry + one email enqueue OR digest
 * append (mutually exclusive by `prefs.mode`).
 */
function foldTriggersIntoBuckets(triggers) {
    let notifMap = getNotifications();
    let digestMap = getDigestPending();
    const prefsMap = getPrefsMap();
    for (const t of triggers) {
        if (!t || !t.event || !t.task || !t.project) continue;
        const recipients = candidateRecipientsForEvent(t.event, t.task, t.project);
        const notifs = eventToNotificationsForRecipients(t.event, t.task, t.project, recipients);
        for (const n of notifs) {
            // Per-recipient prefs gate the bell entry. A user who turned the
            // kind off (or master off) doesn't see future events of that kind.
            // Prior-recorded notifications stay in their bucket — this is an
            // emission filter, not a retroactive purge.
            const userPrefs = prefsMap[n.to];
            if (!shouldNotifyUser(userPrefs, n.kind)) continue;
            notifMap = addNotificationToBucket(notifMap, n);
            // Phase 6.3: mirror "instant" notifications into the n8n-drained
            // email queue. External assignees without an email on file are
            // dropped here (participantEmail returns null).
            if (shouldEnqueueInstantEmail(userPrefs, n.kind)) {
                const entry = buildEmailQueueEntry(n, t.project, t.task);
                if (entry) enqueueEmail(entry);
            }
            // Phase 6.4: digest-mode users accumulate into digest_pending
            // instead of the email queue. The daily-8am n8n workflow drains
            // and clears each user's bucket.
            if (shouldAccumulateDigest(userPrefs, n.kind)) {
                digestMap = appendDigestEntry(digestMap, n.to, buildDigestEntry(n));
            }
        }
    }
    return { notifications: notifMap, digest_pending: digestMap };
}

/**
 * Apply one mutation + a set of audit events + their derived notifications
 * in a single save. `nextTasks` already has the events appended;
 * `triggers` is the set of notification trigger events to fan out.
 */
function commitTasksWithTriggers(nextTasks, triggers) {
    ensureProjectsData();
    const { notifications, digest_pending } = foldTriggersIntoBuckets(triggers);
    state.projectsData = { ...state.projectsData, tasks: nextTasks, notifications, digest_pending };
    saveProjects(state.projectsData);
}

/**
 * Patch a task and auto-log audit events for any tracked field that changed
 * (status / assignee / due-date — see TRACKED_FIELD_EVENT_KINDS in data.js).
 * Every UI site that mutates a task should go through here so the activity
 * feed stays consistent. One save per call — also folds in any notification
 * triggers (assignee changes, milestone completions, dep-unblock fan-out).
 */
function applyTaskPatch(taskId, patch) {
    const tasks = getTasks();
    const prev = findTask(tasks, taskId);
    if (!prev) return;
    const events = taskPatchEvents(prev, patch, currentUserEmail());
    let next = updateTaskInList(tasks, taskId, patch);
    for (const e of events) next = addEventToTask(next, taskId, e);
    const updatedTask = findTask(next, taskId) || prev;
    const project = findProject(getProjects(), updatedTask.projectId);
    const triggers = [];
    if (project) {
        for (const evt of events) {
            triggers.push({ event: evt, task: updatedTask, project });
            // Status → done can unblock dependents; fan out one trigger per.
            if (evt.kind === 'status_changed') {
                for (const unblock of deriveDependencyUnblockedTriggers(evt, updatedTask, next)) {
                    triggers.push({ event: unblock.event, task: unblock.task, project });
                }
            }
        }
    }
    commitTasksWithTriggers(next, triggers);
    // Phase 7.1: celebrate the moment a task flips into done. Project-level
    // "all tasks done" wins over milestone wins over light — classifyCelebration
    // handles the precedence.
    if (project && patch && Object.prototype.hasOwnProperty.call(patch, 'status')
        && patch.status === 'done' && prev.status !== 'done') {
        const projectTasks = findTasksByProject(next, project.id);
        const allDoneAfter = projectTasks.length > 0 && projectTasks.every(t => t.status === 'done');
        triggerCelebration({
            intensity: classifyCelebration({
                wasMilestone: prev.isMilestone === true,
                allTasksDoneAfter: allDoneAfter,
            }),
        });
    }
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
    commitTasksWithTriggers(addEventToTask(next, taskId, evt), []);
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
    commitTasksWithTriggers(addEventToTask(next, taskId, evt), []);
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
    commitTasksWithTriggers(addEventToTask(next, taskId, evt), []);
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
    commitTasksWithTriggers(addEventToTask(next, taskId, evt), []);
    return true;
}

/**
 * Append a comment + fan out the synthetic `comment_added` trigger in one
 * save. Returns the new task list (same-ref no-op if the task isn't found).
 */
function applyAddComment(taskId, comment) {
    const tasks = getTasks();
    const next = addCommentToTask(tasks, taskId, comment);
    if (next === tasks) return tasks;
    const task = findTask(next, taskId);
    const project = task && findProject(getProjects(), task.projectId);
    const trigger = task && project ? [{
        event: { kind: 'comment_added', by: comment.author, at: comment.createdAt, before: null, after: comment.id },
        task,
        project,
    }] : [];
    commitTasksWithTriggers(next, trigger);
    return next;
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

// ── List view (sub-tabs: Overview / My Tasks) ──

const LIST_SUBTABS_BASE = ['overview', 'mytasks', 'dashboard', 'files'];
const SUBTAB_LABELS = { overview: 'Overview', mytasks: 'My Tasks', dashboard: 'Dashboard', files: 'Files', admin: 'Admin' };

/**
 * Available sub-tabs for the current user. Admin is the only role-gated one;
 * everyone else sees a hidden tab. The shell calls this fresh on every render
 * so flipping admin status (e.g. via ADMIN_USER_IDS) takes effect immediately.
 */
function visibleListSubtabs() {
    return isAdminUser(currentUserId())
        ? LIST_SUBTABS_BASE.concat(['admin'])
        : LIST_SUBTABS_BASE;
}

function renderList() {
    const subtabs = visibleListSubtabs();
    const subtab = subtabs.includes(mode.listSubtab) ? mode.listSubtab : 'overview';
    host.innerHTML = `
        <div class="projects-subtabs" role="tablist" aria-label="Projects views">
            ${subtabs.map(id => `
                <button type="button" class="projects-subtab${subtab === id ? ' active' : ''}"
                    role="tab" aria-selected="${subtab === id}" data-subtab="${id}">${SUBTAB_LABELS[id]}</button>
            `).join('')}
        </div>
        <div class="projects-list-body" id="projects-list-body"></div>
    `;
    host.querySelectorAll('.projects-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.dataset.subtab;
            if (v && v !== subtab) {
                mode.listSubtab = v;
                render();
            }
        });
    });

    const body = host.querySelector('#projects-list-body');
    if (subtab === 'mytasks') {
        renderMyTasksBody(body);
    } else if (subtab === 'dashboard') {
        renderDashboardBody(body);
    } else if (subtab === 'files') {
        renderFilesBody(body);
    } else if (subtab === 'admin') {
        renderAdminBody(body);
    } else {
        renderOverviewBody(body);
    }
}

/**
 * Clone the project list with `status` set to its effective value (PB.7).
 * Pass-through for the original record otherwise. Callers feed this into
 * sort / metric helpers so derivation is the single read path.
 */
function resolveProjectStatuses(projects, allTasks) {
    if (!Array.isArray(projects)) return [];
    return projects.map(p => {
        const ptasks = (allTasks || []).filter(t => t.projectId === p.id);
        return { ...p, status: effectiveProjectStatus(p, ptasks) };
    });
}

function renderOverviewBody(root) {
    const items = getProjects().filter(p => !p.archivedAt);

    if (items.length === 0) {
        root.innerHTML = `
            <div class="projects-empty-state">
                <div class="projects-empty-icon">📋</div>
                <h2>No projects yet</h2>
                <p>Track work, milestones, and tasks across the family.</p>
                <button class="projects-new-btn" id="projects-new-btn">+ New Project</button>
            </div>
        `;
        root.querySelector('#projects-new-btn').addEventListener('click', goCreate);
        return;
    }

    const sortBy = mode.overviewSort && OVERVIEW_SORT_OPTIONS.includes(mode.overviewSort)
        ? mode.overviewSort
        : DEFAULT_OVERVIEW_SORT;

    root.innerHTML = `
        <div class="projects-toolbar">
            <h2 class="projects-title">Projects</h2>
            <label class="overview-sort-field">
                <span class="overview-sort-label">Sort</span>
                <select id="overview-sort-by" aria-label="Sort projects by">
                    ${OVERVIEW_SORT_OPTIONS.map(opt =>
                        `<option value="${opt}"${opt === sortBy ? ' selected' : ''}>${escapeHtml(OVERVIEW_SORT_LABELS[opt] || opt)}</option>`
                    ).join('')}
                </select>
            </label>
            <button class="projects-new-btn" id="projects-new-btn">+ New Project</button>
        </div>
        <div class="projects-grid" id="projects-grid"></div>
    `;
    root.querySelector('#projects-new-btn').addEventListener('click', goCreate);
    root.querySelector('#overview-sort-by').addEventListener('change', (e) => {
        mode.overviewSort = e.target.value;
        render();
    });

    const grid = root.querySelector('#projects-grid');
    const allTasks = getTasks();
    const today = todayIso();
    const resolved = resolveProjectStatuses(items, allTasks);
    sortProjectsForOverview(resolved, allTasks, { by: sortBy })
        .forEach(p => grid.appendChild(renderCard(p, allTasks, today)));
}

// ── My Tasks (Task 5.2): cross-project per-user summary ──

const MYTASKS_BUCKETS = [
    { key: 'overdue',   label: 'Overdue' },
    { key: 'thisWeek',  label: 'Due this week' },
    { key: 'upcoming',  label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
];

function renderMyTasksBody(root) {
    const allTasks = getTasks();
    const allProjects = getProjects();
    const userOptions = collectMyTasksUserOptions(allTasks);
    const selectedUser = mode.myTasksUser
        || defaultMyTasksUser(currentUserEmail());
    if (!mode.myTasksUser) mode.myTasksUser = selectedUser;
    const collapsed = mode.myTasksCollapsed || { completed: true };

    const buckets = bucketTasksForUser(allTasks, selectedUser, todayIso());
    const totalCount = buckets.overdue.length + buckets.thisWeek.length
        + buckets.upcoming.length + buckets.completed.length;

    root.innerHTML = `
        <div class="projects-toolbar">
            <h2 class="projects-title">My Tasks</h2>
            <label class="mytasks-user-field">
                <span class="overview-sort-label">User</span>
                <select id="mytasks-user-select" aria-label="Filter tasks by assignee">
                    ${userOptions.map(o =>
                        `<option value="${escapeAttr(o.value)}"${o.value === selectedUser ? ' selected' : ''}>${escapeHtml(participantLabel(o.value))}</option>`
                    ).join('')}
                </select>
            </label>
        </div>
        <div class="mytasks-sections" id="mytasks-sections"></div>
    `;

    root.querySelector('#mytasks-user-select').addEventListener('change', (e) => {
        mode.myTasksUser = e.target.value;
        render();
    });

    const sectionsHost = root.querySelector('#mytasks-sections');
    if (totalCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'mytasks-empty';
        empty.innerHTML = `<p>No tasks for ${escapeHtml(participantLabel(selectedUser))} yet.</p>`;
        sectionsHost.appendChild(empty);
    }

    const projectsById = new Map(allProjects.map(p => [p.id, p]));
    for (const b of MYTASKS_BUCKETS) {
        const items = buckets[b.key] || [];
        const isCollapsed = !!collapsed[b.key];
        const section = document.createElement('section');
        section.className = `mytasks-section${isCollapsed ? ' collapsed' : ''}`;
        section.dataset.bucket = b.key;
        section.innerHTML = `
            <button type="button" class="mytasks-section-header" aria-expanded="${!isCollapsed}">
                <span class="mytasks-section-toggle" aria-hidden="true">${isCollapsed ? '▸' : '▾'}</span>
                <span class="mytasks-section-label">${escapeHtml(b.label)}</span>
                <span class="mytasks-section-count">${items.length}</span>
            </button>
            <div class="mytasks-section-body"></div>
        `;
        const header = section.querySelector('.mytasks-section-header');
        header.addEventListener('click', () => {
            const next = { ...(mode.myTasksCollapsed || { completed: true }) };
            next[b.key] = !isCollapsed;
            mode.myTasksCollapsed = next;
            render();
        });
        const body = section.querySelector('.mytasks-section-body');
        if (items.length === 0) {
            const noneEl = document.createElement('div');
            noneEl.className = 'mytasks-section-empty';
            noneEl.textContent = 'Nothing here.';
            body.appendChild(noneEl);
        } else {
            for (const t of items) {
                body.appendChild(renderMyTasksRow(t, projectsById.get(t.projectId)));
            }
        }
        sectionsHost.appendChild(section);
    }
}

function renderMyTasksRow(task, project) {
    const row = document.createElement('div');
    row.className = `mytasks-task-row${task.status === 'done' ? ' mytasks-task-row-done' : ''}`;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Open task ${task.name}`);
    const due = task.dueDate ? formatDate(task.dueDate) : '';
    const statusLabel = TASK_STATUS_LABELS[task.status] || task.status;
    const milestone = task.isMilestone
        ? '<span class="mytasks-task-milestone" aria-label="Milestone">◆</span>'
        : '';
    row.innerHTML = `
        <span class="mytasks-task-project" title="${escapeAttr(project ? project.name : '')}">${escapeHtml(project ? project.name : '—')}</span>
        <span class="mytasks-task-name">${milestone}${escapeHtml(task.name)}</span>
        <span class="mytasks-task-due">${escapeHtml(due)}</span>
        <span class="mytasks-task-status status-badge status-${task.status}">${escapeHtml(statusLabel)}</span>
    `;
    row.addEventListener('click', () => openTaskPanel(task.id));
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openTaskPanel(task.id);
        }
    });
    return row;
}

// ── Dashboard (Task 5.3): high-level metrics across all projects ──

const DASHBOARD_CARDS = [
    { key: 'activeProjects',      label: 'Active projects' },
    { key: 'openTasks',           label: 'Open tasks' },
    { key: 'overdueTasks',        label: 'Overdue', flag: 'overdue' },
    { key: 'dueThisWeek',         label: 'Due this week' },
    { key: 'completedLast30Days', label: 'Completed (last 30d)' },
    { key: 'upcomingMilestones',  label: 'Upcoming milestones' },
];

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatBarLabel(iso) {
    if (!iso) return '';
    const [, m, d] = iso.split('-').map(Number);
    return `${MONTH_ABBR[(m || 1) - 1]} ${d || ''}`.trim();
}

function renderDashboardBody(root) {
    const today = todayIso();
    const allProjects = getProjects();
    const allTasks = getTasks();
    const resolvedProjects = resolveProjectStatuses(allProjects, allTasks);
    const metrics = computeDashboardMetrics(resolvedProjects, allTasks, today);
    const bars = computeWeeklyCompletionBars(allTasks, today, DASHBOARD_WEEKS);
    const drillView = mode.dashboardDrill || null;

    const cardsHtml = DASHBOARD_CARDS.map(card => {
        const value = metrics[card.key] || 0;
        const flagClass = card.flag === 'overdue' && value > 0 ? ' dashboard-card-flag' : '';
        const view = DASHBOARD_CARD_VIEWS[card.key];
        const clickable = !!view;
        const clickableClass = clickable ? ' dashboard-card-clickable' : '';
        const activeClass = clickable && view === drillView ? ' dashboard-card-active' : '';
        const buttonAttrs = clickable ? ' role="button" tabindex="0"' : '';
        return `
            <div class="dashboard-card${flagClass}${clickableClass}${activeClass}" data-metric="${card.key}"${buttonAttrs}>
                <div class="dashboard-card-value">${value}</div>
                <div class="dashboard-card-label">${escapeHtml(card.label)}</div>
            </div>
        `;
    }).join('');

    let bodyHtml;
    if (drillView) {
        const drillTasks = filterTasks(allTasks, { dashboardView: drillView, today, flat: true });
        bodyHtml = renderDashboardDrillHtml(drillView, drillTasks, allProjects);
    } else {
        bodyHtml = `
            <div class="dashboard-chart-card">
                <div class="dashboard-chart-head">
                    <h3 class="dashboard-chart-title">Tasks completed per week</h3>
                    <span class="dashboard-chart-sub">Last ${DASHBOARD_WEEKS} weeks</span>
                </div>
                ${renderWeeklyBarChart(bars)}
            </div>
        `;
    }

    // 7.2.c — plain-English daily digest paragraph above the cards.
    const digestText = composeDashboardDigest(allTasks, today);

    root.innerHTML = `
        <div class="projects-toolbar">
            <h2 class="projects-title">Dashboard</h2>
        </div>
        <p class="dashboard-digest" id="dashboard-digest">${escapeHtml(digestText)}</p>
        <div class="dashboard-cards" id="dashboard-cards">${cardsHtml}</div>
        ${bodyHtml}
    `;

    // PB.8: clickable cards toggle the drill — re-click the active card to close.
    root.querySelectorAll('.dashboard-card-clickable').forEach(el => {
        const view = DASHBOARD_CARD_VIEWS[el.dataset.metric];
        if (!view) return;
        const toggle = () => {
            mode.dashboardDrill = mode.dashboardDrill === view ? null : view;
            render();
        };
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });
    });

    const closeBtn = root.querySelector('#dashboard-drill-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            mode.dashboardDrill = null;
            render();
        });
    }

    root.querySelectorAll('.dashboard-drill-row').forEach(el => {
        const taskId = el.dataset.taskId;
        if (!taskId) return;
        const open = () => openTaskPanel(taskId);
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    });
}

const DASHBOARD_DRILL_LABELS = {
    open: 'Open tasks',
    overdue: 'Overdue',
    dueThisWeek: 'Due this week',
    completedLast30Days: 'Completed (last 30d)',
    upcomingMilestones: 'Upcoming milestones',
};

function renderDashboardDrillHtml(view, tasks, projects) {
    const projectNameFor = (pid) => {
        const p = projects.find(p => p.id === pid);
        return p ? p.name : '—';
    };
    const heading = DASHBOARD_DRILL_LABELS[view] || view;
    const rowsHtml = tasks.length === 0
        ? `<div class="dashboard-drill-empty">No tasks match.</div>`
        : tasks.map(t => {
            const due = t.dueDate ? formatDateOnly(t.dueDate) : '—';
            const statusLabel = TASK_STATUS_LABELS[t.status] || t.status;
            return `
                <div class="dashboard-drill-row" role="button" tabindex="0" data-task-id="${escapeAttr(t.id)}">
                    <span class="dashboard-drill-project" title="${escapeAttr(projectNameFor(t.projectId))}">${escapeHtml(projectNameFor(t.projectId))}</span>
                    <span class="dashboard-drill-name">${escapeHtml(t.name)}</span>
                    <span class="dashboard-drill-due">${escapeHtml(due)}</span>
                    <span class="dashboard-drill-status status-badge status-${t.status}">${escapeHtml(statusLabel)}</span>
                </div>
            `;
        }).join('');
    return `
        <div class="dashboard-drill">
            <div class="dashboard-drill-head">
                <h3 class="dashboard-drill-title">${escapeHtml(heading)}</h3>
                <button type="button" class="dashboard-drill-close" id="dashboard-drill-close" aria-label="Close drill-down">×</button>
            </div>
            <div class="dashboard-drill-list">${rowsHtml}</div>
        </div>
    `;
}

function renderWeeklyBarChart(bars) {
    if (!Array.isArray(bars) || bars.length === 0) {
        return `<div class="dashboard-chart-empty">No data yet.</div>`;
    }
    const max = bars.reduce((m, b) => Math.max(m, b.completed || 0), 0);
    // SVG viewBox is unitless — CSS scales it to the container width.
    const chartW = 400;
    const chartH = 120;
    const padTop = 8;
    const padBottom = 24;
    const innerH = chartH - padTop - padBottom;
    const slotW = chartW / bars.length;
    const barW = Math.max(8, slotW * 0.66);
    // Round the y-axis max up so the tallest bar never reaches the chart top
    // (otherwise its value label clips out of the viewBox). At least +1 unit of
    // headroom for the small-N case, ≥20% for the dominant-bucket case.
    const chartMax = max <= 0 ? 1 : Math.max(max + 1, Math.ceil(max * 1.2));
    const yScale = (n) => (n / chartMax) * innerH;

    const barsSvg = bars.map((b, i) => {
        const value = b.completed || 0;
        const h = yScale(value);
        const x = i * slotW + (slotW - barW) / 2;
        const y = padTop + innerH - h;
        const rx = 2;
        return `
            <g class="dashboard-bar-group" data-week-index="${i}">
                <title>Week of ${escapeHtml(formatBarLabel(b.startIso))} — ${value} completed</title>
                <rect class="dashboard-bar${value === 0 ? ' dashboard-bar-empty' : ''}"
                    x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0, h).toFixed(2)}" rx="${rx}" />
                ${value > 0 ? `<text class="dashboard-bar-value" x="${(x + barW / 2).toFixed(2)}" y="${(y - 4).toFixed(2)}" text-anchor="middle">${value}</text>` : ''}
                <text class="dashboard-bar-label" x="${(x + barW / 2).toFixed(2)}" y="${(chartH - 6).toFixed(2)}" text-anchor="middle">${escapeHtml(formatBarLabel(b.startIso))}</text>
            </g>
        `;
    }).join('');

    return `
        <svg class="dashboard-chart" viewBox="0 0 ${chartW} ${chartH}"
            role="img" aria-label="Tasks completed per week, last ${bars.length} weeks">
            ${barsSvg}
        </svg>
    `;
}

// ── Files (Task 5.4): cross-project attachments grouped by project ──

function renderFilesBody(root) {
    const groups = collectAttachmentsByProject(getProjects(), getTasks());
    const total = groups.reduce((n, g) => n + g.items.length, 0);

    root.innerHTML = `
        <div class="projects-toolbar">
            <h2 class="projects-title">Files</h2>
            <span class="files-total">${total === 0 ? 'No files yet' : `${total} attachment${total === 1 ? '' : 's'} across ${groups.length} project${groups.length === 1 ? '' : 's'}`}</span>
        </div>
        <div class="files-groups" id="files-groups"></div>
    `;

    const host = root.querySelector('#files-groups');
    if (groups.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'files-empty';
        empty.innerHTML = `<p>Attach a file or URL to any task and it will appear here.</p>`;
        host.appendChild(empty);
        return;
    }

    for (const g of groups) {
        const section = document.createElement('section');
        section.className = 'files-group';
        section.dataset.projectId = g.projectId;
        section.innerHTML = `
            <header class="files-group-head">
                <h3 class="files-group-name">${escapeHtml(g.projectName || '(unnamed project)')}</h3>
                <span class="files-group-count">${g.items.length}</span>
            </header>
            <div class="files-table" role="table">
                <div class="files-row files-row-head" role="row">
                    <span role="columnheader">Task</span>
                    <span role="columnheader">Name</span>
                    <span role="columnheader">Type</span>
                    <span role="columnheader">Size</span>
                    <span role="columnheader">Added by</span>
                    <span role="columnheader">Added on</span>
                </div>
            </div>
        `;
        const table = section.querySelector('.files-table');
        for (const item of g.items) {
            table.appendChild(renderFilesRow(item));
        }
        host.appendChild(section);
    }
}

function renderFilesRow(item) {
    const a = item.attachment;
    const row = document.createElement('div');
    row.className = 'files-row';
    row.setAttribute('role', 'row');
    row.tabIndex = 0;
    row.dataset.taskId = item.taskId;
    row.setAttribute('aria-label', `Open task ${item.taskName}`);

    const kindLabel = a.kind === 'url' ? 'URL' : 'File';
    const sizeLabel = a.kind === 'file' && Number.isFinite(a.size) && a.size > 0 ? formatBytes(a.size) : '—';
    const added = a.addedAt ? formatDate(a.addedAt) : '';
    const addedBy = a.addedBy || '';
    const name = a.name || '(unnamed)';

    row.innerHTML = `
        <span class="files-cell files-cell-task" title="${escapeAttr(item.taskName)}">${escapeHtml(item.taskName || '(untitled)')}</span>
        <span class="files-cell files-cell-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
        <span class="files-cell files-cell-kind">${escapeHtml(kindLabel)}</span>
        <span class="files-cell files-cell-size">${escapeHtml(sizeLabel)}</span>
        <span class="files-cell files-cell-by">${escapeHtml(addedBy)}</span>
        <span class="files-cell files-cell-when">${escapeHtml(added)}</span>
    `;
    row.addEventListener('click', () => openTaskPanel(item.taskId));
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openTaskPanel(item.taskId);
        }
    });
    return row;
}

function renderCard(p, allTasks, today) {
    const card = document.createElement('article');
    card.className = 'project-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open project ${p.name}`);

    const dateRange = formatDateRange(p.startDate, p.endDate);
    const participants = renderChipsHtml(p.participants);
    const tasks = allTasks || getTasks();
    const todayStr = today || todayIso();
    const progress = computeProjectProgress(p.id, tasks);
    const overdue = countOverdueTasks(p.id, tasks, todayStr);
    const nextMilestone = findNextMilestone(p.id, tasks, todayStr);

    const progressBar = progress.total > 0
        ? `<div class="project-card-progress" aria-label="${progress.percent}% complete">
                <div class="project-card-progress-bar"><div class="project-card-progress-fill" style="width:${progress.percent}%"></div></div>
                <span class="project-card-progress-label">${progress.percent}% · ${progress.done}/${progress.total} done</span>
            </div>`
        : '<div class="project-card-progress project-card-progress-empty">No tasks yet</div>';

    const milestoneStr = nextMilestone
        ? `<span class="project-card-milestone" title="Next milestone: ${escapeAttr(nextMilestone.name)}">◆ ${escapeHtml(formatDateOnly(nextMilestone.dueDate))}</span>`
        : '';
    const overdueStr = overdue > 0
        ? `<span class="project-card-overdue" aria-label="${overdue} overdue tasks">⚠ ${overdue} overdue</span>`
        : '';
    // 7.2.d — stale flag for projects with no activity in >14 days.
    const staleStr = isProjectStale(p, tasks, todayStr)
        ? `<span class="project-card-stale" title="No activity in over 14 days">⏳ Stale</span>`
        : '';

    card.innerHTML = `
        <div class="project-card-head">
            <h3 class="project-card-name">${escapeHtml(p.name)}</h3>
            <span class="status-badge status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
        </div>
        ${dateRange ? `<div class="project-card-dates">${escapeHtml(dateRange)}</div>` : ''}
        ${p.description ? `<p class="project-card-desc">${escapeHtml(p.description)}</p>` : ''}
        ${progressBar}
        ${(milestoneStr || overdueStr || staleStr) ? `<div class="project-card-flags">${milestoneStr}${overdueStr}${staleStr}</div>` : ''}
        <div class="project-card-foot">
            <div class="project-card-chips">${participants}</div>
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
    const activeView = mode.detailView || DEFAULT_DETAIL_VIEW;
    const effStatus = effectiveProjectStatus(p, allTasks);

    host.innerHTML = `
        <div class="projects-toolbar">
            <button class="projects-back-btn" id="projects-back-btn" aria-label="Back to projects">← Back</button>
            <h2 class="projects-title">${escapeHtml(p.name)}</h2>
            <span class="status-badge status-${effStatus}">${STATUS_LABELS[effStatus] || effStatus}</span>
            <button class="btn-secondary" id="projects-edit-btn">Edit project</button>
        </div>
        <div class="project-detail-meta">
            ${dateRange ? `<div class="project-detail-dates">${escapeHtml(dateRange)}</div>` : ''}
            <div class="project-detail-chips">${participants}</div>
            ${p.description ? `<p class="project-detail-desc">${escapeHtml(p.description)}</p>` : ''}
        </div>
        <div class="view-tabs" role="tablist" aria-label="Task views">
            ${DETAIL_VIEW_OPTIONS.map(opt => `
                <button type="button" class="view-tab${opt.value === activeView ? ' active' : ''}"
                    role="tab" aria-selected="${opt.value === activeView}"
                    data-view="${opt.value}">${escapeHtml(opt.label)}</button>
            `).join('')}
        </div>
        <div class="project-detail-tasks" id="project-detail-tasks"></div>
    `;

    host.querySelector('#projects-back-btn').addEventListener('click', goList);
    host.querySelector('#projects-edit-btn').addEventListener('click', () => goEdit(p.id));
    host.querySelectorAll('.view-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.dataset.view;
            if (v && v !== mode.detailView) {
                mode.detailView = v;
                render();
            }
        });
    });

    const body = host.querySelector('#project-detail-tasks');
    if (activeView === 'timeline') {
        renderTimelineBody(body, p, allTasks);
    } else if (activeView === 'calendar') {
        renderCalendarBody(body, p, allTasks);
    } else {
        renderListBody(body, p, allTasks);
    }
}

function isToolbarNonDefault(sort, group, filters) {
    if (sort.by !== DEFAULT_TASK_SORT.by || sort.dir !== DEFAULT_TASK_SORT.dir) return true;
    if (group !== DEFAULT_TASK_GROUP) return true;
    if (filters.assignee || filters.status || filters.milestonesOnly) return true;
    return false;
}

function renderListBody(root, p, allTasks) {
    const filters = mode.taskFilters || {};
    const sort = mode.taskSort || DEFAULT_TASK_SORT;
    const group = mode.taskGroup || DEFAULT_TASK_GROUP;
    const assigneeOptions = collectAssigneeOptions(p, allTasks);
    const openCount = allTasks.filter(t => t.status !== 'done').length;
    const totalCount = allTasks.length;

    root.innerHTML = `
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
                    ${TASK_SORT_FIELDS.concat([SMART_SORT_KEY]).map(f =>
                        `<option value="${f}"${f === sort.by ? ' selected' : ''}>${escapeHtml(TASK_SORT_LABELS[f] || f)}</option>`
                    ).join('')}
                </select>
                ${sort.by === SMART_SORT_KEY
                    ? ''
                    : `<button type="button" class="tasks-toolbar-dir" id="tasks-sort-dir" aria-label="Toggle sort direction" title="Toggle sort direction">${sort.dir === 'desc' ? '↓' : '↑'}</button>`}
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
            ${isToolbarNonDefault(sort, group, filters)
                ? `<button type="button" class="tasks-toolbar-reset" id="tasks-toolbar-reset" title="Reset sort, group, and filters">Reset</button>`
                : ''}
        </div>
        <div class="tasks-add-row" id="tasks-add-row"></div>
        <div class="tasks-list" id="tasks-list"></div>
    `;

    root.querySelector('#tasks-filter-milestones').addEventListener('change', (e) => {
        mode.taskFilters = { ...(mode.taskFilters || {}), milestonesOnly: e.target.checked };
        render();
    });
    root.querySelector('#tasks-sort-by').addEventListener('change', (e) => {
        mode.taskSort = { ...(mode.taskSort || DEFAULT_TASK_SORT), by: e.target.value };
        render();
    });
    const dirBtn = root.querySelector('#tasks-sort-dir');
    if (dirBtn) {
        dirBtn.addEventListener('click', () => {
            const cur = mode.taskSort || DEFAULT_TASK_SORT;
            mode.taskSort = { ...cur, dir: cur.dir === 'desc' ? 'asc' : 'desc' };
            render();
        });
    }
    root.querySelector('#tasks-group-by').addEventListener('change', (e) => {
        mode.taskGroup = e.target.value || DEFAULT_TASK_GROUP;
        render();
    });
    root.querySelector('#tasks-filter-assignee').addEventListener('change', (e) => {
        const v = e.target.value;
        mode.taskFilters = { ...(mode.taskFilters || {}), assignee: v ? v : null };
        render();
    });
    root.querySelector('#tasks-filter-status').addEventListener('change', (e) => {
        const v = e.target.value;
        mode.taskFilters = { ...(mode.taskFilters || {}), status: v ? v : null };
        render();
    });
    const resetBtn = root.querySelector('#tasks-toolbar-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            mode.taskFilters = {};
            mode.taskSort = { ...DEFAULT_TASK_SORT };
            mode.taskGroup = DEFAULT_TASK_GROUP;
            render();
        });
    }

    renderAddTaskRow(root.querySelector('#tasks-add-row'), p);
    const filteredTasks = filterTasks(allTasks, filters);
    renderTasksList(root.querySelector('#tasks-list'), p, filteredTasks, allTasks.length);
}

/**
 * Timeline (Gantt) view: month axis + per-task bars positioned by date.
 * Tasks without any date are surfaced as an "N unscheduled" count below the
 * chart rather than dropped silently. Empty-state when no task has dates.
 */
function renderTimelineBody(root, p, allTasks) {
    // Top-level only: subtasks roll up under their parent's row visually
    // (kept as flat rows for now — fancier nesting can come later).
    const range = computeTimelineRange(allTasks);
    const bars = computeTaskBars(allTasks, range);
    const unscheduled = allTasks.length - bars.length;

    if (!range) {
        root.innerHTML = `
            <div class="timeline-empty">No scheduled tasks yet. Add a start or due date to a task to see it on the timeline.</div>
        `;
        return;
    }

    // Sort bars left-to-right by start
    const ordered = bars.slice().sort((a, b) => {
        if (a.leftPct !== b.leftPct) return a.leftPct - b.leftPct;
        return (a.task.createdAt || '').localeCompare(b.task.createdAt || '');
    });

    const renderItem = (b) => {
        const dataId = escapeAttr(b.id);
        const tooltip = `${escapeAttr(b.name)} · ${escapeAttr(b.startDate)} → ${escapeAttr(b.dueDate)}`;
        if (b.isMilestone) {
            return `
                <div class="timeline-row" data-task-id="${dataId}">
                    <div class="timeline-row-label" title="${escapeAttr(b.name)}">${escapeHtml(b.name || '(untitled)')}</div>
                    <div class="timeline-row-track">
                        <button type="button" class="timeline-milestone status-${b.status}"
                            style="left:${b.leftPct}%"
                            data-task-id="${dataId}"
                            title="${tooltip}">
                            <span class="timeline-milestone-glyph" aria-hidden="true">◆</span>
                            <span class="timeline-milestone-name">${escapeHtml(b.name || '(untitled)')}</span>
                        </button>
                    </div>
                </div>`;
        }
        return `
            <div class="timeline-row" data-task-id="${dataId}">
                <div class="timeline-row-label" title="${escapeAttr(b.name)}">${escapeHtml(b.name || '(untitled)')}</div>
                <div class="timeline-row-track">
                    <button type="button" class="timeline-bar status-${b.status}"
                        style="left:${b.leftPct}%; width:${b.widthPct}%"
                        data-task-id="${dataId}"
                        title="${tooltip}">
                        <span class="timeline-bar-name">${escapeHtml(b.name || '(untitled)')}</span>
                    </button>
                </div>
            </div>`;
    };

    root.innerHTML = `
        <div class="timeline-container">
            <div class="timeline-axis" aria-hidden="true">
                ${range.months.map(m => `
                    <div class="timeline-axis-month" style="left:${m.leftPct}%; width:${m.widthPct}%">
                        ${escapeHtml(m.label)}
                    </div>
                `).join('')}
            </div>
            <div class="timeline-rows">
                ${ordered.map(renderItem).join('')}
            </div>
            ${unscheduled > 0
                ? `<div class="timeline-unscheduled">${unscheduled} unscheduled task${unscheduled === 1 ? '' : 's'} (no start or due date)</div>`
                : ''}
        </div>
    `;

    root.querySelectorAll('.timeline-bar, .timeline-milestone').forEach(btn => {
        btn.addEventListener('click', () => {
            const tid = btn.dataset.taskId;
            if (tid) openTaskPanel(tid);
        });
    });
}

/**
 * Calendar (month grid) view: 7-col × 5–6 row grid for `mode.calendarMonth` /
 * `mode.calendarYear`, with a navigation header (prev / month label / next /
 * "Today" reset). Tasks render as pills inside their day cell — full pill on
 * `dueDate`, dimmer pill on `startDate` for multi-day tasks. Clicking a pill
 * opens the task detail panel; clicking a day cell opens a day-detail
 * popover listing every task on that date.
 */
function renderCalendarBody(root, p, allTasks) {
    const year = mode.calendarYear;
    const month = mode.calendarMonth;
    const cells = getMonthGridCells(year, month, todayIso());
    const buckets = bucketCalendarTasks(allTasks);
    const selectedDate = mode.calendarSelectedDate;

    const monthLabel = `${CAL_MONTH_LABELS[month - 1]} ${year}`;

    const renderPill = (entry) => {
        const t = entry.task;
        const cls = entry.kind === 'start' ? 'cal-pill cal-pill-start' : 'cal-pill cal-pill-due';
        const ms = t.isMilestone ? '◆ ' : '';
        return `<button type="button" class="${cls} status-${t.status}"
            data-task-id="${escapeAttr(t.id)}" title="${escapeAttr(t.name)}">
            ${escapeHtml(ms + (t.name || '(untitled)'))}
        </button>`;
    };

    const renderCell = (cell) => {
        const entries = buckets.get(cell.date) || [];
        const classes = ['cal-day'];
        if (!cell.inMonth) classes.push('is-outside');
        if (cell.isToday) classes.push('is-today');
        if (cell.date === selectedDate) classes.push('is-selected');
        return `
            <div class="${classes.join(' ')}" data-date="${cell.date}">
                <div class="cal-day-number">${cell.day}</div>
                <div class="cal-pills">
                    ${entries.map(renderPill).join('')}
                </div>
            </div>`;
    };

    let popoverHtml = '';
    if (selectedDate) {
        const entries = buckets.get(selectedDate) || [];
        popoverHtml = `
            <div class="cal-day-popover" data-date="${selectedDate}">
                <div class="cal-day-popover-header">
                    <span class="cal-day-popover-date">${escapeHtml(formatPopoverDate(selectedDate))}</span>
                    <button type="button" class="cal-day-popover-close" aria-label="Close">×</button>
                </div>
                ${entries.length === 0
                    ? `<div class="cal-day-popover-empty">No tasks scheduled.</div>`
                    : `<ul class="cal-day-popover-list">${entries.map(e => `
                        <li><button type="button" class="cal-day-popover-task status-${e.task.status}"
                            data-task-id="${escapeAttr(e.task.id)}">
                            <span class="cal-day-popover-kind">${e.kind === 'start' ? 'Start' : 'Due'}</span>
                            <span class="cal-day-popover-name">${escapeHtml(e.task.name || '(untitled)')}</span>
                        </button></li>`).join('')}</ul>`}
            </div>`;
    }

    root.innerHTML = `
        <div class="cal-container">
            <div class="cal-month-header">
                <button type="button" class="cal-nav-prev" aria-label="Previous month" title="Previous month">‹</button>
                <span class="cal-month-header-label" role="heading" aria-level="3">${escapeHtml(monthLabel)}</span>
                <button type="button" class="cal-nav-next" aria-label="Next month" title="Next month">›</button>
                <button type="button" class="cal-nav-today btn-secondary">Today</button>
            </div>
            <div class="cal-weekday-header" aria-hidden="true">
                ${CAL_WEEKDAY_LABELS.map(w => `<div class="cal-weekday">${w}</div>`).join('')}
            </div>
            <div class="cal-grid">
                ${cells.map(renderCell).join('')}
            </div>
            ${popoverHtml}
        </div>
    `;

    root.querySelector('.cal-nav-prev').addEventListener('click', () => {
        const m = mode.calendarMonth - 1;
        if (m < 1) {
            mode.calendarMonth = 12;
            mode.calendarYear -= 1;
        } else {
            mode.calendarMonth = m;
        }
        mode.calendarSelectedDate = null;
        render();
    });
    root.querySelector('.cal-nav-next').addEventListener('click', () => {
        const m = mode.calendarMonth + 1;
        if (m > 12) {
            mode.calendarMonth = 1;
            mode.calendarYear += 1;
        } else {
            mode.calendarMonth = m;
        }
        mode.calendarSelectedDate = null;
        render();
    });
    root.querySelector('.cal-nav-today').addEventListener('click', () => {
        const ym = todayYearMonth();
        mode.calendarYear = ym.year;
        mode.calendarMonth = ym.month;
        mode.calendarSelectedDate = null;
        render();
    });

    // Pill click → open task panel (event delegated to bypass day-cell handler)
    root.querySelectorAll('.cal-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tid = btn.dataset.taskId;
            if (tid) openTaskPanel(tid);
        });
    });
    // Day cell click → toggle popover
    root.querySelectorAll('.cal-day').forEach(cell => {
        cell.addEventListener('click', () => {
            const date = cell.dataset.date;
            mode.calendarSelectedDate = (mode.calendarSelectedDate === date) ? null : date;
            render();
        });
    });
    // Popover close + popover task click
    const closeBtn = root.querySelector('.cal-day-popover-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            mode.calendarSelectedDate = null;
            render();
        });
    }
    root.querySelectorAll('.cal-day-popover-task').forEach(btn => {
        btn.addEventListener('click', () => {
            const tid = btn.dataset.taskId;
            if (tid) openTaskPanel(tid);
        });
    });
}

function formatPopoverDate(iso) {
    // 'YYYY-MM-DD' → 'Mon 15 Jun 2026'
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
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
        // PB.9: surface externals from the assignees array, not just legacy single field.
        for (const a of readAssignees(t)) add(a, participantLabel(a));
    });
    return out;
}

function renderAddTaskRow(root, project) {
    // 7.2.a — frequency-weighted autocomplete on the name input via <datalist>.
    // 7.2.b — median-offset due-date suggestion exposed as a small "Suggest" chip.
    const allTasksForHints = getTasks();
    const nameOptions = suggestTaskNames('', allTasksForHints, { limit: 12 });
    const suggestedDue = suggestDueDate(project, allTasksForHints, { todayIso: todayIso() });

    root.innerHTML = `
        <input type="text" class="task-add-name" id="task-add-name" placeholder="+ Add a task…" maxlength="200" autocomplete="off" list="task-name-suggestions" />
        <datalist id="task-name-suggestions">
            ${nameOptions.map(o => `<option value="${escapeAttr(o.name)}"></option>`).join('')}
        </datalist>
        <select class="task-add-assignee" id="task-add-assignee">
            <option value="">Unassigned</option>
            ${project.participants.map(p =>
                `<option value="${escapeAttr(p)}">${escapeHtml(participantLabel(p))}</option>`
            ).join('')}
        </select>
        <input type="date" class="task-add-due" id="task-add-due" aria-label="Due date" />
        ${suggestedDue
            ? `<button type="button" class="task-add-due-suggest" id="task-add-due-suggest" title="Apply suggested due date">Suggest: ${escapeHtml(formatDateOnly(suggestedDue))}</button>`
            : ''}
        <button type="button" class="btn-primary task-add-submit" id="task-add-submit">Add</button>
    `;
    const nameEl = root.querySelector('#task-add-name');
    const assigneeEl = root.querySelector('#task-add-assignee');
    const dueEl = root.querySelector('#task-add-due');
    const btn = root.querySelector('#task-add-submit');
    const suggestBtn = root.querySelector('#task-add-due-suggest');

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
        // v2.2: synthesise an assignee_changed trigger so creating a task
        // already-assigned to someone fires task_assigned (self-action is
        // filtered downstream by isSelfAction). No event written to
        // task.events[] — the initial assignment is implicit at creation,
        // not an audit-worthy mutation. Seeders bypass this path entirely.
        const triggers = t.assignees.length > 0
            ? [{
                event: createEvent({
                    kind: 'assignee_changed',
                    by: currentUserEmail(),
                    before: [],
                    after: t.assignees.slice(),
                }),
                task: t,
                project,
            }]
            : [];
        commitTasksWithTriggers(addTaskToList(getTasks(), t), triggers);
        render();
        // Restore focus to the name input for rapid entry
        const nx = host.querySelector('#task-add-name');
        if (nx) nx.focus();
    };
    btn.addEventListener('click', submit);
    nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    if (suggestBtn && suggestedDue) {
        suggestBtn.addEventListener('click', () => {
            dueEl.value = suggestedDue;
            nameEl.focus();
        });
    }
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
        // 7.2.e — smart sort is a separate code path: it consults the full
        // task list for dependency-blocking weight, and direction is fixed.
        const sortedOpen = sortOpts.by === SMART_SORT_KEY
            ? smartSortTasks(open, getTasks(), todayIso())
            : sortTasks(open, sortOpts);
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
    if (groupBy === 'assignee') {
        // PB.9: bucket keys are sorted-comma-joined assignees. Canonical
        // Brad+Diana pair renders as "Joint"; other multi-ID buckets render
        // their participant labels comma-joined.
        if (key === '') return 'Unassigned';
        const jointKey = DEFAULT_PARTICIPANTS.slice().sort().join(',');
        if (key === jointKey) return 'Joint';
        if (key.includes(',')) {
            return key.split(',').map(id => participantLabel(id)).join(', ');
        }
        return participantLabel(key);
    }
    return 'Tasks';
}

function renderTaskRow(t, project, isSubtask) {
    const row = document.createElement('div');
    row.className = 'task-row'
        + (t.status === 'done' ? ' task-row-done' : '')
        + (isSubtask ? ' task-row-subtask' : '')
        + (t.isMilestone ? ' task-row-milestone' : '');
    row.dataset.taskId = t.id;

    const assigneeHtml = renderAssigneeChipsHtml(t) || '<span class="task-row-unassigned">Unassigned</span>';

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

/**
 * Render the assignees of a task as one or more chip spans (PB.9). The
 * canonical Brad+Diana pair collapses into a single "Joint" chip; otherwise
 * one chip per assignee. Returns '' for an unassigned task so callers can
 * choose their own fallback (e.g. "Unassigned" placeholder vs blank).
 */
function renderAssigneeChipsHtml(task) {
    const ids = readAssignees(task);
    if (ids.length === 0) return '';
    const sorted = ids.slice().sort();
    const jointKey = DEFAULT_PARTICIPANTS.slice().sort().join(',');
    if (sorted.length === DEFAULT_PARTICIPANTS.length && sorted.join(',') === jointKey) {
        return `<span class="chip"><span class="chip-avatar">J</span><span class="chip-label">Joint</span></span>`;
    }
    return ids.map(id => {
        const isExternal = !DEFAULT_PARTICIPANTS.includes(id);
        const label = participantLabel(id);
        return `<span class="chip${isExternal ? ' chip-external' : ''}"><span class="chip-avatar">${escapeHtml(initialOf(label))}</span><span class="chip-label">${escapeHtml(label)}</span></span>`;
    }).join('');
}

// ── Form view (create or edit) ──

function renderForm() {
    const editing = mode.editingId
        ? findProject(getProjects(), mode.editingId)
        : null;
    const draft = editing
        ? sanitiseProject(editing)
        : createProject({});

    // PB.7: dropdown shows the effective status (what the user sees elsewhere) when
    // override is off, so toggling override on freezes that value into stored.
    const projectTasks = editing ? findTasksByProject(getTasks(), editing.id) : [];
    const initialStatus = draft.statusOverride
        ? draft.status
        : effectiveProjectStatus(draft, projectTasks);

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
                            `<option value="${s}"${s === initialStatus ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`
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
            <div class="form-row">
                <label class="project-form-override-toggle">
                    <input type="checkbox" id="pf-status-override"${draft.statusOverride ? ' checked' : ''} />
                    <span>Manage status manually (otherwise derive from task completion)</span>
                </label>
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

    // PB.7: on uncheck, snap the dropdown back to the value derivation would
    // produce (forcing statusOverride:false so we get the derived path even
    // when the loaded record has override on). Saving then writes that as
    // stored, keeping the displayed status stable across the toggle.
    const overrideBox = host.querySelector('#pf-status-override');
    const statusSelect = host.querySelector('#pf-status');
    overrideBox.addEventListener('change', () => {
        if (!overrideBox.checked) {
            statusSelect.value = effectiveProjectStatus({ ...draft, statusOverride: false }, projectTasks);
        }
    });

    if (!editing) {
        host.querySelector('#pf-name').focus();
    }
}

function readForm() {
    return {
        name: host.querySelector('#pf-name').value,
        status: host.querySelector('#pf-status').value,
        statusOverride: host.querySelector('#pf-status-override').checked,
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
        const before = findProject(getProjects(), editingId);
        const updatedItems = updateProjectInList(getProjects(), editingId, form);
        commitProjectsWithStatusTrigger(updatedItems, before, findProject(updatedItems, editingId));
        goAfterForm();
    } else {
        setProjects(addProjectToList(getProjects(), next));
        // For new projects, jump straight into the detail view so the user
        // can start adding tasks. detailProjectId wasn't set before save.
        goDetail(next.id);
    }
}

/**
 * Save the projects list and, if `after.status` transitioned to 'completed'
 * (from anything else), fan out a synthetic `project_completed` trigger to
 * every participant.
 */
function commitProjectsWithStatusTrigger(items, before, after) {
    ensureProjectsData();
    let triggers = [];
    const flippedToCompleted = after && before
        && after.status === 'completed' && before.status !== 'completed';
    if (flippedToCompleted) {
        // For project triggers, the "task" param of foldTriggersIntoBuckets
        // expects shape with id; passing the project itself works because
        // candidateRecipientsForEvent('project_completed') ignores the task
        // entirely. We pass a sentinel object so the same fold helper applies.
        triggers = [{
            event: { kind: 'project_completed', by: currentUserEmail(), at: new Date().toISOString(), before: before.status, after: after.status },
            task: { id: null },
            project: after,
        }];
    }
    const { notifications, digest_pending } = foldTriggersIntoBuckets(triggers);
    state.projectsData = { ...state.projectsData, items, notifications, digest_pending };
    saveProjects(state.projectsData);
    // Phase 7.1: explicit project→completed flip earns the full celebration.
    // The derived-from-last-task path already fires inside applyTaskPatch, so
    // we don't double-fire there.
    if (flippedToCompleted) triggerCelebration({ intensity: 'full' });
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
    const ym = todayYearMonth();
    return {
        view: 'list',
        editingId: null,
        detailProjectId: null,
        detailView: DEFAULT_DETAIL_VIEW,
        overviewSort: DEFAULT_OVERVIEW_SORT,
        listSubtab: 'overview',
        myTasksUser: null,
        myTasksCollapsed: { completed: true },
        dashboardDrill: null,
        taskFilters: {},
        taskSort: { ...DEFAULT_TASK_SORT },
        taskGroup: DEFAULT_TASK_GROUP,
        calendarYear: ym.year,
        calendarMonth: ym.month,
        calendarSelectedDate: null,
    };
}

function goList() {
    // Preserve list-level UI state across navigation back from a project so
    // the user's chosen sort / sub-tab / per-user filter survives a round-trip.
    const prev = mode || {};
    mode = freshListMode();
    if (prev.overviewSort) mode.overviewSort = prev.overviewSort;
    if (prev.listSubtab) mode.listSubtab = prev.listSubtab;
    if (prev.myTasksUser) mode.myTasksUser = prev.myTasksUser;
    if (prev.myTasksCollapsed) mode.myTasksCollapsed = prev.myTasksCollapsed;
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
    // Sort, grouping, filters and detailView reset when switching to a different
    // project so state from one project's view doesn't leak into another.
    // Same-project re-entry preserves toolbar + active view across renders.
    const sameProject = mode.detailProjectId === id;
    const ym = todayYearMonth();
    mode = {
        view: 'detail',
        editingId: null,
        detailProjectId: id,
        detailView: sameProject && mode.detailView ? mode.detailView : DEFAULT_DETAIL_VIEW,
        taskFilters: sameProject ? (mode.taskFilters || {}) : {},
        taskSort: sameProject && mode.taskSort ? mode.taskSort : { ...DEFAULT_TASK_SORT },
        taskGroup: sameProject && mode.taskGroup ? mode.taskGroup : DEFAULT_TASK_GROUP,
        calendarYear: sameProject && mode.calendarYear ? mode.calendarYear : ym.year,
        calendarMonth: sameProject && mode.calendarMonth ? mode.calendarMonth : ym.month,
        calendarSelectedDate: sameProject ? mode.calendarSelectedDate : null,
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
            <span class="task-panel-head-chips">${renderAssigneeChipsHtml(t)}</span>
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
                    <label>Assignees</label>
                    <div id="tp-assignees" class="task-panel-assignees-checkboxes" role="group" aria-label="Assignees">
                        ${assigneeOptions.map(p => `
                            <label class="task-panel-assignee-checkbox">
                                <input type="checkbox" value="${escapeAttr(p)}"${readAssignees(t).includes(p) ? ' checked' : ''} />
                                <span>${escapeHtml(participantLabel(p))}</span>
                            </label>
                        `).join('')}
                    </div>
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
        const triggers = sub.assignees.length > 0
            ? [{
                event: createEvent({
                    kind: 'assignee_changed',
                    by: currentUserEmail(),
                    before: [],
                    after: sub.assignees.slice(),
                }),
                task: sub,
                project: findProject(getProjects(), sub.projectId),
            }].filter(tg => tg.project)
            : [];
        commitTasksWithTriggers(addTaskToList(getTasks(), sub), triggers);
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
        const before = getTasks();
        const next = applyAddComment(task.id, c);
        if (next === before) return;
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
            // PB.9: before/after are arrays (new) or strings (legacy events). Joint
            // pair collapses to "Joint" in the audit just like in the row chip.
            const labelify = (v) => {
                const ids = Array.isArray(v) ? v : (v ? [v] : []);
                if (ids.length === 0) return 'unassigned';
                const jointKey = DEFAULT_PARTICIPANTS.slice().sort().join(',');
                if (ids.slice().sort().join(',') === jointKey) return 'Joint';
                return ids.map(participantLabel).join(', ');
            };
            const before = labelify(e.before);
            const after = labelify(e.after);
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
    const checked = Array.from(panel.querySelectorAll('#tp-assignees input[type="checkbox"]:checked'))
        .map(el => el.value);
    const patch = {
        name: panel.querySelector('#tp-name').value.trim(),
        status: panel.querySelector('#tp-status').value,
        priority: panel.querySelector('#tp-priority').value,
        assignees: checked,
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

// ── Notification bell + preferences modal (Task 6.2) ──

/**
 * The bell lives in the shell header (visible across all modules). It surfaces
 * the current user's unread count and the last MAX_NOTIFICATIONS_PER_USER
 * entries from `state.projectsData.notifications[userId]`. Clicking an entry
 * marks it read and asks the shell to navigate to the source task; the
 * settings cog opens a prefs modal that writes to `state.projectsData.prefs`.
 *
 * The shell mounts the bell once at boot; data-sync renders (firebase-sync
 * realtime listener → renderProjectsTab → refreshBell) keep it current.
 */
let bellHost = null;
let bellNavigateCallback = null;

const BELL_KIND_LABELS = {
    task_assigned: 'Task assigned to me',
    comment_added: 'New comment',
    dependency_unblocked: 'Dependency unblocked',
    task_due_soon: 'Due soon',
    task_overdue: 'Overdue',
    milestone_completed: 'Milestone completed',
    project_completed: 'Project completed',
};

const BELL_MODE_LABELS = { instant: 'Instant', digest: 'Daily digest' };

export function mountBell(opts) {
    const o = opts || {};
    if (!o.host) return;
    bellHost = o.host;
    bellNavigateCallback = typeof o.onActivateProjects === 'function' ? o.onActivateProjects : null;
    refreshBell();
}

/**
 * Public — called by firebase-sync on remote updates and after any local
 * write that touches notifications/prefs. Updates the button + badge in
 * place (so the dropdown stays open across mark-as-read clicks) and, if
 * the dropdown is open, re-renders its body too.
 */
export function refreshBell() {
    if (!bellHost) return;
    renderBellButton();
    if (bellDropdownOpen()) renderDropdownContent(document.getElementById('notif-bell-dropdown'));
}

function renderBellButton() {
    let btn = bellHost.querySelector('#notif-bell-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'notif-bell-btn';
        btn.className = 'notif-bell-btn';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', toggleBellDropdown);
        bellHost.appendChild(btn);
    }
    const unread = unreadCount(getNotifications(), currentUserId());
    const label = unread > 0 ? `Notifications (${unread} unread)` : 'Notifications';
    const badgeHtml = unread > 0
        ? `<span class="notif-bell-badge" aria-label="${unread} unread">${unread > 99 ? '99+' : unread}</span>`
        : '';
    btn.setAttribute('aria-label', label);
    btn.innerHTML = `<span class="notif-bell-icon" aria-hidden="true">🔔</span>${badgeHtml}`;
}

function bellDropdownOpen() {
    return !!document.getElementById('notif-bell-dropdown');
}

function toggleBellDropdown() {
    if (bellDropdownOpen()) {
        closeBellDropdown();
    } else {
        openBellDropdown();
    }
}

function openBellDropdown() {
    if (bellDropdownOpen()) return;
    const btn = bellHost && bellHost.querySelector('#notif-bell-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');

    const dropdown = document.createElement('div');
    dropdown.id = 'notif-bell-dropdown';
    dropdown.className = 'notif-bell-dropdown';
    dropdown.setAttribute('role', 'dialog');
    dropdown.setAttribute('aria-label', 'Notifications');
    bellHost.appendChild(dropdown);
    renderDropdownContent(dropdown);

    setTimeout(() => {
        document.addEventListener('click', onDocClickToCloseBell);
        document.addEventListener('keydown', onDocKeyToCloseBell);
    }, 0);
}

function renderDropdownContent(dropdown) {
    if (!dropdown) return;
    const userId = currentUserId();
    const list = getUserNotifications(getNotifications(), userId);
    const itemsHtml = list.length === 0
        ? `<div class="notif-empty">No notifications yet.</div>`
        : list.map(n => renderBellItemHtml(n)).join('');
    const allRead = list.length === 0 || list.every(n => n.read);
    dropdown.innerHTML = `
        <div class="notif-head">
            <span class="notif-head-title">Notifications</span>
            <button type="button" id="notif-mark-all" class="notif-mark-all" ${allRead ? 'disabled' : ''}>Mark all read</button>
            <button type="button" id="notif-prefs-btn" class="notif-prefs-btn" aria-label="Notification preferences" title="Preferences">⚙</button>
        </div>
        <div class="notif-list" id="notif-list">${itemsHtml}</div>
    `;
    dropdown.querySelector('#notif-mark-all').addEventListener('click', onBellMarkAllRead);
    dropdown.querySelector('#notif-prefs-btn').addEventListener('click', openPrefsModal);
    dropdown.querySelectorAll('.notif-item').forEach(el => {
        el.addEventListener('click', () => onBellItemClick(el.dataset.id));
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onBellItemClick(el.dataset.id);
            }
        });
    });
}

function closeBellDropdown() {
    const existing = document.getElementById('notif-bell-dropdown');
    if (existing) existing.remove();
    const btn = bellHost && bellHost.querySelector('#notif-bell-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClickToCloseBell);
    document.removeEventListener('keydown', onDocKeyToCloseBell);
}

function onDocClickToCloseBell(e) {
    if (!bellHost) return;
    // composedPath captures the original event path — robust to mid-bubble
    // DOM mutations (e.g. "Mark all read" re-renders the dropdown body).
    const path = (typeof e.composedPath === 'function') ? e.composedPath() : [e.target];
    if (path.includes(bellHost)) return;
    // Ignore clicks inside the prefs modal — it sits at document.body level.
    const modal = document.getElementById('notif-prefs-modal');
    if (modal && path.includes(modal)) return;
    closeBellDropdown();
}

function onDocKeyToCloseBell(e) {
    if (e.key === 'Escape') closeBellDropdown();
}

function renderBellItemHtml(n) {
    const cls = n.read ? 'notif-item' : 'notif-item notif-item-unread';
    return `
        <div class="${cls}" data-id="${escapeAttr(n.id)}" role="button" tabindex="0">
            <div class="notif-item-title">${escapeHtml(n.title || '')}</div>
            <div class="notif-item-summary">${escapeHtml(n.summary || '')}</div>
            <div class="notif-item-meta">
                <span class="notif-item-kind">${escapeHtml(BELL_KIND_LABELS[n.kind] || n.kind)}</span>
                <span class="notif-item-at">${escapeHtml(formatRelativeTime(n.at))}</span>
            </div>
        </div>
    `;
}

function onBellItemClick(id) {
    const userId = currentUserId();
    const map = getNotifications();
    const list = Array.isArray(map[userId]) ? map[userId] : [];
    const notif = list.find(n => n && n.id === id);
    if (!notif) return;
    const nextMap = markNotificationRead(map, userId, id);
    if (nextMap !== map) saveNotifications(nextMap);
    closeBellDropdown();
    if (notif.projectId) {
        if (typeof bellNavigateCallback === 'function') bellNavigateCallback();
        openTaskByIds(notif.projectId, notif.taskId);
    }
}

function onBellMarkAllRead() {
    const userId = currentUserId();
    const next = markAllNotificationsRead(getNotifications(), userId);
    if (next !== getNotifications()) saveNotifications(next);
}

/**
 * Cross-module navigation hook exposed to the shell. Activates the Projects
 * detail view and slides the task panel open. Safe to call with an unknown
 * id — falls back to the projects list.
 */
export function openTaskByIds(projectId, taskId) {
    if (!projectId) return;
    const project = findProject(getProjects(), projectId);
    if (!project) {
        goList();
        return;
    }
    goDetail(projectId);
    if (taskId && findTask(getTasks(), taskId)) {
        openTaskPanel(taskId);
    }
}

// ── Preferences modal ──

function openPrefsModal() {
    closePrefsModal();
    const userId = currentUserId();
    const prefs = currentUserPrefs();

    const backdrop = document.createElement('div');
    backdrop.id = 'notif-prefs-backdrop';
    backdrop.className = 'notif-prefs-backdrop';
    backdrop.addEventListener('click', closePrefsModal);
    document.body.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.id = 'notif-prefs-modal';
    modal.className = 'notif-prefs-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Notification preferences');
    modal.innerHTML = `
        <div class="notif-prefs-head">
            <h2>Notification preferences</h2>
            <button type="button" class="notif-prefs-close" aria-label="Close">×</button>
        </div>
        <div class="notif-prefs-body">
            <label class="notif-prefs-row">
                <input type="checkbox" id="np-master" ${prefs.master ? 'checked' : ''}/>
                <span>Master switch — receive notifications</span>
            </label>
            <fieldset class="notif-prefs-fieldset">
                <legend>Delivery mode</legend>
                ${NOTIFICATION_MODES.map(m => `
                    <label class="notif-prefs-row notif-prefs-radio">
                        <input type="radio" name="np-mode" value="${escapeAttr(m)}" ${prefs.mode === m ? 'checked' : ''}/>
                        <span>${escapeHtml(BELL_MODE_LABELS[m] || m)}</span>
                    </label>
                `).join('')}
            </fieldset>
            <fieldset class="notif-prefs-fieldset">
                <legend>Events</legend>
                ${NOTIFICATION_KINDS.map(k => `
                    <label class="notif-prefs-row">
                        <input type="checkbox" data-kind="${escapeAttr(k)}" ${prefs.kinds[k] ? 'checked' : ''}/>
                        <span>${escapeHtml(BELL_KIND_LABELS[k] || k)}</span>
                    </label>
                `).join('')}
            </fieldset>
            <fieldset class="notif-prefs-fieldset">
                <legend>Celebrations</legend>
                <label class="notif-prefs-row">
                    <input type="checkbox" id="np-celebrate-sound" ${isCelebrationSoundEnabled() ? 'checked' : ''}/>
                    <span>Play sound when a task is completed</span>
                </label>
            </fieldset>
        </div>
        <div class="notif-prefs-foot">
            <button type="button" id="np-cancel" class="notif-prefs-cancel">Cancel</button>
            <button type="button" id="np-save" class="notif-prefs-save">Save</button>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.notif-prefs-close').addEventListener('click', closePrefsModal);
    modal.querySelector('#np-cancel').addEventListener('click', closePrefsModal);
    modal.querySelector('#np-save').addEventListener('click', () => {
        const master = modal.querySelector('#np-master').checked;
        const mode = (modal.querySelector('input[name="np-mode"]:checked') || {}).value || 'instant';
        const kinds = {};
        modal.querySelectorAll('input[type="checkbox"][data-kind]').forEach(el => {
            kinds[el.dataset.kind] = el.checked;
        });
        saveUserPrefs(userId, { master, mode, kinds });
        setCelebrationSoundEnabled(modal.querySelector('#np-celebrate-sound').checked);
        closePrefsModal();
    });

    document.addEventListener('keydown', onPrefsKey);
}

function onPrefsKey(e) {
    if (e.key === 'Escape') closePrefsModal();
}

function closePrefsModal() {
    const m = document.getElementById('notif-prefs-modal');
    if (m) m.remove();
    const b = document.getElementById('notif-prefs-backdrop');
    if (b) b.remove();
    document.removeEventListener('keydown', onPrefsKey);
}

// ── Email-queue admin (Task 6.5) ──

/**
 * Days-ago threshold for the "Clear sent" sweep. Matches plan §6.5: "purges
 * items where sent=true and older than 7 days".
 */
const CLEAR_SENT_DAYS = 7;

const QUEUE_KIND_LABELS = {
    task_assigned: 'Task assigned',
    comment_added: 'New comment',
    dependency_unblocked: 'Unblocked',
    task_due_soon: 'Due soon',
    task_overdue: 'Overdue',
    milestone_completed: 'Milestone',
    project_completed: 'Project complete',
};

function loadEmailQueueMap() {
    try {
        const raw = localStorage.getItem('email_queue');
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (e) {
        console.error('admin loadEmailQueueMap parse error:', e);
    }
    return {};
}

/**
 * Render the admin sub-tab inside Projects. Lists the last 50 queue entries,
 * status-filterable, with a Retry button on failed items and a "Clear sent
 * older than N days" sweep button at the bottom.
 */
function renderAdminBody(root) {
    const map = loadEmailQueueMap();
    const counts = countQueueByStatus(map);
    const filter = mode.emailQueueFilter && EMAIL_QUEUE_STATUSES.includes(mode.emailQueueFilter)
        ? mode.emailQueueFilter
        : null;
    const entries = getQueueEntriesForAdmin(map, { status: filter });

    const pillsHtml = ['all'].concat(EMAIL_QUEUE_STATUSES).map(s => {
        const count = s === 'all' ? counts.total : counts[s];
        const label = s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1);
        const active = (filter === null && s === 'all') || (filter === s);
        return `<button type="button" class="admin-filter-pill${active ? ' active' : ''}" data-status="${escapeAttr(s)}">${escapeHtml(label)} (${count})</button>`;
    }).join('');

    const tableBodyHtml = entries.length === 0
        ? `<tr class="admin-empty-row"><td colspan="7">${counts.total === 0 ? 'Email queue is empty.' : 'No entries match this filter.'}</td></tr>`
        : entries.map(renderAdminRowHtml).join('');

    const sevenDaysAgo = isoDaysAgo(CLEAR_SENT_DAYS);
    const sentToClear = countSentOlderThan(map, sevenDaysAgo);

    root.innerHTML = `
        <div class="admin-toolbar">
            <h2 class="admin-title">Email queue</h2>
            <button type="button" id="admin-refresh-btn" class="btn-secondary" title="Refresh from storage">Refresh</button>
        </div>
        <div class="admin-filter-pills" role="tablist" aria-label="Filter by status">${pillsHtml}</div>
        <div class="admin-table-wrap">
            <table class="admin-table" aria-label="Email queue">
                <thead>
                    <tr>
                        <th>Queued</th>
                        <th>To</th>
                        <th>Kind</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Attempts</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="admin-table-body">${tableBodyHtml}</tbody>
            </table>
        </div>
        <div class="admin-foot">
            <button type="button" id="admin-clear-sent-btn" class="btn-secondary"${sentToClear === 0 ? ' disabled' : ''}>
                Clear ${sentToClear} sent ${sentToClear === 1 ? 'entry' : 'entries'} older than ${CLEAR_SENT_DAYS} days
            </button>
            <span class="admin-hint">Capped at last ${ADMIN_QUEUE_PAGE_SIZE} entries.</span>
        </div>
    `;

    root.querySelectorAll('.admin-filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.dataset.status;
            mode.emailQueueFilter = (v === 'all') ? null : v;
            renderAdminBody(root);
        });
    });
    root.querySelector('#admin-refresh-btn').addEventListener('click', () => renderAdminBody(root));
    root.querySelectorAll('.admin-retry-btn').forEach(btn => {
        btn.addEventListener('click', () => onAdminRetry(btn.dataset.id));
    });
    const clearBtn = root.querySelector('#admin-clear-sent-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => onAdminClearSent());
}

function renderAdminRowHtml(entry) {
    const status = classifyQueueEntry(entry);
    const kindLabel = QUEUE_KIND_LABELS[entry.kind] || entry.kind || '';
    const sentAt = entry.sentAt ? formatRelativeTime(entry.sentAt) : '';
    const actions = status === 'failed'
        ? `<button type="button" class="btn-secondary admin-retry-btn" data-id="${escapeAttr(entry.id)}">Retry</button>`
        : (status === 'sent' && sentAt ? `<span class="admin-sent-at" title="Sent">${escapeHtml(sentAt)}</span>` : '');
    return `
        <tr class="admin-row" data-id="${escapeAttr(entry.id)}" data-status="${escapeAttr(status)}">
            <td title="${escapeAttr(entry.queuedAt || '')}">${escapeHtml(formatRelativeTime(entry.queuedAt))}</td>
            <td>${escapeHtml(entry.to || '')}</td>
            <td>${escapeHtml(kindLabel)}</td>
            <td class="admin-subject">${escapeHtml(entry.subject || '')}</td>
            <td><span class="admin-status-pill admin-status-${status}">${escapeHtml(status)}</span></td>
            <td>${entry.attempts == null ? 0 : entry.attempts}</td>
            <td class="admin-actions">${actions}</td>
        </tr>
    `;
}

function onAdminRetry(id) {
    if (!id) return;
    const map = loadEmailQueueMap();
    const entry = map[id];
    if (!entry) return;
    const retried = retryQueueEntry(entry);
    enqueueEmail(retried);
    refreshAdminView();
}

function onAdminClearSent() {
    const sevenDaysAgo = isoDaysAgo(CLEAR_SENT_DAYS);
    const map = loadEmailQueueMap();
    const toRemove = Object.keys(map).filter(id => {
        const e = map[id];
        return e && e.sent && e.sentAt && e.sentAt < sevenDaysAgo;
    });
    if (toRemove.length === 0) return;
    removeEmailQueueEntries(toRemove);
    refreshAdminView();
}

/** Re-render the admin sub-tab if it's the active view. Idempotent + cheap. */
export function renderEmailQueueAdmin() {
    if (mode.view !== 'list' || mode.listSubtab !== 'admin') return;
    const body = host && host.querySelector('#projects-list-body');
    if (body) renderAdminBody(body);
}

function refreshAdminView() {
    const body = host && host.querySelector('#projects-list-body');
    if (body) renderAdminBody(body);
}

function countSentOlderThan(map, thresholdIso) {
    if (!map || !thresholdIso) return 0;
    let n = 0;
    for (const id in map) {
        const e = map[id];
        if (e && e.sent && e.sentAt && e.sentAt < thresholdIso) n++;
    }
    return n;
}

function isoDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
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
    if (startDate && endDate) return `${formatDateOnly(startDate)} → ${formatDateOnly(endDate)}`;
    if (startDate) return `from ${formatDateOnly(startDate)}`;
    return `until ${formatDateOnly(endDate)}`;
}

function formatDateOnly(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
