# Research Study Framework

This framework is the required home for exploratory research records in Pattern
Detector. It is intentionally a framework, not a rigid engine: agents can still
investigate unusual questions, but every study must leave the same recoverable
trail.

## Canonical Location

Generated study records live under:

```text
backend/data/research/studies/
```

That folder is runtime data and is ignored by git. The framework code and schema
in `backend/research_framework/` are tracked.

## Required Study Layout

Each study folder must contain:

```text
backend/data/research/studies/<study_id>/
  manifest.json
  config.json
  summary.json
  artifacts.json
  notes.md
```

### `manifest.json`

The durable provenance record. It names the study, framework version, engine or
script used, source artifacts, timestamps, status, classification, and promotion
state.

### `config.json`

The input/configuration known for the study. If the original config is missing,
store `{}` and record that limitation in `manifest.json`.

### `summary.json`

Machine-readable summary of the result. It should be concise and point to larger
artifact files rather than duplicating them.

### `artifacts.json`

List of files created or consumed by the study. Prefer repo-relative paths.

### `notes.md`

Human-readable notes, caveats, interpretation, and promotion guidance.

## Classifications

Use one of these values in `manifest.json`:

- `technical_validator`
- `parameter_sweep`
- `fundamental_pit`
- `valuation_study`
- `exploratory_research`
- `scratch_legacy`
- `data_audit`

## Agent Rules

Agents must not create new ad hoc study locations. If a study cannot be run
through an existing app engine, create or update a study folder here and record
why the existing engines did not fit.

Historical artifacts can remain in their legacy locations when moving them would
break app code. In that case, the study folder must point to the legacy files in
`artifacts.json` and `manifest.json`.

## Legacy Migration

Run:

```powershell
python backend/research_framework/tools/migrate_legacy_research.py
```

The migration is non-destructive. It creates normalized study records that
reference existing artifacts; it does not move or delete legacy files.
