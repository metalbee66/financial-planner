# Business Transformation Planner — Session Handover

**Purpose.** Orient a fresh Claude session to the **SenseAi business-transformation project** that now lives in Brad's Family Planner. The session is expected to walk through the project with Brad, update task statuses based on his verbal progress reports, and surface anything blocked or stale.

**Source of truth.** The Family Planner Projects module — https://metalbee66.github.io/financial-planner/. Sign in as Brad (`metalbee66@gmail.com`) for full read/write access; Diana (`dianaleshcheva@gmail.com`) has the same access. Data persists in Firebase RTDB under `household/family/projects/{items, tasks, ...}`.

**Embedded seed.** The full project tree is committed to the repo at [app/js/modules/projects/seed-businesstransform.js](../js/modules/projects/seed-businesstransform.js) under the `BUSINESS_TRANSFORM_SEED` export — that file is the canonical pre-edit structure if the live data has drifted.

---

## 1. What's in the planner

Ten projects, all created on first boot after v2.0.1 (2026-05-24). All projects have `participants = ['brad', 'diana']` and `status = 'active'`.

| # | Project | Owner | End date | Top-level tasks | Notes |
|---|---|---|---|---|---|
| 0 | **Milestones** | brad | 2026-07-01 | 12 (all `isMilestone: true`) | Cross-cut checkpoints — see §3 |
| 1 | **Stream 1 — CRM build** | brad | 2026-05-31 | 7 | Critical path for n8n automation in Stream 4 |
| 2 | **Stream 2 — Tech infrastructure** | brad | 2026-05-31 | 5 | Cloudflare, M365, S12 Pro, SEi14 Geekom, SharePoint |
| 3 | **Stream 3 — Client VM migration** | brad | 2026-05-31 | 2 | Audit (Diana) → build VMs on SEi14 (Brad) |
| 4 | **Stream 4 — AI agents & automation** | brad | 2026-05-31 | 7 | **Depends on SEi14 + CRM API being live** |
| 5 | **Stream 5 — Legal & corporate structure** | brad | 2026-07-01 | 8 | Pty Ltd as trustee. Hard cutover 2026-06-28 |
| 6 | **Stream 6 — SOPs & knowledge base** | brad | 2026-05-31 | 4 | Lives on SharePoint under `/Internal/SOPs/` |
| 7 | **Stream 7 — Managed endpoint service** | brad | 2026-05-31 | 4 | Beelink Mini S12 Pro as the standard client device |
| 8 | **Stream 8 — Growth & acquisition** | brad | 2026-12-31 | 3 | Longer horizon — target 50 clients pre-first-hire |
| 9 | **Adhoc — Diana** | diana | (none) | 5 | `[Template]`-prefixed templates Diana duplicates as needed |

The string `subtasks: []` on each source task expanded into real child tasks with `parentTaskId` set, so the planner shows them indented under their parent in the list view. There are **~280 child tasks** in total across the 9 streams + Milestones project.

---

## 2. Stream-by-stream summary

### Stream 1 — CRM build (7 tasks)
A Flask monolith for client / pipeline / device management. Top-level tasks are roughly phased: Phase 1 (auth + clients + tasks + 10-client migration), Phase 2 (pipeline + dashboard + REST API for n8n), Phase 3 (quote builder + PDF + pipeline reports). The REST API at `s1_t6` is the contract Stream 4 depends on — no n8n agent ships before that lands.

### Stream 2 — Tech infrastructure (5 tasks)
Cloudflare DNS, M365 with Zoho migration, Mini S12 Pro setup, SEi14 Geekom (Hyper-V + Docker + Flask + n8n), and SharePoint document migration. SEi14 unlocks Streams 3, 4, and 6 (SOPs live on SharePoint). The DNS and M365 tasks should land before the Stream 5 entity transfer at 2026-06-28 because the new entity needs M365 mail under the business domain.

### Stream 3 — Client VM migration (2 tasks)
Diana's audit of client-specific software on her PC is the dependency for Brad's VM builds on SEi14. Goal: Diana's local machine has **zero** client software installed by the time this stream is done — everything runs in client-named VMs accessed via RDP over Tailscale.

### Stream 4 — AI agents & automation (7 tasks)
Seven n8n agents. Order: n8n setup → Xero health sync → Client onboarding → Monthly reporting → BAS preparation → Acquisition follow-up → Health + device monitoring. All n8n-to-CRM communication is REST API only — never direct DB writes. The first agent (Xero health sync at 7:15am AEST) requires the warehouse from sensei's existing daily sync pipeline.

### Stream 5 — Legal & corporate structure (8 tasks)
Owner-led (no external advisors). Critical sequencing: confirm structure → confirm name → Diana TPB obligations → Director IDs → ASIC company registration (single day) → ABN/GST/PAYG → bank account → hard cutover on **2026-06-28**. Each step has a hard prerequisite on the one before. The 2026-07-01 milestone "Trading as company" is the official switch-over date.

