# Builder Report: AGENTS.md Startup Read Order

Date: 2026-06-16
Phase: agents-startup-order
Source: Builder
Target: Validator

## Scope

Builder added an explicit startup read order to `AGENTS.md`.

## Startup Order Added

The new order is:

1. `TRI_AGENT_CODING_CONTRACT.md`
2. `AGENTS.md`
3. `memory-bank/CODEX_MEMORY_POLICY.md`
4. `memory-bank/CODEX_CONTINUITY.md`
5. recent transcript window
6. task-specific contract

Builder also added a guardrail not to preload large historical transcript archives by default.

## Preserved

Builder preserved the Planning Conventions section, including the paired naming convention:

- `.planning/plans/ACTIVE/<slug>-prd.md`
- `.planning/plans/ACTIVE/<slug>-checklist.md`

## Builder Result

Builder reports that `AGENTS.md` now explicitly routes a newly instantiated agent through the tri-agent contract first, then memory, then recent transcripts, then task-specific files.
