import math
import os
import sys
import unittest

SERVICES_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "services"))
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

from backend.services.platform_sdk.ohlcv import OHLCV
from backend.services.plugins.smart_std_channel_primitive import (
    _calculate_smart_channel_states,
    _fit_channel,
    _fit_prefix_channel,
    _select_anchor_index,
    run_smart_std_channel_primitive_plugin,
)


def _bar(date: str, close: float) -> OHLCV:
    return OHLCV(timestamp=date, open=close, high=close, low=close, close=close, volume=1000)


class SmartStdChannelPrimitiveTests(unittest.TestCase):
    def test_prefix_fit_matches_direct_polyfit_channel(self):
        closes = []
        for idx in range(80):
            value = 40 + idx * 1.7 + math.sin(idx / 3) * 4
            if idx in (22, 61):
                value += 12
            closes.append(value)
        close_arr = __import__("numpy").array(closes, dtype=float)
        x = __import__("numpy").arange(len(close_arr), dtype=float)
        prefix_y = __import__("numpy").cumsum(close_arr)
        prefix_y2 = __import__("numpy").cumsum(close_arr * close_arr)
        prefix_xy = __import__("numpy").cumsum(x * close_arr)

        for end_idx in (23, 35, 79):
            direct = _fit_channel(close_arr[:end_idx + 1])
            fast = _fit_prefix_channel(close_arr, prefix_y, prefix_y2, prefix_xy, end_idx)
            self.assertAlmostEqual(fast["slope"], direct["slope"], places=9)
            self.assertAlmostEqual(fast["intercept"], direct["intercept"], places=9)
            self.assertAlmostEqual(fast["mean"], direct["mean"], places=9)
            self.assertAlmostEqual(fast["std_dev"], direct["std_dev"], places=9)
            self.assertAlmostEqual(fast["z_score"], direct["z_score"], places=9)

    def test_anchor_uses_1987_when_history_goes_back_far_enough(self):
        data = [
            _bar("1986-12-01", 10),
            _bar("1987-01-01", 11),
            _bar("1987-02-01", 12),
        ]

        self.assertEqual(_select_anchor_index(data, "1987-01-01"), 1)

    def test_anchor_uses_earliest_bar_when_1987_is_not_available(self):
        data = [
            _bar("1999-01-01", 10),
            _bar("1999-02-01", 11),
        ]

        self.assertEqual(_select_anchor_index(data, "1987-01-01"), 0)

    def test_initial_calibration_floors_current_deviation_then_only_steps_up(self):
        data = []
        for idx in range(36):
            year = 1987 + idx // 12
            month = (idx % 12) + 1
            close = 100 + idx
            if idx == 23:
                close += 18
            if idx == 24:
                close = 100 + idx
            if idx == 35:
                close += 38
            data.append(_bar(f"{year}-{month:02d}-28", close))

        result = _calculate_smart_channel_states(
            data,
            anchor_date="1987-01-01",
            min_channel_sd=2,
            min_regression_bars=24,
        )
        states = result["states"]

        self.assertGreaterEqual(len(states), 2)
        self.assertEqual(states[0]["active_level"], math.floor(abs(states[0]["z_score"])))
        self.assertGreaterEqual(states[0]["active_level"], 2)

        active_levels = [state["active_level"] for state in states]
        self.assertEqual(active_levels, sorted(active_levels))
        self.assertEqual(states[1]["active_level"], states[0]["active_level"])
        self.assertGreater(states[-1]["active_level"], states[0]["active_level"])

    def test_lower_channel_is_clamped_at_zero_by_default(self):
        data = []
        for idx in range(36):
            year = 1987 + idx // 12
            month = (idx % 12) + 1
            close = 10 + idx
            if idx == 35:
                close += 100
            data.append(_bar(f"{year}-{month:02d}-28", close))

        result = _calculate_smart_channel_states(
            data,
            anchor_date="1987-01-01",
            min_channel_sd=2,
            min_regression_bars=24,
        )

        self.assertGreaterEqual(result["states"][-1]["lower"], 0)

    def test_plugin_marks_initial_calibration_and_current_level(self):
        data = []
        for idx in range(36):
            year = 1987 + idx // 12
            month = (idx % 12) + 1
            close = 100 + idx
            if idx == 23:
                close += 35
            data.append(_bar(f"{year}-{month:02d}-28", close))

        candidate = run_smart_std_channel_primitive_plugin(
            data,
            structure=None,
            spec={"setup_config": {"interest_threshold_sd": 4, "min_regression_bars": 24}},
            symbol="TEST",
            timeframe="W",
        )[0]

        labels = [marker["text"] for marker in candidate["visual"]["markers"]]
        self.assertTrue(any(label.startswith("CAL ") for label in labels))
        self.assertTrue(any(label.startswith("NOW ") for label in labels))

    def test_below_mean_signal_filters_out_above_mean_setups(self):
        data = []
        for idx in range(36):
            year = 1987 + idx // 12
            month = (idx % 12) + 1
            close = 100 + idx
            if idx == 35:
                close += 30
            data.append(_bar(f"{year}-{month:02d}-28", close))

        result = run_smart_std_channel_primitive_plugin(
            data,
            structure=None,
            spec={"setup_config": {"pattern_type": "statistical_value_long_primitive", "signal_side": "below_mean"}},
            symbol="TEST",
            timeframe="W",
        )

        self.assertEqual(result, [])

    def test_below_mean_signal_emits_long_candidate_when_price_is_below_mean(self):
        data = []
        for idx in range(36):
            year = 1987 + idx // 12
            month = (idx % 12) + 1
            close = 100 + idx
            if idx == 35:
                close -= 30
            data.append(_bar(f"{year}-{month:02d}-28", close))

        result = run_smart_std_channel_primitive_plugin(
            data,
            structure=None,
            spec={"setup_config": {"pattern_type": "statistical_value_long_primitive", "signal_side": "below_mean"}},
            symbol="TEST",
            timeframe="W",
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["pattern_type"], "statistical_value_long_primitive")
        self.assertEqual(result[0]["node_result"]["features"]["price_vs_smart_mean"], "below")


if __name__ == "__main__":
    unittest.main()
