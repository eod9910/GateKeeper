/**
 * Pattern Storage Service (TypeScript)
 * 
 * Stores pattern candidates and user labels in JSON files.
 * Inspired by the corrections workflow in FlashRAG's handwriting system.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { 
  PatternCandidate, 
  PatternLabel, 
  PatternCorrection,
  LabelType, 
  LabelingStats,
  StrategySpec,
  StrategyCandidate,
  ValidationReport,
  TradeInstance
} from '../types';
import { applyParameterManifest } from './parameterManifest';

// ---------------------------------------------------------------------------
// Spec Hash — integrity fingerprint for a strategy's trading logic
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 hash of the config-relevant fields of a StrategySpec.
 * The hash covers ONLY the trading logic, not metadata (name, description, status, timestamps).
 * This means two specs with identical logic but different names produce the same hash.
 */
function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function computeSpecHash(spec: StrategySpec): string {
  const payload = {
    strategy_id: spec.strategy_id,
    version: spec.version,
    structure_config: spec.structure_config || null,
    setup_config: spec.setup_config || null,
    entry_config: spec.entry_config || null,
    risk_config: spec.risk_config || null,
    exit_config: spec.exit_config || null,
    cost_config: spec.cost_config || null,
  };
  const json = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(json).digest('hex');
}

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CANDIDATES_DIR = path.join(DATA_DIR, 'candidates');
const LABELS_DIR = path.join(DATA_DIR, 'labels');
const CORRECTIONS_DIR = path.join(DATA_DIR, 'corrections');
const SAVED_CHARTS_DIR = path.join(DATA_DIR, 'saved-charts');
const TRADE_HISTORY_DIR = path.join(DATA_DIR, 'trade-history');
const DISCOUNT_CANDIDATES_DIR = path.join(DATA_DIR, 'discount-candidates');
const STRATEGIES_DIR = path.join(DATA_DIR, 'strategies');
const VALIDATION_REPORTS_DIR = path.join(DATA_DIR, 'validation-reports');
const TRADE_INSTANCES_DIR = path.join(DATA_DIR, 'trade-instances');

function parseJsonWithBomSupport<T>(content: string): T {
  if (typeof content !== 'string') {
    return JSON.parse(String(content || '')) as T;
  }
  const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return JSON.parse(normalized) as T;
}

function toFiniteNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRoundedNumber(value: any, decimals = 4): string {
  const n = toFiniteNumber(value);
  if (n == null) return 'na';
  return n.toFixed(decimals);
}

function toIntToken(value: any): string {
  const n = toFiniteNumber(value);
  if (n == null) return 'na';
  return String(Math.trunc(n));
}

function candidateScore(value: any): number {
  const n = toFiniteNumber(value?.score);
  return n == null ? Number.NEGATIVE_INFINITY : n;
}

