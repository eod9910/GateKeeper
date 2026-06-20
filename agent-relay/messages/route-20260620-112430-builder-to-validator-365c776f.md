# Builder Report: Validator Improve-Style Planning Standard

## Directive

Implement Validator directive `2026-06-20-validator-improve-style-planning-standard.md`.

## Files Changed

- `agent-relay/roles/Validator/ROLE.md`
- `.planning/plans/PLAN_CONVENTIONS.md`

## What Changed

Added a `Planning Standard` section to the Validator role. It requires substantial Builder directives and PRD/checklist work to be self-contained enough for Builder to execute without relying on prior chat context.

Added an `Executable Planning Standard` section to the planning conventions. It keeps the existing paired PRD/checklist format and adds quality requirements:

- current-state evidence;
- exact files/symbols/routes/data stores/UI surfaces/plans in scope;
- explicit out-of-scope boundaries;
- verification gates;
- STOP conditions;
- drift checks;
- Validator-verifiable done criteria.

## Boundaries Preserved

- No new planning folders were added.
- No external tool was installed or required.
- The repo's paired PRD/checklist convention remains canonical.
- Builder was not authorized to approve its own plans.

## Verification

Doc-only change. No product code changed.
