// Global settings page — reads/writes the same 'copilotSettings' key
// used by the Trading Desk so all modules share one source of truth.

const SETTINGS_KEY = 'copilotSettings';
const API_URL = '';

const FIELD_MAP = {
  // Account
  's-account-size':               'accountSize',
  's-available-balance':          'availableBalance',
  's-daily-loss-limit':           'dailyLossLimit',
  's-max-open-positions':         'maxOpenPositions',
  's-execution-max-concurrent':   'executionMaxConcurrent',
  // Position sizing
  's-risk-percent':               'riskPercent',
  's-max-position':               'maxPosition',
  // Stop loss defaults
  's-default-stop-type':          'defaultStopType',
  's-default-stop-value':         'defaultStopValue',
  's-default-stop-buffer':        'defaultStopBuffer',
  // Take profit / exit defaults
  's-min-rr':                     'minRR',
  's-default-take-profit-r':      'defaultTakeProfitR',
  's-default-max-hold':           'defaultMaxHold',
  's-default-breakeven-r':        'defaultBreakevenR',
  // Trailing stop defaults
  's-default-trailing-type':      'defaultTrailingType',
  's-default-trailing-value':     'defaultTrailingValue',
  // Circuit breakers
  's-max-daily-trades':           'maxDailyTrades',
  's-max-consecutive-losses':     'maxConsecutiveLosses',
  's-max-drawdown':               'maxDrawdown',
  's-require-approval':           'requireApproval',
  // AI
  's-ai-provider':                'aiProvider',
  's-ai-model':                   'aiModel',
  's-plugin-engineer-model':      'pluginEngineerModel',
  's-research-strategist-model':  'researchStrategistModel',
  's-research-analyst-model':     'researchAnalystModel',
  's-validator-analyst-model':    'validatorAnalystModel',
  's-ai-temperature':             'aiTemperature',
};

const BACKEND_PROMPT_FIELD_MAP = {
  's-copilot-system-prompt': 'copilot',
  's-plugin-engineer-system-prompt': 'plugin_engineer',
  's-research-strategist-system-prompt': 'research_strategist',
  's-research-analyst-system-prompt': 'research_analyst',
  's-validator-analyst-system-prompt': 'validator_analyst',
};

let hydrationStatusPoll = null;

function loadSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch(e) {}

  Object.entries(FIELD_MAP).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (!el || !(key in stored)) return;
    if (el.type === 'checkbox') el.checked = stored[key];
    else el.value = stored[key];
  });

  updateTempLabel();
}

function setBackendAIStatus(text, tone) {
  const el = document.getElementById('s-openai-backend-status');
  if (!el) return;
  el.textContent = text;
  if (tone === 'error') el.style.color = 'var(--color-danger)';
  else if (tone === 'success') el.style.color = 'var(--color-positive)';
  else el.style.color = 'var(--color-text-muted)';
}

function setHydrationStatus(text, tone) {
  const el = document.getElementById('s-ledger-hydration-status');
  if (!el) return;
  el.textContent = text;
  if (tone === 'error') el.style.color = 'var(--color-danger)';
  else if (tone === 'success') el.style.color = 'var(--color-positive)';
  else el.style.color = 'var(--color-text-muted)';
}

function setHydrationMeta(text) {
  const el = document.getElementById('s-ledger-hydration-meta');
  if (!el) return;
  el.textContent = text || '';
}

function setConsumerCycleStatus(text, tone) {
  const el = document.getElementById('s-consumer-cycle-status');
  if (!el) return;
  el.textContent = text;
  if (tone === 'error') el.style.color = 'var(--color-danger)';
  else if (tone === 'success') el.style.color = 'var(--color-positive)';
  else el.style.color = 'var(--color-text-muted)';
}

function setConsumerCycleMeta(text) {
  const el = document.getElementById('s-consumer-cycle-meta');
  if (!el) return;
  el.textContent = text || '';
}

