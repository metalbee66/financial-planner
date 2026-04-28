/**
 * App controller — tabs, editing, planner interaction, Firebase bootstrap.
 */

import {
    loadBudgetCY, loadBudgetNY, loadWeekActuals,
    saveBudgetCY, saveBudgetNY, saveWeekActuals,
    parseCurrency, fmtPlain, monthlyToWeekly, quarterlyToWeekly, annualToWeekly,
    migrateItem, getCurrentWeekly, showToast,
} from './data.js';
import {
    initFirebase, getFirebaseAuth, setCurrentUser, signInWithGoogle, signOut,
    showLoginScreen, showApp, initialSync, setupRealtimeListeners,
    registerRenderHooks,
} from './firebase-sync.js';
import { ALLOWED_EMAILS } from './firebase-config.js';
import { state } from './state.js';
import { renderBudgetTab } from './budget.js';
import { initPlanner, buildWeekStrip, renderWeek, allSchedules } from './planner.js';
import { renderAccountsTab, loadAccounts, saveAccounts } from './accounts.js';
import {
    loadGlMappings, saveGlMappings, loadStoredHashes,
    parseNabCsv, autoSuggest, getAllLineNames,
    renderImportTab, renderMappings, applyToPlanner,
} from './import.js';
import { renderPMTab, loadPM, setupPMEditing } from './pm.js';

// Wire render hooks into firebase-sync so its real-time listeners can re-render
registerRenderHooks({ renderBudgetTab, renderAccountsTab, renderPMTab });

document.addEventListener('DOMContentLoaded', async () => {
    // Load from localStorage first (instant render)
    state.budgetCY = loadBudgetCY();
    state.budgetNY = loadBudgetNY();
    state.weekActuals = loadWeekActuals();
    state.accountsData = loadAccounts();
    state.pmData = loadPM();

    // Try Firebase
    const fbReady = await initFirebase();

    if (fbReady) {
        const firebaseAuth = getFirebaseAuth();
        // Set up auth listener
        firebaseAuth.onAuthStateChanged(async (user) => {
            if (user) {
                // Check allowed emails
                if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(user.email)) {
                    await firebaseAuth.signOut();
                    showLoginScreen();
                    return;
                }
                setCurrentUser(user);
                document.getElementById('sign-out-btn').style.display = '';
                showApp();

                // Sync data from Firebase
                await initialSync();
                renderAll();
                setupRealtimeListeners();
            } else {
                showLoginScreen();
            }
        });

        document.getElementById('google-sign-in').onclick = signInWithGoogle;
        document.getElementById('sign-out-btn').onclick = signOut;
    } else {
        // No Firebase — run locally
        showApp();
        renderAll();
    }

    // Load GL mappings and stored transaction hashes
    state.glMappings = loadGlMappings();
    state.storedTransactionHashes = loadStoredHashes();

    setupTabs();
    setupBudgetEditing('budget-cy', 'cy-', state.budgetCY, saveBudgetCY);
    setupBudgetEditing('budget-ny', 'ny-', state.budgetNY, saveBudgetNY);
    setupPlannerEditing();
    setupAccountsEditing();
    setupImport();
    setupPMEditing();
});

function renderAll() {
    renderBudgetTab(state.budgetCY, 'cy-');
    renderBudgetTab(state.budgetNY, 'ny-');
    initPlanner(state.budgetCY, state.weekActuals);
    renderAccountsTab(state.accountsData);
    renderPMTab(state.pmData);
}

// ── Tab switching ──
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');

            if (btn.dataset.tab === 'planner') {
                initPlanner(state.budgetCY, state.weekActuals);
            }
            if (btn.dataset.tab === 'accounts') {
                renderAccountsTab(state.accountsData);
            }
            if (btn.dataset.tab === 'import') {
                renderMappings(state.glMappings, state.budgetCY);
            }
            if (btn.dataset.tab === 'pm-dlbooks') {
                renderPMTab(state.pmData);
            }
        });
    });
}

// ── Budget editing (works for both CY and NY) ──

