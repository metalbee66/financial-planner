/**
 * PM DLBooks — project management for DLBooks bookkeeping & business solutions.
 */

const PM_STATUSES = [
    { value: 'not-started', label: 'Not Started' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'done',        label: 'Done' },
    { value: 'blocked',     label: 'Blocked' }
];

const PM_ASSIGNEES = [
    { value: 'brad',  label: 'Brad' },
    { value: 'diana', label: 'Diana' },
    { value: 'both',  label: 'Both' }
];

const DEFAULT_PM = {
    macro: [
        { id: 'macro-1', name: 'Migrate from GoogleSheets to SharePoint', status: 'not-started', assignee: 'both', notes: '', createdAt: '2026-03-26' },
        { id: 'macro-2', name: 'Build CRM module',                       status: 'not-started', assignee: 'both', notes: '', createdAt: '2026-03-26' }
    ],
    customers: [
        {
            id: 'cust-1', name: 'Reed Cranes',
            tasks: [
                { id: 'task-1', name: 'Time sheet automation',           status: 'not-started', assignee: 'brad', notes: '', subtasks: [], createdAt: '2026-03-26' },
                { id: 'task-2', name: 'Xero vendor review',             status: 'not-started', assignee: 'brad', notes: '', subtasks: [], createdAt: '2026-03-26' },
                { id: 'task-3', name: 'Deload ERP from DL machine and establish Remote Desktop through Reed-owned machine', status: 'not-started', assignee: 'brad', notes: '', subtasks: [], createdAt: '2026-03-26' }
            ]
        },
        { id: 'cust-2', name: 'A1 Showers', tasks: [] }
    ]
};

function generatePMId(prefix) { return prefix + '-' + Date.now(); }

function loadPM() {
    const raw = localStorage.getItem('pm_dlbooks');
    if (raw) {
        try {
            const data = JSON.parse(raw);
            if (data && (data.macro || data.customers)) return data;
        } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(DEFAULT_PM));
}

let savePM = function(data) {
    localStorage.setItem('pm_dlbooks', JSON.stringify(data));
    showToast('Saved');
};

// ── Rendering ──

function statusLabel(val) { return (PM_STATUSES.find(s => s.value === val) || PM_STATUSES[0]).label; }
function assigneeLabel(val) { return (PM_ASSIGNEES.find(a => a.value === val) || PM_ASSIGNEES[2]).label; }

function renderTaskRow(task, section, custId) {
    const dataAttrs = `data-section="${section}" data-id="${task.id}"` + (custId ? ` data-cust="${custId}"` : '');
    return `
        <div class="pm-task-row" ${dataAttrs}>
            <span class="expand-toggle pm-expand" ${dataAttrs}>&#9654;</span>
            <span class="pm-task-name" ${dataAttrs}>${esc(task.name)}</span>
            <span class="pm-badge pm-status-${task.status}">${statusLabel(task.status)}</span>
            <span class="pm-badge pm-assignee-${task.assignee}">${assigneeLabel(task.assignee)}</span>
            <button class="pm-task-delete" ${dataAttrs} title="Delete task">&times;</button>
        </div>
        <div class="pm-task-detail" ${dataAttrs} id="pm-detail-${task.id}">
            <div class="pm-detail-grid">
                <span class="pm-detail-label">Name</span>
                <input class="pm-task-name-input" ${dataAttrs} value="${esc(task.name)}">
                <span class="pm-detail-label">Status</span>
                <select class="pm-select pm-status-select" ${dataAttrs}>
                    ${PM_STATUSES.map(s => `<option value="${s.value}"${s.value === task.status ? ' selected' : ''}>${s.label}</option>`).join('')}
                </select>
                <span class="pm-detail-label">Assignee</span>
                <select class="pm-select pm-assignee-select" ${dataAttrs}>
                    ${PM_ASSIGNEES.map(a => `<option value="${a.value}"${a.value === task.assignee ? ' selected' : ''}>${a.label}</option>`).join('')}
                </select>
                <textarea class="pm-notes" ${dataAttrs} placeholder="Notes...">${esc(task.notes || '')}</textarea>
            </div>
            <div class="pm-subtasks">
                <span class="pm-detail-label" style="margin-bottom:4px;display:block;">Sub-tasks</span>
                ${(task.subtasks || []).map((st, i) => `
                    <div class="pm-subtask-row">
                        <input type="checkbox" class="pm-subtask-check" ${dataAttrs} data-si="${i}" ${st.done ? 'checked' : ''}>
                        <span class="pm-subtask-name${st.done ? ' pm-done' : ''}">${esc(st.name)}</span>
                        <button class="pm-subtask-delete" ${dataAttrs} data-si="${i}" title="Remove">&times;</button>
                    </div>
                `).join('')}
                <button class="pm-add-btn pm-add-subtask" ${dataAttrs} style="font-size:0.78rem;padding:4px 10px;">+ Sub-task</button>
            </div>
        </div>`;
}