function formatHydrationEta(seconds, fallbackDisplay) {
  if (fallbackDisplay) return fallbackDisplay;
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function loadBackendAISettings() {
  setBackendAIStatus('Loading backend AI settings...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ai/settings`);
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const input = document.getElementById('s-openai-api-key');
    if (input) {
      input.value = '';
      input.placeholder = data.data?.openai_api_key || 'sk-...';
    }

    const rolePrompts = data.data?.role_prompts || {};
    Object.entries(BACKEND_PROMPT_FIELD_MAP).forEach(([elementId, roleKey]) => {
      const field = document.getElementById(elementId);
      if (!field) return;
      field.value = typeof rolePrompts[roleKey] === 'string' ? rolePrompts[roleKey] : '';
    });

    const source = data.data?.source || 'none';
    const configured = !!data.data?.configured;
    setBackendAIStatus(
      configured
        ? `Configured (${source})`
        : 'Not configured',
      configured ? 'success' : 'muted'
    );
  } catch (err) {
    setBackendAIStatus(`Failed to load backend AI settings: ${err.message}`, 'error');
  }
}

function saveSetting(showFeedback) {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch(e) {}

  Object.entries(FIELD_MAP).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    stored[key] = el.type === 'checkbox' ? el.checked : el.value;
  });

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));

  // Always show brief "Saved" flash
  const status = document.getElementById('save-status');
  if (status) {
    status.classList.add('visible');
    clearTimeout(status._t);
    status._t = setTimeout(() => status.classList.remove('visible'), 1800);
  }
}

async function saveBackendAISettings() {
  const input = document.getElementById('s-openai-api-key');
  const openai_api_key = String(input?.value || '').trim();
  const role_prompts = {};
  Object.entries(BACKEND_PROMPT_FIELD_MAP).forEach(([elementId, roleKey]) => {
    const field = document.getElementById(elementId);
    const value = String(field?.value || '').trim();
    if (value) role_prompts[roleKey] = value;
  });

  setBackendAIStatus('Saving backend AI settings...', 'muted');
  try {
    const payload = { role_prompts };
    if (openai_api_key) payload.openai_api_key = openai_api_key;

    const res = await fetch(`${API_URL}/api/ai/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    if (input) {
      input.value = '';
      input.placeholder = data.data?.openai_api_key || 'sk-...';
    }
    setBackendAIStatus('Backend AI settings saved.', 'success');
  } catch (err) {
    setBackendAIStatus(`Failed to save backend AI settings: ${err.message}`, 'error');
  }
}

async function testBackendAISettings() {
  setBackendAIStatus('Testing OpenAI API key...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ai/settings/test`, { method: 'POST' });
    const data = await res.json();
    if (!data?.success) {
      throw new Error(data?.error || 'OpenAI test failed');
    }

    const source = data.data?.source ? ` via ${data.data.source}` : '';
    setBackendAIStatus(`OpenAI connection OK${source}.`, 'success');
  } catch (err) {
    setBackendAIStatus(`OpenAI test failed: ${err.message}`, 'error');
  }
}

function toggleHydrationScheduleFields() {
  const enabled = !!document.getElementById('s-ledger-hydration-enabled')?.checked;
  const frequency = document.getElementById('s-ledger-hydration-frequency')?.value || 'manual';
  const weeklyField = document.getElementById('ledger-hydration-day-field');
  if (weeklyField) weeklyField.style.display = frequency === 'weekly' && enabled ? '' : 'none';

  [
    's-ledger-hydration-frequency',
    's-ledger-hydration-day-of-week',
    's-ledger-hydration-time',
    's-ledger-hydration-timezone',
    's-ledger-hydration-workers',
    's-ledger-hydration-limit',
    's-ledger-hydration-annual-count',
    's-ledger-hydration-quarterly-count',
    's-ledger-hydration-current-count',
    's-ledger-hydration-write-report',
    's-ledger-hydration-refresh-valuations',
    's-ledger-hydration-refresh-consumer-cycle',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const isManualOnly = frequency === 'manual';
    el.disabled = !enabled && id !== 's-ledger-hydration-frequency' ? true : false;
    if (id === 's-ledger-hydration-day-of-week') {
      el.disabled = !enabled || isManualOnly || frequency !== 'weekly';
    }
    if (id === 's-ledger-hydration-time' || id === 's-ledger-hydration-timezone') {
      el.disabled = !enabled || isManualOnly;
    }
  });
}

