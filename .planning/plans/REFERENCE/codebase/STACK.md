# Technology Stack

Analysis date: 2026-06-02
Status: Current orientation reference

## Languages

- TypeScript: backend Express API and services
- JavaScript: static frontend modules
- Python: scanners, validators, fundamentals/PIT, ledger, social intelligence, research scripts
- HTML/CSS: static app pages and styling
- PowerShell / batch: local maintenance and scheduled-task helpers

## Backend Runtime

`backend/package.json` defines the Node backend.

Main scripts:

- `npm run build`: TypeScript compile
- `npm run start`: run compiled server
- `npm run dev`: run Python plugin service plus TypeScript dev server
- `npm run node:dev`: run Express with `tsx watch`
- `npm run py:service`: run `backend/services/plugin_service.py`
- `npm test`: run TypeScript service tests and Python unittest suites

Key dependencies:

- `express`
- `cors`
- `dotenv`
- `node-fetch`
- `uuid`
- `node-cron`
- `@alpacahq/alpaca-trade-api`

Key dev dependencies:

- `typescript`
- `tsx`
- `ts-node`
- `concurrently`
- `cross-env`

## Frontend Runtime

The frontend is served from `frontend/public` as static files. There is no current bundler or component framework. Pages load HTML, CSS, and JavaScript directly.

Major browser libraries include:

- Lightweight Charts
- Tailwind CSS on older pages / local CSS on newer surfaces
- html2canvas or screenshot tools where needed for chart capture

## Python Runtime

Python is used heavily. Dependencies vary by script/service, but recurring packages include:

- `pandas`
- `numpy`
- `yfinance`
- `scikit-learn`
- `joblib`
- data/HTTP/parsing libraries used by EDGAR, social, fundamentals, and research scripts

The backend dev flow starts `plugin_service.py` on port 8100 when `npm run dev` is used.

## Storage

The app remains local-first and file-backed. There is no full external SQL database requirement for ordinary local use. Some services use JSON files, local DB-like stores, or generated artifacts under `backend/data`.

Important stores include market intelligence scenarios, fundamentals cache, PIT backups, strategy/pattern registries, sweep results, validation reports, trade history, training data, and universe/catalog data.

## AI And External Services

The app can use:

- OpenAI for chat/vision/analysis workflows
- Ollama for local model workflows
- Yahoo Finance / yfinance for market data
- EDGAR/SEC data collection
- social/news/forum/video collectors
- broker/execution integrations, including Alpaca and Robinhood-related flows

## Environment

Important environment variables include:

- `PORT`
- `OPENAI_API_KEY`
- `VISION_PROVIDER`
- `VISION_MODEL`
- `OLLAMA_URL`
- scheduler and ledger hydration toggles/limits
- broker/execution credentials where configured

Check route/service code before assuming a variable is required.
