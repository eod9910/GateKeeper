"""
Conditional breakout + volume study.

Tests the classic claim: "breakouts want rising volume." We never tested it
properly before — we pooled all breakouts regardless of volume. Here we split
breakouts by volume confirmation and measure market-neutral forward excess
returns, with t-stats and win rates.

Two confirmation lenses:
  - raw relative volume   (breakout-day volume / trailing 50d average)
  - Real Volume (eigen)   (idiosyncratic log-volume after removing the
                           market-wide volume factor; single-factor demean,
                           point-in-time)

Definitions (all point-in-time, no look-ahead in the signal):
  - Breakout: close > prior 60-day high (high rolled & shifted 1), first cross.
  - Forward return horizons: 21/63/126/252 trading days.
  - Market-neutral excess: stock forward return minus the cross-sectional mean
    forward return across the universe on that breakout date.
"""
import os, sys, math
import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SERVICES = os.path.join(ROOT, 'services')
PRICE_DIR = os.path.join(ROOT, 'data', 'universe')
sys.path.insert(0, SERVICES)
from universe_registry import load_universe_symbols  # noqa

BREAKOUT_LOOKBACK = 60
VOL_AVG_WIN = 50
ZVOL_WIN = 120
HORIZONS = [21, 63, 126, 252]
HLABEL = {21: '1mo', 63: '3mo', 126: '6mo', 252: '12mo'}
MAX_SYMBOLS = 1500
MIN_MEDIAN_VOL = 200_000
MIN_BARS = 320


def safe_symbol(s):
    return s.replace('/', '_').replace('=', '_').replace('-', '_')


def load_symbol(sym):
    path = os.path.join(PRICE_DIR, f'{safe_symbol(sym)}_1d.csv')
    if not os.path.exists(path):
        return None
    try:
        df = pd.read_csv(path, usecols=lambda c: c.lower() in ('date', 'close', 'high', 'volume'))
    except Exception:
        return None
    df.columns = [c.lower() for c in df.columns]
    if not {'date', 'close', 'high', 'volume'} <= set(df.columns):
        return None
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df.dropna(subset=['date']).set_index('date').sort_index()
    for c in ('close', 'high', 'volume'):
        df[c] = pd.to_numeric(df[c], errors='coerce')
    df = df.dropna(subset=['close', 'high', 'volume'])
    if len(df) < MIN_BARS:
        return None
    if df['volume'].tail(250).median() < MIN_MEDIAN_VOL:
        return None
    return df


def main():
    syms = list(load_universe_symbols('clean_stocks'))
    print(f'universe symbols: {len(syms)}; loading panels (cap {MAX_SYMBOLS})...')
    closes, highs, vols = {}, {}, {}
    n = 0
    for s in syms:
        d = load_symbol(s)
        if d is None:
            continue
        closes[s] = d['close']; highs[s] = d['high']; vols[s] = d['volume']
        n += 1
        if n >= MAX_SYMBOLS:
            break
    print(f'loaded {n} symbols')

    close = pd.DataFrame(closes).sort_index()
    high = pd.DataFrame(highs).sort_index()
    vol = pd.DataFrame(vols).sort_index()
    # restrict to a common-enough window
    close = close.dropna(axis=0, how='all')
    idx = close.index
    high = high.reindex(idx); vol = vol.reindex(idx)
    print(f'panel: {close.shape[1]} symbols x {close.shape[0]} days  ({idx.min().date()} -> {idx.max().date()})')

    # --- signals (point-in-time) ---
    prior_high = high.rolling(BREAKOUT_LOOKBACK).max().shift(1)
    breakout = (close > prior_high)
    first_cross = breakout & (~breakout.shift(1).fillna(False))

    vol_avg = vol.rolling(VOL_AVG_WIN).mean().shift(1)
    rel_vol = vol / vol_avg

    logv = np.log1p(vol)
    zlogv = (logv - logv.rolling(ZVOL_WIN).mean()) / logv.rolling(ZVOL_WIN).std()
    market_factor = zlogv.mean(axis=1)            # common volume tide (per day)
    real_vol = zlogv.sub(market_factor, axis=0)   # idiosyncratic (single-factor demean)

    # --- forward excess returns ---
    safe_close = close.where(close > 0)           # drop zero/garbage prices
    fwd = {}
    for h in HORIZONS:
        f = safe_close.shift(-h) / safe_close - 1.0
        f = f.replace([np.inf, -np.inf], np.nan)
        f = f.clip(lower=-0.99, upper=10.0)       # cap absurd outliers
        date_mean = f.mean(axis=1)                # cross-sectional universe baseline
        fwd[h] = f.sub(date_mean, axis=0)         # market-neutral excess

    # --- collect breakout events ---
    ev_idx = first_cross.stack()
    ev_idx = ev_idx[ev_idx].index               # (date, symbol) pairs that are breakouts
    print(f'breakout events: {len(ev_idx)}')

    def series_at(df):
        return df.stack().reindex(ev_idx)

    relv = series_at(rel_vol)
    realv = series_at(real_vol)
    data = {'rel_vol': relv.values, 'real_vol': realv.values}
    for h in HORIZONS:
        data[f'x{h}'] = series_at(fwd[h]).values
    ev = pd.DataFrame(data)
    ev = ev.dropna(subset=['rel_vol', 'real_vol'])
    print(f'events with volume data: {len(ev)}')

    def report(mask, label):
        sub = ev[mask]
        print(f'\n=== {label}  (n={len(sub)}) ===')
        for h in HORIZONS:
            col = f'x{h}'
            v = sub[col].dropna().values
            if len(v) == 0:
                print(f'  {HLABEL[h]:<5} n=0'); continue
            m = v.mean(); sd = v.std(ddof=0)
            t = (m / (sd / math.sqrt(len(v)))) if sd > 0 else float('nan')
            win = (v > 0).mean() * 100
            print(f'  {HLABEL[h]:<5} n={len(v):<6} excess={m*100:+6.2f}%  t={t:+6.2f}  win={win:4.1f}%')

    report(pd.Series(True, index=ev.index), 'ALL breakouts (pooled)')
    report(ev['rel_vol'] >= 1.5, 'RAW vol-confirmed: rel_vol >= 1.5')
    report(ev['rel_vol'] < 1.0, 'RAW unconfirmed: rel_vol < 1.0 (below avg)')
    report(ev['rel_vol'] >= 2.0, 'RAW strong: rel_vol >= 2.0')
    report(ev['real_vol'] > 0.5, 'REAL Volume confirmed: real_vol > +0.5')
    report(ev['real_vol'] <= 0, 'REAL Volume absent: real_vol <= 0')
    report(ev['real_vol'] > 1.0, 'REAL Volume strong: real_vol > +1.0')


if __name__ == '__main__':
    main()
