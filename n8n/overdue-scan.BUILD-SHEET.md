# Build sheet — `FamilyPlanner: overdue/due-soon scan` (v2.2.1)

Manual n8n-UI assembly. The logic is already written + unit-tested in
[`overdue-scan.code-node.js`](overdue-scan.code-node.js) (`node app/n8n/overdue-scan.code-node.js` → 24/24).
You just wire the nodes and paste the Code body.

**Host:** <https://n8n.dlbooks.com.au/> · **Container TZ:** Australia/Melbourne ·
**Firebase cred:** `Family Planner - Firebase RTDB` (HTTP Query Auth, `auth=<secret>`) ·
**SMTP cred:** reuse the existing InstantDrainer's `Gmail SMTP (bradsmyrkai)` — *or* don't send here at all (see Node 4 note: the simplest build lets the existing InstantDrainerCron do the sending).

---

## Firebase paths (verified against the app 2026-06-23)

Base: `https://<your-db>.firebaseio.com/household/family`

| What | Path | Op |
|------|------|----|
| Projects blob (tasks + prefs + digest_pending) | `/household/family/projects.json` | **GET** |
| Email queue (one row per id) | `/household/family/email_queue/<id>.json` | **PUT** |
| Digest bucket (per user, appended) | `/household/family/projects/digest_pending/<user>.json` | **PATCH/PUT** |

⚠️ **`digest_pending` lives INSIDE `projects`**, not at the root (it's `projects.digest_pending`, a sibling of `tasks`/`prefs`). `email_queue` IS a root sibling. Don't mix these up.

---

## Nodes

```
Schedule (daily 07:00)
   → HTTP GET projects.json   (name: "Get projects")
   → Code  "Scan"             (paste the scan body)
   → Switch on {{$json._target}}
        ├─ "email_queue" → HTTP PUT email_queue/{id}   (name: "Write email row")
        └─ "digest"      → HTTP PATCH digest_pending/{user}  (name: "Append digest")
   → Merge (Append, both Switch branches)
   → Set ("Always Output Data" + "Execute Once")
   → HTTP GET Heartbeat ping URL
```

### 1. Schedule Trigger — `Daily overdue scan`
- Trigger Interval: **Days**, at **07:00** (before the 08:00 digest so an instant
  user's overdue email and a digest user's roll-up don't race the same morning).

### 2. HTTP Request — `Get projects`
- Method **GET**, URL `https://<db>.firebaseio.com/household/family/projects.json`
- Authentication: **Predefined Credential Type → HTTP Query Auth → `Family Planner - Firebase RTDB`**
- Response: JSON. This node returns the whole blob as item[0].json.

### 3. Code — `Scan`
- Mode: **Run Once for All Items**.
- Paste the body of `scan()` from `overdue-scan.code-node.js` — i.e. copy
  everything from the `// ── Constants` block down through the `scan()` function,
  then end the node with:
  ```js
  return scan($input.all());
  ```
- Output: 0..N items, each `{ _target: 'email_queue' | 'digest', ... }`.
  Empty result = `[]` (that's fine — the heartbeat tail still fires once).

### 4. Switch — on `{{ $json._target }}`
- Rule 1: equals `email_queue` → output 0
- Rule 2: equals `digest` → output 1

**Node 4a — HTTP `Write email row`** (Switch output 0)
- Method **PUT**, URL `https://<db>.firebaseio.com/household/family/email_queue/{{ $json.id }}.json`
- Auth: same Firebase cred. Body (JSON, send all fields except the discriminator):
  send `{{ $json }}` but strip `_target` — easiest is a tiny Set node before it,
  or in the Code node push the row without `_target` and carry the route on a
  separate field. (Simplest: in Node 3 keep `_target` only for the Switch, and in
  this HTTP node set the body to the raw entry via an expression that omits it.)
- The existing **InstantDrainerCron** (every 30 min) will pick this row up and
  actually send the email. **You do not need a Send Email node here** — that's the
  whole point of writing to `email_queue`. (This also means overdue emails inherit
  the v2.1.1 heartbeat fix once that lands.)

**Node 4b — HTTP `Append digest`** (Switch output 1)
- Method **PATCH**, URL `https://<db>.firebaseio.com/household/family/projects/digest_pending/{{ $json.user }}.json`
- ⚠️ `digest_pending[user]` is an **array** in the app (`appendDigestEntry` does
  `existing.concat([entry])` — verified in notifications.js:589). Firebase PATCH
  merges keys and can't append to an array atomically, so you **must read-modify-write**:
  - GET `digest_pending/{user}.json` → Code node `arr = ($json || []); arr.push(entry); return [{json:{arr}}]`
    → PUT `digest_pending/{user}.json` with body `{{ $json.arr }}`.
  - Do **not** store digest entries as a keyed object — that would break the app's
    array-based `composeDigestSummary`/`buildDigestEmail` reader and the 08:00 cron.
- Digest mode is the secondary path (default + most users are **instant**). If the
  read-modify-write is fiddly, **ship instant-only first** (Switch with just the
  email_queue branch) and wire digest in a follow-up — overdue emails work without it.

### 5. Merge — `Join`
- Mode **Append**, 2 inputs (from 4a and 4b). This collapses both branches so the
  heartbeat fires once regardless of which/both ran.

### 6. Set — `Force one output`
- Add any field (e.g. `done = true`).
- **Options → "Always Output Data" = ON**, **"Execute Once" = ON**.
- This is the v2.1.1 empty-items fix: on a day with zero overdue tasks the Merge
  receives nothing, but "Always Output Data" emits one item so the heartbeat still
  pings. **Without this the heartbeat short-circuits exactly like the InstantDrainer bug.**

### 7. HTTP Request — `Heartbeat`
- Method **GET**, URL = the ping URL of a new healthchecks.io check
  **`FamilyPlanner-OverdueScanCron`** (period **1 day**, grace **2 h**), created
  under the `metalbee66@gmail.com` healthchecks.io account.
- The ping URL is the secret — keep it in the node only, not in routines.md.

---

## Verify (do this once after wiring, before activating)

1. In the app, set a task: `dueDate` = **yesterday**, assignee = **brad**, status not done,
   and brad's notification prefs = **instant** (the default).
2. n8n → open the workflow → **Execute Workflow** (manual).
   - Expect: one item out of the Code node with `_target: email_queue`; one new row
     under `email_queue/` in Firebase; within ≤30 min the InstantDrainer sends brad an
     `[Family Planner] Overdue: <name>` email.
3. **Execute again** the same day → another `email_queue` row appears (re-notify is
   intentional — every day, no cap; decided 2026-06-23). Confirm you're OK with that
   cadence in practice.
4. Switch brad to **digest** mode, set another overdue task, Execute → entry lands in
   `projects/digest_pending/brad`, **not** in `email_queue`.
5. Empty case: mark the test tasks done, Execute → Code outputs `[]`, but the Set's
   "Always Output Data" still fires the Heartbeat → healthchecks.io check goes/stays UP.
6. **Activate** the workflow.

---

## After it's live

- Tick **v2.2.1** in `app/tasks/todo.md`.
- **v2.2.2:** add the workflow + the `FamilyPlanner-OverdueScanCron` check to
  `C:\Users\brads\.claude\routines.md` (Family Planner workflow table + healthchecks table).
