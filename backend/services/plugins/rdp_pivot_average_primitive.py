#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Set, Union

from platform_sdk.ohlcv import OHLCV
from plugins.bulkowski_geometry import extract_rdp_pivots, line, marker
from plugins.pattern_framework import build_chart_data, build_rule, chart_time, clamp01


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


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _unique_pivots(pivots: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_index: Dict[int, Dict[str, Any]] = {}
    for point in pivots:
        idx = int(point.get("index", -1))
        if idx < 0:
            continue
        by_index[idx] = {
            "index": idx,
            "price": float(point.get("price", 0.0)),
            "type": str(point.get("type") or point.get("point_type") or "").upper(),
            "confirmed_by_index": point.get("confirmed_by_index"),
        }
    return [by_index[idx] for idx in sorted(by_index.keys())]


def _rolling_pivot_average(
    pivots: List[Dict[str, Any]],
    pivot_window: int,
) -> List[Dict[str, Any]]:
    averages: List[Dict[str, Any]] = []
    for end_idx in range(pivot_window - 1, len(pivots)):
        window = pivots[end_idx - pivot_window + 1 : end_idx + 1]
        avg_price = sum(float(point["price"]) for point in window) / float(pivot_window)
        newest = pivots[end_idx]
        averages.append(
            {
                "index": int(newest["index"]),
                "price": avg_price,
                "source_pivots": [
                    {
                        "index": int(point["index"]),
                        "price": round(float(point["price"]), 4),
                        "type": point.get("type"),
                    }
                    for point in window
                ],
            }
        )
    return averages


def _generate_signal_indices(
    data: List[OHLCV],
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
) -> Set[int]:
    setup = spec.get("setup_config", {}) or {}
    backtest_cfg = spec.get("backtest_config", {}) or {}
    signal_direction = str(setup.get("signal_direction", "cross_above")).strip().lower()
    min_history = max(20, int(backtest_cfg.get("min_history_bars", 100) or 100))

    signals: Set[int] = set()
    previous_close: float | None = None
    previous_average: float | None = None

    for idx in range(min_history, len(data)):
        prefix = data[: idx + 1]
        candidates = run_rdp_pivot_average_primitive_plugin(
            prefix,
            structure=None,
            spec=spec,
            symbol=symbol,
            timeframe=timeframe,
            mode="scan",
        )
        average_port = (
            (candidates[0].get("output_ports") or {}).get("rdp_pivot_average")
            if candidates
            else None
        )
        current_average = average_port.get("current_average") if isinstance(average_port, dict) else None
        current_close = float(data[idx].close)

        if current_average is not None and previous_average is not None and previous_close is not None:
            current_average_f = float(current_average)
            if signal_direction in ("cross_below", "below", "bearish"):
                crossed = previous_close >= previous_average and current_close < current_average_f
            else:
                crossed = previous_close <= previous_average and current_close > current_average_f
            if crossed:
                signals.add(idx)

        previous_close = current_close
        previous_average = float(current_average) if current_average is not None else None

    return signals


def run_rdp_pivot_average_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Union[List[Dict[str, Any]], Set[int]]:
    """
    Primitive indicator: rolling average of RDP pivot prices.

    It answers one question: what baseline is formed by averaging the last N
    confirmed RDP pivots and connecting those rolling averages?
    """
    if mode == "signal":
        return _generate_signal_indices(data, spec, symbol, timeframe)

    setup = spec.get("setup_config", {}) or {}
    struct_cfg = spec.get("structure_config", {}) or {}

    pivot_window = max(2, int(setup.get("pivot_window", 3)))
    lookback_bars = max(pivot_window + 10, int(setup.get("lookback_bars", 500)))
    epsilon_pct = float(setup.get("swing_epsilon_pct", struct_cfg.get("swing_epsilon_pct", 0.05)))
    use_exact_epsilon = _as_bool(setup.get("use_exact_epsilon", False), False)
    pivot_source = str(setup.get("pivot_source", "auto")).strip().lower()
    show_rdp_path = _as_bool(setup.get("show_rdp_path", True), True)
    extend_to_latest_bar = _as_bool(setup.get("extend_to_latest_bar", True), True)

    n = len(data)
    min_required = max(20, pivot_window + 10)
    if n < min_required:
        return []

    lookback_start = max(0, n - lookback_bars)
    raw_pivots, resolved_pivot_source = extract_rdp_pivots(
        data=data,
        structure=structure,
        lookback_start=lookback_start,
        symbol=symbol,
        timeframe=timeframe,
        epsilon_pct=epsilon_pct,
        use_exact_epsilon=use_exact_epsilon,
        pivot_source=pivot_source,
        min_pivots=pivot_window,
    )
    pivots = _unique_pivots(raw_pivots)

    if len(pivots) < pivot_window:
        return []

    averages = _rolling_pivot_average(pivots, pivot_window)
    if not averages:
        return []

    average_line_points = [
        {"index": int(point["index"]), "price": float(point["price"])}
        for point in averages
    ]
    latest_average = averages[-1]
    last_idx = n - 1
    if extend_to_latest_bar and int(latest_average["index"]) < last_idx:
        average_line_points.append({"index": last_idx, "price": float(latest_average["price"])})

    overlays = [
        line(
            data,
            average_line_points,
            color="#14b8a6",
            label=f"RDP Pivot Avg({pivot_window})",
            line_width=2,
            line_style=0,
        )
    ]
    if show_rdp_path:
        overlays.append(
            line(
                data,
                pivots,
                color="#94a3b8",
                label="RDP Pivot Path",
                line_width=1,
                line_style=2,
            )
        )

    current_price = float(data[-1].close)
    current_avg = float(latest_average["price"])
    distance_pct = abs(current_price - current_avg) / max(abs(current_price), 1e-9)
    slope = 0.0
    if len(averages) >= 2:
        prev_avg = float(averages[-2]["price"])
        slope = (current_avg - prev_avg) / max(abs(prev_avg), 1e-9)

    last_source_pivots = latest_average["source_pivots"]
    pivot_markers = [
        marker(
            data,
            int(point["index"]),
            "aboveBar" if str(point.get("type")).upper() == "HIGH" else "belowBar",
            "#64748b",
            "circle",
            "RDP",
        )
        for point in pivots[-min(len(pivots), max(pivot_window * 3, 6)) :]
    ]
    avg_time = chart_time(data, int(latest_average["index"]))
    if avg_time is not None:
        pivot_markers.append(
            {
                "time": avg_time,
                "position": "aboveBar" if current_price < current_avg else "belowBar",
                "color": "#14b8a6",
                "shape": "square",
                "text": f"RDP Avg {current_avg:.2f}",
            }
        )

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get(
        "strategy_version_id",
        f"{spec.get('strategy_id', 'rdp_pivot_average_primitive')}_v{spec.get('version', '1')}",
    )
    candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_{lookback_start}_{last_idx}"
    reason = f"RDP pivot average ready: last {pivot_window} pivots average {current_avg:.4f}"
    score = clamp01(len(averages) / 20.0)

    rules = [
        build_rule("RDP pivots available", len(pivots) >= pivot_window, len(pivots), pivot_window),
        build_rule("Pivot average ready", True, round(current_avg, 4), f"last {pivot_window} pivots"),
        build_rule("Line has points", len(average_line_points) >= 2, len(average_line_points), 2),
    ]

    anchors = {
        "latest_average": {
            "index": int(latest_average["index"]),
            "timestamp": getattr(data[int(latest_average["index"])], "timestamp", ""),
            "price": round(current_avg, 4),
        },
        "source_pivots": last_source_pivots,
    }

    return [
        {
            "candidate_id": candidate_id,
            "id": candidate_id,
            "strategy_version_id": strategy_version_id,
            "spec_hash": spec_hash,
            "symbol": symbol,
            "timeframe": timeframe,
            "score": round(score, 3),
            "entry_ready": False,
            "rule_checklist": rules,
            "anchors": anchors,
            "window_start": lookback_start,
            "window_end": last_idx,
            "pattern_type": "rdp_pivot_average_primitive",
            "created_at": datetime.utcnow().isoformat() + "Z",
            "chart_data": build_chart_data(data[lookback_start:]),
            "visual": {
                "markers": pivot_markers,
                "overlay_series": overlays,
            },
            "node_result": {
                "passed": True,
                "score": round(score, 3),
                "features": {
                    "pivot_window": pivot_window,
                    "pivot_count": len(pivots),
                    "average_point_count": len(averages),
                    "swing_epsilon_pct": epsilon_pct,
                    "use_exact_epsilon": use_exact_epsilon,
                    "pivot_source": resolved_pivot_source,
                    "current_price": round(current_price, 4),
                    "current_average": round(current_avg, 4),
                    "distance_pct": round(distance_pct, 6),
                    "slope_pct": round(slope, 6),
                    "extended_to_latest_bar": bool(extend_to_latest_bar),
                },
                "anchors": anchors,
                "reason": reason,
            },
            "output_ports": {
                "signal": {
                    "passed": True,
                    "score": round(score, 3),
                    "reason": reason,
                },
                "rdp_pivot_average": {
                    "current_average": round(current_avg, 4),
                    "current_price": round(current_price, 4),
                    "distance_pct": round(distance_pct, 6),
                    "slope_pct": round(slope, 6),
                    "pivot_window": pivot_window,
                    "source_pivots": last_source_pivots,
                    "average_points": [
                        {
                            "index": int(point["index"]),
                            "time": chart_time(data, int(point["index"])),
                            "value": round(float(point["price"]), 4),
                        }
                        for point in averages
                    ],
                },
            },
        }
    ]
