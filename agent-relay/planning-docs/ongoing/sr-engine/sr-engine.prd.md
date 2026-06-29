Hereâ€™s a **clean PRD + planning document** tailored to your system, your validator philosophy, and your current Research Agent architecture.

Checklist: sr-engine-checklist.md

---

# ðŸ“„ PRODUCT REQUIREMENTS DOCUMENT (PRD)

## Product Name

**Symbolic Regression Module (SRM)**

---

## What SR Is and What Itâ€™s For (In This App)

**Symbolic regression (SR)** is a type of machine learning that searches for **interpretable mathematical formulas** that fit data â€” instead of a black-box model (e.g. a neural net), you get an actual equation, e.g. `score = (ATR * momentum) / (1 + retrace_depth)`. The algorithm (e.g. genetic programming via gplearn) evolves combinations of variables and operators until it finds formulas that predict a target variable well, often with a complexity penalty so simpler expressions are preferred.

**In the context of Pattern Detector, SR is for one thing:** learning **how to score setups** so the app can tell better instances from worse ones, instead of treating every detection or signal the same.

Today the app can:

* Detect patterns, run indicators, and compose strategies.
* Emit â€œthis pattern firedâ€ or â€œthis strategy says enterâ€ â€” but it does **not** say â€œthis particular instance is strong vs weak.â€

SR adds that missing layer: **a learned scoring function** that takes numeric features (from a pattern, an indicator, or a strategy at signal time) and outputs a continuous score that predicts outcome quality (e.g. forward return or win propensity). That score can then be used to:

* **Rank** â€” e.g. show scanner results sorted by SR score.
* **Filter** â€” e.g. only consider signals above a score threshold.
* **Enhance** â€” e.g. feed the score into existing strategies or the Research Agent.

SR does **not** replace pattern detection, indicators, or the validator. It **sits on top**: we still detect and validate as today; SR proposes a formula that scores each instance, and the validator (and optional promotion rules) decide whether that formula is good enough to use. So: **SR = formula discovery for setup quality; the rest of the app stays the gatekeeper.**

---

## How SR Is Used in the Research Module

Yes â€” SR is used **from the Research page**, as a second mode alongside the existing â€œStrategy discoveryâ€ (Research Agent) mode.

### Where it appears

* Same **Research** page you have today (research.html).
* When starting a new session, you choose **Research mode**: **Strategy discovery** (current behavior) or **Symbolic Regression**.
* If you choose Symbolic Regression, the form shows SR-specific options instead of (or in addition to) the strategy-discovery fields.

### What you do (SR session)

1. **Start a new Research session** and select mode **Symbolic Regression**.
2. **Configure the run:**
   * **Feature source** â€” e.g. â€œIndicator + OHLCVâ€ (easiest), â€œStructural familyâ€, or â€œStrategy outputâ€ (later).
   * **Target** â€” what you want the formula to predict (e.g. 5-bar forward return, or ATR-normalized return).
   * **Scope** â€” symbol(s), interval (e.g. SPY, 1d). For â€œIndicator + OHLCVâ€ you might pick one symbol and one interval.
   * Optionally: which indicators to include (RSI, ATR, momentum), or which family.
3. **Start** the session. The system builds the feature matrix, runs symbolic regression (e.g. gplearn), gets candidate formulas, and runs each through the validator.
4. **Review results** in the same Research UI: a **formula leaderboard** (formula string, complexity, validation metrics) instead of a strategy leaderboard. You can promote formulas that pass thresholds.
5. **Promoted formulas** are stored in the SR registry (formula + metadata + metrics). They are then **available for use elsewhere** in the app.

### What you get out of it

* One or more **interpretable formulas** that score setup quality (e.g. `score = (ATR_norm * momentum) / (1 + abs(RSI - 50))`).
* Each formula has been **validated** (expectancy, drawdown, walk-forward, etc.) so you only keep ones that meet your bar.
* You use these formulas **outside** the Research page to rank, filter, or enhance signals.

### What youâ€™re supposed to get: primitives for composites

The main intended output of the Research module (SR mode) is **primitives that can be wrapped inside composite strategies.** A promoted formula is turned into a **primitive** â€” like RSI, regime_filter, or order_blocks â€” that you can add as a **stage** in a composite. So:

* Research (SR) **discovers and validates** a formula (e.g. `score = (ATR_norm * momentum) / (1 + abs(RSI - 50))`).
* The system **packages that formula as a primitive** (e.g. registered in the pattern registry, with a formula_id and the same contract as other primitives: inputs from the chart/context, output e.g. a score and/or a pass-through for the reducer).
* In Indicator Studio (or the Research Agent when building composites), you **compose** that primitive with others: e.g. `regime_filter(SPY, expansion) AND order_blocks AND sr_score_xyz` â€” only enter when regime + order block + SR score all pass.

So yes: **what you get out of Research (SR) is actual primitives that can be wrapped inside composite strategies.** Scanner ranking and signal filtering are then natural consequences (the composite that includes the SR primitive is what the scanner runs; ranking/filtering can use the same primitiveâ€™s output).

### Other ways the formulas are used

Once a formula is promoted and exposed as a primitive, it can also be used as follows:

| Use | Where in the app | What happens |
|-----|-------------------|--------------|
| **Primitive in a composite** | Indicator Studio / composite spec | The SR formula is a **stage** in the pipeline (e.g. â€œSR score &gt; thresholdâ€). Composites combine it with regime, order blocks, etc. This is the primary use. |
| **Scanner ranking** | Scanner results | Sort or rank candidates by the SR primitiveâ€™s score (e.g. â€œbest setups firstâ€). |
| **Signal filtering** | Scanner or strategy | Only show or pass signals where the SR primitiveâ€™s output is above a threshold. |

So the **Research module** is where you **discover and validate** the formula and **produce a primitive**; that primitive is then **composed** in strategies and used for ranking/filtering where applicable.

### Primitive vs composite vs strategy â€” how we validate

In this app:

* **Primitive** = a building block: **structure**, **location**, or **timing trigger** (e.g. order blocks, RSI, regime_filter). An SR formula is packaged as a primitive (e.g. a structure or timing primitive that outputs a score or pass/fail).
* **Composite** = a **structure** in the sense of â€œwhere things liveâ€: primitives wired together (structure + location + timing + regime). No stop loss or take profit yet â€” just the logic that says when a setup is present.
* **Strategy** = a **composite wrapped in entry and exit criteria** â€” i.e. the composite plus stop loss, take profit, max hold, etc. The validator runs **strategies**, not primitives or bare composites.

So we **do not** test an SR formula â€œas a primitiveâ€ in isolation (the validator doesnâ€™t run primitives by themselves). We **wrap the SR primitive in a composite**, then wrap that **composite in a strategy** (add entry/exit rules), and **run the validator on the strategy**. The formula is tested as part of a full strategy: composite (e.g. SR primitive + regime_filter + â€¦) + stop + target â†’ validator â†’ expectancy, drawdown, pass/fail. That way SR output gets the same validation contract as any other strategy.

---

## 1. Purpose

Enable the system to **discover mathematical scoring functions** that evaluate the quality of setups â€” not only within structural families, but for **indicators** and **strategies** as well. SR is a general formula-discovery layer: wherever we have numeric features and a target, we can learn score = f(features).

The module will:

* generate formulas from features
* evaluate them using the existing validator
* promote only statistically robust formulas
* **package promoted formulas as primitives** so they can be used as stages in composite strategies (same contract as RSI, regime_filter, order_blocks, etc.), and **expose their parameters** so the Parameter Sweep can tune them (see strategy-validation-policy: Research â†’ Sweep contract).

**Feature sources (all in scope):**

* **Structural families** â€” motif/family features (e.g. retrace_profile, break_profile, orientation)
* **Indicators** â€” indicator-derived features (e.g. RSI, ATR, momentum, regime strength)
* **Strategies** â€” strategy/signal context (e.g. composite stage outputs, entry context, symbol/regime)

---

## 2. Problem Statement

Current system:

* detects patterns, runs indicators, composes strategies
* often treats detections or signals equally within a class
* uses fixed rules or composed indicators with human-chosen weights

Limitation:

* cannot distinguish **high-quality vs low-quality instances** â€” whether thatâ€™s the same pattern, the same indicator reading, or the same strategy signal
* mixes heterogeneous quality under one label
* relies on human intuition for feature weighting (families, indicators, and strategies alike)

---

## 3. Solution Overview

Introduce a new research mode:

> **Symbolic Regression Mode**

This mode:

1. takes structured features
2. generates mathematical formulas
3. scores setups using those formulas
4. validates performance through the existing validator
5. promotes only formulas that meet thresholds

---

## 4. Core Concept

The system will learn:

> **score = f(features)**

Where:

* **input** = features from the chosen context: **family/motif**, **indicator outputs**, or **strategy/signal context** (or combinations)
* **output** = continuous score predicting trade quality (e.g. forward return, win propensity)

SR is **not only for the motif/family system** â€” it applies to any research or production context where we have a feature matrix and a target (e.g. indicator-based scans, strategy variants, or structural families).

---

## 5. Scope

### Included

* formula generation (gplearn â†’ PySR later)
* feature-based scoring
* integration with validator
* research session integration
* registry storage

### Not Included (initial version)

* full strategy generation
* stop/target discovery
* portfolio-level optimization
* real-time execution

---

## 6. User Flow

### Step 1 â€” Start Research Session

User selects:

* Mode: **Symbolic Regression**
* **Feature source** â€” e.g. structural families, indicator(s), strategy/scan output (determines what goes into X)
* Target: (e.g., 3-bar ATR return, P(continuation), hit 1R first)
* Feature set (or family / indicator / strategy selection)
* Asset class

---

### Step 2 â€” Feature Extraction

System builds matrix:

```
X = [features]
y = [target]
```

---

### Step 3 â€” Formula Generation

SR engine produces candidate formulas:

```
score = (ATR * momentum) / (1 + retrace_depth)
```

---

### Step 4 â€” Validation

Each formula is passed through:

* expectancy
* win rate
* drawdown
* profit factor
* walk-forward
* cost modeling

---

### Step 5 â€” Promotion

Only formulas meeting thresholds are stored.

---

### Step 6 â€” Usage

Formulas can be used for:

* scanner ranking
* discretionary filtering
* strategy enhancement

---

## 7. Functional Requirements

### 7.1 Research Mode Toggle

Add:

* Rule-Based
* **Symbolic Regression**

---

### 7.2 Target Selection

Allow:

* forward return (N bars)
* probability of continuation
* probability of failure

---

### 7.3 Feature Input System

Must support:

* numeric feature matrix **X**
* derived from one or more of:
  * **Structural families** â€” pattern detector + family classifier (motif features, retrace/break profiles, etc.)
  * **Indicators** â€” indicator system (RSI, ATR, momentum, regime, custom primitives)
  * **Strategies** â€” strategy/scan output (composite stage values, entry context, symbol/regime at signal time)

So SR can score **family instances**, **indicator readings**, or **strategy signals** â€” not only motifs.

---

### 7.4 SR Engine Integration

Phase 1:

* gplearn

Phase 2:

* PySR

---

### 7.5 Formula Output

Each formula must include:

* equation string
* complexity score
* feature usage

---

### 7.6 Validator Integration

All formulas must pass:

* expectancy > threshold
* max drawdown < limit
* profit factor > threshold
* walk-forward survival

---

### 7.7 Registry Storage

Store:

* formula
* metrics
* dataset used
* feature set
* complexity
* promotion status

---

## 8. Non-Functional Requirements

* must not bypass validator
* must prevent lookahead bias
* must penalize complexity
* must support reproducibility
* must integrate with existing pipeline

---

## 9. Success Metrics

* % of SR formulas passing validator
* improvement in expectancy vs baseline
* improvement in signal ranking quality
* reduction in false positives
* stability across walk-forward splits

---

## 10. Risks

### Overfitting

Mitigation:

* strict validator
* complexity penalty
* walk-forward testing

---

### Garbage Formulas

Mitigation:

* operator whitelist
* feature constraints
* monotonic rules (optional)

---

### System Complexity

Mitigation:

* isolate SR as separate mode
* reuse existing validator

---