/** Resolve the data array from a section name */
function getSection(data, sectionName) {
    return data[sectionName]; // 'income', 'outgoings', 'contributionItems'
}

function setupBudgetEditing(sectionId, prefix, data, saveFn) {
    const section = document.getElementById(sectionId);

    // Helper to re-open a detail row after re-render
    function reopenDetail(sec, idx) {
        const row = document.getElementById(`${prefix}${sec}-detail-${idx}`);
        if (row) row.style.display = 'table-row';
    }

    // Currency input: format on blur, raw on focus
    section.addEventListener('focus', (e) => {
        if (e.target.classList.contains('currency-input') && !e.target.dataset.field?.startsWith('revision-')) {
            e.target.value = e.target.dataset.raw;
            e.target.select();
        }
    }, true);

    section.addEventListener('blur', (e) => {
        if (e.target.classList.contains('currency-input') && !e.target.dataset.field?.startsWith('revision-')) {
            const val = parseCurrency(e.target.value);
            e.target.dataset.raw = val;
            e.target.value = fmtPlain(val);
            applyBudgetChange(e.target, data, prefix);
            saveFn(data);
            renderBudgetTab(data, prefix);
        }
    }, true);

    // Select and date inputs (not inside detail rows)
    section.addEventListener('change', (e) => {
        const el = e.target;
        if (el.classList.contains('editable') && !el.closest('.detail-row')) {
            applyBudgetChange(el, data, prefix);
            saveFn(data);
            renderBudgetTab(data, prefix);
        }
    });

    // Add new budget line item
    section.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.add-item-btn');
        if (addBtn) {
            const sec = addBtn.dataset.section;
            const y = String(data.year || 2026);
            if (sec === 'outgoings') {
                const name = prompt('Enter item name:');
                if (!name || !name.trim()) return;
                const isPrimary = data.outgoings.length < data.primaryCount;
                data.outgoings.push({
                    name: name.trim(),
                    weekly: 0,
                    cycle: 'Monthly',
                    firstPayment: y + '-01-01',
                    comment: '',
                    revisions: []
                });
                saveFn(data);
                renderBudgetTab(data, prefix);
            }
        }
    });

    // Expand/collapse toggle
    section.addEventListener('click', (e) => {
        const toggle = e.target.closest('.expand-toggle');
        if (toggle) {
            const idx = toggle.dataset.index;
            const sec = toggle.dataset.section;
            const row = document.getElementById(`${toggle.dataset.pfx}${sec}-detail-${idx}`);
            if (row) {
                const visible = row.style.display !== 'none';
                row.style.display = visible ? 'none' : 'table-row';
                toggle.innerHTML = visible ? '&#9654;' : '&#9660;';
            }
        }

        // Add revision (works for any section)
        const addBtn = e.target.closest('.add-revision-btn');
        if (addBtn) {
            const idx = parseInt(addBtn.dataset.index);
            const sec = addBtn.dataset.section;
            const arr = getSection(data, sec);
            const item = arr[idx];
            migrateItem(item);
            const today = new Date().toISOString().split('T')[0];
            item.revisions.push({ fromDate: today, weekly: getCurrentWeekly(item), reason: '' });
            item.revisions.sort((a, b) => a.fromDate.localeCompare(b.fromDate));
            saveFn(data);
            renderBudgetTab(data, prefix);
            reopenDetail(sec, idx);
        }

        // Delete revision
        const delBtn = e.target.closest('.revision-delete');
        if (delBtn) {
            const idx = parseInt(delBtn.dataset.index);
            const ri = parseInt(delBtn.dataset.rev);
            const sec = delBtn.dataset.section;
            getSection(data, sec)[idx].revisions.splice(ri, 1);
            saveFn(data);
            renderBudgetTab(data, prefix);
            reopenDetail(sec, idx);
        }
    });

    // Comment editing
    section.addEventListener('blur', (e) => {
        if (e.target.classList.contains('detail-comment')) {
            const idx = parseInt(e.target.dataset.index);
            const sec = e.target.dataset.section;
            getSection(data, sec)[idx].comment = e.target.value;
            saveFn(data);
        }
    }, true);

    // Revision field editing (date and reason)
    section.addEventListener('change', (e) => {
        const el = e.target;
        const field = el.dataset.field;
        if (!field || !field.startsWith('revision-')) return;
        const idx = parseInt(el.dataset.index);
        const ri = parseInt(el.dataset.rev);
        const sec = el.dataset.section;
        const rev = getSection(data, sec)[idx].revisions[ri];
        if (!rev) return;

        if (field === 'revision-date') {
            rev.fromDate = el.value;
            getSection(data, sec)[idx].revisions.sort((a, b) => a.fromDate.localeCompare(b.fromDate));
        } else if (field === 'revision-reason') {
            rev.reason = el.value;
        }
        saveFn(data);
        renderBudgetTab(data, prefix);
        reopenDetail(sec, idx);
    });

    // Revision weekly amount
    section.addEventListener('blur', (e) => {
        const el = e.target;
        if (el.dataset.field === 'revision-weekly' && el.classList.contains('currency-input')) {
            const val = parseCurrency(el.value);
            const idx = parseInt(el.dataset.index);
            const ri = parseInt(el.dataset.rev);
            const sec = el.dataset.section;
            const rev = getSection(data, sec)[idx].revisions[ri];
            if (rev) {
                rev.weekly = val;
                el.value = fmtPlain(val);
                el.dataset.raw = val;
                saveFn(data);
                renderBudgetTab(data, prefix);
                reopenDetail(sec, idx);
            }
        }
    }, true);
}

