(function initExecutionDeskBrokers(global) {
  function openBrokerModalByIndex(ctx, index) {
    const { state, openBrokerModal } = ctx;
    const row = Array.isArray(state.brokerRows) ? state.brokerRows[index] : null;
    if (!row) return;
    openBrokerModal(row.providerKey);
  }

  function closeBrokerModal(ctx, event) {
    const { state, showSettingsMsg } = ctx;
    if (event && event.target && event.target.id !== 'broker-modal') return;
    document.getElementById('broker-modal').classList.remove('active');
    state.brokerModalProvider = null;
    showSettingsMsg('', false);
  }

  function describeBrokerRole(ctx, row) {
    const { getExecutionProvider } = ctx;
    if (!row) return '--';
    if (row.providerKey === getExecutionProvider()) return 'Execution Broker';
    if (row.providerKey === 'robinhood') return 'Read Only Mirror';
    if (row.configured) return 'Connected Broker';
    return 'Available';
  }

  function describeBrokerStatus(row) {
    if (!row) return '--';
    if (row.error) return row.error;
    if (row.connected) return 'Connected';
    if (row.configured) return row.providerKey === 'robinhood' ? 'Credentials saved' : 'Saved, waiting for test';
    return 'Not configured';
  }

  function renderConnectedBrokers(ctx, data) {
    const {
      state,
      escapeHtml,
      fmtMoney,
      getBrokerSavedMode,
      getConfiguredFlag,
      getExecutionProvider,
      normalizeBrokerProvider,
      providerLabel,
      updateBrokerSettingsForm,
    } = ctx;
    const tbody = document.getElementById('connected-brokers-body');
    const brokers = Array.isArray(data && data.connected_brokers) ? data.connected_brokers : [];
    const settings = state.settings || {};
    const executionProvider = getExecutionProvider();
    const byProvider = new Map(brokers.map((entry) => [normalizeBrokerProvider(entry.provider), entry]));
    const providerOrder = ['alpaca', 'oanda', 'robinhood'];

    state.brokerRows = providerOrder.map((provider) => {
      const entry = byProvider.get(provider) || null;
      const configured = getConfiguredFlag(settings, provider);
      const connected = !!entry && !entry.error;
      const role = provider === executionProvider
        ? 'Execution'
        : provider === 'robinhood'
          ? 'Read Only'
          : configured
            ? 'Connected'
            : 'Available';
      return {
        providerKey: provider,
        provider: providerLabel(provider),
        configured,
        connected,
        role,
        mode: entry?.mode || getBrokerSavedMode(provider, settings),
        account: entry?.account || null,
        positions: Array.isArray(entry?.positions) ? entry.positions : [],
        error: entry?.error || null,
      };
    });

    document.getElementById('connected-brokers-count').textContent = String(state.brokerRows.length);
    tbody.innerHTML = state.brokerRows.map((row, index) => `
      <tr class="position-row position-row--interactive ${row.providerKey === executionProvider ? 'position-row--focused' : ''}" tabindex="0" onclick="openBrokerModalByIndex(${index})" onkeydown="handleBrokerRowKey(event, ${index});">
        <td>${row.provider}</td>
        <td>${row.role}</td>
        <td>${String(row.mode || '--').toUpperCase()}</td>
        <td>${row.configured ? 'yes' : 'no'}</td>
        <td>${fmtMoney(row.account && row.account.equity)}</td>
        <td>${fmtMoney(row.account && row.account.cash)}</td>
        <td>${fmtMoney(row.account && row.account.buying_power)}</td>
        <td>${Array.isArray(row.positions) ? row.positions.length : 0}</td>
        <td class="${row.error ? 'bad' : row.connected ? 'good' : 'muted'}">${escapeHtml(describeBrokerStatus(row))}</td>
      </tr>
    `).join('');

    if (state.brokerModalProvider) {
      updateBrokerSettingsForm(state.brokerModalProvider, settings);
    }
  }

  function updateBrokerSettingsForm(ctx, provider, data = {}) {
    const {
      state,
      brokerSupportsExecution,
      getBrokerSavedMode,
      getConfiguredFlag,
      getExecutionProvider,
      normalizeBrokerProvider,
      providerLabel,
      describeBrokerRole,
      describeBrokerStatus,
    } = ctx;
    const normalized = normalizeBrokerProvider(provider || state.brokerModalProvider || 'alpaca');
    state.brokerModalProvider = normalized;
    document.getElementById('setting-broker-provider').value = normalized;
    document.getElementById('alpaca-settings-fields').style.display = normalized === 'alpaca' ? '' : 'none';
    document.getElementById('oanda-settings-fields').style.display = normalized === 'oanda' ? '' : 'none';
    document.getElementById('robinhood-settings-fields').style.display = normalized === 'robinhood' ? '' : 'none';
    document.getElementById('btn-test-settings').style.display = normalized === 'robinhood' ? 'none' : '';
    document.getElementById('btn-save-settings').textContent = 'Save Broker';

    const brokerRow = state.brokerRows.find((row) => row.providerKey === normalized) || null;
    const role = brokerRow ? describeBrokerRole(brokerRow) : '--';
    const status = brokerRow ? describeBrokerStatus(brokerRow) : 'Not configured';
    const supportNotes = {
      alpaca: 'Alpaca drives automation. This is the provider that can run the full bridge execution flow.',
      oanda: 'OANDA supports account sync plus broker-native protect and close actions. Full bridge automation still stays Alpaca-only for now.',
      robinhood: 'Robinhood is read-only for now. Save credentials here, complete the login challenge, then fetch positions for mirroring into Execution Desk and Position Book.',
    };

    document.getElementById('broker-modal-title').textContent = `${providerLabel(normalized)} Broker`;
    document.getElementById('broker-modal-summary').textContent = normalized === 'robinhood'
      ? 'Robinhood settings, login workflow, and read-only position fetch all live here.'
      : `${providerLabel(normalized)} credentials and connection controls live here. Open this broker row any time to adjust them.`;
    document.getElementById('broker-modal-configured').textContent = getConfiguredFlag(data, normalized) ? 'Yes' : 'No';
    document.getElementById('broker-modal-mode').textContent = String(brokerRow?.mode || getBrokerSavedMode(normalized, data) || '--').toUpperCase();
    document.getElementById('broker-modal-role').textContent = role;
    document.getElementById('broker-modal-status').textContent = status;
    document.getElementById('broker-modal-positions').textContent = String(Array.isArray(brokerRow?.positions) ? brokerRow.positions.length : 0);
    document.getElementById('broker-modal-equity').textContent = ctx.fmtMoney(brokerRow?.account && brokerRow.account.equity);
    document.getElementById('provider-note').textContent = supportNotes[normalized];

    const executionActions = document.getElementById('broker-execution-actions');
    const executionButton = document.getElementById('btn-broker-set-execution');
    const executionNote = document.getElementById('broker-execution-note');
    if (brokerSupportsExecution(normalized)) {
      executionActions.style.display = '';
      if (normalized === getExecutionProvider()) {
        executionButton.disabled = true;
        executionButton.textContent = 'Current Execution Broker';
        executionNote.textContent = `${providerLabel(normalized)} is currently receiving Execution orders.`;
      } else {
        executionButton.disabled = false;
        executionButton.textContent = 'Set As Execution Broker';
        executionNote.textContent = `Switch Execution order routing to ${providerLabel(normalized)}.`;
      }
    } else {
      executionActions.style.display = 'none';
      executionButton.disabled = true;
    }
  }

  function openBrokerModal(ctx, provider) {
    const { state, showSettingsMsg, updateBrokerSettingsForm } = ctx;
    updateBrokerSettingsForm(provider, state.settings || {});
    showSettingsMsg('', false);
    document.getElementById('broker-modal').classList.add('active');
  }

  function handleBrokerRowKey(ctx, event, index) {
    if (!event) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openBrokerModalByIndex(ctx, index);
    }
  }

  function showSettingsMsg(text, isError) {
    const el = document.getElementById('settings-message');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? '' : 'none';
    el.style.color = isError ? 'var(--color-negative)' : 'var(--color-positive)';
    if (text) {
      setTimeout(() => {
        if (el.textContent === text) {
          el.style.display = 'none';
        }
      }, 5000);
    }
  }

  function getRobinhoodPayload() {
    return {
      robinhood_username: document.getElementById('setting-rh-username').value.trim() || undefined,
      robinhood_password: document.getElementById('setting-rh-password').value.trim() || undefined,
      robinhood_totp_secret: document.getElementById('setting-rh-totp').value.trim() || undefined,
      robinhood_mfa_code: document.getElementById('setting-rh-mfa').value.trim() || undefined,
    };
  }

  function showRobinhoodAuthMessage(text, isError = false) {
    const el = document.getElementById('robinhood-auth-message');
    if (!el) return;
    el.textContent = text || 'Robinhood auth idle.';
    el.className = 'mono ' + (isError ? 'bad' : 'muted');
  }

  function renderRobinhoodPositions(ctx, snapshot) {
    const { fmtMoney } = ctx;
    const tbody = document.getElementById('robinhood-preview-body');
    const stocks = Array.isArray(snapshot && snapshot.stocks) ? snapshot.stocks : [];
    const options = Array.isArray(snapshot && snapshot.options) ? snapshot.options : [];
    const rows = [];

    for (const item of stocks.slice(0, 12)) {
      rows.push({
        type: 'Stock',
        symbol: item.symbol || '--',
        qty: item.quantity,
        entry: item.average_buy_price,
        mark: item.current_price,
      });
    }

    for (const item of options.slice(0, 12)) {
      const optionLabel = [
        item.symbol || '--',
        item.expiration_date || '',
        item.strike_price != null ? item.strike_price : '',
        item.option_type || '',
      ].filter(Boolean).join(' ');
      rows.push({
        type: 'Option',
        symbol: optionLabel || '--',
        qty: item.quantity,
        entry: item.average_price,
        mark: item.mark_price,
      });
    }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No Robinhood positions loaded</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.type}</td>
        <td>${row.symbol}</td>
        <td>${row.qty == null ? '--' : row.qty}</td>
        <td>${fmtMoney(row.entry)}</td>
        <td>${fmtMoney(row.mark)}</td>
      </tr>
    `).join('');
  }

  function handleRobinhoodResult(ctx, data, fallbackMessage) {
    const { showRobinhoodAuthMessage, renderRobinhoodPositions } = ctx;
    const snapshot = data && data.snapshot ? data.snapshot : null;
    const challengeType = data && data.challenge_type ? data.challenge_type : null;
    const challengeStatus = data && data.challenge_status ? data.challenge_status : null;
    const workflowStatus = data && data.workflow_status ? data.workflow_status : null;

    let message = data && data.message ? data.message : fallbackMessage;
    if (challengeType) {
      message += ` Challenge: ${challengeType}${challengeStatus ? ` (${challengeStatus})` : ''}.`;
    }
    if (workflowStatus) {
      message += ` Workflow: ${workflowStatus}.`;
    }
    if (snapshot && snapshot.counts) {
      message += ` Positions: ${snapshot.counts.stocks || 0} stocks, ${snapshot.counts.options || 0} options.`;
    }
    showRobinhoodAuthMessage(message, false);
    renderRobinhoodPositions(snapshot);
  }

  async function startRobinhoodLoginFlow(ctx) {
    const { api, getRobinhoodPayload, handleRobinhoodResult, showRobinhoodAuthMessage } = ctx;
    showRobinhoodAuthMessage('Starting Robinhood login...', false);
    const data = await api('/api/execution/robinhood/login/start', {
      method: 'POST',
      body: JSON.stringify(getRobinhoodPayload()),
    });
    handleRobinhoodResult(data, 'Robinhood login started.');
  }

  async function checkRobinhoodLoginFlow(ctx) {
    const { api, getRobinhoodPayload, handleRobinhoodResult, showRobinhoodAuthMessage } = ctx;
    showRobinhoodAuthMessage('Checking Robinhood login status...', false);
    const data = await api('/api/execution/robinhood/login/status', {
      method: 'POST',
      body: JSON.stringify(getRobinhoodPayload()),
    });
    handleRobinhoodResult(data, 'Robinhood status checked.');
  }

  async function verifyRobinhoodLoginFlow(ctx) {
    const { api, getRobinhoodPayload, handleRobinhoodResult, showRobinhoodAuthMessage } = ctx;
    const code = document.getElementById('setting-rh-mfa').value.trim();
    if (!code) {
      showRobinhoodAuthMessage('Enter the Robinhood code first, then click Verify Code.', true);
      return;
    }
    showRobinhoodAuthMessage('Submitting Robinhood verification code...', false);
    const data = await api('/api/execution/robinhood/login/verify', {
      method: 'POST',
      body: JSON.stringify({
        ...getRobinhoodPayload(),
        verification_code: code,
      }),
    });
    handleRobinhoodResult(data, 'Robinhood code submitted.');
  }

  async function fetchRobinhoodPositionsPreview(ctx) {
    const { api, getRobinhoodPayload, handleRobinhoodResult, showRobinhoodAuthMessage } = ctx;
    showRobinhoodAuthMessage('Fetching Robinhood positions...', false);
    const data = await api('/api/execution/robinhood/positions', {
      method: 'POST',
      body: JSON.stringify(getRobinhoodPayload()),
    });
    handleRobinhoodResult(data, 'Robinhood positions fetched.');
  }

  async function saveSettingsAction(ctx, options = {}) {
    const {
      state,
      api,
      brokerSupportsExecution,
      getExecutionProvider,
      loadSettings,
      normalizeBrokerProvider,
      providerLabel,
      refreshStatus,
      showSettingsMsg,
    } = ctx;
    const provider = normalizeBrokerProvider(state.brokerModalProvider || document.getElementById('setting-broker-provider').value || 'alpaca');
    const executionProvider = options.setExecutionProvider && brokerSupportsExecution(provider)
      ? provider
      : getExecutionProvider();
    const key = document.getElementById('setting-api-key').value.trim();
    const secret = document.getElementById('setting-secret-key').value.trim();
    const oandaToken = document.getElementById('setting-oanda-token').value.trim();
    const oandaAccountId = document.getElementById('setting-oanda-account-id').value.trim();
    const robinhoodUsername = document.getElementById('setting-rh-username').value.trim();
    const robinhoodPassword = document.getElementById('setting-rh-password').value.trim();
    const robinhoodTotpSecret = document.getElementById('setting-rh-totp').value.trim();

    if (provider === 'alpaca' && !key && !secret && !document.getElementById('setting-api-key').placeholder.includes('****')) {
      showSettingsMsg('Both Alpaca API fields are required.', true);
      return;
    }
    if ((robinhoodUsername && !robinhoodPassword) || (!robinhoodUsername && robinhoodPassword)) {
      showSettingsMsg('Robinhood username and password must be saved together.', true);
      return;
    }
    try {
      await api('/api/execution/settings', {
        method: 'POST',
        body: JSON.stringify({
          execution_broker_provider: executionProvider,
          alpaca_api_key: key,
          alpaca_secret_key: secret,
          alpaca_base_url: document.getElementById('setting-base-url').value,
          alpaca_mode: document.getElementById('setting-mode').value,
          oanda_api_token: oandaToken,
          oanda_account_id: oandaAccountId,
          oanda_environment: document.getElementById('setting-oanda-environment').value,
          robinhood_username: robinhoodUsername,
          robinhood_password: robinhoodPassword,
          robinhood_totp_secret: robinhoodTotpSecret,
        }),
      });
      showSettingsMsg(options.setExecutionProvider
        ? `${providerLabel(provider)} saved and set as the Execution broker.`
        : `${providerLabel(provider)} settings saved successfully.`, false);
      document.getElementById('setting-api-key').value = '';
      document.getElementById('setting-secret-key').value = '';
      document.getElementById('setting-oanda-token').value = '';
      document.getElementById('setting-rh-username').value = '';
      document.getElementById('setting-rh-password').value = '';
      document.getElementById('setting-rh-totp').value = '';
      document.getElementById('setting-rh-mfa').value = '';
      await loadSettings().catch(() => null);
      await refreshStatus();
    } catch (err) {
      showSettingsMsg(err.message || 'Failed to save settings.', true);
    }
  }

  async function testConnection(ctx, providerOverride) {
    const { normalizeBrokerProvider, getExecutionProvider, providerLabel, showSettingsMsg, refreshStatus } = ctx;
    try {
      const provider = normalizeBrokerProvider(providerOverride || ctx.state.brokerModalProvider || document.getElementById('setting-broker-provider').value || getExecutionProvider());
      if (provider === 'robinhood') {
        showSettingsMsg('Use the Robinhood login controls in this broker modal instead of Test Connection.', false);
        return;
      }

      const res = await fetch('/api/execution/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json();
      if (body.success && body.data?.connected) {
        showSettingsMsg(`${providerLabel(body.data.broker_provider)} OK (${body.data.mode})`, false);
        await refreshStatus();
        return;
      }
      showSettingsMsg(`${providerLabel(provider)} failed: ${body.error || 'Unknown error'}`, true);
    } catch (err) {
      showSettingsMsg('Connection failed: ' + (err.message || err), true);
    }
  }

  async function setBrokerAsExecutionProvider(ctx) {
    const { brokerSupportsExecution, normalizeBrokerProvider, showSettingsMsg, saveSettingsAction, updateBrokerSettingsForm } = ctx;
    const provider = normalizeBrokerProvider(ctx.state.brokerModalProvider || document.getElementById('setting-broker-provider').value || 'alpaca');
    if (!brokerSupportsExecution(provider)) {
      showSettingsMsg('This broker cannot be the Execution provider.', true);
      return;
    }
    await saveSettingsAction({ setExecutionProvider: true });
    updateBrokerSettingsForm(provider, ctx.state.settings || {});
  }

  global.ExecutionDeskBrokers = {
    checkRobinhoodLoginFlow,
    closeBrokerModal,
    describeBrokerRole,
    describeBrokerStatus,
    fetchRobinhoodPositionsPreview,
    getRobinhoodPayload,
    handleBrokerRowKey,
    handleRobinhoodResult,
    openBrokerModal,
    openBrokerModalByIndex,
    renderConnectedBrokers,
    renderRobinhoodPositions,
    saveSettingsAction,
    setBrokerAsExecutionProvider,
    showRobinhoodAuthMessage,
    showSettingsMsg,
    startRobinhoodLoginFlow,
    testConnection,
    updateBrokerSettingsForm,
    verifyRobinhoodLoginFlow,
  };
})(window);
