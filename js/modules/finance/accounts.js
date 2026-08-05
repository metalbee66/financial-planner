/**
 * Accounts dashboard — all bank, investment, and super accounts.
 */

import { fmt, fmtPlain, fmtSigned, showToast, parseCurrency, saveBudgetCY, isValidBalanceRecord } from '../../data.js';
import { fbSave } from '../../firebase-sync.js';
import { state } from '../../state.js';

export const DEFAULT_ACCOUNTS = {
    banking: [
        { id: 'hsbc-ppr-loan', bank: 'HSBC', name: 'Loan — PPR (Carrum Downs)', desc: 'Primary home loan — outstanding balance.', balance: 0, type: 'liability' },
        { id: 'hsbc-ppr-redraw', bank: 'HSBC', name: 'Redraw — PPR', desc: 'Available redraw (paid ahead of schedule).', balance: 163000, type: 'asset' },
        { id: 'hsbc-loan-cranbourne', bank: 'HSBC', name: 'Loan — Cranbourne', desc: 'Investment mortgage.', balance: 0, type: 'liability' },
        { id: 'hsbc-loan-mentone', bank: 'HSBC', name: 'Loan — Mentone', desc: 'Investment mortgage.', balance: 0, type: 'liability' },
        { id: 'hsbc-loan-stock-assets', bank: 'HSBC', name: 'Loan — Stock Assets', desc: 'Investment mortgage.', balance: 0, type: 'liability' },
        { id: 'hsbc-loan-home-value', bank: 'HSBC', name: 'Loan — Home Value', desc: 'Investment mortgage.', balance: 0, type: 'liability' },
        { id: 'nab-family', bank: 'NAB', name: 'Family Credit Card', desc: 'Used to pay most budget items.', balance: 0, type: 'liability' },
        { id: 'nab-business', bank: 'NAB', name: 'Business Credit Card', desc: 'Business expenses only.', balance: 0, type: 'liability' },
        { id: 'anz', bank: 'ANZ', name: 'Rental Income - Cranbourne', desc: 'Tenant pays rent into this account.', balance: 0, type: 'asset' },
        { id: 'westpac', bank: 'Westpac', name: 'Brad Personal / Rental - Mentone', desc: 'Personal account. Tenant pays rent here.', balance: 0, type: 'asset' },
        { id: 'bankwest', bank: 'Bankwest', name: 'Diana Personal', desc: "Diana's personal account.", balance: 0, type: 'asset' },
    ],
    investments: [
        { id: 'ib', bank: 'Interactive Brokers', name: 'Stock Holdings (UK & Other)', desc: 'International stock portfolio.', balance: 0, type: 'asset' },
        { id: 'sw', bank: 'Selfwealth', name: 'Stock Holdings (AU & US)', desc: 'Australian and US stock portfolio.', balance: 0, type: 'asset' },
    ],
    super: [
        { id: 'amp-brad', bank: 'AMP', name: 'Brad Superannuation', desc: '', balance: 0, type: 'asset' },
        { id: 'amp-diana', bank: 'AMP', name: 'Diana Superannuation', desc: '', balance: 0, type: 'asset' },
    ],
};

export function loadAccounts() {
    const saved = localStorage.getItem('accounts_data');
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
}

// ── v2.4: auto-populated balances from scraped bank_inbox/balances ──
//
// Scraped balances are keyed by accountSlug (e.g. 'amp-super'); the accounts
// view is keyed by category+index with per-account `id`s. This map pairs a
// scraped slug to an existing account `id` so the balance lands on that card.
//
// ⚠️ PAIRINGS ARE PROVISIONAL — Brad to confirm against the real scraped
// slugs once the Selfwealth + AMP scrapers run headed. Any slug NOT in this
// map renders as its own auto-only row in its category (see buildAutoOnlyRows),
// so an unconfirmed slug is surfaced, never silently dropped.
const SLUG_TO_ACCOUNT_ID = {
    'amp-super': 'amp-brad',            // TODO confirm: pilot AMP account = Brad's super?
    'selfwealth': 'sw',                 // Selfwealth Net Portfolio → 'Stock Holdings (AU & US)' (confirmed 2026-08-05)
    'hsbc-ppr-loan': 'hsbc-ppr-loan',
    'hsbc-ppr-redraw': 'hsbc-ppr-redraw',
    'hsbc-loan-cranbourne': 'hsbc-loan-cranbourne',
    'hsbc-loan-mentone': 'hsbc-loan-mentone',
    'hsbc-loan-stock-assets': 'hsbc-loan-stock-assets',
    'hsbc-loan-home-value': 'hsbc-loan-home-value',
    'nab-family': 'nab-family',
    'nab-business': 'nab-business',
};

