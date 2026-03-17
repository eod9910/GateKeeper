import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import { FundamentalsSnapshotV2 } from '../types';
import { normalizeFundamentalsSnapshot } from '../services/contractValidation';
import { normalizeMarketDataSymbol } from '../services/marketSymbols';

const router = Router();

router.get('/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = normalizeMarketDataSymbol(req.params.symbol);
    if (!symbol) {
      return res.status(400).json({ success: false, error: 'symbol required' });
    }

    const servicePath = path.join(__dirname, '..', '..', 'services', 'fundamentalsService.py');
    const proc = spawn('py', [servicePath, symbol]);

    let stdout = '';
    let stderr = '';
    let responded = false;
    const finish = (status: number, body: Record<string, unknown>) => {
      if (responded || res.headersSent) return;
      responded = true;
      res.status(status).json(body);
    };

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      finish(500, { success: false, error: error.message });
    });

    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        const reason = signal
          ? `Fundamentals service exited via signal ${signal}`
          : `Fundamentals service exited with code ${code}`;
        return finish(signal === 'SIGTERM' ? 504 : 500, { success: false, error: stderr || reason });
      }

      try {
        const payload = JSON.parse(stdout) as FundamentalsSnapshotV2 & { error?: string };
        if (payload?.error) {
          return finish(500, { success: false, error: payload.error });
        }
        return finish(200, { success: true, data: normalizeFundamentalsSnapshot(payload) });
      } catch (err: any) {
        return finish(500, { success: false, error: `Failed to parse fundamentals data: ${err.message}` });
      }
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
    }, 30000);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
