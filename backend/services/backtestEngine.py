#!/usr/bin/env python3
"""
Backtest engine for Validator V1.
Deterministic bar-by-bar simulation with optional execution rule effects.
"""

from __future__ import annotations

import contextlib
import io
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from strategyRunner import run_strategy
from platform_sdk.ohlcv import OHLCV
from platform_sdk.rdp import precompute_rdp_for_backtest
from plugins.regime_filter import precompute_regime_timeline


@dataclass
class TradeResult:
    trade_id: str
    symbol: str
    timeframe: str
    direction: str
    entry_time: str
    entry_price: float
    entry_bar_index: int
    stop_price: float
    stop_distance: float
    exit_time: str
    exit_price: float
    exit_bar_index: int
    exit_reason: str
    R_multiple: float
    pnl_gross: float
    pnl_net: float
    fees_applied: float
    slippage_applied: float
    setup_type: str
    anchors_snapshot: Dict[str, Any]


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except Exception:
        return default


def get_backtest_config(spec: Dict[str, Any]) -> Dict[str, Any]:
    risk_cfg = spec.get("risk_config") or {}
    exit_cfg = spec.get("exit_config") or {}
    entry_cfg = spec.get("entry_config") or {}
    cost_cfg = spec.get("cost_config") or spec.get("costs") or {}
    setup_cfg = spec.get("setup_config") or {}
    backtest_cfg = spec.get("backtest_config") or {}

    stop_type = str(risk_cfg.get("stop_type", "percentage")).strip().lower()

    stop_pct = _safe_float(risk_cfg.get("stop_value", 0.08))
    if stop_pct <= 0:
        stop_pct = 0.08
    if stop_pct > 0.5:
        stop_pct = 0.5

    # ATR stop settings
    atr_length = int(risk_cfg.get("atr_length", 14) or 14)
    atr_multiplier = _safe_float(risk_cfg.get("atr_multiplier", 1.5))
    if atr_multiplier <= 0:
        atr_multiplier = 1.5
    trailing_atr = bool(risk_cfg.get("trailing_atr", False))

    target_type = str(exit_cfg.get("target_type", "")).strip().lower()
    if target_type == "r_multiple":
        tp_r = _safe_float(exit_cfg.get("target_level", 0.0))
    else:
        tp_r = _safe_float(risk_cfg.get("take_profit_R", 2.0))
    if tp_r <= 0:
        tp_r = 2.0

    max_hold = int(risk_cfg.get("max_hold_bars", 30) or 30)
    if max_hold < 1:
        max_hold = 30

    slippage_pct = _safe_float(cost_cfg.get("slippage_pct", 0.05)) / 100.0
    commission = _safe_float(cost_cfg.get("commission_per_trade", 1.0))

    enter_next_open = bool(entry_cfg.get("enter_next_open", True))

    direction = str(
        backtest_cfg.get("direction")
        or setup_cfg.get("direction")
        or risk_cfg.get("direction")
        or "long"
    ).strip().lower()
    if direction not in ("long", "short"):
        direction = "long"

    return {
        "stop_type": stop_type,
        "stop_pct": stop_pct,
        "atr_length": atr_length,
        "atr_multiplier": atr_multiplier,
        "trailing_atr": trailing_atr,
        "tp_r": tp_r,
        "max_hold": max_hold,
        "slippage_pct": slippage_pct,
        "commission": commission,
        "enter_next_open": enter_next_open,
        "direction": direction,
    }


def _compute_sma(values: List[float], period: int) -> List[float]:
    out = [0.0] * len(values)
    running = 0.0
    for i, v in enumerate(values):
        running += v
        if i >= period:
            running -= values[i - period]
        if i >= period - 1:
            out[i] = running / period
    return out


def _compute_ema(values: List[float], period: int) -> List[float]:
    out = [0.0] * len(values)
    if period <= 1 or not values:
        return values[:]
    alpha = 2.0 / (period + 1.0)
    out[0] = values[0]
    for i in range(1, len(values)):
        out[i] = (alpha * values[i]) + ((1.0 - alpha) * out[i - 1])
    return out