function collectHydrationScheduleSettings() {
  return {
    enabled: !!document.getElementById('s-ledger-hydration-enabled')?.checked,
    frequency: document.getElementById('s-ledger-hydration-frequency')?.value || 'manual',
    day_of_week: document.getElementById('s-ledger-hydration-day-of-week')?.value || '0',
    time_of_day: document.getElementById('s-ledger-hydration-time')?.value || '02:00',
    timezone: (document.getElementById('s-ledger-hydration-timezone')?.value || 'America/Los_Angeles').trim(),
    workers: Number(document.getElementById('s-ledger-hydration-workers')?.value || 3),
    limit: Number(document.getElementById('s-ledger-hydration-limit')?.value || 0),
    annual_count: Number(document.getElementById('s-ledger-hydration-annual-count')?.value || 1),
    quarterly_count: Number(document.getElementById('s-ledger-hydration-quarterly-count')?.value || 2),
    current_count: Number(document.getElementById('s-ledger-hydration-current-count')?.value || 6),
    write_report: !!document.getElementById('s-ledger-hydration-write-report')?.checked,
    refresh_valuations: !!document.getElementById('s-ledger-hydration-refresh-valuations')?.checked,
    refresh_yahoo_identity_metadata: !!document.getElementById('s-ledger-hydration-refresh-yahoo-identity')?.checked,
    refresh_consumer_cycle_classifications: !!document.getElementById('s-ledger-hydration-refresh-consumer-cycle')?.checked,
  };
}

