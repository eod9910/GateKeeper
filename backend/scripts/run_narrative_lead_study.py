"""
Narrative-lead study: does SUBSTANTIVE narrative attention lead price?

This is the market-neutral test of the core thesis behind the Expectation-Gap
detector: "narrative is primary — real people deciding to buy / stop buying a
product shows up first as substantive discussion, then later as price." We never
validated it; we only had anecdotes (RMD/Ozempic). Here we test it with the same
rigor applied to bases/breakouts/valuation-gap.

We cannot backtest the LLM thesis output (only ~89 stored rows, no point-in-time
history). Instead we backtest a POINT-IN-TIME PROXY computed directly from the
timestamped post corpus, reusing the same substance + topicality filters wired
into the live thesis extractor:

  raw attention   = all posts that week (hype included)
  substantive     = posts that are long, non-spam, carry a business-argument cue,
                    and are NOT incidental name-drops (hiring/resume/stack lists)

For each (symbol, week) we z-score each metric against the symbol's OWN trailing
12-week baseline (point-in-time, each name is its own control, which absorbs the
secular growth in total post volume). A "spike" is z >= threshold with an
absolute floor. Then we measure forward MARKET-NEUTRAL excess returns:

  excess_h      = stock_fwd_h  - cross-sectional mean stock_fwd_h that date
  abs_excess_h  = |stock_fwd_h| - cross-sectional mean |stock_fwd_h| that date
                  (does substance precede a REPRICING event, regardless of sign?)

Buckets:
  ALL                          baseline (excess ~ 0 by construction)
  RAW attention spike          mention volume spike (hype + noise)
  SUBSTANTIVE narrative spike  the thesis-grade signal
  SUBSTANTIVE + price quiet    narrative ahead of price (decoupled from momentum)
  SUBSTANTIVE bullish / bearish  sentiment-signed (RMD = bearish-ahead-of-damage)

If SUBSTANTIVE beats RAW and beats zero with significance, substance leads price
and the thesis layer is justified. If not, we've saved ourselves a lot of work.
"""
import os, sys, re, math, sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOCIAL_DB = os.path.join(ROOT, 'data', 'social-intelligence.sqlite')
PRICE_DIR = os.path.join(ROOT, 'data', 'universe')

START_DATE = '2023-09-01'          # where per-symbol coverage becomes usable
MIN_SUBST_POSTS_TOTAL = 30         # symbol must have real substantive volume
BASELINE_WEEKS = 12                # trailing window for the spike z-score
MIN_BASELINE_WEEKS = 8
SPIKE_Z = 2.0
RAW_FLOOR = 8                      # min raw posts that week to count as a spike
SUBST_FLOOR = 3                   # min substantive posts that week
HORIZONS = [21, 63, 126]
HLABEL = {21: '1mo', 63: '3mo', 126: '6mo'}
MIN_BARS = 200

# --- substance / topicality filters (ported from the live thesis extractor) ---
ARG_CUE_RE = re.compile(
    r"\b(because|due to|leads? to|result(?:s|ing)?|replac|disrupt|displac|cannibal|"
    r"substitut|threat|risk|decline|erod|demand|revenue|margin|market share|earnings|"
    r"guidance|competit|patent|recall|approval|adoption|tailwind|headwind|secular|moat|"
    r"obsolet|undermin|growth|backlog|pricing|churn|subscriber|bookings)\b", re.I)
INCIDENTAL_RE = [
    re.compile(r"\bwho('?s| is| wants to be)\s+(hiring|hired)\b", re.I),
    re.compile(r"\b(seeking|hiring)\s+(a\s+)?(freelanc|contractor)", re.I),
    re.compile(r"\bfreelancer\?\b", re.I),
    re.compile(r"\bwilling to relocate\b", re.I),
    re.compile(r"\bremote\s*:\s*(yes|no|only|hybrid)\b", re.I),
    re.compile(r"\btechnologies\s*:\s*\S", re.I),
]


def is_substantive(text, token_count, is_spam):
    if is_spam:
        return False
    if token_count is None or token_count < 25:
        return False
    t = str(text or '')
    if not ARG_CUE_RE.search(t):
        return False
    if any(rx.search(t) for rx in INCIDENTAL_RE):
        return False
    commas = t.count(',')
    if commas >= 8 and not ARG_CUE_RE.search(t):
        return False
    return True


def week_start(dt):
    return (dt - timedelta(days=dt.weekday())).date()


