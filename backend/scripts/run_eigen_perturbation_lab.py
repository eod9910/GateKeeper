#!/usr/bin/env python3
"""
Prototype eigenvalue/PCA perturbation lab.

This is intentionally a research script, not a live trading engine. It asks:
"Which clean-universe stocks are moving in a way that is poorly explained by
the dominant market factors?"

Inputs:
  - backend/data/universe_clean.json
  - backend/data/universe/*_1d.csv
  - optional overlays from options-flow.sqlite, market-intelligence.sqlite,
    and valuation_universe_snapshot.json

Outputs:
  - backend/data/research/eigen_perturbation_lab.latest.json
  - backend/data/research/eigen_perturbation_lab.latest.md
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UNIVERSE_PATH = DATA_DIR / "universe_clean.json"
PRICE_DIR = DATA_DIR / "universe"
RESEARCH_DIR = DATA_DIR / "research"
OPTIONS_DB = DATA_DIR / "options-flow.sqlite"
MARKET_INTEL_DB = DATA_DIR / "market-intelligence.sqlite"
EDGAR_DB = DATA_DIR / "edgar-filings.sqlite"
SOCIAL_INTEL_DB = DATA_DIR / "social-intelligence.sqlite"
VALUATION_SNAPSHOT = RESEARCH_DIR / "valuation_universe_snapshot.json"

# --- Fade-candidate composite ------------------------------------------------
# The one setup with statistical legs (run_dcf_funnel_study + _tmp_overvaluation_z):
# DCF overvalued + price stretched (>=2 sigma above own trend) + euphoric crowd
# underperforms peers ~-2.5% to -4% over 3 months (t~-2 to -3.4). The crowd leg
# is the differentiator — overvalued+stretched alone is ~flat; euphoria on top is
# what makes it fade. Crowd is perma-bull, so we require a real positive net share
# over a minimum count.
CROWD_SENT_WIN_DAYS = 45
FADE_CROWD_BULL_SHARE = 0.55   # bull / (bull+bear) among directional crowd posts
FADE_CROWD_MIN_POSTS = 6       # minimum directional posts to trust the read

# --- Fade entry timing (double-top / failed-retest) --------------------------
# The fade flag detects the CONDITION (overvalued+stretched+euphoric); this adds
# the price TRIGGER so the board doesn't tell you to short into a hole. The clean
# short is the double top: price tags the prior high, makes a lower high, then
# breaks the neckline (the trough between the two peaks).
FADE_TIMING_LOOKBACK = 252     # bars of context for the dominant peak (~1y)
FADE_TIMING_MIN_BARS = 60
FADE_NEAR_HIGH_PCT = 0.04      # within 4% of the prior high == "tagging" it
FADE_BROKEN_PCT = 0.12         # >=12% off the peak == it has actually corrected
FADE_INSIDER_SELL_USD = 1_000_000.0  # net open-market insider selling that confirms a fade

# --- Contrarian-bottom WATCH (forward paper-track, NOT yet backtested) -------
# Cheap (DCF undervalued) + crowd has turned bearish (capitulation) + an eigen
# DOWN move flagged it. We could NOT backtest this — the social sentiment feed is
# too thin before 2026 — so this is logged forward (mi_contrarian_watch) so we can
# evaluate it once the dense 2026+ crowd data has forward returns. Treat as a
# watchlist hypothesis, not a validated signal.
CONTRARIAN_UNDERVAL = 25.0     # gap >= this => undervalued
CONTRARIAN_BEAR_SHARE = 0.45   # crowd bull share <= this => bearish skew
CONTRARIAN_MIN_POSTS = 6       # min directional crowd posts to trust the mood
CONTRARIAN_EIGEN_DOWN = -2.0   # residual z <= this => idiosyncratic down move

# --- Convergence scoring -------------------------------------------------
# The convergence score is built ONLY from "footprint" signals: hard evidence
# that money or positioning has left a track. A setup's strength is how many
# uncorrelated observers agree on direction, weighted by how leading/reliable
# each source is. Eigen is the highest-weighted vote but NOT a required anchor.
#
# Social buzz is deliberately NOT a footprint vote. It answers a different
# question — "what's going on behind the scenes?" — and is handled as a
# narrative/discovery layer (see social-only discovery rows below).
FOOTPRINT_WEIGHTS: Dict[str, float] = {
    "eigen": 1.0,      # price footprint — most statistically valid, highest weight
    "insider": 0.8,    # Form 4 buys — high conviction, slightly lagged
    "activist": 0.8,   # 13D/13G stake building — high conviction
    "options": 0.7,    # derivatives positioning — near real-time
    "valuation": 0.5,  # is it even worth owning
}
# Lookback windows for the filing overlays (calendar days).
INSIDER_LOOKBACK_DAYS = 45
ACTIVIST_LOOKBACK_DAYS = 120
# Social-only discovery: a buzz spike with no hard footprint surfaces as a
# Tier-3 "narrative-only / unconfirmed watch" row.
SOCIAL_DISCOVERY_Z = 2.0

# --- Real Volume (eigen-volume) confirmation -----------------------------
# Idiosyncratic log-volume after removing the market-wide volume tide
# (single-factor cross-sectional demean), z-scored over a trailing window.
# Validated as a *confirmation filter* on eigen-price moves, NOT a standalone
# vote (run_breakout_volume_study.py): real-vol-confirmed breakouts carry
# t~3-4 forward excess at 6-12mo; real-vol-absent breakouts are a drag.
# Thresholds come from that study's buckets.
ZVOL_WIN = 120
REAL_VOL_CONFIRM = 0.5   # name-specific volume clearly elevated -> conviction
REAL_VOL_ABSENT = 0.0    # at/below the market tide -> breakout to skip

# --- Price extension (how stretched is the price vs its OWN history) ---------
# Sigma of current log-price above the stock's long-term log-LINEAR growth
# trend, fit over its full available history (point-in-time = the latest bar).
# Validated as a FADE input (run_dcf_funnel_study + _tmp_overvaluation_z):
# overvalued (DCF) + stretched (>=2 sigma) + euphoric crowd underperforms peers
# ~-4% over 3 months (t~-2.2). Stretch correlates ~0.25 with the DCF gap, so it
# is a complementary — not redundant — overvaluation read. Long-side: it does
# NOT separate winners, so this is a short/caution flag only.
PRICE_EXT_MIN_BARS = 120
PRICE_EXT_STRETCH = 2.0   # >= 2 sigma above own trend -> stretched (fade input)
PRICE_EXT_EXTREME = 3.0   # >= 3 sigma -> extended/exhaustion (strong fade input)


@dataclass
class SymbolMeta:
    symbol: str
    name: str = ""
    sector: Optional[str] = None
    industry: Optional[str] = None
    cap_tier: Optional[str] = None
    market_cap: Optional[float] = None


def safe_symbol(symbol: str) -> str:
    return symbol.replace("/", "_").replace("=", "_").replace("-", "_")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_clean_universe(path: Path) -> List[SymbolMeta]:
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    rows = payload.get("stocks") if isinstance(payload, dict) else payload
    out: List[SymbolMeta] = []
    for row in rows or []:
        symbol = str(row.get("symbol") or row.get("ticker") or "").upper().strip()
        if not symbol:
            continue
        out.append(SymbolMeta(
            symbol=symbol,
            name=str(row.get("name") or ""),
            sector=row.get("sector"),
            industry=row.get("industry"),
            cap_tier=row.get("market_cap_bucket") or row.get("cap_tier"),
            market_cap=float(row["market_cap"]) if row.get("market_cap") is not None else None,
        ))
    out.sort(key=lambda r: r.market_cap or 0.0, reverse=True)
    return out


def load_close_series(symbol: str, price_dir: Path, min_bars: int) -> Optional[pd.Series]:
    path = price_dir / f"{safe_symbol(symbol)}_1d.csv"
    if not path.exists():
        return None
    try:
        df = pd.read_csv(path, usecols=["date", "close"])
        if len(df) < min_bars:
            return None
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["close"] = pd.to_numeric(df["close"], errors="coerce")
        df = df.dropna(subset=["date", "close"]).drop_duplicates("date", keep="last")
        df = df.sort_values("date")
        if len(df) < min_bars:
            return None
        s = pd.Series(df["close"].to_numpy(dtype=float), index=df["date"], name=symbol)
        return s
    except Exception:
        return None


def load_volume_series(symbol: str, price_dir: Path, min_bars: int) -> Optional[pd.Series]:
    path = price_dir / f"{safe_symbol(symbol)}_1d.csv"
    if not path.exists():
        return None
    try:
        df = pd.read_csv(path, usecols=["date", "volume"])
        if len(df) < min_bars:
            return None
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
        df = df.dropna(subset=["date", "volume"]).drop_duplicates("date", keep="last")
        df = df.sort_values("date")
        if len(df) < min_bars:
            return None
        return pd.Series(df["volume"].to_numpy(dtype=float), index=df["date"], name=symbol)
    except Exception:
        return None


def compute_real_volume(
    symbols: Sequence[str],
    *,
    price_dir: Path,
    lookback: int,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """Latest-day Real Volume (eigen-volume) residual per symbol.

    For each symbol we z-score log-volume over a trailing ZVOL_WIN window, then
    subtract the cross-sectional mean z (the market-wide volume tide) on each
    day. The residual is the name-specific volume conviction. We report the
    latest day plus a 3-day slope and a confirmed/weak/absent state.
    """
    series: List[pd.Series] = []
    min_bars = ZVOL_WIN + 5
    for symbol in symbols:
        v = load_volume_series(symbol, price_dir, min_bars=min_bars)
        if v is not None:
            series.append(v)
    if len(series) < 20:
        return {}, {"symbols": len(series), "note": "insufficient volume coverage"}

    vol = pd.concat(series, axis=1).sort_index()
    vol = vol.tail(max(lookback, ZVOL_WIN) + 5)
    logv = np.log1p(vol)
    roll_mean = logv.rolling(ZVOL_WIN).mean()
    roll_std = logv.rolling(ZVOL_WIN).std().replace(0, np.nan)
    z = (logv - roll_mean) / roll_std
    market_factor = z.mean(axis=1)            # common volume tide per day
    resid = z.sub(market_factor, axis=0)      # idiosyncratic (single-factor demean)
    resid = resid.replace([np.inf, -np.inf], np.nan)
    resid = resid.dropna(axis=0, how="all")
    if resid.empty:
        return {}, {"symbols": 0, "note": "no residual rows"}

    latest = resid.iloc[-1]
    prior_3d = resid.iloc[-4:-1].mean(axis=0) if len(resid) >= 4 else None

    out: Dict[str, Dict[str, Any]] = {}
    for sym in latest.index:
        val = latest[sym]
        if val is None or not np.isfinite(val):
            continue
        val = float(val)
        slope = None
        if prior_3d is not None and np.isfinite(prior_3d.get(sym, np.nan)):
            slope = float(val - prior_3d[sym])
        state = "confirmed" if val > REAL_VOL_CONFIRM else ("absent" if val <= REAL_VOL_ABSENT else "weak")
        out[str(sym).upper()] = {
            "real_vol_z": round(val, 3),
            "real_vol_slope_3d": round(slope, 3) if slope is not None else None,
            "state": state,
        }
    meta = {
        "as_of": str(resid.index[-1].date()),
        "symbols": int(latest.notna().sum()),
        "zvol_window": ZVOL_WIN,
        "confirm_threshold": REAL_VOL_CONFIRM,
    }
    return out, meta


def compute_price_extension(
    symbols: Sequence[str],
    *,
    price_dir: Path,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """Per-symbol price-extension: how many sigma the latest close sits above
    (or below) the stock's own long-term log-linear price trend, fit over its
    full available history. A high positive z means the price has run far above
    its historical growth path — a stretched/exhaustion read used as a FADE
    input (strongest when the DCF also says overvalued and the crowd is bullish).
    """
    out: Dict[str, Dict[str, Any]] = {}
    used = 0
    latest_date: Optional[pd.Timestamp] = None
    for symbol in symbols:
        s = load_close_series(symbol, price_dir, min_bars=PRICE_EXT_MIN_BARS)
        if s is None or len(s) < PRICE_EXT_MIN_BARS:
            continue
        s = s[s > 0].dropna()
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
        if not np.isfinite(sd) or sd <= 0:
            continue
        z = float(resid[-1] / sd)
        if not np.isfinite(z):
            continue
        pmin = float(s.min())
        pmax = float(s.max())
        range_pos = (float(s.iloc[-1]) - pmin) / (pmax - pmin) if pmax > pmin else None
        if z >= PRICE_EXT_EXTREME:
            state = "extended"
        elif z >= PRICE_EXT_STRETCH:
            state = "stretched"
        elif z <= -PRICE_EXT_STRETCH:
            state = "depressed"
        else:
            state = "normal"
        out[str(symbol).upper()] = {
            "price_ext_z": round(z, 3),
            "range_pos": round(range_pos, 3) if range_pos is not None else None,
            "history_days": int(len(lp)),
            "state": state,
            "last_price": round(float(s.iloc[-1]), 4),
        }
        used += 1
        if latest_date is None or s.index[-1] > latest_date:
            latest_date = s.index[-1]
    meta = {
        "as_of": str(latest_date.date()) if latest_date is not None else None,
        "symbols": used,
        "stretch_threshold": PRICE_EXT_STRETCH,
        "extreme_threshold": PRICE_EXT_EXTREME,
    }
    return out, meta


def compute_fade_timing(
    symbols: Sequence[str],
    *,
    price_dir: Path,
) -> Dict[str, Dict[str, Any]]:
    """Per-symbol entry-timing state for a fade, derived from the price structure
    of the dominant recent peak (double-top / failed-retest logic):

      extended  - still pinned near the high; hasn't corrected -> don't chase
      broken    - corrected >=12% off the peak, no retest yet -> WAIT for retest
      retest    - rallied back within 4% of the prior high (a lower/equal high),
                  neckline intact -> ARMED, watch for rejection (right shoulder)
      confirmed - closed below the post-peak trough (neckline broken) -> TRIGGER

    Close-based and deterministic. Only meaningful for names the fade flag already
    surfaced; it answers "is this top actually setting up to short *now*?".
    """
    out: Dict[str, Dict[str, Any]] = {}
    for symbol in symbols:
        s = load_close_series(symbol, price_dir, min_bars=FADE_TIMING_MIN_BARS)
        if s is None:
            continue
        s = s[s > 0].dropna()
        if len(s) < FADE_TIMING_MIN_BARS:
            continue
        w = s.tail(FADE_TIMING_LOOKBACK)
        vals = w.to_numpy(dtype=float)
        n = len(vals)
        peak_idx = int(np.argmax(vals))
        peak = float(vals[peak_idx])
        last = float(vals[-1])
        if peak <= 0:
            continue
        drawdown = (last - peak) / peak
        bars_since_peak = n - 1 - peak_idx
        # Deepest trough after the peak == the neckline of a would-be double top.
        if peak_idx < n - 1:
            after = vals[peak_idx + 1:]
            trough_rel = int(np.argmin(after))
            trough_idx = peak_idx + 1 + trough_rel
            trough = float(vals[trough_idx])
        else:
            trough_idx = peak_idx
            trough = peak
        max_pullback = (trough - peak) / peak
        # Best rebound after the trough == the potential second top (right shoulder).
        if trough_idx < n - 1:
            reb = vals[trough_idx + 1:]
            reb_rel = int(np.argmax(reb))
            rebound_idx = trough_idx + 1 + reb_rel
            rebound = float(vals[rebound_idx])
        else:
            rebound_idx = trough_idx
            rebound = trough
        rebound_vs_peak = (rebound - peak) / peak  # <= 0 (peak is the window max)
        bars_since_rebound = n - 1 - rebound_idx

        has_broken = max_pullback <= -FADE_BROKEN_PCT
        retested = has_broken and rebound_vs_peak >= -FADE_NEAR_HIGH_PCT
        if not has_broken:
            state, action = "extended", "still at highs — don't chase"
        elif last < trough:
            state, action = "confirmed", "neckline broken — fade trigger"
        elif retested:
            state, action = "retest", "retesting prior high — armed, watch for rejection"
        else:
            state, action = "broken", "rolled over — WAIT for retest of the high"
        out[str(symbol).upper()] = {
            "state": state,
            "action": action,
            "peak": round(peak, 2),
            "last": round(last, 2),
            "drawdown_pct": round(drawdown * 100, 1),
            "max_pullback_pct": round(max_pullback * 100, 1),
            "rebound_vs_peak_pct": round(rebound_vs_peak * 100, 1),
            "neckline": round(trough, 2),
            "bars_since_peak": int(bars_since_peak),
            "bars_since_rebound": int(bars_since_rebound),
        }
    return out


def build_returns_matrix(
    symbols: Sequence[str],
    *,
    price_dir: Path,
    lookback: int,
    min_coverage: float,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    closes: List[pd.Series] = []
    min_bars = lookback + 2
    missing = 0
    short = 0
    for symbol in symbols:
        s = load_close_series(symbol, price_dir, min_bars=min_bars)
        if s is None:
            path = price_dir / f"{safe_symbol(symbol)}_1d.csv"
            if path.exists():
                short += 1
            else:
                missing += 1
            continue
        closes.append(s)

    if not closes:
        raise RuntimeError(f"No usable price CSVs found in {price_dir}")

    close_df = pd.concat(closes, axis=1).sort_index()
    returns = close_df.pct_change(fill_method=None)
    returns = returns.tail(lookback)
    min_non_null = max(10, int(math.ceil(len(returns) * min_coverage)))
    returns = returns.dropna(axis=1, thresh=min_non_null)
    returns = returns.dropna(axis=0, how="all")
    returns = returns.fillna(0.0)
    stats = {
        "requested_symbols": len(symbols),
        "loaded_price_series": len(closes),
        "missing_csv": missing,
        "too_short_or_invalid_csv": short,
        "usable_symbols": int(returns.shape[1]),
        "return_days": int(returns.shape[0]),
        "start_date": str(returns.index.min().date()) if len(returns.index) else None,
        "end_date": str(returns.index.max().date()) if len(returns.index) else None,
    }
    return returns, stats


def run_pca_residuals(returns: pd.DataFrame, n_factors: int) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    if returns.shape[0] < 20 or returns.shape[1] < 20:
        raise RuntimeError(f"Need at least 20 days and 20 symbols; got {returns.shape}")
    means = returns.mean(axis=0)
    stdevs = returns.std(axis=0).replace(0, np.nan)
    usable_cols = stdevs.dropna().index
    r = returns[usable_cols]
    means = means[usable_cols]
    stdevs = stdevs[usable_cols]
    x = ((r - means) / stdevs).to_numpy(dtype=float)
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)

    u, singular_values, vt = np.linalg.svd(x, full_matrices=False)
    k = max(1, min(n_factors, len(singular_values), x.shape[0] - 1, x.shape[1] - 1))
    reconstructed = (u[:, :k] * singular_values[:k]) @ vt[:k, :]
    residuals = x - reconstructed
    residual_df = pd.DataFrame(residuals, index=r.index, columns=r.columns)

    latest_date = residual_df.index[-1]
    latest_resid = residual_df.iloc[-1]
    residual_sigma = residual_df.std(axis=0).replace(0, np.nan)
    residual_z_df = residual_df.divide(residual_sigma, axis=1)
    residual_z = latest_resid / residual_sigma
    prev_residual_z_1d = residual_z_df.iloc[-2] if len(residual_z_df) >= 2 else pd.Series(index=r.columns, dtype=float)
    prev_residual_z_3d_mean = (
        residual_z_df.iloc[-4:-1].mean(axis=0)
        if len(residual_z_df) >= 4
        else pd.Series(index=r.columns, dtype=float)
    )
    residual_z_change_1d = residual_z - prev_residual_z_1d
    residual_z_slope_3d = residual_z - prev_residual_z_3d_mean
    actual_return = r.iloc[-1]
    factor_expected_std = pd.Series(reconstructed[-1, :], index=r.columns)
    factor_expected_return = factor_expected_std * stdevs + means

    total_variance = float(np.sum(singular_values ** 2))
    explained = [
        float((s ** 2) / total_variance) if total_variance > 0 else 0.0
        for s in singular_values[:k]
    ]
    out = pd.DataFrame({
        "symbol": r.columns,
        "residual_z": residual_z.reindex(r.columns).to_numpy(dtype=float),
        "prev_residual_z_1d": prev_residual_z_1d.reindex(r.columns).to_numpy(dtype=float),
        "residual_z_change_1d": residual_z_change_1d.reindex(r.columns).to_numpy(dtype=float),
        "residual_z_slope_3d": residual_z_slope_3d.reindex(r.columns).to_numpy(dtype=float),
        "latest_residual_std": latest_resid.reindex(r.columns).to_numpy(dtype=float),
        "actual_return_pct": (actual_return.reindex(r.columns) * 100.0).to_numpy(dtype=float),
        "factor_expected_return_pct": (factor_expected_return.reindex(r.columns) * 100.0).to_numpy(dtype=float),
        "unexplained_return_pct": ((actual_return - factor_expected_return).reindex(r.columns) * 100.0).to_numpy(dtype=float),
    })
    out["abs_residual_z"] = out["residual_z"].abs()
    out = out.replace([np.inf, -np.inf], np.nan).dropna(subset=["residual_z"])
    out = out.sort_values("abs_residual_z", ascending=False)
    meta = {
        "latest_date": str(latest_date.date()),
        "factors_used": k,
        "explained_variance_by_factor": explained,
        "explained_variance_total": float(sum(explained)),
        "top_eigenvalue_share": explained[0] if explained else 0.0,
        "symbols_in_model": int(len(r.columns)),
        "days_in_model": int(len(r.index)),
    }
    return out, meta


def latest_options_overlay(db_path: Path) -> Dict[str, Dict[str, Any]]:
    if not db_path.exists():
        return {}
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT o.*
            FROM options_daily_snapshot o
            JOIN (
              SELECT symbol, MAX(trade_date) AS max_date
              FROM options_daily_snapshot
              GROUP BY symbol
            ) m ON m.symbol = o.symbol AND m.max_date = o.trade_date
            """
        ).fetchall()
    except Exception:
        return {}
    finally:
        conn.close()
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        calls = float(r["total_call_volume"] or 0)
        puts = float(r["total_put_volume"] or 0)
        pc = float(r["put_call_volume_ratio"]) if r["put_call_volume_ratio"] is not None else (puts / calls if calls > 0 else None)
        cp = calls / puts if puts > 0 else None
        dominant = max(pc or 0.0, cp or 0.0)
        bias = "put_heavy" if pc is not None and pc >= 1.3 else "call_heavy" if cp is not None and cp >= 1.3 else "balanced"
        tier = "absurd" if dominant >= 20 else "extreme" if dominant >= 5 else "heavy" if dominant >= 2 else "elevated" if dominant >= 1.3 else "normal"
        out[str(r["symbol"]).upper()] = {
            "trade_date": r["trade_date"],
            "put_call_ratio": pc,
            "call_put_ratio": cp,
            "flow_bias": bias,
            "imbalance_tier": tier,
            "put_volume": int(puts),
            "call_volume": int(calls),
            "anomaly_score": float(r["anomaly_score"] or 0.0),
            "anomaly_flags": json.loads(r["anomaly_flags"] or "[]"),
        }
    return out


