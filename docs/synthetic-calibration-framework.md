# Synthetic Data Calibration Framework

**Purpose**: Validate any primitive detector using synthetic data with known ground truth before testing on real charts. This is the "supervised parameter calibration" methodology — the primitive must satisfy a geometric specification, not fit the market.

**Philosophy**: "Calibrate to spec, not to profit." A primitive earns the right to participate in composites and backtests only after proving it can reliably detect what it claims to detect on controlled data.

---

## Pipeline Overview

```
Step 1: Generate Synthetic Data (known ground truth)
         ↓
Step 2: Run Detector on Synthetic Data
         ↓
Step 3: Score Detection (did it find the thing we planted?)
         ↓
Step 4: Monte Carlo Trials (N=200+, vary noise/shape/duration)
         ↓
Step 5: Grid Search (sweep detector parameters, find optimal set)
         ↓
Step 6: Duration Stratification (test across short/medium/long)
         ↓
Step 7: Real Chart Validation (run optimal params on real market data)
```

---

## Files

All scripts live in `backend/scripts/`:

| Script | Purpose |
|--------|---------|
| `synthetic_base_calibration.py` | Core engine: synthetic chart generator + detector runner + scorer + Monte Carlo trial loop |
| `grid_search_base.py` | Sweeps parameter grid, finds optimal combination |
| `grid_search_by_duration.py` | Tests best params across short/medium/long base durations |
| `run_real_chart_test.py` | Validates calibrated params against real market data (NVDA, AMD, TSLA, etc.) |

**Run from**: `backend/services/` directory (so imports resolve):
```bash
cd backend/services
py ../scripts/synthetic_base_calibration.py --trials 200
py ../scripts/grid_search_base.py
py ../scripts/grid_search_by_duration.py
py ../scripts/run_real_chart_test.py --tickers NVDA AAPL MSFT
```

---

## How to Reuse for a New Primitive

### Step 1: Define Ground Truth

Create a `SyntheticXxx` dataclass that describes what "correct" looks like:

```python
@dataclass
class SyntheticBase:
    bars: List[OHLCV]
    base_start_idx: int    # first bar of the base
    base_end_idx: int      # last bar of the base
    anchor_price: float    # floor price
    cap_price: float       # ceiling price
    n_prebase_bars: int
    n_base_bars: int
    label: str
```

For another primitive (e.g., breakout detector, mean reversion, divergence), define the equivalent ground truth fields — what bar range should be detected, what price levels matter.

### Step 2: Build a Synthetic Chart Generator

Generate OHLCV bars with controlled structure:

```python
def generate_synthetic_xxx(
    center_price=100.0,
    noise_level=0.3,       # candle noise
    # ... primitive-specific shape params
    seed=None,
) -> SyntheticXxx:
```

Key design principles:
- **Phases**: Build the chart in phases (pre-signal regime → signal region → post-signal)
- **Noise**: Add Gaussian noise to closes, realistic wick extensions
- **Probe wicks**: Occasional wicks that poke outside the expected zone (stress test)
- **Parameterize shape**: Let the caller vary legs, amplitude, alternation, duration
- **Seed**: Accept random seed for reproducibility

The `synthetic_base_calibration.py` generator builds three phases:
1. Pre-base regime (larger legs to establish reference volatility)
2. Base wiggles (small alternating legs within a box)
3. Breakout impulse (strong expansion leg)

### Step 3: Write a Scorer

Compare detector output to ground truth:

```python
def score_detection(result: dict, truth: SyntheticXxx, tolerance_bars=10) -> dict:
    return {
        "found": bool,       # detector fired at all
        "qualified": bool,   # passed the detector's own quality gate
        "anchor_ok": bool,   # detected price level within 5% of truth
        "timing_ok": bool,   # detection falls within the ground truth window
        "score": float,      # detector's confidence score
    }
```

`timing_ok` is the **primary metric** — "did the detector find the right thing in the right place?"

### Step 4: Monte Carlo Trial Loop

Run N trials (200+) with randomly varied synthetic parameters:

```python
def run_trials(n_trials=200, seed=0, detector_params=None) -> dict:
    for i in range(n_trials):
        noise = rng.uniform(0.2, 0.6)
        # ... randomize shape params
        truth = generate_synthetic_xxx(noise_level=noise, seed=...)
        result = run_detector(truth.bars, **detector_params)
        score = score_detection(result, truth)
    # Report: found%, qualified%, anchor_ok%, timing_ok%, avg_score
```

**Verdict thresholds**:
- `timing_ok >= 80%` → PASS — detector is reliable
- `timing_ok >= 60%` → PARTIAL — needs tuning
- `timing_ok < 60%` → FAIL — parameters need significant work

### Step 5: Grid Search

Sweep across a parameter grid:

```python
GRID = {
    "param_a": [0.010, 0.013, 0.017, 0.022],
    "param_b": [5, 6, 7, 8],
    "param_c": [0.30, 0.38, 0.45],
}
# Run 150 trials per combination, rank by timing_ok%
```

Output: top 10 parameter sets ranked by timing accuracy, plus recommended defaults.

### Step 6: Duration Stratification

Test across different signal durations to find where the detector breaks:

```python
DURATION_BUCKETS = {
    "short":  (5, 12),     # legs range
    "medium": (12, 25),
    "long":   (25, 50),
}
```

This reveals if the detector works on short signals but fails on long ones (or vice versa), which drives architectural decisions (e.g., use rolling local ATR window instead of full-chart epsilon).

### Step 7: Real Chart Validation

Run the calibrated parameters against real market data:

```python
DEFAULT_TICKERS = ["NVDA", "AMD", "TSLA", "AAPL", "MSFT", "META", "SPY", "QQQ"]
# Fetch weekly OHLCV, run detector, report what was found
```

This is the "sanity check" — synthetic confidence doesn't always transfer to real data. Real charts have earnings gaps, splits, regime changes that synthetics don't model.

---

## Scoring Methodology

### Anchor Price Check
Is the detected price level within 5% of the planted ground truth?
```python
floor_err_pct = abs(detected_floor - truth.anchor_price) / truth.anchor_price
anchor_ok = floor_err_pct < 0.05
```

### Timing Check
Does the detection fall within the ground truth window (with tolerance)?
```python
timing_ok = (truth.base_start_idx - tolerance) <= detected_idx <= (truth.base_end_idx + tolerance)
```

### Duration-Scaled Tolerance
For duration tests, scale tolerance to 15% of base length (min 8, max 40 bars):
```python
tolerance = max(8, min(40, int(n_base_bars * 0.15)))
```

---

## Failure Diagnosis

The framework distinguishes two failure modes:
1. **MISSED** — detector didn't fire at all (threshold too strict, or signal characteristics not recognized)
2. **WRONG LOCATION** — detector fired but at the wrong place (anchoring logic confused by pre-signal regime)

The ratio of missed vs wrong-location drives the fix:
- High missed rate → lower thresholds, relax qualifying criteria
- High wrong-location rate → improve anchoring logic, use local ATR windowing

---

## Known Results (RDP Wiggle Base, 2026-02-20)

Best parameters from grid search:
```
epsilon_coarse  : 0.05
epsilon_fine    : 0.010
window_n        : 8
persist_m       : 2
wiggle_threshold: 0.30
k_expand        : 2.0
```

These are stored in `run_real_chart_test.py` as `BEST_SPEC` and should be reflected in `rdp_wiggle_base_primitive.json` default params.

---

## Extending to Other Primitives

This framework applies to any primitive where you can define "correct behavior":

| Primitive | Ground Truth Definition |
|-----------|------------------------|
| Wiggle Base | Box with alternating legs, floor/cap prices, duration |
| Breakout | Price exceeding a defined level with momentum |
| Mean Reversion | Price returning to a statistical center after deviation |
| Divergence | Price making new high/low while indicator does opposite |
| Support/Resistance | Price respecting a level with N touches |
| Order Block | Zone where institutional activity created a turning point |

For each: define the synthetic generator, the scorer, and run the same pipeline.
