# Consumer Cycle Page — Reference

> Durable reference for how the Consumer Cycle page is built, where its data comes from, what it assumes, and where its blind spots are. Captured so we don't have to re-derive it each session.
>
> Companion doc: `agent-relay/planning-docs/reference/freight-method-vs-consumer-cycle.md` (methodology comparison vs. the Maxonomics reindustrialization thesis).

---

## 1. Purpose & thesis

**What the page is for:** classify tradable stocks by their consumer-demand behavior across the business cycle, and run a live macro monitor of cyclical demand, so we can bias longs toward resilient areas and avoid the cyclical pockets that crack first.

**The premise it encodes (important):** *consumer demand drives the business cycle*, therefore measuring consumer demand ≈ measuring the cycle. Consumption is ~68% of GDP and has historically *led*, so this is a reasonable premise for the consumption-led regime.

**The buried assumption / known tension:** if the economy is **reindustrializing** (the leading edge of the cycle rotating from consumption to *production*: capex, industrial, freight), then consumer data becomes a *follower*, not a leader, and this page measures the variable that is demoting itself from cause to effect. The page currently has **no producer/freight layer** and is therefore structurally blind to that regime change. See the companion freight doc.

---

## 2. Where it lives (files)

| Layer | File |
|---|---|
| Frontend page | `frontend/public/consumer-cycle.html` + `frontend/public/consumer-cycle.js` |
| Route registration | `backend/src/server.ts` → `app.use('/api/consumer-cycle', …)`; page served at `GET /consumer-cycle` |
| API routes | `backend/src/routes/consumerCycle.ts` |
| Live monitor + symbol query service | `backend/src/services/consumerCycleService.ts` |
| Stock classification logic | `backend/src/services/symbolCatalog.ts` (`classifyCompanyFromSnapshot`, `bucketForCategory`) |
| Classification storage | `backend/data/symbol-catalog.sqlite` → `symbol_memberships` table |
| Offline category study | `backend/scripts/run_consumer_cycle_category_study.py` (writes to `backend/data/research/`) |
| Macro-engine bridge | `backend/scripts/run_consumer_cycle_adapter.py` |
| AI tool | `backend/src/services/copilotTools.ts` → `get_consumer_cycle_context` |
| Ledger skill | `workspace/Financial Analyst Workspace/skills/consumer-cycle-context/SKILL.md` |

---

## 3. Data source

**FRED** (Federal Reserve Economic Data, St. Louis Fed), served as plain CSV; underlying data produced by the **BEA**. No API key — public graph CSV endpoint:

```
https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES_ID>
```

All series are **quarterly, real (chain-type)** — official but lagging and revised.

### Live monitor series (`consumerCycleService.ts`, 6 series, level/chained-dollar)

| Cell | FRED ID | Group | Weight |
|---|---|---|---|
| Motor Vehicles & Parts | `DMOTRX1Q020SBEA` | cyclical_consumer | 2.0 |
| Furnishings & Household Equipment | `DFDHRX1Q020SBEA` | cyclical_consumer | 1.5 |
| Recreational Goods & Vehicles | `DREQRX1Q020SBEA` | cyclical_consumer | 1.5 |
| Transportation Services (consumer, not freight) | `DTRSRX1Q020SBEA` | cyclical_consumer | 1.0 |
| Residential Investment (housing) | `PRFIC1` | companion | 1.0 |
| Business Equipment Investment | `ND000340Q` | companion | 1.0 |

> Note: `DTRSRX1Q020SBEA` is **PCE consumer** transportation services (air travel, transit, vehicle repair) — NOT B2B freight. `PRFIC1` and `ND000340Q` are the only two producer-side (investment) series, and they are explicitly second-class "companions."

### Category-study series (`run_consumer_cycle_category_study.py`, ~14 consumer categories)

