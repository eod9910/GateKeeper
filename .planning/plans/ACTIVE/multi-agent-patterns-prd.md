# Multi-Agent Patterns — PRD

**Created:** 2026-04-29
**Updated:** 2026-04-29
**Status:** PHASE A CODE COMPLETE — awaiting first valuation refresh to populate data
**Scope:** Integrate three multi-agent patterns from the TradingAgents framework — adversarial debate, DCF calibration engine, and multi-agent approval gate — into Pattern Detector's existing agent architecture without abandoning the cost-efficient single-agent-per-workspace model.

---

## Mission

> **Add structured adversarial reasoning, persistent decision memory, and safety gates to the existing agent stack so that every high-stakes analysis benefits from opposing perspectives, learns from its own track record, and passes a risk checkpoint before surfacing to the user.**

These three patterns address the three gaps identified in the TradingAgents comparison (see `.claude/skills/pattern-detector/build-agent/SKILL.md`):

1. **Single-perspective analysis.** Ledger and the conviction layer producer both generate analysis from one viewpoint. There is no structured mechanism to force consideration of the opposing case before committing.
2. **No calibration loop.** The DCF engine runs across 3,500+ symbols on a schedule, producing bear/base/bull fair values with explicit assumptions (revenue growth, margins, discount rate, terminal growth). But it never checks whether those assumptions were right. There is no feedback loop from realized earnings back into future DCF assumptions. The engine makes the same systematic errors quarter after quarter.
3. **No second opinion.** Analysis flows directly from engine output → agent interpretation → user display. There is no checkpoint where a different perspective can flag risks, concentration, or timing problems.

---

## Decisions

