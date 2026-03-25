/**
 * Planner — week-by-week confirmation & reconciliation view.
 */

let currentWeekIdx = 0;
let realCurrentWeek = 0;
let weekDates = [];
let allSchedules = null;

function initPlanner(budgetData, weekActuals) {
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
    buildWeekStrip(weekActuals);
    renderWeek(budgetData, weekActuals);
}

// ── Schedule computation ──

function calcPaymentSchedule(item, weekDates) {
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

function buildWeekStrip(weekActuals) {
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
            onWeekChange(window._budgetData, weekActuals);
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

function renderWeek(budgetData, weekActuals) {
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
        tbody.appendChild(buildItemRow(item, schedule, weekIdx, wa, weekActuals, false));
    });

    if (notDue.length > 0 && due.length > 0) {
        // Separator
        const sep = document.createElement('tr');
        sep.className = 'separator-row';
        sep.innerHTML = '<td colspan="8" class="separator-cell">Not due this week</td>';
        tbody.appendChild(sep);
    }

    notDue.forEach(({ item, schedule }) => {
        tbody.appendChild(buildItemRow(item, schedule, weekIdx, wa, weekActuals, true));
    });

    table.appendChild(tbody);
    card.appendChild(table);
    return card;
}

function buildItemRow(item, schedule, weekIdx, wa, weekActuals, isDimmed) {
    const expected = schedule[weekIdx];
    const saved = wa.items?.[item.name];
    const actual = saved ? saved.actual : expected;
    const status = expected === 0 && !saved ? 'none' : (saved ? saved.status : 'pending');
    const comment = saved ? (saved.comment || '') : '';
    const wkVar = actual - expected;
    const isDue = expected > 0;

    const ytd = computeYtdVariance(item.name, 'items', weekIdx, allSchedules, weekActuals);

    const tr = document.createElement('tr');
    if (isDimmed) tr.className = 'not-due';
    tr.innerHTML = `
        <td class="col-item">${item.name}</td>
        <td class="col-cycle">${item.cycle}</td>
        <td class="col-amount">${fmt(expected)}</td>
        <td class="col-amount">
            ${isDue ? `<input class="actual-input" type="text" value="${fmtPlain(actual)}"
                data-item="${esc(item.name)}" data-type="items" data-expected="${expected}" data-week="${weekIdx}">` : ''}
        </td>
        <td class="col-variance ${wkVar > 0 ? 'negative' : wkVar < 0 ? 'positive' : ''}">${isDue && wkVar !== 0 ? fmtSigned(wkVar) : '—'}</td>
        <td class="col-variance ${ytd.ytdVariance > 0 ? 'negative' : ytd.ytdVariance < 0 ? 'positive' : ''}">${ytd.ytdVariance !== 0 ? fmtSigned(ytd.ytdVariance) : '—'}</td>
        <td class="col-status">
            ${isDue ? `<button class="status-btn status-${status}" data-item="${esc(item.name)}" data-type="items" data-week="${weekIdx}"
                title="Click to confirm">${statusLabel(status)}</button>` : ''}
        </td>
        <td class="col-comment">
            ${isDue ? `<textarea class="comment-input" rows="1" placeholder="Charges..."
                data-item="${esc(item.name)}" data-type="items" data-week="${weekIdx}">${esc(comment)}</textarea>` : ''}
        </td>
    `;
    return tr;
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
        const actual = saved ? saved.actual : expected;
        const status = expected === 0 && !saved ? 'none' : (saved ? saved.status : 'pending');
        const comment = saved ? (saved.comment || '') : '';
        const wkVar = actual - expected;

        const ytd = computeYtdVariance(item.name, 'contributions', weekIdx, allSchedules, weekActuals);
        const isDue = expected > 0;

        const tr = document.createElement('tr');
        tr.className = 'contribution-row' + (isDue ? '' : ' not-due');
        tr.innerHTML = `
            <td class="col-item">${item.name}</td>
            <td class="col-cycle">${item.cycle}</td>
            <td class="col-amount">${fmt(expected)}</td>
            <td class="col-amount">
                ${isDue ? `<input class="actual-input" type="text" value="${fmtPlain(actual)}"
                    data-item="${esc(item.name)}" data-type="contributions" data-expected="${expected}" data-week="${weekIdx}">` : fmt(0)}
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
    });
    table.appendChild(tbody);
    card.appendChild(table);
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
