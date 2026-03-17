"""Swing structure analysis, trend classification, and regime detection."""

import os
import sys
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass

from .ohlcv import OHLCV, _detect_intraday, _format_chart_time

_SCANNER_DEBUG = os.environ.get("SCANNER_DEBUG", "").lower() in ("1", "true", "yes")

_BACKTEST_MODE = False

def set_backtest_mode(enabled: bool) -> None:
    """Toggle backtest mode to suppress verbose diagnostic prints."""
    global _BACKTEST_MODE
    _BACKTEST_MODE = enabled

__all__ = [
    "set_backtest_mode",
    "ConfirmedSwingPoint",
    "SwingStructure",
    "_build_swing_structure",
    "detect_confirmed_swing_points",
    "detect_swing_points_with_fallback",
    "serialize_swing_structure",
    "_linear_regression_slope",
    "detect_regime_windows",
    "find_major_peaks",
]


@dataclass
class ConfirmedSwingPoint:
    """A confirmed swing high or low with exact values."""
    index: int
    price: float
    date: str
    point_type: str  # 'HIGH' or 'LOW'
    confirmed_by_index: Optional[int] = None  # Index where this was confirmed
    confirmed_by_date: Optional[str] = None


@dataclass
class SwingStructure:
    """Complete swing structure analysis for a chart."""
    symbol: str
    timeframe: str
    swing_points: List[ConfirmedSwingPoint]
    current_peak: Optional[ConfirmedSwingPoint]
    current_low: Optional[ConfirmedSwingPoint]
    prior_peak: Optional[ConfirmedSwingPoint]
    prior_low: Optional[ConfirmedSwingPoint]
    current_price: float
    current_date: str
    status: str  # 'EXTENSION' or 'PULLBACK'
    retracement_70: Optional[float]  # 70% retracement level
    retracement_79: Optional[float]  # 79% retracement level
    in_buy_zone: bool
    mode: str = "MAJOR"  # 'MAJOR' (strict structure breaks) or 'RELATIVE' (% based fallback)
    # Trend classification fields
    absolute_low: Optional[float] = None  # All-time low price
    absolute_low_date: Optional[str] = None  # Date of all-time low
    absolute_high: Optional[float] = None  # All-time high price
    absolute_high_date: Optional[str] = None  # Date of all-time high
    primary_trend: str = "UNKNOWN"  # 'UPTREND', 'DOWNTREND', or 'SIDEWAYS' based on last 3-4 swing points
    intermediate_trend: str = "UNKNOWN"  # 'UPTREND', 'DOWNTREND', or 'SIDEWAYS' based on last 2 swings
    trend_alignment: str = "UNKNOWN"  # 'ALIGNED' (both agree) or 'CONFLICTING' (primary vs intermediate disagree)


