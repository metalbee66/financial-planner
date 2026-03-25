/**
 * Transaction import — parse CSV, present for review, assign to budget GL lines.
 */

let importedTransactions = [];
let glMappings = {};

function loadGlMappings() {
    const saved = localStorage.getItem('gl_mappings');
    if (saved) try { return JSON.parse(saved); } catch(e) {}
    return {};
}

function saveGlMappings(m) {
    glMappings = m;
    localStorage.setItem('gl_mappings', JSON.stringify(m));
    if (typeof fbSave === 'function') fbSave('gl_mappings', m);
}

/**
 * Parse NAB credit card CSV.
 */
function parseNabCsv(text) {
    const lines = text.split('\n');
    const transactions = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',');
        if (cols.length < 9) continue;

        const dateStr = cols[0].trim();
        const amount = parseFloat(cols[1]) || 0;
        const account = cols[2].trim();
        const txType = cols[4].trim();
        const details = cols[5].trim();
        const balance = parseFloat(cols[6]) || 0;
        const category = cols[7].trim();
        const merchant = cols[8].trim();
        const processedOn = cols[9] ? cols[9].trim() : '';

        const date = parseNabDate(dateStr);
        if (!date) continue;

        // Skip internal transfers/payments
        if (txType === 'CREDIT CARD PAYMENT') continue;

        transactions.push({
            date,
            dateStr,
            amount: Math.abs(amount),
            isRefund: amount > 0,
            account,
            txType,
            details,
            category,
            merchant: merchant || details.substring(0, 30),
            glLine: '', // to be assigned
        });
    }

    transactions.sort((a, b) => a.date - b.date);
    return transactions;
}

function parseNabDate(str) {
    const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    const parts = str.split(' ');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0]);
    const month = months[parts[1]];
    const year = 2000 + parseInt(parts[2]);
    if (isNaN(day) || month === undefined || isNaN(year)) return null;
    return new Date(year, month, day);
}

function getWeekIndex(date) {
    const year = date.getFullYear();
    const dates = getWeekDates(year);
    for (let i = dates.length - 1; i >= 0; i--) {
        if (date >= dates[i]) return i;
    }
    return 0;
}

function getBudgetLineNames(data) {
    const lines = [];
    if (data && data.outgoings) {
        data.outgoings.forEach(item => lines.push(item.name));
    }
    return lines;
}

/** Suggest a GL line — returns suggestion or empty string */
function suggestGlLine(tx, mappings, budgetLines) {
    // Priority 1: exact merchant mapping from memory
    if (mappings[tx.merchant] && mappings[tx.merchant] !== '-- Per Transaction --') {
        return mappings[tx.merchant];
    }

    // Priority 2: NAB category mapping
    const categoryMap = {
        'Groceries': 'Groceries',
        'Fuel': 'Fuel',
        'Subscriptions': 'Streaming',
        'Phone & internet': 'Internet',
        'Gym & fitness': 'Lifestyle Spending',
        'Restaurants & takeaway': 'Lifestyle Spending',
        'Parking & tolls': 'Fuel',
        'Home improvements': 'Adhoc Spending',
        'Clothing': 'Lifestyle Spending',
        'Clothing & accessories': 'Lifestyle Spending',
        'Other shopping': '',  // Don't auto-assign — too broad
        'Refund': '-- Ignore --',
        'Internal transfers': '-- Ignore --',
    };

    const mapped = categoryMap[tx.category];
    if (mapped && (mapped === '-- Ignore --' || budgetLines.includes(mapped))) {
        return mapped;
    }

    return '';
}

/** Apply suggestions but don't lock them in — user must approve */
function autoSuggest(transactions, mappings, budgetLines) {
    transactions.forEach(tx => {
        tx.glLine = suggestGlLine(tx, mappings, budgetLines);
    });
}

