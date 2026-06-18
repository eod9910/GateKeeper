# Does narrative lead price? — no significant leading edge; substance ≈ hype

- Date: 2026-05-30
- Question: The core Expectation-Gap thesis — "narrative is primary; substantive
  discussion shows up before price." Does it survive a market-neutral test?
- Script: `backend/scripts/run_narrative_lead_study.py`
- Data: `social-intelligence.sqlite` post corpus, from 2023-09 (where per-symbol
  coverage becomes usable). We can't backtest the LLM thesis (only ~89 stored rows,
  no PIT history), so we use a **PIT proxy** from the timestamped corpus reusing the
  live thesis extractor's substance + topicality filters.

## Method
For each (symbol, week) z-score two metrics vs the symbol's OWN trailing 12-week
baseline (each name its own control, absorbs secular post-volume growth):
- **raw attention** = all posts (hype included)
- **substantive** = long, non-spam, business-argument cue, not incidental name-drops

A "spike" is z ≥ 2 with an absolute floor. Measure forward market-neutral excess
(signed) and **abs-excess** (does substance precede a repricing event regardless of
sign?) at 1/3/6mo. Buckets: RAW spike, SUBSTANTIVE spike, SUBSTANTIVE + price-quiet,
SUBSTANTIVE bullish/bearish.

## Result
- **No statistically significant *leading* edge.** Substantive-narrative spikes did
  not reliably precede directional excess returns.
- **Substance did NOT beat hype.** The thesis-grade substantive signal performed no
  better than raw attention volume.
- Narrative reads as **~coincident with volatility/repricing**, not a clean leading
  indicator. (A methodological fix to the market-neutral baseline was applied mid-study.)

## Conclusion
The RMD/Ozempic anecdote did not generalize into a systematic *leading* signal.
Narrative is best used as a **discriminator / justification** layer and a discovery
trigger, not a standalone timing edge. This reframed the whole effort: stop trying
to trade narrative directly; use it to explain *why* a footprint (eigen, insider,
options, valuation) is happening. Saved a lot of work chasing a non-edge.
