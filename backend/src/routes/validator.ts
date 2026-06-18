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
import { DatabaseSync } from 'node:sqlite';
import * as storage from '../services/storageService';
import { getPersistedBridgeStrategyVersionId } from '../services/executionBridge';
import { ApiResponse, StrategySpec, StrategyAssetClass, ValidationReport, TradeInstance, ValidatorComparisonDiagnostics } from '../types';
import { applyParameterManifest } from '../services/parameterManifest';
import { readJsonDocument, writeJsonDocument } from '../services/appStateDb';
import { loadUniverseSymbolsSync } from '../services/universeRegistry';
import {
  getPluginServiceHealth,
  isPyServiceEnabled,
  runValidatorPipelineViaService,
  cancelValidatorJobOnService,
} from '../services/pluginServiceClient';
import { buildValidatorComparisonDiagnostics } from '../services/validatorComparisonService';
import { pruneSweepVariantsByReportId } from '../services/sweepEngine';

const router = Router();
const BACKTEST_STRATEGY_TAG = 'backtest_strategy';
const VALIDATOR_TIER_KEYS = new Set(['tier1', 'tier1s', 'tier1b', 'tier1bs', 'tier2', 'tier3', 'clean']);

function normalizeValidatorTier(input: any): string {
  const tier = String(input || '').trim().toLowerCase();
  return VALIDATOR_TIER_KEYS.has(tier) ? tier : '';
}

function hasBacktestStrategyTag(strategy: any): boolean {
  const tags = [
    strategy?.strategy_tag,
    ...(Array.isArray(strategy?.strategy_tags) ? strategy.strategy_tags : []),
  ].map((tag) => String(tag || '').trim()).filter(Boolean);
  return tags.includes(BACKTEST_STRATEGY_TAG);
}

function stampBacktestStrategyTag(strategy: any): any {
  const existingTags = Array.isArray(strategy?.strategy_tags) ? strategy.strategy_tags : [];
  const tags = new Set(
    existingTags
      .map((tag: any) => String(tag || '').trim())
      .filter(Boolean)
      .filter((tag: string) => tag !== 'production_strategy' && tag !== BACKTEST_STRATEGY_TAG),
  );
  tags.add(BACKTEST_STRATEGY_TAG);
  return {
    ...strategy,
    version_mode: 'backtest',
    strategy_tag: BACKTEST_STRATEGY_TAG,
    strategy_tags: Array.from(tags),
  };
}

function shouldExposeStrategyInValidator(strategy: any, tierEvidenceByStrategy: Map<string, Set<string>>): boolean {
  const strategyVersionId = String(strategy?.strategy_version_id || '').trim();
  if (!strategyVersionId) return false;
  if (hasBacktestStrategyTag(strategy)) return true;
  return Boolean(tierEvidenceByStrategy.get(strategyVersionId)?.size);
}

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
  tier?: ValidationTier;
  evidence_mode?: EvidenceMode | null;
  evidence_target_trades?: number | null;
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
const LEGACY_JOBS_FILE = path.join(__dirname, '..', '..', 'data', 'validator-run-jobs.json');
const RUN_JOBS_NAMESPACE = 'validator_run_jobs';
const RUN_JOBS_DOCUMENT_KEY = 'all';
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.VALIDATOR_MAX_CONCURRENT_RUNS || 2));
const PIPELINE_BASE_TIMEOUT_MS = Math.max(60_000, Number(process.env.VALIDATOR_PIPELINE_TIMEOUT_MS || 10 * 60_000));
const VALIDATOR_USE_PY_SERVICE = isPyServiceEnabled();
type ValidationTier = 'tier1' | 'tier1s' | 'tier1b' | 'tier1bs' | 'tier2' | 'tier3' | 'clean' | 'large_cap_known' | 'sp500' | 'sp400' | 'sp600' | 'valuation_regime_undervalued' | 'valuation_regime_undervalued_sample100' | 'valuation_regime_fair' | 'valuation_regime_fair_sample100' | 'valuation_regime_overvalued' | 'valuation_regime_overvalued_sample100' | 'regime_expansion' | 'regime_distribution' | 'regime_accumulation' | 'regime_markdown';
type EvidenceMode = 'evidence_50' | 'evidence_100' | 'evidence_200' | 'evidence_500' | 'full_clean';
const VALIDATION_TIER_KEYS: ValidationTier[] = ['tier1', 'tier1s', 'tier1b', 'tier1bs', 'tier2', 'tier3', 'clean', 'large_cap_known', 'sp500', 'sp400', 'sp600', 'valuation_regime_undervalued', 'valuation_regime_undervalued_sample100', 'valuation_regime_fair', 'valuation_regime_fair_sample100', 'valuation_regime_overvalued', 'valuation_regime_overvalued_sample100', 'regime_expansion', 'regime_distribution', 'regime_accumulation', 'regime_markdown'];
const EVIDENCE_TARGET_TRADE_COUNTS: Record<Exclude<EvidenceMode, 'full_clean'>, number> = {
  evidence_50: 50,
  evidence_100: 100,
  evidence_200: 200,
  evidence_500: 500,
};
const EVIDENCE_MODE_KEYS = new Set<EvidenceMode>(['evidence_50', 'evidence_100', 'evidence_200', 'evidence_500', 'full_clean']);
const ASSET_CLASSES: StrategyAssetClass[] = ['futures', 'stocks', 'options', 'forex', 'crypto'];
const OPTIONABLE_UNIVERSE_FILE = path.join(__dirname, '..', '..', 'data', 'universe', 'optionable.json');
const STOCKS_TIER1B_TARGET_SYMBOLS = Math.max(150, Number(process.env.VALIDATOR_TIER1B_STOCKS_TARGET_SYMBOLS || 250));
const SP500_SYMBOLS = loadUniverseSymbolsSync('sp500');
const SP400_SYMBOLS = loadUniverseSymbolsSync('sp400');
const SP600_SYMBOLS = loadUniverseSymbolsSync('sp600');
const TIER1_MIXED_CAP_SYMBOLS = loadUniverseSymbolsSync('validation_tier1_stocks');
const TIER1B_MIXED_CAP_SYMBOLS = loadUniverseSymbolsSync('validation_tier1b_stocks');
const TIER2_MIXED_CAP_SYMBOLS = loadUniverseSymbolsSync('validation_tier2_stocks');
const TIER3_MIXED_CAP_HOLDOUT_SYMBOLS = loadUniverseSymbolsSync('validation_tier3_stocks');
const SYMBOL_CATALOG_DB_PATH = path.join(__dirname, '..', '..', 'data', 'symbol-catalog.sqlite');
const CLEAN_UNIVERSE_SETTINGS = {
  SYMBOL_UNIVERSE_SIZE: Math.max(30, Number(process.env.SYMBOL_UNIVERSE_SIZE || process.env.VALIDATOR_CLEAN_UNIVERSE_SIZE || 500)),
  MIN_PRICE: Math.max(0, Number(process.env.MIN_PRICE || process.env.VALIDATOR_CLEAN_MIN_PRICE || 10)),
  MIN_AVERAGE_VOLUME: Math.max(0, Number(process.env.MIN_AVERAGE_VOLUME || process.env.VALIDATOR_CLEAN_MIN_AVERAGE_VOLUME || 1_000_000)),
  MIN_HISTORY_DAYS: Math.max(0, Number(process.env.MIN_HISTORY_DAYS || process.env.VALIDATOR_CLEAN_MIN_HISTORY_DAYS || 504)),
  EXCLUDE_ETFS: String(process.env.EXCLUDE_ETFS || process.env.VALIDATOR_CLEAN_EXCLUDE_ETFS || '1') !== '0',
  EXCLUDE_LOW_VOLUME: String(process.env.EXCLUDE_LOW_VOLUME || process.env.VALIDATOR_CLEAN_EXCLUDE_LOW_VOLUME || '1') !== '0',
  SECTOR_DIVERSITY_ENABLED: String(process.env.SECTOR_DIVERSITY_ENABLED || process.env.VALIDATOR_CLEAN_SECTOR_DIVERSITY_ENABLED || '1') !== '0',
};
const CLEAN_STOCK_BASE_SYMBOLS = loadUniverseSymbolsSync('clean_stocks');
const CLEAN_STOCK_UNIVERSE_RESULT = buildRuleBasedCleanStockUniverse(CLEAN_STOCK_BASE_SYMBOLS, CLEAN_UNIVERSE_SETTINGS);
const CLEAN_STOCK_FULL_UNIVERSE_RESULT = buildRuleBasedCleanStockUniverse(CLEAN_STOCK_BASE_SYMBOLS, {
  ...CLEAN_UNIVERSE_SETTINGS,
  SYMBOL_UNIVERSE_SIZE: Math.max(CLEAN_UNIVERSE_SETTINGS.SYMBOL_UNIVERSE_SIZE, CLEAN_STOCK_BASE_SYMBOLS.length),
});
const CLEAN_STOCK_SAMPLE_SYMBOLS = CLEAN_STOCK_UNIVERSE_RESULT.symbols;
const CLEAN_STOCK_FULL_SYMBOLS = CLEAN_STOCK_FULL_UNIVERSE_RESULT.symbols;
const LARGE_CAP_KNOWN_SYMBOLS = loadUniverseSymbolsSync('large_cap_known');

