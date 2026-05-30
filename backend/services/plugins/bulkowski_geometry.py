#!/usr/bin/env python3
"""
Shared geometry helpers for Bulkowski-style chart pattern primitives.

Pulls out the RDP-pivot extraction, line/marker/horizontal builders, anchor
rounding, and Fib helpers that were duplicated across the existing
head_shoulders_context_pattern and three_drives_pattern plugins.

New primitives (double_top, double_bottom, triple_top, triangles, wedges,
quasimodo, etc.) should import from here instead of copy-pasting.

Existing primitives continue to use their inline copies for now to keep blast
radius zero; they can be migrated opportunistically.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from platform_sdk.ohlcv import OHLCV
from platform_sdk.rdp import detect_swings_rdp
from plugins.pattern_framework import chart_time


def as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def round_anchor(point: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "index": int(point["index"]),
        "price": round(float(point["price"]), 4),
    }


def extract_rdp_pivots(
    data: List[OHLCV],
    structure: Any,
    lookback_start: int,
    symbol: str,
    timeframe: str,
    epsilon_pct: float,
    use_exact_epsilon: bool,
    pivot_source: str,
    min_pivots: int = 6,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Resolve pivots from either pre-computed structure or fresh RDP run.

    Mirrors the pivot extraction used in head_shoulders_context_pattern and
    three_drives_pattern so all Bulkowski-style detectors share one source of
    truth for swing points.
    """
    source_key = str(pivot_source or "rdp").strip().lower()
    structure_points = getattr(structure, "swing_points", None)
    if structure_points is None and isinstance(structure, dict):
        structure_points = structure.get("swing_points")

    pivots: List[Dict[str, Any]] = []
    if source_key in ("structure", "auto") and isinstance(structure_points, list):
        for point in structure_points:
            if isinstance(point, dict):
                idx = int(point.get("index", -1))
                point_type = str(point.get("type") or point.get("point_type") or "").upper()
                price = point.get("price")
                confirmed_by_index = point.get("confirmed_by_index")
            else:
                idx = int(getattr(point, "index", -1))
                point_type = str(getattr(point, "point_type", getattr(point, "type", ""))).upper()
                price = getattr(point, "price", None)
                confirmed_by_index = getattr(point, "confirmed_by_index", None)

            if idx < lookback_start or idx >= len(data) or point_type not in ("HIGH", "LOW"):
                continue
            if price is None:
                price = data[idx].high if point_type == "HIGH" else data[idx].low
            pivots.append(
                {
                    "index": idx,
                    "price": float(price),
                    "type": point_type,
                    "confirmed_by_index": int(confirmed_by_index) if confirmed_by_index is not None else None,
                }
            )
        if len(pivots) >= min_pivots:
            return pivots, "structure"

    swing = detect_swings_rdp(
        data,
        symbol=symbol,
        timeframe=timeframe,
        epsilon_pct=epsilon_pct,
        use_exact_epsilon=use_exact_epsilon,
        verbose=False,
    )
    for point in getattr(swing, "swing_points", []) or []:
        idx = int(getattr(point, "index", -1))
        point_type = str(getattr(point, "point_type", "")).upper()
        if idx < lookback_start or idx >= len(data) or point_type not in ("HIGH", "LOW"):
            continue
        pivots.append(
            {
                "index": idx,
                "price": float(getattr(point, "price", data[idx].high if point_type == "HIGH" else data[idx].low)),
                "type": point_type,
                "confirmed_by_index": int(getattr(point, "confirmed_by_index", idx) or idx),
            }
        )
    return pivots, "rdp"


def marker(
    data: List[OHLCV],
    index: int,
    position: str,
    color: str,
    shape: str,
    text: str,
) -> Dict[str, Any]:
    return {
        "time": chart_time(data, index),
        "position": position,
        "color": color,
        "shape": shape,
        "text": text,
    }


def line(
    data: List[OHLCV],
    points: Sequence[Dict[str, Any]],
    color: str,
    label: str,
    line_width: int = 2,
    line_style: int = 0,
) -> Dict[str, Any]:
    return {
        "type": "line",
        "color": color,
        "lineWidth": line_width,
        "lineStyle": line_style,
        "label": label,
        "data": [
            {"time": chart_time(data, int(point["index"])), "value": round(float(point["price"]), 4)}
            for point in points
        ],
    }


def horizontal_line(
    data: List[OHLCV],
    start_index: int,
    end_index: int,
    price: float,
    color: str,
    label: str,
    line_width: int = 1,
    line_style: int = 2,
) -> Dict[str, Any]:
    return line(
        data,
        [
            {"index": start_index, "price": price},
            {"index": end_index, "price": price},
        ],
        color=color,
        label=label,
        line_width=line_width,
        line_style=line_style,
    )


def find_break_after(
    pivots: Sequence[Dict[str, Any]],
    start_index: int,
    threshold: float,
    direction: str,
) -> Optional[Dict[str, Any]]:
    """
    Find the first pivot that breaks `threshold` in the given direction.

    direction = "below" → first LOW pivot with price < threshold
    direction = "above" → first HIGH pivot with price > threshold
    """
    direction_key = direction.strip().lower()
    if direction_key == "below":
        for point in pivots[start_index:]:
            if point["type"] == "LOW" and float(point["price"]) < threshold:
                return point
    else:
        for point in pivots[start_index:]:
            if point["type"] == "HIGH" and float(point["price"]) > threshold:
                return point
    return None


