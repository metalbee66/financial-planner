# Family Planner — Manual Action Tracker

Manual ops Brad needs to do that aren't code changes. I (Claude) maintained this list throughout the project and walked through it with Brad at project completion (Phase 8 sign-off).

> **Convention:** items are checked off when **you** confirm they're done; I won't tick them speculatively. Items added by me along the way appear with the date and the task that surfaced them.

**Phase 8 walkthrough — 2026-05-24.** Decisions resolved with Brad; items in-scope for the v2.0.0 release are ticked, deferred items are flagged and rolled forward into the v2.1 backlog at the bottom.

---

## Decisions still pending

| # | Decision | Resolution (2026-05-24) | Notes |
|---|---|---|---|
| D1 | Firebase project rename: keep `financial-planner-e85d4-default-rtdb` or migrate? | **Keep existing.** | Cosmetic mismatch with the new app name accepted; no migration risk taken. Revisit if/when Firebase costs or naming becomes blocking. |
| D2 | GitHub repo rename: `financial-planner` → `family-planner`? | **Keep existing.** | Live URL `metalbee66.github.io/financial-planner/` stays stable. Defer indefinitely. |
| D3 | Email from-address: personal Gmail vs M365 business email? | **M365 business email once that mailbox exists; personal Gmail via app-password SMTP until then.** | Default accepted. Resolved in practice when the n8n workflow is built. |
| D4 | Celebration sound: own asset files, or WebAudio-synthesized? | **WebAudio tones.** | Shipped this way in Task 7.1 — no external assets, opt-in via prefs. |

---

## Pre-Phase-0 (before any code)

- [x] Confirmed editable copy of the plans; Brad reviewed [plan.md](plan.md) + [todo.md](todo.md) throughout.
- [x] Confirmed happy with **native ES modules** as the JS architecture (no bundler, no build step). Shipped in Task 0.2.

## Pre-Phase-6 (n8n infrastructure for email) — DONE 2026-05-26

> All Pre-Phase-6 infra prerequisites cleared in the 2026-05-25/26 session. Both n8n workflows live; Checkpoint G end-to-end verified. See `routines.md` for the live workflow inventory + the auth credential.

- [x] **n8n container running on Geekom** — shared with SenseAi (`https://n8n.dlbooks.com.au/`, Caddy reverse-proxy to `127.0.0.1:5678`, container TZ Australia/Melbourne since 2026-05-26 via `GENERIC_TIMEZONE`).
- [x] **n8n reachable via Tailscale / HTTPS** — `https://n8n.dlbooks.com.au` (Caddy + Cloudflare DNS-01 cert).
- [x] **n8n admin account** — SenseAi-owned, pre-existed.
- [x] **n8n base URL recorded** — `routines.md`.
- [ ] **M365 Outlook credential** — **deferred** (using D3 fallback). The drainer + digest workflows both use the existing `Gmail SMTP (bradsmyrkai)` credential, sending from `bradsmyrkai@gmail.com`. If/when an Azure AD App Registration with `Mail.Send` Graph scope is set up, swap the credential on the two `Send an Email` nodes — no other workflow changes needed.
- [x] **D3 resolved** — using Gmail SMTP fallback in production. Migrate to M365 mailbox when convenient.
- [x] **Firebase REST API auth** — used the legacy **Database Secret** (40-char shared secret) rather than a service-account JSON. Wired in n8n as the HTTP Query Auth credential **`Family Planner - Firebase RTDB`** (param `auth`). Secret was generated 2026-05-25 via Firebase Console → Project Settings → Service Accounts → Database secrets. Note: deprecated by Firebase but still works; revisit if it stops working someday.
- [x] **Firebase RTDB rules** — **no change needed** under the Database Secret auth path. The secret bypasses rules entirely, so n8n has admin-level read/write without per-path rule grants. The browser already has the right brad/diana auth scope.
- [x] **Test email arrives end-to-end** — verified 2026-05-26 in the Checkpoint G end-to-end test (see below).

## Pre-Phase-8 (migration sign-off)

