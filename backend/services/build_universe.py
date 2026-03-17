#!/usr/bin/env python3
"""
Build an optionable scanning universe from a selectable symbol source.

Supported sources:
  - nasdaq-trader-us: broad US-listed symbols from Nasdaq Trader directories
  - russell2000: Russell 2000 constituents from iShares IWM holdings
  - custom CSV: user-supplied tickers via --tickers-csv

The build flow is:
  1. Fetch source tickers
  2. Confirm option chains exist
  3. Filter by minimum average share volume
  4. Download OHLCV history
  5. Write CSV data, optionable.json, and manifest.json
"""

import argparse
import contextlib
import csv
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("ERROR: pandas not installed. Run: pip install pandas")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

try:
    import yfinance as yf
except ImportError:
    print("ERROR: yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

try:
    from yfinance.ticker import _BASE_URL_ as YF_BASE_URL
except ImportError:
    YF_BASE_URL = "https://query2.finance.yahoo.com"


SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data" / "universe"
DATA_DIR.mkdir(parents=True, exist_ok=True)
MANIFEST_PATH = DATA_DIR / "manifest.json"
OPTIONABLE_PATH = DATA_DIR / "optionable.json"
OPTIONABLE_PROGRESS_PATH = DATA_DIR / "optionable-progress.json"

IWM_HOLDINGS_URL = (
    "https://www.ishares.com/us/products/239710/"
    "ishares-russell-2000-etf/1467271812596.ajax"
    "?fileType=csv&fileName=IWM_holdings&dataType=fund"
)
NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
    )
}

SOURCE_LABELS = {
    "nasdaq-trader-us": "Nasdaq Trader US-listed underlyings",
    "russell2000": "Russell 2000 constituents",
    "custom_csv": "Custom CSV universe",
}

EXCLUDED_NAME_TOKENS = (
    " ETF",
    " ETN",
    " FUND",
    " WARRANT",
    " RIGHTS",
    " UNIT",
    " UNITS",
    " PREFERRED",
    " NOTES",
    " BOND",
    " DEBENTURE",
    " NEXTSHARES",
)

ELIGIBLE_NAME_TOKENS = (
    "COMMON STOCK",
    "COMMON SHARE",
    "COMMON SHARES",
    "ORDINARY SHARE",
    "ORDINARY SHARES",
    "AMERICAN DEPOSITARY SHARE",
    "AMERICAN DEPOSITARY SHARES",
    "ADS",
    "ADR",
    "SUBORDINATE VOTING SHARES",
    "LIMITED VOTING SHARES",
    "VOTING SHARES",
)
RETRYABLE_OPTION_ERROR_TOKENS = (
    "too many requests",
    "rate limit",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "service unavailable",
    "connection reset",
    "connection aborted",
    "bad gateway",
    "gateway timeout",
    "read timed out",
    "timed out reading",
)
OPTIONABLE_PROGRESS_EVERY = 10
DEFAULT_OPTIONS_TIMEOUT_SECONDS = 8.0


@contextlib.contextmanager
def suppress_yfinance_output():
    """Suppress noisy yfinance stdout/stderr that can look like hard failures."""
    sink = io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        yield


def normalize_symbol(symbol: str) -> str:
    return (symbol or "").strip().replace(".", "-").upper()


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _security_name_is_eligible(name: str) -> bool:
    upper = f" {str(name or '').upper()} "
    if any(token in upper for token in EXCLUDED_NAME_TOKENS):
        return False
    return any(token in upper for token in ELIGIBLE_NAME_TOKENS)


def _load_pipe_rows(url: str) -> list[dict]:
    response = requests.get(url, headers=HTTP_HEADERS, timeout=30)
    response.raise_for_status()
    reader = csv.DictReader(io.StringIO(response.text), delimiter="|")
    return list(reader)


def fetch_nasdaq_trader_us_tickers(include_etfs: bool = True) -> list[str]:
    """Fetch a broad US-listed tradable-underlying universe from Nasdaq Trader directories."""
    print("Fetching broad US-listed tickers from Nasdaq Trader...")

    tickers: list[str] = []
    nasdaq_rows = _load_pipe_rows(NASDAQ_LISTED_URL)
    other_rows = _load_pipe_rows(OTHER_LISTED_URL)

    for row in nasdaq_rows:
        symbol = normalize_symbol(row.get("Symbol"))
        name = row.get("Security Name") or ""
        is_etf = row.get("ETF") == "Y"
        if not symbol or row.get("Test Issue") == "Y":
            continue
        if is_etf and include_etfs:
            tickers.append(symbol)
        elif not is_etf and _security_name_is_eligible(name):
            tickers.append(symbol)

    for row in other_rows:
        symbol = normalize_symbol(
            row.get("ACT Symbol") or row.get("NASDAQ Symbol") or row.get("CQS Symbol")
        )
        name = row.get("Security Name") or ""
        is_etf = row.get("ETF") == "Y"
        if not symbol or row.get("Test Issue") == "Y":
            continue
        if is_etf and include_etfs:
            tickers.append(symbol)
        elif not is_etf and _security_name_is_eligible(name):
            tickers.append(symbol)

    tickers = _dedupe(tickers)
    suffix = "stocks + ETFs" if include_etfs else "stocks"
    print(f"  Found {len(tickers)} eligible US-listed {suffix}")
    return tickers


