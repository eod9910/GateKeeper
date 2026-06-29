# Repo-State Cleanup Inventory

Date: 2026-04-02

## Goal

Clean up the current repo state without deleting valuable work, rolling back progress, or using destructive resets.

This is a repo-organization and scope-isolation pass, not a code-revert pass.

## Current Worktree Shape

From `git status --short`, the current dirty worktree is broadly distributed:

- legacy planning tree, before migration into `agent-relay/planning-docs`: 20
- `backend/data`: 105
- `backend/scripts`: 30
- `backend/services`: 30
- `backend/src`: 41
- `frontend/public`: 51
- `workspace`: 1 top-level path, but this represents a large workspace tree
- `docs`: 3
- `memory-bank`: 2
- `other`: 14

This means the current `CRITICAL` GitNexus scope warning is mostly caused by mixed initiatives and artifact noise rather than one single dangerous feature branch.

## Ledger / Analyst Slice To Protect

These files should be treated as the protected Ledger slice during cleanup:

- `backend/src/services/copilotTools.ts`
- `backend/src/services/ledgerEngines.ts`
- `backend/src/services/visionService.ts`
- `backend/src/routes/vision.ts`
- `backend/src/routes/fundamentals.ts`
- `backend/services/ledgerContext.py`
- `backend/services/fundamentalsService.py`
- `backend/services/sec_financial_resolver.py`
- `frontend/public/ai-chat.js`
- `frontend/public/index.js`
- `frontend/public/index.html`
- `workspace/Financial Analyst Workspace/**`
- `workspace/Technical Analyst Workspace/**`
- `workspace/Pattern Analyst Workspace/**`

These files represent:

- workspace-backed analysts
- Ledger tool wiring
- earnings quality engine
- financial analysis engine
- DCF engine
- scanner analyst routing
- SEC-first financial resolution

## Artifact / Noise Buckets

These appear to be the highest-confidence artifact buckets that should stop polluting the main source-worktree view:

- benchmark stderr outputs:
  - `backend/data/*.stderr` (9)
- logs:
  - `backend/data/*.log` (2)
- benchmark outputs:
  - `backend/data/bench_*` (18)
- caches:
  - `backend/data/*cache*` (4 broad matches)
  - `backend/data/fundamentals-cache/*`
  - `backend/data/quote-cache/*`
  - `backend/data/option-quote-cache/*`
  - `backend/data/validator-symbol-cache/*`
- PIT backups:
  - `backend/data/pit-backups/*`
- local preferences:
  - `backend/data/preferences/*`
- formula-ranking result dumps:
  - `backend/data/formula-ranking-results/*`
- ad hoc sweep outputs:
  - `sweep_*.json` (4)

These should be reclassified as one of:

- generated runtime state
- benchmark output
- local cache
- local preference

They should not remain mixed in with product code as ambiguous unreviewed changes.

## Large New Data / Corpus Areas

These are not necessarily noise, but they need explicit classification:

- `Financial data/`
- `backend/data/fundamentals-pit.sqlite`
- `backend/data/ledger_filing_eligible.json`
- `backend/data/ledger_filing_eligibility_report.json`
- universe snapshots and cap-list JSONs
- new PIT / fundamentals support files

These likely belong in one of two categories:

1. durable local data assets
2. generated/rebuildable datasets

They should be documented as such, even if we keep them.

## Major Initiative Buckets Present In The Worktree

### 1. Ledger / Financial Analysis

- backend Ledger context
- SEC-first resolution
- PIT data access
- retrieval/RAG support
- workspace analysts
- Ledger tools and engines

### 2. Scanner / Frontend Analyst Routing

- scanner chat UI
- analyst selection
- workspace identity routing
- scanner prompt cleanup

### 3. Strategy / Pattern / Validation Research

- pattern JSON updates
- strategy JSON updates
- validator/sweep infrastructure
- family research tools

### 4. Execution / Trading Desk / Position Work

- execution routes
- broker/position/order services
- execution bridge state

### 5. Universe / Fundamental Data Foundation

- universe builders
- PIT store
- filing eligibility
- normalization and support scripts

### 6. Docs / Plans / Memory

- planning docs
- architecture notes
- memory-bank updates

## Cleanup Principles

1. Do not use `git reset --hard`.
2. Do not mass-delete work.
3. Do not treat generated data and source code as the same category.
4. Isolate by initiative first, then decide what belongs in source control.
5. Preserve Ledger work explicitly before touching broader cleanup.

## Recommended Cleanup Sequence

### Phase 1: Protect The Ledger Slice

- Explicitly identify and preserve all Ledger and analyst-routing files.
- Treat the Ledger slice as the first intentional checkpoint.

### Phase 2: Separate Source From Artifacts

- Classify benchmark outputs, caches, logs, and local runtime state.
- Move them under clearer conventions or ignore rules if appropriate.
- Do not delete until classification is explicit.

### Phase 3: Group Non-Ledger Active Work

- bucket by:
  - strategy/pattern research
  - execution/trading desk
  - universe/fundamentals foundation
  - planning/reference

This makes it possible to understand the current branch state in human terms.

### Phase 4: Decide Preservation Strategy Per Bucket

For each bucket, decide:

- active source work to keep in the repo
- generated artifacts to relocate or ignore
- local-only state to keep out of review surfaces

### Phase 5: Re-run Visibility Checks

After bucket cleanup:

- `git status --short`
- `git diff --name-only`
- `gitnexus_detect_changes()`

The goal is not a perfectly clean repo immediately. The goal is a repo whose dirty state is understandable and reviewable.

## Immediate Next Action

Create a bucketed file inventory with three labels:

- `protect now`
- `artifact/generated`
- `review later`

The Ledger slice should be fully labeled `protect now` before any broader cleanup moves happen.
