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
- Vanilla JS — no frameworks, no build tools.
- Currency formatting via `fmt()`, `fmtPlain()`, `fmtSigned()` in `data.js`.
- All money stored as weekly base rates internally.
- Bracket-check all JS files before committing.
