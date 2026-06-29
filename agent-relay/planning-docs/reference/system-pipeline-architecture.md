# System Pipeline Architecture — Conceptual Document

> This document defines the complete pipeline from idea to execution. Every page in the application has one job. Data flows in one direction. Feedback loops close the circle.

---

## The Pipeline

```
 ┌─────────────────┐
 │ INDICATOR STUDIO │   "Does it detect anything?"
 │ (Workshop)       │
 │                  │   Two jobs:
 │  1. Build        │   ── Create indicators (AI writes Python code)
 │     Indicators   │   ── MA crossover, RSI divergence, MACD, custom
 │                  │
 │  2. Refine       │   ── Visual chart for pattern inspection
 │     Patterns     │   ── Human labels: real pattern vs noise
 │                  │   ── ML corrections improve detection
 │                  │   ── Once reliable → indicator in Library
 │                  │
 │  ★ A pattern IS  │
 │    an indicator  │
 └────────┬────────┘
          │  Working indicator
          ▼
 ┌─────────────────┐
 │ INDICATOR        │   Registry of all detection plugins
 │ LIBRARY          │   ── wyckoff_accumulation
 │                  │   ── ma_crossover
 │                  │   ── rsi_divergence
 │                  │   ── head_and_shoulders
 │                  │   ── (any future detection)
 └────────┬────────┘
          │  Pick an indicator
          ▼
 ┌─────────────────┐
 │ VALIDATOR        │   "Does it make money?"
 │                  │
 │  1. Wrap in      │   ── Position sizing (mathematical)
 │     strategy     │   ── Risk management (stop, account %)
 │                  │   ── Exit rules (configurable)
 │                  │   ── Execution policy (harvest rules)
 │                  │
 │  2. Backtest     │   ── Test by REGIME:
 │     by regime    │      Impulse / Expansion / Distribution /
 │                  │      Consolidation
 │                  │   ── Where does it work?
 │                  │   ── Where does it FAIL?
 │                  │   ── How efficient is it per regime?
 │                  │
 │  3. Verdict      │   ── PASS or FAIL
 │                  │   ── No chart needed — all numbers
 │                  │
 │  Output:         │   ── Validated strategy
 │                  │      (indicator + strategy wrapper)
 └────────┬────────┘
          │  Validated strategy (PASS)
          ▼
 ┌─────────────────┐
 │ SCANNER          │   "Where are signals right now?"
 │ (Production)     │
 │                  │   ── Loads validated strategy
 │                  │   ── Scans market universe
 │                  │   ── Returns ranked candidates
 │                  │   ── NO corrections, NO labels, NO ML
 │                  │   ── Pure production tool
 │                  │
 │  Output:         │   ── Ranked candidates with scores
 └────────┬────────┘
          │  Candidate + strategy
          ▼
 ┌─────────────────┐
 │ TRADING DESK     │   "Execute with these rules"
 │                  │
 │  Receives:       │   ── Candidate (instrument + signal)
 │                  │   ── Strategy (all rules already defined)
 │                  │
 │  Shows:          │   ── Stop loss price
 │                  │   ── Position size
 │                  │   ── Execution ladder
 │                  │   ── Next action triggers
 │                  │
 │  Enforces:       │   ── No manual override in production
 │                  │   ── Automatic BE/ladder/exits
 │                  │   ── Daily profit cap
 └────────┬────────┘
          │  Closed position
          ▼
 ┌─────────────────┐
 │ POST-TRADE       │   "What happened and why?"
 │ REVIEW           │
 │                  │   ── Did you follow the rules?
 │                  │   ── Strategy performance vs backtest
 │                  │   ── Behavioral drift analysis
 │                  │   ── Operator reliability score
 │                  │
 │  Output:         │   ── Performance report
 │                  │   ── Feedback signals
 └────────┬────────┘
          │
          ▼  FEEDBACK LOOPS
          │
          ├──▶ Indicator Studio   (detection needs refinement)
          ├──▶ Validator          (strategy params need adjustment)
          └──▶ Scanner            (universe needs updating)
```

---

## What Each Page Does (and Doesn't Do)

| Page | Does | Does NOT |
|------|------|----------|
| **Indicator Studio** | Build indicators, refine patterns, chart visualization, ML corrections, labeling | Execute trades, backtest strategies, scan markets |
| **Validator** | Wrap indicator in strategy, backtest by regime, PASS/FAIL verdict | Build indicators, execute trades, scan markets |
| **Scanner** | Scan market with validated strategies, rank candidates | Build indicators, backtest, label patterns, execute trades |
| **Trading Desk** | Execute trades, enforce rules, show positions | Build indicators, backtest, scan markets |
| **Post-Trade** | Audit performance, analyze behavior, generate feedback | Build indicators, execute trades |

