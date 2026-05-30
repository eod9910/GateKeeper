#!/usr/bin/env python3
from __future__ import annotations

"""
Point-in-time valuation-gap accuracy study.

This is the smallest serious research slice for Ledger valuation:

1. Build a standardized DCF from only data available on each as-of date
2. Compare fair value midpoint to the as-of market price
3. Bucket the name as undervalued / roughly_fair / overvalued
4. Measure whether price later moved in the implied direction
5. Measure whether price reached the fair-value target within the horizon

The study is intentionally narrow:
- it does not use note-level RAG signals
- it does not use LLM reasoning at runtime
- it does not try to estimate expectancy yet

It answers the first question only:
- is a PIT valuation gap directionally informative at all?
"""

import argparse
import csv
import json
import math
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_DIR = DATA_DIR / "universe"
DEFAULT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"
DEFAULT_OUTPUT_PATH = DATA_DIR / "research" / "valuation_gap_accuracy_summary.json"
MARKET_CAP_SNAPSHOT_PATH = DATA_DIR / "market_cap_snapshot.json"

sys.path.insert(0, str(SERVICES_DIR))

from fundamentals_pit_query import connect_pit, ensure_schema, get_asof_snapshot, get_statement_history  # noqa: E402
from universe_registry import load_universe_symbols  # noqa: E402


DCF_FACT_KEYS = (
    "revenue",
    "operating_income",
    "net_income",
    "operating_cash_flow",
    "capital_expenditures",
    "free_cash_flow",
    "current_assets",
    "current_liabilities",
)


