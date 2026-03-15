# Strategy-Driven Scanner Refactor

**Date**: 2026-02-13 (revised 2026-02-13)
**Scope**: Refactor the Wyckoff-specific scanner into a general-purpose hypothesis scanner driven by StrategySpec objects.
**Status**: Implemented + Hardened (6 architectural fixes applied)

---

## 1. Problem Statement

The scanner was Wyckoff-specific. All detection thresholds were hardcoded in `patternScanner.py`. There was no concept of a "strategy version" — candidates had no link to the configuration that produced them. The goal was to make the scanner accept a versioned `StrategySpec` object, run it via a plugin architecture, and return candidates with rule-checklists, anchors, and scores.

---

## 2. Files Changed

### 2.1 New Files (4)

| File | Lines | Purpose |
|------|-------|---------|
| `backend/src/types/strategy.ts` | 193 | Canonical type definitions: `StrategySpec`, `StructureConfig`, `SetupConfig`, `EntryConfig`, `RiskConfig`, `ExitConfig`, `CostConfig`, `RuleCheckItem`, `AnchorPoint`, `CandidateAnchors`, `StrategyCandidate` |
| `backend/src/routes/strategies.ts` | 142 | REST API for strategy CRUD: `GET /api/strategies`, `GET /api/strategies/:id`, `POST /api/strategies`, `PATCH /api/strategies/:id/status` |
| `backend/services/strategyRunner.py` | 677 | Python strategy runner: `extract_structure()`, `run_wyckoff_plugin()`, `run_strategy()`, plugin registry, CLI entry point |
| `backend/data/strategies/wyckoff_accumulation_v1.json` | 62 | Default Wyckoff spec — pre-approved, all thresholds externalized |

### 2.2 Modified Files (6)

| File | What Changed |
|------|-------------|
| `backend/src/types/index.ts` | Added `export * from './strategy'` at top. Removed the old inline `StrategySpec` interface (55 lines). Added `strategyVersionId`, `strategyId`, `scanScope` fields to `ScanRequest`. |
| `backend/src/services/storageService.ts` | Added `StrategyCandidate` to imports. Added 3 new functions: `getLatestApprovedStrategy()`, `saveStrategyCandidate()`, `saveStrategyCandidates()`. |
| `backend/src/routes/candidates.ts` | Added `fs` import. Added `resolveStrategy()` helper (resolves spec from request params). Added `runStrategyRunner()` helper (spawns Python process with temp spec file). Rewrote `POST /scan` into a two-path architecture: strategy-driven path (for wyckoff + explicit strategy) and legacy path (for swing/fib-energy/copilot/discount). Updated `POST /scan-batch` to use strategy runner for wyckoff mode. |
| `backend/src/server.ts` | Added `import strategiesRouter from './routes/strategies'`. Added `app.use('/api/strategies', strategiesRouter)`. |
| `frontend/public/index.html` | Added strategy selector dropdown (`#scan-strategy`), scope selector (`#scan-scope`), `onchange="onScanModeChange()"` on mode select. Added strategy badge bar (`#candidate-strategy-bar`) with `#info-strategy-badge`, `#info-entry-ready`, `#info-rules-summary`. Added rule checklist panel (`#rule-checklist-panel`, `#rule-checklist-items`). |
| `frontend/public/index.js` | Added `loadStrategies()`, `populateStrategySelect()`, `onScanModeChange()` functions. Updated `runScan()` to include `strategyVersionId` and `scanScope` in request body. Updated `showCandidate()` to display strategy badge, entry-ready indicator, and rule checklist items. Updated `renderCandidatesPage()` to show `strategy_version_id` badge, entry-ready dot, and rule pass/fail count on each candidate card. |

### 2.3 Unchanged Files

| File | Reason |
|------|--------|
| `backend/services/patternScanner.py` | Not modified. Still used for legacy scan modes (swing, fib-energy, copilot, discount). The strategy runner imports functions from it. |
| `backend/src/routes/validator.ts` | Not modified. Existing mock strategies use the old flat-params shape — still valid because `StrategySpec` now has optional legacy fields (`params`, `entry`, `risk`, `costs`). |

---

## 3. Architecture

### 3.1 Data Flow (Strategy-Driven Scan)

