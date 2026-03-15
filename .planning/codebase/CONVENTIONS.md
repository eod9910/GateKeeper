# Coding Conventions

**Analysis Date:** 2026-02-09

## Naming Patterns

### Files
- **TypeScript route files:** camelCase (`candidates.ts`, `savedCharts.ts`, `labels.ts`) in `backend/src/routes/`
- **TypeScript service files:** camelCase (`storageService.ts`, `visionService.ts`) in `backend/src/services/`
- **Type definition barrel:** `backend/src/types/index.ts` (single barrel file)
- **Python files:** snake_case (`patternScanner.py`) in `backend/services/`
- **Frontend HTML:** kebab-case (`copilot.html`, `history.html`, `index.html`) in `frontend/public/`
- **Frontend JS:** matching HTML name (`index.js`, `copilot.js`, `history.js`) in `frontend/public/`
- **Frontend CSS:** matching HTML name (`index.css`, `copilot.css`, `history.css`) in `frontend/public/`

### Functions (TypeScript)
- camelCase for all functions: `saveCandidate()`, `getAllLabels()`, `getUnlabeledCandidates()`
- Async functions use `async`/`await` throughout (no raw `.then()` chains)
- Prefixes follow CRUD conventions: `save*`, `get*`, `getAll*`, `delete*`, `clear*`, `update*`

### Functions (Python)
- snake_case: `detect_swing_highs_lows()`, `pixel_to_chart_coords()`
- Standard Python naming throughout

### Functions (Frontend JS)
- camelCase: `clearChart()`, `initPatternChart()`, `pixelToChartCoords()`
- Global function scope (no modules, loaded via `<script src="page.js">`)

### Variables
- **TypeScript:** camelCase for locals (`scanRequest`, `candidates`), SCREAMING_SNAKE for constants (`DATA_DIR`, `CANDIDATES_DIR`)
- **Python:** snake_case for locals, SCREAMING_SNAKE for module-level constants (`HAS_YFINANCE`, `HAS_PANDAS`)
- **Frontend JS:** camelCase globals (`patternChart`, `patternSeries`, `currentIndex`, `swingReviewMode`)

### Types/Interfaces
- PascalCase for all TypeScript interfaces and types: `PatternCandidate`, `ApiResponse<T>`, `LabelType`, `ScanRequest`
- Python uses `@dataclass` with PascalCase class names: `OHLCV`, `Base`, `Markup`, `PatternCandidate`

### API Routes
- Kebab-case for multi-word URL segments: `/api/saved-charts`, `/api/candidates/scan-batch`
- RESTful patterns: `GET /`, `GET /:id`, `POST /`, `DELETE /:id`

## Code Style

### Formatting
- **No formatter config files** (no `.prettierrc`, `.editorconfig`, or `.eslintrc` at project level)
- **Indentation:** 2 spaces (TypeScript/JS), 4 spaces (Python) — consistent throughout
- **Semicolons:** Always used in TypeScript
- **Quotes:** Single quotes in TypeScript imports and strings
- **Trailing commas:** Not consistently used
- **Line length:** No enforced limit; lines tend to stay under ~120 chars

### TypeScript Configuration (`backend/tsconfig.json`)
- Target: **ES2020**
- Module: **CommonJS**
- **Strict mode enabled** (`"strict": true`)
- `esModuleInterop: true` — allows default imports from CJS modules
- `resolveJsonModule: true`
- `declaration: true` — generates `.d.ts` files
- Source in `./src`, output to `./dist`

### Linting
- **No linting tools configured** at the project level
- No ESLint, Prettier, or similar in `devDependencies`

## Import Organization

### TypeScript Pattern (observed in all backend files)
1. **External packages first** (`express`, `cors`, `dotenv`, `path`, `child_process`)
2. **Internal modules second** (`./routes/candidates`, `../services/storageService`)
3. **Type imports mixed** with value imports (not using `import type`)
4. No blank lines between import groups (single block)

Example from `backend/src/server.ts`:
```
import dotenv from 'dotenv';          // external
import express from 'express';         // external
import cors from 'cors';              // external
import path from 'path';              // node built-in
import candidatesRouter from './routes/candidates';  // internal
```

### Python Pattern (observed in `backend/services/patternScanner.py`)
1. Standard library (`argparse`, `json`, `sys`, `datetime`, `typing`, `dataclasses`, `os`)
2. Optional third-party with try/except guard (`yfinance`, `pandas`, `numpy`)
- Graceful degradation pattern: sets `HAS_YFINANCE = True/False` flag

### Path Aliases
- **None configured.** All imports use relative paths (`../services/storageService`, `./routes/candidates`)

## Error Handling

