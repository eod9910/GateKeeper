# Family Discovery v2 PRD / PDR

**Status:** REFERENCE  
**Date:** 2026-03-15  
**Scope:** Research-v1 family aggregation layer for causal structural motif discovery

---

## Purpose

This document records both:

- the product/design intent for the family layer
- the implementation and review history of what was actually built

It is the reference point for resuming work on motif families without rereading the full chat or rediscovering the artifact trail.

---

## PRD

## Problem

The project is not trying to detect named chart patterns directly. It is trying to:

`bars -> normalized bars -> pivots -> legs -> structure labels -> motif instances -> forward outcomes -> family stats`

Once 5-pivot motif instances exist, they must be grouped into family buckets that are:

- broad enough to accumulate sample size
- narrow enough to preserve structural meaning
- deterministic and inspectable
- causal and safe for downstream validation

The first family representation was too specific. On one symbol and one timeframe it produced many tiny buckets that were not statistically usable.

## Goals

- Group recurring motif instances into deterministic family buckets.
- Preserve enough structural information to support manual inspection.
- Measure family behavior chronologically, not with shuffled data.
- Detect fragmentation early before scaling to more symbols.
- Produce a human-inspectable top-family report with chart snippets.

## Non-Goals

- No clustering yet.
- No ML classification yet.
- No named-pattern mapping yet.
- No profitability tuning or parameter sweeps at the family layer.
- No multi-symbol scaling until family buckets look coherent by inspection.

## Locked Baseline Assumptions

- Symbol: `SPY`
- Timeframe: `1d`
- History: 5 years
- Parser: ATR reversal pivots
- ATR period: `14`
- Reversal threshold: `2.0 ATR`
- Min bars between pivots: `3`
- Pivot confirmation is causal and uses the pivot-5 confirmation bar as the motif outcome anchor

## Family Layer Requirements

### v1 Exact Signature

Each motif stores an exact deterministic signature derived from:

- pivot type sequence
- pivot label sequence
- leg direction sequence
- retracement bins

This exact signature is kept for traceability and debugging.

### v2 Generalized Family Signature

The aggregation key used for broader testing is a second deterministic signature that is less specific than the exact signature.

It uses coarse fields:

- orientation (`HTL` or `LTH`)
- coarse structural class
- coarse break profile
- coarse retrace profile

The design target is a middle layer:

- broader than exact sequence
- narrower than trivial bullish/bearish/neutral buckets

## Success Criteria

The family layer is considered useful if it produces:

- fewer buckets than exact v1 grouping
- more families with coverage across discovery, validation, and holdout
- more families with enough counts to test chronologically
- buckets that still look visually coherent by chart inspection

---

## PDR

## What Was Built

### 1. Exact deterministic family aggregation

Built first on top of 5-pivot motifs and outcome records.

Outputs:

- family occurrence counts
- valid 5-bar and 10-bar outcome counts
- return, MFE, MAE, and hit-rate stats
- candidate flags using simple count thresholds

### 2. Chronological split stats

Added `discovery / validation / holdout` using chronological partitions only.

No shuffle was used.

Per-family split fields added:

- `discoveryCount`
- `validationCount`
- `holdoutCount`
- split-specific average 10-bar returns
- split-specific `hitPlus1AtrFirstRate`
- sign consistency across splits
- validation and holdout degradation vs discovery

### 3. Fragmentation analysis

Added a report to explain which parts of the exact signature were causing over-splitting.

Main finding:

- exact pivot label sequence was the biggest uniqueness driver
- retracement bins were the second biggest
- leg direction contributed effectively nothing

### 4. Deterministic familySignatureV2

Added a generalized deterministic family representation while preserving the exact signature inside each broader family.

This was an A/B layer, not a parser change.

Nothing changed in:

- parser
- pivots
- legs
- labels
- motifs
- outcomes
- split logic

### 5. Top-family inspection report

Built a v2 inspection report with:

- top families by occurrence
- top families by avg 10-bar return with min-count filter
- top families by split consistency
- representative exact signatures
- representative motif instances with timestamps
- saved chart snippets for manual coherence inspection

---

## Current Measured Results

Dataset:

- `SPY 1d`
- 5 years
- `2.0 ATR` baseline parser

Pipeline counts:

- `1256` bars
- `159` pivots
- `158` legs
- `159` pivot labels
- `155` motif instances
- `155` outcome records
- `150` valid 10-bar outcomes

### v1 Exact Family Stats