| # | Topic | Commitment |
|---|-------|------------|
| D1 | Architecture constraint | All three patterns are **extensions** of the existing three-layer stack (workspace contract → runtime binding → executable capability). No new orchestration framework (no LangGraph, no agent-to-agent messaging bus). Each pattern is implemented as a new function in the runtime binding layer that makes additional LLM calls and merges results. |
| D2 | Cost constraint | The full stack (debate + gate + memory reflection) adds at most **4 LLM calls per analysis** on top of the existing 1. Total: 5 calls vs TradingAgents' 8-12+. Debate uses gpt-4o-mini for the two researcher calls. Gate uses gpt-4o-mini. Reflection uses gpt-4o-mini. |
| D3 | Scope — which agents | DCF Calibration applies to the **valuation refresh scheduler** (universe-wide DCF runs) and to **financial_analyst** (Ledger interactive analyses). Adversarial Debate applies to **financial_analyst** (Ledger) and **conviction layer producer** (Market Intelligence). Approval Gate applies to **financial_analyst** and **conviction layer producer**. |
| D4 | Scope — opt-in vs default | DCF prediction logging is **always on** (zero-cost DB write during existing valuation refresh). Calibration analysis is **scheduled** (quarterly after earnings season, not per-request). Calibration adjustments feed into the engine deterministically. Adversarial Debate is **opt-in per request** for Ledger (operator toggle, default off for exploratory chat, default on for valuation workflows). Debate is **always on** for the conviction layer producer. Approval Gate is **always on** for conviction-layer output and **opt-in** for Ledger (default on when execution bridge is active). |
| D5 | Persistence | All three patterns use the existing `app-state.sqlite` database. New tables are additive (no schema migration on existing tables). |
| D14 | DCF calibration data source | The valuation refresh scheduler already runs `runDcfValuationEngine()` across the universe and persists `fair_value_low/mid/high`, `valuation_gap_pct`, and `valuation_quality_score` to `symbol-catalog.sqlite` via `symbol_metrics`. The DCF engine already outputs explicit per-scenario assumptions: `revenue_growth_near_term_pct`, `target_free_cash_flow_margin_pct`, `discount_rate_pct`, `terminal_growth_pct`, `forecast_years`. These assumptions are what we log and later compare against actuals. |
| D15 | Calibration granularity | Calibration errors are aggregated by **sector**, **market cap band**, and **assumption type** — not just per-ticker. The goal is to discover systematic biases ("we overestimate revenue growth for mid-cap semiconductors by 3%") that can be corrected engine-wide, not just per-symbol corrections. |
| D16 | Calibration injection method | Calibration adjustments feed into the DCF engine as a `calibration_adjustments` field on `LedgerContextSummary`. The engine applies adjustments **before** computing scenarios — e.g., if calibration data shows a +3% revenue growth bias for this sector, the engine reduces its revenue growth assumption by 3%. This is deterministic, not LLM-dependent. |
| D6 | Workspace strategy | Bull Researcher and Bear Researcher are **lightweight workspaces** (IDENTITY.md + SOUL.md only — no AGENTS.md, TOOLS.md, or skills). They receive engine output as context, not as tool calls. Risk Reviewer is a **standard workspace** (IDENTITY.md + SOUL.md + AGENTS.md + TOOLS.md) because it needs to query portfolio state and decision history. |
| D7 | Debate output format | Debate produces a structured `DebateResult` object, not free-text. Fields: `bull_thesis` (string), `bear_thesis` (string), `points_of_agreement` (string[]), `points_of_disagreement` (string[]), `unresolved_questions` (string[]), `strongest_bull_argument` (string), `strongest_bear_argument` (string). This object is injected into the primary agent's prompt as structured context. |
| D8 | Gate output format | Gate produces a structured `GateResult`: `verdict` (APPROVE \| FLAG \| BLOCK), `reason` (string), `risk_factors` (string[]), `concentration_warning` (string \| null), `timing_warning` (string \| null). Verdict is surfaced as a validity flag on scenarios or as an annotation on Ledger output. |
| D9 | Calibration scope | DCF predictions are logged per (symbol, prediction_date). Calibration errors are aggregated by sector, industry, and market_cap_band — not just per-ticker. The goal is systematic bias discovery, not per-symbol memory. Adjustments are applied globally per scope (e.g., all Technology sector symbols get the same revenue growth correction). |
| D10 | Phasing | Phase A (DCF Calibration) → Phase B (Approval Gate) → Phase C (Adversarial Debate). Each phase is independently useful. Phase B benefits from Phase A's calibration history. Phase C's output flows through Phase B's gate. |
| D11 | Market Intelligence integration | For the conviction layer producer: debate replaces the single LLM call that currently produces `confirming_signals` + `invalidating_signals`. The bull researcher argues for the scenario; the bear researcher argues against. Synthesis is deterministic TypeScript that merges both into the existing conviction layer JSON shape. The gate adds a `RISK_REVIEW_FLAGGED` or `RISK_REVIEW_BLOCKED` validity flag. |
| D12 | Ledger integration | For financial_analyst workflows: DCF prediction logging captures every valuation with its assumptions. Calibration adjustments feed into the engine before computation. Debate is injected between engine computation and LLM interpretation. The gate checks the final analysis for concentration, timing, and hard-flag risks. Prior valuations + calibration data are injected into the Ledger prompt. |
| D13 | Research Agent relationship | The Research Agent already has a `reflectOnBacktest` pattern (post-hoc forensic analysis stored on genome entries). DCF calibration is architecturally similar but operates on **valuation assumptions** rather than backtest metrics, and feeds back **deterministically into the engine** rather than into hypothesis generation prompts. The two systems remain separate — they serve different feedback loops. |

---

## Architecture

### Where the patterns plug in