```
Frontend (index.js)
  |  POST /api/candidates/scan
  |  { symbol: "SLV", scanMode: "wyckoff", strategyVersionId: "wyckoff_accumulation_v1" }
  v
candidates.ts route handler
  |  resolveStrategy(req) -> loads StrategySpec from JSON file storage
  |  Enforces production/research gate (approved-only in production)
  |  Writes spec to temp file
  v
runStrategyRunner() -> spawns: python strategyRunner.py --spec <tmpfile> --symbol SLV ...
  |
  v
strategyRunner.py
  |  1. Reads spec JSON
  |  2. Fetches OHLCV via yfinance (imported from patternScanner.py)
  |  3. extract_structure(data, spec.structure_config)
  |     -> calls detect_swing_points_with_fallback() or detect_swings_rdp()
  |     -> calls detect_accumulation_bases()
  |     -> returns StructureExtraction { pivots, bases, trend }
  |  4. PLUGINS[spec.setup_config.pattern_type](data, structure, spec, symbol, timeframe)
  |     -> run_wyckoff_plugin() for "wyckoff_accumulation"
  |     -> Runs 6-phase detection: peak -> markdown -> base -> markup -> pullback -> breakout
  |     -> Each phase appends to rule_checklist
  |     -> Returns StrategyCandidate[] with anchors + rule_checklist + score + entry_ready
  |  5. Outputs JSON to stdout
  v
candidates.ts
  |  Parses JSON output
  |  Saves candidates via storage.saveStrategyCandidates()
  |  Returns response with strategy_version_id, strategy_status, strategy_name
  v
Frontend (index.js)
  |  Displays candidate with strategy badge, entry_ready indicator, rule checklist
```

### 3.2 Data Flow (Legacy Scan — unchanged)

```
Frontend -> POST /api/candidates/scan { scanMode: "swing" }
  -> candidates.ts legacy path -> spawns python patternScanner.py --swing ...
  -> Returns raw swing data (no strategy metadata)
```

### 3.3 Strategy Resolution Priority

In `resolveStrategy()`:
1. If `strategyVersionId` is provided -> load that exact version
2. If `strategyId` is provided -> find latest approved version (production) or latest any version (research)
3. If `scanMode === 'wyckoff'` and no strategy specified -> load the default `wyckoff_accumulation_v1` spec (auto-seeds if not in storage)

### 3.4 Production vs Research Gate

- `scanScope: "production"` (default): Only `status === "approved"` strategies can run. Exception: explicit `strategyVersionId` bypasses this check.
- `scanScope: "research"`: Any status (draft/testing/approved/rejected) allowed.

---

## 4. Schema Definitions

### 4.1 StrategySpec (TypeScript — strategy.ts)

```typescript
interface StrategySpec {
  strategy_id: string;              // e.g. "wyckoff_accumulation"
  version: number | string;
  strategy_version_id: string;      // "{strategy_id}_v{version}" — unique key / filename
  status: StrategyStatus;           // 'draft' | 'testing' | 'approved' | 'rejected'
  name: string;
  description: string;
  scan_mode?: string;               // legacy compat
  trade_direction?: string;
  timeframe?: string;
  timeframes?: string[];            // legacy compat
  universe: string[];
  structure_config?: StructureConfig;
  setup_config?: SetupConfig;
  entry_config?: EntryConfig;
  risk_config?: RiskConfig;
  exit_config?: ExitConfig;
  cost_config?: CostConfig;
  params?: { ... };                 // legacy compat
  entry?: { ... };                  // legacy compat
  risk?: { ... };                   // legacy compat
  costs?: { ... };                  // legacy compat
  created_at: string;
  updated_at: string;
  created_by?: string;
  notes?: string;
}
```

### 4.2 StrategyCandidate (TypeScript — strategy.ts)

```typescript
interface StrategyCandidate {
  candidate_id: string;             // "{symbol}_{tf}_{strategy_version_id}_{peak}_{brk}"
  strategy_version_id: string;
  symbol: string;
  timeframe: string;
  score: number;
  entry_ready: boolean;
  rule_checklist: RuleCheckItem[];  // [{rule_name, passed, value, threshold}]
  anchors: CandidateAnchors;       // {prior_peak, markdown_low, base_start, ...}
  window_start: number;
  window_end: number;
  created_at: string;
  model_version?: string;
  chart_data?: any[];
  // 12 legacy compat fields (id, pattern_type, prior_peak, markdown, base, etc.)
}
```

