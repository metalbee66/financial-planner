/**
 * Tests for Projects module data layer.
 *
 * Pure functions only — DOM/Firebase paths are tested via manual smoke test.
 * Run via /tests.html in the dev server.
 *
 * Each `test(name, fn)` registers a case; `runProjectsDataTests()` executes
 * them and returns a `{ pass, fail, results }` summary.
 */

import {
    PROJECT_STATUSES,
    TASK_STATUSES,
    TASK_PRIORITIES,
    DEFAULT_PARTICIPANTS,
    createProject,
    validateProject,
    addProjectToList,
    updateProjectInList,
    deleteProjectFromList,
    findProject,
    sanitiseProject,
    effectiveProjectStatus,
    createTask,
    sanitiseTask,
    validateTask,
    addTaskToList,
    updateTaskInList,
    deleteTaskFromList,
    findTask,
    findTasksByProject,
    readAssignees,
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
    sortTasks,
    filterTasks,
    groupTopLevelTasks,
    TASK_SORT_FIELDS,
    TASK_GROUP_OPTIONS,
    DASHBOARD_CARD_VIEWS,
    DASHBOARD_VIEWS,
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
    collectAttachmentsByProject,
    emailToParticipantId,
    participantEmail,
    ADMIN_USER_IDS,
    isAdminUser,
} from './data.js';
import {
    NOTIFICATION_KINDS,
    MAX_NOTIFICATIONS_PER_USER,
    NOTIFICATION_MODES,
    eventToNotification,
    eventToNotificationsForRecipients,
    candidateRecipientsForEvent,
    deriveDependencyUnblockedTriggers,
    computeTimeBasedTriggers,
    addNotificationToBucket,
    processTrigger,
    createDefaultPrefs,
    sanitiseNotificationPrefs,
    shouldNotifyUser,
    markNotificationRead,
    markAllNotificationsRead,
    unreadCount,
    getUserNotifications,
    EMAIL_QUEUE_KEY,
    shouldEnqueueInstantEmail,
    buildEmailQueueEntry,
    shouldAccumulateDigest,
    appendDigestEntry,
    clearDigestForUser,
    composeDigestSummary,
    buildDigestEmail,
    EMAIL_QUEUE_STATUSES,
    ADMIN_QUEUE_PAGE_SIZE,
    classifyQueueEntry,
    countQueueByStatus,
    getQueueEntriesForAdmin,
    retryQueueEntry,
    clearSentOlderThan,
} from './notifications.js';
import {
    CELEBRATION_INTENSITIES,
    CELEBRATION_VARIANTS,
    classifyCelebration,
    pickCelebrationVariant,
    __resetCelebrationQueues,
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
import { migratePMDLBooksToProjects } from './migrate-pm.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg || 'eq'}: expected ${e}, got ${a}`);
}
function truthy(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function falsy(v, msg) { if (v) throw new Error(msg || 'expected falsy, got ' + JSON.stringify(v)); }

// ── createProject ──

test('createProject populates id, timestamps, defaults', () => {
    const p = createProject({ name: 'Reno' });
    truthy(p.id && p.id.startsWith('p_'), 'id should start with p_');
    truthy(p.createdAt, 'createdAt set');
    truthy(p.updatedAt, 'updatedAt set');
    eq(p.createdAt, p.updatedAt, 'on create, updatedAt === createdAt');
    eq(p.status, 'planning', 'default status is planning');
    eq(p.participants, DEFAULT_PARTICIPANTS, 'default participants');
    eq(p.archivedAt, null, 'archivedAt null on create');
});

test('createProject trims name and description', () => {
    const p = createProject({ name: '  Garden  ', description: '  hello  ' });
    eq(p.name, 'Garden');
    eq(p.description, 'hello');
});

test('createProject accepts a valid status', () => {
    const p = createProject({ name: 'X', status: 'active' });
    eq(p.status, 'active');
});

test('createProject falls back to planning for an unknown status', () => {
    const p = createProject({ name: 'X', status: 'bogus' });
    eq(p.status, 'planning');
});

test('createProject ids are unique across rapid calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(createProject({ name: 'X' }).id);
    eq(ids.size, 50, 'all ids unique');
});

// PB.7

test('createProject defaults statusOverride to false', () => {
    const p = createProject({ name: 'X' });
    eq(p.statusOverride, false);
});

test('createProject accepts an explicit statusOverride', () => {
    eq(createProject({ name: 'X', statusOverride: true }).statusOverride, true);
    eq(createProject({ name: 'X', statusOverride: false }).statusOverride, false);
});

test('createProject coerces non-boolean statusOverride to false', () => {
    eq(createProject({ name: 'X', statusOverride: 'yes' }).statusOverride, false);
    eq(createProject({ name: 'X', statusOverride: 1 }).statusOverride, false);
});

test('createProject preserves caller-supplied participants', () => {
    const p = createProject({ name: 'X', participants: ['brad'] });
    eq(p.participants, ['brad']);
});

// ── validateProject ──

test('validateProject rejects missing/empty name', () => {
    truthy(validateProject({ ...createProject({ name: 'tmp' }), name: '' }));
    truthy(validateProject({ ...createProject({ name: 'tmp' }), name: '   ' }));
});

test('validateProject rejects end before start', () => {
    const p = createProject({ name: 'X', startDate: '2026-05-01', endDate: '2026-04-01' });
    truthy(validateProject(p), 'end<start should produce error');
});

test('validateProject accepts equal start and end', () => {
    const p = createProject({ name: 'X', startDate: '2026-05-01', endDate: '2026-05-01' });
    falsy(validateProject(p), 'end==start should pass');
});

test('validateProject accepts open dates (no start, no end, or only one)', () => {
    falsy(validateProject(createProject({ name: 'X' })));
    falsy(validateProject(createProject({ name: 'X', startDate: '2026-05-01' })));
    falsy(validateProject(createProject({ name: 'X', endDate: '2026-05-01' })));
});

test('validateProject rejects unknown status', () => {
    const p = createProject({ name: 'X' });
    p.status = 'nonsense';
    truthy(validateProject(p));
});

test('validateProject rejects empty participants', () => {
    const p = createProject({ name: 'X' });
    p.participants = [];
    truthy(validateProject(p));
});

test('PROJECT_STATUSES exposes the planned enum', () => {
    eq(PROJECT_STATUSES, ['planning', 'active', 'on-hold', 'completed', 'cancelled']);
});

test('validateProject rejects non-boolean statusOverride', () => {
    const p = createProject({ name: 'X' });
    p.statusOverride = 'yes';
    truthy(validateProject(p));
});

// ── list mutators ──

test('addProjectToList appends and returns new list (immutable input)', () => {
    const before = [createProject({ name: 'A' })];
    const added = createProject({ name: 'B' });
    const after = addProjectToList(before, added);
    eq(after.length, 2);
    eq(after[1].id, added.id);
    eq(before.length, 1, 'original list unchanged');
});

test('updateProjectInList replaces by id and bumps updatedAt', async () => {
    const p = createProject({ name: 'A' });
    const list = [p];
    // Tiny delay so updatedAt can differ from createdAt
    await new Promise(r => setTimeout(r, 5));
    const next = updateProjectInList(list, p.id, { name: 'A renamed' });
    eq(next[0].name, 'A renamed');
    eq(next[0].id, p.id);
    truthy(next[0].updatedAt >= p.updatedAt, 'updatedAt should not regress');
    eq(list[0].name, 'A', 'original list unchanged');
});

test('updateProjectInList returns the same list ref when id missing', () => {
    const list = [createProject({ name: 'A' })];
    const next = updateProjectInList(list, 'no-such-id', { name: 'X' });
    eq(next, list);
});

test('deleteProjectFromList removes by id', () => {
    const a = createProject({ name: 'A' });
    const b = createProject({ name: 'B' });
    const next = deleteProjectFromList([a, b], a.id);
    eq(next.length, 1);
    eq(next[0].id, b.id);
});

test('findProject returns matching item or null', () => {
    const a = createProject({ name: 'A' });
    eq(findProject([a], a.id).name, 'A');
    eq(findProject([a], 'nope'), null);
});

// ── sanitiseProject ──

test('sanitiseProject backfills missing fields on legacy data', () => {
    const legacy = { id: 'p_legacy', name: 'Old' };
    const fixed = sanitiseProject(legacy);
    eq(fixed.status, 'planning');
    eq(fixed.participants, DEFAULT_PARTICIPANTS);
    eq(fixed.startDate, null);
    eq(fixed.endDate, null);
    eq(fixed.description, '');
    truthy(fixed.createdAt, 'creation timestamp present');
    truthy(fixed.updatedAt, 'update timestamp present');
    eq(fixed.archivedAt, null);
});

test('sanitiseProject preserves valid fields', () => {
    const p = createProject({ name: 'X', status: 'active' });
    const out = sanitiseProject(p);
    eq(out.id, p.id);
    eq(out.status, 'active');
    eq(out.createdAt, p.createdAt);
});

// PB.7 — sanitiseProject statusOverride defaults

test('sanitiseProject defaults statusOverride=false for derivable statuses (legacy records)', () => {
    eq(sanitiseProject({ id: 'p_a', name: 'A', status: 'planning' }).statusOverride, false);
    eq(sanitiseProject({ id: 'p_a', name: 'A', status: 'active' }).statusOverride, false);
    eq(sanitiseProject({ id: 'p_a', name: 'A', status: 'completed' }).statusOverride, false);
});

test('sanitiseProject defaults statusOverride=true for on-hold / cancelled (legacy records)', () => {
    eq(sanitiseProject({ id: 'p_a', name: 'A', status: 'on-hold' }).statusOverride, true);
    eq(sanitiseProject({ id: 'p_a', name: 'A', status: 'cancelled' }).statusOverride, true);
});

test('sanitiseProject preserves an explicit statusOverride regardless of status', () => {
    eq(sanitiseProject({ id: 'p_a', name: 'A', status: 'on-hold', statusOverride: false }).statusOverride, false);
    eq(sanitiseProject({ id: 'p_a', name: 'A', status: 'planning', statusOverride: true }).statusOverride, true);
});

// ── effectiveProjectStatus (PB.7) ──

// Build a task with just the status field — effectiveProjectStatus only reads `status`.
function statusTask(s) { return { status: s }; }

test('effectiveProjectStatus returns stored status when override is on', () => {
    const p = createProject({ name: 'X', status: 'on-hold', statusOverride: true });
    eq(effectiveProjectStatus(p, [statusTask('done'), statusTask('done')]), 'on-hold');
});

test('effectiveProjectStatus returns stored status when override is on (cancelled)', () => {
    const p = createProject({ name: 'X', status: 'cancelled', statusOverride: true });
    eq(effectiveProjectStatus(p, [statusTask('not-started')]), 'cancelled');
});

test('effectiveProjectStatus returns stored status with empty/missing task list', () => {
    const p = createProject({ name: 'X', status: 'active' });
    eq(effectiveProjectStatus(p, []), 'active');
    eq(effectiveProjectStatus(p, null), 'active');
    eq(effectiveProjectStatus(p, undefined), 'active');
});

test('effectiveProjectStatus derives planning when no tasks are done', () => {
    const p = createProject({ name: 'X', status: 'active' });
    eq(effectiveProjectStatus(p, [statusTask('not-started'), statusTask('in-progress')]), 'planning');
});

test('effectiveProjectStatus derives active when some tasks are done', () => {
    const p = createProject({ name: 'X', status: 'planning' });
    eq(effectiveProjectStatus(p, [statusTask('done'), statusTask('in-progress')]), 'active');
});

test('effectiveProjectStatus derives completed when all tasks are done', () => {
    const p = createProject({ name: 'X', status: 'planning' });
    eq(effectiveProjectStatus(p, [statusTask('done'), statusTask('done')]), 'completed');
});

test('effectiveProjectStatus derives even when stored status is on-hold but override is off', () => {
    // Sanitiser would have set override=true for a legacy on-hold record, but if the user
    // explicitly toggles override off, derivation must win.
    const p = { ...createProject({ name: 'X', status: 'on-hold' }), statusOverride: false };
    eq(effectiveProjectStatus(p, [statusTask('done')]), 'completed');
});

// ── createTask ──

test('createTask populates id, timestamps, defaults', () => {
    const t = createTask({ name: 'Buy seeds', projectId: 'p_x' });
    truthy(t.id && t.id.startsWith('t_'), 'id should start with t_');
    eq(t.projectId, 'p_x');
    eq(t.status, 'not-started');
    eq(t.priority, 'normal');
    eq(t.dependsOn, []);
    eq(t.comments, []);
    eq(t.events, []);
    eq(t.attachments, []);
    eq(t.parentTaskId, null);
    eq(t.completedAt, null);
    truthy(t.createdAt, 'createdAt set');
    eq(t.createdAt, t.updatedAt, 'updatedAt === createdAt on create');
});

test('createTask trims name and description', () => {
    const t = createTask({ name: '  Plant  ', description: '  notes  ', projectId: 'p_x' });
    eq(t.name, 'Plant');
    eq(t.description, 'notes');
});

test('createTask falls back to defaults for unknown enums', () => {
    const t = createTask({ name: 'X', projectId: 'p_x', status: 'bogus', priority: 'urgent' });
    eq(t.status, 'not-started');
    eq(t.priority, 'normal');
});

test('createTask ids are unique across rapid calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(createTask({ name: 'X', projectId: 'p' }).id);
    eq(ids.size, 50);
});

// PB.9 — assignees array (replaces legacy assignee string)

test('createTask defaults assignees to an empty array', () => {
    const t = createTask({ name: 'X', projectId: 'p' });
    eq(t.assignees, []);
});

test('createTask accepts an explicit assignees array', () => {
    const t = createTask({ name: 'X', projectId: 'p', assignees: ['brad', 'diana'] });
    eq(t.assignees, ['brad', 'diana']);
});

test('createTask backfills assignees from legacy single assignee input', () => {
    const t = createTask({ name: 'X', projectId: 'p', assignee: 'brad' });
    eq(t.assignees, ['brad']);
});

test('createTask stops writing the legacy assignee field', () => {
    const t = createTask({ name: 'X', projectId: 'p', assignee: 'brad' });
    truthy(!('assignee' in t), 'no legacy assignee field on new tasks');
});

test('TASK_STATUSES exposes the planned enum', () => {
    eq(TASK_STATUSES, ['not-started', 'in-progress', 'review', 'done', 'blocked']);
});

test('TASK_PRIORITIES exposes the planned enum', () => {
    eq(TASK_PRIORITIES, ['low', 'normal', 'high']);
});

// ── validateTask ──

test('validateTask rejects missing name', () => {
    const t = createTask({ name: '', projectId: 'p' });
    truthy(validateTask(t));
});

test('validateTask rejects missing projectId', () => {
    const t = createTask({ name: 'X', projectId: '' });
    truthy(validateTask(t));
});

test('validateTask rejects unknown status/priority', () => {
    const t = createTask({ name: 'X', projectId: 'p' });
    t.status = 'nope';
    truthy(validateTask(t));
    const t2 = createTask({ name: 'X', projectId: 'p' });
    t2.priority = 'nope';
    truthy(validateTask(t2));
});

test('validateTask rejects due before start', () => {
    const t = createTask({ name: 'X', projectId: 'p', startDate: '2026-05-10', dueDate: '2026-05-01' });
    truthy(validateTask(t));
});

test('validateTask accepts equal start and due', () => {
    const t = createTask({ name: 'X', projectId: 'p', startDate: '2026-05-10', dueDate: '2026-05-10' });
    falsy(validateTask(t));
});

// PB.9 — validateTask works against the new assignees array

test('validateTask rejects non-array assignees', () => {
    const t = createTask({ name: 'X', projectId: 'p' });
    t.assignees = 'brad';
    truthy(validateTask(t));
});

test('validateTask rejects non-string members in assignees', () => {
    const t = createTask({ name: 'X', projectId: 'p' });
    t.assignees = ['brad', 42];
    truthy(validateTask(t));
});

test('validateTask accepts an empty assignees array (unassigned is valid)', () => {
    const t = createTask({ name: 'X', projectId: 'p' });
    eq(t.assignees, []);
    falsy(validateTask(t));
});

// PB.9 — readAssignees defensively returns the canonical array

test('readAssignees returns the assignees array when non-empty', () => {
    eq(readAssignees({ assignees: ['brad', 'diana'] }), ['brad', 'diana']);
});

test('readAssignees backfills from legacy assignee string', () => {
    eq(readAssignees({ assignee: 'brad' }), ['brad']);
});

test('readAssignees prefers a non-empty assignees array over legacy', () => {
    eq(readAssignees({ assignees: ['diana'], assignee: 'brad' }), ['diana']);
});

test('readAssignees returns empty array for missing/null/empty', () => {
    eq(readAssignees(null), []);
    eq(readAssignees(undefined), []);
    eq(readAssignees({}), []);
    eq(readAssignees({ assignees: [] }), []);
    eq(readAssignees({ assignee: '' }), []);
});

// ── task list mutators ──

test('addTaskToList appends and is immutable', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const next = addTaskToList([a], b);
    eq(next.length, 2);
    eq(next[1].id, b.id);
});

test('updateTaskInList patches and bumps updatedAt', async () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    await new Promise(r => setTimeout(r, 5));
    const next = updateTaskInList([t], t.id, { name: 'A renamed' });
    eq(next[0].name, 'A renamed');
    truthy(next[0].updatedAt >= t.updatedAt);
});

test('updateTaskInList stamps completedAt when status -> done', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    eq(t.completedAt, null);
    const next = updateTaskInList([t], t.id, { status: 'done' });
    truthy(next[0].completedAt, 'completedAt set on transition to done');
});

test('updateTaskInList clears completedAt when leaving done', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const done = updateTaskInList([t], t.id, { status: 'done' });
    truthy(done[0].completedAt);
    const reopened = updateTaskInList(done, t.id, { status: 'in-progress' });
    eq(reopened[0].completedAt, null);
});

test('updateTaskInList returns same ref when id missing', () => {
    const list = [createTask({ name: 'A', projectId: 'p' })];
    eq(updateTaskInList(list, 'no-such', { name: 'X' }), list);
});

test('deleteTaskFromList removes by id', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const next = deleteTaskFromList([a, b], a.id);
    eq(next.length, 1);
    eq(next[0].id, b.id);
});

test('findTask + findTasksByProject filter correctly', () => {
    const a = createTask({ name: 'A', projectId: 'p1' });
    const b = createTask({ name: 'B', projectId: 'p1' });
    const c = createTask({ name: 'C', projectId: 'p2' });
    eq(findTask([a, b, c], b.id).name, 'B');
    eq(findTask([a, b, c], 'nope'), null);
    eq(findTasksByProject([a, b, c], 'p1').length, 2);
    eq(findTasksByProject([a, b, c], 'p2').length, 1);
    eq(findTasksByProject([a, b, c], 'pX').length, 0);
});

// ── sanitiseTask ──

test('sanitiseTask backfills missing fields on legacy data', () => {
    const fixed = sanitiseTask({ id: 't_legacy', name: 'Old', projectId: 'p1' });
    eq(fixed.status, 'not-started');
    eq(fixed.priority, 'normal');
    eq(fixed.dependsOn, []);
    eq(fixed.comments, []);
    eq(fixed.events, []);
    eq(fixed.attachments, []);
    truthy(fixed.createdAt);
    truthy(fixed.updatedAt);
});

test('sanitiseTask preserves valid fields', () => {
    const t = createTask({ name: 'X', projectId: 'p', status: 'in-progress', priority: 'high' });
    const out = sanitiseTask(t);
    eq(out.id, t.id);
    eq(out.status, 'in-progress');
    eq(out.priority, 'high');
});

// PB.9 — sanitiseTask handles assignees + legacy assignee transition

test('sanitiseTask backfills assignees from legacy assignee field', () => {
    const out = sanitiseTask({ id: 't1', name: 'X', projectId: 'p', assignee: 'brad' });
    eq(out.assignees, ['brad']);
});

test('sanitiseTask backfills assignees when an empty array is paired with legacy assignee', () => {
    const out = sanitiseTask({ id: 't1', name: 'X', projectId: 'p', assignees: [], assignee: 'diana' });
    eq(out.assignees, ['diana']);
});

test('sanitiseTask preserves an existing non-empty assignees array, ignoring legacy field', () => {
    const out = sanitiseTask({ id: 't1', name: 'X', projectId: 'p', assignees: ['brad', 'diana'], assignee: 'should-be-ignored' });
    eq(out.assignees, ['brad', 'diana']);
});

test('sanitiseTask returns empty assignees when neither field is set', () => {
    const out = sanitiseTask({ id: 't1', name: 'X', projectId: 'p' });
    eq(out.assignees, []);
});

test('sanitiseTask drops the legacy assignee field on output', () => {
    const out = sanitiseTask({ id: 't1', name: 'X', projectId: 'p', assignee: 'brad' });
    truthy(!('assignee' in out), 'sanitised tasks have no legacy assignee field');
});

// ── subtasks (Task 2.2) ──

test('findSubtasks returns children of a parent', () => {
    const parent = createTask({ name: 'Parent', projectId: 'p' });
    const childA = createTask({ name: 'A', projectId: 'p', parentTaskId: parent.id });
    const childB = createTask({ name: 'B', projectId: 'p', parentTaskId: parent.id });
    const unrelated = createTask({ name: 'U', projectId: 'p' });
    const subs = findSubtasks([parent, childA, childB, unrelated], parent.id);
    eq(subs.length, 2);
    eq(subs.map(t => t.name).sort(), ['A', 'B']);
});

