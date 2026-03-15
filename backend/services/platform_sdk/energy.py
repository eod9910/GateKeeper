"""Energy state, selling/buying pressure, and energy-based swing detection."""

import os
import sys
from dataclasses import dataclass
from typing import List, Tuple

from .ohlcv import OHLCV, _detect_intraday, _format_chart_time

_SCANNER_DEBUG = os.environ.get("SCANNER_DEBUG", "").lower() in ("1", "true", "yes")

__all__ = [
    "EnergyState",
    "SellingPressure",
    "calculate_selling_pressure",
    "calculate_buying_pressure",
    "calculate_energy_state",
    "detect_energy_swings",
]


@dataclass
class EnergyState:
    """
    Physics-based energy state analysis for detecting character changes in price action.
    
    Inspired by ballistic motion:
    - Velocity = Rate of price change
    - Acceleration = Rate of change of velocity
    - Range = Energy per candle (high - low)
    
    When energy wanes, the character of the move is changing.
    """
    # Current readings
    velocity: float  # Rate of change (% per period)
    acceleration: float  # Second derivative (change in velocity)
    avg_range: float  # Average candle range (ATR-like)
    range_compression: float  # How much range has shrunk from peak (0-1)
    
    # Peak readings (for comparison)
    peak_velocity: float
    peak_range: float
    
    # Derived state
    energy_score: float  # Composite 0-100 score
    character_state: str  # 'STRONG', 'WANING', 'EXHAUSTED', 'RECOVERING'
    
    # Context
    direction: str  # 'UP' or 'DOWN' (direction of the move being analyzed)
    bars_since_peak: int  # How many bars since peak velocity
    
    # Metadata
    timestamp: str
    price: float


@dataclass
class SellingPressure:
    """Quantified selling pressure as an objective numerical value."""
    current_pressure: float  # 0-100 score
    peak_pressure: float  # Highest pressure during this move
    pressure_change: float  # How much pressure changed (negative = decreasing)
    pressure_trend: str  # 'INCREASING', 'DECREASING', 'STABLE'
    bars_since_peak_pressure: int
    pressure_history: List[float]  # Last N pressure readings