function applyHydrationScheduleSettings(data) {
  const config = data?.config || {};
  const runtime = data?.runtime || {};
  const consumerRuntime = data?.consumer_cycle_runtime || {};
  const latestJob = data?.latest_job || null;
  const setValue = (id, value, isCheckbox = false) => {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    if (isCheckbox) el.checked = !!value;
    else el.value = String(value);
  };

  setValue('s-ledger-hydration-enabled', config.enabled, true);
  setValue('s-ledger-hydration-frequency', config.frequency || 'manual');
  setValue('s-ledger-hydration-day-of-week', config.day_of_week || '0');
  setValue('s-ledger-hydration-time', config.time_of_day || '02:00');
  setValue('s-ledger-hydration-timezone', config.timezone || 'America/Los_Angeles');
  setValue('s-ledger-hydration-workers', config.workers ?? 3);
  setValue('s-ledger-hydration-limit', config.limit ?? 0);
  setValue('s-ledger-hydration-annual-count', config.annual_count ?? 1);
  setValue('s-ledger-hydration-quarterly-count', config.quarterly_count ?? 2);
  setValue('s-ledger-hydration-current-count', config.current_count ?? 6);
  setValue('s-ledger-hydration-write-report', config.write_report !== false, true);
  setValue('s-ledger-hydration-refresh-valuations', config.refresh_valuations !== false, true);
  setValue('s-ledger-hydration-refresh-yahoo-identity', config.refresh_yahoo_identity_metadata !== false, true);
  setValue('s-ledger-hydration-refresh-consumer-cycle', config.refresh_consumer_cycle_classifications !== false, true);

  const scheduleDescription = data?.schedule_description || 'Manual only';
  const etaText = formatHydrationEta(latestJob?.eta_seconds, latestJob?.eta_display);
  const runningProgressText = latestJob && runtime?.running
    ? [
        Number.isFinite(Number(latestJob.completed_count)) && Number.isFinite(Number(latestJob.candidate_count))
          ? `${latestJob.completed_count}/${latestJob.candidate_count} complete`
          : null,
        Number.isFinite(Number(latestJob.symbols_per_hour))
          ? `${Number(latestJob.symbols_per_hour).toFixed(1)} symbols/hour`
          : null,
        etaText ? `ETA ${etaText}` : null,
      ].filter(Boolean).join(' · ')
    : '';
  const statusText = runtime?.running
    ? `Running now. ${runningProgressText || runtime.last_message || ''}`.trim()
    : `Idle. ${scheduleDescription}`;
  setHydrationStatus(statusText, runtime?.running ? 'success' : 'muted');

  const metaBits = [
    runtime?.last_started_at ? `Last started: ${new Date(runtime.last_started_at).toLocaleString()}` : null,
    runtime?.last_finished_at ? `Last finished: ${new Date(runtime.last_finished_at).toLocaleString()}` : null,
    runtime?.last_exit_code !== undefined && runtime?.last_exit_code !== null ? `Exit: ${runtime.last_exit_code}` : null,
    runtime?.last_source ? `Source: ${runtime.last_source}` : null,
  ].filter(Boolean);
  if (latestJob) {
    if (Number.isFinite(Number(latestJob.progress_pct))) {
      metaBits.push(`Progress: ${Number(latestJob.progress_pct).toFixed(1)}%`);
    }
    if (Number.isFinite(Number(latestJob.completed_count)) && Number.isFinite(Number(latestJob.candidate_count))) {
      metaBits.push(`Completed: ${latestJob.completed_count}/${latestJob.candidate_count}`);
    }
    if (Number.isFinite(Number(latestJob.failed_count)) && Number(latestJob.failed_count) > 0) {
      metaBits.push(`Failed: ${latestJob.failed_count}`);
    }
    if (Number.isFinite(Number(latestJob.symbols_per_hour))) {
      metaBits.push(`Throughput: ${Number(latestJob.symbols_per_hour).toFixed(1)}/hr`);
    }
    if (etaText) metaBits.push(`ETA: ${etaText}`);
  }
  if (runtime?.last_error) metaBits.push(`Error: ${runtime.last_error}`);
  if (runtime?.last_report_path) metaBits.push(`Report: ${runtime.last_report_path}`);
  if (latestJob?.report_path && latestJob.report_path !== runtime?.last_report_path) {
    metaBits.push(`Job report: ${latestJob.report_path}`);
  }
  setHydrationMeta(metaBits.join(' • '));

  const consumerStatusText = consumerRuntime?.running
    ? `Running now. ${consumerRuntime.last_message || 'Refreshing consumer-cycle classifications...'}`.trim()
    : `Idle.${consumerRuntime?.last_message ? ` ${consumerRuntime.last_message}` : ''}`;
  setConsumerCycleStatus(consumerStatusText, consumerRuntime?.running ? 'success' : 'muted');
  const consumerMetaBits = [
    consumerRuntime?.last_started_at ? `Last started: ${new Date(consumerRuntime.last_started_at).toLocaleString()}` : null,
    consumerRuntime?.last_finished_at ? `Last finished: ${new Date(consumerRuntime.last_finished_at).toLocaleString()}` : null,
    consumerRuntime?.last_exit_code !== undefined && consumerRuntime?.last_exit_code !== null ? `Exit: ${consumerRuntime.last_exit_code}` : null,
    consumerRuntime?.last_source ? `Source: ${consumerRuntime.last_source}` : null,
    consumerRuntime?.last_error ? `Error: ${consumerRuntime.last_error}` : null,
  ].filter(Boolean);
  setConsumerCycleMeta(consumerMetaBits.join(' • '));
  toggleHydrationScheduleFields();

  if (hydrationStatusPoll) {
    clearInterval(hydrationStatusPoll);
    hydrationStatusPoll = null;
  }
  if (runtime?.running || consumerRuntime?.running) {
    hydrationStatusPoll = setInterval(() => loadHydrationScheduleSettings(true), 10000);
  }
}

