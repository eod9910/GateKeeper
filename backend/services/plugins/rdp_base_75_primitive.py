#!/usr/bin/env python3
"""
RDP Base 75% Primitive

Uses RDP swing detection to find High→Low pairs, then defines the base as
the lower 25% of that range (i.e., 75% below the high). Draws a horizontal
line at the base ceiling for each swing pair.

Logic:
  1. RDP finds swing highs and lows
  2. For each HIGH→LOW pair (high before the low):
     - range = high_price - low_price
     - base_ceiling = low_price + 0.25 * range
     - base_floor = low_price
  3. Draw horizontal lines for ceiling and floor
  4. Mark as "active" if current price is above the base ceiling (breakout)
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp


def _spec_hash(spec: Dict[str, Any]) -> str:
    raw = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def _chart_data(data: List[OHLCV]) -> List[dict]:
    is_intra = _detect_intraday(data)
    return [
        {
            "time": _format_chart_time(b.timestamp, is_intra),
            "open": b.open,
            "high": b.high,
            "low": b.low,
            "close": b.close,
            "volume": getattr(b, "volume", 0),
        }
        for b in data
    ]


def _build_bases(
    data: List[OHLCV],
    swing_points: list,
    base_pct: float,
) -> List[Dict[str, Any]]:
    """
    Build base zones from consecutive HIGH→LOW swing pairs.

    For each pair where a HIGH precedes a LOW:
      base_floor   = low_price
      base_ceiling = low_price + base_pct * (high_price - low_price)
    """
    sorted_pts = sorted(swing_points, key=lambda sp: sp.index)
    bases: List[Dict[str, Any]] = []

    for i, pt in enumerate(sorted_pts):
        if pt.point_type != "LOW":
            continue

        # Find the nearest preceding HIGH
        prior_high = None
        for j in range(i - 1, -1, -1):
            if sorted_pts[j].point_type == "HIGH":
                prior_high = sorted_pts[j]
                break

        if prior_high is None:
            continue

        high_price = float(prior_high.price)
        low_price = float(pt.price)
        rng = high_price - low_price
        if rng <= 0:
            continue

        ceiling = low_price + base_pct * rng
        current_price = float(data[-1].close)
        broken_out = current_price > ceiling

        bases.append({
            "high_idx": int(prior_high.index),
            "high_price": high_price,
            "low_idx": int(pt.index),
            "low_price": low_price,
            "range": rng,
            "base_ceiling": ceiling,
            "base_floor": low_price,
            "broken_out": broken_out,
            "current_price": current_price,
        })

    # Most recent first
    bases.sort(key=lambda b: b["low_idx"], reverse=True)
    return bases


def run_rdp_base_75_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Any:
    setup = spec.get("setup_config", {}) if isinstance(spec, dict) else {}
    epsilon_pct = float(setup.get("epsilon_pct", 0.05))
    base_pct = float(setup.get("base_pct", 0.25))
    max_marked = int(setup.get("max_marked_bases", 5))

    if len(data) < 40:
        return [] if mode == "scan" else set()

    swings = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    bases = _build_bases(data, swings.swing_points, base_pct=base_pct)

    if mode == "signal":
        return {b["low_idx"] for b in bases if b["broken_out"]}

    found = len(bases) > 0
    active_bases = [b for b in bases if b["broken_out"]]
    best = active_bases[0] if active_bases else (bases[0] if found else None)

    markers: List[Dict[str, Any]] = []
    overlays: List[Dict[str, Any]] = []
    is_intra = _detect_intraday(data)
    t_last = _format_chart_time(data[-1].timestamp, is_intra)

    for b in bases[:max_marked]:
        t_high = _format_chart_time(data[b["high_idx"]].timestamp, is_intra)
        t_low = _format_chart_time(data[b["low_idx"]].timestamp, is_intra)

        # Markers for the high and low
        markers.append({
            "time": t_high,
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "arrowDown",
            "text": f"H ${b['high_price']:.2f}",
        })
        markers.append({
            "time": t_low,
            "position": "belowBar",
            "color": "#22c55e" if b["broken_out"] else "#ef4444",
            "shape": "arrowUp",
            "text": f"L ${b['low_price']:.2f}",
        })

        # Base ceiling line (25% above the low)
        ceil_pts = [
            {"time": t_low, "value": b["base_ceiling"]},
            {"time": t_last, "value": b["base_ceiling"]},
        ]
        overlays.append({
            "type": "line",
            "color": "#f59e0b",
            "lineWidth": 2,
            "lineStyle": 0,
            "label": f"Base Ceiling ${b['base_ceiling']:.2f}",
            "points": ceil_pts,
            "data": ceil_pts,
        })

        # Base floor line (the RDP low)
        floor_pts = [
            {"time": t_low, "value": b["base_floor"]},
            {"time": t_last, "value": b["base_floor"]},
        ]
        overlays.append({
            "type": "line",
            "color": "#92400e",
            "lineWidth": 1,
            "lineStyle": 2,
            "label": f"Base Floor ${b['base_floor']:.2f}",
            "points": floor_pts,
            "data": floor_pts,
        })

    score = 1.0 if (best and best["broken_out"]) else (0.5 if found else 0.0)

    spec_hash = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    svid = spec.get("strategy_version_id", "rdp_base_75_v1") if isinstance(spec, dict) else "rdp_base_75_v1"
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_0_{len(data)-1}"

    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": bool(best and best["broken_out"]),
        "rule_checklist": [
            {
                "rule_name": "rdp_swings_found",
                "passed": len(swings.swing_points) > 0,
                "value": len(swings.swing_points),
                "threshold": ">= 1",
            },
            {
                "rule_name": "base_zones_found",
                "passed": found,
                "value": len(bases),
                "threshold": ">= 1",
            },
            {
                "rule_name": "breakout_above_ceiling",
                "passed": len(active_bases) > 0,
                "value": len(active_bases),
                "threshold": ">= 1",
            },
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "rdp_base_75",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": -1,
        "chart_base_end": -1,
        "visual": {
            "markers": markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": len(active_bases) > 0,
            "score": score,
            "reason": (
                f"Price above base ceiling ({best['base_ceiling']:.2f}) from H{best['high_price']:.0f}->L{best['low_price']:.0f}"
                if best and best["broken_out"]
                else (f"{len(bases)} base zone(s) found, price still in base" if found else "No base zones found")
            ),
        },
        "output_ports": {
            "rdp_base_75": {
                "count": len(bases),
                "active_count": len(active_bases),
                "bases": [
                    {
                        "high_idx": b["high_idx"],
                        "high_price": round(b["high_price"], 4),
                        "low_idx": b["low_idx"],
                        "low_price": round(b["low_price"], 4),
                        "base_ceiling": round(b["base_ceiling"], 4),
                        "base_floor": round(b["base_floor"], 4),
                        "broken_out": b["broken_out"],
                    }
                    for b in bases
                ],
            }
        },
    }
    return [candidate]