### 4.3 RuleCheckItem

```typescript
interface RuleCheckItem {
  rule_name: string;    // e.g. "markdown_decline", "base_duration", "second_breakout"
  passed: boolean;
  value: any;           // actual measured value
  threshold: any;       // spec threshold (number, or [min, max] for ranges)
}
```

### 4.4 StructureExtraction (Python — strategyRunner.py)

```python
@dataclass
class StructureExtraction:
    pivots: List[Dict]    # [{index, price, date, type: "HIGH"|"LOW"}]
    bases: List[Dict]     # [{start_index, end_index, high, low, height, duration, start_date, end_date}]
    trend: str            # "UPTREND" | "DOWNTREND" | "SIDEWAYS"
```

---

## 5. API Endpoints

### 5.1 New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/strategies` | List all strategies. Query params: `?status=approved`, `?strategy_id=wyckoff_accumulation` |
| `GET` | `/api/strategies/:id` | Get a specific strategy version |
| `POST` | `/api/strategies` | Create new strategy version (auto-increments version number) |
| `PATCH` | `/api/strategies/:id/status` | Update status (draft/testing/approved/rejected) |

### 5.2 Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/api/candidates/scan` | Now accepts `strategyVersionId`, `strategyId`, `scanScope`. Routes wyckoff scans through strategy runner. |
| `POST` | `/api/candidates/scan-batch` | Now routes wyckoff batch scans through strategy runner. |

### 5.3 Scan Request Contract (updated)

```json
{
  "symbol": "SLV",
  "timeframe": "W",
  "period": "max",
  "interval": "1wk",
  "scanMode": "wyckoff",
  "strategyVersionId": "wyckoff_accumulation_v1",
  "strategyId": "wyckoff_accumulation",
  "scanScope": "production",
  "skipSave": false,
  "minMarkdown": 0.70,
  "minRetracement": 0.30,
  "maxRetracement": 5.0,
  "swingEpsilon": 0.05
}
```

### 5.4 Scan Response Contract (strategy-driven)

```json
{
  "success": true,
  "data": {
    "count": 1,
    "ids": ["SLV_W_wyckoff_accumulation_v1_261_850"],
    "candidates": [
      {
        "candidate_id": "SLV_W_wyckoff_accumulation_v1_261_850",
        "id": "SLV_W_wyckoff_accumulation_v1_261_850",
        "strategy_version_id": "wyckoff_accumulation_v1",
        "symbol": "SLV",
        "timeframe": "W",
        "score": 0.85,
        "entry_ready": true,
        "rule_checklist": [
          {"rule_name": "markdown_decline", "passed": true, "value": 0.707, "threshold": 0.70},
          {"rule_name": "base_found", "passed": true, "value": 200, "threshold": 20},
          {"rule_name": "base_duration", "passed": true, "value": 200, "threshold": 20},
          {"rule_name": "markup_breakout", "passed": true, "value": 22.0, "threshold": 18.5},
          {"rule_name": "pullback_found", "passed": true, "value": 0.75, "threshold": [0.30, 5.0]},
          {"rule_name": "pullback_retracement", "passed": true, "value": 0.75, "threshold": [0.30, 5.0]},
          {"rule_name": "double_bottom", "passed": false, "value": 16.50, "threshold": 14.91},
          {"rule_name": "second_breakout", "passed": true, "value": 19.20, "threshold": 18.87},
          {"rule_name": "score_above_min", "passed": true, "value": 0.85, "threshold": 0.0}
        ],
        "anchors": {
          "prior_peak": {"index": 261, "price": 48.50, "date": "2011-04-29"},
          "markdown_low": {"index": 450, "price": 14.20, "date": "2015-12-18"},
          "base_start": {"index": 450, "price": 14.20, "date": "2013-06-28"},
          "base_end": {"index": 650, "price": 18.50, "date": "2017-07-14"},
          "base_low": 14.20,
          "base_high": 18.50,
          "markup_high": {"index": 680, "price": 22.00, "date": "2018-01-19"},
          "pullback_low": {"index": 720, "price": 16.50, "date": "2018-11-16"},
          "second_breakout": {"index": 850, "price": 19.20, "date": "2020-07-24"}
        },
        "window_start": 261,
        "window_end": 850,
        "created_at": "2026-02-13T12:00:00Z",
        "pattern_type": "wyckoff",
        "prior_peak": {"index": 261, "price": 48.50, "date": "2011-04-29"},
        "markdown": {"low_index": 450, "low_price": 14.20, "decline_pct": 0.707},
        "base": {"start_index": 450, "end_index": 650, "low": 14.20, "high": 18.50, "height": 4.30, "duration": 200},
        "pullback": {"low_index": 720, "low_price": 16.50, "retracement": 0.75, "is_double_bottom": false},
        "second_breakout": {"index": 850, "price": 19.20, "date": "2020-07-24"},
        "retracement_pct": 75.0
      }
    ],
    "strategy_version_id": "wyckoff_accumulation_v1",
    "strategy_status": "approved",
    "strategy_name": "Wyckoff Accumulation"
  }
}
```

