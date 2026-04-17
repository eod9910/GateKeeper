/**
 * Parameter Sweep API Routes
 */

import { Router, Request, Response } from 'express';
import {
  runSweep,
  getSweep,
  listSweeps,
  promoteWinner,
  cancelSweep,
  deleteSweepVariant,
  deleteSweep,
  loadAllSweeps,
  computeVariantCount,
  SweepParamDef,
} from '../services/sweepEngine';
import { getAllStrategies, getAllValidationReports } from '../services/storageService';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();

void loadAllSweeps();

type SweepStage = 'tier1' | 'tier1s' | 'tier1b' | 'tier1bs' | 'tier2' | 'tier2r' | 'tier3';

function latestReportByTier(reports: any[], strategyVersionId: string, tier: string): any | null {
  const matches = reports
    .filter((report: any) =>
      String(report?.strategy_version_id || '').trim() === strategyVersionId &&
      String(report?.config?.validation_tier || '').trim().toLowerCase() === tier
    )
    .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
  return matches[0] || null;
}

function resolveSweepStage(reports: any[], strategyVersionId: string): { stage: SweepStage; title: string } | null {
  const latestTier3 = latestReportByTier(reports, strategyVersionId, 'tier3');
  if (latestTier3?.pass_fail === 'PASS') {
    return { stage: 'tier3', title: 'Tier 3 baseline' };
  }

  const latestTier2 = latestReportByTier(reports, strategyVersionId, 'tier2');
  if (latestTier2?.pass_fail === 'PASS') {
    return { stage: 'tier2', title: 'Tier 2 candidate' };
  }
  if (latestTier2?.pass_fail === 'NEEDS_REVIEW') {
    return { stage: 'tier2r', title: 'Tier 2 review candidate' };
  }

  const tier1Tiers = ['tier1s', 'tier1bs', 'tier1b', 'tier1'] as const;
  for (const t of tier1Tiers) {
    const latest = latestReportByTier(reports, strategyVersionId, t);
    if (!latest) continue;
    const verdict = String(latest.pass_fail || '').toUpperCase();
    if (verdict !== 'PASS' && verdict !== 'NEEDS_REVIEW') continue;

    const expectancy = Number(latest.trades_summary?.expectancy_R ?? latest.robustness?.out_of_sample?.is_expectancy ?? -1);
    const profitFactor = Number(latest.trades_summary?.profit_factor ?? 0);
    const maxDD = Number(latest.risk_summary?.max_drawdown_pct ?? 100);

    if (expectancy >= 0.4 && profitFactor >= 1.0 && maxDD <= 20) {
      return { stage: t, title: `${t.toUpperCase()} diagnostic sweep` };
    }
  }

  return null;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

const SWEEP_PRESETS: Record<string, SweepParamDef[]> = {
  stop_type: [
    {
      label: 'Stop Type',
      param_path: 'risk_config.stop_type',
      values: ['percentage', 'atr', 'swing_low'],
    },
  ],
  atr_multiplier: [
    {
      label: 'ATR Multiplier',
      param_path: 'risk_config.atr_multiplier',
      values: [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0],
    },
  ],
  stop_pct: [
    {
      label: 'Stop %',
      param_path: 'risk_config.stop_value',
      values: [0.03, 0.05, 0.08, 0.10, 0.12, 0.15],
    },
  ],
  take_profit_r: [
    {
      label: 'Take Profit R',
      param_path: 'risk_config.take_profit_R',
      values: [1.5, 2.0, 2.5, 3.0, 4.0],
    },
  ],
  max_hold_bars: [
    {
      label: 'Max Hold Bars',
      param_path: 'risk_config.max_hold_bars',
      values: [13, 26, 39, 52],
    },
  ],
  rsi_oversold: [
    {
      label: 'RSI Oversold Level',
      param_path: 'setup_config.composite_spec.stages.1.params.oversold_level',
      values: [20, 25, 30, 35, 40],
    },
  ],
  rdp_epsilon: [
    {
      label: 'RDP Epsilon %',
      param_path: 'structure_config.swing_epsilon_pct',
      values: [0.01, 0.02, 0.03, 0.05, 0.07, 0.10, 0.15],
    },
  ],
  max_concurrent: [
    {
      label: 'Max Concurrent Positions',
      param_path: 'risk_config.max_concurrent_positions',
      values: [3, 5, 8, 10, 15, 20],
    },
  ],
  timeframe: [
    {
      label: 'Timeframe',
      param_path: 'interval',
      values: ['1d', '4h', '1h', '15m'],
    },
  ],
};

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/presets', (_req: Request, res: Response) => {
  const presets = Object.entries(SWEEP_PRESETS).map(([key, params]) => ({
    key,
    label: params[0].label,
    param_path: params[0].param_path,
    values: params[0].values,
  }));
  res.json({ success: true, data: presets });
});

