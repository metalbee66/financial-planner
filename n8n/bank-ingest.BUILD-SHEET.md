# Bank-scrape ingest — deployment notes (v2.4)

**Status: 3 workflows AUTHORED + locally verified, NOT yet deployed. Deploy is
blocked on one infra step Brad must do on the Geekom (the volume mount).**

The three ingest workflows are the missing bridge in the v2.4 bank pipeline:

```
scraper (Playwright) → writes files to C:\BankScrapes\{bank}\<date>\
   → [THESE WORKFLOWS] n8n reads the files → PUT to Firebase bank_inbox
   → browser realtime listener → Import-tab "Bank inbox" card (transactions)
                                 / accounts auto-populate (balances)
```

Parse logic is unit-tested in [`bank-ingest.code-node.js`](bank-ingest.code-node.js)
(`node app/n8n/bank-ingest.code-node.js` → **40/40**, incl. real-filesystem
directory-ingest tests). The embedded Code-node JS in each workflow was run
against real fixtures and matches the tested logic exactly (HSBC 2 rows,
Selfwealth validate-and-drop, AMP hybrid balance+transaction).

**Host:** <https://n8n.dlbooks.com.au/> · container `n8n` on the Geekom
(`100.67.178.56`) · n8n 2.19.5 · TZ Australia/Melbourne. Deploy via
SSH→`docker exec n8n` (no n8n API key needed), same as overdue-scan / queue-stuck.

---

## The three workflows

| File | n8n id | Reads | Writes |
|---|---|---|---|
| [`hsbc-ingest.workflow.json`](hsbc-ingest.workflow.json) | `fpHsbcIngest01` | `*.csv` (6 accounts) | `bank_inbox/transactions/{txKey}` |
| [`selfwealth-ingest.workflow.json`](selfwealth-ingest.workflow.json) | `fpSelfwealthIngest01` | `*.balance.json` (2) | `bank_inbox/balances/{slug}` |
| [`amp-ingest.workflow.json`](amp-ingest.workflow.json) | `fpAmpIngest01` | `*.balance.json` + `*.csv` (hybrid) | both of the above |

All three: **Schedule (every 15 min)** → one **Code node** that reads the mounted
folder via `require('fs')` and emits rows → route → **PUT to Firebase** → **Heartbeat**.

### Why one fs-reading Code node (the load-bearing design)

The naive shape — a *Read Files* node → Code node — has the **empty-items trap**:
on a quiet poll the Read node returns 0 items, so every downstream node (incl. the
Code node that would emit the sentinel) receives 0 input and **does not run**, and
the heartbeat never fires (the same class of bug as the v2.1.1 InstantDrainer
short-circuit). PROVEN on this n8n that `alwaysOutputData` does NOT rescue a
zero-input downstream node.

The fix: the Code node runs off the **always-present Schedule item** and does the
file reading itself (`fs.readdirSync` / `fs.readFileSync`). It therefore always
runs, and always emits ≥1 item — real rows, or a single sentinel on a quiet day.
The dual-filter sentinel (HSBC/Selfwealth) / 3-way Switch (AMP) routes it:

- **busy day:** rows → PUT → Heartbeat (heartbeat downstream of the write, so a
  Firebase write failure stops the ping — dead-man's-switch holds).
- **quiet day:** sentinel bypasses the writer straight to Heartbeat (fires once).

### Idempotency (no dedupe state needed)

Transactions are keyed by `txKey = dateStr|amount|details|account` (RTDB-safe).
Re-reading the same CSV PUTs the same key → **overwrites in place, never
duplicates.** So the ingest is stateless and the scraper does NOT need to delete
files after a run (re-ingesting yesterday's CSV is a harmless no-op). The browser
then dedups a *second* time on apply via `state.storedTransactionHashes`.

### Timezone safety (a bug caught during the build)

Transaction `date` is stored as a **date-only `YYYY-MM-DD`** built from local
calendar components, NOT `.toISOString()`. A local-midnight Date → `.toISOString()`
shifts to the **previous UTC day** in a positive-offset zone (the Geekom is
Melbourne, UTC+10/+11), which would push every transaction back a day. The
code-node has a regression guard for this (test 7b).

---

## ⚠️ Before deploying — the ONE infra step (Brad, on the Geekom)

### 1. Bind-mount the scrape folder into the n8n container  ← REQUIRED, blocks everything

The Code nodes read from these **container** paths (hardcoded as `ROOT`):

| Host (where the scraper writes) | Container path the workflow expects |
|---|---|
| `C:\BankScrapes\hsbc` | `/data/bankscrapes/hsbc` |
| `C:\BankScrapes\selfwealth` | `/data/bankscrapes/selfwealth` |
| `C:\BankScrapes\amp` | `/data/bankscrapes/amp` |

Add the volume to the n8n container. If n8n runs via `docker-compose`, add under
the `n8n` service (then `docker compose up -d` to recreate):

```yaml
    volumes:
      - C:\BankScrapes:/data/bankscrapes:ro
```

If it runs via plain `docker run`, the mount must be added to the run command /
the container recreated with `-v C:\BankScrapes:/data/bankscrapes:ro`. Read-only
(`:ro`) is correct — the ingest never writes to disk, only reads.

**Verify the mount before importing the workflows:**
```
docker exec n8n ls -la /data/bankscrapes/hsbc
```
should list the dated scrape subfolders. If it errors / is empty, the mount is
wrong and every ingest will just emit the sentinel (heartbeat green, **zero rows
written**) — looks healthy, ingests nothing. Don't skip this check.

> **If the Code node can't use `fs`:** self-hosted n8n allows built-ins via
> `NODE_FUNCTION_ALLOW_BUILTIN` (often `*` already). If a deploy run errors with
> "Cannot find module 'fs'", set `NODE_FUNCTION_ALLOW_BUILTIN=fs,path` (or `*`) in
> the container env and restart. (overdue-scan didn't need this — it's pure — so
> confirm on the first ingest run.)

### 2. Import + create the 3 healthchecks

For each workflow, replace the placeholder ping URL
(`https://hc-ping.com/REPLACE-WITH-{Hsbc,Selfwealth,Amp}IngestCron-UUID`) in its
**Heartbeat** node with a real one:
- healthchecks.io (as `metalbee66@gmail.com`) → **New Check** ×3:
  `FamilyPlanner-HsbcIngestCron`, `FamilyPlanner-SelfwealthIngestCron`,
  `FamilyPlanner-AmpIngestCron` — Period **1 h**, Grace **1 h** (they ping every
  15 min; missing 4 consecutive pings → DOWN after grace catches a dead workflow).
- Paste each ping URL into the matching workflow's Heartbeat node → Save.

### 3. Verify with one manual run each (the real end-to-end test)

Per-workflow, in the n8n UI → **Execute Workflow**:
- **Busy path:** with real scrape files present, expect the Code node to output N
  rows, the **Write** node(s) to PUT them, Heartbeat green. Then open the app:
  - transactions → **Import tab → "Bank inbox" card** shows the new count → "Load
    into review" drops them into the review table.
  - balances → **accounts view** shows the auto-populated balance with its `asOf`.
- **Quiet path:** with no files (or after the mount check on an empty folder),
  Execute → Code outputs the **sentinel only**, no PUT, Heartbeat still green.
- **Idempotency:** Execute twice with the same files → the second run overwrites
  the same keys, the app shows no duplicate rows.

### 4. Activate

Toggle each workflow **Active**. **NOTE:** CLI activation needs a
`docker restart n8n` to take effect (the UI toggle is hot) — see
[routines.md](file:///C:/Users/brads/.claude/routines.md).

---

## After it's live

- Tick **T7** in `app/tasks/todo.md`; record the mount + healthcheck + verify
  steps as done in `app/tasks/user-actions.md`.
- Add the 3 workflows + 3 healthchecks to
  `C:\Users\brads\.claude\routines.md` (Family Planner workflow table +
  healthchecks table).
- **Only then** is the v2.4 pipeline truly end-to-end — that's the gate for the
  `v2.4` tag (T12). Tagging before a real ingest would claim a pipeline that
  hasn't moved a real row.

## Keep in sync

The CSV parsers (`parseHsbcCsv`/`parseAmpCsv`) and `isValidBalanceRecord` live in
the **browser app** (`app/js/modules/finance/import.js`, `app/js/data.js`). n8n
can't import them, so the logic is re-implemented in
[`bank-ingest.code-node.js`](bank-ingest.code-node.js) and copied into each
workflow's Code node. **If the app parsers change, update the code-node + re-run
its self-check + re-paste into the workflows.**
