#!/usr/bin/env python3
"""
MACD Histogram Primitive
========================
Computes the MACD histogram (MACD line − Signal line) and detects
momentum signals:

  - **Zero-line crossover**: histogram flips from negative to positive
    (bullish) or positive to negative (bearish).
  - **Momentum shift**: histogram changes direction (shrinking bars
    signal momentum loss before the actual crossover).

Can be used standalone on the scanner chart or composed with other
primitives (e.g. regime_filter, divergence) in a composite strategy.
"""
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


def run_macd_histogram_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    import numpy as np
    from platform_sdk.numba_indicators import macd

    setup = spec.get("setup_config", {}) or {}
    fast_period = int(setup.get("fast_period", 12))
    slow_period = int(setup.get("slow_period", 26))
    signal_period = int(setup.get("signal_period", 9))
    signal_type = setup.get("signal_type", "zero_cross")  # "zero_cross", "momentum_shift", "both"

    n = len(data)
    if n < max(slow_period, signal_period) + 5:
        return []

    closes = np.array([float(b.close) for b in data], dtype=np.float64)
    macd_line, signal_line, histogram = macd(closes, fast_period, slow_period, signal_period)

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

    # Build histogram series with color coding (green = positive, red = negative)
    hist_series = []
    macd_line_series = []
    signal_line_series = []
    start_idx = slow_period - 1

    for i in range(n):
        if i < start_idx:
            continue
        if np.isnan(histogram[i]) or np.isnan(macd_line[i]) or np.isnan(signal_line[i]):
            continue
        t = _fmt_time(data[i])
        hv = round(float(histogram[i]), 6)
        hist_series.append({
            "time": t,
            "value": hv,
            "color": "#26a69a" if hv >= 0 else "#ef5350",
        })
        macd_line_series.append({"time": t, "value": round(float(macd_line[i]), 6)})
        signal_line_series.append({"time": t, "value": round(float(signal_line[i]), 6)})

    # Detect signals on the most recent bars
    markers = []
    signal_found = False
    reason = "No signal"
    features: Dict[str, Any] = {}
    anchors: Dict[str, Any] = {}

    # Only look at the last bar (current bar) for signal detection
    last_idx = n - 1
    prev_idx = n - 2

    if last_idx >= start_idx and prev_idx >= start_idx:
        h_curr = histogram[last_idx]
        h_prev = histogram[prev_idx]

        if not (np.isnan(h_curr) or np.isnan(h_prev)):
            # Zero-line crossover
            if signal_type in ("zero_cross", "both"):
                if h_prev <= 0 < h_curr:
                    signal_found = True
                    reason = "Bullish zero-line crossover"
                    features = {
                        "type": "bullish_cross",
                        "histogram_prev": round(float(h_prev), 6),
                        "histogram_curr": round(float(h_curr), 6),
                    }
                    anchors = {"signal_bar": last_idx}
                    markers.append({
                        "time": _fmt_time(data[last_idx]),
                        "position": "belowBar",
                        "color": "#22c55e",
                        "shape": "arrowUp",
                        "text": "H+",
                    })
                elif h_prev >= 0 > h_curr:
                    signal_found = True
                    reason = "Bearish zero-line crossover"
                    features = {
                        "type": "bearish_cross",
                        "histogram_prev": round(float(h_prev), 6),
                        "histogram_curr": round(float(h_curr), 6),
                    }
                    anchors = {"signal_bar": last_idx}
                    markers.append({
                        "time": _fmt_time(data[last_idx]),
                        "position": "aboveBar",
                        "color": "#ef4444",
                        "shape": "arrowDown",
                        "text": "H-",
                    })

            # Momentum shift (histogram direction change)
            if not signal_found and signal_type in ("momentum_shift", "both"):
                prev2_idx = n - 3
                if prev2_idx >= start_idx and not np.isnan(histogram[prev2_idx]):
                    h_prev2 = histogram[prev2_idx]
                    was_shrinking_neg = (h_prev2 < h_prev < 0)
                    was_growing_pos = (h_prev2 > h_prev > 0)

                    if was_shrinking_neg and h_curr > h_prev:
                        signal_found = True
                        reason = "Bullish momentum shift (histogram turning up from below zero)"
                        features = {
                            "type": "bullish_momentum",
                            "histogram_prev2": round(float(h_prev2), 6),
                            "histogram_prev": round(float(h_prev), 6),
                            "histogram_curr": round(float(h_curr), 6),
                        }
                        anchors = {"signal_bar": last_idx}
                        markers.append({
                            "time": _fmt_time(data[last_idx]),
                            "position": "belowBar",
                            "color": "#22c55e",
                            "shape": "circle",
                            "text": "M↑",
                        })
                    elif was_growing_pos and h_curr < h_prev:
                        signal_found = True
                        reason = "Bearish momentum shift (histogram turning down from above zero)"
                        features = {
                            "type": "bearish_momentum",
                            "histogram_prev2": round(float(h_prev2), 6),
                            "histogram_prev": round(float(h_prev), 6),
                            "histogram_curr": round(float(h_curr), 6),
                        }
                        anchors = {"signal_bar": last_idx}
                        markers.append({
                            "time": _fmt_time(data[last_idx]),
                            "position": "aboveBar",
                            "color": "#ef4444",
                            "shape": "circle",
                            "text": "M↓",
                        })

    # Current histogram state (always reported)
    hist_state = "neutral"
    if last_idx >= start_idx and not np.isnan(histogram[last_idx]):
        hv = histogram[last_idx]
        if hv > 0:
            hist_state = "positive"
        elif hv < 0:
            hist_state = "negative"
        features["current_histogram"] = round(float(hv), 6)
        features["histogram_state"] = hist_state

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "macd_histogram_v1")
    candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_0_{n - 1}"

    return [{
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": 1.0 if signal_found else 0.0,
        "entry_ready": signal_found,
        "rule_checklist": [
            {
                "rule_name": "MACD Histogram Signal",
                "passed": signal_found,
                "value": reason,
                "threshold": signal_type,
            }
        ],
        "anchors": anchors,
        "window_start": 0,
        "window_end": n - 1,
        "pattern_type": "macd_histogram",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": [],
        "visual": {
            "markers": markers,
            "overlay_series": [
                {
                    "title": "Histogram",
                    "pane": "sub",
                    "lines": [{
                        "data": hist_series,
                        "color": "#6b7280",
                        "lineWidth": 1,
                        "title": "Histogram",
                        "seriesType": "histogram",
                    }],
                },
                {
                    "title": "MACD",
                    "pane": "sub",
                    "lines": [
                        {
                            "data": macd_line_series,
                            "color": "#2962FF",
                            "lineWidth": 2,
                            "title": "MACD",
                        },
                        {
                            "data": signal_line_series,
                            "color": "#F59E0B",
                            "lineWidth": 2,
                            "title": "Signal",
                        },
                    ],
                },
            ],
        },
        "node_result": {
            "passed": signal_found,
            "score": 1.0 if signal_found else 0.0,
            "features": features,
            "anchors": anchors,
            "reason": reason,
        },
        "output_ports": {
            "signal": {
                "passed": signal_found,
                "score": 1.0 if signal_found else 0.0,
                "reason": reason,
                "histogram_state": hist_state,
            }
        },
    }]