test('findSubtasks returns empty array when parent has no children', () => {
    const parent = createTask({ name: 'Lonely', projectId: 'p' });
    eq(findSubtasks([parent], parent.id), []);
});

test('createTask accepts parentTaskId', () => {
    const t = createTask({ name: 'Sub', projectId: 'p', parentTaskId: 't_parent' });
    eq(t.parentTaskId, 't_parent');
});

test('promoteSubtasksInList sets parentTaskId=null on all children', () => {
    const parent = createTask({ name: 'Parent', projectId: 'p' });
    const a = createTask({ name: 'A', projectId: 'p', parentTaskId: parent.id });
    const b = createTask({ name: 'B', projectId: 'p', parentTaskId: parent.id });
    const c = createTask({ name: 'C', projectId: 'p', parentTaskId: parent.id });
    const next = promoteSubtasksInList([parent, a, b, c], parent.id);
    eq(next.length, 4);
    const promoted = next.filter(t => t.id !== parent.id);
    promoted.forEach(t => eq(t.parentTaskId, null, `${t.name} should be promoted`));
});

test('promoteSubtasksInList does not touch unrelated tasks', () => {
    const p1 = createTask({ name: 'P1', projectId: 'p' });
    const p2 = createTask({ name: 'P2', projectId: 'p' });
    const c1 = createTask({ name: 'C1', projectId: 'p', parentTaskId: p1.id });
    const c2 = createTask({ name: 'C2', projectId: 'p', parentTaskId: p2.id });
    const next = promoteSubtasksInList([p1, p2, c1, c2], p1.id);
    const c2After = next.find(t => t.id === c2.id);
    eq(c2After.parentTaskId, p2.id, 'unrelated child stays nested');
});

test('promoteSubtasksInList returns same list when parent has no children', () => {
    const lonely = createTask({ name: 'Lonely', projectId: 'p' });
    const list = [lonely];
    eq(promoteSubtasksInList(list, lonely.id), list);
});

test('deleteTaskCascadeFromList removes parent and all subtasks', () => {
    const parent = createTask({ name: 'Parent', projectId: 'p' });
    const a = createTask({ name: 'A', projectId: 'p', parentTaskId: parent.id });
    const b = createTask({ name: 'B', projectId: 'p', parentTaskId: parent.id });
    const sibling = createTask({ name: 'Sibling', projectId: 'p' });
    const next = deleteTaskCascadeFromList([parent, a, b, sibling], parent.id);
    eq(next.length, 1);
    eq(next[0].id, sibling.id);
});

test('deleteTaskCascadeFromList of a leaf task removes only that task', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const next = deleteTaskCascadeFromList([a, b], a.id);
    eq(next.length, 1);
    eq(next[0].id, b.id);
});

test('sanitiseTask preserves parentTaskId', () => {
    const t = createTask({ name: 'Sub', projectId: 'p', parentTaskId: 't_parent' });
    const out = sanitiseTask(t);
    eq(out.parentTaskId, 't_parent');
});

// ── dependencies (Task 3.1) ──

test('addDependency adds a dep id to dependsOn and bumps updatedAt', async () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    await new Promise(r => setTimeout(r, 5));
    const next = addDependency([a, b], a.id, b.id);
    const aNext = next.find(t => t.id === a.id);
    eq(aNext.dependsOn, [b.id]);
    truthy(aNext.updatedAt >= a.updatedAt, 'updatedAt should not regress');
    eq(next.find(t => t.id === b.id), b, 'b is unchanged');
});

test('addDependency is idempotent — duplicate adds do not stack', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    let list = addDependency([a, b], a.id, b.id);
    list = addDependency(list, a.id, b.id);
    const aOut = list.find(t => t.id === a.id);
    eq(aOut.dependsOn, [b.id]);
});

test('addDependency returns same ref when target task missing', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const list = [a];
    eq(addDependency(list, 'no-such', a.id), list);
});

test('addDependency refuses self-dependency (returns same ref)', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const list = [a];
    eq(addDependency(list, a.id, a.id), list);
});

test('addDependency refuses a cycle (returns same ref)', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    // A depends on B
    const after1 = addDependency([a, b], a.id, b.id);
    // Now adding B->A would cycle (A->B->A). addDependency should refuse.
    const after2 = addDependency(after1, b.id, a.id);
    eq(after2, after1, 'cycle attempt returns same list');
});

test('removeDependency drops the dep id and bumps updatedAt', async () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const c = createTask({ name: 'C', projectId: 'p' });
    let list = addDependency([a, b, c], a.id, b.id);
    list = addDependency(list, a.id, c.id);
    await new Promise(r => setTimeout(r, 5));
    const next = removeDependency(list, a.id, b.id);
    const aOut = next.find(t => t.id === a.id);
    eq(aOut.dependsOn, [c.id]);
    truthy(aOut.updatedAt >= a.updatedAt);
});

test('removeDependency is a no-op when the dep is not present', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const list = [a, b];
    eq(removeDependency(list, a.id, b.id), list);
});

test('wouldCreateCycle: direct self-dep is a cycle', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    truthy(wouldCreateCycle([a], a.id, a.id));
});

test('wouldCreateCycle: A depends on B, then B->A would cycle', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const list = addDependency([a, b], a.id, b.id);
    truthy(wouldCreateCycle(list, b.id, a.id));
});

test('wouldCreateCycle: A->B->C->A is a cycle (transitive)', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const c = createTask({ name: 'C', projectId: 'p' });
    let list = addDependency([a, b, c], a.id, b.id);
    list = addDependency(list, b.id, c.id);
    truthy(wouldCreateCycle(list, c.id, a.id));
});

test('wouldCreateCycle: independent edges are fine', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const c = createTask({ name: 'C', projectId: 'p' });
    const list = addDependency([a, b, c], a.id, b.id);
    falsy(wouldCreateCycle(list, a.id, c.id), 'A->C alongside A->B is fine');
});

test('wouldCreateCycle handles missing tasks gracefully', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    falsy(wouldCreateCycle([a], a.id, 'no-such-task'));
});

test('countBlockingDeps: 0 when no deps', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    eq(countBlockingDeps([a], a), 0);
});

test('countBlockingDeps: counts deps that are not done', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const c = createTask({ name: 'C', projectId: 'p' });
    let list = addDependency([a, b, c], a.id, b.id);
    list = addDependency(list, a.id, c.id);
    const aOut = list.find(t => t.id === a.id);
    eq(countBlockingDeps(list, aOut), 2);
});

test('countBlockingDeps: ignores done deps', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    let list = addDependency([a, b], a.id, b.id);
    list = updateTaskInList(list, b.id, { status: 'done' });
    const aOut = list.find(t => t.id === a.id);
    eq(countBlockingDeps(list, aOut), 0);
});

test('countBlockingDeps: ignores deps that no longer exist (deleted task)', () => {
    const a = createTask({ name: 'A', projectId: 'p' });
    const b = createTask({ name: 'B', projectId: 'p' });
    const list = addDependency([a, b], a.id, b.id);
    const aOut = list.find(t => t.id === a.id);
    // B is no longer in the list — simulates a deleted prerequisite
    eq(countBlockingDeps([aOut], aOut), 0);
});

test('sanitiseTask preserves dependsOn array', () => {
    const a = createTask({ name: 'A', projectId: 'p', dependsOn: ['t_x', 't_y'] });
    const out = sanitiseTask(a);
    eq(out.dependsOn, ['t_x', 't_y']);
});

// ── comments (Task 3.2) ──

test('createComment populates id, author, text, createdAt', () => {
    const c = createComment({ author: 'brad@example.com', text: 'looks good' });
    truthy(c.id && c.id.startsWith('c_'), 'id should start with c_');
    eq(c.author, 'brad@example.com');
    eq(c.text, 'looks good');
    truthy(c.createdAt, 'createdAt set');
});

test('createComment trims text', () => {
    const c = createComment({ author: 'b', text: '  hi  ' });
    eq(c.text, 'hi');
});

test('createComment defaults author to anonymous when missing', () => {
    eq(createComment({ text: 'hi' }).author, 'anonymous');
    eq(createComment({ author: '', text: 'hi' }).author, 'anonymous');
    eq(createComment({ author: '   ', text: 'hi' }).author, 'anonymous');
});

test('createComment ids are unique across rapid calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(createComment({ author: 'b', text: 'x' }).id);
    eq(ids.size, 50);
});

test('addCommentToTask appends and bumps updatedAt', async () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const c = createComment({ author: 'b', text: 'hello' });
    await new Promise(r => setTimeout(r, 5));
    const next = addCommentToTask([t], t.id, c);
    const tNext = next.find(x => x.id === t.id);
    eq(tNext.comments.length, 1);
    eq(tNext.comments[0].id, c.id);
    truthy(tNext.updatedAt >= t.updatedAt, 'updatedAt should not regress');
});

test('addCommentToTask preserves chronological order (newest at end)', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const c1 = createComment({ author: 'b', text: 'first' });
    const c2 = createComment({ author: 'd', text: 'second' });
    let list = addCommentToTask([t], t.id, c1);
    list = addCommentToTask(list, t.id, c2);
    const tOut = list.find(x => x.id === t.id);
    eq(tOut.comments.map(c => c.text), ['first', 'second']);
});

test('addCommentToTask returns same ref when taskId missing', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const list = [t];
    const c = createComment({ author: 'b', text: 'hi' });
    eq(addCommentToTask(list, 'no-such-task', c), list);
});

test('addCommentToTask is immutable (does not mutate input list or task)', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const list = [t];
    const c = createComment({ author: 'b', text: 'hi' });
    addCommentToTask(list, t.id, c);
    eq(list[0].comments.length, 0, 'original task untouched');
});

test('sanitiseTask preserves comments array', () => {
    const c = createComment({ author: 'b', text: 'hello' });
    const t = createTask({ name: 'A', projectId: 'p', comments: [c] });
    const out = sanitiseTask(t);
    eq(out.comments.length, 1);
    eq(out.comments[0].text, 'hello');
});

// ── activity / audit-trail (Task 3.3) ──

test('createEvent populates id, kind, by, at, before, after', () => {
    const e = createEvent({ kind: 'status_changed', by: 'brad@x', before: 'not-started', after: 'in-progress' });
    truthy(e.id && e.id.startsWith('e_'), 'id should start with e_');
    eq(e.kind, 'status_changed');
    eq(e.by, 'brad@x');
    eq(e.before, 'not-started');
    eq(e.after, 'in-progress');
    truthy(e.at, 'timestamp set');
});

test('createEvent defaults by to anonymous when blank', () => {
    eq(createEvent({ kind: 'status_changed' }).by, 'anonymous');
    eq(createEvent({ kind: 'status_changed', by: '   ' }).by, 'anonymous');
});

test('createEvent defaults before/after to null when omitted', () => {
    const e = createEvent({ kind: 'status_changed', by: 'b' });
    eq(e.before, null);
    eq(e.after, null);
});

test('addEventToTask appends and bumps updatedAt', async () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const e = createEvent({ kind: 'status_changed', by: 'b', before: 'not-started', after: 'in-progress' });
    await new Promise(r => setTimeout(r, 5));
    const next = addEventToTask([t], t.id, e);
    const tNext = next.find(x => x.id === t.id);
    eq(tNext.events.length, 1);
    eq(tNext.events[0].id, e.id);
    truthy(tNext.updatedAt >= t.updatedAt, 'updatedAt should not regress');
});

test('addEventToTask preserves chronological order', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const e1 = createEvent({ kind: 'status_changed', by: 'b' });
    const e2 = createEvent({ kind: 'assignee_changed', by: 'b' });
    let list = addEventToTask([t], t.id, e1);
    list = addEventToTask(list, t.id, e2);
    const tOut = list.find(x => x.id === t.id);
    eq(tOut.events.map(e => e.kind), ['status_changed', 'assignee_changed']);
});

test('addEventToTask returns same ref when taskId missing', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const e = createEvent({ kind: 'status_changed', by: 'b' });
    const list = [t];
    eq(addEventToTask(list, 'no-such-task', e), list);
});

test('taskPatchEvents emits an event for each tracked field that changed', () => {
    const prev = createTask({ name: 'A', projectId: 'p', status: 'not-started', assignee: null, dueDate: null });
    const patch = { status: 'in-progress', assignee: 'brad', dueDate: '2026-06-01' };
    const events = taskPatchEvents(prev, patch, 'user@x');
    eq(events.length, 3);
    const kinds = events.map(e => e.kind).sort();
    eq(kinds, ['assignee_changed', 'due_date_changed', 'status_changed']);
    events.forEach(e => eq(e.by, 'user@x'));
});

test('taskPatchEvents captures before/after on each event', () => {
    const prev = createTask({ name: 'A', projectId: 'p', status: 'not-started' });
    const events = taskPatchEvents(prev, { status: 'review' }, 'b');
    eq(events.length, 1);
    eq(events[0].before, 'not-started');
    eq(events[0].after, 'review');
});

test('taskPatchEvents ignores no-op patches (same value)', () => {
    const prev = createTask({ name: 'A', projectId: 'p', status: 'in-progress' });
    eq(taskPatchEvents(prev, { status: 'in-progress' }, 'b'), []);
});

test('taskPatchEvents ignores untracked fields (name, description, priority)', () => {
    const prev = createTask({ name: 'A', projectId: 'p', priority: 'normal' });
    eq(taskPatchEvents(prev, { name: 'B', description: 'new', priority: 'high' }, 'b'), []);
});

test('taskPatchEvents handles a patch that misses some tracked fields', () => {
    const prev = createTask({ name: 'A', projectId: 'p', status: 'not-started', assignee: null });
    const events = taskPatchEvents(prev, { assignee: 'diana' }, 'b');
    eq(events.length, 1);
    eq(events[0].kind, 'assignee_changed');
});

test('taskPatchEvents returns [] for empty/null inputs', () => {
    eq(taskPatchEvents(null, {}, 'b'), []);
    eq(taskPatchEvents(createTask({ name: 'A', projectId: 'p' }), null, 'b'), []);
});

// PB.9 — taskPatchEvents handles the assignees array

test('taskPatchEvents emits assignee_changed when assignees array changes (single -> joint)', () => {
    const prev = createTask({ name: 'A', projectId: 'p', assignees: ['brad'] });
    const events = taskPatchEvents(prev, { assignees: ['brad', 'diana'] }, 'b');
    eq(events.length, 1);
    eq(events[0].kind, 'assignee_changed');
});

test('taskPatchEvents assignee_changed payload carries before/after arrays (PB.9)', () => {
    const prev = createTask({ name: 'A', projectId: 'p', assignees: ['brad'] });
    const events = taskPatchEvents(prev, { assignees: ['brad', 'diana'] }, 'b');
    eq(events[0].before, ['brad']);
    eq(events[0].after, ['brad', 'diana']);
});

test('taskPatchEvents treats identical assignee sets (any order) as a no-op', () => {
    const prev = createTask({ name: 'A', projectId: 'p', assignees: ['brad', 'diana'] });
    eq(taskPatchEvents(prev, { assignees: ['diana', 'brad'] }, 'b'), []);
});

test('taskPatchEvents accepts a legacy patch.assignee and still produces an array event', () => {
    const prev = createTask({ name: 'A', projectId: 'p', assignees: [] });
    const events = taskPatchEvents(prev, { assignee: 'brad' }, 'b');
    eq(events.length, 1);
    eq(events[0].kind, 'assignee_changed');
    eq(events[0].before, []);
    eq(events[0].after, ['brad']);
});

test('sanitiseTask preserves events array', () => {
    const e = createEvent({ kind: 'status_changed', by: 'b', before: 'not-started', after: 'done' });
    const t = createTask({ name: 'A', projectId: 'p', events: [e] });
    const out = sanitiseTask(t);
    eq(out.events.length, 1);
    eq(out.events[0].kind, 'status_changed');
});

// ── attachments (Task 3.4) ──

test('MAX_INLINE_ATTACHMENT_SIZE is 500 KB', () => {
    eq(MAX_INLINE_ATTACHMENT_SIZE, 500 * 1024);
});

test('createFileAttachment populates id, kind, fields, addedAt', () => {
    const a = createFileAttachment({ name: 'x.png', size: 1234, type: 'image/png', dataUri: 'data:image/png;base64,abc', addedBy: 'b' });
    truthy(a.id && a.id.startsWith('a_'), 'id should start with a_');
    eq(a.kind, 'file');
    eq(a.name, 'x.png');
    eq(a.size, 1234);
    eq(a.type, 'image/png');
    eq(a.dataUri, 'data:image/png;base64,abc');
    eq(a.addedBy, 'b');
    truthy(a.addedAt);
});

test('createFileAttachment defaults addedBy to anonymous', () => {
    eq(createFileAttachment({ name: 'x', size: 1, dataUri: 'd' }).addedBy, 'anonymous');
});

test('createUrlAttachment populates id, kind=url, name, url, addedBy', () => {
    const a = createUrlAttachment({ name: 'Spec', url: 'https://example.com/spec', addedBy: 'b' });
    truthy(a.id && a.id.startsWith('a_'), 'id should start with a_');
    eq(a.kind, 'url');
    eq(a.name, 'Spec');
    eq(a.url, 'https://example.com/spec');
    eq(a.addedBy, 'b');
});

test('validateFileAttachment rejects missing name / dataUri / size', () => {
    truthy(validateFileAttachment({ name: '', size: 100, dataUri: 'd' }), 'no name');
    truthy(validateFileAttachment({ name: 'x', size: 100, dataUri: '' }), 'no dataUri');
    truthy(validateFileAttachment({ name: 'x', size: 0, dataUri: 'd' }), 'zero size');
});

test('validateFileAttachment rejects files larger than 500 KB with explicit size', () => {
    const err = validateFileAttachment({ name: 'big', size: 600 * 1024, dataUri: 'd' });
    truthy(err);
    truthy(/500/.test(err) || /KB/.test(err) || /MB/.test(err), 'message should mention size limit');
});

test('validateFileAttachment accepts a 500 KB file (boundary)', () => {
    falsy(validateFileAttachment({ name: 'edge', size: MAX_INLINE_ATTACHMENT_SIZE, dataUri: 'd' }));
});

test('validateUrlAttachment rejects missing name / url / non-http URL', () => {
    truthy(validateUrlAttachment({ name: '', url: 'https://x' }), 'no name');
    truthy(validateUrlAttachment({ name: 'x', url: '' }), 'no url');
    truthy(validateUrlAttachment({ name: 'x', url: 'ftp://x' }), 'non-http');
    truthy(validateUrlAttachment({ name: 'x', url: 'example.com' }), 'no scheme');
});

test('validateUrlAttachment accepts http and https', () => {
    falsy(validateUrlAttachment({ name: 'a', url: 'https://example.com' }));
    falsy(validateUrlAttachment({ name: 'a', url: 'http://example.com' }));
});

test('addAttachmentToTask appends and bumps updatedAt', async () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const a = createUrlAttachment({ name: 'doc', url: 'https://x', addedBy: 'b' });
    await new Promise(r => setTimeout(r, 5));
    const next = addAttachmentToTask([t], t.id, a);
    const tNext = next.find(x => x.id === t.id);
    eq(tNext.attachments.length, 1);
    eq(tNext.attachments[0].id, a.id);
    truthy(tNext.updatedAt >= t.updatedAt);
});

test('addAttachmentToTask same-ref no-op when task missing', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const list = [t];
    const a = createUrlAttachment({ name: 'd', url: 'https://x' });
    eq(addAttachmentToTask(list, 'no-such', a), list);
});

test('removeAttachmentFromTask filters by id and bumps updatedAt', async () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const a = createUrlAttachment({ name: 'a1', url: 'https://x' });
    const b = createUrlAttachment({ name: 'a2', url: 'https://y' });
    let list = addAttachmentToTask([t], t.id, a);
    list = addAttachmentToTask(list, t.id, b);
    await new Promise(r => setTimeout(r, 5));
    const next = removeAttachmentFromTask(list, t.id, a.id);
    const tOut = next.find(x => x.id === t.id);
    eq(tOut.attachments.length, 1);
    eq(tOut.attachments[0].id, b.id);
});

test('removeAttachmentFromTask same-ref no-op when attachment missing', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const list = [t];
    eq(removeAttachmentFromTask(list, t.id, 'no-such'), list);
    eq(removeAttachmentFromTask(list, 'no-task', 'no-such'), list);
});

test('taskAttachmentSize sums file sizes only (URL refs do not count)', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const file1 = createFileAttachment({ name: 'a', size: 100, dataUri: 'd' });
    const file2 = createFileAttachment({ name: 'b', size: 250, dataUri: 'd' });
    const url = createUrlAttachment({ name: 'c', url: 'https://x' });
    let list = addAttachmentToTask([t], t.id, file1);
    list = addAttachmentToTask(list, t.id, file2);
    list = addAttachmentToTask(list, t.id, url);
    const tOut = list.find(x => x.id === t.id);
    eq(taskAttachmentSize(tOut), 350);
});

test('taskAttachmentSize is 0 for tasks with no attachments or only URLs', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    eq(taskAttachmentSize(t), 0);
    const url = createUrlAttachment({ name: 'c', url: 'https://x' });
    const list = addAttachmentToTask([t], t.id, url);
    eq(taskAttachmentSize(list[0]), 0);
});

test('formatBytes produces human-readable units', () => {
    eq(formatBytes(0), '0 B');
    eq(formatBytes(512), '512 B');
    eq(formatBytes(2048), '2 KB');
    eq(formatBytes(1572864), '1.5 MB');
});

