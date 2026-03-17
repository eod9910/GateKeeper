/**
 * Validator API Routes
 *
 * Real backtest + robustness pipeline with async job tracking.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as storage from '../services/storageService';
import { ApiResponse, StrategySpec, StrategyAssetClass, ValidationReport, TradeInstance, ValidatorComparisonDiagnostics } from '../types';
import { applyParameterManifest } from '../services/parameterManifest';
import {
  getPluginServiceHealth,
  isPyServiceEnabled,
  runValidatorPipelineViaService,
  cancelValidatorJobOnService,
} from '../services/pluginServiceClient';
import { buildValidatorComparisonDiagnostics } from '../services/validatorComparisonService';

const router = Router();

/**
 * Kill a child process and its entire process tree.
 * On Windows, `proc.kill()` only kills the launcher (e.g. `py.exe`) and leaves
 * the spawned `python.exe` child running.  `taskkill /F /T` fixes that.
 */
function killProcessTree(proc: ChildProcess): void {
  if (proc.pid == null) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } catch {
      proc.kill(); // fallback
    }
  } else {
    try {
      process.kill(-proc.pid, 'SIGKILL'); // kill process group
    } catch {
      proc.kill('SIGKILL');
    }
  }
}

// =====================
// Job Tracking (in-memory)
// =====================

type RunJobStatus = 'queued' | 'running' | 'completed' | 'failed';

interface RunJob {
  job_id: string;
  status: RunJobStatus;
  strategy_version_id: string;
  tier?: 'tier1' | 'tier1b' | 'tier2' | 'tier3';
  asset_class?: StrategyAssetClass;
  interval?: string;
  date_start?: string;
  date_end?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  progress: number;
  stage?: string;
  detail?: string;
  elapsed_sec?: number;
  timeout_sec?: number;
  eta_seconds?: number;
  eta_display?: string;
  warning?: string;
  report_id?: string;
  error?: string;
}

interface PipelineProgressEvent {
  progress: number;
  stage: string;
  detail?: string;
  eta_seconds?: number;
  eta_display?: string;
}

