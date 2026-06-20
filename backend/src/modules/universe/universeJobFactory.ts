import { UniverseJob, getUniverseSourceLabel } from './universeJobProgress';

export interface UniverseBuildJobOptions {
  source: string;
  lookback: string;
  interval: string;
  workers: number;
  minVolume: number;
  startedAt?: string;
}

export interface OptionableRebuildJobOptions {
  source: string;
  workers: number;
  startedAt?: string;
}

export interface UniverseUpdateJobOptions {
  interval: string;
  startedAt?: string;
}

export interface RegimeClassificationJobOptions {
  interval: string;
  startedAt?: string;
}

function nowIso(startedAt?: string): string {
  return startedAt || new Date().toISOString();
}

export function createUniverseBuildJob(options: UniverseBuildJobOptions): UniverseJob {
  return {
    type: 'build',
    status: 'running',
    started_at: nowIso(options.startedAt),
    log: [],
    progress: 0,
    progress_label: 'Starting build...',
    stage: 'starting',
    source: options.source,
    source_label: getUniverseSourceLabel(options.source),
    lookback: options.lookback,
    interval: options.interval,
    workers: options.workers,
    min_volume: options.minVolume,
    metrics: {},
  };
}

export function createOptionableRebuildJob(options: OptionableRebuildJobOptions): UniverseJob {
  return {
    type: 'rebuild_optionable',
    status: 'running',
    started_at: nowIso(options.startedAt),
    log: [],
    progress: 0,
    progress_label: 'Starting optionable subset rebuild...',
    stage: 'starting',
    source: options.source,
    source_label: getUniverseSourceLabel(options.source),
    lookback: 'n/a',
    interval: '1d',
    workers: options.workers,
    min_volume: 0,
    metrics: {},
  };
}

export function createUniverseUpdateJob(options: UniverseUpdateJobOptions): UniverseJob {
  return {
    type: 'update',
    status: 'running',
    started_at: nowIso(options.startedAt),
    log: [],
    progress: 0,
    progress_label: 'Starting update...',
    stage: 'starting',
    interval: options.interval,
    metrics: {},
  };
}

export function createRegimeClassificationJob(options: RegimeClassificationJobOptions): UniverseJob {
  return {
    type: 'classify_regimes',
    status: 'running',
    started_at: nowIso(options.startedAt),
    log: [],
    progress: 0,
    progress_label: 'Starting regime classification...',
    stage: 'classifying',
    source: 'local_csv',
    source_label: 'Local CSV cache',
    lookback: options.interval,
    interval: options.interval,
    workers: 1,
    min_volume: 0,
    metrics: {},
  };
}
