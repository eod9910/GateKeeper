/**
 * Labels API Routes
 */

import { Router, Request, Response } from 'express';
import * as storage from '../services/storageService';
import { PatternLabel, LabelType, LabelingStats, ApiResponse } from '../types';

const router = Router();

/**
 * GET /api/labels
 * List all labels
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const labels = await storage.getAllLabels(userId);
    
    res.json({
      success: true,
      data: labels
    } as ApiResponse<PatternLabel[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/labels/stats
 * Get labeling statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const stats = await storage.getStats(userId);
    
    res.json({
      success: true,
      data: stats
    } as ApiResponse<LabelingStats>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * GET /api/labels/candidate/:candidateId
 * Get labels for a specific candidate
 */
router.get('/candidate/:candidateId', async (req: Request, res: Response) => {
  try {
    const labels = await storage.getLabelsForCandidate(req.params.candidateId);
    
    res.json({
      success: true,
      data: labels
    } as ApiResponse<PatternLabel[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/labels
 * Save a new label
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { candidateId, userId, label, notes } = req.body;
    
    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'candidateId is required'
      } as ApiResponse<null>);
    }
    
    if (!label || !['yes', 'no', 'close'].includes(label)) {
      return res.status(400).json({
        success: false,
        error: 'label must be "yes", "no", or "close"'
      } as ApiResponse<null>);
    }
    
    // Verify candidate exists (fallback to sanitized ID for legacy scanner payloads).
    let resolvedCandidateId = String(candidateId).trim();
    let candidate = await storage.getCandidate(resolvedCandidateId);
    if (!candidate) {
      const sanitizedCandidateId = resolvedCandidateId.replace(/[:\\/*?"<>|]/g, '-');
      if (sanitizedCandidateId && sanitizedCandidateId !== resolvedCandidateId) {
        const sanitizedCandidate = await storage.getCandidate(sanitizedCandidateId);
        if (sanitizedCandidate) {
          resolvedCandidateId = sanitizedCandidateId;
          candidate = sanitizedCandidate;
        }
      }
    }
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found'
      } as ApiResponse<null>);
    }
    
    const id = await storage.saveLabel(
      resolvedCandidateId,
      userId || 'default',
      label as LabelType,
      notes || '',
      candidate.symbol,
      candidate.timeframe
    );
    
    res.json({
      success: true,
      data: { id, candidateId: resolvedCandidateId, label }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * DELETE /api/labels/all
 * Delete ALL labels (nuclear option) - MUST be before /:id
 */
router.delete('/all', async (req: Request, res: Response) => {
  try {
    await storage.clearLabels();
    
    res.json({
      success: true,
      data: { message: 'All labels cleared' }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * DELETE /api/labels/:id
 * Delete a label
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await storage.deleteLabel(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Label not found'
      } as ApiResponse<null>);
    }
    
    res.json({
      success: true,
      data: { deleted: true }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

export default router;
