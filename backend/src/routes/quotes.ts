/**
 * Quote Routes
 * 
 * Fetches current market prices for symbols using yfinance.
 * Used by Trade History to display live unrealized P&L.
 */

import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import { normalizeMarketDataSymbol } from '../services/marketSymbols';

const router = Router();

/**
 * POST /api/quotes - Get current prices for multiple symbols
 * Body: { symbols: ["AAPL", "MES=F", ...] }
 * Returns: { success: true, data: { "AAPL": { price, change, changePct }, ... } }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ success: false, error: 'symbols array required' });
    }
    
    // Limit to 20 symbols per request
    const limitedSymbols = symbols.slice(0, 20).map((symbol: unknown) => String(symbol || '').trim().toUpperCase());
    const normalizedSymbols = limitedSymbols.map((symbol: string) => normalizeMarketDataSymbol(symbol));
    
    const quotePath = path.join(__dirname, '..', '..', 'services', 'quoteService.py');
    const proc = spawn('py', [quotePath, ...normalizedSymbols]);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[QuoteService] stderr:', stderr);
        return res.status(500).json({ success: false, error: `Quote service exited with code ${code}` });
      }
      
      try {
        const quotes = JSON.parse(stdout);
        const remappedQuotes: Record<string, unknown> = {};
        limitedSymbols.forEach((original: string, index: number) => {
          const normalized = normalizedSymbols[index];
          remappedQuotes[original] = quotes?.[normalized] ?? quotes?.[original] ?? null;
        });
        res.json({ success: true, data: remappedQuotes });
      } catch (e) {
        console.error('[QuoteService] Failed to parse output:', stdout);
        res.status(500).json({ success: false, error: 'Failed to parse quote data' });
      }
    });
    
    // Timeout after 15 seconds
    setTimeout(() => {
      proc.kill();
    }, 15000);
    
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/quotes/options - Get current premiums for option contracts
 * Body: { options: [{ symbol, strike, expiry, type, id }, ...] }
 * Returns: { success: true, data: { "trade-id": { premium, bid, ask, mark, iv, ... }, ... } }
 */
router.post('/options', async (req: Request, res: Response) => {
  try {
    const { options } = req.body;
    
    if (!options || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ success: false, error: 'options array required' });
    }
    
    // Limit to 10 option lookups per request
    const limitedOptions = options.slice(0, 10);
    const optionsJson = JSON.stringify(limitedOptions);
    
    const quotePath = path.join(__dirname, '..', '..', 'services', 'quoteService.py');
    const proc = spawn('py', [quotePath, '--options', optionsJson]);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code: number) => {
      if (code !== 0) {
        console.error('[QuoteService:Options] stderr:', stderr);
        return res.status(500).json({ success: false, error: `Option quote service exited with code ${code}` });
      }
      
      try {
        const quotes = JSON.parse(stdout);
        res.json({ success: true, data: quotes });
      } catch (e) {
        console.error('[QuoteService:Options] Failed to parse output:', stdout);
        res.status(500).json({ success: false, error: 'Failed to parse option quote data' });
      }
    });
    
    // Timeout after 20 seconds (options chains can be slower)
    setTimeout(() => {
      proc.kill();
    }, 20000);
    
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