function summaryBar(tasks) {
    const total = tasks.length;
    const counts = {};
    PM_STATUSES.forEach(s => counts[s.value] = 0);
    tasks.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
    const parts = PM_STATUSES.map(s => {
        if (counts[s.value] === 0) return '';
        return `<span class="pm-badge pm-status-${s.value}">${counts[s.value]} ${s.label}</span>`;
    }).filter(Boolean).join(' ');
    return `<div class="pm-summary-bar">${total} task${total !== 1 ? 's' : ''} &nbsp; ${parts}</div>`;
}

function renderPMTab(data) {
    const el = document.getElementById('pm-content');
    if (!el) return;

    // Macro section
    let html = `<div class="section-card">
        <div class="section-header pm-macro-header">
            <span>Macro Initiatives</span>
        </div>
        <div class="pm-task-list">
            ${(data.macro || []).map(t => renderTaskRow(t, 'macro', null)).join('')}
        </div>
        <button class="pm-add-btn" data-action="add-macro">+ Add Initiative</button>
        ${summaryBar(data.macro || [])}
    </div>`;

    // Customer section
    const allCustTasks = (data.customers || []).flatMap(c => c.tasks || []);
    html += `<div class="section-card">
        <div class="section-header pm-micro-header">
            <span>Customer Tasks</span>
        </div>`;

    (data.customers || []).forEach(cust => {
        html += `<div class="pm-customer-card" data-cust="${cust.id}">
            <div class="pm-customer-name">
                <span>${esc(cust.name)}</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <button class="pm-add-btn" style="width:auto;border:none;padding:2px 8px;" data-action="add-task" data-cust="${cust.id}" title="Add task">+ Task</button>
                    <button class="pm-task-delete" data-action="delete-customer" data-cust="${cust.id}" title="Delete customer">&times;</button>
                </div>
            </div>
            <div class="pm-task-list">
                ${(cust.tasks || []).map(t => renderTaskRow(t, 'micro', cust.id)).join('')}
            </div>
        </div>`;
    });

    html += `<button class="pm-add-btn" data-action="add-customer">+ Add Customer</button>
        ${summaryBar(allCustTasks)}
    </div>`;

    el.innerHTML = html;
}

// ── Helpers ──

function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function findMacroTask(data, id) { return (data.macro || []).find(t => t.id === id); }

function findCustomerTask(data, custId, taskId) {
    const cust = (data.customers || []).find(c => c.id === custId);
    if (!cust) return null;
    return (cust.tasks || []).find(t => t.id === taskId);
}

function findTask(data, section, id, custId) {
    return section === 'macro' ? findMacroTask(data, id) : findCustomerTask(data, custId, id);
}

function reopenDetail(taskId) {
    const detail = document.getElementById('pm-detail-' + taskId);
    if (detail) {
        detail.classList.add('open');
        const toggle = document.querySelector(`.pm-expand[data-id="${taskId}"]`);
        if (toggle) toggle.innerHTML = '&#9660;';
    }
}

// ── Event handling ──

