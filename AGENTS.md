## Startup Read Order

When a new agent instance starts work in this repo, read in this order:

1. `AGENTS.md` - this root bootloader.
2. `agent-relay/TRI_AGENT_CODING_CONTRACT.md` - Validator/Builder/Editor roles, relay expectations, and conversation framing.
3. Role documents - read `agent-relay/roles/Validator/ROLE.md`, `agent-relay/roles/Builder/ROLE.md`, `agent-relay/roles/Editor/ROLE.md`, and `agent-relay/roles/Experience/ROLE.md` before acting as or routing to those roles.
4. Relay protocols - read the relevant file under `agent-relay/protocols/` before routing messages, creating formal plans, or executing role handoffs.
5. Recent transcript windows - use BOTH agent windows:
   - Codex: `agent-relay/transcripts/codex-live/user-to-validator.md`, then `agent-relay/transcripts/codex-live/codex-session-live.md`.
   - Cursor/Claude: `agent-relay/transcripts/cursor-live/decoded/cursor-session.md` when present.
6. Agent relay ledger - use `agent-relay/transcripts/agent-relay-ledger.md` for routed role/governance handoffs.
7. Task-specific contract - read the relevant file below based on the user request.

Do not preload large historical transcript archives by default. Search or open them only for targeted recall.

## Agent Transcript Mirror Startup

Immediately after reading this file, ensure BOTH transcript mirrors are running.
This is the first action every agent (Codex and Cursor/Claude) takes on boot.
Use the idempotent launchers below; each checks for an existing PID and starts
its watcher only when it is not already running, so launching both on every boot
is safe:

```powershell
.\agent-relay\tools\start_codex_transcript_mirror.ps1
.\agent-relay\tools\start_cursor_transcript_mirror.ps1
```

The Codex mirror keeps `agent-relay/transcripts/codex-live/user-to-validator.md`,
`agent-relay/transcripts/codex-live/codex-continuity.md`,
`agent-relay/transcripts/codex-live/codex-session-live.md`, and calendar
archives under `agent-relay/transcripts/codex-live/archive/user-to-validator/`
current.

The Cursor/Claude mirror keeps
`agent-relay/transcripts/cursor-live/decoded/cursor-session.md` current when a
matching Cursor workspace session exists.

Generated live transcript folders are local-only and ignored by git. Commit
bootstrap templates, role docs, protocols, and the relay ledger; do not commit
raw live mirror output unless the user explicitly approves it.

## Agent Memory Archive Layout

Session memory is split across files, not one merged file.

- Codex live: `agent-relay/transcripts/codex-live/user-to-validator.md`,
  `agent-relay/transcripts/codex-live/codex-continuity.md`,
  `agent-relay/transcripts/codex-live/codex-session-live.md`, and calendar
  archives under `agent-relay/transcripts/codex-live/archive/user-to-validator/`.
- Cursor/Claude live: `agent-relay/transcripts/cursor-live/decoded/cursor-session.md`.
- Role/governance handoffs:
  `agent-relay/transcripts/agent-relay-ledger.md` plus calendar archives under
  `agent-relay/transcripts/archive/agent-relay/`.

Each agent mirror writes only its own archive. Every agent reads both live
windows at startup so Codex sees Cursor/Claude work and vice versa.

Legacy `memory-bank/` files are historical/read-on-demand unless a current
contract explicitly routes you there.

## Role Bootloader

`AGENTS.md` instantiates the role workflow by routing each agent to the role
documents it must obey:

- Validator reads `agent-relay/roles/Validator/ROLE.md` before freezing
  requirements, writing directives, judging Builder/Editor reports, or accepting
  work.
- Builder reads `agent-relay/roles/Builder/ROLE.md` before implementing any
  Validator directive.
- Editor reads `agent-relay/roles/Editor/ROLE.md` before reviewing,
  simplifying, refactoring, or marking an `EDITOR BLOCKER`.
- Experience reads `agent-relay/roles/Experience/ROLE.md` before reviewing app
  surface quality or creating look-and-feel briefs.
- When one running agent is mediating roles, it must read all relevant role
  documents before routing or simulating role handoffs.

## Planning Conventions

- Follow `agent-relay/protocols/PLANNING_DOC_PROTOCOL.md` whenever creating,
  moving, renaming, or auditing PRDs, checklists, active plans, or workstreams.
- Formal relay work packages live under
  `agent-relay/planning-docs/ongoing/<work-package-slug>/`.
