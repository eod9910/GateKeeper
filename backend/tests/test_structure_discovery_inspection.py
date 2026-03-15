import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from research_v1 import aggregate_family_stats, build_top_family_inspection_report  # noqa: E402
from research_v1.schema import (  # noqa: E402
    BarRecord,
    LegDirection,
    MotifInstanceRecord,
    OutcomeRecord,
    PivotLabel,
    PivotRecord,
    PivotType,
)


def _bar(index: int, close: float) -> BarRecord:
    return BarRecord(
        symbol="TEST",
        timeframe="1d",
        timestamp=f"2024-01-{index + 1:02d} 00:00:00",
        bar_index=index,
        open=close - 0.5,
        high=close + 1.0,
        low=close - 1.0,
        close=close,
        volume=1000.0 + index,
        atr_14=2.0,
        bar_range=2.0,
        body_size=0.5,
        range_atr_norm=1.0,
        body_atr_norm=0.25,
    )


def _pivot(pivot_id: str, bar_index: int, price: float, pivot_type: PivotType) -> PivotRecord:
    return PivotRecord(
        pivot_id=pivot_id,
        symbol="TEST",
        timeframe="1d",
        bar_index=bar_index,
        timestamp=f"2024-01-{bar_index + 1:02d} 00:00:00",
        price=price,
        pivot_type=pivot_type,
        candidate_bar_index=bar_index,
        confirmation_bar_index=bar_index + 1,
        confirmation_delay_bars=1,
        atr_at_confirmation=2.0,
        distance_from_prev_pivot_atr=1.0,
        bars_from_prev_pivot=2,
    )


def _motif(motif_id: str, pivot_ids: list[str], start_bar: int, end_bar: int, signature: str) -> MotifInstanceRecord:
    return MotifInstanceRecord(
        motif_instance_id=motif_id,
        symbol="TEST",
        timeframe="1d",
        start_bar_index=start_bar,
        end_bar_index=end_bar,
        pivot_ids=pivot_ids,
        leg_ids=["l1", "l2", "l3", "l4"],
        pivot_type_seq=[PivotType.HIGH, PivotType.LOW, PivotType.HIGH, PivotType.LOW, PivotType.HIGH],
        pivot_label_seq=[PivotLabel.HH, PivotLabel.HL, PivotLabel.HH, PivotLabel.HL, PivotLabel.HH],
        leg_direction_seq=[LegDirection.DOWN, LegDirection.UP, LegDirection.DOWN, LegDirection.UP],
        feature_vector={},
        quality_score=0.0,
        regime_tag=None,
        family_signature=signature,
        family_id=None,
    )


def _outcome(motif_id: str, entry_bar_index: int, forward10: float) -> OutcomeRecord:
    return OutcomeRecord(
        motif_instance_id=motif_id,
        entry_bar_index=entry_bar_index,
        entry_timestamp=f"2024-01-{entry_bar_index + 1:02d} 00:00:00",
        entry_close=100.0,
        entry_atr=2.0,
        forward_5_return_atr=forward10 / 2,
        forward_10_return_atr=forward10,
        mfe_10_atr=forward10 + 0.5,
        mae_10_atr=0.25,
        hit_plus_1atr_first=True,
        hit_minus_1atr_first=False,
        next_break_up=True,
        next_break_down=False,
    )


class StructureDiscoveryInspectionTests(unittest.TestCase):
    def test_top_family_inspection_report_includes_examples_and_snippets(self):
        bars = [_bar(index, 100.0 + index) for index in range(25)]
        pivots = [
            _pivot("p1", 1, 102.0, PivotType.HIGH),
            _pivot("p2", 3, 99.0, PivotType.LOW),
            _pivot("p3", 5, 104.0, PivotType.HIGH),
            _pivot("p4", 7, 101.0, PivotType.LOW),
            _pivot("p5", 9, 106.0, PivotType.HIGH),
            _pivot("p6", 11, 103.0, PivotType.LOW),
        ]
        exact_a = "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:SHALLOW|R4:DEEP"
        exact_b = "HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP"
        motifs = [
            _motif("m1", ["p1", "p2", "p3", "p4", "p5"], 1, 9, exact_a),
            _motif("m2", ["p2", "p3", "p4", "p5", "p6"], 3, 11, exact_b),
        ]
        outcomes = [
            _outcome("m1", 10, 0.8),
            _outcome("m2", 12, 0.4),
        ]
        family_stats_v2, _ = aggregate_family_stats(
            motifs=motifs,
            outcomes=outcomes,
            min_occurrence_count=1,
            min_valid_10bar_count=1,
            grouping_version="v2",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            report = build_top_family_inspection_report(
                bars=bars,
                pivots=pivots,
                motifs=motifs,
                outcomes=outcomes,
                family_stats_v2=family_stats_v2,
                output_dir=Path(temp_dir),
                top_n=5,
                min_count_filter=1,
            )

            self.assertEqual(report["grouping_version"], "v2")
            self.assertEqual(report["total_unique_families"], 1)
            self.assertEqual(len(report["top_10_by_occurrence_count"]), 1)
            self.assertEqual(len(report["family_details"]), 1)

            family_details = next(iter(report["family_details"].values()))
            self.assertEqual(family_details["exact_signature_count"], 2)
            self.assertEqual(len(family_details["representative_exact_signatures"]), 2)
            self.assertGreaterEqual(len(family_details["representative_motif_examples"]), 2)

            for example in family_details["representative_motif_examples"]:
                self.assertTrue(Path(example["chart_snippet_path"]).exists())


if __name__ == "__main__":
    unittest.main()
