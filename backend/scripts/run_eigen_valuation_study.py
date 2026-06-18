"""Point-in-time backtest: how much edge does VALUATION carry on its own, and
does an EIGEN anomaly at the rebalance date sharpen it?

Two questions, one run:
  1. Valuation standalone — sort the broad liquid universe into deciles by the
     point-in-time DCF/valuation gap each month; measure forward market-neutral
     excess returns per decile. Tells us if valuation's edge is monotonic or
     concentrated in a tail (we suspect the OVERVALUED tail fades).
  2. Eigen's marginal value — among overvalued (and undervalued) names, compare
     forward excess WITH vs WITHOUT a fresh eigen residual spike at T. If
     "overvalued + eigen-spiked" fades harder/sooner than "overvalued" alone,
     eigen earns its place as the timing trigger; if not, valuation stands alone.

Strictly point-in-time:
  - Valuation gap from statement facts with available_at <= T (reuses the PIT DCF
    builder in run_valuation_gap_accuracy_study).
  - Eigen residual-z computed from returns windowed to <= T, same PCA recipe as
    the live eigen lab (lookback 120, 5 factors removed, z = residual / own sigma).
  - Forward returns are market-neutral EXCESS vs the cross-sectional MEDIAN of the
    same broad liquid universe (self-consistent baseline -> centers ~0).
"""
from __future__ import annotations
import os, sys, math, json, sqlite3, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'services'))
PRICE = os.path.join(ROOT, 'data', 'universe')
UNIV = os.path.join(ROOT, 'data', 'universe_clean.json')

from fundamentals_pit_store import DEFAULT_DB_PATH, connect as connect_pit  # noqa
from fundamentals_pit_query import get_asof_snapshot, get_statement_history  # noqa
spec = importlib.util.spec_from_file_location('valstudy', os.path.join(HERE, 'run_valuation_gap_accuracy_study.py'))
vs = importlib.util.module_from_spec(spec); sys.modules['valstudy'] = vs; spec.loader.exec_module(vs)

# --- tunables ---
OVERVAL = float(os.environ.get('OVERVAL', '25'))   # gap <= -OVERVAL  => overvalued
UNDERVAL = float(os.environ.get('UNDERVAL', '25'))  # gap >= +UNDERVAL => undervalued
EIGEN_LOOKBACK = 120
EIGEN_FACTORS = 5
EIGEN_MINCOV = 0.95
EIGEN_SPIKE = 2.0     # |residual z| >= this == an eigen anomaly at T
BENCH_N = 750         # broad liquid universe used for valuation + PCA + baseline
HOR = {21: '1mo', 63: '3mo', 126: '6mo'}


def safe(s): return s.replace('/', '_').replace('=', '_').replace('-', '_')


def _read_cv(sym):
    p = os.path.join(PRICE, f'{safe(sym)}_1d.csv')
    if not os.path.exists(p): return None
    try:
        d = pd.read_csv(p, usecols=lambda c: c.lower() in ('date', 'close', 'volume'))
    except Exception:
        return None
    d.columns = [c.lower() for c in d.columns]
    if 'close' not in d.columns: return None
    d['date'] = pd.to_datetime(d['date'], errors='coerce')
    d = d.dropna(subset=['date']).set_index('date').sort_index()
    d['close'] = pd.to_numeric(d['close'], errors='coerce')
    if 'volume' in d.columns:
        d['volume'] = pd.to_numeric(d['volume'], errors='coerce')
    return d


def dollar_volume(sym):
    """One-shot liquidity read; frame is discarded so memory stays bounded."""
    d = _read_cv(sym)
    if d is None or 'volume' not in d.columns or len(d) <= 130:
        return None
    v = (d['close'].tail(250) * d['volume'].tail(250)).median()
    return float(v) if np.isfinite(v) else None


def load_close(sym):
    d = _read_cv(sym)
    if d is None: return None
    c = d['close'].dropna()
    return c if len(c) else None


def universe_syms():
    p = json.loads(open(UNIV, encoding='utf-8-sig').read())
    stocks = p.get('stocks') if isinstance(p, dict) else p
    return [str(r.get('symbol') or r.get('ticker') or '').strip().upper()
            for r in stocks if (r.get('symbol') or r.get('ticker'))]


