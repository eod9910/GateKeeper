"""Parallel research pipeline for causal market-structure discovery."""

from .schema import (  # noqa: F401
    BarRecord,
    FamilyStatsRecord,
    LegDirection,
    LegRecord,
    MotifInstanceRecord,
    OutcomeRecord,
    PivotLabel,
    PivotLabelRecord,
    PivotRecord,
    PivotType,
    RegimeType,
    VolatilityRegime,
    record_to_dict,
)
from .normalizer import normalize_bars  # noqa: F401
from .atr_pivots import extract_atr_reversal_pivots  # noqa: F401
from .legs import build_leg_records  # noqa: F401
from .labels import label_pivots_against_same_side_history  # noqa: F401
from .motifs import build_five_pivot_motifs  # noqa: F401
from .outcomes import evaluate_motif_outcomes  # noqa: F401
from .families import (  # noqa: F401
    aggregate_family_stats,
    assign_chronological_splits,
    build_fragmentation_report,
    build_fragmentation_report_v2,
    derive_family_signature_v2,
)
from .inspection import build_top_family_inspection_report  # noqa: F401
from .multi_symbol import build_cross_symbol_family_comparison  # noqa: F401
from .stability import build_family_behavior_stability_report  # noqa: F401
from .direction import classify_family_direction_v2, parse_family_signature_v2  # noqa: F401
