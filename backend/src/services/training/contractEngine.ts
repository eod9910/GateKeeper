import {
  AttemptDraft,
  AttemptValidationResult,
  RuleEvaluation,
  SemanticFamilyRule,
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

function asList(values: string[] | undefined): string[] {
  return Array.isArray(values) ? values.map((value) => String(value || '').trim()).filter(Boolean) : [];
}

function hasRequiredDrawings(drawings: TrainingDrawing[], requiredTypes: string[]): boolean {
  if (!requiredTypes.length) return true;
  const availableTypes = new Set((drawings || []).map((drawing) => String(drawing.type || '').trim().toLowerCase()));
  return requiredTypes.every((type) => availableTypes.has(String(type || '').trim().toLowerCase()));
}

function familyRuleForDraft(contract: StrategyContract, draft: AttemptDraft): SemanticFamilyRule | null {
  const declaration = draft.semanticDeclaration;
  const family = String(declaration?.setupFamily || '').trim().toLowerCase();
  const rules = contract.semanticRequirements?.familyRules || [];
  return rules.find((rule) => String(rule.setupFamily || '').trim().toLowerCase() === family) || null;
}

function evaluateSemanticDeclaration(contract: StrategyContract, draft: AttemptDraft): RuleEvaluation[] {
  const requirements = contract.semanticRequirements;
  if (!requirements) return [];

  const declaration = draft.semanticDeclaration;
  const setupTags = asList(declaration?.setupTags);
  const contextTags = asList(declaration?.contextTags);
  const managementTags = asList(declaration?.managementTags);
  const activeFamilyRule = familyRuleForDraft(contract, draft);
  const evaluations: RuleEvaluation[] = [];

  evaluations.push({
    id: 'semantic_declaration_present',
    type: 'semantic_declaration',
    description: 'Trade declaration must be completed before running the attempt.',
    severity: 'block',
    passed: !!declaration,
    actual: !!declaration,
    expected: true,
  });

  if (!declaration) {
    return evaluations;
  }

  if (requirements.requireSetupFamily) {
    evaluations.push({
      id: 'semantic_setup_family',
      type: 'semantic_declaration',
      description: 'Setup family must be declared.',
      severity: 'block',
      passed: !!String(declaration.setupFamily || '').trim(),
      actual: declaration.setupFamily || null,
      expected: 'non-empty setup family',
    });
  }

  if (requirements.requireThesis) {
    evaluations.push({
      id: 'semantic_thesis',
      type: 'semantic_declaration',
      description: 'Trade thesis must be written before outcome is known.',
      severity: 'block',
      passed: !!String(declaration.thesis || '').trim(),
      actual: declaration.thesis || null,
      expected: 'non-empty thesis',
    });
  }

  if (requirements.requireInvalidation) {
    evaluations.push({
      id: 'semantic_invalidation',
      type: 'semantic_declaration',
      description: 'Invalidation statement must be declared.',
      severity: 'block',
      passed: !!String(declaration.invalidation || '').trim(),
      actual: declaration.invalidation || null,
      expected: 'non-empty invalidation',
    });
  }

  if (requirements.requireConfidence) {
    evaluations.push({
      id: 'semantic_confidence',
      type: 'semantic_declaration',
      description: 'Confidence bucket must be declared.',
      severity: 'block',
      passed: !!String(declaration.confidence || '').trim(),
      actual: declaration.confidence || null,
      expected: 'non-empty confidence bucket',
    });
  }

  if (requirements.requireManagementPlan) {
    evaluations.push({
      id: 'semantic_management_plan',
      type: 'semantic_declaration',
      description: 'Management plan must be declared.',
      severity: 'block',
      passed: !!String(declaration.managementPlan || '').trim(),
      actual: declaration.managementPlan || null,
      expected: 'non-empty management plan',
    });
  }

  if ((requirements.minSetupTags || 0) > 0) {
    evaluations.push({
      id: 'semantic_setup_tags',
      type: 'semantic_declaration',
      description: `At least ${requirements.minSetupTags} setup tag(s) must be selected.`,
      severity: 'block',
      passed: setupTags.length >= Number(requirements.minSetupTags || 0),
      actual: setupTags,
      expected: Number(requirements.minSetupTags || 0),
    });
  }

  if ((requirements.minContextTags || 0) > 0) {
    evaluations.push({
      id: 'semantic_context_tags',
      type: 'semantic_declaration',
      description: `At least ${requirements.minContextTags} context tag(s) must be selected.`,
      severity: 'block',
      passed: contextTags.length >= Number(requirements.minContextTags || 0),
      actual: contextTags,
      expected: Number(requirements.minContextTags || 0),
    });
  }

  if (activeFamilyRule) {
    evaluations.push({
      id: 'semantic_family_rule_drawings',
      type: 'semantic_declaration',
      description: 'Declared setup family must include its required drawing proof.',
      severity: 'block',
      passed: hasRequiredDrawings(draft.drawings || [], (activeFamilyRule.requiredDrawings || []).map((type) => String(type))),
      actual: (draft.drawings || []).map((drawing) => drawing.type),
      expected: activeFamilyRule.requiredDrawings || [],
    });

    evaluations.push({
      id: 'semantic_family_rule_setup_tags',
      type: 'semantic_declaration',
      description: 'Declared setup family must include its required setup tags.',
      severity: 'warning',
      passed: asList(activeFamilyRule.requiredSetupTags).every((tag) => setupTags.includes(tag)),
      actual: setupTags,
      expected: activeFamilyRule.requiredSetupTags || [],
    });

    evaluations.push({
      id: 'semantic_family_rule_context_tags',
      type: 'semantic_declaration',
      description: 'Declared setup family must include its required context tags.',
      severity: 'warning',
      passed: asList(activeFamilyRule.requiredContextTags).every((tag) => contextTags.includes(tag)),
      actual: contextTags,
      expected: activeFamilyRule.requiredContextTags || [],
    });

    if (activeFamilyRule.requireManagementPlan) {
      evaluations.push({
        id: 'semantic_family_rule_management',
        type: 'semantic_declaration',
        description: 'Declared setup family requires a management plan.',
        severity: 'block',
        passed: !!String(declaration.managementPlan || '').trim() || managementTags.length > 0,
        actual: declaration.managementPlan || managementTags,
        expected: 'management plan or management tags',
      });
    }
  }

  return evaluations;
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

  evaluations.push(...evaluateSemanticDeclaration(contract, draft));

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
