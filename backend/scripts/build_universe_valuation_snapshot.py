#!/usr/bin/env python3
from __future__ import annotations

"""
Build a current valuation snapshot for the active universe.

This is the production-oriented counterpart to the valuation-gap research script:

1. For each symbol in the requested universe, find the latest available PIT market date
2. Pull the latest as-of market + fundamentals snapshot
3. Pull the latest annual statement facts available on that date
4. Run the standardized DCF engine already used in the valuation-gap studies
5. Write a scanner-friendly snapshot file with one valuation row per symbol
"""

import argparse
import json
import sqlite3
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
DATA_DIR = BACKEND_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "fundamentals-pit.sqlite"
DEFAULT_OUTPUT_PATH = DATA_DIR / "research" / "valuation_universe_snapshot.json"
SERVICES_DIR = BACKEND_DIR / "services"
SCRIPTS_DIR = BACKEND_DIR / "scripts"

sys.path.insert(0, str(SERVICES_DIR))
sys.path.insert(0, str(SCRIPTS_DIR))

from fundamentals_pit_query import connect_pit, ensure_schema, get_asof_snapshot  # noqa: E402
from symbol_catalog_db import SymbolCatalogDb, classify_company_from_snapshot  # noqa: E402
from universe_registry import load_universe_symbols  # noqa: E402
import run_valuation_gap_accuracy_study as study  # noqa: E402
import sync_valuation_snapshot_to_symbol_catalog as valuation_snapshot_sync  # noqa: E402

CATALOG_DB = SymbolCatalogDb(root=ROOT)

VALUATION_FACT_KEYS = tuple(
    list(study.DCF_FACT_KEYS)
    + [
        "stockholders_equity",
        "shareholders_equity",
        "equity",
        "common_stock_equity",
        "total_equity",
        "stockholders_equity_including_noncontrolling_interest",
    ]
)


@dataclass
class ValuationSnapshotRow:
    symbol: str
    asof_date: str
    price: float
    fair_value_low: float
    fair_value_mid: float
    fair_value_high: float
    valuation_gap_pct: float
    valuation_state: str
    market_cap: Optional[float]
    market_cap_bucket: Optional[str]
    enterprise_value: Optional[float]
    enterprise_to_sales: Optional[float]
    revenue: float
    free_cash_flow: float
    shares_outstanding: float
    revenue_growth_pct: Optional[float]
    operating_margin_pct: Optional[float]
    free_cash_flow_margin_pct: Optional[float]
    current_ratio: Optional[float]
    quality_grade: str
    quality_score: int
    coverage_mode: str
    company_type: Optional[str]
    valuation_engine_class: str


def _scale_multiplier(scale: Any) -> float:
    text = str(scale or "").strip().lower()
    if text == "billions":
        return 1_000_000_000.0
    if text == "millions":
        return 1_000_000.0
    if text == "thousands":
        return 1_000.0
    return 1.0


def _normalize_statement_value(fact_key: str, value_numeric: Any, scale: Any) -> Optional[float]:
    base = study._safe_float(value_numeric)
    if base is None:
        return None
    normalized = base * _scale_multiplier(scale)
    if fact_key == "capital_expenditures":
        return abs(normalized)
    return normalized


