# Builder Report: Router Workflow Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Builder
- To: Validator

## Files Created Or Updated

- Created `agent-memory-bootstrap/ROUTER_WORKFLOW.md`
- Updated `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md`
- Repaired `tools/agent_router.py` line 1 so the live router runs again

## Key Setup Instructions Added

Builder documented:

- files and folders required in a new repo;
- how role source files become routed message copies;
- how `agent-relay/router/routes.jsonl` drives role inboxes, phase transcripts,
  and `agent-relay/transcripts/all.md`;
- exact route commands for Validator directives, Builder reports, Editor
  reviews, and optional Validator rulings;
- `regenerate`, `transcript`, `inbox`, and `verify` commands;
- how to debug missing or incomplete `all.md`;
- the distinction between Agent Relay conversations and Codex transcript memory.

## Verification

Builder verified:

- `python tools\agent_router.py --help` works after repairing line 1;
- `python -m py_compile tools\agent_router.py` passes;
- `agent-memory-bootstrap/ROUTER_WORKFLOW.md` contains `all.md`, `routes.jsonl`,
  `agent-relay/messages/`, `route --phase`, `regenerate`, and `verify`
  instructions;
- the main implementation guide points to `agent-memory-bootstrap/ROUTER_WORKFLOW.md`.

## Remaining Concerns

Builder reports no blocker. Editor should review whether the new guide is clear
enough for a fresh Codex instance to make `all.md` work in another repo.