const REGIME_EXPANSION_SYMBOLS = loadUniverseSymbolsSync('regime_expansion');
const REGIME_DISTRIBUTION_SYMBOLS = loadUniverseSymbolsSync('regime_distribution');
const REGIME_ACCUMULATION_SYMBOLS = loadUniverseSymbolsSync('regime_accumulation');
const REGIME_MARKDOWN_SYMBOLS = loadUniverseSymbolsSync('regime_markdown');
const VALUATION_UNDERVALUE_SYMBOLS = loadUniverseSymbolsSync('valuation_regime_undervalued');
const VALUATION_UNDERVALUE_SAMPLE100_SYMBOLS = loadUniverseSymbolsSync('valuation_regime_undervalued_sample100');
const VALUATION_FAIR_SYMBOLS = loadUniverseSymbolsSync('valuation_regime_fair');
const VALUATION_FAIR_SAMPLE100_SYMBOLS = loadUniverseSymbolsSync('valuation_regime_fair_sample100');
const VALUATION_OVERVALUE_SYMBOLS = loadUniverseSymbolsSync('valuation_regime_overvalued');
const VALUATION_OVERVALUE_SAMPLE100_SYMBOLS = loadUniverseSymbolsSync('valuation_regime_overvalued_sample100');
const VALIDATION_TIER_UNIVERSES: Record<StrategyAssetClass, Record<ValidationTier, string[]>> = {
  futures: {
    tier1: ['ES=F', 'NQ=F', 'CL=F'],
    tier1s: ['ES=F', 'NQ=F', 'CL=F'],
    tier1b: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier1bs: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier2: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F'],
    tier3: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'CL=F', 'GC=F', 'ZN=F', 'SI=F', 'NG=F', 'HG=F', '6E=F'],
    clean: [],
    large_cap_known: [],
    sp500: [],
    sp400: [],
    sp600: [],
    valuation_regime_undervalued: [],
    valuation_regime_undervalued_sample100: [],
    valuation_regime_fair: [],
    valuation_regime_fair_sample100: [],
    valuation_regime_overvalued: [],
    valuation_regime_overvalued_sample100: [],
    regime_expansion: [],
    regime_distribution: [],
    regime_accumulation: [],
    regime_markdown: [],
  },
  stocks: {
    tier1: TIER1_MIXED_CAP_SYMBOLS,
    tier1bs: TIER1B_MIXED_CAP_SYMBOLS,
    large_cap_known: LARGE_CAP_KNOWN_SYMBOLS,
    tier1s: TIER1_MIXED_CAP_SYMBOLS,
    tier1b: TIER1B_MIXED_CAP_SYMBOLS,
    tier2: TIER2_MIXED_CAP_SYMBOLS,
    tier3: TIER3_MIXED_CAP_HOLDOUT_SYMBOLS,
    clean: CLEAN_STOCK_SAMPLE_SYMBOLS,
    sp500: SP500_SYMBOLS,
    sp400: SP400_SYMBOLS,
    sp600: SP600_SYMBOLS,
    valuation_regime_undervalued: VALUATION_UNDERVALUE_SYMBOLS,
    valuation_regime_undervalued_sample100: VALUATION_UNDERVALUE_SAMPLE100_SYMBOLS,
    valuation_regime_fair: VALUATION_FAIR_SYMBOLS,
    valuation_regime_fair_sample100: VALUATION_FAIR_SAMPLE100_SYMBOLS,
    valuation_regime_overvalued: VALUATION_OVERVALUE_SYMBOLS,
    valuation_regime_overvalued_sample100: VALUATION_OVERVALUE_SAMPLE100_SYMBOLS,
    regime_expansion: REGIME_EXPANSION_SYMBOLS,
    regime_distribution: REGIME_DISTRIBUTION_SYMBOLS,
    regime_accumulation: REGIME_ACCUMULATION_SYMBOLS,
    regime_markdown: REGIME_MARKDOWN_SYMBOLS,
  },
  options: {
    tier1: ['SPY', 'QQQ'],
    tier1s: ['SPY', 'QQQ'],
    tier1b: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier1bs: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier2: ['SPY', 'QQQ', 'AAPL', 'MSFT'],
    tier3: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'IWM', 'TLT'],
    clean: [],
    large_cap_known: [],
    sp500: [],
    sp400: [],
    sp600: [],
    valuation_regime_undervalued: [],
    valuation_regime_undervalued_sample100: [],
    valuation_regime_fair: [],
    valuation_regime_fair_sample100: [],
    valuation_regime_overvalued: [],
    valuation_regime_overvalued_sample100: [],
    regime_expansion: [],
    regime_distribution: [],
    regime_accumulation: [],
    regime_markdown: [],
  },
  forex: {
    tier1: ['EURUSD=X', 'GBPUSD=X'],
    tier1s: ['EURUSD=X', 'GBPUSD=X'],
    tier1b: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier1bs: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier2: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'],
    tier3: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X', 'NZDUSD=X'],
    clean: [],
    large_cap_known: [],
    sp500: [],
    sp400: [],
    sp600: [],
    valuation_regime_undervalued: [],
    valuation_regime_undervalued_sample100: [],
    valuation_regime_fair: [],
    valuation_regime_fair_sample100: [],
    valuation_regime_overvalued: [],
    valuation_regime_overvalued_sample100: [],
    regime_expansion: [],
    regime_distribution: [],
    regime_accumulation: [],
    regime_markdown: [],
  },
  crypto: {
    tier1: ['BTC-USD', 'ETH-USD'],
    tier1s: ['BTC-USD', 'ETH-USD'],
    tier1b: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier1bs: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier2: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD'],
    tier3: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD'],
    clean: [],
    large_cap_known: [],
    sp500: [],
    sp400: [],
    sp600: [],
    valuation_regime_undervalued: [],
    valuation_regime_undervalued_sample100: [],
    valuation_regime_fair: [],
    valuation_regime_fair_sample100: [],
    valuation_regime_overvalued: [],
    valuation_regime_overvalued_sample100: [],
    regime_expansion: [],
    regime_distribution: [],
    regime_accumulation: [],
    regime_markdown: [],
  },
};
const VALIDATION_TIER_LABELS: Record<ValidationTier, string> = {
  tier1: 'Tier 1 - Kill Test',
  tier1s: 'Tier 1S - Kill Test + Sensitivity',
  tier1b: 'Tier 1B - Evidence Expansion',
  tier1bs: 'Tier 1BS - Evidence Expansion + Sensitivity',
  tier2: 'Tier 2 - Core Validation',
  tier3: 'Tier 3 - Robustness',
  clean: `Clean Universe ${CLEAN_UNIVERSE_SETTINGS.SYMBOL_UNIVERSE_SIZE} - ${CLEAN_STOCK_SAMPLE_SYMBOLS.length} Stocks`,
  large_cap_known: `Large Cap (Known) - ${LARGE_CAP_KNOWN_SYMBOLS.length} Stocks`,
  sp500: `S&P 500 — ${SP500_SYMBOLS.length} Large Cap Stocks`,
  sp400: `S&P 400 — ${SP400_SYMBOLS.length} Mid Cap Stocks`,
  sp600: `S&P 600 — ${SP600_SYMBOLS.length} Small Cap Stocks`,
  valuation_regime_undervalued: `DCF Regime: Undervalued — ${VALUATION_UNDERVALUE_SYMBOLS.length} stocks`,
  valuation_regime_undervalued_sample100: `DCF Regime: Undervalued Sample 100 - ${VALUATION_UNDERVALUE_SAMPLE100_SYMBOLS.length} stocks`,
  valuation_regime_fair: `DCF Regime: Fair Value — ${VALUATION_FAIR_SYMBOLS.length} stocks`,
  valuation_regime_fair_sample100: `DCF Regime: Fair Value Sample 100 - ${VALUATION_FAIR_SAMPLE100_SYMBOLS.length} stocks`,
  valuation_regime_overvalued: `DCF Regime: Overvalued — ${VALUATION_OVERVALUE_SYMBOLS.length} stocks`,
  valuation_regime_overvalued_sample100: `DCF Regime: Overvalued Sample 100 - ${VALUATION_OVERVALUE_SAMPLE100_SYMBOLS.length} stocks`,
  regime_expansion: `Regime: Expansion — ${REGIME_EXPANSION_SYMBOLS.length} stocks (above 200MA, momentum up)`,
  regime_distribution: `Regime: Distribution — ${REGIME_DISTRIBUTION_SYMBOLS.length} stocks (above 200MA, fading)`,
  regime_accumulation: `Regime: Accumulation — ${REGIME_ACCUMULATION_SYMBOLS.length} stocks (below 200MA, recovering)`,
  regime_markdown: `Regime: Markdown — ${REGIME_MARKDOWN_SYMBOLS.length} stocks (below 200MA, declining)`,
};
const VALIDATION_TIER_DESCRIPTIONS: Record<ValidationTier, string> = {
  tier1: `Fast mixed-cap kill test on a nested ${TIER1_MIXED_CAP_SYMBOLS.length}-stock universe (13 large + 13 mid + 13 small + 13 micro). No parameter sensitivity.`,
  tier1s: `Tier 1 mixed-cap kill test with parameter sensitivity analysis on the same ${TIER1_MIXED_CAP_SYMBOLS.length}-stock universe.`,
  tier1b: `Mixed-cap evidence expansion on a nested ${TIER1B_MIXED_CAP_SYMBOLS.length}-stock universe (25 per cap bucket). Use this when Tier 1 looks viable but the sample is still thin.`,
  tier1bs: `Tier 1B mixed-cap evidence expansion with parameter sensitivity analysis on the same ${TIER1B_MIXED_CAP_SYMBOLS.length}-stock universe.`,
  tier2: `Core mixed-cap validation on a ${TIER2_MIXED_CAP_SYMBOLS.length}-stock universe (50 large + 50 mid + 50 small + 50 micro). Requires Tier 1 or Tier 1B PASS.`,
  tier3: `Non-overlapping mixed-cap robustness holdout on ${TIER3_MIXED_CAP_HOLDOUT_SYMBOLS.length} stocks (45 per cap bucket). Use this to confirm the edge survives outside the Tier 2 sample.`,
  clean: `Broad clean-stock evidence expansion on a predefined, rule-based ${CLEAN_STOCK_SAMPLE_SYMBOLS.length}-symbol sample from clean_stocks. Filters: price >= ${CLEAN_UNIVERSE_SETTINGS.MIN_PRICE}, history >= ${CLEAN_UNIVERSE_SETTINGS.MIN_HISTORY_DAYS} days, ETFs excluded=${CLEAN_UNIVERSE_SETTINGS.EXCLUDE_ETFS}, sector diversity=${CLEAN_UNIVERSE_SETTINGS.SECTOR_DIVERSITY_ENABLED}. Use this when rare signals need enough trades for statistical diagnostics.`,
  large_cap_known: 'Quick large-cap spot check. Use this when you already suspect a large-cap edge and want a fast baseline before running the full S&P 500 universe.',
  sp500: 'Broad large-cap benchmark. Use this to confirm a strategy truly generalizes across large caps, not just a curated subset.',
  sp400: 'Mid-cap benchmark. Use this to see whether the edge survives outside large caps or is cap-specific.',
  sp600: 'Small-cap benchmark. Use this to test whether the strategy prefers smaller, noisier, higher-volatility names.',
  valuation_regime_undervalued: 'DCF valuation regime universe. Use this to test long and reversal ideas only inside names the valuation engine currently screens as undervalued.',
  valuation_regime_undervalued_sample100: 'DCF valuation sample. Use this faster 100-name undervalued bucket when you want regime evidence without paying full-universe runtime.',
  valuation_regime_fair: 'DCF valuation regime universe. Use this to test whether continuation or trend-following ideas work best in names the valuation engine screens as roughly fair value.',
  valuation_regime_fair_sample100: 'DCF valuation sample. Use this faster 100-name fair-value bucket when you want a quicker continuation-regime read.',
  valuation_regime_overvalued: 'DCF valuation regime universe. Use this to test short and topping ideas only inside names the valuation engine currently screens as overvalued.',
  valuation_regime_overvalued_sample100: 'DCF valuation sample. Use this faster 100-name overvalued bucket when you want a quicker short-regime read.',
  regime_expansion: 'Environment diagnosis for trend-friendly conditions. Use this for breakouts, momentum, and pullback-continuation ideas. Built by build_regime_universes.py.',
  regime_distribution: 'Environment diagnosis for fading uptrends. Use this to see whether a strategy weakens when momentum rolls over. Built by build_regime_universes.py.',
  regime_accumulation: 'Environment diagnosis for bottoming and recovery conditions. Useful for reversal and early-trend strategies. Built by build_regime_universes.py.',
  regime_markdown: 'Environment diagnosis for downtrends and deterioration. Use this to test whether a long strategy should be avoided there, or whether a short idea belongs there. Built by build_regime_universes.py.',
};