def latest_social_overlay(db_path: Path) -> Dict[str, Dict[str, Any]]:
    if not db_path.exists():
        return {}
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT p.*
            FROM universe_symbol_perturbations p
            JOIN (
              SELECT symbol, MAX(day) AS max_day
              FROM universe_symbol_perturbations
              GROUP BY symbol
            ) m ON m.symbol = p.symbol AND m.max_day = p.day
            ORDER BY p.perturbation_score DESC
            """
        ).fetchall()
    except Exception:
        return {}
    finally:
        conn.close()
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        symbol = str(r["symbol"]).upper()
        existing = out.get(symbol)
        score = float(r["perturbation_score"] or 0.0)
        if existing and existing.get("perturbation_score", 0.0) >= score:
            continue
        out[symbol] = {
            "day": int(r["day"]),
            "source": f"{r['source_type']} / {r['source_community']}",
            "mention_count": int(r["mention_count"] or 0),
            "z_score": float(r["z_score"] or 0.0),
            "perturbation_score": score,
            "discovery_count": int(r["discovery_count"] or 0),
            "confirmation_count": int(r["confirmation_count"] or 0),
        }
    return out


def latest_crowd_sentiment(db_path: Path, lookback_days: int = CROWD_SENT_WIN_DAYS) -> Dict[str, Dict[str, Any]]:
    """Per-symbol crowd mood: net bullish share of directional social posts over a
    trailing window. Used as the 'euphoric crowd' leg of the fade composite (and a
    standalone read of where the perma-bull crowd actually stands). Bullish-skew is
    the norm, so the fade gate requires a clear positive share over a min count."""
    if not db_path.exists():
        return {}
    cur_cut = (datetime.now(timezone.utc) - pd.Timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    prev_cut = (datetime.now(timezone.utc) - pd.Timedelta(days=2 * lookback_days)).strftime("%Y-%m-%d")
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except Exception:
        return {}
    try:
        rows = conn.execute(
            """
            SELECT UPPER(symbol) AS sym, sentiment_label AS lbl,
                   SUM(CASE WHEN trade_date >= ? THEN 1 ELSE 0 END) AS cur_n,
                   SUM(CASE WHEN trade_date >= ? AND trade_date < ? THEN 1 ELSE 0 END) AS prev_n
            FROM social_post_sentiment
            WHERE trade_date >= ? AND sentiment_label IN ('bullish','bearish')
            GROUP BY UPPER(symbol), sentiment_label
            """,
            (cur_cut, prev_cut, cur_cut, prev_cut),
        ).fetchall()
    except Exception:
        return {}
    finally:
        conn.close()
    agg: Dict[str, Dict[str, int]] = {}
    for sym, lbl, cur_n, prev_n in rows:
        cur = agg.setdefault(str(sym).upper(), {"bull": 0, "bear": 0, "pbull": 0, "pbear": 0})
        if lbl == "bullish":
            cur["bull"] += int(cur_n or 0); cur["pbull"] += int(prev_n or 0)
        elif lbl == "bearish":
            cur["bear"] += int(cur_n or 0); cur["pbear"] += int(prev_n or 0)
    out: Dict[str, Dict[str, Any]] = {}
    for sym, c in agg.items():
        ndir = c["bull"] + c["bear"]
        if ndir <= 0:
            continue
        share = c["bull"] / ndir
        mood = "bullish" if share >= 0.55 else ("bearish" if share <= 0.45 else "mixed")
        prev_n = c["pbull"] + c["pbear"]
        prev_share = (c["pbull"] / prev_n) if prev_n > 0 else None
        # capitulation: crowd was bullish last window, turned bearish this window
        flip_to_bear = bool(prev_share is not None and prev_share >= 0.55 and share <= 0.45)
        out[sym] = {
            "bull": c["bull"], "bear": c["bear"],
            "n_directional": ndir,
            "net_bull_share": round(share, 3),
            "mood": mood,
            "window_days": lookback_days,
            "prev_n_directional": prev_n,
            "prev_bull_share": round(prev_share, 3) if prev_share is not None else None,
            "flip_to_bear": flip_to_bear,
        }
    return out


def assess_fade_candidate(
    valuation: Optional[Dict[str, Any]],
    price_extension: Optional[Dict[str, Any]],
    crowd: Optional[Dict[str, Any]],
    insider: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Compose the backtested fade setup: DCF overvalued + price stretched
    (>=2 sigma above its own trend) + euphoric crowd. Returns the leg breakdown
    plus a 'candidate' flag (all three) so the board can surface shorts directly.

    Insider selling-into-strength (net open-market distribution) is a fourth
    CONFIRMING leg: it can stand in for the crowd leg (so a fade still fires when
    social data is thin but insiders are dumping) and upgrades confidence to
    'strong' when it stacks on top of an euphoric crowd."""
    gap = None
    if valuation:
        try:
            gap = float(valuation.get("valuation_gap_pct")) if valuation.get("valuation_gap_pct") is not None else None
        except (TypeError, ValueError):
            gap = None
    overvalued = bool(valuation and (
        str(valuation.get("valuation_state") or "") == "overvalued" or (gap is not None and gap <= -25.0)
    ))
    pe_z = None
    if price_extension and price_extension.get("price_ext_z") is not None:
        try:
            pe_z = float(price_extension.get("price_ext_z"))
        except (TypeError, ValueError):
            pe_z = None
    stretched = bool(pe_z is not None and pe_z >= PRICE_EXT_STRETCH)
    crowd_n = int((crowd or {}).get("n_directional") or 0)
    crowd_share = (crowd or {}).get("net_bull_share")
    crowd_bullish = bool(
        crowd and crowd_n >= FADE_CROWD_MIN_POSTS
        and crowd_share is not None and float(crowd_share) >= FADE_CROWD_BULL_SHARE
    )
    sell_value = 0.0
    net_value = 0.0
    if insider:
        try:
            sell_value = float(insider.get("sell_value") or 0.0)
            net_value = float(insider.get("net_value") or 0.0)
        except (TypeError, ValueError):
            sell_value, net_value = 0.0, 0.0
    insider_selling = bool(sell_value >= FADE_INSIDER_SELL_USD and net_value < 0)
    # Only emit when the eigen move is already on the board AND at least the two
    # hard legs (overvalued + stretched) fire. The confirming third leg can be
    # an euphoric crowd OR insiders distributing into the strength.
    if not (overvalued and stretched):
        return None
    candidate = overvalued and stretched and (crowd_bullish or insider_selling)
    legs = {
        "overvalued": overvalued,
        "stretched": stretched,
        "crowd_bullish": crowd_bullish,
        "insider_selling": insider_selling,
    }
    if candidate and crowd_bullish and insider_selling:
        confidence = "strong"
    elif candidate:
        confidence = "high"
    else:
        confidence = "partial"
    detail = []
    if gap is not None:
        detail.append(f"DCF {round(gap)}%")
    elif overvalued:
        detail.append("DCF overvalued")
    if pe_z is not None:
        detail.append(f"price +{pe_z:.1f}\u03c3 vs trend")
    if crowd and crowd_share is not None:
        detail.append(f"crowd {round(float(crowd_share) * 100)}% bull (n={crowd_n})")
    if insider_selling:
        detail.append(f"insider selling ${sell_value/1e6:.1f}M")
    return {
        "candidate": candidate,
        "confidence": confidence,
        "legs": legs,
        "detail": "; ".join(detail),
    }


