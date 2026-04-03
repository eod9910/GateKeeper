"""
Symbolic Regression (SR) module.

Builds feature matrices from bars/indicators, runs symbolic regression (gplearn),
and produces formulas that can be packaged as primitives for composite strategies.
"""

from .feature_matrix import (
    build_feature_matrix_from_bars,
    build_feature_snapshot_from_bars,
    compute_forward_return,
)
from .formula_registry import get_formula, load_formula_registry, persist_formula
from .evaluator import evaluate_formula
from .regression import run_symbolic_regression

__all__ = [
    "build_feature_matrix_from_bars",
    "build_feature_snapshot_from_bars",
    "compute_forward_return",
    "evaluate_formula",
    "get_formula",
    "load_formula_registry",
    "persist_formula",
    "run_symbolic_regression",
]
