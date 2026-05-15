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
