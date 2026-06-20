export interface UniverseJob {
  type: 'build' | 'update' | 'rebuild_optionable' | 'classify_regimes';
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  log: string[];
  error?: string;
  progress?: number;
  progress_label?: string;
  stage?: string;
  last_log_at?: string;
  source?: string;
  source_label?: string;
  lookback?: string;
  interval?: string;
  workers?: number;
  min_volume?: number;
  metrics?: {
    source_symbols?: number;
    option_checked?: number;
    option_total?: number;
    optionable_so_far?: number;
    retry_checked?: number;
    retry_total?: number;
    retry_recovered?: number;
    volume_checked?: number;
    volume_total?: number;
    download_batch?: number;
    download_batches?: number;
    download_batch_size?: number;
    download_total?: number;
  };
}

const MAX_UNIVERSE_LOG_LINES = 400;

export function getUniverseSourceLabel(source: string): string {
  if (source === 'nasdaq-trader-us') return 'Nasdaq Trader US-listed underlyings';
  if (source === 'russell2000') return 'Russell 2000 optionable';
  if (source === 'custom_csv') return 'Custom ticker list';
  return source || 'Optionable universe';
}

export function clampUniverseProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeUniverseProgress(job: UniverseJob): number | undefined {
  const metrics = job.metrics || {};
  switch (job.stage) {
    case 'loading_source':
      return Math.max(job.progress ?? 0, 2);
    case 'checking_optionability':
      if (metrics.option_checked && metrics.option_total) {
        return clampUniverseProgress(5 + (metrics.option_checked / metrics.option_total) * 50);
      }
      return Math.max(job.progress ?? 0, 5);
    case 'retrying_unknown':
      if (metrics.retry_checked && metrics.retry_total) {
        return clampUniverseProgress(55 + (metrics.retry_checked / metrics.retry_total) * 10);
      }
      return Math.max(job.progress ?? 0, 55);
    case 'volume_filter':
      if (metrics.volume_checked && metrics.volume_total) {
        return clampUniverseProgress(65 + (metrics.volume_checked / metrics.volume_total) * 5);
      }
      return Math.max(job.progress ?? 0, 65);
    case 'downloading_history':
      if (metrics.download_batch && metrics.download_batches) {
        return clampUniverseProgress(70 + ((metrics.download_batch - 1) / metrics.download_batches) * 28);
      }
      return Math.max(job.progress ?? 0, 70);
    case 'writing_manifest':
      return Math.max(job.progress ?? 0, 99);
    case 'completed':
      return 100;
    default:
      return job.progress;
  }
}

export function updateUniverseJobFromLine(job: UniverseJob, rawLine: string): void {
  const line = rawLine.trim();
  if (!line) return;
  job.last_log_at = new Date().toISOString();
  job.progress_label = line;
  if (!job.metrics) job.metrics = {};

  let match = line.match(/Found (\d+) eligible US-listed/i);
  if (match) {
    job.stage = 'loading_source';
    job.metrics.source_symbols = Number(match[1]);
  }

  match = line.match(/Found (\d+) Russell 2000/i);
  if (match) {
    job.stage = 'loading_source';
    job.metrics.source_symbols = Number(match[1]);
  }

  match = line.match(/Loaded (\d+) tickers from /i);
  if (match) {
    job.stage = 'loading_source';
    job.metrics.source_symbols = Number(match[1]);
  }

  match = line.match(/Checking options availability for (\d+) tickers \((\d+) parallel workers\)/i);
  if (match) {
    job.stage = 'checking_optionability';
    job.metrics.option_total = Number(match[1]);
    job.workers = Number(match[2]);
  }

  match = line.match(/\[\s*(\d+)%\]\s+(\d+)\/(\d+)\s+checked\s+-\s+(\d+)\s+optionable so far/i);
  if (match) {
    job.stage = 'checking_optionability';
    job.metrics.option_checked = Number(match[2]);
    job.metrics.option_total = Number(match[3]);
    job.metrics.optionable_so_far = Number(match[4]);
  }

  if (/Options filter results:/i.test(line)) {
    job.stage = 'options_filtered';
  }

  match = line.match(/Optionable:\s+(\d+)/i);
  if (match && job.stage === 'options_filtered') {
    job.metrics.optionable_so_far = Number(match[1]);
  }

  if (/Retrying unknown optionability results sequentially/i.test(line)) {
    job.stage = 'retrying_unknown';
  }

  match = line.match(/\[retry\s+(\d+)%\]\s+(\d+)\/(\d+)\s+checked\s+-\s+recovered\s+(\d+)/i);
  if (match) {
    job.stage = 'retrying_unknown';
    job.metrics.retry_checked = Number(match[2]);
    job.metrics.retry_total = Number(match[3]);
    job.metrics.retry_recovered = Number(match[4]);
  }

  match = line.match(/Checking 30-day average volume/i);
  if (match) {
    job.stage = 'volume_filter';
  }

  match = line.match(/\[\s*(\d+)%\]\s+(\d+)\/(\d+)\s+checked$/i);
  if (match && job.stage === 'volume_filter') {
    job.metrics.volume_checked = Number(match[2]);
    job.metrics.volume_total = Number(match[3]);
  }

  match = line.match(/Downloading\s+.+\s+history for (\d+) tickers/i);
  if (match) {
    job.stage = 'downloading_history';
    job.metrics.download_total = Number(match[1]);
  }

  match = line.match(/Batch (\d+)\/(\d+) \((\d+) symbols\)\.\.\./i);
  if (match) {
    job.stage = 'downloading_history';
    job.metrics.download_batch = Number(match[1]);
    job.metrics.download_batches = Number(match[2]);
    job.metrics.download_batch_size = Number(match[3]);
  }

  if (/Manifest saved to/i.test(line)) {
    job.stage = 'writing_manifest';
  }

  if (/DONE in /i.test(line)) {
    job.stage = 'completed';
  }

  const explicitPercent = line.match(/\[\s*(\d+)%\]/);
  if (explicitPercent) {
    job.progress = clampUniverseProgress(Number(explicitPercent[1]));
    return;
  }

  const computed = computeUniverseProgress(job);
  if (typeof computed === 'number') {
    job.progress = computed;
  }
}

export function appendUniverseJobLog(job: UniverseJob, rawLine: string): void {
  const line = rawLine.trimEnd();
  if (!line.trim()) return;
  job.log.push(line);
  if (job.log.length > MAX_UNIVERSE_LOG_LINES) {
    job.log = job.log.slice(-MAX_UNIVERSE_LOG_LINES);
  }
  updateUniverseJobFromLine(job, line);
}
