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
import mlRouter from './routes/ml';
import autoLabelRouter from './routes/autoLabel';
import trainingRouter from './routes/training';
import referenceRouter from './routes/reference';
import * as executionBridge from './services/executionBridge';

const app = express();
const PORT = process.env.PORT || 3002;
const FRONTEND_PUBLIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'public');
const RESEARCH_ARTIFACTS_DIR = path.join(__dirname, '..', 'data', 'research');

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
app.use('/api/ml', mlRouter);
app.use('/api/auto-label', autoLabelRouter);
app.use('/api/training', trainingRouter);
app.use('/api/reference', referenceRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'pattern-detector',
    timestamp: new Date().toISOString()
  });
});

// Named routes → serve specific HTML pages
app.get('/validator', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'validator.html'));
});

app.get('/strategy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'strategy.html'));
});

app.get('/workshop', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'public', 'workshop.html'));
});

app.get('/research', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'research.html'));
});

app.get('/sweep', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'sweep.html'));
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

app.get('/vision-lab', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'vision-lab.html'));
});

app.get('/family-explorer', (req, res) => {
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'family-explorer.html'));
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
