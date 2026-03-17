#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import asdict
from datetime import datetime
from typing import Any, Dict, List, Optional

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.swing_structure import find_major_peaks
from platform_sdk.copilot import Base


def compute_spec_hash(spec: Dict[str, Any]) -> str:
    payload = {
        "cost_config": spec.get("cost_config") or None,
        "entry_config": spec.get("entry_config") or None,
        "exit_config": spec.get("exit_config") or None,
        "risk_config": spec.get("risk_config") or None,
        "setup_config": spec.get("setup_config") or None,
        "strategy_id": spec.get("strategy_id"),
        "structure_config": spec.get("structure_config") or None,
        "version": spec.get("version"),
    }

    def canonicalize(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: canonicalize(value[k]) for k in sorted(value.keys())}
        if isinstance(value, list):
            return [canonicalize(v) for v in value]
        return value

    json_str = json.dumps(canonicalize(payload), separators=(",", ":"))
    return hashlib.sha256(json_str.encode("utf-8")).hexdigest()


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _score_band(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return _clamp01((float(value) - float(low)) / (float(high) - float(low)))


def _score_target_band(value: float, good_low: float, good_high: float, hard_low: float, hard_high: float) -> float:
    value = float(value)
    if hard_high <= hard_low:
        return 0.0
    if good_low <= value <= good_high:
        return 1.0
    if value < hard_low or value > hard_high:
        return 0.0
    if value < good_low:
        return _clamp01((value - hard_low) / (good_low - hard_low))
    return _clamp01((hard_high - value) / (hard_high - good_high))


def _compute_box_containment_metrics(
    data: List[OHLCV],
    start_idx: int,
    end_idx: int,
    box_low: float,
    box_high: float,
) -> Dict[str, float]:
    if end_idx <= start_idx:
        return {
            "inside_close_ratio": 0.0,
            "top_respect_ratio": 0.0,
            "floor_hold_ratio": 0.0,
            "range_tightness": 0.0,
        }

    closes = [float(data[i].close) for i in range(start_idx, end_idx + 1)]
    highs = [float(data[i].high) for i in range(start_idx, end_idx + 1)]
    lows = [float(data[i].low) for i in range(start_idx, end_idx + 1)]
    box_height = max(1e-9, float(box_high) - float(box_low))
    inside_low = float(box_low) - (0.10 * box_height)
    inside_high = float(box_high) + (0.05 * box_height)
    inside_close_ratio = sum(1 for close in closes if inside_low <= close <= inside_high) / len(closes)
    top_respect_ratio = sum(1 for close in closes if close <= float(box_high) * 1.01) / len(closes)
    floor_hold_ratio = sum(1 for low in lows if low >= float(box_low) * 0.95) / len(lows)
    observed_range = max(highs) - min(lows) if highs and lows else 0.0
    range_tightness = _clamp01(1.0 - max(0.0, observed_range - box_height) / max(box_height, 1e-9))
    return {
        "inside_close_ratio": inside_close_ratio,
        "top_respect_ratio": top_respect_ratio,
        "floor_hold_ratio": floor_hold_ratio,
        "range_tightness": range_tightness,
    }


def _score_wyckoff_components(
    data: List[OHLCV],
    decline_pct: float,
    base_obj: Base,
    ar_idx: int,
    markup: Optional[Dict[str, Any]],
    pullback: Optional[Dict[str, Any]],
    second_breakout: Optional[Dict[str, Any]],
) -> Dict[str, float]:
    box_height = max(1e-9, float(base_obj.high) - float(base_obj.low))
    box_height_pct = box_height / max(float(base_obj.high), 1e-9)
    ar_response_bars = max(1, ar_idx - int(base_obj.start_index))
    containment = _compute_box_containment_metrics(
        data,
        min(len(data) - 1, ar_idx),
        min(len(data) - 1, int(base_obj.end_index)),
        float(base_obj.low),
        float(base_obj.high),
    )

    sc_quality = (0.65 * _score_band(decline_pct, 0.45, 0.80)) + (0.35 * _score_band(box_height_pct, 0.12, 0.40))
    ar_quality = (0.60 * _score_band(box_height_pct, 0.10, 0.35)) + (0.40 * (1.0 - _score_band(ar_response_bars, 12, 40)))
    containment_quality = (
        0.45 * containment["inside_close_ratio"]
        + 0.25 * containment["top_respect_ratio"]
        + 0.20 * containment["floor_hold_ratio"]
        + 0.10 * containment["range_tightness"]
    )

    sos_quality = 0.0
    if markup is not None:
        breakout_gain = (float(markup["breakout_price"]) - float(base_obj.high)) / max(float(base_obj.high), 1e-9)
        markup_gain = (float(markup["high"]) - float(base_obj.high)) / max(float(base_obj.high), 1e-9)
        sos_quality = (0.55 * _score_band(breakout_gain, 0.01, 0.10)) + (0.45 * _score_band(markup_gain, 0.03, 0.35))

    backup_quality = 0.0
    retracement = None
    if pullback is not None:
        retracement = float(pullback["retracement"])
        backup_quality = _score_target_band(retracement, 0.79, 1.00, 0.50, 1.20)

    rebreakout_quality = 0.0
    if second_breakout is not None:
        second_gain = (float(second_breakout["price"]) - float(base_obj.high)) / max(float(base_obj.high), 1e-9)
        rebreakout_quality = _score_band(second_gain, 0.02, 0.15)

    duration_quality = _score_band(int(base_obj.duration), 20, 120)
    weighted_score = (
        0.16 * sc_quality
        + 0.16 * ar_quality
        + 0.22 * containment_quality
        + 0.16 * sos_quality
        + 0.16 * backup_quality
        + 0.14 * rebreakout_quality
    )
    score = min(1.0, weighted_score + (0.08 * duration_quality))

    return {
        "score": round(score, 4),
        "sc_quality": round(sc_quality, 4),
        "ar_quality": round(ar_quality, 4),
        "containment_quality": round(containment_quality, 4),
        "sos_quality": round(sos_quality, 4),
        "backup_quality": round(backup_quality, 4),
        "rebreakout_quality": round(rebreakout_quality, 4),
        "duration_quality": round(duration_quality, 4),
        "inside_close_ratio": round(containment["inside_close_ratio"], 4),
        "top_respect_ratio": round(containment["top_respect_ratio"], 4),
        "floor_hold_ratio": round(containment["floor_hold_ratio"], 4),
        "range_tightness": round(containment["range_tightness"], 4),
        "box_height_pct": round(box_height_pct, 4),
        "ar_response_bars": int(ar_response_bars),
        "backup_depth": round(retracement, 4) if retracement is not None else None,
    }


def _build_chart_data(data: List[OHLCV]) -> List[Dict[str, Any]]:
    is_intraday = _detect_intraday(data)
    rows: List[Dict[str, Any]] = []
    for bar in data:
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t is None:
            continue
        rows.append({
            "time": t,
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": float(getattr(bar, "volume", 0) or 0),
        })
    return rows


def _build_visual(
    data: List[OHLCV],
    base_obj: Base,
    peak_idx: int,
    peak_price: float,
    sc_idx: int,
    sc_price: float,
    ar_idx: int,
    ar_price: float,
    markup: Optional[Dict[str, Any]],
    pullback: Optional[Dict[str, Any]],
    breakout: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    is_intraday = _detect_intraday(data)

    def t(idx: int) -> Any:
        return _format_chart_time(data[idx].timestamp, is_intraday)

    markers: List[Dict[str, Any]] = [
        {
            "time": t(peak_idx),
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "arrowDown",
            "text": f"PEAK {peak_price:.2f}",
        },
        {
            "time": t(sc_idx),
            "position": "belowBar",
            "color": "#22c55e",
            "shape": "arrowUp",
            "text": f"SELLING CLIMAX {sc_price:.2f}",
        },
        {
            "time": t(ar_idx),
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "arrowDown",
            "text": f"AUTOMATIC RALLY {ar_price:.2f}",
        },
        {
            "time": t(int(base_obj.start_index)),
            "position": "belowBar",
            "color": "#10b981",
            "shape": "circle",
            "text": f"BASE START {float(base_obj.low):.2f}",
        },
        {
            "time": t(int(base_obj.end_index)),
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "circle",
            "text": f"BASE END {float(base_obj.high):.2f}",
        },
    ]
    if markup is not None:
        markers.append({
            "time": t(int(markup["high_index"])),
            "position": "aboveBar",
            "color": "#60a5fa",
            "shape": "arrowDown",
            "text": f"MARKUP {float(markup['high']):.2f}",
        })
    if pullback is not None:
        markers.append({
            "time": t(int(pullback["low_index"])),
            "position": "belowBar",
            "color": "#14b8a6",
            "shape": "arrowUp",
            "text": f"PULLBACK {float(pullback['low']):.2f}",
        })
    if breakout is not None:
        markers.append({
            "time": t(int(breakout["index"])),
            "position": "aboveBar",
            "color": "#3b82f6",
            "shape": "arrowUp",
            "text": f"SECOND BREAKOUT {float(breakout['price']):.2f}",
        })

    left_time = t(int(base_obj.start_index))
    right_idx = int(breakout["index"]) if breakout is not None else int(base_obj.end_index)
    right_time = t(right_idx)
    overlays = [
        {
            "type": "line",
            "color": "#f59e0b",
            "lineWidth": 1,
            "lineStyle": 0,
            "label": f"BASE TOP ${float(base_obj.high):.2f}",
            "points": [{"time": left_time, "value": float(base_obj.high)}, {"time": right_time, "value": float(base_obj.high)}],
            "data": [{"time": left_time, "value": float(base_obj.high)}, {"time": right_time, "value": float(base_obj.high)}],
        },
        {
            "type": "line",
            "color": "#22c55e",
            "lineWidth": 1,
            "lineStyle": 0,
            "label": f"BASE BOTTOM ${float(base_obj.low):.2f}",
            "points": [{"time": left_time, "value": float(base_obj.low)}, {"time": right_time, "value": float(base_obj.low)}],
            "data": [{"time": left_time, "value": float(base_obj.low)}, {"time": right_time, "value": float(base_obj.low)}],
        },
    ]
    return {"markers": markers, "overlay_series": overlays}


def _find_base_after_markdown(
    data: List[OHLCV],
    markdown_low_idx: int,
    min_base_dur: int,
    base_resistance_closes: int,
) -> Optional[Dict[str, Any]]:
    n = len(data)
    if n - markdown_low_idx < 30:
        return None

    base_start = markdown_low_idx
    base_low = float(data[markdown_low_idx].low)

    ar_window_end = min(n, markdown_low_idx + 30)
    if ar_window_end - markdown_low_idx < 4:
        return None

    ar_idx = markdown_low_idx + 1
    ar_price = float(data[ar_idx].high)
    for i in range(markdown_low_idx + 1, ar_window_end):
        high = float(data[i].high)
        if high > ar_price:
            ar_price = high
            ar_idx = i

    if ar_idx <= markdown_low_idx:
        return None

    base_high_initial = ar_price
    base_end: Optional[int] = None
    base_high = base_high_initial

    confirm_bars = max(2, int(base_resistance_closes))
    breakout_search_start = max(ar_idx + 8, markdown_low_idx + 20)
    breakout_search_end = min(markdown_low_idx + 500, max(breakout_search_start + 1, n - 10))
    for i in range(breakout_search_start, breakout_search_end):
        close_window_end = min(n, i + confirm_bars)
        closes_above = sum(1 for j in range(i, close_window_end) if float(data[j].close) > base_high_initial)
        if closes_above >= confirm_bars:
            base_end = i - 1
            break

    if base_end is None:
        base_end = min(markdown_low_idx + 400, n - 1)

    duration = base_end - base_start + 1
    if duration < max(20, int(min_base_dur)):
        return None

    return {
        "start_index": base_start,
        "end_index": base_end,
        "high": base_high,
        "low": base_low,
        "height": base_high - base_low,
        "duration": duration,
        "selling_climax_index": markdown_low_idx,
        "selling_climax_price": base_low,
        "automatic_rally_index": ar_idx,
        "automatic_rally_price": ar_price,
        "start_date": data[base_start].timestamp[:10] if base_start < n else "",
        "end_date": data[base_end].timestamp[:10] if base_end < n else "",
    }


def _find_markup(data: List[OHLCV], base_obj: Base, lookforward: int) -> Optional[Dict[str, Any]]:
    start_idx = int(base_obj.end_index) + 1
    n = len(data)
    if start_idx >= n:
        return None

    breakout_idx: Optional[int] = None
    breakout_price: Optional[float] = None
    high_idx: Optional[int] = None
    high_price = float(base_obj.high)

    for i in range(start_idx, min(start_idx + int(lookforward), n)):
        close_price = float(data[i].close)
        high = float(data[i].high)
        if breakout_idx is None and close_price > float(base_obj.high) * 1.01:
            breakout_idx = i
            breakout_price = close_price
        if high > high_price:
            high_idx = i
            high_price = high

    if breakout_idx is None or high_idx is None or high_price <= float(base_obj.high):
        return None

    return {
        "breakout_index": breakout_idx,
        "breakout_price": breakout_price,
        "breakout_date": data[breakout_idx].timestamp[:10],
        "high_index": high_idx,
        "high": high_price,
        "high_date": data[high_idx].timestamp[:10],
    }


def _find_pullback(
    data: List[OHLCV],
    base_obj: Base,
    markup: Dict[str, Any],
    min_retracement: float,
    max_retracement: float,
    lookforward: int,
) -> Optional[Dict[str, Any]]:
    start_idx = int(markup["high_index"]) + 1
    n = len(data)
    if start_idx >= n:
        return None

    low_idx = start_idx
    low_price = float(data[start_idx].low)
    for i in range(start_idx, min(start_idx + int(lookforward), n)):
        if float(data[i].low) < low_price:
            low_price = float(data[i].low)
            low_idx = i

    box_height = float(base_obj.high) - float(base_obj.low)
    retracement = ((float(base_obj.high) - low_price) / box_height) if box_height > 0 else 0.0
    if retracement < float(min_retracement) or retracement > float(max_retracement):
        return None

    return {
        "low_index": low_idx,
        "low": low_price,
        "low_date": data[low_idx].timestamp[:10],
        "retracement": retracement,
    }


def _find_second_breakout(
    data: List[OHLCV],
    base_obj: Base,
    pullback: Dict[str, Any],
    breakout_multiplier: float,
    confirmation_bars: int,
    lookforward: int,
) -> Optional[Dict[str, Any]]:
    start_idx = int(pullback["low_index"]) + 1
    n = len(data)
    breakout_level = float(base_obj.high) * float(breakout_multiplier)
    confirm_bars = max(1, int(confirmation_bars))

    for i in range(start_idx, min(start_idx + int(lookforward), n)):
        if float(data[i].close) <= breakout_level:
            continue
        if confirm_bars > 1:
            end_idx = min(n, i + confirm_bars)
            if end_idx - i < confirm_bars:
                continue
            confirmed = all(float(data[j].close) > float(base_obj.high) for j in range(i, end_idx))
            if not confirmed:
                continue
        return {
            "index": i,
            "price": float(data[i].close),
            "date": data[i].timestamp[:10],
        }
    return None


def run_wyckoff_plugin(
    data: List[OHLCV],
    structure: StructureExtraction,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
) -> List[Dict[str, Any]]:
    setup = spec.get("setup_config", {})
    entry_cfg = spec.get("entry_config", {})
    struct_cfg = spec.get("structure_config", {})
    strategy_version_id = spec.get("strategy_version_id", f"{spec.get('strategy_id', 'unknown')}_v{spec.get('version', '0')}")
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    spec_hash_short = spec_hash[:12]

    min_prominence = float(setup.get("min_prominence", 0.20))
    peak_lookback = int(setup.get("peak_lookback", 50))
    min_markdown_pct = float(setup.get("min_markdown_pct", 0.70))
    markdown_lookback = int(setup.get("markdown_lookback", 300))
    base_min_dur = int(struct_cfg.get("base_min_duration", 20))
    base_res_closes = int(setup.get("base_resistance_closes", 3))
    markup_lookforward = int(setup.get("markup_lookforward", 100))
    pullback_lookforward = int(setup.get("pullback_lookforward", 200))
    pullback_retracement_min = float(setup.get("pullback_retracement_min", 0.30))
    pullback_retracement_max = float(setup.get("pullback_retracement_max", 5.0))
    double_bottom_tolerance = float(setup.get("double_bottom_tolerance", 1.05))
    breakout_multiplier = float(setup.get("breakout_multiplier", 1.02))
    confirmation_bars = int(entry_cfg.get("confirmation_bars", 1))
    score_min = float(setup.get("score_min", 0.0))
    emitted_pattern_type = str(
        setup.get("pattern_type")
        or spec.get("pattern_type")
        or spec.get("strategy_id")
        or "wyckoff_accumulation"
    ).strip() or "wyckoff_accumulation"

    n = len(data)
    if n < 120:
        return []

    chart_data = _build_chart_data(data)
    candidates: List[Dict[str, Any]] = []

    peaks = find_major_peaks(data, min_prominence=min_prominence, lookback=peak_lookback)
    print(f"[Runner] Found {len(peaks)} peaks (prominence >= {min_prominence})", file=sys.stderr)

    for peak_idx, peak_price in peaks:
        rules: List[Dict[str, Any]] = []
        anchors: Dict[str, Any] = {
            "prior_peak": {
                "index": peak_idx,
                "price": round(float(peak_price), 4),
                "date": data[peak_idx].timestamp[:10] if peak_idx < n else "",
            }
        }

        search_end = min(peak_idx + markdown_lookback, n)
        if search_end <= peak_idx:
            continue

        md_low_idx = peak_idx
        md_low_price = float(data[peak_idx].low)
        for i in range(peak_idx + 1, search_end):
            if float(data[i].low) < md_low_price:
                md_low_price = float(data[i].low)
                md_low_idx = i

        if peak_price <= 0:
            continue
        decline_pct = (float(peak_price) - md_low_price) / float(peak_price)
        rules.append({
            "rule_name": "markdown_decline",
            "passed": decline_pct >= min_markdown_pct,
            "value": round(decline_pct, 4),
            "threshold": min_markdown_pct,
        })
        if decline_pct < min_markdown_pct:
            continue

        anchors["markdown_low"] = {
            "index": md_low_idx,
            "price": round(md_low_price, 4),
            "date": data[md_low_idx].timestamp[:10],
        }

        best_base = _find_base_after_markdown(data, md_low_idx, base_min_dur, base_res_closes)

        rules.append({
            "rule_name": "base_found",
            "passed": best_base is not None,
            "value": int(best_base["duration"]) if best_base is not None else 0,
            "threshold": base_min_dur,
        })
        if best_base is None:
            continue

        base_obj = Base(
            start_index=int(best_base["start_index"]),
            end_index=int(best_base["end_index"]),
            low=float(best_base["low"]),
            high=float(best_base["high"]),
            height=float(best_base["height"]),
            duration=int(best_base["duration"]),
            start_date=str(best_base.get("start_date", "")),
            end_date=str(best_base.get("end_date", "")),
        )
        rules.append({
            "rule_name": "base_duration",
            "passed": int(base_obj.duration) >= base_min_dur,
            "value": int(base_obj.duration),
            "threshold": base_min_dur,
        })

        anchors["base_start"] = {"index": int(base_obj.start_index), "price": round(float(base_obj.low), 4), "date": str(best_base.get("start_date", ""))}
        anchors["base_end"] = {"index": int(base_obj.end_index), "price": round(float(base_obj.high), 4), "date": str(best_base.get("end_date", ""))}
        anchors["base_low"] = round(float(base_obj.low), 4)
        anchors["base_high"] = round(float(base_obj.high), 4)
        anchors["selling_climax"] = {
            "index": int(best_base.get("selling_climax_index", md_low_idx)),
            "price": round(float(best_base.get("selling_climax_price", md_low_price)), 4),
            "date": data[int(best_base.get("selling_climax_index", md_low_idx))].timestamp[:10],
        }
        anchors["automatic_rally"] = {
            "index": int(best_base.get("automatic_rally_index", md_low_idx)),
            "price": round(float(best_base.get("automatic_rally_price", base_obj.high)), 4),
            "date": data[int(best_base.get("automatic_rally_index", md_low_idx))].timestamp[:10],
        }

        markup = _find_markup(data, base_obj, markup_lookforward)
        rules.append({
            "rule_name": "markup_breakout",
            "passed": markup is not None,
            "value": round(float(markup["high"]), 4) if markup is not None else None,
            "threshold": round(float(base_obj.high), 4),
        })
        if markup is not None:
            anchors["markup_high"] = {
                "index": int(markup["high_index"]),
                "price": round(float(markup["high"]), 4),
                "date": str(markup["high_date"]),
            }

        pullback = None
        if markup is not None:
            pullback = _find_pullback(
                data,
                base_obj,
                markup,
                pullback_retracement_min,
                pullback_retracement_max,
                pullback_lookforward,
            )
        rules.append({
            "rule_name": "pullback_found",
            "passed": pullback is not None,
            "value": round(float(pullback["retracement"]), 4) if pullback is not None else None,
            "threshold": [pullback_retracement_min, pullback_retracement_max],
        })

        is_double_bottom = bool(pullback is not None and float(pullback["low"]) <= float(base_obj.low) * double_bottom_tolerance)
        rules.append({
            "rule_name": "pullback_retracement",
            "passed": bool(
                pullback is not None
                and pullback_retracement_min <= float(pullback["retracement"]) <= pullback_retracement_max
            ),
            "value": round(float(pullback["retracement"]), 4) if pullback is not None else None,
            "threshold": [pullback_retracement_min, pullback_retracement_max],
        })
        rules.append({
            "rule_name": "double_bottom",
            "passed": is_double_bottom,
            "value": round(float(pullback["low"]), 4) if pullback is not None else None,
            "threshold": round(float(base_obj.low) * double_bottom_tolerance, 4),
        })
        if pullback is not None:
            anchors["pullback_low"] = {
                "index": int(pullback["low_index"]),
                "price": round(float(pullback["low"]), 4),
                "date": str(pullback["low_date"]),
            }

        second_breakout = None
        if pullback is not None:
            second_breakout = _find_second_breakout(
                data,
                base_obj,
                pullback,
                breakout_multiplier,
                confirmation_bars,
                pullback_lookforward,
            )
        rules.append({
            "rule_name": "second_breakout",
            "passed": second_breakout is not None,
            "value": round(float(second_breakout["price"]), 4) if second_breakout is not None else None,
            "threshold": round(float(base_obj.high) * breakout_multiplier, 4),
        })
        if second_breakout is not None:
            anchors["second_breakout"] = {
                "index": int(second_breakout["index"]),
                "price": round(float(second_breakout["price"]), 4),
                "date": str(second_breakout["date"]),
            }

        components = _score_wyckoff_components(
            data,
            decline_pct,
            base_obj,
            int(best_base.get("automatic_rally_index", md_low_idx)),
            markup,
            pullback,
            second_breakout,
        )
        score = float(components["score"])
        rules.extend([
            {
                "rule_name": "sc_quality",
                "passed": float(components["sc_quality"]) >= 0.55,
                "value": float(components["sc_quality"]),
                "threshold": 0.55,
            },
            {
                "rule_name": "ar_quality",
                "passed": float(components["ar_quality"]) >= 0.50,
                "value": float(components["ar_quality"]),
                "threshold": 0.50,
            },
            {
                "rule_name": "box_containment",
                "passed": float(components["containment_quality"]) >= 0.55,
                "value": float(components["containment_quality"]),
                "threshold": 0.55,
            },
            {
                "rule_name": "sos_quality",
                "passed": markup is not None and float(components["sos_quality"]) >= 0.35,
                "value": float(components["sos_quality"]),
                "threshold": 0.35,
            },
            {
                "rule_name": "backup_depth",
                "passed": pullback is not None and float(components["backup_quality"]) >= 0.45,
                "value": components["backup_depth"],
                "threshold": [0.79, 1.00],
            },
            {
                "rule_name": "rebreakout_quality",
                "passed": second_breakout is not None and float(components["rebreakout_quality"]) >= 0.35,
                "value": float(components["rebreakout_quality"]),
                "threshold": 0.35,
            },
        ])
        rules.append({
            "rule_name": "score_above_min",
            "passed": score >= score_min,
            "value": round(score, 4),
            "threshold": score_min,
        })
        if score < score_min:
            continue

        candidate_end_idx = (
            int(second_breakout["index"]) if second_breakout is not None else
            (int(pullback["low_index"]) if pullback is not None else
             (int(markup["high_index"]) if markup is not None else int(base_obj.end_index)))
        )
        visual = _build_visual(
            data,
            base_obj,
            peak_idx,
            float(peak_price),
            int(best_base.get("selling_climax_index", md_low_idx)),
            float(best_base.get("selling_climax_price", md_low_price)),
            int(best_base.get("automatic_rally_index", md_low_idx)),
            float(best_base.get("automatic_rally_price", base_obj.high)),
            markup,
            pullback,
            second_breakout,
        )
        cid = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash_short}_{peak_idx}_{candidate_end_idx}"

        candidate = {
            "candidate_id": cid,
            "id": cid,
            "strategy_version_id": strategy_version_id,
            "spec_hash": spec_hash,
            "symbol": symbol,
            "timeframe": timeframe,
            "score": round(score, 4),
            "entry_ready": second_breakout is not None,
            "rule_checklist": rules,
            "anchors": anchors,
            "window_start": peak_idx,
            "window_end": candidate_end_idx,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "chart_data": chart_data,
            "visual": visual,
            "pattern_type": emitted_pattern_type,
            "prior_peak": anchors.get("prior_peak"),
            "markdown": {
                "low_index": md_low_idx,
                "low_price": round(md_low_price, 4),
                "decline_pct": round(decline_pct, 4),
            },
            "base": asdict(base_obj),
            "first_markup": ({
                "index": int(markup["high_index"]),
                "high": round(float(markup["high"]), 4),
                "date": str(markup["high_date"]),
            } if markup is not None else None),
            "small_peak": ({
                "index": int(markup["high_index"]),
                "price": round(float(markup["high"]), 4),
                "date": str(markup["high_date"]),
            } if markup is not None else None),
            "pullback": ({
                "low_index": int(pullback["low_index"]),
                "low_price": round(float(pullback["low"]), 4),
                "retracement": round(float(pullback["retracement"]), 4),
                "retracement_pct": f"{float(pullback['retracement']) * 100:.0f}%",
                "date": str(pullback["low_date"]),
                "is_double_bottom": is_double_bottom,
            } if pullback is not None else None),
            "second_breakout": anchors.get("second_breakout"),
            "retracement_pct": round(float(pullback["retracement"]) * 100, 1) if pullback is not None else None,
            "chart_prior_peak": peak_idx,
            "chart_markdown_low": md_low_idx,
            "chart_base_start": int(base_obj.start_index),
            "chart_base_end": int(base_obj.end_index),
            "chart_first_markup": int(markup["high_index"]) if markup is not None else -1,
            "chart_markup_high": int(markup["high_index"]) if markup is not None else -1,
            "chart_pullback_low": int(pullback["low_index"]) if pullback is not None else -1,
            "chart_second_breakout": int(second_breakout["index"]) if second_breakout is not None else -1,
            "pattern_start_date": data[peak_idx].timestamp[:10] if peak_idx < n else "",
            "pattern_end_date": data[candidate_end_idx].timestamp[:10] if candidate_end_idx < n else "",
            "components": components,
            "node_result": {
                "passed": True,
                "score": round(score, 4),
                "features": {
                    "decline_pct": round(decline_pct, 4),
                    "base_duration": int(base_obj.duration),
                    "has_markup": markup is not None,
                    "has_pullback": pullback is not None,
                    "has_second_breakout": second_breakout is not None,
                    "sc_quality": float(components["sc_quality"]),
                    "ar_quality": float(components["ar_quality"]),
                    "containment_quality": float(components["containment_quality"]),
                    "sos_quality": float(components["sos_quality"]),
                    "backup_quality": float(components["backup_quality"]),
                    "rebreakout_quality": float(components["rebreakout_quality"]),
                    "inside_close_ratio": float(components["inside_close_ratio"]),
                    "top_respect_ratio": float(components["top_respect_ratio"]),
                    "floor_hold_ratio": float(components["floor_hold_ratio"]),
                    "range_tightness": float(components["range_tightness"]),
                    "box_height_pct": float(components["box_height_pct"]),
                    "backup_depth": components["backup_depth"],
                },
                "anchors": anchors,
                "reason": (
                    "Wyckoff structure found: SC -> AR box -> SOS -> backup -> second breakout"
                    if second_breakout is not None else
                    ("Wyckoff structure found: SC -> AR box -> SOS" if markup is not None else
                     "Wyckoff structure found: SC -> AR box")
                ),
            },
            "output_ports": {
                "signal": {
                    "passed": second_breakout is not None,
                    "score": round(score, 4),
                    "reason": "Second breakout confirmed" if second_breakout is not None else "Structure candidate only",
                },
                "wyckoff_structure": {
                    "pattern_type": emitted_pattern_type,
                    "has_markdown": True,
                    "has_base": True,
                    "has_markup": markup is not None,
                    "has_pullback": pullback is not None,
                    "has_second_breakout": second_breakout is not None,
                    "base_start_idx": int(base_obj.start_index),
                    "base_end_idx": int(base_obj.end_index),
                    "base_low": round(float(base_obj.low), 4),
                    "base_high": round(float(base_obj.high), 4),
                    "selling_climax_idx": int(best_base.get("selling_climax_index", md_low_idx)),
                    "automatic_rally_idx": int(best_base.get("automatic_rally_index", md_low_idx)),
                    "sc_quality": float(components["sc_quality"]),
                    "ar_quality": float(components["ar_quality"]),
                    "containment_quality": float(components["containment_quality"]),
                    "sos_quality": float(components["sos_quality"]),
                    "backup_quality": float(components["backup_quality"]),
                    "rebreakout_quality": float(components["rebreakout_quality"]),
                    "inside_close_ratio": float(components["inside_close_ratio"]),
                    "top_respect_ratio": float(components["top_respect_ratio"]),
                    "floor_hold_ratio": float(components["floor_hold_ratio"]),
                    "range_tightness": float(components["range_tightness"]),
                    "box_height_pct": float(components["box_height_pct"]),
                    "backup_depth": components["backup_depth"],
                },
            },
        }
        candidates.append(candidate)

    deduped: Dict[int, Dict[str, Any]] = {}
    for candidate in candidates:
        key = int(candidate["window_end"])
        existing = deduped.get(key)
        if existing is None or float(candidate["score"]) > float(existing["score"]):
            deduped[key] = candidate

    rows = sorted(deduped.values(), key=lambda c: float(c["score"]), reverse=True)
    print(f"[Runner] {len(candidates)} raw -> {len(rows)} deduplicated candidates", file=sys.stderr)
    return rows
