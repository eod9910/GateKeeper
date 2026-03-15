import {
  AttemptDraft,
  AttemptValidationResult,
  RuleEvaluation,
  StrategyContract,
  TrainingDrawing,
  TrainingRuleDefinition,
  TrainingUiState,
} from '../../types';

function asUpperList(values: string[]): string[] {
  return values.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
}

function findDrawing(drawings: TrainingDrawing[], drawingId?: string): TrainingDrawing | undefined {
  if (!drawingId) return undefined;
  return drawings.find((drawing) => drawing.id === drawingId);
}

function rewardRisk(side: 'long' | 'short', entry: number, stop: number, takeProfit: number): { riskPerUnit: number; rewardPerUnit: number; rr: number } {
  const riskPerUnit = Math.abs(entry - stop);
  const rewardPerUnit = side === 'long' ? takeProfit - entry : entry - takeProfit;
  return {
    riskPerUnit,
    rewardPerUnit,
    rr: riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0,
  };
}

function compareTime(left?: string, right?: string): number {
  const leftMs = Date.parse(String(left || ''));
  const rightMs = Date.parse(String(right || ''));
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return 0;
  return leftMs - rightMs;
}

function fibLevelPrice(drawing: TrainingDrawing | undefined, level: number): number | null {
  if (!drawing) return null;
  const price1 = Number(drawing.price);
  const price2 = Number(drawing.price2);
  if (!Number.isFinite(price1) || !Number.isFinite(price2)) return null;
  return price1 + (price2 - price1) * level;
}

