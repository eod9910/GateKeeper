import {
  buildCompositeStageId,
  inferIndicatorRole,
} from './compositeNaming';
import { loadPrimitiveDefaultParams } from './compositePatternStore';

export interface InferredCompositeStage {
  id: string;
  pattern_id: string;
  params: Record<string, any>;
}

export function inferCompositeStagesFromContext(message: string, context: any, patternDataDir?: string): InferredCompositeStage[] {
  const primitives = Array.isArray(context?.availablePrimitives) ? context.availablePrimitives : [];
  const chatHistory = Array.isArray(context?.chatHistory) ? context.chatHistory : [];
  const combined = [String(message || ''), ...chatHistory.map((item: any) => String(item?.text || ''))].join(' ').toLowerCase();
  const roleOrder: Record<string, number> = {
    anchor_structure: 1,
    location: 2,
    location_filter: 3,
    timing_trigger: 4,
    trigger: 4,
    context: 5,
    state_filter: 6,
    regime_state: 6,
    structure_filter: 6,
    unknown: 99,
  };
  const matches = primitives
    .map((primitive: any) => {
      const patternId = String(primitive?.pattern_id || '').trim();
      const name = String(primitive?.name || '').trim();
      const role = String(primitive?.indicator_role || 'unknown').trim();
      if (!patternId) return null;

      let score = 0;
      if (combined.includes(patternId.toLowerCase())) score += 100;
      if (name && combined.includes(name.toLowerCase())) score += 80;

      const tokens = [
        ...patternId.toLowerCase().split(/[_\s-]+/),
        ...name.toLowerCase().split(/[_\s-]+/),
      ].filter(Boolean);
      for (const token of tokens) {
        if (token.length >= 3 && combined.includes(token)) score += 5;
      }
      if (patternId === 'rdp_swing_structure' && /\brdp\b|\bpivot\b/.test(combined)) score += 40;
      if (patternId === 'fib_location_primitive' && /\bfib\b|\bfibonacci\b|\blocation\b|\bretracement\b/.test(combined)) score += 40;

      return score > 0 ? { pattern_id: patternId, indicator_role: role, score } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      if (b.score !== a.score) return b.score - a.score;
      return (roleOrder[a.indicator_role] ?? 99) - (roleOrder[b.indicator_role] ?? 99);
    });

  const selected = [] as InferredCompositeStage[];
  const seen = new Set<string>();
  for (const match of matches) {
    if (seen.has(match.pattern_id)) continue;
    seen.add(match.pattern_id);
    selected.push({
      id: buildCompositeStageId(match.indicator_role, selected.map((stage) => stage.id)),
      pattern_id: match.pattern_id,
      params: loadPrimitiveDefaultParams(match.pattern_id, patternDataDir),
    });
  }
  return selected
    .sort((a, b) => (roleOrder[inferIndicatorRole(a.pattern_id, primitives)] ?? 99) - (roleOrder[inferIndicatorRole(b.pattern_id, primitives)] ?? 99))
    .slice(0, 6)
    .map((stage, index, allStages) => ({
      ...stage,
      id: buildCompositeStageId(inferIndicatorRole(stage.pattern_id, primitives), allStages.slice(0, index).map((item) => item.id)),
    }));
}
