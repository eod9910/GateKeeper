/**
 * Candidates API Routes
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as storage from '../services/storageService';
import { computeSpecHash } from '../services/storageService';
import { ScanRequest, PatternCandidate, StrategyCandidate, StrategySpec, ApiResponse } from '../types';
import {
  attachPersistedCandidateIds,
  persistCandidatesForResponse,
} from '../services/candidatePersistence';
import { resolvePluginDefinition } from '../services/pluginDefinitionResolver';
import {
  parseStrictBaseRequest,
  parseOnePerSymbolRequest,
  reduceOnePerSymbolCandidates,
  filterStrictBaseCandidates,
  extractSuiteReportFromOutput,
} from '../services/candidateFilters';
import { applyCandidateSemantics, applyCandidateSemanticsList, CandidateSemanticsMeta } from '../services/candidateSemantics';
import { normalizeScannerRunResult } from '../services/contractValidation';
import {
  getPluginServiceHealth,
  isPyServiceEnabled,
  runScannerPluginViaService,
  runScannerUniverseViaService,
} from '../services/pluginServiceClient';
import { normalizeMarketDataSymbol } from '../services/marketSymbols';

const router = Router();
const CANDIDATES_USE_PY_SERVICE = isPyServiceEnabled();
type BatchScanJobStatus = 'queued' | 'running' | 'cancelled' | 'completed' | 'failed';

type BatchScanJob = {
  job_id: string;
  status: BatchScanJobStatus;
  progress: number;
  stage: string;
  detail?: string;
  error?: string;
  cancel_requested?: boolean;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  total_symbols: number;
  completed_symbols: number;
  total_candidates: number;
  request: {
    symbols: string[];
    timeframe?: string;
    period?: string;
    interval?: string;
    pluginId?: string;
    strategyVersionId?: string;
    scanScope?: 'production' | 'research';
    strictBase?: boolean;
    strictBaseMinScore?: number;
    onePerSymbol?: boolean;
  };
  result?: {
    totalSymbols: number;
    totalCandidates: number;
    candidates: StrategyCandidate[];
    results: { symbol: string; count: number; error?: string }[];
  };
};

const batchScanJobs = new Map<string, BatchScanJob>();
const MAX_BATCH_SCAN_JOBS = 100;
const ORPHAN_SCAN_MINUTES = Math.max(5, Number(process.env.ORPHAN_SCAN_MINUTES || 120));
const MAX_BATCH_SCAN_SYMBOLS = Math.max(500, Number(process.env.MAX_BATCH_SCAN_SYMBOLS || 15000));

// ---------------------------------------------------------------------------
// Default Wyckoff strategy version ID (seeded spec file)
// ---------------------------------------------------------------------------
const DEFAULT_WYCKOFF_SPEC = 'wyckoff_accumulation_v1';

function makeBatchScanJobId(): string {
  return `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pruneBatchScanJobs(): void {
  if (batchScanJobs.size <= MAX_BATCH_SCAN_JOBS) return;
  const done = Array.from(batchScanJobs.values())
    .filter((j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled')
    .sort((a, b) => String(a.completed_at || a.created_at).localeCompare(String(b.completed_at || b.created_at)));
  while (batchScanJobs.size > MAX_BATCH_SCAN_JOBS && done.length) {
    const oldest = done.shift();
    if (oldest) batchScanJobs.delete(oldest.job_id);
  }
}

function parseIsoMs(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function detectScanOrphan(job: BatchScanJob, nowMs = Date.now()): { orphan: boolean; ageMinutes: number; reason: string } {
  const startedMs = parseIsoMs(job.started_at);
  const createdMs = parseIsoMs(job.created_at);
  const anchorMs = startedMs || createdMs;
  const ageMinutes = anchorMs > 0 ? Math.max(0, (nowMs - anchorMs) / 60000) : 0;

  if (job.status !== 'running' && job.status !== 'queued') {
    return { orphan: false, ageMinutes, reason: '' };
  }

  if (ageMinutes <= ORPHAN_SCAN_MINUTES) {
    return { orphan: false, ageMinutes, reason: '' };
  }

  if (job.status === 'queued') {
    return { orphan: true, ageMinutes, reason: `queued>${ORPHAN_SCAN_MINUTES}m` };
  }

  if (job.status === 'running') {
    return { orphan: true, ageMinutes, reason: `running>${ORPHAN_SCAN_MINUTES}m` };
  }

  return { orphan: false, ageMinutes, reason: '' };
}

function cleanupOrphanBatchJobs(nowMs = Date.now()): number {
  let updated = 0;
  for (const job of batchScanJobs.values()) {
    const orphanMeta = detectScanOrphan(job, nowMs);
    if (!orphanMeta.orphan) continue;

    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.stage = 'cancelled';
      job.detail = `Auto-cancelled stale queued job (${orphanMeta.reason})`;
    } else if (job.status === 'running') {
      job.status = 'failed';
      job.stage = 'failed';
      job.error = `Orphaned scan job detected (${orphanMeta.reason})`;
      job.progress = 1;
      job.detail = `Marked failed by orphan cleanup (${orphanMeta.reason})`;
    }
    if (!job.completed_at) {
      job.completed_at = new Date(nowMs).toISOString();
    }
    updated += 1;
  }
  return updated;
}

function isValidSymbol(s: any): boolean {
  return typeof s === 'string' && /^[A-Z0-9._\-=^]{1,15}$/.test(s.trim().toUpperCase());
}

function semanticsMetaFromDefinition(definition: any): CandidateSemanticsMeta {
  return {
    artifactType: definition?.artifact_type ?? null,
    indicatorRole: definition?.indicator_role ?? null,
    patternRole: definition?.pattern_role ?? null,
    entryType: definition?.default_entry?.entry_type ?? null,
  };
}

function semanticsMetaFromSpec(spec: StrategySpec | null | undefined): CandidateSemanticsMeta {
  return {
    artifactType: (spec as any)?.artifact_type ?? null,
    indicatorRole: (spec as any)?.setup_config?.indicator_role ?? null,
    patternRole: (spec as any)?.setup_config?.pattern_role ?? null,
    entryType: (spec as any)?.entry_config?.entry_type ?? null,
  };
}

function validateScanRequestBody(body: any): string | null {
  if (!body || typeof body !== 'object') return 'request body must be an object';
  if (!isValidSymbol(body.symbol)) return 'symbol is required and must be a valid symbol';
  if (body.scanScope != null && !['production', 'research'].includes(body.scanScope)) {
    return "scanScope must be 'production' or 'research'";
  }
  if (body.scanMode != null && !['wyckoff', 'swing', 'fib-energy', 'copilot', 'discount', 'discount-only', 'regime', 'strategy'].includes(body.scanMode)) {
    return "scanMode must be one of: wyckoff, swing, fib-energy, copilot, discount, discount-only, regime, strategy";
  }
  if (body.strategyVersionId != null && typeof body.strategyVersionId !== 'string') {
    return 'strategyVersionId must be a string';
  }
  if (body.strategyId != null && typeof body.strategyId !== 'string') {
    return 'strategyId must be a string';
  }
  if (body.pluginId != null && typeof body.pluginId !== 'string') {
    return 'pluginId must be a string';
  }
  if (body.interval != null && typeof body.interval !== 'string') return 'interval must be a string';
  if (body.timeframe != null && typeof body.timeframe !== 'string') return 'timeframe must be a string';
  return null;
}

function runBaseMethodCompareSuite(
  symbols: string[],
  interval: string,
  period: string,
  mode: 'scan' | 'backtest',
  strictBase: boolean,
  strictBaseMinScore: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; report: any | null }> {
  return new Promise((resolve) => {
    const backendDir = path.join(__dirname, '..', '..');
    const scriptPath = path.join(backendDir, 'scripts', 'run_base_method_suite.py');
    const args = [
      scriptPath,
      '--symbols', symbols.join(','),
      '--interval', interval,
      '--period', period,
      '--mode', mode,
      '--no-save',
    ];
    if (strictBase) {
      args.push('--strict-base');
      args.push('--strict-min-score', String(strictBaseMinScore));
    }
    const proc = spawn('py', args, { cwd: backendDir });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (payload: { stdout: string; stderr: string; exitCode: number }) => {
      if (settled) return;
      settled = true;
      resolve({
        ...payload,
        report: extractSuiteReportFromOutput(payload.stdout),
      });
    };

    const timeout = setTimeout(() => {
      proc.kill();
      finish({
        stdout,
        stderr: `${stderr}\nTimeout: base method compare exceeded 10 minutes`,
        exitCode: 1,
      });
    }, 10 * 60_000);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      finish({ stdout, stderr, exitCode: code || 0 });
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      finish({ stdout, stderr: `${stderr}\n${err.message}`, exitCode: 1 });
    });
  });
}

router.post('/base-methods/compare', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { strictBase, strictBaseMinScore } = parseStrictBaseRequest(body);
    const rawSymbols = Array.isArray(body.symbols) ? body.symbols : [];
    const normalizedSymbols: string[] = Array.from(
      new Set(
        rawSymbols
          .map((s: any) => String(s || '').trim().toUpperCase())
          .filter((s: string) => isValidSymbol(s)),
      ),
    );

    if (!normalizedSymbols.length) {
      return res.status(400).json({
        success: false,
        error: 'symbols must be a non-empty array of valid symbols',
      } as ApiResponse<null>);
    }

    const maxSymbolsRaw = Number(body.maxSymbols ?? 40);
    const maxSymbols = Math.max(1, Math.min(200, Number.isFinite(maxSymbolsRaw) ? Math.floor(maxSymbolsRaw) : 40));
    const symbols = normalizedSymbols.slice(0, maxSymbols);

    const interval = typeof body.interval === 'string' && body.interval.trim()
      ? body.interval.trim()
      : '1wk';
    const period = typeof body.period === 'string' && body.period.trim()
      ? body.period.trim()
      : '5y';
    const mode = body.mode === 'scan' ? 'scan' : 'backtest';

    const result = await runBaseMethodCompareSuite(
      symbols,
      interval,
      period,
      mode,
      strictBase,
      strictBaseMinScore,
    );
    if (result.exitCode !== 0) {
      return res.status(500).json({
        success: false,
        error: `Base method compare failed (exit ${result.exitCode})`,
        data: {
          stderr: result.stderr,
          stdout: result.stdout,
        },
      } as ApiResponse<any>);
    }

    if (!result.report) {
      return res.status(500).json({
        success: false,
        error: 'Base method compare did not return a parseable report',
        data: {
          stderr: result.stderr,
          stdout: result.stdout,
        },
      } as ApiResponse<any>);
    }

    return res.json({
      success: true,
      data: {
        report: result.report,
        requested_symbols: normalizedSymbols.length,
        used_symbols: symbols.length,
        mode,
        interval,
        period,
        strict_base: strictBase,
        strict_base_min_score: strictBaseMinScore,
      },
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

/**
 * Helper: resolve a StrategySpec from scan request params.
 * Priority: strategyVersionId > strategyId (latest approved) > default for wyckoff
 */
