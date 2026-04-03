#!/usr/bin/env python3
"""
Stateful execution layer — per-strategy, per-symbol, per-timeframe state machine.

This module provides two things:

1.  StrategyState — a lightweight mutable object that persists across bar
    evaluations for a single (strategy_version_id, symbol, timeframe) instance.

2.  apply_state_transitions() — the pure function that reads a StateMachineConfig
    from a strategy spec, consults the current StrategyState, evaluates transition
    conditions against the current bar's plugin output, and mutates state in place.

Design contracts
----------------
* Stateless strategies (no state_machine in setup_config) pass through this
  module untouched.  apply_state_transitions() is a no-op when sm_cfg is absent.
* The only mutable object is StrategyState.  Callers own the lifecycle.
* No I/O, no imports beyond the standard library.  All primitive evaluation
  happens in the caller (strategyRunner / composite_runner).  This module only
  reads the *result* (entry_ready flag) from the candidates list it receives.

Phase semantics
---------------
  idle        — no setup in progress; waiting for arm condition
  armed       — arm primitive fired; waiting for entry trigger
  watching    — inside a timed watch window (watch_bars counter counts down)
  entered     — entry signal emitted on this bar (caller adds to signals set)
  invalidated — a later condition cancelled the armed setup; resets to idle
  expired     — watch window ran to 0 without an entry; resets to idle
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Canonical phase set (mirrors strategy.ts StrategyPhase)
# ---------------------------------------------------------------------------
VALID_PHASES = frozenset(
    {"idle", "armed", "watching", "entered", "invalidated", "expired"}
)


# ---------------------------------------------------------------------------
# StrategyState
# ---------------------------------------------------------------------------
@dataclass
class StrategyState:
    """
    Mutable execution state for one (strategy, symbol, timeframe) instance.

    Attributes
    ----------
    phase               Current named phase (one of VALID_PHASES).
    armed_bar_index     Absolute bar index when the state was last armed.
    watch_bars_remaining
                        Bars left in the active watch window.  0 = no window
                        open (or window has expired).
    flags               Arbitrary named boolean flags set by transition actions.
    anchors             Price / bar anchors captured at key events (e.g. the
                        arm bar's close, the base low).  Passed into candidates
                        for downstream use.
    bars_in_phase       Bars spent in the current phase.  Useful for time-based
                        transitions without an explicit watch window.
    """
    phase: str = "idle"
    armed_bar_index: Optional[int] = None
    watch_bars_remaining: int = 0
    flags: Dict[str, bool] = field(default_factory=dict)
    anchors: Dict[str, Any] = field(default_factory=dict)
    bars_in_phase: int = 0

    def transition_to(self, new_phase: str) -> None:
        if new_phase not in VALID_PHASES:
            raise ValueError(f"Unknown phase: {new_phase!r}")
        self.phase = new_phase
        self.bars_in_phase = 0

    def tick(self) -> None:
        """Call once per bar to increment bars_in_phase and decrement watch window."""
        self.bars_in_phase += 1
        if self.watch_bars_remaining > 0:
            self.watch_bars_remaining -= 1

    def reset(self) -> None:
        self.phase = "idle"
        self.armed_bar_index = None
        self.watch_bars_remaining = 0
        self.flags.clear()
        self.anchors.clear()
        self.bars_in_phase = 0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "phase": self.phase,
            "armed_bar_index": self.armed_bar_index,
            "watch_bars_remaining": self.watch_bars_remaining,
            "flags": dict(self.flags),
            "anchors": dict(self.anchors),
            "bars_in_phase": self.bars_in_phase,
        }


# ---------------------------------------------------------------------------
# State store — keyed by (strategy_version_id, symbol, timeframe)
# ---------------------------------------------------------------------------
def make_state_store() -> Dict[str, StrategyState]:
    """Return a fresh, empty state store for one backtest/scan run."""
    return {}


def get_or_create_state(
    store: Dict[str, StrategyState],
    strategy_version_id: str,
    symbol: str,
    timeframe: str,
) -> StrategyState:
    key = f"{strategy_version_id}::{symbol}::{timeframe}"
    if key not in store:
        store[key] = StrategyState()
    return store[key]


# ---------------------------------------------------------------------------
# Transition helpers
# ---------------------------------------------------------------------------
def _primitive_fired(primitive_id: str, candidates: List[Dict[str, Any]]) -> bool:
    """
    Return True if any candidate in this bar's output is linked to primitive_id
    and has entry_ready=True (or score > 0 for intermediate stages).

    Candidates from composite_runner carry a '_primitive_id' key when the
    state machine wrapper tags them.  For simpler plugins, we fall back to
    checking entry_ready on the whole list.
    """
    if not primitive_id or not candidates:
        return False
    for c in candidates:
        if str(c.get("_primitive_id", "")) == primitive_id:
            return bool(c.get("entry_ready")) or float(c.get("score", 0.0)) > 0.0
        # Untagged candidates: treat a single-candidate list as matching any primitive
    # Fallback: if the caller passes a single-candidate list with no tagging,
    # check entry_ready globally (conservative — avoids false negatives).
    if len(candidates) == 1:
        return bool(candidates[0].get("entry_ready")) or float(candidates[0].get("score", 0.0)) > 0.0
    return False


def _candidates_have_entry_ready(candidates: List[Dict[str, Any]]) -> bool:
    return any(bool(c.get("entry_ready")) for c in candidates)


# ---------------------------------------------------------------------------
# Core: apply_state_transitions
# ---------------------------------------------------------------------------
def apply_state_transitions(
    state: StrategyState,
    sm_cfg: Dict[str, Any],
    candidates: List[Dict[str, Any]],
    bar_index: int,
    *,
    all_primitive_results: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> bool:
    """
    Evaluate transition rules against the current bar's candidate output and
    mutate `state` in place.

    Parameters
    ----------
    state       The mutable StrategyState for this execution instance.
    sm_cfg      The state_machine sub-dict from setup_config (validated by caller).
    candidates  Candidates returned by run_strategy() for the current bar.
    bar_index   Absolute bar index in the full dataset.
    all_primitive_results
                Optional dict mapping primitive_id → candidate list for this bar.
                When provided, transition conditions are evaluated per-primitive
                rather than against the aggregated candidates list.  Enables
                multi-primitive state machines.

    Returns
    -------
    bool        True if the state machine wants to emit an entry signal on this
                bar (i.e. current phase, after transitions, is in emit_on).
    """
    if not sm_cfg:
        # No state machine configured — pass through stateless behaviour.
        return _candidates_have_entry_ready(candidates)

    # ------------------------------------------------------------------
    # 0. Tick the state (bars_in_phase++, watch_bars_remaining--)
    # ------------------------------------------------------------------
    state.tick()

    # ------------------------------------------------------------------
    # 1. Convenience: auto-expire watch window
    # ------------------------------------------------------------------
    watch_bars = int(sm_cfg.get("watch_bars", 0) or 0)
    if state.phase == "watching" and watch_bars > 0 and state.watch_bars_remaining == 0:
        state.transition_to("expired")
        state.transition_to("idle")  # expired is transient; reset to idle immediately
        return False

    # ------------------------------------------------------------------
    # 2. Convenience: invalidation primitive (always checked first)
    # ------------------------------------------------------------------
    invalidate_on = str(sm_cfg.get("invalidate_on", "") or "")
    if invalidate_on and state.phase in ("armed", "watching"):
        results_for_invalidation = (
            (all_primitive_results or {}).get(invalidate_on)
            or (_primitive_results_for(invalidate_on, candidates))
        )
        if _primitive_fired(invalidate_on, results_for_invalidation):
            state.transition_to("invalidated")
            state.transition_to("idle")  # invalidated is transient; reset immediately
            return False

    # ------------------------------------------------------------------
    # 3. Evaluate ordered transition rules
    # ------------------------------------------------------------------
    transitions = list(sm_cfg.get("transitions", []) or [])
    for rule in transitions:
        from_phases = rule.get("from", [])
        if isinstance(from_phases, str):
            from_phases = [from_phases]
        if state.phase not in from_phases:
            continue

        on_primitive = str(rule.get("on_primitive", "") or "")
        results_for_rule = (
            (all_primitive_results or {}).get(on_primitive)
            or (_primitive_results_for(on_primitive, candidates))
        )
        if not _primitive_fired(on_primitive, results_for_rule):
            continue

        # Transition fires — apply it
        target_phase = str(rule.get("to", "idle"))
        state.transition_to(target_phase)

        action = rule.get("action") or {}
        if action.get("set_watch_bars"):
            state.watch_bars_remaining = int(action["set_watch_bars"])
            state.armed_bar_index = bar_index
        if action.get("clear_watch"):
            state.watch_bars_remaining = 0
        if action.get("set_flag"):
            state.flags[str(action["set_flag"])] = True
        if action.get("clear_flag"):
            state.flags[str(action["clear_flag"])] = False
        if target_phase == "armed":
            state.armed_bar_index = bar_index

        # Only one transition fires per bar (first matching rule wins).
        break

    # ------------------------------------------------------------------
    # 4. Determine whether to emit an entry signal
    # ------------------------------------------------------------------
    # A valid entry requires BOTH:
    #   (a) the strategy being in an emit-enabled phase, and
    #   (b) the current bar still satisfying the strategy's actual entry logic.
    #
    # This preserves composite gates (e.g. regime/location/timing) while the
    # state machine controls WHEN those gates are allowed to trigger.
    emit_on = sm_cfg.get("emit_on", [])
    if isinstance(emit_on, str):
        emit_on = [emit_on]
    return state.phase in emit_on and _candidates_have_entry_ready(candidates)


def _primitive_results_for(
    primitive_id: str, candidates: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Filter candidates to those tagged with primitive_id, or return all if
    no tagging exists (single-plugin scenario).
    """
    tagged = [c for c in candidates if str(c.get("_primitive_id", "")) == primitive_id]
    return tagged if tagged else candidates
