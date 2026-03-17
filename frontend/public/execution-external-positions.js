(function initExecutionDeskExternalPositions(global) {
  function showExternalPositionMessage(text, isError = false) {
    const el = document.getElementById('external-position-message');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? '' : 'none';
    el.style.color = isError ? 'var(--color-negative)' : 'var(--color-text-muted)';
  }

  function resetExternalPositionModal() {
    document.getElementById('external-position-provider').value = 'robinhood';
    document.getElementById('external-position-instrument').value = 'futures';
    document.getElementById('external-position-symbol').value = '';
    document.getElementById('external-position-display-symbol').value = '';
    document.getElementById('external-position-side').value = 'long';
    document.getElementById('external-position-qty').value = '1';
    document.getElementById('external-position-entry').value = '';
    document.getElementById('external-position-current').value = '';
    document.getElementById('external-position-stop').value = '';
    document.getElementById('external-position-target').value = '';
    document.getElementById('external-position-multiplier').value = '';
    showExternalPositionMessage('');
  }

  function openExternalPositionModal() {
    resetExternalPositionModal();
    document.getElementById('external-position-modal').classList.add('active');
  }

  function closeExternalPositionModal(event) {
    if (event && event.target && event.target.id !== 'external-position-modal') return;
    document.getElementById('external-position-modal').classList.remove('active');
    showExternalPositionMessage('');
  }

  async function saveExternalPosition(ctx) {
    const provider = ctx.normalizeBrokerProvider(document.getElementById('external-position-provider').value || 'robinhood');
    const instrumentType = String(document.getElementById('external-position-instrument').value || 'futures').trim().toLowerCase();
    const symbol = document.getElementById('external-position-symbol').value.trim().toUpperCase();
    const displaySymbol = document.getElementById('external-position-display-symbol').value.trim();
    const side = document.getElementById('external-position-side').value || 'long';
    const qty = ctx.positionNumber(document.getElementById('external-position-qty').value);
    const entry = ctx.positionNumber(document.getElementById('external-position-entry').value);
    const current = ctx.positionNumber(document.getElementById('external-position-current').value);
    const stop = ctx.positionNumber(document.getElementById('external-position-stop').value);
    const target = ctx.positionNumber(document.getElementById('external-position-target').value);
    const multiplier = ctx.positionNumber(document.getElementById('external-position-multiplier').value);

    if (!symbol) {
      showExternalPositionMessage('Symbol is required.', true);
      return;
    }
    if (!(qty > 0)) {
      showExternalPositionMessage('Qty / contracts must be greater than 0.', true);
      return;
    }
    if (!(entry > 0)) {
      showExternalPositionMessage('Entry price must be greater than 0.', true);
      return;
    }
    if (stop != null && !ctx.isPositionDirectionalLevelValid(stop, { side }, entry, 'stop')) {
      showExternalPositionMessage('Stop-loss must sit on the stop side of entry for this position.', true);
      return;
    }
    if (target != null && !ctx.isPositionDirectionalLevelValid(target, { side }, entry, 'target')) {
      showExternalPositionMessage('Take-profit must sit on the profit side of entry for this position.', true);
      return;
    }

    showExternalPositionMessage('Adding external position...', false);
    await ctx.api('/api/execution/external-positions', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        instrument_type: instrumentType,
        symbol,
        display_symbol: displaySymbol || undefined,
        side,
        qty,
        avg_entry_price: entry,
        current_price: current > 0 ? current : entry,
        stop_price: stop > 0 ? stop : undefined,
        take_profit_price: target > 0 ? target : undefined,
        contract_multiplier: multiplier > 0 ? multiplier : undefined,
        import_reason: `Manually adopted from ${ctx.providerLabel(provider)} because the live position could not be pulled automatically.`,
      }),
    });

    await ctx.refreshStatus();
    await ctx.loadLogs();
    closeExternalPositionModal();
    ctx.showBridgeActionMessage(`${symbol}: external position adopted into Execution Desk.`);
  }

  async function removeExternalPosition(ctx, id, symbol) {
    if (!id) return;
    if (!confirm(`Remove ${symbol || 'this position'} from the local Execution Desk mirror?\n\nUse this after you close it at the broker.`)) {
      return;
    }
    await ctx.api(`/api/execution/external-positions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await ctx.refreshStatus();
    await ctx.loadLogs();
    if (ctx.state.positionModalRow && ctx.state.positionModalRow.manualExternalId === id) {
      ctx.closePositionModal();
    }
    ctx.showBridgeActionMessage(`${symbol || 'Position'} removed from the local Execution Desk mirror.`);
  }

  function renderPositions(ctx, data) {
    const tbody = document.getElementById('positions-body');
    const executionProvider = data && data.execution_broker_provider ? data.execution_broker_provider : 'alpaca';
    const managed = (data && data.state && Array.isArray(data.state.managed_positions)) ? data.state.managed_positions : [];
    const connected = Array.isArray(data && data.connected_brokers) ? data.connected_brokers : [];
    const defaultImportStrategyVersionId = data?.default_import_strategy_version_id || '';
    const brokerByProvider = new Map();
    for (const entry of connected) {
      brokerByProvider.set(entry.provider, Array.isArray(entry.positions) ? entry.positions : []);
    }
    const executionBrokerPositions = brokerByProvider.get(executionProvider) || [];
    const managedKeys = new Set(managed.map((p) => `${executionProvider}:${p.symbol}:${p.side || 'long'}`));
    const brokerByKey = new Map();
    for (const bp of executionBrokerPositions) {
      brokerByKey.set(`${executionProvider}:${bp.symbol}:${bp.side || 'long'}`, bp);
    }
    const rows = [];

    for (const p of managed) {
      const key = `${executionProvider}:${p.symbol}:${p.side || 'long'}`;
      const bp = brokerByKey.get(key) || executionBrokerPositions.find((candidate) => candidate.symbol === p.symbol) || null;
      rows.push({
        symbol: p.symbol,
        apiSymbol: p.symbol,
        providerKey: executionProvider,
        provider: ctx.providerLabel(executionProvider),
        strategy: p.strategy_version_id || '--',
        strategyVersionId: p.strategy_version_id || defaultImportStrategyVersionId || '',
        side: p.side || 'long',
        qty: p.qty,
        entry: p.entry_price,
        current: bp ? bp.current_price : null,
        unrealized: bp ? bp.unrealized_pnl : null,
        unrealizedPct: bp ? bp.unrealized_pnl_pct : null,
        actualStop: p.stop_price ?? null,
        actualTakeProfit: p.take_profit_price ?? null,
        suggestedStop: null,
        suggestedTakeProfit: null,
        suggestedReason: null,
        suggestedAtr: null,
        instrumentType: ctx.inferInstrumentType(executionProvider, p.symbol, bp?.instrument_type),
        isManaged: true,
        canClose: true,
        focused: ctx.state.focusTrade && ctx.state.focusTrade.symbol === p.symbol,
      });
    }

    for (const entry of connected) {
      const providerName = ctx.providerLabel(entry.provider);
      const brokerPositions = Array.isArray(entry.positions) ? entry.positions : [];
      for (const bp of brokerPositions) {
        const key = `${entry.provider}:${bp.symbol}:${bp.side || 'long'}`;
        if (managedKeys.has(key)) continue;
        rows.push({
          symbol: bp.display_symbol || bp.symbol,
          apiSymbol: bp.symbol,
          providerKey: entry.provider,
          provider: providerName,
          strategy: bp.strategy_name || bp.strategy_version_id || 'Broker (unmanaged)',
          strategyVersionId: bp.strategy_version_id || defaultImportStrategyVersionId || '',
          side: bp.side || 'long',
          qty: bp.qty,
          entry: bp.avg_entry_price,
          current: bp.current_price,
          unrealized: bp.unrealized_pnl,
          unrealizedPct: bp.unrealized_pnl_pct,
          actualStop: bp.stop_price ?? null,
          actualTakeProfit: bp.take_profit_price ?? null,
          suggestedStop: bp.suggested_stop_price ?? null,
          suggestedTakeProfit: bp.suggested_take_profit_price ?? null,
          suggestedReason: bp.import_reason || null,
          suggestedAtr: bp.suggested_atr ?? null,
          instrumentType: ctx.inferInstrumentType(entry.provider, bp.symbol, bp.instrument_type),
          isManaged: false,
          isLocalExternal: Boolean(bp.manual_external),
          manualExternalId: bp.manual_external_id || null,
          canClose: !bp.manual_external && entry.provider !== 'robinhood',
          canRemove: Boolean(bp.manual_external),
          focused: ctx.state.focusTrade && ctx.state.focusTrade.symbol === bp.symbol,
        });
      }
    }

    ctx.state.positionRows = rows;
    document.getElementById('positions-count').textContent = String(rows.length);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="muted">No positions</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row, index) => {
      const unrealizedCls = Number(row.unrealized || 0) >= 0 ? 'good' : 'bad';
      const rowClasses = ['position-row', 'position-row--interactive'];
      if (row.focused) rowClasses.push('position-row--focused');
      const manageLabel = ctx.getPositionEditMode(row) === 'readonly' ? 'View' : 'Adjust';
      const liveStop = ctx.positionNumber(row.actualStop);
      const liveTarget = ctx.positionNumber(row.actualTakeProfit);
      const actions = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick='event.stopPropagation(); openPositionModalByIndex(${index})'>${manageLabel}</button>
          ${row.canClose ? `<button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;color:var(--color-negative);" onclick='event.stopPropagation(); closeBrokerPosition(${JSON.stringify(row.providerKey)},${JSON.stringify(row.apiSymbol)},${JSON.stringify(row.side)})'>Close</button>` : ''}
          ${row.canRemove ? `<button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;color:var(--color-negative);" onclick='event.stopPropagation(); removeExternalPosition(${JSON.stringify(row.manualExternalId)},${JSON.stringify(row.symbol)})'>Remove</button>` : ''}
        </div>
      `;
      return `
        <tr class="${rowClasses.join(' ')}" tabindex="0" onclick='openPositionModalByIndex(${index})' onkeydown='handlePositionRowKey(event, ${index})'>
          <td>${ctx.escapeHtml(row.symbol)}</td>
          <td>${ctx.escapeHtml(row.provider)}</td>
          <td>${ctx.escapeHtml(row.strategy)}</td>
          <td>${ctx.escapeHtml(row.side)}</td>
          <td>${ctx.escapeHtml(row.qty)}</td>
          <td>${ctx.fmtPositionPrice(row.entry, row)}</td>
          <td>${ctx.fmtPositionPrice(row.current, row)}</td>
          <td class="${unrealizedCls}">${ctx.fmtMoney(row.unrealized)}</td>
          <td class="${unrealizedCls}">${ctx.fmtPct(row.unrealizedPct)}</td>
          <td><div class="position-cell-stack"><span>${ctx.fmtPositionPrice(liveStop, row)}</span>${!row.isManaged && !(liveStop > 0) && ctx.positionNumber(row.suggestedStop) > 0 ? '<span class="position-meta-note">suggested in modal</span>' : ''}</div></td>
          <td><div class="position-cell-stack"><span>${ctx.fmtPositionPrice(liveTarget, row)}</span>${!row.isManaged && !(liveTarget > 0) && ctx.positionNumber(row.suggestedTakeProfit) > 0 ? '<span class="position-meta-note">suggested in modal</span>' : ''}</div></td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');
  }

  global.ExecutionDeskExternalPositions = {
    closeExternalPositionModal,
    openExternalPositionModal,
    removeExternalPosition,
    renderPositions,
    resetExternalPositionModal,
    saveExternalPosition,
    showExternalPositionMessage,
  };
})(window);
