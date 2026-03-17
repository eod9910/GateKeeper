#!/usr/bin/env python3
"""
Impulse Trough Primitive
========================
Mechanical trough finder for pullback Fib anchoring.

Algorithm:
1. Find the highest high in the data (the peak / ATH)
2. Walk backwards from the peak
3. Track the running minimum (lowest low)
4. When price rises significantly (>rally_threshold) above that minimum,
   the minimum is the trough — the start of the impulse leg
5. Output: trough → peak = the impulse leg for Fib anchoring

This is deterministic and does NOT depend on RDP epsilon tuning.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time


def compute_spec_hash(spec: Dict[str, Any]) -> str:
    payload = {
        "setup_config": spec.get("setup_config") or None,
        "strategy_id": spec.get("strategy_id"),
        "version": spec.get("version"),
    }

    def canonicalize(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: canonicalize(value[k]) for k in sorted(value.keys())}
        if isinstance(value, list):
            return [canonicalize(v) for v in value]
        return value

    json_str = json.dumps(canonicalize(payload), separators=(",", ":"))
    return hashlib.sha256(json_str.encode("utf-8")).hexdigest()


def find_impulse_trough(
    data: List[OHLCV],
    rally_threshold_pct: float = 0.15,
    lookback_bars: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """
    Find the impulse leg for pullback Fib anchoring.

    Args:
        data: OHLCV bars
        rally_threshold_pct: How much price must rise above the trough
            (as a fraction, e.g. 0.15 = 15%) to confirm the trough.
        lookback_bars: Optional limit on how far back from the peak to search.
            If None, searches the entire dataset.

    Returns:
        Dict with trough and peak info, or None if no impulse leg found.
    """
    if not data or len(data) < 10:
        return None

    # Step 1: Find the peak (highest high in the data)
    peak_idx = 0
    peak_price = data[0].high
    for i in range(1, len(data)):
        if data[i].high > peak_price:
            peak_price = float(data[i].high)
            peak_idx = i

    # Step 2: Walk backwards from the peak, tracking the lowest low
    trough_idx = peak_idx
    trough_price = float(data[peak_idx].low)

    start_idx = 0
    if lookback_bars is not None:
        start_idx = max(0, peak_idx - lookback_bars)

    for i in range(peak_idx - 1, start_idx - 1, -1):
        bar_low = float(data[i].low)

        if bar_low < trough_price:
            trough_price = bar_low
            trough_idx = i
        else:
            # Price is above the current trough — check if rally is significant
            rally_from_trough = (float(data[i].high) - trough_price) / trough_price if trough_price > 0 else 0
            if rally_from_trough > rally_threshold_pct and i < trough_idx:
                break

    # Sanity checks
    if trough_idx == peak_idx:
        return None
    if trough_price >= peak_price:
        return None
    if trough_price <= 0:
        return None

    total_range = peak_price - trough_price
    current_price = float(data[-1].close)
    retracement_pct = ((peak_price - current_price) / total_range * 100.0) if total_range > 0 else 0.0

    # If price is below the trough, the impulse leg is broken (structural downtrend)
    if current_price < trough_price:
        return None

    # Fib levels for the impulse leg
    fib_pcts = [0.0, 0.50, 0.618, 0.70, 0.786, 1.0]
    fib_levels = {}
    for pct in fib_pcts:
        fib_levels[pct] = round(peak_price - (total_range * pct), 2)

    # Find nearest Fib level
    nearest_level = None
    nearest_dist = float("inf")
    for pct, price in fib_levels.items():
        dist = abs(current_price - price)
        if dist < nearest_dist:
            nearest_dist = dist
            nearest_level = pct

    proximity_pct = (nearest_dist / current_price * 100) if current_price > 0 else 999
    in_buy_zone = 50.0 <= retracement_pct <= 79.0

    trough_date = getattr(data[trough_idx], 'timestamp', str(trough_idx))
    peak_date = getattr(data[peak_idx], 'timestamp', str(peak_idx))

    return {
        "trough_idx": trough_idx,
        "trough_price": round(trough_price, 2),
        "trough_date": trough_date,
        "peak_idx": peak_idx,
        "peak_price": round(peak_price, 2),
        "peak_date": peak_date,
        "impulse_bars": peak_idx - trough_idx,
        "impulse_pct": round(((peak_price - trough_price) / trough_price) * 100, 2),
        "current_price": round(current_price, 2),
        "retracement_pct": round(retracement_pct, 2),
        "in_buy_zone": in_buy_zone,
        "nearest_fib_level": nearest_level,
        "proximity_pct": round(proximity_pct, 2),
        "fib_levels": fib_levels,
        "leg": {
            "leg_high": {"index": peak_idx, "price": round(peak_price, 2)},
            "leg_low": {"index": trough_idx, "price": round(trough_price, 2)},
            "leg_direction": "bullish",
            "leg_bars": peak_idx - trough_idx,
        },
    }


def _generate_impulse_signal_indices(
    data: List[OHLCV],
    spec: Dict[str, Any],
    timeframe: str,
) -> set:
    """
    Signal mode: causal detection of pullback entries after impulse.
    Fires when price is in the buy zone (50-79% Fib retracement)
    of the impulse leg found causally at each bar.
    """
    setup = spec.get("setup_config", {}) or {}
    backtest_cfg = spec.get("backtest_config", {}) or {}

    tf_rally_defaults = {
        "1h": 0.04, "4h": 0.06, "D": 0.10, "1d": 0.10,
        "W": 0.15, "1wk": 0.15, "M": 0.20, "1mo": 0.20,
    }
    default_rally = tf_rally_defaults.get(timeframe, 0.10)
    rally_threshold = float(setup.get("rally_threshold_pct", default_rally))
    min_bars = max(int(setup.get("min_history_bars", backtest_cfg.get("min_history_bars", 60))), 30)
    cooldown_bars = int(setup.get("cooldown_bars", backtest_cfg.get("cooldown_bars", 20)))

    signals: set = set()
    last_signal_bar = -cooldown_bars * 2

    for end_idx in range(min_bars, len(data)):
        if end_idx - last_signal_bar < cooldown_bars:
            continue

        # Causal: only use data[0..end_idx]
        window = data[:end_idx + 1]
        result = find_impulse_trough(window, rally_threshold_pct=rally_threshold)
        if result is None:
            continue

        # Check if current price is in the buy zone
        if result["in_buy_zone"]:
            signals.add(end_idx)
            last_signal_bar = end_idx

    return signals


def run_impulse_trough_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Any:
    """
    Primitive indicator: Impulse Trough Finder.

    Two modes:
      mode="scan"   → retrospective chart annotation (for Scanner)
      mode="signal" → causal bar-by-bar signal indices (for Backtest)

    Scan mode output ports:
        - impulse_leg: The trough→peak leg dict
        - fib_levels: Pre-calculated Fib retracement levels
        - signal: Whether price is in the pullback buy zone (50-79% retracement)
    """
    if mode == "signal":
        return _generate_impulse_signal_indices(data, spec, timeframe)

    setup = spec.get("setup_config", {}) or {}

    # Adaptive rally threshold based on timeframe
    tf_rally_defaults = {
        "1h": 0.04, "4h": 0.06, "D": 0.10, "1d": 0.10,
        "W": 0.15, "1wk": 0.15, "M": 0.20, "1mo": 0.20,
    }
    default_rally = tf_rally_defaults.get(timeframe, 0.10)
    rally_threshold = float(setup.get("rally_threshold_pct", default_rally))

    lookback = setup.get("lookback_bars")
    if lookback is not None:
        lookback = int(lookback)

    result = find_impulse_trough(data, rally_threshold_pct=rally_threshold, lookback_bars=lookback)

    if result is None:
        print(f"[ImpulseTrough] {symbol}: REJECTED (no valid impulse leg or price below trough)", file=sys.stderr)
        return []

    print(
        f"[ImpulseTrough] {symbol}: trough=${result['trough_price']} ({result['trough_date'][:10]}) "
        f"-> peak=${result['peak_price']} ({result['peak_date'][:10]}) | "
        f"impulse={result['impulse_pct']:.1f}% over {result['impulse_bars']} bars | "
        f"retracement={result['retracement_pct']:.1f}% | "
        f"buy_zone={result['in_buy_zone']}",
        file=sys.stderr,
    )

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "impulse_trough_v1")
    window_start = result["trough_idx"]
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    in_zone = result["in_buy_zone"]
    score = 0.8 if in_zone else round(max(0, 1.0 - abs(result["retracement_pct"] - 65) / 100), 2)

    # Build chart data (convert timestamps for intraday compatibility)
    is_intraday = _detect_intraday(data)
    chart_data_bars = []
    for bar in data:
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t is not None:
            chart_data_bars.append({
                "time": t,
                "open": float(bar.open),
                "high": float(bar.high),
                "low": float(bar.low),
                "close": float(bar.close),
            })

    # Build fib_levels array for frontend rendering
    current_price = result["current_price"]
    fib_levels_array = []
    for pct, price in sorted(result["fib_levels"].items()):
        level_str = f"{int(pct * 100)}%"
        is_near = abs(current_price - price) / current_price < 0.02 if current_price > 0 else False
        fib_levels_array.append({
            "price": round(price, 2),
            "level": level_str,
            "is_near": is_near,
        })

    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "Impulse leg found",
                "passed": True,
                "value": f"{result['impulse_pct']:.1f}% rally over {result['impulse_bars']} bars",
                "threshold": "any",
            },
            {
                "rule_name": "In pullback buy zone (50-79%)",
                "passed": in_zone,
                "value": f"{result['retracement_pct']:.1f}%",
                "threshold": "50-79%",
            },
        ],
        "anchors": {
            "trough": {"index": result["trough_idx"], "price": result["trough_price"], "date": result["trough_date"]},
            "peak": {"index": result["peak_idx"], "price": result["peak_price"], "date": result["peak_date"]},
        },
        "window_start": window_start,
        "window_end": window_end,
        "pattern_type": "impulse_trough_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": chart_data_bars,
        "fib_levels": fib_levels_array,
        "visual": {
            "markers": [
                {
                    "time": _format_chart_time(result["trough_date"], is_intraday),
                    "position": "belowBar",
                    "color": "#22c55e",
                    "shape": "arrowUp",
                    "text": f"TROUGH ${result['trough_price']}",
                },
                {
                    "time": _format_chart_time(result["peak_date"], is_intraday),
                    "position": "aboveBar",
                    "color": "#ef4444",
                    "shape": "arrowDown",
                    "text": f"PEAK ${result['peak_price']}",
                },
            ],
        },
        "node_result": {
            "passed": in_zone,
            "score": score,
            "features": {
                "trough_price": result["trough_price"],
                "peak_price": result["peak_price"],
                "impulse_pct": result["impulse_pct"],
                "retracement_pct": result["retracement_pct"],
                "in_buy_zone": in_zone,
            },
            "anchors": {
                "trough": {"index": result["trough_idx"], "price": result["trough_price"]},
                "peak": {"index": result["peak_idx"], "price": result["peak_price"]},
            },
            "reason": "in_pullback_buy_zone" if in_zone else f"retracement_{result['retracement_pct']:.0f}pct",
        },
        "output_ports": {
            "impulse_leg": result["leg"],
            "fib_levels": {
                "retracement_pct": result["retracement_pct"],
                "nearest_level": result["nearest_fib_level"],
                "range_high": result["peak_price"],
                "range_low": result["trough_price"],
                "proximity_pct": result["proximity_pct"],
            },
            "signal": {
                "passed": in_zone,
                "score": score,
                "reason": "in_pullback_buy_zone" if in_zone else f"retracement_{result['retracement_pct']:.0f}pct",
            },
        },
    }
    return [candidate]
