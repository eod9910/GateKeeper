# Pattern Detector Architecture

This document describes the current live architecture of the project as of March 6, 2026.

It replaces the earlier "single pattern labeling app" framing. The codebase is now a multi-surface trading research platform with shared scanner, chart, AI, training, validation, execution, and fundamentals layers.

## 1. System Shape

At a high level:

```text
Frontend pages (vanilla JS / HTML)
        |
        v
Express backend (TypeScript)
        |
        +--> local JSON/file storage
        +--> Python plugin/scanner service
        +--> Python fundamentals/data helpers
        +--> AI providers (OpenAI and/or local model paths)
```

Core principle:

- charts and structure are the primary discovery surface
- plugins generate candidates or context
- AI is advisory, not the source of truth
- fundamentals are tactical context, not a replacement for chart structure
- execution features exist to reinforce process discipline, not to turn the app into a generic broker frontend

## 2. Runtime Components

### 2.1 Frontend

Location:

```text
frontend/public
```

The frontend is a multi-page vanilla JS application. It does not use React in the current production path.

Primary pages:

- `index.html`
  scanner, candidate review, chart, AI copilot, fundamentals snapshot
- `training.html`
  execution training and forward resolution
- `validator.html`
  validator run and report workflows
- `strategy.html`
  strategy management and strategy generation helpers
- `execution.html`
  execution and discipline workflows
- `research.html`
  research tooling
- `sweep.html`
  parameter sweep workflows
- `settings.html`
  frontend and backend settings
- `history.html`
  stored candidates, charts, and trade history
- `workshop.html`
  workshop and scanner experimentation
- `auto-labeler.html`
  auto-labeling flow

The heaviest page scripts today include:

- `frontend/public/index.js`
- `frontend/public/scanner.js`
- `frontend/public/ai-chat.js`
- `frontend/public/chart.js`
- `frontend/public/training-module.js`
- `frontend/public/validator.js`
- `frontend/public/workshop-scanner.js`

### 2.2 Backend

Location:

```text
backend/src
```

Entry point:

- `backend/src/server.ts`

Responsibilities:

- serve the frontend
- expose the HTTP API
- normalize and validate service payloads
- bridge frontend requests to Python services
- manage storage, AI, fundamentals, training, validator, execution, and strategy flows

### 2.3 Python Services

Location:

```text
backend/services
```

Important Python responsibilities:

- scanner/plugin execution
- market data and OHLCV handling
- fundamentals snapshot construction
- research scripts and batch tools
- validator fixture/testing support

Important entrypoints:

- `backend/services/plugin_service.py`
- `backend/services/patternScanner.py`
- `backend/services/fundamentalsService.py`
- `backend/services/platform_sdk/ohlcv.py`
- `backend/scripts/run_base_method_suite.py`

## 3. Request and Data Flow

### 3.1 Scanner Flow

```text
Scanner page
  -> /api/candidates/scan
  -> backend strategy/plugin resolution
  -> Python plugin service or local runner
  -> candidate normalization + contract validation
  -> candidate semantic classification
  -> frontend candidate list + chart review
```

Key backend files:

- `backend/src/routes/candidates.ts`
- `backend/src/services/pluginServiceClient.ts`
- `backend/src/services/contractValidation.ts`
- `backend/src/services/candidateFilters.ts`
- `backend/src/services/candidateSemantics.ts`
- `backend/src/services/candidatePersistence.ts`

### 3.2 Chart Flow

```text
Frontend chart request
  -> /api/chart/ohlcv
  -> backend chart route
  -> Python OHLCV service / fallback paths
  -> normalized chart payload
  -> frontend chart renderer
```

Key files:

- `backend/src/routes/chart.ts`
- `backend/src/services/chartData.ts`
- `backend/services/platform_sdk/ohlcv.py`
- `frontend/public/chart.js`

### 3.3 Fundamentals Flow

```text
Selected scanner symbol
  -> /api/fundamentals/:symbol
  -> backend route
  -> Python fundamentals service
  -> tactical snapshot normalization
  -> scanner fundamentals panel
  -> optional AI context
```

Key files:

- `backend/src/routes/fundamentals.ts`
- `backend/services/fundamentalsService.py`
- `backend/src/types/fundamentals.ts`
- `frontend/public/index.js`
- `frontend/public/ai-chat.js`

### 3.4 Vision and Copilot Flow

```text
User chat or Analyze Chart
  -> /api/vision/chat or /api/vision/analyze
  -> backend vision service
  -> model provider
  -> structured parse / fallback handling
  -> scanner AI panel
```

Key files:

