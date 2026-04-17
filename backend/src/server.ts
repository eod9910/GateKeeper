/**
 * Pattern Detector Backend Server
 * 
 * Light Express server for pattern detection with human-in-the-loop labeling.
 */

// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'node:fs';
import { spawn } from 'child_process';

import candidatesRouter from './routes/candidates';
import labelsRouter from './routes/labels';
import correctionsRouter from './routes/corrections';
import visionRouter from './routes/vision';
import savedChartsRouter from './routes/savedCharts';
import tradesRouter from './routes/trades';
import quotesRouter from './routes/quotes';
import fundamentalsRouter from './routes/fundamentals';
import validatorRouter from './routes/validator';
import strategiesRouter from './routes/strategies';
import pluginsRouter from './routes/plugins';
import chartRouter from './routes/chart';
import universeRouter from './routes/universe';
import researchRouter from './routes/research';
import sweepRouter from './routes/sweep';
import executionRouter from './routes/execution';
import aiSettingsRouter from './routes/aiSettings';
import ledgerHydrationRouter from './routes/ledgerHydration';
import audioRouter from './routes/audio';
import mlRouter from './routes/ml';
import autoLabelRouter from './routes/autoLabel';
import trainingRouter from './routes/training';
import referenceRouter from './routes/reference';
import consumerCycleRouter from './routes/consumerCycle';
import * as executionBridge from './services/executionBridge';
import * as ledgerHydrationScheduler from './services/ledgerHydrationScheduler';

const app = express();
const PORT = process.env.PORT || 3002;
const FRONTEND_PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'public');
const RESEARCH_ARTIFACTS_DIR = path.join(__dirname, '..', 'data', 'research');
const REPO_STATE_SCRIPT = path.join(__dirname, '..', 'scripts', 'check_repo_state.ps1');
const LEDGER_COVERAGE_SYNC_SCRIPT = path.join(__dirname, '..', 'scripts', 'sync_ledger_coverage_from_canonical.py');
const LEDGER_COVERAGE_SYNC_STATE = path.join(__dirname, '..', 'data', 'preferences', 'ledger-coverage-sync.local.json');

function getPythonLauncher(): string {
  return process.platform === 'win32' ? 'py' : (process.env.PYTHON || 'python3');
}

function readLedgerCoverageSyncState(): { last_started_at?: string; last_finished_at?: string; last_exit_code?: number | null } | null {
  try {
    if (!fs.existsSync(LEDGER_COVERAGE_SYNC_STATE)) return null;
    const payload = JSON.parse(fs.readFileSync(LEDGER_COVERAGE_SYNC_STATE, 'utf-8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function writeLedgerCoverageSyncState(payload: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(LEDGER_COVERAGE_SYNC_STATE), { recursive: true });
    fs.writeFileSync(LEDGER_COVERAGE_SYNC_STATE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[LedgerSync] failed to persist sync state:', err?.message || String(err));
  }
}

function runRepoStateCheckOnStartup(): void {
  const shell = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const child = spawn(shell, ['-ExecutionPolicy', 'Bypass', '-File', REPO_STATE_SCRIPT], {
    cwd: path.join(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    console.log(`[RepoState]\n${text}`);
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    console.warn(`[RepoState] ${text}`);
  });

  child.on('error', (err) => {
    console.warn('[RepoState] failed to start repo-state check:', err?.message || String(err));
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`[RepoState] repo-state check exited with code ${code}`);
    }
  });
}

function runLedgerCoverageSyncOnStartup(): void {
  if (!fs.existsSync(LEDGER_COVERAGE_SYNC_SCRIPT)) {
    console.warn('[LedgerSync] sync script is not available on startup.');
    return;
  }

  const enabled = String(process.env.LEDGER_COVERAGE_SYNC_ON_STARTUP ?? '1').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(enabled)) {
    console.log('[LedgerSync] startup sync is disabled by environment.');
    return;
  }

  const cooldownHoursRaw = Number(process.env.LEDGER_COVERAGE_SYNC_COOLDOWN_HOURS);
  const cooldownHours = Number.isFinite(cooldownHoursRaw) && cooldownHoursRaw >= 0 ? cooldownHoursRaw : 12;
  const limitRaw = Number(process.env.LEDGER_COVERAGE_SYNC_STARTUP_LIMIT);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : 5;
  const state = readLedgerCoverageSyncState();
  const lastFinishedAt = state?.last_finished_at ? Date.parse(state.last_finished_at) : NaN;
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  if (Number.isFinite(lastFinishedAt) && cooldownMs > 0 && (Date.now() - lastFinishedAt) < cooldownMs) {
    console.log(`[LedgerSync] startup sync skipped; last run finished within ${cooldownHours}h.`);
    return;
  }

  writeLedgerCoverageSyncState({
    ...(state || {}),
    last_started_at: new Date().toISOString(),
    last_finished_at: state?.last_finished_at || null,
    last_exit_code: null,
  });

  const child = spawn(
    getPythonLauncher(),
    [
      LEDGER_COVERAGE_SYNC_SCRIPT,
      '--limit',
      String(limit),
      '--write-report',
    ],
    {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    console.log(`[LedgerSync]\n${text}`);
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text) return;
    console.warn(`[LedgerSync] ${text}`);
  });

  child.on('error', (err) => {
    writeLedgerCoverageSyncState({
      ...(readLedgerCoverageSyncState() || {}),
      last_finished_at: new Date().toISOString(),
      last_exit_code: -1,
    });
    console.warn('[LedgerSync] failed to start startup sync:', err?.message || String(err));
  });

  child.on('exit', (code) => {
    writeLedgerCoverageSyncState({
      ...(readLedgerCoverageSyncState() || {}),
      last_finished_at: new Date().toISOString(),
      last_exit_code: code ?? 0,
    });
    if (code && code !== 0) {
      console.warn(`[LedgerSync] startup sync exited with code ${code}`);
      return;
    }
    console.log('[LedgerSync] startup sync finished.');
  });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static frontend files (no-cache in dev to prevent stale JS/HTML)
app.use(express.static(FRONTEND_PUBLIC_DIR, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// Serve generated research artifacts so app pages can render the latest explorer output.
app.use('/research-artifacts', express.static(RESEARCH_ARTIFACTS_DIR, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// API Routes
app.use('/api/candidates', candidatesRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/corrections', correctionsRouter);
app.use('/api/vision', visionRouter);
app.use('/api/saved-charts', savedChartsRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/fundamentals', fundamentalsRouter);
app.use('/api/validator', validatorRouter);
app.use('/api/strategies', strategiesRouter);
app.use('/api/plugins', pluginsRouter);
app.use('/api/chart', chartRouter);
app.use('/api/universe', universeRouter);
app.use('/api/research', researchRouter);
app.use('/api/sweep', sweepRouter);
app.use('/api/execution', executionRouter);
app.use('/api/ai', aiSettingsRouter);
app.use('/api/ledger-hydration', ledgerHydrationRouter);
app.use('/api/audio', audioRouter);
app.use('/api/ml', mlRouter);
app.use('/api/auto-label', autoLabelRouter);
app.use('/api/training', trainingRouter);
app.use('/api/reference', referenceRouter);
app.use('/api/consumer-cycle', consumerCycleRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'pattern-detector',
    timestamp: new Date().toISOString()
  });
});

// Named routes → serve specific HTML pages
app.get('/scanner', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'index.html'));
});

app.get('/validator', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'validator.html'));
});

