# Unified Symbol Catalog

**Date:** 2026-02-13
**Status:** READY TO IMPLEMENT
**Priority:** Medium-High — fixes Validator empty categories, eliminates triple symbol list duplication

---

## The Problem

There are three separate symbol lists that don't talk to each other:

- **Scanner** (`frontend/public/index.js`, lines 2208-2270): hardcoded `symbolLists` object with ~200+ symbols including a `smallcaps` category
- **Co-Pilot** (`frontend/public/copilot.js`, lines 108-115): hardcoded `COPILOT_SYMBOL_LISTS` — a manual copy of the Scanner list (comment says "kept in sync with index.js")
- **Validator** run modal (`frontend/public/validator.js`, line 219): loads from `GET /api/candidates/symbols` which reads `backend/services/symbols.json` — only ~37 ETFs, no small caps, no futures

When a symbol is added to one list, the others don't know. The Validator's "Small Caps" category is empty because `symbols.json` was never updated with those tickers.

## Current Data Flow

```
Scanner (index.js)     --> hardcoded symbolLists          (200+ symbols, has small caps)
Co-Pilot (copilot.js)  --> hardcoded COPILOT_SYMBOL_LISTS (manual copy of Scanner)
Validator (validator.js) --> GET /api/candidates/symbols --> backend/services/symbols.json (37 ETFs only)
```

Three sources. No connection between them. Small caps only exist in the Scanner/Co-Pilot hardcoded lists.

## Target Data Flow

```
Scanner (index.js)       --\
Co-Pilot (copilot.js)    ---+--> GET /api/candidates/symbols --> backend/data/symbols.json (ALL symbols)
Validator (validator.js) --/
```

One source of truth. All pages load from the same API endpoint.

---

## Files To Change

| File | What Changes |
|------|-------------|
| `backend/services/symbols.json` | Move to `backend/data/symbols.json`, add ALL categories (futures, smallcaps) with all tickers from Scanner's hardcoded list |
| `backend/src/routes/candidates.ts` | Update `GET /symbols` path to read from new location |
| `frontend/public/index.js` | Remove hardcoded `symbolLists` (~60 lines). Load from API on init. Wire autocomplete + batch scan to use loaded data |
| `frontend/public/copilot.js` | Remove hardcoded `COPILOT_SYMBOL_LISTS` (~10 lines). Load from API on init. Wire autocomplete to use loaded data |
| `frontend/public/validator.js` | Update API path if endpoint changes. Otherwise minimal — it already loads from API |
| `backend/services/validatorPipeline.py` | Fix the `[] or ["SPY","QQQ"]` falsy bug (line 231) |

---

## Implementation Details

### Step 1: Build the master `symbols.json`

Move `backend/services/symbols.json` to `backend/data/symbols.json`. Merge in ALL symbols from the Scanner's hardcoded `symbolLists` (lines 2208-2270 of `index.js`), which is the most complete list. The format stays the same categorized object:

```json
{
  "description": "Master symbol catalog — single source of truth for all pages",
  "commodities": ["SLV", "GLD", "USO", "UNG", "CPER", "PALL", "PPLT", "DBA", "DBC"],
  "futures": ["MES=F", "MNQ=F", "MYM=F", "MCL=F", "MGC=F", "M6E=F", "M6B=F"],
  "indices": ["SPY", "QQQ", "IWM", "DIA", "VTI"],
  "sectors": ["XLF", "XLE", "XLK", "XLV", "XLI", "XLB", "XLU", "XLP", "XLY", "XLRE"],
  "international": ["EEM", "EFA", "FXI", "EWJ", "EWZ", "EWG"],
  "bonds": ["TLT", "IEF", "HYG", "LQD"],
  "smallcaps": [
    "... paste ALL ~200 tickers from index.js symbolLists.smallcaps ..."
  ],
  "all": [
    "... every symbol from all categories above, deduped and sorted ..."
  ]
}
```

**IMPORTANT:** Use `"smallcaps"` (no underscore) as the key name — NOT `"small_caps"`. The Scanner's hardcoded list uses `smallcaps` as the category key, and the batch scan dropdown `#scan-category` has `<option value="smallcaps">`. If you change this key name, the batch scan dropdown breaks. The Validator's `normalizeSymbolCatalog()` already handles both `"smallcaps"` and `"small_caps"` (lines 250-251 of `validator.js`), so either works on that side.

