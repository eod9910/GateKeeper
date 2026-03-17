"""RDP (Ramer-Douglas-Peucker) swing detection algorithm with caching."""
from __future__ import annotations

import os
import sys
from typing import List, Dict, Any, Optional, Tuple

from .ohlcv import OHLCV, _detect_intraday, _format_chart_time

_SCANNER_DEBUG = os.environ.get("SCANNER_DEBUG", "").lower() in ("1", "true", "yes")

_BACKTEST_MODE = False

def set_backtest_mode(enabled: bool) -> None:
    """Toggle backtest mode to suppress verbose diagnostic prints."""
    global _BACKTEST_MODE
    _BACKTEST_MODE = enabled

try:
    import fastrdp
    HAS_FASTRDP = True
except ImportError:
    HAS_FASTRDP = False

try:
    import pandas as pd
    import numpy as np
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

__all__ = [
    "set_backtest_mode",
    "precompute_rdp_for_backtest",
    "clear_rdp_precomputed",
    "clear_rdp_cache",
    "rdp_cache_stats",
    "detect_swing_highs_lows",
    "detect_swings_rdp",
    "detect_relative_swing_points",
]

# ── RDP result cache ─────────────────────────────────────────────────────────
# detect_swings_rdp runs up to 22 fastrdp calls per invocation (coarse scan +
# binary search). During a validator backtest the same symbol is evaluated at
# every historical bar, causing thousands of redundant calls. This module-level
# cache stores SwingStructure by (symbol, timeframe, data_length, epsilon_pct)
# so that repeated calls with identical inputs return instantly.
#
# Cache is intentionally NOT bounded — a single backtest run processes a fixed
# universe of symbols, so memory growth is bounded by (symbols × data_length).
# The cache is cleared automatically when the process exits.
_rdp_cache: dict = {}
_rdp_cache_hits: int = 0
_rdp_cache_misses: int = 0

# ── Backtest precomputed-RDP cache ────────────────────────────────────────────
# Keyed by (symbol, timeframe, total_bars, epsilon_pct).
# Populated once per symbol before the sliding-window backtest loop.
# detect_swings_rdp() uses this to avoid re-running RDP on every prefix slice.
_rdp_precomputed: dict = {}
_rdp_precomputed_hits: int = 0


def precompute_rdp_for_backtest(
    data: List[OHLCV],
    symbol: str,
    timeframe: str,
    epsilon_pct: float,
) -> None:
    """
    Run RDP once on the FULL dataset and cache the result.
    Subsequent detect_swings_rdp() calls with prefix slices of the same
    (symbol, timeframe) will filter the cached swing points instead of
    re-running the expensive fastrdp algorithm for each bar.
    """
    _key = (symbol, timeframe, len(data), round(epsilon_pct, 6))
    if _key in _rdp_precomputed:
        return  # already done
    result = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    _rdp_precomputed[_key] = result


def clear_rdp_precomputed() -> None:
    """Clear the backtest precomputed-RDP cache (call between pipeline runs)."""
    global _rdp_precomputed, _rdp_precomputed_hits
    _rdp_precomputed.clear()
    _rdp_precomputed_hits = 0


def clear_rdp_cache() -> None:
    """Clear the RDP swing-structure cache. Call between backtest runs."""
    global _rdp_cache, _rdp_cache_hits, _rdp_cache_misses
    _rdp_cache.clear()
    _rdp_cache_hits = 0
    _rdp_cache_misses = 0


def rdp_cache_stats() -> dict:
    """Return cache hit/miss counters for diagnostics."""
    total = _rdp_cache_hits + _rdp_cache_misses
    hit_rate = (_rdp_cache_hits / total * 100) if total > 0 else 0.0
    return {
        "entries": len(_rdp_cache),
        "hits": _rdp_cache_hits,
        "misses": _rdp_cache_misses,
        "hit_rate_pct": round(hit_rate, 1),
        "precomputed_hits": _rdp_precomputed_hits,
        "precomputed_entries": len(_rdp_precomputed),
    }


