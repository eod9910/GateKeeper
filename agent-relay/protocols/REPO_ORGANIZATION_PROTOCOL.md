# Repo Organization Protocol

## Purpose

This protocol prevents haphazard file and folder creation.

The standard organizing principle is: place files by ownership, lifecycle, and
consumer, using the repo's existing conventions before creating new structure.

## Ownership

- Validator owns the placement decision for new top-level folders, new root
  files, new services, new packages, and new cross-cutting shared areas.
- Builder owns the actual file and folder writes, but must follow the approved
  placement rule.
- Editor reviews whether the placement creates clutter, duplicate sources of
  truth, hidden architecture, or unclear ownership.

## Root Rule

Root files are exceptional. Add a root file only when one of these is true:

- a standard tool discovers it at root, such as `.gitignore`, `Dockerfile`,
  `docker-compose.yml`, `setup.py`, `requirements.txt`, or `MANIFEST.in`
- a license, README, or agent bootloader must be discoverable from root
- the user or Validator explicitly approves a root-level artifact

Deployment starters, examples, generated outputs, planning evidence, local
state, role docs, transcripts, and one-off reports must not be placed in root.

## Placement Decision Order

Before creating a new file or folder, Builder must decide in this order:

1. Can this change fit inside an existing domain, package, docs area, test area,
   example area, or agent-relay area?
2. Who owns this file after the current task?
3. What consumes this file: humans, package tooling, tests, deployment tooling,
   agents, or generated-state readers?
4. Is the file source, test, documentation, deployment template, generated
   state, planning evidence, or transcript?
5. Does the file need to be committed, ignored, or regenerated?

If the answer is unclear, Builder stops and asks Validator instead of creating a
new folder.

## Canonical Locations

Use these locations unless Validator approves a different boundary:

```text
lightrag/                         source package
lightrag_webui/                   web UI source
tests/                            test source
docs/                             product documentation
examples/                         runnable examples and templates
examples/deployment/              deployment templates
agent-relay/                      agent governance, protocols, roles, planning, transcripts
agent-relay/planning-docs/ongoing/ active work-package planning and evidence
agent-relay/planning-docs/finished/ completed work-package planning and evidence
agent-relay/transcripts/          live/generated transcript surfaces only
```

## New Folder Rules

A new folder must have:

- a clear owner
- a clear lifecycle
- a clear consumer
- a name that matches the repo's existing naming style
- a reason it cannot be an existing folder

For substantial new folders, add a short `README.md` when ownership or lifecycle
would not be obvious to the next agent.

## Builder Report Requirement

When Builder creates, moves, or removes files or folders, the Builder report
must include:

- what changed
- why the chosen location fits the ownership/lifecycle/consumer rule
- whether the file is source, docs, test, template, generated state, transcript,
  or planning evidence
- any docs or references updated because of the move

## Editor Review Requirement

Editor must mark an `EDITOR BLOCKER` when a change:

- adds root clutter without a root-rule reason
- creates a new folder without clear ownership
- splits one concept across unrelated folders
- places generated output beside source files without an ignore/regeneration rule
- puts planning evidence in transcripts or transcript output in planning docs
- duplicates an existing source of truth

## Stop Conditions

Stop and return to Validator when:

- a new top-level folder is proposed
- a new root file is proposed outside standard tool discovery
- a task needs a new shared abstraction or cross-cutting package
- the correct owner or lifecycle is unclear
- moving a file would require broad documentation or packaging changes
