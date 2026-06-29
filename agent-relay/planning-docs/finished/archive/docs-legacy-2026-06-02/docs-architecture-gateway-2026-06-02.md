# Pattern Detector Architecture

Last reviewed: 2026-06-02
Status: Current gateway document

This file is no longer the full live architecture inventory. The detailed, current codebase orientation bundle lives in:

- `agent-relay/planning-docs/reference/codebase/README.md`
- `agent-relay/planning-docs/reference/codebase/ARCHITECTURE.md`
- `agent-relay/planning-docs/reference/codebase/STRUCTURE.md`
- `agent-relay/planning-docs/reference/codebase/STACK.md`
- `agent-relay/planning-docs/reference/codebase/INTEGRATIONS.md`
- `agent-relay/planning-docs/reference/codebase/TESTING.md`
- `agent-relay/planning-docs/reference/codebase/CONVENTIONS.md`
- `agent-relay/planning-docs/reference/codebase/CONCERNS.md`

Use those files when getting caught up on the current repo shape. They were refreshed against the source tree on 2026-06-02 and should be read with the memory bank.

## What Belongs Here

`docs/` is for durable product and methodology documents:

- primitive, composite, and strategy methodology
- validator and strategy-validation policy
- parameter-manifest contracts
- data architecture references
- agent/tooling guidance

`agent-relay/planning-docs/` is for planning artifacts:

- PRDs
- checklists
- active work
- TODO work
- completed work
- archived snapshots
- current codebase orientation references

## Current Product Shape

Pattern Detector is a chart-first trading research platform with Scanner, Trading Desk, Position Book, Validator, Indicator Studio, Auto Labeler, Research Studio, Parameter Sweep, Market Intelligence, Fundamental Backtester, Consumer Cycle, Training, Vision Lab, and Tombstones.

The frontend is a multi-page vanilla JavaScript application in `frontend/public`.

The backend is an Express/TypeScript service in `backend/src`, with route groups under `backend/src/routes` and service logic under `backend/src/services`.

Python helpers and research scripts live primarily under `backend/services` and `backend/scripts`.

Local data stores live primarily under `backend/data`.

## Archived Version

The older March 2026 architecture snapshot was archived here:

- `docs/archive/pattern-detector-architecture-legacy-2026-03-06.md`

Keep that file only as historical context.
