import {
  buildCompositeStageId,
  normalizeCompositeId,
  suggestCompositeName,
} from './compositeNaming';
import {
  loadPatternDefinition,
  loadPrimitiveDefaultParams,
} from './compositePatternStore';

export interface CompositeStage {
  id: string;
  pattern_id: string;
  params: Record<string, any>;
}

export function buildLocalCompositeDefinition(
  stages: CompositeStage[],
  intent: string,
  metadata: Record<string, any>,
  patternDataDir?: string,
): Record<string, any> {
  const normalizedStages = stages.map((stage, index) => {
    const existingIds = stages.slice(0, index).map((item) => item.id);
    const stageId = String(stage.id || '').trim() || buildCompositeStageId('', existingIds);
    return {
      id: stageId,
      pattern_id: String(stage.pattern_id || '').trim(),
      params: stage?.params && typeof stage.params === 'object'
        ? { ...stage.params }
        : loadPrimitiveDefaultParams(String(stage.pattern_id || '').trim(), patternDataDir),
    };
  });

  const chosenIntent = String(intent || 'entry').trim() || 'entry';
  const suggestedName = String(metadata?.patternName || '').trim() || suggestCompositeName(normalizedStages, chosenIntent);
  const patternId = normalizeCompositeId(String(metadata?.patternId || '').trim() || suggestedName);
  const timeframeSet = new Set<string>();
  let minDataBars = 60;

  for (const stage of normalizedStages) {
    const definition = loadPatternDefinition(stage.pattern_id, patternDataDir);
    const timeframes = Array.isArray(definition?.suggested_timeframes) ? definition.suggested_timeframes : [];
    for (const tf of timeframes) timeframeSet.add(String(tf));
    const bars = Number(definition?.min_data_bars);
    if (Number.isFinite(bars)) minDataBars = Math.max(minDataBars, bars);
  }

  return {
    pattern_id: patternId,
    name: suggestedName,
    category: 'indicator_signals',
    description: `Composite ${chosenIntent} indicator generated in local fallback mode.`,
    author: 'user',
    version: '1.0.0',
    plugin_file: 'plugins/composite_runner.py',
    plugin_function: 'run_composite_plugin',
    pattern_type: patternId,
    chart_indicator: true,
    default_structure_config: { swing_method: 'rdp', swing_epsilon_pct: 0.05 },
    default_setup_params: {
      pattern_type: patternId,
      composite_spec: {
        intent: chosenIntent,
        stages: normalizedStages,
        reducer: {
          op: 'AND',
          inputs: normalizedStages.map((stage) => stage.id),
        },
      },
    },
    default_entry: {
      entry_type: chosenIntent === 'exit' ? 'exit_signal' : chosenIntent === 'entry' ? 'market_on_close' : 'analysis_only',
    },
    default_risk_config: {
      stop_type: 'atr_multiple',
      atr_multiplier: 2,
      take_profit_R: 2.0,
      max_hold_bars: 30,
    },
    tunable_params: [],
    suggested_timeframes: Array.from(timeframeSet).length ? Array.from(timeframeSet) : ['D', 'W'],
    min_data_bars: minDataBars,
    artifact_type: 'indicator',
    composition: 'composite',
    indicator_role: `${chosenIntent}_composite`,
  };
}
