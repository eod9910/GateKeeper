# Research → Optimization → Live Trading Pipeline
**Created:** 2026-02-19  
**Status:** PLANNING  
**Prerequisite:** Tier-1 backtest working end-to-end ✅, Research Agent generating real results ✅

---

## Vision

A fully autonomous pipeline:

```
Research Agent          Parameter Sweep         Validation Gate
(architecture search) → (config optimization) → (Tier 2 full test)
        ↓                                               ↓
   Genome DB                                    Approved Strategies
                                                        ↓
                                               Live Trading Bot
                                               (Alpaca paper → real)
```

The system discovers strategies, finds their optimal parameters, stress-tests survivors, and trades the ones that pass — without manual intervention.

---

## Phase 1 — Parameter Sweep (NEXT)

**What:** Run N backtests in parallel, varying a single parameter, and return a ranked comparison table.

**Why first:** Required before any strategy goes live. Stops, position sizing, and entry thresholds all need evidence-based values, not industry dogma.

### 1A — Backend: Sweep Engine

**New endpoint:** `POST /api/validator/sweep`

**Request:**
```json
{
  "strategy_version_id": "rdp_fib_pullback_rsi_entry_composite_v1",
  "sweep_params": [
    {
      "label": "Stop Type",
      "param_path": "risk_config.stop_type",
      "values": ["percentage", "atr", "swing_low"]
    },
    {
      "label": "ATR Multiplier",
      "param_path": "risk_config.atr_multiplier",
      "values": [1.0, 1.5, 2.0, 2.5]
    }
  ],
  "tier": "tier1",
  "interval": "1wk"
}
```

**Behavior:**
- Generate N strategy variants (one per value, or cartesian product for multi-param)
- Register each as a temp strategy version (prefix `sweep_`)
- Dispatch jobs sequentially respecting `MAX_CONCURRENT_RUNS`
- Stream results as NDJSON as each job completes
- Aggregate into sweep report when all done
- Clean up temp strategy versions

**New file:** `backend/src/routes/sweep.ts`  
**New file:** `backend/src/services/sweepEngine.ts`

### 1B — Sweep Result Schema

```typescript
interface SweepResult {
  sweep_id: string;
  strategy_version_id: string;
  param_label: string;
  variants: SweepVariant[];
  winner: SweepVariant;
  created_at: string;
}

interface SweepVariant {
  param_value: any;
  param_path: string;
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  report_id?: string;
  metrics?: {
    total_trades: number;
    expectancy_R: number;
    win_rate: number;
    profit_factor: number;
    max_drawdown_pct: number;
    sharpe_ratio: number;
    fitness_score: number;
  };
}
```

### 1C — Frontend: Sweep UI in Validator

**New tab in Validator:** "Parameter Sweep"

**Layout:**
- Strategy selector (same as run tab)
- Parameter builder: dropdown (common params) or manual dot-path + value list
- Quick presets:
  - "Stop Type Comparison" — percentage vs ATR vs swing_low
  - "ATR Multiplier Range" — 1.0, 1.5, 2.0, 2.5, 3.0
  - "Take Profit R Range" — 1.5, 2.0, 2.5, 3.0
  - "Risk % Range" — 0.5%, 1%, 1.5%, 2%, 3%
  - "RSI Level Range" — 20, 25, 30, 35, 40
- Run Sweep button → progress bar per variant
- Results: ranked comparison table, winner highlighted
- "Promote Winner" button → saves winning config as new strategy version

**New file:** `frontend/public/sweep.html`  
**New file:** `frontend/public/sweep.js`

### 1D — Common Parameter Paths (presets)

| Label | Path | Typical Range |
|-------|------|---------------|
| Stop Type | `risk_config.stop_type` | `["percentage", "atr", "swing_low"]` |
| Stop % | `risk_config.stop_value` | `[0.03, 0.05, 0.08, 0.10, 0.15]` |
| ATR Multiplier | `risk_config.atr_multiplier` | `[0.75, 1.0, 1.5, 2.0, 2.5, 3.0]` |
| Take Profit R | `risk_config.take_profit_R` | `[1.5, 2.0, 2.5, 3.0, 4.0]` |
| Max Hold Bars | `risk_config.max_hold_bars` | `[13, 26, 39, 52]` |
| RSI Oversold | `setup_config.composite_spec.stages.?.params.oversold_level` | `[20, 25, 30, 35, 40]` |
| Risk % | `risk_config.risk_pct_per_trade` | `[0.005, 0.01, 0.015, 0.02, 0.03]` |

---

## Phase 2 — Capital Allocation & Position Sizing Research

**What:** Monte Carlo simulation with varying risk-per-trade percentages to find the psychologically and mathematically optimal allocation for each strategy.

**Why:** The "1-3% rule" is industry dogma. The actual optimal number depends on:
- Trade frequency (more trades = can use lower % and still compound)
- Win rate and expectancy distribution
- Longest expected losing streak
- Your personal drawdown pain threshold

### 2A — Risk % Monte Carlo

Extend the existing Monte Carlo (already in `validatorPipeline.py`) to also simulate different risk percentages:

For each risk_pct in [0.5%, 1%, 1.5%, 2%, 3%]:
- Run 1000 Monte Carlo paths
- Record: final equity, max drawdown, recovery time, p95/p99 outcomes

**Output table:**

| Risk % | Median Return | p95 Max DD | p99 Max DD | Avg Recovery | Recommended |
|--------|--------------|------------|------------|--------------|-------------|
| 0.5% | +18% | 9% | 14% | 3 weeks | Conservative |
| 1.0% | +38% | 17% | 26% | 5 weeks | Balanced ✓ |
| 2.0% | +89% | 31% | 47% | 11 weeks | Aggressive |
| 3.0% | +142% | 44% | 68% | 22 weeks | High risk |