function applyBudgetChange(el, data, prefix) {
    const field = el.dataset.field;
    const prop = el.dataset.prop;
    const index = el.dataset.index;

    if (field === 'income') {
        data.income[index][prop] = parseCurrency(el.dataset.raw || el.value);
    } else if (field === 'bonuses') {
        data.bonuses[index][prop] = parseCurrency(el.dataset.raw || el.value);
    } else if (field === 'outgoings') {
        const amount = parseCurrency(el.dataset.raw || el.value);
        const item = data.outgoings[index];
        if (prop === 'weekly') {
            item.weekly = amount;
        } else if (prop === 'monthly') {
            // Back-calculate weekly from monthly
            item.weekly = monthlyToWeekly(amount);
        } else if (prop === 'quarterly') {
            item.weekly = quarterlyToWeekly(amount);
        } else if (prop === 'annual') {
            item.weekly = annualToWeekly(amount);
        } else {
            // cycle, firstPayment — string values
            item[prop] = el.value;
        }
    } else if (field === 'contributionItems') {
        const amount = parseCurrency(el.dataset.raw || el.value);
        data.contributionItems[index].weekly = amount;
    }
}

// ── Planner editing ──
function setupPlannerEditing() {
    const planner = document.getElementById('planner');

    // Primary account balance input
    planner.addEventListener('focus', (e) => {
        if (e.target.id === 'primary-acct-balance') {
            e.target.value = state.budgetCY.primaryAccountBalance || 0;
            e.target.select();
        }
    }, true);

    planner.addEventListener('blur', (e) => {
        if (e.target.id === 'primary-acct-balance') {
            const val = parseCurrency(e.target.value);
            e.target.value = fmtPlain(val);
            state.budgetCY.primaryAccountBalance = val;
            saveBudgetCY(state.budgetCY);
            renderWeek(state.budgetCY, state.weekActuals);
            buildWeekStrip(state.weekActuals);
        }
    }, true);

    // Actual amount: format on blur, raw on focus
    planner.addEventListener('focus', (e) => {
        if (e.target.classList.contains('actual-input')) {
            e.target.value = parseCurrency(e.target.value);
            e.target.select();
        }
    }, true);

    planner.addEventListener('blur', (e) => {
        if (e.target.classList.contains('actual-input')) {
            const val = parseCurrency(e.target.value);
            e.target.value = fmtPlain(val);

            const itemName = e.target.dataset.item;
            const type = e.target.dataset.type;
            const weekIdx = parseInt(e.target.dataset.week);
            const expected = parseFloat(e.target.dataset.expected);

            ensureWeekActual(weekIdx);
            const bucket = state.weekActuals[weekIdx][type];
            if (!bucket[itemName]) {
                bucket[itemName] = { actual: val, status: 'pending', comment: '' };
            } else {
                bucket[itemName].actual = val;
            }

            // Auto-set status
            if (Math.abs(val - expected) < 0.01) {
                bucket[itemName].status = 'confirmed';
            } else {
                bucket[itemName].status = 'adjusted';
            }

            saveWeekActuals(state.weekActuals);
            renderWeek(state.budgetCY, state.weekActuals);
            buildWeekStrip(state.weekActuals);
        }
    }, true);

    // Comment
    planner.addEventListener('blur', (e) => {
        if (e.target.classList.contains('comment-input')) {
            const itemName = e.target.dataset.item;
            const type = e.target.dataset.type;
            const weekIdx = parseInt(e.target.dataset.week);

            ensureWeekActual(weekIdx);
            const bucket = state.weekActuals[weekIdx][type];
            if (!bucket[itemName]) {
                const expected = 0;
                bucket[itemName] = { actual: expected, status: 'pending', comment: e.target.value };
            } else {
                bucket[itemName].comment = e.target.value;
            }
            saveWeekActuals(state.weekActuals);
        }
    }, true);

    // Status button click — toggle confirm
    planner.addEventListener('click', (e) => {
        const btn = e.target.closest('.status-btn');
        if (!btn) return;

        const itemName = btn.dataset.item;
        const type = btn.dataset.type;
        const weekIdx = parseInt(btn.dataset.week);

        ensureWeekActual(weekIdx);
        const bucket = state.weekActuals[weekIdx][type];

        // Find expected amount
        const allItems = [...allSchedules.primary, ...allSchedules.secondary, ...allSchedules.contributions];
        const match = allItems.find(s => s.item.name === itemName);
        const expected = match ? match.schedule[weekIdx] : 0;

        if (!bucket[itemName]) {
            bucket[itemName] = { actual: expected, status: 'confirmed', comment: '' };
        } else {
            // Toggle: pending → confirmed → pending
            bucket[itemName].status = bucket[itemName].status === 'confirmed' ? 'pending' : 'confirmed';
            if (bucket[itemName].status === 'confirmed') {
                bucket[itemName].actual = expected;
            }
        }

        saveWeekActuals(state.weekActuals);
        renderWeek(state.budgetCY, state.weekActuals);
        buildWeekStrip(state.weekActuals);
    });
}

