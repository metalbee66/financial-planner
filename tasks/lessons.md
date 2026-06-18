# Family Planner — Lessons

Patterns to avoid repeating, and gotchas worth remembering. Updated by Claude when a correction or surprise surfaces something worth not re-discovering.

---

## L1 — Deploy assumed, not verified (2026-05-15)

**What happened:** The handover assumed every push to `master` deployed via GitHub Pages within ~30 sec. The repo had been flipped from public to private at some point, which silently disables Pages on free GitHub. Every commit from 2026-04-11 onward — all of Phase 4.x and Phase 5.1 → 5.4 — stopped deploying. Local tests stayed green, the harness stayed green, nobody noticed for ~5 weeks. The 2026-05-15 manual smoke surfaced it as a 404 on the live URL.

**Why it slipped:** No automated check that the live site is actually serving the latest commit. The Playwright harness runs against `localhost`, not the deployed URL. Repo visibility changes are settings-level events that don't surface in normal git workflow.

**Reversal cost:** Re-enabled Pages by flipping repo back to public + `POST /repos/.../pages` with `branch=master, path=/`. Pages config doesn't persist while a repo is private — it's torn down on visibility flip and must be recreated, not just re-toggled.

**Guardrails for next time:**
- After any push, verify `gh api repos/<org>/<repo>/pages --jq '.status'` returns `built` and `gh api repos/<org>/<repo> --jq '.has_pages'` is `true`.
- Or add a tiny CI step (the Pages workflow already runs on push when enabled) that curls the live URL and asserts a 200 against the latest deployed commit.
- When asking the user to validate any deployment-dependent smoke (Checkpoint F, etc.), pre-check that the deploy is live before sending them to the URL.

---

## L2 — Detailed spec written before vendor was hands-on validated (2026-05-28)

**What happened:** Backlog #4 (Bank API integration) ran two days of discovery — research subagents, decision Q&A, full SPEC (~250 lines), full implementation plan (~340 lines) with task breakdown + dependency graph + four checkpoints. Vendor pick (PocketSmith, as a Basiq reseller) was made from vendor docs + research without Brad subscribing first. **The hour after the plan was written**, Brad subscribed to PocketSmith, attempted to connect his real banks, and discovered HSBC loan accounts aren't shareable via HSBC AU's CDR scope. Loans were the load-bearing piece of his planner setup. The entire spec + plan + memory work was superseded the same day.

**Why it slipped:** Research surfaced general AU bank coverage ("PocketSmith supports NAB / HSBC / Westpac via Basiq's CDR feed") but not loan-product-by-institution-by-account-type granularity. That level of detail is invisible to docs + web search — only the vendor's UI on Brad's actual accounts shows it. The discovery process treated vendor coverage as research-answerable when it was actually trial-only.

**Reversal cost:** Two days of work translated into two files marked `⛔ SUPERSEDED` (kept for trail value), one memory entry rewritten, one new feedback memory written, one new lesson here. No code shipped, so no rollback complexity — but the planning effort itself was sunk.

**Guardrails for next time:**
- For any task gated on a third-party vendor covering Brad's specific accounts / account types / regional setup: get a hands-on trial done **before** writing a detailed spec or plan. List the specific must-work items explicitly, then verify each against his real accounts. Captured as a feedback memory ([feedback_validate_vendor_before_detailed_spec.md](file:///C:/Users/brads/.claude/projects/e--Projects-Family-Planner/memory/feedback_validate_vendor_before_detailed_spec.md)) so it applies across future sessions, not just this project.
- Vendor research that reports "supports X bank" should be treated as necessary-but-not-sufficient. Coverage of an institution is per-account-type per-product per-region, and CDR scope evolves bank-by-bank quarter-by-quarter — vendor docs lag the actual rollout.
- The right ordering for vendor-dependent tasks: **research the landscape → narrow to 1–2 candidates → Brad does a cheap trial → verify the specific must-work list → only then write spec + plan**. Skipping the trial buys speed in exchange for high blowup risk when reality contradicts docs.

---

## L3 — Date fields deserialize as strings off Firebase/localStorage (2026-06-18)

**What happened:** v2.4's Bank inbox loads scraped transactions (stored under the Firebase `bank_inbox` key) into the existing CSV review table, then reuses `applyToPlanner`. The transaction row shape carries a `date` field that the CSV parsers (`parseNabCsv` / `parseHsbcCsv`) produce as a live `Date` object. But bank-inbox rows come from JSON (Firebase → localStorage), and **JSON has no Date type** — `date` round-trips as an ISO **string**. `applyToPlanner` → `getWeekIndex(tx.date)` calls `date.getFullYear()`, which throws on a string. The first E2E test caught it: Apply silently failed and the inbox row never got its dedup hash, so it re-appeared after reload.

**Why it slipped:** The CSV flow never exercises the string path — `parseNabCsv` builds Date objects in-memory and applies them in the same session, so `tx.date` is always a real Date. Any row that has been *persisted and reloaded* (or arrives from Firebase/n8n) loses the Date type. Inspection of the row shape looked identical; the difference is only visible at runtime after a serialize→deserialize hop.

**Fix:** `loadBankInboxIntoReview` rehydrates `date` to a Date (`tx.date instanceof Date ? tx.date : new Date(tx.date)`) before handing rows to the review/apply flow.

**Guardrails for next time:**
- Any entity with a `Date` field that is persisted to Firebase/localStorage and read back MUST rehydrate the Date on load — the field will be a string, not a Date. Treat `instanceof Date` as the gate.
- When reusing an in-memory code path (built for freshly-parsed data) on persisted/remote data, assume Dates, Sets, and Maps did NOT survive the JSON hop and re-hydrate them at the boundary.
- This is exactly the class of bug E2E catches and unit tests don't: the unit tests for `parseAmpCsv` pass live Dates; only the full seed→reload→apply E2E exercises the string path.
