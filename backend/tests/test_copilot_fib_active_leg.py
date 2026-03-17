import unittest
from types import SimpleNamespace

from backend.services.platform_sdk.fib_analysis import calculate_fib_energy_signal
from backend.services.platform_sdk.ohlcv import OHLCV
from backend.services.platform_sdk.swing_structure import ConfirmedSwingPoint


class CopilotFibActiveLegTests(unittest.TestCase):
    def test_uses_active_leg_from_latest_confirmed_low_instead_of_stale_macro_range(self):
        filler = [
            OHLCV(timestamp=f"2023-10-{day:02d}", open=12, high=14, low=11, close=13, volume=1000)
            for day in range(1, 14)
        ]
        leg_data = [
            OHLCV(timestamp="2024-01-01", open=15, high=20, low=10, close=18, volume=1000),
            OHLCV(timestamp="2024-01-08", open=90, high=100, low=80, close=95, volume=1000),
            OHLCV(timestamp="2024-01-15", open=50, high=60, low=40, close=45, volume=1000),
            OHLCV(timestamp="2024-01-22", open=82, high=90, low=70, close=88, volume=1000),
            OHLCV(timestamp="2024-01-29", open=52, high=55, low=50, close=51, volume=1000),
            OHLCV(timestamp="2024-02-05", open=61, high=70, low=60, close=69, volume=1000),
            OHLCV(timestamp="2024-02-12", open=70, high=76, low=65, close=74, volume=1000),
        ]
        data = filler + leg_data
        offset = len(filler)
        structure = SimpleNamespace(
            swing_points=[
                ConfirmedSwingPoint(index=offset + 1, price=100.0, date="2024-01-08", point_type="HIGH"),
                ConfirmedSwingPoint(index=offset + 2, price=40.0, date="2024-01-15", point_type="LOW"),
                ConfirmedSwingPoint(index=offset + 3, price=90.0, date="2024-01-22", point_type="HIGH"),
                ConfirmedSwingPoint(index=offset + 4, price=50.0, date="2024-01-29", point_type="LOW"),
            ]
        )

        signal = calculate_fib_energy_signal(
            data,
            symbol="TEST",
            timeframe="W",
            swing_structure=structure,
        )

        self.assertIsNotNone(signal)
        self.assertEqual(signal.range_low, 50.0)
        self.assertEqual(signal.range_high, 76.0)
        self.assertEqual(signal.range_low_date, "2024-01-29")
        self.assertEqual(signal.range_high_date, "2024-02-12")
        self.assertAlmostEqual(signal.current_retracement_pct, 7.7, places=1)

    def test_short_direction_prefers_latest_bearish_leg_and_measures_bounce_from_low(self):
        filler = [
            OHLCV(timestamp=f"2023-10-{day:02d}", open=12, high=14, low=11, close=13, volume=1000)
            for day in range(1, 14)
        ]
        leg_data = [
            OHLCV(timestamp="2024-01-01", open=15, high=20, low=10, close=18, volume=1000),
            OHLCV(timestamp="2024-01-08", open=90, high=100, low=80, close=95, volume=1000),
            OHLCV(timestamp="2024-01-15", open=50, high=60, low=40, close=45, volume=1000),
            OHLCV(timestamp="2024-01-22", open=82, high=90, low=70, close=88, volume=1000),
            OHLCV(timestamp="2024-01-29", open=52, high=55, low=50, close=51, volume=1000),
            OHLCV(timestamp="2024-02-05", open=61, high=70, low=60, close=69, volume=1000),
            OHLCV(timestamp="2024-02-12", open=70, high=76, low=65, close=74, volume=1000),
        ]
        data = filler + leg_data
        offset = len(filler)
        structure = SimpleNamespace(
            swing_points=[
                ConfirmedSwingPoint(index=offset + 1, price=100.0, date="2024-01-08", point_type="HIGH"),
                ConfirmedSwingPoint(index=offset + 2, price=40.0, date="2024-01-15", point_type="LOW"),
                ConfirmedSwingPoint(index=offset + 3, price=90.0, date="2024-01-22", point_type="HIGH"),
                ConfirmedSwingPoint(index=offset + 4, price=50.0, date="2024-01-29", point_type="LOW"),
            ]
        )

        signal = calculate_fib_energy_signal(
            data,
            symbol="TEST",
            timeframe="W",
            swing_structure=structure,
            trade_direction="SHORT",
        )

        self.assertIsNotNone(signal)
        self.assertEqual(signal.range_direction, "bearish")
        self.assertEqual(signal.range_high, 90.0)
        self.assertEqual(signal.range_low, 50.0)
        self.assertEqual(signal.range_high_date, "2024-01-22")
        self.assertEqual(signal.range_low_date, "2024-01-29")
        self.assertAlmostEqual(signal.current_retracement_pct, 60.0, places=1)


if __name__ == "__main__":
    unittest.main()