let optionableStocksUniverseCache: string[] | null = null;
let cleanStockUniverseCache: Set<string> | null = null;

type CleanUniverseSettings = typeof CLEAN_UNIVERSE_SETTINGS;

type CleanUniverseBuildResult = {
  symbols: string[];
  settings: CleanUniverseSettings;
  source_count: number;
  eligible_count: number;
  applied_filters: string[];
  unavailable_filters: string[];
};

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

function getMetric(row: Record<string, any>, name: string): number | null {
  if (row?.[name] == null || row?.[name] === '') return null;
  const value = Number(row?.[name]);
  return Number.isFinite(value) ? value : null;
}

function buildSectorDiverseSlice(rows: Array<Record<string, any>>, targetCount: number): string[] {
  if (!rows.length || rows.length <= targetCount) {
    return rows.map((row) => String(row.symbol || '')).filter(Boolean);
  }
  const bySector = new Map<string, Array<Record<string, any>>>();
  for (const row of rows) {
    const sector = String(row.sector || 'Unknown').trim() || 'Unknown';
    const bucket = bySector.get(sector) || [];
    bucket.push(row);
    bySector.set(sector, bucket);
  }
  const sectors = Array.from(bySector.keys()).sort();
  const out: string[] = [];
  const seen = new Set<string>();
  while (out.length < targetCount && sectors.length > 0) {
    let progressed = false;
    for (const sector of sectors) {
      const bucket = bySector.get(sector) || [];
      const row = bucket.shift();
      if (!row) continue;
      const symbol = String(row.symbol || '').trim().toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      out.push(symbol);
      progressed = true;
      if (out.length >= targetCount) break;
    }
    if (!progressed) break;
  }
  return out;
}

function buildRuleBasedCleanStockUniverse(baseSymbols: string[], settings: CleanUniverseSettings): CleanUniverseBuildResult {
  const base = normalizeUniverseSymbols(baseSymbols);
  const appliedFilters = [
    `source=clean_stocks`,
    `size<=${settings.SYMBOL_UNIVERSE_SIZE}`,
    `min_price>=${settings.MIN_PRICE}`,
    `min_history_days>=${settings.MIN_HISTORY_DAYS}`,
  ];
  const unavailableFilters: string[] = [];
  let rows: Array<Record<string, any>> = base.map((symbol) => ({ symbol }));

  try {
    const db = new DatabaseSync(SYMBOL_CATALOG_DB_PATH, { readOnly: true });
    try {
      const placeholders = base.map(() => '?').join(',');
      if (placeholders) {
        rows = db.prepare(`
          SELECT
            s.symbol,
            s.sector,
            s.company_type,
            s.asset_class,
            s.active,
            MAX(CASE WHEN sm.metric_name = 'valuation_price' THEN sm.metric_value_num END) AS valuation_price,
            MAX(CASE WHEN sm.metric_name = 'regime_bars' THEN sm.metric_value_num END) AS regime_bars,
            MAX(CASE WHEN sm.metric_name IN ('average_daily_volume', 'avg_daily_volume', 'avg_volume', 'volume_avg_30d') THEN sm.metric_value_num END) AS average_daily_volume
          FROM symbols s
          LEFT JOIN symbol_metrics sm ON sm.symbol = s.symbol
          WHERE s.symbol IN (${placeholders})
          GROUP BY s.symbol
          ORDER BY s.symbol ASC
        `).all(...base) as Array<Record<string, any>>;
      }
    } finally {
      db.close();
    }
  } catch {
    unavailableFilters.push('symbol_catalog');
  }

  rows = rows.filter((row) => {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (!symbol || symbol.includes('^') || symbol.includes('=')) return false;
    if (row.asset_class && String(row.asset_class).toLowerCase() !== 'stocks') return false;
    if (row.active != null && Number(row.active) === 0) return false;
    const price = getMetric(row, 'valuation_price');
    if (price != null && price < settings.MIN_PRICE) return false;
    const historyDays = getMetric(row, 'regime_bars');
    if (historyDays != null && historyDays < settings.MIN_HISTORY_DAYS) return false;
    if (settings.EXCLUDE_ETFS) {
      const companyType = String(row.company_type || '').toLowerCase();
      if (/etf|fund|trust|closed.end|exchange.traded/.test(companyType)) return false;
    }
    return true;
  });

  if (settings.EXCLUDE_LOW_VOLUME) {
    const hasVolume = rows.some((row) => getMetric(row, 'average_daily_volume') != null);
    if (hasVolume) {
      appliedFilters.push(`min_average_volume>=${settings.MIN_AVERAGE_VOLUME}`);
      rows = rows.filter((row) => {
        const volume = getMetric(row, 'average_daily_volume');
        return volume == null || volume >= settings.MIN_AVERAGE_VOLUME;
      });
    } else {
      unavailableFilters.push('MIN_AVERAGE_VOLUME: symbol_metrics has no average-volume metric yet');
    }
  }
  if (settings.EXCLUDE_ETFS) appliedFilters.push('exclude_etfs=true');
  if (settings.SECTOR_DIVERSITY_ENABLED) appliedFilters.push('sector_diversity=true');

  rows.sort((a, b) => {
    const sectorCmp = String(a.sector || '').localeCompare(String(b.sector || ''));
    if (sectorCmp !== 0) return sectorCmp;
    const aCap = getMetric(a, 'valuation_market_cap') || 0;
    const bCap = getMetric(b, 'valuation_market_cap') || 0;
    if (aCap !== bCap) return bCap - aCap;
    return String(a.symbol || '').localeCompare(String(b.symbol || ''));
  });

  const symbols = settings.SECTOR_DIVERSITY_ENABLED
    ? buildSectorDiverseSlice(rows, settings.SYMBOL_UNIVERSE_SIZE)
    : buildDeterministicUniverseSlice(rows.map((row) => String(row.symbol || '').trim().toUpperCase()), settings.SYMBOL_UNIVERSE_SIZE);

  return {
    symbols,
    settings,
    source_count: base.length,
    eligible_count: rows.length,
    applied_filters: appliedFilters,
    unavailable_filters: unavailableFilters,
  };
}

