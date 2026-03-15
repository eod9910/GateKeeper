# Plan Retention Audit

This is a retention audit, not a roadmap. The goal is to decide which planning files still add value and which ones should be merged, archived, or deleted.

Legend:

- `KEEP`
  Still useful as a current source of truth or technical reference.
- `MERGE`
  Useful, but should be consolidated into another file.
- `ARCHIVE`
  Historical context only. Keep if you want record, but do not use as current guidance.
- `DELETE`
  Low-value duplicate, stale mockup, or obsolete plan with no clear future use.

## ACTIVE

- `single-user-production-readiness-checklist.md`
  `KEEP`
  This is a real current checklist, not a concept note.
- `legacy-plugin-conversion-plan.md`
  `KEEP`
  Still maps directly to unfinished scanner architecture work.
- `backtesting-master.md`
  `KEEP`
  High-level active domain plan.
- `python-execution-layer.md`
  `KEEP`
  Consolidated source of truth after merging the rollout file into it.
- `research-to-live-trading.md`
  `KEEP`
  Still useful as a system-level pipeline plan.

## BACKLOG

- `adaptive-optimizer-plan.md`
  `KEEP`
  Real future work, still backlog.
- `ai_role_contracts.md`
  `KEEP`
  Relevant if AI roles become stricter again.
- `distilled-base-analyst.md`
  `KEEP`
  Still plausibly useful if scanner analysis workflows continue.
- `evolutionary-strategy-lab.md`
  `KEEP`
  Legitimate backlog item, not obviously dead.
- `indicator-studio-library-plan.md`
  `KEEP`
  Consolidated indicator-studio/library backlog plan after merge.
- `operator_behavior_audit.md`
  `KEEP`
  Behavior/process enforcement fits the product direction.
- `operator_deviation.schema.json`
  `KEEP`
  Keep with operator behavior audit if that work remains on the table.
- `operator_reliability_score.schema.json`
  `KEEP`
  Keep with operator behavior audit if that work remains on the table.
- `strategy_hypothesis_schema.md`
  `KEEP`
  Still relevant to strategy formalization.
- `trade_postmortem.schema.json`
  `KEEP`
  Keep with operator behavior audit bundle.
- `unified-symbol-catalog.md`
  `KEEP`
  Still a legitimate infrastructure backlog item.

## REFERENCE

- `builder-composite-awareness.md`
  `KEEP`
  Still useful if plugin-building AI remains in scope.
- `design-system-v4.md`
  `KEEP`
  Reference material with continuing value.
- `rdp-swing-detection.md`
  `KEEP`
  Still relevant technical reference.
- `strategy-authoring-guide.md`
  `KEEP`
  Durable documentation value.
- `strategy-section-breakdown.md`
  `KEEP`
  Useful contract/reference doc.
- `system-pipeline-architecture.md`
  `KEEP`
  Still valuable as a high-level conceptual reference.
- `unified_swing_structure.md`
  `KEEP`
  Still useful if swing unification remains an active technical direction.

## ARCHIVE

Retained archive files are now mostly higher-value historical records or superseded references worth keeping for context:

- `ai-app-knowledge.md`
- `blockly_based_indicator_studio_design_report.md`
- `execution-training-forward-test-module-plan.md`
- `indicator_structure.md`
- `plugin-system-architecture.md`
- `primitive_dual_mode_architecture.md`
- `scanner-refactor-plan.md`
- `strategy-copilot-metaprompt.md`
- `strategy-scanner-refactor.md`
- `validator-backtesting-task-list.md`

## Cleanup Status

Completed in this pass:

1. merged the Python execution plan set into `ACTIVE/python-execution-layer.md`
2. merged the indicator-library plan set into `BACKLOG/indicator-studio-library-plan.md`
3. deleted stale mockups and low-value concept files
4. deleted low-value completed archive files
5. moved stale reference docs out of `REFERENCE`

If another pass is needed later, it should focus on `memory-bank/PRDs`, not `.planning/plans`.
