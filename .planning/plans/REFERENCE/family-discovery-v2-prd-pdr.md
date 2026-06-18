# Family Discovery v2 — Canonical Reference

**Status:** CANONICAL REFERENCE  
**Last updated:** 2026-03-17  
**Scope:** Research-v1 family aggregation layer for causal structural motif discovery  
**Audit basis:** Direct code inspection of all implementation files (2026-03-17)

---

## What This Document Is

This is the single authoritative reference for the Family Explorer system. It covers:

- What the system is trying to do and why
- The exact pipeline from bars to family cards
- The precise definition of every metric, every token, and every label shown in the UI
- What the metrics mean and what they do not mean
- How to read a family card correctly
- Where the code is for every claim made here

Do not answer questions about the Family Explorer from intuition. Consult this document first, then the code files listed at the bottom.

---

## What the Family Explorer Is

The Family Explorer is a **structural pattern research tool**. Its purpose is to discover whether recurring price structures — defined by the shape of 5-pivot zigzag windows — have statistically consistent forward behavior across multiple symbols and time.

It is **not** a trading signal generator. It does not produce buy/sell signals. It does not account for timing, regime, entry price, stop loss, or position sizing. It is a research layer that asks one question:

> "Does this type of price structure, on average, lead to a consistent directional outcome over the next 10 bars?"

If the answer is yes, robustly, across multiple symbols, that is evidence of a **structural edge** that may be worth building a strategy around. The strategy layer — timing, regime filter, entry logic, risk rules — is built on top of this layer, not inside it.

---

## The Full Pipeline

Every family card is the output of a deterministic 8-stage pipeline. Nothing is learned or clustered. Everything is rule-based and inspectable.

```
Raw OHLCV bars
    ↓
1. Normalization (ATR-14 scale)        normalizer.py
    ↓
2. ATR Reversal Pivots                 atr_pivots.py
    ↓
3. Legs (pivot-to-pivot segments)      legs.py
    ↓
4. Pivot Labels (HH/HL/LH/LL)         labels.py
    ↓
5. 5-Pivot Motifs + exact signature    motifs.py
    ↓
6. Forward Outcomes (5-bar, 10-bar)    outcomes.py
    ↓
7. Family Aggregation + stats          families.py
    ↓
8. Multi-symbol comparison + Explorer  multi_symbol.py, stability.py, explorer.py
```

---

## Stage-by-Stage Explanation

### Stage 1: Normalization

**File:** `backend/services/research_v1/normalizer.py`

Bars are normalized using ATR-14. This makes all subsequent measurements scale-invariant — a 1.0 ATR move on SPY and a 1.0 ATR move on IWM are comparable even though the raw price distances are very different.

### Stage 2: ATR Reversal Pivots

**File:** `backend/services/research_v1/atr_pivots.py`

Pivots are detected using an ATR-threshold reversal rule:
- A new pivot is confirmed when price reverses by at least `2.0 × ATR-14` from the prior pivot
- Minimum 3 bars between pivots
- **Pivot confirmation is causal:** a pivot is only confirmed on the bar where the reversal threshold is crossed, not retroactively

This is the most important design constraint in the system. Because confirmation is causal, there is no look-ahead bias. Every outcome measured is genuinely forward-looking from a point in time where the pivot was knowable.

### Stage 3: Legs

**File:** `backend/services/research_v1/legs.py`

Each consecutive pair of pivots defines a leg: a directional price move from one pivot to the next. Leg attributes include direction (UP/DOWN), price distance, and ATR-normalized distance.

### Stage 4: Pivot Labels

**File:** `backend/services/research_v1/labels.py`  
**Function:** `label_pivots_against_same_side_history()`

Each pivot is labeled relative to the prior pivot of the same type (prior high vs current high, prior low vs current low):

| Label | Meaning |
|---|---|
| `HH` | Higher High — this high exceeds the prior high |
| `HL` | Higher Low — this low is above the prior low |
| `LH` | Lower High — this high is below the prior high |
| `LL` | Lower Low — this low is below the prior low |
| `EH` | Equal High (rare, within tolerance) |
| `EL` | Equal Low (rare, within tolerance) |

These labels are the building blocks of all structural classification. `HH` and `HL` are bullish labels. `LH` and `LL` are bearish.

### Stage 5: 5-Pivot Motifs and Exact Signature

**File:** `backend/services/research_v1/motifs.py`  
**Function:** `_build_family_signature()`

