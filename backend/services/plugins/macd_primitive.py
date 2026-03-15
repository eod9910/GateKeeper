#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import sys
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


def run_macd_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Primitive: MACD (Moving Average Convergence Divergence).
    Answers ONE question: Did the MACD line cross the signal line?

    ALL behavior is controlled via tunable params in setup_config:
      fast_period:       int   (default 12)
      slow_period:       int   (default 26)
      signal_period:     int   (default 9)
      cross_direction:   str   (default "bullish") — "bullish" or "bearish"
      histogram_min:     float (default 0.0) — min abs histogram value
      lookback_bars:     int   (default 500)
    """
    import numpy as np

    setup = spec.get("setup_config", {}) or {}
    fast_period = int(setup.get("fast_period", 12))
    slow_period = int(setup.get("slow_period", 26))
    signal_period = int(setup.get("signal_period", 9))
    cross_dir = str(setup.get("cross_direction", "bullish")).lower().strip()
    histogram_min = float(setup.get("histogram_min", 0.0))
    lookback_bars = int(setup.get("lookback_bars", 500))

    n = len(data)
    if n < slow_period + signal_period + 5:
        print(f"[MACD] Not enough data: {n} bars", file=sys.stderr)
        return []

    closes = np.array([float(bar.close) for bar in data], dtype=float)

    def calc_ema(arr, period):
        out = np.full_like(arr, np.nan)
        mult = 2.0 / (period + 1)
        out[period - 1] = np.mean(arr[:period])
        for i in range(period, len(arr)):
            out[i] = (arr[i] - out[i - 1]) * mult + out[i - 1]
        return out

    fast_ema = calc_ema(closes, fast_period)
    slow_ema = calc_ema(closes, slow_period)
    macd_line = fast_ema - slow_ema
    signal_line = calc_ema(macd_line[~np.isnan(macd_line)], signal_period)

    # Align signal_line back into full-length array
    sig_full = np.full_like(macd_line, np.nan)
    valid_start = int(np.argmax(~np.isnan(macd_line)))
    if len(signal_line) > 0:
        sig_full[valid_start:valid_start + len(signal_line)] = signal_line

    histogram = macd_line - sig_full

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    spec_hash_short = spec_hash[:12]
    svid = spec.get("strategy_version_id", f"macd_primitive_v1")

    search_start = max(slow_period + signal_period, n - lookback_bars) if lookback_bars > 0 else slow_period + signal_period
    candidates = []

    for i in range(search_start, n):
        if np.isnan(macd_line[i]) or np.isnan(sig_full[i]) or np.isnan(macd_line[i-1]) or np.isnan(sig_full[i-1]):
            continue
        if cross_dir == "bullish":
            crossed = bool(macd_line[i] > sig_full[i] and macd_line[i-1] <= sig_full[i-1])
        else:
            crossed = bool(macd_line[i] < sig_full[i] and macd_line[i-1] >= sig_full[i-1])
        if not crossed:
            continue

        hist_val = float(histogram[i]) if not np.isnan(histogram[i]) else 0.0
        if abs(hist_val) < histogram_min:
            continue

        score = min(1.0, 0.5 + abs(hist_val) * 10)
        cid = f"{symbol}_{timeframe}_{svid}_{spec_hash_short}_{i}"

        reason = f"MACD {'bullish' if cross_dir == 'bullish' else 'bearish'} cross (hist={hist_val:.4f})"
        candidates.append({
            "candidate_id": cid, "id": cid,
            "strategy_version_id": svid, "spec_hash": spec_hash,
            "symbol": symbol, "timeframe": timeframe,
            "score": round(float(score), 3), "entry_ready": True,
            "rule_checklist": [
                {"rule_name": "MACD Signal Cross", "passed": True, "value": round(float(macd_line[i]), 4), "threshold": round(float(sig_full[i]), 4)},
                {"rule_name": "Histogram Strength", "passed": abs(hist_val) >= histogram_min, "value": round(hist_val, 4), "threshold": histogram_min},
            ],
            "anchors": {"cross_bar": {"index": i, "timestamp": data[i].timestamp}},
            "window_start": i, "window_end": i,
            "pattern_type": "macd_primitive",
            "created_at": datetime.utcnow().isoformat() + "Z",
            "chart_data": [],
            "node_result": {
                "passed": True, "score": round(float(score), 3),
                "features": {"fast": fast_period, "slow": slow_period, "signal": signal_period, "cross_dir": cross_dir, "histogram": round(hist_val, 4)},
                "anchors": {"cross_bar": {"index": i}},
                "reason": reason,
            },
            "output_ports": {
                "signal": {"passed": True, "score": round(float(score), 3), "reason": reason},
            },
        })

    print(f"[MACD] Found {len(candidates)} signals for {symbol}", file=sys.stderr)
    return candidates