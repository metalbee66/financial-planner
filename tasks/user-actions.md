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

## Pre-Phase-6 (n8n + M365 infrastructure for email) — DEFERRED to v2.1

> Status: still gated on the SenseAi `Business_Project_Plan.md` setup. Family Planner's browser-side work is done; the n8n / Outlook layer ships alongside the SenseAi backend whenever that infra lands. The two queued workflow builds are at the bottom of this file.

- [ ] **n8n container running on SEi14 Geekom** (Docker Desktop / WSL2)
- [ ] **n8n reachable via Tailscale** from the family-planner browser context (CORS allowed, or rely on Firebase as the bridge so n8n only needs outbound)
- [ ] **n8n admin account created** (not default credentials)
- [ ] **n8n base URL recorded** somewhere I can read when I build the workflow (Tailscale IP + port)
- [ ] **M365 Outlook credential configured in n8n** with `Mail.Send` Graph API scope
- [x] **D3 resolved** (above) — M365 once the mailbox exists; Gmail SMTP until then
- [ ] **Firebase REST API service-account key** exported and added to n8n as an HTTP Bearer credential, scoped to `/household/family/email_queue/*` and `/household/family/projects/*`
- [ ] **Firebase RTDB rules updated** to allow:
    - `email_queue` writes from authed brad/diana
    - `email_queue` writes from the n8n service-account principal (PATCH for `sent`, `attempts`, `sentAt`, `failed`)
    - `projects/notifications/{user}` write from authed user
    - `projects/prefs/{user}` write from authed user
    - `projects/digest_pending/{user}` write from authed user + service-account read
- [ ] **Test email arrives end-to-end** before relying on it for real notifications

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

### Deferred to v2.1 (n8n / Outlook layer)

- [ ] **2026-05-21** — During Task 6.3: **build the n8n workflow that drains `/household/family/email_queue/`**. The browser-side enqueue is live (writes one queue entry per "instant" notification, mirrored to a localStorage `email_queue` map for offline-mode visibility). The n8n half is deferred until the Pre-Phase-6 infra above is up. Workflow shape per plan §6.3:
  1. **Schedule Trigger** — every 60s
  2. **HTTP Request (GET)** — Firebase REST API `https://<rtdb-host>/household/family/email_queue.json?orderBy=%22sent%22&equalTo=false` with the service-account Bearer creds, then filter results where `failed !== true`
  3. **Loop / SplitInBatches** — one item per iteration
  4. **Microsoft Outlook (Send Email)** — `to`, `subject`, `bodyHtml` from the entry (using D3-decided from-address)
  5. **HTTP Request (PATCH)** — on send success: PATCH `/household/family/email_queue/{id}.json` with `{ "sent": true, "sentAt": "<iso>" }`
  6. **Error branch** — on send failure: PATCH the same path with `{ "attempts": <attempts+1> }`; when `attempts >= 3` also set `"failed": true` so the loop stops retrying that entry. The Phase 6.5 admin panel will surface failed items for manual retry.

  Why it matters: without n8n the queue grows unboundedly in Firebase RTDB — emails never send. Use the n8n MCP tools to author the workflow once SEi14 is reachable, M365 credentials are in place, and the Firebase service-account Bearer is configured.

- [ ] **2026-05-21** — During Task 6.4: **build the daily-8am n8n workflow that drains `/household/family/projects/digest_pending/{user}`**. Browser side accumulates one digest entry per "digest"-mode notification (alongside the bell entry); the email queue is bypassed for these users. The daily roll-up itself is deferred. Workflow shape per plan §6.4:
  1. **Schedule Trigger** — daily at 08:00 Australia/Melbourne
  2. **HTTP Request (GET)** — Firebase REST `/household/family/projects/digest_pending.json` with the service-account Bearer creds
  3. **Loop / SplitInBatches** — one user per iteration (`brad`, `diana`)
  4. **Filter** — skip when the user's entries array is empty / missing
  5. **Compose email** — subject `[Family Planner] Daily digest — <summary>` where `<summary>` is the comma-joined grouped counts (e.g. `3 tasks assigned, 2 tasks overdue, 1 milestone completed`); body is a `<ul>` of `<title> — <summary>` bullets + an "Open Family Planner" link. The browser-side `composeDigestSummary` / `buildDigestEmail` helpers in `notifications.js` are the reference shape — n8n can mirror them with a Code node, or recompose via Function nodes.
  6. **Microsoft Outlook (Send Email)** — to `participantEmail(user)`
  7. **HTTP Request (PATCH)** — on send success: PATCH `/household/family/projects/digest_pending/{user}.json` with `null` (or an empty array) to clear the bucket
  8. **Error branch** — log + skip the user on send failure; next day's run picks up the same entries (idempotent — no double-send because the bucket only clears on success)

  Why it matters: this is the entire delivery channel for digest-mode users. Without the workflow they see bell entries but never receive a summary email. **Concurrent-write caveat**: the browser writes the whole `projects` subtree via `fbSave('projects', ...)` on every user-driven mutation, which can race with the n8n PATCH that clears `digest_pending/{user}` — to be safe, run the daily workflow at 08:00 (low-traffic window) and accept that an edge-case overlap will replay last night's entries the next day. Phase 6.5 admin panel can surface manual override if it ever bites.

### Carried into v2.1 backlog

- [ ] **Checkpoint G** — two-user end-to-end notification flow + daily digest tested end-to-end. Blocks on the n8n infra above.
- [x] **Manual two-tab Firebase smoke** owed from the polish-round close-out (2026-05-21) — **done 2026-05-25.** Chrome regular (Brad) + Incognito (Diana) on live site. 7/7 checks passed: real-Firebase round-trip persisted comments + inline file + URL ref + milestone + dep; cross-tab realtime sync (deps clear on done, comments + milestone toggles propagate ~2 sec); PB.9 joint-assignee Joint chip + `Joint · 1` group + intersection-filter cross-tab; PB.7 status-derive ON→on-hold + OFF→snap-to-derived cross-tab; PB.8 Dashboard drill-down on Open tasks + Completed (last 30d) + Active-projects-correctly-inert + live re-render on Diana's status change. Surfaced one polish bug: Dashboard chart was stretching vertically on wide screens (preserveAspectRatio="none" + fixed height) — fixed in `d31ad98`.
- [x] **2026-05-24** — During Task 8.3 walkthrough: **build a one-off Asana → Projects importer**. Brad was locked out of his Asana project by a subscription gate; the original Claude-generated project tree lived in the shared chat at `https://claude.ai/share/d162fea2-bb74-48f1-a15a-4525bcb143e4`. **Resolved in v2.0.1.** Brad pasted the recovered JSON inline; instead of building a generic Asana fetcher, we embedded the literal payload in `seed-businesstransform.js` and applied the same `migrate-pm.js` idempotency pattern. The 9-stream + Milestones import shipped under the `business_transform_seeded` flag.
