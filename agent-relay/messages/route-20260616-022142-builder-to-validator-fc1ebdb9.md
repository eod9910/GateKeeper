# Builder Report: Memory-Bank Audit

Date: 2026-06-16
Phase: memory-bank-audit
Source: Builder
Target: Validator

## Scope

Builder inventoried `memory-bank/` to determine what still belongs in active memory, what should become historical archive material, and what needs cleanup policy before any move or deletion.

Builder did not move, delete, or rewrite memory files during this audit.

## Inventory Summary

### Active Startup / Continuity Memory

- `memory-bank/CODEX_CONTINUITY.md`
  - Active Codex continuity file.
  - Small enough to serve as compact startup memory.
  - Should remain active.

- `memory-bank/CODEX_MEMORY_POLICY.md`
  - Active policy file for Codex memory behavior.
  - Should remain active and should be the canonical policy location for Codex memory rules.

- `memory-bank/PHASE.md`
  - Small phase marker currently containing `REFINE`.
  - Should remain until its runtime use is confirmed.

- `memory-bank/CURSOR_CONTINUITY.md`
  - Cursor-specific continuity file.
  - Should remain if Cursor is still part of the workflow, but should not be treated as Codex startup memory unless explicitly referenced by Codex-facing instructions.

### Legacy Catch-All Memory

- `memory-bank/CHAT_MEMORY.md`
- `memory-bank/LATEST.md`

Builder classifies these as legacy catch-all memory files. They contain useful historical material, but they are too large and too mixed to serve as stable startup memory now that the repo has:

- `AGENTS.md`
- `AGENT_OPERATING_CONTRACT.md`
- `TRI_AGENT_CODING_CONTRACT.md`
- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/CODEX_MEMORY_POLICY.md`
- `agent-relay/`

Builder recommends treating these as read-on-demand historical archive files until a later extraction pass identifies rules that still belong in canonical contracts.

### Reference / Historical Project Memory

- `memory-bank/BASE_METHOD_TOMBSTONES.md`
- `memory-bank/GSD_REFERENCE.md`
- `memory-bank/PLATFORM_SDK_GUIDE.md`
- `memory-bank/PRIMITIVE_AUDIT_REPORT.md`
- `memory-bank/RSI-SUB-PANEL-TEST-REPORT.md`
- `memory-bank/PRDs/`

Builder classifies these as reference/history files, not active agent startup memory.

Some of these may eventually belong under `.planning/plans/REFERENCE/` or `.planning/plans/ARCHIVE/`, but Builder recommends not moving them during this audit because the planning tree already has substantial unrelated changes.

### Transcript Archive

Builder found historical transcript material under `memory-bank/transcripts/`, including:

- old ChatGPT/Cursor/Codex conversation exports
- strategy and validator transcripts
- `memory-bank/transcripts/cursor-session-live.md`
- `memory-bank/transcripts/codex-session-live.md`
- `memory-bank/transcripts/codex/YYYY-MM-DD/`

Builder classifies `memory-bank/transcripts/codex-session-live.md` as the active rolling Codex mirror.

Builder classifies older transcript exports as historical archive material. They are useful for recall and forensic reconstruction, but they should not be startup-loaded wholesale.

## Issue Found

Builder found that the dated Codex snapshot system is currently too noisy.

The directory `memory-bank/transcripts/codex/2026-06-15/` contains many near-duplicate files, roughly one every mirror interval, each about 541 KB to 560 KB, plus `latest.md`.

This creates unnecessary repository churn and storage growth. The likely intended design is:

- one rolling live transcript
- one daily latest pointer
- occasional durable checkpoints

The current behavior appears to create a new durable checkpoint every mirror pass.

## Builder Recommendation

Builder recommends the next cleanup phase proceed in this order:

1. Fix Codex transcript snapshot cadence before moving or deleting historical memory.
2. Keep `memory-bank/CODEX_CONTINUITY.md` and `memory-bank/CODEX_MEMORY_POLICY.md` as active Codex memory.
3. Keep transcript mirrors as forensic recall, but prevent repeated near-duplicate snapshots.
4. Reclassify `CHAT_MEMORY.md` and `LATEST.md` as legacy archive/read-on-demand memory unless a later extraction pass finds current rules that belong in canonical contracts.
5. Do not delete old transcripts or catch-all memory files until Validator approves an archive policy and Editor reviews it.

## Builder Completion State

Builder completed the inventory and found no need for immediate destructive cleanup.

Builder reports one cleanup blocker before broader memory-bank reorganization: the Codex mirror snapshot cadence should be corrected first.
