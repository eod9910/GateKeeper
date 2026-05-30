let strategyBuilderSignals = [];

const STRATEGY_BUILDER_FUNDAMENTAL_METRICS = [
  {
    pattern_id: 'dcf_long',
    name: 'DCF Long',
    search_tags: ['fundamental', 'fundamental_metric', 'valuation', 'dcf', 'fair_value', 'undervalued', 'long'],
    trade_bias: 'long',
    runtime_pattern_type: 'valuation_state_primitive',
    runtime_setup: {
      target_state: 'undervalued',
      signal_mode: 'current_state',
      gap_threshold_pct: 20.0,
      direction: 'long',
      indicator_role: 'filter',
    },
  },
  {
    pattern_id: 'dcf_short',
    name: 'DCF Short',
    search_tags: ['fundamental', 'fundamental_metric', 'valuation', 'dcf', 'fair_value', 'overvalued', 'short'],
    trade_bias: 'short',
    runtime_pattern_type: 'valuation_state_primitive',
    runtime_setup: {
      target_state: 'overvalued',
      signal_mode: 'current_state',
      gap_threshold_pct: 20.0,
      direction: 'short',
      indicator_role: 'filter',
    },
  },
  {
    pattern_id: 'pe_ratio_metric',
    name: 'P/E Ratio',
    search_tags: ['fundamental_metric', 'valuation', 'pe', 'p_e', 'price_to_earnings', 'earnings'],
  },
  {
    pattern_id: 'price_to_sales_metric',
    name: 'Price / Sales',
    search_tags: ['fundamental_metric', 'valuation', 'price_to_sales', 'p_s', 'sales', 'revenue'],
  },
  {
    pattern_id: 'eps_metric',
    name: 'Earnings Per Share',
    search_tags: ['fundamental_metric', 'eps', 'earnings_per_share', 'earnings'],
  },
  {
    pattern_id: 'earnings_growth_metric',
    name: 'Earnings Growth',
    search_tags: ['fundamental_metric', 'earnings', 'growth'],
  },
  {
    pattern_id: 'revenue_growth_metric',
    name: 'Revenue Growth',
    search_tags: ['fundamental_metric', 'revenue', 'sales', 'growth'],
  },
  {
    pattern_id: 'free_cash_flow_metric',
    name: 'Free Cash Flow',
    search_tags: ['fundamental_metric', 'free_cash_flow', 'fcf', 'cash_flow'],
  },
  {
    pattern_id: 'debt_to_equity_metric',
    name: 'Debt / Equity',
    search_tags: ['fundamental_metric', 'debt', 'equity', 'balance_sheet'],
  },
].map((row) => ({
  ...row,
  artifact_type: 'indicator',
  composition: 'primitive',
  category: 'fundamental_analysis',
  indicator_role: 'fundamental_metric',
  canonical_role: 'fundamental_metric',
  source_kind: 'built_in_fundamental_metric',
  signal_tag: 'fundamental',
  source_category: 'fundamental_primitive',
}));

function sbEl(id) {
  return document.getElementById(id);
}