def calculate_selling_pressure(
    data: List[OHLCV],
    lookback: int = 10
) -> SellingPressure:
    """
    Calculate selling pressure as a single objective number (0-100).
    
    Selling Pressure combines:
    - Short-term velocity (how fast is it dropping recently?)
    - Candle range (how big are the down moves?)
    - Consecutive down bars (sustained selling?)
    - Drop from recent high (how far has it fallen?)
    
    High pressure = strong selling (big, fast drops)
    Low pressure = exhausted selling (small, slow moves)
    """
    if len(data) < lookback + 5:
        return SellingPressure(
            current_pressure=50,
            peak_pressure=50,
            pressure_change=0,
            pressure_trend='UNKNOWN',
            bars_since_peak_pressure=0,
            pressure_history=[]
        )
    
    pressure_history = []
    
    # Calculate pressure for each bar (starting after warmup)
    for i in range(lookback, len(data)):
        # Use MULTIPLE timeframes for velocity to catch pullbacks properly
        # Short-term (3 bars) - catches recent moves
        short_lookback = min(3, i)
        short_velocity = ((data[i].close - data[i - short_lookback].close) / data[i - short_lookback].close) * 100
        
        # Medium-term (lookback bars) - catches larger moves
        med_velocity = ((data[i].close - data[i - lookback].close) / data[i - lookback].close) * 100
        
        # Drop from recent high (highest high in last lookback*2 bars)
        recent_start = max(0, i - lookback * 2)
        recent_high = max(data[j].high for j in range(recent_start, i + 1))
        drop_from_high = ((data[i].close - recent_high) / recent_high) * 100  # Negative when below high
        
        # Count consecutive down bars (close < open)
        consecutive_down = 0
        for j in range(i, max(0, i - 8), -1):
            if data[j].close < data[j].open:
                consecutive_down += 1
            else:
                break
        
        # Range: average candle size as % of price (last 5 bars)
        ranges = []
        for j in range(max(0, i - 5), i + 1):
            bar_range = (data[j].high - data[j].low) / data[j].close * 100
            ranges.append(bar_range)
        avg_range = sum(ranges) / len(ranges) if ranges else 0
        
        # === SELLING PRESSURE SCORE ===
        # Component 1: Short-term velocity (0-35 points)
        # Negative = selling, more negative = more pressure
        if short_velocity < 0:
            velocity_score = min(abs(short_velocity) / 5 * 35, 35)
        else:
            velocity_score = 0
        
        # Component 2: Drop from recent high (0-30 points)
        # The further price is from its recent high, the more selling has occurred
        if drop_from_high < 0:
            drop_score = min(abs(drop_from_high) / 10 * 30, 30)
        else:
            drop_score = 0
        
        # Component 3: Candle range (0-20 points)
        # Bigger candles = more energy in the selling
        range_score = min(avg_range / 3 * 20, 20)
        
        # Component 4: Consecutive down bars (0-15 points)
        consec_score = min(consecutive_down * 3, 15)
        
        pressure = velocity_score + drop_score + range_score + consec_score
        pressure = min(100, max(0, pressure))
        pressure_history.append(round(pressure, 1))
    
    if not pressure_history:
        return SellingPressure(
            current_pressure=0,
            peak_pressure=0,
            pressure_change=0,
            pressure_trend='UNKNOWN',
            bars_since_peak_pressure=0,
            pressure_history=[]
        )
    
    current_pressure = pressure_history[-1]
    peak_pressure = max(pressure_history)
    peak_idx = pressure_history.index(peak_pressure)
    bars_since_peak = len(pressure_history) - 1 - peak_idx
    
    # Calculate pressure change over last 4 bars
    if len(pressure_history) >= 4:
        recent = pressure_history[-4:]
        pressure_change = recent[-1] - recent[0]
    else:
        pressure_change = 0
    
    # Determine trend
    if pressure_change < -10:
        pressure_trend = 'DECREASING'
    elif pressure_change > 10:
        pressure_trend = 'INCREASING'
    else:
        pressure_trend = 'STABLE'
    
    # Return last 10 readings for display
    recent_history = pressure_history[-10:] if len(pressure_history) >= 10 else pressure_history
    
    return SellingPressure(
        current_pressure=round(current_pressure, 1),
        peak_pressure=round(peak_pressure, 1),
        pressure_change=round(pressure_change, 1),
        pressure_trend=pressure_trend,
        bars_since_peak_pressure=bars_since_peak,
        pressure_history=recent_history
    )


