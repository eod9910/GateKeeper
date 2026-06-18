# Codebase Structure

Analysis date: 2026-06-02
Status: Current orientation reference

## Top-Level Layout

```text
pattern-detector/
  backend/                  Express API, TypeScript services, Python services, scripts, local data
  frontend/public/           Static browser app pages and JavaScript modules
  .planning/                 Planning, reference, prompts, research studies
  workspace/                 AI workspace documents and skills
  memory-bank/               Long-running project memory/context
  ml/                        Machine learning scripts/artifacts
  tests/                     Python unittest suites
  .planning/plans/REFERENCE/ Durable reference docs and codebase orientation
  tools/                     Utility tools
  assets/                    Static/project assets
  logs/                      Local logs
  Financial data/            Financial data artifacts
```

There are also local/tooling folders such as `.claude`, `.cursor`, `.gitnexus`, `.vscode`, `.pytest_cache`, `_skills`, and transcript/debug folders.

## Backend Source

```text
backend/src/
  server.ts                  Express app entry point and route registration
  routes/                    API routers
  services/                  TypeScript business logic, DB/file stores, schedulers, engines
  types/                     TypeScript shared types
```

Current route files include scanner/candidates, labels, corrections, vision, saved charts, trades, quotes, fundamentals, validator, strategies, plugins, chart, universe, research, sweep, execution, AI settings, ledger hydration, calibration, social intelligence, market intelligence, audio, ML, auto label, training, reference, consumer cycle, EDGAR filings, options flow, and watchlist.

Current service files include storage, search, vision, symbol catalog, universe registry, sweep engine, validator comparison, execution bridge/engine/settings/logging, broker/order/position services, ledger engines, ledger hydration scheduler, market intelligence DB/scheduler, social intelligence scheduler, EDGAR scheduler/DB, options flow DB, fundamental and valuation services, research agent/catalog, strategy generation, plugin validation/resolution, primitive normalization, training contract validation, signal scanner, and several tests.

## Backend Python

```text
backend/services/           Python services used by scanners, validators, PIT/fundamentals, ledger, social, plugins
backend/scripts/            Research, collection, hydration, backtest, audit, seeding, and maintenance scripts
```

The Python side is no longer a single scanner. It includes PIT stores/query, fundamentals service, validator pipeline, strategy runner, plugin service, quote service, ledger hydration, social intelligence DB, macro scoring, authenticity scoring, symbol catalog DB, universe registry, and many one-off or repeatable research scripts.

## Frontend

```text
frontend/public/
  index.html/js/css          Scanner shell
  copilot.html + modules     Trading desk / Co-Pilot
  validator.html/js          Validator
  sweep.html/js              Parameter Sweep
  market-intelligence.*      Market Intelligence
  fundamental-backtester.*   Fundamental Backtester
  execution.*                Execution Desk
  training.*                 Training module
  research.*                 Research Studio
  workshop.*                 Indicator Studio / plugin workshop
  settings.*                 Settings
  consumer-cycle.*           Consumer Cycle
  vision-lab.*               Vision Lab
  tombstones.*               Tombstones
```

The frontend is still static HTML/CSS/JS. It has no build step and no module bundler. Large files remain common.

## Data

`backend/data` contains local file-backed stores. Current important directories include:

- `candidates`, `charts`, `labels`, `corrections`, `saved-charts`
- `trade-history`, `trade-instances`, `execution-log`
- `fundamentals-cache`, `pit-backups`, `reit-supplementals`
- `quote-cache`, `option-quote-cache`, `options-reports`
- `strategies`, `patterns`, `sweep-results`, `validation-reports`, `validator-snapshots`
- `scenarios`, `research`, `formula-ranking-results`
- `training`, `universe`, `schemas`, `preferences`, `logs`

## Planning

`.planning/plans` is the canonical planning tree. Active and completed workstreams use PRD/checklist pairs. Reference docs live under `.planning/plans/REFERENCE`.
