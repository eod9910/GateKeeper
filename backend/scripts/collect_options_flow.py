"""Collect daily options flow snapshots for the tracked universe.

Pulls options chain data via yfinance for each symbol, computes aggregate
metrics (put/call ratios, IV skew, unusual volume), and stores daily
snapshots in options-flow.sqlite.

Usage:
    py scripts/collect_options_flow.py
    py scripts/collect_options_flow.py --symbols CHTR,AAPL,TSLA
    py scripts/collect_options_flow.py --top 50
    py scripts/collect_options_flow.py --seed-optionability-only
    py scripts/collect_options_flow.py --refresh-optionability-only
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
DB_PATH = DATA_DIR / "options-flow.sqlite"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
OPTIONABLE_CATALOG_PATH = DATA_DIR / "universe" / "optionable.json"


def _print(msg: str) -> None:
    print(msg, flush=True)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS options_daily_snapshot (
    symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    stock_price REAL,
    -- Volume metrics
    total_call_volume INTEGER,
    total_put_volume INTEGER,
    put_call_volume_ratio REAL,
    -- Open interest metrics
    total_call_oi INTEGER,
    total_put_oi INTEGER,
    put_call_oi_ratio REAL,
    -- IV metrics
    atm_call_iv REAL,
    atm_put_iv REAL,
    otm_put_avg_iv REAL,
    otm_call_avg_iv REAL,
    iv_skew REAL,
    -- Near-term (front month) metrics
    near_call_volume INTEGER,
    near_put_volume INTEGER,
    near_put_call_ratio REAL,
    -- Anomaly scores (computed)
    volume_vs_20d_avg REAL,
    put_call_vs_20d_avg REAL,
    iv_skew_vs_20d_avg REAL,
    anomaly_score REAL,
    anomaly_flags TEXT,
    -- Metadata
    expirations_scanned INTEGER,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, trade_date)
);

CREATE TABLE IF NOT EXISTS options_flow_alerts (
    alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    headline TEXT NOT NULL,
    detail TEXT,
    metrics_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_options_alerts_symbol_date
    ON options_flow_alerts(symbol, trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_options_alerts_type
    ON options_flow_alerts(alert_type, trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_options_daily_date
    ON options_daily_snapshot(trade_date DESC);

CREATE TABLE IF NOT EXISTS options_contract_snapshot (
    symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    expiration TEXT NOT NULL,
    option_type TEXT NOT NULL CHECK (option_type IN ('call', 'put')),
    strike REAL NOT NULL,
    contract_symbol TEXT,
    last_price REAL,
    bid REAL,
    ask REAL,
    change_value REAL,
    percent_change REAL,
    volume INTEGER,
    open_interest INTEGER,
    implied_volatility REAL,
    in_the_money INTEGER,
    contract_size TEXT,
    currency TEXT,
    last_trade_date TEXT,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, trade_date, expiration, option_type, strike)
);

CREATE INDEX IF NOT EXISTS idx_options_contract_symbol_date
    ON options_contract_snapshot(symbol, trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_options_contract_date
    ON options_contract_snapshot(trade_date DESC, symbol);

CREATE INDEX IF NOT EXISTS idx_options_contract_expiration
    ON options_contract_snapshot(expiration, symbol);

CREATE TABLE IF NOT EXISTS options_symbol_optionability (
    symbol TEXT PRIMARY KEY,
    in_clean_universe INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('optionable', 'not_optionable', 'unknown', 'error')),
    source TEXT NOT NULL,
    expiration_count INTEGER,
    nearest_expiration TEXT,
    last_error TEXT,
    checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_options_optionability_status
    ON options_symbol_optionability(status, symbol);

CREATE INDEX IF NOT EXISTS idx_options_optionability_checked
    ON options_symbol_optionability(checked_at);
"""


def ensure_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.executescript(SCHEMA_SQL)
    return conn


def normalize_symbol(symbol: Any) -> str:
    return str(symbol or "").strip().upper()


def load_clean_universe_symbols() -> List[str]:
    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8-sig"))
    stocks = data.get("stocks", [])
    symbols = []
    for s in stocks:
        sym = normalize_symbol(s.get("symbol"))
        if sym:
            symbols.append(sym)
    return sorted(set(symbols))


def load_optionable_catalog_sets() -> tuple[Set[str], Set[str]]:
    if not OPTIONABLE_CATALOG_PATH.exists():
        return set(), set()
    data = json.loads(OPTIONABLE_CATALOG_PATH.read_text(encoding="utf-8-sig"))
    optionable = {normalize_symbol(s) for s in (data.get("optionable") or []) if normalize_symbol(s)}
    not_optionable = {normalize_symbol(s) for s in (data.get("not_optionable") or []) if normalize_symbol(s)}
    return optionable, not_optionable


