# Scanner Fundamentals Industrialization Plan

Status: Active  
Owner: Scanner / Fundamentals / Copilot  
Last Updated: 2026-03-11

## Purpose

Raise the scanner fundamentals stack from a useful tactical snapshot into a durable, typed, explainable, testable subsystem.

This plan covers:

- backend fundamentals schema
- factor scoring and interpretation
- scanner UI structure
- copilot context structure
- historical financial depth
- service/runtime hardening

## Current Problem

The current scanner fundamentals panel is better than the old Yahoo-style summary, but it is not yet industrial-grade.

What is good today:

- survivability, growth trend, squeeze pressure, catalyst, and dilution are already scored
- Stockdex enrichment adds recent insider trades, earnings history, growth estimates, price/momentum context, and institutional holders
- the scanner copilot receives that enriched snapshot

What is still weak:

- `stockdex` is a loose, untyped object
- most new sections are display-only, not factor inputs
- scraped upstream keys are used directly in the frontend
- market-context data is mixed into fundamentals without a clean boundary
- long-history financial series are not actually normalized yet
- the route still spawns Python per request

## Current State

### Existing scored factors

These are real score inputs now:

- survivability
- growth trend
- squeeze pressure
- catalyst
- dilution risk

### Existing display-only or AI-only enrichments

These are visible or passed to the copilot, but not meaningfully scored yet:

- earnings history
- insider trades
- growth estimates
- top institutional holders
- 50-day / 200-day moving average
- 52-week range context

## Core Design Decision

The scanner should separate three layers:

1. `Fundamentals`
   - reported business quality and financial durability
2. `Positioning / Event Context`
   - insider activity, earnings timing, financing risk
3. `Market Context`
   - short float, relative volume, 52-week location, 50/200-day trend context

The scanner UI can show all three, but the data model should stop pretending they are the same thing.

## Product Decisions

### Keep and promote into scoring

- earnings history
- insider activity
- growth estimates

### Keep but classify as market context, not fundamentals

- 50-day moving average
- 200-day moving average
- 52-week high/low and 52-week change
- average volume / relative volume

### Keep but demote to research-only or collapsed detail

- top institutional holders

Reason:
- useful for AI summary or discretionary context
- weak direct scanner signal
- high noise / low tactical edge relative to screen real estate

## Target Information Architecture

The scanner fundamentals payload should normalize into explicit typed sections.

```ts
interface ScannerFundamentalsV3 {
  symbol: string;
  asOf: string | null;
  freshness: {
    fetchedAt: string | null;
    sourceStatus: Record<string, 'ok' | 'partial' | 'failed'>;
    stale: boolean;
  };
  sources: {
    yfinance: boolean;
    stockdex: boolean;
    macrotrends: boolean;
  };
  fundamentals: {
    survivability: SurvivabilityBlock;
    reportedExecution: ReportedExecutionBlock;
    forwardExpectations: ForwardExpectationsBlock;
    valuation: ValuationBlock;
  };
  positioning: {
    insiderActivity: InsiderActivityBlock;
    financingRisk: FinancingRiskBlock;
    earningsEvent: EarningsEventBlock;
  };
  marketContext: {
    squeeze: SqueezeBlock;
    priceTrend: PriceTrendBlock;
    rangeContext: RangeContextBlock;
  };
  scoring: {
    survivability: FactorScore;
    reportedExecution: FactorScore;
    forwardExpectations: FactorScore;
    positioning: FactorScore;
    marketContext: FactorScore;
    dilutionPenalty: FactorScore;
    tactical: FactorScore;
  };
  tags: FundamentalsTag[];
  interpretation: {
    quality: string;
    tacticalGrade: string;
    holdContext: string;
    riskNote: string;
    statusNote: string;
  };
  researchOnly?: {
    topInstitutionalHolders?: InstitutionalHolder[];
    rawSourcePayloads?: Record<string, unknown>;
  };
}
```

## Factor Model

### 1. Survivability

Inputs:

- total cash
- total debt
- operating cash flow TTM
- free cash flow TTM
- quarterly cash burn
- cash runway quarters
- current ratio
- quick ratio
- cash as % of market cap

Purpose:

- answers whether the company can survive long enough for the chart thesis to matter

### 2. Reported Execution

Inputs:

- revenue YoY / QoQ
- EPS YoY / QoQ
- EPS surprise
- sales surprise
- gross margin
- operating margin
- profit margin
- earnings beat history over last 4-8 quarters

Derived features to add:

- `earnings_beat_streak_4q`
- `sales_beat_streak_4q`
- `earnings_miss_streak_4q`
- `avg_eps_surprise_4q`
- `avg_sales_surprise_4q`
- `execution_consistency_score`

Purpose:

- answers whether the company is actually executing, not just printing one nice quarter

### 3. Forward Expectations

Inputs:

- current quarter growth estimate
- next quarter growth estimate
- current year estimate
- next year estimate
- later: estimate revision trend if source quality is acceptable

Derived features to add:

- `forward_growth_positive`
- `forward_growth_accelerating`
- `forward_growth_dispersion_flag`
- `forward_expectation_score`

Purpose:

- answers whether the forward story supports continuation or is already deteriorating

### 4. Positioning / Event Context

Inputs:

- recent insider purchases vs sales
- insider net activity
- recent financing flag
- dilution flag
- earnings date proximity
- last report recency

Derived features to add:

