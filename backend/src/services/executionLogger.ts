import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '../../data/execution-log');

export type LogEventType =
  | 'scan_started'
  | 'scan_completed'
  | 'signal_detected'
  | 'signal_filtered'
  | 'exit_orders_repaired'
  | 'managed_position_exits_updated'
  | 'order_submitted'
  | 'order_filled'
  | 'order_rejected'
  | 'order_cancelled'
  | 'stop_moved'
  | 'position_closed'
  | 'kill_switch_triggered'
  | 'bridge_started'
  | 'bridge_stopped'
  | 'external_position_adopted'
  | 'external_position_updated'
  | 'external_position_removed'
  | 'error';

export interface LogEntry {
  timestamp: string;
  event: LogEventType;
  strategy_version_id?: string;
  symbol?: string;
  details: Record<string, any>;
}

function ensureDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function todayFile(): string {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${d}.json`);
}

export function log(entry: Omit<LogEntry, 'timestamp'>): void {
  ensureDir();
  const full: LogEntry = { timestamp: new Date().toISOString(), ...entry };
  const filePath = todayFile();

  let existing: LogEntry[] = [];
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      existing = Array.isArray(parsed) ? parsed : [];
    } catch {
      existing = [];
    }
  }
  existing.push(full);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');

  const symbolTag = full.symbol ? ` [${full.symbol}]` : '';
  console.error(`[ExecBridge] ${full.event}${symbolTag}: ${JSON.stringify(full.details)}`);
}

export function getLogForDate(date: string): LogEntry[] {
  const filePath = path.join(LOG_DIR, `${date}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getRecentLogs(days = 7): LogEntry[] {
  const safeDays = Math.max(1, Math.min(30, Number(days) || 7));
  const all: LogEntry[] = [];
  for (let i = 0; i < safeDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    all.push(...getLogForDate(dateStr));
  }
  return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
