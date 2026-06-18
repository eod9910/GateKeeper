# Architecture

Analysis date: 2026-06-02
Status: Current orientation reference

## System Shape

Pattern Detector is a local-first trading research and execution platform. It started as a pattern scanner, but the current app is broader: scanner, trading desk, validator, strategy builder, parameter sweep, market intelligence, fundamental backtester, execution desk, training, consumer cycle research, options flow, EDGAR/fundamentals, social intelligence, and ledger-style company analysis.

The app is still a layered monolith:

1. Browser UI in `frontend/public`
2. Express API in `backend/src`
3. TypeScript services in `backend/src/services`
4. Python services and research scripts in `backend/services` and `backend/scripts`
5. File-backed local data in `backend/data`
6. Strategy/plugin artifacts in `backend/data/strategies`, `backend/data/patterns`, and related stores

## Runtime Flow

`backend/src/server.ts` is the server entry point. It:

- loads environment variables
- serves static frontend files
- registers API routers
- serves named app routes such as `/scanner`, `/market-intelligence`, `/parameter-sweep`, `/training`, and `/execution`
- starts scheduler/resume flows for ledger hydration, social intelligence, market intelligence, EDGAR filings, and execution bridge state

The frontend is currently a static multi-page app, not a React/Vite app. Pages use large plain JavaScript modules and shared support files.

## Main Feature Areas

### Scanner And Trading Desk

The scanner is centered around `index.html`, `index.js`, `scanner.js`, chart modules, drawing modules, and Co-Pilot support files. The trading desk uses `copilot.html` plus several split modules for analysis, charting, chat, execution routing, risk planning, and trade actions.

### Validator And Strategies

Validation runs through `backend/src/routes/validator.ts`, `backend/services/validatorPipeline.py`, and related strategy/backtest services. Strategy authoring and storage live through `strategies.ts`, `strategyGenService.ts`, plugin resolution, parameter manifests, and strategy data stores.

### Parameter Sweep

The parameter sweep page is `sweep.html` / `sweep.js`, with backend support in `routes/sweep.ts` and `services/sweepEngine.ts`. It is the optimization step before validator promotion.

### Fundamental Research

The fundamental backtester uses `fundamental-backtester.html`, `fundamental-backtester.js`, `routes/fundamentals.ts`, `fundamentalBacktestService.ts`, `backend/scripts/run_fundamental_backtester.py`, PIT facts, fundamentals cache, and valuation/fundamental services.

### Market Intelligence

Market intelligence is a major subsystem. It uses `market-intelligence.html`, `market-intelligence.js`, `routes/marketIntelligence.ts`, `marketIntelligenceDb.ts`, `marketIntelligenceScheduler.ts`, social intelligence collectors, macro/social scoring scripts, scenarios, and concept/topic promotion scripts.

### Ledger / Company Analysis

Ledger-style company analysis is implemented through `ledgerEngines.ts`, `ledgerHydrationScheduler.ts`, `ledgerWorkspaceSkills.ts`, Python ledger hydration scripts, fundamentals services, valuation engines, EDGAR collection, PIT stores, and fundamentals cache.

### Execution

Execution support includes `execution.html`, execution frontend modules, `routes/execution.ts`, `executionBridge.ts`, `executionEngine.ts`, `positionManager.ts`, `orderExecutor.ts`, broker clients, imported/manual external positions, kill switch, and Robinhood/Alpaca-related code.

### Training

Training and forward-test functionality lives in `training.html`, `training-module.js`, `routes/training.ts`, `contractValidation.ts`, and `backend/src/services/training/forwardResolver.test.ts`.

## Current Scale

As of 2026-06-02:

- about 30 backend route files in `backend/src/routes`
- about 70 TypeScript service files in `backend/src/services`
- about 87 frontend public files in `frontend/public`
- many Python services and research scripts in `backend/services` and `backend/scripts`
- multiple active local data stores under `backend/data`

## Important Caution

This app is organic. Feature boundaries are real, but not always clean. Before changing shared behavior, inspect the actual call path and run GitNexus impact/change checks according to `AGENTS.md`.