@dataclass
class StudyObservation:
    symbol: str
    asof_date: str
    rebalance_frequency: str
    price: float
    fair_value_mid: float
    fair_value_low: float
    fair_value_high: float
    valuation_gap_pct: float
    valuation_state: str
    coverage_mode: str
    revenue: float
    free_cash_flow: float
    shares_outstanding: float
    revenue_growth_pct: Optional[float]
    operating_margin_pct: Optional[float]
    free_cash_flow_margin_pct: Optional[float]
    current_ratio: Optional[float]
    quality_grade: str
    quality_score: int
    horizon_returns: Dict[int, Optional[float]]
    horizon_hit_target: Dict[int, Optional[bool]]


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
        return float(value)
    except Exception:
        return None


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _interpolate(start: float, end: float, ratio: float) -> float:
    return start + (end - start) * ratio


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _dedupe(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        symbol = _normalize_symbol(value)
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
    return out


def _load_symbols(args: argparse.Namespace) -> List[str]:
    requested: List[str] = []
    if args.symbols:
        requested.extend(item.strip() for item in args.symbols.split(","))
    elif args.universe:
        requested.extend(load_universe_symbols(str(args.universe).strip()))
    else:
        requested.extend(load_universe_symbols("clean_stocks"))
    symbols = _dedupe(requested)
    if args.cap_tier:
        symbols = _filter_symbols_by_cap_tier(symbols, str(args.cap_tier).strip().lower())
    if args.limit and args.limit > 0:
        symbols = symbols[: args.limit]
    return symbols


def _load_market_cap_snapshot() -> Dict[str, float]:
    if not MARKET_CAP_SNAPSHOT_PATH.exists():
        return {}
    try:
        payload = json.loads(MARKET_CAP_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

    out: Dict[str, float] = {}
    for symbol, raw_value in (payload or {}).items():
        normalized = _normalize_symbol(symbol)
        value = _safe_float(raw_value)
        if not normalized or value is None or value <= 0:
            continue
        out[normalized] = value
    return out


def _cap_tier_matches(market_cap: float, cap_tier: str) -> bool:
    if cap_tier == "micro":
        return market_cap < 300_000_000
    if cap_tier == "small":
        return 300_000_000 <= market_cap < 2_000_000_000
    if cap_tier == "mid":
        return 2_000_000_000 <= market_cap < 10_000_000_000
    if cap_tier == "large":
        return market_cap >= 10_000_000_000
    return True


def _filter_symbols_by_cap_tier(symbols: Sequence[str], cap_tier: str) -> List[str]:
    snapshot = _load_market_cap_snapshot()
    return [
        symbol
        for symbol in symbols
        if symbol in snapshot and _cap_tier_matches(float(snapshot[symbol]), cap_tier)
    ]


def _get_universe_csv_path(symbol: str) -> Path:
    safe = symbol.replace("/", "_").replace("=", "_").replace("-", "_")
    return UNIVERSE_DIR / f"{safe}_1d.csv"


def _load_daily_bars(symbol: str) -> List[Dict[str, Any]]:
    path = _get_universe_csv_path(symbol)
    if not path.exists():
        return []

    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            dt = _parse_date(row.get("Date") or row.get("date") or row.get("timestamp"))
            if dt is None:
                continue
            close = _safe_float(row.get("Close") or row.get("close"))
            high = _safe_float(row.get("High") or row.get("high"))
            low = _safe_float(row.get("Low") or row.get("low"))
            open_price = _safe_float(row.get("Open") or row.get("open"))
            if close is None or high is None or low is None:
                continue
            rows.append(
                {
                    "date": dt.date().isoformat(),
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": _safe_float(row.get("Volume") or row.get("volume")),
                }
            )
    rows.sort(key=lambda item: item["date"])
    return rows


def _period_key(dt: datetime, frequency: str) -> Tuple[int, int]:
    if frequency == "quarterly":
        return (dt.year, ((dt.month - 1) // 3) + 1)
    return (dt.year, dt.month)


def _select_rebalance_dates(bars: List[Dict[str, Any]], frequency: str, max_forward_bars: int) -> List[int]:
    dated: List[Tuple[int, datetime, str]] = []
    for idx, bar in enumerate(bars):
        dt = _parse_date(bar.get("date"))
        if dt is None:
            continue
        dated.append((idx, dt, dt.date().isoformat()))
    if len(dated) <= max_forward_bars:
        return []

    out: List[int] = []
    current_bucket = None
    bucket_last_index: Optional[int] = None
    max_valid_index = len(dated) - 1 - max_forward_bars

    for idx, dt, _ in dated:
        bucket = _period_key(dt, frequency)
        if current_bucket is None:
            current_bucket = bucket
            bucket_last_index = idx
            continue
        if bucket != current_bucket:
            if bucket_last_index is not None and bucket_last_index <= max_valid_index:
                out.append(bucket_last_index)
            current_bucket = bucket
        bucket_last_index = idx

    if bucket_last_index is not None and bucket_last_index <= max_valid_index:
        out.append(bucket_last_index)
    return out


def _group_annual_periods(rows: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_period: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        period_end = str(row.get("period_end") or "").strip()
        if not period_end:
            continue
        bucket = by_period.setdefault(
            period_end,
            {
                "period_end": period_end,
                "filing_date": row.get("filing_date"),
                "available_at": row.get("available_at"),
                "metrics": {},
            },
        )
        fact_key = str(row.get("fact_key") or "").strip()
        if not fact_key:
            continue
        bucket["metrics"][fact_key] = _safe_float(row.get("value_numeric"))
    return sorted(by_period.values(), key=lambda item: item["period_end"], reverse=True)


def _safe_divide(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def _classify_cash_conversion(ratio: Optional[float]) -> Tuple[str, int]:
    if ratio is None:
        return ("unknown", 45)
    if ratio >= 1.2:
        return ("strong", 85)
    if ratio >= 0.9:
        return ("acceptable", 70)
    if ratio >= 0.6:
        return ("soft", 50)
    return ("weak", 25)


def _classify_capex_burden(capex_to_ocf_pct: Optional[float]) -> Tuple[str, int]:
    if capex_to_ocf_pct is None:
        return ("unknown", 50)
    if capex_to_ocf_pct <= 35:
        return ("light", 85)
    if capex_to_ocf_pct <= 65:
        return ("moderate", 65)
    if capex_to_ocf_pct <= 90:
        return ("heavy", 40)
    return ("very_heavy", 20)


def _classify_free_cash_flow(fcf_margin_pct: Optional[float]) -> Tuple[str, int]:
    if fcf_margin_pct is None:
        return ("unknown", 50)
    if fcf_margin_pct >= 10:
        return ("strong", 80)
    if fcf_margin_pct >= 5:
        return ("positive", 65)
    if fcf_margin_pct >= 0:
        return ("thin", 45)
    return ("negative", 20)


def _build_quality_grade(
    net_income: Optional[float],
    operating_cash_flow: Optional[float],
    free_cash_flow: Optional[float],
    capital_expenditures: Optional[float],
    revenue: Optional[float],
) -> Tuple[str, int, Optional[float], Optional[float], Optional[float]]:
    cash_conversion_ratio = _safe_divide(operating_cash_flow, net_income)
    capex_to_ocf_pct = (
        (capital_expenditures / operating_cash_flow) * 100.0
        if operating_cash_flow not in (None, 0) and capital_expenditures is not None
        else None
    )
    fcf_margin_pct = (
        (free_cash_flow / revenue) * 100.0
        if revenue not in (None, 0) and free_cash_flow is not None
        else None
    )

    cash_score = _classify_cash_conversion(cash_conversion_ratio)[1]
    capex_score = _classify_capex_burden(capex_to_ocf_pct)[1]
    fcf_score = _classify_free_cash_flow(fcf_margin_pct)[1]
    normalized_score = max(0, min(100, round((cash_score + capex_score + fcf_score) / 3)))

    if normalized_score >= 75:
        grade = "high"
    elif normalized_score >= 60:
        grade = "good"
    elif normalized_score >= 45:
        grade = "mixed"
    else:
        grade = "weak"

    return grade, normalized_score, cash_conversion_ratio, capex_to_ocf_pct, fcf_margin_pct


def _quality_factor(grade: str) -> float:
    if grade == "high":
        return 1.0
    if grade == "good":
        return 0.95
    if grade == "mixed":
        return 0.85
    return 0.7


def _build_standardized_dcf(
    snapshot: Dict[str, Any],
    latest_annual: Dict[str, Any],
    prior_annual: Optional[Dict[str, Any]],
    current_price: float,
) -> Optional[Dict[str, Any]]:
    metrics = latest_annual.get("metrics") or {}
    prior_metrics = (prior_annual or {}).get("metrics") or {}

    annual_revenue = _safe_float(metrics.get("revenue"))
    operating_income = _safe_float(metrics.get("operating_income"))
    net_income = _safe_float(metrics.get("net_income"))
    operating_cash_flow = _safe_float(metrics.get("operating_cash_flow"))
    capital_expenditures = _safe_float(metrics.get("capital_expenditures"))
    free_cash_flow = _safe_float(metrics.get("free_cash_flow"))
    if free_cash_flow is None and operating_cash_flow is not None and capital_expenditures is not None:
        free_cash_flow = operating_cash_flow - capital_expenditures

    shares_outstanding = _safe_float(snapshot.get("sharesOutstanding"))
    if shares_outstanding is None or shares_outstanding <= 0:
        return None

    if annual_revenue is None or free_cash_flow is None:
        return None

    prior_revenue = _safe_float(prior_metrics.get("revenue"))
    revenue_growth_pct = None
    if annual_revenue not in (None, 0) and prior_revenue not in (None, 0):
        revenue_growth_pct = ((annual_revenue / prior_revenue) - 1.0) * 100.0

    operating_margin_pct = None
    if annual_revenue not in (None, 0) and operating_income is not None:
        operating_margin_pct = (operating_income / annual_revenue) * 100.0

    current_ratio = _safe_float(snapshot.get("currentRatio"))
    if current_ratio is None:
        current_assets = _safe_float(metrics.get("current_assets"))
        current_liabilities = _safe_float(metrics.get("current_liabilities"))
        current_ratio = _safe_divide(current_assets, current_liabilities)

    quality_grade, quality_score, _, _, current_fcf_margin_pct = _build_quality_grade(
        net_income=net_income,
        operating_cash_flow=operating_cash_flow,
        free_cash_flow=free_cash_flow,
        capital_expenditures=capital_expenditures,
        revenue=annual_revenue,
    )

    if operating_margin_pct is None:
        operating_margin_pct = _safe_float(snapshot.get("operatingMarginPct"))

    quality_factor = _quality_factor(quality_grade)
    normalized_fcf = free_cash_flow * quality_factor
    if normalized_fcf is None:
        return None

    conversion_ratio = (
        _clamp(current_fcf_margin_pct / operating_margin_pct, 0.25, 0.85)
        if current_fcf_margin_pct is not None and operating_margin_pct not in (None, 0)
        else 0.5
    )

    base_near_term_growth_pct = _clamp((revenue_growth_pct or 8.0) * 0.7 if revenue_growth_pct is not None else 8.0, 1.0, 25.0)
    base_target_operating_margin_pct = _clamp(
        max((operating_margin_pct or 0.0) + 3.0, 10.0) if operating_margin_pct is not None else 12.0,
        4.0,
        35.0,
    )
    base_target_fcf_margin_pct = _clamp(
        base_target_operating_margin_pct * max(conversion_ratio, 0.55),
        2.0,
        max(4.0, base_target_operating_margin_pct),
    )

    discount_rate_pct = _clamp(
        9.0
        + (2.0 if quality_grade == "weak" else 1.0 if quality_grade == "mixed" else 0.0)
        + (1.0 if current_ratio is not None and current_ratio < 1.0 else 0.0),
        8.0,
        14.0,
    )
    terminal_growth_pct = 3.0
    forecast_years = 7

    scenarios = [
        {
            "name": "bear",
            "revenue_growth_pct": _clamp(base_near_term_growth_pct - 4.0, 0.5, 20.0),
            "target_fcf_margin_pct": _clamp(base_target_fcf_margin_pct - 1.5, 1.0, 20.0),
            "discount_rate_pct": _clamp(discount_rate_pct + 1.0, 6.0, 18.0),
            "terminal_growth_pct": _clamp(terminal_growth_pct - 0.5, 1.0, 5.0),
        },
        {
            "name": "base",
            "revenue_growth_pct": base_near_term_growth_pct,
            "target_fcf_margin_pct": base_target_fcf_margin_pct,
            "discount_rate_pct": discount_rate_pct,
            "terminal_growth_pct": terminal_growth_pct,
        },
        {
            "name": "bull",
            "revenue_growth_pct": _clamp(base_near_term_growth_pct + 4.0, 1.0, 28.0),
            "target_fcf_margin_pct": _clamp(base_target_fcf_margin_pct + 1.5, 2.0, 24.0),
            "discount_rate_pct": _clamp(discount_rate_pct - 1.0, 6.0, 18.0),
            "terminal_growth_pct": _clamp(terminal_growth_pct + 0.5, 1.0, 5.0),
        },
    ]

    fair_values: Dict[str, float] = {}
    for scenario in scenarios:
        revenue = annual_revenue
        pv_of_cash_flows = 0.0

        for year in range(1, forecast_years + 1):
            fade_ratio = (year - 1) / (forecast_years - 1) if forecast_years > 1 else 1.0
            growth_pct = _interpolate(scenario["revenue_growth_pct"], scenario["terminal_growth_pct"], fade_ratio)
            start_margin = current_fcf_margin_pct if current_fcf_margin_pct is not None else scenario["target_fcf_margin_pct"] * 0.7
            fcf_margin_pct = _interpolate(start_margin, scenario["target_fcf_margin_pct"], year / forecast_years)
            revenue = revenue * (1.0 + growth_pct / 100.0)
            free_cash_flow_year = revenue * (fcf_margin_pct / 100.0)
            discount_factor = math.pow(1.0 + scenario["discount_rate_pct"] / 100.0, year)
            pv_of_cash_flows += free_cash_flow_year / discount_factor

        terminal_cash_flow = free_cash_flow_year * (1.0 + scenario["terminal_growth_pct"] / 100.0)
        spread = scenario["discount_rate_pct"] - scenario["terminal_growth_pct"]
        if spread <= 0.5:
            return None
        terminal_value = terminal_cash_flow / (spread / 100.0)
        pv_terminal = terminal_value / math.pow(1.0 + scenario["discount_rate_pct"] / 100.0, forecast_years)
        equity_value = pv_of_cash_flows + pv_terminal
        fair_values[scenario["name"]] = equity_value / shares_outstanding

    fair_value_mid = fair_values["base"]
    valuation_gap_pct = ((fair_value_mid - current_price) / current_price) * 100.0 if current_price > 0 else 0.0

    return {
        "fair_value_low": fair_values["bear"],
        "fair_value_mid": fair_value_mid,
        "fair_value_high": fair_values["bull"],
        "valuation_gap_pct": valuation_gap_pct,
        "revenue": annual_revenue,
        "free_cash_flow": free_cash_flow,
        "shares_outstanding": shares_outstanding,
        "revenue_growth_pct": revenue_growth_pct,
        "operating_margin_pct": operating_margin_pct,
        "free_cash_flow_margin_pct": current_fcf_margin_pct,
        "current_ratio": current_ratio,
        "quality_grade": quality_grade,
        "quality_score": quality_score,
    }


def _valuation_state(gap_pct: float, threshold_pct: float) -> str:
    if gap_pct >= threshold_pct:
        return "undervalued"
    if gap_pct <= -threshold_pct:
        return "overvalued"
    return "roughly_fair"


def _forward_return_pct(bars: List[Dict[str, Any]], asof_index: int, horizon: int) -> Optional[float]:
    if asof_index < 0 or asof_index + horizon >= len(bars):
        return None
    entry = _safe_float(bars[asof_index]["close"])
    exit_price = _safe_float(bars[asof_index + horizon]["close"])
    if entry in (None, 0) or exit_price is None:
        return None
    return ((exit_price - entry) / entry) * 100.0


def _hit_target(
    bars: List[Dict[str, Any]],
    asof_index: int,
    horizon: int,
    fair_value: float,
    valuation_state: str,
) -> Optional[bool]:
    if asof_index < 0 or asof_index + horizon >= len(bars):
        return None
    window = bars[asof_index + 1 : asof_index + horizon + 1]
    if valuation_state == "undervalued":
        return any((_safe_float(bar.get("high")) or float("-inf")) >= fair_value for bar in window)
    if valuation_state == "overvalued":
        return any((_safe_float(bar.get("low")) or float("inf")) <= fair_value for bar in window)
    return None


def _coverage_mode(latest_annual: Dict[str, Any], snapshot: Dict[str, Any]) -> str:
    source_types = {
        str((latest_annual.get("metrics") or {}).get(key) or "")
        for key in ()
    }
    if latest_annual.get("available_at"):
        return "pit_statement_backed"
    if snapshot:
        return "vendor_snapshot_only"
    return "insufficient"


def _evaluate_symbol(
    conn: Any,
    symbol: str,
    bars: List[Dict[str, Any]],
    *,
    rebalance_frequency: str,
    start_date: Optional[str],
    end_date: Optional[str],
    gap_threshold_pct: float,
    horizons: Sequence[int],
) -> List[StudyObservation]:
    observations: List[StudyObservation] = []
    max_forward_bars = max(horizons)
    rebalance_indices = _select_rebalance_dates(bars, rebalance_frequency, max_forward_bars)

    start_dt = _parse_date(start_date) if start_date else None
    end_dt = _parse_date(end_date) if end_date else None

    for index in rebalance_indices:
        bar = bars[index]
        asof_date = str(bar["date"])
        asof_dt = _parse_date(asof_date)
        if asof_dt is None:
            continue
        if start_dt and asof_dt < start_dt:
            continue
        if end_dt and asof_dt > end_dt:
            continue

        price = _safe_float(bar["close"])
        if price in (None, 0):
            continue

        snapshot = get_asof_snapshot(conn, symbol, asof_date)
        annual_rows = get_statement_history(conn, symbol, "annual", asof_date, fact_keys=DCF_FACT_KEYS)
        annual_periods = _group_annual_periods(annual_rows)
        if not annual_periods:
            continue

        latest_annual = annual_periods[0]
        prior_annual = annual_periods[1] if len(annual_periods) > 1 else None
        dcf = _build_standardized_dcf(snapshot, latest_annual, prior_annual, price)
        if not dcf:
            continue

        valuation_state = _valuation_state(float(dcf["valuation_gap_pct"]), gap_threshold_pct)
        horizon_returns = {h: _forward_return_pct(bars, index, h) for h in horizons}
        horizon_hit_target = {
            h: _hit_target(bars, index, h, float(dcf["fair_value_mid"]), valuation_state)
            for h in horizons
        }

        observations.append(
            StudyObservation(
                symbol=symbol,
                asof_date=asof_date,
                rebalance_frequency=rebalance_frequency,
                price=float(price),
                fair_value_mid=float(dcf["fair_value_mid"]),
                fair_value_low=float(dcf["fair_value_low"]),
                fair_value_high=float(dcf["fair_value_high"]),
                valuation_gap_pct=float(dcf["valuation_gap_pct"]),
                valuation_state=valuation_state,
                coverage_mode="pit_statement_backed",
                revenue=float(dcf["revenue"]),
                free_cash_flow=float(dcf["free_cash_flow"]),
                shares_outstanding=float(dcf["shares_outstanding"]),
                revenue_growth_pct=_safe_float(dcf["revenue_growth_pct"]),
                operating_margin_pct=_safe_float(dcf["operating_margin_pct"]),
                free_cash_flow_margin_pct=_safe_float(dcf["free_cash_flow_margin_pct"]),
                current_ratio=_safe_float(dcf["current_ratio"]),
                quality_grade=str(dcf["quality_grade"]),
                quality_score=int(dcf["quality_score"]),
                horizon_returns=horizon_returns,
                horizon_hit_target=horizon_hit_target,
            )
        )

    return observations


def _directionally_correct(state: str, forward_return_pct: Optional[float]) -> Optional[bool]:
    if forward_return_pct is None:
        return None
    if state == "undervalued":
        return forward_return_pct > 0
    if state == "overvalued":
        return forward_return_pct < 0
    return None


def _signal_return_pct(state: str, forward_return_pct: Optional[float]) -> Optional[float]:
    if forward_return_pct is None:
        return None
    if state == "undervalued":
        return forward_return_pct
    if state == "overvalued":
        return -forward_return_pct
    return None


def _summarize_bucket(observations: Sequence[StudyObservation], horizon: int, state: str) -> Dict[str, Any]:
    subset = [obs for obs in observations if obs.valuation_state == state]
    returns = [obs.horizon_returns[horizon] for obs in subset if obs.horizon_returns[horizon] is not None]
    signal_returns = [
        _signal_return_pct(obs.valuation_state, obs.horizon_returns[horizon])
        for obs in subset
        if _signal_return_pct(obs.valuation_state, obs.horizon_returns[horizon]) is not None
    ]
    correct_flags = [
        _directionally_correct(obs.valuation_state, obs.horizon_returns[horizon])
        for obs in subset
        if _directionally_correct(obs.valuation_state, obs.horizon_returns[horizon]) is not None
    ]
    target_flags = [obs.horizon_hit_target[horizon] for obs in subset if obs.horizon_hit_target[horizon] is not None]

    return {
        "observations": len(subset),
        "usable_returns": len(returns),
        "avg_forward_return_pct": round(statistics.mean(returns), 4) if returns else None,
        "median_forward_return_pct": round(statistics.median(returns), 4) if returns else None,
        "avg_signal_return_pct": round(statistics.mean(signal_returns), 4) if signal_returns else None,
        "median_signal_return_pct": round(statistics.median(signal_returns), 4) if signal_returns else None,
        "directional_accuracy": round(sum(1 for flag in correct_flags if flag) / len(correct_flags), 4) if correct_flags else None,
        "hit_fair_value_rate": round(sum(1 for flag in target_flags if flag) / len(target_flags), 4) if target_flags else None,
    }


def _summarize_signal_strategy(observations: Sequence[StudyObservation], horizon: int) -> Dict[str, Any]:
    signal_rows = [
        (obs, _signal_return_pct(obs.valuation_state, obs.horizon_returns[horizon]))
        for obs in observations
        if obs.valuation_state in {"undervalued", "overvalued"}
    ]
    usable = [(obs, ret) for obs, ret in signal_rows if ret is not None]
    returns = [float(ret) for _, ret in usable if ret is not None]
    wins = [ret > 0 for ret in returns]
    long_returns = [float(ret) for obs, ret in usable if obs.valuation_state == "undervalued" and ret is not None]
    short_returns = [float(ret) for obs, ret in usable if obs.valuation_state == "overvalued" and ret is not None]

    return {
        "rule": "long undervalued, short overvalued, skip roughly_fair",
        "signals": len(signal_rows),
        "usable_signals": len(usable),
        "long_signals": sum(1 for obs, _ in usable if obs.valuation_state == "undervalued"),
        "short_signals": sum(1 for obs, _ in usable if obs.valuation_state == "overvalued"),
        "win_rate": round(sum(1 for flag in wins if flag) / len(wins), 4) if wins else None,
        "expectancy_pct_per_signal": round(statistics.mean(returns), 4) if returns else None,
        "median_return_pct_per_signal": round(statistics.median(returns), 4) if returns else None,
        "avg_long_return_pct": round(statistics.mean(long_returns), 4) if long_returns else None,
        "avg_short_return_pct": round(statistics.mean(short_returns), 4) if short_returns else None,
        "gross_equal_weight_return_pct": round(sum(returns), 4) if returns else None,
    }


def _summarize_study(
    observations: Sequence[StudyObservation],
    *,
    horizons: Sequence[int],
    symbols_requested: int,
    symbols_with_observations: int,
    args: argparse.Namespace,
) -> Dict[str, Any]:
    overall_by_state = {
        state: sum(1 for obs in observations if obs.valuation_state == state)
        for state in ("undervalued", "roughly_fair", "overvalued")
    }

    horizon_summary: Dict[str, Any] = {}
    for horizon in horizons:
        by_state = {
            state: _summarize_bucket(observations, horizon, state)
            for state in ("undervalued", "overvalued", "roughly_fair")
        }
        directional_flags = [
            _directionally_correct(obs.valuation_state, obs.horizon_returns[horizon])
            for obs in observations
            if obs.valuation_state in {"undervalued", "overvalued"}
            and _directionally_correct(obs.valuation_state, obs.horizon_returns[horizon]) is not None
        ]
        horizon_summary[str(horizon)] = {
            "combined_directional_accuracy": round(
                sum(1 for flag in directional_flags if flag) / len(directional_flags),
                4,
            ) if directional_flags else None,
            "signal_strategy": _summarize_signal_strategy(observations, horizon),
            "by_state": by_state,
        }

    valuation_gaps = [obs.valuation_gap_pct for obs in observations]
    return {
        "study": {
            "name": "pit_valuation_gap_accuracy",
            "rebalance_frequency": args.frequency,
            "gap_threshold_pct": args.gap_threshold_pct,
            "horizons": list(horizons),
            "start_date": args.start_date or None,
            "end_date": args.end_date or None,
            "universe": args.universe,
            "cap_tier": args.cap_tier or None,
            "symbols_requested": symbols_requested,
            "symbols_with_observations": symbols_with_observations,
            "observation_count": len(observations),
        },
        "coverage": {
            "valuation_state_counts": overall_by_state,
            "median_valuation_gap_pct": round(statistics.median(valuation_gaps), 4) if valuation_gaps else None,
        },
        "accuracy": horizon_summary,
    }


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def _write_csv(path: Path, observations: Sequence[StudyObservation], horizons: Sequence[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "symbol",
        "asof_date",
        "rebalance_frequency",
        "price",
        "fair_value_mid",
        "fair_value_low",
        "fair_value_high",
        "valuation_gap_pct",
        "valuation_state",
        "coverage_mode",
        "revenue",
        "free_cash_flow",
        "shares_outstanding",
        "revenue_growth_pct",
        "operating_margin_pct",
        "free_cash_flow_margin_pct",
        "current_ratio",
        "quality_grade",
        "quality_score",
    ]
    for horizon in horizons:
        fieldnames.append(f"forward_return_{horizon}d_pct")
        fieldnames.append(f"hit_fair_value_{horizon}d")

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for obs in observations:
            row = {
                "symbol": obs.symbol,
                "asof_date": obs.asof_date,
                "rebalance_frequency": obs.rebalance_frequency,
                "price": obs.price,
                "fair_value_mid": obs.fair_value_mid,
                "fair_value_low": obs.fair_value_low,
                "fair_value_high": obs.fair_value_high,
                "valuation_gap_pct": obs.valuation_gap_pct,
                "valuation_state": obs.valuation_state,
                "coverage_mode": obs.coverage_mode,
                "revenue": obs.revenue,
                "free_cash_flow": obs.free_cash_flow,
                "shares_outstanding": obs.shares_outstanding,
                "revenue_growth_pct": obs.revenue_growth_pct,
                "operating_margin_pct": obs.operating_margin_pct,
                "free_cash_flow_margin_pct": obs.free_cash_flow_margin_pct,
                "current_ratio": obs.current_ratio,
                "quality_grade": obs.quality_grade,
                "quality_score": obs.quality_score,
            }
            for horizon in horizons:
                row[f"forward_return_{horizon}d_pct"] = obs.horizon_returns[horizon]
                row[f"hit_fair_value_{horizon}d"] = obs.horizon_hit_target[horizon]
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a PIT valuation-gap accuracy study.")
    parser.add_argument("--universe", default="clean_stocks", help="Universe name from backend/services/universe_registry.py")
    parser.add_argument("--symbols", default="", help="Optional comma-separated symbol override")
    parser.add_argument("--cap-tier", choices=("micro", "small", "mid", "large"), default="", help="Optional market-cap tier filter")
    parser.add_argument("--limit", type=int, default=0, help="Optional symbol limit")
    parser.add_argument("--frequency", choices=("monthly", "quarterly"), default="monthly", help="Rebalance frequency")
    parser.add_argument("--horizons", default="63,126,252", help="Comma-separated forward bar horizons")
    parser.add_argument("--gap-threshold-pct", type=float, default=20.0, help="Percent gap needed for under/overvalued classification")
    parser.add_argument("--start-date", default="", help="Optional YYYY-MM-DD start date")
    parser.add_argument("--end-date", default="", help="Optional YYYY-MM-DD end date")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH), help="Path to fundamentals PIT database")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT_PATH), help="Path to JSON summary output")
    parser.add_argument("--output-csv", default="", help="Optional path to detailed CSV observations")
    args = parser.parse_args()

    horizons = sorted({int(part.strip()) for part in str(args.horizons).split(",") if part.strip()})
    if not horizons:
        raise SystemExit("No valid horizons supplied.")

    symbols = _dedupe(args.symbols.split(",")) if args.symbols else _load_symbols(args)
    if not symbols:
        raise SystemExit("No symbols loaded for study.")

    conn = connect_pit(args.db_path)
    ensure_schema(conn)

    all_observations: List[StudyObservation] = []
    symbols_with_observations = 0

    try:
        for idx, symbol in enumerate(symbols, start=1):
            bars = _load_daily_bars(symbol)
            if len(bars) <= max(horizons) + 24:
                continue

            observations = _evaluate_symbol(
                conn,
                symbol,
                bars,
                rebalance_frequency=args.frequency,
                start_date=args.start_date or None,
                end_date=args.end_date or None,
                gap_threshold_pct=float(args.gap_threshold_pct),
                horizons=horizons,
            )
            if not observations:
                continue
            all_observations.extend(observations)
            symbols_with_observations += 1
            print(f"[{idx}/{len(symbols)}] {symbol}: {len(observations)} observations", flush=True)
    finally:
        conn.close()

    summary = _summarize_study(
        all_observations,
        horizons=horizons,
        symbols_requested=len(symbols),
        symbols_with_observations=symbols_with_observations,
        args=args,
    )
    _write_json(Path(args.output_json), summary)
    if args.output_csv:
        _write_csv(Path(args.output_csv), all_observations, horizons)

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
