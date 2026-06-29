# Editor Review Protocol

## Purpose

Editor reviews Builder output or repo state for correctness, maintainability, protocol compliance, and scope fit.

## Required Header

```text
# Editor Review: <short title>
```

## Required Sections

```text
## Directive Reviewed

Reference the Validator review directive title and phase.

## Result

State one of:

- No findings.
- Findings, no blocker.
- `EDITOR BLOCKER` found.

## Findings

Ordered by severity. Each finding must include the problem, why it matters, and the correction.

## Verification Reviewed

Commands, files, routes, GitNexus evidence, or manual checks Editor reviewed.

## Planning Docs Reviewed

Required when the Validator directive references a planning-doc work package. Name the slug, PRD path, checklist path, and whether Builder followed both.

## Organization Review

Required when Builder creates, moves, or removes files or folders. State whether
the change follows `agent-relay/protocols/REPO_ORGANIZATION_PROTOCOL.md` and
whether any root clutter, unclear ownership, misplaced generated output, or
duplicate source of truth was introduced.

## Residual Risk

Known risk left after the review.

## Recommendation

What Validator should do next.
```

## Finding Format

Use this shape for each issue:

```text
### EDITOR BLOCKER: <short issue title>

Problem: <what is wrong>

Why it matters: <risk or consequence>

Correction: <specific fix>
```

For non-blockers:

```text
### Finding: <short issue title>

Problem: <what is wrong>

Correction: <specific fix>
```

## Rules

- Do not route an Editor review unless Validator first routed a review directive for the same phase.
- Prefer concrete file/path references over vague advice.
- Mark `EDITOR BLOCKER` only for issues that prevent Validator acceptance.
- Do not rewrite Builder output directly during review unless Validator explicitly authorizes an Editor repair pass.
- Treat unapproved root files, unclear new folders, and misplaced
  planning/transcript/generated artifacts as blocker candidates.
