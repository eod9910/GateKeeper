#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np

from platform_sdk.ohlcv import OHLCV


def _smart_std_spec_hash(spec: Dict[str, Any]) -> str:
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


def _parse_date(ts: Any) -> Optional[datetime]:
    raw = str(ts or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw[:len(fmt)], fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _format_time_str(bar: OHLCV) -> str:
    ts = getattr(bar, "timestamp", "")
    if isinstance(ts, str):
        return ts[:10]
    if isinstance(ts, (int, float)):
        return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
    return str(ts)[:10]


def _build_chart_data(data: List[OHLCV]) -> List[Dict[str, Any]]:
    chart_data: List[Dict[str, Any]] = []
    for bar in data:
        ts = getattr(bar, "timestamp", "")
        if not ts:
            continue
        chart_data.append({
            "time": _format_time_str(bar),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
        })
    return chart_data


def _select_anchor_index(data: List[OHLCV], anchor_date: str) -> int:
    anchor_dt = _parse_date(anchor_date)
    if not data or anchor_dt is None:
        return 0

    first_dt = _parse_date(getattr(data[0], "timestamp", ""))
    if first_dt is None or first_dt > anchor_dt:
        return 0

    for idx, bar in enumerate(data):
        bar_dt = _parse_date(getattr(bar, "timestamp", ""))
        if bar_dt is not None and bar_dt >= anchor_dt:
            return idx
    return 0


def _month_end_indices(data: List[OHLCV], start_idx: int) -> List[int]:
    indices: List[int] = []
    last_key: Optional[str] = None
    last_idx: Optional[int] = None

    for idx in range(start_idx, len(data)):
        dt = _parse_date(getattr(data[idx], "timestamp", ""))
        key = dt.strftime("%Y-%m") if dt else str(getattr(data[idx], "timestamp", ""))[:7]
        if last_key is not None and key != last_key and last_idx is not None:
            indices.append(last_idx)
        last_key = key
        last_idx = idx

    if last_idx is not None and (not indices or indices[-1] != last_idx):
        indices.append(last_idx)
    return indices


def _fit_channel(closes: np.ndarray) -> Dict[str, Any]:
    x = np.arange(len(closes), dtype=float)
    slope, intercept = np.polyfit(x, closes, 1)
    reg_line = slope * x + intercept
    residuals = closes - reg_line
    std_dev = float(np.std(residuals))
    z_score = float(residuals[-1] / std_dev) if std_dev > 0 else 0.0
    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "mean": float(reg_line[-1]),
        "std_dev": std_dev,
        "z_score": z_score,
    }


def _fit_prefix_channel(
    closes: np.ndarray,
    prefix_y: np.ndarray,
    prefix_y2: np.ndarray,
    prefix_xy: np.ndarray,
    end_local_idx: int,
) -> Dict[str, Any]:
    n = end_local_idx + 1
    x_last = float(end_local_idx)
    sum_x = x_last * float(n) / 2.0
    sum_x2 = x_last * float(end_local_idx + 1) * float(2 * end_local_idx + 1) / 6.0
    sum_y = float(prefix_y[end_local_idx])
    sum_y2 = float(prefix_y2[end_local_idx])
    sum_xy = float(prefix_xy[end_local_idx])

    denom = float(n) * sum_x2 - sum_x * sum_x
    if abs(denom) < 1e-12:
        slope = 0.0
        intercept = sum_y / float(n)
    else:
        slope = (float(n) * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / float(n)

    mean = slope * x_last + intercept
    sse = sum_y2 - intercept * sum_y - slope * sum_xy
    variance = max(0.0, sse / float(n))
    std_dev = math.sqrt(variance)
    z_score = float((closes[end_local_idx] - mean) / std_dev) if std_dev > 0 else 0.0
    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "mean": float(mean),
        "std_dev": float(std_dev),
        "z_score": z_score,
    }