def _group_annual_periods_for_current_dcf(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_period: Dict[str, Dict[str, Any]] = {}
    preferred: Dict[tuple[str, str], Dict[str, Any]] = {}
    source_priority = {
        "sec_companyfacts_bulk": 0,
        "sec_docling_probe": 1,
    }

    def _rank(row: Dict[str, Any]) -> tuple[Any, ...]:
        source = str(row.get("source_type") or "").strip().lower()
        scale = str(row.get("scale") or "").strip().lower()
        value = study._safe_float(row.get("value_numeric"))
        scale_rank = 0 if scale == "ones" else 1 if not scale else 2
        source_rank = source_priority.get(source, 9)
        return (
            source_rank,
            scale_rank,
            0 if value not in (None, 0) else 1,
            -len(str(row.get("available_at") or "")),
            -len(str(row.get("filing_date") or "")),
        )

    for row in rows:
        period_end = str(row.get("period_end") or "").strip()
        if not period_end:
            continue
        fact_key = str(row.get("fact_key") or "").strip()
        if not fact_key:
            continue
        key = (period_end, fact_key)
        incumbent = preferred.get(key)
        if incumbent is None or _rank(row) < _rank(incumbent):
            preferred[key] = row

    for (period_end, fact_key), row in preferred.items():
        bucket = by_period.setdefault(
            period_end,
            {
                "period_end": period_end,
                "filing_date": row.get("filing_date"),
                "available_at": row.get("available_at"),
                "metrics": {},
            },
        )
        bucket["metrics"][fact_key] = _normalize_statement_value(fact_key, row.get("value_numeric"), row.get("scale"))
    return sorted(by_period.values(), key=lambda item: item["period_end"], reverse=True)


def _load_annual_statement_rows(conn: sqlite3.Connection, symbol: str, asof_date: str) -> List[Dict[str, Any]]:
    placeholders = ", ".join("?" for _ in VALUATION_FACT_KEYS)
    rows = conn.execute(
        f"""
        SELECT *
        FROM pit_statement_facts
        WHERE symbol = ?
          AND available_at <= ?
          AND period_type = 'annual'
          AND fact_key IN ({placeholders})
        ORDER BY period_end DESC, available_at DESC, filing_date DESC, updated_at DESC
        """,
        (symbol, asof_date, *VALUATION_FACT_KEYS),
    ).fetchall()
    return [{key: row[key] for key in row.keys()} for row in rows]


def _first_finite(values: Iterable[Any]) -> Optional[float]:
    for value in values:
        number = study._safe_float(value)
        if number is not None and number == number and abs(number) != float("inf"):
            return number
    return None


def _failure(symbol: str, reason: str, **details: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"symbol": symbol, "reason": reason}
    for key, value in details.items():
        if value is None:
            continue
        if isinstance(value, float):
            payload[key] = round(value, 6)
        else:
            payload[key] = value
    return payload


def _build_current_standardized_dcf(
    snapshot: Dict[str, Any],
    latest_annual: Dict[str, Any],
    prior_annual: Optional[Dict[str, Any]],
    current_price: float,
) -> Optional[Dict[str, Any]]:
    metrics = latest_annual.get("metrics") or {}
    prior_metrics = (prior_annual or {}).get("metrics") or {}

    annual_revenue = _first_finite([metrics.get("revenue"), snapshot.get("annualRevenue")])
    operating_income = study._safe_float(metrics.get("operating_income"))
    net_income = study._safe_float(metrics.get("net_income"))
    operating_cash_flow = _first_finite([metrics.get("operating_cash_flow"), snapshot.get("operatingCashFlowTTM")])
    capital_expenditures = study._safe_float(metrics.get("capital_expenditures"))
    free_cash_flow = _first_finite([metrics.get("free_cash_flow"), snapshot.get("freeCashFlowTTM")])
    coverage_mode = "pit_statement_backed"
    if free_cash_flow is None and operating_cash_flow is not None and capital_expenditures is not None:
        free_cash_flow = operating_cash_flow - capital_expenditures
    if metrics.get("free_cash_flow") is None and metrics.get("operating_cash_flow") is None and (
        snapshot.get("freeCashFlowTTM") is not None or snapshot.get("operatingCashFlowTTM") is not None
    ):
        coverage_mode = "pit_statement_plus_snapshot_fallback"
    elif metrics.get("revenue") is None and snapshot.get("annualRevenue") is not None:
        coverage_mode = "pit_statement_plus_snapshot_fallback"

    shares_outstanding = study._safe_float(snapshot.get("sharesOutstanding"))
    if shares_outstanding is None or shares_outstanding <= 0:
        return None
    if annual_revenue is None or annual_revenue <= 0 or free_cash_flow is None:
        return None

    prior_revenue = study._safe_float(prior_metrics.get("revenue"))
    revenue_growth_pct = None
    if annual_revenue not in (None, 0) and prior_revenue not in (None, 0):
        revenue_growth_pct = ((annual_revenue / prior_revenue) - 1.0) * 100.0

    operating_margin_pct = None
    if annual_revenue not in (None, 0) and operating_income is not None:
        operating_margin_pct = (operating_income / annual_revenue) * 100.0

    current_ratio = study._safe_float(snapshot.get("currentRatio"))
    if current_ratio is None:
        current_assets = study._safe_float(metrics.get("current_assets"))
        current_liabilities = study._safe_float(metrics.get("current_liabilities"))
        current_ratio = study._safe_divide(current_assets, current_liabilities)

    quality_grade, quality_score, _, _, current_fcf_margin_pct = study._build_quality_grade(
        net_income=net_income,
        operating_cash_flow=operating_cash_flow,
        free_cash_flow=free_cash_flow,
        capital_expenditures=capital_expenditures,
        revenue=annual_revenue,
    )

    if operating_margin_pct is None:
        operating_margin_pct = study._safe_float(snapshot.get("operatingMarginPct"))

    quality_factor = study._quality_factor(quality_grade)
    normalized_fcf = free_cash_flow * quality_factor
    if normalized_fcf is None:
        return None

    conversion_ratio = (
        study._clamp(current_fcf_margin_pct / operating_margin_pct, 0.25, 0.85)
        if current_fcf_margin_pct is not None and operating_margin_pct not in (None, 0)
        else 0.5
    )

    base_near_term_growth_pct = study._clamp((revenue_growth_pct or 8.0) * 0.7 if revenue_growth_pct is not None else 8.0, 1.0, 25.0)
    base_target_operating_margin_pct = study._clamp(
        max((operating_margin_pct or 0.0) + 3.0, 10.0) if operating_margin_pct is not None else 12.0,
        4.0,
        35.0,
    )
    base_target_fcf_margin_pct = study._clamp(
        base_target_operating_margin_pct * max(conversion_ratio, 0.55),
        2.0,
        max(4.0, base_target_operating_margin_pct),
    )

    discount_rate_pct = study._clamp(
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
            "revenue_growth_pct": study._clamp(base_near_term_growth_pct - 4.0, 0.5, 20.0),
            "target_fcf_margin_pct": study._clamp(base_target_fcf_margin_pct - 1.5, 1.0, 20.0),
            "discount_rate_pct": study._clamp(discount_rate_pct + 1.0, 6.0, 18.0),
            "terminal_growth_pct": study._clamp(terminal_growth_pct - 0.5, 1.0, 5.0),
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
            "revenue_growth_pct": study._clamp(base_near_term_growth_pct + 4.0, 1.0, 28.0),
            "target_fcf_margin_pct": study._clamp(base_target_fcf_margin_pct + 1.5, 2.0, 24.0),
            "discount_rate_pct": study._clamp(discount_rate_pct - 1.0, 6.0, 18.0),
            "terminal_growth_pct": study._clamp(terminal_growth_pct + 0.5, 1.0, 5.0),
        },
    ]

    fair_values: Dict[str, float] = {}
    for scenario in scenarios:
        revenue = annual_revenue
        pv_of_cash_flows = 0.0
        free_cash_flow_year = normalized_fcf

        for year in range(1, forecast_years + 1):
            fade_ratio = (year - 1) / (forecast_years - 1) if forecast_years > 1 else 1.0
            growth_pct = study._interpolate(scenario["revenue_growth_pct"], scenario["terminal_growth_pct"], fade_ratio)
            start_margin = current_fcf_margin_pct if current_fcf_margin_pct is not None else scenario["target_fcf_margin_pct"] * 0.7
            fcf_margin_pct = study._interpolate(start_margin, scenario["target_fcf_margin_pct"], year / forecast_years)
            revenue = revenue * (1.0 + growth_pct / 100.0)
            free_cash_flow_year = revenue * (fcf_margin_pct / 100.0)
            discount_factor = (1.0 + scenario["discount_rate_pct"] / 100.0) ** year
            pv_of_cash_flows += free_cash_flow_year / discount_factor

        terminal_cash_flow = free_cash_flow_year * (1.0 + scenario["terminal_growth_pct"] / 100.0)
        spread = scenario["discount_rate_pct"] - scenario["terminal_growth_pct"]
        if spread <= 0.5:
            return None
        terminal_value = terminal_cash_flow / (spread / 100.0)
        pv_terminal = terminal_value / ((1.0 + scenario["discount_rate_pct"] / 100.0) ** forecast_years)
        equity_value = pv_of_cash_flows + pv_terminal
        fair_values[scenario["name"]] = equity_value / shares_outstanding

    fair_value_mid = fair_values["base"]
    if not fair_value_mid or fair_value_mid <= 0:
        return None
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
        "coverage_mode": coverage_mode,
    }


