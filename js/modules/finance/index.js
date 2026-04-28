/**
 * Finance module — wraps the existing Budget CY / Budget NY / Planner /
 * Accounts / Import features as sub-tabs.
 *
 * Mount lifecycle:
 *   - mount(host)  — called once by the shell. Inserts the module's DOM
 *                    template, wires sub-nav, attaches edit handlers, does
 *                    the initial render.
 *   - The module element is then toggled visible/hidden by the shell as
 *     the user switches between top-level modules.
 */

import { state } from '../../state.js';
import { saveBudgetCY, saveBudgetNY } from '../../data.js';

import { renderBudgetTab, setupBudgetEditing } from './budget.js';
import { initPlanner, setupPlannerEditing } from './planner.js';
import { renderAccountsTab, setupAccountsEditing } from './accounts.js';
import { renderMappings, setupImport } from './import.js';

const TEMPLATE = `
<nav class="sub-nav">
    <button class="sub-tab-btn active" data-sub-tab="budget-cy">Budget CY</button>
    <button class="sub-tab-btn" data-sub-tab="budget-ny">Budget NY</button>
    <button class="sub-tab-btn" data-sub-tab="planner">Planner CY26</button>
    <button class="sub-tab-btn" data-sub-tab="accounts">Accounts</button>
    <button class="sub-tab-btn" data-sub-tab="import">Import</button>
</nav>

<!-- ═══ BUDGET CY ═══ -->
<section id="budget-cy" class="tab-content active">
    <div class="budget-container">
        <div class="section-card">
            <h2 class="section-header income-header">CY 2026 - Income</h2>
            <table class="budget-table">
                <thead><tr><th>Source</th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th></tr></thead>
                <tbody id="cy-income-body"></tbody>
                <tfoot><tr class="total-row">
                    <td>Total Income</td>
                    <td id="cy-income-total-weekly"></td><td id="cy-income-total-monthly"></td>
                    <td id="cy-income-total-quarterly"></td><td id="cy-income-total-annual"></td>
                </tr></tfoot>
            </table>
        </div>
        <div class="section-card">
            <h2 class="section-header bonus-header">Bonus / Tax Returns</h2>
            <table class="budget-table">
                <thead><tr><th>Source</th><th>Annual</th></tr></thead>
                <tbody id="cy-bonus-body"></tbody>
                <tfoot><tr class="total-row"><td>Total</td><td id="cy-bonus-total"></td></tr></tfoot>
            </table>
        </div>
        <div class="section-card">
            <h2 class="section-header outgoing-header">Outgoings</h2>
            <table class="budget-table">
                <thead><tr><th>Item</th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th><th>Pay Cycle</th><th>First Payment</th></tr></thead>
                <tbody id="cy-outgoing-body"></tbody>
                <tfoot><tr class="total-row">
                    <td>Total Outgoings</td>
                    <td id="cy-outgoing-total-weekly"></td><td id="cy-outgoing-total-monthly"></td>
                    <td id="cy-outgoing-total-quarterly"></td><td id="cy-outgoing-total-annual"></td>
                    <td colspan="2"></td>
                </tr></tfoot>
            </table>
            <div class="add-item-bar">
                <button class="add-item-btn" data-pfx="cy-" data-section="outgoings">+ Add Outgoing</button>
            </div>
        </div>
        <div class="section-card">
            <h2 class="section-header split-header">Contribution Split</h2>
            <table class="budget-table">
                <thead><tr><th></th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th></tr></thead>
                <tbody id="cy-split-body"></tbody>
            </table>
        </div>
        <div class="section-card">
            <h2 class="section-header residual-header">Residual Income</h2>
            <table class="budget-table">
                <thead><tr><th></th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th></tr></thead>
                <tbody id="cy-residual-body"></tbody>
            </table>
        </div>
    </div>
</section>

<!-- ═══ BUDGET NY ═══ -->
<section id="budget-ny" class="tab-content">
    <div class="budget-container">
        <div class="section-card">
            <h2 class="section-header income-header">CY 2027 - Income</h2>
            <table class="budget-table">
                <thead><tr><th>Source</th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th></tr></thead>
                <tbody id="ny-income-body"></tbody>
                <tfoot><tr class="total-row">
                    <td>Total Income</td>
                    <td id="ny-income-total-weekly"></td><td id="ny-income-total-monthly"></td>
                    <td id="ny-income-total-quarterly"></td><td id="ny-income-total-annual"></td>
                </tr></tfoot>
            </table>
        </div>
        <div class="section-card">
            <h2 class="section-header bonus-header">Bonus / Tax Returns</h2>
            <table class="budget-table">
                <thead><tr><th>Source</th><th>Annual</th></tr></thead>
                <tbody id="ny-bonus-body"></tbody>
                <tfoot><tr class="total-row"><td>Total</td><td id="ny-bonus-total"></td></tr></tfoot>
            </table>
        </div>
        <div class="section-card">
            <h2 class="section-header outgoing-header">Outgoings</h2>
            <table class="budget-table">
                <thead><tr><th>Item</th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th><th>Pay Cycle</th><th>First Payment</th></tr></thead>
                <tbody id="ny-outgoing-body"></tbody>
                <tfoot><tr class="total-row">
                    <td>Total Outgoings</td>
                    <td id="ny-outgoing-total-weekly"></td><td id="ny-outgoing-total-monthly"></td>
                    <td id="ny-outgoing-total-quarterly"></td><td id="ny-outgoing-total-annual"></td>
                    <td colspan="2"></td>
                </tr></tfoot>
            </table>
            <div class="add-item-bar">
                <button class="add-item-btn" data-pfx="ny-" data-section="outgoings">+ Add Outgoing</button>
            </div>
        </div>
        <div class="section-card">
            <h2 class="section-header split-header">Contribution Split</h2>
            <table class="budget-table">
                <thead><tr><th></th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th></tr></thead>
                <tbody id="ny-split-body"></tbody>
            </table>
        </div>
        <div class="section-card">
            <h2 class="section-header residual-header">Residual Income</h2>
            <table class="budget-table">
                <thead><tr><th></th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Annual</th></tr></thead>
                <tbody id="ny-residual-body"></tbody>
            </table>
        </div>
    </div>
</section>

<!-- ═══ PLANNER ═══ -->
<section id="planner" class="tab-content">
    <div class="week-strip" id="week-strip"></div>
    <div class="week-nav">
        <button class="week-nav-btn" id="week-prev" title="Previous week">&larr;</button>
        <div class="week-nav-title"><select id="week-select"></select></div>
        <button class="week-nav-btn" id="week-next" title="Next week">&rarr;</button>
        <button class="week-nav-btn today-btn" id="week-today" title="Jump to current week">Today</button>
    </div>
    <div class="planner-summary" id="planner-summary"></div>
    <div id="planner-content"></div>
</section>

<!-- ═══ ACCOUNTS ═══ -->
<section id="accounts" class="tab-content">
    <div id="accounts-content"></div>
</section>

<!-- ═══ IMPORT ═══ -->
<section id="import" class="tab-content">
    <div class="budget-container">
        <div class="section-card">
            <h2 class="section-header" style="background:#2a2a3e;color:var(--text-dim);">Import Transactions</h2>
            <div style="padding:20px;">
                <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:16px;">
                    Upload a CSV statement from NAB, HSBC, ANZ, Westpac, or Bankwest.
                    Transactions will be matched to budget lines automatically where possible.
                </p>
                <label class="import-upload-btn">
                    Choose CSV File
                    <input type="file" accept=".csv" id="csv-upload" style="display:none;">
                </label>
                <div id="import-preview" style="margin-top:16px;"></div>
            </div>
        </div>
        <div class="section-card">
            <h2 class="section-header" style="background:#1a2a1a;color:var(--accent);">Merchant Mappings</h2>
            <div id="mappings-content" style="padding:16px;"></div>
        </div>
        <div class="section-card" style="opacity:0.5;">
            <h2 class="section-header" style="background:#2a2a3e;color:var(--text-dim);">Bank API (Coming Soon)</h2>
            <div style="padding:20px;color:var(--text-dim);font-size:0.85rem;">
                Connect directly to bank APIs to pull transactions automatically.
            </div>
        </div>
    </div>
</section>
`;

