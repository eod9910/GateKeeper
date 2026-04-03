"""
Symbolic regression runner using gplearn.

Fits formula score = f(features) and returns formula string(s) and optional complexity.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np

try:
    from gplearn.genetic import SymbolicRegressor

    # Patch gplearn 0.4.2 + scikit-learn >= 1.4 incompatibility:
    # gplearn calls self._validate_data() which was removed from sklearn BaseEstimator.
    # We add it back as a shim that delegates to sklearn.utils.validation.validate_data.
    if SymbolicRegressor is not None and not hasattr(SymbolicRegressor, '_validate_data'):
        try:
            from sklearn.utils.validation import validate_data as _sklearn_validate_data

            def _patched_validate_data(self, X, y=None, **kwargs):
                return _sklearn_validate_data(self, X, y=y, **kwargs)

            SymbolicRegressor._validate_data = _patched_validate_data
        except ImportError:
            pass
except ImportError:
    SymbolicRegressor = None  # type: ignore


# Default feature names for bar-level indicator path (match feature_matrix column order)
DEFAULT_FEATURE_NAMES = ["RSI", "ATR_norm", "momentum"]


def run_symbolic_regression(
    X: np.ndarray,
    y: np.ndarray,
    config: Optional[Dict[str, Any]] = None,
    feature_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Run symbolic regression (gplearn) on X, y.

    Args:
        X: 2d array (n_samples, n_features).
        y: 1d array (n_samples).
        config: Optional. Keys: population_size, generations, function_set,
                parsimony_coefficient, random_state, stopping_criteria, etc.
        feature_names: Optional list of names for columns (for readable formula).

    Returns:
        dict with:
            - formula: str (LISP-style from gplearn, or human-readable if we map it)
            - formula_readable: str (X0 -> first feature name, etc.)
            - complexity: int (program length)
            - fitness: float (R² or MSE on training data)
            - n_samples: int
            - success: bool
            - error: str if failed
    """
    if SymbolicRegressor is None:
        return {
            "success": False,
            "error": "gplearn not installed. pip install gplearn",
            "formula": "",
            "formula_readable": "",
            "complexity": 0,
            "fitness": 0.0,
            "n_samples": len(y),
        }

    config = config or {}
    population_size = int(config.get("population_size", 500))
    generations = int(config.get("generations", 20))
    parsimony = float(config.get("parsimony_coefficient", 0.01))
    random_state = config.get("random_state")
    if random_state is None:
        random_state = np.random.randint(0, 2**31)
    stopping = config.get("stopping_criteria", 0.0)
    function_set = config.get("function_set", ["add", "sub", "mul", "div", "sqrt", "log", "abs", "neg"])

    feature_names = feature_names or [f"X{i}" for i in range(X.shape[1])]
    if len(feature_names) < X.shape[1]:
        feature_names = feature_names + [f"X{i}" for i in range(len(feature_names), X.shape[1])]

    try:
        est = SymbolicRegressor(
            population_size=population_size,
            generations=generations,
            parsimony_coefficient=parsimony,
            random_state=random_state,
            stopping_criteria=stopping,
            function_set=function_set,
            init_depth=(2, 6),
            verbose=0,
        )
        est.fit(X, y)
        program = est._program
        formula_str = str(program) if program is not None else ""
        # Map X0, X1, ... to feature names for readable formula
        formula_readable = formula_str
        for i in range(X.shape[1]):
            formula_readable = formula_readable.replace(f"X{i}", feature_names[i])
        complexity = getattr(program, "length_", len(str(program))) if program is not None else 0
        y_pred = est.predict(X)
        # R² = 1 - SS_res / SS_tot
        ss_tot = np.sum((y - np.mean(y)) ** 2)
        ss_res = np.sum((y - y_pred) ** 2)
        fitness = float(1.0 - ss_res / ss_tot) if ss_tot > 0 and len(y) > 0 else 0.0
        return {
            "success": True,
            "formula": formula_str,
            "formula_readable": formula_readable,
            "complexity": complexity,
            "fitness": fitness,
            "n_samples": len(y),
            "error": None,
        }
    except AttributeError as e:
        if "_validate_data" in str(e):
            return {
                "success": False,
                "error": "gplearn/sklearn version mismatch (_validate_data). Try: pip install 'scikit-learn<1.4' or upgrade gplearn.",
                "formula": "",
                "formula_readable": "",
                "complexity": 0,
                "fitness": 0.0,
                "n_samples": len(y),
            }
        raise
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "formula": "",
            "formula_readable": "",
            "complexity": 0,
            "fitness": 0.0,
            "n_samples": len(y),
        }
