#!/usr/bin/env python3
"""
Wiggle Base Box V2 (Pattern)
============================
Purposeful base detector that combines:
1) RDP wiggle geometry (anchor/qualify via wiggle events)
2) Explicit box validation (touches, tightness, flatness, duration)
3) Volume compression confirmation
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp

from rdp_wiggle_base_primitive import _build_wiggle_events


def _spec_hash(spec: dict) -> str:
    raw = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def _chart_data(data: List[OHLCV]) -> List[dict]:
    is_intra = _detect_intraday(data)
    return [
        {
            "time": _format_chart_time(b.timestamp, is_intra),
            "open": b.open,
            "high": b.high,
            "low": b.low,
            "close": b.close,
            "volume": getattr(b, "volume", 0),
        }
        for b in data
    ]


def _clamp01(v: float) -> float:
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return float(v)


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


def _median(values: Sequence[float]) -> Optional[float]:
    vals = sorted(float(v) for v in values if float(v) == float(v))
    if not vals:
        return None
    n = len(vals)
    mid = n // 2
    if n % 2 == 1:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def _mean(values: Sequence[float]) -> Optional[float]:
    vals = [float(v) for v in values if float(v) == float(v)]
    if not vals:
        return None
    return sum(vals) / float(len(vals))


def _std(values: Sequence[float], mean_v: float) -> Optional[float]:
    vals = [float(v) for v in values if float(v) == float(v)]
    if not vals:
        return None
    var = sum((v - mean_v) ** 2 for v in vals) / float(len(vals))
    return var ** 0.5


def _slope_pct_per_bar(values: Sequence[float]) -> float:
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


def _build_markers(best: Dict[str, Any], data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    if not best:
        return []
    start_idx = int(best["base_start_idx"])
    end_idx = int(best["base_end_idx"])
    qualify_idx = int(best["qualify_idx"]) if best.get("qualify_idx") is not None else None
    markers: List[Dict[str, Any]] = [
        {
            "time": _format_chart_time(data[start_idx].timestamp, is_intraday),
            "position": "belowBar",
            "color": "#f59e0b",
            "shape": "circle",
            "text": f"FLOOR ${best['floor']:.2f}",
        },
        {
            "time": _format_chart_time(data[end_idx].timestamp, is_intraday),
            "position": "aboveBar",
            "color": "#22c55e",
            "shape": "arrowUp",
            "text": f"BOX {best['final_score']:.2f}",
        },
    ]
    if qualify_idx is not None and 0 <= qualify_idx < len(data):
        markers.append(
            {
                "time": _format_chart_time(data[qualify_idx].timestamp, is_intraday),
                "position": "aboveBar",
                "color": "#38bdf8",
                "shape": "arrowUp",
                "text": "QUALIFY",
            }
        )
    return markers


def _build_overlays(best: Dict[str, Any], data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    if not best:
        return []
    start_idx = int(best["base_start_idx"])
    end_idx = int(best["base_end_idx"])
    t0 = _format_chart_time(data[start_idx].timestamp, is_intraday)
    t1 = _format_chart_time(data[end_idx].timestamp, is_intraday)
    floor = float(best["floor"])
    ceiling = float(best["ceiling"])
    floor_pts = [{"time": t0, "value": floor}, {"time": t1, "value": floor}]
    ceil_pts = [{"time": t0, "value": ceiling}, {"time": t1, "value": ceiling}]
    return [
        {
            "type": "line",
            "color": "#22c55e",
            "lineWidth": 2,
            "lineStyle": 0,
            "label": f"Floor ${floor:.2f}",
            "points": floor_pts,
            "data": floor_pts,
        },
        {
            "type": "line",
            "color": "#f59e0b",
            "lineWidth": 2,
            "lineStyle": 2,
            "label": f"Ceiling ${ceiling:.2f}",
            "points": ceil_pts,
            "data": ceil_pts,
        },
    ]


def _score_event(
    event: Dict[str, Any],
    data: List[OHLCV],
    cfg: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    base_start_idx = int(event["anchor_idx"])
    base_end_idx = int(event["base_end_idx"])
    if base_start_idx < 0 or base_end_idx >= len(data) or base_end_idx <= base_start_idx:
        return None

    min_base_bars = int(cfg.get("min_base_bars", 20))
    max_base_bars = int(cfg.get("max_base_bars", 220))
    if (base_end_idx - base_start_idx + 1) < min_base_bars:
        return None
    if (base_end_idx - base_start_idx + 1) > max_base_bars:
        return None

    box = data[base_start_idx: base_end_idx + 1]
    if not box:
        return None

    floor = float(event["base_floor"])
    highs = [float(b.high) for b in box]
    lows = [float(b.low) for b in box]
    closes = [float(b.close) for b in box]

    ceiling_q = float(cfg.get("ceiling_quantile", 0.88))
    ceiling = _quantile(highs, ceiling_q)
    if ceiling <= floor:
        return None

    max_base_range_pct = float(cfg.get("max_base_range_pct", 0.65))
    top_tolerance_pct = float(cfg.get("top_tolerance_pct", 0.08))
    bottom_tolerance_pct = float(cfg.get("bottom_tolerance_pct", 0.08))
    min_top_touches = int(cfg.get("min_top_touches", 2))
    min_bottom_touches = int(cfg.get("min_bottom_touches", 1))
    max_slope_pct_per_bar = float(cfg.get("max_slope_pct_per_bar", 0.008))
    floor_break_pct = float(cfg.get("floor_break_pct", 0.08))
    min_wiggle_score = float(cfg.get("min_wiggle_score", 0.30))

    range_pct = (ceiling - floor) / max(ceiling, 1e-9)
    touches_top = sum(1 for h in highs if h >= ceiling * (1.0 - top_tolerance_pct))
    touches_bottom = sum(1 for l in lows if l <= floor * (1.0 + bottom_tolerance_pct))
    slope_pct = _slope_pct_per_bar(closes)
    floor_not_broken = min(lows) >= floor * (1.0 - floor_break_pct)

    ws = event.get("wiggle_scores") if isinstance(event.get("wiggle_scores"), dict) else {}
    wiggle = float(ws.get("WIGGLE", 0.0) or 0.0)

    geometry_pass = (
        bool(event.get("qualify_idx") is not None)
        and bool(event.get("active"))
        and wiggle >= min_wiggle_score
        and range_pct <= max_base_range_pct
        and touches_top >= min_top_touches
        and touches_bottom >= min_bottom_touches
        and slope_pct <= max_slope_pct_per_bar
        and floor_not_broken
    )

    pre_base_bars = int(cfg.get("pre_base_bars", 40))
    require_volume_compression = bool(cfg.get("require_volume_compression", False))
    max_quiet_ratio = float(cfg.get("max_quiet_ratio", 1.10))
    max_base_vol_cv = float(cfg.get("max_base_vol_cv", 1.6))
    max_cv_ratio = float(cfg.get("max_cv_ratio", 1.25))

    base_vol = [float(getattr(b, "volume", 0.0) or 0.0) for b in box if float(getattr(b, "volume", 0.0) or 0.0) > 0]
    pre_start = max(0, base_start_idx - pre_base_bars)
    pre_box = data[pre_start:base_start_idx]
    pre_vol = [float(getattr(b, "volume", 0.0) or 0.0) for b in pre_box if float(getattr(b, "volume", 0.0) or 0.0) > 0]

    med_base = _median(base_vol)
    med_pre = _median(pre_vol)
    mean_base = _mean(base_vol)
    mean_pre = _mean(pre_vol)
    std_base = _std(base_vol, mean_base) if mean_base is not None else None
    std_pre = _std(pre_vol, mean_pre) if mean_pre is not None else None

    quiet_ratio = None if med_base is None or med_pre is None or med_pre <= 0 else med_base / med_pre
    cv_base = None if mean_base is None or std_base is None or mean_base <= 0 else std_base / mean_base
    cv_pre = None if mean_pre is None or std_pre is None or mean_pre <= 0 else std_pre / mean_pre
    cv_ratio = None if cv_base is None or cv_pre is None or cv_pre <= 0 else cv_base / cv_pre

    if not base_vol:
        volume_pass = not require_volume_compression
    else:
        quiet_ok = quiet_ratio is not None and quiet_ratio <= max_quiet_ratio
        cv_ok = cv_base is not None and cv_base <= max_base_vol_cv
        cv_ratio_ok = cv_ratio is None or cv_ratio <= max_cv_ratio
        volume_pass = quiet_ok and cv_ok and cv_ratio_ok
        if not require_volume_compression:
            volume_pass = True

    wiggle_score = _clamp01((wiggle - min_wiggle_score) / max(1e-9, 1.0 - min_wiggle_score))
    top_touch_score = _clamp01(float(touches_top) / max(float(min_top_touches), 1.0))
    bottom_touch_score = _clamp01(float(touches_bottom) / max(float(min_bottom_touches), 1.0))
    tight_score = _clamp01(1.0 - (range_pct / max(max_base_range_pct, 1e-9)))
    flat_score = _clamp01(1.0 - (slope_pct / max(max_slope_pct_per_bar, 1e-9)))
    duration_bars = base_end_idx - base_start_idx + 1
    duration_score = _clamp01(float(duration_bars) / max(float(min_base_bars), 1.0))
    geometry_score = (
        0.25 * wiggle_score
        + 0.20 * top_touch_score
        + 0.20 * bottom_touch_score
        + 0.20 * tight_score
        + 0.15 * flat_score
    )

    quiet_score = 0.5 if quiet_ratio is None else _clamp01((max_quiet_ratio - quiet_ratio) / max(max_quiet_ratio, 1e-9))
    if cv_ratio is not None:
        cv_score = _clamp01((max_cv_ratio - cv_ratio) / max(max_cv_ratio, 1e-9))
    elif cv_base is not None:
        cv_score = _clamp01((max_base_vol_cv - cv_base) / max(max_base_vol_cv, 1e-9))
    else:
        cv_score = 0.5
    volume_score = 0.65 * quiet_score + 0.35 * cv_score

    final_score = _clamp01(0.60 * geometry_score + 0.40 * volume_score)
    min_final_score = float(cfg.get("min_final_score", 0.45))
    base_detected = geometry_pass and volume_pass and final_score >= min_final_score

    breakout_help_pct = float(cfg.get("breakout_help_pct", 0.01))
    current_close = float(data[-1].close)
    breakout_seen = current_close >= ceiling * (1.0 + breakout_help_pct)

    return {
        "base_start_idx": base_start_idx,
        "base_end_idx": base_end_idx,
        "qualify_idx": event.get("qualify_idx"),
        "floor": floor,
        "ceiling": ceiling,
        "duration_bars": duration_bars,
        "range_pct": range_pct,
        "touches_top": int(touches_top),
        "touches_bottom": int(touches_bottom),
        "slope_pct_per_bar": slope_pct,
        "wiggle": wiggle,
        "quiet_ratio": quiet_ratio,
        "cv_base": cv_base,
        "cv_pre": cv_pre,
        "cv_ratio": cv_ratio,
        "geometry_score": geometry_score,
        "volume_score": volume_score,
        "duration_score": duration_score,
        "final_score": final_score,
        "geometry_pass": geometry_pass,
        "volume_pass": volume_pass,
        "base_detected": base_detected,
        "breakout_seen": breakout_seen,
        "active": bool(event.get("active")),
        "event": event,
    }


def run_wiggle_base_box_v2_pattern_plugin(
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
    eps_fine = float(setup.get("epsilon_fine", 0.01))
    window_n = int(setup.get("window_n", 8))
    persist_m = int(setup.get("persist_m", 2))
    wiggle_threshold = float(setup.get("wiggle_threshold", 0.30))
    k_expand = float(setup.get("k_expand", 2.0))
    use_local_atr = bool(setup.get("use_local_atr", True))
    local_atr_window = int(setup.get("local_atr_window", 20))
    emit_when_missing = bool(setup.get("emit_when_missing", False))
    max_setups = int(setup.get("max_setups", 20))

    if len(data) < 80:
        return []

    coarse_swings = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=eps_coarse)
    events = _build_wiggle_events(
        data,
        coarse_swings.swing_points,
        fine_epsilon=eps_fine,
        symbol=symbol,
        timeframe=timeframe,
        window_n=window_n,
        persist_m=persist_m,
        wiggle_thresh=wiggle_threshold,
        k_expand=k_expand,
        use_local_atr=use_local_atr,
        local_atr_window=local_atr_window,
    )

    scored: List[Dict[str, Any]] = []
    for e in events:
        row = _score_event(e, data, setup)
        if row is not None:
            scored.append(row)

    scored.sort(key=lambda r: (bool(r.get("base_detected")), float(r.get("final_score", 0.0))), reverse=True)
    passed = [r for r in scored if bool(r.get("base_detected"))]

    if mode == "signal":
        return {int(r["base_end_idx"]) for r in passed}

    if not passed and not emit_when_missing:
        return []

    best = passed[0] if passed else (scored[0] if scored else None)
    if not best:
        return []

    is_intraday = _detect_intraday(data)
    markers = _build_markers(best, data, is_intraday)
    overlays = _build_overlays(best, data, is_intraday)

    score = float(best["final_score"])
    entry_ready = bool(best["base_detected"] and best["breakout_seen"])

    spec_hash = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    strategy_version = (
        spec.get("strategy_version_id", "wiggle_base_box_v2_pattern_v1")
        if isinstance(spec, dict)
        else "wiggle_base_box_v2_pattern_v1"
    )
    candidate_id = f"{symbol}_{timeframe}_{strategy_version}_{spec_hash[:8]}_0_{len(data)-1}"

    candidate = {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": entry_ready,
        "base": {
            "high": float(best["ceiling"]),
            "low": float(best["floor"]),
            "start": int(best["base_start_idx"]),
            "end": int(best["base_end_idx"]),
            "duration": int(best["duration_bars"]),
        },
        "rule_checklist": [
            {
                "rule_name": "base_detected",
                "passed": bool(best["base_detected"]),
                "value": "true" if best["base_detected"] else "false",
                "threshold": "true",
            },
            {
                "rule_name": "volume_compressed",
                "passed": bool(best["volume_pass"]),
                "value": best["quiet_ratio"],
                "threshold": f"quiet_ratio <= {float(setup.get('max_quiet_ratio', 0.85)):.2f}",
            },
            {
                "rule_name": "box_touches_confirmed",
                "passed": bool(
                    int(best["touches_top"]) >= int(setup.get("min_top_touches", 2))
                    and int(best["touches_bottom"]) >= int(setup.get("min_bottom_touches", 2))
                ),
                "value": f"top={best['touches_top']}, bottom={best['touches_bottom']}",
                "threshold": (
                    f"top>={int(setup.get('min_top_touches', 2))}, "
                    f"bottom>={int(setup.get('min_bottom_touches', 2))}"
                ),
            },
            {
                "rule_name": "wiggle_confirmed",
                "passed": float(best["wiggle"]) >= float(setup.get("min_wiggle_score", 0.30)),
                "value": round(float(best["wiggle"]), 4),
                "threshold": f">= {float(setup.get('min_wiggle_score', 0.30)):.2f}",
            },
        ],
        "anchors": {
            "base_start_idx": int(best["base_start_idx"]),
            "base_end_idx": int(best["base_end_idx"]),
            "qualify_idx": int(best["qualify_idx"]) if best.get("qualify_idx") is not None else None,
            "base_floor": round(float(best["floor"]), 4),
            "base_ceiling": round(float(best["ceiling"]), 4),
            "range_pct": round(float(best["range_pct"]), 4),
            "quiet_ratio": round(float(best["quiet_ratio"]), 4) if best.get("quiet_ratio") is not None else None,
            "cv_base": round(float(best["cv_base"]), 4) if best.get("cv_base") is not None else None,
            "cv_pre": round(float(best["cv_pre"]), 4) if best.get("cv_pre") is not None else None,
            "cv_ratio": round(float(best["cv_ratio"]), 4) if best.get("cv_ratio") is not None else None,
            "geometry_score": round(float(best["geometry_score"]), 4),
            "volume_score": round(float(best["volume_score"]), 4),
            "breakout_seen": bool(best["breakout_seen"]),
        },
        "window_start": int(best["base_start_idx"]),
        "window_end": int(best["base_end_idx"]),
        "pattern_type": "wiggle_base_box_v2_pattern",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": int(best["base_start_idx"]),
        "chart_base_end": int(best["base_end_idx"]),
        "visual": {
            "markers": markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": bool(best["base_detected"]),
            "score": score,
            "features": {
                "geometry_score": float(best["geometry_score"]),
                "volume_score": float(best["volume_score"]),
                "wiggle": float(best["wiggle"]),
                "range_pct": float(best["range_pct"]),
                "quiet_ratio": best.get("quiet_ratio"),
                "cv_ratio": best.get("cv_ratio"),
            },
            "anchors": {
                "floor": float(best["floor"]),
                "ceiling": float(best["ceiling"]),
                "start_idx": int(best["base_start_idx"]),
                "end_idx": int(best["base_end_idx"]),
            },
            "reason": (
                f"Purposeful base detected (geom={best['geometry_score']:.2f}, vol={best['volume_score']:.2f})"
                if best["base_detected"]
                else "Wiggle event found but geometry/volume constraints not met"
            ),
        },
        "output_ports": {
            "base_boxes": {
                "count": len(passed),
                "best": {
                    "base_start_idx": int(best["base_start_idx"]),
                    "base_end_idx": int(best["base_end_idx"]),
                    "base_span_bars": int(best["duration_bars"]),
                    "ceiling": round(float(best["ceiling"]), 4),
                    "floor": round(float(best["floor"]), 4),
                    "range_pct": round(float(best["range_pct"]) * 100.0, 2),
                    "touches_top": int(best["touches_top"]),
                    "touches_bottom": int(best["touches_bottom"]),
                    "slope_pct_per_bar": round(float(best["slope_pct_per_bar"]) * 100.0, 4),
                    "wiggle": round(float(best["wiggle"]), 4),
                    "quiet_ratio": round(float(best["quiet_ratio"]), 4) if best.get("quiet_ratio") is not None else None,
                    "cv_ratio": round(float(best["cv_ratio"]), 4) if best.get("cv_ratio") is not None else None,
                    "geometry_score": round(float(best["geometry_score"]), 4),
                    "volume_score": round(float(best["volume_score"]), 4),
                    "score": round(float(best["final_score"]), 4),
                    "base_detected": bool(best["base_detected"]),
                    "breakout_seen": bool(best["breakout_seen"]),
                },
                "setups": [
                    {
                        "base_start_idx": int(s["base_start_idx"]),
                        "base_end_idx": int(s["base_end_idx"]),
                        "base_span_bars": int(s["duration_bars"]),
                        "ceiling": round(float(s["ceiling"]), 4),
                        "floor": round(float(s["floor"]), 4),
                        "range_pct": round(float(s["range_pct"]) * 100.0, 2),
                        "touches_top": int(s["touches_top"]),
                        "touches_bottom": int(s["touches_bottom"]),
                        "slope_pct_per_bar": round(float(s["slope_pct_per_bar"]) * 100.0, 4),
                        "wiggle": round(float(s["wiggle"]), 4),
                        "quiet_ratio": round(float(s["quiet_ratio"]), 4) if s.get("quiet_ratio") is not None else None,
                        "cv_ratio": round(float(s["cv_ratio"]), 4) if s.get("cv_ratio") is not None else None,
                        "geometry_score": round(float(s["geometry_score"]), 4),
                        "volume_score": round(float(s["volume_score"]), 4),
                        "score": round(float(s["final_score"]), 4),
                        "base_detected": bool(s["base_detected"]),
                        "breakout_seen": bool(s["breakout_seen"]),
                    }
                    for s in scored[:max_setups]
                ],
            }
        },
    }

    return [candidate]
