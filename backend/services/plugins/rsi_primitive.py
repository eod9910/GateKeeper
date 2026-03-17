#!/usr/bin/env python3
"""
RSI Primitive — Generic Relative Strength Index crossover detector.

Dual mode:
    mode="scan"   → returns candidates with chart_data + overlay_series (RSI sub-panel)
    mode="signal" → returns set[int] of causal signal bar indices for backtesting

Tunable params (from spec.setup_config):
    rsi_period:       int   (default 14)    — RSI calculation period
    rsi_threshold:    float (default 30)    — level that triggers the signal
    cross_direction:  str   (default "below") — "below" or "above"
    overbought_level: float (default 70)    — informational OB level
    oversold_level:   float (default 30)    — informational OS level
    lookback_bars:    int   (default 500)   — only find crosses in last N bars
    score_min:        float (default 0.0)   — minimum score to keep
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Set, Union


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


def _get_ohlc(bar: Any) -> tuple:
    """Return (open, high, low, close) from bar (dict or OHLCV dataclass)."""
    if isinstance(bar, dict):
        return (
            float(bar["open"]),
            float(bar["high"]),
            float(bar["low"]),
            float(bar["close"]),
        )
    return (float(bar.open), float(bar.high), float(bar.low), float(bar.close))


def _get_close(bar: Any) -> float:
    if isinstance(bar, dict):
        return float(bar["close"])
    return float(bar.close)


def _get_timestamp(bar: Any) -> str:
    if isinstance(bar, dict):
        return bar.get("timestamp", "")
    return getattr(bar, "timestamp", "")


def _format_chart_time(ts: str, is_intraday: bool = False):
    """Format timestamp for LightweightCharts (mirrors patternScanner logic)."""
    if not ts:
        return None
    if is_intraday:
        try:
            dt = datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S")
            return int(dt.timestamp())
        except Exception:
            return ts[:10] if len(ts) >= 10 else ts
    return ts[:10] if len(ts) >= 10 else ts


def _detect_intraday(data: list) -> bool:
    """Check if data has multiple bars on the same calendar date."""
    dates: Dict[str, int] = {}
    for bar in data[:50]:
        ts = _get_timestamp(bar)
        if ts and len(ts) >= 10:
            day = ts[:10]
            dates[day] = dates.get(day, 0) + 1
            if dates[day] > 1:
                return True
    return False


def _calculate_rsi(prices: List[float], period: int) -> List[float]:
    if len(prices) < period + 1:
        return []
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    seed = deltas[:period]
    up = sum(x for x in seed if x > 0) / period
    down = -sum(x for x in seed if x < 0) / period
    rs = up / down if down != 0 else 0
    rsi = [100.0 - 100.0 / (1.0 + rs)]

    for delta in deltas[period:]:
        upval = max(delta, 0)
        downval = -min(delta, 0)
        up = (up * (period - 1) + upval) / period
        down = (down * (period - 1) + downval) / period
        rs = up / down if down != 0 else 0
        rsi.append(100.0 - 100.0 / (1.0 + rs))

    return rsi


def _build_chart_data(data: list, is_intraday: bool) -> list:
    """Build chart_data array from OHLCV bars for LightweightCharts."""
    chart_data = []
    for bar in data:
        ts = _get_timestamp(bar)
        time_val = _format_chart_time(ts, is_intraday)
        if time_val is None:
            continue
        o, h, l, c = _get_ohlc(bar)
        chart_data.append({
            "time": time_val,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
        })
    return chart_data


def _build_rsi_overlay(
    data: list,
    rsi_values: List[float],
    rsi_offset: int,
    rsi_period: int,
    overbought: float,
    oversold: float,
    is_intraday: bool,
) -> Dict[str, Any]:
    """Build overlay_series panel for the RSI line (sub-panel below chart)."""
    rsi_line_data = []
    for i, rsi_val in enumerate(rsi_values):
        bar_idx = i + rsi_offset
        if bar_idx >= len(data):
            break
        ts = _get_timestamp(data[bar_idx])
        time_val = _format_chart_time(ts, is_intraday)
        if time_val is None:
            continue
        rsi_line_data.append({"time": time_val, "value": round(rsi_val, 2)})

    return {
        "title": f"RSI({rsi_period})",
        "height": 150,
        "series": [
            {
                "data": rsi_line_data,
                "color": "#7c3aed",
                "lineWidth": 2,
                "label": f"RSI({rsi_period})",
            }
        ],
        "hlines": [
            {
                "value": overbought,
                "color": "#ef4444",
                "lineWidth": 1,
                "lineStyle": 2,
                "label": f"OB {overbought:.0f}",
            },
            {
                "value": oversold,
                "color": "#22c55e",
                "lineWidth": 1,
                "lineStyle": 2,
                "label": f"OS {oversold:.0f}",
            },
            {
                "value": 50,
                "color": "#6b7280",
                "lineWidth": 1,
                "lineStyle": 2,
                "label": "50",
                "axisLabel": False,
            },
        ],
    }


def _generate_signal_indices(
    data: list, spec: Dict[str, Any], timeframe: str
) -> Set[int]:
    """Causal bar-by-bar signal generation for backtesting (no lookahead)."""
    setup = spec.get("setup_config", {}) or {}
    rsi_period = int(setup.get("rsi_period", 14))
    rsi_threshold = float(setup.get("rsi_threshold", 30))
    cross_direction = str(setup.get("cross_direction", "below")).lower().strip()

    n = len(data)
    if n < rsi_period + 5:
        return set()

    prices = [_get_close(bar) for bar in data]
    rsi_values = _calculate_rsi(prices, rsi_period)
    if not rsi_values:
        return set()

    rsi_offset = n - len(rsi_values)
    signals: Set[int] = set()

    for i in range(1, len(rsi_values)):
        prev_rsi = rsi_values[i - 1]
        curr_rsi = rsi_values[i]
        bar_idx = i + rsi_offset

        if cross_direction == "below":
            crossed = prev_rsi >= rsi_threshold and curr_rsi < rsi_threshold
        else:
            crossed = prev_rsi <= rsi_threshold and curr_rsi > rsi_threshold

        if crossed:
            signals.add(bar_idx)

    print(
        f"[RSI signal] {len(signals)} signals for {timeframe} "
        f"(period={rsi_period}, threshold={rsi_threshold}, dir={cross_direction})",
        file=sys.stderr,
    )
    return signals


def run_rsi_primitive_plugin(
    data: List[Any],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Union[List[Dict[str, Any]], Set[int]]:
    """
    Generic RSI crossover detector with dual mode support.

    mode="scan"   → List[Dict] of candidates with chart_data + overlay_series
    mode="signal" → set[int]  of causal signal bar indices
    """
    if mode == "signal":
        return _generate_signal_indices(data, spec, timeframe)

    setup = spec.get("setup_config", {}) or {}

    rsi_period = int(setup.get("rsi_period", 14))
    rsi_threshold = float(setup.get("rsi_threshold", 30))
    cross_direction = str(setup.get("cross_direction", "below")).lower().strip()
    overbought = float(setup.get("overbought_level", 70))
    oversold = float(setup.get("oversold_level", 30))
    lookback_bars = int(setup.get("lookback_bars", 500))
    score_min = float(setup.get("score_min", 0.0))

    n = len(data)
    if n < rsi_period + 5:
        print(f"[RSI] Not enough data: {n} bars, need {rsi_period + 5}", file=sys.stderr)
        return []

    prices = [_get_close(bar) for bar in data]
    rsi_values = _calculate_rsi(prices, rsi_period)
    if not rsi_values:
        return []

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    spec_hash_short = spec_hash[:12]
    svid = spec.get(
        "strategy_version_id",
        f"{spec.get('strategy_id', 'rsi_primitive')}_v{spec.get('version', '1')}",
    )

    rsi_offset = n - len(rsi_values)
    search_start = max(1, len(rsi_values) - lookback_bars) if lookback_bars > 0 else 1

    # Pre-build chart_data and overlay_series (shared across candidates)
    is_intraday = _detect_intraday(data)
    chart_data = _build_chart_data(data, is_intraday)
    rsi_overlay = _build_rsi_overlay(
        data, rsi_values, rsi_offset, rsi_period, overbought, oversold, is_intraday
    )

    candidates: List[Dict[str, Any]] = []

    for i in range(search_start, len(rsi_values)):
        bar_idx = i + rsi_offset
        prev_rsi = rsi_values[i - 1]
        curr_rsi = rsi_values[i]

        if cross_direction == "below":
            crossed = prev_rsi >= rsi_threshold and curr_rsi < rsi_threshold
        else:
            crossed = prev_rsi <= rsi_threshold and curr_rsi > rsi_threshold

        if not crossed:
            continue

        rules = []

        if cross_direction == "below":
            label = f"RSI Cross Below {rsi_threshold:.0f}"
        else:
            label = f"RSI Cross Above {rsi_threshold:.0f}"

        rules.append({
            "rule_name": label,
            "passed": True,
            "value": round(curr_rsi, 2),
            "threshold": rsi_threshold,
        })

        in_extreme = (
            (curr_rsi <= oversold if cross_direction == "below" else curr_rsi >= overbought)
        )
        rules.append({
            "rule_name": "Extreme Zone",
            "passed": in_extreme,
            "value": f"RSI {curr_rsi:.1f}",
            "threshold": f"{'<= ' + str(oversold) if cross_direction == 'below' else '>= ' + str(overbought)}",
        })

        rsi_momentum = abs(curr_rsi - prev_rsi)
        rules.append({
            "rule_name": "RSI Momentum",
            "passed": True,
            "value": f"{rsi_momentum:.2f} pts",
            "threshold": "Larger = more decisive cross",
        })

        score = 0.0
        score += 0.5
        if in_extreme:
            score += 0.3
        score += min(0.2, rsi_momentum / 20.0)
        score = min(1.0, score)

        if score < score_min:
            continue

        ts = _get_timestamp(data[bar_idx])
        cid = f"{symbol}_{timeframe}_{svid}_{spec_hash_short}_{bar_idx}"

        direction_label = "oversold" if cross_direction == "below" else "overbought"
        reason = f"RSI({rsi_period}) crossed {'below' if cross_direction == 'below' else 'above'} {rsi_threshold:.0f} ({direction_label})"

        # Build crossover marker
        cross_time = _format_chart_time(ts, is_intraday)
        cross_marker = []
        if cross_time is not None:
            cross_marker.append({
                "time": cross_time,
                "position": "belowBar" if cross_direction == "below" else "aboveBar",
                "color": "#7c3aed",
                "shape": "circle",
                "text": f"RSI {curr_rsi:.0f}",
            })

        candidate = {
            "candidate_id": cid,
            "id": cid,
            "strategy_version_id": svid,
            "spec_hash": spec_hash,
            "symbol": symbol,
            "timeframe": timeframe,
            "score": round(score, 3),
            "entry_ready": True,
            "rule_checklist": rules,
            "anchors": {
                "cross_bar": {"index": bar_idx, "timestamp": ts},
            },
            "window_start": bar_idx,
            "window_end": bar_idx,
            "pattern_type": "rsi_primitive",
            "created_at": datetime.utcnow().isoformat() + "Z",
            "chart_data": chart_data,
            "visual": {
                "markers": cross_marker,
                "overlay_series": [rsi_overlay],
            },
            "node_result": {
                "passed": True,
                "score": round(score, 3),
                "features": {
                    "rsi_value": round(curr_rsi, 2),
                    "rsi_prev": round(prev_rsi, 2),
                    "rsi_period": rsi_period,
                    "rsi_threshold": rsi_threshold,
                    "cross_direction": cross_direction,
                    "in_extreme_zone": in_extreme,
                },
                "anchors": {"cross_bar": {"index": bar_idx, "timestamp": ts}},
                "reason": reason,
            },
            "output_ports": {
                "signal": {
                    "passed": True,
                    "score": round(score, 3),
                    "reason": reason,
                },
            },
        }
        candidates.append(candidate)

    print(f"[RSI] Found {len(candidates)} crossover signals for {symbol} (period={rsi_period}, threshold={rsi_threshold}, dir={cross_direction})", file=sys.stderr)
    return candidates