function ensureWeekActual(weekIdx) {
    if (!state.weekActuals[weekIdx]) {
        state.weekActuals[weekIdx] = { items: {}, contributions: {} };
    }
    if (!state.weekActuals[weekIdx].items) state.weekActuals[weekIdx].items = {};
    if (!state.weekActuals[weekIdx].contributions) state.weekActuals[weekIdx].contributions = {};
}

// ── Accounts editing ──
function setupAccountsEditing() {
    const section = document.getElementById('accounts');

    section.addEventListener('focus', (e) => {
        if (e.target.classList.contains('account-balance-input')) {
            const sec = e.target.dataset.section;
            const idx = parseInt(e.target.dataset.index);
            e.target.value = state.accountsData[sec][idx].balance;
            e.target.select();
        }
    }, true);

    section.addEventListener('blur', (e) => {
        if (e.target.classList.contains('account-balance-input')) {
            const val = parseCurrency(e.target.value);
            const sec = e.target.dataset.section;
            const idx = parseInt(e.target.dataset.index);
            state.accountsData[sec][idx].balance = val;
            e.target.value = fmtPlain(val);
            saveAccounts(state.accountsData);
            renderAccountsTab(state.accountsData);

            // Sync HSBC PPR balance to budget primary account
            if (state.accountsData[sec][idx].id === 'hsbc-ppr') {
                state.budgetCY.primaryAccountBalance = val;
                saveBudgetCY(state.budgetCY);
            }
        }
    }, true);
}

