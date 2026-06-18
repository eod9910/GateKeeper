/**
 * Research Agent API Routes
 *
 * POST   /research/sessions                — start a new research session
 * GET    /research/sessions                — list all sessions
 * GET    /research/sessions/:id            — get session state + genome
 * POST   /research/sessions/:id/stop       — stop a running session
 * DELETE /research/sessions/:id            — permanently delete a session
 * POST   /research/sessions/:id/archive    — archive a session
 * POST   /research/sessions/:id/unarchive  — unarchive a session
 * POST   /research/sessions/:id/promote/:gen — manually promote a generation
 * POST   /research/sessions/:id/reflect/:gen — regenerate reflection for a generation
 * POST   /research/sessions/:id/interpret/:gen — AI-powered interpretation of a generation
 * POST   /research/sessions/:id/interpret/:gen/ask — follow-up question about a generation
 * GET    /research/sessions/:id/stream     — SSE live event stream
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  createSession,
  continueSession,
  stopSession,
  deleteSession,
  archiveSession,
  unarchiveSession,
  getSession,
  listSessions,
  loadAllSessions,
  subscribeToSession,
  promoteManually,
  regenerateReflection,
  ResearchSessionConfig,
} from '../services/researchAgent';
import { interpretGeneration, interpretAsk } from '../services/strategyGenService';
import {
  runFormulaRanking,
  getRankingJob,
  cancelRanking,
  subscribeToRanking,
} from '../services/formulaRankingEngine';
import { buildResearchCatalogSnapshot } from '../services/researchCatalogService';
import { getValuationBacktestStatus, runValuationBacktest } from '../services/valuationBacktestService';
import { getValuationSignalStrategyStatus, runValuationSignalStrategy } from '../services/valuationSignalStrategyService';
import {
  compareFundamentalBacktestRuns,
  getFundamentalBacktestRun,
  getFundamentalSweepSession,
  getFundamentalBacktestStatus,
  listFundamentalBacktestRuns,
  promoteFundamentalRunToSweep,
  promoteFundamentalSweepWinnerToStrategy,
  runFundamentalBacktest,
  runFundamentalSweepSession,
} from '../services/fundamentalBacktestService';

const router = Router();

// Load persisted sessions on startup — track promise so routes can await it
let sessionsReadyPromise = loadAllSessions().catch(console.error);

router.get('/catalog', async (_req: Request, res: Response) => {
  try {
    const snapshot = await buildResearchCatalogSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/valuation-backtest', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getValuationBacktestStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/valuation-backtest/run', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const payload = runValuationBacktest({
      frequency: body.frequency === 'quarterly' ? 'quarterly' : 'monthly',
      horizons: Array.isArray(body.horizons)
        ? body.horizons.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
        : typeof body.horizons === 'string'
          ? String(body.horizons)
              .split(',')
              .map((value) => Number(value.trim()))
              .filter((value) => Number.isFinite(value) && value > 0)
          : undefined,
      gap_threshold_pct: Number.isFinite(Number(body.gap_threshold_pct)) ? Number(body.gap_threshold_pct) : undefined,
      cap_tier: ['micro', 'small', 'mid', 'large'].includes(String(body.cap_tier || ''))
        ? String(body.cap_tier) as 'micro' | 'small' | 'mid' | 'large'
        : null,
      limit: Number.isFinite(Number(body.limit)) && Number(body.limit) > 0 ? Number(body.limit) : null,
      start_date: body.start_date ? String(body.start_date) : null,
      end_date: body.end_date ? String(body.end_date) : null,
    });
    res.json({ success: true, data: payload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/valuation-signal-strategy', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getValuationSignalStrategyStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/valuation-signal-strategy/run', (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const payload = runValuationSignalStrategy({
      frequency: body.frequency === 'quarterly' ? 'quarterly' : 'monthly',
      horizon: Number.isFinite(Number(body.horizon)) ? Number(body.horizon) : undefined,
      gap_threshold_pct: Number.isFinite(Number(body.gap_threshold_pct)) ? Number(body.gap_threshold_pct) : undefined,
      cap_tier: ['micro', 'small', 'mid', 'large'].includes(String(body.cap_tier || ''))
        ? String(body.cap_tier) as 'micro' | 'small' | 'mid' | 'large'
        : null,
      limit: Number.isFinite(Number(body.limit)) && Number(body.limit) > 0 ? Number(body.limit) : null,
      start_date: body.start_date ? String(body.start_date) : null,
      end_date: body.end_date ? String(body.end_date) : null,
      take_profit_pct: Number.isFinite(Number(body.take_profit_pct)) ? Number(body.take_profit_pct) : null,
      stop_loss_pct: Number.isFinite(Number(body.stop_loss_pct)) ? Number(body.stop_loss_pct) : null,
    });
    res.json({ success: true, data: payload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /sessions ───────────────────────────────────────────────────────────

router.get('/fundamental-backtest', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getFundamentalBacktestStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fundamental-backtest/run', (req: Request, res: Response) => {
  try {
    const payload = runFundamentalBacktest(req.body || {});
    res.json({ success: true, data: payload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/fundamental-backtest/runs', (req: Request, res: Response) => {
  try {
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 50;
    res.json({ success: true, data: listFundamentalBacktestRuns(limit) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/fundamental-backtest/runs/:id', (req: Request, res: Response) => {
  try {
    const run = getFundamentalBacktestRun(req.params.id);
    if (!run) return res.status(404).json({ success: false, error: 'Saved run not found' });
    res.json({ success: true, data: run });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fundamental-backtest/runs/:id/promote-sweep', async (req: Request, res: Response) => {
  try {
    const session = promoteFundamentalRunToSweep(req.params.id);
    const payload = await promoteFundamentalSweepWinnerToStrategy(session.session_id);
    res.json({
      success: true,
      data: {
        session: payload.session,
        session_id: payload.session.session_id,
        strategy_version_id: payload.strategy_version_id,
        url: `/parameter-sweep?strategy_version_id=${encodeURIComponent(payload.strategy_version_id)}`,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/fundamental-backtest/sweep-sessions/:id', (req: Request, res: Response) => {
  try {
    const session = getFundamentalSweepSession(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Fundamental sweep session not found' });
    res.json({ success: true, data: session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fundamental-backtest/sweep-sessions/:id/run', (req: Request, res: Response) => {
  try {
    const session = runFundamentalSweepSession(req.params.id, req.body?.sweep_params);
    res.json({ success: true, data: session });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/fundamental-backtest/sweep-sessions/:id/promote-strategy', async (req: Request, res: Response) => {
  try {
    const variantId = typeof req.body?.variant_id === 'string' ? req.body.variant_id.trim() : '';
    const payload = await promoteFundamentalSweepWinnerToStrategy(req.params.id, variantId || undefined);
    res.json({
      success: true,
      data: {
        ...payload,
        url: `/validator.html?strategy_version_id=${encodeURIComponent(payload.strategy_version_id)}`,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/fundamental-backtest/runs/compare', (req: Request, res: Response) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    res.json({ success: true, data: compareFundamentalBacktestRuns(ids) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const {
      name,
      max_generations,
      target_interval,
      target_asset_class,
      seed_hypothesis,
      promotion_min_fitness,
      promotion_requires_pass,
    } = body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    const mode = body.mode === 'symbolic_regression' ? 'symbolic_regression' : 'strategy_discovery';
    const sr = body.sr_config && typeof body.sr_config === 'object' ? body.sr_config : undefined;
    const config: ResearchSessionConfig = {
      name: String(name).trim(),
      max_generations: Math.max(1, Math.min(Number(max_generations) || 5, 50)),
      target_interval: String(target_interval || '1wk'),
      target_asset_class: String(target_asset_class || 'stocks'),
      seed_hypothesis: seed_hypothesis ? String(seed_hypothesis).trim() : undefined,
      promotion_min_fitness: Number(promotion_min_fitness) || 0.6,
      promotion_requires_pass: promotion_requires_pass !== false,
      allow_new_primitives: body.allow_new_primitives === true,
      hypothesis_model: body.hypothesis_model ? String(body.hypothesis_model) : undefined,
      reflection_model: body.reflection_model ? String(body.reflection_model) : undefined,
      risk_defaults: body.risk_defaults || undefined,
      mode,
      sr_config: mode === 'symbolic_regression' && sr
        ? {
            symbol: String(sr.symbol || 'SPY').trim(),
            interval: String(sr.interval || '1d').trim(),
            years: sr.years != null ? Number(sr.years) : 2,
            target_bars: sr.target_bars != null ? Number(sr.target_bars) : 5,
            population_size: sr.population_size != null ? Number(sr.population_size) : 500,
            generations: sr.generations != null ? Number(sr.generations) : 20,
            features: Array.isArray(sr.features) ? sr.features.map((f: any) => ({
              id: String(f.id || '').trim(),
              period: f.period != null ? Number(f.period) : undefined,
            })).filter((f: any) => f.id) : undefined,
          }
        : undefined,
    };

    const session = await createSession(config);
    res.status(201).json({ success: true, data: session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sessions ────────────────────────────────────────────────────────────

router.get('/sessions', async (_req: Request, res: Response) => {
  await sessionsReadyPromise;
  try {
    const sessions = listSessions().map(s => ({
      session_id: s.session_id,
      status: s.status,
      generation: s.generation,
      max_generations: s.max_generations,
      config: s.config,
      best: s.best,
      genome_count: s.genome.length,
      current_hypothesis: s.current_hypothesis,
      archived: s.archived || false,
      created_at: s.created_at,
      updated_at: s.updated_at,
      error: s.error,
    }));
    res.json({ success: true, data: sessions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sessions/:id ────────────────────────────────────────────────────────

router.get('/sessions/:id', async (req: Request, res: Response) => {
  await sessionsReadyPromise;
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, data: session });
});

// ─── POST /sessions/:id/stop ──────────────────────────────────────────────────

router.post('/sessions/:id/stop', async (req: Request, res: Response) => {
  const stopped = await stopSession(req.params.id);
  if (!stopped) {
    return res.status(400).json({ success: false, error: 'Session not found or not running' });
  }
  res.json({ success: true, data: { stopped: true } });
});

// ─── DELETE /sessions/:id ─────────────────────────────────────────────────────

router.delete('/sessions/:id', async (req: Request, res: Response) => {
  const deleted = await deleteSession(req.params.id);
  if (!deleted) {
    return res.status(400).json({ success: false, error: 'Session not found, still running, or could not be deleted' });
  }
  res.json({ success: true, data: { deleted: true } });
});

// ─── POST /sessions/:id/archive ──────────────────────────────────────────────

router.post('/sessions/:id/archive', async (req: Request, res: Response) => {
  const archived = await archiveSession(req.params.id);
  if (!archived) {
    return res.status(400).json({ success: false, error: 'Session not found or still running' });
  }
  res.json({ success: true, data: { archived: true } });
});

// ─── POST /sessions/:id/unarchive ────────────────────────────────────────────

router.post('/sessions/:id/unarchive', async (req: Request, res: Response) => {
  const unarchived = await unarchiveSession(req.params.id);
  if (!unarchived) {
    return res.status(400).json({ success: false, error: 'Session not found' });
  }
  res.json({ success: true, data: { archived: false } });
});

// ─── POST /sessions/:id/continue ─────────────────────────────────────────────

router.post('/sessions/:id/continue', async (req: Request, res: Response) => {
  await sessionsReadyPromise;
  try {
    const session = await continueSession(req.params.id, req.body || {});
    if (!session) {
      return res.status(404).json({ success: false, error: 'Source session not found' });
    }
    res.status(201).json({ success: true, data: session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /sessions/:id/promote/:gen ─────────────────────────────────────────

router.post('/sessions/:id/promote/:gen', async (req: Request, res: Response) => {
  const gen = parseInt(req.params.gen, 10);
  if (isNaN(gen)) {
    return res.status(400).json({ success: false, error: 'Invalid generation number' });
  }
  const ok = await promoteManually(req.params.id, gen);
  if (!ok) {
    return res.status(404).json({ success: false, error: 'Session or generation not found' });
  }
  res.json({ success: true, data: { promoted: true, generation: gen } });
});

// ─── POST /sessions/:id/reflect/:gen ──────────────────────────────────────────

router.post('/sessions/:id/reflect/:gen', async (req: Request, res: Response) => {
  console.log(`[reflect route] POST /sessions/${req.params.id}/reflect/${req.params.gen}`);
  const gen = parseInt(req.params.gen, 10);
  if (isNaN(gen)) {
    return res.status(400).json({ success: false, error: 'Invalid generation number' });
  }

  // Wait for startup load to complete, then re-load if session still missing
  await sessionsReadyPromise;
  if (!getSession(req.params.id)) {
    sessionsReadyPromise = loadAllSessions().catch(console.error);
    await sessionsReadyPromise;
  }

  const model = req.body?.model ? String(req.body.model) : undefined;
  try {
    const result = await regenerateReflection(req.params.id, gen, model);
    if (result === null) {
      return res.status(404).json({ success: false, error: 'Session, generation, or report not found' });
    }
    res.json({ success: true, data: { reflection: result.reflection, param_changes: result.param_changes, generation: gen } });
  } catch (err: any) {
    console.error(`[reflect route] Error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /sessions/:id/interpret/:gen ────────────────────────────────────────

router.post('/sessions/:id/interpret/:gen', async (req: Request, res: Response) => {
  const gen = parseInt(req.params.gen, 10);
  if (isNaN(gen)) {
    return res.status(400).json({ success: false, error: 'Invalid generation number' });
  }

  await sessionsReadyPromise;
  if (!getSession(req.params.id)) {
    sessionsReadyPromise = loadAllSessions().catch(console.error);
    await sessionsReadyPromise;
  }

  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const entry = session.genome.find((e: any) => e.generation === gen);
  if (!entry) {
    return res.status(404).json({ success: false, error: 'Generation not found' });
  }

  const model = req.body?.model ? String(req.body.model) : undefined;
  try {
    const interpretation = await interpretGeneration(entry, session.config, model);
    res.json({ success: true, data: { interpretation, generation: gen } });
  } catch (err: any) {
    console.error(`[interpret route] Error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /sessions/:id/interpret/:gen/ask ────────────────────────────────────

router.post('/sessions/:id/interpret/:gen/ask', async (req: Request, res: Response) => {
  const gen = parseInt(req.params.gen, 10);
  if (isNaN(gen)) {
    return res.status(400).json({ success: false, error: 'Invalid generation number' });
  }

  const { question, initial_interpretation, conversation } = req.body || {};
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ success: false, error: 'question is required' });
  }

  await sessionsReadyPromise;
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const entry = session.genome.find((e: any) => e.generation === gen);
  if (!entry) {
    return res.status(404).json({ success: false, error: 'Generation not found' });
  }

  const conv = Array.isArray(conversation)
    ? conversation.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    : [];
  const initial = typeof initial_interpretation === 'string' ? initial_interpretation : '';

  const model = req.body?.model ? String(req.body.model) : undefined;
  try {
    const answer = await interpretAsk(entry, session.config, question.trim(), initial, conv, model);
    res.json({ success: true, data: { answer, generation: gen } });
  } catch (err: any) {
    console.error(`[interpret/ask route] Error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /sessions/:id/stream (SSE) ──────────────────────────────────────────

router.get('/sessions/:id/stream', (req: Request, res: Response) => {
  const sessionId = req.params.id;
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send current state immediately on connect
  send('snapshot', {
    session_id: session.session_id,
    status: session.status,
    generation: session.generation,
    max_generations: session.max_generations,
    genome: session.genome,
    best: session.best,
    current_hypothesis: session.current_hypothesis,
  });

  const unsubscribe = subscribeToSession(sessionId, send);

  req.on('close', () => {
    unsubscribe();
  });
});

// ─── GET /families ───────────────────────────────────────────────────────────
// Returns the list of known familySignatureV2 values from the latest research
// artifacts so the Blockly composer can render a family picker.

const FAMILY_COMPARISON_PATH = path.join(
  __dirname, '..', '..', 'data', 'research', 'atr_pivot_v1',
  'etf_1d_10y_family_comparison_v2.json'
);

router.get('/families', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(FAMILY_COMPARISON_PATH)) {
      return res.json({ success: true, data: [] });
    }
    const raw = JSON.parse(fs.readFileSync(FAMILY_COMPARISON_PATH, 'utf-8'));
    const familyRows: any[] = raw?.familyBehaviorStability?.familyRows ?? [];
    const families = familyRows
      .map((row: any) => ({
        signature: String(row.familySignatureV2 || ''),
        symbolCount: row.symbolCount ?? 0,
        totalOccurrenceCount: row.totalOccurrenceCount ?? 0,
        crossSymbolMeanTScoreForward10: row.crossSymbolMeanTScoreForward10 ?? null,
        crossSymbolMeanAvgForward10ReturnAtr: row.crossSymbolMeanAvgForward10ReturnAtr ?? null,
        isCandidateFamily: row.isCandidateFamily ?? false,
      }))
      .filter((f: any) => !!f.signature)
      .sort((a: any, b: any) => {
        // Candidates first, then by abs(t10) descending
        if (b.isCandidateFamily !== a.isCandidateFamily) return b.isCandidateFamily ? 1 : -1;
        return Math.abs(b.crossSymbolMeanTScoreForward10 ?? 0) - Math.abs(a.crossSymbolMeanTScoreForward10 ?? 0);
      });
    res.json({ success: true, data: families });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /research/sr-formulas — list all persisted SR formulas with ranking data
router.get('/sr-formulas', async (_req: Request, res: Response) => {
  try {
    const formulasPath = path.join(__dirname, '..', '..', 'data', 'sr_formulas.json');
    let registry: Record<string, any> = {};
    if (fs.existsSync(formulasPath)) {
      const raw = fs.readFileSync(formulasPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') registry = parsed;
    }
    const formulas = Object.values(registry).map((entry: any) => {
      const ranking = entry.backtest_ranking || null;
      return {
        formula_id: entry.formula_id,
        formula_readable: entry.formula_readable || entry.formula || '',
        complexity: entry.complexity || 0,
        fitness: entry.fitness || 0,
        training_symbol: entry.training_context?.symbol || '',
        training_interval: entry.training_context?.interval || '',
        created_at: entry.created_at || '',
        backtest_ranking: ranking ? {
          rank: ranking.rank,
          composite_score: ranking.composite_score,
          expectancy_R: ranking.expectancy_R,
          win_rate: ranking.win_rate,
          profit_factor: ranking.profit_factor,
          sharpe_ratio: ranking.sharpe_ratio,
          total_trades: ranking.total_trades,
          pass_fail: ranking.pass_fail,
          ranked_at: ranking.ranked_at,
        } : null,
      };
    });
    res.json({ success: true, data: formulas });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /research/sr-formulas/rank — trigger formula ranking
router.post('/sr-formulas/rank', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const jobId = await runFormulaRanking({
      baseline_strategy_version_id: body.baseline_strategy_version_id,
      symbol: body.symbol,
      interval: body.interval,
      tier: body.tier,
      force: body.force === true,
    });
    const job = getRankingJob(jobId);
    res.status(201).json({ success: true, data: { job_id: jobId, status: job?.status, progress: job?.progress } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /research/sr-formulas/rank/:jobId — poll ranking job status
router.get('/sr-formulas/rank/:jobId', (req: Request, res: Response) => {
  const job = getRankingJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Ranking job not found' });
  }
  res.json({ success: true, data: job });
});

// POST /research/sr-formulas/rank/:jobId/cancel — cancel a running ranking job
router.post('/sr-formulas/rank/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    await cancelRanking(req.params.jobId);
    res.json({ success: true, data: { cancelled: true } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /research/sr-formulas/rank/:jobId/stream — SSE for ranking progress
router.get('/sr-formulas/rank/:jobId/stream', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = getRankingJob(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Ranking job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('snapshot', { job_id: job.job_id, status: job.status, progress: job.progress });

  const unsubscribe = subscribeToRanking(jobId, send);
  req.on('close', () => { unsubscribe(); });
});

export default router;
