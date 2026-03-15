"""Fibonacci retracement levels and energy-based entry signals."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import List, Optional

from .ohlcv import OHLCV
from .energy import EnergyState, SellingPressure, calculate_energy_state, calculate_selling_pressure

__all__ = [
    "FibonacciLevel",
    "FibEnergySignal",
    "calculate_fib_energy_signal",
]


def _build_leg_from_swing_point(data: List[OHLCV], swing_point) -> Optional[dict]:
    """Build a bullish or bearish leg from a specific confirmed swing point."""
    point_index = int(getattr(swing_point, "index", -1))
    if point_index < 0 or point_index >= len(data):
        return None

    point_type = getattr(swing_point, "point_type", None)
    if point_type == "LOW":
        bars_since_low = data[point_index:]
        if not bars_since_low:
            return None
        range_low = float(data[point_index].low)
        range_low_date = data[point_index].timestamp
        range_high = max(float(bar.high) for bar in bars_since_low)
        range_high_offset = next(i for i, bar in enumerate(bars_since_low) if float(bar.high) == range_high)
        range_high_idx = point_index + range_high_offset
        range_high_date = data[range_high_idx].timestamp
        direction = "bullish"
    elif point_type == "HIGH":
        bars_since_high = data[point_index:]
        if not bars_since_high:
            return None
        range_high = float(data[point_index].high)
        range_high_date = data[point_index].timestamp
        range_low = min(float(bar.low) for bar in bars_since_high)
        range_low_offset = next(i for i, bar in enumerate(bars_since_high) if float(bar.low) == range_low)
        range_low_idx = point_index + range_low_offset
        range_low_date = data[range_low_idx].timestamp
        direction = "bearish"
    else:
        return None

    if range_high <= range_low:
        return None

    return {
        "range_low": range_low,
        "range_low_date": range_low_date,
        "range_high": range_high,
        "range_high_date": range_high_date,
        "direction": direction,
    }


def _select_active_leg_range(
    data: List[OHLCV],
    structure,
    preferred_direction: Optional[str] = None,
) -> Optional[dict]:
    """Select the active leg, optionally biased to bullish or bearish setups."""
    points = getattr(structure, "swing_points", None) if structure is not None else None
    if not points:
        return None

    points = sorted(points, key=lambda p: p.index)

    if preferred_direction in {"bullish", "bearish"}:
        preferred_point_type = "LOW" if preferred_direction == "bullish" else "HIGH"
        for point in reversed(points):
            if getattr(point, "point_type", None) != preferred_point_type:
                continue
            preferred_leg = _build_leg_from_swing_point(data, point)
            if preferred_leg:
                preferred_leg["source"] = "preferred_active_leg"
                return preferred_leg

    active_leg = _build_leg_from_swing_point(data, points[-1])
    if not active_leg:
        return None

    active_leg["source"] = "active_leg"
    return active_leg


@dataclass
class FibonacciLevel:
    """A Fibonacci retracement level with energy analysis."""
    level_name: str  # '0.25', '0.50', '0.70', '0.79', '0.88', '1.0'
    level_pct: float  # 0.25, 0.50, etc.
    price: float  # The actual price at this level
    distance_pct: float  # How far current price is from this level (%)
    is_near: bool  # Is price within proximity threshold


@dataclass 
class FibEnergySignal:
    """Combined Fibonacci + Energy analysis for entry signals."""
    symbol: str
    timeframe: str
    
    # Price context
    current_price: float
    current_date: str
    
    # The range we're measuring from
    range_low: float
    range_low_date: str
    range_high: float
    range_high_date: str
    range_direction: str
    
    # Fibonacci levels
    fib_levels: List[FibonacciLevel]
    nearest_level: Optional[FibonacciLevel]
    
    # Current retracement
    current_retracement_pct: float  # How much has been retraced (0-100%)
    
    # Energy state
    energy: EnergyState
    
    # Selling pressure
    selling_pressure: Optional[SellingPressure]
    
    # Signal
    signal: str  # 'WAIT', 'APPROACHING', 'POTENTIAL_ENTRY', 'CONFIRMED_ENTRY'
    signal_reason: str


def calculate_fib_energy_signal(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    fib_levels: List[float] = [0.25, 0.382, 0.50, 0.618, 0.70, 0.79, 0.88],
    proximity_pct: float = 3.0,  # Consider "near" if within 3%
    use_swing_structure: bool = True,  # Use swing points or absolute high/low
    epsilon_pct: float = 0.05,
    swing_structure=None,
    trade_direction: Optional[str] = None,
) -> FibEnergySignal:
    """
    Combined Fibonacci + Energy analysis for finding high-probability entries.
    
    1. Identifies the major range (swing low to swing high)
    2. Calculates Fibonacci retracement levels
    3. Checks if price is near any level
    4. Analyzes energy state at that level
    5. Generates a signal based on price + energy alignment
    
    Args:
        data: OHLCV price data
        symbol: Symbol name
        timeframe: Timeframe
        fib_levels: List of Fibonacci levels to calculate
        proximity_pct: How close price must be to a level to be "near" (%)
        use_swing_structure: If True, use swing points for range; if False, use absolute high/low
    
    Returns:
        FibEnergySignal with complete analysis
    """
    from .swing_structure import detect_swing_points_with_fallback

    if len(data) < 20:
        return None
    
    # Find the major range
    # Strategy: 
    #   LOW = the confirmed structural swing low (the anchor - we KNOW this is the bottom)
    #   HIGH = the highest price SINCE that low (adjusts upward as price extends)
    
    if use_swing_structure:
        structure = swing_structure or detect_swing_points_with_fallback(
            data, symbol, timeframe,
            first_peak_decline=0.50,
            relative_threshold=0.20,
            min_major_highs=2,
            epsilon_pct=epsilon_pct,
        )

        preferred_direction = None
        if trade_direction:
            direction_value = str(trade_direction).upper()
            if direction_value == "LONG":
                preferred_direction = "bullish"
            elif direction_value == "SHORT":
                preferred_direction = "bearish"

        active_leg = _select_active_leg_range(data, structure, preferred_direction)
        if active_leg:
            range_low = active_leg["range_low"]
            range_low_date = active_leg["range_low_date"]
            range_high = active_leg["range_high"]
            range_high_date = active_leg["range_high_date"]
            range_direction = active_leg["direction"]
        else:
            # Fallback to broad structure if active leg cannot be derived.
            lows = [p for p in structure.swing_points if p.point_type == 'LOW']
            peaks = [p for p in structure.swing_points if p.point_type == 'HIGH']

            if lows and peaks:
                highest_peak = max(peaks, key=lambda p: p.price)
                lows_before_peak = [l for l in lows if l.index < highest_peak.index]

                if lows_before_peak:
                    structural_low = lows_before_peak[-1]
                    range_low = structural_low.price
                    range_low_date = structural_low.date
                else:
                    range_low = min(bar.low for bar in data)
                    range_low_idx = next(i for i, bar in enumerate(data) if bar.low == range_low)
                    range_low_date = data[range_low_idx].timestamp

                low_idx = next((i for i, bar in enumerate(data)
                               if bar.timestamp[:10] == range_low_date[:10]), 0)
                bars_since_low = data[low_idx:]
                if bars_since_low:
                    range_high = max(bar.high for bar in bars_since_low)
                    range_high_idx = low_idx + next(i for i, bar in enumerate(bars_since_low)
                                                     if bar.high == range_high)
                    range_high_date = data[range_high_idx].timestamp
                else:
                    range_high = highest_peak.price
                    range_high_date = highest_peak.date
                range_direction = "bullish"
            else:
                range_low = min(bar.low for bar in data)
                range_low_idx = next(i for i, bar in enumerate(data) if bar.low == range_low)
                range_low_date = data[range_low_idx].timestamp

                range_high = max(bar.high for bar in data)
                range_high_idx = next(i for i, bar in enumerate(data) if bar.high == range_high)
                range_high_date = data[range_high_idx].timestamp
                range_direction = "bullish"
    else:
        # Use absolute high/low
        range_low = min(bar.low for bar in data)
        range_low_idx = next(i for i, bar in enumerate(data) if bar.low == range_low)
        range_low_date = data[range_low_idx].timestamp
        
        range_high = max(bar.high for bar in data)
        range_high_idx = next(i for i, bar in enumerate(data) if bar.high == range_high)
        range_high_date = data[range_high_idx].timestamp
        range_direction = "bullish"
    
    print(f"\n--- FIB RANGE ---", file=sys.stderr)
    print(f"Range Low: ${range_low:.2f} ({range_low_date[:10] if range_low_date else 'N/A'})", file=sys.stderr)
    print(f"Range High: ${range_high:.2f} ({range_high_date[:10] if range_high_date else 'N/A'})", file=sys.stderr)
    
    current_price = data[-1].close
    current_date = data[-1].timestamp
    
    # Calculate the range
    price_range = range_high - range_low
    
    # Calculate current retracement percentage in the setup direction:
    # bullish leg: 0% at the high, 100% at the low
    # bearish leg: 0% at the low, 100% back up at the high
    if price_range > 0:
        if range_direction == "bearish":
            current_retracement_pct = ((current_price - range_low) / price_range) * 100
        else:
            current_retracement_pct = ((range_high - current_price) / price_range) * 100
    else:
        current_retracement_pct = 0
    
    # Calculate Fibonacci levels
    calculated_levels = []
    for level in fib_levels:
        fib_price = range_low + (price_range * level) if range_direction == "bearish" else range_high - (price_range * level)
        distance_pct = abs((current_price - fib_price) / fib_price * 100) if fib_price > 0 else 999
        is_near = distance_pct <= proximity_pct
        
        calculated_levels.append(FibonacciLevel(
            level_name=f"{level:.0%}",
            level_pct=level,
            price=round(fib_price, 2),
            distance_pct=round(distance_pct, 2),
            is_near=is_near
        ))
    
    # Find nearest level
    nearest_level = min(calculated_levels, key=lambda x: x.distance_pct) if calculated_levels else None
    
    # Calculate energy state (adaptive to timeframe)
    energy = calculate_energy_state(data, timeframe=timeframe)
    
    # Generate signal
    signal = "WAIT"
    signal_reason = ""
    
    # Check if we're near any significant level
    near_levels = [l for l in calculated_levels if l.is_near]
    
    if near_levels:
        level_names = ", ".join(l.level_name for l in near_levels)
        
        if energy.character_state == "EXHAUSTED":
            signal = "POTENTIAL_ENTRY"
            signal_reason = f"Price at {level_names} level with EXHAUSTED energy - selling momentum depleted"
        elif energy.character_state == "RECOVERING":
            signal = "CONFIRMED_ENTRY"
            signal_reason = f"Price at {level_names} level with RECOVERING energy - reversal in progress"
        elif energy.character_state == "WANING":
            signal = "APPROACHING"
            signal_reason = f"Price at {level_names} level with WANING energy - watch for exhaustion"
        else:
            signal = "APPROACHING"
            signal_reason = f"Price near {level_names} level - energy still {energy.character_state}"
    else:
        if current_retracement_pct < 20:
            signal = "WAIT"
            signal_reason = f"Only {current_retracement_pct:.0f}% retracement - wait for deeper pullback"
        elif current_retracement_pct > 100:
            signal = "CAUTION"
            signal_reason = f"Price below range low - structure may be breaking"
        else:
            next_level = next((l for l in sorted(calculated_levels, key=lambda x: x.level_pct) 
                              if l.level_pct * 100 > current_retracement_pct), None)
            if next_level:
                signal = "WAIT"
                signal_reason = f"{current_retracement_pct:.0f}% retraced - next level is {next_level.level_name} at ${next_level.price:.2f}"
            else:
                signal = "WAIT"
                signal_reason = f"{current_retracement_pct:.0f}% retraced"
    
    # Calculate selling pressure
    selling_pressure = calculate_selling_pressure(data, lookback=10)
    
    # Enhance signal based on selling pressure
    if selling_pressure.pressure_trend == 'DECREASING' and near_levels:
        if selling_pressure.current_pressure < 20:
            signal = "CONFIRMED_ENTRY"
            signal_reason += f" | Selling pressure exhausted ({selling_pressure.current_pressure:.0f}/100, down from {selling_pressure.peak_pressure:.0f})"
        elif selling_pressure.current_pressure < 40:
            signal = "POTENTIAL_ENTRY"
            signal_reason += f" | Selling pressure decreasing ({selling_pressure.current_pressure:.0f}/100)"
    
    return FibEnergySignal(
        symbol=symbol,
        timeframe=timeframe,
        current_price=current_price,
        current_date=current_date[:10] if current_date else "",
        range_low=range_low,
        range_low_date=range_low_date[:10] if range_low_date else "",
        range_high=range_high,
        range_high_date=range_high_date[:10] if range_high_date else "",
        range_direction=range_direction,
        fib_levels=calculated_levels,
        nearest_level=nearest_level,
        current_retracement_pct=round(current_retracement_pct, 1),
        energy=energy,
        selling_pressure=selling_pressure,
        signal=signal,
        signal_reason=signal_reason
    )
