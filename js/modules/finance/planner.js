/**
 * Planner — week-by-week confirmation & reconciliation view.
 */

import {
    getWeekDates, getCurrentWeekIndex, getEffectiveWeekly, cycleToPeriodAmount,
    fmt, fmtPlain, fmtSigned,
    parseCurrency, saveBudgetCY, saveWeekActuals,
    sumCharges, makeCharge,
} from '../../data.js';
import { state } from '../../state.js';

let currentWeekIdx = 0;
let realCurrentWeek = 0;
export let weekDates = [];
export let allSchedules = null;

// Open charge-detail rows survive re-renders within the same week.
// Keys: `${type}|${itemName}` (e.g. "items|Power", "contributions|Brad Regular").
// Cleared by week change so each week starts collapsed.
const openChargeDetails = new Set();

export function initPlanner(budgetData, weekActuals) {
    const year = budgetData.year || 2026;
    weekDates = getWeekDates(year);
    realCurrentWeek = getCurrentWeekIndex(year);
    currentWeekIdx = realCurrentWeek;
    allSchedules = computeAllSchedules(budgetData, weekDates);

    buildWeekSelector();
    buildWeekStrip(weekActuals);
    renderWeek(budgetData, weekActuals);

    document.getElementById('week-prev').onclick = () => {
        if (currentWeekIdx > 0) { currentWeekIdx--; onWeekChange(budgetData, weekActuals); }
    };
    document.getElementById('week-next').onclick = () => {
        if (currentWeekIdx < 51) { currentWeekIdx++; onWeekChange(budgetData, weekActuals); }
    };
    document.getElementById('week-today').onclick = () => {
        currentWeekIdx = realCurrentWeek;
        onWeekChange(budgetData, weekActuals);
    };
    document.getElementById('week-select').onchange = (e) => {
        currentWeekIdx = parseInt(e.target.value);
        onWeekChange(budgetData, weekActuals);
    };
}

function onWeekChange(budgetData, weekActuals) {
    document.getElementById('week-select').value = currentWeekIdx;
    openChargeDetails.clear();
    buildWeekStrip(weekActuals);
    renderWeek(budgetData, weekActuals);
}

// ── Schedule computation ──

export function calcPaymentSchedule(item, weekDates) {
    const payments = new Array(52).fill(0);
    const firstPay = new Date(item.firstPayment + 'T00:00:00');
    const year = weekDates[0].getFullYear();
    const hasRevisions = item.revisions && item.revisions.length > 0;

    // Helper: get the period amount effective at a given date
    function amountAt(date) {
        const w = hasRevisions ? getEffectiveWeekly(item, date) : item.weekly;
        return cycleToPeriodAmount(w, item.cycle);
    }

    // Check if base rate is zero AND no revisions have a non-zero rate
    const anyNonZero = item.weekly !== 0 || (hasRevisions && item.revisions.some(r => r.weekly !== 0));
    if (!anyNonZero) return payments;

    switch (item.cycle) {
        case 'Weekly':
            for (let w = 0; w < 52; w++) {
                if (weekDates[w] >= firstPay) payments[w] = amountAt(weekDates[w]);
            }
            break;
        case 'Fortnightly': {
            let start = -1;
            for (let w = 0; w < 52; w++) {
                if (weekDates[w] >= firstPay) { start = w; break; }
            }
            if (start >= 0) {
                for (let w = start; w < 52; w += 2) payments[w] = amountAt(weekDates[w]);
            }
            break;
        }
        case 'Monthly':
            for (let m = 0; m < 12; m++) {
                const pd = new Date(year, m, firstPay.getDate());
                if (pd < firstPay) continue;
                placeInWeekWithAmount(pd, amountAt(pd), payments, weekDates);
            }
            break;
        case 'Bi-Monthly':
            for (let m = 0; m < 12; m += 2) {
                const pd = new Date(year, firstPay.getMonth() + m, firstPay.getDate());
                if (pd.getFullYear() !== year || pd < firstPay) continue;
                placeInWeekWithAmount(pd, amountAt(pd), payments, weekDates);
            }
            break;
        case 'Quarterly':
            for (let q = 0; q < 4; q++) {
                const pd = new Date(year, firstPay.getMonth() + q * 3, firstPay.getDate());
                if (pd.getFullYear() !== year || pd < firstPay) continue;
                placeInWeekWithAmount(pd, amountAt(pd), payments, weekDates);
            }
            break;
        case 'Bi-Annually':
            for (let h = 0; h < 2; h++) {
                const pd = new Date(year, firstPay.getMonth() + h * 6, firstPay.getDate());
                if (pd.getFullYear() !== year || pd < firstPay) continue;
                placeInWeekWithAmount(pd, amountAt(pd), payments, weekDates);
            }
            break;
        case 'Annually':
            placeInWeekWithAmount(firstPay, amountAt(firstPay), payments, weekDates);
            break;
    }
    return payments;
}

