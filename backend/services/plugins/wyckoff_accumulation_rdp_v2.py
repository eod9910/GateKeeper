#!/usr/bin/env python3
"""Wyckoff Accumulation (Major Peaks) V2

State-machine-based accumulation detector:
  - Box defined by SC (bottom) and AR (top)
  - Bar-by-bar regime tracking: ACCUMULATING -> BREAKOUT_TESTING -> CONFIRMED / FAILED
  - Failed breakouts logged and base extended until real confirmed breakout
  - Relaxed entry gates: min_markdown_pct 0.25, min_prominence 0.12
"""
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
    confirmed_breakout: Optional[Dict[str, Any]],
    failed_breakouts: List[Dict[str, Any]],
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

    sc_quality = (0.65 * _score_band(decline_pct, 0.20, 0.60)) + (0.35 * _score_band(box_height_pct, 0.08, 0.35))
    ar_quality = (0.60 * _score_band(box_height_pct, 0.08, 0.30)) + (0.40 * (1.0 - _score_band(ar_response_bars, 12, 40)))
    containment_quality = (
        0.45 * containment["inside_close_ratio"]
        + 0.25 * containment["top_respect_ratio"]
        + 0.20 * containment["floor_hold_ratio"]
        + 0.10 * containment["range_tightness"]
    )

    breakout_quality = 0.0
    if confirmed_breakout is not None:
        breakout_gain = (float(confirmed_breakout["price"]) - float(base_obj.high)) / max(float(base_obj.high), 1e-9)
        breakout_quality = _score_band(breakout_gain, 0.01, 0.15)

    failed_sos_bonus = _clamp01(len(failed_breakouts) * 0.15)

    duration_quality = _score_band(int(base_obj.duration), 20, 120)
    weighted_score = (
        0.14 * sc_quality
        + 0.14 * ar_quality
        + 0.28 * containment_quality
        + 0.18 * breakout_quality
        + 0.08 * failed_sos_bonus
    )
    score = min(1.0, weighted_score + (0.10 * duration_quality))

    return {
        "score": round(score, 4),
        "sc_quality": round(sc_quality, 4),
        "ar_quality": round(ar_quality, 4),
        "containment_quality": round(containment_quality, 4),
        "breakout_quality": round(breakout_quality, 4),
        "failed_sos_count": len(failed_breakouts),
        "failed_sos_bonus": round(failed_sos_bonus, 4),
        "duration_quality": round(duration_quality, 4),
        "inside_close_ratio": round(containment["inside_close_ratio"], 4),
        "top_respect_ratio": round(containment["top_respect_ratio"], 4),
        "floor_hold_ratio": round(containment["floor_hold_ratio"], 4),
        "range_tightness": round(containment["range_tightness"], 4),
        "box_height_pct": round(box_height_pct, 4),
        "ar_response_bars": int(ar_response_bars),
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
    failed_breakouts: List[Dict[str, Any]],
    confirmed_breakout: Optional[Dict[str, Any]],
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
            "text": f"SC {sc_price:.2f}",
        },
        {
            "time": t(ar_idx),
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "arrowDown",
            "text": f"AR {ar_price:.2f}",
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
            "text": f"BASE END",
        },
    ]

    for i, fb in enumerate(failed_breakouts):
        markers.append({
            "time": t(int(fb["peak_idx"])),
            "position": "aboveBar",
            "color": "#ef4444",
            "shape": "arrowDown",
            "text": f"FAILED SOS #{i+1} {float(fb['peak_price']):.2f}",
        })
        markers.append({
            "time": t(int(fb["return_idx"])),
            "position": "belowBar",
            "color": "#ef4444",
            "shape": "arrowUp",
            "text": f"RE-ENTRY {float(fb['return_price']):.2f}",
        })

    if confirmed_breakout is not None:
        markers.append({
            "time": t(int(confirmed_breakout["index"])),
            "position": "aboveBar",
            "color": "#3b82f6",
            "shape": "arrowUp",
            "text": f"CONFIRMED BREAKOUT {float(confirmed_breakout['price']):.2f}",
        })

    left_time = t(int(base_obj.start_index))
    right_idx = int(confirmed_breakout["index"]) if confirmed_breakout is not None else int(base_obj.end_index)
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