// ── Import ──

// Module-level so updateImportCounts (also in this file) can call it.
let applyImportFilters = null;

function setupImport() {
    const section = document.getElementById('import');

    // CSV file upload
    document.getElementById('csv-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                state.importedTransactions = parseNabCsv(evt.target.result);
                const allLines = getAllLineNames(state.budgetCY);
                const dupCount = autoSuggest(state.importedTransactions, state.glMappings, allLines, state.storedTransactionHashes);
                renderImportTab(state.importedTransactions, state.budgetCY, dupCount);
                const msg = dupCount > 0
                    ? `${state.importedTransactions.length} transactions loaded (${dupCount} duplicates)`
                    : `${state.importedTransactions.length} transactions loaded`;
                showToast(msg);
            } catch (err) {
                console.error('CSV parse error:', err);
                document.getElementById('import-preview').innerHTML =
                    `<p class="negative">Error parsing CSV: ${err.message}</p>`;
            }
        };
        reader.readAsText(file);
    });

    // Search/filter inputs (delegated since they're created dynamically)
    section.addEventListener('input', (e) => {
        if (e.target.id === 'import-search') applyImportFilters();
    });
    section.addEventListener('change', (e) => {
        if (e.target.id === 'import-search-line' || e.target.id === 'import-search-source') {
            applyImportFilters();
        }
    });
    section.addEventListener('click', (e) => {
        if (e.target.id === 'import-search-clear') {
            const s = document.getElementById('import-search');
            const l = document.getElementById('import-search-line');
            const src = document.getElementById('import-search-source');
            if (s) s.value = '';
            if (l) l.value = '';
            if (src) src.value = '';
            applyImportFilters();
        }
    });

    // GL line assignment
    section.addEventListener('change', (e) => {
        if (e.target.classList.contains('gl-select')) {
            const idx = parseInt(e.target.dataset.txIndex);
            const line = e.target.value;
            const tx = state.importedTransactions[idx];
            tx.glLine = line;

            // If remember checkbox is checked, save the mapping
            const row = e.target.closest('tr');
            const checkbox = row ? row.querySelector('.remember-check') : null;
            if (checkbox && checkbox.checked && line && line !== '' && line !== '-- Ignore --' && line !== '-- Other --') {
                state.glMappings[tx.merchant] = line;
                // Apply to all unassigned with same merchant
                state.importedTransactions.forEach(t => {
                    if (t.merchant === tx.merchant && !t.glLine) {
                        t.glLine = line;
                    }
                });
                saveGlMappings(state.glMappings);
                renderMappings(state.glMappings, state.budgetCY);
            }

            updateImportCounts();
        }

        // Remember checkbox toggled
        if (e.target.classList.contains('remember-check')) {
            const idx = parseInt(e.target.dataset.txIndex);
            const tx = state.importedTransactions[idx];
            if (e.target.checked && tx.glLine && tx.glLine !== '' && tx.glLine !== '-- Ignore --' && tx.glLine !== '-- Other --') {
                state.glMappings[tx.merchant] = tx.glLine;
                state.importedTransactions.forEach(t => {
                    if (t.merchant === tx.merchant && !t.glLine) {
                        t.glLine = tx.glLine;
                    }
                });
                saveGlMappings(state.glMappings);
            } else if (!e.target.checked) {
                delete state.glMappings[tx.merchant];
                saveGlMappings(state.glMappings);
            }
            renderMappings(state.glMappings, state.budgetCY);
            updateImportCounts();
        }
    });

    // Combined filter + search
    applyImportFilters = function() {
        const activeBtn = section.querySelector('.import-filter-btn.active');
        const groupFilter = activeBtn ? activeBtn.dataset.filter : 'all';
        const searchEl = document.getElementById('import-search');
        const lineEl = document.getElementById('import-search-line');
        const sourceEl = document.getElementById('import-search-source');

        const searchText = searchEl ? searchEl.value.toLowerCase().trim() : '';
        const lineFilter = lineEl ? lineEl.value : '';
        const sourceFilter = sourceEl ? sourceEl.value : '';

        const rows = section.querySelectorAll('.import-table tbody tr');
        let visible = 0;
        rows.forEach(row => {
            const group = row.dataset.filterGroup || '';
            const search = row.dataset.search || '';
            const source = row.dataset.source || '';
            const glLine = row.dataset.glLine || '';

            let show = true;
            // Group filter
            if (groupFilter !== 'all' && group !== groupFilter) show = false;
            // Text search
            if (searchText && !search.includes(searchText)) show = false;
            // Budget line filter
            if (lineFilter && glLine !== lineFilter) show = false;
            // Source filter
            if (sourceFilter && source !== sourceFilter) show = false;

            row.style.display = show ? '' : 'none';
            if (show) visible++;
        });
    };

    // Filter buttons
    section.addEventListener('click', (e) => {
        const filterBtn = e.target.closest('.import-filter-btn');
        if (filterBtn) {
            section.querySelectorAll('.import-filter-btn').forEach(b => b.classList.remove('active'));
            filterBtn.classList.add('active');
            applyImportFilters();
        }

        // Delete mapping
        const delMap = e.target.closest('.mapping-delete');
        if (delMap) {
            const merchant = delMap.dataset.merchant;
            delete state.glMappings[merchant];
            saveGlMappings(state.glMappings);
            renderMappings(state.glMappings, state.budgetCY);
            showToast('Mapping removed');
        }

        // Apply to planner
        if (e.target.id === 'apply-to-planner') {
            if (state.importedTransactions.length === 0) return;
            const unassigned = state.importedTransactions.filter(tx => !tx.glLine);
            if (unassigned.length > 0) {
                if (!confirm(`${unassigned.length} transactions are still unassigned. Apply assigned ones anyway?`)) return;
            }
            state.weekActuals = applyToPlanner(state.importedTransactions, state.weekActuals);
            saveWeekActuals(state.weekActuals);
            showToast('Applied to planner');
        }
    });
}