function placeInWeekWithAmount(date, amount, payments, weekDates) {
    for (let w = 0; w < 52; w++) {
        const end = new Date(weekDates[w]);
        end.setDate(end.getDate() + 6);
        if (date >= weekDates[w] && date <= end) {
            payments[w] = amount;
            return;
        }
    }
}

function computeAllSchedules(data, weekDates) {
    const primary = data.outgoings.slice(0, data.primaryCount);
    const secondary = data.outgoings.slice(data.primaryCount);
    const contribItems = data.contributionItems || [];

    return {
        primary: primary.map(item => ({ item, schedule: calcPaymentSchedule(item, weekDates) })),
        secondary: secondary.map(item => ({ item, schedule: calcPaymentSchedule(item, weekDates) })),
        contributions: contribItems.map(item => ({ item, schedule: calcPaymentSchedule(item, weekDates) })),
    };
}

// ── YTD variance computation per item ──

function computeYtdVariance(itemName, type, upToWeek, schedules, weekActuals) {
    const list = type === 'contributions' ? schedules.contributions :
                 [...schedules.primary, ...schedules.secondary];
    const match = list.find(s => s.item.name === itemName);
    if (!match) return { ytdExpected: 0, ytdActual: 0, ytdVariance: 0 };

    let ytdExpected = 0, ytdActual = 0;
    for (let w = 0; w <= upToWeek; w++) {
        const exp = match.schedule[w];
        if (exp > 0) {
            ytdExpected += exp;
            const wa = weekActuals[w];
            const bucket = type === 'contributions' ? wa?.contributions : wa?.items;
            const saved = bucket?.[itemName];
            ytdActual += saved ? saved.actual : exp;
        }
    }
    return { ytdExpected, ytdActual, ytdVariance: ytdActual - ytdExpected };
}

// ── Week strip (52 mini cells) ──

export function buildWeekStrip(weekActuals) {
    const strip = document.getElementById('week-strip');
    strip.innerHTML = '';
    for (let w = 0; w < 52; w++) {
        const cell = document.createElement('div');
        cell.className = 'strip-cell';
        cell.title = `Week ${w + 1}: ${formatDateShort(weekDates[w])}`;

        const status = getWeekStatus(w, weekActuals);
        cell.classList.add('strip-' + status);
        if (w === currentWeekIdx) cell.classList.add('strip-active');
        if (w === realCurrentWeek) cell.classList.add('strip-current');

        cell.onclick = () => {
            currentWeekIdx = w;
            onWeekChange(state.budgetCY, weekActuals);
        };
        strip.appendChild(cell);
    }
}

function getWeekStatus(weekIdx, weekActuals) {
    const wa = weekActuals[weekIdx];
    const allItems = [...allSchedules.primary, ...allSchedules.secondary, ...allSchedules.contributions];
    let hasDue = false;
    let allConfirmed = true;
    let hasVariance = false;

    allItems.forEach(({ item, schedule }) => {
        if (schedule[weekIdx] <= 0) return;
        hasDue = true;
        const key = item.name;
        const actual = wa?.items?.[key] || wa?.contributions?.[key];
        if (!actual || actual.status === 'pending') allConfirmed = false;
        if (actual && actual.status === 'adjusted') hasVariance = true;
    });

    if (!hasDue) return 'empty';
    if (hasVariance) return 'variance';
    if (allConfirmed) return 'confirmed';
    return 'pending';
}