/** Render the import tab — ALL transactions visible, filterable */
function renderImportTab(transactions, budgetData) {
    const preview = document.getElementById('import-preview');
    if (!transactions || transactions.length === 0) {
        preview.innerHTML = '<p class="dim">No transactions loaded. Upload a CSV file above.</p>';
        return;
    }

    const budgetLines = getBudgetLineNames(budgetData);
    const specialLines = ['-- Ignore --', '-- Other --'];
    const allLines = [...budgetLines, ...specialLines];

    const unassigned = transactions.filter(tx => !tx.glLine);
    const assigned = transactions.filter(tx => tx.glLine && tx.glLine !== '-- Ignore --');
    const ignored = transactions.filter(tx => tx.glLine === '-- Ignore --');

    const totalCharges = transactions.filter(t => !t.isRefund).reduce((s, t) => s + t.amount, 0);
    const totalRefunds = transactions.filter(t => t.isRefund).reduce((s, t) => s + t.amount, 0);

    let html = `<div class="import-summary">
        <span>${transactions.length} transactions</span>
        <span>Net: ${fmtPlain(totalCharges - totalRefunds)}</span>
        <span class="positive">${assigned.length} assigned</span>
        <span class="negative">${unassigned.length} unassigned</span>
        <span class="dim">${ignored.length} ignored</span>
        <button id="apply-to-planner" class="add-revision-btn" style="margin-left:auto;" ${unassigned.length === transactions.length ? 'disabled' : ''}>Apply to Planner</button>
    </div>`;

    html += `<div class="import-filters">
        <button class="import-filter-btn" data-filter="all">All (${transactions.length})</button>
        <button class="import-filter-btn active" data-filter="unassigned">Unassigned (${unassigned.length})</button>
        <button class="import-filter-btn" data-filter="assigned">Assigned (${assigned.length})</button>
        <button class="import-filter-btn" data-filter="ignored">Ignored (${ignored.length})</button>
    </div>`;

    html += `<div class="import-table-wrap"><table class="import-table"><thead><tr>
        <th>Date</th><th>Merchant</th><th>Details</th><th>Amount</th><th>NAB Category</th><th>Budget Line</th>
    </tr></thead><tbody>`;

    transactions.forEach((tx, globalIdx) => {
        const group = tx.glLine ? (tx.glLine === '-- Ignore --' ? 'ignored' : 'assigned') : 'unassigned';
        const isHidden = group !== 'unassigned'; // default filter is unassigned

        const opts = allLines.map(l =>
            `<option value="${l}" ${tx.glLine === l ? 'selected' : ''}>${l}</option>`
        ).join('');

        html += `<tr class="${tx.isRefund ? 'refund-row' : ''}" data-filter-group="${group}" ${isHidden ? 'style="display:none"' : ''}>
            <td class="import-date">${tx.dateStr}</td>
            <td class="import-merchant">${tx.merchant}</td>
            <td class="import-details" title="${tx.details}">${tx.details}</td>
            <td class="import-amount ${tx.isRefund ? 'positive' : 'negative'}">${tx.isRefund ? '+' : ''}${fmtPlain(tx.amount)}</td>
            <td class="import-category">${tx.category}</td>
            <td><select class="gl-select" data-tx-index="${globalIdx}">
                <option value="">-- Assign --</option>
                ${opts}
            </select></td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    preview.innerHTML = html;
}

/** Group assigned transactions by budget line and week */
function groupByLineAndWeek(transactions) {
    const groups = {};

    transactions.forEach(tx => {
        if (!tx.glLine || tx.glLine === '-- Ignore --' || tx.glLine === '-- Other --') return;
        const weekIdx = getWeekIndex(tx.date);
        if (!groups[tx.glLine]) groups[tx.glLine] = {};
        if (!groups[tx.glLine][weekIdx]) groups[tx.glLine][weekIdx] = { total: 0, charges: [] };
        const sign = tx.isRefund ? -1 : 1;
        groups[tx.glLine][weekIdx].total += tx.amount * sign;
        groups[tx.glLine][weekIdx].charges.push(
            `${tx.dateStr} ${tx.merchant} ${tx.isRefund ? '+' : '-'}$${tx.amount.toFixed(2)}`
        );
    });

    return groups;
}

/** Apply grouped transactions to weekActuals */
function applyToPlanner(transactions, weekActuals) {
    const groups = groupByLineAndWeek(transactions);

    for (const [lineName, weeks] of Object.entries(groups)) {
        for (const [weekIdx, data] of Object.entries(weeks)) {
            const w = parseInt(weekIdx);
            if (!weekActuals[w]) weekActuals[w] = { items: {}, contributions: {} };
            if (!weekActuals[w].items) weekActuals[w].items = {};

            weekActuals[w].items[lineName] = {
                actual: data.total,
                status: 'adjusted',
                comment: data.charges.join('\n'),
            };
        }
    }

    return weekActuals;
}
