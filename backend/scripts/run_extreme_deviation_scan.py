"""Scan cached market data for full-history statistical extensions.

The scan fits a linear channel over each symbol's full cached history and
scores the latest close by how many residual standard deviations it sits above
that channel. Both raw-price and log-price channels are reported.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import statistics
import time
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
UNIVERSE_DIR = DATA_DIR / "universe"
UNIVERSE_FILE = DATA_DIR / "universe_clean.json"
APP_STATE_DB = DATA_DIR / "app-state.sqlite"
OUTPUT_DIR = DATA_DIR / "research"


def load_stock_universe() -> dict[str, dict]:
    if not UNIVERSE_FILE.exists():
        return {}
    payload = json.loads(UNIVERSE_FILE.read_text(encoding="utf-8"))
    stocks = payload.get("stocks") if isinstance(payload, dict) else []
    return {
        str(row.get("symbol") or row.get("ticker") or "").upper(): row
        for row in stocks or []
        if row.get("symbol") or row.get("ticker")
    }


def discover_symbols(source: str, requested: Iterable[str] | None = None) -> list[str]:
    if requested:
        return sorted({symbol.strip().upper() for symbol in requested if symbol.strip()})

    if source == "stocks":
        symbols = load_stock_universe().keys()
        return sorted(symbol for symbol in symbols if (UNIVERSE_DIR / f"{symbol}_1d.csv").exists())

    return sorted(path.name.removesuffix("_1d.csv").upper() for path in UNIVERSE_DIR.glob("*_1d.csv"))


def load_closes(symbol: str) -> tuple[list[str], list[float]]:
    path = UNIVERSE_DIR / f"{symbol}_1d.csv"
    if not path.exists():
        return [], []

    dates: list[str] = []
    closes: list[float] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                close = float(row.get("close") or row.get("Close") or "")
            except (TypeError, ValueError):
                continue
            if not math.isfinite(close) or close <= 0:
                continue
            dates.append(str(row.get("date") or row.get("Date") or ""))
            closes.append(close)
    return dates, closes


def regression_channel(values: list[float]) -> dict[str, float] | None:
    n = len(values)
    if n < 3:
        return None

    x_mean = (n - 1) / 2
    y_mean = statistics.fmean(values)
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    if denominator <= 0:
        return None

    slope = sum((i - x_mean) * (value - y_mean) for i, value in enumerate(values)) / denominator
    intercept = y_mean - slope * x_mean
    residuals = [value - (intercept + slope * i) for i, value in enumerate(values)]
    if len(residuals) < 3:
        return None

    sigma = statistics.stdev(residuals)
    if not math.isfinite(sigma) or sigma <= 0:
        return None

    latest_fit = intercept + slope * (n - 1)
    latest_residual = residuals[-1]
    return {
        "slope": slope,
        "intercept": intercept,
        "fit": latest_fit,
        "residual": latest_residual,
        "z": latest_residual / sigma,
        "sigma": sigma,
    }


def latest_dcf(symbol: str, conn: sqlite3.Connection | None) -> dict | None:
    if conn is None:
        return None
    try:
        row = conn.execute(
            """
            SELECT prediction_date, price_at_prediction, fair_value_mid,
                   valuation_gap_pct, judgment, source
            FROM dcf_predictions
            WHERE symbol = ?
            ORDER BY prediction_date DESC, id DESC
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    return {
        "dcf_date": row[0],
        "dcf_price": row[1],
        "fair_value_mid": row[2],
        "valuation_gap_pct": row[3],
        "valuation_state": row[4],
        "valuation_source": row[5],
    }


