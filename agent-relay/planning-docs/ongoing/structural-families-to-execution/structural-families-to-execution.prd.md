# Structural Families to Execution â€” PRD

Checklist: structural-families-to-execution-checklist.md

**Status:** ACTIVE
**Created:** 2026-03-18
**Scope:** End-to-end evolution from discovered structural motifs to executable strategies in this repo

---

## Purpose

This document is the **master planning document and PRD** for the structure-first approach: discovering recurring price structures (motif families), validating them statistically, and turning them into signals and strategies inside Pattern Detector. It answers:

- Why we do this instead of detecting named patterns (head and shoulders, Wyckoff, etc.)
- How the four system layers (Research â†’ Signal â†’ Strategy â†’ Portfolio) connect
- How structural families plug into the existing scanner, validator, and execution system
- What to build next and in what order

Related but narrower docs:

- **Family discovery (research layer only):** `.planning/plans/ACTIVE/family-discovery-v2-prd-pdr.md`
- **Structure-only family test ledger:** `.planning/plans/ACTIVE/../REFERENCE/family-structure-validation-ledger.md`
- **Phased roadmap (layers + UI order):** `.planning/plans/ACTIVE/Update.md`
- **Symbolic Regression (formula discovery):** `.planning/plans/ACTIVE/SR Engine.md` â€” scoring formulas for setups; can use family features after indicator-based first path.
- **Strategy validation rules:** `.planning/plans/REFERENCE/strategy-validation-policy.md`
- **Other research path (composite/strategy discovery):** `.planning/plans/ACTIVE/research-to-live-trading.md`

---

## Problem Statement

**Wrong approach (what we are not doing):**
Build detectors for named chart patterns (head and shoulders, Quasimodo, Wyckoff accumulation, etc.). Problems: those patterns are subjectively defined, overlap, lack a single definition, and there is no statistical proof they outperform random.

**Right approach (what we are doing):**
Do not name patterns. Let the data define recurring **structures** from price (bars â†’ pivots â†’ legs â†’ labels â†’ 5-pivot motifs). Group those motifs into **families** by structural properties. Measure what happens *after* each family appears, across discovery/validation/holdout and across symbols. Only then treat a family as a candidate for trading. Structure is discovered and validated; names are optional later.

**Gap this PRD addresses:**
The research pipeline (families, explorer, stats) exists. The missing piece is a clear plan for how those families are **used** in this repo â€” not as a standalone tool, but as a new class of signal that flows through the existing scanner, validator, and execution stack.

---

## Vision

**End state:**
Recurring structural motif families are discovered offline, validated (ranking, baseline comparison, visual inspection). Validated families become **signal emitters** that plug into the scanner. Those signals are wrapped with exit rules and run through the existing validator (Tier 1 â†’ Tier 2 â†’ Tier 3). Approved family strategies are traded by the same execution bridge and position book the rest of the app uses. The system has two sources of strategies: (1) composite/indicator strategies (e.g. MACD divergence + regime filter), and (2) structure-first family strategies.

---

## System Layers (How the Stack Fits Together)

Four layers, in order. Each answers one question.

| Layer        | Question                                      | Status in repo | Artifacts / touchpoints |
|-------------|------------------------------------------------|----------------|--------------------------|
| **1. Research** | What recurring structures exist, and how do they behave? | Built         | `research_v1/`, Family Explorer, `run_atr_pivot_research.py`, `data/research/atr_pivot_v1/` |
| **2. Signal**   | When does that structure actually occur in real time?     | Not built     | New plugin type: â€œfamily signalâ€ emits at pivot-5 confirmation |
| **3. Strategy** | How exactly do I trade this signal?                      | Exists        | Same strategy spec + validator + risk_config as today |
| **4. Portfolio**| How do I run multiple family strategies together?        | Future        | Position sizing, family/symbol weighting, risk caps |

Families do **not** replace the scanner. They **feed into** it as a new kind of plugin that emits candidates when a validated family is detected.

---

## How Structural Families Plug Into This Repo

### Research layer (current)

