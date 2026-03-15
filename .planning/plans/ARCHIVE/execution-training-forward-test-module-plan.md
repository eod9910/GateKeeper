# Execution Training & Forward-Test Module (ETFM) Plan

## 1) Purpose

Build a training module that improves both:

- **Execution discipline** (enter trades correctly, follow rules)
- **Profit outcomes** (track whether trades actually make money)

This module is not a game. It is a structured **training + forward-test** workflow that runs strategy logic in real time against historical bars and resolves outcomes immediately.

---

## 2) Product Definition

**Module name:** `Execution Training & Forward-Test Module (ETFM)`

**Core behavior:**

1. User sets up trade using a strategy contract.
2. System enforces contract/risk rules before allowing entry.
3. Once entered, system runs bars forward immediately.
4. Trade resolves at first:
   - `take_profit_hit`
   - `stop_loss_hit`
   - optional `time_stop_hit`
5. Attempt is saved with process + outcome metrics.

---

## 3) Scope

### In scope (V1)

- Strategy contracts (machine-checkable rules)
- Rule-gated entry flow
- Immediate forward simulation resolver
- Trade/attempt persistence
- Process + outcome scoring
- Session analytics (win rate, expectancy, discipline trend)

### Out of scope (V1)

- Live broker execution
- Tick-level slippage/fill realism
- Multi-leg options pricing engine
- Portfolio optimization/risk parity

---

## 4) User Flow

1. Select symbol/timeframe
2. Choose training strategy contract
3. Draw/define required structure (if needed)
4. Set entry/SL/TP
5. Run contract validation
6. If pass: create attempt and enter trade
7. Forward-resolve immediately bar-by-bar
8. Save result + score snapshot
9. Show review and update session stats

---

## 5) State Machine

- `IDLE`
- `SETUP_DEFINED`
- `ENTRY_BLOCKED`
- `ENTRY_READY`
- `ENTERED`
- `FORWARD_SIMULATING`
- `RESOLVED`
- `REVIEW`
- `COOLDOWN` (on repeated process violations)

Transitions are event-driven (rule checks, entry action, resolver output, cooldown policy).

---

## 6) Architecture

## Frontend

- New page or tab: `Training`
- Reuse existing chart and drawing tools
- Panels:
  - Contract selector
  - Rule checklist
  - Entry panel (entry/stop/TP/risk)
  - Run button
  - Result card
  - Session scoreboard

## Backend

Create training services in `backend/src/services/training/`:

- `contractEngine.ts`
- `forwardResolver.ts`
- `scoringEngine.ts`
- `sessionEngine.ts`

Create routes in `backend/src/routes/training.ts`:

- `/api/training/contracts`
- `/api/training/sessions`
- `/api/training/attempts`
- `/api/training/simulate`
- `/api/training/stats`

## Storage (JSON-first, consistent with current stack)

- `data/training/contracts/*.json`
- `data/training/sessions/*.json`
- `data/training/attempts/*.json`
- `data/training/events/*.json`
- optional cached `data/training/stats/*.json`

---

## 7) Data Models

## `StrategyContract`

- `id`, `name`, `version`, `active`
- `symbolScope`, `timeframeScope`
- `entryRules[]`
- `riskRules[]`
- `requiredDrawings[]`
- `cooldownPolicy`
- `scoreWeights`

## `TrainingSession`

- `sessionId`, `userId`, `startedAt`, `endedAt`
- `contractId`
- `attemptIds[]`
- rolling stats snapshot

## `TrainingAttempt`

- `attemptId`, `sessionId`, `contractId`
- `symbol`, `timeframe`, `side`
- `entry`, `stop`, `takeProfit`
- `entryBarIndex`, `entryBarTime`
- `drawings`, `chartSnapshotRef`
- `ruleEvaluations[]`
- `violations[]`, `rewards[]`
- `status`: `blocked | entered | resolved`

## `ForwardResolution`

- `exitReason`: `tp_hit | sl_hit | time_stop`
- `exitPrice`, `exitBarIndex`, `exitBarTime`
- `barsHeld`
- `rMultiple`, `pnlAbs`, `pnlPct`
- `mae`, `mfe`

## `ScoreSnapshot`

- `processScore`
- `outcomeScore`
- `compositeScore`
- `disciplineScoreRolling`
- `expectancyRolling`
- `winRateRolling`

