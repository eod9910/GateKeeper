# Handoff Sequence Protocol

## Purpose

This protocol defines the required Validator, Builder, and Editor sequence for formal relay work in a target repo.

## Standard Build Sequence

Use this sequence for implementation work:

```text
1. Validator -> Builder: EXECUTION DIRECTIVE
2. Builder -> Validator: BUILDER REPORT
3. Validator -> Editor: REVIEW DIRECTIVE
4. Editor -> Validator: EDITOR REVIEW
5. Validator stores a ruling, then reports the final decision to the user in normal conversation
```

## Standard Review-Only Sequence

Use this sequence for review-only work:

```text
1. Validator -> Editor: REVIEW DIRECTIVE
2. Editor -> Validator: EDITOR REVIEW
3. Validator stores a ruling or gives the user the decision
```

Do not route an `Editor -> Validator` review without a preceding `Validator -> Editor` review directive for the same phase.

## Phase Naming

Use short, stable phase names:

```text
<repo-area>-<workstream>
```

Examples:

```text
bootstrap-instantiation
bootstrap-protocol-correction
cursor-mirror-lifecycle
```

## Canonical File Paths

Validator directives:

```text
agent-relay/roles/Validator/directives/YYYY-MM-DD-<target-role>-<slug>.md
```

Builder reports:

```text
agent-relay/roles/Builder/reports/YYYY-MM-DD-<slug>-builder-report.md
```

Editor reports:

```text
agent-relay/roles/Editor/reports/YYYY-MM-DD-<slug>-editor-review.md
```

Validator rulings:

```text
agent-relay/roles/Validator/rulings/YYYY-MM-DD-<slug>-validator-ruling.md
```

## Stop Conditions

Stop and ask the user or Validator before continuing when:

- A required role directive is missing.
- A report would broaden scope beyond the directive.
- The router verify command fails.
- A generated transcript needs manual repair.
