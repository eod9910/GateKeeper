## Planning Conventions

- Follow `.planning/plans/PLAN_CONVENTIONS.md` whenever creating, moving, renaming, or auditing PRDs, checklists, active plans, or workstreams.
- Every active workstream must have a paired `.planning/plans/ACTIVE/<slug>-prd.md` and `.planning/plans/ACTIVE/<slug>-checklist.md` so the PRD and checklist sort together.
- Do not leave standalone notes, references, or orphan planning docs in `ACTIVE/`; convert them into a PRD/checklist pair or move them to `TODO`, `REFERENCE`, or `ARCHIVE`.

## Workspace AI / Agent Creation

- Workspace AIs live under `workspace/<Name> Workspace/`.
- Before creating or changing a workspace AI, read `workspace/WORKSPACE_ARCHITECTURE.md`.
- For the repo's canonical agent-building workflow, read `_skills/build-agent/SKILL.md`, then `_skills/build-agent/BUILD_AGENT_WORKFLOW.md`.
- Use `workspace/Financial Analyst Workspace/` as the completed template of record unless the workspace architecture docs say otherwise.
- New workspace skills live under `workspace/<Name> Workspace/skills/<skill-id>/SKILL.md`; adding a skill folder alone does not make it active until the runtime binding loads it.

## Agent Operating Contract

- Before running or creating any backtest, research simulation, parameter sweep, or strategy validation, read `AGENT_OPERATING_CONTRACT.md`.
- For major coding work, core trading/backtest/research/governance changes, or multi-step refactors, read `TRI_AGENT_CODING_CONTRACT.md` and use `ROUTER_ONLY_PROTOCOL.md` / `tools/agent_router.py` when role handoffs need to be recorded.
- Do not invent a new backtest engine for ordinary backtest requests. Classify the request and use the existing Validator, Fundamental Backtester, valuation study service, or sweep system described in the contract.
- Every backtest or study must leave recoverable artifacts in the contract's approved storage locations, including the engine/source, configuration, timestamp, output paths, and result summary.
- Exploratory research must use the Research Study Framework in `backend/research_framework/` and store the generated study record under `backend/data/research/studies/<study_id>/`.

## Codex Continuity Memory

- For continuity-sensitive work, read `memory-bank/CODEX_MEMORY_POLICY.md` and `memory-bank/CODEX_CONTINUITY.md`.
- `memory-bank/CODEX_CONTINUITY.md`, `memory-bank/transcripts/codex-session-live.md`, and dated snapshots under `memory-bank/transcripts/codex/` are intentionally trackable compact memory artifacts for catastrophic recovery.
- Raw mirror folders such as `offline-codex-transcripts-*/` and `offline-cursor-transcripts-*/` remain local-only and must not be committed.
- Treat tracked memory files as sensitive repo memory and do not publish them outside trusted repo channels.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **pattern-detector** (11505 symbols, 32483 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
