/**
 * Research Agent
 *
 * Orchestrates the closed-loop autonomous strategy discovery process:
 *   generate hypothesis → build plugins → run backtest → evaluate → iterate
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  generateHypothesis,
  generatePlugin,
  registerGeneratedPlugin,
  computeFitnessScore,
  GenomeEntry,
  ReportSummary,
  reflectOnBacktest,
  ReflectionInput,
} from './strategyGenService';
import { getAllValidationReports, getValidationReport, getTradeInstances, saveStrategy } from './storageService';
import { StrategySpec } from '../types';

// ─── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RESEARCH_DIR = path.join(DATA_DIR, 'research', 'sessions');
const PLUGINS_DIR = path.join(__dirname, '..', '..', 'services', 'plugins');
const REGISTRY_PATH = path.join(DATA_DIR, 'patterns', 'registry.json');
const STRATEGIES_DIR = path.join(DATA_DIR, 'strategies');
const TOMBSTONE_PATH = path.join(DATA_DIR, 'research-tombstones.json');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3002}/api`;

const GATE_MIN_TRADES = 100;
const GATE_MIN_EXPECTANCY = 0;
const GATE_MIN_PROFIT_FACTOR = 1.0;

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single feature to include in the SR run. */
export interface SrFeatureSpec {
  id: string;
  period?: number;
}

/** Config for Symbolic Regression mode (indicator + OHLCV path). */
export interface SrSessionConfig {
  symbol: string;
  interval: string;
  years?: number;
  target_bars?: number;
  population_size?: number;
  generations?: number;
  /** Which features to feed into SR. If omitted, defaults to [rsi(14), atr_norm(14), momentum(5)]. */
  features?: SrFeatureSpec[];
}

export interface ResearchSessionConfig {
  name: string;
  max_generations: number;
  target_interval: string;
  target_asset_class: string;
  seed_hypothesis?: string;
  promotion_min_fitness: number;
  promotion_requires_pass: boolean;
  allow_new_primitives: boolean;
  hypothesis_model?: string;
  reflection_model?: string;
  /** Params mandated for the first generation (carried from a previous session's reflection) */
  forced_params?: Record<string, any>;
  /** ID of the session this was continued from */
  continued_from?: string;
  /** User's configured risk rule defaults from Settings */
  risk_defaults?: Record<string, any>;
  /** Research mode: strategy discovery (default) or symbolic regression */
  mode?: 'strategy_discovery' | 'symbolic_regression';
  /** When mode is symbolic_regression, SR run config (symbol, interval, target_bars, etc.). */
  sr_config?: SrSessionConfig;
}