router.get('/universal-dims', async (_req: Request, res: Response) => {
  try {
    const dimsPath = path.join(__dirname, '..', '..', 'data', 'universal_sweep_dims.json');
    const raw = await fs.readFile(dimsPath, 'utf-8');
    res.json({ success: true, data: JSON.parse(raw) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: listSweeps() });
});

router.get('/:sweepId', (req: Request, res: Response) => {
  const sweep = getSweep(req.params.sweepId);
  if (!sweep) return res.status(404).json({ success: false, error: 'Sweep not found' });
  res.json({ success: true, data: sweep });
});

router.post('/run', async (req: Request, res: Response) => {
  try {
    const { strategy_version_id, preset, sweep_params, tier, interval, universal_dims } = req.body;

    if (!strategy_version_id || typeof strategy_version_id !== 'string') {
      return res.status(400).json({ success: false, error: 'strategy_version_id is required' });
    }

    let params: SweepParamDef[];
    if (preset && SWEEP_PRESETS[preset]) {
      params = SWEEP_PRESETS[preset];
    } else if (Array.isArray(sweep_params) && sweep_params.length > 0) {
      params = sweep_params;
    } else {
      return res.status(400).json({ success: false, error: 'Either preset or sweep_params is required' });
    }

    // Merge universal_dims into params: each active dim becomes an additional sweep axis.
    // Universal dims are appended so the Cartesian product expands across them.
    if (Array.isArray(universal_dims) && universal_dims.length > 0) {
      for (const dim of universal_dims) {
        if (dim.param_path && Array.isArray(dim.values) && dim.values.length > 0) {
          params = [...params, {
            label: dim.label || dim.param_path,
            param_path: dim.param_path,
            values: dim.values,
          }];
        }
      }
    }

    // Validate total variant count (Cartesian product for grid sweeps)
    const totalVariants = computeVariantCount(params);
    if (totalVariants === 0) return res.status(400).json({ success: false, error: 'At least one value is required' });
    if (totalVariants > 20) return res.status(400).json({ success: false, error: `Grid produces ${totalVariants} variants — maximum is 20. Reduce the number of values.` });

    const requestedTier = String(tier || 'tier1').trim().toLowerCase();
    if (requestedTier === 'tier3') {
      const allReports = await getAllValidationReports();
      const sweepStage = resolveSweepStage(allReports, strategy_version_id);
      if (!sweepStage || sweepStage.stage !== 'tier3') {
        return res.status(400).json({
          success: false,
          error: `Tier 3 sweep is only allowed for Tier 3 baselines. ${strategy_version_id} is not a Tier 3 baseline.`,
        });
      }
    }

    const sweepId = await runSweep(
      strategy_version_id,
      params,
      tier || 'tier1',
      interval,
    );

    res.json({ success: true, data: { sweep_id: sweepId } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:sweepId/cancel', async (req: Request, res: Response) => {
  try {
    await cancelSweep(req.params.sweepId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:sweepId/variants/:variantId/delete', async (req: Request, res: Response) => {
  try {
    await deleteSweepVariant(req.params.sweepId, req.params.variantId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:sweepId/delete', async (req: Request, res: Response) => {
  try {
    await deleteSweep(req.params.sweepId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:sweepId/promote', async (req: Request, res: Response) => {
  try {
    const sweep = getSweep(req.params.sweepId);
    if (!sweep) return res.status(404).json({ success: false, error: 'Sweep not found' });
    const variantId = typeof req.body?.variant_id === 'string' ? req.body.variant_id.trim() : '';
    if (!variantId && !sweep.winner) return res.status(400).json({ success: false, error: 'No winner to promote' });

    const newVersionId = await promoteWinner(req.params.sweepId, sweep.base_strategy_version_id, variantId || undefined);
    res.json({ success: true, data: { strategy_version_id: newVersionId } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Smart sweep plan derived from sensitivity results ────────────────────────
// Reads the latest report with sensitivity data for a strategy, extracts
// nudged_results, and returns an ordered sweep plan: parameters ranked by
// impact, flat ones excluded, value ranges biased toward the productive direction.

router.get('/smart-plan/:strategyVersionId', async (req: Request, res: Response) => {
  try {
    const strategyVersionId = req.params.strategyVersionId;
    const allReports = await getAllValidationReports();

    // Find the most recent report with sensitivity data, preferring higher tiers
    const tierPriority = ['tier2', 'tier1bs', 'tier1s', 'tier1b', 'tier1'] as const;
    let report: any = null;
    for (const tier of tierPriority) {
      const tierReports = allReports
        .filter((r: any) =>
          String(r?.strategy_version_id || '').trim() === strategyVersionId &&
          String(r?.config?.validation_tier || '').trim().toLowerCase() === tier
        )
        .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
      const candidate = tierReports[0];
      if (candidate?.robustness?.parameter_sensitivity?.nudged_results?.length > 0) {
        report = candidate;
        break;
      }
    }

    if (!report) {
      return res.status(404).json({ success: false, error: 'No report with sensitivity data found. Run Tier 1S, Tier 1B, or Tier 2 validation first.' });
    }

    const sensitivity = report?.robustness?.parameter_sensitivity;
    const nudged: any[] = sensitivity?.nudged_results || [];
    const baseExpectancy: number = sensitivity?.base_expectancy || 0;

    if (!nudged.length) {
      return res.status(404).json({ success: false, error: 'No sensitivity data in report. Ensure validation was run with parameter sensitivity enabled.' });
    }

    // Group nudges by param name, compute max absolute impact and net direction
    const paramMap = new Map<string, { up: number; down: number; upExp: number; downExp: number }>();
    for (const n of nudged) {
      const key = String(n.param || '');
      if (!key) continue;
      if (!paramMap.has(key)) paramMap.set(key, { up: 0, down: 0, upExp: baseExpectancy, downExp: baseExpectancy });
      const entry = paramMap.get(key)!;
      if (String(n.direction || '').includes('+')) {
        entry.up = Number(n.change_pct || 0);
        entry.upExp = Number(n.expectancy || baseExpectancy);
      } else {
        entry.down = Number(n.change_pct || 0);
        entry.downExp = Number(n.expectancy || baseExpectancy);
      }
    }

    // Build sweep plan — exclude flat params (both directions < 1% impact)
    const FLAT_THRESHOLD = 1.0;
    const sweepParams: SweepParamDef[] = [];
    const excluded: any[] = [];

    // Also pull the strategy spec for current values and parameter_manifest
    const allStrategies = await getAllStrategies();
    const strategy = allStrategies.find((s: any) => s.strategy_version_id === strategyVersionId);

    // Resolve parameter_manifest: prefer inline manifest on the strategy, else fall back to the
    // pattern definition (covers both monolithic patterns and promoted sweep winners that inherit
    // their tunable params from the pattern JSON rather than carrying their own manifest).
    let manifest: any[] = (strategy as any)?.parameter_manifest || [];
    if (!manifest.length) {
      // Use base_pattern_id stored on the strategy (set at promote time), or derive it from the id
      const basePatternId = (strategy as any)?.base_pattern_id
        || strategyVersionId
          .replace(/_v\d+$/, '')
          .replace(/^sweep_[a-f0-9]+-\d+_\d+_\d+_/, '');
      try {
        const defPath = require('path').join(__dirname, '..', '..', 'data', 'patterns', `${basePatternId}.json`);
        const patternDefRaw = JSON.parse(require('fs').readFileSync(defPath, 'utf-8'));
        // Pattern JSONs use `parameters` array with `key` but no `path` — normalise to add path
        const rawParams: any[] = patternDefRaw?.tunable_parameters || patternDefRaw?.parameters || [];
        manifest = rawParams.map((p: any) => ({
          ...p,
          path: p.path || `setup_config.${p.key}`,
        }));
      } catch { /* pattern file not found — leave manifest empty */ }
    }
    const manifestByPath = new Map(manifest.map((m: any) => [m.path || `setup_config.${m.key}`, m]));

    // Helper: resolve current value from nested path
    function getNestedValue(obj: any, dotPath: string): any {
      return dotPath.split('.').reduce((cur, k) => (cur != null ? cur[k] : undefined), obj);
    }

    // Helper: generate values biased toward the productive direction
    function buildValues(currentVal: number, upImpact: number, downImpact: number, manifestEntry: any): number[] {
      const suggestedFromManifest: number[] = manifestEntry?.suggested_values || [];
      if (suggestedFromManifest.length > 0) {
        // Start from manifest suggested values and bias toward productive direction
        let values = [...suggestedFromManifest];
        // If up is clearly better, push an extra value above the max
        if (upImpact > 5 && downImpact <= 0) {
          const max = Math.max(...values);
          const step = manifestEntry?.step || (max - Math.min(...values)) / Math.max(values.length - 1, 1);
          const extra = parseFloat((max + step).toFixed(4));
          if (extra <= (manifestEntry?.max || extra + 1)) values.push(extra);
        }
        // If down is clearly better, push an extra value below the min
        if (downImpact > 5 && upImpact <= 0) {
          const min = Math.min(...values);
          const step = manifestEntry?.step || (Math.max(...values) - min) / Math.max(values.length - 1, 1);
          const extra = parseFloat((min - step).toFixed(4));
          if (extra >= (manifestEntry?.min || extra - 1)) values.unshift(extra);
        }
        return [...new Set(values)].sort((a, b) => a - b);
      }
      // Fallback: generate 3-5 values around current
      const step = Math.abs(currentVal) * 0.15 || 0.1;
      return [
        parseFloat((currentVal - step).toFixed(4)),
        parseFloat(currentVal.toFixed(4)),
        parseFloat((currentVal + step).toFixed(4)),
      ];
    }

    // Sort params by max absolute impact descending
    const ranked = Array.from(paramMap.entries())
      .map(([param, data]) => ({
        param,
        maxImpact: Math.max(Math.abs(data.up), Math.abs(data.down)),
        upImpact: data.up,
        downImpact: data.down,
        upExp: data.upExp,
        downExp: data.downExp,
      }))
      .sort((a, b) => b.maxImpact - a.maxImpact);

    // Load pattern definition for default param values — needed for monolithic patterns and
    // promoted sweep winners which carry actual param values in the strategy spec but inherit
    // tunable param metadata (suggested_values, min, max, step) from the pattern JSON.
    let patternDef: any = null;
    try {
      const basePatternId2 = (strategy as any)?.base_pattern_id
        || strategyVersionId
          .replace(/_v\d+$/, '')
          .replace(/^sweep_[a-f0-9]+-\d+_\d+_\d+_/, '');
      const defPath = require('path').join(__dirname, '..', '..', 'data', 'patterns', `${basePatternId2}.json`);
      patternDef = JSON.parse(require('fs').readFileSync(defPath, 'utf-8'));
    } catch { /* not found — use empty defaults */ }
    const setupDefaults: any = patternDef?.default_setup_params || {};
    const structureDefaults: any = patternDef?.default_structure_config || {};
    const riskDefaults: any = patternDef?.backtest_config || {};

    function resolveCurrentValue(dotPath: string): number | null {
      // First try the actual strategy spec (has winning param values for promoted winners)
      if (strategy) {
        const v = getNestedValue(strategy, dotPath);
        if (v != null) return Number(v);
      }
      // Fall back to pattern definition defaults
      const parts = dotPath.split('.');
      const key = parts[parts.length - 1];
      const section = parts[0];
      if (section === 'setup_config' && setupDefaults[key] != null) return Number(setupDefaults[key]);
      if (section === 'structure_config' && structureDefaults[key] != null) return Number(structureDefaults[key]);
      if (section === 'risk_config' && riskDefaults[key] != null) return Number(riskDefaults[key]);
      if (setupDefaults[key] != null) return Number(setupDefaults[key]);
      if (structureDefaults[key] != null) return Number(structureDefaults[key]);
      return null;
    }

    for (const row of ranked) {
      const isFlat = row.maxImpact < FLAT_THRESHOLD;
      if (isFlat) {
        excluded.push({ param: row.param, reason: `Both directions < ${FLAT_THRESHOLD}% impact — not worth sweeping`, maxImpact: row.maxImpact });
        continue;
      }

      // Find param path from manifest (match by key suffix or path)
      const paramKey = row.param.split('.').pop() || row.param;
      const manifestEntry = manifest.find((m: any) =>
        m.path?.endsWith(`.${paramKey}`) || m.path === row.param || m.key === row.param || m.key === paramKey
      ) || null;

      const paramPath = manifestEntry?.path || row.param;
      const currentVal = resolveCurrentValue(paramPath);
      const label = manifestEntry?.label || paramKey;

      let values: number[] = [];
      if (manifestEntry?.suggested_values?.length) {
        values = buildValues(Number(currentVal || 0), row.upImpact, row.downImpact, manifestEntry);
      } else if (currentVal != null) {
        values = buildValues(Number(currentVal), row.upImpact, row.downImpact, manifestEntry);
      }

      if (!values.length) continue;

      sweepParams.push({
        label: `${label} (impact: ${row.upImpact > 0 ? '+' : ''}${row.upImpact.toFixed(1)}% / ${row.downImpact.toFixed(1)}%)`,
        param_path: paramPath,
        values,
      });
    }

    return res.json({
      success: true,
      data: {
        strategy_version_id: strategyVersionId,
        report_id: report.report_id || null,
        base_expectancy: baseExpectancy,
        sensitivity_score: sensitivity?.sensitivity_score || 0,
        sweep_params: sweepParams,
        excluded_params: excluded,
        summary: `${sweepParams.length} parameters selected for sweep, ${excluded.length} excluded as flat. Ranked by sensitivity impact.`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/strategies/list', async (_req: Request, res: Response) => {
  try {
    const all = await getAllStrategies();
    const allReports = await getAllValidationReports();
    const seenIds = new Set<string>();
    const filtered: any[] = [];

    const pushIfSweepEligible = (candidate: any) => {
      const strategyVersionId = String(candidate?.strategy_version_id || '').trim();
      if (!strategyVersionId || seenIds.has(strategyVersionId)) return;
      const sweepStage = resolveSweepStage(allReports, strategyVersionId);
      if (!sweepStage) return;
      seenIds.add(strategyVersionId);
      filtered.push({
        ...candidate,
        sweep_stage: sweepStage.stage,
        sweep_stage_title: sweepStage.title,
      });
    };

    // User-created strategies (not sweep variants, not research)
    all
      .filter((s: any) =>
        !s.strategy_version_id?.startsWith('sweep_') &&
        !s.strategy_version_id?.startsWith('research_')
      )
      .forEach((s: any) => {
        pushIfSweepEligible({
          strategy_version_id: s.strategy_version_id,
          name: s.name || s.strategy_id,
          status: s.status,
          interval: s.interval,
          source: 'user',
        });
      });

    // Registry strategies (composites, monolithics, and patterns)
    try {
      const registryPath = path.join(__dirname, '..', '..', 'data', 'patterns', 'registry.json');
      const registry = JSON.parse(await fs.readFile(registryPath, 'utf-8'));
      const patternsDir = path.join(__dirname, '..', '..', 'data', 'patterns');
      for (const entry of (registry.patterns || [])) {
        const isValidRegistryStrategy =
          entry.composition === 'composite' ||
          entry.composition === 'monolithic' ||
          entry.artifact_type === 'pattern';
        if (!isValidRegistryStrategy) continue;
        if (String(entry.status || '').toLowerCase() === 'rejected') continue;
        const vid = `${entry.pattern_id}_v1`;
        try {
          const def = JSON.parse(await fs.readFile(path.join(patternsDir, entry.definition_file), 'utf-8'));
          pushIfSweepEligible({
            strategy_version_id: vid,
            name: entry.name || def.name || entry.pattern_id,
            status: entry.status || 'experimental',
            interval: def.suggested_timeframes?.[0] === 'W' ? '1wk' : '1d',
            source: entry.composition || entry.artifact_type || 'registry',
          });
        } catch { /* definition file missing */ }
      }
    } catch { /* registry not found */ }

    // Research-agent strategies that survived the gate
    all
      .filter((s: any) => s.strategy_version_id?.startsWith('research_'))
      .forEach((s: any) => {
        pushIfSweepEligible({
          strategy_version_id: s.strategy_version_id,
          name: s.name || s.strategy_id,
          status: s.status,
          interval: s.interval,
          source: 'research',
        });
      });

    res.json({ success: true, data: filtered });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