**Key insight surfaced:** The number where p99 drawdown stays inside your personal pain threshold. Not the "optimal" number — the *sustainable* number.

### 2B — UI: Risk Profile Selector

In the sweep results / strategy detail view:
- "What's the max drawdown you can hold through?" → slider (5% → 50%)
- System highlights the risk % row where p99 DD stays below that threshold
- "Your recommended risk per trade for this strategy: **1.0%**"

---

## Phase 3 — Autonomous Trading Bot

### 3A — Broker Integration: Alpaca

**Why Alpaca:**
- REST API (not socket-based like IBKR)
- Paper trading identical to live API (same code, different credentials)
- Commission-free stocks, fractional shares
- Webhooks for fills

**New service:** `backend/services/brokerService.py` (or TypeScript client)

**Endpoints needed:**
- `GET /account` — buying power, equity
- `POST /orders` — submit market/limit order
- `GET /positions` — open positions
- `DELETE /positions/:symbol` — close position
- `GET /orders/:id` — order status

**New file:** `backend/src/services/alpacaClient.ts`

### 3B — Bot Engine

**New file:** `backend/src/services/tradingBot.ts`

**Core loop (runs on schedule or on scanner signal):**

```
1. Check market hours (is market open?)
2. Check daily loss limit (stop if hit)
3. Check open positions (don't double-enter)
4. Check max concurrent positions (e.g. max 5)
5. Receive signal from scanner (strategy X, symbol Y, direction)
6. Look up strategy spec → get stop_type, stop_value, take_profit_R
7. Calculate position size (risk_pct × account equity ÷ stop_distance)
8. Submit order → record in Trading Desk
9. Monitor: check stop/target every bar close
10. Auto-close on stop, target, or max_hold_bars hit
```

### 3C — Risk Controls (non-negotiable)

| Control | Value (configurable) |
|---------|---------------------|
| Max risk per trade | 1% of equity |
| Max concurrent positions | 5 |
| Daily loss limit | 3% of equity (stops bot for the day) |
| Max position size | 10% of equity in one stock |
| Only trade approved strategies | PASS + APPROVED status required |
| Paper mode by default | `ALPACA_PAPER=true` until explicitly disabled |

### 3D — Bot UI

**New page:** `frontend/public/bot.html`

- Bot status (running / stopped / paused)
- Today's P&L, open positions, daily loss used
- Trade log (what it entered, why, current status)
- Emergency stop button
- Toggle paper / live (with confirmation modal)
- Per-strategy enable/disable (approved strategies only)

### 3E — Paper → Live Gate

**Paper trading period:** minimum 4 weeks, minimum 20 trades  
**Promotion criteria:**
- Live execution expectancy within 20% of backtest expectancy
- No runaway losses (daily limit never hit more than 3× in paper period)
- Manual review and explicit approval click

---

## Phase 4 — Full Autonomous Pipeline

When all phases are complete, the system operates like this:

```
Every night:
  Research Agent runs 5 generations
  Discards → logged to genome
  Discarded → gen N+1 learns from failure

When a strategy passes Tier 1:
  Parameter sweep runs automatically
  Best stop config + risk % identified
  Winner queued for Tier 2 validation

When Tier 2 passes:
  Human reviews report (5 min)
  Clicks "Approve for bot"
  Bot begins paper trading the strategy

After 4 weeks paper:
  Human reviews paper results
  Clicks "Go live" (or keeps in paper)
  Bot trades real money

Ongoing:
  Scanner fires signals → bot executes
  Trading Desk tracks all positions
  Monte Carlo re-runs quarterly with new data
  Underperforming strategies automatically flagged
```

---

## Implementation Order

| # | Feature | Effort | Value |
|---|---------|--------|-------|
| 1 | Parameter Sweep (backend + UI) | Medium | Critical |
| 2 | Risk % Monte Carlo table | Small | High |
| 3 | Alpaca client (paper mode) | Small | High |
| 4 | Bot engine core loop | Medium | Critical |
| 5 | Bot UI + risk controls | Medium | High |
| 6 | Auto-sweep after Tier 1 pass | Small | High |
| 7 | Paper → live gate | Small | Critical (safety) |
| 8 | Full autonomous nightly loop | Medium | Game-changer |

---

## Key Decisions Still Open

- **Alpaca vs IBKR:** Alpaca for now (simpler), IBKR later for options/futures
- **Sweep: sequential vs parallel:** Sequential respects job queue limits; parallel would need separate worker pool
- **Cartesian product sweeps:** Testing all combinations of multiple params explodes combinatorially — need a cap (max 20 variants per sweep)
- **Strategy retirement:** When does a live strategy get pulled? (e.g. 3-month rolling expectancy drops below 0)
- **Position sizing method:** Fixed fractional (% of equity) vs Kelly Criterion vs fixed dollar — sweep this too

---

## Files To Create

```
backend/src/routes/sweep.ts              — sweep API endpoints
backend/src/services/sweepEngine.ts     — sweep orchestration
backend/src/services/alpacaClient.ts    — Alpaca REST client
backend/src/services/tradingBot.ts      — bot core loop
backend/src/routes/bot.ts               — bot API endpoints
frontend/public/sweep.html              — parameter sweep UI
frontend/public/sweep.js                — sweep frontend logic
frontend/public/bot.html                — bot dashboard
frontend/public/bot.js                  — bot frontend logic
backend/data/sweep-results/             — persisted sweep reports
backend/data/bot-config.json            — bot settings (paper/live, limits)
```