- Every active relay workstream must have a paired
  `<work-package-slug>.prd.md` and `<work-package-slug>.checklist.md` in the
  same work-package folder.
- Do not leave standalone notes, references, or orphan planning docs in
  `ongoing/`; convert them into a PRD/checklist pair or move them to
  `finished/` or a protocol/reference location.

## Pattern Detector Coding Paradigm

- Pattern Detector is governed as a `medium-large-modular-web` project. Read
  `PATTERN_DETECTOR_CODING_PARADIGM.md` before substantial feature, refactor,
  frontend, backend, domain, or architecture work.
- The target architecture is a modular monolith organized by product capability:
  scanner, charting, strategies, backtests, broker, universe, plugins, and
  auth/settings.
- New substantial work must name the affected product domain and stay inside the
  approved domain boundary. Do not add new global dumping grounds, parallel
  engines, duplicate caches, duplicate workflows, or shared abstractions without
  Validator approval.
- Migration is incremental. Do not reshuffle the whole repo just to match the
  target tree; improve touched areas toward the target boundary only when the
  directive authorizes it.

## Workspace AI / Agent Creation

- Before creating or changing a workspace AI, read `workspace/WORKSPACE_ARCHITECTURE.md`.
- For the canonical agent-building workflow, read `_skills/build-agent/SKILL.md`,
  then `_skills/build-agent/BUILD_AGENT_WORKFLOW.md`.
- Keep detailed workspace shape, runtime binding, skill activation, and naming
  rules in `workspace/WORKSPACE_ARCHITECTURE.md`; `AGENTS.md` only routes agents
  there.

## Agent Operating Contract

- Before running or creating any backtest, research simulation, parameter sweep,
  or strategy validation, read `AGENT_OPERATING_CONTRACT.md`.
- For major coding work, core trading/backtest/research/governance changes, or
  multi-step refactors, read `agent-relay/TRI_AGENT_CODING_CONTRACT.md` and use
  `agent-relay/tools/agent_router.py` when role handoffs need to be recorded.
- Fast path (Tier 0/1 only): for tiny docs/config/copy fixes or a normal
  localized bug fix, the single running agent may act as Builder+Editor inline
  if it freezes intent first, independently verifies against actual files/diff
  and compile/test output, and records one combined relay entry. Escalate to
  full relay the moment scope exceeds Tier 1 or touches core
  trading/backtest/research/governance.
- Backtest routing, approved engines, required artifacts, exploratory research
  storage, and scratch-work rules live in `AGENT_OPERATING_CONTRACT.md`; do not
  duplicate those tables here.

## Agent Continuity Memory

- For continuity-sensitive work, read
  `agent-relay/transcripts/codex-live/codex-continuity.md` and
  `agent-relay/transcripts/codex-live/user-to-validator.md`.
- For memory archive/cleanup decisions, read
  `agent-relay/protocols/TRANSCRIPT_ARCHIVE_PROTOCOL.md`.

<!-- gitnexus:start -->
# GitNexus - Code Intelligence

This project is indexed by GitNexus as **pattern-detector**. Use GitNexus MCP
tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run
> `powershell -ExecutionPolicy Bypass -File .\agent-relay\tools\run_gitnexus_analyze.ps1`
> in terminal first. This protects bootstrap-owned `AGENTS.md` and `CLAUDE.md`
> from GitNexus context-file rewrites.

## Always Do

- MUST run impact analysis before editing any symbol. Before modifying a
  function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})`
  and report the blast radius to the user.
- MUST run `gitnexus_detect_changes()` before committing to verify your changes
  only affect expected symbols and execution flows.
- MUST warn the user if impact analysis returns HIGH or CRITICAL risk before
  proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to
  find execution flows instead of grepping.
- When you need full context on a specific symbol, use
  `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` - find execution flows related to the issue.
2. `gitnexus_context({name: "<suspect function>"})` - see callers, callees, and process participation.
3. Read `gitnexus://repo/pattern-detector/process/{processName}` - trace the full execution flow.
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})`.

## When Refactoring

- Renaming: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first.
- Extracting/splitting: MUST run `gitnexus_context({name: "target"})`, then
  `gitnexus_impact({target: "target", direction: "upstream"})`.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact`.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace.
- NEVER commit changes without running `gitnexus_detect_changes()`.

## Keeping The Index Fresh

After committing code changes, update the index:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent-relay\tools\run_gitnexus_analyze.ps1
```

If the index previously included embeddings, preserve them with:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent-relay\tools\run_gitnexus_analyze.ps1 --embeddings
```

<!-- gitnexus:end -->
