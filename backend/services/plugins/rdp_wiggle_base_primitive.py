#!/usr/bin/env python3
"""
RDP Wiggle Base Primitive

Two-pass RDP base detection using geometric oscillation measurement.

Pass 1 (coarse epsilon): Find structural swing lows — the "floor confirmed" event.
Pass 2 (fine epsilon):   Reveal high-frequency structure (wiggles) after each floor.

WIGGLE_SCORE = ALT * AMP * TURN  (multiplicative — all three must be present)

  ALT  = alternation rate (how often leg direction flips)
  AMP  = amplitude compression (how small legs are vs prior regime)
  TURN = curvature without progress (lots of turning, little net displacement)

Base is qualified when WIGGLE_SCORE stays above threshold for M consecutive
windows of N fine-epsilon legs.

Escape = expansion leg that exceeds K_expand * median base leg AND clears cap.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp


def _spec_hash(spec: Dict[str, Any]) -> str:
    raw = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def _chart_data(data: List[OHLCV]) -> List[dict]:
    is_intra = _detect_intraday(data)
    return [
        {
            "time": _format_chart_time(b.timestamp, is_intra),
            "open": b.open, "high": b.high, "low": b.low,
            "close": b.close, "volume": getattr(b, "volume", 0),
        }
        for b in data
    ]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _enforce_alternation(pivots: list) -> list:
    """Filter pivot list to strict H-L-H-L alternation.
    When consecutive same-type pivots appear, keep the extreme one."""
    if len(pivots) < 2:
        return list(pivots)
    result = [pivots[0]]
    for pt in pivots[1:]:
        if pt.point_type == result[-1].point_type:
            if pt.point_type == "HIGH" and float(pt.price) > float(result[-1].price):
                result[-1] = pt
            elif pt.point_type == "LOW" and float(pt.price) < float(result[-1].price):
                result[-1] = pt
        else:
            result.append(pt)
    return result


def _legs_from_pivots(pivots: list) -> List[Dict[str, Any]]:
    """Convert alternating pivot list to legs with dP, absLeg, sign."""
    alt = _enforce_alternation(pivots)
    legs = []
    for i in range(1, len(alt)):
        dp = float(alt[i].price) - float(alt[i - 1].price)
        if abs(dp) < 1e-10:
            continue
        legs.append({
            "start_idx": int(alt[i - 1].index),
            "end_idx": int(alt[i].index),
            "dP": dp,
            "absLeg": abs(dp),
            "sign": 1 if dp > 0 else -1,
        })
    return legs


def _slope_pct_per_bar(values: List[float]) -> float:
    """Absolute least-squares slope of *values* normalised by the mean.

    Returns 0 for perfectly flat series; large values for trending series.
    """
    n = len(values)
    if n < 2:
        return 0.0
    sum_x = (n - 1) * n / 2.0
    sum_x2 = (n - 1) * n * (2 * n - 1) / 6.0
    sum_y = float(sum(values))
    sum_xy = 0.0
    for i, y in enumerate(values):
        sum_xy += i * float(y)
    denom = (n * sum_x2) - (sum_x * sum_x)
    if abs(denom) < 1e-12:
        return 0.0
    slope = ((n * sum_xy) - (sum_x * sum_y)) / denom
    mean_y = sum_y / n if n > 0 else 0.0
    if abs(mean_y) < 1e-9:
        return 0.0
    return abs(slope) / abs(mean_y)


def _alt_score(signs: List[int]) -> float:
    """Alternation rate: fraction of consecutive sign flips. 0..1"""
    if len(signs) < 2:
        return 0.0
    flips = sum(1 for i in range(1, len(signs)) if signs[i] != signs[i - 1])
    rate = flips / (len(signs) - 1)
    return min(rate / 0.75, 1.0)


def _amp_score(recent_sizes: List[float], ref_median: float = 1.0) -> float:
    """Amplitude consistency: low coefficient-of-variation in recent legs. 0..1

    A base has consistent, similar-sized oscillations (low CV).
    A trend or transition has wildly varying leg sizes (high CV).

    ref_median is kept as a parameter for backward compatibility but is no
    longer used — CV is scale-invariant and works across all price levels.
    """
    if len(recent_sizes) < 2:
        return 0.0
    mean = float(np.mean(recent_sizes))
    if mean <= 0:
        return 0.0
    std = float(np.std(recent_sizes))
    cv = std / mean  # 0 = perfectly consistent, 1+ = chaotic
    # Score: CV < 0.25 → 1.0, CV > 0.85 → 0.0
    return max(0.0, min((0.85 - cv) / 0.60, 1.0))


def _turn_score(legs_window: List[Dict[str, Any]], eps_fine_price: float) -> float:
    """Curvature-without-progress: high turning, low net displacement. 0..1"""
    if len(legs_window) < 3:
        return 0.0
    total_turn = 0.0
    for i in range(1, len(legs_window)):
        v1 = np.array([1.0, legs_window[i - 1]["dP"]])
        v2 = np.array([1.0, legs_window[i]["dP"]])
        cos_theta = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-12)
        cos_theta = max(-1.0, min(1.0, cos_theta))
        total_turn += abs(math.acos(cos_theta))
    net_disp = abs(
        sum(leg["dP"] for leg in legs_window)
    )
    path_len = sum(leg["absLeg"] for leg in legs_window)
    tper = total_turn / (net_disp + eps_fine_price)
    efficiency = net_disp / (path_len + 1e-12)
    turn_combined = tper * (1.0 - efficiency)
    return max(0.0, min((turn_combined - 0.3) / 1.5, 1.0))


def _wiggle_score(
    legs: List[Dict[str, Any]],
    window_size: int,
    ref_median: float,
    eps_fine_price: float,
) -> Optional[Dict[str, float]]:
    """Compute WIGGLE_SCORE over the last `window_size` legs."""
    if len(legs) < window_size:
        return None
    window = legs[-window_size:]
    signs = [l["sign"] for l in window]
    sizes = [l["absLeg"] for l in window]
    alt = _alt_score(signs)
    amp = _amp_score(sizes, ref_median)
    turn = _turn_score(window, eps_fine_price)
    wiggle = alt * amp * turn
    return {"ALT": alt, "AMP": amp, "TURN": turn, "WIGGLE": wiggle}


# ---------------------------------------------------------------------------
# Core event builder
# ---------------------------------------------------------------------------

def _local_atr(data: List[OHLCV], anchor_idx: int, window: int = 20) -> float:
    """Average true range over the window of bars ending at anchor_idx."""
    start = max(0, anchor_idx - window)
    bars  = data[start: anchor_idx + 1]
    if not bars:
        return 1.0
    return float(np.mean([b.high - b.low for b in bars]))


def _build_wiggle_events(
    data: List[OHLCV],
    coarse_swings: list,
    fine_epsilon: float,
    symbol: str,
    timeframe: str,
    window_n: int,
    persist_m: int,
    wiggle_thresh: float,
    k_expand: float,
    use_local_atr: bool = True,
    local_atr_window: int = 20,
    max_slope_pct: float = 0.005,
    max_range_pct: float = 0.80,
) -> List[Dict[str, Any]]:
    """
    For each coarse LOW, run fine RDP on data after the low,
    compute rolling WIGGLE_SCORE, determine base qualification and escape.

    use_local_atr: Scale fine epsilon by local ATR at the anchor instead of
                   the full post-anchor price range.  This is critical for
                   short bases (reaccumulation) where the breakout leg would
                   otherwise inflate the epsilon and erase the base wiggles.
    """
    coarse_pts = sorted(coarse_swings, key=lambda sp: sp.index)
    lows = [sp for sp in coarse_pts if sp.point_type == "LOW"]
    highs = [sp for sp in coarse_pts if sp.point_type == "HIGH"]

    events = []

    for low in lows:
        anchor_idx = int(low.index)
        anchor_price = float(low.price)

        # Find the prior high (for reference leg size)
        prior_high = None
        for h in reversed(highs):
            if int(h.index) < anchor_idx:
                prior_high = h
                break

        if anchor_idx >= len(data) - window_n:
            continue

        # Slice data from anchor onward
        post_data = data[anchor_idx:]
        if len(post_data) < window_n + 5:
            continue

        # Fine-epsilon RDP on post-anchor data
        fine_swings = detect_swings_rdp(
            post_data,
            f"{symbol}_FINE_{anchor_idx}",
            timeframe,
            epsilon_pct=fine_epsilon,
            use_exact_epsilon=True,
        )
        fine_pts = sorted(fine_swings.swing_points, key=lambda sp: sp.index)
        if len(fine_pts) < window_n + 1:
            continue

        legs = _legs_from_pivots(fine_pts)
        if len(legs) < window_n:
            continue

        # Reference median: use legs from the coarse segment BEFORE the low
        pre_start = max(0, anchor_idx - 80)
        pre_data = data[pre_start:anchor_idx + 1]
        ref_median = float(np.median([l["absLeg"] for l in legs[:window_n]]))
        if len(pre_data) > 20:
            try:
                pre_swings = detect_swings_rdp(
                    pre_data,
                    f"{symbol}_PRE_{anchor_idx}",
                    timeframe,
                    epsilon_pct=fine_epsilon,
                    use_exact_epsilon=True,
                )
                pre_pts = sorted(pre_swings.swing_points, key=lambda sp: sp.index)
                pre_legs = _legs_from_pivots(pre_pts)
                if len(pre_legs) >= 3:
                    ref_median = float(np.median([l["absLeg"] for l in pre_legs]))
            except Exception:
                pass

        eps_fine_price = fine_epsilon * anchor_price

        # Rolling WIGGLE computation on CONTAINED legs only
        qualified_count = 0
        qualify_idx: Optional[int] = None
        qualify_leg_k: Optional[int] = None
        streak_end_k: Optional[int] = None
        streak_broken = False
        escape_idx: Optional[int] = None
        best_wiggle: Optional[Dict[str, float]] = None
        wiggle_history: List[Dict[str, float]] = []

        for k in range(window_n, len(legs) + 1):
            w = _wiggle_score(legs[:k], window_n, ref_median, eps_fine_price)
            if w is None:
                continue
            wiggle_history.append(w)

            if w["WIGGLE"] >= wiggle_thresh:
                qualified_count += 1
                if qualified_count >= persist_m:
                    if qualify_idx is None:
                        qualify_idx = legs[k - 1]["end_idx"]
                        qualify_leg_k = k
                        best_wiggle = w
                    if not streak_broken:
                        streak_end_k = k
            else:
                qualified_count = 0
                if qualify_idx is not None:
                    streak_broken = True

        # Flatness gate: reject bases where the close series is trending
        # or the price range is too wide to be a real accumulation zone.
        # Measure only the bars spanned by the qualifying legs (not the
        # entire post-anchor window which may include breakout moves).
        if qualify_idx is not None and qualify_leg_k is not None:
            flat_start = legs[0]["start_idx"]
            flat_end = min(legs[qualify_leg_k - 1]["end_idx"], len(post_data) - 1)

            if flat_end > flat_start + 4:
                base_closes = [float(post_data[i].close) for i in range(flat_start, flat_end + 1)]
                base_highs  = [float(post_data[i].high)  for i in range(flat_start, flat_end + 1)]
                base_lows   = [float(post_data[i].low)   for i in range(flat_start, flat_end + 1)]

                slope = _slope_pct_per_bar(base_closes)
                range_pct = (max(base_highs) - min(base_lows)) / max(max(base_highs), 1e-9)

                if slope > max_slope_pct or range_pct > max_range_pct:
                    qualify_idx = None
                    qualify_leg_k = None
                    best_wiggle = None

        # Cap = max bar HIGH from anchor to the escape leg (exclusive)
        # The escape leg is the first up-leg that exceeds K_expand * median base leg
        # Everything BEFORE that escape is the oscillation ceiling (base cap)
        alt_pts = _enforce_alternation(fine_pts)

        # Find which leg is the escape (expansion) leg
        escape_leg_idx: Optional[int] = None
        if qualify_leg_k is not None:
            base_leg_end = qualify_leg_k
            base_leg_sizes = [l["absLeg"] for l in legs[:base_leg_end]]
            med_base = float(np.median(base_leg_sizes)) if base_leg_sizes else ref_median
            for li in range(qualify_leg_k, len(legs)):
                if legs[li]["sign"] > 0 and legs[li]["absLeg"] > k_expand * med_base:
                    escape_leg_idx = li
                    break

        # Cap boundary: up to escape leg start, or end of all legs
        if escape_leg_idx is not None:
            cap_bar_end = legs[escape_leg_idx]["start_idx"]
        else:
            cap_bar_end = legs[-1]["end_idx"] if legs else 0

        cap = anchor_price
        for bar_off in range(0, min(cap_bar_end + 1, len(post_data))):
            h = float(post_data[bar_off].high)
            if h > cap:
                cap = h

        # If cap still equals floor, extend through qualifying window at minimum
        if cap <= anchor_price + 1e-6 and qualify_leg_k is not None:
            q_end = legs[min(qualify_leg_k, len(legs)) - 1]["end_idx"]
            for bar_off in range(0, min(q_end + 1, len(post_data))):
                h = float(post_data[bar_off].high)
                if h > cap:
                    cap = h

        # Escape: use the expansion leg already identified above
        if escape_leg_idx is not None:
            actual_idx = anchor_idx + legs[escape_leg_idx]["end_idx"]
            if actual_idx < len(data) and float(data[actual_idx].close) > cap:
                escape_idx = actual_idx

        # Determine if base is still valid (no new lower low)
        active = True
        for other_low in lows:
            if int(other_low.index) > anchor_idx and float(other_low.price) < anchor_price:
                active = False
                break

        current_price = float(data[-1].close)

        # Base end index (in absolute data coords) — where oscillation stops
        base_end_abs = anchor_idx + cap_bar_end if cap_bar_end else anchor_idx

        events.append({
            "anchor_idx": anchor_idx,
            "anchor_price": anchor_price,
            "prior_high_price": float(prior_high.price) if prior_high else None,
            "prior_high_idx": int(prior_high.index) if prior_high else None,
            "qualify_idx": qualify_idx,
            "escape_idx": escape_idx,
            "cap_price": cap,
            "base_floor": anchor_price,
            "base_end_idx": min(base_end_abs, len(data) - 1),
            "active": active,
            "wiggle_scores": best_wiggle,
            "fine_leg_count": len(legs),
            "current_price": current_price,
            "broken_out": current_price > cap if qualify_idx is not None else False,
        })

    events.sort(key=lambda e: e["anchor_idx"], reverse=True)
    return events


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def run_rdp_wiggle_base_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Any:
    setup = spec.get("setup_config", {}) if isinstance(spec, dict) else {}
    eps_coarse = float(setup.get("epsilon_coarse", 0.05))
    eps_fine       = float(setup.get("epsilon_fine", 0.017))
    window_n       = int(setup.get("window_n", 7))
    persist_m      = int(setup.get("persist_m", 2))
    wiggle_thresh  = float(setup.get("wiggle_threshold", 0.45))
    k_expand       = float(setup.get("k_expand", 2.0))
    max_marked     = int(setup.get("max_marked_events", 3))
    use_local_atr  = bool(setup.get("use_local_atr", True))
    local_atr_win  = int(setup.get("local_atr_window", 20))
    max_slope_pct  = float(setup.get("max_slope_pct_per_bar", 0.005))
    max_range_pct  = float(setup.get("max_base_range_pct", 0.80))

    if len(data) < 60:
        return [] if mode == "scan" else set()

    coarse_swings = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=eps_coarse)
    events = _build_wiggle_events(
        data, coarse_swings.swing_points,
        fine_epsilon=eps_fine, symbol=symbol, timeframe=timeframe,
        window_n=window_n, persist_m=persist_m,
        wiggle_thresh=wiggle_thresh, k_expand=k_expand,
        use_local_atr=use_local_atr, local_atr_window=local_atr_win,
        max_slope_pct=max_slope_pct, max_range_pct=max_range_pct,
    )

    if mode == "signal":
        return {e["qualify_idx"] for e in events if e["qualify_idx"] is not None and e["active"]}

    found = len(events) > 0
    qualified = [e for e in events if e["qualify_idx"] is not None]
    active_qualified = [e for e in qualified if e["active"]]
    best = active_qualified[0] if active_qualified else (qualified[0] if qualified else (events[0] if found else None))

    markers: List[Dict[str, Any]] = []
    overlays: List[Dict[str, Any]] = []
    is_intra = _detect_intraday(data)
    t_last = _format_chart_time(data[-1].timestamp, is_intra)

    for e in events[:max_marked]:
        t_anchor = _format_chart_time(data[e["anchor_idx"]].timestamp, is_intra)

        # Floor marker
        markers.append({
            "time": t_anchor,
            "position": "belowBar",
            "color": "#f59e0b",
            "shape": "circle",
            "text": f"FLOOR ${e['anchor_price']:.2f}",
        })

        # Prior high marker
        if e["prior_high_idx"] is not None:
            markers.append({
                "time": _format_chart_time(data[e["prior_high_idx"]].timestamp, is_intra),
                "position": "aboveBar",
                "color": "#6b7280",
                "shape": "arrowDown",
                "text": f"H ${e['prior_high_price']:.2f}",
            })

        # Base Qualified marker
        if e["qualify_idx"] is not None and e["qualify_idx"] < len(data):
            color = "#22c55e" if e["active"] else "#9ca3af"
            ws = e["wiggle_scores"]
            w_text = f"W={ws['WIGGLE']:.2f}" if ws else "W=?"
            markers.append({
                "time": _format_chart_time(data[e["qualify_idx"]].timestamp, is_intra),
                "position": "aboveBar",
                "color": color,
                "shape": "arrowUp",
                "text": f"BASE {w_text}",
            })

        # Escape marker
        if e["escape_idx"] is not None and e["escape_idx"] < len(data):
            markers.append({
                "time": _format_chart_time(data[e["escape_idx"]].timestamp, is_intra),
                "position": "aboveBar",
                "color": "#3b82f6",
                "shape": "arrowUp",
                "text": "ESCAPE",
            })

        # Base floor line — from anchor to end of base oscillation
        t_base_end = _format_chart_time(data[e["base_end_idx"]].timestamp, is_intra)
        floor_pts = [
            {"time": t_anchor, "value": e["base_floor"]},
            {"time": t_base_end, "value": e["base_floor"]},
        ]
        overlays.append({
            "type": "line",
            "color": "#22c55e" if e["active"] else "#6b7280",
            "lineWidth": 2,
            "lineStyle": 0,
            "label": f"Floor ${e['base_floor']:.2f}",
            "points": floor_pts,
            "data": floor_pts,
        })

        # Cap line — from floor to end of base oscillation
        t_base_end = _format_chart_time(data[e["base_end_idx"]].timestamp, is_intra)
        cap_pts = [
            {"time": t_anchor, "value": e["cap_price"]},
            {"time": t_base_end, "value": e["cap_price"]},
        ]
        overlays.append({
            "type": "line",
            "color": "#f59e0b",
            "lineWidth": 1,
            "lineStyle": 2,
            "label": f"Cap ${e['cap_price']:.2f}",
            "points": cap_pts,
            "data": cap_pts,
        })

    entry_ready = bool(best and best["qualify_idx"] is not None and best["active"])
    score = 1.0 if entry_ready else (0.5 if found else 0.0)

    spec_hash = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    svid = spec.get("strategy_version_id", "rdp_wiggle_base_v1") if isinstance(spec, dict) else "rdp_wiggle_base_v1"
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_0_{len(data)-1}"

    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": entry_ready,
        "rule_checklist": [
            {"rule_name": "coarse_lows_found", "passed": any(e["anchor_idx"] for e in events) if events else False,
             "value": len(events), "threshold": ">= 1"},
            {"rule_name": "base_qualified", "passed": len(qualified) > 0,
             "value": len(qualified), "threshold": ">= 1"},
            {"rule_name": "active_base_exists", "passed": len(active_qualified) > 0,
             "value": len(active_qualified), "threshold": ">= 1"},
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "rdp_wiggle_base",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": -1,
        "chart_base_end": -1,
        "visual": {
            "markers": markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": entry_ready,
            "score": score,
            "reason": (
                f"Base qualified at floor ${best['base_floor']:.2f}, WIGGLE={best['wiggle_scores']['WIGGLE']:.2f}"
                if best and best["wiggle_scores"]
                else ("Coarse lows found but no base qualified" if found else "No structural lows found")
            ),
        },
        "output_ports": {
            "rdp_wiggle_base": {
                "count": len(events),
                "qualified_count": len(qualified),
                "active_count": len(active_qualified),
                "events": [
                    {
                        "anchor_idx": e["anchor_idx"],
                        "anchor_price": round(e["anchor_price"], 4),
                        "prior_high_idx": e["prior_high_idx"],
                        "prior_high_price": round(e["prior_high_price"], 4) if e["prior_high_price"] is not None else None,
                        "qualify_idx": e["qualify_idx"],
                        "escape_idx": e["escape_idx"],
                        "cap_price": round(e["cap_price"], 4),
                        "base_floor": round(e["base_floor"], 4),
                        "base_end_idx": e["base_end_idx"],
                        "active": e["active"],
                        "broken_out": e["broken_out"],
                        "wiggle": round(e["wiggle_scores"]["WIGGLE"], 4) if e["wiggle_scores"] else None,
                        "alt": round(e["wiggle_scores"]["ALT"], 4) if e["wiggle_scores"] else None,
                        "amp": round(e["wiggle_scores"]["AMP"], 4) if e["wiggle_scores"] else None,
                        "turn": round(e["wiggle_scores"]["TURN"], 4) if e["wiggle_scores"] else None,
                    }
                    for e in events
                ],
            }
        },
    }
    return [candidate]
