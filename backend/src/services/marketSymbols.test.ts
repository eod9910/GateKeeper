import assert from 'assert';
import { normalizeMarketDataSymbol } from './marketSymbols';

function testFuturesContractMonthSymbols(): void {
  assert.equal(normalizeMarketDataSymbol('M2KM2026'), 'M2K=F');
  assert.equal(normalizeMarketDataSymbol('M2KM26'), 'M2K=F');
  assert.equal(normalizeMarketDataSymbol('/M2KM2026'), 'M2K=F');
  assert.equal(normalizeMarketDataSymbol('ESZ2026'), 'ES=F');
  assert.equal(normalizeMarketDataSymbol('6EU26'), '6E=F');
}

function testExistingAliasesStillWork(): void {
  assert.equal(normalizeMarketDataSymbol('M2K'), 'M2K=F');
  assert.equal(normalizeMarketDataSymbol('MES'), 'MES=F');
  assert.equal(normalizeMarketDataSymbol('AAPL'), 'AAPL');
}

testFuturesContractMonthSymbols();
testExistingAliasesStillWork();
console.log('marketSymbols tests passed');
