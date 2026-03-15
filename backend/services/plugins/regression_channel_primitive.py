#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, sys
import numpy as np
from datetime import datetime
from typing import Any, Dict, List
from platform_sdk.ohlcv import OHLCV
from platform_sdk.rdp import detect_swings_rdp


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


def _is_intraday(timeframe: str) -> bool:
    return timeframe in ("1m", "5m", "15m", "30m", "1h", "4h")


def _build_chart_data(data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    chart_data = []
    for bar in data:
        ts = bar.timestamp
        if not ts:
            continue
        if is_intraday:
            if isinstance(ts, (int, float)):
                time_val: Any = int(ts)
            elif isinstance(ts, str):
                try:
                    from datetime import datetime as dt
                    d = dt.strptime(ts[:19], "%Y-%m-%d %H:%M:%S")
                    time_val = int(d.timestamp())
                except Exception:
                    time_val = ts[:10]
            else:
                time_val = ts[:10]
        else:
            time_val = ts[:10] if isinstance(ts, str) else str(ts)[:10]
        chart_data.append({
            "time": time_val,
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
        })
    return chart_data


def _format_time_str(bar) -> str:
    ts = bar.timestamp
    if isinstance(ts, str):
        return ts[:10]
    if isinstance(ts, (int, float)):
        from datetime import datetime as dt
        return dt.utcfromtimestamp(ts).strftime("%Y-%m-%d")
    return str(ts)[:10]


def run_regression_channel_primitive_plugin(
    data: List[OHLCV], structure: Any, spec: Dict[str, Any],
    symbol: str, timeframe: str, **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Regression channel anchored at the absolute low from RDP swing detection.

    1. Run RDP to find swing lows
    2. Anchor at the lowest swing low (absolute low of the trend)
    3. Fit linear regression through closes from anchor to current bar
    4. Calculate standard deviation bands
    5. Report current SD position and draw overlays
    """
    setup = spec.get("setup_config", {}) or {}
    epsilon_pct = float(setup.get("epsilon_pct", 0.05))
    anchor_mode = setup.get("anchor_mode", "absolute_low")

    if len(data) < 50:
        print(f"[RegChannel] Not enough data: {len(data)} bars", file=sys.stderr)
        return []

    # Step 1: Find swing lows via RDP
    swing_struct = detect_swings_rdp(data, symbol, timeframe, epsilon_pct)
    swing_lows = [sp for sp in swing_struct.swing_points if sp.point_type == 'LOW']

    if not swing_lows:
        print(f"[RegChannel] No swing lows found for {symbol}", file=sys.stderr)
        return []

    # Step 2: Find the anchor point
    if anchor_mode == "most_recent_low":
        anchor_sp = swing_lows[-1]
    else:
        anchor_sp = min(swing_lows, key=lambda sp: sp.price)

    anchor_idx = anchor_sp.index
    anchor_price = anchor_sp.price
    anchor_date = anchor_sp.date
    print(f"[RegChannel] Anchor: ${anchor_price:.2f} at {anchor_date} (bar {anchor_idx})", file=sys.stderr)

    # Step 3: Fit linear regression from anchor to end
    segment = data[anchor_idx:]
    n = len(segment)
    if n < 20:
        print(f"[RegChannel] Not enough bars from anchor: {n}", file=sys.stderr)
        return []

    closes = np.array([float(bar.close) for bar in segment])
    x = np.arange(n, dtype=float)

    # Linear regression: y = slope * x + intercept
    _slope, _intercept = np.polyfit(x, closes, 1)
    slope = float(_slope)
    intercept = float(_intercept)
    reg_line = _slope * x + _intercept
    residuals = closes - reg_line
    std_dev = float(np.std(residuals))

    print(f"[RegChannel] Regression: slope={slope:.4f}/bar, intercept={intercept:.2f}, "
          f"std_dev={std_dev:.2f}", file=sys.stderr)

    # Step 4: Current position
    current_price = float(data[-1].close)
    current_reg = float(reg_line[-1])
    current_sd = float(residuals[-1] / std_dev) if std_dev > 0 else 0.0
    print(f"[RegChannel] Current: price=${current_price:.2f}, regression=${current_reg:.2f}, "
          f"SD={current_sd:+.2f}", file=sys.stderr)

    # Step 5: Build chart overlays
    intra = _is_intraday(timeframe)
    overlay_series = []

    # Regression line (mean)
    reg_data = []
    for i, bar in enumerate(segment):
        reg_data.append({"time": _format_time_str(bar), "value": round(float(reg_line[i]), 2)})

    overlay_series.append({
        "type": "line",
        "data": reg_data,
        "color": "#f59e0b",
        "lineWidth": 2,
        "lineStyle": 0,
        "label": "Mean",
    })

    # Dynamic SD bands: show only the two bands bracketing current price
    sd_abs = abs(current_sd)
    sd_floor = max(1, int(sd_abs))
    sd_ceil = sd_floor + 1
    sd_bands = sorted(set([sd_floor, sd_ceil]))

    print(f"[RegChannel] Dynamic bands: {sd_bands} (current SD={current_sd:+.2f})", file=sys.stderr)

    band_colors = {
        1: {"upper": "#3b82f6", "lower": "#3b82f6"},
        2: {"upper": "#8b5cf6", "lower": "#8b5cf6"},
        3: {"upper": "#ef4444", "lower": "#22c55e"},
        4: {"upper": "#dc2626", "lower": "#16a34a"},
        5: {"upper": "#b91c1c", "lower": "#15803d"},
        6: {"upper": "#991b1b", "lower": "#166534"},
    }
    band_styles = {1: 2, 2: 2, 3: 0, 4: 0, 5: 0, 6: 0}

    for sd_n in sorted(sd_bands):
        colors = band_colors.get(sd_n, {"upper": "#9ca3af", "lower": "#9ca3af"})
        style = band_styles.get(sd_n, 2)

        upper_data = []
        lower_data = []
        for i, bar in enumerate(segment):
            t = _format_time_str(bar)
            upper_val = round(float(reg_line[i] + sd_n * std_dev), 2)
            lower_val = round(float(reg_line[i] - sd_n * std_dev), 2)
            upper_data.append({"time": t, "value": upper_val})
            lower_data.append({"time": t, "value": lower_val})

        overlay_series.append({
            "type": "line",
            "data": upper_data,
            "color": colors["upper"],
            "lineWidth": 1 if sd_n <= 2 else 2,
            "lineStyle": style,
            "label": f"+{sd_n}SD",
        })
        overlay_series.append({
            "type": "line",
            "data": lower_data,
            "color": colors["lower"],
            "lineWidth": 1 if sd_n <= 2 else 2,
            "lineStyle": style,
            "label": f"-{sd_n}SD",
        })

    # Step 6: Build markers at the anchor and at any extreme SD touches
    markers = [{
        "time": _format_time_str(data[anchor_idx]),
        "position": "belowBar",
        "color": "#f59e0b",
        "shape": "arrowUp",
        "text": f"ANCHOR ${anchor_price:.0f}",
    }]

    # Mark the most extreme SD band touch in recent data (last 20%)
    recent_start = max(0, int(n * 0.8))
    peak_sd = 0.0
    peak_idx_local = -1
    for i in range(recent_start, n):
        sd_val = residuals[i] / std_dev if std_dev > 0 else 0.0
        if abs(sd_val) > abs(peak_sd):
            peak_sd = sd_val
            peak_idx_local = i

    if peak_idx_local >= 0 and abs(peak_sd) >= 2.0:
        peak_bar = segment[peak_idx_local]
        markers.append({
            "time": _format_time_str(peak_bar),
            "position": "aboveBar" if peak_sd > 0 else "belowBar",
            "color": "#ef4444" if peak_sd > 0 else "#22c55e",
            "shape": "arrowDown" if peak_sd > 0 else "arrowUp",
            "text": f"{peak_sd:+.1f}SD",
        })

    # Step 7: Build rule checklist
    sd_abs = abs(current_sd)
    rules = [
        {"rule_name": f"Anchor at absolute low ${anchor_price:.2f}", "passed": True, "value": float(anchor_price), "threshold": 0},
        {"rule_name": f"Regression slope {slope:.4f}/bar", "passed": bool(slope > 0), "value": round(slope, 6), "threshold": 0},
        {"rule_name": f"Current SD position: {current_sd:+.2f}", "passed": True, "value": round(current_sd, 2), "threshold": 0},
        {"rule_name": f"Within 2SD band", "passed": bool(sd_abs <= 2.0), "value": round(sd_abs, 2), "threshold": 2.0},
        {"rule_name": f"Extreme (beyond 3SD)", "passed": bool(sd_abs >= 3.0), "value": round(sd_abs, 2), "threshold": 3.0},
    ]

    # Score: higher when at extremes (potential reversal zones)
    if sd_abs >= 6.0:
        score = 1.0
    elif sd_abs >= 3.0:
        score = 0.8
    elif sd_abs >= 2.0:
        score = 0.5
    else:
        score = 0.3

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "regression_channel_v1")
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:12]}_regchan"

    chart_data = _build_chart_data(data, intra)

    return [{
        "candidate_id": cid, "id": cid,
        "strategy_version_id": svid, "spec_hash": spec_hash,
        "symbol": symbol, "timeframe": timeframe,
        "score": score, "entry_ready": False,
        "rule_checklist": rules,
        "anchors": {
            "regression_anchor": {"price": anchor_price, "date": anchor_date, "bar_index": anchor_idx},
        },
        "window_start": anchor_idx, "window_end": len(data) - 1,
        "pattern_type": "regression_channel_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": chart_data,
        "visual": {
            "markers": markers,
            "overlay_series": overlay_series,
        },
        "node_result": {
            "passed": True,
            "score": score,
            "features": {
                "anchor_price": anchor_price,
                "slope_per_bar": round(slope, 6),
                "std_dev": round(std_dev, 2),
                "current_sd": round(current_sd, 2),
                "regression_value": round(current_reg, 2),
            },
            "anchors": {"regression_anchor": {"price": anchor_price, "date": anchor_date}},
            "reason": f"Regression from ${anchor_price:.0f}: current at {current_sd:+.1f}SD (${current_price:.2f} vs reg ${current_reg:.2f})",
        },
        "output_ports": {
            "signal": {
                "passed": bool(sd_abs >= 2.0),
                "score": score,
                "reason": f"{current_sd:+.1f}SD from regression",
            },
        },
    }]
