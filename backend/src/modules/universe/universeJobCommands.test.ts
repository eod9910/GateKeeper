import assert from 'assert';
import * as path from 'path';
import {
  buildOptionableRebuildCommand,
  buildRegimeClassificationCommand,
  buildUniverseBuildCommand,
  buildUniverseUpdateCommand,
  canReuseOptionableCatalog,
} from './universeJobCommands';

const servicesDir = 'C:\\repo\\backend\\services';

function testBuildUniverseBuildCommand(): void {
  const command = buildUniverseBuildCommand({
    servicesDir,
    source: 'nasdaq-trader-us',
    lookback: '5y',
    interval: '1d',
    minVolume: '1000000',
    workers: '10',
    skipOptionsCheck: true,
  });

  assert.equal(command.command, 'py');
  assert.equal(command.cwd, servicesDir);
  assert.deepEqual(command.args, [
    '-u',
    path.join(servicesDir, 'build_universe.py'),
    '--source', 'nasdaq-trader-us',
    '--lookback', '5y',
    '--interval', '1d',
    '--min-volume', '1000000',
    '--workers', '10',
    '--skip-options-check',
  ]);
}

function testBuildUniverseBuildCommandWithoutSkipOptions(): void {
  const command = buildUniverseBuildCommand({
    servicesDir,
    source: 'custom_csv',
    lookback: '2y',
    interval: '1wk',
    minVolume: '0',
    workers: '3',
    skipOptionsCheck: false,
  });

  assert.equal(command.args.includes('--skip-options-check'), false);
}

function testOptionableRebuildCommand(): void {
  const command = buildOptionableRebuildCommand({
    servicesDir,
    source: 'russell2000',
    workers: '5',
  });

  assert.equal(command.command, 'py');
  assert.equal(command.cwd, servicesDir);
  assert.deepEqual(command.args, [
    '-u',
    path.join(servicesDir, 'build_universe.py'),
    '--source', 'russell2000',
    '--interval', '1d',
    '--min-volume', '0',
    '--workers', '5',
    '--option-timeout', '8',
    '--options-only',
  ]);
}

function testUpdateCommand(): void {
  const command = buildUniverseUpdateCommand({
    servicesDir,
    interval: '1wk',
  });

  assert.equal(command.command, 'py');
  assert.equal(command.cwd, servicesDir);
  assert.deepEqual(command.args, ['-u', path.join(servicesDir, 'update_universe.py'), '--interval', '1wk']);
}

function testRegimeClassificationCommand(): void {
  const scriptPath = 'C:\\repo\\backend\\scripts\\build_regime_universes.py';
  const command = buildRegimeClassificationCommand({
    scriptPath,
    interval: '1d',
  });

  assert.equal(command.command, 'py');
  assert.equal(command.cwd, undefined);
  assert.deepEqual(command.args, ['-u', scriptPath, '--interval', '1d']);
}

async function testCanReuseOptionableCatalogWhenAccessible(): Promise<void> {
  const canReuse = await canReuseOptionableCatalog('optionable.json', async () => undefined);

  assert.equal(canReuse, true);
}

async function testCanReuseOptionableCatalogWhenMissing(): Promise<void> {
  const canReuse = await canReuseOptionableCatalog('optionable.json', async () => {
    throw new Error('missing');
  });

  assert.equal(canReuse, false);
}

async function runTests(): Promise<void> {
  testBuildUniverseBuildCommand();
  testBuildUniverseBuildCommandWithoutSkipOptions();
  testOptionableRebuildCommand();
  testUpdateCommand();
  testRegimeClassificationCommand();
  await testCanReuseOptionableCatalogWhenAccessible();
  await testCanReuseOptionableCatalogWhenMissing();
}

runTests()
  .then(() => console.log('universeJobCommands tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