function evaluateRule(rule: TrainingRuleDefinition, draft: AttemptDraft): RuleEvaluation {
  const severity = rule.severity || 'block';
  const drawings = draft.drawings || [];
  const drawing = findDrawing(drawings, rule.drawingId);
  const base = {
    id: rule.id,
    type: rule.type,
    description: rule.description,
    severity,
  } as RuleEvaluation;

  switch (rule.type) {
    case 'required_drawing':
      return {
        ...base,
        passed: !!drawing,
        actual: drawing ? drawing.id : null,
        expected: rule.drawingId,
      };
    case 'entry_above_drawing_top':
      return {
        ...base,
        passed: !!drawing && draft.entry >= Number(drawing.top),
        actual: draft.entry,
        expected: drawing?.top,
      };
    case 'entry_below_drawing_bottom':
      return {
        ...base,
        passed: !!drawing && draft.entry <= Number(drawing.bottom),
        actual: draft.entry,
        expected: drawing?.bottom,
      };
    case 'entry_near_fib_level': {
      const level = Number(rule.level ?? 0.786);
      const expected = fibLevelPrice(drawing, level);
      const range = drawing ? Math.abs(Number(drawing.price) - Number(drawing.price2)) : 0;
      const tolerance = range > 0
        ? range * (Number(rule.tolerancePct || 1) / 100)
        : 0;
      return {
        ...base,
        passed: expected != null && Math.abs(draft.entry - expected) <= tolerance,
        actual: draft.entry,
        expected: expected != null ? { level, price: expected, tolerance } : { level },
      };
    }
    case 'stop_below_drawing_bottom': {
      const threshold = drawing ? Number(drawing.bottom) * (1 - Number(rule.bufferPct || 0) / 100) : null;
      return {
        ...base,
        passed: threshold != null && draft.stop <= threshold,
        actual: draft.stop,
        expected: threshold,
      };
    }
    case 'stop_above_drawing_top': {
      const threshold = drawing ? Number(drawing.top) * (1 + Number(rule.bufferPct || 0) / 100) : null;
      return {
        ...base,
        passed: threshold != null && draft.stop >= threshold,
        actual: draft.stop,
        expected: threshold,
      };
    }
    case 'entry_after_drawing_end':
      return {
        ...base,
        passed: !!drawing && compareTime(draft.entryBarTime, drawing.endTime) >= 0,
        actual: draft.entryBarTime,
        expected: drawing?.endTime,
      };
    case 'min_reward_risk': {
      const rr = rewardRisk(draft.side, draft.entry, draft.stop, draft.takeProfit).rr;
      return {
        ...base,
        passed: rr >= Number(rule.min || 0),
        actual: rr,
        expected: rule.min,
      };
    }
    case 'max_risk_pct': {
      const riskPct = draft.entry ? (Math.abs(draft.entry - draft.stop) / draft.entry) * 100 : 0;
      return {
        ...base,
        passed: riskPct <= Number(rule.max || Number.POSITIVE_INFINITY),
        actual: riskPct,
        expected: rule.max,
      };
    }
    case 'take_profit_above_entry':
      return {
        ...base,
        passed: draft.takeProfit > draft.entry,
        actual: draft.takeProfit,
        expected: `>${draft.entry}`,
      };
    case 'take_profit_below_entry':
      return {
        ...base,
        passed: draft.takeProfit < draft.entry,
        actual: draft.takeProfit,
        expected: `<${draft.entry}`,
      };

    // ── Side-aware rules (adapt to draft.side automatically) ────────
    case 'entry_breakout_from_drawing':
      if (draft.side === 'long') {
        return { ...base, passed: !!drawing && draft.entry >= Number(drawing.top), actual: draft.entry, expected: drawing?.top };
      }
      return { ...base, passed: !!drawing && draft.entry <= Number(drawing.bottom), actual: draft.entry, expected: drawing?.bottom };

    case 'entry_fade_into_drawing':
      if (draft.side === 'long') {
        const fadeThreshold = drawing ? Number(drawing.bottom) * (1 + Number(rule.tolerancePct || 2) / 100) : null;
        return { ...base, passed: fadeThreshold != null && draft.entry <= fadeThreshold, actual: draft.entry, expected: fadeThreshold };
      } else {
        const fadeThreshold = drawing ? Number(drawing.top) * (1 - Number(rule.tolerancePct || 2) / 100) : null;
        return { ...base, passed: fadeThreshold != null && draft.entry >= fadeThreshold, actual: draft.entry, expected: fadeThreshold };
      }

    case 'stop_outside_drawing': {
      if (draft.side === 'long') {
        const t = drawing ? Number(drawing.bottom) * (1 - Number(rule.bufferPct || 0) / 100) : null;
        return { ...base, passed: t != null && draft.stop <= t, actual: draft.stop, expected: t };
      }
      const t = drawing ? Number(drawing.top) * (1 + Number(rule.bufferPct || 0) / 100) : null;
      return { ...base, passed: t != null && draft.stop >= t, actual: draft.stop, expected: t };
    }

    case 'stop_beyond_fib_extreme': {
      if (draft.side === 'long') {
        const t = drawing ? Number(drawing.bottom) * (1 - Number(rule.bufferPct || 0) / 100) : null;
        return { ...base, passed: t != null && draft.stop <= t, actual: draft.stop, expected: t };
      }
      const t = drawing ? Number(drawing.top) * (1 + Number(rule.bufferPct || 0) / 100) : null;
      return { ...base, passed: t != null && draft.stop >= t, actual: draft.stop, expected: t };
    }

    case 'take_profit_beyond_entry':
      if (draft.side === 'long') {
        return { ...base, passed: draft.takeProfit > draft.entry, actual: draft.takeProfit, expected: `>${draft.entry}` };
      }
      return { ...base, passed: draft.takeProfit < draft.entry, actual: draft.takeProfit, expected: `<${draft.entry}` };

    case 'entry_near_fib_retracement': {
      const lvl = Number(rule.level ?? 0.786);
      const fibPrice = fibLevelPrice(drawing, draft.side === 'long' ? lvl : (1 - lvl));
      const rng = drawing ? Math.abs(Number(drawing.price) - Number(drawing.price2)) : 0;
      const tol = rng > 0 ? rng * (Number(rule.tolerancePct || 2) / 100) : 0;
      return { ...base, passed: fibPrice != null && Math.abs(draft.entry - fibPrice) <= tol, actual: draft.entry, expected: fibPrice != null ? { level: lvl, price: fibPrice, tolerance: tol } : { level: lvl } };
    }

    case 'entry_beyond_fib_level': {
      const lvl = Number(rule.level ?? 0.5);
      const fibPrice = fibLevelPrice(drawing, lvl);
      if (fibPrice == null) return { ...base, passed: false, actual: draft.entry, expected: null };
      const passed = draft.side === 'long'
        ? draft.entry <= fibPrice
        : draft.entry >= fibPrice;
      return { ...base, passed, actual: draft.entry, expected: { level: lvl, price: fibPrice, side: draft.side } };
    }

    default:
      return {
        ...base,
        passed: true,
      };
  }
}

