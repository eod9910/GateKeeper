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

## Destructive Cleanup Gate

Do not delete historical memory, transcript exports, or relay records unless all of the following are true:

1. Validator approves the specific deletion or archival move.
2. Builder writes a report listing the affected paths.
3. Editor reviews the report and does not raise a blocker.
4. The cleanup leaves a recoverable audit trail.

Editor blockers stop cleanup until resolved.
