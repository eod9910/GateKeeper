# Research Prompt: Statistical Validation of Chart Pattern Detection via AI-Assisted Labeling

## The Problem

We have a trading platform ("Pattern Detector") that detects chart patterns programmatically using RDP (Ramer-Douglas-Peucker) swing point detection and geometric template matching. The system finds swing highs/lows, builds a swing structure, then matches formations (head & shoulders, Wyckoff accumulation, Quasimodo, double bottom, etc.) against geometric rules.

**The core question we want to answer: Do chart patterns have statistically significant predictive power?**

Nobody has good data on this because:
- Academic studies use rigid geometric definitions that miss most real patterns. Results: inconclusive.
- Retail traders use subjective "I see it when I see it." Not reproducible, can't study it.
- Quant firms don't publish their research.

Our platform can scan hundreds of stocks over decades, detect every occurrence of a pattern, and measure what happened next (did price hit the target? did the pattern fail?). But our pattern detection quality is the bottleneck — if we detect 1000 head & shoulders but 400 are false positives, our statistical study is polluted.

**We need to dramatically improve detection quality to make the study valid.**

## What We Have Today

### Detection Pipeline (Current)
1. **OHLCV data** — fetched via yfinance, cached locally
2. **RDP swing detection** — Ramer-Douglas-Peucker algorithm reduces price bars to significant swing points (highs and lows). Tunable epsilon controls sensitivity. The RDP Energy Swing Detector is our best variant — confirmed by manual review to hit highs and lows almost exactly right.
3. **Swing structure** — builds a data structure of peaks, lows, trend classification (uptrend/downtrend based on HH/HL or LH/LL), regime windows, and status (pullback/extension).
4. **Pattern template matching** — geometric rules check if swing points form known formations (e.g., left shoulder height vs head height vs right shoulder height ratios for H&S).
5. **Backtest engine** — enters trades on pattern completion, applies stop loss and take profit, measures R-multiples, computes expectancy/profit factor/win rate across hundreds of symbols.
6. **Validator pipeline** — runs backtests across tiered universes (50/100/190 stocks) with walk-forward analysis, Monte Carlo simulation, and out-of-sample testing.

### Existing AI Capabilities
- GPT-4o vision integration — the app already renders charts and sends them to GPT-4o for copilot analysis
- Chart rendering to canvas — any chart segment can be captured as an image
- Plugin system — new indicators/detectors can be added as Python files with JSON configs
- 30+ registered primitives across categories (chart patterns, indicator signals, price action)

### Existing Labeling System
- Human-in-the-loop labeling queue — scanner finds candidates, human labels them good/bad
- This is extremely slow — a human can label maybe 50-100 patterns per hour
- We've labeled ~200 patterns over several weeks. Not enough for statistical significance.

## Approach 1: User's Proposal — Synthetic Data + Vision AI + ML

The user proposed:
1. Generate synthetic OHLCV price data with controlled properties
2. Have a vision AI (GPT-4o) scan the synthetic charts and label patterns ("this is a Quasimodo" / "this isn't")
3. Use those labels to train an ML model that can detect patterns programmatically
4. Deploy the trained model on real market data
5. This replaces human-in-the-loop labeling (slow) with AI-in-the-loop labeling (fast)

**Concerns raised with this approach:**
- **Teacher quality**: GPT-4o vision is inconsistent on real charts (~60-70% accuracy on subtle patterns, not 95%). If the teacher is mediocre, the student will be worse.
- **Domain gap**: Synthetic data from statistical models (GBM, GARCH, regime-switching) doesn't contain real market psychology patterns. Wyckoff patterns exist because of supply/demand dynamics with real participants. To embed patterns in synthetic data, you'd need to deliberately construct them — creating a circular training problem.
- **Compounding error**: Each step (generation → labeling → training → deployment) introduces noise. By the end, you're far from the original pattern.

**Where this approach HAS merit:**
- Unlimited training data volume
- No human bottleneck
- Fast iteration cycles
- The concept of "model distillation" (big expensive model → small fast model) is legitimate

