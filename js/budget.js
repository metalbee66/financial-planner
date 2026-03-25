/**
 * Budget tab rendering — parameterised by year key prefix.
 */

function renderBudgetTab(data, prefix) {
    migrateBudget(data);
    renderIncome(data, prefix);
    renderBonuses(data, prefix);
    renderOutgoings(data, prefix);
    renderSplit(data, prefix);
    renderResidual(data, prefix);
}

// ── Income (with expandable revisions) ──

function renderIncome(data, pfx) {
    const tbody = document.getElementById(pfx + 'income-body');
    tbody.innerHTML = '';
    let totW = 0, totM = 0, totQ = 0, totA = 0;

    data.income.forEach((item, i) => {
        migrateItem(item);
        const w = getCurrentWeekly(item);
        const m = weeklyToMonthly(w);
        const q = weeklyToQuarterly(w);
        const a = weeklyToAnnual(w);
        totW += w; totM += m; totQ += q; totA += a;

        const hasDetail = (item.revisions && item.revisions.length > 0) || (item.comment && item.comment.trim());

        const tr = el('tr', tbody);
        tr.innerHTML = `
            <td>
                <span class="expand-toggle" data-pfx="${pfx}" data-index="${i}" data-section="income">${hasDetail ? '&#9660;' : '&#9654;'}</span>
                ${item.name}
                ${item.revisions && item.revisions.length > 0 ? '<span class="revision-badge">' + item.revisions.length + ' rev</span>' : ''}
            </td>
            <td>${currencyInput(w, pfx, 'income', i, 'weekly', 'positive')}</td>
            <td class="positive">${fmt(m)}</td>
            <td class="positive">${fmt(q)}</td>
            <td class="positive">${fmt(a)}</td>
        `;

        const detailTr = el('tr', tbody);
        detailTr.className = 'detail-row';
        detailTr.id = `${pfx}income-detail-${i}`;
        detailTr.style.display = 'none';
        detailTr.innerHTML = `<td colspan="5">${buildDetailPanel(item, pfx, i, 'income', 'Weekly')}</td>`;
    });

    setTotals(pfx + 'income-total', [totW, totM, totQ, totA], 'positive');
}

// ── Bonuses ──

function renderBonuses(data, pfx) {
    const tbody = document.getElementById(pfx + 'bonus-body');
    tbody.innerHTML = '';
    let tot = 0;

    data.bonuses.forEach((item, i) => {
        tot += item.annual;
        const tr = el('tr', tbody);
        tr.innerHTML = `
            <td>${item.name}</td>
            <td>${currencyInput(item.annual, pfx, 'bonuses', i, 'annual')}</td>
        `;
    });

    document.getElementById(pfx + 'bonus-total').textContent = fmt(tot);
}

// ── Outgoings (with expandable revisions) ──

function renderOutgoings(data, pfx) {
    const tbody = document.getElementById(pfx + 'outgoing-body');
    tbody.innerHTML = '';
    let totW = 0, totM = 0, totQ = 0, totA = 0;

    data.outgoings.forEach((item, i) => {
        migrateItem(item);
        const w = getCurrentWeekly(item);
        const m = weeklyToMonthly(w);
        const q = weeklyToQuarterly(w);
        const a = weeklyToAnnual(w);
        totW += w; totM += m; totQ += q; totA += a;

        const hasDetail = (item.revisions.length > 0) || (item.comment && item.comment.trim());
        const cycleOpts = PAY_CYCLES.map(c =>
            `<option value="${c}" ${c === item.cycle ? 'selected' : ''}>${c}</option>`
        ).join('');
        const editCol = cycleEditColumn(item.cycle);

        const tr = el('tr', tbody);
        tr.className = 'outgoing-row';
        tr.innerHTML = `
            <td>
                <span class="expand-toggle" data-pfx="${pfx}" data-index="${i}" data-section="outgoings">${hasDetail ? '&#9660;' : '&#9654;'}</span>
                ${item.name}
                ${item.revisions.length > 0 ? '<span class="revision-badge">' + item.revisions.length + ' rev</span>' : ''}
            </td>
            <td class="negative">${editCol === 'weekly' ? currencyInput(w, pfx, 'outgoings', i, 'weekly', 'negative') : fmt(w)}</td>
            <td class="negative">${editCol === 'monthly' ? currencyInput(m, pfx, 'outgoings', i, 'monthly', 'negative') : fmt(m)}</td>
            <td class="negative">${editCol === 'quarterly' ? currencyInput(q, pfx, 'outgoings', i, 'quarterly', 'negative') : fmt(q)}</td>
            <td class="negative">${editCol === 'annual' ? currencyInput(a, pfx, 'outgoings', i, 'annual', 'negative') : fmt(a)}</td>
            <td><select class="editable" data-pfx="${pfx}" data-field="outgoings" data-index="${i}" data-prop="cycle">${cycleOpts}</select></td>
            <td><input class="editable date-input" type="date" value="${item.firstPayment}"
                data-pfx="${pfx}" data-field="outgoings" data-index="${i}" data-prop="firstPayment"></td>
        `;

        const detailTr = el('tr', tbody);
        detailTr.className = 'detail-row';
        detailTr.id = `${pfx}outgoings-detail-${i}`;
        detailTr.style.display = 'none';
        detailTr.innerHTML = `<td colspan="7">${buildDetailPanel(item, pfx, i, 'outgoings', item.cycle)}</td>`;
    });

    setTotals(pfx + 'outgoing-total', [totW, totM, totQ, totA], 'negative');
}