def assess_contrarian_watch(
    valuation: Optional[Dict[str, Any]],
    crowd: Optional[Dict[str, Any]],
    residual_z: Optional[float],
) -> Optional[Dict[str, Any]]:
    """Contrarian-bottom WATCH: undervalued + bearish/capitulating crowd + eigen
    DOWN. Forward-tracking hypothesis only (see CONTRARIAN_* note). Emits whenever
    undervalued + eigen-down fire so the crowd leg can be evaluated forward."""
    gap = None
    if valuation and valuation.get("valuation_gap_pct") is not None:
        try:
            gap = float(valuation.get("valuation_gap_pct"))
        except (TypeError, ValueError):
            gap = None
    undervalued = bool(valuation and (
        str(valuation.get("valuation_state") or "") == "undervalued" or (gap is not None and gap >= CONTRARIAN_UNDERVAL)
    ))
    eigen_down = bool(residual_z is not None and math.isfinite(residual_z) and residual_z <= CONTRARIAN_EIGEN_DOWN)
    if not (undervalued and eigen_down):
        return None
    crowd_n = int((crowd or {}).get("n_directional") or 0)
    share = (crowd or {}).get("net_bull_share")
    bearish = bool(crowd and crowd_n >= CONTRARIAN_MIN_POSTS and share is not None and float(share) <= CONTRARIAN_BEAR_SHARE)
    flip = bool((crowd or {}).get("flip_to_bear"))
    watch = bool(undervalued and eigen_down and (bearish or flip))
    legs = {"undervalued": undervalued, "eigen_down": eigen_down, "crowd_bearish": bearish, "crowd_flip_to_bear": flip}
    detail = []
    if gap is not None:
        detail.append(f"DCF +{round(gap)}%")
    if residual_z is not None and math.isfinite(residual_z):
        detail.append(f"eigen {residual_z:+.1f}\u03c3")
    if crowd and share is not None:
        detail.append(f"crowd {round(float(share) * 100)}% bull (n={crowd_n})" + (", FLIPPED" if flip else ""))
    return {
        "watch": watch,
        "confidence": "watch" if watch else "partial",
        "legs": legs,
        "detail": "; ".join(detail),
    }


