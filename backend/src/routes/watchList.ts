import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WL_FILE = path.join(DATA_DIR, 'watchlist.json');

interface WatchListEntry {
  symbol: string;
  score?: number;
  composite_id?: string;
  interval?: string;
  price_box?: { top: number; bottom: number } | null;
  entry_price?: number;
  stop_price?: number;
  take_profit?: number;
  take_profit_2?: number;
  take_profit_3?: number;
  direction?: number;
  instrument_type?: string;
  futures_margin?: number;
  point_value?: number;
  tick_size?: number;
  risk_percent?: number;
  manual_size?: number;
  note?: string;
  saved_at: string;
}

function loadEntries(): WatchListEntry[] {
  try {
    if (!fs.existsSync(WL_FILE)) return [];
    return JSON.parse(fs.readFileSync(WL_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveEntries(entries: WatchListEntry[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WL_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: loadEntries() });
});

router.post('/', (req: Request, res: Response) => {
  const body = req.body;
  if (!body?.symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

  const symbol = String(body.symbol).toUpperCase().trim();
  let entries = loadEntries().filter((e) => e.symbol !== symbol);

  entries.unshift({
    symbol,
    score: body.score != null ? Number(body.score) : undefined,
    composite_id: body.composite_id || undefined,
    interval: body.interval || '1d',
    price_box: body.price_box || null,
    entry_price: body.entry_price != null ? Number(body.entry_price) : undefined,
    stop_price: body.stop_price != null ? Number(body.stop_price) : undefined,
    take_profit: body.take_profit != null ? Number(body.take_profit) : undefined,
    take_profit_2: body.take_profit_2 != null ? Number(body.take_profit_2) : undefined,
    take_profit_3: body.take_profit_3 != null ? Number(body.take_profit_3) : undefined,
    direction: body.direction != null ? Number(body.direction) : undefined,
    instrument_type: body.instrument_type || undefined,
    futures_margin: body.futures_margin != null ? Number(body.futures_margin) : undefined,
    point_value: body.point_value != null ? Number(body.point_value) : undefined,
    tick_size: body.tick_size != null ? Number(body.tick_size) : undefined,
    risk_percent: body.risk_percent != null ? Number(body.risk_percent) : undefined,
    manual_size: body.manual_size != null ? Number(body.manual_size) : undefined,
    note: body.note || '',
    saved_at: new Date().toISOString(),
  });

  saveEntries(entries);
  res.json({ success: true, data: entries });
});

router.delete('/:symbol', (req: Request, res: Response) => {
  const symbol = String(req.params.symbol).toUpperCase().trim();
  const entries = loadEntries().filter((e) => e.symbol !== symbol);
  saveEntries(entries);
  res.json({ success: true, data: entries });
});

router.delete('/', (_req: Request, res: Response) => {
  saveEntries([]);
  res.json({ success: true, data: [] });
});

export default router;