def seed_optionability_from_clean_universe(conn: sqlite3.Connection) -> Dict[str, int]:
    """Seed optionability rows from clean universe plus the legacy optionable catalog.

    The clean universe remains the master. optionable.json is only a seed source
    and may include ETFs or symbols outside the clean-stock universe.
    """
    clean_symbols = load_clean_universe_symbols()
    optionable, not_optionable = load_optionable_catalog_sets()
    now = _utc_now()
    counts = {"optionable": 0, "not_optionable": 0, "unknown": 0}
    conn.execute(
        "UPDATE options_symbol_optionability SET in_clean_universe = 0, updated_at = ?",
        (now,),
    )

    for symbol in clean_symbols:
        if symbol in optionable:
            status = "optionable"
            source = "clean_universe_intersect_optionable_json"
        elif symbol in not_optionable:
            status = "not_optionable"
            source = "clean_universe_intersect_optionable_json"
        else:
            status = "unknown"
            source = "clean_universe"
        counts[status] += 1
        conn.execute(
            """INSERT INTO options_symbol_optionability
               (symbol, in_clean_universe, status, source, expiration_count,
                nearest_expiration, last_error, checked_at, created_at, updated_at)
               VALUES (?, 1, ?, ?, NULL, NULL, NULL, ?, ?, ?)
               ON CONFLICT(symbol) DO UPDATE SET
                 in_clean_universe = 1,
                 status = CASE
                   WHEN options_symbol_optionability.source LIKE 'yfinance%'
                    AND options_symbol_optionability.status IN ('optionable', 'not_optionable')
                   THEN options_symbol_optionability.status
                   ELSE excluded.status
                 END,
                 source = CASE
                   WHEN options_symbol_optionability.source LIKE 'yfinance%'
                    AND options_symbol_optionability.status IN ('optionable', 'not_optionable')
                   THEN options_symbol_optionability.source
                   ELSE excluded.source
                 END,
                 updated_at = excluded.updated_at""",
            (symbol, status, source, now, now, now),
        )
    conn.commit()
    return counts


def load_optionable_clean_universe(conn: sqlite3.Connection, limit: Optional[int] = None) -> List[str]:
    seed_optionability_from_clean_universe(conn)
    sql = """SELECT symbol
               FROM options_symbol_optionability
              WHERE in_clean_universe = 1
                AND status = 'optionable'
              ORDER BY symbol"""
    params: tuple[Any, ...] = ()
    if limit:
        sql += " LIMIT ?"
        params = (limit,)
    return [str(r["symbol"]) for r in conn.execute(sql, params).fetchall()]


def load_universe(conn: sqlite3.Connection, limit: Optional[int] = None, source: str = "optionable-clean") -> List[str]:
    if source == "clean-all":
        symbols = load_clean_universe_symbols()
        return symbols[:limit] if limit else symbols
    if source == "optionable-clean":
        return load_optionable_clean_universe(conn, limit)
    raise ValueError(f"Unknown universe source: {source}")


def check_optionability(symbol: str) -> Dict[str, Any]:
    """Check whether a clean-universe symbol currently has listed options."""
    try:
        import yfinance as yf
    except ImportError:
        return {
            "symbol": symbol,
            "status": "error",
            "expiration_count": None,
            "nearest_expiration": None,
            "last_error": "yfinance not installed",
        }

    try:
        expirations = list(yf.Ticker(symbol).options or [])
        if expirations:
            return {
                "symbol": symbol,
                "status": "optionable",
                "expiration_count": len(expirations),
                "nearest_expiration": str(expirations[0]),
                "last_error": None,
            }
        return {
            "symbol": symbol,
            "status": "not_optionable",
            "expiration_count": 0,
            "nearest_expiration": None,
            "last_error": None,
        }
    except Exception as exc:
        return {
            "symbol": symbol,
            "status": "error",
            "expiration_count": None,
            "nearest_expiration": None,
            "last_error": str(exc)[:500],
        }


