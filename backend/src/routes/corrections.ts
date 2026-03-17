/**
 * Corrections API Routes
 * 
 * Like handwriting corrections: store original detection + user's corrected version
 */

import { Router, Request, Response } from 'express';
import * as storage from '../services/storageService';
import { PatternCorrection, ApiResponse } from '../types';

const router = Router();

/**
 * GET /api/corrections
 * List all corrections
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const corrections = await storage.getAllCorrections();
    
    res.json({
      success: true,
      data: corrections
    } as ApiResponse<PatternCorrection[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/corrections
 * Save a correction (original → corrected positions) OR drawing annotations
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      candidateId,
      userId = 'default',
      symbol,
      timeframe,
      patternType,
      original,
      corrected,
      // New drawing annotation fields
      drawings,
      canvasSize,
      chartTimeRange,
      chartPriceRange
    } = req.body;
    
    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: candidateId'
      } as ApiResponse<null>);
    }
    
    // Handle drawing annotations (new format)
    if (patternType === 'wyckoff_drawing' && drawings) {
      const id = await storage.saveCorrection({
        candidateId,
        userId,
        symbol,
        timeframe,
        patternType,
        drawings,
        canvasSize,
        chartTimeRange,
        chartPriceRange,
        original: null,
        corrected: null
      });
      
      return res.json({
        success: true,
        data: { id }
      } as ApiResponse<{ id: string }>);
    }
    
    // Handle traditional corrections (original → corrected positions)
    if (!original || !corrected) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: original, corrected (or use drawings for annotation mode)'
      } as ApiResponse<null>);
    }
    
    const id = await storage.saveCorrection({
      candidateId,
      userId,
      symbol,
      timeframe,
      original,
      corrected
    });
    
    res.json({
      success: true,
      data: { id }
    } as ApiResponse<{ id: string }>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * DELETE /api/corrections/all
 * Delete ALL corrections (nuclear option) - MUST be before /:id
 */
router.delete('/all', async (req: Request, res: Response) => {
  try {
    await storage.clearCorrections();
    
    res.json({
      success: true,
      data: { message: 'All corrections cleared' }
    } as ApiResponse<{ message: string }>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * DELETE /api/corrections/:id
 * Delete a correction
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const deleted = await storage.deleteCorrection(id);
    
    if (deleted) {
      res.json({
        success: true,
        data: { deleted: true }
      } as ApiResponse<{ deleted: boolean }>);
    } else {
      res.status(404).json({
        success: false,
        error: 'Correction not found'
      } as ApiResponse<null>);
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

export default router;
