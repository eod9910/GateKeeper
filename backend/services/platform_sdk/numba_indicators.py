"""
Compiled indicator functions — Numba @njit (C speed).

All functions accept/return numpy float64 arrays.
Import and call from any plugin wrapper:

    from .numba_indicators import sma, ema, rsi, atr, bollinger_bands, macd
    from .numba_indicators import crossover, crossunder, rolling_max, rolling_min
    from .numba_indicators import drawdown, stochastic, williams_r, vwap

Two-layer pattern for plugins:
    Layer 1 (@njit): pure numeric math on arrays — compiled to machine code
    Layer 2 (Python): convert OHLCV → arrays, call layer 1, build candidate dicts
"""
from __future__ import annotations

import numpy as np
from numba import njit


# ─────────────────────────────────────────────────────────────────────────────
# Moving Averages
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def sma(closes: np.ndarray, period: int) -> np.ndarray:
    """Simple Moving Average."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        total = 0.0
        for j in range(period):
            total += closes[i - j]
        out[i] = total / period
    return out


@njit(cache=True)
def ema(closes: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if n < period:
        return out
    mult = 2.0 / (period + 1.0)
    total = 0.0
    for j in range(period):
        total += closes[j]
    out[period - 1] = total / period
    for i in range(period, n):
        out[i] = (closes[i] - out[i - 1]) * mult + out[i - 1]
    return out


@njit(cache=True)
def wma(closes: np.ndarray, period: int) -> np.ndarray:
    """Weighted Moving Average (linearly weighted)."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    weight_sum = period * (period + 1) / 2.0
    for i in range(period - 1, n):
        total = 0.0
        for j in range(period):
            total += closes[i - j] * (period - j)
        out[i] = total / weight_sum
    return out


@njit(cache=True)
def dema(closes: np.ndarray, period: int) -> np.ndarray:
    """Double Exponential Moving Average: 2*EMA - EMA(EMA)."""
    e1 = ema(closes, period)
    e2 = ema(e1, period)
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(n):
        if not np.isnan(e1[i]) and not np.isnan(e2[i]):
            out[i] = 2.0 * e1[i] - e2[i]
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Momentum / Oscillators
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """Relative Strength Index (Wilder smoothed)."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if n <= period:
        return out

    gains = np.empty(n, dtype=np.float64)
    losses = np.empty(n, dtype=np.float64)
    gains[0] = 0.0
    losses[0] = 0.0
    for i in range(1, n):
        ch = closes[i] - closes[i - 1]
        if ch > 0.0:
            gains[i] = ch
            losses[i] = 0.0
        else:
            gains[i] = 0.0
            losses[i] = -ch

    avg_gain = 0.0
    avg_loss = 0.0
    for j in range(1, period + 1):
        avg_gain += gains[j]
        avg_loss += losses[j]
    avg_gain /= period
    avg_loss /= period

    if avg_loss == 0.0:
        out[period] = 100.0
    else:
        out[period] = 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)

    for i in range(period + 1, n):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0.0:
            out[i] = 100.0
        else:
            out[i] = 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)

    return out


@njit(cache=True)
def macd(
    closes: np.ndarray,
    fast_period: int = 12,
    slow_period: int = 26,
    signal_period: int = 9,
) -> tuple:
    """MACD. Returns (macd_line, signal_line, histogram)."""
    fast_e = ema(closes, fast_period)
    slow_e = ema(closes, slow_period)
    n = len(closes)

    macd_line = np.empty(n, dtype=np.float64)
    macd_line[:] = np.nan
    for i in range(slow_period - 1, n):
        if not np.isnan(fast_e[i]) and not np.isnan(slow_e[i]):
            macd_line[i] = fast_e[i] - slow_e[i]

    signal_line = ema(macd_line, signal_period)

    histogram = np.empty(n, dtype=np.float64)
    histogram[:] = np.nan
    for i in range(n):
        if not np.isnan(macd_line[i]) and not np.isnan(signal_line[i]):
            histogram[i] = macd_line[i] - signal_line[i]

    return macd_line, signal_line, histogram


@njit(cache=True)
def stochastic(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    k_period: int = 14,
    d_period: int = 3,
) -> tuple:
    """Stochastic Oscillator. Returns (%K, %D)."""
    n = len(closes)
    k = np.empty(n, dtype=np.float64)
    k[:] = np.nan

    for i in range(k_period - 1, n):
        lowest = lows[i]
        highest = highs[i]
        for j in range(k_period):
            if lows[i - j] < lowest:
                lowest = lows[i - j]
            if highs[i - j] > highest:
                highest = highs[i - j]
        denom = highest - lowest
        if denom > 0.0:
            k[i] = 100.0 * (closes[i] - lowest) / denom
        else:
            k[i] = 50.0

    d = sma(k, d_period)
    return k, d


@njit(cache=True)
def williams_r(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    period: int = 14,
) -> np.ndarray:
    """Williams %R."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        highest = highs[i]
        lowest = lows[i]
        for j in range(period):
            if highs[i - j] > highest:
                highest = highs[i - j]
            if lows[i - j] < lowest:
                lowest = lows[i - j]
        denom = highest - lowest
        if denom > 0.0:
            out[i] = -100.0 * (highest - closes[i]) / denom
        else:
            out[i] = -50.0
    return out


