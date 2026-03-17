#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List

from platform_sdk.ohlcv import OHLCV
from platform_sdk.rdp import detect_swings_rdp
from platform_sdk.swing_structure import serialize_swing_structure


def compute_spec_hash(spec: Dict[str, Any]) -> str:
    """Compute a deterministic hash of config-relevant fields."""
    payload = {
        "cost_config": spec.get("cost_config") or None,
        "entry_config": spec.get("entry_config") or None,
        "exit_config": spec.get("exit_config") or None,
        "risk_config": spec.get("risk_config") or None,
        "setup_config": spec.get("setup_config") or None,
        "strategy_id": spec.get("strategy_id"),
        "structure_config": spec.get("structure_config") or None,
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


def _extract_active_leg(swing: Any, data: List[OHLCV]) -> Dict[str, Any]:
    """
    Derive the most recent impulse leg from swing structure.
    The active leg is the segment from the last confirmed swing low
    to the highest point after it (or vice-versa for bearish legs).
    """
    if not swing or not swing.swing_points or len(swing.swing_points) < 2:
        return {}

    points = swing.swing_points
    last_low = None
    last_high = None
    for p in reversed(points):
        if p.point_type == "LOW" and last_low is None:
            last_low = p
        elif p.point_type == "HIGH" and last_high is None:
            last_high = p
        if last_low and last_high:
            break

    if not last_low or not last_high:
        return {}

    if last_high.index > last_low.index:
        return {
            "leg_high": {"index": last_high.index, "price": float(data[last_high.index].high)},
            "leg_low": {"index": last_low.index, "price": float(data[last_low.index].low)},
            "leg_direction": "bullish",
            "leg_bars": last_high.index - last_low.index,
        }
    else:
        return {
            "leg_high": {"index": last_high.index, "price": float(data[last_high.index].high)},
            "leg_low": {"index": last_low.index, "price": float(data[last_low.index].low)},
            "leg_direction": "bearish",
            "leg_bars": last_low.index - last_high.index,
        }


def _extract_pullback_range(swing: Any, data: List[OHLCV]) -> Dict[str, Any]:
    """
    For pullback entry strategies: measure from the last confirmed swing low
    to the running high (highest price after that low, including current price).
    This is the move that price would "pull back" from.
    """
    if not swing or not swing.swing_points:
        return {}

    # Find the last confirmed swing low
    last_low = None
    for p in reversed(swing.swing_points):
        if p.point_type == "LOW":
            last_low = p
            break

    if not last_low:
        return {}

    # Find the highest price AFTER the last swing low (the running high)
    running_high_price = 0.0
    running_high_index = last_low.index
    for i in range(last_low.index, len(data)):
        if data[i].high > running_high_price:
            running_high_price = float(data[i].high)
            running_high_index = i

    if running_high_price <= float(data[last_low.index].low):
        return {}

    return {
        "leg_high": {"index": running_high_index, "price": running_high_price},
        "leg_low": {"index": last_low.index, "price": float(data[last_low.index].low)},
        "leg_direction": "bullish",
        "leg_bars": running_high_index - last_low.index,
    }


def run_rdp_pivots_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Primitive indicator: RDP swing pivots only.

    Responsibilities:
    - Run RDP swing extraction
    - Return pivot highs/lows and chart anchors

    Non-responsibilities:
    - No major-mode fallback
    - No Wyckoff phase logic
    - No entry timing decision
    """
    struct_cfg = spec.get("structure_config", {}) or {}
    epsilon_pct = float(struct_cfg.get("swing_epsilon_pct", 0.05))

    swing = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    if not swing.swing_points:
        return []

    serialized = serialize_swing_structure(swing, data)
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "rdp_swing_structure_v1")
    window_start = swing.swing_points[0].index
    window_end = len(data) - 1
    num_highs = len([p for p in swing.swing_points if p.point_type == "HIGH"])
    num_lows = len([p for p in swing.swing_points if p.point_type == "LOW"])
    pivot_count = num_highs + num_lows

    candidate_id = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"
    candidate = {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": round(min(1.0, pivot_count / 20.0), 2),
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "RDP pivots detected",
                "passed": pivot_count > 0,
                "value": pivot_count,
                "threshold": 1,
            },
            {
                "rule_name": "Swing highs detected",
                "passed": num_highs > 0,
                "value": num_highs,
                "threshold": 1,
            },
            {
                "rule_name": "Swing lows detected",
                "passed": num_lows > 0,
                "value": num_lows,
                "threshold": 1,
            },
        ],
        "anchors": {
            "current_peak": serialized.get("current_peak"),
            "current_low": serialized.get("current_low"),
        },
        "window_start": window_start,
        "window_end": window_end,
        "pattern_type": "rdp_swing_structure",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": serialized.get("chart_data", []),
        "node_result": {
            "passed": pivot_count > 0 and num_highs > 0 and num_lows > 0,
            "score": round(min(1.0, pivot_count / 20.0), 2),
            "features": {
                "pivot_count": pivot_count,
                "swing_count_highs": num_highs,
                "swing_count_lows": num_lows,
                "epsilon_pct": epsilon_pct,
            },
            "anchors": {
                "current_peak": serialized.get("current_peak"),
                "current_low": serialized.get("current_low"),
            },
            "reason": "rdp_pivots_detected" if pivot_count > 0 else "no_pivots",
        },
        "rdp_pivots": {
            "epsilon_pct": epsilon_pct,
            "swing_points": serialized.get("swing_points", []),
            "swing_count_highs": num_highs,
            "swing_count_lows": num_lows,
            "primary_trend": serialized.get("primary_trend"),
            "intermediate_trend": serialized.get("intermediate_trend"),
            "trend_alignment": serialized.get("trend_alignment"),
        },
        "output_ports": {
            "swing_structure": {
                "swing_points": serialized.get("swing_points", []),
                "swing_count_highs": num_highs,
                "swing_count_lows": num_lows,
                "primary_trend": serialized.get("primary_trend"),
                "intermediate_trend": serialized.get("intermediate_trend"),
                "current_peak": serialized.get("current_peak"),
                "current_low": serialized.get("current_low"),
            },
            "active_leg": _extract_active_leg(swing, data),
            "pullback_range": _extract_pullback_range(swing, data),
            "signal": {
                "passed": pivot_count > 0 and num_highs > 0 and num_lows > 0,
                "score": round(min(1.0, pivot_count / 20.0), 2),
                "reason": "rdp_pivots_detected" if pivot_count > 0 else "no_pivots",
            },
        },
    }
    return [candidate]


def run_swing_structure_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Backward-compatible alias for older JSON/plugin_function values.
    """
    return run_rdp_pivots_plugin(data, structure, spec, symbol, timeframe, **kwargs)

