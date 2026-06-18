"""Test the contrarian-bottom triple: EIGEN + UNDERVALUED + BEARISH CROWD.

Hypothesis: a cheap (DCF-undervalued) name where the social buzz has turned
bearish (capitulation) and eigen is flagging an idiosyncratic move may be marking
a bottom -> contrarian long.

Layers point-in-time crowd sentiment onto the saved eigen/valuation observations
(eigen_valuation_obs.csv). Crowd mood = net bullish share of directional posts in
social_post_sentiment over a trailing window ending at T. Two reads:
  - bearish LEVEL: bull/(bull+bear) <= 0.45 in the last 45d (min posts)
  - bearish FLIP:  was bullish (>=0.55) in the prior 45d, now bearish (<=0.45)
Forward returns are the market-neutral excess already stored in the obs.
"""
from __future__ import annotations
import os, sys, math, sqlite3
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OBS = os.path.join(ROOT, 'data', 'research', 'eigen_valuation_obs.csv')
SOC = os.path.join(ROOT, 'data', 'social-intelligence.sqlite')

EIGEN_SPIKE = float(os.environ.get('EIGEN_SPIKE', '2.0'))
UNDERVAL = float(os.environ.get('UNDERVAL', '25'))
WIN = 45                 # trailing days for crowd mood
BULL_HI, BEAR_LO = 0.55, 0.45
MIN_DIR = int(os.environ.get('MIN_DIR', '5'))   # min directional posts to trust mood
HOR = {'e21': '1mo', 'e63': '3mo', 'e126': '6mo'}


