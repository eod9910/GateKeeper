"""Trading co-pilot analysis, Wyckoff patterns, base detection, and CLI."""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from uuid import uuid4

from .ohlcv import OHLCV, _detect_intraday, _format_chart_time, fetch_data_yfinance, load_data_from_csv
from .energy import (
    EnergyState, SellingPressure,
    calculate_energy_state, calculate_selling_pressure, calculate_buying_pressure,
)
from .fib_analysis import FibonacciLevel, FibEnergySignal, calculate_fib_energy_signal

_SCANNER_DEBUG = os.environ.get("SCANNER_DEBUG", "").lower() in ("1", "true", "yes")

__all__ = [
    "Base",
    "Markup",
    "Pullback",
    "PatternCandidate",
    "WyckoffPattern",
    "generate_copilot_analysis",
    "detect_wyckoff_patterns",
    "serialize_wyckoff_pattern",
    "detect_accumulation_bases",
    "detect_markup",
    "detect_second_pullback",
    "calculate_soft_score",
    "scan_for_patterns",
    "serialize_candidate",
    "scan_discount_zone",
    "main",
]


@dataclass
class Base:
    """Accumulation base structure."""
    start_index: int
    end_index: int
    low: float
    high: float
    height: float
    duration: int  # bars
    start_date: str = ""  # ISO date
    end_date: str = ""


@dataclass
class Markup:
    """Markup breakout structure."""
    breakout_index: int
    high: float
    breakout_date: str = ""  # ISO date
    high_index: int = 0
    high_date: str = ""


@dataclass
class Pullback:
    """Second pullback structure."""
    start_index: int
    low_index: int
    low: float
    duration: int  # bars
    retracement: float  # 0.0 - 1.0
    low_date: str = ""  # ISO date


@dataclass
class PatternCandidate:
    """A complete pattern candidate for labeling."""
    id: str
    symbol: str
    timeframe: str
    base: Base
    markup: Markup
    pullback: Pullback
    score: float
    created_at: str
    window_start: int
    window_end: int
    # Date range for easy display
    pattern_start_date: str = ""
    pattern_end_date: str = ""


@dataclass
class WyckoffPattern:
    """
    Complete Wyckoff-style accumulation pattern.
    
    Pattern Sequence:
    1. PRIOR PEAK - Significant high (the top to beat)
    2. DISTRIBUTION/MARKDOWN - Decline from peak (selling pressure)
    3. BASE - Accumulation zone (smart money accumulates)
    4. FIRST MARKUP - Initial breakout above base resistance
    5. SMALL PEAK - High of the first markup move
    6. PULLBACK - Deep retracement (70-100%) back toward base
       - Could be a double bottom (tests base low)
    7. SECOND BREAKOUT - The real move begins (ENTRY SIGNAL)
    
    The timeframe doesn't matter - these patterns work on any scale.
    Longer timeframes have less noise and clearer structure.
    """
    id: str
    symbol: str
    timeframe: str
    
    # Phase 1: Prior Peak (the high to eventually break)
    prior_peak_index: int
    prior_peak_price: float
    prior_peak_date: str
    
    # Phase 2: Distribution/Markdown (decline from peak)
    markdown_low_index: int
    markdown_low_price: float
    markdown_pct: float  # How much it dropped from peak (e.g., 0.50 = 50% decline)
    
    # Phase 3: Base/Accumulation (consolidation zone)
    base: Base
    
    # Phase 4 & 5: First Markup (breakout) and Small Peak
    first_markup_index: int      # When it breaks above base
    first_markup_high: float     # The "small peak" - high of this initial move
    first_markup_date: str
    
    # Phase 6: Pullback (70-100% retracement, possibly double bottom)
    pullback_low_index: int
    pullback_low_price: float
    pullback_retracement: float  # 0.70-1.00 = retraced 70-100% of first move
    pullback_date: str
    is_double_bottom: bool       # True if pullback tests/undercuts base low
    
    # Phase 7: Second Breakout (THE ENTRY SIGNAL)
    second_breakout_index: int
    second_breakout_price: float
    second_breakout_date: str
    
    score: float
    created_at: str


