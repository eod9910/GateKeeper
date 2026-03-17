import { StrategyCandidate } from '../types';

const BASE_QUALIFY_RULE_NAMES = new Set([
  'base_detected',
  'base_qualified',
  'flat_base_events_found',
  'base_zones_found',
]);

export function toFiniteNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseStrictBaseRequest(body: any): { strictBase: boolean; strictBaseMinScore: number } {
  const strictBase = body?.strictBase !== false;
  const rawMin = toFiniteNumber(body?.strictBaseMinScore);
  const strictBaseMinScore = rawMin == null
    ? 0.5
    : Math.max(0, Math.min(1, rawMin));
  return { strictBase, strictBaseMinScore };
}

export function parseOnePerSymbolRequest(body: any): boolean {
  return body?.onePerSymbol !== false;
}

function candidateScoreValue(candidate: any): number {
  const n = toFiniteNumber(candidate?.score);
  return n == null ? Number.NEGATIVE_INFINITY : n;
}

function candidateTimeValue(candidate: any): number {
  const raw = candidate?.createdAt ?? candidate?.created_at ?? candidate?.timestamp ?? '';
  const ms = Date.parse(String(raw || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function pickBetterCandidate(existing: any, incoming: any): any {
  const es = candidateScoreValue(existing);
  const is = candidateScoreValue(incoming);
  if (is > es) return incoming;
  if (is < es) return existing;
  return candidateTimeValue(incoming) >= candidateTimeValue(existing) ? incoming : existing;
}

export function reduceOnePerSymbolCandidates(candidates: StrategyCandidate[], onePerSymbol: boolean): StrategyCandidate[] {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!onePerSymbol) return rows;
  const bySymbol = new Map<string, StrategyCandidate>();
  for (const candidate of rows) {
    const symbol = String((candidate as any)?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const existing = bySymbol.get(symbol);
    if (!existing) {
      bySymbol.set(symbol, candidate);
      continue;
    }
    bySymbol.set(symbol, pickBetterCandidate(existing, candidate));
  }
  return Array.from(bySymbol.values()).sort((a, b) => candidateScoreValue(b) - candidateScoreValue(a));
}

export function candidateRules(candidate: any): Array<{ ruleName: string; passed: boolean }> {
  const raw = Array.isArray(candidate?.rule_checklist) ? candidate.rule_checklist : [];
  const rows: Array<{ ruleName: string; passed: boolean }> = [];
  for (const item of raw) {
    const ruleName = String(item?.rule_name || '').trim();
    if (!ruleName) continue;
    rows.push({
      ruleName,
      passed: item?.passed === true,
    });
  }
  return rows;
}

export function isBaseLikeCandidate(candidate: any): boolean {
  const pattern = String(candidate?.pattern_type || candidate?.strategy_version_id || '')
    .trim()
    .toLowerCase();
  if (pattern.includes('base')) return true;
  const rules = candidateRules(candidate);
  return rules.some((r) => BASE_QUALIFY_RULE_NAMES.has(r.ruleName));
}

export function passesStrictBaseCandidate(candidate: any, minScore: number): boolean {
  const rules = candidateRules(candidate);
  const qualifyingRules = rules.filter((r) => BASE_QUALIFY_RULE_NAMES.has(r.ruleName));
  if (qualifyingRules.length > 0) {
    return qualifyingRules.some((r) => r.passed);
  }

  if (typeof candidate?.entry_ready === 'boolean') {
    return candidate.entry_ready;
  }
  const score = toFiniteNumber(candidate?.score);
  return score != null && score >= minScore;
}

export function filterStrictBaseCandidates(
  candidates: StrategyCandidate[],
  strictBase: boolean,
  strictBaseMinScore: number,
): StrategyCandidate[] {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!strictBase) return rows;
  const minScore = Number.isFinite(strictBaseMinScore) ? strictBaseMinScore : 0.5;
  return rows.filter((candidate: any) => {
    if (!isBaseLikeCandidate(candidate)) return true;
    return passesStrictBaseCandidate(candidate, minScore);
  });
}

export function extractSuiteReportFromOutput(stdout: string): any | null {
  const text = String(stdout || '');
  if (!text.trim()) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.suite_id && Array.isArray(parsed.method_aggregate)) {
      return parsed;
    }
  } catch {}

  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) !== 123) continue;
    const slice = text.slice(i).trim();
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed === 'object' && parsed.suite_id && Array.isArray(parsed.method_aggregate)) {
        return parsed;
      }
    } catch {}
  }
  return null;
}