A rolling window of 5 consecutive pivots defines a motif. Each motif stores an **exact v1 signature** that encodes:

1. Pivot type sequence (e.g. `HIGH-LOW-HIGH-LOW-HIGH`)
2. Pivot label sequence (e.g. `HH-HL-HH-HL-EH`)
3. Leg direction sequence (e.g. `UP-DOWN-UP-DOWN`)
4. Retracement bins for each leg relative to the prior leg

**Retracement ratio** = `|current leg price distance| / |prior leg price distance|`

Bins:
- `< 0.38` → `SHALLOW`
- `0.38–0.62` → `MEDIUM`
- `0.62–1.0` → `DEEP`
- `> 1.0` → `OVERDEEP`

Example exact signature:
```
HIGH-LOW-HIGH-LOW-HIGH|HH-LL-HH-HL|UP-DOWN-UP-DOWN|R2:DEEP|R3:DEEP|R4:SHALLOW
```

The exact signature is kept for traceability and debugging. It is too specific for statistical testing.

### Stage 6: Forward Outcomes

**File:** `backend/services/research_v1/outcomes.py`  
**Function:** `_return_atr()`

For each motif, two forward outcomes are measured:

- **5-bar forward return** — `(close_5_bars_later - entry_close) / ATR_at_entry`
- **10-bar forward return** — `(close_10_bars_later - entry_close) / ATR_at_entry`

The **entry bar** is the confirmation bar of the 5th pivot — the first bar at which the complete 5-pivot motif is knowable without look-ahead.

Units: **ATR-normalized return**. A value of `1.0` means price moved up by exactly one ATR unit over that period. This is not a percent return and not an R-multiple.

If fewer than 5 or 10 bars of future data exist, that outcome is recorded as `None` (excluded from statistics).

Additional outcome fields per motif:
- `mfe_5_atr`, `mfe_10_atr` — Maximum Favorable Excursion (best unrealized gain)
- `mae_5_atr`, `mae_10_atr` — Maximum Adverse Excursion (worst unrealized loss)
- `hit_plus_1atr_first` — did price hit +1 ATR before -1 ATR?
- `next_break_direction` — did price break to a new high or new low first after the motif?

### Stage 7: Family Aggregation and Statistics

**File:** `backend/services/research_v1/families.py`

#### v2 Generalized Signature

**Function:** `derive_family_signature_v2()`

Each motif's exact v1 signature is collapsed into a 4-token v2 signature that is broader but still structurally meaningful:

```
{ORIENTATION}|{STRUCTURAL_CLASS}|{BREAK_PROFILE}|{RETRACE_PROFILE}
```

See the complete token glossary below.

#### Chronological Splits

All data is partitioned chronologically — never shuffled — into three sequential segments:

- **Discovery** (oldest ~60% of motifs)
- **Validation** (middle ~20%)
- **Holdout** (newest ~20%)

This is the same principle as walk-forward testing. Families that only work on discovery data are over-fitted. Families that hold up across all three splits have more credibility.

#### Statistical Computations

**Function:** `aggregate_family_stats()`

All statistics are computed over all valid outcomes for this family on this symbol, with all three splits pooled together:

**`mean10`** = arithmetic mean of all valid `forward_10_return_atr` values  
Units: ATR-normalized return. Not percent, not R-multiple.

**`t10`** = `mean10 / std_error`  
where `std_error = sample_stddev / sqrt(N)`  
and `sample_stddev` uses Bessel's correction (divides by N−1, not N)

`t10` is a signal-to-noise ratio. It answers: "how many standard errors is the mean return above zero?" Values above ~1.5–2.0 suggest the mean is distinguishable from noise. Values near zero mean the signal is indistinguishable from random.

