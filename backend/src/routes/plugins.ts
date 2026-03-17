import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { ApiResponse } from '../types';
import { normalizeDefinitionTunableParams } from '../services/parameterManifest';
import {
  normalizePatternId,
  validatePluginRegisterPayload,
  validatePluginTestRequest,
  validateCandidateOutput,
  validatePythonCode,
  validateCompositeStagesExist,
} from '../services/pluginValidation';

const router = Router();

const PATTERNS_DIR = path.join(__dirname, '..', '..', 'data', 'patterns');
const SERVICES_DIR = path.join(__dirname, '..', '..', 'services');
const BASE_METHOD_TOMBSTONES_FILE = path.join(__dirname, '..', '..', 'data', 'research', 'base-method-tombstones.json');

// Port declarations for pipeline DAG mode (mirrors port_types.py)
const PORT_DECLARATIONS: Record<string, { inputs: Record<string, string>; outputs: Record<string, string> }> = {
  rdp_swing_structure: { inputs: {}, outputs: { swing_structure: 'SwingStructure', active_leg: 'ActiveLeg' } },
  fib_location_primitive: { inputs: { leg: 'ActiveLeg' }, outputs: { fib_levels: 'FibLevels' } },
  fib_signal_trigger_primitive: { inputs: { fib_levels: 'FibLevels' }, outputs: {} },
  energy_state_primitive: { inputs: {}, outputs: { energy_state: 'EnergyState' } },
  ma_crossover: { inputs: {}, outputs: {} },
  rsi_primitive: { inputs: {}, outputs: {} },
  regime_filter: { inputs: {}, outputs: { pattern_result: 'PatternResult' } },
};
const PLUGINS_DIR = path.join(SERVICES_DIR, 'plugins');
const REGISTRY_FILE = path.join(PATTERNS_DIR, 'registry.json');

function isWithin(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvePluginSourcePath(patternId: string, pluginFileFromDefinition: string): { fsPath: string; publicPath: string } {
  const raw = String(pluginFileFromDefinition || '').trim().replace(/\\/g, '/');
  const candidates: Array<{ fsPath: string; publicPath: string }> = [];

  if (raw) {
    if (path.isAbsolute(raw)) {
      candidates.push({
        fsPath: path.normalize(raw),
        publicPath: path.basename(raw),
      });
    } else {
      const normalized = raw.replace(/^\.?\//, '');
      candidates.push({
        fsPath: path.resolve(SERVICES_DIR, normalized),
        publicPath: normalized,
      });
    }
  }

  candidates.push({
    fsPath: path.join(PLUGINS_DIR, `${patternId}.py`),
    publicPath: `plugins/${patternId}.py`,
  });

  for (const candidate of candidates) {
    if (!isWithin(SERVICES_DIR, candidate.fsPath)) continue;
    if (fs.existsSync(candidate.fsPath)) return candidate;
  }

  const fallback = candidates[candidates.length - 1];
  return fallback;
}

type PatternCategory = {
  id: string;
  name: string;
  description?: string;
};

type PatternRegistryEntry = {
  pattern_id: string;
  name: string;
  category: string;
  definition_file: string;
  status?: string;
  artifact_type?: string;
  composition?: string;
  indicator_role?: string;
  pattern_role?: string;
};

type PatternRegistry = {
  version?: string;
  updated_at?: string;
  categories: PatternCategory[];
  patterns: PatternRegistryEntry[];
};

function buildDefinitionResolver(registry: PatternRegistry): (patternId: string) => Record<string, unknown> | null {
  const cache = new Map<string, Record<string, unknown> | null>();
  return (patternId: string) => {
    const key = String(patternId || '').trim();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key) || null;
    const entry = (registry.patterns || []).find((item) => String(item.pattern_id || '').trim() === key);
    if (!entry?.definition_file) {
      cache.set(key, null);
      return null;
    }
    const defPath = path.join(PATTERNS_DIR, String(entry.definition_file));
    if (!isWithin(PATTERNS_DIR, defPath) || !fs.existsSync(defPath)) {
      cache.set(key, null);
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(defPath, 'utf-8')) as Record<string, unknown>;
      cache.set(key, parsed);
      return parsed;
    } catch {
      cache.set(key, null);
      return null;
    }
  };
}

function nextAvailablePatternId(baseId: string, registry: PatternRegistry): string {
  const existing = new Set(
    (registry.patterns || []).map((p) => String(p.pattern_id || '').trim()).filter(Boolean),
  );
  if (!existing.has(baseId)) return baseId;

  let version = 2;
  while (true) {
    const candidate = `${baseId}_v${version}`;
    if (!existing.has(candidate)) return candidate;
    version += 1;
  }
}

function toPythonString(value: string): string {
  return JSON.stringify(value);
}

