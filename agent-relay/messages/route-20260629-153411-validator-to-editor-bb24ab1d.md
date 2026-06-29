# Validator Directive: GateKeeper Forensic Repo Audit

## Review Scope

Perform an Editor-style forensic audit of GateKeeper after the relay/planning cleanup and GitNexus indexing pass.

## Editor Checks

- Inspect repo shape, root ownership, tracked folder distribution, ignored/generated clutter, stale references, and large/data-heavy areas.
- Use GitNexus evidence now that `GateKeeper` is indexed.
- Identify what is healthy, what is risky, and what should be cleaned next.
- Do not delete files during this audit.

## Blockers

Mark `EDITOR BLOCKER` for unapproved root clutter, duplicate sources of truth, misplaced planning/transcript/generated artifacts, data-loss risk, or cleanup actions that should not proceed without Validator approval.

## Required Output

Write a durable Editor review report under `agent-relay/planning-docs/reference/` and return clear cleanup recommendations to Validator.
