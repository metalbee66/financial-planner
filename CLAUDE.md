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
- **E2E smoke tests** (Playwright, dev-only): `npm run test:e2e` from `app/`. Covers Phase 1 + 2.1 acceptance criteria; ~80s runtime. Firebase is blocked at the network layer so tests run hermetically against localStorage. Add a new block in `tests-e2e/smoke.spec.js` for each phase as it lands.
- **Manual smoke test still required for**: real Firebase round-trip across tabs, two-user concurrent editing, visual layout sanity. Everything else should be automated in `smoke.spec.js`.
- Run `npm run test:e2e` before committing any UI change. If a test fails, fix the code or update the test — do not commit red.
- `node_modules/`, `playwright-report/`, `test-results/` are gitignored. The deployed site does not include them.
