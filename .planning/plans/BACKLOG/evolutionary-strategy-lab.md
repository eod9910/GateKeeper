# Evolutionary Strategy Lab — Implementation Plan

## Origin

This plan originates from a ChatGPT conversation (2026-02-21) exploring how to build a Darwinian evolutionary system for trading strategies. Full transcript: `memory-bank/transcripts/genetic evolution.md`

## Vision

A self-running research organism that searches, discards, refines, and eventually teaches itself — without human intervention. Strategies are treated as organisms: profits are food, the validator is the environment, and only the fittest survive to breed.

## Current State (What We Already Have)

| Component | Status | Role in Lab |
|-----------|--------|-------------|
| StrategySpec JSON | Built | Genome representation |
| Primitive Registry (30 plugins) | Built | Gene catalog |
| Composite Builder | Built | Genome assembly |
| Validator (Tier 1/2/3) | Built | Environment / selection pressure |
| Parameter Sweep | Built | Single-param mutation testing |
| Research Agent | Built | Random hypothesis generator (predecessor) |
| Tombstone System | Built | Death records + training data |
| Fitness Score | Built | Selection criterion (now with DD penalty) |
| Max Concurrent Positions | Built | Portfolio-level constraint |

## Architecture

### Genome = StrategySpec JSON

The genetic code of a strategy is its typed JSON spec:

- **Stages** (primitives): which tools it uses (MACD divergence, regime filter, order blocks, etc.)
- **Reducer graph**: AND/OR + nested logic
- **Parameters**: epsilon, ATR stop, take profit, max hold, etc.
- **Risk config**: max concurrent positions, risk per trade, stop type

Critical: genomes are JSON, not arbitrary code. This makes mutation safe and bounded.

### Ecosystem = Validator + Robustness Tests + Portfolio Constraints

The environment is already implemented:

- Tier 1/2/3 validation with hard gates
- Monte Carlo, walk-forward, OOS, parameter sensitivity
- Cost/slippage modeling
- Max concurrent positions filtering

### Food = Risk-Adjusted Return Under Adversity

NOT raw profit. Fitness includes:

- Expectancy (primary)
- Monte Carlo p95 drawdown (hard penalty — already implemented)
- OOS degradation (hard penalty)
- Walk-forward consistency (reward)
- Trade count minimum (hard gate)
- Stability under small parameter jitter (reward)

---

## Phase 0: Hand-Seeded Baseline

**Already done.** We have at least one validated champion:

- **RDP MACD Divergence Pullback + Regime Expansion Filter**
- Params: 2 ATR stop, 7R take profit, max 3 concurrent positions
- Tier 2 validated: 0.40R expectancy, 29.9% max DD, 1.73 PF
- Quality tier: ELITE

This is the founding organism. All evolution in Phase 1 starts from this genome.

---

## Phase 1: Mutation-Only Evolution (Single Family)

**Scope**: RDP-anchored divergence strategies only
**Goal**: Prove the evolution machinery works before expanding

### Population Manager (`populationManager.ts`)

New service with 6 core functions:

```
1. seedPopulation(familyId, baseGenome, n)
   - Create n variants from baseline via small mutations
   - Store as Population with generation counter

2. mutate(genome) → genome
   - Apply 1-2 typed mutations per child (see operators below)
   - Return new genome with mutation log

3. evaluate(genome, tier) → FitnessResult
   - Call Validator Tier 1
   - Collect report summary
   - Compute fitness (with DD penalty)
   - If FAIL → tombstone immediately

4. selectParents(results) → genome[]
   - Pick top K by robust fitness
   - Penalize: high DD, poor OOS, instability, low trade count

5. breed(parents) → genome[]
   - Phase 1: mutation only (no crossover)
   - Each parent spawns M children
   - Total next gen = K × M

6. archiveAndTombstone(results)
   - Freeze champions (spec hash + dataset hash)
   - Store tombstones with cause-of-death metadata
   - Check similarity to prevent rediscovery loops
```

### Mutation Operators (Phase 1 — Tight Set)

