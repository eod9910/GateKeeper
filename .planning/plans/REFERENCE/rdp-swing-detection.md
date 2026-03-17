# RDP Swing Point Detection

**Status:** IMPLEMENTED  
**Date:** 2026-02-09

## Problem

The swing detector in `patternScanner.py` used a fixed 20% threshold in RELATIVE mode. High-volatility assets (ATOM, crypto) got flooded with dozens of markers; low-volatility assets (IBM) missed intermediate structure. The threshold-based approach is fundamentally different from how humans see charts.

## Solution: Ramer-Douglas-Peucker Line Simplification

RDP answers: "what is the minimum set of points that describes this price curve's shape?" It finds turning points by identifying where the actual price deviates most from a straight-line approximation — exactly what your eye does when you scan a chart.

### How It Works

```
Given close prices from bar 0 to bar N:
1. Draw a straight line from bar 0 to bar N
2. Find the bar that deviates MOST from that line (perpendicular distance)
3. If deviation > epsilon: that bar is a significant turn point. Split there.
4. Recurse on both halves: bar 0 to turn, and turn to bar N
5. If no bar deviates > epsilon: this segment is "smooth," no swing points
```

The result is a simplified polyline — the surviving points are the swing highs and lows.

### Why It Matches Human Perception

- Evaluates the ENTIRE curve at once (global, not local)
- A point only survives if removing it would distort the shape
- Naturally scale-invariant — works the same on a $2 stock and a $300 stock
- Captures deceleration curves (seller exhaustion) as inflection points
- Cannot produce too many points — each must justify its existence

### The Epsilon Parameter

One parameter controls everything: `epsilon` — the minimum deviation from a straight line for a point to be considered significant.

- **Higher epsilon** = smoother shape, fewer swing points (only major structural turns)
- **Lower epsilon** = more detail, more swing points (catches intermediate swings)

Normalized as a percentage of the price range so it works across instruments:

```python
price_range = max(highs) - min(lows)
absolute_epsilon = epsilon_pct * price_range
```

### Labeling Points as HIGH or LOW

RDP returns "significant points" but doesn't label them. After RDP, each interior point is classified by comparing its close price to its neighbors:
- If higher than both neighbors → Swing HIGH (use the high price / wick extreme)
- If lower than both neighbors → Swing LOW (use the low price / wick extreme)
- Neighborhood scanning finds the actual highest/lowest bar in the segment between neighbors

### User Control: Swing Sensitivity Slider

A sidebar slider (1-15) maps exponentially to `epsilon_pct`:
- Slider 1 → epsilon ~0.20 (fewer swings, major turns only)
- Slider 5 → epsilon ~0.063 (default balance)
- Slider 15 → epsilon ~0.004 (more swings, fine detail)

Formula: `epsilon_pct = 0.20 * 0.75^(slider - 1)`

Changing the slider auto-reruns the analysis — no need to click Analyze.

## Implementation

### Package

`fastrdp` (Python 3.9+, MIT license) — API: `fastrdp.rdp(x, y, epsilon)` takes separate numpy arrays for x and y coordinates plus epsilon, returns simplified (x, y) arrays.

### Key Design Decision

**Copilot always uses RDP** — `generate_copilot_analysis()` calls `detect_swings_rdp()` directly, not `detect_swing_points_with_fallback()`. This ensures the Swing Sensitivity slider always has an effect. The old MAJOR+fallback path is still available for other scan modes (`--swing`, `--wyckoff`).

### Files Changed

| File | Change |
|---|---|
| `requirements.txt` | Added `fastrdp>=0.3.0` |
| `backend/services/patternScanner.py` | Added `detect_swings_rdp()` (~120 lines), updated `detect_swing_points_with_fallback()` to use RDP as fallback instead of RELATIVE, updated `generate_copilot_analysis()` to always use RDP directly, added `--swing-epsilon` CLI arg |
| `backend/src/routes/candidates.ts` | Passes `swingEpsilon` from scan request to `--swing-epsilon` Python arg |
| `backend/src/types/index.ts` | Added `swingEpsilon?: number` to `ScanRequest` interface |
| `frontend/public/copilot.html` | New "Analysis" sidebar section with Swing Sensitivity slider (range 1-15) |
| `frontend/public/copilot.js` | Reads slider, maps to epsilon_pct, includes in scan POST body; saves/loads in settings |

## Results

- **ATOM (volatile crypto)**: Went from 20+ noisy markers to ~5 clean swing points that match what a human sees
- **SLV (silver)**: 3 swing points — the 2011 high, 2022 low, and 2026 breakout high. Exactly the structural narrative a trader reads
- **IBM (steady stock)**: Clean major structure detection that adapts to the slider
