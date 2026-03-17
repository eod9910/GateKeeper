import fetch from 'node-fetch';
import { StrategySpec, ValidationReport, TradeInstance } from '../types';
import {
  isValidScannerRunResult,
  isValidScannerUniverseResult,
  normalizeScannerRunResult,
  normalizeScannerUniverseResult,
} from './contractValidation';

export type ValidationTier = 'tier1' | 'tier1b' | 'tier2' | 'tier3';

const PY_SERVICE_BASE_URL = (process.env.PY_PLUGIN_SERVICE_URL || 'http://127.0.0.1:8100').replace(/\/+$/, '');
const PY_SERVICE_TIMEOUT_MS = Math.max(1000, Number(process.env.PY_PLUGIN_SERVICE_TIMEOUT_MS || 30000));
// Validator runs can take up to an hour; use a generous timeout and rely on
// the AbortSignal (cancel button) for explicit interruption.
const PY_VALIDATOR_TIMEOUT_MS = Math.max(60_000, Number(process.env.PY_VALIDATOR_TIMEOUT_MS || 7_200_000));
/** Per-symbol budget for batch scans (ms). Total timeout = PER_SYMBOL_BUDGET * nSymbols, clamped. */
const PY_BATCH_PER_SYMBOL_MS = Math.max(1000, Number(process.env.PY_BATCH_PER_SYMBOL_MS || 15000));
const PY_BATCH_TIMEOUT_MIN_MS = 60_000;
const PY_BATCH_TIMEOUT_MAX_MS = 600_000;

export interface PluginServiceHealth {
  ok: boolean;
  service?: string;
  version?: string;
  started_at?: string;
  uptime_seconds?: number;
  pid?: number;
}

export interface ScannerServiceRunResult {
  symbol: string;
  count: number;
  candidates: any[];
  bars?: number;
  cache_hit?: boolean;
  error?: string;
}

export interface ScannerServiceUniverseResult {
  total_symbols: number;
  total_candidates: number;
  results: ScannerServiceRunResult[];
}

function timeoutInit(init: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...init,
    timeout: PY_SERVICE_TIMEOUT_MS,
  };
}

export function isPyServiceEnabled(): boolean {
  return process.env.VALIDATOR_USE_PY_SERVICE === '1';
}

export async function getPluginServiceHealth(): Promise<PluginServiceHealth> {
  const res = await fetch(`${PY_SERVICE_BASE_URL}/health`, timeoutInit());
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`health check failed (${res.status})`);
  }
  const health = payload as PluginServiceHealth;
  if (!health || health.ok !== true) {
    throw new Error('health check returned non-ok status');
  }
  return health;
}

export async function cancelValidatorJobOnService(jobId: string): Promise<void> {
  try {
    await fetch(`${PY_SERVICE_BASE_URL}/validator/cancel/${jobId}`, {
      method: 'POST',
      timeout: 3000,
    } as any);
  } catch {
    // best-effort — the service may already be idle
  }
}

export async function runValidatorPipelineViaService(
  strategy: StrategySpec,
  dateStart: string,
  dateEnd: string,
  universe?: string[],
  tier?: ValidationTier,
  signal?: AbortSignal,
  onProgress?: (evt: { progress: number; stage: string; detail: string; eta_seconds?: number; eta_display?: string }) => void,
): Promise<{ report: ValidationReport; trades: TradeInstance[] }> {
  const body = {
    spec: strategy,
    date_start: dateStart,
    date_end: dateEnd,
    universe: universe && universe.length > 0 ? universe : undefined,
    tier: tier || 'tier3',
  };

  const res = await fetch(
    `${PY_SERVICE_BASE_URL}/validator/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: PY_VALIDATOR_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    } as any,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`python service /validator/run failed: HTTP ${res.status} ${errText.slice(0, 200)}`);
  }

  // Parse the NDJSON stream line by line, forwarding progress events and
  // extracting the final result from the last "result" line.
  const body_stream = res.body;
  if (!body_stream) {
    throw new Error('python service returned empty response body');
  }

  let finalData: any = null;
  let buffer = '';

  // node-fetch body is a Node.js Readable stream
  await new Promise<void>((resolve, reject) => {
    (body_stream as any).on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'progress' && onProgress && msg.data) {
            onProgress(msg.data);
          } else if (msg.type === 'result') {
            finalData = msg.data;
          } else if (msg.type === 'error') {
            reject(new Error(`python service error: ${msg.message || 'unknown'}`));
            return;
          }
        } catch {
          // ignore malformed lines
        }
      }
    });
    (body_stream as any).on('end', () => resolve());
    (body_stream as any).on('error', (err: Error) => reject(err));
  });

  if (!finalData || !finalData.data || !finalData.data.report) {
    throw new Error('python service returned malformed validator payload');
  }

  return {
    report: finalData.data.report as ValidationReport,
    trades: (finalData.data.trades || []) as TradeInstance[],
  };
}

export async function runScannerPluginViaService(
  spec: StrategySpec,
  symbol: string,
  timeframe: string,
  period: string,
  interval: string,
  mode: 'scan' | 'backtest' = 'scan',
  opts?: { start_date?: string; end_date?: string },
): Promise<ScannerServiceRunResult> {
  const body: Record<string, any> = {
    spec,
    symbol,
    timeframe,
    period,
    interval,
    mode,
  };
  if (opts?.start_date) body.start_date = opts.start_date;
  if (opts?.end_date) body.end_date = opts.end_date;
  const res = await fetch(
    `${PY_SERVICE_BASE_URL}/scanner/run-plugin`,
    timeoutInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const payload = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const detail = (payload as any)?.detail;
    const message = typeof detail === 'string'
      ? detail
      : (detail && typeof detail.message === 'string' ? detail.message : `HTTP ${res.status}`);
    throw new Error(`python service /scanner/run-plugin failed: ${message}`);
  }
  const data = (payload as any)?.data || payload;
  if (!data || typeof data !== 'object') {
    throw new Error('python service returned malformed scanner payload');
  }
  const result = normalizeScannerRunResult(data);
  if (!isValidScannerRunResult(result)) {
    throw new Error('python service returned invalid scanner payload');
  }
  return result as ScannerServiceRunResult;
}

export async function runScannerUniverseViaService(
  spec: StrategySpec,
  symbols: string[],
  timeframe: string,
  period: string,
  interval: string,
  mode: 'scan' | 'backtest' = 'scan',
): Promise<ScannerServiceUniverseResult> {
  const body = {
    spec,
    symbols,
    timeframe,
    period,
    interval,
    mode,
  };
  // Dynamic timeout: scale with symbol count, clamped to min/max
  const batchTimeout = Math.max(
    PY_BATCH_TIMEOUT_MIN_MS,
    Math.min(PY_BATCH_TIMEOUT_MAX_MS, PY_BATCH_PER_SYMBOL_MS * symbols.length),
  );
  const res = await fetch(
    `${PY_SERVICE_BASE_URL}/scanner/scan-universe`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: batchTimeout,
    } as any,
  );
  const payload = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const detail = (payload as any)?.detail;
    const message = typeof detail === 'string'
      ? detail
      : (detail && typeof detail.message === 'string' ? detail.message : `HTTP ${res.status}`);
    throw new Error(`python service /scanner/scan-universe failed: ${message}`);
  }
  const data = (payload as any)?.data || payload;
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).results)) {
    throw new Error('python service returned malformed scanner-universe payload');
  }
  const result = normalizeScannerUniverseResult(data);
  if (!isValidScannerUniverseResult(result)) {
    throw new Error('python service returned invalid scanner-universe payload');
  }
  return result as ScannerServiceUniverseResult;
}
