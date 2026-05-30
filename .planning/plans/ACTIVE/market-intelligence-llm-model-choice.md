# Market Intelligence — LLM Model Choice (v1)

> **Status:** Phase 0 deliverable. Frozen alongside the API contract for Phase 1 implementation.
> **Companion docs:**
> - `.planning/plans/ACTIVE/market-intelligence-scenario-engine-prd-pdr.md` (§LLM Usage And Cost Profile, §Conviction Producer)
> - `backend/data/scenarios/concept-extraction-prompt.json`
> - `backend/data/scenarios/conviction-templates/single_company_catalyst.json`
> - `backend/src/services/visionService.ts`, `backend/src/services/strategyGenService.ts` (existing OpenAI-native copilot infra we are reusing)

---

## 0. Why this document exists

The PRD splits LLM work across multiple sub-tasks with very different cost / quality / latency profiles. Without an explicit per-task model decision:

- We over-spend on tier-mismatched tasks (e.g. running gpt-4o on every concept extraction = $400+/day at PRD-target volume).
- We under-spend on quality-critical tasks (e.g. running gpt-4o-mini on conviction-layer synthesis = fabrication and ticker hallucination).

This document is the v1 model assignment. Each sub-task's prompt template `_meta.model_assumptions` block must reference the row in the table below.

---

## 1. Tiers (canonical names)

| Tier | OpenAI candidate models (in our copilot infra today) | Rough cost/1M input tokens | Rough cost/1M output tokens | Latency p50 | Notes |
|---|---|---|---|---|---|
| **cheap** | `gpt-4o-mini`, `gpt-5-mini`, `gpt-5.4-mini` | $0.15 | $0.60 | 1–2s | JSON-mode supported. Used by `visionService.ts` for chart-OCR-style structured extraction. |
| **mid**   | `gpt-4o`, `gpt-5`, `gpt-5.4`                | $2.50 | $10.00 | 3–6s | JSON-mode supported. Used by `strategyGenService.ts` for primitive synthesis. |
| **heavy** | `gpt-5.4-thinking`, `o1`, `o3` (when avail.) | $15.00 | $60.00 | 15–60s | Reasoning models. **Not used in v1** — see §3 deferred work. |

> Pricing is an order-of-magnitude estimate to inform tier selection — the cost-discipline ceilings in §4 win over any individual model's exact unit cost. Re-confirm against current OpenAI pricing before any production deploy.

> The candidate-models columns are intentionally a **set** per tier. The runtime picks whichever one is configured in `OPENAI_MODEL_CHEAP` / `OPENAI_MODEL_MID` env vars. We do not pin a specific model name in code — that lets us switch as OpenAI ships new minor revisions without a code change.

---

## 2. Per-task assignment

| LLM task | Tier | PRD reference | Daily call volume (target) | Daily $ ceiling | Prompt template |
|---|---|---|---|---|---|
| **Concept extraction** (D21 S2) | `cheap` | §Engine 2 — Social Arbitrage Engine, §LLM Usage (D14) | 8k–15k calls (50–80 comments per call, 30k–150k comments/day total) | $4–$12 | `backend/data/scenarios/concept-extraction-prompt.json` |
| **Conviction layer producer** (D3, D16) | `mid` | §Conviction Layer | ≤ 3 calls per scenario per week × ~50 active scenarios = ~20 calls/day | $1–$2 | `backend/data/scenarios/conviction-templates/<scenario_type>.json` |
| **LLM-assist exposure mapping** (Phase 2, §Engine 4) | `cheap` | §Exposure Mapping | ~5 calls per new scenario × ~5 new/day = ~25 calls/day | $0.10–$0.30 | TBD Phase 2 — `backend/data/scenarios/exposure-mapping-prompt.json` |
| **Macro cluster naming** (D21 M3, Phase 1.5) | `cheap` | §Engine 1 — Macro Engine | ~3–10 calls/day (one per emerging cluster) | $0.05–$0.20 | TBD Phase 1.5 — `backend/data/scenarios/macro-cluster-naming-prompt.json` |
| **Theme proposal hook** (D21 M4, Phase 1.5) | `cheap` | §Engine 1 | < 1 call/day, gated by operator review | < $0.10 | TBD Phase 1.5 |
| **Per-`primary_theme` quality dashboard summary** (Phase 5, D20) | `cheap` | §Quality and Research Loop | < 5 calls/day | < $0.05 | TBD Phase 5 |
| **Backtest narrative-quality eval** (Phase 5) | `mid` | §Quality and Research Loop | One-shot per backtest run, not daily | bounded by backtest budget | TBD Phase 5 |

**Daily steady-state total (Phase 1 + Phase 2):** $5.50 – $14.40 → comfortably under the PRD's $20/day ceiling.