async function resolveStrategy(req: ScanRequest): Promise<StrategySpec | null> {
  // 1. Explicit version ID
  if (req.strategyVersionId) {
    return storage.getStrategy(req.strategyVersionId);
  }

  // 2. strategy_id → latest approved
  if (req.strategyId) {
    const scope = req.scanScope || 'production';
    if (scope === 'production') {
      return storage.getLatestApprovedStrategy(req.strategyId);
    }
    // research: find any latest version regardless of status
    const all = await storage.getAllStrategies();
    const matches = all.filter(s => s.strategy_id === req.strategyId);
    if (matches.length === 0) return null;
    matches.sort((a, b) => Number(b.version) - Number(a.version));
    return matches[0];
  }

  // 3. If scanMode is wyckoff, load the default spec
  if (req.scanMode === 'wyckoff') {
    let spec = await storage.getStrategy(DEFAULT_WYCKOFF_SPEC);
    if (!spec) {
      // Seed from the shipped JSON file
      const specPath = path.join(__dirname, '..', '..', 'data', 'strategies', `${DEFAULT_WYCKOFF_SPEC}.json`);
      try {
        const content = await fs.readFile(specPath, 'utf-8');
        spec = JSON.parse(content) as StrategySpec;
        if (!spec.strategy_version_id) {
          spec.strategy_version_id = `${spec.strategy_id}_v${spec.version}`;
        }
        await storage.saveStrategy(spec);
      } catch {
        return null;
      }
    }
    return spec;
  }

  return null;
}

/**
 * Helper: run the strategy runner Python process.
 * Writes spec to a temp file, spawns strategyRunner.py, returns parsed output.
 */