---

## 8) Forward Resolver Specification

Resolver inputs:

- OHLCV array
- side (`long|short`)
- entry, stop, take profit
- start index/time
- max hold bars (optional)
- tie-break policy

Resolver algorithm:

1. Start at entry bar + 1
2. Iterate forward through bars
3. Check TP/SL touch conditions per bar
4. If both touched same bar, apply fixed policy (V1 conservative):
   - assume stop first
5. If no TP/SL by max hold, resolve via time-stop
6. Return deterministic `ForwardResolution`

This is the canonical truth source for outcome scoring.

---

## 9) Scoring Design

## Process Score (primary)

Measures rule adherence:

- valid setup rules
- proper stop placement
- minimum RR compliance
- confirmation timing (no early entry)
- required drawings present

## Outcome Score (secondary)

Measures result quality:

- realized `R`
- win/loss
- contribution to expectancy

## Composite Score

- `composite = process * w_process + outcome * w_outcome`
- weights configurable per strategy contract

Recommended V1 default:

- process: `0.7`
- outcome: `0.3`

---

## 10) Statistical Confidence Thresholds

Stats are always displayed, but labeled with confidence level based on trade count:

- **LOW** (< 50 trades): "Not enough data — keep trading"
- **MEDIUM** (50–200 trades): "Emerging pattern — directionally useful"
- **HIGH** (> 200 trades): "Statistically meaningful — trust these numbers"

Applies to: expectancy, win rate, avg R, Sharpe, and any per-strategy-type breakdowns.

Per-strategy-type stats (Breakout / Pullback / Fade) each have their own independent confidence counter — 50 breakout trades doesn't make your pullback stats meaningful.

---

## 11) Enforcement & Consequences

Violation ladder:

1. Warning + small penalty
2. Stronger penalty
3. Cooldown lockout

Positive reinforcement:

- waiting for confirmation
- passing no-trade conditions
- consistent rule compliance streaks

---

## 12) API Contract (V1)

- `POST /api/training/contracts` create/update contract
- `GET /api/training/contracts` list contracts
- `POST /api/training/sessions/start`
- `POST /api/training/sessions/:id/end`
- `POST /api/training/attempts/validate`
- `POST /api/training/attempts/run` (validate + resolve + score + persist)
- `GET /api/training/sessions/:id`
- `GET /api/training/stats?contractId=...`

---

## 12) UI Requirements

Training page must show:

- Active contract
- Checklist pass/fail state
- Entry controls
- Run/Resolve button
- Result card after each attempt
- Session metrics:
  - attempts
  - win rate
  - avg R
  - expectancy
  - process adherence
  - cooldown status

---

## 14) Acceptance Criteria

- Entry cannot proceed if required rules fail.
- Every attempt is persisted with full context.
- Resolver output is deterministic and reproducible.
- Process and outcome scores update immediately.
- Cooldown policy is enforced as configured.
- Session and aggregate stats are queryable and visible.

---

## 14) Risks & Mitigations

- **Same-bar TP/SL ambiguity**
  - Mitigation: explicit tie-break policy + versioned resolver
- **Overfitting to simplistic fills**
  - Mitigation: add realism modes in later versions
- **Score gaming**
  - Mitigation: immutable event log and hard entry gates

---

## 16) Delivery Phases

## Phase 1 — Core Engine

- Contract schema + validator
- Forward resolver + unit tests
- Attempt persistence

## Phase 2 — Training UI

- Training page shell
- Checklist + entry controls
- Run/resolve flow + result card

## Phase 3 — Scoring & Behavior

- Process/outcome/composite scoring
- Violation ladder + cooldown logic

## Phase 4 — Analytics

- Session replay
- Contract-level comparisons
- Exportable dataset for model work

---

## 16) First Implementation Backlog

1. Add `training` routes and service skeletons.
2. Implement `StrategyContract` schema and validation.
3. Implement `forwardResolver` with deterministic tests.
4. Implement `attempts/run` endpoint.
5. Build frontend training page with checklist and run button.
6. Persist attempts and show result cards.
7. Add scoring engine and rolling stats widgets.

---

## 18) Versioning Notes

- Version resolver policy and contract schema from day one.
- Store `resolverVersion` and `contractVersion` per attempt so historical performance remains auditable.

