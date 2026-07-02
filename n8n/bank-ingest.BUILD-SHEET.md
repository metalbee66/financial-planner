# Bank-scrape ingest — deployment notes (v2.4)

**Status: HSBC + NAB ingest are LIVE on the Geekom (deployed 2026-07-02).** The
`C:\BankScrapes` mount + `NODE_FUNCTION_ALLOW_BUILTIN=fs,path` are in the compose;
both workflows are active on an 8-hour schedule with healthchecks wired. First run
wrote 243 transactions to Firebase `bank_inbox`. Selfwealth + AMP remain AUTHORED
but undeployed (their scrapers aren't built). The steps below are the record of
what was done + the procedure for the remaining two.

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

## The workflows

| File | n8n id | Reads | Writes | Scraper status |
|---|---|---|---|---|
| [`hsbc-ingest.workflow.json`](hsbc-ingest.workflow.json) | `fpHsbcIngest01` | `*.csv` (6 accounts) | `bank_inbox/transactions/{txKey}` | LIVE |
| [`nab-ingest.workflow.json`](nab-ingest.workflow.json) | `fpNabIngest01` | `*.csv` (NAB1 cc) | `bank_inbox/transactions/{txKey}` | **LIVE (2026-06-30)** |
| [`selfwealth-ingest.workflow.json`](selfwealth-ingest.workflow.json) | `fpSelfwealthIngest01` | `*.balance.json` (2) | `bank_inbox/balances/{slug}` | scaffold (no files) |
| [`amp-ingest.workflow.json`](amp-ingest.workflow.json) | `fpAmpIngest01` | `*.balance.json` + `*.csv` (hybrid) | both of the above | scaffold (no files) |

**Deploy HSBC + NAB now** (both scrapers are live + writing files); hold Selfwealth/AMP
until their scrapers are built. NAB reads `/data/bankscrapes/nab` — the same single
`C:\BankScrapes` mount covers it.

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

## Recon (2026-06-26, from the SenseAi session on the Geekom)

Facts confirmed on the live box — they set the exact deploy shape below:

- **n8n is docker-compose**, file `C:\SenseAi\deploy\n8n-compose.yml`, project `n8n`,
  recreated via `docker compose -f n8n-compose.yml --env-file C:\n8n\.env -p n8n up -d`.
  Current `volumes:` = only `n8n_data:/home/node/.n8n`. **`C:\BankScrapes` is NOT
  mounted** → both the mount and the `fs` flag are real compose edits.
- **`NODE_FUNCTION_ALLOW_BUILTIN` is UNSET** → Code nodes currently CANNOT
  `require('fs')`. The flag below is **mandatory, not contingent**.
- n8n **2.19.5**; `n8n import:workflow --input=<file>` is the working import path.
- Credential `Family Planner - Firebase RTDB` / id `9i2uFN81PFlwBaXa` exists (matches
  the workflow JSONs). ✓ no change needed.
- **Only HSBC is scraping.** `C:\BankScrapes\hsbc` has fresh dated files daily;
  `selfwealth` + `amp` folders are **empty** because those scrapers are still
  `TODO(headed)` scaffolds (T2.5/T2.6 unbuilt). **→ Deploy HSBC ingest ONLY now.**
  Selfwealth/AMP ingest waits until their scrapers are built and writing files.

---

## ⚠️ Before deploying — the infra edits (Brad / the Geekom session)

### 1. Add BOTH the bind-mount AND the fs flag to `n8n-compose.yml`  ← REQUIRED, blocks everything

The Code nodes read from these **container** paths (hardcoded as `ROOT`):

| Host (where the scraper writes) | Container path the workflow expects |
|---|---|
| `C:\BankScrapes\hsbc` | `/data/bankscrapes/hsbc` |
| `C:\BankScrapes\selfwealth` | `/data/bankscrapes/selfwealth` |
| `C:\BankScrapes\amp` | `/data/bankscrapes/amp` |

In `C:\SenseAi\deploy\n8n-compose.yml`, add the bind mount to the `n8n` service's
`volumes:` and the fs flag to its `environment:`:

```yaml
    volumes:
      - n8n_data:/home/node/.n8n
      - C:\BankScrapes:/data/bankscrapes:ro      # ← add (read-only; ingest only reads)
    environment:
      # ...existing TZ / N8N_* vars unchanged...
      NODE_FUNCTION_ALLOW_BUILTIN: "fs,path"     # ← add (Code nodes need require('fs'))
```

Then recreate the container:
```
docker compose -f C:\SenseAi\deploy\n8n-compose.yml --env-file C:\n8n\.env -p n8n up -d
```

**Verify both before importing:**
```
docker exec n8n ls -la /data/bankscrapes/hsbc       # must list dated subfolders
docker exec n8n printenv NODE_FUNCTION_ALLOW_BUILTIN # must print: fs,path
```
If the mount is wrong/empty, the ingest emits the sentinel (heartbeat green,
**zero rows written**) — looks healthy, ingests nothing. If the flag is missing,
the Code node throws "Cannot find module 'fs'" on every run. Don't skip either check.

> **Note:** `NODE_FUNCTION_ALLOW_BUILTIN` was confirmed UNSET on this box
> (2026-06-26), so this is mandatory. overdue-scan/queue-stuck didn't need it —
> they're pure and never `require()` anything.

### 2. Import the HSBC workflow + create its healthcheck

> **HSBC + NAB now** (both scrapers are live + writing CSVs). Selfwealth + AMP are
> unbuilt `TODO(headed)` scaffolds writing no files, so hold those until they're
> built. (Their JSONs are ready when they are.)

```
docker cp app/n8n/hsbc-ingest.workflow.json n8n:/home/node/.n8n/
docker cp app/n8n/nab-ingest.workflow.json  n8n:/home/node/.n8n/
docker exec n8n n8n import:workflow --input=/home/node/.n8n/hsbc-ingest.workflow.json
docker exec n8n n8n import:workflow --input=/home/node/.n8n/nab-ingest.workflow.json
```

Then create a healthcheck per workflow + paste its ping URL over the placeholder
in that workflow's **Heartbeat** node:
- healthchecks.io (as `metalbee66@gmail.com`) → **New Check** ×2 — Period **8 h**,
  Grace **2 h** (they ping every 8 h; ~10 h of silence → DOWN catches a dead
  workflow):
  - `FamilyPlanner-HsbcIngestCron` → into `fpHsbcIngest01` (over `REPLACE-WITH-HsbcIngestCron-UUID`)
  - `FamilyPlanner-NabIngestCron` → into `fpNabIngest01` (over `REPLACE-WITH-NabIngestCron-UUID`)

### 3. Verify with one manual run each (the real end-to-end test)

In the n8n UI → open each workflow → **Execute Workflow**:
- **Busy path:** with today's CSVs present (`hsbc/` has 6, `nab/` has `nab1-cc3696.csv`),
  expect the Code node to output N rows, **Write transaction row** to PUT them,
  Heartbeat green. Then open the app: **Import tab → "Bank inbox" card** shows the
  new count (NAB rows show source "NAB") → "Load into review" drops them in.
- **Idempotency:** Execute twice → the second run overwrites the same `txKey`s,
  the app shows no duplicate rows.
- **Quiet path** (optional): rename the dated folder away briefly → Execute →
  Code outputs the **sentinel only**, no PUT, Heartbeat still green. (Put it back.)

### 4. Activate

Toggle `fpHsbcIngest01` + `fpNabIngest01` **Active**. **NOTE:** CLI activation needs
a `docker restart n8n` to take effect (the UI toggle is hot) — see
[routines.md](file:///C:/Users/brads/.claude/routines.md).

These are **schedule-triggered** (not webhook) workflows — the same shape as the
already-live `fpOverdueScan01` / queue-stuck, which activated fine via UI-toggle
(or `update:workflow --active=true`) + `docker restart`. Use that path first.

> **If activation doesn't "take"** (workflow imports but never fires, or the
> startup log says `Processed N draft workflows, 0 published workflows`), the
> SenseAi deploy procedure has a hardened 4-step for this box —
> `import → publish:workflow --id=… → set active=1 in the DB (deploy/n8n-workflows/_activate.js) → docker restart`.
> That was proven necessary for **webhook** workflows on this same n8n; fall back
> to it if the simple path leaves the ingest stuck as a silent draft. (`update --active`
> can be a deprecated no-op depending on n8n build — the `publish` step is what makes
> `active=1` actually take effect.) See `E:\Projects\SenseAi\deploy\n8n-workflows\README.md`.

### 5. Later — Selfwealth + AMP (when their scrapers exist)

Same steps per workflow (`fpSelfwealthIngest01`, `fpAmpIngest01`), each with its
own healthcheck (`FamilyPlanner-{Selfwealth,Amp}IngestCron`). The mount + fs flag
from step 1 already cover all four, so it's just import + healthcheck + verify +
activate once `C:\BankScrapes\{selfwealth,amp}` start filling.

---

## After it's live

- Tick **T7** in `app/tasks/todo.md` (HSBC + NAB done; note S/W + AMP deferred to
  their scrapers); record the mount + flag + healthcheck + verify steps in
  `app/tasks/user-actions.md`.
- Add the HSBC + NAB workflows + `FamilyPlanner-{Hsbc,Nab}IngestCron` to
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
