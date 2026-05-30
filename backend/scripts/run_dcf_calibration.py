#!/usr/bin/env python3
"""
DCF Calibration Batch Job

Compares DCF predictions against actual financial outcomes after earnings,
computes per-prediction errors, aggregates systematic biases by sector and
market cap band, and writes calibration adjustments that feed back into the
DCF engine.

Designed to run quarterly (after earnings season):
  - Feb 15, May 15, Aug 15, Nov 15

Can also be triggered manually via POST /api/ledger-hydration/calibration/run.

Usage:
    python run_dcf_calibration.py [--min-age-days 90] [--min-sample-size 10]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
DATA_DIR = BACKEND_DIR / "data"
SERVICES_DIR = BACKEND_DIR / "services"
SCRIPTS_DIR = BACKEND_DIR / "scripts"

APP_STATE_DB = DATA_DIR / "app-state.sqlite"
PIT_DB = DATA_DIR / "fundamentals-pit.sqlite"
CALIBRATION_DIR = DATA_DIR / "calibration"

sys.path.insert(0, str(SERVICES_DIR))
sys.path.insert(0, str(SCRIPTS_DIR))


def _safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        f = float(value)
        if f != f or abs(f) == float("inf"):
            return None
        return f
    except (ValueError, TypeError):
        return None


def _ensure_calibration_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dcf_calibration_errors (
            id                              INTEGER PRIMARY KEY AUTOINCREMENT,
            prediction_id                   INTEGER NOT NULL,
            symbol                          TEXT NOT NULL,
            sector                          TEXT,
            industry                        TEXT,
            market_cap_band                 TEXT,
            predicted_revenue_growth_pct    REAL,
            actual_revenue_growth_pct       REAL,
            revenue_growth_error_pct        REAL,
            predicted_fcf_margin_pct        REAL,
            actual_fcf_margin_pct           REAL,
            fcf_margin_error_pct            REAL,
            predicted_fair_value_mid        REAL,
            actual_price_at_review          REAL,
            price_error_pct                 REAL,
            direction_correct               INTEGER,
            prediction_date                 TEXT NOT NULL,
            review_date                     TEXT NOT NULL,
            quarters_elapsed                INTEGER,
            created_at                      TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_sector ON dcf_calibration_errors(sector)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_band ON dcf_calibration_errors(market_cap_band)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_prediction ON dcf_calibration_errors(prediction_id)")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS dcf_calibration_adjustments (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            scope_type        TEXT NOT NULL,
            scope_value       TEXT NOT NULL,
            assumption_key    TEXT NOT NULL,
            adjustment_pct    REAL NOT NULL,
            sample_size       INTEGER NOT NULL,
            confidence        REAL,
            last_computed_at  TEXT NOT NULL,
            UNIQUE(scope_type, scope_value, assumption_key)
        )
    """)
    conn.commit()


def _get_uncalibrated_predictions(conn: sqlite3.Connection, min_age_days: int) -> List[Dict[str, Any]]:
    cutoff = datetime.utcnow()
    from datetime import timedelta
    cutoff_date = (cutoff - timedelta(days=min_age_days)).strftime("%Y-%m-%d")

    rows = conn.execute("""
        SELECT p.* FROM dcf_predictions p
        LEFT JOIN dcf_calibration_errors e ON e.prediction_id = p.id
        WHERE p.prediction_date <= ?
          AND e.id IS NULL
        ORDER BY p.prediction_date ASC
    """, (cutoff_date,)).fetchall()

    return [{key: row[key] for key in row.keys()} for row in rows]


