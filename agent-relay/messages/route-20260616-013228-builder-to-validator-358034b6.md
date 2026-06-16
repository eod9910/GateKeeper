# Builder Report: Codex Memory Tracking Policy

- Date: 2026-06-16
- Phase: codex-transcript-mirror
- From: Builder
- To: Validator
- Directive: `agent-relay/roles/Validator/directives/2026-06-16-builder-fix-codex-memory-tracking.md`

## Files Changed

- `tools/codex_transcript_mirror.py`
- `memory-bank/CODEX_MEMORY_POLICY.md`
- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/transcripts/codex-session-live.md`
- `AGENTS.md`

## Policy Implemented

The compact Codex continuity files are intentionally trackable in git for catastrophic recovery:

- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/transcripts/codex-session-live.md`

Raw transcript mirrors remain local-only and ignored:

- `offline-codex-transcripts-*/`
- `offline-cursor-transcripts-*/`

The generated Markdown headers now mark the compact memory files as sensitive repo memory and explicitly say they are trackable for catastrophic recovery.

`AGENTS.md` now points future agents to the Codex memory policy and continuity file for continuity-sensitive work.

## Verification

- `python -m py_compile tools/codex_transcript_mirror.py` passed.
- One-shot mirror regenerated 34 Codex sessions.
- Generated memory files contain the new tracking policy headers.

## Remaining Concerns For Editor

- The mirror script is still monolithic.
- Watch mode still reprocesses every matching session each cycle.
- Editor should confirm the policy split is clear enough before Validator accepts the work.

