#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List

from platform_sdk.ohlcv import OHLCV

def compute_spec_hash(spec: Dict[str, Any]) -> str:
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

def run_macd_divergence_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    import numpy as np
    from platform_sdk.numba_indicators import macd
    from platform_sdk.rdp import detect_swings_rdp

    # Read setup parameters with defaults
    setup = spec.get("setup_config", {}) or {}
    fast_period = int(setup.get("fast_period", 12))
    slow_period = int(setup.get("slow_period", 26))
    signal_period = int(setup.get("signal_period", 9))
    divergence_type = setup.get("divergence_type", "both")  # "bullish", "bearish", "both"
    divergence_source = setup.get("divergence_source", "macd_line")  # "macd_line" or "histogram"
    epsilon_pct = float(setup.get("epsilon_pct", 0.05))

    n = len(data)
    if n < max(slow_period, signal_period) + 5:
        return []

    # Extract closing prices as numpy array once.
    closes = np.array([float(b.close) for b in data], dtype=np.float64)

    # Compute MACD values (macd_line, signal_line, histogram)
    macd_line, signal_line, histogram = macd(closes, fast_period, slow_period, signal_period)

    # Choose which MACD component to use for divergence detection
    div_values = histogram if divergence_source == "histogram" else macd_line

    # Build overlay series: prepare two series (MACD and Signal) using calculated arrays
    # First, determine if we are on an intraday timeframe.
    def _is_intraday(tf: str) -> bool:
        return tf in ("1m", "5m", "15m", "30m", "1h", "4h")

    intraday = _is_intraday(timeframe)

    def _fmt_time(bar: OHLCV) -> Any:
        ts = bar.timestamp
        if intraday:
            if isinstance(ts, (int, float)):
                return int(ts)
            from datetime import datetime as dt
            if isinstance(ts, str):
                return int(dt.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
            return int(ts.timestamp())
        else:
            from datetime import datetime as dt
            if isinstance(ts, str):
                d = dt.fromisoformat(ts.replace("Z", "+00:00"))
                return {"year": d.year, "month": d.month, "day": d.day}
            if isinstance(ts, (int, float)):
                d = dt.utcfromtimestamp(ts)
                return {"year": d.year, "month": d.month, "day": d.day}
            return {"year": ts.year, "month": ts.month, "day": ts.day}

    macd_series = []
    signal_series = []
    for i in range(n):
        # Make sure we have computed values (skip early bars if needed)
        if i < slow_period - 1:
            continue
        if np.isnan(macd_line[i]) or np.isnan(signal_line[i]):
            continue
        macd_series.append({
            "time": _fmt_time(data[i]),
            "value": round(float(macd_line[i]), 4)
        })
        signal_series.append({
            "time": _fmt_time(data[i]),
            "value": round(float(signal_line[i]), 4)
        })

    # Detect price swing points using the RDP algorithm.
    # RDP auto-adapts epsilon per symbol to find the right swing granularity.
    # This adaptive behavior is a feature — it's why the strategy generalizes
    # across the full universe. Do NOT use use_exact_epsilon=True here.
    swing_struct = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)

    markers = []
    divergence_found = False
    reason = "No divergence"
    features = {}
    anchors = {}

    # Separate swing points into highs and lows.
    swing_highs = [sp for sp in swing_struct.swing_points if sp.point_type == "HIGH"]
    swing_lows = [sp for sp in swing_struct.swing_points if sp.point_type == "LOW"]

    # Check for bearish divergence: price higher high, histogram/MACD lower.
    if divergence_type in ("bearish", "both") and len(swing_highs) >= 2:
        sp1 = swing_highs[-2]
        sp2 = swing_highs[-1]
        if sp2.price > sp1.price:
            dv1 = div_values[sp1.index] if sp1.index < len(div_values) else None
            dv2 = div_values[sp2.index] if sp2.index < len(div_values) else None
            if (dv1 is not None and dv2 is not None and
                not np.isnan(dv1) and not np.isnan(dv2) and
                dv2 < dv1):
                divergence_found = True
                reason = f"Bearish divergence ({divergence_source})"
                features = {
                    "type": "bearish",
                    "divergence_source": divergence_source,
                    "swing1_price": sp1.price,
                    "swing2_price": sp2.price,
                    "div_val1": float(dv1),
                    "div_val2": float(dv2),
                }
                anchors = {"swing1_index": sp1.index, "swing2_index": sp2.index}
                markers.append({
                    "time": _fmt_time(data[sp2.index]),
                    "position": "aboveBar",
                    "color": "#ef4444",
                    "shape": "arrowDown",
                    "text": "BD"
                })

    # Check for bullish divergence: price lower low, histogram/MACD higher.
    if not divergence_found and divergence_type in ("bullish", "both") and len(swing_lows) >= 2:
        sp1 = swing_lows[-2]
        sp2 = swing_lows[-1]
        if sp2.price < sp1.price:
            dv1 = div_values[sp1.index] if sp1.index < len(div_values) else None
            dv2 = div_values[sp2.index] if sp2.index < len(div_values) else None
            if (dv1 is not None and dv2 is not None and
                not np.isnan(dv1) and not np.isnan(dv2) and
                dv2 > dv1):
                divergence_found = True
                reason = f"Bullish divergence ({divergence_source})"
                features = {
                    "type": "bullish",
                    "divergence_source": divergence_source,
                    "swing1_price": sp1.price,
                    "swing2_price": sp2.price,
                    "div_val1": float(dv1),
                    "div_val2": float(dv2),
                }
                anchors = {"swing1_index": sp1.index, "swing2_index": sp2.index}
                markers.append({
                    "time": _fmt_time(data[sp2.index]),
                    "position": "belowBar",
                    "color": "#22c55e",
                    "shape": "arrowUp",
                    "text": "BD"
                })

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "macd_divergence_primitive_v1")
    candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_0_{n-1}"
    
    candidate = {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": 1.0 if divergence_found else 0.0,
        "entry_ready": divergence_found,
        "rule_checklist": [
            {
                "rule_name": "MACD Divergence Detected",
                "passed": divergence_found,
                "value": reason,
                "threshold": "bullish or bearish divergence on " + divergence_source
            }
        ],
        "anchors": anchors,
        "window_start": 0,
        "window_end": n - 1,
        "pattern_type": "macd_divergence_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": [],
        "visual": {
            "markers": markers,
            "overlay_series": [
                {
                    "title": "MACD",
                    "series": [{
                        "data": macd_series,
                        "color": "#2962FF",
                        "lineWidth": 2,
                        "label": "MACD"
                    }],
                    "hlines": []
                },
                {
                    "title": "Signal",
                    "series": [{
                        "data": signal_series,
                        "color": "#F59E0B",
                        "lineWidth": 2,
                        "label": "Signal"
                    }],
                    "hlines": []
                }
            ]
        },
        "node_result": {
            "passed": divergence_found,
            "score": 1.0 if divergence_found else 0.0,
            "features": features,
            "anchors": anchors,
            "reason": reason
        },
        "output_ports": {
            "signal": {
                "passed": divergence_found,
                "score": 1.0 if divergence_found else 0.0,
                "reason": reason
            }
        },
    }
    return [candidate]