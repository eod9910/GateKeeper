# Repo State Snapshot - 2026-03-30

**Status:** ACTIVE SNAPSHOT  
**Created:** 2026-03-30  
**Purpose:** Establish the phase-1 operational baseline for repo cleanup. This file answers: what state is the repo in, what is active, what is generated, what is ambiguous, and what should not be touched casually.

---

## Executive Summary

The repo is actively moving, but the current git state is too mixed to trust without bucketing.

Current high-level reality:

- the active strategic workstream is **Ledger / PIT / SEC / Docling**
- the repo also carries a large volume of concurrent scanner/strategy/app edits
- the worktree is heavily mixed:
  - `129` modified tracked entries
  - `2` added in index
  - `146` untracked entries
  - `277` total git status entries
- the PIT database and SEC probe are real and populated
- the worktree is not clean enough to use repo-wide diff output as a reliable task-level signal

---

## Baseline Repo Identity

- Branch: `snapshot/clean-gatekeeper-2026-03-17`
- Last commit: `e0dbb0f0b477d4c83c138d80d193d2d490c34e1c`
- Last commit date: `2026-03-17 13:28:54 -0700`
- Last commit subject: `Clean Gatekeeper code snapshot 2026-03-17`

GitNexus indexed context currently reports:

- `461` files
- `5513` symbols
- `300` execution flows

---

## Worktree Buckets

These buckets are for operational reasoning, not permanent taxonomy.

### 1. Active Ledger / PIT / SEC Work

Approximate status footprint identified from git state: `27` entries directly visible, with additional SEC artifacts hidden behind the untracked top-level `Financial data/` directory entry.

Includes:

- `memory-bank/LATEST.md`
- `memory-bank/CHAT_MEMORY.md`
- `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`
- `.planning/plans/ACTIVE/ledger-data-foundation-todo.md`
- `.planning/plans/ACTIVE/repo-state-recovery-and-guardrails-plan.md`
- `docs/ledger-canonical-fact-schema.md`
- `workspace/Financial Analyst Workspace/`
- `Financial data/docling_probe/`
- PIT/universe helper scripts and generated universe outputs

Interpretation:

- this is intentional active work
- do not casually revert or archive this bucket
- this bucket should be isolated from broader repo noise as the current primary workstream

### 2. Scanner / Strategy / App Work

Approximate status footprint: `185` entries.

This includes large clusters of changes under:

- `backend/data/patterns/`
- `backend/data/strategies/`
- `backend/src/`
- `backend/services/`
- `frontend/public/`

Interpretation:

- this is a separate major workstream or accumulation of several
- do not mix its cleanup with Ledger data cleanup by default
- this bucket needs its own review pass before any revert or archival decisions

### 3. Generated Data Artifacts

Approximate status footprint: `31` obvious entries, plus larger untracked cache and data directories.

Examples:

- `backend/data/bench_*.json`
- `backend/data/bench_*.stderr`
- `backend/data/warmup.log`
- `backend/data/warmup-err.log`
- `sweep_debug.json`
- `sweep_out.json`
- `sweep_plan.json`
- `sweep_plan2.json`
- cache directories under `backend/data/`

Interpretation:

- these are likely safe to move out of normal git noise
- do not delete blindly, but they should not remain mixed with code changes without policy

### 4. Planning / Project Docs

Approximate status footprint: `12` entries.

Includes:

- `.planning/plans/ACTIVE/Update.md`
- `.planning/plans/ACTIVE/family-discovery-v2-prd-pdr.md`
- `.planning/plans/ACTIVE/single-user-production-readiness-checklist.md`
- `.planning/plans/README.md`
- `AGENTS.md`
- `CLAUDE.md`
- several untracked active planning docs

Interpretation:

- this bucket has both valid active planning and stale/drifting documents
- it needs reconciliation, not blanket cleanup

### 5. Workspace Assets

Currently visible as the untracked top-level `workspace/` directory.

Known contents:

- `workspace/Financial Analyst Workspace/`
- `workspace/Pattern Analyst Workspace/`
- `workspace/Scanner Copilot Workspace/`
- `workspace/Technical Analyst Workspace/`
- `workspace/CFA Prerequisite 2024 - Volume 3 - Financial Statement Analysis.pdf`

Interpretation:

- at least one workspace is active and important (`Financial Analyst Workspace`)
- the whole workspace tree should not be treated as one disposable blob

### 6. Unknown / Review Bucket

Approximate visible footprint: `22` entries.

Examples:

- `backend/data/app-reference.md`
- `backend/data/execution-bridge-config.json`
- `backend/data/symbols.json`
- `requirements.txt`
- `backend/data/large_cap_500.json`
- `backend/data/large_cap_known.json`
- `backend/data/market_cap_snapshot.json`
- `backend/data/mid_cap_500.json`
- `backend/data/mixed_cap_tier1.json`
- `backend/data/regime_*.json`