```
  ┌──────────────────────────────────────────────────────────────┐
  │  PHASE A — DCF Calibration (deterministic, zero LLM cost)    │
  │                                                              │
  │  ┌─────────────────┐  next refresh  ┌────────────────────┐  │
  │  │ calibration_     │ ──────────►   │ DCF Engine         │  │
  │  │ adjustments      │  (applied     │ (assumptions       │  │
  │  │ (sector biases)  │   before      │  corrected)        │  │
  │  └────────▲─────────┘   scenarios)  └────────┬───────────┘  │
  │           │                                  │              │
  │  ┌────────┴─────────┐               ┌───────▼────────────┐ │
  │  │ Calibration Job   │               │ Prediction Logger  │ │
  │  │ (quarterly batch) │               │ (DB write per      │ │
  │  │ predicted - actual│               │  valuation run)    │ │
  │  └──────────────────┘               └────────────────────┘ │
  └──────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────┐
                    │  Engine Output            │
                    │  (deterministic TS/Python) │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │  Adversarial Debate       │  ← Phase C
                    │  (bull + bear researchers) │
                    │  2 LLM calls (gpt-4o-mini)│
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │  Primary Agent            │
                    │  (Ledger / conviction      │
                    │   layer producer)          │
                    │  1 LLM call (gpt-4o)      │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │  Approval Gate            │  ← Phase B
                    │  (risk reviewer)          │
                    │  1 LLM call (gpt-4o-mini) │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │  User / UI                │
                    └──────────────────────────┘
```

### Key files to modify

| Layer | File | Changes |
|-------|------|---------|
| Runtime binding | `visionService.ts` | New `buildBullResearcherPrompt()`, `buildBearResearcherPrompt()`, `buildRiskReviewerPrompt()`. Inject debate result + prior reflections into existing workspace prompt builders. |
| Runtime binding | NEW `debateService.ts` | `runAdversarialDebate(engineOutput, context)` → `DebateResult`. Orchestrates bull + bear calls, parses structured output, merges. |
| Runtime binding | NEW `gateService.ts` | `runApprovalGate(analysisOutput, context, decisionHistory)` → `GateResult`. Single LLM call, structured output. |
| Executable capability | `copilotTools.ts` | Existing workflow tools (`run_financial_analysis`, etc.) optionally call debate + gate. New tool `get_prior_decisions` for decision memory injection. |
| Data layer | NEW `dcfCalibrationDb.ts` | `dcf_predictions` + `dcf_calibration_errors` + `dcf_calibration_adjustments` table management. |
| Scheduled job | NEW `run_dcf_calibration.py` | Quarterly batch: compare predictions vs actuals from PIT, compute errors, aggregate biases, produce adjustments. |
| Engine layer | `ledgerEngines.ts` | `runDcfValuationEngine()` reads optional `calibration_adjustments` from context, applies before computing. |
| Workspace | NEW `workspace/Bull Researcher Workspace/` | IDENTITY.md + SOUL.md only. |
| Workspace | NEW `workspace/Bear Researcher Workspace/` | IDENTITY.md + SOUL.md only. |
| Workspace | NEW `workspace/Risk Reviewer Workspace/` | IDENTITY.md + SOUL.md + AGENTS.md + TOOLS.md. |
| Conviction layer | `run_conviction_producer.py` | Replace single LLM call with debate-based conviction. |

---

## Phase A — DCF Calibration Engine

### Purpose

Turn the existing universe-wide DCF valuation runs into a **prediction-tracking and calibration system**. Every DCF run logs its assumptions and fair value estimates. After earnings reports land (quarterly), the system compares predictions against actuals, discovers systematic biases by sector/cap-band/assumption-type, and feeds calibration adjustments back into the engine deterministically.

This is not per-chat decision memory. This is **systematic model calibration** across 3,500+ symbols.

### How it works

```
Valuation refresh runs DCF on AAPL
    → Logs prediction: bear $155 / base $185 / bull $220
    → Logs assumptions: revenue_growth 9%, FCF margin 28%, discount 10%
    → Logs price at prediction time: $172
    → Logs sector: Technology, industry: Consumer Electronics

[Next quarter: earnings report lands]

Calibration job runs:
    → Fetches actual revenue growth: 6% (predicted 9%, error +3%)
    → Fetches actual FCF margin: 26% (predicted 28%, error +2%)
    → Logs assumption errors to dcf_calibration_errors table

[Aggregation across all symbols in sector]

    → Technology sector: revenue growth bias = +2.8% (systematically optimistic)
    → Technology sector: FCF margin bias = +1.5%
    → Consumer Staples: revenue growth bias = -0.3% (accurate)

[Next valuation refresh]

    → Engine reads calibration_adjustments for this sector
    → Reduces revenue growth assumption by 2.8% before computing
    → Fair value estimates become more accurate over time
```

