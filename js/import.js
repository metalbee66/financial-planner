/**
 * Transaction import — parse CSV, present for review, assign to budget GL lines.
 */

import { getWeekDates, fmtPlain } from './data.js';
import { fbSave } from './firebase-sync.js';
import { state } from './state.js';

export function loadGlMappings() {
    const saved = localStorage.getItem('gl_mappings');
    if (saved) try { return JSON.parse(saved); } catch(e) {}
    return {};
}

export function saveGlMappings(m) {
    state.glMappings = m;
    fbSave('gl_mappings', m);
}

export function loadStoredHashes() {
    const saved = localStorage.getItem('imported_tx_hashes');
    if (saved) try { return new Set(JSON.parse(saved)); } catch(e) {}
    return new Set();
}

export function saveStoredHashes(hashes) {
    state.storedTransactionHashes = hashes;
    fbSave('imported_tx_hashes', [...hashes]);
}

/** Create a hash to identify a unique transaction */
function txHash(tx) {
    return `${tx.dateStr}|${tx.amount}|${tx.details}|${tx.account}`;
}

/**
 * Parse NAB credit card CSV.
 */
export function parseNabCsv(text) {
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

        const date = parseNabDate(dateStr);
        if (!date) continue;

        if (txType === 'CREDIT CARD PAYMENT') continue;

        // Source label from account
        const source = account.startsWith('Card ending') ? 'NAB CC ' + account.replace('Card ending ', '') : 'NAB';

        transactions.push({
            date,
            dateStr,
            amount: Math.abs(amount),
            isRefund: amount > 0,
            account,
            source,
            txType,
            details,
            category,
            merchant: merchant || details.substring(0, 30),
            glLine: '',
            isDuplicate: false,
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

/** Build grouped budget line options for the GL dropdown */
function buildGlOptions(data, selectedLine) {
    const primary = data.outgoings ? data.outgoings.slice(0, data.primaryCount || 18) : [];
    const secondary = data.outgoings ? data.outgoings.slice(data.primaryCount || 18) : [];
    const personal = ['Personal - Brad', 'Personal - Diana'];
    const special = ['-- Ignore --', '-- Other --'];

    let html = '<option value="">-- Assign --</option>';

    // Secondary first (most common for CC charges)
    html += '<optgroup label="Secondary Liabilities">';
    secondary.forEach(item => {
        html += `<option value="${item.name}" ${selectedLine === item.name ? 'selected' : ''}>${item.name}</option>`;
    });
    html += '</optgroup>';

    // Personal
    html += '<optgroup label="Personal">';
    personal.forEach(name => {
        html += `<option value="${name}" ${selectedLine === name ? 'selected' : ''}>${name}</option>`;
    });
    html += '</optgroup>';

    // Primary
    html += '<optgroup label="Primary Liabilities">';
    primary.forEach(item => {
        html += `<option value="${item.name}" ${selectedLine === item.name ? 'selected' : ''}>${item.name}</option>`;
    });
    html += '</optgroup>';

    // Special
    html += '<optgroup label="Other">';
    special.forEach(name => {
        html += `<option value="${name}" ${selectedLine === name ? 'selected' : ''}>${name}</option>`;
    });
    html += '</optgroup>';

    return html;
}

/** Get all valid budget line names (flat list for matching) */
export function getAllLineNames(data) {
    const lines = [];
    if (data && data.outgoings) data.outgoings.forEach(item => lines.push(item.name));
    lines.push('Personal - Brad', 'Personal - Diana', '-- Ignore --', '-- Other --');
    return lines;
}

/** Suggest a GL line */
function suggestGlLine(tx, mappings, allLines) {
    if (mappings[tx.merchant] && mappings[tx.merchant] !== '-- Per Transaction --') {
        return mappings[tx.merchant];
    }

    const categoryMap = {
        'Groceries': 'Groceries',
        'Fuel': 'Fuel',
        'Subscriptions': 'Streaming',
        'Phone & internet': 'Internet',
        'Gym & fitness': 'Lifestyle Spending',
        'Restaurants & takeaway': 'Lifestyle Spending',
        'Parking & tolls': 'Fuel',
        'Clothing': 'Lifestyle Spending',
        'Clothing & accessories': 'Lifestyle Spending',
        'Refund': '-- Ignore --',
        'Internal transfers': '-- Ignore --',
    };

    const mapped = categoryMap[tx.category];
    if (mapped && (mapped === '-- Ignore --' || allLines.includes(mapped))) {
        return mapped;
    }

    return '';
}

/** Auto-suggest and mark duplicates */
export function autoSuggest(transactions, mappings, allLines, storedHashes) {
    let dupCount = 0;
    transactions.forEach(tx => {
        tx.glLine = suggestGlLine(tx, mappings, allLines);
        // Check for duplicates
        const hash = txHash(tx);
        if (storedHashes.has(hash)) {
            tx.isDuplicate = true;
            tx.glLine = '-- Ignore --';
            dupCount++;
        }
    });
    return dupCount;
}

/** Render the import tab */
export function renderImportTab(transactions, budgetData, dupCount) {
    const preview = document.getElementById('import-preview');
    if (!transactions || transactions.length === 0) {
        preview.innerHTML = '<p class="dim">No transactions loaded. Upload a CSV file above.</p>';
        return;
    }

    const unassigned = transactions.filter(tx => !tx.glLine && !tx.isDuplicate);
    const assigned = transactions.filter(tx => tx.glLine && tx.glLine !== '-- Ignore --');
    const ignored = transactions.filter(tx => tx.glLine === '-- Ignore --');

    const totalCharges = transactions.filter(t => !t.isRefund && !t.isDuplicate).reduce((s, t) => s + t.amount, 0);
    const totalRefunds = transactions.filter(t => t.isRefund && !t.isDuplicate).reduce((s, t) => s + t.amount, 0);

    let html = `<div class="import-summary">
        <span>${transactions.length} transactions</span>
        <span>Net: ${fmtPlain(totalCharges - totalRefunds)}</span>
        <span class="positive">${assigned.length} assigned</span>
        <span class="negative">${unassigned.length} unassigned</span>
        <span class="dim">${ignored.length} ignored</span>
        ${dupCount > 0 ? `<span class="dim">(${dupCount} duplicates skipped)</span>` : ''}
        <button id="apply-to-planner" class="add-revision-btn" style="margin-left:auto;" ${assigned.length === 0 ? 'disabled' : ''}>Apply to Planner</button>
    </div>`;

    html += `<div class="import-filters">
        <button class="import-filter-btn active" data-filter="unassigned">Unassigned (${unassigned.length})</button>
        <button class="import-filter-btn" data-filter="assigned">Assigned (${assigned.length})</button>
        <button class="import-filter-btn" data-filter="all">All (${transactions.length})</button>
        <button class="import-filter-btn" data-filter="ignored">Ignored (${ignored.length})</button>
    </div>
    <div class="import-search-bar">
        <input type="text" id="import-search" class="import-search" placeholder="Search merchant, details, category...">
        <select id="import-search-line" class="import-search-select">
            <option value="">All budget lines</option>
            ${buildLineFilterOptions(transactions)}
        </select>
        <select id="import-search-source" class="import-search-select">
            <option value="">All sources</option>
            ${buildSourceFilterOptions(transactions)}
        </select>
        <button id="import-search-clear" class="import-search-clear">Clear</button>
    </div>`;

    html += `<div class="import-table-wrap"><table class="import-table"><thead><tr>
        <th>Date</th><th>Source</th><th>Merchant</th><th>Details</th><th>Amount</th><th>Category</th><th>Budget Line</th><th title="Remember this merchant mapping">Auto</th>
    </tr></thead><tbody>`;

    transactions.forEach((tx, globalIdx) => {
        const group = tx.isDuplicate ? 'ignored' : (tx.glLine ? (tx.glLine === '-- Ignore --' ? 'ignored' : 'assigned') : 'unassigned');
        const isHidden = group !== 'unassigned';

        const searchText = `${tx.merchant} ${tx.details} ${tx.category} ${tx.dateStr}`.toLowerCase();
        html += `<tr class="${tx.isRefund ? 'refund-row' : ''} ${tx.isDuplicate ? 'duplicate-row' : ''}" data-filter-group="${group}" data-search="${searchText}" data-source="${tx.source}" data-gl-line="${tx.glLine || ''}" ${isHidden ? 'style="display:none"' : ''}>
            <td class="import-date">${tx.dateStr}</td>
            <td class="import-source">${tx.source}</td>
            <td class="import-merchant">${tx.merchant}</td>
            <td class="import-details" title="${tx.details}">${tx.details}</td>
            <td class="import-amount ${tx.isRefund ? 'positive' : 'negative'}">${tx.isRefund ? '+' : ''}${fmtPlain(tx.amount)}</td>
            <td class="import-category">${tx.category}</td>
            <td>${tx.isDuplicate ? '<span class="dim">Duplicate</span>' : '<select class="gl-select" data-tx-index="' + globalIdx + '">' + buildGlOptions(budgetData, tx.glLine) + '</select>'}</td>
            <td>${tx.isDuplicate ? '' : '<input type="checkbox" class="remember-check" data-tx-index="' + globalIdx + '" ' + (state.glMappings[tx.merchant] ? 'checked' : '') + ' title="Remember ' + tx.merchant + '">'}</td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    preview.innerHTML = html;
}

/** Build unique budget line filter options from current transactions */
function buildLineFilterOptions(transactions) {
    const lines = new Set();
    transactions.forEach(tx => { if (tx.glLine && tx.glLine !== '') lines.add(tx.glLine); });
    return [...lines].sort().map(l => `<option value="${l}">${l}</option>`).join('');
}

/** Build unique source filter options */
function buildSourceFilterOptions(transactions) {
    const sources = new Set();
    transactions.forEach(tx => sources.add(tx.source));
    return [...sources].sort().map(s => `<option value="${s}">${s}</option>`).join('');
}

/** Render stored merchant→budget line mappings grouped by budget line */
export function renderMappings(mappings, budgetData) {
    const container = document.getElementById('mappings-content');
    if (!container) return;

    const entries = Object.entries(mappings);
    if (entries.length === 0) {
        container.innerHTML = '<p class="dim" style="font-size:0.8rem;">No merchant mappings yet. Assign transactions above and choose to remember them.</p>';
        return;
    }

    // Group by budget line
    const grouped = {};
    entries.forEach(([merchant, line]) => {
        if (!grouped[line]) grouped[line] = [];
        grouped[line].push(merchant);
    });

    // Sort groups: secondary lines first, then others
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
        if (a === '-- Ignore --') return 1;
        if (b === '-- Ignore --') return -1;
        return a.localeCompare(b);
    });

    let html = `<div class="mappings-summary dim" style="font-size:0.75rem;margin-bottom:10px;">${entries.length} merchants mapped to ${sortedKeys.length} budget lines</div>`;

    sortedKeys.forEach(line => {
        const merchants = grouped[line].sort();
        html += `<div class="mapping-group">
            <div class="mapping-line-header">${line} <span class="dim">(${merchants.length})</span></div>
            <div class="mapping-merchants">`;

        merchants.forEach(merchant => {
            html += `<span class="mapping-chip">
                ${merchant}
                <button class="mapping-delete" data-merchant="${merchant}" title="Remove mapping">&times;</button>
            </span>`;
        });

        html += '</div></div>';
    });

    container.innerHTML = html;
}

/** Group assigned transactions by budget line and week */
function groupByLineAndWeek(transactions) {
    const groups = {};

    transactions.forEach(tx => {
        if (!tx.glLine || tx.glLine === '-- Ignore --' || tx.glLine === '-- Other --' || tx.isDuplicate) return;
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

/** Apply grouped transactions to weekActuals and store hashes */
export function applyToPlanner(transactions, weekActuals) {
    const groups = groupByLineAndWeek(transactions);

    for (const [lineName, weeks] of Object.entries(groups)) {
        for (const [weekIdx, data] of Object.entries(weeks)) {
            const w = parseInt(weekIdx);
            if (!weekActuals[w]) weekActuals[w] = { items: {}, contributions: {} };
            if (!weekActuals[w].items) weekActuals[w].items = {};

            const existing = weekActuals[w].items[lineName];
            if (existing) {
                // Merge with existing
                existing.actual = data.total;
                existing.status = 'adjusted';
                existing.comment = data.charges.join('\n');
            } else {
                weekActuals[w].items[lineName] = {
                    actual: data.total,
                    status: 'adjusted',
                    comment: data.charges.join('\n'),
                };
            }
        }
    }

    // Store transaction hashes to prevent future duplicates
    const newHashes = new Set(state.storedTransactionHashes);
    transactions.forEach(tx => {
        if (!tx.isDuplicate && tx.glLine && tx.glLine !== '-- Ignore --') {
            newHashes.add(txHash(tx));
        }
    });
    saveStoredHashes(newHashes);

    return weekActuals;
}
