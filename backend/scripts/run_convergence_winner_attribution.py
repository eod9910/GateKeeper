"""Winner/loser attribution for bullish full-convergence hits.

Takes the point-in-time observations from run_full_convergence_stack_study.py and
asks: what did the winners have at entry that losers did not?

The goal is not to create a model yet. It is to produce candidate causal filters:
fundamentals, price structure, liquidity, cap bucket, and stack-leg combinations
that separate SPY beaters from losers.

Usage:
    python backend/scripts/run_convergence_winner_attribution.py
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
PRICE_DIR = DATA_DIR / "universe"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
PIT_DB = DATA_DIR / "fundamentals-pit.sqlite"
RESEARCH_DIR = DATA_DIR / "research"
DEFAULT_OBS = RESEARCH_DIR / "full_convergence_stack_obs.csv"
DEFAULT_OUTPUT = RESEARCH_DIR / "convergence_winner_attribution.json"
DEFAULT_MD = RESEARCH_DIR / "convergence_winner_attribution.md"

FUNDAMENTAL_KEYS = (
    "revenue",
    "net_income",
    "operating_income",
    "operating_cash_flow",
    "capital_expenditures",
    "free_cash_flow",
    "current_assets",
    "current_liabilities",
    "shareholders_equity",
)


def safe_symbol(symbol: str) -> str:
    return symbol.replace("/", "_").replace("=", "_").replace("-", "_")


def parse_date(value: Any) -> Optional[pd.Timestamp]:
    try:
        return pd.Timestamp(str(value)[:10])
    except Exception:
        return None


def safe_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        v = float(value)
    except Exception:
        return None
    return v if math.isfinite(v) else None


def mean(values: Sequence[float]) -> Optional[float]:
    return statistics.mean(values) if values else None


def median(values: Sequence[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def pct_change(now: Optional[float], prev: Optional[float]) -> Optional[float]:
    if now is None or prev in (None, 0):
        return None
    return (now / prev - 1.0) * 100.0


def load_universe_meta() -> Dict[str, Dict[str, Any]]:
    payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8-sig"))
    rows = payload.get("stocks") if isinstance(payload, dict) else payload
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows or []:
        sym = str(row.get("symbol") or row.get("ticker") or "").upper().strip()
        if not sym:
            continue
        out[sym] = {
            "market_cap": safe_float(row.get("market_cap")),
            "sector": row.get("sector"),
            "industry": row.get("industry"),
            "cap_tier": row.get("market_cap_bucket") or row.get("cap_tier"),
        }
    return out


def load_price_series(symbol: str) -> Optional[pd.DataFrame]:
    path = PRICE_DIR / f"{safe_symbol(symbol)}_1d.csv"
    if not path.exists():
        return None
    try:
        df = pd.read_csv(path, usecols=lambda c: c.lower() in ("date", "open", "high", "low", "close", "volume"))
    except Exception:
        return None
    df.columns = [c.lower() for c in df.columns]
    if "date" not in df.columns or "close" not in df.columns:
        return None
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["date", "close"]).drop_duplicates("date", keep="last").sort_values("date")
    return df.set_index("date")


def price_features(price_cache: Dict[str, Optional[pd.DataFrame]], symbol: str, asof: pd.Timestamp) -> Dict[str, Optional[float]]:
    df = price_cache.get(symbol)
    if df is None:
        df = load_price_series(symbol)
        price_cache[symbol] = df
    if df is None:
        return {}
    hist = df[df.index <= asof]
    if hist.empty:
        return {}
    close = hist["close"].dropna()
    if close.empty:
        return {}
    px = float(close.iloc[-1])

    def ret(days: int) -> Optional[float]:
        if len(close) <= days:
            return None
        base = float(close.iloc[-days - 1])
        return pct_change(px, base)

    w63 = hist.tail(63)
    w252 = hist.tail(252)
    vol63 = None
    dollar_vol63 = None
    if "volume" in w63.columns and not w63.empty:
        vol63 = safe_float(w63["close"].pct_change(fill_method=None).std() * math.sqrt(252) * 100.0)
        dollar_vol63 = safe_float((w63["close"] * w63["volume"]).median())
    high252 = safe_float(w252["close"].max()) if not w252.empty else None
    low252 = safe_float(w252["close"].min()) if not w252.empty else None
    drawdown_252 = pct_change(px, high252)
    range_pos_252 = ((px - low252) / (high252 - low252)) if high252 not in (None, low252) and low252 is not None else None
    return {
        "entry_price": px,
        "ret_21d": ret(21),
        "ret_63d": ret(63),
        "ret_126d": ret(126),
        "volatility_63d_ann_pct": vol63,
        "dollar_volume_63d": dollar_vol63,
        "drawdown_from_252d_high_pct": drawdown_252,
        "range_pos_252d": range_pos_252,
    }


def load_fundamental_periods(symbols: Iterable[str]) -> Dict[str, List[Dict[str, Any]]]:
    if not PIT_DB.exists():
        return {}
    wanted = {str(s).upper() for s in symbols}
    out: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    conn = sqlite3.connect(f"file:{PIT_DB}?mode=ro", uri=True)
    try:
        placeholders = ",".join("?" for _ in wanted)
        if not placeholders:
            return {}
        query = f"""
            SELECT UPPER(symbol), fact_key, value_numeric, period_end, available_at
            FROM pit_statement_facts
            WHERE period_type = 'quarterly'
              AND fact_key IN ({",".join("?" for _ in FUNDAMENTAL_KEYS)})
              AND UPPER(symbol) IN ({placeholders})
        """
        params = list(FUNDAMENTAL_KEYS) + sorted(wanted)
        for sym, key, val, period_end, available_at in conn.execute(query, params):
            if not period_end or not available_at:
                continue
            bucket = out[sym].setdefault(str(period_end)[:10], {"period_end": str(period_end)[:10], "available_at": str(available_at)[:10]})
            bucket[str(key)] = safe_float(val)
    finally:
        conn.close()
    return {sym: sorted(periods.values(), key=lambda x: x["period_end"]) for sym, periods in out.items()}


def fundamental_features(periods_by_symbol: Dict[str, List[Dict[str, Any]]], symbol: str, asof: pd.Timestamp) -> Dict[str, Optional[float]]:
    periods = [
        p for p in periods_by_symbol.get(symbol, [])
        if parse_date(p.get("available_at")) is not None and parse_date(p["available_at"]) <= asof
    ]
    periods.sort(key=lambda p: p["period_end"])
    if not periods:
        return {}

    def metric(p: Dict[str, Any], key: str) -> Optional[float]:
        return safe_float(p.get(key))

    def series_for(key: str) -> List[Dict[str, Any]]:
        return [p for p in periods if metric(p, key) is not None]

    def latest_value(key: str) -> Optional[float]:
        rows = series_for(key)
        return metric(rows[-1], key) if rows else None

    def previous_value(key: str, periods_back: int = 1) -> Optional[float]:
        rows = series_for(key)
        if len(rows) <= periods_back:
            return None
        return metric(rows[-1 - periods_back], key)

    def ttm_pair(key: str) -> Tuple[Optional[float], Optional[float]]:
        rows = series_for(key)
        if len(rows) < 8:
            return None, None
        current_vals = [metric(r, key) for r in rows[-4:]]
        previous_vals = [metric(r, key) for r in rows[-8:-4]]
        if any(v is None for v in current_vals + previous_vals):
            return None, None
        return sum(current_vals), sum(previous_vals)  # type: ignore[arg-type]

    balance_rows = [
        p for p in periods
        if metric(p, "current_assets") is not None
        or metric(p, "current_liabilities") is not None
        or metric(p, "shareholders_equity") is not None
    ]
    latest_balance = balance_rows[-1] if balance_rows else {}

    revenue_latest = latest_value("revenue")
    net_income_latest = latest_value("net_income")
    operating_income_latest = latest_value("operating_income")
    fcf_latest = latest_value("free_cash_flow")
    current_assets_latest = metric(latest_balance, "current_assets")
    current_liabilities_latest = metric(latest_balance, "current_liabilities")
    shareholders_equity_latest = metric(latest_balance, "shareholders_equity")
    revenue_ttm, revenue_prev_ttm = ttm_pair("revenue")
    ni_ttm, ni_prev_ttm = ttm_pair("net_income")
    fcf_ttm, fcf_prev_ttm = ttm_pair("free_cash_flow")

    return {
        "revenue_qoq_pct": pct_change(revenue_latest, previous_value("revenue", 1)),
        "revenue_yoy_pct": pct_change(revenue_latest, previous_value("revenue", 4)),
        "revenue_ttm_growth_pct": pct_change(revenue_ttm, revenue_prev_ttm),
        "net_income_qoq_pct": pct_change(net_income_latest, previous_value("net_income", 1)),
        "net_income_yoy_pct": pct_change(net_income_latest, previous_value("net_income", 4)),
        "net_income_ttm_growth_pct": pct_change(ni_ttm, ni_prev_ttm),
        "fcf_qoq_pct": pct_change(fcf_latest, previous_value("free_cash_flow", 1)),
        "fcf_yoy_pct": pct_change(fcf_latest, previous_value("free_cash_flow", 4)),
        "fcf_ttm_growth_pct": pct_change(fcf_ttm, fcf_prev_ttm),
        "operating_margin_latest_pct": (operating_income_latest / revenue_latest * 100.0) if revenue_latest not in (None, 0) and operating_income_latest is not None else None,
        "net_margin_latest_pct": (net_income_latest / revenue_latest * 100.0) if revenue_latest not in (None, 0) and net_income_latest is not None else None,
        "fcf_margin_latest_pct": (fcf_latest / revenue_latest * 100.0) if revenue_latest not in (None, 0) and fcf_latest is not None else None,
        "current_ratio_latest": (current_assets_latest / current_liabilities_latest) if current_liabilities_latest not in (None, 0) and current_assets_latest is not None else None,
        "shareholders_equity_latest": shareholders_equity_latest,
        "revenue_latest": revenue_latest,
        "net_income_latest": net_income_latest,
        "fcf_latest": fcf_latest,
    }


def quantile(values: Sequence[float], q: float) -> Optional[float]:
    vals = sorted(v for v in values if v is not None and math.isfinite(v))
    if not vals:
        return None
    idx = min(len(vals) - 1, max(0, round((len(vals) - 1) * q)))
    return vals[idx]


def classify_row(row: Dict[str, Any], horizon: int) -> Optional[Dict[str, Any]]:
    if row.get("direction") != "bullish":
        return None
    ret = safe_float(row.get(f"forward_{horizon}d_pct"))
    spy = safe_float(row.get(f"spy_{horizon}d_pct"))
    if ret is None:
        return None
    legs = json.loads(row.get("legs_json") or "[]")
    return {
        "symbol": row["symbol"],
        "asof_date": row["asof_date"],
        "return_pct": ret,
        "spy_return_pct": spy,
        "excess_vs_spy_pct": ret - spy if spy is not None else None,
        "winner": ret > 0,
        "spy_beater": spy is not None and ret > spy,
        "big_winner": ret >= 50,
        "catastrophic_loser": ret <= -30,
        "score": safe_float(row.get("score")),
        "aligned_count": safe_float(row.get("aligned_count")),
        "eigen_z": safe_float(row.get("eigen_z")),
        "price_ext_z": safe_float(row.get("price_ext_z")),
        "crowd_share": safe_float(row.get("crowd_share")),
        "crowd_n": safe_float(row.get("crowd_n")),
        "insider_net_value": safe_float(row.get("insider_net_value")),
        "thesis_z": safe_float(row.get("thesis_z")),
        "thesis_posts": safe_float(row.get("thesis_posts")),
        "leg_combo": "+".join(sorted(l.get("name", "") for l in legs)),
    }


def summarize_group(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    returns = [r["return_pct"] for r in rows if r.get("return_pct") is not None]
    excess = [r["excess_vs_spy_pct"] for r in rows if r.get("excess_vs_spy_pct") is not None]
    return {
        "n": len(rows),
        "avg_return_pct": round(mean(returns) or 0.0, 4) if returns else None,
        "median_return_pct": round(median(returns) or 0.0, 4) if returns else None,
        "win_rate": round(sum(1 for r in rows if r.get("winner")) / len(rows), 4) if rows else None,
        "spy_beat_rate": round(sum(1 for r in rows if r.get("spy_beater")) / len(rows), 4) if rows else None,
        "avg_vs_spy_pct": round(mean(excess) or 0.0, 4) if excess else None,
        "median_vs_spy_pct": round(median(excess) or 0.0, 4) if excess else None,
        "big_winner_rate": round(sum(1 for r in rows if r.get("big_winner")) / len(rows), 4) if rows else None,
        "catastrophic_loser_rate": round(sum(1 for r in rows if r.get("catastrophic_loser")) / len(rows), 4) if rows else None,
    }


def feature_contrasts(rows: Sequence[Dict[str, Any]], features: Sequence[str]) -> Dict[str, Any]:
    out = {}
    groups = {
        "winners": [r for r in rows if r.get("winner")],
        "losers": [r for r in rows if not r.get("winner")],
        "spy_beaters": [r for r in rows if r.get("spy_beater")],
        "spy_laggers": [r for r in rows if not r.get("spy_beater")],
        "big_winners": [r for r in rows if r.get("big_winner")],
        "catastrophic_losers": [r for r in rows if r.get("catastrophic_loser")],
    }
    for feat in features:
        item = {}
        for name, subset in groups.items():
            vals = [safe_float(r.get(feat)) for r in subset]
            vals = [v for v in vals if v is not None]
            item[name] = {
                "n": len(vals),
                "median": round(median(vals), 4) if vals else None,
                "avg": round(mean(vals), 4) if vals else None,
            }
        out[feat] = item
    return out


def filter_scan(rows: Sequence[Dict[str, Any]], features: Sequence[str]) -> List[Dict[str, Any]]:
    scans = []
    for feat in features:
        vals = [safe_float(r.get(feat)) for r in rows]
        vals = [v for v in vals if v is not None]
        if len(vals) < 40:
            continue
        for q, direction in ((0.2, "<="), (0.3, "<="), (0.7, ">="), (0.8, ">=")):
            cutoff = quantile(vals, q)
            if cutoff is None:
                continue
            if direction == ">=":
                sub = [r for r in rows if safe_float(r.get(feat)) is not None and safe_float(r.get(feat)) >= cutoff]
            else:
                sub = [r for r in rows if safe_float(r.get(feat)) is not None and safe_float(r.get(feat)) <= cutoff]
            if len(sub) < 20:
                continue
            s = summarize_group(sub)
            scans.append({
                "feature": feat,
                "rule": f"{feat} {direction} {cutoff:.4g}",
                "cutoff": cutoff,
                **s,
            })
    scans.sort(key=lambda x: ((x.get("avg_vs_spy_pct") or -999), (x.get("spy_beat_rate") or 0), x["n"]), reverse=True)
    return scans


def leg_combo_summary(rows: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for combo, subset in defaultdict(list, ((None, []),)).items():
        pass
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        grouped[str(r.get("leg_combo") or "")].append(r)
    for combo, subset in grouped.items():
        if len(subset) < 5:
            continue
        out.append({"combo": combo, **summarize_group(subset)})
    out.sort(key=lambda x: (x["n"], x.get("avg_vs_spy_pct") or -999), reverse=True)
    return out


def enrich_rows(obs_path: Path, horizon: int) -> Tuple[List[Dict[str, Any]], List[str]]:
    with obs_path.open("r", encoding="utf-8", newline="") as f:
        source_rows = list(csv.DictReader(f))
    rows = [classify_row(r, horizon) for r in source_rows]
    rows = [r for r in rows if r is not None]
    meta = load_universe_meta()
    periods = load_fundamental_periods({r["symbol"] for r in rows})
    price_cache: Dict[str, Optional[pd.DataFrame]] = {}
    for idx, row in enumerate(rows, start=1):
        sym = row["symbol"]
        asof = parse_date(row["asof_date"])
        if asof is None:
            continue
        row.update(meta.get(sym, {}))
        row.update(price_features(price_cache, sym, asof))
        row.update(fundamental_features(periods, sym, asof))
        market_cap = safe_float(row.get("market_cap"))
        equity = safe_float(row.get("shareholders_equity_latest"))
        row["shareholders_equity_to_market_cap"] = (equity / market_cap) if market_cap not in (None, 0) and equity is not None else None
        if idx % 200 == 0:
            print(f"  enriched {idx}/{len(rows)} rows for {horizon}d", flush=True)

    excluded_features = {
        "return_pct",
        "spy_return_pct",
        "excess_vs_spy_pct",
        "winner",
        "spy_beater",
        "big_winner",
        "catastrophic_loser",
    }
    feature_names = sorted({
        key
        for row in rows
        for key, value in row.items()
        if isinstance(value, (int, float)) and key not in excluded_features
    })
    return rows, feature_names


def write_markdown(path: Path, payload: Dict[str, Any]) -> None:
    lines = [
        "# Convergence Winner Attribution",
        "",
        f"Source observations: `{payload['source']}`",
        "",
    ]
    for h, result in payload["horizons"].items():
        lines.extend([
            f"## Horizon {h} bars",
            "",
            "### Baseline",
            "",
            "```json",
            json.dumps(result["baseline"], indent=2),
            "```",
            "",
            "### Best Univariate Filters",
            "",
            "| Rule | N | Avg | Median | Win | Beat SPY | Avg vs SPY | Big winners | Cat losers |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ])
        for item in result["best_filters"][:15]:
            lines.append(
                f"| `{item['rule']}` | {item['n']} | {item['avg_return_pct']} | {item['median_return_pct']} | "
                f"{item['win_rate']} | {item['spy_beat_rate']} | {item['avg_vs_spy_pct']} | "
                f"{item['big_winner_rate']} | {item['catastrophic_loser_rate']} |"
            )
        lines.extend([
            "",
            "### Leg Combos",
            "",
            "| Combo | N | Avg | Median | Win | Beat SPY | Avg vs SPY |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ])
        for item in result["leg_combos"][:15]:
            lines.append(
                f"| `{item['combo']}` | {item['n']} | {item['avg_return_pct']} | {item['median_return_pct']} | "
                f"{item['win_rate']} | {item['spy_beat_rate']} | {item['avg_vs_spy_pct']} |"
            )
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--obs-csv", default=str(DEFAULT_OBS))
    parser.add_argument("--horizons", default="126,252")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--output-md", default=str(DEFAULT_MD))
    args = parser.parse_args(argv)

    horizons = [int(x.strip()) for x in str(args.horizons).split(",") if x.strip()]
    payload: Dict[str, Any] = {
        "source": args.obs_csv,
        "script": "backend/scripts/run_convergence_winner_attribution.py",
        "horizons": {},
    }
    for horizon in horizons:
        print(f"Enriching horizon {horizon}...", flush=True)
        rows, features = enrich_rows(Path(args.obs_csv), horizon)
        contrasts = feature_contrasts(rows, features)
        scans = filter_scan(rows, features)
        combos = leg_combo_summary(rows)
        payload["horizons"][str(horizon)] = {
            "baseline": summarize_group(rows),
            "features_tested": features,
            "feature_contrasts": contrasts,
            "best_filters": scans[:50],
            "leg_combos": combos,
        }
        print(f"\n=== Horizon {horizon} attribution ===")
        print(json.dumps(payload["horizons"][str(horizon)]["baseline"], indent=2))
        print("Best filters:")
        for item in scans[:10]:
            print(f"  {item['rule']}: n={item['n']} avg={item['avg_return_pct']} vs_spy={item['avg_vs_spy_pct']} beat={item['spy_beat_rate']}")

    Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output_json).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_markdown(Path(args.output_md), payload)
    print(f"\nWrote {args.output_json}")
    print(f"Wrote {args.output_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