- **Runs offline.** Script: `backend/scripts/run_atr_pivot_research.py`. Symbols: SPY, QQQ, IWM, DIA (daily, 10y). Pipeline: bars â†’ ATR pivots â†’ legs â†’ labels â†’ 5-pivot motifs â†’ outcomes â†’ family aggregation (v1 exact + v2 generalized) â†’ fragmentation â†’ inspection â†’ cross-symbol comparison â†’ stability.
- **Outputs:** JSON and HTML under `backend/data/research/atr_pivot_v1/`. Family Explorer is static HTML (LightweightCharts) served via `/family-explorer` and `/research-artifacts/`.
- **Use:** Inspect families, rank them, compare to baselines, decide which families are â€œrealâ€ before building the signal layer.

### Signal layer (next)

- **Family as scanner plugin.** A new Python plugin (e.g. `family_signal_primitive.py` or equivalent) that:
  - Runs the same ATR pivot parser on **live** (or backtest) data.
  - Maintains a rolling 5-pivot window.
  - When the window matches a **validated family signature** (from the research layer), emits a candidate with `entry_ready: true` at the pivot-5 confirmation bar.
- **Integration:** Registered in `registry.json`, invoked by `strategyRunner.py` like any other plugin. Scanner runs it; copilot sees the candidate. No new â€œstandalone scannerâ€ â€” the existing scanner runs family-based strategies as one more plugin.
- **Validator:** Backtester already runs strategies by symbol/interval; family signal becomes the entry source. Same Tier 1/2/3 and strategy-validation policy apply.

### Strategy layer (existing)

- **Same as today.** A â€œstrategyâ€ is: entry logic (e.g. family signal) + exit rules (stop, target, time stop) + risk_config. Family strategies are just strategies whose entry is â€œwhen this family fires.â€ They get a strategy spec, go through the validator, get approved or tombstoned per `.planning/plans/REFERENCE/strategy-validation-policy.md`.

### Portfolio layer (future)

- **After** individual family strategies are validated: multi-strategy position sizing, family weighting, symbol weighting, correlation control. Same execution bridge and data/APIs; additional portfolio-level logic.

---

## Phased Roadmap (What to Build and When)

### Phase 1 â€” Strengthen the research workstation

Goal: Know which families are worth turning into signals.

| # | Deliverable | Purpose |
|---|-------------|---------|
| 1 | **Family ranking controls** | Sort/filter families by t-score, occurrence count, cross-symbol dispersion, agreement status, candidate status. Answer: â€œWhich families matter most?â€ |
| 2 | **Baseline / null-model comparison panel** | Compare family outcomes vs random timestamps, random motifs, direction-only baseline. Answer: â€œBetter than what?â€ |
| 3 | **Visual motif inspection improvements** | Refine inspection so we can confirm: â€œDo these examples look like the same structural thing?â€ |

**Exit condition:** You can rank families, compare them to baselines, and inspect them. You have a short list of â€œvalidated familiesâ€ to take to Phase 2.

### Phase 2 â€” Connect research to trading

Goal: Turn validated families into signals and test them as strategies.

| # | Deliverable | Purpose |
|---|-------------|---------|
| 4 | **Signal layer** | Implement family-as-plugin: same ATR pivot + 5-pivot logic, emit candidate when window matches a chosen family signature. Integrate with scanner and backtester. |
| 5 | **Execution simulation panel** | Simulate trading a family (e.g. 1R stop/target) on historical data from the research dataset. Bridge between research stats and strategy backtest. |
| 6 | **Strategy layer for families** | Wrap family signal with risk_config and exit rules; run through full validator (Tier 1 â†’ 2 â†’ 3). Approve or tombstone per strategy-validation policy. |

**Exit condition:** At least one family strategy passes validation and is runnable in the same execution/position book as existing strategies.

### Phase 3 â€” Scale

| # | Deliverable | Purpose |
|---|-------------|---------|
| 7 | **Portfolio layer** | Multi-strategy execution: family weighting, symbol weighting, max concurrent, risk caps. |

---

## State Machine Migration Program

Now that the state machine engine is implemented and the first migrated strategies validated correctly, the next repo-wide strategy hardening step is to audit every family and classify whether it is safe to remain stateless or must be rebuilt around explicit inter-bar state.

### Migration rule

A strategy is **stateful-required** if its logic depends on memory across bars, including any of the following:

- arming on one event and entering on a later event
- a watch window or lookforward anchored to a prior bar
- expiry or invalidation after arming
- "fire once" semantics for one structural event instead of firing on every bar in the zone
- plugin logic that simulates forward-looking sequence state inside repeated prefix-window evaluation

If none of those are true, the strategy is **stateless-safe**.

### Current family inventory and migration checklist