function sbSetStatus(message, isError = false) {
  const el = sbEl('sb-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--color-negative)' : 'var(--color-text-subtle)';
}

function sbSlugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function sbNormalizeUniverse(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

function sbSignalType(row) {
  const artifactType = String(row?.artifact_type || '').toLowerCase();
  const composition = String(row?.composition || '').toLowerCase();
  if (composition === 'composite') return 'composite';
  if (artifactType === 'pattern') return 'pattern';
  return 'primitive';
}

function sbIsFundamentalSignal(row) {
  const category = String(row?.category || '').trim().toLowerCase();
  const sourceKind = String(row?.source_kind || '').trim().toLowerCase();
  const role = String(row?.indicator_role || row?.canonical_role || '').trim().toLowerCase();
  if (category === 'fundamental_analysis' || sourceKind === 'built_in_fundamental_metric' || role === 'fundamental_metric') return true;

  const haystack = [
    row?.pattern_id,
    row?.name,
    row?.category,
    row?.indicator_role,
    row?.canonical_role,
    ...(Array.isArray(row?.search_tags) ? row.search_tags : []),
  ].join(' ').toLowerCase();
  if (/\b(filter|quality|survivability|regime|gate)\b/.test(haystack)) return false;
  return /\b(valuation|dcf|fair_value|p\/e|pe_ratio|price_to_earnings|earnings|revenue|cash flow|free_cash_flow|fcf|roe|eps|sales|price_to_sales|debt_to_equity)\b/.test(haystack);
}

function sbSourceFamily(row) {
  const explicitCategory = String(row?.source_category || '').toLowerCase();
  if (explicitCategory === 'technical_analysis') return 'technical_primitive';
  if (explicitCategory === 'fundamental_analysis') return 'fundamental_primitive';
  if (['technical_primitive', 'fundamental_primitive', 'pattern', 'composite'].includes(explicitCategory)) return explicitCategory;
  const explicitTag = String(row?.signal_tag || '').toLowerCase();
  if (explicitTag === 'technical') return 'technical_primitive';
  if (explicitTag === 'fundamental') return 'fundamental_primitive';
  if (explicitTag === 'pattern' || explicitTag === 'composite') return explicitTag;
  const artifactType = String(row?.artifact_type || 'indicator').toLowerCase();
  const composition = String(row?.composition || '').toLowerCase();
  if (composition === 'composite') return 'composite';
  if (artifactType === 'pattern') return 'pattern';
  if (sbIsFundamentalSignal(row)) return 'fundamental_primitive';
  return 'technical_primitive';
}

function sbSourceComposition(family) {
  if (family === 'composite') return 'composite';
  if (family === 'pattern') return 'pattern';
  return 'primitive';
}

function sbSelectedSignal() {
  const patternId = sbEl('sb-source-id')?.value || '';
  return strategyBuilderSignals.find((row) => row.pattern_id === patternId) || null;
}

function sbSelectedSourceFamily() {
  return String(sbEl('sb-source-type')?.value || 'technical_primitive').trim();
}

function sbDefaultStateForSignal(row) {
  if (!row) return '';
  if (sbSourceFamily(row) !== 'composite') return '';
  const role = String(row.indicator_role || row.canonical_role || '').toLowerCase();
  if (role.includes('entry')) return 'entry_ready';
  if (role.includes('exit')) return 'exit_ready';
  if (role.includes('regime')) return 'regime_confirmed';
  return 'entry_ready';
}

function sbStopValueMeta(stopType) {
  if (stopType === 'fixed_pct') {
    return {
      label: 'Fixed Stop %',
      help: 'Enter whole percent points. Example: 6 means a 6% stop.',
      step: '0.1',
      placeholder: '6',
    };
  }
  if (stopType === 'fixed_amount') {
    return {
      label: 'Fixed Amount',
      help: 'Enter a fixed price/point distance from entry. Example: 2 means $2 or 2 points.',
      step: '0.01',
      placeholder: '2',
    };
  }
  return {
    label: 'ATR Multiple',
    help: 'Example: 2 means a 2x ATR stop.',
    step: '0.01',
    placeholder: '2',
  };
}

function sbNormalizeStopValue(stopType, rawValue) {
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value)) return 0;
  if (stopType === 'fixed_pct') return value / 100;
  return value;
}

function sbPercentInputToDecimal(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return number / 100;
}

function sbVersionMode() {
  return String(sbEl('sb-version-mode')?.value || 'backtest').trim() === 'production' ? 'production' : 'backtest';
}

function sbTrailingConfig() {
  const type = String(sbEl('sb-trailing-type')?.value || 'none').trim();
  if (type === 'none') return null;
  const rawValue = Number(sbEl('sb-trailing-value')?.value || 0);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
  return {
    type,
    value: type === 'trailing_pct' ? rawValue / 100 : rawValue,
  };
}