// ── Week selector dropdown ──

function buildWeekSelector() {
    const sel = document.getElementById('week-select');
    sel.innerHTML = '';
    for (let w = 0; w < 52; w++) {
        const d = weekDates[w];
        const end = new Date(d);
        end.setDate(end.getDate() + 6);
        const opt = document.createElement('option');
        opt.value = w;
        const marker = w === realCurrentWeek ? ' (current)' : '';
        opt.textContent = `Week ${w + 1}: ${formatDateMed(d)} – ${formatDateMed(end)}${marker}`;
        if (w === currentWeekIdx) opt.selected = true;
        sel.appendChild(opt);
    }
}

// ── Render a single week ──

export function renderWeek(budgetData, weekActuals) {
    const w = currentWeekIdx;
    const isCurrentWeek = (w === realCurrentWeek);
    const isPast = (w < realCurrentWeek);
    const wa = weekActuals[w] || { items: {}, contributions: {} };

    // Primary account balance (actual figure, not computed)
    const acctBalance = budgetData.primaryAccountBalance || 0;

    // Projected balance: account balance + future net (contributions - liabilities) from this week forward
    const projectedNet = computeProjectedNet(weekActuals, w);
    const minFwdBalance = computeMinForwardBalance(weekActuals, w, acctBalance);

    // YTD totals
    let ytdExpected = 0, ytdActual = 0;
    for (let wk = 0; wk <= w; wk++) {
        const weekWa = weekActuals[wk] || { items: {}, contributions: {} };
        [...allSchedules.primary, ...allSchedules.secondary].forEach(({ item, schedule }) => {
            if (schedule[wk] > 0) {
                ytdExpected += schedule[wk];
                const a = weekWa.items?.[item.name];
                ytdActual += a ? a.actual : schedule[wk];
            }
        });
    }

    // Brad Savings running total
    const bradSavings = computeBradSavings(weekActuals, w);

    // Summary bar
    const summaryEl = document.getElementById('planner-summary');
    const weekLabel = isCurrentWeek ? '<span class="current-week-badge">CURRENT WEEK</span>' : isPast ? '<span class="past-week-badge">PAST</span>' : '';
    summaryEl.innerHTML = `
        <div class="summary-item">
            <span class="summary-label">Primary Account ${weekLabel}</span>
            <span class="summary-value">
                <input class="acct-balance-input" type="text" value="${fmtPlain(acctBalance)}"
                    id="primary-acct-balance">
            </span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Min Forward Balance</span>
            <span class="summary-value ${minFwdBalance >= 0 ? 'positive' : 'negative'}">${fmtSigned(minFwdBalance)}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">YTD Budget</span>
            <span class="summary-value">${fmt(ytdExpected)}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">YTD Actual</span>
            <span class="summary-value ${Math.abs(ytdActual - ytdExpected) > 1 ? (ytdActual > ytdExpected ? 'negative' : 'positive') : ''}">${fmt(ytdActual)}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Brad Savings (YTD)</span>
            <span class="summary-value positive">${fmt(bradSavings)}</span>
        </div>
    `;

    // Content
    const content = document.getElementById('planner-content');
    content.innerHTML = '';

    // Primary liabilities — due items first, then zero items
    content.appendChild(buildSection('Primary Liabilities', 'primary', allSchedules.primary, w, wa, weekActuals));

    // Secondary liabilities — due items first, then zero items
    content.appendChild(buildSection('Secondary Liabilities', 'secondary', allSchedules.secondary, w, wa, weekActuals));

    // Contributions — all items always shown
    content.appendChild(buildContribSection(allSchedules.contributions, w, wa, weekActuals));

    // Week summary card
    const primaryDue = allSchedules.primary.filter(s => s.schedule[w] > 0);
    const secondaryDue = allSchedules.secondary.filter(s => s.schedule[w] > 0);
    const allLiabDue = [...primaryDue, ...secondaryDue];
    const weekExpTotal = allLiabDue.reduce((s, d) => s + d.schedule[w], 0);
    const weekActTotal = allLiabDue.reduce((s, d) => {
        const a = wa.items?.[d.item.name];
        return s + (a ? a.actual : d.schedule[w]);
    }, 0);
    const weekVariance = weekActTotal - weekExpTotal;

    const ytdVar = ytdActual - ytdExpected;

    const contribExpTotal = allSchedules.contributions.reduce((s, d) => s + d.schedule[w], 0);
    const contribActTotal = allSchedules.contributions.reduce((s, d) => {
        const a = wa.contributions?.[d.item.name];
        return s + (a ? a.actual : d.schedule[w]);
    }, 0);

    const summaryCard = document.createElement('div');
    summaryCard.className = 'section-card week-summary-card';
    summaryCard.innerHTML = `
        <h3 class="section-header" style="background:var(--surface2);color:var(--text);">Week Summary</h3>
        <div class="week-summary-grid">
            <div><span class="dim">Liabilities Expected</span><span class="negative">${fmt(weekExpTotal)}</span></div>
            <div><span class="dim">Liabilities Actual</span><span class="negative">${fmt(weekActTotal)}</span></div>
            <div><span class="dim">Week Variance</span><span class="${weekVariance > 0 ? 'negative' : weekVariance < 0 ? 'positive' : ''}">${fmtSigned(weekVariance)}</span></div>
            <div><span class="dim">YTD Variance</span><span class="${ytdVar > 0 ? 'negative' : ytdVar < 0 ? 'positive' : ''}">${fmtSigned(ytdVar)}</span></div>
            <div><span class="dim">Contributions</span><span class="positive">${fmt(contribActTotal)}</span></div>
            <div><span class="dim">Week Net</span><span class="${(contribActTotal - weekActTotal) >= 0 ? 'positive' : 'negative'}">${fmtSigned(contribActTotal - weekActTotal)}</span></div>
        </div>
    `;
    content.appendChild(summaryCard);
}

