# PIT valuation-gap accuracy — directionally informative but weak; overvalued-short is the better half

- Date: 2026-05-30 (also earlier runs 2026-04-10)
- Question: Is a point-in-time DCF valuation gap directionally informative at all,
  and does it move toward fair value within the horizon?
- Script: `backend/scripts/run_valuation_gap_accuracy_study.py`
- Outputs: `backend/data/research/valgap_baseline_monthly_summary.json`,
  `valgap_de_monthly_summary.json` (D/E-filtered variant),
  `valuation_gap_grouped_summary.json/.md`
- Data: clean universe, monthly rebalances, gap threshold ±20%. 3,134 symbols with
  observations, **127,903 observations**. Coverage skews overvalued: undervalued
  40,560 / roughly-fair 14,870 / **overvalued 72,473**; median gap **−36%** (the DCF
  reads most of the universe as richly priced).

## Result (rule: long undervalued, short overvalued, skip roughly-fair)
| Horizon | Win rate | Expectancy %/signal | Undervalued avg fwd | Overvalued avg fwd (median) |
|---|---:|---:|---:|---:|
| 21d | 52.7% | +0.62% | +1.19% | −0.29% (med −1.36%) |
| 63d | 53.8% | +1.57% | +3.63% | −0.42% (med −2.67%) |

- Directional accuracy hovers **0.51–0.55** — better than a coin flip but modest.
- The **overvalued short side** has the cleaner *median* (clearly negative:
  −1.4% @21d, −2.7% @63d), while undervalued long has a positive *mean* but a slightly
  negative median (a few big winners carry it — right-skew).
- `hit_fair_value_rate` is tiny (<4%) — prices rarely reach the DCF target inside the
  horizon; this is a drift/direction signal, not a price-target signal.
- The D/E-filtered monthly variant produced essentially the same directional profile
  (filtering on debt/equity didn't add a distinct edge in this cut).

## Conclusion
The DCF gap is **weakly directionally informative**, with the short-the-overvalued
half being the more reliable (median) side — consistent with the fade thesis. It is
not strong enough to trade alone; it earns its keep as a *leg* in composites
(fade = overvalued + stretched + crowd/insider). Mean-vs-median divergence on the
long side warns against equal-weighting undervalued names naively.
