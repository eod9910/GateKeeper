import * as fs from 'fs/promises';
import * as path from 'path';
import * as storage from './storageService';
import { PatternCandidate } from '../types';
import { predictAutoLabel } from './autoLabelModelAdapter';

export type AutoLabelJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface StartAutoLabelOptions {
  patternId?: string;
  timeframe?: string;
  candidateIds?: string[];
  maxItems?: number;
  dryRun?: boolean;
  labelThreshold?: number;
  correctionThreshold?: number;
  saveCorrections?: boolean;
  unreviewedOnly?: boolean;
  userId?: string;
}

export interface AutoLabelCounters {
  total: number;
  processed: number;
  autoLabeled: number;
  autoCorrected: number;
  reviewRequired: number;
  skippedReviewed: number;
  errors: number;
}

export interface AutoLabelDecision {
  candidateId: string;
  symbol: string;
  timeframe: string;
  label: 'yes' | 'no' | 'close';
  labelConfidence: number;
  needsCorrection: boolean;
  baseTop?: number;
  baseBottom?: number;
  correctionConfidence: number;
  reviewRequired: boolean;
  autoLabeled: boolean;
  autoCorrected: boolean;
  reason: string;
  modelVersion: string;
}

export interface AutoLabelJob {
  jobId: string;
  status: AutoLabelJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: number;
  stage: string;
  detail?: string;
  request: Required<Pick<StartAutoLabelOptions,
    'dryRun' | 'labelThreshold' | 'correctionThreshold' | 'saveCorrections' | 'unreviewedOnly' | 'userId'>> &
    Pick<StartAutoLabelOptions, 'patternId' | 'timeframe' | 'maxItems'> & {
      candidateCountRequest: number;
    };
  counters: AutoLabelCounters;
  runArtifactPath?: string;
  error?: string;
}

const MAX_JOBS = 100;
const jobs = new Map<string, AutoLabelJob>();
const cancelRequested = new Set<string>();

