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
  loadAllSweeps,
  SweepParamDef,
} from '../services/sweepEngine';
import { getAllStrategies, getAllValidationReports } from '../services/storageService';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();

void loadAllSweeps();

type SweepStage = 'tier2' | 'tier2r' | 'tier3';

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
    const { strategy_version_id, preset, sweep_params, tier, interval } = req.body;

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

    // Validate values count
    const maxValues = Math.max(...params.map(p => p.values?.length ?? 0));
    if (maxValues === 0) return res.status(400).json({ success: false, error: 'At least one value is required' });
    if (maxValues > 20) return res.status(400).json({ success: false, error: 'Maximum 20 values per sweep' });

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