- `128` unique families from `155` motifs
- `4` families present in all three splits
- `0` families passing discovery + validation count thresholds
- `2` families with consistent forward-10-return sign across all three splits
- `1` candidate family

Interpretation:

The exact deterministic signature was traceable, but too fragmented for reliable aggregation on the baseline dataset.

### v2 Generalized Family Stats

- `17` unique families from `155` motifs
- `9` families present in all three splits
- `2` families passing discovery + validation count thresholds
- `4` sign-consistent families across splits
- `8` candidate families

Interpretation:

The v2 generalization materially improved aggregation without collapsing all structure into meaningless direction buckets.

---

## Top v2 Families Seen So Far

### By occurrence count

- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count `26`
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count `21`
- `family_000013` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` count `20`
- `family_000015` `LTH|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` count `18`
- `family_000009` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_DOM` count `14`

### By avg 10-bar forward return

- `family_000010` `LTH|CONTINUATION_UP|HH_ONLY|DEEP_PRESENT` avg `1.5673`
- `family_000002` `HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM` avg `1.3432`
- `family_000004` `HTL|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg `0.9351`
- `family_000007` `HTL|REVERSAL_UP|BOTH_BREAKS|DEEP_DOM` avg `0.9207`
- `family_000013` `LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM` avg `0.6162`

These rankings are inspection inputs, not proof of robust alpha.

---

## Key Design Decisions

### Keep exact signature and v2 signature simultaneously

This was the correct move.

Without the exact signature, later inspection would become opaque.
Without the generalized v2 signature, the family landscape was too fragmented to test.

### Use chronological validation immediately

This exposed the real weakness of the exact family definition early.
It prevented false confidence from pooled counts.

### Do not scale to multi-symbol before family inspection

Also correct.

Scaling brittle buckets across more symbols would only multiply confusion.

---

## What the Inspection Layer Is For

The v2 family inspection report is meant to answer four questions:

1. Do grouped motifs actually resemble one another?
2. Are the exact signatures inside each v2 family structurally related?
3. Are the outcomes concentrated or internally noisy?
4. Do the chart examples look like one visible structural behavior class?

The next scaling decision depends on that inspection.

---

## Current Risks

### Risk 1: v2 may still be too coarse in some buckets

Some v2 families may be aggregating motifs that are statistically related but visually mixed.

### Risk 2: one-symbol evidence is still thin

Even after v2 generalization, some families remain small.

### Risk 3: high internal dispersion may hide weak buckets

A family can have a positive average return while still being a noisy garbage bucket.

This is why the inspection report includes:

- representative exact signatures
- example motifs with timestamps
- chart snippets
- dispersion fields like forward-10 standard deviation

---

## Recommended Next Step

Before scaling to more symbols:

1. inspect the top v2 families manually
2. decide whether the buckets are structurally coherent

Only two valid outcomes exist:

### Outcome A: top families look coherent

Then:

- keep `familySignatureV2`
- scale to a controlled multi-symbol set
- suggested next set: `SPY`, `QQQ`, `IWM`, optionally `DIA`

### Outcome B: top families are too mixed

Then:

- keep coarse retrace bins
- tighten the structural class definitions
- refine break-profile logic
- rerun aggregation and inspection before scaling

Do not jump to clustering before this checkpoint is resolved.

---

## Artifacts

Core research outputs:

- `backend/data/research/atr_pivot_v1/spy_1d_5y_family_stats.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_family_summary.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_fragmentation_report.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_family_stats_v2.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_family_summary_v2.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_fragmentation_report_v2.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_family_comparison.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_top_family_inspection_v2.json`
- `backend/data/research/atr_pivot_v1/spy_1d_5y_top_family_inspection_v2.md`
- `backend/data/research/atr_pivot_v1/v2_family_snippets/`

Key implementation files:

- `backend/services/research_v1/families.py`
- `backend/services/research_v1/inspection.py`
- `backend/scripts/run_atr_pivot_research.py`
- `backend/tests/test_structure_discovery_families.py`
- `backend/tests/test_structure_discovery_inspection.py`

---

## Bottom Line

The family work has crossed the threshold from vague idea to usable research layer.

What is proven:

- deterministic family aggregation works
- chronological split testing works
- fragmentation can be measured explicitly
- v2 generalization reduced fragmentation materially
- inspection artifacts now exist to judge whether the v2 buckets are visually coherent

What is not proven yet:

- that the current v2 buckets are the final family definition
- that the observed family behavior generalizes across symbols
- that any family represents durable tradable edge

That makes the current state:

- past pure architecture discussion
- not yet ready for broad scaling
- ready for focused top-family manual inspection