def _build_swing_structure(
    symbol: str,
    timeframe: str,
    swing_points: List[ConfirmedSwingPoint],
    data: List[OHLCV],
    mode: str = "MAJOR",
    verbose: bool = True
) -> SwingStructure:
    """Helper to build SwingStructure from swing points."""
    if _BACKTEST_MODE:
        verbose = False
    # Sort swing points by index
    swing_points.sort(key=lambda p: p.index)
    
    # Get peaks and lows separately
    peaks = [p for p in swing_points if p.point_type == 'HIGH']
    lows = [p for p in swing_points if p.point_type == 'LOW']
    
    # Identify current and prior peaks/lows
    current_peak = peaks[-1] if peaks else None
    prior_peak = peaks[-2] if len(peaks) >= 2 else None
    current_low = lows[-1] if lows else None
    prior_low = lows[-2] if len(lows) >= 2 else None
    
    # Current price and date
    current_price = data[-1].close if data else 0
    current_date = data[-1].timestamp if data else ""
    
    # === ABSOLUTE HIGH/LOW OF ENTIRE DATASET ===
    absolute_low = min(bar.low for bar in data) if data else None
    absolute_low_idx = next((i for i, bar in enumerate(data) if bar.low == absolute_low), None) if data else None
    absolute_low_date = data[absolute_low_idx].timestamp if absolute_low_idx is not None else None
    
    absolute_high = max(bar.high for bar in data) if data else None
    absolute_high_idx = next((i for i, bar in enumerate(data) if bar.high == absolute_high), None) if data else None
    absolute_high_date = data[absolute_high_idx].timestamp if absolute_high_idx is not None else None
    
    # === PRIMARY TREND ===
    # Based on the RECENT swing structure — what's the dominant direction of the last 3-4 swings?
    # This matches what a human sees on the chart.
    primary_trend = "UNKNOWN"
    
    if len(lows) >= 3 and len(peaks) >= 3:
        # Use last 3 swing lows and last 3 swing highs for a broader view
        recent_lows = [l.price for l in lows[-3:]]
        recent_highs = [h.price for h in peaks[-3:]]
        
        # Count how many consecutive higher lows / higher highs
        hl_count = sum(1 for i in range(1, len(recent_lows)) if recent_lows[i] > recent_lows[i-1])
        hh_count = sum(1 for i in range(1, len(recent_highs)) if recent_highs[i] > recent_highs[i-1])
        ll_count = sum(1 for i in range(1, len(recent_lows)) if recent_lows[i] < recent_lows[i-1])
        lh_count = sum(1 for i in range(1, len(recent_highs)) if recent_highs[i] < recent_highs[i-1])
        
        up_score = hl_count + hh_count    # higher lows + higher highs = uptrend
        down_score = ll_count + lh_count  # lower lows + lower highs = downtrend
        
        if up_score > down_score:
            primary_trend = "UPTREND"
        elif down_score > up_score:
            primary_trend = "DOWNTREND"
        else:
            primary_trend = "SIDEWAYS"
    elif len(lows) >= 2 and len(peaks) >= 2:
        # Fewer swings: compare last two
        last_low = lows[-1].price
        prev_low = lows[-2].price
        last_peak = peaks[-1].price
        prev_peak = peaks[-2].price
        
        if last_low > prev_low and last_peak > prev_peak:
            primary_trend = "UPTREND"
        elif last_low < prev_low and last_peak < prev_peak:
            primary_trend = "DOWNTREND"
        else:
            primary_trend = "SIDEWAYS"
    elif data:
        # Not enough swings: compare current price to midpoint of range
        current = data[-1].close
        mid = (absolute_low + absolute_high) / 2 if absolute_low and absolute_high else current
        if current > mid:
            primary_trend = "UPTREND"
        else:
            primary_trend = "DOWNTREND"
    
    # === INTERMEDIATE TREND ===
    # Based on the last 2 swing highs and lows — the most recent direction
    intermediate_trend = "UNKNOWN"
    
    if len(peaks) >= 2 and len(lows) >= 2:
        # Compare last two peaks and last two lows
        last_peak = peaks[-1].price
        prev_peak = peaks[-2].price
        last_low = lows[-1].price
        prev_low = lows[-2].price
        
        higher_high = last_peak > prev_peak
        higher_low = last_low > prev_low
        lower_high = last_peak < prev_peak
        lower_low = last_low < prev_low
        
        if higher_high and higher_low:
            intermediate_trend = "UPTREND"
        elif lower_high and lower_low:
            intermediate_trend = "DOWNTREND"
        else:
            intermediate_trend = "SIDEWAYS"
    
    # === TREND ALIGNMENT ===
    # Are primary and intermediate trends in agreement?
    trend_alignment = "UNKNOWN"
    if primary_trend != "UNKNOWN" and intermediate_trend != "UNKNOWN":
        if primary_trend == intermediate_trend:
            trend_alignment = "ALIGNED"
        elif intermediate_trend == "SIDEWAYS":
            trend_alignment = "NEUTRAL"
        else:
            trend_alignment = "CONFLICTING"
    
    # Determine status: EXTENSION or PULLBACK
    status = "UNKNOWN"
    if current_peak:
        if current_price > current_peak.price:
            status = "EXTENSION"
        else:
            status = "PULLBACK"
    
    # Calculate retracement levels (from current peak to prior low)
    retracement_70 = None
    retracement_79 = None
    in_buy_zone = False
    
    if current_peak and current_low:
        move = current_peak.price - current_low.price
        retracement_70 = current_peak.price - (move * 0.70)
        retracement_79 = current_peak.price - (move * 0.79)
        
        # Check if current price is in the 70-79% buy zone
        if retracement_79 <= current_price <= retracement_70:
            in_buy_zone = True
    
    if verbose:
        print(f"\n--- STRUCTURE SUMMARY ---", file=sys.stderr)
        print(f"Found {len(peaks)} peaks, {len(lows)} lows", file=sys.stderr)
        if current_peak:
            print(f"Current Peak: ${current_peak.price:.2f} ({current_peak.date[:10]})", file=sys.stderr)
        if current_low:
            print(f"Current Low: ${current_low.price:.2f} ({current_low.date[:10]})", file=sys.stderr)
        print(f"Current Price: ${current_price:.2f}", file=sys.stderr)
        print(f"Status: {status}", file=sys.stderr)
        if retracement_70 and retracement_79:
            print(f"70% Level: ${retracement_70:.2f}", file=sys.stderr)
            print(f"79% Level: ${retracement_79:.2f}", file=sys.stderr)
            print(f"In Buy Zone: {in_buy_zone}", file=sys.stderr)
        
        # Print trend classification
        print(f"\n--- TREND CLASSIFICATION ---", file=sys.stderr)
        print(f"Absolute Low: ${absolute_low:.2f} ({absolute_low_date[:10] if absolute_low_date else 'N/A'})", file=sys.stderr)
        print(f"Absolute High: ${absolute_high:.2f} ({absolute_high_date[:10] if absolute_high_date else 'N/A'})", file=sys.stderr)
        print(f"Primary Trend: {primary_trend}", file=sys.stderr)
        print(f"Intermediate Trend: {intermediate_trend}", file=sys.stderr)
        print(f"Trend Alignment: {trend_alignment}", file=sys.stderr)
    
    return SwingStructure(
        symbol=symbol,
        timeframe=timeframe,
        swing_points=swing_points,
        current_peak=current_peak,
        current_low=current_low,
        prior_peak=prior_peak,
        prior_low=prior_low,
        current_price=current_price,
        current_date=current_date,
        status=status,
        retracement_70=retracement_70,
        retracement_79=retracement_79,
        in_buy_zone=in_buy_zone,
        mode=mode,
        absolute_low=absolute_low,
        absolute_low_date=absolute_low_date,
        absolute_high=absolute_high,
        absolute_high_date=absolute_high_date,
        primary_trend=primary_trend,
        intermediate_trend=intermediate_trend,
        trend_alignment=trend_alignment
    )


