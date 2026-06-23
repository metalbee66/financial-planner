# Overdue/due-soon scan — deployment notes (v2.2.1)

**Status (2026-06-23): workflow DEPLOYED to n8n, INACTIVE, awaiting Brad's verify + activate.**

Built + deployed via SSH→`docker exec n8n` (no n8n API key needed). The scan logic
is unit-tested in [`overdue-scan.code-node.js`](overdue-scan.code-node.js)
(`node app/n8n/overdue-scan.code-node.js` → 24/24). The deployed workflow JSON is
[`overdue-scan.workflow.json`](overdue-scan.workflow.json) (n8n id `fpOverdueScan01`).

**Host:** <https://n8n.dlbooks.com.au/> · container `n8n` on the Geekom (`100.67.178.56`) ·
n8n 2.19.5 · TZ Australia/Melbourne.

---

## What's deployed

Workflow **`Family Planner: overdue/due-soon scan`** (id `fpOverdueScan01`), 7 nodes:

```
Schedule Trigger (daily 07:00)
  → Get projects        GET .../household/family/projects.json   [cred: Family Planner - Firebase RTDB]
  → Scan                Code: emits 1 row per instant-mode overdue/due-soon assignee,
                         OR one {_sentinel:true} item on a quiet day
  → Scan fans out to two filters:
       ├─ Rows only      (keep _sentinel == false) → Write email_queue row (PUT) → Heartbeat
       └─ Sentinel only  (keep _sentinel == true)  → Heartbeat
```

**Why the dual filter (the load-bearing design):** PROVEN live on this n8n —
a Code node returning `[]` halts the entire downstream chain, and a node's
`alwaysOutputData` does NOT rescue a node that receives zero input items. So a
naive `Scan → … → Heartbeat` chain would skip the heartbeat on every quiet day
(the same class of bug as the v2.1.1 InstantDrainer short-circuit). The sentinel
guarantees Scan always emits ≥1 item; the two filters route it:
- **busy day:** real rows → Write → Heartbeat (heartbeat is downstream of Write,
  so a Firebase write failure stops the ping — dead-man's-switch holds).
- **quiet day:** the sentinel bypasses Write straight to Heartbeat (fires once).
- **GET projects fails:** chain dies before Scan → no ping → healthchecks alerts.

**Cadence:** re-notify every day, no cap, no dedupe (Brad's decision 2026-06-23).
The scan is stateless — a still-overdue task re-emails daily until done / due-date changes.

**Instant-only:** digest-mode users are not handled yet (deferred follow-up, v2.2.x).
Most users are instant (the default), so overdue email works now.

---

## ⚠️ 3 things to finish before activating (Brad, in the n8n UI)

### 1. Create the healthcheck + paste its ping URL into the Heartbeat node
The Heartbeat node's URL is a placeholder: `https://hc-ping.com/REPLACE-WITH-OverdueScanCron-UUID`.
- healthchecks.io (signed in as `metalbee66@gmail.com`) → **New Check**
  - Name: `FamilyPlanner-OverdueScanCron`
  - Period **1 day**, Grace **2 h**
- Copy its ping URL → open `fpOverdueScan01` in n8n → **Heartbeat** node → paste over the placeholder → Save.
  (Until you do this the heartbeat GETs a dead URL — harmless, just unmonitored.)

### 2. Verify with one manual run (this is the real end-to-end test)
The logic is unit-tested and the wiring round-trips correctly, but the assembled
workflow has not yet executed on the live server (the CLI executor races the
running n8n on port 5679, so I couldn't trigger it headless).
- In the app: set a task `dueDate` = **yesterday**, assignee **brad** (or you),
  status not done, brad's notification prefs = **instant** (the default).
- In n8n: open `fpOverdueScan01` → **Execute Workflow** (manual).
  - Expect: Scan outputs 1 row; **Write email_queue row** writes one
    `email_queue/eq_scan_*` entry; the Heartbeat node turns green.
  - Within ≤30 min the existing **InstantDrainer** sends brad an
    `[Family Planner] Overdue: <name>` email. Check the **email_queue admin panel**
    in the app to see the row flip sent.
- **Quiet-day check:** mark the test task done → Execute again → Scan outputs the
  sentinel only, **no** email_queue row is written, Heartbeat still fires green.
- **Re-notify check:** with the overdue task back, Execute twice → a second
  `email_queue` row appears (daily re-notify is intentional — confirm you're OK with it).

### 3. Activate
Toggle the workflow **Active** (top-right). It will then fire daily at 07:00 Melbourne.

### Also: delete the leftover probe workflow
A scaffolding workflow **`PROBE empty-items heartbeat`** (id `probeEmptyItems01`)
is still in the list — it's inactive + harmless (Manual Trigger only, no real
creds), but I couldn't remove it (n8n 2.19.5 has no `delete:workflow` CLI and no
`sqlite3` in the container). Delete it via the UI trash icon when convenient.

---

## After it's live
- Tick **v2.2.1** in `app/tasks/todo.md`.
- **v2.2.2:** add `FamilyPlanner: overdue/due-soon scan` + the
  `FamilyPlanner-OverdueScanCron` check to `C:\Users\brads\.claude\routines.md`
  (Family Planner workflow table + healthchecks table).
