"""
Synthetic Base Calibration
==========================
Generates synthetic OHLCV series with known bases, runs the
rdp_wiggle_base_primitive detector on them, and reports a confidence score.

This is the core experiment loop:
  1. Generate synthetic chart with a known base (ground truth)
  2. Run wiggle base detector with given parameters
  3. Score: did it find the base that we put there?
  4. Repeat N times with varied noise/shape to get confidence %

Usage:
    cd backend/services
    python ../scripts/synthetic_base_calibration.py

Or with custom params:
    python ../scripts/synthetic_base_calibration.py --trials 500 --noise 0.4 --seed 42
"""
from __future__ import annotations

import argparse
import math
import random
import sys
import os
from dataclasses import dataclass
from datetime import date, timedelta
from typing import List, Optional, Tuple

# ── Make backend/services importable ─────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVICES = os.path.join(_HERE, "..", "services")
_PLUGINS  = os.path.join(_SERVICES, "plugins")
sys.path.insert(0, _SERVICES)
sys.path.insert(0, _PLUGINS)

from ohlcv import OHLCV


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1: Synthetic Chart Generator
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class SyntheticBase:
    """Ground truth for a generated chart."""
    bars: List[OHLCV]
    base_start_idx: int   # first bar of the base
    base_end_idx: int     # last bar of the base (before breakout)
    anchor_price: float   # floor price (lowest point of the base)
    cap_price: float      # ceiling price (highest point inside the base)
    n_prebase_bars: int   # how many bars before the base
    n_base_bars: int      # how many bars in the base
    label: str            # human-readable description


def _make_timestamps(n: int, start_date: date = date(2020, 1, 6)) -> List[str]:
    """Generate weekly ISO timestamps (Mondays)."""
    out = []
    d = start_date
    for _ in range(n):
        out.append(d.isoformat())
        d += timedelta(weeks=1)
    return out


def _make_bar(
    timestamp: str,
    open_: float,
    close: float,
    atr: float,
    noise: float,
    rng: random.Random,
) -> OHLCV:
    """Build one realistic OHLCV bar from open/close + noise."""
    # Realistic wick extension above/below body
    wick_up   = atr * noise * abs(rng.gauss(0, 0.5))
    wick_down = atr * noise * abs(rng.gauss(0, 0.5))
    high  = max(open_, close) + wick_up
    low   = min(open_, close) - wick_down
    # Ensure OHLCV constraints
    high  = max(high, max(open_, close))
    low   = min(low,  min(open_, close))
    vol   = max(1.0, rng.gauss(1_000_000, 200_000))
    return OHLCV(
        timestamp=timestamp,
        open=round(open_, 4),
        high=round(high, 4),
        low=round(low, 4),
        close=round(close, 4),
        volume=round(vol, 0),
    )


def _generate_leg(
    start_price: float,
    end_price: float,
    n_bars: int,
    atr: float,
    noise: float,
    prev_close: float,
    timestamps: List[str],
    ts_offset: int,
    rng: random.Random,
    probe_rate: float = 0.0,
    base_floor: Optional[float] = None,
    base_cap: Optional[float] = None,
) -> Tuple[List[OHLCV], float]:
    """
    Generate n_bars OHLCV bars moving linearly from start_price to end_price.
    Returns (bars, last_close).
    probe_rate: fraction of bars that get wick probes outside base_floor/base_cap
    """
    bars: List[OHLCV] = []
    cur_open = prev_close

    for i in range(n_bars):
        t = (i + 1) / n_bars
        # Linear interpolation + small Gaussian noise on close
        raw_close = start_price + (end_price - start_price) * t
        raw_close += rng.gauss(0, atr * noise * 0.3)
        raw_close = max(raw_close, 0.01)

        bar = _make_bar(
            timestamps[ts_offset + i],
            cur_open,
            raw_close,
            atr,
            noise,
            rng,
        )

        # Add probe wicks (wicks that poke out of the base but close inside)
        if probe_rate > 0 and rng.random() < probe_rate and base_floor is not None:
            probe_size = atr * rng.uniform(0.2, 0.6)
            if rng.random() < 0.5:
                # probe below floor
                bar = OHLCV(
                    timestamp=bar.timestamp,
                    open=bar.open,
                    high=bar.high,
                    low=min(bar.low, base_floor - probe_size),
                    close=bar.close,
                    volume=bar.volume,
                )
            elif base_cap is not None:
                # probe above cap
                bar = OHLCV(
                    timestamp=bar.timestamp,
                    open=bar.open,
                    high=max(bar.high, base_cap + probe_size),
                    low=bar.low,
                    close=bar.close,
                    volume=bar.volume,
                )

        bars.append(bar)
        cur_open = raw_close + rng.gauss(0, atr * noise * 0.1)

    return bars, bars[-1].close if bars else start_price