| Operator | Target | Range | Probability |
|----------|--------|-------|-------------|
| epsilon_nudge | `setup_config.composite_spec.stages.0.params.epsilon_pct` | ±10-25% | 30% |
| atr_stop_nudge | `risk_config.atr_multiplier` | ±0.25 | 20% |
| tp_nudge | `risk_config.take_profit_R` | ±0.5R | 20% |
| max_concurrent_nudge | `risk_config.max_concurrent_positions` | ±1 | 15% |
| filter_toggle | Add/remove one filter primitive (regime, volatility) | on/off | 10% |
| stop_type_swap | `risk_config.stop_type` | atr ↔ percentage | 5% |

Rules:
- Max 2 mutations per child
- All values clamped to sane bounds
- Complexity cap: max 3 primitives in composite

### Generation Loop

```
1. Seed 50 variants from baseline
2. Evaluate all via Tier 1 validator (parallel where possible)
3. Tombstone failures (expectancy <= 0, trades < 100, MC DD > 50%)
4. Select top 5 parents by robust fitness
5. Each parent spawns 10 children via mutation → 50 new genomes
6. Repeat from step 2
7. Every 24 hours: run Tier 2 on generation champion
8. If Tier 2 passes → promote to Champions archive
```

### Phase 1 Settings

| Setting | Value |
|---------|-------|
| Family | `rdp_macd_divergence` |
| Population size | 50 per generation |
| Parent count | 5 |
| Children per parent | 10 |
| Mutations per child | 1-2 |
| Tier 1 for all | Yes |
| Tier 2 for champion only | Daily |
| Max generations | Unlimited (runs until stopped) |

### Data Model

```typescript
interface Population {
  population_id: string;
  family_id: string;
  generation: number;
  genomes: Genome[];
  status: 'seeding' | 'evaluating' | 'selecting' | 'breeding' | 'completed';
  created_at: string;
}

interface Genome {
  genome_id: string;
  spec: StrategySpec;           // full strategy JSON
  parent_id: string | null;     // null for seed generation
  mutations: MutationLog[];     // what changed from parent
  generation: number;
  fitness: FitnessResult | null;
  status: 'pending' | 'evaluating' | 'alive' | 'dead' | 'champion';
}

interface MutationLog {
  operator: string;             // e.g., 'epsilon_nudge'
  param_path: string;
  old_value: any;
  new_value: any;
}

interface FitnessResult {
  fitness_score: number;
  expectancy_R: number;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  oos_degradation_pct: number;
  pass_fail: 'PASS' | 'FAIL';
  report_id: string;
  cause_of_death?: string;      // for tombstoned genomes
}

interface Lineage {
  genome_id: string;
  parent_id: string | null;
  generation: number;
  mutations: MutationLog[];
  fitness_score: number;
  status: 'alive' | 'dead' | 'champion';
}
```

### Anti-Cheat Constraints

- No lookahead (inherited from validator architecture)
- Minimum trade count: 100 (Tier 1), 300 (Tier 2)
- Bounded complexity: max 3 primitives, shallow reducer
- Bounded degrees of freedom: max 2 mutations per child
- Similarity check before promotion (trade overlap, equity curve correlation)

### Files to Create

- `backend/src/services/populationManager.ts` — core 6 functions + generation loop
- `backend/src/routes/evolution.ts` — API endpoints
- `frontend/public/evolution.html` — lab dashboard
- `frontend/public/evolution.js` — UI logic

### API Endpoints

- `POST /api/evolution/start` — start a new evolution session
- `GET /api/evolution/:sessionId` — get session status, current generation, champion
- `POST /api/evolution/:sessionId/stop` — stop evolution
- `GET /api/evolution/:sessionId/lineage` — get family tree
- `GET /api/evolution/:sessionId/tombstones` — get death records
- `POST /api/evolution/:sessionId/promote` — promote champion to production

---

## Phase 2: Add Crossover Within Family

**Prerequisite**: Phase 1 proven stable (evolution produces improvements, not just noise)

### Crossover Operators

- Swap one primitive stage between parents
- Splice reducer subtrees
- Blend numeric params with bounded interpolation (midpoint ± noise)
- Inherit risk config from more conservative parent

### Breed Function Update

