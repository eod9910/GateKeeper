import assert from 'assert';
import {
  parseOptionableRebuildRequestParams,
  parseRegimeClassificationRequestParams,
  parseUniverseBuildRequestParams,
  parseUniverseForceRefreshQuery,
  parseUniverseUpdateRequestParams,
} from './universeRequestParams';

function testBuildDefaults() {
  assert.deepStrictEqual(parseUniverseBuildRequestParams(undefined), {
    source: 'nasdaq-trader-us',
    lookback: '5y',
    interval: '1d',
    minVolume: 0,
    minVolumeArg: '0',
    workers: 10,
    workersArg: '10',
  });
}

function testBuildValues() {
  assert.deepStrictEqual(
    parseUniverseBuildRequestParams({
      source: 'custom',
      lookback: '1y',
      interval: '1h',
      min_volume: '250000',
      workers: '3',
    }),
    {
      source: 'custom',
      lookback: '1y',
      interval: '1h',
      minVolume: 250000,
      minVolumeArg: '250000',
      workers: 3,
      workersArg: '3',
    },
  );
}

function testOptionableDefaults() {
  assert.deepStrictEqual(parseOptionableRebuildRequestParams({}), {
    source: 'nasdaq-trader-us',
    workers: 5,
    workersArg: '5',
  });
}

function testIntervalDefaults() {
  assert.deepStrictEqual(parseUniverseUpdateRequestParams(undefined), { interval: '1d' });
  assert.deepStrictEqual(parseRegimeClassificationRequestParams({ interval: '1h' }), { interval: '1h' });
}

function testForceRefreshQuery() {
  assert.strictEqual(parseUniverseForceRefreshQuery({ force_refresh: ' TRUE ' }), true);
  assert.strictEqual(parseUniverseForceRefreshQuery({ force_refresh: 'false' }), false);
  assert.strictEqual(parseUniverseForceRefreshQuery({}), false);
}

function main() {
  testBuildDefaults();
  testBuildValues();
  testOptionableDefaults();
  testIntervalDefaults();
  testForceRefreshQuery();
  console.log('universeRequestParams tests passed');
}

main();