def _build_financial_company_valuation(
    snapshot: Dict[str, Any],
    latest_annual: Dict[str, Any],
    current_price: float,
) -> Optional[Dict[str, Any]]:
    metrics = latest_annual.get("metrics") or {}
    annual_equity = _first_finite([
        metrics.get("total_equity"),
        metrics.get("stockholders_equity_including_noncontrolling_interest"),
        metrics.get("stockholders_equity"),
        metrics.get("shareholders_equity"),
        metrics.get("equity"),
        metrics.get("common_stock_equity"),
    ])
    market_cap = study._safe_float(snapshot.get("marketCap"))
    shares_outstanding = _first_finite([
        snapshot.get("sharesOutstanding"),
        (market_cap / current_price) if market_cap is not None and current_price > 0 else None,
    ])
    if shares_outstanding is None or shares_outstanding <= 0:
        return None

    net_income = study._safe_float(metrics.get("net_income"))
    debt_to_equity = study._safe_float(snapshot.get("debtToEquity"))
    raw_roe_pct = _first_finite([
        snapshot.get("returnOnEquityPct"),
        (net_income / annual_equity) * 100.0 if net_income is not None and annual_equity not in (None, 0) else None,
    ])
    total_equity = _first_finite([
        snapshot.get("equity"),
        annual_equity,
    ])
    book_value_per_share = _first_finite([
        snapshot.get("bookValuePerShare"),
        (current_price / study._safe_float(snapshot.get("priceToBook"))) if study._safe_float(snapshot.get("priceToBook")) not in (None, 0) else None,
        (total_equity / shares_outstanding) if total_equity is not None and shares_outstanding > 0 else None,
    ])
    normalized_roe_pct = _first_finite([
        raw_roe_pct,
        ((net_income / total_equity) * 100.0) if net_income is not None and total_equity not in (None, 0) else None,
    ])
    normalized_eps = _first_finite([
        snapshot.get("trailingEPS"),
        snapshot.get("earningsPerShare"),
        (net_income / shares_outstanding) if net_income is not None and shares_outstanding > 0 else None,
    ])

    if book_value_per_share is None or normalized_roe_pct is None:
        return None
    if current_price > 0:
        book_to_price_ratio = book_value_per_share / current_price
        if book_to_price_ratio > 20 or book_to_price_ratio < 0.05:
            return None

    base_cost_of_equity_pct = study._clamp(
        9.0
        + (2.0 if debt_to_equity is not None and debt_to_equity >= 10 else 1.0 if debt_to_equity is not None and debt_to_equity >= 5 else 0.5 if debt_to_equity is not None and debt_to_equity >= 2 else 0.0)
        + (0.75 if normalized_roe_pct < 8 else 0.0),
        7.5,
        16.0,
    )
    terminal_growth_pct = study._clamp(study._safe_float(snapshot.get("revenueGrowthPct")) or 2.5, 0.5, max(0.5, base_cost_of_equity_pct - 1.5))
    scenarios = [
        {"name": "bear", "roe_pct": study._clamp(normalized_roe_pct - 2.5, 2.0, 30.0), "cost_pct": study._clamp(base_cost_of_equity_pct + 1.0, 6.0, 20.0), "growth_pct": study._clamp(terminal_growth_pct - 0.5, 0.5, 6.0)},
        {"name": "base", "roe_pct": normalized_roe_pct, "cost_pct": base_cost_of_equity_pct, "growth_pct": terminal_growth_pct},
        {"name": "bull", "roe_pct": study._clamp(normalized_roe_pct + 2.5, 2.0, 35.0), "cost_pct": study._clamp(base_cost_of_equity_pct - 1.0, 6.0, 20.0), "growth_pct": study._clamp(terminal_growth_pct + 0.5, 0.5, 6.0)},
    ]

    fair_values: Dict[str, float] = {}
    for scenario in scenarios:
        roe = scenario["roe_pct"] / 100.0
        growth = scenario["growth_pct"] / 100.0
        cost = scenario["cost_pct"] / 100.0
        if cost <= growth:
            return None
        justified_price_to_book = study._clamp((roe - growth) / (cost - growth), 0.25, 4.5)
        fair_values[scenario["name"]] = book_value_per_share * justified_price_to_book

    fair_value_mid = fair_values["base"]
    if not fair_value_mid or fair_value_mid <= 0:
        return None

    valuation_gap_pct = ((fair_value_mid - current_price) / current_price) * 100.0 if current_price > 0 else 0.0
    quality_score = 83 if normalized_roe_pct >= 12 else 70 if normalized_roe_pct >= 8 else 55 if normalized_roe_pct >= 5 else 35
    quality_grade = "high" if quality_score >= 75 else "good" if quality_score >= 60 else "mixed" if quality_score >= 45 else "weak"

    return {
        "fair_value_low": fair_values["bear"],
        "fair_value_mid": fair_value_mid,
        "fair_value_high": fair_values["bull"],
        "valuation_gap_pct": valuation_gap_pct,
        "revenue": _first_finite([metrics.get("revenue"), snapshot.get("annualRevenue")]),
        "free_cash_flow": _first_finite([metrics.get("free_cash_flow"), snapshot.get("freeCashFlowTTM")]),
        "shares_outstanding": shares_outstanding,
        "revenue_growth_pct": _first_finite([snapshot.get("revenueGrowthPct"), snapshot.get("revenueYoYGrowthPct")]),
        "operating_margin_pct": None,
        "free_cash_flow_margin_pct": None,
        "current_ratio": study._safe_float(snapshot.get("currentRatio")),
        "quality_grade": quality_grade,
        "quality_score": quality_score,
        "coverage_mode": "pit_statement_backed_financial_company",
    }


