# Validator Directive: Make Codex Mirror Incremental

- Date: 2026-06-16
- Phase: codex-transcript-mirror-cleanup
- From: Validator
- To: Builder
- Work tier: Tier 2 governance/continuity infrastructure

## Trigger

Editor identified that watch mode reprocesses every matching Codex session each interval. The Mediator directed that Editor problems should be fixed as they come so the code stays clean.

## Required Work

Improve `tools/codex_transcript_mirror.py` so watch mode avoids reparsing and rewriting unchanged session files.

Keep behavior equivalent:

- raw mirror output remains local-only under `offline-codex-transcripts-live/`;
- compact memory artifacts remain trackable under `memory-bank/`;
- current continuity views still update when the active Codex session changes;
- generated output still includes session summaries and latest-session Markdown.

## Constraints

- Do not change app behavior.
- Do not weaken the memory tracking policy.
- Keep the implementation readable enough for Editor review.
- Record verification in a Builder report.

