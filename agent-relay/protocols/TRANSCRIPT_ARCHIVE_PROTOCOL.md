# Transcript Archive Protocol

## Purpose

Transcript archive routing is automatic. Agents should not hand-sort transcript
files by day, week, or month.

This protocol assigns ownership for each transcript stream and defines the
canonical archive paths.

## Transcript Owners

- `agent-relay/tools/agent_router.py` owns routed role-message transcripts.
- `agent-relay/tools/codex_transcript_mirror.py` owns the user-to-Validator Codex transcript.
- `agent-relay/tools/cursor_session_mirror.py` owns the live Cursor transcript mirror.

## Agent Relay Route Archives

The live all-routes ledger remains:

```text
agent-relay/transcripts/agent-relay-ledger.md
```

On every route or router regeneration, `agent_router.py` must regenerate:

```text
agent-relay/transcripts/archive/agent-relay/daily/YYYY/YYYY-MM/YYYY-MM-DD.md
agent-relay/transcripts/archive/agent-relay/weekly/YYYY/YYYY-Www.md
agent-relay/transcripts/archive/agent-relay/monthly/YYYY/YYYY-MM.md
```

Routes are bucketed by the routed message timestamp.

## User-To-Validator Archives

The live readable user-to-Validator transcript remains:

```text
agent-relay/transcripts/codex-live/user-to-validator.md
```

On every Codex mirror refresh, `codex_transcript_mirror.py` must regenerate:

```text
agent-relay/transcripts/codex-live/archive/user-to-validator/daily/YYYY/YYYY-MM/YYYY-MM-DD.md
agent-relay/transcripts/codex-live/archive/user-to-validator/weekly/YYYY/YYYY-Www.md
agent-relay/transcripts/codex-live/archive/user-to-validator/monthly/YYYY/YYYY-MM.md
```

Sessions are bucketed by Codex session timestamp, falling back to source file
modified time when needed.

## Cursor Live Transcript

The Cursor mirror is a live continuity surface:

```text
agent-relay/transcripts/cursor-live/decoded/cursor-session.md
```

Do not manually archive Cursor output unless Validator adds a dedicated archive
rule. Cursor transcript history remains in Cursor's source transcript store and
the mirror's live output.

## Planning Evidence Boundary

Work-package audits, phase transcripts, PRDs, checklists, and execution evidence
belong under:

```text
agent-relay/planning-docs/ongoing/<work-package-slug>/
agent-relay/planning-docs/finished/<work-package-slug>/
```

Do not place planning evidence in `agent-relay/transcripts/`.

## Manual Repair Rule

If an archive is missing or stale, do not hand-edit archive files. Run the owner:

```powershell
python agent-relay\tools\agent_router.py regenerate
python agent-relay\tools\codex_transcript_mirror.py --workspace . --output agent-relay\transcripts\codex-live
```

Then verify:

```powershell
python agent-relay\tools\agent_router.py verify
```
