import assert from 'assert';
import path from 'path';
import { buildLocalCompositeDefinition } from './compositeDefinition';

const PATTERN_DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'patterns');

function testBuildsCompositeDefinitionFromStages() {
  const definition = buildLocalCompositeDefinition([
    { id: '', pattern_id: 'atr_primitive', params: {} },
  ], 'entry', {}, PATTERN_DATA_DIR);

  assert.strictEqual(definition.pattern_id, 'entry_composite');
  assert.strictEqual(definition.name, 'Entry Composite');
  assert.strictEqual(definition.default_entry.entry_type, 'market_on_close');
  assert.deepStrictEqual(definition.suggested_timeframes, ['D', 'W', '4H', '1H']);
  assert.strictEqual(definition.min_data_bars, 60);
  assert.deepStrictEqual(definition.default_setup_params.composite_spec.reducer, {
    op: 'AND',
    inputs: ['stage'],
  });
}

function testHonorsMetadataAndExitIntent() {
  const definition = buildLocalCompositeDefinition([
    { id: 'custom', pattern_id: 'missing', params: { threshold: 1 } },
  ], 'exit', {
    patternName: 'My Exit',
    patternId: 'my_exit',
  }, PATTERN_DATA_DIR);

  assert.strictEqual(definition.pattern_id, 'my_exit_composite');
  assert.strictEqual(definition.name, 'My Exit');
  assert.strictEqual(definition.default_entry.entry_type, 'exit_signal');
  assert.deepStrictEqual(definition.suggested_timeframes, ['D', 'W']);
  assert.deepStrictEqual(definition.default_setup_params.composite_spec.stages, [
    { id: 'custom', pattern_id: 'missing', params: { threshold: 1 } },
  ]);
}

function main() {
  testBuildsCompositeDefinitionFromStages();
  testHonorsMetadataAndExitIntent();
  console.log('compositeDefinition tests passed');
}

main();