// ── Section builders ──

function buildSection(title, type, allItems, weekIdx, wa, weekActuals) {
    const card = document.createElement('div');
    card.className = 'section-card';
    const bg = type === 'primary' ? 'rgba(0,176,240,0.12)' : 'rgba(112,48,160,0.12)';
    const color = type === 'primary' ? 'var(--accent)' : 'var(--purple)';
    card.innerHTML = `<h3 class="section-header" style="background:${bg};color:${color};">${title}</h3>`;

    const table = document.createElement('table');
    table.className = 'planner-week-table';
    table.innerHTML = `
        <thead><tr>
            <th class="col-item">Item</th>
            <th class="col-cycle">Cycle</th>
            <th class="col-amount">Expected</th>
            <th class="col-amount">Actual</th>
            <th class="col-variance">Wk Var</th>
            <th class="col-variance">YTD Var</th>
            <th class="col-status"></th>
            <th class="col-comment">Comment</th>
        </tr></thead>
    `;

    // Sort: due items first, then zero items
    const due = allItems.filter(s => s.schedule[weekIdx] > 0);
    const notDue = allItems.filter(s => s.schedule[weekIdx] <= 0);

    const tbody = document.createElement('tbody');

    due.forEach(({ item, schedule }) => {
        buildItemRow(item, schedule, weekIdx, wa, weekActuals, false)
            .forEach(r => tbody.appendChild(r));
    });

    if (notDue.length > 0 && due.length > 0) {
        // Separator
        const sep = document.createElement('tr');
        sep.className = 'separator-row';
        sep.innerHTML = '<td colspan="8" class="separator-cell">Not due this week</td>';
        tbody.appendChild(sep);
    }

    notDue.forEach(({ item, schedule }) => {
        buildItemRow(item, schedule, weekIdx, wa, weekActuals, true)
            .forEach(r => tbody.appendChild(r));
    });

    table.appendChild(tbody);
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    scroll.appendChild(table);
    card.appendChild(scroll);
    return card;
}

