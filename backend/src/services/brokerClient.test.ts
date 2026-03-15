import assert from 'assert';
import { fromBrokerSymbol, fromOandaInstrument, toBrokerSymbol, toOandaInstrument } from './brokerClient';

function testCryptoSymbolMapping(): void {
  assert.equal(toBrokerSymbol('BTC-USD'), 'BTCUSD');
  assert.equal(toBrokerSymbol('NEAR-USD'), 'NEARUSD');
  assert.equal(fromBrokerSymbol('BTCUSD'), 'BTC-USD');
  assert.equal(fromBrokerSymbol('NEARUSD'), 'NEAR-USD');
}

function testStockSymbolMappingPassThrough(): void {
  assert.equal(toBrokerSymbol('AAPL'), 'AAPL');
  assert.equal(fromBrokerSymbol('AAPL'), 'AAPL');
}

function testOandaSymbolMapping(): void {
  assert.equal(toOandaInstrument('EURUSD=X'), 'EUR_USD');
  assert.equal(toOandaInstrument('EUR/USD'), 'EUR_USD');
  assert.equal(fromOandaInstrument('EUR_USD'), 'EURUSD=X');
}

function runTests(): void {
  testCryptoSymbolMapping();
  testStockSymbolMappingPassThrough();
  testOandaSymbolMapping();
}

runTests();
console.log('brokerClient tests passed');
