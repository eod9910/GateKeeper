# Bases — the detector caught tops, not bases; no forward edge

- Date: ~2026-05-27
- Question: Can we systematically find price *bases* (long sideways consolidation
  AFTER a decline) and profit from the breakout — the classic "don't buy the base,
  buy the breakout" setup?
- Script: `backend/scripts/run_base_method_suite.py` (centralized base-detection
  methods, side-by-side) + eigen-volume base hunting on the convergence board.

## Result
- **What the detectors surfaced were mostly *tops*, not bases.** A consolidation after
  a run-UP (distribution) looks structurally similar to a consolidation after a
  decline (accumulation) to a naive detector — but they're opposites. We were
  catching post-run-up consolidations that tend to precede *falls*.
- **No reliable forward edge from "base" candidates.** Visually validated examples did
  not line up with the detector output (e.g. the textbook 2023→2024 fall→sideways→
  breakout base was not what the scanner flagged).
- **One intriguing exception:** OBV/volume-based "base→markup" (the SOC example, OBV
  2.6→9.9) — a name no chart-reader would have bought that worked — hinted that
  *volume accumulation* inside a base carries more information than price shape. This
  fed directly into the breakout + Real-Volume study (which DID find an edge).

## Conclusion
**Bases don't work as a standalone price-shape signal** — the detector can't reliably
distinguish accumulation bases from distribution tops, and the candidates carried no
forward edge. We abandoned base-shape detection as a primary signal. The salvageable
insight — *volume confirmation* — was carried forward into `2026-05-28-breakout-volume.md`
(Real Volume separates winning breakouts from losing ones). Eigen, separately, was
found to flag *tops/ignition* better than bottoms (see eigen replay).