def calculate_buying_pressure(
    data: List[OHLCV],
    lookback: int = 10
) -> SellingPressure:
    """
    Calculate buying pressure as a single objective number (0-100).
    Mirror of selling pressure but measuring UPWARD momentum.
    
    Buying Pressure combines:
    - Short-term velocity upward (how fast is it rising recently?)
    - Candle range (how big are the up moves?)
    - Consecutive up bars (sustained buying?)
    - Rise from recent low (how far has it rallied?)
    
    High pressure = strong buying (big, fast rallies)
    Low pressure = exhausted buying (buyers running out of steam)
    """
    if len(data) < lookback + 5:
        return SellingPressure(
            current_pressure=50,
            peak_pressure=50,
            pressure_change=0,
            pressure_trend='UNKNOWN',
            bars_since_peak_pressure=0,
            pressure_history=[]
        )
    
    pressure_history = []
    
    for i in range(lookback, len(data)):
        # Short-term velocity (3 bars) — POSITIVE = buying
        short_lookback = min(3, i)
        short_velocity = ((data[i].close - data[i - short_lookback].close) / data[i - short_lookback].close) * 100
        
        # Medium-term velocity
        med_velocity = ((data[i].close - data[i - lookback].close) / data[i - lookback].close) * 100
        
        # Rise from recent low (lowest low in last lookback*2 bars)
        recent_start = max(0, i - lookback * 2)
        recent_low = min(data[j].low for j in range(recent_start, i + 1))
        rise_from_low = ((data[i].close - recent_low) / recent_low) * 100  # Positive when above low
        
        # Count consecutive UP bars (close > open)
        consecutive_up = 0
        for j in range(i, max(0, i - 8), -1):
            if data[j].close > data[j].open:
                consecutive_up += 1
            else:
                break
        
        # Range: average candle size as % of price (last 5 bars)
        ranges = []
        for j in range(max(0, i - 5), i + 1):
            bar_range = (data[j].high - data[j].low) / data[j].close * 100
            ranges.append(bar_range)
        avg_range = sum(ranges) / len(ranges) if ranges else 0
        
        # === BUYING PRESSURE SCORE ===
        # Component 1: Short-term upward velocity (0-35 points)
        if short_velocity > 0:
            velocity_score = min(short_velocity / 5 * 35, 35)
        else:
            velocity_score = 0
        
        # Component 2: Rise from recent low (0-30 points)
        if rise_from_low > 0:
            rise_score = min(rise_from_low / 10 * 30, 30)
        else:
            rise_score = 0
        
        # Component 3: Candle range (0-20 points)
        range_score = min(avg_range / 3 * 20, 20)
        
        # Component 4: Consecutive up bars (0-15 points)
        consec_score = min(consecutive_up * 3, 15)
        
        pressure = velocity_score + rise_score + range_score + consec_score
        pressure = min(100, max(0, pressure))
        pressure_history.append(round(pressure, 1))
    
    if not pressure_history:
        return SellingPressure(
            current_pressure=0,
            peak_pressure=0,
            pressure_change=0,
            pressure_trend='UNKNOWN',
            bars_since_peak_pressure=0,
            pressure_history=[]
        )
    
    current_pressure = pressure_history[-1]
    peak_pressure = max(pressure_history)
    peak_idx = pressure_history.index(peak_pressure)
    bars_since_peak = len(pressure_history) - 1 - peak_idx
    
    # Calculate pressure change over last 4 bars
    if len(pressure_history) >= 4:
        recent = pressure_history[-4:]
        pressure_change = recent[-1] - recent[0]
    else:
        pressure_change = 0
    
    # Determine trend
    if pressure_change < -10:
        pressure_trend = 'DECREASING'
    elif pressure_change > 10:
        pressure_trend = 'INCREASING'
    else:
        pressure_trend = 'STABLE'
    
    recent_history = pressure_history[-10:] if len(pressure_history) >= 10 else pressure_history
    
    return SellingPressure(
        current_pressure=round(current_pressure, 1),
        peak_pressure=round(peak_pressure, 1),
        pressure_change=round(pressure_change, 1),
        pressure_trend=pressure_trend,
        bars_since_peak_pressure=bars_since_peak,
        pressure_history=recent_history
    )


