# Family Planner — Modular Monolith — Task Checklist

Working list derived from [plan.md](plan.md). Manual ops tracked separately in [user-actions.md](user-actions.md). Mark a task complete only when its acceptance criteria + verification both pass.

> **Pre-flight (every session):** commit + push current state per CLAUDE.md before edits. Bracket-check JS files before commit.

---

## Phase 0 — Rebrand & Modular-Monolith Conversion

> **Highest-risk phase.** Refactors existing working code; needs a feature branch and full smoke test.

- [x] **0.1** Rebrand visible labels to "Family Planner" — XS — [plan §0.1](plan.md#task-01-rebrand-visible-labels-to-family-planner) — _done 2026-04-28, commit 5a988f7_
- [x] **0.2** Convert existing JS to native ES modules (no behaviour change) — L — [plan §0.2](plan.md#task-02-convert-existing-js-to-native-es-modules-no-behaviour-change) — _done 2026-04-28, commit 2f8c88f_
- [x] **0.3** Introduce module registry + thin shell (Finance + PM-Legacy modules) — L — [plan §0.3](plan.md#task-03-introduce-module-registry--thin-shell) — _done 2026-04-28, commit 83bcd04_
- [x] **0.4** Bootstrap Projects module skeleton — S — [plan §0.4](plan.md#task-04-bootstrap-projects-module-skeleton) — _done 2026-04-28, commit 3b73808_
- [x] **Checkpoint A**: app rebranded, monolith shape live, full Finance smoke test passes; user reviewed and merged each task

## Phase 1 — Projects CRUD

- [x] **1.1** Project entity CRUD (name, dates, status, description) — M — [plan §1.1](plan.md#task-11-project-entity--create--read--update--delete) — _done 2026-04-30, commit 0c93b0f_
- [x] **1.2** Participant management (brad/diana + external + remove-warning hook) — S — [plan §1.2](plan.md#task-12-participant-management-on-a-project) — _done 2026-04-30, commit fd8055d_
- [ ] **Checkpoint B**: project CRUD round-trips Firebase; user reviews

## Phase 2 — Tasks & Subtasks

- [x] **2.1** Task entity CRUD inside a project — M — [plan §2.1](plan.md#task-21-task-entity-within-a-project) — _done 2026-05-02, commit 38261be (Playwright harness in 76a8678)_
- [x] **2.2** Subtasks (one level deep, `parentTaskId`) — M — [plan §2.2](plan.md#task-22-subtasks-one-level-deep-parenttaskid) — _done 2026-05-03, commit c276906_
- [ ] **Checkpoint C**: task hierarchy persists correctly; user reviews

## Phase 3 — Task Richness

- [x] **3.1** Task dependencies + cycle detection — M — [plan §3.1](plan.md#task-31-task-dependencies--cycle-detection) — _done 2026-05-04, commit 116db1e_
- [x] **3.2** Comments thread (append-only) — S — [plan §3.2](plan.md#task-32-comments-thread-on-a-task) — _done 2026-05-04_
- [x] **3.3** Activity / audit-trail feed — M — [plan §3.3](plan.md#task-33-activity--audit-trail-feed-on-a-task) — _done 2026-05-04_
- [x] **3.4** File attachments (inline ≤500 KB + URL refs) — M — [plan §3.4](plan.md#task-34-file-attachments-inline--url-refs) — _done 2026-05-04_
- [x] **3.5** Milestone flag — S — [plan §3.5](plan.md#task-35-milestone-flag-on-tasks) — _done 2026-05-04_
- [ ] **Checkpoint D**: full task richness in two-user smoke test; user reviews

## Phase 4 — Per-Project Views

- [x] **4.1** List view (sort, group, filter) — M — [plan §4.1](plan.md#task-41-list-view-with-filtering--grouping) — _done 2026-05-07_
- [x] **4.2** Timeline (Gantt, month zoom + milestones; dep-arrow overlay removed 2026-05-19 — see PB.4 below) — L — [plan §4.2](plan.md#task-42-timeline-view-gantt-style-month-zoom) — _done 2026-05-07_
  - [x] 4.2a Bars only, no deps — _done 2026-05-07_
  - [x] 4.2b Dependency arrows + milestones overlay — _done 2026-05-07_
- [x] **4.3** Calendar (month grid) — M — [plan §4.3](plan.md#task-43-calendar-view-month-grid) — _done 2026-05-07_
- [ ] **Checkpoint E**: three views render against same data; user reviews

## Phase 5 — Cross-Project Views

- [x] **5.1** Overview tab (all projects at a glance) — M — [plan §5.1](plan.md#task-51-overview-tab-all-projects-at-a-glance) — _done 2026-05-07_
- [x] **5.2** Per-user summary tab — M — [plan §5.2](plan.md#task-52-per-user-summary-tab) — _done 2026-05-08_
- [x] **5.3** Dashboard tab (metrics + mini bar chart) — M — [plan §5.3](plan.md#task-53-dashboard-tab) — _done 2026-05-09_
- [x] **5.4** Files summary by project — S — [plan §5.4](plan.md#task-54-files-summary-by-project) — _done 2026-05-12_
- [x] **Checkpoint F**: aggregate views perform on 5+ projects, 50+ tasks; user reviewed _2026-05-15_ — 14 clean passes, 2 pass-with-caveat (Timeline dep arrows PB.4, Dashboard chart scaling PB.5), 0 fails. Backlog of polish findings below.

### Polish backlog — Phase 5 smoke findings (2026-05-15)

Not blocking Phase 6 — pick up between phases or as standalone polish.

- [x] **PB.1** Autofocus Name field on new-project form — XS — _smoke ad hoc_ — _done 2026-05-19, `94cbe78`_
- [x] **PB.2** Dropdown options low contrast / hard to read across the app (deps picker + others) — S — _smoke steps 5, 9_ — _done 2026-05-19, `1f28614`_
- [x] **PB.3** "Reset filters" button on list-view toolbar — XS — _smoke step 9_ — _done 2026-05-19, `94cbe78` (button only renders when state is non-default)_
- [x] **PB.4** Timeline dep arrows: **SHELVED 2026-05-19.** Three rounds of fixes (`16b4f10` y-offset + arrowheads, `70ca556` SVG-width, `7fe169e` visibility boost) all produced straight diagonals that cut through intervening rows. Arrows removed entirely from the Timeline view in the shelving commit. Dep relationships still surface on the per-task panel (Dependencies section) and via the `⛔ Blocked by N` row badge in List view. Proper visualisation would need Manhattan routing (right-angle doglegs) — not in PB-scope; revive under a Phase 7+ task if Brad wants it back.
- [x] **PB.5** Dashboard chart: bar/label scaling distorts when one bucket dominates (label clips, no headroom) — S — _smoke step 14_ — _done 2026-05-19, `cb17652` (chartMax rounds up ≥ max+1 or 1.2× max)_
- [x] **PB.6** Firebase SDK Cross-Origin-Opener-Policy warnings on sign-in popup (cosmetic; consider SDK upgrade or `signInWithRedirect`) — XS — _smoke step 16_ — _done 2026-05-19, `94cbe78` (switched popup → redirect)_
- [ ] **PB.7** Project status doesn't reflect task completion (100% done can sit at "planning") — needs spec: auto-promote vs suggestion banner vs derive — S spec + S impl — _smoke step 12_
- [ ] **PB.8** Dashboard cards should drill down to a filtered task list (e.g. click "Due this week" → list of project·task) — M — _smoke step 14_
- [ ] **PB.9** Joint-assignee support (Brad + Diana on one task) — needs spec: multi-select assignees vs "Joint" pseudo-value; ripples through sort/group/filter/My-Tasks bucketing/audit format — M spec + L impl — _smoke step 10_

## Phase 6 — Email Notifications via n8n + In-App Bell

> Needs n8n + M365 set up — see [user-actions.md → Pre-Phase-6](user-actions.md#pre-phase-6-n8n--m365-infrastructure-for-email).

- [x] **6.1** Audit-event → notification trigger map — M — [plan §6.1](plan.md#task-61-audit-event--notification-trigger-map) — _done 2026-05-15, pure mapper + 61 new unit tests; harness now 251 unit cases (still 112 E2E)_
- [ ] **6.2** In-app bell + per-user preferences UI — M — [plan §6.2](plan.md#task-62-in-app-bell--per-user-preferences-ui)
- [ ] **6.3** Email queue write + n8n workflow — M — [plan §6.3](plan.md#task-63-email-queue-write--n8n-workflow)
- [ ] **6.4** Daily digest mode — M — [plan §6.4](plan.md#task-64-daily-digest-mode)
- [ ] **6.5** Email queue admin panel — S — [plan §6.5](plan.md#task-65-email-queue-admin-panel)
- [ ] **Checkpoint G**: two-user notification flow + daily digest tested end-to-end; user reviews

## Phase 7 — Celebrations & Local AI

- [ ] **7.1** Celebrations (confetti / emoji rain / chime, randomized pool) — M — [plan §7.1](plan.md#task-71-celebration-animations-on-task-complete--milestone--project-complete)
- [ ] **7.2** Local AI helpers (autocomplete, due-date guess, daily digest, stale flag, smart-sort) — M — [plan §7.2](plan.md#task-72-local-ai-helpers-no-api-calls)
- [ ] **Checkpoint H**: celebrations + AI feel polished; user reviews

## Phase 8 — Migrate PM DLBooks → Projects

- [ ] **8.1** Data migration (idempotent, preserves original) — S — [plan §8.1](plan.md#task-81-data-migration)
- [ ] **8.2** Retire PM DLBooks legacy module + update CHANGELOG — XS — [plan §8.2](plan.md#task-82-retire-pm-dlbooks-tab)
- [ ] **8.3** Walk through [user-actions.md](user-actions.md) with user, tick or defer every item, tag v2.0.0
- [ ] **Checkpoint I — DONE**: tagged release, HANDOVER updated

---

## Resolved decisions (from review)

See [plan.md → Resolved Decisions](plan.md#resolved-decisions-from-review). The four still-open items are tracked as "Decisions still pending" in [user-actions.md](user-actions.md).