## Approach 2: Vision AI as Confirmation Layer (Hybrid Scanner)

1. The existing fast geometric scanner (RDP + swing structure) finds candidate patterns — runs in milliseconds
2. For each candidate, render the chart segment and send it to GPT-4o vision
3. GPT-4o confirms or rejects: "Is this a valid head & shoulders? Confidence: 1-10"
4. Only high-confidence patterns (7+) go to the backtester
5. Over time, the confirmation results are used to tune the geometric scanner's thresholds
6. Eventually, the geometric scanner gets good enough to not need confirmation on most patterns

**Advantages**: Uses real data, leverages existing scanner, builds a feedback loop, addresses the false positive problem directly.
**Disadvantages**: GPT-4o API cost per image (~$0.01-0.03), speed (2-5 seconds per confirmation), still dependent on GPT-4o's pattern recognition quality.

## Approach 3: AI-Labeled Real Data (Not Synthetic)

1. Pull 10+ years of daily data for 500 stocks
2. Run the swing detector to find all candidate formations
3. Send each chart segment to GPT-4o: "Is this a valid [pattern type]? Rate confidence 1-10. Explain why."
4. Use the high-confidence labels as ground truth training data
5. Train a lightweight classifier or refine the geometric rules using these labels

**Advantages**: Real market data, real patterns, no domain gap, labels are reproducible.
**Disadvantages**: Same GPT-4o accuracy concerns, cost of labeling thousands of patterns ($50-200 depending on volume).

## Approach 4: Numeric Feature Classification (No Vision)

Skip vision models entirely. The RDP swing detection already produces structured numeric representations:
- Swing point coordinates (price, time)
- Relative height ratios (left shoulder / head, right shoulder / head)
- Time symmetry (bars between peaks)
- Volume profile across the formation
- Price velocity into/out of the pattern
- Trend context (was the pattern forming in an uptrend or downtrend?)

Feed these features into a classifier (Random Forest, XGBoost, small neural net). Training data comes from the existing human labels + AI-augmented labels.

**Advantages**: Fast inference (microseconds), interpretable features, no API dependency, small model.
**Disadvantages**: Requires enough labeled data to train, may miss visual nuances that aren't captured in the feature set.

## What We Want From This Research

1. **Which approach (or combination) is most likely to produce a working pattern detection system that can answer "do patterns have statistically significant predictive power?"**
2. **Is there a standard methodology in quantitative finance or computer vision for this exact problem?** (programmatic chart pattern detection + statistical validation)
3. **What does the academic literature say?** Are there papers that have attempted this with modern ML/DL techniques? What were their results?
4. **If we go with vision AI confirmation (Approach 2), what's the best way to structure the prompts to GPT-4o for consistent labeling?** (few-shot examples? structured output? separate calls per pattern type?)
5. **If we go with numeric features (Approach 4), what feature engineering is most predictive for chart pattern classification?** What features matter beyond the obvious geometric ones?
6. **Is there a hybrid approach we haven't considered?** For example: use Approach 3 to bootstrap labeled data → use that data for Approach 4 → deploy Approach 4 with Approach 2 as a safety net.
7. **What sample size do we need?** How many labeled patterns per pattern type to get statistically significant results? (We have 500 stocks × 10 years of daily data as our universe.)
8. **What's the right evaluation framework?** Precision, recall, F1 on detection quality? Then separately: expectancy, profit factor, Sharpe on trading outcomes? How do we avoid data snooping / overfitting in the study design?

## Technical Constraints
- Platform is Python (backend) + TypeScript/Node.js (API) + vanilla JS (frontend)
- Already have GPT-4o API integration
- RDP swing detection is fast (Numba JIT compiled, cached)
- Backtest engine runs 50 symbols in ~20 minutes
- Budget for AI API costs: ~$100-500 for the initial study
- No access to proprietary datasets — using yfinance (Yahoo Finance) for historical OHLCV data
- The goal is a production feature in the app, not a one-off research project
