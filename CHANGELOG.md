# Family Planner — Changelog

## v2.0.0 (in progress) — Modular monolith + Projects module

Rebranding "Financial Planner" → "Family Planner" and restructuring the app into a modular monolith. The existing finance features become the **Finance** module; a new **Projects** module (Asana-like project management) is added alongside. Future modules slot into the same registry. See [tasks/plan.md](../tasks/plan.md) for the full plan.

### Phase 0 (in progress)
- Rebrand visible labels (title, header, login card) — Task 0.1

## v1.0.0 — 2026-03-26 (Financial Planner)

### Budget Tabs (CY / NY)
- Budget CY (2026) and Budget NY (2027) with independent data
- Income section with 4 sources (Diana, Brad, Rent-Cranbourne, Rent-Mentone)
- Bonus / Tax Returns (Brad, Diana, Trust)
- 42 outgoing line items across Primary (18) and Secondary (24) liabilities
- Pay cycle support: Weekly, Fortnightly, Monthly, Bi-Monthly, Quarterly, Bi-Annually, Annually
- Editable amount column matches pay cycle (weekly items edit weekly, monthly items edit monthly, etc.)
- Contribution split: 50/50 calculated from outgoings minus rent, with Brad/Diana regular and additional
- Residual income calculation per person
- **Expandable detail rows** on every income, outgoing, and contribution item:
  - Notes field for context
  - **Rate revision system** — add date-based revisions (e.g. RBA rate rise), multiple per item per year
  - Planner uses correct rate for each week based on revision effective dates
- Add new outgoing line items via "+ Add Outgoing" button
- Monospace accounting-style currency formatting throughout

### Planner (CY26)
- Week-by-week view with prev/next navigation and "Today" shortcut
- 52-week overview strip (colour-coded: grey=pending, green=confirmed, orange=variance)
- Primary Account balance (editable, syncs to HSBC PPR account)
- Min Forward Balance projection
- YTD Budget vs YTD Actual tracking
- Brad Savings YTD tracker
- Each week shows:
  - Due items with Expected, Actual, Week Variance, YTD Variance, Status, Comment
  - All non-due items listed below a "Not due this week" separator (dimmed)
  - All 6 contribution items always visible
- Confirm/adjust workflow: click status button to confirm, edit actual to adjust
- Week Summary card with net cashflow

### Accounts Dashboard
- Banking: HSBC PPR (redraw), HSBC Investments, NAB Family CC, NAB Business CC, ANZ (Cranbourne rent), Westpac (Brad/Mentone rent), Bankwest (Diana)
- Investments: Interactive Brokers (UK/other), Selfwealth (AU/US)
- Superannuation: AMP Brad, AMP Diana
- All balances editable, HSBC PPR syncs to planner primary account
- Net Position summary (Assets - Liabilities)

### Import
- NAB credit card CSV parser
- Source column showing card number
- Auto-suggest GL line from merchant mappings and NAB categories
- GL dropdown grouped: Secondary Liabilities first, then Personal (Brad/Diana), Primary, Other
- "Auto" checkbox to remember merchant→budget line mappings
- Merchant Mappings table showing all saved rules grouped by budget line, with delete
- Search filters: text search, budget line dropdown, source dropdown
- Deduplication: tracks applied transaction hashes, flags duplicates on re-import
- "Apply to Planner" pushes actuals and itemised charge comments to weekly planner

### Hosting & Data
- GitHub Pages: https://metalbee66.github.io/financial-planner/
- Firebase Realtime Database (Singapore region) for shared data
- Google Sign-In authentication (metalbee66@gmail.com, dianaleshcheva@gmail.com)
- Real-time sync across devices
- Falls back to localStorage when offline

## Known Issues / Future Work
- Section column alignment could be tighter across Income/Outgoings/Split/Residual
- Planner formatting could use further polish
- Import tab: bank API integration placeholder (not yet functional)
- GL mapping memory not yet synced via Firebase (localStorage only on gl_mappings)
- No CSV parsers for HSBC, ANZ, Westpac, Bankwest yet
