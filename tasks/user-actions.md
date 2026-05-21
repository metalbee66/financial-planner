# Family Planner — Manual Action Tracker

Manual ops Brad needs to do that aren't code changes. I (Claude) maintain this list throughout the project and walk through it with you at project completion (Phase 8 sign-off).

> **Convention:** items are checked off when **you** confirm they're done; I won't tick them speculatively. Items added by me along the way will appear with the date and the task that surfaced them.

---

## Decisions still pending

| # | Decision | Why it matters | Default if no decision |
|---|---|---|---|
| D1 | Firebase project rename: keep `financial-planner-e85d4-default-rtdb` or migrate? | Cosmetic mismatch with new app name; migrating means a one-off data export+import | **Keep existing project** |
| D2 | GitHub repo rename: `financial-planner` → `family-planner`? | Renaming breaks live URL until you redirect | **Don't rename** |
| D3 | Email from-address: personal Gmail vs M365 business email? | Determines which credential n8n uses for outbound | **M365 business email** once that account exists; until then, personal Gmail via app-password SMTP |
| D4 | Celebration sound: own asset files, or WebAudio-synthesized? | Asset files = nicer audio, repo size grows; WebAudio = zero deps | **WebAudio tones** |

Decision deadline: by start of Phase 6 (email infra) for D3; by start of Phase 7 for D4; D1/D2 can wait until project completion.

---

## Pre-Phase-0 (before any code)

- [ ] Confirm you have an editable copy of these plans — review [plan.md](plan.md) and [todo.md](todo.md), push back on anything you disagree with
- [ ] Confirm you're happy with **native ES modules** as the JS architecture (no bundler, no build step). If you'd rather keep the existing global-script style, say so before Task 0.2.

## Pre-Phase-6 (n8n + M365 infrastructure for email)

These mirror the SenseAi `Business_Project_Plan.md` setup tasks for the Beelink + n8n + M365 stack. If you finish those for SenseAi first, this whole list ticks itself.

- [ ] **n8n container running on SEi14** (Docker Desktop / WSL2)
- [ ] **n8n reachable via Tailscale** from the family-planner browser context (CORS allowed, or rely on Firebase as the bridge so n8n only needs outbound)
- [ ] **n8n admin account created** (not default credentials)
- [ ] **n8n base URL recorded** somewhere I can read when I build the workflow (Tailscale IP + port)
- [ ] **M365 Outlook credential configured in n8n** with `Mail.Send` Graph API scope
- [ ] **Decide D3** above (personal Gmail vs M365 business)
- [ ] **Firebase REST API service-account key** exported and added to n8n as an HTTP Bearer credential, scoped to `/household/family/email_queue/*` and `/household/family/projects/*`
- [ ] **Firebase RTDB rules updated** to allow:
    - `email_queue` writes from authed brad/diana
    - `email_queue` writes from the n8n service-account principal (PATCH for `sent`, `attempts`, `sentAt`, `failed`)
    - `projects/notifications/{user}` write from authed user
    - `projects/prefs/{user}` write from authed user
    - `projects/digest_pending/{user}` write from authed user + service-account read
- [ ] **Test email arrives end-to-end** before relying on it for real notifications

## Pre-Phase-8 (migration sign-off)

- [ ] **Backup of existing `pm_dlbooks` Firebase data** (export JSON from Firebase console) before running migration
- [ ] **Verify migrated data** in the new Projects module matches the old PM DLBooks state, side by side
- [ ] **Sign off on retiring the legacy PM DLBooks tab**

## At project completion (Phase 8 wrap)

- [ ] Walk through this whole file with me; tick or defer every line
- [ ] Decide D1 + D2 (Firebase / repo rename) one way or the other
- [ ] Tag a `v2.0.0` release in the repo
- [ ] Update [CHANGELOG.md](../CHANGELOG.md) with full release notes
- [ ] Update [HANDOVER.md](../HANDOVER.md) — document the modular monolith, the email pipeline, and where to add a new module
- [ ] Confirm GitHub Pages live site reflects all changes after final push

---

## Surfaced during implementation (added by Claude as we go)

<!-- Template:
- [ ] **2026-MM-DD** — During Task X.Y: <action>. Why it matters: <reason>.
-->

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
