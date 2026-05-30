#!/usr/bin/env python3
"""
Rectangle pattern — Bulkowski-style range / horizontal channel.

Geometry:
  - Multiple HIGH pivots forming a flat resistance line (slope ~ 0).
  - Multiple LOW pivots forming a flat support line (slope ~ 0).
  - Lines roughly parallel (NOT converging).
  - Confirmation = close break of EITHER trendline; emitted direction matches the
    actual breakout. Bulkowski stats differ for top-vs-bottom and up-vs-down.

Bulkowski "Encyclopedia of Chart Patterns" reference values:
  Rectangle Top, downward breakout:    failure 14%, avg decline 19%, pullback   67%
  Rectangle Bottom, upward breakout:   failure  9%, avg rise     46%, throwback 53%
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from platform_sdk.ohlcv import OHLCV
from plugins.bulkowski_geometry import (
    as_bool,
    classify_slope,
    extract_rdp_pivots,
    find_close_break_against_trendline,
    fit_trendline,
    horizontal_line,
    marker,
    measured_move_target,
    pct_diff,
    round_anchor,
    trendline_polyline,
    trendline_value_at,
)
from plugins.pattern_framework import (
    build_candidate,
    build_rule,
    clamp01,
    compute_spec_hash,
)


BULKOWSKI_TOP_DOWN_FAILURE_RATE = 0.14
BULKOWSKI_TOP_DOWN_AVG_DECLINE_PCT = 0.19
BULKOWSKI_TOP_DOWN_PULLBACK_RATE = 0.67
BULKOWSKI_BOTTOM_UP_FAILURE_RATE = 0.09
BULKOWSKI_BOTTOM_UP_AVG_RISE_PCT = 0.46
BULKOWSKI_BOTTOM_UP_THROWBACK_RATE = 0.53


def _evaluate_rectangle(
    *,
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    pivot_window_size: int,
    min_touches_per_line: int,
    max_residual_pct: float,
    min_r_squared: float,
    flat_slope_threshold_pct_per_bar: float,
    min_bars_window: int,
    max_band_width_pct: float,
    min_band_width_pct: float,
    confirm_close_break: bool,
    pullback_proximity_pct: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + pivot_window_size])
    if len(window) < pivot_window_size:
        return None

    highs = [p for p in window if p["type"] == "HIGH"]
    lows = [p for p in window if p["type"] == "LOW"]
    if len(highs) < min_touches_per_line or len(lows) < min_touches_per_line:
        return None

    bars_span = int(window[-1]["index"]) - int(window[0]["index"])
    if bars_span < min_bars_window:
        return None

    high_fit = fit_trendline(highs)
    low_fit = fit_trendline(lows)
    if high_fit is None or low_fit is None:
        return None

    ref_price = sum(float(p["price"]) for p in window) / len(window)
    high_slope_class = classify_slope(high_fit["slope"], ref_price, flat_slope_threshold_pct_per_bar)
    low_slope_class = classify_slope(low_fit["slope"], ref_price, flat_slope_threshold_pct_per_bar)

    is_flat_top = high_slope_class == "flat"
    is_flat_bottom = low_slope_class == "flat"

    high_clean = (
        high_fit["residual_max_pct"] <= max_residual_pct
        and high_fit["r_squared"] >= min_r_squared * 0.7
    )
    low_clean = (
        low_fit["residual_max_pct"] <= max_residual_pct
        and low_fit["r_squared"] >= min_r_squared * 0.7
    )

    last_window_idx = int(window[-1]["index"])
    resistance_at_last = trendline_value_at(high_fit["slope"], high_fit["intercept"], last_window_idx)
    support_at_last = trendline_value_at(low_fit["slope"], low_fit["intercept"], last_window_idx)
    pattern_top = (resistance_at_last + trendline_value_at(high_fit["slope"], high_fit["intercept"], int(window[0]["index"]))) / 2.0
    pattern_bottom = (support_at_last + trendline_value_at(low_fit["slope"], low_fit["intercept"], int(window[0]["index"]))) / 2.0
    pattern_height = pattern_top - pattern_bottom
    if pattern_height <= 0:
        return None

    band_width_pct = pattern_height / max(pattern_top, 1e-9)
    band_width_in_range = min_band_width_pct <= band_width_pct <= max_band_width_pct

    direction = "neutral"
    confirmation_index: Optional[int] = None
    breakout_against = None
    if confirm_close_break:
        up_idx = find_close_break_against_trendline(
            data,
            slope=high_fit["slope"],
            intercept=high_fit["intercept"],
            start_index=last_window_idx + 1,
            direction="above",
        )
        down_idx = find_close_break_against_trendline(
            data,
            slope=low_fit["slope"],
            intercept=low_fit["intercept"],
            start_index=last_window_idx + 1,
            direction="below",
        )
        candidates_idx = [(i, side) for i, side in [(up_idx, "above"), (down_idx, "below")] if i is not None]
        if not candidates_idx:
            return None
        candidates_idx.sort(key=lambda t: t[0])
        confirmation_index, breakout_against = candidates_idx[0]
        direction = "bullish" if breakout_against == "above" else "bearish"

    if confirmation_index is not None:
        line_slope, line_intercept = (
            (high_fit["slope"], high_fit["intercept"])
            if breakout_against == "above"
            else (low_fit["slope"], low_fit["intercept"])
        )
        breakout_price = trendline_value_at(line_slope, line_intercept, confirmation_index)
        target_price = measured_move_target(
            pattern_top=pattern_top,
            pattern_bottom=pattern_bottom,
            breakout_price=breakout_price,
            direction=direction,
        )
    else:
        target_price = pattern_top + pattern_height

    current_price = float(data[-1].close)
    in_pullback_zone = False
    if confirmation_index is not None:
        line_slope, line_intercept = (
            (high_fit["slope"], high_fit["intercept"])
            if breakout_against == "above"
            else (low_fit["slope"], low_fit["intercept"])
        )
        live_line = trendline_value_at(line_slope, line_intercept, len(data) - 1)
        band_low = live_line * (1.0 - pullback_proximity_pct)
        band_high = live_line * (1.0 + pullback_proximity_pct)
        in_pullback_zone = band_low <= current_price <= band_high

    rules = [
        build_rule("flat_resistance_top", is_flat_top, high_slope_class, "flat"),
        build_rule("flat_support_bottom", is_flat_bottom, low_slope_class, "flat"),
        build_rule("top_line_clean", high_clean, round(high_fit["residual_max_pct"], 4), max_residual_pct),
        build_rule("bottom_line_clean", low_clean, round(low_fit["residual_max_pct"], 4), max_residual_pct),
        build_rule("min_high_touches", len(highs) >= min_touches_per_line, len(highs), min_touches_per_line),
        build_rule("min_low_touches", len(lows) >= min_touches_per_line, len(lows), min_touches_per_line),
        build_rule("min_bars_window", bars_span >= min_bars_window, bars_span, min_bars_window),
        build_rule("band_width_in_range", band_width_in_range, round(band_width_pct, 4), f"[{min_band_width_pct},{max_band_width_pct}]"),
    ]
    if confirm_close_break:
        rules.append(
            build_rule(
                "confirmed_breakout_either_side",
                confirmation_index is not None,
                breakout_against or "no",
                "required",
            )
        )

    if not all(rule["passed"] for rule in rules):
        return None

    score = (
        0.20 * clamp01(1.0 - pct_diff(high_fit["slope"], 0.0) / max(flat_slope_threshold_pct_per_bar * 4.0 * ref_price, 1e-9))
        + 0.20 * clamp01(1.0 - pct_diff(low_fit["slope"], 0.0) / max(flat_slope_threshold_pct_per_bar * 4.0 * ref_price, 1e-9))
        + 0.10 * clamp01(1.0 - high_fit["residual_max_pct"] / max(max_residual_pct, 1e-9))
        + 0.10 * clamp01(1.0 - low_fit["residual_max_pct"] / max(max_residual_pct, 1e-9))
        + 0.10 * clamp01((len(highs) + len(lows)) / max(2 * min_touches_per_line * 2.0, 1.0))
        + (0.20 if confirmation_index is not None else 0.0)
        + (0.10 if in_pullback_zone else 0.0)
    )
    if score < min_score:
        return None

    confirmation_bar = confirmation_index if confirmation_index is not None else len(data) - 1
    anchors = {
        "high_pivots": [round_anchor(h) for h in highs],
        "low_pivots": [round_anchor(l) for l in lows],
        "resistance_price": round(pattern_top, 4),
        "support_price": round(pattern_bottom, 4),
        "band_width_pct": round(band_width_pct, 4),
        "target_price": round(target_price, 4),
        "stop_price": round(pattern_bottom if direction == "bullish" else pattern_top, 4),
        "breakout_against": breakout_against,
        "confirmation_bar": int(confirmation_bar) if confirmation_index is not None else None,
    }

    markers = []
    for h in highs:
        markers.append(marker(data, int(h["index"]), "aboveBar", "#ef4444", "circle", f"R {float(h['price']):.0f}"))
    for l in lows:
        markers.append(marker(data, int(l["index"]), "belowBar", "#22c55e", "circle", f"S {float(l['price']):.0f}"))
    if confirmation_index is not None:
        shape = "arrowUp" if direction == "bullish" else "arrowDown"
        markers.append(marker(data, int(confirmation_index), "belowBar", "#a855f7", shape, "BOS"))

    overlays = [
        trendline_polyline(
            data, high_fit["slope"], high_fit["intercept"],
            int(window[0]["index"]), len(data) - 1,
            "#ef4444", "Resistance (flat)", line_width=2,
        ),
        trendline_polyline(
            data, low_fit["slope"], low_fit["intercept"],
            int(window[0]["index"]), len(data) - 1,
            "#22c55e", "Support (flat)", line_width=2,
        ),
        horizontal_line(
            data, int(window[0]["index"]), len(data) - 1, target_price,
            "#22c55e" if direction == "bullish" else "#ef4444", "Target", line_style=2,
        ),
    ]

    bulkowski = (
        {
            "failure_rate": BULKOWSKI_BOTTOM_UP_FAILURE_RATE,
            "avg_rise_pct": BULKOWSKI_BOTTOM_UP_AVG_RISE_PCT,
            "throwback_rate": BULKOWSKI_BOTTOM_UP_THROWBACK_RATE,
        }
        if direction == "bullish"
        else {
            "failure_rate": BULKOWSKI_TOP_DOWN_FAILURE_RATE,
            "avg_decline_pct": BULKOWSKI_TOP_DOWN_AVG_DECLINE_PCT,
            "pullback_rate": BULKOWSKI_TOP_DOWN_PULLBACK_RATE,
        }
    )

    return {
        "direction": direction,
        "score": round(clamp01(score), 4),
        "rules": rules,
        "anchors": anchors,
        "visual": {"markers": markers, "overlay_series": overlays},
        "window_start": int(window[0]["index"]),
        "window_end": len(data) - 1,
        "reason": (
            f"rectangle_confirmed_{direction}"
            if confirmation_index is not None
            else "rectangle_forming"
        ),
        "features": {
            "pattern_direction": direction,
            "high_slope": round(high_fit["slope"], 6),
            "low_slope": round(low_fit["slope"], 6),
            "high_slope_class": high_slope_class,
            "low_slope_class": low_slope_class,
            "high_r_squared": round(high_fit["r_squared"], 4),
            "low_r_squared": round(low_fit["r_squared"], 4),
            "high_touches": len(highs),
            "low_touches": len(lows),
            "bars_window": bars_span,
            "resistance_price": round(pattern_top, 4),
            "support_price": round(pattern_bottom, 4),
            "band_width_pct": round(band_width_pct, 4),
            "target_price": round(target_price, 4),
            "breakout_against": breakout_against,
            "is_confirmed": confirmation_index is not None,
            "in_pullback_zone": in_pullback_zone,
            "bulkowski_priors": bulkowski,
        },
        "entry_zone": {
            "passed": (confirmation_index is not None) and (not pullback_proximity_pct or in_pullback_zone),
            "current_price": round(current_price, 4),
            "in_pullback_zone": in_pullback_zone,
            "breakout_against": breakout_against,
        },
        "bulkowski": bulkowski,
    }


def run_rectangle_pattern_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    setup = spec.get("setup_config", {}) or {}
    structure_cfg = spec.get("structure_config", {}) or {}

    lookback_bars = max(80, int(setup.get("lookback_bars", 260)))
    pivot_source = str(setup.get("pivot_source", "rdp")).strip().lower()
    swing_epsilon_pct = float(setup.get("swing_epsilon_pct", structure_cfg.get("swing_epsilon_pct", 0.06)))
    use_exact_epsilon = as_bool(setup.get("use_exact_epsilon", structure_cfg.get("use_exact_epsilon", True)), default=True)

    pivot_window_size = max(4, int(setup.get("pivot_window_size", 6)))
    min_touches_per_line = max(2, int(setup.get("min_touches_per_line", 2)))
    max_residual_pct = float(setup.get("max_residual_pct", 0.04))
    min_r_squared = float(setup.get("min_r_squared", 0.40))
    flat_slope_threshold_pct_per_bar = float(setup.get("flat_slope_threshold_pct_per_bar", 0.0015))
    min_bars_window = max(8, int(setup.get("min_bars_window", 20)))
    max_band_width_pct = float(setup.get("max_band_width_pct", 0.30))
    min_band_width_pct = float(setup.get("min_band_width_pct", 0.03))
    confirm_close_break = as_bool(setup.get("confirm_close_break", True), default=True)
    pullback_proximity_pct = float(setup.get("pullback_proximity_pct", 0.02))

    min_score = float(setup.get("min_score", 0.55))
    max_candidates = max(1, int(setup.get("max_candidates", 2)))

    if len(data) < 50:
        return []

    lookback_start = max(0, len(data) - lookback_bars)
    pivots, resolved_pivot_source = extract_rdp_pivots(
        data=data,
        structure=structure,
        lookback_start=lookback_start,
        symbol=symbol,
        timeframe=timeframe,
        epsilon_pct=swing_epsilon_pct,
        use_exact_epsilon=use_exact_epsilon,
        pivot_source=pivot_source,
        min_pivots=pivot_window_size,
    )
    if len(pivots) < pivot_window_size:
        return []

    found: List[Dict[str, Any]] = []
    for start in range(0, len(pivots) - pivot_window_size + 1):
        result = _evaluate_rectangle(
            data=data,
            pivots=pivots,
            start=start,
            pivot_window_size=pivot_window_size,
            min_touches_per_line=min_touches_per_line,
            max_residual_pct=max_residual_pct,
            min_r_squared=min_r_squared,
            flat_slope_threshold_pct_per_bar=flat_slope_threshold_pct_per_bar,
            min_bars_window=min_bars_window,
            max_band_width_pct=max_band_width_pct,
            min_band_width_pct=min_band_width_pct,
            confirm_close_break=confirm_close_break,
            pullback_proximity_pct=pullback_proximity_pct,
            min_score=min_score,
        )
        if result:
            found.append(result)

    if not found:
        return []

    deduped: List[Dict[str, Any]] = []
    occupied = set()
    for result in sorted(found, key=lambda item: float(item["score"]), reverse=True):
        first_idx = int(result["window_start"])
        last_pivot = max(int(p["index"]) for p in result["anchors"]["high_pivots"] + result["anchors"]["low_pivots"])
        key = (first_idx, last_pivot)
        if key in occupied:
            continue
        occupied.add(key)
        deduped.append(result)
        if len(deduped) >= max_candidates:
            break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "rectangle_pattern_v1")
    candidates: List[Dict[str, Any]] = []

    for idx, result in enumerate(deduped):
        anchors = result["anchors"]
        last_pivot = max(int(p["index"]) for p in anchors["high_pivots"] + anchors["low_pivots"])
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_"
            f"{result['window_start']}_{last_pivot}_{idx}"
        )
        node_features = dict(result["features"])
        node_features["pivot_source"] = resolved_pivot_source
        node_features["swing_epsilon_pct"] = swing_epsilon_pct
        node_features["use_exact_epsilon"] = use_exact_epsilon

        is_actionable = bool(result["features"]["is_confirmed"])
        actionability = "entry_ready" if is_actionable else "setup_watch"

        output_ports = {
            "signal": {
                "passed": is_actionable,
                "score": result["score"],
                "reason": result["reason"],
            },
            "pattern_geometry": {
                "direction": result["direction"],
                "anchors": anchors,
                "score": result["score"],
            },
            "entry_zone": result["entry_zone"],
            "bulkowski_priors": result["bulkowski"],
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
                entry_ready=is_actionable,
                pattern_type="rectangle_pattern",
                rule_checklist=result["rules"],
                anchors=anchors,
                node_features=node_features,
                node_reason=result["reason"],
                output_ports=output_ports,
                visual=result["visual"],
                window_start=result["window_start"],
                window_end=result["window_end"],
                candidate_role="pattern_detector",
                candidate_actionability=actionability,
                extras={
                    "candidate_role": "pattern_detector",
                    "candidate_actionability": actionability,
                },
            )
        )

    return candidates
