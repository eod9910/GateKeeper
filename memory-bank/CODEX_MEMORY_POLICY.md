# Codex Memory Policy

This repository intentionally keeps a compact Codex continuity layer in git for catastrophic recovery.

## Trackable Memory

These generated files are intended to be trackable:

- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/transcripts/codex-session-live.md`
- `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md`
- `memory-bank/transcripts/codex/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread-or-session>.md`

They preserve the current thread, recent directives, open questions, and a compact live transcript view so a future agent can recover the conversation trail behind important code and governance decisions.

## Naming Convention

- `memory-bank/transcripts/codex-session-live.md` is the rolling latest Codex continuity transcript.
- `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md` is the live latest snapshot for that date.
- `memory-bank/transcripts/codex/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread-or-session>.md` is a durable checkpoint written only on first capture, after a meaningful transcript-size change, or after a long checkpoint interval.
- `memory-bank/transcripts/codex/YYYY-MM-DD/.snapshot-manifest.json` tracks durable checkpoint cadence.

## Local-Only Memory

These generated folders remain ignored and local:

- `offline-codex-transcripts-*/`
- `offline-cursor-transcripts-*/`

They may contain raw transcript data and should not be committed.

## Handling Rules

- Treat tracked memory files as sensitive repo memory.
- Do not publish tracked memory files outside trusted repo channels.
- Prefer `memory-bank/CODEX_CONTINUITY.md` for startup continuity.
- Use `memory-bank/transcripts/codex-session-live.md` only for targeted recall.
- Use dated snapshots under `memory-bank/transcripts/codex/` when searching historical sessions.
- Do not preload raw transcript mirrors into agent context.
