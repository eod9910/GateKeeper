/**
 * Vision AI Routes
 * 
 * Endpoints for AI-powered chart analysis using MiniCPM-V via Ollama
 */

import { Router, Request, Response } from 'express';
import { analyzeChartPattern, checkOllamaStatus, VisionAnalysis, chatWithCopilot } from '../services/visionService';
import { ApiResponse } from '../types';

const router = Router();

/**
 * GET /api/vision/status
 * Check if Ollama and the vision model are available
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = await checkOllamaStatus();
    
    res.json({
      success: true,
      data: status
    } as ApiResponse<typeof status>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/vision/analyze
 * Analyze a chart image for pattern validity
  */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { imageBase64, patternInfo, analysisMode } = req.body;
    const normalizedImage = typeof imageBase64 === 'string' ? imageBase64.trim() : '';
    
    if (!normalizedImage) {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 is required'
      } as ApiResponse<null>);
    }

    const analysis = await analyzeChartPattern(normalizedImage, patternInfo, analysisMode);
    
    res.json({
      success: true,
      data: analysis
    } as ApiResponse<VisionAnalysis>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/vision/chat
 * Chat with the trading desk AI
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, context, chartImage, role, aiModel, pluginEngineerModel } = req.body;
    console.log('[VisionRoute] /api/vision/chat', JSON.stringify({
      role: role || 'copilot',
      hasChartImage: !!chartImage,
      chartImageLength: typeof chartImage === 'string' ? chartImage.length : 0,
      aiModel: aiModel || null,
      pluginEngineerModel: pluginEngineerModel || null,
      symbol: context?.symbol || context?.copilotAnalysis?.candidate?.symbol || null,
      messageLength: typeof message === 'string' ? message.length : 0,
    }));
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required'
      } as ApiResponse<null>);
    }
    
    const response = await chatWithCopilot(message, context, chartImage, role, aiModel, pluginEngineerModel);
    
    res.json({
      success: true,
      data: { response }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as ApiResponse<null>);
  }
});

export default router;
