#!/usr/bin/env python3
"""
Base Box Detector RDP Hybrid V1 (Pattern)
=========================================
Production-lean base detector:
1) RDP pivots anchor candidate windows
2) Robust box boundaries (quantiles, not raw extremes)
3) Regime gate (trendiness + optional higher-level trend allowlist)
4) Deterministic quality score

This is intentionally analysis-only (no entry signal logic).
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Sequence, Set

import logging
from pathlib import Path

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.rdp import detect_swings_rdp

_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# ML regressor integration (feedback loop — Step 4)
# ---------------------------------------------------------------------------
_regressor_cache: Dict[str, Any] = {"model": None, "features": None, "mtime": 0.0}

_MODELS_DIR = Path(__file__).resolve().parents[2].parent / "ml" / "models" / "feedback_v1"
_REGRESSOR_PATH = _MODELS_DIR / "feedback_base_regressor.joblib"
_FEATURES_PATH = _MODELS_DIR / "feedback_regressor_features.json"


def _load_regressor() -> Any:
    """Load the trained regressor model, caching by file mtime. Returns None if unavailable."""
    if not _REGRESSOR_PATH.exists():
        return None
    try:
        mtime = _REGRESSOR_PATH.stat().st_mtime
        if _regressor_cache["model"] is not None and _regressor_cache["mtime"] == mtime:
            return _regressor_cache["model"]
        import joblib
        model = joblib.load(str(_REGRESSOR_PATH))
        features: List[str] = []
        if _FEATURES_PATH.exists():
            meta = json.loads(_FEATURES_PATH.read_text(encoding="utf-8"))
            features = meta.get("feature_columns", [])
        _regressor_cache.update({"model": model, "features": features, "mtime": mtime})
        _log.info("Loaded feedback regressor (%d features) from %s", len(features), _REGRESSOR_PATH)
        return model
    except Exception as exc:
        _log.debug("Regressor load skipped: %s", exc)
        return None


def _build_regressor_features(
    best: Dict[str, Any],
    data: List[OHLCV],
    rdp_points: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, float]:
    """Build the feature dict matching build_feedback_dataset.FEATURE_COLUMNS."""
    ceiling = float(best["ceiling"])
    floor = float(best["floor"])
    rng = ceiling - floor
    current_close = float(data[-1].close) if data else 0.0
    pos_in_base = max(-2.0, min(3.0, (current_close - floor) / rng)) if rng > 1e-12 else 0.0

    return {
        "score": float(best.get("score", 0)),
        "entry_ready": 0,
        "rule_pass_ratio": 1.0,
        "rule_count": 4,
        "window_len": len(data),
        "chart_len": len(data),
        "base_high": ceiling,
        "base_low": floor,
        "base_range_pct": float(best.get("range_pct", 0)),
        "base_duration": float(best.get("base_span_bars", 0)),
        "current_close": current_close,
        "current_pos_in_base": pos_in_base,
        "touches_top": int(best.get("touches_top", 0)),
        "touches_bottom": int(best.get("touches_bottom", 0)),
        "pivot_switches": int(best.get("pivot_switches", 0)),
        "window_pivots": int(best.get("window_pivots", 0)),
        "trendiness": float(best.get("trendiness", 0)),
        "slope_pct_per_bar": float(best.get("slope_pct_per_bar", 0)),
        "rdp_swing_count_total": len(rdp_points.get("all", [])),
        "rdp_swing_count_highs": len(rdp_points.get("highs", [])),
        "rdp_swing_count_lows": len(rdp_points.get("lows", [])),
        "node_score": float(best.get("score", 0)),
    }


def _apply_regressor(
    best: Dict[str, Any],
    data: List[OHLCV],
    rdp_points: Dict[str, List[Dict[str, Any]]],
) -> bool:
    """Adjust best['ceiling'] and best['floor'] using the trained regressor. Returns True if adjusted."""
    model = _load_regressor()
    if model is None:
        return False
    feature_cols: List[str] = _regressor_cache.get("features") or []
    if not feature_cols:
        return False
    try:
        import numpy as np
        feat_dict = _build_regressor_features(best, data, rdp_points)
        X = np.array([[feat_dict.get(c, float("nan")) for c in feature_cols]])
        deltas = model.predict(X)[0]
        delta_top, delta_bottom = float(deltas[0]), float(deltas[1])

        new_ceiling = best["ceiling"] + delta_top
        new_floor = best["floor"] + delta_bottom
        if new_floor >= new_ceiling:
            _log.debug("Regressor adjustment rejected: floor %.2f >= ceiling %.2f", new_floor, new_ceiling)
            return False

        _log.info(
            "Regressor adjusted base: ceiling %.2f→%.2f (Δ%.2f), floor %.2f→%.2f (Δ%.2f)",
            best["ceiling"], new_ceiling, delta_top, best["floor"], new_floor, delta_bottom,
        )
        best["ceiling"] = new_ceiling
        best["floor"] = new_floor
        best["range_pct"] = (new_ceiling - new_floor) / new_ceiling if new_ceiling > 0 else 0.0
        best["ml_adjusted"] = True
        best["ml_delta_top"] = delta_top
        best["ml_delta_bottom"] = delta_bottom
        return True
    except Exception as exc:
        _log.debug("Regressor prediction failed: %s", exc)
        return False


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


def _parse_lookbacks(raw: Any, fallback: int = 60) -> List[int]:
    out: List[int] = []
    if isinstance(raw, str):
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                value = int(float(part))
                if value > 0:
                    out.append(value)
            except Exception:
                continue
    elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        for item in raw:
            try:
                value = int(float(item))
                if value > 0:
                    out.append(value)
            except Exception:
                continue
    else:
        try:
            value = int(float(raw))
            if value > 0:
                out.append(value)
        except Exception:
            pass
    if not out:
        out = [fallback]
    return sorted(set(out))


def _parse_allowed_trends(raw: Any) -> Set[str]:
    if raw is None:
        raw = "SIDEWAYS,UPTREND"
    if isinstance(raw, str):
        vals = [p.strip().upper() for p in raw.split(",") if p.strip()]
    elif isinstance(raw, Sequence):
        vals = [str(x).strip().upper() for x in raw if str(x).strip()]
    else:
        vals = [str(raw).strip().upper()] if str(raw).strip() else []
    return set(vals or ["SIDEWAYS", "UPTREND"])


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


def _trendiness(values: Sequence[float]) -> float:
    if len(values) < 3:
        return 1.0
    delta = abs(float(values[-1]) - float(values[0]))
    travel = 0.0
    for i in range(1, len(values)):
        travel += abs(float(values[i]) - float(values[i - 1]))
    if travel <= 1e-12:
        return 0.0
    return max(0.0, min(1.0, delta / travel))


def _extract_rdp_pivots(data: List[OHLCV], symbol: str, timeframe: str, epsilon_pct: float) -> Dict[str, List[Dict[str, Any]]]:
    swings = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    all_points: List[Dict[str, Any]] = []
    highs: List[Dict[str, Any]] = []
    lows: List[Dict[str, Any]] = []

    for sp in getattr(swings, "swing_points", []) or []:
        idx = int(getattr(sp, "index", -1))
        if idx < 0 or idx >= len(data):
            continue
        point_type = str(getattr(sp, "point_type", "")).upper()
        if point_type not in ("HIGH", "LOW"):
            continue
        fallback_price = float(data[idx].high if point_type == "HIGH" else data[idx].low)
        price = float(getattr(sp, "price", fallback_price))
        row = {
            "index": idx,
            "price": price,
            "type": point_type,
            "date": getattr(sp, "date", ""),
        }
        all_points.append(row)
        if point_type == "HIGH":
            highs.append(row)
        else:
            lows.append(row)

    all_points.sort(key=lambda p: int(p["index"]))
    highs.sort(key=lambda p: int(p["index"]))
    lows.sort(key=lambda p: int(p["index"]))
    return {"all": all_points, "highs": highs, "lows": lows}


def _dedupe_overlap(setups: List[Dict[str, Any]], threshold: float) -> List[Dict[str, Any]]:
    if not setups:
        return []
    ordered = sorted(setups, key=lambda s: float(s.get("score", 0.0)), reverse=True)
    kept: List[Dict[str, Any]] = []
    for setup in ordered:
        start_a = int(setup["base_start_idx"])
        end_a = int(setup["base_end_idx"])
        span_a = max(1, end_a - start_a + 1)
        overlap = False
        for k in kept:
            start_b = int(k["base_start_idx"])
            end_b = int(k["base_end_idx"])
            inter = max(0, min(end_a, end_b) - max(start_a, start_b) + 1)
            if inter <= 0:
                continue
            if (inter / span_a) >= threshold:
                overlap = True
                break
        if not overlap:
            kept.append(setup)
    return kept


def _find_setups(
    data: List[OHLCV],
    rdp_points: Dict[str, List[Dict[str, Any]]],
    lookbacks: List[int],
    min_base_bars: int,
    max_base_range_pct: float,
    top_tolerance_pct: float,
    bottom_tolerance_pct: float,
    min_top_touches: int,
    min_bottom_touches: int,
    min_total_pivots: int,
    min_pivot_switches: int,
    max_slope_pct_per_bar: float,
    max_trendiness: float,
    max_scan_bars: int,
    breakout_help_pct: float,
    ceiling_escape_pct: float,
    floor_escape_pct: float,
    overlap_threshold: float,
) -> List[Dict[str, Any]]:
    n = len(data)
    if n < max(10, min_base_bars):
        return []

    pivots_all = rdp_points.get("all", [])
    if len(pivots_all) < (min_top_touches + min_bottom_touches):
        return []

    last_idx = n - 1
    current_close = float(data[last_idx].close)
    setups: List[Dict[str, Any]] = []

    for lookback in lookbacks:
        lb = max(min_base_bars, int(lookback))
        if n < lb:
            continue

        end_min = max(lb - 1, n - max_scan_bars)
        for base_end in range(end_min, n):
            base_start = base_end - lb + 1
            if base_start < 0:
                continue

            window_pivots = [p for p in pivots_all if base_start <= int(p["index"]) <= base_end]
            if len(window_pivots) < min_total_pivots:
                continue

            highs = [p for p in window_pivots if p["type"] == "HIGH"]
            lows = [p for p in window_pivots if p["type"] == "LOW"]
            if len(highs) < min_top_touches or len(lows) < min_bottom_touches:
                continue

            high_vals = [float(p["price"]) for p in highs]
            low_vals = [float(p["price"]) for p in lows]

            # Robust boundaries reduce outlier pivot influence.
            ceiling = _quantile(high_vals, 0.75)
            floor = _quantile(low_vals, 0.25)
            if ceiling <= 0 or floor <= 0 or floor >= ceiling:
                continue

            range_pct = (ceiling - floor) / ceiling
            if range_pct > max_base_range_pct:
                continue

            closes = [float(b.close) for b in data[base_start: base_end + 1]]
            slope_pct = _slope_pct_per_bar(closes)
            if slope_pct > max_slope_pct_per_bar:
                continue

            trendiness = _trendiness(closes)
            if trendiness > max_trendiness:
                continue

            top_cut = ceiling * (1.0 - top_tolerance_pct)
            bottom_cut = floor * (1.0 + bottom_tolerance_pct)
            top_hits = [int(p["index"]) for p in highs if float(p["price"]) >= top_cut]
            bottom_hits = [int(p["index"]) for p in lows if float(p["price"]) <= bottom_cut]

            if len(top_hits) < min_top_touches:
                continue
            if len(bottom_hits) < min_bottom_touches:
                continue

            seq = [str(p["type"]) for p in window_pivots]
            switches = 0
            for i in range(1, len(seq)):
                if seq[i] != seq[i - 1]:
                    switches += 1
            if switches < min_pivot_switches:
                continue

            near_or_inside = (floor * (1.0 - floor_escape_pct)) <= current_close <= (ceiling * (1.0 + ceiling_escape_pct))

            breakout_seen = False
            if base_end < last_idx:
                breakout_level = ceiling * (1.0 + breakout_help_pct)
                for i in range(base_end + 1, n):
                    if float(data[i].close) > breakout_level:
                        breakout_seen = True
                        break

            base_span = base_end - base_start + 1
            recency_bars = last_idx - base_end
            recency_score = max(0.0, 1.0 - (recency_bars / max(1, max_scan_bars)))
            tightness_score = max(0.0, 1.0 - (range_pct / max(1e-9, max_base_range_pct)))
            touch_score = min(
                1.0,
                0.5 * (len(top_hits) / max(1, min_top_touches)) +
                0.5 * (len(bottom_hits) / max(1, min_bottom_touches)),
            )
            flat_score = max(0.0, 1.0 - (slope_pct / max(1e-9, max_slope_pct_per_bar)))
            duration_score = min(1.0, base_span / max(float(min_base_bars), 1.0))
            switch_score = min(1.0, switches / max(float(min_pivot_switches), 1.0))
            regime_score = max(0.0, 1.0 - (trendiness / max(1e-9, max_trendiness)))

            score = (
                0.24 * tightness_score +
                0.16 * touch_score +
                0.14 * flat_score +
                0.12 * duration_score +
                0.10 * recency_score +
                0.12 * switch_score +
                0.12 * regime_score
            )
            if near_or_inside:
                score += 0.05
            if breakout_seen:
                score += 0.02
            score = max(0.0, min(1.0, score))

            setups.append({
                "base_start_idx": base_start,
                "base_end_idx": base_end,
                "base_lookback": lb,
                "base_span_bars": base_span,
                "ceiling": ceiling,
                "floor": floor,
                "range_pct": range_pct,
                "slope_pct_per_bar": slope_pct,
                "trendiness": trendiness,
                "top_hits": sorted(set(top_hits)),
                "bottom_hits": sorted(set(bottom_hits)),
                "touches_top": len(top_hits),
                "touches_bottom": len(bottom_hits),
                "window_pivots": len(window_pivots),
                "pivot_switches": switches,
                "near_or_inside": bool(near_or_inside),
                "breakout_seen": bool(breakout_seen),
                "score": score,
            })

    deduped = _dedupe_overlap(setups, max(0.0, min(0.99, overlap_threshold)))
    deduped.sort(key=lambda s: (float(s["score"]), int(s["base_end_idx"])), reverse=True)
    return deduped


def _build_markers(best: Dict[str, Any], data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    markers: List[Dict[str, Any]] = []
    for idx in best.get("top_hits", [])[:12]:
        markers.append({
            "time": _format_chart_time(data[idx].timestamp, is_intraday),
            "position": "aboveBar",
            "color": "#f59e0b",
            "shape": "circle",
            "text": "BT",
        })
    for idx in best.get("bottom_hits", [])[:12]:
        markers.append({
            "time": _format_chart_time(data[idx].timestamp, is_intraday),
            "position": "belowBar",
            "color": "#10b981",
            "shape": "circle",
            "text": "BF",
        })
    return markers


def _line_overlay(color: str, label: str, p0: Dict[str, Any], p1: Dict[str, Any], width: int = 2, style: int = 2) -> Dict[str, Any]:
    pts = [p0, p1]
    return {
        "type": "line",
        "color": color,
        "lineWidth": width,
        "lineStyle": style,
        "width": width,
        "style": "dashed" if style == 2 else "solid",
        "label": label,
        "points": pts,
        "data": pts,
    }


def _build_overlays(best: Dict[str, Any], data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    t_start = _format_chart_time(data[best["base_start_idx"]].timestamp, is_intraday)
    t_end = _format_chart_time(data[-1].timestamp, is_intraday)
    t_right = _format_chart_time(data[best["base_end_idx"]].timestamp, is_intraday)
    floor = float(best["floor"])
    ceiling = float(best["ceiling"])

    return [
        _line_overlay(
            color="#ef4444",
            label=f"Hybrid Base Top ${ceiling:.2f}",
            p0={"time": t_start, "value": ceiling},
            p1={"time": t_end, "value": ceiling},
            width=2,
            style=0,
        ),
        _line_overlay(
            color="#22c55e",
            label=f"Hybrid Base Bottom ${floor:.2f}",
            p0={"time": t_start, "value": floor},
            p1={"time": t_end, "value": floor},
            width=2,
            style=0,
        ),
        _line_overlay(
            color="#6b7280",
            label="Base Start",
            p0={"time": t_start, "value": floor},
            p1={"time": t_start, "value": ceiling},
            width=1,
            style=2,
        ),
        _line_overlay(
            color="#6b7280",
            label="Base End",
            p0={"time": t_right, "value": floor},
            p1={"time": t_right, "value": ceiling},
            width=1,
            style=2,
        ),
    ]


def run_base_box_detector_rdp_hybrid_v1_pattern_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    mode: str = "scan",
    **kwargs,
) -> Any:
    cfg = spec.get("setup_config", spec.get("structure_config", {})) if isinstance(spec, dict) else {}
    struct_cfg = spec.get("structure_config", {}) if isinstance(spec, dict) else {}

    lookbacks = _parse_lookbacks(cfg.get("base_lookbacks", "45,60,90,120,180,240,360,540,720"), fallback=120)
    epsilon_pct = float(cfg.get("epsilon_pct", struct_cfg.get("swing_epsilon_pct", 0.05)))
    allowed_trends = _parse_allowed_trends(cfg.get("allowed_trends", "SIDEWAYS,UPTREND"))
    structure_trend = str(getattr(structure, "trend", "UNKNOWN") or "UNKNOWN").upper()

    rdp_points = _extract_rdp_pivots(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    setups = _find_setups(
        data=data,
        rdp_points=rdp_points,
        lookbacks=lookbacks,
        min_base_bars=int(cfg.get("min_base_bars", 30)),
        max_base_range_pct=float(cfg.get("max_base_range_pct", 0.65)),
        top_tolerance_pct=float(cfg.get("top_tolerance_pct", 0.08)),
        bottom_tolerance_pct=float(cfg.get("bottom_tolerance_pct", 0.08)),
        min_top_touches=int(cfg.get("min_top_touches", 2)),
        min_bottom_touches=int(cfg.get("min_bottom_touches", 2)),
        min_total_pivots=int(cfg.get("min_total_pivots", 4)),
        min_pivot_switches=int(cfg.get("min_pivot_switches", 2)),
        max_slope_pct_per_bar=float(cfg.get("max_slope_pct_per_bar", 0.0080)),
        max_trendiness=float(cfg.get("max_trendiness", 0.80)),
        max_scan_bars=int(cfg.get("max_scan_bars", 1800)),
        breakout_help_pct=float(cfg.get("breakout_help_pct", 0.01)),
        ceiling_escape_pct=float(cfg.get("ceiling_escape_pct", 0.20)),
        floor_escape_pct=float(cfg.get("floor_escape_pct", 0.10)),
        overlap_threshold=float(cfg.get("overlap_threshold", 0.70)),
    )

    # Optional regime filter from structure extraction context.
    if structure_trend not in allowed_trends:
        setups = []

    if mode == "signal":
        return {int(s["base_end_idx"]) for s in setups}

    found = len(setups) > 0
    emit_when_missing = bool(cfg.get("emit_when_missing", False))
    if not found and not emit_when_missing:
        return []

    best = setups[0] if found else None

    ml_adjusted = False
    if best is not None:
        ml_adjusted = _apply_regressor(best, data, rdp_points)

    score = float(best["score"]) if best else 0.0
    is_intraday = _detect_intraday(data)
    markers = _build_markers(best, data, is_intraday) if best else []
    overlays = _build_overlays(best, data, is_intraday) if best else []

    spec_hash = _spec_hash(spec) if isinstance(spec, dict) else "unknown"
    strategy_version = (
        spec.get("strategy_version_id", "base_box_detector_rdp_hybrid_v1_pattern_v1")
        if isinstance(spec, dict)
        else "base_box_detector_rdp_hybrid_v1_pattern_v1"
    )
    candidate_id = f"{symbol}_{timeframe}_{strategy_version}_{spec_hash[:8]}_0_{len(data) - 1}"

    current_close = float(data[-1].close) if data else 0.0
    near_or_inside = bool(best["near_or_inside"]) if best else False

    candidate = {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "rdp_pivots_detected",
                "passed": len(rdp_points.get("all", [])) > 0,
                "value": len(rdp_points.get("all", [])),
                "threshold": ">= 1",
            },
            {
                "rule_name": "structure_trend_allowed",
                "passed": structure_trend in allowed_trends,
                "value": structure_trend,
                "threshold": ",".join(sorted(allowed_trends)),
            },
            {
                "rule_name": "base_detected",
                "passed": found,
                "value": f"{len(setups)} base(s)" if found else "0",
                "threshold": ">= 1",
            },
            {
                "rule_name": "price_near_or_inside_base",
                "passed": near_or_inside,
                "value": (
                    f"${current_close:.2f} vs ${best['floor']:.2f}-${best['ceiling']:.2f}"
                    if best else "N/A"
                ),
                "threshold": "near/inside box",
            },
        ],
        "anchors": {},
        "window_start": 0,
        "window_end": len(data) - 1,
        "pattern_type": "base_box_detector_rdp_hybrid_v1_pattern",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": _chart_data(data),
        "chart_base_start": int(best["base_start_idx"]) if best else -1,
        "chart_base_end": int(best["base_end_idx"]) if best else -1,
        "base": (
            {
                "start_date": str(data[int(best["base_start_idx"])].timestamp)[:10],
                "end_date": str(data[int(best["base_end_idx"])].timestamp)[:10],
                "duration": int(best["base_span_bars"]),
                "high": float(best["ceiling"]),
                "low": float(best["floor"]),
            }
            if best else None
        ),
        "visual": {
            "markers": markers,
            "overlay_series": overlays,
        },
        "node_result": {
            "passed": found,
            "score": score,
            "reason": (
                f"Hybrid RDP base detected ${best['floor']:.2f}-${best['ceiling']:.2f} "
                f"({best['base_span_bars']} bars, trendiness={best['trendiness']:.2f})"
                + (f" [ML-adjusted Δtop={best.get('ml_delta_top', 0):+.2f}, Δbot={best.get('ml_delta_bottom', 0):+.2f}]" if ml_adjusted else "")
                if best else
                "No qualifying hybrid RDP base detected"
            ),
            "ml_adjusted": ml_adjusted,
        },
        "rdp_pivots": {
            "epsilon_pct": epsilon_pct,
            "swing_count_total": len(rdp_points.get("all", [])),
            "swing_count_highs": len(rdp_points.get("highs", [])),
            "swing_count_lows": len(rdp_points.get("lows", [])),
            "swing_points": rdp_points.get("all", []),
        },
        "output_ports": {
            "base_boxes": {
                "count": len(setups),
                "best": (
                    {
                        "base_start_idx": int(best["base_start_idx"]),
                        "base_end_idx": int(best["base_end_idx"]),
                        "ceiling": round(float(best["ceiling"]), 4),
                        "floor": round(float(best["floor"]), 4),
                        "range_pct": round(float(best["range_pct"]) * 100.0, 2),
                        "touches_top": int(best["touches_top"]),
                        "touches_bottom": int(best["touches_bottom"]),
                        "pivot_switches": int(best["pivot_switches"]),
                        "window_pivots": int(best["window_pivots"]),
                        "trendiness": round(float(best["trendiness"]), 4),
                        "slope_pct_per_bar": round(float(best["slope_pct_per_bar"]) * 100.0, 4),
                        "score": round(float(best["score"]), 4),
                    }
                    if best else None
                ),
                "setups": [
                    {
                        "base_start_idx": int(s["base_start_idx"]),
                        "base_end_idx": int(s["base_end_idx"]),
                        "base_span_bars": int(s["base_span_bars"]),
                        "ceiling": round(float(s["ceiling"]), 4),
                        "floor": round(float(s["floor"]), 4),
                        "range_pct": round(float(s["range_pct"]) * 100.0, 2),
                        "touches_top": int(s["touches_top"]),
                        "touches_bottom": int(s["touches_bottom"]),
                        "pivot_switches": int(s["pivot_switches"]),
                        "window_pivots": int(s["window_pivots"]),
                        "trendiness": round(float(s["trendiness"]), 4),
                        "slope_pct_per_bar": round(float(s["slope_pct_per_bar"]) * 100.0, 4),
                        "near_or_inside": bool(s["near_or_inside"]),
                        "breakout_seen": bool(s["breakout_seen"]),
                        "score": round(float(s["score"]), 4),
                    }
                    for s in setups[:20]
                ],
            }
        },
    }

    return [candidate]
