# Builder Report: Ponytail-Style Editor Pass

## Directive

Implement Validator directive `2026-06-20-editor-ponytail-pass.md`.

## Files Changed

- `agent-relay/roles/Editor/ROLE.md`

## What Changed

Added `## Ponytail-Style Anti-Overengineering Pass` to the Editor role instructions.

The new section directs Editor to look for unnecessary code using these labels:

- `delete`
- `stdlib`
- `native`
- `existing-dependency`
- `yagni`
- `shrink`

It also preserves the safety boundary: Editor must not remove trust-boundary validation, data-loss protection, security controls, accessibility, required tests, or behavior-preservation evidence.

## Notes

No product code was changed. No external Ponytail plugin was installed or required.
