#!/usr/bin/env python3
"""
Pattern Scanner — compatibility shim.

All functionality has been decomposed into focused modules:
  ohlcv.py          — OHLCV dataclass, data fetching, caching
  rdp.py            — RDP swing detection algorithm with caching
  swing_structure.py — Swing structure, trend classification, regime detection
  energy.py         — Energy state, selling/buying pressure
  fib_analysis.py   — Fibonacci retracement levels and signals
  copilot.py        — Trading co-pilot, Wyckoff patterns, base detection, CLI

This file re-exports every public symbol so that existing
``from patternScanner import X`` statements continue to work.
"""

# ── Data layer ────────────────────────────────────────────────────────────────
from platform_sdk.ohlcv import (                          # noqa: F401
    OHLCV,
    _detect_intraday,
    _format_chart_time,
    _SCANNER_DEBUG,
    fetch_data_yfinance,
    load_cached_data,
    save_to_cache,
    cache_needs_refresh,
    merge_new_bars,
    aggregate_bars,
    load_data_from_csv,
    get_cache_path,
    get_refresh_interval_seconds,
)

# ── RDP swing detection ──────────────────────────────────────────────────────
from platform_sdk.rdp import (                            # noqa: F401
    precompute_rdp_for_backtest,
    clear_rdp_precomputed,
    clear_rdp_cache,
    rdp_cache_stats,
    detect_swing_highs_lows,
    detect_swings_rdp,
    detect_relative_swing_points,
)

# ── Swing structure & trend classification ────────────────────────────────────
from platform_sdk.swing_structure import (                # noqa: F401
    ConfirmedSwingPoint,
    SwingStructure,
    _build_swing_structure,
    detect_confirmed_swing_points,
    detect_swing_points_with_fallback,
    serialize_swing_structure,
    _linear_regression_slope,
    detect_regime_windows,
    find_major_peaks,
)

# ── Energy & pressure ────────────────────────────────────────────────────────
from platform_sdk.energy import (                         # noqa: F401
    EnergyState,
    SellingPressure,
    calculate_selling_pressure,
    calculate_buying_pressure,
    calculate_energy_state,
    detect_energy_swings,
)

# ── Fibonacci analysis ────────────────────────────────────────────────────────
from platform_sdk.fib_analysis import (                   # noqa: F401
    FibonacciLevel,
    FibEnergySignal,
    calculate_fib_energy_signal,
)

# ── Co-pilot, patterns, CLI ──────────────────────────────────────────────────
from platform_sdk.copilot import (                        # noqa: F401
    Base,
    Markup,
    Pullback,
    PatternCandidate,
    generate_copilot_analysis,
    WyckoffPattern,
    detect_wyckoff_patterns,
    serialize_wyckoff_pattern,
    detect_accumulation_bases,
    detect_markup,
    detect_second_pullback,
    calculate_soft_score,
    scan_for_patterns,
    serialize_candidate,
    scan_discount_zone,
    main,
)

# Allow CLI usage: python patternScanner.py --symbol ...
if __name__ == "__main__":
    main()
