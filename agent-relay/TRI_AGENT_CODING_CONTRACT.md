# Tri-Agent Coding Contract

This project uses a lightweight Validator, Builder, and Editor workflow. It may
also use Experience as a separate app-surface review role when UI aesthetics,
usability, or workflow feel matter.

## Startup Order

1. Read `AGENTS.md`.
2. Read this contract.
3. Read the active role document before doing role-specific work:
   - `agent-relay/roles/Validator/ROLE.md`
   - `agent-relay/roles/Builder/ROLE.md`
   - `agent-relay/roles/Editor/ROLE.md`
   - `agent-relay/roles/Experience/ROLE.md` when reviewing app experience

## Project Boundary

GateKeeper / Pattern Detector is the target repository. Keep changes native to
the existing repo structure and avoid broad architecture changes unless the user
explicitly approves them. For substantial product work, follow the
`medium-large-modular-web` package boundary described in
`PATTERN_DETECTOR_CODING_PARADIGM.md`.

## Role Responsibilities

- Validator freezes requirements, names affected files, calls out risks, and defines verification.
- Builder implements the smallest correct change inside the approved boundary.
- Editor reviews for bugs, overengineering, unclear UX, persistence or data risks, and drift from the approved scope.
- Experience reviews visual polish, interaction clarity, usability,
  accessibility basics, and domain fit for app surfaces.

## Verification Baseline

Use the repo's existing test, lint, or smoke-check commands when they are present. If the correct command is unknown, Validator must identify it before accepting substantive code changes.
