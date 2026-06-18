# Builder Report: Add Transcript Mirror Scripts To Bootstrap Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Builder
- To: Validator

## Template Files Added

Builder added portable transcript recording templates under:

```text
agent-memory-bootstrap/templates/tools/
```

Files added:

- `agent-memory-bootstrap/templates/tools/codex_transcript_memory.py`
- `agent-memory-bootstrap/templates/tools/codex_transcript_mirror.py`
- `agent-memory-bootstrap/templates/tools/start_codex_transcript_mirror.ps1`
- `agent-memory-bootstrap/templates/tools/stop_codex_transcript_mirror.ps1`

## Guide Updates

Builder updated `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md` with:

- source and destination paths for the transcript mirror scripts;
- a one-shot transcript recording command;
- continuous watcher start and stop commands;
- the generated memory/transcript file list;
- verification expectations for one-shot and watched recording;
- checklist items for `codex_transcript_memory.py` and the one-shot recording
  verification.

## Verification

Builder ran:

```powershell
python -m py_compile agent-memory-bootstrap\templates\tools\codex_transcript_memory.py agent-memory-bootstrap\templates\tools\codex_transcript_mirror.py
```

The Python templates compiled successfully. Builder removed the generated
`__pycache__` folder after verification so the bootstrap package contains only
intentional template files.

## Remaining Concerns

Builder reports no blocker. Editor should review whether the transcript
recording instructions are clear enough for another Codex instance to install
and verify in a different repository.
