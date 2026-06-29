# Builder Report Protocol

## Purpose

Builder reports tell Validator exactly what was changed, what was not changed, and how it was verified.

## Required Header

```text
# Builder Report: <short title>
```

## Required Sections

```text
## Directive Followed

Reference the Validator directive title and phase.

## Work Completed

Concise list of completed changes.

## Files Changed

List only relevant files or folders changed by Builder.

## Organization Decisions

Required when Builder creates, moves, or removes files or folders. Explain why
the location follows `agent-relay/protocols/REPO_ORGANIZATION_PROTOCOL.md`,
including ownership, lifecycle, consumer, and whether each artifact is source,
test, docs, deployment template, generated state, transcript, or planning
evidence.

## Planning Docs Followed

Required when the Validator directive references a planning-doc work package. Name the slug, PRD path, and checklist path.

## Verification Evidence

Commands run, checks passed, and important observed results.

## Scope Boundaries

What Builder intentionally did not change.

## Risks Or Follow-Ups

Known risks, skipped checks, or items requiring Editor/Validator attention.
```

## Rules

- Do not claim acceptance; only Validator accepts.
- Do not hide failed checks. Report them with the fix or current blocker.
- Do not include unrelated refactors or opportunistic changes.
- If generated files changed, identify whether they are tracked or local-only.
- Do not create root files, top-level folders, or new shared areas unless the
  Validator directive approved the placement or the repo organization protocol
  clearly allows it.
