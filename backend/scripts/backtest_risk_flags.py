"""Historical risk flag backtest.

Pulls quarterly balance sheet data from SEC companyfacts bulk files,
combines with historical weekly price data to compute market cap at each
quarter-end, then runs the same risk flag logic used in the live system
to show exactly when each flag would have first fired.

Usage:
    py scripts/backtest_risk_flags.py CHTR
    py scripts/backtest_risk_flags.py CHTR --from 2018 --json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
SERVICES_DIR = ROOT / "backend" / "services"
sys.path.insert(0, str(SERVICES_DIR))

DATA_DIR = ROOT / "backend" / "data"
COMPANYFACTS_DIR = ROOT / "Financial data" / "docling_probe" / "raw" / "sec" / "bulk" / "companyfacts"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
OHLCV_CACHE_DIR = DATA_DIR / "ohlcv_cache"


def _print(msg: str) -> None:
    print(msg, flush=True)


def load_cik_for_symbol(symbol: str) -> Optional[str]:
    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8-sig"))
    for stock in data.get("stocks", []):
        if str(stock.get("symbol", "")).upper() == symbol.upper():
            return stock.get("cik")
    return None


def load_companyfacts(cik: str) -> Dict[str, Any]:
    padded = f"CIK{cik.zfill(10)}.json"
    path = COMPANYFACTS_DIR / padded
    if not path.exists():
        raise FileNotFoundError(f"No companyfacts file: {path}")
    return json.loads(path.read_text())


def extract_quarterly_series(
    gaap: Dict[str, Any],
    concepts: List[str],
    is_duration: bool = False,
) -> Dict[str, float]:
    """Extract quarterly values from SEC GAAP data, keyed by period end date."""
    for concept in concepts:
        if concept not in gaap:
            continue
        units = gaap[concept].get("units", {})
        for unit_key, entries in units.items():
            result: Dict[str, float] = {}
            for e in entries:
                form = e.get("form", "")
                if form not in ("10-K", "10-Q", "10-K/A", "10-Q/A"):
                    continue
                end_date = e.get("end", "")
                if not end_date:
                    continue
                if is_duration:
                    if not e.get("start"):
                        continue
                    start = e["start"]
                    months = _months_between(start, end_date)
                    if months > 4:
                        continue
                else:
                    if e.get("start"):
                        continue
                val = e.get("val")
                if val is not None:
                    result[end_date] = float(val)
            if result:
                return result
    return {}


def _months_between(start: str, end: str) -> int:
    try:
        s = datetime.strptime(start[:10], "%Y-%m-%d")
        e = datetime.strptime(end[:10], "%Y-%m-%d")
        return (e.year - s.year) * 12 + (e.month - s.month)
    except Exception:
        return 99


def load_weekly_prices(symbol: str, from_year: int = 2015) -> List[Dict[str, Any]]:
    cache_path = OHLCV_CACHE_DIR / f"{symbol.upper()}_1wk.json"
    if cache_path.exists():
        data = json.loads(cache_path.read_text())
        bars = data if isinstance(data, list) else data.get("bars", data.get("data", []))
        if bars:
            return bars

    try:
        import yfinance as yf
        _print(f"Fetching historical prices via yfinance for {symbol}...")
        ticker = yf.Ticker(symbol)
        hist = ticker.history(start=f"{from_year}-01-01", interval="1wk")
        if hist.empty:
            _print("WARNING: yfinance returned no data.")
            return []
        bars = []
        for idx, row in hist.iterrows():
            bars.append({
                "timestamp": idx.strftime("%Y-%m-%d"),
                "close": float(row["Close"]) if not math.isnan(row["Close"]) else None,
            })
        _print(f"Fetched {len(bars)} weekly bars from yfinance.")
        return bars
    except ImportError:
        _print("WARNING: yfinance not installed. Cannot fetch prices.")
        return []
    except Exception as e:
        _print(f"WARNING: yfinance fetch failed: {e}")
        return []


def find_price_at_date(bars: List[Dict[str, Any]], target_date: str) -> Optional[float]:
    """Find the closest weekly close price on or before the target date."""
    target = target_date[:10]
    best_price = None
    best_date = ""
    for bar in bars:
        bar_date = str(bar.get("timestamp", bar.get("date", "")))[:10]
        if bar_date <= target and bar_date > best_date:
            best_date = bar_date
            best_price = bar.get("close")
    return best_price


def build_quarterly_snapshots(
    gaap: Dict[str, Any],
    weekly_bars: List[Dict[str, Any]],
    from_year: int = 2015,
) -> List[Dict[str, Any]]:
    """Build quarterly balance-sheet snapshots enriched with market data."""

    debt = extract_quarterly_series(gaap, ["LongTermDebtNoncurrent", "LongTermDebt"])
    cash = extract_quarterly_series(gaap, ["CashAndCashEquivalentsAtCarryingValue"])
    current_assets = extract_quarterly_series(gaap, ["AssetsCurrent"])
    current_liabilities = extract_quarterly_series(gaap, ["LiabilitiesCurrent"])
    revenue_q = extract_quarterly_series(gaap, [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
    ], is_duration=True)
    shares = extract_quarterly_series(gaap, [
        "WeightedAverageNumberOfDilutedSharesOutstanding",
    ], is_duration=True)
    operating_cf = extract_quarterly_series(gaap, [
        "NetCashProvidedByUsedInOperatingActivities",
    ], is_duration=True)
    net_income = extract_quarterly_series(gaap, [
        "NetIncomeLoss",
    ], is_duration=True)
    equity = extract_quarterly_series(gaap, [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ])

    all_dates = sorted(set(debt.keys()) | set(current_assets.keys()) | set(revenue_q.keys()))
    all_dates = [d for d in all_dates if int(d[:4]) >= from_year]

    snapshots: List[Dict[str, Any]] = []
    prev_revenue: Optional[float] = None

    for date_str in all_dates:
        total_debt = debt.get(date_str)
        total_cash = cash.get(date_str)
        c_assets = current_assets.get(date_str)
        c_liabilities = current_liabilities.get(date_str)
        rev = revenue_q.get(date_str)
        share_count = shares.get(date_str)
        ocf = operating_cf.get(date_str)
        ni = net_income.get(date_str)
        eq = equity.get(date_str)

        price = find_price_at_date(weekly_bars, date_str)

        market_cap = None
        if price is not None and share_count:
            market_cap = price * share_count

        enterprise_value = None
        if market_cap is not None and total_debt is not None:
            ev_cash = total_cash or 0
            enterprise_value = market_cap + total_debt - ev_cash

        current_ratio = None
        if c_assets and c_liabilities and c_liabilities > 0:
            current_ratio = c_assets / c_liabilities

        net_debt = None
        if total_debt is not None:
            net_debt = total_debt - (total_cash or 0)

        rev_growth_pct = None
        if rev is not None and prev_revenue is not None and prev_revenue > 0:
            rev_growth_pct = ((rev - prev_revenue) / prev_revenue) * 100
        prev_revenue = rev

        snap = {
            "date": date_str,
            "price": price,
            "totalDebt": total_debt,
            "totalCash": total_cash,
            "marketCap": market_cap,
            "enterpriseValue": enterprise_value,
            "currentRatio": current_ratio,
            "netDebt": net_debt,
            "revenueQ": rev,
            "revenueGrowthPct": rev_growth_pct,
            "sharesOutstanding": share_count,
            "operatingCashFlow": ocf,
            "netIncome": ni,
            "equity": eq,
            "freeCashFlowTTM": None,
        }
        snapshots.append(snap)

    return snapshots


def _is_number(v: Any) -> bool:
    return v is not None and isinstance(v, (int, float)) and math.isfinite(v)


def compute_risk_flags(snap: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Same logic as _build_risk_flags in fundamentalsService.py."""
    flags: List[Dict[str, Any]] = []

    total_debt = snap.get("totalDebt")
    total_cash = snap.get("totalCash")
    market_cap = snap.get("marketCap")
    enterprise_value = snap.get("enterpriseValue")
    current_ratio = snap.get("currentRatio")
    rev_growth = snap.get("revenueGrowthPct")

    net_debt = None
    if _is_number(total_debt):
        net_debt = total_debt - (total_cash or 0)

    # Extreme / high leverage
    if _is_number(net_debt) and _is_number(market_cap) and market_cap > 0:
        ratio = net_debt / market_cap
        if ratio >= 3.0:
            flags.append({
                "code": "extreme_leverage",
                "label": "Extreme leverage",
                "severity": "critical",
                "short": f"Net debt is {ratio:.1f}x equity market cap",
                "detail": f"Net debt ${net_debt/1e9:.1f}B vs market cap ${market_cap/1e9:.1f}B. "
                          "Equity is a thin residual.",
            })
        elif ratio >= 1.5:
            flags.append({
                "code": "high_leverage",
                "label": "High leverage",
                "severity": "high",
                "short": f"Net debt is {ratio:.1f}x equity market cap",
                "detail": f"Net debt ${net_debt/1e9:.1f}B vs market cap ${market_cap/1e9:.1f}B.",
            })

    # Thin equity stub
    if _is_number(enterprise_value) and _is_number(market_cap) and enterprise_value > 0:
        equity_pct = (market_cap / enterprise_value) * 100
        if equity_pct < 25:
            flags.append({
                "code": "thin_equity_stub",
                "label": "Thin equity stub",
                "severity": "critical",
                "short": f"Equity is only {equity_pct:.0f}% of enterprise value",
                "detail": f"EV ${enterprise_value/1e9:.1f}B but equity only ${market_cap/1e9:.1f}B.",
            })

    # Liquidity crisis
    if _is_number(current_ratio) and current_ratio < 0.5:
        flags.append({
            "code": "liquidity_crisis",
            "label": "Liquidity stress",
            "severity": "high",
            "short": f"Current ratio {current_ratio:.2f}",
            "detail": "Current liabilities significantly exceed current assets.",
        })

    # Revenue declining
    if _is_number(rev_growth) and rev_growth < -3.0:
        flags.append({
            "code": "revenue_declining",
            "label": "Revenue declining",
            "severity": "moderate",
            "short": f"Revenue growth {rev_growth:+.1f}% QoQ",
            "detail": "Revenue is declining quarter over quarter.",
        })

    # Combo: leverage + weakness
    has_leverage = any(f["code"] in ("extreme_leverage", "high_leverage") for f in flags)
    has_weakness = any(f["code"] in ("revenue_declining",) for f in flags)
    if has_leverage and has_weakness:
        flags.append({
            "code": "leverage_plus_weakness",
            "label": "Leverage + weakness",
            "severity": "critical",
            "short": "High debt + deteriorating fundamentals",
            "detail": "Heavy leverage AND declining revenue — equity is especially fragile.",
        })

    return flags