def _find_base_state_machine(
    data: List[OHLCV],
    markdown_low_idx: int,
    min_base_dur: int,
    confirm_bars: int,
    max_base_bars: int,
) -> Optional[Dict[str, Any]]:
    """State machine base finder.

    States:
      ACCUMULATING      - price is inside the box [sc_low, ar_high]
      BREAKOUT_TESTING  - close went above box top, counting confirmation bars
      CONFIRMED         - N consecutive closes above box top -> base is done
      FAILED            - price returned below box top during testing -> back to ACCUMULATING
      BREAKDOWN         - close went below box bottom by >5% -> accumulation failed
    """
    n = len(data)
    if n - markdown_low_idx < 30:
        return None

    sc_idx = markdown_low_idx
    sc_price = float(data[markdown_low_idx].low)

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

    box_top = ar_price
    box_bottom = sc_price
    box_height = box_top - box_bottom
    if box_height <= 0:
        return None

    breakdown_level = box_bottom - (0.05 * box_height)
    confirm_needed = max(2, int(confirm_bars))

    state = "ACCUMULATING"
    consecutive_above = 0
    breakout_test_start_idx: Optional[int] = None
    breakout_test_peak_idx: Optional[int] = None
    breakout_test_peak_price = 0.0

    failed_breakouts: List[Dict[str, Any]] = []
    confirmed_breakout: Optional[Dict[str, Any]] = None
    base_end_idx: Optional[int] = None

    scan_start = max(ar_idx + 4, markdown_low_idx + 10)
    scan_end = min(markdown_low_idx + max_base_bars, n)

    for i in range(scan_start, scan_end):
        close = float(data[i].close)
        high = float(data[i].high)
        low = float(data[i].low)

        if state == "ACCUMULATING":
            if close > box_top:
                state = "BREAKOUT_TESTING"
                consecutive_above = 1
                breakout_test_start_idx = i
                breakout_test_peak_idx = i
                breakout_test_peak_price = high
            elif close < breakdown_level:
                break

        elif state == "BREAKOUT_TESTING":
            if high > breakout_test_peak_price:
                breakout_test_peak_idx = i
                breakout_test_peak_price = high

            if close > box_top:
                consecutive_above += 1
                if consecutive_above >= confirm_needed:
                    confirmed_breakout = {
                        "index": breakout_test_start_idx,
                        "price": float(data[breakout_test_start_idx].close),
                        "date": data[breakout_test_start_idx].timestamp[:10],
                        "peak_idx": breakout_test_peak_idx,
                        "peak_price": breakout_test_peak_price,
                        "confirm_bars_held": consecutive_above,
                    }
                    base_end_idx = breakout_test_start_idx - 1
                    break
            else:
                failed_breakouts.append({
                    "peak_idx": breakout_test_peak_idx,
                    "peak_price": breakout_test_peak_price,
                    "test_start_idx": breakout_test_start_idx,
                    "return_idx": i,
                    "return_price": close,
                    "bars_above": consecutive_above,
                })
                state = "ACCUMULATING"
                consecutive_above = 0
                breakout_test_start_idx = None
                breakout_test_peak_idx = None
                breakout_test_peak_price = 0.0

    if base_end_idx is None:
        base_end_idx = min(scan_end - 1, n - 1)

    duration = base_end_idx - sc_idx + 1
    if duration < max(20, int(min_base_dur)):
        return None

    return {
        "start_index": sc_idx,
        "end_index": base_end_idx,
        "high": box_top,
        "low": box_bottom,
        "height": box_height,
        "duration": duration,
        "selling_climax_index": sc_idx,
        "selling_climax_price": sc_price,
        "automatic_rally_index": ar_idx,
        "automatic_rally_price": ar_price,
        "start_date": data[sc_idx].timestamp[:10] if sc_idx < n else "",
        "end_date": data[base_end_idx].timestamp[:10] if base_end_idx < n else "",
        "failed_breakouts": failed_breakouts,
        "confirmed_breakout": confirmed_breakout,
    }


