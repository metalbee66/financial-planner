# Family Planner — Changelog

## v2.0.0 (in progress) — Modular monolith + Projects module

Rebranding "Financial Planner" → "Family Planner" and restructuring the app into a modular monolith. The existing finance features become the **Finance** module; a new **Projects** module (Asana-like project management) is added alongside. Future modules slot into the same registry. See [tasks/plan.md](../tasks/plan.md) for the full plan.

### Phase 0 — Rebrand & Modular-Monolith Conversion (complete, 2026-04-28)

- **Task 0.1** — Rebrand visible labels: title, header h1, login card heading → "Family Planner". GitHub repo, Firebase project ID, and live URL deferred. (commit `5a988f7`)
- **Task 0.2** — Convert all JS to native ES modules. Adds `state.js` as the single shared mutable-state container. Drops the `patchSaveFunctions` reassignment trick and `window._budgetData` global. No behavior change. (commit `2f8c88f`)
- **Task 0.3** — Module registry + thin shell. `index.html` reduced to header + `#top-nav` + `#module-host`. New `shell.js` mounts modules from `modules.js` registry. Existing finance code moves into `js/modules/finance/`; PM DLBooks moves into `js/modules/pm-legacy/` pending Phase 8 migration. (commit `83bcd04`)
- **Task 0.4** — Projects module skeleton: empty-state stub registered as third top-level module. (commit `3b73808`)

### Phase 1 — Projects CRUD (complete, 2026-04-30)

- **Task 1.1** — Project entity CRUD: schema (id, name, status, dates, participants, description, timestamps, archive flag), in-browser test runner at `/tests.html` (20 unit tests for the data layer), list view with project cards, create/edit form with inline validation (rejects end < start), delete-with-confirm. Persists via the new Firebase `projects` key with realtime listener for cross-device updates. (commit `0c93b0f`)
- **Task 1.2** — Participant management: built-in Brad/Diana toggles plus a free-text "+ add participant" input with removable external chips. Removing an assigned participant prompts a warning (currently a no-op hook; wires up live in Task 2.1). Chip renderer exported as a shared helper. (commit `fd8055d`)

### Phase 2 — Tasks & Subtasks (in progress, 2026-05-02)

- **Task 2.1** — Task entity within a project: full task data layer (schema, validation, list mutators, completedAt auto-stamp on done transition); flat `tasks[]` array stored alongside `items[]` under the existing `projects` Firebase key for trivial cross-project aggregation in Phase 5; new project detail view with inline add row (name + assignee + due date, Enter submits with focus retention for rapid entry); task rows with inline status dropdown (per-status colour, persists on change), assignee chip, due date (red when overdue), delete; slide-in detail panel (right-side, CSS transform) for full edit; cascade delete drops a project's tasks in one save; project cards show `N/M open` stats. 18 new pure-data unit tests in `data.test.js`. (commit `38261be`)
- **Playwright E2E harness** — first automated browser tests in this repo. 18 tests in `tests-e2e/smoke.spec.js` cover Phase 1.1 / 1.2 / 2.1 acceptance criteria plus a Phase 0 module-shell regression check. Firebase blocked at the network layer for hermetic runs. Run via `npm run test:e2e` (~80s). Full setup at `app/playwright.config.js`. (commit `76a8678`)
- **Task 2.2** — Subtasks (one level deep, `parentTaskId`) — pending.

### Phase 3+ (pending)

See [tasks/plan.md](../tasks/plan.md) for the full breakdown. Next up after 2.2: dependencies/comments/audit/attachments/milestones, per-project views (list/timeline/calendar), cross-project views, **email notifications via n8n + M365 Outlook**, celebrations, local AI helpers, and final retirement of the PM DLBooks tab.

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