### Stream 6 — SOPs & knowledge base (4 tasks)
SharePoint structure first → Diana's bookkeeping SOPs → Brad's business SOPs (onboarding / quoting / VM setup / device provisioning / exit / staff onboarding) → templates library (engagement letter, quote, monthly report, BAS covering, lease addendum, exit letter, staff offer letter).

### Stream 7 — Managed endpoint service (4 tasks)
Validate the S12 Pro as a client device → write the under-90-minute provisioning SOP → commercial model + lease agreement → bulk inventory (initial order: 5 units, reorder trigger at 2 units). The lease addendum from Stream 6 + the CRM device module from Stream 1 are both prerequisites for the commercial model.

### Stream 8 — Growth & acquisition (3 tasks)
Capacity model (current vs AI-augmented), acquisition channels setup, and service tier definition + pricing (Essentials / Standard / Managed). Stream 8 has the longest deadline (2026-12-31) — it kicks off in May but runs through the back half of the year. The "Hiring trigger: 80% utilisation" rule lives on the capacity model card.

### Adhoc — Diana (5 templates)
Reusable templates: bank reconciliation catch-up, adhoc financial report, data entry correction, client query response, adhoc payroll run. Each renders with a `[Template]` prefix in the task list. When Diana hits one of these adhoc cases, the workflow is to duplicate the template task into the relevant client's project — Family Planner doesn't have a "create from template" UI yet, so she copies fields manually.

---

## 3. Milestones — cross-cut deadlines

The 12 milestones are flagged as `isMilestone: true` so they render with a ◆ diamond on the row and appear in the Timeline view as diamond glyphs (instead of bars).

| # | Date | Milestone | Linked stream(s) |
|---|---|---|---|
| 1 | 2026-04-18 | CRM MVP live | Stream 1 (Phase 1 complete) |
| 2 | 2026-04-22 | Mini S12 Pro configured | Stream 2 + Stream 7 |
| 3 | 2026-04-30 | Tech infrastructure complete | Stream 2 (broad) |
| 4 | 2026-05-16 | SharePoint migration complete | Stream 2 `s2_t5` |
| 5 | 2026-05-31 | SEi14 live | Stream 2 `s2_t4` |
| 6 | 2026-05-31 | AI agents operational | Stream 4 (full set) |
| 7 | 2026-05-31 | SOPs complete | Stream 6 (full set) |
| 8 | 2026-06-07 | Director IDs + company registered | Stream 5 `s5_t4` + `s5_t5` |
| 9 | 2026-06-10 | ABN + GST registered | Stream 5 `s5_t6` |
| 10 | 2026-06-14 | Bank account open | Stream 5 `s5_t7` |
| 11 | 2026-06-28 | Business transferred to new entity | Stream 5 `s5_t8` (hard cutover) |
| 12 | 2026-07-01 | Trading as company | overall project complete |

The cluster of `2026-05-31` milestones (SEi14 + AI agents + SOPs) is the highest-risk concentration — if any of those slip, the legal stream's June timeline has less buffer.

---

## 4. How to update progress

### Via the planner UI (preferred for ad-hoc updates)

1. Sign in at https://metalbee66.github.io/financial-planner/.
2. Top nav → **Projects**.
3. Click the stream's card.
4. **Inline status change:** click the status dropdown on any task row to mark `not-started → in-progress → review → done → blocked`. Done tasks auto-stamp `completedAt`.
5. **Full edit:** click the task name to open the slide-in panel. Editable: name, description, status, priority, assignees (Brad / Diana / external), start date, due date, milestone toggle, dependencies, comments, file attachments.
6. **Subtasks:** the indented rows below a parent are real tasks too — same edit affordances.
7. **Bulk view:** the **Timeline** view (project detail → "Timeline" tab) shows bars across time so you can spot what's running late at a glance.
8. **Cross-project:** the **Dashboard** sub-tab (Projects → Dashboard) shows aggregate metrics (open / overdue / due-this-week / completed-last-30d / upcoming milestones).

### Via Firebase (only when batching dozens of updates)

The full projects payload lives at `household/family/projects` in the Firebase RTDB linked to project `financial-planner-e85d4`. Schema (relevant parts only):

```
projects/
├── items[]                      [{ id, name, status, statusOverride, startDate, endDate, participants[], description, createdAt, updatedAt, archivedAt }, ...]
├── tasks[]                      [{ id, projectId, parentTaskId, name, description, status, assignees[], startDate, dueDate, priority, dependsOn[], comments[], events[], attachments[], isMilestone, createdAt, updatedAt, completedAt }, ...]
├── pm_dlbooks_migrated_to_projects: true
├── business_transform_seeded:    true
└── pm_dlbooks_cleaned:           true  (after v2.0.2)
```

Tasks are flat under `tasks[]` — the parent/child relationship is via `parentTaskId`. Project membership is via `projectId`. Status values: `not-started | in-progress | review | done | blocked`. Priority: `low | normal | high`. Assignees is `string[]` — `'brad'`, `'diana'`, or any external label.