---

## 6. Python Strategy Runner — Function Signatures

```python
def extract_structure(data, structure_config, symbol="UNKNOWN", timeframe="W") -> StructureExtraction

def run_wyckoff_plugin(data, structure, spec, symbol, timeframe) -> List[Dict]

def run_strategy(spec, data, symbol, timeframe, mode='scan') -> List[Dict]

# Plugin registry:
PLUGINS = { 'wyckoff_accumulation': run_wyckoff_plugin }
```

### 6.1 Wyckoff Plugin: Thresholds Read from Spec

Every threshold is read from `spec.setup_config` or `spec.entry_config` with safe defaults:

| Threshold | Spec Key | Default | Used In |
|-----------|----------|---------|---------|
| `min_prominence` | `setup_config.min_prominence` | 0.20 | `find_major_peaks()` |
| `peak_lookback` | `setup_config.peak_lookback` | 50 | `find_major_peaks()` |
| `min_markdown_pct` | `setup_config.min_markdown_pct` | 0.70 | Markdown validation |
| `markdown_lookback` | `setup_config.markdown_lookback` | 300 | Markdown search window |
| `base_min_duration` | `setup_config.base_min_duration` | 20 | Base validation |
| `markup_min_breakout_bars` | `setup_config.markup_min_breakout_bars` | 2 | `detect_markup()` |
| `markup_lookforward` | `setup_config.markup_lookforward` | 100 | `detect_markup()` |
| `pullback_retracement_min` | `setup_config.pullback_retracement_min` | 0.30 | `detect_second_pullback()` |
| `pullback_retracement_max` | `setup_config.pullback_retracement_max` | 5.0 | `detect_second_pullback()` |
| `pullback_lookforward` | `setup_config.pullback_lookforward` | 200 | `detect_second_pullback()` |
| `double_bottom_tolerance` | `setup_config.double_bottom_tolerance` | 1.05 | Double bottom check |
| `breakout_multiplier` | `setup_config.breakout_multiplier` | 1.02 | Second breakout level |
| `confirmation_bars` | `entry_config.confirmation_bars` | 1 | Breakout confirmation |
| `score_min` | `setup_config.score_min` | 0.0 | Minimum score filter |

### 6.2 Wyckoff Plugin: Rules Generated

The plugin generates these rule_checklist items per candidate (9 rules):

1. **markdown_decline** — decline_pct >= min_markdown_pct
2. **base_found** — a valid base was detected near markdown low
3. **base_duration** — base.duration >= base_min_duration
4. **markup_breakout** — markup detected above base_high
5. **pullback_found** — pullback detected with valid retracement
6. **pullback_retracement** — retracement within [min, max] range
7. **double_bottom** — pullback_low <= base_low * tolerance
8. **second_breakout** — close above breakout_level with confirmation
9. **score_above_min** — computed score >= score_min

---

## 7. Storage

### 7.1 Strategy Storage

- **Directory**: `backend/data/strategies/`
- **Filename**: `{strategy_version_id}.json` (e.g. `wyckoff_accumulation_v1.json`)
- **Operations**: `saveStrategy()`, `getAllStrategies()`, `getStrategy()`, `updateStrategyStatus()`, `getLatestApprovedStrategy()`

### 7.2 Candidate Storage