def fetch_russell2000_tickers() -> list[str]:
    """Download current Russell 2000 components from iShares IWM holdings."""
    print("Fetching Russell 2000 tickers from iShares IWM holdings...")
    try:
        response = requests.get(IWM_HOLDINGS_URL, headers=HTTP_HEADERS, timeout=30)
        response.raise_for_status()

        lines = response.text.splitlines()
        header_idx = None
        for idx, line in enumerate(lines):
            if line.startswith("Ticker") or ",Ticker," in line or "Ticker," in line:
                header_idx = idx
                break

        if header_idx is None:
            raise ValueError("Could not find 'Ticker' header row in iShares CSV")

        reader = csv.DictReader(io.StringIO("\n".join(lines[header_idx:])))
        tickers = []
        for row in reader:
            ticker = normalize_symbol(row.get("Ticker") or row.get("ticker") or "")
            if ticker and ticker not in ("-", "USD", "CASH") and "=" not in ticker:
                tickers.append(ticker)

        tickers = _dedupe(tickers)
        print(f"  Found {len(tickers)} Russell 2000 components")
        return tickers

    except Exception as err:
        print(f"  WARNING: Could not fetch from iShares: {err}")
        print("  Falling back to IWM constituent download via yfinance...")
        return _fallback_iwm_tickers()


def _fallback_iwm_tickers() -> list[str]:
    try:
        _ = yf.Ticker("IWM").info
        print("  yfinance fallback could not retrieve the full Russell 2000 list.")
        print("  Please provide a CSV file with --tickers-csv.")
        return []
    except Exception:
        return []


def load_tickers_from_csv(path: str) -> list[str]:
    """Load tickers from a user-supplied CSV."""
    tickers = []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        ticker_col = next(
            (name for name in fieldnames if name.strip().lower() in ("ticker", "symbol", "tickers")),
            None,
        )
        if ticker_col:
            for row in reader:
                ticker = normalize_symbol(row[ticker_col])
                if ticker:
                    tickers.append(ticker)
        else:
            handle.seek(0)
            for line in handle:
                ticker = normalize_symbol(line.split(",")[0])
                if ticker and ticker.lower() not in ("ticker", "symbol"):
                    tickers.append(ticker)
    tickers = _dedupe(tickers)
    print(f"  Loaded {len(tickers)} tickers from {path}")
    return tickers


def _is_retryable_option_error(err: Exception) -> bool:
    message = str(err or "").lower()
    return any(token in message for token in RETRYABLE_OPTION_ERROR_TOKENS)


def check_optionability(
    symbol: str,
    retries: int = 4,
    base_delay_seconds: float = 0.75,
    timeout_seconds: float = DEFAULT_OPTIONS_TIMEOUT_SECONDS,
    session=None,
    crumb: str | None = None,
) -> tuple[str, str, str | None]:
    """
    Return (symbol, status, detail) where status is:
      - optionable
      - not_optionable
      - unknown
    """
    last_detail = None

    for attempt in range(retries):
        try:
            with suppress_yfinance_output():
                if session is None or not crumb:
                    data_client = yf.Ticker(symbol)._data
                    crumb_value = crumb
                    if not crumb_value:
                        crumb_value, _ = data_client._get_cookie_and_crumb(timeout=timeout_seconds)
                    active_session = session or data_client._session
                else:
                    active_session = session
                    crumb_value = crumb
                url = f"{YF_BASE_URL}/v7/finance/options/{symbol}"
                response = active_session.get(
                    url,
                    params={"crumb": crumb_value},
                    headers=HTTP_HEADERS,
                    timeout=(3, timeout_seconds),
                )
                if getattr(response, "status_code", 200) == 401:
                    raise RuntimeError("Unauthorized / invalid crumb")
                response = response.json()
                finance_error = response.get("finance", {}).get("error")
                if finance_error:
                    raise RuntimeError(str(finance_error.get("description") or finance_error.get("code") or "Finance error"))
                results = response.get("optionChain", {}).get("result", []) or []
                expiration_dates = results[0].get("expirationDates", []) if results else []
                expirations = list(expiration_dates or [])
            if expirations:
                return symbol, "optionable", None

            last_detail = "Empty options chain"
            # Empty chains occasionally happen on transient Yahoo failures. Retry before rejecting.
            if attempt < retries - 1:
                time.sleep(base_delay_seconds * (attempt + 1))
                continue
            return symbol, "not_optionable", None
        except Exception as err:
            last_detail = str(err)
            if attempt < retries - 1:
                sleep_mult = 2.0 if _is_retryable_option_error(err) else 1.0
                time.sleep(base_delay_seconds * (attempt + 1) * sleep_mult)
                continue
            return symbol, "unknown", last_detail

    return symbol, "unknown", last_detail


