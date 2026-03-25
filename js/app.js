/**
 * App controller — tabs, editing, planner interaction, Firebase bootstrap.
 */

let budgetCY, budgetNY, weekActuals, accountsData;

document.addEventListener('DOMContentLoaded', async () => {
    // Load from localStorage first (instant render)
    budgetCY = loadBudgetCY();
    budgetNY = loadBudgetNY();
    weekActuals = loadWeekActuals();
    accountsData = loadAccounts();
    window._budgetData = budgetCY;

    // Try Firebase
    const fbReady = await initFirebase();

    if (fbReady) {
        // Set up auth listener
        firebaseAuth.onAuthStateChanged(async (user) => {
            if (user) {
                // Check allowed emails
                if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(user.email)) {
                    await firebaseAuth.signOut();
                    showLoginScreen();
                    return;
                }
                currentUser = user;
                document.getElementById('sign-out-btn').style.display = '';
                showApp();

                // Sync data from Firebase
                await initialSync();
                patchSaveFunctions();
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
    glMappings = loadGlMappings();
    storedTransactionHashes = loadStoredHashes();

    setupTabs();
    setupBudgetEditing('budget-cy', 'cy-', budgetCY, saveBudgetCY);
    setupBudgetEditing('budget-ny', 'ny-', budgetNY, saveBudgetNY);
    setupPlannerEditing();
    setupAccountsEditing();
    setupImport();
});

function renderAll() {
    renderBudgetTab(budgetCY, 'cy-');
    renderBudgetTab(budgetNY, 'ny-');
    initPlanner(budgetCY, weekActuals);
    renderAccountsTab(accountsData);
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
                window._budgetData = budgetCY;
                initPlanner(budgetCY, weekActuals);
            }
            if (btn.dataset.tab === 'accounts') {
                renderAccountsTab(accountsData);
            }
            if (btn.dataset.tab === 'import') {
                renderMappings(glMappings, budgetCY);
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
            e.target.value = budgetCY.primaryAccountBalance || 0;
            e.target.select();
        }
    }, true);

    planner.addEventListener('blur', (e) => {
        if (e.target.id === 'primary-acct-balance') {
            const val = parseCurrency(e.target.value);
            e.target.value = fmtPlain(val);
            budgetCY.primaryAccountBalance = val;
            saveBudgetCY(budgetCY);
            renderWeek(budgetCY, weekActuals);
            buildWeekStrip(weekActuals);
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
            const bucket = weekActuals[weekIdx][type];
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

            saveWeekActuals(weekActuals);
            renderWeek(budgetCY, weekActuals);
            buildWeekStrip(weekActuals);
        }
    }, true);

    // Comment
    planner.addEventListener('blur', (e) => {
        if (e.target.classList.contains('comment-input')) {
            const itemName = e.target.dataset.item;
            const type = e.target.dataset.type;
            const weekIdx = parseInt(e.target.dataset.week);

            ensureWeekActual(weekIdx);
            const bucket = weekActuals[weekIdx][type];
            if (!bucket[itemName]) {
                const expected = 0;
                bucket[itemName] = { actual: expected, status: 'pending', comment: e.target.value };
            } else {
                bucket[itemName].comment = e.target.value;
            }
            saveWeekActuals(weekActuals);
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
        const bucket = weekActuals[weekIdx][type];

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

        saveWeekActuals(weekActuals);
        renderWeek(budgetCY, weekActuals);
        buildWeekStrip(weekActuals);
    });
}

function ensureWeekActual(weekIdx) {
    if (!weekActuals[weekIdx]) {
        weekActuals[weekIdx] = { items: {}, contributions: {} };
    }
    if (!weekActuals[weekIdx].items) weekActuals[weekIdx].items = {};
    if (!weekActuals[weekIdx].contributions) weekActuals[weekIdx].contributions = {};
}

// ── Accounts editing ──
function setupAccountsEditing() {
    const section = document.getElementById('accounts');

    section.addEventListener('focus', (e) => {
        if (e.target.classList.contains('account-balance-input')) {
            const sec = e.target.dataset.section;
            const idx = parseInt(e.target.dataset.index);
            e.target.value = accountsData[sec][idx].balance;
            e.target.select();
        }
    }, true);

    section.addEventListener('blur', (e) => {
        if (e.target.classList.contains('account-balance-input')) {
            const val = parseCurrency(e.target.value);
            const sec = e.target.dataset.section;
            const idx = parseInt(e.target.dataset.index);
            accountsData[sec][idx].balance = val;
            e.target.value = fmtPlain(val);
            saveAccounts(accountsData);
            renderAccountsTab(accountsData);

            // Sync HSBC PPR balance to budget primary account
            if (accountsData[sec][idx].id === 'hsbc-ppr') {
                budgetCY.primaryAccountBalance = val;
                saveBudgetCY(budgetCY);
            }
        }
    }, true);
}

// ── Import ──
function setupImport() {
    const section = document.getElementById('import');

    // CSV file upload
    document.getElementById('csv-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                importedTransactions = parseNabCsv(evt.target.result);
                const allLines = getAllLineNames(budgetCY);
                const dupCount = autoSuggest(importedTransactions, glMappings, allLines, storedTransactionHashes);
                renderImportTab(importedTransactions, budgetCY, dupCount);
                const msg = dupCount > 0
                    ? `${importedTransactions.length} transactions loaded (${dupCount} duplicates)`
                    : `${importedTransactions.length} transactions loaded`;
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
            const tx = importedTransactions[idx];
            tx.glLine = line;

            // If remember checkbox is checked, save the mapping
            const row = e.target.closest('tr');
            const checkbox = row ? row.querySelector('.remember-check') : null;
            if (checkbox && checkbox.checked && line && line !== '' && line !== '-- Ignore --' && line !== '-- Other --') {
                glMappings[tx.merchant] = line;
                // Apply to all unassigned with same merchant
                importedTransactions.forEach(t => {
                    if (t.merchant === tx.merchant && !t.glLine) {
                        t.glLine = line;
                    }
                });
                saveGlMappings(glMappings);
                renderMappings(glMappings, budgetCY);
            }

            updateImportCounts();
        }

        // Remember checkbox toggled
        if (e.target.classList.contains('remember-check')) {
            const idx = parseInt(e.target.dataset.txIndex);
            const tx = importedTransactions[idx];
            if (e.target.checked && tx.glLine && tx.glLine !== '' && tx.glLine !== '-- Ignore --' && tx.glLine !== '-- Other --') {
                glMappings[tx.merchant] = tx.glLine;
                importedTransactions.forEach(t => {
                    if (t.merchant === tx.merchant && !t.glLine) {
                        t.glLine = tx.glLine;
                    }
                });
                saveGlMappings(glMappings);
            } else if (!e.target.checked) {
                delete glMappings[tx.merchant];
                saveGlMappings(glMappings);
            }
            renderMappings(glMappings, budgetCY);
            updateImportCounts();
        }
    });

    // Combined filter + search (global so updateImportCounts can call it)
    window.applyImportFilters = function() {
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
    }

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
            delete glMappings[merchant];
            saveGlMappings(glMappings);
            renderMappings(glMappings, budgetCY);
            showToast('Mapping removed');
        }

        // Apply to planner
        if (e.target.id === 'apply-to-planner') {
            if (importedTransactions.length === 0) return;
            const unassigned = importedTransactions.filter(tx => !tx.glLine);
            if (unassigned.length > 0) {
                if (!confirm(`${unassigned.length} transactions are still unassigned. Apply assigned ones anyway?`)) return;
            }
            weekActuals = applyToPlanner(importedTransactions, weekActuals);
            saveWeekActuals(weekActuals);
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
        const tx = importedTransactions[idx];
        const group = tx.glLine ? (tx.glLine === '-- Ignore --' ? 'ignored' : 'assigned') : 'unassigned';
        row.dataset.filterGroup = group;
        row.dataset.glLine = tx.glLine || '';
    });

    // Update count badges
    const unassigned = importedTransactions.filter(tx => !tx.glLine).length;
    const assigned = importedTransactions.filter(tx => tx.glLine && tx.glLine !== '-- Ignore --').length;
    const ignored = importedTransactions.filter(tx => tx.glLine === '-- Ignore --').length;

    const buttons = section.querySelectorAll('.import-filter-btn');
    buttons.forEach(btn => {
        const f = btn.dataset.filter;
        if (f === 'all') btn.textContent = `All (${importedTransactions.length})`;
        if (f === 'unassigned') btn.textContent = `Unassigned (${unassigned})`;
        if (f === 'assigned') btn.textContent = `Assigned (${assigned})`;
        if (f === 'ignored') btn.textContent = `Ignored (${ignored})`;
    });

    // Re-apply combined filters
    if (window.applyImportFilters) {
        window.applyImportFilters();
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
