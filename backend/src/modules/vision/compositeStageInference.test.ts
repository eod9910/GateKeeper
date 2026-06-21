import assert from 'assert';
import path from 'path';
import { inferCompositeStagesFromContext } from './compositeStageInference';

const PATTERN_DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'patterns');

function testInfersStagesFromMessageAndHistory() {
  const stages = inferCompositeStagesFromContext('Use RDP and fib location', {
    availablePrimitives: [
      { pattern_id: 'fib_location_primitive', name: 'Fib Location', indicator_role: 'location' },
      { pattern_id: 'atr_primitive', name: 'ATR', indicator_role: 'context' },
      { pattern_id: 'rdp_swing_structure', name: 'RDP Swing Structure', indicator_role: 'anchor_structure' },
    ],
    chatHistory: [{ text: 'Add ATR context too.' }],
  }, PATTERN_DATA_DIR);

  assert.deepStrictEqual(stages.map((stage) => stage.pattern_id), [
    'rdp_swing_structure',
    'fib_location_primitive',
    'atr_primitive',
  ]);
  assert.deepStrictEqual(stages.map((stage) => stage.id), ['structure', 'location', 'context']);
  assert.strictEqual(stages[2].params.atr_period, 14);
}

function testDeduplicatesAndLimitsStages() {
  const stages = inferCompositeStagesFromContext('primitive', {
    availablePrimitives: [
      { pattern_id: 'one_primitive', name: 'Primitive', indicator_role: 'context' },
      { pattern_id: 'one_primitive', name: 'Primitive duplicate', indicator_role: 'context' },
      { pattern_id: 'two_primitive', name: 'Primitive two', indicator_role: 'context' },
      { pattern_id: 'three_primitive', name: 'Primitive three', indicator_role: 'context' },
      { pattern_id: 'four_primitive', name: 'Primitive four', indicator_role: 'context' },
      { pattern_id: 'five_primitive', name: 'Primitive five', indicator_role: 'context' },
      { pattern_id: 'six_primitive', name: 'Primitive six', indicator_role: 'context' },
      { pattern_id: 'seven_primitive', name: 'Primitive seven', indicator_role: 'context' },
    ],
  }, PATTERN_DATA_DIR);

  assert.strictEqual(stages.length, 6);
  assert.strictEqual(new Set(stages.map((stage) => stage.pattern_id)).size, 6);
}

function main() {
  testInfersStagesFromMessageAndHistory();
  testDeduplicatesAndLimitsStages();
  console.log('compositeStageInference tests passed');
}

main();