def _calculate_smart_channel_states(
    data: List[OHLCV],
    *,
    anchor_date: str = "1987-01-01",
    min_channel_sd: int = 2,
    min_regression_bars: int = 24,
    clamp_lower_zero: bool = True,
) -> Dict[str, Any]:
    anchor_idx = _select_anchor_index(data, anchor_date)
    month_indices = _month_end_indices(data, anchor_idx)
    states: List[Dict[str, Any]] = []
    active_level: Optional[int] = None
    anchored_closes = np.array([float(bar.close) for bar in data[anchor_idx:]], dtype=float)
    anchored_x = np.arange(len(anchored_closes), dtype=float)
    prefix_y = np.cumsum(anchored_closes)
    prefix_y2 = np.cumsum(anchored_closes * anchored_closes)
    prefix_xy = np.cumsum(anchored_x * anchored_closes)

    for end_idx in month_indices:
        if end_idx - anchor_idx + 1 < min_regression_bars:
            continue

        end_local_idx = end_idx - anchor_idx
        fit = _fit_prefix_channel(anchored_closes, prefix_y, prefix_y2, prefix_xy, end_local_idx)
        z_abs = abs(float(fit["z_score"]))

        if active_level is None:
            active_level = max(int(min_channel_sd), int(math.floor(z_abs)))
        else:
            next_level = int(math.floor(z_abs))
            if next_level >= active_level + 1:
                active_level = max(active_level, next_level)

        side = "inside"
        if fit["z_score"] >= active_level:
            side = "upper"
        elif fit["z_score"] <= -active_level:
            side = "lower"

        raw_lower = fit["mean"] - int(active_level) * fit["std_dev"]

        states.append({
            "index": end_idx,
            "time": _format_time_str(data[end_idx]),
            "mean": fit["mean"],
            "std_dev": fit["std_dev"],
            "z_score": fit["z_score"],
            "active_level": int(active_level),
            "upper": fit["mean"] + int(active_level) * fit["std_dev"],
            "lower": max(0.0, raw_lower) if clamp_lower_zero else raw_lower,
            "raw_lower": raw_lower,
            "slope": fit["slope"],
            "side": side,
        })

    return {
        "anchor_idx": anchor_idx,
        "states": states,
    }


