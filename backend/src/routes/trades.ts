/**
 * Trade History Routes
 * 
 * Server-side storage for trade history (replaces localStorage).
 * Stores planned trades, execution logs, journal entries on the filesystem.
 */

import { Router, Request, Response } from 'express';
import * as storage from '../services/storageService';

const router = Router();

/**
 * GET /api/trades - Get all trades
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const trades = await storage.getAllTrades();
    res.json({ success: true, data: trades });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/trades/:id - Get a specific trade
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const trade = await storage.getTrade(req.params.id);
    if (!trade) {
      return res.status(404).json({ success: false, error: 'Trade not found' });
    }
    res.json({ success: true, data: trade });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/trades - Save a new trade
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const trade = req.body;
    if (!trade || !trade.symbol) {
      return res.status(400).json({ success: false, error: 'Trade data with symbol required' });
    }
    
    const id = await storage.saveTrade(trade);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/trades/:id - Update a trade (execution, exit, journal)
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const updated = await storage.updateTrade(req.params.id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Trade not found' });
    }
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/trades/:id - Delete a trade
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await storage.deleteTrade(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Trade not found' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/trades - Clear all trades
 */
router.delete('/', async (req: Request, res: Response) => {
  try {
    await storage.clearTrades();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
