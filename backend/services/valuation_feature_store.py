#!/usr/bin/env python3
"""
Canonical valuation feature access for Python research tools.

This module is the first doorway for valuation features. It normalizes the
existing PIT valuation primitive behind a stable function so consumers do not
need to know where valuation data is stored or how it is rebuilt.
"""
from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
APP_STATE_DB_PATH = DATA_DIR / "app-state.sqlite"
VALUATION_STATE_PRIMITIVE_PATH = ROOT / "backend" / "services" / "plugins" / "valuation_state_primitive.py"
DEFAULT_GAP_THRESHOLD_PCT = 20.0

_VALUATION_SIGNAL_FUNC = None


def _safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _load_valuation_signal_func():
    global _VALUATION_SIGNAL_FUNC
    if _VALUATION_SIGNAL_FUNC is not None:
        return _VALUATION_SIGNAL_FUNC
    if not VALUATION_STATE_PRIMITIVE_PATH.exists():
        return None
    try:
        spec = importlib.util.spec_from_file_location("valuation_state_primitive_feature_store", VALUATION_STATE_PRIMITIVE_PATH)
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        func = getattr(module, "_valuation_signal_for_bar", None)
        _VALUATION_SIGNAL_FUNC = func if callable(func) else None
    except Exception:
        _VALUATION_SIGNAL_FUNC = None
    return _VALUATION_SIGNAL_FUNC


