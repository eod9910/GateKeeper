# Validator Directive: Add Codex Mirror Startup To AGENTS.md

- Date: 2026-06-16
- Phase: agents-mirror-startup
- From: Validator
- To: Builder
- Work tier: Tier 2 governance/continuity infrastructure

## Mediator Decision

The Mediator directed that `AGENTS.md` must tell every newly instantiated agent
to ensure the Codex transcript mirror is running immediately after reading the
startup instructions.

## Required Work

Update `AGENTS.md` so startup instructions explicitly require the agent to:

- check whether the Codex transcript mirror is already running;
- start it if it is not running;
- use the existing idempotent launcher:

```powershell
.\tools\start_codex_transcript_mirror.ps1
```

The instruction must be startup-critical and visible near the Startup Read
Order section.

## Constraints

- Do not duplicate transcript retention policy details already owned by
  `memory-bank/CODEX_MEMORY_POLICY.md`.
- Do not change mirror implementation behavior.
- Preserve the planning naming convention visibility in `AGENTS.md`.
- Keep the edit concise and ASCII-safe.

## Required Builder Report

Report:

- files changed;
- exact startup command added;
- verification performed;
- any remaining concerns for Editor.