def write_optionable_catalog(
    source_tickers: list[str],
    optionable: list[str],
    not_optionable: list[str] | None,
    unknown: list[dict] | None,
    source: str,
    source_label: str,
    include_etfs: bool = True,
):
    normalized_source = sorted(_dedupe([normalize_symbol(symbol) for symbol in source_tickers]))
    normalized_optionable = sorted(_dedupe([normalize_symbol(symbol) for symbol in optionable]))
    normalized_not_optionable = sorted(_dedupe([normalize_symbol(symbol) for symbol in (not_optionable or [])]))
    normalized_unknown = sorted((unknown or []), key=lambda item: item.get("symbol") or "")
    unknown_symbols = sorted(
        _dedupe([normalize_symbol(item.get("symbol")) for item in normalized_unknown if item.get("symbol")])
    )
    classified_symbols = set(normalized_optionable) | set(normalized_not_optionable) | set(unknown_symbols)
    unclassified_symbols = sorted(symbol for symbol in normalized_source if symbol not in classified_symbols)
    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source": source,
        "source_label": source_label,
        "include_etfs": include_etfs,
        "source_symbol_count": len(normalized_source),
        "source_symbols": normalized_source,
        "total_checked": len(normalized_source),
        "optionable_count": len(normalized_optionable),
        "optionable": normalized_optionable,
        "not_optionable_count": len(normalized_not_optionable),
        "not_optionable": normalized_not_optionable,
        "unknown_count": len(normalized_unknown),
        "unknown_optionability": normalized_unknown,
        "classified_count": len(classified_symbols),
        "unclassified_count": len(unclassified_symbols),
        "unclassified_symbols": unclassified_symbols,
        "complete_optionability": len(unclassified_symbols) == 0,
    }
    with open(OPTIONABLE_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def filter_optionable(
    tickers: list[str],
    workers: int = 10,
    timeout_seconds: float = DEFAULT_OPTIONS_TIMEOUT_SECONDS,
    source: str = "unknown",
    source_label: str = "Unknown source",
    include_etfs: bool = True,
) -> list[str]:
    """
    Check each ticker for options availability in parallel.
    This is the slow step.
    """
    print(
        f"\nChecking options availability for {len(tickers)} tickers "
        f"({workers} parallel workers)..."
    )
    print("  This takes a while because each symbol requires an options-chain check.\n")
    print(f"  Per-symbol timeout: {timeout_seconds:.1f}s")

    optionable_seed, not_optionable_seed, unknown_seed = load_optionable_progress(
        expected_source_symbols=tickers,
        source=source,
        include_etfs=include_etfs,
    )
    classified_seed = optionable_seed | not_optionable_seed | set(unknown_seed.keys())
    pending_tickers = [symbol for symbol in tickers if normalize_symbol(symbol) not in classified_seed]
    optionable = set(optionable_seed)
    not_optionable = set(not_optionable_seed)
    unknown = dict(unknown_seed)
    done = len(classified_seed)

    if classified_seed:
        print(
            f"  Resuming from checkpoint: {done}/{len(tickers)} already classified "
            f"({len(optionable)} optionable, {len(not_optionable)} not optionable, {len(unknown)} unknown)"
        )
    if not pending_tickers:
        print("  All source symbols are already classified in the local checkpoint.")
        write_optionable_catalog(
            source_tickers=tickers,
            optionable=sorted(optionable),
            not_optionable=sorted(not_optionable),
            unknown=[{"symbol": symbol, "detail": detail} for symbol, detail in sorted(unknown.items())],
            source=source,
            source_label=source_label,
            include_etfs=include_etfs,
        )
        if OPTIONABLE_PROGRESS_PATH.exists():
            OPTIONABLE_PROGRESS_PATH.unlink(missing_ok=True)
        return sorted(optionable)

    data_client = yf.Ticker("SPY")._data
    crumb, _ = data_client._get_cookie_and_crumb(timeout=timeout_seconds)
    shared_session = data_client._session
    print(f"  Pending symbols: {len(pending_tickers)}")

    def check(symbol: str):
        result = check_optionability(
            symbol,
            timeout_seconds=timeout_seconds,
            session=shared_session,
            crumb=crumb,
        )
        time.sleep(0.05)
        return result

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(check, ticker): ticker for ticker in pending_tickers}
        for future in as_completed(futures):
            done += 1
            try:
                symbol, status, detail = future.result()
                if status == "optionable":
                    optionable.add(symbol)
                    not_optionable.discard(symbol)
                    unknown.pop(symbol, None)
                elif status == "not_optionable":
                    not_optionable.add(symbol)
                    optionable.discard(symbol)
                    unknown.pop(symbol, None)
                else:
                    unknown[symbol] = detail or ""
                    optionable.discard(symbol)
                    not_optionable.discard(symbol)
            except Exception:
                symbol = futures[future]
                unknown[symbol] = "Unhandled worker exception"

            if done % OPTIONABLE_PROGRESS_EVERY == 0 or done == len(tickers):
                write_optionable_progress(
                    source_tickers=tickers,
                    optionable=optionable,
                    not_optionable=not_optionable,
                    unknown=unknown,
                    source=source,
                    source_label=source_label,
                    include_etfs=include_etfs,
                )

            if done % OPTIONABLE_PROGRESS_EVERY == 0 or done == len(tickers):
                pct = int(done / len(tickers) * 100)
                print(
                    f"  [{pct:3d}%] {done}/{len(tickers)} checked - "
                    f"{len(optionable)} optionable so far"
                )

    print("\nOptions filter results:")
    print(f"  Optionable:     {len(optionable)}")
    print(f"  Not optionable: {len(not_optionable)}")
    print(f"  Unknown:        {len(unknown)}")

    if unknown:
        print("\nRetrying unknown optionability results sequentially...")
        recovered = 0
        still_unknown = {}
        unknown_items = [{"symbol": symbol, "detail": detail} for symbol, detail in sorted(unknown.items())]
        for idx, item in enumerate(unknown_items, 1):
            symbol, status, detail = check_optionability(
                item["symbol"],
                retries=5,
                base_delay_seconds=1.5,
                timeout_seconds=timeout_seconds,
                session=shared_session,
                crumb=crumb,
            )
            if status == "optionable":
                optionable.add(symbol)
                not_optionable.discard(symbol)
                recovered += 1
            elif status == "not_optionable":
                not_optionable.add(symbol)
                optionable.discard(symbol)
            else:
                still_unknown[symbol] = detail or item.get("detail") or ""

            if idx % 25 == 0 or idx == len(unknown_items):
                write_optionable_progress(
                    source_tickers=tickers,
                    optionable=optionable,
                    not_optionable=not_optionable,
                    unknown=still_unknown,
                    source=source,
                    source_label=source_label,
                    include_etfs=include_etfs,
                )
                pct = int(idx / len(unknown_items) * 100)
                print(f"  [retry {pct:3d}%] {idx}/{len(unknown)} checked - recovered {recovered}")

        unknown = still_unknown
        print(f"  Recovered after retry: {recovered}")
        print(f"  Remaining unknown:     {len(unknown)}")

    write_optionable_catalog(
        source_tickers=tickers,
        optionable=sorted(optionable),
        not_optionable=sorted(not_optionable),
        unknown=[{"symbol": symbol, "detail": detail} for symbol, detail in sorted(unknown.items())],
        source=source,
        source_label=source_label,
        include_etfs=include_etfs,
    )
    OPTIONABLE_PROGRESS_PATH.unlink(missing_ok=True)
    print(f"  Saved optionable list to {OPTIONABLE_PATH}")

    return sorted(optionable)