def run_backtest(symbol: str, from_year: int = 2015, output_json: bool = False) -> None:
    _print(f"=== Risk Flag Backtest: {symbol} ===\n")

    cik = load_cik_for_symbol(symbol)
    if not cik:
        _print(f"ERROR: No CIK found for {symbol}")
        return

    _print(f"CIK: {cik}")
    cf = load_companyfacts(cik)
    gaap = cf.get("facts", {}).get("us-gaap", {})
    _print(f"Company: {cf.get('entityName')}")
    _print(f"GAAP concepts: {len(gaap)}")

    bars = load_weekly_prices(symbol, from_year)
    _print(f"Weekly price bars: {len(bars)}")

    if not bars:
        _print("WARNING: No price data. Market cap cannot be computed. Proceeding with balance sheet only.")

    snapshots = build_quarterly_snapshots(gaap, bars, from_year)
    _print(f"Quarterly snapshots: {len(snapshots)}\n")

    results: List[Dict[str, Any]] = []
    first_fire: Dict[str, str] = {}

    for snap in snapshots:
        flags = compute_risk_flags(snap)
        entry = {
            "date": snap["date"],
            "price": snap.get("price"),
            "marketCap": snap.get("marketCap"),
            "totalDebt": snap.get("totalDebt"),
            "netDebt": snap.get("netDebt"),
            "currentRatio": snap.get("currentRatio"),
            "revenueQ": snap.get("revenueQ"),
            "revenueGrowthPct": snap.get("revenueGrowthPct"),
            "enterpriseValue": snap.get("enterpriseValue"),
            "flags": flags,
            "flag_codes": [f["code"] for f in flags],
        }
        results.append(entry)

        for f in flags:
            if f["code"] not in first_fire:
                first_fire[f["code"]] = snap["date"]

    if output_json:
        print(json.dumps({"symbol": symbol, "quarters": results, "first_fire": first_fire}, indent=2))
        return

    _print(f"{'Quarter':12s} {'Price':>8s} {'Mkt Cap':>10s} {'Debt':>10s} {'Net Debt':>10s} {'CR':>6s} {'Rev QoQ':>8s} {'Flags'}")
    _print("-" * 100)

    for r in results:
        price_str = f"${r['price']:.0f}" if r["price"] else "N/A"
        mcap_str = f"${r['marketCap']/1e9:.0f}B" if r["marketCap"] else "N/A"
        debt_str = f"${r['totalDebt']/1e9:.0f}B" if r["totalDebt"] else "N/A"
        nd_str = f"${r['netDebt']/1e9:.0f}B" if r["netDebt"] else "N/A"
        cr_str = f"{r['currentRatio']:.2f}" if r["currentRatio"] else "N/A"
        rev_str = f"{r['revenueGrowthPct']:+.1f}%" if r["revenueGrowthPct"] is not None else "N/A"
        flag_str = ", ".join(r["flag_codes"]) if r["flag_codes"] else "-"

        _print(f"{r['date']:12s} {price_str:>8s} {mcap_str:>10s} {debt_str:>10s} {nd_str:>10s} {cr_str:>6s} {rev_str:>8s} {flag_str}")

    _print(f"\n=== First Fire Dates ===")
    for code, date in sorted(first_fire.items(), key=lambda x: x[1]):
        _print(f"  {date}  {code}")

    if not first_fire:
        _print("  No risk flags triggered in this period.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backtest risk flags against historical SEC data")
    parser.add_argument("symbol", help="Ticker symbol to backtest")
    parser.add_argument("--from", dest="from_year", type=int, default=2018, help="Start year (default: 2018)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()
    run_backtest(args.symbol, args.from_year, args.json)
