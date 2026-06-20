import assert from 'assert';
import {
  getOptionableCatalogMeta,
  normalizeUniverseSymbols,
} from './universeCatalogMeta';

function testNormalizeUniverseSymbols(): void {
  assert.deepEqual(normalizeUniverseSymbols([' msft ', 'AAPL', 'aapl', '', null, 'brk.b']), [
    'AAPL',
    'BRK.B',
    'MSFT',
  ]);
  assert.deepEqual(normalizeUniverseSymbols('AAPL'), []);
  assert.deepEqual(normalizeUniverseSymbols(undefined), []);
}

function testCompleteCatalogMetaFromSourceSymbols(): void {
  const meta = getOptionableCatalogMeta({
    source_symbols: ['AAA', 'BBB', 'CCC'],
    optionable: ['AAA', 'ccc'],
    not_optionable: ['BBB'],
  });

  assert.equal(meta.optionableCount, 2);
  assert.equal(meta.sourceSymbolCount, 3);
  assert.equal(meta.classifiedCount, 3);
  assert.equal(meta.unclassifiedCount, 0);
  assert.equal(meta.complete, true);
}

function testIncompleteCatalogMetaWithUnknownSymbols(): void {
  const meta = getOptionableCatalogMeta({
    source_symbol_count: 5,
    optionable: ['AAA'],
    not_optionable: ['BBB'],
    unknown_optionability: [{ symbol: 'CCC' }],
  });

  assert.equal(meta.optionableCount, 1);
  assert.equal(meta.sourceSymbolCount, 5);
  assert.equal(meta.classifiedCount, 3);
  assert.equal(meta.unclassifiedCount, 2);
  assert.equal(meta.complete, false);
}

function testExplicitCountsWin(): void {
  const meta = getOptionableCatalogMeta({
    optionable_count: 10,
    source_symbol_count: 100,
    classified_count: 80,
    unclassified_count: 20,
    complete_optionability: true,
    optionable: ['AAA'],
  });

  assert.equal(meta.optionableCount, 10);
  assert.equal(meta.sourceSymbolCount, 100);
  assert.equal(meta.classifiedCount, 80);
  assert.equal(meta.unclassifiedCount, 20);
  assert.equal(meta.complete, true);
}

function runTests(): void {
  testNormalizeUniverseSymbols();
  testCompleteCatalogMetaFromSourceSymbols();
  testIncompleteCatalogMetaWithUnknownSymbols();
  testExplicitCountsWin();
}

runTests();
console.log('universeCatalogMeta tests passed');
