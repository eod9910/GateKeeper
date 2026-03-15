import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

from platform_sdk.ohlcv import OHLCV  # noqa: E402
from research_v1 import (  # noqa: E402
    build_five_pivot_motifs,
    build_leg_records,
    extract_atr_reversal_pivots,
    label_pivots_against_same_side_history,
    normalize_bars,
)


def _bar(index: int, open_price: float, high: float, low: float, close: float, volume: float = 1_000_000) -> OHLCV:
    timestamp = (datetime(2024, 1, 1) + timedelta(days=index)).strftime('%Y-%m-%d 00:00:00')
    return OHLCV(
        timestamp=timestamp,
        open=open_price,
        high=high,
        low=low,
        close=close,
        volume=volume,
    )


class StructureDiscoveryPipelineTests(unittest.TestCase):
    def test_leg_builder_produces_expected_record_count_and_metrics(self):
        bars = [
            _bar(0, 10.0, 10.0, 10.0, 10.0),
            _bar(1, 10.0, 12.0, 9.0, 11.0),
            _bar(2, 11.0, 11.5, 10.8, 11.2),
            _bar(3, 11.2, 11.4, 8.0, 8.5),
            _bar(4, 8.5, 10.5, 8.4, 10.2),
            _bar(5, 10.2, 12.5, 10.0, 12.0),
            _bar(6, 12.0, 12.2, 9.5, 10.0),
        ]
        normalized = normalize_bars(bars, symbol='TEST', timeframe='1d')
        for record in normalized:
            record.atr_14 = 1.0

        pivots = extract_atr_reversal_pivots(normalized, 'TEST', '1d', reversal_multiple=1.5, min_bars_between_pivots=1)
        legs = build_leg_records(normalized, pivots, symbol='TEST', timeframe='1d')

        self.assertEqual(len(legs), max(len(pivots) - 1, 0))
        self.assertGreater(len(legs), 0)
        self.assertTrue(all(leg.bar_count >= 1 for leg in legs))
        self.assertTrue(all(leg.distance_atr_norm >= 0 for leg in legs))
        self.assertTrue(all(leg.volume_sum > 0 for leg in legs))

    def test_same_side_labels_follow_deterministic_high_low_rules(self):
        bars = [
            _bar(0, 10.0, 10.0, 10.0, 10.0),
            _bar(1, 10.0, 13.0, 9.2, 12.7),
            _bar(2, 12.7, 12.8, 10.0, 10.4),
            _bar(3, 10.4, 14.5, 10.2, 14.0),
            _bar(4, 14.0, 14.1, 10.8, 11.1),
            _bar(5, 11.1, 11.4, 8.4, 8.8),
            _bar(6, 8.8, 13.4, 8.7, 13.0),
            _bar(7, 13.0, 13.1, 9.0, 9.4),
        ]
        normalized = normalize_bars(bars, symbol='TEST', timeframe='1d')
        for record in normalized:
            record.atr_14 = 1.0

        pivots = extract_atr_reversal_pivots(normalized, 'TEST', '1d', reversal_multiple=1.5, min_bars_between_pivots=1)
        labels = label_pivots_against_same_side_history(pivots, normalized, equal_band_atr=0.25)
        label_values = [label.major_label.value for label in labels]

        self.assertGreaterEqual(len(label_values), 4)
        self.assertIn('HH', label_values)
        self.assertIn('LL', label_values)

    def test_five_pivot_motif_generation_emits_machine_readable_sequences(self):
        bars = [
            _bar(0, 10.0, 10.2, 9.7, 10.0),
            _bar(1, 10.0, 12.8, 9.8, 12.4),
            _bar(2, 12.4, 12.5, 10.1, 10.4),
            _bar(3, 10.4, 13.6, 10.2, 13.2),
            _bar(4, 13.2, 13.3, 10.4, 10.8),
            _bar(5, 10.8, 14.3, 10.5, 13.9),
            _bar(6, 13.9, 14.0, 10.0, 10.3),
            _bar(7, 10.3, 13.5, 10.1, 13.0),
            _bar(8, 13.0, 13.1, 9.4, 9.8),
            _bar(9, 9.8, 12.7, 9.7, 12.0),
        ]
        normalized = normalize_bars(bars, symbol='TEST', timeframe='1d')
        for record in normalized:
            record.atr_14 = 1.0

        pivots = extract_atr_reversal_pivots(normalized, 'TEST', '1d', reversal_multiple=1.5, min_bars_between_pivots=1)
        legs = build_leg_records(normalized, pivots, symbol='TEST', timeframe='1d')
        labels = label_pivots_against_same_side_history(pivots, normalized, equal_band_atr=0.25)
        motifs = build_five_pivot_motifs(pivots, legs, labels, symbol='TEST', timeframe='1d')

        self.assertGreaterEqual(len(motifs), 1)
        motif = motifs[0]
        self.assertEqual(len(motif.pivot_ids), 5)
        self.assertEqual(len(motif.leg_ids), 4)
        self.assertEqual(len(motif.pivot_type_seq), 5)
        self.assertEqual(len(motif.pivot_label_seq), 5)
        self.assertEqual(len(motif.leg_direction_seq), 4)
        self.assertIsNotNone(motif.family_signature)
        self.assertIn('HIGH', motif.family_signature)


if __name__ == '__main__':
    unittest.main()
