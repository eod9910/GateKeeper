"""
Grid search over wiggle base detector parameters.
Finds the combination that maximises timing_ok % on synthetic data.

Usage (from backend/services):
    py ../scripts/grid_search_base.py
"""
from __future__ import annotations
import itertools
import os
import sys

_HERE    = os.path.dirname(os.path.abspath(__file__))
_SVC     = os.path.join(_HERE, "..", "services")
_PLUGINS = os.path.join(_SVC, "plugins")
sys.path.insert(0, _SVC)
sys.path.insert(0, _PLUGINS)
sys.path.insert(0, _HERE)

from synthetic_base_calibration import run_trials

# ── Parameter grid ────────────────────────────────────────────────────────────
GRID = {
    "eps_fine":      [0.010, 0.013, 0.017, 0.022],
    "window_n":      [5, 6, 7, 8],
    "wiggle_thresh": [0.30, 0.38, 0.45],
    "persist_m":     [1, 2],
}
TRIALS_PER_COMBO = 150
SEED = 42

# ─────────────────────────────────────────────────────────────────────────────

def main():
    keys   = list(GRID.keys())
    combos = list(itertools.product(*[GRID[k] for k in keys]))
    total  = len(combos)
    print(f"Grid search: {total} combinations x {TRIALS_PER_COMBO} trials each")
    print(f"Total synthetic charts: {total * TRIALS_PER_COMBO:,}")
    print()

    results = []
    for i, combo in enumerate(combos):
        params = dict(zip(keys, combo))
        det = {
            "eps_coarse":   0.05,
            "eps_fine":     params["eps_fine"],
            "window_n":     params["window_n"],
            "persist_m":    params["persist_m"],
            "wiggle_thresh": params["wiggle_thresh"],
            "k_expand":     2.0,
        }
        s = run_trials(
            n_trials=TRIALS_PER_COMBO,
            seed=SEED,
            detector_params=det,
            verbose=False,
        )
        results.append((s["timing_ok_pct"], params, s))

        # Progress every 24 combos (25%)
        if (i + 1) % 24 == 0 or (i + 1) == total:
            done = i + 1
            best_so_far = max(r[0] for r in results)
            print(f"  [{done:3d}/{total}]  best timing so far: {best_so_far:.1f}%")

    results.sort(key=lambda x: -x[0])

    print()
    print("=" * 72)
    print("TOP 10 PARAMETER SETS")
    print("=" * 72)
    fmt = "{:>3}  timing={:5.1f}%  qual={:5.1f}%  anchor={:5.1f}%  wiggle={:.3f}"
    p_fmt = "     eps_fine={:.3f}  window_n={}  thresh={:.2f}  persist_m={}"
    for rank, (pct, params, s) in enumerate(results[:10], 1):
        print(fmt.format(
            f"#{rank}", pct,
            s["qualified_pct"], s["anchor_ok_pct"], s["avg_wiggle_score"]
        ))
        print(p_fmt.format(
            params["eps_fine"], params["window_n"],
            params["wiggle_thresh"], params["persist_m"]
        ))
        missed = s["missed_count"]
        wrong  = s["wrong_place_count"]
        print(f"     missed={missed}  wrong_loc={wrong}")
        print()

    print("BOTTOM 3:")
    for pct, params, s in results[-3:]:
        print(f"  timing={pct:.1f}%  "
              f"eps_fine={params['eps_fine']:.3f}  "
              f"window_n={params['window_n']}  "
              f"thresh={params['wiggle_thresh']:.2f}  "
              f"persist_m={params['persist_m']}")

    best_pct, best_params, best_s = results[0]
    print()
    print("=" * 72)
    print("RECOMMENDED PARAMETERS")
    print("=" * 72)
    print(f"  epsilon_coarse  : 0.05   (unchanged)")
    print(f"  epsilon_fine    : {best_params['eps_fine']}")
    print(f"  window_n        : {best_params['window_n']}")
    print(f"  wiggle_threshold: {best_params['wiggle_thresh']}")
    print(f"  persist_m       : {best_params['persist_m']}")
    print(f"  k_expand        : 2.0    (unchanged)")
    print()
    print(f"  Confidence: {best_pct:.1f}% timing accuracy on synthetic data")
    if best_pct >= 85:
        print("  Status: READY for real-chart testing")
    elif best_pct >= 75:
        print("  Status: PARTIAL - good enough to start real-chart testing, keep tuning")
    else:
        print("  Status: NEEDS WORK - tune further before real-chart testing")

if __name__ == "__main__":
    main()
