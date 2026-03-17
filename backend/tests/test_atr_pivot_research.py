import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

from platform_sdk.ohlcv import OHLCV  # noqa: E402
from research_v1 import extract_atr_reversal_pivots, normalize_bars  # noqa: E402
from research_v1.schema import PivotType  # noqa: E402


def _bar(index: int, open_price: float, high: float, low: float, close: float) -> OHLCV:
    timestamp = (datetime(2024, 1, 1) + timedelta(days=index)).strftime('%Y-%m-%d 00:00:00')
    return OHLCV(
        timestamp=timestamp,
        open=open_price,
        high=high,
        low=low,
        close=close,
        volume=1_000_000,
    )


class AtrPivotResearchTests(unittest.TestCase):
    def test_normalizer_produces_expected_fields(self):
        bars = [
            _bar(0, 10, 11, 9, 10.5),
            _bar(1, 10.5, 12, 10, 11.5),
            _bar(2, 11.5, 13, 11, 12.5),
        ]

        normalized = normalize_bars(bars, symbol='TEST', timeframe='1d')

        self.assertEqual(len(normalized), 3)
        self.assertEqual(normalized[0].symbol, 'TEST')
        self.assertEqual(normalized[1].bar_index, 1)
        self.assertGreater(normalized[2].atr_14, 0.0)
        self.assertGreater(normalized[2].range_atr_norm, 0.0)

    def test_candidate_replacement_uses_more_extreme_high_before_confirmation(self):
        bars = [
            _bar(0, 10.0, 10.0, 10.0, 10.0),
            _bar(1, 10.0, 11.0, 10.8, 10.9),
            _bar(2, 10.9, 12.0, 11.4, 11.7),
            _bar(3, 11.7, 14.0, 13.4, 13.8),
            _bar(4, 13.8, 13.8, 11.8, 12.1),
            _bar(5, 12.1, 12.2, 10.4, 10.8),
            _bar(6, 10.8, 11.1, 9.6, 10.0),
        ]

        normalized = normalize_bars(bars, symbol='TEST', timeframe='1d')
        for record in normalized:
            record.atr_14 = 1.0

        pivots = extract_atr_reversal_pivots(
            normalized,
            symbol='TEST',
            timeframe='1d',
            reversal_multiple=1.5,
            min_bars_between_pivots=3,
        )

        self.assertEqual(len(pivots), 2)
        self.assertEqual(pivots[0].pivot_type, PivotType.LOW)
        self.assertEqual(pivots[1].pivot_type, PivotType.HIGH)
        self.assertEqual(pivots[1].bar_index, 3)
        self.assertEqual(pivots[1].price, 14.0)
        self.assertEqual(pivots[1].confirmation_bar_index, 4)
        self.assertEqual(pivots[1].confirmation_delay_bars, 1)

    def test_alternating_pivots_and_min_bar_spacing_are_enforced(self):
        bars = [
            _bar(0, 10.0, 10.0, 10.0, 10.0),
            _bar(1, 10.0, 10.4, 9.7, 10.2),
            _bar(2, 10.2, 12.0, 10.8, 11.8),
            _bar(3, 11.8, 13.0, 12.0, 12.7),
            _bar(4, 12.7, 12.8, 10.9, 11.0),
            _bar(5, 11.0, 11.1, 8.5, 9.0),
            _bar(6, 9.0, 9.5, 8.7, 9.2),
            _bar(7, 9.2, 10.0, 8.8, 9.8),
            _bar(8, 9.8, 12.4, 9.7, 12.0),
            _bar(9, 12.0, 13.2, 11.7, 12.8),
            _bar(10, 12.8, 12.9, 10.1, 10.6),
            _bar(11, 10.6, 10.7, 8.0, 8.7),
            _bar(12, 8.7, 9.0, 8.2, 8.8),
            _bar(13, 8.8, 11.0, 8.6, 10.8),
            _bar(14, 10.8, 12.8, 10.5, 12.4),
            _bar(15, 12.4, 12.5, 9.8, 10.2),
        ]

        normalized = normalize_bars(bars, symbol='TEST', timeframe='1d')
        for record in normalized:
            record.atr_14 = 1.0

        pivots = extract_atr_reversal_pivots(
            normalized,
            symbol='TEST',
            timeframe='1d',
            reversal_multiple=1.5,
            min_bars_between_pivots=3,
        )

        self.assertGreaterEqual(len(pivots), 2)
        self.assertEqual([pivot.pivot_type for pivot in pivots[:2]], [PivotType.LOW, PivotType.HIGH])
        self.assertGreaterEqual(pivots[1].confirmation_bar_index - pivots[0].bar_index, 3)
        self.assertAlmostEqual(pivots[1].distance_from_prev_pivot_atr, abs(pivots[1].price - pivots[0].price))
        self.assertTrue(all(pivot.confirmation_delay_bars >= 1 for pivot in pivots))
        self.assertTrue(all(
            pivots[idx].pivot_type != pivots[idx - 1].pivot_type
            for idx in range(1, len(pivots))
        ))

    def test_same_bar_confirmation_is_not_allowed(self):
        bars = [
            _bar(0, 10.0, 10.0, 10.0, 10.0),
            _bar(1, 10.0, 12.0, 9.0, 11.0),
            _bar(2, 11.0, 11.5, 10.8, 11.2),
            _bar(3, 11.2, 11.4, 8.0, 8.5),
        ]

        normalized = normalize_bars(bars, symbol='TEST', timeframe='1d')
        for record in normalized:
            record.atr_14 = 1.0

        pivots = extract_atr_reversal_pivots(
            normalized,
            symbol='TEST',
            timeframe='1d',
            reversal_multiple=1.5,
            min_bars_between_pivots=1,
        )

        self.assertEqual(len(pivots), 2)
        self.assertTrue(all(pivot.confirmation_delay_bars >= 1 for pivot in pivots))
        self.assertEqual(pivots[0].bar_index, 1)
        self.assertEqual(pivots[1].bar_index, 2)


if __name__ == '__main__':
    unittest.main()