def detect_confirmed_swing_points(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    subsequent_peak_decline: float = 0.25,  # 25% decline to confirm subsequent peaks
    first_peak_decline: float = 0.50,  # First peak requires 50% decline to confirm
    verbose: bool = True
) -> SwingStructure:
    """
    Detect CONFIRMED swing highs and lows using structure-break logic.
    
    Algorithm:
    1. Find the ABSOLUTE LOW of the entire chart - this is the first anchor
    2. First PEAK: Track running high from that low. 
       Confirmed when price drops 50%+ from the running high (first_peak_decline)
    3. After first peak, use BREAK-ABOVE confirmation:
       - New HIGH = when price breaks ABOVE the prior confirmed high
       - New LOW = lowest point between two confirmed highs
    
    This creates a clean structure of Higher Highs and Higher Lows (or Lower).
    
    Returns:
        SwingStructure with all confirmed swing points and current status
    """
    if _BACKTEST_MODE:
        verbose = False
    if len(data) < 10:
        return SwingStructure(
            symbol=symbol,
            timeframe=timeframe,
            swing_points=[],
            current_peak=None,
            current_low=None,
            prior_peak=None,
            prior_low=None,
            current_price=data[-1].close if data else 0,
            current_date=data[-1].timestamp if data else "",
            status="UNKNOWN",
            retracement_70=None,
            retracement_79=None,
            in_buy_zone=False
        )
    
    swing_points: List[ConfirmedSwingPoint] = []
    
    # STEP 1: Find the absolute LOW of the entire chart
    absolute_low_price = data[0].low
    absolute_low_idx = 0
    for i in range(len(data)):
        if data[i].low < absolute_low_price:
            absolute_low_price = data[i].low
            absolute_low_idx = i
    
    # Record the first LOW
    first_low = ConfirmedSwingPoint(
        index=absolute_low_idx,
        price=absolute_low_price,
        date=data[absolute_low_idx].timestamp,
        point_type='LOW',
        confirmed_by_index=absolute_low_idx,
        confirmed_by_date=data[absolute_low_idx].timestamp
    )
    swing_points.append(first_low)
    
    if verbose:
        print(f"\n=== SWING STRUCTURE v2: {symbol} ({timeframe}) ===", file=sys.stderr)
        print(f"Step 1: Absolute LOW = ${absolute_low_price:.2f} at index {absolute_low_idx} ({data[absolute_low_idx].timestamp[:10]})", file=sys.stderr)
    
    # STEP 2: Find the FIRST PEAK after the absolute low
    # Track running high from the low, confirm when price drops 50%+ from it
    running_high_price = absolute_low_price
    running_high_idx = absolute_low_idx
    first_peak_confirmed = False
    first_peak_idx = None
    first_peak_price = None
    
    confirmation_idx = None
    for i in range(absolute_low_idx + 1, len(data)):
        bar = data[i]
        
        # Track new highs
        if bar.high > running_high_price:
            running_high_price = bar.high
            running_high_idx = i
        
        # Check for 50%+ decline from running high
        if running_high_price > 0:
            decline = (running_high_price - bar.low) / running_high_price
            
            if decline >= first_peak_decline:
                # FIRST PEAK CONFIRMED!
                first_peak_confirmed = True
                first_peak_idx = running_high_idx
                first_peak_price = running_high_price
                confirmation_idx = i
                
                peak = ConfirmedSwingPoint(
                    index=first_peak_idx,
                    price=first_peak_price,
                    date=data[first_peak_idx].timestamp,
                    point_type='HIGH',
                    confirmed_by_index=i,
                    confirmed_by_date=bar.timestamp
                )
                swing_points.append(peak)
                
                if verbose:
                    print(f"Step 2: First PEAK confirmed = ${first_peak_price:.2f} at index {first_peak_idx} ({data[first_peak_idx].timestamp[:10]})", file=sys.stderr)
                    print(f"        Confirmed by {decline:.1%} decline at index {i}", file=sys.stderr)
                break
    
    if not first_peak_confirmed:
        if verbose:
            print(f"No first peak found (no 50%+ decline from any high)", file=sys.stderr)
        # Still return the structure with just the first low
        return _build_swing_structure(symbol, timeframe, swing_points, data, mode="MAJOR", verbose=verbose)
    
    # Find the actual LOW after the first peak
    # LOW = lowest point before price recovers above the first peak level
    # Scan until we find where price closes above first_peak_price, take lowest low before that
    first_low_after_peak_price = data[confirmation_idx].low
    first_low_after_peak_idx = confirmation_idx
    recovery_idx = len(data)  # Default to end if no recovery found
    
    for j in range(confirmation_idx, len(data)):
        # Track the lowest low
        if data[j].low < first_low_after_peak_price:
            first_low_after_peak_price = data[j].low
            first_low_after_peak_idx = j
        # Stop when price closes above the first peak level (recovery)
        if data[j].close > first_peak_price:
            recovery_idx = j
            break
    
    # Record this as the first LOW after the peak
    first_low_after_peak = ConfirmedSwingPoint(
        index=first_low_after_peak_idx,
        price=first_low_after_peak_price,
        date=data[first_low_after_peak_idx].timestamp,
        point_type='LOW',
        confirmed_by_index=first_low_after_peak_idx,
        confirmed_by_date=data[first_low_after_peak_idx].timestamp
    )
    swing_points.append(first_low_after_peak)
    
    if verbose:
        print(f"        First LOW after peak = ${first_low_after_peak_price:.2f} at {data[first_low_after_peak_idx].timestamp[:10]}", file=sys.stderr)
        print(f"        (Recovery above ${first_peak_price:.2f} at index {recovery_idx})", file=sys.stderr)
    
    # STEP 3: After first peak, use PERCENTAGE-BASED confirmation
    # Rule: Price must drop subsequent_peak_decline% from the running high to confirm a new peak
    # This catches significant pullbacks (2020 COVID, 2022 bear market, etc.)
    
    if verbose:
        print(f"Step 3: Scanning for subsequent peaks...", file=sys.stderr)
        print(f"  Rule: Confirm peak when price drops {subsequent_peak_decline:.0%} from running high", file=sys.stderr)
    
    # IMPORTANT: Start scanning from AFTER the first low, not after the peak
    scan_start = first_low_after_peak_idx + 1
    
    # Track the running high from the first low
    running_high_price = first_low_after_peak_price
    running_high_idx = first_low_after_peak_idx
    last_confirmed_type = 'LOW'  # We just confirmed a low
    
    for i in range(scan_start, len(data)):
        bar = data[i]
        
        # Update running high if we see a new high
        if bar.high > running_high_price:
            running_high_price = bar.high
            running_high_idx = i
        
        # Check for swing HIGH confirmation (price dropped X% from running high)
        if last_confirmed_type == 'LOW' and running_high_price > 0:
            decline_from_high = (running_high_price - bar.low) / running_high_price
            
            if decline_from_high >= subsequent_peak_decline:
                # Confirm the swing HIGH
                peak = ConfirmedSwingPoint(
                    index=running_high_idx,
                    price=running_high_price,
                    date=data[running_high_idx].timestamp,
                    point_type='HIGH',
                    confirmed_by_index=i,
                    confirmed_by_date=bar.timestamp
                )
                swing_points.append(peak)
                if verbose:
                    print(f"  -> PEAK: ${running_high_price:.2f} at {data[running_high_idx].timestamp[:10]} (confirmed by {decline_from_high:.1%} drop)", file=sys.stderr)
                
                last_confirmed_type = 'HIGH'
                # Reset running low tracking
                running_low_price = bar.low
                running_low_idx = i
        
        # Track running low after a confirmed high
        if last_confirmed_type == 'HIGH':
            if 'running_low_price' not in dir() or bar.low < running_low_price:
                running_low_price = bar.low
                running_low_idx = i
            
            # Check for swing LOW confirmation (price rose X% from running low)
            if running_low_price > 0:
                rise_from_low = (bar.high - running_low_price) / running_low_price
                
                if rise_from_low >= subsequent_peak_decline:
                    # Confirm the swing LOW
                    low = ConfirmedSwingPoint(
                        index=running_low_idx,
                        price=running_low_price,
                        date=data[running_low_idx].timestamp,
                        point_type='LOW',
                        confirmed_by_index=i,
                        confirmed_by_date=bar.timestamp
                    )
                    swing_points.append(low)
                    if verbose:
                        print(f"  -> LOW: ${running_low_price:.2f} at {data[running_low_idx].timestamp[:10]} (confirmed by {rise_from_low:.1%} rise)", file=sys.stderr)
                    
                    last_confirmed_type = 'LOW'
                    # Reset running high tracking
                    running_high_price = bar.high
                    running_high_idx = i
    
    # Build and return the swing structure
    return _build_swing_structure(symbol, timeframe, swing_points, data, mode="MAJOR", verbose=verbose)