const STALE_MS = 48 * 60 * 60 * 1000;  // auto balance older than 48h → stale warning

// Escape scraped string fields before interpolating into innerHTML. The values
// come from n8n/scraper output (isValidBalanceRecord checks shape, not chars),
// so a bank name or slug containing < " & must not break out of the markup.
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "updated 2h ago" / "updated 3d ago" from an ISO asOf string. */
function relativeTimeFromNow(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const diff = Date.now() - then;
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
}

/** Valid scraped balance records keyed by accountSlug (from state.bankInbox). */
function autoBalances() {
    const balances = (state.bankInbox && state.bankInbox.balances) || {};
    const out = {};
    for (const [slug, rec] of Object.entries(balances)) {
        if (isValidBalanceRecord(rec)) out[slug] = rec;
    }
    return out;
}

/**
 * For a given account, find its auto balance record IF one is mapped to its id
 * AND the account isn't manually overridden. Returns the record or null.
 * Manual wins: an account flagged manualBalance keeps its typed value.
 */
function autoRecordForAccount(acct, autos) {
    if (acct.manualBalance) return null;
    for (const [slug, rec] of Object.entries(autos)) {
        if (SLUG_TO_ACCOUNT_ID[slug] === acct.id) return rec;
    }
    return null;
}

// Balance-record `category` → accounts-view section key.
const CATEGORY_TO_SECTION = { banking: 'banking', super: 'super', investment: 'investments' };

/**
 * Scraped balances in the given section's category that aren't paired to any
 * existing account card (slug absent from SLUG_TO_ACCOUNT_ID) and haven't
 * already been consumed. These render as read-only auto-only rows.
 */
function buildAutoOnlyRows(sectionKey, autos, consumedSlugs) {
    return Object.values(autos).filter(rec =>
        CATEGORY_TO_SECTION[rec.category] === sectionKey
        && !(rec.accountSlug in SLUG_TO_ACCOUNT_ID)
        && !consumedSlugs.has(rec.accountSlug)
    );
}

/** Render an auto badge (auto · updated Nh ago [· stale]) for a balance record. */
function autoBadgeHtml(rec) {
    const rel = relativeTimeFromNow(rec.asOf);
    const stale = (Date.now() - Date.parse(rec.asOf)) > STALE_MS;
    return `<span class="account-auto-tag" title="Auto-populated from bank scrape (${esc(rec.asOf)})">auto${rel ? ' · ' + rel : ''}</span>`
        + (stale ? '<span class="account-stale-tag" title="Balance is over 48h old — the scraper may be failing">stale</span>' : '');
}

export function saveAccounts(data) {
    fbSave('accounts_data', data);
    showToast('Saved');
}