@njit(cache=True)
def cci(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    period: int = 20,
) -> np.ndarray:
    """Commodity Channel Index."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        typical = np.empty(period, dtype=np.float64)
        for j in range(period):
            k = i - (period - 1 - j)
            typical[j] = (highs[k] + lows[k] + closes[k]) / 3.0
        tp_mean = 0.0
        for j in range(period):
            tp_mean += typical[j]
        tp_mean /= period
        mean_dev = 0.0
        for j in range(period):
            mean_dev += abs(typical[j] - tp_mean)
        mean_dev /= period
        tp_now = (highs[i] + lows[i] + closes[i]) / 3.0
        if mean_dev > 0.0:
            out[i] = (tp_now - tp_mean) / (0.015 * mean_dev)
        else:
            out[i] = 0.0
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Volatility
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def atr(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    period: int = 14,
) -> np.ndarray:
    """Average True Range (Wilder smoothed)."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    tr = np.empty(n, dtype=np.float64)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        tr[i] = max(hl, max(hc, lc))

    total = 0.0
    for j in range(period):
        total += tr[j]
    out[period - 1] = total / period
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


@njit(cache=True)
def bollinger_bands(
    closes: np.ndarray,
    period: int = 20,
    num_std: float = 2.0,
) -> tuple:
    """Bollinger Bands. Returns (middle, upper, lower)."""
    n = len(closes)
    middle = np.empty(n, dtype=np.float64)
    upper = np.empty(n, dtype=np.float64)
    lower = np.empty(n, dtype=np.float64)
    middle[:] = np.nan
    upper[:] = np.nan
    lower[:] = np.nan

    for i in range(period - 1, n):
        total = 0.0
        for j in range(period):
            total += closes[i - j]
        mean = total / period
        middle[i] = mean
        var_sum = 0.0
        for j in range(period):
            d = closes[i - j] - mean
            var_sum += d * d
        std = (var_sum / period) ** 0.5
        upper[i] = mean + num_std * std
        lower[i] = mean - num_std * std

    return middle, upper, lower


@njit(cache=True)
def keltner_channels(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    ema_period: int = 20,
    atr_period: int = 10,
    multiplier: float = 2.0,
) -> tuple:
    """Keltner Channels. Returns (middle, upper, lower)."""
    middle = ema(closes, ema_period)
    a = atr(highs, lows, closes, atr_period)
    n = len(closes)
    upper = np.empty(n, dtype=np.float64)
    lower = np.empty(n, dtype=np.float64)
    upper[:] = np.nan
    lower[:] = np.nan
    for i in range(n):
        if not np.isnan(middle[i]) and not np.isnan(a[i]):
            upper[i] = middle[i] + multiplier * a[i]
            lower[i] = middle[i] - multiplier * a[i]
    return middle, upper, lower


