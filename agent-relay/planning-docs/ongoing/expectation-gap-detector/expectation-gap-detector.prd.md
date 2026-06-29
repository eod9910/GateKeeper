# PRD: Expectation Gap Detector — Proactive Social Narrative Surfacing

Checklist: expectation-gap-detector-checklist.md

Status: Active
Date: 2026-05-29

## Origin story (the motivating example)

While reading the SOCIAL BUZZ panel for **ResMed (RMD)**, a post mentioned **Ozempic / GLP-1**.
The operator did not understand why a weight-loss drug would move a sleep-apnea
device company. The **Ledger** agent explained the causal chain:

> GLP-1 drugs (Ozempic, Wegovy, Mounjaro, Zepbound) cause weight loss → obesity is
> a major driver of obstructive sleep apnea → therefore the market fears long-term
> CPAP demand erosion → RMD sells off on *feared future impairment*, even though
> current filings (Rev +10.8%, GM 62%, FCF ~$1.66B, net cash ~$1.16B) show **no
> damage yet**.

That gap — **narrative moving faster than financial evidence** — is exactly the
signal we want to surface *before it becomes common knowledge*.

The problem: the operator only found it by manually reading posts and asking.
**The AI should have flagged it automatically.**

## Product decision

Build an **always-on social-narrative analyst** that:

