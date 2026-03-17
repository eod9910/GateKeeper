/**
 * Strategies API Routes
 * 
 * CRUD for StrategySpec objects. Provides endpoints for the scanner
 * to list/select strategies and create new versions.
 * 
 * Note: The validator routes (/api/validator/strategies) also provide
 * access to strategies. These routes are a scanner-focused subset.
 */

import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as storage from '../services/storageService';
import { applyParameterManifest } from '../services/parameterManifest';
import { applyRolePromptOverride, getConfiguredOpenAIKey } from '../services/aiSettings';
import { StrategySpec, ApiResponse } from '../types';

const router = Router();
const ASSET_CLASSES = ['futures', 'stocks', 'options', 'forex', 'crypto'] as const;
type StrategyAssetClass = (typeof ASSET_CLASSES)[number];
const PATTERNS_DIR = path.join(__dirname, '..', '..', 'data', 'patterns');
const REGISTRY_PATH = path.join(PATTERNS_DIR, 'registry.json');
const VALIDATOR_JOBS_PATH = path.join(__dirname, '..', '..', 'data', 'validator-run-jobs.json');

function isValidSymbol(s: string): boolean {
  return /^[A-Z0-9._\-=^]{1,15}$/.test(s);
}

const resolveCompositeStrategy = storage.resolveCompositeStrategy;

function toRegistryInterval(timeframe: string | undefined): string {
  if (timeframe === 'W') return '1wk';
  if (timeframe === 'D') return '1d';
  return '1wk';
}