app.get('/strategy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'strategy.html'));
});

app.get('/trading-desk', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'copilot.html'));
});

app.get('/position-book', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'history.html'));
});

app.get('/indicator-studio', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'workshop.html'));
});

app.get('/workshop', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'workshop.html'));
});

app.get('/research-studio', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'research.html'));
});

app.get('/research', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'research.html'));
});

app.get('/parameter-sweep', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'sweep.html'));
});

app.get('/sweep', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'sweep.html'));
});

app.get('/sweep-history', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'sweep-history.html'));
});

app.get('/execution-desk', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'execution.html'));
});

app.get('/execution', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'execution.html'));
});

app.get('/training', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'training.html'));
});

app.get('/auto-labeler', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'auto-labeler.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'settings.html'));
});

app.get('/vision-lab', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'vision-lab.html'));
});

app.get('/family-explorer', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'family-explorer.html'));
});

app.get('/consumer-cycle', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'consumer-cycle.html'));
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║         Pattern Detector Server                ║
╠════════════════════════════════════════════════╣
║  Server running at http://localhost:${PORT}       ║
║                                                ║
║  API Endpoints:                                ║
║    GET  /api/candidates          - List all    ║
║    GET  /api/candidates/unlabeled - Queue      ║
║    POST /api/candidates/scan     - Run scanner ║
║    GET  /api/labels              - List labels ║
║    POST /api/labels              - Save label  ║
║    GET  /api/labels/stats        - Statistics  ║
║    GET  /api/saved-charts       - Saved charts ║
║    POST /api/saved-charts       - Save chart   ║
║    GET  /api/trades             - Trade history ║
║    POST /api/trades             - Save trade   ║
╚════════════════════════════════════════════════╝
  `);

  runRepoStateCheckOnStartup();
  const resumedHydrationSchedule = ledgerHydrationScheduler.resumeLedgerHydrationSchedulerFromDisk();
  if (resumedHydrationSchedule) {
    console.log('[LedgerSync] resumed persisted hydration schedule');
  } else if (!ledgerHydrationScheduler.hasPersistedLedgerHydrationSchedulePreference()) {
    runLedgerCoverageSyncOnStartup();
  }

  void executionBridge.resumeBridgeFromDisk()
    .then((resumed) => {
      if (resumed) {
        console.log('[ExecutionBridge] resumed persisted bridge config');
      }
    })
    .catch((err) => {
      console.error('[ExecutionBridge] failed to resume persisted bridge config:', err?.message || String(err));
    });
});

export default app;
