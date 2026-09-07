/**
 * Tests for the Details module data layer (js/modules/details/data.js).
 *
 * Pure functions only — DOM/Firebase paths are covered by the Playwright
 * smoke suite. Run via /tests.html in the dev server.
 */

import {
    DEFAULT_DETAILS,
    sanitiseDetails,
    addSection, removeSection, findSection,
    addField, removeField,
    setValue, getValue,
} from './data.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg || 'eq'}: expected ${e}, got ${a}`);
}
function truthy(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function falsy(v, msg) { if (v) throw new Error(msg || 'expected falsy, got ' + JSON.stringify(v)); }

function fresh() { return JSON.parse(JSON.stringify(DEFAULT_DETAILS)); }

// ── DEFAULT_DETAILS shape ──

test('default has the four people in order', () => {
    eq(DEFAULT_DETAILS.people.map(p => p.name), ['Brad', 'Diana', 'Phoebe', 'Lorelei']);
});

test('default has Sizing / Health / Identity sections with the requested fields', () => {
    eq(DEFAULT_DETAILS.sections.map(s => s.title), ['Sizing', 'Health', 'Identity']);
    eq(DEFAULT_DETAILS.sections[0].fields.map(f => f.label), ['Shoe', 'Tops', 'Bottoms', 'Bra']);
    eq(DEFAULT_DETAILS.sections[1].fields.map(f => f.label), ['Doctor', 'Blood type', 'Allergies']);
    eq(DEFAULT_DETAILS.sections[2].fields.map(f => f.label), ['D.O.B', 'Medicare', 'Passport', 'Private health']);
});

test('default ids are unique across sections and within each section', () => {
    const sIds = DEFAULT_DETAILS.sections.map(s => s.id);
    eq(new Set(sIds).size, sIds.length, 'section ids');
    for (const s of DEFAULT_DETAILS.sections) {
        const fIds = s.fields.map(f => f.id);
        eq(new Set(fIds).size, fIds.length, 'field ids in ' + s.id);
    }
});

// ── sanitiseDetails ──

test('sanitiseDetails(null / undefined / array / string) returns a default copy', () => {
    for (const bad of [null, undefined, [], 'x', 42]) {
        const out = sanitiseDetails(bad);
        eq(out, DEFAULT_DETAILS, 'bad input ' + JSON.stringify(bad));
        truthy(out !== DEFAULT_DETAILS, 'must be a copy, not the shared default');
    }
});

test('sanitiseDetails returns default when people is missing/empty', () => {
    eq(sanitiseDetails({ sections: [] }), DEFAULT_DETAILS);
    eq(sanitiseDetails({ people: [], sections: [] }), DEFAULT_DETAILS);
});

test('sanitiseDetails backfills fields + values dropped by Firebase (empty containers)', () => {
    // Firebase drops `values: {}` and `fields: []` entirely.
    const raw = {
        people: [{ id: 'brad', name: 'Brad' }],
        sections: [{ id: 'sizing', title: 'Sizing', fields: [{ id: 'shoe', label: 'Shoe' }] }, { id: 'empty', title: 'Empty' }],
    };
    const out = sanitiseDetails(raw);
    eq(out.sections[0].values, { shoe: {} });
    eq(out.sections[1].fields, []);
    eq(out.sections[1].values, {});
});

test('sanitiseDetails keeps user values and drops unknown people / non-string cells', () => {
    const raw = {
        people: [{ id: 'brad', name: 'Brad' }, { id: 'diana', name: 'Diana' }],
        sections: [{
            id: 'sizing', title: 'Sizing',
            fields: [{ id: 'shoe', label: 'Shoe' }],
            values: { shoe: { brad: '10', ghost: '9', diana: 42 }, orphan: { brad: 'x' } },
        }],
    };
    const out = sanitiseDetails(raw);
    eq(out.sections[0].values, { shoe: { brad: '10' } });
});

test('sanitiseDetails drops malformed sections and fields', () => {
    const raw = {
        people: [{ id: 'brad', name: 'Brad' }],
        sections: [null, { title: 'no id' }, { id: 'ok', title: 'Ok', fields: [null, { label: 'no id' }, { id: 'f1', label: 'F1' }] }],
    };
    const out = sanitiseDetails(raw);
    eq(out.sections.length, 1);
    eq(out.sections[0].fields, [{ id: 'f1', label: 'F1' }]);
});

test('sanitiseDetails is idempotent on its own output', () => {
    const d = fresh();
    setValue(d, 'sizing', 'shoe', 'brad', '10');
    eq(sanitiseDetails(sanitiseDetails(d)), sanitiseDetails(d));
});

// ── mutators ──

test('addSection appends an empty section with a unique id and returns it', () => {
    const d = fresh();
    const s = addSection(d, 'Cars');
    eq(d.sections.length, 4);
    eq(s.title, 'Cars');
    eq(s.fields, []);
    eq(s.values, {});
    truthy(findSection(d, s.id) === s);
    const s2 = addSection(d, 'More');
    truthy(s.id !== s2.id, 'ids must differ');
});

test('removeSection deletes by id; unknown id is a no-op returning false', () => {
    const d = fresh();
    truthy(removeSection(d, 'health'));
    eq(d.sections.map(s => s.id), ['sizing', 'identity']);
    falsy(removeSection(d, 'nope'));
    eq(d.sections.length, 2);
});

test('addField appends to the section and seeds an empty values row', () => {
    const d = fresh();
    const f = addField(d, 'sizing', 'Hat');
    eq(findSection(d, 'sizing').fields.map(x => x.label), ['Shoe', 'Tops', 'Bottoms', 'Bra', 'Hat']);
    eq(findSection(d, 'sizing').values[f.id], {});
    eq(addField(d, 'nope', 'X'), null);
});

test('removeField deletes the field and its values', () => {
    const d = fresh();
    setValue(d, 'sizing', 'shoe', 'brad', '10');
    truthy(removeField(d, 'sizing', 'shoe'));
    eq(findSection(d, 'sizing').fields.map(x => x.id), ['tops', 'bottoms', 'bra']);
    falsy('shoe' in findSection(d, 'sizing').values);
    falsy(removeField(d, 'sizing', 'shoe'));
    falsy(removeField(d, 'nope', 'shoe'));
});

test('setValue / getValue round-trip, trims, and clears on empty', () => {
    const d = fresh();
    truthy(setValue(d, 'sizing', 'shoe', 'phoebe', '  3.5 '));
    eq(getValue(d, 'sizing', 'shoe', 'phoebe'), '3.5');
    eq(getValue(d, 'sizing', 'shoe', 'brad'), '');
    truthy(setValue(d, 'sizing', 'shoe', 'phoebe', ''));
    eq(findSection(d, 'sizing').values.shoe, {});
});

test('setValue ignores unknown section / field / person', () => {
    const d = fresh();
    falsy(setValue(d, 'nope', 'shoe', 'brad', '1'));
    falsy(setValue(d, 'sizing', 'nope', 'brad', '1'));
    falsy(setValue(d, 'sizing', 'shoe', 'nope', '1'));
    eq(findSection(d, 'sizing').values, {});
});

test('setValue on a section whose values row was dropped (Firebase) recreates it', () => {
    const d = fresh();
    delete findSection(d, 'sizing').values.shoe;
    truthy(setValue(d, 'sizing', 'shoe', 'brad', '11'));
    eq(getValue(d, 'sizing', 'shoe', 'brad'), '11');
});

// ── runner ──

export function runDetailsDataTests() {
    const results = [];
    let pass = 0, fail = 0;
    for (const t of tests) {
        try {
            t.fn();
            results.push({ name: t.name, ok: true });
            pass++;
        } catch (e) {
            results.push({ name: t.name, ok: false, error: e.message });
            fail++;
        }
    }
    return { pass, fail, results };
}