function timeframeFromInterval(interval: string): string {
  const normalized = String(interval || '').trim().toLowerCase();
  if (normalized.includes('wk')) return 'W';
  if (normalized.includes('mo')) return 'M';
  if (normalized === '1d') return 'D';
  if (normalized.endsWith('h')) return normalized.toUpperCase();
  if (normalized.endsWith('m')) return normalized.toUpperCase();
  return 'D';
}

async function ensureRegistry(): Promise<PatternRegistry> {
  await fsp.mkdir(PATTERNS_DIR, { recursive: true });

  if (!fs.existsSync(REGISTRY_FILE)) {
    const emptyRegistry: PatternRegistry = {
      version: '1.0.0',
      updated_at: new Date().toISOString(),
      categories: [
        { id: 'chart_patterns', name: 'Chart Patterns', description: 'Classical price structure patterns.' },
        { id: 'indicator_signals', name: 'Indicator Signals', description: 'Signals from technical indicators.' },
        { id: 'price_action', name: 'Price Action', description: 'Raw price behavior patterns.' },
        { id: 'custom', name: 'Custom', description: 'User-defined or AI-generated detection plugins.' },
      ],
      patterns: [],
    };
    await fsp.writeFile(REGISTRY_FILE, JSON.stringify(emptyRegistry, null, 2), 'utf-8');
    return emptyRegistry;
  }

  const raw = await fsp.readFile(REGISTRY_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<PatternRegistry>;

  return {
    version: parsed.version || '1.0.0',
    updated_at: parsed.updated_at,
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
  };
}

async function writeRegistry(registry: PatternRegistry): Promise<void> {
  registry.updated_at = new Date().toISOString();
  await fsp.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
}

type BaseMethodTombstoneEntry = {
  pattern_id: string;
  name?: string;
  tombstoned_at: string;
  source?: string;
  reason?: string;
};

type BaseMethodTombstoneStore = {
  schema_version: number;
  updated_at: string | null;
  entries: BaseMethodTombstoneEntry[];
};

async function ensureBaseMethodTombstones(): Promise<BaseMethodTombstoneStore> {
  const dir = path.dirname(BASE_METHOD_TOMBSTONES_FILE);
  await fsp.mkdir(dir, { recursive: true });
  if (!fs.existsSync(BASE_METHOD_TOMBSTONES_FILE)) {
    const seed: BaseMethodTombstoneStore = {
      schema_version: 1,
      updated_at: null,
      entries: [],
    };
    await fsp.writeFile(BASE_METHOD_TOMBSTONES_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }

  try {
    const raw = await fsp.readFile(BASE_METHOD_TOMBSTONES_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BaseMethodTombstoneStore>;
    return {
      schema_version: 1,
      updated_at: parsed.updated_at || null,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return {
      schema_version: 1,
      updated_at: null,
      entries: [],
    };
  }
}

async function writeBaseMethodTombstones(store: BaseMethodTombstoneStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  await fsp.writeFile(BASE_METHOD_TOMBSTONES_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function extractLastJsonObject(stdout: string): unknown | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Continue scanning upwards for the last JSON line.
    }
  }
  return null;
}

// GET /api/plugins
router.get('/', async (_req: Request, res: Response) => {
  try {
    const registry = await ensureRegistry();
    res.json({ success: true, data: registry } as ApiResponse<PatternRegistry>);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// GET /api/plugins/primitives
router.get('/primitives', async (_req: Request, res: Response) => {
  try {
    const registry = await ensureRegistry();
    const primitives: Array<{
      pattern_id: string;
      name: string;
      indicator_role: string;
      description: string;
      composition: string;
      artifact_type: string;
      category: string;
      tunable_params: Array<Record<string, unknown>>;
      default_setup_params: Record<string, unknown>;
      port_inputs: Record<string, string>;
      port_outputs: Record<string, string>;
    }> = [];

    for (const pattern of registry.patterns || []) {
      if (!pattern?.pattern_id || !pattern?.definition_file) continue;
      const definitionPath = path.join(PATTERNS_DIR, pattern.definition_file);
      if (!fs.existsSync(definitionPath)) continue;

      let definition: Record<string, unknown> = {};
      try {
        const raw = await fsp.readFile(definitionPath, 'utf-8');
        definition = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const composition = String((definition as any).composition || (pattern as any).composition || 'composite')
        .trim()
        .toLowerCase();
      if (composition !== 'primitive') continue;

      const artifactType = String((definition as any).artifact_type || (pattern as any).artifact_type || 'indicator')
        .trim()
        .toLowerCase();

      const tunableParams = Array.isArray((definition as any).tunable_params)
        ? (definition as any).tunable_params as Array<Record<string, unknown>>
        : [];
      const defaultSetupParams = (definition as any).default_setup_params &&
        typeof (definition as any).default_setup_params === 'object'
        ? { ...(definition as any).default_setup_params as Record<string, unknown> }
        : {};
      delete defaultSetupParams.pattern_type;

      const patternId = String(pattern.pattern_id);
      const portDecl = PORT_DECLARATIONS[patternId] || { inputs: {}, outputs: {} };

      primitives.push({
        pattern_id: patternId,
        name: String((definition as any).name || pattern.name || pattern.pattern_id),
        indicator_role: String((definition as any).indicator_role || 'unknown'),
        description: String((definition as any).description || ''),
        composition,
        artifact_type: artifactType,
        category: String((definition as any).category || pattern.category || 'custom'),
        tunable_params: tunableParams,
        default_setup_params: defaultSetupParams,
        port_inputs: { data: 'PriceData', ...portDecl.inputs },
        port_outputs: { signal: 'Signal', ...portDecl.outputs },
      });
    }

    primitives.sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
    return res.json({ success: true, data: primitives });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// GET /api/plugins/patterns — non-primitive items (patterns, composites)
router.get('/patterns', async (_req: Request, res: Response) => {
  try {
    const registry = await ensureRegistry();
    const patterns: Array<{
      pattern_id: string;
      name: string;
      description: string;
      composition: string;
      artifact_type: string;
      category: string;
      indicator_role: string;
      pattern_role: string;
      port_inputs: Record<string, string>;
      port_outputs: Record<string, string>;
    }> = [];

    for (const pattern of registry.patterns || []) {
      if (!pattern?.pattern_id || !pattern?.definition_file) continue;
      const definitionPath = path.join(PATTERNS_DIR, pattern.definition_file);
      if (!fs.existsSync(definitionPath)) continue;

      let definition: Record<string, unknown> = {};
      try {
        const raw = await fsp.readFile(definitionPath, 'utf-8');
        definition = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const composition = String((definition as any).composition || (pattern as any).composition || 'composite')
        .trim().toLowerCase();
      if (composition === 'primitive') continue;

      const artifactType = String((definition as any).artifact_type || (pattern as any).artifact_type || 'pattern')
        .trim().toLowerCase();

      patterns.push({
        pattern_id: String(pattern.pattern_id),
        name: String((definition as any).name || pattern.name || pattern.pattern_id),
        description: String((definition as any).description || ''),
        composition,
        artifact_type: artifactType,
        category: String((definition as any).category || pattern.category || 'custom'),
        indicator_role: String((definition as any).indicator_role || '').trim(),
        pattern_role: String((definition as any).pattern_role || (pattern as any).pattern_role || '').trim(),
        port_inputs: { data: 'PriceData' },
        port_outputs: { signal: 'Signal', pattern_result: 'PatternResult' },
      });
    }

    patterns.sort((a, b) => a.pattern_id.localeCompare(b.pattern_id));
    return res.json({ success: true, data: patterns });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// GET /api/plugins/scanner/options
router.get('/scanner/options', async (_req: Request, res: Response) => {
  try {
    const registry = await ensureRegistry();
    const tombstones = await ensureBaseMethodTombstones();
    const tombstonedIds = new Set(
      (tombstones.entries || [])
        .map((entry) => String(entry?.pattern_id || '').trim())
        .filter(Boolean),
    );
    const options: Array<{
      pattern_id: string;
      name: string;
      pattern_type: string;
      category: string;
      status: string;
      artifact_type: string;
      composition: string;
      tombstoned: boolean;
    }> = [];

    for (const pattern of registry.patterns || []) {
      if (!pattern?.pattern_id) continue;

      let definition: Record<string, unknown> = {};
      if (pattern?.definition_file) {
        const definitionPath = path.join(PATTERNS_DIR, pattern.definition_file);
        if (fs.existsSync(definitionPath)) {
          try {
            const raw = await fsp.readFile(definitionPath, 'utf-8');
            definition = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            // Keep scanner options resilient: include registry entry even if definition parse fails.
            definition = {};
          }
        }
      }

      const setup = (definition.default_setup_params || {}) as Record<string, unknown>;
      const patternType = String(
        setup.pattern_type || definition.pattern_type || pattern.pattern_id
      ).trim() || String(pattern.pattern_id);

      options.push({
        pattern_id: String(pattern.pattern_id),
        name: String(pattern.name || definition.name || pattern.pattern_id),
        pattern_type: patternType,
        category: String(pattern.category || definition.category || 'custom'),
        status: String(pattern.status || definition.status || 'unknown'),
        artifact_type: String((pattern as any).artifact_type || (definition as any).artifact_type || 'indicator'),
        composition: String((pattern as any).composition || (definition as any).composition || 'composite'),
        tombstoned: tombstonedIds.has(String(pattern.pattern_id)),
      });
    }

    // Sort by category, then name
    options.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });

    res.json({ success: true, data: options });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.get('/scanner/tombstones', async (_req: Request, res: Response) => {
  try {
    const store = await ensureBaseMethodTombstones();
    return res.json({ success: true, data: store } as ApiResponse<BaseMethodTombstoneStore>);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

router.post('/scanner/tombstones', async (req: Request, res: Response) => {
  try {
    const patternId = String(req.body?.patternId || '').trim();
    const source = String(req.body?.source || 'workshop_dropdown_x').trim();
    const reason = String(req.body?.reason || 'Tombstoned from workshop scanner dropdown').trim();
    if (!patternId) {
      return res.status(400).json({ success: false, error: 'patternId is required' } as ApiResponse<null>);
    }

    const registry = await ensureRegistry();
    const pattern = (registry.patterns || []).find((p) => String(p?.pattern_id || '').trim() === patternId);
    const store = await ensureBaseMethodTombstones();
    const now = new Date().toISOString();

    const nextEntry: BaseMethodTombstoneEntry = {
      pattern_id: patternId,
      name: String(pattern?.name || patternId),
      tombstoned_at: now,
      source,
      reason,
    };

    const existingIndex = (store.entries || []).findIndex((entry) => String(entry?.pattern_id || '').trim() === patternId);
    if (existingIndex >= 0) {
      store.entries[existingIndex] = nextEntry;
    } else {
      store.entries.push(nextEntry);
    }
    await writeBaseMethodTombstones(store);

    return res.json({ success: true, data: nextEntry } as ApiResponse<BaseMethodTombstoneEntry>);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// GET /api/plugins/chart-indicators
// Returns registered indicators/composites formatted for the Chart Indicators panel.
// Excludes patterns (not visual). Includes chart_indicator flag from definitions.
router.get('/chart-indicators', async (_req: Request, res: Response) => {
  try {
    const registry = await ensureRegistry();
    const items: Array<{
      id: string;
      name: string;
      category: string;
      pluginId: string;
      backend: boolean;
      colors: string[];
      indicator_role?: string;
      composition?: string;
    }> = [];

    for (const pattern of registry.patterns || []) {
      if (!pattern?.pattern_id) continue;

      const artifactType = String((pattern as any).artifact_type || 'indicator').toLowerCase();
      // Skip patterns — they are not chart indicators
      if (artifactType === 'pattern') continue;

      let definition: Record<string, unknown> = {};
      if (pattern?.definition_file) {
        const definitionPath = path.join(PATTERNS_DIR, pattern.definition_file);
        if (fs.existsSync(definitionPath)) {
          try {
            const raw = await fsp.readFile(definitionPath, 'utf-8');
            definition = JSON.parse(raw) as Record<string, unknown>;
          } catch { definition = {}; }
        }
      }

      // chart_indicator flag: explicit true/false wins; otherwise default true for primitives and composites
      const composition = String((pattern as any).composition || definition.composition || 'composite').toLowerCase();
      const chartIndicatorFlag = definition.chart_indicator;
      const isChartIndicator = chartIndicatorFlag === true ||
        (chartIndicatorFlag === undefined && (composition === 'primitive' || composition === 'composite'));
      if (!isChartIndicator) continue;

      const role = String((pattern as any).indicator_role || (definition as any).indicator_role || '').toLowerCase();

      // Map to chart indicator category
      let category = 'user_composite';
      if (role === 'anchor_structure' || role === 'structure_filter') {
        category = 'structure';
      } else if (composition === 'primitive' && role === 'context') {
        category = 'visual_composite';
      } else if (composition === 'primitive') {
        category = 'structure';
      }

      items.push({
        id: String(pattern.pattern_id),
        name: String(pattern.name || definition.name || pattern.pattern_id),
        category,
        pluginId: String(pattern.pattern_id),
        backend: true,
        colors: ['#6366f1'],
        indicator_role: role || undefined,
        composition: composition || undefined,
      });
    }

    items.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// POST /api/plugins/test
router.post('/test', async (req: Request, res: Response) => {
  const code = String(req.body?.code || '').trim();
  const symbol = String(req.body?.symbol || '').trim().toUpperCase();
  const interval = String(req.body?.interval || '1d').trim();
  const period = String(req.body?.period || '2y').trim();
  const requestedPatternId = String(req.body?.pattern_id || '').trim();
  const patternId = requestedPatternId || 'test_plugin';
  const definitionBody = req.body?.definition && typeof req.body.definition === 'object'
    ? req.body.definition as Record<string, unknown>
    : null;
  const indicatorRole = String(definitionBody?.indicator_role || '').trim();
  const validationIssues = validatePluginTestRequest(code, symbol, patternId);
  if (validationIssues.length) {
    return res.status(400).json({
      success: false,
      error: validationIssues[0].message,
      data: { errors: validationIssues },
    } as ApiResponse<{ errors: unknown[] }>);
  }

  const timeframe = timeframeFromInterval(interval);
  const tempName = `_temp_plugin_${uuidv4().slice(0, 8)}.py`;
  const tempPluginPath = path.join(SERVICES_DIR, tempName);

  const harness = [
    'import json',
    'import os',
    'import sys',
    'import traceback',
    'from typing import Any, Dict, List, Optional, Tuple, Set, Callable',
    '',
    'sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))',
    '',
    'from strategyRunner import run_strategy, PLUGINS',
    'from patternScanner import fetch_data_yfinance, OHLCV',
    '',
    `pattern_id = ${toPythonString(patternId)}`,
    `plugin_source = ${toPythonString(code)}`,
    `plugin_file_path = ${toPythonString(tempPluginPath)}`,
    "plugin_globals = {",
    "    '__name__': 'plugin_module',",
    "    '__file__': plugin_file_path,",
    "    '__package__': None,",
    "    'Any': Any,",
    "    'Dict': Dict,",
    "    'List': List,",
    "    'Optional': Optional,",
    "    'Tuple': Tuple,",
    "    'Set': Set,",
    "    'Callable': Callable,",
    "    'OHLCV': OHLCV,",
    "}",
    '',
    'try:',
    '    exec(plugin_source, plugin_globals)',
    'except Exception as e:',
    "    print(json.dumps({'error': f'Plugin code failed to load: {str(e)}', 'traceback': traceback.format_exc()}))",
    '    sys.exit(1)',
    '',
    'preferred_fn_name = f"run_{pattern_id}_plugin"',
    'plugin_fn = plugin_globals.get(preferred_fn_name)',
    '',
    'if not callable(plugin_fn):',
    '    plugin_fn = None',
    '    for name, obj in list(plugin_globals.items()):',
    "        if callable(obj) and ((name.startswith('run_') and name.endswith('_plugin')) or (name.startswith('detect_') and name.endswith('_plugin'))):",
    '            plugin_fn = obj',
    '            break',
    '',
    'if plugin_fn is None:',
    "    print(json.dumps({'error': \"No plugin function found. Define run_<pattern_id>_plugin or detect_<pattern_id>_plugin.\"}))",
    '    sys.exit(1)',
    '',
    'PLUGINS[pattern_id] = plugin_fn',
    '',
    `indicator_role = ${toPythonString(indicatorRole)}`,
    `default_setup = ${definitionBody?.default_setup_params ? `json.loads(${toPythonString(JSON.stringify(definitionBody.default_setup_params))})` : '{}'}`,
    `structure_cfg = ${definitionBody?.default_structure_config ? `json.loads(${toPythonString(JSON.stringify(definitionBody.default_structure_config))})` : "{'swing_method': 'major', 'swing_epsilon_pct': 0.05}"}`,
    "setup_config = {**default_setup, 'pattern_type': pattern_id, 'indicator_role': indicator_role}",
    'spec = {',
    "  'strategy_id': 'test_' + pattern_id,",
    "  'strategy_version_id': 'test_' + pattern_id + '_v1',",
    "  'version': 1,",
    "  'structure_config': structure_cfg,",
    "  'setup_config': setup_config,",
    "  'indicator_role': indicator_role,",
    "  'entry_config': {'confirmation_bars': 1}",
    '}',
    '',
    `data = fetch_data_yfinance(${toPythonString(symbol)}, period=${toPythonString(period)}, interval=${toPythonString(interval)})`,
    'if not data:',
    `    print(json.dumps({'error': 'No data for ${symbol}'}))`,
    '    sys.exit(1)',
    '',
    "results = run_strategy(spec, data, " + toPythonString(symbol) + ', ' + toPythonString(timeframe) + ", mode='scan')",
    "print(json.dumps({'candidates': results, 'count': len(results)}))",
    '',
  ].join('\n');

  try {
    await fsp.writeFile(tempPluginPath, harness, 'utf-8');

    const runResult = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const proc = spawn('py', [tempPluginPath], { cwd: SERVICES_DIR });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (payload: { stdout: string; stderr: string; exitCode: number }) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };

      const timeout = setTimeout(() => {
        proc.kill();
        finish({ stdout, stderr: `${stderr}\nTimeout: plugin test took too long`, exitCode: 1 });
      }, 60_000);

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (exitCode) => {
        clearTimeout(timeout);
        finish({ stdout, stderr, exitCode: exitCode || 0 });
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        finish({ stdout, stderr: `${stderr}\n${err.message}`, exitCode: 1 });
      });
    });

    if (runResult.exitCode !== 0) {
      const parsedError = extractLastJsonObject(runResult.stdout);
      const parsedErrorObj =
        parsedError && typeof parsedError === 'object'
          ? (parsedError as Record<string, unknown>)
          : null;
      const parsedErrorText = String(parsedErrorObj?.error || '').trim();
      const parsedTraceback = String(parsedErrorObj?.traceback || '').trim();
      const isPluginLoadFailure =
        parsedErrorText.startsWith('Plugin code failed to load') ||
        parsedErrorText.startsWith('No plugin function found');

      return res.json({
        success: false,
        error: parsedErrorText || 'Plugin execution failed',
        data: {
          stdout: runResult.stdout,
          stderr: runResult.stderr,
          traceback: parsedTraceback,
          error_source: isPluginLoadFailure ? 'plugin_code' : 'plugin_runtime',
          phase: isPluginLoadFailure ? 'plugin_load' : 'plugin_runtime',
        },
      });
    }

    const parsed = extractLastJsonObject(runResult.stdout);
    if (!parsed || typeof parsed !== 'object') {
      return res.json({
        success: false,
        error: 'No JSON output from plugin test',
        data: {
          stdout: runResult.stdout,
          stderr: runResult.stderr,
        },
      });
    }

    // Gate 1: Validate candidate output structure
    const parsedObj = parsed as Record<string, unknown>;
    const candidates = Array.isArray(parsedObj.candidates) ? parsedObj.candidates : [];
    const candidateValidation = validateCandidateOutput(candidates, patternId);

    return res.json({
      success: true,
      data: {
        ...parsedObj,
        stderr: runResult.stderr,
        validation_passed: candidateValidation.validation_passed,
        validation_errors: candidateValidation.validation_errors,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  } finally {
    try {
      await fsp.unlink(tempPluginPath);
    } catch {
      // Ignore cleanup errors for temp files.
    }
  }
});

// POST /api/plugins/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    const definition = req.body?.definition;
    const requestedPatternId = String(req.body?.pattern_id || '').trim();
    const overwrite = req.body?.overwrite === true;
    const validation = validatePluginRegisterPayload({
      code,
      definition,
      requestedPatternId,
    });
    if (validation.issues.length) {
      return res.status(400).json({
        success: false,
        error: validation.issues[0].message,
        data: { errors: validation.issues },
      } as ApiResponse<{ errors: unknown[] }>);
    }

    // Gate 2: Python code validation (AST-based, deterministic)
    // Composites using composite_runner.py get a thin wrapper — skip compute_spec_hash check
    const defPluginFile = String((definition as Record<string, unknown>).plugin_file || '').trim();
    const isCompositeUsingRunner =
      validation.composition === 'composite' &&
      defPluginFile === 'plugins/composite_runner.py';

    if (!isCompositeUsingRunner) {
      const codeValidation = await validatePythonCode(code, validation.patternId);
      if (!codeValidation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Plugin code validation failed',
          data: {
            errors: codeValidation.errors.map((msg) => ({
              code: 'python_validation_error',
              field: 'code',
              message: msg,
            })),
          },
        } as ApiResponse<{ errors: unknown[] }>);
      }
    }

    await fsp.mkdir(PATTERNS_DIR, { recursive: true });
    await fsp.mkdir(PLUGINS_DIR, { recursive: true });

    const registry = await ensureRegistry();
    const patternId = validation.patternId;
    const existingIdx = registry.patterns.findIndex((item) => item.pattern_id === patternId);
    const assignedPatternId = overwrite ? patternId : nextAvailablePatternId(patternId, registry);
    const renamed = assignedPatternId !== patternId;

    // Composite stage validation: all referenced primitives must be registered
    if (validation.composition === 'composite') {
      const registeredIds = new Set(
        (registry.patterns || []).map((p) => String(p.pattern_id || '').trim()).filter(Boolean),
      );
      const stageErrors = validateCompositeStagesExist(
        definition as Record<string, unknown>,
        registeredIds,
      );
      if (stageErrors.length) {
        return res.status(400).json({
          success: false,
          error: 'Composite stage validation failed',
          data: {
            errors: stageErrors.map((msg) => ({
              code: 'composite_stage_not_registered',
              field: 'composite_spec.stages',
              message: msg,
            })),
          },
        } as ApiResponse<{ errors: unknown[] }>);
      }
    }

    if (existingIdx >= 0 && overwrite) {
      // Explicit overwrite path: keep same id.
    }

    // Composites using composite_runner keep their plugin_file/plugin_function
    const compositeRunnerDef = isCompositeUsingRunner;
    const rawNormalizedDefinition: Record<string, unknown> = {
      ...(definition as Record<string, unknown>),
      pattern_id: assignedPatternId,
      pattern_type: assignedPatternId,
      plugin_file: compositeRunnerDef ? 'plugins/composite_runner.py' : `plugins/${assignedPatternId}.py`,
      plugin_function: compositeRunnerDef ? 'run_composite_plugin' : `run_${assignedPatternId}_plugin`,
      category: validation.category,
      composition: validation.composition,
      artifact_type: validation.artifactType,
    };
    const normalizedDefinition = normalizeDefinitionTunableParams(
      rawNormalizedDefinition,
      buildDefinitionResolver(registry),
    );

    const definitionFile = `${assignedPatternId}.json`;
    const definitionPath = path.join(PATTERNS_DIR, definitionFile);
    const pluginPath = path.join(PLUGINS_DIR, `${assignedPatternId}.py`);

    await fsp.writeFile(definitionPath, JSON.stringify(normalizedDefinition, null, 2), 'utf-8');
    await fsp.writeFile(pluginPath, code, 'utf-8');

    if (!registry.categories.some((c) => c.id === 'custom')) {
      registry.categories.push({
        id: 'custom',
        name: 'Custom',
        description: 'User-defined or AI-generated detection plugins',
      });
    }

    const entry: PatternRegistryEntry = {
      pattern_id: assignedPatternId,
      name: String((definition as Record<string, unknown>).name || assignedPatternId),
      category: validation.category,
      definition_file: definitionFile,
      status: String((definition as Record<string, unknown>).status || 'experimental'),
      artifact_type: validation.artifactType,
      composition: validation.composition,
      indicator_role: String((definition as Record<string, unknown>).indicator_role || '').trim() || undefined,
      pattern_role: String((definition as Record<string, unknown>).pattern_role || '').trim() || undefined,
    };

    if (existingIdx >= 0 && overwrite) {
      registry.patterns[existingIdx] = entry;
    } else {
      registry.patterns.push(entry);
    }

    await writeRegistry(registry);

    return res.json({
      success: true,
      data: {
        pattern_id: assignedPatternId,
        original_pattern_id: patternId,
        renamed,
        overwrite,
        definition_file: definitionFile,
        plugin_file: `plugins/${assignedPatternId}.py`,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// GET /api/plugins/:id/source
router.get('/:id/source', async (req: Request, res: Response) => {
  try {
    const patternId = normalizePatternId(req.params.id);
    if (!patternId) {
      return res.status(400).json({ success: false, error: 'invalid pattern id' } as ApiResponse<null>);
    }

    const registry = await ensureRegistry();
    const pattern = registry.patterns.find((item) => item.pattern_id === patternId);
    if (!pattern) {
      return res.status(404).json({ success: false, error: 'Pattern not found' } as ApiResponse<null>);
    }

    const definitionPath = path.join(PATTERNS_DIR, pattern.definition_file);
    const definitionRaw = await fsp.readFile(definitionPath, 'utf-8');
    const definition = JSON.parse(definitionRaw) as Record<string, unknown>;

    const pluginFileFromDefinition = String(definition.plugin_file || '').trim();
    const resolved = resolvePluginSourcePath(patternId, pluginFileFromDefinition);

    if (!fs.existsSync(resolved.fsPath)) {
      return res.status(404).json({ success: false, error: 'Plugin source not found' } as ApiResponse<null>);
    }

    const code = await fsp.readFile(resolved.fsPath, 'utf-8');
    return res.json({
      success: true,
      data: {
        pattern_id: patternId,
        plugin_file: resolved.publicPath,
        code,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// GET /api/plugins/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const patternId = normalizePatternId(req.params.id);
    if (!patternId) {
      return res.status(400).json({ success: false, error: 'invalid pattern id' } as ApiResponse<null>);
    }

    const registry = await ensureRegistry();
    const pattern = registry.patterns.find((item) => item.pattern_id === patternId);
    if (!pattern) {
      return res.status(404).json({ success: false, error: 'Pattern not found' } as ApiResponse<null>);
    }

    const definitionPath = path.join(PATTERNS_DIR, pattern.definition_file);
    const definitionRaw = await fsp.readFile(definitionPath, 'utf-8');
    const definition = JSON.parse(definitionRaw);

    return res.json({ success: true, data: definition });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

// PUT /api/plugins/:patternId/definition — overwrite full JSON definition in place
router.put('/:patternId/definition', async (req: Request, res: Response) => {
  try {
    const patternId = String(req.params.patternId || '').trim();
    if (!patternId) {
      return res.status(400).json({ success: false, error: 'pattern_id is required.' });
    }

    const definition = req.body?.definition;
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      return res.status(400).json({ success: false, error: 'Request body must include a "definition" object.' });
    }

    if (!definition.pattern_id) {
      return res.status(400).json({ success: false, error: 'definition.pattern_id is required.' });
    }
    if (String(definition.pattern_id).trim() !== patternId) {
      return res.status(400).json({ success: false, error: 'definition.pattern_id must match the URL parameter.' });
    }

    const registry = await ensureRegistry();
    const entry = (registry.patterns || []).find(
      (p: Record<string, unknown>) => String(p.pattern_id || '').trim() === patternId
    );
    if (!entry) {
      return res.status(404).json({ success: false, error: `Indicator "${patternId}" not found in registry.` });
    }

    const defFile = String(entry.definition_file || '').trim();
    if (!defFile) {
      return res.status(404).json({ success: false, error: 'No definition file found for this indicator.' });
    }

    const defPath = path.join(PATTERNS_DIR, defFile);
    if (!isWithin(PATTERNS_DIR, defPath) || !fs.existsSync(defPath)) {
      return res.status(404).json({ success: false, error: 'Definition file not found on disk.' });
    }

    // Preserve plugin_file and plugin_function from disk — don't allow remapping via JSON editor
    const existing = JSON.parse(await fsp.readFile(defPath, 'utf-8'));
    const safe = normalizeDefinitionTunableParams(
      { ...(definition as Record<string, unknown>) },
      buildDefinitionResolver(registry),
    );
    if (existing.plugin_file) safe.plugin_file = existing.plugin_file;
    if (existing.plugin_function) safe.plugin_function = existing.plugin_function;

    await fsp.writeFile(defPath, JSON.stringify(safe, null, 2), 'utf-8');

    // Mirror name, category, status into registry
    for (const field of ['name', 'category', 'status'] as const) {
      if (safe[field] !== undefined) {
        (entry as Record<string, unknown>)[field] = safe[field];
      }
    }
    await writeRegistry(registry);

    return res.json({ success: true, data: { pattern_id: patternId } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Server error.' });
  }
});

// PATCH /api/plugins/:patternId/meta — update editable metadata fields
router.patch('/:patternId/meta', async (req: Request, res: Response) => {
  try {
    const patternId = String(req.params.patternId || '').trim();
    if (!patternId) {
      return res.status(400).json({ success: false, error: 'pattern_id is required.' });
    }

    const EDITABLE_FIELDS = ['name', 'description', 'category', 'indicator_role', 'status'] as const;
    const updates: Record<string, string> = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = String(req.body[field]).trim();
      }
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'No editable fields provided.' });
    }

    const registry = await ensureRegistry();
    const entry = (registry.patterns || []).find(
      (p: Record<string, unknown>) => String(p.pattern_id || '').trim() === patternId
    );
    if (!entry) {
      return res.status(404).json({ success: false, error: `Indicator "${patternId}" not found in registry.` });
    }

    const defFile = String(entry.definition_file || '').trim();
    if (!defFile) {
      return res.status(404).json({ success: false, error: 'No definition file found for this indicator.' });
    }

    const defPath = path.join(PATTERNS_DIR, defFile);
    if (!isWithin(PATTERNS_DIR, defPath) || !fs.existsSync(defPath)) {
      return res.status(404).json({ success: false, error: 'Definition file not found on disk.' });
    }

    const raw = await fsp.readFile(defPath, 'utf-8');
    const definition = JSON.parse(raw);

    for (const [field, value] of Object.entries(updates)) {
      definition[field] = value;
    }

    await fsp.writeFile(defPath, JSON.stringify(definition, null, 2), 'utf-8');

    // Also update registry entry fields that are mirrored there
    for (const field of ['name', 'category', 'status'] as const) {
      if (updates[field] !== undefined) {
        (entry as Record<string, unknown>)[field] = updates[field];
      }
    }
    await fsp.writeFile(
      path.join(PATTERNS_DIR, 'registry.json'),
      JSON.stringify(registry, null, 2),
      'utf-8'
    );

    return res.json({ success: true, data: { pattern_id: patternId, updated: updates } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Server error.' });
  }
});

// DELETE /api/plugins/:patternId — remove indicator from registry + delete JSON definition + plugin file
router.delete('/:patternId', async (req: Request, res: Response) => {
  try {
    const patternId = String(req.params.patternId || '').trim();
    if (!patternId) {
      return res.status(400).json({ success: false, error: 'pattern_id is required.' });
    }

    const registry = await ensureRegistry();
    const idx = (registry.patterns || []).findIndex(
      (p: Record<string, unknown>) => String(p.pattern_id || '').trim() === patternId
    );
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Indicator "${patternId}" not found in registry.` });
    }

    const entry = registry.patterns[idx];
    const deletedFiles: string[] = [];

    // Delete JSON definition file
    const defFile = String(entry.definition_file || '').trim();
    if (defFile) {
      const defPath = path.join(PATTERNS_DIR, defFile);
      if (isWithin(PATTERNS_DIR, defPath) && fs.existsSync(defPath)) {
        // Read definition to find plugin file before deleting
        try {
          const definition = JSON.parse(await fsp.readFile(defPath, 'utf-8'));
          const pluginFile = String(definition.plugin_file || '').trim();

          // Delete plugin .py file (but NOT composite_runner.py — it's shared infrastructure)
          if (pluginFile && !pluginFile.includes('composite_runner')) {
            const pluginPath = path.join(SERVICES_DIR, pluginFile);
            if (isWithin(SERVICES_DIR, pluginPath) && fs.existsSync(pluginPath)) {
              await fsp.unlink(pluginPath);
              deletedFiles.push(pluginFile);
            }
          }
        } catch { /* definition read failed — still remove from registry */ }

        await fsp.unlink(defPath);
        deletedFiles.push(defFile);
      }
    }

    // Remove from registry
    registry.patterns.splice(idx, 1);
    await writeRegistry(registry);

    return res.json({
      success: true,
      data: { pattern_id: patternId, deleted_files: deletedFiles },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Server error.' });
  }
});

export default router;