function buildItemRow(item, schedule, weekIdx, wa, weekActuals, isDimmed) {
    const expected = schedule[weekIdx];
    const saved = wa.items?.[item.name];
    const charges = saved?.charges || [];
    const hasCharges = charges.length > 0;
    const actual = hasCharges ? sumCharges(charges) : (saved ? saved.actual : expected);
    const status = expected === 0 && !saved ? 'none' : (saved ? saved.status : 'pending');
    const comment = saved ? (saved.comment || '') : '';
    const wkVar = actual - expected;
    const isDue = expected > 0;
    const detailOpen = openChargeDetails.has(`items|${item.name}`);

    const ytd = computeYtdVariance(item.name, 'items', weekIdx, allSchedules, weekActuals);

    const tr = document.createElement('tr');
    if (isDimmed) tr.className = 'not-due';
    tr.innerHTML = `
        <td class="col-item">
            ${isDue ? `<span class="expand-toggle planner-expand" title="${detailOpen ? 'Hide charges' : 'Show charges'}">${detailOpen ? '&#9660;' : '&#9654;'}</span>` : ''}
            ${item.name}
            ${hasCharges ? `<span class="charges-badge">${charges.length} charge${charges.length === 1 ? '' : 's'}</span>` : ''}
        </td>
        <td class="col-cycle">${item.cycle}</td>
        <td class="col-amount">${fmt(expected)}</td>
        <td class="col-amount">
            ${isDue
                ? (hasCharges
                    ? `<span class="actual-derived" title="Sum of charges below">${fmt(actual)}</span>`
                    : `<input class="actual-input" type="text" value="${fmtPlain(actual)}"
                        data-item="${esc(item.name)}" data-type="items" data-expected="${expected}" data-week="${weekIdx}">`)
                : ''}
        </td>
        <td class="col-variance ${wkVar > 0 ? 'negative' : wkVar < 0 ? 'positive' : ''}">${isDue && wkVar !== 0 ? fmtSigned(wkVar) : '—'}</td>
        <td class="col-variance ${ytd.ytdVariance > 0 ? 'negative' : ytd.ytdVariance < 0 ? 'positive' : ''}">${ytd.ytdVariance !== 0 ? fmtSigned(ytd.ytdVariance) : '—'}</td>
        <td class="col-status">
            ${isDue ? `<button class="status-btn status-${status}" data-item="${esc(item.name)}" data-type="items" data-week="${weekIdx}"
                title="Click to confirm">${statusLabel(status)}</button>` : ''}
        </td>
        <td class="col-comment">
            ${isDue ? `<textarea class="comment-input" rows="1" placeholder="Notes..."
                data-item="${esc(item.name)}" data-type="items" data-week="${weekIdx}">${esc(comment)}</textarea>` : ''}
        </td>
    `;

    const detailTr = buildChargesDetailRow(item.name, weekIdx, charges, 'items', isDue);
    if (isDimmed) detailTr.classList.add('not-due');
    return [tr, detailTr];
}

/**
 * Build the always-present (but hidden by default) detail row containing
 * the charges list + add-charge form. One detail row per main row; the
 * chevron in the main row toggles visibility.
 */
function buildChargesDetailRow(itemName, weekIdx, charges, type, isDue) {
    const tr = document.createElement('tr');
    tr.className = 'detail-row planner-detail-row';
    tr.dataset.detailKey = `${type}|${itemName}`;
    const open = openChargeDetails.has(`${type}|${itemName}`);
    tr.style.display = open ? 'table-row' : 'none';
    tr.innerHTML = `<td colspan="8">${chargesPanelHtml(itemName, weekIdx, charges, type, isDue)}</td>`;
    return tr;
}

