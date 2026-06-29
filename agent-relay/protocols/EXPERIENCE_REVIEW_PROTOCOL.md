# Experience Review Protocol

## Purpose

Experience reviews app aesthetics, usability, interaction quality, and product
fit. This is separate from Editor's code-quality review.

When an Experience brief exists, the review checks the built surface against
that brief.

## Required Header

```text
# Experience Review: <short title>
```

## Required Sections

```text
## Directive Reviewed

Reference the Validator review directive title and phase.

## Surface Reviewed

Name the page, component, workflow, screenshot, viewport, or app state reviewed.

## Experience Brief Reviewed

Required when a brief exists. Name the brief path and whether Builder followed
it.

## Result

State one of:

- No findings.
- Findings, no blocker.
- `EXPERIENCE BLOCKER` found.

## Experience Findings

Ordered by severity. Each finding must include the problem, why it matters to
the user, and the correction.

## Visual And Interaction Checks

State what was checked: layout, hierarchy, spacing, contrast, typography,
responsive behavior, controls, empty/loading/error states, keyboard/focus
behavior, and workflow clarity.

## Evidence

Commands, screenshots, local URLs, files, or manual inspection evidence used.

## Residual Risk

Known UX or visual risk left after the review.

## Recommendation

What Validator should do next.
```

## Finding Format

Use this shape for blockers:

```text
### EXPERIENCE BLOCKER: <short issue title>

Problem: <what is visually or experientially wrong>

Why it matters: <user-facing consequence>

Correction: <specific fix>
```

For non-blockers:

```text
### Finding: <short issue title>

Problem: <what is visually or experientially weak>

Correction: <specific fix>
```

## Rules

- Do not route an Experience review unless Validator first routed an Experience
  review directive for the same phase.
- Prefer concrete UI evidence and brief acceptance criteria over abstract taste.
- Mark `EXPERIENCE BLOCKER` only when the app surface is visibly broken,
  incoherent, inaccessible, or unfit for the approved workflow.
- Do not request decorative redesign when the product surface should be quiet,
  dense, and operational.
- Do not implement changes during review unless Validator explicitly authorizes
  an Experience repair pass.
