# Validator Directive: Fix Codex Memory Tracking Policy

- Date: 2026-06-16
- Phase: codex-transcript-mirror
- From: Validator
- To: Builder
- Work tier: Tier 2 governance/continuity infrastructure

## Mediator Decision

The Mediator accepts tracking the compact Codex memory artifacts in git. The rationale is catastrophic recovery: the repository should preserve not only code, but also the conversation trail and decisions that led to the code.

Raw transcript mirrors must remain ignored and local.

## Required Work

Implement the tracking policy so future agents understand the split:

- raw Codex transcript mirror folders remain ignored;
- compact generated Codex continuity files under `memory-bank/` are intentionally trackable;
- tracked memory files are marked as generated continuity artifacts and should be treated as sensitive repo memory;
- future agents can discover the policy without guessing.

## Artifacts In Scope

- `.gitignore`
- `memory-bank/CODEX_CONTINUITY.md`
- `memory-bank/transcripts/codex-session-live.md`
- optional repo-local policy docs if needed
- no application behavior changes

## Required Builder Report

Report:

- files changed;
- tracking/privacy policy implemented;
- verification performed;
- remaining concerns for Editor.

