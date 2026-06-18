# Freight Method vs. Our Consumer Cycle Page

> Methodology comparison. Source: video transcript "Americans Are About to Get a Lot Richer" (Maxonomics) vs. the repo Consumer Cycle page (`backend/src/services/consumerCycleService.ts` monitor, `backend/scripts/run_consumer_cycle_category_study.py` classifier, `backend/scripts/run_consumer_cycle_adapter.py` macro bridge, `frontend/public/consumer-cycle.html`).
>
> A live Cursor canvas version of this also exists at `~/.cursor/projects/<workspace>/canvases/freight-signal-vs-consumer-cycle.canvas.tsx`. This Markdown is the portable, versioned copy.

## Shared DNA — and the one big divergence

Both the creator and our page run on the **revealed-preference** principle ("measure what people do, not what they say") and both go straight to **primary official data**. Our BEA chain-type quantity indices are literally revealed consumption.

The divergence is the **instrument**:

- **He** uses **leading, weekly, un-fakeable flow/price** data (flatbed rates, tender rejections) with spatial + network + falsification reasoning to catch a regime turning **up**.
- **We** use **lagging, quarterly, revised** consumption quantities with fixed-threshold green→red scoring to catch a slowdown turning **down**.

| | His freight signal | Our BEA series |
|---|---|---|
| Latency | Leading | Lagging |
| What it catches | Inflection ↑ | Slowdown ↓ |

## How the creator builds his read (11 strategic features)

| Category | Strategic feature | What he actually does in the video |
|---|---|---|
| Epistemics | Revealed preference > stated preference | "What people SAY means almost nothing; what people DO can't be faked." Truckers paid 2x = companies revealing they MUST move goods. Netflix password crackdown → record sign-ups. |
| Epistemics | Falsification by elimination | Rules out each alternative cause for the freight spike: fewer trucks? (no) · diesel? (only 8%) · tariff front-running? (no) — until one explanation survives. |
| Epistemics | Primary-source triangulation + humility | Goes straight to the data owner (Craig Fuller / FreightWaves). States what would change the view: "could be noise… but it might be." |
| Signal pick | Hard, un-fakeable flow/price data | Flatbed truck rates + tender-rejection rate as a transaction-level, real-money signal. Prices and rejections can't be spun. |
| Signal pick | Leading + high-frequency over lagging | Weekly freight activity leads the economy; the coastal/consumer import map is the old, slow, lagging picture he deliberately abandons. |
| Structure | Spatial / geographic regime map | Reads WHERE activity happens. 30 yrs: coasts heat first (import-led). Today: the I-35 corridor / old rust belt is red-hot (domestic production-led) → a regime change, not a level change. |
| Structure | Pipeline / network full-pipe logic | Freight = the pipes between businesses (mine → smelter → factory → site). Every pipe full + flatbed rejections at 50% ⇒ the industrial economy is cooking. |
| Structure | Temporary vs. structural persistence test | Flatbeds are pneumatic and hyper-reactive — temporary shocks resolve in 1–2 weeks. Sustained rejection ⇒ "not situational, this is fundamental." |
| Synthesis | Cross-domain convergence | Independent threads all point the same way: freight + rail carloads + chemical/grain 20-yr highs + Caterpillar backlog + hyperscaler capex + cheap nat-gas energy. |
| Synthesis | Causal mechanism chain | Builds the WHY: hyperscaler AI capex → cash redistributed across the economy → industrial build-out. Not correlation — a transmission story. |
| Synthesis | Black-swan / base-rate framing | Watches for the dot that lands outside the certainty curve. Anchors the AI productivity curve against the internet adoption curve to gauge regime magnitude. |

## Head-to-head: his method vs. our page

| Dimension | Maxonomics freight method | Our Consumer Cycle page | Status |
|---|---|---|---|
| Core epistemic stance | Track what people DO (freight $ spent, rejections). | BEA chain-type quantity indices = revealed real consumption. Same philosophy. | Aligned |
| Source discipline | Goes to the data owner (FreightWaves). | Pulls FRED/BEA primary series directly (`DMOTRA3Q086SBEA`, `USRECQ`…). We ARE the primary source. | Aligned |
| Signal latency / cadence | Leading, weekly, real-time, un-revised. | Lagging, quarterly, heavily revised. Coincident-to-lagging by construction. | Gap |
| Spatial / regime detection | Geographic heatmap reveals import-led → domestic-production-led regime flip. | None. Category time-series only — no "where / what kind of economy" dimension. | Gap |
| Network / linkage logic | Full-pipe B2B reasoning across the supply chain. | Categories scored independently (autos, furnishings, housing…). No inter-linkage. | Partial |
| Temporary vs. structural gate | Explicit persistence test before calling it fundamental. | YoY + QoQ-annualized gives some persistence, but the adapter fires a macro signal on *any* status change. | Partial |
| Causal attribution | Eliminates alternative causes; builds a transmission chain. | Fixed threshold scoring (green→red). No causal attribution of WHY a bucket moved. | Gap |
| Cross-domain convergence | Freight + rail + capex + productivity + energy. | Within-consumer convergence (4 buckets) + 2 companions. Wider cross-confirm lives in Market Intelligence, not this page. | Partial |
| Directional bias | Symmetric toolkit, here catching an UP inflection (renaissance). | Asymmetric DOWN — built to flag slowdown / "pockets that crack first." Blind to acceleration. | Gap |
| Epistemic humility | Explicit confidence language + falsifiers. | Deterministic thresholds, no confidence band or "what would change this." | Partial |

### Where we already match him
- **Revealed preference:** BEA real quantity indices measure actual consumption, not survey sentiment.
- **Primary source:** we pull FRED/BEA series directly — no vendor middle-layer to spin them.
- **Early-warning weighting:** autos are weighted 2× as "the first place cyclical pressure shows up," echoing his lead-indicator instinct.

### Where we diverge from him
- **Latency:** quarterly + revised vs. his weekly, real-time freight.
- **No spatial / network read:** we score categories in isolation; he reads the geography and the full supply pipe.
- **One-directional:** the page is a slowdown detector and is structurally blind to the kind of UP regime change the video is about.

## What this suggests we build into the page

| Priority | Upgrade | Why it matters |
|---|---|---|
| High | Add a leading freight/rail layer | Cass Freight Index, ATA truck tonnage, AAR rail carloads, tender-rejection proxies. This is the video's entire edge — un-fakeable and weeks-to-months ahead of the quarterly BEA series we rely on. |
| High | Make the monitor symmetric | Surface UP-inflections (industrial acceleration), not just deterioration. The same toolkit that catches a slowdown caught this renaissance — we currently only watch the downside. |
| Med | Add a temporary-vs-structural gate to the adapter | Require persistence / multi-series confirmation before `run_consumer_cycle_adapter.py` injects a macro signal — mirror his 1–2 week reactivity test so single noisy prints don't spawn scenarios. |
| Med | Cross-domain convergence score | Confirm consumer-cycle moves against independent un-fakeable signals (rail, capex, insider/Form-4, options) before raising conviction — the convergence engine already exists in Market Intelligence. |
| Low | Causal / regime label | Tag whether demand is import-led vs domestic-production-led (his spatial insight, expressed as a composition signal) so the page reads regime, not just level. |
