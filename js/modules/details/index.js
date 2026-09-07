/**
 * Details module — per-person reference sheet (sizes, health, identity…).
 *
 * One page of section cards. Each card is a grid: fields down the side,
 * people across the top, free-text cells. Titles and field labels are
 * inline-editable; blur saves. Sections and fields can be added/removed.
 *
 * Mount lifecycle mirrors the Finance module: `mount(host)` is called once
 * by the shell; the shell then toggles visibility. `renderDetailsTab()` is
 * also registered as a render hook so remote (Firebase) changes re-draw.
 *
 * Cell/label/title edits do NOT re-render (that would steal focus while
 * tabbing between cells) — only structural changes and remote updates do.
 */

import { state } from '../../state.js';
import {
    saveDetails, addSection, removeSection, findSection,
    addField, removeField, setValue, getValue,
} from './data.js';

const TEMPLATE = `
<div class="budget-container">
    <div id="details-content"></div>
    <div class="add-item-bar details-add-section-bar">
        <button class="add-item-btn" id="details-add-section">+ Add section</button>
    </div>
</div>
`;

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderDetailsTab() {
    const container = document.getElementById('details-content');
    if (!container || !state.detailsData) return;
    const data = state.detailsData;

    let html = '';
    for (const section of data.sections) {
        html += `
            <div class="section-card details-section" data-section="${esc(section.id)}">
                <div class="section-header accounts-header details-header">
                    <input class="editable details-title" type="text" placeholder="Section name"
                        data-section="${esc(section.id)}" value="${esc(section.title)}">
                    <button class="details-del" type="button" title="Delete section"
                        data-del-section="${esc(section.id)}">&#x2715;</button>
                </div>
                <table class="budget-table details-table">
                    <thead><tr>
                        <th>Field</th>
                        ${data.people.map(p => `<th>${esc(p.name)}</th>`).join('')}
                        <th class="details-del-col"></th>
                    </tr></thead>
                    <tbody>`;
        for (const field of section.fields) {
            html += `
                        <tr data-field="${esc(field.id)}">
                            <td><input class="editable details-label" type="text" placeholder="Field name"
                                data-section="${esc(section.id)}" data-field="${esc(field.id)}" value="${esc(field.label)}"></td>
                            ${data.people.map(p => `
                            <td><input class="editable details-cell" type="text"
                                data-section="${esc(section.id)}" data-field="${esc(field.id)}" data-person="${esc(p.id)}"
                                value="${esc(getValue(data, section.id, field.id, p.id))}"></td>`).join('')}
                            <td class="details-del-col"><button class="details-del" type="button" title="Delete field"
                                data-section="${esc(section.id)}" data-del-field="${esc(field.id)}">&#x2715;</button></td>
                        </tr>`;
        }
        if (section.fields.length === 0) {
            html += `
                        <tr class="details-empty"><td colspan="${data.people.length + 2}">No fields yet — add one below.</td></tr>`;
        }
        html += `
                    </tbody>
                </table>
                <div class="add-item-bar">
                    <button class="add-item-btn" type="button" data-add-field="${esc(section.id)}">+ Add field</button>
                </div>
            </div>`;
    }
    container.innerHTML = html;
}

let mounted = false;

export function mount(host) {
    if (mounted) return;
    host.innerHTML = TEMPLATE;
    mounted = true;

    // Blur (capture) — commit cell / label / title edits without re-rendering.
    host.addEventListener('blur', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement)) return;
        const data = state.detailsData;
        if (!data) return;

        if (el.classList.contains('details-cell')) {
            if (setValue(data, el.dataset.section, el.dataset.field, el.dataset.person, el.value)) {
                el.value = getValue(data, el.dataset.section, el.dataset.field, el.dataset.person);
                saveDetails(data);
            }
        } else if (el.classList.contains('details-label')) {
            const section = findSection(data, el.dataset.section);
            const field = section && section.fields.find(f => f.id === el.dataset.field);
            if (field && field.label !== el.value.trim()) {
                field.label = el.value.trim();
                el.value = field.label;
                saveDetails(data);
            }
        } else if (el.classList.contains('details-title')) {
            const section = findSection(data, el.dataset.section);
            if (section && section.title !== el.value.trim()) {
                section.title = el.value.trim();
                el.value = section.title;
                saveDetails(data);
            }
        }
    }, true);

    // Enter commits the current input (blur does the work).
    host.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.classList.contains('editable')) {
            e.target.blur();
        }
    });

    // Click — structural changes re-render.
    host.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const data = state.detailsData;
        if (!data) return;

        if (btn.id === 'details-add-section') {
            const section = addSection(data, '');
            saveDetails(data);
            renderDetailsTab();
            const input = host.querySelector(`.details-title[data-section="${section.id}"]`);
            if (input) input.focus();
            return;
        }

        if (btn.dataset.addField) {
            const field = addField(data, btn.dataset.addField, '');
            if (!field) return;
            saveDetails(data);
            renderDetailsTab();
            const input = host.querySelector(`.details-label[data-field="${field.id}"]`);
            if (input) input.focus();
            return;
        }

        if (btn.dataset.delSection) {
            const section = findSection(data, btn.dataset.delSection);
            if (!section) return;
            const name = section.title || 'this section';
            if (!confirm(`Delete "${name}" and everything in it?`)) return;
            removeSection(data, section.id);
            saveDetails(data);
            renderDetailsTab();
            return;
        }

        if (btn.dataset.delField) {
            const section = findSection(data, btn.dataset.section);
            const field = section && section.fields.find(f => f.id === btn.dataset.delField);
            if (!field) return;
            const name = field.label || 'this field';
            if (!confirm(`Delete "${name}" for everyone?`)) return;
            removeField(data, section.id, field.id);
            saveDetails(data);
            renderDetailsTab();
        }
    });

    renderDetailsTab();
}
