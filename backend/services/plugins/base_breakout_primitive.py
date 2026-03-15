#!/usr/bin/env python3
"""
Base Breakout Primitive  —  Multi-Scale RDP (Wyckoff Accumulation Base)
=======================================================================
Uses RDP at two epsilon scales to detect flat consolidation bases.

THE CORE INSIGHT
----------------
RDP with a LARGE epsilon collapses a flat region into a single nearly-horizontal
segment.  RDP with a SMALL epsilon shows the fine wiggles inside that same region.

A BASE is where:
  - Coarse RDP (large epsilon) collapses N consecutive turning points into a
    tight price band  → the market is "flat" at the macro scale
  - Fine RDP (small epsilon) shows the oscillations within that band  → the
    wiggles we see on the chart are present but structurally insignificant

We call this a Wyckoff accumulation base when the following ALL hold:
  1. Coarse swing points in the window span a price range < range_tolerance_pct
     (the whole region is flat when viewed at coarse scale)
  2. The window covers at least min_base_bars bars (it lasted long enough to matter)
  3. There was a meaningful prior decline before the base started
     (prior peak → base ceiling drop > min_prior_decline_pct)
  4. A fine-grain swing high after the base clears the base ceiling by
     at least breakout_margin_pct  (breakout confirmed)
  5. Current price is still ABOVE the base floor  (base not broken)

SCORING
-------
  entry_ready = True when current price is within entry_zone_pct above the
  base ceiling (price is pulling back toward the old resistance = new support).
  Score = 1.0 at ceiling, decays as extension grows.

Dual-mode:
  "scan"   → chart annotations + pass/fail for scanner
  "signal" → set of bar indices (breakout bars) for backtester
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import Any, Dict, List, Optional

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _spec_hash(spec: dict) -> str:
    return hashlib.sha256(
        json.dumps(spec, sort_keys=True, default=str).encode()
    ).hexdigest()[:12]


def _chart_data(data: List[OHLCV]) -> List[dict]:
    is_intra = _detect_intraday(data)
    return [
        {
            "time":   _format_chart_time(b.timestamp, is_intra),
            "open":   b.open, "high": b.high,
            "low":    b.low,  "close": b.close,
            "volume": getattr(b, "volume", 0),
        }
        for b in data
    ]


# Coarse epsilon = fine × this multiplier — zooms out so minor wiggles disappear
_COARSE_SCALE = 2.5

_EPSILON_BY_TF: Dict[str, float] = {
    "M": 0.08, "W": 0.05, "D": 0.03,
    "4H": 0.015, "1H": 0.008, "30": 0.005, "15": 0.003,
}


# ---------------------------------------------------------------------------
# Core detection  —  two-scale RDP
# ---------------------------------------------------------------------------

def find_wyckoff_bases(
    data:                   List[OHLCV],
    fine_points:            List[Dict[str, Any]],   # small epsilon — fine structure
    coarse_points:          List[Dict[str, Any]],   # large epsilon — macro structure
    current_price:          float,
    min_base_highs:         int   = 2,      # fine swing highs needed to define base ceiling
    range_tolerance_pct:    float = 0.25,   # max price range of ceiling highs (25 %)
    min_base_bars:          int   = 6,      # base must span this many bars minimum
    min_prior_decline_pct:  float = 0.15,   # required drop before the base (15 %)
    breakout_margin_pct:    float = 0.03,   # how far above ceiling = confirmed breakout
    entry_zone_pct:         float = 0.50,   # within 50 % above ceiling = pullback zone
) -> List[Dict[str, Any]]:
    """
    Return confirmed Wyckoff base setups, most-recent breakout first.
    """
    fine_highs = [p for p in fine_points if p["type"] == "HIGH"]
    fine_lows  = [p for p in fine_points if p["type"] == "LOW"]

    results: List[Dict[str, Any]] = []

    import sys
    _dbg = lambda msg: print(f"[BASE_BO] {msg}", file=sys.stderr)

    # Use FINE swing highs to find the base ceiling band.
    # Fine RDP has the right granularity to see the equal highs within the
    # consolidation zone.  Coarse is too zoomed out and collapses the base away.
    min_highs = max(2, min_base_highs)
    max_highs = min(len(fine_highs), min_highs + 4)

    for win_size in range(min_highs, max_highs + 1):
        for i in range(len(fine_highs) - win_size + 1):
            base_h = fine_highs[i : i + win_size]

            start_idx = base_h[0]["index"]
            end_idx   = base_h[-1]["index"]

            # --- Gate 1: minimum bar span ---
            if (end_idx - start_idx) < min_base_bars:
                continue

            # --- Gate 2: fine HIGHS must form a tight ceiling band ---
            h_prices   = [h["price"] for h in base_h]
            mean_h     = sum(h_prices) / len(h_prices)
            band_pct   = (max(h_prices) - min(h_prices)) / mean_h if mean_h > 0 else 1.0
            if band_pct > range_tolerance_pct:
                continue

            base_ceiling = max(h_prices)

            # Base floor: lowest fine low inside the base span
            lows_in_base = [l for l in fine_lows if start_idx <= l["index"] <= end_idx]
            if lows_in_base:
                base_floor = min(l["price"] for l in lows_in_base)
            else:
                end_clamped = min(end_idx + 1, len(data))
                base_floor = min(data[j].low for j in range(start_idx, end_clamped))

            # --- Gate 3: require a prior decline before the base ---
            prior = [p for p in fine_highs if p["index"] < start_idx]
            skip_decline = False
            if prior:
                lookback_start = max(0, start_idx - 260)
                relevant_prior = [p for p in prior if p["index"] >= lookback_start]
                if relevant_prior:
                    prior_peak = max(relevant_prior, key=lambda p: p["price"])
                    decline_pct = (prior_peak["price"] - base_ceiling) / prior_peak["price"]
                    if decline_pct < min_prior_decline_pct:
                        skip_decline = True
            if skip_decline:
                continue

            # --- Gate 4: find a confirmed breakout above ceiling ---
            breakout_level = base_ceiling * (1.0 + breakout_margin_pct)
            post_base_highs = [
                p for p in fine_highs
                if p["index"] > end_idx and p["price"] > breakout_level
            ]
            if not post_base_highs:
                continue

            breakout = min(post_base_highs, key=lambda p: p["index"])

            # --- Gate 5 (KEY RULE): current price must be above base floor ---
            if current_price < base_floor:
                continue

            # --- Scoring ---
            extension_pct = (current_price - base_ceiling) / base_ceiling if base_ceiling > 0 else 0
            entry_ready   = extension_pct <= entry_zone_pct
            score         = max(0.3, 1.0 - extension_pct * 1.5)

            _dbg(f"PASS: {start_idx}-{end_idx} ceiling=${base_ceiling:.2f} floor=${base_floor:.2f} "
                 f"band={band_pct*100:.1f}% BO@{breakout['index']} ext={extension_pct*100:.1f}%")

            results.append({
                "window":           base_h,
                "base_ceiling":     base_ceiling,
                "base_floor":       base_floor,
                "base_start_idx":   start_idx,
                "base_end_idx":     end_idx,
                "breakout_idx":     breakout["index"],
                "band_pct":         band_pct,
                "extension_pct":    extension_pct,
                "entry_ready":      entry_ready,
                "score":            score,
                "current_price":    current_price,
            })

    # --- Deduplicate overlapping windows (keep highest-scoring per region) ---
    results.sort(key=lambda r: r["score"], reverse=True)
    kept: List[Dict[str, Any]] = []
    for r in results:
        overlap = False
        for k in kept:
            ov_start = max(r["base_start_idx"], k["base_start_idx"])
            ov_end   = min(r["base_end_idx"],   k["base_end_idx"])
            if ov_end > ov_start:
                span = r["base_end_idx"] - r["base_start_idx"] or 1
                if (ov_end - ov_start) / span > 0.5:
                    overlap = True
                    break
        if not overlap:
            kept.append(r)

    kept.sort(key=lambda r: r["breakout_idx"], reverse=True)
    return kept


# ---------------------------------------------------------------------------
# Visuals
# ---------------------------------------------------------------------------

def _make_markers(
    setups:   List[Dict[str, Any]],
    data:     List[OHLCV],
    is_intra: bool,
    max_show: int = 2,
) -> List[Dict[str, Any]]:
    markers: List[Dict[str, Any]] = []
    for s in setups[:max_show]:
        # Amber circles on each coarse base swing point
        for cp in s["window"]:
            markers.append({
                "time":     _format_chart_time(data[cp["index"]].timestamp, is_intra),
                "position": "aboveBar" if cp["type"] == "HIGH" else "belowBar",
                "color":    "#f59e0b",
                "shape":    "circle",
                "text":     "B",
            })
        # Green up-arrow at breakout
        bo = s["breakout_idx"]
        markers.append({
            "time":     _format_chart_time(data[bo].timestamp, is_intra),
            "position": "aboveBar",
            "color":    "#22c55e",
            "shape":    "arrowUp",
            "text":     "BO",
        })
    return markers


def _make_overlays(
    setups:   List[Dict[str, Any]],
    data:     List[OHLCV],
    is_intra: bool,
    max_show: int = 2,
) -> List[Dict[str, Any]]:
    """
    Horizontal dashed lines for base ceiling and floor, extended to current bar.
    """
    series: List[Dict[str, Any]] = []
    for s in setups[:max_show]:
        t_start = _format_chart_time(data[s["base_start_idx"]].timestamp, is_intra)
        t_end   = _format_chart_time(data[-1].timestamp,                  is_intra)

        series.append({
            "type":   "line",
            "color":  "#f59e0b",
            "width":  2,
            "style":  "dashed",
            "label":  f"Base Ceiling ${s['base_ceiling']:.2f}",
            "points": [
                {"time": t_start, "value": s["base_ceiling"]},
                {"time": t_end,   "value": s["base_ceiling"]},
            ],
        })
        series.append({
            "type":   "line",
            "color":  "#92400e",
            "width":  1,
            "style":  "dashed",
            "label":  f"Base Floor ${s['base_floor']:.2f}",
            "points": [
                {"time": t_start, "value": s["base_floor"]},
                {"time": t_end,   "value": s["base_floor"]},
            ],
        })
    return series


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def run_base_breakout_primitive_plugin(
    data:      List[OHLCV],
    structure: Any,
    spec:      Dict[str, Any],
    symbol:    str,
    timeframe: str,
    mode:      str = "scan",
    **kwargs,
) -> Any:
    """Matches composite_runner calling convention."""
    cfg = spec.get("setup_config", spec.get("structure_config", {})) if isinstance(spec, dict) else {}

    default_fine          = _EPSILON_BY_TF.get(timeframe, 0.03)
    fine_epsilon          = float(cfg.get("epsilon_pct",            default_fine))
    coarse_scale          = float(cfg.get("coarse_scale",           _COARSE_SCALE))
    coarse_epsilon        = fine_epsilon * coarse_scale

    min_base_highs        = int(  cfg.get("min_base_highs",        2))
    range_tolerance_pct   = float(cfg.get("range_tolerance_pct",   0.25))
    min_base_bars         = int(  cfg.get("min_base_bars",         6))
    min_prior_decline_pct = float(cfg.get("min_prior_decline_pct", 0.15))
    breakout_margin_pct   = float(cfg.get("breakout_margin_pct",   0.03))
    entry_zone_pct        = float(cfg.get("entry_zone_pct",        0.50))

    # --- Two-scale RDP ---
    # Fine: uses default auto-adapt (good for visuals, consistent swing count)
    fine_sw = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=fine_epsilon)
    if fine_sw is None or not fine_sw.swing_points:
        return [] if mode == "scan" else set()

    # Coarse: uses EXACT epsilon (no auto-adapt) to produce a genuinely
    # zoomed-out view.  Try descending scales until we get enough points.
    coarse_sw = None
    scale     = coarse_scale
    while scale >= 1.1:
        candidate_eps = fine_epsilon * scale
        sw = detect_swings_rdp(
            data, symbol, timeframe,
            epsilon_pct=candidate_eps,
            use_exact_epsilon=True,
        )
        if sw and sw.swing_points and len(sw.swing_points) >= 3:
            coarse_sw = sw
            break
        scale -= 0.5

    if coarse_sw is None:
        return [] if mode == "scan" else set()

    def _pts(sw) -> List[Dict[str, Any]]:
        return [
            {
                "index": p.index,
                "type":  p.point_type,
                "price": p.price,
                "date":  p.date,
                "tier":  getattr(p, "tier", "T1"),
            }
            for p in sw.swing_points
        ]

    fine_points   = _pts(fine_sw)
    coarse_points = _pts(coarse_sw)
    current_price = data[-1].close

    # --- Signal mode ---
    if mode == "signal":
        setups = find_wyckoff_bases(
            data, fine_points, coarse_points, current_price,
            min_base_highs=min_base_highs,
            range_tolerance_pct=range_tolerance_pct,
            min_base_bars=min_base_bars,
            min_prior_decline_pct=min_prior_decline_pct,
            breakout_margin_pct=breakout_margin_pct,
            entry_zone_pct=entry_zone_pct,
        )
        return {s["breakout_idx"] for s in setups}

    # --- Scan mode ---
    setups = find_wyckoff_bases(
        data, fine_points, coarse_points, current_price,
        min_base_highs=min_base_highs,
        range_tolerance_pct=range_tolerance_pct,
        min_base_bars=min_base_bars,
        min_prior_decline_pct=min_prior_decline_pct,
        breakout_margin_pct=breakout_margin_pct,
        entry_zone_pct=entry_zone_pct,
    )

    found   = len(setups) > 0
    best    = setups[0] if found else None
    score   = best["score"]       if best else 0.0
    e_ready = best["entry_ready"] if best else False

    is_intra = _detect_intraday(data)
    markers  = _make_markers(setups, data, is_intra)
    overlays = _make_overlays(setups, data, is_intra)

    sh   = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    svid = spec.get("strategy_version_id", "base_breakout_v2") if isinstance(spec, dict) else "base_breakout_v2"
    cid  = f"{symbol}_{timeframe}_{svid}_{sh[:8]}_0_{len(data) - 1}"

    candidate = {
        "candidate_id": cid,
        "id":           cid,
        "strategy_version_id": svid,
        "spec_hash":    sh,
        "symbol":       symbol,
        "timeframe":    timeframe,
        "score":        score,
        "entry_ready":  e_ready,
        "rule_checklist": [
            {
                "rule_name": "wyckoff_base_detected",
                "passed":    found,
                "value":     f"{len(setups)} base(s) — coarse band {best['band_pct']*100:.1f}%" if best else "None",
                "threshold": f"band < {range_tolerance_pct*100:.0f}%",
            },
            {
                "rule_name": "price_above_base_floor",
                "passed":    found and current_price >= (best["base_floor"] if best else 0),
                "value":     f"${current_price:.2f} vs floor ${best['base_floor']:.2f}" if best else "N/A",
                "threshold": "close > base_floor",
            },
            {
                "rule_name": "pullback_entry_zone",
                "passed":    e_ready,
                "value":     f"{best['extension_pct']*100:.1f}% above ceiling" if best else "N/A",
                "threshold": f"within {entry_zone_pct*100:.0f}% of ceiling",
            },
        ],
        "anchors":          {},
        "window_start":     0,
        "window_end":       len(data) - 1,
        "pattern_type":     "base_breakout",
        "created_at":       datetime.utcnow().isoformat() + "Z",
        "chart_data":       _chart_data(data),
        "chart_base_start": best["base_start_idx"] if best else -1,
        "chart_base_end":   best["base_end_idx"]   if best else -1,
        "visual": {
            "markers":        markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": found,
            "score":  score,
            "reason": (
                f"Wyckoff base ${best['base_ceiling']:.2f}–${best['base_floor']:.2f}, "
                f"BO confirmed, {best['extension_pct']*100:.1f}% above ceiling"
                if found else "No Wyckoff base with confirmed breakout found"
            ),
        },
        "output_ports": {
            "base_breakouts": {
                "count":  len(setups),
                "setups": [
                    {
                        "base_ceiling":  round(s["base_ceiling"], 4),
                        "base_floor":    round(s["base_floor"],   4),
                        "band_pct":      round(s["band_pct"] * 100, 1),
                        "breakout_idx":  s["breakout_idx"],
                        "extension_pct": round(s["extension_pct"] * 100, 1),
                        "entry_ready":   s["entry_ready"],
                    }
                    for s in setups
                ],
            }
        },
    }

    return [candidate]