- **Directory**: `backend/data/candidates/` (unchanged)
- **Filename**: `{candidate_id}.json`
- **New operations**: `saveStrategyCandidate()`, `saveStrategyCandidates()`
- **Note**: New candidates include `strategy_version_id`, `rule_checklist`, `anchors`, `entry_ready` alongside all legacy fields — both old and new candidates coexist in the same directory.

---

## 8. Frontend Changes

### 8.1 Scan Controls (index.html)

- Added `#scan-strategy` dropdown (hidden by default, shown when mode=wyckoff)
- Added `#scan-scope` dropdown (production/research, hidden by default)
- Added `onchange="onScanModeChange()"` on the mode selector

### 8.2 Candidate Display (index.html + index.js)

- Added `#candidate-strategy-bar` row above basic info showing:
  - Strategy badge with version ID and status-colored border
  - Entry-ready indicator (green "ENTRY READY" or muted "NOT READY")
  - Rules summary ("7/9 rules passed")
- Added `#rule-checklist-panel` below the Wyckoff phases showing each rule as a colored chip with checkmark/cross, rule name, and tooltip with value/threshold

### 8.3 Candidates List (index.js)

- Each candidate card now shows:
  - Strategy version badge (green border)
  - Entry-ready dot
  - Rule pass/fail count (e.g. "7/9")

### 8.4 Strategy Loading (index.js)

- `loadStrategies()` fetches `GET /api/strategies` on page load
- `populateStrategySelect()` populates the dropdown with status icons
- `onScanModeChange()` shows/hides strategy and scope selectors based on scan mode

---

## 9. Backward Compatibility

| Concern | How It's Handled |
|---------|-----------------|
| Old Wyckoff scans (`scanMode: 'wyckoff'`) | Auto-routed through strategy runner using default approved spec |
| Legacy scan modes (swing, fib-energy, copilot, discount) | Still use `patternScanner.py` directly — unchanged |
| Old candidate format in storage | Still readable — `StrategyCandidate` includes all old fields (`prior_peak`, `base`, `pullback`, etc.) |
| Old `StrategySpec` in validator mock data | Still works — `StrategySpec` interface now includes optional legacy fields (`params`, `entry`, `risk`, `costs`) |
| Frontend chart rendering | Unchanged — new candidates populate all `chart_*` index fields and legacy display fields |
| Labeling / Corrections flow | Unchanged — candidates still have `id`, `symbol`, `timeframe`, `score` |

---

## 10. Verification

| Check | Result |
|-------|--------|
| TypeScript compilation (`npx tsc --noEmit`) | Exit code 0 — no errors |
| Python syntax (`ast.parse`) | OK |
| Python imports (`from strategyRunner import ...`) | OK — all imports resolve |
| Linter errors (IDE diagnostics) | None found |
| `patternScanner.py` unchanged | Confirmed — not modified |

---

## 11. What Was Not Done (Intentionally)

- **Backtest mode**: `run_strategy()` accepts `mode='backtest'` but only `'scan'` is implemented. Backtest is deferred to the validator system.
- **New pattern plugins**: Only `wyckoff_accumulation` is registered. Adding Quasimodo/H&S/etc. requires writing a new plugin function and adding it to the `PLUGINS` dict.
- **Volume confirmation**: Not added to the Wyckoff plugin (mirrors existing behavior — this is a known failure mode from the structure reference).
- **Timeframe-adaptive RDP**: Not added (also a known failure mode — same `epsilon_pct` used for all timeframes).

---

## 12. Example StrategySpec JSON (Default Wyckoff)