def score_symbol(symbol: str, meta: dict, min_bars: int, conn: sqlite3.Connection | None) -> dict | None:
    dates, closes = load_closes(symbol)
    if len(closes) < min_bars:
        return None

    raw = regression_channel(closes)
    logs = regression_channel([math.log(close) for close in closes])
    if not raw or not logs:
        return None

    latest_close = closes[-1]
    log_fit_price = math.exp(logs["fit"])
    row = {
        "symbol": symbol,
        "name": meta.get("name"),
        "exchange": meta.get("exchange"),
        "index": meta.get("index"),
        "market_cap_bucket": meta.get("market_cap_bucket"),
        "bars": len(closes),
        "history_start": dates[0] if dates else None,
        "history_end": dates[-1] if dates else None,
        "latest_close": latest_close,
        "raw_fit": raw["fit"],
        "raw_sigma": raw["sigma"],
        "raw_residual": raw["residual"],
        "raw_z": raw["z"],
        "raw_pct_above_trend": ((latest_close - raw["fit"]) / raw["fit"]) if raw["fit"] else None,
        "log_fit_price": log_fit_price,
        "log_sigma": logs["sigma"],
        "log_residual": logs["residual"],
        "log_z": logs["z"],
        "log_pct_above_trend": (latest_close / log_fit_price) - 1 if log_fit_price else None,
    }
    dcf = latest_dcf(symbol, conn)
    if dcf:
        row.update(dcf)
        fair_value_mid = dcf.get("fair_value_mid")
        if isinstance(fair_value_mid, (int, float)) and fair_value_mid > 0 and latest_close > 0:
            row["current_gap_to_fair_value_pct"] = ((fair_value_mid - latest_close) / latest_close) * 100
    return row


def write_outputs(rows: list[dict], summary: dict, output_prefix: str) -> tuple[Path, Path]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUTPUT_DIR / f"{output_prefix}.json"
    csv_path = OUTPUT_DIR / f"{output_prefix}.csv"
    json_path.write_text(json.dumps({"summary": summary, "results": rows}, indent=2), encoding="utf-8")

    fields: list[str] = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return json_path, csv_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan cached symbols for full-history statistical extensions.")
    parser.add_argument("--threshold", type=float, default=6.0, help="Minimum z-score to include.")
    parser.add_argument("--score", choices=["raw", "log"], default="raw", help="Which channel z-score gates the result.")
    parser.add_argument("--source", choices=["stocks", "cache"], default="stocks", help="Scan clean stock universe or all cached daily files.")
    parser.add_argument("--symbols", help="Comma-separated symbols to scan instead of a universe.")
    parser.add_argument("--min-bars", type=int, default=500, help="Minimum daily bars required.")
    parser.add_argument("--limit", type=int, default=100, help="Maximum rows to print and write.")
    parser.add_argument("--output-prefix", default="extreme_deviation_scan.latest", help="Output basename under backend/data/research.")
    args = parser.parse_args()

    requested = args.symbols.split(",") if args.symbols else None
    universe_meta = load_stock_universe()
    symbols = discover_symbols(args.source, requested)
    conn = sqlite3.connect(APP_STATE_DB) if APP_STATE_DB.exists() else None
    started = time.time()

    rows: list[dict] = []
    scanned = 0
    skipped = 0
    for symbol in symbols:
        scanned += 1
        row = score_symbol(symbol, universe_meta.get(symbol, {}), args.min_bars, conn)
        if not row:
            skipped += 1
            continue
        score_key = f"{args.score}_z"
        if row.get(score_key, 0) >= args.threshold:
            row["score_z"] = row[score_key]
            rows.append(row)

    if conn is not None:
        conn.close()

    rows.sort(
        key=lambda row: (
            row.get("score_z") or 0,
            -(row.get("valuation_gap_pct") or 0),
            row.get("latest_close") or 0,
        ),
        reverse=True,
    )
    rows = rows[: max(args.limit, 0)]
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": args.source,
        "threshold": args.threshold,
        "score": args.score,
        "min_bars": args.min_bars,
        "symbols_considered": len(symbols),
        "symbols_scanned": scanned,
        "symbols_skipped": skipped,
        "matches": len(rows),
        "elapsed_seconds": round(time.time() - started, 2),
        "notes": [
            "raw_z uses a full-history linear regression channel on price.",
            "log_z uses a full-history linear regression channel on log(price), which normalizes compounding better.",
            "DCF fields are included only where app-state.sqlite has a latest dcf_predictions row.",
        ],
    }
    json_path, csv_path = write_outputs(rows, summary, args.output_prefix)

    print(json.dumps(summary, indent=2))
    print(f"Wrote {json_path}")
    print(f"Wrote {csv_path}")
    for row in rows[: min(25, len(rows))]:
        valuation = row.get("valuation_gap_pct")
        valuation_text = f", dcf_gap={valuation:.1f}%" if isinstance(valuation, (int, float)) else ""
        print(
            f"{row['symbol']:>6} raw_z={row['raw_z']:.2f} log_z={row['log_z']:.2f} "
            f"close={row['latest_close']:.2f}{valuation_text}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
