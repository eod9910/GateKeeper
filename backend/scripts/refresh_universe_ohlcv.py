#!/usr/bin/env python3
"""
Incrementally refresh daily OHLCV CSVs under backend/data/universe.

The broad universe builder creates the original history files, but it reuses
existing CSVs and therefore is not a daily maintenance job. This script keeps
that CSV layer current by pulling recent Yahoo bars and merging them into the
existing per-symbol files.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_UNIVERSE = ROOT / "backend" / "data" / "universe_clean.json"
DEFAULT_PRICE_DIR = ROOT / "backend" / "data" / "universe"
DEFAULT_REPORT = ROOT / "backend" / "data" / "universe" / "ohlcv-refresh-manifest.json"

CSV_COLUMNS = ["date", "close", "high", "low", "open", "volume"]


def safe_symbol(symbol: str) -> str:
    return str(symbol).strip().upper().replace("/", "-")


def yahoo_symbol(symbol: str) -> str:
    return safe_symbol(symbol).replace(".", "-")


def csv_path(price_dir: Path, symbol: str, interval: str) -> Path:
    return price_dir / f"{safe_symbol(symbol)}_{interval}.csv"


def load_clean_symbols(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    stocks = payload.get("stocks") or []
    symbols: list[str] = []
    seen: set[str] = set()
    for item in stocks:
        symbol = safe_symbol(item.get("ticker") or item.get("symbol") or "")
        if symbol and symbol not in seen:
            seen.add(symbol)
            symbols.append(symbol)
    return symbols


def parse_symbols(args: argparse.Namespace) -> list[str]:
    if args.symbols:
        symbols = [safe_symbol(part) for part in args.symbols.split(",") if part.strip()]
    else:
        symbols = load_clean_symbols(Path(args.universe))
    if args.limit and args.limit > 0:
        symbols = symbols[: args.limit]
    return symbols


def batches(items: list[str], size: int) -> Iterable[list[str]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def read_existing(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=CSV_COLUMNS)
    frame = pd.read_csv(path)
    if "date" not in frame.columns:
        return pd.DataFrame(columns=CSV_COLUMNS)
    frame = frame[[column for column in CSV_COLUMNS if column in frame.columns]].copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    frame = frame.dropna(subset=["date"])
    return frame


def latest_date(frame: pd.DataFrame) -> str | None:
    if frame.empty or "date" not in frame.columns:
        return None
    values = frame["date"].dropna()
    return str(values.max()) if not values.empty else None


def normalize_download_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=CSV_COLUMNS)

    normalized = frame.copy()
    normalized = normalized.dropna(how="all")
    normalized.columns = [str(column).strip().lower() for column in normalized.columns]

    rename = {
        "adj close": "close",
    }
    normalized = normalized.rename(columns=rename)
    wanted = [column for column in ["close", "high", "low", "open", "volume"] if column in normalized.columns]
    normalized = normalized[wanted].copy()
    normalized.index.name = "date"
    normalized = normalized.reset_index()
    normalized["date"] = pd.to_datetime(normalized["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    normalized = normalized.dropna(subset=["date"])

    for column in CSV_COLUMNS:
        if column not in normalized.columns:
            normalized[column] = pd.NA
    return normalized[CSV_COLUMNS]


def symbol_frame(raw: pd.DataFrame, symbol: str, batch: list[str]) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame(columns=CSV_COLUMNS)
    if isinstance(raw.columns, pd.MultiIndex):
        try:
            return normalize_download_frame(raw.xs(yahoo_symbol(symbol), level=1, axis=1))
        except KeyError:
            try:
                return normalize_download_frame(raw.xs(symbol, level=1, axis=1))
            except KeyError:
                return pd.DataFrame(columns=CSV_COLUMNS)
    if len(batch) == 1:
        return normalize_download_frame(raw)
    return pd.DataFrame(columns=CSV_COLUMNS)


def merge_frames(existing: pd.DataFrame, downloaded: pd.DataFrame) -> pd.DataFrame:
    pieces = [frame for frame in (existing, downloaded) if not frame.empty and not frame.dropna(how="all").empty]
    if not pieces:
        return pd.DataFrame(columns=CSV_COLUMNS)
    combined = pd.concat(pieces, ignore_index=True)
    combined = combined.dropna(subset=["date"])
    combined = combined.drop_duplicates(subset=["date"], keep="last")
    combined = combined.sort_values("date")
    for column in ["close", "high", "low", "open", "volume"]:
        combined[column] = pd.to_numeric(combined[column], errors="coerce")
    return combined[CSV_COLUMNS]


def refresh_batch(batch: list[str], args: argparse.Namespace) -> pd.DataFrame:
    yf_batch = [yahoo_symbol(symbol) for symbol in batch]
    return yf.download(
        yf_batch,
        period=args.period,
        interval=args.interval,
        auto_adjust=True,
        progress=False,
        threads=False,
    )


def refresh_symbols(symbols: list[str], args: argparse.Namespace) -> dict:
    price_dir = Path(args.price_dir)
    price_dir.mkdir(parents=True, exist_ok=True)

    summary = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "universe": str(Path(args.universe).resolve()) if not args.symbols else "explicit-symbols",
        "price_dir": str(price_dir.resolve()),
        "period": args.period,
        "interval": args.interval,
        "requested": len(symbols),
        "updated": 0,
        "unchanged": 0,
        "missing_or_empty": 0,
        "failed": 0,
        "latest_before": None,
        "latest_after": None,
        "failures": [],
    }

    before_dates: list[str] = []
    after_dates: list[str] = []
    total_batches = (len(symbols) + args.batch_size - 1) // args.batch_size

    for batch_num, batch in enumerate(batches(symbols, args.batch_size), 1):
        print(f"[ohlcv-refresh] batch {batch_num}/{total_batches} ({len(batch)} symbols)", flush=True)
        try:
            raw = refresh_batch(batch, args)
        except Exception as err:
            summary["failed"] += len(batch)
            for symbol in batch:
                summary["failures"].append({"symbol": symbol, "error": str(err)})
            print(f"[ohlcv-refresh] batch failed: {err}", flush=True)
            time.sleep(args.sleep)
            continue

        for symbol in batch:
            path = csv_path(price_dir, symbol, args.interval)
            existing = read_existing(path)
            before = latest_date(existing)
            if before:
                before_dates.append(before)

            downloaded = symbol_frame(raw, symbol, batch)
            if downloaded.empty:
                summary["missing_or_empty"] += 1
                summary["failures"].append({"symbol": symbol, "error": "No recent Yahoo bars returned"})
                continue

            merged = merge_frames(existing, downloaded)
            after = latest_date(merged)
            if after:
                after_dates.append(after)

            if args.dry_run:
                if after and before != after:
                    summary["updated"] += 1
                else:
                    summary["unchanged"] += 1
                continue

            if after and before != after:
                merged.to_csv(path, index=False)
                summary["updated"] += 1
                if args.verbose:
                    print(f"  {symbol}: {before or 'missing'} -> {after}", flush=True)
            else:
                summary["unchanged"] += 1

        time.sleep(args.sleep)

    summary["latest_before"] = max(before_dates) if before_dates else None
    summary["latest_after"] = max(after_dates) if after_dates else None
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()

    if not args.dry_run:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with report_path.open("w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=2)

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh backend/data/universe daily OHLCV CSVs.")
    parser.add_argument("--universe", default=str(DEFAULT_UNIVERSE))
    parser.add_argument("--price-dir", default=str(DEFAULT_PRICE_DIR))
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--symbols", help="Comma-separated symbols to refresh instead of clean universe.")
    parser.add_argument("--period", default="6mo", help="Recent lookback to merge into existing CSVs.")
    parser.add_argument("--interval", default="1d", choices=["1d"])
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--limit", type=int, default=0, help="Limit symbol count for smoke tests.")
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    symbols = parse_symbols(args)
    if not symbols:
        print("[ohlcv-refresh] no symbols to refresh", file=sys.stderr)
        return 1

    summary = refresh_symbols(symbols, args)
    print(f"[ohlcv-refresh] Done. {json.dumps(summary, sort_keys=True)}")
    return 0 if summary["failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