def _build_reit_proxy_valuation(
    snapshot: Dict[str, Any],
    latest_annual: Dict[str, Any],
    prior_annual: Optional[Dict[str, Any]],
    current_price: float,
) -> Optional[Dict[str, Any]]:
    result = _build_current_standardized_dcf(snapshot, latest_annual, prior_annual, current_price)
    if not result:
        return None
    result["coverage_mode"] = "reit_cashflow_proxy" if result.get("coverage_mode") == "pit_statement_backed" else "reit_cashflow_proxy_with_snapshot_fallback"
    return result


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
        requested.extend(item.strip() for item in str(args.symbols).split(","))
    elif args.universe:
        requested.extend(load_universe_symbols(str(args.universe).strip()))
    else:
        requested.extend(load_universe_symbols("clean_stocks"))

    symbols = _dedupe(requested)
    if args.limit and int(args.limit) > 0:
        symbols = symbols[: int(args.limit)]
    return symbols


def _latest_market_date(conn: sqlite3.Connection, symbol: str) -> Optional[str]:
    row = conn.execute(
        """
        SELECT MAX(market_date) AS market_date
        FROM pit_market_facts
        WHERE symbol = ? AND metric = 'currentPrice'
        """,
        (symbol,),
    ).fetchone()
    market_date = str(row["market_date"] or "").strip() if row else ""
    if market_date:
        return market_date

    row = conn.execute(
        """
        SELECT MAX(available_at) AS available_at
        FROM pit_fundamental_facts
        WHERE symbol = ?
        """,
        (symbol,),
    ).fetchone()
    available_at = str(row["available_at"] or "").strip() if row else ""
    return available_at or None


