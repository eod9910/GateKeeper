import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

from research_v1 import evaluate_motif_outcomes  # noqa: E402
from research_v1.schema import (  # noqa: E402
    BarRecord,
    MotifInstanceRecord,
    PivotLabel,
    PivotType,
    PivotRecord,
)


def _bar(index: int, close: float, high: float, low: float, atr: float = 1.0) -> BarRecord:
    return BarRecord(
        symbol='TEST',
        timeframe='1d',
        timestamp=f'2024-01-{index + 1:02d} 00:00:00',
        bar_index=index,
        open=close,
        high=high,
        low=low,
        close=close,
        volume=1_000_000,
        atr_14=atr,
        bar_range=high - low,
        body_size=0.0,
        range_atr_norm=(high - low) / atr,
        body_atr_norm=0.0,
    )


class StructureDiscoveryOutcomeTests(unittest.TestCase):
    def test_outcomes_use_pivot_five_confirmation_bar_and_compute_forward_metrics(self):
        bars = [
            _bar(0, 97, 98, 96),
            _bar(1, 100, 101, 99),
            _bar(2, 98, 99, 97),
            _bar(3, 101, 102, 100),
            _bar(4, 99, 100, 98),
            _bar(5, 100, 101, 99),   # pivot-5 confirmation / entry bar
            _bar(6, 100.4, 100.8, 99.4),
            _bar(7, 101.2, 101.5, 100.1),
            _bar(8, 100.9, 101.2, 100.0),
            _bar(9, 102.1, 102.2, 100.8),
            _bar(10, 103.0, 103.3, 102.0),
            _bar(11, 102.8, 103.1, 101.7),
            _bar(12, 103.2, 103.6, 102.1),
            _bar(13, 104.0, 104.8, 102.4),
            _bar(14, 104.3, 104.6, 103.5),
            _bar(15, 104.0, 104.3, 103.2),
        ]
        pivots = [
            PivotRecord('pivot_000001', 'TEST', '1d', 0, bars[0].timestamp, 96.0, PivotType.LOW, 0, 0, 0, 1.0, None, None),
            PivotRecord('pivot_000002', 'TEST', '1d', 1, bars[1].timestamp, 101.0, PivotType.HIGH, 1, 1, 0, 1.0, 5.0, 1),
            PivotRecord('pivot_000003', 'TEST', '1d', 2, bars[2].timestamp, 97.0, PivotType.LOW, 2, 2, 0, 1.0, 4.0, 1),
            PivotRecord('pivot_000004', 'TEST', '1d', 3, bars[3].timestamp, 102.0, PivotType.HIGH, 3, 3, 0, 1.0, 5.0, 1),
            PivotRecord('pivot_000005', 'TEST', '1d', 4, bars[4].timestamp, 98.0, PivotType.LOW, 4, 5, 1, 1.0, 4.0, 1),
        ]
        motif = MotifInstanceRecord(
            motif_instance_id='motif_000001',
            symbol='TEST',
            timeframe='1d',
            start_bar_index=0,
            end_bar_index=4,
            pivot_ids=[pivot.pivot_id for pivot in pivots],
            leg_ids=['leg_000001', 'leg_000002', 'leg_000003', 'leg_000004'],
            pivot_type_seq=[pivot.pivot_type for pivot in pivots],
            pivot_label_seq=[PivotLabel.HL, PivotLabel.HH, PivotLabel.HL, PivotLabel.HH, PivotLabel.HL],
            leg_direction_seq=[],
            feature_vector={},
            quality_score=0.0,
            regime_tag=None,
            family_signature='test',
            family_id=None,
        )

        outcomes = evaluate_motif_outcomes([motif], pivots, bars)
        self.assertEqual(len(outcomes), 1)
        outcome = outcomes[0]

        self.assertEqual(outcome.entry_bar_index, 5)
        self.assertEqual(outcome.entry_close, 100.0)
        self.assertEqual(outcome.entry_atr, 1.0)
        self.assertAlmostEqual(outcome.forward_5_return_atr, 3.0)
        self.assertAlmostEqual(outcome.forward_10_return_atr, 4.0)
        self.assertAlmostEqual(outcome.mfe_10_atr, 4.8)
        self.assertAlmostEqual(outcome.mae_10_atr, 0.6)
        self.assertTrue(outcome.hit_plus_1atr_first)
        self.assertFalse(outcome.hit_minus_1atr_first)
        self.assertTrue(outcome.next_break_up)
        self.assertFalse(outcome.next_break_down)

    def test_outcomes_mark_incomplete_ten_bar_windows_as_null(self):
        bars = [
            _bar(0, 97, 98, 96),
            _bar(1, 100, 101, 99),
            _bar(2, 98, 99, 97),
            _bar(3, 101, 102, 100),
            _bar(4, 99, 100, 98),
            _bar(5, 100, 101, 99),
            _bar(6, 100.5, 101.0, 100.0),
            _bar(7, 101.0, 101.2, 100.6),
            _bar(8, 101.5, 101.6, 101.0),
        ]
        pivots = [
            PivotRecord('pivot_000001', 'TEST', '1d', 0, bars[0].timestamp, 96.0, PivotType.LOW, 0, 0, 0, 1.0, None, None),
            PivotRecord('pivot_000002', 'TEST', '1d', 1, bars[1].timestamp, 101.0, PivotType.HIGH, 1, 1, 0, 1.0, 5.0, 1),
            PivotRecord('pivot_000003', 'TEST', '1d', 2, bars[2].timestamp, 97.0, PivotType.LOW, 2, 2, 0, 1.0, 4.0, 1),
            PivotRecord('pivot_000004', 'TEST', '1d', 3, bars[3].timestamp, 102.0, PivotType.HIGH, 3, 3, 0, 1.0, 5.0, 1),
            PivotRecord('pivot_000005', 'TEST', '1d', 4, bars[4].timestamp, 98.0, PivotType.LOW, 4, 5, 1, 1.0, 4.0, 1),
        ]
        motif = MotifInstanceRecord(
            motif_instance_id='motif_000002',
            symbol='TEST',
            timeframe='1d',
            start_bar_index=0,
            end_bar_index=4,
            pivot_ids=[pivot.pivot_id for pivot in pivots],
            leg_ids=['leg_000001', 'leg_000002', 'leg_000003', 'leg_000004'],
            pivot_type_seq=[pivot.pivot_type for pivot in pivots],
            pivot_label_seq=[PivotLabel.HL, PivotLabel.HH, PivotLabel.HL, PivotLabel.HH, PivotLabel.HL],
            leg_direction_seq=[],
            feature_vector={},
            quality_score=0.0,
            regime_tag=None,
            family_signature='test',
            family_id=None,
        )

        outcomes = evaluate_motif_outcomes([motif], pivots, bars)
        outcome = outcomes[0]

        self.assertIsNone(outcome.forward_5_return_atr)
        self.assertIsNone(outcome.forward_10_return_atr)
        self.assertIsNone(outcome.mfe_10_atr)
        self.assertIsNone(outcome.mae_10_atr)
        self.assertIsNone(outcome.hit_plus_1atr_first)
        self.assertIsNone(outcome.hit_minus_1atr_first)
        self.assertIsNone(outcome.next_break_up)
        self.assertIsNone(outcome.next_break_down)


if __name__ == '__main__':
    unittest.main()