**`t10 = None` (shown as `n/a`)** when:
- Fewer than 2 valid 10-bar outcomes exist (can't compute variance with N ≤ 1)
- All outcomes have identical values (zero variance)
- No valid 10-bar outcomes exist at all

This is a sample-size and variance problem, not a data access problem.

Additional fields per family per symbol:
- `sharpe_like_forward_10` = `mean10 / sample_stddev` (Sharpe-like ratio in ATR units)
- `hit_plus_1atr_first_rate` — fraction of motifs where +1 ATR was hit before −1 ATR
- `next_break_up_rate`, `next_break_down_rate`
- `sign_consistent_across_splits` — boolean: does the sign of avg return agree across all three splits?
- `validation_degradation_pct`, `holdout_degradation_pct` — how much worse the return is in later splits vs discovery

### Stage 8: Multi-Symbol, Stability, and Explorer

**Files:** `multi_symbol.py`, `stability.py`, `explorer.py`

The pipeline runs independently for each symbol (SPY, QQQ, IWM, DIA). Then:

1. Per-symbol results are merged into a cross-symbol comparison (`multi_symbol.py`)
2. Direction agreement between structural labels and historical outcomes is computed (`stability.py`)
3. A self-contained HTML explorer is generated (`explorer.py`)

Cross-symbol aggregate fields shown in the explorer:
- `crossSymbolMeanTScoreForward10` — arithmetic mean of per-symbol `t10` values
- `crossSymbolMeanAvgForward10ReturnAtr` — mean of per-symbol `mean10` values
- `crossSymbolStddevAvgForward10ReturnAtr` — std dev of per-symbol `mean10` (dispersion across symbols)

---

## Complete Token Glossary

### Token 1: Orientation (HTL / LTH)

**Code:** `families.py` line 196, derived from `pivot_type_sequence` in `motifs.py`

| Token | Meaning |
|---|---|
| `HTL` | The 5-pivot window starts on a HIGH pivot: `HIGH-LOW-HIGH-LOW-HIGH`. The zigzag begins at a peak and ends at a peak, with troughs in between. Upward character. |
| `LTH` | Starts on a LOW pivot: `LOW-HIGH-LOW-HIGH-LOW`. Begins at a trough, ends at a trough. Downward character. |

Orientation alone says very little. It is the starting polarity of the zigzag window. The meaningful information is in tokens 2–4.

---

### Token 2: Structural Class

**Code:** `families.py` lines 145–164

Derived from the pivot label sequence (HH, HL, LH, LL counts and order).

| Token | Rule | Plain English |
|---|---|---|
| `CONTINUATION_UP` | All directional labels are HH or HL; zero bearish labels | Pure uptrend structure. Every pivot confirms the upward trend. |
| `CONTINUATION_DOWN` | All directional labels are LH or LL; zero bullish labels | Pure downtrend. Every pivot confirms the downward trend. |
| `REVERSAL_DOWN` | Has ≥ 1 HH label (prior uptrend) AND the most recent directional label is bearish (LH or LL) | Was trending up, just turned down. The structure made new highs, then most recently made a lower high or lower low. |
| `REVERSAL_UP` | Has ≥ 1 LL label (prior downtrend) AND the most recent directional label is bullish (HH or HL) | Was trending down, just turned up. Made new lows, then most recently made a higher low or higher high. |
| `MIXED_TRANSITION` | None of the above conditions are met | Mixed pivot sequence with no clean trend or reversal pattern. Structurally ambiguous. |

Note: `EH` and `EL` labels are neutral and do not count as bullish or bearish for these rules.

---

### Token 3: Break Profile

**Code:** `families.py` lines 166–173

Derived from whether `HH` or `LL` labels are present anywhere in the 5-pivot window.

| Token | Rule | Plain English |
|---|---|---|
| `HH_ONLY` | At least one HH label; no LL | The motif broke to a new high at some point, but never to a new low |
| `LL_ONLY` | At least one LL; no HH | Broke to a new low at some point, but never to a new high |
| `BOTH_BREAKS` | Both HH and LL present | Tested both directions — made a new high and a new low within the 5-pivot window |
| `NO_EXTREME_BREAK` | Neither HH nor LL | No extremes were broken. All pivots were HL, LH, EH, or EL — fully contained structure |

The break profile is important for the direction classification rule: a family with `NO_EXTREME_BREAK` is always demoted to `AMBIGUOUS` direction even if its structural class says BULLISH or BEARISH, because without a broken extreme there is insufficient directional evidence.

---

### Token 4: Retrace Profile

**Code:** `families.py` lines 175–194, bin thresholds from `motifs.py` lines 67–83

The retrace ratio for each leg = `|current leg price distance| / |prior leg price distance|`

Raw bins: `< 0.38` = SHALLOW, `0.38–0.62` = MEDIUM, `0.62–1.0` = DEEP, `> 1.0` = OVERDEEP (coerced to DEEP for the profile).

| Token | Rule | Plain English |
|---|---|---|
| `DEEP_DOM` | ≥ 2 legs have DEEP or OVERDEEP retracement | Most corrections retrace more than 62% of the prior leg. Strong oscillation or mean-reversion character. |
| `DEEP_PRESENT` | Exactly 1 DEEP leg | One large retracement. Some significant correction within the motif. |
| `MID_RETRACE` | No DEEP legs, but ≥ 1 MEDIUM leg | Moderate pullbacks (38–62% retracement). Trend continuation with meaningful corrections. |
| `SHALLOW_ONLY` | All legs < 38% retracement | Very shallow pullbacks. Strong trend continuation character — each leg barely gives back gains. |

---

## Card Field Definitions

### `occ` — Occurrence Count

**Total motif instances summed across all symbols.** If SPY=10, QQQ=8, IWM=6, DIA=4 → `occ=28`.

**Important:** This is a cross-symbol total. For statistical significance, what matters is the per-symbol count. The card shows `occ=28 (7/sym avg)` so you can see both. A family with `occ=28` across 4 symbols has only ~7 per symbol — marginal for reliable statistics.

**Code:** `explorer.py`, `build_family_explorer_payload()`, `total_occurrences` accumulation.

### `symbols` — Symbol Count

Number of symbols (out of SPY, QQQ, IWM, DIA) where this family appears at least once.

**Code:** `multi_symbol.py` line 209, `len(present_symbols)`.

### `t10` — Signal-to-Noise Ratio

`t10 = mean(forward_10_return_atr) / (sample_stddev / sqrt(N))`

Shown on cards as the **cross-symbol mean** of per-symbol t10 values.

This is structurally a one-sample t-statistic. It answers: how many standard errors is the mean 10-bar ATR return above zero? Values above ~1.5 are worth examining. Values near zero mean the signal is indistinguishable from random noise.

`t10 = n/a` means: N ≤ 1 valid outcomes, or zero variance across outcomes.

**Units:** dimensionless ratio (ATR / ATR standard error).  
**Code:** `families.py`, `_t_score()`, `_stddev()` (sample, N-1), `_std_error()`.

### `mean10` — Mean 10-Bar Forward Return

`mean10 = mean(forward_10_return_atr)` across all valid outcomes, all splits pooled.

Shown on cards as the cross-symbol mean of per-symbol mean10 values.

**Units: ATR-normalized return. Not percent. Not R-multiple.**  
A value of `1.0` means price moved up by 1× the ATR at the entry bar over 10 bars.  
A value of `-0.5` means price moved down by half an ATR.

**Code:** `families.py`, `aggregate_family_stats()`, `avg_forward_10`.

---

## Direction Label Definitions

**Code:** `backend/services/research_v1/direction.py`, `classify_family_direction_v2()`

### BULLISH / BEARISH / AMBIGUOUS

**These labels are structural — derived from the v2 signature shape, not from historical return data.**

| Label | Rule |
|---|---|
| `BULLISH` | Structural class is `CONTINUATION_UP` or `REVERSAL_UP` |
| `BEARISH` | Structural class is `CONTINUATION_DOWN` or `REVERSAL_DOWN` |
| `AMBIGUOUS` | Structural class is `MIXED_TRANSITION` — OR — break profile is `NO_EXTREME_BREAK` (overrides any structural class) |

A `BEARISH` label does NOT mean the historical outcomes are negative. It means the zigzag shape fits a bearish structural pattern. The AGREE/DISAGREE label tells you whether the historical data confirms the structural label.

---

## Agreement Label Definitions

**Code:** `backend/services/research_v1/stability.py` lines 401–410, `explorer.py`

### AGREE / DISAGREE / AMBIGUOUS

For each symbol separately:
- `historical_direction` = BULLISH if `avg_forward_10_return_atr ≥ 0`, else BEARISH
- If structural direction is AMBIGUOUS → agreement is AMBIGUOUS
- If `historical_direction == structural_direction` → AGREE
- Otherwise → DISAGREE

Cross-symbol (what the card shows):
- **AGREE** = all present symbols agree (zero disagree symbols, at least one agree)
- **DISAGREE** = at least one symbol disagrees
- **AMBIGUOUS** = structural direction is AMBIGUOUS

### How to Interpret AGREE vs DISAGREE

| Combination | Meaning | Action |
|---|---|---|
| BULLISH + AGREE | Shape is bullish AND historical returns are positive | Worth studying — structural and empirical evidence point the same way |
| BEARISH + AGREE | Shape is bearish AND historical returns are negative | Worth studying as a potential short or avoidance signal |
| BULLISH + DISAGREE | Shape is bullish BUT historical returns are negative | Do NOT trade as bullish. Shape and outcome contradict each other. |
| BEARISH + DISAGREE | Shape is bearish BUT historical returns are positive | Do NOT trade as bearish. The data says price goes up after this pattern. Could be a failed-reversal long setup. |
| AMBIGUOUS + AMBIGUOUS | No structural bias, no directional outcome consistency | Filter this out. No edge to work with. |

---

## How to Read a Family Card Correctly

A family card like `HTL|REVERSAL_DOWN|HH_ONLY|DEEP_DOM · DISAGREE · BEARISH (structural) · occ=55 (14/sym) · t10=1.937 · mean10=1.227 ATR` means:

1. **HTL** — the 5-pivot zigzag starts on a high pivot
2. **REVERSAL_DOWN** — the shape looks like a downward reversal: it had prior higher highs, and the most recent directional pivot was bearish
3. **HH_ONLY** — at some point in the motif, price made a new high (but never a new low)
4. **DEEP_DOM** — most corrections retraced more than 62% of the prior leg
5. **BEARISH (structural)** — the shape rule classifies this as bearish
6. **DISAGREE** — but the historical 10-bar returns are POSITIVE (+1.227 ATR on average) — the empirical outcome contradicts the structural label
7. **occ=55 (14/sym)** — 55 total occurrences, ~14 per symbol — marginal but workable
8. **t10=1.937** — the positive mean return is 1.937 standard errors above zero — a real signal, not noise
9. **mean10=1.227 ATR** — on average, price moved up 1.227× the ATR over the next 10 bars

**Bottom line for this card:** Despite looking like a bearish reversal shape, this pattern has historically been followed by upward price movement. Do not trade it short. If anything, study it as a failed-bearish-reversal long setup.

---

## Practical Filtering — Recommended Defaults

Based on the actual `isCandidateFamily` logic in `stability.py` and the statistical properties of the data:

| Filter | Recommended Default | Rationale |
|---|---|---|
| Min `occ` (total) | ≥ 15 | Implies roughly ≥ 4 per symbol — absolute minimum for any statistic |
| Min per-symbol avg occ | ≥ 5 | The code's own candidate threshold |
| Min `symbols` | ≥ 2 | Single-symbol evidence has no cross-market robustness |
| Direction | BULLISH or BEARISH only | AMBIGUOUS means no structural bias — no directional hypothesis to test |
| Agreement | AGREE only | DISAGREE means historical outcomes contradict the structural label |
| Break profile | Exclude `NO_EXTREME_BREAK` | The code itself demotes these to AMBIGUOUS — they have no extremes to anchor direction |
| Min `t10` | ≥ 1.5 | Below this, signal is not distinguishable from noise |
| Max dispersion (crossSymbolStddev) | < 1.0 ATR | High cross-symbol dispersion means inconsistent behavior across markets |

---

## What Comes After the Family Layer

The Family Explorer answers one question: does this structure have a consistent directional outcome? It does not produce a tradable strategy. The layers that must be built above the family layer are:

1. **Signal layer** — convert a family occurrence into a live causal event at pivot-5 confirmation. Produce a structured signal with timestamp, direction, and confidence.
2. **Regime filter** — condition the signal on macro/market regime (e.g., only take bullish family signals when SPY is above its 200-day MA).
3. **Timing layer** — additional conditions on when within the structure to enter (e.g., wait for the first pullback after pivot-5 confirms).
4. **Entry / risk layer** — define entry price, stop loss (ATR-based), take profit, max hold bars.
5. **Strategy layer** — composite of signal + regime + timing + risk, backtestable as a complete strategy.
6. **Validation layer** — run the strategy through the existing Validator (Tier-1, Tier-2 gate) before any live use.

The family stats (`t10`, `mean10`, `AGREE`) tell you whether the raw structural edge exists. Whether that edge survives realistic execution conditions is what the layers above determine.

---

## Known Limitations and Open Issues

### 1. Population vs sample stddev (fixed 2026-03-17)

Prior to 2026-03-17, `_stddev()` in `families.py` used population stddev (divided by N). This caused `t10` to be slightly inflated for small N. Fixed: now uses Bessel-corrected sample stddev (N−1). Re-run the pipeline to get corrected values.

### 2. `occ` is cross-symbol total, not per-symbol

A family with `occ=12` across 4 symbols has only 3 per symbol — too few for meaningful statistics. The card now shows `(N/sym avg)` alongside the total, but the filter should be applied at the per-symbol level.

### 3. BULLISH/BEARISH badge is structural, not empirical

This is the most common misreading. A green BULLISH badge means the shape fits a bullish structural pattern — not that the historical outcomes are positive. Always check AGREE/DISAGREE first.

### 4. `t10 = n/a` is not missing data

It means too few occurrences (N ≤ 1) or zero variance. It is itself meaningful: the family is too rare to evaluate statistically.

### 5. `isCandidateFamily` has two definitions

In `families.py`: `passes_min_count AND passes_outcome_coverage` (per-symbol, ≥ 5 each).  
In `stability.py`: `present_in_all_four_symbols AND passes_min_count_in_at_least_three`.  
The explorer uses the stability report version as primary with a fallback. These can disagree for edge cases.

### 6. No output JSON files in the current git repo

The pipeline output files (`backend/data/research/atr_pivot_v1/`) are not committed to git. They live in the runtime data backup at `C:\Users\eod99\OneDrive\Documents\Coding\pattern-detector-backups\`. Re-run `backend/scripts/run_atr_pivot_research.py` to regenerate them.

---

## Current Results (Multi-Symbol Run: SPY, QQQ, IWM, DIA · Daily · 10 Years)

Top candidate families by structural and empirical quality:

| Signature | Direction | Agreement | occ | symbols | t10 | mean10 |
|---|---|---|---|---|---|---|
| `LTH\|REVERSAL_UP\|LL_ONLY\|DEEP_DOM` | BULLISH | AGREE | 27 | 4 | 2.336 | 1.089 ATR |
| `LTH\|CONTINUATION_UP\|HH_ONLY\|DEEP_DOM` | BULLISH | AGREE | 85 | 4 | 2.067 | 0.987 ATR |
| `HTL\|REVERSAL_UP\|BOTH_BREAKS\|DEEP_DOM` | BULLISH | AGREE | 181 | 4 | 1.770 | 0.711 ATR |

Families with notable DISAGREE (shape vs outcome mismatch):

| Signature | Direction | Agreement | t10 | mean10 | Note |
|---|---|---|---|---|---|
| `HTL\|REVERSAL_DOWN\|HH_ONLY\|DEEP_DOM` | BEARISH | DISAGREE | 1.937 | 1.227 ATR | Shape says bearish, data says bullish |

---

## Key Implementation Files

| File | Purpose |
|---|---|
| `backend/services/research_v1/normalizer.py` | ATR-14 normalization |
| `backend/services/research_v1/atr_pivots.py` | Causal ATR reversal pivot detection |
| `backend/services/research_v1/legs.py` | Pivot-to-pivot leg construction |
| `backend/services/research_v1/labels.py` | HH/HL/LH/LL pivot labeling |
| `backend/services/research_v1/motifs.py` | 5-pivot motif windows + exact v1 signature |
| `backend/services/research_v1/outcomes.py` | ATR-normalized forward outcome measurement |
| `backend/services/research_v1/families.py` | v2 signature derivation, sample stddev, t10, mean10 |
| `backend/services/research_v1/multi_symbol.py` | Cross-symbol aggregation |
| `backend/services/research_v1/stability.py` | Direction agreement, trade simulation |
| `backend/services/research_v1/direction.py` | BULLISH/BEARISH/AMBIGUOUS structural classification |
| `backend/services/research_v1/explorer.py` | HTML explorer generation |
| `backend/scripts/run_atr_pivot_research.py` | Full pipeline runner |
| `backend/tests/test_structure_discovery_families.py` | Family aggregation tests |
| `backend/tests/test_structure_discovery_inspection.py` | Inspection tests |

---

## Bottom Line

The family system has produced a working, causal, inspectable research layer. What is established:

- Deterministic family aggregation works
- Chronological split testing is implemented and enforced
- v2 generalization reduces fragmentation without collapsing all structure
- Cross-symbol consistency is measured and displayed
- The AGREE/DISAGREE system correctly surfaces cases where structural shape and empirical outcomes disagree — which is the most important output of the system

What is not established:

- That any family's observed edge survives realistic execution (entry slippage, stop placement, position sizing)
- That the current family definitions are final — they may need tightening as more data accumulates
- That any family represents durable alpha rather than a statistical artifact of the training period

The correct next step is to take the top AGREE families with `t10 > 1.5`, `symbols ≥ 3`, `occ/sym ≥ 10`, and build the signal layer on top of them.
