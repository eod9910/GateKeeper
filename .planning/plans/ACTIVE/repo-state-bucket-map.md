# Repo-State Bucket Map

Date: 2026-04-02

## Purpose

Label the current dirty worktree into actionable buckets without deleting work or rolling anything back.

Primary labels:

- `protect-now`
- `artifact-generated`
- `review-later`
- `active-non-ledger`

## Protect Now

These are the files and directories that represent the current Ledger / analyst / workspace architecture and should be treated as the protected slice during repo-state cleanup.

### Ledger / Analyst Runtime

- `backend/src/services/copilotTools.ts`
- `backend/src/services/ledgerEngines.ts`
- `backend/src/services/visionService.ts`
- `backend/src/routes/vision.ts`
- `backend/src/routes/fundamentals.ts`
- `backend/services/ledgerContext.py`
- `backend/services/fundamentalsService.py`
- `backend/services/sec_financial_resolver.py`

### Scanner / Analyst UI

- `frontend/public/ai-chat.js`
- `frontend/public/index.js`
- `frontend/public/index.html`

### Workspace Layer

- `workspace/`

### Ledger Design / Memory Docs

- `.planning/plans/ACTIVE/ledger-coverage-tier-contract.md`
- `.planning/plans/ACTIVE/ledger-data-foundation-and-pit-ingestion-plan.md`
- `.planning/plans/ACTIVE/ledger-data-foundation-todo.md`
- `.planning/plans/ACTIVE/ledger-data-storage-and-retrieval-architecture.md`
- `.planning/plans/ACTIVE/ledger-normalization-family-design.md`
- `.planning/plans/ACTIVE/ledger-source-priority-matrix.md`
- `docs/agent-tooling-development-howto.md`
- `docs/ledger-canonical-fact-schema.md`
- `memory-bank/LATEST.md`

## Artifact / Generated

These should be treated as generated or local-state buckets rather than ambiguous source-code changes.

### Benchmark Output

- `backend/data/bench_*.json`
- `backend/data/bench_*.stderr`

### Logs

- `backend/data/*.log`
- `backend/data/*.stderr`

### Caches

- `backend/data/fundamentals-cache/`
- `backend/data/quote-cache/`
- `backend/data/option-quote-cache/`
- `backend/data/validator-symbol-cache/`

### Local Runtime / Backups

- `backend/data/pit-backups/`
- `backend/data/preferences/`
- `backend/data/formula-ranking-results/`

### Sweep Output

- `sweep_debug.json`
- `sweep_out.json`
- `sweep_plan.json`
- `sweep_plan2.json`

### Large Local Filing / Retrieval Corpus

- `Financial data/`

Note:
- this is valuable local data, not junk
- but it is still generated/local corpus state, not normal source code

## Active Non-Ledger

These look like real product or research work, but they are not part of the protected Ledger slice.

### Universe / PIT / Fundamentals Foundation

- `backend/scripts/build_clean_universe.py`
- `backend/scripts/build_fundamentals_pit_store.py`
- `backend/scripts/build_ledger_filing_eligible_universe.py`
- `backend/scripts/build_mixed_cap_validation_ladder.py`
- `backend/scripts/build_regime_universes.py`
- `backend/scripts/hydrate_fundamentals_pit.py`
- `backend/scripts/import_companyfacts_to_pit.py`
- `backend/scripts/populate_cap_tier_pit.py`
- `backend/scripts/rebuild_stock_universes.py`
- `backend/services/fundamentals_pit_query.py`
- `backend/services/fundamentals_pit_store.py`
- `backend/services/ledgerCoverage.py`
- `backend/services/universe_registry.py`
- `backend/src/services/universeRegistry.ts`
- `backend/data/fundamentals-pit.sqlite`
- `backend/data/ledger_filing_eligible.json`
- `backend/data/ledger_filing_eligibility_report.json`
- universe snapshot JSON files under `backend/data/`

### SR / Primitive / Pattern Research