Interpretation:

- these need classification before cleanup
- they are not safe to revert or archive without confirming role and ownership

---

## Source-of-Truth Docs Right Now

Current highest-authority docs for the active Ledger workstream:

- `memory-bank/LATEST.md`
- `memory-bank/CHAT_MEMORY.md`
- `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`
- `.planning/plans/ACTIVE/ledger-data-foundation-todo.md`
- `docs/ledger-canonical-fact-schema.md`
- `.planning/plans/ACTIVE/repo-state-recovery-and-guardrails-plan.md`

Known doc-drift note:

- `Financial data/docling_probe/README.md` still lags the memory bank on Microsoft smoke-test status

---

## Live Operational State

### Running Jobs

Observed during snapshot:

- a live PIT hydration process is running via `backend/scripts/hydrate_fundamentals_pit.py`
- multiple `gitnexus mcp` processes are also present

Operational implication:

- cleanup work must not assume the repo is fully idle
- long-running data jobs should be recorded before session end

### Workspace State

The Financial Analyst workspace is present and meaningful.

Observed workspace contract status:

- the workspace has standing-order docs and skills
- the workspace memory still says Ledger's exact app input schema and output schema remain open questions

Operational implication:

- the analyst persona/workspace exists
- the app-to-Ledger contract still needs explicit definition

---

## Data Foundation State

### PIT Database

`backend/data/fundamentals-pit.sqlite` exists and is materially populated.

Snapshot counts observed:

- `raw_source_cache`: `2997`
- `raw_source_cache_history`: `2983`
- `asof_symbol_snapshots`: `2998`
- `pit_fundamental_facts`: `328862`
- `pit_market_facts`: `54524`
- `pit_event_facts`: `73265`
- `pit_documents`: `26`
- `pit_statement_facts`: `528`

Hydration progress against the current clean universe:

- clean universe size: `3539`
- hydrated symbols: `2998`
- completion: `84.71%`

### Filing-Derived PIT Depth

Observed:

- `AAPL`: `13` documents, `264` statement facts
- `MSFT`: `13` documents, `264` statement facts

Interpretation:

- filing-derived PIT is real
- filing-derived breadth is still narrow

### SEC Probe State

Observed under `Financial data/docling_probe/`:

- `raw/sec/`: populated, with `49` CIK directories
- raw filing docs (`.htm`, excluding bulk and batch summaries): `120`
- `processed/docling/`: `78` files
- `extracted/canonical/`: `26` files
- `extracted/smoke_tests/`: `2` smoke-test roots

Observed batch-run totals:

- batch files: `3`
- symbols requested: `75`
- symbols completed: `68`
- symbols failed: `7`

### SEC Bulk Status

Observed:

- `companyfacts.zip`: valid, opens successfully, `19353` entries
- `submissions.zip`: currently invalid/corrupt and not usable as a verified bulk baseline

Operational implication:

- the bulk ingestion strategy is only partially ready

---

## Do Not Touch Yet

Until further classification:

- do not revert the large scanner/strategy/app bucket blindly
- do not archive the Financial Analyst workspace
- do not treat the entire `Financial data/` tree as disposable
- do not delete untracked planning docs just because they are untracked
- do not make cleanup decisions against live PIT or SEC artifacts without distinguishing source data from generated convenience outputs

---

## Safe-to-Review-For-Relocation First

These are the best first candidates for reducing git noise without touching core logic:

- benchmark JSON/stderr outputs under `backend/data/bench_*`
- warmup logs
- sweep debug/output/plan JSON files
- local cache directories under `backend/data/`
- batch summary outputs that should live under an explicit generated-artifacts policy

Important note:

- "safe to review for relocation" does **not** mean "safe to delete without confirmation"

---

## Immediate Cleanup Recommendations

1. Create a tracked working-set note for the active Ledger/PIT/SEC files
2. Move obvious generated artifacts behind an ignore or external-output policy
3. Classify the `unknown/review` bucket one file family at a time
4. Repair and verify `submissions.zip`
5. Reconcile stale status docs before adding more status notes
6. Define the Ledger app input/output contract before broad normalization work

---

## Phase-1 Exit Judgment

Phase 1 is **partially completed** by this snapshot.

What is now true:

- the repo state is bucketed enough to reason about
- the current primary workstream is unambiguous
- live jobs and live data stores have been identified
- the most obvious generated-noise candidates are known

What remains before phase 1 can be called fully complete:

- classify the `unknown/review` bucket more precisely
- create a durable working-set note for the active Ledger slice
- decide which generated outputs belong in git noise and which should move behind policy
