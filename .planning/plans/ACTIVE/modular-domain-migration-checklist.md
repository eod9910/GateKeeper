# Modular Domain Migration Checklist

PRD: modular-domain-migration-prd.md

Percent complete: 17% (3 complete, 0 partial, 15 remaining)

## Phase 1: Governed Start

- [x] Confirm this workstream is active and paired with its PRD.
- [x] Confirm `PATTERN_DETECTOR_CODING_PARADIGM.md` is startup-visible from `AGENTS.md`.
- [x] Confirm Validator, Builder, and Editor role files contain paradigm enforcement.
- [ ] Route the first implementation directive through Agent Relay.

## Phase 2: Universe/Scanner Current-Flow Audit

- [ ] Audit `backend/src/routes/universe.ts`.
- [ ] Audit `backend/src/services/universeRegistry.ts`.
- [ ] Audit related legacy Python universe services/scripts.
- [ ] Audit `frontend/public/scanner.js` universe/status/build/update behavior.
- [ ] Audit `frontend/public/chart.js` and `frontend/public/shared-chart-utils.js` only where they interact with scanner/universe behavior.
- [ ] Identify route contracts, data files, UI controls, polling behavior, and manual validation needs.
- [ ] Record STOP conditions if the current flow differs from PRD evidence.

## Phase 3: First Vertical Slice

- [ ] Select the smallest behavior-preserving universe/scanner migration slice.
- [ ] Run required GitNexus impact analysis before editing any function, class, or method.
- [ ] Create or adapt the target domain boundary only for the selected slice.
- [ ] Preserve current API routes and frontend behavior.
- [ ] Update focused tests or syntax checks for touched files.
- [ ] Report before/after shape and remaining old-shape follow-up.

## Phase 4: Review And Acceptance

- [ ] Builder reports changed files, verification, assumptions, and residual risk.
- [ ] Editor reviews for architecture drift and marks any `EDITOR BLOCKER`.
- [ ] Validator independently verifies evidence against files, diff, and commands.
