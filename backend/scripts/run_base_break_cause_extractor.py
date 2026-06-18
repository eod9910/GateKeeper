#!/usr/bin/env python3
"""Base-Break Cause Extractor.

Given a symbol that has recently left a multi-year price base, this answers the
question that the VIAV investigation crystallized:

    "When a stock breaks a long base, what is the underlying CAUSE — and did the
     fundamentals lead the price, or did the price move first?"

Design principle (learned the hard way on VIAV): the CAUSE leads in the
point-in-time FUNDAMENTAL layer (a revenue/EPS inflection off a multi-year
trough, plus a streak of positive earnings surprises). Cross-sectional eigen /
price / volume signals are COINCIDENT confirmers that react on the news day —
never the leading trigger. So the trigger here is the fundamental inflection;
price/eigen are reported only as coincident confirmation and lead/lag context.

This is the runnable core of Phase 2 of the Expectation Gap Detector PRD,
specialized to base breaks. It is read-only over price CSVs + the PIT DB.

Usage:
    py backend/scripts/run_base_break_cause_extractor.py --symbols VIAV
    py backend/scripts/run_base_break_cause_extractor.py --symbols VIAV,RMD,TAL
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "backend" / "services"))

PRICE_DIR = ROOT / "backend" / "data" / "universe"
CHART_DIR = ROOT / "backend" / "data" / "charts"   # weekly long-history fallback
PIT_DB = ROOT / "backend" / "data" / "fundamentals-pit.sqlite"

STATEMENT_KEYS = ["revenue", "operating_income", "net_income", "free_cash_flow"]


def safe(s: str) -> str:
    return s.upper().replace("/", "_").replace("=", "_").replace("-", "_")


# --------------------------------------------------------------------------- #
# Price: detect the base and the breakout                                     #
# --------------------------------------------------------------------------- #
def load_daily_close(symbol: str) -> Optional[pd.Series]:
    p = PRICE_DIR / f"{safe(symbol)}_1d.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p, usecols=lambda c: c.lower() in ("date", "close"))
    df.columns = [c.lower() for c in df.columns]
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df.dropna().drop_duplicates("date", keep="last").sort_values("date")
    if df.empty:
        return None
    return pd.Series(df["close"].to_numpy(float), index=df["date"], name=symbol)


def detect_base_break(close: pd.Series) -> Dict[str, Any]:
    """Establish a base (the price range BEFORE the most recent run) and find the
    breakout: the first close that cleared the base ceiling. Uses the available
    daily window (~5y of universe CSV)."""
    if len(close) < 250:
        return {"detected": False, "reason": "insufficient price history"}
    # Base window = everything up to ~6 months ago; ceiling = its high.
    cutoff = close.index[-1] - pd.Timedelta(days=183)
    base = close.loc[:cutoff]
    if len(base) < 120:
        return {"detected": False, "reason": "base window too short"}
    base_low = float(base.min())
    base_high = float(base.max())
    base_med = float(base.median())
    last = float(close.iloc[-1])
    # tightness: how compressed was the base before the run (exclude the final ramp)
    tight_ratio = base_high / base_low if base_low > 0 else None
    # breakout = first close after the base window that cleared the base ceiling
    after = close.loc[cutoff:]
    crossed = after[after > base_high]
    breakout_date = str(crossed.index[0].date()) if len(crossed) else None
    run_pct = (last / base_med - 1.0) * 100.0 if base_med > 0 else None
    detected = breakout_date is not None and last > base_high
    return {
        "detected": detected,
        "reason": "" if detected else "price not above base ceiling (no clean breakout)",
        "base_low": round(base_low, 2),
        "base_high": round(base_high, 2),
        "base_median": round(base_med, 2),
        "base_tightness_ratio": round(tight_ratio, 2) if tight_ratio else None,
        "last_price": round(last, 2),
        "breakout_date": breakout_date,
        "run_vs_base_median_pct": round(run_pct, 1) if run_pct is not None else None,
        "base_window_days": int(len(base)),
    }


# --------------------------------------------------------------------------- #
# Fundamentals: the cause (point-in-time)                                     #
# --------------------------------------------------------------------------- #
def _q_series(conn: sqlite3.Connection, symbol: str, metric: str) -> List[tuple]:
    rows = conn.execute(
        """SELECT period_end, value_numeric FROM pit_fundamental_facts
           WHERE symbol=? AND metric=? AND value_numeric IS NOT NULL
           ORDER BY period_end""",
        (symbol, metric),
    ).fetchall()
    return [(r[0], float(r[1])) for r in rows]


def detect_fundamental_inflection(symbol: str) -> Dict[str, Any]:
    if not PIT_DB.exists():
        return {"detected": False, "reason": "no PIT db"}
    conn = sqlite3.connect(f"file:{PIT_DB}?mode=ro", uri=True)
    try:
        sales = _q_series(conn, symbol, "earnings_report.salesActual")
        eps = dict(_q_series(conn, symbol, "earnings_report.epsActual"))
        sales_surp = dict(_q_series(conn, symbol, "earnings_report.salesSurprisePct"))
        eps_surp = dict(_q_series(conn, symbol, "earnings_report.epsSurprisePct"))
        # annual revenue trough context (PIT-correct, has available_at)
        annual_rev = conn.execute(
            """SELECT period_end, value_numeric FROM pit_statement_facts
               WHERE symbol=? AND fact_key='revenue' AND period_type='annual'
                 AND value_numeric IS NOT NULL
               ORDER BY period_end""",
            (symbol,),
        ).fetchall()
    finally:
        conn.close()

    if len(sales) < 4:
        return {"detected": False, "reason": "insufficient quarterly history",
                "quarters": len(sales)}

    s_vals = [v for _, v in sales]
    s_dates = [d for d, _ in sales]
    trough_i = int(np.argmin(s_vals))
    trough_val = s_vals[trough_i]
    trough_date = s_dates[trough_i]
    latest_val = s_vals[-1]
    off_trough_pct = (latest_val / trough_val - 1.0) * 100.0 if trough_val else None

    # consecutive QoQ rises ending at the latest quarter
    qoq_rises = 0
    for i in range(len(s_vals) - 1, 0, -1):
        if s_vals[i] > s_vals[i - 1]:
            qoq_rises += 1
        else:
            break

    # surprise streak: consecutive positive EPS surprises ending at latest
    eps_surp_ordered = [eps_surp.get(d) for d in s_dates]
    surprise_streak = 0
    for v in reversed(eps_surp_ordered):
        if v is not None and v > 0:
            surprise_streak += 1
        else:
            break

    # inflection quarter = first quarter AFTER the trough whose sales rose and
    # carried a positive EPS surprise (the "flashlight turning on").
    inflection_date = None
    for i in range(trough_i + 1, len(s_vals)):
        es = eps_surp.get(s_dates[i])
        if s_vals[i] > s_vals[i - 1] and (es is None or es > 0):
            inflection_date = s_dates[i]
            break

    # YoY of latest quarter (vs 4 quarters prior)
    yoy = None
    if len(s_vals) >= 5:
        prior = s_vals[-5]
        if prior:
            yoy = (latest_val / prior - 1.0) * 100.0

    detected = bool(off_trough_pct and off_trough_pct >= 10.0 and qoq_rises >= 2)
    return {
        "detected": detected,
        "trough_quarter_end": trough_date,
        "trough_sales": round(trough_val, 1),
        "latest_quarter_end": s_dates[-1],
        "latest_sales": round(latest_val, 1),
        "off_trough_pct": round(off_trough_pct, 1) if off_trough_pct is not None else None,
        "latest_yoy_pct": round(yoy, 1) if yoy is not None else None,
        "consecutive_qoq_rises": qoq_rises,
        "eps_surprise_streak": surprise_streak,
        "inflection_quarter_end": inflection_date,
        "annual_revenue_points": len(annual_rev),
        "quarterly_points": len(sales),
    }


def _report_date_estimate(period_end: str) -> Optional[str]:
    """Quarterly results are typically reported ~30-45 days after period end.
    pit_fundamental_facts lacks available_at, so we estimate the public date."""
    try:
        d = datetime.fromisoformat(period_end)
        return str((d + pd.Timedelta(days=40)).date())
    except Exception:
        return None


def classify_lead_lag(breakout_date: Optional[str], inflection_q_end: Optional[str]) -> Dict[str, Any]:
    if not breakout_date or not inflection_q_end:
        return {"verdict": "indeterminate"}
    infl_public = _report_date_estimate(inflection_q_end)
    try:
        bo = datetime.fromisoformat(breakout_date)
        ip = datetime.fromisoformat(infl_public)
    except Exception:
        return {"verdict": "indeterminate"}
    gap_days = (bo - ip).days
    if gap_days >= 20:
        verdict = "fundamentals_led_price"
    elif gap_days <= -20:
        verdict = "price_led_fundamentals"
    else:
        verdict = "coincident"
    return {
        "verdict": verdict,
        "inflection_public_est": infl_public,
        "breakout_date": breakout_date,
        "fundamental_lead_days": gap_days,  # +ve => fundamentals public BEFORE breakout
    }


def extract(symbol: str) -> Dict[str, Any]:
    symbol = symbol.upper().strip()
    close = load_daily_close(symbol)
    price = detect_base_break(close) if close is not None else {"detected": False, "reason": "no price csv"}
    funda = detect_fundamental_inflection(symbol)
    leadlag = classify_lead_lag(price.get("breakout_date"), funda.get("inflection_quarter_end"))

    cause = None
    if funda.get("detected"):
        cause = (
            f"Revenue inflected off a multi-year trough: quarterly sales "
            f"{funda['trough_sales']} ({funda['trough_quarter_end']}) -> "
            f"{funda['latest_sales']} ({funda['latest_quarter_end']}), "
            f"+{funda['off_trough_pct']}% off the low"
            + (f", +{funda['latest_yoy_pct']}% YoY" if funda.get("latest_yoy_pct") is not None else "")
            + f"; {funda['consecutive_qoq_rises']} straight QoQ rises and "
            f"{funda['eps_surprise_streak']} consecutive EPS beats."
        )
    return {
        "symbol": symbol,
        "price": price,
        "fundamental": funda,
        "lead_lag": leadlag,
        "cause": cause,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Extract the fundamental cause of a price base break.")
    ap.add_argument("--symbols", default="VIAV", help="Comma-separated symbols.")
    ap.add_argument("--json", action="store_true", help="Emit JSON only.")
    args = ap.parse_args(argv)

    syms = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    results = [extract(s) for s in syms]

    if args.json:
        print(json.dumps(results, indent=2))
        return 0

    for r in results:
        p, f, ll = r["price"], r["fundamental"], r["lead_lag"]
        print(f"\n===== {r['symbol']} =====")
        if p.get("detected"):
            print(f"  PRICE: base {p['base_low']}-{p['base_high']} (tightness {p['base_tightness_ratio']}x), "
                  f"broke out {p['breakout_date']}, now {p['last_price']} (+{p['run_vs_base_median_pct']}% vs base median)")
        else:
            print(f"  PRICE: no base-break detected ({p.get('reason','')})")
        if f.get("detected"):
            print(f"  FUNDAMENTAL INFLECTION: {r['cause']}")
            print(f"     inflection quarter end: {f['inflection_quarter_end']}")
        else:
            print(f"  FUNDAMENTAL: no inflection detected ({f.get('reason', 'weak/no re-acceleration')})")
            if f.get("trough_quarter_end"):
                print(f"     (trough {f['trough_sales']} @ {f['trough_quarter_end']}, "
                      f"latest {f['latest_sales']} @ {f['latest_quarter_end']}, "
                      f"off-trough {f.get('off_trough_pct')}%)")
        print(f"  LEAD/LAG: {ll.get('verdict')}"
              + (f"  (fundamentals public ~{ll['inflection_public_est']} vs breakout {ll['breakout_date']}; "
                 f"fundamentals led by {ll['fundamental_lead_days']} days)"
                 if ll.get("verdict") not in (None, "indeterminate") else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