def ensure_valuation_feature_schema(db_path: Path = APP_STATE_DB_PATH) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS valuation_features (
              symbol TEXT NOT NULL,
              asof_date TEXT NOT NULL,
              current_price REAL,
              fair_value_low REAL,
              fair_value_mid REAL,
              fair_value_high REAL,
              valuation_gap_pct REAL,
              valuation_state TEXT,
              quality_score REAL,
              quality_grade TEXT,
              coverage_mode TEXT,
              engine_class TEXT,
              source TEXT NOT NULL,
              gap_threshold_pct REAL NOT NULL DEFAULT 20.0,
              computed_at TEXT NOT NULL DEFAULT (datetime('now')),
              PRIMARY KEY (symbol, asof_date, gap_threshold_pct)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_valuation_features_asof ON valuation_features(asof_date, symbol)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_valuation_features_state ON valuation_features(valuation_state, asof_date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_valuation_features_source ON valuation_features(source, coverage_mode)")
        conn.commit()
    finally:
        conn.close()


def get_persisted_valuation_features(
    symbol: str,
    asof_date: str,
    *,
    gap_threshold_pct: float = DEFAULT_GAP_THRESHOLD_PCT,
    db_path: Path = APP_STATE_DB_PATH,
) -> Optional[Dict[str, Any]]:
    ensure_valuation_feature_schema(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            """
            SELECT *
            FROM valuation_features
            WHERE symbol = ? AND asof_date = ? AND gap_threshold_pct = ?
            """,
            (str(symbol).strip().upper(), str(asof_date)[:10], float(gap_threshold_pct)),
        ).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


def upsert_valuation_features(
    features: Dict[str, Any],
    *,
    gap_threshold_pct: float = DEFAULT_GAP_THRESHOLD_PCT,
    db_path: Path = APP_STATE_DB_PATH,
) -> None:
    if not features:
        return
    ensure_valuation_feature_schema(db_path)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            INSERT INTO valuation_features (
              symbol, asof_date, current_price, fair_value_low, fair_value_mid, fair_value_high,
              valuation_gap_pct, valuation_state, quality_score, quality_grade, coverage_mode,
              engine_class, source, gap_threshold_pct, computed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(symbol, asof_date, gap_threshold_pct) DO UPDATE SET
              current_price = excluded.current_price,
              fair_value_low = excluded.fair_value_low,
              fair_value_mid = excluded.fair_value_mid,
              fair_value_high = excluded.fair_value_high,
              valuation_gap_pct = excluded.valuation_gap_pct,
              valuation_state = excluded.valuation_state,
              quality_score = excluded.quality_score,
              quality_grade = excluded.quality_grade,
              coverage_mode = excluded.coverage_mode,
              engine_class = excluded.engine_class,
              source = excluded.source,
              computed_at = excluded.computed_at
            """,
            (
                str(features.get("symbol") or "").strip().upper(),
                str(features.get("asof_date") or "")[:10],
                _safe_float(features.get("current_price")),
                _safe_float(features.get("fair_value_low")),
                _safe_float(features.get("fair_value_mid")),
                _safe_float(features.get("fair_value_high")),
                _safe_float(features.get("valuation_gap_pct")),
                features.get("valuation_state"),
                _safe_float(features.get("quality_score")),
                features.get("quality_grade"),
                features.get("coverage_mode"),
                features.get("engine_class"),
                features.get("source") or "valuation_feature_store",
                float(gap_threshold_pct),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_valuation_features(
    symbol: str,
    asof_date: str,
    current_price: Optional[float],
    *,
    gap_threshold_pct: float = DEFAULT_GAP_THRESHOLD_PCT,
    prefer_persisted: bool = True,
    persist: bool = False,
) -> Optional[Dict[str, Any]]:
    if not symbol or not asof_date or current_price is None or current_price <= 0:
        return None
    if prefer_persisted:
        persisted = get_persisted_valuation_features(symbol, asof_date, gap_threshold_pct=gap_threshold_pct)
        if persisted:
            return persisted
    func = _load_valuation_signal_func()
    if func is None:
        return None
    try:
        signal = func(str(symbol).strip().upper(), str(asof_date)[:10], float(current_price), float(gap_threshold_pct))
    except Exception:
        return None
    if not isinstance(signal, dict):
        return None

    features = {
        "symbol": str(symbol).strip().upper(),
        "asof_date": str(signal.get("asof_date") or asof_date)[:10],
        "current_price": _safe_float(signal.get("current_price")) or float(current_price),
        "fair_value_low": _safe_float(signal.get("fair_value_low")),
        "fair_value_mid": _safe_float(signal.get("fair_value_mid")),
        "fair_value_high": _safe_float(signal.get("fair_value_high")),
        "valuation_gap_pct": _safe_float(signal.get("valuation_gap_pct")),
        "valuation_state": str(signal.get("valuation_state") or "").strip() or None,
        "quality_score": _safe_float(signal.get("quality_score")),
        "quality_grade": str(signal.get("quality_grade") or "").strip() or None,
        "coverage_mode": str(signal.get("coverage_mode") or "").strip() or None,
        "engine_class": str(signal.get("engine_class") or "").strip() or None,
        "source": "valuation_state_primitive",
    }
    if persist:
        upsert_valuation_features(features, gap_threshold_pct=gap_threshold_pct)
    return features


def valuation_feature_coverage(
    symbols: Iterable[str],
    asof_dates: Iterable[str],
    *,
    gap_threshold_pct: float = DEFAULT_GAP_THRESHOLD_PCT,
    db_path: Path = APP_STATE_DB_PATH,
) -> Dict[str, Any]:
    symbol_set = {str(symbol or "").strip().upper() for symbol in symbols if str(symbol or "").strip()}
    date_set = {str(date or "")[:10] for date in asof_dates if str(date or "").strip()}
    expected = len(symbol_set) * len(date_set)
    if expected <= 0:
        return {"expected": 0, "available": 0, "missing": 0, "coverage_pct": None, "by_source": {}, "by_coverage_mode": {}}
    ensure_valuation_feature_schema(db_path)
    conn = sqlite3.connect(str(db_path))
    try:
        placeholders_symbols = ",".join("?" for _ in symbol_set)
        placeholders_dates = ",".join("?" for _ in date_set)
        params = [*sorted(symbol_set), *sorted(date_set), float(gap_threshold_pct)]
        available = conn.execute(
            f"""
            SELECT COUNT(*) FROM valuation_features
            WHERE symbol IN ({placeholders_symbols})
              AND asof_date IN ({placeholders_dates})
              AND gap_threshold_pct = ?
            """,
            params,
        ).fetchone()[0]
        by_source = dict(conn.execute(
            f"""
            SELECT COALESCE(source, 'unknown'), COUNT(*) FROM valuation_features
            WHERE symbol IN ({placeholders_symbols})
              AND asof_date IN ({placeholders_dates})
              AND gap_threshold_pct = ?
            GROUP BY COALESCE(source, 'unknown')
            """,
            params,
        ).fetchall())
        by_coverage_mode = dict(conn.execute(
            f"""
            SELECT COALESCE(coverage_mode, 'unknown'), COUNT(*) FROM valuation_features
            WHERE symbol IN ({placeholders_symbols})
              AND asof_date IN ({placeholders_dates})
              AND gap_threshold_pct = ?
            GROUP BY COALESCE(coverage_mode, 'unknown')
            """,
            params,
        ).fetchall())
    finally:
        conn.close()
    missing = max(0, expected - int(available or 0))
    return {
        "expected": expected,
        "available": int(available or 0),
        "missing": missing,
        "coverage_pct": round((float(available or 0) / expected) * 100.0, 2),
        "by_source": by_source,
        "by_coverage_mode": by_coverage_mode,
    }