def _get_latest_annual_facts(
    pit_conn: sqlite3.Connection,
    symbol: str,
    after_date: str,
) -> Optional[Dict[str, Any]]:
    """Fetch annual statement facts available after a given date (i.e., the earnings that came after prediction)."""
    fact_keys = ("revenue", "free_cash_flow", "operating_income", "operating_cash_flow", "capital_expenditures")
    placeholders = ", ".join("?" for _ in fact_keys)

    rows = pit_conn.execute(
        f"""
        SELECT fact_key, value_numeric, scale, period_end, available_at
        FROM pit_statement_facts
        WHERE symbol = ?
          AND available_at > ?
          AND period_type = 'annual'
          AND fact_key IN ({placeholders})
        ORDER BY period_end DESC, available_at DESC
        """,
        (symbol, after_date, *fact_keys),
    ).fetchall()

    if not rows:
        return None

    facts: Dict[str, float] = {}
    period_end = None
    for row in rows:
        key = str(row["fact_key"])
        if key in facts:
            continue
        val = _safe_float(row["value_numeric"])
        if val is None:
            continue
        scale = str(row["scale"] or "").strip().lower()
        multiplier = (
            1_000_000_000 if scale == "billions"
            else 1_000_000 if scale == "millions"
            else 1_000 if scale == "thousands"
            else 1
        )
        facts[key] = val * multiplier
        if period_end is None:
            period_end = str(row["period_end"] or "")

    return {"facts": facts, "period_end": period_end} if facts else None


def _get_current_price(pit_conn: sqlite3.Connection, symbol: str) -> Optional[float]:
    """Get the most recent price from PIT market facts."""
    row = pit_conn.execute(
        """
        SELECT metric_value
        FROM pit_market_facts
        WHERE symbol = ? AND metric = 'currentPrice'
        ORDER BY market_date DESC
        LIMIT 1
        """,
        (symbol,),
    ).fetchone()
    return _safe_float(row["metric_value"]) if row else None


def _compute_revenue_growth(facts: Dict[str, float], prior_revenue: Optional[float]) -> Optional[float]:
    revenue = facts.get("revenue")
    if revenue is None or prior_revenue is None or prior_revenue == 0:
        return None
    return ((revenue - prior_revenue) / abs(prior_revenue)) * 100.0


def _compute_fcf_margin(facts: Dict[str, float]) -> Optional[float]:
    revenue = facts.get("revenue")
    fcf = facts.get("free_cash_flow")
    if revenue is None or revenue == 0 or fcf is None:
        return None
    return (fcf / revenue) * 100.0


def _quarters_between(date1: str, date2: str) -> int:
    try:
        d1 = datetime.strptime(date1[:10], "%Y-%m-%d")
        d2 = datetime.strptime(date2[:10], "%Y-%m-%d")
        return max(1, round(abs((d2 - d1).days) / 91.25))
    except Exception:
        return 1


