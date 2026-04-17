#!/usr/bin/env python3
"""
Valuation State Primitive.

Makes Ledger's PIT valuation state usable as a first-class indicator:
- Scanner: filter for currently undervalued / fair / overvalued names
- Indicator Studio: compose with other primitives
- Validator: run historically without leaking today's valuation backward

This primitive rebuilds valuation state as of the last visible bar date using
the same point-in-time DCF research logic used by the valuation studies. When
the bar date is near the latest valuation snapshot, it uses the persisted
snapshot as a fast path.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_SERVICES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_SCRIPTS_DIR = os.path.join(_ROOT, "backend", "scripts")
_DATA_DIR = os.path.join(_ROOT, "backend", "data")
_RESEARCH_DIR = os.path.join(_DATA_DIR, "research")
_VALUATION_SNAPSHOT_PATH = os.path.join(_RESEARCH_DIR, "valuation_universe_snapshot.json")

if _SERVICES_DIR not in sys.path:
    sys.path.insert(0, _SERVICES_DIR)

from platform_sdk.ohlcv import OHLCV

_STUDY_MODULE = None
_PIT_CONN = None
_VALUATION_CACHE: Dict[Tuple[str, str, float, float], Optional[Dict[str, Any]]] = {}
_SNAPSHOT_INDEX: Optional[Dict[str, Dict[str, Any]]] = None
_SNAPSHOT_GENERATED_AT: Optional[datetime] = None


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


def _safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _parse_date(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except Exception:
        return None


def _load_study_module():
    global _STUDY_MODULE
    if _STUDY_MODULE is not None:
        return _STUDY_MODULE

    script_path = os.path.join(_SCRIPTS_DIR, "run_valuation_gap_accuracy_study.py")
    spec = importlib.util.spec_from_file_location("valuation_gap_accuracy_study", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load valuation gap study module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _STUDY_MODULE = module
    return module


def _get_pit_conn():
    global _PIT_CONN
    if _PIT_CONN is not None:
        return _PIT_CONN
    mod = _load_study_module()
    _PIT_CONN = mod.connect_pit(str(mod.DEFAULT_DB_PATH))
    mod.ensure_schema(_PIT_CONN)
    return _PIT_CONN


def _load_snapshot_index() -> Tuple[Dict[str, Dict[str, Any]], Optional[datetime]]:
    global _SNAPSHOT_INDEX, _SNAPSHOT_GENERATED_AT
    if _SNAPSHOT_INDEX is not None:
        return _SNAPSHOT_INDEX, _SNAPSHOT_GENERATED_AT

    rows_by_symbol: Dict[str, Dict[str, Any]] = {}
    generated_at: Optional[datetime] = None

    try:
        if os.path.exists(_VALUATION_SNAPSHOT_PATH):
            payload = json.loads(open(_VALUATION_SNAPSHOT_PATH, "r", encoding="utf-8").read())
            generated_at = _parse_date(((payload or {}).get("meta") or {}).get("generated_at"))
            for row in (payload or {}).get("rows", []) or []:
                symbol = str((row or {}).get("symbol") or "").strip().upper()
                if symbol:
                    rows_by_symbol[symbol] = dict(row)
    except Exception:
        rows_by_symbol = {}
        generated_at = None

    _SNAPSHOT_INDEX = rows_by_symbol
    _SNAPSHOT_GENERATED_AT = generated_at
    return rows_by_symbol, generated_at


def _days_between(a: Optional[datetime], b: Optional[datetime]) -> Optional[int]:
    if a is None or b is None:
        return None
    return abs((a.date() - b.date()).days)


def _score_for_state(state: str, gap_pct: float, threshold_pct: float) -> float:
    if state == "roughly_fair":
        return max(0.0, threshold_pct - abs(gap_pct))
    return abs(gap_pct)


def _direction_hint_for_state(state: str) -> str:
    if state == "undervalued":
        return "long"
    if state == "overvalued":
        return "short"
    return "neutral"


def _build_from_snapshot(
    symbol: str,
    asof_date: str,
    current_price: float,
    gap_threshold_pct: float,
) -> Optional[Dict[str, Any]]:
    rows_by_symbol, generated_at = _load_snapshot_index()
    row = rows_by_symbol.get(symbol)
    if not row:
        return None

    row_asof = _parse_date(row.get("asof_date"))
    current_dt = _parse_date(asof_date)
    age_from_snapshot = _days_between(current_dt, generated_at)
    age_from_row = _days_between(current_dt, row_asof)
    if age_from_snapshot is None or age_from_row is None or age_from_snapshot > 14 or age_from_row > 14:
        return None

    fair_value_mid = _safe_float(row.get("fair_value_mid"))
    fair_value_low = _safe_float(row.get("fair_value_low"))
    fair_value_high = _safe_float(row.get("fair_value_high"))
    if current_price <= 0 or fair_value_mid is None:
        return None

    mod = _load_study_module()
    valuation_gap_pct = ((fair_value_mid - current_price) / current_price) * 100.0
    valuation_state = mod._valuation_state(valuation_gap_pct, gap_threshold_pct)
    return {
        "asof_date": asof_date,
        "current_price": current_price,
        "fair_value_low": fair_value_low,
        "fair_value_mid": fair_value_mid,
        "fair_value_high": fair_value_high,
        "valuation_gap_pct": valuation_gap_pct,
        "valuation_state": valuation_state,
        "quality_grade": str(row.get("quality_grade") or "unknown"),
        "quality_score": int(_safe_float(row.get("quality_score")) or 0),
        "coverage_mode": "valuation_snapshot_fast_path",
        "revenue_growth_pct": _safe_float(row.get("revenue_growth_pct")),
        "operating_margin_pct": _safe_float(row.get("operating_margin_pct")),
        "free_cash_flow_margin_pct": _safe_float(row.get("free_cash_flow_margin_pct")),
    }


def _build_from_pit(
    symbol: str,
    asof_date: str,
    current_price: float,
    gap_threshold_pct: float,
) -> Optional[Dict[str, Any]]:
    mod = _load_study_module()
    conn = _get_pit_conn()
    snapshot = mod.get_asof_snapshot(conn, symbol, asof_date)
    if not snapshot:
        return None

    annual_rows = mod.get_statement_history(
        conn,
        symbol,
        "annual",
        asof_date,
        fact_keys=mod.DCF_FACT_KEYS,
    )
    annuals = mod._group_annual_periods(annual_rows)
    if not annuals:
        return None

    latest_annual = annuals[0]
    prior_annual = annuals[1] if len(annuals) > 1 else None
    dcf = mod._build_standardized_dcf(snapshot, latest_annual, prior_annual, current_price)
    if not dcf:
        return None

    valuation_state = mod._valuation_state(float(dcf["valuation_gap_pct"]), gap_threshold_pct)
    return {
        "asof_date": asof_date,
        "current_price": current_price,
        "fair_value_low": float(dcf["fair_value_low"]),
        "fair_value_mid": float(dcf["fair_value_mid"]),
        "fair_value_high": float(dcf["fair_value_high"]),
        "valuation_gap_pct": float(dcf["valuation_gap_pct"]),
        "valuation_state": valuation_state,
        "quality_grade": str(dcf.get("quality_grade") or "unknown"),
        "quality_score": int(dcf.get("quality_score") or 0),
        "coverage_mode": mod._coverage_mode(latest_annual, snapshot),
        "revenue_growth_pct": _safe_float(dcf.get("revenue_growth_pct")),
        "operating_margin_pct": _safe_float(dcf.get("operating_margin_pct")),
        "free_cash_flow_margin_pct": _safe_float(dcf.get("free_cash_flow_margin_pct")),
    }


def _valuation_signal_for_bar(
    symbol: str,
    asof_date: str,
    current_price: float,
    gap_threshold_pct: float,
) -> Optional[Dict[str, Any]]:
    cache_key = (symbol, asof_date, round(float(current_price), 6), round(float(gap_threshold_pct), 6))
    if cache_key in _VALUATION_CACHE:
        return _VALUATION_CACHE[cache_key]

    signal = _build_from_snapshot(symbol, asof_date, current_price, gap_threshold_pct)
    if signal is None:
        signal = _build_from_pit(symbol, asof_date, current_price, gap_threshold_pct)

    _VALUATION_CACHE[cache_key] = signal
    return signal


def _previous_bar_date(data: List[OHLCV]) -> Optional[str]:
    if len(data) < 2:
        return None
    for bar in reversed(data[:-1]):
        ts = str(getattr(bar, "timestamp", "") or "")[:10]
        if ts:
            return ts
    return None


def run_valuation_state_primitive_plugin(
    data: List[OHLCV],
    structure: Any,
    spec: Dict[str, Any],
    symbol: str,
    timeframe: str,
    **kwargs: Any,
) -> List[Dict[str, Any]]:
    setup = spec.get("setup_config", {}) or {}
    target_state = str(setup.get("target_state") or "undervalued").strip().lower()
    if target_state == "fair":
        target_state = "roughly_fair"
    signal_mode = str(setup.get("signal_mode") or "current_state").strip().lower()
    gap_threshold_pct = float(setup.get("gap_threshold_pct", 20.0) or 20.0)

    if not data:
        return []

    last_bar = data[-1]
    asof_date = str(getattr(last_bar, "timestamp", "") or "")[:10]
    current_price = _safe_float(getattr(last_bar, "close", None))
    if not asof_date or current_price in (None, 0):
        return []

    current_signal = _valuation_signal_for_bar(symbol, asof_date, float(current_price), gap_threshold_pct)
    if not current_signal:
        return []

    current_state = str(current_signal.get("valuation_state") or "")
    matches_target = current_state == target_state
    if signal_mode == "state_transition":
        previous_date = _previous_bar_date(data)
        previous_state = None
        if previous_date:
            previous_close = _safe_float(getattr(data[-2], "close", None))
            if previous_close not in (None, 0):
                previous_signal = _valuation_signal_for_bar(symbol, previous_date, float(previous_close), gap_threshold_pct)
                previous_state = str((previous_signal or {}).get("valuation_state") or "")
        matches_target = matches_target and previous_state != target_state

    if not matches_target:
        return []

    strategy_version_id = spec.get(
        "strategy_version_id",
        f"{spec.get('strategy_id', 'unknown')}_v{spec.get('version', '0')}",
    )
    spec_hash = spec.get("spec_hash") or compute_spec_hash(spec)
    spec_hash_short = spec_hash[:8]
    n = len(data)
    candidate_id = f"{symbol}_{timeframe}_{strategy_version_id}_{spec_hash_short}_0_{n - 1}"
    gap_pct = float(current_signal["valuation_gap_pct"])
    score = _score_for_state(target_state, gap_pct, gap_threshold_pct)
    direction_hint = _direction_hint_for_state(current_state)

    anchors = {
        "valuation_state": current_state,
        "valuation_gap_pct": gap_pct,
        "fair_value_low": current_signal.get("fair_value_low"),
        "fair_value_mid": current_signal.get("fair_value_mid"),
        "fair_value_high": current_signal.get("fair_value_high"),
        "current_price": current_signal.get("current_price"),
        "asof_date": current_signal.get("asof_date"),
        "quality_grade": current_signal.get("quality_grade"),
        "quality_score": current_signal.get("quality_score"),
        "coverage_mode": current_signal.get("coverage_mode"),
        "revenue_growth_pct": current_signal.get("revenue_growth_pct"),
        "operating_margin_pct": current_signal.get("operating_margin_pct"),
        "free_cash_flow_margin_pct": current_signal.get("free_cash_flow_margin_pct"),
        "direction_hint": direction_hint,
    }

    reason = f"Valuation state is {current_state} ({gap_pct:.1f}% gap vs fair value)"
    return [{
        "candidate_id": candidate_id,
        "id": candidate_id,
        "strategy_version_id": strategy_version_id,
        "spec_hash": spec_hash,
        "symbol": symbol,
        "timeframe": timeframe,
        "score": score,
        "entry_ready": True,
        "rule_checklist": [
            {
                "rule_name": "valuation_state_matches",
                "passed": True,
                "value": current_state,
                "threshold": target_state,
            },
            {
                "rule_name": "valuation_gap_threshold",
                "passed": True,
                "value": round(gap_pct, 2),
                "threshold": gap_threshold_pct,
            },
        ],
        "anchors": anchors,
        "window_start": 0,
        "window_end": n - 1,
        "pattern_type": "valuation_state_primitive",
        "created_at": datetime.utcnow().isoformat() + "Z",
        "chart_data": [],
        "node_result": {
            "passed": True,
            "score": score,
            "reason": reason,
            "features": {
                "valuation_state": current_state,
                "direction_hint": direction_hint,
                "quality_grade": current_signal.get("quality_grade"),
                "coverage_mode": current_signal.get("coverage_mode"),
            },
            "anchors": anchors,
        },
        "output_ports": {
            "signal": {
                "passed": True,
                "state": current_state,
                "gap_pct": gap_pct,
                "direction_hint": direction_hint,
                "reason": reason,
            },
            "valuation": anchors,
        },
    }]
