#!/usr/bin/env python3
"""
Experimental RDP-anchored head-and-shoulders retrace detector.

This plugin is intentionally biased toward the user's actual workflow:
1. confirm structural swings with RDP
2. find a bearish H-L-H-L-H top sequence
3. require a break below protected structure
4. anchor Fibonacci from right shoulder to post-break swing low
5. surface the setup only when price is retracing into the configured OTE zone
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from platform_sdk.ohlcv import OHLCV
from platform_sdk.rdp import detect_swings_rdp
from plugins.pattern_framework import (
    build_candidate,
    build_rule,
    chart_time,
    clamp01,
    compute_spec_hash,
    ratio_distance,
    ratio_similarity,
)


FIB_LEVELS: Tuple[float, ...] = (0.0, 0.50, 0.618, 0.70, 0.786, 1.0)


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _extract_rdp_pivots(
    data: List[OHLCV],
    structure: Any,
    lookback_start: int,
    symbol: str,
    timeframe: str,
    epsilon_pct: float,
    use_exact_epsilon: bool,
    pivot_source: str,
) -> Tuple[List[Dict[str, Any]], str]:
    source_key = str(pivot_source or "rdp").strip().lower()
    structure_points = getattr(structure, "swing_points", None)
    if structure_points is None and isinstance(structure, dict):
        structure_points = structure.get("swing_points")

    pivots: List[Dict[str, Any]] = []
    if source_key in ("structure", "auto") and isinstance(structure_points, list):
        for point in structure_points:
            if isinstance(point, dict):
                idx = int(point.get("index", -1))
                point_type = str(point.get("type") or point.get("point_type") or "").upper()
                price = point.get("price")
                confirmed_by_index = point.get("confirmed_by_index")
            else:
                idx = int(getattr(point, "index", -1))
                point_type = str(getattr(point, "point_type", getattr(point, "type", ""))).upper()
                price = getattr(point, "price", None)
                confirmed_by_index = getattr(point, "confirmed_by_index", None)

            if idx < lookback_start or idx >= len(data) or point_type not in ("HIGH", "LOW"):
                continue
            if price is None:
                price = data[idx].high if point_type == "HIGH" else data[idx].low
            pivots.append(
                {
                    "index": idx,
                    "price": float(price),
                    "type": point_type,
                    "confirmed_by_index": int(confirmed_by_index) if confirmed_by_index is not None else None,
                }
            )
        if len(pivots) >= 6:
            return pivots, "structure"

    swing = detect_swings_rdp(
        data,
        symbol=symbol,
        timeframe=timeframe,
        epsilon_pct=epsilon_pct,
        use_exact_epsilon=use_exact_epsilon,
        verbose=False,
    )
    for point in getattr(swing, "swing_points", []) or []:
        idx = int(getattr(point, "index", -1))
        point_type = str(getattr(point, "point_type", "")).upper()
        if idx < lookback_start or idx >= len(data) or point_type not in ("HIGH", "LOW"):
            continue
        pivots.append(
            {
                "index": idx,
                "price": float(getattr(point, "price", data[idx].high if point_type == "HIGH" else data[idx].low)),
                "type": point_type,
                "confirmed_by_index": int(getattr(point, "confirmed_by_index", idx) or idx),
            }
        )
    return pivots, "rdp"


def _marker(
    data: List[OHLCV],
    index: int,
    position: str,
    color: str,
    shape: str,
    text: str,
) -> Dict[str, Any]:
    return {
        "time": chart_time(data, index),
        "position": position,
        "color": color,
        "shape": shape,
        "text": text,
    }


def _line(
    data: List[OHLCV],
    points: Sequence[Dict[str, Any]],
    color: str,
    label: str,
    line_width: int = 2,
    line_style: int = 0,
) -> Dict[str, Any]:
    return {
        "type": "line",
        "color": color,
        "lineWidth": line_width,
        "lineStyle": line_style,
        "label": label,
        "data": [
            {"time": chart_time(data, int(point["index"])), "value": round(float(point["price"]), 4)}
            for point in points
        ],
    }


def _horizontal_line(
    data: List[OHLCV],
    start_index: int,
    end_index: int,
    price: float,
    color: str,
    label: str,
    line_width: int = 1,
    line_style: int = 2,
) -> Dict[str, Any]:
    return _line(
        data,
        [
            {"index": start_index, "price": price},
            {"index": end_index, "price": price},
        ],
        color=color,
        label=label,
        line_width=line_width,
        line_style=line_style,
    )


def _round_anchor(point: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "index": int(point["index"]),
        "price": round(float(point["price"]), 4),
    }


def _fib_price(leg_high: float, leg_low: float, level: float) -> float:
    return float(leg_low) + ((float(leg_high) - float(leg_low)) * float(level))


def _build_fib_levels(leg_high: float, leg_low: float, current_price: float) -> List[Dict[str, Any]]:
    fib_levels: List[Dict[str, Any]] = []
    current = max(float(current_price), 1e-9)
    for level in FIB_LEVELS:
        price = _fib_price(leg_high, leg_low, level)
        fib_levels.append(
            {
                "price": round(price, 2),
                "level": f"{round(level * 100, 1):g}%",
                "is_near": abs(current_price - price) / current < 0.015,
            }
        )
    return fib_levels


def _nearest_fib_level(leg_high: float, leg_low: float, current_price: float) -> Dict[str, Any]:
    nearest_level = 0.0
    nearest_price = leg_low
    nearest_dist = float("inf")
    for level in FIB_LEVELS:
        price = _fib_price(leg_high, leg_low, level)
        dist = abs(current_price - price)
        if dist < nearest_dist:
            nearest_level = level
            nearest_price = price
            nearest_dist = dist
    proximity_pct = (nearest_dist / current_price * 100.0) if current_price > 0 else 999.0
    return {
        "level": nearest_level,
        "level_label": f"{round(nearest_level * 100, 1):g}%",
        "price": round(nearest_price, 4),
        "distance_pct": round(proximity_pct, 4),
    }


def _break_low_after(
    pivots: Sequence[Dict[str, Any]],
    start_index: int,
    break_threshold: float,
) -> Optional[Dict[str, Any]]:
    for point in pivots[start_index:]:
        if point["type"] == "LOW" and float(point["price"]) < break_threshold:
            return point
    return None


def _evaluate_bearish_sequence(
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    shoulder_tolerance_pct: float,
    head_dominance_pct: float,
    neckline_tolerance_pct: float,
    break_min_pct: float,
    entry_zone_min_level: float,
    entry_zone_max_level: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + 5])
    if len(window) != 5:
        return None

    if [point["type"] for point in window] != ["HIGH", "LOW", "HIGH", "LOW", "HIGH"]:
        return None

    ls, nl1, head, nl2, rs = window
    protected_low = min(float(nl1["price"]), float(nl2["price"]))
    neckline_trigger = max(float(nl1["price"]), float(nl2["price"]))
    break_threshold = protected_low * (1.0 - max(break_min_pct, 0.0))
    break_low = _break_low_after(pivots, start + 5, break_threshold)
    if break_low is None:
        return None

    current_price = float(data[-1].close)
    leg_high = float(rs["price"])
    leg_low = float(break_low["price"])
    if leg_high <= leg_low:
        return None

    total_range = leg_high - leg_low
    retracement_pct = ((current_price - leg_low) / total_range) * 100.0
    entry_zone_min_price = _fib_price(leg_high, leg_low, entry_zone_min_level)
    entry_zone_max_price = _fib_price(leg_high, leg_low, entry_zone_max_level)
    in_entry_zone = entry_zone_min_price <= current_price <= entry_zone_max_price

    shoulder_delta = ratio_distance(ls["price"], rs["price"])
    neckline_delta = ratio_distance(nl1["price"], nl2["price"])
    head_prom_left = (float(head["price"]) - float(ls["price"])) / max(float(ls["price"]), 1e-9)
    head_prom_right = (float(head["price"]) - float(rs["price"])) / max(float(rs["price"]), 1e-9)
    head_dominance = min(head_prom_left, head_prom_right)
    break_distance_pct = (protected_low - leg_low) / max(protected_low, 1e-9)

    head_is_dominant = head_dominance >= head_dominance_pct
    shoulders_symmetric = shoulder_delta <= shoulder_tolerance_pct
    neckline_band_valid = neckline_delta <= neckline_tolerance_pct
    structure_break_confirmed = leg_low < break_threshold

    zone_center_pct = ((entry_zone_min_level + entry_zone_max_level) / 2.0) * 100.0
    zone_half_span_pct = max(((entry_zone_max_level - entry_zone_min_level) * 100.0) / 2.0, 1e-9)
    zone_distance = abs(retracement_pct - zone_center_pct)
    entry_zone_score = clamp01(1.0 - (zone_distance / zone_half_span_pct))

    score = (
        0.24 * clamp01(head_dominance / max(head_dominance_pct * 2.0, 1e-9))
        + 0.22 * ratio_similarity(ls["price"], rs["price"], shoulder_tolerance_pct)
        + 0.14 * ratio_similarity(nl1["price"], nl2["price"], neckline_tolerance_pct)
        + 0.20 * clamp01(break_distance_pct / max(break_min_pct * 4.0, 0.02))
        + 0.20 * entry_zone_score
    )

    rules = [
        build_rule("head_is_dominant", head_is_dominant, round(head_dominance, 4), head_dominance_pct),
        build_rule("shoulders_symmetric", shoulders_symmetric, round(shoulder_delta, 4), shoulder_tolerance_pct),
        build_rule("neckline_band_valid", neckline_band_valid, round(neckline_delta, 4), neckline_tolerance_pct),
        build_rule("structure_break_confirmed", structure_break_confirmed, round(leg_low, 4), round(break_threshold, 4)),
        build_rule(
            "current_price_in_retrace_zone",
            in_entry_zone,
            round(retracement_pct, 2),
            [round(entry_zone_min_level * 100.0, 1), round(entry_zone_max_level * 100.0, 1)],
        ),
    ]

    if not all(rule["passed"] for rule in rules):
        return None
    if score < min_score:
        return None

    anchors = {
        "left_shoulder": _round_anchor(ls),
        "neckline_left": _round_anchor(nl1),
        "head": _round_anchor(head),
        "neckline_right": _round_anchor(nl2),
        "right_shoulder": _round_anchor(rs),
        "protected_low": {"index": int(nl1["index"] if nl1["price"] <= nl2["price"] else nl2["index"]), "price": round(protected_low, 4)},
        "neckline_trigger": {"index": int(nl1["index"] if nl1["price"] >= nl2["price"] else nl2["index"]), "price": round(neckline_trigger, 4)},
        "structure_break_low": _round_anchor(break_low),
        "fib_anchor_high": _round_anchor(rs),
        "fib_anchor_low": _round_anchor(break_low),
        "entry_zone": {
            "min_price": round(entry_zone_min_price, 4),
            "max_price": round(entry_zone_max_price, 4),
            "min_level": round(entry_zone_min_level, 4),
            "max_level": round(entry_zone_max_level, 4),
        },
    }

    markers = [
        _marker(data, int(ls["index"]), "aboveBar", "#f59e0b", "circle", f"LS {float(ls['price']):.0f}"),
        _marker(data, int(head["index"]), "aboveBar", "#ef4444", "circle", f"H {float(head['price']):.0f}"),
        _marker(data, int(rs["index"]), "aboveBar", "#22c55e", "circle", f"RS {float(rs['price']):.0f}"),
        _marker(data, int(nl1["index"]), "belowBar", "#3b82f6", "square", f"L {float(nl1['price']):.0f}"),
        _marker(data, int(nl2["index"]), "belowBar", "#3b82f6", "square", f"L {float(nl2['price']):.0f}"),
        _marker(data, int(break_low["index"]), "belowBar", "#a855f7", "arrowUp", f"BOS {float(break_low['price']):.0f}"),
    ]

    overlays = [
        _line(data, [ls, nl1, head, nl2, rs, break_low], "#06b6d4", "RDP Structure", line_width=2, line_style=0),
        _line(data, [nl1, nl2], "#3b82f6", "Neckline Band", line_width=1, line_style=2),
        _horizontal_line(data, int(nl1["index"]), len(data) - 1, protected_low, "#ef4444", "Protected Low", line_width=1, line_style=2),
        _horizontal_line(data, int(rs["index"]), len(data) - 1, entry_zone_min_price, "#f97316", "OTE 61.8", line_width=1, line_style=2),
        _horizontal_line(data, int(rs["index"]), len(data) - 1, entry_zone_max_price, "#f59e0b", "OTE 78.6", line_width=1, line_style=2),
        _line(data, [rs, break_low], "#ef4444", "Break Leg", line_width=2, line_style=0),
    ]

    nearest_level = _nearest_fib_level(leg_high, leg_low, current_price)

    return {
        "direction": "bearish",
        "score": round(score, 4),
        "rules": rules,
        "anchors": anchors,
        "visual": {"markers": markers, "overlay_series": overlays},
        "window_start": int(ls["index"]),
        "window_end": len(data) - 1,
        "reason": "bearish_head_shoulders_ote_retrace",
        "fib_levels": _build_fib_levels(leg_high, leg_low, current_price),
        "features": {
            "pattern_direction": "bearish",
            "head_dominance_pct": round(head_dominance, 4),
            "shoulder_delta_pct": round(shoulder_delta, 4),
            "neckline_delta_pct": round(neckline_delta, 4),
            "break_distance_pct": round(break_distance_pct, 4),
            "current_retracement_pct": round(retracement_pct, 2),
            "entry_zone_min_pct": round(entry_zone_min_level * 100.0, 2),
            "entry_zone_max_pct": round(entry_zone_max_level * 100.0, 2),
            "entry_zone_score": round(entry_zone_score, 4),
            "nearest_fib_level": nearest_level["level_label"],
            "nearest_fib_price": nearest_level["price"],
            "nearest_fib_distance_pct": nearest_level["distance_pct"],
            "break_leg_bars": int(break_low["index"]) - int(rs["index"]),
        },
        "entry_zone": {
            "passed": in_entry_zone,
            "current_price": round(current_price, 4),
            "retracement_pct": round(retracement_pct, 2),
            "zone_min_pct": round(entry_zone_min_level * 100.0, 2),
            "zone_max_pct": round(entry_zone_max_level * 100.0, 2),
            "zone_min_price": round(entry_zone_min_price, 4),
            "zone_max_price": round(entry_zone_max_price, 4),
        },
        "break_leg": {
            "leg_high": _round_anchor(rs),
            "leg_low": _round_anchor(break_low),
            "leg_direction": "bearish",
            "leg_bars": int(break_low["index"]) - int(rs["index"]),
        },
    }


def run_head_shoulders_context_pattern_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    setup = spec.get("setup_config", {}) or {}
    structure_cfg = spec.get("structure_config", {}) or {}

    lookback_bars = max(60, int(setup.get("lookback_bars", 220)))
    pivot_source = str(setup.get("pivot_source", "rdp")).strip().lower()
    swing_epsilon_pct = float(setup.get("swing_epsilon_pct", structure_cfg.get("swing_epsilon_pct", 0.08)))
    use_exact_epsilon = _as_bool(setup.get("use_exact_epsilon", structure_cfg.get("use_exact_epsilon", True)), default=True)
    shoulder_tolerance_pct = float(setup.get("shoulder_tolerance_pct", 0.08))
    head_dominance_pct = float(setup.get("head_dominance_pct", 0.015))
    neckline_tolerance_pct = float(setup.get("neckline_tolerance_pct", 0.08))
    break_min_pct = float(setup.get("break_min_pct", 0.01))
    entry_zone_min_level = float(setup.get("entry_zone_min_level", 0.618))
    entry_zone_max_level = float(setup.get("entry_zone_max_level", 0.786))
    min_score = float(setup.get("min_score", 0.60))
    max_candidates = max(1, int(setup.get("max_candidates", 2)))

    if len(data) < 40:
        return []
    if entry_zone_min_level >= entry_zone_max_level:
        return []

    lookback_start = max(0, len(data) - lookback_bars)
    pivots, resolved_pivot_source = _extract_rdp_pivots(
        data=data,
        structure=structure,
        lookback_start=lookback_start,
        symbol=symbol,
        timeframe=timeframe,
        epsilon_pct=swing_epsilon_pct,
        use_exact_epsilon=use_exact_epsilon,
        pivot_source=pivot_source,
    )
    if len(pivots) < 6:
        return []

    found: List[Dict[str, Any]] = []
    for start in range(0, len(pivots) - 5):
        result = _evaluate_bearish_sequence(
            data=data,
            pivots=pivots,
            start=start,
            shoulder_tolerance_pct=shoulder_tolerance_pct,
            head_dominance_pct=head_dominance_pct,
            neckline_tolerance_pct=neckline_tolerance_pct,
            break_min_pct=break_min_pct,
            entry_zone_min_level=entry_zone_min_level,
            entry_zone_max_level=entry_zone_max_level,
            min_score=min_score,
        )
        if result:
            found.append(result)

    if not found:
        return []

    deduped: List[Dict[str, Any]] = []
    occupied_keys = set()
    for result in sorted(found, key=lambda item: float(item["score"]), reverse=True):
        key = (
            int(result["anchors"]["head"]["index"]),
            int(result["anchors"]["structure_break_low"]["index"]),
        )
        if key in occupied_keys:
            continue
        occupied_keys.add(key)
        deduped.append(result)
        if len(deduped) >= max_candidates:
            break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "head_shoulders_context_v2")
    candidates: List[Dict[str, Any]] = []

    for idx, result in enumerate(deduped):
        anchors = result["anchors"]
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_"
            f"{result['window_start']}_{result['anchors']['structure_break_low']['index']}_{idx}"
        )
        node_features = dict(result["features"])
        node_features["pivot_source"] = resolved_pivot_source
        node_features["swing_epsilon_pct"] = swing_epsilon_pct
        node_features["use_exact_epsilon"] = use_exact_epsilon

        output_ports = {
            "signal": {
                "passed": True,
                "score": result["score"],
                "reason": result["reason"],
            },
            "pattern_geometry": {
                "direction": result["direction"],
                "anchors": anchors,
                "score": result["score"],
            },
            "entry_zone": result["entry_zone"],
            "break_leg": result["break_leg"],
            "fib_levels": {
                "retracement_pct": result["entry_zone"]["retracement_pct"],
                "nearest_level": result["features"]["nearest_fib_level"],
                "range_high": result["break_leg"]["leg_high"]["price"],
                "range_low": result["break_leg"]["leg_low"]["price"],
                "proximity_pct": result["features"]["nearest_fib_distance_pct"],
            },
        }

        candidates.append(
            build_candidate(
                data=data,
                candidate_id=candidate_id,
                strategy_version_id=strategy_version_id,
                spec_hash=spec_hash,
                symbol=symbol,
                timeframe=timeframe,
                score=result["score"],
                entry_ready=True,
                pattern_type="head_shoulders_context_pattern",
                rule_checklist=result["rules"],
                anchors=anchors,
                node_features=node_features,
                node_reason=result["reason"],
                output_ports=output_ports,
                visual=result["visual"],
                window_start=result["window_start"],
                window_end=result["window_end"],
                candidate_role="pattern_detector",
                candidate_actionability="entry_ready",
                extras={
                    "candidate_role": "pattern_detector",
                    "candidate_actionability": "entry_ready",
                    "fib_levels": result["fib_levels"],
                },
            )
        )

    return candidates