- `insider_buy_count_90d`
- `insider_sell_count_90d`
- `insider_buy_sell_ratio_90d`
- `insider_net_buy_signal`
- `earnings_event_risk_bucket`

Purpose:

- answers whether management behavior and event timing support or threaten the setup

### 5. Market Context

Inputs:

- short float
- short ratio
- float size
- relative volume
- 50-day moving average
- 200-day moving average
- current price vs 50-day / 200-day
- 52-week position

Derived features to add:

- `price_above_50dma`
- `price_above_200dma`
- `50dma_above_200dma`
- `position_in_52w_range_pct`
- `squeeze_context_score`

Purpose:

- answers whether the chart has contextual fuel, but should not be mislabeled as pure fundamentals

## Score Construction

### New tactical score breakdown

Replace the current opaque blend with explicit weighted factors:

- survivability: `25%`
- reported execution: `25%`
- forward expectations: `15%`
- positioning / event context: `15%`
- market context: `20%`
- dilution penalty: subtractive, capped

### Tactical grade

Suggested initial buckets:

- `>= 75`: `Tactical Strong`
- `60-74`: `Watchlist`
- `45-59`: `Speculative`
- `< 45`: `Fragile`

### Explainability requirement

Every factor must emit:

- score
- top positive drivers
- top negative drivers
- missing-data flags

The UI and copilot should never have to infer why a score was assigned.

## UI Plan

### Scanner panel hierarchy

Top summary row:

- Tactical Grade
- Tactical Score
- Earnings / Event Risk
- Insider Signal

Primary cards:

- Survivability
- Reported Execution
- Forward Expectations
- Positioning / Event Risk
- Market Context

Collapsed sections:

- Top Institutional Holders
- Raw source provenance / diagnostics

### Card-level rules

- show factor score and mini explanation at the top of each card
- use consistent positive / warning / danger tones
- stop mixing valuation, squeeze, and growth details inside one generic block
- keep recent quarter tables compact and scannable

### Copilot context rules

The copilot should receive:

- typed factor scores
- top 2-3 drivers per factor
- event-risk bucket
- insider summary
- last 4 quarters summarized

The copilot should not depend on raw scraped source keys.

## Historical Data Plan

### Phase A: Normalize recent history first

Normalize:

- last 8-12 quarters of revenue / EPS / surprise history
- last 4 annual periods where available

This should be source-agnostic in the final payload.

### Phase B: Add true deep history

Goal:

- 5-10 year annual financial history
- enough depth for regime-style business assessment, not just recent quarters

Candidate source:

- Macrotrends or equivalent

Requirements:

- source timestamp
- parse reliability monitoring
- browser/scraper dependency handled explicitly
- graceful degradation if unavailable

### Important distinction

Until deep history is normalized and typed, do not market the panel as full historical financial analysis.

## Backend Plan

### Phase 1: Schema normalization

Files:

- `backend/services/fundamentalsService.py`
- `backend/src/types/fundamentals.ts`
- `backend/src/services/contractValidation.ts`

Tasks:

- replace loose `stockdex` dependency in the frontend with normalized backend sections
- preserve raw payloads only under `researchOnly`
- add `asOf`, `fetchedAt`, and per-source status

### Phase 2: Factorization and scoring

Tasks:

- add `reportedExecutionScore`
- add `forwardExpectationsScore`
- add `positioningScore`
- revise tactical score composition
- add explicit factor explanation fields

### Phase 3: UI rewrite

Files:

- `frontend/public/index.js`
- `frontend/public/ai-chat.js`

Tasks:

- rebuild scanner panel from normalized blocks
- remove direct references to raw Stockdex key names
- collapse institutional holders
- make market context visually distinct from fundamentals

### Phase 4: Historical depth

Tasks:

- add normalized annual history
- add 8-12 quarter normalized series
- wire optional Macrotrends or alternative deep-history source

### Phase 5: Runtime hardening

Files:

- `backend/src/routes/fundamentals.ts`

Tasks:

- stop spawn-per-request if possible
- move toward a cached service path or long-lived worker
- add freshness cache policy and source diagnostics

## Testing Plan

### Backend fixtures

Create golden fixtures for at least:

- clean grower
- cash-burn biotech
- squeeze candidate
- serial diluter
- post-earnings failure

### Tests required

- payload normalization tests
- factor score tests
- missing-data fallback tests
- source partial-failure tests
- UI render tests where practical
- copilot snapshot formatting tests

## Acceptance Criteria

This plan is done when:

1. the scanner panel is driven by a typed V3 fundamentals payload
2. earnings history, insider activity, and growth estimates materially affect factor scores
3. market context is visually and semantically separated from fundamentals
4. institutional holders are no longer a primary scanner section
5. deep-history support is either shipped or explicitly feature-flagged as unavailable
6. raw upstream scrape keys no longer appear in frontend rendering code
7. tactical score is fully explainable factor-by-factor

## Recommended Build Order

1. normalize payload and types
2. add factor scoring for earnings history / insider activity / growth estimates
3. rewrite scanner panel around factor blocks
4. update copilot snapshot to use normalized factors
5. add historical-depth pipeline
6. harden runtime delivery and caching

## Practical Recommendation

If only one slice is tackled first, do this:

- normalize the backend payload
- score earnings history + insider activity + forward estimates
- demote institutional holders

That gives the biggest quality jump with the least wasted UI churn.
