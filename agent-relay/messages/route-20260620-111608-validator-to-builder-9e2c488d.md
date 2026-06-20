# Validator Directive: Add Builder Elegance Standard

## Classification

Governance / role-instruction change. No product behavior or code-symbol edit is authorized.

## Intent

Give Builder a concrete implementation-quality doctrine that complements:

- Validator + GitNexus: impact, risk, blast radius, acceptance evidence.
- Editor + Ponytail: deletion, simplicity, anti-overengineering.

Builder's doctrine should focus on native, correct implementation.

## Builder Directive

Update `agent-relay/roles/Builder/ROLE.md` only.

Add a `Builder Elegance Standard` section that instructs Builder to:

- implement the smallest correct change that satisfies the Validator directive;
- fit the existing codebase's local patterns, naming, data contracts, and UI/API conventions;
- prefer existing services, helpers, routes, schemas, and storage locations over new parallel structures;
- keep scope narrow and avoid opportunistic refactors;
- preserve behavior not named in the directive;
- choose boring, readable code over clever compression;
- leave the smallest meaningful verification evidence;
- report assumptions, limitations, and any behavior that still needs manual validation.

## Boundaries

The new section must not weaken Builder restrictions. Builder still cannot accept its own work or route directly to Editor.

## Acceptance Evidence

- Diff is limited to `agent-relay/roles/Builder/ROLE.md` plus relay artifacts.
- Router verification passes.
