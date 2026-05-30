import { Router, Request, Response } from 'express';
import {
  getEdgarFilingsScheduleStatus,
  loadEdgarFilingsScheduleConfig,
  runEdgarCollectionNow,
  saveEdgarFilingsScheduleConfig,
  run13fCollectionNow,
  get13fCollectionStatus,
} from '../services/edgarFilingsScheduler';
import {
  getInsiderTradesForSymbol,
  toFundamentalsInsiderTrades,
  getFilingAlerts,
  getRecentTransactions,
  getInsiderSummaryBatch,
  getInstitutionalHoldings,
  getSmartMoneySummaryBatch,
  getFundRegistry,
  getTopSmartMoneySymbols,
} from '../services/edgarFilingsDb';

const router = Router();

router.get('/settings', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: getEdgarFilingsScheduleStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/settings', (req: Request, res: Response) => {
  try {
    const current = loadEdgarFilingsScheduleConfig();
    const config = saveEdgarFilingsScheduleConfig({
      ...current,
      ...(req.body || {}),
    });
    res.json({
      success: true,
      data: {
        ...getEdgarFilingsScheduleStatus(),
        config,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/run-collect', (_req: Request, res: Response) => {
  try {
    const result = runEdgarCollectionNow('manual');
    res.json({
      success: true,
      data: {
        ...result,
        ...getEdgarFilingsScheduleStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/run-collect-13f', (_req: Request, res: Response) => {
  try {
    const result = run13fCollectionNow();
    res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/13f-status', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: get13fCollectionStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// ── Data query endpoints ──────────────────────────────────────────────────────

router.get('/transactions/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol required' });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const lookbackDays = Math.min(Number(req.query.lookback_days) || 90, 365);
    const raw = getInsiderTradesForSymbol(symbol, limit, lookbackDays);
    return res.json({
      success: true,
      data: {
        symbol,
        count: raw.length,
        transactions: raw,
        formatted: toFundamentalsInsiderTrades(raw),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/transactions', (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const lookbackDays = Math.min(Number(req.query.lookback_days) || 14, 365);
    const txnType = String(req.query.type || '').trim() || undefined;
    const raw = getRecentTransactions(limit, lookbackDays, txnType);
    return res.json({
      success: true,
      data: {
        count: raw.length,
        transactions: raw,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/alerts', (req: Request, res: Response) => {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase() || undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const lookbackDays = Math.min(Number(req.query.lookback_days) || 30, 365);
    const alerts = getFilingAlerts(symbol, limit, lookbackDays);
    return res.json({
      success: true,
      data: {
        count: alerts.length,
        alerts,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/summary', (req: Request, res: Response) => {
  try {
    const rawSymbols: unknown[] = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
    const symbols = rawSymbols
      .map((v) => String(v || '').trim().toUpperCase())
      .filter(Boolean);
    if (!symbols.length) {
      return res.status(400).json({ success: false, error: 'symbols array required' });
    }
    const lookbackDays = Math.min(Number(req.body?.lookback_days) || 90, 365);
    const summaries = getInsiderSummaryBatch(symbols, lookbackDays);
    const result: Record<string, any> = {};
    for (const [sym, summary] of summaries) {
      result[sym] = summary;
    }
    return res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

// ── 13F Institutional Holdings ──────────────────────────────────────────────

router.get('/holdings/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol required' });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const holdings = getInstitutionalHoldings(symbol, limit);
    return res.json({
      success: true,
      data: {
        symbol,
        count: holdings.length,
        holdings,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/smart-money', (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const top = getTopSmartMoneySymbols(limit);
    return res.json({
      success: true,
      data: {
        count: top.length,
        symbols: top,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.get('/funds', (_req: Request, res: Response) => {
  try {
    const funds = getFundRegistry();
    return res.json({
      success: true,
      data: {
        count: funds.length,
        funds,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

router.post('/smart-money-batch', (req: Request, res: Response) => {
  try {
    const rawSymbols: unknown[] = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
    const symbols = rawSymbols
      .map((v) => String(v || '').trim().toUpperCase())
      .filter(Boolean);
    if (!symbols.length) {
      return res.status(400).json({ success: false, error: 'symbols array required' });
    }
    const summaries = getSmartMoneySummaryBatch(symbols);
    const result: Record<string, any> = {};
    for (const [sym, summary] of summaries) {
      result[sym] = summary;
    }
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

export default router;
