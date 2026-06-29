# Research â†’ Optimization â†’ Live Trading Pipeline

Checklist: research-to-live-trading-checklist.md
**Created:** 2026-02-19
**Status:** PLANNING
**Prerequisite:** Tier-1 backtest working end-to-end âœ…, Research Agent generating real results âœ…

---

## Vision

A fully autonomous pipeline:

```
Research Agent          Parameter Sweep         Validation Gate
(architecture search) â†’ (config optimization) â†’ (Tier 2 full test)
        â†“                                               â†“
   Genome DB                                    Approved Strategies
                                                        â†“
                                               Live Trading Bot
                                               (Alpaca paper â†’ real)
```

The system discovers strategies, finds their optimal parameters, stress-tests survivors, and trades the ones that pass â€” without manual intervention.

---

## Phase 1 â€” Parameter Sweep (NEXT)

**What:** Run N backtests in parallel, varying a single parameter, and return a ranked comparison table.

**Why first:** Required before any strategy goes live. Stops, position sizing, and entry thresholds all need evidence-based values, not industry dogma.

### 1A â€” Backend: Sweep Engine

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

### 1B â€” Sweep Result Schema

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

### 1C â€” Frontend: Sweep UI in Validator

**New tab in Validator:** "Parameter Sweep"

**Layout:**
- Strategy selector (same as run tab)
- Parameter builder: dropdown (common params) or manual dot-path + value list
- Quick presets:
  - "Stop Type Comparison" â€” percentage vs ATR vs swing_low
  - "ATR Multiplier Range" â€” 1.0, 1.5, 2.0, 2.5, 3.0
  - "Take Profit R Range" â€” 1.5, 2.0, 2.5, 3.0
  - "Risk % Range" â€” 0.5%, 1%, 1.5%, 2%, 3%
  - "RSI Level Range" â€” 20, 25, 30, 35, 40
- Run Sweep button â†’ progress bar per variant
- Results: ranked comparison table, winner highlighted
- "Promote Winner" button â†’ saves winning config as new strategy version

**New file:** `frontend/public/sweep.html`
**New file:** `frontend/public/sweep.js`

### 1D â€” Common Parameter Paths (presets)

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

## Phase 2 â€” Capital Allocation & Position Sizing Research

**What:** Monte Carlo simulation with varying risk-per-trade percentages to find the psychologically and mathematically optimal allocation for each strategy.

**Why:** The "1-3% rule" is industry dogma. The actual optimal number depends on:
- Trade frequency (more trades = can use lower % and still compound)
- Win rate and expectancy distribution
- Longest expected losing streak
- Your personal drawdown pain threshold

### 2A â€” Risk % Monte Carlo

Extend the existing Monte Carlo (already in `validatorPipeline.py`) to also simulate different risk percentages:

For each risk_pct in [0.5%, 1%, 1.5%, 2%, 3%]:
- Run 1000 Monte Carlo paths
- Record: final equity, max drawdown, recovery time, p95/p99 outcomes

**Output table:**

| Risk % | Median Return | p95 Max DD | p99 Max DD | Avg Recovery | Recommended |
|--------|--------------|------------|------------|--------------|-------------|
| 0.5% | +18% | 9% | 14% | 3 weeks | Conservative |
| 1.0% | +38% | 17% | 26% | 5 weeks | Balanced âœ“ |
| 2.0% | +89% | 31% | 47% | 11 weeks | Aggressive |
| 3.0% | +142% | 44% | 68% | 22 weeks | High risk |

**Key insight surfaced:** The number where p99 drawdown stays inside your personal pain threshold. Not the "optimal" number â€” the *sustainable* number.

### 2B â€” UI: Risk Profile Selector

In the sweep results / strategy detail view:
- "What's the max drawdown you can hold through?" â†’ slider (5% â†’ 50%)
- System highlights the risk % row where p99 DD stays below that threshold
- "Your recommended risk per trade for this strategy: **1.0%**"

---

## Phase 3 â€” Autonomous Trading Bot

### 3A â€” Broker Integration: Alpaca

