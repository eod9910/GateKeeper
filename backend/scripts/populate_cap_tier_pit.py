#!/usr/bin/env python3
"""
populate_cap_tier_pit.py
------------------------
Populates fundamentals-pit.sqlite with cap_tier and index_membership facts
for every stock in universe_clean.json — no yfinance, no network calls.

Source: universe_clean.json (built by build_clean_universe.py)
  cap_tier: 'large' | 'mid' | 'small' | 'unknown'
  index: 'sp500' | 'sp400' | 'sp600' | None

Writes two metrics per symbol:
  - cap_tier      (text)  → 'large', 'mid', 'small', 'unknown'
  - index_member  (text)  → 'sp500', 'sp400', 'sp600', or ''

Usage:
  py backend/scripts/populate_cap_tier_pit.py
"""

import json
import os
import sqlite3
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")
UNIVERSE_CLEAN = os.path.join(DATA_DIR, "universe_clean.json")
DB_PATH = os.path.join(DATA_DIR, "fundamentals-pit.sqlite")


def main() -> None:
    if not os.path.exists(UNIVERSE_CLEAN):
        print("ERROR: universe_clean.json not found. Run build_clean_universe.py first.")
        return
    if not os.path.exists(DB_PATH):
        print("ERROR: fundamentals-pit.sqlite not found.")
        return

    with open(UNIVERSE_CLEAN, "r", encoding="utf-8") as f:
        universe = json.load(f)

    stocks = universe.get("stocks", [])
    print(f"Loaded {len(stocks)} stocks from universe_clean.json")

    today = time.strftime("%Y-%m-%d")
    now_ms = int(time.time() * 1000)

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Ensure pit_market_facts table has the right schema (already exists based on audit)
    inserted = 0
    updated = 0

    for stock in stocks:
        ticker = stock.get("ticker", "").strip()
        cap_tier = stock.get("cap_tier", "unknown") or "unknown"
        index_member = stock.get("index") or ""
        if not ticker:
            continue

        for metric, value_text in [("cap_tier", cap_tier), ("index_member", index_member)]:
            # Upsert: replace if same symbol+metric+market_date
            cur.execute("""
                SELECT rowid FROM pit_market_facts
                WHERE symbol=? AND metric=? AND market_date=?
            """, (ticker, metric, today))
            row = cur.fetchone()
            if row:
                cur.execute("""
                    UPDATE pit_market_facts
                    SET value_text=?, updated_at=?
                    WHERE rowid=?
                """, (value_text, time.strftime("%Y-%m-%dT%H:%M:%SZ"), row[0]))
                updated += 1
            else:
                cur.execute("""
                    INSERT INTO pit_market_facts
                    (symbol, metric, value_numeric, value_text, value_type,
                     market_date, available_at, source, source_path,
                     source_record_hash, fetched_at_ms, updated_at)
                    VALUES (?,?,NULL,?,'text',?,?,
                            'universe_clean','build_clean_universe.py',
                            '',?,?)
                """, (
                    ticker, metric, value_text,
                    today, today,
                    now_ms, time.strftime("%Y-%m-%dT%H:%M:%SZ")
                ))
                inserted += 1

        if (inserted + updated) % 1000 == 0:
            con.commit()
            print(f"  Progress: {inserted} inserted, {updated} updated")

    con.commit()
    con.close()

    total = len(stocks)
    print(f"\nDone. {total} stocks processed.")
    print(f"  {inserted} rows inserted, {updated} rows updated")
    print(f"  cap_tier and index_member now available in pit_market_facts")


if __name__ == "__main__":
    main()
