# Planning Doc Protocol

## Purpose

This protocol governs formal planning documents for GateKeeper / Pattern Detector relay work.

When a task needs a plan, the plan is always two linked documents:

- a PRD that freezes requirements and boundaries
- a checklist that Builder executes against

The PRD and checklist must be named and stored so they remain visibly glued together as one work package.

## Canonical Planning Folder

All formal planning documents live under:

```text
agent-relay/planning-docs/
```

Planning docs are grouped by state:

```text
agent-relay/planning-docs/ongoing/
agent-relay/planning-docs/finished/
```

New or active work packages start under `ongoing/`. Once Validator accepts the
work as complete, move the entire work-package folder under `finished/`.

Each work package gets exactly one folder named with a short, stable slug:

```text
agent-relay/planning-docs/<state>/<work-package-slug>/
```

Use lowercase kebab-case for the slug.

Examples:

```text
agent-relay/planning-docs/ongoing/bootstrap-hygiene-repair/
agent-relay/planning-docs/finished/memory-policy-freeze/
agent-relay/planning-docs/ongoing/api-security-defaults/
```

## Required Paired Files

Inside the work-package folder, the PRD and checklist must repeat the same slug in their filenames:

```text
agent-relay/planning-docs/<state>/<work-package-slug>/<work-package-slug>.prd.md
agent-relay/planning-docs/<state>/<work-package-slug>/<work-package-slug>.checklist.md
```

Example:

```text
agent-relay/planning-docs/ongoing/api-security-defaults/api-security-defaults.prd.md
agent-relay/planning-docs/ongoing/api-security-defaults/api-security-defaults.checklist.md
```

Do not create orphan PRDs or orphan checklists. If one exists, the matching paired file must exist in the same folder before Builder starts work.

## PRD Required Sections

Each PRD must use this shape:

```text
# PRD: <work package title>

## Work Package

- Slug: `<work-package-slug>`
- Phase: `<relay-phase>`
- Owner: `Validator`

## Problem

What problem is being solved.

## Goals

What success means.

## Non-Goals

What is explicitly out of scope.

## Affected Areas

Files, folders, modules, workflows, generated outputs, or memory surfaces expected to change.

## Requirements

Specific requirements Builder must satisfy.

## Risks

Known risks, data/index/memory concerns, security concerns, or dependency concerns.

## Verification

Commands, checks, review evidence, or manual acceptance criteria.
```

## Checklist Required Sections

Each checklist must use this shape:

```text
# Checklist: <work package title>

## Work Package

- Slug: `<work-package-slug>`
- PRD: `<relative path to paired PRD>`
- Phase: `<relay-phase>`
- Executor: `Builder`

## Preconditions

- [ ] Required decisions are frozen.
- [ ] Required PRD exists and matches this checklist slug.

## Tasks

- [ ] Task 1
- [ ] Task 2

## Verification

- [ ] Verification step 1
- [ ] Verification step 2

## Builder Report Requirements

What Builder must report back to Validator.
```

## Routing Rules

- Validator creates or authorizes the paired PRD and checklist before Builder executes planned work.
- Validator directives that rely on a plan must name the planning-doc slug and link both files.
- Builder must execute the checklist according to Builder role rules and the Validator directive.
- Builder reports must reference the planning-doc slug, the PRD path, and the checklist path.
- Editor reviews must verify that Builder followed both the PRD and checklist when the directive references a planning-doc slug.
- Phase relay transcripts, audits, and execution-history files that support a
  work package belong in that same work-package folder, not in
  `agent-relay/transcripts/`.
- On-demand router phase transcripts are written to
  `agent-relay/planning-docs/ongoing/<work-package-slug>/<work-package-slug>.relay-transcript.md`.

## Naming Rules

- The folder name, PRD filename, checklist filename, PRD `Slug`, checklist `Slug`, and relay phase must agree unless Validator explicitly documents why the phase is broader.
- Use one slug per work package.
- Do not reuse a slug for unrelated work.
- Prefer stable names over clever names.
- If a work package is split, create new child work-package folders rather than overloading the original PRD/checklist pair.
- Keep finished work packages under `finished/`; keep active work packages under
  `ongoing/`.

## Stop Conditions

Stop and return to Validator when:

- A PRD exists without its matching checklist.
- A checklist exists without its matching PRD.
- The PRD and checklist use different slugs.
- The checklist asks Builder to do work outside the PRD.
- The Validator directive references a planning-doc slug that does not exist.