# ─────────────────────────────────────────────────────────────────────────────
# Volume
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def obv(closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
    """On-Balance Volume."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    out[0] = volumes[0]
    for i in range(1, n):
        if closes[i] > closes[i - 1]:
            out[i] = out[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            out[i] = out[i - 1] - volumes[i]
        else:
            out[i] = out[i - 1]
    return out


@njit(cache=True)
def vwap(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    volumes: np.ndarray,
) -> np.ndarray:
    """Cumulative VWAP from bar 0 (use for daily or anchor-based VWAP)."""
    n = len(closes)
    out = np.empty(n, dtype=np.float64)
    cum_tp_vol = 0.0
    cum_vol = 0.0
    for i in range(n):
        tp = (highs[i] + lows[i] + closes[i]) / 3.0
        cum_tp_vol += tp * volumes[i]
        cum_vol += volumes[i]
        if cum_vol > 0.0:
            out[i] = cum_tp_vol / cum_vol
        else:
            out[i] = closes[i]
    return out


@njit(cache=True)
def volume_ratio(volumes: np.ndarray, period: int = 20) -> np.ndarray:
    """Volume relative to its SMA (ratio > 1 means above-average volume)."""
    avg = sma(volumes, period)
    n = len(volumes)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(n):
        if not np.isnan(avg[i]) and avg[i] > 0.0:
            out[i] = volumes[i] / avg[i]
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Signal Detection
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def crossover(series_a: np.ndarray, series_b: np.ndarray) -> np.ndarray:
    """Indices where series_a crosses ABOVE series_b."""
    n = len(series_a)
    signals = np.empty(n, dtype=np.int64)
    count = 0
    for i in range(1, n):
        if np.isnan(series_a[i]) or np.isnan(series_b[i]):
            continue
        if np.isnan(series_a[i - 1]) or np.isnan(series_b[i - 1]):
            continue
        if series_a[i] > series_b[i] and series_a[i - 1] <= series_b[i - 1]:
            signals[count] = i
            count += 1
    return signals[:count]


@njit(cache=True)
def crossunder(series_a: np.ndarray, series_b: np.ndarray) -> np.ndarray:
    """Indices where series_a crosses BELOW series_b."""
    n = len(series_a)
    signals = np.empty(n, dtype=np.int64)
    count = 0
    for i in range(1, n):
        if np.isnan(series_a[i]) or np.isnan(series_b[i]):
            continue
        if np.isnan(series_a[i - 1]) or np.isnan(series_b[i - 1]):
            continue
        if series_a[i] < series_b[i] and series_a[i - 1] >= series_b[i - 1]:
            signals[count] = i
            count += 1
    return signals[:count]


@njit(cache=True)
def threshold_cross_above(series: np.ndarray, level: float) -> np.ndarray:
    """Indices where series crosses above a constant level."""
    n = len(series)
    signals = np.empty(n, dtype=np.int64)
    count = 0
    for i in range(1, n):
        if np.isnan(series[i]) or np.isnan(series[i - 1]):
            continue
        if series[i] > level and series[i - 1] <= level:
            signals[count] = i
            count += 1
    return signals[:count]


@njit(cache=True)
def threshold_cross_below(series: np.ndarray, level: float) -> np.ndarray:
    """Indices where series crosses below a constant level."""
    n = len(series)
    signals = np.empty(n, dtype=np.int64)
    count = 0
    for i in range(1, n):
        if np.isnan(series[i]) or np.isnan(series[i - 1]):
            continue
        if series[i] < level and series[i - 1] >= level:
            signals[count] = i
            count += 1
    return signals[:count]


# ─────────────────────────────────────────────────────────────────────────────
# Rolling Window Utilities
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def rolling_max(arr: np.ndarray, period: int) -> np.ndarray:
    """Rolling maximum over a lookback window."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        mx = arr[i]
        for j in range(1, period):
            if arr[i - j] > mx:
                mx = arr[i - j]
        out[i] = mx
    return out


@njit(cache=True)
def rolling_min(arr: np.ndarray, period: int) -> np.ndarray:
    """Rolling minimum over a lookback window."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        mn = arr[i]
        for j in range(1, period):
            if arr[i - j] < mn:
                mn = arr[i - j]
        out[i] = mn
    return out


@njit(cache=True)
def rolling_std(arr: np.ndarray, period: int) -> np.ndarray:
    """Rolling standard deviation."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        total = 0.0
        for j in range(period):
            total += arr[i - j]
        mean = total / period
        var = 0.0
        for j in range(period):
            d = arr[i - j] - mean
            var += d * d
        out[i] = (var / period) ** 0.5
    return out


@njit(cache=True)
def highest_bars_back(arr: np.ndarray, period: int) -> np.ndarray:
    """Bars since the period-high was set (0 = current bar is the high)."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        mx_idx = i
        for j in range(1, period):
            if arr[i - j] > arr[mx_idx]:
                mx_idx = i - j
        out[i] = float(i - mx_idx)
    return out


@njit(cache=True)
def lowest_bars_back(arr: np.ndarray, period: int) -> np.ndarray:
    """Bars since the period-low was set (0 = current bar is the low)."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    for i in range(period - 1, n):
        mn_idx = i
        for j in range(1, period):
            if arr[i - j] < arr[mn_idx]:
                mn_idx = i - j
        out[i] = float(i - mn_idx)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Drawdown / Risk
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def drawdown(closes: np.ndarray) -> tuple:
    """
    Drawdown series from the running equity curve peak.
    Returns (drawdown_pct_series, max_drawdown_pct).
    Negative values: dd[i] = -0.20 means 20% below the prior peak.
    """
    n = len(closes)
    dd = np.empty(n, dtype=np.float64)
    running_max = closes[0]
    max_dd = 0.0
    for i in range(n):
        if closes[i] > running_max:
            running_max = closes[i]
        if running_max > 0.0:
            dd[i] = (closes[i] - running_max) / running_max
        else:
            dd[i] = 0.0
        if dd[i] < max_dd:
            max_dd = dd[i]
    return dd, max_dd


@njit(cache=True)
def sharpe_ratio(returns: np.ndarray, risk_free_rate: float = 0.0) -> float:
    """Annualised Sharpe ratio from a daily-return series."""
    n = len(returns)
    if n < 2:
        return 0.0
    mean_r = 0.0
    for i in range(n):
        mean_r += returns[i]
    mean_r /= n
    excess = mean_r - risk_free_rate / 252.0
    var = 0.0
    for i in range(n):
        d = returns[i] - mean_r
        var += d * d
    var /= n
    std = var ** 0.5
    if std == 0.0:
        return 0.0
    return excess / std * (252.0 ** 0.5)


@njit(cache=True)
def sortino_ratio(returns: np.ndarray, risk_free_rate: float = 0.0) -> float:
    """Sortino ratio (penalises only downside volatility)."""
    n = len(returns)
    if n < 2:
        return 0.0
    mean_r = 0.0
    for i in range(n):
        mean_r += returns[i]
    mean_r /= n
    excess = mean_r - risk_free_rate / 252.0
    down_var = 0.0
    count = 0
    for i in range(n):
        if returns[i] < 0.0:
            down_var += returns[i] * returns[i]
            count += 1
    if count == 0:
        return 0.0
    down_std = (down_var / count) ** 0.5
    if down_std == 0.0:
        return 0.0
    return excess / down_std * (252.0 ** 0.5)


# ─────────────────────────────────────────────────────────────────────────────
# RDP-specific helpers (compiled versions of inner loops)
# ─────────────────────────────────────────────────────────────────────────────

@njit(cache=True)
def count_rdp_swings(indices: np.ndarray, closes: np.ndarray) -> tuple:
    """
    Count swing highs/lows among interior RDP points and find last swing index.
    Used inside the adaptive epsilon search loop in patternScanner.

    Args:
        indices: array of integer bar indices returned by the RDP algorithm
        closes:  full close-price array

    Returns:
        (swing_count, last_swing_bar_index)
    """
    m = len(indices)
    count = 0
    last_idx = 0
    for k in range(1, m - 1):
        prev_c = closes[indices[k - 1]]
        curr_c = closes[indices[k]]
        next_c = closes[indices[k + 1]]
        is_high = curr_c > prev_c and curr_c > next_c
        is_low = curr_c < prev_c and curr_c < next_c
        if is_high or is_low:
            count += 1
            last_idx = indices[k]
    return count, last_idx


@njit(cache=True)
def classify_rdp_swings(
    indices: np.ndarray,
    closes: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
) -> tuple:
    """
    Classify interior RDP points as HIGH or LOW, returning their bar indices
    and the actual high/low prices (wick extremes).

    Returns:
        (swing_bar_indices, swing_prices, swing_types)
        where swing_types: 1 = HIGH, -1 = LOW
    """
    m = len(indices)
    max_out = m
    out_indices = np.empty(max_out, dtype=np.int64)
    out_prices = np.empty(max_out, dtype=np.float64)
    out_types = np.empty(max_out, dtype=np.int64)
    count = 0

    for k in range(1, m - 1):
        prev_c = closes[indices[k - 1]]
        curr_c = closes[indices[k]]
        next_c = closes[indices[k + 1]]
        if curr_c > prev_c and curr_c > next_c:
            out_indices[count] = indices[k]
            out_prices[count] = highs[indices[k]]
            out_types[count] = 1
            count += 1
        elif curr_c < prev_c and curr_c < next_c:
            out_indices[count] = indices[k]
            out_prices[count] = lows[indices[k]]
            out_types[count] = -1
            count += 1

    return out_indices[:count], out_prices[:count], out_types[:count]


# ─────────────────────────────────────────────────────────────────────────────
# Warm-up helper
# ─────────────────────────────────────────────────────────────────────────────

def warmup_all() -> None:
    """
    Trigger JIT compilation for all functions by calling each once with
    tiny dummy arrays. Call on service startup so first real request is fast.
    """
    dummy_n = 300
    c = np.random.rand(dummy_n).astype(np.float64) + 10.0
    h = c + np.random.rand(dummy_n).astype(np.float64) * 0.5
    lo = c - np.random.rand(dummy_n).astype(np.float64) * 0.5
    v = np.random.rand(dummy_n).astype(np.float64) * 1_000_000.0

    sma(c, 20)
    ema(c, 20)
    wma(c, 20)
    dema(c, 20)
    rsi(c, 14)
    macd(c, 12, 26, 9)
    stochastic(h, lo, c, 14, 3)
    williams_r(h, lo, c, 14)
    cci(h, lo, c, 20)
    atr(h, lo, c, 14)
    bollinger_bands(c, 20, 2.0)
    keltner_channels(h, lo, c, 20, 10, 2.0)
    obv(c, v)
    vwap(h, lo, c, v)
    volume_ratio(v, 20)
    crossover(sma(c, 20), sma(c, 50))
    crossunder(sma(c, 20), sma(c, 50))
    threshold_cross_above(rsi(c, 14), 50.0)
    threshold_cross_below(rsi(c, 14), 50.0)
    rolling_max(c, 20)
    rolling_min(c, 20)
    rolling_std(c, 20)
    highest_bars_back(c, 20)
    lowest_bars_back(c, 20)
    drawdown(c)
    sharpe_ratio(np.diff(c) / c[:-1])
    sortino_ratio(np.diff(c) / c[:-1])

    idx = np.array([0, 10, 50, 100, 150, 200, 250, 299], dtype=np.int64)
    count_rdp_swings(idx, c)
    classify_rdp_swings(idx, c, h, lo)