def pit_eigen_z(data, T, syms, lookback=EIGEN_LOOKBACK, n_factors=EIGEN_FACTORS, min_cov=EIGEN_MINCOV):
    """Eigen residual-z at date T (last row), PCA factors removed. Mirrors the live
    eigen lab: standardize returns, SVD, remove top-k factors, z = residual/own sigma."""
    closes = {}
    for s in syms:
        c = data.get(s)
        if c is None: continue
        c = c[c.index <= T]
        if len(c) < lookback + 2: continue
        closes[s] = c.tail(lookback + 2)
    if len(closes) < 30: return {}
    cdf = pd.concat(closes, axis=1)
    cdf.columns = list(closes.keys())
    ret = cdf.pct_change(fill_method=None).tail(lookback)
    thr = max(10, int(math.ceil(len(ret) * min_cov)))
    ret = ret.dropna(axis=1, thresh=thr).dropna(axis=0, how='all').fillna(0.0)
    if ret.shape[0] < 20 or ret.shape[1] < 20: return {}
    means = ret.mean(axis=0)
    sd = ret.std(axis=0).replace(0, np.nan)
    use = sd.dropna().index
    r = ret[use]; means = means[use]; sd = sd[use]
    x = ((r - means) / sd).to_numpy(dtype=float)
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    try:
        u, svals, vt = np.linalg.svd(x, full_matrices=False)
    except Exception:
        return {}
    k = max(1, min(n_factors, len(svals), x.shape[0] - 1, x.shape[1] - 1))
    recon = (u[:, :k] * svals[:k]) @ vt[:k, :]
    resid = x - recon
    rsig = resid.std(axis=0, ddof=1)
    last = resid[-1, :]
    out = {}
    cols = list(r.columns)
    for i, s in enumerate(cols):
        if rsig[i] and np.isfinite(rsig[i]) and rsig[i] > 0:
            z = last[i] / rsig[i]
            if np.isfinite(z):
                out[s] = float(z)
    return out


