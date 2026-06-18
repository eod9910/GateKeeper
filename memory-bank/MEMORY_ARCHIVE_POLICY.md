# Memory Archive Policy

This repository keeps memory in layers. Do not collapse those layers into one catch-all file.

## Active Startup Memory

Active startup memory is compact and intended for quick recovery by future agents.

- `AGENTS.md`
- `AGENT_OPERATING_CONTRACT.md`
- `TRI_AGENT_CODING_CONTRACT.md`
- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/CODEX_MEMORY_POLICY.md`

These files may be read during startup or when a task touches the covered workflow.

## Canonical Governance

Governance rules belong in contracts, not transcript files.

- Backtest and research rules belong in `AGENT_OPERATING_CONTRACT.md`.
- Tri-agent role behavior belongs in `TRI_AGENT_CODING_CONTRACT.md`.
- Codex memory behavior belongs in `memory-bank/CODEX_MEMORY_POLICY.md`.
- Repo startup routing belongs in `AGENTS.md` and bridge files such as `CLAUDE.md`.

If a legacy memory file contains a still-valid rule, extract the rule into the proper contract instead of making the legacy file active startup memory.

## Role Relay Records

Role directives, reports, inbox entries, and meta-conversation transcripts belong under `agent-relay/`.

The relay is the audit trail for Validator, Builder, Editor, Router, and User role handoffs. Do not move relay records into `memory-bank/`.

## Historical Memory

Historical memory is read-on-demand. It should not be preloaded wholesale.

Examples:

- `memory-bank/CHAT_MEMORY.md`
- `memory-bank/LATEST.md`
- old transcript exports under `memory-bank/transcripts/`
- legacy reports and reference documents under `memory-bank/`

Historical files may be searched for recall, but they are not canonical policy unless a current contract explicitly says so.

## Codex Transcript Retention

The Codex mirror keeps:

- one rolling transcript: `memory-bank/transcripts/codex-session-live.md`
- one daily latest pointer: `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md`
- durable dated checkpoints gated by `memory-bank/transcripts/codex/YYYY-MM-DD/.snapshot-manifest.json`

Duplicate interval snapshots created before the cadence fix may be moved to an ignored local archive under:

- `offline-codex-transcripts-live/archive/duplicate-dated-snapshots/YYYY-MM-DD/`

This is an archive move, not deletion. The primary tracked memory-bank should keep only meaningful checkpoints, the manifest, and `latest.md`.

## Transcript Retention and Archival (30-Day Hot Window)

Two transcript stores grow without bound and are subject to a 30-day hot window
with a tracked, monthly cold archive. Archives are full text (no summarization,
no lossy compression) and stay versioned in git under `archive/` subfolders. The
offline `offline-*-transcripts-*` mirrors are NOT used for this archive.

### Retention window

Anything older than 30 days is eligible for archival. Recent history (the hot
window) stays in the live files so agents and humans can read it quickly.

- Relay timeline windowing is computed relative to the most recent route
  timestamp in `routes.jsonl` (not wall-clock), so regeneration is deterministic
  and testable.
- Snapshot day-folder archival is computed relative to today's date.

### Relay timeline layout

- Hot: `agent-relay/transcripts/all.md` holds only routes from the last 30 days.
- Cold: `agent-relay/transcripts/archive/all-YYYY-MM.md` holds older routes,
  grouped by the route timestamp's year-month, one file per month.
- The hot `all.md` plus the monthly archive files together reconstruct EXACTLY
  the full route set with no loss and no duplication.
- These are DERIVED views regenerated from `agent-relay/router/routes.jsonl`,
  which is the immutable source of truth. Never trim, rewrite, or reorder the
  log; regenerating the views is always safe and rebuilds them deterministically.
- Regeneration runs through `tools/agent_router.py` (`regenerate`, or implicitly
  on `route`); the per-phase transcript files and `routes.jsonl` are unchanged.

### Dated snapshot layout

- Hot: `memory-bank/transcripts/<agent>/YYYY-MM-DD/` (agent in `codex`, `cursor`)
  for day-folders within the last 30 days.
- Cold: `memory-bank/transcripts/<agent>/archive/YYYY-MM/YYYY-MM-DD/` for
  day-folders older than 30 days, grouped by month.
- The size-capped `*-session-live.md` transcripts are NOT touched by archival.

### Manual rollover under the gate

The rollover is manual and on-demand. It is NOT run automatically at mirror or
router startup.

- `tools/archive_transcripts.py` performs both rollovers (relay windowing plus
  the snapshot day-folder moves). It defaults to `--dry-run`; pass `--apply` to
  make changes. It MOVES day-folders (never deletes), is idempotent, and is safe
  to re-run on Windows/OneDrive paths.
- Any real archival move (the `--apply` run) is a Destructive-ish path change and
  MUST run under the Destructive Cleanup Gate below: Validator approval, a Builder
  report of affected paths, Editor review with no blocker, and a recoverable audit
  trail.

## Destructive Cleanup Gate

Do not delete historical memory, transcript exports, or relay records unless all of the following are true:

1. Validator approves the specific deletion or archival move.
2. Builder writes a report listing the affected paths.
3. Editor reviews the report and does not raise a blocker.
4. The cleanup leaves a recoverable audit trail.

Editor blockers stop cleanup until resolved.