function candidateTimeMs(value: any): number {
  const raw = value?.createdAt ?? value?.created_at ?? value?.timestamp ?? '';
  const ms = Date.parse(String(raw || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function shouldReplaceCandidate(existing: any, incoming: any): boolean {
  const existingScore = candidateScore(existing);
  const incomingScore = candidateScore(incoming);
  if (incomingScore > existingScore) return true;
  if (incomingScore < existingScore) return false;
  return candidateTimeMs(incoming) > candidateTimeMs(existing);
}

function strategyCandidateDedupeKey(candidate: any): string {
  // Logical identity for "same candidate" across rescans/spec hashes.
  const symbol = String(candidate?.symbol || '').trim().toUpperCase() || 'NA';
  const timeframe = String(candidate?.timeframe || '').trim().toUpperCase() || 'NA';
  const pattern = String(candidate?.pattern_type || candidate?.strategy_version_id || '').trim() || 'NA';
  const windowStart = toIntToken(candidate?.window_start);
  const windowEnd = toIntToken(candidate?.window_end);
  const chartBaseStart = toIntToken(candidate?.chart_base_start);
  const chartBaseEnd = toIntToken(candidate?.chart_base_end);
  const baseHigh = toRoundedNumber(candidate?.base?.high);
  const baseLow = toRoundedNumber(candidate?.base?.low);

  return [
    'v1',
    symbol,
    timeframe,
    pattern,
    windowStart,
    windowEnd,
    chartBaseStart,
    chartBaseEnd,
    baseHigh,
    baseLow,
  ].join('|');
}

/**
 * Ensure data directories exist
 */
async function ensureDirectories(): Promise<void> {
  await fs.mkdir(CANDIDATES_DIR, { recursive: true });
  await fs.mkdir(LABELS_DIR, { recursive: true });
  await fs.mkdir(CORRECTIONS_DIR, { recursive: true });
  await fs.mkdir(SAVED_CHARTS_DIR, { recursive: true });
  await fs.mkdir(TRADE_HISTORY_DIR, { recursive: true });
  await fs.mkdir(DISCOUNT_CANDIDATES_DIR, { recursive: true });
  await fs.mkdir(STRATEGIES_DIR, { recursive: true });
  await fs.mkdir(VALIDATION_REPORTS_DIR, { recursive: true });
  await fs.mkdir(TRADE_INSTANCES_DIR, { recursive: true });
}

/**
 * Save a pattern candidate
 */
export async function saveCandidate(candidate: PatternCandidate): Promise<string> {
  await ensureDirectories();
  
  const id = candidate.id || uuidv4();
  const filepath = path.join(CANDIDATES_DIR, `${id}.json`);
  
  const data: PatternCandidate = {
    ...candidate,
    id,
    createdAt: candidate.createdAt || new Date().toISOString()
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Save multiple candidates (from scanner output)
 */
export async function saveCandidates(candidates: PatternCandidate[]): Promise<string[]> {
  const ids: string[] = [];
  for (const candidate of candidates) {
    const id = await saveCandidate(candidate);
    ids.push(id);
  }
  return ids;
}

/**
 * Get a candidate by ID
 */
export async function getCandidate(id: string): Promise<PatternCandidate | null> {
  const filepath = path.join(CANDIDATES_DIR, `${id}.json`);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content) as PatternCandidate;
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Get all candidates
 */
export async function getAllCandidates(): Promise<PatternCandidate[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(CANDIDATES_DIR);
  const dedupedByKey = new Map<string, PatternCandidate>();
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(CANDIDATES_DIR, file);
      try {
        const content = await fs.readFile(filepath, 'utf-8');
        const candidate = JSON.parse(content) as PatternCandidate;
        const key = strategyCandidateDedupeKey(candidate as any);
        const existing = dedupedByKey.get(key);
        if (!existing || shouldReplaceCandidate(existing, candidate)) {
          dedupedByKey.set(key, candidate);
        }
      } catch {
        // Skip malformed candidate files.
      }
    }
  }

  const candidates = Array.from(dedupedByKey.values());
  // Sort by score descending
  return candidates.sort((a, b) => candidateScore(b) - candidateScore(a));
}

/**
 * Save a user label for a candidate
 */
export async function saveLabel(
  candidateId: string, 
  userId: string, 
  label: LabelType, 
  notes: string = '',
  symbol?: string,
  timeframe?: string,
  metadata?: Partial<Pick<PatternLabel, 'source' | 'confidence' | 'modelVersion' | 'runId' | 'reasoning'>>
): Promise<string> {
  await ensureDirectories();
  
  const id = uuidv4();
  const filepath = path.join(LABELS_DIR, `${id}.json`);
  
  const data: PatternLabel = {
    id,
    candidateId,
    userId,
    label,
    notes,
    timestamp: new Date().toISOString(),
    ...(symbol && { symbol }),
    ...(timeframe && { timeframe }),
    ...(metadata?.source ? { source: metadata.source } : {}),
    ...(Number.isFinite(Number(metadata?.confidence)) ? { confidence: Number(metadata?.confidence) } : {}),
    ...(metadata?.modelVersion ? { modelVersion: String(metadata.modelVersion) } : {}),
    ...(metadata?.runId ? { runId: String(metadata.runId) } : {}),
    ...(metadata?.reasoning ? { reasoning: String(metadata.reasoning) } : {}),
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Get all labels
 */
export async function getAllLabels(userId?: string): Promise<PatternLabel[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(LABELS_DIR);
  const labels: PatternLabel[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(LABELS_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const label = parseJsonWithBomSupport<PatternLabel>(content);
      
      if (!userId || label.userId === userId) {
        labels.push(label);
      }
    }
  }
  
  // Sort by timestamp descending
  return labels.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Get labels for a specific candidate
 */
export async function getLabelsForCandidate(candidateId: string): Promise<PatternLabel[]> {
  const allLabels = await getAllLabels();
  return allLabels.filter(l => l.candidateId === candidateId);
}

/**
 * Delete a label
 */
export async function deleteLabel(id: string): Promise<boolean> {
  const filepath = path.join(LABELS_DIR, `${id}.json`);
  
  try {
    await fs.unlink(filepath);
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Clear all labels (nuclear option)
 */
export async function clearLabels(): Promise<void> {
  await ensureDirectories();
  const files = await fs.readdir(LABELS_DIR);
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      await fs.unlink(path.join(LABELS_DIR, file));
    }
  }
}

/**
 * Get unlabeled candidates (for the labeling queue)
 */
export async function getUnlabeledCandidates(userId: string): Promise<PatternCandidate[]> {
  const candidates = await getAllCandidates();
  const labels = await getAllLabels(userId);
  const corrections = await getAllCorrections();
  
  const labeledIds = new Set(labels.map(l => l.candidateId));
  for (const correction of corrections) {
    if (userId && correction.userId !== userId) continue;
    labeledIds.add(correction.candidateId);
  }
  
  return candidates.filter(c => !labeledIds.has(c.id));
}

/**
 * Get labeling statistics
 */
export async function getStats(userId?: string): Promise<LabelingStats> {
  const labels = await getAllLabels(userId);
  const candidates = await getAllCandidates();
  const corrections = await getAllCorrections();
  const candidateIds = new Set(candidates.map((c) => String(c.id || '')));

  // Restrict stats to the active candidate bucket currently in /data/candidates.
  const labelsInBucket = labels.filter((l) => candidateIds.has(String(l.candidateId || '')));
  const relevantCorrections = corrections.filter((c) => {
    if (userId && c.userId !== userId) return false;
    return candidateIds.has(String(c.candidateId || ''));
  });

  // Count outcomes by latest state per candidate (not historical event counts).
  const latestLabelByCandidate = new Map<string, PatternLabel>();
  for (const label of labelsInBucket) {
    const cid = String(label.candidateId || '');
    if (!cid || latestLabelByCandidate.has(cid)) continue;
    latestLabelByCandidate.set(cid, label);
  }
  const latestCorrectionByCandidate = new Map<string, PatternCorrection>();
  for (const correction of relevantCorrections) {
    const cid = String(correction.candidateId || '');
    if (!cid || latestCorrectionByCandidate.has(cid)) continue;
    latestCorrectionByCandidate.set(cid, correction);
  }

  const isAutoCloseFromCorrection = (label: PatternLabel): boolean => {
    if (label.label !== 'close') return false;
    const note = String(label.notes || '').trim().toLowerCase();
    return note === 'corrected by user' || note === 'annotated with drawings';
  };

  let yesCount = 0;
  let noCount = 0;
  let closeCount = 0;
  let correctedCandidates = 0;
  let unlabeled = 0;

  for (const candidate of candidates) {
    const cid = String(candidate.id || '');
    const label = latestLabelByCandidate.get(cid);
    const correction = latestCorrectionByCandidate.get(cid);

    if (label) {
      if (label.label === 'yes') {
        yesCount += 1;
      } else if (label.label === 'no') {
        noCount += 1;
      } else if (label.label === 'close') {
        // Auto-close generated from corrections should count as corrected status,
        // not as manual SKIP status.
        if (isAutoCloseFromCorrection(label) && correction) {
          correctedCandidates += 1;
        } else {
          closeCount += 1;
        }
      } else {
        unlabeled += 1;
      }
      continue;
    }

    if (correction) {
      correctedCandidates += 1;
    } else {
      unlabeled += 1;
    }
  }

  const reviewedCandidates = Math.max(0, candidates.length - unlabeled);
  
  return {
    totalCandidates: candidates.length,
    // Keep totalLabels as record count (not deduped) for observability.
    totalLabels: labelsInBucket.length,
    yesCount,
    noCount,
    closeCount,
    correctedCount: correctedCandidates,
    correctedCandidates,
    reviewedCandidates,
    unlabeled
  };
}

/**
 * Clear all candidates (for testing)
 */
export async function clearCandidates(): Promise<void> {
  await ensureDirectories();
  const files = await fs.readdir(CANDIDATES_DIR);
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      await fs.unlink(path.join(CANDIDATES_DIR, file));
    }
  }
}

// =====================
// CORRECTIONS (like handwriting corrections)
// =====================

/**
 * Save a pattern correction (original → corrected)
 */
export async function saveCorrection(correction: Omit<PatternCorrection, 'id' | 'timestamp'>): Promise<string> {
  await ensureDirectories();
  
  const id = uuidv4();
  const filepath = path.join(CORRECTIONS_DIR, `${id}.json`);
  
  const data: PatternCorrection = {
    ...correction,
    id,
    timestamp: new Date().toISOString()
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Get all corrections
 */
export async function getAllCorrections(): Promise<PatternCorrection[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(CORRECTIONS_DIR);
  const corrections: PatternCorrection[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(CORRECTIONS_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      corrections.push(parseJsonWithBomSupport<PatternCorrection>(content));
    }
  }
  
  // Sort by timestamp descending
  return corrections.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Delete a correction
 */
export async function deleteCorrection(id: string): Promise<boolean> {
  const filepath = path.join(CORRECTIONS_DIR, `${id}.json`);
  
  try {
    await fs.unlink(filepath);
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Clear all corrections (nuclear option)
 */
export async function clearCorrections(): Promise<void> {
  await ensureDirectories();
  const files = await fs.readdir(CORRECTIONS_DIR);
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      await fs.unlink(path.join(CORRECTIONS_DIR, file));
    }
  }
}

// =====================
// SAVED CHARTS (moved from localStorage)
// =====================

/**
 * Save a chart
 */
export async function saveChart(chart: any): Promise<string> {
  await ensureDirectories();
  
  const id = chart.id || Date.now().toString();
  const filepath = path.join(SAVED_CHARTS_DIR, `${id}.json`);
  
  const data = {
    ...chart,
    id,
    savedAt: chart.savedAt || new Date().toISOString()
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Get all saved charts
 */
export async function getAllSavedCharts(): Promise<any[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(SAVED_CHARTS_DIR);
  const charts: any[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(SAVED_CHARTS_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      charts.push(JSON.parse(content));
    }
  }
  
  // Sort by savedAt descending (newest first)
  return charts.sort((a, b) => {
    const tA = a.savedAt || a.timestamp || '';
    const tB = b.savedAt || b.timestamp || '';
    return tB.localeCompare(tA);
  });
}

/**
 * Get a saved chart by ID
 */
export async function getSavedChart(id: string): Promise<any | null> {
  const filepath = path.join(SAVED_CHARTS_DIR, `${id}.json`);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content);
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Delete a saved chart
 */
export async function deleteSavedChart(id: string): Promise<boolean> {
  const filepath = path.join(SAVED_CHARTS_DIR, `${id}.json`);
  
  try {
    await fs.unlink(filepath);
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Clear all saved charts
 */
export async function clearSavedCharts(): Promise<void> {
  await ensureDirectories();
  const files = await fs.readdir(SAVED_CHARTS_DIR);
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      await fs.unlink(path.join(SAVED_CHARTS_DIR, file));
    }
  }
}

// =====================
// TRADE HISTORY (moved from localStorage)
// =====================

/**
 * Save a trade
 */
export async function saveTrade(trade: any): Promise<string> {
  await ensureDirectories();
  
  const id = trade.id?.toString() || Date.now().toString();
  const filepath = path.join(TRADE_HISTORY_DIR, `${id}.json`);
  
  const data = {
    ...trade,
    id,
    savedAt: trade.savedAt || new Date().toISOString()
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Get all trades
 */
export async function getAllTrades(): Promise<any[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(TRADE_HISTORY_DIR);
  const trades: any[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(TRADE_HISTORY_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      trades.push(JSON.parse(content));
    }
  }
  
  // Sort by createdAt descending (newest first)
  return trades.sort((a, b) => {
    const tA = a.createdAt || a.savedAt || '';
    const tB = b.createdAt || b.savedAt || '';
    return tB.localeCompare(tA);
  });
}

/**
 * Get a trade by ID
 */
export async function getTrade(id: string): Promise<any | null> {
  const filepath = path.join(TRADE_HISTORY_DIR, `${id}.json`);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content);
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Update a trade (for logging execution, exit, journal)
 */
export async function updateTrade(id: string, updates: any): Promise<any | null> {
  const trade = await getTrade(id);
  if (!trade) return null;
  
  const updated = { ...trade, ...updates, updatedAt: new Date().toISOString() };
  const filepath = path.join(TRADE_HISTORY_DIR, `${id}.json`);
  await fs.writeFile(filepath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Delete a trade
 */
export async function deleteTrade(id: string): Promise<boolean> {
  const filepath = path.join(TRADE_HISTORY_DIR, `${id}.json`);
  
  try {
    await fs.unlink(filepath);
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Clear all trades
 */
export async function clearTrades(): Promise<void> {
  await ensureDirectories();
  const files = await fs.readdir(TRADE_HISTORY_DIR);
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      await fs.unlink(path.join(TRADE_HISTORY_DIR, file));
    }
  }
}

// ====== Discount Candidates ======

/**
 * Save a discount zone candidate
 */
export async function saveDiscountCandidate(candidate: any): Promise<void> {
  await ensureDirectories();
  const id = `${candidate.symbol}_${candidate.timeframe}`;
  const filepath = path.join(DISCOUNT_CANDIDATES_DIR, `${id}.json`);
  await fs.writeFile(filepath, JSON.stringify(candidate, null, 2));
}

/**
 * Get all discount zone candidates
 */
export async function getAllDiscountCandidates(): Promise<any[]> {
  await ensureDirectories();
  const files = await fs.readdir(DISCOUNT_CANDIDATES_DIR);
  const candidates: any[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(DISCOUNT_CANDIDATES_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      candidates.push(JSON.parse(content));
    }
  }
  
  // Sort by rank_score descending
  candidates.sort((a, b) => (b.rank_score || 0) - (a.rank_score || 0));
  return candidates;
}

/**
 * Update a discount candidate's label
 */
export async function updateDiscountLabel(
  symbol: string,
  timeframe: string,
  label: string
): Promise<boolean> {
  await ensureDirectories();
  const id = `${symbol}_${timeframe}`;
  const filepath = path.join(DISCOUNT_CANDIDATES_DIR, `${id}.json`);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const candidate = JSON.parse(content);
    candidate.user_label = label;
    candidate.label_date = new Date().toISOString();
    await fs.writeFile(filepath, JSON.stringify(candidate, null, 2));
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Clear all discount candidates
 */
export async function clearDiscountCandidates(): Promise<void> {
  await ensureDirectories();
  const files = await fs.readdir(DISCOUNT_CANDIDATES_DIR);
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      await fs.unlink(path.join(DISCOUNT_CANDIDATES_DIR, file));
    }
  }
}

// =====================
// STRATEGIES (StrategySpec)
// =====================

/**
 * Save a strategy spec.
 * 
 * IMMUTABILITY RULE: Once a strategy version is saved, its config fields
 * cannot be changed. Only metadata (status, notes) can be updated via
 * dedicated functions like updateStrategyStatus().
 * 
 * To change trading logic, create a new version (auto-incremented).
 * 
 * @param strategy  The spec to save
 * @param force     If true, allow overwrite (only for initial seeding). Default false.
 */
export async function saveStrategy(strategy: StrategySpec, force: boolean = false): Promise<string> {
  await ensureDirectories();

  const normalizedStrategy = applyParameterManifest(strategy);
  
  const id = normalizedStrategy.strategy_version_id;
  const filepath = path.join(STRATEGIES_DIR, `${id}.json`);
  
  // Enforce immutability: don't overwrite existing specs unless forced
  if (!force) {
    try {
      await fs.access(filepath);
      // File exists — check if this is a metadata-only update
      const existingContent = await fs.readFile(filepath, 'utf-8');
      const existing = JSON.parse(existingContent) as StrategySpec;
      const existingHash = existing.spec_hash || computeSpecHash(existing);
      const newHash = computeSpecHash(normalizedStrategy);
      if (existingHash !== newHash) {
        throw new Error(
          `Immutability violation: Cannot overwrite strategy ${id} with different config. ` +
          `Existing hash: ${existingHash.slice(0, 12)}, New hash: ${newHash.slice(0, 12)}. ` +
          `Create a new version instead.`
        );
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT' && !err.message?.includes('Immutability violation')) {
        throw err;
      }
      if (err.message?.includes('Immutability violation')) {
        throw err;
      }
      // ENOENT = file doesn't exist, proceed with save
    }
  }

  // Compute and attach spec_hash
  const specHash = computeSpecHash(normalizedStrategy);
  
  const data: StrategySpec = {
    ...normalizedStrategy,
    spec_hash: specHash,
    updated_at: new Date().toISOString()
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return id;
}

/**
 * Get all strategies
 */
export async function getAllStrategies(): Promise<StrategySpec[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(STRATEGIES_DIR);
  const strategies: StrategySpec[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(STRATEGIES_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<StrategySpec>;
      // Ignore non-strategy JSON files (e.g. execution rule templates).
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.strategy_id !== 'string' ||
        typeof parsed.strategy_version_id !== 'string' ||
        typeof parsed.name !== 'string'
      ) {
        continue;
      }
      strategies.push(applyParameterManifest(parsed as StrategySpec));
    }
  }
  
  return strategies.sort((a, b) => 
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

/**
 * Get a strategy by version ID
 */
export async function getStrategy(strategyVersionId: string): Promise<StrategySpec | null> {
  const filepath = path.join(STRATEGIES_DIR, `${strategyVersionId}.json`);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return applyParameterManifest(JSON.parse(content) as StrategySpec);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // Backward compatibility: some legacy files were named by strategy_id
      // while carrying strategy_version_id inside the JSON payload.
      const files = await fs.readdir(STRATEGIES_DIR);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(STRATEGIES_DIR, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(content) as Partial<StrategySpec>;
          if (
            parsed &&
            typeof parsed.strategy_version_id === 'string' &&
            parsed.strategy_version_id.trim() === strategyVersionId
          ) {
            return applyParameterManifest(parsed as StrategySpec);
          }
        } catch {
          // Ignore malformed strategy files and continue scanning.
        }
      }
      return null;
    }
    throw err;
  }
}

/**
 * Delete a saved strategy by version ID.
 * Returns true when a saved strategy file was removed.
 */
export async function deleteStrategy(strategyVersionId: string): Promise<boolean> {
  const filepath = path.join(STRATEGIES_DIR, `${strategyVersionId}.json`);

  try {
    await fs.unlink(filepath);
    return true;
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  const files = await fs.readdir(STRATEGIES_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(STRATEGIES_DIR, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<StrategySpec>;
      if (
        parsed &&
        typeof parsed.strategy_version_id === 'string' &&
        parsed.strategy_version_id.trim() === strategyVersionId
      ) {
        await fs.unlink(filePath);
        return true;
      }
    } catch {
      // Ignore malformed strategy files and continue scanning.
    }
  }

  return false;
}

/**
 * Resolve a composite-derived strategy from the pattern registry.
 * Returns a StrategySpec built from the composite definition JSON,
 * or null if no matching composite is found.
 */
export async function resolveCompositeStrategy(strategyVersionId: string): Promise<StrategySpec | null> {
  try {
    const registryPath = path.join(DATA_DIR, 'patterns', 'registry.json');
    const registry = JSON.parse(await fs.readFile(registryPath, 'utf-8'));
    const patternsDir = path.join(DATA_DIR, 'patterns');
    const entry = (registry.patterns || []).find((p: any) =>
      `${p.pattern_id}_v1` === strategyVersionId || p.pattern_id === strategyVersionId
    );
    if (!entry) return null;
    const def = JSON.parse(await fs.readFile(path.join(patternsDir, entry.definition_file), 'utf-8'));
    return {
      strategy_id: entry.pattern_id,
      strategy_version_id: `${entry.pattern_id}_v1`,
      version: 1,
      name: entry.name || def.name,
      description: def.description || '',
      status: (entry.status || 'experimental') as any,
      asset_class: 'stocks' as any,
      interval: (def.suggested_timeframes?.[0] === 'W' ? '1wk' : def.suggested_timeframes?.[0] === 'D' ? '1d' : '1wk') as any,
      universe: [],
      structure_config: def.default_structure_config || {},
      setup_config: { pattern_type: def.pattern_type || entry.pattern_id, ...def.default_setup_params },
      entry_config: def.default_entry || {},
      risk_config: (def.default_risk_config || { stop_type: 'structural' }) as any,
      exit_config: {},
      cost_config: { commission_per_trade: 0, slippage_pct: 0.001 },
      execution_config: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as StrategySpec;
  } catch {
    return null;
  }
}

/**
 * Get a strategy by version ID, falling back to composite resolution.
 */
export async function getStrategyOrComposite(strategyVersionId: string): Promise<StrategySpec | null> {
  const strategy = await getStrategy(strategyVersionId);
  if (strategy) return strategy;
  return resolveCompositeStrategy(strategyVersionId);
}

/**
 * Update a strategy's status (metadata-only — does not change config, so
 * the spec_hash remains the same and immutability is preserved).
 */
export async function updateStrategyStatus(
  strategyVersionId: string,
  status: StrategySpec['status']
): Promise<StrategySpec | null> {
  const strategy = await getStrategy(strategyVersionId);
  if (!strategy) return null;
  
  strategy.status = status;
  strategy.updated_at = new Date().toISOString();
  // force=true because we're updating metadata on an existing spec (hash unchanged)
  await saveStrategy(strategy, true);
  return strategy;
}

// =====================
// VALIDATION REPORTS
// =====================

/**
 * Save a validation report
 */
export async function saveValidationReport(report: ValidationReport): Promise<string> {
  await ensureDirectories();
  
  const id = report.report_id;
  const filepath = path.join(VALIDATION_REPORTS_DIR, `${id}.json`);
  
  await fs.writeFile(filepath, JSON.stringify(report, null, 2));
  return id;
}

/**
 * Get all validation reports, optionally filtered by strategy
 */
export async function getAllValidationReports(strategyVersionId?: string): Promise<ValidationReport[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(VALIDATION_REPORTS_DIR);
  const reports: ValidationReport[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filepath = path.join(VALIDATION_REPORTS_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const report = JSON.parse(content) as ValidationReport;
      
      if (!strategyVersionId || report.strategy_version_id === strategyVersionId) {
        reports.push(report);
      }
    }
  }
  
  return reports.sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * Get a validation report by ID
 */
export async function getValidationReport(reportId: string): Promise<ValidationReport | null> {
  const filepath = path.join(VALIDATION_REPORTS_DIR, `${reportId}.json`);
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content) as ValidationReport;
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Update a validation report's decision log
 */
export async function updateReportDecision(
  reportId: string,
  decision: 'approved' | 'rejected',
  decidedBy: string,
  notes: string
): Promise<ValidationReport | null> {
  const report = await getValidationReport(reportId);
  if (!report) return null;
  
  report.decision_log = {
    decision,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
    notes
  };
  
  await saveValidationReport(report);
  return report;
}

// =====================
// TRADE INSTANCES (backtest trades)
// =====================

/**
 * Save trade instances for a report (bulk)
 */
export async function saveTradeInstances(reportId: string, trades: TradeInstance[]): Promise<void> {
  await ensureDirectories();
  
  // Store grouped by report ID
  const reportDir = path.join(TRADE_INSTANCES_DIR, reportId);
  await fs.mkdir(reportDir, { recursive: true });

  // Idempotency: clear existing files for this report before writing.
  const existingFiles = await fs.readdir(reportDir);
  for (const file of existingFiles) {
    if (file.endsWith('.json')) {
      await fs.unlink(path.join(reportDir, file));
    }
  }
  
  for (const trade of trades) {
    const filepath = path.join(reportDir, `${trade.trade_id}.json`);
    await fs.writeFile(filepath, JSON.stringify(trade, null, 2));
  }
}

/**
 * Get all trade instances for a report
 */
export async function getTradeInstances(reportId: string): Promise<TradeInstance[]> {
  const reportDir = path.join(TRADE_INSTANCES_DIR, reportId);
  
  try {
    const files = await fs.readdir(reportDir);
    const trades: TradeInstance[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filepath = path.join(reportDir, file);
        const content = await fs.readFile(filepath, 'utf-8');
        trades.push(JSON.parse(content) as TradeInstance);
      }
    }
    
    return trades.sort((a, b) => 
      new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
    );
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Delete a single validation report and its associated trade instances.
 */
export async function deleteValidationReport(reportId: string): Promise<void> {
  const reportFile = path.join(VALIDATION_REPORTS_DIR, `${reportId}.json`);
  try { await fs.unlink(reportFile); } catch {}
  await deleteTradeInstances(reportId);
}

/**
 * Delete all trade instances for a report.
 */
export async function deleteTradeInstances(reportId: string): Promise<void> {
  const reportDir = path.join(TRADE_INSTANCES_DIR, reportId);
  try {
    await fs.rm(reportDir, { recursive: true, force: true });
  } catch {}
}

/**
 * Delete all validation reports for one strategy and their associated trade instances.
 * Returns the number of deleted reports.
 */
export async function deleteValidationReportsByStrategy(strategyVersionId: string): Promise<number> {
  await ensureDirectories();
  const reports = await getAllValidationReports(strategyVersionId);
  for (const report of reports) {
    const reportFile = path.join(VALIDATION_REPORTS_DIR, `${report.report_id}.json`);
    try {
      await fs.unlink(reportFile);
    } catch {}
    await deleteTradeInstances(report.report_id);
  }
  return reports.length;
}

// =====================
// STRATEGY HELPERS (Scanner integration)
// =====================

/**
 * Find the latest approved version of a strategy by strategy_id.
 * Searches all strategy files whose strategy_id matches, status is 'approved',
 * and returns the one with the highest version.
 */
export async function getLatestApprovedStrategy(strategyId: string): Promise<StrategySpec | null> {
  const all = await getAllStrategies();
  const matches = all.filter(s => s.strategy_id === strategyId && s.status === 'approved');
  if (matches.length === 0) return null;
  // Sort by version descending (handle both number and string)
  matches.sort((a, b) => Number(b.version) - Number(a.version));
  return matches[0];
}

/**
 * Save a StrategyCandidate to the regular candidates directory.
 * The candidate is stored with its candidate_id as filename.
 * The candidate_id includes spec_hash to prevent ID collision from config changes.
 */
export async function saveStrategyCandidate(candidate: StrategyCandidate): Promise<string> {
  const ids = await saveStrategyCandidates([candidate]);
  return ids[0];
}

/**
 * Save multiple strategy candidates.
 */
export async function saveStrategyCandidates(candidates: StrategyCandidate[]): Promise<string[]> {
  await ensureDirectories();

  const files = await fs.readdir(CANDIDATES_DIR);
  const existingByDedupeKey = new Map<string, { id: string; candidate: any }>();

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filepath = path.join(CANDIDATES_DIR, file);
    try {
      const parsed = JSON.parse(await fs.readFile(filepath, 'utf-8'));
      const existingId = String(parsed?.id || parsed?.candidate_id || path.basename(file, '.json'));
      const key = strategyCandidateDedupeKey(parsed);
      const existing = existingByDedupeKey.get(key);
      if (!existing || shouldReplaceCandidate(existing.candidate, parsed)) {
        existingByDedupeKey.set(key, { id: existingId, candidate: parsed });
      }
    } catch {
      // Ignore malformed files.
    }
  }

  const ids: string[] = [];
  for (const candidate of candidates) {
    const dedupeKey = strategyCandidateDedupeKey(candidate as any);
    const existing = existingByDedupeKey.get(dedupeKey);
    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const rawId = candidate.candidate_id || candidate.id || uuidv4();
    // Sanitize: replace Windows-illegal filename chars (: \ / * ? " < > |) with dashes
    const id = String(rawId).replace(/[:\\/*?"<>|]/g, '-');
    const filepath = path.join(CANDIDATES_DIR, `${id}.json`);

    const data = {
      ...candidate,
      id: id,
      candidate_id: id,
      // spec_hash should already be set by the runner; preserve it
      spec_hash: candidate.spec_hash || undefined,
      createdAt: candidate.created_at || new Date().toISOString(),
    };

    await fs.writeFile(filepath, JSON.stringify(data, null, 2));

    existingByDedupeKey.set(dedupeKey, { id, candidate: data });
    ids.push(id);
  }
  return ids;
}
