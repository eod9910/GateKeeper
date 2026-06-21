import assert from 'assert';
import {
  clamp01,
  extractJsonObject,
  normalizeLabel,
  toFinite,
} from './modelOutputParsing';

function testClamp01() {
  assert.strictEqual(clamp01(-0.5), 0);
  assert.strictEqual(clamp01(0.4), 0.4);
  assert.strictEqual(clamp01(2), 1);
  assert.strictEqual(clamp01(Number.NaN), 0);
}

function testToFinite() {
  assert.strictEqual(toFinite('12.5'), 12.5);
  assert.strictEqual(toFinite('bad'), undefined);
  assert.strictEqual(toFinite(undefined), undefined);
}

function testExtractJsonObject() {
  assert.deepStrictEqual(extractJsonObject('{"label":"yes"}'), { label: 'yes' });
  assert.deepStrictEqual(extractJsonObject('prefix {"label":"no"} suffix'), { label: 'no' });
  assert.strictEqual(extractJsonObject('prefix {bad json} suffix'), null);
  assert.strictEqual(extractJsonObject(''), null);
}

function testNormalizeLabel() {
  assert.strictEqual(normalizeLabel(' YES '), 'yes');
  assert.strictEqual(normalizeLabel('no'), 'no');
  assert.strictEqual(normalizeLabel('close'), 'close');
  assert.strictEqual(normalizeLabel('skip'), 'close');
  assert.strictEqual(normalizeLabel('unknown'), 'close');
}

function main() {
  testClamp01();
  testToFinite();
  testExtractJsonObject();
  testNormalizeLabel();
  console.log('modelOutputParsing tests passed');
}

main();
