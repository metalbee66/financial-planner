/**
 * Accounts dashboard — all bank, investment, and super accounts.
 */

const DEFAULT_ACCOUNTS = {
    banking: [
        { id: 'hsbc-ppr', bank: 'HSBC', name: 'Mortgage PPR (Redraw)', desc: 'Primary family account. Available redraw offsets home loan.', balance: 161606.99, type: 'offset' },
        { id: 'hsbc-inv', bank: 'HSBC', name: 'Mortgages - Investments', desc: '4 mortgage accounts: Cranbourne, Mentone, Cranbourne 2, Stock Assets.', balance: 0, type: 'liability' },
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

function loadAccounts() {
    const saved = localStorage.getItem('accounts_data');
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
}

function saveAccounts(data) {
    localStorage.setItem('accounts_data', JSON.stringify(data));
    showToast('Saved');
}

function renderAccountsTab(accounts) {
    const container = document.getElementById('accounts-content');

    let totalAssets = 0;
    let totalLiabilities = 0;

    const sections = [
        { key: 'banking', title: 'Banking' },
        { key: 'investments', title: 'Investments' },
        { key: 'super', title: 'Superannuation' },
    ];

    let html = '';

    sections.forEach(sec => {
        html += `<div class="accounts-section-title">${sec.title}</div>`;
        html += '<div class="accounts-grid">';

        accounts[sec.key].forEach((acct, i) => {
            const bal = acct.balance;
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
                    <div class="account-balance ${colorCls}">
                        <input class="account-balance-input ${colorCls}" type="text"
                            value="${fmtPlain(bal)}"
                            data-section="${sec.key}" data-index="${i}">
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
