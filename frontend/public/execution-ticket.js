(function initExecutionDeskTicket(global) {
  function renderPendingExecutionTicket(ctx) {
    const { state, providerLabel, fmtIntentPrice, asIso, getConfiguredFlag, brokerSupportsExecution } = ctx;
    const intent = state.pendingIntent;
    const summaryEl = document.getElementById('execution-ticket-summary');
    const notesEl = document.getElementById('execution-ticket-notes');
    const executeBtn = document.getElementById('btn-execute-ticket');
    const reviewBtn = document.getElementById('btn-ticket-review');
    const clearBtn = document.getElementById('btn-ticket-clear');
    const fieldMap = {
      'ticket-broker': intent ? providerLabel(intent.brokerProvider) : '--',
      'ticket-symbol': intent?.symbol || '--',
      'ticket-side': intent?.direction || '--',
      'ticket-order-type': intent ? String(intent.orderType || 'market').toUpperCase() : '--',
      'ticket-qty': intent?.units != null ? String(intent.units) : '--',
      'ticket-entry': intent ? fmtIntentPrice(intent.entryPrice, intent) : '--',
      'ticket-stop': intent ? fmtIntentPrice(intent.stopPrice, intent) : '--',
      'ticket-target': intent ? fmtIntentPrice(intent.takeProfitPrice, intent) : '--',
      'ticket-strategy': intent?.riskTemplateName || intent?.strategyVersionId || '--',
      'ticket-created-at': intent?.createdAt ? asIso(intent.createdAt) : '--',
    };
    Object.entries(fieldMap).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });

    if (!intent) {
      summaryEl.textContent = 'Trading Desk owns order planning. Send a trade from Trading Desk to stage an execution ticket here.';
      notesEl.textContent = 'No Trading Desk ticket loaded.';
      notesEl.className = 'mono muted';
      executeBtn.disabled = true;
      clearBtn.disabled = true;
      reviewBtn.disabled = false;
      return;
    }

    const brokerConfigured = getConfiguredFlag(state.settings || {}, intent.brokerProvider);
    const automated = brokerSupportsExecution(intent.brokerProvider);
    summaryEl.textContent = `${intent.symbol} is staged from Trading Desk for ${providerLabel(intent.brokerProvider)}. Execution Desk should submit it without re-authoring the trade.`;
    if (!automated) {
      notesEl.textContent = 'This ticket is routed to Robinhood. Robinhood order submission is not wired yet, so Execution Desk can stage and track it but not submit it.';
      notesEl.className = 'mono bad';
    } else if (!brokerConfigured) {
      notesEl.textContent = `${providerLabel(intent.brokerProvider)} is not configured. Open the broker row above, save credentials, then execute this ticket.`;
      notesEl.className = 'mono bad';
    } else {
      notesEl.textContent = `${providerLabel(intent.brokerProvider)} is configured. Execute the ticket to submit the planned order with the Trading Desk stop-loss and take-profit attached.`;
      notesEl.className = 'mono muted';
    }
    executeBtn.disabled = !automated || !brokerConfigured;
    clearBtn.disabled = false;
    reviewBtn.disabled = false;
  }

  function clearPendingExecutionTicket(ctx, showMessage = true) {
    const { state, renderPendingExecutionTicket, showBridgeActionMessage } = ctx;
    if (showMessage && state.pendingIntent && !confirm(`Clear the pending Trading Desk ticket for ${state.pendingIntent.symbol}?`)) {
      return;
    }
    state.pendingIntent = null;
    if (global.TradingDeskExecutionIntent?.clear) {
      global.TradingDeskExecutionIntent.clear();
    }
    renderPendingExecutionTicket();
    if (showMessage) {
      showBridgeActionMessage('Trading Desk ticket cleared.');
    }
  }

  async function submitPendingExecutionTicket(ctx) {
    const {
      state,
      api,
      brokerSupportsExecution,
      clearPendingExecutionTicket,
      loadLogs,
      normalizeIntentBrokerProvider,
      providerLabel,
      refreshStatus,
      showBridgeActionMessage,
    } = ctx;
    const intent = state.pendingIntent;
    if (!intent) {
      alert('No Trading Desk ticket is loaded.');
      return;
    }

    const provider = normalizeIntentBrokerProvider(intent.brokerProvider, intent.instrumentType);
    if (!brokerSupportsExecution(provider)) {
      alert(`${providerLabel(provider)} ticket execution is not wired yet.`);
      return;
    }

    const qty = Math.abs(Math.round(Number(intent.units || 0)));
    const stopPrice = Number(intent.stopPrice || 0);
    const takeProfitPrice = Number(intent.takeProfitPrice || 0);
    const limitPrice = Number(intent.limitPrice || 0);
    const type = String(intent.orderType || 'market').trim().toLowerCase() === 'limit' ? 'limit' : 'market';
    const side = String(intent.direction || '').toUpperCase() === 'SHORT' ? 'sell' : 'buy';
    if (!intent.symbol || qty <= 0 || stopPrice <= 0 || takeProfitPrice <= 0) {
      alert('The Trading Desk ticket is missing broker, symbol, qty, stop-loss, or take-profit.');
      return;
    }
    if (type === 'limit' && !(limitPrice > 0)) {
      alert('The Trading Desk ticket is a limit order but has no limit price.');
      return;
    }

    if (!confirm(`Execute ${providerLabel(provider)} ${side.toUpperCase()} ${qty} ${intent.symbol} from the Trading Desk ticket?`)) {
      return;
    }

    showBridgeActionMessage(`Submitting ${intent.symbol} to ${providerLabel(provider)}...`);
    await api('/api/execution/orders/manual', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        symbol: String(intent.symbol || '').trim().toUpperCase(),
        side,
        type,
        qty,
        limit_price: type === 'limit' ? limitPrice : undefined,
        stop_price: stopPrice,
        take_profit_price: takeProfitPrice,
        client_order_id: String(intent.id || `pd_ticket_${Date.now()}`),
      }),
    });
    await refreshStatus();
    await loadLogs();
    clearPendingExecutionTicket(false);
    showBridgeActionMessage(`${intent.symbol}: Trading Desk ticket executed via ${providerLabel(provider)}.`);
  }

  function openPendingTicketInTradingDesk(ctx) {
    const { state } = ctx;
    const intent = state.pendingIntent;
    if (intent?.symbol) {
      const params = new URLSearchParams({ symbol: intent.symbol });
      global.location.href = `copilot.html?${params.toString()}`;
      return;
    }
    global.location.href = 'copilot.html';
  }

  function applyTradingDeskExecutionIntent(ctx) {
    const { state, normalizeExecutionIntent, renderPendingExecutionTicket, showBridgeActionMessage } = ctx;
    const intentApi = global.TradingDeskExecutionIntent;
    const intent = normalizeExecutionIntent(intentApi?.read ? intentApi.read() : null);
    state.pendingIntent = intent;
    renderPendingExecutionTicket();
    if (intent) {
      showBridgeActionMessage(`Trading Desk handoff loaded for ${intent.symbol}. Execution Desk is now staging the ticket rather than authoring the order.`);
    }
  }

  global.ExecutionDeskTicket = {
    applyTradingDeskExecutionIntent,
    clearPendingExecutionTicket,
    openPendingTicketInTradingDesk,
    renderPendingExecutionTicket,
    submitPendingExecutionTicket,
  };
})(window);