def _compute_atr(
    highs: List[float], lows: List[float], closes: List[float], period: int = 14
) -> List[float]:
    """Compute Average True Range. Returns list same length as input, 0.0 for early bars."""
    n = len(closes)
    atr = [0.0] * n
    if n < 2 or period < 1:
        return atr

    tr_values: List[float] = [0.0]
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        tr_values.append(max(hl, hc, lc))

    if n <= period:
        avg = sum(tr_values) / n if n > 0 else 0.0
        return [avg] * n

    first_atr = sum(tr_values[1:period + 1]) / period
    atr[period] = first_atr
    for i in range(period + 1, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr_values[i]) / period

    for i in range(period):
        atr[i] = atr[period]

    return atr


def _ma_crossover_signal_indices(setup_cfg: Dict[str, Any], closes: List[float]) -> set[int]:
    if len(closes) < 3:
        return set()

    fast_period = int(setup_cfg.get("fast_period", setup_cfg.get("short_period", 50)) or 50)
    slow_period = int(setup_cfg.get("slow_period", setup_cfg.get("long_period", 200)) or 200)
    if fast_period <= 1 or slow_period <= 1 or fast_period >= slow_period or len(closes) < slow_period + 1:
        return set()

    ma_type = str(setup_cfg.get("ma_type", "sma")).strip().lower()
    cross_direction = str(setup_cfg.get("cross_direction", "bullish")).strip().lower()
    if cross_direction not in ("bullish", "bearish"):
        cross_direction = "bullish"

    if ma_type == "ema":
        fast = _compute_ema(closes, fast_period)
        slow = _compute_ema(closes, slow_period)
    else:
        fast = _compute_sma(closes, fast_period)
        slow = _compute_sma(closes, slow_period)

    out: set[int] = set()
    start = max(fast_period, slow_period)
    for i in range(start, len(closes)):
        f_prev = fast[i - 1]
        s_prev = slow[i - 1]
        f_now = fast[i]
        s_now = slow[i]

        if cross_direction == "bullish":
            crossed = f_now > s_now and f_prev <= s_prev
        else:
            crossed = f_now < s_now and f_prev >= s_prev

        if crossed:
            out.add(i)
    return out


def _bars_to_ohlcv(bars: List[Dict[str, Any]]) -> List[OHLCV]:
    out: List[OHLCV] = []
    for b in bars:
        out.append(
            OHLCV(
                timestamp=str(b.get("timestamp") or ""),
                open=_safe_float(b.get("open")),
                high=_safe_float(b.get("high")),
                low=_safe_float(b.get("low")),
                close=_safe_float(b.get("close")),
                volume=_safe_float(b.get("volume"), 0.0),
            )
        )
    return out


def _legacy_sma_signal_indices(closes: List[float]) -> set[int]:
    if len(closes) < 51:
        return set()
    sma20 = _compute_sma(closes, 20)
    sma50 = _compute_sma(closes, 50)
    out: set[int] = set()
    for i in range(50, len(closes)):
        c = closes[i]
        c_prev = closes[i - 1]
        signal = (c > sma20[i] > sma50[i]) and (c > c_prev * 1.003)
        if signal:
            out.add(i)
    return out


