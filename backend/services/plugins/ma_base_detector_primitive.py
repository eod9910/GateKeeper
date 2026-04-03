#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from platform_sdk.ohlcv import OHLCV


def _compute_sma(closes: List[float], period: int) -> List[float]:
    """Simple moving average, returns a list aligned with closes (nan-padded at start)."""
    result: List[float] = []
    for i in range(len(closes)):
        if i < period - 1:
            result.append(float("nan"))
        else:
            result.append(sum(closes[i - period + 1 : i + 1]) / period)
    return result


def _compute_ema(closes: List[float], period: int) -> List[float]:
    """Exponential moving average, returns a list aligned with closes."""
    k = 2.0 / (period + 1)
    result: List[float] = []
    ema = None
    for i, c in enumerate(closes):
        if i < period - 1:
            result.append(float("nan"))
        elif i == period - 1:
            ema = sum(closes[:period]) / period
            result.append(ema)
        else:
            ema = c * k + ema * (1 - k)
            result.append(ema)
    return result


def run_ma_base_detector_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Primitive intent=LOCATION.

    Detects whether price is currently 'basing' — contained inside the upper
    and lower deviation bands of a moving average.

    A bar is 'basing' when:
        abs((close - MA) / MA * 100) < dev_threshold_pct

    Parameters (in setup_config):
        ma_period          : int   — MA lookback period (default 89)
        ma_type            : str   — "SMA" or "EMA" (default "SMA")
        dev_threshold_pct  : float — half-width of the base channel in % (default 10.0)
        min_bars_in_base   : int   — how many consecutive bars must be inside the channel (default 5)
    """
    setup = spec.get("setup_config", {}) or {}

    ma_period: int = int(setup.get("ma_period", 89))
    ma_type: str = str(setup.get("ma_type", "SMA")).upper()
    dev_threshold_pct: float = float(setup.get("dev_threshold_pct", 10.0))
    min_bars_in_base: int = int(setup.get("min_bars_in_base", 5))

    if len(data) < ma_period + min_bars_in_base:
        return []

    closes = [float(b.close) for b in data]

    if ma_type == "EMA":
        ma_values = _compute_ema(closes, ma_period)
    else:
        ma_values = _compute_sma(closes, ma_period)

    # Walk backward from the current bar, counting consecutive bars inside the channel
    consecutive_in_base = 0
    for i in range(len(data) - 1, -1, -1):
        ma = ma_values[i]
        if ma != ma:  # nan check
            break
        dev_pct = abs((closes[i] - ma) / ma * 100.0) if ma != 0 else 999.0
        if dev_pct < dev_threshold_pct:
            consecutive_in_base += 1
        else:
            break

    passed = consecutive_in_base >= min_bars_in_base

    # Current-bar metrics for output
    last_ma = ma_values[-1]
    last_close = closes[-1]
    current_dev_pct = abs((last_close - last_ma) / last_ma * 100.0) if last_ma and last_ma == last_ma else 999.0
    upper_band = last_ma * (1 + dev_threshold_pct / 100.0) if last_ma == last_ma else 0.0
    lower_band = last_ma * (1 - dev_threshold_pct / 100.0) if last_ma == last_ma else 0.0

    score = round(max(0.0, 1.0 - current_dev_pct / dev_threshold_pct), 3) if passed else 0.0

    reason = (
        f"Basing: {consecutive_in_base} bars inside ±{dev_threshold_pct}% of {ma_type}({ma_period}) "
        f"[dev={current_dev_pct:.2f}%]"
        if passed
        else f"Not basing: only {consecutive_in_base}/{min_bars_in_base} bars inside channel "
        f"[dev={current_dev_pct:.2f}%]"
    )

    svid = spec.get("strategy_version_id", "ma_base_detector_primitive_v1")
    spec_hash = spec.get("spec_hash", "nohash")
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_0_{window_end}"

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
                "rule_name": "ma_base_channel",
                "passed": passed,
                "value": reason,
                "threshold": True,
            }
        ],
        "anchors": [],
        "window_start": 0,
        "window_end": window_end,
        "pattern_type": "ma_base_detector_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": [],
        "node_result": {
            "passed": passed,
            "score": score,
            "reason": reason,
        },
        "output_ports": {
            "signal": {
                "passed": passed,
                "score": score,
                "reason": reason,
            },
            "base_metrics": {
                "ma_value": round(last_ma, 4) if last_ma == last_ma else None,
                "current_dev_pct": round(current_dev_pct, 3),
                "upper_band": round(upper_band, 4),
                "lower_band": round(lower_band, 4),
                "consecutive_bars_in_base": consecutive_in_base,
                "ma_period": ma_period,
                "ma_type": ma_type,
                "dev_threshold_pct": dev_threshold_pct,
            },
        },
    }
    return [candidate]