def load_weekly_panel():
    """Stream posts -> per (symbol, week) counts: raw, substantive, bull/bear substantive."""
    con = sqlite3.connect(f"file:{SOCIAL_DB}?mode=ro", uri=True)
    cur = con.execute(
        """SELECT c.symbol, c.posted_at, c.token_count, c.is_spam, c.cleaned_text,
                  s.sentiment_label
           FROM social_posts_clean c
           LEFT JOIN social_post_sentiment s ON s.raw_post_id = c.raw_post_id
           WHERE c.posted_at >= ?""",
        (START_DATE,),
    )
    raw = defaultdict(int); subst = defaultdict(int)
    sbull = defaultdict(int); sbear = defaultdict(int)
    n = 0
    while True:
        rows = cur.fetchmany(20000)
        if not rows:
            break
        for sym, posted, tok, spam, text, sent in rows:
            if not sym or not posted:
                continue
            try:
                dt = datetime.strptime(posted[:10], '%Y-%m-%d')
            except Exception:
                continue
            sym = sym.upper()
            wk = week_start(dt)
            key = (sym, wk)
            raw[key] += 1
            if is_substantive(text, tok, spam):
                subst[key] += 1
                if sent == 'bullish':
                    sbull[key] += 1
                elif sent == 'bearish':
                    sbear[key] += 1
        n += len(rows)
        if n % 200000 == 0:
            print(f"  streamed {n:,} posts...")
    con.close()
    print(f"  total posts streamed: {n:,}")
    keys = list(raw.keys())
    df = pd.DataFrame({
        'symbol': [k[0] for k in keys],
        'week': [k[1] for k in keys],
        'raw': [raw[k] for k in keys],
        'subst': [subst[k] for k in keys],
        'sbull': [sbull[k] for k in keys],
        'sbear': [sbear[k] for k in keys],
    })
    return df


def add_trailing_z(df):
    """Point-in-time trailing z per symbol for raw and substantive counts.
    Reindex each symbol to a continuous weekly grid so silent weeks count as 0."""
    df = df.sort_values(['symbol', 'week']).reset_index(drop=True)
    out = []
    for sym, g in df.groupby('symbol', sort=False):
        g = g.set_index('week')
        full = pd.date_range(g.index.min(), g.index.max(), freq='W-MON')
        g = g.reindex(full.date, fill_value=0)
        g['symbol'] = sym
        for col in ('raw', 'subst'):
            mean = g[col].shift(1).rolling(BASELINE_WEEKS, min_periods=MIN_BASELINE_WEEKS).mean()
            std = g[col].shift(1).rolling(BASELINE_WEEKS, min_periods=MIN_BASELINE_WEEKS).std()
            g[f'{col}_mean'] = mean
            g[f'{col}_z'] = (g[col] - mean) / std.replace(0, np.nan)
        g = g.reset_index().rename(columns={'index': 'week'})
        out.append(g)
    res = pd.concat(out, ignore_index=True)
    res['week'] = pd.to_datetime(res['week'])
    return res


def safe_symbol(s):
    return s.replace('/', '_').replace('=', '_').replace('-', '_')


def load_prices(symbols):
    closes = {}
    for s in symbols:
        p = os.path.join(PRICE_DIR, f'{safe_symbol(s)}_1d.csv')
        if not os.path.exists(p):
            continue
        try:
            d = pd.read_csv(p, usecols=lambda c: c.lower() in ('date', 'close'))
        except Exception:
            continue
        d.columns = [c.lower() for c in d.columns]
        if 'date' not in d.columns or 'close' not in d.columns:
            continue
        d['date'] = pd.to_datetime(d['date'], errors='coerce')
        d = d.dropna(subset=['date']).set_index('date').sort_index()
        d['close'] = pd.to_numeric(d['close'], errors='coerce')
        d = d.dropna(subset=['close'])
        if len(d) < MIN_BARS:
            continue
        closes[s] = d['close']
    if not closes:
        return None
    return pd.DataFrame(closes).sort_index()