def generate_copilot_analysis(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    epsilon_pct: float = 0.05,
    user_direction: str = None
) -> Dict[str, Any]:
    """
    Generate a complete Trading Co-Pilot analysis.
    
    Combines:
    - Swing structure (trend identification via MAJOR or RDP mode)
    - Fibonacci levels (price zones)
    - Energy state (momentum)
    - Selling/Buying pressure (exhaustion detection)
    - Go/No-Go reasoning
    
    Args:
        user_direction: 'long', 'short', or None (auto-detect from trend).
            If provided, overrides the auto-detected trade direction.
    
    Returns a complete analysis dict with commentary.
    """
    from .rdp import detect_swings_rdp, detect_swing_highs_lows
    from .swing_structure import (ConfirmedSwingPoint, SwingStructure, _build_swing_structure,
        detect_confirmed_swing_points, detect_swing_points_with_fallback,
        serialize_swing_structure, detect_regime_windows, find_major_peaks)

    # 1. Get swing structure for trend classification
    # Always use RDP for copilot — gives user direct control via the Swing Sensitivity slider
    structure = detect_swings_rdp(
        data, symbol, timeframe,
        epsilon_pct=epsilon_pct
    )

    primary_trend = structure.primary_trend
    intermediate_trend = structure.intermediate_trend
    trend_alignment = structure.trend_alignment

    if user_direction == 'short':
        looking_for_short = True
    elif user_direction == 'long':
        looking_for_short = False
    else:
        looking_for_short = primary_trend == "UPTREND"

    trade_direction = "SHORT" if looking_for_short else "LONG"
    
    # 2. Get Fib+Energy signal
    fib_signal = calculate_fib_energy_signal(
        data, symbol, timeframe,
        proximity_pct=5.0,  # 5% proximity for copilot
        epsilon_pct=epsilon_pct,
        swing_structure=structure,
        trade_direction=trade_direction,
    )
    
    if not fib_signal:
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'verdict': 'INSUFFICIENT_DATA',
            'commentary': f"Insufficient data to analyze {symbol}."
        }
    
    # 3. Extract all the key data
    current_price = fib_signal.current_price
    retracement = fib_signal.current_retracement_pct
    energy = fib_signal.energy
    selling_pressure = fib_signal.selling_pressure
    
    # Calculate buying pressure (mirror of selling pressure)
    buying_pressure = calculate_buying_pressure(data, lookback=10)
    
    # Fib context
    range_low = fib_signal.range_low
    range_high = fib_signal.range_high
    nearest_level = fib_signal.nearest_level
    near_levels = [l for l in fib_signal.fib_levels if l.is_near]
    
    # Stop distance (direction-aware)
    # For longs: stop below range_low. For shorts: stop above range_high.
    stop_distance_pct_long = ((current_price - range_low) / current_price * 100) if range_low > 0 else 0
    stop_distance_pct_short = ((range_high - current_price) / current_price * 100) if range_high > 0 else 0
    
    # === DIRECTION-AWARE ANALYSIS ===
    # The user can override the trade direction with the Long/Short toggle.
    # If user_direction is set, we respect it regardless of detected trend.
    # If not set, we auto-detect: UPTREND → SHORT, DOWNTREND → LONG, SIDEWAYS → LONG (default).
    #
    # Trade direction logic:
    #   SHORT setup: measure BUYING pressure (are buyers still pushing?)
    #     - Low buying pressure + exhausted energy = uptrend ending = SHORT opportunity
    #     - High buying pressure + strong energy = uptrend healthy = BAD for shorts
    #   LONG setup: measure SELLING pressure (are sellers still pushing?)
    #     - Low selling pressure + exhausted energy = downtrend ending = LONG opportunity
    #     - High selling pressure + strong energy = downtrend healthy = BAD for longs
    
    # Select the RELEVANT pressure based on trade direction
    if looking_for_short:
        pressure = buying_pressure
        pressure_type = "Buying"
        pressure_label = "buyers"
        counter_label = "shorts"
    else:
        pressure = selling_pressure
        pressure_type = "Selling"
        pressure_label = "sellers"
        counter_label = "longs"
    
    # 4. Generate GO / NO-GO verdict
    # Note: "GO" means conditions favor the COUNTER-TREND entry:
    #   - In uptrend: GO = conditions favor SHORTING (buyers exhausted)
    #   - In downtrend: GO = conditions favor buying LONGS (sellers exhausted)
    go_reasons = []
    nogo_reasons = []
    
    # Check 1: Trend identification
    # If user explicitly chose a direction, trend is context (not a hard block).
    # If auto-detecting, SIDEWAYS is a nogo.
    user_chose_direction = user_direction is not None
    
    if primary_trend == "UPTREND":
        if looking_for_short:
            if intermediate_trend == "UPTREND":
                go_reasons.append(f"Trends ALIGNED upward — looking for {pressure_label} exhaustion to short into strength")
            elif intermediate_trend == "DOWNTREND":
                go_reasons.append(f"Primary UP but intermediate DOWN — pullback may already be starting")
            else:
                go_reasons.append(f"Primary trend is UPTREND — evaluating SHORT setup")
        else:
            # User wants to go LONG in an uptrend (with-trend)
            go_reasons.append(f"Primary trend is UPTREND — you're trading WITH the trend ({trade_direction})")
    elif primary_trend == "DOWNTREND":
        if not looking_for_short:
            if intermediate_trend == "DOWNTREND":
                go_reasons.append(f"Trends ALIGNED downward — looking for {pressure_label} exhaustion to buy into weakness")
            elif intermediate_trend == "UPTREND":
                go_reasons.append(f"Primary DOWN but intermediate UP — bounce may already be starting")
            else:
                go_reasons.append(f"Primary trend is DOWNTREND — evaluating LONG setup")
        else:
            # User wants to SHORT in a downtrend (with-trend)
            go_reasons.append(f"Primary trend is DOWNTREND — you're trading WITH the trend ({trade_direction})")
    elif primary_trend == "SIDEWAYS":
        if user_chose_direction:
            # User explicitly chose — warn but don't block
            nogo_reasons.append(f"Primary trend is SIDEWAYS — no clear direction, higher risk for {trade_direction}")
        else:
            nogo_reasons.append(f"Primary trend is SIDEWAYS — no clear direction, wait for breakout")
    else:
        go_reasons.append(f"Primary trend: {primary_trend}, Intermediate: {intermediate_trend}")
    
    # Check 2: Price position relative to range
    if looking_for_short:
        # UPTREND: price near the TOP (low retracement) = premium = GOOD for shorts
        if retracement < 25:
            go_reasons.append(f"Price at PREMIUM ({retracement:.0f}% retracement from high) — ideal zone to short into strength")
        elif retracement < 50:
            go_reasons.append(f"Price still in upper half ({retracement:.0f}% retracement) — reasonable short zone")
        elif retracement >= 50 and retracement <= 79:
            nogo_reasons.append(f"Price has pulled back {retracement:.0f}% — already in discount, too late to short")
        elif retracement > 79:
            nogo_reasons.append(f"Price at {retracement:.0f}% retracement — deep pullback, no short opportunity here")
    else:
        # DOWNTREND: price near the BOTTOM (high retracement) = discount = GOOD for longs
        if retracement >= 50 and retracement <= 79:
            go_reasons.append(f"Price IN DISCOUNT ({retracement:.0f}% retracement) — proper pullback into value zone")
            if near_levels:
                level_names = ", ".join(l.level_name for l in near_levels)
                go_reasons.append(f"Price at {level_names} Fibonacci level — historically significant zone")
        elif retracement > 79 and retracement <= 100:
            nogo_reasons.append(f"{retracement:.0f}% retracement — deep discount, approaching structural low (higher risk)")
            if near_levels:
                level_names = ", ".join(l.level_name for l in near_levels)
                go_reasons.append(f"Price at {level_names} Fibonacci level")
        elif retracement > 100:
            nogo_reasons.append(f"{retracement:.0f}% retracement — BELOW structural low, structure broken")
        elif retracement >= 25 and retracement < 50:
            nogo_reasons.append(f"Only {retracement:.0f}% retracement — not yet in discount zone")
        elif retracement >= 0 and retracement < 25:
            nogo_reasons.append(f"Only {retracement:.0f}% retracement — still at premium, wait for deeper pullback")
    
    if looking_for_short:
        go_reasons = [
            reason for reason in go_reasons
            if "Price at PREMIUM (" not in reason
            and "Price still in upper half (" not in reason
        ]
        nogo_reasons = [
            reason for reason in nogo_reasons
            if "too late to short" not in reason
            and "no short opportunity here" not in reason
        ]

        if retracement >= 50 and retracement <= 79:
            go_reasons.append(f"Price in premium bounce zone ({retracement:.0f}% retracement up the bearish leg) â€” proper short location")
            if near_levels:
                level_names = ", ".join(l.level_name for l in near_levels)
                go_reasons.append(f"Price at {level_names} Fibonacci level â€” historically significant short zone")
        elif retracement > 79 and retracement <= 100:
            nogo_reasons.append(f"{retracement:.0f}% retracement â€” deep bounce, close to structural high (higher risk)")
        elif retracement > 100:
            nogo_reasons.append(f"{retracement:.0f}% retracement â€” above structural high, bearish leg invalidated")
        elif retracement >= 25 and retracement < 50:
            nogo_reasons.append(f"Only {retracement:.0f}% retracement â€” bounce is still shallow for a short entry")
        elif retracement >= 0 and retracement < 25:
            nogo_reasons.append(f"Only {retracement:.0f}% retracement â€” still near the lows, do not chase weakness")

    # Check 3: Relevant pressure (buying in uptrend, selling in downtrend)
    if pressure:
        if pressure.current_pressure < 20 and pressure.pressure_trend == 'DECREASING':
            go_reasons.append(f"{pressure_type} pressure EXHAUSTED ({pressure.current_pressure:.0f}/100) and DECREASING — {pressure_label} running out of ammunition")
        elif pressure.current_pressure < 30:
            go_reasons.append(f"{pressure_type} pressure is low ({pressure.current_pressure:.0f}/100) — {pressure_label} losing momentum")
        elif pressure.current_pressure > 70 and pressure.pressure_trend == 'INCREASING':
            nogo_reasons.append(f"{pressure_type} pressure is HIGH ({pressure.current_pressure:.0f}/100) and INCREASING — {pressure_label} still in control, don't fight them")
        elif pressure.current_pressure > 50:
            nogo_reasons.append(f"{pressure_type} pressure elevated ({pressure.current_pressure:.0f}/100) — {pressure_label} still active, wait for exhaustion")
        elif pressure.pressure_trend == 'DECREASING':
            go_reasons.append(f"{pressure_type} pressure DECREASING ({pressure.current_pressure:.0f}/100) — momentum fading")
    
    # Check 4: Energy state (direction-aware interpretation)
    energy_move_dir = "UP" if looking_for_short else "DOWN"
    if energy.character_state == 'EXHAUSTED':
        go_reasons.append(f"Energy EXHAUSTED — the {energy_move_dir} move has run out of steam")
    elif energy.character_state == 'RECOVERING' and energy.direction != energy_move_dir:
        go_reasons.append(f"Energy RECOVERING in opposite direction — new counter-trend momentum entering")
    elif energy.character_state == 'RECOVERING' and energy.direction == energy_move_dir:
        nogo_reasons.append(f"Energy RECOVERING {energy_move_dir} — the trend is getting a second wind")
    elif energy.character_state == 'STRONG' and energy.direction == energy_move_dir:
        nogo_reasons.append(f"Energy STRONG {energy_move_dir} (velocity: {energy.velocity:.1f}%) — the {energy_move_dir.lower()} move is still powerful, don't fight it")
    elif energy.character_state == 'WANING' and energy.direction == energy_move_dir:
        go_reasons.append(f"{energy_move_dir} energy is WANING — the move is losing conviction")
    elif energy.character_state == 'WANING' and energy.direction != energy_move_dir:
        nogo_reasons.append(f"Counter-trend energy is WANING — reversal losing steam")
    
    # Check 5: Stop distance (direction-aware)
    if looking_for_short:
        # SHORT: stop above structural high
        stop_distance_pct = stop_distance_pct_short
        stop_ref = f"structural high ${range_high:.2f}"
    else:
        # LONG: stop below structural low
        stop_distance_pct = stop_distance_pct_long
        stop_ref = f"structural low ${range_low:.2f}"
    
    if stop_distance_pct > 50:
        nogo_reasons.append(f"Stop distance is {stop_distance_pct:.0f}% (at {stop_ref}) — very wide stop, size accordingly")
    elif stop_distance_pct > 30:
        nogo_reasons.append(f"Stop distance is {stop_distance_pct:.0f}% — wide stop required, reduce position size")
    
    # 5. Determine verdict
    # When user has explicitly chosen a direction, SIDEWAYS alone shouldn't force NO_GO
    has_hard_nogo = any("INCREASING" in r or "STRONG" in r for r in nogo_reasons)
    has_sideways_nogo = any("SIDEWAYS" in r for r in nogo_reasons)
    
    if len(nogo_reasons) == 0 and len(go_reasons) >= 3:
        verdict = "GO"
    elif len(nogo_reasons) <= 1 and len(go_reasons) >= 2:
        verdict = "CONDITIONAL_GO"
    elif len(nogo_reasons) >= 2 and has_hard_nogo:
        verdict = "NO_GO"
    elif len(nogo_reasons) >= 2 and has_sideways_nogo and not user_chose_direction:
        verdict = "NO_GO"
    elif len(nogo_reasons) >= 1:
        verdict = "WAIT"
    else:
        verdict = "WAIT"
    
    # 6. Generate commentary
    commentary_parts = []
    
    # Direction context (trade_direction already set above from user_direction or auto-detect)
    
    # Opening
    verdict_labels = {
        'GO': f'GO - Conditions favor {trade_direction} entry',
        'CONDITIONAL_GO': f'CONDITIONAL GO - Mostly favorable for {trade_direction} with caveats',
        'WAIT': f'WAIT - Conditions not yet ready for {trade_direction}',
        'NO_GO': f'NO-GO - Conditions unfavorable for {trade_direction}'
    }
    commentary_parts.append(f"TRADING CO-PILOT: {symbol} ({timeframe})")
    commentary_parts.append(f"TREND: {primary_trend} | LOOKING FOR: {trade_direction} entry")
    commentary_parts.append(f"")
    commentary_parts.append(f"VERDICT: {verdict_labels.get(verdict, verdict)}")
    commentary_parts.append(f"")
    
    # Price context
    commentary_parts.append(f"PRICE CONTEXT:")
    commentary_parts.append(f"  Current Price: ${current_price:.2f}")
    commentary_parts.append(f"  Fib Leg: ${range_low:.2f} low ({fib_signal.range_low_date}) -> ${range_high:.2f} high ({fib_signal.range_high_date})")
    commentary_parts.append(f"  Range: ${range_low:.2f} ({fib_signal.range_low_date}) → ${range_high:.2f} ({fib_signal.range_high_date})")
    commentary_parts.append(f"  Retracement: {retracement:.1f}%")
    commentary_parts.append(
        f"  Retracement Meaning: "
        f"{retracement:.1f}% {'back up from the low anchor' if looking_for_short else 'back down from the high anchor'} of that fib leg"
    )
    commentary_parts.append(f"  {pressure_type} Pressure: {pressure.current_pressure:.0f}/100 ({pressure.pressure_trend})" if pressure else "")
    commentary_parts.append(f"  Energy: {energy.character_state} ({energy.direction})")
    if nearest_level:
        commentary_parts.append(f"  Nearest Fib: {nearest_level.level_name} at ${nearest_level.price:.2f} ({nearest_level.distance_pct:.1f}% away)")
        commentary_parts.append(
            f"  Nearest Fib Meaning: {nearest_level.level_name} "
            f"{'bounce up from the low anchor' if looking_for_short else 'pullback down from the high anchor'} "
            f"of the ${range_low:.2f} -> ${range_high:.2f} fib leg"
        )
    commentary_parts.append(f"")
    
    # Reasons
    if go_reasons:
        commentary_parts.append(f"FAVORABLE (for {trade_direction}):")
        for r in go_reasons:
            commentary_parts.append(f"  ✓ {r}")
        commentary_parts.append(f"")
    
    if nogo_reasons:
        commentary_parts.append(f"UNFAVORABLE (for {trade_direction}):")
        for r in nogo_reasons:
            commentary_parts.append(f"  ✗ {r}")
        commentary_parts.append(f"")
    
    # What to watch for — direction-aware guidance
    commentary_parts.append(f"WHAT TO WATCH:")
    if verdict in ['WAIT', 'NO_GO']:
        if looking_for_short:
            # Waiting for short conditions
            if pressure and pressure.current_pressure > 30:
                commentary_parts.append(f"  → Wait for {pressure_type.lower()} pressure to drop below 30 (currently {pressure.current_pressure:.0f}) — {pressure_label} still active")
            if pressure and pressure.pressure_trend != 'DECREASING':
                commentary_parts.append(f"  → Wait for {pressure_type.lower()} pressure trend to flip to DECREASING (currently {pressure.pressure_trend})")
            if energy.character_state not in ['EXHAUSTED', 'WANING']:
                commentary_parts.append(f"  → Wait for energy to reach EXHAUSTED or WANING (currently {energy.character_state}) — the UP move must lose steam first")
            if retracement > 50:
                commentary_parts.append(f"  → Price has pulled back {retracement:.0f}% — already past premium zone, weakening the short thesis")
        else:
            # Waiting for long conditions
            if retracement < 50:
                fib_50 = next((l for l in fib_signal.fib_levels if l.level_name == '50%'), None)
                if fib_50:
                    commentary_parts.append(f"  → Price must reach 50% discount level at ${fib_50.price:.2f} (currently {retracement:.0f}%)")
            if pressure and pressure.current_pressure > 30:
                commentary_parts.append(f"  → Wait for {pressure_type.lower()} pressure to drop below 30 (currently {pressure.current_pressure:.0f})")
            if pressure and pressure.pressure_trend != 'DECREASING':
                commentary_parts.append(f"  → Wait for {pressure_type.lower()} pressure trend to flip to DECREASING (currently {pressure.pressure_trend})")
            if energy.character_state not in ['EXHAUSTED', 'RECOVERING']:
                commentary_parts.append(f"  → Wait for energy to reach EXHAUSTED or RECOVERING (currently {energy.character_state})")
    elif verdict in ['GO', 'CONDITIONAL_GO']:
        if looking_for_short:
            commentary_parts.append(f"  → {pressure_type} pressure fading, uptrend losing steam — {trade_direction} entry conditions met")
            commentary_parts.append(f"  → Set stop loss above ${range_high:.2f} (structural high)")
            stop_above = ((range_high - current_price) / current_price * 100) if current_price > 0 else 0
            commentary_parts.append(f"  → Stop distance: {stop_above:.0f}% above entry — position size accordingly")
            if fib_signal.fib_levels:
                fib_50 = next((l for l in fib_signal.fib_levels if l.level_name == '50%'), None)
                if fib_50:
                    commentary_parts.append(f"  → First target: {fib_50.level_name} at ${fib_50.price:.2f}")
        else:
            commentary_parts.append(f"  → {pressure_type} pressure fading, downtrend losing steam — {trade_direction} entry conditions met")
            commentary_parts.append(f"  → Set stop loss below ${range_low:.2f} (structural low)")
            commentary_parts.append(f"  → Stop distance: {stop_distance_pct:.0f}% — position size accordingly")
            if fib_signal.fib_levels:
                target_25 = fib_signal.fib_levels[0]  # 25% level
                commentary_parts.append(f"  → First target: {target_25.level_name} at ${target_25.price:.2f}")
    
    if looking_for_short:
        commentary_parts = [line for line in commentary_parts if "already past premium zone" not in line]
        if verdict in ['WAIT', 'NO_GO']:
            fib_50 = next((l for l in fib_signal.fib_levels if l.level_name == '50%'), None)
            if retracement < 50 and fib_50:
                commentary_parts.append(f"  -> Price must bounce into 50% premium level at ${fib_50.price:.2f} (currently {retracement:.0f}%)")
            elif retracement > 79 and retracement <= 100:
                commentary_parts.append(f"  -> Bounce is already {retracement:.0f}% of the bearish leg - wait for cleaner rejection or tighter risk")
            elif retracement > 100:
                commentary_parts.append(f"  -> Price is above the bearish leg high - short thesis is weakened until it fails back below that anchor")

    # Risk note
    commentary_parts.append(f"")
    commentary_parts.append(f"RISK:")
    if looking_for_short:
        commentary_parts.append(f"  Stop placement: Above ${range_high:.2f} (structural high)")
        stop_above = ((range_high - current_price) / current_price * 100) if current_price > 0 else 0
        commentary_parts.append(f"  Stop distance: {stop_above:.0f}% above entry")
    else:
        commentary_parts.append(f"  Stop placement: Below ${range_low:.2f} (structural low)")
        commentary_parts.append(f"  Stop distance: {stop_distance_pct:.0f}% from entry")
    
    commentary = "\n".join(commentary_parts)
    
    # 7. Build result
    # Chart data for frontend
    is_intraday = _detect_intraday(data)
    chart_data = []
    for bar in data:
        time_val = _format_chart_time(bar.timestamp, is_intraday)
        if time_val is None:
            continue
        chart_data.append({
            'time': time_val,
            'open': float(bar.open),
            'high': float(bar.high),
            'low': float(bar.low),
            'close': float(bar.close)
        })
    
    return {
        'symbol': symbol,
        'timeframe': timeframe,
        'verdict': verdict,
        'commentary': commentary,
        'current_price': current_price,
        'current_date': fib_signal.current_date,
        
        # Trade direction
        'trade_direction': trade_direction,  # 'LONG' or 'SHORT'
        
        # Trend
        'primary_trend': primary_trend,
        'intermediate_trend': intermediate_trend,
        'trend_alignment': trend_alignment,
        
        # Fib
        'range': {
            'low': range_low,
            'low_date': fib_signal.range_low_date,
            'high': range_high,
            'high_date': fib_signal.range_high_date,
            'direction': fib_signal.range_direction,
        },
        'current_retracement_pct': retracement,
        'fib_levels': [
            {
                'level': level.level_name,
                'price': level.price,
                'distance_pct': level.distance_pct,
                'is_near': level.is_near
            }
            for level in fib_signal.fib_levels
        ],
        'nearest_level': {
            'level': nearest_level.level_name,
            'price': nearest_level.price,
            'distance_pct': nearest_level.distance_pct
        } if nearest_level else None,
        
        # Energy
        'energy': {
            'character_state': energy.character_state,
            'direction': energy.direction,
            'velocity': energy.velocity,
            'acceleration': energy.acceleration,
            'range_compression': energy.range_compression,
            'energy_score': energy.energy_score
        },
        
        # Pressure (direction-aware: buying pressure in uptrends, selling pressure in downtrends)
        'pressure_type': pressure_type,  # 'Buying' or 'Selling'
        'selling_pressure': {
            'current': pressure.current_pressure,
            'peak': pressure.peak_pressure,
            'change': pressure.pressure_change,
            'trend': pressure.pressure_trend,
            'bars_since_peak': pressure.bars_since_peak_pressure,
            'history': pressure.pressure_history
        } if pressure else None,
        'buying_pressure': {
            'current': buying_pressure.current_pressure,
            'peak': buying_pressure.peak_pressure,
            'change': buying_pressure.pressure_change,
            'trend': buying_pressure.pressure_trend,
        } if buying_pressure else None,
        
        # Go/No-Go
        'go_reasons': go_reasons,
        'nogo_reasons': nogo_reasons,
        'stop_distance_pct': round(stop_distance_pct, 1),
        
        # Swing points for chart markers (date must match chart_data time format)
        'swing_points': [
            {
                'index': p.index,
                'price': p.price,
                'date': _format_chart_time(p.date, is_intraday) if p.date else None,
                'type': p.point_type
            }
            for p in structure.swing_points
        ],
        
        # Chart data
        'chart_data': chart_data
    }