async function loadCleanStockUniverseSet(): Promise<Set<string>> {
  if (cleanStockUniverseCache && cleanStockUniverseCache.size > 0) {
    return new Set(cleanStockUniverseCache);
  }
  try {
    const symbols = loadUniverseSymbolsSync('tradable_stock_default');
    cleanStockUniverseCache = new Set(symbols);
    return new Set(cleanStockUniverseCache);
  } catch {
    cleanStockUniverseCache = new Set();
    return new Set();
  }
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
    const optionable = loadUniverseSymbolsSync('tradable_optionable_stocks');
    if (optionable.length > 0) {
      const sampled = buildDeterministicUniverseSlice(optionable, STOCKS_TIER1B_TARGET_SYMBOLS);
      if (sampled.length > 0) {
        optionableStocksUniverseCache = sampled;
        return sampled.slice();
      }
    }
  } catch {
    // Fall through to the file-based fallback below.
  }
  try {
    const raw = await fs.readFile(OPTIONABLE_UNIVERSE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const optionable = normalizeUniverseSymbols(parsed?.optionable || parsed?.symbols || []);
    const cleanSet = await loadCleanStockUniverseSet();
    const filtered = cleanSet.size > 0
      ? optionable.filter(symbol => cleanSet.has(symbol))
      : optionable;
    const sampled = buildDeterministicUniverseSlice(filtered, STOCKS_TIER1B_TARGET_SYMBOLS);
    if (sampled.length > 0) {
      optionableStocksUniverseCache = sampled;
      return sampled.slice();
    }
  } catch {
    // Fall through to the static fallback below.
  }
  const cleanSet = await loadCleanStockUniverseSet();
  optionableStocksUniverseCache = (cleanSet.size > 0
    ? VALIDATION_TIER_UNIVERSES.stocks.tier1b.filter(symbol => cleanSet.has(symbol))
    : VALIDATION_TIER_UNIVERSES.stocks.tier1b.slice());
  return optionableStocksUniverseCache.slice();
}
// Scale timeout by tier: Tier 1 is intentionally faster, Tier 2/3 include robustness.
// Per-symbol budget is 30s to account for RDP computation (~22s actual).
// After Numba (Phase 1D), these will be way more than enough.
function pipelineTimeoutMs(symbolCount: number, tier: ValidationTier = 'tier2'): number {
  const perSymbol = 30_000 * Math.max(1, symbolCount);
  const multiplierByTier: Record<ValidationTier, number> = {
    tier1: 2,          // ~20 min for 50 symbols
    tier1s: 3,         // same as tier1 but with sensitivity analysis
    tier1b: 2,         // evidence expansion still uses baseline-only runtime
    tier1bs: 4,        // tier1b universe + sensitivity — longest of the fast tiers
    tier2: 3,          // ~2.5 hours for 106 symbols
    tier3: 3,          // ~2.5 hours for 190 symbols
    clean: 2,          // 500-name broad evidence run, baseline only
    large_cap_known: 2, // 76 symbols, baseline only
    sp500: 2,              // ~406 symbols, baseline only (no sensitivity)
    sp400: 2,              // ~341 symbols, baseline only
    sp600: 2,              // ~474 symbols, baseline only
    valuation_regime_undervalued: 2,
    valuation_regime_undervalued_sample100: 2,
    valuation_regime_fair: 2,
    valuation_regime_fair_sample100: 2,
    valuation_regime_overvalued: 2,
    valuation_regime_overvalued_sample100: 2,
    regime_expansion: 2,   // dynamic size, baseline only
    regime_distribution: 2,
    regime_accumulation: 2,
    regime_markdown: 2,
  };
  return PIPELINE_BASE_TIMEOUT_MS + perSymbol * multiplierByTier[tier];
}

