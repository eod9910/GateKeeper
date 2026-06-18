"""OHLCV data structures, fetching, and caching utilities."""

import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

try:
    import yfinance as yf
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

_SCANNER_DEBUG = os.environ.get("SCANNER_DEBUG", "").lower() in ("1", "true", "yes")

__all__ = [
    "OHLCV",
    "fetch_data_yfinance",
    "load_cached_data",
    "save_to_cache",
    "cache_needs_refresh",
    "merge_new_bars",
    "aggregate_bars",
    "load_data_from_csv",
    "get_cache_path",
    "get_refresh_interval_seconds",
]


@dataclass
class OHLCV:
    """Single candlestick data."""
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float

    # Compatibility helpers: some AI-generated plugins treat bars as dict-like.
    # Keep attribute access as canonical, but allow bar['close'] and bar.get(...).
    def __getitem__(self, key: str):
        return getattr(self, key)

    def get(self, key: str, default=None):
        return getattr(self, key, default)


def _detect_intraday(data: list) -> bool:
    """Check if data is intraday by looking for multiple bars with the same date."""
    if not data or len(data) < 2:
        return False
    dates = set()
    for bar in data[:100]:
        d = bar.timestamp[:10] if len(bar.timestamp) >= 10 else bar.timestamp
        if d in dates:
            return True
        dates.add(d)
    return False


def _format_chart_time(ts: str, is_intraday: bool = False):
    """Format timestamp for Lightweight Charts.
    Daily/weekly/monthly: 'YYYY-MM-DD' string (BusinessDay format).
    Intraday: Unix timestamp in seconds (UTCTimestamp format).
    """
    if not ts:
        return None
    if is_intraday:
        try:
            dt = datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S")
            return int(dt.timestamp())
        except Exception:
            return ts[:10] if len(ts) >= 10 else ts
    return ts[:10] if len(ts) >= 10 else ts


def load_data_from_csv(filepath: str) -> List[OHLCV]:
    """Load OHLCV data from a CSV file."""
    if not HAS_PANDAS:
        raise ImportError("pandas is required to load CSV files")
    
    df = pd.read_csv(filepath)
    
    # Try to detect column names
    columns = df.columns.str.lower()
    
    data = []
    for _, row in df.iterrows():
        data.append(OHLCV(
            timestamp=str(row.get('date', row.get('timestamp', ''))),
            open=float(row.get('open', 0)),
            high=float(row.get('high', 0)),
            low=float(row.get('low', 0)),
            close=float(row.get('close', 0)),
            volume=float(row.get('volume', 0))
        ))
    
    return data


_UNIVERSE_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'data', 'universe'))

YAHOO_SYMBOL_ALIASES = {
    # TradingView / broker-style continuous futures -> Yahoo Finance futures.
    # Yahoo does not resolve symbols like ES1 or ES1!, but it does resolve ES=F.
    "ES1": "ES=F",
    "MES1": "MES=F",
    "NQ1": "NQ=F",
    "MNQ1": "MNQ=F",
    "YM1": "YM=F",
    "MYM1": "MYM=F",
    "RTY1": "RTY=F",
    "M2K1": "M2K=F",
    "CL1": "CL=F",
    "MCL1": "MCL=F",
    "NG1": "NG=F",
    "GC1": "GC=F",
    "MGC1": "MGC=F",
    "SI1": "SI=F",
    "HG1": "HG=F",
    "ZB1": "ZB=F",
    "ZN1": "ZN=F",
    "ZF1": "ZF=F",
    "ZT1": "ZT=F",
    "6E1": "6E=F",
    "6B1": "6B=F",
    "6J1": "6J=F",
    "6A1": "6A=F",
    "6C1": "6C=F",
    "BTC1": "BTC=F",
    "ETH1": "ETH=F",
}

FUTURES_MONTH_CODES = "FGHJKMNQUVXZ"