### Schema

#### `dcf_predictions` table

```sql
CREATE TABLE IF NOT EXISTS dcf_predictions (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol                  TEXT NOT NULL,
    sector                  TEXT,
    industry                TEXT,
    market_cap_band         TEXT,               -- 'mega', 'large', 'mid', 'small', 'micro'
    prediction_date         TEXT NOT NULL,
    price_at_prediction     REAL,
    fair_value_low          REAL,
    fair_value_mid          REAL,
    fair_value_high         REAL,
    valuation_gap_pct       REAL,
    judgment                TEXT,               -- 'undervalued', 'overvalued', 'roughly_fair'
    confidence_level        TEXT,               -- 'low', 'moderate', 'high'
    -- Assumptions (the values the engine used)
    revenue_growth_pct      REAL,
    target_fcf_margin_pct   REAL,
    discount_rate_pct       REAL,
    terminal_growth_pct     REAL,
    forecast_years          INTEGER,
    -- Cash flow base
    annual_revenue          REAL,
    reported_fcf            REAL,
    quality_adjusted_fcf    REAL,
    operating_margin_pct    REAL,
    -- Source
    source                  TEXT NOT NULL DEFAULT 'valuation_refresh',  -- 'valuation_refresh', 'interactive_analysis'
    engine_version          TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dcf_predictions_symbol ON dcf_predictions(symbol);
CREATE INDEX IF NOT EXISTS idx_dcf_predictions_sector ON dcf_predictions(sector);
CREATE INDEX IF NOT EXISTS idx_dcf_predictions_date ON dcf_predictions(prediction_date);
```

#### `dcf_calibration_errors` table

```sql
CREATE TABLE IF NOT EXISTS dcf_calibration_errors (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id           INTEGER NOT NULL REFERENCES dcf_predictions(id),
    symbol                  TEXT NOT NULL,
    sector                  TEXT,
    industry                TEXT,
    market_cap_band         TEXT,
    -- What we predicted vs what happened
    predicted_revenue_growth_pct    REAL,
    actual_revenue_growth_pct       REAL,
    revenue_growth_error_pct        REAL,       -- predicted - actual (positive = optimistic)
    predicted_fcf_margin_pct        REAL,
    actual_fcf_margin_pct           REAL,
    fcf_margin_error_pct            REAL,
    predicted_fair_value_mid        REAL,
    actual_price_at_review          REAL,
    price_error_pct                 REAL,       -- (predicted_mid - actual_price) / actual_price
    direction_correct               INTEGER,    -- 1 = judgment direction matched price move
    -- Timing
    prediction_date                 TEXT NOT NULL,
    review_date                     TEXT NOT NULL,
    quarters_elapsed                INTEGER,
    created_at                      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_sector ON dcf_calibration_errors(sector);
CREATE INDEX IF NOT EXISTS idx_dcf_cal_errors_band ON dcf_calibration_errors(market_cap_band);
```

#### `dcf_calibration_adjustments` table

```sql
CREATE TABLE IF NOT EXISTS dcf_calibration_adjustments (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_type              TEXT NOT NULL,       -- 'sector', 'industry', 'market_cap_band', 'global'
    scope_value             TEXT NOT NULL,       -- e.g., 'Technology', 'Consumer Electronics', 'mid', 'all'
    assumption_key          TEXT NOT NULL,       -- 'revenue_growth_pct', 'target_fcf_margin_pct'
    adjustment_pct          REAL NOT NULL,       -- negative = reduce assumption (correct for optimism)
    sample_size             INTEGER NOT NULL,    -- how many errors this is based on
    confidence              REAL,               -- statistical confidence in the adjustment
    last_computed_at        TEXT NOT NULL,
    UNIQUE(scope_type, scope_value, assumption_key)
);
```

