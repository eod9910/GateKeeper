import assert from 'assert';
import * as path from 'path';
import {
  createOptionableRebuildPlan,
  createRegimeClassificationPlan,
  createUniverseBuildPlan,
  createUniverseUpdatePlan,
} from './universeJobPlans';
import { createUniverseRouteConfig } from './universeRouteConfig';

const routeConfig = createUniverseRouteConfig(path.join('repo', 'backend'));

function testBuildPlan() {
  const plan = createUniverseBuildPlan(
    {
      source: 'custom',
      lookback: '1y',
      interval: '1h',
      minVolume: 250000,
      minVolumeArg: '250000',
      workers: 3,
      workersArg: '3',
    },
    routeConfig,
    true,
  );

  assert.strictEqual(plan.job.type, 'build');
  assert.strictEqual(plan.job.source, 'custom');
  assert.strictEqual(plan.job.min_volume, 250000);
  assert.ok(plan.command.args.includes('--skip-options-check'));
  assert.ok(plan.command.args.includes('--min-volume'));
  assert.ok(plan.command.args.includes('250000'));
}

function testOptionablePlan() {
  const plan = createOptionableRebuildPlan(
    {
      source: 'nasdaq-trader-us',
      workers: 5,
      workersArg: '5',
    },
    routeConfig,
  );

  assert.strictEqual(plan.job.type, 'rebuild_optionable');
  assert.strictEqual(plan.command.cwd, routeConfig.servicesDir);
  assert.ok(plan.command.args.includes('--options-only'));
}

function testUpdatePlan() {
  const plan = createUniverseUpdatePlan({ interval: '1d' }, routeConfig);

  assert.strictEqual(plan.job.type, 'update');
  assert.strictEqual(plan.job.interval, '1d');
  assert.ok(plan.command.args.includes('--interval'));
  assert.ok(plan.command.args.includes('1d'));
}

function testRegimePlan() {
  const plan = createRegimeClassificationPlan({ interval: '1h' }, routeConfig);

  assert.strictEqual(plan.job.type, 'classify_regimes');
  assert.strictEqual(plan.command.command, 'py');
  assert.ok(plan.command.args.includes(routeConfig.regimeScriptPath));
  assert.ok(plan.command.args.includes('1h'));
}

function main() {
  testBuildPlan();
  testOptionablePlan();
  testUpdatePlan();
  testRegimePlan();
  console.log('universeJobPlans tests passed');
}

main();
