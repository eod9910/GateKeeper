#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from platform_sdk.ohlcv import OHLCV
from fib_energy_primitives import (
    build_chart_data,
    compute_spec_hash,
    evaluate_trigger_stage,
    resolve_fib_signal,
)


def run_fib_signal_trigger_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    """
    Primitive intent=TRIGGER.
    Answers only: Did the configured Fib/Energy trigger fire now?

    Pipeline mode: Can accept upstream 'fib_levels' but currently
    still resolves its own fib_signal for trigger evaluation.
    """
    setup = spec.get("setup_config", {}) or {}
    fib_signal, _ = resolve_fib_signal(data, symbol, timeframe, setup)
    if fib_signal is None:
        return []

    stage = evaluate_trigger_stage(fib_signal, setup)
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "fib_signal_trigger_primitive_v1")
    window_start = 0
    window_end = len(data) - 1
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:8]}_{window_start}_{window_end}"

    candidate = {
        "candidate_id": cid,
        "id": cid,
        "strategy_version_id": svid,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": stage["score"],
        "entry_ready": False,
        "rule_checklist": [
            {
                "rule_name": "fib signal trigger",
                "passed": stage["passed"],
                "value": stage["reason"],
                "threshold": True,
            }
        ],
        "anchors": {},
        "window_start": window_start,
        "window_end": window_end,
        "pattern_type": "fib_signal_trigger_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": build_chart_data(data),
        "node_result": stage,
        "output_ports": {
            "signal": {
                "passed": stage.get("passed", False),
                "score": stage.get("score", 0.0),
                "reason": stage.get("reason", "unknown"),
            },
        },
    }
    return [candidate]