async function loadRunJobs(): Promise<void> {
  const persisted = readJsonDocument<RunJob[]>(RUN_JOBS_NAMESPACE, RUN_JOBS_DOCUMENT_KEY);
  if (Array.isArray(persisted)) {
    const now = Date.now();
    let mutated = false;
    for (const j of persisted) {
      if (j.status === 'running' || j.status === 'queued') {
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
    return;
  }
  try {
    const raw = await fs.readFile(LEGACY_JOBS_FILE, 'utf-8');
    const arr = JSON.parse(raw) as RunJob[];
    const now = Date.now();
    let mutated = false;
    let loadedLegacy = false;
    for (const j of arr) {
      loadedLegacy = true;
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
    if (mutated || loadedLegacy) {
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
    writeJsonDocument(RUN_JOBS_NAMESPACE, RUN_JOBS_DOCUMENT_KEY, all);
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
  const key = String(input).trim().toLowerCase() as ValidationTier;
  return (VALIDATION_TIER_KEYS as string[]).includes(key) ? key : null;
}

function parseEvidenceMode(input: any): EvidenceMode | null {
  if (input == null) return null;
  const key = String(input).trim().toLowerCase() as EvidenceMode;
  return EVIDENCE_MODE_KEYS.has(key) ? key : null;
}

function parseEvidenceTargetTrades(input: any, mode: EvidenceMode | null): number | null {
  if (mode && mode !== 'full_clean') {
    return EVIDENCE_TARGET_TRADE_COUNTS[mode] || null;
  }
  if (input == null || input === '') return null;
  const value = Math.round(Number(input));
  if (!Number.isFinite(value) || value < 1 || value > 5000) return null;
  return value;
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
  const byClass = VALIDATION_TIER_UNIVERSES[assetClass] || VALIDATION_TIER_UNIVERSES.stocks;
  return (byClass[tier] || VALIDATION_TIER_UNIVERSES.stocks[tier] || []).slice();
}

async function getEvidenceUniverse(assetClass: StrategyAssetClass, tier: ValidationTier, evidenceMode: EvidenceMode | null): Promise<string[]> {
  if (assetClass === 'stocks' && (evidenceMode || tier === 'clean')) {
    return (evidenceMode ? CLEAN_STOCK_FULL_SYMBOLS : CLEAN_STOCK_SAMPLE_SYMBOLS).slice();
  }
  return getValidationTierUniverse(assetClass, tier);
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
      ...(key === 'clean' && assetClass === 'stocks' ? { universe_settings: CLEAN_STOCK_UNIVERSE_RESULT } : {}),
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
  // PASS or NEEDS_REVIEW both allow Tier 1B — PASS means edge confirmed, 1B expands evidence
  if (report?.pass_fail === 'PASS' || report?.pass_fail === 'NEEDS_REVIEW' || report?.pass_fail === 'PROMISING_BUT_NOT_VALIDATED') return true;
  // FAIL is eligible only if the sole reason is too few trades
  if (report?.pass_fail !== 'FAIL') return false;
  const reasons = Array.isArray(report?.pass_fail_reasons) ? report.pass_fail_reasons : [];
  return reasons.length > 0 && reasons.every((reason: any) => /too few trades/i.test(String(reason || '')));
}

async function runValidatorPipeline(
  strategy: StrategySpec,
  dateStart: string,
  dateEnd: string,
  universe?: string[],
  tier?: ValidationTier,
  evidence?: { mode?: EvidenceMode | null; target_trades?: number | null },
  forceRefresh?: boolean,
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
          evidence,
          Boolean(forceRefresh),
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
    if (evidence?.mode) {
      args.push('--evidence-mode', evidence.mode);
    }
    if (evidence?.target_trades && evidence.target_trades > 0) {
      args.push('--evidence-target-trades', String(Math.round(evidence.target_trades)));
    }
    if (forceRefresh) {
      args.push('--force-refresh');
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

function isFundamentalBacktestStrategy(strategy: any): boolean {
  return String(strategy?.scan_mode || '').trim() === 'fundamental_backtest'
    || String(strategy?.entry_config?.trigger || '').trim() === 'fundamental_rebalance_signal'
    || strategy?.backtest_config?.fundamental_backtester === true;
}

function toFiniteNumberOrNull(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFundamentalPercent(value: any): number | null {
  const n = toFiniteNumberOrNull(value);
  if (n == null || n === 0) return null;
  const abs = Math.abs(n);
  return abs <= 1 ? abs * 100 : abs;
}

function syncFundamentalValidatorSourceConfig(strategy: any, sourceConfigInput: any): any {
  const sourceConfig = sourceConfigInput && typeof sourceConfigInput === 'object' ? sourceConfigInput : {};
  const risk = (strategy?.risk_config && typeof strategy.risk_config === 'object') ? strategy.risk_config : {};
  const exitConfig = (strategy?.exit_config && typeof strategy.exit_config === 'object') ? strategy.exit_config : {};
  const sourceExit = (sourceConfig.exit && typeof sourceConfig.exit === 'object') ? sourceConfig.exit : {};
  const stopType = String(risk.stop_type || '').trim().toLowerCase();
  const stopPct = toFundamentalPercent(risk.stop_value);

  if (stopPct != null && (!stopType || ['fixed_pct', 'percentage', 'percent'].includes(stopType))) {
    sourceExit.stop_loss_pct = -stopPct;
  }

  const maxHold = toFiniteNumberOrNull(risk.max_hold_bars ?? exitConfig.time_stop_bars);
  if (maxHold != null && maxHold > 0) {
    sourceExit.max_hold_days = Math.round(maxHold);
  }

  const trailingPct = toFundamentalPercent(risk.trailing_stop_pct ?? exitConfig.trailing?.percent);
  if (trailingPct != null) {
    sourceExit.trailing_stop_pct = trailingPct;
  }

  const takeProfitR = toFiniteNumberOrNull(risk.take_profit_R ?? risk.take_profit_r ?? exitConfig.target_level);
  const ladder = Array.isArray(risk.take_profit_ladder_pct)
    ? risk.take_profit_ladder_pct
    : Array.isArray(exitConfig.take_profit_ladder_pct)
      ? exitConfig.take_profit_ladder_pct
      : null;
  const normalizedLadder = ladder
    ? ladder
      .map((value: any) => toFiniteNumberOrNull(value))
      .filter((value: number | null): value is number => value != null && value > 0)
    : [];
  if (takeProfitR != null && takeProfitR > 0 && stopPct != null && stopPct > 0) {
    sourceExit.take_profit_ladder_pct = [Number((takeProfitR * stopPct).toFixed(6))];
  } else if (normalizedLadder.length) {
    sourceExit.take_profit_ladder_pct = normalizedLadder;
  }

  sourceConfig.exit = sourceExit;
  return sourceConfig;
}

function buildFundamentalSourceConfigFromStrategy(strategy: any): any {
  const backtestConfig = strategy?.backtest_config && typeof strategy.backtest_config === 'object'
    ? strategy.backtest_config
    : {};
  const provenance = backtestConfig.source_config_provenance && typeof backtestConfig.source_config_provenance === 'object'
    ? backtestConfig.source_config_provenance
    : null;
  const legacySource = backtestConfig.source_config && typeof backtestConfig.source_config === 'object'
    ? backtestConfig.source_config
    : null;
  const base = JSON.parse(JSON.stringify(provenance || legacySource || {}));
  const entryConfig = strategy?.entry_config && typeof strategy.entry_config === 'object'
    ? strategy.entry_config
    : {};
  const fundamentalConfig = strategy?.fundamental_config && typeof strategy.fundamental_config === 'object'
    ? strategy.fundamental_config
    : {};
  const variables = Array.isArray(fundamentalConfig.variables) ? fundamentalConfig.variables : [];
  const rulesFromVariables = variables
    .map((variable: any) => ({
      metric: String(variable?.metric || '').trim(),
      op: String(variable?.operator || variable?.op || '>=').trim() || '>=',
      value: toFiniteNumberOrNull(variable?.threshold ?? variable?.value),
    }))
    .filter((rule: any) => rule.metric && rule.value != null);
  const entryRules = rulesFromVariables.length
    ? rulesFromVariables
    : Array.isArray(entryConfig.rules)
      ? entryConfig.rules
      : [];
  const exclusions = Array.isArray(entryConfig.exclusions)
    ? entryConfig.exclusions
    : Array.isArray(base.exclusions)
      ? base.exclusions
      : [];
  const forwardBars = toFiniteNumberOrNull(fundamentalConfig.forward_bars);
  const rebalanceFrequency = String(
    entryConfig.rebalance_frequency ||
    fundamentalConfig.rebalance_frequency ||
    base.rebalance_frequency ||
    'monthly'
  );

  return {
    ...base,
    name: base.name || strategy?.name || strategy?.strategy_version_id || 'fundamental_strategy',
    rebalance_frequency: rebalanceFrequency,
    benchmark: base.benchmark || backtestConfig.benchmark || 'SPY',
    result_mode: base.result_mode || backtestConfig.result_mode || 'equal_weight',
    top_n_per_date: Number(entryConfig.top_n_per_date || base.top_n_per_date || 0),
    entry: { all: entryRules },
    exclusions,
    exit: {
      ...(base.exit && typeof base.exit === 'object' ? base.exit : {}),
      ...(forwardBars != null && forwardBars > 0 ? { max_hold_days: Math.round(forwardBars) } : {}),
    },
  };
}

type ValidatorVerdict = ValidationReport['pass_fail'];

function fundamentalReportVerdict(report: any, tierLabel: string): { verdict: ValidatorVerdict; reasons: string[] } {
  const ts = report?.trades_summary || {};
  const oos = report?.robustness?.out_of_sample || {};
  const wf = report?.robustness?.walk_forward || {};
  const mc = report?.robustness?.monte_carlo || {};
  const thresholds = report?.config?.validation_thresholds || {};
  const tradeCount = Number(ts.total_trades || 0);
  const expectancy = Number(ts.expectancy_R || 0);
  const minTradesPass = Number(thresholds.min_trades_pass || 30);
  const minTradesFail = Number(thresholds.min_trades_fail || 30);
  const maxOosDeg = Number(thresholds.max_oos_degradation_pct || 50);
  const minWf = Number(thresholds.min_wf_profitable_windows || 0.6);
  const maxP95 = Number(thresholds.max_mc_p95_dd_pct || 30);
  const maxP99 = Number(thresholds.max_mc_p99_dd_pct || 50);
  const reasons: string[] = [];

  if (tradeCount < minTradesFail) {
    reasons.push(`Insufficient trade sample. Expectancy and Monte Carlo statistics are not reliable: ${tradeCount} < ${minTradesFail}.`);
    if (expectancy > 0) {
      reasons.push(`Promising ${tierLabel} edge (${expectancy.toFixed(2)}R), but it is not validated yet.`);
      return { verdict: 'PROMISING_BUT_NOT_VALIDATED', reasons };
    }
    return { verdict: 'INSUFFICIENT_DATA', reasons };
  }
  if (expectancy <= 0) {
    reasons.push(`Expectancy is not positive: ${expectancy.toFixed(2)}R.`);
    return { verdict: 'FAIL', reasons };
  }
  if (tradeCount < minTradesPass) {
    reasons.push(`Positive ${tierLabel} result, but total trades are below the stronger threshold (${tradeCount} < ${minTradesPass}).`);
    return { verdict: 'NEEDS_REVIEW', reasons };
  }

  const oosReliable = oos.reliable !== false && Number(oos.oos_n || 0) > 0;
  const wfReliable = wf.reliable !== false && Number(wf.total_windows || 0) > 0;
  const mcReliable = mc.reliable !== false && Number(mc.simulations || 0) > 0;
  if (!oosReliable) reasons.push('OOS result is unreliable because the OOS trade sample is too small.');
  if (!wfReliable) reasons.push('Walk-forward result is unreliable because there are not enough trades per window.');
  if (!mcReliable) reasons.push('Monte Carlo result is unreliable because the total trade sample is too small.');

  const passes = (
    oosReliable
    && wfReliable
    && mcReliable
    && Number(oos.oos_expectancy || 0) > 0
    && Number(oos.oos_degradation_pct || 0) < maxOosDeg
    && Number(wf.pct_profitable_windows || 0) >= minWf
    && Number(mc.p95_dd_pct || 0) < maxP95
    && Number(mc.p99_dd_pct || 0) <= maxP99
  );
  if (!passes) {
    if (Number(mc.p99_dd_pct || 0) > maxP99) reasons.push(`Monte Carlo p99 drawdown is above hard-fail ceiling: ${Number(mc.p99_dd_pct || 0).toFixed(1)}% > ${maxP99.toFixed(1)}%.`);
    if (Number(oos.oos_expectancy || 0) <= 0) reasons.push(`OOS expectancy is not positive: ${Number(oos.oos_expectancy || 0).toFixed(2)}R.`);
    if (Number(oos.oos_degradation_pct || 0) >= maxOosDeg) reasons.push(`OOS degradation is too high: ${Number(oos.oos_degradation_pct || 0).toFixed(1)}% >= ${maxOosDeg.toFixed(1)}%.`);
    if (Number(wf.pct_profitable_windows || 0) < minWf) reasons.push(`Walk-forward profitable windows below threshold: ${(Number(wf.pct_profitable_windows || 0) * 100).toFixed(1)}% < ${(minWf * 100).toFixed(1)}%.`);
    return { verdict: 'FAIL', reasons };
  }

  reasons.push(`Fundamental result cleared ${tierLabel}: ${tradeCount} trades, expectancy ${expectancy.toFixed(2)}R, OOS ${Number(oos.oos_expectancy || 0).toFixed(2)}R, WF ${(Number(wf.pct_profitable_windows || 0) * 100).toFixed(1)}%.`);
  return { verdict: 'PASS', reasons };
}

function parseFundamentalTradeCsv(text: string): Array<Record<string, string>> {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => { row[header] = values[idx] || ''; });
    return row;
  });
}

function averageNumber(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDevNumber(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = averageNumber(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function maxDrawdownRForSequence(rValues: number[]): number {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of rValues) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return maxDrawdown;
}

function maxDrawdownPctForReturns(returnPcts: number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returnPcts) {
    equity *= Math.max(0, 1 + value);
    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, Math.max(0, 1 - equity / peak));
    }
  }
  return maxDrawdown;
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

function averageTradeR(trades: TradeInstance[]): number {
  if (!trades.length) return 0;
  return averageNumber(trades.map((trade) => Number(trade.R_multiple || 0)));
}

function degradationPct(isExpectancy: number, oosExpectancy: number): number {
  if (Math.abs(isExpectancy) < 1e-9) return oosExpectancy >= 0 ? 0 : 100;
  return ((isExpectancy - oosExpectancy) / Math.abs(isExpectancy)) * 100;
}

function computeTimeBasedOos(trades: TradeInstance[], minOosTrades: number): any {
  const ordered = trades.slice().sort((a, b) => {
    const aTime = new Date(a.entry_time || '').getTime() || 0;
    const bTime = new Date(b.entry_time || '').getTime() || 0;
    return aTime - bTime;
  });
  const splitIdx = Math.max(1, Math.floor(ordered.length * 0.7));
  const isTrades = ordered.slice(0, splitIdx);
  const oosTrades = ordered.slice(splitIdx);
  const isExpectancy = averageTradeR(isTrades);
  const oosExpectancy = averageTradeR(oosTrades);
  const splitDate = ordered[splitIdx]?.entry_time || '';
  const reliable = isTrades.length >= minOosTrades && oosTrades.length >= minOosTrades;
  return {
    mode: 'time_70_30',
    is_expectancy: Number(isExpectancy.toFixed(4)),
    is_n: isTrades.length,
    oos_expectancy: Number(oosExpectancy.toFixed(4)),
    oos_n: oosTrades.length,
    split_date: splitDate,
    oos_degradation_pct: Number(degradationPct(isExpectancy, oosExpectancy).toFixed(2)),
    reliable,
    reliability_note: reliable ? 'Reliable time-based OOS split.' : `Unreliable OOS split: each side needs at least ${minOosTrades} trades.`,
  };
}

function computeSymbolBasedOos(trades: TradeInstance[], minOosTrades: number): any {
  const symbols = Array.from(new Set(trades.map((trade) => String(trade.symbol || '').trim().toUpperCase()).filter(Boolean))).sort();
  const splitIdx = Math.max(1, Math.floor(symbols.length * 0.7));
  const isSymbols = new Set(symbols.slice(0, splitIdx));
  const oosSymbols = new Set(symbols.slice(splitIdx));
  const isTrades = trades.filter((trade) => isSymbols.has(String(trade.symbol || '').trim().toUpperCase()));
  const oosTrades = trades.filter((trade) => oosSymbols.has(String(trade.symbol || '').trim().toUpperCase()));
  const isExpectancy = averageTradeR(isTrades);
  const oosExpectancy = averageTradeR(oosTrades);
  const reliable = isTrades.length >= minOosTrades && oosTrades.length >= minOosTrades;
  return {
    mode: 'symbol_70_30',
    is_expectancy: Number(isExpectancy.toFixed(4)),
    is_n: isTrades.length,
    oos_expectancy: Number(oosExpectancy.toFixed(4)),
    oos_n: oosTrades.length,
    is_symbol_count: isSymbols.size,
    oos_symbol_count: oosSymbols.size,
    oos_degradation_pct: Number(degradationPct(isExpectancy, oosExpectancy).toFixed(2)),
    reliable,
    reliability_note: reliable ? 'Reliable symbol-based OOS split.' : `Unreliable symbol OOS split: each side needs at least ${minOosTrades} trades.`,
  };
}

function computeWalkForwardDiagnostics(trades: TradeInstance[], minTradesPerWindow: number): any {
  const ordered = trades.slice().sort((a, b) => {
    const aTime = new Date(a.entry_time || '').getTime() || 0;
    const bTime = new Date(b.entry_time || '').getTime() || 0;
    return aTime - bTime;
  });
  const windowCount = Math.min(6, Math.max(1, Math.floor(ordered.length / Math.max(1, minTradesPerWindow))));
  const windows: any[] = [];
  for (let i = 0; i < windowCount; i += 1) {
    const start = Math.floor((ordered.length * i) / windowCount);
    const end = Math.floor((ordered.length * (i + 1)) / windowCount);
    const slice = ordered.slice(start, end);
    const expectancyR = averageTradeR(slice);
    windows.push({
      index: i + 1,
      start_date: slice[0]?.entry_time || '',
      end_date: slice[slice.length - 1]?.exit_time || slice[slice.length - 1]?.entry_time || '',
      trades: slice.length,
      expectancy_R: Number(expectancyR.toFixed(4)),
      profitable: expectancyR > 0,
      reliable: slice.length >= minTradesPerWindow,
    });
  }
  const validWindows = windows.filter((window) => window.reliable);
  const profitable = validWindows.filter((window) => window.profitable);
  const expectancies = validWindows.map((window) => Number(window.expectancy_R || 0));
  const reliable = validWindows.length >= 3;
  return {
    windows,
    total_windows: windows.length,
    valid_windows: validWindows.length,
    profitable_windows: profitable.length,
    losing_windows: validWindows.length - profitable.length,
    avg_test_expectancy: Number(averageNumber(expectancies).toFixed(4)),
    worst_window_expectancy: Number((expectancies.length ? Math.min(...expectancies) : 0).toFixed(4)),
    best_window_expectancy: Number((expectancies.length ? Math.max(...expectancies) : 0).toFixed(4)),
    pct_profitable_windows: validWindows.length ? profitable.length / validWindows.length : 0,
    reliable,
    reliability_note: reliable ? 'Reliable walk-forward windows.' : `Unreliable walk-forward: need at least 3 windows with ${minTradesPerWindow}+ trades each.`,
  };
}

function computeFundamentalRiskDiagnostics(trades: TradeInstance[]): { risk: any; monteCarlo: any } {
  const ordered = trades.slice().sort((a, b) => {
    const aTime = new Date(a.exit_time || a.entry_time || '').getTime() || 0;
    const bTime = new Date(b.exit_time || b.entry_time || '').getTime() || 0;
    return aTime - bTime;
  });
  const rValues = ordered.map((trade) => Number(trade.R_multiple || 0));
  const returnPcts = ordered.map((trade) => Number(trade.pnl_net || trade.pnl_gross || 0) / 100);

  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let equity = 1;
  let peakEquity = 1;
  let maxDrawdownPct = 0;
  let timeUnderWater = 0;
  let currentUnderWater = 0;
  const recoverySpans: number[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    cumulativeR += rValues[i] || 0;
    peakR = Math.max(peakR, cumulativeR);
    maxDrawdownR = Math.min(maxDrawdownR, cumulativeR - peakR);

    equity *= Math.max(0, 1 + (returnPcts[i] || 0));
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) {
      maxDrawdownPct = Math.max(maxDrawdownPct, Math.max(0, 1 - equity / peakEquity));
    }

    if (cumulativeR < peakR) {
      currentUnderWater += 1;
      timeUnderWater = Math.max(timeUnderWater, currentUnderWater);
    } else if (currentUnderWater > 0) {
      recoverySpans.push(currentUnderWater);
      currentUnderWater = 0;
    }
  }
  if (currentUnderWater > 0) recoverySpans.push(currentUnderWater);

  let losingStreak = 0;
  let winningStreak = 0;
  let longestLosingStreak = 0;
  let longestWinningStreak = 0;
  const losingStreaks: number[] = [];
  for (const value of rValues) {
    if (value <= 0) {
      losingStreak += 1;
      winningStreak = 0;
      longestLosingStreak = Math.max(longestLosingStreak, losingStreak);
    } else {
      if (losingStreak > 0) losingStreaks.push(losingStreak);
      losingStreak = 0;
      winningStreak += 1;
      longestWinningStreak = Math.max(longestWinningStreak, winningStreak);
    }
  }
  if (losingStreak > 0) losingStreaks.push(losingStreak);

  const avgReturn = averageNumber(returnPcts);
  const returnStd = stdDevNumber(returnPcts);
  const sharpe = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(returnPcts.length) : null;
  const totalReturn = equity - 1;
  const calmar = maxDrawdownPct > 0 ? totalReturn / maxDrawdownPct : null;

  const random = seededRandom(42);
  const simulations = rValues.length >= 2 ? 500 : 0;
  const monteCarloReliable = rValues.length >= 30;
  const mcDrawdownsR: number[] = [];
  const mcDrawdownsPct: number[] = [];
  const mcFinalR: number[] = [];
  for (let sim = 0; sim < simulations; sim += 1) {
    const sampledIndexes = rValues.map(() => Math.floor(random() * rValues.length));
    const sampled = sampledIndexes.map((idx) => rValues[idx] || 0);
    const sampledReturns = sampledIndexes.map((idx) => returnPcts[idx] || 0);
    mcDrawdownsR.push(Math.abs(maxDrawdownRForSequence(sampled)));
    mcDrawdownsPct.push(maxDrawdownPctForReturns(sampledReturns));
    mcFinalR.push(sampled.reduce((sum, value) => sum + value, 0));
  }

  return {
    risk: {
      max_drawdown_pct: Number(maxDrawdownPct.toFixed(4)),
      max_drawdown_R: Number(maxDrawdownR.toFixed(4)),
      longest_losing_streak: longestLosingStreak,
      avg_losing_streak: Number(averageNumber(losingStreaks).toFixed(2)),
      longest_winning_streak: longestWinningStreak,
      time_under_water_bars: timeUnderWater,
      time_under_water_trades: timeUnderWater,
      expected_recovery_time_bars: Number(averageNumber(recoverySpans).toFixed(2)),
      expected_recovery_trades: Number(averageNumber(recoverySpans).toFixed(2)),
      sharpe_ratio: sharpe == null ? null : Number(sharpe.toFixed(4)),
      calmar_ratio: calmar == null ? null : Number(calmar.toFixed(4)),
    },
    monteCarlo: {
      simulations,
      median_max_drawdown_R: Number(percentile(mcDrawdownsR, 50).toFixed(4)),
      p95_max_drawdown_R: Number(percentile(mcDrawdownsR, 95).toFixed(4)),
      p99_max_drawdown_R: Number(percentile(mcDrawdownsR, 99).toFixed(4)),
      p95_max_drawdown_pct: Number(percentile(mcDrawdownsPct, 95).toFixed(4)),
      p99_max_drawdown_pct: Number(percentile(mcDrawdownsPct, 99).toFixed(4)),
      median_dd_pct: Number((percentile(mcDrawdownsPct, 50) * 100).toFixed(2)),
      p95_dd_pct: Number((percentile(mcDrawdownsPct, 95) * 100).toFixed(2)),
      p99_dd_pct: Number((percentile(mcDrawdownsPct, 99) * 100).toFixed(2)),
      worst_dd_pct: Number((percentile(mcDrawdownsPct, 100) * 100).toFixed(2)),
      ruin_probability_pct: 0,
      median_final_R: Number(percentile(mcFinalR, 50).toFixed(4)),
      reliable: monteCarloReliable,
      reliability_note: monteCarloReliable ? 'Monte Carlo sample is large enough for directional reliability.' : 'Monte Carlo unreliable: fewer than 30 trades.',
    },
  };
}

async function runFundamentalValidatorPipeline(
  strategy: StrategySpec,
  dateStart: string,
  dateEnd: string,
  universe: string[],
  tier: ValidationTier,
  evidence: { mode?: EvidenceMode | null; target_trades?: number | null; source_universe_size?: number | null } = {},
  onProgress?: (evt: PipelineProgressEvent) => void,
  jobId?: string,
): Promise<{ report: ValidationReport; trades: TradeInstance[] }> {
  const reportId = `rpt_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  const strategyVersionId = String(strategy.strategy_version_id || 'unknown');
  const runnerPath = path.join(__dirname, '..', '..', 'scripts', 'run_fundamental_backtester.py');
  const tmpDir = path.join(__dirname, '..', '..', 'data', 'research');
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const configPath = path.join(tmpDir, `_tmp_fundamental_validator_${stamp}.json`);
  const outputJson = path.join(tmpDir, `_tmp_fundamental_validator_${stamp}_summary.json`);
  const outputCsv = path.join(tmpDir, `_tmp_fundamental_validator_${stamp}_trades.csv`);
  const sourceConfig = syncFundamentalValidatorSourceConfig(strategy, buildFundamentalSourceConfigFromStrategy(strategy));
  const config = {
    ...sourceConfig,
    name: sourceConfig.name || strategy.name || strategyVersionId,
    as_of_start: dateStart,
    as_of_end: dateEnd,
    universe: `validator_${tier}`,
    universe_symbols: universe,
    max_symbols: 0,
    evidence_mode: evidence.mode || null,
    evidence_target_trades: evidence.target_trades || null,
    evidence_source_universe_size: evidence.source_universe_size || universe.length,
  };

  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  const targetDetail = evidence.target_trades ? ` for target ${evidence.target_trades} trades` : '';
  onProgress?.({ progress: 0.10, stage: 'running_fundamental_validator', detail: `Running PIT fundamental validation on ${universe.length} symbols${targetDetail}...` });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('py', [runnerPath, '--config', configPath, '--output-json', outputJson, '--output-csv', outputCsv]);
    if (jobId) activeProcesses.set(jobId, proc);
    let stdout = '';
    let stderr = '';
    const timeoutMs = pipelineTimeoutMs(universe.length, tier);
    const timeout = setTimeout(() => {
      killProcessTree(proc);
      if (jobId) activeProcesses.delete(jobId);
      reject(new Error(`Fundamental validation timed out after ${Math.round(timeoutMs / 1000)}s (${universe.length} symbols)`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (jobId) activeProcesses.delete(jobId);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (jobId) activeProcesses.delete(jobId);
      if (code === 0) resolve();
      else reject(new Error(`fundamental validator exited with code ${code}: ${stderr || stdout}`));
    });
  });

  const summaryPayload = JSON.parse(await fs.readFile(outputJson, 'utf-8'));
  const tradeRows = parseFundamentalTradeCsv(await fs.readFile(outputCsv, 'utf-8').catch(() => ''));
  const summary = summaryPayload.summary || {};
  const evidenceSummary = summaryPayload.evidence || {};
  const configuredStopLossPct = Math.abs(Number(config?.exit?.stop_loss_pct || 0));
  const rToPct = configuredStopLossPct > 0 ? configuredStopLossPct : 100;
  const tradeInstances: TradeInstance[] = tradeRows.map((row, idx) => {
    const returnPct = Number(row.return_pct || 0);
    const rMultiple = returnPct / rToPct;
    return {
      trade_id: `${reportId}_${idx + 1}`,
      report_id: reportId,
      strategy_version_id: strategyVersionId,
      symbol: row.symbol || '',
      timeframe: '1d',
      direction: 'long',
      entry_time: row.entry_date || row.asof_date || '',
      entry_price: Number(row.entry_price || 0),
      entry_bar_index: 0,
      stop_price: 0,
      stop_distance: 0,
      exit_time: row.exit_date || '',
      exit_price: Number(row.exit_price || 0),
      exit_bar_index: Number(row.holding_days || 0),
      exit_reason: String(row.exit_reason || '').includes('stop') ? 'trailing' : String(row.exit_reason || '').includes('take_profit') ? 'target' : 'time',
      R_multiple: Number.isFinite(rMultiple) ? Number(rMultiple.toFixed(4)) : 0,
      pnl_gross: returnPct,
      pnl_net: returnPct,
      fees_applied: 0,
      slippage_applied: 0,
      setup_type: 'fundamental_backtest',
      anchors_snapshot: {},
    } as TradeInstance;
  });
  const winners = tradeInstances.filter((trade) => trade.R_multiple > 0);
  const losers = tradeInstances.filter((trade) => trade.R_multiple <= 0);
  const avgWin = winners.length ? winners.reduce((sum, trade) => sum + trade.R_multiple, 0) / winners.length : 0;
  const avgLoss = losers.length ? losers.reduce((sum, trade) => sum + trade.R_multiple, 0) / losers.length : 0;
  const totalR = tradeInstances.reduce((sum, trade) => sum + Number(trade.R_multiple || 0), 0);
  const avgDurationDays = averageNumber(tradeInstances.map((trade) => Number(trade.exit_bar_index || 0)));
  const fundamentalRisk = computeFundamentalRiskDiagnostics(tradeInstances);
  const minTradesReliable = 30;
  const targetTrades = evidence.target_trades && evidence.target_trades > 0
    ? Math.round(evidence.target_trades)
    : 50;
  const timeOos = computeTimeBasedOos(tradeInstances, Math.max(5, Math.floor(minTradesReliable * 0.25)));
  const symbolOos = computeSymbolBasedOos(tradeInstances, Math.max(5, Math.floor(minTradesReliable * 0.25)));
  const walkForward = computeWalkForwardDiagnostics(tradeInstances, Math.max(3, Math.floor(minTradesReliable / 6)));

  const report: ValidationReport = {
    report_id: reportId,
    strategy_version_id: strategyVersionId,
    created_at: new Date().toISOString(),
    config: {
      date_start: dateStart,
      date_end: dateEnd,
      universe,
      timeframes: ['1d'],
      validation_tier: tier,
      evidence_mode: evidence.mode || null,
      evidence_target_trades: evidence.target_trades || null,
      evidence_source_universe_size: evidence.source_universe_size || universe.length,
      evidence_target_reached: Boolean(evidenceSummary.target_reached),
      evidence_symbols_processed: Number(evidenceSummary.candidate_symbols_examined || evidenceSummary.evaluated_symbols || universe.length),
      evidence_symbols_with_trades: Number(evidenceSummary.symbols_with_trades || 0),
      evidence_candidate_rows_examined: Number(evidenceSummary.candidate_rows_examined || 0),
      evidence_trades_per_processed_symbol: Number(evidenceSummary.trades_per_candidate_symbol || 0),
      evidence_trades_per_source_symbol: Number(evidenceSummary.trades_per_source_symbol || 0),
      asset_class: 'stocks',
      costs: { commission_per_trade: 0, slippage_pct: 0.001 },
      validation_thresholds: {
        min_trades_pass: targetTrades,
        min_trades_fail: Math.min(30, targetTrades),
        strong_trades: Math.max(100, targetTrades),
        max_oos_degradation_pct: 50,
        min_wf_profitable_windows: 0.6,
        max_mc_p95_dd_pct: 30,
        max_mc_p99_dd_pct: 50,
        max_sensitivity_score: 40,
        r_to_pct: rToPct,
        r_conversion_mode: configuredStopLossPct > 0 ? 'stop_loss_pct' : 'percent_return',
      },
      universe_selection: tier === 'clean'
        ? (evidence.mode ? CLEAN_STOCK_FULL_UNIVERSE_RESULT : CLEAN_STOCK_UNIVERSE_RESULT)
        : undefined,
    },
    trades_summary: {
      total_trades: Number(summary.trade_count || 0),
      winners: winners.length,
      losers: losers.length,
      win_rate: Number(summary.win_rate || 0),
      avg_win_R: Number(avgWin.toFixed(4)),
      avg_loss_R: Number(avgLoss.toFixed(4)),
      expectancy_R: Number(((Number(summary.avg_return_pct || 0)) / rToPct).toFixed(4)),
      profit_factor: Math.abs(avgLoss) > 0 ? Number(((avgWin * winners.length) / Math.abs(avgLoss * losers.length || 1)).toFixed(4)) : 999,
      largest_win_R: Math.max(0, ...tradeInstances.map((trade) => trade.R_multiple)),
      largest_loss_R: Math.min(0, ...tradeInstances.map((trade) => trade.R_multiple)),
      total_R_return: Number(totalR.toFixed(4)),
      avg_trade_duration_days: Number(avgDurationDays.toFixed(2)),
    },
    risk_summary: fundamentalRisk.risk,
    robustness: {
      out_of_sample: {
        ...timeOos,
        time_based: timeOos,
        symbol_based: symbolOos,
      },
      walk_forward: walkForward,
      monte_carlo: fundamentalRisk.monteCarlo,
      parameter_sensitivity: { sensitivity_score: 0, tests: [] },
    } as any,
    execution_stats: {},
    pass_fail: 'NEEDS_REVIEW',
    pass_fail_reasons: [],
    trades_summary_by_source: undefined,
    fundamental_validation: {
      enabled: true,
      status: 'completed',
      source: 'fundamental_backtester',
      summary: summaryPayload,
      evidence: evidenceSummary || {
        mode: evidence.mode || null,
        target_trades: evidence.target_trades || null,
        source_universe_size: evidence.source_universe_size || universe.length,
        collected_trades: tradeInstances.length,
      },
      r_conversion: {
        mode: configuredStopLossPct > 0 ? 'stop_loss_pct' : 'percent_return',
        r_to_pct: rToPct,
        stop_loss_pct: configuredStopLossPct || null,
      },
    } as any,
  } as any as ValidationReport;

  const verdict = fundamentalReportVerdict(report, tier);
  (report as any).pass_fail = verdict.verdict;
  (report as any).pass_fail_reasons = verdict.reasons;

  onProgress?.({ progress: 0.98, stage: 'finalizing_report', detail: 'Fundamental validation complete. Finalizing report...' });
  return { report, trades: tradeInstances };
}

// =====================
// Strategy Endpoints
// =====================

/**
 * GET /api/validator/active-strategy
 * Returns the strategy_version_id currently configured for the execution bridge (the "active" strategy).
 */
router.get('/active-strategy', async (req: Request, res: Response) => {
  try {
    const strategyVersionId = getPersistedBridgeStrategyVersionId();
    res.json({ success: true, data: strategyVersionId } as ApiResponse<string | null>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

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
          fundamental_config: def.fundamental_config || undefined,
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
    const tierEvidenceByStrategy = new Map<string, Set<string>>();
    for (const report of allReports) {
      const strategyVersionId = String(report?.strategy_version_id || '').trim();
      const tier = normalizeValidatorTier(report?.config?.validation_tier);
      if (!strategyVersionId || !tier) continue;
      const evidenceBucket = tierEvidenceByStrategy.get(strategyVersionId) || new Set<string>();
      evidenceBucket.add(tier);
      tierEvidenceByStrategy.set(strategyVersionId, evidenceBucket);
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
        if (!shouldExposeStrategyInValidator(savedOverride, tierEvidenceByStrategy)) {
          continue;
        }
        mergedStrategies.push(stampBacktestStrategyTag({
          ...savedOverride,
          source: savedOverride.strategy_version_id?.startsWith('research_') ? 'research' : 'saved',
        }));
        continue;
      }
      if (!shouldExposeStrategyInValidator(strategy, tierEvidenceByStrategy)) {
        continue;
      }
      mergedStrategies.push(stampBacktestStrategyTag(strategy));
    }

    const mergedIds = new Set(mergedStrategies.map((s: any) => s.strategy_version_id));
    for (const s of allSaved) {
      if (mergedIds.has(s.strategy_version_id)) continue;
      // Exclude raw sweep variant files (status 'pending'/'running') but allow promoted ones
      if (s.strategy_version_id?.startsWith('sweep_')) {
        const status = String(s.status || '').toLowerCase();
        if (status !== 'testing' && status !== 'approved' && status !== 'active') continue;
      }
      if (String(s.status || '').toLowerCase() === 'rejected') continue;
      if (!shouldExposeStrategyInValidator(s, tierEvidenceByStrategy)) continue;
      mergedStrategies.push(stampBacktestStrategyTag({
        ...s,
        source: s.strategy_version_id?.startsWith('research_') ? 'research' : 'saved',
      }));
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
      fundamental_config: def.fundamental_config || undefined,
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
  res.status(410).json({
    success: false,
    error: 'Validator no longer creates strategies. Use POST /api/strategies from Strategy Builder, then run the saved strategy through Validator.',
  } as ApiResponse<null>);
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
    const {
      strategy_version_id,
      date_start,
      date_end,
      universe,
      tier,
      asset_class,
      interval,
      skip_tier_gate,
      force_refresh,
      valuation_forward_bars,
      valuation_rebalance_frequency,
      evidence_mode,
      evidence_target_trades,
    } = req.body;
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
      return res.status(400).json({ success: false, error: `tier must be one of: ${VALIDATION_TIER_KEYS.join(', ')}` } as ApiResponse<null>);
    }
    const parsedEvidenceMode = parseEvidenceMode(evidence_mode);
    if (evidence_mode != null && parsedEvidenceMode === null) {
      return res.status(400).json({ success: false, error: 'evidence_mode must be one of: evidence_50, evidence_100, evidence_200, evidence_500, full_clean' } as ApiResponse<null>);
    }
    const parsedEvidenceTargetTrades = parseEvidenceTargetTrades(evidence_target_trades, parsedEvidenceMode);
    if (
      evidence_target_trades != null &&
      parsedEvidenceMode == null &&
      parsedEvidenceTargetTrades == null
    ) {
      return res.status(400).json({ success: false, error: 'evidence_target_trades must be a positive number up to 5000' } as ApiResponse<null>);
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
    if (force_refresh != null && typeof force_refresh !== 'boolean') {
      return res.status(400).json({ success: false, error: 'force_refresh must be a boolean' } as ApiResponse<null>);
    }
    const valuationForwardBars = valuation_forward_bars == null
      ? null
      : Number(valuation_forward_bars);
    if (
      valuationForwardBars != null &&
      (!Number.isFinite(valuationForwardBars) || valuationForwardBars < 1 || valuationForwardBars > 520)
    ) {
      return res.status(400).json({ success: false, error: 'valuation_forward_bars must be between 1 and 520' } as ApiResponse<null>);
    }
    const valuationRebalanceFrequency = String(valuation_rebalance_frequency || '').trim().toLowerCase();
    if (
      valuationRebalanceFrequency &&
      valuationRebalanceFrequency !== 'monthly' &&
      valuationRebalanceFrequency !== 'quarterly'
    ) {
      return res.status(400).json({ success: false, error: 'valuation_rebalance_frequency must be monthly or quarterly' } as ApiResponse<null>);
    }

    const strategy = await resolveStrategy(strategy_version_id);
    if (!strategy) {
      return res.status(404).json({ success: false, error: `Strategy not found: ${strategy_version_id}` } as ApiResponse<null>);
    }
    const effectiveTier: ValidationTier = parsedTier || 'tier1';
    const effectiveAssetClass = parsedAssetClass || resolveStrategyAssetClass(strategy);
    const strategyInterval = parseValidationInterval((strategy as any)?.interval) || '1wk';
    const effectiveInterval = parsedInterval || strategyInterval;
    const effectiveUniverse = await getEvidenceUniverse(effectiveAssetClass, effectiveTier, parsedEvidenceMode);
    const existingReports = await storage.getAllValidationReports(strategy_version_id);
    const hasTierPass = (tierName: ValidationTier) =>
      existingReports.some((r: any) =>
        r?.pass_fail === 'PASS' &&
        r?.config?.validation_tier === tierName &&
        resolveReportAssetClass(r) === effectiveAssetClass
      );
    const latestTier1 = latestTierReport(existingReports, 'tier1', effectiveAssetClass)
      || latestTierReport(existingReports, 'tier1s', effectiveAssetClass);
    const latestTier1B = latestTierReport(existingReports, 'tier1b', effectiveAssetClass)
      || latestTierReport(existingReports, 'tier1bs', effectiveAssetClass);
    if (!skip_tier_gate) {
      if ((effectiveTier === 'tier1b' || effectiveTier === 'tier1bs') && !isTier1EvidenceExpansionEligible(latestTier1)) {
        return res.status(400).json({
          success: false,
          error: `Tier 1B/1BS requires an inconclusive Tier 1 result first for this strategy (${strategy_version_id}). Run Tier 1, then use Tier 1B only when the edge looks viable but the evidence is thin.`,
        } as ApiResponse<null>);
      }
      if (effectiveTier === 'tier2' && !(hasTierPass('tier1') || hasTierPass('tier1s') || hasTierPass('tier1b') || hasTierPass('tier1bs'))) {
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
      evidence_mode: parsedEvidenceMode,
      evidence_target_trades: parsedEvidenceTargetTrades,
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
      const tierLabel = parsedEvidenceMode
        ? `${VALIDATION_TIER_LABELS[effectiveTier]} / ${parsedEvidenceMode.replace('_', ' ')}`
        : VALIDATION_TIER_LABELS[effectiveTier];

      j.status = 'running';
      j.started_at = new Date().toISOString();
      j.progress = 0.1;
      j.stage = 'loading_data';
      j.detail = `Starting ${tierLabel} (${effectiveAssetClass}, ${effectiveInterval}, ${ds}..${de}): ${symCount} symbols (timeout: ${Math.round(runTimeoutSec / 60)}m)...`;
      j.elapsed_sec = 0;
      j.timeout_sec = runTimeoutSec;
      await persistRunJobs();

      // Auto-transition: move draft strategies to testing the moment validation starts
      try {
        const stratSpec = await storage.getStrategy(strategy_version_id);
        if (stratSpec && stratSpec.status === 'draft') {
          await storage.saveStrategy({ ...stratSpec, status: 'testing', updated_at: new Date().toISOString() }, true);
        }
      } catch { /* non-fatal */ }

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
        if (valuationForwardBars != null || valuationRebalanceFrequency) {
          (strategyForRun as any).fundamental_config = {
            ...((strategy as any).fundamental_config || {}),
            ...(valuationForwardBars != null ? { forward_bars: Math.round(valuationForwardBars) } : {}),
            ...(valuationRebalanceFrequency ? { rebalance_frequency: valuationRebalanceFrequency } : {}),
          };
        }
        const progressHandler = (evt: PipelineProgressEvent) => {
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
        };
        const { report, trades } = isFundamentalBacktestStrategy(strategyForRun)
          ? await runFundamentalValidatorPipeline(
              strategyForRun,
              ds,
              de,
              effectiveUniverse,
              effectiveTier,
              {
                mode: parsedEvidenceMode,
                target_trades: parsedEvidenceTargetTrades,
                source_universe_size: effectiveUniverse.length,
              },
              progressHandler,
              jobId,
            )
          : await runValidatorPipeline(
              strategyForRun,
              ds,
              de,
              effectiveUniverse,
              effectiveTier,
              {
                mode: parsedEvidenceMode,
                target_trades: parsedEvidenceTargetTrades,
              },
              Boolean(force_refresh),
              progressHandler,
              jobId,
            );
        clearInterval(progressTicker);
        j.progress = Math.max(j.progress, 0.98);
        j.stage = 'saving_results';
        j.detail = 'Persisting report and trade instances...';
        report.config = report.config || ({} as any);
        (report.config as any).validation_tier = effectiveTier;
        (report.config as any).evidence_mode = parsedEvidenceMode;
        (report.config as any).evidence_target_trades = parsedEvidenceTargetTrades;
        (report.config as any).evidence_source_universe_size = effectiveUniverse.length;
        (report.config as any).asset_class = effectiveAssetClass;
        (report.config as any).timeframes = [effectiveInterval];
        (report.config as any).universe = effectiveUniverse.slice();

        await storage.saveValidationReport(report);
        await storage.saveTradeInstances(report.report_id, trades);

        // Auto-approve: if this is a Tier 3 PASS, promote the strategy to approved in place
        if (effectiveTier === 'tier3' && String(report.pass_fail || '').toUpperCase() === 'PASS') {
          try {
            const existing = await storage.getStrategy(strategy_version_id);
            if (existing && existing.status !== 'approved') {
              await storage.saveStrategy({ ...existing, status: 'approved', updated_at: new Date().toISOString() }, true);
            }
          } catch { /* non-fatal — report is already saved */ }
        }

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
    await pruneSweepVariantsByReportId(req.params.id);
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