test('sanitiseTask preserves attachments array', () => {
    const a = createUrlAttachment({ name: 'doc', url: 'https://x' });
    const t = createTask({ name: 'A', projectId: 'p', attachments: [a] });
    const out = sanitiseTask(t);
    eq(out.attachments.length, 1);
    eq(out.attachments[0].url, 'https://x');
});

// ── milestone flag (Task 3.5) ──

test('createTask defaults isMilestone to false', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    eq(t.isMilestone, false);
});

test('createTask accepts isMilestone=true', () => {
    const t = createTask({ name: 'Launch', projectId: 'p', isMilestone: true });
    eq(t.isMilestone, true);
});

test('createTask coerces non-boolean isMilestone to false', () => {
    eq(createTask({ name: 'A', projectId: 'p', isMilestone: 'yes' }).isMilestone, false);
    eq(createTask({ name: 'A', projectId: 'p', isMilestone: 1 }).isMilestone, false);
    eq(createTask({ name: 'A', projectId: 'p', isMilestone: null }).isMilestone, false);
});

test('updateTaskInList toggles isMilestone', () => {
    const t = createTask({ name: 'A', projectId: 'p' });
    const next = updateTaskInList([t], t.id, { isMilestone: true });
    eq(next[0].isMilestone, true);
    const back = updateTaskInList(next, t.id, { isMilestone: false });
    eq(back[0].isMilestone, false);
});

test('sanitiseTask preserves isMilestone=true', () => {
    const t = createTask({ name: 'A', projectId: 'p', isMilestone: true });
    eq(sanitiseTask(t).isMilestone, true);
});

test('sanitiseTask backfills missing isMilestone to false', () => {
    const legacy = { id: 't_legacy', name: 'Old', projectId: 'p' };
    eq(sanitiseTask(legacy).isMilestone, false);
});

test('validateTask accepts both isMilestone values', () => {
    falsy(validateTask(createTask({ name: 'A', projectId: 'p', isMilestone: true })));
    falsy(validateTask(createTask({ name: 'A', projectId: 'p', isMilestone: false })));
});

// ── sortTasks (Task 4.1) ──

function mkTask(overrides) {
    return { ...createTask({ name: 'X', projectId: 'p' }), ...overrides };
}

test('TASK_SORT_FIELDS exposes the supported sort dimensions', () => {
    eq(TASK_SORT_FIELDS, ['dueDate', 'name', 'priority']);
});

test('sortTasks does not mutate input', () => {
    const list = [mkTask({ name: 'B' }), mkTask({ name: 'A' })];
    const before = list.slice();
    sortTasks(list, { by: 'name', dir: 'asc' });
    eq(list.map(t => t.name), before.map(t => t.name));
});

test('sortTasks empty list returns empty', () => {
    eq(sortTasks([], { by: 'name', dir: 'asc' }), []);
});

test('sortTasks by dueDate asc puts earliest first, missing dueDate last', () => {
    const a = mkTask({ name: 'a', dueDate: '2026-06-10' });
    const b = mkTask({ name: 'b', dueDate: '2026-06-01' });
    const c = mkTask({ name: 'c', dueDate: null });
    const d = mkTask({ name: 'd', dueDate: '2026-05-30' });
    const sorted = sortTasks([a, b, c, d], { by: 'dueDate', dir: 'asc' });
    eq(sorted.map(t => t.name), ['d', 'b', 'a', 'c']);
});

test('sortTasks by dueDate desc reverses present dates but keeps missing last', () => {
    const a = mkTask({ name: 'a', dueDate: '2026-06-10' });
    const b = mkTask({ name: 'b', dueDate: '2026-06-01' });
    const c = mkTask({ name: 'c', dueDate: null });
    const sorted = sortTasks([a, b, c], { by: 'dueDate', dir: 'desc' });
    eq(sorted.map(t => t.name), ['a', 'b', 'c']);
});

test('sortTasks by name asc is alphabetical (case-insensitive)', () => {
    const tasks = [
        mkTask({ name: 'banana' }),
        mkTask({ name: 'Apple' }),
        mkTask({ name: 'cherry' }),
    ];
    const sorted = sortTasks(tasks, { by: 'name', dir: 'asc' });
    eq(sorted.map(t => t.name), ['Apple', 'banana', 'cherry']);
});

test('sortTasks by name desc reverses', () => {
    const tasks = [
        mkTask({ name: 'a' }),
        mkTask({ name: 'b' }),
        mkTask({ name: 'c' }),
    ];
    const sorted = sortTasks(tasks, { by: 'name', dir: 'desc' });
    eq(sorted.map(t => t.name), ['c', 'b', 'a']);
});

test('sortTasks by priority asc orders high → normal → low', () => {
    const tasks = [
        mkTask({ name: 'lo', priority: 'low' }),
        mkTask({ name: 'hi', priority: 'high' }),
        mkTask({ name: 'no', priority: 'normal' }),
    ];
    const sorted = sortTasks(tasks, { by: 'priority', dir: 'asc' });
    eq(sorted.map(t => t.name), ['hi', 'no', 'lo']);
});

test('sortTasks by priority desc orders low → normal → high', () => {
    const tasks = [
        mkTask({ name: 'hi', priority: 'high' }),
        mkTask({ name: 'lo', priority: 'low' }),
        mkTask({ name: 'no', priority: 'normal' }),
    ];
    const sorted = sortTasks(tasks, { by: 'priority', dir: 'desc' });
    eq(sorted.map(t => t.name), ['lo', 'no', 'hi']);
});