function chargesPanelHtml(itemName, weekIdx, charges, type, isDue) {
    const today = new Date().toISOString().slice(0, 10);
    let html = '<div class="charges-panel">';

    if (charges.length > 0) {
        html += '<table class="charges-table"><thead><tr><th>Date</th><th>Payee</th><th class="charges-amount-col">Amount</th><th>Note</th><th></th></tr></thead><tbody>';
        charges.forEach(ch => {
            html += `<tr>
                <td>${esc(ch.date || '')}</td>
                <td>${esc(ch.payee || '')}</td>
                <td class="charges-amount-col">${fmt(ch.amount || 0)}</td>
                <td>${esc(ch.comment || '')}</td>
                <td><button class="charge-delete" title="Remove charge"
                    data-charge-id="${esc(ch.id)}" data-item="${esc(itemName)}" data-type="${type}" data-week="${weekIdx}">&times;</button></td>
            </tr>`;
        });
        html += '</tbody></table>';
    } else {
        html += '<div class="charges-empty">No charges yet. Add one below to populate this week’s actual.</div>';
    }

    if (isDue) {
        html += `<div class="charges-add" data-item="${esc(itemName)}" data-type="${type}" data-week="${weekIdx}">
            <input class="charge-input charge-date" type="date" value="${today}" title="Date">
            <input class="charge-input charge-payee" type="text" placeholder="Payee" title="Payee">
            <input class="charge-input charge-amount" type="text" placeholder="Amount" title="Amount">
            <input class="charge-input charge-comment" type="text" placeholder="Note (optional)" title="Note">
            <button class="charge-submit">+ Add charge</button>
        </div>`;
    }

    html += '</div>';
    return html;
}

function buildContribSection(allContribs, weekIdx, wa, weekActuals) {
    const card = document.createElement('div');
    card.className = 'section-card';
    card.innerHTML = `<h3 class="section-header" style="background:rgba(0,200,83,0.12);color:var(--green);">Contributions</h3>`;

    const table = document.createElement('table');
    table.className = 'planner-week-table';
    table.innerHTML = `
        <thead><tr>
            <th class="col-item">Source</th>
            <th class="col-cycle">Cycle</th>
            <th class="col-amount">Expected</th>
            <th class="col-amount">Actual</th>
            <th class="col-variance">Wk Var</th>
            <th class="col-variance">YTD Var</th>
            <th class="col-status"></th>
            <th class="col-comment">Comment</th>
        </tr></thead>
    `;

    const tbody = document.createElement('tbody');
    allContribs.forEach(({ item, schedule }) => {
        const expected = schedule[weekIdx]; // may be 0 if not due this week
        const saved = wa.contributions?.[item.name];
        const charges = saved?.charges || [];
        const hasCharges = charges.length > 0;
        const actual = hasCharges ? sumCharges(charges) : (saved ? saved.actual : expected);
        const status = expected === 0 && !saved ? 'none' : (saved ? saved.status : 'pending');
        const comment = saved ? (saved.comment || '') : '';
        const wkVar = actual - expected;

        const ytd = computeYtdVariance(item.name, 'contributions', weekIdx, allSchedules, weekActuals);
        const isDue = expected > 0;
        const detailOpen = openChargeDetails.has(`contributions|${item.name}`);

        const tr = document.createElement('tr');
        tr.className = 'contribution-row' + (isDue ? '' : ' not-due');
        tr.innerHTML = `
            <td class="col-item">
                ${isDue ? `<span class="expand-toggle planner-expand" title="${detailOpen ? 'Hide charges' : 'Show charges'}">${detailOpen ? '&#9660;' : '&#9654;'}</span>` : ''}
                ${item.name}
                ${hasCharges ? `<span class="charges-badge">${charges.length} charge${charges.length === 1 ? '' : 's'}</span>` : ''}
            </td>
            <td class="col-cycle">${item.cycle}</td>
            <td class="col-amount">${fmt(expected)}</td>
            <td class="col-amount">
                ${isDue
                    ? (hasCharges
                        ? `<span class="actual-derived" title="Sum of charges below">${fmt(actual)}</span>`
                        : `<input class="actual-input" type="text" value="${fmtPlain(actual)}"
                            data-item="${esc(item.name)}" data-type="contributions" data-expected="${expected}" data-week="${weekIdx}">`)
                    : fmt(0)}
            </td>
            <td class="col-variance ${wkVar > 0 ? 'positive' : wkVar < 0 ? 'negative' : ''}">${wkVar !== 0 ? fmtSigned(wkVar) : '—'}</td>
            <td class="col-variance ${ytd.ytdVariance > 0 ? 'positive' : ytd.ytdVariance < 0 ? 'negative' : ''}">${ytd.ytdVariance !== 0 ? fmtSigned(ytd.ytdVariance) : '—'}</td>
            <td class="col-status">
                ${isDue ? `<button class="status-btn status-${status}" data-item="${esc(item.name)}" data-type="contributions" data-week="${weekIdx}"
                    title="Click to confirm">${statusLabel(status)}</button>` : '<span class="dim">—</span>'}
            </td>
            <td class="col-comment">
                ${isDue ? `<textarea class="comment-input" rows="1" placeholder="Note..."
                    data-item="${esc(item.name)}" data-type="contributions" data-week="${weekIdx}">${esc(comment)}</textarea>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
        const detailTr = buildChargesDetailRow(item.name, weekIdx, charges, 'contributions', isDue);
        if (!isDue) detailTr.classList.add('not-due');
        tbody.appendChild(detailTr);
    });
    table.appendChild(tbody);
    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    scroll.appendChild(table);
    card.appendChild(scroll);
    return card;
}

