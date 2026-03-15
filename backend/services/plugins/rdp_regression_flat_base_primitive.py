#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any, Dict, List, Optional

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
            "open": b.open,
            "high": b.high,
            "low": b.low,
            "close": b.close,
            "volume": getattr(b, "volume", 0),
        }
        for b in data
    ]


def _regression_angle_deg(data: List[OHLCV], start_idx: int, end_idx: int) -> Optional[float]:
    """Return regression angle in degrees using pct slope/bar normalization."""
    if end_idx - start_idx + 1 < 3:
        return None
    seg = data[start_idx : end_idx + 1]
    y = np.array([float(b.close) for b in seg], dtype=float)
    x = np.arange(len(y), dtype=float)
    if len(y) < 3:
        return None
    slope, _ = np.polyfit(x, y, 1)
    mean_price = float(np.mean(y)) if len(y) else 0.0
    if mean_price <= 0:
        return None
    # Normalize slope by price so angle is comparable across symbols.
    pct_slope_per_bar = slope / mean_price
    return float(math.degrees(math.atan(pct_slope_per_bar)))


def _regression_channel_overlay(
    data: List[OHLCV],
    start_idx: int,
    end_idx: int,
    is_intra: bool,
    sd_mult: float = 1.0,
    extend_to_idx: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Build mean/+sd/-sd regression channel overlays for [start_idx..end_idx]."""
    if end_idx - start_idx + 1 < 3:
        return []
    fit_seg = data[start_idx : end_idx + 1]
    y_fit = np.array([float(b.close) for b in fit_seg], dtype=float)
    x_fit = np.arange(len(y_fit), dtype=float)
    draw_end = extend_to_idx if extend_to_idx is not None else end_idx
    draw_end = max(end_idx, min(draw_end, len(data) - 1))
    draw_seg = data[start_idx : draw_end + 1]
    x_draw = np.arange(len(draw_seg), dtype=float)
    if len(y_fit) < 3:
        return []

    slope, intercept = np.polyfit(x_fit, y_fit, 1)
    reg_fit = slope * x_fit + intercept
    reg_draw = slope * x_draw + intercept
    resid = y_fit - reg_fit
    sd = float(np.std(resid))

    mean_pts: List[Dict[str, Any]] = []
    up_pts: List[Dict[str, Any]] = []
    dn_pts: List[Dict[str, Any]] = []
    for i, b in enumerate(draw_seg):
        t = _format_chart_time(b.timestamp, is_intra)
        m = float(reg_draw[i])
        mean_pts.append({"time": t, "value": m})
        up_pts.append({"time": t, "value": m + sd_mult * sd})
        dn_pts.append({"time": t, "value": m - sd_mult * sd})

    return [
        {
            "type": "line",
            "color": "#06b6d4",
            "width": 3,
            "style": "solid",
            "lineWidth": 3,
            "lineStyle": 0,
            "label": "Reg Mean",
            "points": mean_pts,
            "data": mean_pts,
        },
        {
            "type": "line",
            "color": "#0ea5e9",
            "width": 2,
            "style": "dashed",
            "lineWidth": 2,
            "lineStyle": 2,
            "label": f"Reg +{sd_mult:.1f}SD",
            "points": up_pts,
            "data": up_pts,
        },
        {
            "type": "line",
            "color": "#0ea5e9",
            "width": 2,
            "style": "dashed",
            "lineWidth": 2,
            "lineStyle": 2,
            "label": f"Reg -{sd_mult:.1f}SD",
            "points": dn_pts,
            "data": dn_pts,
        },
    ]


def _build_events(
    data: List[OHLCV],
    lows: List[Any],
    min_reg_bars: int,
    flat_angle_deg: float,
) -> List[Dict[str, Any]]:
    """
    Build historical base events:
    - anchor at each RDP low
    - find first point where regression angle from anchor goes flat
    - keep event even if later broken by a lower low
    """
    events: List[Dict[str, Any]] = []
    if not lows:
        return events

    # Ensure chronological order.
    lows = sorted(lows, key=lambda sp: sp.index)

    for i, low in enumerate(lows):
        anchor_idx = int(low.index)
        anchor_price = float(low.price)

        # Find next lower low after this anchor.
        next_lower_idx: Optional[int] = None
        for j in range(i + 1, len(lows)):
            if float(lows[j].price) < anchor_price:
                next_lower_idx = int(lows[j].index)
                break

        end_limit = (next_lower_idx - 1) if next_lower_idx is not None else (len(data) - 1)
        if end_limit - anchor_idx + 1 < min_reg_bars:
            continue

        flatten_idx: Optional[int] = None
        flatten_angle: Optional[float] = None
        for t in range(anchor_idx + min_reg_bars - 1, end_limit + 1):
            ang = _regression_angle_deg(data, anchor_idx, t)
            if ang is None:
                continue
            # Flat means angle close to zero (downtrend decay into base).
            if abs(ang) <= flat_angle_deg:
                flatten_idx = t
                flatten_angle = ang
                break

        if flatten_idx is None:
            continue

        # Base zone for visualization: from anchor to flatten.
        base_start = anchor_idx
        base_end = flatten_idx
        base_floor = min(float(data[k].low) for k in range(base_start, base_end + 1))
        base_ceiling = max(float(data[k].high) for k in range(base_start, base_end + 1))

        # Active base = no lower low has occurred after flatten.
        active = True
        invalidate_idx: Optional[int] = None
        for j in range(i + 1, len(lows)):
            if int(lows[j].index) > flatten_idx and float(lows[j].price) < base_floor:
                active = False
                invalidate_idx = int(lows[j].index)
                break

        events.append({
            "anchor_idx": anchor_idx,
            "anchor_price": anchor_price,
            "flatten_idx": flatten_idx,
            "flatten_angle_deg": float(flatten_angle) if flatten_angle is not None else None,
            "base_start_idx": base_start,
            "base_end_idx": base_end,
            "base_floor": base_floor,
            "base_ceiling": base_ceiling,
            "next_lower_idx": next_lower_idx,
            "invalidate_idx": invalidate_idx,
            "active": active,
        })

    # Most recent flatten first
    events.sort(key=lambda e: e["flatten_idx"], reverse=True)
    return events


def run_rdp_regression_flat_base_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs: Any,
) -> Any:
    setup = spec.get("setup_config", {}) if isinstance(spec, dict) else {}
    epsilon_pct = float(setup.get("epsilon_pct", 0.05))
    min_reg_bars = int(setup.get("min_reg_bars", 16))
    flat_angle_deg = float(setup.get("flat_angle_deg", 0.8))
    max_marked_events = int(setup.get("max_marked_events", 3))
    channel_sd_mult = float(setup.get("channel_sd_mult", 1.0))

    if len(data) < max(40, min_reg_bars + 10):
        return [] if mode == "scan" else set()

    swings = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    lows = [sp for sp in swings.swing_points if sp.point_type == "LOW"]
    events = _build_events(data, lows, min_reg_bars=min_reg_bars, flat_angle_deg=flat_angle_deg)

    if mode == "signal":
        return {e["flatten_idx"] for e in events if e["active"]}

    found = len(events) > 0
    active_events = [e for e in events if e["active"]]
    best = active_events[0] if active_events else (events[0] if found else None)
    entry_ready = bool(best and best["active"])

    markers: List[Dict[str, Any]] = []
    overlays: List[Dict[str, Any]] = []
    is_intra = _detect_intraday(data)

    if found:
        for idx, e in enumerate(events[:max_marked_events]):
            # Anchor low marker
            markers.append({
                "time": _format_chart_time(data[e["anchor_idx"]].timestamp, is_intra),
                "position": "belowBar",
                "color": "#f59e0b",
                "shape": "circle",
                "text": "RDP L",
            })
            # Flat confirmation marker
            markers.append({
                "time": _format_chart_time(data[e["flatten_idx"]].timestamp, is_intra),
                "position": "aboveBar",
                "color": "#22c55e" if e["active"] else "#9ca3af",
                "shape": "arrowUp",
                "text": f"FLAT {e['flatten_angle_deg']:+.2f}deg",
            })
            # Invalidation marker if later broken
            if e["invalidate_idx"] is not None:
                markers.append({
                    "time": _format_chart_time(data[e["invalidate_idx"]].timestamp, is_intra),
                    "position": "belowBar",
                    "color": "#ef4444",
                    "shape": "arrowDown",
                    "text": "NEW LOW",
                })

            t0 = _format_chart_time(data[e["base_start_idx"]].timestamp, is_intra)
            t1 = _format_chart_time(data[-1].timestamp, is_intra)
            # Horizontal base lines (BT/BF style).
            bt_pts = [{"time": t0, "value": e["base_ceiling"]}, {"time": t1, "value": e["base_ceiling"]}]
            bf_pts = [{"time": t0, "value": e["base_floor"]}, {"time": t1, "value": e["base_floor"]}]
            overlays.append({
                "type": "line",
                "color": "#f59e0b",
                "lineWidth": 1,
                "lineStyle": 0,
                "label": f"BT ${e['base_ceiling']:.2f}",
                "points": bt_pts,
                "data": bt_pts,
            })
            overlays.append({
                "type": "line",
                "color": "#92400e",
                "lineWidth": 1,
                "lineStyle": 0,
                "label": f"BF ${e['base_floor']:.2f}",
                "points": bf_pts,
                "data": bf_pts,
            })

    score = 1.0 if (best and best["active"]) else (0.6 if found else 0.0)

    spec_hash = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    svid = spec.get("strategy_version_id", "rdp_reg_flat_base_v1") if isinstance(spec, dict) else "rdp_reg_flat_base_v1"
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
                "rule_name": "rdp_lows_found",
                "passed": len(lows) > 0,
                "value": len(lows),
                "threshold": ">= 1",
            },
            {
                "rule_name": "flat_base_events_found",
                "passed": found,
                "value": len(events),
                "threshold": ">= 1",
            },
            {
                "rule_name": "active_flat_base_exists",
                "passed": len(active_events) > 0,
                "value": len(active_events),
                "threshold": ">= 1",
            },
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "rdp_regression_flat_base",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": -1,
        "chart_base_end": -1,
        "visual": {
            "markers": markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": len(active_events) > 0,
            "score": score,
            "reason": (
                f"Active flat base from RDP low @ {best['anchor_idx']} (angle {best['flatten_angle_deg']:+.2f}deg)"
                if best and best["active"]
                else (f"{len(events)} historical flat base(s) found, none active" if found else "No flat base found")
            ),
        },
        "output_ports": {
            "rdp_flat_base": {
                "count": len(events),
                "active_count": len(active_events),
                "events": [
                    {
                        "anchor_idx": e["anchor_idx"],
                        "anchor_price": round(e["anchor_price"], 4),
                        "flatten_idx": e["flatten_idx"],
                        "flatten_angle_deg": round(e["flatten_angle_deg"], 4) if e["flatten_angle_deg"] is not None else None,
                        "base_start_idx": e["base_start_idx"],
                        "base_end_idx": e["base_end_idx"],
                        "base_floor": round(e["base_floor"], 4),
                        "base_ceiling": round(e["base_ceiling"], 4),
                        "active": e["active"],
                        "invalidate_idx": e["invalidate_idx"],
                    }
                    for e in events
                ],
            }
        },
    }
    return [candidate]

