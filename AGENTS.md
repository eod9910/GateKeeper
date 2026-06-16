## Startup Read Order

When a new agent instance starts work in this repo, read in this order:

1. `TRI_AGENT_CODING_CONTRACT.md` - establishes Validator/Builder/Editor roles, relay expectations, and conversation framing.
2. `AGENTS.md` - routes the agent to the correct repo contracts, policies, and folders for the task.
3. `memory-bank/CODEX_MEMORY_POLICY.md` - explains which memory files are active, trackable, local-only, or read-on-demand.
4. `memory-bank/CODEX_CONTINUITY.md` - compact current-state bridge for recent goals, directives, open questions, and likely next steps.
5. Recent transcript window - use `memory-bank/transcripts/codex-session-live.md`, then `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md` for today and the prior one or two days when present.
6. Task-specific contract - read the relevant file below based on the user request.

Do not preload large historical transcript archives by default. Search or open them only for targeted recall.

## Planning Conventions

- Follow `.planning/plans/PLAN_CONVENTIONS.md` whenever creating, moving, renaming, or auditing PRDs, checklists, active plans, or workstreams.
- Every active workstream must have a paired `.planning/plans/ACTIVE/<slug>-prd.md` and `.planning/plans/ACTIVE/<slug>-checklist.md` so the PRD and checklist sort together.
- Do not leave standalone notes, references, or orphan planning docs in `ACTIVE/`; convert them into a PRD/checklist pair or move them to `TODO`, `REFERENCE`, or `ARCHIVE`.
- Keep this planning naming convention visible in `AGENTS.md`; it is startup-critical and prevents PRDs/checklists from scattering.

## Workspace AI / Agent Creation

- Before creating or changing a workspace AI, read `workspace/WORKSPACE_ARCHITECTURE.md`.
- For the canonical agent-building workflow, read `_skills/build-agent/SKILL.md`, then `_skills/build-agent/BUILD_AGENT_WORKFLOW.md`.
- Keep detailed workspace shape, runtime binding, skill activation, and naming rules in `workspace/WORKSPACE_ARCHITECTURE.md`; `AGENTS.md` only routes agents there.

## Agent Operating Contract

- Before running or creating any backtest, research simulation, parameter sweep, or strategy validation, read `AGENT_OPERATING_CONTRACT.md`.
- For major coding work, core trading/backtest/research/governance changes, or multi-step refactors, read `TRI_AGENT_CODING_CONTRACT.md` and use `ROUTER_ONLY_PROTOCOL.md` / `tools/agent_router.py` when role handoffs need to be recorded.
- Backtest routing, approved engines, required artifacts, exploratory research storage, and scratch-work rules live in `AGENT_OPERATING_CONTRACT.md`; do not duplicate those tables here.

## Codex Continuity Memory

- For continuity-sensitive work, read `memory-bank/CODEX_MEMORY_POLICY.md` and `memory-bank/CODEX_CONTINUITY.md`.
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
