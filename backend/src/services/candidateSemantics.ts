import { StrategyCandidate } from '../types';

export type CandidateRole = 'context_indicator' | 'pattern_detector' | 'entry_signal';
export type CandidateActionability = 'context_only' | 'setup_watch' | 'entry_ready';

export interface CandidateSemanticsMeta {
  artifactType?: string | null;
  indicatorRole?: string | null;
  patternRole?: string | null;
  entryType?: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function roleLabel(role: CandidateRole): string {
  if (role === 'context_indicator') return 'Context';
  if (role === 'pattern_detector') return 'Pattern';
  return 'Signal';
}

function actionabilityLabel(actionability: CandidateActionability): string {
  if (actionability === 'context_only') return 'Context Only';
  if (actionability === 'setup_watch') return 'Watch';
  return 'Entry Ready';
}

function buildSummary(role: CandidateRole, actionability: CandidateActionability): string {
  if (actionability === 'context_only') return role === 'pattern_detector' ? 'Pattern context only' : 'Context only';
  if (actionability === 'entry_ready') return 'Actionable entry';
  if (role === 'entry_signal') return 'Signal logic loaded, watch setup';
  return 'Pattern found, not entry-ready';
}

export function deriveCandidateSemantics(
  candidate: Partial<StrategyCandidate> | null | undefined,
  meta?: CandidateSemanticsMeta | null,
): {
  candidate_role: CandidateRole;
  candidate_role_label: string;
  candidate_actionability: CandidateActionability;
  candidate_actionability_label: string;
  candidate_semantic_summary: string;
  candidate_origin_role: string | null;
  candidate_entry_type: string | null;
} {
  const artifactType = normalizeText(meta?.artifactType);
  const indicatorRole = normalizeText(meta?.indicatorRole);
  const patternRole = normalizeText(meta?.patternRole);
  const entryType = normalizeText(meta?.entryType);
  const patternType = normalizeText(candidate?.pattern_type);
  const entryReady = candidate?.entry_ready === true;

  let role: CandidateRole;
  if (indicatorRole === 'context') {
    role = artifactType === 'pattern' ? 'pattern_detector' : 'context_indicator';
  } else if (indicatorRole.includes('entry') || (entryType && entryType !== 'analysis_only')) {
    role = 'entry_signal';
  } else if (patternRole || artifactType === 'pattern') {
    role = 'pattern_detector';
  } else if (entryReady) {
    role = 'entry_signal';
  } else if (
    patternType.includes('wyckoff')
    || patternType.includes('pattern')
    || patternType.includes('base')
    || candidate?.base
    || candidate?.pullback
    || candidate?.second_breakout
  ) {
    role = 'pattern_detector';
  } else {
    role = 'context_indicator';
  }

  let actionability: CandidateActionability;
  if (entryType === 'analysis_only' || (role === 'context_indicator' && !entryReady)) {
    actionability = 'context_only';
  } else if (entryReady) {
    actionability = 'entry_ready';
  } else {
    actionability = 'setup_watch';
  }

  return {
    candidate_role: role,
    candidate_role_label: roleLabel(role),
    candidate_actionability: actionability,
    candidate_actionability_label: actionabilityLabel(actionability),
    candidate_semantic_summary: buildSummary(role, actionability),
    candidate_origin_role: indicatorRole || patternRole || null,
    candidate_entry_type: entryType || null,
  };
}

export function applyCandidateSemantics(
  candidate: StrategyCandidate,
  meta?: CandidateSemanticsMeta | null,
): StrategyCandidate {
  return {
    ...candidate,
    ...deriveCandidateSemantics(candidate, meta),
  };
}

export function applyCandidateSemanticsList(
  candidates: StrategyCandidate[],
  meta?: CandidateSemanticsMeta | null,
): StrategyCandidate[] {
  const rows = Array.isArray(candidates) ? candidates : [];
  return rows.map((candidate) => applyCandidateSemantics(candidate, meta));
}