- `.planning/plans/ACTIVE/SR Engine.md`
- `backend/services/sr/`
- `backend/services/platform_sdk/primitive_adapters.py`
- `backend/services/plugins/atr_primitive.py`
- `backend/services/plugins/fundamental_quality_filter_primitive.py`
- `backend/services/plugins/hs_pullback_continuation.py`
- `backend/services/plugins/lth_continuation_composite.py`
- `backend/services/plugins/ma_base_detector_indicator.py`
- `backend/services/plugins/ma_base_detector_primitive.py`
- `backend/services/plugins/sr_score_primitive.py`
- `backend/data/patterns/atr_primitive.json`
- `backend/data/patterns/fundamental_quality_filter_primitive.json`
- `backend/data/patterns/hs_pullback_continuation.json`
- `backend/data/patterns/lth_continuation_composite.json`
- `backend/data/patterns/ma_base_detector_indicator.json`
- `backend/data/patterns/ma_base_detector_primitive.json`
- `backend/data/patterns/sr_score_primitive.json`
- `backend/data/sr_formulas.json`

### Strategy / Validation / Sweep / Family Work

- modified pattern JSONs under `backend/data/patterns/`
- modified strategy JSONs under `backend/data/strategies/`
- `backend/services/research_v1/explorer.py`
- `backend/services/research_v1/families.py`
- `backend/services/strategyRunner.py`
- `backend/services/validatorPipeline.py`
- `backend/src/routes/strategies.ts`
- `backend/src/routes/sweep.ts`
- `backend/src/routes/validator.ts`
- `backend/src/services/sweepEngine.ts`
- `backend/src/services/signalScanner.ts`
- `backend/src/services/strategyGenService.ts`
- strategy/validator frontend files under:
  - `frontend/public/strategy*`
  - `frontend/public/sweep*`
  - `frontend/public/validator*`
  - `frontend/public/family-explorer.html`

### Execution / Trading Desk / Broker State

- `backend/src/routes/execution.ts`
- `backend/src/services/brokerClient.ts`
- `backend/src/services/executionBridge.ts`
- `backend/src/services/importedBrokerPositions.ts`
- `backend/src/services/orderExecutor.ts`
- `backend/src/services/positionManager.ts`
- `backend/src/services/positionMirrorService.ts`
- `backend/src/services/robinhoodAuthFlow.ts`
- execution frontend files under:
  - `frontend/public/execution*`
  - `frontend/public/trade-intent.js`

### Audio / Misc New Surface Area

- `backend/src/routes/audio.ts`
- `backend/src/services/audioService.ts`
- `frontend/public/voice-input.js`

## Review Later

These areas need deliberate human review because they may be meaningful but are not urgent cleanup targets for the Ledger-first pass.

### Planning / PRD / Architecture Docs

- `.planning/plans/ACTIVE/`
- `.planning/plans/README.md`
- `AGENTS.md`
- `CLAUDE.md`

### Memory / Transcript Capture

- `memory-bank/CHAT_MEMORY.md`
- `memory-bank/transcripts/`

### Broad Frontend Files Outside Immediate Ledger Slice

- `frontend/public/app.js`
- `frontend/public/styles.css`
- `frontend/public/copilot-*`
- `frontend/public/research*`
- `frontend/public/workshop-*`
- `frontend/public/blockly-composer*`
- `frontend/public/pipeline-composer*`
- `frontend/public/history*`
- `frontend/public/tombstones*`
- `frontend/public/settings.html`
- `frontend/public/training.html`
- `frontend/public/vision-lab.html`

These are probably real work, but they should be grouped by feature before deciding what to checkpoint.

## Practical Cleanup Order

1. Protect the `protect-now` slice.
2. Reclassify `artifact-generated` files so they stop polluting source-work review.
3. Group `active-non-ledger` work by initiative.
4. Leave `review-later` as deferred, documented inventory rather than trying to resolve everything immediately.

## Immediate Next Action

For the next cleanup pass, focus only on:

- `protect-now`
- `artifact-generated`

Do not attempt to reorganize every unrelated feature bucket in the same pass.