def _normalize_yahoo_symbol(symbol: str) -> str:
    """Map app/chart aliases to the symbol Yahoo Finance actually resolves."""
    raw = str(symbol or "").strip()
    if not raw:
        return raw
    key = raw.upper()
    if key.startswith("$"):
        key = key[1:]
    if key.startswith("/"):
        key = key[1:]
    if key.endswith("!"):
        key = key[:-1]
    contract_match = None
    for year_len in (4, 2):
        if len(key) > year_len + 1 and key[-year_len:].isdigit() and key[-year_len - 1] in FUTURES_MONTH_CODES:
            contract_match = key[: -year_len - 1]
            break
    if contract_match:
        mapped_root = YAHOO_SYMBOL_ALIASES.get(contract_match) or YAHOO_SYMBOL_ALIASES.get(f"{contract_match}1")
        if mapped_root:
            return mapped_root
        return f"{contract_match}=F"
    return YAHOO_SYMBOL_ALIASES.get(key, raw)


def _get_universe_csv_path(symbol: str) -> Optional[str]:
    """Return path to pre-downloaded universe CSV for this symbol, or None if not found."""
    safe = symbol.replace('/', '_').replace('=', '_').replace('-', '_')
    path = os.path.join(_UNIVERSE_DIR, f"{safe}_1d.csv")
    return path if os.path.exists(path) else None


def get_cache_path(symbol: str, interval: str) -> str:
    """Get the path to cached chart data file."""
    # Normalize symbol for filename (replace special chars)
    safe_symbol = symbol.replace('/', '_').replace('=', '_').replace('-', '_')
    interval_label = {'1wk': 'W', '1d': 'D', '1mo': 'M'}.get(interval, interval)
    
    cache_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'charts')
    os.makedirs(cache_dir, exist_ok=True)
    
    return os.path.join(cache_dir, f"{safe_symbol}_{interval_label}.json")


def get_refresh_interval_seconds(interval: str) -> int:
    """How often to check Yahoo for NEW bars to append.
    
    This does NOT expire or delete the cache — cached data is permanent.
    It only controls how frequently we ask Yahoo "got anything new since
    my last bar?" to avoid hammering the API on rapid re-scans.
    """
    refresh_map = {
        '1m': 60,          # 1 minute
        '5m': 120,         # 2 minutes
        '15m': 300,        # 5 minutes
        '1h': 1800,        # 30 minutes
        '4h': 3600,        # 1 hour
        '1d': 86400,       # 24 hours (nightly cron handles refresh; no reason to hit Yahoo every 4h)
        '1wk': 86400,      # 24 hours (weekly bars only change Friday close)
        '1mo': 604800,     # 7 days   (monthly bars only change month-end)
    }
    return refresh_map.get(interval, 14400)  # default 4 hours


_IN_MEMORY_CACHE = {}

# Yahoo Finance hard retention limits per intraday interval. Asking for a
# longer window than Yahoo will serve causes the entire request to fail with
# "data not available... must be within the last N days", which silently
# poisoned the trading desk cache for 5m/15m/30m before we mapped these.
INTRADAY_FETCH_PERIOD = {
    '1m': '7d',
    '2m': '60d',
    '5m': '60d',
    '15m': '60d',
    '30m': '60d',
    '60m': '730d',
    '90m': '60d',
    '1h': '730d',
    '4h': '730d',
}

# Full 1h/4h backfills can use Yahoo's ~2-year hourly window, but routine
# refreshes should only ask for recent bars so chart loads stay light.
INTRADAY_INCREMENTAL_PERIOD = {
    **INTRADAY_FETCH_PERIOD,
    '60m': '60d',
    '1h': '60d',
    '4h': '60d',
}
INTRADAY_INTERVALS = set(INTRADAY_FETCH_PERIOD.keys())


def _yahoo_safe_intraday_period(interval: str, requested: str) -> str:
    """Return a Yahoo-acceptable period for an intraday interval, never longer
    than what Yahoo will actually serve for that resolution."""
    cap = INTRADAY_FETCH_PERIOD.get(interval)
    if not cap:
        return requested or '60d'
    cap_days = _parse_period_days(cap) or 60
    requested_days = _parse_period_days(requested or '')
    if requested_days is None:
        return cap
    if requested_days > cap_days:
        return cap
    return requested or cap


