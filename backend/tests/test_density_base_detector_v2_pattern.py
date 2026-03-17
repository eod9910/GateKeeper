import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

from platform_sdk.ohlcv import OHLCV  # noqa: E402
from plugins import density_base_detector_v2_pattern as plugin  # noqa: E402


def _bar(index: int, close: float) -> OHLCV:
    timestamp = (datetime(2020, 1, 3) + timedelta(weeks=index)).strftime('%Y-%m-%d 00:00:00')
    return OHLCV(
        timestamp=timestamp,
        open=close,
        high=close * 1.01,
        low=close * 0.99,
        close=close,
        volume=1_000_000,
    )


class DensityBaseDetectorV2RankingTests(unittest.TestCase):
    def test_active_base_state_uses_atr_normalized_extension(self):
        data = [_bar(i, 100 + i) for i in range(30)]
        base = {
            'base_top': 120.0,
            'base_bottom': 110.0,
            'base_end_idx': 20,
            'span_bars': 8,
        }

        original_base_context_atr = plugin._base_context_atr
        original_breakout_age_bars = plugin._breakout_age_bars
        try:
            plugin._base_context_atr = lambda *_args, **_kwargs: 10.0
            plugin._breakout_age_bars = lambda *_args, **_kwargs: 0

            data[-1].close = 127.0
            trigger_state = plugin._compute_active_base_state(data, base, True, 10.0, {})
            data[-1].close = 132.0
            expanding_state = plugin._compute_active_base_state(data, base, True, 10.0, {})
            data[-1].close = 106.0
            failed_state = plugin._compute_active_base_state(data, base, True, 10.0, {})
        finally:
            plugin._base_context_atr = original_base_context_atr
            plugin._breakout_age_bars = original_breakout_age_bars

        self.assertEqual(trigger_state['state'], 'trigger')
        self.assertAlmostEqual(trigger_state['extension_atr'], 0.7)
        self.assertEqual(expanding_state['state'], 'expanding')
        self.assertEqual(failed_state['state'], 'failed')

    def test_peak_map_merge_keeps_distinct_recent_local_peak(self):
        merged = plugin._merge_peak_maps(
            [
                {'idx': 100, 'price': 200.0, 'source': 'rdp'},
                {'idx': 200, 'price': 300.0, 'source': 'rdp'},
            ],
            [
                {'idx': 108, 'price': 202.0, 'source': 'local'},
                {'idx': 260, 'price': 380.0, 'source': 'local'},
            ],
            min_index_gap=12,
            min_price_gap_pct=0.04,
        )

        self.assertEqual(len(merged), 3)
        self.assertEqual(merged[-1]['idx'], 260)
        self.assertEqual(merged[-1]['source'], 'local')

    def test_select_recent_supplemental_peaks_picks_latest_qualifying_local_peak(self):
        closes = [100 + i for i in range(40)]
        data = [_bar(i, close) for i, close in enumerate(closes)]

        primary = [{'idx': 20, 'price': 140.0, 'source': 'rdp'}]
        local = [
            {'idx': 24, 'price': 150.0, 'source': 'local'},
            {'idx': 32, 'price': 170.0, 'source': 'local'},
        ]

        original_measure_void = plugin._measure_void
        try:
            def fake_measure_void(_data, peak_idx, peak_price, _end, min_drop_pct=0.08, min_void_bars=8):
                if peak_idx == 32:
                    return {
                        'peak_idx': peak_idx,
                        'peak_price': peak_price,
                        'void_start': 33,
                        'void_end': 39,
                        'void_bars': 8,
                        'lowest_price': peak_price * 0.85,
                        'lowest_idx': 35,
                        'drop': peak_price * 0.15,
                        'drop_pct': 0.15,
                        'recovered': True,
                    }
                return None

            plugin._measure_void = fake_measure_void
            supplemental = plugin._select_recent_supplemental_peaks(
                data,
                primary,
                local,
                end=len(data) - 1,
                min_drop_pct=0.08,
                min_void_bars=8,
                swing_lookback=5,
            )
        finally:
            plugin._measure_void = original_measure_void

        self.assertEqual(len(supplemental), 1)
        self.assertEqual(supplemental[0]['idx'], 32)

    def test_base_detection_stays_anchored_to_void_low_not_upper_recovery_shelf(self):
        closes = [
            100, 96, 90, 82, 74, 68, 64, 66, 65, 67, 66, 70,
            76, 82, 88, 92, 95, 96, 94, 95,
        ]
        data = [_bar(i, close) for i, close in enumerate(closes)]
        void = {
            'void_start': 1,
            'void_end': len(data) - 1,
            'lowest_idx': 6,
            'lowest_price': 63.36,
            'drop': 36.64,
        }

        base = plugin._find_base_in_void(data, void, atr_val=2.0, min_base_bars=5)

        self.assertIsNotNone(base)
        assert base is not None
        self.assertLess(base['base_top'], 80)
        self.assertLessEqual(base['base_low_idx'], 10)
        self.assertGreaterEqual(base['base_low_idx'], 5)
        self.assertFalse(base['still_declining'])

    def test_recovered_void_can_keep_four_bar_base_window(self):
        closes = [100, 94, 86, 78, 72, 68, 66, 67, 69, 75, 81]
        data = [_bar(i, close) for i, close in enumerate(closes)]
        void = {
            'void_start': 1,
            'void_end': 9,
            'lowest_idx': 6,
            'lowest_price': 65.34,
            'drop': 34.66,
            'recovered': True,
        }

        base = plugin._find_base_in_void(data, void, atr_val=2.0, min_base_bars=5)

        self.assertIsNotNone(base)
        assert base is not None
        self.assertGreaterEqual(base['base_bar_count'], 4)

    def test_display_rank_prefers_recent_nearby_base_over_old_macro_base(self):
        data = [_bar(i, 60 + (i * 0.5)) for i in range(120)]

        old_macro_base = {
            'base_top': 70.0,
            'base_bottom': 55.0,
            'base_width': 15.0,
            'base_end_idx': 25,
            'span_bars': 40,
        }
        recent_active_base = {
            'base_top': 114.0,
            'base_bottom': 100.0,
            'base_width': 14.0,
            'base_end_idx': 112,
            'span_bars': 18,
        }

        old_rank = plugin._rank_result_for_display(data, 0.95, old_macro_base, 2.0)
        recent_rank = plugin._rank_result_for_display(data, 0.68, recent_active_base, 2.0)

        self.assertGreater(old_rank['rank_score'], 0.45)
        self.assertGreater(recent_rank['rank_score'], old_rank['rank_score'])
        self.assertLess(old_rank['price_proximity_score'], recent_rank['price_proximity_score'])
        self.assertLess(old_rank['recency_score'], recent_rank['recency_score'])

    def test_allowed_active_state_filter_defaults_to_forming(self):
        self.assertEqual(plugin._parse_allowed_active_states({}), ['forming'])
        self.assertEqual(
            plugin._parse_allowed_active_states({'allowed_active_base_states': 'forming,trigger'}),
            ['forming', 'trigger'],
        )

    def test_visuals_include_every_detected_base(self):
        data = [_bar(i, 80 + i) for i in range(20)]
        qualified = [
            {
                'base': {
                    'base_top': 95.0,
                    'base_bottom': 90.0,
                    'base_start_idx': 2,
                    'base_end_idx': 5,
                    'base_low_idx': 3,
                },
                'void': {'recovered': True},
                'score': 0.8,
                'rank_score': 0.8,
                'scale': 'macro',
            },
            {
                'base': {
                    'base_top': 108.0,
                    'base_bottom': 101.0,
                    'base_start_idx': 10,
                    'base_end_idx': 13,
                    'base_low_idx': 11,
                },
                'void': {'recovered': True},
                'score': 0.7,
                'rank_score': 0.7,
                'scale': 'micro',
            },
        ]

        overlays, hlevels, markers = plugin._build_all_base_visuals(data, qualified, False)

        self.assertEqual(len(overlays), 4)
        self.assertEqual(len(hlevels), 2)
        self.assertEqual(len(markers), 2)
        self.assertEqual(overlays[0]['label'], '')
        self.assertEqual(hlevels[0]['label'], 'Active Base Top $95.00')
        self.assertEqual(hlevels[1]['label'], 'Active Base Bottom $90.00')
        self.assertEqual(markers[0]['text'], 'ACTIVE BASE (FORMING)')
        self.assertEqual(markers[1]['text'], 'B2')


if __name__ == '__main__':
    unittest.main()
