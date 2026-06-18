"""Point-in-time backtest of the DCF-FIRST funnel (the user's actual long process):

    Gate 1 (necessary):  DCF undervalued      (valuation_gap_pct >= UNDERVAL_PCT)
    Gate 2 (necessary):  bullish narrative     (substantive-post bull share >= BULL_SHARE)
    Gate 3 (optional):    open-market insider buying (Form 4 'P' purchases <= T)

Options call-volume (the user's other confirmation) is current-only in
options-flow.sqlite, so it is NOT backtestable and is excluded.

Everything is strictly point-in-time: DCF uses statement facts with
available_at <= T; narrative uses posts with posted_at <= T; insider uses
filings with filing_date <= T. Forward returns are market-neutral excess vs the
cross-sectional MEDIAN of a broad liquid benchmark (right-skew safe).

Buckets are reported so each gate's marginal contribution is visible.
"""
from __future__ import annotations
import os, sys, re, json, math, sqlite3, importlib.util
from datetime import datetime
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'services'))
PRICE = os.path.join(ROOT, 'data', 'universe')
SOC = os.path.join(ROOT, 'data', 'social-intelligence.sqlite')
EDGAR = os.path.join(ROOT, 'data', 'edgar-filings.sqlite')
UNIV = os.path.join(ROOT, 'data', 'universe_clean.json')

from fundamentals_pit_store import DEFAULT_DB_PATH, connect as connect_pit  # noqa
from fundamentals_pit_query import get_asof_snapshot, get_statement_history  # noqa
spec = importlib.util.spec_from_file_location('valstudy', os.path.join(HERE, 'run_valuation_gap_accuracy_study.py'))
vs = importlib.util.module_from_spec(spec); sys.modules['valstudy'] = vs; spec.loader.exec_module(vs)

# --- tunables ---
UNDERVAL_PCT = float(os.environ.get('UNDERVAL_PCT', '25'))   # DCF gap >= this => undervalued
BULL_SHARE = float(os.environ.get('BULL_SHARE', '0.60'))      # bull/(bull+bear) among substantive posts
MIN_DIR = int(os.environ.get('MIN_DIR', '4'))                 # min directional substantive posts
INSIDER_MIN_USD = float(os.environ.get('INSIDER_MIN_USD', '50000'))
NARR_WIN = 90        # days for narrative window
INSIDER_WIN = 120    # days for insider purchase window
HOR = {21: '1mo', 63: '3mo', 126: '6mo'}

ARG = re.compile(r"because|due to|leads? to|result|replac|disrupt|displac|cannibal|substitut|threat|risk|decline|erod|demand|revenue|margin|market share|earnings|guidance|competit|patent|recall|approval|adoption|tailwind|headwind|secular|moat|obsolet|undermin|growth|backlog|pricing|churn|subscriber|bookings", re.I)

def safe(s): return s.replace('/','_').replace('=','_').replace('-','_')

def load_cv(sym):
    p = os.path.join(PRICE, f'{safe(sym)}_1d.csv')
    if not os.path.exists(p): return None
    try:
        d = pd.read_csv(p, usecols=lambda c: c.lower() in ('date','close','volume'))
    except Exception: return None
    d.columns = [c.lower() for c in d.columns]
    if 'close' not in d.columns: return None
    d['date'] = pd.to_datetime(d['date'], errors='coerce')
    d = d.dropna(subset=['date']).set_index('date').sort_index()
    d['close'] = pd.to_numeric(d['close'], errors='coerce')
    if 'volume' in d.columns: d['volume'] = pd.to_numeric(d['volume'], errors='coerce')
    return d

def universe_syms():
    p = json.loads(open(UNIV, encoding='utf-8-sig').read())
    stocks = p.get('stocks') if isinstance(p, dict) else p
    return [str(r.get('symbol') or r.get('ticker') or '').strip().upper() for r in stocks if (r.get('symbol') or r.get('ticker'))]