function runStrategyRunner(
  spec: StrategySpec,
  symbol: string,
  timeframe: string,
  period: string,
  interval: string,
  mode: string = 'scan',
  opts?: { start_date?: string; end_date?: string },
): Promise<{ candidates: StrategyCandidate[]; stderr: string }> {
  return new Promise(async (resolve, reject) => {
    if (CANDIDATES_USE_PY_SERVICE) {
      try {
        await getPluginServiceHealth();
        const serviceResult = await runScannerPluginViaService(
          spec,
          symbol,
          timeframe,
          period,
          interval,
          mode === 'backtest' ? 'backtest' : 'scan',
          opts,
        );
        resolve({ candidates: (serviceResult.candidates || []) as StrategyCandidate[], stderr: '' });
        return;
      } catch (serviceErr: any) {
        console.warn(
          `[candidates] Python service unavailable for single scan; falling back to spawn path: ${serviceErr?.message || serviceErr}`,
        );
      }
    }

    const runnerPath = path.join(__dirname, '..', '..', 'services', 'strategyRunner.py');

    // Ensure spec_hash is present before passing to runner
    if (!spec.spec_hash) {
      spec.spec_hash = computeSpecHash(spec);
    }

    // Write spec to temp file
    const tmpDir = path.join(__dirname, '..', '..', 'data');
    const tmpFile = path.join(tmpDir, `_tmp_spec_${Date.now()}.json`);
    const specJson = JSON.stringify(spec);
    await fs.writeFile(tmpFile, specJson);

    const args = [
      runnerPath,
      '--spec', tmpFile,
      '--symbol', symbol,
      '--timeframe', timeframe,
      '--period', period,
      '--interval', interval,
      '--mode', mode
    ];

    const runner = spawn('py', args);

    let stdout = '';
    let stderr = '';

    runner.stdout.on('data', (data) => { stdout += data.toString(); });
    runner.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('[StrategyRunner]', data.toString().trim());
    });

    runner.on('close', async (code) => {
      // Clean up temp file
      try { await fs.unlink(tmpFile); } catch {}

      if (code !== 0) {
        reject(new Error(`StrategyRunner exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
          reject(new Error('StrategyRunner returned non-array payload'));
          return;
        }
        const normalized = normalizeScannerRunResult({
          symbol,
          candidates: parsed,
        });
        resolve({ candidates: normalized.candidates, stderr });
      } catch (parseErr: any) {
        reject(new Error(`Failed to parse runner output: ${parseErr.message}`));
      }
    });

    runner.on('error', async (err) => {
      try { await fs.unlink(tmpFile); } catch {}
      reject(err);
    });
  });
}

/**
 * GET /api/candidates
 * List all candidates (sorted by score)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const candidates = applyCandidateSemanticsList(await storage.getAllCandidates() as unknown as StrategyCandidate[]);
    
    res.json({
      success: true,
      data: candidates
    } as ApiResponse<StrategyCandidate[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/candidates/unlabeled
 * Get candidates that haven't been labeled yet
 */
router.get('/unlabeled', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'default';
    const candidates = applyCandidateSemanticsList(await storage.getUnlabeledCandidates(userId) as unknown as StrategyCandidate[]);
    
    res.json({
      success: true,
      data: candidates
    } as ApiResponse<StrategyCandidate[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/candidates/discount
 * Get all discount zone candidates, sorted by rank score
 */
router.get('/discount', async (req: Request, res: Response) => {
  try {
    const candidates = applyCandidateSemanticsList(await storage.getAllDiscountCandidates() as unknown as StrategyCandidate[]);
    res.json({
      success: true,
      data: candidates
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/candidates/symbols
 * Get the list of available symbols to scan
 */
router.get('/symbols', async (req: Request, res: Response) => {
  try {
    const symbolsPath = path.join(__dirname, '..', '..', 'data', 'symbols.json');
    const content = await fs.readFile(symbolsPath, 'utf-8');
    const symbols = JSON.parse(content) || {};

    const normalizeSymbols = (arr: any): string[] => {
      if (!Array.isArray(arr)) return [];
      return Array.from(
        new Set(
          arr
            .map((s: any) => String(s || '').trim().toUpperCase())
            .filter((s: string) => !!s)
        )
      ).sort((a, b) => a.localeCompare(b));
    };

    const universeDir = path.join(__dirname, '..', '..', 'data', 'universe');
    const optionablePath = path.join(universeDir, 'optionable.json');
    const manifestPath = path.join(universeDir, 'manifest.json');
    let optionable: string[] = [];
    let sourceAll: string[] = [];
    try {
      const optRaw = await fs.readFile(optionablePath, 'utf-8');
      const optJson = JSON.parse(optRaw) || {};
      let manifestJson: any = null;
      try {
        const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
        manifestJson = JSON.parse(manifestRaw) || null;
      } catch {
        manifestJson = null;
      }
      const optionableSource = String(optJson.source || '').trim();
      const manifestSource = String(manifestJson?.source || '').trim();
      const sourceMatchesManifest = !manifestSource || !optionableSource || optionableSource === manifestSource;
      if (sourceMatchesManifest) {
        optionable = normalizeSymbols(optJson.optionable || optJson.symbols || []);
        sourceAll = normalizeSymbols(optJson.source_symbols || []);
      }
    } catch {
      optionable = [];
      sourceAll = [];
    }

    const data = {
      ...symbols,
      commodities: normalizeSymbols(symbols.commodities),
      futures: normalizeSymbols(symbols.futures),
      indices: normalizeSymbols(symbols.indices),
      sectors: normalizeSymbols(symbols.sectors),
      international: normalizeSymbols(symbols.international),
      bonds: normalizeSymbols(symbols.bonds),
      smallcaps: normalizeSymbols(symbols.smallcaps),
      crypto: normalizeSymbols(symbols.crypto),
      optionable,
      source_all: sourceAll,
      all: sourceAll.length > 0
        ? sourceAll
        : normalizeSymbols([...(symbols.all || []), ...optionable]),
    };

    res.json({
      success: true,
      data
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/candidates/:id
 * Get a specific candidate
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const rawCandidate = await storage.getCandidate(req.params.id);
    const candidate = rawCandidate ? applyCandidateSemantics(rawCandidate as unknown as StrategyCandidate) : rawCandidate;
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      } as ApiResponse<null>);
    }
    
    res.json({
      success: true,
      data: candidate
    } as ApiResponse<StrategyCandidate>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/candidates/scan
 * Run the pattern scanner on a symbol.
 * 
 * Request body:
 *   - symbol: string (required)
 *   - timeframe: string (default: 'W')
 *   - period: string (default: 'max')
 *   - interval: string (default: '1wk')
 *   - scanMode: 'wyckoff' | 'swing' | 'fib-energy' | 'copilot' | 'discount' | 'regime'
 *   - strategyVersionId: string  — run a specific strategy version
 *   - strategyId: string         — run latest approved version of a strategy
 *   - scanScope: 'production' | 'research' (default 'production')
 *   - skipSave: boolean
 *   
 * All scans are routed through the StrategyRunner (strategyRunner.py).
 * When pluginId is provided, an auto-generated StrategySpec is built
 * from the plugin's JSON definition. When strategyVersionId/strategyId
 * is provided, the spec is loaded from storage.
 */
router.post('/scan', async (req: Request, res: Response) => {
  try {
    console.log('[SCAN] Incoming request body:', JSON.stringify(req.body || {}).slice(0, 300));
    const reqError = validateScanRequestBody(req.body);
    if (reqError) {
      console.log('[SCAN] Validation error:', reqError);
      return res.status(400).json({ success: false, error: reqError } as ApiResponse<null>);
    }

    const scanRequest: ScanRequest = req.body;
    const { strictBase, strictBaseMinScore } = parseStrictBaseRequest(req.body);
    const onePerSymbol = parseOnePerSymbolRequest(req.body);
    scanRequest.symbol = scanRequest.symbol.toUpperCase();
    
    // scanMode is no longer used for routing — all scans go through
    // either the plugin path (pluginId) or the strategy path (strategyId).
    const scanMode = scanRequest.scanMode || 'default';
    
    // Map interval to appropriate yfinance period
    const interval = scanRequest.interval || '1wk';
    
    const periodMap: Record<string, string> = {
      '1mo': 'max',
      '1wk': 'max',
      '1d': '10y',
      '1h': '730d',
      '15m': '60d',
      '5m': '60d',
      '1m': '7d',
    };
    const period = scanRequest.period || periodMap[interval] || 'max';
    const timeframe = scanRequest.timeframe || 'W';

    // Plugin-driven path: run by plugin ID from Indicator Studio.
    if ((scanRequest as any).pluginId) {
      const pluginId = String((scanRequest as any).pluginId || '').trim();
      console.log(`[SCAN] Plugin path: pluginId="${pluginId}"`);
      if (!scanRequest.scanScope) {
        scanRequest.scanScope = 'research';
      }
      const resolved = await resolvePluginDefinition(pluginId);
      if (!resolved) {
        console.log(`[SCAN] Plugin NOT found: "${pluginId}"`);
        return res.status(404).json({
          success: false,
          error: `Plugin not found: ${pluginId}`
        } as ApiResponse<null>);
      }
      console.log(`[SCAN] Plugin resolved: ${resolved.pattern?.name}, pattern_type=${resolved.definition?.pattern_type}`);
      const semanticsMeta = semanticsMetaFromDefinition(resolved.definition);

      // All plugins now route through StrategyRunner — no legacy scanner_mode.
      const spec: StrategySpec = {
        strategy_id: `scan_${pluginId}`,
        strategy_version_id: `scan_${pluginId}_v1`,
        version: 1,
        status: 'draft',
        name: resolved.pattern?.name || pluginId,
        description: `Auto-generated scan spec for ${pluginId}`,
        interval,
        universe: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        structure_config: resolved.definition?.default_structure_config || {},
        setup_config: {
          ...(resolved.definition?.default_setup_params || {}),
          // Prefer setup default pattern_type if provided; fall back to definition/pattern id.
          pattern_type:
            resolved.definition?.default_setup_params?.pattern_type
            || resolved.definition?.pattern_type
            || pluginId,
          indicator_role: resolved.definition?.indicator_role || '',
        },
        entry_config: resolved.definition?.default_entry || { confirmation_bars: 1 },
        risk_config: {
          stop_type: 'fixed_pct',
          stop_level: 'entry',
          stop_buffer_pct: 0.02
        },
        exit_config: {
          target_type: 'percentage',
          target_level: 0.1,
          time_stop_bars: null,
          trailing: null
        },
        cost_config: {
          commission_per_trade: 0,
          spread_pct: 0,
          slippage_pct: 0.001
        }
      };

      // Merge any pluginParams from the frontend into setup_config
      const pluginParams = (scanRequest as any).pluginParams;
      if (pluginParams && typeof pluginParams === 'object') {
        Object.assign(spec.setup_config!, pluginParams);
        if (pluginParams.epsilon_pct != null && spec.structure_config) {
          (spec.structure_config as any).swing_epsilon_pct = pluginParams.epsilon_pct;
        }
      }

      // Allow scanner-level sensitivity overrides for plugin scans.
      if (typeof scanRequest.swingEpsilon === 'number' && Number.isFinite(scanRequest.swingEpsilon)) {
        (spec as any).structure_config = (spec as any).structure_config || {};
        (spec as any).structure_config.swing_epsilon_pct = scanRequest.swingEpsilon;
      }

      const dateRange: { start_date?: string; end_date?: string } = {};
      if ((scanRequest as any).start_date) dateRange.start_date = String((scanRequest as any).start_date);
      if ((scanRequest as any).end_date) dateRange.end_date = String((scanRequest as any).end_date);

      try {
        const { candidates } = await runStrategyRunner(
          spec,
          scanRequest.symbol,
          timeframe,
          period,
          interval,
          'scan',
          Object.keys(dateRange).length > 0 ? dateRange : undefined,
        );
        const classified = applyCandidateSemanticsList(candidates, semanticsMeta);
        const strictFiltered = filterStrictBaseCandidates(classified, strictBase, strictBaseMinScore);
        const filteredCandidates = reduceOnePerSymbolCandidates(strictFiltered, onePerSymbol);

        let ids: string[] = [];
        let responseCandidates = filteredCandidates;
        if (!scanRequest.skipSave) {
          const persisted = await persistCandidatesForResponse(filteredCandidates);
          ids = persisted.ids;
          responseCandidates = persisted.candidates;
        }

        return res.json({
          success: true,
          data: {
            count: filteredCandidates.length,
            raw_count: candidates.length,
            filtered_out: Math.max(0, candidates.length - strictFiltered.length),
            deduped_out: Math.max(0, strictFiltered.length - filteredCandidates.length),
            strict_base_applied: strictBase,
            strict_base_min_score: strictBaseMinScore,
            one_per_symbol: onePerSymbol,
            ids,
            candidates: responseCandidates,
            strategy_version_id: spec.strategy_version_id,
            strategy_status: spec.status,
            strategy_name: spec.name
          }
        });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: `Plugin scan failed: ${err.message}`
        } as ApiResponse<null>);
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // STRATEGY-DRIVEN PATH  (explicit strategy ID provided)
    // ══════════════════════════════════════════════════════════════════════
    const useStrategyRunner =
      scanRequest.strategyVersionId ||
      scanRequest.strategyId;

    if (useStrategyRunner) {
      // Resolve strategy spec
      const spec = await resolveStrategy(scanRequest);
      if (!spec) {
        return res.status(404).json({
          success: false,
          error: scanRequest.strategyVersionId
            ? `Strategy version not found: ${scanRequest.strategyVersionId}`
            : scanRequest.strategyId
            ? `No approved strategy found for: ${scanRequest.strategyId}`
            : 'Default Wyckoff spec not found'
        } as ApiResponse<null>);
      }

      // ── Production gate: NO bypass. Period. ──────────────────────────
      // In production mode, the strategy MUST be:
      //   1. status === 'approved'
      //   2. Have a latest ValidationReport with pass_fail === 'PASS'
      //      AND decision_log.decision === 'approved'
      // No exceptions. No "explicit version ID" bypass.
      if ((scanRequest.scanScope || 'production') === 'production') {
        if (spec.status !== 'approved') {
          return res.status(403).json({
            success: false,
            error: `Production gate: Strategy ${spec.strategy_version_id} is not approved (status: ${spec.status}). Use scanScope='research' to allow non-approved strategies.`
          } as ApiResponse<null>);
        }

        // Check for a passing ValidationReport
        const reports = await storage.getAllValidationReports(spec.strategy_version_id);
        const latestReport = reports.length > 0 ? reports[0] : null; // already sorted newest-first
        const hasPassingReport = latestReport
          && latestReport.pass_fail === 'PASS'
          && latestReport.decision_log?.decision === 'approved';

        if (!hasPassingReport) {
          return res.status(403).json({
            success: false,
            error: `Production gate: Strategy ${spec.strategy_version_id} has no ValidationReport with PASS + APPROVED. Run validation first, or use scanScope='research'.`
          } as ApiResponse<null>);
        }
      }

      // Apply any request-level overrides to the spec (e.g. minMarkdown)
      if (scanRequest.minMarkdown && spec.setup_config) {
        spec.setup_config.min_markdown_pct = scanRequest.minMarkdown;
      }
      if (scanRequest.minRetracement && spec.setup_config) {
        spec.setup_config.pullback_retracement_min = scanRequest.minRetracement;
      }
      if (scanRequest.maxRetracement && spec.setup_config) {
        spec.setup_config.pullback_retracement_max = scanRequest.maxRetracement;
      }
      if (scanRequest.swingEpsilon && spec.structure_config) {
        spec.structure_config.swing_epsilon_pct = scanRequest.swingEpsilon;
      }

      try {
        const semanticsMeta = semanticsMetaFromSpec(spec);
        const { candidates } = await runStrategyRunner(
          spec,
          scanRequest.symbol,
          timeframe,
          period,
          interval,
          'scan'
        );
        const classified = applyCandidateSemanticsList(candidates, semanticsMeta);
        const strictFiltered = filterStrictBaseCandidates(classified, strictBase, strictBaseMinScore);
        const filteredCandidates = reduceOnePerSymbolCandidates(strictFiltered, onePerSymbol);

        // Save candidates (unless skipSave)
        let ids: string[] = [];
        let responseCandidates = filteredCandidates;
        if (!scanRequest.skipSave) {
          const persisted = await persistCandidatesForResponse(filteredCandidates);
          ids = persisted.ids;
          responseCandidates = persisted.candidates;
        }

        res.json({
          success: true,
          data: {
            count: filteredCandidates.length,
            raw_count: candidates.length,
            filtered_out: Math.max(0, candidates.length - strictFiltered.length),
            deduped_out: Math.max(0, strictFiltered.length - filteredCandidates.length),
            strict_base_applied: strictBase,
            strict_base_min_score: strictBaseMinScore,
            one_per_symbol: onePerSymbol,
            ids,
            candidates: responseCandidates,
            strategy_version_id: spec.strategy_version_id,
            strategy_status: spec.status,
            strategy_name: spec.name
          }
        });
      } catch (err: any) {
        res.status(500).json({
          success: false,
          error: `StrategyRunner failed: ${err.message}`
        } as ApiResponse<null>);
      }

      return;
    }

    // Copilot / Trading Desk path: run generate_copilot_analysis from patternScanner.py
    if (scanMode === 'copilot') {
      const servicePath = path.join(__dirname, '..', '..', 'services');
      const escapedPath = servicePath.replace(/\\/g, '\\\\');
      const sym = normalizeMarketDataSymbol(scanRequest.symbol);
      const itvl = interval;
      const prd = period;
      const epsilon = typeof scanRequest.swingEpsilon === 'number' ? scanRequest.swingEpsilon : 0.05;
      const userDir = (scanRequest as any).tradeDirection || 'null';
      const userDirPy = userDir === 'null' ? 'None' : `"${userDir}"`;

      const pyScript = `
import sys, json
sys.path.insert(0, r"${escapedPath}")
from patternScanner import fetch_data_yfinance, generate_copilot_analysis
data = fetch_data_yfinance("${sym}", period="${prd}", interval="${itvl}") or []
result = generate_copilot_analysis(data, symbol="${sym}", timeframe="${timeframe}", epsilon_pct=${epsilon}, user_direction=${userDirPy})
print(json.dumps(result))
`.trim();

      return new Promise<void>((resolve) => {
        const py = spawn('py', ['-c', pyScript]);
        let stdout = '';
        let stderr = '';
        py.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        py.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        py.on('close', (code: number) => {
          if (code !== 0) {
            res.status(500).json({ success: false, error: stderr || `Copilot analysis failed (exit ${code})` } as ApiResponse<null>);
            return resolve();
          }
          try {
            const analysis = JSON.parse(stdout);
            res.json({ success: true, data: analysis });
          } catch (e: any) {
            res.status(500).json({ success: false, error: `Parse error: ${e.message}` } as ApiResponse<null>);
          }
          resolve();
        });
      });
    }

    // If we get here, no pluginId and no strategyId — nothing to scan
    return res.status(400).json({
      success: false,
      error: 'Must provide either pluginId or strategyVersionId/strategyId'
    } as ApiResponse<null>);
    
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/candidates/scan-batch
 * Run the scanner on multiple symbols using the StrategyRunner.
 * Accepts either a pluginId or strategyVersionId.
 */
router.post('/scan-batch', async (req: Request, res: Response) => {
  try {
    const { symbols, timeframe, period, interval, pluginId, strategyVersionId, scanScope, swingEpsilon } = req.body;
    const { strictBase, strictBaseMinScore } = parseStrictBaseRequest(req.body);
    const onePerSymbol = parseOnePerSymbolRequest(req.body);
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'symbols array is required'
      } as ApiResponse<null>);
    }
    if (symbols.length > MAX_BATCH_SCAN_SYMBOLS) {
      return res.status(400).json({
        success: false,
        error: `symbols array exceeds maximum size (${MAX_BATCH_SCAN_SYMBOLS})`
      } as ApiResponse<null>);
    }
    if (symbols.some((s: any) => !isValidSymbol(s))) {
      return res.status(400).json({
        success: false,
        error: 'symbols must all be valid symbol strings'
      } as ApiResponse<null>);
    }
    if (scanScope != null && !['production', 'research'].includes(scanScope)) {
      return res.status(400).json({
        success: false,
        error: "scanScope must be 'production' or 'research'"
      } as ApiResponse<null>);
    }
    
    const results: { symbol: string; count: number; error?: string }[] = [];
    let totalCandidates = 0;
    const allCandidates: StrategyCandidate[] = [];
    let batchSemanticsMeta: CandidateSemanticsMeta | null = null;

    // Resolve the spec once for the batch
    let batchSpec: StrategySpec | null = null;

    if (pluginId) {
      // Resolve plugin → auto-generate spec
      const resolved = await resolvePluginDefinition(pluginId);
      if (!resolved) {
        return res.status(404).json({
          success: false,
          error: `Plugin not found: ${pluginId}`
        } as ApiResponse<null>);
      }
      batchSpec = {
        strategy_id: `scan_${pluginId}`,
        strategy_version_id: `scan_${pluginId}_v1`,
        version: 1,
        status: 'draft',
        name: resolved.pattern?.name || pluginId,
        description: `Auto-generated batch spec for ${pluginId}`,
        interval: interval || '1wk',
        universe: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        structure_config: resolved.definition?.default_structure_config || {},
        setup_config: {
          ...(resolved.definition?.default_setup_params || {}),
          // Prefer setup default pattern_type if provided; fall back to definition/pattern id.
          pattern_type:
            resolved.definition?.default_setup_params?.pattern_type
            || resolved.definition?.pattern_type
            || pluginId,
          indicator_role: resolved.definition?.indicator_role || '',
        },
        entry_config: resolved.definition?.default_entry || { confirmation_bars: 1 },
        risk_config: { stop_type: 'fixed_pct', stop_level: 'entry', stop_buffer_pct: 0.02 },
        exit_config: { target_type: 'percentage', target_level: 0.1, time_stop_bars: null, trailing: null },
        cost_config: { commission_per_trade: 0, spread_pct: 0, slippage_pct: 0.001 }
      } as StrategySpec;
      batchSemanticsMeta = semanticsMetaFromDefinition(resolved.definition);
    } else if (strategyVersionId) {
      batchSpec = await resolveStrategy({
        symbol: '',
        strategyVersionId,
        scanScope: scanScope || 'production'
      });

      // Production gate
      if (batchSpec && (scanScope || 'production') === 'production') {
        if (batchSpec.status !== 'approved') {
          return res.status(403).json({
            success: false,
            error: `Production gate: Strategy ${batchSpec.strategy_version_id} is not approved (status: ${batchSpec.status}).`
          } as ApiResponse<null>);
        }
        const reports = await storage.getAllValidationReports(batchSpec.strategy_version_id);
        const latestReport = reports.length > 0 ? reports[0] : null;
        const hasPassingReport = latestReport
          && latestReport.pass_fail === 'PASS'
          && latestReport.decision_log?.decision === 'approved';
        if (!hasPassingReport) {
          return res.status(403).json({
            success: false,
            error: `Production gate: Strategy ${batchSpec.strategy_version_id} has no ValidationReport with PASS + APPROVED.`
          } as ApiResponse<null>);
        }
      }
      batchSemanticsMeta = semanticsMetaFromSpec(batchSpec);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Must provide either pluginId or strategyVersionId'
      } as ApiResponse<null>);
    }

    if (!batchSpec) {
      return res.status(404).json({
        success: false,
        error: 'Could not resolve scan spec'
      } as ApiResponse<null>);
    }

    // Apply request-level scan sensitivity override to whichever spec path was resolved.
    if (typeof swingEpsilon === 'number' && Number.isFinite(swingEpsilon)) {
      (batchSpec as any).structure_config = (batchSpec as any).structure_config || {};
      (batchSpec as any).structure_config.swing_epsilon_pct = swingEpsilon;
    }

    if (CANDIDATES_USE_PY_SERVICE) {
      try {
        await getPluginServiceHealth();
        const serviceBatch = await runScannerUniverseViaService(
          batchSpec,
          symbols,
          timeframe || 'W',
          period || 'max',
          interval || '1wk',
          'scan',
        );
        const serviceResults: { symbol: string; count: number; error?: string }[] = [];
        let serviceTotal = 0;
        for (const row of serviceBatch.results || []) {
          const rawCandidates = Array.isArray(row.candidates) ? row.candidates as StrategyCandidate[] : [];
          const classified = applyCandidateSemanticsList(rawCandidates, batchSemanticsMeta);
          const strictFiltered = filterStrictBaseCandidates(classified, strictBase, strictBaseMinScore);
          const rowCandidates = reduceOnePerSymbolCandidates(strictFiltered, onePerSymbol);
          if (rowCandidates.length > 0) {
            const persisted = await persistCandidatesForResponse(rowCandidates);
            allCandidates.push(...persisted.candidates);
          }
          const count = rowCandidates.length;
          serviceResults.push({ symbol: row.symbol, count, error: row.error });
          serviceTotal += count;
        }
        return res.json({
          success: true,
          data: {
            totalSymbols: serviceBatch.total_symbols || symbols.length,
            totalCandidates: serviceTotal,
            candidates: allCandidates,
            results: serviceResults,
          }
        });
      } catch (serviceErr: any) {
        console.warn(
          `[candidates] Python service unavailable for batch scan; falling back to spawn path: ${serviceErr?.message || serviceErr}`,
        );
      }
    }
    
    // Process each symbol sequentially via StrategyRunner
    for (const symbol of symbols) {
      try {
        const { candidates } = await runStrategyRunner(
          batchSpec,
          symbol,
          timeframe || 'W',
          period || 'max',
          interval || '1wk',
          'scan'
        );
        const classified = applyCandidateSemanticsList(candidates, batchSemanticsMeta);
        const strictFiltered = filterStrictBaseCandidates(classified, strictBase, strictBaseMinScore);
        const filteredCandidates = reduceOnePerSymbolCandidates(strictFiltered, onePerSymbol);
        const persisted = await persistCandidatesForResponse(filteredCandidates);
        allCandidates.push(...persisted.candidates);
        results.push({ symbol, count: filteredCandidates.length });
        totalCandidates += filteredCandidates.length;
      } catch (err: any) {
        results.push({ symbol, count: 0, error: err.message });
      }
      console.log(`[Batch Scan] ${symbol}: ${results[results.length - 1].count} candidates`);
    }
    
    res.json({
      success: true,
      data: {
        totalSymbols: symbols.length,
        totalCandidates,
        candidates: allCandidates,
        results
      }
    });
    
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/candidates/scan-batch/start
 * Start an async batch scan job and return job_id immediately.
 * Frontend polls /scan-batch/job/:jobId for real progress.
 */
router.post('/scan-batch/start', async (req: Request, res: Response) => {
  try {
    cleanupOrphanBatchJobs();
    const { symbols, timeframe, period, interval, pluginId, strategyVersionId, scanScope, swingEpsilon } = req.body || {};
    const { strictBase, strictBaseMinScore } = parseStrictBaseRequest(req.body || {});
    const onePerSymbol = parseOnePerSymbolRequest(req.body || {});

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ success: false, error: 'symbols array is required' } as ApiResponse<null>);
    }
    if (symbols.length > MAX_BATCH_SCAN_SYMBOLS) {
      return res.status(400).json({ success: false, error: `symbols array exceeds maximum size (${MAX_BATCH_SCAN_SYMBOLS})` } as ApiResponse<null>);
    }
    if (symbols.some((s: any) => !isValidSymbol(s))) {
      return res.status(400).json({ success: false, error: 'symbols must all be valid symbol strings' } as ApiResponse<null>);
    }
    if (scanScope != null && !['production', 'research'].includes(scanScope)) {
      return res.status(400).json({ success: false, error: "scanScope must be 'production' or 'research'" } as ApiResponse<null>);
    }
    if (!pluginId && !strategyVersionId) {
      return res.status(400).json({ success: false, error: 'Must provide either pluginId or strategyVersionId' } as ApiResponse<null>);
    }

    const normalizedSymbols = symbols.map((s: any) => String(s).trim().toUpperCase());
    const jobId = makeBatchScanJobId();
    const job: BatchScanJob = {
      job_id: jobId,
      status: 'queued',
      progress: 0,
      stage: 'queued',
      detail: `Queued batch scan (${normalizedSymbols.length} symbols)`,
      created_at: new Date().toISOString(),
      total_symbols: normalizedSymbols.length,
      completed_symbols: 0,
      total_candidates: 0,
      request: {
        symbols: normalizedSymbols,
        timeframe,
        period,
        interval,
        pluginId,
        strategyVersionId,
        scanScope: scanScope || 'research',
        strictBase,
        strictBaseMinScore,
        onePerSymbol,
      },
    };

    batchScanJobs.set(jobId, job);
    pruneBatchScanJobs();

    setImmediate(async () => {
      const live = batchScanJobs.get(jobId);
      if (!live) return;

      if (live.cancel_requested || live.status === 'cancelled') {
        live.status = 'cancelled';
        live.stage = 'cancelled';
        live.detail = 'Cancelled before scan started';
        live.completed_at = new Date().toISOString();
        return;
      }

      live.status = 'running';
      live.stage = 'resolving_spec';
      live.progress = 0.02;
      live.started_at = new Date().toISOString();

      try {
        let batchSpec: StrategySpec | null = null;
        let batchSemanticsMeta: CandidateSemanticsMeta | null = null;

        if (pluginId) {
          const resolved = await resolvePluginDefinition(String(pluginId));
          if (!resolved) {
            throw new Error(`Plugin not found: ${pluginId}`);
          }
          batchSpec = {
            strategy_id: `scan_${pluginId}`,
            strategy_version_id: `scan_${pluginId}_v1`,
            version: 1,
            status: 'draft',
            name: resolved.pattern?.name || pluginId,
            description: `Auto-generated batch spec for ${pluginId}`,
            interval: interval || '1wk',
            universe: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            structure_config: resolved.definition?.default_structure_config || {},
            setup_config: {
              ...(resolved.definition?.default_setup_params || {}),
              pattern_type:
                resolved.definition?.default_setup_params?.pattern_type
                || resolved.definition?.pattern_type
                || pluginId,
              indicator_role: resolved.definition?.indicator_role || '',
            },
            entry_config: resolved.definition?.default_entry || { confirmation_bars: 1 },
            risk_config: { stop_type: 'fixed_pct', stop_level: 'entry', stop_buffer_pct: 0.02 },
            exit_config: { target_type: 'percentage', target_level: 0.1, time_stop_bars: null, trailing: null },
            cost_config: { commission_per_trade: 0, spread_pct: 0, slippage_pct: 0.001 },
          } as StrategySpec;
          batchSemanticsMeta = semanticsMetaFromDefinition(resolved.definition);
        } else {
          batchSpec = await resolveStrategy({
            symbol: '',
            strategyVersionId: String(strategyVersionId),
            scanScope: (scanScope || 'production') as any,
          });
          if (!batchSpec) {
            throw new Error(`Strategy not found: ${strategyVersionId}`);
          }

          if ((scanScope || 'production') === 'production') {
            if (batchSpec.status !== 'approved') {
              throw new Error(`Production gate: Strategy ${batchSpec.strategy_version_id} is not approved (status: ${batchSpec.status}).`);
            }
            const reports = await storage.getAllValidationReports(batchSpec.strategy_version_id);
            const latestReport = reports.length > 0 ? reports[0] : null;
            const hasPassingReport = latestReport
              && latestReport.pass_fail === 'PASS'
              && latestReport.decision_log?.decision === 'approved';
            if (!hasPassingReport) {
              throw new Error(`Production gate: Strategy ${batchSpec.strategy_version_id} has no ValidationReport with PASS + APPROVED.`);
            }
          }
          batchSemanticsMeta = semanticsMetaFromSpec(batchSpec);
        }

        if (typeof swingEpsilon === 'number' && Number.isFinite(swingEpsilon)) {
          (batchSpec as any).structure_config = (batchSpec as any).structure_config || {};
          (batchSpec as any).structure_config.swing_epsilon_pct = swingEpsilon;
        }

        const results: { symbol: string; count: number; error?: string }[] = [];
        const allCandidates: StrategyCandidate[] = [];
        live.stage = 'scanning';
        live.result = {
          totalSymbols: normalizedSymbols.length,
          totalCandidates: 0,
          candidates: [],
          results: [],
        };

        for (let i = 0; i < normalizedSymbols.length; i += 1) {
          if (live.cancel_requested) {
            live.status = 'cancelled';
            live.stage = 'cancelled';
            live.detail = `Cancelled at ${live.completed_symbols}/${live.total_symbols} symbols`;
            live.completed_at = new Date().toISOString();
            live.result = {
              totalSymbols: normalizedSymbols.length,
              totalCandidates: live.total_candidates,
              candidates: allCandidates,
              results,
            };
            return;
          }

          const symbol = normalizedSymbols[i];
          live.detail = `Scanning ${symbol} (${i + 1}/${normalizedSymbols.length})`;
          try {
            const { candidates } = await runStrategyRunner(
              batchSpec,
              symbol,
              timeframe || 'W',
              period || 'max',
              interval || '1wk',
              'scan'
            );
            const classified = applyCandidateSemanticsList(candidates, batchSemanticsMeta);
            const strictFiltered = filterStrictBaseCandidates(classified, strictBase, strictBaseMinScore);
            const filteredCandidates = reduceOnePerSymbolCandidates(strictFiltered, onePerSymbol);
            const persisted = await persistCandidatesForResponse(filteredCandidates);
            allCandidates.push(...persisted.candidates);
            results.push({ symbol, count: filteredCandidates.length });
            live.total_candidates += filteredCandidates.length;
          } catch (err: any) {
            results.push({ symbol, count: 0, error: err?.message || 'Scan failed' });
          }

          live.completed_symbols = i + 1;
          live.progress = Math.max(live.progress, Math.min(0.98, live.completed_symbols / live.total_symbols));
          live.result = {
            totalSymbols: normalizedSymbols.length,
            totalCandidates: live.total_candidates,
            candidates: allCandidates,
            results,
          };
        }

        live.status = 'completed';
        live.stage = 'completed';
        live.detail = `Completed ${live.completed_symbols}/${live.total_symbols} symbols`;
        live.progress = 1;
        live.completed_at = new Date().toISOString();
        live.result = {
          totalSymbols: normalizedSymbols.length,
          totalCandidates: live.total_candidates,
          candidates: allCandidates,
          results,
        };
      } catch (error: any) {
        if (live.cancel_requested) {
          live.status = 'cancelled';
          live.stage = 'cancelled';
          live.completed_at = new Date().toISOString();
          live.error = undefined;
          return;
        }
        live.status = 'failed';
        live.stage = 'failed';
        live.progress = 1;
        live.completed_at = new Date().toISOString();
        live.error = error?.message || 'Batch scan job failed';
      }
    });

    res.json({
      success: true,
      data: {
        job_id: jobId,
        status: 'queued',
        total_symbols: normalizedSymbols.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/candidates/scan-batch/job/:jobId/cancel
 * Request cancellation of an async batch scan job.
 */
router.post('/scan-batch/job/:jobId/cancel', async (req: Request, res: Response) => {
  const job = batchScanJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Scan job not found' } as ApiResponse<null>);
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return res.json({ success: true, data: job });
  }

  job.cancel_requested = true;
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.detail = 'Cancelled before start';
    job.completed_at = new Date().toISOString();
  } else if (job.status === 'running') {
    job.stage = 'cancelling';
    job.detail = `Cancelling at ${job.completed_symbols}/${job.total_symbols} symbols...`;
  }

  return res.json({ success: true, data: job });
});

/**
 * GET /api/candidates/scan-batch/jobs
 * List batch scan jobs with orphan detection metadata.
 */
router.get('/scan-batch/jobs', async (_req: Request, res: Response) => {
  const nowMs = Date.now();
  cleanupOrphanBatchJobs(nowMs);
  const jobs = Array.from(batchScanJobs.values())
    .map((job) => {
      const orphanMeta = detectScanOrphan(job, nowMs);
      return {
        job_id: job.job_id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        detail: job.detail,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        total_symbols: job.total_symbols,
        completed_symbols: job.completed_symbols,
        total_candidates: job.total_candidates,
        cancel_requested: !!job.cancel_requested,
        orphan: orphanMeta.orphan,
        orphan_reason: orphanMeta.reason || undefined,
        age_minutes: Math.round(orphanMeta.ageMinutes * 10) / 10,
      };
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const counts = jobs.reduce(
    (acc, j) => {
      acc.total += 1;
      acc[j.status] = (acc[j.status] || 0) + 1;
      if (j.orphan) acc.orphan += 1;
      return acc;
    },
    { total: 0, orphan: 0, queued: 0, running: 0, cancelled: 0, completed: 0, failed: 0 } as Record<string, number>,
  );

  res.json({
    success: true,
    data: {
      counts,
      orphan_threshold_minutes: ORPHAN_SCAN_MINUTES,
      jobs,
    },
  });
});

/**
 * GET /api/candidates/scan-batch/job/:jobId
 * Poll scanner batch job progress and final results.
 */
router.get('/scan-batch/job/:jobId', async (req: Request, res: Response) => {
  const job = batchScanJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Scan job not found' } as ApiResponse<null>);
  }
  res.json({ success: true, data: job });
});

/**
 * DELETE /api/candidates
 * Clear all candidates (for testing)
 */
router.delete('/', async (req: Request, res: Response) => {
  try {
    await storage.clearCandidates();
    
    res.json({
      success: true,
      data: { message: 'All candidates cleared' }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

// ====== Discount Zone Endpoints ======

/**
 * POST /api/candidates/discount-label
 * Label a discount candidate as good/bad
 */
router.post('/discount-label', async (req: Request, res: Response) => {
  try {
    const { symbol, timeframe, label } = req.body;
    
    if (!symbol || !label) {
      return res.status(400).json({
        success: false,
        error: 'symbol and label are required'
      } as ApiResponse<null>);
    }
    
    const updated = await storage.updateDiscountLabel(
      symbol,
      timeframe || 'W',
      label
    );
    
    if (updated) {
      res.json({
        success: true,
        data: { symbol, timeframe: timeframe || 'W', label }
      });
    } else {
      res.status(404).json({
        success: false,
        error: `Discount candidate not found: ${symbol}`
      } as ApiResponse<null>);
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/candidates/discount-save
 * Save/update a discount candidate (used to persist Wyckoff enrichment)
 */
router.post('/discount-save', async (req: Request, res: Response) => {
  try {
    const candidate = req.body;
    if (!candidate || !candidate.symbol) {
      return res.status(400).json({
        success: false,
        error: 'candidate with symbol is required'
      } as ApiResponse<null>);
    }
    
    await storage.saveDiscountCandidate(candidate);
    res.json({
      success: true,
      data: { symbol: candidate.symbol }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * DELETE /api/candidates/discount
 * Clear all discount candidates
 */
router.delete('/discount', async (req: Request, res: Response) => {
  try {
    await storage.clearDiscountCandidates();
    res.json({
      success: true,
      data: { message: 'All discount candidates cleared' }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

export default router;
