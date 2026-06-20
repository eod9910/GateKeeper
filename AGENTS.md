## Startup Read Order

When a new agent instance starts work in this repo, read in this order:

1. `TRI_AGENT_CODING_CONTRACT.md` - establishes Validator/Builder/Editor roles, relay expectations, and conversation framing.
2. `AGENTS.md` - routes the agent to the correct repo contracts, policies, and folders for the task.
3. Role documents - read `agent-relay/roles/Validator/ROLE.md`, `agent-relay/roles/Builder/ROLE.md`, and `agent-relay/roles/Editor/ROLE.md` before acting as or routing to those roles.
4. `memory-bank/CODEX_MEMORY_POLICY.md` - explains which memory files are active, trackable, local-only, or read-on-demand.
5. Continuity bridges - read BOTH `memory-bank/CODEX_CONTINUITY.md` and `memory-bank/CURSOR_CONTINUITY.md` so each agent sees recent goals, directives, open questions, and likely next steps from Codex AND Cursor/Claude work.
6. Recent transcript windows - use BOTH agent windows so each agent sees what the other did:
   - Codex: `memory-bank/transcripts/codex-session-live.md`, then `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md` for today and the prior one or two days when present.
   - Cursor/Claude: `memory-bank/transcripts/cursor-session-live.md`, then `memory-bank/transcripts/cursor/YYYY-MM-DD/latest.md` for today and the prior one or two days when present.
7. Task-specific contract - read the relevant file below based on the user request.

Do not preload large historical transcript archives by default. Search or open them only for targeted recall.

## Agent Transcript Mirror Startup

Immediately after reading this file, ensure BOTH transcript mirrors are running.
This is the first action every agent (Codex and Cursor/Claude) takes on boot.
Use the idempotent launchers below; each checks for an existing PID and starts
its watcher only when it is not already running, so launching both on every boot
is safe:

```powershell
.\tools\start_codex_transcript_mirror.ps1
.\tools\start_cursor_transcript_mirror.ps1
```

The Codex mirror keeps `memory-bank/CODEX_CONTINUITY.md`,
`memory-bank/transcripts/codex-session-live.md`, and the dated latest transcript
window under `memory-bank/transcripts/codex/YYYY-MM-DD/` current.

The Cursor/Claude mirror keeps `memory-bank/CURSOR_CONTINUITY.md`,
`memory-bank/transcripts/cursor-session-live.md`, and the dated latest transcript
window under `memory-bank/transcripts/cursor/YYYY-MM-DD/` current.

Running both keeps the two co-located, source-tagged per-agent archives current,
so each agent can read what it did AND what the other agent did.

## Agent Memory Archive Layout

Session memory is split across FILES (plural), not one merged file. There are two
parallel, source-tagged per-agent archives:

- Codex: `memory-bank/CODEX_CONTINUITY.md`,
  `memory-bank/transcripts/codex-session-live.md`,
  `memory-bank/transcripts/codex/YYYY-MM-DD/...`
- Cursor/Claude: `memory-bank/CURSOR_CONTINUITY.md`,
  `memory-bank/transcripts/cursor-session-live.md`,
  `memory-bank/transcripts/cursor/YYYY-MM-DD/...`

Each agent's mirror writes ONLY its own archive (one writer per file). They are
intentionally NOT a single shared file, to avoid concurrent-writer corruption.
Every agent MUST read BOTH archives at startup so Codex sees Cursor/Claude work
and vice versa — see the "read BOTH" steps in "Startup Read Order" above.

These per-agent session-memory mirrors are separate from
`agent-relay/transcripts/all.md`, which is the single merged timeline for
ROLE/governance handoffs (Validator/Builder/Editor) only.

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
- When one running agent is mediating the roles, it must read all three role
  documents before routing or simulating role handoffs.

## Planning Conventions