def detect_wyckoff_patterns(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    config: Optional[Dict[str, Any]] = None,
    min_markdown_pct: float = 0.70
) -> List[WyckoffPattern]:
    """
    Detect Wyckoff-style accumulation patterns.
    
    Pattern sequence:
    1. Prior Peak - significant high
    2. Markdown - decline from peak (distribution)
    3. Base - accumulation zone
    4. First Markup - initial breakout above base
    5. Pullback - retracement 70-100% back toward base
    6. Second Breakout - the real move (entry signal)
    """
    from .rdp import detect_swings_rdp, detect_swing_highs_lows
    from .swing_structure import (ConfirmedSwingPoint, SwingStructure, _build_swing_structure,
        detect_confirmed_swing_points, detect_swing_points_with_fallback,
        serialize_swing_structure, detect_regime_windows, find_major_peaks)

    if config is None:
        config = {}
    
    patterns = []
    n = len(data)
    
    # Step 1: Find major peaks
    print(f"Looking for major peaks...", file=sys.stderr)
    major_peaks = find_major_peaks(data, min_prominence=0.20)
    print(f"Found {len(major_peaks)} major peaks", file=sys.stderr)
    
    for peak_idx, peak_price in major_peaks:
        print(f"\n  Analyzing peak at {peak_idx} (${peak_price:.2f}, {data[peak_idx].timestamp[:10]})", file=sys.stderr)
        
        # Step 2: Find the markdown low after the peak
        # Look for the lowest point within a reasonable window after the peak
        markdown_window = min(n, peak_idx + 300)  # Up to ~6 years on weekly
        
        markdown_low = peak_price
        markdown_low_idx = peak_idx
        
        for i in range(peak_idx + 1, markdown_window):
            if data[i].low < markdown_low:
                markdown_low = data[i].low
                markdown_low_idx = i
        
        markdown_pct = (peak_price - markdown_low) / peak_price if peak_price > 0 else 0
        
        if markdown_pct < min_markdown_pct:
            print(f"    -> Markdown only {markdown_pct:.1%}, need {min_markdown_pct:.0%}+ decline", file=sys.stderr)
            continue
        
        print(f"    -> Markdown to ${markdown_low:.2f} at {markdown_low_idx} ({markdown_pct:.1%} decline)", file=sys.stderr)
        
        # Step 3: Find base after the markdown
        # The base should form around the markdown low
        # First, find the consolidation range by looking at a window after markdown
        
        base_start = markdown_low_idx
        
        # Look for a consolidation period: scan forward and find range
        # The base ends when price makes a sustained move above the prior peak level
        # or when it breaks significantly above the consolidation range
        
        # First pass: identify the approximate base range
        # Look at first 100 bars after markdown to establish the range
        range_window = min(150, n - markdown_low_idx)
        if range_window < 30:
            print(f"    -> Not enough data after markdown", file=sys.stderr)
            continue
        
        # Find the range in the first part of the base
        initial_lows = [data[i].low for i in range(markdown_low_idx, markdown_low_idx + range_window)]
        initial_highs = [data[i].high for i in range(markdown_low_idx, markdown_low_idx + range_window)]
        
        base_low = min(initial_lows)
        base_high_initial = max(initial_highs)
        
        # The base high for breakout detection should be the resistance level
        # But we need to find where the ACTUAL breakout happens
        # A breakout is when price closes above base_high AND stays above for multiple bars
        
        base_end = None
        base_high = base_high_initial
        
        for i in range(markdown_low_idx + 20, min(markdown_low_idx + 500, n - 10)):
            bar = data[i]
            
            # Track rolling high of the consolidation
            recent_high = max(data[j].high for j in range(max(markdown_low_idx, i - 50), i + 1))
            
            # Check for breakout: 3 consecutive closes above the recent resistance
            if i + 3 < n:
                closes_above = sum(1 for j in range(i, i + 3) if data[j].close > recent_high * 0.98)
                
                if closes_above >= 3 and bar.close > base_high_initial:
                    base_end = i - 1
                    base_high = recent_high
                    break
        
        if base_end is None:
            # No breakout found, use the last available point
            base_end = min(markdown_low_idx + 400, n - 50)
            if base_end - base_start < 20:
                print(f"    -> No valid base found (no breakout)", file=sys.stderr)
                continue
        
        if base_end - base_start < 20:  # Need at least 20 bars for base
            print(f"    -> Base too short ({base_end - base_start} bars)", file=sys.stderr)
            continue
        
        base = Base(
            start_index=base_start,
            end_index=base_end,
            low=base_low,
            high=base_high,
            height=base_high - base_low,
            duration=base_end - base_start + 1,
            start_date=data[base_start].timestamp,
            end_date=data[base_end].timestamp
        )
        
        print(f"    -> Base from {base_start}-{base_end}: ${base_low:.2f}-${base_high:.2f} ({base.duration} bars)", file=sys.stderr)
        
        # Step 4: Find first markup (breakout above base)
        first_markup_idx = base_end + 1
        first_markup_high = base_high
        
        # Find the high of the first markup move
        for i in range(first_markup_idx, min(first_markup_idx + 100, n)):
            if data[i].high > first_markup_high:
                first_markup_high = data[i].high
                first_markup_idx = i
        
        print(f"    -> First markup high ${first_markup_high:.2f} at {first_markup_idx}", file=sys.stderr)
        
        # Step 5: Find pullback after first markup
        pullback_low = first_markup_high
        pullback_idx = first_markup_idx
        
        for i in range(first_markup_idx + 1, min(first_markup_idx + 150, n)):
            if data[i].low < pullback_low:
                pullback_low = data[i].low
                pullback_idx = i
        
        # Calculate retracement (how much of the first markup move was given back)
        first_move = first_markup_high - base_low
        pullback_drop = first_markup_high - pullback_low
        pullback_retracement = pullback_drop / first_move if first_move > 0 else 0
        
        # Check if it's a double bottom (pullback tests the base low)
        is_double_bottom = pullback_low <= base_low * 1.05  # Within 5% of base low
        
        print(f"    -> Pullback to ${pullback_low:.2f} ({pullback_retracement:.1%} retracement), double_bottom={is_double_bottom}", file=sys.stderr)
        
        # Filter: Accept pullbacks from 30% to 120% (springs can undercut the base)
        # The 70-79% range is the "sweet spot" for scoring, but wider range is accepted
        min_retracement = config.get('min_retracement', 0.30)  # Default: 30% minimum
        max_retracement = config.get('max_retracement', 1.20)  # Default: 120% max (allows springs)
        
        if pullback_retracement < min_retracement:
            print(f"    -> Pullback too shallow ({pullback_retracement:.1%}, need {min_retracement:.0%}+)", file=sys.stderr)
            continue
        
        if pullback_retracement > max_retracement:
            print(f"    -> Pullback too deep ({pullback_retracement:.1%}, max {max_retracement:.0%})", file=sys.stderr)
            continue
        
        # Step 6: Find second breakout after pullback
        # This is when price breaks back above the base high (or first markup high)
        second_breakout_idx = None
        second_breakout_price = None
        
        # Use base_high as the resistance level to break
        breakout_level = max(base_high, base.high)
        
        for i in range(pullback_idx + 1, min(pullback_idx + 300, n)):  # Look up to ~6 years
            if data[i].close > breakout_level * 1.02:  # Break above resistance with confirmation
                # Confirm with next bar
                if i + 1 < n and data[i + 1].close > breakout_level:
                    second_breakout_idx = i
                    second_breakout_price = data[i].close
                    break
        
        if second_breakout_idx is None:
            print(f"    -> No second breakout found", file=sys.stderr)
            continue
        
        print(f"    -> Second breakout at {second_breakout_idx} (${second_breakout_price:.2f})", file=sys.stderr)
        
        # Calculate score
        score = 0.0
        
        # Pullback retracement scoring - wider range accepted, sweet spot gets bonus
        if 0.70 <= pullback_retracement <= 0.79:
            score += 0.40  # Sweet spot - deep pullback but not quite double bottom
        elif 0.50 <= pullback_retracement < 0.70:
            score += 0.30  # Good - healthy retest
        elif 0.30 <= pullback_retracement < 0.50:
            score += 0.15  # Shallow - less convincing but still valid
        elif 0.79 < pullback_retracement <= 1.05:
            score += 0.35  # Near double bottom - very bullish
        elif pullback_retracement > 1.05:
            score += 0.20  # Spring (undercut) - bullish if reclaims
        
        # Double bottom is extra bullish (price tests base low within 5%)
        if is_double_bottom:
            score += 0.25
        
        # Longer base = stronger pattern (time builds cause)
        if base.duration >= 100:
            score += 0.20
        elif base.duration >= 50:
            score += 0.10
        
        # Clean markdown (significant decline from peak - 70%+ required)
        if markdown_pct >= 0.80:
            score += 0.20  # Excellent - 80%+ decline
        elif markdown_pct >= 0.70:
            score += 0.15  # Good - meets 70% minimum
        
        pattern_id = f"{symbol}_{timeframe}_WP_{peak_idx}_{second_breakout_idx}"
        
        pattern = WyckoffPattern(
            id=pattern_id,
            symbol=symbol,
            timeframe=timeframe,
            prior_peak_index=peak_idx,
            prior_peak_price=peak_price,
            prior_peak_date=data[peak_idx].timestamp,
            markdown_low_index=markdown_low_idx,
            markdown_low_price=markdown_low,
            markdown_pct=markdown_pct,
            base=base,
            first_markup_index=first_markup_idx,
            first_markup_high=first_markup_high,
            first_markup_date=data[first_markup_idx].timestamp,
            pullback_low_index=pullback_idx,
            pullback_low_price=pullback_low,
            pullback_retracement=pullback_retracement,
            pullback_date=data[pullback_idx].timestamp,
            is_double_bottom=is_double_bottom,
            second_breakout_index=second_breakout_idx,
            second_breakout_price=second_breakout_price,
            second_breakout_date=data[second_breakout_idx].timestamp,
            score=min(score, 1.0),
            created_at=datetime.now().isoformat()
        )
        
        patterns.append(pattern)
        print(f"    ✓ PATTERN FOUND! Score: {score:.2f}", file=sys.stderr)
    
    # Deduplicate: Keep only the highest-scoring pattern per second_breakout_index
    # This prevents multiple patterns with different prior peaks but the same breakout
    breakout_to_pattern: Dict[int, WyckoffPattern] = {}
    for pattern in patterns:
        breakout_idx = pattern.second_breakout_index
        if breakout_idx not in breakout_to_pattern or pattern.score > breakout_to_pattern[breakout_idx].score:
            breakout_to_pattern[breakout_idx] = pattern
    
    deduplicated = list(breakout_to_pattern.values())
    print(f"\nDeduplicated: {len(patterns)} patterns -> {len(deduplicated)} unique breakouts", file=sys.stderr)
    
    # Sort by score
    deduplicated.sort(key=lambda p: p.score, reverse=True)
    
    return deduplicated