test('sortTasks uses createdAt as a tiebreaker on equal sort field', () => {
    const a = { ...mkTask({ name: 'A', dueDate: '2026-06-01' }), createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { ...mkTask({ name: 'B', dueDate: '2026-06-01' }), createdAt: '2026-01-02T00:00:00.000Z' };
    const sorted = sortTasks([b, a], { by: 'dueDate', dir: 'asc' });
    eq(sorted.map(t => t.name), ['A', 'B']);
});

test('sortTasks falls back to dueDate asc on unknown field', () => {
    const a = mkTask({ name: 'a', dueDate: '2026-06-10' });
    const b = mkTask({ name: 'b', dueDate: '2026-06-01' });
    const sorted = sortTasks([a, b], { by: 'mystery', dir: 'asc' });
    eq(sorted.map(t => t.name), ['b', 'a']);
});

// ── filterTasks (Task 4.1) ──

test('filterTasks with empty filters returns the same list contents', () => {
    const list = [mkTask({ name: 'A' }), mkTask({ name: 'B' })];
    eq(filterTasks(list, {}).map(t => t.name), ['A', 'B']);
});

test('filterTasks by assignee includes only matching tasks', () => {
    const list = [
        mkTask({ name: 'brads', assignee: 'brad' }),
        mkTask({ name: 'dianas', assignee: 'diana' }),
        mkTask({ name: 'unassigned', assignee: null }),
    ];
    eq(
        filterTasks(list, { assignee: 'brad' }).map(t => t.name),
        ['brads']
    );
});

test('filterTasks by status only keeps matching tasks', () => {
    const list = [
        mkTask({ name: 'open', status: 'in-progress' }),
        mkTask({ name: 'closed', status: 'done' }),
    ];
    eq(
        filterTasks(list, { status: 'done' }).map(t => t.name),
        ['closed']
    );
});

test('filterTasks milestonesOnly preserves the legacy parent-of-milestone scaffolding rule', () => {
    const parent = mkTask({ name: 'parent' });
    const child = mkTask({ name: 'child', parentTaskId: parent.id, isMilestone: true });
    const sibling = mkTask({ name: 'sibling' });
    const filtered = filterTasks([parent, child, sibling], { milestonesOnly: true });
    eq(filtered.map(t => t.name).sort(), ['child', 'parent']);
});

test('filterTasks composes assignee + status with AND semantics', () => {
    const list = [
        mkTask({ name: 'match', assignee: 'brad', status: 'in-progress' }),
        mkTask({ name: 'wrongStatus', assignee: 'brad', status: 'done' }),
        mkTask({ name: 'wrongAssignee', assignee: 'diana', status: 'in-progress' }),
    ];
    eq(
        filterTasks(list, { assignee: 'brad', status: 'in-progress' }).map(t => t.name),
        ['match']
    );
});

test('filterTasks keeps a non-matching parent when one of its subtasks matches the filter', () => {
    const parent = mkTask({ name: 'parent', assignee: 'diana' });
    const child = mkTask({ name: 'child', parentTaskId: parent.id, assignee: 'brad' });
    const filtered = filterTasks([parent, child], { assignee: 'brad' });
    eq(filtered.map(t => t.name).sort(), ['child', 'parent']);
});

test('filterTasks does NOT auto-include subtasks of a passing parent (subtasks judged independently)', () => {
    const parent = mkTask({ name: 'parent', assignee: 'brad' });
    const child = mkTask({ name: 'child', parentTaskId: parent.id, assignee: 'diana' });
    const filtered = filterTasks([parent, child], { assignee: 'brad' });
    eq(filtered.map(t => t.name), ['parent']);
});

test('filterTasks treats null filter values as "no filter on that dimension"', () => {
    const list = [
        mkTask({ name: 'a', assignee: 'brad' }),
        mkTask({ name: 'b', assignee: 'diana' }),
    ];
    eq(
        filterTasks(list, { assignee: null, status: null, milestonesOnly: false }).map(t => t.name),
        ['a', 'b']
    );
});

// PB.8 — dashboardView filter primitive

test('DASHBOARD_VIEWS exposes the five drillable views', () => {
    eq(DASHBOARD_VIEWS.slice().sort(), ['completedLast30Days', 'dueThisWeek', 'open', 'overdue', 'upcomingMilestones']);
});

test('DASHBOARD_CARD_VIEWS maps the five clickable cards to their views (activeProjects is non-clickable)', () => {
    eq(DASHBOARD_CARD_VIEWS, {
        openTasks: 'open',
        overdueTasks: 'overdue',
        dueThisWeek: 'dueThisWeek',
        completedLast30Days: 'completedLast30Days',
        upcomingMilestones: 'upcomingMilestones',
    });
});

test('filterTasks dashboardView=open returns tasks whose status is not done', () => {
    const list = [
        mkTask({ name: 'open', status: 'in-progress' }),
        mkTask({ name: 'done', status: 'done' }),
    ];
    eq(
        filterTasks(list, { dashboardView: 'open', today: '2026-05-15' }).map(t => t.name),
        ['open']
    );
});

test('filterTasks dashboardView=overdue keeps non-done tasks past today', () => {
    const list = [
        mkTask({ name: 'overdue', status: 'in-progress', dueDate: '2026-05-10' }),
        mkTask({ name: 'today',   status: 'in-progress', dueDate: '2026-05-15' }),
        mkTask({ name: 'done',    status: 'done',        dueDate: '2026-05-10' }),
        mkTask({ name: 'nodate',  status: 'in-progress', dueDate: null }),
    ];
    eq(
        filterTasks(list, { dashboardView: 'overdue', today: '2026-05-15' }).map(t => t.name),
        ['overdue']
    );
});

test('filterTasks dashboardView=dueThisWeek keeps tasks due in the next 6 days inclusive', () => {
    const list = [
        mkTask({ name: 'today',   status: 'in-progress', dueDate: '2026-05-15' }),
        mkTask({ name: 'in6',     status: 'in-progress', dueDate: '2026-05-21' }),
        mkTask({ name: 'past6',   status: 'in-progress', dueDate: '2026-05-22' }),
        mkTask({ name: 'overdue', status: 'in-progress', dueDate: '2026-05-14' }),
        mkTask({ name: 'done',    status: 'done',        dueDate: '2026-05-15' }),
    ];
    eq(
        filterTasks(list, { dashboardView: 'dueThisWeek', today: '2026-05-15' }).map(t => t.name).sort(),
        ['in6', 'today']
    );
});

test('filterTasks dashboardView=completedLast30Days keeps done tasks completed within the trailing window', () => {
    const list = [
        mkTask({ name: 'recent', status: 'done', completedAt: '2026-05-01T10:00:00.000Z' }),
        mkTask({ name: 'today',  status: 'done', completedAt: '2026-05-15T10:00:00.000Z' }),
        mkTask({ name: 'old',    status: 'done', completedAt: '2026-04-10T10:00:00.000Z' }),
        mkTask({ name: 'open',   status: 'in-progress' }),
    ];
    eq(
        filterTasks(list, { dashboardView: 'completedLast30Days', today: '2026-05-15' }).map(t => t.name).sort(),
        ['recent', 'today']
    );
});

test('filterTasks dashboardView=upcomingMilestones keeps non-done milestones due within 14 days inclusive', () => {
    const list = [
        mkTask({ name: 'm-today',  status: 'in-progress', isMilestone: true,  dueDate: '2026-05-15' }),
        mkTask({ name: 'm-13days', status: 'in-progress', isMilestone: true,  dueDate: '2026-05-28' }),
        mkTask({ name: 'm-late',   status: 'in-progress', isMilestone: true,  dueDate: '2026-05-30' }),
        mkTask({ name: 'm-done',   status: 'done',        isMilestone: true,  dueDate: '2026-05-15' }),
        mkTask({ name: 'notms',    status: 'in-progress', isMilestone: false, dueDate: '2026-05-15' }),
    ];
    eq(
        filterTasks(list, { dashboardView: 'upcomingMilestones', today: '2026-05-15' }).map(t => t.name).sort(),
        ['m-13days', 'm-today']
    );
});

test('filterTasks dashboardView combines with assignee filter (AND)', () => {
    const list = [
        mkTask({ name: 'bradOverdue',  status: 'in-progress', dueDate: '2026-05-10', assignees: ['brad'] }),
        mkTask({ name: 'dianaOverdue', status: 'in-progress', dueDate: '2026-05-10', assignees: ['diana'] }),
        mkTask({ name: 'bradOnTime',   status: 'in-progress', dueDate: '2026-05-20', assignees: ['brad'] }),
    ];
    eq(
        filterTasks(list, { dashboardView: 'overdue', assignee: 'brad', today: '2026-05-15' }).map(t => t.name),
        ['bradOverdue']
    );
});

test('filterTasks ignores dashboardView when absent (back-compat)', () => {
    const list = [mkTask({ name: 'a' }), mkTask({ name: 'b' })];
    eq(filterTasks(list, {}).map(t => t.name), ['a', 'b']);
});

test('filterTasks dashboardView keeps the non-matching parent of a matching subtask (scaffold-aware)', () => {
    const parent = mkTask({ name: 'parent', status: 'done' });
    const child = mkTask({ name: 'child', parentTaskId: parent.id, status: 'in-progress' });
    eq(
        filterTasks([parent, child], { dashboardView: 'open', today: '2026-05-15' }).map(t => t.name).sort(),
        ['child', 'parent']
    );
});

test('filterTasks flat:true drops scaffolded parents (PB.8 dashboard drill)', () => {
    const parent = mkTask({ name: 'parent', status: 'done' });
    const child = mkTask({ name: 'child', parentTaskId: parent.id, status: 'in-progress' });
    eq(
        filterTasks([parent, child], { dashboardView: 'open', today: '2026-05-15', flat: true }).map(t => t.name),
        ['child']
    );
});

// PB.9 — filterTasks assignee uses intersection semantics

test('filterTasks by assignee matches joint tasks (intersection)', () => {
    const list = [
        mkTask({ name: 'soloBrad', assignees: ['brad'] }),
        mkTask({ name: 'joint', assignees: ['brad', 'diana'] }),
        mkTask({ name: 'soloDiana', assignees: ['diana'] }),
    ];
    eq(
        filterTasks(list, { assignee: 'brad' }).map(t => t.name).sort(),
        ['joint', 'soloBrad']
    );
    eq(
        filterTasks(list, { assignee: 'diana' }).map(t => t.name).sort(),
        ['joint', 'soloDiana']
    );
});

// ── groupTopLevelTasks (Task 4.1) ──

test('TASK_GROUP_OPTIONS exposes the supported group-by values', () => {
    eq(TASK_GROUP_OPTIONS, ['none', 'status', 'assignee']);
});

test('groupTopLevelTasks none returns a single bucket with all tasks', () => {
    const list = [mkTask({ name: 'A' }), mkTask({ name: 'B' })];
    const groups = groupTopLevelTasks(list, 'none');
    eq(groups.length, 1);
    eq(groups[0].tasks.map(t => t.name), ['A', 'B']);
});

test('groupTopLevelTasks empty input returns empty array regardless of group-by', () => {
    eq(groupTopLevelTasks([], 'none'), []);
    eq(groupTopLevelTasks([], 'status'), []);
    eq(groupTopLevelTasks([], 'assignee'), []);
});

test('groupTopLevelTasks status keeps the canonical TASK_STATUSES order and skips empty buckets', () => {
    const list = [
        mkTask({ name: 'reviewed', status: 'review' }),
        mkTask({ name: 'fresh', status: 'not-started' }),
    ];
    const groups = groupTopLevelTasks(list, 'status');
    eq(groups.map(g => g.key), ['not-started', 'review']);
    eq(groups[0].tasks.map(t => t.name), ['fresh']);
    eq(groups[1].tasks.map(t => t.name), ['reviewed']);
});

test('groupTopLevelTasks assignee orders brad → diana → others alphabetically → unassigned last', () => {
    const list = [
        mkTask({ name: 'u', assignee: null }),
        mkTask({ name: 'd', assignee: 'diana' }),
        mkTask({ name: 'guest', assignee: 'guest' }),
        mkTask({ name: 'b', assignee: 'brad' }),
        mkTask({ name: 'alex', assignee: 'alex' }),
    ];
    const groups = groupTopLevelTasks(list, 'assignee');
    eq(groups.map(g => g.key), ['brad', 'diana', 'alex', 'guest', '']);
});

test('groupTopLevelTasks unknown group-by falls back to a single all-bucket', () => {
    const list = [mkTask({ name: 'X' })];
    const groups = groupTopLevelTasks(list, 'mystery');
    eq(groups.length, 1);
    eq(groups[0].tasks.map(t => t.name), ['X']);
});

// PB.9 — groupTopLevelTasks handles joint and other multi-assignee buckets

test('groupTopLevelTasks assignee buckets brad+diana as a joint key', () => {
    const list = [
        mkTask({ name: 'solo', assignees: ['brad'] }),
        mkTask({ name: 'joint', assignees: ['brad', 'diana'] }),
    ];
    const groups = groupTopLevelTasks(list, 'assignee');
    eq(groups.map(g => g.key), ['brad', 'brad,diana']);
    eq(groups[1].tasks.map(t => t.name), ['joint']);
});

test('groupTopLevelTasks assignee joint key is sort-stable regardless of input order', () => {
    // [diana, brad] and [brad, diana] should land in the same bucket
    const list = [
        mkTask({ name: 'reversed', assignees: ['diana', 'brad'] }),
        mkTask({ name: 'ordered',  assignees: ['brad', 'diana'] }),
    ];
    const groups = groupTopLevelTasks(list, 'assignee');
    eq(groups.length, 1);
    eq(groups[0].key, 'brad,diana');
    eq(groups[0].tasks.map(t => t.name), ['reversed', 'ordered']);
});

test('groupTopLevelTasks assignee order: defaults → joint → single others → multi others → unassigned', () => {
    const list = [
        mkTask({ name: 'unassigned', assignees: [] }),
        mkTask({ name: 'multiZ',     assignees: ['brad', 'zoe'] }),
        mkTask({ name: 'multiA',     assignees: ['alex', 'brad'] }),
        mkTask({ name: 'diana',      assignees: ['diana'] }),
        mkTask({ name: 'guest',      assignees: ['guest'] }),
        mkTask({ name: 'brad',       assignees: ['brad'] }),
        mkTask({ name: 'joint',      assignees: ['brad', 'diana'] }),
        mkTask({ name: 'alex',       assignees: ['alex'] }),
    ];
    const groups = groupTopLevelTasks(list, 'assignee');
    eq(
        groups.map(g => g.key),
        ['brad', 'diana', 'brad,diana', 'alex', 'guest', 'alex,brad', 'brad,zoe', '']
    );
});

// ── Timeline range / bars (Task 4.2) ──

test('computeTimelineRange returns null when given an empty task list', () => {
    eq(computeTimelineRange([]), null);
});

test('computeTimelineRange returns null when no task has any usable date', () => {
    const list = [mkTask({ name: 'a' }), mkTask({ name: 'b' })];
    eq(computeTimelineRange(list), null);
});

test('computeTimelineRange snaps to month start/end with 14-day padding', () => {
    // earliest start 2026-06-15, latest due 2026-06-20.
    // 2026-06-15 - 14d = 2026-06-01 → month start = 2026-06-01.
    // 2026-06-20 + 14d = 2026-07-04 → month end   = 2026-07-31.
    const list = [
        mkTask({ name: 'a', startDate: '2026-06-15', dueDate: '2026-06-20' }),
    ];
    const r = computeTimelineRange(list);
    eq(r.startDate, '2026-06-01');
    eq(r.endDate, '2026-07-31');
    eq(r.totalDays, 61); // June 30 + July 31
});

test('computeTimelineRange honours min(startDate) and max(dueDate) across tasks', () => {
    const list = [
        mkTask({ name: 'a', startDate: '2026-07-10', dueDate: '2026-07-12' }),
        mkTask({ name: 'b', startDate: '2026-06-05', dueDate: '2026-08-25' }),
    ];
    const r = computeTimelineRange(list);
    // 2026-06-05 - 14d = 2026-05-22 → snap to 2026-05-01.
    // 2026-08-25 + 14d = 2026-09-08 → snap to 2026-09-30.
    eq(r.startDate, '2026-05-01');
    eq(r.endDate, '2026-09-30');
});

test('computeTimelineRange treats a task with only startDate as a 1-day span', () => {
    // 06-15 ± 14d = 06-01..06-29; both in June → snaps to 2026-06-01..2026-06-30.
    const list = [mkTask({ name: 'a', startDate: '2026-06-15', dueDate: null })];
    const r = computeTimelineRange(list);
    eq(r.startDate, '2026-06-01');
    eq(r.endDate, '2026-06-30');
});

test('computeTimelineRange treats a task with only dueDate as a 1-day span', () => {
    // Same math as the only-startDate case: lo == hi == 2026-06-15.
    const list = [mkTask({ name: 'a', startDate: null, dueDate: '2026-06-15' })];
    const r = computeTimelineRange(list);
    eq(r.startDate, '2026-06-01');
    eq(r.endDate, '2026-06-30');
});

test('computeTimelineRange months array covers every month inclusive', () => {
    const list = [
        mkTask({ name: 'a', startDate: '2026-06-15', dueDate: '2026-08-20' }),
    ];
    const r = computeTimelineRange(list);
    // Range: 2026-06-01 → 2026-09-30 (June, July, Aug, Sep)
    eq(r.months.length, 4);
    eq(r.months[0].year, 2026);
    eq(r.months[0].month, 6);
    eq(r.months[3].month, 9);
});

test('computeTaskBars excludes tasks with neither startDate nor dueDate', () => {
    const list = [
        mkTask({ name: 'scheduled', startDate: '2026-06-10', dueDate: '2026-06-12' }),
        mkTask({ name: 'unscheduled' }),
    ];
    const r = computeTimelineRange(list);
    const bars = computeTaskBars(list, r);
    eq(bars.length, 1);
    eq(bars[0].name, 'scheduled');
});

test('computeTaskBars 7-day bar has width close to 7 / totalDays * 100', () => {
    const list = [mkTask({ name: 'wk', startDate: '2026-06-10', dueDate: '2026-06-16' })];
    const r = computeTimelineRange(list);
    const bars = computeTaskBars(list, r);
    eq(bars.length, 1);
    const expected = (7 / r.totalDays) * 100;
    truthy(Math.abs(bars[0].widthPct - expected) < 0.001, 'widthPct ≈ 7 days');
});

test('computeTaskBars 1-day bar (only dueDate) has width = 1 day', () => {
    const list = [mkTask({ name: 'p', startDate: null, dueDate: '2026-06-15' })];
    const r = computeTimelineRange(list);
    const bars = computeTaskBars(list, r);
    eq(bars.length, 1);
    const expected = (1 / r.totalDays) * 100;
    truthy(Math.abs(bars[0].widthPct - expected) < 0.001, 'widthPct ≈ 1 day');
});

test('computeTaskBars leftPct + widthPct stays within 0..100 for in-range tasks', () => {
    const list = [
        mkTask({ name: 'a', startDate: '2026-06-10', dueDate: '2026-06-14' }),
        mkTask({ name: 'b', startDate: '2026-06-20', dueDate: '2026-06-25' }),
    ];
    const r = computeTimelineRange(list);
    const bars = computeTaskBars(list, r);
    bars.forEach(b => {
        truthy(b.leftPct >= 0, 'leftPct ≥ 0');
        truthy(b.leftPct + b.widthPct <= 100.0001, 'right edge ≤ 100');
    });
});

test('computeTaskBars carries id, name, status, isMilestone, and original task ref through', () => {
    const t = mkTask({ name: 'M', startDate: '2026-06-10', dueDate: '2026-06-10', status: 'in-progress', isMilestone: true });
    const r = computeTimelineRange([t]);
    const bars = computeTaskBars([t], r);
    eq(bars.length, 1);
    eq(bars[0].id, t.id);
    eq(bars[0].name, 'M');
    eq(bars[0].status, 'in-progress');
    eq(bars[0].isMilestone, true);
});

test('computeTaskBars returns empty array when range is null', () => {
    eq(computeTaskBars([mkTask({ name: 'x' })], null), []);
});

// ── Calendar grid + per-date task buckets (Task 4.3) ──

test('getMonthGridCells returns a multiple-of-7 cell count', () => {
    const cells = getMonthGridCells(2026, 6);
    truthy(cells.length % 7 === 0, 'cells aligned to 7-col weeks');
});

test('getMonthGridCells starts on Monday (weekday=0) and ends on Sunday (weekday=6)', () => {
    const cells = getMonthGridCells(2026, 6);
    eq(cells[0].weekday, 0);
    eq(cells[cells.length - 1].weekday, 6);
});

test('getMonthGridCells for a month starting on Monday has zero leading-pad', () => {
    // 2026-06-01 is a Monday — first cell should be 2026-06-01 itself.
    const cells = getMonthGridCells(2026, 6);
    eq(cells[0].date, '2026-06-01');
    eq(cells[0].inMonth, true);
    eq(cells[0].day, 1);
});

test('getMonthGridCells for a month starting mid-week has correct leading-pad cells', () => {
    // 2026-04-01 is a Wednesday → 2 leading-pad days from Mar 30 (Mon) and Mar 31 (Tue).
    const cells = getMonthGridCells(2026, 4);
    eq(cells[0].date, '2026-03-30');
    eq(cells[0].inMonth, false);
    eq(cells[1].date, '2026-03-31');
    eq(cells[1].inMonth, false);
    eq(cells[2].date, '2026-04-01');
    eq(cells[2].inMonth, true);
});

test('getMonthGridCells inMonth flag is true only for cells in the requested month', () => {
    const cells = getMonthGridCells(2026, 6);
    const monthDays = cells.filter(c => c.inMonth);
    eq(monthDays.length, 30); // June has 30 days
    truthy(monthDays.every(c => c.date.startsWith('2026-06-')), 'all in-month cells dated within June');
});

test('getMonthGridCells isToday is true only for the cell whose date matches todayIso', () => {
    const cells = getMonthGridCells(2026, 6, '2026-06-15');
    const today = cells.filter(c => c.isToday);
    eq(today.length, 1);
    eq(today[0].date, '2026-06-15');
});

test('getMonthGridCells with no todayIso has no isToday cells', () => {
    const cells = getMonthGridCells(2026, 6);
    eq(cells.filter(c => c.isToday).length, 0);
});

test('bucketCalendarTasks empty input returns an empty Map', () => {
    const m = bucketCalendarTasks([]);
    eq(m.size, 0);
});

test('bucketCalendarTasks task with only dueDate emits one due-pill entry', () => {
    const t = mkTask({ name: 'Pay bill', dueDate: '2026-06-15' });
    const m = bucketCalendarTasks([t]);
    eq(m.size, 1);
    const entries = m.get('2026-06-15');
    eq(entries.length, 1);
    eq(entries[0].kind, 'due');
    eq(entries[0].task.id, t.id);
});

test('bucketCalendarTasks task with only startDate emits one due-pill (sole date is the work-day)', () => {
    const t = mkTask({ name: 'Workshop', startDate: '2026-06-15' });
    const m = bucketCalendarTasks([t]);
    const entries = m.get('2026-06-15');
    eq(entries.length, 1);
    eq(entries[0].kind, 'due');
});

test('bucketCalendarTasks multi-day task emits two pills: due on dueDate, start on startDate', () => {
    const t = mkTask({ name: 'Reno', startDate: '2026-06-10', dueDate: '2026-06-15' });
    const m = bucketCalendarTasks([t]);
    eq(m.get('2026-06-10').length, 1);
    eq(m.get('2026-06-10')[0].kind, 'start');
    eq(m.get('2026-06-15').length, 1);
    eq(m.get('2026-06-15')[0].kind, 'due');
});

test('bucketCalendarTasks single-day task (start === due) emits one due-pill, not two', () => {
    const t = mkTask({ name: 'Inspection', startDate: '2026-06-15', dueDate: '2026-06-15' });
    const m = bucketCalendarTasks([t]);
    eq(m.size, 1);
    eq(m.get('2026-06-15').length, 1);
    eq(m.get('2026-06-15')[0].kind, 'due');
});

test('bucketCalendarTasks task with no dates is excluded entirely', () => {
    const t = mkTask({ name: 'Untimed' });
    const m = bucketCalendarTasks([t]);
    eq(m.size, 0);
});

// ── Overview cross-project helpers (Task 5.1) ──

function mkProject(overrides) {
    return { ...createProject({ name: 'P' }), ...overrides };
}

test('computeProjectProgress empty task list returns 0/0/0', () => {
    eq(computeProjectProgress('p1', []), { done: 0, total: 0, percent: 0 });
});

test('computeProjectProgress only counts tasks for the given project', () => {
    const tasks = [
        mkTask({ projectId: 'p1', status: 'done' }),
        mkTask({ projectId: 'p1', status: 'in-progress' }),
        mkTask({ projectId: 'p2', status: 'done' }),
    ];
    eq(computeProjectProgress('p1', tasks), { done: 1, total: 2, percent: 50 });
});

test('computeProjectProgress 100% when all tasks done', () => {
    const tasks = [
        mkTask({ projectId: 'p1', status: 'done' }),
        mkTask({ projectId: 'p1', status: 'done' }),
    ];
    eq(computeProjectProgress('p1', tasks), { done: 2, total: 2, percent: 100 });
});

test('computeProjectProgress rounds half cases to nearest whole percent', () => {
    const tasks = [
        mkTask({ projectId: 'p1', status: 'done' }),
        mkTask({ projectId: 'p1', status: 'in-progress' }),
        mkTask({ projectId: 'p1', status: 'in-progress' }),
    ];
    // 1/3 = 33.33% → 33
    eq(computeProjectProgress('p1', tasks).percent, 33);
});

test('computeProjectProgress includes subtasks in counts', () => {
    const parent = mkTask({ projectId: 'p1', status: 'in-progress' });
    const child = mkTask({ projectId: 'p1', status: 'done', parentTaskId: parent.id });
    eq(computeProjectProgress('p1', [parent, child]), { done: 1, total: 2, percent: 50 });
});

test('countOverdueTasks counts only tasks for the project, with dueDate < today and not done', () => {
    const tasks = [
        mkTask({ projectId: 'p1', dueDate: '2026-04-01', status: 'in-progress' }), // overdue
        mkTask({ projectId: 'p1', dueDate: '2026-04-01', status: 'done' }),         // ignored — done
        mkTask({ projectId: 'p1', dueDate: '2026-06-10', status: 'in-progress' }), // ignored — future
        mkTask({ projectId: 'p2', dueDate: '2026-04-01', status: 'in-progress' }), // wrong project
        mkTask({ projectId: 'p1', dueDate: null, status: 'in-progress' }),          // no due date
    ];
    eq(countOverdueTasks('p1', tasks, '2026-05-07'), 1);
});

test('countOverdueTasks dueDate equal to today is NOT overdue', () => {
    const tasks = [mkTask({ projectId: 'p1', dueDate: '2026-05-07', status: 'in-progress' })];
    eq(countOverdueTasks('p1', tasks, '2026-05-07'), 0);
});

test('findNextMilestone returns earliest future-or-today milestone with a dueDate', () => {
    const tasks = [
        mkTask({ projectId: 'p1', name: 'Past', isMilestone: true, dueDate: '2026-04-01', status: 'in-progress' }),
        mkTask({ projectId: 'p1', name: 'Soon', isMilestone: true, dueDate: '2026-06-15', status: 'in-progress' }),
        mkTask({ projectId: 'p1', name: 'Later', isMilestone: true, dueDate: '2026-09-01', status: 'in-progress' }),
        mkTask({ projectId: 'p1', name: 'NotMS', isMilestone: false, dueDate: '2026-05-20', status: 'in-progress' }),
    ];
    const m = findNextMilestone('p1', tasks, '2026-05-07');
    truthy(m);
    eq(m.name, 'Soon');
    eq(m.dueDate, '2026-06-15');
});

test('findNextMilestone falls back to earliest past milestone when none upcoming', () => {
    const tasks = [
        mkTask({ projectId: 'p1', name: 'Old', isMilestone: true, dueDate: '2026-03-01', status: 'in-progress' }),
        mkTask({ projectId: 'p1', name: 'Older', isMilestone: true, dueDate: '2026-01-01', status: 'in-progress' }),
    ];
    const m = findNextMilestone('p1', tasks, '2026-05-07');
    truthy(m);
    eq(m.name, 'Older');
});

test('findNextMilestone skips done milestones', () => {
    const tasks = [
        mkTask({ projectId: 'p1', isMilestone: true, dueDate: '2026-06-01', status: 'done' }),
        mkTask({ projectId: 'p1', name: 'Live', isMilestone: true, dueDate: '2026-08-01', status: 'in-progress' }),
    ];
    const m = findNextMilestone('p1', tasks, '2026-05-07');
    truthy(m);
    eq(m.name, 'Live');
});

test('findNextMilestone returns null when no milestones exist', () => {
    const tasks = [mkTask({ projectId: 'p1', dueDate: '2026-06-01' })];
    eq(findNextMilestone('p1', tasks, '2026-05-07'), null);
});

test('findNextMilestone ignores milestones without a dueDate', () => {
    const tasks = [
        mkTask({ projectId: 'p1', isMilestone: true, dueDate: null, status: 'in-progress' }),
    ];
    eq(findNextMilestone('p1', tasks, '2026-05-07'), null);
});

test('findNextMilestone scopes by projectId', () => {
    const tasks = [
        mkTask({ projectId: 'other', isMilestone: true, dueDate: '2026-06-01', status: 'in-progress' }),
    ];
    eq(findNextMilestone('p1', tasks, '2026-05-07'), null);
});

test('OVERVIEW_SORT_OPTIONS exposes the supported sort dimensions', () => {
    eq(OVERVIEW_SORT_OPTIONS, ['updated', 'status', 'dueDate', 'percent']);
});

test('sortProjectsForOverview default (updated) puts most recently updated first', () => {
    const a = mkProject({ id: 'a', name: 'A', updatedAt: '2026-04-01T00:00:00.000Z' });
    const b = mkProject({ id: 'b', name: 'B', updatedAt: '2026-05-01T00:00:00.000Z' });
    const c = mkProject({ id: 'c', name: 'C', updatedAt: '2026-04-15T00:00:00.000Z' });
    const sorted = sortProjectsForOverview([a, b, c], [], { by: 'updated' });
    eq(sorted.map(p => p.id), ['b', 'c', 'a']);
});

test('sortProjectsForOverview by status follows canonical PROJECT_STATUSES order', () => {
    const planning = mkProject({ id: 'plan', status: 'planning' });
    const active = mkProject({ id: 'act', status: 'active' });
    const completed = mkProject({ id: 'done', status: 'completed' });
    const cancelled = mkProject({ id: 'cancel', status: 'cancelled' });
    const sorted = sortProjectsForOverview([completed, cancelled, active, planning], [], { by: 'status' });
    eq(sorted.map(p => p.id), ['plan', 'act', 'done', 'cancel']);
});

test('sortProjectsForOverview by dueDate puts earliest endDate first, missing endDate last', () => {
    const a = mkProject({ id: 'a', endDate: '2026-08-01' });
    const b = mkProject({ id: 'b', endDate: '2026-06-01' });
    const c = mkProject({ id: 'c', endDate: null });
    const d = mkProject({ id: 'd', endDate: '2026-07-01' });
    const sorted = sortProjectsForOverview([a, b, c, d], [], { by: 'dueDate' });
    eq(sorted.map(p => p.id), ['b', 'd', 'a', 'c']);
});

test('sortProjectsForOverview by percent puts highest completion first; empty (0/0) projects sort to end', () => {
    const a = mkProject({ id: 'a' });
    const b = mkProject({ id: 'b' });
    const c = mkProject({ id: 'c' });
    const tasks = [
        mkTask({ projectId: 'a', status: 'done' }),
        mkTask({ projectId: 'a', status: 'in-progress' }),
        mkTask({ projectId: 'b', status: 'done' }),
        mkTask({ projectId: 'b', status: 'done' }),
        // c has no tasks → empty
    ];
    const sorted = sortProjectsForOverview([a, b, c], tasks, { by: 'percent' });
    // b=100%, a=50%, c=empty → b, a, c
    eq(sorted.map(p => p.id), ['b', 'a', 'c']);
});

test('sortProjectsForOverview does not mutate the input list', () => {
    const list = [mkProject({ id: 'a', updatedAt: '2026-04-01T00:00:00.000Z' }),
                  mkProject({ id: 'b', updatedAt: '2026-05-01T00:00:00.000Z' })];
    const before = list.map(p => p.id);
    sortProjectsForOverview(list, [], { by: 'updated' });
    eq(list.map(p => p.id), before);
});

test('sortProjectsForOverview empty list returns empty', () => {
    eq(sortProjectsForOverview([], [], { by: 'status' }), []);
});

// ── My Tasks per-user summary (Task 5.2) ──

test('bucketTasksForUser only includes tasks assigned to the requested user', () => {
    const tasks = [
        mkTask({ id: 't1', assignee: 'brad', dueDate: '2026-05-10', status: 'in-progress' }),
        mkTask({ id: 't2', assignee: 'diana', dueDate: '2026-05-10', status: 'in-progress' }),
        mkTask({ id: 't3', assignee: null, dueDate: '2026-05-10', status: 'in-progress' }),
    ];
    const out = bucketTasksForUser(tasks, 'brad', '2026-05-08');
    eq(out.thisWeek.map(t => t.id), ['t1']);
    eq(out.overdue, []);
    eq(out.upcoming, []);
    eq(out.completed, []);
});

test('bucketTasksForUser overdue = dueDate < today, not done', () => {
    const tasks = [
        mkTask({ id: 'a', assignee: 'brad', dueDate: '2026-04-01', status: 'in-progress' }),
        mkTask({ id: 'b', assignee: 'brad', dueDate: '2026-04-15', status: 'not-started' }),
        mkTask({ id: 'c', assignee: 'brad', dueDate: '2026-04-15', status: 'done' }),  // done → excluded from overdue
        mkTask({ id: 'd', assignee: 'brad', dueDate: '2026-05-08', status: 'in-progress' }),  // today → not overdue
    ];
    const out = bucketTasksForUser(tasks, 'brad', '2026-05-08');
    // Overdue sorted by dueDate asc (oldest first)
    eq(out.overdue.map(t => t.id), ['a', 'b']);
});

test('bucketTasksForUser thisWeek = dueDate today through today+6, not done', () => {
    const tasks = [
        mkTask({ id: 'today', assignee: 'brad', dueDate: '2026-05-08', status: 'in-progress' }),
        mkTask({ id: 'in3',   assignee: 'brad', dueDate: '2026-05-11', status: 'not-started' }),
        mkTask({ id: 'edge',  assignee: 'brad', dueDate: '2026-05-14', status: 'in-progress' }), // today+6 → in-window
        mkTask({ id: 'past6', assignee: 'brad', dueDate: '2026-05-15', status: 'in-progress' }), // today+7 → upcoming
    ];
    const out = bucketTasksForUser(tasks, 'brad', '2026-05-08');
    eq(out.thisWeek.map(t => t.id), ['today', 'in3', 'edge']);
    eq(out.upcoming.map(t => t.id), ['past6']);
});

test('bucketTasksForUser upcoming includes tasks with no dueDate', () => {
    const tasks = [
        mkTask({ id: 'undated', assignee: 'brad', dueDate: null, status: 'in-progress' }),
        mkTask({ id: 'far', assignee: 'brad', dueDate: '2026-12-01', status: 'not-started' }),
    ];
    const out = bucketTasksForUser(tasks, 'brad', '2026-05-08');
    // Dated upcoming first by dueDate asc, undated last
    eq(out.upcoming.map(t => t.id), ['far', 'undated']);
});

test('bucketTasksForUser completed = status done, sorted by completedAt desc', () => {
    const tasks = [
        mkTask({ id: 'c1', assignee: 'brad', status: 'done', completedAt: '2026-05-01T10:00:00.000Z' }),
        mkTask({ id: 'c2', assignee: 'brad', status: 'done', completedAt: '2026-05-05T10:00:00.000Z' }),
        mkTask({ id: 'c3', assignee: 'brad', status: 'done', completedAt: null, updatedAt: '2026-05-03T10:00:00.000Z' }),
    ];
    const out = bucketTasksForUser(tasks, 'brad', '2026-05-08');
    eq(out.completed.map(t => t.id), ['c2', 'c3', 'c1']);
});

test('bucketTasksForUser empty list returns empty buckets', () => {
    const out = bucketTasksForUser([], 'brad', '2026-05-08');
    eq(out, { overdue: [], thisWeek: [], upcoming: [], completed: [] });
});

test('bucketTasksForUser ignores blocked status the same as any non-done', () => {
    // "blocked" still belongs in overdue/thisWeek/upcoming based on date — only "done" goes to completed.
    const tasks = [
        mkTask({ id: 'blk', assignee: 'brad', dueDate: '2026-04-01', status: 'blocked' }),
    ];
    const out = bucketTasksForUser(tasks, 'brad', '2026-05-08');
    eq(out.overdue.map(t => t.id), ['blk']);
});

test('bucketTasksForUser picks up joint tasks for either participant (PB.9)', () => {
    const tasks = [
        mkTask({ id: 'joint', assignees: ['brad', 'diana'], dueDate: '2026-04-01', status: 'in-progress' }),
    ];
    eq(bucketTasksForUser(tasks, 'brad',  '2026-05-08').overdue.map(t => t.id), ['joint']);
    eq(bucketTasksForUser(tasks, 'diana', '2026-05-08').overdue.map(t => t.id), ['joint']);
});

test('defaultMyTasksUser maps known emails to brad/diana', () => {
    eq(defaultMyTasksUser('metalbee66@gmail.com'), 'brad');
    eq(defaultMyTasksUser('dianaleshcheva@gmail.com'), 'diana');
});

test('defaultMyTasksUser falls back to brad for unknown / empty emails', () => {
    eq(defaultMyTasksUser(''), 'brad');
    eq(defaultMyTasksUser(null), 'brad');
    eq(defaultMyTasksUser('someone-else@example.com'), 'brad');
});

test('collectMyTasksUserOptions always includes brad and diana, in canonical order', () => {
    const opts = collectMyTasksUserOptions([]);
    eq(opts.map(o => o.value).slice(0, 2), ['brad', 'diana']);
});

test('collectMyTasksUserOptions adds external assignees alphabetically after brad/diana, dedup, ignoring null', () => {
    const tasks = [
        mkTask({ assignee: 'brad' }),
        mkTask({ assignee: 'zoe' }),
        mkTask({ assignee: 'alex' }),
        mkTask({ assignee: 'zoe' }),  // dup
        mkTask({ assignee: null }),   // skip
        mkTask({ assignee: '' }),     // skip
    ];
    const opts = collectMyTasksUserOptions(tasks);
    eq(opts.map(o => o.value), ['brad', 'diana', 'alex', 'zoe']);
});

test('collectMyTasksUserOptions picks up externals from the assignees array (PB.9)', () => {
    const tasks = [
        mkTask({ assignees: ['brad', 'zoe'] }),
        mkTask({ assignees: ['alex'] }),
    ];
    const opts = collectMyTasksUserOptions(tasks);
    eq(opts.map(o => o.value), ['brad', 'diana', 'alex', 'zoe']);
});

// ── Dashboard cross-project metrics (Task 5.3) ──

test('computeDashboardMetrics returns zeros for empty inputs', () => {
    const m = computeDashboardMetrics([], [], '2026-05-08');
    eq(m.activeProjects, 0);
    eq(m.openTasks, 0);
    eq(m.overdueTasks, 0);
    eq(m.dueThisWeek, 0);
    eq(m.completedLast30Days, 0);
    eq(m.upcomingMilestones, 0);
});

test('computeDashboardMetrics activeProjects counts only status active and not archived', () => {
    const projects = [
        mkProject({ id: 'p1', status: 'active' }),
        mkProject({ id: 'p2', status: 'active', archivedAt: '2026-04-01T00:00:00.000Z' }),  // archived → excluded
        mkProject({ id: 'p3', status: 'planning' }),    // planning → excluded
        mkProject({ id: 'p4', status: 'on-hold' }),     // on-hold → excluded
        mkProject({ id: 'p5', status: 'completed' }),   // completed → excluded
        mkProject({ id: 'p6', status: 'cancelled' }),   // cancelled → excluded
        mkProject({ id: 'p7', status: 'active' }),
    ];
    const m = computeDashboardMetrics(projects, [], '2026-05-08');
    eq(m.activeProjects, 2);
});

test('computeDashboardMetrics openTasks counts non-done tasks across all projects', () => {
    const tasks = [
        mkTask({ projectId: 'p1', status: 'in-progress' }),
        mkTask({ projectId: 'p1', status: 'not-started' }),
        mkTask({ projectId: 'p1', status: 'done' }),     // excluded
        mkTask({ projectId: 'p2', status: 'review' }),
        mkTask({ projectId: 'p2', status: 'blocked' }),
        mkTask({ projectId: 'p2', status: 'done' }),     // excluded
    ];
    const m = computeDashboardMetrics([], tasks, '2026-05-08');
    eq(m.openTasks, 4);
});

test('computeDashboardMetrics overdueTasks: dueDate < today, not done, undated excluded, today not overdue', () => {
    const tasks = [
        mkTask({ id: 'a', dueDate: '2026-04-01', status: 'in-progress' }),
        mkTask({ id: 'b', dueDate: '2026-05-07', status: 'not-started' }),
        mkTask({ id: 'c', dueDate: '2026-05-08', status: 'in-progress' }),  // today → not overdue
        mkTask({ id: 'd', dueDate: '2026-05-01', status: 'done' }),         // done → excluded
        mkTask({ id: 'e', dueDate: null, status: 'in-progress' }),          // undated → excluded
    ];
    const m = computeDashboardMetrics([], tasks, '2026-05-08');
    eq(m.overdueTasks, 2);
});

test('computeDashboardMetrics dueThisWeek: today through today+6 inclusive, not done', () => {
    const tasks = [
        mkTask({ id: 'today',  dueDate: '2026-05-08', status: 'in-progress' }),
        mkTask({ id: 'in6',    dueDate: '2026-05-14', status: 'not-started' }),  // today+6 → in window
        mkTask({ id: 'in7',    dueDate: '2026-05-15', status: 'in-progress' }),  // today+7 → out
        mkTask({ id: 'past',   dueDate: '2026-05-01', status: 'in-progress' }),  // past → out
        mkTask({ id: 'tdone',  dueDate: '2026-05-10', status: 'done' }),         // done → out
    ];
    const m = computeDashboardMetrics([], tasks, '2026-05-08');
    eq(m.dueThisWeek, 2);
});

test('computeDashboardMetrics completedLast30Days: status done with completedAt within 30 days inclusive', () => {
    const tasks = [
        mkTask({ id: 'a', status: 'done', completedAt: '2026-05-08T10:00:00.000Z' }),  // today → in
        mkTask({ id: 'b', status: 'done', completedAt: '2026-04-08T10:00:00.000Z' }),  // today-30 → in (inclusive)
        mkTask({ id: 'c', status: 'done', completedAt: '2026-04-07T10:00:00.000Z' }),  // today-31 → out
        mkTask({ id: 'd', status: 'done', completedAt: null }),                         // null → out
        mkTask({ id: 'e', status: 'in-progress', completedAt: '2026-05-08T10:00:00.000Z' }),  // not done → out
    ];
    const m = computeDashboardMetrics([], tasks, '2026-05-08');
    eq(m.completedLast30Days, 2);
});

test('computeDashboardMetrics upcomingMilestones: milestones not done with dueDate today through today+13', () => {
    const tasks = [
        mkTask({ id: 'a', isMilestone: true,  status: 'in-progress', dueDate: '2026-05-08' }),  // today → in
        mkTask({ id: 'b', isMilestone: true,  status: 'not-started', dueDate: '2026-05-21' }),  // today+13 → in
        mkTask({ id: 'c', isMilestone: true,  status: 'in-progress', dueDate: '2026-05-22' }),  // today+14 → out
        mkTask({ id: 'd', isMilestone: true,  status: 'in-progress', dueDate: '2026-05-01' }),  // past → out (overdue, not upcoming)
        mkTask({ id: 'e', isMilestone: true,  status: 'done',        dueDate: '2026-05-10' }),  // done → out
        mkTask({ id: 'f', isMilestone: false, status: 'in-progress', dueDate: '2026-05-10' }),  // not milestone → out
        mkTask({ id: 'g', isMilestone: true,  status: 'in-progress', dueDate: null }),          // undated → out
    ];
    const m = computeDashboardMetrics([], tasks, '2026-05-08');
    eq(m.upcomingMilestones, 2);
});

test('computeDashboardMetrics tolerates null/undefined inputs without throwing', () => {
    const m = computeDashboardMetrics(null, null, '2026-05-08');
    eq(m.activeProjects, 0);
    eq(m.openTasks, 0);
});

test('DASHBOARD_WEEKS exposes the default chart window', () => {
    eq(DASHBOARD_WEEKS, 8);
});

test('computeWeeklyCompletionBars returns 8 buckets in chronological order (oldest first)', () => {
    const bars = computeWeeklyCompletionBars([], '2026-05-08');
    eq(bars.length, 8);
    // oldest bucket first
    truthy(bars[0].startIso < bars[7].startIso, 'bars sorted oldest → newest');
    // Newest bucket ends today
    eq(bars[7].endIso, '2026-05-08');
    // Newest bucket starts today-6
    eq(bars[7].startIso, '2026-05-02');
    // Oldest bucket starts today - 7*8 + 1 = today-55
    eq(bars[0].startIso, '2026-03-14');
    eq(bars[0].endIso, '2026-03-20');
});

test('computeWeeklyCompletionBars empty input gives all-zero bars', () => {
    const bars = computeWeeklyCompletionBars([], '2026-05-08');
    eq(bars.every(b => b.completed === 0), true);
});

test('computeWeeklyCompletionBars counts tasks done with completedAt date in bucket', () => {
    const tasks = [
        mkTask({ id: 'today',  status: 'done', completedAt: '2026-05-08T10:00:00.000Z' }),  // newest bucket
        mkTask({ id: 'd6ago',  status: 'done', completedAt: '2026-05-02T10:00:00.000Z' }),  // newest bucket (today-6)
        mkTask({ id: 'd7ago',  status: 'done', completedAt: '2026-05-01T10:00:00.000Z' }),  // 2nd-newest bucket
        mkTask({ id: 'd14ago', status: 'done', completedAt: '2026-04-24T10:00:00.000Z' }),  // 3rd-newest
        mkTask({ id: 'open',   status: 'in-progress', completedAt: null }),                  // ignored
        mkTask({ id: 'noDate', status: 'done', completedAt: null }),                          // ignored
    ];
    const bars = computeWeeklyCompletionBars(tasks, '2026-05-08');
    eq(bars[7].completed, 2);  // newest
    eq(bars[6].completed, 1);  // 2nd-newest
    eq(bars[5].completed, 1);  // 3rd-newest
    eq(bars[4].completed, 0);
    eq(bars[0].completed, 0);
});

test('computeWeeklyCompletionBars ignores tasks completed before the chart window', () => {
    const tasks = [
        mkTask({ id: 'old', status: 'done', completedAt: '2026-01-01T10:00:00.000Z' }),
    ];
    const bars = computeWeeklyCompletionBars(tasks, '2026-05-08');
    eq(bars.every(b => b.completed === 0), true);
});

test('computeWeeklyCompletionBars supports a custom week count', () => {
    const bars = computeWeeklyCompletionBars([], '2026-05-08', 4);
    eq(bars.length, 4);
    eq(bars[3].endIso, '2026-05-08');
    // Oldest bucket starts today - (7*4 - 1) = today - 27 days = 2026-04-11
    eq(bars[0].startIso, '2026-04-11');
});

test('computeWeeklyCompletionBars boundary: completedAt at start-of-bucket is included', () => {
    const tasks = [
        mkTask({ id: 'edge', status: 'done', completedAt: '2026-05-02T00:00:00.000Z' }),
    ];
    const bars = computeWeeklyCompletionBars(tasks, '2026-05-08');
    eq(bars[7].completed, 1);
});

// ── Files summary by project (Task 5.4) ──

test('collectAttachmentsByProject empty input returns empty array', () => {
    eq(collectAttachmentsByProject([], []), []);
    eq(collectAttachmentsByProject(null, null), []);
});

test('collectAttachmentsByProject groups attachments by their task\'s project', () => {
    const projects = [
        mkProject({ id: 'p1', name: 'Alpha' }),
        mkProject({ id: 'p2', name: 'Beta' }),
    ];
    const a1 = { id: 'a1', kind: 'file', name: 'note.txt', size: 100, type: 'text/plain', addedBy: 'brad', addedAt: '2026-05-01T10:00:00.000Z' };
    const a2 = { id: 'a2', kind: 'url', name: 'spec', url: 'https://example.com/spec', addedBy: 'diana', addedAt: '2026-05-02T10:00:00.000Z' };
    const tasks = [
        mkTask({ id: 't1', projectId: 'p1', name: 'task1', attachments: [a1] }),
        mkTask({ id: 't2', projectId: 'p2', name: 'task2', attachments: [a2] }),
    ];
    const out = collectAttachmentsByProject(projects, tasks);
    eq(out.length, 2);
    eq(out[0].projectId, 'p1');
    eq(out[0].projectName, 'Alpha');
    eq(out[0].items.length, 1);
    eq(out[0].items[0].attachment.id, 'a1');
    eq(out[0].items[0].taskId, 't1');
    eq(out[0].items[0].taskName, 'task1');
    eq(out[1].projectId, 'p2');
    eq(out[1].projectName, 'Beta');
    eq(out[1].items[0].attachment.id, 'a2');
});

test('collectAttachmentsByProject sorts items within a project by addedAt desc (newest first)', () => {
    const projects = [mkProject({ id: 'p1', name: 'P' })];
    const oldA = { id: 'a1', kind: 'file', name: 'old', addedAt: '2026-05-01T10:00:00.000Z' };
    const fresh = { id: 'a2', kind: 'file', name: 'fresh', addedAt: '2026-05-05T10:00:00.000Z' };
    const middle = { id: 'a3', kind: 'url', name: 'mid', url: 'https://x', addedAt: '2026-05-03T10:00:00.000Z' };
    const tasks = [
        mkTask({ id: 't1', projectId: 'p1', name: 'A', attachments: [oldA, fresh] }),
        mkTask({ id: 't2', projectId: 'p1', name: 'B', attachments: [middle] }),
    ];
    const out = collectAttachmentsByProject(projects, tasks);
    eq(out[0].items.map(x => x.attachment.id), ['a2', 'a3', 'a1']);
});

test('collectAttachmentsByProject skips projects with no attachments', () => {
    const projects = [
        mkProject({ id: 'p1', name: 'A' }),
        mkProject({ id: 'p2', name: 'B' }),
    ];
    const tasks = [
        mkTask({ id: 't1', projectId: 'p1', attachments: [{ id: 'a1', kind: 'file', name: 'f', addedAt: '2026-05-01T10:00:00.000Z' }] }),
        mkTask({ id: 't2', projectId: 'p2', attachments: [] }),
        mkTask({ id: 't3', projectId: 'p2' }), // no attachments key at all
    ];
    const out = collectAttachmentsByProject(projects, tasks);
    eq(out.length, 1);
    eq(out[0].projectId, 'p1');
});

test('collectAttachmentsByProject skips tasks whose project no longer exists', () => {
    const tasks = [
        mkTask({ id: 't1', projectId: 'orphan', attachments: [{ id: 'a1', kind: 'file', name: 'f', addedAt: '2026-05-01T10:00:00.000Z' }] }),
    ];
    eq(collectAttachmentsByProject([], tasks), []);
});

test('collectAttachmentsByProject includes both file and url attachments in the same group', () => {
    const projects = [mkProject({ id: 'p1', name: 'P' })];
    const tasks = [
        mkTask({ id: 't1', projectId: 'p1', name: 'T', attachments: [
            { id: 'a1', kind: 'file', name: 'f.txt', size: 100, addedAt: '2026-05-01T10:00:00.000Z' },
            { id: 'a2', kind: 'url', name: 'spec', url: 'https://x', addedAt: '2026-05-02T10:00:00.000Z' },
        ] }),
    ];
    const out = collectAttachmentsByProject(projects, tasks);
    eq(out[0].items.length, 2);
    const kinds = out[0].items.map(x => x.attachment.kind).sort();
    eq(kinds, ['file', 'url']);
});

test('collectAttachmentsByProject sorts groups by project name (case-insensitive)', () => {
    const projects = [
        mkProject({ id: 'p1', name: 'zebra' }),
        mkProject({ id: 'p2', name: 'Alpha' }),
        mkProject({ id: 'p3', name: 'mango' }),
    ];
    const att = (id) => ({ id, kind: 'file', name: 'f', addedAt: '2026-05-01T10:00:00.000Z' });
    const tasks = [
        mkTask({ id: 't1', projectId: 'p1', attachments: [att('a1')] }),
        mkTask({ id: 't2', projectId: 'p2', attachments: [att('a2')] }),
        mkTask({ id: 't3', projectId: 'p3', attachments: [att('a3')] }),
    ];
    const out = collectAttachmentsByProject(projects, tasks);
    eq(out.map(g => g.projectName), ['Alpha', 'mango', 'zebra']);
});

test('collectAttachmentsByProject does not mutate inputs', () => {
    const projects = [mkProject({ id: 'p1', name: 'P' })];
    const att = { id: 'a1', kind: 'file', name: 'f', addedAt: '2026-05-01T10:00:00.000Z' };
    const tasks = [mkTask({ id: 't1', projectId: 'p1', attachments: [att] })];
    const beforeAttachments = tasks[0].attachments.slice();
    collectAttachmentsByProject(projects, tasks);
    eq(tasks[0].attachments, beforeAttachments);
});

// ── emailToParticipantId (Task 6.1 prerequisite) ──

test('emailToParticipantId resolves built-in mappings', () => {
    eq(emailToParticipantId('metalbee66@gmail.com'), 'brad');
    eq(emailToParticipantId('dianaleshcheva@gmail.com'), 'diana');
});

test('emailToParticipantId returns null for unknown / empty input', () => {
    eq(emailToParticipantId(''), null);
    eq(emailToParticipantId(null), null);
    eq(emailToParticipantId(undefined), null);
    eq(emailToParticipantId('someone@example.com'), null);
});

// ── notifications.js — eventToNotification (Task 6.1) ──

function mkProjectLit(overrides) {
    return {
        id: 'pid',
        name: 'Test Project',
        status: 'active',
        startDate: null,
        endDate: null,
        participants: ['brad', 'diana'],
        description: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archivedAt: null,
        ...overrides,
    };
}

function mkEvent(overrides) {
    return {
        id: 'e_1', kind: 'status_changed', by: 'metalbee66@gmail.com',
        at: '2026-05-15T10:00:00.000Z', before: null, after: null,
        ...overrides,
    };
}

test('NOTIFICATION_KINDS covers exactly the seven trigger kinds from plan §6.1', () => {
    eq(NOTIFICATION_KINDS.slice().sort(), [
        'comment_added',
        'dependency_unblocked',
        'milestone_completed',
        'project_completed',
        'task_assigned',
        'task_due_soon',
        'task_overdue',
    ]);
});

test('eventToNotification returns null when any required input is missing', () => {
    const p = mkProjectLit(); const t = mkTask({ id: 't1', projectId: 'pid' });
    eq(eventToNotification(null, t, p, 'brad'), null);
    eq(eventToNotification(mkEvent(), null, p, 'brad'), null);
    eq(eventToNotification(mkEvent(), t, null, 'brad'), null);
    eq(eventToNotification(mkEvent(), t, p, ''), null);
});

// task_assigned

test('task_assigned fires for the new assignee', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', name: 'Lay tiles', assignee: 'diana' });
    const evt = mkEvent({ kind: 'assignee_changed', by: 'metalbee66@gmail.com', before: null, after: 'diana' });
    const n = eventToNotification(evt, t, p, 'diana');
    truthy(n, 'diana should be notified');
    eq(n.kind, 'task_assigned');
    eq(n.to, 'diana');
    eq(n.taskId, 't1');
    eq(n.projectId, 'pid');
    truthy(n.title.includes('Lay tiles'));
    truthy(n.summary.includes('Brad'), 'summary mentions the actor by display name');
});

