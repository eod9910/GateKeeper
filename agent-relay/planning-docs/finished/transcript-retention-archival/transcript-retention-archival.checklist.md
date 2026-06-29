# Transcript Retention and Archival - Checklist

PRD: transcript-retention-archival-prd.md

Percent complete: 100% (14 complete, 0 partial, 0 remaining) â€” first real `--apply` archival move completed under the Destructive Cleanup Gate with User approval (cursor/2026-03-10 -> cursor/archive/2026-03/).

Tier 2 flow: Validator authored this PRD/checklist -> Builder implements ->
Editor second-pass cleanup -> Validator verifies every item against files/diff and
script output. Archival moves run under the Destructive Cleanup Gate.

---

## Phase 1 - Retention Policy Spec (docs)

- [x] Update `memory-bank/MEMORY_ARCHIVE_POLICY.md` with the 30-day hot window, monthly tracked archive layout (relay + snapshots), and manual-script-under-gate statement.
- [x] Update `memory-bank/CODEX_MEMORY_POLICY.md` retention section for hot window + monthly archive across `codex/` and `cursor/` trees.

## Phase 2 - Relay Timeline Windowing

- [x] Extend `tools/agent_router.py` so the hot `agent-relay/transcripts/all.md` contains only the last 30 days of routes.
- [x] Emit/refresh tracked monthly `agent-relay/transcripts/archive/all-YYYY-MM.md` from `routes.jsonl` for older routes.
- [x] Leave `routes.jsonl` and per-phase transcript files behaviorally unchanged.
- [x] Add a header note in hot `all.md` pointing to the archive folder.
- [x] Verify hot + archive routes union equals `routes.jsonl` (no loss, no duplication).

## Phase 3 - Snapshot Archival Mover

- [x] Create `tools/archive_transcripts.py` that finds `<agent>/YYYY-MM-DD/` folders older than 30 days and moves them to `<agent>/archive/YYYY-MM/YYYY-MM-DD/`.
- [x] Make the script also drive the Phase 2 relay rollover so one command handles both stores.
- [x] Default to `--dry-run`; require an explicit apply flag; never delete (move only); make re-runs idempotent.
- [x] Emit a report listing every affected source and destination path.

## Phase 4 - Validation, Gate, and Docs Close-out

- [x] Run dry-run against current data and capture the affected-path report.
- [x] Execute the Destructive Cleanup Gate for the first real move (Validator approval, Builder report, Editor review, recoverable trail), then verify hot stores are within 30 days and archives are complete/readable.
- [x] Update this `Percent complete:` line to reflect the final state.