def refresh_optionability(
    conn: sqlite3.Connection,
    *,
    limit: Optional[int] = None,
    status_filter: str = "all",
    sleep_ms: int = 250,
) -> Dict[str, int]:
    seed_optionability_from_clean_universe(conn)

    where = "WHERE in_clean_universe = 1"
    params: list[Any] = []
    if status_filter != "all":
        where += " AND status = ?"
        params.append(status_filter)

    sql = f"""SELECT symbol
                FROM options_symbol_optionability
                {where}
               ORDER BY
                 CASE status WHEN 'unknown' THEN 0 WHEN 'error' THEN 1 ELSE 2 END,
                 checked_at IS NOT NULL,
                 checked_at,
                 symbol"""
    if limit:
        sql += " LIMIT ?"
        params.append(limit)

    symbols = [str(r["symbol"]) for r in conn.execute(sql, params).fetchall()]
    counts = {"optionable": 0, "not_optionable": 0, "unknown": 0, "error": 0, "checked": 0}
    _print(f"Refreshing optionability for {len(symbols)} clean-universe symbols")

    for i, symbol in enumerate(symbols, 1):
        result = check_optionability(symbol)
        now = _utc_now()
        status = str(result["status"])
        counts[status] = counts.get(status, 0) + 1
        counts["checked"] += 1
        conn.execute(
            """INSERT INTO options_symbol_optionability
               (symbol, in_clean_universe, status, source, expiration_count,
                nearest_expiration, last_error, checked_at, created_at, updated_at)
               VALUES (?, 1, ?, 'yfinance_options_endpoint', ?, ?, ?, ?, ?, ?)
               ON CONFLICT(symbol) DO UPDATE SET
                 in_clean_universe = 1,
                 status = excluded.status,
                 source = excluded.source,
                 expiration_count = excluded.expiration_count,
                 nearest_expiration = excluded.nearest_expiration,
                 last_error = excluded.last_error,
                 checked_at = excluded.checked_at,
                 updated_at = excluded.updated_at""",
            (
                symbol,
                status,
                result.get("expiration_count"),
                result.get("nearest_expiration"),
                result.get("last_error"),
                now,
                now,
                now,
            ),
        )
        if i % 25 == 0 or status in {"error", "optionable"}:
            _print(
                f"  [{i}/{len(symbols)}] {symbol:6s} {status}"
                + (f" ({result.get('expiration_count')} expirations)" if result.get("expiration_count") else "")
            )
        conn.commit()
        if sleep_ms > 0 and i < len(symbols):
            time.sleep(sleep_ms / 1000.0)

    return counts


def mark_symbol_optionable_from_snapshot(
    conn: sqlite3.Connection,
    symbol: str,
    snapshot: Dict[str, Any],
) -> None:
    now = _utc_now()
    conn.execute(
        """INSERT INTO options_symbol_optionability
           (symbol, in_clean_universe, status, source, expiration_count,
            nearest_expiration, last_error, checked_at, created_at, updated_at)
           VALUES (?, 1, 'optionable', 'daily_options_flow_collector', ?, NULL, NULL, ?, ?, ?)
           ON CONFLICT(symbol) DO UPDATE SET
             in_clean_universe = 1,
             status = 'optionable',
             source = excluded.source,
             expiration_count = COALESCE(excluded.expiration_count, options_symbol_optionability.expiration_count),
             last_error = NULL,
             checked_at = excluded.checked_at,
             updated_at = excluded.updated_at""",
        (symbol, snapshot.get("expirations_scanned"), now, now, now),
    )