```json
{
  "strategy_id": "wyckoff_accumulation",
  "version": "1",
  "strategy_version_id": "wyckoff_accumulation_v1",
  "status": "approved",
  "name": "Wyckoff Accumulation",
  "description": "Classic Wyckoff-style accumulation pattern...",
  "timeframe": "1wk",
  "universe": [],
  "structure_config": {
    "swing_method": "major",
    "swing_epsilon_pct": 0.05,
    "swing_left_bars": 10,
    "swing_right_bars": 10,
    "swing_first_peak_decline": 0.50,
    "swing_subsequent_decline": 0.25,
    "base_min_duration": 15,
    "base_max_duration": 500,
    "base_max_range_pct": 0.80,
    "base_volatility_threshold": 0.10
  },
  "setup_config": {
    "pattern_type": "wyckoff_accumulation",
    "min_prominence": 0.20,
    "peak_lookback": 50,
    "min_markdown_pct": 0.70,
    "markdown_lookback": 300,
    "base_min_duration": 20,
    "base_resistance_closes": 3,
    "markup_lookforward": 100,
    "markup_min_breakout_bars": 2,
    "pullback_lookforward": 200,
    "pullback_retracement_min": 0.30,
    "pullback_retracement_max": 5.0,
    "double_bottom_tolerance": 1.05,
    "breakout_multiplier": 1.02,
    "score_min": 0.0
  },
  "entry_config": {
    "trigger": "second_breakout",
    "breakout_pct_above": 0.02,
    "confirmation_bars": 1
  },
  "risk_config": {
    "stop_type": "structural",
    "stop_level": "base_low",
    "stop_buffer_pct": 0.02
  },
  "exit_config": {
    "target_type": "fibonacci",
    "target_level": 0.25,
    "time_stop_bars": null,
    "trailing": null
  },
  "cost_config": {
    "commission_per_trade": 0.0,
    "spread_pct": 0.001,
    "slippage_pct": 0.001
  },
  "created_at": "2026-02-09T00:00:00Z",
  "updated_at": "2026-02-09T00:00:00Z"
}
```

---

## REVISION: 6 Architectural Fixes (2026-02-13)

### Fix 1: Production Gate — No Bypass. Period.

**Problem**: The original code had `!scanRequest.strategyVersionId` as a bypass condition, allowing any explicit version ID to skip the production gate.

**Fix**: Removed the bypass entirely. Production mode (`scanScope="production"`) now enforces TWO conditions:
1. `spec.status === 'approved'`
2. Latest `ValidationReport` for that strategy has `pass_fail === 'PASS'` AND `decision_log.decision === 'approved'`

No exceptions. Research mode (`scanScope="research"`) allows anything.

**Rationale**: If you allow a bypass, your future self will use it the moment you're emotionally attached to a strategy.

**Files changed**: `backend/src/routes/candidates.ts` — both `POST /scan` and `POST /scan-batch` endpoints.

---

### Fix 2: spec_hash — Integrity Fingerprint

**Problem**: No way to verify that a strategy's config hasn't been tampered with. Candidates pointed to a `strategy_version_id` but the underlying config could change silently.

**Fix**: Added `spec_hash` (SHA-256) computed from config-relevant fields only:
- `strategy_id`, `version`, `structure_config`, `setup_config`, `entry_config`, `risk_config`, `exit_config`, `cost_config`
- Excludes metadata: `name`, `description`, `status`, `timestamps`, `notes`

The hash is:
- Computed on save in `storageService.saveStrategy()`
- Attached to the spec JSON file
- Passed to the Python runner via the temp spec file
- Included in every `StrategyCandidate` output
- Included in the `candidate_id` (short prefix)

**TypeScript**: `computeSpecHash()` in `storageService.ts` using `crypto.createHash('sha256')`
**Python**: `compute_spec_hash()` in `strategyRunner.py` using `hashlib.sha256`

**Files changed**: `strategy.ts`, `storageService.ts`, `candidates.ts`, `strategyRunner.py`

---

### Fix 3: Strategy Version Immutability

**Problem**: Nothing prevented in-place edits to a strategy file, which would silently change the logic behind existing candidates.

**Fix**: `storageService.saveStrategy()` now enforces immutability:
- Before overwriting an existing file, it computes the hash of both old and new.
- If the hashes differ, it throws an `Immutability violation` error.
- Metadata-only updates (status changes) pass because the hash is unchanged.
- A `force` parameter exists only for initial seeding and metadata updates.

**Rule**: To change trading logic, create a new version (auto-incremented). Never edit in place.

**Files changed**: `storageService.ts`

---

### Fix 4: Lookahead Bias — Causal Mode Flag

**Problem**: `extract_structure()` runs RDP and base detection over the entire dataset. Pivots computed with full-series RDP "see the future" — swing points depend on bars that haven't happened yet. This is fine for scanning (finding current candidates) but is FATAL for backtesting.

**Fix**:
- Added `causal?: boolean` to `StructureConfig` interface.
- In `strategyRunner.py`, `extract_structure()` now checks `causal`:
  - `causal=False` (default): Full-series processing. OK for scan mode.
  - `causal=True`: Raises `NotImplementedError` with an explicit warning. Backtest mode CANNOT run until walk-forward extraction is implemented.
