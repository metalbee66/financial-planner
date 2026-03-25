/**
 * Budget data model, defaults, formatting helpers, and persistence.
 */

const PAY_CYCLES = ['Weekly', 'Fortnightly', 'Monthly', 'Bi-Monthly', 'Quarterly', 'Bi-Annually', 'Annually'];
const WEEKS_PER_YEAR = 52;
const MONTHS_PER_YEAR = 12;
const QUARTERS_PER_YEAR = 4;

function getYearStart(year) {
    const jan1 = new Date(year, 0, 1);
    const day = jan1.getDay();
    const offset = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    return new Date(year, 0, 1 + offset);
}

function getWeekDates(year) {
    const start = getYearStart(year);
    const dates = [];
    for (let i = 0; i < 52; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i * 7);
        dates.push(d);
    }
    return dates;
}

function getCurrentWeekIndex(year) {
    const dates = getWeekDates(year);
    const now = new Date();
    for (let i = dates.length - 1; i >= 0; i--) {
        if (now >= dates[i]) return i;
    }
    return 0;
}

// ── Conversion helpers ──
function weeklyToMonthly(w) { return w * WEEKS_PER_YEAR / MONTHS_PER_YEAR; }
function weeklyToQuarterly(w) { return w * WEEKS_PER_YEAR / QUARTERS_PER_YEAR; }
function weeklyToAnnual(w) { return w * WEEKS_PER_YEAR; }
function monthlyToWeekly(m) { return m * MONTHS_PER_YEAR / WEEKS_PER_YEAR; }
function quarterlyToWeekly(q) { return q * QUARTERS_PER_YEAR / WEEKS_PER_YEAR; }
function annualToWeekly(a) { return a / WEEKS_PER_YEAR; }

function cycleToPeriodAmount(weekly, cycle) {
    switch (cycle) {
        case 'Weekly': return weekly;
        case 'Fortnightly': return weekly * 2;
        case 'Monthly': return weeklyToMonthly(weekly);
        case 'Bi-Monthly': return weeklyToMonthly(weekly) * 2;
        case 'Quarterly': return weeklyToQuarterly(weekly);
        case 'Bi-Annually': return weeklyToAnnual(weekly) / 2;
        case 'Annually': return weeklyToAnnual(weekly);
        default: return weekly;
    }
}

/** Given a cycle and an amount in that cycle's period, return weekly equivalent */
function periodToWeekly(amount, cycle) {
    switch (cycle) {
        case 'Weekly': return amount;
        case 'Fortnightly': return amount / 2;
        case 'Monthly': return monthlyToWeekly(amount);
        case 'Bi-Monthly': return monthlyToWeekly(amount / 2);
        case 'Quarterly': return quarterlyToWeekly(amount);
        case 'Bi-Annually': return annualToWeekly(amount * 2);
        case 'Annually': return annualToWeekly(amount);
        default: return amount;
    }
}

// ── Currency formatting (accounting style) ──
// Simple right-aligned monospace: "$1,234.56" or "$-"
// Uses non-breaking spaces so alignment holds.