### Deliverables

- [ ] `dcf_predictions`, `dcf_calibration_errors`, `dcf_calibration_adjustments` tables in `app-state.sqlite`
- [ ] `backend/src/services/dcfCalibrationDb.ts` — CRUD helpers:
  - `logDcfPrediction(params)` → prediction_id
  - `getPredictionsForSymbol(symbol, limit?)` → DcfPredictionRow[]
  - `getPredictionsReadyForCalibration(minAge?)` → DcfPredictionRow[]
  - `logCalibrationError(params)` → void
  - `getCalibrationErrorsByScope(scopeType, scopeValue)` → CalibrationErrorRow[]
  - `upsertCalibrationAdjustment(params)` → void
  - `getCalibrationAdjustments(sector, industry?, marketCapBand?)` → CalibrationAdjustmentRow[]
- [ ] **Prediction logging wired into valuation refresh scheduler**:
  - After `runDcfValuationEngine()` completes for each symbol, `logDcfPrediction()` writes the prediction row
  - Captures: symbol, sector, industry, market_cap_band, all assumption values, fair_value_range, price, judgment
  - Zero-cost addition to existing flow (just a DB INSERT)
- [ ] **Prediction logging wired into `copilotTools.ts`** for interactive analyses:
  - `buildLedgerWorkflowResult()` writes a prediction row after every `run_dcf_valuation` with `source='interactive_analysis'`
- [ ] **`backend/scripts/run_dcf_calibration.py`** — quarterly calibration batch job:
  - Queries predictions from the prior quarter that haven't been calibrated
  - Fetches actual revenue and margin data from PIT facts (`pit_statement_facts`) for the corresponding earnings period
  - Fetches current price via existing OHLCV endpoint
  - Computes per-prediction errors: revenue_growth_error, fcf_margin_error, price_error, direction_correct
  - Writes errors to `dcf_calibration_errors`
  - Aggregates errors by sector, market_cap_band, and assumption_key
  - Computes bias adjustments (mean error with ≥10 sample size threshold)
  - Upserts to `dcf_calibration_adjustments`
  - Produces a human-readable calibration report (JSON) saved to `backend/data/calibration/`
- [ ] **Scheduler registration**: `dcf_calibration` job in `ledgerHydrationScheduler.ts`
  - Kind: engine
  - Cron: quarterly (after earnings season — approx Feb 15, May 15, Aug 15, Nov 15)
  - Can also be triggered manually via POST endpoint
- [ ] **Calibration injection into DCF engine**:
  - `LedgerContextSummary` gets a new optional field: `calibration_adjustments`
  - `buildLedgerContext()` in `ledgerContext.py` (or the TS caller) queries `dcf_calibration_adjustments` for the symbol's sector/industry/cap-band
  - `runDcfValuationEngine()` reads `calibration_adjustments` and applies them to assumptions before computing scenarios:
    - If adjustment says "revenue_growth bias = +3% for Technology", reduce the engine's revenue growth assumption by 3%
    - Adjustments are applied additively, clamped to prevent absurd values
    - Engine output includes a `calibration_applied` field showing what adjustments were used
- [ ] **Prior predictions injected into Ledger prompts**:
  - `buildFinancialAnalystPrompt()` in `visionService.ts` checks for prior predictions on the active symbol
  - If found, appends a `## Prior Valuations & Calibration` block with:
    - Last DCF prediction date, fair_value_range, judgment
    - If calibration errors exist: what assumptions were wrong and by how much
    - Active calibration adjustments for this sector
  - This gives the LLM context on its own track record when interpreting the engine output
- [ ] **Calibration dashboard API**:
  - `GET /api/calibration/summary` — aggregate bias by sector, cap-band, assumption
  - `GET /api/calibration/errors/:symbol` — per-symbol prediction vs actual history
  - `GET /api/calibration/adjustments` — current active adjustments

### Exit criteria