def main():
    print('Loading weekly post panel...')
    wk = load_weekly_panel()
    print(f'  symbol-weeks with posts: {len(wk):,}; distinct symbols: {wk.symbol.nunique():,}')

    tot = wk.groupby('symbol')['subst'].sum()
    eligible = set(tot[tot >= MIN_SUBST_POSTS_TOTAL].index)
    print(f'  symbols with >= {MIN_SUBST_POSTS_TOTAL} substantive posts: {len(eligible):,}')
    wk = wk[wk.symbol.isin(eligible)].copy()

    print('Computing trailing z-scores (point-in-time)...')
    z = add_trailing_z(wk)

    print('Loading prices for eligible symbols...')
    close = load_prices(sorted(eligible))
    if close is None:
        print('No prices loaded; abort.'); return
    close = close.where(close > 0)
    idx = close.index
    print(f'  price panel: {close.shape[1]} symbols x {close.shape[0]} days '
          f'({idx.min().date()} -> {idx.max().date()})')

    # forward market-neutral excess returns per horizon
    fwd_excess = {}; fwd_absexcess = {}
    for h in HORIZONS:
        f = close.shift(-h) / close - 1.0
        f = f.replace([np.inf, -np.inf], np.nan).clip(lower=-0.95, upper=8.0)
        # Benchmark against the cross-sectional MEDIAN, not mean: forward returns
        # are right-skewed (a few monster names pull the mean up), so subtracting
        # the mean biases the typical name negative. Median keeps the baseline
        # bucket centered on ~0 / ~50% win, so bucket deviations are meaningful.
        fwd_excess[h] = f.sub(f.median(axis=1), axis=0)
        af = f.abs()
        fwd_absexcess[h] = af.sub(af.median(axis=1), axis=0)

    # map each signal week -> last trading day <= that week's Friday close
    trading = pd.Series(np.arange(len(idx)), index=idx)

    def asof_pos(ts):
        pos = trading.index.searchsorted(ts, side='right') - 1
        return pos if pos >= 0 else None

    z = z[z['week'] >= pd.Timestamp(START_DATE)].copy()
    z['signal_date'] = z['week'] + pd.Timedelta(days=4)  # Friday of the week

    # attach forward excess for each event row
    recs = []
    sym_to_col = {s: s for s in close.columns}
    for row in z.itertuples(index=False):
        sym = row.symbol
        if sym not in sym_to_col:
            continue
        pos = asof_pos(row.signal_date)
        if pos is None or pos >= len(idx):
            continue
        rec = {
            'symbol': sym, 'date': idx[pos], 'raw': row.raw, 'subst': row.subst,
            'raw_z': row.raw_z, 'subst_z': row.subst_z,
            'sbull': row.sbull, 'sbear': row.sbear,
        }
        ok = False
        for h in HORIZONS:
            ev = fwd_excess[h].iat[pos, close.columns.get_loc(sym)] if pos < len(idx) else np.nan
            av = fwd_absexcess[h].iat[pos, close.columns.get_loc(sym)] if pos < len(idx) else np.nan
            rec[f'x{h}'] = ev
            rec[f'a{h}'] = av
            if pd.notna(ev):
                ok = True
        # prior 21d move (for price-quiet condition), market-neutral
        if pos - 21 >= 0:
            base = fwd_excess[21].iat[pos - 21, close.columns.get_loc(sym)]
            rec['prior21_excess'] = base
        else:
            rec['prior21_excess'] = np.nan
        if ok:
            recs.append(rec)

    ev = pd.DataFrame(recs)
    print(f'\nevent rows with forward data: {len(ev):,}')

    def report(mask, label):
        sub = ev[mask]
        print(f'\n=== {label}  (n={len(sub)}) ===')
        for h in HORIZONS:
            for tag, col in (('excess', f'x{h}'), ('abs_excess', f'a{h}')):
                v = sub[col].dropna().values
                if len(v) == 0:
                    print(f'  {HLABEL[h]:<4} {tag:<10} n=0'); continue
                m = v.mean(); sd = v.std(ddof=0)
                t = (m / (sd / math.sqrt(len(v)))) if sd > 0 else float('nan')
                win = (v > 0).mean() * 100
                print(f'  {HLABEL[h]:<4} {tag:<10} n={len(v):<6} '
                      f'mean={m*100:+6.2f}%  t={t:+6.2f}  win={win:4.1f}%')

    eligible_mask = ev['raw_z'].notna()
    report(eligible_mask, 'ALL eligible symbol-weeks (baseline)')
    report(eligible_mask & (ev['raw_z'] >= SPIKE_Z) & (ev['raw'] >= RAW_FLOOR),
           f'RAW attention spike (raw_z>={SPIKE_Z}, raw>={RAW_FLOOR})')
    subst_spike = eligible_mask & (ev['subst_z'] >= SPIKE_Z) & (ev['subst'] >= SUBST_FLOOR)
    report(subst_spike, f'SUBSTANTIVE narrative spike (subst_z>={SPIKE_Z}, subst>={SUBST_FLOOR})')
    quiet = ev['prior21_excess'].abs() < 0.05
    report(subst_spike & quiet, 'SUBSTANTIVE spike + price QUIET (prior 1mo |excess|<5%)')
    report(subst_spike & (ev['sbull'] > ev['sbear']), 'SUBSTANTIVE spike + net BULLISH')
    report(subst_spike & (ev['sbear'] > ev['sbull']), 'SUBSTANTIVE spike + net BEARISH')


if __name__ == '__main__':
    main()