def latest_insider_overlay(db_path: Path, lookback_days: int = INSIDER_LOOKBACK_DAYS) -> Dict[str, Dict[str, Any]]:
    """Aggregate recent Form 4 insider activity per symbol (buys vs sells)."""
    if not db_path.exists():
        return {}
    cutoff = (datetime.now(timezone.utc) - pd.Timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT symbol,
                   transaction_type,
                   COUNT(*)                AS txn_count,
                   COALESCE(SUM(total_value), 0) AS total_value,
                   MAX(filing_date)        AS last_filing_date
            FROM insider_transactions
            WHERE filing_date >= ? AND symbol IS NOT NULL
            GROUP BY symbol, transaction_type
            """,
            (cutoff,),
        ).fetchall()
    except Exception:
        return {}
    finally:
        conn.close()
    agg: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        symbol = str(r["symbol"]).upper()
        cur = agg.setdefault(symbol, {
            "buy_count": 0, "sell_count": 0,
            "buy_value": 0.0, "sell_value": 0.0,
            "last_filing_date": None,
        })
        ttype = str(r["transaction_type"] or "").upper()
        if ttype == "P":  # purchase / acquired
            cur["buy_count"] += int(r["txn_count"] or 0)
            cur["buy_value"] += float(r["total_value"] or 0.0)
        elif ttype == "S":  # sale / disposed
            cur["sell_count"] += int(r["txn_count"] or 0)
            cur["sell_value"] += float(r["total_value"] or 0.0)
        if r["last_filing_date"] and (cur["last_filing_date"] is None or r["last_filing_date"] > cur["last_filing_date"]):
            cur["last_filing_date"] = r["last_filing_date"]
    for cur in agg.values():
        cur["net_value"] = cur["buy_value"] - cur["sell_value"]
    return agg


def latest_activist_overlay(db_path: Path, lookback_days: int = ACTIVIST_LOOKBACK_DAYS) -> Dict[str, Dict[str, Any]]:
    """Latest 13D/13G activist / large-holder stake per symbol."""
    if not db_path.exists():
        return {}
    cutoff = (datetime.now(timezone.utc) - pd.Timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT symbol, filer_name, form_type, percent_owned, shares_held, filing_date
            FROM activist_stakes
            WHERE filing_date >= ? AND symbol IS NOT NULL
            ORDER BY filing_date DESC
            """,
            (cutoff,),
        ).fetchall()
    except Exception:
        return {}
    finally:
        conn.close()
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        symbol = str(r["symbol"]).upper()
        if symbol in out:
            continue  # keep most recent only
        form_type = str(r["form_type"] or "")
        out[symbol] = {
            "filer_name": r["filer_name"],
            "form_type": form_type,
            "is_activist": form_type.upper().startswith("SC 13D"),  # 13D = activist, 13G = passive
            "percent_owned": float(r["percent_owned"]) if r["percent_owned"] is not None else None,
            "filing_date": r["filing_date"],
        }
    return out