- `backend/src/routes/vision.ts`
- `backend/src/services/visionService.ts`
- `frontend/public/ai-chat.js`

### 3.5 Training Flow

```text
Training page
  -> chart load + scenario setup
  -> forward resolution / replay logic
  -> trade scoring and session feedback
```

Key files:

- `backend/src/routes/training.ts`
- `backend/src/services/training/*`
- `frontend/public/training.html`
- `frontend/public/training-module.js`

### 3.6 Validator Flow

```text
Validator UI
  -> /api/validator/*
  -> backtest / robustness / decision pipeline
  -> report storage
  -> report review UI
```

Key files:

- `backend/src/routes/validator.ts`
- `docs/validator-api-v2.md`
- `frontend/public/validator.html`
- `frontend/public/validator.js`

### 3.7 Execution Flow

```text
Execution UI
  -> /api/execution/* and /api/trades/*
  -> execution engine / position logic / guardrails
  -> trade storage and audit state
```

Key files:

- `backend/src/routes/execution.ts`
- `backend/src/routes/trades.ts`
- `backend/src/services/executionEngine.ts`
- `backend/src/services/orderExecutor.ts`
- `backend/src/services/positionManager.ts`
- `backend/src/services/killSwitch.ts`

## 4. Candidate Semantics

Scanner outputs are not all the same kind of object.

The system now distinguishes:

- `candidate_role`
  - `context_indicator`
  - `pattern_detector`
  - `entry_signal`
- `candidate_actionability`
  - `context_only`
  - `setup_watch`
  - `entry_ready`

This is derived in:

- `backend/src/services/candidateSemantics.ts`

And surfaced in:

- candidate API payloads
- scanner result rows
- candidate detail panel
- scanner copilot context

This separation matters because some plugins produce structure/context only and should not be displayed or ranked as direct entry signals.

## 5. Route Map

Current backend route groups registered in `backend/src/server.ts`:

- `/api/candidates`
- `/api/labels`
- `/api/corrections`
- `/api/vision`
- `/api/saved-charts`
- `/api/trades`
- `/api/quotes`
- `/api/fundamentals`
- `/api/validator`
- `/api/strategies`
- `/api/plugins`
- `/api/chart`
- `/api/universe`
- `/api/research`
- `/api/sweep`
- `/api/execution`
- `/api/ai`
- `/api/ml`
- `/api/auto-label`
- `/api/training`

Named frontend routes served directly:

- `/validator`
- `/strategy`
- `/workshop`
- `/research`
- `/sweep`
- `/execution`
- `/training`
- `/auto-labeler`

All other unmatched routes fall back to the scanner page.

## 6. Storage Model

The default local deployment is file-backed.

Important storage zones:

- `backend/data/candidates`
- `backend/data/labels`
- `backend/data/corrections`
- `backend/data/patterns`
- `backend/data/research`
- `backend/data/universe`
- `backend/data/trades`
- `backend/data/training`

Storage responsibilities are concentrated in:

- `backend/src/services/storageService.ts`

The storage layer still carries too much responsibility and is a known refactor target.

## 7. Environment and Providers

### Node and Backend

Main development commands:

```bash
cd backend
npm run dev
npm run node:dev:no-py
npm run build
npm test
```

### Python Service

Default plugin service command:

```bash
cd backend
npm run py:service
```

Default port:

```text
8100
```

### AI

AI credentials can come from:

- backend environment variables
- backend AI settings saved through `/api/ai`

Vision/copilot functionality depends on those credentials being configured and the backend process loading them.

## 8. Testing and Verification

The current regression suite covers core backend workflows:

- training forward resolution
- vision response parsing
- candidate filtering
- candidate semantics
- candidate persistence
- chart normalization
- runtime contract validation
- Python validator fixtures
- fundamentals scoring/tagging

Commands:

```bash
cd backend
npm test
npm run build
```

This is a backend regression baseline, not full end-to-end browser automation.

## 9. Known Architectural Constraints

The system is functional, but there are still active constraints:

- several frontend page scripts are still oversized
- `visionService.ts`, `storageService.ts`, and some route files remain too large
- storage is still file-based
- observability across Node <-> Python boundaries is limited
- the frontend shares state through large globals rather than a formal app architecture

These are current engineering constraints, not missing documentation.

## 10. Current Product Positioning

Pattern Detector should be understood as:

- a chart-first speculative/tactical trading research platform
- a plugin-based scanner and review environment
- a training and process-enforcement tool
- an execution discipline layer

It should not be understood as:

- a generic finance terminal
- a pure quant backtesting platform
- a long-term value-investor dashboard
- a broker-native execution platform