def validate_optionable_catalog(
    data: dict,
    expected_source_symbols: list[str],
) -> tuple[bool, str | None]:
    existing_source_symbols = data.get("source_symbols")
    if not isinstance(existing_source_symbols, list) or not existing_source_symbols:
        return False, "Existing optionable.json is missing full source-universe metadata."

    normalized_existing_source = sorted(_dedupe([normalize_symbol(symbol) for symbol in existing_source_symbols]))
    normalized_current_source = sorted(_dedupe(expected_source_symbols))
    if normalized_existing_source != normalized_current_source:
        return False, "Existing optionable.json does not match the current source-universe membership."

    optionable_symbols = sorted(_dedupe([normalize_symbol(symbol) for symbol in data.get("optionable") or []]))
    not_optionable_symbols = sorted(_dedupe([normalize_symbol(symbol) for symbol in data.get("not_optionable") or []]))
    unknown_symbols = sorted(
        _dedupe([
            normalize_symbol(item.get("symbol"))
            for item in (data.get("unknown_optionability") or [])
            if isinstance(item, dict) and item.get("symbol")
        ])
    )
    classified_symbols = set(optionable_symbols) | set(not_optionable_symbols) | set(unknown_symbols)
    missing_symbols = [symbol for symbol in normalized_current_source if symbol not in classified_symbols]
    if missing_symbols:
        return False, f"Existing optionable.json is incomplete ({len(missing_symbols)} source symbols unclassified)."

    extra_symbols = sorted(symbol for symbol in classified_symbols if symbol not in set(normalized_current_source))
    if extra_symbols:
        return False, f"Existing optionable.json contains {len(extra_symbols)} symbols outside the current source universe."

    return True, None