**Source of truth for the tickers:** Copy them directly from `frontend/public/index.js`, the `symbolLists` object starting at line 2208. That's the most complete list.

### Step 2: Update the API endpoint path

**File:** `backend/src/routes/candidates.ts`, the `GET /symbols` route (line 226)

**Current code:**
```typescript
const symbolsPath = path.join(__dirname, '..', '..', '..', 'services', 'symbols.json');
```

**Change to:**
```typescript
const symbolsPath = path.join(__dirname, '..', '..', 'data', 'symbols.json');
```

The endpoint URL stays the same (`GET /api/candidates/symbols`) — no frontend changes needed for the Validator.

### Step 3: Wire the Scanner to load from API

**File:** `frontend/public/index.js`

**3a. Remove the hardcoded `symbolLists`**

Delete the entire `symbolLists` object (lines 2208-2270, ~60 lines). Replace with an empty default:

```javascript
let symbolLists = {
  commodities: [], futures: [], indices: [], sectors: [],
  international: [], bonds: [], smallcaps: [], all: []
};
```

**3b. Add `loadSymbolCatalog()` function**

```javascript
async function loadSymbolCatalog() {
  try {
    const res = await fetch('/api/candidates/symbols');
    const json = await res.json();
    if (json.success && json.data) {
      const raw = json.data;
      // Build the same shape as the old hardcoded object
      const cats = {};
      const allSet = new Set();
      for (const [key, val] of Object.entries(raw)) {
        if (!Array.isArray(val)) continue;
        const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (k === 'all' || k === 'description' || k === 'notes') continue;
        cats[k] = val.map(s => String(s).toUpperCase()).filter(Boolean);
        cats[k].forEach(s => allSet.add(s));
      }
      cats.all = Array.from(allSet).sort();
      symbolLists = cats;
    }
  } catch (err) {
    console.warn('Failed to load symbol catalog, using fallback:', err);
    // symbolLists stays as the empty default — user can still type symbols manually
  }
}
```

**3c. Call on page init**

In the Scanner's initialization code (wherever `initSymbolAutocomplete()` is called), add `await loadSymbolCatalog()` before it:

```javascript
await loadSymbolCatalog();
initSymbolAutocomplete();
```

**3d. No changes needed to:**
- `getSymbolsList()` (line 1959) — it already reads from `symbolLists`
- `runBatchScan()` — it already reads `symbolLists[category]`
- `initSymbolAutocomplete()` — it already calls `getSymbolsList()`
- Batch scan `<option>` values in `index.html` — keep them static, they match the JSON keys

### Step 4: Wire the Co-Pilot to load from API

**File:** `frontend/public/copilot.js`

**4a. Remove the hardcoded `COPILOT_SYMBOL_LISTS`**

Delete the object (lines 108-115). Replace with:

```javascript
let COPILOT_SYMBOL_LISTS = {
  commodities: [], futures: [], indices: [], sectors: [],
  international: [], bonds: [], smallcaps: [], all: []
};
```

**4b. Add `loadSymbolCatalog()` function**

Same pattern as the Scanner version above. Could be identical code.

**4c. Call on page init**

In the Co-Pilot's initialization, add `await loadSymbolCatalog()` before `initCopilotSymbolAutocomplete()`:

```javascript
await loadSymbolCatalog();
initCopilotSymbolAutocomplete();
```

**4d. No changes needed to:**
- `getSymbolsList()` (line 152) — it already reads from `COPILOT_SYMBOL_LISTS`
- `initCopilotSymbolAutocomplete()` — it already calls `getSymbolsList()`

### Step 5: Validator — minimal change

`frontend/public/validator.js` already loads from `GET /api/candidates/symbols` in `loadSymbolLibrary()` (line 219). Once `symbols.json` has small caps, the Validator's "Small Caps" category will automatically populate because `normalizeSymbolCatalog()` maps the `smallcaps` key to the "Small Caps" label (line 250).

**Changes needed (from the universe bug report):**
- Add "Add All in Category" button (see `.planning/plans/fix-validator-universe-bug.md`, Fix 3a)
- Add empty-universe warning on submit (see Fix 3b)

### Step 6: Fix Python falsy bug

