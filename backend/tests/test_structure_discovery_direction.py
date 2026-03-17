import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
sys.path.insert(0, str(SERVICES_DIR))

from research_v1 import classify_family_direction_v2  # noqa: E402


class StructureDiscoveryDirectionTests(unittest.TestCase):
    def test_continuation_and_reversal_classes_map_to_structural_direction(self):
        bullish = classify_family_direction_v2("HTL|CONTINUATION_UP|HH_ONLY|DEEP_DOM")
        bearish = classify_family_direction_v2("LTH|REVERSAL_DOWN|BOTH_BREAKS|DEEP_DOM")
        ambiguous = classify_family_direction_v2("HTL|MIXED_TRANSITION|HH_ONLY|DEEP_DOM")

        self.assertEqual(bullish["direction"], "BULLISH")
        self.assertEqual(bearish["direction"], "BEARISH")
        self.assertEqual(ambiguous["direction"], "AMBIGUOUS")
        self.assertIn("implies", bullish["reason"])
        self.assertIn("mixed structural class", ambiguous["reason"])

    def test_no_extreme_break_forces_ambiguity(self):
        result = classify_family_direction_v2("HTL|REVERSAL_UP|NO_EXTREME_BREAK|DEEP_DOM")
        self.assertEqual(result["direction"], "AMBIGUOUS")


if __name__ == "__main__":
    unittest.main()