```
breed(parents):
  for each pair of parents:
    - 70% chance: mutation only (same as Phase 1)
    - 30% chance: crossover + mutation
  return children
```

---

## Phase 3: Multiple Families (Niches)

**Prerequisite**: Phase 2 proven stable

### Separate Populations

Run independent evolution for each family:

1. **RDP Divergence Family** — MACD divergence, RSI divergence, price/volume divergence
2. **RDP Swing/Basing Family** — wiggle base breakout, base retest, 75% base
3. **Order Block + Regime Family** — OB pullback, OB breakout, regime transitions
4. **Regression Channel Family** — mean reversion, channel breakout, SD expansion

### Portfolio-Level Competition

Families compete at the portfolio level:
- Each family's champion gets a capital allocation slot
- Families with consistently better risk-adjusted returns get more slots
- Families that stagnate get fewer slots or are retired

### Niche Specialization (Emerges Naturally)

With regime-aware scoring, you'll see:
- "Expansion hunters" (trend pullback strategies)
- "Distribution hunters" (short/mean reversion strategies)
- "Transition hunters" (breakout/volatility expansion strategies)

Portfolio becomes an ecosystem of complementary species.

---

## Phase 4: Cross-Family Recombination (Rare)

**Prerequisite**: At least 3 families with stable champions

### Rules

- Cross-family breeding is rare (5% of children per generation)
- Strict complexity cap (max 4 primitives)
- Mandatory Tier 2 validation before promotion
- If child is worse than both parents → tombstone immediately
- Monitor for Frankenstein strategies that overfit

---

## Safety & Governance

### Holdout Universe

Keep a hidden evaluation set the organism cannot see:
- **Research Universe (RU)**: used for Tier 1 evaluation during evolution
- **Holdout Universe (HU)**: only touched for Tier 2 confirmation of champions
- Agent is not allowed to see HU results until promotion time

### False Discovery Gate

Promotion requires evidence, not hope:
- Expectancy > 0 by a margin (not barely positive)
- Monte Carlo p95 DD < 30%
- OOS degradation < 50%
- Stability across small parameter perturbations
- Novelty check (not a clone of existing champion)

### Immutable Experiment Ledger

Every candidate records:
- Spec hash (exact JSON)
- Dataset version hash
- Execution layer version
- Random seeds used in Monte Carlo
- Promotion decision + reason

### Edge Death Certificate (Live Strategies)

Once deployed, automated kill switch when:
- Rolling expectancy (last K trades) drops below threshold
- Rolling win rate + avg winner/loser ratio drifts
- Live vs backtest slippage delta exceeds tolerance
- Correlation spike detected (positions moving together)

When breached: auto-disable strategy → Quarantine (not Tombstone — can be reinstated if conditions recover)

### Compute Budget

- Daily job quotas (max N evaluations per day)
- Early stopping when fitness degrades across generation
- Automatic de-duplication (similarity check vs tombstones and champions)

---

## Implementation Order

| Phase | Effort | Description |
|-------|--------|-------------|
| Phase 0 | Done | Hand-seeded baseline (MACD divergence 0.40R) |
| Phase 1 | 3-4 days | Mutation-only evolution, single family, generation loop, lab dashboard |
| Phase 2 | 1-2 days | Add crossover operators within family |
| Phase 3 | 2-3 days | Multiple families, portfolio-level competition, niche UI |
| Phase 4 | 1-2 days | Cross-family recombination (rare), complexity governance |

## Dependencies

- Existing validator pipeline (done)
- Existing sweep engine (done)
- Existing fitness function with DD penalty (done — fixed today)
- Existing tombstone system (done)
- Tier gate bypass for evolution variants (done — `skip_tier_gate`)
- Max concurrent positions filter (done)

## Key Principles

1. **Default output is failure.** If 99/100 ideas die, the system is healthy.
2. **Sweeps resolve, they don't optimize.** Look for plateaus, not peaks.
3. **Dead strategies > live ones** as training data.
4. **Food = risk-adjusted return under adversity**, not raw profit.
5. **Simplicity is a survival trait.** Complexity = overfit.
6. **The research analyst must be punished for luck, rewarded only for stability.**