function sbNormalizeExitValue(exitType, rawValue) {
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value)) return 0;
  return exitType === 'fixed_pct' ? value / 100 : value;
}

function sbBacktestExitConfig() {
  const exitType = String(sbEl('sb-exit-type')?.value || 'r_multiple').trim();
  const rawValue = Number(sbEl('sb-exit-value')?.value || 0);
  return {
    target_type: exitType,
    target_level: sbNormalizeExitValue(exitType, rawValue),
  };
}

function sbTargetTypeMeta(targetType) {
  if (targetType === 'r_multiple') {
    return {
      labels: ['TP1 R', 'TP2 R', 'TP3 R'],
      help: 'R multiple targets use the initial stop distance. Example: 2 means take profit at 2R.',
      defaults: ['1', '2', '3'],
    };
  }
  return {
    labels: ['TP1 Target %', 'TP2 Target %', 'TP3 Target %'],
    help: 'Fixed percent values are entered as whole percents. Example: 10 means +10% for a long or -10% for a short.',
    defaults: ['10', '20', '30'],
  };
}

function sbNormalizeTargetValue(targetType, rawValue) {
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value)) return 0;
  return targetType === 'fixed_pct' ? value / 100 : value;
}

function sbBuildTakeProfits(targetType) {
  return [1, 2, 3]
    .map((idx) => {
      const rawTarget = Number(sbEl(`sb-tp${idx}-value`)?.value || 0);
      const rawExitPct = Number(sbEl(`sb-tp${idx}-exit-pct`)?.value || 0);
      const targetValue = sbNormalizeTargetValue(targetType, rawTarget);
      const exitPct = sbPercentInputToDecimal(rawExitPct);
      if (!(targetValue > 0) || !(exitPct > 0)) return null;
      return {
        label: `TP${idx}`,
        target_type: targetType,
        target_value: targetValue,
        exit_pct: exitPct,
      };
    })
    .filter(Boolean);
}

function sbUpdateDynamicLabels() {
  const mode = sbVersionMode();
  document.querySelectorAll('.builder-production-field').forEach((el) => {
    el.classList.toggle('builder-hidden', mode !== 'production');
  });
  document.querySelectorAll('.builder-backtest-field').forEach((el) => {
    el.classList.toggle('builder-hidden', mode !== 'backtest');
  });
  const modeHelp = sbEl('sb-version-mode-help');
  if (modeHelp) {
    modeHelp.textContent = mode === 'production'
      ? 'Production Version can hold staged take profits and trailing management. It is not the clean Validator expectancy object.'
      : 'Backtest Version keeps one stop and one exit so Validator can test expectancy cleanly.';
  }

  const stopType = String(sbEl('sb-stop-type')?.value || 'atr_multiple').trim();
  const meta = sbStopValueMeta(stopType);
  const label = sbEl('sb-stop-value-label');
  const help = sbEl('sb-stop-value-help');
  const input = sbEl('sb-stop-value');
  if (label) label.textContent = meta.label;
  if (help) help.textContent = meta.help;
  if (input) {
    input.step = meta.step;
    input.placeholder = meta.placeholder;
  }

  const trailingType = String(sbEl('sb-trailing-type')?.value || 'none').trim();
  const trailingLabel = sbEl('sb-trailing-value-label');
  const trailingHelp = sbEl('sb-trailing-value-help');
  const trailingInput = sbEl('sb-trailing-value');
  if (trailingType === 'trailing_pct') {
    if (trailingLabel) trailingLabel.textContent = 'Trailing Stop %';
    if (trailingHelp) trailingHelp.textContent = 'Example: 8 means trail by 8%.';
    if (trailingInput) trailingInput.step = '0.1';
  } else if (trailingType === 'trailing_atr') {
    if (trailingLabel) trailingLabel.textContent = 'Trailing ATR Multiple';
    if (trailingHelp) trailingHelp.textContent = 'Example: 2 means trail by 2x ATR.';
    if (trailingInput) trailingInput.step = '0.01';
  } else {
    if (trailingLabel) trailingLabel.textContent = 'Trailing Value';
    if (trailingHelp) trailingHelp.textContent = 'Leave blank when trailing stop is none.';
    if (trailingInput) trailingInput.step = '0.1';
  }

  const targetType = String(sbEl('sb-target-type')?.value || 'fixed_pct').trim();
  const targetMeta = sbTargetTypeMeta(targetType);
  [1, 2, 3].forEach((idx) => {
    const targetLabel = sbEl(`sb-tp${idx}-value-label`);
    if (targetLabel) targetLabel.textContent = targetMeta.labels[idx - 1];
  });
  const targetHelp = sbEl('sb-target-help');
  if (targetHelp) targetHelp.textContent = targetMeta.help;

  const exitType = String(sbEl('sb-exit-type')?.value || 'r_multiple').trim();
  const exitLabel = sbEl('sb-exit-value-label');
  const exitHelp = sbEl('sb-exit-value-help');
  const exitInput = sbEl('sb-exit-value');
  if (exitType === 'fixed_pct') {
    if (exitLabel) exitLabel.textContent = 'Exit Target %';
    if (exitHelp) exitHelp.textContent = 'Example: 10 means exit at +10% for long or -10% for short.';
    if (exitInput) exitInput.step = '0.1';
  } else {
    if (exitLabel) exitLabel.textContent = 'Exit R Multiple';
    if (exitHelp) exitHelp.textContent = 'Example: 2 means exit at 2R.';
    if (exitInput) exitInput.step = '0.1';
  }
}