/** Update filter counts and row groups without full re-render */
function updateImportCounts() {
    const section = document.getElementById('import');
    const rows = section.querySelectorAll('.import-table tbody tr');

    // Update each row's data attributes based on current glLine
    rows.forEach(row => {
        const select = row.querySelector('.gl-select');
        if (!select) return;
        const idx = parseInt(select.dataset.txIndex);
        const tx = state.importedTransactions[idx];
        const group = tx.glLine ? (tx.glLine === '-- Ignore --' ? 'ignored' : 'assigned') : 'unassigned';
        row.dataset.filterGroup = group;
        row.dataset.glLine = tx.glLine || '';
    });

    // Update count badges
    const unassigned = state.importedTransactions.filter(tx => !tx.glLine).length;
    const assigned = state.importedTransactions.filter(tx => tx.glLine && tx.glLine !== '-- Ignore --').length;
    const ignored = state.importedTransactions.filter(tx => tx.glLine === '-- Ignore --').length;

    const buttons = section.querySelectorAll('.import-filter-btn');
    buttons.forEach(btn => {
        const f = btn.dataset.filter;
        if (f === 'all') btn.textContent = `All (${state.importedTransactions.length})`;
        if (f === 'unassigned') btn.textContent = `Unassigned (${unassigned})`;
        if (f === 'assigned') btn.textContent = `Assigned (${assigned})`;
        if (f === 'ignored') btn.textContent = `Ignored (${ignored})`;
    });

    // Re-apply combined filters
    if (applyImportFilters) {
        applyImportFilters();
        return;
    }
    const activeFilter = section.querySelector('.import-filter-btn.active')?.dataset.filter || 'unassigned';
    rows.forEach(row => {
        const group = row.dataset.filterGroup;
        if (activeFilter === 'all') {
            row.style.display = '';
        } else {
            row.style.display = group === activeFilter ? '' : 'none';
        }
    });
}

