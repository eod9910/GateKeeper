(function initExecutionDeskPositions(global) {
  function describePositionTemplateStop(riskConfig) {
    const stopType = String(riskConfig?.stop_type || 'manual').trim().toLowerCase();
    if (stopType === 'atr_multiple') {
      const atrMultiple = Number(riskConfig?.atr_multiplier ?? riskConfig?.stop_value);
      return Number.isFinite(atrMultiple) && atrMultiple > 0 ? `${atrMultiple}x ATR` : 'ATR multiple';
    }
    if (stopType === 'fixed_pct') {
      const pct = Number(riskConfig?.stop_value ?? riskConfig?.fixed_stop_pct ?? riskConfig?.stop_buffer_pct);
      return Number.isFinite(pct) && pct > 0 ? `${(pct * 100).toFixed(2)}% stop` : 'Fixed % stop';
    }
    return 'Manual / structural stop';
  }

  function describePositionTemplateTarget(exitConfig, riskConfig) {
    const targetType = String(exitConfig?.target_type || '').trim().toLowerCase();
    const targetLevel = Number(exitConfig?.target_level);
    if (targetType === 'percentage' && Number.isFinite(targetLevel) && targetLevel > 0) {
      return `${(targetLevel * 100).toFixed(2)}% target`;
    }
    if (targetType === 'atr_multiple' && Number.isFinite(targetLevel) && targetLevel > 0) {
      return `${targetLevel}x ATR target`;
    }
    const takeProfitR = Number(riskConfig?.take_profit_R ?? riskConfig?.take_profit_r);
    if ((targetType === 'r_multiple' && Number.isFinite(targetLevel) && targetLevel > 0) || (Number.isFinite(takeProfitR) && takeProfitR > 0)) {
      return `${Number.isFinite(targetLevel) && targetLevel > 0 ? targetLevel : takeProfitR}R target`;
    }
    return 'Manual / imported target';
  }

  function getPositionEditMode(row) {
    if (!row) return 'readonly';
    if (row.isManaged) return 'managed';
    if (row.isLocalExternal) return 'local';
    if (row.providerKey === 'oanda') return 'broker';
    return 'readonly';
  }

  function getPositionModeLabel(ctx, row) {
    const mode = getPositionEditMode(row);
    if (mode === 'managed') return 'Managed in Execution Desk';
    if (mode === 'local') return 'Local mirror only';
    if (mode === 'broker') return `${ctx.providerLabel(row.providerKey)} broker-native protect`;
    return 'Read only';
  }

  async function fetchPositionChartData(ctx, symbol, interval, period = '6mo') {
    const res = await fetch(`/api/chart/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&period=${encodeURIComponent(period)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
      throw new Error(body?.error || `Failed to load chart data for ${symbol}`);
    }
    return Array.isArray(body.chart_data) ? body.chart_data : [];
  }

  async function loadPositionStrategyCatalog(ctx) {
    if (ctx.state.positionStrategyCatalog.length) return ctx.state.positionStrategyCatalog;
    const payload = await ctx.api('/api/strategies');
    ctx.state.positionStrategyCatalog = (Array.isArray(payload) ? payload : [])
      .filter((item) => item && item.status !== 'rejected')
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return ctx.state.positionStrategyCatalog;
  }

  function findPositionStrategy(ctx, strategyVersionId) {
    const id = String(strategyVersionId || '').trim();
    if (!id) return null;
    return ctx.state.positionStrategyCatalog.find((item) => item.strategy_version_id === id) || null;
  }

  function getPositionStrategyOptions(ctx, row) {
    const prioritizedId = String(row?.strategyVersionId || '').trim();
    const list = [...ctx.state.positionStrategyCatalog];
    if (!prioritizedId) return list.slice(0, 80);
    return list.sort((a, b) => {
      const aScore = a.strategy_version_id === prioritizedId ? 1 : 0;
      const bScore = b.strategy_version_id === prioritizedId ? 1 : 0;
      if (aScore !== bScore) return bScore - aScore;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    }).slice(0, 80);
  }

  function showPositionModalMessage(text, isError = false) {
    const el = document.getElementById('position-modal-message');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? '' : 'none';
    el.style.color = isError ? 'var(--color-negative)' : 'var(--color-text-muted)';
  }

  function populatePositionStrategySelect(ctx, row) {
    const select = document.getElementById('position-modal-strategy');
    if (!select) return [];
    const options = getPositionStrategyOptions(ctx, row);
    select.innerHTML = [
      '<option value="">Manual only</option>',
      ...options.map((item) => `<option value="${ctx.escapeHtml(item.strategy_version_id)}">${ctx.escapeHtml(item.name || item.strategy_version_id)}</option>`),
    ].join('');
    const preferredId = String(row?.strategyVersionId || '').trim();
    if (preferredId && options.some((item) => item.strategy_version_id === preferredId)) {
      select.value = preferredId;
    } else {
      select.value = '';
    }
    return options;
  }

  async function getPositionTemplateAtr(ctx, row, spec) {
    const strategyId = String(spec?.strategy_version_id || '').trim();
    if (strategyId && strategyId === String(row?.strategyVersionId || '').trim()) {
      const suggestedAtr = ctx.positionNumber(row?.suggestedAtr);
      if (suggestedAtr && suggestedAtr > 0) return suggestedAtr;
    }

    if (!spec || String(row?.instrumentType || '').toLowerCase() === 'options') {
      return null;
    }

    const riskConfig = spec.risk_config || spec.risk || {};
    const exitConfig = spec.exit_config || {};
    const stopType = String(riskConfig.stop_type || '').trim().toLowerCase();
    const targetType = String(exitConfig.target_type || '').trim().toLowerCase();
    if (stopType !== 'atr_multiple' && targetType !== 'atr_multiple') {
      return null;
    }

    const interval = String(spec.interval || '1d').trim() || '1d';
    if (!ctx.state.positionModalChartCache[interval]) {
      try {
        ctx.state.positionModalChartCache[interval] = await fetchPositionChartData(ctx, row.apiSymbol, interval);
      } catch {
        ctx.state.positionModalChartCache[interval] = [];
      }
    }
    const inferred = ctx.inferAtrFromChartData(ctx.state.positionModalChartCache[interval]);
    return inferred && inferred > 0 ? inferred : null;
  }

  async function updatePositionModalTemplateSummary(ctx) {
    const row = ctx.state.positionModalRow;
    const summaryEl = document.getElementById('position-modal-template-summary');
    const select = document.getElementById('position-modal-strategy');
    if (!row || !summaryEl || !select) return;

    const spec = findPositionStrategy(ctx, select.value);
    if (!spec) {
      const lines = [
        'Manual mode',
        'Edit the stop-loss and take-profit directly, or seed the fields from live broker values or the imported strategy suggestion.',
      ];
      if (row.suggestedReason) {
        lines.push(`Suggestion note: ${row.suggestedReason}`);
      }
      summaryEl.textContent = lines.join('\n');
      return;
    }

    const riskConfig = spec.risk_config || spec.risk || {};
    const exitConfig = spec.exit_config || {};
    const atr = await getPositionTemplateAtr(ctx, row, spec);
    const lines = [
      spec.name || spec.strategy_version_id,
      `Stop model: ${describePositionTemplateStop(riskConfig)}`,
      `Target model: ${describePositionTemplateTarget(exitConfig, riskConfig)}`,
      atr ? `ATR reference: ${ctx.roundPositionPrice(row, atr)}` : 'ATR reference unavailable for this symbol',
    ];
    if (row.suggestedReason && spec.strategy_version_id === String(row.strategyVersionId || '').trim()) {
      lines.push(`Imported suggestion: ${row.suggestedReason}`);
    }
    summaryEl.textContent = lines.join('\n');
  }

  function setPositionModalInputSteps(ctx, row) {
    const step = ctx.getPositionPriceStep(row);
    ['position-modal-entry', 'position-modal-stop', 'position-modal-target'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.step = step;
    });
  }

  function setPositionModalValues(ctx, row, values = {}) {
    const entry = ctx.roundPositionPrice(row, values.entry);
    const stop = ctx.roundPositionPrice(row, values.stop);
    const target = ctx.roundPositionPrice(row, values.target);
    document.getElementById('position-modal-entry').value = entry > 0 ? String(entry) : '';
    document.getElementById('position-modal-stop').value = stop > 0 ? String(stop) : '';
    document.getElementById('position-modal-target').value = target > 0 ? String(target) : '';
  }

  function usePositionModalLiveValues(ctx) {
    const row = ctx.state.positionModalRow;
    if (!row) return;
    const liveStop = ctx.positionNumber(row.actualStop);
    const liveTarget = ctx.positionNumber(row.actualTakeProfit);
    if (!(liveStop > 0) && !(liveTarget > 0)) {
      showPositionModalMessage('No live broker-managed stop or take-profit is on file for this position yet.', true);
      return;
    }
    setPositionModalValues(ctx, row, {
      entry: row.entry,
      stop: liveStop,
      target: liveTarget,
    });
    showPositionModalMessage('Loaded the live broker values into the form.', false);
  }

  function usePositionModalSuggestedValues(ctx) {
    const row = ctx.state.positionModalRow;
    if (!row) return;
    const suggestedStop = ctx.positionNumber(row.suggestedStop);
    const suggestedTarget = ctx.positionNumber(row.suggestedTakeProfit);
    if (!(suggestedStop > 0) && !(suggestedTarget > 0)) {
      showPositionModalMessage('No strategy suggestion is available for this position.', true);
      return;
    }
    setPositionModalValues(ctx, row, {
      entry: row.entry,
      stop: suggestedStop,
      target: suggestedTarget,
    });
    showPositionModalMessage('Loaded the imported strategy suggestion into the form.', false);
  }

  async function applyPositionTemplate(ctx) {
    const row = ctx.state.positionModalRow;
    const select = document.getElementById('position-modal-strategy');
    if (!row || !select) return;

    const spec = findPositionStrategy(ctx, select.value);
    if (!spec) {
      showPositionModalMessage('Select a strategy template first, or stay in Manual mode.', true);
      return;
    }

    const entry = ctx.roundPositionPrice(row, document.getElementById('position-modal-entry').value || row.entry);
    if (!(entry > 0)) {
      showPositionModalMessage('A valid entry price is required before applying a template.', true);
      return;
    }

    const riskConfig = spec.risk_config || spec.risk || {};
    const exitConfig = spec.exit_config || {};
    const sign = String(row.side || '').toLowerCase() === 'short' ? -1 : 1;
    const atr = await getPositionTemplateAtr(ctx, row, spec);

    let stop = null;
    let stopDistance = 0;
    const stopType = String(riskConfig.stop_type || 'manual').trim().toLowerCase();
    if (stopType === 'atr_multiple') {
      const atrMultiple = ctx.positionNumber(riskConfig.atr_multiplier ?? riskConfig.stop_value);
      if (atr && atrMultiple && atrMultiple > 0) {
        stopDistance = atr * atrMultiple;
        stop = entry - (stopDistance * sign);
      }
    } else if (stopType === 'fixed_pct') {
      const pct = ctx.positionNumber(riskConfig.stop_value ?? riskConfig.fixed_stop_pct ?? riskConfig.stop_buffer_pct);
      if (pct && pct > 0) {
        stopDistance = entry * pct;
        stop = entry - (stopDistance * sign);
      }
    } else {
      const structuralStop = ctx.positionNumber(row.suggestedStop);
      if (ctx.isPositionDirectionalLevelValid(structuralStop, row, entry, 'stop')) {
        stop = structuralStop;
      }
    }

    stop = ctx.roundPositionPrice(row, stop);
    if (!ctx.isPositionDirectionalLevelValid(stop, row, entry, 'stop')) {
      showPositionModalMessage(`The ${spec.name || spec.strategy_version_id} template could not derive a valid stop for this ${row.side} position.`, true);
      return;
    }

    stopDistance = Math.abs(entry - stop);
    let target = null;
    const targetType = String(exitConfig.target_type || '').trim().toLowerCase();
    const targetLevel = ctx.positionNumber(exitConfig.target_level);
    if (targetType === 'percentage' && targetLevel && targetLevel > 0) {
      target = entry + (entry * targetLevel * sign);
    } else if (targetType === 'atr_multiple' && targetLevel && targetLevel > 0 && atr && atr > 0) {
      target = entry + (atr * targetLevel * sign);
    } else {
      const rMultiple = targetType === 'r_multiple' && targetLevel && targetLevel > 0
        ? targetLevel
        : ctx.positionNumber(riskConfig.take_profit_R ?? riskConfig.take_profit_r);
      if (stopDistance > 0 && rMultiple && rMultiple > 0) {
        target = entry + (stopDistance * rMultiple * sign);
      }
    }

    if (!ctx.isPositionDirectionalLevelValid(target, row, entry, 'target')) {
      const suggestedTarget = ctx.positionNumber(row.suggestedTakeProfit);
      if (ctx.isPositionDirectionalLevelValid(suggestedTarget, row, entry, 'target')) {
        target = suggestedTarget;
      }
    }
    target = ctx.roundPositionPrice(row, target);
    if (!ctx.isPositionDirectionalLevelValid(target, row, entry, 'target')) {
      showPositionModalMessage(`The ${spec.name || spec.strategy_version_id} template could not derive a valid target for this ${row.side} position.`, true);
      return;
    }

    setPositionModalValues(ctx, row, { entry, stop, target });
    showPositionModalMessage(`${spec.name || spec.strategy_version_id} template applied to the form.`, false);
    await updatePositionModalTemplateSummary(ctx);
  }

  function handlePositionRowKey(ctx, event, index) {
    if (!event) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ctx.openPositionModalByIndex(index).catch((err) => alert(err.message || err));
    }
  }

  async function openPositionModalByIndex(ctx, index) {
    try {
      const row = Array.isArray(ctx.state.positionRows) ? ctx.state.positionRows[index] : null;
      if (!row) return;
      await ctx.openPositionModal(row);
    } catch (err) {
      showPositionModalMessage(err?.message || String(err), true);
      alert(err?.message || String(err));
    }
  }

  async function openPositionModal(ctx, row) {
    if (!row) return;
    ctx.state.positionModalRow = row;
    ctx.state.positionModalChartCache = {};
    showPositionModalMessage('');
    setPositionModalInputSteps(ctx, row);
    await loadPositionStrategyCatalog(ctx);
    populatePositionStrategySelect(ctx, row);

    const liveStop = ctx.positionNumber(row.actualStop);
    const liveTarget = ctx.positionNumber(row.actualTakeProfit);
    const suggestedStop = ctx.positionNumber(row.suggestedStop);
    const suggestedTarget = ctx.positionNumber(row.suggestedTakeProfit);
    const seedStop = liveStop > 0 ? liveStop : suggestedStop;
    const seedTarget = liveTarget > 0 ? liveTarget : suggestedTarget;

    const summary = row.isLocalExternal
      ? `${row.symbol} is a manually adopted external position from ${row.provider}. Adjust the locally tracked stop-loss and take-profit here.`
      : `${row.symbol} at ${row.provider}. Adjust the stop-loss and take-profit here, then save them back through Execution Desk.`;
    document.getElementById('position-modal-summary').textContent = summary;
    document.getElementById('position-modal-mode').textContent = getPositionModeLabel(ctx, row);
    document.getElementById('position-modal-entry-view').textContent = ctx.fmtPositionPrice(row.entry, row);
    document.getElementById('position-modal-current-view').textContent = ctx.fmtPositionPrice(row.current, row);
    document.getElementById('position-modal-live-stop').textContent = ctx.fmtPositionPrice(liveStop, row);
    document.getElementById('position-modal-live-target').textContent = ctx.fmtPositionPrice(liveTarget, row);
    document.getElementById('position-modal-suggestion-view').textContent = (suggestedStop > 0 || suggestedTarget > 0)
      ? `${ctx.fmtPositionPrice(suggestedStop, row)} / ${ctx.fmtPositionPrice(suggestedTarget, row)}`
      : '--';

    setPositionModalValues(ctx, row, {
      entry: row.entry,
      stop: seedStop,
      target: seedTarget,
    });

    const isReadonly = getPositionEditMode(row) === 'readonly';
    const noteParts = [];
    if (row.isManaged) {
      noteParts.push('Saving here updates the managed exits tracked in Execution Desk for this position.');
    } else if (row.isLocalExternal) {
      noteParts.push('Saving here stores the stop-loss and take-profit locally in Execution Desk for this adopted external position. It does not transmit anything to the broker.');
    } else if (row.providerKey === 'oanda') {
      noteParts.push('Saving here sends broker-native stop-loss and take-profit orders to OANDA.');
    } else {
      noteParts.push('This provider is mirrored into Execution Desk in read-only mode. Saving is disabled until broker writes are wired.');
    }
    if (row.suggestedReason) {
      noteParts.push(`Template context: ${row.suggestedReason}`);
    }
    document.getElementById('position-modal-note').textContent = noteParts.join(' ');

    document.getElementById('btn-position-modal-use-live').disabled = !(liveStop > 0 || liveTarget > 0);
    document.getElementById('btn-position-modal-use-suggested').disabled = !(suggestedStop > 0 || suggestedTarget > 0);
    document.getElementById('btn-position-modal-save').disabled = isReadonly;
    document.getElementById('btn-position-modal-save').textContent = row.isLocalExternal ? 'Save Local Plan' : 'Save Exits';

    document.getElementById('position-modal').classList.add('active');
    await updatePositionModalTemplateSummary(ctx);
  }

  function closePositionModal(ctx, event) {
    if (event && event.target && event.target.id !== 'position-modal') return;
    document.getElementById('position-modal').classList.remove('active');
    ctx.state.positionModalRow = null;
    ctx.state.positionModalChartCache = {};
    showPositionModalMessage('');
  }

  async function savePositionModal(ctx) {
    const row = ctx.state.positionModalRow;
    if (!row) return;

    const mode = getPositionEditMode(row);
    if (mode === 'readonly') {
      showPositionModalMessage('This provider is read-only in Execution Desk right now.', true);
      return;
    }

    const stop = ctx.roundPositionPrice(row, document.getElementById('position-modal-stop').value);
    const target = ctx.roundPositionPrice(row, document.getElementById('position-modal-target').value);
    if (!(stop > 0) || !(target > 0)) {
      showPositionModalMessage('Stop-loss and take-profit are required.', true);
      return;
    }
    if (!ctx.isPositionDirectionalLevelValid(stop, row, row.entry, 'stop')) {
      showPositionModalMessage(`For this ${row.side} position, the stop-loss must sit on the opposite side of entry.`, true);
      return;
    }
    if (!ctx.isPositionDirectionalLevelValid(target, row, row.entry, 'target')) {
      showPositionModalMessage(`For this ${row.side} position, the take-profit must sit on the profit side of entry.`, true);
      return;
    }

    if (!confirm(`Save exits for ${row.symbol}?\n\nStop: ${ctx.fmtPositionPrice(stop, row)}\nTarget: ${ctx.fmtPositionPrice(target, row)}`)) {
      return;
    }

    showPositionModalMessage('Saving exits...', false);
    if (mode === 'managed') {
      await ctx.api('/api/execution/positions/managed/update-exits', {
        method: 'POST',
        body: JSON.stringify({
          symbol: row.apiSymbol,
          stop_price: stop,
          take_profit_price: target,
        }),
      });
    } else if (mode === 'local') {
      await ctx.api(`/api/execution/external-positions/${encodeURIComponent(row.manualExternalId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          stop_price: stop,
          take_profit_price: target,
        }),
      });
    } else {
      await ctx.api('/api/execution/positions/protect', {
        method: 'POST',
        body: JSON.stringify({
          provider: row.providerKey,
          symbol: row.apiSymbol,
          side: row.side,
          stop_price: stop,
          take_profit_price: target,
        }),
      });
    }

    await ctx.refreshStatus();
    await ctx.loadLogs();
    closePositionModal(ctx);
    ctx.showBridgeActionMessage(`${row.symbol}: exits updated in Execution Desk.`);
  }

  global.ExecutionDeskPositions = {
    applyPositionTemplate,
    closePositionModal,
    describePositionTemplateStop,
    describePositionTemplateTarget,
    fetchPositionChartData,
    findPositionStrategy,
    getPositionEditMode,
    getPositionModeLabel,
    getPositionStrategyOptions,
    getPositionTemplateAtr,
    handlePositionRowKey,
    loadPositionStrategyCatalog,
    openPositionModal,
    openPositionModalByIndex,
    populatePositionStrategySelect,
    savePositionModal,
    setPositionModalInputSteps,
    setPositionModalValues,
    showPositionModalMessage,
    updatePositionModalTemplateSummary,
    usePositionModalLiveValues,
    usePositionModalSuggestedValues,
  };
})(window);
