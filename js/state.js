/**
 * Shared mutable state across modules.
 *
 * Replaces the cross-file globals (`budgetCY`, `budgetNY`, `weekActuals`,
 * `accountsData`, `pmData`, `glMappings`, `storedTransactionHashes`,
 * `importedTransactions`) that the pre-ES-module version relied on.
 *
 * Modules import the same `state` object identity, so reassigning a property
 * here is visible to all other modules — same semantics as the old globals,
 * just scoped to a single named import.
 */

export const state = {
    budgetCY: null,
    budgetNY: null,
    weekActuals: {},
    accountsData: null,
    pmData: null,
    glMappings: {},
    storedTransactionHashes: new Set(),
    importedTransactions: [],
    // v2.4: scraped bank data ingested via n8n → Firebase `bank_inbox`.
    // { transactions: { [txHash]: row }, balances: { [accountSlug]: record } }
    bankInbox: { transactions: {}, balances: {} },
    // Projects module (Phase 1+): { items: [...], (later) prefs, notifications, ... }
    projectsData: null,
};