test('task_assigned does NOT fire for non-assignees or the old assignee', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'diana' });
    const evt = mkEvent({ kind: 'assignee_changed', by: 'metalbee66@gmail.com', before: 'brad', after: 'diana' });
    eq(eventToNotification(evt, t, p, 'brad'), null);
});

test('task_assigned self-action returns null (Brad assigns to Brad)', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad' });
    const evt = mkEvent({ kind: 'assignee_changed', by: 'metalbee66@gmail.com', before: null, after: 'brad' });
    eq(eventToNotification(evt, t, p, 'brad'), null);
});

// comment_added

test('comment_added fires for the task assignee when someone else comments', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad', name: 'Plant roses' });
    const evt = mkEvent({ kind: 'comment_added', by: 'dianaleshcheva@gmail.com', after: 'c_1' });
    const n = eventToNotification(evt, t, p, 'brad');
    truthy(n);
    eq(n.kind, 'comment_added');
    eq(n.to, 'brad');
    truthy(n.summary.includes('Diana'));
});

test('comment_added does NOT fire for the commenter (self-action)', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad' });
    const evt = mkEvent({ kind: 'comment_added', by: 'metalbee66@gmail.com', after: 'c_1' });
    eq(eventToNotification(evt, t, p, 'brad'), null);
});

test('comment_added on an unassigned task notifies nobody', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: null });
    const evt = mkEvent({ kind: 'comment_added', by: 'metalbee66@gmail.com', after: 'c_1' });
    eq(eventToNotification(evt, t, p, 'brad'), null);
    eq(eventToNotification(evt, t, p, 'diana'), null);
});

// dependency_unblocked

test('dependency_unblocked fires for the assignee of the newly unblocked task', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't2', projectId: 'pid', assignee: 'diana', name: 'Paint walls' });
    const evt = mkEvent({ kind: 'dependency_unblocked', by: 'metalbee66@gmail.com', after: 't1' });
    const n = eventToNotification(evt, t, p, 'diana');
    truthy(n);
    eq(n.kind, 'dependency_unblocked');
    truthy(n.summary.includes('Paint walls'));
});

test('dependency_unblocked does NOT notify the actor who completed the predecessor', () => {
    const p = mkProjectLit();
    // Diana completes the predecessor; her own dependent task should not notify her.
    const t = mkTask({ id: 't2', projectId: 'pid', assignee: 'diana' });
    const evt = mkEvent({ kind: 'dependency_unblocked', by: 'dianaleshcheva@gmail.com', after: 't1' });
    eq(eventToNotification(evt, t, p, 'diana'), null);
});

