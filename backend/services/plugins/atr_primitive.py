#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List

import numpy as np

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.primitive_adapters import compute_atr_adapter


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


def run_atr_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    setup = spec.get("setup_config", {}) or {}
    atr_period = int(setup.get("atr_period", 14))
    normalize_by_price = bool(setup.get("normalize_by_price", True))

    if len(data) < max(atr_period + 1, 5):
        return []

    adapted = compute_atr_adapter(data, atr_period)
    atr_values = adapted["values"]
    atr_pct = adapted["atr_pct"]
    readiness = adapted["readiness"]
    first_valid_index = readiness.get("first_valid_index")
    if first_valid_index is None:
        return []

    last_idx = len(data) - 1
    atr_current = atr_values[last_idx]
    atr_prev = atr_values[last_idx - 1] if last_idx - 1 >= 0 else np.nan
    atr_pct_current = atr_pct[last_idx]
    atr_pct_prev = atr_pct[last_idx - 1] if last_idx - 1 >= 0 else np.nan

    if np.isnan(atr_current):
        return []

    use_pct = normalize_by_price and not np.isnan(atr_pct_current)
    current_value = float(atr_pct_current if use_pct else atr_current)
    prior_value = float(atr_pct_prev if use_pct and not np.isnan(atr_pct_prev) else (atr_prev if not np.isnan(atr_prev) else atr_current))
    slope = current_value - prior_value

    is_intraday = _detect_intraday(data)
    chart_data = []
    overlay_data = []
    for idx, bar in enumerate(data):
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t is None:
            continue
        chart_data.append({
            "time": t,
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
        })
        series_value = atr_pct[idx] if use_pct else atr_values[idx]
        if np.isnan(series_value):
            continue
        overlay_data.append({
            "time": t,
            "value": round(float(series_value), 6),
        })

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    strategy_version_id = spec.get("strategy_version_id", "atr_primitive_v1")
    candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash[:12]}_0_{last_idx}"
    timestamp = getattr(data[last_idx], "timestamp", "")

    value_label = "ATR %" if use_pct else "ATR"
    reason = f"{value_label} context ready ({current_value:.6f})"

    return [{
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": 0.0,
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "ATR Ready",
                "passed": True,
                "value": round(current_value, 6),
                "threshold": f"{atr_period} bars",
            }
        ],
        "anchors": {
            "context_bar": {"index": last_idx, "timestamp": timestamp},
        },
        "window_start": 0,
        "window_end": last_idx,
        "pattern_type": "atr_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": chart_data,
        "visual": {
            "markers": [],
            "overlay_series": [
                {
                    "title": f"{value_label}({atr_period})",
                    "pane": "sub",
                    "lines": [
                        {
                            "data": overlay_data,
                            "color": "#14b8a6",
                            "lineWidth": 2,
                            "title": f"{value_label}({atr_period})",
                        }
                    ],
                }
            ],
        },
        "node_result": {
            "passed": True,
            "score": 0.0,
            "features": {
                "atr_period": atr_period,
                "normalize_by_price": normalize_by_price,
                "atr_current": round(float(atr_current), 6),
                "atr_pct_current": round(float(atr_pct_current), 6) if not np.isnan(atr_pct_current) else None,
                "current_value": round(current_value, 6),
                "prior_value": round(prior_value, 6),
                "slope": round(float(slope), 6),
                "readiness": readiness,
            },
            "anchors": {"context_bar": {"index": last_idx, "timestamp": timestamp}},
            "reason": reason,
        },
        "output_ports": {
            "signal": {
                "passed": False,
                "score": 0.0,
                "reason": reason,
            },
        },
    }]
