#!/usr/bin/env python3
"""
Port Type Definitions for the DAG Pipeline Execution Model.

Each primitive declares typed input/output ports. When composites run in
pipeline mode, the composite runner uses these types to validate connections
and route data between stages.

Port types are string identifiers. The actual data shapes are documented here
but enforced only by convention — primitives are responsible for producing
the correct structure in their output_ports dict.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Port type identifiers
# ---------------------------------------------------------------------------

PRICE_DATA = "PriceData"
SWING_STRUCTURE = "SwingStructure"
ACTIVE_LEG = "ActiveLeg"
FIB_LEVELS = "FibLevels"
SIGNAL = "Signal"
ENERGY_STATE = "EnergyState"
PATTERN_RESULT = "PatternResult"

# ---------------------------------------------------------------------------
# Port type color map (frontend uses these for visual wiring)
# ---------------------------------------------------------------------------

PORT_COLORS: Dict[str, str] = {
    PRICE_DATA: "#ffffff",
    SWING_STRUCTURE: "#5a8bd8",
    ACTIVE_LEG: "#5a8bd8",
    FIB_LEVELS: "#4ba864",
    SIGNAL: "#d38e4c",
    ENERGY_STATE: "#8d67c7",
    PATTERN_RESULT: "#8d67c7",
}

# ---------------------------------------------------------------------------
# Port declarations per primitive pattern_id
#
# Each entry: {
#   "inputs":  { port_name: port_type, ... },
#   "outputs": { port_name: port_type, ... },
# }
#
# "data" (PriceData) is implicit — every primitive receives it.
# "signal" (Signal) output is implicit — every primitive produces it.
# Only declare ADDITIONAL ports here.
# ---------------------------------------------------------------------------

PRIMITIVE_PORT_DECLARATIONS: Dict[str, Dict[str, Dict[str, str]]] = {
    "rdp_swing_structure": {
        "inputs": {},
        "outputs": {
            "swing_structure": SWING_STRUCTURE,
            "active_leg": ACTIVE_LEG,
        },
    },
    "fib_location_primitive": {
        "inputs": {
            "leg": ACTIVE_LEG,
        },
        "outputs": {
            "fib_levels": FIB_LEVELS,
        },
    },
    "fib_signal_trigger_primitive": {
        "inputs": {
            "fib_levels": FIB_LEVELS,
        },
        "outputs": {},
    },
    "energy_state_primitive": {
        "inputs": {},
        "outputs": {
            "energy_state": ENERGY_STATE,
        },
    },
    "ma_crossover": {
        "inputs": {},
        "outputs": {},
    },
    "rsi_primitive": {
        "inputs": {},
        "outputs": {},
    },
    "regime_filter": {
        "inputs": {},
        "outputs": {
            "pattern_result": PATTERN_RESULT,
        },
    },
}


def get_port_declaration(pattern_id: str) -> Dict[str, Dict[str, str]]:
    """Return port declaration for a primitive, with defaults for unknown IDs."""
    return PRIMITIVE_PORT_DECLARATIONS.get(pattern_id, {"inputs": {}, "outputs": {}})


def get_full_inputs(pattern_id: str) -> Dict[str, str]:
    """Return all input ports including the implicit 'data' port."""
    decl = get_port_declaration(pattern_id)
    return {"data": PRICE_DATA, **decl.get("inputs", {})}


def get_full_outputs(pattern_id: str) -> Dict[str, str]:
    """Return all output ports including the implicit 'signal' port."""
    decl = get_port_declaration(pattern_id)
    return {"signal": SIGNAL, **decl.get("outputs", {})}
