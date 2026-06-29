# VIAV uptick attribution — a real revenue kernel, blown into a narrative-driven overshoot

- Date: 2026-05-31
- Question: VIAV's weekly chart shows a huge recent uptick. Using everything we have
  (price, eigen scores, financial data, options, crowd/narrative), what *caused* the
  surge? Is it earnings, or something else?
- Script(s) / tools:
  - `backend/scripts/run_eigen_perturbation_lab.py` (eigen residual-z, valuation gap,
    options flow, price-extension z, fade composite, crowd sentiment overlays)
  - `backend/data/fundamentals-pit.sqlite` → `pit_statement_facts` (revenue, net income)
  - `backend/data/market-intelligence.sqlite` → `mi_convergence`, `mi_narrative_theses`
  - `backend/data/universe/VIAV_1d.csv` (price)
- Data window: price 2021-02 → 2026-05; fundamentals FY2021 → FY2026 Q (Dec 2025).

## The move
VIAV (Viavi Solutions, formerly JDS Uniphase) ran from a **$6.66 trough (2024-06-26)
to $48.56 (2026-05-29) — +629%**, peaking $55.33 on 2026-05-01. The parabola is
recent: flat ~$9–12 through 2024 and most of 2025, then ignition:

| Month | Close | | Month | Close |
|---|---:|---|---|---:|
| 2025-08 | 11.28 | | 2026-01 | 24.46 |
| 2025-09 | 12.69 | | 2026-02 | 29.71 |
| 2025-10 | 17.70 | | 2026-03 | 33.28 |
| 2025-11 | 17.94 | | 2026-04 | 52.40 |
| 2025-12 | 17.82 | | 2026-05 | 48.56 |

## What the evidence says caused it

**1. A real revenue kernel (the seed of truth).** Quarterly revenue accelerated on
AI-datacenter optical / network-test demand:
- Q end 2024-12: $270.8M → Q end 2025-12: **$369.3M (+36% YoY)**, the strongest print
  in the series. So there *is* a genuine fundamental inflection — demand is real.

**2. But the move overshot the fundamentals by an order of magnitude.**
- The company is **losing money and the losses are widening**: net income Q end
  2025-12 = **−$48.1M** (vs −$1.8M and +$9.1M in prior quarters). Revenue is up;
  profit is negative.
- Annual revenue is still only ~$1.08B (FY2025), *below* the FY2022 peak ($1.29B).
- A +629% price move on +36% revenue growth and negative earnings is, by definition,
  **multiple expansion (re-rating), not an earnings-driven move.**

**3. Our valuation + positioning signals confirm narrative/euphoria, not value.**
- **DCF gap: −80% (overvalued)**, quality grade high, operating-company DCF.
- **Price-extension: +3.48σ above its own long-term log-price trend** → state `extended`.
- **Options: call-heavy** (call/put 1.47, "elevated" tier) — bullish positioning.
- **Crowd: 80% bullish (n=122)**, prior window 93% bullish → euphoric.
- **Narrative/thesis (mi_narrative_theses):** *"surge in AI infrastructure demand …
  driving growth in optical testing services … expected to significantly increase
  VIAV's revenue … analysts raised price targets."* The story is the AI-optical re-rate.

**4. Eigen did NOT cause/flag this — and that's consistent with our prior studies.**
- Current eigen residual-z = **0.41σ** (not anomalous). Eigen catches the *ignition*
  of an idiosyncratic move, not an established multi-month trend. By the time the move
  is this mature, eigen has gone quiet — matching `run_eigen_valuation_study` (eigen is
  a short-lived momentum/ignition signal, not a trend or reversal signal).

## Conclusion
**Earnings did not cause the uptick.** The cause is a *narrative re-rating*: a real but
small revenue acceleration (AI-optical demand) was amplified by momentum, heavy call
buying, and an 80%-bullish crowd into a **+629% multiple expansion that ran far ahead of
the (still-negative) earnings.** This is a textbook expectation gap — and because the
overshoot is now extreme, the system classifies VIAV as a **high-confidence FADE
candidate**, not a long:

> fade = candidate (high): DCF −80%; price +3.5σ vs trend; crowd 80% bull (n=122);
> timing = **retest** — retested the prior high ($55.33), now $48.56 (−12% off peak),
> armed, watch for rejection.

Practical read: the long thesis (real demand) is *true*, but price has already paid for
years of it and then some. The tradeable edge here is the short/fade setup on a confirmed
rejection of the retest — not chasing the breakout.
