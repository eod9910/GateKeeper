"""Canonical research-v1 record shapes for structural motif discovery."""

from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from enum import Enum
from typing import Any, Dict, List, Optional


class PivotType(str, Enum):
    HIGH = "HIGH"
    LOW = "LOW"


class PivotLabel(str, Enum):
    HH = "HH"
    LH = "LH"
    HL = "HL"
    LL = "LL"
    EH = "EH"
    EL = "EL"


class LegDirection(str, Enum):
    UP = "UP"
    DOWN = "DOWN"


class RegimeType(str, Enum):
    UPTREND = "UPTREND"
    DOWNTREND = "DOWNTREND"
    RANGE = "RANGE"


class VolatilityRegime(str, Enum):
    LOW_VOL = "LOW_VOL"
    MID_VOL = "MID_VOL"
    HIGH_VOL = "HIGH_VOL"


@dataclass
class BarRecord:
    symbol: str
    timeframe: str
    timestamp: str
    bar_index: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    atr_14: float
    bar_range: float
    body_size: float
    range_atr_norm: float
    body_atr_norm: float


@dataclass
class PivotRecord:
    pivot_id: str
    symbol: str
    timeframe: str
    bar_index: int
    timestamp: str
    price: float
    pivot_type: PivotType
    candidate_bar_index: int
    confirmation_bar_index: int
    confirmation_delay_bars: int
    atr_at_confirmation: float
    distance_from_prev_pivot_atr: Optional[float]
    bars_from_prev_pivot: Optional[int]


@dataclass
class LegRecord:
    leg_id: str
    symbol: str
    timeframe: str
    start_pivot_id: str
    end_pivot_id: str
    direction: LegDirection
    start_price: float
    end_price: float
    price_distance: float
    distance_atr_norm: float
    bar_count: int
    slope_per_bar: float
    velocity_atr_per_bar: float
    volume_sum: float
    avg_bar_range_atr_norm: float
    max_internal_pullback_atr: float
    leg_strength_score: float


@dataclass
class PivotLabelRecord:
    pivot_id: str
    major_label: PivotLabel
    comparison_pivot_id: Optional[str]
    price_delta: Optional[float]
    price_delta_atr_norm: Optional[float]
    equal_band_flag: bool


@dataclass
class MotifInstanceRecord:
    motif_instance_id: str
    symbol: str
    timeframe: str
    start_bar_index: int
    end_bar_index: int
    pivot_ids: List[str]
    leg_ids: List[str]
    pivot_type_seq: List[PivotType]
    pivot_label_seq: List[PivotLabel]
    leg_direction_seq: List[LegDirection]
    feature_vector: Dict[str, Any]
    quality_score: float
    regime_tag: Optional[str]
    family_signature: Optional[str]
    family_id: Optional[str]


@dataclass
class OutcomeRecord:
    motif_instance_id: str
    entry_bar_index: int
    entry_timestamp: str
    entry_close: float
    entry_atr: float
    forward_5_return_atr: Optional[float]
    forward_10_return_atr: Optional[float]
    mfe_10_atr: Optional[float]
    mae_10_atr: Optional[float]
    hit_plus_1atr_first: Optional[bool]
    hit_minus_1atr_first: Optional[bool]
    next_break_up: Optional[bool]
    next_break_down: Optional[bool]


@dataclass
class FamilyStatsRecord:
    grouping_version: str
    family_id: str
    family_signature: str
    occurrence_count: int
    valid_5bar_count: int
    valid_10bar_count: int
    discovery_count: int
    validation_count: int
    holdout_count: int
    avg_forward_5_return_atr: Optional[float]
    median_forward_5_return_atr: Optional[float]
    avg_forward_10_return_atr: Optional[float]
    median_forward_10_return_atr: Optional[float]
    forward_10_std_dev_atr: Optional[float]
    forward_10_std_error_atr: Optional[float]
    t_score_forward_10: Optional[float]
    sharpe_like_forward_10: Optional[float]
    discovery_avg_forward_10_return_atr: Optional[float]
    validation_avg_forward_10_return_atr: Optional[float]
    holdout_avg_forward_10_return_atr: Optional[float]
    avg_mfe_10_atr: Optional[float]
    median_mfe_10_atr: Optional[float]
    avg_mae_10_atr: Optional[float]
    median_mae_10_atr: Optional[float]
    hit_plus_1atr_first_rate: Optional[float]
    hit_minus_1atr_first_rate: Optional[float]
    next_break_up_rate: Optional[float]
    next_break_down_rate: Optional[float]
    discovery_hit_plus_1atr_first_rate: Optional[float]
    validation_hit_plus_1atr_first_rate: Optional[float]
    holdout_hit_plus_1atr_first_rate: Optional[float]
    avg_quality_score: Optional[float]
    regime_distribution: Dict[str, int]
    exact_signature_count: int
    exact_signature_examples: List[str]
    sign_consistent_across_splits: bool
    validation_degradation_pct: Optional[float]
    holdout_degradation_pct: Optional[float]
    passes_min_count: bool
    passes_outcome_coverage: bool
    is_candidate_family: bool


def record_to_dict(value: Any) -> Any:
    """Serialize dataclasses and enums into plain JSON-safe values."""
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {key: record_to_dict(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: record_to_dict(item) for key, item in value.items()}
    if isinstance(value, list):
        return [record_to_dict(item) for item in value]
    if isinstance(value, tuple):
        return [record_to_dict(item) for item in value]
    return value