async function readPatternRegistry(): Promise<any> {
  const raw = await fs.readFile(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function writePatternRegistry(registry: any): Promise<void> {
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

function buildRegistryStrategy(entry: any, def: any, updatedAt: string): StrategySpec {
  return applyParameterManifest({
    strategy_id: entry.pattern_id,
    strategy_version_id: `${entry.pattern_id}_v1`,
    version: 1,
    name: entry.name || def.name,
    description: def.description || '',
    status: (entry.status || 'experimental') as any,
    asset_class: 'stocks' as any,
    interval: toRegistryInterval(def.suggested_timeframes?.[0]) as any,
    universe: [],
    structure_config: def.default_structure_config || {},
    setup_config: { pattern_type: def.pattern_type || entry.pattern_id, ...def.default_setup_params },
    entry_config: def.default_entry || {},
    risk_config: (def.default_risk_config || { stop_type: 'structural' }) as any,
    exit_config: {},
    cost_config: { commission_per_trade: 0, slippage_pct: 0.001 },
    execution_config: {},
    created_at: updatedAt,
    updated_at: updatedAt,
  } as unknown as StrategySpec, def);
}

async function getRegistryStrategies(statusFilter?: string): Promise<StrategySpec[]> {
  const registry = await readPatternRegistry();
  const validatable = (registry.patterns || []).filter((p: any) =>
    p.composition === 'composite' || p.composition === 'monolithic' || p.artifact_type === 'pattern'
  );
  const items = await Promise.all(validatable.map(async (entry: any) => {
    try {
      const def = JSON.parse(await fs.readFile(path.join(PATTERNS_DIR, entry.definition_file), 'utf-8'));
      const updatedAt = def.updated_at || registry.updated_at || new Date().toISOString();
      return buildRegistryStrategy(entry, def, updatedAt);
    } catch {
      return null;
    }
  }));
  return items.filter((item): item is StrategySpec => {
    if (!item) return false;
    return !statusFilter || item.status === statusFilter;
  });
}

async function updateRegistryStrategyStatus(strategyVersionId: string, status: StrategySpec['status']): Promise<StrategySpec | null> {
  const registry = await readPatternRegistry();
  const idx = (registry.patterns || []).findIndex((entry: any) =>
    `${entry.pattern_id}_v1` === strategyVersionId || entry.pattern_id === strategyVersionId
  );
  if (idx < 0) return null;

  registry.patterns[idx].status = status;
  registry.updated_at = new Date().toISOString();
  await writePatternRegistry(registry);

  const entry = registry.patterns[idx];
  try {
    const def = JSON.parse(await fs.readFile(path.join(PATTERNS_DIR, entry.definition_file), 'utf-8'));
    return buildRegistryStrategy(entry, def, registry.updated_at);
  } catch {
    return null;
  }
}

async function deleteValidatorJobsByStrategy(strategyVersionId: string): Promise<number> {
  try {
    const raw = await fs.readFile(VALIDATOR_JOBS_PATH, 'utf-8');
    const jobs = JSON.parse(raw);
    if (!Array.isArray(jobs)) return 0;
    const kept = jobs.filter((job: any) => String(job?.strategy_version_id || '').trim() !== strategyVersionId);
    const deleted = jobs.length - kept.length;
    if (deleted > 0) {
      await fs.writeFile(VALIDATOR_JOBS_PATH, JSON.stringify(kept, null, 2), 'utf-8');
    }
    return deleted;
  } catch {
    return 0;
  }
}

function parseUniverse(input: any): string[] | null {
  if (input == null) return [];
  if (!Array.isArray(input)) return null;
  const arr = input.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
  if (arr.length > 500) return null;
  if (arr.some((s) => !isValidSymbol(s))) return null;
  return arr;
}

function parseAssetClass(input: any): StrategyAssetClass | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  return (ASSET_CLASSES as readonly string[]).includes(value) ? (value as StrategyAssetClass) : null;
}

function inferAssetClass(prompt: string, universe: any): StrategyAssetClass {
  const p = String(prompt || '').toLowerCase();
  const symbols = Array.isArray(universe) ? universe.map((s) => String(s || '').toUpperCase()) : [];
  if (p.includes('option')) return 'options';
  if (p.includes('future') || symbols.some((s) => s.includes('=F'))) return 'futures';
  if (p.includes('forex') || p.includes('fx') || symbols.some((s) => s.endsWith('=X'))) return 'forex';
  if (p.includes('crypto') || symbols.some((s) => s.endsWith('-USD'))) return 'crypto';
  return 'stocks';
}

function validateStrategyPayload(input: any): string | null {
  if (!input || typeof input !== 'object') return 'strategy payload must be an object';
  if (!input.strategy_id || typeof input.strategy_id !== 'string') return 'strategy_id is required';
  if (!input.name || typeof input.name !== 'string') return 'name is required';
  if (input.asset_class != null && parseAssetClass(input.asset_class) === null) {
    return 'asset_class must be one of: futures, stocks, options, forex, crypto';
  }
  if (input.status != null && !['draft', 'testing', 'approved', 'rejected'].includes(input.status)) {
    return 'status must be one of: draft, testing, approved, rejected';
  }
  if (input.interval != null && typeof input.interval !== 'string') return 'interval must be a string';
  if (input.universe != null && parseUniverse(input.universe) === null) return 'universe must be an array of valid symbols';
  return null;
}

function buildDraftFromPrompt(prompt: string): Partial<StrategySpec> {
  const p = String(prompt || '').toLowerCase();
  const now = new Date().toISOString();

  const isRdp = p.includes('rdp');
  const isOptions = p.includes('option');
  const isFutures = p.includes('future');
  const isForex = p.includes('forex') || p.includes('fx') || p.includes('eurusd') || p.includes('gbpusd');
  const isCrypto = p.includes('crypto') || p.includes('bitcoin') || p.includes('btc') || p.includes('eth');
  const isShort = p.includes('short');
  const conservative = p.includes('conservative') || p.includes('low risk');
  const aggressive = p.includes('aggressive') || p.includes('high risk');
  const inferredAssetClass: StrategyAssetClass = isCrypto
    ? 'crypto'
    : isForex
    ? 'forex'
    : isOptions
    ? 'options'
    : isFutures
    ? 'futures'
    : 'stocks';
  const defaultUniverse =
    inferredAssetClass === 'futures'
      ? ['ES=F', 'NQ=F', 'CL=F']
      : inferredAssetClass === 'options'
      ? ['SPY', 'QQQ']
      : inferredAssetClass === 'forex'
      ? ['EURUSD=X', 'GBPUSD=X']
      : inferredAssetClass === 'crypto'
      ? ['BTC-USD', 'ETH-USD']
      : ['SPY', 'QQQ', 'IWM'];

  const stopValue = conservative ? 0.06 : aggressive ? 0.1 : 0.08;
  const tpR = conservative ? 1.8 : aggressive ? 2.5 : 2.0;

  return {
    strategy_id: 'strategy_draft',
    version: 1,
    strategy_version_id: '',
    status: 'draft',
    asset_class: inferredAssetClass,
    name: 'AI Draft Strategy',
    description: `Draft generated from prompt: ${prompt || 'N/A'}`,
    scan_mode: 'wyckoff',
    trade_direction: isShort ? 'short' : 'long',
    interval: '1wk',
    universe: defaultUniverse,
    structure_config: {
      swing_method: isRdp ? 'rdp' : 'major',
      swing_epsilon_pct: isRdp ? 0.04 : 0.05,
      swing_left_bars: 5,
      swing_right_bars: 5,
      swing_first_peak_decline: 0.5,
      swing_subsequent_decline: 0.25,
      base_min_duration: 8,
      base_max_duration: 80,
      base_max_range_pct: 0.3,
      base_volatility_threshold: 0.08,
      causal: false,
    },
    setup_config: {
      pattern_type: 'wyckoff_accumulation',
      min_markdown_pct: 0.5,
      pullback_retracement_min: 0.5,
      pullback_retracement_max: 0.88,
    },
    entry_config: {
      trigger: 'second_breakout',
      confirmation_bars: 1,
      enter_next_open: true,
    },
    risk_config: {
      stop_type: 'fixed_pct',
      stop_value: stopValue,
      take_profit_R: tpR,
      max_hold_bars: 30,
    },
    exit_config: {
      target_type: 'R_multiple',
      target_level: tpR,
      time_stop_bars: 30,
      trailing: null,
    },
    cost_config: {
      commission_per_trade: 1.0,
      slippage_pct: 0.05,
    },
    execution_config: isOptions
      ? {
          scale_out_rules: [
            { at_multiple: 2.0, pct_close: 0.5 },
            { at_multiple: 3.0, pct_close: 0.25 },
          ],
          winner_never_to_red_r: 3.0,
          production_lock: true,
        }
      : isFutures
      ? {
          auto_breakeven_r: 1.0,
          lock_in_r_ladder: [
            { at_r: 2, lock_r: 1 },
            { at_r: 3, lock_r: 2 },
          ],
          production_lock: true,
        }
      : { production_lock: true },
    created_at: now,
    updated_at: now,
  };
}

/**
 * GET /api/strategies
 * List all strategies, optionally filtered by status.
 * Query params: ?status=approved&strategy_id=wyckoff_accumulation
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    let strategies = await storage.getAllStrategies();

    // Filter by status
    const statusFilter = req.query.status as string | undefined;
    if (statusFilter) {
      strategies = strategies.filter(s => s.status === statusFilter);
    }

    // Filter by strategy_id
    const idFilter = req.query.strategy_id as string | undefined;
    if (idFilter) {
      strategies = strategies.filter(s => s.strategy_id === idFilter);
    }

    res.json({ success: true, data: strategies } as ApiResponse<StrategySpec[]>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * GET /api/strategies/tombstones
 * Aggregate rejected strategies for the Tombstones page.
 */
router.get('/tombstones', async (_req: Request, res: Response) => {
  try {
    const savedStrategies = (await storage.getAllStrategies())
      .filter((strategy) => strategy?.status === 'rejected');
    const registryStrategies = await getRegistryStrategies('rejected');
    const seen = new Set(savedStrategies.map((strategy) => strategy.strategy_version_id));
    const strategies = savedStrategies.concat(
      registryStrategies.filter((strategy) => !seen.has(strategy.strategy_version_id))
    );

    const entries = await Promise.all(strategies.map(async (strategy) => {
      const reports = await storage.getAllValidationReports(strategy.strategy_version_id);
      reports.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      const latestReport = reports[0] || null;
      const latestFailedReport = reports.find((report) => report.pass_fail === 'FAIL') || latestReport;
      return {
        strategy_id: strategy.strategy_id,
        strategy_version_id: strategy.strategy_version_id,
        name: strategy.name,
        description: strategy.description || '',
        status: strategy.status,
        asset_class: strategy.asset_class || null,
        interval: strategy.interval || null,
        tombstoned_at: strategy.updated_at || strategy.created_at || null,
        source: 'strategy_status_rejected',
        reason: latestFailedReport?.pass_fail_reasons?.join(' | ') || 'Strategy marked rejected.',
        latest_report_id: latestFailedReport?.report_id || null,
        latest_validation_tier: latestFailedReport?.config?.validation_tier || null,
        latest_pass_fail: latestFailedReport?.pass_fail || null,
        latest_metrics: latestFailedReport ? {
          total_trades: latestFailedReport?.trades_summary?.total_trades ?? null,
          expectancy_R: latestFailedReport?.trades_summary?.expectancy_R ?? null,
          profit_factor: latestFailedReport?.trades_summary?.profit_factor ?? null,
          win_rate: latestFailedReport?.trades_summary?.win_rate ?? null,
          max_drawdown_pct: latestFailedReport?.risk_summary?.max_drawdown_pct ?? null,
        } : null,
      };
    }));

    const latestUpdatedAt = entries.reduce<string | null>((latest, entry) => {
      if (!entry?.tombstoned_at) return latest;
      if (!latest) return entry.tombstoned_at;
      return new Date(entry.tombstoned_at).getTime() > new Date(latest).getTime() ? entry.tombstoned_at : latest;
    }, null);

    res.json({
      success: true,
      data: {
        updated_at: latestUpdatedAt,
        entries,
      },
    } as ApiResponse<any>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * GET /api/strategies/:id
 * Get a specific strategy version by strategy_version_id.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const spec = await storage.getStrategy(req.params.id);
    if (!spec) {
      return res.status(404).json({ success: false, error: 'Strategy not found' } as ApiResponse<null>);
    }
    res.json({ success: true, data: spec } as ApiResponse<StrategySpec>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * DELETE /api/strategies/:id
 * Hard delete saved strategies and their validator artifacts.
 * Registry-backed primitives/patterns are not deletable here.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const strategyVersionId = String(req.params.id || '').trim();
    if (!strategyVersionId) {
      return res.status(400).json({ success: false, error: 'Strategy id is required' } as ApiResponse<null>);
    }

    const saved = await storage.getStrategy(strategyVersionId);
    if (!saved) {
      const registryStrategy = await resolveCompositeStrategy(strategyVersionId);
      if (registryStrategy) {
        return res.status(409).json({
          success: false,
          error: 'Registry-backed strategies cannot be deleted. Tombstone them instead.',
        } as ApiResponse<null>);
      }
      return res.status(404).json({ success: false, error: 'Strategy not found' } as ApiResponse<null>);
    }

    const deletedReports = await storage.deleteValidationReportsByStrategy(strategyVersionId);
    const deletedJobs = await deleteValidatorJobsByStrategy(strategyVersionId);
    const deletedStrategy = await storage.deleteStrategy(strategyVersionId);
    if (!deletedStrategy) {
      return res.status(404).json({ success: false, error: 'Strategy not found' } as ApiResponse<null>);
    }

    return res.json({
      success: true,
      data: {
        strategy_version_id: strategyVersionId,
        deleted_reports: deletedReports,
        deleted_jobs: deletedJobs,
      },
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * POST /api/strategies
 * Create a new strategy version. Auto-assigns version number.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const validationError = validateStrategyPayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError } as ApiResponse<null>);
    }

    const spec: StrategySpec = req.body;
    spec.asset_class = parseAssetClass(spec.asset_class) || undefined;
    if (spec.universe) {
      spec.universe = parseUniverse(spec.universe) || [];
    }

    // Auto-increment version
    const existing = await storage.getAllStrategies();
    const siblings = existing.filter(s => s.strategy_id === spec.strategy_id);
    const maxVersion = siblings.reduce((max, s) => Math.max(max, Number(s.version) || 0), 0);
    spec.version = maxVersion + 1;
    spec.strategy_version_id = `${spec.strategy_id}_v${spec.version}`;
    spec.status = spec.status || 'draft';
    spec.created_at = spec.created_at || new Date().toISOString();
    spec.updated_at = new Date().toISOString();
    Object.assign(spec, applyParameterManifest(spec));

    const id = await storage.saveStrategy(spec);

    res.json({
      success: true,
      data: {
        strategy_version_id: id,
        version: spec.version,
        status: spec.status
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * PATCH /api/strategies/:id
 * Edit an existing strategy version in-place.
 *
 * This endpoint intentionally updates the same strategy_version_id.
 * It preserves identity fields (strategy_version_id/version/strategy_id)
 * and overwrites the remaining editable fields.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    let existing = await storage.getStrategy(req.params.id);
    if (!existing) {
      existing = await resolveCompositeStrategy(req.params.id);
    }
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Strategy not found' } as ApiResponse<null>);
    }

    const input = req.body || {};
    const validationError = validateStrategyPayload({
      ...existing,
      ...input,
      // Identity is fixed for in-place edit.
      strategy_id: existing.strategy_id,
      strategy_version_id: existing.strategy_version_id,
      version: existing.version
    });
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError } as ApiResponse<null>);
    }

    const merged: StrategySpec = {
      ...existing,
      ...input,
      strategy_id: existing.strategy_id,
      strategy_version_id: existing.strategy_version_id,
      version: existing.version,
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };

    if (merged.universe) {
      merged.universe = parseUniverse(merged.universe) || [];
    }
    merged.asset_class = parseAssetClass(merged.asset_class) || undefined;
    Object.assign(merged, applyParameterManifest(merged));

    await storage.saveStrategy(merged, true);

    res.json({
      success: true,
      data: {
        strategy_version_id: merged.strategy_version_id,
        version: merged.version,
        status: merged.status
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * POST /api/strategies/generate-draft
 * AI-powered strategy draft generator. Uses GPT-4o with the hypothesis_author
 * role to convert a natural language prompt into a complete StrategySpec JSON.
 * Falls back to keyword-based template if OpenAI is not configured.
 */
router.post('/generate-draft', async (req: Request, res: Response) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required'
      } as ApiResponse<null>);
    }

    const OPENAI_API_KEY = getConfiguredOpenAIKey();
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your-openai-api-key-here') {
      // Fallback to keyword-based template
      const draft = buildDraftFromPrompt(prompt);
      return res.json({ success: true, data: draft });
    }

    // AI-powered generation
    const draft = await generateDraftWithAI(prompt, OPENAI_API_KEY);
    res.json({ success: true, data: draft });
  } catch (error: any) {
    console.error('[generate-draft] Error:', error.message);
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * Use GPT-4o to generate a complete StrategySpec from a natural language prompt.
 * The AI is given the full schema and instructed to output ONLY valid JSON.
 */
async function generateDraftWithAI(prompt: string, apiKey: string): Promise<Partial<StrategySpec>> {
  const systemPrompt = applyRolePromptOverride('research_strategist', `You are the Strategy Hypothesis Author. You convert natural language trading ideas into complete, machine-executable StrategySpec JSON.

YOUR TASK: Given the user's description, output a COMPLETE StrategySpec JSON object. Every section must be filled in with reasonable values. Do not leave any section empty.

RESPOND WITH ONLY THE JSON OBJECT. No markdown, no explanation, no code fences. Just the raw JSON.

## STRATEGYSPEC SCHEMA (you must fill ALL of these)

{
  "strategy_id": "snake_case_name",       // descriptive, e.g. "mean_reversion_rsi"
  "version": 1,
  "strategy_version_id": "",              // leave empty, system will set it
  "status": "draft",                      // always "draft"
  "asset_class": "stocks",                // futures | stocks | options | forex | crypto
  "name": "Human Readable Name",
  "description": "1-3 sentence hypothesis. What market condition does this exploit? Why should it work?",

  "interval": "1wk",                     // one of: "1wk", "1d", "4h", "1h", "15m", "5m"
  "trade_direction": "long",             // "long", "short", or "both"
  "universe": [],                        // symbol list, or [] for "scan everything"

  "structure_config": {
    "swing_method": "rdp",               // "major" or "rdp"
    "swing_epsilon_pct": 0.05,           // RDP sensitivity (0.01-0.10)
    "swing_left_bars": 10,               // local pivot window
    "swing_right_bars": 10,
    "swing_first_peak_decline": 0.50,    // major mode: first peak confirmation
    "swing_subsequent_decline": 0.25,    // major mode: subsequent reversal
    "base_min_duration": 20,             // min bars for a base
    "base_max_duration": 500,            // max bars
    "base_max_range_pct": 0.80,          // max range as % of midpoint
    "base_volatility_threshold": 0.10,   // max avg bar range / close
    "causal": false
  },

  "setup_config": {
    "pattern_type": "wyckoff_accumulation",  // determines which plugin runs
    "min_prominence": 0.2,
    "peak_lookback": 50,
    "min_markdown_pct": 0.70,
    "markdown_lookback": 300,
    "base_resistance_closes": 3,
    "markup_lookforward": 100,
    "markup_min_breakout_bars": 2,
    "pullback_lookforward": 200,
    "pullback_retracement_min": 0.30,
    "pullback_retracement_max": 5.0,
    "double_bottom_tolerance": 1.05,
    "breakout_multiplier": 1.02,
    "score_min": 0
  },

  "entry_config": {
    "trigger": "second_breakout",        // what fires the entry
    "breakout_pct_above": 0.02,          // % above trigger level
    "confirmation_bars": 1               // bars that must confirm
  },

  "risk_config": {
    "stop_type": "structural",           // "structural", "atr_multiple", "fixed_pct", "swing_low"
    "stop_level": "base_low",            // which anchor for the stop
    "stop_buffer_pct": 0.02              // buffer below anchor
  },

  "exit_config": {
    "target_type": "fibonacci",          // "fibonacci", "atr_multiple", "percentage", "R_multiple"
    "target_level": 0.25,                // depends on target_type
    "time_stop_bars": null,
    "trailing": null
  },

  "cost_config": {
    "commission_per_trade": 0,
    "spread_pct": 0.001,
    "slippage_pct": 0.001
  },

  "execution_config": {
    "auto_breakeven_r": 1.0,
    "lock_in_r_ladder": [{"at_r": 2, "lock_r": 1}, {"at_r": 3, "lock_r": 2}],
    "green_to_red_protection": {"trigger_r": 1.5, "floor_r": 0.25, "action": "close_market"},
    "daily_profit_cap_usd": 500,
    "daily_profit_cap_action": "close_all_and_pause",
    "production_lock": true
  }
}

## RULES
1. pattern_type MUST be "wyckoff_accumulation" — this is the only plugin currently available.
2. All numeric thresholds must be reasonable. Don't use extreme values.
3. Adjust parameters based on the timeframe: shorter timeframes need tighter thresholds.
4. If the user mentions options, include scale_out_rules, winner_never_to_red_r, time_stop, profit_retrace_exit in execution_config.
5. If the user mentions futures, include auto_breakeven_r, lock_in_r_ladder, green_to_red_protection, daily_profit_cap_usd.
6. If the user specifies symbols, put them in universe. Otherwise use [].
7. strategy_id should be snake_case, descriptive of the idea.
8. description should state the hypothesis clearly — what market condition, why it works.
9. Adjust risk_config based on risk tolerance: conservative = tighter stops, lower R targets. Aggressive = wider stops, higher R targets.
10. asset_class is optional metadata; if provided use one of futures, stocks, options, forex, crypto.

OUTPUT ONLY THE JSON. NO OTHER TEXT.`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate a complete strategy spec for this idea:\n\n${prompt}` }
      ],
      temperature: 0.7,
      max_tokens: 2000,
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[generate-draft] OpenAI error:', err);
    throw new Error('AI generation failed — falling back to template');
  }

  const data = await response.json() as any;
  let rawContent = data.choices?.[0]?.message?.content || '';

  // Strip markdown code fences if the AI added them
  rawContent = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let draft: Partial<StrategySpec>;
  try {
    draft = JSON.parse(rawContent);
  } catch (parseErr) {
    console.error('[generate-draft] Failed to parse AI JSON:', rawContent.substring(0, 200));
    throw new Error('AI returned invalid JSON — try a more specific prompt');
  }

  // Enforce invariants
  const now = new Date().toISOString();
  draft.status = 'draft';
  draft.version = 1;
  draft.strategy_version_id = '';
  draft.asset_class = parseAssetClass((draft as any).asset_class) || inferAssetClass(prompt, (draft as any).universe);
  draft.created_at = now;
  draft.updated_at = now;

  // Ensure strategy_id is snake_case
  if (draft.strategy_id) {
    draft.strategy_id = draft.strategy_id.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  } else {
    draft.strategy_id = 'ai_draft_' + Date.now();
  }

  return draft;
}

/**
 * PATCH /api/strategies/:id/status
 * Update a strategy's status. Body: { status: "approved" | "testing" | "rejected" | "draft" }
 */
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'testing', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be one of: draft, testing, approved, rejected'
      } as ApiResponse<null>);
    }

    const updated = await storage.updateStrategyStatus(req.params.id, status)
      || await updateRegistryStrategyStatus(req.params.id, status);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Strategy not found' } as ApiResponse<null>);
    }

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

export default router;
