import * as storage from './storageService';
import { StrategyCandidate } from '../types';

export function attachPersistedCandidateIds(
  candidates: StrategyCandidate[],
  persistedIds: string[],
): StrategyCandidate[] {
  const rows = Array.isArray(candidates) ? candidates : [];
  const ids = Array.isArray(persistedIds) ? persistedIds : [];
  return rows.map((candidate, index) => {
    const persistedId = String(
      ids[index] || (candidate as any)?.id || (candidate as any)?.candidate_id || '',
    ).trim();
    if (!persistedId) return candidate;
    return {
      ...(candidate as any),
      id: persistedId,
      candidate_id: persistedId,
    } as StrategyCandidate;
  });
}

export async function persistCandidatesForResponse(
  candidates: StrategyCandidate[],
): Promise<{ ids: string[]; candidates: StrategyCandidate[] }> {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) {
    return { ids: [], candidates: [] };
  }
  const ids = await storage.saveStrategyCandidates(rows);
  return {
    ids,
    candidates: attachPersistedCandidateIds(rows, ids),
  };
}
