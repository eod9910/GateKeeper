# Active Plan Inventory

Status: TODO
Created: 2026-06-01
Updated: 2026-06-01

## Purpose

Inventory the current `ACTIVE` folder so completed, parked, reference, or superseded plans can move to the right bucket, leaving `ACTIVE` for work that is genuinely in motion.

## Review Rule

Do not move plans automatically unless the destination is obvious. For each active item, decide one of:

- Keep active: still drives near-term work.
- Move to TODO: approved but not currently in motion.
- Move to BACKLOG: idea inventory, not committed.
- Move to REFERENCE: useful architecture/context, not an execution plan.
- Move to ARCHIVE: completed, superseded, or no longer the source of truth.

## Current Active Count

After the 2026-06-01 cleanup pass, `.planning/plans/ACTIVE` contains 38 files.

## 2026-06-01 Cleanup Moves

Moved to `REFERENCE`:

- `backend-data-and-scripts-classification.md`
- `non-ledger-feature-classification.md`
- `repo-state-bucket-map.md`
- `repo-state-cleanup-inventory.md`
- `market-intelligence-api-contract.md`
- `market-intelligence-llm-model-choice.md`
- `family-discovery-v2-prd-pdr.md`

Moved to `ARCHIVE`:

- `repo-state-snapshot-2026-03-30.md`
- `session-checkpoint-2026-05-05-market-intelligence.md`

Moved to `TODO`:

- `workspace-agent-harness-plan.md`

## Highest Priority Review Targets

These still look most likely to need the next review because they are old, broad, or may have been superseded by newer Ledger and Market Intelligence work:

- `backtesting-master.md`
- `python-execution-layer.md`
- `research-to-live-trading.md`
- `scanner-fundamentals-industrialization-plan.md`
- `ledger-data-foundation-todo.md`
- `ledger-data-foundation-and-pit-ingestion-plan.md`
- `financial-data-execution-plan-2026-03-30.md`

Market Intelligence review completed 2026-06-01:

- `market-intelligence-checklist.md` stays ACTIVE as the live status source.
- `market-intelligence-scenario-engine-prd-pdr.md` is now marked implemented-baseline/reference inside the document; move to REFERENCE on the next file-organization pass if desired.
- Remaining Market Intelligence active work is Phase 5 replay/calibration/proof plus Phase 6 consumer-brand signal data-flow verification.

## Newly Proposed TODO Item

- `ACTIVE/fundamental-research-lab-prd.md`
- `ACTIVE/fundamental-research-lab-checklist.md`

This should move to `ACTIVE` when implementation starts.

## Active Files

- `backtesting-master.md`
- `data-caching-freshness-architecture.md`
- `edgar-filings-checklist.md`
- `edgar-filings-prd.md`
- `expectation-gap-detector-prd.md`
- `family-structure-validation-ledger.md`
- `financial-data-execution-plan-2026-03-30.md`
- `frontend-react-migration-checklist.md`
- `frontend-react-migration-prd.md`
- `ledger-coverage-tier-contract.md`
- `ledger-data-foundation-and-pit-ingestion-plan.md`
- `ledger-data-foundation-todo.md`
- `ledger-data-storage-and-retrieval-architecture.md`
- `ledger-normalization-family-design.md`
- `ledger-source-priority-matrix.md`
- `legacy-plugin-conversion-plan.md`
- `market-intelligence-asymmetric-narrative-plan.md`
- `market-intelligence-checklist.md`
- `market-intelligence-historical-replay-checklist.md`
- `market-intelligence-historical-replay-prd.md`
- `market-intelligence-scenario-engine-prd-pdr.md`
- `multi-agent-patterns-checklist.md`
- `multi-agent-patterns-prd.md`
- `primitive-normalization-contract-v0.md`
- `primitive-normalization-engine-and-autonomous-research.md`
- `python-execution-layer.md`
- `repo-hygiene-followups-2026-04-16.md`
- `repo-state-recovery-and-guardrails-plan.md`
- `research-to-live-trading.md`
- `scalping-strategy-capability-inventory.md`
- `scanner-fundamentals-industrialization-plan.md`
- `signal-strategy-methodology-checklist.md`
- `signal-strategy-methodology-prd.md`
- `single-user-production-readiness-checklist.md`
- `SR Engine.md`
- `structural-families-to-execution-prd.md`
- `trading-desk-execution-industrialization-plan.md`
- `Update.md`