def _entry_signal_indices_from_spec(
    symbol: str,
    timeframe: str,
    bars: List[Dict[str, Any]],
    spec: Dict[str, Any],
) -> set[int]:
    setup_cfg = spec.get("setup_config") or {}
    backtest_cfg = spec.get("backtest_config") or {}
    pattern_type = str(setup_cfg.get("pattern_type") or "").strip()
    signal_source = str(backtest_cfg.get("signal_source") or "").strip().lower()

    closes = [_safe_float(b.get("close")) for b in bars]
    if signal_source == "legacy_sma":
        return _legacy_sma_signal_indices(closes)

    # Fast path for MA crossover indicators used by plugin/strategy workflows.
    # This avoids expensive per-bar run_strategy() prefix calls.
    pattern_key = pattern_type.lower()
    if (
        ("crossover" in pattern_key or "cross" in pattern_key)
        and (
            "ma" in pattern_key
            or "sma" in pattern_key
            or "ema" in pattern_key
            or "moving_average" in pattern_key
            or "golden_cross" in pattern_key
        )
    ):
        return _ma_crossover_signal_indices(setup_cfg, closes)

    if not pattern_type:
        # Legacy compatibility for underspecified specs.
        return _legacy_sma_signal_indices(closes)

    if len(bars) < 2:
        return set()

    min_history = int((spec.get("backtest_config") or {}).get("min_history_bars", 60) or 60)
    min_history = max(10, min_history)
    setup = spec.get("setup_config") or {}
    struct = spec.get("structure_config") or {}
    causal_window = int(
        backtest_cfg.get(
            "causal_window_bars",
            max(
                250,
                int(setup.get("markdown_lookback", 300) or 300)
                + int(setup.get("pullback_lookforward", 200) or 200)
                + int(setup.get("markup_lookforward", 100) or 100)
                + int(struct.get("base_max_duration", 500) or 500)
                + int(setup.get("peak_lookback", 50) or 50)
                + 50,
            ),
        )
        or 1200
    )
    causal_window = max(100, causal_window)

    # Step size for the sliding window. Checking every bar is exact but slow;
    # for weekly data every 3rd bar still captures all meaningful entry signals
    # since a valid setup persists for several bars.  Can be overridden via
    # backtest_config.window_step in the strategy spec.
    window_step = max(1, int((spec.get("backtest_config") or {}).get("window_step", 1) or 1))

    ohlcv = _bars_to_ohlcv(bars)
    signals: set[int] = set()

    # ── Precompute RDP on full dataset (Phase 1D optimisation) ────────────────
    # Skip for plugins that don't need structure extraction (e.g. MA crossover).
    # Also skip when the full dataset is much longer than the causal window —
    # auto-adapt on 2700 bars finds ~7 mega-swings that are too coarse for
    # 1200-bar sliding windows. Per-window auto-adapt gives correct granularity.
    _setup = spec.get("setup_config") or {}
    _role = str(_setup.get("indicator_role", "") or spec.get("indicator_role", "") or "").strip().lower()
    _roles_skip_rdp = {"timing_trigger", "momentum", "oscillator", "structure_filter", "filter"}
    _data_to_window_ratio = len(ohlcv) / causal_window if causal_window > 0 else 1.0
    if _role not in _roles_skip_rdp and _data_to_window_ratio <= 1.5:
        struct_cfg = spec.get("structure_config") or {}
        _epsilon_pct = float(struct_cfg.get("swing_epsilon_pct", 0.05))
        try:
            precompute_rdp_for_backtest(ohlcv, symbol, timeframe, _epsilon_pct)
        except Exception:
            pass  # non-fatal; falls back to per-bar RDP

    # ── Precompute regime timeline for any regime_filter stages ───────────────
    # If the composite spec contains a regime_filter node with a reference_symbol,
    # build the full (confirmation_date → regime) timeline ONCE before the loop.
    # The plugin then looks up regime at each bar's date with zero lookahead bias —
    # only swings confirmed BEFORE that date are considered.
    _composite_spec = (spec.get("setup_config") or {}).get("composite_spec") or {}
    for _node in (_composite_spec.get("nodes") or _composite_spec.get("stages") or []):
        if _node.get("pattern_id") == "regime_filter":
            _node_params = _node.get("params", {}) or {}
            _ref_sym = _node_params.get("reference_symbol") or None
            _ref_eps = float(_node_params.get("epsilon_pct", 0.05))
            _maj_pct = float(_node_params.get("majority_pct", 0.6))
            if _ref_sym:
                try:
                    precompute_regime_timeline(_ref_sym, timeframe, _ref_eps, _maj_pct)
                except Exception:
                    pass  # non-fatal

    for i in range(min_history, len(ohlcv), window_step):
        pass  # was: debug print every 100 bars
        window_start = max(0, (i + 1) - causal_window)
        prefix = ohlcv[window_start : i + 1]
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                candidates = run_strategy(spec, prefix, symbol, timeframe, mode="backtest")
        except NotImplementedError:
            # Fallback for older runner behavior.
            with contextlib.redirect_stderr(io.StringIO()):
                candidates = run_strategy(spec, prefix, symbol, timeframe, mode="scan")
        if not candidates:
            continue

        for c in candidates:
            if not bool(c.get("entry_ready")):
                continue
            anchors = c.get("anchors") or {}
            second_breakout = anchors.get("second_breakout") or c.get("second_breakout") or {}
            brk_idx = second_breakout.get("index") if isinstance(second_breakout, dict) else None
            if brk_idx is not None:
                abs_brk = window_start + int(brk_idx)
                # Accept signals within the last window_step bars so we don't
                # miss breakouts that fell on skipped bars.
                if i - window_step < abs_brk <= i:
                    signals.add(abs_brk)
                    break
            else:
                # Composite returned entry_ready=True but no second_breakout anchor
                # (e.g. RDP Fib Pullback RSI which uses swing/fib/RSI anchors).
                # Treat the current bar as the signal bar.
                signals.add(i)
                break

    return signals