def detect_swing_points_with_fallback(
    data: List[OHLCV],
    symbol: str = "UNKNOWN",
    timeframe: str = "W",
    first_peak_decline: float = 0.50,
    relative_threshold: float = 0.20,
    min_major_highs: int = 2,
    epsilon_pct: float = 0.05,
    verbose: bool = True
) -> SwingStructure:
    """
    Detect swing points with automatic fallback from MAJOR to RDP mode.
    
    Primary Rule (MAJOR):
        Uses strict structure-break logic requiring 50%+ decline to confirm peaks.
        Works well for instruments with clear major structure.
    
    Fallback Rule (RDP):
        If < min_major_highs swing highs found, falls back to Ramer-Douglas-Peucker
        line simplification which finds the essential shape of the price curve.
        Works for any instrument regardless of volatility or trend character.
    
    Args:
        data: OHLCV price data
        symbol: Ticker symbol
        timeframe: Timeframe label
        first_peak_decline: Decline required to confirm first peak in MAJOR mode
        relative_threshold: Percentage move for legacy RELATIVE mode (unused if fastrdp available)
        min_major_highs: Minimum swing highs needed to use MAJOR mode
        epsilon_pct: RDP sensitivity as percentage of price range (0.05 = 5%)
    
    Returns:
        SwingStructure with mode set to "MAJOR" or "RDP" (or "RELATIVE" if fastrdp unavailable)
    """
    from .rdp import detect_swings_rdp, detect_relative_swing_points

    if _BACKTEST_MODE:
        verbose = False
    if verbose:
        print(f"\n=== SWING POINT DETECTION WITH FALLBACK ===", file=sys.stderr)
        print(f"Symbol: {symbol} ({timeframe})", file=sys.stderr)
        print(f"Primary rule: MAJOR (requires {first_peak_decline:.0%} decline to confirm peak)", file=sys.stderr)
        if _SCANNER_DEBUG: print(f"Fallback rule: RDP (epsilon={epsilon_pct:.1%} of price range)", file=sys.stderr)
        print(f"Fallback triggers if < {min_major_highs} swing highs found", file=sys.stderr)
    
    # Try MAJOR mode first
    structure = detect_confirmed_swing_points(
        data=data,
        symbol=symbol,
        timeframe=timeframe,
        first_peak_decline=first_peak_decline,
        verbose=verbose
    )
    
    # Count swing highs
    num_highs = len([p for p in structure.swing_points if p.point_type == 'HIGH'])
    
    if num_highs >= min_major_highs:
        if verbose:
            print(f"\n✓ MAJOR mode: Found {num_highs} swing highs (>= {min_major_highs})", file=sys.stderr)
        return structure
    else:
        if verbose:
            print(f"\n✗ MAJOR mode: Only {num_highs} swing highs (< {min_major_highs})", file=sys.stderr)
            print(f"→ Falling back to RDP mode...", file=sys.stderr)
        
        # Fallback to RDP mode (or legacy RELATIVE if fastrdp not installed)
        structure = detect_swings_rdp(
            data=data,
            symbol=symbol,
            timeframe=timeframe,
            epsilon_pct=epsilon_pct
        )
        
        num_highs_rdp = len([p for p in structure.swing_points if p.point_type == 'HIGH'])
        if verbose:
            print(f"\n✓ {structure.mode} mode: Found {num_highs_rdp} swing highs", file=sys.stderr)
        
        return structure


