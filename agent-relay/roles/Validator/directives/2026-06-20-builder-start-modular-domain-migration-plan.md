# Builder Directive: Start Modular Domain Migration Plan

## Objective

Start Pattern Detector's incremental migration toward the declared
`medium-large-modular-web` coding paradigm by creating the active planning
workstream.

## Scope

Planning/governance only. Do not move product code.

Expected files:

- `.planning/plans/ACTIVE/modular-domain-migration-prd.md`
- `.planning/plans/ACTIVE/modular-domain-migration-checklist.md`

## Requirements

- Use the paired PRD/checklist convention from
  `.planning/plans/PLAN_CONVENTIONS.md`.
- Declare the first migration candidate as `universe/scanner`.
- Preserve incremental migration and forbid a whole-repo reshuffle.
- Require the first implementation step to be a current-flow audit before code
  movement.
- Include Validator, Builder, Editor, verification, STOP, and done criteria.

## Verification

- Confirm the PRD links to the checklist.
- Confirm the checklist links to the PRD and includes a percent complete line.
- Run `python tools\agent_router.py verify`.
