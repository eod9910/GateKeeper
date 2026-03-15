# Pattern Detector — V1 Roadmap & PRD

## Current State (2026-02-22)

**What exists and works:**
- [x] Platform SDK (RDP, swing structure, OHLCV, numba indicators)
- [x] Plugin system (30 registered primitives)
- [x] Composite builder (JSON wiring, AI-assisted)
- [x] Backtest engine (ATR/percentage/structural stops, execution rules, max concurrent positions)
- [x] Validator pipeline (Tier 1/2/3, Monte Carlo, walk-forward, OOS, parameter sensitivity)
- [x] Parameter sweep (presets, custom, tier selector, cancel-and-promote)
- [x] Research agent (autonomous strategy generation, gating, tombstones)
- [x] Scanner (indicator-driven, batch processing, parallel)
- [x] Co-Pilot (charting, AI analysis, position sizing, P&L, 5 instrument types)
- [x] Trade management (planned/open/closed lifecycle)

**Validated Strategy:**
- MACD divergence pullback + regime expansion filter
- 2 ATR stop, 7R take profit, max 3 concurrent positions
- 0.40R expectancy, 29.9% max DD, 1.73 PF — ELITE tier
- RDP epsilon sweep in progress (signal quality tuning)

---

## Priority Order

### Tier 0: Finish Current Work
- [ ] **RDP epsilon sweep** — resolve optimal signal granularity
- [ ] **Fitness function fix** — DD penalty deployed (done in code, needs server restart verification)
- [ ] **Verbose output suppression** — backtest mode in workers deployed (same)

### Tier 1: V1 Ship (Make Money)

#### 1.1 Stabilize & Harden
- [ ] Fix fragile areas (identify via usage)
- [ ] Strategy visibility unification — all pages see same strategy list
- [ ] Editable risk_config UI on Strategy page
- [ ] Clean up sweep-promoted strategy naming/versioning
- [ ] Error handling & recovery for long-running processes
- [ ] Git init + .gitignore (protect secrets, enable version control)

#### 1.2 Execution Bridge (Autonomous Trading)
- [ ] Broker API connection (Alpaca — free API, paper + live)
- [ ] Signal scanner service (runs on schedule — daily/weekly scan of universe)
- [ ] Order executor (places entries, stops, take profits when signals fire)
- [ ] Position manager (enforces max concurrent = 3, tracks open positions across symbols)
- [ ] Kill switch (halt all activity — UI button + account-level drawdown trigger)
- [ ] Paper trading mode (1 month minimum before live)
- [ ] Trade logging (every action recorded with timestamp, strategy ID, signal data)
- [ ] Account split: discretionary (20%) vs systematic (80%)

#### 1.3 Live Monitoring Dashboard
- [ ] Rolling expectancy tracker (last K trades, not cumulative)
- [ ] Live vs backtest performance comparison
- [ ] Open positions view with real-time P&L
- [ ] Alert system (drawdown breach, correlation spike, edge degradation)

#### 1.4 Edge Death Certificate
- [ ] Define explicit metrics that force system to stand down:
  - Rolling expectancy drops below 0.10R over 50 trades
  - Win rate drops below 30% over 50 trades
  - Live max DD exceeds 1.5x backtest max DD
  - 3+ correlated stops in same bar
- [ ] Auto-disable strategy → Quarantine (not Tombstone)
- [ ] No manual override without explicit review

---

### Tier 2: V2 Enhance (Make More Money)

#### 2.1 Structural Exits
- [ ] Replace fixed R-multiple take profit with prior RDP swing high
- [ ] At signal time, look up most recent swing high above entry price
- [ ] R-multiple becomes a result of setup, not an input
- [ ] Expected impact: higher win rate, similar or better expectancy
- [ ] Requires backtest engine modification to receive swing structure alongside signals

#### 2.2 Adaptive Optimizer (Phase 1)
- [ ] Early termination when fitness degrades across sweep variants
- [ ] Gradient-based cutoff (2 consecutive steps down → stop)
- [ ] Step up/down from current value with configurable step size
- [ ] Auto-declare winner and promote
- [ ] Plan: `.planning/plans/adaptive-optimizer-plan.md`

#### 2.3 Adaptive Optimizer (Phase 2)
- [ ] Multi-parameter optimization sessions
- [ ] Sequential sweep orchestration (winner of sweep N feeds sweep N+1)
- [ ] LLM-powered Optimizer Analyst (cheap model — o3-mini)
- [ ] Interaction warnings + suggested confirmation grids

#### 2.4 Adaptive Optimizer (Phase 3)
- [ ] 2D confirmation sweeps (cartesian product of 2 params)
- [ ] Heatmap visualization
- [ ] Validates that optimum is a plateau, not a spike

---

### Tier 3: V3 Scale (Make Money Systematically)

#### 3.1 Evolutionary Strategy Lab (Phase 1)
- [ ] Population Manager — seed, mutate, evaluate, select, breed, archive
- [ ] Mutation-only evolution within RDP divergence family
- [ ] 50 genomes per generation, top 5 parents, 10 children each
- [ ] Tier 1 evaluation for all, Tier 2 for daily champion
- [ ] Tombstones with cause-of-death metadata
- [ ] Lineage graph (who bred whom)
- [ ] Lab dashboard UI
- [ ] Plan: `.planning/plans/evolutionary-strategy-lab.md`

#### 3.2 Evolutionary Strategy Lab (Phase 2-4)
- [ ] Add crossover within family
- [ ] Multiple families (RDP divergence, order blocks, regression channel)
- [ ] Portfolio-level niche competition
- [ ] Cross-family recombination (rare, strict governance)

#### 3.3 Fine-Tune Domain Model
- [ ] Collect training data: tombstones, sweep results, validation reports, lineage
- [ ] Fine-tune smaller model on strategy generation patterns
- [ ] Research agent uses fine-tuned model for informed (not random) hypothesis generation

#### 3.4 Multi-Strategy Portfolio
- [ ] Multiple validated strategies running concurrently
- [ ] Per-strategy position budgets
- [ ] Cross-strategy correlation monitoring
- [ ] Capital allocation by strategy quality tier
- [ ] Rebalancing rules

---

## Non-Functional Requirements

### Security
- [ ] Rotate OpenAI API key
- [ ] .gitignore before git init (protect .env, API keys, data/)
- [ ] Broker API key management (encrypted at rest)

### Reliability
- [ ] Server auto-restart on crash
- [ ] Graceful shutdown (complete in-progress backtests before exit)
- [ ] Data backup strategy (OneDrive sync is not a backup)

### Performance
- [ ] Backtest mode suppresses all verbose output (done)
- [ ] Worker process initialization includes backtest mode (done)
- [ ] Tier 2 sweep completes in < 2 hours for 6 variants

### Observability
- [ ] Structured logging (not print statements)
- [ ] Error tracking with context
- [ ] Performance metrics (backtest time per symbol, sweep time per variant)

---

## Development Velocity

| Metric | Value |
|--------|-------|
| Time to current state | 2 weeks |
| Cost to current state | ~$500 |
| Estimated traditional dev time | 2-3 years (solo) |
| Speed multiplier | ~50x |

## Key Principles

1. **Ship V1 before building V2.** The execution bridge makes money. Everything else makes the system better.
2. **Resolve, don't optimize.** Look for plateaus, not peaks.
3. **Dead strategies are training data.** Tombstones > Champions for learning.
4. **The edge is structural truth over signal speed.** Don't replace RDP with something fashionable.
5. **Default output is failure.** If 99/100 ideas die, the system is healthy.
6. **Detection > prevention.** Build systems that detect failure early, not systems that try to prevent it.
