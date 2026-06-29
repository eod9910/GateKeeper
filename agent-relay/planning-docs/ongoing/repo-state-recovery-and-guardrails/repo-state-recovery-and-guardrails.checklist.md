## Repo Hygiene + Scope + Fragility Followups

Percent complete: 43% (3 complete, 0 partial, 4 remaining)

PRD: repo-state-recovery-and-guardrails-prd.md

**Created:** 2026-04-16
**Status:** ACTIVE
**Source-of-truth role:** companion to `repo-state-recovery-and-guardrails-prd.md` â€” captures the actions taken on 2026-04-16 and the items that still need a human decision.

---

### What this doc is

A single-page record of:

1. what the 2026-04-16 hygiene pass actually changed
2. what is still leaking (scope sprawl, OneDrive fragility, Python/TS contract drift)
3. the small set of decisions the user needs to make to close those out

It exists because the `repo-state-recovery-and-guardrails-prd.md` is a strategic plan; this is the running operational checklist that points at it.

---

### Hygiene actions taken on 2026-04-16

- `.gitignore` extended to permanently exclude:
  - `backend/data/*.sqlite` / `*.sqlite-shm` / `*.sqlite-wal` (and `*.db` variants)
  - `backend/data/valuation_regime_*.json` and any `valuation_universe_snapshot*.json`
  - `backend/data/app-state.*` / `symbol-catalog.*` / `fundamentals_pit.*` / `fundamentals-pit.*`
  - `*.smoke.json` / `*_smoke.json`
  - `.tmp/` and root-level `_tmp_*` / `tmp_*`
- Orphan zero-byte `backend/data/fundamentals_pit.sqlite` (underscore variant) deleted. Canonical filename is hyphen `fundamentals-pit.sqlite`; some one-off command typo'd the name and created an empty file.
- `repo:check` npm script added: `npm run repo:check` from `backend/` runs `check_repo_state.ps1`.
- `git status` `backend/data` entries dropped from 15 to 3 (the 3 remaining are intentional new patterns/docs, not data leakage).

### What is still in `git status` and why

- Modified source files across backend/src, backend/services, frontend/public, workspace â€” all real work in progress on **valuation regime** + **consumer cycle** + **ledger hydration** initiatives.
- ~25 new untracked source files in the same three initiatives plus a workspace `_templates/` system and three new analyst skills.

This is the **scope-sprawl** problem, not the hygiene problem.

---

### Open issue 1 â€” Scope sprawl beyond the declared plan

The current authoritative plan (`ledger-data-foundation-and-pit-ingestion-prd.md`) gates further ingestion behind:

> validate on 2-3 issuers; only then scale ingestion

But the in-flight worktree adds:

- `valuation_state_primitive` (plugin + JSON spec + scripts + studies)
- `valuationBacktestService` / `valuationSignalStrategyService` / `researchCatalogService`
- `consumerCycle` route + service + frontend page
- `symbolCatalog` service (TS + Python) + `app_state_db` + `ledger_hydration_jobs` + scheduler
- `specialSituationWebVerifier`
- New analyst skills: `buried-risk-review`, `consumer-cycle-context`, `sentiment-context`

None of these are wrong on their own. But none of them are *the contract-hardening / 3rd-issuer validation work* that the plan said was next.

**Decision required from user (one of):**

- **A) Promote.** Update `ledger-data-foundation-and-pit-ingestion-prd.md` to officially expand scope and supersede the "no broad scaling until contracts harden" gate. Add the new initiatives as named workstreams with their own gating criteria.
- **B) Park.** Pick one initiative as the active one, branch the others into `.planning/plans/BACKLOG/`, and do not commit their code into `main` until they are picked up.
- **C) Split.** Land the in-flight work as a single labeled checkpoint commit (e.g. `feat(valuation+consumer-cycle+ledger-hydration): in-progress snapshot`) so the next session inherits a clean diff to keep iterating against.

Recommendation: **C now, then B**. Take the snapshot so the work isn't trapped in worktree, then formally pick the next active workstream and park the rest until the Ledger contract pack is signed off.

---

### Open issue 2 â€” OneDrive sync over multi-GB SQLite