export function validateContract(contract: StrategyContract): string[] {
  const issues: string[] = [];
  if (!contract.id) issues.push('Contract id is required.');
  if (!contract.name) issues.push('Contract name is required.');
  if (!contract.version) issues.push('Contract version is required.');
  if (!Array.isArray(contract.entryRules)) issues.push('entryRules must be an array.');
  if (!Array.isArray(contract.riskRules)) issues.push('riskRules must be an array.');
  if (!Array.isArray(contract.requiredDrawings)) issues.push('requiredDrawings must be an array.');
  if (!contract.scoreWeights || typeof contract.scoreWeights.process !== 'number' || typeof contract.scoreWeights.outcome !== 'number') {
    issues.push('scoreWeights.process and scoreWeights.outcome are required.');
  }
  return issues;
}

export function evaluateAttempt(contract: StrategyContract, draft: AttemptDraft, cooldownUntil?: string | null): AttemptValidationResult {
  const evaluations: RuleEvaluation[] = [];
  const symbolScope = asUpperList(contract.symbolScope || []);
  const timeframeScope = asUpperList(contract.timeframeScope || []);
  const sideScope = contract.sideScope || ['long', 'short'];

  if (cooldownUntil && Date.parse(cooldownUntil) > Date.now()) {
    evaluations.push({
      id: 'cooldown_lock',
      type: 'cooldown_lock',
      description: 'Session cooldown is active.',
      severity: 'block',
      passed: false,
      actual: new Date().toISOString(),
      expected: cooldownUntil,
    });
  }

  const bar = draft.bars[draft.entryBarIndex];
  evaluations.push({
    id: 'entry_bar_exists',
    type: 'entry_bar_exists',
    description: 'Entry bar must exist in the training chart.',
    severity: 'block',
    passed: !!bar,
    actual: draft.entryBarIndex,
    expected: `0-${Math.max(0, draft.bars.length - 1)}`,
  });

  evaluations.push({
    id: 'basic_ordering',
    type: 'basic_ordering',
    description: 'Entry, stop, and take profit must be ordered correctly for the chosen side.',
    severity: 'block',
    passed:
      draft.side === 'long'
        ? draft.stop < draft.entry && draft.takeProfit > draft.entry
        : draft.stop > draft.entry && draft.takeProfit < draft.entry,
    actual: { side: draft.side, entry: draft.entry, stop: draft.stop, takeProfit: draft.takeProfit },
  });

  evaluations.push({
    id: 'symbol_scope',
    type: 'required_drawing',
    description: 'Symbol must be allowed by the contract scope.',
    severity: 'warning',
    passed: symbolScope.length === 0 || symbolScope.includes(String(draft.symbol || '').trim().toUpperCase()),
    actual: draft.symbol,
    expected: symbolScope,
  });

  evaluations.push({
    id: 'timeframe_scope',
    type: 'required_drawing',
    description: 'Timeframe must be allowed by the contract scope.',
    severity: 'warning',
    passed: timeframeScope.length === 0 || timeframeScope.includes(String(draft.timeframe || '').trim().toUpperCase()),
    actual: draft.timeframe,
    expected: timeframeScope,
  });

  evaluations.push({
    id: 'side_scope',
    type: 'required_drawing',
    description: 'Side must be allowed by the contract.',
    severity: 'block',
    passed: sideScope.includes(draft.side),
    actual: draft.side,
    expected: sideScope,
  });

  for (const required of contract.requiredDrawings || []) {
    if (!required.required) continue;
    evaluations.push({
      id: `required_${required.id}`,
      type: 'required_drawing',
      description: `${required.label} is required.`,
      severity: 'block',
      passed: !!findDrawing(draft.drawings || [], required.id),
      actual: (draft.drawings || []).map((drawing) => drawing.id),
      expected: required.id,
    });
  }

  for (const rule of [...(contract.entryRules || []), ...(contract.riskRules || [])]) {
    if (rule.enabled === false) continue;
    evaluations.push(evaluateRule(rule, draft));
  }

  const derived = rewardRisk(draft.side, draft.entry, draft.stop, draft.takeProfit);
  const riskPct = draft.entry ? (Math.abs(draft.entry - draft.stop) / draft.entry) * 100 : 0;
  const blockingFailures = evaluations.filter((evaluation) => !evaluation.passed && evaluation.severity === 'block');
  const state: TrainingUiState = cooldownUntil && Date.parse(cooldownUntil) > Date.now()
    ? 'COOLDOWN'
    : blockingFailures.length > 0
      ? 'ENTRY_BLOCKED'
      : 'ENTRY_READY';

  return {
    state,
    ready: state === 'ENTRY_READY',
    evaluations,
    derived: {
      riskPerUnit: derived.riskPerUnit,
      rewardPerUnit: derived.rewardPerUnit,
      rewardRisk: derived.rr,
      riskPct,
    },
    cooldownUntil: cooldownUntil || null,
  };
}
