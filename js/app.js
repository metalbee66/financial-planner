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

    setupTabs();
    setupBudgetEditing('budget-cy', 'cy-', budgetCY, saveBudgetCY);
    setupBudgetEditing('budget-ny', 'ny-', budgetNY, saveBudgetNY);
    setupPlannerEditing();
    setupAccountsEditing();
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
