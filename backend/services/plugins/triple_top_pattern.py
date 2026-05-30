#!/usr/bin/env python3
"""
Triple Top primitive — Bulkowski-style classical bearish reversal pattern.

Three roughly equal peaks separated by two valleys, in a prior uptrend,
followed (or about to be followed) by a close below the lower of the two
intervening valleys.

Bulkowski "Encyclopedia of Chart Patterns" reference values:
  - Failure rate (waiting for confirmation): ~10%
  - Average decline: ~19%
  - Pullback rate: ~61%
  - Best: bull-market peaks; relatively rare but reliable when confirmed

Detection pipeline:
  1. Extract pivots over `lookback_bars`.
  2. Slide a 5-pivot HIGH-LOW-HIGH-LOW-HIGH window across the pivots.
  3. Validate Bulkowski rules:
       - all three peaks within `peak_symmetry_pct` of each other
       - both valleys deep enough vs the peaks
       - bar separation between successive peaks
       - prior uptrend
  4. Optionally require a confirmed close below the LOWER valley (neckline).
  5. Score, dedupe by (peak_left, peak_right) anchor pair, emit candidates.
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


BULKOWSKI_FAILURE_RATE = 0.10
BULKOWSKI_AVG_DECLINE_PCT = 0.19
BULKOWSKI_PULLBACK_RATE = 0.61


def _evaluate_triple_top(
    *,
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    peak_symmetry_pct: float,
    valley_depth_min_pct: float,
    min_bars_between_peaks: int,
    require_prior_uptrend: bool,
    confirm_close_below_valley: bool,
    pullback_proximity_pct: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + 5])
    if len(window) != 5:
        return None
    if [p["type"] for p in window] != ["HIGH", "LOW", "HIGH", "LOW", "HIGH"]:
        return None

    p1, v1, p2, v2, p3 = window
    p1_price = float(p1["price"])
    p2_price = float(p2["price"])
    p3_price = float(p3["price"])
    v1_price = float(v1["price"])
    v2_price = float(v2["price"])

    # Rule: all three peaks roughly equal — measure max pairwise delta
    peak_deltas = [
        pct_diff(p1_price, p2_price),
        pct_diff(p2_price, p3_price),
        pct_diff(p1_price, p3_price),
    ]
    peak_max_delta = max(peak_deltas)
    peaks_symmetric = peak_max_delta <= peak_symmetry_pct

    # Rule: both valleys deep enough vs the higher of their adjacent peaks
    higher_peak = max(p1_price, p2_price, p3_price)
    v1_depth = (max(p1_price, p2_price) - v1_price) / max(higher_peak, 1e-9)
    v2_depth = (max(p2_price, p3_price) - v2_price) / max(higher_peak, 1e-9)
    min_valley_depth = min(v1_depth, v2_depth)
    valleys_deep_enough = min_valley_depth >= valley_depth_min_pct

    # Rule: spacing between successive peaks
    bars_p1_p2 = int(p2["index"]) - int(p1["index"])
    bars_p2_p3 = int(p3["index"]) - int(p2["index"])
    spacing_ok = bars_p1_p2 >= min_bars_between_peaks and bars_p2_p3 >= min_bars_between_peaks

    # Rule: prior uptrend
    prior_uptrend_ok = True
    if require_prior_uptrend and start > 0:
        prior_pivots = pivots[:start]
        prior_highs = [float(p["price"]) for p in prior_pivots if p["type"] == "HIGH"]
        if prior_highs and max(prior_highs) >= p1_price:
            prior_uptrend_ok = False

    # Confirmation: close below LOWER valley (neckline)
    neckline_price = min(v1_price, v2_price)
    confirmation_index: Optional[int] = None
    if confirm_close_below_valley:
        confirmation_index = find_close_break_index(
            data,
            start_index=int(p3["index"]) + 1,
            threshold=neckline_price,
            direction="below",
        )
        if confirmation_index is None:
            return None

    target_price = measured_move_target(
        pattern_top=higher_peak,
        pattern_bottom=neckline_price,
        breakout_price=neckline_price,
        direction="bearish",
    )

    current_price = float(data[-1].close)
    in_pullback_zone = False
    if confirmation_index is not None:
        pullback_band_low = neckline_price * (1.0 - pullback_proximity_pct)
        pullback_band_high = neckline_price * (1.0 + pullback_proximity_pct)
        in_pullback_zone = pullback_band_low <= current_price <= pullback_band_high

    rules = [
        build_rule("peaks_roughly_equal", peaks_symmetric, round(peak_max_delta, 4), peak_symmetry_pct),
        build_rule("valleys_deep_enough", valleys_deep_enough, round(min_valley_depth, 4), valley_depth_min_pct),
        build_rule("min_bars_between_peaks", spacing_ok, min(bars_p1_p2, bars_p2_p3), min_bars_between_peaks),
        build_rule("prior_uptrend", prior_uptrend_ok, "ok" if prior_uptrend_ok else "fail", "required" if require_prior_uptrend else "skipped"),
    ]
    if confirm_close_below_valley:
        rules.append(
            build_rule(
                "confirmed_close_below_neckline",
                confirmation_index is not None,
                "yes" if confirmation_index is not None else "no",
                "required",
            )
        )

    if not all(rule["passed"] for rule in rules):
        return None

    score = (
        0.30 * clamp01(1.0 - (peak_max_delta / max(peak_symmetry_pct, 1e-9)))
        + 0.25 * clamp01(min_valley_depth / max(valley_depth_min_pct * 2.0, 1e-9))
        + 0.15 * clamp01(min(bars_p1_p2, bars_p2_p3) / max(min_bars_between_peaks * 3.0, 1.0))
        + (0.20 if confirmation_index is not None else 0.0)
        + (0.10 if in_pullback_zone else 0.0)
    )
    if score < min_score:
        return None

    confirmation_bar = confirmation_index if confirmation_index is not None else len(data) - 1
    anchors = {
        "peak_left": round_anchor(p1),
        "valley_left": round_anchor(v1),
        "peak_mid": round_anchor(p2),
        "valley_right": round_anchor(v2),
        "peak_right": round_anchor(p3),
        "neckline_price": round(neckline_price, 4),
        "target_price": round(target_price, 4),
        "confirmation_bar": int(confirmation_bar) if confirmation_index is not None else None,
        "stop_price": round(higher_peak, 4),
    }

    markers = [
        marker(data, int(p1["index"]), "aboveBar", "#ef4444", "circle", f"TT1 {p1_price:.0f}"),
        marker(data, int(p2["index"]), "aboveBar", "#ef4444", "circle", f"TT2 {p2_price:.0f}"),
        marker(data, int(p3["index"]), "aboveBar", "#ef4444", "circle", f"TT3 {p3_price:.0f}"),
        marker(data, int(v1["index"]), "belowBar", "#3b82f6", "square", f"V1 {v1_price:.0f}"),
        marker(data, int(v2["index"]), "belowBar", "#3b82f6", "square", f"V2 {v2_price:.0f}"),
    ]
    if confirmation_index is not None:
        markers.append(
            marker(data, int(confirmation_index), "belowBar", "#a855f7", "arrowDown", "BOS")
        )

    overlays = [
        line(data, [p1, v1, p2, v2, p3], "#ef4444", "Triple Top Structure", line_width=2),
        horizontal_line(data, int(p1["index"]), len(data) - 1, neckline_price, "#3b82f6", "Neckline (lower valley)", line_style=2),
        horizontal_line(data, int(p3["index"]), len(data) - 1, target_price, "#22c55e", "Target", line_style=2),
        horizontal_line(data, int(p1["index"]), len(data) - 1, higher_peak, "#f59e0b", "Stop / Pattern High", line_style=2),
    ]

    return {
        "direction": "bearish",
        "score": round(clamp01(score), 4),
        "rules": rules,
        "anchors": anchors,
        "visual": {"markers": markers, "overlay_series": overlays},
        "window_start": int(p1["index"]),
        "window_end": len(data) - 1,
        "reason": "triple_top_confirmed" if confirmation_index is not None else "triple_top_forming",
        "features": {
            "pattern_direction": "bearish",
            "peak_max_delta_pct": round(peak_max_delta, 4),
            "min_valley_depth_pct": round(min_valley_depth, 4),
            "bars_p1_p2": bars_p1_p2,
            "bars_p2_p3": bars_p2_p3,
            "neckline_price": round(neckline_price, 4),
            "target_price": round(target_price, 4),
            "stop_price": round(higher_peak, 4),
            "measured_move_pct": round((higher_peak - target_price) / max(higher_peak, 1e-9), 4),
            "is_confirmed": confirmation_index is not None,
            "in_pullback_zone": in_pullback_zone,
            "bulkowski_failure_rate": BULKOWSKI_FAILURE_RATE,
            "bulkowski_avg_decline_pct": BULKOWSKI_AVG_DECLINE_PCT,
            "bulkowski_pullback_rate": BULKOWSKI_PULLBACK_RATE,
        },
        "entry_zone": {
            "passed": (confirmation_index is not None) and (not pullback_proximity_pct or in_pullback_zone),
            "current_price": round(current_price, 4),
            "neckline_price": round(neckline_price, 4),
            "in_pullback_zone": in_pullback_zone,
        },
    }


def run_triple_top_pattern_plugin(
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

    peak_symmetry_pct = float(setup.get("peak_symmetry_pct", 0.05))
    valley_depth_min_pct = float(setup.get("valley_depth_min_pct", 0.08))
    min_bars_between_peaks = max(1, int(setup.get("min_bars_between_peaks", 8)))
    require_prior_uptrend = as_bool(setup.get("require_prior_uptrend", True), default=True)
    confirm_close_below_valley = as_bool(setup.get("confirm_close_below_valley", True), default=True)
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
        result = _evaluate_triple_top(
            data=data,
            pivots=pivots,
            start=start,
            peak_symmetry_pct=peak_symmetry_pct,
            valley_depth_min_pct=valley_depth_min_pct,
            min_bars_between_peaks=min_bars_between_peaks,
            require_prior_uptrend=require_prior_uptrend,
            confirm_close_below_valley=confirm_close_below_valley,
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
            int(result["anchors"]["peak_left"]["index"]),
            int(result["anchors"]["peak_right"]["index"]),
        )
        if key in occupied:
            continue
        occupied.add(key)
        deduped.append(result)
        if len(deduped) >= max_candidates:
            break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "triple_top_pattern_v1")
    candidates: List[Dict[str, Any]] = []

    for idx, result in enumerate(deduped):
        anchors = result["anchors"]
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_"
            f"{result['window_start']}_{anchors['peak_right']['index']}_{idx}"
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
                "avg_decline_pct": BULKOWSKI_AVG_DECLINE_PCT,
                "pullback_rate": BULKOWSKI_PULLBACK_RATE,
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
                pattern_type="triple_top_pattern",
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