- [x] **Backup of existing `pm_dlbooks` Firebase data** — Skipped. Task 8.2 deliberately preserved the legacy `pm_dlbooks` RTDB key intact, so the data is still in the Firebase console; a separate export wasn't needed for this migration. (Brad confirmed 2026-05-24 — "don't actually need it".)
- [x] **Verify migrated data** in the new Projects module matches the old PM DLBooks state — verified on the live site after the Task 8.1 push (2026-05-24).
- [x] **Sign off on retiring the legacy PM DLBooks tab** — confirmed 2026-05-24 (Task 8.2 shipped).

## At project completion (Phase 8 wrap)

- [x] Walked through this whole file with Brad; ticked or deferred every line. (2026-05-24)
- [x] Decided D1 + D2 (Firebase / repo rename) — both **keep existing**.
- [x] Tagged **v2.0.0** release in the repo.
- [x] Updated [CHANGELOG.md](../CHANGELOG.md) with full release notes.
- [x] Updated [HANDOVER.md](../HANDOVER.md) — modular monolith, email pipeline, where to add a new module.
- [x] Confirmed GitHub Pages live site reflects all changes after final push.

---

## Surfaced during implementation (added by Claude as we go)

<!-- Template:
- [ ] **2026-MM-DD** — During Task X.Y: <action>. Why it matters: <reason>.
-->

### Shipped 2026-05-26 (n8n delivery layer)

- [x] **2026-05-21 → done 2026-05-26** — Task 6.3: **n8n workflow draining `/household/family/email_queue/`** is **live as `FamilyPlanner: instant email drainer`**. Bumped from the originally-specced 60s cadence to **every 30 min** because per-minute fires were spamming the n8n execution log — the family-planner SLA tolerates the longer delay. Implementation note: instead of a Loop / SplitInBatches step, the workflow uses a single Code node that splits the Firebase map into items AND filters `sent !== true && failed !== true` in one pass. Uses the existing `Gmail SMTP (bradsmyrkai)` cred (D3 fallback), not the M365 Outlook node. Per-iteration shape:
  1. **Schedule Trigger** — every 30 min (Australia/Melbourne).
  2. **HTTP Request (GET)** — `https://financial-planner-e85d4-default-rtdb.asia-southeast1.firebasedatabase.app/household/family/email_queue.json` via the `Family Planner - Firebase RTDB` Query Auth credential.
  3. **Code in JavaScript** — splits the map into items, filters unsent + unfailed, adds `_id` (the Firebase key) for the PATCH.
  4. **Send an Email** — Gmail SMTP cred, From `bradsmyrkai@gmail.com`, To/Subject/HTML from each item.
  5. **HTTP Request (success branch)** — PATCH `email_queue/{_id}.json` with `{ "sent": true, "sentAt": "<iso>" }`.
  6. **HTTP Request (error branch)** — PATCH `email_queue/{_id}.json` with `{ "attempts": <n+1>, "failed": <n+1 >= 3> }`. Reach 3 → `failed: true` → Code filter drops it next cycle. Admin sub-tab surfaces the failure.

  **Old (still-true) why-it-matters:** without n8n the queue grows unboundedly. Now flushed every 30 min.

