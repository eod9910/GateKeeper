#!/usr/bin/env python3
"""
update_universe.py — Phase 2: Incremental universe data updater.

What this does:
  1. Reads manifest.json to find all tracked symbols and their last-updated dates
  2. For each symbol, fetches ONLY the missing bars (from last date to today)
  3. Appends new bars to existing CSV files
  4. Updates manifest.json with new end dates

Run this daily or weekly before scanning to keep your universe current.
A full update of 600+ symbols typically takes 3–8 minutes.

Usage:
  python update_universe.py
  python update_universe.py --interval 1wk   # weekly bars
  python update_universe.py --dry-run        # show what would update, don't write
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, date
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("ERROR: yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print("ERROR: pandas not installed. Run: pip install pandas")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data" / "universe"
MANIFEST_PATH = DATA_DIR / "manifest.json"


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        print(f"ERROR: manifest.json not found at {MANIFEST_PATH}")
        print("Run build_universe.py first to create the universe.")
        sys.exit(1)
    with open(MANIFEST_PATH) as f:
        return json.load(f)


def save_manifest(manifest: dict):
    manifest["last_updated"] = datetime.utcnow().isoformat() + "Z"
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)


def symbols_needing_update(manifest: dict, interval: str, max_age_days: int = 1) -> list[tuple]:
    """
    Return list of (symbol, last_date) for symbols whose data is older than max_age_days.
    Only includes symbols that have existing data files.
    """
    today = date.today()
    stale = []

    for sym, meta in manifest.get("symbols", {}).items():
        if meta.get("error") and not meta.get("end"):
            continue  # skip symbols that never downloaded successfully

        end_str = meta.get("end")
        if not end_str:
            stale.append((sym, None))
            continue

        last_date = date.fromisoformat(end_str)
        age = (today - last_date).days

        # Skip weekends — markets closed
        if age <= max_age_days:
            continue

        # Check the file actually exists
        fname = meta.get("file") or f"{sym}_{interval}.csv"
        fpath = DATA_DIR / fname
        if not fpath.exists():
            stale.append((sym, None))
        else:
            stale.append((sym, last_date))

    return stale


def fetch_incremental(symbol: str, start_date: date, interval: str) -> pd.DataFrame | None:
    """Fetch bars from start_date to today for a single symbol."""
    try:
        # Add 1 day overlap to avoid missing the last bar
        fetch_start = start_date - timedelta(days=2)
        tk = yf.Ticker(symbol)
        df = tk.history(
            start=fetch_start.strftime("%Y-%m-%d"),
            interval=interval,
            auto_adjust=True,
        )
        if df.empty:
            return None
        df.index = pd.to_datetime(df.index).tz_localize(None)
        df.index.name = "date"
        df.columns = [c.lower() for c in df.columns]
        # Keep only OHLCV
        keep = [c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]
        return df[keep]
    except Exception:
        return None


def _latest_close_from_frame(df: pd.DataFrame) -> float | None:
    if df is None or df.empty or "close" not in df.columns:
        return None
    value = df["close"].iloc[-1]
    if pd.isna(value):
        return None
    return float(value)


def update_symbol(
    symbol: str,
    last_date: date | None,
    interval: str,
    meta: dict,
    dry_run: bool,
) -> dict:
    """Fetch and append new bars for a symbol. Returns updated meta dict."""
    fname = meta.get("file") or f"{symbol}_{interval}.csv"
    fpath = DATA_DIR / fname

    # Load existing data
    existing = None
    if fpath.exists():
        try:
            existing = pd.read_csv(fpath, index_col="date", parse_dates=True)
        except Exception:
            existing = None

    if last_date is None:
        # No existing data — full download
        start = date.today() - timedelta(days=365 * 5)
    else:
        start = last_date

    new_data = fetch_incremental(symbol, start, interval)

    if new_data is None or new_data.empty:
        return meta  # no update needed or failed

    if existing is not None and not existing.empty:
        # Remove overlap rows before appending
        existing.index = pd.to_datetime(existing.index)
        new_data.index = pd.to_datetime(new_data.index)
        cutoff = existing.index.max()
        new_rows = new_data[new_data.index > cutoff]
        if new_rows.empty:
            return {
                **meta,
                "rows": len(existing),
                "start": str(existing.index[0].date()),
                "end": str(existing.index[-1].date()),
                "last_close": _latest_close_from_frame(existing),
                "last_updated": datetime.utcnow().isoformat() + "Z",
                "error": None,
                "file": fname,
                "new_bars": 0,
            }
        combined = pd.concat([existing, new_rows])
    else:
        combined = new_data

    combined = combined[~combined.index.duplicated(keep="last")].sort_index()

    if not dry_run:
        combined.to_csv(fpath)

    updated_meta = dict(meta)
    updated_meta["rows"] = len(combined)
    updated_meta["start"] = str(combined.index[0].date())
    updated_meta["end"] = str(combined.index[-1].date())
    updated_meta["last_close"] = _latest_close_from_frame(combined)
    updated_meta["last_updated"] = datetime.utcnow().isoformat() + "Z"
    updated_meta["error"] = None
    updated_meta["file"] = fname
    updated_meta["new_bars"] = len(new_rows) if existing is not None else len(combined)
    return updated_meta


def main():
    parser = argparse.ArgumentParser(description="Incrementally update universe price data")
    parser.add_argument("--interval", default="1d", help="Bar interval (1d or 1wk)")
    parser.add_argument("--max-age-days", type=int, default=1,
                        help="Only update symbols older than this many days (default: 1)")
    parser.add_argument("--batch-size", type=int, default=50,
                        help="Symbols per batch for status display")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would update without writing files")
    args = parser.parse_args()

    print("=" * 60)
    print("  Universe Incremental Updater")
    print("=" * 60)
    if args.dry_run:
        print("  DRY RUN — no files will be written")

    t0 = time.time()
    manifest = load_manifest()
    total_symbols = len(manifest.get("symbols", {}))
    print(f"  Tracked symbols: {total_symbols}")
    print(f"  Interval:        {args.interval}")
    print(f"  Max age:         {args.max_age_days} day(s)")

    stale = symbols_needing_update(manifest, args.interval, args.max_age_days)
    print(f"  Symbols needing update: {len(stale)}")

    if not stale:
        print("\nAll symbols are up to date.")
        return

    print()
    updated_count = 0
    skipped_count = 0
    error_count = 0

    for i, (sym, last_date) in enumerate(stale, 1):
        meta = manifest["symbols"].get(sym, {})
        try:
            new_meta = update_symbol(sym, last_date, args.interval, meta, args.dry_run)
            new_bars = new_meta.get("new_bars", 0)

            if not args.dry_run:
                manifest["symbols"][sym] = new_meta

            if new_bars and new_bars > 0:
                updated_count += 1
                if i % 20 == 0 or i == len(stale):
                    pct = int(i / len(stale) * 100)
                    print(f"  [{pct:3d}%] {i}/{len(stale)} — last: {sym} (+{new_bars} bars)")
            else:
                skipped_count += 1

        except Exception as e:
            error_count += 1
            if not args.dry_run:
                manifest["symbols"][sym] = {**meta, "error": str(e)}

        time.sleep(0.1)  # gentle rate limiting

    if not args.dry_run:
        save_manifest(manifest)

    elapsed = int(time.time() - t0)
    print("\n" + "=" * 60)
    print(f"  DONE in {elapsed // 60}m {elapsed % 60}s")
    print(f"  Updated:  {updated_count} symbols")
    print(f"  Skipped:  {skipped_count} (already current)")
    print(f"  Errors:   {error_count}")
    if args.dry_run:
        print("  (dry run — no files written)")
    print("=" * 60)


if __name__ == "__main__":
    main()