def run_wyckoff_plugin_v2(
    data: List[OHLCV],
    structure: "StructureExtraction",
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

    min_prominence = float(setup.get("min_prominence", 0.12))
    peak_lookback = int(setup.get("peak_lookback", 50))
    min_markdown_pct = float(setup.get("min_markdown_pct", 0.25))
    markdown_lookback = int(setup.get("markdown_lookback", 300))
    base_min_dur = int(struct_cfg.get("base_min_duration", 20))
    max_base_bars = int(setup.get("max_base_bars", 500))
    confirm_bars = int(setup.get("breakout_confirm_bars", 5))
    score_min = float(setup.get("score_min", 0.20))
    emitted_pattern_type = str(
        setup.get("pattern_type")
        or spec.get("pattern_type")
        or spec.get("strategy_id")
        or "wyckoff_accumulation_major_v2"
    ).strip() or "wyckoff_accumulation_major_v2"

    n = len(data)
    if n < 120:
        return []

    chart_data = _build_chart_data(data)
    candidates: List[Dict[str, Any]] = []

    peaks = find_major_peaks(data, min_prominence=min_prominence, lookback=peak_lookback)
    print(f"[Runner V2] Found {len(peaks)} peaks (prominence >= {min_prominence})", file=sys.stderr)

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

        result = _find_base_state_machine(data, md_low_idx, base_min_dur, confirm_bars, max_base_bars)

        rules.append({
            "rule_name": "base_found",
            "passed": result is not None,
            "value": int(result["duration"]) if result is not None else 0,
            "threshold": base_min_dur,
        })
        if result is None:
            continue

        failed_breakouts = result["failed_breakouts"]
        confirmed_breakout = result["confirmed_breakout"]

        base_obj = Base(
            start_index=int(result["start_index"]),
            end_index=int(result["end_index"]),
            low=float(result["low"]),
            high=float(result["high"]),
            height=float(result["height"]),
            duration=int(result["duration"]),
            start_date=str(result.get("start_date", "")),
            end_date=str(result.get("end_date", "")),
        )
        rules.append({
            "rule_name": "base_duration",
            "passed": int(base_obj.duration) >= base_min_dur,
            "value": int(base_obj.duration),
            "threshold": base_min_dur,
        })
        rules.append({
            "rule_name": "confirmed_breakout",
            "passed": confirmed_breakout is not None,
            "value": round(float(confirmed_breakout["price"]), 4) if confirmed_breakout is not None else None,
            "threshold": round(float(base_obj.high), 4),
        })
        if confirmed_breakout is None:
            continue
        rules.append({
            "rule_name": "failed_breakout_count",
            "passed": True,
            "value": len(failed_breakouts),
            "threshold": 0,
        })

        sc_idx = int(result["selling_climax_index"])
        ar_idx = int(result["automatic_rally_index"])

        anchors["selling_climax"] = {
            "index": sc_idx,
            "price": round(float(result["selling_climax_price"]), 4),
            "date": data[sc_idx].timestamp[:10],
        }
        anchors["automatic_rally"] = {
            "index": ar_idx,
            "price": round(float(result["automatic_rally_price"]), 4),
            "date": data[ar_idx].timestamp[:10],
        }
        anchors["base_start"] = {"index": int(base_obj.start_index), "price": round(float(base_obj.low), 4), "date": str(result.get("start_date", ""))}
        anchors["base_end"] = {"index": int(base_obj.end_index), "price": round(float(base_obj.high), 4), "date": str(result.get("end_date", ""))}
        anchors["base_low"] = round(float(base_obj.low), 4)
        anchors["base_high"] = round(float(base_obj.high), 4)

        if confirmed_breakout is not None:
            anchors["confirmed_breakout"] = {
                "index": int(confirmed_breakout["index"]),
                "price": round(float(confirmed_breakout["price"]), 4),
                "date": str(confirmed_breakout["date"]),
            }

        for i, fb in enumerate(failed_breakouts):
            anchors[f"failed_sos_{i+1}"] = {
                "peak_idx": int(fb["peak_idx"]),
                "peak_price": round(float(fb["peak_price"]), 4),
                "return_idx": int(fb["return_idx"]),
                "return_price": round(float(fb["return_price"]), 4),
                "bars_above": int(fb["bars_above"]),
            }

        components = _score_wyckoff_components(
            data,
            decline_pct,
            base_obj,
            ar_idx,
            confirmed_breakout,
            failed_breakouts,
        )
        score = float(components["score"])

        rules.extend([
            {
                "rule_name": "sc_quality",
                "passed": float(components["sc_quality"]) >= 0.40,
                "value": float(components["sc_quality"]),
                "threshold": 0.40,
            },
            {
                "rule_name": "ar_quality",
                "passed": float(components["ar_quality"]) >= 0.40,
                "value": float(components["ar_quality"]),
                "threshold": 0.40,
            },
            {
                "rule_name": "box_containment",
                "passed": float(components["containment_quality"]) >= 0.50,
                "value": float(components["containment_quality"]),
                "threshold": 0.50,
            },
            {
                "rule_name": "breakout_quality",
                "passed": confirmed_breakout is not None and float(components["breakout_quality"]) >= 0.20,
                "value": float(components["breakout_quality"]),
                "threshold": 0.20,
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
            int(confirmed_breakout["index"]) if confirmed_breakout is not None
            else int(base_obj.end_index)
        )

        visual = _build_visual(
            data,
            base_obj,
            peak_idx,
            float(peak_price),
            sc_idx,
            float(result["selling_climax_price"]),
            ar_idx,
            float(result["automatic_rally_price"]),
            failed_breakouts,
            confirmed_breakout,
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
            "entry_ready": confirmed_breakout is not None,
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
            "confirmed_breakout": ({
                "index": int(confirmed_breakout["index"]),
                "price": round(float(confirmed_breakout["price"]), 4),
                "date": str(confirmed_breakout["date"]),
                "confirm_bars_held": int(confirmed_breakout["confirm_bars_held"]),
            } if confirmed_breakout is not None else None),
            "failed_breakouts": [
                {
                    "peak_idx": int(fb["peak_idx"]),
                    "peak_price": round(float(fb["peak_price"]), 4),
                    "return_idx": int(fb["return_idx"]),
                    "return_price": round(float(fb["return_price"]), 4),
                    "bars_above": int(fb["bars_above"]),
                }
                for fb in failed_breakouts
            ],
            "chart_prior_peak": peak_idx,
            "chart_markdown_low": md_low_idx,
            "chart_base_start": int(base_obj.start_index),
            "chart_base_end": int(base_obj.end_index),
            "chart_confirmed_breakout": int(confirmed_breakout["index"]) if confirmed_breakout is not None else -1,
            "pattern_start_date": data[peak_idx].timestamp[:10] if peak_idx < n else "",
            "pattern_end_date": data[candidate_end_idx].timestamp[:10] if candidate_end_idx < n else "",
            "components": components,
            "node_result": {
                "passed": True,
                "score": round(score, 4),
                "features": {
                    "decline_pct": round(decline_pct, 4),
                    "base_duration": int(base_obj.duration),
                    "has_confirmed_breakout": confirmed_breakout is not None,
                    "failed_sos_count": len(failed_breakouts),
                    "sc_quality": float(components["sc_quality"]),
                    "ar_quality": float(components["ar_quality"]),
                    "containment_quality": float(components["containment_quality"]),
                    "breakout_quality": float(components["breakout_quality"]),
                    "inside_close_ratio": float(components["inside_close_ratio"]),
                    "top_respect_ratio": float(components["top_respect_ratio"]),
                    "floor_hold_ratio": float(components["floor_hold_ratio"]),
                    "range_tightness": float(components["range_tightness"]),
                    "box_height_pct": float(components["box_height_pct"]),
                },
                "anchors": anchors,
                "reason": (
                    f"Wyckoff accumulation: SC -> AR -> {len(failed_breakouts)} failed SOS -> confirmed breakout"
                    if confirmed_breakout is not None else
                    f"Wyckoff accumulation: SC -> AR -> {len(failed_breakouts)} failed SOS (still accumulating)"
                ),
            },
            "output_ports": {
                "signal": {
                    "passed": confirmed_breakout is not None,
                    "score": round(score, 4),
                    "reason": (
                        f"Confirmed breakout after {len(failed_breakouts)} failed attempts"
                        if confirmed_breakout is not None
                        else f"Still accumulating with {len(failed_breakouts)} failed SOS"
                    ),
                },
                "wyckoff_structure": {
                    "pattern_type": emitted_pattern_type,
                    "has_markdown": True,
                    "has_base": True,
                    "has_confirmed_breakout": confirmed_breakout is not None,
                    "failed_sos_count": len(failed_breakouts),
                    "base_start_idx": int(base_obj.start_index),
                    "base_end_idx": int(base_obj.end_index),
                    "base_low": round(float(base_obj.low), 4),
                    "base_high": round(float(base_obj.high), 4),
                    "selling_climax_idx": sc_idx,
                    "automatic_rally_idx": ar_idx,
                    "sc_quality": float(components["sc_quality"]),
                    "ar_quality": float(components["ar_quality"]),
                    "containment_quality": float(components["containment_quality"]),
                    "breakout_quality": float(components["breakout_quality"]),
                    "inside_close_ratio": float(components["inside_close_ratio"]),
                    "top_respect_ratio": float(components["top_respect_ratio"]),
                    "floor_hold_ratio": float(components["floor_hold_ratio"]),
                    "range_tightness": float(components["range_tightness"]),
                    "box_height_pct": float(components["box_height_pct"]),
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
    print(f"[Runner V2] {len(candidates)} raw -> {len(rows)} deduplicated candidates", file=sys.stderr)
    return rows