Uses the **quantity-index** variants (`...A3Q086SBEA`) for growth behavior plus level series (`...X1Q020SBEA`) for PCE share. Control series:
- `USRECQ` — NBER-based recession-quarter indicator (splits history into expansion vs. recession).
- `PCECC96` — total real PCE (denominator for each category's share of spending).

---

## 4. How the live monitor scores (the green/yellow/orange/red logic)

In `consumerCycleService.ts`. For each series it computes from the level points:
- `yoyPct` — vs. 4 quarters ago
- `qoqAnnualizedPct` — `(latest/prevQuarter)^4 − 1`
- `twoQuarterPct` — vs. 2 quarters ago (shown as "2Q TREND")

**Per-series status (`scoreSeries`), worst trigger wins:**

| Status | Severity | Condition |
|---|---|---|
| red | 3 | `yoyPct < −4` OR `qoqAnnualizedPct < −8` |
| orange | 2 | `yoyPct < 0` OR `qoqAnnualizedPct < 0` |
| yellow | 1 | `yoyPct < 2` OR `qoqAnnualizedPct < 2` (also the both-null default) |
| green | 0 | otherwise |

**Overall regime** = weighted-average severity (`averageSeverity`), mapped by `overallStatusFromSeverity`:
- `≥ 2.25` red · `≥ 1.5` orange · `≥ 0.75` yellow · else green.

Monitor result is cached **6 hours** (`?refresh=true` bypasses).

**Known scoring flaw:** a single weak quarter (`qoqAnnualized < −8`) flips a series to **red regardless of a strong YoY**. Live example below shows Business Equipment at **+8.5% YoY but red** off one −12.4% quarter — a false negative. A persistence/confirmation gate is the proposed fix.

---

## 5. The classification study (how cycle buckets are derived)

`run_consumer_cycle_category_study.py` computes, per category, YoY growth across all history, then splits quarters by `USRECQ` into expansion vs. recession averages, and takes the **spread = expansion_avg − recession_avg**.

**Cycle-bucket rules:**
- `highly_cyclical`: spread ≥ 6.0 pp
- `mildly_cyclical`: spread ≥ 3.0 pp (and not already highly cyclical)
- `stable`: spread < 3.0 pp, OR still grows through recessions (guardrail: `recession_avg ≥ 0 and spread < 3.0`)

Output: timestamped + `.latest.json`/`.latest.md` in `backend/data/research/`. Reproducible — rerun the script to refresh.

---

## 6. Stock taxonomy (the Symbol Map columns)

Per-symbol classification lives in `symbol-catalog.sqlite.symbol_memberships` (membership_type → membership_value), with identity-based inference (`classifyCompanyFromSnapshot`) as fallback/override. Fields:

| Field | Values |
|---|---|
| `consumer_cycle_bucket` | `highly_cyclical` · `mildly_cyclical` · `stable` |
| `consumer_spend_class` | `durable_goods` · `nondurable_goods` · `services` |
| `consumer_spending_category` | `motor_vehicles_parts`, `furnishings_household_equipment`, `recreational_goods_vehicles`, `transportation_services`, `other_durable_goods`, `clothing_footwear`, `business_equipment_investment`, `residential_investment`, `mixed_consumer`, `non_consumer`, … |
| `consumer_cycle_sensitivity` | `defensive` · `mildly_cyclical` · `highly_cyclical` |
| `recession_profile` | e.g. `vulnerable` · `resilient` (recession behavior) |
| `macro_regime_preference` | `prefer_in_slowdown` · `avoid_in_slowdown` |

> Coverage is currently sparse: most categories show 0 mapped symbols and Business Equipment Investment had only 1 (AVGO) in a recent view. The taxonomy scaffolding exists; the stock-level coverage does not yet.

---

## 7. API endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/consumer-cycle/monitor` (`?refresh=true`) | Live FRED monitor: per-series YoY/QoQ/2Q + status, weighted `averageSeverity`, `overallStatus`, `scoreHint`, strongest/weakest series. |
| `GET /api/consumer-cycle/summary` | KPI counts over the filtered universe (tradable stocks, slowdown longs/avoids, highly-cyclical, defensive, optionable; plus `countBy` breakdowns). |
| `GET /api/consumer-cycle/symbols` | Symbol-map rows for the table (filters: q, cycleBucket, spendClass, category, bucket, sensitivity, profile, preference, optionableOnly, limit). |

---

## 8. Macro-engine bridge (`run_consumer_cycle_adapter.py`)

Polls `/api/consumer-cycle/monitor`, compares to last-known state (stored in `market-intelligence.sqlite.schema_meta` key `consumer_cycle_state`), and on a **status change** injects `situation_signals` + `situation_evidence` into matching `market_situations` (creating a scenario if none matches).

Series → theme map:
- `autos`, `furnishings`, `recreation`, `transport_services` → `consumer_cycle`
- `housing` → `rates_higher`
- `equipment` → `ai_capex_acceleration`

**Known flaw:** fires on **any** state change with no persistence/confirmation gate — a single noisy quarterly print can spawn a macro scenario.

---

## 9. AI / Ledger integration

- `get_consumer_cycle_context` tool (`copilotTools.ts`) combines the live monitor + a symbol's bucket/category/slowdown-preference for the chat/copilot.
- `visionService.ts` routes consumer-cycle questions to the `consumer-cycle-context` skill so the AI uses repo taxonomy rather than improvising labels.
- Ledger skill (`workspace/Financial Analyst Workspace/skills/consumer-cycle-context/SKILL.md`) teaches: state the bucket, explain slowdown behavior, treat it as macro-positioning evidence (not a replacement for filing-backed analysis), and flag conflicts between a symbol's profile and the live monitor.

---

## 10. Known limitations & gaps (the "what to improve" list)

1. **Latency:** quarterly, revised BEA data — coincident-to-lagging by construction.
2. **No producer/freight layer:** no B2B freight, rail, truck-tonnage, or price-based demand signals. The only industrial windows are 2 companion capex/housing series.
3. **One-directional:** built to flag *deterioration*; cannot express an UP-inflection or "which engine is driving the cycle."
4. **No persistence gate:** single soft quarter flips a strong-YoY series to red (Business Equipment example) and can trigger a macro scenario via the adapter.
5. **Quantity, not price:** reads consumption *quantities*, not *prices* — misses the faster revealed-preference-via-price signal (e.g. freight rates against fixed capacity = demand).
6. **Sparse stock classification coverage.**

Proposed upgrades (detail in the companion freight doc): add a leading producer/freight layer (FRED has Cass index, AAR carloads, truck tonnage — same fetch mechanism), make the monitor symmetric, add a persistence gate, add cross-domain convergence, and tag import-led vs domestic-production-led regime.

---

## 11. Live snapshot example (2026-05-30, data as of 2026-01-01 / Q4 2025)

Overall: **ORANGE**, severity 2.0, "the cycle is rolling over."

| Series | YoY | QoQ ann. | 2Q | Status |
|---|---|---|---|---|
| Motor Vehicles & Parts | −0.5% | +4.3% | −1.1% | orange |
| Furnishings & Household | −0.9% | +2.7% | +0.7% | orange |
| Recreational Goods & Vehicles | +3.3% | −7.5% | +0.3% | orange |
| Transportation Services | +4.2% | +3.7% | +1.5% | green |
| Residential Investment | −5.1% | −6.2% | −2.0% | red |
| Business Equipment Investment | +8.5% | −12.4% | −0.4% | red |

Read: genuine weakness is **housing** (red on every horizon) + softening consumer durables; the industrial/capex side (equipment +8.5% YoY) is actually the strongest by YoY but mislabeled red by the no-persistence-gate flaw. This snapshot is the concrete illustration of the limitations above.
