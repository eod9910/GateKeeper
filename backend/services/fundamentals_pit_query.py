#!/usr/bin/env python3
"""
Validator-facing PIT fundamentals queries and basket validation.
"""
from __future__ import annotations

import json
import math
import sqlite3
import statistics
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fundamentals_pit_store import DEFAULT_DB_PATH, connect as connect_pit, ensure_schema
from robustnessTests import parameter_sensitivity


def _parse_date(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    text = text[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except Exception:
        return None


def _safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _period_key(dt: datetime, frequency: str) -> Tuple[int, int]:
    if frequency == "quarterly":
        return (dt.year, ((dt.month - 1) // 3) + 1)
    return (dt.year, dt.month)


def _select_rebalance_dates(reference_bars: List[Dict[str, Any]], frequency: str, forward_bars: int) -> List[str]:
    dated = []
    for idx, bar in enumerate(reference_bars):
        dt = _parse_date(bar.get("timestamp"))
        if dt is None:
            continue
        dated.append((idx, dt, dt.date().isoformat()))
    if len(dated) <= forward_bars:
        return []

    out: List[str] = []
    current_bucket = None
    bucket_last_date = None
    bucket_last_index = None
    max_valid_index = len(dated) - 1 - forward_bars

    for idx, dt, iso_date in dated:
        bucket = _period_key(dt, frequency)
        if current_bucket is None:
            current_bucket = bucket
            bucket_last_date = iso_date
            bucket_last_index = idx
            continue
        if bucket != current_bucket:
            if bucket_last_index is not None and bucket_last_index <= max_valid_index:
                out.append(bucket_last_date)
            current_bucket = bucket
        bucket_last_date = iso_date
        bucket_last_index = idx

    if bucket_last_index is not None and bucket_last_index <= max_valid_index:
        out.append(bucket_last_date)
    return out


def _latest_metric_rows(conn: sqlite3.Connection, table: str, symbol: str, asof_date: str) -> Dict[str, float]:
    metric_col = "metric"
    value_col = "value_numeric"
    date_col = "available_at" if table == "pit_fundamental_facts" else "market_date"
    rows = conn.execute(
        f"""
        SELECT {metric_col} AS metric, {value_col} AS value, {date_col} AS asof_key
        FROM {table}
        WHERE symbol = ? AND {date_col} <= ?
        ORDER BY metric ASC, {date_col} DESC
        """,
        (symbol, asof_date),
    ).fetchall()
    out: Dict[str, float] = {}
    for row in rows:
        metric = str(row["metric"])
        if metric in out:
            continue
        value = _safe_float(row["value"])
        if value is None:
            continue
        out[metric] = value
    return out


def get_asof_snapshot(conn: sqlite3.Connection, symbol: str, asof_date: str) -> Dict[str, Any]:
    fundamentals = _latest_metric_rows(conn, "pit_fundamental_facts", symbol, asof_date)
    market = _latest_metric_rows(conn, "pit_market_facts", symbol, asof_date)
    snapshot = {}
    snapshot.update(fundamentals)
    snapshot.update(market)
    return snapshot


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def _statement_fact_rows(
    conn: sqlite3.Connection,
    symbol: str,
    asof_date: str,
    *,
    fact_keys: Optional[Sequence[str]] = None,
    period_type: Optional[str] = None,
    source_document: Optional[str] = None,
) -> List[sqlite3.Row]:
    clauses = ["symbol = ?", "available_at <= ?"]
    params: List[Any] = [symbol, asof_date]
    if fact_keys:
        keys = [str(item).strip() for item in fact_keys if str(item).strip()]
        if keys:
            placeholders = ", ".join("?" for _ in keys)
            clauses.append(f"fact_key IN ({placeholders})")
            params.extend(keys)
    if period_type:
        clauses.append("period_type = ?")
        params.append(str(period_type))
    if source_document:
        clauses.append("source_document = ?")
        params.append(str(source_document))
    where_sql = " AND ".join(clauses)
    return conn.execute(
        f"""
        SELECT *
        FROM pit_statement_facts
        WHERE {where_sql}
        ORDER BY fact_key ASC, period_end DESC, available_at DESC, filing_date DESC, updated_at DESC
        """,
        tuple(params),
    ).fetchall()


def get_facts(
    conn: sqlite3.Connection,
    symbol: str,
    fact_keys: Sequence[str],
    asof_date: str,
) -> Dict[str, Dict[str, Any]]:
    rows = _statement_fact_rows(conn, symbol, asof_date, fact_keys=fact_keys)
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        fact_key = str(row["fact_key"])
        if fact_key in out:
            continue
        out[fact_key] = _row_to_dict(row)
    return out


def get_statement_history(
    conn: sqlite3.Connection,
    symbol: str,
    period_type: str,
    asof_date: str,
    fact_keys: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    rows = _statement_fact_rows(conn, symbol, asof_date, fact_keys=fact_keys, period_type=period_type)
    out: List[Dict[str, Any]] = []
    seen = set()
    for row in rows:
        identity = (str(row["fact_key"]), str(row["period_end"]))
        if identity in seen:
            continue
        seen.add(identity)
        out.append(_row_to_dict(row))
    return out


def get_document_evidence(conn: sqlite3.Connection, symbol: str, accession_number: str) -> Dict[str, Any]:
    document_row = conn.execute(
        """
        SELECT *
        FROM pit_documents
        WHERE symbol = ? AND source_document = ?
        """,
        (symbol, accession_number),
    ).fetchone()
    fact_rows = _statement_fact_rows(
        conn,
        symbol,
        "9999-12-31",
        source_document=accession_number,
    )
    facts: List[Dict[str, Any]] = []
    for row in fact_rows:
        item = _row_to_dict(row)
        evidence_ref = item.get("evidence_ref")
        if isinstance(evidence_ref, str) and evidence_ref.strip().startswith("{"):
            try:
                item["evidence_ref"] = json.loads(evidence_ref)
            except Exception:
                pass
        facts.append(item)
    return {
        "document": _row_to_dict(document_row) if document_row else None,
        "facts": facts,
    }


def get_latest_available_facts(
    conn: sqlite3.Connection,
    symbol: str,
    *,
    period_type: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT MAX(available_at) AS max_available_at
        FROM pit_statement_facts
        WHERE symbol = ? AND (? IS NULL OR period_type = ?)
        """,
        (symbol, period_type, period_type),
    ).fetchone()
    max_available_at = row["max_available_at"] if row else None
    if not max_available_at:
        return {}
    rows = _statement_fact_rows(conn, symbol, str(max_available_at), period_type=period_type)
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        fact_key = str(row["fact_key"])
        if fact_key in out:
            continue
        out[fact_key] = _row_to_dict(row)
    return out


def _compare(value: float, operator: str, threshold: float) -> bool:
    if operator == ">=":
        return value >= threshold
    if operator == "<=":
        return value <= threshold
    if operator == ">":
        return value > threshold
    if operator == "<":
        return value < threshold
    if operator == "==":
        return value == threshold
    if operator == "!=":
        return value != threshold
    return False


def _screen_passes(snapshot: Dict[str, Any], variables: Sequence[Dict[str, Any]]) -> bool:
    for variable in variables:
        metric = str(variable.get("metric") or variable.get("key") or "").strip()
        operator = str(variable.get("operator") or ">=").strip()
        threshold = _safe_float(variable.get("threshold"))
        missing_policy = str(variable.get("missing_policy") or "fail").strip().lower()
        value = _safe_float(snapshot.get(metric))
        if value is None or threshold is None:
            if missing_policy == "pass":
                continue
            return False
        if not _compare(value, operator, threshold):
            return False
    return True


def _series_for_symbol(bars: List[Dict[str, Any]]) -> List[Tuple[str, float]]:
    out: List[Tuple[str, float]] = []
    for bar in bars:
        dt = _parse_date(bar.get("timestamp"))
        close = _safe_float(bar.get("close"))
        if dt is None or close is None or close <= 0:
            continue
        out.append((dt.date().isoformat(), close))
    return out


def _forward_return_pct(series: List[Tuple[str, float]], asof_date: str, forward_bars: int) -> Optional[float]:
    entry_idx = None
    for idx, (bar_date, _) in enumerate(series):
        if bar_date <= asof_date:
            entry_idx = idx
        else:
            break
    if entry_idx is None or entry_idx + forward_bars >= len(series):
        return None
    entry = series[entry_idx][1]
    exit_price = series[entry_idx + forward_bars][1]
    if entry <= 0:
        return None
    return ((exit_price - entry) / entry) * 100.0


def _price_at_or_before(series: List[Tuple[str, float]], asof_date: str) -> Optional[float]:
    price = None
    for bar_date, close in series:
        if bar_date <= asof_date:
            price = close
        else:
            break
    return price


def _bucket_metrics(period_returns: List[float]) -> Dict[str, Any]:
    if not period_returns:
        return {
            "periods": 0,
            "avg_forward_return_pct": 0.0,
            "median_forward_return_pct": 0.0,
            "win_rate": 0.0,
            "max_drawdown_pct": 0.0,
        }
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for ret_pct in period_returns:
        equity *= (1.0 + (ret_pct / 100.0))
        peak = max(peak, equity)
        dd = ((peak - equity) / peak) * 100.0 if peak > 0 else 0.0
        max_dd = max(max_dd, dd)
    return {
        "periods": len(period_returns),
        "avg_forward_return_pct": round(statistics.mean(period_returns), 4),
        "median_forward_return_pct": round(statistics.median(period_returns), 4),
        "win_rate": round(sum(1 for value in period_returns if value > 0) / len(period_returns), 4),
        "max_drawdown_pct": round(max_dd, 2),
    }


def _spread_metrics(selected_returns: List[float], excluded_returns: List[float]) -> Dict[str, Any]:
    pair_count = min(len(selected_returns), len(excluded_returns))
    spreads = [
        selected_returns[idx] - excluded_returns[idx]
        for idx in range(pair_count)
    ]
    if not spreads:
        return {
            "periods": 0,
            "avg_return_spread_pct": 0.0,
            "median_return_spread_pct": 0.0,
            "hit_rate": 0.0,
            "t_stat": 0.0,
        }
    mean_spread = statistics.mean(spreads)
    stdev = statistics.stdev(spreads) if len(spreads) > 1 else 0.0
    t_stat = (mean_spread / (stdev / math.sqrt(len(spreads)))) if stdev > 0 and len(spreads) > 1 else 0.0
    return {
        "periods": len(spreads),
        "avg_return_spread_pct": round(mean_spread, 4),
        "median_return_spread_pct": round(statistics.median(spreads), 4),
        "hit_rate": round(sum(1 for value in spreads if value > 0) / len(spreads), 4),
        "t_stat": round(t_stat, 4),
    }


def _nudge_threshold(base: float, factor: float) -> float:
    if base == 0:
        return 0.0
    return base * factor


def _run_basket_validation(
    conn: sqlite3.Connection,
    bars_by_symbol: Dict[str, List[Dict[str, Any]]],
    variables: Sequence[Dict[str, Any]],
    rebalance_frequency: str,
    forward_bars: int,
    min_selected_count: int,
    min_excluded_count: int,
) -> Dict[str, Any]:
    if not bars_by_symbol:
        return {
            "selected": _bucket_metrics([]),
            "excluded": _bucket_metrics([]),
            "spread": _spread_metrics([], []),
            "rebalance_dates": [],
        }

    symbol_series = {
        symbol: _series_for_symbol(bars)
        for symbol, bars in bars_by_symbol.items()
        if bars
    }
    if not symbol_series:
        return {
            "selected": _bucket_metrics([]),
            "excluded": _bucket_metrics([]),
            "spread": _spread_metrics([], []),
            "rebalance_dates": [],
        }

    reference_symbol = max(symbol_series.items(), key=lambda item: len(item[1]))[0]
    reference_bars = bars_by_symbol[reference_symbol]
    rebalance_dates = _select_rebalance_dates(reference_bars, rebalance_frequency, forward_bars)

    selected_period_returns: List[float] = []
    excluded_period_returns: List[float] = []
    usable_dates: List[str] = []

    for asof_date in rebalance_dates:
        selected_symbol_returns: List[float] = []
        excluded_symbol_returns: List[float] = []
        for symbol, series in symbol_series.items():
            snapshot = get_asof_snapshot(conn, symbol, asof_date)
            forward_return = _forward_return_pct(series, asof_date, forward_bars)
            if forward_return is None:
                continue
            if _screen_passes(snapshot, variables):
                selected_symbol_returns.append(forward_return)
            else:
                excluded_symbol_returns.append(forward_return)

        if len(selected_symbol_returns) < min_selected_count or len(excluded_symbol_returns) < min_excluded_count:
            continue

        selected_period_returns.append(statistics.mean(selected_symbol_returns))
        excluded_period_returns.append(statistics.mean(excluded_symbol_returns))
        usable_dates.append(asof_date)

    return {
        "selected": _bucket_metrics(selected_period_returns),
        "excluded": _bucket_metrics(excluded_period_returns),
        "spread": _spread_metrics(selected_period_returns, excluded_period_returns),
        "rebalance_dates": usable_dates,
    }


def run_valuation_state_validation(
    spec: Dict[str, Any],
    bars_by_symbol: Dict[str, List[Dict[str, Any]]],
    date_start: Optional[str] = None,
    date_end: Optional[str] = None,
) -> Dict[str, Any]:
    setup = (spec.get("setup_config") or {}) if isinstance(spec, dict) else {}
    if str(setup.get("pattern_type") or "").strip() != "valuation_state_primitive":
        return {"enabled": False, "status": "disabled"}

    try:
        from plugins.valuation_state_primitive import _valuation_signal_for_bar
    except Exception as exc:
        return {"enabled": True, "status": "error", "reason": f"Could not load valuation primitive: {exc}"}

    fundamental_cfg = (spec.get("fundamental_config") or {}) if isinstance(spec, dict) else {}
    target_state = str(setup.get("target_state") or "undervalued").strip().lower()
    if target_state == "fair":
        target_state = "roughly_fair"
    rebalance_frequency = str(fundamental_cfg.get("rebalance_frequency") or setup.get("rebalance_frequency") or "monthly").strip().lower()
    if rebalance_frequency not in {"monthly", "quarterly"}:
        rebalance_frequency = "monthly"
    forward_bars = max(1, int(fundamental_cfg.get("forward_bars") or setup.get("forward_bars") or 13))
    min_selected_count = max(1, int(fundamental_cfg.get("min_selected_count") or setup.get("min_selected_count") or 1))
    min_excluded_count = max(1, int(fundamental_cfg.get("min_excluded_count") or setup.get("min_excluded_count") or 1))
    gap_threshold_pct = float(setup.get("gap_threshold_pct", 20.0) or 20.0)

    symbol_series = {
        symbol: _series_for_symbol(bars)
        for symbol, bars in (bars_by_symbol or {}).items()
        if bars
    }
    if not symbol_series:
        return {"enabled": True, "status": "skipped", "reason": "No symbol bars available for valuation basket validation."}

    reference_symbol = max(symbol_series.items(), key=lambda item: len(item[1]))[0]
    reference_bars = bars_by_symbol[reference_symbol]
    rebalance_dates = _select_rebalance_dates(reference_bars, rebalance_frequency, forward_bars)
    if date_start or date_end:
        start_key = str(date_start or "").strip()[:10]
        end_key = str(date_end or "").strip()[:10]
        rebalance_dates = [
            asof_date
            for asof_date in rebalance_dates
            if (not start_key or asof_date >= start_key) and (not end_key or asof_date <= end_key)
        ]

    selected_period_returns: List[float] = []
    excluded_period_returns: List[float] = []
    usable_dates: List[str] = []
    selected_observations = 0
    excluded_observations = 0
    no_valuation_observations = 0
    period_details: List[Dict[str, Any]] = []

    for asof_date in rebalance_dates:
        selected_symbol_returns: List[float] = []
        excluded_symbol_returns: List[float] = []
        date_no_valuation = 0

        for symbol, series in symbol_series.items():
            current_price = _price_at_or_before(series, asof_date)
            forward_return = _forward_return_pct(series, asof_date, forward_bars)
            if current_price is None or forward_return is None:
                continue

            valuation = _valuation_signal_for_bar(symbol, asof_date, float(current_price), gap_threshold_pct)
            if not valuation:
                no_valuation_observations += 1
                date_no_valuation += 1
                continue

            valuation_state = str(valuation.get("valuation_state") or "").strip().lower()
            if valuation_state == target_state:
                selected_symbol_returns.append(forward_return)
            else:
                excluded_symbol_returns.append(forward_return)

        if len(selected_symbol_returns) < min_selected_count or len(excluded_symbol_returns) < min_excluded_count:
            continue

        selected_mean = statistics.mean(selected_symbol_returns)
        excluded_mean = statistics.mean(excluded_symbol_returns)
        selected_period_returns.append(selected_mean)
        excluded_period_returns.append(excluded_mean)
        selected_observations += len(selected_symbol_returns)
        excluded_observations += len(excluded_symbol_returns)
        usable_dates.append(asof_date)
        period_details.append({
            "asof_date": asof_date,
            "selected_count": len(selected_symbol_returns),
            "excluded_count": len(excluded_symbol_returns),
            "no_valuation_count": date_no_valuation,
            "selected_avg_forward_return_pct": round(selected_mean, 4),
            "excluded_avg_forward_return_pct": round(excluded_mean, 4),
            "spread_pct": round(selected_mean - excluded_mean, 4),
        })

    return {
        "enabled": True,
        "status": "completed" if usable_dates else "skipped",
        "reason": None if usable_dates else "No rebalance dates had enough selected and excluded valuation observations.",
        "mode": "valuation_state_basket",
        "config": {
            "rebalance_frequency": rebalance_frequency,
            "forward_bars": forward_bars,
            "date_start": date_start,
            "date_end": date_end,
            "comparison_mode": "selected_vs_excluded",
            "target_state": target_state,
            "gap_threshold_pct": gap_threshold_pct,
            "min_selected_count": min_selected_count,
            "min_excluded_count": min_excluded_count,
            "variables": [
                {
                    "metric": "valuation_state",
                    "label": "DCF Valuation State",
                    "operator": "==",
                    "threshold": target_state,
                }
            ],
        },
        "selected": _bucket_metrics(selected_period_returns),
        "excluded": _bucket_metrics(excluded_period_returns),
        "spread": _spread_metrics(selected_period_returns, excluded_period_returns),
        "rebalance_dates": usable_dates,
        "observations": {
            "selected": selected_observations,
            "excluded": excluded_observations,
            "no_valuation": no_valuation_observations,
            "symbols": len(symbol_series),
        },
        "period_details": period_details[-24:],
    }


def run_fundamental_validation(
    spec: Dict[str, Any],
    bars_by_symbol: Dict[str, List[Dict[str, Any]]],
    db_path: Optional[str] = None,
) -> Dict[str, Any]:
    cfg = (spec.get("fundamental_config") or {}) if isinstance(spec, dict) else {}
    if not cfg or cfg.get("enabled") is not True:
        return {"enabled": False, "status": "disabled"}

    variables = list(cfg.get("variables") or [])
    if not variables:
        return {"enabled": True, "status": "skipped", "reason": "No fundamental variables configured."}

    rebalance_frequency = str(cfg.get("rebalance_frequency") or "quarterly").strip().lower()
    if rebalance_frequency not in {"monthly", "quarterly"}:
        rebalance_frequency = "quarterly"

    forward_bars = max(1, int(cfg.get("forward_bars") or 63))
    min_selected_count = max(1, int(cfg.get("min_selected_count") or 3))
    min_excluded_count = max(1, int(cfg.get("min_excluded_count") or 3))

    conn = connect_pit(db_path or DEFAULT_DB_PATH)
    ensure_schema(conn)

    baseline = _run_basket_validation(
        conn,
        bars_by_symbol=bars_by_symbol,
        variables=variables,
        rebalance_frequency=rebalance_frequency,
        forward_bars=forward_bars,
        min_selected_count=min_selected_count,
        min_excluded_count=min_excluded_count,
    )
    base_spread = float((baseline.get("spread") or {}).get("avg_return_spread_pct") or 0.0)

    sensitivity_params = [
        str(variable.get("metric") or variable.get("key") or "")
        for variable in variables
        if str(variable.get("metric") or variable.get("key") or "")
    ]
    variable_map = {
        str(variable.get("metric") or variable.get("key") or ""): variable
        for variable in variables
        if str(variable.get("metric") or variable.get("key") or "")
    }

    def rerun_with_nudge(metric_key: str, factor: float) -> float:
        nudged = []
        for variable in variables:
            current = dict(variable)
            key = str(current.get("metric") or current.get("key") or "")
            if key == metric_key:
                threshold = _safe_float(current.get("threshold"))
                if threshold is not None:
                    current["threshold"] = _nudge_threshold(threshold, factor)
            nudged.append(current)
        result = _run_basket_validation(
            conn,
            bars_by_symbol=bars_by_symbol,
            variables=nudged,
            rebalance_frequency=rebalance_frequency,
            forward_bars=forward_bars,
            min_selected_count=min_selected_count,
            min_excluded_count=min_excluded_count,
        )
        return float((result.get("spread") or {}).get("avg_return_spread_pct") or 0.0)

    sensitivity = parameter_sensitivity(base_spread, rerun_with_nudge, params=sensitivity_params)
    conn.close()

    return {
        "enabled": True,
        "status": "completed",
        "config": {
            "rebalance_frequency": rebalance_frequency,
            "forward_bars": forward_bars,
            "comparison_mode": "selected_vs_excluded",
            "variables": [
                {
                    "metric": str(variable_map[key].get("metric") or variable_map[key].get("key") or ""),
                    "label": str(variable_map[key].get("label") or key),
                    "operator": str(variable_map[key].get("operator") or ">="),
                    "threshold": _safe_float(variable_map[key].get("threshold")),
                }
                for key in sensitivity_params
            ],
        },
        "selected": baseline["selected"],
        "excluded": baseline["excluded"],
        "spread": baseline["spread"],
        "sensitivity": sensitivity,
        "rebalance_dates": baseline["rebalance_dates"],
    }

