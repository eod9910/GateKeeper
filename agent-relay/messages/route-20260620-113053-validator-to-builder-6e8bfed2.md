# Validator Directive: Add Builder Elegance Metric

## Classification

Governance / role-instruction change. No product behavior or code-symbol edit is authorized.

## Intent

Make Builder's elegance standard measurable when a task reduces unnecessary code.

The metric should capture the idea:

```text
Elegance gain = unnecessary LOC removed / original LOC
```

But only when required behavior, safety, readability, and verification are preserved.

## Builder Directive

Update:

- `agent-relay/roles/Builder/ROLE.md`
- `agent-relay/roles/Editor/ROLE.md`

In Builder's role file, add guidance that Builder reports an `Elegance Result` when relevant, including:

- before/after shape;
- net LOC reduction or consolidation;
- percent reduction when meaningful;
- behavior preserved;
- verification evidence;
- safety boundaries not weakened.

In Editor's role file, add guidance that Editor may use this metric during the Ponytail-style pass, but must reject code-golf reductions that weaken clarity, validation, security, accessibility, tests, or behavior-preservation evidence.

## Boundaries

- Do not make line count the only measure of quality.
- Do not incentivize clever compression.
- Do not weaken any role authority or restrictions.

## Acceptance Evidence

- Diff limited to the two role files plus relay artifacts.
- Router verification passes.
