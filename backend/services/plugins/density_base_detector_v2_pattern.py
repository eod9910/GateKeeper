#!/usr/bin/env python3
"""
Density Base Detector V2 (Pattern) — Multi-Scale Void Detection
================================================================
Builds on V1's void detection with two key improvements:

1. Full history scan — uses all available data instead of a capped window,
   so it can find peaks and bases from any era (e.g. 2011 silver peak).
2. Nested bases — allows "bowl within bowl" patterns where a smaller base
   exists inside a larger one, instead of deduplicating them away.

V1 remains untouched as the proven tradable-signal detector.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp


# ── Helpers ───────────────────────────────────────────────────────────────

def _spec_hash(spec: Dict[str, Any]) -> str:
    raw = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _chart_data(data: List[OHLCV]) -> List[dict]:
    is_intra = _detect_intraday(data)
    return [
        {
            "time": _format_chart_time(b.timestamp, is_intra),
            "open": float(b.open),
            "high": float(b.high),
            "low": float(b.low),
            "close": float(b.close),
            "volume": float(getattr(b, "volume", 0.0) or 0.0),
        }
        for b in data
    ]


def _atr(data: List[OHLCV], start: int, end: int, length: int = 14) -> float:
    atr_val = 0.0
    count = 0
    for i in range(max(start, 1), end + 1):
        h = float(data[i].high)
        lo = float(data[i].low)
        pc = float(data[i - 1].close)
        tr = max(h - lo, abs(h - pc), abs(lo - pc))
        count += 1
        if count <= length:
            atr_val += tr
            if count == length:
                atr_val /= length
        else:
            atr_val = (atr_val * (length - 1) + tr) / length
    return max(atr_val, 1e-9)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


# ── Peak Detection ────────────────────────────────────────────────────────

def _extract_rdp_highs(
    data: List[OHLCV],
    symbol: str,
    timeframe: str,
    start: int,
    end: int,
    epsilon_pct: float,
) -> List[Dict[str, Any]]:
    """Use RDP swings as the structural peak map for V2."""
    swings = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    peaks: List[Dict[str, Any]] = []
    for sp in getattr(swings, "swing_points", []) or []:
        idx = int(getattr(sp, "index", -1))
        if idx < start or idx > end:
            continue
        if str(getattr(sp, "point_type", "")).upper() != "HIGH":
            continue
        fallback_price = float(data[idx].high)
        price = float(getattr(sp, "price", fallback_price))
        peaks.append({"idx": idx, "price": price, "source": "rdp"})
    peaks.sort(key=lambda p: int(p["idx"]))
    return peaks


def _merge_peak_maps(
    primary: List[Dict[str, Any]],
    secondary: List[Dict[str, Any]],
    min_index_gap: int = 12,
    min_price_gap_pct: float = 0.04,
) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = list(primary)
    for peak in secondary:
        idx = int(peak["idx"])
        price = float(peak["price"])
        is_distinct = True
        for existing in merged:
            existing_idx = int(existing["idx"])
            existing_price = float(existing["price"])
            index_gap = abs(idx - existing_idx)
            price_gap_pct = abs(price - existing_price) / max(existing_price, 1e-9)
            if index_gap <= min_index_gap or price_gap_pct <= min_price_gap_pct:
                is_distinct = False
                break
        if is_distinct:
            merged.append(peak)
    merged.sort(key=lambda p: int(p["idx"]))
    return merged


def _select_recent_supplemental_peaks(
    data: List[OHLCV],
    primary: List[Dict[str, Any]],
    local_peaks: List[Dict[str, Any]],
    end: int,
    min_drop_pct: float,
    min_void_bars: int,
    swing_lookback: int,
) -> List[Dict[str, Any]]:
    if not primary or not local_peaks:
        return []

    last_primary_idx = int(primary[-1]["idx"])
    candidates: List[Dict[str, Any]] = []
    for peak in local_peaks:
        idx = int(peak["idx"])
        if idx <= last_primary_idx + max(4, swing_lookback):
            continue
        void = _measure_void(
            data,
            idx,
            float(peak["price"]),
            end,
            min_drop_pct=min_drop_pct,
            min_void_bars=min_void_bars,
        )
        if not void:
            continue
        peak = dict(peak)
        peak["_supplemental_void_drop_pct"] = float(void["drop_pct"])
        peak["_supplemental_void_bars"] = int(void["void_bars"])
        candidates.append(peak)

    if not candidates:
        return []

    candidates.sort(
        key=lambda p: (
            int(p["idx"]),
            float(p.get("_supplemental_void_drop_pct", 0.0)),
            float(p.get("price", 0.0)),
        ),
        reverse=True,
    )
    return [candidates[0]]


def _find_local_swing_highs(
    data: List[OHLCV],
    start: int,
    end: int,
    lookback: int = 10,
    lookahead: int = 10,
) -> List[Dict[str, Any]]:
    """Fallback local swing highs if RDP produces no usable peaks."""
    peaks: List[Dict[str, Any]] = []
    for i in range(start + lookback, end - lookahead + 1):
        high_i = float(data[i].high)
        is_peak = True
        for j in range(i - lookback, i):
            if float(data[j].high) >= high_i:
                is_peak = False
                break
        if not is_peak:
            continue
        for j in range(i + 1, i + lookahead + 1):
            if j > end:
                break
            if float(data[j].high) >= high_i:
                is_peak = False
                break
        if is_peak:
            peaks.append({"idx": i, "price": high_i, "source": "local"})

    if not peaks:
        return []
    filtered = [peaks[0]]
    for p in peaks[1:]:
        if p["idx"] - filtered[-1]["idx"] < lookback:
            if p["price"] > filtered[-1]["price"]:
                filtered[-1] = p
        else:
            filtered.append(p)
    return filtered


# ── Void Detection ────────────────────────────────────────────────────────

def _measure_void(
    data: List[OHLCV],
    peak_idx: int,
    peak_price: float,
    end: int,
    min_drop_pct: float = 0.08,
    min_void_bars: int = 8,
) -> Optional[Dict[str, Any]]:
    """
    From a peak, scan forward. A void exists when price drops below the
    peak and stays there. The void's depth is how far price drops; its
    width is how many bars price remains below the peak.

    Returns None if no meaningful void is found.
    """
    n = len(data)
    scan_end = min(end, n - 1)

    below_start = None
    lowest_price = peak_price
    lowest_idx = peak_idx
    bars_below = 0
    recovery_idx = None

    for i in range(peak_idx + 1, scan_end + 1):
        bar_high = float(data[i].high)
        bar_low = float(data[i].low)
        bar_close = float(data[i].close)

        if bar_high < peak_price:
            if below_start is None:
                below_start = i
            bars_below += 1
            if bar_low < lowest_price:
                lowest_price = bar_low
                lowest_idx = i
        else:
            if below_start is not None and bars_below >= min_void_bars:
                recovery_idx = i
                break
            elif bar_close >= peak_price:
                if below_start is not None and bars_below >= min_void_bars:
                    recovery_idx = i
                    break
                below_start = None
                bars_below = 0
                lowest_price = peak_price
                lowest_idx = peak_idx

    if below_start is None or bars_below < min_void_bars:
        return None

    drop = peak_price - lowest_price
    drop_pct = drop / peak_price if peak_price > 0 else 0
    if drop_pct < min_drop_pct:
        return None

    void_end = recovery_idx if recovery_idx else scan_end

    return {
        "peak_idx": peak_idx,
        "peak_price": peak_price,
        "void_start": below_start,
        "void_end": void_end,
        "void_bars": bars_below,
        "lowest_price": lowest_price,
        "lowest_idx": lowest_idx,
        "drop": drop,
        "drop_pct": drop_pct,
        "recovered": recovery_idx is not None,
    }


# ── Base Cluster Detection ───────────────────────────────────────────────

def _find_base_in_void(
    data: List[OHLCV],
    void: Dict[str, Any],
    atr_val: float,
    min_base_bars: int = 5,
) -> Optional[Dict[str, Any]]:
    """
    Within a void region, anchor the base around the void low rather than
    the upper recovery shelf.

    This keeps the detected base at the bowl bottom / pullback floor instead
    of drifting upward to the pre-breakout congestion area.
    """
    v_start = void["void_start"]
    v_end = void["void_end"]
    lowest_idx = int(void["lowest_idx"])
    lowest_price = float(void["lowest_price"])
    drop = float(void["drop"])

    # Define the bowl-bottom ceiling as a fraction of the drop, with ATR floor.
    # That keeps the window near the actual pullback/base low instead of the
    # upper recovery shelf.
    bottom_zone_height = max(atr_val * 1.5, drop * 0.35)
    base_ceiling = lowest_price + bottom_zone_height

    left = lowest_idx
    above_count = 0
    i = lowest_idx
    while i >= v_start:
        bar_low = float(data[i].low)
        bar_close = float(data[i].close)
        if bar_low <= base_ceiling or bar_close <= base_ceiling:
            left = i
            above_count = 0
        else:
            above_count += 1
            if above_count >= 3:
                break
        i -= 1

    right = lowest_idx
    above_count = 0
    i = lowest_idx
    while i <= v_end and i < len(data):
        bar_low = float(data[i].low)
        bar_close = float(data[i].close)
        if bar_low <= base_ceiling or bar_close <= base_ceiling:
            right = i
            above_count = 0
        else:
            above_count += 1
            if above_count >= 3:
                break
        i += 1

    if right < left:
        return None

    base_bars = list(range(left, right + 1))
    effective_min_base_bars = min_base_bars
    if void.get("recovered"):
        effective_min_base_bars = max(4, min_base_bars - 1)
    if len(base_bars) < effective_min_base_bars:
        return None

    lows_in_base = [float(data[i].low) for i in base_bars]
    highs_in_base = [float(data[i].high) for i in base_bars]
    closes_in_base = [float(data[i].close) for i in base_bars]

    base_bottom = min(lows_in_base)
    base_top = max(highs_in_base)
    base_low_idx = base_bars[lows_in_base.index(base_bottom)]

    # Measure sideways quality: low slope = more sideways
    if len(closes_in_base) < 2:
        return None

    net_move = abs(closes_in_base[-1] - closes_in_base[0])
    total_travel = sum(abs(closes_in_base[i] - closes_in_base[i - 1])
                       for i in range(1, len(closes_in_base)))
    efficiency = net_move / max(total_travel, 1e-12)

    # Lower efficiency = more sideways (good for a base)
    sideways_score = 1.0 - min(1.0, efficiency)

    # Check that price is NOT making lower lows consistently
    post_low_bars = base_bars[-1] - base_low_idx + 1
    still_declining = post_low_bars < max(3, min_base_bars // 2)

    base_width = base_top - base_bottom
    base_width_atr = base_width / atr_val if atr_val > 0 else 0
    span_bars = base_bars[-1] - base_bars[0] + 1

    return {
        "base_top": base_top,
        "base_bottom": base_bottom,
        "base_width": base_width,
        "base_width_atr": base_width_atr,
        "base_start_idx": base_bars[0],
        "base_end_idx": base_bars[-1],
        "base_low_idx": base_low_idx,
        "base_low_price": base_bottom,
        "base_bar_count": len(base_bars),
        "span_bars": span_bars,
        "sideways_score": sideways_score,
        "efficiency": efficiency,
        "still_declining": still_declining,
        "density": len(base_bars) / max(span_bars, 1),
    }


# ── Main Detection: Peak → Void → Base ──────────────────────────────────

def _score_result(void: Dict[str, Any], base: Dict[str, Any], min_drop_pct: float = 0.08) -> float:
    void_depth_score = min(1.0, void["drop_pct"] / 0.30)
    void_width_score = min(1.0, void["void_bars"] / 40)
    void_score = void_depth_score * 0.5 + void_width_score * 0.5
    base_score = base["sideways_score"] * 0.5 + base["density"] * 0.5
    recovery_bonus = 0.15 if void["recovered"] else 0.0
    return min(1.0, void_score * 0.4 + base_score * 0.4 + recovery_bonus + 0.05)


def _relevance_metrics(
    data: List[OHLCV],
    base: Dict[str, Any],
    atr_val: float,
) -> Dict[str, float]:
    current_idx = max(0, len(data) - 1)
    current_close = float(data[current_idx].close)
    base_top = float(base["base_top"])
    base_bottom = float(base["base_bottom"])
    base_width = max(float(base["base_width"]), atr_val, 1e-9)
    base_end_idx = int(base["base_end_idx"])
    span_bars = max(1, int(base["span_bars"]))

    bars_ago = max(0, current_idx - base_end_idx)
    recency_window = max(52, min(len(data), max(span_bars * 5, len(data) // 3)))
    recency_score = _clamp01(1.0 - (bars_ago / max(recency_window, 1)))

    if current_close > base_top:
        distance_pct = (current_close - base_top) / max(current_close, 1e-9)
    elif current_close < base_bottom:
        distance_pct = (base_bottom - current_close) / max(base_bottom, 1e-9)
    else:
        distance_pct = 0.0
    price_proximity_score = _clamp01(1.0 - (distance_pct / 0.40))

    if current_close > base_top:
        extension = (current_close - base_top) / base_width
    elif current_close < base_bottom:
        extension = (base_bottom - current_close) / base_width
    else:
        extension = 0.0
    activity_score = _clamp01(1.0 - (extension / 12.0))

    relevance_score = (
        price_proximity_score * 0.45
        + activity_score * 0.30
        + recency_score * 0.25
    )

    return {
        "bars_ago": float(bars_ago),
        "recency_score": recency_score,
        "price_proximity_score": price_proximity_score,
        "activity_score": activity_score,
        "relevance_score": relevance_score,
    }


def _rank_result_for_display(
    data: List[OHLCV],
    structural_score: float,
    base: Dict[str, Any],
    atr_val: float,
) -> Dict[str, float]:
    metrics = _relevance_metrics(data, base, atr_val)
    rank_score = min(1.0, structural_score * 0.55 + metrics["relevance_score"] * 0.45)
    metrics["rank_score"] = rank_score
    return metrics


def _base_context_atr(
    data: List[OHLCV],
    base: Dict[str, Any],
    fallback_atr: float,
    length: int = 14,
) -> float:
    end = max(1, int(base["base_end_idx"]))
    span = max(length, int(base.get("span_bars", length)))
    start = max(0, end - max(span, length * 2))
    local_atr = _atr(data, start, end, length=length)
    if local_atr > 0:
        return local_atr
    return max(fallback_atr, 1e-9)


def _breakout_age_bars(
    data: List[OHLCV],
    base: Dict[str, Any],
    base_atr: float,
    forming_top_tolerance_atr: float,
) -> Optional[int]:
    threshold = float(base["base_top"]) + max(0.0, forming_top_tolerance_atr) * max(base_atr, 1e-9)
    start_idx = int(base["base_end_idx"]) + 1
    first_break_idx: Optional[int] = None
    for i in range(start_idx, len(data)):
        if float(data[i].close) > threshold:
            first_break_idx = i
            break
    if first_break_idx is None:
        return None
    return max(0, len(data) - 1 - first_break_idx)


def _compute_active_base_state(
    data: List[OHLCV],
    base: Dict[str, Any],
    recovered: bool,
    fallback_atr: float,
    cfg: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    config = cfg or {}
    forming_top_tolerance_atr = float(config.get("forming_top_tolerance_atr", 0.25))
    expanding_extension_atr = float(config.get("expanding_extension_atr", 0.75))
    failed_break_atr = float(config.get("failed_break_atr", 0.35))
    trigger_max_age_bars = int(config.get("trigger_max_age_bars", 1))

    base_top = float(base["base_top"])
    base_bottom = float(base["base_bottom"])
    current_close = float(data[-1].close)
    base_atr = _base_context_atr(data, base, fallback_atr)
    extension_atr = (current_close - base_top) / max(base_atr, 1e-9)
    downside_atr = (base_bottom - current_close) / max(base_atr, 1e-9)
    breakout_age = _breakout_age_bars(data, base, base_atr, forming_top_tolerance_atr)

    if downside_atr > failed_break_atr:
        state = "failed"
    elif extension_atr <= forming_top_tolerance_atr:
        state = "forming"
    elif extension_atr <= expanding_extension_atr and breakout_age is not None and breakout_age <= trigger_max_age_bars:
        state = "trigger"
    else:
        state = "expanding"

    return {
        "state": state,
        "base_atr": base_atr,
        "extension_atr": extension_atr,
        "downside_atr": downside_atr,
        "breakout_age_bars": breakout_age,
        "forming_top_tolerance_atr": forming_top_tolerance_atr,
        "expanding_extension_atr": expanding_extension_atr,
        "failed_break_atr": failed_break_atr,
        "trigger_max_age_bars": trigger_max_age_bars,
        "recovered": recovered,
    }


def _parse_allowed_active_states(cfg: Optional[Dict[str, Any]] = None) -> List[str]:
    raw = str((cfg or {}).get("allowed_active_base_states", "forming") or "forming")
    parts = [p.strip().lower() for p in raw.split(",")]
    allowed = [p for p in parts if p in {"forming", "trigger", "expanding", "failed"}]
    return allowed or ["forming"]


def _build_all_base_visuals(
    data: List[OHLCV],
    qualified: List[Dict[str, Any]],
    is_intraday: bool,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    overlays: List[Dict[str, Any]] = []
    hlevels: List[Dict[str, Any]] = []
    markers: List[Dict[str, Any]] = []

    for idx, result in enumerate(qualified):
        base = result["base"]
        s_idx = int(base["base_start_idx"])
        e_idx = int(base["base_end_idx"])
        low_idx = int(base.get("base_low_idx", s_idx))
        top = float(base["base_top"])
        bottom = float(base["base_bottom"])
        is_active = idx == 0
        state = str(result.get("active_base_state", "forming")).lower()

        t0 = _format_chart_time(data[s_idx].timestamp, is_intraday)
        t1 = _format_chart_time(data[e_idx].timestamp, is_intraday)
        t_low = _format_chart_time(data[low_idx].timestamp, is_intraday)
        line_style = 0 if is_active else 2
        line_width = 2 if is_active else 1
        top_color = "#ef4444" if is_active else "rgba(248, 113, 113, 0.45)"
        bottom_color = "#22c55e" if is_active else "rgba(74, 222, 128, 0.45)"

        overlays.append({
            "type": "line",
            "color": top_color,
            "lineWidth": line_width,
            "lineStyle": line_style,
            "label": "",
            "showLastValue": False,
            "points": [{"time": t0, "value": top}, {"time": t1, "value": top}],
            "data": [{"time": t0, "value": top}, {"time": t1, "value": top}],
        })
        overlays.append({
            "type": "line",
            "color": bottom_color,
            "lineWidth": line_width,
            "lineStyle": line_style,
            "label": "",
            "showLastValue": False,
            "points": [{"time": t0, "value": bottom}, {"time": t1, "value": bottom}],
            "data": [{"time": t0, "value": bottom}, {"time": t1, "value": bottom}],
        })
        if is_active:
            hlevels.append({
                "price": top,
                "color": "#ef4444",
                "lineWidth": 2,
                "lineStyle": 0,
                "label": f"Active Base Top ${top:.2f}",
                "axisLabelVisible": True,
            })
            hlevels.append({
                "price": bottom,
                "color": "#22c55e",
                "lineWidth": 2,
                "lineStyle": 0,
                "label": f"Active Base Bottom ${bottom:.2f}",
                "axisLabelVisible": True,
            })
        markers.append({
            "time": t_low,
            "position": "belowBar",
            "color": bottom_color,
            "shape": "arrowUp",
            "text": f"ACTIVE BASE ({state.upper()})" if is_active else f"B{idx + 1}",
        })

    return overlays, hlevels, markers


def _detect_bases_via_voids(
    data: List[OHLCV],
    symbol: str,
    timeframe: str,
    start: int,
    end: int,
    swing_lookback: int = 10,
    swing_lookahead: int = 10,
    rdp_epsilon_pct: float = 0.05,
    min_drop_pct: float = 0.08,
    min_void_bars: int = 8,
    min_base_bars: int = 5,
) -> List[Dict[str, Any]]:
    """
    Full pipeline: find RDP peaks → measure voids → detect base clusters.

    Key improvement over V1: after finding bases, each base is reassigned
    to the HIGHEST peak whose void contains it.  This prevents a recovery
    bounce (e.g. $13 inside a $24→$1 decline) from being labelled as the
    distribution peak when a much more significant peak exists above.
    RDP highs are the primary peak source because they track structural
    pivots more faithfully than simple local maxima.
    """
    peaks = _extract_rdp_highs(
        data,
        symbol,
        timeframe,
        start,
        end,
        epsilon_pct=rdp_epsilon_pct,
    )
    local_peaks = _find_local_swing_highs(data, start, end, swing_lookback, swing_lookahead)
    if peaks:
        supplemental = _select_recent_supplemental_peaks(
            data,
            peaks,
            local_peaks,
            end,
            min_drop_pct=min_drop_pct,
            min_void_bars=min_void_bars,
            swing_lookback=swing_lookback,
        )
        peaks = _merge_peak_maps(peaks, supplemental, min_index_gap=max(6, swing_lookback), min_price_gap_pct=0.04)
    else:
        peaks = local_peaks
    if not peaks:
        return []

    atr_val = _atr(data, start, end)

    # ── Pass 1: compute voids for ALL peaks ───────────────────────────
    peak_voids: List[Dict[str, Any]] = []
    for peak in peaks:
        void = _measure_void(
            data, peak["idx"], peak["price"], end,
            min_drop_pct=min_drop_pct,
            min_void_bars=min_void_bars,
        )
        if void:
            peak_voids.append({"peak": peak, "void": void})

    if not peak_voids:
        return []

    # ── Pass 2: find bases within each void ───────────────────────────
    raw_results = []
    for pv in peak_voids:
        base = _find_base_in_void(
            data, pv["void"], atr_val,
            min_base_bars=min_base_bars,
        )
        if not base:
            continue
        if base["still_declining"]:
            continue
        raw_results.append({
            "peak": pv["peak"],
            "void": pv["void"],
            "base": base,
            "atr": atr_val,
        })

    # ── Pass 3: conditional peak reassignment ───────────────────────
    #    Only reassign when the original peak is barely above the base
    #    top (<20% above).  That means it's not a real distribution —
    #    just a boundary of the base itself — and a higher peak is the
    #    true distribution.
    #    If the peak is well above the base top (>=20%), it's a real
    #    distribution peak in its own right — keep it.
    #    EVCM: peak $13.47 vs base top $12.36 → 9% above → reassign ✓
    #    RKT:  peak $20    vs base top $15.54 → 29% above → keep    ✓
    REASSIGN_THRESHOLD = 1.20
    for r in raw_results:
        orig_peak_price = r["peak"]["price"]
        base_top = r["base"]["base_top"]
        if orig_peak_price >= base_top * REASSIGN_THRESHOLD:
            continue  # real distribution peak — keep it

        b_start = r["base"]["base_start_idx"]
        b_end = r["base"]["base_end_idx"]
        best_peak = r["peak"]
        best_void = r["void"]

        for pv in peak_voids:
            if pv["peak"]["price"] <= best_peak["price"]:
                continue
            v = pv["void"]
            if v["void_start"] <= b_start and v["void_end"] >= b_end:
                best_peak = pv["peak"]
                best_void = pv["void"]

        r["peak"] = best_peak
        r["void"] = best_void

    # ── Pass 4: rescore with correct peak/void attribution ────────────
    results = []
    for r in raw_results:
        structural_score = _score_result(r["void"], r["base"])
        rank_metrics = _rank_result_for_display(data, structural_score, r["base"], r["atr"])
        r["structural_score"] = structural_score
        r["score"] = rank_metrics["rank_score"]
        r["rank_score"] = rank_metrics["rank_score"]
        r["relevance_score"] = rank_metrics["relevance_score"]
        r["recency_score"] = rank_metrics["recency_score"]
        r["price_proximity_score"] = rank_metrics["price_proximity_score"]
        r["activity_score"] = rank_metrics["activity_score"]
        r["bars_ago"] = int(rank_metrics["bars_ago"])
        results.append(r)

    # ── Deduplicate: reject near-identical bases but ALLOW nested ones ─
    results.sort(key=lambda r: (r["rank_score"], r["structural_score"]), reverse=True)
    kept = []
    for r in results:
        is_duplicate = False
        r_start = r["base"]["base_start_idx"]
        r_end = r["base"]["base_end_idx"]
        r_span = r_end - r_start + 1
        for k in kept:
            k_start = k["base"]["base_start_idx"]
            k_end = k["base"]["base_end_idx"]
            k_span = k_end - k_start + 1
            overlap_start = max(r_start, k_start)
            overlap_end = min(r_end, k_end)
            if overlap_end < overlap_start:
                continue
            overlap_bars = overlap_end - overlap_start + 1
            smaller_span = min(r_span, k_span)
            containment = overlap_bars / max(smaller_span, 1)
            span_ratio = smaller_span / max(max(r_span, k_span), 1)
            if containment > 0.9 and span_ratio < 0.7:
                continue  # nested — keep both
            if overlap_bars / max(r_span, 1) > 0.5:
                is_duplicate = True
                break
        if not is_duplicate:
            kept.append(r)

    kept.sort(key=lambda r: (r["rank_score"], r["structural_score"]), reverse=True)
    return kept


# ── Plugin Entry Point ────────────────────────────────────────────────────

def run_density_base_detector_v2_pattern_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Any:
    cfg = spec.get("setup_config", {}) if isinstance(spec, dict) else {}
    min_data = int(cfg.get("min_data_bars", 60))
    if len(data) < min_data:
        return []

    swing_lookback = int(cfg.get("swing_lookback", 10))
    swing_lookahead = int(cfg.get("swing_lookahead", 10))
    rdp_epsilon_pct = float(cfg.get("rdp_epsilon_pct", 0.05))
    min_drop_pct = float(cfg.get("min_drop_pct", 0.08))
    min_void_bars = int(cfg.get("min_void_bars", 8))
    min_base_bars = int(cfg.get("min_base_bars", 5))
    min_score = float(cfg.get("min_score", 0.25))
    max_bases = int(cfg.get("max_bases", 10))
    allowed_active_states = _parse_allowed_active_states(cfg)

    n = len(data)
    max_scan = int(cfg.get("max_scan_bars", 0))
    start = max(0, n - max_scan) if max_scan > 0 else 0
    end = n - 1

    all_bases = _detect_bases_via_voids(
        data, symbol, timeframe, start, end,
        swing_lookback=swing_lookback,
        swing_lookahead=swing_lookahead,
        rdp_epsilon_pct=rdp_epsilon_pct,
        min_drop_pct=min_drop_pct,
        min_void_bars=min_void_bars,
        min_base_bars=min_base_bars,
    )

    for base_result in all_bases:
        state_metrics = _compute_active_base_state(
            data,
            base_result["base"],
            bool(base_result["void"].get("recovered")),
            float(base_result.get("atr", 0.0) or 0.0),
            cfg,
        )
        base_result["active_base_state"] = state_metrics["state"]
        base_result["active_base_atr"] = state_metrics["base_atr"]
        base_result["active_base_extension_atr"] = state_metrics["extension_atr"]
        base_result["active_base_downside_atr"] = state_metrics["downside_atr"]
        base_result["active_base_breakout_age_bars"] = state_metrics["breakout_age_bars"]
        base_result["active_base_state_metrics"] = state_metrics

    if mode == "signal":
        return {
            int(b["base"]["base_end_idx"])
            for b in all_bases
            if b.get("structural_score", b["score"]) >= min_score
            and str(b.get("active_base_state", "forming")) in allowed_active_states
        }

    qualified = [
        b for b in all_bases
        if b.get("structural_score", b["score"]) >= min_score
        and str(b.get("active_base_state", "forming")) in allowed_active_states
    ][:max_bases]

    # Tag scale: label each base as "macro", "standard", or "micro" by span
    for q in qualified:
        span = q["base"]["span_bars"]
        if span >= 200:
            q["scale"] = "macro"
        elif span >= 50:
            q["scale"] = "standard"
        else:
            q["scale"] = "micro"
    if not qualified:
        return []

    spec_hash_val = _spec_hash(spec if isinstance(spec, dict) else {})
    strategy_version = (
        spec.get("strategy_version_id", "density_base_detector_v2_pattern_v1")
        if isinstance(spec, dict)
        else "density_base_detector_v2_pattern_v1"
    )
    is_intraday = _detect_intraday(data)
    chart = _chart_data(data)
    all_base_overlays, all_base_hlevels, all_base_markers = _build_all_base_visuals(data, qualified, is_intraday)

    candidates = []
    for rank, result in enumerate(qualified):
        base = result["base"]
        void = result["void"]
        peak = result["peak"]
        score = result["score"]
        structural_score = result.get("structural_score", score)
        atr_val = result["atr"]
        scale = result.get("scale", "standard")
        base_state = str(result.get("active_base_state", "forming"))
        is_active_base = rank == 0

        s_idx = int(base["base_start_idx"])
        e_idx = int(base["base_end_idx"])
        top = float(base["base_top"])
        bottom = float(base["base_bottom"])
        peak_price = float(peak["price"])

        t0 = _format_chart_time(data[s_idx].timestamp, is_intraday)
        t1 = _format_chart_time(data[e_idx].timestamp, is_intraday)
        t_peak = _format_chart_time(data[peak["idx"]].timestamp, is_intraday)

        overlays = [
            {
                "type": "line", "color": "#6b7280", "lineWidth": 1, "lineStyle": 2,
                "label": f"Peak ${peak_price:.2f}",
                "points": [{"time": t_peak, "value": peak_price}, {"time": t1, "value": peak_price}],
                "data": [{"time": t_peak, "value": peak_price}, {"time": t1, "value": peak_price}],
            },
        ]

        scale_label = f"[{scale.upper()}] " if scale != "standard" else ""
        markers = list(all_base_markers)
        markers.append(
            {
                "time": t_peak,
                "position": "aboveBar",
                "color": "#ef4444",
                "shape": "arrowDown",
                "text": f"{scale_label}Peak",
            }
        )
        if void["recovered"]:
            t_recovery = _format_chart_time(data[void["void_end"]].timestamp, is_intraday)
            markers.append({
                "time": t_recovery,
                "position": "belowBar",
                "color": "#22c55e",
                "shape": "arrowUp",
                "text": "Recovery",
            })

        candidate_id = (
            f"{symbol}_{timeframe}_scan_{strategy_version}_{spec_hash_val[:8]}"
            f"_{rank}_{s_idx}_{e_idx}"
        )

        drop_pct_str = f"{void['drop_pct'] * 100:.1f}%"
        node_reason = (
            f"[{scale}] Void base: peak ${peak_price:.2f} → {drop_pct_str} drop, "
            f"base ${bottom:.2f}-${top:.2f} ({base['span_bars']} bars), "
            f"sideways={base['sideways_score']:.2f}, "
            f"{'recovered' if void['recovered'] else 'open'}, "
            f"rank={score:.2f} structural={structural_score:.2f}"
        )

        candidate = {
            "candidate_id": candidate_id,
            "id": candidate_id,
            "strategy_version_id": strategy_version,
            "pattern_type": "density_base_detector_v2_pattern",
            "spec_hash": spec_hash_val,
            "symbol": symbol,
            "timeframe": timeframe,
            "score": score,
            "entry_ready": True,
            "rule_checklist": [
                {
                    "rule_name": "base_detected",
                    "passed": True,
                    "value": round(structural_score, 4),
                    "threshold": f">= {min_score:.2f}",
                },
                {
                    "rule_name": "base_qualified",
                    "passed": structural_score >= min_score,
                    "value": round(structural_score, 4),
                    "threshold": f">= {min_score:.2f}",
                },
                {
                    "rule_name": "void_depth",
                    "passed": void["drop_pct"] >= min_drop_pct,
                    "value": round(void["drop_pct"], 4),
                    "threshold": f">= {min_drop_pct:.0%}",
                },
            ],
            "anchors": {
                "base_top": round(top, 4),
                "base_bottom": round(bottom, 4),
                "base_start_idx": s_idx,
                "base_end_idx": e_idx,
                "base_low_idx": int(base.get("base_low_idx", s_idx)),
                "base_low_price": round(float(base.get("base_low_price", bottom)), 4),
                "peak_price": round(peak_price, 4),
                "peak_idx": peak["idx"],
                "peak_source": peak.get("source", "unknown"),
                "drop_pct": round(void["drop_pct"], 4),
                "void_bars": void["void_bars"],
                "recovered": void["recovered"],
                "atr": round(atr_val, 4),
                "scale": scale,
                "base_state": base_state,
                "is_active_base": is_active_base,
                "active_base_atr": round(float(result.get("active_base_atr", 0.0)), 4),
                "active_base_extension_atr": round(float(result.get("active_base_extension_atr", 0.0)), 4),
                "active_base_downside_atr": round(float(result.get("active_base_downside_atr", 0.0)), 4),
                "active_base_breakout_age_bars": result.get("active_base_breakout_age_bars"),
                "structural_score": round(structural_score, 4),
                "rank_score": round(score, 4),
                "relevance_score": round(result.get("relevance_score", 0.0), 4),
                "recency_score": round(result.get("recency_score", 0.0), 4),
                "price_proximity_score": round(result.get("price_proximity_score", 0.0), 4),
                "activity_score": round(result.get("activity_score", 0.0), 4),
                "bars_ago": int(result.get("bars_ago", 0)),
            },
            "window_start": s_idx,
            "window_end": e_idx,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "chart_data": chart,
            "chart_base_start": s_idx,
            "chart_base_end": e_idx,
            "base": {
                "high": top,
                "low": bottom,
                "start": s_idx,
                "end": e_idx,
                "start_date": data[s_idx].timestamp[:10] if s_idx < len(data) else None,
                "end_date": data[e_idx].timestamp[:10] if e_idx < len(data) else None,
                "duration": base["span_bars"],
            },
            "visual": {
                "markers": markers,
                "overlay_series": overlays + list(all_base_overlays),
                "hlevels": list(all_base_hlevels),
            },
            "node_result": {
                "passed": True,
                "score": score,
                "features": {
                    "structural_score": float(structural_score),
                    "rank_score": float(score),
                    "relevance_score": float(result.get("relevance_score", 0.0)),
                    "recency_score": float(result.get("recency_score", 0.0)),
                    "price_proximity_score": float(result.get("price_proximity_score", 0.0)),
                    "activity_score": float(result.get("activity_score", 0.0)),
                    "bars_ago": int(result.get("bars_ago", 0)),
                    "void_drop_pct": float(void["drop_pct"]),
                    "void_bars": int(void["void_bars"]),
                    "void_recovered": void["recovered"],
                    "base_width_atr": float(base["base_width_atr"]),
                    "base_sideways_score": float(base["sideways_score"]),
                    "base_density": float(base["density"]),
                    "base_bar_count": int(base["base_bar_count"]),
                    "base_span_bars": int(base["span_bars"]),
                    "base_low_idx": int(base.get("base_low_idx", s_idx)),
                    "base_low_price": float(base.get("base_low_price", bottom)),
                    "base_state": base_state,
                    "is_active_base": is_active_base,
                    "active_base_atr": float(result.get("active_base_atr", 0.0)),
                    "active_base_extension_atr": float(result.get("active_base_extension_atr", 0.0)),
                    "active_base_downside_atr": float(result.get("active_base_downside_atr", 0.0)),
                    "active_base_breakout_age_bars": result.get("active_base_breakout_age_bars"),
                    "peak_price": float(peak_price),
                    "peak_source_rdp": peak.get("source", "unknown") == "rdp",
                },
                "anchors": {
                    "base_top": top,
                    "base_bottom": bottom,
                    "base_start_idx": s_idx,
                    "base_end_idx": e_idx,
                    "base_low_idx": int(base.get("base_low_idx", s_idx)),
                    "peak_idx": peak["idx"],
                },
                "reason": node_reason,
            },
            "output_ports": {
                "signal": {
                    "passed": True,
                    "score": score,
                    "reason": node_reason,
                },
                "base_boxes": {
                    "count": len(qualified),
                    "rank": rank,
                    "best": {
                        "base_start_idx": s_idx,
                        "base_end_idx": e_idx,
                        "base_span_bars": base["span_bars"],
                        "ceiling": round(top, 4),
                        "floor": round(bottom, 4),
                        "base_low_idx": int(base.get("base_low_idx", s_idx)),
                        "width_atr": round(base["base_width_atr"], 4),
                        "density": round(base["density"], 4),
                        "sideways_score": round(base["sideways_score"], 4),
                        "quality": round(structural_score, 4),
                        "rank_score": round(score, 4),
                        "active_state": base_state,
                        "active_base_extension_atr": round(float(result.get("active_base_extension_atr", 0.0)), 4),
                    },
                },
            },
        }

        candidates.append(candidate)

    return candidates
