# Pattern Detector Coding Paradigm

Pattern Detector is now governed as a `medium-large-modular-web` project.

The goal is not to rearrange the whole repo in one pass. The goal is to stop new
drift immediately and move toward a modular monolith whenever work touches a
domain.

## Target Architecture

Pattern Detector should move toward this shape:

```text
pattern-detector/
  apps/
    server/
      src/
        app.ts
        modules/
          scanner/
          charting/
          strategies/
          backtests/
          broker/
          universe/
          plugins/
          auth/
        shared/
          config/
          logging/
          errors/
          http/
          validation/
    web/
      public/
      src/
        pages/
        components/
        charts/
        api-client/
        state/
        styles/
  packages/
    contracts/
      api/
      domain/
    indicators/
    strategy-engine/
    market-data/
  data/
  tools/
  memory-bank/
  agent-relay/
```

## Product Domains

Use product capability boundaries, not giant technical buckets.

- `scanner`: scans, signals, watchlists, scanner UI, scanner API.
- `charting`: candles, overlays, indicators display, chart settings.
- `strategies`: strategy definitions, scoring, parameters.
- `backtests`: historical runs, result artifacts, comparisons.
- `broker`: Alpaca/client integration, orders, positions.
- `universe`: ticker lists, symbol refresh/update jobs.
- `plugins`: plugin registry, workspace tools, agent-facing plugin services.
- `auth/settings`: user/session/settings behavior when present.

## Backend Module Rule

New medium/large backend work should land in the owning domain module.

Target module shape:

```text
apps/server/src/modules/<domain>/
  <domain>.routes.ts
  <domain>.service.ts
  <domain>.types.ts
  <domain>.validators.ts
  <domain>.test.ts
```

Existing code may still live in older folders. Do not migrate it just to make
the tree look nice. When a task touches an older area, improve toward the target
boundary only as much as the directive authorizes.

## Frontend Rule

Frontend work should mirror product domains.

Target frontend shape:

```text
apps/web/src/pages/<domain>/
apps/web/src/api-client/
apps/web/src/state/
apps/web/src/components/
apps/web/src/charts/
```

Plain JavaScript can remain while migrating. New large UI surfaces should avoid
adding more global scripts and should instead create domain-owned modules or a
Validator-approved frontend structure.

## Shared Code Rule

Use `shared/` and `packages/` only for code that is genuinely shared.

Do not create or expand catch-all global folders such as `utils`, `helpers`,
`services`, or `routes` for domain behavior. A shared abstraction should have at
least two real consumers or explicit Validator approval.

## Incremental Migration Rule

Pattern Detector should migrate by vertical slices:

1. Pick one product domain or capability.
2. Identify the current route/service/frontend/data flow.
3. Move or wrap only the pieces needed for the approved work.
4. Preserve behavior.
5. Verify with tests, syntax checks, or manual workflow evidence.
6. Record remaining old-shape code as follow-up, not as hidden scope.

## Validator Enforcement

For every substantial directive, Validator must state:

- selected package: `medium-large-modular-web`;
- affected product domain;
- current files involved;
- target files or module boundary;
- whether shared contracts/packages are allowed;
- verification gates;
- STOP conditions for architecture drift.

Validator should reject or revise plans that:

- place domain behavior in global technical buckets;
- create parallel engines, caches, workflows, or sources of truth;
- introduce shared abstractions before they are needed by real consumers;
- change API/domain contracts without naming affected consumers;
- migrate broad architecture without an approved slice.

## Builder Enforcement

Builder must implement inside the named domain boundary.

Builder must stop and report back when:

- the owning domain is unclear;
- a new domain seems necessary;
- the smallest correct implementation would create duplicate sources of truth;
- shared contract/package changes would affect another domain;
- the approved boundary no longer fits the work.

## Editor Enforcement

Editor reviews architecture drift as part of maintainability review.

Editor should mark an `EDITOR BLOCKER` when work:

- scatters one domain across unrelated global folders;
- duplicates an existing domain service, contract, cache, or workflow;
- hides product behavior in generic utilities;
- weakens validation or behavior-preservation evidence while simplifying;
- makes future Validator/Builder ownership unclear.

## One-Command Rule

The architecture may become more modular, but Pattern Detector should remain
one-command runnable for normal development unless the User/Mediator explicitly
approves a change.