- The default Wyckoff spec has `causal: false` explicitly set.

**What "causal" means**: At time t, you may only use bars[0..t]. Confirmations require waiting for confirmation_bars. No peeking.

**Files changed**: `strategy.ts`, `strategyRunner.py`, `wyckoff_accumulation_v1.json`

---

### Fix 5: Deduplicate Threshold Fields

**Problem**: `base_min_duration` existed in both `structure_config` (line 27 of old spec) and `setup_config` (line 41). Two different values (15 vs 20). No clarity on which one wins. The Wyckoff plugin read from `setup_config` while the structure extractor read from `structure_config`.

**Fix**: Single canonical location per concept:

| Concept | Canonical Location | Removed From |
|---------|-------------------|--------------|
| `base_min_duration` | `structure_config` | `setup_config` |
| All swing params | `structure_config` | — |
| All pattern-specific params | `setup_config` | — |

**Rule**:
- `structure_config` = generic detectors (swings, bases) shared by many strategies
- `setup_config` = pattern-specific logic (markdown %, pullback range, breakout multiplier)

The Wyckoff plugin now reads `base_min_dur` from `structure_config`, not `setup_config`. The old spec's `structure_config.base_min_duration` was updated from 15 to 20 (the intended value).

**Files changed**: `strategy.ts`, `strategyRunner.py`, `wyckoff_accumulation_v1.json`

---

### Fix 6: Standardize timeframe vs interval

**Problem**: Three different conventions in the same request:
- `timeframe: "W"` (display label)
- `interval: "1wk"` (yfinance format)
- `StrategySpec.timeframe: "1wk"` (actually an interval)

**Fix**: One canonical key internally: `interval` (yfinance-style: `"1wk"`, `"1d"`, `"4h"`, etc.)

| Key | Purpose | Example |
|-----|---------|---------|
| `interval` | Canonical internal key | `"1wk"` |
| `timeframe` | DEPRECATED display label | `"W"` |

Changes:
- `StrategySpec.interval` is now the canonical field. `timeframe` kept as deprecated alias.
- `StrategyCandidate.interval` added alongside legacy `timeframe`.
- Added `INTERVAL_TO_DISPLAY` and `DISPLAY_TO_INTERVAL` lookup maps in `strategy.ts`.
- Default Wyckoff spec changed from `timeframe: "1wk"` to `interval: "1wk"`.

**Files changed**: `strategy.ts`, `wyckoff_accumulation_v1.json`

---

### Fix 6b: candidate_id Includes spec_hash

**Problem**: `candidate_id` format was `{symbol}_{tf}_{strategy_version_id}_{peak}_{brk}`. If anyone edits a spec in place (even by mistake), the same candidate_id maps to different logic. That's data corruption.

**Fix**: New format: `{symbol}_{tf}_{strategy_version_id}_{spec_hash_short}_{peak}_{brk}`

Where `spec_hash_short` is the first 12 characters of the SHA-256 hash. Combined with the immutability enforcement, this creates a belt-and-suspenders defense.

**Files changed**: `strategyRunner.py`

---

### Summary of All Changes

| File | Fixes Applied |
|------|--------------|
| `backend/src/types/strategy.ts` | 2 (spec_hash), 4 (dedup), 5 (interval), 3 (causal) |
| `backend/src/services/storageService.ts` | 2 (computeSpecHash), 3 (immutability) |
| `backend/src/routes/candidates.ts` | 1 (production gate), 2 (spec_hash passthrough) |
| `backend/services/strategyRunner.py` | 2 (compute_spec_hash), 3 (causal guard), 4 (dedup), 6b (candidate_id) |
| `backend/data/strategies/wyckoff_accumulation_v1.json` | 4 (dedup), 5 (interval), 3 (causal) |

### Verification

| Check | Result |
|-------|--------|
| TypeScript compilation (`npx tsc --noEmit`) | Exit code 0 |
| Python syntax (`ast.parse`) | OK |
| Linter errors | None |

### Remaining Work (Intentionally Deferred)