def serialize_wyckoff_pattern(pattern: WyckoffPattern, data: List[OHLCV] = None) -> Dict[str, Any]:
    """Convert a WyckoffPattern to a JSON-serializable dict."""
    result = {
        'id': pattern.id,
        'symbol': pattern.symbol,
        'timeframe': pattern.timeframe,
        'pattern_type': 'wyckoff',
        
        # Prior Peak
        'prior_peak': {
            'index': pattern.prior_peak_index,
            'price': pattern.prior_peak_price,
            'date': pattern.prior_peak_date
        },
        
        # Markdown
        'markdown': {
            'low_index': pattern.markdown_low_index,
            'low_price': pattern.markdown_low_price,
            'decline_pct': pattern.markdown_pct
        },
        
        # Base
        'base': asdict(pattern.base),
        
        # First Markup (breakout above base)
        'first_markup': {
            'index': pattern.first_markup_index,
            'high': pattern.first_markup_high,
            'date': pattern.first_markup_date
        },
        
        # Small Peak (the high of the first markup move)
        'small_peak': {
            'index': pattern.first_markup_index,  # Same as markup for now
            'price': pattern.first_markup_high,
            'date': pattern.first_markup_date
        },
        
        # Pullback (70-100% retracement toward base)
        'pullback': {
            'low_index': pattern.pullback_low_index,
            'low_price': pattern.pullback_low_price,
            'retracement': pattern.pullback_retracement,
            'retracement_pct': f"{pattern.pullback_retracement * 100:.0f}%",
            'date': pattern.pullback_date,
            'is_double_bottom': pattern.is_double_bottom
        },
        
        # Second Breakout (entry signal)
        'second_breakout': {
            'index': pattern.second_breakout_index,
            'price': pattern.second_breakout_price,
            'date': pattern.second_breakout_date
        },
        
        'score': pattern.score,
        'created_at': pattern.created_at,
        
        # For compatibility with existing frontend
        'window_start': pattern.prior_peak_index,
        'window_end': pattern.second_breakout_index,
        'pattern_start_date': pattern.prior_peak_date,
        'pattern_end_date': pattern.second_breakout_date,
        'retracement_pct': pattern.pullback_retracement * 100
    }
    
    # Include chart data - show ALL available data for full context
    if data:
        # Include ALL data from beginning to end
        # This is important for long-term patterns that span years
        is_intraday = _detect_intraday(data)
        start_idx = 0  # Start from the beginning
        end_idx = len(data)  # Include everything up to present
        
        chart_data = []
        for i in range(start_idx, end_idx):
            bar = data[i]
            time_val = _format_chart_time(bar.timestamp, is_intraday)
            if time_val is not None:
                chart_data.append({
                    'time': time_val,
                    'open': float(bar.open),
                    'high': float(bar.high),
                    'low': float(bar.low),
                    'close': float(bar.close)
                })
        
        result['chart_data'] = chart_data
        
        # Indices relative to chart_data
        result['chart_prior_peak'] = pattern.prior_peak_index - start_idx
        result['chart_markdown_low'] = pattern.markdown_low_index - start_idx
        result['chart_base_start'] = pattern.base.start_index - start_idx
        result['chart_base_end'] = pattern.base.end_index - start_idx
        result['chart_first_markup'] = pattern.first_markup_index - start_idx
        result['chart_markup_high'] = pattern.first_markup_index - start_idx  # Alias for frontend compatibility
        result['chart_pullback_low'] = pattern.pullback_low_index - start_idx
        result['chart_second_breakout'] = pattern.second_breakout_index - start_idx
    
    return result