def detect_swing_highs_lows(
    data: List[OHLCV],
    left_bars: int = 5,
    right_bars: int = 5
) -> Tuple[List[int], List[int]]:
    """
    Detect swing highs and lows using pivot logic.
    
    Returns:
        Tuple of (swing_high_indices, swing_low_indices)
    """
    swing_highs = []
    swing_lows = []
    
    for i in range(left_bars, len(data) - right_bars):
        # Check for swing high
        is_high = True
        for j in range(i - left_bars, i + right_bars + 1):
            if j != i and data[j].high >= data[i].high:
                is_high = False
                break
        if is_high:
            swing_highs.append(i)
        
        # Check for swing low
        is_low = True
        for j in range(i - left_bars, i + right_bars + 1):
            if j != i and data[j].low <= data[i].low:
                is_low = False
                break
        if is_low:
            swing_lows.append(i)
    
    return swing_highs, swing_lows


def detect_swings_rdp(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    epsilon_pct: float = 0.05,
    use_exact_epsilon: bool = False,
    verbose: bool = True,
) -> SwingStructure:
    """
    Detect swing highs and lows using Ramer-Douglas-Peucker line simplification.
    
    RDP finds the minimum set of points that describes the price curve's shape.
    Points only survive if removing them would distort the overall shape by more
    than epsilon. This matches how humans visually identify swing points — by
    seeing the essential shape, not by computing percentage moves.
    
    Args:
        data: OHLCV price data
        symbol: Ticker symbol
        timeframe: Timeframe label
        epsilon_pct: Sensitivity as percentage of price range (0.05 = 5%).
                     Higher = fewer swings (only major turns).
                     Lower = more swings (catches intermediate structure).
    
    Returns:
        SwingStructure with mode="RDP"
    """
    from .swing_structure import ConfirmedSwingPoint, SwingStructure, _build_swing_structure

    if _BACKTEST_MODE:
        verbose = False

    global _rdp_cache_hits, _rdp_cache_misses, _rdp_precomputed_hits

    # ── Backtest precomputed-RDP fast path ───────────────────────────────────
    # If a full-dataset result was precomputed for this (symbol, timeframe),
    # filter its swing points to the current data length instead of re-running.
    _eps_key = round(epsilon_pct, 6)
    if not use_exact_epsilon:
        for _pre_key, _pre_result in _rdp_precomputed.items():
            _pre_sym, _pre_tf, _pre_total, _pre_eps = _pre_key
            if (
                _pre_sym == symbol
                and _pre_tf == timeframe
                and _pre_eps == _eps_key
                and len(data) < _pre_total  # we are a prefix of the precomputed data
            ):
                _rdp_precomputed_hits += 1
                max_idx = len(data) - 1
                filtered_swings = [p for p in _pre_result.swing_points if p.index <= max_idx]
                return _build_swing_structure(symbol, timeframe, filtered_swings, data, mode="RDP", verbose=verbose)

    # ── Regular cache lookup ──────────────────────────────────────────────────
    # Key: (symbol, timeframe, data_length, last_close, epsilon_pct)
    # last_close makes the key sensitive to new bars arriving mid-run.
    _cache_key = (
        symbol, timeframe, len(data),
        round(data[-1].close, 6) if data else 0,
        round(epsilon_pct, 6),
        bool(use_exact_epsilon),
    )
    if _cache_key in _rdp_cache:
        _rdp_cache_hits += 1
        return _rdp_cache[_cache_key]
    _rdp_cache_misses += 1

    if len(data) < 10:
        result = SwingStructure(
            symbol=symbol,
            timeframe=timeframe,
            swing_points=[],
            current_peak=None,
            current_low=None,
            prior_peak=None,
            prior_low=None,
            current_price=data[-1].close if data else 0,
            current_date=data[-1].timestamp if data else "",
            status="UNKNOWN",
            retracement_70=None,
            retracement_79=None,
            in_buy_zone=False,
            mode="RDP"
        )
        _rdp_cache[_cache_key] = result
        return result

    if verbose and _SCANNER_DEBUG: print(f"\n=== RDP SWING DETECTION: {symbol} ({timeframe}) ===", file=sys.stderr)
    if verbose and _SCANNER_DEBUG: print(f"Initial epsilon: {epsilon_pct:.1%} of price range", file=sys.stderr)
    if verbose and _SCANNER_DEBUG: print(f"Analyzing {len(data)} bars", file=sys.stderr)
    
    if not HAS_FASTRDP:
        if verbose: print("WARNING: fastrdp not installed, falling back to RELATIVE mode", file=sys.stderr)
        return detect_relative_swing_points(data, symbol, timeframe, verbose=verbose)
    
    # Build x (index) and y (close price) arrays for RDP
    x = np.array([float(i) for i in range(len(data))], dtype=np.float64)
    y = np.array([bar.close for bar in data], dtype=np.float64)
    
    # Compute absolute epsilon from price range
    price_high = max(bar.high for bar in data)
    price_low = min(bar.low for bar in data)
    price_range = price_high - price_low
    
    if verbose and _SCANNER_DEBUG: print(f"Price range: ${price_low:.2f} - ${price_high:.2f} (${price_range:.2f})", file=sys.stderr)

    # ── Exact-epsilon mode: bypass auto-adapt, run RDP once with the given epsilon ──
    if use_exact_epsilon:
        eps_abs = epsilon_pct * price_range
        rx_t, ry_t = fastrdp.rdp(x, y, eps_abs)
        significant_indices = [int(round(xi)) for xi in rx_t]
        current_epsilon_pct = epsilon_pct
        if verbose: print(f"RDP (exact eps={epsilon_pct:.4f}) reduced {len(data)} bars to {len(significant_indices)} significant points", file=sys.stderr)

        swing_points: List[ConfirmedSwingPoint] = []
        for k in range(1, len(significant_indices) - 1):
            idx = significant_indices[k]
            prev_idx = significant_indices[k - 1]
            next_idx = significant_indices[k + 1]
            prev_close = data[prev_idx].close
            curr_close = data[idx].close
            next_close = data[next_idx].close

            if curr_close > prev_close and curr_close > next_close:
                scan_start, scan_end = max(0, prev_idx), min(len(data), next_idx + 1)
                best_idx, best_high = idx, data[idx].high
                for j in range(scan_start, scan_end):
                    if data[j].high > best_high:
                        best_high, best_idx = data[j].high, j
                swing_points.append(ConfirmedSwingPoint(
                    index=best_idx, price=best_high, date=data[best_idx].timestamp,
                    point_type='HIGH', confirmed_by_index=next_idx,
                    confirmed_by_date=data[next_idx].timestamp))

            elif curr_close < prev_close and curr_close < next_close:
                scan_start, scan_end = max(0, prev_idx), min(len(data), next_idx + 1)
                best_idx, best_low = idx, data[idx].low
                for j in range(scan_start, scan_end):
                    if data[j].low < best_low:
                        best_low, best_idx = data[j].low, j
                swing_points.append(ConfirmedSwingPoint(
                    index=best_idx, price=best_low, date=data[best_idx].timestamp,
                    point_type='LOW', confirmed_by_index=next_idx,
                    confirmed_by_date=data[next_idx].timestamp))

        num_highs = len([p for p in swing_points if p.point_type == 'HIGH'])
        num_lows  = len([p for p in swing_points if p.point_type == 'LOW'])
        if verbose: print(f"\nFound {num_highs} swing highs, {num_lows} swing lows (exact mode)", file=sys.stderr)

        result = _build_swing_structure(symbol, timeframe, swing_points, data, mode="RDP", verbose=verbose)
        _rdp_cache[_cache_key] = result
        return result

    # ── Adaptive epsilon via target swing count ──────────────────────────
    # Instead of a fixed epsilon, we binary-search for the epsilon that
    # produces a target number of confirmed swing points (interior points
    # that are classified as HIGH or LOW).
    #
    # Target: 4-8 swing points (2-4 highs + 2-4 lows).
    # This adapts automatically per instrument regardless of volatility.
    #
    # Strategy:
    #   1. Scan a range of epsilons from large (few points) to small (many points)
    #   2. Pick the largest epsilon that yields >= TARGET_MIN swings
    #   3. If that yields > TARGET_MAX, step back up
    #
    TARGET_MIN_SWINGS = 6   # At least 6 swing points (3H + 3L) — captures recent structure
    TARGET_MAX_SWINGS = 16  # No more than 16 (8H + 8L) — allow enough to capture recent moves
    MIN_EPSILON_PCT = 0.001  # Floor: 0.1% of range
    MAX_EPSILON_PCT = 0.15   # Ceiling: 15% of range
    
    # Build a table of epsilon -> swing count (coarse scan first, then refine)
    total_bars = len(data)
    recency_threshold = int(total_bars * 0.15)  # Last swing must be within recent 15% of data
    
    def _count_swings_for_epsilon(eps_pct):
        eps_abs = eps_pct * price_range
        rx_t, ry_t = fastrdp.rdp(x, y, eps_abs)
        indices_arr = np.array([int(round(xi)) for xi in rx_t], dtype=np.int64)
        indices = indices_arr.tolist()
        # Use compiled Numba function for the inner count loop (C speed)
        try:
            from .numba_indicators import count_rdp_swings
            count, last_swing_idx = count_rdp_swings(indices_arr, y)
        except ImportError:
            count = 0
            last_swing_idx = 0
            for k in range(1, len(indices) - 1):
                prev_c = data[indices[k - 1]].close
                curr_c = data[indices[k]].close
                next_c = data[indices[k + 1]].close
                if (curr_c > prev_c and curr_c > next_c) or (curr_c < prev_c and curr_c < next_c):
                    count += 1
                    last_swing_idx = indices[k]
        return count, indices, int(last_swing_idx)
    
    # Phase 1: Coarse scan — try powers of 2 from max down to min
    best_epsilon_pct = epsilon_pct
    best_swings = 0
    best_indices = []
    
    coarse_epsilons = []
    e = MAX_EPSILON_PCT
    while e >= MIN_EPSILON_PCT:
        coarse_epsilons.append(e)
        e /= 2.0
    
    if verbose and _SCANNER_DEBUG: print(f"  Auto-adapting epsilon (target: {TARGET_MIN_SWINGS}-{TARGET_MAX_SWINGS} swings)", file=sys.stderr)
    
    def _is_recent(last_swing_idx):
        """Check if the last detected swing is within the recent portion of data."""
        bars_from_end = total_bars - 1 - last_swing_idx
        return bars_from_end <= recency_threshold
    
    for e_pct in coarse_epsilons:
        sw_count, indices, last_sw_idx = _count_swings_for_epsilon(e_pct)
        recent = _is_recent(last_sw_idx) if sw_count > 0 else False
        if verbose and _SCANNER_DEBUG: print(f"  epsilon={e_pct:.4f} ({e_pct*100:.2f}%) => abs=${e_pct * price_range:.0f} => {len(indices)} pts, {sw_count} swings, last_swing_bar={last_sw_idx}/{total_bars-1} recent={recent}", file=sys.stderr)
        
        if TARGET_MIN_SWINGS <= sw_count <= TARGET_MAX_SWINGS and recent:
            best_epsilon_pct = e_pct
            best_swings = sw_count
            best_indices = indices
            break
        elif TARGET_MIN_SWINGS <= sw_count <= TARGET_MAX_SWINGS and not recent:
            # Swing count is in range but the last swing is too old — keep reducing epsilon
            if verbose and _SCANNER_DEBUG: print(f"    -> swing count OK but last swing too old (bar {last_sw_idx}, need >= {total_bars - 1 - recency_threshold}), continuing...", file=sys.stderr)
            continue
        elif sw_count < TARGET_MIN_SWINGS:
            # Too few swings — epsilon is too large, continue reducing
            continue
        else:
            # Too many swings — epsilon is too small
            # Try to refine between this and the previous
            if coarse_epsilons.index(e_pct) > 0:
                high_e = coarse_epsilons[coarse_epsilons.index(e_pct) - 1]
                low_e = e_pct
                for _ in range(8):
                    mid_e = (high_e + low_e) / 2.0
                    mid_count, mid_indices, mid_last_sw = _count_swings_for_epsilon(mid_e)
                    mid_recent = _is_recent(mid_last_sw) if mid_count > 0 else False
                    if verbose and _SCANNER_DEBUG: print(f"    refine: epsilon={mid_e:.4f} => {mid_count} swings, recent={mid_recent}", file=sys.stderr)
                    
                    if TARGET_MIN_SWINGS <= mid_count <= TARGET_MAX_SWINGS and mid_recent:
                        best_epsilon_pct = mid_e
                        best_swings = mid_count
                        best_indices = mid_indices
                        break
                    elif mid_count < TARGET_MIN_SWINGS:
                        high_e = mid_e  # Need smaller epsilon
                    else:
                        low_e = mid_e  # Need larger epsilon
                
                if best_swings >= TARGET_MIN_SWINGS:
                    break
            
            # If binary search didn't find a good fit, use this one
            if best_swings < TARGET_MIN_SWINGS:
                best_epsilon_pct = e_pct
                best_swings = sw_count
                best_indices = indices
                break
    
    # Fallback: if we never found anything in range, use the last result
    if not best_indices:
        best_epsilon_pct = coarse_epsilons[-1]
        best_swings, best_indices, _ = _count_swings_for_epsilon(best_epsilon_pct)
    
    significant_indices = best_indices
    current_epsilon_pct = best_epsilon_pct
    
    if verbose and _SCANNER_DEBUG: print(f"  Selected epsilon: {current_epsilon_pct:.4f} ({current_epsilon_pct*100:.2f}%) => {best_swings} swings from {len(significant_indices)} significant points", file=sys.stderr)
    if verbose: print(f"RDP reduced {len(data)} bars to {len(significant_indices)} significant points", file=sys.stderr)
    
    # Classify each interior point as HIGH or LOW
    swing_points: List[ConfirmedSwingPoint] = []
    
    for k in range(1, len(significant_indices) - 1):
        idx = significant_indices[k]
        prev_idx = significant_indices[k - 1]
        next_idx = significant_indices[k + 1]
        
        # Look at the close prices at the neighboring significant points
        prev_close = data[prev_idx].close
        curr_close = data[idx].close
        next_close = data[next_idx].close
        
        if curr_close > prev_close and curr_close > next_close:
            # Swing HIGH — use the high price (wick extreme)
            # Also scan the neighborhood for the actual highest bar
            scan_start = max(0, prev_idx)
            scan_end = min(len(data), next_idx + 1)
            best_idx = idx
            best_high = data[idx].high
            for j in range(scan_start, scan_end):
                if data[j].high > best_high:
                    best_high = data[j].high
                    best_idx = j
            
            swing_points.append(ConfirmedSwingPoint(
                index=best_idx,
                price=best_high,
                date=data[best_idx].timestamp,
                point_type='HIGH',
                confirmed_by_index=next_idx,
                confirmed_by_date=data[next_idx].timestamp
            ))
            if verbose and _SCANNER_DEBUG: print(f"  SWING HIGH: ${best_high:.2f} at {data[best_idx].timestamp[:10]}", file=sys.stderr)
            
        elif curr_close < prev_close and curr_close < next_close:
            # Swing LOW — use the low price (wick extreme)
            # Scan neighborhood for actual lowest bar
            scan_start = max(0, prev_idx)
            scan_end = min(len(data), next_idx + 1)
            best_idx = idx
            best_low = data[idx].low
            for j in range(scan_start, scan_end):
                if data[j].low < best_low:
                    best_low = data[j].low
                    best_idx = j
            
            swing_points.append(ConfirmedSwingPoint(
                index=best_idx,
                price=best_low,
                date=data[best_idx].timestamp,
                point_type='LOW',
                confirmed_by_index=next_idx,
                confirmed_by_date=data[next_idx].timestamp
            ))
            if verbose and _SCANNER_DEBUG: print(f"  SWING LOW:  ${best_low:.2f} at {data[best_idx].timestamp[:10]}", file=sys.stderr)
    
    num_highs = len([p for p in swing_points if p.point_type == 'HIGH'])
    num_lows = len([p for p in swing_points if p.point_type == 'LOW'])
    if verbose: print(f"\nFound {num_highs} swing highs, {num_lows} swing lows", file=sys.stderr)

    result = _build_swing_structure(symbol, timeframe, swing_points, data, mode="RDP", verbose=verbose)
    _rdp_cache[_cache_key] = result
    return result