def _market_cap_bucket(market_cap: Optional[float]) -> Optional[str]:
    if market_cap is None or market_cap <= 0:
        return None
    if market_cap < 300_000_000:
        return "micro"
    if market_cap < 2_000_000_000:
        return "small"
    if market_cap < 10_000_000_000:
        return "mid"
    return "large"


def _build_row(
    conn: sqlite3.Connection,
    symbol: str,
    *,
    gap_threshold_pct: float,
) -> Tuple[Optional[ValuationSnapshotRow], Optional[Dict[str, Any]]]:
    asof_date = _latest_market_date(conn, symbol)
    if not asof_date:
        return None, _failure(symbol, "no_market_or_fundamental_asof")

    snapshot = get_asof_snapshot(conn, symbol, asof_date)
    price = study._safe_float(snapshot.get("currentPrice"))
    if price in (None, 0):
        return None, _failure(symbol, "no_price", asof_date=asof_date)

    annual_rows = _load_annual_statement_rows(conn, symbol, asof_date)
    annual_periods = _group_annual_periods_for_current_dcf(annual_rows)
    if not annual_periods:
        return None, _failure(symbol, "no_annual_statement_facts", asof_date=asof_date)

    latest_annual = annual_periods[0]
    prior_annual = annual_periods[1] if len(annual_periods) > 1 else None
    stored_symbol = CATALOG_DB.get_symbol(symbol) or {}
    classification = classify_company_from_snapshot(snapshot) or {}
    company_type = str(stored_symbol.get("company_type") or classification.get("company_type") or "operating_company").strip() or "operating_company"
    valuation_engine_class = str(stored_symbol.get("valuation_engine_class") or classification.get("valuation_engine_class") or "dcf_operating").strip() or "dcf_operating"
    metrics = latest_annual.get("metrics") or {}
    sparse_financial_signal = (
        valuation_engine_class == "dcf_operating"
        and _first_finite([metrics.get("revenue"), snapshot.get("annualRevenue")]) is None
        and study._safe_float(snapshot.get("returnOnEquityPct")) is not None
        and study._safe_float(snapshot.get("debtToEquity")) not in (None, 0)
        and abs(float(snapshot.get("debtToEquity"))) >= 10
    )
    if sparse_financial_signal:
        company_type = "financial_company"
        valuation_engine_class = "roe_book_value"

    if valuation_engine_class == "roe_book_value":
        valuation = _build_financial_company_valuation(snapshot, latest_annual, float(price))
        if not valuation:
            return None, _failure(
                symbol,
                "missing_book_value_or_roe_inputs",
                asof_date=asof_date,
                company_type=company_type,
                valuation_engine_class=valuation_engine_class,
            )
    elif valuation_engine_class == "reit_affo":
        valuation = _build_reit_proxy_valuation(snapshot, latest_annual, prior_annual, float(price))
        if not valuation:
            return None, _failure(
                symbol,
                "reit_proxy_insufficient_cashflow_inputs",
                asof_date=asof_date,
                company_type=company_type,
                valuation_engine_class=valuation_engine_class,
            )
    elif valuation_engine_class == "sales_scenario":
        return None, _failure(
            symbol,
            "preprofit_sales_scenario_not_in_snapshot_builder",
            asof_date=asof_date,
            company_type=company_type,
            valuation_engine_class=valuation_engine_class,
        )
    else:
        annual_revenue = _first_finite([metrics.get("revenue"), snapshot.get("annualRevenue")])
        operating_cash_flow = _first_finite([metrics.get("operating_cash_flow"), snapshot.get("operatingCashFlowTTM")])
        capital_expenditures = study._safe_float(metrics.get("capital_expenditures"))
        free_cash_flow = _first_finite([metrics.get("free_cash_flow"), snapshot.get("freeCashFlowTTM")])
        if free_cash_flow is None and operating_cash_flow is not None and capital_expenditures is not None:
            free_cash_flow = operating_cash_flow - capital_expenditures
        if annual_revenue is None or annual_revenue <= 0:
            return None, _failure(
                symbol,
                "missing_or_nonpositive_revenue",
                asof_date=asof_date,
                company_type=company_type,
                valuation_engine_class=valuation_engine_class,
            )
        if free_cash_flow is None:
            return None, _failure(
                symbol,
                "missing_fcf_and_ocf_capex_fallback",
                asof_date=asof_date,
                company_type=company_type,
                valuation_engine_class=valuation_engine_class,
            )
        valuation = _build_current_standardized_dcf(snapshot, latest_annual, prior_annual, float(price))
        if not valuation:
            return None, _failure(
                symbol,
                "nonpositive_fair_value_mid",
                asof_date=asof_date,
                company_type=company_type,
                valuation_engine_class=valuation_engine_class,
            )

    market_cap = study._safe_float(snapshot.get("marketCap"))
    valuation_state = study._valuation_state(float(valuation["valuation_gap_pct"]), gap_threshold_pct)

    return ValuationSnapshotRow(
        symbol=symbol,
        asof_date=asof_date,
        price=float(price),
        fair_value_low=float(valuation["fair_value_low"]),
        fair_value_mid=float(valuation["fair_value_mid"]),
        fair_value_high=float(valuation["fair_value_high"]),
        valuation_gap_pct=float(valuation["valuation_gap_pct"]),
        valuation_state=valuation_state,
        market_cap=market_cap,
        market_cap_bucket=_market_cap_bucket(market_cap),
        enterprise_value=study._safe_float(snapshot.get("enterpriseValue")),
        enterprise_to_sales=study._safe_float(snapshot.get("enterpriseToSales")),
        revenue=float(valuation["revenue"]) if valuation.get("revenue") is not None else 0.0,
        free_cash_flow=float(valuation["free_cash_flow"]) if valuation.get("free_cash_flow") is not None else 0.0,
        shares_outstanding=float(valuation["shares_outstanding"]),
        revenue_growth_pct=study._safe_float(valuation["revenue_growth_pct"]),
        operating_margin_pct=study._safe_float(valuation["operating_margin_pct"]),
        free_cash_flow_margin_pct=study._safe_float(valuation["free_cash_flow_margin_pct"]),
        current_ratio=study._safe_float(valuation["current_ratio"]),
        quality_grade=str(valuation["quality_grade"]),
        quality_score=int(valuation["quality_score"]),
        coverage_mode=str(valuation.get("coverage_mode") or "pit_statement_backed"),
        company_type=company_type,
        valuation_engine_class=valuation_engine_class,
    ), None


