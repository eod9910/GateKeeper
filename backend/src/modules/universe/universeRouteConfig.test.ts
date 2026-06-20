import assert from 'assert';
import * as path from 'path';
import { createUniverseRouteConfig } from './universeRouteConfig';

function main() {
  const baseDir = path.join('repo', 'backend');
  const config = createUniverseRouteConfig(baseDir);

  assert.strictEqual(config.dataDir, path.join(baseDir, 'data', 'universe'));
  assert.strictEqual(config.manifestPath, path.join(baseDir, 'data', 'universe', 'manifest.json'));
  assert.strictEqual(config.optionablePath, path.join(baseDir, 'data', 'universe', 'optionable.json'));
  assert.strictEqual(config.optionableProgressPath, path.join(baseDir, 'data', 'universe', 'optionable-progress.json'));
  assert.strictEqual(config.priceSnapshotCachePath, path.join(baseDir, 'data', 'universe', 'prices-cache.json'));
  assert.strictEqual(config.servicesDir, path.join(baseDir, 'services'));
  assert.strictEqual(config.regimeScriptPath, path.join(baseDir, 'scripts', 'build_regime_universes.py'));
  assert.strictEqual(config.regimeSnapshotPath, path.join(baseDir, 'data', 'regime_snapshot.json'));
  assert.strictEqual(config.manifestTtlMs, 604800000);
  assert.strictEqual(config.priceSnapshotTtlMs, 86400000);
  console.log('universeRouteConfig tests passed');
}

main();
