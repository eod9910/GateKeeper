import { StrategyParameterManifestItem, StrategySpec } from '../types';

type PatternDefinition = Record<string, any>;

interface RawTunableParam {
  key?: string;
  label?: string;
  path?: string;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  default?: any;
  options?: any[];
  description?: string;
  anatomy?: string;
  identity_preserving?: boolean;
  sweep_enabled?: boolean;
  sensitivity_enabled?: boolean;
  priority?: number;
  failure_modes_targeted?: string[];
}

type ManifestOverride = Partial<StrategyParameterManifestItem> & { path?: string };

function normalizePatternType(value: any): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeManifestItem(item: Partial<StrategyParameterManifestItem> | null | undefined): StrategyParameterManifestItem | null {
  if (!item?.key || !item?.label || !item?.path) return null;
  return {
    key: String(item.key),
    label: String(item.label),
    path: String(item.path),
    anatomy: (item.anatomy || 'risk_controls') as StrategyParameterManifestItem['anatomy'],
    type: (item.type || 'float') as StrategyParameterManifestItem['type'],
    description: item.description ? String(item.description) : undefined,
    identity_preserving: item.identity_preserving !== false,
    sweep_enabled: Boolean(item.sweep_enabled),
    sensitivity_enabled: Boolean(item.sensitivity_enabled),
    suggested_values: Array.isArray(item.suggested_values) ? item.suggested_values : undefined,
    min: typeof item.min === 'number' ? item.min : undefined,
    max: typeof item.max === 'number' ? item.max : undefined,
    step: typeof item.step === 'number' ? item.step : undefined,
    priority: typeof item.priority === 'number' ? item.priority : undefined,
    failure_modes_targeted: Array.isArray(item.failure_modes_targeted)
      ? item.failure_modes_targeted.map(value => String(value))
      : undefined,
  };
}

