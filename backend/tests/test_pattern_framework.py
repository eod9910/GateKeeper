import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

from platform_sdk.ohlcv import OHLCV  # noqa: E402
from plugins import head_shoulders_context_pattern as hs_plugin  # noqa: E402
from plugins import pattern_framework as framework  # noqa: E402
from plugins import three_drives_pattern as td_plugin  # noqa: E402


def _bar(index: int, close: float, high_pad: float = 2.0, low_pad: float = 2.0) -> OHLCV:
    timestamp = (datetime(2024, 1, 1) + timedelta(days=index)).strftime('%Y-%m-%d 00:00:00')
    return OHLCV(
        timestamp=timestamp,
        open=close - 1.0,
        high=close + high_pad,
        low=close - low_pad,
        close=close,
        volume=1_000_000,
    )


class PatternFrameworkTests(unittest.TestCase):
    def test_unknown_preprocess_method_falls_back_to_ema(self):
        data = [_bar(idx, 100 + idx) for idx in range(12)]

        result = framework.preprocess_ohlcv_series(
            data,
            source='close',
            method='does_not_exist',
            window=4,
            fallback_method='ema',
        )

        self.assertEqual(result.method, 'ema')
        self.assertEqual(len(result.values), len(data))
        self.assertEqual(result.metadata.get('fallback_to'), 'ema')

    def test_find_local_extrema_and_merge_alternates(self):
        values = [1, 3, 2, 5, 1, 4, 2]
        highs = framework.find_local_extrema(values, left=1, right=1, mode='max')
        lows = framework.find_local_extrema(values, left=1, right=1, mode='min')
        merged = framework.merge_alternating_pivots(highs, lows)

        self.assertEqual([item['type'] for item in merged], ['HIGH', 'LOW', 'HIGH', 'LOW', 'HIGH'])
        self.assertEqual([item['index'] for item in merged], [1, 2, 3, 4, 5])

    def test_head_shoulders_context_plugin_emits_retrace_entry_candidate(self):
        closes = [
            40, 42, 45, 47, 50, 54, 58, 63, 70, 78,
            84, 79, 73, 66, 61, 67, 74, 81, 87, 82,
            75, 69, 64, 68, 73, 79, 84, 83, 77, 70,
            61, 55, 52, 58, 64, 69, 72, 73, 72, 73,
        ]
        data = [_bar(idx, close) for idx, close in enumerate(closes)]
        spec = {
            'strategy_id': 'head_shoulders_context_pattern',
            'version': '2.0.0',
            'strategy_version_id': 'head_shoulders_context_v2',
            'setup_config': {
                'lookback_bars': 120,
                'pivot_source': 'rdp',
                'swing_epsilon_pct': 0.08,
                'use_exact_epsilon': True,
                'shoulder_tolerance_pct': 0.05,
                'head_dominance_pct': 0.015,
                'neckline_tolerance_pct': 0.08,
                'break_min_pct': 0.01,
                'entry_zone_min_level': 0.618,
                'entry_zone_max_level': 0.786,
                'min_score': 0.50,
                'max_candidates': 1,
            },
        }

        swing_points = [
            SimpleNamespace(index=10, price=85.0, point_type='HIGH', confirmed_by_index=12),
            SimpleNamespace(index=14, price=60.0, point_type='LOW', confirmed_by_index=16),
            SimpleNamespace(index=18, price=88.0, point_type='HIGH', confirmed_by_index=20),
            SimpleNamespace(index=22, price=64.0, point_type='LOW', confirmed_by_index=24),
            SimpleNamespace(index=26, price=85.0, point_type='HIGH', confirmed_by_index=28),
            SimpleNamespace(index=32, price=52.0, point_type='LOW', confirmed_by_index=35),
        ]
        fake_structure = SimpleNamespace(swing_points=swing_points, mode='RDP')

        with mock.patch.object(hs_plugin, 'detect_swings_rdp', return_value=fake_structure):
            candidates = hs_plugin.run_head_shoulders_context_pattern_plugin(
                data=data,
                structure=None,
                spec=spec,
                symbol='TEST',
                timeframe='W',
            )

        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate['pattern_type'], 'head_shoulders_context_pattern')
        self.assertTrue(candidate['entry_ready'])
        self.assertEqual(candidate['candidate_role'], 'pattern_detector')
        self.assertEqual(candidate['candidate_actionability'], 'entry_ready')
        self.assertIn('head', candidate['anchors'])
        self.assertIn('left_shoulder', candidate['anchors'])
        self.assertIn('right_shoulder', candidate['anchors'])
        self.assertIn('structure_break_low', candidate['anchors'])
        self.assertTrue(candidate['output_ports']['signal']['passed'])
        self.assertTrue(candidate['node_result']['passed'])
        self.assertTrue(candidate['output_ports']['entry_zone']['passed'])
        self.assertTrue(all(rule['passed'] for rule in candidate['rule_checklist']))
        self.assertGreater(candidate['score'], 0.5)
        self.assertEqual(candidate['output_ports']['break_leg']['leg_direction'], 'bearish')
        self.assertGreater(candidate['node_result']['features']['current_retracement_pct'], 61.0)
        self.assertLess(candidate['node_result']['features']['current_retracement_pct'], 79.0)

    def test_head_shoulders_context_plugin_rejects_if_price_not_in_retrace_zone(self):
        closes = [
            40, 42, 45, 47, 50, 54, 58, 63, 70, 78,
            84, 79, 73, 66, 61, 67, 74, 81, 87, 82,
            75, 69, 64, 68, 73, 79, 84, 83, 77, 70,
            61, 55, 52, 54, 56, 57, 56, 55, 56, 57,
        ]
        data = [_bar(idx, close) for idx, close in enumerate(closes)]
        spec = {
            'strategy_id': 'head_shoulders_context_pattern',
            'version': '2.0.0',
            'strategy_version_id': 'head_shoulders_context_v2',
            'setup_config': {
                'lookback_bars': 120,
                'pivot_source': 'rdp',
                'swing_epsilon_pct': 0.08,
                'use_exact_epsilon': True,
                'shoulder_tolerance_pct': 0.05,
                'head_dominance_pct': 0.015,
                'neckline_tolerance_pct': 0.08,
                'break_min_pct': 0.01,
                'entry_zone_min_level': 0.618,
                'entry_zone_max_level': 0.786,
                'min_score': 0.50,
                'max_candidates': 1,
            },
        }
        swing_points = [
            SimpleNamespace(index=10, price=85.0, point_type='HIGH', confirmed_by_index=12),
            SimpleNamespace(index=14, price=60.0, point_type='LOW', confirmed_by_index=16),
            SimpleNamespace(index=18, price=88.0, point_type='HIGH', confirmed_by_index=20),
            SimpleNamespace(index=22, price=64.0, point_type='LOW', confirmed_by_index=24),
            SimpleNamespace(index=26, price=85.0, point_type='HIGH', confirmed_by_index=28),
            SimpleNamespace(index=32, price=52.0, point_type='LOW', confirmed_by_index=35),
        ]
        fake_structure = SimpleNamespace(swing_points=swing_points, mode='RDP')

        with mock.patch.object(hs_plugin, 'detect_swings_rdp', return_value=fake_structure):
            candidates = hs_plugin.run_head_shoulders_context_pattern_plugin(
                data=data,
                structure=None,
                spec=spec,
                symbol='TEST',
                timeframe='W',
            )

        self.assertEqual(candidates, [])

    def test_three_drives_pattern_plugin_emits_bearish_reversal_candidate(self):
        closes = [
            50, 52, 54, 57, 50, 58, 65, 72, 77, 80,
            76, 71, 66, 63, 62, 68, 75, 83, 92, 101,
            105, 99, 91, 84, 79, 78, 85, 93, 104, 116,
            128, 140, 138, 135, 132, 130, 128, 127, 128, 128,
            128, 127, 128, 129, 128, 128, 127, 128, 128, 128,
        ]
        data = [_bar(idx, close) for idx, close in enumerate(closes)]
        spec = {
            'strategy_id': 'three_drives_pattern',
            'version': '1.0.0',
            'strategy_version_id': 'three_drives_pattern_v1',
            'setup_config': {
                'lookback_bars': 160,
                'pivot_source': 'rdp',
                'swing_epsilon_pct': 0.08,
                'use_exact_epsilon': True,
                'correction_retrace_min_level': 0.50,
                'correction_retrace_max_level': 0.786,
                'extension_min_level': 1.13,
                'extension_max_level': 1.786,
                'drive_symmetry_pct': 0.45,
                'reaction_zone_max_level': 0.382,
                'min_score': 0.50,
                'max_candidates': 1,
            },
        }
        swing_points = [
            SimpleNamespace(index=4, price=50.0, point_type='LOW', confirmed_by_index=5),
            SimpleNamespace(index=9, price=80.0, point_type='HIGH', confirmed_by_index=10),
            SimpleNamespace(index=14, price=62.0, point_type='LOW', confirmed_by_index=15),
            SimpleNamespace(index=20, price=105.0, point_type='HIGH', confirmed_by_index=21),
            SimpleNamespace(index=25, price=78.0, point_type='LOW', confirmed_by_index=26),
            SimpleNamespace(index=31, price=140.0, point_type='HIGH', confirmed_by_index=32),
        ]
        fake_structure = SimpleNamespace(swing_points=swing_points, mode='RDP')

        with mock.patch.object(td_plugin, 'detect_swings_rdp', return_value=fake_structure):
            candidates = td_plugin.run_three_drives_pattern_plugin(
                data=data,
                structure=None,
                spec=spec,
                symbol='TEST',
                timeframe='W',
            )

        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate['pattern_type'], 'three_drives_pattern')
        self.assertTrue(candidate['entry_ready'])
        self.assertEqual(candidate['candidate_role'], 'pattern_detector')
        self.assertEqual(candidate['candidate_actionability'], 'entry_ready')
        self.assertEqual(candidate['output_ports']['pattern_geometry']['direction'], 'bearish')
        self.assertTrue(candidate['output_ports']['signal']['passed'])
        self.assertTrue(candidate['node_result']['passed'])
        self.assertTrue(candidate['output_ports']['reaction_zone']['passed'])
        self.assertIn('drive1', candidate['anchors'])
        self.assertIn('drive2', candidate['anchors'])
        self.assertIn('drive3', candidate['anchors'])
        self.assertGreater(candidate['score'], 0.5)
        self.assertGreater(candidate['node_result']['features']['drive2_extension'], 1.13)
        self.assertGreater(candidate['node_result']['features']['drive3_extension'], 1.13)
        self.assertLess(candidate['node_result']['features']['reaction_pct'], 0.3821)

    def test_three_drives_pattern_plugin_rejects_if_reaction_zone_is_lost(self):
        closes = [
            50, 52, 54, 57, 50, 58, 65, 72, 77, 80,
            76, 71, 66, 63, 62, 68, 75, 83, 92, 101,
            105, 99, 91, 84, 79, 78, 85, 93, 104, 116,
            128, 140, 135, 130, 122, 115, 108, 102, 99, 98,
            98, 99, 98, 98, 98, 98, 98, 99, 98, 98,
        ]
        data = [_bar(idx, close) for idx, close in enumerate(closes)]
        spec = {
            'strategy_id': 'three_drives_pattern',
            'version': '1.0.0',
            'strategy_version_id': 'three_drives_pattern_v1',
            'setup_config': {
                'lookback_bars': 160,
                'pivot_source': 'rdp',
                'swing_epsilon_pct': 0.08,
                'use_exact_epsilon': True,
                'correction_retrace_min_level': 0.50,
                'correction_retrace_max_level': 0.786,
                'extension_min_level': 1.13,
                'extension_max_level': 1.786,
                'drive_symmetry_pct': 0.45,
                'reaction_zone_max_level': 0.382,
                'min_score': 0.50,
                'max_candidates': 1,
            },
        }
        swing_points = [
            SimpleNamespace(index=4, price=50.0, point_type='LOW', confirmed_by_index=5),
            SimpleNamespace(index=9, price=80.0, point_type='HIGH', confirmed_by_index=10),
            SimpleNamespace(index=14, price=62.0, point_type='LOW', confirmed_by_index=15),
            SimpleNamespace(index=20, price=105.0, point_type='HIGH', confirmed_by_index=21),
            SimpleNamespace(index=25, price=78.0, point_type='LOW', confirmed_by_index=26),
            SimpleNamespace(index=31, price=140.0, point_type='HIGH', confirmed_by_index=32),
        ]
        fake_structure = SimpleNamespace(swing_points=swing_points, mode='RDP')

        with mock.patch.object(td_plugin, 'detect_swings_rdp', return_value=fake_structure):
            candidates = td_plugin.run_three_drives_pattern_plugin(
                data=data,
                structure=None,
                spec=spec,
                symbol='TEST',
                timeframe='W',
            )

        self.assertEqual(candidates, [])


if __name__ == '__main__':
    unittest.main()
