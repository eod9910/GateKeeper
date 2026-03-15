import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / 'services'
sys.path.insert(0, str(SERVICES_DIR))

from backtestEngine import run_backtest_on_bars, trades_to_dicts  # noqa: E402
from robustnessTests import expectancy, monte_carlo, out_of_sample, walk_forward, parameter_sensitivity  # noqa: E402
from strategyRunner import compute_spec_hash  # noqa: E402


FIXTURES = ROOT / 'tests' / 'fixtures'
OHLCV = FIXTURES / 'ohlcv'


class ValidatorFixtureRegressionTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((FIXTURES / 'strategy_spec_hash_fixture.json').read_text(encoding='utf-8'))

    def _bars(self, name: str):
        return json.loads((OHLCV / f'{name}.json').read_text(encoding='utf-8'))

    def _run(self, fixture_name: str, with_rules: bool = True):
        bars = self._bars(fixture_name)
        trades, stats = run_backtest_on_bars('SPY', '1d', bars, self.spec, apply_execution_rules=with_rules)
        trade_dicts = trades_to_dicts(trades, 'rpt_fixture', self.spec['strategy_version_id'])
        return trade_dicts, stats

    def test_deterministic_fixture_run_matches_snapshot(self):
        trades_a, stats_a = self._run('canonical_trend', with_rules=True)
        trades_b, stats_b = self._run('canonical_trend', with_rules=True)
        self.assertEqual(trades_a, trades_b)
        self.assertEqual(stats_a, stats_b)

        snapshot = json.loads((FIXTURES / 'golden_metrics_snapshot.json').read_text(encoding='utf-8'))
        self.assertEqual(len(trades_a), snapshot['total_trades'])
        self.assertAlmostEqual(expectancy(trades_a), snapshot['expectancy_R'], places=6)
        self.assertEqual(trades_a[0]['exit_reason'] if trades_a else None, snapshot['first_exit_reason'])
        self.assertEqual(stats_a['breakeven_triggers'], snapshot['execution_stats']['breakeven_triggers'])
        self.assertEqual(stats_a['ladder_lock_triggers'], snapshot['execution_stats']['ladder_lock_triggers'])
        self.assertEqual(stats_a['profit_retrace_exits'], snapshot['execution_stats']['profit_retrace_exits'])

    def test_stop_first_then_target_conflict_exits_stop(self):
        trades, _ = self._run('stop_first_conflict', with_rules=False)
        self.assertGreaterEqual(len(trades), 1)
        self.assertEqual(trades[0]['exit_reason'], 'stop')

    def test_target_hit_fixture_has_target_exit(self):
        trades, _ = self._run('target_hit', with_rules=False)
        self.assertTrue(any(t['exit_reason'] == 'target' for t in trades))

    def test_no_trade_period_fixture(self):
        trades, _ = self._run('no_trade_flat', with_rules=True)
        self.assertEqual(len(trades), 0)

    def test_execution_rule_retrace_exit_occurs(self):
        trades, stats = self._run('execution_retrace', with_rules=True)
        self.assertGreaterEqual(len(trades), 1)
        self.assertTrue(any(t['exit_reason'] == 'trailing' for t in trades))
        self.assertGreaterEqual(stats['profit_retrace_exits'], 1)

    def test_monte_carlo_is_seed_deterministic(self):
        trades, _ = self._run('canonical_trend', with_rules=True)
        mc_a = monte_carlo(trades, simulations=250, seed=77)
        mc_b = monte_carlo(trades, simulations=250, seed=77)
        self.assertEqual(mc_a, mc_b)

    def test_out_of_sample_returns_real_split_metrics(self):
        trades, _ = self._run('canonical_trend', with_rules=True)
        oos = out_of_sample(trades)
        self.assertIn('is_expectancy', oos)
        self.assertIn('oos_expectancy', oos)
        self.assertGreaterEqual(oos['is_n'], 1)
        self.assertGreaterEqual(oos['oos_n'], 1)
        self.assertRegex(oos['split_date'], r'^\d{4}-\d{2}-\d{2}$')

    def test_walk_forward_produces_windows(self):
        synthetic = []
        for i in range(25):
            synthetic.append({
                'entry_time': f'2024-01-{(i % 28) + 1:02d}',
                'R_multiple': 0.6 if (i % 4) != 0 else -0.3,
            })
        wf = walk_forward(synthetic)
        self.assertIn('windows', wf)
        self.assertGreaterEqual(len(wf['windows']), 1)
        first = wf['windows'][0]
        self.assertIn('train_start', first)
        self.assertIn('test_start', first)
        self.assertIn('test_expectancy', first)

    def test_parameter_sensitivity_is_deterministic_with_fixed_rerun(self):
        base = 0.75

        def rerun(param, factor):
            lookup = {
                ('swing_epsilon', 1.1): 0.70,
                ('swing_epsilon', 0.9): 0.78,
                ('stop_value', 1.1): 0.60,
                ('stop_value', 0.9): 0.82,
                ('take_profit_R', 1.1): 0.73,
                ('take_profit_R', 0.9): 0.76,
            }
            key = (param, round(float(factor), 1))
            return lookup[key]

        s1 = parameter_sensitivity(base, rerun, params=['swing_epsilon', 'stop_value', 'take_profit_R'])
        s2 = parameter_sensitivity(base, rerun, params=['swing_epsilon', 'stop_value', 'take_profit_R'])
        self.assertEqual(s1, s2)


class SpecHashParityTests(unittest.TestCase):
    def test_python_hash_matches_typescript_hash(self):
        fixture_path = FIXTURES / 'strategy_spec_hash_fixture.json'
        spec = json.loads(fixture_path.read_text(encoding='utf-8'))
        py_hash = compute_spec_hash(spec)

        cmd = [
            'node',
            '-e',
            (
                "const fs=require('fs');"
                "const { computeSpecHash } = require('./dist/services/storageService');"
                "const spec=JSON.parse(fs.readFileSync('./tests/fixtures/strategy_spec_hash_fixture.json','utf-8'));"
                "process.stdout.write(computeSpecHash(spec));"
            ),
        ]
        proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, check=True)
        ts_hash = proc.stdout.strip()

        self.assertEqual(py_hash, ts_hash)


if __name__ == '__main__':
    unittest.main()