**Why Alpaca:**
- REST API (not socket-based like IBKR)
- Paper trading identical to live API (same code, different credentials)
- Commission-free stocks, fractional shares
- Webhooks for fills

**New service:** `backend/services/brokerService.py` (or TypeScript client)

**Endpoints needed:**
- `GET /account` â€” buying power, equity
- `POST /orders` â€” submit market/limit order
- `GET /positions` â€” open positions
- `DELETE /positions/:symbol` â€” close position
- `GET /orders/:id` â€” order status

**New file:** `backend/src/services/alpacaClient.ts`

### 3B â€” Bot Engine

**New file:** `backend/src/services/tradingBot.ts`

**Core loop (runs on schedule or on scanner signal):**

```
1. Check market hours (is market open?)
2. Check daily loss limit (stop if hit)
3. Check open positions (don't double-enter)
4. Check max concurrent positions (e.g. max 5)
5. Receive signal from scanner (strategy X, symbol Y, direction)
6. Look up strategy spec â†’ get stop_type, stop_value, take_profit_R
7. Calculate position size (risk_pct Ã— account equity Ã· stop_distance)
8. Submit order â†’ record in Trading Desk
9. Monitor: check stop/target every bar close
10. Auto-close on stop, target, or max_hold_bars hit
```

### 3C â€” Risk Controls (non-negotiable)

| Control | Value (configurable) |
|---------|---------------------|
| Max risk per trade | 1% of equity |
| Max concurrent positions | 5 |
| Daily loss limit | 3% of equity (stops bot for the day) |
| Max position size | 10% of equity in one stock |
| Only trade approved strategies | PASS + APPROVED status required |
| Paper mode by default | `ALPACA_PAPER=true` until explicitly disabled |

### 3D â€” Bot UI

**New page:** `frontend/public/bot.html`

- Bot status (running / stopped / paused)
- Today's P&L, open positions, daily loss used
- Trade log (what it entered, why, current status)
- Emergency stop button
- Toggle paper / live (with confirmation modal)
- Per-strategy enable/disable (approved strategies only)

### 3E â€” Paper â†’ Live Gate

**Paper trading period:** minimum 4 weeks, minimum 20 trades
**Promotion criteria:**
- Live execution expectancy within 20% of backtest expectancy
- No runaway losses (daily limit never hit more than 3Ã— in paper period)
- Manual review and explicit approval click

---

## Phase 4 â€” Full Autonomous Pipeline

When all phases are complete, the system operates like this:

```
Every night:
  Research Agent runs 5 generations
  Discards â†’ logged to genome
  Discarded â†’ gen N+1 learns from failure

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
  Scanner fires signals â†’ bot executes
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
| 7 | Paper â†’ live gate | Small | Critical (safety) |
| 8 | Full autonomous nightly loop | Medium | Game-changer |

---

## Key Decisions Still Open

- **Alpaca vs IBKR:** Alpaca for now (simpler), IBKR later for options/futures
- **Sweep: sequential vs parallel:** Sequential respects job queue limits; parallel would need separate worker pool
- **Cartesian product sweeps:** Testing all combinations of multiple params explodes combinatorially â€” need a cap (max 20 variants per sweep)
- **Strategy retirement:** When does a live strategy get pulled? (e.g. 3-month rolling expectancy drops below 0)
- **Position sizing method:** Fixed fractional (% of equity) vs Kelly Criterion vs fixed dollar â€” sweep this too

---

## Files To Create

```
backend/src/routes/sweep.ts              â€” sweep API endpoints
backend/src/services/sweepEngine.ts     â€” sweep orchestration
backend/src/services/alpacaClient.ts    â€” Alpaca REST client
backend/src/services/tradingBot.ts      â€” bot core loop
backend/src/routes/bot.ts               â€” bot API endpoints
frontend/public/sweep.html              â€” parameter sweep UI
frontend/public/sweep.js                â€” sweep frontend logic
frontend/public/bot.html                â€” bot dashboard
frontend/public/bot.js                  â€” bot frontend logic
backend/data/sweep-results/             â€” persisted sweep reports
backend/data/bot-config.json            â€” bot settings (paper/live, limits)
```