def detect_relative_swing_points(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    swing_threshold: float = 0.20,  # 20% move to confirm a swing
    lookback: int = 0,  # 0 = use all data, else use last N bars
    verbose: bool = True,
) -> SwingStructure:
    """
    Detect swing points using RELATIVE percentage moves.
    
    This is the fallback mode when the strict "structure break" approach
    doesn't find enough swing highs (< 2).
    
    Algorithm:
    1. Find all local highs and lows using simple pivot detection
    2. Confirm a swing HIGH when price drops swing_threshold% from it
    3. Confirm a swing LOW when price rises swing_threshold% from it
    
    This catches intermediate swings that don't break major structure.
    
    Args:
        data: OHLCV price data
        symbol: Ticker symbol
        timeframe: Timeframe label (D, W, M)
        swing_threshold: Percentage move required to confirm swing (0.20 = 20%)
        lookback: Number of bars to analyze (0 = all data)
    
    Returns:
        SwingStructure with mode="RELATIVE"
    """
    from .swing_structure import ConfirmedSwingPoint, SwingStructure, _build_swing_structure

    if _BACKTEST_MODE:
        verbose = False

    if len(data) < 10:
        return SwingStructure(
            symbol=symbol,
            timeframe=timeframe,
            swing_points=[],
            current_peak=None,
            current_low=None,
            prior_peak=None,
            prior_low=None,
            current_price=data[-1].close if data else 0,
            current_date=data[-1].timestamp if data else "",
            status="UNKNOWN",
            retracement_70=None,
            retracement_79=None,
            in_buy_zone=False,
            mode="RELATIVE"
        )
    
    # Optionally limit to last N bars
    if lookback > 0 and len(data) > lookback:
        data = data[-lookback:]
    
    if verbose: print(f"\n=== RELATIVE SWING DETECTION: {symbol} ({timeframe}) ===", file=sys.stderr)
    if verbose: print(f"Threshold: {swing_threshold:.0%} move to confirm swing", file=sys.stderr)
    if verbose: print(f"Analyzing {len(data)} bars", file=sys.stderr)
    
    swing_points: List[ConfirmedSwingPoint] = []
    
    # Track running high and low
    running_high_price = data[0].high
    running_high_idx = 0
    running_low_price = data[0].low
    running_low_idx = 0
    
    # State: looking for HIGH confirmation or LOW confirmation
    # Start by looking for a high (after finding initial range)
    last_confirmed_type = None  # 'HIGH' or 'LOW'
    
    for i in range(1, len(data)):
        bar = data[i]
        
        # Update running high
        if bar.high > running_high_price:
            running_high_price = bar.high
            running_high_idx = i
        
        # Update running low
        if bar.low < running_low_price:
            running_low_price = bar.low
            running_low_idx = i
        
        # Check for swing HIGH confirmation (price dropped threshold% from running high)
        if running_high_price > 0:
            drop_from_high = (running_high_price - bar.low) / running_high_price
            
            if drop_from_high >= swing_threshold and last_confirmed_type != 'HIGH':
                # Confirm the swing HIGH
                swing_high = ConfirmedSwingPoint(
                    index=running_high_idx,
                    price=running_high_price,
                    date=data[running_high_idx].timestamp,
                    point_type='HIGH',
                    confirmed_by_index=i,
                    confirmed_by_date=bar.timestamp
                )
                swing_points.append(swing_high)
                if verbose and _SCANNER_DEBUG: print(f"  SWING HIGH: ${running_high_price:.2f} at {data[running_high_idx].timestamp[:10]} (confirmed by {drop_from_high:.1%} drop)", file=sys.stderr)
                
                last_confirmed_type = 'HIGH'
                # Reset running low to current bar
                running_low_price = bar.low
                running_low_idx = i
        
        # Check for swing LOW confirmation (price rose threshold% from running low)
        if running_low_price > 0:
            rise_from_low = (bar.high - running_low_price) / running_low_price
            
            if rise_from_low >= swing_threshold and last_confirmed_type != 'LOW':
                # Confirm the swing LOW
                swing_low = ConfirmedSwingPoint(
                    index=running_low_idx,
                    price=running_low_price,
                    date=data[running_low_idx].timestamp,
                    point_type='LOW',
                    confirmed_by_index=i,
                    confirmed_by_date=bar.timestamp
                )
                swing_points.append(swing_low)
                if verbose and _SCANNER_DEBUG: print(f"  SWING LOW: ${running_low_price:.2f} at {data[running_low_idx].timestamp[:10]} (confirmed by {rise_from_low:.1%} rise)", file=sys.stderr)
                
                last_confirmed_type = 'LOW'
                # Reset running high to current bar
                running_high_price = bar.high
                running_high_idx = i
    
    if verbose: print(f"\nFound {len([p for p in swing_points if p.point_type == 'HIGH'])} swing highs, {len([p for p in swing_points if p.point_type == 'LOW'])} swing lows", file=sys.stderr)
    
    return _build_swing_structure(symbol, timeframe, swing_points, data, mode="RELATIVE", verbose=verbose)