- [ ] ≥500 predictions logged after 1 valuation refresh cycle across the universe
- [ ] Calibration job runs successfully on at least 1 quarter of prediction data
- [ ] At least 3 sectors have calibration adjustments computed with ≥10 sample size
- [ ] Calibration adjustments are applied in at least 1 DCF engine run (visible in `calibration_applied` output field)
- [ ] Prior valuation injection verified in at least 1 Ledger analysis (the `## Prior Valuations` block appears)
- [ ] Calibration report JSON generated and readable
- [ ] No regressions in existing DCF engine behavior (when no calibration data exists, engine behaves identically to today)

---

## Phase B — Approval Gate (Risk Reviewer)

### Purpose

Add a lightweight second-opinion checkpoint that reviews the primary agent's output before it surfaces to the user. The Risk Reviewer focuses on risks the primary agent may underweight: concentration, timing, regime alignment, hard-flag severity, and assumption fragility.

### Workspace

#### `Risk Reviewer Workspace/IDENTITY.md`
- Name: **Sentinel**
- Vibe: Skeptical, terse, adversarial-by-design
- Not a bear — a risk manager. Approves good analysis, flags real problems

#### `Risk Reviewer Workspace/SOUL.md`
Core beliefs:
- The biggest losses come from concentration, not from being wrong on direction
- Timing risk is as dangerous as directional risk
- Hard flags (acquisitions, distress, restatement) override all other analysis
- The analyst's job is to be right; the reviewer's job is to catch what the analyst missed
- If the evidence is thin, say so — don't manufacture confidence

#### `Risk Reviewer Workspace/AGENTS.md`
Standing orders:
1. Read the analyst's output completely before judging
2. Check for hard-flag severity — any active hard flag is an automatic FLAG
3. Check for sector/position concentration if portfolio context is available
4. Check for timing risk — is the market confirming the thesis, or is execution premature?
5. Check assumption fragility — which one assumption, if wrong, would reverse the conclusion?
6. Output structured JSON only — no prose, no hedging
7. APPROVE means "I see no risk the analyst missed." FLAG means "the analysis may be correct but these risks need the user's attention." BLOCK means "the analysis has a critical gap that should be resolved before acting."

#### `Risk Reviewer Workspace/TOOLS.md`
- `get_prior_decisions` — check if this ticker has been analyzed before and what happened
- `get_portfolio_exposure` — check current portfolio concentration (when execution bridge is active)

### Output Schema

```typescript
interface GateResult {
    verdict: 'APPROVE' | 'FLAG' | 'BLOCK';
    reason: string;                          // ≤ 2 sentences
    risk_factors: string[];                  // 2-5 items
    concentration_warning: string | null;
    timing_warning: string | null;
    assumption_fragility: string | null;     // "if X is wrong, the conclusion reverses"
    hard_flag_override: boolean;             // true if hard flag triggered the verdict
}
```

### Deliverables

- [ ] `workspace/Risk Reviewer Workspace/` — IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md
- [ ] `gateService.ts` — `runApprovalGate(analysisOutput, engineOutput, context, decisionHistory)` → `GateResult`
- [ ] `buildRiskReviewerPrompt()` in `visionService.ts`
- [ ] Gate wired into `copilotTools.ts` — financial analyst workflow tools optionally call `runApprovalGate()` after producing the analysis
- [ ] Gate result injected into the LLM response: Ledger's output includes a `## Risk Review` section with the verdict + risk factors
- [ ] For Market Intelligence conviction layer: gate result becomes validity flags:
  - `RISK_REVIEW_FLAGGED` — conviction produced but risk reviewer flagged concerns
  - `RISK_REVIEW_BLOCKED` — conviction suppressed; scenario surfaces with flag
- [ ] Operator toggle in settings: `riskReviewEnabled` (default: true when execution bridge active, false otherwise)
- [ ] Gate uses `get_prior_decisions` to check decision history (benefits from Phase A)

### Exit criteria