// ── Contribution Split (with expandable revisions) ──

function renderSplit(data, pfx) {
    const tbody = document.getElementById(pfx + 'split-body');
    tbody.innerHTML = '';

    const totalOutW = data.outgoings.reduce((s, o) => s + getCurrentWeekly(o), 0);
    const items = data.contributionItems || [];
    const rentW = items.filter(c => c.name.startsWith('Rent')).reduce((s, c) => s + getCurrentWeekly(c), 0);
    const reqSplitW = (totalOutW - rentW) / 2;
    const contribSplitW = Math.ceil(reqSplitW);

    // Calculated info rows
    [
        { label: 'Rental Contribution', weekly: rentW },
        { label: 'Required Split (per person)', weekly: reqSplitW },
        { label: 'Contribution Split (rounded)', weekly: contribSplitW },
    ].forEach(r => {
        const w = r.weekly;
        const tr = el('tr', tbody);
        tr.innerHTML = `
            <td>${r.label}</td>
            <td>${fmt(w)}</td>
            <td>${fmt(weeklyToMonthly(w))}</td>
            <td>${fmt(weeklyToQuarterly(w))}</td>
            <td>${fmt(weeklyToAnnual(w))}</td>
        `;
    });

    // Contribution items with revisions (exclude rent — managed in income)
    const personalItems = items.filter(c => !c.name.startsWith('Rent'));
    personalItems.forEach((item) => {
        const i = items.indexOf(item); // keep original index for data binding
        migrateItem(item);
        const w = getCurrentWeekly(item);
        const hasDetail = (item.revisions.length > 0) || (item.comment && item.comment.trim());

        const tr = el('tr', tbody);
        tr.innerHTML = `
            <td>
                <span class="expand-toggle" data-pfx="${pfx}" data-index="${i}" data-section="contributionItems">${hasDetail ? '&#9660;' : '&#9654;'}</span>
                ${item.name}
                ${item.autoCalc ? '<span class="auto-badge">auto</span>' : ''}
                ${item.revisions.length > 0 ? '<span class="revision-badge">' + item.revisions.length + ' rev</span>' : ''}
            </td>
            <td>${currencyInput(w, pfx, 'contributionItems', i, 'weekly')}</td>
            <td>${fmt(weeklyToMonthly(w))}</td>
            <td>${fmt(weeklyToQuarterly(w))}</td>
            <td>${fmt(weeklyToAnnual(w))}</td>
        `;

        const detailTr = el('tr', tbody);
        detailTr.className = 'detail-row';
        detailTr.id = `${pfx}contributionItems-detail-${i}`;
        detailTr.style.display = 'none';
        detailTr.innerHTML = `<td colspan="5">${buildDetailPanel(item, pfx, i, 'contributionItems', 'Weekly')}</td>`;
    });
}

// ── Residual Income ──