- [x] **2026-05-21 → done 2026-05-26** — Task 6.4: **daily-8am n8n workflow draining `/household/family/projects/digest_pending/{user}`** is **live as `FamilyPlanner: daily digest sender`**. Schedule Trigger daily 08:00 Australia/Melbourne. Code node mirrors the browser-side `composeDigestSummary` + `buildDigestEmail` helpers (same canonical NOTIFICATION_KINDS order, same plural-aware labels, same HTML structure with bullets + Open Family Planner link). PATCH clears each user's bucket only on send success.

  **Concurrent-write caveat still applies** (browser writes whole `projects` subtree, can race with n8n PATCH that clears `digest_pending/{user}` — edge-case overlap replays last night's entries the next day). Monitor `digest_pending/` in the Firebase console occasionally for stuck buckets.

### Deferred to v2.1 (n8n / Outlook layer) — superseded

- [x] ~~**2026-05-21** — During Task 6.3~~ — superseded by the 2026-05-26 build above.
- [x] ~~**2026-05-21** — During Task 6.4~~ — superseded by the 2026-05-26 build above.

### Carried into v2.1 backlog

- [x] **Checkpoint G** — **DONE 2026-05-26.** Both halves verified end-to-end.
  - **Browser-side half (5/5 pass, 2026-05-25):** (1) bell badge cross-tab + dropdown + deep-link; (2) instant-mode writes email_queue with `to`/`subject`/`status:pending`; (3) digest-mode bypasses email_queue while bell still fires; (4) master-off short-circuits both bell and queue; (5) self-action excludes the actor while still notifying co-assignees on a joint task.
  - **n8n delivery half (3/3 pass, 2026-05-26):** (1) drainer end-to-end — Diana posts a comment, Brad's bell ticks live, drainer fires within ~30 min, real email lands in `metalbee66@gmail.com`, Admin sub-tab flips that row to "sent"; (2) digest manual-execute — `composeDigestSummary` mirrored correctly (subject "1 new comment", body lists the comment as a bullet with the Family Planner deep link), `digest_pending/brad` cleared after; (3) bucket-bypass — flipping prefs back to Instant routes the next event to email_queue without entering `digest_pending`.

### Gaps surfaced 2026-05-26 (resolved)

- [x] **Architecture gap — new-task creation doesn't fire notifications** — **fixed 2026-05-26.** New-task and subtask submit paths now route through `commitTasksWithTriggers` with a synthetic `assignee_changed` trigger built from `t.assignees`; no event written to `task.events[]` (initial assignment is implicit). Self-action suppression handled downstream by `isSelfAction`. Seeder gating concern was moot — `maybeRunBusinessTransformSeed` etc. write the full task list via direct `state.projectsData.tasks = … ; fbSave(...)` and never enter the submit path.
- [x] **dependency_added notification kind** — **decided not to ship.** Considered as a v2.2 candidate; rejected because dependencies are typically added by the dependent task's own assignee, and a "you have a new dependency" bell wasn't worth the surface area.

### n8n cron heartbeats — DONE 2026-05-26

- [x] **Wire heartbeats on both Family Planner workflows** — Brad confirmed both wired 2026-05-26. Two healthchecks.io checks (`FamilyPlanner-InstantDrainerCron` 30 min × 30 min grace; `FamilyPlanner-DailyDigestCron` 1 day × 2 h grace) under the `metalbee66@gmail.com` healthchecks.io account, with trailing `Heartbeat` HTTP Request nodes at the end of each workflow's success path. Live state recorded in `routines.md`. Dead-man's-switch behaviour: workflow-level error → no ping → email to `metalbee66@gmail.com` after the grace window. The deferred "queue-stuck check" workflow (hourly GET of `email_queue` to catch drainer-running-but-Gmail-broken) was deliberately skipped — the in-UI bell badge already surfaces backlog for a household-volume app.
- [x] **Manual two-tab Firebase smoke** owed from the polish-round close-out (2026-05-21) — **done 2026-05-25.** Chrome regular (Brad) + Incognito (Diana) on live site. 7/7 checks passed: real-Firebase round-trip persisted comments + inline file + URL ref + milestone + dep; cross-tab realtime sync (deps clear on done, comments + milestone toggles propagate ~2 sec); PB.9 joint-assignee Joint chip + `Joint · 1` group + intersection-filter cross-tab; PB.7 status-derive ON→on-hold + OFF→snap-to-derived cross-tab; PB.8 Dashboard drill-down on Open tasks + Completed (last 30d) + Active-projects-correctly-inert + live re-render on Diana's status change. Surfaced one polish bug: Dashboard chart was stretching vertically on wide screens (preserveAspectRatio="none" + fixed height) — fixed in `d31ad98`.
- [x] **2026-05-24** — During Task 8.3 walkthrough: **build a one-off Asana → Projects importer**. Brad was locked out of his Asana project by a subscription gate; the original Claude-generated project tree lived in the shared chat at `https://claude.ai/share/d162fea2-bb74-48f1-a15a-4525bcb143e4`. **Resolved in v2.0.1.** Brad pasted the recovered JSON inline; instead of building a generic Asana fetcher, we embedded the literal payload in `seed-businesstransform.js` and applied the same `migrate-pm.js` idempotency pattern. The 9-stream + Milestones import shipped under the `business_transform_seeded` flag.

## Pre-Bank-API (v2.4 — browser-automated scraping pilot) — UA1–UA5 DONE 2026-06-05

> Replaces the abandoned PocketSmith pre-action list. Plan at [`C:\Users\brads\.claude\plans\i-want-to-discuss-dapper-trinket.md`](file:///C:/Users/brads/.claude/plans/i-want-to-discuss-dapper-trinket.md). All Phase-0 actions done; **HSBC scraper now LIVE on the Geekom** (see the bank-decisions memory for full detail). Several specifics changed from the original plan during the build — noted inline below.

- [x] **UA1** KeePass flavour — **KeePassXC** (2026-05-28). Credential read via `keepassxc-cli`.
- [x] **UA2** 3 KeePass entries created (2026-06-05). **CHANGED from plan:** entries live in a **new dedicated key-file vault `C:\Vault\familyplanner.kdbx`** (unlocked by `C:\Vault\fp-state\familyplanner.keyx`, NTFS-locked to senseai-admin), **NOT** `senseai.kdbx` — a shared vault can't be unlocked unattended without piping its master password, and a separate vault limits the scraper's blast radius. Titles: `Family Planner - HSBC`, `Family Planner - Selfwealth`, `Family Planner - AMP`.
- [x] **UA3** Trusted-device enrolment (2026-06-05). **CHANGED from plan:** merged into the first headed Playwright run (the manual "regular browser" step doesn't transfer the cookie to Playwright). HSBC done — session persisted in `C:\Vault\fp-state\hsbc-profile`, MFA-free thereafter. Selfwealth + AMP enrolment happens when those scrapers are written.
- [x] **UA4** 3 healthchecks.io checks created (2026-06-05), order HSBC/Selfwealth/AMP confirmed. Ping URLs stored in `scrapers/config/healthchecks.json` (in the private repo).
- [x] **UA5** Folders created on the **Geekom** (2026-06-05): `C:\BankScrapes\{hsbc,selfwealth,amp,logs}`, `C:\Vault\fp-state\`.

### T7 ingest deploy (workflows authored 2026-06-25 — Brad to deploy on the Geekom)

> The 3 n8n ingest workflows are written + locally verified. Deploy steps + full
> rationale are in [`../n8n/bank-ingest.BUILD-SHEET.md`](../n8n/bank-ingest.BUILD-SHEET.md).

- [x] **UA-T7 (HSBC + NAB) — DONE 2026-07-02** (Claude drove it over SSH; Brad OK'd the restarts). One compose edit unblocked both banks: added `- C:\BankScrapes:/data/bankscrapes:ro` to the `n8n` service `volumes:` **and** `NODE_FUNCTION_ALLOW_BUILTIN: "fs,path"` to its `environment:` in `C:\SenseAi\deploy\n8n-compose.yml`, then `docker compose … up -d`. Verified inside the container (`printenv NODE_FUNCTION_ALLOW_BUILTIN` → `fs,path`; `ls /data/bankscrapes/nab/<today>` → the CSV). Imported `fpHsbcIngest01` + `fpNabIngest01`, activated (CLI `update:workflow --active=true` publishes+activates on this build; `docker restart` to register), wired healthchecks `FamilyPlanner-{Hsbc,Nab}IngestCron` (8h/2h) — real ping URLs patched into the live Heartbeat nodes only (kept out of git per the secret convention). First scheduled run wrote **243 tx** to `bank_inbox`; Brad confirmed they surface in Import → Bank inbox. routines.md updated. Compose backup kept at `n8n-compose.yml.bak-20260702`. **Ingest cadence set to every 8 h** (was 15 min — overkill for a daily scrape; idempotent re-reads). **Selfwealth + AMP ingest still undeployed** (scrapers unbuilt) — the mount + flag already cover them, so those are import-only when the time comes.

### Sample-data privacy guard (one-time follow-up — DONE 2026-05-28)

- [x] **2026-05-28** — Real HSBC export landed in `app/sample-data/` during the discussion (`TransHist.csv` + a `TransactionsReport_733-118 529119_...pdf` + a modified `Transactions.csv`). The repo is public; the files contained real BSBs, account numbers, balances, and a Selfwealth account reference. **Moved** to `C:\Vault\fp-samples\` (private vault) as `hsbc-TransHist-2026-05-28.csv`, `hsbc-TransactionsReport-2026-05-28.pdf`, `nab-Transactions-2026-05-28-modified.csv`. `app/sample-data/Transactions.csv` reverted to the originally-committed version. `app/.gitignore` gained a `sample-data/*.{csv,pdf,qif,qfx}` block with `!sample-data/Transactions.csv` exempted (existing committed file stays; new files are silently ignored). Commit `c9b9176`.

### NAB scraper walk-through (scaffolded 2026-06-27 — Brad to finish on the Geekom)

> First of the "remaining 6" logins. `nab.mjs` + `run-nab1.ps1` + `run-nab2.ps1` +
> the `nab-ingest` workflow are written; the site-specific selectors are
> `TODO(headed)`. Two separate logins (NAB1, NAB2), transactions-only, one
> parameterised scraper. Full finish steps in `scrapers/README.md` → "NAB —
> scaffold status". This is a NEW pilot bank, separate from the burn-in decision
> gate below (which is about scaling AFTER the first 3 prove out).

- [x] **UA-NAB.1** Confirmed 2026-06-27 — two separate logins.
- [~] **UA-NAB.2** KeePass entries — **NAB1 populated** (verified 2026-06-27, user+pass present); **NAB2 is an empty shell** (title exists, both fields 0-length — still to fill).
- [x] **UA-NAB.3** Headed walk-through DONE 2026-06-30 (NAB1). Trusted-device profile enrolled (`nab1-profile`). **Big lesson: NAB is a shadow-DOM SPA — DOM selectors are blind to its content; ARIA role+name locators (resolve via the accessibility tree) work.** Real selectors written into `nab.mjs` + verified end-to-end (`1/1 exported`). NAB2 still pending its KeePass entry (UA-NAB.2).
- [x] **UA-NAB.4** Two healthchecks created + ping URLs in `scrapers/config/healthchecks.json` (nab1=cb937683…, nab2=1c0ec8fa…), deployed to the Geekom 2026-06-27.
- [x] **UA-NAB.5** DONE 2026-06-30 — read a REAL export. NAB is **10 columns** (`Date,Amount,Account Number,,Type,Details,Balance,Category,Merchant,Processed On`), NOT positional like HSBC/AMP. Fixed `parseTransactionsCsv` with a per-source `CSV_LAYOUTS` map (amount col 1, details col 5, merchant col 8) + updated the workflow Code node; self-check 50/50; both verified against the real CSV.
- [x] **UA-NAB.6** NAB1 Task Scheduler entry `FamilyPlanner-Nab1ScraperDaily` (Interactive, senseAi-admin, **daily 06:30** — offset from the 06:00 HSBC task; routines.md). The scraper has been running daily — dated CSV folders present through 2026-07-02 (that day's `nab1-cc3696.csv` = 17 KB), which the live ingest picked up. **`fpNabIngest01` deployed to n8n 2026-07-02** (see UA-T7 above). **Remaining NAB loose ends:** (a) NAB2 — empty KeePass entry (UA-NAB.2), no scraper/task yet; (b) tighten `run-nab1.ps1` jitter if the 06:30 slot ever collides with anything.

### v2.4 wrap (deferred until pilot complete)

- [x] **2026-06-05** — **Version-control for `scrapers/` RESOLVED: option (a), own private repo `metalbee66/family-planner-scrapers`.** `.gitignore` excludes screenshots/CSVs/node_modules (no bank data or secrets committed). Deploy to the Geekom stays via `scp`. **New manual follow-up:** auto-logon is enabled on the Geekom for senseai-admin (Sysinternals Autologon) — confirm it survives a reboot whenever the box is next bounced (doesn't affect SenseAi services).
- [ ] **2026-05-28** — At Phase 3 burn-in: **per-bank decision gate** on whether to scale to NAB1 / NAB2 / Westpac / ANZ / Bankwest / IBKR scrapers. Pilot is allowed to fail per-bank; failed banks fall back to manual CSV import + manual balance entry.