function sbBuildStrategySpec() {
  const source = sbSelectedSignal();
  const sourceId = String(sbEl('sb-source-id')?.value || '').trim();
  const sourceFamily = sbSelectedSourceFamily();
  const sourceType = sbSourceComposition(sourceFamily);
  const runtimePatternType = String(source?.runtime_pattern_type || sourceId).trim();
  const runtimeSetup = source?.runtime_setup && typeof source.runtime_setup === 'object' ? source.runtime_setup : {};
  const requiredState = String(sbEl('sb-required-state')?.value || '').trim();
  const direction = String(sbEl('sb-direction')?.value || 'long').trim();
  const stopType = String(sbEl('sb-stop-type')?.value || 'atr_multiple').trim();
  const stopValueInput = Number(sbEl('sb-stop-value')?.value || 0);
  const stopValue = sbNormalizeStopValue(stopType, stopValueInput);
  const mode = sbVersionMode();
  const targetType = mode === 'production'
    ? String(sbEl('sb-target-type')?.value || 'fixed_pct').trim()
    : String(sbEl('sb-exit-type')?.value || 'r_multiple').trim();
  const backtestExit = sbBacktestExitConfig();
  const takeProfits = mode === 'production' ? sbBuildTakeProfits(targetType) : [];
  const firstTarget = mode === 'production' ? (takeProfits[0]?.target_value || 0) : backtestExit.target_level;
  const firstTargetR = targetType === 'r_multiple' ? firstTarget : undefined;
  const maxHoldBars = Number(sbEl('sb-max-hold')?.value || 0);
  const strategyId = sbSlugify(sbEl('sb-strategy-id')?.value || sbEl('sb-name')?.value || `${sourceId}_${direction}_strategy`);
  const trailing = mode === 'production' ? sbTrailingConfig() : null;
  const strategyTag = mode === 'production' ? 'production_strategy' : 'backtest_strategy';

  return {
    strategy_id: strategyId,
    name: String(sbEl('sb-name')?.value || '').trim() || strategyId,
    status: 'draft',
    asset_class: String(sbEl('sb-asset-class')?.value || 'stocks').trim(),
    interval: String(sbEl('sb-interval')?.value || '1wk').trim(),
    description: String(sbEl('sb-description')?.value || '').trim(),
    version_mode: mode,
    strategy_tag: strategyTag,
    strategy_tags: [strategyTag],
    scan_mode: mode === 'production' ? 'production_execution_plan' : 'validator_backtest',
    trade_direction: direction,
    source_signal: {
      pattern_id: sourceId,
      composition: sourceType,
      family: sourceFamily,
      signal_tag: source?.signal_tag || sourceFamily.replace('_primitive', ''),
      source_category: sourceFamily,
      required_state: requiredState,
    },
    structure_config: {
      source_signal_id: sourceId,
      source_signal_name: source?.name || sourceId,
      source_composition: sourceType,
      source_family: sourceFamily,
      source_signal_tag: source?.signal_tag || sourceFamily.replace('_primitive', ''),
    },
    setup_config: {
      pattern_type: runtimePatternType,
      ...runtimeSetup,
      source_signal: {
        pattern_id: sourceId,
        composition: sourceType,
        family: sourceFamily,
        signal_tag: source?.signal_tag || sourceFamily.replace('_primitive', ''),
        source_category: sourceFamily,
        required_state: requiredState,
      },
    },
    entry_config: {
      entry_type: String(sbEl('sb-entry-type')?.value || 'market_on_close').trim(),
      required_state: requiredState,
    },
    risk_config: {
      risk_per_trade_pct: Number(sbEl('sb-risk-pct')?.value || 0),
      stop_type: stopType,
      stop_value: stopValue,
      atr_multiplier: stopType === 'atr_multiple' ? stopValue : undefined,
      fixed_stop_pct: stopType === 'fixed_pct' ? stopValue : undefined,
      fixed_stop_amount: stopType === 'fixed_amount' ? stopValue : undefined,
      take_profit_R: firstTargetR,
      max_hold_bars: maxHoldBars,
      trailing_stop: trailing,
    },
    exit_config: {
      target_type: targetType,
      target_level: firstTarget,
      take_profits: mode === 'production' ? takeProfits : undefined,
      time_stop_bars: maxHoldBars,
      trailing: mode === 'production' ? trailing : null,
    },
    cost_config: {
      commission_per_trade: Number(sbEl('sb-commission')?.value || 0),
      slippage_pct: Number(sbEl('sb-slippage')?.value || 0),
    },
    execution_config: {
      production_lock: mode === 'production',
      order_type: 'market',
    },
    universe: sbNormalizeUniverse(sbEl('sb-universe')?.value || ''),
    parameter_manifest: [
      { label: sbStopValueMeta(stopType).label, path: 'risk_config.stop_value', anatomy: 'stop_loss', sweep_enabled: true, sensitivity_enabled: true },
      ...(mode === 'production'
        ? [
          { label: 'TP1 Target', path: 'exit_config.take_profits.0.target_value', anatomy: 'take_profit', sweep_enabled: true, sensitivity_enabled: true },
          { label: 'TP2 Target', path: 'exit_config.take_profits.1.target_value', anatomy: 'take_profit', sweep_enabled: true, sensitivity_enabled: true },
          { label: 'TP3 Target', path: 'exit_config.take_profits.2.target_value', anatomy: 'take_profit', sweep_enabled: true, sensitivity_enabled: true },
        ]
        : [
          { label: 'Exit Target', path: 'exit_config.target_level', anatomy: 'take_profit', sweep_enabled: true, sensitivity_enabled: true },
        ]),
      { label: 'Max Hold Bars', path: 'risk_config.max_hold_bars', anatomy: 'risk_controls', sweep_enabled: true, sensitivity_enabled: true },
    ],
  };
}

