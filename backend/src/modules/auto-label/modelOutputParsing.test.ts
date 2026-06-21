import assert from 'assert';
import {
  clamp01,
  extractJsonObject,
  fallbackHeuristic,
  normalizeLabel,
  normalizePrediction,
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

function testFallbackHeuristic() {
  const prediction = fallbackHeuristic({
    id: 'c1',
    symbol: 'SPY',
    timeframe: 'D',
    patternType: 'base',
    score: 0.82,
    entryReady: true,
    base: { low: 100, high: 120 },
  });

  assert.strictEqual(prediction.label, 'yes');
  assert.strictEqual(prediction.labelConfidence, 0.82);
  assert.strictEqual(prediction.needsCorrection, true);
  assert.strictEqual(prediction.correctionConfidence, 0.55);
}

function testNormalizePrediction() {
  const snapshot = {
    id: 'c1',
    symbol: 'SPY',
    timeframe: 'D',
    patternType: 'base',
    score: 0.5,
    entryReady: false,
  };
  const prediction = normalizePrediction({
    label: 'skip',
    label_confidence: 1.5,
    needs_correction: true,
    base_top: 90,
    base_bottom: 100,
    correction_confidence: -1,
    reasoning: 'x'.repeat(300),
  }, 'model-v1', '{"raw":true}', snapshot);

  assert.strictEqual(prediction.label, 'close');
  assert.strictEqual(prediction.labelConfidence, 1);
  assert.strictEqual(prediction.baseTop, 100);
  assert.strictEqual(prediction.baseBottom, 90);
  assert.strictEqual(prediction.correctionConfidence, 0);
  assert.strictEqual(prediction.reasoning.length, 220);
  assert.strictEqual(prediction.modelVersion, 'model-v1');
  assert.strictEqual(normalizePrediction(null, 'model-v2', '', snapshot).modelVersion, 'heuristic-fallback-v1');
}

function main() {
  testClamp01();
  testToFinite();
  testExtractJsonObject();
  testNormalizeLabel();
  testFallbackHeuristic();
  testNormalizePrediction();
  console.log('modelOutputParsing tests passed');
}

main();
