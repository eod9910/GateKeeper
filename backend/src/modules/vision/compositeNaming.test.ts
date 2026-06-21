import assert from 'assert';
import {
  buildCompositeStageId,
  capitalizeIntent,
  normalizeCompositeId,
  suggestCompositeName,
} from './compositeNaming';

function testSuggestCompositeName() {
  assert.strictEqual(suggestCompositeName([
    { pattern_id: 'rdp_swing_structure' },
    { pattern_id: 'fib_location_primitive' },
  ], 'entry'), 'RDP Fib Pullback Entry Composite');

  assert.strictEqual(suggestCompositeName([
    { pattern_id: 'regime_filter' },
  ], 'exit'), 'Regime Filtered Exit Composite');

  assert.strictEqual(suggestCompositeName([], 'timing'), 'Timing Composite');
}

function testCapitalizeIntent() {
  assert.strictEqual(capitalizeIntent(' ENTRY '), 'Entry');
  assert.strictEqual(capitalizeIntent(''), 'Entry');
}

function testNormalizeCompositeId() {
  assert.strictEqual(normalizeCompositeId('RDP Fib Pullback'), 'rdp_fib_pullback_composite');
  assert.strictEqual(normalizeCompositeId('already_composite'), 'already_composite');
  assert.strictEqual(normalizeCompositeId('!!!'), 'new_composite');
}

function testBuildCompositeStageId() {
  assert.strictEqual(buildCompositeStageId('anchor_structure', []), 'structure');
  assert.strictEqual(buildCompositeStageId('timing_trigger', ['timing']), 'timing_2');
  assert.strictEqual(buildCompositeStageId('timing_trigger', ['timing', 'timing_2']), 'timing_3');
  assert.strictEqual(buildCompositeStageId('', []), 'stage');
}

function main() {
  testSuggestCompositeName();
  testCapitalizeIntent();
  testNormalizeCompositeId();
  testBuildCompositeStageId();
  console.log('compositeNaming tests passed');
}

main();
