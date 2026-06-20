# Validator Directive: Add Ponytail-Style Editor Pass

## Classification

Governance / role-instruction change. No product behavior or code-symbol edit is authorized.

## Intent

Give the Editor a concrete anti-overengineering checklist inspired by the Ponytail "lazy senior developer" doctrine, while preserving this repo's existing Tri-Agent authority model.

## Builder Directive

Update `agent-relay/roles/Editor/ROLE.md` only.

Add a section that instructs Editor to perform an optional Ponytail-style anti-overengineering pass during structure review. The pass should identify needless code and mark findings with compact categories:

- `delete`: dead code, speculative features, unused flexibility.
- `stdlib`: hand-rolled logic that the standard library already covers.
- `native`: platform/browser/runtime feature already exists.
- `existing-dependency`: already-installed dependency covers it.
- `yagni`: abstraction, config, layer, or hook with no current need.
- `shrink`: same behavior in fewer clearer lines.

The section must preserve safety boundaries:

- Do not remove trust-boundary validation.
- Do not remove data-loss protection.
- Do not weaken security or accessibility.
- Do not delete required tests.
- Do not replace correctness, security, performance, or behavior-preservation review.

The section should state that Ponytail-style findings are advisory unless Editor explicitly marks them as an `EDITOR BLOCKER`.

## Acceptance Evidence

- Diff is limited to `agent-relay/roles/Editor/ROLE.md` plus relay artifacts.
- Router verification passes.
- The new language does not install or require the Ponytail plugin.