async function loadHydrationScheduleSettings(silent) {
  if (!silent) setHydrationStatus('Loading hydration settings...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ledger-hydration/settings`);
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applyHydrationScheduleSettings(data.data);
  } catch (err) {
    setHydrationStatus(`Failed to load hydration settings: ${err.message}`, 'error');
  }
}

async function saveHydrationScheduleSettings() {
  setHydrationStatus('Saving hydration schedule...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ledger-hydration/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectHydrationScheduleSettings()),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applyHydrationScheduleSettings(data.data);
    setHydrationStatus('Hydration schedule saved.', 'success');
  } catch (err) {
    setHydrationStatus(`Failed to save hydration schedule: ${err.message}`, 'error');
  }
}

async function runHydrationNow() {
  setHydrationStatus('Starting hydration job...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ledger-hydration/run`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applyHydrationScheduleSettings(data.data);
    setHydrationStatus(data.data?.started ? 'Hydration job started.' : (data.data?.message || 'Hydration job already running.'), data.data?.started ? 'success' : 'muted');
  } catch (err) {
    setHydrationStatus(`Failed to start hydration job: ${err.message}`, 'error');
  }
}

async function runConsumerCycleClassificationNow() {
  setConsumerCycleStatus('Starting consumer-cycle classification refresh...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ledger-hydration/run-consumer-cycle-classification`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applyHydrationScheduleSettings(data.data);
    setConsumerCycleStatus(
      data.data?.started
        ? 'Consumer-cycle classification refresh started.'
        : (data.data?.message || 'Consumer-cycle classification refresh already running.'),
      data.data?.started ? 'success' : 'muted'
    );
  } catch (err) {
    setConsumerCycleStatus(`Failed to start consumer-cycle classification refresh: ${err.message}`, 'error');
  }
}

function updateTempLabel() {
  const slider = document.getElementById('s-ai-temperature');
  const label  = document.getElementById('s-temp-value');
  if (slider && label) label.textContent = parseFloat(slider.value).toFixed(1);
}

function showTab(name) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  document.querySelectorAll('.settings-nav-item').forEach(b => {
    if (b.textContent.toLowerCase().includes(name)) b.classList.add('active');
  });
}

function toggleStopFields() {
  const type = document.getElementById('s-default-stop-type')?.value || 'atr_multiple';
  const valueField = document.getElementById('stop-value-field');
  const bufferField = document.getElementById('stop-buffer-field');
  const label = document.getElementById('stop-value-label');
  const hint = document.getElementById('stop-value-hint');

  if (type === 'atr_multiple') {
    if (valueField) valueField.style.display = '';
    if (bufferField) bufferField.style.display = 'none';
    if (label) label.textContent = 'ATR Multiplier';
    if (hint) hint.textContent = 'e.g., 2.0 = stop at 2x ATR below entry';
  } else if (type === 'fixed_pct') {
    if (valueField) valueField.style.display = '';
    if (bufferField) bufferField.style.display = 'none';
    if (label) label.textContent = 'Stop Percentage (%)';
    if (hint) hint.textContent = 'e.g., 8 = stop at 8% below entry';
  } else {
    if (valueField) valueField.style.display = 'none';
    if (bufferField) bufferField.style.display = '';
  }
}

window.showTab    = showTab;
window.saveSetting = saveSetting;
window.saveBackendAISettings = saveBackendAISettings;
window.testBackendAISettings = testBackendAISettings;
window.updateTempLabel = updateTempLabel;
window.toggleStopFields = toggleStopFields;
window.toggleHydrationScheduleFields = toggleHydrationScheduleFields;
window.loadHydrationScheduleSettings = loadHydrationScheduleSettings;
window.saveHydrationScheduleSettings = saveHydrationScheduleSettings;
window.runHydrationNow = runHydrationNow;
window.runConsumerCycleClassificationNow = runConsumerCycleClassificationNow;

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadBackendAISettings();
  loadHydrationScheduleSettings();
  toggleStopFields();
});