---

## Key Principles

### 1. A Pattern IS an Indicator
Once a Wyckoff accumulation detector reliably finds patterns, it's no different from an MA crossover. Both are functions that take OHLCV data and return signals. They live in the same library. The Validator treats them the same way.

### 2. Strategy = Indicator + Wrapper
An indicator on its own is not tradeable. It becomes tradeable when wrapped in a strategy that defines:
- Position sizing (mathematical — account size, risk %, stop distance)
- Risk management (max risk per trade, max daily risk)
- Exit rules (targets, trailing stops, time stops)
- Execution policy (BE rules, profit lock ladder, harvest rules)

The wrapping is NOT discretionary. Most of it is mathematical:
- **Discretionary**: indicator selection, exit strategy experimentation
- **Mathematical**: position sizing, risk allocation
- **Boilerplate**: cost config, execution rules, universe

### 3. The Scanner is a Production Tool
The Scanner page has ONE job: find today's candidates. It does not:
- Help you build better indicators (that's the Studio)
- Test whether strategies work (that's the Validator)
- Let you label or correct detections (that's the Studio)

The Scanner only runs validated strategies (status: approved, passing validation report).

### 4. The Trading Desk Receives a Complete Package
The Trading Desk gets a candidate + strategy. The strategy contains everything:
- Entry rules (from the indicator)
- Stop loss (from risk config)
- Position size (from account size + risk %)
- Exit rules (from exit config)
- Execution ladder (from execution config)

The trader's only decision is: **do I take this trade or not?** Everything else is predetermined.

### 5. Feedback Loops Close the Circle
Post-trade review isn't just for journaling. It generates actionable signals:
- "This strategy underperforms in consolidation" → Validator (adjust regime filters)
- "Detection misses patterns with X characteristic" → Studio (refine indicator)
- "Scanner returns too many false positives on Y symbols" → Scanner (update universe)

---

## Data Flow Between Pages

```
Indicator Studio
  → writes to: Indicator Library (backend/data/patterns/)
  → reads from: OHLCV data, existing indicators

Validator
  → reads from: Indicator Library
  → writes to: Strategy files (backend/data/strategies/)
  → writes to: Validation reports (backend/data/validation-reports/)

Scanner
  → reads from: Validated strategies (status: approved)
  → reads from: Market data (live)
  → writes to: Candidate results

Trading Desk
  → reads from: Candidates (from Scanner)
  → reads from: Strategy (from Validator)
  → writes to: Trade records (backend/data/trades/)

Post-Trade Review
  → reads from: Trade records
  → reads from: Strategy (for comparison)
  → writes to: Audit reports, feedback signals
```

---

## AI Roles by Page

| Page | AI Role | Personality |
|------|---------|-------------|
| Indicator Studio | **Plugin Engineer** | Technical, writes code, explains detection logic |
| Indicator Studio (patterns) | **Pattern Analyst** | Visual, identifies pattern features, guides labeling |
| Validator | **Statistical Interpreter** | Data-driven, cites metrics, flags fragility |
| Scanner | **Contextual Ranker** | Brief, ranks by conviction, explains signal strength |
| Trading Desk | **Compliance Officer** | Strict, GO/NO-GO, validates sizing and rules |
| Post-Trade | **Forensic Auditor** | Analytical, finds deviations, behavioral drift |

---

## What Needs to Change (Current → Target)

### Scanner Page (index.html)
**Current**: Mixes production scanning with R&D tools (corrections, labels, ML, multiple scan modes including legacy ones)
**Target**: Pure production scanner — pick a validated strategy, scan universe, get candidates

### Indicator Studio (workshop.html)
**Current**: Only has code editor + AI chat (from the Workshop plan)
**Target**: Three tabs:
1. **Code Editor** — AI writes Python plugins (existing Workshop plan)
2. **Pattern Scanner** — Chart + corrections + labels + ML feedback (moved FROM Scanner page)
3. **Library Browser** — View all indicators in the registry

### Strategy Page (strategy.html)
**Current**: Strategy editor + co-pilot chat
**Target**: No major changes — this is where strategies are authored/edited. The Validator does the testing.

### Validator Page (validator.html)
**Current**: Basic validation with mock data
**Target**: Regime-aware backtesting, strategy wrapping, PASS/FAIL with regime breakdown

### Trading Desk (history.html)
**Current**: Trade management + execution ladder
**Target**: Receives candidate + strategy from Scanner. Minor changes to wire up the candidate→trade flow.