function createJobId(): string {
  return `autolabel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function pruneJobs(): void {
  if (jobs.size <= MAX_JOBS) return;
  const completed = Array.from(jobs.values())
    .filter((j) => j.status === 'completed' || j.status === 'cancelled' || j.status === 'failed')
    .sort((a, b) => String(a.completedAt || a.createdAt).localeCompare(String(b.completedAt || b.createdAt)));

  while (jobs.size > MAX_JOBS && completed.length) {
    const oldest = completed.shift();
    if (oldest) jobs.delete(oldest.jobId);
  }
}

function candidateIdOf(candidate: any): string {
  return String(candidate?.id || candidate?.candidate_id || '');
}

function toNum(value: any): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function filterCandidates(allCandidates: PatternCandidate[], opts: StartAutoLabelOptions): PatternCandidate[] {
  const patternId = String(opts.patternId || '').trim().toLowerCase();
  const timeframe = String(opts.timeframe || '').trim().toUpperCase();
  const requestedIds = new Set((opts.candidateIds || []).map((id) => String(id || '')).filter((id) => !!id));
  const maxItems = Math.max(1, Number(opts.maxItems || 200));

  const filtered = allCandidates.filter((candidate: any) => {
    const cid = candidateIdOf(candidate);
    if (!cid) return false;
    if (requestedIds.size && !requestedIds.has(cid)) return false;
    if (timeframe && String(candidate?.timeframe || '').toUpperCase() !== timeframe) return false;

    if (patternId) {
      const pType = String(candidate?.pattern_type || '').toLowerCase();
      const pId = String(candidate?.pattern_id || '').toLowerCase();
      const detector = String(candidate?.detector || '').toLowerCase();
      const text = `${pType} ${pId} ${detector}`;
      if (!text.includes(patternId)) return false;
    }
    return true;
  });

  return filtered.slice(0, maxItems);
}

async function saveRunArtifact(job: AutoLabelJob, decisions: AutoLabelDecision[]): Promise<string> {
  const runDir = path.join(__dirname, '..', '..', 'data', 'research', 'auto-label-runs');
  await fs.mkdir(runDir, { recursive: true });
  const outPath = path.join(runDir, `${job.jobId}.json`);
  const payload = {
    job,
    decisions,
    generatedAt: nowIso(),
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  return outPath;
}

async function executeAutoLabelJob(jobId: string, opts: StartAutoLabelOptions): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = 'running';
  job.startedAt = nowIso();
  job.stage = 'loading_candidates';
  job.detail = 'Loading candidates and existing labels/corrections...';
  job.progress = 0;

  const decisions: AutoLabelDecision[] = [];

  try {
    const allCandidates = await storage.getAllCandidates();
    const candidates = filterCandidates(allCandidates, opts);
    job.counters.total = candidates.length;
    job.request.candidateCountRequest = (opts.candidateIds || []).length;

    const existingLabels = await storage.getAllLabels();
    const existingCorrections = await storage.getAllCorrections();
    const labeledIds = new Set(existingLabels.map((l) => String(l?.candidateId || '')).filter((id) => !!id));
    const correctedIds = new Set(existingCorrections.map((c) => String(c?.candidateId || '')).filter((id) => !!id));

    if (!candidates.length) {
      job.status = 'completed';
      job.progress = 1;
      job.stage = 'completed';
      job.detail = 'No candidates matched filters.';
      job.completedAt = nowIso();
      job.runArtifactPath = await saveRunArtifact(job, decisions);
      return;
    }

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate: any = candidates[i];
      const candidateId = candidateIdOf(candidate);
      const symbol = String(candidate?.symbol || '');
      const timeframe = String(candidate?.timeframe || '');

      if (cancelRequested.has(jobId)) {
        job.status = 'cancelled';
        job.stage = 'cancelled';
        job.detail = 'Cancel requested by user.';
        break;
      }

      job.stage = 'labeling';
      job.detail = `Processing ${i + 1}/${candidates.length}: ${symbol}`;

      const alreadyReviewed = labeledIds.has(candidateId) || correctedIds.has(candidateId);
      if (job.request.unreviewedOnly && alreadyReviewed) {
        job.counters.skippedReviewed += 1;
        job.counters.processed += 1;
        job.progress = job.counters.total ? (job.counters.processed / job.counters.total) : 1;
        continue;
      }

      try {
        const prediction = await predictAutoLabel(candidate);
        const hasAutoLabel = prediction.labelConfidence >= job.request.labelThreshold;
        const hasAutoCorrection = (
          job.request.saveCorrections
          && prediction.needsCorrection
          && prediction.correctionConfidence >= job.request.correctionThreshold
          && Number.isFinite(Number(prediction.baseTop))
          && Number.isFinite(Number(prediction.baseBottom))
        );

        const reviewRequired = (
          prediction.labelConfidence < job.request.labelThreshold
          || (job.request.saveCorrections && prediction.needsCorrection && prediction.correctionConfidence < job.request.correctionThreshold)
        );

        const decision: AutoLabelDecision = {
          candidateId,
          symbol,
          timeframe,
          label: prediction.label,
          labelConfidence: clamp01(prediction.labelConfidence),
          needsCorrection: !!prediction.needsCorrection,
          baseTop: toNum(prediction.baseTop),
          baseBottom: toNum(prediction.baseBottom),
          correctionConfidence: clamp01(prediction.correctionConfidence),
          reviewRequired,
          autoLabeled: false,
          autoCorrected: false,
          reason: prediction.reasoning || '',
          modelVersion: prediction.modelVersion,
        };

        if (!job.request.dryRun && hasAutoLabel && !labeledIds.has(candidateId)) {
          await storage.saveLabel(
            candidateId,
            job.request.userId,
            prediction.label,
            'Auto-labeled by AI',
            symbol || undefined,
            timeframe || undefined,
            {
              source: 'ai',
              confidence: prediction.labelConfidence,
              modelVersion: prediction.modelVersion,
              runId: jobId,
              reasoning: prediction.reasoning,
            },
          );
          labeledIds.add(candidateId);
          decision.autoLabeled = true;
          job.counters.autoLabeled += 1;
        }

        if (!job.request.dryRun && hasAutoCorrection && !correctedIds.has(candidateId)) {
          const top = Number(prediction.baseTop);
          const bottom = Number(prediction.baseBottom);
          const baseTop = top >= bottom ? top : bottom;
          const baseBottom = top >= bottom ? bottom : top;

          await storage.saveCorrection({
            candidateId,
            userId: job.request.userId,
            symbol,
            timeframe,
            patternType: String(candidate?.pattern_type || 'auto_label_base'),
            source: 'ai',
            confidence: prediction.correctionConfidence,
            modelVersion: prediction.modelVersion,
            runId: jobId,
            reasoning: prediction.reasoning,
            original: {
              detectedBaseTop: toNum(candidate?.base?.high),
              detectedBaseBottom: toNum(candidate?.base?.low),
            },
            corrected: {
              baseTopPrice: baseTop,
              baseBottomPrice: baseBottom,
              correctionMode: 'ai_auto_label',
              notes: 'Auto-corrected by AI labeler',
            },
          });
          correctedIds.add(candidateId);
          decision.autoCorrected = true;
          job.counters.autoCorrected += 1;
        }

        if (reviewRequired) {
          job.counters.reviewRequired += 1;
        }

        decisions.push(decision);
      } catch (error: any) {
        job.counters.errors += 1;
        decisions.push({
          candidateId,
          symbol,
          timeframe,
          label: 'close',
          labelConfidence: 0,
          needsCorrection: false,
          correctionConfidence: 0,
          reviewRequired: true,
          autoLabeled: false,
          autoCorrected: false,
          reason: `prediction error: ${String(error?.message || 'unknown')}`.slice(0, 220),
          modelVersion: 'error',
        });
      }

      job.counters.processed += 1;
      job.progress = job.counters.total ? (job.counters.processed / job.counters.total) : 1;
    }

    if (job.status !== 'cancelled') {
      job.status = 'completed';
      job.stage = 'completed';
      job.detail = `Processed ${job.counters.processed}/${job.counters.total}.`;
    }
    job.progress = 1;
    job.completedAt = nowIso();
    job.runArtifactPath = await saveRunArtifact(job, decisions);
  } catch (error: any) {
    job.status = 'failed';
    job.stage = 'failed';
    job.error = String(error?.message || 'Auto-label job failed');
    job.detail = job.error;
    job.completedAt = nowIso();
    job.progress = 1;
    try {
      job.runArtifactPath = await saveRunArtifact(job, decisions);
    } catch {}
  } finally {
    cancelRequested.delete(jobId);
  }
}

export function startAutoLabelJob(options: StartAutoLabelOptions): AutoLabelJob {
  const jobId = createJobId();
  const job: AutoLabelJob = {
    jobId,
    status: 'queued',
    createdAt: nowIso(),
    progress: 0,
    stage: 'queued',
    request: {
      patternId: options.patternId || undefined,
      timeframe: options.timeframe || undefined,
      maxItems: Number.isFinite(Number(options.maxItems)) ? Number(options.maxItems) : 200,
      candidateCountRequest: (options.candidateIds || []).length,
      dryRun: options.dryRun !== false,
      labelThreshold: clamp01(Number(options.labelThreshold ?? 0.9)),
      correctionThreshold: clamp01(Number(options.correctionThreshold ?? 0.92)),
      saveCorrections: options.saveCorrections !== false,
      unreviewedOnly: options.unreviewedOnly !== false,
      userId: String(options.userId || 'ai'),
    },
    counters: {
      total: 0,
      processed: 0,
      autoLabeled: 0,
      autoCorrected: 0,
      reviewRequired: 0,
      skippedReviewed: 0,
      errors: 0,
    },
  };

  jobs.set(jobId, job);
  pruneJobs();

  // Fire and forget.
  void executeAutoLabelJob(jobId, {
    ...options,
    dryRun: job.request.dryRun,
    labelThreshold: job.request.labelThreshold,
    correctionThreshold: job.request.correctionThreshold,
    saveCorrections: job.request.saveCorrections,
    unreviewedOnly: job.request.unreviewedOnly,
    userId: job.request.userId,
    maxItems: job.request.maxItems,
  });

  return job;
}

export function getAutoLabelJob(jobId: string): AutoLabelJob | null {
  return jobs.get(jobId) || null;
}

export function listAutoLabelJobs(): AutoLabelJob[] {
  return Array.from(jobs.values())
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function cancelAutoLabelJob(jobId: string): AutoLabelJob | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return job;
  }
  cancelRequested.add(jobId);
  job.detail = 'Cancel requested...';
  return job;
}