function uniqueValues(values: Array<string | number | boolean>): Array<string | number | boolean> {
  const seen = new Set<string>();
  const out: Array<string | number | boolean> = [];
  values.forEach(value => {
    const key = typeof value === 'number'
      ? `n:${Number(value.toFixed(6))}`
      : typeof value === 'boolean'
      ? `b:${value}`
      : `s:${String(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(typeof value === 'number' ? Number(value.toFixed(6)) : value);
  });
  return out;
}

function buildNumericSuggestions(param: RawTunableParam): number[] | undefined {
  const min = typeof param.min === 'number' ? param.min : undefined;
  const max = typeof param.max === 'number' ? param.max : undefined;
  const step = typeof param.step === 'number' && param.step > 0 ? param.step : undefined;
  const fallbackDefault = typeof param.default === 'number' ? param.default : undefined;

  if (min == null && max == null && fallbackDefault == null) return undefined;

  const center = fallbackDefault ?? min ?? max ?? 0;
  if (step != null) {
    return uniqueValues([
      Math.max(min ?? -Infinity, center - step * 2),
      Math.max(min ?? -Infinity, center - step),
      center,
      Math.min(max ?? Infinity, center + step),
      Math.min(max ?? Infinity, center + step * 2),
    ]).filter(value => (min == null || Number(value) >= min) && (max == null || Number(value) <= max)) as number[];
  }

  if (min != null && max != null) {
    const span = max - min;
    return uniqueValues([
      min,
      min + span * 0.25,
      center,
      min + span * 0.75,
      max,
    ]) as number[];
  }

  return [center];
}

function buildSuggestedValues(param: RawTunableParam): Array<string | number | boolean> | undefined {
  const type = String(param.type || '').toLowerCase();
  if (Array.isArray(param.options) && param.options.length) {
    return uniqueValues(param.options as Array<string | number | boolean>);
  }
  if (type === 'bool' || type === 'boolean') {
    return [false, true];
  }
  if (type === 'int' || type === 'float' || typeof param.default === 'number') {
    return buildNumericSuggestions(param);
  }
  if (param.default != null) {
    return [param.default];
  }
  return undefined;
}

function findCompositeStageParamPath(strategy: StrategySpec, stageIdPattern: RegExp, paramName: string): string {
  const stages = Array.isArray(strategy?.setup_config?.composite_spec?.stages)
    ? strategy.setup_config.composite_spec.stages
    : [];
  const idx = stages.findIndex((stage: any) => {
    const id = String(stage?.id || '').toLowerCase();
    const patternId = String(stage?.pattern_id || '').toLowerCase();
    return stageIdPattern.test(id) || stageIdPattern.test(patternId);
  });
  return idx >= 0 ? `setup_config.composite_spec.stages.${idx}.params.${paramName}` : '';
}

function resolvePathForParam(strategy: StrategySpec, key: string): string {
  if (!key) return '';
  const normalized = String(key);
  const compositePaths: Record<string, string> = {
    required_regime: findCompositeStageParamPath(strategy, /regime|gate|filter|state/, 'required_regime'),
    oversold_level: findCompositeStageParamPath(strategy, /timing|trigger|divergence|rsi/, 'oversold_level'),
  };
  if (compositePaths[normalized]) return compositePaths[normalized];
  if (strategy.entry_config && Object.prototype.hasOwnProperty.call(strategy.entry_config, normalized)) {
    return `entry_config.${normalized}`;
  }
  if (strategy.risk_config && Object.prototype.hasOwnProperty.call(strategy.risk_config, normalized)) {
    return `risk_config.${normalized}`;
  }
  if (strategy.exit_config && Object.prototype.hasOwnProperty.call(strategy.exit_config, normalized)) {
    return `exit_config.${normalized}`;
  }
  if (strategy.structure_config && Object.prototype.hasOwnProperty.call(strategy.structure_config, normalized)) {
    return `structure_config.${normalized}`;
  }
  return `setup_config.${normalized}`;
}

function resolveAnatomyForParam(key: string, path: string): StrategyParameterManifestItem['anatomy'] {
  const text = `${key} ${path}`.toLowerCase();
  if (text.includes('regime') || text.includes('filter') || text.includes('gate')) return 'regime_filter';
  if (text.includes('stop')) return 'stop_loss';
  if (text.includes('take_profit') || text.includes('target') || text.includes('max_hold')) return 'take_profit';
  if (text.includes('concurrent') || text.includes('daily_') || text.includes('scale_out') || text.includes('lock_')) return 'risk_controls';
  if (text.includes('retracement') || text.includes('location')) return 'location';
  if (text.includes('confirm') || text.includes('breakout') || text.includes('trigger') || text.includes('cross_direction')) return 'entry_timing';
  return 'structure';
}

function createManifestItem(strategy: StrategySpec, param: RawTunableParam, override: ManifestOverride = {}): StrategyParameterManifestItem | null {
  const key = String(param.key || override.key || '').trim();
  if (!key) return null;
  const path = String(override.path || param.path || resolvePathForParam(strategy, key) || '').trim();
  if (!path) return null;
  const type = String(override.type || param.type || 'float').toLowerCase();
  return normalizeManifestItem({
    key,
    label: override.label || param.label || key,
    path,
    anatomy: (override.anatomy || param.anatomy || resolveAnatomyForParam(key, path)) as StrategyParameterManifestItem['anatomy'],
    type: (type === 'boolean' ? 'bool' : type) as StrategyParameterManifestItem['type'],
    description: override.description || param.description,
    identity_preserving: override.identity_preserving ?? param.identity_preserving ?? true,
    sweep_enabled: override.sweep_enabled ?? param.sweep_enabled ?? true,
    sensitivity_enabled: override.sensitivity_enabled ?? param.sensitivity_enabled ?? (type === 'int' || type === 'float'),
    suggested_values: override.suggested_values || buildSuggestedValues(param),
    min: override.min ?? param.min,
    max: override.max ?? param.max,
    step: override.step ?? param.step,
    priority: override.priority ?? param.priority,
    failure_modes_targeted: override.failure_modes_targeted ?? param.failure_modes_targeted,
  });
}

function genericManifestFromDefinition(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const tunableParams = Array.isArray(familyDef?.tunable_params) ? familyDef.tunable_params : [];
  return tunableParams
    .map((param: RawTunableParam) => createManifestItem(strategy, param))
    .filter((item): item is StrategyParameterManifestItem => Boolean(item));
}

function mergeManifestItems(
  base: StrategyParameterManifestItem[],
  overrides: Record<string, ManifestOverride> = {},
  extras: Array<StrategyParameterManifestItem | null | undefined> = [],
): StrategyParameterManifestItem[] {
  const merged = base.map(item => ({ ...item, ...(overrides[item.key] || {}) }));
  const seen = new Set(merged.map(item => item.key));
  extras.forEach((item) => {
    if (!item || seen.has(item.key)) return;
    seen.add(item.key);
    merged.push(item);
  });
  return merged;
}

function densityBaseManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const extras = [
    createManifestItem(strategy, { key: 'swing_lookback', label: 'Swing Lookback', type: 'int', min: 3, max: 30, step: 1 }, {
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'swing_lookahead', label: 'Swing Lookahead', type: 'int', min: 3, max: 30, step: 1 }, {
      anatomy: 'structure',
      priority: 95,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'min_drop_pct', label: 'Min Drop %', type: 'float', min: 0.02, max: 0.2, step: 0.01 }, {
      anatomy: 'structure',
      priority: 90,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'min_void_bars', label: 'Min Void Bars', type: 'int', min: 2, max: 20, step: 1 }, {
      anatomy: 'structure',
      priority: 90,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'min_base_bars', label: 'Min Base Bars', type: 'int', min: 3, max: 30, step: 1 }, {
      anatomy: 'structure',
      priority: 90,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'min_score', label: 'Min Score', type: 'float', min: 0.05, max: 0.9, step: 0.05 }, {
      anatomy: 'structure',
      sensitivity_enabled: false,
      priority: 40,
    }),
  ];
  const overrides: Record<string, ManifestOverride> = {
    swing_lookback: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 100, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    swing_lookahead: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 95, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_drop_pct: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 90, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_void_bars: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 90, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_base_bars: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 90, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_score: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: false, priority: 40 },
    max_bases: { anatomy: 'risk_controls', sweep_enabled: false, sensitivity_enabled: false, identity_preserving: false },
    max_scan_bars: { anatomy: 'risk_controls', sweep_enabled: false, sensitivity_enabled: false, identity_preserving: false },
  };
  return mergeManifestItems(manifest, overrides, extras);
}

function maCrossoverManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const extras = [
    createManifestItem(strategy, { key: 'fast_period', label: 'Fast MA Length', type: 'int', min: 5, max: 100, step: 1 }, {
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'slow_period', label: 'Slow MA Length', type: 'int', min: 20, max: 300, step: 5 }, {
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'ma_type', label: 'MA Type', type: 'enum', options: ['sma', 'ema'] }, {
      anatomy: 'structure',
      sensitivity_enabled: false,
      priority: 70,
    }),
    createManifestItem(strategy, { key: 'volume_multiple', label: 'Volume Multiple', type: 'float', min: 0, max: 5, step: 0.25 }, {
      anatomy: 'regime_filter',
      priority: 60,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'trend_filter', label: 'Trend Filter', type: 'bool' }, {
      anatomy: 'regime_filter',
      sensitivity_enabled: false,
      priority: 50,
    }),
    createManifestItem(strategy, { key: 'confirmation_bars', label: 'Confirmation Bars', type: 'int', min: 0, max: 5, step: 1 }, {
      path: resolvePathForParam(strategy, 'confirmation_bars'),
      anatomy: 'entry_timing',
      priority: 80,
      failure_modes_targeted: ['high_sensitivity', 'high_drawdown'],
    }),
  ];
  const overrides: Record<string, ManifestOverride> = {
    fast_period: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 100, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    slow_period: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 100, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    ma_type: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: false, priority: 70 },
    cross_direction: { anatomy: 'entry_timing', sweep_enabled: false, sensitivity_enabled: false, identity_preserving: false },
    volume_multiple: { anatomy: 'regime_filter', sweep_enabled: true, sensitivity_enabled: true, priority: 60, failure_modes_targeted: ['high_drawdown'] },
    lookback_bars: { anatomy: 'risk_controls', sweep_enabled: false, sensitivity_enabled: false, identity_preserving: false },
    trend_filter: { anatomy: 'regime_filter', sweep_enabled: true, sensitivity_enabled: false, priority: 50 },
    confirmation_bars: {
      path: resolvePathForParam(strategy, 'confirmation_bars'),
      anatomy: 'entry_timing',
      sweep_enabled: true,
      sensitivity_enabled: true,
      priority: 80,
      failure_modes_targeted: ['high_sensitivity', 'high_drawdown'],
    },
  };
  return mergeManifestItems(manifest, overrides, extras);
}

function fibSignalTriggerManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const extras = [
    createManifestItem(strategy, { key: 'fib_proximity', label: 'Fib Proximity', type: 'float', min: 0.5, max: 10, step: 0.5 }, {
      path: 'setup_config.fib_proximity',
      anatomy: 'entry_timing',
      priority: 90,
      failure_modes_targeted: ['high_sensitivity', 'high_drawdown', 'low_trade_count'],
    }),
    createManifestItem(strategy, {
      key: 'trigger_allowed_signals',
      label: 'Allowed Trigger Signals',
      type: 'enum',
      options: ['POTENTIAL_ENTRY', 'CONFIRMED_ENTRY'],
    }, {
      path: 'setup_config.trigger_allowed_signals',
      anatomy: 'entry_timing',
      sensitivity_enabled: false,
      priority: 55,
      failure_modes_targeted: ['high_drawdown'],
    }),
  ];
  const overrides: Record<string, ManifestOverride> = {
    fib_proximity: {
      anatomy: 'entry_timing',
      sweep_enabled: true,
      sensitivity_enabled: true,
      priority: 90,
      failure_modes_targeted: ['high_sensitivity', 'high_drawdown', 'low_trade_count'],
    },
    trigger_allowed_signals: {
      anatomy: 'entry_timing',
      sweep_enabled: true,
      sensitivity_enabled: false,
      priority: 55,
      failure_modes_targeted: ['high_drawdown'],
    },
  };
  return mergeManifestItems(manifest, overrides, extras);
}

function wyckoffAccumulationManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const extras = [
    createManifestItem(strategy, { key: 'pullback_retracement_min', label: 'Min Retracement', type: 'float', min: 0.2, max: 0.5, step: 0.05 }, {
      anatomy: 'location',
      priority: 85,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'pullback_retracement_max', label: 'Max Retracement', type: 'float', min: 0.8, max: 5.0, step: 0.2 }, {
      anatomy: 'location',
      priority: 85,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'breakout_pct_above', label: 'Breakout % Above', type: 'float', min: 0.0, max: 0.05, step: 0.005 }, {
      path: 'entry_config.breakout_pct_above',
      anatomy: 'entry_timing',
      priority: 70,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'confirmation_bars', label: 'Confirmation Bars', type: 'int', min: 0, max: 5, step: 1 }, {
      path: 'entry_config.confirmation_bars',
      anatomy: 'entry_timing',
      priority: 65,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'swing_epsilon_pct', label: 'RDP Epsilon %', type: 'float', min: 0.01, max: 0.15, step: 0.01 }, {
      path: 'structure_config.swing_epsilon_pct',
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));

  const overrides: Record<string, ManifestOverride> = {
    min_prominence: { anatomy: 'structure', priority: 95, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_markdown_pct: { anatomy: 'structure', priority: 90, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    peak_lookback: { anatomy: 'structure', priority: 85, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    score_min: { anatomy: 'structure', sensitivity_enabled: false, priority: 35 },
  };

  return mergeManifestItems(manifest, overrides, extras);
}

function pullbackUptrendManifest(strategy: StrategySpec): StrategyParameterManifestItem[] {
  const items = [
    createManifestItem(strategy, { key: 'swing_epsilon_pct', label: 'RDP Epsilon %', type: 'float', min: 0.01, max: 0.15, step: 0.01 }, {
      path: 'structure_config.swing_epsilon_pct',
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'required_regime', label: 'Required Regime', type: 'enum', options: ['expansion', 'neutral', 'contraction'] }, {
      path: findCompositeStageParamPath(strategy, /regime|gate|filter|state/, 'required_regime'),
      anatomy: 'regime_filter',
      sweep_enabled: true,
      sensitivity_enabled: false,
      priority: 60,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'atr_multiplier', label: 'ATR Multiplier', type: 'float', min: 0.75, max: 3.0, step: 0.25 }, {
      path: 'risk_config.atr_multiplier',
      anatomy: 'stop_loss',
      priority: 95,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'take_profit_R', label: 'Take Profit R', type: 'float', min: 1.5, max: 14.0, step: 0.5 }, {
      path: 'risk_config.take_profit_R',
      anatomy: 'take_profit',
      priority: 95,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'max_hold_bars', label: 'Max Hold Bars', type: 'int', min: 13, max: 90, step: 1 }, {
      path: 'risk_config.max_hold_bars',
      anatomy: 'take_profit',
      priority: 85,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'max_concurrent_positions', label: 'Max Concurrent Positions', type: 'int', min: 1, max: 20, step: 1 }, {
      path: 'risk_config.max_concurrent_positions',
      anatomy: 'risk_controls',
      priority: 60,
      failure_modes_targeted: ['high_drawdown'],
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));
  return items;
}

function baseBoxManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const patternType = patternTypeForStrategy(strategy, familyDef);
  const isHybrid = patternType.includes('hybrid');
  const isPrimitive = patternType.includes('primitive');
  const overrides: Record<string, ManifestOverride> = {
    epsilon_pct: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 100, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    base_lookbacks: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: false, priority: 90, failure_modes_targeted: ['low_trade_count'] },
    min_base_bars: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 95, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    max_base_range_pct: { anatomy: 'location', sweep_enabled: true, sensitivity_enabled: true, priority: 85, failure_modes_targeted: ['high_drawdown', 'high_sensitivity'] },
    top_tolerance_pct: { anatomy: 'location', sweep_enabled: true, sensitivity_enabled: true, priority: 75, failure_modes_targeted: ['high_sensitivity'] },
    bottom_tolerance_pct: { anatomy: 'location', sweep_enabled: true, sensitivity_enabled: true, priority: 75, failure_modes_targeted: ['high_sensitivity'] },
    min_top_touches: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 80, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_bottom_touches: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 80, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_total_pivots: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 80, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_pivot_switches: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 80, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    max_slope_pct_per_bar: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 80, failure_modes_targeted: ['high_sensitivity', 'high_drawdown'] },
    max_trendiness: { anatomy: 'regime_filter', sweep_enabled: true, sensitivity_enabled: true, priority: 70, failure_modes_targeted: ['high_drawdown'] },
    allowed_trends: { anatomy: 'regime_filter', sweep_enabled: true, sensitivity_enabled: false, priority: 65, failure_modes_targeted: ['high_drawdown'] },
    breakout_help_pct: { anatomy: 'entry_timing', sweep_enabled: false, sensitivity_enabled: false, priority: 20 },
    ceiling_escape_pct: { anatomy: 'location', sweep_enabled: true, sensitivity_enabled: true, priority: 50, failure_modes_targeted: ['high_drawdown'] },
    floor_escape_pct: { anatomy: 'location', sweep_enabled: true, sensitivity_enabled: true, priority: 50, failure_modes_targeted: ['high_drawdown'] },
    overlap_threshold: { anatomy: 'risk_controls', sweep_enabled: false, sensitivity_enabled: false, priority: 20 },
    max_scan_bars: { anatomy: 'risk_controls', sweep_enabled: false, sensitivity_enabled: false, identity_preserving: false, priority: 10 },
    emit_when_missing: { anatomy: 'risk_controls', sweep_enabled: false, sensitivity_enabled: false, identity_preserving: false, priority: 5 },
  };

  const extras = isHybrid ? [
    createManifestItem(strategy, { key: 'swing_epsilon_pct', label: 'RDP Epsilon %', type: 'float', min: 0.01, max: 0.15, step: 0.01 }, {
      path: 'structure_config.swing_epsilon_pct',
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
  ] : [];

  if (isPrimitive) {
    overrides.min_total_pivots = { ...overrides.min_total_pivots, sweep_enabled: false, sensitivity_enabled: false };
    overrides.min_pivot_switches = { ...overrides.min_pivot_switches, sweep_enabled: false, sensitivity_enabled: false };
  }

  return mergeManifestItems(manifest, overrides, extras);
}

function compressionBoxManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const overrides: Record<string, ManifestOverride> = {
    epsilon_pct: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 100, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    base_lookbacks: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: false, priority: 90, failure_modes_targeted: ['low_trade_count'] },
    max_width_atr: { anatomy: 'location', sweep_enabled: true, sensitivity_enabled: true, priority: 95, failure_modes_targeted: ['high_drawdown', 'high_sensitivity'] },
    max_efficiency_ratio: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 90, failure_modes_targeted: ['high_sensitivity'] },
    max_slope_atr_per_bar: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 90, failure_modes_targeted: ['high_sensitivity', 'high_drawdown'] },
    min_recurrence: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 85, failure_modes_targeted: ['low_trade_count', 'high_sensitivity'] },
    min_final_score: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: false, priority: 40 },
  };

  const extras = [
    createManifestItem(strategy, { key: 'min_base_bars', label: 'Min Base Bars', type: 'int', min: 10, max: 180, step: 5 }, {
      anatomy: 'structure',
      priority: 85,
      failure_modes_targeted: ['low_trade_count', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'min_top_touches', label: 'Min Top Touches', type: 'int', min: 1, max: 6, step: 1 }, {
      anatomy: 'structure',
      priority: 70,
      failure_modes_targeted: ['high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'min_bottom_touches', label: 'Min Bottom Touches', type: 'int', min: 1, max: 6, step: 1 }, {
      anatomy: 'structure',
      priority: 70,
      failure_modes_targeted: ['high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'min_pivot_switches', label: 'Min Pivot Switches', type: 'int', min: 1, max: 12, step: 1 }, {
      anatomy: 'structure',
      priority: 75,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
  ];

  return mergeManifestItems(manifest, overrides, extras);
}

function wiggleBaseManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const overrides: Record<string, ManifestOverride> = {
    epsilon_coarse: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 100, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    epsilon_fine: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 95, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_base_bars: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 90, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    max_base_range_pct: { anatomy: 'location', sweep_enabled: true, sensitivity_enabled: true, priority: 85, failure_modes_targeted: ['high_drawdown', 'high_sensitivity'] },
    min_top_touches: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 80, failure_modes_targeted: ['high_sensitivity'] },
    min_bottom_touches: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 80, failure_modes_targeted: ['high_sensitivity'] },
    min_wiggle_score: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: true, priority: 90, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    require_volume_compression: { anatomy: 'regime_filter', sweep_enabled: true, sensitivity_enabled: false, priority: 70, failure_modes_targeted: ['high_drawdown'] },
    max_quiet_ratio: { anatomy: 'regime_filter', sweep_enabled: true, sensitivity_enabled: true, priority: 75, failure_modes_targeted: ['high_drawdown', 'high_sensitivity'] },
    min_final_score: { anatomy: 'structure', sweep_enabled: true, sensitivity_enabled: false, priority: 40 },
  };
  return mergeManifestItems(manifest, overrides);
}

function wyckoffAccumulationMajorManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  const manifest = genericManifestFromDefinition(strategy, familyDef);
  const extras = [
    createManifestItem(strategy, { key: 'breakout_pct_above', label: 'Breakout % Above', type: 'float', min: 0.0, max: 0.05, step: 0.005 }, {
      path: 'entry_config.breakout_pct_above',
      anatomy: 'entry_timing',
      priority: 70,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'confirmation_bars', label: 'Confirmation Bars', type: 'int', min: 1, max: 10, step: 1 }, {
      path: 'entry_config.confirmation_bars',
      anatomy: 'entry_timing',
      priority: 65,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'swing_left_bars', label: 'Swing Left Bars', type: 'int', min: 3, max: 25, step: 1 }, {
      path: 'structure_config.swing_left_bars',
      anatomy: 'structure',
      priority: 85,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'swing_right_bars', label: 'Swing Right Bars', type: 'int', min: 3, max: 25, step: 1 }, {
      path: 'structure_config.swing_right_bars',
      anatomy: 'structure',
      priority: 85,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
  ];
  const overrides: Record<string, ManifestOverride> = {
    min_prominence: { anatomy: 'structure', priority: 95, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    min_markdown_pct: { anatomy: 'structure', priority: 90, failure_modes_targeted: ['high_sensitivity', 'low_trade_count'] },
    breakout_confirm_bars: { anatomy: 'entry_timing', priority: 75, failure_modes_targeted: ['high_drawdown', 'high_sensitivity'] },
    score_min: { anatomy: 'structure', sensitivity_enabled: false, priority: 40 },
  };
  return mergeManifestItems(manifest, overrides, extras);
}

function obRegimeLongManifest(strategy: StrategySpec): StrategyParameterManifestItem[] {
  return [
    createManifestItem(strategy, { key: 'required_regime', label: 'Required Regime', type: 'enum', options: ['expansion', 'distribution', 'any'] }, {
      path: findCompositeStageParamPath(strategy, /regime/, 'required_regime'),
      anatomy: 'regime_filter',
      priority: 85,
      sensitivity_enabled: false,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'reference_symbol', label: 'Regime Reference Symbol', type: 'string' }, {
      path: findCompositeStageParamPath(strategy, /regime/, 'reference_symbol'),
      anatomy: 'regime_filter',
      sweep_enabled: false,
      sensitivity_enabled: false,
      identity_preserving: false,
      priority: 20,
    }),
    createManifestItem(strategy, { key: 'regime_epsilon_pct', label: 'Regime Epsilon %', type: 'float', min: 0.01, max: 0.1, step: 0.005 }, {
      path: findCompositeStageParamPath(strategy, /regime/, 'epsilon_pct'),
      anatomy: 'regime_filter',
      priority: 70,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'order_block_epsilon_pct', label: 'Order Block Epsilon %', type: 'float', min: 0.005, max: 0.1, step: 0.005 }, {
      path: findCompositeStageParamPath(strategy, /order/, 'epsilon_pct'),
      anatomy: 'structure',
      priority: 95,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'atr_multiplier', label: 'ATR Multiplier', type: 'float', min: 0.75, max: 3.0, step: 0.25 }, {
      path: 'risk_config.atr_multiplier',
      anatomy: 'stop_loss',
      priority: 95,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'target_r', label: 'Target R', type: 'float', min: 1.0, max: 5.0, step: 0.25 }, {
      path: 'exit_config.target_r',
      anatomy: 'take_profit',
      priority: 85,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));
}

function rdpFibPullbackCompositeManifest(strategy: StrategySpec): StrategyParameterManifestItem[] {
  return [
    createManifestItem(strategy, { key: 'swing_epsilon_pct', label: 'RDP Epsilon %', type: 'float', min: 0.01, max: 0.15, step: 0.01 }, {
      path: 'structure_config.swing_epsilon_pct',
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'location_min_retracement_pct', label: 'Min Retracement %', type: 'float', min: 20, max: 80, step: 5 }, {
      path: findCompositeStageParamPath(strategy, /location|fib/, 'location_min_retracement_pct'),
      anatomy: 'location',
      priority: 90,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'location_max_retracement_pct', label: 'Max Retracement %', type: 'float', min: 40, max: 90, step: 5 }, {
      path: findCompositeStageParamPath(strategy, /location|fib/, 'location_max_retracement_pct'),
      anatomy: 'location',
      priority: 90,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'location_require_near_level', label: 'Require Near Fib Level', type: 'bool' }, {
      path: findCompositeStageParamPath(strategy, /location|fib/, 'location_require_near_level'),
      anatomy: 'location',
      sensitivity_enabled: false,
      priority: 55,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'atr_multiplier', label: 'ATR Multiplier', type: 'float', min: 0.75, max: 3.0, step: 0.25 }, {
      path: 'risk_config.atr_multiplier',
      anatomy: 'stop_loss',
      priority: 85,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'take_profit_R', label: 'Take Profit R', type: 'float', min: 1.0, max: 6.0, step: 0.25 }, {
      path: 'risk_config.take_profit_R',
      anatomy: 'take_profit',
      priority: 80,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'max_hold_bars', label: 'Max Hold Bars', type: 'int', min: 10, max: 90, step: 5 }, {
      path: 'risk_config.max_hold_bars',
      anatomy: 'take_profit',
      priority: 75,
      failure_modes_targeted: ['high_drawdown'],
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));
}

function trendFollowingRegimeManifest(strategy: StrategySpec): StrategyParameterManifestItem[] {
  return [
    createManifestItem(strategy, { key: 'fast_period', label: 'Fast MA Length', type: 'int', min: 5, max: 100, step: 1 }, {
      path: findCompositeStageParamPath(strategy, /timing|cross|ma/, 'fast_period'),
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'slow_period', label: 'Slow MA Length', type: 'int', min: 20, max: 300, step: 5 }, {
      path: findCompositeStageParamPath(strategy, /timing|cross|ma/, 'slow_period'),
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'ma_type', label: 'MA Type', type: 'enum', options: ['sma', 'ema'] }, {
      path: findCompositeStageParamPath(strategy, /timing|cross|ma/, 'ma_type'),
      anatomy: 'structure',
      sensitivity_enabled: false,
      priority: 65,
    }),
    createManifestItem(strategy, { key: 'required_regime', label: 'Required Regime', type: 'enum', options: ['expansion', 'distribution', 'any'] }, {
      path: findCompositeStageParamPath(strategy, /regime/, 'required_regime'),
      anatomy: 'regime_filter',
      sensitivity_enabled: false,
      priority: 70,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'reference_symbol', label: 'Regime Reference Symbol', type: 'string' }, {
      path: findCompositeStageParamPath(strategy, /regime/, 'reference_symbol'),
      anatomy: 'regime_filter',
      sweep_enabled: false,
      sensitivity_enabled: false,
      identity_preserving: false,
      priority: 20,
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));
}

function rdpExhaustionCompositeManifest(strategy: StrategySpec): StrategyParameterManifestItem[] {
  return [
    createManifestItem(strategy, { key: 'energy_swing_epsilon_pct', label: 'Swing Epsilon %', type: 'float', min: 0.01, max: 0.15, step: 0.01 }, {
      path: 'setup_config.composite_spec.branches.0.condition.params_first.epsilon_pct',
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'energy_window', label: 'Energy Window', type: 'int', min: 1, max: 10, step: 1 }, {
      path: 'setup_config.composite_spec.branches.0.condition.params_first.energy_window',
      anatomy: 'entry_timing',
      priority: 85,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'energy_pressure_max', label: 'Max Energy Pressure', type: 'float', min: 5, max: 50, step: 1 }, {
      path: 'setup_config.composite_spec.branches.0.condition.params_second.energy_pressure_max',
      anatomy: 'regime_filter',
      priority: 80,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'energy_require_declining_pressure', label: 'Require Declining Pressure', type: 'bool' }, {
      path: 'setup_config.composite_spec.branches.0.condition.params_second.energy_require_declining_pressure',
      anatomy: 'regime_filter',
      sensitivity_enabled: false,
      priority: 55,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'location_min_retracement_pct', label: 'Min Retracement %', type: 'float', min: 20, max: 80, step: 5 }, {
      path: 'setup_config.composite_spec.branches.0.then.params.location_min_retracement_pct',
      anatomy: 'location',
      priority: 85,
      failure_modes_targeted: ['high_sensitivity', 'high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'location_max_retracement_pct', label: 'Max Retracement %', type: 'float', min: 40, max: 90, step: 5 }, {
      path: 'setup_config.composite_spec.branches.0.then.params.location_max_retracement_pct',
      anatomy: 'location',
      priority: 85,
      failure_modes_targeted: ['high_sensitivity', 'high_drawdown'],
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));
}

function baseBreakoutEntryCompositeManifest(strategy: StrategySpec): StrategyParameterManifestItem[] {
  return [
    createManifestItem(strategy, { key: 'swing_epsilon_pct', label: 'RDP Epsilon %', type: 'float', min: 0.01, max: 0.15, step: 0.01 }, {
      path: 'structure_config.swing_epsilon_pct',
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'base_min_wiggle_score', label: 'Min Wiggle Score', type: 'float', min: 0.1, max: 0.95, step: 0.05 }, {
      path: findCompositeStageParamPath(strategy, /base_detection|wiggle|base/, 'min_wiggle_score'),
      anatomy: 'structure',
      priority: 90,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'base_min_base_bars', label: 'Min Base Bars', type: 'int', min: 10, max: 120, step: 2 }, {
      path: findCompositeStageParamPath(strategy, /base_detection|wiggle|base/, 'min_base_bars'),
      anatomy: 'structure',
      priority: 85,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'breakout_margin_pct', label: 'Breakout Margin %', type: 'float', min: 0.01, max: 0.1, step: 0.005 }, {
      path: findCompositeStageParamPath(strategy, /breakout|retest/, 'breakout_margin_pct'),
      anatomy: 'entry_timing',
      priority: 80,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'entry_zone_pct', label: 'Entry Zone %', type: 'float', min: 0.05, max: 1.0, step: 0.05 }, {
      path: findCompositeStageParamPath(strategy, /breakout|retest/, 'entry_zone_pct'),
      anatomy: 'location',
      priority: 80,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'coarse_scale', label: 'Coarse Scale', type: 'float', min: 1.5, max: 5.0, step: 0.5 }, {
      path: findCompositeStageParamPath(strategy, /breakout|retest/, 'coarse_scale'),
      anatomy: 'structure',
      priority: 75,
      failure_modes_targeted: ['high_sensitivity'],
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));
}

function rdpFibPullbackRsiCompositeManifest(strategy: StrategySpec): StrategyParameterManifestItem[] {
  return [
    createManifestItem(strategy, { key: 'swing_epsilon_pct', label: 'RDP Epsilon %', type: 'float', min: 0.01, max: 0.15, step: 0.01 }, {
      path: 'structure_config.swing_epsilon_pct',
      anatomy: 'structure',
      priority: 100,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'rally_threshold_pct', label: 'Rally Threshold %', type: 'float', min: 0.05, max: 0.4, step: 0.01 }, {
      path: findCompositeStageParamPath(strategy, /node_1|impulse|trough/, 'rally_threshold_pct'),
      anatomy: 'structure',
      priority: 90,
      failure_modes_targeted: ['high_sensitivity', 'low_trade_count'],
    }),
    createManifestItem(strategy, { key: 'location_min_retracement_pct', label: 'Min Retracement %', type: 'float', min: 20, max: 80, step: 5 }, {
      path: findCompositeStageParamPath(strategy, /node_2|location|fib/, 'location_min_retracement_pct'),
      anatomy: 'location',
      priority: 85,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'location_max_retracement_pct', label: 'Max Retracement %', type: 'float', min: 40, max: 90, step: 5 }, {
      path: findCompositeStageParamPath(strategy, /node_2|location|fib/, 'location_max_retracement_pct'),
      anatomy: 'location',
      priority: 85,
      failure_modes_targeted: ['high_drawdown', 'high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'location_require_near_level', label: 'Require Near Fib Level', type: 'bool' }, {
      path: findCompositeStageParamPath(strategy, /node_2|location|fib/, 'location_require_near_level'),
      anatomy: 'location',
      sensitivity_enabled: false,
      priority: 60,
      failure_modes_targeted: ['high_drawdown'],
    }),
    createManifestItem(strategy, { key: 'rsi_period', label: 'RSI Period', type: 'int', min: 2, max: 50, step: 1 }, {
      path: findCompositeStageParamPath(strategy, /node_3|rsi/, 'rsi_period'),
      anatomy: 'entry_timing',
      priority: 75,
      failure_modes_targeted: ['high_sensitivity'],
    }),
    createManifestItem(strategy, { key: 'oversold_level', label: 'Oversold Level', type: 'float', min: 5, max: 50, step: 1 }, {
      path: findCompositeStageParamPath(strategy, /node_3|rsi/, 'oversold_level'),
      anatomy: 'entry_timing',
      priority: 70,
      failure_modes_targeted: ['high_sensitivity', 'high_drawdown'],
    }),
  ].filter((item): item is StrategyParameterManifestItem => Boolean(item));
}

const FAMILY_MANIFEST_BUILDERS: Record<string, (strategy: StrategySpec, familyDef?: PatternDefinition) => StrategyParameterManifestItem[]> = {
  base_breakout_entry_composite: baseBreakoutEntryCompositeManifest,
  base_box_detector_rdp_hybrid_v1_pattern: baseBoxManifest,
  base_box_detector_rdp_v1_pattern: baseBoxManifest,
  base_box_detector_v1_primitive: baseBoxManifest,
  compression_box_recurrence_v1_pattern: compressionBoxManifest,
  density_base_detector_v1_pattern: densityBaseManifest,
  density_base_detector_v2_pattern: densityBaseManifest,
  fib_signal_trigger_primitive: fibSignalTriggerManifest,
  ma_crossover: maCrossoverManifest,
  ob_regime_long_entry_composite: obRegimeLongManifest,
  wyckoff_accumulation_rdp: wyckoffAccumulationManifest,
  wyckoff_accumulation_major_v2: wyckoffAccumulationMajorManifest,
  pullback_uptrend_entry_composite: pullbackUptrendManifest,
  rdp_exhaustion_entry_composite: rdpExhaustionCompositeManifest,
  rdp_fib_pullback_entry_composite: rdpFibPullbackCompositeManifest,
  rdp_fib_pullback_rsi_entry_composite: rdpFibPullbackRsiCompositeManifest,
  trend_following_with_regime_gate_composite: trendFollowingRegimeManifest,
  wiggle_base_box_v2_pattern: wiggleBaseManifest,
};

function patternTypeForStrategy(strategy: StrategySpec, familyDef?: PatternDefinition): string {
  return normalizePatternType(strategy?.setup_config?.pattern_type || familyDef?.pattern_type || strategy?.strategy_id);
}

export function resolveStrategyParameterManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategyParameterManifestItem[] {
  if (Array.isArray(strategy?.parameter_manifest) && strategy.parameter_manifest.length > 0) {
    return strategy.parameter_manifest
      .map(item => normalizeManifestItem(item))
      .filter((item): item is StrategyParameterManifestItem => Boolean(item));
  }

  const patternType = patternTypeForStrategy(strategy, familyDef);
  const builder = FAMILY_MANIFEST_BUILDERS[patternType];
  if (builder) {
    return builder(strategy, familyDef)
      .map(item => normalizeManifestItem(item))
      .filter((item): item is StrategyParameterManifestItem => Boolean(item));
  }

  return genericManifestFromDefinition(strategy, familyDef);
}

export function applyParameterManifest(strategy: StrategySpec, familyDef?: PatternDefinition): StrategySpec {
  const manifest = resolveStrategyParameterManifest(strategy, familyDef);
  if (!manifest.length) return strategy;
  return {
    ...strategy,
    parameter_manifest: manifest,
  };
}

type DefinitionResolver = (patternId: string) => PatternDefinition | null | undefined;

function safeObject(value: any): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function compositeStageAnatomy(stageId: string, patternId: string, childDef?: PatternDefinition | null): StrategyParameterManifestItem['anatomy'] {
  const roleText = `${stageId} ${patternId} ${childDef?.indicator_role || ''} ${childDef?.pattern_role || ''}`.toLowerCase();
  if (roleText.includes('regime') || roleText.includes('gate') || roleText.includes('filter') || roleText.includes('state')) return 'regime_filter';
  if (roleText.includes('location') || roleText.includes('fib')) return 'location';
  if (roleText.includes('timing') || roleText.includes('trigger') || roleText.includes('signal') || roleText.includes('entry') || roleText.includes('divergence') || roleText.includes('rsi') || roleText.includes('cross')) return 'entry_timing';
  return 'structure';
}

function uniqueTunableParams(params: RawTunableParam[]): RawTunableParam[] {
  const seen = new Set<string>();
  const out: RawTunableParam[] = [];
  params.forEach((param) => {
    const key = String(param.key || '').trim();
    const path = String(param.path || '').trim();
    const fingerprint = `${key}|${path}`;
    if (!key || !path || seen.has(fingerprint)) return;
    seen.add(fingerprint);
    out.push(param);
  });
  return out;
}

function buildCompositeTunableParam(
  stageLabel: string,
  paramKey: string,
  path: string,
  currentValue: any,
  childParam?: Record<string, any> | null,
  anatomy?: StrategyParameterManifestItem['anatomy'],
): RawTunableParam {
  const key = `${stageLabel.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()}_${paramKey}`;
  return {
    key,
    label: `${stageLabel}: ${String(childParam?.label || paramKey)}`,
    path,
    type: String(childParam?.type || typeof currentValue === 'number'
      ? Number.isInteger(currentValue) ? 'int' : 'float'
      : typeof currentValue === 'boolean'
      ? 'bool'
      : 'enum'),
    min: typeof childParam?.min === 'number' ? childParam.min : undefined,
    max: typeof childParam?.max === 'number' ? childParam.max : undefined,
    step: typeof childParam?.step === 'number' ? childParam.step : undefined,
    default: childParam?.default ?? currentValue,
    options: Array.isArray(childParam?.options) ? childParam.options : undefined,
    description: childParam?.description ? String(childParam.description) : undefined,
    anatomy,
    identity_preserving: true,
    sweep_enabled: true,
    sensitivity_enabled: typeof currentValue === 'number',
  };
}

function inferStageParams(
  stage: Record<string, any>,
  pathPrefix: string,
  resolveDefinition?: DefinitionResolver,
): RawTunableParam[] {
  const params = safeObject(stage?.params);
  if (!params) return [];
  const stageId = String(stage?.id || stage?.pattern_id || 'stage');
  const patternId = String(stage?.pattern_id || '').trim();
  const childDef = patternId && resolveDefinition ? resolveDefinition(patternId) : null;
  const childTunableMap = new Map<string, Record<string, any>>();
  if (Array.isArray(childDef?.tunable_params)) {
    childDef!.tunable_params.forEach((param: any) => {
      const key = String(param?.key || '').trim();
      if (key) childTunableMap.set(key, param);
    });
  }
  const anatomy = compositeStageAnatomy(stageId, patternId, childDef);
  return Object.entries(params).map(([paramKey, value]) =>
    buildCompositeTunableParam(
      stageId,
      paramKey,
      `${pathPrefix}.params.${paramKey}`,
      value,
      childTunableMap.get(paramKey) || null,
      anatomy,
    )
  );
}

function inferConditionTreeParams(
  condition: Record<string, any> | null,
  pathPrefix: string,
  resolveDefinition?: DefinitionResolver,
): RawTunableParam[] {
  if (!condition) return [];
  const out: RawTunableParam[] = [];
  const pushPrimitiveParams = (
    primitiveId: string,
    paramsValue: any,
    paramsPath: string,
    stageLabel: string,
  ) => {
    const params = safeObject(paramsValue);
    if (!primitiveId || !params) return;
    const childDef = resolveDefinition ? resolveDefinition(primitiveId) : null;
    const childTunableMap = new Map<string, Record<string, any>>();
    if (Array.isArray(childDef?.tunable_params)) {
      childDef!.tunable_params.forEach((param: any) => {
        const key = String(param?.key || '').trim();
        if (key) childTunableMap.set(key, param);
      });
    }
    const anatomy = compositeStageAnatomy(stageLabel, primitiveId, childDef);
    Object.entries(params).forEach(([paramKey, value]) => {
      out.push(
        buildCompositeTunableParam(
          stageLabel,
          paramKey,
          `${paramsPath}.${paramKey}`,
          value,
          childTunableMap.get(paramKey) || null,
          anatomy,
        ),
      );
    });
  };

  const conditionType = String(condition.type || '').trim().toLowerCase();
  if (conditionType === 'op') {
    out.push(...inferConditionTreeParams(safeObject(condition.left), `${pathPrefix}.left`, resolveDefinition));
    out.push(...inferConditionTreeParams(safeObject(condition.right), `${pathPrefix}.right`, resolveDefinition));
    out.push(...inferConditionTreeParams(safeObject(condition.condition), `${pathPrefix}.condition`, resolveDefinition));
  }

  if (conditionType === 'check' || conditionType === 'score' || conditionType === 'cooldown') {
    pushPrimitiveParams(String(condition.primitive_id || ''), condition.params, `${pathPrefix}.params`, String(condition.primitive_id || 'condition'));
  }
  if (conditionType === 'compare') {
    pushPrimitiveParams(String(condition.primitive_a || ''), condition.params_a, `${pathPrefix}.params_a`, String(condition.primitive_a || 'compare_a'));
    pushPrimitiveParams(String(condition.primitive_b || ''), condition.params_b, `${pathPrefix}.params_b`, String(condition.primitive_b || 'compare_b'));
  }
  if (conditionType === 'sequence') {
    pushPrimitiveParams(String(condition.first_id || ''), condition.params_first, `${pathPrefix}.params_first`, String(condition.first_id || 'sequence_first'));
    pushPrimitiveParams(String(condition.second_id || ''), condition.params_second, `${pathPrefix}.params_second`, String(condition.second_id || 'sequence_second'));
  }
  if (conditionType === 'regime') {
    pushPrimitiveParams(String(condition.regime_id || ''), condition.params_regime, `${pathPrefix}.params_regime`, String(condition.regime_id || 'regime'));
    pushPrimitiveParams(String(condition.signal_id || ''), condition.params_signal, `${pathPrefix}.params_signal`, String(condition.signal_id || 'signal'));
  }

  return out;
}

function inferCompositeTunableParams(definition: PatternDefinition, resolveDefinition?: DefinitionResolver): RawTunableParam[] {
  const compositeSpec = safeObject(definition?.default_setup_params?.composite_spec);
  if (!compositeSpec) return [];

  const out: RawTunableParam[] = [];
  const stages = Array.isArray(compositeSpec.stages) ? compositeSpec.stages : [];
  stages.forEach((stage: any, idx: number) => {
    out.push(...inferStageParams(safeObject(stage) || {}, `setup_config.composite_spec.stages.${idx}`, resolveDefinition));
  });

  const branches = Array.isArray(compositeSpec.branches) ? compositeSpec.branches : [];
  branches.forEach((branch: any, idx: number) => {
    const branchObj = safeObject(branch);
    if (!branchObj) return;
    out.push(...inferConditionTreeParams(safeObject(branchObj.condition), `setup_config.composite_spec.branches.${idx}.condition`, resolveDefinition));
    if (safeObject(branchObj.then)) {
      out.push(...inferStageParams(branchObj.then as Record<string, any>, `setup_config.composite_spec.branches.${idx}.then`, resolveDefinition));
    }
    if (safeObject(branchObj.else)) {
      out.push(...inferStageParams(branchObj.else as Record<string, any>, `setup_config.composite_spec.branches.${idx}.else`, resolveDefinition));
    }
  });

  return uniqueTunableParams(out);
}

export function normalizeDefinitionTunableParams(
  definition: PatternDefinition,
  resolveDefinition?: DefinitionResolver,
): PatternDefinition {
  if (!definition || typeof definition !== 'object') return definition;
  const existing = Array.isArray(definition.tunable_params) ? definition.tunable_params.filter(Boolean) : [];
  if (existing.length > 0) {
    return {
      ...definition,
      tunable_params: existing,
    };
  }

  if (String(definition.composition || '').trim().toLowerCase() !== 'composite') {
    return definition;
  }

  const inferred = inferCompositeTunableParams(definition, resolveDefinition);
  if (!inferred.length) return definition;

  return {
    ...definition,
    tunable_params: inferred,
  };
}
