#!/usr/bin/env python3
"""
Density Base Detector V1 (Pattern) — Void Detection
=====================================================
Detects bases by finding "voids" — empty regions in the price-time plane
where price dropped away from a prior peak and hasn't returned yet.

Algorithm:
1. Find swing highs (peaks) in the price data
2. For each peak, scan forward to measure the void — bars where price
   stays below the peak level
3. At the bottom of the void, find where price clusters sideways — that's
   the base
4. Score by void significance (depth × width) and base quality

This mimics how a human eye spots bases: you see the empty space first
(the gap between distribution and markup), then the base falls out as
whatever sits at the bottom of that space.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time


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


# ── Swing High Detection ─────────────────────────────────────────────────

def _find_swing_highs(
    data: List[OHLCV],
    start: int,
    end: int,
    lookback: int = 10,
    lookahead: int = 10,
) -> List[Dict[str, Any]]:
    """Find swing highs (peaks) where price is the highest in a window."""
    peaks = []
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
            peaks.append({"idx": i, "price": high_i})

    # Deduplicate peaks that are very close — keep the higher one
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
    price_bin_atr_frac: float = 0.25,
) -> Optional[Dict[str, Any]]:
    """
    Within a void region, find where price clusters sideways — that's the base.

    Uses a price histogram within the void to find the densest band,
    then expands the band to capture the full range of sideways action.
    """
    v_start = void["void_start"]
    v_end = void["void_end"]
    bars = []
    for i in range(v_start, v_end + 1):
        if i >= len(data):
            break
        bars.append((i, float(data[i].high), float(data[i].low), float(data[i].close)))

    if len(bars) < min_base_bars:
        return None

    all_closes = [b[3] for b in bars]
    all_lows = [b[2] for b in bars]
    all_highs = [b[1] for b in bars]
    p_min = min(all_lows)
    p_max = max(all_highs)
    p_range = p_max - p_min
    if p_range <= 0:
        return None

    bin_size = max(atr_val * price_bin_atr_frac, p_range / 100)
    num_bins = max(5, int(math.ceil(p_range / bin_size)))
    bin_size = p_range / num_bins

    bins = [0] * num_bins
    for _, h, lo, c in bars:
        for price in [c, h, lo]:
            b_idx = min(num_bins - 1, int((price - p_min) / bin_size))
            bins[b_idx] += 1

    # Find the densest contiguous band (at least 2 bins wide)
    best_score = 0
    best_start_bin = 0
    best_end_bin = 0
    for width in range(2, min(num_bins + 1, max(3, num_bins // 2 + 1))):
        for s in range(num_bins - width + 1):
            score = sum(bins[s:s + width])
            if score > best_score:
                best_score = score
                best_start_bin = s
                best_end_bin = s + width - 1

    base_bottom = p_min + best_start_bin * bin_size
    base_top = p_min + (best_end_bin + 1) * bin_size

    # Find which bars actually trade within this band
    base_bars = []
    for idx, h, lo, c in bars:
        if lo <= base_top and h >= base_bottom:
            base_bars.append(idx)

    if len(base_bars) < min_base_bars:
        return None

    # Measure sideways quality: low slope = more sideways
    closes_in_base = [float(data[i].close) for i in base_bars]
    if len(closes_in_base) < 2:
        return None

    net_move = abs(closes_in_base[-1] - closes_in_base[0])
    total_travel = sum(abs(closes_in_base[i] - closes_in_base[i - 1])
                       for i in range(1, len(closes_in_base)))
    efficiency = net_move / max(total_travel, 1e-12)

    # Lower efficiency = more sideways (good for a base)
    sideways_score = 1.0 - min(1.0, efficiency)

    # Check that price is NOT making lower lows consistently
    mid_point = len(closes_in_base) // 2
    if mid_point > 0:
        first_half_low = min(closes_in_base[:mid_point])
        second_half_low = min(closes_in_base[mid_point:])
        still_declining = second_half_low < first_half_low * 0.97
    else:
        still_declining = False

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
        "base_bar_count": len(base_bars),
        "span_bars": span_bars,
        "sideways_score": sideways_score,
        "efficiency": efficiency,
        "still_declining": still_declining,
        "density": len(base_bars) / max(span_bars, 1),
    }


# ── Main Detection: Peak → Void → Base ──────────────────────────────────

def _detect_bases_via_voids(
    data: List[OHLCV],
    start: int,
    end: int,
    swing_lookback: int = 10,
    swing_lookahead: int = 10,
    min_drop_pct: float = 0.08,
    min_void_bars: int = 8,
    min_base_bars: int = 5,
) -> List[Dict[str, Any]]:
    """
    Full pipeline: find peaks → measure voids → detect base clusters.
    Returns a list of detected bases sorted by score.
    """
    peaks = _find_swing_highs(data, start, end, swing_lookback, swing_lookahead)
    if not peaks:
        return []

    atr_val = _atr(data, start, end)
    results = []

    for peak in peaks:
        void = _measure_void(
            data, peak["idx"], peak["price"], end,
            min_drop_pct=min_drop_pct,
            min_void_bars=min_void_bars,
        )
        if not void:
            continue

        base = _find_base_in_void(
            data, void, atr_val,
            min_base_bars=min_base_bars,
        )
        if not base:
            continue

        if base["still_declining"]:
            continue

        # Score the base: combination of void significance and base quality
        void_depth_score = min(1.0, void["drop_pct"] / 0.30)
        void_width_score = min(1.0, void["void_bars"] / 40)
        void_score = void_depth_score * 0.5 + void_width_score * 0.5

        base_score = base["sideways_score"] * 0.5 + base["density"] * 0.5
        recovery_bonus = 0.15 if void["recovered"] else 0.0

        total_score = void_score * 0.4 + base_score * 0.4 + recovery_bonus + 0.05

        results.append({
            "score": min(1.0, total_score),
            "peak": peak,
            "void": void,
            "base": base,
            "atr": atr_val,
        })

    # Deduplicate overlapping bases: if two bases overlap >50%, keep the higher-scored one
    results.sort(key=lambda r: r["score"], reverse=True)
    kept = []
    for r in results:
        overlap = False
        r_start = r["base"]["base_start_idx"]
        r_end = r["base"]["base_end_idx"]
        r_span = r_end - r_start + 1
        for k in kept:
            k_start = k["base"]["base_start_idx"]
            k_end = k["base"]["base_end_idx"]
            overlap_start = max(r_start, k_start)
            overlap_end = min(r_end, k_end)
            if overlap_end >= overlap_start:
                overlap_bars = overlap_end - overlap_start + 1
                if overlap_bars / max(r_span, 1) > 0.5:
                    overlap = True
                    break
        if not overlap:
            kept.append(r)

    return kept


# ── Plugin Entry Point ────────────────────────────────────────────────────

def run_density_base_detector_v1_pattern_plugin(
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
    min_drop_pct = float(cfg.get("min_drop_pct", 0.08))
    min_void_bars = int(cfg.get("min_void_bars", 8))
    min_base_bars = int(cfg.get("min_base_bars", 5))
    min_score = float(cfg.get("min_score", 0.25))
    max_bases = int(cfg.get("max_bases", 5))

    n = len(data)
    start = max(0, n - int(cfg.get("max_scan_bars", 800)))
    end = n - 1

    all_bases = _detect_bases_via_voids(
        data, start, end,
        swing_lookback=swing_lookback,
        swing_lookahead=swing_lookahead,
        min_drop_pct=min_drop_pct,
        min_void_bars=min_void_bars,
        min_base_bars=min_base_bars,
    )

    if mode == "signal":
        return {int(b["base"]["base_end_idx"]) for b in all_bases if b["score"] >= min_score}

    qualified = [b for b in all_bases if b["score"] >= min_score][:max_bases]
    if not qualified:
        return []

    spec_hash_val = _spec_hash(spec if isinstance(spec, dict) else {})
    strategy_version = (
        spec.get("strategy_version_id", "density_base_detector_v1_pattern_v1")
        if isinstance(spec, dict)
        else "density_base_detector_v1_pattern_v1"
    )
    is_intraday = _detect_intraday(data)
    chart = _chart_data(data)

    candidates = []
    for rank, result in enumerate(qualified):
        base = result["base"]
        void = result["void"]
        peak = result["peak"]
        score = result["score"]
        atr_val = result["atr"]

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

        markers = [
            {
                "time": t_peak,
                "position": "aboveBar",
                "color": "#ef4444",
                "shape": "arrowDown",
                "text": "Peak",
            },
        ]
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
            f"Void base: peak ${peak_price:.2f} → {drop_pct_str} drop, "
            f"base ${bottom:.2f}-${top:.2f} ({base['span_bars']} bars), "
            f"sideways={base['sideways_score']:.2f}, "
            f"{'recovered' if void['recovered'] else 'open'}"
        )

        candidate = {
            "candidate_id": candidate_id,
            "id": candidate_id,
            "strategy_version_id": strategy_version,
            "pattern_type": "density_base_detector_v1_pattern",
            "spec_hash": spec_hash_val,
            "symbol": symbol,
            "timeframe": timeframe,
            "score": score,
            "entry_ready": True,
            "rule_checklist": [
                {
                    "rule_name": "base_detected",
                    "passed": True,
                    "value": round(score, 4),
                    "threshold": f">= {min_score:.2f}",
                },
                {
                    "rule_name": "base_qualified",
                    "passed": score >= min_score,
                    "value": round(score, 4),
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
                "peak_price": round(peak_price, 4),
                "peak_idx": peak["idx"],
                "drop_pct": round(void["drop_pct"], 4),
                "void_bars": void["void_bars"],
                "recovered": void["recovered"],
                "atr": round(atr_val, 4),
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
                "overlay_series": overlays,
            },
            "node_result": {
                "passed": True,
                "score": score,
                "features": {
                    "void_drop_pct": float(void["drop_pct"]),
                    "void_bars": int(void["void_bars"]),
                    "void_recovered": void["recovered"],
                    "base_width_atr": float(base["base_width_atr"]),
                    "base_sideways_score": float(base["sideways_score"]),
                    "base_density": float(base["density"]),
                    "base_bar_count": int(base["base_bar_count"]),
                    "base_span_bars": int(base["span_bars"]),
                    "peak_price": float(peak_price),
                },
                "anchors": {
                    "base_top": top,
                    "base_bottom": bottom,
                    "base_start_idx": s_idx,
                    "base_end_idx": e_idx,
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
                        "width_atr": round(base["base_width_atr"], 4),
                        "density": round(base["density"], 4),
                        "sideways_score": round(base["sideways_score"], 4),
                        "quality": round(score, 4),
                    },
                },
            },
        }

        candidates.append(candidate)

    return candidates