// milestone_completed (synthesised from status_changed)

test('milestone_completed notifies all project participants except the actor', () => {
    const p = mkProjectLit({ participants: ['brad', 'diana', 'external-vendor'] });
    const t = mkTask({ id: 't1', projectId: 'pid', name: 'Site handover', isMilestone: true, status: 'done' });
    const evt = mkEvent({ kind: 'status_changed', by: 'metalbee66@gmail.com', before: 'in-progress', after: 'done' });
    const nBrad = eventToNotification(evt, t, p, 'brad');
    const nDiana = eventToNotification(evt, t, p, 'diana');
    const nExt = eventToNotification(evt, t, p, 'external-vendor');
    eq(nBrad, null);
    truthy(nDiana);
    eq(nDiana.kind, 'milestone_completed');
    truthy(nExt);
});

test('status_changed on a non-milestone task produces no notification', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', isMilestone: false, status: 'done' });
    const evt = mkEvent({ kind: 'status_changed', by: 'metalbee66@gmail.com', before: 'in-progress', after: 'done' });
    eq(eventToNotification(evt, t, p, 'diana'), null);
});

test('status_changed to non-done on a milestone produces no notification', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', isMilestone: true, status: 'in-progress' });
    const evt = mkEvent({ kind: 'status_changed', by: 'metalbee66@gmail.com', before: 'done', after: 'in-progress' });
    eq(eventToNotification(evt, t, p, 'diana'), null);
});

test('milestone_completed does not notify a non-participant', () => {
    const p = mkProjectLit({ participants: ['brad'] });
    const t = mkTask({ id: 't1', projectId: 'pid', isMilestone: true, status: 'done' });
    const evt = mkEvent({ kind: 'status_changed', by: 'metalbee66@gmail.com', before: 'in-progress', after: 'done' });
    eq(eventToNotification(evt, t, p, 'diana'), null);
});

// task_due_soon / task_overdue (synthetic, scan-based)

test('task_due_soon fires for the assignee', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad', name: 'File tax return' });
    const evt = { kind: 'task_due_soon', by: null, at: '2026-05-15T00:00:00.000Z', before: null, after: '2026-05-16' };
    const n = eventToNotification(evt, t, p, 'brad');
    truthy(n);
    eq(n.kind, 'task_due_soon');
    eq(n.by, null);
});

test('task_overdue fires for the assignee', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad', name: 'File tax return' });
    const evt = { kind: 'task_overdue', by: null, at: '2026-05-15T00:00:00.000Z', before: null, after: '2026-05-10' };
    const n = eventToNotification(evt, t, p, 'brad');
    truthy(n);
    eq(n.kind, 'task_overdue');
});

// project_completed

test('project_completed notifies all participants except the actor', () => {
    const p = mkProjectLit({ participants: ['brad', 'diana'] });
    const t = { id: null };
    const evt = mkEvent({ kind: 'project_completed', by: 'dianaleshcheva@gmail.com', before: 'active', after: 'completed' });
    const nBrad = eventToNotification(evt, t, p, 'brad');
    const nDiana = eventToNotification(evt, t, p, 'diana');
    truthy(nBrad);
    eq(nBrad.kind, 'project_completed');
    eq(nBrad.taskId, null);
    eq(nBrad.projectId, 'pid');
    eq(nDiana, null);
});

// Unknown kinds

test('eventToNotification ignores audit-only kinds (due_date_changed, dependency_added, etc.)', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad' });
    for (const kind of ['due_date_changed', 'dependency_added', 'dependency_removed', 'attachment_added', 'attachment_removed', 'unknown_kind']) {
        const evt = mkEvent({ kind, by: 'dianaleshcheva@gmail.com' });
        eq(eventToNotification(evt, t, p, 'brad'), null, `kind=${kind}`);
    }
});

// ── candidateRecipientsForEvent ──

test('candidateRecipientsForEvent picks the right recipient set per kind', () => {
    const p = mkProjectLit({ participants: ['brad', 'diana', 'extern'] });
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad', isMilestone: false });
    eq(candidateRecipientsForEvent({ kind: 'assignee_changed', after: 'diana' }, t, p), ['diana']);
    eq(candidateRecipientsForEvent({ kind: 'comment_added' }, t, p), ['brad']);
    eq(candidateRecipientsForEvent({ kind: 'dependency_unblocked' }, t, p), ['brad']);
    eq(candidateRecipientsForEvent({ kind: 'task_due_soon' }, t, p), ['brad']);
    eq(candidateRecipientsForEvent({ kind: 'task_overdue' }, t, p), ['brad']);
    // status_changed only fans out for milestones going to done.
    eq(candidateRecipientsForEvent({ kind: 'status_changed', before: 'in-progress', after: 'done' }, t, p), []);
    const tm = { ...t, isMilestone: true };
    eq(candidateRecipientsForEvent({ kind: 'status_changed', before: 'in-progress', after: 'done' }, tm, p), ['brad', 'diana', 'extern']);
    eq(candidateRecipientsForEvent({ kind: 'project_completed' }, t, p), ['brad', 'diana', 'extern']);
    eq(candidateRecipientsForEvent({ kind: 'unknown' }, t, p), []);
});

// PB.9 — recipient resolution for joint tasks

test('candidateRecipientsForEvent comment_added returns every assignee on a joint task', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignees: ['brad', 'diana'] });
    eq(candidateRecipientsForEvent({ kind: 'comment_added' }, t, p), ['brad', 'diana']);
});

test('candidateRecipientsForEvent assignee_changed reads array event.after (PB.9)', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignees: ['brad', 'diana'] });
    eq(
        candidateRecipientsForEvent({ kind: 'assignee_changed', after: ['brad', 'diana'] }, t, p),
        ['brad', 'diana']
    );
});

test('candidateRecipientsForEvent assignee_changed tolerates legacy string event.after', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignee: 'diana' });
    eq(candidateRecipientsForEvent({ kind: 'assignee_changed', after: 'diana' }, t, p), ['diana']);
});

test('candidateRecipientsForEvent comment_added returns [] for an unassigned task', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', assignees: [] });
    eq(candidateRecipientsForEvent({ kind: 'comment_added' }, t, p), []);
});

test('eventToNotification task_assigned fires for each member of an array event.after', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', name: 'Joint task', assignees: ['brad', 'diana'] });
    const evt = mkEvent({ kind: 'assignee_changed', by: 'metalbee66@gmail.com', before: [], after: ['brad', 'diana'] });
    // Brad is the actor (self) so he should NOT get notified
    eq(eventToNotification(evt, t, p, 'brad'), null);
    // Diana should
    const nDiana = eventToNotification(evt, t, p, 'diana');
    truthy(nDiana, 'diana should be notified');
    eq(nDiana.kind, 'task_assigned');
});

test('eventToNotification comment_added notifies every joint assignee except the commenter', () => {
    const p = mkProjectLit();
    const t = mkTask({ id: 't1', projectId: 'pid', name: 'Plant roses', assignees: ['brad', 'diana'] });
    // Diana is the commenter, brad is the joint partner — brad should be notified, diana shouldn't
    const evt = mkEvent({ kind: 'comment_added', by: 'dianaleshcheva@gmail.com', after: 'c_1' });
    truthy(eventToNotification(evt, t, p, 'brad'));
    eq(eventToNotification(evt, t, p, 'diana'), null);
});

test('computeTimeBasedTriggers includes joint tasks (PB.9)', () => {
    const t = mkTask({ id: 't1', projectId: 'pid', assignees: ['brad', 'diana'], dueDate: '2026-05-08', status: 'in-progress' });
    const out = computeTimeBasedTriggers([t], '2026-05-15');
    // joint task overdue → one synthetic trigger; recipients resolved downstream
    eq(out.length, 1);
    eq(out[0].event.kind, 'task_overdue');
    eq(out[0].task.id, 't1');
});

// ── deriveDependencyUnblockedTriggers ──

test('deriveDependencyUnblockedTriggers returns no triggers for non-status events', () => {
    const t = mkTask({ id: 't1', projectId: 'pid', status: 'done' });
    eq(deriveDependencyUnblockedTriggers({ kind: 'assignee_changed', after: 'brad' }, t, [t]), []);
});

test('deriveDependencyUnblockedTriggers emits one trigger per newly-unblocked dependent', () => {
    const a = mkTask({ id: 't1', projectId: 'pid', status: 'done', assignee: 'brad' });
    const b = mkTask({ id: 't2', projectId: 'pid', status: 'not-started', assignee: 'diana', dependsOn: ['t1'] });
    const c = mkTask({ id: 't3', projectId: 'pid', status: 'not-started', assignee: 'diana', dependsOn: ['t1'] });
    const evt = { kind: 'status_changed', by: 'metalbee66@gmail.com', at: 'now', before: 'in-progress', after: 'done' };
    const triggers = deriveDependencyUnblockedTriggers(evt, a, [a, b, c]);
    eq(triggers.length, 2);
    eq(triggers[0].event.kind, 'dependency_unblocked');
    eq(triggers[0].task.id, 't2');
    eq(triggers[1].task.id, 't3');
});

test('deriveDependencyUnblockedTriggers skips dependents that still have other blockers', () => {
    // t2 depends on both t1 and t4; t4 is still not-started, so t2 is not unblocked.
    const a = mkTask({ id: 't1', projectId: 'pid', status: 'done' });
    const blocker2 = mkTask({ id: 't4', projectId: 'pid', status: 'not-started' });
    const b = mkTask({ id: 't2', projectId: 'pid', status: 'not-started', assignee: 'diana', dependsOn: ['t1', 't4'] });
    const evt = { kind: 'status_changed', by: 'metalbee66@gmail.com', at: 'now', before: 'in-progress', after: 'done' };
    eq(deriveDependencyUnblockedTriggers(evt, a, [a, blocker2, b]).length, 0);
});

test('deriveDependencyUnblockedTriggers skips dependents that are themselves already done', () => {
    const a = mkTask({ id: 't1', projectId: 'pid', status: 'done' });
    const b = mkTask({ id: 't2', projectId: 'pid', status: 'done', assignee: 'diana', dependsOn: ['t1'] });
    const evt = { kind: 'status_changed', by: 'metalbee66@gmail.com', at: 'now', before: 'in-progress', after: 'done' };
    eq(deriveDependencyUnblockedTriggers(evt, a, [a, b]).length, 0);
});

test('deriveDependencyUnblockedTriggers ignores transitions that were already done', () => {
    const a = mkTask({ id: 't1', projectId: 'pid', status: 'done' });
    const b = mkTask({ id: 't2', projectId: 'pid', status: 'not-started', assignee: 'diana', dependsOn: ['t1'] });
    // before === 'done' → not a transition into done.
    const evt = { kind: 'status_changed', by: 'metalbee66@gmail.com', at: 'now', before: 'done', after: 'done' };
    eq(deriveDependencyUnblockedTriggers(evt, a, [a, b]).length, 0);
});

// ── computeTimeBasedTriggers ──

test('computeTimeBasedTriggers separates overdue from due-soon tasks', () => {
    const today = '2026-05-15T00:00:00.000Z';
    const overdue = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad', dueDate: '2026-05-10', status: 'in-progress' });
    const dueToday = mkTask({ id: 't2', projectId: 'pid', assignee: 'brad', dueDate: '2026-05-15', status: 'not-started' });
    const dueTomorrow = mkTask({ id: 't3', projectId: 'pid', assignee: 'diana', dueDate: '2026-05-16', status: 'not-started' });
    const later = mkTask({ id: 't4', projectId: 'pid', assignee: 'diana', dueDate: '2026-06-01', status: 'not-started' });
    const triggers = computeTimeBasedTriggers([overdue, dueToday, dueTomorrow, later], today);
    eq(triggers.length, 3);
    eq(triggers[0].event.kind, 'task_overdue');
    eq(triggers[1].event.kind, 'task_due_soon');
    eq(triggers[2].event.kind, 'task_due_soon');
});

test('computeTimeBasedTriggers skips done / unassigned / dateless tasks', () => {
    const today = '2026-05-15T00:00:00.000Z';
    const done = mkTask({ id: 't1', projectId: 'pid', assignee: 'brad', dueDate: '2026-05-10', status: 'done' });
    const unassigned = mkTask({ id: 't2', projectId: 'pid', assignee: null, dueDate: '2026-05-10', status: 'not-started' });
    const undated = mkTask({ id: 't3', projectId: 'pid', assignee: 'brad', dueDate: null, status: 'not-started' });
    eq(computeTimeBasedTriggers([done, unassigned, undated], today).length, 0);
});

test('computeTimeBasedTriggers returns empty array for bad input', () => {
    eq(computeTimeBasedTriggers(null, '2026-05-15T00:00:00.000Z'), []);
    eq(computeTimeBasedTriggers([], 'not-a-date'), []);
    eq(computeTimeBasedTriggers([], ''), []);
});

// ── addNotificationToBucket / processTrigger / eventToNotificationsForRecipients ──

test('addNotificationToBucket appends per-user and creates a fresh map immutably', () => {
    const start = {};
    const n1 = { id: 'n1', to: 'brad', kind: 'task_assigned', title: 't', summary: 's', at: '2026-01-01T00:00:00.000Z', read: false };
    const next = addNotificationToBucket(start, n1);
    eq(next.brad.length, 1);
    eq(Object.keys(start).length, 0, 'original map untouched');
    const next2 = addNotificationToBucket(next, { ...n1, id: 'n2' });
    eq(next2.brad.length, 2);
});

test('addNotificationToBucket trims oldest past MAX_NOTIFICATIONS_PER_USER', () => {
    let map = {};
    for (let i = 0; i < MAX_NOTIFICATIONS_PER_USER + 5; i++) {
        map = addNotificationToBucket(map, { id: 'n' + i, to: 'brad', kind: 'task_assigned', title: 't', summary: 's', at: '2026-01-01T00:00:00.000Z', read: false });
    }
    eq(map.brad.length, MAX_NOTIFICATIONS_PER_USER);
    eq(map.brad[0].id, 'n5', 'first 5 trimmed off the front');
});

test('addNotificationToBucket same-ref no-op for falsy input or missing recipient', () => {
    const start = { brad: [] };
    eq(addNotificationToBucket(start, null), start);
    eq(addNotificationToBucket(start, { id: 'n', to: null, kind: 'x', title: '', summary: '', at: '', read: false }), start);
});

test('eventToNotificationsForRecipients fans out across recipients, drops nulls', () => {
    const p = mkProjectLit({ participants: ['brad', 'diana', 'extern'] });
    const t = mkTask({ id: 't1', projectId: 'pid', isMilestone: true, status: 'done', name: 'Topping out' });
    const evt = mkEvent({ kind: 'status_changed', by: 'metalbee66@gmail.com', before: 'in-progress', after: 'done' });
    const out = eventToNotificationsForRecipients(evt, t, p, ['brad', 'diana', 'extern']);
    eq(out.length, 2, 'brad (actor) dropped; diana + extern get notifications');
    eq(out[0].to, 'diana');
    eq(out[1].to, 'extern');
});

test('processTrigger writes one notification per resolved recipient and returns the merged map', () => {
    const p = mkProjectLit({ participants: ['brad', 'diana'] });
    const t = mkTask({ id: 't1', projectId: 'pid', isMilestone: true, status: 'done', name: 'Ribbon cut' });
    const evt = mkEvent({ kind: 'status_changed', by: 'metalbee66@gmail.com', before: 'in-progress', after: 'done' });
    const { bucketMap, notifications } = processTrigger(evt, t, p, {});
    eq(notifications.length, 1);
    eq(notifications[0].to, 'diana');
    eq(bucketMap.diana.length, 1);
    truthy(!bucketMap.brad, 'brad bucket not created (he was the actor)');
});

// ── Notification preferences (Task 6.2) ──

test('createDefaultPrefs returns master on, every kind on, instant mode', () => {
    const prefs = createDefaultPrefs();
    eq(prefs.master, true);
    eq(prefs.mode, 'instant');
    // Every advertised kind is explicitly enabled, not relying on implicit truthy.
    for (const k of NOTIFICATION_KINDS) eq(prefs.kinds[k], true, `kind ${k} default-on`);
});

test('createDefaultPrefs returns fresh objects each call (no shared refs)', () => {
    const a = createDefaultPrefs();
    const b = createDefaultPrefs();
    truthy(a !== b, 'top-level distinct');
    truthy(a.kinds !== b.kinds, 'kinds map distinct');
});

test('NOTIFICATION_MODES advertises instant + digest', () => {
    eq(NOTIFICATION_MODES.includes('instant'), true);
    eq(NOTIFICATION_MODES.includes('digest'), true);
});

test('sanitiseNotificationPrefs backfills missing fields with defaults', () => {
    const sanitised = sanitiseNotificationPrefs({});
    eq(sanitised.master, true);
    eq(sanitised.mode, 'instant');
    for (const k of NOTIFICATION_KINDS) eq(sanitised.kinds[k], true);
});

test('sanitiseNotificationPrefs preserves explicit toggles', () => {
    const sanitised = sanitiseNotificationPrefs({
        master: false,
        mode: 'digest',
        kinds: { task_assigned: false },
    });
    eq(sanitised.master, false);
    eq(sanitised.mode, 'digest');
    eq(sanitised.kinds.task_assigned, false);
    // Untouched kinds still default-on
    eq(sanitised.kinds.task_overdue, true);
});

test('sanitiseNotificationPrefs coerces invalid mode to instant', () => {
    eq(sanitiseNotificationPrefs({ mode: 'nope' }).mode, 'instant');
    eq(sanitiseNotificationPrefs({ mode: null }).mode, 'instant');
});

test('sanitiseNotificationPrefs handles null / non-object input', () => {
    const a = sanitiseNotificationPrefs(null);
    eq(a.master, true);
    eq(a.mode, 'instant');
    const b = sanitiseNotificationPrefs('garbage');
    eq(b.master, true);
});

test('shouldNotifyUser returns false when master is off', () => {
    const prefs = sanitiseNotificationPrefs({ master: false });
    eq(shouldNotifyUser(prefs, 'task_assigned'), false);
});

test('shouldNotifyUser returns false when the kind toggle is off', () => {
    const prefs = sanitiseNotificationPrefs({ kinds: { task_assigned: false } });
    eq(shouldNotifyUser(prefs, 'task_assigned'), false);
    eq(shouldNotifyUser(prefs, 'task_overdue'), true);
});

test('shouldNotifyUser default-allows an unknown kind when master is on', () => {
    // New kinds added in future shouldn't be silently muted for users with stored prefs.
    const prefs = sanitiseNotificationPrefs({});
    eq(shouldNotifyUser(prefs, 'never_seen_before_kind'), true);
});

test('shouldNotifyUser treats null prefs as fully enabled', () => {
    eq(shouldNotifyUser(null, 'task_assigned'), true);
    eq(shouldNotifyUser(undefined, 'task_overdue'), true);
});

// ── markNotificationRead / markAllNotificationsRead / unreadCount / getUserNotifications ──

function mkNotif(id, to, opts) {
    return {
        id,
        kind: (opts && opts.kind) || 'task_assigned',
        to,
        by: null,
        taskId: null,
        projectId: null,
        title: 'T',
        summary: 'S',
        at: (opts && opts.at) || '2026-05-01T00:00:00.000Z',
        read: !!(opts && opts.read),
    };
}

test('markNotificationRead flips read=true on the matching id immutably', () => {
    const map = { brad: [mkNotif('a', 'brad'), mkNotif('b', 'brad')] };
    const next = markNotificationRead(map, 'brad', 'b');
    eq(next.brad[0].read, false);
    eq(next.brad[1].read, true);
    eq(map.brad[1].read, false, 'original map untouched');
    truthy(next !== map, 'fresh map ref');
});

test('markNotificationRead is a same-ref no-op for unknown user / id', () => {
    const map = { brad: [mkNotif('a', 'brad')] };
    eq(markNotificationRead(map, 'diana', 'a'), map);
    eq(markNotificationRead(map, 'brad', 'missing'), map);
});

test('markNotificationRead is a same-ref no-op when already read', () => {
    const map = { brad: [mkNotif('a', 'brad', { read: true })] };
    eq(markNotificationRead(map, 'brad', 'a'), map);
});

test('markAllNotificationsRead flips every unread entry for one user', () => {
    const map = {
        brad: [mkNotif('a', 'brad'), mkNotif('b', 'brad', { read: true }), mkNotif('c', 'brad')],
        diana: [mkNotif('d', 'diana')],
    };
    const next = markAllNotificationsRead(map, 'brad');
    eq(next.brad.every(n => n.read), true);
    eq(next.diana[0].read, false, 'other users untouched');
    truthy(next !== map, 'fresh map ref');
});

test('markAllNotificationsRead is a same-ref no-op when nothing is unread', () => {
    const map = { brad: [mkNotif('a', 'brad', { read: true })] };
    eq(markAllNotificationsRead(map, 'brad'), map);
});

test('markAllNotificationsRead is a same-ref no-op for an unknown user', () => {
    const map = { brad: [mkNotif('a', 'brad')] };
    eq(markAllNotificationsRead(map, 'ghost'), map);
});

test('unreadCount counts only unread notifications for the given user', () => {
    const map = {
        brad: [mkNotif('a', 'brad'), mkNotif('b', 'brad', { read: true }), mkNotif('c', 'brad')],
        diana: [mkNotif('d', 'diana')],
    };
    eq(unreadCount(map, 'brad'), 2);
    eq(unreadCount(map, 'diana'), 1);
});