def main():
    rebal = pd.bdate_range('2024-01-31', '2025-11-28', freq='BME')
    Tmin, Tmax = rebal.min(), rebal.max()
    print(f"rebalances: {len(rebal)} ({Tmin.date()}..{Tmax.date()})  "
          f"overval<=-{OVERVAL:.0f}%  underval>=+{UNDERVAL:.0f}%  eigen_spike|z|>={EIGEN_SPIKE}")

    syms = universe_syms()
    # Pass 1: liquidity only (frames discarded) -> pick the broad evaluation universe.
    dvol = {}
    for s in syms:
        v = dollar_volume(s)
        if v is not None:
            dvol[s] = v
    bench = sorted(dvol, key=lambda k: dvol[k], reverse=True)[:BENCH_N]
    # Pass 2: keep ONLY the bench close series in memory (close-only, bounded RAM).
    data = {}
    for s in bench:
        c = load_close(s)
        if c is not None:
            data[s] = c
    bench = [s for s in bench if s in data]
    print(f"scanned {len(dvol)} liquid names; evaluation/baseline universe = {len(bench)} (close series held)")

    conn = connect_pit(DEFAULT_DB_PATH)
    obs = []
    for ti, T in enumerate(rebal):
        asof = T.date().isoformat()
        # forward median of the broad universe (market-neutral baseline)
        def fwd_median(names):
            acc = {n: [] for n in HOR}
            for s in names:
                c = data.get(s)
                if c is None: continue
                cc = c[c.index <= T]; ff = c[c.index > T]
                if len(cc) == 0: continue
                p0 = cc.iloc[-1]
                if p0 <= 0: continue
                for n in HOR:
                    if len(ff) >= n:
                        rr = (ff.iloc[n - 1] / p0 - 1.0) * 100
                        if np.isfinite(rr) and -95 < rr < 800: acc[n].append(rr)
            return {n: (float(np.median(acc[n])) if acc[n] else None) for n in HOR}
        med = fwd_median(bench)
        eig = pit_eigen_z(data, T, bench)
        nrows = 0
        for s in bench:
            c = data.get(s)
            if c is None: continue
            cc = c[c.index <= T]; ff = c[c.index > T]
            if len(cc) == 0 or len(ff) < min(HOR): continue
            price = float(cc.iloc[-1])
            if price <= 0: continue
            try:
                snap = get_asof_snapshot(conn, s, asof)
                arows = get_statement_history(conn, s, 'annual', asof, fact_keys=vs.DCF_FACT_KEYS)
                periods = vs._group_annual_periods(arows)
                if not periods: continue
                dcf = vs._build_standardized_dcf(snap or {}, periods[0], periods[1] if len(periods) > 1 else None, price)
            except Exception:
                continue
            if not dcf: continue
            gap = float(dcf['valuation_gap_pct'])
            ez = eig.get(s)
            excess = {}
            for n in HOR:
                if len(ff) >= n and med[n] is not None:
                    rr = (ff.iloc[n - 1] / price - 1.0) * 100
                    if np.isfinite(rr) and -95 < rr < 800:
                        excess[n] = rr - med[n]
            if not excess: continue
            obs.append({
                'sym': s, 'T': asof, 'gap': gap,
                'eigen_z': ez,
                'eigen_spiked': (ez is not None and abs(ez) >= EIGEN_SPIKE),
                'eigen_up': (ez is not None and ez >= EIGEN_SPIKE),
                'eigen_down': (ez is not None and ez <= -EIGEN_SPIKE),
                **{f'e{n}': excess.get(n) for n in HOR},
            })
            nrows += 1
        print(f"  [{ti+1}/{len(rebal)}] {asof}: rows={nrows} eigen_cov={len(eig)} cum={len(obs)}", flush=True)
    conn.close()

    df = pd.DataFrame(obs)
    if df.empty:
        print("NO OBSERVATIONS"); return
    out = os.path.join(ROOT, 'data', 'research', 'eigen_valuation_obs.csv')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    df.to_csv(out, index=False)
    print(f"\nsaved {len(df)} observations -> {out}\n")

    def stat(sub, n):
        v = sub[f'e{n}'].dropna()
        if len(v) < 5: return f"n={len(v):>5}   --"
        t = v.mean() / (v.std(ddof=1) / math.sqrt(len(v))) if v.std(ddof=1) > 0 else float('nan')
        win = (v > 0).mean() * 100
        return f"n={len(v):>5}  mean={v.mean():+6.2f}%  med={v.median():+6.2f}%  win={win:4.1f}%  t={t:+.2f}"

    # 1) Valuation deciles (per-T cross-sectional deciles of the gap)
    df['decile'] = df.groupby('T')['gap'].transform(
        lambda g: pd.qcut(g.rank(method='first'), 10, labels=False) + 1 if g.notna().sum() >= 10 else np.nan)
    print("=== 1) VALUATION DECILES (D1=most OVERvalued ... D10=most UNDERvalued); excess vs universe median ===")
    for dnum in range(1, 11):
        sub = df[df['decile'] == dnum]
        if sub.empty: continue
        gmin, gmax = sub['gap'].min(), sub['gap'].max()
        print(f"D{dnum:<2} gap[{gmin:+5.0f}%..{gmax:+5.0f}%]  3mo: {stat(sub, 63)}")
    print()

    # 2) Eigen's marginal value on the tails
    over = df[df['gap'] <= -OVERVAL]
    under = df[df['gap'] >= UNDERVAL]
    buckets = [
        ('ALL (baseline)', df),
        ('OVERVALUED (all)', over),
        ('OVERVALUED + eigen spike |z|>=2', over[over['eigen_spiked']]),
        ('OVERVALUED + eigen UP (z>=+2)', over[over['eigen_up']]),
        ('OVERVALUED + NO eigen spike', over[~over['eigen_spiked'] & over['eigen_z'].notna()]),
        ('UNDERVALUED (all)', under),
        ('UNDERVALUED + eigen spike |z|>=2', under[under['eigen_spiked']]),
        ('UNDERVALUED + eigen DOWN (z<=-2)', under[under['eigen_down']]),
        ('UNDERVALUED + NO eigen spike', under[~under['eigen_spiked'] & under['eigen_z'].notna()]),
    ]
    print("=== 2) EIGEN MARGINAL VALUE ON THE TAILS (excess vs universe median) ===")
    for name, sub in buckets:
        print(f"### {name}")
        for n in HOR:
            print(f"     {HOR[n]:>4}: {stat(sub, n)}")
        print()


if __name__ == '__main__':
    main()
