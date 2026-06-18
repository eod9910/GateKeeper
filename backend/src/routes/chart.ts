/**
 * Chart Data API Routes
 *
 * Provides raw OHLCV chart data without running any scans or pattern detection.
 * Used for quick symbol lookup — type a symbol, get a chart immediately.
 */

import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import { normalizeChartOhlcvPayload } from '../services/contractValidation';
import { normalizeMarketDataSymbol } from '../services/marketSymbols';

const router = Router();

const PY_SERVICE_BASE_URL = (process.env.PY_PLUGIN_SERVICE_URL || 'http://127.0.0.1:8100').replace(/\/+$/, '');
const MIN_USABLE_CHART_BARS = 2;
const CHART_DATA_PROXIES: Record<string, string> = {
  MCL: 'CL=F',
  'MCL=F': 'CL=F',
};

function getChartDataProxySymbol(symbol: string): string | null {
  return CHART_DATA_PROXIES[String(symbol || '').trim().toUpperCase()] || null;
}

/**
 * GET /api/chart/ohlcv?symbol=AAPL&interval=1d&period=2y
 * Returns raw OHLCV bars formatted for LightweightCharts.
 */
router.get('/ohlcv', async (req: Request, res: Response) => {
  try {
    const symbol = normalizeMarketDataSymbol(req.query.symbol);
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol is required' });
    }

    const interval = String(req.query.interval || '1d');
    const period = String(req.query.period || '2y');
    const forceRefresh = String(req.query.force_refresh || '').trim().toLowerCase() === 'true';

    // Try the Python service (fast path with caching)
    try {
      const pyRes = await fetch(`${PY_SERVICE_BASE_URL}/chart/ohlcv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, interval, period, force_refresh: forceRefresh }),
        timeout: 30000,
      } as any);

      if (pyRes.ok) {
        const data = await pyRes.json();
        const normalized = normalizeChartOhlcvPayload(data, symbol, interval);
        if (normalized.chart_data.length >= MIN_USABLE_CHART_BARS) {
          return res.json(normalized);
        }

        const proxySymbol = getChartDataProxySymbol(symbol);
        if (proxySymbol) {
          const proxyRes = await fetch(`${PY_SERVICE_BASE_URL}/chart/ohlcv`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: proxySymbol, interval, period, force_refresh: forceRefresh }),
            timeout: 30000,
          } as any);

          if (proxyRes.ok) {
            const proxyData = await proxyRes.json();
            const normalizedProxy = normalizeChartOhlcvPayload(proxyData, proxySymbol, interval);
            if (normalizedProxy.chart_data.length >= MIN_USABLE_CHART_BARS) {
              return res.json({
                ...normalizedProxy,
                symbol,
                requested_symbol: symbol,
                proxy_symbol: proxySymbol,
                proxy_reason: 'requested futures symbol returned too few bars',
              });
            }
          }
        }

        return res.json(normalized);
      }
    } catch (serviceErr: any) {
      console.warn(`[chart] Python service unavailable; falling back to spawn: ${serviceErr?.message}`);
    }

    // Fallback: spawn Python to fetch data
    const { spawn } = require('child_process');
    const path = require('path');
    const scriptPath = path.join(__dirname, '..', '..', 'services', 'patternScanner.py');

    const spawnSymbol = getChartDataProxySymbol(symbol) || symbol;
    const pyScript = `
import sys, json
sys.path.insert(0, r"${path.join(__dirname, '..', '..', 'services').replace(/\\/g, '\\\\')}")
from patternScanner import fetch_data_yfinance
bars = fetch_data_yfinance("${spawnSymbol}", period="${period}", interval="${interval}", force_refresh=${forceRefresh ? 'True' : 'False'}) or []
raw_bars = []
for bar in bars:
    raw_bars.append({
        "timestamp": bar.timestamp,
        "open": float(bar.open),
        "high": float(bar.high),
        "low": float(bar.low),
        "close": float(bar.close),
        "volume": float(getattr(bar, 'volume', 0) or 0),
    })

print(json.dumps({"success": True, "symbol": "${symbol}", "interval": "${interval}", "raw_bars": raw_bars}))
`;

    const py = spawn('py', ['-c', pyScript]);
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    py.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    py.on('close', (code: number) => {
      if (code !== 0) {
        return res.status(500).json({ success: false, error: stderr || `Python exited ${code}` });
      }
      try {
        const result = JSON.parse(stdout);
        const normalized = normalizeChartOhlcvPayload(result, spawnSymbol, interval);
        if (spawnSymbol !== symbol) {
          return res.json({
            ...normalized,
            symbol,
            requested_symbol: symbol,
            proxy_symbol: spawnSymbol,
            proxy_reason: 'requested futures symbol uses chart data proxy',
          });
        }
        return res.json(normalized);
      } catch (e: any) {
        return res.status(500).json({ success: false, error: `Parse error: ${e.message}` });
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