1. Continuously scans incoming social buzz (the same feed the Scanner shows).
2. **Recognizes substantive, non-obvious business theses** buried in the noise
   (causal claims about a company's future), and discards the chatter.
3. Cross-checks each thesis against the company's **point-in-time financial
   reality** to compute an **Expectation Gap**.
4. **Auto-flags / highlights** the high-gap cases to the operator, with a plain-
   English explanation and a bull/bear + disconfirming-evidence test.

Name in the system: **Expectation Gap Detector** (alt labels: Narrative vs
Evidence Divergence, Pre-Consensus Mispricing Finder).

## Core thesis

> Surface expectation gaps: cases where consensus belief is changing faster than
> business reality, the business is financially durable, and the next 2–6 quarters
> are likely to reveal whether the market is *early* or *wrong*.

We are NOT building: generic value screens, low-P/E lists, hype-story finders, or
post-hoc explanations of already-well-known themes.

## What already exists (≈70% of the machine)

| Framework layer | Existing component |
|---|---|
| 1. Narrative pressure | `backend/scripts/run_eigen_perturbation_lab.py` (convergence engine, `social_context`, `narrative_only`); catalyst hunt `GET /convergence/:symbol/catalyst`; live buzz via `GET /api/fundamentals/:symbol/buzz` |
| 2. Financial confirmation | `backend/services/fundamentalsService.py`, `backend/services/fundamentals_pit_query.py` (**point-in-time** = what numbers showed *when* the narrative hit) |
| 3. Expectation gap | `backend/scripts/build_universe_valuation_snapshot.py` (DCF fair-value vs price), `run_valuation_gap_accuracy_study.py`, options flow (`optionsFlowDb`), squeeze/float/short metrics |
| 4. Time-to-proof | `run_forward_tracking.py`, `run_eigen_replay_study.py` |
| 5. Disconfirming evidence (bull/bear) | The Ledger agent (`ledgerEngines.ts`, `ledgerWorkspaceSkills.ts`, `market-intelligence-investigation` skill) |

## What is missing (the ≈30% to build)

### A. Narrative Thesis Extractor (the new core)
A pass that reads social posts for a symbol and classifies each as either:
- **noise** (price targets, emojis, RSI/MACD bot posts, recap lists, generic
  hype/fear), or
- **thesis** — a concrete causal claim about the business
  ("X external force → affects company economics via mechanism Y").

For each detected thesis, extract: `claim`, `mechanism`, `external_driver`
(e.g. "GLP-1 drugs"), `direction` (bull/bear), `specificity` score, and
`source_posts[]`. Theses must be deduplicated and clustered (many posts, one idea).

This runs as enrichment after social collection (batch) AND is available on-demand
in the catalyst hunt. Noise is dropped; only theses move forward.

### B. Expectation Gap Score
Per (symbol, thesis):

```
narrative_intensity =
    w1 * buzz_zscore (mention velocity/accel, from ticker_buzz_scores)
  + w2 * price_drawdown_or_runup vs sector
  + w3 * positioning (put/call skew, short interest, squeeze)
  + w4 * thesis_specificity (how concrete/causal the claim is)

fundamental_confirmation =
    PIT trend of { revenue growth, gross margin, FCF, bookings/retention,
                   balance-sheet strength } in the narrative's claimed direction

expectation_gap = narrative_intensity - fundamental_confirmation
```

High positive gap = story is ahead of the evidence → candidate to surface.

### C. Ledger Classifier Pass
A Ledger investigation that, for each high-gap candidate, produces the A–F output
(below) and assigns ONE classification tag, applying the false-positive filters.

### D. Surfacing / Auto-Flag
- A highlighted **alert row / badge** on the Convergence Scoreboard ("⚠ Expectation
  Gap: narrative ahead of evidence").
- Optionally a dedicated "Expectation Gaps" view ranked by gap score.
- The flag is generated automatically by the batch pass — the operator does NOT
  have to click to discover it.

## Output format (per surfaced case)

- **A. Narrative** — what the market currently believes (the thesis, plain English).
- **B. Evidence** — what reported numbers / filings show right now (PIT).
- **C. Mismatch** — why narrative and evidence are not aligned.
- **D. Why this may be early** — why the opportunity exists before it is well known.
- **E. Confirm / invalidate** — the next KPIs, filings, quarters, or customer
  signals that would resolve it.
- **F. Classification** — exactly one of:
  - Narrative ahead of damage
  - Narrative ahead of improvement
  - Hype ahead of economics
  - Fear ahead of evidence
  - Recovery before recognition
  - Real risk, but likely over-discounted
  - Real excitement, but likely over-earned in price

## Ranking logic (surface highest when most are true)

1. Narrative is strong and widely repeated
2. Financial evidence is weak/contradictory to the narrative
3. Balance sheet strong enough to survive the debate
4. Cash flow quality is real
5. Business model is understandable
6. Next 2–6 quarters can resolve the disagreement
7. Positioning suggests crowding / panic / premature certainty
8. Valuation moved materially without equivalent operating change

## False positives to suppress

Do NOT surface when:
- the business is already clearly deteriorating
- leverage creates a binary outcome
- accounting quality is poor
- valuation depends on fantasy assumptions
- the company needs financing soon
- the "mispricing" is just a low-quality business getting exposed
- the narrative is not actually affecting expectations or price
- the thesis is just noise (no causal mechanism)

## Ledger system prompt (draft)

> You are a market-intelligence analyst monitoring social buzz in real time. Your
> job is NOT to summarize chatter. Your job is to detect, inside noisy social
> posts, a **material non-consensus thesis** about a company's future — a concrete
> causal claim (external driver → mechanism → business impact) — and judge whether
> the market narrative is moving faster than the company's financial evidence.
>
> Ignore: price targets, emojis, RSI/MACD bot posts, recap lists, generic
> hype/fear with no mechanism. Keep only posts that argue a real business cause.
>
> For each thesis: state the claim and mechanism; pull the company's point-in-time
> revenue/margin/FCF/balance-sheet trend; decide whether the feared/hyped outcome
> is visible in the numbers YET. Force a bull AND bear test and actively search for
> disconfirming evidence. Output A–F as specified and assign exactly one
> classification tag. If it is just noise or the business is already clearly broken,
> say so and do not surface it.

## Build phases

- **Phase 1 — Thesis Extractor**: classify social posts (noise vs thesis), cluster
  theses, persist to a `narrative_theses` table. Reuse the live buzz feed.
- **Phase 2 — Gap Score**: join thesis intensity with PIT fundamental trend;
  compute `expectation_gap`; persist.
- **Phase 3 — Ledger Classifier**: A–F + tag + false-positive filters.
- **Phase 4 — Auto-Flag UI**: highlight gap rows on the Convergence Scoreboard
  and/or a dedicated ranked view; no click required to discover.
- **Phase 5 — Forward tracking**: feed resolved cases into `run_forward_tracking.py`
  to learn whether the detector was early or wrong (calibration).

## Open questions

- Weights (w1–w4) — start heuristic, calibrate against forward outcomes in Phase 5.
- Thesis extraction model: cheap classifier first-pass + LLM only on survivors
  (cost control, since this runs over the whole buzz feed).
- Alert threshold / dedup cadence so the board is not noisy.
