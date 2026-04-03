#!/usr/bin/env python3
"""
SR Score Primitive — evaluate a persisted symbolic-regression formula causally.

When formula_id is present, the primitive loads the stored formula metadata,
rebuilds the latest valid feature row on the current bar prefix, and evaluates
the formula without using future returns.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from platform_sdk.ohlcv import OHLCV


def compute_spec_hash(spec: Dict[str, Any]) -> str:
    payload = {
        "setup_config": spec.get("setup_config") or None,
        "strategy_id": spec.get("strategy_id"),
        "strategy_version_id": spec.get("strategy_version_id"),
    }
    json_str = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(json_str.encode("utf-8")).hexdigest()


def _bars_from_data(data: List[OHLCV]) -> List[Dict[str, Any]]:
    bars = []
    for b in data:
        ts = b.timestamp.strftime("%Y-%m-%d %H:%M:%S") if hasattr(b.timestamp, "strftime") else str(b.timestamp)
        bars.append({
            "timestamp": ts,
            "open": float(b.open),
            "high": float(b.high),
            "low": float(b.low),
            "close": float(b.close),
        })
    return bars


def _placeholder_score(row: List[float]) -> float:
    """Simple score: normalized mean of RSI/100, ATR_norm, and momentum (clamped)."""
    if len(row) < 3:
        return 0.5
    rsi_n = row[0] / 100.0
    atr_n = min(1.0, max(0.0, row[1] * 10))
    mom = max(-1.0, min(1.0, row[2]))
    mom_n = (mom + 1.0) / 2.0
    return (rsi_n + atr_n + mom_n) / 3.0


def run_sr_score_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    if not data or len(data) < 30:
        return []

    setup = spec.get("setup_config", {}) or {}
    formula_id = str(setup.get("formula_id") or "").strip() or None
    score_threshold = float(setup.get("score_threshold", 0.0 if formula_id else 0.5))

    bars = _bars_from_data(data)
    try:
        from sr import build_feature_snapshot_from_bars, evaluate_formula, get_formula
    except ImportError:
        return []

    formula_spec: Optional[Dict[str, Any]] = get_formula(formula_id) if formula_id else None
    feature_config: Dict[str, Any] = {
        "features": (formula_spec or {}).get("feature_specs") or None,
    }
    row, last_meta, feature_names = build_feature_snapshot_from_bars(bars, config=feature_config)
    if len(row) == 0 or not last_meta:
        return []

    last_row = row.tolist()
    if formula_id and formula_spec:
        score = _score_from_formula_spec(formula_spec, last_row, evaluate_formula)
    elif formula_id:
        score = 0.0
    else:
        score = _placeholder_score(last_row)
    n = len(data)
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "sr_score_v1")
    bar_idx = last_meta.get("bar_index", n - 1)
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:12]}_0_{bar_idx}"
    return [_candidate(
        cid,
        svid,
        spec_hash,
        symbol,
        timeframe,
        n,
        score,
        score_threshold,
        bar_idx,
        formula_id=formula_id,
        feature_names=feature_names,
    )]


def _score_from_formula_spec(formula_spec: Dict[str, Any], row: List[float], evaluator) -> float:
    """Evaluate a persisted raw formula against the current feature row."""
    try:
        formula = str(formula_spec.get("formula") or "").strip()
        if not formula:
            return 0.0
        score = float(evaluator(formula, row))
        if score != score or score in (float("inf"), float("-inf")):
            return 0.0
        return score
    except Exception:
        return 0.0


def _candidate(
    candidate_id: str,
    strategy_version_id: str,
    spec_hash: str,
    symbol: str,
    timeframe: str,
    n: int,
    score: float,
    score_threshold: float,
    window_start: int = None,
    formula_id: Optional[str] = None,
    feature_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    if window_start is None:
        window_start = n - 1
    entry_ready = score >= score_threshold
    rule_name = "Predicted Forward Return" if formula_id else "SR Score"
    reason = "prediction >= threshold" if formula_id else ("score >= threshold" if entry_ready else "score < threshold")
    return {
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": round(score, 6),
        "entry_ready": entry_ready,
        "rule_checklist": [
            {
                "rule_name": rule_name,
                "passed": entry_ready,
                "value": round(score, 4),
                "threshold": score_threshold,
            }
        ],
        "anchors": {"signal_bar": window_start},
        "window_start": window_start,
        "window_end": n - 1,
        "pattern_type": "sr_score",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": [],
        "node_result": {
            "passed": entry_ready,
            "score": round(score, 6),
            "features": {
                "score": score,
                "threshold": score_threshold,
                "formula_id": formula_id,
                "feature_names": feature_names or [],
            },
            "anchors": {"signal_bar": window_start},
            "reason": reason,
        },
        "output_ports": {
            "signal": {"passed": entry_ready, "score": round(score, 6), "reason": "sr_score"},
        },
        "formula_id": formula_id,
    }