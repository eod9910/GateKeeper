# Non-Ledger Feature Classification

Date: 2026-04-02

## Purpose

Classify the remaining non-Ledger dirty feature areas so the repo state is understandable by initiative.

This is not a rollback plan.
This is not a deletion plan.

It is a feature-bucket map for cleanup and future checkpointing.

## High-Level Result

The remaining non-Ledger work is not one random blob.
It breaks cleanly into several real product initiatives:

- Execution / Trading Desk
- Strategy / Validator / Sweep
- Research / Family discovery
- SR / primitive normalization
- Broad frontend shell and page work
- Audio / voice and other newer surfaces

So the next cleanup decisions should happen by feature bucket, not file-by-file in isolation.

## 1. Execution / Trading Desk

### Backend

- `backend/src/routes/execution.ts`
- `backend/src/services/executionBridge.ts`
- `backend/src/services/brokerClient.ts`
- `backend/src/services/orderExecutor.ts`
- `backend/src/services/positionManager.ts`
- `backend/src/services/importedBrokerPositions.ts`
- `backend/src/services/positionMirrorService.ts`
- `backend/src/services/robinhoodAuthFlow.ts`
- `backend/services/execution_state.py`

### Frontend

- `frontend/public/execution.html`
- `frontend/public/execution-external-positions.js`
- `frontend/public/execution-status.js`
- `frontend/public/execution-ticket.js`
- `frontend/public/trade-intent.js`

### Classification

- `active-non-ledger`
- product area
- should remain visible

### Cleanup Recommendation

Do not treat this as repo noise.
Treat it as its own initiative bucket.

If we later want cleaner separation, this bucket can be checkpointed independently from Ledger work.

## 2. Strategy / Validator / Sweep

### Backend

- `backend/src/routes/strategies.ts`
- `backend/src/routes/validator.ts`
- `backend/src/routes/sweep.ts`
- `backend/services/strategyRunner.py`
- `backend/services/validatorPipeline.py`
- `backend/src/services/sweepEngine.ts`
- `backend/src/services/strategyGenService.ts`
- `backend/src/services/signalScanner.ts`
- `backend/src/services/parameterManifest.ts`
- `backend/src/types/strategy.ts`

### Frontend

- `frontend/public/strategy.html`
- `frontend/public/strategy.js`
- `frontend/public/validator.html`
- `frontend/public/validator.js`
- `frontend/public/validator-symbol-library.html`
- `frontend/public/validator-symbol-library.js`
- `frontend/public/sweep.html`
- `frontend/public/sweep.js`
- `frontend/public/sweep-history.html`
- `frontend/public/family-explorer.html`

### Classification

- `active-non-ledger`
- product / research crossover
- should remain visible

### Cleanup Recommendation

This bucket also looks legitimate and ongoing.
It should not be collapsed into generic “frontend noise” or “backend noise.”

## 3. Research / Family Discovery

### Backend

- `backend/src/routes/research.ts`
- `backend/src/services/researchAgent.ts`
- `backend/services/research_v1/explorer.py`
- `backend/services/research_v1/families.py`

### Frontend

- `frontend/public/research.html`
- `frontend/public/research.js`

### Memory / Docs

- `memory-bank/CHAT_MEMORY.md`
- research-related planning docs under `agent-relay/planning-docs/ongoing/`

### Classification

- `active-non-ledger`
- product / internal-research surface

### Cleanup Recommendation

Keep as a distinct bucket.

One special note:
- `frontend/public/research.html` appears to have visible encoding corruption in the title/comments.
- This is a real cleanup issue, but it is a code-quality/UX cleanup, not repo-state triage.

## 4. SR / Primitive / Formula Work

### Backend

- `backend/services/sr/`
- `backend/src/services/primitiveNormalization.ts`
- `backend/src/services/formulaRankingEngine.ts`
- `backend/services/platform_sdk/primitive_adapters.py`
- `backend/services/plugins/atr_primitive.py`
- `backend/services/plugins/fundamental_quality_filter_primitive.py`
- `backend/services/plugins/hs_pullback_continuation.py`
- `backend/services/plugins/lth_continuation_composite.py`
- `backend/services/plugins/ma_base_detector_indicator.py`
- `backend/services/plugins/ma_base_detector_primitive.py`
- `backend/services/plugins/sr_score_primitive.py`

### Frontend

- `frontend/public/fundamental-config-ui.js`

### Data Definitions

- `backend/data/patterns/atr_primitive.json`
- `backend/data/patterns/fundamental_quality_filter_primitive.json`
- `backend/data/patterns/hs_pullback_continuation.json`
- `backend/data/patterns/lth_continuation_composite.json`
- `backend/data/patterns/ma_base_detector_indicator.json`
- `backend/data/patterns/ma_base_detector_primitive.json`
- `backend/data/patterns/sr_score_primitive.json`
- `backend/data/sr_formulas.json`

### Classification

- `active-non-ledger`
- internal platform / indicator engine work

### Cleanup Recommendation

Treat this as a genuine platform-development bucket.
Not clutter.

## 5. Broad Frontend Shell / Page Work

### Examples

- `frontend/public/app.js`
- `frontend/public/styles.css`
- `frontend/public/copilot.html`
- `frontend/public/copilot-analysis.js`
- `frontend/public/copilot-chart.js`
- `frontend/public/copilot-chat.js`
- `frontend/public/copilot-core.js`
- `frontend/public/copilot-execution-route.js`
- `frontend/public/history.html`
- `frontend/public/history.js`
- `frontend/public/settings.html`
- `frontend/public/training.html`
- `frontend/public/tombstones.html`
- `frontend/public/tombstones.js`
- `frontend/public/workshop*.js`
- `frontend/public/blockly-composer*`
- `frontend/public/pipeline-composer*`

### Classification

- `review-later`
- likely real work, but currently too broad to clean up safely in the same pass as Ledger

### Cleanup Recommendation

This bucket should be split by actual product surface later, for example:

- Workshop Builder
- Blockly / Pipeline Composer
- Copilot legacy surfaces
- History / Tombstones / Settings

Do not try to normalize this whole area in the current cleanup pass.

## 6. Audio / Voice

### Backend

- `backend/src/routes/audio.ts`
- `backend/src/services/audioService.ts`

### Frontend

- `frontend/public/voice-input.js`

### Classification

- `review-later`
- new surface area
- not part of the Ledger-first cleanup path

## 7. Shared Shell / Repo Meta

### Files

- `AGENTS.md`
- `CLAUDE.md`
- `requirements.txt`
- `agent-relay/planning-docs/README.md`

### Classification

- `review-later`

These are meaningful repo-level changes, but they are not urgent cleanup blockers.

## What This Means For Cleanup

### Keep Focused Now

The repo-state cleanup should continue to prioritize:

- protected Ledger slice
- generated/local artifact suppression
- classification by initiative

### Do Not Do Yet

Do not try to:

- refactor execution and strategy buckets at the same time
- reorganize the whole frontend in one pass
- resolve every doc/planning change right now

## Recommended Next Cleanup Priority

If we continue cleanup after this classification, the best next target is:

### `execution-bridge-config.json` and similar tracked mutable local-state files

Why:

- they continue to dirty the tree
- they are not well handled by ignore rules because they are already tracked
- they represent the main remaining form of “stateful noise” rather than true source work

That would be a small architectural cleanup, not a rollback.
