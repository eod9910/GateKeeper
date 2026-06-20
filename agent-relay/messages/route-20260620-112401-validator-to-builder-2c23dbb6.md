# Validator Directive: Add Improve-Style Planning Standard

## Classification

Governance / planning-instruction change. No product behavior or code-symbol edit is authorized.

## Intent

Adapt the useful doctrine from `shadcn/improve` into this repo's existing planning system.

Do not adopt `improve`'s `plans/001-*.md` layout. This repo's canonical planning format remains paired PRD/checklist files under `.planning/plans/` according to `.planning/plans/PLAN_CONVENTIONS.md`.

## Builder Directive

Update only:

- `agent-relay/roles/Validator/ROLE.md`
- `.planning/plans/PLAN_CONVENTIONS.md`

Add a Validator planning standard that says PRDs/checklists should be self-contained and executable by Builder without relying on prior chat context.

Include these concepts:

- current-state evidence;
- exact files, symbols, routes, data stores, or UI surfaces involved;
- scope and explicit out-of-scope boundaries;
- verification gates and expected commands/output where practical;
- STOP conditions for when Builder must report back instead of improvising;
- drift check before implementation when plans may be stale;
- done criteria that Validator can independently verify;
- preserving this repo's PRD/checklist naming and folder conventions.

## Boundaries

- Do not create new planning folders.
- Do not install or reference `shadcn/improve` as a required tool.
- Do not weaken the Tri-Agent role split.
- Do not authorize Builder to write or approve plans.

## Acceptance Evidence

- Diff is limited to the two target docs plus relay artifacts.
- Router verification passes.
