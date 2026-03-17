import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import {
  AttemptDraft,
  StrategyContract,
  TrainingAttempt,
  TrainingBar,
  TrainingDrawing,
} from '../types';
import { evaluateAttempt, validateContract } from '../services/training/contractEngine';
import { resolveForward } from '../services/training/forwardResolver';
import { buildScoreSnapshot } from '../services/training/scoringEngine';
import { attachAttemptToSession, buildTrainingStats, endTrainingSession, refreshSession, startTrainingSession } from '../services/training/sessionEngine';
import {
  ensureSampleContracts,
  getContract,
  getSession,
  listAttempts,
  listAttemptsBySession,
  listContracts,
  listSessions,
  logTrainingEvent,
  saveAttempt,
  saveContract,
} from '../services/training/storage';
import { detectBaseFromDensity, DensityBar } from '../services/analysis/densityBase';

const router = Router();

const DEFAULT_CONTRACTS: StrategyContract[] = [
  // ── Breakout ─────────────────────────────────────────────────────
  // Long: price breaks above the box top.  Short: price breaks below the box bottom.
  {
    id: 'breakout_v1',
    name: 'Breakout',
    version: '1.0.0',
    active: true,
    symbolScope: [],
    timeframeScope: ['1D', '1WK', '4H', '1H'],
    sideScope: ['long', 'short'],
    requiredDrawings: [
      { id: 'base_box', label: 'Base Box', type: 'box', required: true },
    ],
    entryRules: [
      {
        id: 'entry_after_base',
        type: 'entry_after_drawing_end',
        drawingId: 'base_box',
        description: 'Entry must happen after the drawn base is complete.',
        severity: 'block',
      },
      {
        id: 'entry_breakout',
        type: 'entry_breakout_from_drawing',
        drawingId: 'base_box',
        description: 'Long: entry must break above the base top. Short: entry must break below the base bottom.',
        severity: 'block',
      },
      {
        id: 'tp_direction',
        type: 'take_profit_beyond_entry',
        description: 'Take profit must be beyond entry in the trade direction.',
        severity: 'block',
      },
    ],
    riskRules: [
      {
        id: 'stop_outside',
        type: 'stop_outside_drawing',
        drawingId: 'base_box',
        description: 'Long: stop below the base bottom. Short: stop above the base top.',
        severity: 'block',
      },
      {
        id: 'min_rr_2',
        type: 'min_reward_risk',
        min: 2,
        description: 'Trade must offer at least 2R reward-to-risk.',
        severity: 'block',
      },
      {
        id: 'risk_pct_cap',
        type: 'max_risk_pct',
        max: 8,
        description: 'Per-trade price risk must remain under 8%.',
        severity: 'warning',
      },
    ],
    cooldownPolicy: {
      enabled: true,
      triggerViolationCount: 3,
      lookbackAttempts: 5,
      cooldownMinutes: 15,
    },
    scoreWeights: { process: 0.7, outcome: 0.3 },
    simulation: { maxHoldBars: 20, tieBreakPolicy: 'stop_first' },
    notes: 'Draw a base box around the consolidation zone. Go long on a break above the top, or short on a break below the bottom.',
  },

  // ── Pullback ─────────────────────────────────────────────────────
  // Long: Fib retracement into a pullback low.  Short: Fib retracement into a pullback high.
  {
    id: 'pullback_v1',
    name: 'Pullback',
    version: '1.0.0',
    active: true,
    symbolScope: [],
    timeframeScope: ['1D', '1WK', '4H', '1H'],
    sideScope: ['long', 'short'],
    requiredDrawings: [
      { id: 'pullback_fib', label: 'Pullback Fib', type: 'fib', required: true },
    ],
    entryRules: [
      {
        id: 'entry_after_fib',
        type: 'entry_after_drawing_end',
        drawingId: 'pullback_fib',
        description: 'Entry must happen after the Fib retracement extreme is established.',
        severity: 'block',
      },
      {
        id: 'entry_beyond_50',
        type: 'entry_beyond_fib_level',
        drawingId: 'pullback_fib',
        level: 0.5,
        description: 'Long: entry must be at or below the 50% Fib level. Short: entry must be at or above.',
        severity: 'block',
      },
      {
        id: 'tp_direction',
        type: 'take_profit_beyond_entry',
        description: 'Take profit must be beyond entry in the trade direction.',
        severity: 'block',
      },
    ],
    riskRules: [
      {
        id: 'stop_beyond_fib',
        type: 'stop_beyond_fib_extreme',
        drawingId: 'pullback_fib',
        description: 'Long: stop below the Fib swing low. Short: stop above the Fib swing high.',
        severity: 'block',
      },
      {
        id: 'min_rr_2',
        type: 'min_reward_risk',
        min: 2,
        description: 'Trade must offer at least 2R reward-to-risk.',
        severity: 'block',
      },
      {
        id: 'risk_pct_cap',
        type: 'max_risk_pct',
        max: 8,
        description: 'Per-trade price risk must remain under 8%.',
        severity: 'warning',
      },
    ],
    cooldownPolicy: {
      enabled: true,
      triggerViolationCount: 3,
      lookbackAttempts: 5,
      cooldownMinutes: 15,
    },
    scoreWeights: { process: 0.7, outcome: 0.3 },
    simulation: { maxHoldBars: 20, tieBreakPolicy: 'stop_first' },
    notes: 'Draw a Fibonacci retracement across the pullback. Enter at or beyond the 50% retracement level. Stop beyond the swing extreme, target in the trade direction.',
  },

  // ── Fade (Mean Reversion) ────────────────────────────────────────
  // Trade back toward the center of a consolidation box from its edges.
  {
    id: 'fade_v1',
    name: 'Fade / Mean Reversion',
    version: '1.0.0',
    active: true,
    symbolScope: [],
    timeframeScope: ['1D', '1WK', '4H', '1H'],
    sideScope: ['long', 'short'],
    requiredDrawings: [
      { id: 'base_box', label: 'Range Box', type: 'box', required: true },
    ],
    entryRules: [
      {
        id: 'entry_after_range',
        type: 'entry_after_drawing_end',
        drawingId: 'base_box',
        description: 'Entry must happen after the range box is drawn.',
        severity: 'block',
      },
      {
        id: 'entry_fade',
        type: 'entry_fade_into_drawing',
        drawingId: 'base_box',
        tolerancePct: 2,
        description: 'Long: entry near or below the box bottom. Short: entry near or above the box top.',
        severity: 'block',
      },
      {
        id: 'tp_direction',
        type: 'take_profit_beyond_entry',
        description: 'Take profit must be beyond entry in the trade direction.',
        severity: 'block',
      },
    ],
    riskRules: [
      {
        id: 'stop_outside',
        type: 'stop_outside_drawing',
        drawingId: 'base_box',
        description: 'Stop must be outside the box edge you are fading from.',
        severity: 'block',
      },
      {
        id: 'min_rr_2',
        type: 'min_reward_risk',
        min: 2,
        description: 'Trade must offer at least 2R reward-to-risk.',
        severity: 'block',
      },
      {
        id: 'risk_pct_cap',
        type: 'max_risk_pct',
        max: 8,
        description: 'Per-trade price risk must remain under 8%.',
        severity: 'warning',
      },
    ],
    cooldownPolicy: {
      enabled: true,
      triggerViolationCount: 3,
      lookbackAttempts: 5,
      cooldownMinutes: 15,
    },
    scoreWeights: { process: 0.7, outcome: 0.3 },
    simulation: { maxHoldBars: 20, tieBreakPolicy: 'stop_first' },
    notes: 'Draw a range/consolidation box. Long: fade near the bottom edge. Short: fade near the top edge. Target the opposite side of the range.',
  },
];