---

## 3. Deliberately NOT using a heavy / reasoning model in v1

The reasoning tier (`gpt-5.4-thinking`, `o1`, `o3`) is excluded from v1 for these reasons:

1. **Latency.** Conviction-layer producer must hit < 8s p95 to feel snappy in the detail drawer. Reasoning models are 15–60s.
2. **Cost ceiling.** PRD §LLM Usage caps total LLM spend at $20/day; one heavy-tier call can be $0.40+ all by itself.
3. **Determinism.** Reasoning models exhibit higher between-run variance on JSON-mode outputs, which makes our cache-by-hash invalidation strategy (D3) less effective.

**When to revisit:** Phase 5, after the eval set is built. The per-`primary_theme` quality dashboard will tell us which scenario types have the highest false-positive rate; if it's the multi-evidence synthesis ones, we run a targeted A/B of `mid` vs `heavy` on the conviction layer for those types only.

---

## 4. Cost discipline rules (binding)

These rules are enforced by the producer code, not by the prompt:

1. **Pre-filter before LLM.** Concept extraction skips comments < 20 chars, links-only, single-emoji, or pure quote-replies. Macro cluster naming skips clusters with < 3 articles or cosine similarity < 0.7. (D14)
2. **Batch aggressively.** Concept extraction packs 50–80 comments per call. Macro cluster naming packs all candidate cluster names into one call.
3. **Registry skip.** When 100% of mentioned concepts are already in `tracked_concepts`, the inserter increments mention counts directly and skips the LLM call entirely. (D14)
4. **Cache by content hash.** Conviction layer cache key = `(situation_id, scenario_type, evidence_pack_hash, exposure_pack_hash)`. Re-computes are free until evidence changes.
5. **Daily budget hard stop.** If `llm_budget.spent_today_usd > daily_cap_usd`, every new call returns the `LLM_BUDGET_EXHAUSTED` validity flag and writes nothing.
6. **One-call-per-scenario-per-week minimum.** Conviction layer is also rate-limited to ≤ 3 calls per scenario per 7-day window even if the cache is invalidated frequently.

---

## 5. Per-task quality bars

| Task | Bar | Measured by | Action if missed |
|---|---|---|---|
| Concept extraction | False-positive rate ≤ 25% on a 200-comment manual sample | Phase 0 fixture batch (PRD §Phase 0 exit criteria) | Tighten system-prompt rule #3 ("precision over recall") and re-test |
| Conviction layer | 0 fabricated tickers in a 50-scenario sample (zero-tolerance — cited tickers MUST appear in `situation_exposure`) | Phase 1 manual review + Phase 5 CI eval | Producer rejects + retries once + flags `CONVICTION_LAYER_UNRELIABLE` |
| Conviction layer | ≥ 80% of `confirming_signals` items semantically grounded in evidence pack | Phase 5 eval on backtest corpus | Drop tier or change template, do NOT loosen producer validation |
| LLM-assist exposure mapping | Operator override rate < 30% (i.e. analysts accept the LLM-proposed mapping ≥ 70% of the time) | Operator UI logging | Switch tier or re-prompt |
| Macro cluster naming | Human readability ≥ 4/5 on a 30-cluster sample | Phase 1.5 manual review | Tighten naming constraints in prompt |

---

## 6. Operational instrumentation

The scheduler healthcheck exposes `llm_budget` (see API contract §2.9):

```jsonc
"llm_budget": {
  "daily_cap_usd": 12.0,
  "spent_today_usd": 4.30,
  "concept_extraction_calls_today": 8421,
  "exhausted": false
}
```

When `exhausted: true`, every scenario written today receives the `LLM_BUDGET_EXHAUSTED` validity flag — operators can see this from the UI.

The per-task call-count + spend breakdown lives in the (Phase 4) Settings panel; until then it's surfaced in the scheduler status JSON.

---

## 7. Open items to confirm before Phase 1 ship

1. **Confirm OpenAI account billing tier supports the projected 30k+ daily comment volume.** At $0.15/1M input tokens and ~50 tokens/comment, that's ~225k input tokens/day for concept extraction alone. Trivial against tier-1 limits, but if the account is currently on a free trial we have to migrate.
2. **Confirm `OPENAI_MODEL_CHEAP` / `OPENAI_MODEL_MID` env vars are wired through to `marketIntelligenceScheduler.ts` collectors and the (future) conviction producer.** Today they only flow through `visionService.ts` and `strategyGenService.ts`.
3. **Decide whether to allow Anthropic fallback.** Haiku-class is a comparable cheap-tier and would protect us from a single-vendor outage. v1 is OpenAI-only for simplicity; Phase 5 may add a Haiku failover.

---

## 8. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-04-27 | 1 | Initial Phase 0 freeze. |
