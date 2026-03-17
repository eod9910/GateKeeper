# Technology Stack

**Analysis Date:** 2026-02-09

## Languages

| Language   | Version Target | Where Used |
|------------|---------------|------------|
| TypeScript | ES2020 (strict mode) | Backend server, API routes, services (`backend/src/`) |
| Python     | 3.x (no pinned version) | Pattern scanner (`backend/services/patternScanner.py`), ML training (`ml/train_classifier.py`, `ml/predict.py`) |
| HTML/CSS/JS | ES6+ (vanilla) | Frontend UI — no build step, served as static files (`frontend/public/`) |

## Runtime

| Component | Details |
|-----------|---------|
| **Node.js** | No pinned version; TypeScript targets ES2020, `@types/node@^20.10.0` suggests Node 20+ |
| **Python** | 3.x required (uses dataclasses, type hints, f-strings) |
| **npm** | Package manager for backend (`backend/package.json`) |
| **pip** | Package manager for Python deps (`requirements.txt`, `ml/requirements.txt`) |

## Frameworks

### Core
| Framework | Version | Role |
|-----------|---------|------|
| **Express** | `^4.18.2` | HTTP server, API routing, static file serving (`backend/src/server.ts`) |
| **Tailwind CSS** | CDN (runtime) | Frontend styling via `https://cdn.tailwindcss.com` (`frontend/public/index.html`) |
| **Lightweight Charts** | `4.1.0` (unpkg CDN) | TradingView charting library for candlestick/price charts (`frontend/public/index.html`, `frontend/public/copilot.html`) |

### Build / Dev
| Tool | Version | Role |
|------|---------|------|
| **TypeScript** | `^5.3.0` | Type checking and compilation (`backend/tsconfig.json`) |
| **ts-node** | `^10.9.2` | Dev-time TS execution (`npm run dev`) |

### ML / Data Science
| Library | Version | Role |
|---------|---------|------|
| **scikit-learn** | `>=1.3.0` | RandomForest, GradientBoosting, LogisticRegression classifiers (`ml/train_classifier.py`) |
| **pandas** | `>=2.0.0` | Data manipulation in scanner and ML pipeline |
| **numpy** | `>=1.24.0` | Numerical computation in scanner and ML pipeline |

## Key Dependencies

### Backend (Node.js) — `backend/package.json`
| Dependency | Version | Purpose |
|------------|---------|---------|
| `express` | `^4.18.2` | Web framework and API server |
| `dotenv` | `^17.2.3` | Loads `.env` config into `process.env` |
| `cors` | `^2.8.5` | Cross-origin request handling |
| `node-fetch` | `^2.7.0` | HTTP client for OpenAI and Ollama API calls (`backend/src/services/visionService.ts`) |
| `uuid` | `^9.0.0` | Unique ID generation for candidates, labels, corrections (`backend/src/services/storageService.ts`) |

### Python — `requirements.txt`, `ml/requirements.txt`
| Dependency | Version | Purpose |
|------------|---------|---------|
| `yfinance` | `>=0.2.0` | Fetches historical market data from Yahoo Finance (`backend/services/patternScanner.py`) |
| `pandas` | `>=2.0.0` | OHLCV data manipulation and feature extraction |
| `scikit-learn` | `>=1.3.0` | ML model training (RandomForest, GBT, Logistic Regression) |
| `joblib` | `>=1.3.0` | Model serialization/deserialization |

### Frontend (CDN) — `frontend/public/*.html`
| Library | Version | Purpose |
|---------|---------|---------|
| `lightweight-charts` | `4.1.0` | Candlestick chart rendering (TradingView open-source) |
| `html2canvas` | latest (CDN) | Screenshot charts for Vision AI analysis |
| `Tailwind CSS` | latest (CDN) | Utility-first CSS framework |

## Configuration

### Environment Variables — `backend/.env`
| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3002` | Express server port (`backend/src/server.ts`) |
| `VISION_PROVIDER` | `openai` | Vision AI backend: `"openai"` or `"ollama"` (`backend/src/services/visionService.ts`) |
| `OPENAI_API_KEY` | _(none)_ | OpenAI API authentication (`backend/src/services/visionService.ts`) |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama server URL (`backend/src/services/visionService.ts`) |
| `VISION_MODEL` | `minicpm-v` | Ollama model name for local vision inference (`backend/src/services/visionService.ts`) |

### TypeScript — `backend/tsconfig.json`
- Target: **ES2020**, Module: **CommonJS**
- Strict mode enabled
- Output: `backend/dist/`, Source: `backend/src/`
- JSON module resolution enabled, declarations emitted

### Build Scripts — `backend/package.json`
| Script | Command | Purpose |
|--------|---------|---------|
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/server.js` | Run production build |
| `dev` | `ts-node src/server.ts` | Run in development mode |
| `scan` | `python services/patternScanner.py` | CLI pattern scanner |

## Platform Requirements

### Development
- **Node.js** 20+ with npm
- **Python** 3.8+ with pip
- **Git** (not yet initialized as a repo)
- Install backend deps: `cd backend && npm install`
- Install Python deps: `pip install -r requirements.txt`
- Install ML deps: `pip install -r ml/requirements.txt`

### Production
- Node.js runtime for Express server
- Python runtime for pattern scanning (spawned as child process from Node)
- OpenAI API key **or** local Ollama server with `minicpm-v` model
- Filesystem write access for JSON data storage (`backend/data/`)
- No database server required — all persistence is file-based JSON
- No frontend build step — static HTML/JS served directly by Express
