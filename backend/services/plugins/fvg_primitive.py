#!/usr/bin/env python3
"""
Fair Value Gaps (FVG) Primitive
===============================
Identifies Fair Value Gaps in price data.

An FVG occurs when there is a gap between the high of bar[i-2] and the low of bar[i],
indicating an imbalance in the market.

- Bullish FVG: bar[i].low > bar[i-2].high (price gapped up, imbalance below)
- Bearish FVG: bar[i].high < bar[i-2].low (price gapped down, imbalance above)

Dual-mode:
  - "scan": Returns chart annotations (markers) and pass/fail for scanning a universe.
  - "signal": Returns bar indices where FVGs occur, for backtesting.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time


def compute_spec_hash(spec: dict) -> str:
    raw = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def build_chart_data(data: List[OHLCV]) -> List[dict]:
    is_intraday = _detect_intraday(data)
    return [
        {
            "time": _format_chart_time(bar.date, is_intraday),
            "open": bar.open,
            "high": bar.high,
            "low": bar.low,
            "close": bar.close,
            "volume": getattr(bar, "volume", 0),
        }
        for bar in data
    ]


def find_fvgs(
    data: List[OHLCV],
    min_gap_pct: float = 0.0,
) -> List[Dict[str, Any]]:
    """Find all Fair Value Gaps in the data."""
    gaps = []
    for i in range(2, len(data)):
        bar0 = data[i - 2]
        bar2 = data[i]

        # Bullish FVG: bar2.low > bar0.high
        if bar2.low > bar0.high:
            gap_size = bar2.low - bar0.high
            gap_pct = gap_size / bar0.high * 100 if bar0.high > 0 else 0
            if gap_pct >= min_gap_pct:
                gaps.append({
                    "index": i - 1,
                    "type": "bullish_fvg",
                    "high": bar2.low,
                    "low": bar0.high,
                    "gap_size": gap_size,
                    "gap_pct": gap_pct,
                    "date": data[i - 1].date,
                })

        # Bearish FVG: bar2.high < bar0.low
        if bar2.high < bar0.low:
            gap_size = bar0.low - bar2.high
            gap_pct = gap_size / bar0.low * 100 if bar0.low > 0 else 0
            if gap_pct >= min_gap_pct:
                gaps.append({
                    "index": i - 1,
                    "type": "bearish_fvg",
                    "high": bar0.low,
                    "low": bar2.high,
                    "gap_size": gap_size,
                    "gap_pct": gap_pct,
                    "date": data[i - 1].date,
                })

    return gaps


def _generate_signal_indices(
    data: List[OHLCV],
    min_gap_pct: float = 0.0,
) -> Set[int]:
    """Return bar indices where FVGs occur (for backtesting)."""
    gaps = find_fvgs(data, min_gap_pct=min_gap_pct)
    return {g["index"] for g in gaps}


def run_fvg_primitive_plugin(
    data: List[OHLCV],
    symbol: str,
    timeframe: str,
    spec: Dict[str, Any],
    mode: str = "scan",
    **kwargs,
) -> Any:
    """Entry point for the FVG primitive."""
    setup = spec.get("setup_config", spec.get("structure_config", {}))
    min_gap_pct = float(setup.get("min_gap_pct", 0.0))

    if mode == "signal":
        return _generate_signal_indices(data, min_gap_pct=min_gap_pct)

    # Scan mode: produce chart annotations
    is_intraday = _detect_intraday(data)
    gaps = find_fvgs(data, min_gap_pct=min_gap_pct)

    markers = []
    for gap in gaps:
        is_bullish = gap["type"] == "bullish_fvg"
        markers.append({
            "time": _format_chart_time(gap["date"], is_intraday),
            "position": "belowBar" if is_bullish else "aboveBar",
            "color": "#a855f7" if is_bullish else "#f472b6",
            "shape": "circle",
            "text": f"FVG {gap['gap_pct']:.1f}%",
        })

    # Count recent FVGs (last 20% of data)
    recent_cutoff = int(len(data) * 0.8)
    recent_fvgs = [g for g in gaps if g["index"] >= recent_cutoff]
    has_recent = len(recent_fvgs) > 0

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "fvg_primitive_v1")
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_0_{len(data) - 1}"

    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": 1.0 if has_recent else 0.5,
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "fvg_detected",
                "passed": len(gaps) > 0,
                "value": f"{len(gaps)} FVGs found ({len(recent_fvgs)} recent)",
                "threshold": True,
            }
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "fvg_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": build_chart_data(data),
        "chart_base_start": -1,
        "chart_base_end": -1,
        "visual": {
            "markers": markers,
        },
        "node_result": {
            "passed": len(gaps) > 0,
            "score": 1.0 if has_recent else 0.5,
            "reason": f"{len(gaps)} fair value gaps detected",
        },
        "output_ports": {
            "fvg": {
                "count": len(gaps),
                "recent_count": len(recent_fvgs),
                "gaps": [
                    {
                        "type": g["type"],
                        "index": g["index"],
                        "high": g["high"],
                        "low": g["low"],
                        "gap_pct": g["gap_pct"],
                    }
                    for g in gaps
                ],
            },
        },
    }

    return [candidate]