def _touch_cache_file(symbol: str, interval: str) -> None:
    """Bump the cache file mtime to "now" without rewriting its contents.

    Used when an incremental refresh fails (e.g. Yahoo rejects the window or
    the symbol is briefly unreachable) so cache_needs_refresh() doesn't fire
    on every subsequent chart load and replay the same broken request. The
    user still sees stale data, but the next genuine refresh window will pick
    up new bars instead of the page hammering Yahoo on every keystroke.
    """
    path = get_cache_path(symbol, interval)
    if not os.path.exists(path):
        return
    try:
        import time as _time
        os.utime(path, (_time.time(), _time.time()))
    except Exception:
        pass


def _parse_period_days(period: str) -> Optional[int]:
    """Convert yfinance period strings like '10y'/'730d' to days."""
    if not period:
        return None
    p = str(period).strip().lower()
    if p == "max":
        return None
    if p.endswith("d"):
        try:
            return int(p[:-1])
        except Exception:
            return None
    if p.endswith("y"):
        try:
            return int(p[:-1]) * 365
        except Exception:
            return None
    if p.endswith("mo"):
        try:
            return int(p[:-2]) * 30
        except Exception:
            return None
    return None


def _normalize_intraday_period(period: str, max_days: int = 720) -> str:
    """Clamp intraday requests to a Yahoo-safe lookback window.

    NOTE: the `max_days=720` default is only correct for `1h` (Yahoo serves up
    to 730d of 1h data). Sub-hour intraday intervals are capped much tighter
    (60d for 5m/15m/30m, 7d for 1m). Callers must pass the per-interval cap
    or use _yahoo_safe_intraday_period() directly. We keep the parameter so
    existing callers that already know the interval-specific cap still work.
    """
    p = str(period or "").strip().lower() or "60d"
    if p == "max":
        return f"{max_days}d"

    days = _parse_period_days(p)
    if days is None:
        return p
    if days > max_days:
        return f"{max_days}d"
    return p


