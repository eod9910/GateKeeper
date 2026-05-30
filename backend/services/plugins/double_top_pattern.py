#!/usr/bin/env python3
"""
Double Top primitive — Bulkowski-style classical reversal pattern.

Detects two roughly equal peaks separated by a valley, in a prior uptrend,
followed (or about to be followed) by a close below the valley low.

Bulkowski "Encyclopedia of Chart Patterns" reference values:
  - Failure rate (waiting for confirmation): ~11%
  - Average decline: ~20%
  - Pullback rate: ~59%
  - Best: bull-market peaks with downward-sloping volume

Detection pipeline:
  1. Extract RDP (or pre-computed structure) pivots over `lookback_bars`.
  2. Slide a 3-pivot HIGH-LOW-HIGH window across the pivots.
  3. Validate Bulkowski rules:
       - peak symmetry (peaks within `peak_symmetry_pct` of each other)
       - valley depth between peaks (>= `valley_depth_min_pct` of peaks)
       - bar separation between peaks (>= `min_bars_between_peaks`)
       - prior uptrend (highest pre-window pivot below first peak)
  4. Optionally require a *confirmed* breakdown (close below valley low).
  5. Score, rank, dedupe by anchor pair, emit candidates.

Tunable params live in setup_config and are sweep-eligible (see JSON manifest).
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


# Bulkowski reference statistics (Encyclopedia of Chart Patterns, 3rd ed.)
BULKOWSKI_FAILURE_RATE = 0.11
BULKOWSKI_AVG_DECLINE_PCT = 0.20
BULKOWSKI_PULLBACK_RATE = 0.59


def _evaluate_double_top(
    *,
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    peak_symmetry_pct: float,
    valley_depth_min_pct: float,
    min_bars_between_peaks: int,
    require_prior_uptrend: bool,
    prior_rally_min_pct: float,
    confirm_close_below_valley: bool,
    pullback_proximity_pct: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + 3])
    if len(window) != 3:
        return None
    if [p["type"] for p in window] != ["HIGH", "LOW", "HIGH"]:
        return None

    p1, valley, p2 = window
    p1_price = float(p1["price"])
    p2_price = float(p2["price"])
    valley_price = float(valley["price"])

    # Rule: peaks roughly equal
    peak_delta = pct_diff(p1_price, p2_price)
    peaks_symmetric = peak_delta <= peak_symmetry_pct

    # Rule: valley deep enough (Bulkowski: ~10% min between peaks)
    higher_peak = max(p1_price, p2_price)
    valley_depth = (higher_peak - valley_price) / max(higher_peak, 1e-9)
    valley_deep_enough = valley_depth >= valley_depth_min_pct

    # Rule: spacing between peaks
    bars_between = int(p2["index"]) - int(p1["index"])
    spacing_ok = bars_between >= min_bars_between_peaks

    # Rule: prior uptrend — price must have rallied into the first peak.
    # Check that the lowest low in the N bars before p1 is significantly
    # below p1, proving an uptrend preceded the pattern (not a flat base).
    prior_uptrend_ok = True
    prior_rally_actual = 0.0
    if require_prior_uptrend:
        p1_idx = int(p1["index"])
        uptrend_lookback = max(min_bars_between_peaks, 20)
        lookback_from = max(0, p1_idx - uptrend_lookback)
        if lookback_from < p1_idx:
            pre_lows = [float(data[j].low) for j in range(lookback_from, p1_idx)]
            if pre_lows:
                lowest_before = min(pre_lows)
                prior_rally_actual = (p1_price - lowest_before) / max(lowest_before, 1e-9)
                prior_uptrend_ok = prior_rally_actual >= prior_rally_min_pct
            else:
                prior_uptrend_ok = False
        else:
            prior_uptrend_ok = False

    # Confirmation: close < valley low
    confirmation_index: Optional[int] = None
    if confirm_close_below_valley:
        confirmation_index = find_close_break_index(
            data,
            start_index=int(p2["index"]) + 1,
            threshold=valley_price,
            direction="below",
        )
        if confirmation_index is None:
            return None

    # Measured-move target (Bulkowski classic)
    breakout_price = valley_price
    target_price = measured_move_target(
        pattern_top=higher_peak,
        pattern_bottom=valley_price,
        breakout_price=breakout_price,
        direction="bearish",
    )

    # Pullback (throwback) detection: after confirmed break, did price
    # rally back toward the broken neckline?
    current_price = float(data[-1].close)
    in_pullback_zone = False
    if confirmation_index is not None:
        pullback_band_low = breakout_price * (1.0 - pullback_proximity_pct)
        pullback_band_high = breakout_price * (1.0 + pullback_proximity_pct)
        in_pullback_zone = pullback_band_low <= current_price <= pullback_band_high

    rules = [
        build_rule("peaks_roughly_equal", peaks_symmetric, round(peak_delta, 4), peak_symmetry_pct),
        build_rule("valley_deep_enough", valley_deep_enough, round(valley_depth, 4), valley_depth_min_pct),
        build_rule("min_bars_between_peaks", spacing_ok, bars_between, min_bars_between_peaks),
        build_rule("prior_uptrend", prior_uptrend_ok, round(prior_rally_actual, 4) if require_prior_uptrend else "skipped", prior_rally_min_pct if require_prior_uptrend else "skipped"),
    ]
    if confirm_close_below_valley:
        rules.append(
            build_rule(
                "confirmed_close_below_valley",
                confirmation_index is not None,
                "yes" if confirmation_index is not None else "no",
                "required",
            )
        )

    if not all(rule["passed"] for rule in rules):
        return None

    # Score: weighted blend of Bulkowski-priority structural fits
    score = (
        0.30 * clamp01(1.0 - (peak_delta / max(peak_symmetry_pct, 1e-9)))
        + 0.25 * clamp01(valley_depth / max(valley_depth_min_pct * 2.0, 1e-9))
        + 0.15 * clamp01(bars_between / max(min_bars_between_peaks * 3.0, 1.0))
        + (0.20 if confirmation_index is not None else 0.0)
        + (0.10 if in_pullback_zone else 0.0)
    )
    if score < min_score:
        return None

    # Visual layer
    confirmation_bar = confirmation_index if confirmation_index is not None else len(data) - 1
    anchors = {
        "peak_left": round_anchor(p1),
        "valley": round_anchor(valley),
        "peak_right": round_anchor(p2),
        "neckline_price": round(breakout_price, 4),
        "target_price": round(target_price, 4),
        "confirmation_bar": int(confirmation_bar) if confirmation_index is not None else None,
        "stop_price": round(higher_peak, 4),
    }

    markers = [
        marker(data, int(p1["index"]), "aboveBar", "#ef4444", "circle", f"DT1 {p1_price:.0f}"),
        marker(data, int(p2["index"]), "aboveBar", "#ef4444", "circle", f"DT2 {p2_price:.0f}"),
        marker(data, int(valley["index"]), "belowBar", "#3b82f6", "square", f"V {valley_price:.0f}"),
    ]
    if confirmation_index is not None:
        markers.append(
            marker(data, int(confirmation_index), "belowBar", "#a855f7", "arrowDown", "BOS")
        )

    overlays = [
        line(data, [p1, valley, p2], "#ef4444", "Double Top Structure", line_width=2),
        horizontal_line(data, int(p1["index"]), len(data) - 1, breakout_price, "#3b82f6", "Neckline", line_style=2),
        horizontal_line(data, int(p2["index"]), len(data) - 1, target_price, "#22c55e", "Target", line_style=2),
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
        "reason": "double_top_confirmed" if confirmation_index is not None else "double_top_forming",
        "features": {
            "pattern_direction": "bearish",
            "peak_delta_pct": round(peak_delta, 4),
            "valley_depth_pct": round(valley_depth, 4),
            "bars_between_peaks": bars_between,
            "neckline_price": round(breakout_price, 4),
            "target_price": round(target_price, 4),
            "stop_price": round(higher_peak, 4),
            "measured_move_pct": round((higher_peak - target_price) / max(higher_peak, 1e-9), 4),
            "prior_rally_pct": round(prior_rally_actual, 4),
            "is_confirmed": confirmation_index is not None,
            "in_pullback_zone": in_pullback_zone,
            "bulkowski_failure_rate": BULKOWSKI_FAILURE_RATE,
            "bulkowski_avg_decline_pct": BULKOWSKI_AVG_DECLINE_PCT,
            "bulkowski_pullback_rate": BULKOWSKI_PULLBACK_RATE,
        },
        "entry_zone": {
            "passed": (confirmation_index is not None) and (not pullback_proximity_pct or in_pullback_zone),
            "current_price": round(current_price, 4),
            "neckline_price": round(breakout_price, 4),
            "in_pullback_zone": in_pullback_zone,
        },
    }


def run_double_top_pattern_plugin(
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
    use_exact_epsilon = as_bool(setup.get("use_exact_epsilon", structure_cfg.get("use_exact_epsilon", True)), default=True)

    peak_symmetry_pct = float(setup.get("peak_symmetry_pct", 0.05))
    valley_depth_min_pct = float(setup.get("valley_depth_min_pct", 0.10))
    min_bars_between_peaks = max(1, int(setup.get("min_bars_between_peaks", 10)))
    require_prior_uptrend = as_bool(setup.get("require_prior_uptrend", True), default=True)
    prior_rally_min_pct = float(setup.get("prior_rally_min_pct", 0.15))
    confirm_close_below_valley = as_bool(setup.get("confirm_close_below_valley", True), default=True)
    pullback_proximity_pct = float(setup.get("pullback_proximity_pct", 0.02))

    min_score = float(setup.get("min_score", 0.55))
    max_candidates = max(1, int(setup.get("max_candidates", 2)))

    if len(data) < 40:
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
        min_pivots=3,
    )
    if len(pivots) < 3:
        return []

    found: List[Dict[str, Any]] = []
    for start in range(0, len(pivots) - 2):
        result = _evaluate_double_top(
            data=data,
            pivots=pivots,
            start=start,
            peak_symmetry_pct=peak_symmetry_pct,
            valley_depth_min_pct=valley_depth_min_pct,
            min_bars_between_peaks=min_bars_between_peaks,
            require_prior_uptrend=require_prior_uptrend,
            prior_rally_min_pct=prior_rally_min_pct,
            confirm_close_below_valley=confirm_close_below_valley,
            pullback_proximity_pct=pullback_proximity_pct,
            min_score=min_score,
        )
        if result:
            found.append(result)

    if not found:
        return []

    # Dedupe by (peak_left, peak_right) anchor pair, keep top scores
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
    strategy_version_id = spec.get("strategy_version_id", "double_top_pattern_v1")
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
                pattern_type="double_top_pattern",
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