function statusLabel(status) {
    switch (status) {
        case 'confirmed': return '&#10003;';
        case 'adjusted': return '&#9998;';
        default: return '&#8226;';
    }
}

// ── Brad Savings tracking ──

function computeBradSavings(weekActuals, upToWeek) {
    // Savings - Brad is outgoings[0] (P1)
    const savingsSchedule = allSchedules.primary.find(s => s.item.name === 'Savings - Brad');
    if (!savingsSchedule) return 0;

    let total = 0;
    for (let w = 0; w <= upToWeek; w++) {
        const exp = savingsSchedule.schedule[w];
        if (exp > 0) {
            const wa = weekActuals[w];
            const saved = wa?.items?.['Savings - Brad'];
            total += saved ? saved.actual : exp;
        }
    }
    return total;
}

// ── Projected balance from primary account ──

/** Net cashflow for a single week (contributions - liabilities) */
function weekNet(weekIdx, weekActuals) {
    const wa = weekActuals[weekIdx] || { items: {}, contributions: {} };

    let liabilities = 0;
    [...allSchedules.primary, ...allSchedules.secondary].forEach(({ item, schedule }) => {
        if (schedule[weekIdx] > 0) {
            const saved = wa.items?.[item.name];
            liabilities += saved ? saved.actual : schedule[weekIdx];
        }
    });

    let contributions = 0;
    allSchedules.contributions.forEach(({ item, schedule }) => {
        if (schedule[weekIdx] > 0) {
            const saved = wa.contributions?.[item.name];
            contributions += saved ? saved.actual : schedule[weekIdx];
        }
    });

    return contributions - liabilities;
}

/** Sum of projected net from fromWeek onward */
function computeProjectedNet(weekActuals, fromWeek) {
    let net = 0;
    for (let w = fromWeek; w < 52; w++) {
        net += weekNet(w, weekActuals);
    }
    return net;
}

/** Min projected balance from fromWeek onward, starting from account balance */
function computeMinForwardBalance(weekActuals, fromWeek, accountBalance) {
    let running = accountBalance;
    let min = running;
    for (let w = fromWeek; w < 52; w++) {
        running += weekNet(w, weekActuals);
        if (running < min) min = running;
    }
    return min;
}

// ── Helpers ──

function formatDateShort(d) {
    return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatDateMed(d) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
}