function toBars(input: any): TrainingBar[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((bar) => ({
      time: String(bar?.time || '').trim(),
      open: Number(bar?.open),
      high: Number(bar?.high),
      low: Number(bar?.low),
      close: Number(bar?.close),
      volume: bar?.volume != null ? Number(bar.volume) : undefined,
    }))
    .filter((bar) =>
      bar.time &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close),
    );
}

function toDrawings(input: any): TrainingDrawing[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((drawing) => ({
      id: String(drawing?.id || '').trim(),
      type: drawing?.type,
      label: drawing?.label ? String(drawing.label) : undefined,
      startTime: drawing?.startTime ? String(drawing.startTime) : undefined,
      endTime: drawing?.endTime ? String(drawing.endTime) : undefined,
      price: drawing?.price != null ? Number(drawing.price) : undefined,
      price2: drawing?.price2 != null ? Number(drawing.price2) : undefined,
      top: drawing?.top != null ? Number(drawing.top) : undefined,
      bottom: drawing?.bottom != null ? Number(drawing.bottom) : undefined,
    }))
    .filter((drawing) => drawing.id && drawing.type);
}

async function loadActiveContract(contractId: string): Promise<StrategyContract> {
  await ensureSampleContracts(DEFAULT_CONTRACTS);
  const contract = await getContract(contractId);
  if (!contract) {
    throw new Error(`Contract ${contractId} not found.`);
  }
  return contract;
}

