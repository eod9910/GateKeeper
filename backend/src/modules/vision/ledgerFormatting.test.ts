import assert from 'assert';
import {
  ledgerDisplayMoney,
  ledgerDisplayNumber,
  ledgerDisplayPct,
  ledgerFirstFiniteNumber,
  ledgerMetricValue,
  ledgerScaleNumber,
} from './ledgerFormatting';

function testDisplayNumber() {
  assert.strictEqual(ledgerDisplayNumber(12.345), '12.3');
  assert.strictEqual(ledgerDisplayNumber(12.345, 2), '12.35');
  assert.strictEqual(ledgerDisplayNumber('not-a-number'), 'N/A');
}

function testDisplayMoney() {
  assert.strictEqual(ledgerDisplayMoney(12.3), '$12.30');
  assert.strictEqual(ledgerDisplayMoney(1234), '$1.2K');
  assert.strictEqual(ledgerDisplayMoney(1234567), '$1.2M');
  assert.strictEqual(ledgerDisplayMoney(1234567890), '$1.23B');
  assert.strictEqual(ledgerDisplayMoney(-1234567), '$-1.2M');
  assert.strictEqual(ledgerDisplayMoney(undefined), 'N/A');
}

function testDisplayPct() {
  assert.strictEqual(ledgerDisplayPct(12.34), '12.3%');
  assert.strictEqual(ledgerDisplayPct('bad'), 'N/A');
}

function testScaleNumber() {
  assert.strictEqual(ledgerScaleNumber(3, 'thousands'), 3000);
  assert.strictEqual(ledgerScaleNumber(3, 'millions'), 3000000);
  assert.strictEqual(ledgerScaleNumber(3, 'billions'), 3000000000);
  assert.strictEqual(ledgerScaleNumber(3, 'raw'), 3);
  assert.strictEqual(ledgerScaleNumber('bad', 'millions'), null);
}

function testMetricValue() {
  assert.strictEqual(ledgerMetricValue({ value: 2, scale: 'millions' }), 2000000);
  assert.strictEqual(ledgerMetricValue(5), 5);
  assert.strictEqual(ledgerMetricValue({ nope: 1 }), null);
}

function testFirstFiniteNumber() {
  assert.strictEqual(ledgerFirstFiniteNumber(undefined, 'bad', 0, 5), 0);
  assert.strictEqual(ledgerFirstFiniteNumber(undefined, 'bad', 5), 5);
  assert.strictEqual(ledgerFirstFiniteNumber(undefined, 'bad'), null);
}

function main() {
  testDisplayNumber();
  testDisplayMoney();
  testDisplayPct();
  testScaleNumber();
  testMetricValue();
  testFirstFiniteNumber();
  console.log('ledgerFormatting tests passed');
}

main();
