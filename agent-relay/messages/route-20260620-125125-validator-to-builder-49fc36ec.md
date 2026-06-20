# Builder Directive: Declare Pattern Detector Coding Paradigm

## Objective

Declare Pattern Detector as a `medium-large-modular-web` project so future
Validator, Builder, and Editor work enforces the modular-monolith coding
paradigm from the beginning of each task.

## Scope

Documentation/governance only. Do not move product code.

Allowed files:

- `PATTERN_DETECTOR_CODING_PARADIGM.md`
- `AGENTS.md`
- `agent-relay/roles/Validator/ROLE.md`
- `agent-relay/roles/Builder/ROLE.md`
- `agent-relay/roles/Editor/ROLE.md`

## Requirements

- Add a project-level coding paradigm contract.
- Make the contract visible from startup via `AGENTS.md`.
- Require Validator directives to name the selected package, affected domain,
  current files, target boundary, shared-contract permission, verification
  gates, and STOP conditions.
- Require Builder to stay inside the named domain boundary or report back.
- Require Editor to treat architecture drift as a blocker when it would create
  or preserve spaghetti.
- Preserve incremental migration: no whole-repo reshuffle.

## Verification

- Run `python tools\agent_router.py verify`.
- Report changed files.
