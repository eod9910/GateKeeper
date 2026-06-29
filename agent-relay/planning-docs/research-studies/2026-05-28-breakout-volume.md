# Breakouts want volume — confirmation (esp. Real Volume) separates winners from losers

- Date: 2026-05-28
- Question: The classic claim "breakouts want rising volume." We'd only ever pooled
  all breakouts. Does volume confirmation actually separate winning breakouts from
  losing ones?
- Script: `backend/scripts/run_breakout_volume_study.py`
- Data: ~1,500 liquid names, breakout = close > prior 60-day high (first cross).
  Forward horizons 1/3/6/12mo. Market-neutral excess = stock fwd return − the
  cross-sectional mean fwd return on that breakout date.

## Method
Split breakouts by two confirmation lenses and compare forward excess with t-stats
and win rates:
- **raw relative volume** = breakout-day volume / trailing 50d average
- **Real Volume (eigen)** = idiosyncratic log-volume after removing the market-wide
  volume factor (single-factor demean, point-in-time)

## Result
- **Volume confirmation matters.** Breakouts on confirmed volume materially
  outperformed breakouts on weak volume; un-confirmed breakouts were essentially
  noise / underperformers.
- **Real Volume (idiosyncratic) was the cleaner separator** than raw relative
  volume — it isolates demand specific to the name from market-wide volume swells.

## Conclusion
Confirmed the book wisdom *and* improved on it: use **eigen Real Volume** as the
breakout gate, not raw volume. This was wired into the live convergence board as an
explicit Real-Volume confirmation flag/chip on breakout candidates, so volume
confirmation shows up alongside the eigen-price signal.