function buildAttemptDraft(reqBody: any): AttemptDraft {
  const bars = toBars(reqBody?.bars);
  const entryBarIndex = Number(reqBody?.entryBarIndex);
  const entryBarTime = String(reqBody?.entryBarTime || bars[entryBarIndex]?.time || '').trim();

  return {
    sessionId: String(reqBody?.sessionId || '').trim(),
    contractId: String(reqBody?.contractId || '').trim(),
    symbol: String(reqBody?.symbol || '').trim().toUpperCase(),
    timeframe: String(reqBody?.timeframe || '').trim(),
    side: reqBody?.side === 'short' ? 'short' : 'long',
    entry: Number(reqBody?.entry),
    stop: Number(reqBody?.stop),
    takeProfit: Number(reqBody?.takeProfit),
    riskPct: reqBody?.riskPct != null ? Number(reqBody.riskPct) : undefined,
    entryBarIndex,
    entryBarTime,
    drawings: toDrawings(reqBody?.drawings),
    bars,
    maxHoldBars: reqBody?.maxHoldBars != null ? Number(reqBody.maxHoldBars) : undefined,
    tieBreakPolicy: reqBody?.tieBreakPolicy,
  };
}

router.get('/contracts', async (_req: Request, res: Response) => {
  try {
    await ensureSampleContracts(DEFAULT_CONTRACTS);
    const contracts = await listContracts();
    res.json({ success: true, data: contracts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/contracts', async (req: Request, res: Response) => {
  try {
    const contract = req.body as StrategyContract;
    const issues = validateContract(contract);
    if (issues.length) {
      return res.status(400).json({ success: false, error: issues.join(' ') });
    }
    const saved = await saveContract(contract);
    res.json({ success: true, data: saved });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sessions', async (_req: Request, res: Response) => {
  try {
    const sessions = await listSessions();
    res.json({ success: true, data: sessions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions/start', async (req: Request, res: Response) => {
  try {
    const contractId = String(req.body?.contractId || '').trim();
    if (!contractId) {
      return res.status(400).json({ success: false, error: 'contractId is required.' });
    }
    const contract = await loadActiveContract(contractId);
    const session = await startTrainingSession(contract, String(req.body?.userId || 'local-user'));
    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/sessions/:id/end', async (req: Request, res: Response) => {
  try {
    const session = await endTrainingSession(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }
    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await refreshSession(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }
    const attempts = await listAttemptsBySession(req.params.id);
    res.json({ success: true, data: { session, attempts } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/attempts', async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    const attempts = sessionId ? await listAttemptsBySession(sessionId) : await listAttempts();
    res.json({ success: true, data: attempts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/attempts/validate', async (req: Request, res: Response) => {
  try {
    const draft = buildAttemptDraft(req.body);
    if (!draft.contractId || !draft.sessionId) {
      return res.status(400).json({ success: false, error: 'contractId and sessionId are required.' });
    }
    const contract = await loadActiveContract(draft.contractId);
    const session = await getSession(draft.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }

    const validation = evaluateAttempt(contract, draft, session.cooldownUntil);
    await logTrainingEvent({
      type: 'attempt_validated',
      sessionId: session.sessionId,
      contractId: contract.id,
      payload: {
        symbol: draft.symbol,
        timeframe: draft.timeframe,
        ready: validation.ready,
        state: validation.state,
      },
    });

    res.json({ success: true, data: validation });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/attempts/run', async (req: Request, res: Response) => {
  try {
    const draft = buildAttemptDraft(req.body);
    if (!draft.contractId || !draft.sessionId) {
      return res.status(400).json({ success: false, error: 'contractId and sessionId are required.' });
    }
    const contract = await loadActiveContract(draft.contractId);
    const session = await getSession(draft.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }

    const validation = evaluateAttempt(contract, draft, session.cooldownUntil);
    const attemptId = randomUUID();
    const now = new Date().toISOString();
    let attempt: TrainingAttempt = {
      attemptId,
      sessionId: draft.sessionId,
      contractId: contract.id,
      contractVersion: contract.version,
      symbol: draft.symbol,
      timeframe: draft.timeframe,
      side: draft.side,
      entry: draft.entry,
      stop: draft.stop,
      takeProfit: draft.takeProfit,
      riskPct: validation.derived.riskPct,
      rewardRisk: validation.derived.rewardRisk,
      entryBarIndex: draft.entryBarIndex,
      entryBarTime: draft.entryBarTime || draft.bars[draft.entryBarIndex]?.time || now,
      drawings: draft.drawings || [],
      ruleEvaluations: validation.evaluations,
      violations: validation.evaluations.filter((item) => !item.passed).map((item) => item.description),
      rewards: validation.evaluations.filter((item) => item.passed).map((item) => item.description),
      status: validation.ready ? 'entered' : 'blocked',
      uiState: validation.state,
      bars: draft.bars,
      chartSnapshotRef: null,
      createdAt: now,
    };

    if (validation.ready) {
      attempt = {
        ...attempt,
        resolution: resolveForward({
          bars: draft.bars,
          side: draft.side,
          entry: draft.entry,
          stop: draft.stop,
          takeProfit: draft.takeProfit,
          startIndex: draft.entryBarIndex,
          maxHoldBars: draft.maxHoldBars ?? contract.simulation?.maxHoldBars,
          tieBreakPolicy: draft.tieBreakPolicy ?? contract.simulation?.tieBreakPolicy,
        }),
        status: 'resolved',
        uiState: 'RESOLVED',
        resolvedAt: new Date().toISOString(),
      };
    }

    await saveAttempt(attempt);
    const updatedSession = await attachAttemptToSession(session, attempt, contract);
    const scoreSnapshot = buildScoreSnapshot(
      attempt.ruleEvaluations,
      attempt.resolution,
      updatedSession.stats,
      contract.scoreWeights,
    );
    attempt = {
      ...attempt,
      scoreSnapshot,
    };
    await saveAttempt(attempt);

    await logTrainingEvent({
      type: 'attempt_resolved',
      sessionId: session.sessionId,
      attemptId: attempt.attemptId,
      contractId: contract.id,
      payload: {
        status: attempt.status,
        symbol: attempt.symbol,
        timeframe: attempt.timeframe,
        rMultiple: attempt.resolution?.rMultiple ?? null,
      },
    });

    res.json({
      success: true,
      data: {
        validation,
        attempt,
        session: updatedSession,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const contractId = req.query.contractId ? String(req.query.contractId) : undefined;
    const stats = await buildTrainingStats(contractId);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/detect-base', async (req: Request, res: Response) => {
  try {
    const { bars, options } = req.body || {};
    if (!Array.isArray(bars) || bars.length < 20) {
      return res.status(400).json({ success: false, error: 'bars must be an array with at least 20 elements' });
    }
    const densityBars: DensityBar[] = bars.map((b: any) => ({
      time: String(b.time || ''),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: b.volume != null ? Number(b.volume) : undefined,
    }));
    const result = detectBaseFromDensity(densityBars, options || {});
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