def detect_accumulation_bases(
    data: List[OHLCV],
    min_duration: int = 15,  # minimum bars for a base (reduced for weekly data)
    max_duration: int = 500,  # maximum bars for a base (increased for macro patterns)
    max_range_pct: float = 0.80,  # max range as % of base midpoint (relaxed for commodities)
    volatility_threshold: float = 0.10  # max avg bar range (relaxed)
) -> List[Base]:
    """
    Detect accumulation bases (range-bound, volatility-compressed zones).
    
    A base is valid if:
    - Duration >= min_duration bars
    - Price range is within max_range_pct of midpoint
    - Volatility is compressed
    """
    bases = []
    n = len(data)
    
    # Sliding window to find range-bound periods
    for start in range(0, n - min_duration):
        for end in range(start + min_duration, min(start + max_duration, n)):  # configurable max
            window = data[start:end + 1]
            
            # Calculate range
            window_high = max(bar.high for bar in window)
            window_low = min(bar.low for bar in window)
            height = window_high - window_low
            midpoint = (window_high + window_low) / 2
            
            if midpoint == 0:
                continue
            
            range_pct = height / midpoint
            
            # Calculate volatility (average bar range)
            bar_ranges = [(bar.high - bar.low) / bar.close for bar in window if bar.close > 0]
            avg_volatility = sum(bar_ranges) / len(bar_ranges) if bar_ranges else 1.0
            
            # Check if this is a valid base
            if range_pct <= max_range_pct and avg_volatility <= volatility_threshold:
                bases.append(Base(
                    start_index=start,
                    end_index=end,
                    low=window_low,
                    high=window_high,
                    height=height,
                    duration=end - start + 1,
                    start_date=data[start].timestamp,
                    end_date=data[end].timestamp
                ))
    
    # Remove overlapping bases (keep longest)
    filtered_bases = []
    for base in sorted(bases, key=lambda b: b.duration, reverse=True):
        overlaps = False
        for existing in filtered_bases:
            if not (base.end_index < existing.start_index or base.start_index > existing.end_index):
                overlaps = True
                break
        if not overlaps:
            filtered_bases.append(base)
    
    return filtered_bases


def detect_markup(
    data: List[OHLCV],
    base: Base,
    min_breakout_bars: int = 2,  # minimum bars above base for acceptance
    lookforward: int = 50  # how far to look for markup
) -> Optional[Markup]:
    """
    Detect markup breakout above a base.
    
    Breakout is valid if:
    - Close above base_high
    - Stays above for min_breakout_bars (acceptance)
    """
    n = len(data)
    base_high = base.high
    
    for i in range(base.end_index + 1, min(base.end_index + lookforward, n)):
        if data[i].close > base_high:
            # Check for acceptance (stays above)
            acceptance_count = 0
            markup_high = data[i].high
            
            for j in range(i, min(i + min_breakout_bars + 5, n)):
                if data[j].close > base_high:
                    acceptance_count += 1
                markup_high = max(markup_high, data[j].high)
            
            if acceptance_count >= min_breakout_bars:
                # Find the highest point of the markup
                high_index = i
                for j in range(i, min(i + 50, n)):
                    if data[j].high > markup_high:
                        markup_high = data[j].high
                        high_index = j
                
                return Markup(
                    breakout_index=i,
                    high=markup_high,
                    breakout_date=data[i].timestamp,
                    high_index=high_index,
                    high_date=data[high_index].timestamp
                )
    
    return None


def detect_second_pullback(
    data: List[OHLCV],
    base: Base,
    markup: Markup,
    min_retracement: float = 0.30,  # Very relaxed - let user label what's valid
    max_retracement: float = 5.0,   # Allow large drops
    max_duration_ratio: float = 1.0,  # No duration constraint - let user decide
    lookforward: int = 200  # look further ahead
) -> Optional[Pullback]:
    """
    Detect the second pullback (your entry zone).
    
    Valid if:
    - Retraces 70-90% of base height (measured from markup high)
    - Duration is shorter than base duration
    """
    n = len(data)
    base_height = base.height
    
    # Start looking after markup high - find when the markup peaks
    start_index = markup.breakout_index
    markup_high_index = start_index
    
    # Find the actual high point of the markup
    for i in range(start_index, min(start_index + 50, n)):
        if data[i].high >= markup.high * 0.99:  # Within 1% of markup high
            markup_high_index = i
            break
    
    # Find the lowest point after the markup high
    lowest_low = float('inf')
    lowest_index = markup_high_index
    
    for i in range(markup_high_index, min(markup_high_index + lookforward, n)):
        if data[i].low < lowest_low:
            lowest_low = data[i].low
            lowest_index = i
    
    if lowest_low == float('inf'):
        print(f"      -> No low found after markup", file=sys.stderr)
        return None
    
    # Calculate retracement
    # retracement = how far it pulled back into the base range
    # Formula: (markup_high - pullback_low) / base_height
    drop = markup.high - lowest_low
    retracement = drop / base_height if base_height > 0 else 0
    
    # Check constraints
    duration = lowest_index - markup_high_index + 1
    duration_ratio = duration / base.duration if base.duration > 0 else 1.0
    
    print(f"      -> Pullback low=${lowest_low:.2f} at {lowest_index}, drop=${drop:.2f}, retracement={retracement:.2%}, duration_ratio={duration_ratio:.2%}", file=sys.stderr)
    
    # No constraints - let all candidates through
    # User will label them Yes/No and ML will learn the actual criteria
    # Retracement and duration_ratio are stored for later filtering
    
    return Pullback(
        start_index=markup_high_index,
        low_index=lowest_index,
        low=lowest_low,
        duration=duration,
        retracement=retracement,
        low_date=data[lowest_index].timestamp
    )


def calculate_soft_score(
    data: List[OHLCV],
    base: Base,
    markup: Markup,
    pullback: Pullback
) -> float:
    """
    Calculate a "cleanliness" score for the pattern.
    This is what will be learned from your Yes/No feedback.
    
    Higher score = cleaner pattern.
    """
    score = 0.0
    
    # 1. Retracement in sweet spot (0.75-0.82 is ideal)
    if 0.75 <= pullback.retracement <= 0.82:
        score += 0.3
    elif 0.70 <= pullback.retracement <= 0.88:
        score += 0.2
    
    # 2. Time compression (faster pullback = better)
    duration_ratio = pullback.duration / base.duration if base.duration > 0 else 1.0
    if duration_ratio <= 0.15:
        score += 0.3
    elif duration_ratio <= 0.25:
        score += 0.2
    elif duration_ratio <= 0.35:
        score += 0.1
    
    # 3. Base duration (longer base = stronger pattern)
    if base.duration >= 50:
        score += 0.2
    elif base.duration >= 30:
        score += 0.1
    
    # 4. Breakout strength
    breakout_bar = data[markup.breakout_index]
    breakout_strength = (breakout_bar.close - base.high) / base.height if base.height > 0 else 0
    if breakout_strength >= 0.1:
        score += 0.2
    
    return min(score, 1.0)


