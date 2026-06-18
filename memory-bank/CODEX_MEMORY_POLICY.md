# Codex Memory Policy

This repository intentionally keeps a compact agent continuity layer in git for catastrophic recovery. It covers BOTH agents: Codex and Cursor/Claude. Both mirrors write into the same tracked layout under `memory-bank/transcripts/`, source-tagged by the `codex/` and `cursor/` subfolders, so each agent can recover its own trail and the other agent's trail.

## Trackable Memory

These generated files are intended to be trackable:

- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/CURSOR_CONTINUITY.md`
- `memory-bank/transcripts/codex-session-live.md`
- `memory-bank/transcripts/cursor-session-live.md`
- `memory-bank/transcripts/codex/YYYY-MM-DD/latest.md`
- `memory-bank/transcripts/codex/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread-or-session>.md`
- `memory-bank/transcripts/cursor/YYYY-MM-DD/latest.md`
- `memory-bank/transcripts/cursor/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread-or-session>.md`

They preserve the current thread, recent directives, open questions, and a compact live transcript view so a future agent can recover the conversation trail behind important code and governance decisions.

## Naming Convention

- `memory-bank/transcripts/codex-session-live.md` / `memory-bank/transcripts/cursor-session-live.md` are the rolling latest continuity transcripts for each agent.
- `memory-bank/transcripts/<agent>/YYYY-MM-DD/latest.md` is the live latest snapshot for that date (`<agent>` is `codex` or `cursor`).
- `memory-bank/transcripts/<agent>/YYYY-MM-DD/YYYY-MM-DD-HHMMSS-<thread-or-session>.md` is a durable checkpoint written only on first capture, after a meaningful transcript-size change, or after a long checkpoint interval.
- `memory-bank/transcripts/<agent>/YYYY-MM-DD/.snapshot-manifest.json` tracks durable checkpoint cadence.
- The Codex and Cursor mirrors use identical layout, naming, and snapshot cadence; the only difference is the source-tagged `codex/` vs `cursor/` subfolder.

## Local-Only Memory

These generated folders remain ignored and local:

- `offline-codex-transcripts-*/`
- `offline-cursor-transcripts-*/`

They may contain raw transcript data and should not be committed.

## Handling Rules

- Treat tracked memory files as sensitive repo memory (both `codex/` and `cursor/` trees).
- Do not publish tracked memory files outside trusted repo channels.
- Prefer `memory-bank/CODEX_CONTINUITY.md` and `memory-bank/CURSOR_CONTINUITY.md` for startup continuity.
- Use `memory-bank/transcripts/codex-session-live.md` and `memory-bank/transcripts/cursor-session-live.md` only for targeted recall.
- Use dated snapshots under `memory-bank/transcripts/codex/` and `memory-bank/transcripts/cursor/` when searching historical sessions.
- Do not preload raw transcript mirrors into agent context.
- Follow `memory-bank/MEMORY_ARCHIVE_POLICY.md` before moving or deleting generated memory.
