/**
 * Strategy Generation Service
 *
 * Uses GPT-4o to autonomously generate trading strategy hypotheses,
 * produce composite strategy specs from existing primitives, and
 * optionally write new plugin code when no existing primitive fits.
 */

import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';
import { applyRolePromptOverride, getConfiguredOpenAIKey } from './aiSettings';

const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4o';

// ─── Available primitives catalogue ──────────────────────────────────────────

export const AVAILABLE_PRIMITIVES = [
  {
    pattern_id: 'rdp_swing_structure',
    name: 'RDP Pivots',
    description: 'Detects swing highs/lows using Ramer-Douglas-Peucker simplification. Output port: swing_structure (peaks, lows, trend direction). Use as the structural backbone of most strategies.',
    output_ports: ['swing_structure', 'active_leg', 'pullback_range'],
    indicator_role: 'anchor_structure',
  },
  {
    pattern_id: 'impulse_trough_primitive',
    name: 'Impulse Trough',
    description: 'Identifies a prior impulse leg followed by a pullback trough. Output port: impulse_leg (high/low of the move). Feed into fib_location_primitive via the "leg" input port.',
    output_ports: ['impulse_leg'],
    input_ports: ['swing_structure'],
    indicator_role: 'setup_detector',
  },
  {
    pattern_id: 'fib_location_primitive',
    name: 'Fibonacci Location',
    description: 'Checks whether current price is inside a Fibonacci retracement zone (default 0.618–0.786). Requires an "leg" input port from impulse_trough_primitive.',
    output_ports: ['fib_zone'],
    input_ports: ['leg'],
    indicator_role: 'entry_zone',
  },
  {
    pattern_id: 'rsi_primitive',
    name: 'RSI Signal',
    description: 'RSI oscillator — fires when RSI is oversold (default <30) or overbought (>70). Tunable: period, oversold_level, overbought_level.',
    output_ports: ['rsi_signal'],
    indicator_role: 'momentum_filter',
  },
  {
    pattern_id: 'macd_primitive',
    name: 'MACD Signal',
    description: 'MACD histogram crossover signal. Detects bullish/bearish crossovers of signal line. Tunable: fast, slow, signal periods.',
    output_ports: ['macd_signal'],
    indicator_role: 'momentum_filter',
  },
  {
    pattern_id: 'energy_state_primitive',
    name: 'Energy State',
    description: 'Measures price energy (momentum × volume proxy). Returns high/low/neutral energy states. Useful for confirming breakout conviction.',
    output_ports: ['energy_state'],
    indicator_role: 'context_filter',
  },
  {
    pattern_id: 'ma_crossover',
    name: 'Moving Average Crossover',
    description: 'Detects fast MA crossing above slow MA. Tunable: fast_period, slow_period, ma_type.',
    output_ports: ['ma_signal'],
    indicator_role: 'trend_filter',
  },
  {
    pattern_id: 'fib_signal_trigger_primitive',
    name: 'Fibonacci Signal Trigger',
    description: 'Generates entry signals when price bounces off a key Fibonacci level with confirmation. Combines Fib zone + price action.',
    output_ports: ['fib_trigger'],
    indicator_role: 'timing_trigger',
  },
  {
    pattern_id: 'rdp_energy_swing_detector_v1_primitive',
    name: 'RDP Energy Swing Detector',
    description: 'Combines RDP swing detection with energy state confirmation. Fires when a swing point coincides with high energy.',
    output_ports: ['swing_energy_signal'],
    indicator_role: 'timing_trigger',
  },
  {
    pattern_id: 'energy_state_primitive',
    name: 'Energy State',
    description: 'Market energy/momentum proxy. Detects accumulation or distribution energy phases.',
    output_ports: ['energy_state'],
    indicator_role: 'context_filter',
  },
  {
    pattern_id: 'regression_channel_primitive',
    name: 'Regression Channel',
    description: 'Fits a linear regression channel to recent price. Signals when price is at channel extremes (oversold below lower band, overbought above upper band).',
    output_ports: ['channel_signal'],
    indicator_role: 'structure_filter',
  },
  {
    pattern_id: 'order_blocks',
    name: 'Order Blocks',
    description: 'Detects institutional order block zones (strong directional candles before a reversal). Price returning to an order block is a high-probability entry.',
    output_ports: ['order_block_zone'],
    indicator_role: 'entry_zone',
  },
  {
    pattern_id: 'fvg',
    name: 'Fair Value Gaps',
    description: 'Detects fair value gaps (imbalance candles). Price filling an FVG acts as a magnet or support/resistance zone.',
    output_ports: ['fvg_zone'],
    indicator_role: 'entry_zone',
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenomeEntry {
  generation: number;
  strategy_version_id: string;
  hypothesis: string;
  spec_summary: string;
  new_plugins_created: string[];
  report_summary: ReportSummary | null;
  report_id?: string;
  fitness_score: number;
  verdict: 'promoted' | 'kept' | 'discarded' | 'backtest_failed' | 'pending';
  reflection?: string;
  suggested_params?: Record<string, any>;
  created_at: string;
  /** Symbolic regression: formula string (LISP-style from gplearn) */
  formula?: string;
  /** Symbolic regression: human-readable formula (feature names substituted) */
  formula_readable?: string;
  /** Symbolic regression: persisted artifact ID */
  formula_id?: string;
  /** Symbolic regression: complexity (program length) */
  complexity?: number;
}

export interface ReportSummary {
  total_trades: number;
  win_rate: number;
  expectancy_R: number;
  profit_factor: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  oos_degradation_pct: number;
  pass_fail: string;
}

export interface NewPluginSpec {
  pattern_id: string;
  name: string;
  description: string;
  indicator_role: string;
  tunable_params: Array<{ key: string; label: string; type: string; default: any }>;
}

export interface GeneratedHypothesis {
  hypothesis: string;
  rationale: string;
  spec_json: Record<string, any>;
  new_primitives_needed: NewPluginSpec[];
}

export interface GeneratedPlugin {
  pattern_id: string;
  python_code: string;
  definition_json: Record<string, any>;
}

// ─── Fitness score ────────────────────────────────────────────────────────────

export function computeFitnessScore(report: ReportSummary): number {
  if (report.total_trades < 200) return 0;

  // Hard penalty: drawdown above 30% tanks the score
  const dd = report.max_drawdown_pct ?? 100;
  const ddPenalty = dd <= 30 ? 1.0 : Math.max(0, 1 - (dd - 30) / 70);

  const expectancyComponent = Math.max(0, Math.min(report.expectancy_R, 2)) * 0.40;
  const winRateComponent = Math.max(0, Math.min(report.win_rate, 1)) * 0.20;
  const sharpeComponent = Math.max(0, Math.min(report.sharpe_ratio / 3.0, 1)) * 0.20;
  const robustnessComponent = Math.max(0, 1 - report.oos_degradation_pct / 100) * 0.20;
  const raw = expectancyComponent + winRateComponent + sharpeComponent + robustnessComponent;
  return Math.round((raw * ddPenalty) * 1000) / 1000;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildIdeationSystemPrompt(allowNewPrimitives: boolean, primitives: typeof AVAILABLE_PRIMITIVES = AVAILABLE_PRIMITIVES): string {
  const primitivesText = primitives.map(p =>
    `- **${p.pattern_id}** (${p.name}): ${p.description}`
  ).join('\n');

  const primitiveCreationSection = allowNewPrimitives
    ? `
## Primitive Creation — ENABLED
You are STRONGLY ENCOURAGED to invent new primitive plugins when the existing catalogue is insufficient.
A new primitive is appropriate when:
- No existing primitive measures what you need (e.g. volume profile, ATR expansion, candle pattern, divergence)
- You want a bespoke version of an existing concept with different logic
- Combining two existing primitives into a single purpose-built one would be cleaner

When you need a new primitive, add it to new_primitives_needed with:
- A clear, specific pattern_id (e.g. "volume_surge_primitive", "atr_expansion_primitive")
- A precise description of what it detects and what signal it fires
- Tunable params with sensible defaults

Then USE it in your composite_spec stages by its pattern_id.
Do NOT shy away from creating new primitives — this is how the system grows.`
    : `
## Primitive Creation — DISABLED
Only use primitives from the Available Primitives list above. Do NOT add anything to new_primitives_needed.`;

  const prompt = `You are an autonomous quantitative trading strategy researcher. Your job is to generate novel, testable trading strategy hypotheses using available plugin primitives, then evaluate past results to improve.

## Available Primitives
${primitivesText}
${primitiveCreationSection}

## Composite Spec Format
Strategies are JSON objects with this shape:
\`\`\`json
{
  "strategy_id": "my_strategy_name",
  "name": "Human Readable Name",
  "description": "What this strategy looks for",
  "interval": "1wk",
  "trade_direction": "long",
  "universe": [],
  "setup_config": {
    "pattern_type": "my_strategy_name",
    "composite_spec": {
      "intent": "entry",
      "mode": "pipeline",
      "stages": [
        { "id": "node_0", "pattern_id": "rdp_swing_structure", "params": {} },
        { "id": "node_1", "pattern_id": "impulse_trough_primitive", "params": {} }
      ],
      "edges": [
        { "from": "node_1", "from_port": "impulse_leg", "to": "node_2", "to_port": "leg" }
      ],
      "reducer": { "op": "AND", "inputs": ["node_0", "node_1"] }
    }
  },
  "risk_config": { "stop_type": "swing_low", "take_profit_R": 2.0, "max_hold_bars": 26 },
  "costs": { "commission_per_trade": 5.0, "slippage_pct": 0.001 },
  "backtest_config": { "min_history_bars": 60, "signal_source": "composite" }
}
\`\`\`

## Risk Config — CRITICAL: You MUST vary these between generations
The risk_config block controls stops, targets, and position management. These are the PRIMARY levers for improving performance:
\`\`\`json
"risk_config": {
  "stop_type": "atr",           // Options: "atr", "swing_low", "fixed_pct", "base_floor"
  "atr_multiplier": 1.5,        // ATR stop distance (only when stop_type="atr"). Try: 1.0, 1.5, 2.0, 2.5, 3.0
  "fixed_stop_pct": 0.05,       // Fixed % stop (only when stop_type="fixed_pct"). Try: 0.03, 0.05, 0.08, 0.10
  "take_profit_R": 2.0,         // Target as multiple of risk. Try: 1.5, 2.0, 2.5, 3.0
  "max_hold_bars": 26,          // Max bars before forced exit. Try: 10, 15, 20, 26, 52
  "risk_per_trade_pct": 0.01    // Capital risked per trade. Try: 0.005, 0.01, 0.015, 0.02
}
\`\`\`

### Stop Type Guide
- **"atr"** — Adaptive stop based on Average True Range. Best for volatile instruments. Use atr_multiplier to control distance.
- **"swing_low"** — Stop at the prior swing low. Good for trend-following but can be too wide on small caps.
- **"fixed_pct"** — Fixed percentage below entry. Simple but ignores volatility.
- **"base_floor"** — Stop at the base floor. WARNING: Creates massive stop distances on small caps (30-50% from entry), making 1R huge and targets unreachable. Avoid unless strategy specifically requires it.

### Parameter Variation Rules
- If previous generation had too-wide stops (R-multiples worse than -5R on individual trades), switch to "atr" with a tighter multiplier
- If previous generation had too many stop-outs, either widen the stop OR change stop_type
- If take_profit was rarely hit, lower the R target
- If max_hold exits dominate, the strategy is too selective or entries are poorly timed — increase max_hold or change entry logic
- ALWAYS change at least one parameter from the previous generation's risk_config

## Rules
- Only use primitives from the Available Primitives list (or declare new ones in new_primitives_needed)
- The reducer must list all stage IDs as inputs using "op": "AND" or "op": "OR"
- Edges connect output ports to input ports between stages
- interval must be one of: "1wk", "1d", "4h", "1h"
- trade_direction must be "long" or "short"
- Be creative — try different combinations, timeframes, and parameter values
- Learn from past failures (low trades = entry too selective; low expectancy = bad R:R)
- VARY PARAMETERS between generations. Do NOT repeat the same risk_config. Change stop_type, atr_multiplier, take_profit_R, or max_hold_bars.

## Response Format
Return ONLY valid JSON with this exact structure:
\`\`\`json
{
  "hypothesis": "Plain English description of what market inefficiency this exploits",
  "rationale": "Why you expect this to work and how it differs from previous attempts",
  "spec_json": { ... complete strategy spec ... },
  "new_primitives_needed": []
}
\`\`\`
If a new primitive is needed that doesn't exist, add it to new_primitives_needed with: { "pattern_id", "name", "description", "indicator_role", "tunable_params" }`;
  return applyRolePromptOverride('research_strategist', prompt);
}

function buildIdeationUserPrompt(
  seedHypothesis: string | undefined,
  history: GenomeEntry[],
  sessionName: string,
  forcedParams?: Record<string, any>,
): string {
  const historyText = history.length === 0
    ? 'No previous attempts yet — this is the first generation. Use stop_type "atr" with atr_multiplier 2.0 as a starting point.'
    : history.slice(-5).filter(e => e != null).map((e) => {
      let block = `
Generation ${e.generation}: ${e.hypothesis}
  Spec: ${e.spec_summary}
  Result: ${e.report_summary
        ? `${e.report_summary.total_trades} trades, win_rate=${(e.report_summary.win_rate * 100).toFixed(1)}%, expectancy=${e.report_summary.expectancy_R.toFixed(3)}R, Sharpe=${e.report_summary.sharpe_ratio.toFixed(2)}, max_DD=${e.report_summary.max_drawdown_pct.toFixed(1)}%, OOS_deg=${e.report_summary.oos_degradation_pct.toFixed(1)}%, fitness=${e.fitness_score.toFixed(3)}`
        : 'No results (backtest failed)'}
  Verdict: ${e.verdict}`;
      if (e.reflection) {
        block += `\n  AI Reflection: ${e.reflection}`;
      }
      if (e.suggested_params) {
        block += `\n  Mandated params for next gen: ${JSON.stringify(e.suggested_params)}`;
      }
      return block;
    }).join('\n');

  const forcedParamsBlock = forcedParams && Object.keys(forcedParams).length > 0
    ? `\n\n## MANDATORY RISK PARAMETERS — YOU MUST USE THESE EXACTLY
The AI Analyst reviewed the previous backtest and has mandated these risk_config values for this generation.
DO NOT deviate from these parameters unless you have a very strong, explicitly stated reason:
\`\`\`json
${JSON.stringify(forcedParams, null, 2)}
\`\`\`
Copy these values directly into the spec_json.risk_config block.`
    : '';

  return `Research session: "${sessionName}"

Previous attempts:
${historyText}
${forcedParamsBlock}
${seedHypothesis ? `\nResearch direction hint: ${seedHypothesis}\n` : ''}
Generate the next strategy hypothesis. Learn from what worked and what didn't.${
  history.some(e => e.reflection) ? ' Pay close attention to the AI Reflection notes — they contain forensic analysis of trade-level data that should directly inform your parameter choices and structural changes.' : ''
} Be specific about why you expect this to generate at least 200 qualifying trades on a 50-symbol weekly universe over 5 years.

Return valid JSON only.`;
}

function buildPluginEngineerPrompt(pluginSpec: NewPluginSpec): string {
  const prompt = `You are a Python trading plugin engineer. Write a plugin primitive for the Pattern Detector system.

Plugin spec:
- pattern_id: ${pluginSpec.pattern_id}
- name: ${pluginSpec.name}
- description: ${pluginSpec.description}
- indicator_role: ${pluginSpec.indicator_role}
- tunable_params: ${JSON.stringify(pluginSpec.tunable_params, null, 2)}

## Requirements
Import OHLCV from the platform SDK (NEVER from patternScanner):
\`\`\`python
from platform_sdk.ohlcv import OHLCV
\`\`\`

The plugin function signature must be:
\`\`\`python
def run_${pluginSpec.pattern_id}_plugin(data, structure, spec, symbol, timeframe, **kwargs):
    # data: List[OHLCV] with .open, .high, .low, .close, .volume, .timestamp
    # Returns: list of candidate dicts or []
\`\`\`

Each returned candidate must include:
- candidate_id, id, strategy_version_id, spec_hash, symbol, timeframe
- score (0-1), entry_ready (bool), rule_checklist, anchors
- window_start, window_end, created_at, chart_data, pattern_type

## PERFORMANCE RULES (MANDATORY — plugins run thousands of times per backtest)
1. ALWAYS use the compiled indicator library for standard indicators:
\`\`\`python
from platform_sdk.numba_indicators import (
    sma, ema, wma, dema,           # Moving averages
    rsi, macd, stochastic,         # Momentum
    atr, bollinger_bands,          # Volatility
    obv, vwap, volume_ratio,       # Volume
    crossover, crossunder,         # Signal detection — returns index arrays
    threshold_cross_above, threshold_cross_below,
    rolling_max, rolling_min, rolling_std,
)
\`\`\`
2. NEVER use Python for-loops for numeric computation. Use platform_sdk.numba_indicators or vectorized NumPy (np.cumsum, np.where, broadcasting).
3. Extract OHLCV into numpy arrays ONCE at the top: \`closes = np.array([b.close for b in data], dtype=np.float64)\`
4. NEVER do disk I/O, file reads, or network calls inside the plugin function.
5. Python for-loops are ONLY acceptable for building output candidate dicts from pre-computed arrays.
6. Use native Python types in output (float(), int(), bool()), not numpy scalars.
7. Use bar.timestamp for dates, NEVER bar.date. Use bar.close attribute access, NEVER bar['close'].
8. overlay_series MUST contain populated line data — NEVER return empty series. If the plugin computes an indicator, its line data MUST render on the chart.
9. Use vectorized NumPy (np.where, boolean masking) for custom numeric logic — NEVER Python for-loops to compare array elements.

Return ONLY this JSON:
\`\`\`json
{
  "python_code": "...complete plugin code...",
  "definition_json": {
    "pattern_id": "${pluginSpec.pattern_id}",
    "name": "${pluginSpec.name}",
    "category": "indicator_signals",
    "description": "${pluginSpec.description}",
    "author": "research_agent",
    "version": "1.0.0",
    "plugin_file": "plugins/research/${pluginSpec.pattern_id}.py",
    "plugin_function": "run_${pluginSpec.pattern_id}_plugin",
    "pattern_type": "${pluginSpec.pattern_id}",
    "composition": "primitive",
    "indicator_role": "${pluginSpec.indicator_role}",
    "tunable_params": ${JSON.stringify(pluginSpec.tunable_params)}
  }
}
\`\`\``;
  return applyRolePromptOverride('plugin_engineer', prompt);
}

// ─── OpenAI call helper ───────────────────────────────────────────────────────

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 3000,
  modelOverride?: string,
): Promise<string> {
  const openaiApiKey = getConfiguredOpenAIKey();
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured. Add it in Settings or backend/.env');
  }

  const model = modelOverride || RESEARCH_MODEL;
  // All OpenAI o-series models (o1, o1-mini, o1-preview, o3, o3-mini, o4-mini, etc.)
  // only accept max_completion_tokens, not max_tokens.
  const isReasoningModel = /^o\d/.test(model);

  const body: Record<string, any> = {
    model,
    messages: [
      { role: isReasoningModel ? 'user' : 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  };

  if (!isReasoningModel) {
    body.temperature = 0.7;
    body.max_tokens = maxTokens;
  } else {
    body.max_completion_tokens = maxTokens;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content || '';
}

/** Chat completion with full message history (for follow-up Q&A). Returns plain text. */
async function callOpenAIChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  maxTokens = 1500,
  modelOverride?: string,
): Promise<string> {
  const openaiApiKey = getConfiguredOpenAIKey();
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured. Add it in Settings or backend/.env');
  }

  const model = modelOverride || RESEARCH_MODEL;
  const isReasoningModel = /^o\d/.test(model);

  // o-series models don't support the 'system' role — remap to 'user' if needed.
  const safeMessages = isReasoningModel
    ? messages.map(m => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
    : messages;

  const body: Record<string, any> = {
    model,
    messages: safeMessages,
  };
  if (!isReasoningModel) {
    body.temperature = 0.5;
    body.max_tokens = maxTokens;
  } else {
    body.max_completion_tokens = maxTokens;
  }
  // No response_format so we get plain text

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ─── Dynamic primitive catalogue ─────────────────────────────────────────────

const REGISTRY_PATH = path.join(__dirname, '..', '..', 'data', 'patterns', 'registry.json');

async function loadPrimitivesFromRegistry(): Promise<typeof AVAILABLE_PRIMITIVES> {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, 'utf-8');
    const registry = JSON.parse(raw);
    const patterns: any[] = registry.patterns || [];
    const registered = patterns
      .filter((p: any) => p.composition === 'primitive' && p.status !== 'deprecated')
      .map((p: any) => ({
        pattern_id: p.pattern_id,
        name: p.name || p.pattern_id,
        description: p.description || `${p.name || p.pattern_id} — ${p.indicator_role || 'custom'} primitive.`,
        output_ports: p.output_ports || [],
        input_ports: p.input_ports || [],
        indicator_role: p.indicator_role || 'custom',
      }));
    // Merge with built-in list — registry entries take precedence for duplicates
    const seen = new Set(registered.map((p: any) => p.pattern_id));
    const builtins = AVAILABLE_PRIMITIVES.filter(p => !seen.has(p.pattern_id));
    return [...registered, ...builtins];
  } catch {
    return AVAILABLE_PRIMITIVES;
  }
}

// ─── Main public functions ────────────────────────────────────────────────────

/** Generate a new strategy hypothesis and spec. */
export async function generateHypothesis(
  sessionName: string,
  history: GenomeEntry[],
  seedHypothesis?: string,
  allowNewPrimitives: boolean = false,
  modelOverride?: string,
  forcedParams?: Record<string, any>,
  riskDefaults?: Record<string, any>,
): Promise<GeneratedHypothesis> {
  const primitives = await loadPrimitivesFromRegistry();
  let systemPrompt = buildIdeationSystemPrompt(allowNewPrimitives, primitives);

  if (riskDefaults) {
    const stopDesc = riskDefaults.defaultStopType === 'atr_multiple' ? `ATR x${riskDefaults.defaultStopValue || '2.0'}`
      : riskDefaults.defaultStopType === 'fixed_pct' ? `${riskDefaults.defaultStopValue || '8'}% fixed`
      : riskDefaults.defaultStopType === 'structural' ? `Structural +${riskDefaults.defaultStopBuffer || '2'}% buffer`
      : riskDefaults.defaultStopType === 'swing_low' ? `Swing low +${riskDefaults.defaultStopBuffer || '2'}% buffer`
      : 'ATR x2.0';
    systemPrompt += `

## USER'S CONFIGURED RISK DEFAULTS (use as starting point for Gen 1)
- Default Stop: ${stopDesc} (stop_type: "${riskDefaults.defaultStopType || 'atr'}")
- Risk Per Trade: ${riskDefaults.riskPercent || '2'}%
- Min R:R: ${riskDefaults.minRR || '1.5'}
- Take Profit: ${riskDefaults.defaultTakeProfitR || '2.0'}R
- Max Hold: ${riskDefaults.defaultMaxHold || '30'} bars
- Breakeven Trigger: ${riskDefaults.defaultBreakevenR || '1.0'}R
- Trailing: ${riskDefaults.defaultTrailingType || 'none'}${riskDefaults.defaultTrailingType && riskDefaults.defaultTrailingType !== 'none' ? ' (' + riskDefaults.defaultTrailingValue + ')' : ''}

Use these as the starting baseline for the first generation's risk_config. Subsequent generations should vary from these based on backtest results.`;
  }

  const userPrompt = buildIdeationUserPrompt(seedHypothesis, history, sessionName, forcedParams);

  const raw = await callOpenAI(systemPrompt, userPrompt, 3500, modelOverride);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse hypothesis JSON: ${raw.slice(0, 500)}`);
  }

  if (!parsed.spec_json || !parsed.hypothesis) {
    throw new Error(`Hypothesis missing required fields: ${raw.slice(0, 500)}`);
  }

  return {
    hypothesis: String(parsed.hypothesis || ''),
    rationale: String(parsed.rationale || ''),
    spec_json: parsed.spec_json,
    new_primitives_needed: Array.isArray(parsed.new_primitives_needed)
      ? parsed.new_primitives_needed
      : [],
  };
}

// ─── Backtest Reflection ──────────────────────────────────────────────────────

export interface ReflectionInput {
  hypothesis: string;
  report: ReportSummary;
  risk: {
    longest_losing_streak: number;
    longest_winning_streak: number;
    avg_losing_streak: number;
    max_drawdown_R: number;
    time_under_water_bars: number;
  };
  trades_sample: Array<{
    symbol: string;
    direction: string;
    entry_time: string;
    exit_time: string;
    exit_reason: string;
    R_multiple: number;
  }>;
  per_symbol_stats: Array<{
    symbol: string;
    trades: number;
    wins: number;
    avg_R: number;
  }>;
  exit_reason_breakdown: Record<string, number>;
}

export async function reflectOnBacktest(input: ReflectionInput, modelOverride?: string): Promise<{ reflection: string; param_changes: Record<string, any> | null }> {
  const systemPrompt = applyRolePromptOverride('research_analyst', `You are a quantitative trading strategy analyst. You receive detailed backtest results and produce a concise forensic analysis.

Your job is to identify:
1. WHY the strategy performed the way it did (not just restate the numbers)
2. Where losses clustered (symbols, time periods, exit reasons)
3. Whether the stop is too tight/loose based on exit_reason distribution AND individual R-multiples
4. Whether entries are early/late based on R-multiple distribution
5. Which symbols drive profits vs drag performance
6. SPECIFIC, ACTIONABLE parameter changes for the next iteration — you MUST suggest concrete values

## CRITICAL STOP ANALYSIS RULES
- If ANY individual trade has R-multiple worse than -5R, the stop is TOO WIDE (not too tight). This means the stop distance is so large that 1R represents a massive loss.
- "Excessively tight stops" means many trades hit stop at exactly -1R and then price reverses in the right direction. Look for exit_reason = "stop" with R near -1R.
- "Excessively wide stops" means trades accumulate huge R-multiple losses (-10R, -20R, -40R). This happens with stop_type "base_floor" or "swing_low" on volatile instruments.
- When stops are too wide, recommend: stop_type "atr" with atr_multiplier between 1.5 and 2.5
- When stops are too tight, recommend: increasing atr_multiplier or switching to "swing_low"

## REQUIRED OUTPUT FORMAT
Be brutally honest. No fluff. Max 300 words in the reflection.

Return JSON with BOTH fields:
{
  "reflection": "your analysis text (includes reasoning)",
  "param_changes": {
    "stop_type": "atr",
    "atr_multiplier": 2.0,
    "take_profit_R": 2.0,
    "max_hold_bars": 20,
    "risk_per_trade_pct": 0.01
  }
}

The param_changes object MUST contain concrete numeric/string values — not ranges or nulls. These will be directly injected into the next generation's risk_config.`);

  const topSymbols = input.per_symbol_stats
    .sort((a, b) => b.avg_R - a.avg_R)
    .slice(0, 5);
  const bottomSymbols = input.per_symbol_stats
    .sort((a, b) => a.avg_R - b.avg_R)
    .slice(0, 5);

  const losers = input.trades_sample
    .filter(t => t.R_multiple < 0)
    .slice(0, 10);
  const winners = input.trades_sample
    .filter(t => t.R_multiple > 0)
    .sort((a, b) => b.R_multiple - a.R_multiple)
    .slice(0, 5);

  const userPrompt = `## Hypothesis
${input.hypothesis}

## Aggregate Results
- Trades: ${input.report.total_trades}, Win rate: ${(input.report.win_rate * 100).toFixed(1)}%
- Expectancy: ${input.report.expectancy_R.toFixed(3)}R, Profit factor: ${input.report.profit_factor.toFixed(2)}
- Sharpe: ${input.report.sharpe_ratio.toFixed(2)}, Max DD: ${input.report.max_drawdown_pct.toFixed(1)}%
- OOS degradation: ${input.report.oos_degradation_pct.toFixed(1)}%
- Verdict: ${input.report.pass_fail}

## Risk Detail
- Longest losing streak: ${input.risk.longest_losing_streak}
- Avg losing streak: ${input.risk.avg_losing_streak.toFixed(1)}
- Longest winning streak: ${input.risk.longest_winning_streak}
- Max drawdown (R): ${input.risk.max_drawdown_R.toFixed(1)}R
- Time under water: ${input.risk.time_under_water_bars} bars

## Exit Reason Breakdown
${Object.entries(input.exit_reason_breakdown).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Best Performing Symbols
${topSymbols.map(s => `- ${s.symbol}: ${s.trades} trades, ${s.wins} wins, avg ${s.avg_R.toFixed(2)}R`).join('\n')}

## Worst Performing Symbols
${bottomSymbols.map(s => `- ${s.symbol}: ${s.trades} trades, ${s.wins} wins, avg ${s.avg_R.toFixed(2)}R`).join('\n')}

## Sample Losing Trades
${losers.map(t => `- ${t.symbol} ${t.direction} ${t.entry_time} → ${t.exit_time} exit:${t.exit_reason} R=${t.R_multiple.toFixed(2)}`).join('\n') || 'None'}

## Top Winning Trades
${winners.map(t => `- ${t.symbol} ${t.direction} ${t.entry_time} → ${t.exit_time} exit:${t.exit_reason} R=${t.R_multiple.toFixed(2)}`).join('\n') || 'None'}

Analyze these results. What specifically should change in the next generation?`;

  try {
    const raw = await callOpenAI(systemPrompt, userPrompt, 900, modelOverride);
    const parsed = JSON.parse(raw);
    const reflection = String(parsed.reflection || parsed.analysis || raw);
    const param_changes = parsed.param_changes && typeof parsed.param_changes === 'object'
      ? parsed.param_changes as Record<string, any>
      : null;
    return { reflection, param_changes };
  } catch {
    return { reflection: '', param_changes: null };
  }
}

const STRATEGIES_DIR_FOR_CONTEXT = path.join(__dirname, '..', '..', 'data', 'strategies');
const PLUGINS_DIR_FOR_CONTEXT = path.join(__dirname, '..', '..', '..', 'services', 'plugins');

/**
 * Load the full strategy spec JSON from disk for a genome entry.
 * Returns null if the file is missing or can't be parsed.
 */
async function loadStrategySpec(strategyVersionId: string): Promise<Record<string, any> | null> {
  if (!strategyVersionId) return null;
  try {
    const raw = await fs.readFile(
      path.join(STRATEGIES_DIR_FOR_CONTEXT, `${strategyVersionId}.json`),
      'utf-8',
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Load the Python source for a plugin file.
 * Returns truncated source (first 120 lines) to stay within token budget.
 */
async function loadPluginSource(patternId: string): Promise<string | null> {
  const candidates = [
    `${patternId}.py`,
    `${patternId}_primitive.py`,
    `${patternId}_pattern.py`,
    `${patternId}_composite.py`,
  ];
  for (const name of candidates) {
    try {
      const raw = await fs.readFile(path.join(PLUGINS_DIR_FOR_CONTEXT, name), 'utf-8');
      const lines = raw.split('\n');
      return lines.slice(0, 120).join('\n') + (lines.length > 120 ? '\n# ... (truncated)' : '');
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Build a rich generation context block for the AI (SR or SD). */
async function buildInterpretationContext(
  entry: GenomeEntry,
  sessionConfig: { mode?: string; sr_config?: any },
): Promise<string> {
  const isSR = sessionConfig.mode === 'symbolic_regression';

  if (isSR) {
    const r2 = entry.fitness_score ?? 0;
    const cx = entry.complexity ?? 0;
    const formula = entry.formula_readable || entry.formula || 'N/A';
    const formulaRaw = entry.formula || 'N/A';
    const isConstant = cx <= 1 || /^-?[\d.]+$/.test(formula.trim());
    const sr = sessionConfig.sr_config || {};
    const symbol = sr.symbol || 'unknown';
    const interval = sr.interval || 'unknown';
    const targetBars = sr.target_bars || 5;
    const lookback = sr.lookback_bars || 'default';
    const normalizeByAtr = sr.normalize_by_atr !== false;
    const populationSize = sr.population_size || 500;
    const generations = sr.n_generations || 20;
    const parsimonyCoeff = sr.parsimony_coefficient ?? 0.001;
    const stoppingCriteria = sr.stopping_criteria ?? 0.0;

    // Per-feature detail
    const featuresArr: any[] = sr.features || [];
    const featureLines = featuresArr.length > 0
      ? featuresArr.map((f: any) =>
          `  - ${f.id}(period=${f.period || 'default'})${f.description ? ': ' + f.description : ''}`,
        ).join('\n')
      : '  (default set)';

    // Load the sr_score_primitive plugin source
    const srPluginSrc = await loadPluginSource('sr_score_primitive');
    const pluginsBlock = srPluginSrc
      ? `\n=== SR SCORE PRIMITIVE PLUGIN CODE (sr_score_primitive.py) ===\n${srPluginSrc}`
      : '';

    // Load the sr_score_primitive JSON definition
    let srJsonDef = '';
    try {
      const srJsonPath = path.join(__dirname, '..', '..', 'data', 'patterns', 'sr_score_primitive.json');
      const raw = await fs.readFile(srJsonPath, 'utf-8');
      srJsonDef = `\n=== SR SCORE PRIMITIVE DEFINITION (JSON) ===\n${raw}`;
    } catch { /* not critical */ }

    return `Symbolic Regression result.
Symbol: ${symbol}, Interval: ${interval}
Target: predict ${targetBars}-bar forward returns${normalizeByAtr ? ' (ATR-normalized)' : ''}
Lookback: ${lookback} bars

=== FORMULA ===
Human-readable: ${formula}
Raw LISP (gplearn): ${formulaRaw}
Is trivial constant: ${isConstant}
R² (fitness): ${r2.toFixed(4)}
Complexity (program nodes): ${cx}

=== INPUT FEATURES (what the formula combines) ===
${featureLines}

=== SR SESSION PARAMETERS ===
Population size: ${populationSize}
Generations run: ${generations}
Parsimony coefficient (complexity penalty): ${parsimonyCoeff}
Stopping criteria (early stop R²): ${stoppingCriteria}
${pluginsBlock}${srJsonDef}`;
  }

  // Strategy Discovery — load full spec + plugin code
  const r = entry.report_summary;
  const metricsText = r
    ? `Trades: ${r.total_trades}, Win rate: ${(r.win_rate * 100).toFixed(1)}%, Expectancy: ${r.expectancy_R.toFixed(3)}R, Profit factor: ${r.profit_factor?.toFixed(2) ?? 'N/A'}, Sharpe: ${r.sharpe_ratio?.toFixed(2) ?? 'N/A'}, Max DD: ${r.max_drawdown_pct?.toFixed(1) ?? 'N/A'}%, OOS deg: ${r.oos_degradation_pct?.toFixed(1) ?? 'N/A'}%, Pass/Fail: ${r.pass_fail}, Fitness: ${entry.fitness_score?.toFixed(3) ?? 'N/A'}.`
    : 'No backtest results.';

  const spec = await loadStrategySpec(entry.strategy_version_id);

  let specBlock = '';
  let pluginsBlock = '';

  if (spec) {
    // Risk / exit config
    const rc = spec.risk_config || {};
    const riskLines = [
      rc.stop_type && `Stop type: ${rc.stop_type}`,
      rc.atr_multiplier != null && `ATR multiplier (stop): ${rc.atr_multiplier}`,
      rc.take_profit_R != null && `Take profit: ${rc.take_profit_R}R`,
      rc.max_hold_bars != null && `Max hold bars: ${rc.max_hold_bars}`,
      rc.max_concurrent_positions != null && `Max concurrent positions: ${rc.max_concurrent_positions}`,
    ].filter(Boolean).join(', ');

    // Primitive stages
    const stages: any[] = spec.setup_config?.composite_spec?.stages || [];
    const stagesText = stages.map((s: any) =>
      `  - ${s.id} → ${s.pattern_id}: ${JSON.stringify(s.params || {})}`,
    ).join('\n');

    // Parameter manifest (tunable knobs)
    const manifest: any[] = spec.parameter_manifest || [];
    const resolveNestedPath = (obj: any, dotPath: string): any => {
      return dotPath.split('.').reduce((acc, k) => (acc != null && typeof acc === 'object' ? acc[k] : undefined), obj);
    };
    const manifestText = manifest.map((p: any) => {
      const current = resolveNestedPath(spec, p.path);
      return `  - ${p.label} (${p.key}): current=${JSON.stringify(current ?? '?')}, range=[${p.min ?? '?'}–${p.max ?? '?'}], step=${p.step ?? '?'}, sweep_enabled=${p.sweep_enabled}`;
    }).join('\n');

    specBlock = `
=== FULL STRATEGY SPEC ===
Name: ${spec.name || entry.strategy_version_id}
Asset class: ${spec.asset_class || 'unknown'}, Interval: ${spec.interval || 'unknown'}
Entry type: ${spec.entry_config?.entry_type || 'unknown'}
Risk config: ${riskLines || 'not defined'}
Logic stages (AND-chained primitives):
${stagesText || '  (none)'}
Tunable parameters (parameter manifest):
${manifestText || '  (none)'}
Reducer: ${JSON.stringify(spec.setup_config?.composite_spec?.reducer || {})}`;

    // Load Python source for each primitive
    const pluginSources: string[] = [];
    for (const stage of stages) {
      const src = await loadPluginSource(stage.pattern_id);
      if (src) {
        pluginSources.push(`--- Plugin: ${stage.pattern_id} ---\n${src}`);
      }
    }
    if (pluginSources.length > 0) {
      pluginsBlock = `\n=== PRIMITIVE PLUGIN CODE ===\n${pluginSources.join('\n\n')}`;
    }
  }

  return `Strategy Discovery. Hypothesis: ${entry.hypothesis}. Spec: ${entry.spec_summary}. Verdict: ${entry.verdict}.
Backtest: ${metricsText}${specBlock}${pluginsBlock}`;
}

/**
 * AI-powered interpretation of a Research generation's results.
 * Works for both Strategy Discovery (backtest metrics) and Symbolic Regression (formula/R²).
 */
export async function interpretGeneration(
  entry: GenomeEntry,
  sessionConfig: { mode?: string; sr_config?: any },
  modelOverride?: string,
): Promise<string> {
  const isSR = sessionConfig.mode === 'symbolic_regression';

  const systemPrompt = applyRolePromptOverride('research_analyst', `You are a quantitative trading analyst explaining research results to a trader who is NOT a math expert.

Your job is to tell them:
1. WHAT the numbers actually mean in plain English — not restate them
2. WHETHER this result is useful or garbage, and WHY
3. WHAT they should do next — specific, actionable steps

Rules:
- Be brutally honest. If it's bad, say it's bad and say why.
- No hedging, no fluff, no "it depends." Give a clear verdict.
- Talk directly to the user: "Your strategy..." / "This formula..."
- Use short paragraphs. No bullet-point lists longer than 4 items.
- Max 250 words.
- Do NOT restate every metric — focus on the 2-3 things that matter most.
- End with a clear "What to do" recommendation.

Return JSON: { "interpretation": "your analysis text here" }`);

  let userPrompt: string;

  if (isSR) {
    const richContext = await buildInterpretationContext(entry, sessionConfig);

    userPrompt = `This is a Symbolic Regression result. The system used genetic programming (gplearn) to discover a mathematical formula that predicts forward returns from indicator features.

${richContext}

Benchmarks for your interpretation:
- In financial price data, R² above 0.05 is unusual; above 0.15 almost always means overfitting
- Complexity above 20 dramatically increases overfitting risk
- A trivial constant formula means the features have no detectable relationship with the target
- Even R² of 0.02–0.04 can represent a real, tradeable edge if it holds on unseen data
- Parsimony coefficient controls the complexity penalty — higher = simpler formulas
- More features give the algorithm more to work with, but also more ways to overfit

You have access to the full SR session config (symbol, interval, features, gplearn parameters), the formula itself (human-readable and raw LISP), and the sr_score_primitive plugin code. Use this to give specific recommendations: which features to add/remove, which gplearn parameters to adjust, whether the formula is worth pursuing.

Tell the user what this means and what they should do.`;
  } else {
    const r = entry.report_summary;
    if (!r) {
      return 'No backtest results available for this generation.';
    }

    const richContext = await buildInterpretationContext(entry, sessionConfig);

    userPrompt = `This is a Strategy Discovery backtest result. The system generated a trading strategy hypothesis and backtested it across multiple symbols.

${richContext}

Backtest metric benchmarks (for your interpretation):
- 200+ trades minimum for statistical significance
- Expectancy above 0.2R is decent; above 0.4R is strong
- Profit factor above 1.5 is good; below 1.0 means it loses money
- OOS degradation above 50% is a red flag for curve-fitting
- Max drawdown above 30% means most traders would abandon the strategy
- Sharpe above 1.0 is good; below 0.5 is poor
- The gate requires PASS verdict + 200 trades + positive expectancy

You have access to the full strategy spec, all primitive parameters, stop-loss/take-profit config, the parameter manifest (what can be tuned), and the actual plugin code. Use this to give specific, code-level advice about what to change and why.

Tell the user what this means and what they should do.`;
  }

  try {
    const raw = await callOpenAI(systemPrompt, userPrompt, 600, modelOverride);
    const parsed = JSON.parse(raw);
    return String(parsed.interpretation || parsed.text || parsed.analysis || raw);
  } catch (err: any) {
    throw new Error(`AI interpretation failed: ${err.message}`);
  }
}

export interface InterpretAskMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Answer a follow-up question about a generation. Uses the same generation context
 * plus the initial interpretation and conversation history.
 */
export async function interpretAsk(
  entry: GenomeEntry,
  sessionConfig: { mode?: string; sr_config?: any },
  question: string,
  initialInterpretation: string,
  conversation: InterpretAskMessage[],
  modelOverride?: string,
): Promise<string> {
  const context = await buildInterpretationContext(entry, sessionConfig);
  const systemPrompt = applyRolePromptOverride('research_analyst', `You are a quantitative trading analyst. The user is looking at a research result and has already seen an interpretation.

You have access to the full strategy spec including all primitive plugin code, primitive parameters, stop-loss / take-profit config, and the parameter manifest (the complete list of tunable knobs with their ranges).

Use this detail to give specific, actionable advice — reference actual parameter names, current values, and what to change them to.

Generation context:
${context}

Initial interpretation they saw:
---
${initialInterpretation}
---

The user will ask follow-up questions. Answer in plain language: concise, direct, no fluff. If they ask "why", explain the reasoning. If they ask "what if", give a concrete recommendation. Keep answers to a few sentences unless they ask for more.`);

  const model = modelOverride || RESEARCH_MODEL;
  const isReasoningModel = /^o\d/.test(model);

  // o-series models don't support the 'system' role — prepend as a 'user' message instead.
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: isReasoningModel ? 'user' : 'system', content: systemPrompt },
    ...conversation.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: question.trim() },
  ];

  const reply = await callOpenAIChat(messages, 1500, modelOverride);
  return reply;
}

/** Generate Python code for a new plugin primitive. */
export async function generatePlugin(pluginSpec: NewPluginSpec): Promise<GeneratedPlugin> {
  const prompt = buildPluginEngineerPrompt(pluginSpec);
  const systemPrompt = applyRolePromptOverride('plugin_engineer', 'You are a Python plugin engineer. Return only valid JSON.');

  const raw = await callOpenAI(
    systemPrompt,
    prompt,
    3000,
  );

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse plugin JSON for ${pluginSpec.pattern_id}: ${raw.slice(0, 300)}`);
  }

  if (!parsed.python_code || !parsed.definition_json) {
    throw new Error(`Plugin response missing python_code or definition_json`);
  }

  return {
    pattern_id: pluginSpec.pattern_id,
    python_code: String(parsed.python_code),
    definition_json: parsed.definition_json,
  };
}

/** Write a generated plugin to disk and register it in the patterns registry. */
export async function registerGeneratedPlugin(
  plugin: GeneratedPlugin,
  pluginsDir: string,
  registryPath: string,
): Promise<void> {
  const researchDir = path.join(pluginsDir, 'research');
  await fs.mkdir(researchDir, { recursive: true });

  const pyPath = path.join(researchDir, `${plugin.pattern_id}.py`);
  await fs.writeFile(pyPath, plugin.python_code, 'utf-8');

  const defPath = path.join(path.dirname(registryPath), '..', 'patterns', `${plugin.pattern_id}.json`);
  await fs.writeFile(defPath, JSON.stringify(plugin.definition_json, null, 2), 'utf-8');

  const registryRaw = await fs.readFile(registryPath, 'utf-8');
  const registry = JSON.parse(registryRaw);

  const alreadyRegistered = registry.patterns?.some(
    (p: any) => p.pattern_id === plugin.pattern_id,
  );

  if (!alreadyRegistered) {
    registry.patterns = registry.patterns || [];
    registry.patterns.push({
      pattern_id: plugin.pattern_id,
      name: plugin.definition_json.name || plugin.pattern_id,
      category: plugin.definition_json.category || 'custom',
      definition_file: `${plugin.pattern_id}.json`,
      status: 'research',
      artifact_type: 'indicator',
      composition: 'primitive',
      indicator_role: plugin.definition_json.indicator_role || 'custom',
    });
    registry.updated_at = new Date().toISOString();
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  }
}
