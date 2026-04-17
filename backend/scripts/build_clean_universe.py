#!/usr/bin/env python3
"""
build_clean_universe.py
-----------------------
Builds a clean, authoritative universe of US-listed common stocks.

Sources:
  1. NASDAQ Trader symbol directory (nasdaqlisted.txt + otherlisted.txt)
     - Free, updated nightly, no API key needed
  2. S&P 500/400/600 constituents from Wikipedia
     - Used for cap tier classification

Output files (backend/data/):
  - universe_clean.json        — all clean common stocks (~4,000-5,000)
  - sp500_universe.json        — S&P 500 large caps (~500)
  - sp400_universe.json        — S&P 400 mid caps (~400)
  - sp600_universe.json        — S&P 600 small caps (~600)
  - universe_tickers.json      — simple flat list of all tickers (replaces old one)

Usage:
  python backend/scripts/build_clean_universe.py
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")

# ── NASDAQ FTP URLs ────────────────────────────────────────────────────────────
NASDAQ_LISTED_URL = "https://nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL  = "https://nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

# ── S&P Wikipedia URLs ─────────────────────────────────────────────────────────
SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
SP400_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies"
SP600_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_600_companies"

# ── Filter patterns for non-common-stock tickers ──────────────────────────────
# Tickers with these characters are warrants, units, preferred, rights, etc.
BAD_TICKER_CHARS = re.compile(r'[/\+\=\^\$\~\*\!]')
# Tickers ending in these explicit multi-letter suffixes (after stripping)
# are still commonly used for warrants/rights/preferred variants. Single-letter
# endings are far too noisy and were excluding valid common stocks like ORCL.
BAD_TICKER_SUFFIXES = re.compile(r'(WS|WT|RT|PR|WW)$')
# Company name keywords that indicate non-common-stock
BAD_NAME_KEYWORDS = [
    "ETF", "ETP", "Fund", "Trust", "Note", "Notes", "Warrant", "Unit",
    "Units", "Rights", "Preferred", "Depositary", "Index", "Portfolio",
    "Certificate", "Certificates", "Bond", "Bonds", "Income", "ProShares",
    "Direxion", "iShares", "Invesco", "VanEck", "WisdomTree", "SPDR",
    "Vanguard", "Fidelity MSCI",
]

# Name fragments that should never survive in the domestic common-stock universe.
EXCLUDED_NAME_FRAGMENTS = [
    " TEST ",
    "TEST ISSUE",
    "ACQUISITION",
    "AMERICAN DEPOSITARY",
    "DEPOSITARY SHARE",
    "DEPOSITARY SHARES",
    " ADR",
    " ADS",
    "ORDINARY SHARE",
    "ORDINARY SHARES",
    "SUBORDINATE VOTING SHARE",
    "SUBORDINATE VOTING SHARES",
    "LIMITED VOTING SHARE",
    "LIMITED VOTING SHARES",
    "VOTING SHARE",
    "VOTING SHARES",
    "TICK PILOT TEST",
    "SYMBOLOGY TEST",
    "NYSE TEST",
    "NASDAQ TEST",
]

# Positive allowlist: if a security name does not look like common stock/common shares,
# it should not enter the canonical clean stock universe.
REQUIRED_NAME_FRAGMENTS = [
    "COMMON STOCK",
    "COMMON SHARE",
    "COMMON SHARES",
]


def fetch_url(url: str) -> str:
    print(f"  Fetching {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def is_bad_ticker(ticker: str, name: str) -> bool:
    if BAD_TICKER_CHARS.search(ticker):
        return True
    if BAD_TICKER_SUFFIXES.search(ticker):
        return True
    name_upper = name.upper()
    padded_name_upper = f" {name_upper} "
    for kw in BAD_NAME_KEYWORDS:
        if kw.upper() in name_upper:
            return True
    for fragment in EXCLUDED_NAME_FRAGMENTS:
        if fragment in padded_name_upper:
            return True
    if not any(fragment in name_upper for fragment in REQUIRED_NAME_FRAGMENTS):
        return True
    return False


def parse_nasdaq_listed(text: str) -> list[dict]:
    """Parse nasdaqlisted.txt — pipe-delimited, first col = Symbol."""
    rows = []
    lines = text.strip().splitlines()
    if not lines:
        return rows
    # Skip header and trailing file creation line
    for line in lines[1:]:
        if line.startswith("File Creation Time"):
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        ticker = parts[0].strip()
        name   = parts[1].strip()
        etf    = parts[6].strip() if len(parts) > 6 else ""
        if etf == "Y":
            continue
        if not ticker or not name:
            continue
        if is_bad_ticker(ticker, name):
            continue
        rows.append({"ticker": ticker, "name": name, "exchange": "NASDAQ"})
    return rows


def parse_other_listed(text: str) -> list[dict]:
    """Parse otherlisted.txt — pipe-delimited, ACT Symbol col."""
    rows = []
    lines = text.strip().splitlines()
    if not lines:
        return rows
    # Header: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
    for line in lines[1:]:
        if line.startswith("File Creation Time"):
            continue
        parts = line.split("|")
        if len(parts) < 5:
            continue
        ticker   = parts[0].strip()
        name     = parts[1].strip()
        exchange = parts[2].strip()
        etf      = parts[4].strip()
        test_issue = parts[6].strip() if len(parts) > 6 else ""
        if etf == "Y":
            continue
        if test_issue == "Y":
            continue
        if not ticker or not name:
            continue
        if is_bad_ticker(ticker, name):
            continue
        rows.append({"ticker": ticker, "name": name, "exchange": exchange})
    return rows


def fetch_sp_index(url: str, index_name: str) -> set[str]:
    """Scrape S&P index constituents from Wikipedia using a browser-like user agent."""
    try:
        import pandas as pd, io
        print(f"  Fetching {index_name} from Wikipedia...")
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", errors="replace")
        tables = pd.read_html(io.StringIO(html))
        df = tables[0]
        for col in df.columns:
            col_str = str(col).lower()
            if "symbol" in col_str or "ticker" in col_str:
                tickers = set(df[col].astype(str).str.strip().str.replace(".", "-", regex=False))
                print(f"  {index_name}: {len(tickers)} constituents")
                return tickers
        print(f"  WARNING: Could not find ticker column in {index_name} table")
        return set()
    except Exception as e:
        print(f"  WARNING: Could not fetch {index_name}: {e}")
        return set()


def save_json(path: str, obj: object) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    print(f"  Saved: {path} ({os.path.getsize(path):,} bytes)")


def main() -> None:
    print("=" * 60)
    print(" Building Clean Universe from NASDAQ + S&P Indices")
    print("=" * 60)

    # ── Step 1: Download NASDAQ symbol files ──────────────────────
    print("\n[1/4] Downloading NASDAQ symbol directory...")
    try:
        nasdaq_text = fetch_url(NASDAQ_LISTED_URL)
        other_text  = fetch_url(OTHER_LISTED_URL)
    except Exception as e:
        print(f"ERROR: Could not download NASDAQ files: {e}")
        sys.exit(1)

    nasdaq_stocks = parse_nasdaq_listed(nasdaq_text)
    other_stocks  = parse_other_listed(other_text)
    print(f"  NASDAQ listed (filtered): {len(nasdaq_stocks):,} common stocks")
    print(f"  Other listed (filtered):  {len(other_stocks):,} common stocks")

    # Merge, deduplicate by ticker
    all_stocks: dict[str, dict] = {}
    for s in nasdaq_stocks + other_stocks:
        t = s["ticker"]
        if t not in all_stocks:
            all_stocks[t] = s

    print(f"  Combined unique tickers:  {len(all_stocks):,}")

    # ── Step 2: Fetch S&P index constituents ──────────────────────
    print("\n[2/4] Fetching S&P index constituents from Wikipedia...")
    sp500_tickers = fetch_sp_index(SP500_URL, "S&P 500")
    sp400_tickers = fetch_sp_index(SP400_URL, "S&P 400 MidCap")
    sp600_tickers = fetch_sp_index(SP600_URL, "S&P 600 SmallCap")

    # ── Step 3: Tag each stock with cap tier ──────────────────────
    print("\n[3/4] Classifying cap tiers...")
    for ticker, stock in all_stocks.items():
        if ticker in sp500_tickers:
            stock["cap_tier"] = "large"
            stock["index"] = "sp500"
        elif ticker in sp400_tickers:
            stock["cap_tier"] = "mid"
            stock["index"] = "sp400"
        elif ticker in sp600_tickers:
            stock["cap_tier"] = "small"
            stock["index"] = "sp600"
        else:
            stock["cap_tier"] = "unknown"
            stock["index"] = None

    # ── Step 4: Build output files ────────────────────────────────
    print("\n[4/4] Writing output files...")

    built_at = datetime.utcnow().isoformat()
    all_list = sorted(all_stocks.values(), key=lambda x: x["ticker"])
    all_tickers = [s["ticker"] for s in all_list]

    sp500_list = [s["ticker"] for s in all_list if s["index"] == "sp500"]
    sp400_list = [s["ticker"] for s in all_list if s["index"] == "sp400"]
    sp600_list = [s["ticker"] for s in all_list if s["index"] == "sp600"]

    # universe_clean.json — full metadata
    save_json(os.path.join(DATA_DIR, "universe_clean.json"), {
        "built_at": built_at,
        "source": "NASDAQ Trader + S&P Wikipedia",
        "count": len(all_list),
        "stocks": all_list,
    })

    # universe_tickers.json — flat ticker list (replaces old one)
    save_json(os.path.join(DATA_DIR, "universe_tickers.json"), all_tickers)

    # sp500_universe.json
    save_json(os.path.join(DATA_DIR, "sp500_universe.json"), {
        "built_at": built_at,
        "name": "S&P 500",
        "cap_tier": "large",
        "count": len(sp500_list),
        "symbols": sp500_list,
    })

    # sp400_universe.json
    save_json(os.path.join(DATA_DIR, "sp400_universe.json"), {
        "built_at": built_at,
        "name": "S&P 400 MidCap",
        "cap_tier": "mid",
        "count": len(sp400_list),
        "symbols": sp400_list,
    })

    # sp600_universe.json
    save_json(os.path.join(DATA_DIR, "sp600_universe.json"), {
        "built_at": built_at,
        "name": "S&P 600 SmallCap",
        "cap_tier": "small",
        "count": len(sp600_list),
        "symbols": sp600_list,
    })

    print("\n" + "=" * 60)
    print(" Summary")
    print("=" * 60)
    print(f"  Total clean common stocks: {len(all_list):,}")
    print(f"  S&P 500  (large cap):      {len(sp500_list):,}")
    print(f"  S&P 400  (mid cap):        {len(sp400_list):,}")
    print(f"  S&P 600  (small cap):      {len(sp600_list):,}")
    print(f"  Unclassified:              {len([s for s in all_list if s['index'] is None]):,}")
    print("\nDone! Next: wire sp500_universe.json into validator tiers.")


if __name__ == "__main__":
    main()
