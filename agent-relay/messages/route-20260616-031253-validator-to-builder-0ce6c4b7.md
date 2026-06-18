# Validator Directive: Add Router Copy To Memory Bootstrap Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Validator
- To: Builder
- Work tier: Tier 1 documentation/governance portability

## Mediator Request

The Mediator noted that the bootstrap guide must include the router itself, not
only mention that a router is needed.

## Required Work

Update `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md` so it contains a
portable copy of the Agent Relay router that another Codex instance can place at
`tools/agent_router.py`.

The guide must also explain:

- where to put the router file;
- what relay folders it expects;
- the core commands to route, verify, regenerate, and create transcripts;
- that route commands should not be run in parallel.

## Constraints

- Keep the router copy inside the guide file.
- Do not modify the live `tools/agent_router.py` implementation for this task.
- Keep the guide portable for repos that do not use Pattern Detector's exact
  folder layout.

## Required Builder Report

Report:

- guide section added;
- commands documented;
- checklist updates;
- verification performed.
