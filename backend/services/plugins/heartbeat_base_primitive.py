#!/usr/bin/env python3
"""
Heartbeat Base Primitive
========================
Statistical base/breakout detector using a baseline + pulse model:

- Base = low-volatility range with repeated ceiling/floor touches
- Breakout = statistically significant upward pulse above base ceiling
- Validity = price remains above base floor
- Entry-ready = price is near the ceiling re-test zone
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time


def _spec_hash(spec: dict) -> str:
    raw = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


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


def _stdev(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = sum(values) / len(values)
    var = sum((v - m) ** 2 for v in values) / len(values)
    return math.sqrt(var)


def _returns(window: List[OHLCV]) -> List[float]:
    out: List[float] = []
    for i in range(1, len(window)):
        prev = window[i - 1].close
        cur = window[i].close
        if prev != 0:
            out.append((cur - prev) / prev)
    return out


def _find_heartbeat_setups(
    data: List[OHLCV],
    base_lookback: int = 26,
    prior_lookback: int = 26,
    max_base_range_pct: float = 0.35,
    top_tolerance_pct: float = 0.03,
    floor_tolerance_pct: float = 0.04,
    min_top_touches: int = 3,
    min_floor_touches: int = 2,
    breakout_margin_pct: float = 0.02,
    pulse_sigma_mult: float = 2.0,
    entry_zone_pct: float = 0.40,
) -> List[Dict[str, Any]]:
    if len(data) < (base_lookback + prior_lookback + 5):
        return []

    results: List[Dict[str, Any]] = []
    last_idx = len(data) - 1
    current_close = data[last_idx].close

    # Iterate over possible base windows; base_end is inclusive.
    for base_end in range(base_lookback + prior_lookback, len(data) - 2):
        base_start = base_end - base_lookback + 1
        base_window = data[base_start : base_end + 1]
        if len(base_window) < base_lookback:
            continue

        base_ceiling = max(b.high for b in base_window)
        base_floor = min(b.low for b in base_window)
        if base_ceiling <= 0:
            continue

        base_range_pct = (base_ceiling - base_floor) / base_ceiling
        if base_range_pct > max_base_range_pct:
            continue

        top_hits = [
            i for i in range(base_start, base_end + 1)
            if data[i].high >= base_ceiling * (1.0 - top_tolerance_pct)
        ]
        floor_hits = [
            i for i in range(base_start, base_end + 1)
            if data[i].low <= base_floor * (1.0 + floor_tolerance_pct)
        ]
        if len(top_hits) < min_top_touches or len(floor_hits) < min_floor_touches:
            continue

        # Prior decline context.
        prior_start = max(0, base_start - prior_lookback)
        prior_window = data[prior_start:base_start]
        if not prior_window:
            continue
        prior_peak = max(b.high for b in prior_window)
        if prior_peak <= 0:
            continue
        decline_pct = (prior_peak - base_ceiling) / prior_peak
        if decline_pct < 0.15:
            continue

        # Find first statistically significant breakout pulse.
        breakout_level = base_ceiling * (1.0 + breakout_margin_pct)
        base_ret_std = _stdev(_returns(base_window))
        breakout_idx: Optional[int] = None
        breakout_z: float = 0.0
        for i in range(base_end + 1, len(data)):
            if data[i].close <= breakout_level:
                continue
            if i == 0 or data[i - 1].close == 0:
                continue
            br = (data[i].close - data[i - 1].close) / data[i - 1].close
            z = (br / base_ret_std) if base_ret_std > 0 else 999.0
            if z >= pulse_sigma_mult:
                breakout_idx = i
                breakout_z = z
                break
        if breakout_idx is None:
            continue

        # Must still hold above floor.
        if current_close <= base_floor:
            continue

        extension_pct = (current_close - base_ceiling) / base_ceiling
        entry_ready = current_close <= base_ceiling * (1.0 + entry_zone_pct)
        score = max(0.25, 1.0 - max(0.0, extension_pct))

        results.append({
            "base_start_idx": base_start,
            "base_end_idx": base_end,
            "base_ceiling": base_ceiling,
            "base_floor": base_floor,
            "base_range_pct": base_range_pct,
            "top_hits": top_hits,
            "floor_hits": floor_hits,
            "breakout_idx": breakout_idx,
            "breakout_z": breakout_z,
            "entry_ready": entry_ready,
            "extension_pct": extension_pct,
            "score": score,
        })

    results.sort(key=lambda r: r["breakout_idx"], reverse=True)
    return results


def _build_markers(setups: List[Dict[str, Any]], data: List[OHLCV], is_intra: bool) -> List[Dict[str, Any]]:
    markers: List[Dict[str, Any]] = []
    if not setups:
        return markers
    s = setups[0]
    for idx in s["top_hits"][:6]:
        markers.append({
            "time": _format_chart_time(data[idx].timestamp, is_intra),
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "circle",
            "text": "BT",
        })
    for idx in s["floor_hits"][:6]:
        markers.append({
            "time": _format_chart_time(data[idx].timestamp, is_intra),
            "position": "belowBar",
            "color": "#a16207",
            "shape": "circle",
            "text": "BF",
        })
    bo = s["breakout_idx"]
    markers.append({
        "time": _format_chart_time(data[bo].timestamp, is_intra),
        "position": "aboveBar",
        "color": "#22c55e",
        "shape": "arrowUp",
        "text": "BO",
    })
    return markers


def _build_overlays(setups: List[Dict[str, Any]], data: List[OHLCV], is_intra: bool) -> List[Dict[str, Any]]:
    if not setups:
        return []
    s = setups[0]
    t0 = _format_chart_time(data[s["base_start_idx"]].timestamp, is_intra)
    t1 = _format_chart_time(data[-1].timestamp, is_intra)
    return [
        {
            "type": "line",
            "color": "#f59e0b",
            "width": 2,
            "style": "dashed",
            "label": f"HB Ceiling ${s['base_ceiling']:.2f}",
            "points": [{"time": t0, "value": s["base_ceiling"]}, {"time": t1, "value": s["base_ceiling"]}],
        },
        {
            "type": "line",
            "color": "#92400e",
            "width": 1,
            "style": "dashed",
            "label": f"HB Floor ${s['base_floor']:.2f}",
            "points": [{"time": t0, "value": s["base_floor"]}, {"time": t1, "value": s["base_floor"]}],
        },
    ]


def run_heartbeat_base_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs,
) -> Any:
    cfg = spec.get("setup_config", spec.get("structure_config", {})) if isinstance(spec, dict) else {}

    base_lookback = int(cfg.get("base_lookback", 26))
    prior_lookback = int(cfg.get("prior_lookback", 26))
    max_base_range_pct = float(cfg.get("max_base_range_pct", 0.35))
    top_tolerance_pct = float(cfg.get("top_tolerance_pct", 0.03))
    floor_tolerance_pct = float(cfg.get("floor_tolerance_pct", 0.04))
    min_top_touches = int(cfg.get("min_top_touches", 3))
    min_floor_touches = int(cfg.get("min_floor_touches", 2))
    breakout_margin_pct = float(cfg.get("breakout_margin_pct", 0.02))
    pulse_sigma_mult = float(cfg.get("pulse_sigma_mult", 2.0))
    entry_zone_pct = float(cfg.get("entry_zone_pct", 0.40))

    setups = _find_heartbeat_setups(
        data=data,
        base_lookback=base_lookback,
        prior_lookback=prior_lookback,
        max_base_range_pct=max_base_range_pct,
        top_tolerance_pct=top_tolerance_pct,
        floor_tolerance_pct=floor_tolerance_pct,
        min_top_touches=min_top_touches,
        min_floor_touches=min_floor_touches,
        breakout_margin_pct=breakout_margin_pct,
        pulse_sigma_mult=pulse_sigma_mult,
        entry_zone_pct=entry_zone_pct,
    )

    if mode == "signal":
        return {s["breakout_idx"] for s in setups}

    found = len(setups) > 0
    best = setups[0] if found else None
    score = best["score"] if best else 0.0
    entry_ready = bool(best["entry_ready"]) if best else False

    is_intra = _detect_intraday(data)
    markers = _build_markers(setups, data, is_intra)
    overlays = _build_overlays(setups, data, is_intra)

    spec_hash = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    svid = spec.get("strategy_version_id", "heartbeat_base_v1") if isinstance(spec, dict) else "heartbeat_base_v1"
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
            {
                "rule_name": "heartbeat_base_detected",
                "passed": found,
                "value": f"{len(setups)} setup(s)" if found else "0 setups",
                "threshold": ">= 1",
            },
            {
                "rule_name": "price_above_base_floor",
                "passed": found and (data[-1].close > best["base_floor"] if best else False),
                "value": f"${data[-1].close:.2f} vs floor ${best['base_floor']:.2f}" if best else "N/A",
                "threshold": "close > floor",
            },
            {
                "rule_name": "entry_zone",
                "passed": entry_ready,
                "value": f"{best['extension_pct']*100:.1f}% above ceiling" if best else "N/A",
                "threshold": f"<= {entry_zone_pct*100:.0f}%",
            },
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "heartbeat_base",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": best["base_start_idx"] if best else -1,
        "chart_base_end": best["base_end_idx"] if best else -1,
        "visual": {
            "markers": markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": found,
            "score": score,
            "reason": (
                f"HB base ${best['base_ceiling']:.2f}-${best['base_floor']:.2f}, breakout z={best['breakout_z']:.2f}"
                if best else
                "No heartbeat base found"
            ),
        },
        "output_ports": {
            "heartbeat_base": {
                "count": len(setups),
                "setups": [
                    {
                        "base_start_idx": s["base_start_idx"],
                        "base_end_idx": s["base_end_idx"],
                        "base_ceiling": round(s["base_ceiling"], 4),
                        "base_floor": round(s["base_floor"], 4),
                        "base_range_pct": round(s["base_range_pct"] * 100, 2),
                        "breakout_idx": s["breakout_idx"],
                        "breakout_z": round(s["breakout_z"], 2),
                        "entry_ready": s["entry_ready"],
                    }
                    for s in setups
                ],
            }
        },
    }

    return [candidate]