| Family / strategy_id | Current state | Classification | Why | Next action |
|---|---|---|---|---|
| `wyckoff_accumulation_rdp` | `wyckoff_accumulation_rdp_v1_stateful` exists and is validating correctly | **Stateful-required** | Pullback logic depends on first-breakout anchoring + 200-bar watch window | Treat stateful spec as canonical branch; promote winner; run Tier 3; mark old stateless version superseded |
| `lth_continuation_composite` | `lth_continuation_composite_v1_stateful` exists | **Stateful-required** | Structural family accumulation + delayed RSI/Fib confirmation require arming/watch semantics | Re-run Tier 1/Tier 2 on stateful lineage and compare against stateless baseline |
| `macd_divergence_crypto_14R` | Historical stateful migration is documented in memory bank, but no current `*_stateful.json` is present in `backend/data/strategies/` | **Stateful-required** | Divergence pullback timing is sequence-dependent and was already proven to improve under stateful migration | Recreate or normalize the surviving stateful spec, then validate from Tier 1 forward |
| \pullback_uptrend_entry_composite\ | Current live spec is stateless composite of MACD divergence + regime gate | **Stateless-safe** (audited 2026-03-26) | \macd_divergence_primitive_v2\ scans full bar array each call, comparing last two swing pairs â€” no inter-bar memory required. Regime gate is also a stateless per-bar check. No arming/watch window. | No migration needed. Keep as-is. |
| `sma_50_200_benchmark` | Simple crossover benchmark | **Stateless-safe** | Pure local indicator condition; no anchored watch window or arm/expire cycle | Leave unchanged; use as control / regression benchmark |

### Execution order

1. Finish the already-proven migrated lineages:
   - `wyckoff_accumulation_rdp`
   - `lth_continuation_composite`
   - `macd_divergence_crypto_14R`
2. Audit dependent composites that may be inheriting broken stateless timing:
   - `pullback_uptrend_entry_composite`
   - any future composites whose timing stage depends on migrated primitives
3. Keep clearly stateless controls unchanged:
   - `sma_50_200_benchmark`

### Migration deliverables per family

For every family marked **stateful-required**:

1. Preserve the old spec for audit trail.
2. Add an explicit `setup_config.state_machine`.
3. Add `_migration_notes` documenting:
   - source version
   - why the stateless engine was wrong
   - expected backtest effect
   - remaining limitations
4. Validate in order:
   - Tier 1
   - Tier 2
   - bounded failure-targeted sweep if needed
   - Tier 3
5. Mark the older stateless version as superseded once the migrated branch is validated.

### Explicit non-goal

Do **not** mass-convert every strategy mechanically. Only strategies that actually depend on inter-bar memory should receive state machines. Blind conversion would add complexity without improving correctness.

---

## Success Criteria

- **Research:** Family Explorer and artifacts exist; ranking and baseline comparison available; top families manually inspected and deemed coherent or not.
- **Signal:** A family can be selected from research output and used as the entry condition for a strategy; scanner and backtester both consume it.
- **Strategy:** Family-based strategies are validated with the same rigor as composite strategies (Tier 1/2/3, tombstone, identity rule).
- **Clarity:** Any contributor can read this PRD and understand that â€œstructural familiesâ€ are not a separate product â€” they are a structure-first signal source that flows through the same pipeline as the rest of the app.

---

## Non-Goals / Out of Scope (for this PRD)

- Replacing or rewriting the existing scanner/validator/execution stack.
- Detecting or naming classic patterns (H&S, Wyckoff, etc.) as the primary taxonomy; those can be optional labels later.
- Clustering or ML classification of families (deferred).
- Portfolio layer design in detail (separate plan when Phase 2 is done).

---

## Naming and Placement

- **Initiative name:** Structural Families to Execution (or â€œstructure-first trading evolutionâ€).
- **This document:** `ACTIVE/structural-families-to-execution-prd.md` â€” master PRD for the full evolution.
- **Discovery-only PRD:** `ACTIVE/family-discovery-v2-prd-pdr.md` â€” research layer and family discovery details only.

---

## Summary

Structural families are **discovered** in the research layer, **validated** with ranking and baselines, then **used** as a new type of scanner plugin that emits signals when a 5-pivot motif matches a validated family. Those signals become strategies (entry + exit + risk) and go through the existing validator and execution system. This PRD is the single place that describes that end-to-end evolution and how it fits into the repo.