let mounted = false;

export function mount(host) {
    if (mounted) return;
    host.innerHTML = TEMPLATE;
    mounted = true;

    // Sub-tab switching within the Finance module
    host.querySelectorAll('.sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            host.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            host.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            host.querySelector('#' + btn.dataset.subTab).classList.add('active');

            // Per-tab refresh on activation (some tabs need re-render to reflect external changes)
            switch (btn.dataset.subTab) {
                case 'planner':
                    initPlanner(state.budgetCY, state.weekActuals);
                    break;
                case 'accounts':
                    renderAccountsTab(state.accountsData);
                    break;
                case 'import':
                    renderMappings(state.glMappings, state.budgetCY);
                    break;
            }
        });
    });

    // Wire editing handlers
    setupBudgetEditing('budget-cy', 'cy-', state.budgetCY, saveBudgetCY);
    setupBudgetEditing('budget-ny', 'ny-', state.budgetNY, saveBudgetNY);
    setupPlannerEditing();
    setupAccountsEditing();
    setupImport();

    // Initial render
    renderBudgetTab(state.budgetCY, 'cy-');
    renderBudgetTab(state.budgetNY, 'ny-');
    initPlanner(state.budgetCY, state.weekActuals);
    renderAccountsTab(state.accountsData);
    renderMappings(state.glMappings, state.budgetCY);
}