- [ ] Risk Reviewer workspace exists with all 4 markdown files
- [ ] Gate produces valid `GateResult` JSON on ≥95% of calls (no parse failures)
- [ ] At least 1 FLAG or BLOCK correctly fires on a test case with a known hard flag
- [ ] At least 1 APPROVE correctly fires on a clean analysis
- [ ] Gate adds ≤ 3 seconds latency to the analysis flow
- [ ] LLM cost per gate call ≤ $0.005 (gpt-4o-mini)

---

## Phase C — Adversarial Debate

### Purpose

Force structured consideration of both the bullish and bearish case before the primary agent commits to a recommendation. Each side argues from the same evidence; the disagreements surface assumptions the primary agent would otherwise take for granted.

### Workspaces

#### `Bull Researcher Workspace/IDENTITY.md`
- Vibe: Constructive, evidence-focused optimist
- Not a cheerleader — genuinely believes the thesis and backs it with data

#### `Bull Researcher Workspace/SOUL.md`
- Start from the assumption that the scenario/valuation thesis is correct
- Find the strongest evidence supporting it
- Identify what would make the thesis even stronger
- Acknowledge risks but explain why they are manageable or priced in
- Never fabricate evidence — only argue from what the engine output contains

#### `Bear Researcher Workspace/IDENTITY.md`
- Vibe: Constructive skeptic, devil's advocate
- Not a doom-sayer — genuinely believes the risks are underappreciated and backs it with data

#### `Bear Researcher Workspace/SOUL.md`
- Start from the assumption that the market is efficient and the thesis is already priced
- Find evidence that contradicts the thesis or suggests the timing is wrong
- Identify which single assumption, if wrong, would reverse the conclusion
- Explain what the bull case is missing or underweighting
- Never fabricate evidence — only argue from what the engine output contains

### Output Schema

```typescript
interface DebateResult {
    bull_thesis: string;                     // 2-3 sentences
    bear_thesis: string;                     // 2-3 sentences
    points_of_agreement: string[];           // 2-4 items
    points_of_disagreement: string[];        // 2-4 items
    unresolved_questions: string[];          // 1-3 items
    strongest_bull_argument: string;         // 1 sentence
    strongest_bear_argument: string;         // 1 sentence
}
```

### Deliverables

- [ ] `workspace/Bull Researcher Workspace/` — IDENTITY.md + SOUL.md
- [ ] `workspace/Bear Researcher Workspace/` — IDENTITY.md + SOUL.md
- [ ] `debateService.ts`:
  - `runAdversarialDebate(engineOutput, context, options)` → `DebateResult`
  - Orchestrates two parallel gpt-4o-mini calls (bull + bear)
  - Parses structured JSON output from each
  - Deterministic TypeScript merge produces `DebateResult`
- [ ] `buildBullResearcherPrompt()` and `buildBearResearcherPrompt()` in `visionService.ts`
- [ ] Debate wired into Ledger workflows:
  - `buildLedgerWorkflowResult()` in `copilotTools.ts` optionally runs debate after engine computation
  - `DebateResult` appended to the system prompt as a `## Adversarial Debate` block before the LLM interprets the engine output
- [ ] Debate wired into conviction layer producer:
  - `run_conviction_producer.py` calls `debateService` via HTTP (or inline TypeScript if conviction producer is ported to TS)
  - Bull + bear outputs replace the single-LLM-call path for `confirming_signals` + `invalidating_signals`
  - Synthesis maps bull arguments → `confirming_signals`, bear arguments → `invalidating_signals`, bear's strongest argument → `what_breaks_it`
- [ ] Operator toggle: `debateEnabled` per workspace (default: on for conviction producer, off for exploratory Ledger chat, on for Ledger valuation workflows)
- [ ] Debate calls run in parallel (Promise.all) — latency is max(bull, bear), not sum

### Exit criteria

- [ ] Both researcher workspaces exist with IDENTITY.md + SOUL.md
- [ ] Debate produces valid `DebateResult` JSON on ≥95% of calls
- [ ] Debate adds ≤ 5 seconds latency (parallel calls)
- [ ] At least 1 conviction layer with debate-backed confirming/invalidating signals produced
- [ ] At least 1 Ledger DCF analysis with debate injected — user-visible `## Adversarial Debate` section
- [ ] LLM cost per debate ≤ $0.01 (2x gpt-4o-mini calls)
- [ ] Debate output surfaces at least 1 point of disagreement that the primary agent addresses in its analysis

