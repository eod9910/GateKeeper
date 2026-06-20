import * as path from 'path';
import * as fs from 'fs/promises';

export interface UniverseJobCommand {
  command: string;
  args: string[];
  cwd?: string;
}

export type AccessUniverseFile = (filePath: string) => Promise<unknown>;

export async function canAccessUniverseFile(
  filePath: string,
  accessFile: AccessUniverseFile = fs.access,
): Promise<boolean> {
  try {
    await accessFile(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function canReuseOptionableCatalog(
  optionablePath: string,
  accessFile: AccessUniverseFile = fs.access,
): Promise<boolean> {
  return canAccessUniverseFile(optionablePath, accessFile);
}

export function buildUniverseBuildCommand(options: {
  servicesDir: string;
  source: string;
  lookback: string;
  interval: string;
  minVolume: string;
  workers: string;
  skipOptionsCheck: boolean;
}): UniverseJobCommand {
  const scriptPath = path.join(options.servicesDir, 'build_universe.py');
  const args = [
    '-u',
    scriptPath,
    '--source', options.source,
    '--lookback', options.lookback,
    '--interval', options.interval,
    '--min-volume', options.minVolume,
    '--workers', options.workers,
  ];
  if (options.skipOptionsCheck) {
    args.push('--skip-options-check');
  }
  return { command: 'py', args, cwd: options.servicesDir };
}

export function buildOptionableRebuildCommand(options: {
  servicesDir: string;
  source: string;
  workers: string;
}): UniverseJobCommand {
  const scriptPath = path.join(options.servicesDir, 'build_universe.py');
  return {
    command: 'py',
    args: [
      '-u',
      scriptPath,
      '--source', options.source,
      '--interval', '1d',
      '--min-volume', '0',
      '--workers', options.workers,
      '--option-timeout', '8',
      '--options-only',
    ],
    cwd: options.servicesDir,
  };
}

export function buildUniverseUpdateCommand(options: {
  servicesDir: string;
  interval: string;
}): UniverseJobCommand {
  const scriptPath = path.join(options.servicesDir, 'update_universe.py');
  return {
    command: 'py',
    args: ['-u', scriptPath, '--interval', options.interval],
    cwd: options.servicesDir,
  };
}

export function buildRegimeClassificationCommand(options: {
  scriptPath: string;
  interval: string;
}): UniverseJobCommand {
  return {
    command: 'py',
    args: ['-u', options.scriptPath, '--interval', options.interval],
  };
}
