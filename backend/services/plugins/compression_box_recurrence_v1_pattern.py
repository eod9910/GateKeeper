#!/usr/bin/env python3
"""
Compression Box Recurrence V1 (Pattern)
======================================
Pattern scanner method for visual base/compression review.

Design goals:
- Mark a visually reviewable base box (top + bottom only).
- Keep chart annotations simple: RDP H/L markers + box lines.
- Use dimensionless compression features (ATR-normalized width, ER, slope, recurrence).
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any, Dict, List, Sequence

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp


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


def _clamp01(v: float) -> float:
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return float(v)


def _parse_lookbacks(raw: Any, fallback: str = "40,60,90,120,180") -> List[int]:
    text = str(raw if raw is not None else fallback)
    out: List[int] = []
    for part in text.split(","):
        p = part.strip()
        if not p:
            continue
        try:
            n = int(float(p))
            if n > 0:
                out.append(n)
        except Exception:
            continue
    if not out:
        out = [60]
    return sorted(set(out))


def _quantile(values: Sequence[float], q: float) -> float:
    vals = sorted(float(v) for v in values)
    if not vals:
        return 0.0
    if len(vals) == 1:
        return vals[0]
    q = max(0.0, min(1.0, float(q)))
    pos = q * (len(vals) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(vals) - 1)
    frac = pos - lo
    return vals[lo] * (1.0 - frac) + vals[hi] * frac


def _mean(values: Sequence[float]) -> float:
    vals = [float(v) for v in values]
    if not vals:
        return 0.0
    return sum(vals) / float(len(vals))


def _atr_mean(data: List[OHLCV], start: int, end: int) -> float:
    trs: List[float] = []
    prev_close = float(data[start].close) if start < len(data) else 0.0
    for i in range(start, end + 1):
        h = float(data[i].high)
        l = float(data[i].low)
        tr = max(h - l, abs(h - prev_close), abs(l - prev_close))
        trs.append(max(tr, 0.0))
        prev_close = float(data[i].close)
    return max(_mean(trs), 1e-9)


def _efficiency_ratio(closes: Sequence[float]) -> float:
    if len(closes) < 2:
        return 1.0
    net = abs(float(closes[-1]) - float(closes[0]))
    travel = 0.0
    for i in range(1, len(closes)):
        travel += abs(float(closes[i]) - float(closes[i - 1]))
    if travel <= 1e-12:
        return 0.0
    return _clamp01(net / travel)


def _slope_per_bar(values: Sequence[float]) -> float:
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
    return ((n * sum_xy) - (sum_x * sum_y)) / denom


def _recurrence_proxy(closes: Sequence[float], atr: float, eps_atr: float) -> float:
    if len(closes) < 3:
        return 0.0
    bin_size = max(atr * max(eps_atr, 1e-4), 1e-6)
    buckets: Dict[int, int] = {}
    for c in closes:
        k = int(math.floor(float(c) / bin_size))
        buckets[k] = buckets.get(k, 0) + 1
    peak = max(buckets.values()) if buckets else 0
    return _clamp01(peak / max(1, len(closes)))


def _extract_rdp_pivots(data: List[OHLCV], symbol: str, timeframe: str, epsilon_pct: float) -> Dict[str, List[Dict[str, Any]]]:
    swings = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    all_pts: List[Dict[str, Any]] = []
    highs: List[Dict[str, Any]] = []
    lows: List[Dict[str, Any]] = []
    for sp in getattr(swings, "swing_points", []) or []:
        idx = int(getattr(sp, "index", -1))
        if idx < 0 or idx >= len(data):
            continue
        t = str(getattr(sp, "point_type", "")).upper()
        if t not in ("HIGH", "LOW"):
            continue
        fallback = float(data[idx].high if t == "HIGH" else data[idx].low)
        price = float(getattr(sp, "price", fallback))
        row = {"index": idx, "type": t, "price": price}
        all_pts.append(row)
        if t == "HIGH":
            highs.append(row)
        else:
            lows.append(row)
    all_pts.sort(key=lambda r: int(r["index"]))
    highs.sort(key=lambda r: int(r["index"]))
    lows.sort(key=lambda r: int(r["index"]))
    return {"all": all_pts, "highs": highs, "lows": lows}


def _build_markers(best: Dict[str, Any], pivots_window: List[Dict[str, Any]], data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    markers: List[Dict[str, Any]] = []
    max_markers = int(best.get("max_markers", 40))
    for p in pivots_window[:max_markers]:
        idx = int(p["index"])
        ptype = str(p["type"]).upper()
        price = float(p["price"])
        if idx < 0 or idx >= len(data):
            continue
        markers.append(
            {
                "time": _format_chart_time(data[idx].timestamp, is_intraday),
                "position": "aboveBar" if ptype == "HIGH" else "belowBar",
                "color": "#f59e0b" if ptype == "HIGH" else "#10b981",
                "shape": "circle",
                "text": f"{'H' if ptype == 'HIGH' else 'L'} {price:.2f}",
            }
        )
    return markers


def _build_overlays(best: Dict[str, Any], data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    s = int(best["base_start_idx"])
    e = int(best["base_end_idx"])
    t0 = _format_chart_time(data[s].timestamp, is_intraday)
    t1 = _format_chart_time(data[e].timestamp, is_intraday)
    top = float(best["ceiling"])
    bottom = float(best["floor"])
    top_pts = [{"time": t0, "value": top}, {"time": t1, "value": top}]
    bot_pts = [{"time": t0, "value": bottom}, {"time": t1, "value": bottom}]
    return [
        {
            "type": "line",
            "color": "#ef4444",
            "lineWidth": 2,
            "lineStyle": 0,
            "label": f"Base Top {top:.2f}",
            "points": top_pts,
            "data": top_pts,
        },
        {
            "type": "line",
            "color": "#22c55e",
            "lineWidth": 2,
            "lineStyle": 0,
            "label": f"Base Bottom {bottom:.2f}",
            "points": bot_pts,
            "data": bot_pts,
        },
    ]


def run_compression_box_recurrence_v1_pattern_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Any:
    cfg = spec.get("setup_config", {}) if isinstance(spec, dict) else {}

    if len(data) < int(cfg.get("min_data_bars", 90)):
        return []

    lookbacks = _parse_lookbacks(cfg.get("base_lookbacks", "40,60,90,120,180"))
    epsilon_pct = float(cfg.get("epsilon_pct", 0.05))
    max_scan_bars = int(cfg.get("max_scan_bars", 500))
    min_base_bars = int(cfg.get("min_base_bars", 30))
    min_top_touches = int(cfg.get("min_top_touches", 2))
    min_bottom_touches = int(cfg.get("min_bottom_touches", 2))
    min_pivot_switches = int(cfg.get("min_pivot_switches", 2))
    max_width_atr = float(cfg.get("max_width_atr", 12.0))
    max_er = float(cfg.get("max_efficiency_ratio", 0.40))
    max_slope_atr_per_bar = float(cfg.get("max_slope_atr_per_bar", 0.30))
    min_recurrence = float(cfg.get("min_recurrence", 0.26))
    recurrence_eps_atr = float(cfg.get("recurrence_eps_atr", 0.40))
    min_final_score = float(cfg.get("min_final_score", 0.58))
    top_q = float(cfg.get("top_quantile", 0.85))
    bot_q = float(cfg.get("bottom_quantile", 0.15))
    top_tolerance_pct = float(cfg.get("top_tolerance_pct", 0.08))
    bottom_tolerance_pct = float(cfg.get("bottom_tolerance_pct", 0.08))
    max_markers = int(cfg.get("max_markers", 40))

    pivots = _extract_rdp_pivots(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    all_pivots = pivots.get("all", [])

    n = len(data)
    latest_start = max(0, n - max_scan_bars)
    setups: List[Dict[str, Any]] = []

    for lb in lookbacks:
        if lb < min_base_bars or lb > n:
            continue
        for end in range(max(lb - 1, latest_start + lb - 1), n):
            start = end - lb + 1
            if start < 0:
                continue

            window_bars = data[start : end + 1]
            highs = [float(b.high) for b in window_bars]
            lows = [float(b.low) for b in window_bars]
            closes = [float(b.close) for b in window_bars]
            atr = _atr_mean(data, start, end)

            ceiling = _quantile(highs, top_q)
            floor = _quantile(lows, bot_q)
            if ceiling <= floor:
                continue

            width_atr = (ceiling - floor) / max(atr, 1e-9)
            er = _efficiency_ratio(closes)
            slope_atr_per_bar = abs(_slope_per_bar(closes)) / max(atr, 1e-9)
            recurrence = _recurrence_proxy(closes, atr, recurrence_eps_atr)

            pivots_window = [p for p in all_pivots if start <= int(p["index"]) <= end]
            highs_window = [p for p in pivots_window if p["type"] == "HIGH"]
            lows_window = [p for p in pivots_window if p["type"] == "LOW"]
            top_cut = ceiling * (1.0 - top_tolerance_pct)
            bot_cut = floor * (1.0 + bottom_tolerance_pct)
            top_hits = [p for p in highs_window if float(p["price"]) >= top_cut]
            bottom_hits = [p for p in lows_window if float(p["price"]) <= bot_cut]

            switches = 0
            seq = [str(p["type"]) for p in pivots_window]
            for i in range(1, len(seq)):
                if seq[i] != seq[i - 1]:
                    switches += 1

            width_score = _clamp01((max_width_atr - width_atr) / max(max_width_atr, 1e-9))
            er_score = _clamp01((max_er - er) / max(max_er, 1e-9))
            slope_score = _clamp01((max_slope_atr_per_bar - slope_atr_per_bar) / max(max_slope_atr_per_bar, 1e-9))
            recurrence_score = _clamp01((recurrence - min_recurrence) / max(1.0 - min_recurrence, 1e-9))
            touch_score = min(
                1.0,
                0.5 * (len(top_hits) / max(1, min_top_touches))
                + 0.5 * (len(bottom_hits) / max(1, min_bottom_touches)),
            )
            switch_score = min(1.0, switches / max(1, min_pivot_switches))
            recency_score = _clamp01(1.0 - ((n - 1 - end) / max(1, max_scan_bars)))

            final_score = _clamp01(
                0.25 * width_score
                + 0.20 * er_score
                + 0.16 * slope_score
                + 0.19 * recurrence_score
                + 0.10 * touch_score
                + 0.05 * switch_score
                + 0.05 * recency_score
            )

            passed = (
                width_atr <= max_width_atr
                and er <= max_er
                and slope_atr_per_bar <= max_slope_atr_per_bar
                and recurrence >= min_recurrence
                and len(top_hits) >= min_top_touches
                and len(bottom_hits) >= min_bottom_touches
                and switches >= min_pivot_switches
                and final_score >= min_final_score
            )
            if not passed:
                continue

            setups.append(
                {
                    "base_start_idx": start,
                    "base_end_idx": end,
                    "base_span_bars": lb,
                    "ceiling": ceiling,
                    "floor": floor,
                    "width_atr": width_atr,
                    "efficiency_ratio": er,
                    "slope_atr_per_bar": slope_atr_per_bar,
                    "recurrence": recurrence,
                    "touches_top": len(top_hits),
                    "touches_bottom": len(bottom_hits),
                    "pivot_switches": switches,
                    "pivot_count": len(pivots_window),
                    "score": final_score,
                    "pivots_window": pivots_window,
                    "max_markers": max_markers,
                }
            )

    if mode == "signal":
        return {int(s["base_end_idx"]) for s in setups}

    setups.sort(key=lambda s: (float(s["score"]), int(s["base_end_idx"])), reverse=True)
    found = len(setups) > 0
    if not found:
        return []

    best = setups[0]
    is_intraday = _detect_intraday(data)
    markers = _build_markers(best, best.get("pivots_window", []), data, is_intraday)
    overlays = _build_overlays(best, data, is_intraday)

    spec_hash = _spec_hash(spec if isinstance(spec, dict) else {})
    strategy_version = (
        spec.get("strategy_version_id", "compression_box_recurrence_v1_pattern_v1")
        if isinstance(spec, dict)
        else "compression_box_recurrence_v1_pattern_v1"
    )
    candidate_id = f"{symbol}_{timeframe}_{strategy_version}_{spec_hash[:8]}_0_{len(data)-1}"

    score = float(best["score"])
    node_reason = (
        f"Compression box found: width={best['width_atr']:.2f} ATR, "
        f"ER={best['efficiency_ratio']:.2f}, recurrence={best['recurrence']:.2f}"
    )

    candidate = {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version,
        "pattern_type": "compression_box_recurrence_v1_pattern",
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "compression_score_pass",
                "passed": score >= min_final_score,
                "value": round(score, 4),
                "threshold": f">= {min_final_score:.2f}",
            },
            {
                "rule_name": "pivot_touches_pass",
                "passed": best["touches_top"] >= min_top_touches and best["touches_bottom"] >= min_bottom_touches,
                "value": f"top={best['touches_top']}, bottom={best['touches_bottom']}",
                "threshold": f"top>={min_top_touches}, bottom>={min_bottom_touches}",
            },
            {
                "rule_name": "shape_compression_pass",
                "passed": best["width_atr"] <= max_width_atr and best["efficiency_ratio"] <= max_er,
                "value": f"width_atr={best['width_atr']:.2f}, er={best['efficiency_ratio']:.2f}",
                "threshold": f"width_atr<={max_width_atr:.2f}, er<={max_er:.2f}",
            },
            {
                "rule_name": "recurrence_pass",
                "passed": best["recurrence"] >= min_recurrence,
                "value": round(best["recurrence"], 4),
                "threshold": f">= {min_recurrence:.2f}",
            },
        ],
        "anchors": {
            "base_top": round(float(best["ceiling"]), 4),
            "base_bottom": round(float(best["floor"]), 4),
            "base_start_idx": int(best["base_start_idx"]),
            "base_end_idx": int(best["base_end_idx"]),
        },
        "window_start": int(best["base_start_idx"]),
        "window_end": int(best["base_end_idx"]),
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": int(best["base_start_idx"]),
        "chart_base_end": int(best["base_end_idx"]),
        "base": {
            "high": float(best["ceiling"]),
            "low": float(best["floor"]),
            "start": int(best["base_start_idx"]),
            "end": int(best["base_end_idx"]),
            "duration": int(best["base_span_bars"]),
        },
        "visual": {
            "markers": markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": True,
            "score": score,
            "features": {
                "width_atr": float(best["width_atr"]),
                "efficiency_ratio": float(best["efficiency_ratio"]),
                "slope_atr_per_bar": float(best["slope_atr_per_bar"]),
                "recurrence": float(best["recurrence"]),
                "touches_top": int(best["touches_top"]),
                "touches_bottom": int(best["touches_bottom"]),
                "pivot_switches": int(best["pivot_switches"]),
            },
            "anchors": {
                "base_top": float(best["ceiling"]),
                "base_bottom": float(best["floor"]),
                "base_start_idx": int(best["base_start_idx"]),
                "base_end_idx": int(best["base_end_idx"]),
            },
            "reason": node_reason,
        },
        "output_ports": {
            "signal": {
                "passed": True,
                "score": score,
                "reason": node_reason,
            },
            "compression_box": {
                "count": len(setups),
                "best": {
                    "base_start_idx": int(best["base_start_idx"]),
                    "base_end_idx": int(best["base_end_idx"]),
                    "base_span_bars": int(best["base_span_bars"]),
                    "ceiling": round(float(best["ceiling"]), 4),
                    "floor": round(float(best["floor"]), 4),
                    "width_atr": round(float(best["width_atr"]), 4),
                    "efficiency_ratio": round(float(best["efficiency_ratio"]), 4),
                    "slope_atr_per_bar": round(float(best["slope_atr_per_bar"]), 4),
                    "recurrence": round(float(best["recurrence"]), 4),
                    "touches_top": int(best["touches_top"]),
                    "touches_bottom": int(best["touches_bottom"]),
                    "pivot_switches": int(best["pivot_switches"]),
                    "score": round(float(best["score"]), 4),
                },
                "setups": [
                    {
                        "base_start_idx": int(s["base_start_idx"]),
                        "base_end_idx": int(s["base_end_idx"]),
                        "base_span_bars": int(s["base_span_bars"]),
                        "ceiling": round(float(s["ceiling"]), 4),
                        "floor": round(float(s["floor"]), 4),
                        "width_atr": round(float(s["width_atr"]), 4),
                        "efficiency_ratio": round(float(s["efficiency_ratio"]), 4),
                        "slope_atr_per_bar": round(float(s["slope_atr_per_bar"]), 4),
                        "recurrence": round(float(s["recurrence"]), 4),
                        "touches_top": int(s["touches_top"]),
                        "touches_bottom": int(s["touches_bottom"]),
                        "pivot_switches": int(s["pivot_switches"]),
                        "score": round(float(s["score"]), 4),
                    }
                    for s in setups[:20]
                ],
            },
            "rdp_pivots": {
                "epsilon_pct": epsilon_pct,
                "swing_count_total": len(pivots.get("all", [])),
                "swing_count_highs": len(pivots.get("highs", [])),
                "swing_count_lows": len(pivots.get("lows", [])),
            },
        },
    }
    return [candidate]
