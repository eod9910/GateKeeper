# Agent Operating Contract

This document is binding repo-local governance for coding agents working in
Pattern Detector. It exists to prevent agent drift, duplicate engines, scattered
outputs, and unrecoverable research artifacts.

## Purpose

Agents must use the system that already exists unless the user explicitly asks
to design or replace that system. A new agent instance must be able to read this
file and know where to route common requests.

For major coding work, governance changes, or core trading/backtest/research
systems, also follow `agent-relay/TRI_AGENT_CODING_CONTRACT.md`. Role handoffs
that need a durable record should use `agent-relay/tools/agent_router.py`.

## Non-Negotiable Rules

1. Do not invent a new backtest engine for ordinary backtest requests.
2. Do not create throwaway backtest scripts unless the user explicitly asks for
   an experiment or the existing engine cannot answer the question.
3. Do not store backtest results in arbitrary locations.
4. Every backtest or research simulation must leave a recoverable artifact:
   configuration, engine/source, timestamp, output paths, and result summary.
5. If a request is ambiguous, classify it first and state the classification
   before running anything.
6. Exploratory research must use the Research Study Framework. It may contain
   flexible study logic, but the record must be centralized.

## Backtest Request Router

Use this decision table whenever the user asks to "run a backtest", "test this
strategy", "see if this worked historically", "run a study", or similar.

| User intent | Required system | Required storage |
| --- | --- | --- |
| Technical strategy backtest using price/indicator/primitive/composite rules | Validator pipeline: `backend/src/routes/validator.ts` -> `backend/services/validatorPipeline.py` -> `backend/services/backtestEngine.py` | `backend/data/validation-reports`, `backend/data/trade-instances`, and `app-state.sqlite` validation tables |
| Strategy parameter sweep | Existing sweep system and validator integration | `backend/data/sweep-results`, validator reports/trades, and sweep app-state records |
| Fundamental/PIT backtest | Fundamental Backtester service/script: `backend/src/services/fundamentalBacktestService.ts` -> `backend/scripts/run_fundamental_backtester.py` | `app-state.sqlite` namespace `fundamental_backtest_runs`; app output files in `backend/data/research/fundamental_backtest_*`; sweep artifacts in `backend/data/research/fundamental-sweeps` |
| Valuation gap accuracy study | Existing valuation backtest service/script: `backend/src/services/valuationBacktestService.ts` -> `backend/scripts/run_valuation_gap_accuracy_study.py` | `backend/data/research/valuation_gap_*` plus `research_tools` runtime snapshots in `app-state.sqlite` |
| Valuation signal strategy study | Existing valuation signal service/script: `backend/src/services/valuationSignalStrategyService.ts` -> `backend/scripts/run_valuation_signal_strategy.py` | `backend/data/research/valuation_signal_strategy_*` plus `research_tools` runtime snapshots in `app-state.sqlite` |
| Exploratory one-off research | Research Study Framework, using the closest existing research service/script or a clearly named study module only after confirming no existing engine fits | `backend/data/research/studies/<study_id>/` with `manifest.json`, `config.json`, `summary.json`, `artifacts.json`, and `notes.md` |

## Research Study Framework

Exploratory research is governed by `backend/research_framework/`.

The framework is flexible by design. It does not prevent unusual research
questions, but it does require every study to leave the same trail:

- `manifest.json`
- `config.json`
- `summary.json`
- `artifacts.json`
- `notes.md`

The canonical generated location is:

```text
backend/data/research/studies/<study_id>/
```

Historical research artifacts were migrated non-destructively into this central
structure by `backend/research_framework/tools/migrate_legacy_research.py`.
Legacy files may remain in their original locations when app code still expects
them there, but the central study manifest must point to those files.

## Required Agent Behavior

Before running or writing a backtest:

1. Identify the request type: technical validator, sweep, fundamental, valuation,
   or exploratory research.
2. Name the engine or service that will be used.
3. Name the output location where results will be saved.
4. Reuse existing routes, services, scripts, and schemas.
5. If proposing a new script, explain why no existing engine applies.
6. If the work is exploratory research, create or update a Research Study
   Framework record under `backend/data/research/studies/<study_id>/`.

After running a backtest:

1. Report the run id or report id.
2. Report the output files and/or SQLite namespace.
3. Report the command, route, or service used.
4. Do not summarize results without preserving where the full result lives.
5. For exploratory research, report the study id and manifest path.

## Scratch Work Rules

Scratch scripts are allowed only for inspection or diagnosis, not as permanent
backtest engines. Scratch files must be:

- named with `_tmp_` only while temporary;
- removed, archived, or promoted before handoff;
- never treated as canonical evidence;
- never used repeatedly without being promoted into a named service/script.
- registered as `scratch_legacy` or promoted into a Research Study Framework
  study if they produced evidence that should be kept.

## Promotion Rules

Research output is not a validated strategy. A research study may suggest a
candidate, but promotion requires the appropriate validator, sweep, or
fundamental promotion path already present in the app.

No agent may mark a strategy live, validated, production, or approved based only
on a one-off study.

## Drift Check

If an agent finds multiple ways to do the same backtest, it must prefer the
oldest canonical app-integrated path. If the newer path is better, the agent must
propose a migration instead of silently using both.

## Short Version

Classify the request. Use the existing engine. Save results centrally. Leave a
trail. Do not create a new engine because it is easier in the moment.

For major work, keep Validator, Builder, and Editor roles separate. Use the
Agent Relay when a role handoff should be auditable.