| Item | Why Deferred |
|------|-------------|
| Causal walk-forward extraction | Requires incremental pivot/base detection rewrite. Backtest mode throws `NotImplementedError` until this is done. |
| DB storage for strategies | Filesystem is fine for now. `spec_hash` + immutability enforcement provide the integrity guarantees. DB migration is a separate task. |
| Audit trail (who changed what, when) | Requires user auth system. Currently tracked via `created_by` + `updated_at` fields. |
| `interval` migration across all scan request paths | Legacy paths still use both `timeframe` and `interval`. Full migration is incremental.
Honestly? No. It's a well-structured prototype with some good architectural ideas, but it's not production-grade. Let me give you the real assessment.
What IS solid:
The spec-driven plugin architecture is the right pattern
spec_hash + immutability is a real integrity mechanism
The production gate requiring ValidationReport PASS is strict (good)
Rule checklists make the scanner's reasoning transparent and auditable
The separation of structure_config vs setup_config is clean
What is NOT production-grade:
Tier 1 — Would break in real use:
File-based storage with no concurrency control. Two simultaneous scans can corrupt the same candidate file. No transactions, no locking, no atomicity. Production uses a database — even SQLite would be a massive step up.
Spawning a Python child process per scan. Every single scan forks python strategyRunner.py, which means Python startup overhead, no connection pooling for data, no resource management. If you batch-scan 50 symbols, that's 50 Python processes in sequence. Production would be a Python microservice with a persistent process, or a job queue.
No authentication or authorization. Anyone who can hit localhost:3000 can approve strategies, trigger production scans, delete all candidates. There is zero access control.
The backtest path throws NotImplementedError. The production gate requires a ValidationReport — but you can't generate a ValidationReport without backtesting — and backtest mode literally crashes. So the whole pipeline is incomplete. You can only bypass it with Research mode.
The spec hash may not match between TypeScript and Python. JSON.stringify with sorted keys in JavaScript and json.dumps(sort_keys=True) in Python can produce different output for the same data (number formatting, null vs None, float precision). If the hashes diverge, your integrity chain breaks silently.
Tier 2 — Would fail a code review:
No input validation. The API accepts whatever JSON you throw at it. No schema validation (Zod, Joi, Pydantic). A malformed spec could propagate silently through the entire pipeline.
Scoring function has hardcoded magic numbers. _score_wyckoff() uses weights like 0.40, 0.30, 0.25 that aren't in the spec. The entire point of StrategySpec is to externalize parameters — but the scoring model is still baked into code.
No tests. Zero. No unit tests, no integration tests, no contract tests. "Does it compile?" is the lowest possible verification bar.
No structured logging or monitoring. console.log('[Scanner]', ...) and print(..., file=sys.stderr) is debugging, not observability. No request tracing, no metrics, no alerting.
No retry, no queue, no backpressure. If yfinance rate-limits you or the Python process dies, the scan just fails. No retry logic, no dead letter queue. Nothing prevents launching 100 concurrent scans and crashing the machine.
Tier 3 — Design debt that will compound:
Two parallel scan paths. The "strategy runner" path and the "legacy patternScanner.py" path will drift. Bugs fixed in one won't be fixed in the other. Eventually you won't know which path produced which candidate.
yfinance as a production data source. Yahoo Finance has no SLA, rate-limits aggressively, changes its API without notice, and occasionally returns bad data. Production systems have their own data pipeline with validation.
Frontend is a single vanilla JS file with global state, no type safety, and presumably thousands of lines. Any UI change is fragile.
Unversioned API. One breaking change to /api/candidates/scan breaks every client.
Where you actually are on the spectrum:
Proof of concept → [YOU ARE HERE] → Personal tool → Alpha → Beta → Production                    ▲                    Well-structured prototype                    with good architectural bones
The architectural thinking is ahead of the engineering. You have the right abstractions (StrategySpec, plugin registry, rule checklists, spec_hash) but the infrastructure around them is prototype-level.
If you want to move toward production, the highest-leverage next steps are:
Get backtest working (causal mode) — without this, the entire validation pipeline is broken and the production gate is a wall you can't get past legitimately.
Add a real database — even SQLite via better-sqlite3. Gives you transactions, queries, and actual audit trails.
Add input validation — Zod schemas for every API endpoint.
Write tests for the strategy runner — feed it known data, assert expected candidates.
Verify spec_hash parity between TypeScript and Python with a shared test fixture.