def finite_or_none(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return None
        return number
    except Exception:
        return None


def int_or_zero(value: Any) -> int:
    number = finite_or_none(value)
    return int(number) if number is not None else 0


def contract_rows_from_chain(
    symbol: str,
    expiration: str,
    option_type: str,
    frame: Any,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if frame is None:
        return rows
    for _, row in frame.iterrows():
        strike = finite_or_none(row.get("strike"))
        if strike is None:
            continue
        last_trade = row.get("lastTradeDate")
        rows.append({
            "symbol": symbol,
            "expiration": str(expiration),
            "option_type": option_type,
            "strike": strike,
            "contract_symbol": str(row.get("contractSymbol") or "") or None,
            "last_price": finite_or_none(row.get("lastPrice")),
            "bid": finite_or_none(row.get("bid")),
            "ask": finite_or_none(row.get("ask")),
            "change_value": finite_or_none(row.get("change")),
            "percent_change": finite_or_none(row.get("percentChange")),
            "volume": int_or_zero(row.get("volume")),
            "open_interest": int_or_zero(row.get("openInterest")),
            "implied_volatility": finite_or_none(row.get("impliedVolatility")),
            "in_the_money": 1 if bool(row.get("inTheMoney")) else 0,
            "contract_size": str(row.get("contractSize") or "") or None,
            "currency": str(row.get("currency") or "") or None,
            "last_trade_date": str(last_trade) if last_trade is not None else None,
        })
    return rows


def store_contract_snapshots(
    conn: sqlite3.Connection,
    symbol: str,
    trade_date: str,
    contracts: List[Dict[str, Any]],
) -> int:
    if not contracts:
        return 0
    fetched_at = _utc_now()
    conn.execute(
        "DELETE FROM options_contract_snapshot WHERE symbol = ? AND trade_date = ?",
        (symbol, trade_date),
    )
    conn.executemany(
        """INSERT OR REPLACE INTO options_contract_snapshot
           (symbol, trade_date, expiration, option_type, strike, contract_symbol,
            last_price, bid, ask, change_value, percent_change, volume,
            open_interest, implied_volatility, in_the_money, contract_size,
            currency, last_trade_date, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        [
            (
                contract["symbol"],
                trade_date,
                contract["expiration"],
                contract["option_type"],
                contract["strike"],
                contract.get("contract_symbol"),
                contract.get("last_price"),
                contract.get("bid"),
                contract.get("ask"),
                contract.get("change_value"),
                contract.get("percent_change"),
                contract.get("volume"),
                contract.get("open_interest"),
                contract.get("implied_volatility"),
                contract.get("in_the_money"),
                contract.get("contract_size"),
                contract.get("currency"),
                contract.get("last_trade_date"),
                fetched_at,
            )
            for contract in contracts
        ],
    )
    return len(contracts)


def collect_options_snapshot(symbol: str) -> Optional[Dict[str, Any]]:
    """Collect options flow data for a single symbol."""
    try:
        import yfinance as yf
    except ImportError:
        _print("ERROR: yfinance not installed")
        return None

    try:
        ticker = yf.Ticker(symbol)
        expirations = ticker.options
        if not expirations:
            return None

        info = ticker.info or {}
        price = info.get("regularMarketPrice") or info.get("previousClose")
        if not price:
            hist = ticker.history(period="1d")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])

        if not price or price <= 0:
            return None

        total_cv = 0
        total_pv = 0
        total_coi = 0
        total_poi = 0
        near_cv = 0
        near_pv = 0
        atm_call_iv = None
        atm_put_iv = None
        all_otm_put_ivs = []
        all_otm_call_ivs = []
        contracts: List[Dict[str, Any]] = []

        max_exps = min(len(expirations), 6)

        for i, exp in enumerate(expirations[:max_exps]):
            try:
                chain = ticker.option_chain(exp)
                calls = chain.calls
                puts = chain.puts
                contracts.extend(contract_rows_from_chain(symbol, exp, "call", calls))
                contracts.extend(contract_rows_from_chain(symbol, exp, "put", puts))

                cv = calls["volume"].sum() if "volume" in calls else 0
                pv = puts["volume"].sum() if "volume" in puts else 0
                coi = calls["openInterest"].sum() if "openInterest" in calls else 0
                poi = puts["openInterest"].sum() if "openInterest" in puts else 0

                if math.isnan(cv): cv = 0
                if math.isnan(pv): pv = 0
                if math.isnan(coi): coi = 0
                if math.isnan(poi): poi = 0

                total_cv += int(cv)
                total_pv += int(pv)
                total_coi += int(coi)
                total_poi += int(poi)

                if i == 0:
                    near_cv = int(cv)
                    near_pv = int(pv)

                if i <= 1 and atm_call_iv is None:
                    valid_calls = calls[calls["impliedVolatility"] > 0.01]
                    valid_puts = puts[puts["impliedVolatility"] > 0.01]
                    if len(valid_calls) > 0:
                        atm_idx = (valid_calls["strike"] - price).abs().idxmin()
                        atm_call_iv = float(valid_calls.loc[atm_idx, "impliedVolatility"])
                    if len(valid_puts) > 0:
                        atm_idx_p = (valid_puts["strike"] - price).abs().idxmin()
                        atm_put_iv = float(valid_puts.loc[atm_idx_p, "impliedVolatility"])

                valid_otm_puts = puts[(puts["strike"] < price * 0.95) & (puts["impliedVolatility"] > 0.01)]
                valid_otm_calls = calls[(calls["strike"] > price * 1.05) & (calls["impliedVolatility"] > 0.01)]
                all_otm_put_ivs.extend(valid_otm_puts["impliedVolatility"].tolist())
                all_otm_call_ivs.extend(valid_otm_calls["impliedVolatility"].tolist())

            except Exception:
                continue

        if total_cv == 0 and total_pv == 0:
            return None

        pc_vol = total_pv / total_cv if total_cv > 0 else None
        pc_oi = total_poi / total_coi if total_coi > 0 else None
        near_pc = near_pv / near_cv if near_cv > 0 else None

        otm_put_iv = sum(all_otm_put_ivs) / len(all_otm_put_ivs) if all_otm_put_ivs else None
        otm_call_iv = sum(all_otm_call_ivs) / len(all_otm_call_ivs) if all_otm_call_ivs else None
        iv_skew = (otm_put_iv - otm_call_iv) if otm_put_iv and otm_call_iv else None

        return {
            "symbol": symbol,
            "stock_price": price,
            "total_call_volume": total_cv,
            "total_put_volume": total_pv,
            "put_call_volume_ratio": pc_vol,
            "total_call_oi": total_coi,
            "total_put_oi": total_poi,
            "put_call_oi_ratio": pc_oi,
            "atm_call_iv": atm_call_iv,
            "atm_put_iv": atm_put_iv,
            "otm_put_avg_iv": otm_put_iv,
            "otm_call_avg_iv": otm_call_iv,
            "iv_skew": iv_skew,
            "near_call_volume": near_cv,
            "near_put_volume": near_pv,
            "near_put_call_ratio": near_pc,
            "expirations_scanned": max_exps,
            "contracts": contracts,
        }

    except Exception as e:
        _print(f"  [{symbol}] Error: {e}")
        return None


def compute_anomalies(conn: sqlite3.Connection, snapshot: Dict[str, Any], trade_date: str) -> Dict[str, Any]:
    """Compare today's metrics against 20-day history to detect anomalies."""
    symbol = snapshot["symbol"]

    rows = conn.execute(
        """SELECT total_call_volume + total_put_volume as total_vol,
                  put_call_volume_ratio, iv_skew
           FROM options_daily_snapshot
           WHERE symbol = ? AND trade_date < ?
           ORDER BY trade_date DESC LIMIT 20""",
        (symbol, trade_date),
    ).fetchall()

    result = {
        "volume_vs_20d_avg": None,
        "put_call_vs_20d_avg": None,
        "iv_skew_vs_20d_avg": None,
        "anomaly_score": 0.0,
        "anomaly_flags": [],
    }

    if len(rows) < 5:
        return result

    hist_vols = [r["total_vol"] for r in rows if r["total_vol"] and r["total_vol"] > 0]
    hist_pcs = [r["put_call_volume_ratio"] for r in rows if r["put_call_volume_ratio"] is not None]
    hist_skews = [r["iv_skew"] for r in rows if r["iv_skew"] is not None]

    today_vol = (snapshot.get("total_call_volume") or 0) + (snapshot.get("total_put_volume") or 0)
    today_pc = snapshot.get("put_call_volume_ratio")
    today_skew = snapshot.get("iv_skew")

    anomaly_score = 0.0
    flags = []

    if hist_vols and today_vol > 0:
        avg_vol = sum(hist_vols) / len(hist_vols)
        if avg_vol > 0:
            vol_ratio = today_vol / avg_vol
            result["volume_vs_20d_avg"] = vol_ratio
            if vol_ratio >= 3.0:
                anomaly_score += 30
                flags.append("extreme_volume")
            elif vol_ratio >= 2.0:
                anomaly_score += 15
                flags.append("high_volume")

    if hist_pcs and today_pc is not None:
        avg_pc = sum(hist_pcs) / len(hist_pcs)
        if avg_pc > 0:
            pc_ratio = today_pc / avg_pc
            result["put_call_vs_20d_avg"] = pc_ratio
            if today_pc >= 5.0 and pc_ratio >= 1.5:
                anomaly_score += 35
                flags.append("extreme_put_buying")
            elif today_pc >= 2.0 and pc_ratio >= 1.3:
                anomaly_score += 20
                flags.append("elevated_put_buying")
            elif today_pc <= 0.3 and pc_ratio <= 0.5:
                anomaly_score += 35
                flags.append("extreme_call_buying")
            elif today_pc <= 0.5 and pc_ratio <= 0.75:
                anomaly_score += 20
                flags.append("elevated_call_buying")

    if hist_skews and today_skew is not None:
        avg_skew = sum(hist_skews) / len(hist_skews)
        std_skew = (sum((s - avg_skew) ** 2 for s in hist_skews) / len(hist_skews)) ** 0.5
        if std_skew > 0:
            z_score = (today_skew - avg_skew) / std_skew
            result["iv_skew_vs_20d_avg"] = z_score
            if z_score >= 2.0:
                anomaly_score += 25
                flags.append("put_skew_spike")
            elif z_score <= -2.0:
                anomaly_score += 10
                flags.append("call_skew_spike")

    result["anomaly_score"] = anomaly_score
    result["anomaly_flags"] = flags
    return result


def generate_alerts(conn: sqlite3.Connection, snapshot: Dict[str, Any], anomalies: Dict[str, Any], trade_date: str) -> None:
    """Generate alerts for significant anomalies."""
    symbol = snapshot["symbol"]
    flags = anomalies.get("anomaly_flags", [])
    score = anomalies.get("anomaly_score", 0)

    if score < 20:
        return

    if "extreme_put_buying" in flags:
        pc = snapshot.get("put_call_volume_ratio", 0)
        pv = snapshot.get("total_put_volume", 0)
        conn.execute(
            """INSERT OR IGNORE INTO options_flow_alerts
               (symbol, trade_date, alert_type, severity, headline, detail, metrics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol, trade_date, "extreme_put_buying", "high",
             f"Unusual put activity: P/C ratio {pc:.1f}x",
             f"Put volume {pv:,} is significantly elevated vs recent history. "
             f"Smart money may be positioning for downside.",
             json.dumps({"put_call_ratio": pc, "put_volume": pv,
                         "vs_avg": anomalies.get("put_call_vs_20d_avg")}),
             _utc_now()),
        )

    if "extreme_call_buying" in flags:
        pc = snapshot.get("put_call_volume_ratio")
        cp = (1 / pc) if pc and pc > 0 else None
        cv = snapshot.get("total_call_volume", 0)
        conn.execute(
            """INSERT OR IGNORE INTO options_flow_alerts
               (symbol, trade_date, alert_type, severity, headline, detail, metrics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol, trade_date, "extreme_call_buying", "high",
             f"Unusual call activity: C/P ratio {cp:.1f}x" if cp else "Unusual call activity",
             f"Call volume {cv:,} is significantly elevated vs puts and recent history. "
             f"Traders may be positioning for upside.",
             json.dumps({"call_put_ratio": cp, "call_volume": cv,
                         "put_call_ratio": pc,
                         "vs_avg": anomalies.get("put_call_vs_20d_avg")}),
             _utc_now()),
        )

    if "extreme_volume" in flags:
        vol = (snapshot.get("total_call_volume", 0) or 0) + (snapshot.get("total_put_volume", 0) or 0)
        conn.execute(
            """INSERT OR IGNORE INTO options_flow_alerts
               (symbol, trade_date, alert_type, severity, headline, detail, metrics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol, trade_date, "extreme_volume", "moderate",
             f"Options volume {anomalies.get('volume_vs_20d_avg', 0):.1f}x normal",
             f"Total options volume {vol:,} is 3x+ the 20-day average. "
             f"Unusual institutional activity.",
             json.dumps({"total_volume": vol,
                         "vs_avg": anomalies.get("volume_vs_20d_avg")}),
             _utc_now()),
        )

    if "put_skew_spike" in flags:
        skew = snapshot.get("iv_skew")
        conn.execute(
            """INSERT OR IGNORE INTO options_flow_alerts
               (symbol, trade_date, alert_type, severity, headline, detail, metrics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol, trade_date, "put_skew_spike", "high",
             f"IV skew spike: puts getting expensive",
             f"Put implied volatility is spiking relative to calls (skew z-score "
             f"{anomalies.get('iv_skew_vs_20d_avg', 0):.1f}). "
             f"Someone is paying up for downside protection.",
             json.dumps({"iv_skew": skew,
                         "z_score": anomalies.get("iv_skew_vs_20d_avg")}),
             _utc_now()),
        )

    if score >= 50:
        conn.execute(
            """INSERT OR IGNORE INTO options_flow_alerts
               (symbol, trade_date, alert_type, severity, headline, detail, metrics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol, trade_date, "smart_money_warning", "critical",
             f"Multiple options anomalies detected (score {score:.0f})",
             f"Flags: {', '.join(flags)}. Multiple signals suggest institutional "
             f"positioning — investigate immediately.",
             json.dumps({"score": score, "flags": flags,
                         "put_call_ratio": snapshot.get("put_call_volume_ratio"),
                         "iv_skew": snapshot.get("iv_skew")}),
             _utc_now()),
        )

    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect daily options flow snapshots")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols (overrides universe source)")
    parser.add_argument("--top", type=int, default=0, help="Limit to top N symbols from universe")
    parser.add_argument("--sleep-ms", type=int, default=500, help="Sleep between symbols (ms)")
    parser.add_argument(
        "--universe-source",
        choices=["optionable-clean", "clean-all"],
        default="optionable-clean",
        help="Universe source when --symbols is not supplied. Default: clean-universe symbols marked optionable.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-collect symbols that already have a snapshot for today's trade_date.",
    )
    parser.add_argument(
        "--seed-optionability-only",
        action="store_true",
        help="Seed options_symbol_optionability from clean universe intersected with backend/data/universe/optionable.json, then exit.",
    )
    parser.add_argument(
        "--refresh-optionability-only",
        action="store_true",
        help="Actively refresh optionability via yfinance and exit.",
    )
    parser.add_argument(
        "--optionability-status",
        choices=["all", "unknown", "error", "optionable", "not_optionable"],
        default="all",
        help="Status filter for --refresh-optionability-only.",
    )
    args = parser.parse_args()

    conn = ensure_db()

    if args.seed_optionability_only:
        counts = seed_optionability_from_clean_universe(conn)
        totals = conn.execute(
            """SELECT status, COUNT(*) AS c
                 FROM options_symbol_optionability
                WHERE in_clean_universe = 1
                GROUP BY status
                ORDER BY status""",
        ).fetchall()
        conn.close()
        _print("=== Optionability Seed ===")
        _print(f"Seed counts from catalog: {json.dumps(counts, sort_keys=True)}")
        _print(f"DB clean-universe totals: {json.dumps({r['status']: r['c'] for r in totals}, sort_keys=True)}")
        return 0

    if args.refresh_optionability_only:
        counts = refresh_optionability(
            conn,
            limit=args.top or None,
            status_filter=args.optionability_status,
            sleep_ms=args.sleep_ms,
        )
        totals = conn.execute(
            """SELECT status, COUNT(*) AS c
                 FROM options_symbol_optionability
                WHERE in_clean_universe = 1
                GROUP BY status
                ORDER BY status""",
        ).fetchall()
        conn.close()
        _print("\n=== Optionability Refresh Summary ===")
        _print(json.dumps(counts, sort_keys=True))
        _print(f"DB clean-universe totals: {json.dumps({r['status']: r['c'] for r in totals}, sort_keys=True)}")
        return 0

    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    else:
        symbols = load_universe(conn, args.top or None, args.universe_source)

    trade_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    _print(f"=== Options Flow Collector ===")
    _print(f"Trade date: {trade_date}")
    _print(f"Universe source: {'explicit symbols' if args.symbols else args.universe_source}")
    _print(f"Symbols: {len(symbols)}")

    collected = 0
    contract_rows_collected = 0
    skipped = 0
    already_collected = 0
    errors = 0
    alerts_generated = 0

    for i, symbol in enumerate(symbols, 1):
        try:
            if not args.force:
                existing = conn.execute(
                    "SELECT 1 FROM options_daily_snapshot WHERE symbol = ? AND trade_date = ?",
                    (symbol, trade_date),
                ).fetchone()
                if existing:
                    already_collected += 1
                    if i % 100 == 0:
                        _print(
                            f"  [{i}/{len(symbols)}] Progress... "
                            f"({collected} collected, {already_collected} already, {skipped} skipped)"
                        )
                    continue

            snapshot = collect_options_snapshot(symbol)
            if not snapshot:
                skipped += 1
                if i % 50 == 0:
                    _print(f"  [{i}/{len(symbols)}] Progress... ({collected} collected, {skipped} skipped)")
                continue

            anomalies = compute_anomalies(conn, snapshot, trade_date)

            conn.execute(
                """INSERT OR REPLACE INTO options_daily_snapshot
                   (symbol, trade_date, stock_price,
                    total_call_volume, total_put_volume, put_call_volume_ratio,
                    total_call_oi, total_put_oi, put_call_oi_ratio,
                    atm_call_iv, atm_put_iv, otm_put_avg_iv, otm_call_avg_iv, iv_skew,
                    near_call_volume, near_put_volume, near_put_call_ratio,
                    volume_vs_20d_avg, put_call_vs_20d_avg, iv_skew_vs_20d_avg,
                    anomaly_score, anomaly_flags, expirations_scanned, fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (symbol, trade_date, snapshot.get("stock_price"),
                 snapshot.get("total_call_volume"), snapshot.get("total_put_volume"),
                 snapshot.get("put_call_volume_ratio"),
                 snapshot.get("total_call_oi"), snapshot.get("total_put_oi"),
                 snapshot.get("put_call_oi_ratio"),
                 snapshot.get("atm_call_iv"), snapshot.get("atm_put_iv"),
                 snapshot.get("otm_put_avg_iv"), snapshot.get("otm_call_avg_iv"),
                 snapshot.get("iv_skew"),
                 snapshot.get("near_call_volume"), snapshot.get("near_put_volume"),
                 snapshot.get("near_put_call_ratio"),
                 anomalies.get("volume_vs_20d_avg"),
                 anomalies.get("put_call_vs_20d_avg"),
                 anomalies.get("iv_skew_vs_20d_avg"),
                 anomalies.get("anomaly_score"),
                 json.dumps(anomalies.get("anomaly_flags", [])),
                 snapshot.get("expirations_scanned"),
                 _utc_now()),
            )
            contract_rows_collected += store_contract_snapshots(
                conn,
                symbol,
                trade_date,
                snapshot.get("contracts", []),
            )
            mark_symbol_optionable_from_snapshot(conn, symbol, snapshot)
            conn.commit()

            pre_alert_count = conn.execute(
                "SELECT COUNT(*) FROM options_flow_alerts WHERE trade_date = ?",
                (trade_date,),
            ).fetchone()[0]

            generate_alerts(conn, snapshot, anomalies, trade_date)

            post_alert_count = conn.execute(
                "SELECT COUNT(*) FROM options_flow_alerts WHERE trade_date = ?",
                (trade_date,),
            ).fetchone()[0]
            new_alerts = post_alert_count - pre_alert_count
            alerts_generated += new_alerts

            collected += 1

            pc = snapshot.get("put_call_volume_ratio")
            score = anomalies.get("anomaly_score", 0)
            flag_str = ",".join(anomalies.get("anomaly_flags", []))
            pc_display = f"{pc:.2f}" if pc is not None else "N/A"

            if score >= 20 or i % 25 == 0:
                _print(f"  [{i}/{len(symbols)}] {symbol:6s} P/C={pc_display}" +
                       (f"  score={score:.0f} [{flag_str}]" if score > 0 else "") +
                       (f"  ** {new_alerts} ALERT(S)" if new_alerts > 0 else ""))

        except Exception as e:
            errors += 1
            if i % 50 == 0:
                _print(f"  [{i}/{len(symbols)}] {symbol}: error - {e}")

        if args.sleep_ms > 0 and i < len(symbols):
            time.sleep(args.sleep_ms / 1000.0)

    _print(f"\n=== Summary ===")
    _print(f"Collected: {collected}")
    _print(f"Contract rows collected: {contract_rows_collected}")
    _print(f"Already collected: {already_collected}")
    _print(f"Skipped: {skipped}")
    _print(f"Errors: {errors}")
    _print(f"Alerts generated: {alerts_generated}")

    # Show top anomalies
    top = conn.execute(
        """SELECT symbol, put_call_volume_ratio, anomaly_score, anomaly_flags,
                  total_put_volume, total_call_volume, iv_skew, stock_price
           FROM options_daily_snapshot
           WHERE trade_date = ? AND anomaly_score > 0
           ORDER BY anomaly_score DESC LIMIT 20""",
        (trade_date,),
    ).fetchall()

    if top:
        _print(f"\n=== Top Anomalies Today ===")
        _print(f"{'Symbol':8s} {'Price':>8s} {'P/C':>6s} {'Put Vol':>10s} {'Score':>6s} {'Flags'}")
        _print("-" * 70)
        for r in top:
            _print(f"{r['symbol']:8s} ${r['stock_price']:>7.0f} {r['put_call_volume_ratio']:>6.2f} "
                   f"{r['total_put_volume']:>10,} {r['anomaly_score']:>6.0f} {r['anomaly_flags']}")

    # Show all alerts
    alerts = conn.execute(
        """SELECT symbol, alert_type, severity, headline
           FROM options_flow_alerts WHERE trade_date = ?
           ORDER BY severity, symbol""",
        (trade_date,),
    ).fetchall()

    if alerts:
        _print(f"\n=== Alerts ===")
        for a in alerts:
            sev = a["severity"].upper()
            _print(f"  [{sev}] {a['symbol']}: {a['headline']}")

    conn.close()

    result = {
        "trade_date": trade_date,
        "collected": collected,
        "contract_rows_collected": contract_rows_collected,
        "already_collected": already_collected,
        "skipped": skipped,
        "errors": errors,
        "alerts_generated": alerts_generated,
    }
    _print(f"\n{json.dumps(result)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
