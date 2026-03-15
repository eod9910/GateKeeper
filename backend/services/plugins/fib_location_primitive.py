#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from platform_sdk.ohlcv import OHLCV
from fib_energy_primitives import (
    build_chart_data,
    compute_spec_hash,
    evaluate_location_stage,
    resolve_fib_signal,
)


def _calculate_fib_from_leg(
    data: List[OHLCV], leg: Dict[str, Any], setup: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Calculate Fibonacci retracement using an explicitly provided leg
    (from an upstream RDP primitive) instead of detecting one independently.
    Returns a synthetic fib_signal-like dict that evaluate_location_stage can consume.
    """
    leg_high_info = leg.get("leg_high", {})
    leg_low_info = leg.get("leg_low", {})
    if not leg_high_info or not leg_low_info:
        return None

    range_high = float(leg_high_info.get("price", 0))
    range_low = float(leg_low_info.get("price", 0))
    if range_high <= range_low or range_high == 0:
        return None

    current_price = float(data[-1].close) if data else 0
    if current_price == 0:
        return None

    total_range = range_high - range_low
    retracement_pct = ((range_high - current_price) / total_range) * 100.0 if total_range > 0 else 0.0

    fib_levels = [0.236, 0.382, 0.50, 0.618, 0.70, 0.786]
    fib_prices = {lvl: range_high - (total_range * lvl) for lvl in fib_levels}

    nearest_level = None
    nearest_dist = float("inf")
    for lvl, price in fib_prices.items():
        dist = abs(current_price - price)
        if dist < nearest_dist:
            nearest_dist = dist
            nearest_level = lvl

    proximity_pct = (nearest_dist / current_price * 100) if current_price > 0 else 999

    class FibSignalProxy:
        pass

    sig = FibSignalProxy()
    sig.retracement_pct = round(retracement_pct, 2)
    sig.current_retracement_pct = round(retracement_pct, 2)  # Alias for compatibility
    sig.nearest_level = None  # Set to None to avoid AttributeError (we don't have the full object structure here)
    sig.nearest_level_price = fib_prices.get(nearest_level, 0)
    sig.proximity_pct = round(proximity_pct, 2)
    sig.range_high = range_high
    sig.range_low = range_low
    sig.range_high_date = None  # Placeholder for compatibility
    sig.range_low_date = None  # Placeholder for compatibility
    sig.range_high_idx = int(leg_high_info.get("index", len(data) - 1))
    sig.range_low_idx = int(leg_low_info.get("index", 0))
    sig.fib_levels = fib_prices
    sig.current_price = current_price
    sig.in_discount_zone = retracement_pct >= 50.0
    sig.energy_state = "unknown"
    sig.pressure_ratio = 0.0
    sig.signal_type = "upstream_leg"
    sig.composite_score = 0.0
    return sig


def run_fib_location_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Primitive intent=LOCATION.
    Answers only: Is price currently in the configured Fib location zone?

    Pipeline mode: If upstream provides a 'leg' (ActiveLeg), uses that
    to calculate Fibonacci levels instead of detecting its own swing range.
    """
    setup = spec.get("setup_config", {}) or {}
    upstream = kwargs.get("upstream", {}) or {}

    fib_signal = None
    leg = upstream.get("leg")
    if leg and isinstance(leg, dict) and leg.get("leg_high") and leg.get("leg_low"):
        fib_signal = _calculate_fib_from_leg(data, leg, setup)

    if fib_signal is None:
        fib_signal, _ = resolve_fib_signal(data, symbol, timeframe, setup)
    if fib_signal is None:
        return []

    stage = evaluate_location_stage(fib_signal, setup)
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "fib_location_primitive_v1")
    window_start = 0
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    fib_levels_output = {}
    # Check both attribute names for compatibility (FibSignalProxy uses retracement_pct,
    # real FibSignal uses current_retracement_pct)
    ret_pct = getattr(fib_signal, "retracement_pct", None) or getattr(fib_signal, "current_retracement_pct", None)
    if ret_pct is not None:
        fib_levels_output = {
            "retracement_pct": float(ret_pct),
            "nearest_level": getattr(fib_signal, "nearest_level", None),
            "range_high": getattr(fib_signal, "range_high", 0),
            "range_low": getattr(fib_signal, "range_low", 0),
            "proximity_pct": getattr(fib_signal, "proximity_pct", 0),
        }

    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": stage["score"],
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "fib location zone",
                "passed": stage["passed"],
                "value": stage["reason"],
                "threshold": True,
            }
        ],
        "anchors": stage["anchors"],
        "window_start": window_start,
        "window_end": window_end,
        "pattern_type": "fib_location_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": build_chart_data(data),
        "node_result": stage,
        "output_ports": {
            "fib_levels": fib_levels_output,
            "signal": {
                "passed": stage.get("passed", False),
                "score": stage.get("score", 0.0),
                "reason": stage.get("reason", "unknown"),
            },
        },
    }
    return [candidate]

