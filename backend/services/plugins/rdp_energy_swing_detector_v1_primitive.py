#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json
from datetime import datetime
from typing import Any, Dict, List
from platform_sdk.ohlcv import OHLCV
from platform_sdk.rdp import detect_swings_rdp, clear_rdp_cache
from platform_sdk.energy import calculate_energy_state

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

def _time_to_safe_str(t) -> str:
    """Convert a marker time value to a filesystem-safe string (no colons)."""
    if isinstance(t, dict):
        return f"{t['year']}-{t.get('month', 1):02d}-{t.get('day', 1):02d}"
    return str(t)

def _format_time_str(bar, intraday: bool = False):
    """Return marker time matching chart_data format (unix sec for intraday, date for higher TF)."""
    ts = bar.timestamp
    if isinstance(ts, (int, float)):
        if intraday:
            return int(ts)
        from datetime import datetime as dt
        return dt.utcfromtimestamp(ts).strftime("%Y-%m-%d")
    if isinstance(ts, str):
        if intraday:
            try:
                d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                return int(d.timestamp())
            except Exception:
                try:
                    from datetime import datetime as dt
                    d = dt.strptime(ts[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
                    return int(d.timestamp())
                except Exception:
                    pass
        return ts[:10]
    return str(ts)[:10]

def _build_chart_data(data: List[OHLCV], is_intraday: bool) -> List[Dict[str, Any]]:
    """Build LightweightCharts-compatible OHLCV array from scanner bars."""
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
                    d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    time_val = int(d.timestamp())
                except Exception:
                    try:
                        from datetime import datetime as dt
                        d = dt.strptime(ts[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
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

def run_rdp_energy_swing_detector_v1_primitive_plugin(
    data: List[OHLCV], structure: Any, spec: Dict[str, Any],
    symbol: str, timeframe: str, **kwargs: Any,
) -> List[Dict[str, Any]]:
    setup = spec.get("setup_config", {}) or {}
    epsilon_pct = float(setup.get("epsilon_pct", 0.05))
    energy_window = int(setup.get("energy_window", 2))
    require_energy = bool(setup.get("require_energy", True))
    use_exact_epsilon = bool(setup.get("use_exact_epsilon", False))

    # RDP cache historically keyed by epsilon but not exact/adaptive mode.
    # For chart diagnostics, force exact-mode calls to bypass stale adaptive
    # cache entries so epsilon changes are reflected immediately.
    if use_exact_epsilon:
        try:
            clear_rdp_cache()
        except Exception:
            pass

    swing_struct = detect_swings_rdp(
        data,
        symbol,
        timeframe,
        epsilon_pct=epsilon_pct,
        use_exact_epsilon=use_exact_epsilon,
    )
    intra = _is_intraday(timeframe)

    all_markers = []
    swing_summaries = []
    best_confidence = 0

    for sp in swing_struct.swing_points:
        idx = sp.index
        energy_states = []
        if require_energy:
            for offset in range(-energy_window, energy_window + 1):
                if 0 <= idx + offset < len(data):
                    energy = calculate_energy_state(data[:idx + offset + 1], timeframe=timeframe)
                    energy_states.append(energy.character_state)

        if sp.point_type == 'HIGH':
            if require_energy and not ('WANING' in energy_states or 'EXHAUSTED' in energy_states):
                continue
            confidence = 50
            if 'EXHAUSTED' in energy_states: confidence = 100
            elif 'WANING' in energy_states: confidence = 70
            commentary = f"Swing HIGH at {sp.price:.2f} on {sp.date}" + (f" — energy: {', '.join(set(energy_states))}" if energy_states else "")
            all_markers.append({
                "time": _format_time_str(data[idx], intra),
                "position": "aboveBar", "color": "#ef4444",
                "shape": "arrowDown", "text": f"H ${sp.price:.0f}",
            })
            swing_summaries.append({"rule_name": commentary, "passed": True, "value": confidence, "threshold": 70})
            best_confidence = max(best_confidence, confidence)

        elif sp.point_type == 'LOW':
            if require_energy and not ('RECOVERING' in energy_states or 'STRONG' in energy_states):
                continue
            confidence = 50
            if 'STRONG' in energy_states: confidence = 100
            elif 'RECOVERING' in energy_states: confidence = 70
            commentary = f"Swing LOW at {sp.price:.2f} on {sp.date}" + (f" — energy: {', '.join(set(energy_states))}" if energy_states else "")
            all_markers.append({
                "time": _format_time_str(data[idx], intra),
                "position": "belowBar", "color": "#22c55e",
                "shape": "arrowUp", "text": f"L ${sp.price:.0f}",
            })
            swing_summaries.append({"rule_name": commentary, "passed": True, "value": confidence, "threshold": 70})
            best_confidence = max(best_confidence, confidence)

    if not all_markers:
        return []

    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    svid = spec.get("strategy_version_id", "rdp_energy_swing_detector_v1")
    cid = f"{symbol}_{timeframe}_{svid}_{spec_hash[:12]}_swing_structure"

    chart_data = _build_chart_data(data, intra)

    return [{
        "candidate_id": cid, "id": cid,
        "strategy_version_id": svid, "spec_hash": spec_hash,
        "symbol": symbol, "timeframe": timeframe,
        "score": best_confidence / 100.0, "entry_ready": False,
        "rule_checklist": swing_summaries,
        "anchors": {}, "window_start": 0, "window_end": len(data) - 1,
        "pattern_type": "rdp_energy_swing_detector",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": chart_data,
        "visual": {
            "markers": all_markers,
            "overlay_series": [],
        },
        "node_result": {
            "passed": True,
            "score": best_confidence / 100.0,
            "features": {
                "swing_count": len(all_markers),
                "epsilon_pct": epsilon_pct,
                "use_exact_epsilon": use_exact_epsilon,
                "require_energy": require_energy,
            },
            "anchors": {},
            "reason": f"{len(all_markers)} swing points detected",
        },
        "output_ports": {
            "signal": {
                "passed": True,
                "score": best_confidence / 100.0,
                "reason": f"{len(all_markers)} swing points detected",
            },
        },
    }]