export interface ResearchSession {
  session_id: string;
  status: 'running' | 'stopped' | 'completed' | 'error';
  generation: number;
  max_generations: number;
  genome: GenomeEntry[];
  best: GenomeEntry | null;
  config: ResearchSessionConfig;
  current_hypothesis?: string;
  current_job_id?: string;
  error?: string;
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

/** SSE subscriber callback */
type SseListener = (event: string, data: unknown) => void;

// ─── In-memory session registry ───────────────────────────────────────────────

const sessions = new Map<string, ResearchSession>();
const sseListeners = new Map<string, Set<SseListener>>();

function emit(sessionId: string, event: string, data: unknown): void {
  const listeners = sseListeners.get(sessionId);
  if (listeners) {
    for (const fn of listeners) {
      try { fn(event, data); } catch {}
    }
  }
}

export function subscribeToSession(sessionId: string, listener: SseListener): () => void {
  if (!sseListeners.has(sessionId)) sseListeners.set(sessionId, new Set());
  sseListeners.get(sessionId)!.add(listener);
  return () => sseListeners.get(sessionId)?.delete(listener);
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

async function sessionDir(sessionId: string): Promise<string> {
  const dir = path.join(RESEARCH_DIR, sessionId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function saveState(session: ResearchSession): Promise<void> {
  try {
    const dir = await sessionDir(session.session_id);
    session.updated_at = new Date().toISOString();
    const filepath = path.join(dir, 'state.json');
    await fs.writeFile(filepath, JSON.stringify(session, null, 2), 'utf-8');
  } catch (err: any) {
    console.error(`[ResearchAgent] saveState FAILED for ${session.session_id}: ${err.message}`);
  }
}

async function appendGenome(sessionId: string, entry: GenomeEntry): Promise<void> {
  const dir = await sessionDir(sessionId);
  await fs.appendFile(path.join(dir, 'genome.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');
}

export async function loadAllSessions(): Promise<ResearchSession[]> {
  try {
    await fs.mkdir(RESEARCH_DIR, { recursive: true });
    const dirs = await fs.readdir(RESEARCH_DIR);
    console.log(`[ResearchAgent] loadAllSessions: found ${dirs.length} session dirs in ${RESEARCH_DIR}`);
    const loaded: ResearchSession[] = [];
    for (const d of dirs) {
      try {
        const raw = await fs.readFile(path.join(RESEARCH_DIR, d, 'state.json'), 'utf-8');
        const s = JSON.parse(raw) as ResearchSession;
        if (s.status === 'running') {
          s.status = 'stopped';
          s.current_job_id = undefined;
          await fs.writeFile(path.join(RESEARCH_DIR, d, 'state.json'), JSON.stringify(s, null, 2), 'utf-8');
        }
        sessions.set(s.session_id, s);
        loaded.push(s);
        console.log(`[ResearchAgent] Loaded session ${s.session_id} (gen ${s.generation}, status: ${s.status})`);
      } catch (err: any) {
        console.warn(`[ResearchAgent] Failed to load session ${d}: ${err.message}`);
      }
    }
    return loaded;
  } catch (err: any) {
    console.error(`[ResearchAgent] loadAllSessions failed: ${err.message}`);
    return [];
  }
}

export function getSession(sessionId: string): ResearchSession | undefined {
  return sessions.get(sessionId);
}

export function listSessions(): ResearchSession[] {
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// ─── Strategy registration helpers ───────────────────────────────────────────

async function registerStrategy(spec: Record<string, any>): Promise<void> {
  await fs.mkdir(STRATEGIES_DIR, { recursive: true });
  const filePath = path.join(STRATEGIES_DIR, `${spec.strategy_version_id}.json`);
  await fs.writeFile(filePath, JSON.stringify(spec, null, 2), 'utf-8');
}

async function removeStrategyFile(strategyVersionId: string): Promise<void> {
  try {
    const filePath = path.join(STRATEGIES_DIR, `${strategyVersionId}.json`);
    await fs.unlink(filePath);
  } catch {}
}

interface TombstoneEntry {
  strategy_version_id: string;
  name: string;
  hypothesis: string;
  expectancy_R: number;
  total_trades: number;
  profit_factor: number;
  reason: string;
  discarded_at: string;
}

async function logTombstone(entry: TombstoneEntry): Promise<void> {
  let tombstones: TombstoneEntry[] = [];
  try {
    const raw = await fs.readFile(TOMBSTONE_PATH, 'utf-8');
    tombstones = JSON.parse(raw);
  } catch {}
  tombstones.push(entry);
  await fs.writeFile(TOMBSTONE_PATH, JSON.stringify(tombstones, null, 2), 'utf-8');
}

function passesGate(report: ReportSummary | null): { pass: boolean; reason: string } {
  if (!report) return { pass: false, reason: 'no backtest results' };
  if (report.total_trades < GATE_MIN_TRADES)
    return { pass: false, reason: `only ${report.total_trades} trades (need >=${GATE_MIN_TRADES})` };
  if (report.expectancy_R <= GATE_MIN_EXPECTANCY)
    return { pass: false, reason: `negative expectancy (${report.expectancy_R.toFixed(4)}R)` };
  if (report.profit_factor < GATE_MIN_PROFIT_FACTOR)
    return { pass: false, reason: `profit factor ${report.profit_factor.toFixed(3)} < ${GATE_MIN_PROFIT_FACTOR}` };
  return { pass: true, reason: '' };
}

// ─── Validator polling ────────────────────────────────────────────────────────

async function startValidatorJob(
  strategyVersionId: string,
  interval: string,
  session: ResearchSession,
): Promise<string> {
  const res = await fetch(`${API_BASE}/validator/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strategy_version_id: strategyVersionId,
      tier: 'tier1',
      interval,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Validator run failed: ${err}`);
  }

  const payload = await res.json() as any;
  return payload?.data?.job_id as string;
}

async function pollValidatorJob(
  jobId: string,
  sessionId: string,
  onProgress: (stage: string, detail: string, pct: number) => void,
): Promise<{ report_id: string } | null> {
  const maxWaitMs = 90 * 60 * 1000; // 90 minutes
  const pollInterval = 10_000;
  let elapsed = 0;

  while (elapsed < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    elapsed += pollInterval;

    const session = sessions.get(sessionId);
    if (!session || session.status === 'stopped') return null;

    try {
      const res = await fetch(`${API_BASE}/validator/run/${jobId}`);
      if (!res.ok) continue;
      const payload = await res.json() as any;
      const job = payload?.data;
      if (!job) continue;

      onProgress(job.stage || '', job.detail || '', job.progress || 0);

      if (job.status === 'completed' && job.report_id) {
        return { report_id: job.report_id };
      }
      if (job.status === 'failed') {
        return null;
      }
    } catch {}
  }

  return null;
}

async function fetchReport(reportId: string): Promise<ReportSummary | null> {
  try {
    const r = await getValidationReport(reportId);
    if (!r) return null;

    return {
      total_trades: (r as any).trades_summary?.total_trades ?? 0,
      win_rate: (r as any).trades_summary?.win_rate ?? 0,
      expectancy_R: (r as any).trades_summary?.expectancy_R ?? 0,
      profit_factor: (r as any).trades_summary?.profit_factor ?? 0,
      max_drawdown_pct: (r as any).risk_summary?.max_drawdown_pct ?? 100,
      sharpe_ratio: (r as any).risk_summary?.sharpe_ratio ?? 0,
      oos_degradation_pct: (r as any).robustness?.out_of_sample?.oos_degradation_pct ?? 100,
      pass_fail: (r as any).pass_fail ?? 'FAIL',
    };
  } catch {
    return null;
  }
}

// ─── Reflection data fetchers ─────────────────────────────────────────────────

async function fetchDetailedReport(reportId: string): Promise<any | null> {
  try {
    return await getValidationReport(reportId);
  } catch {
    return null;
  }
}

async function fetchTrades(reportId: string): Promise<any[]> {
  try {
    const trades = await getTradeInstances(reportId);
    return trades ?? [];
  } catch {
    return [];
  }
}

async function buildReflectionInput(
  hypothesis: string,
  summary: ReportSummary,
  reportId: string,
): Promise<ReflectionInput | null> {
  try {
    const [detail, trades] = await Promise.all([
      fetchDetailedReport(reportId),
      fetchTrades(reportId),
    ]);

    const risk = detail?.risk_summary ?? {};

    // Per-symbol aggregation
    const symMap = new Map<string, { trades: number; wins: number; totalR: number }>();
    for (const t of trades) {
      const sym = t.symbol || 'UNKNOWN';
      const entry = symMap.get(sym) || { trades: 0, wins: 0, totalR: 0 };
      entry.trades++;
      if (t.R_multiple > 0) entry.wins++;
      entry.totalR += t.R_multiple ?? 0;
      symMap.set(sym, entry);
    }
    const perSymbol = Array.from(symMap.entries()).map(([symbol, s]) => ({
      symbol,
      trades: s.trades,
      wins: s.wins,
      avg_R: s.trades > 0 ? s.totalR / s.trades : 0,
    }));

    // Exit reason breakdown
    const exitMap: Record<string, number> = {};
    for (const t of trades) {
      const reason = t.exit_reason || 'unknown';
      exitMap[reason] = (exitMap[reason] || 0) + 1;
    }

    // Sample trades (mix of winners and losers, capped)
    const sorted = [...trades].sort((a, b) => (a.R_multiple ?? 0) - (b.R_multiple ?? 0));
    const sample = [
      ...sorted.slice(0, 15),
      ...sorted.slice(-5),
    ].map(t => ({
      symbol: t.symbol,
      direction: t.direction,
      entry_time: t.entry_time,
      exit_time: t.exit_time,
      exit_reason: t.exit_reason,
      R_multiple: t.R_multiple ?? 0,
    }));

    return {
      hypothesis,
      report: summary,
      risk: {
        longest_losing_streak: risk.longest_losing_streak ?? 0,
        longest_winning_streak: risk.longest_winning_streak ?? 0,
        avg_losing_streak: risk.avg_losing_streak ?? 0,
        max_drawdown_R: risk.max_drawdown_R ?? 0,
        time_under_water_bars: risk.time_under_water_bars ?? 0,
      },
      trades_sample: sample,
      per_symbol_stats: perSymbol,
      exit_reason_breakdown: exitMap,
    };
  } catch (err: any) {
    console.error(`[buildReflectionInput] Exception:`, err.message, err.stack?.split('\n')[1]);
    return null;
  }
}

// ─── Promotion ────────────────────────────────────────────────────────────────

async function promoteToTier2(
  session: ResearchSession,
  entry: GenomeEntry,
): Promise<void> {
  emit(session.session_id, 'promoted', {
    generation: entry.generation,
    strategy_version_id: entry.strategy_version_id,
    fitness_score: entry.fitness_score,
  });

  try {
    await fetch(`${API_BASE}/validator/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy_version_id: entry.strategy_version_id,
        tier: 'tier2',
        interval: session.config.target_interval,
      }),
    });
  } catch {}
}

async function promoteSrEntryToTier1(
  session: ResearchSession,
  entry: GenomeEntry,
): Promise<boolean> {
  const strategyVersionId = await ensureSrStrategyForEntry(session, entry);
  if (!strategyVersionId) return false;

  emit(session.session_id, 'promoted', {
    generation: entry.generation,
    strategy_version_id: strategyVersionId,
    fitness_score: entry.fitness_score,
    validation_tier: 'tier1',
  });

  try {
    await fetch(`${API_BASE}/validator/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy_version_id: strategyVersionId,
        tier: 'tier1',
        interval: String(session.config.sr_config?.interval || session.config.target_interval || '1d'),
      }),
    });
  } catch {}
  return true;
}

// ─── SR session loop (mode === symbolic_regression) ───────────────────────────

async function runSrSessionLoop(session: ResearchSession): Promise<void> {
  const { spawn } = await import('child_process');
  const backendDir = path.join(__dirname, '..', '..');
  const scriptPath = path.join(backendDir, 'scripts', 'run_sr_research.py');
  const sr = session.config.sr_config!;

  try {
    for (let gen = 1; gen <= session.max_generations && session.status === 'running'; gen++) {
      session.generation = gen;
      emit(session.session_id, 'generation_start', { generation: gen, max: session.max_generations });
      session.current_hypothesis = `Running symbolic regression ${gen}/${session.max_generations}...`;
      await saveState(session);
      emit(session.session_id, 'status', { message: session.current_hypothesis });

      const args = [
        scriptPath,
        '--symbol', sr.symbol,
        '--interval', sr.interval,
        '--years', String(sr.years ?? 2),
        '--target_bars', String(sr.target_bars ?? 5),
        '--population_size', String(sr.population_size ?? 500),
        '--generations', String(sr.generations ?? 20),
      ];
      if (sr.features && sr.features.length > 0) {
        args.push('--features', JSON.stringify(sr.features));
      }

      const result = await new Promise<{ success: boolean; formula_id?: string; formula?: string; formula_readable?: string; complexity?: number; fitness?: number; n_samples?: number; error?: string }>((resolve, reject) => {
        const proc = spawn('py', args, { cwd: backendDir, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
          try {
            const line = stdout.trim().split('\n').pop() || '';
            const parsed = JSON.parse(line);
            resolve(parsed);
          } catch {
            resolve({ success: false, error: stderr || stdout || `Script exit ${code}` });
          }
        });
      });

      const verdict = result.success ? 'kept' : 'discarded';
      const entry: GenomeEntry = {
        generation: gen,
        strategy_version_id: `sr_gen_${gen}`,
        hypothesis: result.success ? (result.formula_readable || result.formula || 'SR formula') : (result.error || 'SR run failed'),
        spec_summary: result.formula_readable || result.formula || '—',
        new_plugins_created: [],
        report_summary: null,
        fitness_score: result.fitness ?? 0,
        verdict: verdict as GenomeEntry['verdict'],
        created_at: new Date().toISOString(),
        formula_id: result.formula_id,
        formula: result.formula,
        formula_readable: result.formula_readable,
        complexity: result.complexity,
      };

      if (result.success && result.formula_id) {
        try {
          await ensureSrStrategyForEntry(session, entry);
        } catch (err: any) {
          console.warn(`[ResearchAgent] Failed to persist SR strategy for gen ${gen}: ${err.message}`);
        }
      }

      session.genome.push(entry);
      await appendGenome(session.session_id, entry);
      if (!session.best || (result.fitness ?? 0) > (session.best.fitness_score ?? 0)) {
        session.best = entry;
      }
      emit(session.session_id, 'generation_complete', entry);
      await saveState(session);
    }

    if (session.status === 'running') {
      session.status = 'completed';
    }
  } catch (err: any) {
    session.status = 'error';
    session.error = err.message;
    emit(session.session_id, 'error', { error: err.message });
  } finally {
    session.current_hypothesis = undefined;
    session.current_job_id = undefined;
    await saveState(session);
    emit(session.session_id, 'session_end', { status: session.status });

    if (session.status === 'completed') {
      try {
        const { runFormulaRanking } = await import('./formulaRankingEngine');
        const sr = session.config.sr_config;
        runFormulaRanking({
          symbol: sr?.symbol || 'SPY',
          interval: sr?.interval || '1d',
          force: false,
        }).catch((e: any) => console.warn(`[ResearchAgent] Auto-ranking failed: ${e.message}`));
      } catch (e: any) {
        console.warn(`[ResearchAgent] Could not start auto-ranking: ${e.message}`);
      }
    }
  }
}

// ─── Main session loop ────────────────────────────────────────────────────────

async function runSessionLoop(session: ResearchSession): Promise<void> {
  if (session.config.mode === 'symbolic_regression') {
    await runSrSessionLoop(session);
    return;
  }

  try {
    while (
      session.status === 'running' &&
      session.generation < session.max_generations
    ) {
      const gen = session.generation + 1;
      session.generation = gen;

      emit(session.session_id, 'generation_start', {
        generation: gen,
        max: session.max_generations,
      });

      // ── Step 1: Generate hypothesis ─────────────────────────────────────
      let hypothesis: Awaited<ReturnType<typeof generateHypothesis>>;
      try {
        session.current_hypothesis = `Generating hypothesis ${gen}/${session.max_generations}...`;
        await saveState(session);
        emit(session.session_id, 'status', { message: session.current_hypothesis });

        // Pull suggested params: from genome entries first, then fall back to session config seed
        const lastWithParams = [...session.genome].reverse().find(e => e.suggested_params);
        const forcedParams = lastWithParams?.suggested_params
          ?? (session.genome.length === 0 ? session.config.forced_params : undefined);
        if (forcedParams) {
          const source = lastWithParams ? `gen ${lastWithParams.generation}` : 'session config';
          console.log(`[ResearchAgent] Gen ${gen}: injecting mandated params from ${source}:`, forcedParams);
        }

        hypothesis = await generateHypothesis(
          session.config.name,
          session.genome,
          session.config.seed_hypothesis,
          session.config.allow_new_primitives ?? false,
          session.config.hypothesis_model,
          forcedParams,
          session.config.risk_defaults,
        );

        session.current_hypothesis = hypothesis.hypothesis;
        emit(session.session_id, 'hypothesis', {
          generation: gen,
          hypothesis: hypothesis.hypothesis,
          rationale: hypothesis.rationale,
        });
      } catch (err: any) {
        console.error(`[ResearchAgent] Gen ${gen} hypothesis step failed:`, err.stack || err.message);
        emit(session.session_id, 'error', { generation: gen, error: err.message });
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // ── Step 2: Build new plugins if needed ─────────────────────────────
      const createdPlugins: string[] = [];
      for (const pluginSpec of hypothesis.new_primitives_needed || []) {
        if (session.status !== 'running') break;
        try {
          emit(session.session_id, 'status', { message: `Building plugin: ${pluginSpec.pattern_id}` });
          const generated = await generatePlugin(pluginSpec);

          const pyPath = path.join(PLUGINS_DIR, 'research', `${generated.pattern_id}.py`);

          // Validate syntax before registering
          const valid = await validatePluginSyntax(pyPath, generated.python_code);
          if (!valid) {
            emit(session.session_id, 'warning', {
              message: `Plugin ${generated.pattern_id} failed syntax check — skipping`,
            });
            continue;
          }

          await registerGeneratedPlugin(generated, PLUGINS_DIR, REGISTRY_PATH);
          createdPlugins.push(generated.pattern_id);
          emit(session.session_id, 'plugin_created', { pattern_id: generated.pattern_id });
        } catch (err: any) {
          emit(session.session_id, 'warning', {
            message: `Failed to create plugin: ${err.message}`,
          });
        }
      }

      if (session.status !== 'running') break;

      // ── Step 3: Stamp spec and register ─────────────────────────────────
      const specBase = hypothesis.spec_json;
      const specId = `research_${session.session_id.slice(0, 8)}_gen${gen}`;
      const stratVersionId = `${specId}_v1`;
      const spec = {
        ...specBase,
        strategy_id: specId,
        strategy_version_id: stratVersionId,
        version: 1,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: 'research_agent',
        interval: specBase.interval || session.config.target_interval,
        asset_class: specBase.asset_class || session.config.target_asset_class || 'stocks',
      };

      try {
        await registerStrategy(spec);
      } catch (err: any) {
        emit(session.session_id, 'error', {
          generation: gen,
          error: `Failed to register strategy: ${err.message}`,
        });
        continue;
      }

      // ── Step 4: Run Tier-1 backtest ──────────────────────────────────────
      let jobId: string;
      try {
        emit(session.session_id, 'status', { message: `Starting Tier-1 backtest (gen ${gen})...` });
        jobId = await startValidatorJob(stratVersionId, spec.interval, session);
        session.current_job_id = jobId;
        await saveState(session);
        emit(session.session_id, 'backtest_started', { generation: gen, job_id: jobId });
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        console.error(`[research] Gen ${gen} backtest start failed: ${errMsg}`);
        emit(session.session_id, 'error', { generation: gen, error: errMsg });
        const entry: GenomeEntry = buildGenomeEntry(gen, stratVersionId, hypothesis, createdPlugins, null, 'backtest_failed');
        session.genome.push(entry);
        await appendGenome(session.session_id, entry);
        emit(session.session_id, 'generation_complete', entry);
        continue;
      }

      const result = await pollValidatorJob(
        jobId,
        session.session_id,
        (stage, detail, pct) => {
          emit(session.session_id, 'backtest_progress', { generation: gen, stage, detail, pct });
        },
      );

      if (session.status !== 'running') break;

      // ── Step 5: Evaluate ─────────────────────────────────────────────────
      let reportSummary: ReportSummary | null = null;
      let fitness = 0;
      if (result?.report_id) {
        reportSummary = await fetchReport(result.report_id);
        if (reportSummary) fitness = computeFitnessScore(reportSummary);
      }

      const shouldPromote =
        fitness >= session.config.promotion_min_fitness &&
        (!session.config.promotion_requires_pass || reportSummary?.pass_fail === 'PASS');

      // ── Gate: discard strategies that don't meet minimum viability ───────
      const gate = passesGate(reportSummary);

      const verdict = !reportSummary
        ? 'backtest_failed'
        : !gate.pass
          ? 'discarded'
          : shouldPromote
            ? 'promoted'
            : fitness >= 0.4
              ? 'kept'
              : 'discarded';

      const entry = buildGenomeEntry(gen, stratVersionId, hypothesis, createdPlugins, reportSummary, verdict as GenomeEntry['verdict'], fitness);
      if (result?.report_id) entry.report_id = result.report_id;

      // If the strategy failed the gate, log a tombstone (keep the strategy file so Research can show spec and params for inspection / sweep)
      if (!gate.pass) {
        await logTombstone({
          strategy_version_id: stratVersionId,
          name: (spec as any).name || stratVersionId,
          hypothesis: hypothesis.hypothesis,
          expectancy_R: reportSummary?.expectancy_R ?? 0,
          total_trades: reportSummary?.total_trades ?? 0,
          profit_factor: reportSummary?.profit_factor ?? 0,
          reason: gate.reason,
          discarded_at: new Date().toISOString(),
        });
        emit(session.session_id, 'gate_failed', {
          generation: gen,
          reason: gate.reason,
          expectancy_R: reportSummary?.expectancy_R ?? 0,
          total_trades: reportSummary?.total_trades ?? 0,
        });
        console.log(`[ResearchAgent] Gen ${gen} GATE FAIL: ${gate.reason} — strategy file kept for Research/Sweep inspection`);
      }

      // ── Step 5b: Reflection — AI forensic analysis of backtest ────────────
      if (reportSummary && result?.report_id) {
        try {
          emit(session.session_id, 'reflecting', { generation: gen });
          const reflectionInput = await buildReflectionInput(
            hypothesis.hypothesis,
            reportSummary,
            result.report_id,
          );
          if (reflectionInput) {
            const reflectResult = await reflectOnBacktest(reflectionInput, session.config.reflection_model);
            if (reflectResult?.reflection) {
              entry.reflection = reflectResult.reflection;
              if (reflectResult.param_changes) {
                entry.suggested_params = reflectResult.param_changes;
                console.log(`[ResearchAgent] Gen ${gen} reflection extracted params:`, reflectResult.param_changes);
              }
              emit(session.session_id, 'reflection_complete', {
                generation: gen,
                reflection: reflectResult.reflection,
                param_changes: reflectResult.param_changes,
              });
            }
          }
        } catch (err: any) {
          emit(session.session_id, 'reflection_error', { generation: gen, error: err.message });
        }
      }

      session.genome.push(entry);
      await appendGenome(session.session_id, entry);

      if (!session.best || fitness > session.best.fitness_score) {
        session.best = entry;
      }

      emit(session.session_id, 'generation_complete', entry);
      await saveState(session);

      if (shouldPromote) {
        await promoteToTier2(session, entry);
      }
    }

    if (session.status === 'running') {
      session.status = 'completed';
    }
  } catch (err: any) {
    session.status = 'error';
    session.error = err.message;
    emit(session.session_id, 'error', { error: err.message });
  } finally {
    session.current_hypothesis = undefined;
    session.current_job_id = undefined;
    await saveState(session);
    emit(session.session_id, 'session_end', { status: session.status });
  }
}

function buildGenomeEntry(
  gen: number,
  stratVersionId: string,
  hypothesis: { hypothesis: string; spec_json: Record<string, any> },
  createdPlugins: string[],
  reportSummary: ReportSummary | null,
  verdict: GenomeEntry['verdict'],
  fitness = 0,
): GenomeEntry {
  const stages: any[] = hypothesis.spec_json?.setup_config?.composite_spec?.stages || [];
  const stageIds = stages.map((s: any) => s.pattern_id || s.id).join(' → ');
  return {
    generation: gen,
    strategy_version_id: stratVersionId,
    hypothesis: hypothesis.hypothesis,
    spec_summary: stageIds || 'custom',
    new_plugins_created: createdPlugins,
    report_summary: reportSummary,
    fitness_score: fitness,
    verdict,
    created_at: new Date().toISOString(),
  };
}

// ─── Plugin syntax validation ─────────────────────────────────────────────────

async function validatePluginSyntax(pyPath: string, code: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(pyPath), { recursive: true });
    await fs.writeFile(pyPath, code, 'utf-8');
    const { execSync } = await import('child_process');
    execSync(`py -c "import ast; ast.parse(open(r'${pyPath}').read())"`, { stdio: 'pipe' });
    return true;
  } catch {
    try { await fs.unlink(pyPath); } catch {}
    return false;
  }
}

function sanitizeIdFragment(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'sr_formula';
}

function toFiniteNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapSrRiskDefaults(riskDefaults?: Record<string, any>): StrategySpec['risk_config'] {
  const stopTypeRaw = String(riskDefaults?.defaultStopType || 'atr_multiple').toLowerCase();
  const usePercentStop = stopTypeRaw.includes('pct') || stopTypeRaw.includes('percent');
  const stopValue = toFiniteNumber(riskDefaults?.defaultStopValue, usePercentStop ? 0.08 : 2.0);
  const riskPercent = toFiniteNumber(riskDefaults?.riskPercent, 1.0);
  return {
    stop_type: usePercentStop ? 'percentage' : 'atr',
    stop_value: usePercentStop ? stopValue : undefined,
    atr_multiplier: usePercentStop ? undefined : stopValue,
    take_profit_R: toFiniteNumber(riskDefaults?.defaultTakeProfitR, 2.0),
    max_hold_bars: Math.max(1, Math.round(toFiniteNumber(riskDefaults?.defaultMaxHold, 20))),
    risk_per_trade_pct: Math.max(0.001, riskPercent / 100),
  };
}

function buildSrStrategySpec(session: ResearchSession, entry: GenomeEntry): StrategySpec | null {
  const formulaId = String(entry.formula_id || '').trim();
  if (!formulaId) return null;

  const sr = session.config.sr_config || {};
  const strategyId = `sr_formula_${sanitizeIdFragment(formulaId)}`;
  const strategyVersionId = `${strategyId}_v1`;
  const targetBars = Math.max(1, Math.round(toFiniteNumber(sr.target_bars, 5)));
  const formulaPreview = String(entry.formula_readable || entry.formula || 'SR formula').slice(0, 240);
  const interval = String(sr.interval || session.config.target_interval || '1d');

  return {
    strategy_id: strategyId,
    version: 1,
    strategy_version_id: strategyVersionId,
    status: 'testing',
    asset_class: (session.config.target_asset_class as StrategySpec['asset_class']) || 'stocks',
    name: `${session.config.name} Gen ${entry.generation} Formula`,
    description: `Persisted symbolic-regression formula ${formulaId}. Predicts ${targetBars}-bar ATR-normalized forward return and enters when prediction >= threshold. Formula: ${formulaPreview}`,
    interval,
    timeframe: interval,
    scan_mode: 'strategy',
    trade_direction: 'long',
    universe: [],
    setup_config: {
      pattern_type: 'sr_score',
      formula_id: formulaId,
      score_threshold: 0.0,
    },
    risk_config: mapSrRiskDefaults(session.config.risk_defaults),
    cost_config: {
      commission_per_trade: 1,
      slippage_pct: 0.05,
    },
    backtest_config: {
      min_history_bars: 60,
      signal_source: 'strategy',
      direction: 'long',
    },
    parameter_manifest: [
      {
        key: 'score_threshold',
        label: 'Predicted Return Threshold',
        path: 'setup_config.score_threshold',
        anatomy: 'entry_timing',
        type: 'float',
        description: 'Minimum predicted ATR-normalized forward return required to emit entry_ready.',
        identity_preserving: true,
        sweep_enabled: true,
        sensitivity_enabled: true,
        suggested_values: [-0.25, 0, 0.1, 0.25, 0.5],
        min: -3,
        max: 3,
        step: 0.05,
        priority: 90,
        failure_modes_targeted: ['negative_expectancy', 'oos_degradation'],
      },
      {
        key: 'atr_multiplier',
        label: 'ATR Stop Multiplier',
        path: 'risk_config.atr_multiplier',
        anatomy: 'stop_loss',
        type: 'float',
        identity_preserving: true,
        sweep_enabled: true,
        sensitivity_enabled: true,
        suggested_values: [1.0, 1.5, 2.0, 2.5, 3.0],
        min: 0.5,
        max: 5,
        step: 0.25,
        priority: 70,
      },
      {
        key: 'take_profit_R',
        label: 'Take Profit R',
        path: 'risk_config.take_profit_R',
        anatomy: 'take_profit',
        type: 'float',
        identity_preserving: true,
        sweep_enabled: true,
        sensitivity_enabled: true,
        suggested_values: [1.0, 1.5, 2.0, 2.5, 3.0],
        min: 0.5,
        max: 10,
        step: 0.25,
        priority: 65,
      },
      {
        key: 'max_hold_bars',
        label: 'Max Hold Bars',
        path: 'risk_config.max_hold_bars',
        anatomy: 'risk_controls',
        type: 'int',
        identity_preserving: true,
        sweep_enabled: true,
        sensitivity_enabled: true,
        suggested_values: [5, 10, 15, 20, 30],
        min: 1,
        max: 120,
        step: 1,
        priority: 50,
      },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: 'research_agent',
    notes: `formula_id=${formulaId}`,
  };
}

async function ensureSrStrategyForEntry(session: ResearchSession, entry: GenomeEntry): Promise<string | null> {
  if (!entry.formula_id) return null;
  if (entry.strategy_version_id && !/^sr_gen_\d+$/i.test(String(entry.strategy_version_id))) {
    return entry.strategy_version_id;
  }
  const spec = buildSrStrategySpec(session, entry);
  if (!spec) return null;
  const savedId = await saveStrategy(spec);
  entry.strategy_version_id = savedId;
  return savedId;
}

const LEGACY_CONTINUED_SUFFIX_RE = /(\s*\(continued\))+$/i;
const SESSION_VERSION_SUFFIX_RE = /\s+V(\d+)$/i;

function stripLegacyContinuedSuffix(name: string): string {
  return String(name || '').replace(LEGACY_CONTINUED_SUFFIX_RE, '').trim();
}

function parseSessionDisplayName(name: string): { baseName: string; version: number | null } {
  const cleaned = stripLegacyContinuedSuffix(name) || 'Untitled session';
  const match = cleaned.match(SESSION_VERSION_SUFFIX_RE);
  if (!match || match.index == null) {
    return { baseName: cleaned, version: null };
  }
  const version = Number.parseInt(match[1], 10);
  return {
    baseName: cleaned.slice(0, match.index).trim() || 'Untitled session',
    version: Number.isFinite(version) && version > 0 ? version : null,
  };
}

function formatSessionDisplayName(baseName: string, version: number): string {
  const safeBaseName = stripLegacyContinuedSuffix(baseName) || 'Untitled session';
  const safeVersion = Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
  return `${safeBaseName} V${safeVersion}`;
}

function getSessionRootId(session: ResearchSession): string {
  let current: ResearchSession | undefined = session;
  const seen = new Set<string>();
  while (current?.config?.continued_from && !seen.has(current.session_id)) {
    seen.add(current.session_id);
    const parent = sessions.get(current.config.continued_from);
    if (!parent) break;
    current = parent;
  }
  return current?.session_id || session.session_id;
}

function getLineageSessions(rootId: string): ResearchSession[] {
  return [...sessions.values()]
    .filter((session) => getSessionRootId(session) === rootId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function getCanonicalSessionName(config: ResearchSessionConfig): string {
  if (config.continued_from) {
    const source = sessions.get(config.continued_from);
    if (source) {
      const rootId = getSessionRootId(source);
      const root = sessions.get(rootId) || source;
      const { baseName } = parseSessionDisplayName(root.config?.name || config.name);
      const lineage = getLineageSessions(rootId);
      const maxExplicitVersion = lineage.reduce((maxVersion, session) => {
        const parsed = parseSessionDisplayName(session.config?.name || '');
        return parsed.version ? Math.max(maxVersion, parsed.version) : maxVersion;
      }, 0);
      const nextVersion = Math.max(maxExplicitVersion, lineage.length) + 1;
      return formatSessionDisplayName(baseName, nextVersion);
    }
  }

  const { baseName } = parseSessionDisplayName(config.name);
  return formatSessionDisplayName(baseName, 1);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createSession(config: ResearchSessionConfig): Promise<ResearchSession> {
  await loadAllSessions();
  const canonicalName = getCanonicalSessionName(config);

  const session: ResearchSession = {
    session_id: uuidv4(),
    status: 'running',
    generation: 0,
    max_generations: Math.max(1, Math.min(config.max_generations, 50)),
    genome: [],
    best: null,
    config: {
      ...config,
      name: canonicalName,
      promotion_min_fitness: config.promotion_min_fitness ?? 0.6,
      promotion_requires_pass: config.promotion_requires_pass ?? true,
      allow_new_primitives: config.allow_new_primitives ?? false,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  sessions.set(session.session_id, session);
  await saveState(session);

  // Run loop in background
  setImmediate(() => runSessionLoop(session));

  return session;
}

/** Create a new session continuing from a completed one, inheriting its last mandated params. */
export async function continueSession(
  sourceId: string,
  overrides?: Partial<ResearchSessionConfig>,
): Promise<ResearchSession | null> {
  await loadAllSessions();
  const source = sessions.get(sourceId);
  if (!source) return null;

  // Get the most recent mandated params from the source genome
  const lastWithParams = [...source.genome].reverse().find(e => e.suggested_params);
  const forced_params = lastWithParams?.suggested_params ?? undefined;
  const nextName = getCanonicalSessionName({
    ...source.config,
    ...overrides,
    name: source.config.name,
    continued_from: sourceId,
  } as ResearchSessionConfig);

  const config: ResearchSessionConfig = {
    ...source.config,
    ...overrides,
    name: nextName,
    forced_params,
    continued_from: sourceId,
  };

  return createSession(config);
}

export async function stopSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.status !== 'running') return false;

  session.status = 'stopped';

  if (session.current_job_id) {
    try {
      await fetch(`${API_BASE}/validator/run/${session.current_job_id}/cancel`, {
        method: 'POST',
      });
    } catch {}
    session.current_job_id = undefined;
  }

  await saveState(session);
  emit(sessionId, 'status', { message: 'Session stopped by user' });
  return true;
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.status === 'running') return false;

  sessions.delete(sessionId);
  sseListeners.delete(sessionId);

  const dir = path.join(RESEARCH_DIR, sessionId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {}
  return true;
}

export async function archiveSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.status === 'running') return false;

  session.archived = true;
  await saveState(session);
  return true;
}

export async function unarchiveSession(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.archived = false;
  await saveState(session);
  return true;
}

export async function promoteManually(sessionId: string, generation: number): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;

  const entry = session.genome.find(e => e.generation === generation);
  if (!entry) return false;

  entry.verdict = 'promoted';
  await saveState(session);

  if (entry.formula_id || entry.formula || entry.formula_readable) {
    const promoted = await promoteSrEntryToTier1(session, entry);
    if (!promoted) {
      entry.verdict = 'kept';
      await saveState(session);
    }
    return promoted;
  }

  if (entry.report_summary) {
    await promoteToTier2(session, entry);
  }
  return true;
}

export async function regenerateReflection(
  sessionId: string,
  generation: number,
  modelOverride?: string,
): Promise<{ reflection: string; param_changes: Record<string, any> | null } | null> {
  const session = sessions.get(sessionId);
  if (!session) {
    console.warn(`[RegenReflect] Session ${sessionId} not found in memory. Known sessions: [${Array.from(sessions.keys()).join(', ')}]`);
    return null;
  }

  const entry = session.genome.find(e => e.generation === generation);
  if (!entry || !entry.report_summary) {
    console.warn(`[RegenReflect] Gen ${generation} not found or missing report_summary. Genome gens: [${session.genome.map(e => e.generation).join(', ')}]`);
    return null;
  }

  let reportId = entry.report_id;

  if (!reportId && entry.strategy_version_id) {
    try {
      const reports = await getAllValidationReports(entry.strategy_version_id);
      if (reports.length > 0) {
        reportId = reports[0].report_id;
        entry.report_id = reportId;
      }
    } catch (err: any) {
      console.warn(`[RegenReflect] Failed to look up reports for ${entry.strategy_version_id}: ${err.message}`);
    }
  }

  if (!reportId) {
    console.warn(`[RegenReflect] No report_id found for gen ${generation}`);
    return null;
  }

  const reflectionInput = await buildReflectionInput(
    entry.hypothesis,
    entry.report_summary,
    reportId,
  );
  if (!reflectionInput) {
    console.warn(`[RegenReflect] buildReflectionInput returned null for report ${reportId}`);
    return null;
  }

  const reflectResult = await reflectOnBacktest(reflectionInput, modelOverride);
  if (!reflectResult?.reflection) {
    console.warn(`[RegenReflect] reflectOnBacktest returned empty for gen ${generation}`);
    return null;
  }

  entry.reflection = reflectResult.reflection;
  if (reflectResult.param_changes) {
    entry.suggested_params = reflectResult.param_changes;
    console.log(`[RegenReflect] Gen ${generation} extracted params:`, reflectResult.param_changes);
  }
  await saveState(session);
  return { reflection: reflectResult.reflection, param_changes: reflectResult.param_changes };
}
