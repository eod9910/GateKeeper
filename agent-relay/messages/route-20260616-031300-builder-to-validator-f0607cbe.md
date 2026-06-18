# Builder Report: Add Router Copy To Memory Bootstrap Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Builder
- To: Validator

## File Updated

- `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md`

## Guide Section Added

Builder added `## 11. Portable Router Copy`.

The new section includes:

- where to place the router: `tools/agent_router.py`;
- the relay folder structure expected by the router;
- core router commands for `routes`, `route`, `inbox`, `verify`,
  `regenerate`, and `transcript`;
- an explicit warning not to route messages in parallel;
- a drop-in Python router implementation inside the guide.

## Checklist Updates

Builder updated the minimum portable checklist so Tri-Agent repos must add
`tools/agent_router.py` from the guide's portable router copy.

## Verification

Builder checked:

- the guide contains the new `Portable Router Copy` section;
- the guide documents `tools/agent_router.py`;
- the guide includes router commands;
- the guide includes the non-parallel route warning;
- the Python code fence closes before the Common Failure Modes section.

## Remaining Concerns

Builder reports no blocker. Editor should review whether embedding the router
in the guide is clear enough for another Codex instance to implement.
