"""
Duration-stratified base detection test.

Tests the wiggle base detector across three duration regimes:
  - Short  bases:  30-90  bars  (~6mo - 2yr weekly)
  - Medium bases:  90-180 bars  (~2yr - 3.5yr weekly)
  - Long   bases: 180-350 bars  (~3.5yr - 7yr weekly)

Reports confidence by duration so we know exactly where things break.
Uses the best params from the grid search as baseline.
"""
from __future__ import annotations
import os
import random
import sys
from typing import List, Tuple, Optional

_HERE    = os.path.dirname(os.path.abspath(__file__))
_SVC     = os.path.join(_HERE, "..", "services")
_PLUGINS = os.path.join(_SVC, "plugins")
sys.path.insert(0, _SVC)
sys.path.insert(0, _PLUGINS)
sys.path.insert(0, _HERE)

from synthetic_base_calibration import (
    generate_synthetic_base,
    _run_detector,
    _score_detection,
)

# Best params from grid search
BEST_PARAMS = dict(
    eps_coarse=0.05,
    eps_fine=0.010,
    window_n=8,
    persist_m=2,
    wiggle_thresh=0.30,
    k_expand=2.0,
)

DURATION_BUCKETS = {
    "short  ( 30- 90 bars)": (5,  12, 4,  7),   # (n_legs_min, n_legs_max, bars_min, bars_max)
    "medium ( 90-180 bars)": (12, 25, 5,  9),
    "long   (180-350 bars)": (25, 50, 6, 10),
}

TRIALS_PER_BUCKET = 200
SEED = 99


def _tolerance_for_base(n_base_bars: int) -> int:
    """Scale timing tolerance to 15% of base length, min 8, max 40."""
    return max(8, min(40, int(n_base_bars * 0.15)))


def run_bucket(
    label: str,
    n_legs_min: int,
    n_legs_max: int,
    bars_min: int,
    bars_max: int,
    trials: int,
    seed: int,
    detector_params: dict,
) -> dict:
    rng = random.Random(seed)
    counts = {"found": 0, "qualified": 0, "anchor_ok": 0, "timing_ok": 0,
              "missed": 0, "wrong_loc": 0, "errors": 0}
    wiggle_sum = 0.0
    base_bar_lengths = []

    for _ in range(trials):
        n_legs    = rng.randint(n_legs_min, n_legs_max)
        bars_per  = rng.randint(bars_min, bars_max)
        noise     = rng.uniform(0.2, 0.55)
        alt       = rng.uniform(0.75, 1.0)
        amp_ratio = rng.uniform(0.15, 0.35)

        truth = generate_synthetic_base(
            n_base_legs=n_legs,
            bars_per_leg=bars_per,
            noise_level=noise,
            alternation_purity=alt,
            base_amp_ratio=amp_ratio,
            probe_rate=0.08,
            seed=rng.randint(0, 999_999),
        )

        n_base_bars = truth.n_base_bars
        base_bar_lengths.append(n_base_bars)
        tol = _tolerance_for_base(n_base_bars)

        result = _run_detector(truth.bars, **detector_params)
        score  = _score_detection(result, truth, tolerance_bars=tol)

        if "error" in score:
            counts["errors"] += 1
            continue

        if score["found"]:      counts["found"]      += 1
        if score["qualified"]:  counts["qualified"]  += 1
        if score["anchor_ok"]:  counts["anchor_ok"]  += 1
        if score["timing_ok"]:  counts["timing_ok"]  += 1
        if not score["found"]:  counts["missed"]     += 1
        if score["found"] and not score["timing_ok"]:
            counts["wrong_loc"] += 1
        wiggle_sum += score["wiggle"]

    n = trials - counts["errors"]
    pct = lambda k: round(counts[k] / n * 100, 1) if n > 0 else 0.0
    avg_bars = sum(base_bar_lengths) / len(base_bar_lengths) if base_bar_lengths else 0

    return {
        "label": label,
        "trials": n,
        "avg_base_bars": round(avg_bars, 1),
        "found_pct":    pct("found"),
        "qual_pct":     pct("qualified"),
        "anchor_pct":   pct("anchor_ok"),
        "timing_pct":   pct("timing_ok"),
        "missed":       counts["missed"],
        "wrong_loc":    counts["wrong_loc"],
        "avg_wiggle":   round(wiggle_sum / n, 3) if n > 0 else 0,
        "errors":       counts["errors"],
    }


