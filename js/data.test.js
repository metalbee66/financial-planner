/**
 * Tests for top-level data.js helpers + bank-inbox parsers from
 * js/modules/finance/import.js.
 *
 * Pure functions only — DOM/Firebase paths are tested via manual smoke test.
 * Run via /tests.html in the dev server.
 *
 * Each `test(name, fn)` registers a case; `runDataTests()` executes them
 * and returns a `{ pass, fail, results }` summary — same shape as the
 * projects-data-tests runner that tests.html already drives.
 */

import {
    DEFAULT_BANK_INBOX,
    BALANCE_CATEGORIES,
    sanitiseBankInbox,
    isValidBalanceRecord,
} from './data.js';

import { parseHsbcCsv, parseAmpCsv } from './modules/finance/import.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg || 'eq'}: expected ${e}, got ${a}`);
}
function truthy(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function falsy(v, msg) { if (v) throw new Error(msg || 'expected falsy, got ' + JSON.stringify(v)); }

// ── sanitiseBankInbox ──

test('sanitiseBankInbox(null) returns empty default shape', () => {
    eq(sanitiseBankInbox(null), { transactions: {}, balances: {} });
});

test('sanitiseBankInbox(undefined) returns empty default shape', () => {
    eq(sanitiseBankInbox(undefined), { transactions: {}, balances: {} });
});

test('sanitiseBankInbox(array) returns empty default shape', () => {
    eq(sanitiseBankInbox([1, 2, 3]), { transactions: {}, balances: {} });
});

test('sanitiseBankInbox({}) returns empty default shape', () => {
    eq(sanitiseBankInbox({}), { transactions: {}, balances: {} });
});

test('sanitiseBankInbox preserves existing transactions when balances missing', () => {
    const tx = { 'HSBC|hsbc-everyday|2026-05-25|45|coffee': { amount: 45 } };
    const result = sanitiseBankInbox({ transactions: tx });
    eq(result, { transactions: tx, balances: {} });
});

test('sanitiseBankInbox preserves existing balances when transactions missing', () => {
    const bal = { 'amp-super': { accountSlug: 'amp-super', balance: 123 } };
    const result = sanitiseBankInbox({ balances: bal });
    eq(result, { transactions: {}, balances: bal });
});

test('sanitiseBankInbox preserves both siblings when both present', () => {
    const tx = { 'HSBC|x|2026-05-25|45|y': { amount: 45 } };
    const bal = { 'amp-super': { balance: 123 } };
    eq(sanitiseBankInbox({ transactions: tx, balances: bal }), { transactions: tx, balances: bal });
});

test('DEFAULT_BANK_INBOX is frozen and has both empty siblings', () => {
    eq(DEFAULT_BANK_INBOX, { transactions: {}, balances: {} });
    truthy(Object.isFrozen(DEFAULT_BANK_INBOX), 'DEFAULT_BANK_INBOX should be frozen');
});

// ── isValidBalanceRecord ──

const validRecord = {
    accountSlug: 'selfwealth-account-1',
    balance: 12345.67,
    asOf: '2026-05-28T07:23:00+10:00',
    institution: 'Selfwealth',
    category: 'investment',
};

test('isValidBalanceRecord accepts a well-formed record', () => {
    truthy(isValidBalanceRecord(validRecord));
});

test('isValidBalanceRecord rejects null / undefined / non-object', () => {
    falsy(isValidBalanceRecord(null));
    falsy(isValidBalanceRecord(undefined));
    falsy(isValidBalanceRecord('string'));
    falsy(isValidBalanceRecord(42));
});

test('isValidBalanceRecord rejects missing or empty accountSlug', () => {
    falsy(isValidBalanceRecord({ ...validRecord, accountSlug: '' }));
    falsy(isValidBalanceRecord({ ...validRecord, accountSlug: undefined }));
});

test('isValidBalanceRecord rejects non-finite balance', () => {
    falsy(isValidBalanceRecord({ ...validRecord, balance: 'twelve' }));
    falsy(isValidBalanceRecord({ ...validRecord, balance: NaN }));
    falsy(isValidBalanceRecord({ ...validRecord, balance: Infinity }));
});

test('isValidBalanceRecord rejects unparseable asOf', () => {
    falsy(isValidBalanceRecord({ ...validRecord, asOf: '' }));
    falsy(isValidBalanceRecord({ ...validRecord, asOf: 'not-a-date' }));
    falsy(isValidBalanceRecord({ ...validRecord, asOf: undefined }));
});

test('isValidBalanceRecord rejects empty institution', () => {
    falsy(isValidBalanceRecord({ ...validRecord, institution: '' }));
});

test('isValidBalanceRecord accepts each BALANCE_CATEGORIES value', () => {
    for (const cat of BALANCE_CATEGORIES) {
        truthy(isValidBalanceRecord({ ...validRecord, category: cat }), `category ${cat}`);
    }
});

test('isValidBalanceRecord rejects unknown category', () => {
    falsy(isValidBalanceRecord({ ...validRecord, category: 'crypto' }));
    falsy(isValidBalanceRecord({ ...validRecord, category: '' }));
});

// ── parseHsbcCsv ──
// Synthetic samples matching the real HSBC CSV format observed in
// C:\Vault\fp-samples\hsbc-TransHist-2026-05-28.csv (4 quoted columns,
// leading whitespace on every value, comma thousands separator on amount
// and balance, trailing comma → empty 5th column, `D MMM YYYY` date).

const HSBC_HEADER = ' Transaction Date,Description,Amount,Balance,';

test('parseHsbcCsv("") returns []', () => {
    eq(parseHsbcCsv(''), []);
});

test('parseHsbcCsv with header only returns []', () => {
    eq(parseHsbcCsv(HSBC_HEADER), []);
});

test('parseHsbcCsv parses a single debit row', () => {
    const csv = HSBC_HEADER + '\n 25 May 2026,COFFEE SHOP ROAD,"-12.50"," -317,945.00"';
    const rows = parseHsbcCsv(csv, 'hsbc-everyday');
    eq(rows.length, 1);
    const r = rows[0];
    eq(r.amount, 12.50);
    eq(r.isRefund, false);
    eq(r.source, 'HSBC');
    eq(r.account, 'hsbc-everyday');
    eq(r.details, 'COFFEE SHOP ROAD');
    eq(r.merchant, 'COFFEE SHOP ROAD');
    eq(r.category, '');
    eq(r.txType, '');
    eq(r.glLine, '');
    eq(r.isDuplicate, false);
    eq(r.dateStr, '25 May 2026');
    truthy(r.date instanceof Date, 'date should be a Date');
});

test('parseHsbcCsv parses a credit row as isRefund=true with positive amount', () => {
    const csv = HSBC_HEADER + '\n 25 May 2026,TRANSFER FROM 250-289048-090,"4,522.00"," -316,751.18"';
    const rows = parseHsbcCsv(csv, 'hsbc-primary-home-loan');
    eq(rows.length, 1);
    eq(rows[0].amount, 4522.00);
    eq(rows[0].isRefund, true);
    eq(rows[0].account, 'hsbc-primary-home-loan');
});

test('parseHsbcCsv handles quoted amounts with comma thousands separator', () => {
    const csv = HSBC_HEADER + '\n 14 May 2026,INTEREST DEBIT,"-1,489.86"," -318,665.75"';
    const rows = parseHsbcCsv(csv);
    eq(rows.length, 1);
    eq(rows[0].amount, 1489.86);
    eq(rows[0].isRefund, false);
});

test('parseHsbcCsv sorts multiple rows ascending by date', () => {
    const csv = HSBC_HEADER
        + '\n 25 May 2026,LATER ROW,"-10.00"," -100.00"'
        + '\n 15 May 2026,EARLIER ROW,"-20.00"," -90.00"'
        + '\n 20 May 2026,MIDDLE ROW,"-30.00"," -70.00"';
    const rows = parseHsbcCsv(csv);
    eq(rows.length, 3);
    eq(rows[0].details, 'EARLIER ROW');
    eq(rows[1].details, 'MIDDLE ROW');
    eq(rows[2].details, 'LATER ROW');
});

test('parseHsbcCsv skips rows with malformed dates without crashing', () => {
    const csv = HSBC_HEADER
        + '\n NOT-A-DATE,bad row,"-5.00"," -100.00"'
        + '\n 25 May 2026,good row,"-10.00"," -110.00"';
    const rows = parseHsbcCsv(csv);
    eq(rows.length, 1);
    eq(rows[0].details, 'good row');
});

test('parseHsbcCsv defaults accountSlug to hsbc-unknown when not supplied', () => {
    const csv = HSBC_HEADER + '\n 25 May 2026,X,"-1.00"," -1.00"';
    const rows = parseHsbcCsv(csv);
    eq(rows[0].account, 'hsbc-unknown');
});

test('parseHsbcCsv truncates merchant to first 30 chars', () => {
    const longDetails = 'A'.repeat(50);
    const csv = HSBC_HEADER + `\n 25 May 2026,${longDetails},"-1.00"," -1.00"`;
    const rows = parseHsbcCsv(csv);
    eq(rows[0].merchant.length, 30);
    eq(rows[0].details, longDetails);  // full string preserved in details
});

// ── parseAmpCsv ──
// AMP's real export layout is confirmed during the headed amp.mjs scrape
// (T2.6); these cases lock in the PROVISIONAL `Date, Description, Amount`
// shape + the tolerant multi-format date parser. Update the synthetic samples
// once a real AMP export is captured.

const AMP_HEADER = 'Date,Description,Amount,Balance';

test('parseAmpCsv("") returns []', () => {
    eq(parseAmpCsv(''), []);
});

test('parseAmpCsv with header only returns []', () => {
    eq(parseAmpCsv(AMP_HEADER), []);
});

test('parseAmpCsv parses a contribution row (D MMM YYYY date)', () => {
    const csv = AMP_HEADER + '\n01 May 2026,EMPLOYER CONTRIBUTION,"1,250.00","85,400.00"';
    const rows = parseAmpCsv(csv);
    eq(rows.length, 1);
    const r = rows[0];
    eq(r.amount, 1250.00);
    eq(r.isRefund, true);   // positive amount = credit/contribution
    eq(r.source, 'AMP');
    eq(r.account, 'amp-super');
    eq(r.details, 'EMPLOYER CONTRIBUTION');
    eq(r.merchant, 'EMPLOYER CONTRIBUTION');
    eq(r.dateStr, '01 May 2026');
    truthy(r.date instanceof Date, 'date should be a Date');
});

test('parseAmpCsv parses a fee row as a debit (ISO date)', () => {
    const csv = AMP_HEADER + '\n2026-05-15,ADMIN FEE,"-12.50","85,387.50"';
    const rows = parseAmpCsv(csv);
    eq(rows.length, 1);
    eq(rows[0].amount, 12.50);
    eq(rows[0].isRefund, false);
});

test('parseAmpCsv accepts DD/MM/YYYY Australian dates', () => {
    const csv = AMP_HEADER + '\n20/05/2026,INVESTMENT EARNINGS,"340.10","85,727.60"';
    const rows = parseAmpCsv(csv);
    eq(rows.length, 1);
    eq(rows[0].amount, 340.10);
    truthy(rows[0].date instanceof Date, 'DD/MM/YYYY should parse');
});

test('parseAmpCsv defaults accountSlug to amp-super and respects an override', () => {
    const csv = AMP_HEADER + '\n01 May 2026,X,"-1.00","1.00"';
    eq(parseAmpCsv(csv)[0].account, 'amp-super');
    eq(parseAmpCsv(csv, 'amp-brad')[0].account, 'amp-brad');
});

test('parseAmpCsv skips malformed-date rows and sorts ascending', () => {
    const csv = AMP_HEADER
        + '\nNOT-A-DATE,bad,"-5.00","1.00"'
        + '\n20 May 2026,later,"-10.00","2.00"'
        + '\n15 May 2026,earlier,"-20.00","3.00"';
    const rows = parseAmpCsv(csv);
    eq(rows.length, 2);
    eq(rows[0].details, 'earlier');
    eq(rows[1].details, 'later');
});

// ── Runner ──

export async function runDataTests() {
    const results = [];
    let pass = 0, fail = 0;
    for (const t of tests) {
        try {
            await t.fn();
            results.push({ name: t.name, ok: true });
            pass++;
        } catch (e) {
            results.push({ name: t.name, ok: false, error: e.message });
            fail++;
        }
    }
    return { pass, fail, results };
}