def run_smart_std_channel_primitive_plugin(
    data: List[OHLCV], structure: Any, spec: Dict[str, Any],
    symbol: str, timeframe: str, **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Fire-and-forget standard deviation channel.

    The channel anchors at 1987 when that date exists in the data, otherwise it
    uses the earliest available bar. It recalculates on month-end bars, calibrates
    once to floor(abs(z)), and only steps the active SD level upward after price
    reaches the next full standard deviation.
    """
    setup = spec.get("setup_config", {}) or {}
    anchor_date = str(setup.get("anchor_date", "1987-01-01"))
    min_channel_sd = int(setup.get("min_channel_sd", 2))
    min_regression_bars = int(setup.get("min_regression_bars", 24))
    interest_threshold_sd = int(setup.get("interest_threshold_sd", 4))
    clamp_lower_zero = bool(setup.get("clamp_lower_zero", True))
    signal_side = str(setup.get("signal_side", "any") or "any").strip().lower()

    if len(data) < min_regression_bars:
        print(f"[SmartStdChannel] Not enough data: {len(data)} bars", file=sys.stderr)
        return []

    result = _calculate_smart_channel_states(
        data,
        anchor_date=anchor_date,
        min_channel_sd=min_channel_sd,
        min_regression_bars=min_regression_bars,
        clamp_lower_zero=clamp_lower_zero,
    )
    anchor_idx = int(result["anchor_idx"])
    states = result["states"]

    if not states:
        print("[SmartStdChannel] No eligible month-end states", file=sys.stderr)
        return []

    current = states[-1]
    current_z = float(current["z_score"])
    current_abs_z = abs(current_z)
    active_level = int(current["active_level"])
    below_mean = current_z < 0
    above_mean = current_z > 0
    if signal_side == "below_mean" and not below_mean:
        return []
    if signal_side == "above_mean" and not above_mean:
        return []
    anchor_bar = data[anchor_idx]
    anchor_date_used = _format_time_str(anchor_bar)

    mean_data = [{"time": s["time"], "value": round(float(s["mean"]), 2)} for s in states]
    upper_data = [{"time": s["time"], "value": round(float(s["upper"]), 2)} for s in states]
    lower_data = [{"time": s["time"], "value": round(float(s["lower"]), 2)} for s in states]

    overlay_series = [
        {
            "type": "line",
            "data": mean_data,
            "color": "#f59e0b",
            "lineWidth": 2,
            "lineStyle": 0,
            "label": "Smart Mean",
        },
        {
            "type": "line",
            "data": upper_data,
            "color": "#dc2626" if active_level >= interest_threshold_sd else "#8b5cf6",
            "lineWidth": 2 if active_level >= interest_threshold_sd else 1,
            "lineStyle": 0,
            "label": f"+Smart {active_level}SD",
        },
        {
            "type": "line",
            "data": lower_data,
            "color": "#16a34a" if active_level >= interest_threshold_sd else "#8b5cf6",
            "lineWidth": 2 if active_level >= interest_threshold_sd else 1,
            "lineStyle": 0,
            "label": f"-Smart {active_level}SD",
        },
    ]

    markers = [{
        "time": anchor_date_used,
        "position": "belowBar",
        "color": "#f59e0b",
        "shape": "arrowUp",
        "text": f"ANCHOR {anchor_date_used}",
    }]

    previous_level: Optional[int] = None
    for state in states:
        level = int(state["active_level"])
        if previous_level is None and level >= interest_threshold_sd:
            upper_stretch = float(state["z_score"]) >= 0
            markers.append({
                "time": state["time"],
                "position": "aboveBar" if upper_stretch else "belowBar",
                "color": "#dc2626" if upper_stretch else "#16a34a",
                "shape": "arrowDown" if upper_stretch else "arrowUp",
                "text": f"CAL {level}SD",
            })
        if previous_level is not None and level > previous_level and level >= interest_threshold_sd:
            upper_stretch = float(state["z_score"]) > 0
            markers.append({
                "time": state["time"],
                "position": "aboveBar" if upper_stretch else "belowBar",
                "color": "#dc2626" if upper_stretch else "#16a34a",
                "shape": "arrowDown" if upper_stretch else "arrowUp",
                "text": f"{level}SD",
            })
        previous_level = level

    current_upper_stretch = current_z >= 0
    markers.append({
        "time": current["time"],
        "position": "aboveBar" if current_upper_stretch else "belowBar",
        "color": "#ef4444" if active_level >= interest_threshold_sd and current_upper_stretch else "#22c55e",
        "shape": "arrowDown" if current_upper_stretch else "arrowUp",
        "text": f"NOW {current_z:+.1f}SD / {active_level}SD",
    })

    rules = [
        {"rule_name": f"Anchor date used: {anchor_date_used}", "passed": True, "value": anchor_idx, "threshold": 0},
        {"rule_name": f"Active calibrated channel: {active_level}SD", "passed": True, "value": active_level, "threshold": min_channel_sd},
        {"rule_name": f"Current deviation: {current_z:+.2f}SD", "passed": True, "value": round(current_z, 2), "threshold": 0},
        {"rule_name": f"Extreme interest threshold >= {interest_threshold_sd}SD", "passed": bool(current_abs_z >= interest_threshold_sd), "value": round(current_abs_z, 2), "threshold": interest_threshold_sd},
    ]

    if current_abs_z >= 6.0:
        score = 1.0
    elif current_abs_z >= interest_threshold_sd:
        score = 0.9
    elif current_abs_z >= 3.0:
        score = 0.6
    else:
        score = 0.3

    pattern_type = str(setup.get("pattern_type") or spec.get("pattern_type") or "smart_std_channel_primitive")
    spec_hash = spec.get("spec_hash") or _smart_std_spec_hash(spec)
    svid = spec.get("strategy_version_id", f"{pattern_type}_v1")
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:12]}_smartstd"

    reason = (
        f"Smart SD channel anchored {anchor_date_used}: current {current_z:+.2f}SD, "
        f"active channel {active_level}SD"
    )

    return [{
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": False,
        "rule_checklist": rules,
        "anchors": {
            "smart_std_anchor": {"date": anchor_date_used, "bar_index": anchor_idx},
        },
        "window_start": anchor_idx,
        "window_end": len(data) - 1,
        "pattern_type": pattern_type,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _build_chart_data(data),
        "visual": {
            "markers": markers,
            "overlay_series": overlay_series,
        },
        "node_result": {
            "passed": True,
            "score": score,
            "features": {
                "anchor_date": anchor_date_used,
                "active_level": active_level,
                "current_sd": round(current_z, 2),
                "current_abs_sd": round(current_abs_z, 2),
                "current_mean": round(float(current["mean"]), 2),
                "current_upper": round(float(current["upper"]), 2),
                "current_lower": round(float(current["lower"]), 2),
                "current_raw_lower": round(float(current["raw_lower"]), 2),
                "price_vs_smart_mean": "below" if below_mean else ("above" if above_mean else "at"),
                "signal_side": signal_side,
                "clamp_lower_zero": clamp_lower_zero,
                "std_dev": round(float(current["std_dev"]), 2),
                "month_states": len(states),
                "interest_threshold_sd": interest_threshold_sd,
            },
            "anchors": {"smart_std_anchor": {"date": anchor_date_used}},
            "reason": reason,
        },
        "output_ports": {
            "signal": {
                "passed": bool(current_abs_z >= interest_threshold_sd),
                "score": score,
                "reason": reason,
            },
        },
    }]
