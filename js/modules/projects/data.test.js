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
    DEFAULT_PARTICIPANTS,
    createProject,
    validateProject,
    addProjectToList,
    updateProjectInList,
    deleteProjectFromList,
    findProject,
    sanitiseProject,
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
