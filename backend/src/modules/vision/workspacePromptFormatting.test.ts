import assert from 'assert';
import { summarizePrimitiveInventory } from './workspacePromptFormatting';

function testSummarizesPrimitiveInventory() {
  const summary = summarizePrimitiveInventory([
    {
      pattern_id: 'fib_location_primitive',
      name: 'Fib Location',
      indicator_role: 'location',
      description: 'Locates retracements.',
      tunable_params: [
        { key: 'min_ratio', type: 'number', default: 0.382, extra: 'ignored' },
        { key: 'max_ratio', type: 'number', default: 0.786 },
      ],
      implementation_detail: 'ignored',
    },
    {
      pattern_id: 'atr_primitive',
      name: 'ATR',
      indicator_role: 'context',
    },
  ]);

  assert.deepStrictEqual(summary, [
    {
      pattern_id: 'fib_location_primitive',
      name: 'Fib Location',
      indicator_role: 'location',
      description: 'Locates retracements.',
      tunable_params: [
        { key: 'min_ratio', type: 'number', default: 0.382 },
        { key: 'max_ratio', type: 'number', default: 0.786 },
      ],
    },
    {
      pattern_id: 'atr_primitive',
      name: 'ATR',
      indicator_role: 'context',
      description: null,
      tunable_params: [],
    },
  ]);
}

function testAppliesLimits() {
  const primitives = Array.from({ length: 12 }, (_, index) => ({
    pattern_id: `primitive_${index}`,
    tunable_params: Array.from({ length: 10 }, (__, paramIndex) => ({
      key: `p${paramIndex}`,
      type: 'number',
      default: paramIndex,
    })),
  }));

  const summary = summarizePrimitiveInventory(primitives, 3);

  assert.strictEqual(summary.length, 3);
  assert.strictEqual(summary[0].tunable_params.length, 8);
}

function main() {
  testSummarizesPrimitiveInventory();
  testAppliesLimits();
  console.log('workspacePromptFormatting tests passed');
}

main();
