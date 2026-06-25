# Queue-stuck check — deployment notes

**Status: workflow DEPLOYED to n8n, INACTIVE, awaiting Brad's 2 finish-up steps + activate.**

The monitor that would have caught the 2026-06-25 BadCredentials outage: the
InstantDrainer reports `status=success` even when every Send Email fails, so a
dead Gmail SMTP credential silently parks rows at `failed:true` while the UI
looks green and inboxes stay empty. This hourly check watches the queue itself
and alerts via **healthchecks.io — not email** (the alert must not depend on the
same SMTP that breaks).

Detection logic is unit-tested in
[`queue-stuck-check.code-node.js`](queue-stuck-check.code-node.js)
(`node app/n8n/queue-stuck-check.code-node.js` → 8/8) and was verified against
the live queue during the build (clean→`clean:true`; one simulated failed row→
`clean:false, stuck:1`). Deployed workflow JSON:
[`queue-stuck-check.workflow.json`](queue-stuck-check.workflow.json) (n8n id
`fpQueueStuckCheck01`).

**Host:** <https://n8n.dlbooks.com.au/> · container `n8n` on the Geekom · n8n 2.19.5 · TZ Australia/Melbourne.

---

## What's deployed

Workflow **`Family Planner: queue-stuck check`** (id `fpQueueStuckCheck01`), 6 nodes:

```
Schedule Trigger (hourly)
  → Get email_queue   GET .../household/family/email_queue.json   [cred: Family Planner - Firebase RTDB]
  → Check             Code: counts rows with failed===true && sent!==true;
                       emits EXACTLY ONE { clean, stuck, total, ids } item
  → Clean?            IF $json.clean === true
       ├─ true  → Heartbeat (up)    GET hc-ping.com/<uuid>        → check stays up
       └─ false → Heartbeat (fail)  GET hc-ping.com/<uuid>/fail   → healthchecks emails Brad
```

**Why healthchecks, not an alert email:** the failure this watches for IS a
broken Gmail SMTP credential. An email alert would use the same credential and
fail to send during the exact outage it's meant to report. The /fail ping forces
the check DOWN immediately (no waiting for the period+grace window).

**Why the Code node always emits one item:** a Code node returning `[]` halts the
downstream chain on this n8n (the empty-items trap that bit the other crons). The
Check node returns one status item on every run — clean or stuck — so the IF and
both Heartbeats always have an item to act on. No sentinel/dual-filter needed
here because the single status item is unconditional.

**What counts as "stuck":** `failed === true && sent !== true` — a row that
exhausted its 3 send retries and wasn't later re-sent. `sent` wins over `failed`
(mirrors the app's `classifyQueueEntry`), so a retried-and-delivered row doesn't
trip the alert. Pending rows are NOT counted — a stalled drainer/scheduler is
already covered by the `FamilyPlanner-InstantDrainerCron` heartbeat.

---

## ⚠️ 2 things to finish before activating (Brad)

### 1. Create the healthcheck + paste its ping URL into BOTH Heartbeat nodes
Both Heartbeat nodes use a placeholder UUID
(`https://hc-ping.com/REPLACE-WITH-QueueStuckCheck-UUID` and the same `+/fail`).
- healthchecks.io (signed in as `metalbee66@gmail.com`) → **New Check**
  - Name: `FamilyPlanner-QueueStuckCheck`
  - Period **1 h**, Grace **1 h** (it pings hourly; also catches the workflow
    itself dying — no ping at all → DOWN after grace)
- Copy its ping URL → open `fpQueueStuckCheck01` in n8n →
  - **Heartbeat (up)** node → paste the plain ping URL over the placeholder
  - **Heartbeat (fail)** node → paste the ping URL **+ `/fail`** over the placeholder
  - Save.

### 2. Verify with one manual run (confirms the assembled wiring + ping routing)
The detection logic is unit-tested and was verified against the live queue, but
the assembled workflow hasn't executed on the live server (the CLI executor
races n8n on port 5679, so it can't be triggered headless — UI only).
- **Clean path:** open `fpQueueStuckCheck01` → **Execute Workflow**. With the
  queue currently clean, expect the **Check** node to output
  `{ clean: true, stuck: 0, ... }` and the **Heartbeat (up)** node to run green.
  Confirm the healthchecks.io check shows a fresh ping / "up".
- **Stuck path:** in the app's email-queue admin (or via Firebase), set one row's
  `failed: true`. Execute again → Check outputs `clean: false, stuck: 1` →
  **Heartbeat (fail)** runs → the healthchecks.io check flips DOWN and emails you.
  Then clear that row (Retry / set `failed:false`) and Execute once more to
  confirm it returns to up.

### 3. Activate
Toggle the workflow **Active** (UI toggle is hot, no restart needed). It will
then run hourly.

---

## After it's live
- Add `Family Planner: queue-stuck check` + the `FamilyPlanner-QueueStuckCheck`
  check to `C:\Users\brads\.claude\routines.md` (it's already noted there as the
  monitor to build; update from "deferred" to live). — done in the build session,
  re-confirm the table row matches the deployed UUID handling.
