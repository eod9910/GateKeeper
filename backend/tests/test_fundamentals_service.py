import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

import fundamentalsService as fs  # noqa: E402


class FundamentalsServiceRegressionTests(unittest.TestCase):
    def test_survivability_score_rewards_runway_and_cash_generation(self):
        strong = fs._score_survivability(12, 50_000_000, 10_000_000, 2.5, 35, 0.2)
        weak = fs._score_survivability(1.5, -80_000_000, -20_000_000, 0.8, 5, 3.5)
        self.assertGreater(strong, weak)
        self.assertGreaterEqual(strong, 90)
        self.assertLessEqual(weak, 20)

    def test_trend_score_rewards_acceleration_and_surprises(self):
        improving = fs._score_trend(30, 12, 'accelerating', 25, 18, 14)
        fading = fs._score_trend(-12, -5, 'decelerating', -20, -10, -6)
        self.assertGreater(improving, fading)
        self.assertGreaterEqual(improving, 90)
        self.assertLessEqual(fading, 20)

    def test_squeeze_and_dilution_scores_capture_opposite_risks(self):
        squeeze = fs._score_squeeze(28, 7.5, 18_000_000, 2.8)
        no_squeeze = fs._score_squeeze(3, 0.8, 300_000_000, 0.9)
        heavy_dilution = fs._score_dilution(18, True)
        low_dilution = fs._score_dilution(-3, False)
        self.assertGreater(squeeze, no_squeeze)
        self.assertEqual(fs._squeeze_label(squeeze), 'High')
        self.assertGreater(heavy_dilution, low_dilution)

    def test_new_factor_scores_reward_execution_forward_and_insider_alignment(self):
        strong_execution = fs._score_reported_execution(3, 0, 12, 4, 9)
        weak_execution = fs._score_reported_execution(0, 2, -8, -3, -5)
        strong_forward = fs._score_forward_expectations(18, 20, 22, 28)
        weak_forward = fs._score_forward_expectations(-12, -6, -8, -3)
        insider_buying = fs._score_positioning(3, 0, 250_000, 0)
        insider_selling = fs._score_positioning(0, 4, 0, 900_000)
        strong_market = fs._score_market_context(True, True, 82)
        weak_market = fs._score_market_context(False, False, 18)

        self.assertGreater(strong_execution, weak_execution)
        self.assertGreater(strong_forward, weak_forward)
        self.assertGreater(insider_buying, insider_selling)
        self.assertGreater(strong_market, weak_market)

    def test_interpretation_adds_expected_tactical_tags(self):
        snapshot = {
            'cashRunwayQuarters': 10,
            'freeCashFlowTTM': -40_000_000,
            'revenueTrendFlag': 'accelerating',
            'sharesOutstandingYoYChangePct': 8.5,
            'squeezePressureScore': 78,
            'catalystFlag': 'earnings_soon',
            'survivabilityScore': 72,
            'trendScore': 74,
            'reportedExecutionScore': 75,
            'forwardExpectationsScore': 69,
            'positioningScore': 62,
            'marketContextScore': 58,
            'dilutionRiskScore': 30,
            'catalystScore': 82,
            'netCash': 300_000_000,
            'marketCap': 800_000_000,
            'profitMarginPct': -12,
            'positioning': {'signal': 'buying'},
            'marketContext': {'above200Day': True},
        }

        interpretation = fs._build_interpretation(snapshot)
        labels = {tag['label'] for tag in interpretation['tags']}

        self.assertEqual(interpretation['quality'], 'Improving')
        self.assertEqual(interpretation['holdContext'], 'Can hold pullbacks')
        self.assertEqual(interpretation['tacticalGrade'], 'Tactical Pop')
        self.assertIn('Strong runway', labels)
        self.assertIn('Revenue accelerating', labels)
        self.assertIn('Dilution risk', labels)
        self.assertIn('Squeeze candidate', labels)
        self.assertIn('Earnings soon', labels)
        self.assertIn('Cash-rich story stock', labels)
        self.assertIn('Beating estimates', labels)
        self.assertIn('Forward growth supportive', labels)
        self.assertIn('Insider buying', labels)
        self.assertIn('Above 200D', labels)
        self.assertIn('Low-quality / high survivability', labels)
        self.assertIn('Improving setup', labels)
        self.assertIn('Tactical pop candidate', labels)

    def test_interpretation_marks_deteriorating_setups(self):
        snapshot = {
            'cashRunwayQuarters': 1.5,
            'freeCashFlowTTM': -100_000_000,
            'revenueTrendFlag': 'decelerating',
            'sharesOutstandingYoYChangePct': 16,
            'squeezePressureScore': 12,
            'catalystFlag': 'no_near_catalyst',
            'survivabilityScore': 20,
            'trendScore': 18,
            'reportedExecutionScore': 22,
            'forwardExpectationsScore': 28,
            'positioningScore': 34,
            'marketContextScore': 20,
            'dilutionRiskScore': 90,
            'catalystScore': 24,
            'netCash': -10_000_000,
            'marketCap': 250_000_000,
            'profitMarginPct': -55,
            'positioning': {'signal': 'selling'},
            'marketContext': {'above200Day': False},
        }

        interpretation = fs._build_interpretation(snapshot)
        labels = {tag['label'] for tag in interpretation['tags']}

        self.assertEqual(interpretation['quality'], 'Deteriorating')
        self.assertEqual(interpretation['holdContext'], 'Take strength fast')
        self.assertEqual(interpretation['tacticalGrade'], 'Fragile')
        self.assertIn('Heavy burn', labels)
        self.assertIn('Revenue decelerating', labels)
        self.assertIn('Dilution risk', labels)
        self.assertIn('Execution weak', labels)
        self.assertIn('Forward estimates weak', labels)
        self.assertIn('Insider selling', labels)
        self.assertIn('Below 200D', labels)
        self.assertIn('No catalyst', labels)
        self.assertIn('Deteriorating setup', labels)


if __name__ == '__main__':
    unittest.main()
