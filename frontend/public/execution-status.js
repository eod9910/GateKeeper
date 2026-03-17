(function initExecutionDeskStatus(global) {
  function renderAccount(ctx, account, provider) {
    const dayPnlEl = document.getElementById('kpi-day-pnl');
    const dayPctEl = document.getElementById('kpi-day-pnl-pct');

    document.getElementById('account-provider').textContent = provider ? ctx.providerLabel(provider) : '--';
    document.getElementById('kpi-equity').textContent = ctx.fmtMoney(account && account.equity);
    document.getElementById('kpi-cash').textContent = ctx.fmtMoney(account && account.cash);
    document.getElementById('kpi-buying-power').textContent = ctx.fmtMoney(account && account.buying_power);
    dayPnlEl.textContent = ctx.fmtMoney(account && account.day_pnl);
    dayPctEl.textContent = ctx.fmtPct(account && account.day_pnl_pct);

    dayPnlEl.className = 'value ' + ((account && Number(account.day_pnl) >= 0) ? 'good' : 'bad');
    dayPctEl.className = 'value ' + ((account && Number(account.day_pnl_pct) >= 0) ? 'good' : 'bad');
    document.getElementById('account-updated').textContent = ctx.asIso(new Date().toISOString());
  }

  function renderStatus(ctx, data) {
    const s = data && data.state ? data.state : {};
    const config = data && data.config ? data.config : {};
    const provider = data && data.execution_broker_provider ? data.execution_broker_provider : 'alpaca';
    const capabilities = data && data.broker_capabilities ? data.broker_capabilities : {};
    const connected = Array.isArray(data && data.connected_brokers) ? data.connected_brokers : [];
    const executionEntry = connected.find((entry) => entry.provider === provider) || null;
    const badgeParts = connected.length
      ? connected.map((entry) => `${ctx.providerLabel(entry.provider)} ${String(entry.mode || '--').toUpperCase()}`)
      : [`${ctx.providerLabel(provider)} ${(s.mode || 'offline').toUpperCase()}`];
    const badge = document.getElementById('mode-badge');
    badge.textContent = badgeParts.join(' + ');
    badge.className = 'mode-badge ' + ((executionEntry?.mode || s.mode) === 'live' ? 'mode-live' : 'mode-paper');

    document.getElementById('status-enabled').textContent = String(!!s.enabled);
    document.getElementById('status-kill').textContent = String(!!s.kill_switch_active);
    document.getElementById('status-managed').textContent = String((s.managed_positions || []).length);
    document.getElementById('status-signals').textContent = String(s.last_scan_signals || 0);
    document.getElementById('status-session-equity').textContent = Number(data.session_start_equity || 0) > 0
      ? ctx.fmtMoney(data.session_start_equity)
      : '--';
    document.getElementById('status-execution-broker').textContent = ctx.providerLabel(provider);
    const activeStrategy = config.strategy_version_id || data.default_import_strategy_version_id || '--';
    document.getElementById('status-strategy').textContent = activeStrategy;
    document.getElementById('status-last-scan').textContent = ctx.asIso(s.last_scan_time);
    document.getElementById('status-kill-reason').textContent = s.kill_switch_reason || '--';
    ctx.renderBridgeRulesSummary(config);

    if (activeStrategy && activeStrategy !== '--') {
      const strategySelect = document.getElementById('strategy-version');
      if (strategySelect && strategySelect.value !== activeStrategy) {
        strategySelect.value = activeStrategy;
      }
    }

    updateStrategyEligibilityHint(ctx);

    const automationEnabled = capabilities.automated_execution !== false;
    document.getElementById('btn-start').disabled = !automationEnabled;
    document.getElementById('btn-scan').disabled = !automationEnabled;

    const running = !!s.enabled;
    ctx.setPollInterval(running ? 10000 : 30000);
  }

  function renderLogs(ctx) {
    const tbody = document.getElementById('logs-body');
    const logs = Array.isArray(ctx.state.logs) ? ctx.state.logs : [];
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No log entries</td></tr>';
      return;
    }
    tbody.innerHTML = logs.slice(0, 200).map((l) => `
      <tr>
        <td>${ctx.asIso(l.timestamp)}</td>
        <td>${l.event || ''}</td>
        <td>${l.strategy_version_id || '--'}</td>
        <td>${l.symbol || ''}</td>
        <td class="muted">${JSON.stringify(l.details || {})}</td>
      </tr>
    `).join('');
  }

  async function loadStrategies(ctx) {
    const select = document.getElementById('strategy-version');
    const hint = document.getElementById('strategy-version-hint');
    select.innerHTML = '<option value="">Loading...</option>';
    try {
      const list = await ctx.api('/api/validator/strategies');
      const options = (Array.isArray(list) ? list : [])
        .filter((s) => s && s.strategy_version_id && !s.strategy_version_id.startsWith('sweep_') && s.source !== 'research')
        .filter((s) => Boolean(s.execution_eligible))
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      if (!options.length) {
        ctx.state.strategyCatalog = [];
        select.innerHTML = '<option value="">No strategies found</option>';
        if (hint) hint.textContent = 'Execution requires an approved strategy with a T3 badge.';
        return;
      }
      ctx.state.strategyCatalog = options;
      select.innerHTML = options.map((s) => {
        const label = s.name || s.strategy_version_id;
        const shortLabel = label.length > 80 ? label.slice(0, 77) + '...' : label;
        const tierLabel = Array.isArray(s.passed_tiers) && s.passed_tiers.length
          ? s.passed_tiers.map((tier) => tier === 'tier1b' ? 'T1B' : tier.toUpperCase().replace('TIER', 'T')).join('/')
          : 'NO-TIER';
        const eligibilityLabel = s.execution_eligible ? 'READY' : 'BLOCKED';
        return `<option value="${s.strategy_version_id}">${shortLabel} [${tierLabel}] (${s.status || 'unknown'} · ${eligibilityLabel})</option>`;
      }).join('');
      updateStrategyEligibilityHint(ctx);
    } catch (err) {
      select.innerHTML = `<option value="">${String(err.message || err)}</option>`;
      if (hint) hint.textContent = 'Unable to load execution-eligible strategies.';
    }
  }

  function getSelectedStrategyRecord(ctx) {
    const selectedId = document.getElementById('strategy-version').value;
    const catalog = Array.isArray(ctx.state.strategyCatalog) ? ctx.state.strategyCatalog : [];
    return catalog.find((entry) => entry.strategy_version_id === selectedId) || null;
  }

  function updateStrategyEligibilityHint(ctx) {
    const hint = document.getElementById('strategy-version-hint');
    const record = getSelectedStrategyRecord(ctx);
    if (!hint) return;
    if (!record) {
      hint.textContent = 'Execution requires an approved strategy with a T3 badge.';
      return;
    }
    if (record.execution_eligible) {
      hint.textContent = `Execution ready: ${record.strategy_version_id} is approved and has a T3 pass.`;
      return;
    }
    const tierLabel = Array.isArray(record.passed_tiers) && record.passed_tiers.length
      ? record.passed_tiers.map((tier) => tier === 'tier1b' ? 'T1B' : tier.toUpperCase().replace('TIER', 'T')).join(', ')
      : 'none';
    hint.textContent = `Blocked: ${record.strategy_version_id} needs status approved and a T3 pass. Current status=${record.status || 'unknown'}, passed tiers=${tierLabel}.`;
  }

  async function refreshStatus(ctx) {
    try {
      const data = await ctx.api('/api/execution/status');
      ctx.state.status = data;
      ctx.renderStatus(data);
      ctx.renderAccount(data.account, data.execution_broker_provider);
      ctx.renderConnectedBrokers(data);
      ctx.renderPositions(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadLogs(ctx) {
    const days = Number(document.getElementById('logs-days').value || 3);
    try {
      ctx.state.logs = await ctx.api(`/api/execution/logs?days=${encodeURIComponent(days)}`);
      renderLogs(ctx);
    } catch (err) {
      ctx.state.logs = [];
      renderLogs(ctx);
    }
  }

  function getStartPayload(ctx) {
    const rules = ctx.getExecutionRulesFromSharedSettings();
    return {
      strategy_version_id: document.getElementById('strategy-version').value,
      scan_cron: document.getElementById('scan-cron').value.trim(),
      timezone: document.getElementById('scan-timezone').value.trim(),
      max_concurrent: Number(rules.maxConcurrent || 3),
      risk_pct_per_trade: Number(rules.riskPercent || 1) / 100,
      max_account_dd_pct: Number(rules.maxDrawdown || 10),
      max_daily_loss_pct: Number(rules.dailyLoss || 5),
    };
  }

  async function startBridge(ctx) {
    const payload = getStartPayload(ctx);
    if (!payload.strategy_version_id) {
      alert('Select a strategy version first.');
      return;
    }
    const selected = getSelectedStrategyRecord(ctx);
    if (selected && !selected.execution_eligible) {
      updateStrategyEligibilityHint(ctx);
      alert(`Execution Desk requires an approved T3 strategy.\n\n${selected.strategy_version_id} is currently ${selected.status || 'unknown'} and is not execution-eligible.`);
      return;
    }
    await ctx.api('/api/execution/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await ctx.refreshStatus();
    await ctx.loadLogs();
  }

  async function stopBridge(ctx) {
    await ctx.api('/api/execution/stop', { method: 'POST' });
    await ctx.refreshStatus();
    await ctx.loadLogs();
  }

  async function manualScan(ctx) {
    const btn = document.getElementById('btn-scan');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Scanning...';
    ctx.showBridgeActionMessage('Running strategy scan across the configured universe...');
    try {
      await ctx.api('/api/execution/scan', { method: 'POST' });
      await ctx.refreshStatus();
      await ctx.loadLogs();
      const signals = Number(ctx.state.status?.state?.last_scan_signals || 0);
      const scanTime = ctx.asIso(ctx.state.status?.state?.last_scan_time);
      ctx.showBridgeActionMessage(`Scan complete: ${signals} signal${signals === 1 ? '' : 's'}${scanTime !== '--' ? ` at ${scanTime}` : ''}.`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async function closeBrokerPosition(ctx, provider, symbol, side) {
    if (!provider || !symbol) {
      alert('A valid provider and symbol are required.');
      return;
    }
    if (!confirm(`Close ${symbol} at ${ctx.providerLabel(provider)} now?`)) return;
    await ctx.api('/api/execution/positions/close', {
      method: 'POST',
      body: JSON.stringify({ provider, symbol, side }),
    });
    await ctx.refreshStatus();
    await ctx.loadLogs();
  }

  async function killBridge(ctx) {
    const reason = prompt('Kill reason:', 'Manual kill switch activated via UI');
    if (reason === null) return;
    if (!confirm('Confirm kill switch? This will cancel orders and close all broker positions.')) return;
    await ctx.api('/api/execution/kill', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await ctx.refreshStatus();
    await ctx.loadLogs();
  }

  function setPollInterval(ctx, ms) {
    if (ctx.state.pollTimer) clearInterval(ctx.state.pollTimer);
    ctx.state.pollTimer = setInterval(async () => {
      await ctx.refreshStatus();
    }, ms);
  }

  async function loadSettings(ctx) {
    try {
      const data = await ctx.api('/api/execution/settings');
      ctx.state.settings = data;
      ctx.state.sharedSettings = ctx.readSharedCopilotSettings();
      ctx.renderBridgeRulesSummary();
      ctx.renderPendingExecutionTicket();
      document.getElementById('setting-broker-provider').value = data.execution_broker_provider || 'alpaca';
      document.getElementById('setting-base-url').value = data.alpaca_base_url || 'https://paper-api.alpaca.markets';
      document.getElementById('setting-mode').value = data.alpaca_mode || 'paper';
      document.getElementById('setting-api-key').placeholder = data.alpaca_api_key || 'PK...';
      document.getElementById('setting-secret-key').placeholder = data.alpaca_secret_key || 'Secret key';
      document.getElementById('setting-oanda-token').placeholder = data.oanda_api_token || 'Personal access token';
      document.getElementById('setting-oanda-account-id').value = data.oanda_account_id || '';
      document.getElementById('setting-oanda-account-id').placeholder = data.oanda_account_id || 'Optional if token resolves one account';
      document.getElementById('setting-oanda-environment').value = data.oanda_environment || 'practice';
      document.getElementById('setting-rh-username').placeholder = data.robinhood_username || 'Email or username';
      document.getElementById('setting-rh-password').placeholder = data.robinhood_password || 'Password';
      document.getElementById('setting-rh-totp').placeholder = data.robinhood_totp_secret || 'Recommended for repeat logins';
      if (ctx.state.status) {
        ctx.renderConnectedBrokers(ctx.state.status);
      }
      if (ctx.state.brokerModalProvider) {
        ctx.updateBrokerSettingsForm(ctx.state.brokerModalProvider, data);
      }
      return data;
    } catch (err) {
      ctx.state.settings = null;
      ctx.showSettingsMsg(err.message || 'Failed to load broker settings.', true);
      throw err;
    }
  }

  function bindEvents(ctx) {
    document.getElementById('btn-start').addEventListener('click', () => startBridge(ctx).catch((e) => alert(e.message)));
    document.getElementById('strategy-version').addEventListener('change', () => updateStrategyEligibilityHint(ctx));
    document.getElementById('btn-stop').addEventListener('click', () => stopBridge(ctx).catch((e) => alert(e.message)));
    document.getElementById('btn-scan').addEventListener('click', () => manualScan(ctx).catch((e) => alert(e.message)));
    document.getElementById('btn-execute-ticket').addEventListener('click', () => ctx.submitPendingExecutionTicket().catch((e) => alert(e.message)));
    document.getElementById('btn-ticket-review').addEventListener('click', () => ctx.openPendingTicketInTradingDesk());
    document.getElementById('btn-ticket-clear').addEventListener('click', () => ctx.clearPendingExecutionTicket());
    document.getElementById('btn-kill').addEventListener('click', () => killBridge(ctx).catch((e) => alert(e.message)));
    document.getElementById('btn-refresh').addEventListener('click', () => refreshStatus(ctx).catch((e) => alert(e.message)));
    document.getElementById('btn-load-logs').addEventListener('click', () => loadLogs(ctx).catch((e) => alert(e.message)));
    document.getElementById('btn-save-external-position').addEventListener('click', () => ctx.saveExternalPosition().catch((e) => ctx.showExternalPositionMessage(e.message || String(e), true)));
    document.getElementById('btn-save-settings').addEventListener('click', () => ctx.saveSettingsAction().catch((e) => alert(e.message)));
    document.getElementById('btn-test-settings').addEventListener('click', () => ctx.testConnection().catch((e) => alert(e.message)));
    document.getElementById('btn-broker-set-execution').addEventListener('click', () => ctx.setBrokerAsExecutionProvider().catch((e) => ctx.showSettingsMsg(e.message || String(e), true)));
    document.getElementById('btn-rh-start').addEventListener('click', () => ctx.startRobinhoodLoginFlow().catch((e) => ctx.showRobinhoodAuthMessage(e.message || String(e), true)));
    document.getElementById('btn-rh-status').addEventListener('click', () => ctx.checkRobinhoodLoginFlow().catch((e) => ctx.showRobinhoodAuthMessage(e.message || String(e), true)));
    document.getElementById('btn-rh-verify').addEventListener('click', () => ctx.verifyRobinhoodLoginFlow().catch((e) => ctx.showRobinhoodAuthMessage(e.message || String(e), true)));
    document.getElementById('btn-rh-fetch').addEventListener('click', () => ctx.fetchRobinhoodPositionsPreview().catch((e) => ctx.showRobinhoodAuthMessage(e.message || String(e), true)));
    document.getElementById('btn-position-modal-use-live').addEventListener('click', () => ctx.usePositionModalLiveValues());
    document.getElementById('btn-position-modal-use-suggested').addEventListener('click', () => ctx.usePositionModalSuggestedValues());
    document.getElementById('btn-position-modal-apply-template').addEventListener('click', () => ctx.applyPositionTemplate().catch((e) => ctx.showPositionModalMessage(e.message || String(e), true)));
    document.getElementById('btn-position-modal-save').addEventListener('click', () => ctx.savePositionModal().catch((e) => ctx.showPositionModalMessage(e.message || String(e), true)));
    document.getElementById('position-modal-strategy').addEventListener('change', () => ctx.updatePositionModalTemplateSummary().catch((e) => ctx.showPositionModalMessage(e.message || String(e), true)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        ctx.closeBrokerModal();
        ctx.closePositionModal();
        ctx.closeExternalPositionModal();
      }
    });
  }

  async function init(ctx) {
    try {
      ctx.state.focusTrade = JSON.parse(localStorage.getItem('executionFocusTrade') || 'null');
    } catch {
      ctx.state.focusTrade = null;
    }
    if (!ctx.state.tradePlanStoreBound && global.TradePlanStore?.subscribe) {
      global.TradePlanStore.subscribe(() => {
        ctx.applyTradingDeskExecutionIntent();
      }, { immediate: false });
      ctx.state.tradePlanStoreBound = true;
    }
    ctx.state.sharedSettings = ctx.readSharedCopilotSettings();
    ctx.bindEvents();
    ctx.renderBridgeRulesSummary();
    ctx.renderPendingExecutionTicket();
    await ctx.loadSettings();
    await ctx.loadStrategies();
    await Promise.all([ctx.refreshStatus(), ctx.loadLogs()]);
    ctx.applyTradingDeskExecutionIntent();
    if (ctx.state.focusTrade && ctx.state.focusTrade.symbol) {
      ctx.showBridgeActionMessage(`Focused from Position Book: ${ctx.state.focusTrade.symbol}. Adjust exits in the Positions table below.`);
      localStorage.removeItem('executionFocusTrade');
    }
    ctx.setPollInterval(30000);
  }

  global.ExecutionDeskStatus = {
    bindEvents,
    closeBrokerPosition,
    getStartPayload,
    init,
    killBridge,
    loadLogs,
    loadSettings,
    loadStrategies,
    manualScan,
    refreshStatus,
    renderAccount,
    renderLogs,
    renderStatus,
    setPollInterval,
    startBridge,
    stopBridge,
  };
})(window);
