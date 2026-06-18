#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import statistics
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_DIR = DATA_DIR / "universe"
DEFAULT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"
DEFAULT_OUTPUT_PATH = DATA_DIR / "research" / "fundamental_backtest_summary_app.json"
DEFAULT_OBSERVATIONS_PATH = DATA_DIR / "research" / "fundamental_backtest_observations_app.csv"
FUNDAMENTALS_CACHE_DIR = DATA_DIR / "fundamentals-cache"
SERVICES_DIR = ROOT / "backend" / "services"
VALUATION_GAP_THRESHOLD_PCT = 20.0
VALUATION_RULE_METRICS = {"dcf_gap_pct", "dcf_state", "valuation_gap_pct", "valuation_state"}
_REPORTED_EXECUTION_HISTORY_CACHE: Dict[str, List[Dict[str, Any]]] = {}
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))
try:
    from valuation_feature_store import get_valuation_features
except Exception:
    get_valuation_features = None
HISTORICAL_FACT_METRICS = (
    "currentRatio",
    "debtToEquity",
    "earnings_report.epsSurprisePct",
    "earnings_report.salesSurprisePct",
    "epsSurprisePct",
    "revenueGrowthPct",
    "revenueQoQGrowthPct",
    "revenueYoYGrowthPct",
    "salesSurprisePct",
    "sharesOutstanding",
    "survivabilityScore",
    "targetPrice",
    "totalCash",
    "totalDebt",
)


