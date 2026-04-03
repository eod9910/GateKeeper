"""
Persistence helpers for symbolic-regression formulas.

Stores discovered formulas in backend/data/sr_formulas.json so they can be
reused later by validator-ready primitives and strategies.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
REGISTRY_PATH = DATA_DIR / "sr_formulas.json"


def _ensure_registry_parent() -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_formula_registry() -> Dict[str, Dict[str, Any]]:
    if not REGISTRY_PATH.exists():
        return {}
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
        if isinstance(raw, dict):
            return {str(k): v for k, v in raw.items() if isinstance(v, dict)}
    except Exception:
        pass
    return {}


def save_formula_registry(registry: Dict[str, Dict[str, Any]]) -> None:
    _ensure_registry_parent()
    with open(REGISTRY_PATH, "w", encoding="utf-8") as handle:
        json.dump(registry, handle, indent=2, sort_keys=True)


def get_formula(formula_id: str) -> Optional[Dict[str, Any]]:
    return load_formula_registry().get(str(formula_id or "").strip())


def build_formula_id(
    formula: str,
    feature_specs: Optional[List[Dict[str, Any]]] = None,
    target_bars: int = 5,
    target_atr_normalized: bool = True,
) -> str:
    payload = {
        "formula": str(formula or "").strip(),
        "feature_specs": feature_specs or [],
        "target_bars": int(target_bars or 5),
        "target_atr_normalized": bool(target_atr_normalized),
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"srf_{digest[:16]}"


def persist_formula(
    *,
    formula: str,
    formula_readable: str,
    feature_specs: Optional[List[Dict[str, Any]]] = None,
    feature_names: Optional[List[str]] = None,
    result: Optional[Dict[str, Any]] = None,
    training_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    result = result or {}
    training_context = training_context or {}
    feature_specs = feature_specs or []
    feature_names = feature_names or []

    formula_id = build_formula_id(
        formula=formula,
        feature_specs=feature_specs,
        target_bars=int(training_context.get("target_bars", 5) or 5),
        target_atr_normalized=bool(training_context.get("target_atr_normalized", True)),
    )

    registry = load_formula_registry()
    existing = registry.get(formula_id) or {}
    now = datetime.utcnow().isoformat() + "Z"

    entry: Dict[str, Any] = {
        "formula_id": formula_id,
        "formula": str(formula or "").strip(),
        "formula_readable": str(formula_readable or formula or "").strip(),
        "feature_specs": feature_specs,
        "feature_names": feature_names,
        "complexity": int(result.get("complexity", existing.get("complexity", 0)) or 0),
        "fitness": float(result.get("fitness", existing.get("fitness", 0.0)) or 0.0),
        "n_samples": int(result.get("n_samples", existing.get("n_samples", 0)) or 0),
        "training_context": {
            "symbol": training_context.get("symbol"),
            "interval": training_context.get("interval"),
            "years": training_context.get("years"),
            "target_bars": int(training_context.get("target_bars", 5) or 5),
            "target_atr_normalized": bool(training_context.get("target_atr_normalized", True)),
            "population_size": training_context.get("population_size"),
            "generations": training_context.get("generations"),
            "parsimony_coefficient": training_context.get("parsimony_coefficient"),
        },
        "created_at": existing.get("created_at") or now,
        "updated_at": now,
    }

    registry[formula_id] = entry
    save_formula_registry(registry)
    return entry