def valuation_overlay(path: Path) -> Dict[str, Dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return {}
    rows = payload.get("rows") if isinstance(payload, dict) else payload
    out = {}
    for r in rows or []:
        symbol = str(r.get("symbol") or "").upper()
        if symbol:
            out[symbol] = {
                "valuation_state": r.get("valuation_state"),
                "valuation_gap_pct": r.get("valuation_gap_pct"),
                "quality_grade": r.get("quality_grade"),
                "company_type": r.get("company_type"),
                "valuation_engine_class": r.get("valuation_engine_class"),
            }
    return out


def _clamp(value: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _eigen_strength(residual_z: Optional[float]) -> float:
    if residual_z is None or not math.isfinite(residual_z):
        return 0.0
    # ~3 sigma maps to full strength; sign carries direction.
    return _clamp(residual_z / 3.0)


def _options_strength(opt: Optional[Dict[str, Any]]) -> float:
    if not opt:
        return 0.0
    tier_mag = {"normal": 0.0, "elevated": 0.3, "heavy": 0.5, "extreme": 0.8, "absurd": 1.0}
    mag = tier_mag.get(str(opt.get("imbalance_tier") or "normal"), 0.0)
    bias = str(opt.get("flow_bias") or "balanced")
    if bias == "call_heavy":
        return mag
    if bias == "put_heavy":
        return -mag
    return 0.0


def _insider_strength(ins: Optional[Dict[str, Any]]) -> float:
    if not ins:
        return 0.0
    buy_count = int(ins.get("buy_count") or 0)
    sell_count = int(ins.get("sell_count") or 0)
    net_value = float(ins.get("net_value") or 0.0)
    if buy_count == 0 and sell_count == 0:
        return 0.0
    if net_value > 0 or (buy_count > sell_count):
        return _clamp(0.4 + 0.2 * buy_count + min(0.3, abs(net_value) / 2_000_000.0))
    if net_value < 0 or (sell_count > buy_count):
        return -_clamp(0.4 + 0.2 * sell_count + min(0.3, abs(net_value) / 2_000_000.0))
    return 0.0


def _activist_strength(act: Optional[Dict[str, Any]]) -> float:
    if not act:
        return 0.0
    # A new large-stake filing is accumulation — directionally bullish.
    base = 0.8 if act.get("is_activist") else 0.5
    pct = act.get("percent_owned")
    if pct is not None and pct >= 10.0:
        base = min(1.0, base + 0.2)
    return base


def _social_strength(soc: Optional[Dict[str, Any]]) -> float:
    if not soc:
        return 0.0
    # Demand attention is treated as a weak positive lean (Phase 2 will split
    # consumer-demand velocity from ticker-chatter). Magnitude from z-score.
    z = float(soc.get("z_score") or 0.0)
    return _clamp(max(0.0, z) / 3.0)


def _valuation_strength(val: Optional[Dict[str, Any]]) -> float:
    if not val:
        return 0.0
    state = str(val.get("valuation_state") or "").lower()
    gap = val.get("valuation_gap_pct")
    mag = min(1.0, abs(float(gap)) / 50.0) if gap is not None else 0.5
    if "under" in state:
        return mag
    if "over" in state:
        return -mag
    return 0.0


HIGH_CONVICTION_SOURCES = {"eigen", "options", "insider", "activist"}


def compute_convergence(rec: Dict[str, Any]) -> Dict[str, Any]:
    """Weighted convergence of independent FOOTPRINT signals for one symbol.

    Footprints are hard evidence that money/positioning has left a track:
    eigen price residual, insider buys, 13D/G stakes, options flow, valuation.
    Eigen is the highest-weighted vote but not a required anchor.

    Social buzz is intentionally excluded from the score — it is carried as
    non-voting context and drives the separate narrative/discovery layer.
    """
    strengths = {
        "eigen": _eigen_strength(rec.get("residual_z")),
        "options": _options_strength(rec.get("options_flow")),
        "insider": _insider_strength(rec.get("insider")),
        "activist": _activist_strength(rec.get("activist")),
        "valuation": _valuation_strength(rec.get("valuation")),
    }
    votes: List[Dict[str, Any]] = []
    raw = 0.0
    for source, strength in strengths.items():
        weight = FOOTPRINT_WEIGHTS.get(source, 0.0)
        weighted = weight * strength
        raw += weighted
        if abs(strength) > 1e-6:
            votes.append({
                "source": source,
                "weight": weight,
                "strength": round(strength, 3),
                "weighted": round(weighted, 3),
            })

    direction = "bullish" if raw > 1e-6 else "bearish" if raw < -1e-6 else "neutral"
    sign = 1.0 if raw > 0 else -1.0 if raw < 0 else 0.0

    aligned = [v for v in votes if sign != 0.0 and (v["strength"] > 0) == (sign > 0) and abs(v["weighted"]) >= 0.1]
    aligned_count = len(aligned)
    strong_aligned = [v for v in aligned if v["source"] in HIGH_CONVICTION_SOURCES and abs(v["weighted"]) >= 0.3]

    max_raw = sum(FOOTPRINT_WEIGHTS.values())  # ~3.8
    convergence_score = round(min(100.0, abs(raw) / max_raw * 100.0), 1)

    if aligned_count >= 3:
        tier = 1  # convergence — act
    elif aligned_count == 2 or len(strong_aligned) >= 1:
        tier = 2  # single strong footprint — watch
    else:
        tier = 3  # weak footprint — background

    # Non-voting social context: answers "what's going on behind the scenes?"
    soc = rec.get("social_arb") or {}
    social_context = None
    if soc:
        social_context = {
            "z_score": float(soc.get("z_score") or 0.0),
            "perturbation_score": float(soc.get("perturbation_score") or 0.0),
            "source": soc.get("source"),
        }

    return {
        "direction": direction,
        "convergence_score": convergence_score,
        "aligned_count": aligned_count,
        "tier": tier,
        "votes": votes,
        "narrative_only": False,
        "social_context": social_context,
    }


def attach_overlays(
    ranked: pd.DataFrame,
    metas: Dict[str, SymbolMeta],
    options: Dict[str, Dict[str, Any]],
    social: Dict[str, Dict[str, Any]],
    valuations: Dict[str, Dict[str, Any]],
    insiders: Dict[str, Dict[str, Any]],
    activists: Dict[str, Dict[str, Any]],
    real_volumes: Dict[str, Dict[str, Any]],
    price_extensions: Optional[Dict[str, Dict[str, Any]]] = None,
    crowd_sentiments: Optional[Dict[str, Dict[str, Any]]] = None,
    fade_timings: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for row in ranked.to_dict(orient="records"):
        symbol = str(row["symbol"]).upper()
        meta = metas.get(symbol)
        rec: Dict[str, Any] = {
            "symbol": symbol,
            "name": meta.name if meta else "",
            "sector": meta.sector if meta else None,
            "industry": meta.industry if meta else None,
            "cap_tier": meta.cap_tier if meta else None,
            "market_cap": meta.market_cap if meta else None,
            "residual_z": float(row["residual_z"]),
            "prev_residual_z_1d": float(row["prev_residual_z_1d"]) if row.get("prev_residual_z_1d") is not None and math.isfinite(float(row["prev_residual_z_1d"])) else None,
            "residual_z_change_1d": float(row["residual_z_change_1d"]) if row.get("residual_z_change_1d") is not None and math.isfinite(float(row["residual_z_change_1d"])) else None,
            "residual_z_slope_3d": float(row["residual_z_slope_3d"]) if row.get("residual_z_slope_3d") is not None and math.isfinite(float(row["residual_z_slope_3d"])) else None,
            "abs_residual_z": float(row["abs_residual_z"]),
            "actual_return_pct": float(row["actual_return_pct"]),
            "factor_expected_return_pct": float(row["factor_expected_return_pct"]),
            "unexplained_return_pct": float(row["unexplained_return_pct"]),
        }
        rec["options_flow"] = options.get(symbol)
        rec["social_arb"] = social.get(symbol)
        rec["valuation"] = valuations.get(symbol)
        rec["insider"] = insiders.get(symbol)
        rec["activist"] = activists.get(symbol)
        rec["real_volume"] = real_volumes.get(symbol)
        rec["price_extension"] = (price_extensions or {}).get(symbol)
        rec["crowd_sentiment"] = (crowd_sentiments or {}).get(symbol)
        rec["fade"] = assess_fade_candidate(
            rec.get("valuation"), rec.get("price_extension"), rec.get("crowd_sentiment"), rec.get("insider")
        )
        if rec["fade"] is not None:
            rec["fade"]["timing"] = (fade_timings or {}).get(symbol)
        rec["contrarian"] = assess_contrarian_watch(
            rec.get("valuation"), rec.get("crowd_sentiment"), rec.get("residual_z")
        )
        rec["cross_signal_count"] = sum(
            1 for key in ("options_flow", "social_arb", "valuation", "insider", "activist") if rec.get(key)
        )
        rec["convergence"] = compute_convergence(rec)
        records.append(rec)
    return records


def is_footprint_setup(rec: Dict[str, Any]) -> bool:
    """A row earns the board on hard footprints: 2+ aligned votes, a
    meaningful eigen residual, or a non-trivial convergence score."""
    conv = rec.get("convergence") or {}
    aligned = int(conv.get("aligned_count") or 0)
    score = float(conv.get("convergence_score") or 0.0)
    abs_z = float(rec.get("abs_residual_z") or 0.0)
    return aligned >= 2 or abs_z >= 2.0 or score >= 20.0


def build_social_discovery_rows(
    social: Dict[str, Dict[str, Any]],
    covered_symbols: set,
    metas: Dict[str, SymbolMeta],
    min_z: float = SOCIAL_DISCOVERY_Z,
) -> List[Dict[str, Any]]:
    """Social-only discovery: buzz spikes with no hard footprint surface as
    Tier-3 'narrative-only / unconfirmed watch' rows. Direction is 'watch'
    because attention is not directional — the story explains it, not a vote.
    """
    rows: List[Dict[str, Any]] = []
    for symbol, soc in (social or {}).items():
        sym = str(symbol).upper()
        if sym in covered_symbols:
            continue  # already a footprint setup — social shows there as context
        z = float(soc.get("z_score") or 0.0)
        if z < min_z:
            continue
        meta = metas.get(sym)
        score = round(min(40.0, z * 8.0), 1)  # capped so it never outranks footprints
        rows.append({
            "symbol": sym,
            "name": meta.name if meta else "",
            "sector": meta.sector if meta else None,
            "residual_z": None,
            "abs_residual_z": 0.0,
            "options_flow": None,
            "social_arb": soc,
            "valuation": None,
            "insider": None,
            "activist": None,
            "cross_signal_count": 1,
            "convergence": {
                "direction": "watch",
                "convergence_score": score,
                "aligned_count": 0,
                "tier": 3,
                "votes": [],
                "narrative_only": True,
                "social_context": {
                    "z_score": z,
                    "perturbation_score": float(soc.get("perturbation_score") or 0.0),
                    "source": soc.get("source"),
                },
            },
        })
    rows.sort(key=lambda r: r["convergence"]["convergence_score"], reverse=True)
    return rows


def write_markdown(path: Path, payload: Dict[str, Any], rows: Sequence[Dict[str, Any]]) -> None:
    lines = [
        "# Eigen Perturbation Lab",
        "",
        f"Generated: `{payload['meta']['generated_at']}`",
        f"Price window: `{payload['pca']['return_start_date']}` to `{payload['pca']['return_end_date']}`",
        f"Symbols in model: `{payload['pca']['symbols_in_model']}`",
        f"Factors used: `{payload['pca']['factors_used']}`",
        f"Explained variance total: `{payload['pca']['explained_variance_total']:.1%}`",
        f"Top eigenvalue share: `{payload['pca']['top_eigenvalue_share']:.1%}`",
        "",
        "## Top Residual Movers",
        "",
        "| Symbol | Resid Z | Actual | Expected | Unexplained | Options | Social | Valuation |",
        "|---|---:|---:|---:|---:|---|---|---|",
    ]
    for r in rows[:25]:
        opt = r.get("options_flow") or {}
        soc = r.get("social_arb") or {}
        val = r.get("valuation") or {}
        opt_s = ""
        if opt:
            ratio = opt.get("put_call_ratio") if opt.get("flow_bias") == "put_heavy" else opt.get("call_put_ratio")
            opt_s = f"{opt.get('flow_bias')} {opt.get('imbalance_tier')} {ratio:.1f}x" if ratio else str(opt.get("flow_bias"))
        soc_s = f"{soc.get('source')} score {soc.get('perturbation_score'):.1f}" if soc else ""
        val_s = f"{val.get('valuation_state')} {val.get('valuation_gap_pct'):.1f}%" if val and val.get("valuation_gap_pct") is not None else (val.get("valuation_state") if val else "")
        lines.append(
            f"| {r['symbol']} | {r['residual_z']:.2f} | {r['actual_return_pct']:.2f}% | "
            f"{r['factor_expected_return_pct']:.2f}% | {r['unexplained_return_pct']:.2f}% | "
            f"{opt_s} | {soc_s} | {val_s} |"
        )
    lines.append("")
    lines.append("## Notes")
    lines.append("")
    lines.append("- This is a research prototype, not a trading signal.")
    lines.append("- Positive residuals mean the stock outperformed its factor-expected move; negative residuals mean it underperformed.")
    lines.append("- The model uses the local universe CSV cache; verify the price window before treating a run as live.")
    path.write_text("\n".join(lines), encoding="utf-8")


CONVERGENCE_SCHEMA = """
CREATE TABLE IF NOT EXISTS mi_convergence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    as_of TEXT,
    symbol TEXT NOT NULL,
    name TEXT,
    sector TEXT,
    residual_z REAL,
    direction TEXT,
    convergence_score REAL,
    tier INTEGER,
    aligned_count INTEGER,
    signal_count INTEGER,
    narrative_only INTEGER DEFAULT 0,
    votes_json TEXT,
    overlays_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_mi_convergence_run ON mi_convergence(run_id);
CREATE INDEX IF NOT EXISTS idx_mi_convergence_symbol ON mi_convergence(symbol);
CREATE INDEX IF NOT EXISTS idx_mi_convergence_score ON mi_convergence(convergence_score DESC);
"""


def write_convergence_db(
    db_path: Path,
    rows: Sequence[Dict[str, Any]],
    run_id: str,
    generated_at: str,
    as_of: Optional[str],
) -> int:
    """Persist the already-selected convergence rows (footprint setups plus
    social-only narrative-discovery rows) to market-intelligence.sqlite."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(CONVERGENCE_SCHEMA)
        # Lightweight migration for DBs created before narrative_only existed.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(mi_convergence)").fetchall()}
        if "narrative_only" not in cols:
            conn.execute("ALTER TABLE mi_convergence ADD COLUMN narrative_only INTEGER DEFAULT 0")
        written = 0
        for rec in rows:
            conv = rec.get("convergence") or {}
            overlays = {
                "options_flow": rec.get("options_flow"),
                "social_arb": rec.get("social_arb"),
                "valuation": rec.get("valuation"),
                "insider": rec.get("insider"),
                "activist": rec.get("activist"),
                "real_volume": rec.get("real_volume"),
                "price_extension": rec.get("price_extension"),
                "crowd_sentiment": rec.get("crowd_sentiment"),
                "fade": rec.get("fade"),
                "contrarian": rec.get("contrarian"),
                "residual_z_change_1d": rec.get("residual_z_change_1d"),
                "residual_z_slope_3d": rec.get("residual_z_slope_3d"),
                "unexplained_return_pct": rec.get("unexplained_return_pct"),
                "social_context": conv.get("social_context"),
            }
            conn.execute(
                """
                INSERT INTO mi_convergence (
                    run_id, generated_at, as_of, symbol, name, sector,
                    residual_z, direction, convergence_score, tier,
                    aligned_count, signal_count, narrative_only, votes_json, overlays_json
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    run_id, generated_at, as_of,
                    rec.get("symbol"), rec.get("name"), rec.get("sector"),
                    rec.get("residual_z"), conv.get("direction"),
                    float(conv.get("convergence_score") or 0.0), conv.get("tier"),
                    int(conv.get("aligned_count") or 0), int(rec.get("cross_signal_count") or 0),
                    1 if conv.get("narrative_only") else 0,
                    json.dumps(conv.get("votes") or []),
                    json.dumps(overlays),
                ),
            )
            written += 1
        conn.commit()
        return written
    finally:
        conn.close()


CONTRARIAN_WATCH_SCHEMA = """
CREATE TABLE IF NOT EXISTS mi_contrarian_watch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT, as_of TEXT, symbol TEXT,
    entry_price REAL, gap_pct REAL, residual_z REAL,
    crowd_share REAL, prev_crowd_share REAL, crowd_n INTEGER,
    crowd_bearish INTEGER, crowd_flip INTEGER, full_watch INTEGER,
    detail TEXT, created_at TEXT,
    UNIQUE(as_of, symbol)
);
"""


def write_contrarian_watch(
    db_path: Path,
    rows: Sequence[Dict[str, Any]],
    run_id: str,
    as_of: Optional[str],
) -> int:
    """Append-only forward ledger of contrarian-bottom WATCH fires (one row per
    symbol per as_of date). This is the paper-track record we will evaluate once
    the dense 2026+ crowd data accrues forward returns. Captures across the whole
    scored universe, not just the displayed board, and is independent of board
    retention. Idempotent per (as_of, symbol)."""
    fires = [r for r in rows if (r.get("contrarian") or {})]
    if not fires:
        return 0
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(CONTRARIAN_WATCH_SCHEMA)
        now = datetime.now(timezone.utc).isoformat()
        written = 0
        for rec in fires:
            c = rec.get("contrarian") or {}
            legs = c.get("legs") or {}
            val = rec.get("valuation") or {}
            crowd = rec.get("crowd_sentiment") or {}
            pe = rec.get("price_extension") or {}
            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO mi_contrarian_watch (
                        run_id, as_of, symbol, entry_price, gap_pct, residual_z,
                        crowd_share, prev_crowd_share, crowd_n,
                        crowd_bearish, crowd_flip, full_watch, detail, created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        run_id, as_of, rec.get("symbol"),
                        pe.get("last_price"),
                        val.get("valuation_gap_pct"),
                        rec.get("residual_z"),
                        crowd.get("net_bull_share"), crowd.get("prev_bull_share"),
                        int(crowd.get("n_directional") or 0),
                        1 if legs.get("crowd_bearish") else 0,
                        1 if legs.get("crowd_flip_to_bear") else 0,
                        1 if c.get("watch") else 0,
                        c.get("detail"), now,
                    ),
                )
                written += conn.total_changes and 1 or 0
            except Exception:
                continue
        conn.commit()
        return sum(1 for _ in fires)
    finally:
        conn.close()


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run clean-universe PCA residual perturbation prototype.")
    parser.add_argument("--lookback", type=int, default=120, help="Trading days of returns to use.")
    parser.add_argument("--factors", type=int, default=5, help="Number of PCA factors to remove.")
    parser.add_argument("--max-symbols", type=int, default=750, help="Top market-cap clean-universe symbols to test. Use 0 for all.")
    parser.add_argument("--top", type=int, default=50, help="Rows to write in top list.")
    parser.add_argument("--min-coverage", type=float, default=0.95, help="Minimum non-null return coverage per symbol.")
    parser.add_argument("--universe", default=str(UNIVERSE_PATH))
    parser.add_argument("--price-dir", default=str(PRICE_DIR))
    parser.add_argument("--out-json", default=str(RESEARCH_DIR / "eigen_perturbation_lab.latest.json"))
    parser.add_argument("--out-md", default=str(RESEARCH_DIR / "eigen_perturbation_lab.latest.md"))
    parser.add_argument("--convergence-db", default=str(MARKET_INTEL_DB), help="SQLite DB to persist normalized convergence rows. Empty string to skip.")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    universe_path = Path(args.universe)
    price_dir = Path(args.price_dir)
    max_symbols = int(args.max_symbols)
    universe = load_clean_universe(universe_path)
    selected = universe if max_symbols <= 0 else universe[:max_symbols]
    metas = {m.symbol: m for m in universe}
    returns, load_stats = build_returns_matrix(
        [m.symbol for m in selected],
        price_dir=price_dir,
        lookback=max(30, int(args.lookback)),
        min_coverage=min(max(float(args.min_coverage), 0.5), 1.0),
    )
    ranked, pca_meta = run_pca_residuals(returns, n_factors=max(1, int(args.factors)))
    real_volumes, real_vol_meta = compute_real_volume(
        [m.symbol for m in selected],
        price_dir=price_dir,
        lookback=max(30, int(args.lookback)),
    )
    price_extensions, price_ext_meta = compute_price_extension(
        [m.symbol for m in selected],
        price_dir=price_dir,
    )
    fade_timings = compute_fade_timing(
        [m.symbol for m in selected],
        price_dir=price_dir,
    )
    options = latest_options_overlay(OPTIONS_DB)
    social = latest_social_overlay(MARKET_INTEL_DB)
    valuations = valuation_overlay(VALUATION_SNAPSHOT)
    insiders = latest_insider_overlay(EDGAR_DB)
    activists = latest_activist_overlay(EDGAR_DB)
    crowd_sentiments = latest_crowd_sentiment(SOCIAL_INTEL_DB)
    # Score the full ranked set so non-eigen convergence (insider + options +
    # demand) is captured; the JSON/MD top list stays eigen-ranked for compat.
    all_rows = attach_overlays(
        ranked,
        metas,
        options,
        social,
        valuations,
        insiders,
        activists,
        real_volumes,
        price_extensions,
        crowd_sentiments,
        fade_timings,
    )
    top_rows = all_rows[: max(1, int(args.top))]

    generated_at = now_iso()
    run_id = f"eigen_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    payload = {
        "meta": {
            "generated_at": generated_at,
            "run_id": run_id,
            "script": "backend/scripts/run_eigen_perturbation_lab.py",
            "mode": "prototype",
            "universe_path": str(universe_path),
            "price_dir": str(price_dir),
            "selected_symbols": len(selected),
        },
        "load_stats": load_stats,
        "pca": {
            **pca_meta,
            "return_start_date": load_stats["start_date"],
            "return_end_date": load_stats["end_date"],
        },
        "top_residual_movers": top_rows,
    }

    out_json = Path(args.out_json)
    out_md = Path(args.out_md)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_markdown(out_md, payload, top_rows)

    # Footprint setups earn the board; social-only spikes become Tier-3
    # narrative-discovery rows for symbols with no hard footprint.
    footprint_rows = [r for r in all_rows if is_footprint_setup(r)]
    covered = {str(r.get("symbol")).upper() for r in footprint_rows}
    discovery_rows = build_social_discovery_rows(social, covered, metas)
    persist_rows = footprint_rows + discovery_rows

    convergence_written = 0
    contrarian_logged = 0
    convergence_db = str(args.convergence_db or "").strip()
    if convergence_db:
        convergence_written = write_convergence_db(
            Path(convergence_db),
            persist_rows,
            run_id=run_id,
            generated_at=generated_at,
            as_of=load_stats.get("end_date"),
        )
        # Forward paper-track ledger across the WHOLE scored universe (all_rows),
        # not just the displayed board, so we capture every contrarian fire.
        contrarian_logged = write_contrarian_watch(
            Path(convergence_db),
            all_rows,
            run_id=run_id,
            as_of=load_stats.get("end_date"),
        )

    tier_counts = {1: 0, 2: 0, 3: 0}
    for r in persist_rows:
        t = (r.get("convergence") or {}).get("tier")
        if t in tier_counts:
            tier_counts[t] += 1

    print(json.dumps({
        "ok": True,
        "out_json": str(out_json),
        "out_md": str(out_md),
        "load_stats": load_stats,
        "pca": payload["pca"],
        "real_volume": real_vol_meta,
        "price_extension": price_ext_meta,
        "fade": {
            "crowd_symbols": len(crowd_sentiments),
            "candidates": sum(1 for r in all_rows if (r.get("fade") or {}).get("candidate")),
            "partial": sum(1 for r in all_rows if r.get("fade") and not r["fade"].get("candidate")),
            "armed_retest": sum(1 for r in all_rows if (((r.get("fade") or {}).get("timing")) or {}).get("state") == "retest"),
            "trigger_confirmed": sum(1 for r in all_rows if (((r.get("fade") or {}).get("timing")) or {}).get("state") == "confirmed"),
        },
        "contrarian_watch": {
            "logged": contrarian_logged,
            "full_watch": sum(1 for r in all_rows if (r.get("contrarian") or {}).get("watch")),
            "partial": sum(1 for r in all_rows if r.get("contrarian") and not r["contrarian"].get("watch")),
        },
        "convergence": {
            "run_id": run_id,
            "db": convergence_db or None,
            "rows_written": convergence_written,
            "footprint_setups": len(footprint_rows),
            "social_discovery": len(discovery_rows),
            "tier_counts": tier_counts,
        },
        "top": top_rows[:10],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