function updateStrategyBuilderJson() {
  sbUpdateDynamicLabels();
  const spec = sbBuildStrategySpec();
  sbEl('sb-json').value = JSON.stringify(spec, null, 2);
  sbSetStatus('Strategy JSON updated. Save when ready.');
  return spec;
}

function sbApplySelectedSignal(row) {
  if (!row) return;
  const sourceFamily = sbSourceFamily(row);
  const sourceType = sbSourceComposition(sourceFamily);
  const sourceId = row.pattern_id || '';
  const defaultName = `${row.name || sourceId} ${sourceType === 'composite' ? 'Strategy' : sourceType === 'pattern' ? 'Pattern Strategy' : 'Primitive Strategy'}`;
  sbEl('sb-source-type').value = sourceFamily;
  sbEl('sb-required-state').value = sbDefaultStateForSignal(row);
  if (row.trade_bias === 'long' || row.trade_bias === 'short') sbEl('sb-direction').value = row.trade_bias;
  if (!sbEl('sb-name').value.trim()) sbEl('sb-name').value = defaultName;
  if (!sbEl('sb-strategy-id').value.trim()) sbEl('sb-strategy-id').value = sbSlugify(`${sourceId}_strategy`);
  if (!sbEl('sb-description').value.trim()) {
    sbEl('sb-description').value = `Wrap ${sourceId} as a testable strategy for Validator.`;
  }
  updateStrategyBuilderJson();
}

