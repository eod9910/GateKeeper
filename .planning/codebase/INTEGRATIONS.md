# External Integrations

**Analysis Date:** 2026-02-09

## APIs & External Services

### OpenAI API (GPT-4o with Vision)
- **File:** `backend/src/services/visionService.ts`
- **Endpoint:** `https://api.openai.com/v1/chat/completions`
- **Model:** `gpt-4o` (vision-capable)
- **Usage 1 — Chart Analysis:** Accepts base64-encoded chart screenshots, returns structured Wyckoff pattern analysis with confidence scores, phase identification, price levels, and ML-ready numerical scores (0-1 scale)
- **Usage 2 — Trading Co-Pilot Chat:** Conversational AI assistant for trade evaluation, position sizing, and pattern Q&A; optionally accepts chart images for visual context
- **Auth:** Bearer token via `OPENAI_API_KEY` environment variable
- **Fallback:** Local response generation when API is unavailable (`generateLocalResponse()` in `backend/src/services/visionService.ts`)

### Ollama (Local Vision AI — Alternative)
- **File:** `backend/src/services/visionService.ts`
- **Endpoint:** `${OLLAMA_URL}/api/generate` (default: `http://localhost:11434/api/generate`)
- **Model:** `minicpm-v` (configurable via `VISION_MODEL`)
- **Usage:** Same chart analysis as OpenAI but runs locally; less accurate per code comments
- **Health Check:** `${OLLAMA_URL}/api/tags` — verifies server is running and model is loaded

### Yahoo Finance (yfinance)
- **File:** `backend/services/patternScanner.py`
- **Library:** `yfinance` Python package (wraps Yahoo Finance public API)
- **Usage:** Fetches historical OHLCV (Open, High, Low, Close, Volume) data for any ticker symbol
- **Parameters:** Supports configurable period (`max`, `5y`, etc.) and interval (`1wk`, `1d`, etc.)
- **Invocation:** Called from Node.js via `child_process.spawn('python', [...])` in `backend/src/routes/candidates.ts`

### CDN Services (Frontend)
- **Tailwind CSS:** `https://cdn.tailwindcss.com` — runtime CSS utility framework
- **Lightweight Charts:** `https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js` — TradingView charting
- **html2canvas:** `https://html2canvas.hertzen.com/dist/html2canvas.min.js` — DOM-to-canvas screenshot

## Data Storage

### JSON File Storage (Primary)
- **Service:** `backend/src/services/storageService.ts`
- **Base Path:** `backend/data/`
- **Schema:** Individual JSON files per record, identified by UUID

| Store | Directory | Description |
|-------|-----------|-------------|
| Pattern Candidates | `backend/data/candidates/` | Scanner output — detected Wyckoff patterns with scores |
| User Labels | `backend/data/labels/` | Human-in-the-loop labels: `yes`, `no`, `close` |
| Corrections | `backend/data/corrections/` | Original → corrected pattern boundary adjustments |
| Saved Charts | `backend/data/saved-charts/` | Bookmarked chart configurations |
| Trade History | `backend/data/trade-history/` | Planned/executed trades, journal entries, outcomes |

### ML Model Artifacts
- **Directory:** `ml/`
- **Format:** `.joblib` files (serialized scikit-learn models)
- **Training Data:** CSV export from the labeling UI

### No External Database
- No SQL or NoSQL database — all state is flat-file JSON on the local filesystem
- No caching layer (Redis, Memcached, etc.)
- No cloud storage (S3, GCS, etc.)

## Authentication & Identity

### No Authentication System
- No user auth, login, or session management
- `userId` parameter exists in label/candidate APIs but defaults to `"default"` — intended for future multi-user support
- OpenAI API key is the only credential, stored in `backend/.env`

## Environment Configuration

### Required for Development
| Variable | File | Purpose |
|----------|------|---------|
| `VISION_PROVIDER` | `backend/.env` | Select vision backend: `"openai"` or `"ollama"` |
| `OPENAI_API_KEY` | `backend/.env` | OpenAI API authentication (required if provider is `openai`) |

### Optional / Have Defaults
| Variable | Default | File | Purpose |
|----------|---------|------|---------|
| `PORT` | `3002` | `backend/.env` | Express server port |
| `OLLAMA_URL` | `http://localhost:11434` | `backend/.env` | Ollama server address (only if provider is `ollama`) |
| `VISION_MODEL` | `minicpm-v` | `backend/.env` | Ollama model name (only if provider is `ollama`) |

### Notes
- `.env` file is located at `backend/.env` and loaded by `dotenv` at server startup (`backend/src/server.ts`)
- No separate production config — same `.env` file for all environments
- No `.env.example` file exists; variable names must be discovered from source code