def _parse_date(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except Exception:
        return None


def _safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        value = float(value)
    except Exception:
        return None
    if not math.isfinite(value):
        return None
    return value


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _period_key(date_text: str, frequency: str) -> Tuple[int, int]:
    dt = _parse_date(date_text)
    if dt is None:
        return (0, 0)
    if frequency == "quarterly":
        return (dt.year, ((dt.month - 1) // 3) + 1)
    if frequency == "yearly":
        return (dt.year, 1)
    return (dt.year, dt.month)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def _load_cached_reported_execution(symbol: str, asof_date: str) -> Dict[str, Any]:
    """Use cached ledger earnings only when the report date is not in the future."""
    symbol = _normalize_symbol(symbol)
    if symbol not in _REPORTED_EXECUTION_HISTORY_CACHE:
        cache_path = FUNDAMENTALS_CACHE_DIR / f"{symbol}.json"
        wrapper = _read_json(cache_path)
        rows: List[Dict[str, Any]] = []
        if isinstance(wrapper, dict):
            data = wrapper.get("data")
            execution = data.get("reportedExecution") if isinstance(data, dict) else None
            history = execution.get("history") if isinstance(execution, dict) else None
            if isinstance(history, list):
                for row in history:
                    if not isinstance(row, dict):
                        continue
                    item = dict(row)
                    item["__top_revenueQoQGrowthPct"] = data.get("revenueQoQGrowthPct")
                    item["__top_revenueYoYGrowthPct"] = data.get("revenueYoYGrowthPct")
                    item["__top_revenueGrowthPct"] = data.get("revenueGrowthPct")
                    rows.append(item)
        _REPORTED_EXECUTION_HISTORY_CACHE[symbol] = rows
    history = _REPORTED_EXECUTION_HISTORY_CACHE.get(symbol) or []

    asof_dt = _parse_date(asof_date)
    if asof_dt is None:
        return {}

    eligible: List[Dict[str, Any]] = []
    for row in history:
        if not isinstance(row, dict):
            continue
        row_dt = _parse_date(row.get("date"))
        if row_dt is not None and row_dt <= asof_dt:
            eligible.append(row)
    if not eligible:
        return {}
    eligible.sort(key=lambda item: str(item.get("date") or ""), reverse=True)
    return dict(eligible[0])


def _load_universe_symbols(name: str) -> List[str]:
    registry_path = UNIVERSE_DIR / "registry.json"
    registry = _read_json(registry_path) or {}
    universe_name = {
        "clean": "clean_stocks",
        "liquid_clean": "clean_stocks",
        "all": "clean_stocks",
    }.get(str(name or "").strip(), str(name or "clean_stocks").strip())
    entry = ((registry.get("universes") or {}) if isinstance(registry, dict) else {}).get(universe_name) or {}
    rel_path = str(entry.get("path") or "").strip()
    schema = str(entry.get("schema") or "symbols").strip()
    if not rel_path:
        return []
    payload = _read_json(UNIVERSE_DIR / rel_path)
    if schema == "stocks" and isinstance(payload, dict):
        values = [row.get("ticker") for row in (payload.get("stocks") or []) if isinstance(row, dict)]
    elif schema == "optionable" and isinstance(payload, dict):
        values = payload.get("optionable") or payload.get("symbols") or []
    elif schema == "source_symbols" and isinstance(payload, dict):
        values = payload.get("source_symbols") or payload.get("symbols") or []
    elif isinstance(payload, dict):
        values = payload.get("symbols") or []
    else:
        values = payload or []

    out: List[str] = []
    seen = set()
    for value in values:
        symbol = _normalize_symbol(value)
        if symbol and symbol not in seen:
            seen.add(symbol)
            out.append(symbol)
    return out


def _normalize_symbol_list(values: Any) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values if isinstance(values, list) else []:
        symbol = _normalize_symbol(value)
        if symbol and symbol not in seen:
            seen.add(symbol)
            out.append(symbol)
    return out


def _bar_path(symbol: str) -> Path:
    safe = symbol.replace("/", "_").replace("=", "_").replace("-", "_")
    return UNIVERSE_DIR / f"{safe}_1d.csv"


def _load_bars(symbol: str) -> List[Dict[str, Any]]:
    path = _bar_path(symbol)
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            dt = _parse_date(row.get("Date") or row.get("date") or row.get("timestamp"))
            close = _safe_float(row.get("Close") or row.get("close"))
            high = _safe_float(row.get("High") or row.get("high"))
            low = _safe_float(row.get("Low") or row.get("low"))
            volume = _safe_float(row.get("Volume") or row.get("volume"))
            if dt is None or close is None or high is None or low is None:
                continue
            rows.append({
                "date": dt.date().isoformat(),
                "close": close,
                "high": high,
                "low": low,
                "volume": volume,
            })
    rows.sort(key=lambda item: item["date"])
    return rows


def _find_bar_index_on_or_after(bars: Sequence[Dict[str, Any]], date_text: str) -> Optional[int]:
    for idx, bar in enumerate(bars):
        if str(bar.get("date")) >= date_text:
            return idx
    return None


def _sma(values: Sequence[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def _dollar_volume_20d(bars: Sequence[Dict[str, Any]], index: int) -> Optional[float]:
    start = max(0, index - 20)
    sample = bars[start:index]
    values = [
        float(bar["close"]) * float(bar["volume"])
        for bar in sample
        if _safe_float(bar.get("close")) is not None and _safe_float(bar.get("volume")) is not None
    ]
    return _sma(values)


def _drawdown_pct(bars: Sequence[Dict[str, Any]], index: int, lookback: int = 126) -> Optional[float]:
    start = max(0, index - lookback)
    sample = bars[start:index + 1]
    highs = [_safe_float(bar.get("high")) for bar in sample]
    highs = [value for value in highs if value is not None and value > 0]
    price = _safe_float(bars[index].get("close")) if 0 <= index < len(bars) else None
    if not highs or price is None:
        return None
    peak = max(highs)
    return ((price - peak) / peak) * 100.0 if peak else None


def _below_200d(bars: Sequence[Dict[str, Any]], index: int) -> Optional[bool]:
    if index < 199:
        return None
    closes = [_safe_float(bar.get("close")) for bar in bars[index - 199:index + 1]]
    closes = [value for value in closes if value is not None]
    if len(closes) < 200:
        return None
    price = _safe_float(bars[index].get("close"))
    avg = _sma(closes)
    return bool(price is not None and avg is not None and price < avg)


def _select_rebalance_indices(
    bars: Sequence[Dict[str, Any]],
    frequency: str,
    *,
    start: Optional[str],
    end: Optional[str],
    max_forward_bars: int,
) -> List[int]:
    if len(bars) <= max_forward_bars:
        return []
    start_dt = _parse_date(start) if start else None
    end_dt = _parse_date(end) if end else None
    max_valid_index = len(bars) - 1 - max_forward_bars
    out: List[int] = []
    current_bucket = None
    bucket_last_index = None

    for idx, bar in enumerate(bars):
        date_text = str(bar.get("date") or "")
        dt = _parse_date(date_text)
        if dt is None:
            continue
        if start_dt and dt < start_dt:
            continue
        if end_dt and dt > end_dt:
            continue
        bucket = _period_key(date_text, frequency)
        if current_bucket is None:
            current_bucket = bucket
        if bucket != current_bucket:
            if bucket_last_index is not None and bucket_last_index <= max_valid_index:
                out.append(bucket_last_index)
            current_bucket = bucket
        bucket_last_index = idx

    if bucket_last_index is not None and bucket_last_index <= max_valid_index:
        out.append(bucket_last_index)
    return out


def _nested(payload: Dict[str, Any], *path: str) -> Any:
    current: Any = payload
    for part in path:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _rules_need_valuation(*rule_groups: Sequence[Dict[str, Any]]) -> bool:
    for rules in rule_groups:
        for rule in rules or []:
            if str((rule or {}).get("metric") or "").strip() in VALUATION_RULE_METRICS:
                return True
    return False


def _valuation_signal(symbol: str, asof_date: str, current_price: Optional[float]) -> Optional[Dict[str, Any]]:
    if get_valuation_features is None or current_price is None or current_price <= 0:
        return None
    return get_valuation_features(symbol, asof_date, float(current_price), gap_threshold_pct=VALUATION_GAP_THRESHOLD_PCT)


def _metrics(
    raw: Dict[str, Any],
    bars: Sequence[Dict[str, Any]],
    index: int,
    *,
    symbol: str = "",
    asof_date: str = "",
    include_valuation: bool = False,
) -> Dict[str, Any]:
    market_cap = _safe_float(raw.get("marketCap"))
    target_price = _safe_float(raw.get("targetPrice"))
    current_price = _safe_float(bars[index].get("close")) or _safe_float(raw.get("currentPrice"))
    net_cash = _safe_float(raw.get("netCash"))
    net_debt_to_market_cap = None
    if market_cap and market_cap > 0 and net_cash is not None:
        net_debt_to_market_cap = max(0.0, -net_cash) / market_cap
    valuation_gap = None
    if target_price is not None and current_price not in (None, 0):
        valuation_gap = ((target_price - float(current_price)) / float(current_price)) * 100.0
    if valuation_gap is None:
        valuation_gap = _safe_float(raw.get("valuationGapPct"))
    valuation_signal = _valuation_signal(symbol, asof_date, current_price) if include_valuation and symbol and asof_date else None
    if valuation_signal:
        signal_gap = _safe_float(valuation_signal.get("valuation_gap_pct"))
        if signal_gap is not None:
            valuation_gap = signal_gap

    sales_surprise = _safe_float(raw.get("salesSurprisePct"))
    if sales_surprise is None:
        sales_surprise = _safe_float(_nested(raw, "reportedExecution", "avgSalesSurprisePct"))

    valuation_state = str((valuation_signal or {}).get("valuation_state") or "").strip()
    if not valuation_state:
        valuation_state = "undervalued" if valuation_gap is not None and valuation_gap >= 20 else "overvalued" if valuation_gap is not None and valuation_gap <= -20 else "roughly_fair"

    return {
        "price_drawdown_6m_pct": _drawdown_pct(bars, index),
        "revenue_growth_yoy_pct": _safe_float(raw.get("revenueYoYGrowthPct") or raw.get("revenueGrowthPct")),
        "revenue_acceleration_qoq_pct": _safe_float(raw.get("revenueQoQGrowthPct")),
        "eps_surprise_pct": _safe_float(raw.get("epsSurprisePct")),
        "eps_surprise_age_days": _safe_float(raw.get("epsSurpriseAgeDays")),
        "sales_surprise_pct": sales_surprise,
        "sales_surprise_age_days": _safe_float(raw.get("salesSurpriseAgeDays")),
        "dcf_gap_pct": valuation_gap,
        "dcf_state": valuation_state,
        "valuation_gap_pct": valuation_gap,
        "valuation_state": valuation_state,
        "quality_score": _safe_float(raw.get("qualityScore") or raw.get("survivabilityScore")),
        "current_ratio": _safe_float(raw.get("currentRatio")),
        "net_debt_to_market_cap": net_debt_to_market_cap,
        "market_cap": market_cap,
        "fair_value_low": _safe_float((valuation_signal or {}).get("fair_value_low")),
        "fair_value_mid": _safe_float((valuation_signal or {}).get("fair_value_mid")),
        "fair_value_high": _safe_float((valuation_signal or {}).get("fair_value_high")),
        "dcf_coverage_mode": (valuation_signal or {}).get("coverage_mode"),
        "dollar_volume_20d": _dollar_volume_20d(bars, index),
        "below_200d": _below_200d(bars, index),
        "reverse_split_within_days": None,
    }


def _days_between(left: Any, right: Any) -> Optional[int]:
    left_dt = _parse_date(left)
    right_dt = _parse_date(right)
    if left_dt is None or right_dt is None:
        return None
    return (left_dt - right_dt).days


def _latest_fundamental_metric_map(conn: sqlite3.Connection, symbol: str, asof_date: str) -> Dict[str, Any]:
    placeholders = ", ".join("?" for _ in HISTORICAL_FACT_METRICS)
    rows = conn.execute(
        f"""
        SELECT metric, value_numeric, value_text, available_at, period_end
        FROM pit_fundamental_facts
        WHERE symbol = ?
          AND available_at <= ?
          AND metric IN ({placeholders})
        ORDER BY metric ASC, available_at DESC, period_end DESC, updated_at DESC
        """,
        (symbol, asof_date, *HISTORICAL_FACT_METRICS),
    ).fetchall()
    out: Dict[str, Any] = {}
    meta: Dict[str, Any] = {}
    for metric, numeric, text, available_at, period_end in rows:
        metric = str(metric or "")
        if metric in out:
            continue
        out[metric] = numeric if numeric is not None else text
        meta[f"{metric}__available_at"] = str(available_at or "")[:10] or None
        meta[f"{metric}__period_end"] = str(period_end or "")[:10] or None
    out["_meta"] = meta
    return out


def _historical_raw_from_facts(
    conn: sqlite3.Connection,
    symbol: str,
    asof_date: str,
    bars: Sequence[Dict[str, Any]],
    index: int,
) -> Optional[Dict[str, Any]]:
    facts = _latest_fundamental_metric_map(conn, symbol, asof_date)
    if not facts:
        return None
    meta = facts.get("_meta") if isinstance(facts.get("_meta"), dict) else {}

    price = _safe_float(bars[index].get("close"))
    shares = _safe_float(facts.get("sharesOutstanding"))
    market_cap = (shares * price) if shares is not None and price is not None else None
    total_cash = _safe_float(facts.get("totalCash"))
    total_debt = _safe_float(facts.get("totalDebt"))
    net_cash = None
    if total_cash is not None or total_debt is not None:
        net_cash = (total_cash or 0.0) - (total_debt or 0.0)

    target_price = _safe_float(facts.get("targetPrice"))
    eps_metric_key = "earnings_report.epsSurprisePct" if facts.get("earnings_report.epsSurprisePct") is not None else "epsSurprisePct"
    eps_available_at = meta.get(f"{eps_metric_key}__available_at")
    sales_metric_key = "earnings_report.salesSurprisePct" if facts.get("earnings_report.salesSurprisePct") is not None else "salesSurprisePct"
    sales_available_at = meta.get(f"{sales_metric_key}__available_at")
    cache_report = _load_cached_reported_execution(symbol, asof_date)
    cache_report_date = str(cache_report.get("date") or "")[:10] if cache_report else None
    if cache_report_date and _parse_date(cache_report_date):
        eps_cache_value = _safe_float(cache_report.get("epsSurprisePct"))
        sales_cache_value = _safe_float(cache_report.get("salesSurprisePct"))
        if eps_cache_value is not None and (eps_available_at is None or _days_between(cache_report_date, eps_available_at) is not None and _days_between(cache_report_date, eps_available_at) >= 0):
            eps_metric_key = "__cache_reportedExecution.epsSurprisePct"
            facts[eps_metric_key] = eps_cache_value
            eps_available_at = cache_report_date
        if sales_cache_value is not None and (sales_available_at is None or _days_between(cache_report_date, sales_available_at) is not None and _days_between(cache_report_date, sales_available_at) >= 0):
            sales_metric_key = "__cache_reportedExecution.salesSurprisePct"
            facts[sales_metric_key] = sales_cache_value
            sales_available_at = cache_report_date
    revenue_qoq = _safe_float(facts.get("revenueQoQGrowthPct"))
    cached_revenue_qoq = _safe_float(cache_report.get("__top_revenueQoQGrowthPct")) if cache_report else None
    if cached_revenue_qoq is not None and cache_report_date and _parse_date(cache_report_date):
        revenue_qoq = cached_revenue_qoq

    return {
        "currentPrice": price,
        "currentRatio": _safe_float(facts.get("currentRatio")),
        "debtToEquity": _safe_float(facts.get("debtToEquity")),
        "epsSurprisePct": _safe_float(facts.get(eps_metric_key)),
        "epsSurpriseAvailableAt": eps_available_at,
        "epsSurpriseAgeDays": _days_between(asof_date, eps_available_at),
        "marketCap": market_cap,
        "netCash": net_cash,
        "revenueGrowthPct": _safe_float(facts.get("revenueGrowthPct")),
        "revenueQoQGrowthPct": revenue_qoq,
        "revenueYoYGrowthPct": _safe_float(facts.get("revenueYoYGrowthPct") or facts.get("revenueGrowthPct")),
        "salesSurprisePct": _safe_float(facts.get(sales_metric_key)),
        "salesSurpriseAvailableAt": sales_available_at,
        "salesSurpriseAgeDays": _days_between(asof_date, sales_available_at),
        "sharesOutstanding": shares,
        "survivabilityScore": _safe_float(facts.get("survivabilityScore")),
        "targetPrice": target_price,
        "totalCash": total_cash,
        "totalDebt": total_debt,
    }


def _compare(left: Any, op: str, right: Any) -> bool:
    if op == "is_true":
        return left is True
    if op == "is_false":
        return left is False
    if left is None:
        return False
    if op in ("=", "=="):
        return str(left).lower() == str(right).lower()
    if op == "!=":
        return str(left).lower() != str(right).lower()
    if op == "between":
        bounds = right if isinstance(right, list) else []
        if len(bounds) != 2:
            return False
        numeric = _safe_float(left)
        low = _safe_float(bounds[0])
        high = _safe_float(bounds[1])
        return numeric is not None and low is not None and high is not None and low <= numeric <= high
    numeric_left = _safe_float(left)
    numeric_right = _safe_float(right)
    if numeric_left is None or numeric_right is None:
        return False
    if op == ">":
        return numeric_left > numeric_right
    if op == ">=":
        return numeric_left >= numeric_right
    if op == "<":
        return numeric_left < numeric_right
    if op == "<=":
        return numeric_left <= numeric_right
    return False


def _passes_entry(metrics: Dict[str, Any], rules: Sequence[Dict[str, Any]]) -> bool:
    return all(_compare(metrics.get(str(rule.get("metric"))), str(rule.get("op") or ""), rule.get("value")) for rule in rules)


def _passes_exclusions(metrics: Dict[str, Any], rules: Sequence[Dict[str, Any]]) -> bool:
    for rule in rules:
        metric = str(rule.get("metric") or "")
        if metrics.get(metric) is None:
            continue
        if _compare(metrics.get(metric), str(rule.get("op") or ""), rule.get("value")):
            return False
    return True


def _simulate_exit(
    bars: Sequence[Dict[str, Any]],
    entry_index: int,
    *,
    max_hold_days: int,
    stop_loss_pct: Optional[float],
    take_profit_ladder_pct: Sequence[float],
    trailing_stop_pct: Optional[float],
) -> Dict[str, Any]:
    entry = _safe_float(bars[entry_index].get("close"))
    if entry is None or entry <= 0:
        return {}
    last_index = min(len(bars) - 1, entry_index + max_hold_days)
    stop_price = entry * (1.0 + float(stop_loss_pct or 0.0) / 100.0) if stop_loss_pct is not None else None
    take_profit = min([float(x) for x in take_profit_ladder_pct if _safe_float(x) is not None], default=None)
    take_profit_price = entry * (1.0 + take_profit / 100.0) if take_profit is not None else None
    trail_high = entry

    for idx in range(entry_index + 1, last_index + 1):
        high = _safe_float(bars[idx].get("high")) or 0.0
        low = _safe_float(bars[idx].get("low")) or float("inf")
        trail_high = max(trail_high, high)
        if stop_price is not None and low <= stop_price:
            return {"exit_index": idx, "exit_price": stop_price, "exit_reason": "stop_loss"}
        if take_profit_price is not None and high >= take_profit_price:
            return {"exit_index": idx, "exit_price": take_profit_price, "exit_reason": f"take_profit_{take_profit:g}"}
        if trailing_stop_pct is not None and trail_high > entry:
            trail_price = trail_high * (1.0 - float(trailing_stop_pct) / 100.0)
            if low <= trail_price:
                return {"exit_index": idx, "exit_price": trail_price, "exit_reason": "trailing_stop"}

    return {
        "exit_index": last_index,
        "exit_price": _safe_float(bars[last_index].get("close")),
        "exit_reason": "max_hold",
    }


def _benchmark_return(symbol: str, entry_date: str, exit_date: str) -> Optional[float]:
    bars = _load_bars(symbol)
    entry_index = _find_bar_index_on_or_after(bars, entry_date)
    exit_index = _find_bar_index_on_or_after(bars, exit_date)
    if entry_index is None or exit_index is None:
        return None
    entry = _safe_float(bars[entry_index].get("close"))
    exit_price = _safe_float(bars[exit_index].get("close"))
    if entry in (None, 0) or exit_price is None:
        return None
    return ((exit_price - entry) / entry) * 100.0


def _load_snapshots(conn: sqlite3.Connection, symbols: Sequence[str], start: Optional[str], end: Optional[str]) -> List[Dict[str, Any]]:
    clauses = []
    params: List[Any] = []
    if start:
        clauses.append("asof_date >= ?")
        params.append(start)
    if end:
        clauses.append("asof_date <= ?")
        params.append(end)
    symbol_set = set(symbols)
    sql = "SELECT symbol, asof_date, snapshot_json FROM asof_symbol_snapshots"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY asof_date ASC, symbol ASC"
    rows = []
    for symbol, asof_date, snapshot_json in conn.execute(sql, tuple(params)).fetchall():
        symbol = _normalize_symbol(symbol)
        if symbol_set and symbol not in symbol_set:
            continue
        try:
            payload = json.loads(snapshot_json or "{}")
        except Exception:
            continue
        raw = payload.get("raw") if isinstance(payload, dict) else None
        if not isinstance(raw, dict):
            continue
        rows.append({"symbol": symbol, "asof_date": str(asof_date)[:10], "raw": raw})
    return rows


def _select_rebalanced_snapshots(rows: Sequence[Dict[str, Any]], frequency: str) -> List[Dict[str, Any]]:
    by_bucket: Dict[Tuple[str, Tuple[int, int]], Dict[str, Any]] = {}
    for row in rows:
        key = (row["symbol"], _period_key(row["asof_date"], frequency))
        current = by_bucket.get(key)
        if current is None or row["asof_date"] > current["asof_date"]:
            by_bucket[key] = row
    return sorted(by_bucket.values(), key=lambda item: (item["asof_date"], item["symbol"]))


def _load_historical_fact_observations(
    conn: sqlite3.Connection,
    symbols: Sequence[str],
    bars_cache: Dict[str, List[Dict[str, Any]]],
    *,
    frequency: str,
    start: Optional[str],
    end: Optional[str],
    max_forward_bars: int,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    rows: List[Dict[str, Any]] = []
    skipped = {"no_bars": 0, "no_facts": 0}
    for symbol in symbols:
        bars = bars_cache.get(symbol)
        if bars is None:
            bars = _load_bars(symbol)
            bars_cache[symbol] = bars
        if not bars:
            skipped["no_bars"] += 1
            continue
        for index in _select_rebalance_indices(
            bars,
            frequency,
            start=start,
            end=end,
            max_forward_bars=max_forward_bars,
        ):
            asof_date = str(bars[index]["date"])
            raw = _historical_raw_from_facts(conn, symbol, asof_date, bars, index)
            if raw is None:
                skipped["no_facts"] += 1
                continue
            rows.append({
                "symbol": symbol,
                "asof_date": asof_date,
                "raw": raw,
                "entry_index": index,
                "source": "pit_fundamental_facts",
            })
    return sorted(rows, key=lambda item: (item["asof_date"], item["symbol"])), skipped


def _mean(values: Sequence[float]) -> Optional[float]:
    return round(statistics.mean(values), 4) if values else None


def _median(values: Sequence[float]) -> Optional[float]:
    return round(statistics.median(values), 4) if values else None


def _percentile(values: Sequence[float], pct: float) -> Optional[float]:
    if not values:
        return None
    values = sorted(values)
    idx = min(len(values) - 1, max(0, round((len(values) - 1) * pct)))
    return round(values[idx], 4)


def _summarize(trades: Sequence[Dict[str, Any]], benchmark: str) -> Dict[str, Any]:
    returns = [_safe_float(row.get("return_pct")) for row in trades]
    returns = [value for value in returns if value is not None]
    benchmark_returns = [_safe_float(row.get("benchmark_return_pct")) for row in trades]
    benchmark_returns = [value for value in benchmark_returns if value is not None]
    beat_flags = [
        row.get("beat_benchmark")
        for row in trades
        if isinstance(row.get("beat_benchmark"), bool)
    ]
    wins = [value for value in returns if value > 0]
    by_reason: Dict[str, int] = {}
    for row in trades:
        reason = str(row.get("exit_reason") or "unknown")
        by_reason[reason] = by_reason.get(reason, 0) + 1
    total_return = sum(returns)
    largest = max(returns) if returns else None
    outlier_dependency = (largest / total_return) if largest is not None and total_return > 0 else None
    return {
        "trade_count": len(trades),
        "symbols": len(set(row.get("symbol") for row in trades)),
        "win_rate": round(len(wins) / len(returns), 4) if returns else None,
        "avg_return_pct": _mean(returns),
        "median_return_pct": _median(returns),
        "p10_return_pct": _percentile(returns, 0.10),
        "p90_return_pct": _percentile(returns, 0.90),
        "best_return_pct": round(max(returns), 4) if returns else None,
        "worst_return_pct": round(min(returns), 4) if returns else None,
        "avg_benchmark_return_pct": _mean(benchmark_returns),
        "beat_benchmark_rate": round(sum(1 for flag in beat_flags if flag) / len(beat_flags), 4) if beat_flags else None,
        "outlier_dependency": round(outlier_dependency, 4) if outlier_dependency is not None else None,
        "exit_reasons": by_reason,
        "benchmark": benchmark,
    }


def run(config: Dict[str, Any], output_json: Path, output_csv: Path, limit: Optional[int] = None) -> Dict[str, Any]:
    universe = str(config.get("universe") or "clean")
    frequency = str(config.get("rebalance_frequency") or "monthly")
    start = str(config.get("as_of_start") or "").strip() or None
    end = str(config.get("as_of_end") or "").strip() or None
    entry_rules = ((config.get("entry") or {}).get("all") or []) if isinstance(config.get("entry"), dict) else []
    exclusions = config.get("exclusions") or []
    needs_valuation = _rules_need_valuation(entry_rules, exclusions)
    exit_cfg = config.get("exit") or {}
    max_hold_days = int(_safe_float(exit_cfg.get("max_hold_days")) or 180)
    stop_loss_pct = _safe_float(exit_cfg.get("stop_loss_pct"))
    trailing_stop_pct = _safe_float(exit_cfg.get("trailing_stop_pct"))
    take_profit_ladder = exit_cfg.get("take_profit_ladder_pct") or []
    benchmark = str(config.get("benchmark") or "SPY").strip().upper()
    top_n = int(_safe_float(config.get("top_n_per_date")) or 0)
    max_forward_bars = max_hold_days
    evidence_target_trades = int(_safe_float(config.get("evidence_target_trades")) or 0)
    if evidence_target_trades < 0:
        evidence_target_trades = 0

    explicit_symbols = _normalize_symbol_list(config.get("universe_symbols"))
    symbols = explicit_symbols or _load_universe_symbols(universe)
    config_limit = int(_safe_float(config.get("max_symbols")) or 0)
    effective_limit = limit if limit and limit > 0 else config_limit
    if effective_limit and effective_limit > 0:
        symbols = symbols[:effective_limit]

    bars_cache: Dict[str, List[Dict[str, Any]]] = {}
    conn = sqlite3.connect(DEFAULT_DB_PATH)
    evidence_stream_requested = bool(evidence_target_trades > 0 and top_n <= 0)
    if evidence_stream_requested:
        snapshots: List[Dict[str, Any]] = []
        use_snapshots = False
    else:
        snapshots = _select_rebalanced_snapshots(_load_snapshots(conn, symbols, start, end), frequency)
        snapshot_start = min((row["asof_date"] for row in snapshots), default=None)
        use_snapshots = bool(snapshots) and (not start or (snapshot_start is not None and start >= snapshot_start))
    historical_skipped = {"no_bars": 0, "no_facts": 0}
    data_source = "asof_symbol_snapshots" if use_snapshots else "pit_fundamental_facts"
    stream_historical_evidence = bool(evidence_stream_requested and not use_snapshots)
    if use_snapshots:
        observations = snapshots
    elif stream_historical_evidence:
        observations = []
    else:
        observations, historical_skipped = _load_historical_fact_observations(
            conn,
            symbols,
            bars_cache,
            frequency=frequency,
            start=start,
            end=end,
            max_forward_bars=max_forward_bars,
        )

    candidates: List[Dict[str, Any]] = []
    trades: List[Dict[str, Any]] = []
    skipped = {
        "no_bars": 0,
        "no_entry_bar": 0,
        "entry_rules": 0,
        "exclusions": 0,
        "no_exit": 0,
        "valuation_missing": 0,
        "historical_no_bars": historical_skipped.get("no_bars", 0),
        "historical_no_facts": historical_skipped.get("no_facts", 0),
    }
    evidence_candidate_rows_examined = 0
    evidence_candidate_symbols_examined: set[str] = set()
    evidence_symbols_with_trades: set[str] = set()
    evidence_observations_examined = 0
    evidence_symbols_processed = 0

    def write_evidence_progress(stage: str) -> None:
        if evidence_target_trades <= 0:
            return
        progress_path = output_json.with_suffix(".progress.json")
        payload = {
            "stage": stage,
            "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "target_trades": evidence_target_trades,
            "collected_trades": len(trades),
            "source_universe_size": len(symbols),
            "symbols_processed": evidence_symbols_processed,
            "observations_examined": evidence_observations_examined,
            "candidate_rows_examined": evidence_candidate_rows_examined,
            "candidate_symbols_examined": len(evidence_candidate_symbols_examined),
            "symbols_with_trades": len(evidence_symbols_with_trades),
        }
        try:
            progress_path.parent.mkdir(parents=True, exist_ok=True)
            progress_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception:
            pass

    def record_candidate_trade(row: Dict[str, Any]) -> None:
        evidence_candidate_symbols_examined.add(str(row["symbol"]).strip().upper())
        bars = bars_cache[row["symbol"]]
        exit_row = _simulate_exit(
            bars,
            int(row["entry_index"]),
            max_hold_days=max_hold_days,
            stop_loss_pct=stop_loss_pct,
            take_profit_ladder_pct=take_profit_ladder,
            trailing_stop_pct=trailing_stop_pct,
        )
        exit_index = exit_row.get("exit_index")
        exit_price = _safe_float(exit_row.get("exit_price"))
        entry_price = _safe_float(row.get("entry_price"))
        if exit_index is None or exit_price is None or entry_price in (None, 0):
            skipped["no_exit"] += 1
            return
        exit_date = bars[int(exit_index)]["date"]
        return_pct = ((exit_price - float(entry_price)) / float(entry_price)) * 100.0
        bench_return = _benchmark_return(benchmark, str(row["entry_date"]), exit_date)
        trades.append({
            "symbol": row["symbol"],
            "asof_date": row["asof_date"],
            "entry_date": row["entry_date"],
            "entry_price": round(float(entry_price), 4),
            "exit_date": exit_date,
            "exit_price": round(float(exit_price), 4),
            "exit_reason": exit_row.get("exit_reason"),
            "holding_days": int(exit_index) - int(row["entry_index"]),
            "return_pct": round(return_pct, 4),
            "benchmark_return_pct": round(bench_return, 4) if bench_return is not None else None,
            "beat_benchmark": (return_pct > bench_return) if bench_return is not None else None,
            **{f"metric_{key}": value for key, value in row["metrics"].items()},
        })
        evidence_symbols_with_trades.add(str(row["symbol"]).strip().upper())

    def evaluate_snapshot(snapshot: Dict[str, Any]) -> None:
        nonlocal evidence_observations_examined, evidence_candidate_rows_examined
        evidence_observations_examined += 1
        symbol = snapshot["symbol"]
        bars = bars_cache.get(symbol)
        if bars is None:
            bars = _load_bars(symbol)
            bars_cache[symbol] = bars
        if not bars:
            skipped["no_bars"] += 1
            return
        entry_index = snapshot.get("entry_index")
        if entry_index is None:
            entry_index = _find_bar_index_on_or_after(bars, snapshot["asof_date"])
        if entry_index is None:
            skipped["no_entry_bar"] += 1
            return
        entry_index = int(entry_index)
        metric_values = _metrics(
            snapshot["raw"],
            bars,
            entry_index,
            symbol=symbol,
            asof_date=snapshot["asof_date"],
            include_valuation=needs_valuation,
        )
        if needs_valuation and metric_values.get("dcf_gap_pct") is None:
            skipped["valuation_missing"] += 1
        if not _passes_entry(metric_values, entry_rules):
            skipped["entry_rules"] += 1
            return
        if not _passes_exclusions(metric_values, exclusions):
            skipped["exclusions"] += 1
            return
        row = {
            "symbol": symbol,
            "asof_date": snapshot["asof_date"],
            "entry_index": entry_index,
            "entry_date": bars[entry_index]["date"],
            "entry_price": _safe_float(bars[entry_index].get("close")),
            "metrics": metric_values,
        }
        candidates.append(row)
        if evidence_target_trades > 0:
            evidence_candidate_rows_examined += 1
            record_candidate_trade(row)

    if stream_historical_evidence:
        for symbol in symbols:
            if evidence_target_trades > 0 and len(trades) >= evidence_target_trades:
                break
            evidence_symbols_processed += 1
            if evidence_symbols_processed == 1 or evidence_symbols_processed % 100 == 0:
                print(
                    "[FundamentalBacktester] Evidence scan "
                    f"{evidence_symbols_processed}/{len(symbols)} symbols, "
                    f"{len(trades)}/{evidence_target_trades} trades...",
                    flush=True,
                )
                write_evidence_progress("scanning")
            bars = bars_cache.get(symbol)
            if bars is None:
                bars = _load_bars(symbol)
                bars_cache[symbol] = bars
            if not bars:
                skipped["historical_no_bars"] += 1
                continue
            for index in _select_rebalance_indices(
                bars,
                frequency,
                start=start,
                end=end,
                max_forward_bars=max_forward_bars,
            ):
                if evidence_target_trades > 0 and len(trades) >= evidence_target_trades:
                    break
                asof_date = str(bars[index]["date"])
                raw = _historical_raw_from_facts(conn, symbol, asof_date, bars, index)
                if raw is None:
                    skipped["historical_no_facts"] += 1
                    continue
                evaluate_snapshot({
                    "symbol": symbol,
                    "asof_date": asof_date,
                    "raw": raw,
                    "entry_index": index,
                    "source": "pit_fundamental_facts",
                })
    else:
        for snapshot in observations:
            evaluate_snapshot(snapshot)

    if top_n > 0:
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for row in candidates:
            grouped.setdefault(row["asof_date"], []).append(row)
        candidates = [
            row
            for date_rows in grouped.values()
            for row in sorted(
                date_rows,
                key=lambda item: (
                    _safe_float(item["metrics"].get("valuation_gap_pct")) or -999999,
                    _safe_float(item["metrics"].get("dollar_volume_20d")) or 0,
                ),
                reverse=True,
            )[:top_n]
        ]

    if not evidence_target_trades:
        for row in candidates:
            evidence_candidate_rows_examined += 1
            record_candidate_trade(row)

    write_evidence_progress("complete" if not evidence_target_trades or len(trades) >= evidence_target_trades else "exhausted")
    conn.close()

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    if trades:
        fieldnames = sorted({key for row in trades for key in row.keys()})
        with output_csv.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(trades)
    else:
        output_csv.write_text("", encoding="utf-8")

    summary = {
        "config": config,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "available_snapshot_range": {
            "start": min((row["asof_date"] for row in observations), default=None),
            "end": max((row["asof_date"] for row in observations), default=None),
        },
        "data_source": data_source,
        "universe_symbol_count": len(symbols),
        "snapshot_count": len(observations),
        "candidate_count": len(candidates),
        "evidence": {
            "mode": config.get("evidence_mode"),
            "target_trades": evidence_target_trades or None,
            "target_reached": bool(evidence_target_trades > 0 and len(trades) >= evidence_target_trades),
            "source_universe_size": config.get("evidence_source_universe_size") or len(symbols),
            "evaluated_symbols": len(symbols),
            "symbols_processed": evidence_symbols_processed or len(symbols),
            "observations_examined": evidence_observations_examined or len(observations),
            "candidate_rows_examined": evidence_candidate_rows_examined,
            "candidate_symbols_examined": len(evidence_candidate_symbols_examined),
            "symbols_with_trades": len(evidence_symbols_with_trades),
            "trades_per_candidate_symbol": round(len(trades) / len(evidence_candidate_symbols_examined), 4) if evidence_candidate_symbols_examined else 0,
            "trades_per_source_symbol": round(len(trades) / len(symbols), 4) if symbols else 0,
            "collected_trades": len(trades),
        },
        "skipped": skipped,
        "summary": _summarize(trades, benchmark),
        "top_trades": sorted(trades, key=lambda item: item.get("return_pct") or -999999, reverse=True)[:25],
        "bottom_trades": sorted(trades, key=lambda item: item.get("return_pct") or 999999)[:25],
        "files": {
            "summary_json": str(output_json),
            "observations_csv": str(output_csv),
        },
        "notes": [
            "Entry signals use asof_symbol_snapshots when they cover the requested range; otherwise they use historical PIT fundamental facts.",
            "Missing entry metrics fail the entry rule; missing exclusion metrics do not exclude a candidate.",
            "V1 exits use first take-profit rung, stop loss, trailing stop, then max hold.",
        ],
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a configurable PIT fundamental backtest.")
    parser.add_argument("--config", help="Path to JSON config from the Fundamental Backtester page.")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--output-csv", default=str(DEFAULT_OBSERVATIONS_PATH))
    parser.add_argument("--limit", type=int, default=None, help="Optional symbol limit for smoke tests.")
    args = parser.parse_args()

    config = _read_json(Path(args.config)) if args.config else {}
    if not isinstance(config, dict):
        raise SystemExit("Config JSON must be an object.")
    summary = run(config, Path(args.output_json), Path(args.output_csv), limit=args.limit)
    print(f"[FundamentalBacktester] Complete: {summary['summary']['trade_count']} trades from {summary['candidate_count']} candidates.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
