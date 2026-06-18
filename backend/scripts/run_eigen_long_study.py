"""Follow-up to run_eigen_valuation_study: test EIGEN as a LONG/MOMENTUM signal.

The fade study found an eigen UP spike on an overvalued name keeps RISING 1-3mo
(eigen = ignition/momentum, not reversal). So the natural home for eigen is the
LONG side. Question: does "eigen UP + (cheap/undervalued) + confirmed uptrend"
beat plain eigen UP and the universe?

Reuses the saved point-in-time observations (eigen_valuation_obs.csv: sym, T, gap,
eigen_z, forward market-neutral excess e21/e63/e126) and layers a PIT trend filter
computed from price (close > 50d SMA AND 20d SMA > 50d SMA == confirmed uptrend).
No re-run of the DCF/PCA loop needed.
"""
from __future__ import annotations
import os, sys, math
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
PRICE = os.path.join(ROOT, 'data', 'universe')
OBS = os.path.join(ROOT, 'data', 'research', 'eigen_valuation_obs.csv')

EIGEN_UP = float(os.environ.get('EIGEN_UP', '2.0'))
UNDERVAL = float(os.environ.get('UNDERVAL', '25'))
OVERVAL = float(os.environ.get('OVERVAL', '25'))
HOR = {'e21': '1mo', 'e63': '3mo', 'e126': '6mo'}


def safe(s): return s.replace('/', '_').replace('=', '_').replace('-', '_')


def load_close(sym):
    p = os.path.join(PRICE, f'{safe(sym)}_1d.csv')
    if not os.path.exists(p): return None
    try:
        d = pd.read_csv(p, usecols=lambda c: c.lower() in ('date', 'close'))
    except Exception:
        return None
    d.columns = [c.lower() for c in d.columns]
    if 'close' not in d.columns: return None
    d['date'] = pd.to_datetime(d['date'], errors='coerce')
    d = d.dropna(subset=['date']).set_index('date').sort_index()
    c = pd.to_numeric(d['close'], errors='coerce').dropna()
    return c if len(c) else None


def main():
    if not os.path.exists(OBS):
        print(f"missing {OBS} — run run_eigen_valuation_study.py first"); return
    df = pd.read_csv(OBS)
    df['Tdt'] = pd.to_datetime(df['T'], errors='coerce')
    print(f"loaded {len(df)} obs; eigen_up>=+{EIGEN_UP}  underval>=+{UNDERVAL}%  overval<=-{OVERVAL}%")

    # PIT trend flags from price
    closes = {}
    for s in df['sym'].unique():
        c = load_close(s)
        if c is not None: closes[s] = c

    def trend(row):
        c = closes.get(row['sym'])
        if c is None: return np.nan
        cc = c[c.index <= row['Tdt']]
        if len(cc) < 55: return np.nan
        px = cc.iloc[-1]; sma20 = cc.tail(20).mean(); sma50 = cc.tail(50).mean()
        if not (np.isfinite(px) and np.isfinite(sma20) and np.isfinite(sma50)) or sma50 <= 0:
            return np.nan
        return 1.0 if (px > sma50 and sma20 > sma50) else 0.0

    df['uptrend'] = df.apply(trend, axis=1)
    cov = df['uptrend'].notna().mean() * 100
    df['eigen_up'] = df['eigen_z'] >= EIGEN_UP
    df['eigen_dn'] = df['eigen_z'] <= -EIGEN_UP
    df['underv'] = df['gap'] >= UNDERVAL
    df['overv'] = df['gap'] <= -OVERVAL
    df['cheapish'] = df['gap'] >= 0  # not overvalued
    df['up'] = df['uptrend'] == 1.0
    print(f"trend coverage: {cov:.0f}%  uptrend share: {df['up'].mean()*100:.0f}%\n")

    def stat(sub, col):
        v = sub[col].dropna()
        if len(v) < 5: return f"n={len(v):>5}   --"
        t = v.mean() / (v.std(ddof=1) / math.sqrt(len(v))) if v.std(ddof=1) > 0 else float('nan')
        win = (v > 0).mean() * 100
        return f"n={len(v):>5}  mean={v.mean():+6.2f}%  med={v.median():+6.2f}%  win={win:4.1f}%  t={t:+.2f}"

    buckets = [
        ('ALL (baseline)', df),
        ('uptrend only', df[df['up']]),
        ('eigen UP (z>=+2)', df[df['eigen_up']]),
        ('eigen UP + uptrend', df[df['eigen_up'] & df['up']]),
        ('eigen UP + undervalued', df[df['eigen_up'] & df['underv']]),
        ('eigen UP + undervalued + uptrend', df[df['eigen_up'] & df['underv'] & df['up']]),
        ('eigen UP + cheapish(gap>=0) + uptrend', df[df['eigen_up'] & df['cheapish'] & df['up']]),
        ('eigen UP + OVERvalued + uptrend (contrast)', df[df['eigen_up'] & df['overv'] & df['up']]),
        ('undervalued + uptrend (no eigen req)', df[df['underv'] & df['up']]),
        ('(contrast) eigen DOWN + undervalued', df[df['eigen_dn'] & df['underv']]),
    ]
    print("=== EIGEN AS A LONG SIGNAL (forward excess vs universe median) ===")
    for name, sub in buckets:
        print(f"### {name}")
        for col in HOR:
            print(f"     {HOR[col]:>4}: {stat(sub, col)}")
        print()


if __name__ == '__main__':
    main()