export function renderAccountsTab(accounts) {
    const container = document.getElementById('accounts-content');

    let totalAssets = 0;
    let totalLiabilities = 0;

    const sections = [
        { key: 'banking', title: 'Banking' },
        { key: 'investments', title: 'Investments' },
        { key: 'super', title: 'Superannuation' },
    ];

    let html = '';

    // v2.4: scraped balances available for auto-population this render.
    const autos = autoBalances();
    const consumedSlugs = new Set();  // slugs that landed on an existing card

    sections.forEach(sec => {
        html += `<div class="accounts-section-title">${sec.title}</div>`;
        html += '<div class="accounts-grid">';

        accounts[sec.key].forEach((acct, i) => {
            // Auto balance wins only when the account isn't manually overridden.
            const auto = autoRecordForAccount(acct, autos);
            if (auto) consumedSlugs.add(auto.accountSlug);
            const bal = auto ? auto.balance : acct.balance;
            const isLiability = acct.type === 'liability';
            const colorCls = bal === 0 ? '' : (isLiability && bal > 0 ? 'negative' : 'positive');

            if (isLiability) {
                totalLiabilities += bal;
            } else {
                totalAssets += bal;
            }

            html += `
                <div class="account-card">
                    <div class="account-bank">${acct.bank}</div>
                    <div class="account-name">${acct.name}</div>
                    ${acct.desc ? `<div class="account-desc">${acct.desc}</div>` : ''}
                    ${auto ? `<div class="account-auto-line">${autoBadgeHtml(auto)}</div>` : ''}
                    <div class="account-balance ${colorCls}">
                        <input class="account-balance-input ${colorCls}" type="text"
                            value="${fmtPlain(bal)}"
                            data-section="${sec.key}" data-index="${i}">
                    </div>
                </div>
            `;
        });

        // Auto-only rows: scraped balances in this category not paired to any
        // existing card (unmapped slug). Read-only — surfaced so an unconfirmed
        // slug is visible, never silently dropped. Tallied into totals as assets.
        buildAutoOnlyRows(sec.key, autos, consumedSlugs).forEach(rec => {
            consumedSlugs.add(rec.accountSlug);
            totalAssets += rec.balance;
            const colorCls = rec.balance === 0 ? '' : 'positive';
            html += `
                <div class="account-card account-card-auto">
                    <div class="account-bank">${esc(rec.institution)}</div>
                    <div class="account-name">${esc(rec.accountSlug)}</div>
                    <div class="account-auto-line">${autoBadgeHtml(rec)} <span class="dim" style="font-size:0.7rem;">unmatched — map this slug</span></div>
                    <div class="account-balance ${colorCls}">
                        <span class="account-balance-input ${colorCls}" style="display:inline-block;">${fmtPlain(rec.balance)}</span>
                    </div>
                </div>
            `;
        });

        html += '</div>';
    });

    const net = totalAssets - totalLiabilities;
    html += `
        <div class="accounts-total">
            <span class="accounts-total-label">Total Assets</span>
            <span class="accounts-total-value positive">${fmt(totalAssets)}</span>
        </div>
        <div class="accounts-total" style="margin-top:8px;">
            <span class="accounts-total-label">Total Liabilities</span>
            <span class="accounts-total-value negative">${fmt(totalLiabilities)}</span>
        </div>
        <div class="accounts-total" style="margin-top:8px;border-color:var(--accent);">
            <span class="accounts-total-label">Net Position</span>
            <span class="accounts-total-value ${net >= 0 ? 'positive' : 'negative'}">${fmtSigned(net)}</span>
        </div>
    `;

    container.innerHTML = html;
}

// ── Editing wiring (moved from app.js during module-shell refactor) ──

export function setupAccountsEditing() {
    const section = document.getElementById('accounts');
    if (!section) return;

    section.addEventListener('focus', (e) => {
        if (e.target.classList.contains('account-balance-input')) {
            const sec = e.target.dataset.section;
            const idx = parseInt(e.target.dataset.index);
            const acct = state.accountsData[sec][idx];
            // Editing reveals the effective (displayed) balance — the auto
            // value if one is active, else the stored manual value — so the
            // user edits what they see; the blur pins it as manual.
            const auto = autoRecordForAccount(acct, autoBalances());
            e.target.value = auto ? auto.balance : acct.balance;
            e.target.select();
        }
    }, true);

    section.addEventListener('blur', (e) => {
        if (e.target.classList.contains('account-balance-input')) {
            const val = parseCurrency(e.target.value);
            const sec = e.target.dataset.section;
            const idx = parseInt(e.target.dataset.index);
            state.accountsData[sec][idx].balance = val;
            // v2.4: a manual edit pins this account to the typed value — auto
            // scraped balances stop overriding it (manual wins). Cleared only
            // by removing the flag (future feature if Brad wants to re-enable auto).
            state.accountsData[sec][idx].manualBalance = true;
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
