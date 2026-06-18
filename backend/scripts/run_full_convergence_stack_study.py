"""Point-in-time full convergence stack study vs SPY.

This is the historical test the live convergence board needed:

- recompute eigen residuals on each formation date using only prior prices
- add point-in-time price extension, crowd mood, insider activity, and a
  thesis-grade social proxy
- score aligned directional stacks
- compare the resulting monthly portfolios against same-window SPY buy-and-hold

The LLM thesis extractor itself is not historically backtestable, so the thesis
leg here is the deterministic proxy used by the narrative-lead study:
substantive business-argument posts, z-scored against each symbol's own trailing
baseline and signed by bullish/bearish sentiment.

Usage:
    python backend/scripts/run_full_convergence_stack_study.py
    python backend/scripts/run_full_convergence_stack_study.py --max-symbols 500 --horizons 126,252
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_valuation_gap_accuracy_study as study  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
PRICE_DIR = DATA_DIR / "universe"
SOCIAL_DB = DATA_DIR / "social-intelligence.sqlite"
EDGAR_DB = DATA_DIR / "edgar-filings.sqlite"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
RESEARCH_DIR = DATA_DIR / "research"
DEFAULT_OUTPUT = RESEARCH_DIR / "full_convergence_stack_study.json"
DEFAULT_OBS = RESEARCH_DIR / "full_convergence_stack_obs.csv"

BENCHMARK = "SPY"
LOOKBACK = 120
FACTORS = 5
MIN_COVERAGE = 0.95
PRICE_EXT_MIN_BARS = 120
CROWD_WIN_DAYS = 45
INSIDER_WIN_DAYS = 45
THESIS_BASELINE_WEEKS = 12
THESIS_MIN_BASELINE_WEEKS = 8
THESIS_SPIKE_Z = 2.0
THESIS_FLOOR = 3

ARG_CUE_RE = re.compile(
    r"\b(because|due to|leads? to|result(?:s|ing)?|replac|disrupt|displac|cannibal|"
    r"substitut|threat|risk|decline|erod|demand|revenue|margin|market share|earnings|"
    r"guidance|competit|patent|recall|approval|adoption|tailwind|headwind|secular|moat|"
    r"obsolet|undermin|growth|backlog|pricing|churn|subscriber|bookings)\b",
    re.I,
)
INCIDENTAL_RE = [
    re.compile(r"\bwho('?s| is| wants to be)\s+(hiring|hired)\b", re.I),
    re.compile(r"\b(seeking|hiring)\s+(a\s+)?(freelanc|contractor)", re.I),
    re.compile(r"\bfreelancer\?\b", re.I),
    re.compile(r"\bwilling to relocate\b", re.I),
    re.compile(r"\bremote\s*:\s*(yes|no|only|hybrid)\b", re.I),
    re.compile(r"\btechnologies\s*:\s*\S", re.I),
]


@dataclass
class StackObservation:
    symbol: str
    asof_date: str
    direction: str
    score: float
    aligned_count: int
    eigen_z: Optional[float]
    price_ext_z: Optional[float]
    crowd_share: Optional[float]
    crowd_n: int
    insider_net_value: float
    thesis_z: Optional[float]
    thesis_posts: int
    legs_json: str
    forward_returns: Dict[int, Optional[float]]
    spy_returns: Dict[int, Optional[float]]


def _safe_symbol(symbol: str) -> str:
    return symbol.replace("/", "_").replace("=", "_").replace("-", "_")


def _parse_date(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except Exception:
        return None


def _mean(values: Sequence[float]) -> Optional[float]:
    return statistics.mean(values) if values else None


def _median(values: Sequence[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def _t_stat(values: Sequence[float]) -> Optional[float]:
    if len(values) < 3:
        return None
    sd = statistics.stdev(values)
    if sd <= 0:
        return None
    return statistics.mean(values) / (sd / math.sqrt(len(values)))


def load_clean_symbols(max_symbols: int, include_social_covered: bool = True) -> List[str]:
    payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8-sig"))
    rows = payload.get("stocks") if isinstance(payload, dict) else payload
    ordered = []
    for row in rows or []:
        sym = str(row.get("symbol") or row.get("ticker") or "").upper().strip()
        if sym:
            ordered.append(sym)
    base = ordered if max_symbols <= 0 else ordered[:max_symbols]
    if not include_social_covered or not SOCIAL_DB.exists():
        return sorted(set(base))

    con = sqlite3.connect(f"file:{SOCIAL_DB}?mode=ro", uri=True)
    try:
        covered = [
            str(r[0]).upper()
            for r in con.execute(
                """
                SELECT UPPER(symbol)
                FROM social_posts_clean
                WHERE posted_at >= '2023-09-01'
                GROUP BY UPPER(symbol)
                HAVING COUNT(*) >= 50
                """
            )
        ]
    finally:
        con.close()
    return sorted(set(base) | set(covered))


def load_market_caps() -> Dict[str, float]:
    payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8-sig"))
    rows = payload.get("stocks") if isinstance(payload, dict) else payload
    out: Dict[str, float] = {}
    for row in rows or []:
        sym = str(row.get("symbol") or row.get("ticker") or "").upper().strip()
        try:
            cap = float(row.get("market_cap") or 0.0)
        except Exception:
            cap = 0.0
        if sym and cap > 0:
            out[sym] = cap
    return out


def load_close_panel(symbols: Sequence[str], start_date: str) -> pd.DataFrame:
    series = {}
    for sym in symbols:
        path = PRICE_DIR / f"{_safe_symbol(sym)}_1d.csv"
        if not path.exists():
            continue
        try:
            df = pd.read_csv(path, usecols=lambda c: c.lower() in ("date", "close"))
        except Exception:
            continue
        df.columns = [c.lower() for c in df.columns]
        if "date" not in df.columns or "close" not in df.columns:
            continue
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["close"] = pd.to_numeric(df["close"], errors="coerce")
        df = df.dropna(subset=["date", "close"]).drop_duplicates("date", keep="last").sort_values("date")
        df = df[df["close"] > 0]
        if len(df) < PRICE_EXT_MIN_BARS + 20:
            continue
        series[sym] = pd.Series(df["close"].to_numpy(dtype=float), index=df["date"], name=sym)
    if not series:
        raise RuntimeError("No usable price series loaded.")
    close = pd.concat(series.values(), axis=1).sort_index()
    start_dt = pd.Timestamp(start_date) - pd.Timedelta(days=420)
    return close[close.index >= start_dt]


def monthly_formation_dates(spy: pd.Series, start: str, end: str) -> List[pd.Timestamp]:
    bars = [{"date": str(idx.date()), "close": float(v), "high": float(v), "low": float(v)} for idx, v in spy.dropna().items()]
    out = []
    start_dt = pd.Timestamp(start)
    end_dt = pd.Timestamp(end)
    # Use 1 bar here so shorter horizons can keep later formation dates. The
    # per-symbol forward-return helper filters out dates that lack each horizon.
    for idx in study._select_rebalance_dates(bars, "monthly", 1):
        ts = pd.Timestamp(bars[idx]["date"])
        if start_dt <= ts <= end_dt:
            out.append(ts)
    return out


def compute_eigen_z(close: pd.DataFrame, asof: pd.Timestamp, symbols: Sequence[str]) -> Dict[str, float]:
    hist = close.loc[:asof, list(symbols)].tail(LOOKBACK + 1)
    returns = hist.pct_change(fill_method=None).tail(LOOKBACK)
    min_non_null = max(10, int(math.ceil(len(returns) * MIN_COVERAGE)))
    returns = returns.dropna(axis=1, thresh=min_non_null).dropna(axis=0, how="all").fillna(0.0)
    if returns.shape[0] < 30 or returns.shape[1] < 50:
        return {}
    means = returns.mean(axis=0)
    stdevs = returns.std(axis=0).replace(0, np.nan)
    cols = list(stdevs.dropna().index)
    r = returns[cols]
    x = np.nan_to_num(((r - means[cols]) / stdevs[cols]).to_numpy(dtype=float))
    u, sv, vt = np.linalg.svd(x, full_matrices=False)
    k = max(1, min(FACTORS, len(sv), x.shape[0] - 1, x.shape[1] - 1))
    reconstructed = (u[:, :k] * sv[:k]) @ vt[:k, :]
    resid = pd.DataFrame(x - reconstructed, index=r.index, columns=cols)
    sigma = resid.std(axis=0).replace(0, np.nan)
    z = resid.divide(sigma, axis=1).iloc[-1]
    return {str(sym).upper(): float(val) for sym, val in z.items() if np.isfinite(val)}


def compute_price_ext(close: pd.DataFrame, asof: pd.Timestamp, symbols: Sequence[str]) -> Dict[str, float]:
    out = {}
    for sym in symbols:
        if sym not in close.columns:
            continue
        s = close.loc[:asof, sym].dropna()
        s = s[s > 0]
        if len(s) < PRICE_EXT_MIN_BARS:
            continue
        lp = np.log(s.to_numpy(dtype=float))
        x = np.arange(len(lp), dtype=float)
        try:
            slope, intercept = np.polyfit(x, lp, 1)
        except Exception:
            continue
        resid = lp - (intercept + slope * x)
        sd = float(np.std(resid, ddof=1))
        if sd <= 0 or not np.isfinite(sd):
            continue
        z = float(resid[-1] / sd)
        if np.isfinite(z):
            out[sym] = z
    return out


def is_substantive(text: Any, token_count: Any, is_spam: Any) -> bool:
    if bool(is_spam):
        return False
    try:
        if token_count is None or int(token_count) < 25:
            return False
    except Exception:
        return False
    body = str(text or "")
    if not ARG_CUE_RE.search(body):
        return False
    return not any(rx.search(body) for rx in INCIDENTAL_RE)


def week_start(dt: datetime) -> date:
    return (dt - timedelta(days=dt.weekday())).date()


def load_social_features(symbols: Sequence[str], start: str, end: str) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if not SOCIAL_DB.exists():
        return pd.DataFrame(), pd.DataFrame()
    wanted = set(symbols)
    con = sqlite3.connect(f"file:{SOCIAL_DB}?mode=ro", uri=True)
    raw = defaultdict(int)
    subst = defaultdict(int)
    sbull = defaultdict(int)
    sbear = defaultdict(int)
    crowd = defaultdict(lambda: {"bull": 0, "bear": 0})
    try:
        cur = con.execute(
            """
            SELECT c.symbol, c.posted_at, c.trade_date, c.token_count, c.is_spam,
                   c.cleaned_text, s.sentiment_label
            FROM social_posts_clean c
            LEFT JOIN social_post_sentiment s ON s.raw_post_id = c.raw_post_id
            WHERE c.posted_at >= ? AND c.posted_at <= ?
            """,
            (start, end),
        )
        while True:
            rows = cur.fetchmany(20000)
            if not rows:
                break
            for sym, posted, trade_dt, tok, spam, text, sent in rows:
                sym = str(sym or "").upper()
                if sym not in wanted or not posted:
                    continue
                dt = _parse_date(posted)
                if dt is None:
                    continue
                key = (sym, week_start(dt))
                raw[key] += 1
                if sent in ("bullish", "bearish"):
                    dkey = (sym, dt.date())
                    crowd[dkey]["bull" if sent == "bullish" else "bear"] += 1
                if is_substantive(text, tok, spam):
                    subst[key] += 1
                    if sent == "bullish":
                        sbull[key] += 1
                    elif sent == "bearish":
                        sbear[key] += 1
    finally:
        con.close()

    keys = sorted(set(raw) | set(subst))
    weekly = pd.DataFrame({
        "symbol": [k[0] for k in keys],
        "week": [pd.Timestamp(k[1]) for k in keys],
        "raw": [raw[k] for k in keys],
        "subst": [subst[k] for k in keys],
        "sbull": [sbull[k] for k in keys],
        "sbear": [sbear[k] for k in keys],
    })
    if not weekly.empty:
        parts = []
        for sym, g in weekly.sort_values(["symbol", "week"]).groupby("symbol", sort=False):
            g = g.set_index("week")
            full = pd.date_range(g.index.min(), g.index.max(), freq="W-MON")
            g = g.reindex(full, fill_value=0)
            g["symbol"] = sym
            mean = g["subst"].shift(1).rolling(THESIS_BASELINE_WEEKS, min_periods=THESIS_MIN_BASELINE_WEEKS).mean()
            std = g["subst"].shift(1).rolling(THESIS_BASELINE_WEEKS, min_periods=THESIS_MIN_BASELINE_WEEKS).std()
            g["subst_z"] = (g["subst"] - mean) / std.replace(0, np.nan)
            parts.append(g.reset_index().rename(columns={"index": "week"}))
        weekly = pd.concat(parts, ignore_index=True)

    ckeys = sorted(crowd)
    daily = pd.DataFrame({
        "symbol": [k[0] for k in ckeys],
        "date": [pd.Timestamp(k[1]) for k in ckeys],
        "bull": [crowd[k]["bull"] for k in ckeys],
        "bear": [crowd[k]["bear"] for k in ckeys],
    })
    return weekly, daily


def load_insider_daily(symbols: Sequence[str], start: str, end: str) -> pd.DataFrame:
    if not EDGAR_DB.exists():
        return pd.DataFrame()
    wanted = set(symbols)
    con = sqlite3.connect(f"file:{EDGAR_DB}?mode=ro", uri=True)
    rows = []
    try:
        for r in con.execute(
            """
            SELECT UPPER(symbol), substr(filing_date,1,10), transaction_type, total_value
            FROM insider_transactions
            WHERE filing_date >= ? AND filing_date <= ?
            """,
            (start, end),
        ):
            sym = str(r[0] or "").upper()
            if sym not in wanted:
                continue
            dt = _parse_date(r[1])
            if dt is None:
                continue
            typ = str(r[2] or "").lower()
            val = float(r[3] or 0.0)
            sign = 1.0 if ("buy" in typ or typ in {"p", "purchase"}) else -1.0 if ("sell" in typ or typ in {"s", "sale"}) else 0.0
            if sign:
                rows.append((sym, pd.Timestamp(dt.date()), sign * abs(val)))
    finally:
        con.close()
    return pd.DataFrame(rows, columns=["symbol", "date", "net_value"]) if rows else pd.DataFrame()


def window_crowd(daily: pd.DataFrame, asof: pd.Timestamp) -> Dict[str, Tuple[Optional[float], int]]:
    if daily.empty:
        return {}
    lo = asof - pd.Timedelta(days=CROWD_WIN_DAYS)
    sub = daily[(daily["date"] > lo) & (daily["date"] <= asof)]
    out = {}
    for sym, g in sub.groupby("symbol"):
        bull = int(g["bull"].sum())
        bear = int(g["bear"].sum())
        n = bull + bear
        out[sym] = ((bull / n) if n else None, n)
    return out


def window_insider(daily: pd.DataFrame, asof: pd.Timestamp) -> Dict[str, float]:
    if daily.empty:
        return {}
    lo = asof - pd.Timedelta(days=INSIDER_WIN_DAYS)
    sub = daily[(daily["date"] > lo) & (daily["date"] <= asof)]
    return {sym: float(g["net_value"].sum()) for sym, g in sub.groupby("symbol")}


def window_thesis(weekly: pd.DataFrame, asof: pd.Timestamp) -> Dict[str, Tuple[Optional[float], int, int, int]]:
    if weekly.empty:
        return {}
    wk = pd.Timestamp(week_start(asof.to_pydatetime()))
    sub = weekly[weekly["week"] == wk]
    return {
        str(r.symbol).upper(): (
            float(r.subst_z) if pd.notna(r.subst_z) else None,
            int(r.subst),
            int(r.sbull),
            int(r.sbear),
        )
        for r in sub.itertuples(index=False)
    }


def leg_score(
    eigen_z: Optional[float],
    price_ext_z: Optional[float],
    crowd_share: Optional[float],
    crowd_n: int,
    insider_net: float,
    thesis: Tuple[Optional[float], int, int, int],
) -> Tuple[float, List[Dict[str, Any]]]:
    legs: List[Dict[str, Any]] = []

    if eigen_z is not None and abs(eigen_z) >= 2.0:
        strength = min(abs(eigen_z) / 3.0, 1.5)
        legs.append({"name": "eigen", "dir": 1 if eigen_z > 0 else -1, "weight": 1.0, "strength": strength})

    if price_ext_z is not None:
        if price_ext_z >= 2.0:
            legs.append({"name": "price_extension", "dir": -1, "weight": 0.7, "strength": min(price_ext_z / 3.0, 1.3)})
        elif price_ext_z <= -2.0:
            legs.append({"name": "price_depressed", "dir": 1, "weight": 0.5, "strength": min(abs(price_ext_z) / 3.0, 1.0)})

    if crowd_share is not None and crowd_n >= 6:
        if crowd_share >= 0.60:
            legs.append({"name": "crowd_bullish", "dir": 1, "weight": 0.6, "strength": min((crowd_share - 0.5) / 0.25, 1.0)})
        elif crowd_share <= 0.40:
            legs.append({"name": "crowd_bearish", "dir": -1, "weight": 0.6, "strength": min((0.5 - crowd_share) / 0.25, 1.0)})

    if abs(insider_net) >= 1_000_000:
        strength = min(math.log10(abs(insider_net) / 1_000_000 + 1.0), 1.2)
        legs.append({"name": "insider", "dir": 1 if insider_net > 0 else -1, "weight": 0.8, "strength": strength})

    thesis_z, thesis_posts, sbull, sbear = thesis
    if thesis_z is not None and thesis_z >= THESIS_SPIKE_Z and thesis_posts >= THESIS_FLOOR and sbull != sbear:
        legs.append({"name": "thesis_proxy", "dir": 1 if sbull > sbear else -1, "weight": 0.9, "strength": min(thesis_z / 3.0, 1.3)})

    score = sum(float(x["dir"]) * float(x["weight"]) * float(x["strength"]) for x in legs)
    return score, legs


def forward_return(close: pd.DataFrame, symbol: str, asof: pd.Timestamp, horizon: int) -> Optional[float]:
    if symbol not in close.columns:
        return None
    idx = close.index.searchsorted(asof, side="right") - 1
    if idx < 0 or idx + horizon >= len(close.index):
        return None
    entry = close[symbol].iloc[idx]
    exit_price = close[symbol].iloc[idx + horizon]
    if pd.isna(entry) or pd.isna(exit_price) or entry <= 0:
        return None
    return float((exit_price / entry - 1.0) * 100.0)


def collect_observations(args: argparse.Namespace, horizons: Sequence[int]) -> List[StackObservation]:
    start = args.start_date
    end = args.end_date
    social_start = (pd.Timestamp(start) - pd.Timedelta(days=540)).date().isoformat()
    data_end = (pd.Timestamp(end) + pd.Timedelta(days=7)).date().isoformat()
    symbols = load_clean_symbols(args.max_symbols, include_social_covered=not args.no_social_union)
    market_caps = load_market_caps()
    close = load_close_panel(sorted(set(symbols + [BENCHMARK])), start)
    symbols = [s for s in symbols if s in close.columns and s != BENCHMARK]
    spy = close[BENCHMARK].dropna()
    formation_dates = monthly_formation_dates(spy, start, end)

    print(f"symbols={len(symbols)} formations={len(formation_dates)} price_panel={close.shape}", flush=True)
    print("Loading social/thesis features...", flush=True)
    weekly_social, daily_crowd = load_social_features(symbols, social_start, data_end)
    print(f"weekly_social={len(weekly_social)} daily_crowd={len(daily_crowd)}", flush=True)
    print("Loading insider features...", flush=True)
    insider_daily = load_insider_daily(symbols, social_start, data_end)
    print(f"insider_rows={len(insider_daily)}", flush=True)

    observations: List[StackObservation] = []
    for n, asof in enumerate(formation_dates, start=1):
        print(f"[{n}/{len(formation_dates)}] {asof.date()} scoring stack...", flush=True)
        eigen = compute_eigen_z(close, asof, symbols)
        if not eigen:
            continue
        scoped = list(eigen.keys())
        pext = compute_price_ext(close, asof, scoped)
        crowd = window_crowd(daily_crowd, asof)
        insider = window_insider(insider_daily, asof)
        thesis = window_thesis(weekly_social, asof)

        for sym in scoped:
            asof_price = close.loc[:asof, sym].dropna()
            if asof_price.empty:
                continue
            price = float(asof_price.iloc[-1])
            if price < args.min_price:
                continue
            market_cap = market_caps.get(sym)
            if market_cap is not None and market_cap < args.min_market_cap:
                continue
            tsh = thesis.get(sym, (None, 0, 0, 0))
            cshare, cn = crowd.get(sym, (None, 0))
            score, legs = leg_score(eigen.get(sym), pext.get(sym), cshare, cn, insider.get(sym, 0.0), tsh)
            if not legs or abs(score) < args.min_abs_score:
                continue
            aligned = sum(1 for leg in legs if (leg["dir"] > 0) == (score > 0))
            if aligned < args.min_aligned_legs:
                continue
            fwd = {h: forward_return(close, sym, asof, h) for h in horizons}
            spy_fwd = {h: forward_return(close, BENCHMARK, asof, h) for h in horizons}
            if all(v is None for v in fwd.values()):
                continue
            observations.append(StackObservation(
                symbol=sym,
                asof_date=asof.date().isoformat(),
                direction="bullish" if score > 0 else "bearish",
                score=round(score, 4),
                aligned_count=aligned,
                eigen_z=round(eigen[sym], 4) if sym in eigen else None,
                price_ext_z=round(pext[sym], 4) if sym in pext else None,
                crowd_share=round(cshare, 4) if cshare is not None else None,
                crowd_n=cn,
                insider_net_value=round(insider.get(sym, 0.0), 2),
                thesis_z=round(tsh[0], 4) if tsh[0] is not None else None,
                thesis_posts=tsh[1],
                legs_json=json.dumps(legs, separators=(",", ":")),
                forward_returns=fwd,
                spy_returns=spy_fwd,
            ))
    return observations


def summarize_bucket(observations: Sequence[StackObservation], horizon: int) -> Dict[str, Any]:
    signal_returns = []
    excess_returns = []
    for obs in observations:
        r = obs.forward_returns.get(horizon)
        spy = obs.spy_returns.get(horizon)
        if r is None:
            continue
        signed = r if obs.direction == "bullish" else -r
        signal_returns.append(signed)
        if spy is not None:
            excess_returns.append((r - spy) if obs.direction == "bullish" else (-r + spy))
    return {
        "n": len(signal_returns),
        "avg_signal_return_pct": round(_mean(signal_returns) or 0.0, 4) if signal_returns else None,
        "median_signal_return_pct": round(_median(signal_returns) or 0.0, 4) if signal_returns else None,
        "win_rate": round(sum(1 for x in signal_returns if x > 0) / len(signal_returns), 4) if signal_returns else None,
        "avg_vs_spy_pct": round(_mean(excess_returns) or 0.0, 4) if excess_returns else None,
        "median_vs_spy_pct": round(_median(excess_returns) or 0.0, 4) if excess_returns else None,
        "t_vs_spy": round(_t_stat(excess_returns) or 0.0, 4) if len(excess_returns) >= 3 else None,
    }


def summarize_portfolio(observations: Sequence[StackObservation], horizon: int, top_n: int, direction: str) -> Dict[str, Any]:
    by_date: Dict[str, List[StackObservation]] = defaultdict(list)
    for obs in observations:
        if obs.direction == direction and obs.forward_returns.get(horizon) is not None:
            by_date[obs.asof_date].append(obs)
    portfolio = []
    spy_rows = []
    for asof, rows in sorted(by_date.items()):
        rows = sorted(rows, key=lambda o: abs(o.score), reverse=True)[:top_n]
        if not rows:
            continue
        raw = [float(o.forward_returns[horizon]) for o in rows if o.forward_returns.get(horizon) is not None]
        spy_vals = [float(o.spy_returns[horizon]) for o in rows if o.spy_returns.get(horizon) is not None]
        if not raw:
            continue
        port_ret = statistics.mean(raw) if direction == "bullish" else statistics.mean([-x for x in raw])
        portfolio.append(port_ret)
        if spy_vals:
            spy_rows.append(statistics.mean(spy_vals))
    excess = [p - s for p, s in zip(portfolio, spy_rows)]
    return {
        "direction": direction,
        "formation_windows": len(portfolio),
        "top_n": top_n,
        "avg_return_pct": round(_mean(portfolio) or 0.0, 4) if portfolio else None,
        "median_return_pct": round(_median(portfolio) or 0.0, 4) if portfolio else None,
        "win_rate": round(sum(1 for x in portfolio if x > 0) / len(portfolio), 4) if portfolio else None,
        "avg_spy_same_windows_pct": round(_mean(spy_rows) or 0.0, 4) if spy_rows else None,
        "avg_vs_spy_pct": round(_mean(excess) or 0.0, 4) if excess else None,
        "median_vs_spy_pct": round(_median(excess) or 0.0, 4) if excess else None,
        "best_pct": round(max(portfolio), 4) if portfolio else None,
        "worst_pct": round(min(portfolio), 4) if portfolio else None,
    }


def write_observations_csv(path: Path, observations: Sequence[StackObservation], horizons: Sequence[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cols = [
        "symbol", "asof_date", "direction", "score", "aligned_count", "eigen_z",
        "price_ext_z", "crowd_share", "crowd_n", "insider_net_value",
        "thesis_z", "thesis_posts", "legs_json",
    ]
    for h in horizons:
        cols.extend([f"forward_{h}d_pct", f"spy_{h}d_pct"])
    with path.open("w", encoding="utf-8", newline="") as f:
        import csv

        writer = csv.DictWriter(f, fieldnames=cols)
        writer.writeheader()
        for obs in observations:
            row = {k: getattr(obs, k) for k in cols if hasattr(obs, k)}
            for h in horizons:
                row[f"forward_{h}d_pct"] = obs.forward_returns.get(h)
                row[f"spy_{h}d_pct"] = obs.spy_returns.get(h)
            writer.writerow(row)


def build_summary(args: argparse.Namespace, observations: Sequence[StackObservation], horizons: Sequence[int]) -> Dict[str, Any]:
    by_horizon = {}
    for h in horizons:
        buckets = {
            "all": summarize_bucket(observations, h),
            "bullish": summarize_bucket([o for o in observations if o.direction == "bullish"], h),
            "bearish": summarize_bucket([o for o in observations if o.direction == "bearish"], h),
        }
        for nlegs in (2, 3, 4, 5):
            sub = [o for o in observations if o.aligned_count >= nlegs]
            buckets[f"aligned_ge_{nlegs}"] = summarize_bucket(sub, h)
        by_horizon[str(h)] = {
            "buckets": buckets,
            "portfolios": {
                "bullish_top10": summarize_portfolio(observations, h, 10, "bullish"),
                "bullish_top20": summarize_portfolio(observations, h, 20, "bullish"),
                "bearish_short_top10": summarize_portfolio(observations, h, 10, "bearish"),
            },
        }
    return {
        "study": {
            "name": "full_convergence_stack_vs_spy",
            "script": "backend/scripts/run_full_convergence_stack_study.py",
            "start_date": args.start_date,
            "end_date": args.end_date,
            "max_symbols": args.max_symbols,
            "min_aligned_legs": args.min_aligned_legs,
            "min_abs_score": args.min_abs_score,
            "horizons": list(horizons),
            "min_price": args.min_price,
            "min_market_cap": args.min_market_cap,
            "llm_thesis_note": "LLM theses are not historically point-in-time; thesis leg is deterministic substantive-post proxy.",
            "costs": "No transaction costs, borrow costs, slippage, or beta hedging modeled.",
        },
        "coverage": {
            "observations": len(observations),
            "symbols": len({o.symbol for o in observations}),
            "formation_dates": len({o.asof_date for o in observations}),
            "direction_counts": {
                "bullish": sum(1 for o in observations if o.direction == "bullish"),
                "bearish": sum(1 for o in observations if o.direction == "bearish"),
            },
            "aligned_counts": {
                str(n): sum(1 for o in observations if o.aligned_count == n)
                for n in range(1, 6)
            },
        },
        "results": by_horizon,
        "top_examples": [
            {
                "symbol": o.symbol,
                "asof_date": o.asof_date,
                "direction": o.direction,
                "score": o.score,
                "aligned_count": o.aligned_count,
                "legs": json.loads(o.legs_json),
            }
            for o in sorted(observations, key=lambda x: abs(x.score), reverse=True)[:20]
        ],
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-date", default="2024-01-01")
    parser.add_argument("--end-date", default="2025-11-30")
    parser.add_argument("--horizons", default="126,252")
    parser.add_argument("--max-symbols", type=int, default=750)
    parser.add_argument("--min-aligned-legs", type=int, default=2)
    parser.add_argument("--min-abs-score", type=float, default=1.0)
    parser.add_argument("--min-price", type=float, default=1.0)
    parser.add_argument("--min-market-cap", type=float, default=25_000_000.0)
    parser.add_argument("--no-social-union", action="store_true")
    parser.add_argument("--output-json", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--output-csv", default=str(DEFAULT_OBS))
    args = parser.parse_args(argv)

    horizons = sorted({int(x.strip()) for x in str(args.horizons).split(",") if x.strip()})
    if not horizons:
        raise SystemExit("No horizons supplied.")

    observations = collect_observations(args, horizons)
    write_observations_csv(Path(args.output_csv), observations, horizons)
    summary = build_summary(args, observations, horizons)
    Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output_json).write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n=== Full convergence stack vs SPY ===")
    print(json.dumps(summary["coverage"], indent=2))
    for h in horizons:
        result = summary["results"][str(h)]
        print(f"\n--- Horizon {h} bars ---")
        for name, bucket in result["buckets"].items():
            print(
                f"{name:<14} n={bucket['n'] or 0:>5} "
                f"avg_sig={bucket['avg_signal_return_pct']} "
                f"avg_vs_spy={bucket['avg_vs_spy_pct']} "
                f"t={bucket['t_vs_spy']}"
            )
        for name, port in result["portfolios"].items():
            print(
                f"{name:<20} windows={port['formation_windows']:>3} "
                f"avg={port['avg_return_pct']} spy={port['avg_spy_same_windows_pct']} "
                f"vs_spy={port['avg_vs_spy_pct']} worst={port['worst_pct']}"
            )
    print(f"\nWrote {args.output_json}")
    print(f"Wrote {args.output_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
