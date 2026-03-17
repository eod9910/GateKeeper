#!/usr/bin/env python3
"""
Experimental RDP-anchored three-drives reversal detector.

This mirrors the head-and-shoulders context pattern style:
1. confirm alternating pivots with RDP/structure swings
2. detect a six-pivot three-drives sequence
3. validate retracements, extensions, and drive symmetry
4. surface the setup only while price is still in the reversal reaction zone
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


REACTION_FIB_LEVELS: Tuple[float, ...] = (0.0, 0.236, 0.382, 0.50, 0.618, 0.786, 1.0)


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


def _range_score(value: float, min_value: float, max_value: float) -> float:
    lo = min(float(min_value), float(max_value))
    hi = max(float(min_value), float(max_value))
    if lo <= value <= hi:
        return 1.0
    center = (lo + hi) / 2.0
    half_span = max((hi - lo) / 2.0, 1e-9)
    distance = abs(float(value) - center) - half_span
    return clamp01(1.0 - (distance / half_span))


def _reaction_price(
    direction: str,
    drive3_price: float,
    correction2_price: float,
    level: float,
) -> float:
    leg = abs(float(drive3_price) - float(correction2_price))
    if direction == "bearish":
        return float(drive3_price) - (leg * float(level))
    return float(drive3_price) + (leg * float(level))


def _build_reaction_levels(
    direction: str,
    drive3_price: float,
    correction2_price: float,
    current_price: float,
) -> List[Dict[str, Any]]:
    fib_levels: List[Dict[str, Any]] = []
    current = max(abs(float(current_price)), 1e-9)
    for level in REACTION_FIB_LEVELS:
        price = _reaction_price(direction, drive3_price, correction2_price, level)
        fib_levels.append(
            {
                "price": round(price, 2),
                "level": f"{round(level * 100, 1):g}%",
                "is_near": abs(current_price - price) / current < 0.015,
            }
        )
    return fib_levels


def _nearest_reaction_level(
    direction: str,
    drive3_price: float,
    correction2_price: float,
    current_price: float,
) -> Dict[str, Any]:
    nearest_level = 0.0
    nearest_price = drive3_price
    nearest_dist = float("inf")
    for level in REACTION_FIB_LEVELS:
        price = _reaction_price(direction, drive3_price, correction2_price, level)
        dist = abs(current_price - price)
        if dist < nearest_dist:
            nearest_level = level
            nearest_price = price
            nearest_dist = dist
    proximity_pct = (nearest_dist / max(abs(current_price), 1e-9) * 100.0)
    return {
        "level": nearest_level,
        "level_label": f"{round(nearest_level * 100, 1):g}%",
        "price": round(nearest_price, 4),
        "distance_pct": round(proximity_pct, 4),
    }


def _evaluate_three_drives_sequence(
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    correction_retrace_min_level: float,
    correction_retrace_max_level: float,
    extension_min_level: float,
    extension_max_level: float,
    drive_symmetry_pct: float,
    reaction_zone_max_level: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + 6])
    if len(window) != 6:
        return None

    pivot_types = [point["type"] for point in window]
    if pivot_types == ["LOW", "HIGH", "LOW", "HIGH", "LOW", "HIGH"]:
        direction = "bearish"
    elif pivot_types == ["HIGH", "LOW", "HIGH", "LOW", "HIGH", "LOW"]:
        direction = "bullish"
    else:
        return None

    p0, p1, p2, p3, p4, p5 = window
    start_price = float(p0["price"])
    drive1_price = float(p1["price"])
    correction1_price = float(p2["price"])
    drive2_price = float(p3["price"])
    correction2_price = float(p4["price"])
    drive3_price = float(p5["price"])
    current_price = float(data[-1].close)

    if direction == "bearish":
        drive_progression_valid = drive1_price > start_price and drive2_price > drive1_price and drive3_price > drive2_price
        correction_progression_valid = correction1_price > start_price and correction2_price > correction1_price
        drive1_len = drive1_price - start_price
        drive2_len = drive2_price - correction1_price
        drive3_len = drive3_price - correction2_price
        correction1_len = drive1_price - correction1_price
        correction2_len = drive2_price - correction2_price
        reaction_pct = (drive3_price - current_price) / max(drive3_price - correction2_price, 1e-9)
        reaction_zone_min_price = _reaction_price(direction, drive3_price, correction2_price, reaction_zone_max_level)
        reaction_zone_max_price = drive3_price
    else:
        drive_progression_valid = drive1_price < start_price and drive2_price < drive1_price and drive3_price < drive2_price
        correction_progression_valid = correction1_price < start_price and correction2_price < correction1_price
        drive1_len = start_price - drive1_price
        drive2_len = correction1_price - drive2_price
        drive3_len = correction2_price - drive3_price
        correction1_len = correction1_price - drive1_price
        correction2_len = correction2_price - drive2_price
        reaction_pct = (current_price - drive3_price) / max(correction2_price - drive3_price, 1e-9)
        reaction_zone_min_price = drive3_price
        reaction_zone_max_price = _reaction_price(direction, drive3_price, correction2_price, reaction_zone_max_level)

    if min(drive1_len, drive2_len, drive3_len) <= 0:
        return None
    if min(correction1_len, correction2_len) <= 0:
        return None
    if not drive_progression_valid or not correction_progression_valid:
        return None

    retrace1 = correction1_len / max(drive1_len, 1e-9)
    retrace2 = correction2_len / max(drive2_len, 1e-9)
    extension2 = drive2_len / max(drive1_len, 1e-9)
    extension3 = drive3_len / max(drive2_len, 1e-9)

    retrace1_valid = correction_retrace_min_level <= retrace1 <= correction_retrace_max_level
    retrace2_valid = correction_retrace_min_level <= retrace2 <= correction_retrace_max_level
    extension2_valid = extension_min_level <= extension2 <= extension_max_level
    extension3_valid = extension_min_level <= extension3 <= extension_max_level
    reaction_zone_valid = 0.0 <= reaction_pct <= reaction_zone_max_level

    drive_symmetry_12 = ratio_similarity(drive1_len, drive2_len, drive_symmetry_pct)
    drive_symmetry_23 = ratio_similarity(drive2_len, drive3_len, drive_symmetry_pct)
    retrace_symmetry = ratio_similarity(retrace1, retrace2, 0.35)
    reaction_zone_score = _range_score(reaction_pct, 0.0, reaction_zone_max_level)

    score = (
        0.18 * _range_score(retrace1, correction_retrace_min_level, correction_retrace_max_level)
        + 0.18 * _range_score(retrace2, correction_retrace_min_level, correction_retrace_max_level)
        + 0.18 * _range_score(extension2, extension_min_level, extension_max_level)
        + 0.18 * _range_score(extension3, extension_min_level, extension_max_level)
        + 0.14 * ((drive_symmetry_12 + drive_symmetry_23) / 2.0)
        + 0.06 * retrace_symmetry
        + 0.08 * reaction_zone_score
    )

    rules = [
        build_rule("drive_progression_valid", drive_progression_valid, direction, True),
        build_rule("correction_progression_valid", correction_progression_valid, direction, True),
        build_rule("retrace1_in_band", retrace1_valid, round(retrace1, 4), [correction_retrace_min_level, correction_retrace_max_level]),
        build_rule("retrace2_in_band", retrace2_valid, round(retrace2, 4), [correction_retrace_min_level, correction_retrace_max_level]),
        build_rule("extension2_in_band", extension2_valid, round(extension2, 4), [extension_min_level, extension_max_level]),
        build_rule("extension3_in_band", extension3_valid, round(extension3, 4), [extension_min_level, extension_max_level]),
        build_rule("current_price_in_reaction_zone", reaction_zone_valid, round(reaction_pct, 4), [0.0, reaction_zone_max_level]),
    ]

    if not all(rule["passed"] for rule in rules):
        return None
    if score < min_score:
        return None

    anchors = {
        "start_anchor": _round_anchor(p0),
        "drive1": _round_anchor(p1),
        "correction1": _round_anchor(p2),
        "drive2": _round_anchor(p3),
        "correction2": _round_anchor(p4),
        "drive3": _round_anchor(p5),
        "reaction_zone": {
            "min_price": round(min(reaction_zone_min_price, reaction_zone_max_price), 4),
            "max_price": round(max(reaction_zone_min_price, reaction_zone_max_price), 4),
            "max_level": round(reaction_zone_max_level, 4),
        },
    }

    marker_position = "aboveBar" if direction == "bearish" else "belowBar"
    correction_position = "belowBar" if direction == "bearish" else "aboveBar"
    drive_color = "#ef4444" if direction == "bearish" else "#22c55e"
    correction_color = "#3b82f6"

    markers = [
        _marker(data, int(p1["index"]), marker_position, drive_color, "circle", f"D1 {drive1_price:.0f}"),
        _marker(data, int(p2["index"]), correction_position, correction_color, "square", f"C1 {correction1_price:.0f}"),
        _marker(data, int(p3["index"]), marker_position, drive_color, "circle", f"D2 {drive2_price:.0f}"),
        _marker(data, int(p4["index"]), correction_position, correction_color, "square", f"C2 {correction2_price:.0f}"),
        _marker(data, int(p5["index"]), marker_position, "#a855f7", "arrowDown" if direction == "bearish" else "arrowUp", f"D3 {drive3_price:.0f}"),
    ]

    overlays = [
        _line(data, [p0, p1, p2, p3, p4, p5], "#06b6d4", "Three Drives Structure", line_width=2, line_style=0),
        _horizontal_line(data, int(p5["index"]), len(data) - 1, reaction_zone_min_price, "#f59e0b", "Reaction Zone", line_width=1, line_style=2),
        _horizontal_line(data, int(p5["index"]), len(data) - 1, reaction_zone_max_price, "#f97316", "Drive 3 Extreme", line_width=1, line_style=2),
    ]

    nearest_level = _nearest_reaction_level(direction, drive3_price, correction2_price, current_price)

    return {
        "direction": direction,
        "score": round(score, 4),
        "rules": rules,
        "anchors": anchors,
        "visual": {"markers": markers, "overlay_series": overlays},
        "window_start": int(p0["index"]),
        "window_end": len(data) - 1,
        "reason": f"{direction}_three_drives_reversal",
        "fib_levels": _build_reaction_levels(direction, drive3_price, correction2_price, current_price),
        "features": {
            "pattern_direction": direction,
            "drive1_length": round(drive1_len, 4),
            "drive2_length": round(drive2_len, 4),
            "drive3_length": round(drive3_len, 4),
            "correction1_retrace": round(retrace1, 4),
            "correction2_retrace": round(retrace2, 4),
            "drive2_extension": round(extension2, 4),
            "drive3_extension": round(extension3, 4),
            "drive_symmetry_12": round(drive_symmetry_12, 4),
            "drive_symmetry_23": round(drive_symmetry_23, 4),
            "retrace_symmetry": round(retrace_symmetry, 4),
            "reaction_pct": round(reaction_pct, 4),
            "nearest_reaction_level": nearest_level["level_label"],
            "nearest_reaction_price": nearest_level["price"],
            "nearest_reaction_distance_pct": nearest_level["distance_pct"],
        },
        "reaction_zone": {
            "passed": reaction_zone_valid,
            "current_price": round(current_price, 4),
            "reaction_pct": round(reaction_pct, 4),
            "zone_max_level": round(reaction_zone_max_level, 4),
            "zone_min_price": round(min(reaction_zone_min_price, reaction_zone_max_price), 4),
            "zone_max_price": round(max(reaction_zone_min_price, reaction_zone_max_price), 4),
        },
        "drive_structure": {
            "direction": direction,
            "drive_lengths": [round(drive1_len, 4), round(drive2_len, 4), round(drive3_len, 4)],
            "correction_retraces": [round(retrace1, 4), round(retrace2, 4)],
            "extensions": [round(extension2, 4), round(extension3, 4)],
        },
    }


def run_three_drives_pattern_plugin(
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
    correction_retrace_min_level = float(setup.get("correction_retrace_min_level", 0.50))
    correction_retrace_max_level = float(setup.get("correction_retrace_max_level", 0.786))
    extension_min_level = float(setup.get("extension_min_level", 1.13))
    extension_max_level = float(setup.get("extension_max_level", 1.786))
    drive_symmetry_pct = float(setup.get("drive_symmetry_pct", 0.40))
    reaction_zone_max_level = float(setup.get("reaction_zone_max_level", 0.382))
    min_score = float(setup.get("min_score", 0.58))
    max_candidates = max(1, int(setup.get("max_candidates", 2)))

    if len(data) < 50:
        return []
    if correction_retrace_min_level >= correction_retrace_max_level:
        return []
    if extension_min_level >= extension_max_level:
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
        result = _evaluate_three_drives_sequence(
            data=data,
            pivots=pivots,
            start=start,
            correction_retrace_min_level=correction_retrace_min_level,
            correction_retrace_max_level=correction_retrace_max_level,
            extension_min_level=extension_min_level,
            extension_max_level=extension_max_level,
            drive_symmetry_pct=drive_symmetry_pct,
            reaction_zone_max_level=reaction_zone_max_level,
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
            str(result["direction"]),
            int(result["anchors"]["drive3"]["index"]),
        )
        if key in occupied_keys:
            continue
        occupied_keys.add(key)
        deduped.append(result)
        if len(deduped) >= max_candidates:
            break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "three_drives_pattern_v1")
    candidates: List[Dict[str, Any]] = []

    for idx, result in enumerate(deduped):
        anchors = result["anchors"]
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_"
            f"{result['window_start']}_{result['anchors']['drive3']['index']}_{idx}"
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
            "reaction_zone": result["reaction_zone"],
            "drive_structure": result["drive_structure"],
            "fib_levels": {
                "reaction_pct": result["reaction_zone"]["reaction_pct"],
                "nearest_level": result["features"]["nearest_reaction_level"],
                "range_high": max(anchors["drive3"]["price"], anchors["correction2"]["price"]),
                "range_low": min(anchors["drive3"]["price"], anchors["correction2"]["price"]),
                "proximity_pct": result["features"]["nearest_reaction_distance_pct"],
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
                pattern_type="three_drives_pattern",
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