def scan_for_patterns(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "D",
    config: Optional[Dict[str, Any]] = None
) -> List[PatternCandidate]:
    """
    Main scanning function. Finds all pattern candidates in the data.
    
    This is Phase 1: Rule-based only.
    """
    from .rdp import detect_swings_rdp, detect_swing_highs_lows
    from .swing_structure import (ConfirmedSwingPoint, SwingStructure, _build_swing_structure,
        detect_confirmed_swing_points, detect_swing_points_with_fallback,
        serialize_swing_structure, detect_regime_windows, find_major_peaks)

    if config is None:
        config = {}
    
    candidates = []
    
    # 1. Detect accumulation bases
    bases = detect_accumulation_bases(
        data,
        min_duration=config.get('min_base_duration', 20),
        max_duration=config.get('max_base_duration', 500),  # Support macro patterns
        max_range_pct=config.get('max_range_pct', 0.40)
    )
    
    print(f"Found {len(bases)} potential accumulation bases", file=sys.stderr)
    
    for base in bases:
        print(f"  Base {base.start_index}-{base.end_index}: ${base.low:.2f}-${base.high:.2f}, height=${base.height:.2f}, duration={base.duration}", file=sys.stderr)
        
        # 2. Detect markup breakout
        markup = detect_markup(data, base)
        if not markup:
            print(f"    -> No markup found", file=sys.stderr)
            continue
        
        print(f"    -> Markup at {markup.breakout_index}, high=${markup.high:.2f}", file=sys.stderr)
        
        # 3. Detect second pullback - use very relaxed defaults to find more candidates
        # User will label them Yes/No and the ML will learn the actual criteria
        pullback = detect_second_pullback(
            data, base, markup,
            min_retracement=config.get('min_retracement', 0.20),  # Very relaxed
            max_retracement=config.get('max_retracement', 10.0)   # Allow any drop
        )
        if not pullback:
            print(f"    -> No valid pullback found", file=sys.stderr)
            continue
        
        print(f"    -> Pullback: retracement={pullback.retracement:.2%}, duration={pullback.duration}", file=sys.stderr)
        
        # 4. Calculate score
        score = calculate_soft_score(data, base, markup, pullback)
        
        # 5. Create candidate
        candidate_id = f"{symbol}_{timeframe}_{base.start_index}_{pullback.low_index}"
        
        candidates.append(PatternCandidate(
            id=candidate_id,
            symbol=symbol,
            timeframe=timeframe,
            base=base,
            markup=markup,
            pullback=pullback,
            score=score,
            created_at=datetime.now().isoformat(),
            window_start=base.start_index,
            window_end=pullback.low_index,
            pattern_start_date=base.start_date,
            pattern_end_date=pullback.low_date
        ))
    
    # Sort by score (highest first)
    candidates.sort(key=lambda c: c.score, reverse=True)
    
    return candidates


def serialize_candidate(candidate: PatternCandidate, data: List[OHLCV] = None) -> Dict[str, Any]:
    """Convert a PatternCandidate to a JSON-serializable dict."""
    result = {
        'id': candidate.id,
        'symbol': candidate.symbol,
        'timeframe': candidate.timeframe,
        'base': asdict(candidate.base),
        'markup': asdict(candidate.markup),
        'pullback': asdict(candidate.pullback),
        'score': candidate.score,
        'created_at': candidate.created_at,
        'window_start': candidate.window_start,
        'window_end': candidate.window_end,
        'pattern_start_date': candidate.pattern_start_date,
        'pattern_end_date': candidate.pattern_end_date
    }
    
    # Include OHLCV data for chart drawing (with padding)
    if data:
        # Get a window that includes the FULL pattern (base start to pullback end, plus padding)
        # Use base.start_index as the true start, not window_start
        # For macro patterns, we need more context - scale padding with pattern size
        is_intraday = _detect_intraday(data)
        pattern_span = candidate.pullback.low_index - candidate.base.start_index
        padding_before = max(50, int(pattern_span * 0.3))  # 30% of pattern span, min 50 bars
        padding_after = max(50, int(pattern_span * 0.2))   # 20% of pattern span, min 50 bars
        
        start_idx = max(0, candidate.base.start_index - padding_before)
        end_idx = min(len(data), candidate.pullback.low_index + padding_after)
        
        chart_data = []
        for i in range(start_idx, end_idx):
            bar = data[i]
            time_val = _format_chart_time(bar.timestamp, is_intraday)
            if time_val is not None:
                chart_data.append({
                    'time': time_val,
                    'open': float(bar.open),
                    'high': float(bar.high),
                    'low': float(bar.low),
                    'close': float(bar.close)
                })
        
        result['chart_data'] = chart_data
        # Adjust indices relative to chart_data start
        result['chart_base_start'] = candidate.base.start_index - start_idx
        result['chart_base_end'] = candidate.base.end_index - start_idx
        result['chart_markup_high'] = candidate.markup.high_index - start_idx
        result['chart_pullback_low'] = candidate.pullback.low_index - start_idx
    
    return result


def scan_discount_zone(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    epsilon_pct: float = 0.05
) -> Optional[Dict[str, Any]]:
    """
    Scan a single symbol for discount zone entry criteria.
    
    Hard gates:
    1. Primary trend must be UPTREND
    2. Retracement must be >= 50% (in discount)
    3. Retracement must be < 100% (structure intact)
    
    If passes, returns a ranked result object. If fails, returns None.
    """
    from .rdp import detect_swings_rdp, detect_swing_highs_lows
    from .swing_structure import (ConfirmedSwingPoint, SwingStructure, _build_swing_structure,
        detect_confirmed_swing_points, detect_swing_points_with_fallback,
        serialize_swing_structure, detect_regime_windows, find_major_peaks)

    if len(data) < 20:
        return None
    
    print(f"\n--- Discount scan: {symbol} ({timeframe}) ---", file=sys.stderr)
    
    # 1. Get swing structure via RDP
    structure = detect_swings_rdp(data, symbol, timeframe, epsilon_pct=epsilon_pct)
    
    # 2. Get Fib + Energy signal
    fib_signal = calculate_fib_energy_signal(data, symbol, timeframe)
    
    # 3. Get selling pressure
    pressure = calculate_selling_pressure(data)
    
    # 4. Get energy state
    energy = calculate_energy_state(data, timeframe=timeframe)
    
    # Extract key values
    retracement = fib_signal.current_retracement_pct if fib_signal else 0
    primary_trend = structure.primary_trend if hasattr(structure, 'primary_trend') else 'UNKNOWN'
    current_price = data[-1].close
    
    # Use fib_signal's range_high/range_low for the structural anchors
    range_high = fib_signal.range_high if fib_signal else 0
    range_low = fib_signal.range_low if fib_signal else 0
    
    print(f"  Trend: {primary_trend}", file=sys.stderr)
    print(f"  Retracement: {retracement:.1f}%", file=sys.stderr)
    print(f"  Range: ${range_low:.2f} - ${range_high:.2f}", file=sys.stderr)
    print(f"  Energy: {energy.character_state} ({energy.direction})", file=sys.stderr)
    print(f"  Pressure: {pressure.current_pressure:.0f}/100 ({pressure.pressure_trend})", file=sys.stderr)
    
    # === HARD GATES ===
    if primary_trend != 'UPTREND':
        print(f"  FILTERED: Not in uptrend ({primary_trend})", file=sys.stderr)
        return None
    
    if retracement < 50:
        print(f"  FILTERED: Only {retracement:.1f}% retracement (need 50%+)", file=sys.stderr)
        return None
    
    if retracement >= 100:
        print(f"  FILTERED: {retracement:.1f}% retracement - below structural low", file=sys.stderr)
        return None
    
    # === PASSED HARD GATES ===
    print(f"  PASSED: In discount zone!", file=sys.stderr)
    
    # Determine tier
    if 70 <= retracement <= 79:
        tier = "SWEET_SPOT"
        tier_score = 40
    elif 50 <= retracement < 70:
        tier = "DISCOUNT"
        tier_score = 25
    else:  # 79 < retracement < 100
        tier = "DEEP_DISCOUNT"
        tier_score = 15
    
    # Energy score
    energy_scores = {
        'EXHAUSTED': 25, 'RECOVERING': 20, 'WANING': 15,
        'NEUTRAL': 10, 'STRONG': 0, 'UNKNOWN': 5
    }
    energy_score = energy_scores.get(energy.character_state, 5)
    # If STRONG but direction is UP, that's actually good (recovery)
    if energy.character_state == 'STRONG' and energy.direction == 'UP':
        energy_score = 20
    
    # Selling pressure score
    if pressure.current_pressure < 30 and pressure.pressure_trend == 'DECREASING':
        pressure_score = 25
    elif pressure.current_pressure < 30:
        pressure_score = 20
    elif pressure.current_pressure < 50:
        pressure_score = 10
    else:
        pressure_score = 0
    
    # Fibonacci proximity bonus
    near_fib = False
    nearest_fib_name = ""
    nearest_fib_distance = 999
    if fib_signal and fib_signal.fib_levels:
        for level in fib_signal.fib_levels:
            if level.is_near:
                near_fib = True
                if level.distance_pct < nearest_fib_distance:
                    nearest_fib_distance = level.distance_pct
                    nearest_fib_name = level.level_name
    fib_bonus = 10 if near_fib else 0
    
    # Composite rank score
    rank_score = tier_score + energy_score + pressure_score + fib_bonus
    
    print(f"  Tier: {tier} ({tier_score}pts), Energy: {energy_score}pts, Pressure: {pressure_score}pts, Fib: {fib_bonus}pts", file=sys.stderr)
    print(f"  RANK SCORE: {rank_score}/100", file=sys.stderr)
    
    # Build Fib levels list for output
    fib_levels_out = []
    if fib_signal and fib_signal.fib_levels:
        for level in fib_signal.fib_levels:
            fib_levels_out.append({
                'level_name': level.level_name,
                'price': round(level.price, 2),
                'distance_pct': round(level.distance_pct, 2),
                'is_near': level.is_near
            })
    
    # Build chart data for frontend display
    is_intraday = _detect_intraday(data)
    chart_data = []
    for bar in data:
        time_val = _format_chart_time(bar.timestamp, is_intraday)
        if time_val is not None:
            chart_data.append({
                'time': time_val,
                'open': float(bar.open),
                'high': float(bar.high),
                'low': float(bar.low),
                'close': float(bar.close),
                'volume': float(bar.volume)
            })
    
    # Swing points for chart markers
    swing_markers = []
    for sp in structure.swing_points:
        sp_time = _format_chart_time(sp.date, is_intraday) if sp.date else None
        if sp_time:
            swing_markers.append({
                'time': sp_time,
                'price': sp.price,
                'type': sp.point_type
            })
    
    return {
        'symbol': symbol,
        'timeframe': timeframe,
        'current_price': round(current_price, 2),
        'retracement': round(retracement, 1),
        'tier': tier,
        'rank_score': rank_score,
        'range_high': round(range_high, 2),
        'range_low': round(range_low, 2),
        'energy_state': energy.character_state,
        'energy_direction': energy.direction,
        'energy_velocity': round(energy.velocity, 2),
        'selling_pressure': round(pressure.current_pressure, 0),
        'pressure_trend': pressure.pressure_trend,
        'nearest_fib': nearest_fib_name,
        'near_fib': near_fib,
        'fib_levels': fib_levels_out,
        'primary_trend': primary_trend,
        'intermediate_trend': structure.intermediate_trend if hasattr(structure, 'intermediate_trend') else 'UNKNOWN',
        'swing_points': swing_markers,
        'chart_data': chart_data,
        'scan_date': datetime.now().isoformat(),
        'user_label': None
    }