function fmtNum(n) {
    if (n === 0) return '-';
    return Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt(n) {
    return '$' + fmtNum(n);
}

function fmtSigned(n) {
    if (n < 0) return '-$' + fmtNum(n);
    return '$' + fmtNum(n);
}

/** Same as fmt — used for input values */
function fmtPlain(n) {
    return fmt(n);
}

/** Parse "$1,234.56" or "1234.56" or "$ -" back to number */
function parseCurrency(str) {
    if (typeof str === 'number') return str;
    const cleaned = String(str).replace(/[^0-9.\-]/g, '');
    return cleaned === '' ? 0 : parseFloat(cleaned) || 0;
}

/**
 * Get the effective weekly rate for an outgoing item at a given date.
 * Checks revisions array (sorted by fromDate) and returns the latest
 * revision that is on or before the date. Falls back to item.weekly.
 *
 * Each revision: { fromDate: 'YYYY-MM-DD', weekly: number, reason: string }
 */
function getEffectiveWeekly(item, date) {
    if (!item.revisions || item.revisions.length === 0) return item.weekly;
    let effective = item.weekly;
    for (const rev of item.revisions) {
        if (new Date(rev.fromDate + 'T00:00:00') <= date) {
            effective = rev.weekly;
        }
    }
    return effective;
}

/** Get the current effective weekly (latest revision or base) */
function getCurrentWeekly(item) {
    return getEffectiveWeekly(item, new Date());
}

/** Ensure items have comment and revisions fields */
function migrateItem(item) {
    if (!item.comment && item.comment !== '') item.comment = '';
    if (!item.revisions) item.revisions = [];
    return item;
}
const migrateOutgoing = migrateItem;

/** Migrate old flat contributions object to new array format */
function migrateBudget(data) {
    data.outgoings.forEach(migrateItem);
    data.income.forEach(migrateItem);

    // Convert old contributions object to contributionItems array
    if (data.contributions && !data.contributionItems) {
        const c = data.contributions;
        const y = String(data.year || 2026);
        data.contributionItems = [
            { name: 'Brad Regular', weekly: c.bradRegular || 0, cycle: c.bradRegularCycle || 'Fortnightly', firstPayment: c.bradRegularFirstPayment || y+'-01-12', autoCalc: true, comment: '', revisions: [] },
            { name: 'Brad Additional', weekly: c.bradAdditional || 0, cycle: c.bradAdditionalCycle || 'Fortnightly', firstPayment: c.bradAdditionalFirstPayment || y+'-01-12', autoCalc: false, comment: '', revisions: [] },
            { name: 'Diana Regular', weekly: c.dianaRegular || 0, cycle: c.dianaRegularCycle || 'Monthly', firstPayment: c.dianaRegularFirstPayment || y+'-01-05', autoCalc: true, comment: '', revisions: [] },
            { name: 'Diana Additional', weekly: c.dianaAdditional || 0, cycle: c.dianaAdditionalCycle || 'Monthly', firstPayment: c.dianaAdditionalFirstPayment || y+'-01-05', autoCalc: false, comment: '', revisions: [] },
            { name: 'Rent - Cranbourne', weekly: c.rentCranbourne || 0, cycle: c.rentCranbourneCycle || 'Weekly', firstPayment: c.rentCranbourneFirstPayment || y+'-01-06', autoCalc: false, comment: '', revisions: [] },
            { name: 'Rent - Mentone', weekly: c.rentMentone || 0, cycle: c.rentMentoneCycle || 'Monthly', firstPayment: c.rentMentoneFirstPayment || y+'-01-07', autoCalc: false, comment: '', revisions: [] },
        ];
        delete data.contributions;
    }
    if (data.contributionItems) data.contributionItems.forEach(migrateItem);
    return data;
}

// ── Default budget data ──

function makeDefaultBudget(year) {
    const y = String(year);
    const jan = y + '-01-', feb = y + '-02-', mar = y + '-03-', apr = y + '-04-';
    const jun = y + '-06-', jul = y + '-07-', aug = y + '-08-', nov = y + '-11-', dec = y + '-12-';

    return {
        year: year,
        income: [
            { name: 'Diana', weekly: 1746 },
            { name: 'Brad', weekly: 2021 },
            { name: 'Rent - Cranbourne', weekly: 669.23 },
            { name: 'Rent - Mentone', weekly: 611.54 },
        ],
        bonuses: [
            { name: 'Bonus - Brad', annual: 9000 },
            { name: 'Bonus - Diana', annual: 0 },
            { name: 'Tax Return - Brad', annual: 10000 },
            { name: 'Tax Return - Diana', annual: 13000 },
            { name: 'Tax Return - Trust', annual: 0 },
        ],
        outgoings: [
            { name: 'Savings - Brad', weekly: 0, cycle: 'Weekly', firstPayment: jan + '05' },
            { name: 'Savings - Investment', weekly: 153.85, cycle: 'Quarterly', firstPayment: jan + '24' },
            { name: 'Holiday Fund', weekly: 192.31, cycle: 'Annually', firstPayment: aug + '31' },
            { name: 'Mortgage - Home', weekly: 655.60, cycle: 'Monthly', firstPayment: jan + '18' },
            { name: 'Mortgage - Cranbourne', weekly: 696.91, cycle: 'Monthly', firstPayment: jan + '18' },
            { name: 'Mortgage - Mentone', weekly: 581.66, cycle: 'Monthly', firstPayment: jan + '18' },
            { name: 'Mortgage - Cranbourne 2', weekly: 81.25, cycle: 'Monthly', firstPayment: jan + '18' },
            { name: 'Mortgage - Stock Assets', weekly: 201.13, cycle: 'Monthly', firstPayment: jan + '18' },
            { name: 'Body Corporate - Mentone', weekly: 102.88, cycle: 'Quarterly', firstPayment: jan + '06' },
            { name: 'Rates - Home', weekly: 52.15, cycle: 'Quarterly', firstPayment: feb + '23' },
            { name: 'Rates - Cranbourne', weekly: 38.46, cycle: 'Quarterly', firstPayment: feb + '23' },
            { name: 'Rates - Mentone', weekly: 22.55, cycle: 'Quarterly', firstPayment: feb + '23' },
            { name: 'Water Rates - Cranbourne', weekly: 13.46, cycle: 'Quarterly', firstPayment: mar + '25' },
            { name: 'Water Rates - Mentone', weekly: 13.46, cycle: 'Quarterly', firstPayment: mar + '25' },
            { name: 'Home & Contents Insurance', weekly: 24.04, cycle: 'Annually', firstPayment: apr + '26' },
            { name: 'Landlord Insurance - Cranbourne', weekly: 23.08, cycle: 'Annually', firstPayment: apr + '26' },
            { name: 'Health Insurance', weekly: 100.62, cycle: 'Monthly', firstPayment: jan + '10' },
            { name: 'Land Tax', weekly: 47.12, cycle: 'Annually', firstPayment: jul + '26' },
            { name: 'Groceries', weekly: 380, cycle: 'Weekly', firstPayment: jan + '05' },
            { name: 'Fuel', weekly: 80, cycle: 'Weekly', firstPayment: jan + '05' },
            { name: 'Lifestyle Spending', weekly: 200, cycle: 'Weekly', firstPayment: jan + '05' },
            { name: 'Kids', weekly: 100, cycle: 'Weekly', firstPayment: feb + '05' },
            { name: 'Power', weekly: 34.62, cycle: 'Monthly', firstPayment: jan + '10' },
            { name: 'Water', weekly: 46.15, cycle: 'Quarterly', firstPayment: mar + '21' },
            { name: 'Gas', weekly: 33.65, cycle: 'Monthly', firstPayment: jan + '15' },
            { name: 'Internet', weekly: 14.93, cycle: 'Monthly', firstPayment: jan + '14' },
            { name: 'Streaming', weekly: 9.23, cycle: 'Monthly', firstPayment: jan + '07' },
            { name: 'Compliance Check', weekly: 23.08, cycle: 'Annually', firstPayment: mar + '01' },
            { name: 'Pest Control', weekly: 7.69, cycle: 'Annually', firstPayment: feb + '01' },
            { name: 'Car Insurance - Toyota', weekly: 28.51, cycle: 'Annually', firstPayment: feb + '28' },
            { name: 'Car Roadside Assist - Toyota', weekly: 2.88, cycle: 'Annually', firstPayment: apr + '01' },
            { name: 'Registration - Toyota', weekly: 17.31, cycle: 'Quarterly', firstPayment: dec + '31' },
            { name: 'Servicing - Toyota', weekly: 14.42, cycle: 'Bi-Annually', firstPayment: jun + '01' },
            { name: 'Cleaner', weekly: 34.62, cycle: 'Monthly', firstPayment: jan + '09' },
            { name: 'School', weekly: 9.62, cycle: 'Annually', firstPayment: feb + '28' },
            { name: 'Swimming', weekly: 46.15, cycle: 'Quarterly', firstPayment: jan + '20' },
            { name: 'Sport', weekly: 76.92, cycle: 'Quarterly', firstPayment: jan + '10' },
            { name: 'School Holidays', weekly: 23.08, cycle: 'Quarterly', firstPayment: jan + '06' },
            { name: 'Music Lessons', weekly: 21.15, cycle: 'Quarterly', firstPayment: jan + '06' },
            { name: 'Birthday Fund', weekly: 26.92, cycle: 'Bi-Annually', firstPayment: mar + '01' },
            { name: 'Xmas Fund', weekly: 67.31, cycle: 'Annually', firstPayment: nov + '30' },
            { name: 'Adhoc Spending', weekly: 115.38, cycle: 'Monthly', firstPayment: jan + '05' },
        ],
        contributionItems: [
            { name: 'Brad Regular', weekly: 1567, cycle: 'Fortnightly', firstPayment: jan + '12', autoCalc: true, comment: '', revisions: [] },
            { name: 'Brad Additional', weekly: 0, cycle: 'Fortnightly', firstPayment: jan + '12', autoCalc: false, comment: '', revisions: [] },
            { name: 'Diana Regular', weekly: 1567, cycle: 'Monthly', firstPayment: jan + '05', autoCalc: true, comment: '', revisions: [] },
            { name: 'Diana Additional', weekly: 0, cycle: 'Monthly', firstPayment: jan + '05', autoCalc: false, comment: '', revisions: [] },
            { name: 'Rent - Cranbourne', weekly: 669.23, cycle: 'Weekly', firstPayment: jan + '06', autoCalc: false, comment: '', revisions: [] },
            { name: 'Rent - Mentone', weekly: 611.54, cycle: 'Monthly', firstPayment: jan + '07', autoCalc: false, comment: '', revisions: [] },
        ],
        primaryCount: 18,
        primaryAccountBalance: 161606.99,
    };
}

const DEFAULT_CY = makeDefaultBudget(2026);
const DEFAULT_NY = makeDefaultBudget(2027);

// ── Persistence ──
function loadData(key) {
    const saved = localStorage.getItem(key);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) { console.error('Parse error', e); }
    }
    return null;
}

function loadBudgetCY() {
    return migrateBudget(loadData('budget_cy26') || JSON.parse(JSON.stringify(DEFAULT_CY)));
}
function loadBudgetNY() {
    return migrateBudget(loadData('budget_ny27') || JSON.parse(JSON.stringify(DEFAULT_NY)));
}
function loadWeekActuals() { return loadData('week_actuals_cy26') || {}; }

function saveBudgetCY(data) { localStorage.setItem('budget_cy26', JSON.stringify(data)); showToast('Saved'); }
function saveBudgetNY(data) { localStorage.setItem('budget_ny27', JSON.stringify(data)); showToast('Saved'); }
function saveWeekActuals(data) { localStorage.setItem('week_actuals_cy26', JSON.stringify(data)); }

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1500);
}