def serialize_swing_structure(structure: SwingStructure, data: List[OHLCV] = None) -> Dict[str, Any]:
    """Convert SwingStructure to JSON-serializable dict for frontend."""
    result = {
        'symbol': structure.symbol,
        'timeframe': structure.timeframe,
        'status': structure.status,
        'mode': structure.mode,  # 'MAJOR' or 'RELATIVE'
        'current_price': structure.current_price,
        'current_date': structure.current_date[:10] if structure.current_date else None,
        'in_buy_zone': structure.in_buy_zone,
        'retracement_70': structure.retracement_70,
        'retracement_79': structure.retracement_79,
        
        # Trend classification
        'absolute_low': structure.absolute_low,
        'absolute_low_date': structure.absolute_low_date[:10] if structure.absolute_low_date else None,
        'absolute_high': structure.absolute_high,
        'absolute_high_date': structure.absolute_high_date[:10] if structure.absolute_high_date else None,
        'primary_trend': structure.primary_trend,
        'intermediate_trend': structure.intermediate_trend,
        'trend_alignment': structure.trend_alignment,
        
        # All swing points for charting
        'swing_points': [
            {
                'index': p.index,
                'price': p.price,
                'date': p.date[:10] if p.date else None,
                'type': p.point_type
            }
            for p in structure.swing_points
        ],
        
        # Key levels
        'current_peak': {
            'index': structure.current_peak.index,
            'price': structure.current_peak.price,
            'date': structure.current_peak.date[:10]
        } if structure.current_peak else None,
        
        'prior_peak': {
            'index': structure.prior_peak.index,
            'price': structure.prior_peak.price,
            'date': structure.prior_peak.date[:10]
        } if structure.prior_peak else None,
        
        'current_low': {
            'index': structure.current_low.index,
            'price': structure.current_low.price,
            'date': structure.current_low.date[:10]
        } if structure.current_low else None,
        
        'prior_low': {
            'index': structure.prior_low.index,
            'price': structure.prior_low.price,
            'date': structure.prior_low.date[:10]
        } if structure.prior_low else None,
    }
    
    # Include chart data
    if data:
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
        result['chart_data'] = chart_data
    
    return result


