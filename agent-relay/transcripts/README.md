# Transcripts

This folder is for live/generated transcript surfaces only.

```text
agent-relay-ledger.md                # live all-routes ledger
archive/agent-relay/                 # daily, weekly, monthly route archives
codex-live/                          # user-to-Validator live mirror and archives
cursor-live/                         # Cursor live mirror
```

Planning evidence belongs under `agent-relay/planning-docs/`, not here.

Archive routing is automatic:

- `agent-relay/tools/agent_router.py` routes agent-relay ledgers into daily, weekly, and monthly archives.
- `agent-relay/tools/codex_transcript_mirror.py` routes user-to-Validator transcripts into daily, weekly, and monthly archives.
- `agent-relay/tools/cursor_session_mirror.py` writes the live Cursor mirror to `cursor-live/decoded/cursor-session.md`.

See `agent-relay/protocols/TRANSCRIPT_ARCHIVE_PROTOCOL.md`.