**File:** `backend/services/validatorPipeline.py`, line 231

**Current code (broken):**
```python
symbols = universe or spec.get("universe") or ["SPY", "QQQ"]
```

**Replace with:**
```python
if universe is not None and len(universe) > 0:
    symbols = universe
elif isinstance(spec.get("universe"), list) and len(spec.get("universe")) > 0:
    symbols = spec["universe"]
else:
    symbols = ["SPY", "QQQ"]
```

### Step 7: Delete old file

After confirming everything works, delete `backend/services/symbols.json` (the old 37-ETF-only file).

---

## What NOT to change

- **History/Trading Desk** (`history.js`) — doesn't need a symbol catalog; it works from trade data
- **Python services** (`patternScanner.py`, `quoteService.py`, `strategyRunner.py`) — they receive symbols as CLI args from Node; no catalog needed
- **`storageService.ts`** — no symbol storage logic needed; the JSON file is read directly by the candidates route
- **The API endpoint URL** — keep it at `GET /api/candidates/symbols` so the Validator doesn't need URL changes

---

## Key Risks and Notes

### Symbol key naming: `smallcaps` (no underscore)

The Scanner's batch scan dropdown uses `<option value="smallcaps">` in `index.html`. The hardcoded `symbolLists` uses `smallcaps` as the key. The JSON file MUST use `"smallcaps"` (no underscore) to match. The Validator's `normalizeSymbolCatalog()` handles both `"smallcaps"` and `"small_caps"` (lines 250-251), so it works either way on that side.

### Autocomplete timing

Scanner and Co-Pilot depend on symbols loading before autocomplete initializes. If the API call is slow, autocomplete will briefly have no suggestions. The fix is straightforward: call `loadSymbolCatalog()` with `await` before `initSymbolAutocomplete()`. The autocomplete won't init until data is loaded.

### `symbolLists` variable shape must stay identical

Throughout `index.js`, the variable `symbolLists` is referenced by `getSymbolsList()`, `runBatchScan()`, and the autocomplete. The refactor ONLY changes where the data comes from (API instead of hardcoded). The variable name, shape, and all consuming code stay exactly the same.

### Manual symbol entry still works

Even if the API fails, users can still type any symbol into the Scanner or Co-Pilot input fields. The autocomplete just won't have suggestions. The scan itself uses whatever the user typed — it doesn't validate against the catalog.

---

## Testing

1. **Scanner autocomplete:** Type "SM" → should see SMCI and other small cap suggestions (previously only worked because of hardcoded list; now from API)
2. **Scanner batch scan:** Select "smallcaps" category → Run Batch Scan → should scan all ~200 small cap tickers
3. **Co-Pilot autocomplete:** Type "IO" → should see IONQ (loaded from API, not hardcoded)
4. **Validator run modal:** Select "Small Caps" category → should see ~200 tickers in the library (previously empty)
5. **Validator "Add All":** Click "Add All in Category" with Small Caps selected → universe input fills with all tickers
6. **Validator submit with universe:** Run validation with small caps → progress should show "Downloading SMCI (1/N)..." NOT "Downloading SPY..."
7. **API directly:** `GET /api/candidates/symbols` → should return full catalog with all categories including smallcaps and futures
8. **Fallback:** Stop the backend → Scanner/Co-Pilot pages should still load (autocomplete empty, but manual input works)
9. **Python falsy fix:** Run validation with strategy that has `universe: []` and no explicit override → should default to SPY/QQQ (not crash)

---

## Summary

| Step | File(s) | Change | Lines of Code (est.) |
|------|---------|--------|---------------------|
| 1 | `backend/data/symbols.json` (new) | Create master catalog with all ~250 symbols | ~250 lines (JSON) |
| 2 | `candidates.ts` line 228 | Change path from `services/` to `data/` | 1 line |
| 3 | `index.js` | Remove hardcoded list, add API load | -60 / +30 lines |
| 4 | `copilot.js` | Remove hardcoded list, add API load | -10 / +30 lines |
| 5 | `validator.js` + `validator.html` | "Add All in Category" button + empty warning | ~20 lines |
| 6 | `validatorPipeline.py` line 231 | Fix falsy empty-list logic | 5 lines |
| 7 | `backend/services/symbols.json` | Delete old file | -67 lines |
