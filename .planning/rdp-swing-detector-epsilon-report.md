# RDP Swing Detector Epsilon Report

## Scope
Inspection of the current RDP swing detector implementation in:
- `backend/services/patternScanner.py`
- `backend/services/strategyRunner.py`
- `backend/services/validatorPipeline.py`

## 1) Where epsilon is defined (exact file + line)
- Primary RDP epsilon parameter:
  - `backend/services/patternScanner.py:1701`
- RDP fallback wrapper epsilon parameter:
  - `backend/services/patternScanner.py:2204`
- Strategy-level epsilon read from config:
  - `backend/services/strategyRunner.py:105`
- Legacy default injection into structure config:
  - `backend/services/strategyRunner.py:911`
- CLI default for scanner runs:
  - `backend/services/patternScanner.py:3575`

## 2) What epsilon is expressed in
- Config/input epsilon is `epsilon_pct`:
  - Percentage (fraction) of total price range, e.g. `0.05 = 5%`
  - Reference: `backend/services/patternScanner.py:1715`
- RDP receives epsilon in absolute price units after conversion:
  - `epsilon = current_epsilon_pct * price_range`
  - Reference: `backend/services/patternScanner.py:1767`

Conclusion:
- Not ATR-normalized.
- Not a directly fixed raw-dollar value from config.
- It is a percent-of-range input converted to raw price units per run.

## 3) Is epsilon fixed or adaptive?
- Base input is fixed at call start (`epsilon_pct` from config/default/CLI).
- Then adapted inside RDP if too few significant points are returned:
  - Retry loop halves epsilon until minimum point count or floor is reached.
  - References:
    - `backend/services/patternScanner.py:1759`
    - `backend/services/patternScanner.py:1766`
    - `backend/services/patternScanner.py:1777`
    - `backend/services/patternScanner.py:1763` (floor `MIN_EPSILON_PCT = 0.002`)

Classification:
- Adaptive per symbol/timeframe data slice (because price range and shape are specific to current series).
- Not ATR/volatility-regime normalized.

## 4) Is epsilon recomputed dynamically during runtime, or only once per run?
- Dynamically recomputed during each RDP call if needed (inside the retry loop).
- If the first pass already has enough points, only one effective epsilon pass occurs.

## 5) Do we run RDP once or multiple times at different epsilons?
- Potentially multiple times at progressively smaller epsilons within one call.
- This is adaptive retry, not multi-scale/hierarchical swing output.
- Only the final accepted pass is used for resulting swing structure.

## 6) Original design intent behind epsilon choice
From code comments/docstrings:
- Simplicity and shape-based swing extraction (human-visual structure matching):
  - `backend/services/patternScanner.py:1704-1709`
- Cross-instrument normalization by using percentage of range:
  - `backend/services/patternScanner.py:1715`
  - `backend/services/patternScanner.py:1752-1755`
- Robustness on strongly trending instruments via adaptive epsilon reduction:
  - `backend/services/patternScanner.py:1759-1763`

Overall intent:
- Practical normalization + simplicity + resilience against too-few-swings edge cases.

## Key snippets where epsilon is set/modified

```python
# backend/services/patternScanner.py:1701
def detect_swings_rdp(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    epsilon_pct: float = 0.05
) -> SwingStructure:
```

```python
# backend/services/strategyRunner.py:105
epsilon = structure_config.get('swing_epsilon_pct', 0.05)
```

```python
# backend/services/patternScanner.py:1764-1777
current_epsilon_pct = epsilon_pct
while current_epsilon_pct >= MIN_EPSILON_PCT:
    epsilon = current_epsilon_pct * price_range
    rx, ry = fastrdp.rdp(x, y, epsilon)
    significant_indices = [int(round(xi)) for xi in rx]
    if len(significant_indices) >= MIN_SIGNIFICANT_POINTS:
        break
    current_epsilon_pct = current_epsilon_pct / 2
```

```python
# backend/services/validatorPipeline.py:553-554
base = float(sc.get("swing_epsilon_pct", 0.05))
sc["swing_epsilon_pct"] = base * factor
```