def _linear_regression_slope(values: List[float]) -> float:
    """Simple least-squares slope per bar."""
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    num = 0.0
    den = 0.0
    for i, y in enumerate(values):
        dx = i - x_mean
        num += dx * (y - y_mean)
        den += dx * dx
    if den == 0:
        return 0.0
    return num / den


def detect_regime_windows(
    data: List[OHLCV],
    lookback: int = 26,
    min_window_bars: int = 8
) -> Dict[str, Any]:
    """
    Classify rolling market regime using:
    - volatility (avg absolute return)
    - regression slope (trend direction/intensity)
    - directional persistence

    Returns compressed regime windows and current regime.
    """
    if len(data) < max(lookback + 2, 20):
        return {
            "current_regime": "unknown",
            "windows": [],
            "allowed_windows": {"expansion": [], "accumulation": [], "distribution": []},
            "lookback_bars": lookback,
        }

    closes = [float(b.close) for b in data]
    labels: List[Dict[str, Any]] = []

    for i in range(lookback, len(closes)):
        window = closes[i - lookback + 1:i + 1]
        if not window or window[0] <= 0:
            continue

        slope = _linear_regression_slope(window)
        slope_pct_per_bar = (slope / window[0]) * 100.0

        rets: List[float] = []
        for j in range(1, len(window)):
            prev = window[j - 1]
            cur = window[j]
            if prev <= 0:
                continue
            rets.append(((cur - prev) / prev) * 100.0)

        if not rets:
            continue

        avg_abs_ret = sum(abs(r) for r in rets) / len(rets)
        persistence = sum(1 for r in rets if r > 0) / len(rets)
        w_min = min(window)
        w_max = max(window)
        w_avg = sum(window) / len(window)
        range_pct = ((w_max - w_min) / w_avg * 100.0) if w_avg > 0 else 0.0

        if abs(slope_pct_per_bar) <= 0.08 and avg_abs_ret <= 2.5 and range_pct <= 18.0:
            regime = "accumulation"
        elif slope_pct_per_bar >= 0.08 and persistence >= 0.55 and avg_abs_ret >= 0.6:
            regime = "expansion"
        elif slope_pct_per_bar <= -0.05 and persistence <= 0.45 and avg_abs_ret >= 0.8:
            regime = "distribution"
        else:
            regime = "transition"

        labels.append({
            "index": i,
            "regime": regime,
            "slope_pct_per_bar": slope_pct_per_bar,
            "avg_abs_ret_pct": avg_abs_ret,
            "persistence_up": persistence,
            "range_pct": range_pct,
        })

    windows: List[Dict[str, Any]] = []
    if labels:
        cur = labels[0]
        run: List[Dict[str, Any]] = [cur]
        for row in labels[1:]:
            if row["regime"] == cur["regime"]:
                run.append(row)
            else:
                if cur["regime"] != "transition" and len(run) >= min_window_bars:
                    s_idx = run[0]["index"]
                    e_idx = run[-1]["index"]
                    windows.append({
                        "regime": cur["regime"],
                        "start_index": s_idx,
                        "end_index": e_idx,
                        "start_date": data[s_idx].timestamp[:10],
                        "end_date": data[e_idx].timestamp[:10],
                        "bars": len(run),
                        "avg_slope_pct_per_bar": round(sum(r["slope_pct_per_bar"] for r in run) / len(run), 4),
                        "avg_volatility_pct": round(sum(r["avg_abs_ret_pct"] for r in run) / len(run), 4),
                        "avg_persistence_up": round(sum(r["persistence_up"] for r in run) / len(run), 4),
                    })
                cur = row
                run = [row]
        if cur["regime"] != "transition" and len(run) >= min_window_bars:
            s_idx = run[0]["index"]
            e_idx = run[-1]["index"]
            windows.append({
                "regime": cur["regime"],
                "start_index": s_idx,
                "end_index": e_idx,
                "start_date": data[s_idx].timestamp[:10],
                "end_date": data[e_idx].timestamp[:10],
                "bars": len(run),
                "avg_slope_pct_per_bar": round(sum(r["slope_pct_per_bar"] for r in run) / len(run), 4),
                "avg_volatility_pct": round(sum(r["avg_abs_ret_pct"] for r in run) / len(run), 4),
                "avg_persistence_up": round(sum(r["persistence_up"] for r in run) / len(run), 4),
            })

    current_regime = "unknown"
    for row in reversed(labels):
        if row["regime"] != "transition":
            current_regime = row["regime"]
            break
    if current_regime == "unknown" and labels:
        current_regime = labels[-1]["regime"]

    allowed_windows = {
        "expansion": [{"start_date": w["start_date"], "end_date": w["end_date"], "bars": w["bars"]} for w in windows if w["regime"] == "expansion"],
        "accumulation": [{"start_date": w["start_date"], "end_date": w["end_date"], "bars": w["bars"]} for w in windows if w["regime"] == "accumulation"],
        "distribution": [{"start_date": w["start_date"], "end_date": w["end_date"], "bars": w["bars"]} for w in windows if w["regime"] == "distribution"],
    }

    return {
        "current_regime": current_regime,
        "windows": windows,
        "allowed_windows": allowed_windows,
        "lookback_bars": lookback,
    }