def _summarize_rows(rows: List[ValuationSnapshotRow]) -> Dict[str, Any]:
    states = Counter(row.valuation_state for row in rows)
    caps = Counter((row.market_cap_bucket or "unknown") for row in rows)
    qualities = Counter(row.quality_grade for row in rows)

    def _top(state: str, limit: int = 25) -> List[Dict[str, Any]]:
        subset = [row for row in rows if row.valuation_state == state]
        if state == "overvalued":
            subset.sort(key=lambda row: row.valuation_gap_pct)
        else:
            subset.sort(key=lambda row: row.valuation_gap_pct, reverse=True)
        return [
            {
                "symbol": row.symbol,
                "price": round(row.price, 4),
                "fair_value_mid": round(row.fair_value_mid, 4),
                "valuation_gap_pct": round(row.valuation_gap_pct, 4),
                "market_cap_bucket": row.market_cap_bucket,
                "quality_grade": row.quality_grade,
                "quality_score": row.quality_score,
                "asof_date": row.asof_date,
            }
            for row in subset[:limit]
        ]

    return {
        "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "symbol_count": len(rows),
        "by_state": dict(states),
        "by_market_cap_bucket": dict(caps),
        "by_quality_grade": dict(qualities),
        "top_undervalued": _top("undervalued"),
        "top_overvalued": _top("overvalued"),
    }


