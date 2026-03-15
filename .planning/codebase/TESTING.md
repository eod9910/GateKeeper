# Testing Patterns

**Analysis Date:** 2026-02-09

## Test Framework

### Current State: No Tests Exist

- **Zero test files found** — no `*.test.*`, `*.spec.*`, or `__tests__/` directories anywhere in the project.
- **No test runner configured** — no Jest, Mocha, Vitest, or pytest in dependencies.
- **No test scripts** in `backend/package.json` (only `build`, `start`, `dev`, `scan`).
- **No pytest configuration** — no `pytest.ini`, `pyproject.toml`, or `conftest.py`.
- **No CI/CD pipeline** — no `.github/workflows/`, no test automation.

This is expected for a prototype/vibe-coded project.

## Test File Organization

### Recommended Structure (not yet implemented)

```
backend/
├── src/
│   ├── routes/
│   │   └── __tests__/            # Route handler tests
│   │       ├── candidates.test.ts
│   │       ├── labels.test.ts
│   │       └── corrections.test.ts
│   ├── services/
│   │   └── __tests__/            # Service unit tests
│   │       ├── storageService.test.ts
│   │       └── visionService.test.ts
│   └── types/
│       └── __tests__/
│           └── types.test.ts     # Type validation tests
├── services/
│   └── __tests__/                # Python scanner tests
│       ├── test_patternScanner.py
│       └── conftest.py
ml/
├── tests/
│   ├── test_train_classifier.py
│   └── test_predict.py
```

### Naming Convention (recommended)
- TypeScript: `*.test.ts` colocated in `__tests__/` folders
- Python: `test_*.py` in `__tests__/` or `tests/` folders

## Current Test Coverage

### What Exists
- **Nothing.** No automated tests of any kind.

### What's Manually Tested
Based on code evidence:
- `DELETE /api/candidates` route is labeled `"for testing"` — suggests manual testing via API calls
- `DELETE /api/labels/all` is described as `"nuclear option"` — another manual testing aid
- Python scanner has a CLI interface (`--symbol`, `--timeframe`) enabling manual execution
- Frontend is tested by running the dev server and interacting via browser

## Recommendations

### Priority 1: Backend Service Tests (Highest Value)

**Target:** `backend/src/services/storageService.ts`

This file is pure logic with file system I/O — the most testable and highest-risk code.

| Function | What to Test |
|---|---|
| `saveCandidate()` | Creates JSON file, assigns UUID, sets `createdAt` |
| `getCandidate()` | Returns data for valid ID, returns `null` for missing |
| `getAllCandidates()` | Returns sorted array, handles empty directory |
| `saveLabel()` | Validates and persists label data |
| `getUnlabeledCandidates()` | Correctly filters out already-labeled candidates |
| `getStats()` | Accurate counts for each label type |
| `saveCorrection()` | Persists correction with generated ID/timestamp |
| `saveTrade()` / `updateTrade()` | CRUD operations on trade records |

**Setup needed:**
- Install Jest + ts-jest: `npm install -D jest ts-jest @types/jest`
- Add `jest.config.ts` with `preset: 'ts-jest'`
- Add `"test": "jest"` script to `backend/package.json`
- Use temp directories for test isolation (mock `DATA_DIR`)

### Priority 2: Route Handler Tests (API Contract)

**Target:** `backend/src/routes/candidates.ts`, `backend/src/routes/labels.ts`

| Test Case | What to Verify |
|---|---|
| `GET /api/candidates` | Returns `{ success: true, data: [...] }` envelope |
| `POST /api/candidates/scan` | Returns 400 if no symbol provided |
| `POST /api/labels` | Returns 400 for invalid label value |
| `POST /api/labels` | Returns 404 if candidate doesn't exist |
| `DELETE /api/labels/:id` | Returns 404 for missing label |

**Setup needed:**
- Install Supertest: `npm install -D supertest @types/supertest`
- Import `app` from `backend/src/server.ts` (already exported as default)
- Mock `storageService` to avoid file system side effects

### Priority 3: Python Scanner Tests

**Target:** `backend/services/patternScanner.py`

| Function | What to Test |
|---|---|
| `detect_swing_highs_lows()` | Known pivot detection on synthetic OHLCV data |
| Base/Markup/Pullback detection | Pattern detection on hand-crafted price sequences |
| CLI argument parsing | Correct `argparse` behavior for all scan modes |
| JSON output format | Valid JSON output matching TypeScript `PatternCandidate` interface |

**Setup needed:**
- Install pytest: `pip install pytest`
- Add `pytest.ini` or `[tool.pytest.ini_options]` in a `pyproject.toml`
- Create synthetic OHLCV datasets as fixtures
- Test CLI via `subprocess` or by importing functions directly

### Priority 4: Frontend Smoke Tests (Lower Priority)

The frontend is vanilla HTML/JS with no build step — traditional unit testing is difficult. Options:
- **Playwright/Puppeteer E2E tests** to verify key flows (scan → label → save)
- **API integration tests** that exercise the full stack

### What NOT to Test (Low Value)

- `clearCandidates()`, `clearLabels()`, `clearCorrections()` — simple delete loops, low risk
- Vision service internals — depends on external AI APIs (OpenAI/Ollama), better tested via integration/mocks
- Frontend CSS/layout — prototype UI, changes frequently

### Recommended `package.json` Test Script Addition

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

### Recommended `jest.config.ts`

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};

export default config;
```
