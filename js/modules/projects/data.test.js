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
    createTask,
    sanitiseTask,
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
} from './data.js';

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