function setupPMEditing() {
    const container = document.getElementById('pm-dlbooks');
    if (!container) return;

    container.addEventListener('click', (e) => {
        const target = e.target;

        // Expand / collapse
        if (target.classList.contains('pm-expand')) {
            const id = target.dataset.id;
            const detail = document.getElementById('pm-detail-' + id);
            if (detail) {
                detail.classList.toggle('open');
                target.innerHTML = detail.classList.contains('open') ? '&#9660;' : '&#9654;';
            }
            return;
        }

        // Delete task
        if (target.classList.contains('pm-task-delete') && !target.dataset.action) {
            const { section, id } = target.dataset;
            const custId = target.dataset.cust;
            if (!confirm('Delete this task?')) return;
            if (section === 'macro') {
                pmData.macro = pmData.macro.filter(t => t.id !== id);
            } else {
                const cust = pmData.customers.find(c => c.id === custId);
                if (cust) cust.tasks = cust.tasks.filter(t => t.id !== id);
            }
            savePM(pmData);
            renderPMTab(pmData);
            return;
        }

        // Add macro
        if (target.dataset.action === 'add-macro') {
            const name = prompt('Initiative name:');
            if (!name || !name.trim()) return;
            pmData.macro.push({
                id: generatePMId('macro'), name: name.trim(),
                status: 'not-started', assignee: 'both', notes: '', subtasks: [],
                createdAt: new Date().toISOString().slice(0, 10)
            });
            savePM(pmData);
            renderPMTab(pmData);
            return;
        }

        // Add customer
        if (target.dataset.action === 'add-customer') {
            const name = prompt('Customer name:');
            if (!name || !name.trim()) return;
            pmData.customers.push({ id: generatePMId('cust'), name: name.trim(), tasks: [] });
            savePM(pmData);
            renderPMTab(pmData);
            return;
        }

        // Add task to customer
        if (target.dataset.action === 'add-task') {
            const custId = target.dataset.cust;
            const name = prompt('Task name:');
            if (!name || !name.trim()) return;
            const cust = pmData.customers.find(c => c.id === custId);
            if (cust) {
                cust.tasks.push({
                    id: generatePMId('task'), name: name.trim(),
                    status: 'not-started', assignee: 'both', notes: '', subtasks: [],
                    createdAt: new Date().toISOString().slice(0, 10)
                });
                savePM(pmData);
                renderPMTab(pmData);
            }
            return;
        }

        // Add subtask
        if (target.classList.contains('pm-add-subtask')) {
            const { section, id } = target.dataset;
            const custId = target.dataset.cust;
            const name = prompt('Sub-task:');
            if (!name || !name.trim()) return;
            const task = findTask(pmData, section, id, custId);
            if (task) {
                if (!task.subtasks) task.subtasks = [];
                task.subtasks.push({ name: name.trim(), done: false });
                savePM(pmData);
                renderPMTab(pmData);
                reopenDetail(id);
            }
            return;
        }

        // Toggle subtask done
        if (target.classList.contains('pm-subtask-check')) {
            const { section, id } = target.dataset;
            const custId = target.dataset.cust;
            const si = parseInt(target.dataset.si);
            const task = findTask(pmData, section, id, custId);
            if (task && task.subtasks && task.subtasks[si] !== undefined) {
                task.subtasks[si].done = target.checked;
                savePM(pmData);
                renderPMTab(pmData);
                reopenDetail(id);
            }
            return;
        }

        // Delete subtask
        if (target.classList.contains('pm-subtask-delete')) {
            const { section, id } = target.dataset;
            const custId = target.dataset.cust;
            const si = parseInt(target.dataset.si);
            const task = findTask(pmData, section, id, custId);
            if (task && task.subtasks) {
                task.subtasks.splice(si, 1);
                savePM(pmData);
                renderPMTab(pmData);
                reopenDetail(id);
            }
            return;
        }

        // Delete customer
        if (target.dataset.action === 'delete-customer') {
            const custId = target.dataset.cust;
            const cust = pmData.customers.find(c => c.id === custId);
            const taskCount = cust ? cust.tasks.length : 0;
            const msg = taskCount > 0
                ? `Delete "${cust.name}" and its ${taskCount} task(s)?`
                : `Delete "${cust.name}"?`;
            if (!confirm(msg)) return;
            pmData.customers = pmData.customers.filter(c => c.id !== custId);
            savePM(pmData);
            renderPMTab(pmData);
            return;
        }
    });

    // Status / assignee changes
    container.addEventListener('change', (e) => {
        const target = e.target;
        const { section, id } = target.dataset;
        const custId = target.dataset.cust;

        if (target.classList.contains('pm-status-select')) {
            const task = findTask(pmData, section, id, custId);
            if (task) { task.status = target.value; savePM(pmData); renderPMTab(pmData); }
            return;
        }

        if (target.classList.contains('pm-assignee-select')) {
            const task = findTask(pmData, section, id, custId);
            if (task) { task.assignee = target.value; savePM(pmData); renderPMTab(pmData); }
            return;
        }
    });

    // Notes and name blur
    container.addEventListener('focusout', (e) => {
        const target = e.target;
        const { section, id } = target.dataset;
        const custId = target.dataset.cust;

        if (target.classList.contains('pm-notes')) {
            const task = findTask(pmData, section, id, custId);
            if (task && task.notes !== target.value) {
                task.notes = target.value;
                savePM(pmData);
            }
            return;
        }

        if (target.classList.contains('pm-task-name-input')) {
            const task = findTask(pmData, section, id, custId);
            const val = target.value.trim();
            if (task && val && task.name !== val) {
                task.name = val;
                savePM(pmData);
                renderPMTab(pmData);
            }
            return;
        }
    });
}