A patch should bump `updatedAt` on the modified task. Marking a task `status: 'done'` from a non-done state should also set `completedAt = new Date().toISOString()`. The data layer's [data.js](../js/modules/projects/data.js) functions `updateTaskInList`, `addTaskToList`, `deleteTaskFromList` enforce these invariants — prefer those in code.

---

## 5. Suggested session opener

When Brad starts a progress-update session, ask:

1. **Wins since last session** — which top-level tasks moved to `done`? Mark them.
2. **In-flight today** — which tasks are actively being worked on? Move to `in-progress`.
3. **Blockers** — anything stuck? Status `blocked` and add a comment explaining why (the comment goes in `task.comments[]` and shows in the audit feed).
4. **New work** — anything outside the seed that needs to be added? Create new tasks via the UI; the data layer happily accepts ad-hoc tasks that didn't come from the seed.
5. **Date slips** — anything still scheduled for a date that's now unrealistic? Update `dueDate` (and `startDate` if work hasn't started yet).
6. **Stream re-prioritisation** — anything the broader plan should change? Update the project's `description` to note the change and tag it with the date.

The Dashboard sub-tab is a fast way to spot anything that's now overdue — the **Overdue** card flips red when the count is > 0 and the **Smart sort** option in the list view ranks tasks by urgency (overdue × 3 + due-soon × 2 + priority + blocks-others × 2).

---

## 6. Cross-stream dependencies to keep in mind

Some tasks are explicitly gated on work in other streams. The seed file does **not** populate `dependsOn[]` on these (the seed just embedded the structure verbatim) — they're surfaced here so a session walking through progress can flag them.

| Dependent task | Stream | Blocked by | Stream |
|---|---|---|---|
| `s1_t6` "Phase 2: Devices + dashboard + n8n API" | 1 | nothing within the seed — but unlocks Stream 4 entirely | — |
| `s2_t4` SEi14 setup | 2 | none | — |
| `s3_t2` Build client VMs on SEi14 | 3 | `s2_t4` SEi14 live; `s3_t1` Diana's audit | 2, 3 |
| `s4_t1` n8n setup | 4 | `s2_t4` SEi14 live + Docker + n8n container running | 2 |
| `s4_t2`–`s4_t7` (all 6 agents) | 4 | `s4_t1` n8n setup + `s1_t6` CRM REST API | 4, 1 |
| `s5_t5` ASIC company registration | 5 | `s5_t4` Director IDs (both Brad & Diana) | 5 |
| `s5_t6` ABN + TFN + GST + PAYG | 5 | `s5_t5` company registration (ACN issued) | 5 |
| `s5_t7` Business bank account | 5 | `s5_t5` + `s5_t6` | 5 |
| `s5_t8` Hard cutover 28 June | 5 | `s5_t7` bank account open | 5 |
| `s6_t1` SharePoint SOP library | 6 | `s2_t2` M365 setup + `s2_t5` SharePoint migration | 2 |
| `s7_t3` Lease agreement | 7 | `s6_t4` lease addendum template + `s1_t6` CRM device module | 6, 1 |

When updating a "done" status, the session should check the dependants — moving `s4_t1` to `done` is a natural moment to ask Brad whether `s4_t2` is now ready to start.

---

## 7. Pointers

- **Seed source:** [app/js/modules/projects/seed-businesstransform.js](../js/modules/projects/seed-businesstransform.js) — both the literal `BUSINESS_TRANSFORM_SEED` payload and the mapper.
- **Data model:** [app/js/modules/projects/data.js](../js/modules/projects/data.js) — schema + pure helpers used by every read/write path.
- **Live data:** Firebase RTDB at `household/family/projects` (project `financial-planner-e85d4`).
- **Live UI:** https://metalbee66.github.io/financial-planner/.
- **Release notes:** [app/CHANGELOG.md](../CHANGELOG.md) — v2.0.1 entry covers the seed; v2.0.2 covers the legacy `pm_dlbooks` cleanup that ran alongside.
- **Original Asana board (Brad locked out):** the project tree was preserved in a Claude share at `https://claude.ai/share/d162fea2-bb74-48f1-a15a-4525bcb143e4`. The structure embedded in the seed file is the canonical version going forward.
- **SenseAi business plan (parent project):** lives at `E:\Projects\SenseAi\Business_Project_Plan.md` (off-repo) — the n8n / M365 / Geekom infrastructure side of this work is tracked there. Family Planner's own [user-actions.md](user-actions.md) cross-references that file under "Pre-Phase-6".

---

## 8. Things this handover deliberately does not contain

- **Per-task progress.** That's what Brad reports verbally each session. The planner is the recorded state.
- **The full ~280-task list.** Read it from the seed file or directly from the planner — duplicating it here would rot the moment a task gets renamed.
- **Dependency arrows in the Timeline view.** PB.4 was shelved in v2.0.0 (straight diagonals cut through intervening rows; needed Manhattan routing). Dependencies render on the per-task panel + a `⛔ Blocked by N` row badge.
- **n8n / Outlook delivery status.** That's tracked in [user-actions.md](user-actions.md) → "Carried into v2.1 backlog". Affects email notifications, not task data.