def _empty_exec_stats() -> Dict[str, Any]:
    return {
        "rules_active": False,
        "breakeven_triggers": 0,
        "ladder_lock_triggers": 0,
        "green_to_red_exits": 0,
        "scale_out_triggers": 0,
        "time_stop_exits": 0,
        "profit_retrace_exits": 0,
        "daily_cap_triggers": 0,
        "avg_giveback_from_peak_R": 0.0,
        "pct_trades_hitting_breakeven": 0.0,
        "pct_trades_hitting_scale_out": 0.0,
        "expectancy_without_rules_R": 0.0,
        "expectancy_with_rules_R": 0.0,
    }


def _apply_execution_rules(
    execution_config: Dict[str, Any],
    current_r: float,
    peak_r: float,
    entry_price: float,
    stop_distance: float,
    stop_price: float,
    bars_in_trade: int,
) -> Tuple[float, str | None, Dict[str, int]]:
    counters = {
        "breakeven": 0,
        "ladder": 0,
        "g2r": 0,
        "time_stop": 0,
        "profit_retrace": 0,
        "scale_out": 0,
    }

    new_stop = stop_price
    forced_exit_reason: str | None = None

    # 1) time stop
    ts = execution_config.get("time_stop") or {}
    if ts:
        max_days = int(ts.get("max_days_in_trade", 999999) or 999999)
        max_loss_pct = _safe_float(ts.get("max_loss_pct", -9999.0))
        pnl_pct = current_r * 100.0
        if bars_in_trade >= max_days and pnl_pct <= max_loss_pct:
            forced_exit_reason = "time"
            counters["time_stop"] += 1
            return new_stop, forced_exit_reason, counters

    # 2) profit retrace exit
    pre = execution_config.get("profit_retrace_exit") or {}
    if pre:
        arm = _safe_float(pre.get("peak_r", 9999.0))
        giveback_limit = _safe_float(pre.get("giveback_r", 9999.0))
        giveback = peak_r - current_r
        if peak_r >= arm and giveback >= giveback_limit:
            forced_exit_reason = "trailing"
            counters["profit_retrace"] += 1
            return new_stop, forced_exit_reason, counters

    # 3) green-to-red protection
    g2r = execution_config.get("green_to_red_protection") or {}
    if g2r:
        trigger = _safe_float(g2r.get("trigger_r", 9999.0))
        floor = _safe_float(g2r.get("floor_r", -9999.0))
        action = str(g2r.get("action", "close_market"))
        if peak_r >= trigger and current_r <= floor:
            if action == "move_stop":
                new_stop = max(new_stop, entry_price)
            else:
                forced_exit_reason = "trailing"
            counters["g2r"] += 1
            if forced_exit_reason:
                return new_stop, forced_exit_reason, counters

    # 4) auto breakeven
    be = execution_config.get("auto_breakeven_r")
    if be is not None and current_r >= _safe_float(be):
        be_stop = entry_price
        if be_stop > new_stop:
            new_stop = be_stop
            counters["breakeven"] += 1

    # 5) lock ladder
    ladder = execution_config.get("lock_in_r_ladder") or []
    best_lock_r = None
    for rung in ladder:
        at_r = _safe_float(rung.get("at_r", 9999.0))
        lock_r = _safe_float(rung.get("lock_r", -9999.0))
        if current_r >= at_r:
            if best_lock_r is None or lock_r > best_lock_r:
                best_lock_r = lock_r
    if best_lock_r is not None:
        ladder_stop = entry_price + (best_lock_r * stop_distance)
        if ladder_stop > new_stop:
            new_stop = ladder_stop
            counters["ladder"] += 1

    # 6) scale-out trigger tracking (no quantity simulation in v1)
    sorules = execution_config.get("scale_out_rules") or []
    for sr in sorules:
        at_mult = _safe_float(sr.get("at_multiple", 9999.0))
        if current_r >= (at_mult - 1.0):
            counters["scale_out"] += 1
            break

    return new_stop, forced_exit_reason, counters


