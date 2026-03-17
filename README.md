# Pattern Detector

Pattern Detector is a chart-first trading research platform built around scanner plugins, human review, AI-assisted chart analysis, forward training, validation, execution discipline, and tactical fundamentals context.

It is no longer just a single pattern-labeling app. The live system now includes:
- scanner and chart review
- AI scanner copilot and vision analysis
- validator and strategy versioning
- training and forward-test workflows
- execution and trading desk workflows
- research and parameter sweep tooling
- tactical fundamentals snapshotting

## Runtime Overview

The app runs as a Node/TypeScript backend with a static frontend and optional Python services.

- Backend: Express + TypeScript in `backend/src`
- Frontend: multi-page vanilla JS app in `frontend/public`
- Python services: scanner/plugin/fundamentals/data helpers in `backend/services`
- Storage: JSON/file-backed local persistence in `backend/data`

Default local URL:

```text
http://localhost:3002
```

## Quick Start

### 1. Install dependencies

Python:

```bash
pip install -r requirements.txt
```

Backend:

```bash
cd backend
npm install
```

### 2. Start the app

Full stack with Python plugin service:

```bash
cd backend
npm run dev
```

Backend only:

```bash
cd backend
npm run node:dev:no-py
```

### 3. Open the UI

Open:

```text
http://localhost:3002
```

## Main Product Surfaces

Routes served by the app:

- `/` scanner
- `/training` execution training and forward-test workflow
- `/validator` validator and validation reports
- `/strategy` strategy management
- `/workshop` workshop and scanner experimentation
- `/research` research tools
- `/sweep` parameter sweep tooling
- `/execution` execution and trading desk flow
- `/auto-labeler` auto-label workflow
- `/settings` frontend and backend settings
- `/history` saved trades, charts, and session history

Additional standalone pages in `frontend/public`:

- `copilot.html`
- `tombstones.html`
- `validator-symbol-library.html`
- `blockly-composer.html`
- `pipeline-composer.html`

## Key Policy Docs

- [Strategy Validation Policy](docs/strategy-validation-policy.md)

## Backend API Surface

Primary API groups:

- `/api/candidates` scanner candidate retrieval, scan execution, async batch scan jobs
- `/api/chart` OHLCV chart loading and normalization
- `/api/plugins` plugin catalog and plugin integration
- `/api/fundamentals` tactical fundamentals snapshot
- `/api/vision` AI chat and chart-analysis endpoints
- `/api/validator` validation runs and reports
- `/api/strategies` strategy version CRUD and strategy generation helpers
- `/api/training` training and forward resolution flows
- `/api/execution` execution engine and order workflow
- `/api/trades` trade history and trade state
- `/api/labels` labels and scanner feedback
- `/api/corrections` chart corrections
- `/api/saved-charts` saved chart states
- `/api/universe` symbol-universe management
- `/api/research` research helpers
- `/api/sweep` sweep runs
- `/api/ml` ML helpers
- `/api/auto-label` automatic labeling workflows
- `/api/quotes` quote lookup
- `/api/ai` backend AI credential/settings management

Health check:

```text
GET /api/health
```

## Scanner Semantics

Scanner candidates now distinguish three different concepts:

- `candidate_role`
  `context_indicator`, `pattern_detector`, `entry_signal`
- `candidate_actionability`
  `context_only`, `setup_watch`, `entry_ready`
- `entry_ready`
  a legacy boolean still present for compatibility

This matters because not every scanner output is a trade signal. Some plugins are context only and should be treated as supporting structure rather than entry logic.

## AI and Fundamentals

The scanner copilot and chart-analysis flow can consume:

- chart screenshot context
- selected candidate metadata
- tactical fundamentals snapshot
- semantic candidate classification

Fundamentals are currently Yahoo-backed through local Python services and normalized into a tactical trading panel rather than a traditional investor dashboard.

## Data and Storage

Important storage roots:

- `backend/data/candidates`
- `backend/data/labels`
- `backend/data/corrections`
- `backend/data/patterns`
- `backend/data/research`
- `backend/data/universe`
- `backend/data/training`
- `backend/data/trades`

The app is still primarily file-backed. There is no database dependency in the default local workflow.

## Testing

Backend regression suite:

```bash
cd backend
npm test
```

Included coverage currently targets:

- vision response parsing
- training forward resolution
- candidate filtering and semantics
- candidate persistence helpers
- chart payload normalization
- runtime contract validation
- validator Python fixtures
- fundamentals scoring/tagging

TypeScript build:

```bash
cd backend
npm run build
```

## Key Directories

```text
pattern-detector/
|- backend/
|  |- src/
|  |  |- routes/        Express route groups
|  |  |- services/      Backend logic, normalization, execution, AI
|  |  |- types/         Shared TS contracts
|  |  `- server.ts      Express entrypoint
|  |- services/         Python services and research scripts
|  |- data/             Local storage, patterns, research, universe state
|  `- tests/            Python regression tests
|- frontend/
|  `- public/           HTML/JS/CSS frontend pages
|- docs/
|  |- ARCHITECTURE.md   Current system map
|  |- validator-api-v2.md
|  `- base-method-review-workflow.md
`- README.md
```

## Documentation

Start here:

- [Architecture](docs/ARCHITECTURE.md)
- [Validator API V2](docs/validator-api-v2.md)
- [Base Method Review Workflow](docs/base-method-review-workflow.md)

## Current State

The project is in refinement mode, not feature bootstrap mode.

The main engineering priorities are:

- reliability and regression coverage
- contract clarity across TS, Python, and frontend boundaries
- separation of context vs signal semantics
- documentation and maintainability
- tighter execution safety