def main():
    if not os.path.exists(OBS):
        print(f"missing {OBS} — run run_eigen_valuation_study.py first"); return
    df = pd.read_csv(OBS)
    df['Tdt'] = pd.to_datetime(df['T'], errors='coerce')
    syms = set(df['sym'].unique())
    Tmin, Tmax = df['Tdt'].min(), df['Tdt'].max()
    print(f"obs={len(df)}  syms={len(syms)}  T:{Tmin.date()}..{Tmax.date()}  win={WIN}d  underval>=+{UNDERVAL}%")

    # daily directional sentiment counts per symbol (collapsed for memory)
    conn = sqlite3.connect(f"file:{SOC}?mode=ro", uri=True)
    lo = (Tmin - pd.Timedelta(days=WIN * 2 + 5)).strftime('%Y-%m-%d')
    hi = Tmax.strftime('%Y-%m-%d')
    rows = conn.execute(
        "SELECT UPPER(symbol) sym, substr(trade_date,1,10) d, sentiment_label lbl, COUNT(*) n "
        "FROM social_post_sentiment WHERE sentiment_label IN ('bullish','bearish') "
        "AND substr(trade_date,1,10) BETWEEN ? AND ? GROUP BY UPPER(symbol), d, lbl",
        (lo, hi)).fetchall()
    conn.close()
    sent = pd.DataFrame(rows, columns=['sym', 'd', 'lbl', 'n'])
    sent = sent[sent['sym'].isin(syms)].copy()
    sent['d'] = pd.to_datetime(sent['d'], errors='coerce')
    sent = sent.dropna(subset=['d'])
    print(f"daily sentiment rows (obs syms): {len(sent)}")

    piv = sent.pivot_table(index=['sym', 'd'], columns='lbl', values='n', aggfunc='sum', fill_value=0).reset_index()
    for c in ('bullish', 'bearish'):
        if c not in piv.columns: piv[c] = 0

    def mood(sym, t0, t1):
        """bull,bear counts for sym in (t0, t1]."""
        s = piv[(piv['sym'] == sym) & (piv['d'] > t0) & (piv['d'] <= t1)]
        if s.empty: return 0, 0
        return int(s['bullish'].sum()), int(s['bearish'].sum())

    # compute crowd flags per obs row
    cur_share, ndir_cur, prev_share, ndir_prev = [], [], [], []
    # index sentiment by symbol for speed
    by_sym = {k: v for k, v in piv.groupby('sym')}
    for _, r in df.iterrows():
        T = r['Tdt']; sym = r['sym']
        sub = by_sym.get(sym)
        if sub is None:
            cur_share.append(np.nan); ndir_cur.append(0); prev_share.append(np.nan); ndir_prev.append(0); continue
        w1 = sub[(sub['d'] > T - pd.Timedelta(days=WIN)) & (sub['d'] <= T)]
        w0 = sub[(sub['d'] > T - pd.Timedelta(days=2 * WIN)) & (sub['d'] <= T - pd.Timedelta(days=WIN))]
        b1, x1 = int(w1['bullish'].sum()), int(w1['bearish'].sum())
        b0, x0 = int(w0['bullish'].sum()), int(w0['bearish'].sum())
        n1, n0 = b1 + x1, b0 + x0
        cur_share.append((b1 / n1) if n1 > 0 else np.nan); ndir_cur.append(n1)
        prev_share.append((b0 / n0) if n0 > 0 else np.nan); ndir_prev.append(n0)
    df['cur_share'] = cur_share; df['ndir_cur'] = ndir_cur
    df['prev_share'] = prev_share; df['ndir_prev'] = ndir_prev

    df['has_mood'] = df['ndir_cur'] >= MIN_DIR
    df['bear'] = df['has_mood'] & (df['cur_share'] <= BEAR_LO)
    df['bull'] = df['has_mood'] & (df['cur_share'] >= BULL_HI)
    df['bear_flip'] = (df['ndir_cur'] >= MIN_DIR) & (df['ndir_prev'] >= MIN_DIR) & \
                      (df['prev_share'] >= BULL_HI) & (df['cur_share'] <= BEAR_LO)
    df['underv'] = df['gap'] >= UNDERVAL
    df['eig_spk'] = df['eigen_z'].abs() >= EIGEN_SPIKE
    df['eig_dn'] = df['eigen_z'] <= -EIGEN_SPIKE
    df['eig_up'] = df['eigen_z'] >= EIGEN_SPIKE
    print(f"crowd-mood coverage: {df['has_mood'].mean()*100:.0f}%  bearish share: {df['bear'].mean()*100:.0f}%  "
          f"bear-flip share: {df['bear_flip'].mean()*100:.1f}%\n")

    def stat(sub, col):
        v = sub[col].dropna()
        if len(v) < 5: return f"n={len(v):>5}   --"
        t = v.mean() / (v.std(ddof=1) / math.sqrt(len(v))) if v.std(ddof=1) > 0 else float('nan')
        win = (v > 0).mean() * 100
        return f"n={len(v):>5}  mean={v.mean():+6.2f}%  med={v.median():+6.2f}%  win={win:4.1f}%  t={t:+.2f}"

    uv = df[df['underv']]
    buckets = [
        ('ALL (baseline)', df),
        ('undervalued (all)', uv),
        ('undervalued + bearish crowd (level)', uv[uv['bear']]),
        ('undervalued + bullish crowd (contrast)', uv[uv['bull']]),
        ('undervalued + bear FLIP (was bull->now bear)', uv[uv['bear_flip']]),
        ('eigen spike + undervalued + bearish', uv[uv['eig_spk'] & uv['bear']]),
        ('eigen DOWN + undervalued + bearish', uv[uv['eig_dn'] & uv['bear']]),
        ('eigen UP + undervalued + bearish', uv[uv['eig_up'] & uv['bear']]),
        ('eigen DOWN + undervalued + bear FLIP', uv[uv['eig_dn'] & uv['bear_flip']]),
        ('(contrast) eigen DOWN + undervalued + bullish', uv[uv['eig_dn'] & uv['bull']]),
    ]
    print("=== EIGEN + UNDERVALUED + BEARISH CROWD (forward excess vs universe median) ===")
    for name, sub in buckets:
        print(f"### {name}")
        for col in HOR:
            print(f"     {HOR[col]:>4}: {stat(sub, col)}")
        print()


if __name__ == '__main__':
    main()