def find_close_break_index(
    data: List[OHLCV],
    start_index: int,
    threshold: float,
    direction: str,
) -> Optional[int]:
    """
    Find the first bar index >= start_index where the close breaks `threshold`.

    direction = "below" → first close < threshold
    direction = "above" → first close > threshold

    Returns None if no break occurs in the data window.
    """
    direction_key = direction.strip().lower()
    end = len(data)
    start = max(0, int(start_index))
    if direction_key == "below":
        for idx in range(start, end):
            if float(data[idx].close) < threshold:
                return idx
    else:
        for idx in range(start, end):
            if float(data[idx].close) > threshold:
                return idx
    return None


def measured_move_target(
    pattern_top: float,
    pattern_bottom: float,
    breakout_price: float,
    direction: str,
) -> float:
    """
    Bulkowski's classic measured-move target:
    - bearish breakout: target = breakout - (top - bottom)
    - bullish breakout: target = breakout + (top - bottom)
    """
    height = abs(float(pattern_top) - float(pattern_bottom))
    if direction.strip().lower() == "bearish":
        return float(breakout_price) - height
    return float(breakout_price) + height


def pct_diff(a: float, b: float) -> float:
    """Symmetric percentage distance between two values."""
    denom = (abs(float(a)) + abs(float(b))) / 2.0
    if denom < 1e-9:
        return 0.0
    return abs(float(a) - float(b)) / denom


# ---------------------------------------------------------------------------
# Trendline helpers — shared across triangle, wedge, and rectangle patterns.
# Pure additions (no existing helper modified) — safe for older patterns.
# ---------------------------------------------------------------------------


def fit_trendline(pivots: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Least-squares straight-line fit y = slope*x + intercept through (index, price)
    pairs. Used to define triangle/wedge/rectangle support and resistance lines.

    Returns dict with:
        slope, intercept              line parameters
        r_squared                     fit quality in [0,1]
        residual_max_pct              worst-pivot deviation as fraction of price
        n_touches                     number of pivots fitted
        x_first, x_last               bar index span of the fitted pivots
    Returns None if fewer than 2 distinct x values.
    """
    if not pivots or len(pivots) < 2:
        return None
    xs = [float(p["index"]) for p in pivots]
    ys = [float(p["price"]) for p in pivots]
    if len(set(xs)) < 2:
        return None

    n = len(pivots)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x) ** 2 for x in xs)
    if abs(den) < 1e-12:
        return None

    slope = num / den
    intercept = mean_y - slope * mean_x

    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    if ss_tot < 1e-12:
        r_squared = 1.0
    else:
        ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
        r_squared = max(0.0, 1.0 - ss_res / ss_tot)

    residual_max_pct = max(
        abs(y - (slope * x + intercept)) / max(abs(y), 1e-9) for x, y in zip(xs, ys)
    )

    return {
        "slope": float(slope),
        "intercept": float(intercept),
        "r_squared": float(r_squared),
        "residual_max_pct": float(residual_max_pct),
        "n_touches": int(n),
        "x_first": float(min(xs)),
        "x_last": float(max(xs)),
    }


def trendline_value_at(slope: float, intercept: float, x: float) -> float:
    return float(slope) * float(x) + float(intercept)


def classify_slope(
    slope: float,
    ref_price: float,
    flat_max_pct_per_bar: float,
) -> str:
    """
    Classify a least-squares slope as 'rising', 'flat', or 'falling' relative to a
    reference price. `flat_max_pct_per_bar` is the threshold below which the line is
    considered flat (e.g. 0.001 = 0.1% per bar).
    """
    if ref_price < 1e-9:
        return "flat"
    pct_per_bar = float(slope) / float(ref_price)
    if abs(pct_per_bar) <= float(flat_max_pct_per_bar):
        return "flat"
    return "rising" if pct_per_bar > 0 else "falling"


def lines_converge(slope_top: float, slope_bottom: float) -> bool:
    """
    True iff a top resistance line and a bottom support line converge into the
    future (vertical distance shrinks as x grows). Holds when slope_top < slope_bottom.
    """
    return float(slope_top) < float(slope_bottom)


def trendline_apex_index(
    slope_top: float,
    intercept_top: float,
    slope_bottom: float,
    intercept_bottom: float,
) -> Optional[int]:
    """Bar index where two converging trendlines meet, or None if parallel/diverging."""
    diff = float(slope_bottom) - float(slope_top)
    if abs(diff) < 1e-12:
        return None
    apex = (float(intercept_top) - float(intercept_bottom)) / diff
    if apex != apex or apex <= 0:
        return None
    return int(apex)


def trendline_polyline(
    data: List[OHLCV],
    slope: float,
    intercept: float,
    start_index: int,
    end_index: int,
    color: str,
    label: str,
    line_width: int = 2,
    line_style: int = 0,
) -> Dict[str, Any]:
    """Render a trendline as a 2-point overlay using the existing line() helper."""
    return line(
        data,
        [
            {"index": int(start_index), "price": trendline_value_at(slope, intercept, start_index)},
            {"index": int(end_index), "price": trendline_value_at(slope, intercept, end_index)},
        ],
        color=color,
        label=label,
        line_width=line_width,
        line_style=line_style,
    )


def find_close_break_against_trendline(
    data: List[OHLCV],
    slope: float,
    intercept: float,
    start_index: int,
    direction: str,
) -> Optional[int]:
    """
    Find first bar index >= start_index where close crosses an evolving trendline.

    direction = 'above' → first bar with close > slope*idx + intercept
    direction = 'below' → first bar with close < slope*idx + intercept
    """
    direction_key = direction.strip().lower()
    end = len(data)
    start = max(0, int(start_index))
    if direction_key == "below":
        for idx in range(start, end):
            if float(data[idx].close) < trendline_value_at(slope, intercept, idx):
                return idx
    else:
        for idx in range(start, end):
            if float(data[idx].close) > trendline_value_at(slope, intercept, idx):
                return idx
    return None
