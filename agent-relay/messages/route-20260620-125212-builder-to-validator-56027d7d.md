# Builder Report: Pattern Detector Coding Paradigm

## Status

Implemented.

## Files Changed

- `PATTERN_DETECTOR_CODING_PARADIGM.md`
- `AGENTS.md`
- `agent-relay/roles/Validator/ROLE.md`
- `agent-relay/roles/Builder/ROLE.md`
- `agent-relay/roles/Editor/ROLE.md`

## Changes

- Added a project-level coding paradigm contract declaring Pattern Detector as a
  `medium-large-modular-web` project.
- Added the target modular-monolith architecture and product domain boundaries.
- Added startup visibility in `AGENTS.md`.
- Added Validator enforcement requirements for substantial directives.
- Added Builder enforcement requirements for staying inside approved domain
  boundaries.
- Added Editor drift-review requirements and blocker conditions.
- Preserved incremental migration: no product code was moved.

## Verification

- Pending: `python tools\agent_router.py verify`

## Residual Risk

- This stops future drift through governance, but existing old-shape code remains
  until migrated by approved vertical slices.
