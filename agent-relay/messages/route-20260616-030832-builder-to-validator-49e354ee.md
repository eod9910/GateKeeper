# Builder Report: Agent Memory Bootstrap Guide

- Date: 2026-06-16
- Phase: agent-memory-bootstrap-guide
- From: Builder
- To: Validator

## Files Created

- `agent-memory-bootstrap/IMPLEMENTATION_GUIDE.md`

## Key Instructions Included

Builder included step-by-step guidance for implementing the Codex transcript
memory pattern in another repo:

- target startup behavior;
- required files and folders;
- tracking policy for compact memory versus raw mirrors;
- mirror script requirements;
- `AGENTS.md` startup read order;
- `AGENTS.md` mirror startup block;
- memory policy expectations;
- continuity file expectations;
- recent transcript window expectations;
- verification commands;
- Tri-Agent integration guidance;
- common failure modes;
- minimum portable checklist.

## Verification

Builder checked that the guide contains the startup command:

```powershell
.\tools\start_codex_transcript_mirror.ps1
```

Builder also checked that the guide includes the required sections for
`AGENTS.md`, tracking policy, verification, and Tri-Agent integration.

## Remaining Concerns

Builder did not copy the mirror scripts into the new folder. The guide tells
other repos to copy or implement the launcher trio from the source repo. If the
Mediator wants a fully portable bundle, a follow-up task should add template
scripts under `agent-memory-bootstrap/templates/`.