def main():
    print("Duration-stratified base detection test")
    print(f"Params: eps_fine={BEST_PARAMS['eps_fine']}  window_n={BEST_PARAMS['window_n']}  "
          f"thresh={BEST_PARAMS['wiggle_thresh']}  persist_m={BEST_PARAMS['persist_m']}")
    print(f"{TRIALS_PER_BUCKET} trials per bucket\n")

    all_results = []
    for label, (nl_min, nl_max, b_min, b_max) in DURATION_BUCKETS.items():
        print(f"  Running {label} ...")
        r = run_bucket(
            label=label,
            n_legs_min=nl_min, n_legs_max=nl_max,
            bars_min=b_min, bars_max=b_max,
            trials=TRIALS_PER_BUCKET,
            seed=SEED,
            detector_params=BEST_PARAMS,
        )
        all_results.append(r)
        print(f"    avg_base_bars={r['avg_base_bars']}  timing={r['timing_pct']}%")

    print()
    print("=" * 72)
    print("RESULTS BY DURATION")
    print("=" * 72)
    print(f"{'Bucket':<26} {'timing':>7} {'qual':>7} {'anchor':>7} {'wiggle':>7} {'missed':>7} {'wrong':>7}")
    print("-" * 72)
    for r in all_results:
        verdict = "OK" if r["timing_pct"] >= 80 else ("WARN" if r["timing_pct"] >= 65 else "FAIL")
        print(
            f"{r['label']:<26} "
            f"{r['timing_pct']:>6.1f}% "
            f"{r['qual_pct']:>6.1f}% "
            f"{r['anchor_pct']:>6.1f}% "
            f"{r['avg_wiggle']:>7.3f} "
            f"{r['missed']:>7} "
            f"{r['wrong_loc']:>7}   {verdict}"
        )

    print()
    # Diagnose the main failure mode by duration
    print("DIAGNOSIS:")
    for r in all_results:
        n = r["trials"]
        fail_pct = 100 - r["timing_pct"]
        wrong_pct = round(r["wrong_loc"] / n * 100, 1)
        miss_pct  = round(r["missed"]    / n * 100, 1)
        if fail_pct < 10:
            print(f"  {r['label']}: Good. Only {fail_pct:.1f}% failure rate.")
        elif wrong_pct > miss_pct:
            print(f"  {r['label']}: Main problem = WRONG LOCATION ({wrong_pct}%). "
                  f"Detector fires but misplaced. Consider local ATR windowing.")
        else:
            print(f"  {r['label']}: Main problem = MISSED ({miss_pct}%). "
                  f"Detector doesn't fire at all. Wiggle threshold may be too strict for long duration.")

    print()
    print("IMPLICATION FOR REAL CHARTS:")
    worst = min(all_results, key=lambda r: r["timing_pct"])
    best  = max(all_results, key=lambda r: r["timing_pct"])
    print(f"  Best bucket : {best['label'].strip()}  ({best['timing_pct']}%)")
    print(f"  Worst bucket: {worst['label'].strip()}  ({worst['timing_pct']}%)")
    if worst["timing_pct"] < 70:
        print()
        print("  ACTION NEEDED: Long bases require a different strategy.")
        print("  Recommendation: use a ROLLING local ATR window for epsilon_fine")
        print("  instead of computing epsilon from the full chart price range.")
        print("  This prevents the wide pre-base range from inflating epsilon.")


if __name__ == "__main__":
    main()