def load_optionable_progress(
    expected_source_symbols: list[str],
    source: str,
    include_etfs: bool,
) -> tuple[set[str], set[str], dict[str, str]]:
    normalized_source = sorted(_dedupe([normalize_symbol(symbol) for symbol in expected_source_symbols]))
    source_set = set(normalized_source)
    seeded_optionable: set[str] = set()
    seeded_not_optionable: set[str] = set()
    seeded_unknown: dict[str, str] = {}

    candidates: list[Path] = [OPTIONABLE_PROGRESS_PATH, OPTIONABLE_PATH]
    for candidate_path in candidates:
        if not candidate_path.exists():
            continue
        try:
            with open(candidate_path, encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            continue

        existing_source = str(data.get("source") or "").strip()
        existing_include_etfs_raw = data.get("include_etfs")
        existing_include_etfs = include_etfs if existing_include_etfs_raw is None else bool(existing_include_etfs_raw)
        if existing_source != source or existing_include_etfs != include_etfs:
            continue

        optionable = {
            normalize_symbol(symbol)
            for symbol in (data.get("optionable") or [])
            if normalize_symbol(symbol) in source_set
        }
        not_optionable = {
            normalize_symbol(symbol)
            for symbol in (data.get("not_optionable") or [])
            if normalize_symbol(symbol) in source_set
        }
        unknown = {
            normalize_symbol(item.get("symbol")): str(item.get("detail") or "")
            for item in (data.get("unknown_optionability") or [])
            if isinstance(item, dict)
            and item.get("symbol")
            and normalize_symbol(item.get("symbol")) in source_set
        }
        seeded_optionable |= optionable
        seeded_not_optionable |= not_optionable
        seeded_unknown.update(unknown)

    seeded_optionable -= seeded_not_optionable
    seeded_optionable -= set(seeded_unknown.keys())
    seeded_not_optionable -= set(seeded_unknown.keys())
    return seeded_optionable, seeded_not_optionable, seeded_unknown


def write_optionable_progress(
    source_tickers: list[str],
    optionable: set[str],
    not_optionable: set[str],
    unknown: dict[str, str],
    source: str,
    source_label: str,
    include_etfs: bool = True,
) -> None:
    normalized_source = sorted(_dedupe([normalize_symbol(symbol) for symbol in source_tickers]))
    normalized_optionable = sorted(symbol for symbol in optionable if symbol in set(normalized_source))
    normalized_not_optionable = sorted(symbol for symbol in not_optionable if symbol in set(normalized_source))
    normalized_unknown = [
        {"symbol": symbol, "detail": unknown.get(symbol) or ""}
        for symbol in sorted(symbol for symbol in unknown.keys() if symbol in set(normalized_source))
    ]
    classified_count = len(set(normalized_optionable) | set(normalized_not_optionable) | {item["symbol"] for item in normalized_unknown})
    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source": source,
        "source_label": source_label,
        "include_etfs": include_etfs,
        "source_symbol_count": len(normalized_source),
        "source_symbols": normalized_source,
        "optionable": normalized_optionable,
        "not_optionable": normalized_not_optionable,
        "unknown_optionability": normalized_unknown,
        "classified_count": classified_count,
        "unclassified_count": max(0, len(normalized_source) - classified_count),
        "complete_optionability": classified_count >= len(normalized_source) and len(normalized_source) > 0,
    }
    with open(OPTIONABLE_PROGRESS_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def filter_by_volume(tickers: list[str], min_avg_vol: int) -> list[str]:
    """
    Quick volume check using 30-day average. Removes completely illiquid stocks
    that technically have options listed but where options are usually untradeable.
    """
    if min_avg_vol <= 0:
        return tickers

    print(f"\nChecking 30-day average volume (min {min_avg_vol:,} shares/day)...")
    passed = []
    failed = []

    batch_size = 200
    for start in range(0, len(tickers), batch_size):
        batch = tickers[start:start + batch_size]
        try:
            with suppress_yfinance_output():
                data = yf.download(
                    batch,
                    period="30d",
                    interval="1d",
                    progress=False,
                    auto_adjust=True,
                    threads=False,
                )
            if data.empty:
                continue

            volumes = data["Volume"]
            avg_volumes = volumes.mean()
            for symbol in batch:
                avg = avg_volumes.get(symbol, 0) if hasattr(avg_volumes, "get") else 0
                if pd.isna(avg):
                    avg = 0
                if avg >= min_avg_vol:
                    passed.append(symbol)
                else:
                    failed.append(symbol)
        except Exception as err:
            print(f"  WARNING: Volume check batch failed: {err}")
            passed.extend(batch)

        checked = min(start + batch_size, len(tickers))
        pct = int(checked / len(tickers) * 100)
        print(f"  [{pct:3d}%] {checked}/{len(tickers)} checked")

    print(f"  Passed volume filter: {len(passed)}")
    print(f"  Failed volume filter: {len(failed)} (avg vol < {min_avg_vol:,})")
    return passed


def _load_existing_symbol_result(symbol: str, interval: str) -> dict | None:
    out_path = DATA_DIR / f"{symbol}_{interval}.csv"
    if not out_path.exists():
        return None

    try:
        frame = pd.read_csv(out_path, index_col="date", parse_dates=True)
    except Exception:
        return None

    if frame.empty or len(frame) < 10:
        return None

    frame = frame.sort_index()
    last_close = None
    if "close" in frame.columns:
        last_close_value = frame["close"].iloc[-1]
        if pd.notna(last_close_value):
            last_close = float(last_close_value)

    return {
        "rows": len(frame),
        "start": str(frame.index[0].date()),
        "end": str(frame.index[-1].date()),
        "last_close": last_close,
        "error": None,
        "file": str(out_path.name),
        "reused": True,
    }


def download_history(
    tickers: list[str],
    lookback: str = "5y",
    interval: str = "1d",
    batch_size: int = 25,
    reuse_existing: bool = True,
) -> dict:
    """
    Download OHLCV history for all tickers and save as CSV files.
    Returns {symbol: {rows, start, end, error, file}}.
    """
    print(f"\nDownloading {lookback} of {interval} history for {len(tickers)} tickers...")
    results = {}
    remaining = list(tickers)

    if reuse_existing:
        reused_count = 0
        remaining = []
        for symbol in tickers:
            existing = _load_existing_symbol_result(symbol, interval)
            if existing:
                results[symbol] = existing
                reused_count += 1
            else:
                remaining.append(symbol)
        if reused_count:
            print(f"  Reusing {reused_count} existing history file(s) before download.")

    if not remaining:
        print("  All symbol history files already exist.")
        return results

    total_batches = (len(remaining) + batch_size - 1) // batch_size

    for batch_num, start in enumerate(range(0, len(remaining), batch_size), 1):
        batch = remaining[start:start + batch_size]
        print(
            f"  Batch {batch_num}/{total_batches} ({len(batch)} symbols)...",
            end=" ",
            flush=True,
        )

        try:
            raw = pd.DataFrame()
            last_error = None
            for attempt in range(3):
                try:
                    with suppress_yfinance_output():
                        raw = yf.download(
                            batch,
                            period=lookback,
                            interval=interval,
                            progress=False,
                            auto_adjust=True,
                            threads=False,
                        )
                    if not raw.empty:
                        break
                    last_error = "No data returned"
                except Exception as err:
                    last_error = str(err)
                time.sleep(2 + attempt * 3)

            if raw.empty:
                print("empty")
                for symbol in batch:
                    results[symbol] = {"rows": 0, "error": last_error or "No data returned"}
                continue

            if isinstance(raw.columns, pd.MultiIndex):
                for symbol in batch:
                    try:
                        symbol_data = raw.xs(symbol, level=1, axis=1).dropna(how="all")
                        _save_symbol(symbol, symbol_data, interval, results)
                    except KeyError:
                        results[symbol] = {"rows": 0, "error": "Symbol not in batch response"}
            else:
                symbol = batch[0]
                _save_symbol(symbol, raw.dropna(how="all"), interval, results)

            success = sum(1 for symbol in batch if results.get(symbol, {}).get("rows", 0) > 0)
            print(f"{success}/{len(batch)} OK")

        except Exception as err:
            print(f"ERROR: {err}")
            for symbol in batch:
                results[symbol] = {"rows": 0, "error": str(err)}

        time.sleep(0.5)

    return results


def _save_symbol(symbol: str, frame: pd.DataFrame, interval: str, results: dict):
    if frame.empty or len(frame) < 10:
        results[symbol] = {"rows": 0, "error": "Too few rows"}
        return

    frame = frame.copy()
    frame.index.name = "date"
    frame.columns = [column.lower() for column in frame.columns]

    out_path = DATA_DIR / f"{symbol}_{interval}.csv"
    frame.to_csv(out_path)
    last_close = None
    if "close" in frame.columns:
        last_close_value = frame["close"].iloc[-1]
        if pd.notna(last_close_value):
            last_close = float(last_close_value)

    results[symbol] = {
        "rows": len(frame),
        "start": str(frame.index[0].date()),
        "end": str(frame.index[-1].date()),
        "last_close": last_close,
        "error": None,
        "file": str(out_path.name),
    }


def write_manifest(
    tickers: list[str],
    download_results: dict,
    lookback: str,
    interval: str,
    source: str,
    source_label: str,
    source_symbol_count: int | None = None,
    optionable_count: int | None = None,
):
    generated_at = datetime.utcnow().isoformat() + "Z"
    manifest = {
        "generated_at": generated_at,
        "last_updated": generated_at,
        "source": source,
        "source_label": source_label,
        "source_symbol_count": source_symbol_count if source_symbol_count is not None else len(tickers),
        "optionable_count": optionable_count if optionable_count is not None else len(tickers),
        "lookback": lookback,
        "interval": interval,
        "total_symbols": len(tickers),
        "symbols_with_data": sum(1 for result in download_results.values() if result.get("rows", 0) > 0),
        "symbols": {},
    }
    for symbol in tickers:
        result = download_results.get(symbol, {})
        manifest["symbols"][symbol] = {
            "rows": result.get("rows", 0),
            "start": result.get("start"),
            "end": result.get("end"),
            "last_close": result.get("last_close"),
            "last_updated": generated_at,
            "error": result.get("error"),
            "file": result.get("file") or f"{symbol}_{interval}.csv",
        }

    with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    print(f"\nManifest saved to {MANIFEST_PATH}")


def main():
    parser = argparse.ArgumentParser(description="Build an optionable scanning universe")
    parser.add_argument(
        "--source",
        default="nasdaq-trader-us",
        choices=["nasdaq-trader-us", "russell2000"],
        help="Input universe source (ignored when --tickers-csv is provided)",
    )
    parser.add_argument(
        "--exclude-etfs",
        action="store_true",
        help="Exclude ETF underlyings from the broad Nasdaq Trader source",
    )
    parser.add_argument("--lookback", default="5y", help="History lookback (e.g. 5y, 3y, 2y)")
    parser.add_argument("--interval", default="1d", help="Bar interval (1d or 1wk)")
    parser.add_argument("--workers", type=int, default=10, help="Parallel workers for options check")
    parser.add_argument(
        "--option-timeout",
        type=float,
        default=DEFAULT_OPTIONS_TIMEOUT_SECONDS,
        help="Per-symbol timeout in seconds for each Yahoo option-chain request",
    )
    parser.add_argument("--batch-size", type=int, default=25, help="Symbols per download batch")
    parser.add_argument("--tickers-csv", default=None, help="Path to CSV with your own ticker list")
    parser.add_argument(
        "--skip-options-check",
        action="store_true",
        help="Skip options check and reuse optionable.json if its source matches",
    )
    parser.add_argument(
        "--min-volume",
        type=int,
        default=0,
        help="Minimum avg daily volume (0 to disable)",
    )
    parser.add_argument(
        "--options-only",
        action="store_true",
        help="Rebuild only the optionable subset and skip history download/manifest write",
    )
    args = parser.parse_args()

    requested_source = "custom_csv" if args.tickers_csv else args.source
    source_label = SOURCE_LABELS.get(requested_source, requested_source)
    include_etfs = not args.exclude_etfs
    if requested_source == "nasdaq-trader-us" and include_etfs:
        source_label = f"{source_label} (stocks + ETFs)"

    print("=" * 60)
    print("  Optionable Universe Builder")
    print("=" * 60)
    print(f"  Source:     {source_label}")
    print(f"  Lookback:   {args.lookback}")
    print(f"  Interval:   {args.interval}")
    print(f"  Workers:    {args.workers}")
    print(f"  Opt timeout:{args.option_timeout:.1f}s")
    print(f"  Min volume: {args.min_volume:,} (0 = no filter)")
    print(f"  Include ETFs: {'yes' if include_etfs else 'no'}")
    print(f"  Mode:       {'optionable subset only' if args.options_only else 'full universe build'}")
    print("  Price filter: none")
    print("=" * 60)

    start_time = time.time()

    if args.tickers_csv:
        tickers = load_tickers_from_csv(args.tickers_csv)
    elif args.source == "nasdaq-trader-us":
        tickers = fetch_nasdaq_trader_us_tickers(include_etfs=include_etfs)
    else:
        tickers = fetch_russell2000_tickers()

    source_tickers = list(tickers)
    download_tickers = list(source_tickers)
    optionable_tickers: list[str] = []

    if not tickers:
        print("\nERROR: No tickers loaded. Provide --tickers-csv or check internet connection.")
        sys.exit(1)

    if args.skip_options_check and OPTIONABLE_PATH.exists():
        print(f"\nLoading existing optionable list from {OPTIONABLE_PATH}...")
        with open(OPTIONABLE_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        existing_source = str(data.get("source") or "").strip()
        existing_include_etfs_raw = data.get("include_etfs")
        existing_include_etfs = include_etfs if existing_include_etfs_raw is None else bool(existing_include_etfs_raw)
        if not existing_source:
            print("ERROR: Existing optionable.json has no source metadata.")
            print("Re-run without --skip-options-check to rebuild the optionable list.")
            sys.exit(1)
        if existing_source != requested_source:
            print(
                f"ERROR: Existing optionable.json source is '{existing_source}', "
                f"but this build requested '{requested_source}'."
            )
            print("Re-run without --skip-options-check so the optionable list can be rebuilt.")
            sys.exit(1)
        if (
            requested_source == "nasdaq-trader-us"
            and existing_include_etfs_raw is not None
            and existing_include_etfs != include_etfs
        ):
            print(
                f"ERROR: Existing optionable.json include_etfs={existing_include_etfs}, "
                f"but this build requested include_etfs={include_etfs}."
            )
            print("Re-run without --skip-options-check so the optionable list can be rebuilt.")
            sys.exit(1)
        if requested_source == "nasdaq-trader-us" and existing_include_etfs_raw is None:
            print("  Reusing existing optionable list with legacy metadata (include_etfs not recorded).")
        is_valid_catalog, catalog_error = validate_optionable_catalog(data, source_tickers)
        if not is_valid_catalog:
            print(f"ERROR: {catalog_error}")
            print("Re-run without --skip-options-check so the optionable subset can be rebuilt.")
            sys.exit(1)

        optionable_tickers = sorted(_dedupe([normalize_symbol(symbol) for symbol in data.get("optionable") or []]))
        print(f"  Loaded {len(optionable_tickers)} optionable tickers")
    else:
        optionable_tickers = filter_optionable(
            source_tickers,
            workers=args.workers,
            timeout_seconds=args.option_timeout,
            source=requested_source,
            source_label=source_label,
            include_etfs=include_etfs,
        )

    if not optionable_tickers:
        print("\nWARNING: No optionable tickers found. Building price history for the full source universe anyway.")

    if not download_tickers:
        print("\nERROR: No source tickers remain after initial source fetch.")
        sys.exit(1)

    if args.min_volume > 0:
        download_tickers = filter_by_volume(download_tickers, args.min_volume)
        allowed_symbols = set(download_tickers)
        optionable_tickers = [symbol for symbol in optionable_tickers if symbol in allowed_symbols]

    if not download_tickers:
        print("\nERROR: No source tickers remain after filters.")
        sys.exit(1)

    if args.options_only:
        elapsed = int(time.time() - start_time)
        print("\n" + "=" * 60)
        print(f"  DONE in {elapsed // 60}m {elapsed % 60}s")
        print(f"  Source symbols discovered:    {len(source_tickers)}")
        print(f"  Source symbols after filters: {len(download_tickers)}")
        print(f"  Optionable subset:            {len(optionable_tickers)}")
        print("  Downloaded:                  0")
        print("  Failed/no data:              0")
        print(f"  Data saved to:               {OPTIONABLE_PATH}")
        print("=" * 60)
        print("\nNext step: use the refreshed Optionable bucket or run a full Build Universe if history is missing.")
        return

    results = download_history(
        download_tickers,
        lookback=args.lookback,
        interval=args.interval,
        batch_size=args.batch_size,
    )

    write_manifest(
        download_tickers,
        results,
        args.lookback,
        args.interval,
        requested_source,
        source_label,
        source_symbol_count=len(source_tickers),
        optionable_count=len(optionable_tickers),
    )

    elapsed = int(time.time() - start_time)
    success = sum(1 for result in results.values() if result.get("rows", 0) > 0)
    failed = len(download_tickers) - success

    print("\n" + "=" * 60)
    print(f"  DONE in {elapsed // 60}m {elapsed % 60}s")
    print(f"  Source symbols discovered:    {len(source_tickers)}")
    print(f"  Source symbols after filters: {len(download_tickers)}")
    print(f"  Optionable subset:            {len(optionable_tickers)}")
    print(f"  Downloaded:                  {success}")
    print(f"  Failed/no data:              {failed}")
    print(f"  Data saved to:               {DATA_DIR}")
    print("=" * 60)
    print("\nNext step: run update_universe.py daily or weekly to keep data fresh.")


if __name__ == "__main__":
    main()