function esc(str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Editing wiring (moved from app.js during module-shell refactor) ──

export function setupPlannerEditing() {
    const planner = document.getElementById('planner');
    if (!planner) return;

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
            bucket[itemName] = { actual: expected, status: 'confirmed', comment: '', charges: [] };
        } else {
            bucket[itemName].status = bucket[itemName].status === 'confirmed' ? 'pending' : 'confirmed';
            // Don't clobber actual when the row is being driven by charges.
            if (bucket[itemName].status === 'confirmed' && !(bucket[itemName].charges && bucket[itemName].charges.length > 0)) {
                bucket[itemName].actual = expected;
            }
        }

        saveWeekActuals(state.weekActuals);
        renderWeek(state.budgetCY, state.weekActuals);
        buildWeekStrip(state.weekActuals);
    });

    // Charge detail expand/collapse
    planner.addEventListener('click', (e) => {
        const toggle = e.target.closest('.planner-expand');
        if (!toggle) return;
        const mainTr = toggle.closest('tr');
        if (!mainTr) return;
        const detailTr = mainTr.nextElementSibling;
        if (!detailTr || !detailTr.classList.contains('planner-detail-row')) return;
        const key = detailTr.dataset.detailKey;
        const wasOpen = detailTr.style.display !== 'none';
        detailTr.style.display = wasOpen ? 'none' : 'table-row';
        toggle.innerHTML = wasOpen ? '&#9654;' : '&#9660;';
        toggle.title = wasOpen ? 'Show charges' : 'Hide charges';
        if (wasOpen) openChargeDetails.delete(key);
        else openChargeDetails.add(key);
    });

    // Add a charge
    planner.addEventListener('click', (e) => {
        const submit = e.target.closest('.charge-submit');
        if (!submit) return;
        const form = submit.closest('.charges-add');
        if (!form) return;
        const itemName = form.dataset.item;
        const type = form.dataset.type;
        const weekIdx = parseInt(form.dataset.week);
        const date = form.querySelector('.charge-date').value;
        const amountStr = form.querySelector('.charge-amount').value;
        const amount = parseCurrency(amountStr);
        if (!date || amount <= 0) {
            // Inline silent reject — focus the amount field if invalid.
            form.querySelector('.charge-amount').focus();
            return;
        }
        const payee = form.querySelector('.charge-payee').value;
        const comment = form.querySelector('.charge-comment').value;

        ensureWeekActual(weekIdx);
        const bucket = state.weekActuals[weekIdx][type];
        if (!bucket[itemName]) {
            bucket[itemName] = { actual: 0, status: 'pending', comment: '', charges: [] };
        }
        if (!Array.isArray(bucket[itemName].charges)) bucket[itemName].charges = [];
        bucket[itemName].charges.push(makeCharge({ date, amount, payee, comment }));
        recomputeFromCharges(bucket[itemName], weekIdx, itemName, type);

        openChargeDetails.add(`${type}|${itemName}`);
        saveWeekActuals(state.weekActuals);
        renderWeek(state.budgetCY, state.weekActuals);
        buildWeekStrip(state.weekActuals);
    });

    // Delete a charge
    planner.addEventListener('click', (e) => {
        const del = e.target.closest('.charge-delete');
        if (!del) return;
        const itemName = del.dataset.item;
        const type = del.dataset.type;
        const weekIdx = parseInt(del.dataset.week);
        const chargeId = del.dataset.chargeId;

        const bucket = state.weekActuals[weekIdx]?.[type];
        const entry = bucket?.[itemName];
        if (!entry || !Array.isArray(entry.charges)) return;
        entry.charges = entry.charges.filter(c => c.id !== chargeId);
        recomputeFromCharges(entry, weekIdx, itemName, type);

        openChargeDetails.add(`${type}|${itemName}`);
        saveWeekActuals(state.weekActuals);
        renderWeek(state.budgetCY, state.weekActuals);
        buildWeekStrip(state.weekActuals);
    });
}

/**
 * Sync `actual` and `status` on a bucket entry to its charges. If charges
 * is empty, snap `actual` back to the scheduled expected and clear to
 * pending. Otherwise actual = sumCharges and status reflects the
 * |actual - expected| < 0.01 rule used by the manual input flow.
 */
function recomputeFromCharges(entry, weekIdx, itemName, type) {
    const allItems = [...allSchedules.primary, ...allSchedules.secondary, ...allSchedules.contributions];
    const match = allItems.find(s => s.item.name === itemName);
    const expected = match ? match.schedule[weekIdx] : 0;
    const charges = Array.isArray(entry.charges) ? entry.charges : [];
    if (charges.length === 0) {
        entry.actual = expected;
        entry.status = 'pending';
        return;
    }
    const sum = sumCharges(charges);
    entry.actual = sum;
    entry.status = Math.abs(sum - expected) < 0.01 ? 'confirmed' : 'adjusted';
}

function ensureWeekActual(weekIdx) {
    if (!state.weekActuals[weekIdx]) {
        state.weekActuals[weekIdx] = { items: {}, contributions: {} };
    }
    if (!state.weekActuals[weekIdx].items) state.weekActuals[weekIdx].items = {};
    if (!state.weekActuals[weekIdx].contributions) state.weekActuals[weekIdx].contributions = {};
}
