/**
 * Saved Charts Routes
 * 
 * Server-side storage for saved charts (replaces localStorage).
 * Stores chart data, drawings, pattern markers on the filesystem.
 */

import { Router, Request, Response } from 'express';
import * as storage from '../services/storageService';

const router = Router();

/**
 * GET /api/saved-charts - Get all saved charts
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const charts = await storage.getAllSavedCharts();
    
    // Option to get metadata only (no chart_data) for sidebar listings
    if (req.query.metadata === 'true') {
      const metadata = charts.map(c => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        pattern_type: c.pattern_type,
        timeframe: c.timeframe,
        timestamp: c.timestamp,
        savedAt: c.savedAt
      }));
      return res.json({ success: true, data: metadata });
    }
    
    res.json({ success: true, data: charts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/saved-charts/:id - Get a specific saved chart
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const chart = await storage.getSavedChart(req.params.id);
    if (!chart) {
      return res.status(404).json({ success: false, error: 'Chart not found' });
    }
    res.json({ success: true, data: chart });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/saved-charts - Save a chart
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const chart = req.body;
    if (!chart || !chart.symbol) {
      return res.status(400).json({ success: false, error: 'Chart data with symbol required' });
    }
    
    const id = await storage.saveChart(chart);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/saved-charts/:id - Delete a saved chart
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await storage.deleteSavedChart(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Chart not found' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/saved-charts - Clear all saved charts
 */
router.delete('/', async (req: Request, res: Response) => {
  try {
    await storage.clearSavedCharts();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
