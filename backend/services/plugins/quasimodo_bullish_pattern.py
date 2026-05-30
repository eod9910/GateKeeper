#!/usr/bin/env python3
"""
Quasimodo Bullish primitive (a.k.a. "Over and Under" bottom).

Mirror of quasimodo_bearish: 5-pivot LOW-HIGH-LOW-HIGH-LOW window where:
  - the middle LOW (head) is the LOWEST of the three valleys
  - the right shoulder is ABOVE the left shoulder (Quasimodo asymmetry that
    distinguishes it from a classical inverse H&S where shoulders are roughly
    equal)
  - confirmation = close above the higher of the two intervening peaks
    (the "left high" / left armpit, which acts as the entry trigger)

No published Bulkowski statistic for Quasimodo specifically — we re-use the
H&S bottom priors as a directional sanity prior, but flag them as borrowed.
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


# Borrowed inverse H&S priors as a directional sanity baseline; flag as borrowed.
BULKOWSKI_FAILURE_RATE = 0.03
BULKOWSKI_AVG_RISE_PCT = 0.38
BULKOWSKI_THROWBACK_RATE = 0.50


def _evaluate_quasimodo_bullish(
    *,
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    head_discount_min_pct: float,
    right_shoulder_above_left_min_pct: float,
    min_bars_shoulder_to_head: int,
    require_prior_downtrend: bool,
    confirm_close_above_armpit: bool,
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

    # Rule: head is the lowest valley (discount below both shoulders)
    head_discount = (min(ls_price, rs_price) - head_price) / max(min(ls_price, rs_price), 1e-9)
    head_is_lowest = head_discount >= head_discount_min_pct

    # Rule: Quasimodo signature — right shoulder strictly above left shoulder
    rs_lift = (rs_price - ls_price) / max(ls_price, 1e-9)
    rs_above_ls = rs_lift >= right_shoulder_above_left_min_pct

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

    # Confirmation: close above the HIGHER of the two peaks (right armpit
    # of the QM)
    armpit_price = max(h1_price, h2_price)
    confirmation_index: Optional[int] = None
    if confirm_close_above_armpit:
        confirmation_index = find_close_break_index(
            data,
            start_index=int(rs["index"]) + 1,
            threshold=armpit_price,
            direction="above",
        )
        if confirmation_index is None:
            return None

    target_price = measured_move_target(
        pattern_top=armpit_price,
        pattern_bottom=head_price,
        breakout_price=armpit_price,
        direction="bullish",
    )

    current_price = float(data[-1].close)
    in_pullback_zone = False
    if confirmation_index is not None:
        pullback_band_low = armpit_price * (1.0 - pullback_proximity_pct)
        pullback_band_high = armpit_price * (1.0 + pullback_proximity_pct)
        in_pullback_zone = pullback_band_low <= current_price <= pullback_band_high

    rules = [
        build_rule("head_is_lowest", head_is_lowest, round(head_discount, 4), head_discount_min_pct),
        build_rule("right_shoulder_above_left", rs_above_ls, round(rs_lift, 4), right_shoulder_above_left_min_pct),
        build_rule("min_bars_shoulder_to_head", spacing_ok, min(bars_ls_head, bars_head_rs), min_bars_shoulder_to_head),
        build_rule("prior_downtrend", prior_downtrend_ok, "ok" if prior_downtrend_ok else "fail", "required" if require_prior_downtrend else "skipped"),
    ]
    if confirm_close_above_armpit:
        rules.append(
            build_rule(
                "confirmed_close_above_armpit",
                confirmation_index is not None,
                "yes" if confirmation_index is not None else "no",
                "required",
            )
        )

    if not all(rule["passed"] for rule in rules):
        return None

    score = (
        0.25 * clamp01(head_discount / max(head_discount_min_pct * 2.0, 1e-9))
        + 0.30 * clamp01(rs_lift / max(right_shoulder_above_left_min_pct * 2.0, 1e-9))
        + 0.10 * clamp01(min(bars_ls_head, bars_head_rs) / max(min_bars_shoulder_to_head * 3.0, 1.0))
        + (0.25 if confirmation_index is not None else 0.0)
        + (0.10 if in_pullback_zone else 0.0)
    )
    if score < min_score:
        return None

    confirmation_bar = confirmation_index if confirmation_index is not None else len(data) - 1
    anchors = {
        "left_shoulder": round_anchor(ls),
        "left_armpit": round_anchor(h1),
        "head": round_anchor(head),
        "right_armpit": round_anchor(h2),
        "right_shoulder": round_anchor(rs),
        "neckline_price": round(armpit_price, 4),
        "target_price": round(target_price, 4),
        "confirmation_bar": int(confirmation_bar) if confirmation_index is not None else None,
        "stop_price": round(head_price, 4),
    }

    markers = [
        marker(data, int(ls["index"]), "belowBar", "#22c55e", "circle", f"LS {ls_price:.0f}"),
        marker(data, int(head["index"]), "belowBar", "#22c55e", "arrowDown", f"H {head_price:.0f}"),
        marker(data, int(rs["index"]), "belowBar", "#22c55e", "circle", f"RS {rs_price:.0f}"),
        marker(data, int(h1["index"]), "aboveBar", "#3b82f6", "square", f"H1 {h1_price:.0f}"),
        marker(data, int(h2["index"]), "aboveBar", "#3b82f6", "square", f"H2 {h2_price:.0f}"),
    ]
    if confirmation_index is not None:
        markers.append(
            marker(data, int(confirmation_index), "aboveBar", "#a855f7", "arrowUp", "QM-BOS")
        )

    overlays = [
        line(data, [ls, h1, head, h2, rs], "#22c55e", "Quasimodo Bullish Structure", line_width=2),
        horizontal_line(data, int(ls["index"]), len(data) - 1, armpit_price, "#3b82f6", "Armpit (entry trigger)", line_style=2),
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
        "reason": "quasimodo_bullish_confirmed" if confirmation_index is not None else "quasimodo_bullish_forming",
        "features": {
            "pattern_direction": "bullish",
            "head_discount_pct": round(head_discount, 4),
            "right_shoulder_lift_pct": round(rs_lift, 4),
            "shoulder_delta_pct": round(pct_diff(ls_price, rs_price), 4),
            "bars_ls_head": bars_ls_head,
            "bars_head_rs": bars_head_rs,
            "armpit_price": round(armpit_price, 4),
            "target_price": round(target_price, 4),
            "stop_price": round(head_price, 4),
            "measured_move_pct": round((target_price - head_price) / max(head_price, 1e-9), 4),
            "is_confirmed": confirmation_index is not None,
            "in_pullback_zone": in_pullback_zone,
            "bulkowski_failure_rate": BULKOWSKI_FAILURE_RATE,
            "bulkowski_avg_rise_pct": BULKOWSKI_AVG_RISE_PCT,
            "bulkowski_throwback_rate": BULKOWSKI_THROWBACK_RATE,
            "priors_borrowed_from": "hs_bottom",
        },
        "entry_zone": {
            "passed": (confirmation_index is not None) and (not pullback_proximity_pct or in_pullback_zone),
            "current_price": round(current_price, 4),
            "neckline_price": round(armpit_price, 4),
            "in_pullback_zone": in_pullback_zone,
        },
    }


def run_quasimodo_bullish_pattern_plugin(
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

    head_discount_min_pct = float(setup.get("head_discount_min_pct", 0.03))
    right_shoulder_above_left_min_pct = float(setup.get("right_shoulder_above_left_min_pct", 0.02))
    min_bars_shoulder_to_head = max(1, int(setup.get("min_bars_shoulder_to_head", 6)))
    require_prior_downtrend = as_bool(setup.get("require_prior_downtrend", True), default=True)
    confirm_close_above_armpit = as_bool(setup.get("confirm_close_above_armpit", True), default=True)
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
        result = _evaluate_quasimodo_bullish(
            data=data,
            pivots=pivots,
            start=start,
            head_discount_min_pct=head_discount_min_pct,
            right_shoulder_above_left_min_pct=right_shoulder_above_left_min_pct,
            min_bars_shoulder_to_head=min_bars_shoulder_to_head,
            require_prior_downtrend=require_prior_downtrend,
            confirm_close_above_armpit=confirm_close_above_armpit,
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
    strategy_version_id = spec.get("strategy_version_id", "quasimodo_bullish_pattern_v1")
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
                "borrowed_from": "hs_bottom",
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
                pattern_type="quasimodo_bullish_pattern",
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