Current footprint inside `OneDrive\Documents\Coding\pattern-detector\backend\data\`:

- `fundamentals-pit.sqlite` â€” **3.87 GB**
- `app-state.sqlite` â€” **615 MB** (with active `-wal` file)
- `symbol-catalog.sqlite` â€” **82 MB**

OneDrive periodically rewrites/locks files for sync. SQLite WAL mode does not tolerate that â€” it is a known corruption vector, and on Windows it can also trigger "file in use" failures when SQLite tries to checkpoint. With ~4.5 GB of database state in a sync folder, this is not theoretical.

**Three concrete options, ranked by effort:**

1. **Lowest effort: exclude `backend/data/` from OneDrive sync.**
   - Right-click `backend/data/` in Explorer â†’ "Free up space" or "Always keep on this device" + add to OneDrive's per-folder exclusion (Settings â†’ Sync and backup â†’ Manage backup).
   - This stops the sync layer from touching the live SQLite files but keeps the rest of the repo backed up.
   - Recommended as the immediate action.
2. **Better: move the working tree out of OneDrive entirely.**
   - Move `pattern-detector/` to `C:\Code\pattern-detector\` (or similar non-synced path).
   - Re-clone or `git mv` the worktree, re-open in Cursor.
   - This removes both the SQLite risk and the general OneDrive-on-source-tree friction (file locking, slower git ops).
3. **Best (longer term): move large data stores out of the repo path entirely.**
   - Put `fundamentals-pit.sqlite` and `app-state.sqlite` under `%LOCALAPPDATA%\PatternDetector\data\` or a sibling `pattern-detector-data\` folder.
   - Make the path configurable via env (`PATTERN_DETECTOR_DATA_DIR`).
   - Already partially in place â€” `DEFAULT_DB_PATH` constants exist in `fundamentals_pit_store.py`, `ledgerCoverage.py`, and the ledger hydration jobs. They just hardcode the in-repo path.

**Decision required:** which option to execute. I can do option 1 documentation now; options 2 and 3 require user action / agreement on layout.

---

### Open issue 3 â€” Python/TS contract drift surface

The TSâ†”Python boundary is wide and there is no single canonical schema source for what crosses it.

Current crossing points:

- `pluginServiceClient.ts` â†” `services/plugin_service.py` (strategy plugin invocation)
- `executionBridge.ts` â†” Python execution paths (Alpaca + paper)
- `contractValidation.ts` (this is the closest thing to the canonical, but it duplicates some PIT shape definitions)
- `ledgerEngines.ts` â†” `ledger_hydration*.py` / `ledgerContext.py`
- `signalScanner.ts` â†” `patternScanner.py` + family/structural plugins
- New: `symbolCatalog.ts` â†” `symbol_catalog_db.py` and `consumerCycleService.ts` â†” `*.py` analogs

This is not failing today, but every new initiative widens the surface a little more, and every shape lives in two languages.

**No execution required this session** â€” but the next architectural unit of work should be a small one-pager `.planning/plans/REFERENCE/ts-python-contract-policy.md` that picks a single rule, e.g.:

- "all crossing shapes are defined in JSON Schema under `backend/contracts/`, generated into TS types via `json-schema-to-typescript` and consumed in Python via `pydantic`-from-schema" â€” or
- "Python is the source of truth, TS imports auto-generated `.d.ts` from a `pydantic-to-ts` step in CI."

Either choice is fine; the cost is in not picking one.

---

### Definition of done for this followup pack

- [x] `.gitignore` covers all current data leakage classes
- [x] Orphan/scratch files removed from disk
- [x] `npm run repo:check` exists and is documented
- [ ] Decision on Issue 1 (scope sprawl) made and acted on
- [ ] Decision on Issue 2 (OneDrive) made and acted on
- [ ] Issue 3 docs written before next major Python/TS interface lands
- [ ] `check_repo_state.ps1` returns GREEN or YELLOW after Issue 1 is resolved

---

### Operational reminders

- Run before every commit: `git status --short` then `cd backend && npm run repo:check`
- If score is RED with no leakage entries â†’ it's scope, not hygiene. Apply Issue 1 decision.
- If `backend/data` entries appear in status that aren't in `.gitignore` yet â†’ add them here and to `.gitignore` immediately, do not let them sit.
