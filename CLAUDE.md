# Project Rules

## Before Making Changes
- Always commit and push current state to git before making changes to live files.
- If there are uncommitted changes, commit them first with a descriptive message.
- This ensures a rollback point exists if something breaks.

## Deployment
- App lives in `app/` subdirectory.
- Deploy by pushing to `master` — GitHub Pages rebuilds automatically (~30 seconds).
- Test locally first at http://localhost:8080 (`python app/server.py`).

## Code Style
- Vanilla JS — no frameworks, no build tools (the deployed site is plain HTML/CSS/JS).
- Currency formatting via `fmt()`, `fmtPlain()`, `fmtSigned()` in `data.js`.
- All money stored as weekly base rates internally.
- Bracket-check all JS files before committing.

## Testing
- **Data-layer unit tests**: `data.test.js` files run in the browser via `/tests.html`. Pure functions only.
- **E2E smoke tests** (Playwright, dev-only): 171 tests covering every phase + v2.0.x patches. Firebase is blocked at the network layer so tests run hermetically against localStorage. `fullyParallel: true` + `workers: 4` since 2026-05-25 — each test gets its own browser context so localStorage is already isolated. Add a new describe in `tests-e2e/smoke.spec.js` for each phase / patch as it lands.
- **Manual smoke test still required for**: real Firebase round-trip across tabs, two-user concurrent editing, visual layout sanity.
- **Three-tier test cadence (use the right one for the situation):**
  - **Dev iteration** (per change): `npx playwright test --grep "<describe-name>"` — runs only the describe you're touching (~5–40s).
  - **Pre-commit**: `npm run test:fast` — unit driver + Phase 0 shell regression (~9s). Catches data-layer + boot regressions.
  - **Pre-tag / pre-push**: `npm run test:e2e` — full 171 tests (~4 min). Required before any commit that touches data shape, runners, or core infra.
- If a test fails: fix the code or update the test — do not commit red.
- `node_modules/`, `playwright-report/`, `test-results/` are gitignored. The deployed site does not include them.