def generate_synthetic_base(
    center_price: float = 100.0,
    atr_ref_pct: float = 0.04,          # pre-base leg size as % of price
    n_prebase_legs: int = 4,             # large legs before the base
    n_base_legs: int = 8,                # wiggles inside the base
    base_amp_ratio: float = 0.25,        # base leg size = base_amp_ratio * atr_ref
    alternation_purity: float = 0.90,    # 1.0 = perfect alternation, 0.5 = random
    noise_level: float = 0.3,            # candle noise as fraction of atr
    probe_rate: float = 0.08,            # fraction of base bars with wick probes
    bars_per_leg: int = 5,               # approximate bars per leg
    n_breakout_legs: int = 3,            # legs after the base going up
    breakout_amp_ratio: float = 2.5,     # breakout leg size relative to atr_ref
    seed: Optional[int] = None,
) -> SyntheticBase:
    """
    Generate a synthetic OHLCV series with a geometrically defined base.

    Structure:
        [downtrend / pre-base regime]  →  [BASE wiggles]  →  [breakout impulse]

    The base is the "objective reality": the ground truth region the detector
    must find.
    """
    rng = random.Random(seed)
    atr = center_price * atr_ref_pct   # absolute ATR reference

    all_bars: List[OHLCV] = []
    ts_cursor = 0

    # ── Phase 1: Pre-base regime (larger legs to establish reference) ─────────
    # Mix up/down legs with large amplitude to simulate a prior trend/decline
    price = center_price * rng.uniform(1.3, 1.6)  # start above center
    prebase_bars = n_prebase_legs * bars_per_leg
    total_bars_est = prebase_bars + n_base_legs * bars_per_leg + n_breakout_legs * bars_per_leg + 60
    timestamps = _make_timestamps(total_bars_est + 60)

    prev_close = price
    prebase_dir = -1  # start going down into the base
    for i in range(n_prebase_legs):
        # Random amplitude: 1.5x to 3x the reference ATR
        amp = atr * rng.uniform(1.5, 3.0)
        # Last couple legs decelerate (setting up for the base)
        if i >= n_prebase_legs - 2:
            amp *= 0.6
        end_price = prev_close + prebase_dir * amp
        end_price = max(end_price, center_price * 0.5)  # don't go negative
        leg_bars, prev_close = _generate_leg(
            prev_close, end_price, bars_per_leg, atr, noise_level,
            prev_close, timestamps, ts_cursor, rng,
        )
        all_bars.extend(leg_bars)
        ts_cursor += bars_per_leg
        prebase_dir *= -1

    n_prebase_bars = len(all_bars)

    # Snap to base anchor — the floor of the base is around center_price
    # Allow some randomness so it's not always exactly center_price
    base_floor = center_price * rng.uniform(0.95, 1.05)
    base_amp = atr * base_amp_ratio        # amplitude of each base wiggle leg
    base_height = base_amp * rng.uniform(1.8, 3.0)  # how tall the base box is
    base_cap = base_floor + base_height

    # Bridge from last prebase leg to the base floor
    if prev_close > base_floor + atr * 0.5:
        bridge_bars, prev_close = _generate_leg(
            prev_close, base_floor, bars_per_leg, atr, noise_level,
            prev_close, timestamps, ts_cursor, rng,
        )
        all_bars.extend(bridge_bars)
        ts_cursor += bars_per_leg
        n_prebase_bars = len(all_bars)

    # ── Phase 2: Base (wiggles) ───────────────────────────────────────────────
    base_start_idx = len(all_bars)
    base_price = base_floor
    direction = 1  # start going up from floor

    for i in range(n_base_legs):
        # Alternation purity: occasionally don't flip direction
        if i > 0 and rng.random() > alternation_purity:
            # Same direction as previous (degrades alternation)
            pass  # direction unchanged
        else:
            direction *= -1 if i > 0 else 1

        # Amplitude: small, bounded, with some randomness
        amp = base_amp * rng.uniform(0.6, 1.4)

        # Compute target — clamp to stay within base box
        target = base_price + direction * amp
        target = max(target, base_floor - base_amp * 0.2)  # allow mild floor probes
        target = min(target, base_cap  + base_amp * 0.2)  # allow mild cap probes

        leg_bars, prev_close = _generate_leg(
            base_price, target,
            rng.randint(max(2, bars_per_leg - 2), bars_per_leg + 3),
            atr, noise_level, prev_close, timestamps, ts_cursor, rng,
            probe_rate=probe_rate,
            base_floor=base_floor,
            base_cap=base_cap,
        )
        all_bars.extend(leg_bars)
        ts_cursor += len(leg_bars)
        base_price = target

    base_end_idx = len(all_bars) - 1

    # ── Phase 3: Breakout impulse ─────────────────────────────────────────────
    breakout_amp = atr * breakout_amp_ratio
    bo_price = prev_close
    for i in range(n_breakout_legs):
        end_bo = bo_price + breakout_amp * rng.uniform(0.8, 1.2)
        leg_bars, bo_price = _generate_leg(
            bo_price, end_bo, bars_per_leg, atr, noise_level * 0.8,
            bo_price, timestamps, ts_cursor, rng,
        )
        all_bars.extend(leg_bars)
        ts_cursor += bars_per_leg

    label = (
        f"base_legs={n_base_legs} amp_ratio={base_amp_ratio:.2f} "
        f"alt={alternation_purity:.2f} noise={noise_level:.2f} probe={probe_rate:.2f}"
    )

    return SyntheticBase(
        bars=all_bars,
        base_start_idx=base_start_idx,
        base_end_idx=base_end_idx,
        anchor_price=base_floor,
        cap_price=base_cap,
        n_prebase_bars=n_prebase_bars,
        n_base_bars=base_end_idx - base_start_idx + 1,
        label=label,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2: Detection & Scoring
# ═══════════════════════════════════════════════════════════════════════════════

def _run_detector(
    bars: List[OHLCV],
    eps_coarse: float = 0.05,
    eps_fine: float = 0.017,
    window_n: int = 7,
    persist_m: int = 2,
    wiggle_thresh: float = 0.45,
    k_expand: float = 2.0,
    use_local_atr: bool = True,
    local_atr_window: int = 20,
) -> dict:
    """Run the wiggle base primitive and return the best candidate result."""
    import io
    from rdp_wiggle_base_primitive import run_rdp_wiggle_base_primitive_plugin

    spec = {
        "setup_config": {
            "epsilon_coarse": eps_coarse,
            "epsilon_fine": eps_fine,
            "window_n": window_n,
            "persist_m": persist_m,
            "wiggle_threshold": wiggle_thresh,
            "k_expand": k_expand,
            "max_marked_events": 5,
            "use_local_atr": use_local_atr,
            "local_atr_window": local_atr_window,
        }
    }
    try:
        # Suppress verbose RDP / swing structure output to stderr
        _old_stderr = sys.stderr
        sys.stderr = io.StringIO()
        try:
            candidates = run_rdp_wiggle_base_primitive_plugin(
                data=bars,
                structure=None,
                spec=spec,
                symbol="SYNTH",
                timeframe="W",
            )
        finally:
            sys.stderr = _old_stderr
        if candidates:
            return candidates[0]
    except Exception as e:
        return {"error": str(e)}
    return {}


def _score_detection(
    result: dict,
    truth: SyntheticBase,
    tolerance_bars: int = 10,
) -> dict:
    """
    Compare detector output to ground truth.

    Returns a score dict:
      found       - detector fired at all
      qualified   - base was marked as qualified
      anchor_ok   - detected floor is within tolerance of true floor
      timing_ok   - qualify_idx falls within the base window
      wiggle      - WIGGLE score (0 if not found)
    """
    if not result or "error" in result:
        return {"found": False, "qualified": False, "anchor_ok": False,
                "timing_ok": False, "wiggle": 0.0, "error": result.get("error", "no result")}

    ports = result.get("output_ports", {}).get("rdp_wiggle_base", {})
    events = ports.get("events", [])
    qualified_events = [e for e in events if e.get("qualify_idx") is not None]

    found = len(events) > 0
    qualified = len(qualified_events) > 0

    anchor_ok = False
    timing_ok = False
    wiggle = 0.0

    if qualified_events:
        # Pick the best qualified event (first = most recent anchor)
        best = qualified_events[0]
        detected_floor    = best.get("anchor_price", 0)
        anchor_idx_abs    = best.get("anchor_idx", 0)   # absolute bar index
        qualify_idx_rel   = best.get("qualify_idx", -1) # RELATIVE to anchor
        wiggle            = best.get("wiggle", 0.0) or 0.0

        # Convert qualify_idx to absolute bar index
        qualify_idx_abs = anchor_idx_abs + qualify_idx_rel if qualify_idx_rel >= 0 else -1

        # Anchor price check: detected floor within 5% of true floor
        floor_err_pct = abs(detected_floor - truth.anchor_price) / truth.anchor_price
        anchor_ok = floor_err_pct < 0.05

        # Timing check: qualify_idx (absolute) falls inside the base window
        timing_ok = (
            truth.base_start_idx - tolerance_bars
            <= qualify_idx_abs
            <= truth.base_end_idx + tolerance_bars
        )

    return {
        "found": found,
        "qualified": qualified,
        "anchor_ok": anchor_ok,
        "timing_ok": timing_ok,
        "wiggle": wiggle,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3: Trial Runner
# ═══════════════════════════════════════════════════════════════════════════════

def run_trials(
    n_trials: int = 200,
    noise_range: Tuple[float, float] = (0.2, 0.6),
    alt_range: Tuple[float, float] = (0.75, 1.0),
    base_legs_range: Tuple[int, int] = (6, 12),
    amp_ratio_range: Tuple[float, float] = (0.15, 0.35),
    probe_rate: float = 0.08,
    detector_params: Optional[dict] = None,
    seed: int = 0,
    verbose: bool = True,
) -> dict:
    """
    Run N trials with randomly varied synthetic base parameters.
    Reports confidence scores and failure analysis.
    """
    rng = random.Random(seed)
    params = detector_params or {}

    results = []
    for i in range(n_trials):
        noise      = rng.uniform(*noise_range)
        alt        = rng.uniform(*alt_range)
        n_legs     = rng.randint(*base_legs_range)
        amp_ratio  = rng.uniform(*amp_ratio_range)

        truth = generate_synthetic_base(
            center_price=100.0,
            noise_level=noise,
            alternation_purity=alt,
            n_base_legs=n_legs,
            base_amp_ratio=amp_ratio,
            probe_rate=probe_rate,
            seed=rng.randint(0, 999_999),
        )
        result = _run_detector(truth.bars, **params)
        score  = _score_detection(result, truth)

        results.append({
            "trial": i,
            "params": {
                "noise": round(noise, 3),
                "alt": round(alt, 3),
                "n_legs": n_legs,
                "amp_ratio": round(amp_ratio, 3),
            },
            **score,
        })

        if verbose and (i + 1) % 50 == 0:
            n_ok = sum(1 for r in results if r["timing_ok"])
            print(f"  Trial {i+1:4d}/{n_trials}  timing_ok so far: {n_ok}/{i+1} ({n_ok/(i+1)*100:.1f}%)")

    # ── Summary ───────────────────────────────────────────────────────────────
    n = len(results)
    found_pct    = sum(1 for r in results if r["found"])    / n * 100
    qual_pct     = sum(1 for r in results if r["qualified"]) / n * 100
    anchor_pct   = sum(1 for r in results if r["anchor_ok"]) / n * 100
    timing_pct   = sum(1 for r in results if r["timing_ok"]) / n * 100
    avg_wiggle   = sum(r["wiggle"] for r in results) / n

    # Failures: timing_ok=False but found=True (found something, wrong place)
    wrong_place  = sum(1 for r in results if r["found"] and not r["timing_ok"])
    missed       = sum(1 for r in results if not r["found"])

    summary = {
        "n_trials": n,
        "found_pct": round(found_pct, 1),
        "qualified_pct": round(qual_pct, 1),
        "anchor_ok_pct": round(anchor_pct, 1),
        "timing_ok_pct": round(timing_pct, 1),
        "avg_wiggle_score": round(avg_wiggle, 3),
        "missed_count": missed,
        "wrong_place_count": wrong_place,
        "results": results,
    }

    return summary


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4: CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════════

def _print_summary(summary: dict) -> None:
    print("\n" + "=" * 60)
    print("SYNTHETIC BASE CALIBRATION RESULTS")
    print("=" * 60)
    print(f"  Trials run          : {summary['n_trials']}")
    print(f"  Found (any event)   : {summary['found_pct']}%")
    print(f"  Qualified (wiggle)  : {summary['qualified_pct']}%")
    print(f"  Anchor price OK     : {summary['anchor_ok_pct']}%")
    print(f"  Timing OK (in base) : {summary['timing_ok_pct']}%   << PRIMARY METRIC")
    print(f"  Avg WIGGLE score    : {summary['avg_wiggle_score']:.3f}")
    print(f"  Missed entirely     : {summary['missed_count']}")
    print(f"  Found but wrong loc : {summary['wrong_place_count']}")
    print("=" * 60)

    timing_pct = summary["timing_ok_pct"]
    if timing_pct >= 80:
        verdict = "PASS — detector is reliable on synthetic data."
    elif timing_pct >= 60:
        verdict = "PARTIAL — detector finds bases but misses ~{:.0f}%. Tune parameters.".format(100 - timing_pct)
    else:
        verdict = "FAIL — detector is unreliable. Parameters need significant work."
    print(f"\nVerdict: {verdict}\n")


def main():
    parser = argparse.ArgumentParser(description="Synthetic base calibration loop")
    parser.add_argument("--trials",    type=int,   default=200,  help="Number of Monte Carlo trials")
    parser.add_argument("--noise-min", type=float, default=0.2,  help="Min candle noise level")
    parser.add_argument("--noise-max", type=float, default=0.6,  help="Max candle noise level")
    parser.add_argument("--seed",      type=int,   default=0,    help="Random seed")
    parser.add_argument("--eps-coarse",type=float, default=0.05)
    parser.add_argument("--eps-fine",  type=float, default=0.017)
    parser.add_argument("--window-n",  type=int,   default=7)
    parser.add_argument("--persist-m", type=int,   default=2)
    parser.add_argument("--wiggle-thresh", type=float, default=0.45)
    parser.add_argument("--k-expand",  type=float, default=2.0)
    parser.add_argument("--quiet",     action="store_true", help="Suppress trial-by-trial progress")
    args = parser.parse_args()

    detector_params = {
        "eps_coarse": args.eps_coarse,
        "eps_fine":   args.eps_fine,
        "window_n":   args.window_n,
        "persist_m":  args.persist_m,
        "wiggle_thresh": args.wiggle_thresh,
        "k_expand":   args.k_expand,
    }

    print(f"Running {args.trials} trials  seed={args.seed}  noise=[{args.noise_min},{args.noise_max}]")
    print(f"Detector params: {detector_params}\n")

    summary = run_trials(
        n_trials=args.trials,
        noise_range=(args.noise_min, args.noise_max),
        detector_params=detector_params,
        seed=args.seed,
        verbose=not args.quiet,
    )
    _print_summary(summary)


if __name__ == "__main__":
    main()