test('unreadCount returns 0 for a missing user or empty map', () => {
    eq(unreadCount({}, 'brad'), 0);
    eq(unreadCount(null, 'brad'), 0);
});

test('getUserNotifications returns newest-first within MAX_NOTIFICATIONS_PER_USER', () => {
    // Storage order is oldest → newest (addNotificationToBucket appends).
    // The bell wants newest first, so getUserNotifications reverses.
    const map = {
        brad: [
            mkNotif('old', 'brad', { at: '2026-05-01T00:00:00.000Z' }),
            mkNotif('mid', 'brad', { at: '2026-05-02T00:00:00.000Z' }),
            mkNotif('new', 'brad', { at: '2026-05-03T00:00:00.000Z' }),
        ],
    };
    const out = getUserNotifications(map, 'brad');
    eq(out.length, 3);
    eq(out[0].id, 'new');
    eq(out[2].id, 'old');
});

test('getUserNotifications returns an empty array for missing user / map', () => {
    eq(getUserNotifications({}, 'brad'), []);
    eq(getUserNotifications(null, 'brad'), []);
    eq(getUserNotifications({ brad: [] }, 'brad'), []);
});

test('getUserNotifications never returns more than MAX_NOTIFICATIONS_PER_USER even if storage somehow exceeds it', () => {
    // Defensive cap — addNotificationToBucket already trims, but the bell shouldn't render
    // an unbounded list if a future code path or remote race produced a larger bucket.
    const arr = [];
    for (let i = 0; i < MAX_NOTIFICATIONS_PER_USER + 10; i++) {
        arr.push(mkNotif('n' + i, 'brad'));
    }
    const out = getUserNotifications({ brad: arr }, 'brad');
    eq(out.length, MAX_NOTIFICATIONS_PER_USER);
});

// ── Email queue (Task 6.3) ──

test('participantEmail resolves built-in participants and returns null otherwise', () => {
    eq(participantEmail('brad'), 'metalbee66@gmail.com');
    eq(participantEmail('diana'), 'dianaleshcheva@gmail.com');
    eq(participantEmail('external_consultant'), null);
    eq(participantEmail(null), null);
    eq(participantEmail(''), null);
});

test('EMAIL_QUEUE_KEY is the root-level Firebase key, not under projects', () => {
    // The n8n drainer reads /household/family/email_queue/* — keeping this a
    // sibling of `projects` is required by the plan §6.3 schema. Guard against
    // a future refactor that accidentally moves it under `projects/`.
    eq(EMAIL_QUEUE_KEY, 'email_queue');
});

test('shouldEnqueueInstantEmail respects master, kind, and mode', () => {
    const allOn = sanitiseNotificationPrefs({});
    eq(shouldEnqueueInstantEmail(allOn, 'task_assigned'), true);

    const masterOff = sanitiseNotificationPrefs({ master: false });
    eq(shouldEnqueueInstantEmail(masterOff, 'task_assigned'), false);

    const kindOff = sanitiseNotificationPrefs({ kinds: { task_assigned: false } });
    eq(shouldEnqueueInstantEmail(kindOff, 'task_assigned'), false);

    const digest = sanitiseNotificationPrefs({ mode: 'digest' });
    eq(shouldEnqueueInstantEmail(digest, 'task_assigned'), false, 'digest mode defers to Phase 6.4 roll-up');
});

test('shouldEnqueueInstantEmail treats null prefs as enabled (instant by default)', () => {
    eq(shouldEnqueueInstantEmail(null, 'task_assigned'), true);
    eq(shouldEnqueueInstantEmail(undefined, 'task_overdue'), true);
});

test('buildEmailQueueEntry returns a fully-shaped queue record for a built-in recipient', () => {
    const notif = {
        id: 'n1', kind: 'task_assigned', to: 'diana', by: 'metalbee66@gmail.com',
        taskId: 't1', projectId: 'p1',
        title: 'Task assigned: Buy timber',
        summary: 'Brad assigned "Buy timber" to you in Reno.',
        at: '2026-05-21T10:00:00.000Z', read: false,
    };
    const entry = buildEmailQueueEntry(notif, { id: 'p1', name: 'Reno' }, { id: 't1', name: 'Buy timber' }, 'https://example.test/');
    truthy(entry !== null);
    eq(entry.to, 'dianaleshcheva@gmail.com');
    eq(entry.subject, '[Family Planner] Task assigned: Buy timber');
    eq(entry.kind, 'task_assigned');
    eq(entry.taskId, 't1');
    eq(entry.projectId, 'p1');
    eq(entry.notificationId, 'n1');
    eq(entry.sourceUrl, 'https://example.test/#/projects/p1/tasks/t1');
    eq(entry.sent, false);
    eq(entry.sentAt, null);
    eq(entry.attempts, 0);
    eq(entry.failed, false);
    truthy(typeof entry.id === 'string' && entry.id.startsWith('eq_'));
    truthy(entry.bodyHtml.includes('Brad assigned'), 'summary embedded in body');
    truthy(entry.bodyHtml.includes('https://example.test/#/projects/p1/tasks/t1'), 'sourceUrl linked in body');
});

test('buildEmailQueueEntry returns null when recipient has no email on file', () => {
    const notif = {
        id: 'n2', kind: 'task_assigned', to: 'external_consultant', by: 'metalbee66@gmail.com',
        taskId: 't1', projectId: 'p1',
        title: 'Task assigned: Site visit', summary: '...',
        at: '2026-05-21T10:00:00.000Z', read: false,
    };
    eq(buildEmailQueueEntry(notif, { id: 'p1', name: 'Reno' }, { id: 't1', name: 'Site visit' }), null);
});

test('buildEmailQueueEntry returns null for malformed inputs', () => {
    eq(buildEmailQueueEntry(null, {}, {}), null);
    eq(buildEmailQueueEntry({ to: 'brad' }, {}, {}), null, 'missing kind');
    eq(buildEmailQueueEntry({ kind: 'task_assigned' }, {}, {}), null, 'missing recipient');
});

test('buildEmailQueueEntry uses project name in subject for project_completed', () => {
    const notif = {
        id: 'n3', kind: 'project_completed', to: 'brad', by: 'dianaleshcheva@gmail.com',
        taskId: null, projectId: 'p1',
        title: 'Project completed: Reno', summary: 'Diana marked Reno as completed.',
        at: '2026-05-21T10:00:00.000Z', read: false,
    };
    const entry = buildEmailQueueEntry(notif, { id: 'p1', name: 'Reno' }, null);
    eq(entry.subject, '[Family Planner] Project completed: Reno');
    eq(entry.taskId, null);
});

test('buildEmailQueueEntry HTML-escapes the summary so user input cannot break the email body', () => {
    const notif = {
        id: 'n4', kind: 'comment_added', to: 'brad', by: 'dianaleshcheva@gmail.com',
        taskId: 't1', projectId: 'p1',
        title: 'New comment', summary: 'Diana commented: <script>alert(1)</script>',
        at: '2026-05-21T10:00:00.000Z', read: false,
    };
    const entry = buildEmailQueueEntry(notif, { id: 'p1', name: 'Reno' }, { id: 't1', name: 'Demo' });
    truthy(!entry.bodyHtml.includes('<script>'), 'raw <script> escaped');
    truthy(entry.bodyHtml.includes('&lt;script&gt;'), 'entity-encoded in output');
});

test('buildEmailQueueEntry falls back to the deployed-app base URL when none is passed', () => {
    const notif = {
        id: 'n5', kind: 'task_assigned', to: 'brad', by: 'dianaleshcheva@gmail.com',
        taskId: 't1', projectId: 'p1',
        title: 'Task assigned: X', summary: '...',
        at: '2026-05-21T10:00:00.000Z', read: false,
    };
    const entry = buildEmailQueueEntry(notif, { id: 'p1', name: 'P' }, { id: 't1', name: 'X' });
    truthy(entry.sourceUrl.startsWith('https://'), 'default base url is an absolute https URL');
    truthy(entry.sourceUrl.endsWith('#/projects/p1/tasks/t1'), 'preserves deep-link hash shape');
});

// ── Digest mode (Task 6.4) ──

test('shouldAccumulateDigest is true only when master + kind + digest mode all align', () => {
    const instant = sanitiseNotificationPrefs({ mode: 'instant' });
    eq(shouldAccumulateDigest(instant, 'task_assigned'), false, 'instant mode never accumulates');

    const digest = sanitiseNotificationPrefs({ mode: 'digest' });
    eq(shouldAccumulateDigest(digest, 'task_assigned'), true);

    const digestMasterOff = sanitiseNotificationPrefs({ master: false, mode: 'digest' });
    eq(shouldAccumulateDigest(digestMasterOff, 'task_assigned'), false);

    const digestKindOff = sanitiseNotificationPrefs({ mode: 'digest', kinds: { task_assigned: false } });
    eq(shouldAccumulateDigest(digestKindOff, 'task_assigned'), false);
});

test('shouldAccumulateDigest treats null prefs as instant (default) — does not accumulate', () => {
    // Default for unsaved prefs is mode='instant'; digest is opt-in.
    eq(shouldAccumulateDigest(null, 'task_assigned'), false);
    eq(shouldAccumulateDigest(undefined, 'task_assigned'), false);
});

test('appendDigestEntry immutably appends one entry per user', () => {
    const start = {};
    const e1 = { id: 'd1', kind: 'task_assigned', title: 'T1', summary: 'S1', at: '2026-05-21T10:00:00.000Z' };
    const next = appendDigestEntry(start, 'diana', e1);
    eq(next.diana.length, 1);
    eq(Object.keys(start).length, 0, 'original map untouched');
    const next2 = appendDigestEntry(next, 'diana', { ...e1, id: 'd2' });
    eq(next2.diana.length, 2);
    eq(next.diana.length, 1, 'previous map untouched');
});

test('appendDigestEntry is a same-ref no-op for falsy input or missing recipient', () => {
    const start = { diana: [] };
    eq(appendDigestEntry(start, 'diana', null), start);
    eq(appendDigestEntry(start, null, { id: 'd', kind: 'x' }), start);
    eq(appendDigestEntry(start, '', { id: 'd', kind: 'x' }), start);
});

test('clearDigestForUser empties one bucket immutably', () => {
    const start = {
        brad: [{ id: 'd1', kind: 'task_assigned', title: 'T', summary: 'S', at: '' }],
        diana: [{ id: 'd2', kind: 'comment_added', title: 'C', summary: 'X', at: '' }],
    };
    const next = clearDigestForUser(start, 'brad');
    eq(next.brad.length, 0);
    eq(next.diana.length, 1, 'other users untouched');
    eq(start.brad.length, 1, 'original map untouched');
});

test('clearDigestForUser is a same-ref no-op for unknown user or already-empty bucket', () => {
    const start = { brad: [] };
    eq(clearDigestForUser(start, 'ghost'), start);
    eq(clearDigestForUser(start, 'brad'), start);
});

test('composeDigestSummary returns a comma-separated grouped count', () => {
    const entries = [
        { kind: 'task_assigned' }, { kind: 'task_assigned' }, { kind: 'task_assigned' },
        { kind: 'task_overdue' }, { kind: 'task_overdue' },
        { kind: 'milestone_completed' },
    ];
    eq(composeDigestSummary(entries), '3 tasks assigned, 2 tasks overdue, 1 milestone completed');
});

test('composeDigestSummary uses singular for count of 1', () => {
    eq(composeDigestSummary([{ kind: 'task_assigned' }]), '1 task assigned');
});

test('composeDigestSummary preserves canonical NOTIFICATION_KINDS ordering, not input order', () => {
    const entries = [
        { kind: 'project_completed' },
        { kind: 'task_assigned' },
        { kind: 'task_overdue' },
    ];
    const out = composeDigestSummary(entries);
    // task_assigned is first in NOTIFICATION_KINDS; project_completed is last
    truthy(out.indexOf('task assigned') < out.indexOf('task overdue'), 'task_assigned before task_overdue');
    truthy(out.indexOf('task overdue') < out.indexOf('project completed'), 'task_overdue before project_completed');
});

test('composeDigestSummary returns empty string for empty / malformed input', () => {
    eq(composeDigestSummary([]), '');
    eq(composeDigestSummary(null), '');
    eq(composeDigestSummary([null, { foo: 'no-kind' }]), '');
});

test('buildDigestEmail returns a full {to, subject, bodyHtml} for a known recipient', () => {
    const entries = [
        { id: 'd1', kind: 'task_assigned', title: 'Task assigned: Pour foundation', summary: 'Diana assigned "Pour foundation".', at: '2026-05-21T10:00:00.000Z' },
        { id: 'd2', kind: 'task_overdue', title: 'Overdue: Wire kitchen', summary: '"Wire kitchen" is past its due date.', at: '2026-05-21T10:01:00.000Z' },
    ];
    const email = buildDigestEmail('brad', entries, 'https://example.test/');
    truthy(email !== null);
    eq(email.to, 'metalbee66@gmail.com');
    truthy(email.subject.startsWith('[Family Planner] Daily digest'), 'subject prefixed');
    truthy(email.subject.includes('1 task assigned'), 'summary in subject');
    truthy(email.subject.includes('1 task overdue'), 'second count in subject');
    truthy(email.bodyHtml.includes('Pour foundation'), 'first entry rendered');
    truthy(email.bodyHtml.includes('Wire kitchen'), 'second entry rendered');
    truthy(email.bodyHtml.includes('https://example.test/'), 'app link rendered');
});

test('buildDigestEmail HTML-escapes entry title + summary', () => {
    const entries = [
        { id: 'd1', kind: 'comment_added', title: '<b>X</b>', summary: 'Diana said <script>alert(1)</script>', at: '' },
    ];
    const email = buildDigestEmail('brad', entries);
    truthy(!email.bodyHtml.includes('<script>'), 'raw script tag escaped');
    truthy(!email.bodyHtml.includes('<b>X</b>'), 'raw <b> in title escaped');
    truthy(email.bodyHtml.includes('&lt;script&gt;'));
});

test('buildDigestEmail returns null for unknown recipient or empty entries', () => {
    eq(buildDigestEmail('external_consultant', [{ kind: 'task_assigned', title: 'T', summary: 'S', at: '' }]), null);
    eq(buildDigestEmail('brad', []), null);
    eq(buildDigestEmail('brad', null), null);
});

// ── Email-queue admin panel (Task 6.5) ──

test('ADMIN_USER_IDS lists brad as the default admin', () => {
    truthy(Array.isArray(ADMIN_USER_IDS));
    eq(ADMIN_USER_IDS.includes('brad'), true);
});

test('isAdminUser is true for brad, false for non-admins', () => {
    eq(isAdminUser('brad'), true);
    eq(isAdminUser('diana'), false);
    eq(isAdminUser('external'), false);
    eq(isAdminUser(null), false);
    eq(isAdminUser(''), false);
});

test('EMAIL_QUEUE_STATUSES advertises pending / sent / failed', () => {
    eq(EMAIL_QUEUE_STATUSES, ['pending', 'sent', 'failed']);
});

function mkQueueEntry(id, opts) {
    opts = opts || {};
    return {
        id,
        to: opts.to || 'metalbee66@gmail.com',
        subject: opts.subject || '[Family Planner] Task assigned: X',
        bodyHtml: '<p>...</p>',
        kind: opts.kind || 'task_assigned',
        notificationId: null,
        taskId: opts.taskId || null,
        projectId: opts.projectId || null,
        sourceUrl: '',
        queuedAt: opts.queuedAt || '2026-05-21T10:00:00.000Z',
        sent: !!opts.sent,
        sentAt: opts.sentAt || null,
        attempts: opts.attempts == null ? 0 : opts.attempts,
        failed: !!opts.failed,
    };
}

test('classifyQueueEntry returns sent / failed / pending based on the entry flags', () => {
    eq(classifyQueueEntry(mkQueueEntry('a', { sent: true, sentAt: '2026-05-21T11:00:00.000Z' })), 'sent');
    eq(classifyQueueEntry(mkQueueEntry('b', { failed: true, attempts: 3 })), 'failed');
    eq(classifyQueueEntry(mkQueueEntry('c')), 'pending');
});

test('classifyQueueEntry: sent wins over failed (delivered overrides any retry history)', () => {
    // n8n could conceivably set sent=true on a retry that previously hit failed=true.
    // Once delivered, the entry is sent regardless of historical failure flags.
    eq(classifyQueueEntry(mkQueueEntry('a', { sent: true, failed: true })), 'sent');
});

test('classifyQueueEntry returns null for null / non-object input', () => {
    eq(classifyQueueEntry(null), null);
    eq(classifyQueueEntry('not an entry'), null);
});

test('countQueueByStatus tallies pending / sent / failed across the map', () => {
    const map = {
        a: mkQueueEntry('a', { sent: true }),
        b: mkQueueEntry('b', { failed: true }),
        c: mkQueueEntry('c'),
        d: mkQueueEntry('d', { failed: true }),
        e: mkQueueEntry('e'),
    };
    eq(countQueueByStatus(map), { pending: 2, sent: 1, failed: 2, total: 5 });
});

test('countQueueByStatus handles empty / null input', () => {
    eq(countQueueByStatus({}), { pending: 0, sent: 0, failed: 0, total: 0 });
    eq(countQueueByStatus(null), { pending: 0, sent: 0, failed: 0, total: 0 });
});

test('getQueueEntriesForAdmin returns entries newest-first', () => {
    const map = {
        a: mkQueueEntry('a', { queuedAt: '2026-05-20T10:00:00.000Z' }),
        b: mkQueueEntry('b', { queuedAt: '2026-05-22T10:00:00.000Z' }),
        c: mkQueueEntry('c', { queuedAt: '2026-05-21T10:00:00.000Z' }),
    };
    const out = getQueueEntriesForAdmin(map, {});
    eq(out.map(e => e.id), ['b', 'c', 'a']);
});

test('getQueueEntriesForAdmin caps at ADMIN_QUEUE_PAGE_SIZE (50)', () => {
    truthy(ADMIN_QUEUE_PAGE_SIZE === 50);
    const map = {};
    for (let i = 0; i < ADMIN_QUEUE_PAGE_SIZE + 12; i++) {
        const t = `2026-05-21T${String(i).padStart(2, '0')}:00:00.000Z`;
        map['e' + i] = mkQueueEntry('e' + i, { queuedAt: t });
    }
    const out = getQueueEntriesForAdmin(map, {});
    eq(out.length, ADMIN_QUEUE_PAGE_SIZE);
});

test('getQueueEntriesForAdmin filters by status when provided', () => {
    const map = {
        a: mkQueueEntry('a', { sent: true, queuedAt: '2026-05-22T10:00:00.000Z' }),
        b: mkQueueEntry('b', { failed: true, queuedAt: '2026-05-21T10:00:00.000Z' }),
        c: mkQueueEntry('c', { queuedAt: '2026-05-20T10:00:00.000Z' }),
    };
    eq(getQueueEntriesForAdmin(map, { status: 'failed' }).map(e => e.id), ['b']);
    eq(getQueueEntriesForAdmin(map, { status: 'sent' }).map(e => e.id), ['a']);
    eq(getQueueEntriesForAdmin(map, { status: 'pending' }).map(e => e.id), ['c']);
    eq(getQueueEntriesForAdmin(map, { status: null }).map(e => e.id), ['a', 'b', 'c']);
});

test('getQueueEntriesForAdmin returns an empty array for null / empty map', () => {
    eq(getQueueEntriesForAdmin({}, {}), []);
    eq(getQueueEntriesForAdmin(null, {}), []);
});

test('retryQueueEntry resets sent / sentAt / attempts / failed on the matching entry, immutably', () => {
    const entry = mkQueueEntry('a', { sent: false, failed: true, attempts: 3, sentAt: null });
    const next = retryQueueEntry(entry);
    truthy(next !== entry, 'fresh ref');
    eq(next.sent, false);
    eq(next.sentAt, null);
    eq(next.attempts, 0);
    eq(next.failed, false);
    // Original untouched
    eq(entry.failed, true);
    eq(entry.attempts, 3);
});

test('retryQueueEntry returns the same ref for null input', () => {
    eq(retryQueueEntry(null), null);
});

test('clearSentOlderThan removes sent entries with sentAt < threshold, keeps newer + non-sent', () => {
    const map = {
        oldSent: mkQueueEntry('oldSent', { sent: true, sentAt: '2026-05-01T10:00:00.000Z' }),
        recentSent: mkQueueEntry('recentSent', { sent: true, sentAt: '2026-05-21T10:00:00.000Z' }),
        pending: mkQueueEntry('pending', { sent: false }),
        failed: mkQueueEntry('failed', { failed: true }),
    };
    // Threshold: anything sent before 2026-05-15 goes
    const next = clearSentOlderThan(map, '2026-05-15T00:00:00.000Z');
    truthy(!next.oldSent, 'old sent removed');
    truthy(next.recentSent, 'recent sent kept');
    truthy(next.pending, 'pending kept (never affected by clearSent)');
    truthy(next.failed, 'failed kept (never affected by clearSent)');
    // Original untouched
    truthy(map.oldSent, 'original map untouched');
});

test('clearSentOlderThan is a same-ref no-op when nothing qualifies', () => {
    const map = {
        a: mkQueueEntry('a', { sent: true, sentAt: '2026-05-21T10:00:00.000Z' }),
        b: mkQueueEntry('b'),
    };
    eq(clearSentOlderThan(map, '2026-05-15T00:00:00.000Z'), map);
});

