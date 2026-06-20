# Builder Report: Builder Elegance Metric

## Directive

Implement Validator directive `2026-06-20-builder-elegance-metric.md`.

## Files Changed

- `agent-relay/roles/Builder/ROLE.md`
- `agent-relay/roles/Editor/ROLE.md`

## What Changed

Added `### Elegance Result` under Builder's Elegance Standard.

Builder now reports an `Elegance Result` when a task meaningfully removes unnecessary code or consolidates duplicate implementations, including:

- before/after shape;
- net LOC reduced or duplicate paths removed;
- percent reduction when clear;
- behavior preserved;
- verification evidence;
- safety boundaries not weakened.

Added Editor guidance to verify that reported reductions are real unnecessary code, not code golf.

## Boundaries Preserved

The new language explicitly rejects shorter code that weakens readability, validation, security, accessibility, required tests, or behavior-preservation evidence.

## Verification

Doc-only role instruction change. No product code changed.
