import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import {
  AttemptDraft,
  ContractSnapshot,
  SemanticDeclaration,
  StrategyContract,
  TrainingAttempt,
  TrainingBar,
  TrainingDrawing,
  TrainingDrawingType,
  TrainingSession,
  TrainingSessionStrategyTemplate,
} from '../types';
import { evaluateAttempt, validateContract } from '../services/training/contractEngine';
import { resolveForward } from '../services/training/forwardResolver';
import { buildTrainingBacktestReport } from '../services/training/reportEngine';
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
    version: '1.2.0',
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
        description: 'Preferred: Long stop below the base bottom. Preferred: Short stop above the base top.',
        severity: 'warning',
      },
      {
        id: 'min_rr_2',
        type: 'min_reward_risk',
        min: 2,
        description: 'Trade must offer at least 2R reward-to-risk.',
        severity: 'warning',
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
    semanticVocabulary: {
      setupFamilies: ['breakout'],
      setupTags: ['opening_break', 'range_break', 'retest_entry', 'impulse_confirmed'],
      contextTags: ['trend_intact', 'compression', 'range_expansion', 'volume_support'],
      managementTags: ['hold_full', 'scale_out', 'move_to_be'],
      confidenceBuckets: ['A', 'B', 'C'],
    },
    semanticRequirements: {
      requireSetupFamily: false,
      requireThesis: false,
      requireInvalidation: false,
      requireConfidence: false,
      minSetupTags: 0,
      minContextTags: 0,
      familyRules: [
        {
          setupFamily: 'breakout',
          requiredDrawings: ['box'],
        },
      ],
    },
    notes: 'Draw a base box around the consolidation zone. Go long on a break above the top, or short on a break below the bottom.',
  },

  // ── Pullback ─────────────────────────────────────────────────────
  // Long: Fib retracement into a pullback low.  Short: Fib retracement into a pullback high.
  {
    id: 'pullback_v1',
    name: 'Pullback',
    version: '1.4.0',
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
        id: 'entry_near_fib',
        type: 'entry_near_fib_retracement',
        drawingId: 'pullback_fib',
        level: 0.786,
        tolerancePct: 25,
        description: 'Entry should be near a Fib retracement level (61.8% or 78.6%).',
        severity: 'warning',
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
        description: 'Preferred: Long stop below the Fib swing low. Preferred: Short stop above the Fib swing high.',
        severity: 'warning',
      },
      {
        id: 'min_rr_2',
        type: 'min_reward_risk',
        min: 2,
        description: 'Trade must offer at least 2R reward-to-risk.',
        severity: 'warning',
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
    semanticVocabulary: {
      setupFamilies: ['pullback'],
      setupTags: ['first_touch', 'late_entry', 'discount_zone', 'reclaim_trigger', 'lvn_retest'],
      contextTags: ['trend_intact', 'discount_zone', 'retest', 'momentum_pause', 'higher_timeframe_support'],
      managementTags: ['hold_full', 'scale_out', 'move_to_be'],
      confidenceBuckets: ['A', 'B', 'C'],
    },
    semanticRequirements: {
      requireSetupFamily: false,
      requireThesis: false,
      requireInvalidation: false,
      requireConfidence: false,
      minSetupTags: 0,
      minContextTags: 0,
      familyRules: [
        {
          setupFamily: 'pullback',
          requiredDrawings: ['fib'],
        },
      ],
    },
    notes: 'Draw a Fibonacci retracement. Long: swing high to swing low, enter near 78.6% or 61.8%. Short: swing low to swing high. Stop is 1 ATR past 100%, TP at the 0% level.',
  },

  // ── Fade (Mean Reversion) ────────────────────────────────────────
  // Trade back toward the center of a consolidation box from its edges.
  {
    id: 'fade_v1',
    name: 'Fade / Mean Reversion',
    version: '1.3.0',
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
        description: 'Preferred: stop outside the box edge you are fading from.',
        severity: 'warning',
      },
      {
        id: 'min_rr_2',
        type: 'min_reward_risk',
        min: 2,
        description: 'Trade must offer at least 2R reward-to-risk.',
        severity: 'warning',
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
    semanticVocabulary: {
      setupFamilies: ['fade', 'reversal'],
      setupTags: ['range_extreme', 'mean_reversion', 'first_touch', 'failed_break'],
      contextTags: ['range_bound', 'exhaustion', 'liquidity_sweep', 'value_reentry'],
      managementTags: ['hold_full', 'scale_out', 'move_to_be'],
      confidenceBuckets: ['A', 'B', 'C'],
    },
    semanticRequirements: {
      requireSetupFamily: false,
      requireThesis: false,
      requireInvalidation: false,
      requireConfidence: false,
      minSetupTags: 0,
      minContextTags: 0,
      familyRules: [
        {
          setupFamily: 'fade',
          requiredDrawings: ['box'],
        },
        {
          setupFamily: 'reversal',
          requiredDrawings: ['box'],
        },
      ],
    },
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

function toStringArray(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function toDrawingType(input: any): TrainingDrawingType | undefined {
  const value = String(input || '').trim();
  return value === 'box' || value === 'line' || value === 'point' || value === 'fib'
    ? value
    : undefined;
}

function toStrategyTemplate(input: any, contract: StrategyContract): TrainingSessionStrategyTemplate | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const family = String(input.family || '').trim();
  if (!family) return undefined;

  const requiredAnchorType = input.requiredAnchorType
    ? toDrawingType(input.requiredAnchorType)
    : (contract.requiredDrawings || []).find((drawing) => drawing && drawing.required)?.type;

  return {
    family,
    strategyVariant: input.strategyVariant ? String(input.strategyVariant).trim() : undefined,
    indicatorSet: toStringArray(input.indicatorSet),
    entryModel: input.entryModel ? String(input.entryModel).trim() : undefined,
    retracementPct: input.retracementPct != null ? Number(input.retracementPct) : undefined,
    stopModel: String(input.stopModel || 'atr_multiple').trim() === 'atr_multiple' ? 'atr_multiple' : 'atr_multiple',
    stopAtrMultiple: input.stopAtrMultiple != null ? Number(input.stopAtrMultiple) : undefined,
    targetModel: String(input.targetModel || 'r_multiple').trim() === 'r_multiple' ? 'r_multiple' : 'r_multiple',
    targetRMultiple: input.targetRMultiple != null ? Number(input.targetRMultiple) : undefined,
    confidence: input.confidence ? String(input.confidence).trim() : undefined,
    requiredAnchorType: requiredAnchorType,
    notes: input.notes ? String(input.notes).trim() : undefined,
  };
}

function toSemanticDeclaration(input: any, side: 'long' | 'short'): SemanticDeclaration | undefined {
  if (!input || typeof input !== 'object') return undefined;
  return {
    schemaVersion: String(input.schemaVersion || 'v1').trim() || 'v1',
    declaredAt: input.declaredAt ? String(input.declaredAt).trim() : undefined,
    setupFamily: input.setupFamily ? String(input.setupFamily).trim() : undefined,
    thesis: input.thesis ? String(input.thesis).trim() : undefined,
    notes: input.notes ? String(input.notes).trim() : undefined,
    invalidation: input.invalidation ? String(input.invalidation).trim() : undefined,
    side,
    confidence: input.confidence ? String(input.confidence).trim() : undefined,
    managementPlan: input.managementPlan ? String(input.managementPlan).trim() : undefined,
    setupTags: toStringArray(input.setupTags),
    contextTags: toStringArray(input.contextTags),
    managementTags: toStringArray(input.managementTags),
    chartSnapshotRef: input.chartSnapshotRef ? String(input.chartSnapshotRef).trim() : null,
  };
}

function mergeSemanticContractDefaults(contract: StrategyContract): StrategyContract {
  const builtin = DEFAULT_CONTRACTS.find((candidate) => candidate.id === contract.id);
  if (!builtin) return contract;
  return {
    ...contract,
    semanticVocabulary: contract.semanticVocabulary || builtin.semanticVocabulary,
    semanticRequirements: contract.semanticRequirements || builtin.semanticRequirements,
  };
}

function buildContractSnapshot(contract: StrategyContract): ContractSnapshot {
  return {
    id: contract.id,
    name: contract.name,
    version: contract.version,
    semanticVocabulary: contract.semanticVocabulary,
    semanticRequirements: contract.semanticRequirements,
  };
}

async function loadActiveContract(contractId: string): Promise<StrategyContract> {
  await ensureSampleContracts(DEFAULT_CONTRACTS);
  const contract = await getContract(contractId);
  if (!contract) {
    throw new Error(`Contract ${contractId} not found.`);
  }
  return mergeSemanticContractDefaults(contract);
}

function buildAttemptDraft(reqBody: any): AttemptDraft {
  const bars = toBars(reqBody?.bars);
  const entryBarIndex = Number(reqBody?.entryBarIndex);
  const entryBarTime = String(reqBody?.entryBarTime || bars[entryBarIndex]?.time || '').trim();
  const side = reqBody?.side === 'short' ? 'short' : 'long';

  return {
    sessionId: String(reqBody?.sessionId || '').trim(),
    contractId: String(reqBody?.contractId || '').trim(),
    symbol: String(reqBody?.symbol || '').trim().toUpperCase(),
    timeframe: String(reqBody?.timeframe || '').trim(),
    side,
    entry: Number(reqBody?.entry),
    stop: Number(reqBody?.stop),
    takeProfit: Number(reqBody?.takeProfit),
    takeProfit2: reqBody?.takeProfit2 != null ? Number(reqBody.takeProfit2) : undefined,
    takeProfit3: reqBody?.takeProfit3 != null ? Number(reqBody.takeProfit3) : undefined,
    riskPct: reqBody?.riskPct != null ? Number(reqBody.riskPct) : undefined,
    entryBarIndex,
    entryBarTime,
    drawings: toDrawings(reqBody?.drawings),
    semanticDeclaration: toSemanticDeclaration(reqBody?.semanticDeclaration, side),
    bars,
    maxHoldBars: reqBody?.maxHoldBars != null ? Number(reqBody.maxHoldBars) : undefined,
    tieBreakPolicy: reqBody?.tieBreakPolicy,
    entryModel: (['touch', 'first_reclaim', 'close_back_through'].includes(reqBody?.entryModel)
      ? reqBody.entryModel
      : undefined) as AttemptDraft['entryModel'],
  };
}

router.get('/contracts', async (_req: Request, res: Response) => {
  try {
    await ensureSampleContracts(DEFAULT_CONTRACTS);
    const contracts = (await listContracts()).map(mergeSemanticContractDefaults);
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
    const strategyTemplate = toStrategyTemplate(req.body?.strategyTemplate, contract);
    const session = await startTrainingSession(contract, String(req.body?.userId || 'local-user'), strategyTemplate);
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
      takeProfit2: draft.takeProfit2,
      takeProfit3: draft.takeProfit3,
      riskPct: validation.derived.riskPct,
      rewardRisk: validation.derived.rewardRisk,
      entryBarIndex: draft.entryBarIndex,
      entryBarTime: draft.entryBarTime || draft.bars[draft.entryBarIndex]?.time || now,
      drawings: draft.drawings || [],
      semanticDeclaration: draft.semanticDeclaration,
      ruleEvaluations: validation.evaluations,
      violations: validation.evaluations.filter((item) => !item.passed).map((item) => item.description),
      rewards: validation.evaluations.filter((item) => item.passed).map((item) => item.description),
      status: validation.ready ? 'entered' : 'blocked',
      uiState: validation.state,
      bars: draft.bars,
      chartSnapshotRef: `training-attempt://${attemptId}/chart`,
      contractSnapshot: buildContractSnapshot(contract),
      strategyTemplateSnapshot: session.strategyTemplate,
      createdAt: now,
    };

    if (attempt.semanticDeclaration) {
      attempt.semanticDeclaration = {
        ...attempt.semanticDeclaration,
        declaredAt: now,
        chartSnapshotRef: attempt.chartSnapshotRef,
      };
    }

    if (validation.ready) {
      attempt = {
        ...attempt,
        resolution: resolveForward({
          bars: draft.bars,
          side: draft.side,
          entry: draft.entry,
          stop: draft.stop,
          takeProfit: draft.takeProfit,
          takeProfit2: draft.takeProfit2,
          takeProfit3: draft.takeProfit3,
          startIndex: draft.entryBarIndex,
          maxHoldBars: draft.maxHoldBars ?? contract.simulation?.maxHoldBars,
          tieBreakPolicy: draft.tieBreakPolicy ?? contract.simulation?.tieBreakPolicy,
          entryModel: draft.entryModel,
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

router.get('/report', async (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId ? String(req.query.sessionId).trim() : undefined;
    const contractId = req.query.contractId ? String(req.query.contractId).trim() : undefined;

    let attempts: TrainingAttempt[] = [];
    let sessions: TrainingSession[] = [];

    if (sessionId) {
      const session = await getSession(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found.' });
      }
      attempts = await listAttemptsBySession(sessionId);
      sessions = [session];
    } else {
      const allAttempts = await listAttempts();
      const allSessions = await listSessions();
      attempts = contractId
        ? allAttempts.filter((attempt) => attempt.contractId === contractId)
        : allAttempts;
      sessions = contractId
        ? allSessions.filter((session) => session.contractId === contractId)
        : allSessions;
    }

    const report = buildTrainingBacktestReport({
      attempts,
      sessions,
      contractId,
      sessionId,
    });
    res.json({ success: true, data: report });
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
