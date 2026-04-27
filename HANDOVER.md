# Family Planner — Handover Notes

> **Note (2026-04-28):** App was renamed from "Financial Planner" to "Family Planner" as part of a modular-monolith restructure (see [tasks/plan.md](../tasks/plan.md)). The original GitHub repo (`financial-planner`) and Firebase project ID are unchanged for now — only visible labels have been updated.


## Architecture

**Stack:** Vanilla HTML/CSS/JS — no build tools, no Node.js required.

**Hosting:** GitHub Pages (static) + Firebase Realtime Database (data sync + auth).

**Repo:** https://github.com/metalbee66/financial-planner (public — required for free GitHub Pages)

**Live:** https://metalbee66.github.io/financial-planner/

## File Structure

```
app/
├── index.html              Main HTML (all 5 tabs)
├── css/style.css           All styles
├── js/
│   ├── firebase-config.js  Firebase project config + allowed emails
│   ├── firebase-sync.js    Auth, real-time sync, data migration
│   ├── data.js             Data model, defaults, currency formatting, helpers
│   ├── budget.js           Budget CY/NY tab rendering (income, outgoings, split, residual)
│   ├── planner.js          Week-by-week planner with payment scheduling
│   ├── accounts.js         Accounts dashboard rendering
│   ├── import.js           CSV parsing, GL assignment, merchant mappings
│   └── app.js              App controller (tabs, editing, event wiring)
├── server.py               Local dev server (python server.py)
├── sample-data/            Sample CSV for testing
├── CHANGELOG.md            Version history
└── HANDOVER.md             This file
```

## Key Design Decisions

### Data Model
- All amounts stored as **weekly** base rates internally
- Conversion to monthly/quarterly/annual is computed on display
- **Revisions** are date-based overrides on any item (income, outgoing, contribution)
  - `item.revisions = [{ fromDate, weekly, reason }]`
  - `getEffectiveWeekly(item, date)` returns the correct rate for a given date
- **contributionItems** is an array (was flat object, migrated automatically)
- **weekActuals** stores per-week confirmed/adjusted values with comments

### Firebase
- Config in `firebase-config.js` (API key is safe to be public)
- Database URL: `https://financial-planner-e85d4-default-rtdb.asia-southeast1.firebasedatabase.app`
- Auth: Google Sign-In, restricted to 2 emails
- Database rules should restrict to those emails (see CHANGELOG for rules)
- Data path: `household/family/{key}`
- Falls back to localStorage if Firebase is unavailable

### Currency Formatting
- `fmt(n)` returns `$1,234.56` or `$-` (plain text, monospace-padded with NBSP)
- `fmtPlain(n)` returns `$1,234.56` for input values
- `fmtSigned(n)` returns ` $1,234.56` or `-$1,234.56`
- All table cells use `--mono` font variable (Cascadia Mono/Consolas)

### Payment Scheduling
- `calcPaymentSchedule(item, weekDates)` computes 52-week array
- Respects revisions: uses `getEffectiveWeekly(item, paymentDate)` per payment
- Mid-week revisions snap to week boundary (the week's Monday date determines rate)

## How to Deploy Changes

1. Edit files locally in `e:/Projects/Family Planner/app/`
2. Test at http://localhost:8080 (`python server.py`)
3. `git add -A && git commit -m "message" && git push`
4. GitHub Pages rebuilds in ~30 seconds
5. Hard refresh (Ctrl+Shift+R) on the live site

## Outstanding Items

1. **Section alignment** — columns don't perfectly align between Income/Outgoings/Split/Residual sections
2. **Planner charges** — expandable charge entries per planner line (like revisions in budget), populating YTD actuals from those charges
3. **CSV parsers** for HSBC, ANZ, Westpac, Bankwest statement formats
4. **Bank API** — placeholder exists, no integration yet
5. **GL mappings Firebase sync** — currently localStorage only
6. **Contribution auto-calc** — Brad/Diana Regular marked `autoCalc:true` but not yet recalculated when outgoings change
7. **Mobile polish** — responsive breakpoints exist but could be refined