const runJobs = new Map<string, RunJob>();
const activeProcesses = new Map<string, ChildProcess>();
/** AbortControllers for in-flight HTTP requests to the Python service (service-path cancellation). */
const activeAbortControllers = new Map<string, AbortController>();
const JOBS_FILE = path.join(__dirname, '..', '..', 'data', 'validator-run-jobs.json');
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.VALIDATOR_MAX_CONCURRENT_RUNS || 2));
const PIPELINE_BASE_TIMEOUT_MS = Math.max(60_000, Number(process.env.VALIDATOR_PIPELINE_TIMEOUT_MS || 10 * 60_000));
const VALIDATOR_USE_PY_SERVICE = isPyServiceEnabled();
type ValidationTier = 'tier1' | 'tier1b' | 'tier2' | 'tier3';
const VALIDATION_TIER_KEYS: ValidationTier[] = ['tier1', 'tier1b', 'tier2', 'tier3'];
const ASSET_CLASSES: StrategyAssetClass[] = ['futures', 'stocks', 'options', 'forex', 'crypto'];
const OPTIONABLE_UNIVERSE_FILE = path.join(__dirname, '..', '..', 'data', 'universe', 'optionable.json');
const STOCKS_TIER1B_TARGET_SYMBOLS = Math.max(150, Number(process.env.VALIDATOR_TIER1B_STOCKS_TARGET_SYMBOLS || 250));
const VALIDATION_TIER_UNIVERSES: Record<StrategyAssetClass, Record<ValidationTier, string[]>> = {
  futures: {
    tier1: ['ES=F', 'NQ=F', 'CL=F'],
    tier1b: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier2: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier3: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F', 'SI=F', 'NG=F', 'HG=F', '6E=F'],
  },
  stocks: {
    // TIER 1 — Kill Test (50 stocks, stratified random sample)
    // One representative from each sector group, proportional to universe composition.
    // Goal: fast falsification with 200-300 trade target. Run time: minutes.
    tier1: [
      // Biotech/Pharma (9 — 18% of universe)
      'APLS','ARWR','BEAM','HALO','INSM','KRTX','PRCT','RVMD','IOVA',
      // SaaS/Enterprise Tech (10 — 20%)
      'ANET','ALRM','BRZE','CALX','CRDO','DDOG','ESTC','JAMF','NTNX','SMCI',
      // Consumer/Restaurant/Retail (7 — 14%)
      'BROS','CAVA','CROX','DNUT','FIGS','SHAK','WRBY',
      // Fintech/Lending (6 — 12%)
      'AFRM','BILL','HOOD','SOFI','TOST','UPST',
      // Clean Energy/Solar (5 — 10%)
      'ARRY','ENPH','RUN','SEDG','SHLS',
      // Space/Defense/Quantum (5 — 10%)
      'ASTS','IONQ','JOBY','LUNR','RKLB',
      // Metals/Mining/Critical Materials (4 — 8%)
      'AG','CCJ','MP','PAAS',
      // Industrials/Infrastructure (2 — 4%)
      'BWXT','POWL',
      // Crypto/Digital Assets (2 — 4%)
      'MARA','RIOT',
    ],
    tier1b: [
      'IWM','SPY','QQQ','XLK','XLF','XLE','XLI','XLV','XLY','XLB',
      'APLS','ARWR','BEAM','HALO','INSM','KRTX','PRCT','RVMD','IOVA',
      'CRNX','DVAX','FATE','IMVT','MNKD','NARI','PCVX','SDGR','TGTX','TMDX','VRNA',
      'ANET','ALRM','BRZE','CALX','CRDO','DDOG','ESTC','JAMF','NTNX','SMCI',
      'CWAN','DCBO','EVCM','FLYW','GENI','PAYO','TBLA',
      'BROS','CAVA','CROX','DNUT','FIGS','SHAK','WRBY',
      'AEO','ARKO','JACK','LOCO','PRPL',
      'AFRM','BILL','HOOD','SOFI','TOST','UPST',
      'COIN','LPRO','OPEN','PSFE','RELY',
      'ARRY','ENPH','RUN','SEDG','SHLS',
      'FLNC','MAXN','NOVA','SPWR',
      'ASTS','IONQ','JOBY','LUNR','RKLB',
      'ACHR','AEHR','BKSY','RGTI',
      'AG','CCJ','MP','PAAS',
      'AMR','HCC','IAUX','LAC','NXE','UUUU',
      'BWXT','POWL','ARIS','CSWI','ROAD',
      'MARA','RIOT','BTBT','CIFR','CLSK','IREN','WULF',
      'VERX','ARLO','TASK','RAMP','PUBM','SEMR','WEAV','INOD',
      'KNBE','PRCH','COMP','SGHC','OUST','CXAI','ADPT','VNET','INTA',
      'CORT','PGNY','RCKT','NUVB','KRYS','ACCD','CPRX','TYRA','IRMD',
      'GPCR','VERA','RVNC','RLAY','DAWN','IDYA','SNDX','XNCR','ACLX',
      'VSCO','BIRD','XPOF','LESL','COOK',
      'SHCO','GOOS','DTC','LOVE','FLXS','XMTR','PLYA','EVRI','PTLO',
      'STEM','OPAL','GNE','KRNT','NNOX',
      'GTLS','ENVX','AMSC','WLDN','PRIM',
      'STEP','HASI','ALIT','UWMC','RKT','GHLD',
      'LILM','EVTL','RDW','MNTS','SATL',
      'GATO','PLL','ORGN','DNN','MAG',
      'VUZI','BFLY','SSYS','DM','MKFG',
    ],
    // TIER 2 — Core Validation (100 stocks = Tier 1 + 50 more, stratified)
    // Adds out-of-sample split, walk-forward, Monte Carlo, parameter sensitivity.
    // Goal: 500-1000 trade target. Requires Tier 1 PASS.
    tier2: [
      // === Tier 1 stocks (50) ===
      'APLS','ARWR','BEAM','HALO','INSM','KRTX','PRCT','RVMD','IOVA',
      'ANET','ALRM','BRZE','CALX','CRDO','DDOG','ESTC','JAMF','NTNX','SMCI',
      'BROS','CAVA','CROX','DNUT','FIGS','SHAK','WRBY',
      'AFRM','BILL','HOOD','SOFI','TOST','UPST',
      'ARRY','ENPH','RUN','SEDG','SHLS',
      'ASTS','IONQ','JOBY','LUNR','RKLB',
      'AG','CCJ','MP','PAAS',
      'BWXT','POWL',
      'MARA','RIOT',
      // === Tier 2 additions (50) ===
      // Additional Biotech/Pharma (11)
      'CRNX','DVAX','FATE','IMVT','MNKD','NARI','PCVX','SDGR','TGTX','TMDX','VRNA',
      // Additional SaaS/Tech (7)
      'CWAN','DCBO','EVCM','FLYW','GENI','PAYO','TBLA',
      // Additional Consumer (5)
      'AEO','ARKO','JACK','LOCO','PRPL',
      // Additional Fintech (5)
      'COIN','LPRO','OPEN','PSFE','RELY',
      // Additional Clean Energy (4)
      'FLNC','MAXN','NOVA','SPWR',
      // Additional Space/Defense/Quantum (4)
      'ACHR','AEHR','BKSY','RGTI',
      // Additional Metals/Mining (6)
      'AMR','HCC','IAUX','LAC','NXE','UUUU',
      // Additional Industrials (3)
      'ARIS','CSWI','ROAD',
      // Additional Crypto (5)
      'BTBT','CIFR','CLSK','IREN','WULF',
    ],
    // TIER 3 — Robustness (all 180 stocks + sector ETFs)
    // Full universe stress test. Requires Tier 2 PASS.
    // Goal: 800+ trade target across full market breadth.
    tier3: [
      // Sector ETFs (diversification anchors)
      'IWM','SPY','QQQ','XLK','XLF','XLE','XLI','XLV','XLY','XLB',
      // === All 100 Tier 2 stocks ===
      'APLS','ARWR','BEAM','HALO','INSM','KRTX','PRCT','RVMD','IOVA',
      'CRNX','DVAX','FATE','IMVT','MNKD','NARI','PCVX','SDGR','TGTX','TMDX','VRNA',
      'ANET','ALRM','BRZE','CALX','CRDO','DDOG','ESTC','JAMF','NTNX','SMCI',
      'CWAN','DCBO','EVCM','FLYW','GENI','PAYO','TBLA',
      'BROS','CAVA','CROX','DNUT','FIGS','SHAK','WRBY',
      'AEO','ARKO','JACK','LOCO','PRPL',
      'AFRM','BILL','HOOD','SOFI','TOST','UPST',
      'COIN','LPRO','OPEN','PSFE','RELY',
      'ARRY','ENPH','RUN','SEDG','SHLS',
      'FLNC','MAXN','NOVA','SPWR',
      'ASTS','IONQ','JOBY','LUNR','RKLB',
      'ACHR','AEHR','BKSY','RGTI',
      'AG','CCJ','MP','PAAS',
      'AMR','HCC','IAUX','LAC','NXE','UUUU',
      'BWXT','POWL','ARIS','CSWI','ROAD',
      'MARA','RIOT','BTBT','CIFR','CLSK','IREN','WULF',
      // === Tier 3 additional stocks (remaining 80 from full universe) ===
      // SaaS/Tech (remaining)
      'VERX','ARLO','TASK','RAMP','PUBM','SEMR','WEAV','INOD',
      'KNBE','PRCH','COMP','SGHC','OUST','CXAI','ADPT','VNET','INTA',
      // Biotech/Pharma (remaining)
      'CORT','PGNY','RCKT','NUVB','KRYS','ACCD','CPRX','TYRA','IRMD',
      'GPCR','VERA','RVNC','RLAY','DAWN','IDYA','SNDX','XNCR','ACLX',
      // Consumer/Retail (remaining)
      'VSCO','BIRD','XPOF','LESL','COOK',
      'SHCO','GOOS','DTC','LOVE','FLXS','XMTR','PLYA','EVRI','PTLO',
      // Clean Energy (remaining)
      'STEM','OPAL','GNE','KRNT','NNOX',
      // Industrials/Infrastructure (remaining)
      'GTLS','ENVX','AMSC','WLDN','PRIM',
      // Fintech (remaining)
      'STEP','HASI','ALIT','UWMC','RKT','GHLD',
      // Space/Defense (remaining)
      'LILM','EVTL','RDW','MNTS','SATL',
      // Materials/Mining (remaining)
      'GATO','PLL','ORGN','DNN','MAG',
      // Hardware/Robotics/Other Tech (remaining)
      'VUZI','BFLY','SSYS','DM','MKFG',
    ],
  },
  options: {
    tier1: ['SPY', 'QQQ'],
    tier1b: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier2: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier3: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'IWM', 'TLT'],
  },
  forex: {
    tier1: ['EURUSD=X', 'GBPUSD=X'],
    tier1b: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier2: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier3: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X', 'NZDUSD=X'],
  },
  crypto: {
    tier1: ['BTC-USD', 'ETH-USD'],
    tier1b: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier2: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier3: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD'],
  },
};
const VALIDATION_TIER_LABELS: Record<ValidationTier, string> = {
  tier1: 'Tier 1 - Kill Test',
  tier1b: 'Tier 1B - Evidence Expansion',
  tier2: 'Tier 2 - Core Validation',
  tier3: 'Tier 3 - Robustness',
};
const VALIDATION_TIER_DESCRIPTIONS: Record<ValidationTier, string> = {
  tier1: 'Fast kill test on a fixed Tier 1 universe. Target evidence: 200-300 trades.',
  tier1b: 'Evidence expansion on a deterministic slice of the full optionable stock universe. Use this when Tier 1 quality looks good but sample size is thin.',
  tier2: 'Core validation on a fixed Tier 2 universe. Target evidence: 500-1500 trades. Requires Tier 1 PASS.',
  tier3: 'Robustness validation on a fixed Tier 3 universe. Stress tests for survivors. Requires Tier 2 PASS.',
};