def build_snapshot(args: argparse.Namespace) -> Dict[str, Any]:
    symbols = _load_symbols(args)
    conn = connect_pit(str(args.db))
    ensure_schema(conn)
    try:
        rows: List[ValuationSnapshotRow] = []
        failures: List[Dict[str, Any]] = []
        for idx, symbol in enumerate(symbols, start=1):
            if idx % 250 == 0:
                print(f"[ValuationSnapshot] processed {idx}/{len(symbols)} symbols...", flush=True)
            try:
                row, failure = _build_row(conn, symbol, gap_threshold_pct=float(args.gap_threshold_pct))
            except Exception as exc:
                failures.append(_failure(symbol, "exception", error=str(exc)))
                continue
            if row is None:
                failures.append(failure or _failure(symbol, "insufficient_data"))
                continue
            rows.append(row)
    finally:
        conn.close()

    failure_counts = Counter(str(item.get("reason") or "unknown") for item in failures)
    payload = {
        "meta": {
            "universe": str(args.universe or "clean_stocks"),
            "gap_threshold_pct": float(args.gap_threshold_pct),
            "db_path": str(args.db),
            **_summarize_rows(rows),
            "failures": failures[:200],
            "failure_count": len(failures),
            "failure_reason_counts": dict(failure_counts),
        },
        "rows": [asdict(row) for row in rows],
    }
    return payload


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a universe-wide valuation snapshot from PIT data")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Path to PIT database")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH), help="Output JSON file path")
    parser.add_argument("--universe", default="clean_stocks", help="Universe key from universe registry")
    parser.add_argument("--symbols", default="", help="Optional comma-separated symbol override")
    parser.add_argument("--limit", type=int, default=0, help="Optional symbol limit for smoke tests")
    parser.add_argument("--gap-threshold-pct", type=float, default=20.0, help="Threshold for overvalued/undervalued labeling")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    args.db = Path(args.db).resolve()
    args.output = Path(args.output).resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    payload = build_snapshot(args)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    sync_counts = valuation_snapshot_sync.sync_snapshot(payload, source=args.output.name)

    print(f"[ValuationSnapshot] wrote {len(payload['rows'])} rows to {args.output}", flush=True)
    print(
        f"[ValuationSnapshot] synced {sync_counts['symbols']} symbols, "
        f"{sync_counts['memberships']} memberships, and {sync_counts['metrics']} metrics into symbol catalog",
        flush=True,
    )
    print(json.dumps(payload["meta"], indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
