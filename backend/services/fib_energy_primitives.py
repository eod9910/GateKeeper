#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Tuple

from platform_sdk.ohlcv import OHLCV, _detect_intraday, _format_chart_time
from platform_sdk.fib_analysis import calculate_fib_energy_signal


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


def _as_str_list(value: Any, default: List[str]) -> List[str]:
    if isinstance(value, list):
        out = [str(x).strip() for x in value if str(x).strip()]
        return out or default
    if isinstance(value, str) and value.strip():
        return [v.strip() for v in value.split(",") if v.strip()] or default
    return default


def resolve_fib_signal(
    data: List[OHLCV], symbol: str, timeframe: str, setup: Dict[str, Any]
) -> Tuple[Any, float]:
    proximity_pct = float(setup.get("fib_proximity", 3.0))
    fib_signal = calculate_fib_energy_signal(
        data, symbol, timeframe, proximity_pct=proximity_pct
    )
    return fib_signal, proximity_pct


def evaluate_structure_stage(fib_signal: Any) -> Dict[str, Any]:
    has_anchors = (
        fib_signal is not None
        and fib_signal.range_high is not None
        and fib_signal.range_low is not None
        and float(fib_signal.range_high) > float(fib_signal.range_low)
    )
    return {
        "passed": bool(has_anchors),
        "score": 1.0 if has_anchors else 0.0,
        "features": {
            "range_high": fib_signal.range_high if fib_signal else None,
            "range_low": fib_signal.range_low if fib_signal else None,
        },
        "anchors": {
            "range_high": {
                "price": fib_signal.range_high if fib_signal else None,
                "date": fib_signal.range_high_date if fib_signal else None,
            },
            "range_low": {
                "price": fib_signal.range_low if fib_signal else None,
                "date": fib_signal.range_low_date if fib_signal else None,
            },
        },
        "reason": "valid_fib_range" if has_anchors else "missing_range_anchors",
    }


def evaluate_location_stage(
    fib_signal: Any, setup: Dict[str, Any]
) -> Dict[str, Any]:
    min_ret = float(setup.get("location_min_retracement_pct", 50.0))
    max_ret = float(setup.get("location_max_retracement_pct", 79.0))
    require_near = bool(setup.get("location_require_near_level", False))

    retracement = float(fib_signal.current_retracement_pct)
    nearest = fib_signal.nearest_level
    in_zone = min_ret <= retracement <= max_ret
    near_ok = bool(nearest and nearest.is_near) if require_near else True
    passed = bool(in_zone and near_ok)

    if not in_zone:
        reason = f"retracement_outside_{min_ret:.0f}_{max_ret:.0f}"
    elif not near_ok:
        reason = "nearest_fib_not_within_proximity"
    else:
        reason = "location_valid"

    return {
        "passed": passed,
        "score": 1.0 if passed else 0.0,
        "features": {
            "retracement_pct": round(retracement, 2),
            "min_retracement_pct": min_ret,
            "max_retracement_pct": max_ret,
            "require_near_level": require_near,
            "nearest_level": nearest.level_name if nearest else None,
            "nearest_level_price": nearest.price if nearest else None,
            "nearest_level_distance_pct": nearest.distance_pct if nearest else None,
            "nearest_level_is_near": bool(nearest and nearest.is_near),
        },
        "anchors": {
            "range_high": {"price": fib_signal.range_high, "date": fib_signal.range_high_date},
            "range_low": {"price": fib_signal.range_low, "date": fib_signal.range_low_date},
            "nearest_fib": (
                {
                    "level": nearest.level_name,
                    "price": nearest.price,
                    "distance_pct": nearest.distance_pct,
                }
                if nearest
                else None
            ),
        },
        "reason": reason,
    }


def evaluate_energy_stage(
    fib_signal: Any, setup: Dict[str, Any]
) -> Dict[str, Any]:
    allowed_states = _as_str_list(
        setup.get("energy_allowed_states"), ["EXHAUSTED", "RECOVERING", "WANING"]
    )
    require_pressure = bool(setup.get("energy_require_pressure_max", True))
    pressure_max = float(setup.get("energy_pressure_max", 30.0))
    require_declining = bool(setup.get("energy_require_declining_pressure", False))

    energy = fib_signal.energy
    pressure = fib_signal.selling_pressure
    state_ok = energy.character_state in allowed_states
    pressure_ok = True
    if require_pressure:
        pressure_ok = bool(pressure and pressure.current_pressure <= pressure_max)
    declining_ok = True
    if require_declining:
        declining_ok = bool(pressure and pressure.pressure_trend == "DECREASING")

    passed = bool(state_ok and pressure_ok and declining_ok)

    if not state_ok:
        reason = "energy_state_not_allowed"
    elif not pressure_ok:
        reason = "pressure_above_threshold"
    elif not declining_ok:
        reason = "pressure_not_declining"
    else:
        reason = "energy_valid"

    return {
        "passed": passed,
        "score": 1.0 if passed else 0.0,
        "features": {
            "energy_state": energy.character_state,
            "energy_direction": energy.direction,
            "energy_score": energy.energy_score,
            "allowed_states": allowed_states,
            "selling_pressure": pressure.current_pressure if pressure else None,
            "pressure_trend": pressure.pressure_trend if pressure else None,
            "pressure_max": pressure_max,
            "require_pressure_max": require_pressure,
            "require_declining_pressure": require_declining,
        },
        "anchors": {},
        "reason": reason,
    }


def evaluate_trigger_stage(
    fib_signal: Any, setup: Dict[str, Any]
) -> Dict[str, Any]:
    allowed_signals = _as_str_list(
        setup.get("trigger_allowed_signals"), ["POTENTIAL_ENTRY", "CONFIRMED_ENTRY"]
    )
    signal = str(fib_signal.signal)
    passed = signal in allowed_signals
    return {
        "passed": passed,
        "score": 1.0 if passed else 0.0,
        "features": {
            "signal": signal,
            "signal_reason": fib_signal.signal_reason,
            "allowed_signals": allowed_signals,
        },
        "anchors": {},
        "reason": "trigger_fired" if passed else "trigger_not_fired",
    }


def build_chart_data(data: List[OHLCV]) -> List[Dict[str, float]]:
    is_intraday = _detect_intraday(data)
    out: List[Dict[str, float]] = []
    for bar in data:
        t = _format_chart_time(bar.timestamp, is_intraday)
        if t is not None:
            out.append(
                {
                    "time": t,
                    "open": float(bar.open),
                    "high": float(bar.high),
                    "low": float(bar.low),
                    "close": float(bar.close),
                }
            )
    return out