test('clearSentOlderThan returns the input unchanged for null / non-object input', () => {
    eq(clearSentOlderThan(null, '2026-05-15T00:00:00.000Z'), null);
});

// ── Celebrations (Task 7.1) ──

test('CELEBRATION_INTENSITIES advertises light / medium / full', () => {
    eq(CELEBRATION_INTENSITIES, ['light', 'medium', 'full']);
});

test('CELEBRATION_VARIANTS has at least 5 light variants to satisfy "5 in a row, all different"', () => {
    // Plan §7.1 verification: "Mark 5 tasks done in a row → all 5 celebrations are different".
    truthy(CELEBRATION_VARIANTS.light.length >= 5, 'need ≥5 light variants for the no-repeat cycle');
    truthy(CELEBRATION_VARIANTS.medium.length >= 1);
    truthy(CELEBRATION_VARIANTS.full.length >= 1);
});

test('classifyCelebration returns full when the completion finishes the project', () => {
    // allTasksDone takes precedence over isMilestone — finishing the project
    // is the biggest moment regardless of whether the last task was a milestone.
    eq(classifyCelebration({ wasMilestone: false, allTasksDoneAfter: true }), 'full');
    eq(classifyCelebration({ wasMilestone: true, allTasksDoneAfter: true }), 'full');
});

test('classifyCelebration returns medium for a milestone that does not finish the project', () => {
    eq(classifyCelebration({ wasMilestone: true, allTasksDoneAfter: false }), 'medium');
});

test('classifyCelebration returns light for a regular task done', () => {
    eq(classifyCelebration({ wasMilestone: false, allTasksDoneAfter: false }), 'light');
    eq(classifyCelebration({}), 'light', 'defaults to light on missing input');
});

test('pickCelebrationVariant cycles through the full pool with no repeats before refilling', () => {
    __resetCelebrationQueues();
    const pool = CELEBRATION_VARIANTS.light;
    const picks = [];
    for (let i = 0; i < pool.length; i++) picks.push(pickCelebrationVariant('light'));
    eq(new Set(picks).size, pool.length, 'every variant picked once before any repeat');
});

test('pickCelebrationVariant never repeats the same variant on consecutive calls across cycles', () => {
    // After exhausting one cycle, the queue refills. The first pick of the new
    // cycle must not equal the last pick of the previous one — otherwise users
    // see the same celebration twice in a row.
    __resetCelebrationQueues();
    const pool = CELEBRATION_VARIANTS.light;
    let prev = null;
    for (let cycle = 0; cycle < 4; cycle++) {
        for (let i = 0; i < pool.length; i++) {
            const v = pickCelebrationVariant('light');
            truthy(v !== prev, `cycle ${cycle} pick ${i}: ${v} repeats prev ${prev}`);
            prev = v;
        }
    }
});

test('pickCelebrationVariant returns null for an unknown intensity', () => {
    __resetCelebrationQueues();
    eq(pickCelebrationVariant('nope'), null);
    eq(pickCelebrationVariant(null), null);
});

test('isCelebrationSoundEnabled defaults to false (plan §7.1: sound is opt-in)', () => {
    localStorage.removeItem('celebrate_sound_enabled');
    eq(isCelebrationSoundEnabled(), false);
});

test('setCelebrationSoundEnabled / isCelebrationSoundEnabled round-trip via localStorage', () => {
    setCelebrationSoundEnabled(true);
    eq(isCelebrationSoundEnabled(), true);
    setCelebrationSoundEnabled(false);
    eq(isCelebrationSoundEnabled(), false);
    localStorage.removeItem('celebrate_sound_enabled');
});

// ── Local AI helpers (Task 7.2) ──

test('suggestTaskNames returns empty array for empty input', () => {
    eq(suggestTaskNames('', []), []);
    eq(suggestTaskNames('', null), []);
});

test('suggestTaskNames orders results by frequency desc then alpha asc', () => {
    const tasks = [
        { name: 'Mow lawn' },
        { name: 'Mow lawn' },
        { name: 'Mow lawn' },
        { name: 'Edge garden' },
        { name: 'Edge garden' },
        { name: 'Trim hedge' },
    ];
    const out = suggestTaskNames('', tasks);
    eq(out.map(s => s.name), ['Mow lawn', 'Edge garden', 'Trim hedge']);
    eq(out.map(s => s.count), [3, 2, 1]);
});

test('suggestTaskNames filters by case-insensitive prefix', () => {
    const tasks = [
        { name: 'Mow lawn' },
        { name: 'mow grass' },
        { name: 'Edge garden' },
        { name: 'Move boxes' },
    ];
    const out = suggestTaskNames('mo', tasks);
    // Mow lawn, mow grass, Move boxes — all start with "mo" case-insensitively.
    // .sort() applies the default JS charcode order: capitals first ('M' < 'm').
    eq(out.map(s => s.name).sort(), ['Move boxes', 'Mow lawn', 'mow grass']);
});

test('suggestTaskNames dedupes case-insensitively and keeps first-seen casing', () => {
    const tasks = [
        { name: 'Mow Lawn' },
        { name: 'mow lawn' },
        { name: 'MOW LAWN' },
    ];
    const out = suggestTaskNames('', tasks);
    eq(out.length, 1);
    eq(out[0].name, 'Mow Lawn');
    eq(out[0].count, 3);
});

test('suggestTaskNames respects the limit option (default 5)', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ name: `Task ${i}` }));
    eq(suggestTaskNames('', tasks).length, 5);
    eq(suggestTaskNames('', tasks, { limit: 3 }).length, 3);
});

test('suggestTaskNames ignores blank/whitespace names', () => {
    const tasks = [{ name: '' }, { name: '   ' }, { name: null }, { name: 'Real task' }];
    const out = suggestTaskNames('', tasks);
    eq(out.length, 1);
    eq(out[0].name, 'Real task');
});

// ── suggestDueDate ──

test('suggestDueDate returns today + fallbackDays when no historical tasks', () => {
    eq(suggestDueDate({ id: 'p1' }, [], { todayIso: '2026-05-24', fallbackDays: 7 }), '2026-05-31');
});

test('suggestDueDate uses median offset (in days) from past completed tasks in same project', () => {
    const tasks = [
        { projectId: 'p1', startDate: '2026-05-01', dueDate: '2026-05-04' }, // 3 days
        { projectId: 'p1', startDate: '2026-05-05', dueDate: '2026-05-12' }, // 7 days
        { projectId: 'p1', startDate: '2026-05-10', dueDate: '2026-05-15' }, // 5 days
    ];
    // Median of [3, 7, 5] is 5 → 2026-05-24 + 5 = 2026-05-29
    eq(suggestDueDate({ id: 'p1' }, tasks, { todayIso: '2026-05-24' }), '2026-05-29');
});

test('suggestDueDate falls back to global history when project has none', () => {
    const tasks = [
        { projectId: 'other', startDate: '2026-04-01', dueDate: '2026-04-11' }, // 10 days
        { projectId: 'other', startDate: '2026-04-10', dueDate: '2026-04-20' }, // 10 days
    ];
    eq(suggestDueDate({ id: 'p1' }, tasks, { todayIso: '2026-05-24', fallbackDays: 7 }), '2026-06-03');
});

test('suggestDueDate clamps to project.endDate when the suggestion would overshoot', () => {
    const tasks = [
        { projectId: 'p1', startDate: '2026-05-01', dueDate: '2026-06-20' }, // 50 days
    ];
    eq(
        suggestDueDate(
            { id: 'p1', endDate: '2026-05-30' },
            tasks,
            { todayIso: '2026-05-24' }
        ),
        '2026-05-30'
    );
});

test('suggestDueDate skips tasks missing start or due dates', () => {
    const tasks = [
        { projectId: 'p1', startDate: null, dueDate: '2026-05-04' },
        { projectId: 'p1', startDate: '2026-05-01', dueDate: null },
        { projectId: 'p1' },
    ];
    eq(suggestDueDate({ id: 'p1' }, tasks, { todayIso: '2026-05-24', fallbackDays: 7 }), '2026-05-31');
});

// ── composeDashboardDigest ──

test('composeDashboardDigest returns "All clear" when nothing pressing', () => {
    eq(composeDashboardDigest([], '2026-05-24'), 'All clear — nothing pressing right now.');
});

test('composeDashboardDigest counts tasks due today, overdue, due this week, milestones in next fortnight', () => {
    const tasks = [
        { status: 'not-started', dueDate: '2026-05-24' }, // today
        { status: 'in-progress', dueDate: '2026-05-23' }, // overdue
        { status: 'in-progress', dueDate: '2026-05-22' }, // overdue
        { status: 'not-started', dueDate: '2026-05-26' }, // this week (later)
        { status: 'not-started', dueDate: '2026-05-30' }, // this week (later)
        { status: 'not-started', dueDate: '2026-06-02', isMilestone: true }, // milestone in fortnight
        { status: 'done', dueDate: '2026-05-24' }, // done — ignored
    ];
    const text = composeDashboardDigest(tasks, '2026-05-24');
    truthy(/1 task due today/.test(text), `due today phrase missing: ${text}`);
    truthy(/2 overdue/.test(text), `overdue phrase missing: ${text}`);
    truthy(/2 due later this week/.test(text), `due-later phrase missing: ${text}`);
    truthy(/1 milestone in the next fortnight/.test(text), `milestone phrase missing: ${text}`);
});

test('composeDashboardDigest pluralises correctly for single-count buckets', () => {
    const tasks = [
        { status: 'not-started', dueDate: '2026-05-24' },
        { status: 'not-started', dueDate: '2026-06-02', isMilestone: true },
    ];
    const text = composeDashboardDigest(tasks, '2026-05-24');
    truthy(/1 task due today/.test(text));
    truthy(/1 milestone in the next fortnight/.test(text));
});

// ── isProjectStale ──

test('isProjectStale flags projects whose last task update is older than the threshold', () => {
    const project = { id: 'p1', status: 'active', updatedAt: '2026-05-01T00:00:00.000Z' };
    const tasks = [{ projectId: 'p1', updatedAt: '2026-05-05T00:00:00.000Z' }];
    truthy(isProjectStale(project, tasks, '2026-05-24'));
});

test('isProjectStale returns false when recently touched within 14 days', () => {
    const project = { id: 'p1', status: 'active', updatedAt: '2026-05-01T00:00:00.000Z' };
    const tasks = [{ projectId: 'p1', updatedAt: '2026-05-20T00:00:00.000Z' }];
    falsy(isProjectStale(project, tasks, '2026-05-24'));
});

test('isProjectStale never flags completed / cancelled / archived projects', () => {
    const archived = { id: 'p1', status: 'active', archivedAt: '2026-05-01', updatedAt: '2026-01-01T00:00:00.000Z' };
    const completed = { id: 'p2', status: 'completed', updatedAt: '2026-01-01T00:00:00.000Z' };
    const cancelled = { id: 'p3', status: 'cancelled', updatedAt: '2026-01-01T00:00:00.000Z' };
    falsy(isProjectStale(archived, [], '2026-05-24'));
    falsy(isProjectStale(completed, [], '2026-05-24'));
    falsy(isProjectStale(cancelled, [], '2026-05-24'));
});

test('isProjectStale uses the most recent of project.updatedAt and any task.updatedAt', () => {
    // project.updatedAt is old but a task is recent → not stale
    const project = { id: 'p1', status: 'active', updatedAt: '2026-01-01T00:00:00.000Z' };
    const tasks = [{ projectId: 'p1', updatedAt: '2026-05-20T00:00:00.000Z' }];
    falsy(isProjectStale(project, tasks, '2026-05-24'));
});

test('isProjectStale supports a custom threshold', () => {
    const project = { id: 'p1', status: 'active', updatedAt: '2026-05-20T00:00:00.000Z' };
    falsy(isProjectStale(project, [], '2026-05-24', 7));
    truthy(isProjectStale(project, [], '2026-05-30', 7));
});

// ── smartSortTasks ──

test('smartSortTasks scores overdue tasks higher than due-soon tasks', () => {
    const today = '2026-05-24';
    const overdue = { id: 'a', status: 'not-started', dueDate: '2026-05-20', priority: 'low', dependsOn: [] };
    const dueSoon = { id: 'b', status: 'not-started', dueDate: '2026-05-26', priority: 'low', dependsOn: [] };
    const result = smartSortTasks([dueSoon, overdue], [dueSoon, overdue], today);
    eq(result.map(t => t.id), ['a', 'b']);
});

test('smartSortTasks ranks tasks blocking others above tasks not blocking', () => {
    const today = '2026-05-24';
    const blocker = { id: 'a', status: 'not-started', priority: 'normal', dueDate: null, dependsOn: [] };
    const isolated = { id: 'b', status: 'not-started', priority: 'normal', dueDate: null, dependsOn: [] };
    const consumer = { id: 'c', status: 'not-started', priority: 'low', dueDate: null, dependsOn: ['a'] };
    const result = smartSortTasks([isolated, blocker, consumer], [isolated, blocker, consumer], today);
    // 'a' has +2 for blocking 'c'; 'b' isolated has only the priority component;
    // 'c' has its own priority + nothing else. 'a' should outrank 'b'.
    eq(result[0].id, 'a');
});

test('smartSortTasks adds priority weight to the score', () => {
    const today = '2026-05-24';
    const lo = { id: 'a', status: 'not-started', priority: 'low', dueDate: null, dependsOn: [] };
    const hi = { id: 'b', status: 'not-started', priority: 'high', dueDate: null, dependsOn: [] };
    const result = smartSortTasks([lo, hi], [lo, hi], today);
    eq(result.map(t => t.id), ['b', 'a']);
});

test('smartSortTasks returns a new array and does not mutate the input', () => {
    const today = '2026-05-24';
    const a = { id: 'a', status: 'not-started', priority: 'low', dueDate: null, dependsOn: [] };
    const b = { id: 'b', status: 'not-started', priority: 'high', dueDate: null, dependsOn: [] };
    const input = [a, b];
    const result = smartSortTasks(input, input, today);
    truthy(result !== input);
    eq(input.map(t => t.id), ['a', 'b'], 'input order preserved');
});

test('smartSortTasks ignores "blocking" weight for tasks whose dependants are done', () => {
    const today = '2026-05-24';
    const blocker = { id: 'a', status: 'not-started', priority: 'low', dueDate: null, dependsOn: [] };
    const isolated = { id: 'b', status: 'not-started', priority: 'normal', dueDate: null, dependsOn: [] };
    const doneConsumer = { id: 'c', status: 'done', priority: 'low', dueDate: null, dependsOn: ['a'] };
    const result = smartSortTasks([blocker, isolated], [blocker, isolated, doneConsumer], today);
    // 'a' isn't actually blocking anything (its consumer is done), so 'b' (normal priority) wins.
    eq(result.map(t => t.id), ['b', 'a']);
});

// ── PM DLBooks → Projects migration (Task 8.1) ──

test('migratePMDLBooksToProjects returns empty result for null / empty input', () => {
    eq(migratePMDLBooksToProjects(null), { projects: [], tasks: [] });
    eq(migratePMDLBooksToProjects({}), { projects: [], tasks: [] });
    eq(migratePMDLBooksToProjects({ macro: [], customers: [] }), { projects: [], tasks: [] });
});

test('migratePMDLBooksToProjects builds a single "Macro Initiatives" project from macro items', () => {
    const result = migratePMDLBooksToProjects({
        macro: [
            { id: 'macro-1', name: 'Migrate to SharePoint', status: 'not-started', assignee: 'both', notes: '', createdAt: '2026-03-26' },
            { id: 'macro-2', name: 'Build CRM module',     status: 'in-progress', assignee: 'brad', notes: 'first cut', createdAt: '2026-04-10' },
        ],
        customers: [],
    });
    eq(result.projects.length, 1);
    eq(result.projects[0].name, 'Macro Initiatives');
    eq(result.tasks.length, 2);
    eq(result.tasks[0].projectId, result.projects[0].id);
    eq(result.tasks[0].name, 'Migrate to SharePoint');
    eq(result.tasks[0].assignees, ['brad', 'diana']);
    eq(result.tasks[1].assignees, ['brad']);
    eq(result.tasks[1].description, 'first cut');
});

test('migratePMDLBooksToProjects builds one project per customer named "DLBooks — <name>"', () => {
    const result = migratePMDLBooksToProjects({
        macro: [],
        customers: [
            { id: 'c1', name: 'Reed Cranes', tasks: [{ id: 't1', name: 'Xero vendor review', status: 'in-progress', assignee: 'brad', subtasks: [], createdAt: '2026-03-26' }] },
            { id: 'c2', name: 'A1 Showers', tasks: [] },
        ],
    });
    eq(result.projects.length, 2);
    eq(result.projects.map(p => p.name).sort(), ['DLBooks — A1 Showers', 'DLBooks — Reed Cranes']);
    // One task on Reed Cranes, none on A1 Showers
    eq(result.tasks.length, 1);
    eq(result.tasks[0].name, 'Xero vendor review');
});

test('migratePMDLBooksToProjects maps each pm subtask to a child task with parentTaskId', () => {
    const result = migratePMDLBooksToProjects({
        macro: [],
        customers: [{
            id: 'c1', name: 'Reed Cranes',
            tasks: [{
                id: 't1', name: 'Time sheet automation', status: 'not-started', assignee: 'brad', subtasks: [
                    { name: 'Spec the API', done: true },
                    { name: 'Wire up the form', done: false },
                ], createdAt: '2026-03-26',
            }],
        }],
    });
    const parent = result.tasks.find(t => t.name === 'Time sheet automation');
    const subs = result.tasks.filter(t => t.parentTaskId === parent.id);
    eq(subs.length, 2);
    eq(subs[0].name, 'Spec the API');
    eq(subs[0].status, 'done');
    truthy(subs[0].completedAt, 'completed sub should stamp completedAt');
    eq(subs[1].status, 'not-started');
    eq(subs[1].completedAt, null);
});

test('migratePMDLBooksToProjects preserves status values that exist in both schemas', () => {
    const statuses = ['not-started', 'in-progress', 'done', 'blocked'];
    const result = migratePMDLBooksToProjects({
        macro: statuses.map((s, i) => ({ id: `m${i}`, name: `T${i}`, status: s, assignee: 'brad', createdAt: '2026-03-26' })),
    });
    eq(result.tasks.map(t => t.status), statuses);
});

test('migratePMDLBooksToProjects falls back to "not-started" for unknown statuses', () => {
    const result = migratePMDLBooksToProjects({
        macro: [{ id: 'm1', name: 'Mystery', status: 'review', assignee: 'brad', createdAt: '2026-03-26' }],
    });
    eq(result.tasks[0].status, 'not-started');
});

test('migratePMDLBooksToProjects converts YYYY-MM-DD createdAt into an ISO timestamp', () => {
    const result = migratePMDLBooksToProjects({
        macro: [{ id: 'm1', name: 'T', status: 'not-started', assignee: 'brad', createdAt: '2026-03-26' }],
    });
    eq(result.tasks[0].createdAt, '2026-03-26T00:00:00.000Z');
});

test('migratePMDLBooksToProjects stamps completedAt on done tasks', () => {
    const result = migratePMDLBooksToProjects({
        macro: [{ id: 'm1', name: 'Closed', status: 'done', assignee: 'brad', createdAt: '2026-01-01' }],
    });
    truthy(result.tasks[0].completedAt, 'completedAt should be set when status=done');
});

test('migratePMDLBooksToProjects skips macro / customer / subtask entries with blank names', () => {
    const result = migratePMDLBooksToProjects({
        macro: [
            { id: 'm1', name: '', status: 'not-started', assignee: 'brad', createdAt: '2026-03-26' },
            { id: 'm2', name: '  ', status: 'not-started', assignee: 'brad', createdAt: '2026-03-26' },
            { id: 'm3', name: 'Real', status: 'not-started', assignee: 'brad', createdAt: '2026-03-26' },
        ],
        customers: [
            { id: 'c0', name: '', tasks: [] },
            { id: 'c1', name: 'Reed', tasks: [
                { id: 't0', name: '', status: 'not-started', assignee: 'brad', subtasks: [{ name: '', done: false }], createdAt: '2026-03-26' },
                { id: 't1', name: 'Real task', status: 'not-started', assignee: 'brad', subtasks: [{ name: 'Real sub', done: false }, { name: '', done: false }], createdAt: '2026-03-26' },
            ] },
        ],
    });
    eq(result.projects.length, 2); // Macro Initiatives + DLBooks — Reed
    eq(result.tasks.filter(t => !t.parentTaskId).map(t => t.name), ['Real', 'Real task']);
    eq(result.tasks.filter(t => t.parentTaskId).map(t => t.name), ['Real sub']);
});

test('migratePMDLBooksToProjects defaults projects to active + brad/diana participants', () => {
    const result = migratePMDLBooksToProjects({
        macro: [{ id: 'm1', name: 'T', status: 'not-started', assignee: 'brad', createdAt: '2026-03-26' }],
    });
    const proj = result.projects[0];
    eq(proj.status, 'active');
    eq(proj.statusOverride, false);
    eq(proj.participants, ['brad', 'diana']);
});

// ── runner ──

export async function runProjectsDataTests() {
    const results = [];
    let pass = 0, fail = 0;
    for (const t of tests) {
        try {
            await t.fn();
            results.push({ name: t.name, ok: true });
            pass++;
        } catch (e) {
            results.push({ name: t.name, ok: false, error: e.message });
            fail++;
        }
    }
    return { pass, fail, results };
}
