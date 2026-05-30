#!/usr/bin/env python3
"""
Quasimodo Bearish primitive (a.k.a. "Over and Under" top).

5-pivot HIGH-LOW-HIGH-LOW-HIGH window where:
  - the middle HIGH (head) is the HIGHEST of the three peaks
  - the right shoulder is BELOW the left shoulder — this asymmetry is the
    Quasimodo signature that distinguishes it from a classical H&S top
    (where shoulders are roughly equal)
  - confirmation = close below the lower of the two intervening valleys
    (the "left low" / left armpit, which acts as the entry trigger)

Compared to a regular H&S top, Quasimodo is read as a stronger reversal
because the right shoulder failing to match the left signals exhausted
demand. Often used in price-action / smart-money trading.

No published Bulkowski statistic for Quasimodo specifically — we re-use the
H&S top priors as a directional sanity prior, but flag them as borrowed.
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


# Borrowed H&S top priors as a directional sanity baseline; flag as borrowed.
BULKOWSKI_FAILURE_RATE = 0.04
BULKOWSKI_AVG_DECLINE_PCT = 0.22
BULKOWSKI_PULLBACK_RATE = 0.50


def _evaluate_quasimodo_bearish(
    *,
    data: List[OHLCV],
    pivots: Sequence[Dict[str, Any]],
    start: int,
    head_premium_min_pct: float,
    right_shoulder_below_left_min_pct: float,
    min_bars_shoulder_to_head: int,
    require_prior_uptrend: bool,
    confirm_close_below_armpit: bool,
    pullback_proximity_pct: float,
    min_score: float,
) -> Optional[Dict[str, Any]]:
    window = list(pivots[start : start + 5])
    if len(window) != 5:
        return None
    if [p["type"] for p in window] != ["HIGH", "LOW", "HIGH", "LOW", "HIGH"]:
        return None

    ls, l1, head, l2, rs = window
    ls_price = float(ls["price"])
    rs_price = float(rs["price"])
    head_price = float(head["price"])
    l1_price = float(l1["price"])
    l2_price = float(l2["price"])

    # Rule: head is the highest peak (premium over both shoulders)
    head_premium = (head_price - max(ls_price, rs_price)) / max(head_price, 1e-9)
    head_is_highest = head_premium >= head_premium_min_pct

    # Rule: Quasimodo signature — right shoulder strictly below left shoulder
    rs_drop = (ls_price - rs_price) / max(ls_price, 1e-9)
    rs_below_ls = rs_drop >= right_shoulder_below_left_min_pct

    # Rule: spacing
    bars_ls_head = int(head["index"]) - int(ls["index"])
    bars_head_rs = int(rs["index"]) - int(head["index"])
    spacing_ok = bars_ls_head >= min_bars_shoulder_to_head and bars_head_rs >= min_bars_shoulder_to_head

    # Rule: prior uptrend
    prior_uptrend_ok = True
    if require_prior_uptrend and start > 0:
        prior_pivots = pivots[:start]
        prior_highs = [float(p["price"]) for p in prior_pivots if p["type"] == "HIGH"]
        if prior_highs and max(prior_highs) >= ls_price:
            prior_uptrend_ok = False

    # Confirmation: close below the LOWER of the two valleys (left armpit
    # of the QM)
    armpit_price = min(l1_price, l2_price)
    confirmation_index: Optional[int] = None
    if confirm_close_below_armpit:
        confirmation_index = find_close_break_index(
            data,
            start_index=int(rs["index"]) + 1,
            threshold=armpit_price,
            direction="below",
        )
        if confirmation_index is None:
            return None

    target_price = measured_move_target(
        pattern_top=head_price,
        pattern_bottom=armpit_price,
        breakout_price=armpit_price,
        direction="bearish",
    )

    current_price = float(data[-1].close)
    in_pullback_zone = False
    if confirmation_index is not None:
        pullback_band_low = armpit_price * (1.0 - pullback_proximity_pct)
        pullback_band_high = armpit_price * (1.0 + pullback_proximity_pct)
        in_pullback_zone = pullback_band_low <= current_price <= pullback_band_high

    rules = [
        build_rule("head_is_highest", head_is_highest, round(head_premium, 4), head_premium_min_pct),
        build_rule("right_shoulder_below_left", rs_below_ls, round(rs_drop, 4), right_shoulder_below_left_min_pct),
        build_rule("min_bars_shoulder_to_head", spacing_ok, min(bars_ls_head, bars_head_rs), min_bars_shoulder_to_head),
        build_rule("prior_uptrend", prior_uptrend_ok, "ok" if prior_uptrend_ok else "fail", "required" if require_prior_uptrend else "skipped"),
    ]
    if confirm_close_below_armpit:
        rules.append(
            build_rule(
                "confirmed_close_below_armpit",
                confirmation_index is not None,
                "yes" if confirmation_index is not None else "no",
                "required",
            )
        )

    if not all(rule["passed"] for rule in rules):
        return None

    score = (
        0.25 * clamp01(head_premium / max(head_premium_min_pct * 2.0, 1e-9))
        + 0.30 * clamp01(rs_drop / max(right_shoulder_below_left_min_pct * 2.0, 1e-9))
        + 0.10 * clamp01(min(bars_ls_head, bars_head_rs) / max(min_bars_shoulder_to_head * 3.0, 1.0))
        + (0.25 if confirmation_index is not None else 0.0)
        + (0.10 if in_pullback_zone else 0.0)
    )
    if score < min_score:
        return None

    confirmation_bar = confirmation_index if confirmation_index is not None else len(data) - 1
    anchors = {
        "left_shoulder": round_anchor(ls),
        "left_armpit": round_anchor(l1),
        "head": round_anchor(head),
        "right_armpit": round_anchor(l2),
        "right_shoulder": round_anchor(rs),
        "neckline_price": round(armpit_price, 4),
        "target_price": round(target_price, 4),
        "confirmation_bar": int(confirmation_bar) if confirmation_index is not None else None,
        "stop_price": round(head_price, 4),
    }

    markers = [
        marker(data, int(ls["index"]), "aboveBar", "#ef4444", "circle", f"LS {ls_price:.0f}"),
        marker(data, int(head["index"]), "aboveBar", "#ef4444", "arrowUp", f"H {head_price:.0f}"),
        marker(data, int(rs["index"]), "aboveBar", "#ef4444", "circle", f"RS {rs_price:.0f}"),
        marker(data, int(l1["index"]), "belowBar", "#3b82f6", "square", f"L1 {l1_price:.0f}"),
        marker(data, int(l2["index"]), "belowBar", "#3b82f6", "square", f"L2 {l2_price:.0f}"),
    ]
    if confirmation_index is not None:
        markers.append(
            marker(data, int(confirmation_index), "belowBar", "#a855f7", "arrowDown", "QM-BOS")
        )

    overlays = [
        line(data, [ls, l1, head, l2, rs], "#ef4444", "Quasimodo Bearish Structure", line_width=2),
        horizontal_line(data, int(ls["index"]), len(data) - 1, armpit_price, "#3b82f6", "Armpit (entry trigger)", line_style=2),
        horizontal_line(data, int(rs["index"]), len(data) - 1, target_price, "#22c55e", "Target", line_style=2),
        horizontal_line(data, int(ls["index"]), len(data) - 1, head_price, "#f59e0b", "Stop / Head High", line_style=2),
    ]

    return {
        "direction": "bearish",
        "score": round(clamp01(score), 4),
        "rules": rules,
        "anchors": anchors,
        "visual": {"markers": markers, "overlay_series": overlays},
        "window_start": int(ls["index"]),
        "window_end": len(data) - 1,
        "reason": "quasimodo_bearish_confirmed" if confirmation_index is not None else "quasimodo_bearish_forming",
        "features": {
            "pattern_direction": "bearish",
            "head_premium_pct": round(head_premium, 4),
            "right_shoulder_drop_pct": round(rs_drop, 4),
            "shoulder_delta_pct": round(pct_diff(ls_price, rs_price), 4),
            "bars_ls_head": bars_ls_head,
            "bars_head_rs": bars_head_rs,
            "armpit_price": round(armpit_price, 4),
            "target_price": round(target_price, 4),
            "stop_price": round(head_price, 4),
            "measured_move_pct": round((head_price - target_price) / max(head_price, 1e-9), 4),
            "is_confirmed": confirmation_index is not None,
            "in_pullback_zone": in_pullback_zone,
            "bulkowski_failure_rate": BULKOWSKI_FAILURE_RATE,
            "bulkowski_avg_decline_pct": BULKOWSKI_AVG_DECLINE_PCT,
            "bulkowski_pullback_rate": BULKOWSKI_PULLBACK_RATE,
            "priors_borrowed_from": "head_shoulders_top",
        },
        "entry_zone": {
            "passed": (confirmation_index is not None) and (not pullback_proximity_pct or in_pullback_zone),
            "current_price": round(current_price, 4),
            "neckline_price": round(armpit_price, 4),
            "in_pullback_zone": in_pullback_zone,
        },
    }


def run_quasimodo_bearish_pattern_plugin(
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

    head_premium_min_pct = float(setup.get("head_premium_min_pct", 0.03))
    right_shoulder_below_left_min_pct = float(setup.get("right_shoulder_below_left_min_pct", 0.02))
    min_bars_shoulder_to_head = max(1, int(setup.get("min_bars_shoulder_to_head", 6)))
    require_prior_uptrend = as_bool(setup.get("require_prior_uptrend", True), default=True)
    confirm_close_below_armpit = as_bool(setup.get("confirm_close_below_armpit", True), default=True)
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
        result = _evaluate_quasimodo_bearish(
            data=data,
            pivots=pivots,
            start=start,
            head_premium_min_pct=head_premium_min_pct,
            right_shoulder_below_left_min_pct=right_shoulder_below_left_min_pct,
            min_bars_shoulder_to_head=min_bars_shoulder_to_head,
            require_prior_uptrend=require_prior_uptrend,
            confirm_close_below_armpit=confirm_close_below_armpit,
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
    strategy_version_id = spec.get("strategy_version_id", "quasimodo_bearish_pattern_v1")
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
                "avg_decline_pct": BULKOWSKI_AVG_DECLINE_PCT,
                "pullback_rate": BULKOWSKI_PULLBACK_RATE,
                "borrowed_from": "head_shoulders_top",
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
                pattern_type="quasimodo_bearish_pattern",
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