let optionableStocksUniverseCache: string[] | null = null;

function normalizeUniverseSymbols(input: any): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    const symbol = String(value || '').trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9._\-=^]{1,15}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function buildDeterministicUniverseSlice(symbols: string[], targetCount: number): string[] {
  if (!Array.isArray(symbols) || symbols.length <= targetCount) return symbols.slice();
  const out: string[] = [];
  const seen = new Set<string>();
  const step = symbols.length / targetCount;
  for (let i = 0; i < targetCount; i += 1) {
    let idx = Math.min(symbols.length - 1, Math.floor(i * step));
    while (idx < symbols.length && seen.has(symbols[idx])) {
      idx += 1;
    }
    if (idx >= symbols.length) break;
    seen.add(symbols[idx]);
    out.push(symbols[idx]);
  }
  return out;
}

async function loadOptionableStocksTier1BUniverse(): Promise<string[]> {
  if (optionableStocksUniverseCache && optionableStocksUniverseCache.length > 0) {
    return optionableStocksUniverseCache.slice();
  }
  try {
    const raw = await fs.readFile(OPTIONABLE_UNIVERSE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const optionable = normalizeUniverseSymbols(parsed?.optionable || parsed?.symbols || []);
    const sampled = buildDeterministicUniverseSlice(optionable, STOCKS_TIER1B_TARGET_SYMBOLS);
    if (sampled.length > 0) {
      optionableStocksUniverseCache = sampled;
      return sampled.slice();
    }
  } catch {
    // Fall through to the static fallback below.
  }
  optionableStocksUniverseCache = VALIDATION_TIER_UNIVERSES.stocks.tier1b.slice();
  return optionableStocksUniverseCache.slice();
}
// Scale timeout by tier: Tier 1 is intentionally faster, Tier 2/3 include robustness.
// Per-symbol budget is 30s to account for RDP computation (~22s actual).
// After Numba (Phase 1D), these will be way more than enough.
function pipelineTimeoutMs(symbolCount: number, tier: ValidationTier = 'tier2'): number {
  const perSymbol = 30_000 * Math.max(1, symbolCount);
  const multiplierByTier: Record<ValidationTier, number> = {
    tier1: 2,   // ~20 min for 50 symbols (was cutting off at 18m)
    tier1b: 2,  // evidence expansion still uses baseline-only runtime
    tier2: 3,   // ~2.5 hours for 106 symbols
    tier3: 3,   // ~2.5 hours for 190 symbols
  };
  return PIPELINE_BASE_TIMEOUT_MS + perSymbol * multiplierByTier[tier];
}

async function loadRunJobs(): Promise<void> {
  try {
    const raw = await fs.readFile(JOBS_FILE, 'utf-8');
    const arr = JSON.parse(raw) as RunJob[];
    const now = Date.now();
    let mutated = false;
    for (const j of arr) {
      if (j.status === 'running' || j.status === 'queued') {
        // Any job still marked running/queued at startup is definitely dead —
        // the process that was executing it no longer exists.
        j.status = 'failed';
        j.progress = 1;
        j.stage = 'failed';
        j.warning = undefined;
        j.error = j.error || 'Recovered stale job after server restart.';
        j.completed_at = new Date(now).toISOString();
        mutated = true;
      }
      runJobs.set(j.job_id, j);
    }
    if (mutated) {
      await persistRunJobs();
    }
  } catch {
    // no-op: first boot or malformed file
  }
}

async function persistRunJobs(): Promise<void> {
  try {
    const all = Array.from(runJobs.values()).sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    await fs.writeFile(JOBS_FILE, JSON.stringify(all, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[validator] failed to persist run jobs:', (err as Error).message);
  }
}

void loadRunJobs();

// =====================
// Helpers
// =====================

function isValidDateString(s: any): boolean {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

function isValidSymbol(s: string): boolean {
  return /^[A-Z0-9._\-=^]{1,15}$/.test(s);
}

function parseUniverse(input: any): string[] | null {
  if (input == null) return null;
  if (!Array.isArray(input)) return null;
  const arr = input
    .map((x) => String(x || '').trim().toUpperCase())
    .filter(Boolean);
  if (arr.length === 0) return [];
  if (arr.length > 500) return null;
  if (arr.some((s) => !isValidSymbol(s))) return null;
  return arr;
}

function parseValidationTier(input: any): ValidationTier | null {
  if (input == null) return null;
  const key = String(input).trim().toLowerCase();
  if (key === 'tier1' || key === 'tier1b' || key === 'tier2' || key === 'tier3') {
    return key;
  }
  return null;
}

function parseAssetClass(input: any): StrategyAssetClass | null {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  return ASSET_CLASSES.includes(key as StrategyAssetClass) ? (key as StrategyAssetClass) : null;
}

const VALIDATION_INTERVALS = new Set([
  '1m', '2m', '5m', '15m', '30m', '60m', '90m',
  '1h', '4h', '1d', '5d', '1wk', '1mo', '3mo',
]);

function parseValidationInterval(input: any): string | null {
  if (input == null) return null;
  const key = String(input).trim().toLowerCase();
  if (!key) return null;
  return VALIDATION_INTERVALS.has(key) ? key : null;
}

function inferAssetClassFromUniverse(universe: any): StrategyAssetClass {
  const symbols = Array.isArray(universe)
    ? universe.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
    : [];
  if (symbols.some((s) => s.endsWith('-USD'))) return 'crypto';
  if (symbols.some((s) => s.endsWith('=X'))) return 'forex';
  if (symbols.some((s) => s.includes('=F'))) return 'futures';
  return 'stocks';
}

function resolveStrategyAssetClass(strategy: StrategySpec): StrategyAssetClass {
  const parsed = parseAssetClass((strategy as any)?.asset_class);
  if (parsed) return parsed;
  return inferAssetClassFromUniverse((strategy as any)?.universe);
}

function resolveReportAssetClass(report: any): StrategyAssetClass {
  const parsed = parseAssetClass(report?.config?.asset_class);
  if (parsed) return parsed;
  return inferAssetClassFromUniverse(report?.config?.universe);
}

async function getValidationTierUniverse(assetClass: StrategyAssetClass, tier: ValidationTier): Promise<string[]> {
  if (assetClass === 'stocks' && tier === 'tier1b') {
    return loadOptionableStocksTier1BUniverse();
  }
  const byClass = VALIDATION_TIER_UNIVERSES[assetClass] || VALIDATION_TIER_UNIVERSES.stocks;
  return (byClass[tier] || VALIDATION_TIER_UNIVERSES.stocks[tier] || []).slice();
}

async function buildTierConfigPayload(assetClass: StrategyAssetClass): Promise<Record<string, any>> {
  const data: Record<string, any> = {
    asset_class: assetClass,
    tiers: {},
  };
  const keys: ValidationTier[] = VALIDATION_TIER_KEYS.slice();
  for (const key of keys) {
    data.tiers[key] = {
      key,
      label: VALIDATION_TIER_LABELS[key],
      description: VALIDATION_TIER_DESCRIPTIONS[key],
      symbols: await getValidationTierUniverse(assetClass, key),
    };
  }
  return data;
}

function latestTierReport(reports: any[], tierKey: ValidationTier, assetClass: StrategyAssetClass): any | null {
  const matching = (Array.isArray(reports) ? reports : []).filter((r: any) =>
    r?.config?.validation_tier === tierKey && resolveReportAssetClass(r) === assetClass
  );
  if (matching.length === 0) return null;
  matching.sort((a: any, b: any) => {
    const aTs = new Date(a?.created_at || 0).getTime();
    const bTs = new Date(b?.created_at || 0).getTime();
    return bTs - aTs;
  });
  return matching[0] || null;
}

function isTier1EvidenceExpansionEligible(report: any): boolean {
  if (!report) return false;
  if (report?.pass_fail === 'NEEDS_REVIEW') return true;
  if (report?.pass_fail !== 'FAIL') return false;
  const reasons = Array.isArray(report?.pass_fail_reasons) ? report.pass_fail_reasons : [];
  return reasons.length > 0 && reasons.every((reason: any) => /too few trades/i.test(String(reason || '')));
}

function validateStrategyPayload(input: any): string | null {
  if (!input || typeof input !== 'object') return 'strategy payload must be an object';
  if (!input.strategy_id || typeof input.strategy_id !== 'string') return 'strategy_id is required';
  if (!input.name || typeof input.name !== 'string') return 'name is required';
  if (input.version != null && Number.isNaN(Number(input.version))) return 'version must be numeric';
  if (input.interval != null && typeof input.interval !== 'string') return 'interval must be a string';
  if (input.universe != null && parseUniverse(input.universe) === null) return 'universe must be an array of valid symbols';
  if (input.status != null && !['draft', 'testing', 'approved', 'rejected'].includes(input.status)) {
    return 'status must be one of: draft, testing, approved, rejected';
  }
  return null;
}

async function runValidatorPipeline(
  strategy: StrategySpec,
  dateStart: string,
  dateEnd: string,
  universe?: string[],
  tier?: ValidationTier,
  onProgress?: (evt: PipelineProgressEvent) => void,
  jobId?: string,
): Promise<{ report: ValidationReport; trades: TradeInstance[] }> {
  return new Promise(async (resolve, reject) => {
    if (VALIDATOR_USE_PY_SERVICE) {
      const abortController = new AbortController();
      if (jobId) activeAbortControllers.set(jobId, abortController);
      try {
        onProgress?.({
          progress: 0.05,
          stage: 'routing_python_service',
          detail: 'Routing validator run through persistent Python service...',
        });
        await getPluginServiceHealth();
        const result = await runValidatorPipelineViaService(
          strategy,
          dateStart,
          dateEnd,
          universe,
          tier || 'tier3',
          abortController.signal,
          onProgress,
        );
        onProgress?.({
          progress: 0.98,
          stage: 'finalizing_report',
          detail: 'Python service completed. Finalizing report...',
        });
        if (jobId) activeAbortControllers.delete(jobId);
        resolve(result);
        return;
      } catch (serviceErr: any) {
        if (jobId) activeAbortControllers.delete(jobId);
        if ((serviceErr as any)?.name === 'AbortError') {
          reject(new Error('Validation cancelled by user'));
          return;
        }
        console.warn(
          `[validator] Python service unavailable, falling back to spawn path: ${serviceErr?.message || serviceErr}`,
        );
      }
    }

    const runnerPath = path.join(__dirname, '..', '..', 'services', 'validatorPipeline.py');

    const tmpDir = path.join(__dirname, '..', '..', 'data');
    const tmpFile = path.join(tmpDir, `_tmp_validator_spec_${Date.now()}.json`);
    await fs.writeFile(tmpFile, JSON.stringify(strategy), 'utf-8');

    const args = [runnerPath, '--spec', tmpFile, '--date-start', dateStart, '--date-end', dateEnd];
    if (universe && universe.length > 0) {
      args.push('--universe', universe.join(','));
    }
    if (tier) {
      args.push('--tier', tier);
    }

    const proc = spawn('py', args);
    if (jobId) activeProcesses.set(jobId, proc);
    let stdout = '';
    let stderr = '';
    let stderrBuf = '';
    let suppressedStderrCount = 0;
    const suppressedSamples: string[] = [];
    const symbolCount = (universe && universe.length > 0) ? universe.length : (strategy as any).universe?.length || 2;
    const timeoutMs = pipelineTimeoutMs(symbolCount, tier || 'tier2');
    const timeout = setTimeout(() => {
      killProcessTree(proc);
      if (jobId) activeProcesses.delete(jobId);
      reject(new Error(`Validation timed out after ${Math.round(timeoutMs / 1000)}s (${symbolCount} symbols)`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      stderrBuf += chunk;

      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as Partial<PipelineProgressEvent>;
          if (typeof msg.progress === 'number' && typeof msg.stage === 'string') {
            onProgress?.({
              progress: msg.progress,
              stage: msg.stage,
              detail: typeof msg.detail === 'string' ? msg.detail : '',
              eta_seconds: typeof msg.eta_seconds === 'number' ? msg.eta_seconds : undefined,
              eta_display: typeof msg.eta_display === 'string' ? msg.eta_display : undefined,
            });
            continue;
          }
        } catch {
          // fall through to normal stderr log
        }
        suppressedStderrCount += 1;
        if (suppressedSamples.length < 5) suppressedSamples.push(line);
      }
    });

    proc.on('close', async (code) => {
      clearTimeout(timeout);
      if (jobId) activeProcesses.delete(jobId);
      try { await fs.unlink(tmpFile); } catch {}
      const tail = stderrBuf.trim();
      if (tail) {
        try {
          const msg = JSON.parse(tail) as Partial<PipelineProgressEvent>;
          if (typeof msg.progress === 'number' && typeof msg.stage === 'string') {
            onProgress?.({
              progress: msg.progress,
              stage: msg.stage,
              detail: typeof msg.detail === 'string' ? msg.detail : '',
              eta_seconds: typeof msg.eta_seconds === 'number' ? msg.eta_seconds : undefined,
              eta_display: typeof msg.eta_display === 'string' ? msg.eta_display : undefined,
            });
          } else {
            suppressedStderrCount += 1;
            if (suppressedSamples.length < 5) suppressedSamples.push(tail);
          }
        } catch {
          suppressedStderrCount += 1;
          if (suppressedSamples.length < 5) suppressedSamples.push(tail);
        }
      }

      if (suppressedStderrCount > 0) {
        const sampleText = suppressedSamples.join(' | ');
        console.warn(
          `[ValidatorPipeline] Suppressed ${suppressedStderrCount} non-progress stderr lines.` +
          (sampleText ? ` Samples: ${sampleText}` : ''),
        );
      }

      if (code !== 0) {
        reject(new Error(`validatorPipeline exited with code ${code}: ${stderr || stdout}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve({
          report: parsed.report as ValidationReport,
          trades: (parsed.trades || []) as TradeInstance[],
        });
      } catch (err: any) {
        reject(new Error(`Failed to parse validator pipeline output: ${err.message}; raw=${stdout.slice(0, 300)}`));
      }
    });

    proc.on('error', async (err) => {
      clearTimeout(timeout);
      if (jobId) activeProcesses.delete(jobId);
      try { await fs.unlink(tmpFile); } catch {}
      reject(err);
    });
  });
}

// =====================
// Strategy Endpoints
// =====================

router.get('/strategies', async (req: Request, res: Response) => {
  try {
    const registryPath = path.join(__dirname, '..', '..', 'data', 'patterns', 'registry.json');
    const registryContent = await fs.readFile(registryPath, 'utf-8');
    const registry = JSON.parse(registryContent);
    const patternsDir = path.join(__dirname, '..', '..', 'data', 'patterns');

    const validatable = (registry.patterns || []).filter((p: any) =>
      (p.composition === 'composite' || p.composition === 'monolithic' || p.artifact_type === 'pattern')
      && String(p.status || '').toLowerCase() !== 'rejected'
    );

    const strategies: any[] = [];
    for (const entry of validatable) {
      try {
        const defPath = path.join(patternsDir, entry.definition_file);
        const defContent = await fs.readFile(defPath, 'utf-8');
        const def = JSON.parse(defContent);
        const interval = def.suggested_timeframes?.[0] === 'W' ? '1wk' : def.suggested_timeframes?.[0] === 'D' ? '1d' : '1wk';
        const baseSpec = applyParameterManifest({
          strategy_id: entry.pattern_id,
          strategy_version_id: `${entry.pattern_id}_v1`,
          version: 1,
          name: entry.name || def.name,
          description: def.description || '',
          status: entry.status || 'experimental',
          asset_class: 'stocks',
          interval,
          universe: [],
          structure_config: def.default_structure_config || {},
          setup_config: { pattern_type: def.pattern_type || entry.pattern_id, ...def.default_setup_params },
          entry_config: def.default_entry || {},
          risk_config: def.default_risk_config || { stop_type: 'structural' },
          exit_config: {} as any,
          cost_config: { commission_per_trade: 0, slippage_pct: 0.001 },
          execution_config: {},
          updated_at: def.updated_at || new Date().toISOString(),
        } as unknown as StrategySpec, def);
        strategies.push({
          ...baseSpec,
          composition: entry.composition,
          artifact_type: entry.artifact_type,
          category: entry.category,
          pattern_id: entry.pattern_id,
        });
      } catch (e) { /* definition file missing — skip */ }
    }

    const allReports = await storage.getAllValidationReports();
    const passedTiersByStrategy = new Map<string, Set<string>>();
    for (const report of allReports) {
      const strategyVersionId = String(report?.strategy_version_id || '').trim();
      const tier = String(report?.config?.validation_tier || '').trim().toLowerCase();
      if (!strategyVersionId || !tier) continue;
      if (String(report?.pass_fail || '').toUpperCase() !== 'PASS') continue;
      const bucket = passedTiersByStrategy.get(strategyVersionId) || new Set<string>();
      bucket.add(tier);
      passedTiersByStrategy.set(strategyVersionId, bucket);
    }

    // Include all saved strategies (sweep winners, user edits, research agents),
    // and let saved versions override registry placeholders with the same id.
    const allSaved = await storage.getAllStrategies();
    const savedByVersionId = new Map<string, any>();
    for (const s of allSaved) {
      const strategyVersionId = String(s?.strategy_version_id || '').trim();
      if (!strategyVersionId) continue;
      savedByVersionId.set(strategyVersionId, s);
    }

    const mergedStrategies: any[] = [];
    for (const strategy of strategies) {
      const strategyVersionId = String(strategy?.strategy_version_id || '').trim();
      const savedOverride = savedByVersionId.get(strategyVersionId);
      if (savedOverride) {
        savedByVersionId.delete(strategyVersionId);
        if (String(savedOverride.status || '').toLowerCase() === 'rejected') {
          continue;
        }
        mergedStrategies.push({
          ...savedOverride,
          source: savedOverride.strategy_version_id?.startsWith('research_') ? 'research' : 'saved',
        });
        continue;
      }
      mergedStrategies.push(strategy);
    }

    const mergedIds = new Set(mergedStrategies.map((s: any) => s.strategy_version_id));
    for (const s of allSaved) {
      if (mergedIds.has(s.strategy_version_id)) continue;
      if (s.strategy_version_id?.startsWith('sweep_')) continue;
      if (String(s.status || '').toLowerCase() === 'rejected') continue;
      mergedStrategies.push({
        ...s,
        source: s.strategy_version_id?.startsWith('research_') ? 'research' : 'saved',
      });
    }

    // Tag strategies with their source and tier progress
    mergedStrategies.forEach((s: any) => {
      if (!s.source) s.source = 'registry';
      const tiers = Array.from(passedTiersByStrategy.get(String(s.strategy_version_id || '').trim()) || []);
      const ordered = ['tier1', 'tier1b', 'tier2', 'tier3'].filter((tier) => tiers.includes(tier));
      s.passed_tiers = ordered;
      s.execution_eligible = String(s.status || '').toLowerCase() === 'approved' && ordered.includes('tier3');
    });

    res.json({ success: true, data: mergedStrategies } as ApiResponse<any[]>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

async function resolveStrategy(strategyVersionId: string): Promise<StrategySpec | null> {
  // 1. Check saved strategies folder first (user-created versions)
  const saved = await storage.getStrategy(strategyVersionId);
  if (saved) return saved;

  // 2. Fall back to pattern registry (composites + patterns)
  try {
    const registryPath = path.join(__dirname, '..', '..', 'data', 'patterns', 'registry.json');
    const registry = JSON.parse(await fs.readFile(registryPath, 'utf-8'));
    const patternsDir = path.join(__dirname, '..', '..', 'data', 'patterns');

    // Match by pattern_id_v1 convention (e.g. rdp_exhaustion_entry_composite_v1)
    const entry = (registry.patterns || []).find((p: any) =>
      `${p.pattern_id}_v1` === strategyVersionId || p.pattern_id === strategyVersionId
    );
    if (!entry) return null;

    const def = JSON.parse(await fs.readFile(path.join(patternsDir, entry.definition_file), 'utf-8'));
    return applyParameterManifest({
      strategy_id: entry.pattern_id,
      strategy_version_id: `${entry.pattern_id}_v1`,
      version: 1,
      name: entry.name || def.name,
      description: def.description || '',
      status: (entry.status || 'experimental') as any,
      asset_class: 'stocks' as any,
      interval: (def.suggested_timeframes?.[0] === 'W' ? '1wk' : def.suggested_timeframes?.[0] === 'D' ? '1d' : '1wk') as any,
      universe: [],
      structure_config: def.default_structure_config || {},
      setup_config: { pattern_type: def.pattern_type || entry.pattern_id, ...def.default_setup_params },
      entry_config: def.default_entry || {},
      risk_config: (def.default_risk_config || { stop_type: 'structural' }) as any,
      exit_config: {} as any,
      cost_config: { commission_per_trade: 0, slippage_pct: 0.001 },
      execution_config: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as StrategySpec, def);
  } catch {
    return null;
  }
}

router.get('/strategy/:id', async (req: Request, res: Response) => {
  try {
    const strategy = await resolveStrategy(req.params.id);
    if (!strategy) {
      return res.status(404).json({ success: false, error: 'Strategy not found' } as ApiResponse<null>);
    }
    res.json({ success: true, data: strategy } as ApiResponse<StrategySpec>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.post('/strategy', async (req: Request, res: Response) => {
  try {
    const validationError = validateStrategyPayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError } as ApiResponse<null>);
    }

    const strategy: StrategySpec = req.body;
    const all = await storage.getAllStrategies();
    const siblings = all.filter((s) => s.strategy_id === strategy.strategy_id);
    if (!strategy.strategy_version_id) {
      const maxVersion = siblings.reduce((max, s) => Math.max(max, Number(s.version) || 0), 0);
      strategy.version = maxVersion + 1;
      strategy.strategy_version_id = `${strategy.strategy_id}_v${strategy.version}`;
    }
    strategy.created_at = strategy.created_at || new Date().toISOString();
    strategy.updated_at = new Date().toISOString();
    Object.assign(strategy, applyParameterManifest(strategy));

    const id = await storage.saveStrategy(strategy);
    res.json({ success: true, data: { strategy_version_id: id } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.get('/tier-config', async (req: Request, res: Response) => {
  try {
    const strategyVersionId = typeof req.query.strategy_version_id === 'string' ? req.query.strategy_version_id.trim() : '';
    const requestedAssetClass = parseAssetClass(req.query.asset_class);

    let resolvedAssetClass: StrategyAssetClass = requestedAssetClass || 'stocks';
    let strategyVersion: string | null = null;

    if (strategyVersionId) {
      const strategy = await resolveStrategy(strategyVersionId);
      if (!strategy) {
        return res.status(404).json({ success: false, error: `Strategy not found: ${strategyVersionId}` } as ApiResponse<null>);
      }
      if (!requestedAssetClass) {
        resolvedAssetClass = resolveStrategyAssetClass(strategy);
      }
      strategyVersion = strategyVersionId;
    }

    const payload = {
      strategy_version_id: strategyVersion,
      ...(await buildTierConfigPayload(resolvedAssetClass)),
    };
    res.json({ success: true, data: payload } as ApiResponse<any>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// =====================
// Validation Endpoints
// =====================

router.post('/run', async (req: Request, res: Response) => {
  try {
    const { strategy_version_id, date_start, date_end, universe, tier, asset_class, interval, skip_tier_gate } = req.body;
    const activeRuns = Array.from(runJobs.values()).filter((j) => j.status === 'queued' || j.status === 'running').length;
    if (activeRuns >= MAX_CONCURRENT_RUNS) {
      return res.status(429).json({
        success: false,
        error: `Too many validator runs in progress (${activeRuns}/${MAX_CONCURRENT_RUNS}). Please wait for a job to complete.`,
      } as ApiResponse<null>);
    }

    if (!strategy_version_id || typeof strategy_version_id !== 'string') {
      return res.status(400).json({ success: false, error: 'strategy_version_id is required' } as ApiResponse<null>);
    }

    const ds = date_start || '2020-01-01';
    const de = date_end || new Date().toISOString().slice(0, 10);
    if (!isValidDateString(ds) || !isValidDateString(de)) {
      return res.status(400).json({ success: false, error: 'date_start/date_end must be YYYY-MM-DD' } as ApiResponse<null>);
    }
    if (new Date(ds).getTime() >= new Date(de).getTime()) {
      return res.status(400).json({ success: false, error: 'date_start must be before date_end' } as ApiResponse<null>);
    }

    const parsedUniverse = parseUniverse(universe);
    if (universe != null && parsedUniverse === null) {
      return res.status(400).json({ success: false, error: 'universe must be an array of valid symbols' } as ApiResponse<null>);
    }
    const parsedTier = parseValidationTier(tier);
    if (tier != null && parsedTier === null) {
      return res.status(400).json({ success: false, error: 'tier must be one of: tier1, tier1b, tier2, tier3' } as ApiResponse<null>);
    }
    const parsedAssetClass = parseAssetClass(asset_class);
    if (asset_class != null && parsedAssetClass === null) {
      return res.status(400).json({ success: false, error: 'asset_class must be one of: futures, stocks, options, forex, crypto' } as ApiResponse<null>);
    }
    const parsedInterval = parseValidationInterval(interval);
    if (interval != null && parsedInterval === null) {
      return res.status(400).json({
        success: false,
        error: 'interval must be one of: 1m,2m,5m,15m,30m,60m,90m,1h,1d,5d,1wk,1mo,3mo',
      } as ApiResponse<null>);
    }

    const strategy = await resolveStrategy(strategy_version_id);
    if (!strategy) {
      return res.status(404).json({ success: false, error: `Strategy not found: ${strategy_version_id}` } as ApiResponse<null>);
    }
    const effectiveTier: ValidationTier = parsedTier || 'tier1';
    const effectiveAssetClass = parsedAssetClass || resolveStrategyAssetClass(strategy);
    const strategyInterval = parseValidationInterval((strategy as any)?.interval) || '1wk';
    const effectiveInterval = parsedInterval || strategyInterval;
    const effectiveUniverse = await getValidationTierUniverse(effectiveAssetClass, effectiveTier);
    const existingReports = await storage.getAllValidationReports(strategy_version_id);
    const hasTierPass = (tierName: ValidationTier) =>
      existingReports.some((r: any) =>
        r?.pass_fail === 'PASS' &&
        r?.config?.validation_tier === tierName &&
        resolveReportAssetClass(r) === effectiveAssetClass
      );
    const latestTier1 = latestTierReport(existingReports, 'tier1', effectiveAssetClass);
    if (!skip_tier_gate) {
      if (effectiveTier === 'tier1b' && !isTier1EvidenceExpansionEligible(latestTier1)) {
        return res.status(400).json({
          success: false,
          error: `Tier 1B requires an inconclusive Tier 1 result first for this strategy (${strategy_version_id}). Run Tier 1, then use Tier 1B only when the edge looks viable but the evidence is thin.`,
        } as ApiResponse<null>);
      }
      if (effectiveTier === 'tier2' && !(hasTierPass('tier1') || hasTierPass('tier1b'))) {
        return res.status(400).json({
          success: false,
          error: `Tier 2 requires a passing Tier 1 or Tier 1B report first for this strategy (${strategy_version_id}).`,
        } as ApiResponse<null>);
      }
      if (effectiveTier === 'tier3' && !hasTierPass('tier2')) {
        return res.status(400).json({
          success: false,
          error: `Tier 3 requires a passing Tier 2 report first for this strategy (${strategy_version_id}).`,
        } as ApiResponse<null>);
      }
    }
    if (parsedUniverse && parsedUniverse.length > 0) {
      console.warn(
        `[validator] Ignoring manual universe override for ${strategy_version_id}; using fixed ${effectiveTier} universe (${effectiveAssetClass}).`,
      );
    }

    if (strategy.status === 'draft') {
      await storage.updateStrategyStatus(strategy_version_id, 'testing');
    }

    const jobId = `job_${uuidv4().slice(0, 10)}`;
    const job: RunJob = {
      job_id: jobId,
      status: 'queued',
      strategy_version_id,
      tier: effectiveTier,
      asset_class: effectiveAssetClass,
      interval: effectiveInterval,
      date_start: ds,
      date_end: de,
      created_at: new Date().toISOString(),
      progress: 0,
      stage: 'queued',
    };
    runJobs.set(jobId, job);
    await persistRunJobs();

    setImmediate(async () => {
      const j = runJobs.get(jobId);
      if (!j) return;
      const symCount = effectiveUniverse.length;
      const runTimeoutMs = pipelineTimeoutMs(symCount, effectiveTier);
      const runTimeoutSec = Math.round(runTimeoutMs / 1000);
      const tierLabel = VALIDATION_TIER_LABELS[effectiveTier];

      j.status = 'running';
      j.started_at = new Date().toISOString();
      j.progress = 0.1;
      j.stage = 'loading_data';
      j.detail = `Starting ${tierLabel} (${effectiveAssetClass}, ${effectiveInterval}, ${ds}..${de}): ${symCount} symbols (timeout: ${Math.round(runTimeoutSec / 60)}m)...`;
      j.elapsed_sec = 0;
      j.timeout_sec = runTimeoutSec;
      await persistRunJobs();

      const startedAtMs = Date.now();
      const progressTicker = setInterval(async () => {
        const live = runJobs.get(jobId);
        if (!live || live.status !== 'running') return;
        const elapsedMs = Date.now() - startedAtMs;
        live.elapsed_sec = Math.round(elapsedMs / 1000);
        live.timeout_sec = runTimeoutSec;
        if (elapsedMs > 60_000) {
          if (symCount > 10) {
            live.warning = `Large universe (${symCount} symbols) - this run may take several minutes.`;
          } else {
            live.warning = `Validation is still running. Current stage: ${live.stage || 'processing'}.`;
          }
        }
        await persistRunJobs();
      }, 2000);

      try {
        const strategyForRun: StrategySpec = {
          ...(strategy as any),
          interval: effectiveInterval,
        };
        const { report, trades } = await runValidatorPipeline(
          strategyForRun,
          ds,
          de,
          effectiveUniverse,
          effectiveTier,
          (evt) => {
            const live = runJobs.get(jobId);
            if (!live || live.status !== 'running') return;
            live.progress = Math.max(live.progress, Math.min(0.98, Number(evt.progress || 0)));
            live.stage = evt.stage || live.stage;
            if (evt.detail) live.detail = evt.detail;
            live.elapsed_sec = Math.round((Date.now() - startedAtMs) / 1000);
            live.timeout_sec = runTimeoutSec;
            if (typeof evt.eta_seconds === 'number') live.eta_seconds = evt.eta_seconds;
            if (typeof evt.eta_display === 'string') live.eta_display = evt.eta_display;
            void persistRunJobs();
          },
          jobId,
        );
        clearInterval(progressTicker);
        j.progress = Math.max(j.progress, 0.98);
        j.stage = 'saving_results';
        j.detail = 'Persisting report and trade instances...';
        report.config = report.config || ({} as any);
        (report.config as any).validation_tier = effectiveTier;
        (report.config as any).asset_class = effectiveAssetClass;
        (report.config as any).timeframes = [effectiveInterval];
        (report.config as any).universe = effectiveUniverse.slice();

        await storage.saveValidationReport(report);
        await storage.saveTradeInstances(report.report_id, trades);

        j.status = 'completed';
        j.completed_at = new Date().toISOString();
        j.progress = 1;
        j.stage = 'completed';
        j.detail = 'Completed';
        j.elapsed_sec = Math.round((Date.now() - startedAtMs) / 1000);
        j.timeout_sec = runTimeoutSec;
        j.eta_seconds = 0;
        j.eta_display = undefined;
        j.warning = undefined;
        j.report_id = report.report_id;
        await persistRunJobs();
      } catch (err: any) {
        clearInterval(progressTicker);
        j.status = 'failed';
        j.completed_at = new Date().toISOString();
        j.progress = 1;
        j.stage = 'failed';
        j.detail = undefined;
        j.elapsed_sec = Math.round((Date.now() - startedAtMs) / 1000);
        j.timeout_sec = runTimeoutSec;
        j.eta_seconds = 0;
        j.eta_display = undefined;
        j.error = err.message || 'Validation pipeline failed';
        await persistRunJobs();
      }
    });

    res.json({
      success: true,
      data: {
        job_id: jobId,
        status: 'queued',
        strategy_version_id,
        tier: effectiveTier,
        asset_class: effectiveAssetClass,
        interval: effectiveInterval,
        date_start: ds,
        date_end: de,
        symbol_count: effectiveUniverse.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.get('/run/:jobId', async (req: Request, res: Response) => {
  const job = runJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' } as ApiResponse<null>);
  }
  res.json({ success: true, data: job });
});

router.get('/runs/active', async (_req: Request, res: Response) => {
  const active: RunJob[] = [];
  for (const j of runJobs.values()) {
    if (j.status === 'running' || j.status === 'queued') {
      active.push(j);
    }
  }
  res.json({ success: true, data: active });
});

router.post('/run/:jobId/cancel', async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = runJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' } as ApiResponse<null>);
  }
  if (job.status !== 'running' && job.status !== 'queued') {
    return res.status(400).json({ success: false, error: `Job is already ${job.status}` } as ApiResponse<null>);
  }

  // Subprocess path: kill the entire process tree (on Windows, proc.kill() only
  // kills the `py` launcher and leaves the `python` child running).
  const proc = activeProcesses.get(jobId);
  if (proc) {
    killProcessTree(proc);
    activeProcesses.delete(jobId);
  }

  // Service path: abort the in-flight HTTP fetch and notify the service.
  const abortController = activeAbortControllers.get(jobId);
  if (abortController) {
    abortController.abort();
    activeAbortControllers.delete(jobId);
  }
  // Fire-and-forget cancel signal to the Python service so it stops mid-run.
  cancelValidatorJobOnService(jobId).catch(() => {});

  // Clean up any data that might have been saved (race condition safety)
  if (job.report_id) {
    try { await storage.deleteValidationReport(job.report_id); } catch {}
  }

  job.status = 'failed';
  job.completed_at = new Date().toISOString();
  job.progress = 1;
  job.stage = 'cancelled';
  job.detail = 'Cancelled by user';
  job.eta_seconds = 0;
  job.eta_display = undefined;
  job.error = 'Cancelled by user';
  job.report_id = undefined;
  await persistRunJobs();

  res.json({ success: true, data: { job_id: jobId, status: 'cancelled' } });
});

router.get('/reports', async (req: Request, res: Response) => {
  try {
    const strategyVersionId = req.query.strategy_version_id as string | undefined;
    const reports = await storage.getAllValidationReports(strategyVersionId);
    res.json({ success: true, data: reports } as ApiResponse<ValidationReport[]>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.delete('/reports', async (req: Request, res: Response) => {
  try {
    const strategyVersionId = req.query.strategy_version_id as string | undefined;
    if (!strategyVersionId) {
      return res.status(400).json({ success: false, error: 'strategy_version_id is required' } as ApiResponse<null>);
    }
    const deleted = await storage.deleteValidationReportsByStrategy(strategyVersionId);
    res.json({
      success: true,
      data: { strategy_version_id: strategyVersionId, deleted_reports: deleted },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.post('/reports/clear', async (req: Request, res: Response) => {
  try {
    const strategyVersionId = req.body?.strategy_version_id as string | undefined;
    if (!strategyVersionId) {
      return res.status(400).json({ success: false, error: 'strategy_version_id is required' } as ApiResponse<null>);
    }
    const deleted = await storage.deleteValidationReportsByStrategy(strategyVersionId);
    res.json({
      success: true,
      data: { strategy_version_id: strategyVersionId, deleted_reports: deleted },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.get('/report/:id', async (req: Request, res: Response) => {
  try {
    const report = await storage.getValidationReport(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' } as ApiResponse<null>);
    }
    res.json({ success: true, data: report } as ApiResponse<ValidationReport>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.delete('/report/:id', async (req: Request, res: Response) => {
  try {
    const report = await storage.getValidationReport(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' } as ApiResponse<null>);
    }
    await storage.deleteValidationReport(req.params.id);
    res.json({ success: true, data: { report_id: req.params.id } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.get('/report/:id/trades', async (req: Request, res: Response) => {
  try {
    const report = await storage.getValidationReport(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' } as ApiResponse<null>);
    }
    const trades = await storage.getTradeInstances(req.params.id);
    res.json({ success: true, data: trades } as ApiResponse<TradeInstance[]>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.get('/report/:id/compare/:otherId/diagnostics', async (req: Request, res: Response) => {
  try {
    const currentReport = await storage.getValidationReport(req.params.id);
    if (!currentReport) {
      return res.status(404).json({ success: false, error: 'Current report not found' } as ApiResponse<null>);
    }

    const previousReport = await storage.getValidationReport(req.params.otherId);
    if (!previousReport) {
      return res.status(404).json({ success: false, error: 'Comparison report not found' } as ApiResponse<null>);
    }

    const [currentTrades, previousTrades] = await Promise.all([
      storage.getTradeInstances(req.params.id),
      storage.getTradeInstances(req.params.otherId),
    ]);

    const diagnostics = buildValidatorComparisonDiagnostics(currentReport, previousReport, currentTrades, previousTrades);
    res.json({ success: true, data: diagnostics } as ApiResponse<ValidatorComparisonDiagnostics>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.post('/approve', async (req: Request, res: Response) => {
  try {
    const { report_id, notes } = req.body;
    if (!report_id) {
      return res.status(400).json({ success: false, error: 'report_id is required' } as ApiResponse<null>);
    }
    if (notes != null && typeof notes !== 'string') {
      return res.status(400).json({ success: false, error: 'notes must be a string' } as ApiResponse<null>);
    }

    const report = await storage.updateReportDecision(report_id, 'approved', 'user', notes || '');
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' } as ApiResponse<null>);
    }

    await storage.updateStrategyStatus(report.strategy_version_id, 'approved');

    res.json({
      success: true,
      data: {
        report_id,
        decision: 'approved',
        strategy_version_id: report.strategy_version_id,
        strategy_status: 'approved',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.post('/reject', async (req: Request, res: Response) => {
  try {
    const { report_id, notes } = req.body;
    if (!report_id) {
      return res.status(400).json({ success: false, error: 'report_id is required' } as ApiResponse<null>);
    }
    if (notes != null && typeof notes !== 'string') {
      return res.status(400).json({ success: false, error: 'notes must be a string' } as ApiResponse<null>);
    }

    const report = await storage.updateReportDecision(report_id, 'rejected', 'user', notes || '');
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' } as ApiResponse<null>);
    }

    await storage.updateStrategyStatus(report.strategy_version_id, 'rejected');

    res.json({
      success: true,
      data: {
        report_id,
        decision: 'rejected',
        strategy_version_id: report.strategy_version_id,
        strategy_status: 'rejected',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

export default router;
