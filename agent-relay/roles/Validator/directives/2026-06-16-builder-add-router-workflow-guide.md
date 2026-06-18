# Validator Directive: Add Router Workflow Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Validator
- To: Builder
- Work tier: Tier 1 documentation/governance portability

## Mediator Request

The Mediator wants the new repo to know exactly how Pattern Detector generates
`agent-relay/transcripts/all.md` and the per-phase relay transcripts.

## Required Work

Create a dedicated guide under `agent-memory-bootstrap/` that explains:

- all files and folders required for router-based conversations;
- how role source files become routed message copies;
- how `routes.jsonl` drives `INBOX.md`, per-phase transcripts, and `all.md`;
- exact commands for Validator directives, Builder reports, and Editor reviews;
- how to regenerate and verify;
- how to debug missing `all.md` output;
- what files the Mediator should copy into another repo.

Also update `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md` to point to the
new router workflow guide.

## Constraints

- Keep the guide usable by a fresh Codex instance in a different repository.
- Do not assume the target repo already has working relay folders.
- Mention that route commands must be run one at a time.

## Required Builder Report

Report:

- files created or updated;
- key setup instructions added;
- verification performed;
- remaining concerns.