function renderResidual(data, pfx) {
    const tbody = document.getElementById(pfx + 'residual-body');
    tbody.innerHTML = '';

    const dianaInc = getCurrentWeekly(data.income[0] || { weekly: 0 });
    const bradInc = getCurrentWeekly(data.income[1] || { weekly: 0 });
    const items = data.contributionItems || [];
    const bradOut = items.filter(c => c.name.startsWith('Brad')).reduce((s, c) => s + getCurrentWeekly(c), 0);
    const dianaOut = items.filter(c => c.name.startsWith('Diana')).reduce((s, c) => s + getCurrentWeekly(c), 0);

    [
        { label: 'Brad Residual', weekly: bradInc - bradOut },
        { label: 'Diana Residual', weekly: dianaInc - dianaOut },
    ].forEach(r => {
        const w = r.weekly;
        const cls = w >= 0 ? 'positive' : 'negative';
        const tr = el('tr', tbody);
        tr.innerHTML = `
            <td>${r.label}</td>
            <td class="${cls}">${fmtSigned(w)}</td>
            <td class="${cls}">${fmtSigned(weeklyToMonthly(w))}</td>
            <td class="${cls}">${fmtSigned(weeklyToQuarterly(w))}</td>
            <td class="${cls}">${fmtSigned(weeklyToAnnual(w))}</td>
        `;
    });
}

// ── Shared detail panel builder ──

function buildDetailPanel(item, pfx, idx, section, cycle) {
    let html = '<div class="detail-panel">';

    // Comment
    html += `<div class="detail-section">
        <label class="detail-label">Notes</label>
        <textarea class="detail-comment" rows="2" placeholder="Add notes..."
            data-pfx="${pfx}" data-index="${idx}" data-section="${section}">${escHtml(item.comment || '')}</textarea>
    </div>`;

    // Revisions
    html += '<div class="detail-section">';
    html += '<label class="detail-label">Rate Revisions</label>';

    if (item.revisions && item.revisions.length > 0) {
        html += '<table class="revision-table"><thead><tr><th>From Date</th><th>Weekly Rate</th><th>Reason</th><th></th></tr></thead><tbody>';
        html += `<tr class="revision-base">
            <td>1 Jan (base)</td>
            <td>${fmtPlain(item.weekly)}</td>
            <td class="dim">Original budget</td>
            <td></td>
        </tr>`;
        item.revisions.forEach((rev, ri) => {
            html += `<tr>
                <td><input class="editable date-input" type="date" value="${rev.fromDate}"
                    data-pfx="${pfx}" data-field="revision-date" data-index="${idx}" data-rev="${ri}" data-section="${section}"></td>
                <td><input class="currency-input" type="text" value="${fmtPlain(rev.weekly)}"
                    data-pfx="${pfx}" data-field="revision-weekly" data-index="${idx}" data-rev="${ri}" data-section="${section}"
                    data-raw="${rev.weekly}"></td>
                <td><input class="revision-reason" type="text" value="${escHtml(rev.reason || '')}" placeholder="Reason..."
                    data-pfx="${pfx}" data-field="revision-reason" data-index="${idx}" data-rev="${ri}" data-section="${section}"></td>
                <td><button class="revision-delete" data-pfx="${pfx}" data-index="${idx}" data-rev="${ri}" data-section="${section}">&times;</button></td>
            </tr>`;
        });
        html += '</tbody></table>';
    } else {
        html += `<div class="dim" style="font-size:0.78rem;margin-bottom:8px;">No revisions. Base rate: ${fmtPlain(item.weekly)}/week.</div>`;
    }

    html += `<button class="add-revision-btn" data-pfx="${pfx}" data-index="${idx}" data-section="${section}">+ Add Revision</button>`;
    html += '</div></div>';
    return html;
}

// ── Helpers ──

function cycleEditColumn(cycle) {
    switch (cycle) {
        case 'Weekly': case 'Fortnightly': return 'weekly';
        case 'Monthly': case 'Bi-Monthly': return 'monthly';
        case 'Quarterly': return 'quarterly';
        case 'Bi-Annually': case 'Annually': return 'annual';
        default: return 'weekly';
    }
}

function el(tag, parent) {
    const e = document.createElement(tag);
    if (parent) parent.appendChild(e);
    return e;
}

function currencyInput(value, pfx, field, index, prop, colorClass) {
    const cls = colorClass ? `currency-input ${colorClass}` : 'currency-input';
    const idxAttr = index !== null && index !== undefined ? `data-index="${index}"` : '';
    return `<input class="${cls}" type="text" value="${fmtPlain(value)}"
        data-pfx="${pfx}" data-field="${field}" ${idxAttr} data-prop="${prop}"
        data-raw="${value}">`;
}

function setTotals(idPrefix, values, colorClass) {
    const suffixes = ['-weekly', '-monthly', '-quarterly', '-annual'];
    values.forEach((v, i) => {
        const td = document.getElementById(idPrefix + suffixes[i]);
        if (td) {
            td.textContent = fmt(v);
            td.className = colorClass || '';
        }
    });
}

function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