def run_backtest_on_bars(
    symbol: str,
    timeframe: str,
    bars: List[Dict[str, Any]],
    spec: Dict[str, Any],
    apply_execution_rules: bool = True,
    signal_indices: set[int] | None = None,
) -> Tuple[List[TradeResult], Dict[str, Any]]:
    stats = _empty_exec_stats()

    if len(bars) < 60:
        return [], stats

    cfg = get_backtest_config(spec)
    signal_indices = signal_indices or _entry_signal_indices_from_spec(symbol, timeframe, bars, spec)
    if not signal_indices:
        return [], stats

    # Pre-compute ATR if needed
    use_atr = cfg["stop_type"] in ("atr", "atr_multiple")
    atr_values: List[float] = []
    if use_atr:
        all_highs = [_safe_float(b.get("high")) for b in bars]
        all_lows = [_safe_float(b.get("low")) for b in bars]
        all_closes = [_safe_float(b.get("close")) for b in bars]
        atr_values = _compute_atr(all_highs, all_lows, all_closes, cfg["atr_length"])

    execution_cfg = spec.get("execution_config") if apply_execution_rules else None
    rules_active = bool(execution_cfg)
    stats["rules_active"] = rules_active

    trades: List[TradeResult] = []
    trade_counter = 0
    givebacks: List[float] = []
    trades_hit_be = 0
    trades_hit_scale = 0

    i = min(signal_indices)
    while i < len(bars) - 2:
        # causal setup uses only i and prior values
        signal = i in signal_indices
        if not signal:
            i += 1
            continue

        entry_idx = i + 1 if cfg["enter_next_open"] else i
        if entry_idx >= len(bars):
            break

        entry_bar = bars[entry_idx]
        signal_close = _safe_float(bars[i].get("close"))
        entry_price = _safe_float(entry_bar.get("open" if cfg["enter_next_open"] else "close"), signal_close)
        is_short = cfg["direction"] == "short"

        if use_atr:
            atr_at_entry = atr_values[min(i, len(atr_values) - 1)]
            stop_dist = max(atr_at_entry * cfg["atr_multiplier"], entry_price * 0.005)
        else:
            stop_dist = entry_price * cfg["stop_pct"]

        if is_short:
            stop_price = entry_price + stop_dist
            target_price = entry_price - (stop_dist * cfg["tp_r"])
        else:
            stop_price = entry_price - stop_dist
            target_price = entry_price + (stop_dist * cfg["tp_r"])
        
        initial_stop_dist = stop_dist

        exit_idx = None
        exit_price = entry_price
        exit_reason = "end_of_data"

        peak_r = -9999.0
        be_hit_for_trade = False
        scale_hit_for_trade = False

        max_j = min(len(bars) - 1, entry_idx + cfg["max_hold"])
        for j in range(entry_idx + 1, max_j + 1):
            bar = bars[j]
            low = _safe_float(bar.get("low"), entry_price)
            high = _safe_float(bar.get("high"), entry_price)
            close = _safe_float(bar.get("close"), entry_price)

            # current/peak R from close snapshot
            if is_short:
                current_r = (entry_price - close) / initial_stop_dist
            else:
                current_r = (close - entry_price) / initial_stop_dist
            if current_r > peak_r:
                peak_r = current_r

            # Trailing ATR stop: tighten stop as price moves in our favor
            if use_atr and cfg["trailing_atr"] and j < len(atr_values):
                atr_now = atr_values[j]
                trail_dist = atr_now * cfg["atr_multiplier"]
                if is_short:
                    # For shorts, trail stop DOWN as price drops
                    new_trail_stop = close + trail_dist
                    if new_trail_stop < stop_price:
                        stop_price = new_trail_stop
                else:
                    # For longs, trail stop UP as price rises
                    new_trail_stop = close - trail_dist
                    if new_trail_stop > stop_price:
                        stop_price = new_trail_stop

            if rules_active:
                new_stop, forced_reason, counters = _apply_execution_rules(
                    execution_cfg,
                    current_r=current_r,
                    peak_r=peak_r,
                    entry_price=entry_price,
                    stop_distance=stop_dist,
                    stop_price=stop_price,
                    bars_in_trade=(j - entry_idx),
                )

                if new_stop > stop_price:
                    if new_stop >= entry_price:
                        be_hit_for_trade = True
                    stop_price = new_stop

                stats["breakeven_triggers"] += counters["breakeven"]
                stats["ladder_lock_triggers"] += counters["ladder"]
                stats["green_to_red_exits"] += counters["g2r"]
                stats["time_stop_exits"] += counters["time_stop"]
                stats["profit_retrace_exits"] += counters["profit_retrace"]
                stats["scale_out_triggers"] += counters["scale_out"]
                if counters["scale_out"] > 0:
                    scale_hit_for_trade = True

                if forced_reason is not None:
                    exit_idx = j
                    exit_price = close
                    exit_reason = forced_reason
                    break

            # Intrabar rule: stop checked before target
            if is_short:
                if high >= stop_price:
                    exit_idx = j
                    exit_price = stop_price
                    exit_reason = "stop"
                    break
                if low <= target_price:
                    exit_idx = j
                    exit_price = target_price
                    exit_reason = "target"
                    break
            else:
                if low <= stop_price:
                    exit_idx = j
                    exit_price = stop_price
                    exit_reason = "stop"
                    break
                if high >= target_price:
                    exit_idx = j
                    exit_price = target_price
                    exit_reason = "target"
                    break

        if exit_idx is None:
            exit_idx = max_j
            exit_price = _safe_float(bars[exit_idx].get("close"), entry_price)
            exit_reason = "time" if exit_idx == max_j else "end_of_data"

        if is_short:
            gross = entry_price - exit_price
        else:
            gross = exit_price - entry_price
        slippage = (entry_price + exit_price) * cfg["slippage_pct"]
        fees = cfg["commission"] * 2.0
        net = gross - slippage - fees
        r_mult = net / initial_stop_dist

        if peak_r != -9999.0:
            givebacks.append(max(0.0, peak_r - r_mult))
        if be_hit_for_trade:
            trades_hit_be += 1
        if scale_hit_for_trade:
            trades_hit_scale += 1

        trades.append(
            TradeResult(
                trade_id=f"trd_{symbol}_{timeframe}_{entry_idx}_{exit_idx}_{trade_counter}",
                symbol=symbol,
                timeframe=timeframe,
                direction=cfg["direction"],
                entry_time=str(bars[entry_idx].get("timestamp") or ""),
                entry_price=entry_price,
                entry_bar_index=entry_idx,
                stop_price=stop_price,
                stop_distance=stop_dist,
                exit_time=str(bars[exit_idx].get("timestamp") or ""),
                exit_price=exit_price,
                exit_bar_index=exit_idx,
                exit_reason=exit_reason,
                R_multiple=r_mult,
                pnl_gross=gross,
                pnl_net=net,
                fees_applied=fees,
                slippage_applied=slippage,
                setup_type=str((spec.get("setup_config") or {}).get("pattern_type", "generic_trend")),
                anchors_snapshot={},
            )
        )
        trade_counter += 1

        i = exit_idx + 1

    if trades:
        stats["avg_giveback_from_peak_R"] = sum(givebacks) / len(givebacks) if givebacks else 0.0
        stats["pct_trades_hitting_breakeven"] = trades_hit_be / len(trades)
        stats["pct_trades_hitting_scale_out"] = trades_hit_scale / len(trades)

    return trades, stats


def trades_to_dicts(trades: List[TradeResult], report_id: str, strategy_version_id: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for t in trades:
        out.append(
            {
                "trade_id": t.trade_id,
                "report_id": report_id,
                "strategy_version_id": strategy_version_id,
                "symbol": t.symbol,
                "timeframe": t.timeframe,
                "direction": t.direction,
                "entry_time": t.entry_time,
                "entry_price": t.entry_price,
                "entry_bar_index": t.entry_bar_index,
                "stop_price": t.stop_price,
                "stop_distance": t.stop_distance,
                "exit_time": t.exit_time,
                "exit_price": t.exit_price,
                "exit_bar_index": t.exit_bar_index,
                "exit_reason": t.exit_reason,
                "R_multiple": t.R_multiple,
                "pnl_gross": t.pnl_gross,
                "pnl_net": t.pnl_net,
                "fees_applied": t.fees_applied,
                "slippage_applied": t.slippage_applied,
                "setup_type": t.setup_type,
                "anchors_snapshot": t.anchors_snapshot,
            }
        )
    return out