def calculate_energy_state(
    data: List[OHLCV],
    lookback: int = 0,  # 0 = auto-detect from timeframe
    range_lookback: int = 0,  # 0 = auto-detect
    timeframe: str = 'W'  # Used for adaptive lookback
) -> EnergyState:
    """
    Calculate the current energy state of price action using physics principles.
    
    IMPROVED VERSION — all thresholds are normalized to the instrument's own
    volatility (ATR), so the same logic works on IBM (moves 2%/week) and
    ATOM (moves 15%/week). Acceleration is smoothed over multiple bars to
    reduce single-bar noise. Lookback adapts to timeframe.
    
    Velocity = Rate of price change (normalized to ATR)
    Acceleration = Smoothed change in velocity (normalized to ATR)
    Range = Energy per candle (compared to its own history)
    
    Character states:
    - STRONG: Fast move, still accelerating in the same direction
    - WANING: Fast move, but decelerating — momentum dying
    - EXHAUSTED: Slow move, compressed range — energy depleted
    - RECOVERING: Was slow, now accelerating — new energy entering
    - NEUTRAL: No clear energy signal
    """
    # === ADAPTIVE LOOKBACK ===
    # Shorter timeframes need longer lookback (more bars to see the same "time")
    # Longer timeframes need shorter lookback (each bar already covers more time)
    tf_lookback_map = {
        '1m': 20, '5m': 20, '15m': 16, '1h': 14,
        '4h': 12, '1d': 10, '1wk': 8, '1mo': 6
    }
    tf_range_map = {
        '1m': 10, '5m': 10, '15m': 8, '1h': 7,
        '4h': 6, '1d': 5, '1wk': 5, '1mo': 4
    }
    
    # Map common timeframe aliases
    tf_key = timeframe.lower().replace(' ', '')
    if tf_key in ('w', 'weekly'): tf_key = '1wk'
    elif tf_key in ('d', 'daily'): tf_key = '1d'
    elif tf_key in ('m', 'monthly'): tf_key = '1mo'
    elif tf_key in ('4h', '4hour'): tf_key = '4h'
    
    if lookback == 0:
        lookback = tf_lookback_map.get(tf_key, 10)
    if range_lookback == 0:
        range_lookback = tf_range_map.get(tf_key, 5)
    
    min_bars = lookback + range_lookback + 5
    if len(data) < min_bars:
        return EnergyState(
            velocity=0, acceleration=0, avg_range=0, range_compression=0,
            peak_velocity=0, peak_range=0, energy_score=50,
            character_state='UNKNOWN', direction='UNKNOWN',
            bars_since_peak=0, timestamp='', price=0
        )
    
    # === ATR CALCULATION (for normalization) ===
    # Use a longer window for stable ATR — 2x the lookback
    atr_window = min(lookback * 2, len(data) - 1)
    true_ranges = []
    for i in range(1, len(data)):
        high_low = data[i].high - data[i].low
        high_prev_close = abs(data[i].high - data[i - 1].close)
        low_prev_close = abs(data[i].low - data[i - 1].close)
        true_ranges.append(max(high_low, high_prev_close, low_prev_close))
    
    # ATR as percentage of price (makes it comparable across instruments)
    atr_pct_series = []
    for i, tr in enumerate(true_ranges):
        price = data[i + 1].close
        atr_pct_series.append((tr / price) * 100 if price > 0 else 0)
    
    # Current ATR (smoothed over atr_window)
    recent_atr = atr_pct_series[-atr_window:] if len(atr_pct_series) >= atr_window else atr_pct_series
    current_atr_pct = sum(recent_atr) / len(recent_atr) if recent_atr else 1.0
    current_atr_pct = max(current_atr_pct, 0.01)  # Floor to avoid division by zero
    
    # === VELOCITY (normalized to ATR) ===
    velocities = []
    for i in range(lookback, len(data)):
        price_now = data[i].close
        price_then = data[i - lookback].close
        raw_velocity = ((price_now - price_then) / price_then) * 100  # Raw % change
        velocities.append(raw_velocity)
    
    current_velocity_raw = velocities[-1] if velocities else 0
    
    # Normalize velocity: how many ATRs has price moved over the lookback?
    # This makes "fast" mean the same thing for IBM and ATOM
    velocity_in_atrs = current_velocity_raw / (current_atr_pct * (lookback ** 0.5))
    
    # Direction
    direction = 'UP' if current_velocity_raw > 0 else 'DOWN'
    
    # === ACCELERATION (smoothed, normalized) ===
    # Instead of single-bar diff, smooth over multiple bars to reduce noise
    accel_smooth = min(3, max(1, lookback // 3))  # Smooth window: 1/3 of lookback, min 1
    
    accelerations_raw = []
    for i in range(1, len(velocities)):
        accelerations_raw.append(velocities[i] - velocities[i - 1])
    
    if len(accelerations_raw) >= accel_smooth:
        # Smoothed acceleration = average of last N acceleration readings
        smoothed_accel = sum(accelerations_raw[-accel_smooth:]) / accel_smooth
    else:
        smoothed_accel = accelerations_raw[-1] if accelerations_raw else 0
    
    # Normalize acceleration to ATR as well
    accel_in_atrs = smoothed_accel / current_atr_pct if current_atr_pct > 0 else 0
    
    # Directional acceleration: positive = accelerating WITH the move, negative = decelerating
    dir_sign = 1 if direction == 'UP' else -1
    directional_accel = accel_in_atrs * dir_sign
    
    # === RANGE ANALYSIS ===
    ranges_pct = [(bar.high - bar.low) / bar.close * 100 for bar in data if bar.close > 0]
    current_avg_range = sum(ranges_pct[-range_lookback:]) / range_lookback if len(ranges_pct) >= range_lookback else 0
    
    # Peak range over a longer window
    peak_window = min(lookback * 4, len(ranges_pct))
    recent_ranges = ranges_pct[-peak_window:] if len(ranges_pct) >= peak_window else ranges_pct
    peak_range = max(recent_ranges) if recent_ranges else 1
    
    # Range compression: how compressed is current range vs. its own history
    range_compression = 1 - (current_avg_range / peak_range) if peak_range > 0 else 0
    range_compression = max(0, min(1, range_compression))
    
    # Range ratio: current range relative to ATR (>1 = expanding, <1 = contracting)
    range_ratio = current_avg_range / current_atr_pct if current_atr_pct > 0 else 1
    
    # === PEAK VELOCITY & BARS SINCE ===
    recent_velocities = velocities[-lookback:] if len(velocities) >= lookback else velocities
    peak_velocity_raw = max(abs(v) for v in recent_velocities) if recent_velocities else 0
    
    if velocities:
        abs_velocities = [abs(v) for v in velocities]
        peak_idx = abs_velocities.index(max(abs_velocities))
        bars_since_peak = len(velocities) - 1 - peak_idx
    else:
        bars_since_peak = 0
    
    # === ENERGY SCORE (0-100) ===
    # All components are now normalized, so weights are meaningful
    # Velocity component (0-40): how fast relative to normal
    vel_component = min(abs(velocity_in_atrs) / 2.0, 1.0) * 40  # 2 ATRs of movement = max score
    
    # Acceleration component (0-30): is momentum growing or shrinking?
    # Positive directional_accel = gaining energy in the direction of the move
    accel_component = (directional_accel + 1) / 2.0  # Map roughly -1..+1 to 0..1
    accel_component = max(0, min(1, accel_component)) * 30
    
    # Range component (0-30): how much energy per candle vs. its own history
    range_component = min(range_ratio, 2.0) / 2.0 * 30  # 2x ATR = max range score
    
    energy_score = vel_component + accel_component + range_component
    energy_score = max(0, min(100, energy_score))
    
    # === CHARACTER STATE (using normalized values) ===
    abs_vel_norm = abs(velocity_in_atrs)
    
    # STRONG: Moving fast (>1 ATR) and still accelerating
    if abs_vel_norm > 1.0 and directional_accel > 0.1:
        character_state = 'STRONG'
    # WANING: Moving fast (>0.5 ATR) but decelerating
    elif abs_vel_norm > 0.5 and directional_accel < -0.15:
        character_state = 'WANING'
    # EXHAUSTED: Slow movement AND compressed ranges
    elif abs_vel_norm < 0.5 and range_compression > 0.4:
        character_state = 'EXHAUSTED'
    # RECOVERING: Was slow, but now gaining momentum
    elif abs_vel_norm < 1.0 and directional_accel > 0.2:
        character_state = 'RECOVERING'
    else:
        character_state = 'NEUTRAL'
    
    return EnergyState(
        velocity=round(current_velocity_raw, 2),
        acceleration=round(smoothed_accel, 3),
        avg_range=round(current_avg_range, 2),
        range_compression=round(range_compression, 2),
        peak_velocity=round(peak_velocity_raw, 2),
        peak_range=round(peak_range, 2),
        energy_score=round(energy_score, 1),
        character_state=character_state,
        direction=direction,
        bars_since_peak=bars_since_peak,
        timestamp=data[-1].timestamp if data else '',
        price=data[-1].close if data else 0
    )


def detect_energy_swings(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    velocity_threshold: float = 2.0,  # Minimum velocity to consider significant
    exhaustion_threshold: float = 0.5  # Range compression level for exhaustion
) -> Tuple[List, List[EnergyState]]:
    """
    Detect swing points using energy state changes.
    
    Instead of fixed percentages, this detects when:
    1. A strong move occurs (high velocity)
    2. The move starts WANING (acceleration flips)
    3. Eventually becomes EXHAUSTED (range compression)
    4. Then shows RECOVERY signs (new acceleration)
    
    This captures the "character change" that humans naturally see.
    
    Returns:
        Tuple of (swing_points, energy_history)
    """
    from .swing_structure import ConfirmedSwingPoint

    swing_points = []
    energy_history = []
    
    if len(data) < 20:
        return swing_points, energy_history
    
    print(f"\n=== ENERGY-BASED SWING DETECTION: {symbol} ({timeframe}) ===", file=sys.stderr)
    
    # Track state machine
    in_uptrend = None  # None = unknown, True = up, False = down
    last_swing_idx = 0
    running_high_price = data[0].high
    running_high_idx = 0
    running_low_price = data[0].low
    running_low_idx = 0
    
    # Minimum bars between swings to avoid noise
    min_bars_between_swings = 4
    
    # Calculate energy state for each bar (starting after warmup period)
    for i in range(15, len(data)):
        # Get energy state at this point (adaptive to timeframe)
        energy = calculate_energy_state(data[:i+1], timeframe=timeframe)
        energy_history.append(energy)
        
        bar = data[i]
        
        # Update running high/low
        if bar.high > running_high_price:
            running_high_price = bar.high
            running_high_idx = i
        if bar.low < running_low_price:
            running_low_price = bar.low
            running_low_idx = i
        
        # Skip if too close to last swing
        if i - last_swing_idx < min_bars_between_swings:
            continue
        
        # === DETECT SWING HIGH ===
        # Was going UP strongly, now WANING or EXHAUSTED
        if in_uptrend is True or in_uptrend is None:
            if energy.direction == 'DOWN' and energy.character_state in ['WANING', 'EXHAUSTED']:
                # Confirm the running high as a swing high
                if running_high_idx > last_swing_idx:
                    swing = ConfirmedSwingPoint(
                        index=running_high_idx,
                        price=running_high_price,
                        date=data[running_high_idx].timestamp,
                        point_type='HIGH',
                        confirmed_by_index=i,
                        confirmed_by_date=bar.timestamp
                    )
                    swing_points.append(swing)
                    if _SCANNER_DEBUG: print(f"  SWING HIGH: ${running_high_price:.2f} at {data[running_high_idx].timestamp[:10]} "
                          f"(energy: {energy.character_state}, vel: {energy.velocity:.1f}%)", file=sys.stderr)
                    
                    last_swing_idx = i
                    in_uptrend = False
                    # Reset running low
                    running_low_price = bar.low
                    running_low_idx = i
        
        # === DETECT SWING LOW ===
        # Was going DOWN, now WANING or EXHAUSTED
        if in_uptrend is False or in_uptrend is None:
            if energy.direction == 'UP' and energy.character_state in ['WANING', 'EXHAUSTED', 'RECOVERING']:
                # Confirm the running low as a swing low
                if running_low_idx > last_swing_idx:
                    swing = ConfirmedSwingPoint(
                        index=running_low_idx,
                        price=running_low_price,
                        date=data[running_low_idx].timestamp,
                        point_type='LOW',
                        confirmed_by_index=i,
                        confirmed_by_date=bar.timestamp
                    )
                    swing_points.append(swing)
                    if _SCANNER_DEBUG: print(f"  SWING LOW: ${running_low_price:.2f} at {data[running_low_idx].timestamp[:10]} "
                          f"(energy: {energy.character_state}, vel: {energy.velocity:.1f}%)", file=sys.stderr)
                    
                    last_swing_idx = i
                    in_uptrend = True
                    # Reset running high
                    running_high_price = bar.high
                    running_high_idx = i
    
    if _SCANNER_DEBUG: print(f"\nFound {len(swing_points)} energy-based swings", file=sys.stderr)
    
    return swing_points, energy_history
