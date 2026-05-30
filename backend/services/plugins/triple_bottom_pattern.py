#!/usr/bin/env python3
"""
Triple Bottom primitive — Bulkowski-style classical bullish reversal pattern.

Mirror of triple_top: three roughly equal valleys separated by two peaks, in
a prior downtrend, followed (or about to be followed) by a close above the
HIGHER of the two intervening peaks (the neckline).

Bulkowski "Encyclopedia of Chart Patterns" reference values:
  - Failure rate (waiting for confirmation): ~4%
  - Average rise: ~37%
  - Throwback rate: ~64%
  - Best: bear-market bottoms; relatively rare but reliable when confirmed
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from platform_sdk.ohlcv import OHLCV
from plugins.bulkowski_geometry import (
    as_bool,
    extract_rdp_pivots,
    find_close_break_index,
    horizontal_line,
    line,
    marker,
    measured_move_target,
    pct_diff,
    round_anchor,
)
from plugins.pattern_framework import (
    build_candidate,
    build_rule,
    clamp01,
    compute_spec_hash,
)


BULKOWSKI_FAILURE_RATE = 0.04
BULKOWSKI_AVG_RISE_PCT = 0.37
BULKOWSKI_THROWBACK_RATE = 0.64


def _evaluate_triple_bottom(
    *,
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    valley_symmetry_pct: float,
    peak_height_min_pct: float,
    min_bars_between_valleys: int,
    require_prior_downtrend: bool,
    confirm_close_above_peak: bool,
    pullback_proximity_pct: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + 5])
    if len(window) != 5:
        return None
    if [p["type"] for p in window] != ["LOW", "HIGH", "LOW", "HIGH", "LOW"]:
        return None

    v1, p1, v2, p2, v3 = window
    v1_price = float(v1["price"])
    v2_price = float(v2["price"])
    v3_price = float(v3["price"])
    p1_price = float(p1["price"])
    p2_price = float(p2["price"])

    valley_deltas = [
        pct_diff(v1_price, v2_price),
        pct_diff(v2_price, v3_price),
        pct_diff(v1_price, v3_price),
    ]
    valley_max_delta = max(valley_deltas)
    valleys_symmetric = valley_max_delta <= valley_symmetry_pct

    lower_valley = min(v1_price, v2_price, v3_price)
    p1_height = (p1_price - min(v1_price, v2_price)) / max(lower_valley, 1e-9)
    p2_height = (p2_price - min(v2_price, v3_price)) / max(lower_valley, 1e-9)
    min_peak_height = min(p1_height, p2_height)
    peaks_high_enough = min_peak_height >= peak_height_min_pct

    bars_v1_v2 = int(v2["index"]) - int(v1["index"])
    bars_v2_v3 = int(v3["index"]) - int(v2["index"])
    spacing_ok = bars_v1_v2 >= min_bars_between_valleys and bars_v2_v3 >= min_bars_between_valleys

    prior_downtrend_ok = True
    if require_prior_downtrend and start > 0:
        prior_pivots = pivots[:start]
        prior_lows = [float(p["price"]) for p in prior_pivots if p["type"] == "LOW"]
        if prior_lows and min(prior_lows) <= v1_price:
            prior_downtrend_ok = False

    neckline_price = max(p1_price, p2_price)
    confirmation_index: Optional[int] = None
    if confirm_close_above_peak:
        confirmation_index = find_close_break_index(
            data,
            start_index=int(v3["index"]) + 1,
            threshold=neckline_price,
            direction="above",
        )
        if confirmation_index is None:
            return None

    target_price = measured_move_target(
        pattern_top=neckline_price,
        pattern_bottom=lower_valley,
        breakout_price=neckline_price,
        direction="bullish",
    )

    current_price = float(data[-1].close)
    in_pullback_zone = False
    if confirmation_index is not None:
        pullback_band_low = neckline_price * (1.0 - pullback_proximity_pct)
        pullback_band_high = neckline_price * (1.0 + pullback_proximity_pct)
        in_pullback_zone = pullback_band_low <= current_price <= pullback_band_high

    rules = [
        build_rule("valleys_roughly_equal", valleys_symmetric, round(valley_max_delta, 4), valley_symmetry_pct),
        build_rule("peaks_high_enough", peaks_high_enough, round(min_peak_height, 4), peak_height_min_pct),
        build_rule("min_bars_between_valleys", spacing_ok, min(bars_v1_v2, bars_v2_v3), min_bars_between_valleys),
        build_rule("prior_downtrend", prior_downtrend_ok, "ok" if prior_downtrend_ok else "fail", "required" if require_prior_downtrend else "skipped"),
    ]
    if confirm_close_above_peak:
        rules.append(
            build_rule(
                "confirmed_close_above_neckline",
                confirmation_index is not None,
                "yes" if confirmation_index is not None else "no",
                "required",
            )
        )

    if not all(rule["passed"] for rule in rules):
        return None

    score = (
        0.30 * clamp01(1.0 - (valley_max_delta / max(valley_symmetry_pct, 1e-9)))
        + 0.25 * clamp01(min_peak_height / max(peak_height_min_pct * 2.0, 1e-9))
        + 0.15 * clamp01(min(bars_v1_v2, bars_v2_v3) / max(min_bars_between_valleys * 3.0, 1.0))
        + (0.20 if confirmation_index is not None else 0.0)
        + (0.10 if in_pullback_zone else 0.0)
    )
    if score < min_score:
        return None

    confirmation_bar = confirmation_index if confirmation_index is not None else len(data) - 1
    anchors = {
        "valley_left": round_anchor(v1),
        "peak_left": round_anchor(p1),
        "valley_mid": round_anchor(v2),
        "peak_right": round_anchor(p2),
        "valley_right": round_anchor(v3),
        "neckline_price": round(neckline_price, 4),
        "target_price": round(target_price, 4),
        "confirmation_bar": int(confirmation_bar) if confirmation_index is not None else None,
        "stop_price": round(lower_valley, 4),
    }

    markers = [
        marker(data, int(v1["index"]), "belowBar", "#22c55e", "circle", f"TB1 {v1_price:.0f}"),
        marker(data, int(v2["index"]), "belowBar", "#22c55e", "circle", f"TB2 {v2_price:.0f}"),
        marker(data, int(v3["index"]), "belowBar", "#22c55e", "circle", f"TB3 {v3_price:.0f}"),
        marker(data, int(p1["index"]), "aboveBar", "#3b82f6", "square", f"P1 {p1_price:.0f}"),
        marker(data, int(p2["index"]), "aboveBar", "#3b82f6", "square", f"P2 {p2_price:.0f}"),
    ]
    if confirmation_index is not None:
        markers.append(
            marker(data, int(confirmation_index), "aboveBar", "#a855f7", "arrowUp", "BOS")
        )

    overlays = [
        line(data, [v1, p1, v2, p2, v3], "#22c55e", "Triple Bottom Structure", line_width=2),
        horizontal_line(data, int(v1["index"]), len(data) - 1, neckline_price, "#3b82f6", "Neckline (higher peak)", line_style=2),
        horizontal_line(data, int(v3["index"]), len(data) - 1, target_price, "#22c55e", "Target", line_style=2),
        horizontal_line(data, int(v1["index"]), len(data) - 1, lower_valley, "#f59e0b", "Stop / Pattern Low", line_style=2),
    ]

    return {
        "direction": "bullish",
        "score": round(clamp01(score), 4),
        "rules": rules,
        "anchors": anchors,
        "visual": {"markers": markers, "overlay_series": overlays},
        "window_start": int(v1["index"]),
        "window_end": len(data) - 1,
        "reason": "triple_bottom_confirmed" if confirmation_index is not None else "triple_bottom_forming",
        "features": {
            "pattern_direction": "bullish",
            "valley_max_delta_pct": round(valley_max_delta, 4),
            "min_peak_height_pct": round(min_peak_height, 4),
            "bars_v1_v2": bars_v1_v2,
            "bars_v2_v3": bars_v2_v3,
            "neckline_price": round(neckline_price, 4),
            "target_price": round(target_price, 4),
            "stop_price": round(lower_valley, 4),
            "measured_move_pct": round((target_price - lower_valley) / max(lower_valley, 1e-9), 4),
            "is_confirmed": confirmation_index is not None,
            "in_pullback_zone": in_pullback_zone,
            "bulkowski_failure_rate": BULKOWSKI_FAILURE_RATE,
            "bulkowski_avg_rise_pct": BULKOWSKI_AVG_RISE_PCT,
            "bulkowski_throwback_rate": BULKOWSKI_THROWBACK_RATE,
        },
        "entry_zone": {
            "passed": (confirmation_index is not None) and (not pullback_proximity_pct or in_pullback_zone),
            "current_price": round(current_price, 4),
            "neckline_price": round(neckline_price, 4),
            "in_pullback_zone": in_pullback_zone,
        },
    }


def run_triple_bottom_pattern_plugin(
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
    swing_epsilon_pct = float(setup.get("swing_epsilon_pct", structure_cfg.get("swing_epsilon_pct", 0.08)))
    use_exact_epsilon = as_bool(setup.get("use_exact_epsilon", structure_cfg.get("use_exact_epsilon", True)), default=True)

    valley_symmetry_pct = float(setup.get("valley_symmetry_pct", 0.05))
    peak_height_min_pct = float(setup.get("peak_height_min_pct", 0.08))
    min_bars_between_valleys = max(1, int(setup.get("min_bars_between_valleys", 8)))
    require_prior_downtrend = as_bool(setup.get("require_prior_downtrend", True), default=True)
    confirm_close_above_peak = as_bool(setup.get("confirm_close_above_peak", True), default=True)
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
        min_pivots=5,
    )
    if len(pivots) < 5:
        return []

    found: List[Dict[str, Any]] = []
    for start in range(0, len(pivots) - 4):
        result = _evaluate_triple_bottom(
            data=data,
            pivots=pivots,
            start=start,
            valley_symmetry_pct=valley_symmetry_pct,
            peak_height_min_pct=peak_height_min_pct,
            min_bars_between_valleys=min_bars_between_valleys,
            require_prior_downtrend=require_prior_downtrend,
            confirm_close_above_peak=confirm_close_above_peak,
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
        key = (
            int(result["anchors"]["valley_left"]["index"]),
            int(result["anchors"]["valley_right"]["index"]),
        )
        if key in occupied:
            continue
        occupied.add(key)
        deduped.append(result)
        if len(deduped) >= max_candidates:
            break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "triple_bottom_pattern_v1")
    candidates: List[Dict[str, Any]] = []

    for idx, result in enumerate(deduped):
        anchors = result["anchors"]
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_"
            f"{result['window_start']}_{anchors['valley_right']['index']}_{idx}"
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
            "bulkowski_priors": {
                "failure_rate": BULKOWSKI_FAILURE_RATE,
                "avg_rise_pct": BULKOWSKI_AVG_RISE_PCT,
                "throwback_rate": BULKOWSKI_THROWBACK_RATE,
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
                entry_ready=is_actionable,
                pattern_type="triple_bottom_pattern",
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
