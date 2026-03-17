import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

from research_v1 import aggregate_family_stats, build_fragmentation_report  # noqa: E402
from research_v1.schema import MotifInstanceRecord, OutcomeRecord  # noqa: E402


def _motif(motif_id: str, signature: str, quality: float = 0.0, regime: str | None = None) -> MotifInstanceRecord:
    return MotifInstanceRecord(
        motif_instance_id=motif_id,
        symbol='TEST',
        timeframe='1d',
        start_bar_index=0,
        end_bar_index=4,
        pivot_ids=['p1', 'p2', 'p3', 'p4', 'p5'],
        leg_ids=['l1', 'l2', 'l3', 'l4'],
        pivot_type_seq=[],
        pivot_label_seq=[],
        leg_direction_seq=[],
        feature_vector={},
        quality_score=quality,
        regime_tag=regime,
        family_signature=signature,
        family_id=None,
    )


def _outcome(
    motif_id: str,
    forward5: float | None,
    forward10: float | None,
    mfe10: float | None,
    mae10: float | None,
    hit_plus: bool | None,
    hit_minus: bool | None,
    break_up: bool | None,
    break_down: bool | None,
) -> OutcomeRecord:
    return OutcomeRecord(
        motif_instance_id=motif_id,
        entry_bar_index=10,
        entry_timestamp='2024-01-10 00:00:00',
        entry_close=100.0,
        entry_atr=2.0,
        forward_5_return_atr=forward5,
        forward_10_return_atr=forward10,
        mfe_10_atr=mfe10,
        mae_10_atr=mae10,
        hit_plus_1atr_first=hit_plus,
        hit_minus_1atr_first=hit_minus,
        next_break_up=break_up,
        next_break_down=break_down,
    )


