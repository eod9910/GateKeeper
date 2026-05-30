#!/usr/bin/env python3
"""
Head & Shoulders Bottom (Inverse H&S) primitive — Bulkowski-style bullish reversal.

5-pivot LOW-HIGH-LOW-HIGH-LOW window where:
  - the middle LOW (head) is the LOWEST of the three valleys
  - the two outer LOWs (left/right shoulders) are roughly symmetric
  - the two HIGHs form the neckline (use the HIGHER for the breakout threshold,
    Bulkowski's preferred conservative choice)

Bulkowski "Encyclopedia of Chart Patterns" reference values:
  - Failure rate (waiting for confirmation): ~3%
  - Average rise: ~38%
  - Throwback rate: ~50%
  - Best after a clear prior downtrend; one of the most reliable reversal patterns
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


BULKOWSKI_FAILURE_RATE = 0.03
BULKOWSKI_AVG_RISE_PCT = 0.38
BULKOWSKI_THROWBACK_RATE = 0.50


def _evaluate_hs_bottom(
    *,
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    shoulder_symmetry_pct: float,
    head_depth_min_pct: float,
    min_bars_shoulder_to_head: int,
    require_prior_downtrend: bool,
    confirm_close_above_neckline: bool,
    pullback_proximity_pct: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + 5])
    if len(window) != 5:
        return None
    if [p["type"] for p in window] != ["LOW", "HIGH", "LOW", "HIGH", "LOW"]:
        return None

    ls, h1, head, h2, rs = window
    ls_price = float(ls["price"])
    rs_price = float(rs["price"])
    head_price = float(head["price"])
    h1_price = float(h1["price"])
    h2_price = float(h2["price"])

    # Rule: head is the lowest valley
    head_is_lowest = head_price < ls_price and head_price < rs_price

    # Rule: shoulders roughly symmetric
    shoulder_delta = pct_diff(ls_price, rs_price)
    shoulders_symmetric = shoulder_delta <= shoulder_symmetry_pct

    # Rule: head deep enough below the average shoulder
    avg_shoulder = (ls_price + rs_price) / 2.0
    head_depth = (avg_shoulder - head_price) / max(avg_shoulder, 1e-9)
    head_deep_enough = head_depth >= head_depth_min_pct

    # Rule: spacing
    bars_ls_head = int(head["index"]) - int(ls["index"])
    bars_head_rs = int(rs["index"]) - int(head["index"])
    spacing_ok = bars_ls_head >= min_bars_shoulder_to_head and bars_head_rs >= min_bars_shoulder_to_head

    # Rule: prior downtrend
    prior_downtrend_ok = True
    if require_prior_downtrend and start > 0:
        prior_pivots = pivots[:start]
        prior_lows = [float(p["price"]) for p in prior_pivots if p["type"] == "LOW"]
        if prior_lows and min(prior_lows) <= ls_price:
            prior_downtrend_ok = False

    # Neckline: higher of the two H pivots (conservative)
    neckline_price = max(h1_price, h2_price)
    confirmation_index: Optional[int] = None
    if confirm_close_above_neckline:
        confirmation_index = find_close_break_index(
            data,
            start_index=int(rs["index"]) + 1,
            threshold=neckline_price,
            direction="above",
        )
        if confirmation_index is None:
            return None

    target_price = measured_move_target(
        pattern_top=neckline_price,
        pattern_bottom=head_price,
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
        build_rule("head_is_lowest", head_is_lowest, round(head_price, 4), f"<{round(min(ls_price, rs_price), 4)}"),
        build_rule("shoulders_symmetric", shoulders_symmetric, round(shoulder_delta, 4), shoulder_symmetry_pct),
        build_rule("head_deep_enough", head_deep_enough, round(head_depth, 4), head_depth_min_pct),
        build_rule("min_bars_shoulder_to_head", spacing_ok, min(bars_ls_head, bars_head_rs), min_bars_shoulder_to_head),
        build_rule("prior_downtrend", prior_downtrend_ok, "ok" if prior_downtrend_ok else "fail", "required" if require_prior_downtrend else "skipped"),
    ]
    if confirm_close_above_neckline:
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
        0.25 * clamp01(1.0 - (shoulder_delta / max(shoulder_symmetry_pct, 1e-9)))
        + 0.30 * clamp01(head_depth / max(head_depth_min_pct * 2.0, 1e-9))
        + 0.10 * clamp01(min(bars_ls_head, bars_head_rs) / max(min_bars_shoulder_to_head * 3.0, 1.0))
        + (0.25 if confirmation_index is not None else 0.0)
        + (0.10 if in_pullback_zone else 0.0)
    )
    if score < min_score:
        return None

    confirmation_bar = confirmation_index if confirmation_index is not None else len(data) - 1
    anchors = {
        "left_shoulder": round_anchor(ls),
        "left_neckline_pivot": round_anchor(h1),
        "head": round_anchor(head),
        "right_neckline_pivot": round_anchor(h2),
        "right_shoulder": round_anchor(rs),
        "neckline_price": round(neckline_price, 4),
        "target_price": round(target_price, 4),
        "confirmation_bar": int(confirmation_bar) if confirmation_index is not None else None,
        "stop_price": round(head_price, 4),
    }

    markers = [
        marker(data, int(ls["index"]), "belowBar", "#22c55e", "circle", f"LS {ls_price:.0f}"),
        marker(data, int(head["index"]), "belowBar", "#22c55e", "arrowDown", f"H {head_price:.0f}"),
        marker(data, int(rs["index"]), "belowBar", "#22c55e", "circle", f"RS {rs_price:.0f}"),
        marker(data, int(h1["index"]), "aboveBar", "#3b82f6", "square", f"N1 {h1_price:.0f}"),
        marker(data, int(h2["index"]), "aboveBar", "#3b82f6", "square", f"N2 {h2_price:.0f}"),
    ]
    if confirmation_index is not None:
        markers.append(
            marker(data, int(confirmation_index), "aboveBar", "#a855f7", "arrowUp", "BOS")
        )

    overlays = [
        line(data, [ls, h1, head, h2, rs], "#22c55e", "Inverse H&S Structure", line_width=2),
        horizontal_line(data, int(ls["index"]), len(data) - 1, neckline_price, "#3b82f6", "Neckline", line_style=2),
        horizontal_line(data, int(rs["index"]), len(data) - 1, target_price, "#22c55e", "Target", line_style=2),
        horizontal_line(data, int(ls["index"]), len(data) - 1, head_price, "#f59e0b", "Stop / Head Low", line_style=2),
    ]

    return {
        "direction": "bullish",
        "score": round(clamp01(score), 4),
        "rules": rules,
        "anchors": anchors,
        "visual": {"markers": markers, "overlay_series": overlays},
        "window_start": int(ls["index"]),
        "window_end": len(data) - 1,
        "reason": "hs_bottom_confirmed" if confirmation_index is not None else "hs_bottom_forming",
        "features": {
            "pattern_direction": "bullish",
            "shoulder_delta_pct": round(shoulder_delta, 4),
            "head_depth_pct": round(head_depth, 4),
            "bars_ls_head": bars_ls_head,
            "bars_head_rs": bars_head_rs,
            "neckline_price": round(neckline_price, 4),
            "target_price": round(target_price, 4),
            "stop_price": round(head_price, 4),
            "measured_move_pct": round((target_price - head_price) / max(head_price, 1e-9), 4),
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


def run_hs_bottom_pattern_plugin(
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

    shoulder_symmetry_pct = float(setup.get("shoulder_symmetry_pct", 0.05))
    head_depth_min_pct = float(setup.get("head_depth_min_pct", 0.05))
    min_bars_shoulder_to_head = max(1, int(setup.get("min_bars_shoulder_to_head", 8)))
    require_prior_downtrend = as_bool(setup.get("require_prior_downtrend", True), default=True)
    confirm_close_above_neckline = as_bool(setup.get("confirm_close_above_neckline", True), default=True)
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
        result = _evaluate_hs_bottom(
            data=data,
            pivots=pivots,
            start=start,
            shoulder_symmetry_pct=shoulder_symmetry_pct,
            head_depth_min_pct=head_depth_min_pct,
            min_bars_shoulder_to_head=min_bars_shoulder_to_head,
            require_prior_downtrend=require_prior_downtrend,
            confirm_close_above_neckline=confirm_close_above_neckline,
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
            int(result["anchors"]["left_shoulder"]["index"]),
            int(result["anchors"]["right_shoulder"]["index"]),
        )
        if key in occupied:
            continue
        occupied.add(key)
        deduped.append(result)
        if len(deduped) >= max_candidates:
            break

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "hs_bottom_pattern_v1")
    candidates: List[Dict[str, Any]] = []

    for idx, result in enumerate(deduped):
        anchors = result["anchors"]
        candidate_id = (
            f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_"
            f"{result['window_start']}_{anchors['right_shoulder']['index']}_{idx}"
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
                pattern_type="hs_bottom_pattern",
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