# âœ… READINESS (Before You Build)

### Ready

* **PRD and scope** â€” Clear. SR applies to families, indicators, strategies; integrated as a Research page mode.
* **Validator** â€” Exists and is the gate. SR must feed it; exact hook is below.
* **Research page** â€” Sessions, SSE, leaderboard, promotion. Adding a â€œResearch modeâ€ (Strategy discovery | Symbolic regression) and SR-specific form + detail view is well-defined.

### To Add or Lock In

1. **Dependency** â€” Add `gplearn` (or equivalent) to `requirements.txt`; not in repo yet.
2. **Feature matrix contract** â€” Define `build_feature_matrix(...)` clearly. **Easiest first** (recommended): indicator + OHLCV â€” see â€œEasiest first pathâ€ below. Then later: family-based (research_v1 motifs + outcomes), then strategy/scan output.
3. **Validator hook** â€” â€œapply_formula â†’ generate signals â†’ validateâ€ needs a concrete design:
   * Option A: Formula scores each event; take events with score &gt; threshold as â€œsignalsâ€; adapter turns them into entries (symbol, bar_index, direction) and validator runs with that entry list (or a minimal strategy that emits those entries).
   * Option B: New â€œformula filterâ€ plugin: base strategy emits candidates; plugin scores them with the formula and passes only those above threshold; validator runs as today.
   * Decide which option (or variant) for Phase 1 so the SR â†’ validator path is implementable.
4. **SR session type** â€” Backend: new session type (e.g. `mode: "symbolic_regression"`) with config (feature_source, target, feature_set), and â€œgenomeâ€ = list of formula candidates + metrics. Research API and persistence already support session payload; extend with SR shape.

### Easiest first path (recommended)

Start with **indicator + OHLCV** â€” no structural families, no research_v1 pipeline:

* **Data:** One symbol (e.g. SPY), one timeframe (e.g. 1d). Load bars (you already have OHLCV + ATR via existing data/indicators).
* **Features (X):** Per bar: 2â€“3 simple numeric series â€” e.g. RSI(14), ATR(14) normalized by price (or ATR fraction), and maybe a short momentum (e.g. 5-bar return or close vs SMA). All computable from bars with existing or minimal code.
* **Target (y):** Forward N-bar return (e.g. 5-bar) or ATR-normalized forward return. One pass over bars: at each bar, features = current RSI, ATR_norm, momentum; target = future return from close to close (or in ATR units).
* **Pipeline:** Load bars â†’ compute indicator columns â†’ build X (one row per bar, no NaNs), y (aligned, drop last N rows) â†’ gplearn â†’ formula(s) â†’ validator hook â†’ store.
* **Why easier:** No motif extraction, no family aggregation, no artifact format. Just bars + a few series + one target column. Validator hook and SR engine get proven first; families/strategies can plug in later with the same contract.

### Alternative first slice (later)

* **Family-based** â€” research_v1 motifs + outcomes; X = `feature_vector`, y = e.g. `forward_5_return_atr`. More moving parts (artifacts, family filter).
* **Strategy-based** â€” backtest/scanner output with per-signal context; requires instrumenting the runner to export features at signal time.

### Verdict

You are **ready to start** with the **easiest path** (indicator + OHLCV) and the four items above (gplearn, feature contract, validator hook design, SR session type). Nail the validator hook and the bar-level feature builder first; add structural families (or strategy-based) once SR and validation are working.

**Phase 1 validator hook (recommended):** Treat the formula as a primitive. Build a **strategy**: composite that contains the SR primitive (and optionally other stages) + entry/exit criteria (stop, take profit). Run the **validator on that strategy** (same as any other strategy). So we validate by wrapping the SR primitive in a composite and then in a strategy â€” not by testing the primitive alone or by injecting a raw entry list. Option A (entry list) can still be used as a fast proxy during SR search; for promotion, the formula must pass when used as a primitive inside a full strategy.

---

# ðŸ“‹ PLANNING DOCUMENT

## Phase 1 â€” Foundation (1â€“2 weeks)

### Goal

Get SR producing formulas and passing through validator.

---

### Tasks

#### 1. Feature Matrix Builder

