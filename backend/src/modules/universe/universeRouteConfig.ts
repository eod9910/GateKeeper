import * as path from 'path';

export interface UniverseRouteConfig {
  dataDir: string;
  manifestPath: string;
  optionablePath: string;
  optionableProgressPath: string;
  priceSnapshotCachePath: string;
  servicesDir: string;
  regimeScriptPath: string;
  regimeSnapshotPath: string;
  manifestTtlMs: number;
  priceSnapshotTtlMs: number;
}

export function createUniverseRouteConfig(baseDir: string): UniverseRouteConfig {
  const dataDir = path.join(baseDir, 'data', 'universe');
  return {
    dataDir,
    manifestPath: path.join(dataDir, 'manifest.json'),
    optionablePath: path.join(dataDir, 'optionable.json'),
    optionableProgressPath: path.join(dataDir, 'optionable-progress.json'),
    priceSnapshotCachePath: path.join(dataDir, 'prices-cache.json'),
    servicesDir: path.join(baseDir, 'services'),
    regimeScriptPath: path.join(baseDir, 'scripts', 'build_regime_universes.py'),
    regimeSnapshotPath: path.join(baseDir, 'data', 'regime_snapshot.json'),
    manifestTtlMs: 7 * 24 * 60 * 60 * 1000,
    priceSnapshotTtlMs: 24 * 60 * 60 * 1000,
  };
}