def run_calibration(
    min_age_days: int = 90,
    min_sample_size: int = 10,
) -> Dict[str, Any]:
    if not APP_STATE_DB.exists():
        return {"error": "app-state.sqlite not found", "predictions_processed": 0}
    if not PIT_DB.exists():
        return {"error": "fundamentals-pit.sqlite not found", "predictions_processed": 0}

    app_conn = sqlite3.connect(str(APP_STATE_DB))
    app_conn.row_factory = sqlite3.Row
    app_conn.execute("PRAGMA journal_mode = WAL")
    app_conn.execute("PRAGMA busy_timeout = 5000")
    _ensure_calibration_tables(app_conn)

    pit_conn = sqlite3.connect(str(PIT_DB))
    pit_conn.row_factory = sqlite3.Row

    predictions = _get_uncalibrated_predictions(app_conn, min_age_days)
    print(f"[DCFCalibration] Found {len(predictions)} uncalibrated predictions", flush=True)

    today = datetime.utcnow().strftime("%Y-%m-%d")
    errors_logged = 0
    skipped = 0

    for pred in predictions:
        symbol = pred["symbol"]
        prediction_date = pred["prediction_date"]

        actuals = _get_latest_annual_facts(pit_conn, symbol, prediction_date)
        if actuals is None:
            skipped += 1
            continue

        facts = actuals["facts"]
        actual_revenue = facts.get("revenue")
        predicted_revenue_growth = _safe_float(pred.get("revenue_growth_pct"))
        actual_fcf_margin = _compute_fcf_margin(facts)
        predicted_fcf_margin = _safe_float(pred.get("target_fcf_margin_pct"))
        predicted_fair_value_mid = _safe_float(pred.get("fair_value_mid"))

        # To compute actual revenue growth, we need prior year revenue.
        # Use the prediction's annual_revenue as the base (it was the latest at prediction time).
        prior_revenue = _safe_float(pred.get("annual_revenue"))
        actual_revenue_growth = None
        if actual_revenue is not None and prior_revenue is not None and prior_revenue != 0:
            actual_revenue_growth = ((actual_revenue - prior_revenue) / abs(prior_revenue)) * 100.0

        revenue_growth_error = None
        if predicted_revenue_growth is not None and actual_revenue_growth is not None:
            revenue_growth_error = predicted_revenue_growth - actual_revenue_growth

        fcf_margin_error = None
        if predicted_fcf_margin is not None and actual_fcf_margin is not None:
            fcf_margin_error = predicted_fcf_margin - actual_fcf_margin

        current_price = _get_current_price(pit_conn, symbol)
        price_error = None
        if predicted_fair_value_mid is not None and current_price is not None and current_price > 0:
            price_error = ((predicted_fair_value_mid - current_price) / current_price) * 100.0

        direction_correct = None
        judgment = pred.get("judgment")
        price_at_pred = _safe_float(pred.get("price_at_prediction"))
        if judgment and price_at_pred and current_price:
            price_moved_up = current_price > price_at_pred
            predicted_up = judgment in ("undervalued", "significantly_undervalued")
            predicted_down = judgment in ("overvalued", "significantly_overvalued")
            if predicted_up or predicted_down:
                direction_correct = 1 if (predicted_up == price_moved_up) else 0

        quarters = _quarters_between(prediction_date, today)

        app_conn.execute(
            """INSERT INTO dcf_calibration_errors (
                prediction_id, symbol, sector, industry, market_cap_band,
                predicted_revenue_growth_pct, actual_revenue_growth_pct, revenue_growth_error_pct,
                predicted_fcf_margin_pct, actual_fcf_margin_pct, fcf_margin_error_pct,
                predicted_fair_value_mid, actual_price_at_review, price_error_pct,
                direction_correct,
                prediction_date, review_date, quarters_elapsed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                pred["id"],
                symbol,
                pred.get("sector"),
                pred.get("industry"),
                pred.get("market_cap_band"),
                predicted_revenue_growth,
                actual_revenue_growth,
                revenue_growth_error,
                predicted_fcf_margin,
                actual_fcf_margin,
                fcf_margin_error,
                predicted_fair_value_mid,
                current_price,
                price_error,
                direction_correct,
                prediction_date,
                today,
                quarters,
            ),
        )
        errors_logged += 1

    app_conn.commit()
    print(f"[DCFCalibration] Logged {errors_logged} calibration errors, skipped {skipped}", flush=True)

    # --- Aggregate biases and upsert adjustments ---
    adjustment_count = 0
    now_iso = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    bias_table: List[Dict[str, Any]] = []

    for scope_col, scope_type in [("sector", "sector"), ("market_cap_band", "market_cap_band")]:
        for assumption_key, error_col in [
            ("revenue_growth_pct", "revenue_growth_error_pct"),
            ("target_fcf_margin_pct", "fcf_margin_error_pct"),
        ]:
            rows = app_conn.execute(
                f"""
                SELECT {scope_col} AS scope_value,
                       AVG({error_col}) AS mean_error,
                       COUNT(*) AS sample_size
                FROM dcf_calibration_errors
                WHERE {scope_col} IS NOT NULL AND {error_col} IS NOT NULL
                GROUP BY {scope_col}
                HAVING COUNT(*) >= ?
                """,
                (min_sample_size,),
            ).fetchall()

            for row in rows:
                scope_value = str(row["scope_value"])
                mean_error = float(row["mean_error"])
                sample_size = int(row["sample_size"])
                confidence = min(1.0, sample_size / 50.0)

                app_conn.execute(
                    """INSERT INTO dcf_calibration_adjustments (
                        scope_type, scope_value, assumption_key,
                        adjustment_pct, sample_size, confidence, last_computed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(scope_type, scope_value, assumption_key) DO UPDATE SET
                        adjustment_pct = excluded.adjustment_pct,
                        sample_size = excluded.sample_size,
                        confidence = excluded.confidence,
                        last_computed_at = excluded.last_computed_at
                    """,
                    (scope_type, scope_value, assumption_key, mean_error, sample_size, confidence, now_iso),
                )
                adjustment_count += 1
                bias_table.append({
                    "scope_type": scope_type,
                    "scope_value": scope_value,
                    "assumption_key": assumption_key,
                    "adjustment_pct": round(mean_error, 3),
                    "sample_size": sample_size,
                    "confidence": round(confidence, 3),
                })

    # Global adjustments
    for assumption_key, error_col in [
        ("revenue_growth_pct", "revenue_growth_error_pct"),
        ("target_fcf_margin_pct", "fcf_margin_error_pct"),
    ]:
        row = app_conn.execute(
            f"""
            SELECT AVG({error_col}) AS mean_error, COUNT(*) AS sample_size
            FROM dcf_calibration_errors
            WHERE {error_col} IS NOT NULL
            HAVING COUNT(*) >= ?
            """,
            (min_sample_size,),
        ).fetchone()

        if row and row["sample_size"] and int(row["sample_size"]) >= min_sample_size:
            mean_error = float(row["mean_error"])
            sample_size = int(row["sample_size"])
            confidence = min(1.0, sample_size / 100.0)

            app_conn.execute(
                """INSERT INTO dcf_calibration_adjustments (
                    scope_type, scope_value, assumption_key,
                    adjustment_pct, sample_size, confidence, last_computed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(scope_type, scope_value, assumption_key) DO UPDATE SET
                    adjustment_pct = excluded.adjustment_pct,
                    sample_size = excluded.sample_size,
                    confidence = excluded.confidence,
                    last_computed_at = excluded.last_computed_at
                """,
                ("global", "all", assumption_key, mean_error, sample_size, confidence, now_iso),
            )
            adjustment_count += 1
            bias_table.append({
                "scope_type": "global",
                "scope_value": "all",
                "assumption_key": assumption_key,
                "adjustment_pct": round(mean_error, 3),
                "sample_size": sample_size,
                "confidence": round(confidence, 3),
            })

    app_conn.commit()
    print(f"[DCFCalibration] Computed {adjustment_count} calibration adjustments", flush=True)

    # --- Direction accuracy ---
    direction_row = app_conn.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN direction_correct = 1 THEN 1 ELSE 0 END) AS correct,
            SUM(CASE WHEN direction_correct = 0 THEN 1 ELSE 0 END) AS incorrect
        FROM dcf_calibration_errors
        WHERE direction_correct IS NOT NULL
    """).fetchone()

    direction_accuracy = None
    if direction_row and direction_row["total"] and int(direction_row["total"]) > 0:
        total = int(direction_row["total"])
        correct = int(direction_row["correct"] or 0)
        direction_accuracy = {
            "total": total,
            "correct": correct,
            "incorrect": int(direction_row["incorrect"] or 0),
            "accuracy_pct": round((correct / total) * 100, 1),
        }

    pit_conn.close()
    app_conn.close()

    report = {
        "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "predictions_processed": len(predictions),
        "errors_logged": errors_logged,
        "skipped_no_actuals": skipped,
        "adjustments_computed": adjustment_count,
        "min_age_days": min_age_days,
        "min_sample_size": min_sample_size,
        "bias_table": sorted(bias_table, key=lambda r: abs(r["adjustment_pct"]), reverse=True),
        "direction_accuracy": direction_accuracy,
    }

    CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)
    report_path = CALIBRATION_DIR / f"calibration_report_{today}.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"[DCFCalibration] Report saved to {report_path}", flush=True)

    return report


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run DCF calibration batch job")
    parser.add_argument("--min-age-days", type=int, default=90, help="Minimum age of predictions to calibrate (days)")
    parser.add_argument("--min-sample-size", type=int, default=10, help="Minimum sample size for bias adjustments")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    report = run_calibration(
        min_age_days=args.min_age_days,
        min_sample_size=args.min_sample_size,
    )

    if "error" in report:
        print(f"[DCFCalibration] ERROR: {report['error']}", flush=True)
        return 1

    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