function renderStrategyBuilderSourceOptions(preferredId = '') {
  const select = sbEl('sb-source-id');
  if (!select) return;

  const selectedFamily = sbSelectedSourceFamily();
  const visibleRows = strategyBuilderSignals
    .filter((row) => sbSourceFamily(row) === selectedFamily)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const labels = {
    technical_primitive: 'technical analysis primitive',
    fundamental_primitive: 'fundamental analysis primitive',
    pattern: 'pattern primitive',
    composite: 'composite',
  };

  select.innerHTML = `<option value="">Select a ${labels[selectedFamily] || 'source signal'}</option>`;
  visibleRows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.pattern_id;
    option.textContent = row.name || row.pattern_id;
    select.appendChild(option);
  });

  if (preferredId && visibleRows.some((row) => row.pattern_id === preferredId)) {
    select.value = preferredId;
    sbApplySelectedSignal(sbSelectedSignal());
    return;
  }

  updateStrategyBuilderJson();
}

function handleStrategyBuilderSourceCategoryChange() {
  const current = sbSelectedSignal();
  if (current && sbSourceFamily(current) === sbSelectedSourceFamily()) {
    updateStrategyBuilderJson();
    return;
  }
  const sourceSelect = sbEl('sb-source-id');
  if (sourceSelect) sourceSelect.value = '';
  sbEl('sb-required-state').value = '';
  renderStrategyBuilderSourceOptions();
}

async function loadStrategyBuilderSignals() {
  const select = sbEl('sb-source-id');
  if (!select) return;
  select.innerHTML = '<option value="">Loading signals...</option>';
  try {
    const res = await fetch('/api/plugins/scanner/options');
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data.data)) throw new Error(data?.error || `HTTP ${res.status}`);
    strategyBuilderSignals = data.data
      .filter((row) => row && row.pattern_id && String(row.artifact_type || '').toLowerCase() !== 'strategy')
      .map((row) => ({
        pattern_id: String(row.pattern_id || '').trim(),
        name: String(row.name || row.pattern_id || '').trim(),
        artifact_type: String(row.artifact_type || '').trim(),
        composition: String(row.composition || '').trim(),
        category: String(row.category || '').trim(),
        indicator_role: String(row.indicator_role || row.canonical_role || '').trim(),
        canonical_role: String(row.canonical_role || row.indicator_role || '').trim(),
        search_tags: Array.isArray(row.search_tags) ? row.search_tags : [],
        source_kind: String(row.source_kind || '').trim(),
        signal_tag: String(row.signal_tag || '').trim(),
        source_category: String(row.source_category || '').trim(),
        trade_bias: String(row.trade_bias || '').trim(),
        runtime_pattern_type: String(row.runtime_pattern_type || '').trim(),
        runtime_setup: row.runtime_setup && typeof row.runtime_setup === 'object' ? row.runtime_setup : null,
      }))
      .filter((row) => row.pattern_id);

    const existingIds = new Set(strategyBuilderSignals.map((row) => row.pattern_id));
    STRATEGY_BUILDER_FUNDAMENTAL_METRICS.forEach((row) => {
      const existing = strategyBuilderSignals.find((item) => item.pattern_id === row.pattern_id);
      if (existing) {
        Object.assign(existing, {
          ...row,
          search_tags: Array.from(new Set([...(existing.search_tags || []), ...(row.search_tags || [])])),
        });
        return;
      }
      if (!existingIds.has(row.pattern_id)) strategyBuilderSignals.push(row);
    });

    const params = new URLSearchParams(window.location.search);
    const sourceId = params.get('source') || params.get('pattern_id');
    if (sourceId && strategyBuilderSignals.some((row) => row.pattern_id === sourceId)) {
      const row = strategyBuilderSignals.find((item) => item.pattern_id === sourceId);
      sbEl('sb-source-type').value = sbSourceFamily(row);
      renderStrategyBuilderSourceOptions(sourceId);
      select.value = sourceId;
      sbApplySelectedSignal(sbSelectedSignal());
    } else {
      renderStrategyBuilderSourceOptions();
    }
  } catch (error) {
    select.innerHTML = '<option value="">Could not load signals</option>';
    sbSetStatus(`Could not load signals: ${error.message || 'Unknown error'}`, true);
  }
}