---

## Non-Goals

- **No LangGraph or external orchestration.** All orchestration is direct TypeScript function calls in the runtime binding layer.
- **No agent-to-agent conversation.** The bull and bear researchers do not talk to each other. They each receive the same input and produce independent output. Synthesis is deterministic.
- **No autonomous trading decisions.** The approval gate produces annotations, not trade orders. The user always makes the final decision.
- **No real-time memory.** Decision memory is persisted and batch-reflected. It does not update during a conversation.
- **No workspace proliferation.** Three new lightweight workspaces total (Bull Researcher, Bear Researcher, Risk Reviewer). No other workspaces are added.

---

## LLM Cost Profile

| Pattern | Model | Calls | Est. cost per call | Total |
|---------|-------|-------|--------------------|-------|
| DCF prediction logging | — | 0 (DB write) | $0 | $0 |
| DCF calibration job | — | 0 (deterministic computation) | $0 | $0 |
| Approval gate | gpt-4o-mini | 1 per analysis | ~$0.003 | $0.003 |
| Debate (bull) | gpt-4o-mini | 1 per analysis | ~$0.004 | — |
| Debate (bear) | gpt-4o-mini | 1 per analysis | ~$0.004 | — |
| **Debate total** | — | 2 | — | $0.008 |
| **Full stack (interactive)** | — | 3 additional | — | **~$0.011/analysis** |

Phase A (DCF Calibration) has **zero LLM cost** — it is entirely deterministic. Prediction logging is a DB write. Calibration comparison is arithmetic. Adjustment computation is aggregation. No LLM calls at any point.

Interactive analysis cost (Phase B + C): ~$0.011/analysis. At 50 interactive analyses/day: ~$0.55/day. Well within the existing $20/day budget.

Conviction layer cost (Phase C only, scheduled): ~$0.008/conviction update. At 160 scenarios × 1 update/day: ~$1.28/day.

---

## Phase Order And Dependencies

```
Phase A: DCF Calibration Engine (zero LLM cost, deterministic)
├── Tables: dcf_predictions, dcf_calibration_errors, dcf_calibration_adjustments
├── Prediction logging in valuation refresh + copilotTools.ts
├── Quarterly calibration batch job (deterministic)
├── Calibration adjustments fed into DCF engine
├── Prior valuations injected into Ledger prompts
└── Independently useful — starts accumulating data on next valuation refresh

Phase B: Approval Gate (deterministic engine + optional LLM annotation)
├── Risk Reviewer workspace (or deterministic runRiskReviewEngine)
├── gateService.ts
├── Wired into Ledger workflows + conviction producer
├── Produces validity flags + annotations
└── Uses calibration history from Phase A for context

Phase C: Adversarial Debate (output flows through B's gate)
├── Bull + Bear Researcher workspaces (or skill within existing workspace)
├── debateService.ts
├── Wired into Ledger workflows + conviction producer
├── Debate result → primary agent prompt → gate review
└── Most complex, highest quality improvement
```

---

## Reference Docs

| Doc | Purpose |
|-----|---------|
| `.claude/skills/pattern-detector/build-agent/SKILL.md` | Canonical agent architecture + TradingAgents comparison |
| `workspace/WORKSPACE_ARCHITECTURE.md` | Workspace system design rules |
| `backend/src/services/visionService.ts` | Runtime binding (where prompts are built) |
| `backend/src/services/copilotTools.ts` | Tool implementations (where decisions are made) |
| `backend/src/services/ledgerEngines.ts` | Engine layer (deterministic computation) |
| `.planning/plans/ACTIVE/market-intelligence-checklist.md` | MI scenario engine build state |
| `.planning/plans/ACTIVE/market-intelligence-scenario-engine-prd-pdr.md` | MI scenario engine PRD |