- Follow `.planning/plans/PLAN_CONVENTIONS.md` whenever creating, moving, renaming, or auditing PRDs, checklists, active plans, or workstreams.
- Every active workstream must have a paired `.planning/plans/ACTIVE/<slug>-prd.md` and `.planning/plans/ACTIVE/<slug>-checklist.md` so the PRD and checklist sort together.
- Do not leave standalone notes, references, or orphan planning docs in `ACTIVE/`; convert them into a PRD/checklist pair or move them to `TODO`, `REFERENCE`, or `ARCHIVE`.
- Keep this planning naming convention visible in `AGENTS.md`; it is startup-critical and prevents PRDs/checklists from scattering.

## Pattern Detector Coding Paradigm

- Pattern Detector is governed as a `medium-large-modular-web` project. Read `PATTERN_DETECTOR_CODING_PARADIGM.md` before substantial feature, refactor, frontend, backend, domain, or architecture work.
- The target architecture is a modular monolith organized by product capability: scanner, charting, strategies, backtests, broker, universe, plugins, and auth/settings.
- New substantial work must name the affected product domain and stay inside the approved domain boundary. Do not add new global dumping grounds, parallel engines, duplicate caches, duplicate workflows, or shared abstractions without Validator approval.
- Migration is incremental. Do not reshuffle the whole repo just to match the target tree; improve touched areas toward the target boundary only when the directive authorizes it.
- Validator enforces the coding paradigm in directives, Builder implements within the named boundary, and Editor treats architecture drift as an anti-spaghetti concern.

## Workspace AI / Agent Creation

- Before creating or changing a workspace AI, read `workspace/WORKSPACE_ARCHITECTURE.md`.
- For the canonical agent-building workflow, read `_skills/build-agent/SKILL.md`, then `_skills/build-agent/BUILD_AGENT_WORKFLOW.md`.
- Keep detailed workspace shape, runtime binding, skill activation, and naming rules in `workspace/WORKSPACE_ARCHITECTURE.md`; `AGENTS.md` only routes agents there.

## Agent Operating Contract

- Before running or creating any backtest, research simulation, parameter sweep, or strategy validation, read `AGENT_OPERATING_CONTRACT.md`.
- For major coding work, core trading/backtest/research/governance changes, or multi-step refactors, read `TRI_AGENT_CODING_CONTRACT.md` and use `ROUTER_ONLY_PROTOCOL.md` / `tools/agent_router.py` when role handoffs need to be recorded.
- Fast path (Tier 0/1 only): for tiny docs/config/copy fixes or a normal localized bug fix, the single running agent may act as Builder+Editor inline (no subagents, no full relay) if it freezes intent first, independently verifies against the actual files/diff and compile/test output, and records one combined relay entry. Escalate to full relay the moment scope exceeds Tier 1 or touches core trading/backtest/research/governance. See `TRI_AGENT_CODING_CONTRACT.md`.
- Backtest routing, approved engines, required artifacts, exploratory research storage, and scratch-work rules live in `AGENT_OPERATING_CONTRACT.md`; do not duplicate those tables here.

## Agent Continuity Memory

- For continuity-sensitive work, read `memory-bank/CODEX_MEMORY_POLICY.md`, then BOTH `memory-bank/CODEX_CONTINUITY.md` and `memory-bank/CURSOR_CONTINUITY.md`.
- For memory archive/cleanup decisions, read `memory-bank/MEMORY_ARCHIVE_POLICY.md`.
- Detailed transcript retention, local-only mirror folders, and sensitive-memory handling rules live in those memory policy files; `AGENTS.md` only routes agents there.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **pattern-detector** (11543 symbols, 32528 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/pattern-detector/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/pattern-detector/context` | Codebase overview, check index freshness |
| `gitnexus://repo/pattern-detector/clusters` | All functional areas |
| `gitnexus://repo/pattern-detector/processes` | All execution flows |
| `gitnexus://repo/pattern-detector/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