class StructureDiscoveryFamilyTests(unittest.TestCase):
    def test_family_aggregation_groups_by_signature_and_computes_stats(self):
        motifs = [
            _motif('m1', 'SIG_A', quality=0.5, regime='RANGE'),
            _motif('m2', 'SIG_A', quality=0.7, regime='RANGE'),
            _motif('m3', 'SIG_A', quality=0.9, regime='UPTREND'),
            _motif('m4', 'SIG_B', quality=0.3, regime='DOWNTREND'),
            _motif('m5', 'SIG_B', quality=0.4, regime='DOWNTREND'),
        ]
        outcomes = [
            _outcome('m1', 0.5, 1.0, 1.5, 0.5, True, False, True, False),
            _outcome('m2', -0.5, 0.5, 1.0, 1.0, False, True, False, True),
            _outcome('m3', 0.0, None, None, None, None, None, None, None),
            _outcome('m4', 0.2, -0.4, 0.7, 1.1, False, True, False, True),
            _outcome('m5', None, None, None, None, None, None, None, None),
        ]

        family_stats, family_summary = aggregate_family_stats(
            motifs=motifs,
            outcomes=outcomes,
            min_occurrence_count=2,
            min_valid_10bar_count=2,
        )

        self.assertEqual(len(family_stats), 2)
        family_a = next(record for record in family_stats if record.family_signature == 'SIG_A')
        self.assertEqual(family_a.occurrence_count, 3)
        self.assertEqual(family_a.valid_5bar_count, 3)
        self.assertEqual(family_a.valid_10bar_count, 2)
        self.assertAlmostEqual(family_a.avg_forward_10_return_atr, 0.75)
        self.assertAlmostEqual(family_a.median_forward_10_return_atr, 0.75)
        self.assertAlmostEqual(family_a.forward_10_std_dev_atr, 0.25)
        self.assertAlmostEqual(family_a.forward_10_std_error_atr, 0.25 / (2 ** 0.5))
        self.assertAlmostEqual(family_a.t_score_forward_10, 3.0 * (2 ** 0.5))
        self.assertAlmostEqual(family_a.sharpe_like_forward_10, 3.0)
        self.assertAlmostEqual(family_a.hit_plus_1atr_first_rate, 0.5)
        self.assertAlmostEqual(family_a.next_break_up_rate, 0.5)
        self.assertTrue(family_a.passes_min_count)
        self.assertTrue(family_a.passes_outcome_coverage)
        self.assertTrue(family_a.is_candidate_family)
        self.assertEqual(family_a.regime_distribution['RANGE'], 2)

        family_b = next(record for record in family_stats if record.family_signature == 'SIG_B')
        self.assertEqual(family_b.occurrence_count, 2)
        self.assertEqual(family_b.valid_10bar_count, 1)
        self.assertFalse(family_b.passes_outcome_coverage)
        self.assertFalse(family_b.is_candidate_family)

        self.assertEqual(family_summary['total_unique_families'], 2)
        self.assertEqual(family_summary['families_with_min_occurrences'], 2)
        self.assertEqual(family_summary['families_with_min_valid10'], 1)
        self.assertEqual(family_summary['candidate_family_count'], 1)
        self.assertEqual(family_summary['top_10_avg_forward_10_return_atr'][0]['family_signature'], 'SIG_A')
        self.assertEqual(family_summary['top_10_t_score_forward_10'][0]['family_signature'], 'SIG_A')

    def test_family_split_stats_and_fragmentation_report_are_emitted(self):
        motifs = []
        outcomes = []
        for idx in range(10):
            motifs.append(_motif(f'm{idx}', 'SIG_A|LBL|DIR|R'))
            outcomes.append(_outcome(
                f'm{idx}',
                forward5=0.1 * idx,
                forward10=1.0 if idx < 6 else (0.5 if idx < 8 else 0.25),
                mfe10=1.5,
                mae10=0.5,
                hit_plus=True,
                hit_minus=False,
                break_up=True,
                break_down=False,
            ))

        family_stats, family_summary = aggregate_family_stats(
            motifs=motifs,
            outcomes=outcomes,
            min_occurrence_count=2,
            min_valid_10bar_count=2,
        )
        record = family_stats[0]

        self.assertEqual(record.discovery_count, 6)
        self.assertEqual(record.validation_count, 2)
        self.assertEqual(record.holdout_count, 2)
        self.assertTrue(record.sign_consistent_across_splits)
        self.assertEqual(family_summary['families_with_split_coverage_all_three'], 1)
        self.assertEqual(family_summary['families_sign_consistent_across_splits'], 1)

        fragmentation = build_fragmentation_report(motifs, family_stats)
        self.assertEqual(fragmentation['total_unique_family_signatures'], 1)
        self.assertIn('incremental_uniqueness', fragmentation)

    def test_v2_grouping_merges_exact_signatures_more_coarsely_than_v1(self):
        motifs = [
            _motif('m1', 'HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:OVERDEEP|R3:SHALLOW|R4:OVERDEEP'),
            _motif('m2', 'HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:SHALLOW|R4:DEEP'),
            _motif('m3', 'HIGH-LOW-HIGH-LOW-HIGH|HH-HL-HH-HL-HH|DOWN-UP-DOWN-UP|R2:DEEP|R3:MEDIUM|R4:OVERDEEP'),
        ]
        outcomes = [
            _outcome('m1', 0.1, 0.5, 1.0, 0.3, True, False, True, False),
            _outcome('m2', 0.2, 0.6, 1.1, 0.4, True, False, True, False),
            _outcome('m3', 0.3, 0.7, 1.2, 0.5, True, False, True, False),
        ]

        family_stats_v1, _ = aggregate_family_stats(motifs=motifs, outcomes=outcomes, grouping_version='v1')
        family_stats_v2, _ = aggregate_family_stats(motifs=motifs, outcomes=outcomes, grouping_version='v2')

        self.assertEqual(len(family_stats_v1), 3)
        self.assertEqual(len(family_stats_v2), 1)
        self.assertEqual(family_stats_v2[0].exact_signature_count, 3)


if __name__ == '__main__':
    unittest.main()