def _safe_parse_ts(ts: str) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except Exception:
        pass
    try:
        return datetime.strptime(str(ts)[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
    except Exception:
        pass
    try:
        return datetime.strptime(str(ts)[:10], "%Y-%m-%d")
    except Exception:
        return None


def _sort_and_dedupe_bars(data: List[OHLCV]) -> List[OHLCV]:
    """Return bars in chronological order with the last instance per timestamp kept."""
    if not data:
        return []

    latest_by_ts = {}
    for bar in data:
        if not getattr(bar, "timestamp", ""):
            continue
        latest_by_ts[bar.timestamp] = bar

    def _bar_sort_key(bar: OHLCV):
        parsed = _safe_parse_ts(bar.timestamp)
        return (parsed or datetime.min, bar.timestamp)

    return sorted(latest_by_ts.values(), key=_bar_sort_key)


def _looks_like_legacy_4h_cache(data: List[OHLCV]) -> bool:
    """Detect old 4h cache files created by naive global 1h chunking."""
    if not data:
        return False

    intraday_starts = set()
    for bar in data[-30:]:
        parsed = _safe_parse_ts(bar.timestamp)
        if not parsed:
            continue
        intraday_starts.add((parsed.hour, parsed.minute))

    # Proper US equity 4h aggregation should usually start at 09:30 and 13:30,
    # with an occasional single partial bar on shortened sessions.
    return len(intraday_starts) > 3


def _get_cache_source_period(symbol: str, interval: str) -> Optional[str]:
    """Read source_period metadata from the cache file (if present)."""
    cache_path = get_cache_path(symbol, interval)
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "r") as f:
            cached = json.load(f)
        src = cached.get("source_period")
        return str(src).strip().lower() if src is not None else None
    except Exception:
        return None

def load_cached_data(symbol: str, interval: str) -> Optional[List[OHLCV]]:
    """Load chart data from the persistent cache.
    
    Cache files are NEVER expired or deleted — they are the permanent
    data store. Returns None only if no cache file exists yet.
    """
    cache_key = f"{symbol}_{interval}"
    if cache_key in _IN_MEMORY_CACHE:
        return _IN_MEMORY_CACHE[cache_key]

    cache_path = get_cache_path(symbol, interval)
    
    if not os.path.exists(cache_path):
        return None
    
    try:
        with open(cache_path, 'r') as f:
            cached = json.load(f)
        
        data = []
        for bar in cached.get('data', []):
            data.append(OHLCV(
                timestamp=bar['timestamp'],
                open=bar['open'],
                high=bar['high'],
                low=bar['low'],
                close=bar['close'],
                volume=bar.get('volume', 0)
            ))
        
        data = _sort_and_dedupe_bars(data)
        if len(data) > 0:
            print(f"Loaded {len(data)} bars from cache for {symbol} ({interval})", file=sys.stderr)
            _IN_MEMORY_CACHE[cache_key] = data
            return data
    except Exception as e:
        print(f"Error loading cache for {symbol}: {e}", file=sys.stderr)
    
    return None


def cache_needs_refresh(symbol: str, interval: str) -> bool:
    """Check if we should fetch new bars from Yahoo.
    
    Returns True if the cache file was last updated longer ago than
    the refresh interval for this data frequency. The cache is never
    deleted — this just controls when to append new bars.
    """
    import time
    cache_path = get_cache_path(symbol, interval)
    
    if not os.path.exists(cache_path):
        return True  # No cache at all — need full download
    
    file_age = time.time() - os.path.getmtime(cache_path)
    refresh_interval = get_refresh_interval_seconds(interval)
    
    if file_age > refresh_interval:
        print(f"Cache refresh needed for {symbol} ({interval}): {file_age:.0f}s since last update, refresh every {refresh_interval}s", file=sys.stderr)
        return True
    
    return False


def save_to_cache(symbol: str, interval: str, data: List[OHLCV], source_period: Optional[str] = None):
    """Save chart data to the persistent cache."""
    cache_path = get_cache_path(symbol, interval)
    normalized = _sort_and_dedupe_bars(data)
    
    try:
        cached = {
            'symbol': symbol,
            'interval': interval,
            'updated': datetime.now().isoformat(),
            'source_period': source_period,
            'bars': len(normalized),
            'data': [
                {
                    'timestamp': bar.timestamp,
                    'open': bar.open,
                    'high': bar.high,
                    'low': bar.low,
                    'close': bar.close,
                    'volume': bar.volume
                }
                for bar in normalized
            ]
        }
        
        with open(cache_path, 'w') as f:
            json.dump(cached, f)
        
        cache_key = f"{symbol}_{interval}"
        _IN_MEMORY_CACHE[cache_key] = normalized
        
        print(f"Saved {len(normalized)} bars to cache for {symbol}", file=sys.stderr)
    except Exception as e:
        print(f"Error saving cache for {symbol}: {e}", file=sys.stderr)


def merge_new_bars(existing: List[OHLCV], new_bars: List[OHLCV]) -> List[OHLCV]:
    """Merge new bars into existing cached data.
    
    - Uses timestamp as the key
    - Replaces the LAST existing bar (it may have been incomplete/partial)
    - Appends any bars that come after the last existing timestamp
    - Preserves all older bars untouched
    """
    if not existing:
        return new_bars
    if not new_bars:
        return existing
    
    last_existing_bar = existing[-1]
    last_existing_dt = _safe_parse_ts(last_existing_bar.timestamp)
    
    # Keep all existing bars except the last one (it might be incomplete)
    merged = existing[:-1]
    
    # Intraday merges must compare full timestamps, not just the date, otherwise
    # same-day bars can be re-appended out of order.
    new_portion = []
    for bar in new_bars:
        bar_dt = _safe_parse_ts(bar.timestamp)
        if last_existing_dt and bar_dt:
            if bar_dt >= last_existing_dt:
                new_portion.append(bar)
        elif bar.timestamp[:10] >= last_existing_bar.timestamp[:10]:
            new_portion.append(bar)
    
    if new_portion:
        merged.extend(new_portion)
        added_count = len(new_portion) - 1  # -1 because we're replacing the last bar
        if added_count > 0:
            print(f"  Appended {added_count} new bars", file=sys.stderr)
        else:
            print(f"  Updated latest bar (no new bars)", file=sys.stderr)
    else:
        # No overlap found — just re-add the last bar
        merged.append(existing[-1])
    
    return _sort_and_dedupe_bars(merged)


def aggregate_bars(data: List[OHLCV], factor: int) -> List[OHLCV]:
    """Aggregate N bars into one (e.g., 4x 1H bars -> 1x 4H bar).
    Takes first open, max high, min low, last close, sum volume."""
    if factor <= 1:
        return data
    ordered = _sort_and_dedupe_bars(data)
    aggregated = []
    chunk = []
    current_day = None

    for bar in ordered:
        day_key = bar.timestamp[:10]
        if chunk and (day_key != current_day or len(chunk) >= factor):
            aggregated.append(OHLCV(
                timestamp=chunk[0].timestamp,
                open=chunk[0].open,
                high=max(item.high for item in chunk),
                low=min(item.low for item in chunk),
                close=chunk[-1].close,
                volume=sum(item.volume for item in chunk)
            ))
            chunk = []

        if not chunk:
            current_day = day_key
        chunk.append(bar)

    if chunk:
        aggregated.append(OHLCV(
            timestamp=chunk[0].timestamp,
            open=chunk[0].open,
            high=max(item.high for item in chunk),
            low=min(item.low for item in chunk),
            close=chunk[-1].close,
            volume=sum(item.volume for item in chunk)
        ))

    return _sort_and_dedupe_bars(aggregated)


def _download_from_yahoo(symbol: str, period: str, interval: str) -> List[OHLCV]:
    """Raw download from Yahoo Finance. Returns list of OHLCV bars."""
    ticker = yf.Ticker(symbol)

    def _fallback_periods(fetch_period: str) -> List[str]:
        candidates = []
        if interval in INTRADAY_INTERVALS:
            candidates.append(INTRADAY_FETCH_PERIOD[interval])
        elif interval == "1d":
            # Some valid Yahoo symbols (ASH, intermittently others) throw from
            # yfinance on period=max even though bounded daily windows work.
            candidates.extend(["10y", "5y", "2y", "1y", "6mo", "60d"])
        elif interval in ("1wk", "1mo", "3mo"):
            candidates.extend(["10y", "5y", "2y", "1y"])
        else:
            candidates.append("5y")

        seen = {str(fetch_period or "").strip().lower()}
        out = []
        for candidate in candidates:
            key = str(candidate or "").strip().lower()
            if key and key not in seen:
                out.append(candidate)
                seen.add(key)
        return out

    def _normalize_yahoo_frame(df):
        if df is None:
            return None
        if hasattr(df, "columns") and isinstance(df.columns, pd.MultiIndex):
            # yf.download() can return either (Price, Ticker) or (Ticker, Price)
            # columns. For a single requested symbol, collapse to the OHLCV axis.
            for level in range(df.columns.nlevels):
                values = {str(value).lower() for value in df.columns.get_level_values(level)}
                if {"open", "high", "low", "close"}.issubset(values):
                    df = df.copy()
                    df.columns = df.columns.get_level_values(level)
                    break
            else:
                try:
                    df = df.xs(symbol, axis=1, level=-1)
                except Exception:
                    pass
        return df

    def _history(fetch_period: str):
        try:
            return _normalize_yahoo_frame(ticker.history(period=fetch_period, interval=interval))
        except Exception as exc:
            print(
                f"Warning: Yahoo history failed for {symbol} ({fetch_period}, {interval}): {exc}",
                file=sys.stderr,
            )
            return None

    def _download(fetch_period: str):
        try:
            return _normalize_yahoo_frame(yf.download(
                symbol,
                period=fetch_period,
                interval=interval,
                progress=False,
                auto_adjust=False,
                threads=False,
            ))
        except Exception as exc:
            print(
                f"Warning: Yahoo download failed for {symbol} ({fetch_period}, {interval}): {exc}",
                file=sys.stderr,
            )
            return None

    df = _history(period)
    attempted_period = period

    if df is None or df.empty:
        # Fall back to windows Yahoo will actually serve for this interval.
        # Intraday remains capped. Daily/weekly/monthly use a ladder because
        # yfinance can fail on "max" for valid symbols while bounded windows
        # still return clean data.
        for fallback_period in _fallback_periods(period):
            print(
                f"Warning: No data returned for {symbol}. Trying interval-safe period ({fallback_period})...",
                file=sys.stderr,
            )
            attempted_period = fallback_period
            df = _history(fallback_period)
            if df is not None and not df.empty:
                break

    if df is None or df.empty:
        print(
            f"Warning: Yahoo history returned no data for {symbol}. Trying yf.download ({attempted_period}, {interval})...",
            file=sys.stderr,
        )
        df = _download(attempted_period)

    if df is None or df.empty:
        for fallback_period in _fallback_periods(attempted_period):
            print(
                f"Warning: Yahoo download returned no data for {symbol}. Trying yf.download ({fallback_period}, {interval})...",
                file=sys.stderr,
            )
            attempted_period = fallback_period
            df = _download(fallback_period)
            if df is not None and not df.empty:
                break
        
    if df is None or df.empty:
        raise ValueError(f"No data available for symbol: {symbol}")
    
    data = []
    for timestamp, row in df.iterrows():
        if pd.isna(row['Open']) or pd.isna(row['High']) or pd.isna(row['Low']) or pd.isna(row['Close']):
            continue
        data.append(OHLCV(
            timestamp=str(timestamp),
            open=float(row['Open']),
            high=float(row['High']),
            low=float(row['Low']),
            close=float(row['Close']),
            volume=float(row['Volume']) if not pd.isna(row['Volume']) else 0
        ))
    
    if len(data) == 0:
        raise ValueError(f"No valid OHLCV data for symbol: {symbol}")
    
    return data


def fetch_data_yfinance(symbol: str, period: str = "10y", interval: str = "1wk", force_refresh: bool = False) -> List[OHLCV]:
    """Fetch OHLCV data with persistent cache and incremental updates.
    
    Strategy:
    1. Always load from cache first (cache is permanent, never expires)
    2. If cache exists and is fresh enough, return it immediately
    3. If cache exists but needs refresh, fetch only recent bars from
       Yahoo and merge them onto the cached data
    4. If no cache exists, do a full download and save
    
    The cache files in backend/data/charts/ are the permanent data store.
    They approximate a database and can be migrated to a real DB later.
    
    Note: Yahoo Finance does not support 4h natively. We download 1h data
    and aggregate into 4h bars using aggregate_bars().
    """
    if not HAS_YFINANCE:
        raise ImportError("yfinance is required to fetch market data. Install with: pip install yfinance")

    requested_symbol = str(symbol or "").strip()
    symbol = _normalize_yahoo_symbol(requested_symbol)
    if requested_symbol and symbol != requested_symbol:
        print(f"Yahoo symbol alias: {requested_symbol} -> {symbol}", file=sys.stderr)
    
    # Handle 4h by downloading 1h and aggregating
    needs_aggregation = (interval == '4h')
    yahoo_interval = '1h' if needs_aggregation else interval
    
    # Yahoo intraday history has hard retention limits per resolution; clamp
    # the requested period BEFORE the freshness check so we never ask Yahoo
    # for a window it cannot serve (which is what poisoned 5m/15m caches).
    if yahoo_interval in INTRADAY_INTERVALS:
        period = _yahoo_safe_intraday_period(yahoo_interval, period)
    
    requested_period = period

    if needs_aggregation:
        # Keep 4h derived from the freshest available 1h source bars instead of
        # trusting the 4h file mtime. Otherwise a rebuilt 4h cache can look
        # "fresh" even when it was aggregated from stale 1h data.
        source_1h = fetch_data_yfinance(symbol, period=period, interval='1h', force_refresh=force_refresh)
        aggregated = aggregate_bars(source_1h, 4)
        save_to_cache(symbol, interval, aggregated, source_period=requested_period)
        return aggregated

    # 0. Check universe CSV folder first — pre-downloaded daily bars for ~10K tickers.
    #    If found, seed the cache from it so Yahoo is never needed for this symbol.
    if not force_refresh and yahoo_interval == '1d':
        universe_csv = _get_universe_csv_path(symbol)
        if universe_csv and not load_cached_data(symbol, interval):
            try:
                csv_bars = load_data_from_csv(universe_csv)
                if csv_bars:
                    print(f"Seeding cache for {symbol} from universe CSV ({len(csv_bars)} bars)", file=sys.stderr)
                    save_to_cache(symbol, interval, csv_bars, source_period='10y')
            except Exception as e:
                print(f"Universe CSV seed failed for {symbol}: {e}", file=sys.stderr)

    # 1. Load existing cache (permanent — never deleted)
    cached_data = load_cached_data(symbol, interval)

    def _needs_historical_backfill() -> bool:
        if not cached_data:
            return False
        # Intraday requests were already clamped to Yahoo's hard limit, so this
        # can deepen stale 1h/4h caches from an old 60d source to the 730d cap.

        req_p = str(requested_period).strip().lower()
        src_p = _get_cache_source_period(symbol, interval)

        # For max requests, if we don't know cache provenance (or it's not max),
        # perform one full backfill to ensure history is complete.
        if req_p == 'max':
            return src_p != 'max'

        req_days = _parse_period_days(req_p)
        if req_days is None:
            return False

        # If source period metadata exists and already covers request, skip.
        if src_p:
            if src_p == 'max':
                return False
            src_days = _parse_period_days(src_p)
            if src_days is not None and src_days >= req_days:
                return False

        # Fallback: compare requested span vs cached earliest bar age.
        first_dt = _safe_parse_ts(cached_data[0].timestamp if cached_data else "")
        if not first_dt:
            return True
        now_dt = datetime.now(first_dt.tzinfo) if first_dt.tzinfo else datetime.now()
        cached_days = max(0, int((now_dt - first_dt).days))
        return (cached_days + 7) < req_days

    # If caller asks for longer history than cache currently has, do a full
    # backfill first (before freshness checks that would otherwise return early).
    if cached_data and not force_refresh and _needs_historical_backfill():
        print(f"Historical backfill for {symbol} ({interval}) with period={period}...", file=sys.stderr)
        try:
            data = _download_from_yahoo(symbol, period, yahoo_interval)
            if needs_aggregation:
                data = aggregate_bars(data, 4)
            save_to_cache(symbol, interval, data, source_period=requested_period)
            return data
        except Exception as e:
            print(f"Historical backfill failed for {symbol}, continuing with existing cache: {e}", file=sys.stderr)
    
    # 2. If cache exists and is fresh, return immediately
    if cached_data and not force_refresh and not cache_needs_refresh(symbol, interval):
        return cached_data
    
    # 3. If cache exists but needs refresh, do incremental update
    if cached_data and not force_refresh:
        print(f"Incremental update for {symbol} ({interval})...", file=sys.stderr)
        try:
            # Per-interval cap: must respect Yahoo's hard retention limits
            # (5m/15m/30m = 60d, 1m = 7d). Asking for '1y' on these used to
            # fail every time and leave the cache stuck. Daily/weekly/monthly
            # behavior is unchanged from before this fix.
            if yahoo_interval in INTRADAY_INTERVALS:
                incremental_period = INTRADAY_INCREMENTAL_PERIOD.get(yahoo_interval, INTRADAY_FETCH_PERIOD[yahoo_interval])
            elif interval == '1d':
                incremental_period = '60d'
            else:
                incremental_period = '1y'
            new_bars = _download_from_yahoo(symbol, incremental_period, yahoo_interval)
            if needs_aggregation:
                new_bars = aggregate_bars(new_bars, 4)
            
            merged = merge_new_bars(cached_data, new_bars)
            save_to_cache(symbol, interval, merged, source_period=_get_cache_source_period(symbol, interval))
            return merged
        except Exception as e:
            print(f"Incremental update failed for {symbol}, using cached data: {e}", file=sys.stderr)
            # Bump the cache file mtime so cache_needs_refresh() doesn't fire
            # again immediately on the next chart load and replay the same
            # broken request. The underlying data stays stale; the next real
            # refresh window will retry. This breaks the silent retry storm.
            _touch_cache_file(symbol, interval)
            return cached_data
    
    # 4. No cache at all — full download
    print(f"Full download for {symbol} from Yahoo Finance ({period}, {yahoo_interval}{' -> 4h agg' if needs_aggregation else ''})...", file=sys.stderr)
    
    try:
        data = _download_from_yahoo(symbol, period, yahoo_interval)
        if needs_aggregation:
            data = aggregate_bars(data, 4)
        save_to_cache(symbol, interval, data, source_period=requested_period)
        return data
    except Exception as e:
        if cached_data:
            print(f"Download failed for {symbol}, using stale cache: {e}", file=sys.stderr)
            _touch_cache_file(symbol, interval)
            return cached_data
        print(f"Error fetching {symbol}: {e}", file=sys.stderr)
        raise
