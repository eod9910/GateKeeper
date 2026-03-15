import assert from 'assert';
import { inferAtr, loadDefaultUniverseForAssetClass, resolveTakeProfitR } from './signalScanner';

async function testCryptoUniverseFallback(): Promise<void> {
  const symbols = await loadDefaultUniverseForAssetClass('crypto');
  assert.ok(symbols.length > 0);
  assert.ok(symbols.includes('BTC-USD'));
  assert.ok(symbols.includes('ETH-USD'));
}

async function testStocksUniverseFallback(): Promise<void> {
  const symbols = await loadDefaultUniverseForAssetClass('stocks');
  assert.ok(symbols.length > 0);
  assert.ok(symbols.includes('SPY'));
  assert.ok(symbols.includes('BTC-USD'));
}

async function testFuturesUniverseFallback(): Promise<void> {
  const symbols = await loadDefaultUniverseForAssetClass('futures');
  assert.ok(symbols.length > 0);
  assert.ok(symbols.includes('ES=F'));
  assert.ok(symbols.includes('NQ=F'));
}

function testInferAtrFromChartDataFallback(): void {
  const atr = inferAtr({
    chart_data: [
      { high: 10, low: 9, close: 9.5 },
      { high: 11, low: 9.5, close: 10.5 },
      { high: 12, low: 10, close: 11 },
      { high: 12.5, low: 10.5, close: 12 },
    ],
  }, 3);

  assert.ok(atr > 0);
  assert.equal(Number(atr.toFixed(4)), 1.8333);
}

function testResolveTakeProfitRPrefersExitConfigForRMultiple(): void {
  const takeProfitR = resolveTakeProfitR({
    strategy_version_id: 'test_strategy',
    strategy_id: 'test_strategy',
    name: 'Test Strategy',
    status: 'testing',
    risk_config: { take_profit_R: 14 },
    exit_config: { target_type: 'R_multiple', target_level: 4 },
  } as any);

  assert.equal(takeProfitR, 4);
}

async function runTests(): Promise<void> {
  await testCryptoUniverseFallback();
  await testStocksUniverseFallback();
  await testFuturesUniverseFallback();
  testInferAtrFromChartDataFallback();
  testResolveTakeProfitRPrefersExitConfigForRMultiple();
}

runTests()
  .then(() => {
    console.log('signalScanner tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
