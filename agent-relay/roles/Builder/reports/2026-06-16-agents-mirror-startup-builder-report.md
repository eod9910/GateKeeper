# Builder Report: AGENTS.md Codex Mirror Startup

- Date: 2026-06-16
- Phase: agents-mirror-startup
- From: Builder
- To: Validator

## Scope

Builder updated `AGENTS.md` to make Codex transcript mirror startup a visible
startup-critical instruction.

## Files Changed

- `AGENTS.md`

## Startup Command Added

```powershell
.\tools\start_codex_transcript_mirror.ps1
```

## Verification

Builder ran the startup command from the repository root. It reported:

```text
Codex transcript mirror already running (PID 13760).
```

This verifies the launcher is idempotent for the current running mirror process.

## Preserved

Builder preserved the Planning Conventions section and the visible paired
PRD/checklist naming convention.

## Remaining Concerns

Builder reports no implementation blocker. Editor should review whether the new
startup instruction is placed clearly and does not duplicate memory policy
details.
