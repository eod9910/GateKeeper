#!/usr/bin/env python3
"""
MA Base Detector — Indicator version.

Renders on the price chart:
  - The MA line (89 SMA by default)
  - Upper deviation band  (MA * (1 + dev%))
  - Lower deviation band  (MA * (1 - dev%))
  - Background shading on bars that are inside the channel (basing)
  - A marker on the most recent bar if currently basing

Tunable params (from spec.setup_config):
    ma_period         int   (default 89)   — MA lookback period
    ma_type           str   (default "SMA") — "SMA" or "EMA"
    dev_threshold_pct float (default 10.0) — half-width of the base channel (%)
    min_bars_in_base  int   (default 5)    — consecutive bars required to call a base
    lookback_bars     int   (default 500)  — how many bars to scan for base zones
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time


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


def _calc_sma(closes: List[float], period: int) -> List[float]:
    import numpy as np
    arr = np.array(closes, dtype=float)
    out = np.full(len(arr), np.nan)
    for i in range(period - 1, len(arr)):
        out[i] = arr[i - period + 1 : i + 1].mean()
    return out.tolist()


def _calc_ema(closes: List[float], period: int) -> List[float]:
    import numpy as np
    arr = np.array(closes, dtype=float)
    out = np.full(len(arr), np.nan)
    k = 2.0 / (period + 1)
    out[period - 1] = arr[:period].mean()
    for i in range(period, len(arr)):
        out[i] = arr[i] * k + out[i - 1] * (1 - k)
    return out.tolist()


def run_ma_base_detector_indicator_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Indicator version of MA Base Detector.
    Scans for base zones (consecutive bars inside the deviation channel)
    and renders the MA + upper/lower bands as overlays on the price chart.
    """
    setup = spec.get("setup_config", {}) or {}
    strategy_version_id = spec.get(
        "strategy_version_id",
        f"{spec.get('strategy_id', 'unknown')}_v{spec.get('version', '0')}",
    )
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)

    ma_period: int = int(setup.get("ma_period", 89))
    ma_type: str = str(setup.get("ma_type", "SMA")).upper()
    dev_threshold_pct: float = float(setup.get("dev_threshold_pct", 10.0))
    min_bars_in_base: int = int(setup.get("min_bars_in_base", 5))
    lookback_bars: int = int(setup.get("lookback_bars", 500))

    n = len(data)
    if n < ma_period + 2:
        print(f"[MA Base Detector] Not enough data: {n} bars, need {ma_period + 2}", file=sys.stderr)
        return []

    closes = [float(b.close) for b in data]

    if ma_type == "EMA":
        ma_values = _calc_ema(closes, ma_period)
    else:
        ma_values = _calc_sma(closes, ma_period)

    # ── Compute per-bar deviation and band membership ────────────────────────
    import math

    is_basing: List[bool] = []
    upper_band: List[float] = []
    lower_band: List[float] = []

    for i in range(n):
        ma = ma_values[i]
        if math.isnan(ma) or ma == 0:
            is_basing.append(False)
            upper_band.append(float("nan"))
            lower_band.append(float("nan"))
            continue
        ub = ma * (1 + dev_threshold_pct / 100.0)
        lb = ma * (1 - dev_threshold_pct / 100.0)
        upper_band.append(ub)
        lower_band.append(lb)
        dev_pct = abs((closes[i] - ma) / ma * 100.0)
        is_basing.append(dev_pct < dev_threshold_pct)

    # ── Find base zones: runs of >= min_bars_in_base consecutive basing bars ─
    # A zone is (start_idx, end_idx) inclusive
    base_zones: List[tuple] = []
    run_start: int | None = None
    for i in range(n):
        if is_basing[i]:
            if run_start is None:
                run_start = i
        else:
            if run_start is not None:
                run_len = i - run_start
                if run_len >= min_bars_in_base:
                    base_zones.append((run_start, i - 1))
                run_start = None
    if run_start is not None:
        run_len = n - run_start
        if run_len >= min_bars_in_base:
            base_zones.append((run_start, n - 1))

    # ── Build chart data and overlays ────────────────────────────────────────
    chart_start = max(0, n - lookback_bars)
    is_intraday = _detect_intraday(data)

    chart_data: List[Dict] = []
    ma_line: List[Dict] = []
    upper_line: List[Dict] = []
    lower_line: List[Dict] = []

    for i in range(chart_start, n):
        bar = data[i]
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t is None:
            continue

        chart_data.append({
            "time": t,
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
        })

        ma = ma_values[i]
        if not math.isnan(ma):
            ma_line.append({"time": t, "value": round(ma, 4)})
            upper_line.append({"time": t, "value": round(upper_band[i], 4)})
            lower_line.append({"time": t, "value": round(lower_band[i], 4)})

    overlays = [
        {
            "type": "line",
            "label": f"{ma_type}({ma_period})",
            "color": "#F59E0B",   # amber — the MA spine
            "lineWidth": 2,
            "data": ma_line,
        },
        {
            "type": "line",
            "label": f"+{dev_threshold_pct}% Band",
            "color": "#6366F1",   # indigo — upper band
            "lineWidth": 1,
            "lineStyle": 2,       # dashed
            "data": upper_line,
        },
        {
            "type": "line",
            "label": f"-{dev_threshold_pct}% Band",
            "color": "#6366F1",   # indigo — lower band
            "lineWidth": 1,
            "lineStyle": 2,
            "data": lower_line,
        },
    ]

    # ── Current bar state ────────────────────────────────────────────────────
    # Count consecutive basing bars ending at the last bar
    consecutive_in_base = 0
    for i in range(n - 1, -1, -1):
        if is_basing[i]:
            consecutive_in_base += 1
        else:
            break

    currently_basing = consecutive_in_base >= min_bars_in_base
    last_ma = ma_values[-1] if not math.isnan(ma_values[-1]) else None
    last_close = closes[-1]
    current_dev_pct = (
        abs((last_close - last_ma) / last_ma * 100.0) if last_ma else 999.0
    )

    # ── Markers — one per base zone (entry bar of zone) ─────────────────────
    markers = []
    last_t = _format_chart_time(data[-1].timestamp, is_intraday)

    for zone_start, zone_end in base_zones:
        if zone_end < chart_start:
            continue
        bar = data[zone_start]
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t is None:
            continue
        markers.append({
            "time": t,
            "position": "belowBar",
            "color": "#6366F1",
            "shape": "arrowUp",
            "text": f"BASE ({zone_end - zone_start + 1}b)",
        })

    # Current-bar label if actively basing
    if currently_basing and last_t:
        markers.append({
            "time": last_t,
            "position": "aboveBar",
            "color": "#22C55E",
            "shape": "circle",
            "text": f"BASING ({consecutive_in_base}b | dev {current_dev_pct:.1f}%)",
        })

    # ── Score ────────────────────────────────────────────────────────────────
    score = round(max(0.0, 1.0 - current_dev_pct / dev_threshold_pct), 3) if currently_basing else 0.0

    reason = (
        f"Basing: {consecutive_in_base} bars inside ±{dev_threshold_pct}% of "
        f"{ma_type}({ma_period}) [dev={current_dev_pct:.2f}%]"
        if currently_basing
        else f"Not basing: dev={current_dev_pct:.2f}% exceeds ±{dev_threshold_pct}% threshold"
    )

    candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:8]}_{chart_start}_{n - 1}"

    candidate = {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": currently_basing,
        "rule_checklist": [
            {
                "rule_name": "MA base channel",
                "passed": currently_basing,
                "value": reason,
                "threshold": f"≥{min_bars_in_base} consecutive bars within ±{dev_threshold_pct}% of {ma_type}({ma_period})",
            }
        ],
        "anchors": {
            "ma_value": round(last_ma, 4) if last_ma else None,
            "upper_band": round(upper_band[-1], 4) if not math.isnan(upper_band[-1]) else None,
            "lower_band": round(lower_band[-1], 4) if not math.isnan(lower_band[-1]) else None,
            "current_dev_pct": round(current_dev_pct, 3),
            "consecutive_bars_in_base": consecutive_in_base,
            "total_base_zones_found": len(base_zones),
        },
        "window_start": chart_start,
        "window_end": n - 1,
        "pattern_type": "ma_base_detector_indicator",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": chart_data,
        "overlays": overlays,
        "visual": {
            "markers": markers,
        },
        "node_result": {
            "passed": currently_basing,
            "score": score,
            "reason": reason,
            "features": {
                "ma_period": ma_period,
                "ma_type": ma_type,
                "dev_threshold_pct": dev_threshold_pct,
                "min_bars_in_base": min_bars_in_base,
                "consecutive_bars_in_base": consecutive_in_base,
                "current_dev_pct": round(current_dev_pct, 3),
                "base_zones_found": len(base_zones),
            },
        },
        "output_ports": {
            "signal": {
                "passed": currently_basing,
                "score": score,
                "reason": reason,
            },
            "base_metrics": {
                "ma_value": round(last_ma, 4) if last_ma else None,
                "upper_band": round(upper_band[-1], 4) if not math.isnan(upper_band[-1]) else None,
                "lower_band": round(lower_band[-1], 4) if not math.isnan(lower_band[-1]) else None,
                "current_dev_pct": round(current_dev_pct, 3),
                "consecutive_bars_in_base": consecutive_in_base,
            },
        },
    }

    print(
        f"[MA Base Detector] {symbol}: currently_basing={currently_basing}, "
        f"dev={current_dev_pct:.2f}%, consecutive={consecutive_in_base}, "
        f"zones={len(base_zones)}",
        file=sys.stderr,
    )
    return [candidate]