async function saveStrategyBuilderSpec() {
  let payload = updateStrategyBuilderJson();
  try {
    payload = JSON.parse(sbEl('sb-json').value || '{}');
  } catch (error) {
    sbSetStatus(`Invalid JSON: ${error.message}`, true);
    return;
  }

  if (!payload.source_signal?.pattern_id) {
    sbSetStatus('Choose a source signal first.', true);
    return;
  }
  if (!payload.strategy_id || !payload.name) {
    sbSetStatus('Strategy ID and name are required.', true);
    return;
  }

  delete payload.strategy_version_id;
  delete payload.version;

  try {
    const res = await fetch('/api/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
    const id = data.data?.strategy_version_id || data.data?.strategy_id || payload.strategy_id;
    const mode = String(payload.version_mode || 'backtest');
    if (mode === 'production') {
      sbSetStatus(`Saved production plan ${id}. Backtest versions are the ones sent to Validator.`);
      return;
    }
    sbSetStatus(`Saved backtest version ${id}. Opening it in Validator.`);
    setTimeout(() => {
      window.location.href = `validator.html?strategy_version_id=${encodeURIComponent(id)}`;
    }, 500);
  } catch (error) {
    sbSetStatus(`Save failed: ${error.message || 'Unknown error'}`, true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  sbEl('sb-source-id')?.addEventListener('change', () => sbApplySelectedSignal(sbSelectedSignal()));
  sbEl('sb-source-type')?.addEventListener('change', handleStrategyBuilderSourceCategoryChange);
  [
    'sb-version-mode', 'sb-required-state', 'sb-direction', 'sb-name', 'sb-strategy-id', 'sb-asset-class',
    'sb-interval', 'sb-entry-type', 'sb-stop-type', 'sb-stop-value', 'sb-trailing-type', 'sb-trailing-value',
    'sb-exit-type', 'sb-exit-value', 'sb-target-type', 'sb-tp1-value', 'sb-tp1-exit-pct', 'sb-tp2-value', 'sb-tp2-exit-pct', 'sb-tp3-value', 'sb-tp3-exit-pct', 'sb-max-hold',
    'sb-risk-pct', 'sb-slippage', 'sb-commission', 'sb-universe', 'sb-description',
  ].forEach((id) => {
    sbEl(id)?.addEventListener('input', updateStrategyBuilderJson);
    sbEl(id)?.addEventListener('change', updateStrategyBuilderJson);
  });
  void loadStrategyBuilderSignals();
  sbUpdateDynamicLabels();
});

window.updateStrategyBuilderJson = updateStrategyBuilderJson;
window.saveStrategyBuilderSpec = saveStrategyBuilderSpec;
