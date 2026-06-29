# Adaptive Strategy Optimizer — Implementation Plan

## Overview

Evolve the Parameter Sweep into a full **Adaptive Strategy Optimizer** that:
1. Runs multi-parameter sweeps with early termination (stops when results degrade)
2. Analyzes all sweep results together to find the global optimum
3. Recommends a final configuration with confidence scores

## Current State

- **Sweep Engine** (`sweepEngine.ts`): runs N backtests varying one parameter, ranks by fitness
- **Presets**: ATR multiplier, take profit R, stop %, max hold bars, RSI oversold
- **Promote Winner**: saves best variant as new strategy version
- **Fitness Score**: weighted blend of expectancy (40%), win rate (20%), Sharpe (20%), OOS robustness (20%)

## Phase 1: Adaptive Single-Parameter Sweep (Early Termination)

**Goal**: Instead of testing all preset values, start from current default, step up/down, stop when fitness degrades for 2 consecutive steps.

### Changes

#### Backend: `sweepEngine.ts`

New function: `runAdaptiveSweep()`

```
Algorithm:
1. Load base strategy, get current value for the param
2. Define step size (configurable, e.g., ATR: 0.25, TP: 0.5R)
3. Test current value first (baseline)
4. Step UP: test current + step, current + 2*step, ...
   - If fitness drops for 2 consecutive steps, stop going up
5. Step DOWN: test current - step, current - 2*step, ...
   - If fitness drops for 2 consecutive steps, stop going down
6. Peak = highest fitness seen across all tested values
7. Optional: refine around peak with half-step (e.g., if peak is 2.0, test 1.75 and 2.25)
```

#### Backend: `routes/sweep.ts`

New route: `POST /sweep/adaptive-run`

```json
{
  "strategy_version_id": "...",
  "param": "risk_config.atr_multiplier",
  "step_size": 0.25,
  "min_value": 0.5,
  "max_value": 5.0,
  "degradation_patience": 2,
  "refine": true
}
```

#### Frontend: `sweep.js` / `sweep.html`

- New toggle: "Fixed Values" vs "Adaptive" mode
- Adaptive mode shows: step size, min/max bounds, patience
- Results render the same table but with a note showing which direction was explored and where it stopped

### Preset Step Sizes

| Parameter | Step Size | Min | Max |
|-----------|-----------|-----|-----|
| ATR Multiplier | 0.25 | 0.5 | 5.0 |
| Take Profit R | 0.5 | 0.5 | 8.0 |
| Stop % | 0.02 | 0.02 | 0.20 |
| Max Hold Bars | 5 | 5 | 80 |

---

## Phase 2: Multi-Parameter Optimization Pipeline

**Goal**: Run multiple parameter optimizations sequentially, then analyze the combined results to find the global optimum.

### Concept: Optimization Session

An **Optimization Session** groups multiple sweeps together:

```
OptimizationSession {
  session_id: string
  strategy_version_id: string
  parameters: [
    { param_path: "risk_config.atr_multiplier", mode: "adaptive" | "fixed" },
    { param_path: "risk_config.take_profit_R", mode: "adaptive" | "fixed" },
    { param_path: "risk_config.max_hold_bars", mode: "adaptive" | "fixed" },
  ]
  sweeps: SweepReport[]          // completed sweeps
  recommended_config: {}          // AI-generated recommendation
  status: "running" | "analyzing" | "completed"
}
```

### Workflow

1. User selects a strategy and checks which parameters to optimize
2. System runs adaptive sweeps sequentially (or user selects order)
3. After each sweep, the winner's value is applied to subsequent sweeps
4. After all sweeps complete, the **Optimizer Analyst** runs

### Optimizer Analyst (AI-powered)

After all sweeps finish, call an LLM with:

**Input**:
- All sweep results (parameter, values tested, fitness scores)
- The base strategy spec
- Fitness score formula for context

**Output**:
- Recommended final configuration
- Confidence level per parameter (high/medium/low)
- Interaction warnings ("ATR and TP were optimized independently — consider a confirmation grid")
- Optional: suggest 2D confirmation sweep for interacting parameters

### Backend

New file: `optimizerService.ts`

```typescript
interface OptimizationSession {
  session_id: string;
  strategy_version_id: string;
  parameters: OptParam[];
  sweeps: string[];                    // sweep IDs in order
  status: 'queued' | 'running' | 'analyzing' | 'completed';
  recommendation: OptRecommendation | null;
}

interface OptRecommendation {
  config: Record<string, any>;         // recommended risk_config values
  fitness_estimate: number;
  confidence: Record<string, string>;  // per-param confidence
  warnings: string[];
  suggested_confirmations: string[];
}
```

New routes: `routes/optimizer.ts`
- `POST /optimizer/run` — start optimization session
- `GET /optimizer/:sessionId` — get status + results
- `POST /optimizer/:sessionId/apply` — apply recommendation to strategy

### Frontend

New page or tab within sweep: **"Optimizer"**
- Select strategy
- Check parameters to optimize (with preset step sizes)
- Click "Optimize"
- Shows progress: "Sweeping ATR Multiplier (1/3)... Sweeping Take Profit (2/3)..."
- Final view: recommendation card with config diff and "Apply" button

---

## Phase 3: 2D Confirmation Sweep

**Goal**: Test parameter interactions by sweeping two parameters simultaneously in a small grid.

### When to trigger
- Optimizer Analyst flags potential interaction
- User manually requests it

### Implementation

Extend `runSweep()` to accept 2 `SweepParamDef` entries and generate a cartesian product:

```
ATR: [1.5, 2.0, 2.5] × TP: [2.0, 2.5, 3.0] = 9 variants
```

### Results Display

2D heatmap table:
```
         TP 2.0    TP 2.5    TP 3.0
ATR 1.5  0.42      0.48      0.45
ATR 2.0  0.50      0.534     0.51
ATR 2.5  0.47      0.49      0.46
```

Highlight the peak cell. This confirms or corrects the sequential optimization result.

---

## Implementation Order

1. **Phase 1** — Adaptive single-param sweep with early termination (~1 day)
   - Core algorithm in `sweepEngine.ts`
   - Route + frontend toggle
   - Test with ATR multiplier sweep

2. **Phase 2** — Multi-param optimization sessions (~2 days)
   - `optimizerService.ts` with session management
   - Sequential sweep orchestration
   - LLM-powered Optimizer Analyst
   - Frontend optimizer page

3. **Phase 3** — 2D confirmation sweeps (~1 day)
   - Cartesian product variant generation
   - Heatmap rendering in frontend
   - Integration with Optimizer Analyst warnings

## Dependencies

- Existing sweep engine (done)
- Existing fitness score function (done)
- OpenAI API access for Optimizer Analyst (already configured for research agent)
- No Python changes needed — all orchestration is in TypeScript

## Risk: Overfitting

The more parameters we optimize, the higher the overfitting risk. Mitigations:
- Fitness score includes OOS robustness (20% weight)
- Walk-forward validation in the final Tier 1/2 run catches overfit configs
- Optimizer Analyst explicitly warns about overfitting risk when many parameters are tuned
- 2D confirmation sweep validates that the optimum is a real peak, not noise
- Minimum trade count (200) prevents small-sample flukes