def find_major_peaks(
    data: List[OHLCV],
    min_prominence: float = 0.15,  # Peak must be 15% higher than surrounding
    lookback: int = 50  # How many bars to look back for context
) -> List[Tuple[int, float]]:
    """
    Find major peaks (prior highs) in the data.
    A major peak is a high that stands out significantly from surrounding price action.
    
    Returns:
        List of (index, price) tuples for major peaks
    """
    from .rdp import detect_swing_highs_lows

    peaks = []
    n = len(data)
    
    # Use larger pivot window for major peaks
    swing_highs, _ = detect_swing_highs_lows(data, left_bars=10, right_bars=10)
    
    for idx in swing_highs:
        peak_high = data[idx].high
        
        # Check prominence: peak should be significantly higher than prices before and after
        # Look at the lowest low in the lookback window before the peak
        start_lookback = max(0, idx - lookback)
        lows_before = [data[i].low for i in range(start_lookback, idx)]
        
        # Look at the lowest low in the lookforward window after the peak
        end_lookforward = min(n, idx + lookback)
        lows_after = [data[i].low for i in range(idx + 1, end_lookforward)]
        
        if not lows_before or not lows_after:
            continue
        
        min_before = min(lows_before)
        min_after = min(lows_after)
        
        # Calculate prominence (how much the peak stands out)
        rise_before = (peak_high - min_before) / min_before if min_before > 0 else 0
        drop_after = (peak_high - min_after) / peak_high if peak_high > 0 else 0
        
        # Peak is major if it rose significantly AND dropped significantly after
        if rise_before >= min_prominence and drop_after >= min_prominence:
            peaks.append((idx, peak_high))
    
    return peaks
