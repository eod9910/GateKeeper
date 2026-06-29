# Validator Directive Protocol

## Purpose

Validator directives freeze scope before Builder or Editor acts.

## Required Header

```text
# Validator Directive: <short title>
```

## Required Sections For Builder Directives

```text
## Scope

What Builder is authorized to change.

## Affected Files Or Areas

Exact files, folders, symbols, generated outputs, or workflows expected to change.

## Organization Boundary

Required when the directive may create, move, or remove files or folders. State
the approved location, owner, lifecycle, consumer, and any root-file or
top-level-folder permission.

## Planning Docs

Required only when the directive uses a PRD/checklist work package. Name the slug and link both files under `agent-relay/planning-docs/`.

## Builder Instructions

Ordered instructions or constraints.

## Out Of Scope

What Builder must not change.

## Verification Gate

Commands, checks, manual evidence, or GitNexus checks required before reporting complete.

## Stop Conditions

When Builder must stop and return to Validator.
```

## Required Sections For Editor Directives

```text
## Review Scope

What Editor must review.

## Editor Checks

Specific risks, files, behavior, formatting, or protocol rules to check.

## Blockers

What should be marked as `EDITOR BLOCKER`.

## Required Output

What Editor must report back to Validator.
```

## Rules

- Directives must be self-contained enough for the target role to act without relying on hidden chat context.
- Validator must name the exact phase used for routing.
- Validator must not authorize broad architecture changes accidentally.
- Validator must approve any new root file, top-level folder, or shared
  cross-cutting area explicitly.
- If GitNexus is available and the directive touches code symbols, require impact/context checks before edits.
