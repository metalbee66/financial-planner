/**
 * Details module — data layer.
 *
 * A per-person reference sheet: each section is a grid of fields (rows) ×
 * people (columns) holding free-text values. Stored under the Firebase key
 * `details` (mirrored to localStorage) as:
 *
 *   {
 *     people:   [ { id, name }, ... ],
 *     sections: [ { id, title, fields: [ { id, label } ], values: { [fieldId]: { [personId]: string } } } ]
 *   }
 *
 * Firebase drops empty objects/arrays, so `sanitiseDetails` must rebuild any
 * missing `fields` / `values` containers on load.
 */

import { showToast } from '../../data.js';
import { fbSave } from '../../firebase-sync.js';

export const DETAILS_KEY = 'details';

export const DEFAULT_DETAILS = {
    people: [
        { id: 'brad', name: 'Brad' },
        { id: 'diana', name: 'Diana' },
        { id: 'phoebe', name: 'Phoebe' },
        { id: 'lorelei', name: 'Lorelei' },
    ],
    sections: [
        {
            id: 'sizing', title: 'Sizing',
            fields: [
                { id: 'shoe', label: 'Shoe' },
                { id: 'tops', label: 'Tops' },
                { id: 'bottoms', label: 'Bottoms' },
                { id: 'bra', label: 'Bra' },
            ],
            values: {},
        },
        {
            id: 'health', title: 'Health',
            fields: [
                { id: 'doctor', label: 'Doctor' },
                { id: 'blood-type', label: 'Blood type' },
                { id: 'allergies', label: 'Allergies' },
            ],
            values: {},
        },
        {
            id: 'identity', title: 'Identity',
            fields: [
                { id: 'dob', label: 'D.O.B' },
                { id: 'medicare', label: 'Medicare' },
                { id: 'passport', label: 'Passport' },
                { id: 'private-health', label: 'Private health' },
            ],
            values: {},
        },
    ],
};

function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function sanitiseSection(raw, people) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
    const fields = Array.isArray(raw.fields)
        ? raw.fields.filter(f => f && typeof f === 'object' && typeof f.id === 'string' && f.id)
            .map(f => ({ id: f.id, label: typeof f.label === 'string' ? f.label : '' }))
        : [];
    const rawValues = (raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values)) ? raw.values : {};
    const values = {};
    for (const f of fields) {
        const row = (rawValues[f.id] && typeof rawValues[f.id] === 'object') ? rawValues[f.id] : {};
        values[f.id] = {};
        for (const p of people) {
            const v = row[p.id];
            if (typeof v === 'string' && v !== '') values[f.id][p.id] = v;
        }
    }
    return { id: raw.id, title: typeof raw.title === 'string' ? raw.title : '', fields, values };
}

/**
 * Normalise a `details` snapshot from Firebase / localStorage into the full
 * shape above. Missing/invalid input → a deep copy of DEFAULT_DETAILS. A
 * partial tree (e.g. `values` dropped by Firebase because every cell was
 * empty) is backfilled without losing the sections/fields it does carry.
 */
export function sanitiseDetails(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return JSON.parse(JSON.stringify(DEFAULT_DETAILS));
    }
    const people = Array.isArray(raw.people)
        ? raw.people.filter(p => p && typeof p === 'object' && typeof p.id === 'string' && p.id)
            .map(p => ({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id }))
        : [];
    const sections = Array.isArray(raw.sections)
        ? raw.sections.map(s => sanitiseSection(s, people)).filter(Boolean)
        : [];
    if (people.length === 0) {
        // No people means nothing renders — treat as an empty/unknown tree.
        return JSON.parse(JSON.stringify(DEFAULT_DETAILS));
    }
    return { people, sections };
}

export function loadDetails() {
    try {
        const saved = localStorage.getItem(DETAILS_KEY);
        if (saved) return sanitiseDetails(JSON.parse(saved));
    } catch (e) {
        console.error('details parse error:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DETAILS));
}

export function saveDetails(data) {
    fbSave(DETAILS_KEY, data);
    showToast('Saved');
}

// ── Pure mutators (operate in place on a details object, return the touched entity) ──

export function addSection(data, title) {
    const section = { id: newId('s'), title: title || '', fields: [], values: {} };
    data.sections.push(section);
    return section;
}

export function removeSection(data, sectionId) {
    const idx = data.sections.findIndex(s => s.id === sectionId);
    if (idx === -1) return false;
    data.sections.splice(idx, 1);
    return true;
}

export function findSection(data, sectionId) {
    return data.sections.find(s => s.id === sectionId) || null;
}

export function addField(data, sectionId, label) {
    const section = findSection(data, sectionId);
    if (!section) return null;
    const field = { id: newId('f'), label: label || '' };
    section.fields.push(field);
    section.values[field.id] = {};
    return field;
}

export function removeField(data, sectionId, fieldId) {
    const section = findSection(data, sectionId);
    if (!section) return false;
    const idx = section.fields.findIndex(f => f.id === fieldId);
    if (idx === -1) return false;
    section.fields.splice(idx, 1);
    delete section.values[fieldId];
    return true;
}

/** Set one cell. Unknown section/field/person is ignored. Empty string clears the cell. */
export function setValue(data, sectionId, fieldId, personId, value) {
    const section = findSection(data, sectionId);
    if (!section) return false;
    if (!section.fields.some(f => f.id === fieldId)) return false;
    if (!data.people.some(p => p.id === personId)) return false;
    if (!section.values[fieldId]) section.values[fieldId] = {};
    const v = String(value == null ? '' : value).trim();
    if (v === '') delete section.values[fieldId][personId];
    else section.values[fieldId][personId] = v;
    return true;
}

export function getValue(data, sectionId, fieldId, personId) {
    const section = findSection(data, sectionId);
    if (!section) return '';
    const row = section.values[fieldId];
    return (row && typeof row[personId] === 'string') ? row[personId] : '';
}
