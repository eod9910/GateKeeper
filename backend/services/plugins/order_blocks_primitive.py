#!/usr/bin/env python3
"""
Order Blocks Primitive
======================
Identifies Order Blocks anchored to deterministic Swing Structure.

An Order Block is the last opposite-direction candle before a strong impulse move.
- Bullish OB: last bearish candle before a bullish impulse (swing low → swing high)
- Bearish OB: last bullish candle before a bearish impulse (swing high → swing low)

Dual-mode:
  - "scan": Returns chart annotations (markers) and pass/fail for scanning a universe.
  - "signal": Returns bar indices where OBs form, for backtesting.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp


def compute_spec_hash(spec: dict) -> str:
    raw = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def build_chart_data(data: List[OHLCV]) -> List[dict]:
    is_intraday = _detect_intraday(data)
    return [
        {
            "time": _format_chart_time(bar.timestamp, is_intraday),
            "open": bar.open,
            "high": bar.high,
            "low": bar.low,
            "close": bar.close,
            "volume": getattr(bar, "volume", 0),
        }
        for bar in data
    ]


def find_order_blocks(
    data: List[OHLCV],
    swings: List[Dict[str, Any]],
    direction: str = "both",
) -> List[Dict[str, Any]]:
    """Find order blocks from swing structure and price data."""
    if not swings or len(swings) < 2:
        return []

    blocks = []
    for s in range(2, len(swings)):
        prev_prev = swings[s - 2]
        prev = swings[s - 1]
        curr = swings[s]

        # curr is the swing that CONFIRMS the OB exists.
        # The OB lives in the leg from prev_prev → prev (the leg that formed the
        # turning point). We look for the last opposite-direction candle at the
        # extreme of that leg — right before price reverses.

        is_bullish_ob = prev["type"] == "LOW"   # leg down → OB is bearish, entry on pullback up
        is_bearish_ob = prev["type"] == "HIGH"  # leg up   → OB is bullish, entry on pullback down

        leg_start = prev_prev["index"]
        leg_end = prev["index"]

        if abs(leg_end - leg_start) < 2:
            continue

        if is_bullish_ob:
            # Bullish OB: last DOWN candle in the descending leg → swing low reversal
            ob_idx = None
            for i in range(leg_end, leg_start - 1, -1):
                if i < 0 or i >= len(data):
                    continue
                if data[i].close < data[i].open:
                    ob_idx = i
                    break
            if ob_idx is not None:
                blocks.append({
                    "index": ob_idx,
                    "type": "bullish_ob",
                    "high": data[ob_idx].high,
                    "low": data[ob_idx].low,
                    "date": data[ob_idx].timestamp,
                    "swing_low": leg_end,
                    "swing_high": curr["index"],
                })

        elif is_bearish_ob:
            # Bearish OB: last UP candle in the ascending leg → swing high reversal
            ob_idx = None
            for i in range(leg_end, leg_start - 1, -1):
                if i < 0 or i >= len(data):
                    continue
                if data[i].close > data[i].open:
                    ob_idx = i
                    break
            if ob_idx is not None:
                blocks.append({
                    "index": ob_idx,
                    "type": "bearish_ob",
                    "high": data[ob_idx].high,
                    "low": data[ob_idx].low,
                    "date": data[ob_idx].timestamp,
                    "swing_high": leg_end,
                    "swing_low": curr["index"],
                })

    # Filter by direction AFTER detection — avoids early-return logic bugs in the loop
    if direction == "long":
        blocks = [b for b in blocks if b["type"] == "bullish_ob"]
    elif direction == "short":
        blocks = [b for b in blocks if b["type"] == "bearish_ob"]
    # direction == "both" keeps everything

    return blocks


def _generate_signal_indices(
    data: List[OHLCV],
    swings: List[Dict[str, Any]],
) -> Set[int]:
    """Return bar indices where OBs form (for backtesting)."""
    blocks = find_order_blocks(data, swings)
    return {b["index"] for b in blocks}


def run_order_blocks_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs,
) -> Any:
    """Entry point for the Order Blocks primitive.

    Signature matches composite_runner calling convention:
      fn(data, structure, spec, symbol, timeframe, **kwargs)
    """
    setup = spec.get("setup_config", spec.get("structure_config", {})) if isinstance(spec, dict) else {}

    # direction: "long" = bullish OBs only, "short" = bearish OBs only, "both" = all
    direction = str(setup.get("direction", "both")).lower()

    # Auto-scale epsilon to timeframe so RDP picks up the right granularity of swings.
    # Weekly needs a large epsilon (only major turns); daily/4H need smaller values
    # to see intermediate structure without drowning in noise.
    _EPSILON_BY_TF = {
        "M":  0.08,   # monthly — only the biggest structural turns
        "W":  0.05,   # weekly
        "D":  0.025,  # daily
        "4H": 0.015,
        "1H": 0.008,
        "30": 0.005,
        "15": 0.003,
    }
    default_epsilon = _EPSILON_BY_TF.get(timeframe, 0.03)
    epsilon_pct = float(setup.get("epsilon_pct", default_epsilon))
    swing_structure = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)

    if swing_structure is None or not swing_structure.swing_points:
        return [] if mode == "scan" else set()

    # Convert SwingStructure points to the dict format find_order_blocks expects
    swings = [
        {
            "index": p.index,
            "type": p.point_type,  # "HIGH" or "LOW"
            "price": p.price,
            "date": p.date,
            "tier": getattr(p, "tier", "T1"),
        }
        for p in swing_structure.swing_points
    ]

    if mode == "signal":
        return _generate_signal_indices(data, swings)

    # Scan mode: produce chart annotations
    is_intraday = _detect_intraday(data)
    blocks = find_order_blocks(data, swings, direction=direction)

    # Build markers for swing structure + order blocks
    markers = []

    # Add swing markers
    for s in swings:
        tier = s["tier"]
        is_high = s["type"] == "HIGH"
        position = "aboveBar" if is_high else "belowBar"

        tier_colors = {
            "T1": ("#ef4444", "#22c55e"),
            "T2": ("#f97316", "#06b6d4"),
            "FILL": ("#eab308", "#eab308"),
        }
        high_c, low_c = tier_colors.get(tier, ("#9ca3af", "#9ca3af"))
        color = high_c if is_high else low_c

        markers.append({
            "time": _format_chart_time(s["date"], is_intraday),
            "position": position,
            "color": color,
            "shape": "circle",
            "text": f"{tier}",
        })

    # Add order block markers
    for ob in blocks:
        is_bullish = ob["type"] == "bullish_ob"
        markers.append({
            "time": _format_chart_time(ob["date"], is_intraday),
            "position": "belowBar" if is_bullish else "aboveBar",
            "color": "#14b8a6" if is_bullish else "#f43f5e",
            "shape": "square",
            "text": "OB",
        })

    # Count recent OBs (last 20% of data)
    recent_cutoff = int(len(data) * 0.8)
    recent_obs = [b for b in blocks if b["index"] >= recent_cutoff]
    has_recent = len(recent_obs) > 0

    # entry_ready: True if the most recent close is inside any order block zone
    entry_ready = False
    if blocks and data:
        last_close = data[-1].close
        for b in blocks:
            if b["low"] <= last_close <= b["high"]:
                entry_ready = True
                break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec) if isinstance(spec, dict) else "unknown"
    svid = (spec.get("strategy_version_id", "order_blocks_primitive_v1") if isinstance(spec, dict) else "order_blocks_primitive_v1")
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_0_{len(data) - 1}"

    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": 1.0 if has_recent else 0.5,
        "entry_ready": entry_ready,
        "rule_checklist": [
            {
                "rule_name": "order_blocks_detected",
                "passed": len(blocks) > 0,
                "value": f"{len(blocks)} OBs found ({len(recent_obs)} recent)",
                "threshold": True,
            }
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "order_blocks_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": build_chart_data(data),
        "chart_base_start": -1,
        "chart_base_end": -1,
        "visual": {
            "markers": markers,
        },
        "node_result": {
            "passed": len(blocks) > 0,
            "score": 1.0 if entry_ready else (0.8 if has_recent else 0.5),
            "reason": f"{len(blocks)} order blocks detected" + (" (price in OB zone)" if entry_ready else ""),
        },
        "output_ports": {
            "order_blocks": {
                "count": len(blocks),
                "recent_count": len(recent_obs),
                "blocks": [
                    {
                        "type": b["type"],
                        "index": b["index"],
                        "high": b["high"],
                        "low": b["low"],
                    }
                    for b in blocks
                ],
            },
        },
    }

    return [candidate]