### TypeScript Route Pattern (consistent across all route files)
Every route handler follows this exact pattern:
```typescript
router.get('/', async (req: Request, res: Response) => {
  try {
    // ... business logic ...
    res.json({ success: true, data: result } as ApiResponse<T>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});
```

Key conventions:
- **All handlers wrapped in try/catch** — no unhandled promise rejections
- **`error: any` type assertion** — no custom error types
- **Consistent response envelope:** `{ success: boolean, data?: T, error?: string }` via `ApiResponse<T>`
- **HTTP status codes used:** 400 (validation), 404 (not found), 500 (server error)
- **Validation returns early** with 400 status before business logic
- **No global error middleware** — each route handles its own errors

### TypeScript Storage Service Pattern
- File-not-found errors checked via `err.code === 'ENOENT'` and return `null` or `false`
- Other errors re-thrown with `throw err`

### Python Pattern
- Optional imports wrapped in `try/except ImportError` with boolean flags
- No structured error handling framework

### Frontend JS
- API calls use `fetch()` with no visible try/catch in external JS files (prototype-level)

## Logging

### Framework
- **No logging framework.** Uses bare `console.log()` and `console.error()` throughout.

### Patterns
- **Prefixed context tags:** `[Scanner]`, `[Batch Scan]` in `backend/src/routes/candidates.ts`
- **Startup banner:** ASCII art box in `backend/src/server.ts` with endpoint listing
- **Debug logging in services:** `console.log()` calls in `backend/src/services/visionService.ts` for tracing AI provider flow
- **stderr passthrough:** Python scanner stderr piped directly to `console.log('[Scanner]', ...)`

### What's Missing
- No structured logging (no JSON logs, no log levels)
- No request logging middleware (no `morgan` or similar)
- No log correlation IDs

## Comments

### TypeScript
- **JSDoc-style block comments** on every route handler and service function:
  ```typescript
  /**
   * GET /api/candidates
   * List all candidates (sorted by score)
   */
  ```
- **File-level doc blocks** at top of each file:
  ```typescript
  /**
   * Pattern Storage Service (TypeScript)
   * 
   * Stores pattern candidates and user labels in JSON files.
   */
  ```
- **Inline comments** for non-obvious logic: `// Sort by score descending`, `// Remove data URL prefix if present`
- **Section dividers** in large files:
  ```typescript
  // =====================
  // CORRECTIONS (like handwriting corrections)
  // =====================
  ```
- **No TODO/FIXME comments** found in backend TypeScript code

### Python
- Module-level docstring with usage examples
- Dataclass fields have inline comments: `duration: int  # bars`, `retracement: float  # 0.0 - 1.0`
- Function docstrings use Google-style format with `Returns:` sections

### Frontend JS
- Comments for state variable groups and function purposes
- No JSDoc on frontend functions

## Function Design

### Size
- Route handlers: 10-50 lines (compact, single-responsibility)
- Storage service functions: 10-25 lines each (small, focused CRUD)
- Python scanner functions: 20-80 lines (more complex algorithmic logic)
- Frontend functions: Variable, some very long (prototype code)

### Parameters
- TypeScript: Typed parameters with Express `Request`/`Response`
- Service functions use domain types (`PatternCandidate`, `LabelType`)
- Default parameter values: `notes: string = ''`, `userId || 'default'`
- `Omit<>` utility type used for partial inputs: `Omit<PatternCorrection, 'id' | 'timestamp'>`

### Return Values
- Service functions return typed values: `Promise<string>` (id), `Promise<PatternCandidate | null>`, `Promise<boolean>`
- Route handlers always respond with `ApiResponse<T>` envelope
- Python functions use `Tuple` and `List` return types with `typing` module

### Async Pattern
- All TypeScript service functions and route handlers are `async`
- Python scanner is synchronous (CLI tool spawned as child process)
- Child process communication via `spawn()` with stdout/stderr event handlers

## Module Design

### Exports
- **Route files:** Single default export of `Router` instance (`export default router`)
- **Storage service:** Named exports for every function (`export async function saveCandidate(...)`)
- **Types:** Named exports for all interfaces/types from `backend/src/types/index.ts`
- **Vision service:** Mix of named exports (functions) and exported interfaces

### Import Style
- Routes import storage as namespace: `import * as storage from '../services/storageService'`
- Types destructured: `import { PatternCandidate, ApiResponse } from '../types'`
- Express destructured: `import { Router, Request, Response } from 'express'`

### Barrel Files
- Single barrel file at `backend/src/types/index.ts` for all type definitions
- No barrel files for routes or services — each imported individually

### Module Boundaries
- **Routes** → call **Services** → read/write **file system** (JSON files in `backend/data/`)
- **Routes** → spawn **Python scanner** as child process
- **Frontend** → calls **Routes** via `fetch()` to same-origin API
- No dependency injection; services instantiate their own dependencies