def main():
    rebal = pd.bdate_range('2024-06-28', '2025-11-28', freq='BME')
    Tmin, Tmax = rebal.min(), rebal.max()
    print(f"rebalances: {len(rebal)} ({Tmin.date()}..{Tmax.date()})  "
          f"undervalued>=+{UNDERVAL_PCT:.0f}%  bull_share>={BULL_SHARE}  insider>=${INSIDER_MIN_USD:,.0f}")

    # socially-covered test universe
    soc = sqlite3.connect(f"file:{SOC}?mode=ro", uri=True)
    test = set()
    for s, c in soc.execute(
        "SELECT UPPER(symbol), COUNT(*) FROM social_posts_clean WHERE posted_at>=? AND posted_at<=? "
        "GROUP BY UPPER(symbol) HAVING COUNT(*)>=60",
        ((Tmin - pd.Timedelta(days=120)).strftime('%Y-%m-%d'), Tmax.strftime('%Y-%m-%d'))):
        test.add(s)
    print(f"socially-covered test universe: {len(test)}")

    # narrative corpus (substantive posts w/ sentiment) over full window, once
    rows = soc.execute(
        "SELECT c.posted_at, UPPER(c.symbol) sym, c.token_count, c.is_spam, c.cleaned_text, s.sentiment_label "
        "FROM social_posts_clean c JOIN social_post_sentiment s "
        "ON s.raw_post_id=c.raw_post_id AND s.symbol=c.symbol "
        "WHERE c.posted_at>=? AND c.posted_at<=?",
        ((Tmin - pd.Timedelta(days=NARR_WIN+5)).strftime('%Y-%m-%d'), Tmax.strftime('%Y-%m-%d'))).fetchall()
    soc.close()
    nar = pd.DataFrame(rows, columns=['posted_at','sym','tok','spam','text','label'])
    nar = nar[nar['sym'].isin(test)].copy()
    nar['dt'] = pd.to_datetime(nar['posted_at'], errors='coerce', utc=True).dt.tz_localize(None)
    nar = nar.dropna(subset=['dt'])
    subst = (nar['spam'].fillna(0).astype(int) == 0) & (nar['tok'].fillna(0) >= 25) & \
            (nar['text'].fillna('').str.contains(ARG))
    nar = nar[subst & nar['label'].isin(['bullish','bearish'])][['dt','sym','label']]
    nar = nar.sort_values('dt').reset_index(drop=True)
    print(f"substantive directional posts: {len(nar)}")

    # insider open-market purchases
    eg = sqlite3.connect(f"file:{EDGAR}?mode=ro", uri=True)
    irows = eg.execute(
        "SELECT UPPER(symbol), filing_date, transaction_date, total_value FROM insider_transactions "
        "WHERE transaction_type='P' AND filing_date>=? AND filing_date<=?",
        ((Tmin - pd.Timedelta(days=INSIDER_WIN+5)).strftime('%Y-%m-%d'), Tmax.strftime('%Y-%m-%d'))).fetchall()
    eg.close()
    ins = pd.DataFrame(irows, columns=['sym','filing_date','txn_date','value'])
    ins['fd'] = pd.to_datetime(ins['filing_date'], errors='coerce')
    ins['value'] = pd.to_numeric(ins['value'], errors='coerce').fillna(0.0)
    ins = ins[ins['sym'].isin(test)].dropna(subset=['fd'])
    print(f"insider P purchases in window (test universe): {len(ins)}")

    # price panels
    syms = universe_syms()
    data, dvol = {}, {}
    for s in set(syms) | test:
        d = load_cv(s)
        if d is None: continue
        data[s] = d
        if 'volume' in d.columns and len(d) > 130:
            v = (d['close'].tail(250)*d['volume'].tail(250)).median()
            dvol[s] = v if np.isfinite(v) else 0.0
    bench = sorted(dvol, key=lambda k: dvol[k], reverse=True)[:750]
    print(f"loaded {len(data)} price series; benchmark={len(bench)}")

    conn = connect_pit(DEFAULT_DB_PATH)
    obs = []  # each: dict with flags + horizon excesses
    for ti, T in enumerate(rebal):
        # forward-return benchmarks per horizon at this T:
        #   med  = broad top-750 liquid universe median (secondary)
        #   pmed = socially-covered PEER population median (primary, fair baseline)
        def fwd_median(names):
            acc = {n: [] for n in HOR}
            for s in names:
                d = data.get(s)
                if d is None: continue
                cc = d['close'][d.index <= T]; ff = d['close'][d.index > T]
                if len(cc)==0: continue
                p0 = cc.iloc[-1]
                if p0 <= 0: continue
                for n in HOR:
                    if len(ff) >= n:
                        r = (ff.iloc[n-1]/p0 - 1.0)*100
                        if np.isfinite(r) and -95 < r < 800: acc[n].append(r)
            return {n: (float(np.median(acc[n])) if acc[n] else None) for n in HOR}
        med = fwd_median(bench)
        pmed = fwd_median(test)
        asof = T.date().isoformat()
        nwin0 = T - pd.Timedelta(days=NARR_WIN)
        iwin0 = T - pd.Timedelta(days=INSIDER_WIN)
        # pre-slice narrative & insider for this T
        nT = nar[(nar['dt'] <= T) & (nar['dt'] > nwin0)]
        ng = nT.groupby('sym')['label'].value_counts().unstack(fill_value=0)
        iT = ins[(ins['fd'] <= T) & (ins['fd'] > iwin0)].groupby('sym')['value'].sum()
        for s in test:
            d = data.get(s)
            if d is None: continue
            cc = d['close'][d.index <= T]; ff = d['close'][d.index > T]
            if len(cc)==0 or len(ff) < min(HOR): continue
            price = float(cc.iloc[-1])
            if price <= 0: continue
            # DCF
            try:
                snap = get_asof_snapshot(conn, s, asof)
                arows = get_statement_history(conn, s, 'annual', asof, fact_keys=vs.DCF_FACT_KEYS)
                periods = vs._group_annual_periods(arows)
                if not periods: continue
                dcf = vs._build_standardized_dcf(snap or {}, periods[0], periods[1] if len(periods)>1 else None, price)
            except Exception:
                continue
            if not dcf: continue
            gap = float(dcf['valuation_gap_pct'])
            # narrative
            bull = int(ng.loc[s, 'bullish']) if (s in ng.index and 'bullish' in ng.columns) else 0
            bear = int(ng.loc[s, 'bearish']) if (s in ng.index and 'bearish' in ng.columns) else 0
            ndir = bull + bear
            bull_share = (bull / ndir) if ndir > 0 else None
            # insider
            ival = float(iT.get(s, 0.0))
            # forward raw + peer-excess + broad-excess
            raw = {}; epop = {}; ebrd = {}
            for n in HOR:
                if len(ff) >= n:
                    r = (ff.iloc[n-1]/price - 1.0)*100
                    if np.isfinite(r) and -95 < r < 800:
                        raw[n] = r
                        if pmed[n] is not None: epop[n] = r - pmed[n]
                        if med[n] is not None: ebrd[n] = r - med[n]
            if not epop: continue
            obs.append({
                'sym': s, 'T': asof, 'gap': gap,
                'underv': gap >= UNDERVAL_PCT,
                'bullish': (ndir >= MIN_DIR and bull_share is not None and bull_share >= BULL_SHARE),
                'has_narr': ndir >= MIN_DIR,
                'insider': ival >= INSIDER_MIN_USD,
                **{f'e{n}': epop.get(n) for n in HOR},          # primary: peer-excess
                **{f'r{n}': raw.get(n) for n in HOR},           # raw forward
                **{f'b{n}': ebrd.get(n) for n in HOR},          # broad-excess
            })
        print(f"  [{ti+1}/{len(rebal)}] {asof}: cum obs={len(obs)}", flush=True)
    conn.close()

    df = pd.DataFrame(obs)
    if df.empty:
        print("NO OBSERVATIONS"); return
    out = os.path.join(ROOT, 'data', 'research', 'dcf_funnel_obs.csv')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    df.to_csv(out, index=False)
    print(f"\nsaved {len(df)} observations -> {out}\n")

    def stat(sub, n):
        col = f'e{n}'; v = sub[col].dropna()
        if len(v) < 3: return f"n={len(v):>4}   --"
        t = v.mean()/ (v.std(ddof=1)/math.sqrt(len(v))) if v.std(ddof=1) > 0 else float('nan')
        win = (v > 0).mean()*100
        return f"n={len(v):>4}  mean_excess={v.mean():+6.2f}%  median={v.median():+6.2f}%  win={win:4.1f}%  t={t:+.2f}"

    buckets = [
        ('ALL socially-covered (baseline)', df),
        ('Gate1: DCF undervalued', df[df['underv']]),
        ('Gate2 only: bullish narrative', df[df['bullish']]),
        ('Gate1+2: undervalued + bullish', df[df['underv'] & df['bullish']]),
        ('Gate1+2+3: + insider buying', df[df['underv'] & df['bullish'] & df['insider']]),
        ('(contrast) undervalued + BEARISH narr', df[df['underv'] & df['has_narr'] & ~df['bullish']]),
        ('(contrast) OVERVALUED + bullish narr', df[(df['gap'] <= -UNDERVAL_PCT) & df['bullish']]),
    ]
    print("EXCESS = vs socially-covered PEER median (baseline should center ~0)\n")
    for name, sub in buckets:
        print(f"### {name}")
        for n in HOR:
            print(f"     {HOR[n]:>4}: {stat(sub, n)}")
        print()


if __name__ == '__main__':
    main()