def main():
    from .rdp import detect_swings_rdp, detect_swing_highs_lows
    from .swing_structure import (ConfirmedSwingPoint, SwingStructure, _build_swing_structure,
        detect_confirmed_swing_points, detect_swing_points_with_fallback,
        serialize_swing_structure, detect_regime_windows, find_major_peaks)
    from .energy import detect_energy_swings
    from .ohlcv import aggregate_bars

    parser = argparse.ArgumentParser(
        description='Scan for market structure patterns',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python patternScanner.py --symbol SLV --timeframe W
  python patternScanner.py --symbol GLD --wyckoff --period 20y
  python patternScanner.py --file silver_weekly.csv
  python patternScanner.py --symbol GC=F --period 15y --interval 1wk
        """
    )
    parser.add_argument('--symbol', type=str, help='Ticker symbol (e.g., SLV, GC=F)')
    parser.add_argument('--file', type=str, help='Path to CSV file with OHLCV data')
    parser.add_argument('--timeframe', type=str, default='W', help='Timeframe label (D, W, M)')
    parser.add_argument('--period', type=str, default='10y', help='Data period for yfinance')
    parser.add_argument('--interval', type=str, default='1wk', help='Data interval for yfinance')
    parser.add_argument('--refresh', action='store_true', help='Force re-download even if cached')
    parser.add_argument('--output', type=str, help='Output JSON file for candidates')
    parser.add_argument('--min-retracement', type=float, default=0.70, help='Minimum retracement (0.70 = 70%%)')
    parser.add_argument('--max-retracement', type=float, default=0.79, help='Maximum retracement (0.79 = 79%%)')
    parser.add_argument('--wyckoff', action='store_true', help='Use Wyckoff pattern detection (Prior Peak → Base → Markup → Pullback → Breakout)')
    parser.add_argument('--swing', action='store_true', help='Run swing point scanner (finds all confirmed highs/lows)')
    parser.add_argument('--swing-pct', type=float, default=0.15, help='Minimum swing percentage for subsequent swings (0.15 = 15%%)')
    parser.add_argument('--first-peak-decline', type=float, default=0.50, help='Required decline to confirm first peak (0.50 = 50%%)')
    parser.add_argument('--energy', action='store_true', help='Run energy-based swing detection (physics model)')
    parser.add_argument('--energy-only', action='store_true', help='Show only current energy state, no swing detection')
    parser.add_argument('--fib-energy', action='store_true', help='Run Fibonacci + Energy combined analysis')
    parser.add_argument('--copilot', action='store_true', help='Run full Co-Pilot analysis (Fib + Energy + Go/No-Go reasoning)')
    parser.add_argument('--regime', action='store_true', help='Run regime analysis (volatility + regression slope + RDP structure)')
    parser.add_argument('--discount', action='store_true', help='Discount zone scan (uptrend + 50%%+ retracement + structure intact)')
    parser.add_argument('--min-markdown', type=float, default=0.70, help='Min markdown %% for Wyckoff (0.70 = 70%% decline, 0.50 = relaxed)')
    parser.add_argument('--fib-proximity', type=float, default=3.0, help='Proximity threshold for Fib levels (default 3%%)')
    parser.add_argument('--aggregate', type=int, default=0, help='Aggregate N bars into one (e.g., 4 for 4H from 1H data)')
    parser.add_argument('--swing-epsilon', type=float, default=0.05, help='RDP swing sensitivity as %% of price range (0.05 = 5%%). Higher = fewer swings.')
    parser.add_argument('--trade-direction', type=str, default=None, choices=['long', 'short'], help='User-chosen trade direction (long or short). Overrides auto-detection from trend.')
    
    args = parser.parse_args()
    
    # Load data
    if args.file:
        print(f"Loading data from {args.file}...", file=sys.stderr)
        data = load_data_from_csv(args.file)
    elif args.symbol:
        print(f"Loading {args.symbol} ({args.period}, {args.interval})...", file=sys.stderr)
        data = fetch_data_yfinance(args.symbol, args.period, args.interval, force_refresh=args.refresh)
    else:
        print("Error: Either --symbol or --file is required", file=sys.stderr)
        sys.exit(1)
    
    # Aggregate bars if requested (e.g., 4x 1H -> 1x 4H)
    if args.aggregate and args.aggregate > 1:
        data = aggregate_bars(data, args.aggregate)
        print(f"Aggregated to {len(data)} bars (factor {args.aggregate})", file=sys.stderr)
    
    print(f"Loaded {len(data)} bars", file=sys.stderr)
    
    # Scan for patterns
    config = {
        'min_retracement': args.min_retracement,
        'max_retracement': args.max_retracement
    }
    
    if args.regime:
        structure = detect_swings_rdp(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe,
            epsilon_pct=args.swing_epsilon
        )
        regime_info = detect_regime_windows(data, lookback=26, min_window_bars=8)
        current_regime = regime_info.get("current_regime", "unknown")

        print(f"\n=== REGIME ANALYSIS: {args.symbol or 'FILE'} ({args.timeframe}) ===", file=sys.stderr)
        print(f"Current regime: {current_regime}", file=sys.stderr)
        print(f"Detected regime windows: {len(regime_info.get('windows', []))}", file=sys.stderr)

        result = serialize_swing_structure(structure, data)
        result["pattern_type"] = "regime"
        result["mode"] = "REGIME"
        result["status"] = current_regime.upper() if isinstance(current_regime, str) else "UNKNOWN"
        result["regime_state"] = current_regime
        result["regime_windows"] = regime_info.get("windows", [])
        result["allowed_windows"] = regime_info.get("allowed_windows", {})
        result["regime_lookback_bars"] = regime_info.get("lookback_bars", 26)
        results = [result]

    elif args.discount:
        # Discount zone scan — returns result or empty array if filtered out
        result = scan_discount_zone(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe,
            epsilon_pct=args.swing_epsilon
        )
        
        if result:
            print(f"\n=== {args.symbol} PASSED: {result['tier']} ({result['retracement']:.1f}%) — Score: {result['rank_score']}/100 ===", file=sys.stderr)
            results = [result]
        else:
            print(f"\n=== {args.symbol} FILTERED OUT ===", file=sys.stderr)
            results = []
        
    elif args.copilot:
        # Full Co-Pilot analysis
        analysis = generate_copilot_analysis(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe,
            epsilon_pct=args.swing_epsilon,
            user_direction=args.trade_direction
        )
        
        # Print commentary to stderr for debugging
        print(analysis.get('commentary', 'No commentary generated'), file=sys.stderr)
        
        results = [analysis]
        
    elif args.fib_energy:
        # Combined Fibonacci + Energy analysis
        signal = calculate_fib_energy_signal(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe,
            proximity_pct=args.fib_proximity
        )
        
        if signal:
            print(f"\n=== FIBONACCI + ENERGY ANALYSIS: {signal.symbol} ({signal.timeframe}) ===", file=sys.stderr)
            print(f"\n--- PRICE RANGE ---", file=sys.stderr)
            print(f"Range Low: ${signal.range_low:.2f} ({signal.range_low_date})", file=sys.stderr)
            print(f"Range High: ${signal.range_high:.2f} ({signal.range_high_date})", file=sys.stderr)
            print(f"Current Price: ${signal.current_price:.2f}", file=sys.stderr)
            print(f"Current Retracement: {signal.current_retracement_pct:.1f}%", file=sys.stderr)
            
            print(f"\n--- FIBONACCI LEVELS ---", file=sys.stderr)
            for level in signal.fib_levels:
                marker = " <<<" if level.is_near else ""
                print(f"  {level.level_name}: ${level.price:.2f} (distance: {level.distance_pct:.1f}%){marker}", file=sys.stderr)
            
            print(f"\n--- ENERGY STATE ---", file=sys.stderr)
            print(f"Character: {signal.energy.character_state}", file=sys.stderr)
            print(f"Direction: {signal.energy.direction}", file=sys.stderr)
            print(f"Velocity: {signal.energy.velocity:.2f}%", file=sys.stderr)
            print(f"Acceleration: {signal.energy.acceleration:.3f}", file=sys.stderr)
            print(f"Range Compression: {signal.energy.range_compression:.0%}", file=sys.stderr)
            print(f"Energy Score: {signal.energy.energy_score:.1f}/100", file=sys.stderr)
            
            print(f"\n--- SIGNAL ---", file=sys.stderr)
            print(f"Signal: {signal.signal}", file=sys.stderr)
            print(f"Reason: {signal.signal_reason}", file=sys.stderr)
            
            # Build chart data for frontend display
            is_intraday = _detect_intraday(data)
            chart_data = []
            for bar in data:
                time_val = _format_chart_time(bar.timestamp, is_intraday)
                if time_val is not None:
                    chart_data.append({
                        'time': time_val,
                        'open': float(bar.open),
                        'high': float(bar.high),
                        'low': float(bar.low),
                        'close': float(bar.close)
                    })
            
            # Serialize for JSON output
            results = [{
                'symbol': signal.symbol,
                'timeframe': signal.timeframe,
                'current_price': signal.current_price,
                'current_date': signal.current_date,
                'range': {
                    'low': signal.range_low,
                    'low_date': signal.range_low_date,
                    'high': signal.range_high,
                    'high_date': signal.range_high_date
                },
                'current_retracement_pct': signal.current_retracement_pct,
                'fib_levels': [
                    {
                        'level': level.level_name,
                        'price': level.price,
                        'distance_pct': level.distance_pct,
                        'is_near': level.is_near
                    }
                    for level in signal.fib_levels
                ],
                'nearest_level': {
                    'level': signal.nearest_level.level_name,
                    'price': signal.nearest_level.price,
                    'distance_pct': signal.nearest_level.distance_pct
                } if signal.nearest_level else None,
                'energy': {
                    'character_state': signal.energy.character_state,
                    'direction': signal.energy.direction,
                    'velocity': signal.energy.velocity,
                    'acceleration': signal.energy.acceleration,
                    'range_compression': signal.energy.range_compression,
                    'energy_score': signal.energy.energy_score
                },
                'selling_pressure': {
                    'current': signal.selling_pressure.current_pressure,
                    'peak': signal.selling_pressure.peak_pressure,
                    'change': signal.selling_pressure.pressure_change,
                    'trend': signal.selling_pressure.pressure_trend,
                    'bars_since_peak': signal.selling_pressure.bars_since_peak_pressure,
                    'history': signal.selling_pressure.pressure_history
                } if signal.selling_pressure else None,
                'signal': signal.signal,
                'signal_reason': signal.signal_reason,
                'chart_data': chart_data  # Include chart data for frontend
            }]
        else:
            print("Unable to calculate Fib+Energy signal (insufficient data)", file=sys.stderr)
            results = []
    
    elif args.energy_only:
        # Just show current energy state, no swing detection
        energy = calculate_energy_state(data, timeframe=args.timeframe)
        
        print(f"\n=== ENERGY STATE: {args.symbol or 'FILE'} ({args.timeframe}) ===", file=sys.stderr)
        print(f"Current Price: ${energy.price:.2f}", file=sys.stderr)
        print(f"Direction: {energy.direction}", file=sys.stderr)
        print(f"Velocity: {energy.velocity:.2f}% (peak: {energy.peak_velocity:.2f}%)", file=sys.stderr)
        print(f"Acceleration: {energy.acceleration:.3f}", file=sys.stderr)
        print(f"Avg Range: {energy.avg_range:.2f}% (peak: {energy.peak_range:.2f}%)", file=sys.stderr)
        print(f"Range Compression: {energy.range_compression:.0%}", file=sys.stderr)
        print(f"Energy Score: {energy.energy_score:.1f}/100", file=sys.stderr)
        print(f"Character State: {energy.character_state}", file=sys.stderr)
        print(f"Bars Since Peak: {energy.bars_since_peak}", file=sys.stderr)
        
        results = [{
            'symbol': args.symbol or 'FILE',
            'timeframe': args.timeframe,
            'energy': {
                'velocity': energy.velocity,
                'acceleration': energy.acceleration,
                'avg_range': energy.avg_range,
                'range_compression': energy.range_compression,
                'peak_velocity': energy.peak_velocity,
                'peak_range': energy.peak_range,
                'energy_score': energy.energy_score,
                'character_state': energy.character_state,
                'direction': energy.direction,
                'bars_since_peak': energy.bars_since_peak
            },
            'current_price': energy.price,
            'current_date': energy.timestamp[:10] if energy.timestamp else None
        }]
        
    elif args.energy:
        # Use energy-based swing detection
        swing_points, energy_history = detect_energy_swings(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe
        )
        
        # Build swing structure from energy-based swings
        structure = _build_swing_structure(
            args.symbol or 'FILE',
            args.timeframe,
            swing_points,
            data,
            mode="ENERGY"
        )
        
        # Get current energy state
        current_energy = energy_history[-1] if energy_history else None
        
        print(f"\n=== ENERGY-BASED SWING SUMMARY ===", file=sys.stderr)
        print(f"Symbol: {structure.symbol}", file=sys.stderr)
        if _SCANNER_DEBUG: print(f"Found {len(swing_points)} energy-based swings", file=sys.stderr)
        print(f"Status: {structure.status}", file=sys.stderr)
        print(f"Primary Trend: {structure.primary_trend}", file=sys.stderr)
        print(f"Intermediate Trend: {structure.intermediate_trend}", file=sys.stderr)
        print(f"Trend Alignment: {structure.trend_alignment}", file=sys.stderr)
        
        if current_energy:
            print(f"\n--- CURRENT ENERGY STATE ---", file=sys.stderr)
            print(f"Character: {current_energy.character_state}", file=sys.stderr)
            print(f"Energy Score: {current_energy.energy_score:.1f}/100", file=sys.stderr)
            print(f"Velocity: {current_energy.velocity:.2f}%", file=sys.stderr)
            print(f"Acceleration: {current_energy.acceleration:.3f}", file=sys.stderr)
            print(f"Range Compression: {current_energy.range_compression:.0%}", file=sys.stderr)
        
        # List all swing points
        print(f"\n--- ALL ENERGY-BASED SWINGS ({len(swing_points)}) ---", file=sys.stderr)
        for i, point in enumerate(swing_points):
            print(f"  {i+1}. {point.point_type}: ${point.price:.2f} on {point.date[:10]}", file=sys.stderr)
        
        # Serialize with energy data included
        result = serialize_swing_structure(structure, data)
        if current_energy:
            result['current_energy'] = {
                'velocity': current_energy.velocity,
                'acceleration': current_energy.acceleration,
                'avg_range': current_energy.avg_range,
                'range_compression': current_energy.range_compression,
                'energy_score': current_energy.energy_score,
                'character_state': current_energy.character_state,
                'direction': current_energy.direction,
                'bars_since_peak': current_energy.bars_since_peak
            }
        results = [result]
        
    elif args.swing:
        # Use swing point scanner with automatic fallback
        # Primary: MAJOR mode (strict structure breaks)
        # Fallback: RDP mode if < 2 swing highs found
        structure = detect_swing_points_with_fallback(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe,
            first_peak_decline=args.first_peak_decline,
            relative_threshold=args.swing_pct,  # Use swing_pct as relative threshold
            min_major_highs=2,  # Fallback if < 2 swing highs
            epsilon_pct=args.swing_epsilon  # Pass through for RDP fallback
        )
        
        # Print summary
        print(f"\n--- SUMMARY ---", file=sys.stderr)
        print(f"Symbol: {structure.symbol}", file=sys.stderr)
        print(f"Mode: {structure.mode}", file=sys.stderr)
        print(f"Status: {structure.status}", file=sys.stderr)
        print(f"Current Price: ${structure.current_price:.2f}", file=sys.stderr)
        
        if structure.current_peak:
            print(f"Current Peak: ${structure.current_peak.price:.2f} ({structure.current_peak.date[:10]})", file=sys.stderr)
        if structure.current_low:
            print(f"Prior Low: ${structure.current_low.price:.2f} ({structure.current_low.date[:10]})", file=sys.stderr)
        
        if structure.retracement_70 and structure.retracement_79:
            print(f"70% Level: ${structure.retracement_70:.2f}", file=sys.stderr)
            print(f"79% Level: ${structure.retracement_79:.2f}", file=sys.stderr)
            print(f"Buy Zone: ${structure.retracement_79:.2f} - ${structure.retracement_70:.2f}", file=sys.stderr)
            print(f"In Buy Zone: {structure.in_buy_zone}", file=sys.stderr)
        
        # List all swing points
        print(f"\n--- ALL CONFIRMED SWING POINTS ({len(structure.swing_points)}) ---", file=sys.stderr)
        for i, point in enumerate(structure.swing_points):
            print(f"  {i+1}. {point.point_type}: ${point.price:.2f} on {point.date[:10]}", file=sys.stderr)
        
        results = [serialize_swing_structure(structure, data)]
        
    elif args.wyckoff:
        # Use Wyckoff pattern detection
        print("\n=== WYCKOFF PATTERN DETECTION ===", file=sys.stderr)
        patterns = detect_wyckoff_patterns(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe,
            config=config,
            min_markdown_pct=args.min_markdown
        )
        print(f"\nFound {len(patterns)} Wyckoff patterns", file=sys.stderr)
        results = [serialize_wyckoff_pattern(p, data) for p in patterns]
        
        # If no patterns found, create a chart-only candidate so user can still view/annotate
        if len(results) == 0 and len(data) > 0:
            print("No patterns found - creating chart-only candidate for viewing", file=sys.stderr)
            is_intraday = _detect_intraday(data)
            chart_data = []
            for bar in data:
                time_val = _format_chart_time(bar.timestamp, is_intraday)
                if time_val is not None:
                    chart_data.append({
                        'time': time_val,
                        'open': float(bar.open),
                        'high': float(bar.high),
                        'low': float(bar.low),
                        'close': float(bar.close)
                    })
            results = [{
                'id': f"{args.symbol or 'FILE'}_{args.timeframe}_chart_only",
                'symbol': args.symbol or 'FILE',
                'timeframe': args.timeframe,
                'pattern_type': 'chart_only',
                'score': 0,
                'chart_data': chart_data,
                'chart_prior_peak': -1,
                'chart_markdown_low': -1,
                'chart_base_start': -1,
                'chart_base_end': -1,
                'chart_markup_high': -1,
                'chart_pullback_low': -1,
                'chart_second_breakout': -1,
                'base': {'high': 0, 'low': 0},
                'message': 'No Wyckoff patterns detected - chart loaded for manual annotation'
            }]
    else:
        # Use original simple pattern detection
        candidates = scan_for_patterns(
            data,
            symbol=args.symbol or 'FILE',
            timeframe=args.timeframe,
            config=config
        )
        print(f"Found {len(candidates)} pattern candidates", file=sys.stderr)
        results = [serialize_candidate(c, data) for c in candidates]
        
        # Same fallback for simple patterns
        if len(results) == 0 and len(data) > 0:
            print("No patterns found - creating chart-only candidate for viewing", file=sys.stderr)
            is_intraday = _detect_intraday(data)
            chart_data = []
            for bar in data:
                time_val = _format_chart_time(bar.timestamp, is_intraday)
                if time_val is not None:
                    chart_data.append({
                        'time': time_val,
                        'open': float(bar.open),
                        'high': float(bar.high),
                        'low': float(bar.low),
                        'close': float(bar.close)
                    })
            results = [{
                'id': f"{args.symbol or 'FILE'}_{args.timeframe}_chart_only",
                'symbol': args.symbol or 'FILE',
                'timeframe': args.timeframe,
                'pattern_type': 'chart_only',
                'score': 0,
                'chart_data': chart_data,
                'message': 'No patterns detected - chart loaded for manual annotation'
            }]
    
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
