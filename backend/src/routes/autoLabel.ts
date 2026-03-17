import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import { ApiResponse } from '../types';
import {
  startAutoLabelJob,
  getAutoLabelJob,
  listAutoLabelJobs,
  cancelAutoLabelJob,
  StartAutoLabelOptions,
} from '../services/autoLabelService';

const router = Router();

function parseCandidateIds(value: any): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((v) => String(v || '').trim())
    .filter((v) => !!v);
}

/**
 * POST /api/auto-label/start
 * Start an asynchronous auto-labeling job.
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const options: StartAutoLabelOptions = {
      patternId: typeof body.patternId === 'string' ? body.patternId.trim() : undefined,
      timeframe: typeof body.timeframe === 'string' ? body.timeframe.trim() : undefined,
      candidateIds: parseCandidateIds(body.candidateIds),
      maxItems: Number.isFinite(Number(body.maxItems)) ? Number(body.maxItems) : undefined,
      dryRun: typeof body.dryRun === 'boolean' ? body.dryRun : undefined,
      labelThreshold: Number.isFinite(Number(body.labelThreshold)) ? Number(body.labelThreshold) : undefined,
      correctionThreshold: Number.isFinite(Number(body.correctionThreshold)) ? Number(body.correctionThreshold) : undefined,
      saveCorrections: typeof body.saveCorrections === 'boolean' ? body.saveCorrections : undefined,
      unreviewedOnly: typeof body.unreviewedOnly === 'boolean' ? body.unreviewedOnly : undefined,
      userId: typeof body.userId === 'string' ? body.userId.trim() : undefined,
    };

    const job = startAutoLabelJob(options);
    return res.json({
      success: true,
      data: job,
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/auto-label/jobs
 */
router.get('/jobs', async (_req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: listAutoLabelJobs(),
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/auto-label/job/:jobId
 */
router.get('/job/:jobId', async (req: Request, res: Response) => {
  try {
    const job = getAutoLabelJob(String(req.params.jobId || '').trim());
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      } as ApiResponse<null>);
    }
    return res.json({
      success: true,
      data: job,
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/auto-label/job/:jobId/decisions
 * Returns the per-candidate decisions from a completed run artifact.
 */
router.get('/job/:jobId/decisions', async (req: Request, res: Response) => {
  try {
    const job = getAutoLabelJob(String(req.params.jobId || '').trim());
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' } as ApiResponse<null>);
    }
    if (!job.runArtifactPath) {
      return res.status(404).json({ success: false, error: 'No run artifact yet (job may still be running)' } as ApiResponse<null>);
    }
    const raw = await fs.readFile(job.runArtifactPath, 'utf-8');
    const artifact = JSON.parse(raw);
    const decisions = Array.isArray(artifact?.decisions) ? artifact.decisions : [];

    const filter = String(req.query.filter || '').toLowerCase();
    let filtered = decisions;
    if (filter === 'review') {
      filtered = decisions.filter((d: any) => d.reviewRequired);
    } else if (filter === 'auto') {
      filtered = decisions.filter((d: any) => d.autoLabeled || d.autoCorrected);
    } else if (filter === 'yes') {
      filtered = decisions.filter((d: any) => d.label === 'yes');
    } else if (filter === 'no') {
      filtered = decisions.filter((d: any) => d.label === 'no');
    }

    return res.json({
      success: true,
      data: {
        jobId: job.jobId,
        total: decisions.length,
        filtered: filtered.length,
        decisions: filtered,
      },
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message } as ApiResponse<null>);
  }
});

/**
 * POST /api/auto-label/job/:jobId/cancel
 */
router.post('/job/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const job = cancelAutoLabelJob(String(req.params.jobId || '').trim());
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      } as ApiResponse<null>);
    }
    return res.json({
      success: true,
      data: job,
    } as ApiResponse<any>);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse<null>);
  }
});

export default router;

