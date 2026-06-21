import assert from 'assert';
import path from 'path';
import {
  getDefaultPatternDataDir,
  loadPatternDefinition,
  loadPrimitiveDefaultParams,
} from './compositePatternStore';

const PATTERN_DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'patterns');

function testLoadsPatternDefinition() {
  const definition = loadPatternDefinition('atr_primitive', PATTERN_DATA_DIR);

  assert.strictEqual(definition?.pattern_id, 'atr_primitive');
  assert.strictEqual(definition?.indicator_role, 'context');
  assert.deepStrictEqual(definition?.suggested_timeframes, ['D', 'W', '4H', '1H']);
}

function testReturnsNullForMissingDefinition() {
  assert.strictEqual(loadPatternDefinition(''), null);
  assert.strictEqual(loadPatternDefinition('does_not_exist', PATTERN_DATA_DIR), null);
}

function testLoadsDefaultParamsWithoutPatternType() {
  const params = loadPrimitiveDefaultParams('atr_primitive', PATTERN_DATA_DIR);

  assert.deepStrictEqual(params, {
    atr_period: 14,
    normalize_by_price: true,
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(params, 'pattern_type'), false);
}

function testDefaultPatternDirShape() {
  assert.ok(getDefaultPatternDataDir().endsWith('backend\\data\\patterns') || getDefaultPatternDataDir().endsWith('backend/data/patterns'));
}

function main() {
  testLoadsPatternDefinition();
  testReturnsNullForMissingDefinition();
  testLoadsDefaultParamsWithoutPatternType();
  testDefaultPatternDirShape();
  console.log('compositePatternStore tests passed');
}

main();
