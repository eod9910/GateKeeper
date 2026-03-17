#!/usr/bin/env python3
"""
Base Box Break+Retest Primitive
===============================
Very simple deterministic base detector (no RDP):

1) Build a rolling box from prior N bars (ceiling/floor)
2) Require repeated touches of ceiling and floor
3) Require breakout above ceiling by margin
4) Require price still above floor
5) Prefer setups where current price is retesting near the ceiling
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Set

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


def _parse_lookbacks(raw: Any, fallback: int = 30) -> List[int]:
    """
    Parse lookbacks from:
      - comma-separated string: "30,60,90,120,180"
      - list/tuple: [30, 60, 90]
      - single int/float
    """
    out: List[int] = []
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.split(",")]
        for p in parts:
            if not p:
                continue
            try:
                v = int(float(p))
                if v > 0:
                    out.append(v)
            except Exception:
                continue
    elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        for item in raw:
            try:
                v = int(float(item))
                if v > 0:
                    out.append(v)
            except Exception:
                continue
    else:
        try:
            v = int(float(raw))
            if v > 0:
                out.append(v)
        except Exception:
            pass

    if not out:
        out = [fallback]
    # unique + sorted
    return sorted(set(out))


def _find_setups(
    data: List[OHLCV],
    base_lookbacks: List[int],
    prior_lookback: int = 30,
    max_base_range_pct: float = 0.45,
    top_tolerance_pct: float = 0.03,
    floor_tolerance_pct: float = 0.05,
    min_top_touches: int = 2,
    min_floor_touches: int = 2,
    breakout_margin_pct: float = 0.02,
    min_hold_bars_after_breakout: int = 2,
    entry_zone_pct: float = 0.35,
) -> List[Dict[str, Any]]:
    if not base_lookbacks:
        return []
    if len(data) < (min(base_lookbacks) + prior_lookback + 5):
        return []

    out: List[Dict[str, Any]] = []
    last_idx = len(data) - 1
    current_close = data[-1].close

    # Evaluate each lookback and collect candidates
    for base_lookback in base_lookbacks:
        if len(data) < (base_lookback + prior_lookback + 5):
            continue
        for base_end in range(base_lookback + prior_lookback, len(data) - 3):
            base_start = base_end - base_lookback + 1
            box = data[base_start : base_end + 1]
            if len(box) < base_lookback:
                continue

            ceiling = max(b.high for b in box)
            floor = min(b.low for b in box)
            if ceiling <= 0:
                continue

            base_range_pct = (ceiling - floor) / ceiling
            if base_range_pct > max_base_range_pct:
                continue

            top_hits = [
                i for i in range(base_start, base_end + 1)
                if data[i].high >= ceiling * (1.0 - top_tolerance_pct)
            ]
            floor_hits = [
                i for i in range(base_start, base_end + 1)
                if data[i].low <= floor * (1.0 + floor_tolerance_pct)
            ]
            if len(top_hits) < min_top_touches or len(floor_hits) < min_floor_touches:
                continue

            # Prior decline context.
            prior_start = max(0, base_start - prior_lookback)
            prior = data[prior_start:base_start]
            if not prior:
                continue
            prior_peak = max(b.high for b in prior)
            decline_pct = (prior_peak - ceiling) / prior_peak if prior_peak > 0 else 0.0
            if decline_pct < 0.10:
                continue

            breakout_level = ceiling * (1.0 + breakout_margin_pct)
            breakout_idx: Optional[int] = None
            for i in range(base_end + 1, len(data)):
                if data[i].close > breakout_level:
                    breakout_idx = i
                    break
            if breakout_idx is None:
                continue

            # Hold-above-floor rule: after breakout, no close below floor.
            violated = any(data[i].close <= floor for i in range(breakout_idx, len(data)))
            if violated:
                continue

            # Require at least a couple bars since breakout to avoid one-bar spikes.
            if (last_idx - breakout_idx) < min_hold_bars_after_breakout:
                continue

            extension_pct = (current_close - ceiling) / ceiling
            entry_ready = floor < current_close <= ceiling * (1.0 + entry_zone_pct)
            # Slight bonus to longer bases; they are usually more meaningful.
            length_bonus = min(0.25, base_lookback / 240.0)
            score = max(0.20, 1.0 - max(0.0, extension_pct)) + length_bonus

            out.append({
                "base_lookback": base_lookback,
                "base_start_idx": base_start,
                "base_end_idx": base_end,
                "ceiling": ceiling,
                "floor": floor,
                "base_range_pct": base_range_pct,
                "top_hits": top_hits,
                "floor_hits": floor_hits,
                "breakout_idx": breakout_idx,
                "entry_ready": entry_ready,
                "extension_pct": extension_pct,
                "score": score,
            })

    # De-duplicate heavily overlapping boxes; keep best score per overlap cluster.
    out.sort(key=lambda s: s["score"], reverse=True)
    kept: List[Dict[str, Any]] = []
    for s in out:
        overlap = False
        for k in kept:
            ov_start = max(s["base_start_idx"], k["base_start_idx"])
            ov_end = min(s["base_end_idx"], k["base_end_idx"])
            if ov_end > ov_start:
                span = max(1, s["base_end_idx"] - s["base_start_idx"])
                if (ov_end - ov_start) / span >= 0.60:
                    overlap = True
                    break
        if not overlap:
            kept.append(s)

    kept.sort(key=lambda s: s["breakout_idx"], reverse=True)
    return kept


def _markers(setup: Dict[str, Any], data: List[OHLCV], is_intra: bool) -> List[Dict[str, Any]]:
    m: List[Dict[str, Any]] = []
    for idx in setup["top_hits"][:8]:
        m.append({
            "time": _format_chart_time(data[idx].timestamp, is_intra),
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "circle",
            "text": "BT",
        })
    for idx in setup["floor_hits"][:8]:
        m.append({
            "time": _format_chart_time(data[idx].timestamp, is_intra),
            "position": "belowBar",
            "color": "#92400e",
            "shape": "circle",
            "text": "BF",
        })
    bo = setup["breakout_idx"]
    m.append({
        "time": _format_chart_time(data[bo].timestamp, is_intra),
        "position": "aboveBar",
        "color": "#22c55e",
        "shape": "arrowUp",
        "text": "BO",
    })
    return m


def _overlays(setup: Dict[str, Any], data: List[OHLCV], is_intra: bool) -> List[Dict[str, Any]]:
    t0 = _format_chart_time(data[setup["base_start_idx"]].timestamp, is_intra)
    t1 = _format_chart_time(data[-1].timestamp, is_intra)
    last_bt_idx = setup["top_hits"][-1] if setup["top_hits"] else setup["base_end_idx"]
    last_bf_idx = setup["floor_hits"][-1] if setup["floor_hits"] else setup["base_end_idx"]
    bt_level = data[last_bt_idx].high
    bf_level = data[last_bf_idx].low
    return [
        {
            "type": "line",
            "color": "#f59e0b",
            "width": 2,
            "style": "dashed",
            "label": f"Box Ceiling ${setup['ceiling']:.2f}",
            "points": [{"time": t0, "value": setup["ceiling"]}, {"time": t1, "value": setup["ceiling"]}],
        },
        {
            "type": "line",
            "color": "#92400e",
            "width": 1,
            "style": "dashed",
            "label": f"Box Floor ${setup['floor']:.2f}",
            "points": [{"time": t0, "value": setup["floor"]}, {"time": t1, "value": setup["floor"]}],
        },
        {
            "type": "line",
            "color": "#fbbf24",
            "width": 1,
            "style": "solid",
            "label": f"BT Level ${bt_level:.2f}",
            "points": [{"time": t0, "value": bt_level}, {"time": t1, "value": bt_level}],
        },
        {
            "type": "line",
            "color": "#a16207",
            "width": 1,
            "style": "solid",
            "label": f"BF Level ${bf_level:.2f}",
            "points": [{"time": t0, "value": bf_level}, {"time": t1, "value": bf_level}],
        },
    ]


def run_base_box_retest_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs,
) -> Any:
    cfg = spec.get("setup_config", spec.get("structure_config", {})) if isinstance(spec, dict) else {}

    base_lookbacks = _parse_lookbacks(
        cfg.get("base_lookbacks", cfg.get("base_lookback", "30,60,90,120,180")),
        fallback=int(cfg.get("base_lookback", 30)),
    )

    setups = _find_setups(
        data=data,
        base_lookbacks=base_lookbacks,
        prior_lookback=int(cfg.get("prior_lookback", 30)),
        max_base_range_pct=float(cfg.get("max_base_range_pct", 0.45)),
        top_tolerance_pct=float(cfg.get("top_tolerance_pct", 0.03)),
        floor_tolerance_pct=float(cfg.get("floor_tolerance_pct", 0.05)),
        min_top_touches=int(cfg.get("min_top_touches", 2)),
        min_floor_touches=int(cfg.get("min_floor_touches", 2)),
        breakout_margin_pct=float(cfg.get("breakout_margin_pct", 0.02)),
        min_hold_bars_after_breakout=int(cfg.get("min_hold_bars_after_breakout", 2)),
        entry_zone_pct=float(cfg.get("entry_zone_pct", 0.35)),
    )

    if mode == "signal":
        return {s["breakout_idx"] for s in setups}

    found = len(setups) > 0
    best = setups[0] if found else None
    score = best["score"] if best else 0.0
    entry_ready = bool(best["entry_ready"]) if best else False

    is_intra = _detect_intraday(data)
    markers = _markers(best, data, is_intra) if best else []
    overlays = _overlays(best, data, is_intra) if best else []

    spec_hash = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    svid = spec.get("strategy_version_id", "base_box_retest_v1") if isinstance(spec, dict) else "base_box_retest_v1"
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
                "rule_name": "base_box_detected",
                "passed": found,
                "value": (f"{len(setups)} setup(s), best L={best['base_lookback']}" if best else "0"),
                "threshold": ">= 1",
            },
            {
                "rule_name": "hold_above_floor",
                "passed": found and (data[-1].close > best["floor"] if best else False),
                "value": f"${data[-1].close:.2f} vs ${best['floor']:.2f}" if best else "N/A",
                "threshold": "close > floor",
            },
            {
                "rule_name": "entry_zone",
                "passed": entry_ready,
                "value": f"{best['extension_pct']*100:.1f}% above ceiling" if best else "N/A",
                "threshold": "<= entry zone",
            },
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "base_box_retest",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": best["base_start_idx"] if best else -1,
        "chart_base_end": best["base_end_idx"] if best else -1,
        "visual": {"markers": markers, "overlay_series": overlays},
        "node_result": {
            "passed": found,
            "score": score,
            "reason": (
                f"Base box L={best['base_lookback']} ${best['ceiling']:.2f}-${best['floor']:.2f}, breakout+hold valid"
                if best else
                "No base-box breakout setup"
            ),
        },
        "output_ports": {
            "base_box_retest": {
                "count": len(setups),
                "setups": [
                    {
                        "base_start_idx": s["base_start_idx"],
                        "base_end_idx": s["base_end_idx"],
                        "base_lookback": s["base_lookback"],
                        "ceiling": round(s["ceiling"], 4),
                        "floor": round(s["floor"], 4),
                        "base_range_pct": round(s["base_range_pct"] * 100, 2),
                        "breakout_idx": s["breakout_idx"],
                        "entry_ready": s["entry_ready"],
                    }
                    for s in setups
                ],
            }
        },
    }

    return [candidate]