Create module:

```
build_feature_matrix(events_or_bars, config)
```

**First implementation (easiest):** Bar-level indicator + OHLCV.

* **Inputs:** Bars (OHLCV + optional ATR) for one symbol/interval; config = which indicators (e.g. RSI, ATR_norm, momentum), target (e.g. forward_5_return_atr or forward_5_return_pct).
* **Outputs:** X (one row per bar: RSI, ATR_norm, momentum, â€¦), y (forward return), and optional row metadata (bar_index, timestamp) for validator hook.
* No pattern detections or family labels required. Later: overload or extend for family-based (motif + outcome) and strategy-based events.

---

#### 2. Target Generator

Implement:

```
compute_forward_return(n_bars, ATR_normalized=True)
```

---

#### 3. gplearn Integration

Wrap SR engine:

```
run_symbolic_regression(X, y, config)
```

---

#### 4. Validator Hook

For each formula:

```
apply_formula â†’ generate signals â†’ validate
```

---

#### 5. Output Handler

Store:

* formula
* metrics

---

## Phase 2 â€” UI Integration (1 week)

### Add to Research Agent:

New fields:

* Research Mode (SR)
* Target selection
* Feature selection

Display:

* discovered formulas
* performance metrics

---

## Phase 3 â€” Scoring Integration (1â€“2 weeks)

### Use formulas for:

* scanner ranking
* signal filtering

Example:

```
if score > threshold:
    include in scanner results
```

---

## Phase 4 â€” PySR Promotion (later)

### Replace or augment gplearn:

* better formulas
* custom loss aligned with validator

---

## Phase 5 â€” Family-Specific SR (advanced)

Run SR:

* per family

Example:

```
SR on failed breakout family only
```

This increases signal quality dramatically.

---

# ðŸ§  SYSTEM ARCHITECTURE

```
Feature sources (pick one or combine):
  â€¢ Pattern Detector â†’ Family Classifier  (motif/family features)
  â€¢ Indicator system                       (indicator outputs at signal time)
  â€¢ Strategy / scan output                  (composite stages, entry context)
      â†“
Feature Extraction  â†’  X (matrix), y (target)
      â†“
Symbolic Regression  â†’  candidate formulas
      â†“
Validator
      â†“
Registry
      â†“
Scanner / Strategy Engine  (ranking, filtering, enhancement)
```

---

# ðŸ”‘ KEY RULES (DO NOT BREAK)

1. SR never bypasses validator
2. SR proposes â€” validator decides
3. No lookahead features
4. Prefer simple formulas
5. Always test out-of-sample

---

# ðŸš€ FIRST EXPERIMENTS (EXAMPLES)

SR can be run in different contexts. Examples:

### A. Family-based (e.g. structural motifs)

* **Dataset:** Head & Shoulders (or a v2 family from research_v1)
* **Features:** neckline slope, shoulder relation, break strength, retrace depth, momentum decay (or motif features: retrace_profile, break_profile, etc.)
* **Target:** 3-bar ATR return
* **Goal:** Can SR separate good vs bad instances of this family?

### B. Indicator-based

* **Dataset:** Scanner or backtest runs where an indicator (e.g. RSI, regime, composite) fired
* **Features:** indicator values at signal time, ATR, momentum, symbol/regime
* **Target:** forward return or hit 1R first
* **Goal:** Can SR score which indicator readings lead to better outcomes?

### C. Strategy-based

* **Dataset:** Strategy signals (e.g. composite entries) with context
* **Features:** stage outputs, entry context, volatility, regime
* **Target:** expectancy or win propensity
* **Goal:** Can SR rank strategy signals by quality?

---

# FINAL SUMMARY

You are adding:

> **A formula discovery engine that learns how to score setups**

Applicable to:

* **structural families** (motif instances),
* **indicators** (readings at signal time),
* **strategies** (signals + context).

Not replacing:

* pattern detection
* family classification
* indicator system
* validator

But enhancing them â€” SR proposes scores; validator (and optional downstream use) decides.

---

If you want next step, I can generate:

* exact feature schema (JSON)
* database tables
* API endpoints
* or plug directly into your current Research Agent code flow
