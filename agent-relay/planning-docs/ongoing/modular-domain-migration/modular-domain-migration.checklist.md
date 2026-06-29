# Modular Domain Migration Checklist

PRD: modular-domain-migration-prd.md

Percent complete: 100% (18 complete, 0 partial, 0 remaining)

## Phase 1: Governed Start

- [x] Confirm this workstream is active and paired with its PRD.
- [x] Confirm `PATTERN_DETECTOR_CODING_PARADIGM.md` is startup-visible from `AGENTS.md`.
- [x] Confirm Validator, Builder, and Editor role files contain paradigm enforcement.
- [x] Route the first implementation directive through Agent Relay.

## Phase 2: Universe/Scanner Current-Flow Audit

- [x] Audit `backend/src/routes/universe.ts`.
- [x] Audit `backend/src/services/universeRegistry.ts`.
- [x] Audit related legacy Python universe services/scripts.
- [x] Audit `frontend/public/scanner.js` universe/status/build/update behavior.
- [x] Audit `frontend/public/chart.js` and `frontend/public/shared-chart-utils.js` only where they interact with scanner/universe behavior.
- [x] Identify route contracts, data files, UI controls, polling behavior, and manual validation needs.
- [x] Record STOP conditions if the current flow differs from PRD evidence.

## Phase 3: First Vertical Slice

- [x] Select the smallest behavior-preserving universe/scanner migration slice.
- [x] Run required GitNexus impact analysis before editing any function, class, or method.
- [x] Create or adapt the target domain boundary only for the selected slice.
- [x] Preserve current API routes and frontend behavior.
- [x] Update focused tests or syntax checks for touched files.
- [x] Report before/after shape and remaining old-shape follow-up.

## Phase 4: Review And Acceptance

- [x] Builder reports changed files, verification, assumptions, and residual risk.
- [x] Editor reviews for architecture drift and marks any `EDITOR BLOCKER`.
- [x] Validator independently verifies evidence against files, diff, and commands.
