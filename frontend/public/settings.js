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
let socialStatusPoll = null;
let miSchedulerSnapshot = null;

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

function setSocialStatus(text, tone) {
  const el = document.getElementById('s-social-intel-status');
  if (!el) return;
  el.textContent = text;
  if (tone === 'error') el.style.color = 'var(--color-danger)';
  else if (tone === 'success') el.style.color = 'var(--color-positive)';
  else el.style.color = 'var(--color-text-muted)';
}

function setSocialMeta(text) {
  const el = document.getElementById('s-social-intel-meta');
  if (!el) return;
  el.textContent = text || '';
}

function setSocialFinalizeStatus(text, tone) {
  const el = document.getElementById('s-social-intel-finalize-status');
  if (!el) return;
  el.textContent = text;
  if (tone === 'error') el.style.color = 'var(--color-danger)';
  else if (tone === 'success') el.style.color = 'var(--color-positive)';
  else el.style.color = 'var(--color-text-muted)';
}

function setSocialFinalizeMeta(text) {
  const el = document.getElementById('s-social-intel-finalize-meta');
  if (!el) return;
  el.textContent = text || '';
}

function timeAgo(isoOrMs) {
  if (!isoOrMs) return '';
  const ts = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  if (!Number.isFinite(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ' + (min % 60) + 'm ago';
  const days = Math.floor(hr / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return days + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function lastRunSummary(runtime, label) {
  if (!runtime) return '';
  if (runtime.running) return '';
  const fin = runtime.last_finished_at;
  if (!fin) return label ? label + ': never run' : 'Never run';
  const ago = timeAgo(fin);
  const ok = runtime.last_exit_code === 0 || runtime.last_exit_code === undefined || runtime.last_exit_code === null;
  const prefix = label ? label + ': ' : '';
  if (ok) return prefix + 'Last run ' + ago + ' — OK';
  return prefix + 'Last run ' + ago + ' — failed (exit ' + runtime.last_exit_code + ')';
}

function parseRuntimeJsonSummary(raw) {
  const text = String(raw || '').trim();
  if (!text || !text.startsWith('{')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatSocialCollectSummary(rawMessage) {
  const parsed = parseRuntimeJsonSummary(rawMessage);
  if (!parsed) return String(rawMessage || '').trim();
  const requested = Number(parsed.requested);
  const succeeded = Number(parsed.succeeded);
  const failed = Number(parsed.failed);
  const rawPosts = Number(parsed.total_raw_posts);
  const cleanPosts = Number(parsed.total_clean_posts);
  const sentimentRows = Number(parsed.total_sentiment_rows);
  const parts = [
    Number.isFinite(requested) ? `Processed ${requested} symbol${requested === 1 ? '' : 's'}` : null,
    Number.isFinite(succeeded) ? `${succeeded} succeeded` : null,
    Number.isFinite(failed) ? `${failed} failed` : null,
    Number.isFinite(rawPosts) ? `${rawPosts} raw posts` : null,
    Number.isFinite(cleanPosts) ? `${cleanPosts} cleaned posts` : null,
    Number.isFinite(sentimentRows) ? `${sentimentRows} sentiment rows` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

function formatSocialFinalizeSummary(rawMessage) {
  const parsed = parseRuntimeJsonSummary(rawMessage);
  if (!parsed) return String(rawMessage || '').trim();
  const tradeDates = Array.isArray(parsed.processed_trade_dates) ? parsed.processed_trade_dates.length : 0;
  const dailyRows = Number(parsed.daily_rows);
  const scoreRows = Number(parsed.score_rows);
  const parts = [
    tradeDates ? `Processed ${tradeDates} trade date${tradeDates === 1 ? '' : 's'}` : null,
    Number.isFinite(dailyRows) ? `${dailyRows} daily row${dailyRows === 1 ? '' : 's'}` : null,
    Number.isFinite(scoreRows) ? `${scoreRows} buzz score row${scoreRows === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.join(', ');
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
    's-ledger-hydration-refresh-yahoo-identity',
    's-ledger-hydration-refresh-consumer-cycle',
    's-ledger-hydration-refresh-social-intelligence',
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
    refresh_social_intelligence: !!document.getElementById('s-ledger-hydration-refresh-social-intelligence')?.checked,
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
  setValue('s-ledger-hydration-refresh-social-intelligence', config.refresh_social_intelligence !== false, true);

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

  if (runtime?.running) {
    setHydrationStatus(`Running now. ${runningProgressText || runtime.last_message || ''}`.trim(), 'success');
  } else {
    const lastRun = lastRunSummary(runtime);
    const statusParts = [lastRun || 'Never run', `Schedule: ${scheduleDescription}`].filter(Boolean);
    const tone = !runtime?.last_finished_at ? 'muted'
      : runtime?.last_exit_code === 0 || runtime?.last_exit_code == null ? 'muted'
      : 'error';
    setHydrationStatus(statusParts.join('. '), tone);
  }

  const metaBits = [];
  if (runtime?.last_finished_at) {
    metaBits.push(`Finished: ${new Date(runtime.last_finished_at).toLocaleString()}`);
  }
  if (runtime?.last_started_at) {
    const durationMs = runtime.last_finished_at
      ? new Date(runtime.last_finished_at).getTime() - new Date(runtime.last_started_at).getTime()
      : null;
    if (durationMs != null && Number.isFinite(durationMs) && durationMs > 0) {
      const durMin = Math.round(durationMs / 60000);
      metaBits.push(`Duration: ${durMin < 1 ? '<1' : durMin}m`);
    }
  }
  if (runtime?.last_source) metaBits.push(`Source: ${runtime.last_source}`);
  if (latestJob) {
    if (Number.isFinite(Number(latestJob.completed_count)) && Number.isFinite(Number(latestJob.candidate_count))) {
      metaBits.push(`Processed: ${latestJob.completed_count}/${latestJob.candidate_count}`);
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
  setHydrationMeta(metaBits.join(' · '));

  if (consumerRuntime?.running) {
    setConsumerCycleStatus(`Running now. ${consumerRuntime.last_message || 'Refreshing consumer-cycle classifications...'}`.trim(), 'success');
  } else {
    const consumerLastRun = lastRunSummary(consumerRuntime);
    const consumerTone = !consumerRuntime?.last_finished_at ? 'muted'
      : consumerRuntime?.last_exit_code === 0 || consumerRuntime?.last_exit_code == null ? 'muted'
      : 'error';
    setConsumerCycleStatus(consumerLastRun || 'Never run', consumerTone);
  }
  const consumerMetaBits = [];
  if (consumerRuntime?.last_finished_at) {
    consumerMetaBits.push(`Finished: ${new Date(consumerRuntime.last_finished_at).toLocaleString()}`);
  }
  if (consumerRuntime?.last_started_at && consumerRuntime?.last_finished_at) {
    const dur = new Date(consumerRuntime.last_finished_at).getTime() - new Date(consumerRuntime.last_started_at).getTime();
    if (Number.isFinite(dur) && dur > 0) {
      const durMin = Math.round(dur / 60000);
      consumerMetaBits.push(`Duration: ${durMin < 1 ? '<1' : durMin}m`);
    }
  }
  if (consumerRuntime?.last_source) consumerMetaBits.push(`Source: ${consumerRuntime.last_source}`);
  if (consumerRuntime?.last_error) consumerMetaBits.push(`Error: ${consumerRuntime.last_error}`);
  setConsumerCycleMeta(consumerMetaBits.join(' · '));
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

async function runValuationRefreshNow() {
  setHydrationStatus('Starting valuation refresh...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ledger-hydration/run-valuations`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applyHydrationScheduleSettings(data.data);
    setHydrationStatus(data.data?.started ? 'Valuation refresh started.' : (data.data?.message || 'Valuation refresh already running.'), data.data?.started ? 'success' : 'muted');
  } catch (err) {
    setHydrationStatus(`Failed to start valuation refresh: ${err.message}`, 'error');
  }
}

async function runYahooIdentityRefreshNow() {
  setHydrationStatus('Starting Yahoo identity refresh...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/ledger-hydration/run-yahoo-identity`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applyHydrationScheduleSettings(data.data);
    setHydrationStatus(data.data?.started ? 'Yahoo identity refresh started.' : (data.data?.message || 'Yahoo identity refresh already running.'), data.data?.started ? 'success' : 'muted');
  } catch (err) {
    setHydrationStatus(`Failed to start Yahoo identity refresh: ${err.message}`, 'error');
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

function toggleSocialScheduleFields() {
  const enabled = !!document.getElementById('s-social-intel-enabled')?.checked;
  const frequency = document.getElementById('s-social-intel-frequency')?.value || 'manual';
  const finalizeEnabled = !!document.getElementById('s-social-intel-finalize-enabled')?.checked;
  [
    's-social-intel-frequency',
    's-social-intel-timezone',
    's-social-intel-limit',
    's-social-intel-sleep-ms',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !enabled || frequency === 'manual' ? (id !== 's-social-intel-frequency') : false;
    if (id === 's-social-intel-frequency') {
      el.disabled = !enabled;
    }
  });
  ['s-social-intel-finalize-time', 's-social-intel-finalize-timezone'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !enabled || !finalizeEnabled;
  });
}

function collectSocialScheduleSettings() {
  return {
    enabled: !!document.getElementById('s-social-intel-enabled')?.checked,
    intraday_frequency: document.getElementById('s-social-intel-frequency')?.value || 'manual',
    intraday_timezone: (document.getElementById('s-social-intel-timezone')?.value || 'America/Los_Angeles').trim(),
    intraday_limit: Number(document.getElementById('s-social-intel-limit')?.value || 0),
    intraday_sleep_ms: Number(document.getElementById('s-social-intel-sleep-ms')?.value || 350),
    finalize_enabled: !!document.getElementById('s-social-intel-finalize-enabled')?.checked,
    finalize_time_of_day: document.getElementById('s-social-intel-finalize-time')?.value || '16:30',
    finalize_timezone: (document.getElementById('s-social-intel-finalize-timezone')?.value || 'America/Los_Angeles').trim(),
    reddit_enabled: !!document.getElementById('s-reddit-enabled')?.checked,
    reddit_frequency: document.getElementById('s-reddit-frequency')?.value || 'manual',
    reddit_subreddits: (document.getElementById('s-reddit-subreddits')?.value || 'wallstreetbets,stocks,investing').trim(),
  };
}

function setRedditStatus(text, tone) {
  const el = document.getElementById('s-reddit-status');
  if (!el) return;
  el.textContent = text;
  if (tone === 'error') el.style.color = 'var(--color-danger)';
  else if (tone === 'success') el.style.color = 'var(--color-positive)';
  else el.style.color = 'var(--color-text-muted)';
}

function setRedditMeta(text) {
  const el = document.getElementById('s-reddit-meta');
  if (!el) return;
  el.textContent = text || '';
}

function toggleRedditFields() {
  // no dependent fields to toggle currently
}

function applySocialScheduleSettings(data) {
  const config = data?.config || {};
  const collectRuntime = data?.collect_runtime || {};
  const finalizeRuntime = data?.finalize_runtime || {};
  const redditRuntime = data?.reddit_runtime || {};
  const setValue = (id, value, isCheckbox = false) => {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    if (isCheckbox) el.checked = !!value;
    else el.value = String(value);
  };

  setValue('s-social-intel-enabled', config.enabled, true);
  setValue('s-social-intel-frequency', config.intraday_frequency || 'manual');
  setValue('s-social-intel-timezone', config.intraday_timezone || 'America/Los_Angeles');
  setValue('s-social-intel-limit', config.intraday_limit ?? 0);
  setValue('s-social-intel-sleep-ms', config.intraday_sleep_ms ?? 350);
  setValue('s-social-intel-finalize-enabled', config.finalize_enabled !== false, true);
  setValue('s-social-intel-finalize-time', config.finalize_time_of_day || '16:30');
  setValue('s-social-intel-finalize-timezone', config.finalize_timezone || 'America/Los_Angeles');

  const scheduleDescription = data?.schedule_description || 'Manual only';
  const collectSummary = formatSocialCollectSummary(collectRuntime?.last_message);

  if (collectRuntime?.running) {
    setSocialStatus(`Running now. ${collectSummary || ''}`.trim(), 'success');
  } else {
    const collectLastRun = lastRunSummary(collectRuntime);
    const collectParts = [collectLastRun || 'Never run'];
    if (collectSummary) collectParts.push(collectSummary);
    collectParts.push(`Schedule: ${scheduleDescription}`);
    const collectTone = !collectRuntime?.last_finished_at ? 'muted'
      : collectRuntime?.last_exit_code === 0 || collectRuntime?.last_exit_code == null ? 'muted'
      : 'error';
    setSocialStatus(collectParts.join('. '), collectTone);
  }
  const collectMetaBits = [];
  if (collectRuntime?.last_finished_at) collectMetaBits.push(`Finished: ${new Date(collectRuntime.last_finished_at).toLocaleString()}`);
  if (collectRuntime?.last_started_at && collectRuntime?.last_finished_at) {
    const dur = new Date(collectRuntime.last_finished_at).getTime() - new Date(collectRuntime.last_started_at).getTime();
    if (Number.isFinite(dur) && dur > 0) { const m = Math.round(dur / 60000); collectMetaBits.push(`Duration: ${m < 1 ? '<1' : m}m`); }
  }
  if (collectRuntime?.last_source) collectMetaBits.push(`Source: ${collectRuntime.last_source}`);
  if (collectRuntime?.last_error) collectMetaBits.push(`Error: ${collectRuntime.last_error}`);
  setSocialMeta(collectMetaBits.join(' · '));

  const finalizeSummary = formatSocialFinalizeSummary(finalizeRuntime?.last_message);

  if (finalizeRuntime?.running) {
    setSocialFinalizeStatus(`Running now. ${finalizeSummary || ''}`.trim(), 'success');
  } else {
    const finalizeLastRun = lastRunSummary(finalizeRuntime);
    const finalizeParts = [finalizeLastRun || 'Never run'];
    if (finalizeSummary) finalizeParts.push(finalizeSummary);
    const finalizeTone = !finalizeRuntime?.last_finished_at ? 'muted'
      : finalizeRuntime?.last_exit_code === 0 || finalizeRuntime?.last_exit_code == null ? 'muted'
      : 'error';
    setSocialFinalizeStatus(finalizeParts.join('. '), finalizeTone);
  }
  const finalizeMetaBits = [];
  if (finalizeRuntime?.last_finished_at) finalizeMetaBits.push(`Finished: ${new Date(finalizeRuntime.last_finished_at).toLocaleString()}`);
  if (finalizeRuntime?.last_started_at && finalizeRuntime?.last_finished_at) {
    const dur = new Date(finalizeRuntime.last_finished_at).getTime() - new Date(finalizeRuntime.last_started_at).getTime();
    if (Number.isFinite(dur) && dur > 0) { const m = Math.round(dur / 60000); finalizeMetaBits.push(`Duration: ${m < 1 ? '<1' : m}m`); }
  }
  if (finalizeRuntime?.last_source) finalizeMetaBits.push(`Source: ${finalizeRuntime.last_source}`);
  if (finalizeRuntime?.last_error) finalizeMetaBits.push(`Error: ${finalizeRuntime.last_error}`);
  setSocialFinalizeMeta(finalizeMetaBits.join(' · '));

  setValue('s-reddit-enabled', config.reddit_enabled, true);
  setValue('s-reddit-frequency', config.reddit_frequency || 'manual');
  setValue('s-reddit-subreddits', config.reddit_subreddits || 'wallstreetbets,stocks,investing');

  if (redditRuntime?.running) {
    setRedditStatus(`Running now. ${redditRuntime.last_message || ''}`.trim(), 'success');
  } else {
    const redditLastRun = lastRunSummary(redditRuntime);
    const subs = (config.reddit_subreddits || '').split(',').filter(Boolean).length || 0;
    const redditTone = !redditRuntime?.last_finished_at ? 'muted'
      : redditRuntime?.last_exit_code === 0 || redditRuntime?.last_exit_code == null ? 'muted'
      : 'error';
    setRedditStatus((redditLastRun || 'Never run') + (subs ? ` · ${subs} subreddits` : ''), redditTone);
  }
  const redditMetaBits = [];
  if (redditRuntime?.last_finished_at) redditMetaBits.push(`Finished: ${new Date(redditRuntime.last_finished_at).toLocaleString()}`);
  if (redditRuntime?.last_started_at && redditRuntime?.last_finished_at) {
    const dur = new Date(redditRuntime.last_finished_at).getTime() - new Date(redditRuntime.last_started_at).getTime();
    if (Number.isFinite(dur) && dur > 0) { const m = Math.round(dur / 60000); redditMetaBits.push(`Duration: ${m < 1 ? '<1' : m}m`); }
  }
  if (redditRuntime?.last_source) redditMetaBits.push(`Source: ${redditRuntime.last_source}`);
  if (redditRuntime?.last_error) redditMetaBits.push(`Error: ${redditRuntime.last_error}`);
  setRedditMeta(redditMetaBits.join(' · '));

  toggleSocialScheduleFields();
  toggleRedditFields();

  if (socialStatusPoll) {
    clearInterval(socialStatusPoll);
    socialStatusPoll = null;
  }
  if (collectRuntime?.running || finalizeRuntime?.running || redditRuntime?.running) {
    socialStatusPoll = setInterval(() => loadSocialScheduleSettings(true), 10000);
  }
}

async function loadSocialScheduleSettings(silent) {
  if (!silent) setSocialStatus('Loading social-intelligence settings...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/social-intelligence/settings`);
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applySocialScheduleSettings(data.data);
  } catch (err) {
    setSocialStatus(`Failed to load social schedule: ${err.message}`, 'error');
  }
}

async function saveSocialScheduleSettings() {
  setSocialStatus('Saving social schedule...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/social-intelligence/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectSocialScheduleSettings()),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applySocialScheduleSettings(data.data);
    setSocialStatus('Social schedule saved.', 'success');
  } catch (err) {
    setSocialStatus(`Failed to save social schedule: ${err.message}`, 'error');
  }
}

async function runSocialCollectNow() {
  setSocialStatus('Starting social collection...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/social-intelligence/run-collect`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applySocialScheduleSettings(data.data);
    setSocialStatus(data.data?.started ? 'Social collection started.' : (data.data?.message || 'Social collection already running.'), data.data?.started ? 'success' : 'muted');
  } catch (err) {
    setSocialStatus(`Failed to start social collection: ${err.message}`, 'error');
  }
}

async function runSocialFinalizeNow() {
  setSocialFinalizeStatus('Starting social finalizer...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/social-intelligence/run-finalize`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applySocialScheduleSettings(data.data);
    setSocialFinalizeStatus(data.data?.started ? 'Social finalizer started.' : (data.data?.message || 'Social finalizer already running.'), data.data?.started ? 'success' : 'muted');
  } catch (err) {
    setSocialFinalizeStatus(`Failed to start social finalizer: ${err.message}`, 'error');
  }
}

async function runRedditCollectNow() {
  setRedditStatus('Starting Reddit collection...', 'muted');
  try {
    const res = await fetch(`${API_URL}/api/social-intelligence/run-reddit`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    applySocialScheduleSettings(data.data);
    setRedditStatus(data.data?.started ? 'Reddit collection started.' : (data.data?.message || 'Reddit collection already running.'), data.data?.started ? 'success' : 'muted');
  } catch (err) {
    setRedditStatus(`Failed to start Reddit collection: ${err.message}`, 'error');
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

// ---------- Market Intelligence scheduler ----------
const MI_API = '/api/market-intelligence';

function loadMiSchedulerStatus() {
  fetch(MI_API + '/scheduler/status')
    .then(r => r.json())
    .then(d => {
      if (!d.success) throw new Error(d.error);
      renderMiScheduler(d.data);
    })
    .catch(e => {
      document.getElementById('s-mi-jobs-list').textContent = 'Error: ' + e.message;
    });
}

function renderMiScheduler(data) {
  miSchedulerSnapshot = data || null;
  const masterEl = document.getElementById('s-mi-master-switch');
  if (masterEl && data.config) masterEl.checked = !!data.config.enabled;

  const jobsEl = document.getElementById('s-mi-jobs-list');
  const rawJobs = data.jobs || [];
  if (rawJobs.length === 0) { jobsEl.textContent = 'No jobs registered.'; return; }

  const tbl = document.createElement('table');
  tbl.className = 'mi-jobs-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['name', 'kind', 'cron', 'enabled', 'status', 'actions'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  rawJobs.forEach(j => {
    const def = j.definition || {};
    const cfg = j.config || {};
    const rt  = j.runtime || {};
    const name = def.name || 'unknown';
    const kind = def.kind || 'engine';
    const enabled = cfg.enabled !== false;
    const cronExpr = j.effective_cron_expression || def.defaultCronExpression || '-';

    const tr = document.createElement('tr');
    tr.title = def.description || '';

    const tdName = document.createElement('td');
    tdName.textContent = name;
    tdName.style.fontWeight = '600';
    tr.appendChild(tdName);

    const tdKind = document.createElement('td');
    const kindSpan = document.createElement('span');
    kindSpan.className = 'mi-job-kind ' + kind;
    kindSpan.textContent = kind;
    tdKind.appendChild(kindSpan);
    tr.appendChild(tdKind);

    const tdCron = document.createElement('td');
    tdCron.textContent = cronExpr;
    tr.appendChild(tdCron);

    const tdEn = document.createElement('td');
    tdEn.className = enabled ? 'mi-job-enabled' : 'mi-job-disabled';
    tdEn.textContent = enabled ? 'ON' : 'OFF';
    tr.appendChild(tdEn);

    const tdStatus = document.createElement('td');
    if (rt.running) {
      tdStatus.textContent = 'running';
      tdStatus.style.color = 'var(--color-accent)';
    } else if (rt.last_finished_at) {
      const ago = timeAgo(rt.last_finished_at);
      const ok = rt.last_exit_code === 0;
      tdStatus.textContent = (ok ? 'OK' : 'FAIL') + ' · ' + ago;
      tdStatus.title = new Date(rt.last_finished_at).toLocaleString() + (rt.last_error ? ' | ' + rt.last_error : '');
      tdStatus.style.color = ok ? 'var(--color-positive)' : 'var(--color-negative)';
    } else {
      tdStatus.textContent = 'never run';
      tdStatus.style.color = 'var(--color-text-subtle)';
    }
    tr.appendChild(tdStatus);

    const tdAct = document.createElement('td');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.textContent = enabled ? 'Disable' : 'Enable';
    toggleBtn.style.fontSize = '10px';
    toggleBtn.style.padding = '2px 8px';
    toggleBtn.addEventListener('click', () => {
      const endpoint = enabled
        ? '/scheduler/jobs/' + name + '/disable'
        : '/scheduler/jobs/' + name + '/enable';
      fetch(MI_API + endpoint, { method: 'POST' })
        .then(() => loadMiSchedulerStatus())
        .catch(e => alert(e.message));
    });
    tdAct.appendChild(toggleBtn);

    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-ghost btn-sm';
    runBtn.textContent = 'Run';
    runBtn.style.fontSize = '10px';
    runBtn.style.padding = '2px 8px';
    runBtn.style.marginLeft = '4px';
    runBtn.addEventListener('click', () => {
      fetch(MI_API + '/scheduler/jobs/' + name + '/run', { method: 'POST' })
        .then(r => r.json())
        .then(d => {
          if (d.success) { alert(name + ' started'); loadMiSchedulerStatus(); }
          else alert('Error: ' + (d.error || 'unknown'));
        })
        .catch(e => alert(e.message));
    });
    tdAct.appendChild(runBtn);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  jobsEl.innerHTML = '';
  jobsEl.appendChild(tbl);

  // Activity summary
  const activityEl = document.getElementById('s-mi-activity-summary');
  const allFinished = rawJobs
    .map(j => (j.runtime || {}).last_finished_at)
    .filter(Boolean)
    .map(t => new Date(t).getTime())
    .filter(Number.isFinite);
  const runningCount = rawJobs.filter(j => (j.runtime || {}).running).length;
  const failedRecently = rawJobs.filter(j => {
    const rt = j.runtime || {};
    return rt.last_finished_at && rt.last_exit_code !== 0 && rt.last_exit_code != null;
  }).length;
  const neverRun = rawJobs.filter(j => !(j.runtime || {}).last_finished_at).length;
  const enabledCount = rawJobs.filter(j => (j.config || {}).enabled !== false).length;

  if (allFinished.length === 0 && runningCount === 0) {
    activityEl.textContent = 'No jobs have run yet.';
    activityEl.style.color = 'var(--color-text-subtle)';
  } else {
    const mostRecent = Math.max(...allFinished);
    const parts = [];
    if (runningCount > 0) {
      parts.push(runningCount + ' job' + (runningCount > 1 ? 's' : '') + ' running now');
    }
    parts.push('Last activity: ' + timeAgo(mostRecent));
    if (failedRecently > 0) {
      parts.push(failedRecently + ' failed');
    }
    if (neverRun > 0) {
      parts.push(neverRun + ' never run');
    }
    activityEl.textContent = parts.join(' · ');
    activityEl.style.color = failedRecently > 0 ? 'var(--color-danger)' : runningCount > 0 ? 'var(--color-positive)' : 'var(--color-text-muted)';
  }

  // Pipeline stats
  const statsEl = document.getElementById('s-mi-pipeline-stats');
  const collectors = rawJobs.filter(j => (j.definition || {}).kind === 'collector').length;
  const engines = rawJobs.filter(j => (j.definition || {}).kind === 'engine').length;
  const rollups = rawJobs.filter(j => (j.definition || {}).kind === 'rollup').length;
  const running2 = rawJobs.filter(j => (j.runtime || {}).running).length;
  const stats = [
    ['Total jobs', rawJobs.length],
    ['Collectors / Engines / Rollups', collectors + ' / ' + engines + ' / ' + rollups],
    ['Enabled', enabledCount + ' of ' + rawJobs.length],
    ['Currently running', running2],
    ['Master switch', data.config && data.config.enabled ? 'ON' : 'OFF'],
  ];
  statsEl.innerHTML = '';
  stats.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'mi-stat-row';
    const key = document.createElement('span');
    key.className = 'mi-stat-key';
    key.textContent = k;
    row.appendChild(key);
    const val = document.createElement('span');
    val.className = 'mi-stat-val';
    val.textContent = String(v);
    row.appendChild(val);
    statsEl.appendChild(row);
  });

  renderOptionsFlowSchedulerStatus();
}

function saveMiSchedulerMaster() {
  const enabled = document.getElementById('s-mi-master-switch').checked;
  const endpoint = enabled ? MI_API + '/scheduler/start' : MI_API + '/scheduler/stop';
  fetch(endpoint, { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (!d.success) throw new Error(d.error);
      loadMiSchedulerStatus();
    })
    .catch(e => alert(e.message));
}

async function enableAllMiJobs() {
  try {
    const statusRes = await fetch(MI_API + '/scheduler/status');
    const statusData = await statusRes.json();
    if (!statusData.success) throw new Error(statusData.error);

    const jobs = {};
    for (const j of statusData.data.jobs) {
      jobs[j.definition.name] = { enabled: true };
    }

    const configRes = await fetch(MI_API + '/scheduler/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, jobs }),
    });
    const configData = await configRes.json();
    if (!configData.success) throw new Error(configData.error);

    document.getElementById('s-mi-master-switch').checked = true;
    loadMiSchedulerStatus();
  } catch (e) {
    alert('Failed to enable all jobs: ' + e.message);
  }
}

window.loadMiSchedulerStatus = loadMiSchedulerStatus;
window.saveMiSchedulerMaster = saveMiSchedulerMaster;
window.enableAllMiJobs = enableAllMiJobs;

// --- DCF Calibration Engine ---

function loadCalibrationStatus() {
  const predsEl = document.getElementById('s-calibration-predictions');
  const errsEl = document.getElementById('s-calibration-errors');
  const adjsEl = document.getElementById('s-calibration-adjustments');
  const statusEl = document.getElementById('s-calibration-status');
  const biasContainer = document.getElementById('s-calibration-bias-table-container');
  const biasTable = document.getElementById('s-calibration-bias-table');

  statusEl.textContent = 'Loading...';
  statusEl.style.color = 'var(--color-text-muted)';

  fetch(API_URL + '/api/calibration/summary')
    .then(r => r.json())
    .then(d => {
      if (!d.success) throw new Error(d.error);
      const { counts, timestamps, adjustments, bias_summary } = d.data;
      const ts = timestamps || {};

      predsEl.textContent = (counts.predictions || 0).toLocaleString();
      errsEl.textContent = (counts.calibration_errors || 0).toLocaleString();
      adjsEl.textContent = (counts.calibration_adjustments || 0).toLocaleString();

      const statusParts = [];
      if (counts.predictions === 0) {
        statusParts.push('Awaiting first valuation refresh — no predictions logged yet');
        statusEl.style.color = 'var(--color-text-subtle)';
      } else if (counts.calibration_errors === 0) {
        statusParts.push('Predictions logged. Waiting for earnings actuals (~1 quarter)');
        if (ts.latest_prediction_at) statusParts.push('Last prediction: ' + timeAgo(ts.latest_prediction_at));
        statusEl.style.color = 'var(--color-accent)';
      } else if (counts.calibration_adjustments === 0) {
        statusParts.push(counts.calibration_errors + ' error(s) computed. Run calibration to derive bias adjustments');
        statusEl.style.color = 'var(--color-accent)';
      } else {
        statusParts.push('Active — ' + counts.calibration_adjustments + ' bias correction(s) applied to future DCFs');
        if (ts.latest_adjustment_at) statusParts.push('Last calibrated: ' + timeAgo(ts.latest_adjustment_at));
        if (ts.latest_prediction_at) statusParts.push('Last prediction: ' + timeAgo(ts.latest_prediction_at));
        statusEl.style.color = 'var(--color-positive)';
      }
      statusEl.textContent = statusParts.join('. ') + '.';

      if (adjustments && adjustments.length > 0) {
        biasContainer.style.display = '';
        const grouped = {};
        adjustments.forEach(a => {
          const key = a.scope_type + ':' + a.scope_value;
          if (!grouped[key]) grouped[key] = { scope_type: a.scope_type, scope_value: a.scope_value };
          if (a.assumption_key === 'revenue_growth_pct') {
            grouped[key].rev = a.adjustment_pct;
            grouped[key].revN = a.sample_size;
          } else if (a.assumption_key === 'fcf_margin_pct') {
            grouped[key].fcf = a.adjustment_pct;
            grouped[key].fcfN = a.sample_size;
          }
        });
        const entries = Object.values(grouped).slice(0, 8);
        const rows = entries.map(g => {
          const scope = g.scope_type + ': ' + g.scope_value;
          const fmt = (v) => v != null ? (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%' : '—';
          const n = g.revN || g.fcfN || '?';
          return '<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--color-border-subtle,rgba(255,255,255,0.06));">'
            + '<span style="color:var(--color-text-subtle)">' + scope + '</span>'
            + '<span>Rev ' + fmt(g.rev) + ' &nbsp; FCF ' + fmt(g.fcf) + ' &nbsp; (n=' + n + ')</span>'
            + '</div>';
        });
        biasTable.innerHTML = rows.join('');
      } else {
        biasContainer.style.display = 'none';
      }
    })
    .catch(e => {
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.style.color = 'var(--color-danger)';
    });
}

function runCalibrationNow() {
  const statusEl = document.getElementById('s-calibration-status');
  statusEl.textContent = 'Running calibration job...';
  statusEl.style.color = 'var(--color-accent)';

  fetch(API_URL + '/api/ledger-hydration/calibration/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ min_age_days: 90, min_sample_size: 5 }),
  })
    .then(r => r.json())
    .then(d => {
      if (!d.success) throw new Error(d.error || 'Calibration failed');
      const rpt = d.report || {};
      statusEl.textContent = 'Calibration complete — '
        + (rpt.predictions_evaluated || 0) + ' predictions evaluated, '
        + (rpt.errors_logged || 0) + ' errors logged, '
        + (rpt.adjustments_written || 0) + ' adjustments written.';
      statusEl.style.color = 'var(--color-positive)';
      loadCalibrationStatus();
    })
    .catch(e => {
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.style.color = 'var(--color-danger)';
    });
}

window.loadCalibrationStatus = loadCalibrationStatus;
window.runCalibrationNow = runCalibrationNow;

// ---------------------------------------------------------------------------
// SEC EDGAR Filings
// ---------------------------------------------------------------------------

function setEdgarStatus(text, tone) {
  const el = document.getElementById('s-edgar-status');
  if (!el) return;
  el.textContent = text;
  if (tone === 'error') el.style.color = 'var(--color-danger)';
  else if (tone === 'success') el.style.color = 'var(--color-positive)';
  else el.style.color = 'var(--color-text-muted)';
}

function setEdgarMeta(text) {
  const el = document.getElementById('s-edgar-meta');
  if (!el) return;
  el.textContent = text || '';
}

function toggleEdgarFields() {
  const freq = document.getElementById('s-edgar-frequency');
  const timeField = document.getElementById('edgar-time-field');
  if (freq && timeField) {
    timeField.style.display = freq.value === 'daily' ? '' : 'none';
  }
}

async function loadEdgarSettings() {
  setEdgarStatus('Loading EDGAR status...', 'muted');
  try {
    const res = await fetch(API_URL + '/api/edgar-filings/settings');
    const data = await res.json();
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed');

    const cfg = data.data?.config || {};
    const rt = data.data?.collect_runtime || {};
    const desc = data.data?.schedule_description || '';

    const enabledEl = document.getElementById('s-edgar-enabled');
    const freqEl = document.getElementById('s-edgar-frequency');
    const lookbackEl = document.getElementById('s-edgar-lookback');
    const timeEl = document.getElementById('s-edgar-time');
    const tzEl = document.getElementById('s-edgar-timezone');

    if (enabledEl) enabledEl.checked = cfg.enabled || false;
    if (freqEl) freqEl.value = cfg.frequency || 'manual';
    if (lookbackEl) lookbackEl.value = cfg.lookback_hours || 48;
    if (timeEl) timeEl.value = cfg.time_of_day || '18:00';
    if (tzEl) tzEl.value = cfg.timezone || 'America/New_York';

    toggleEdgarFields();

    if (rt.running) {
      setEdgarStatus('Running...', 'success');
      setEdgarMeta(rt.last_message || '');
    } else {
      const summary = lastRunSummary(rt, 'EDGAR');
      setEdgarStatus(summary || ('Schedule: ' + desc), summary ? 'muted' : 'muted');

      const rawMsg = rt.last_message || '';
      const parsed = parseRuntimeJsonSummary(rawMsg);
      if (parsed) {
        const parts = [];
        if (parsed.filings_found != null) parts.push(parsed.filings_found + ' filings found');
        if (parsed.filings_in_universe != null) parts.push(parsed.filings_in_universe + ' in universe');
        if (parsed.transactions_inserted != null) parts.push(parsed.transactions_inserted + ' transactions');
        if (parsed.alerts_generated != null) parts.push(parsed.alerts_generated + ' alerts');
        setEdgarMeta(parts.join(', '));
      } else {
        setEdgarMeta(rawMsg);
      }
    }
  } catch (e) {
    setEdgarStatus('Failed to load: ' + e.message, 'error');
  }
}

async function saveEdgarSettings() {
  setEdgarStatus('Saving EDGAR schedule...', 'muted');
  try {
    const payload = {
      enabled: document.getElementById('s-edgar-enabled')?.checked || false,
      frequency: document.getElementById('s-edgar-frequency')?.value || 'manual',
      lookback_hours: parseInt(document.getElementById('s-edgar-lookback')?.value) || 48,
      time_of_day: document.getElementById('s-edgar-time')?.value || '18:00',
      timezone: document.getElementById('s-edgar-timezone')?.value || 'America/New_York',
    };
    const res = await fetch(API_URL + '/api/edgar-filings/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Save failed');
    setEdgarStatus('EDGAR schedule saved.', 'success');
    setTimeout(loadEdgarSettings, 1000);
  } catch (e) {
    setEdgarStatus('Save failed: ' + e.message, 'error');
  }
}

async function runEdgarCollectNow() {
  setEdgarStatus('Starting EDGAR collection...', 'muted');
  try {
    const res = await fetch(API_URL + '/api/edgar-filings/run-collect', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed');
    setEdgarStatus('EDGAR collection started.', 'success');
    setEdgarMeta(data.data?.message || '');
    if (!edgarStatusPoll) {
      edgarStatusPoll = setInterval(async () => {
        try {
          const r = await fetch(API_URL + '/api/edgar-filings/settings');
          const d = await r.json();
          const rt = d?.data?.collect_runtime;
          if (!rt?.running) {
            clearInterval(edgarStatusPoll);
            edgarStatusPoll = null;
            loadEdgarSettings();
          } else {
            setEdgarStatus('Running...', 'success');
            setEdgarMeta(rt.last_message || '');
          }
        } catch { /* ignore poll errors */ }
      }, 3000);
    }
  } catch (e) {
    setEdgarStatus('Failed: ' + e.message, 'error');
  }
}

let edgarStatusPoll = null;

window.toggleEdgarFields = toggleEdgarFields;
window.loadEdgarSettings = loadEdgarSettings;
window.saveEdgarSettings = saveEdgarSettings;
window.runEdgarCollectNow = runEdgarCollectNow;

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
window.runValuationRefreshNow = runValuationRefreshNow;
window.runYahooIdentityRefreshNow = runYahooIdentityRefreshNow;
window.runConsumerCycleClassificationNow = runConsumerCycleClassificationNow;
window.toggleSocialScheduleFields = toggleSocialScheduleFields;
window.loadSocialScheduleSettings = loadSocialScheduleSettings;
window.saveSocialScheduleSettings = saveSocialScheduleSettings;
window.runSocialCollectNow = runSocialCollectNow;
window.runSocialFinalizeNow = runSocialFinalizeNow;
window.runRedditCollectNow = runRedditCollectNow;
window.toggleRedditFields = toggleRedditFields;
window.run13fCollectNow = run13fCollectNow;
window.load13fStatus = load13fStatus;

async function load13fStatus() {
  const el = document.getElementById('s-13f-status');
  if (!el) return;
  try {
    const res = await fetch(`${API_URL}/api/edgar-filings/13f-status`);
    const json = await res.json();
    if (json?.success && json.data) {
      const d = json.data;
      if (d.running) {
        el.textContent = d.last_message || 'Collecting 13F holdings...';
        el.style.color = '#facc15';
      } else if (d.last_finished_at) {
        el.textContent = `Last collected: ${new Date(d.last_finished_at).toLocaleString()}`;
        el.style.color = '#4ade80';
      } else {
        el.textContent = 'Not yet collected. Click "Collect 13F Holdings" to fetch latest quarterly data.';
        el.style.color = '';
      }
    }
  } catch {
    if (el) el.textContent = 'Could not load 13F status.';
  }
}

async function run13fCollectNow() {
  const el = document.getElementById('s-13f-status');
  if (el) { el.textContent = 'Starting 13F collection...'; el.style.color = '#facc15'; }
  try {
    const res = await fetch(`${API_URL}/api/edgar-filings/run-collect-13f`, { method: 'POST' });
    const json = await res.json();
    if (json?.success && json.data?.started) {
      if (el) el.textContent = json.data.message || 'Collection started...';
      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`${API_URL}/api/edgar-filings/13f-status`);
          const sj = await sr.json();
          if (sj?.data && !sj.data.running) {
            clearInterval(poll);
            if (el) { el.textContent = `Done: ${sj.data.last_message || 'Collection complete.'}`; el.style.color = '#4ade80'; }
          } else if (sj?.data?.last_message && el) {
            el.textContent = sj.data.last_message;
          }
        } catch { /* ignore polling errors */ }
      }, 3000);
    } else {
      if (el) el.textContent = json?.data?.message || 'Already running.';
    }
  } catch (err) {
    if (el) { el.textContent = 'Failed to start 13F collection.'; el.style.color = '#f87171'; }
  }
}

async function loadOptionsFlowStatus() {
  const el = document.getElementById('s-options-flow-status');
  if (!el) return;
  try {
    const res = await fetch(`${API_URL}/api/options-flow/status`);
    const json = await res.json();
    if (!json.success) { el.textContent = 'Failed to load status.'; return; }
    const d = json.data;
    if (d.running) {
      el.textContent = d.last_message || 'Collection running...';
      el.style.color = '#f59e0b';
    } else if (d.last_finished_at) {
      el.textContent = `Last run: ${new Date(d.last_finished_at).toLocaleString()}${d.last_message ? ' — ' + d.last_message : ''}`;
      el.style.color = '#4ade80';
    } else {
      el.textContent = 'No collection runs yet.';
      el.style.color = '';
    }
  } catch {
    el.textContent = 'Failed to connect.';
    el.style.color = '#f87171';
  }
}
window.loadOptionsFlowStatus = loadOptionsFlowStatus;

async function runOptionsFlowCollect() {
  const el = document.getElementById('s-options-flow-status');
  if (el) { el.textContent = 'Starting options flow collection...'; el.style.color = '#f59e0b'; }
  try {
    const res = await fetch(`${API_URL}/api/options-flow/run-collect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ top: 100 }),
    });
    const json = await res.json();
    if (json?.data?.started) {
      if (el) el.textContent = 'Collection started... polling for updates.';
      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`${API_URL}/api/options-flow/status`);
          const sj = await sr.json();
          if (sj?.data && !sj.data.running) {
            clearInterval(poll);
            if (el) { el.textContent = `Done: ${sj.data.last_message || 'Collection complete.'}`; el.style.color = '#4ade80'; }
          } else if (sj?.data?.last_message && el) {
            el.textContent = sj.data.last_message;
          }
        } catch { /* ignore */ }
      }, 5000);
    } else {
      if (el) el.textContent = json?.data?.message || 'Already running.';
    }
  } catch (err) {
    if (el) { el.textContent = 'Failed to start collection.'; el.style.color = '#f87171'; }
  }
}
window.runOptionsFlowCollect = runOptionsFlowCollect;

function findMiSchedulerJob(name) {
  return (miSchedulerSnapshot?.jobs || []).find(j => (j.definition || {}).name === name) || null;
}

function renderOptionsFlowSchedulerStatus() {
  const el = document.getElementById('s-options-flow-scheduler-status');
  if (!el) return;
  if (!miSchedulerSnapshot) {
    el.textContent = 'Scheduler status has not loaded yet.';
    el.style.color = 'var(--color-text-muted)';
    return;
  }

  const collector = findMiSchedulerJob('options_flow_collector');
  const optionability = findMiSchedulerJob('options_optionability_refresh');
  const parts = [];
  [collector, optionability].forEach(job => {
    if (!job) return;
    const def = job.definition || {};
    const rt = job.runtime || {};
    const cfg = job.config || {};
    const schedulerOn = miSchedulerSnapshot?.config?.enabled !== false;
    const enabled = schedulerOn && cfg.enabled !== false;
    const status = rt.running
      ? 'running now'
      : rt.last_finished_at
        ? `${rt.last_exit_code === 0 ? 'OK' : 'failed'} ${timeAgo(rt.last_finished_at)}`
        : 'never run';
    parts.push(`${def.name}: ${enabled ? 'ON' : 'OFF'}, ${status}, cron ${job.effective_cron_expression || def.defaultCronExpression || '-'}`);
  });

  if (!collector) parts.push('options_flow_collector is not registered in the running backend.');
  if (!optionability) parts.push('options_optionability_refresh is not registered yet. Restart the backend to load the new scheduler job.');

  el.textContent = parts.join(' | ');
  el.style.color = collector && optionability ? 'var(--color-text-muted)' : '#f59e0b';
}

async function loadOptionsFlowOptionabilityStatus() {
  const el = document.getElementById('s-options-flow-optionability-status');
  if (!el) return;
  try {
    const res = await fetch(`${API_URL}/api/options-flow/optionability`);
    if (res.status === 404) {
      el.textContent = 'Optionability endpoint not available in the running backend. Restart backend to load it.';
      el.style.color = '#f59e0b';
      return;
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      el.textContent = 'Optionability endpoint is not active in the running backend. Restart backend to load it.';
      el.style.color = '#f59e0b';
      return;
    }
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load optionability status');
    const opt = json.data?.optionability || {};
    const chains = json.data?.chains || {};
    const latest = Array.isArray(chains.trade_dates) && chains.trade_dates.length > 0 ? chains.trade_dates[0] : null;
    const chainText = latest
      ? `Latest raw chain: ${latest.trade_date}, ${Number(latest.symbols || 0).toLocaleString()} symbols, ${Number(latest.contract_rows || 0).toLocaleString()} contracts`
      : 'No raw chain snapshots yet';
    el.textContent = [
      `Clean universe: ${Number(opt.clean_universe_count || 0).toLocaleString()}`,
      `Optionable: ${Number(opt.optionable_count || 0).toLocaleString()}`,
      `Not optionable: ${Number(opt.not_optionable_count || 0).toLocaleString()}`,
      `Unknown: ${Number(opt.unknown_count || 0).toLocaleString()}`,
      chainText,
    ].join(' | ');
    el.style.color = 'var(--color-text-muted)';
  } catch (err) {
    el.textContent = `Failed to load optionability status: ${err.message || err}`;
    el.style.color = '#f87171';
  }
}

async function loadOptionsFlowStatusEnhanced() {
  const el = document.getElementById('s-options-flow-status');
  if (el) {
    el.textContent = 'Loading options flow status...';
    el.style.color = 'var(--color-text-muted)';
  }
  try {
    const res = await fetch(`${API_URL}/api/options-flow/status`);
    const json = await res.json();
    if (!json.success) {
      if (el) el.textContent = 'Failed to load status.';
      return;
    }
    const d = json.data || {};
    if (d.running) {
      if (el) {
        el.textContent = d.last_message || 'Collection running...';
        el.style.color = '#f59e0b';
      }
    } else if (d.last_finished_at) {
      if (el) {
        el.textContent = `Last run: ${new Date(d.last_finished_at).toLocaleString()}${d.last_message ? ' - ' + d.last_message : ''}`;
        el.style.color = '#4ade80';
      }
    } else if (el) {
      el.textContent = 'No manual collection runs yet.';
      el.style.color = '';
    }
  } catch {
    if (el) {
      el.textContent = 'Failed to connect.';
      el.style.color = '#f87171';
    }
  }

  await loadOptionsFlowOptionabilityStatus();
  renderOptionsFlowSchedulerStatus();
}

async function runMiSchedulerJobNow(name, statusText) {
  const el = document.getElementById('s-options-flow-scheduler-status');
  if (!findMiSchedulerJob(name)) {
    if (el) {
      el.textContent = `${name} is not registered in the running backend. Restart backend to load the updated scheduler registry.`;
      el.style.color = '#f59e0b';
    }
    return;
  }
  if (el) {
    el.textContent = statusText || `Starting ${name}...`;
    el.style.color = '#f59e0b';
  }
  try {
    const res = await fetch(MI_API + '/scheduler/jobs/' + name + '/run', { method: 'POST' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to start job');
    loadMiSchedulerStatus();
  } catch (err) {
    if (el) {
      el.textContent = `Failed to start ${name}: ${err.message || err}`;
      el.style.color = '#f87171';
    }
  }
}

async function runOptionsFlowDailyHydration() {
  await runMiSchedulerJobNow('options_flow_collector', 'Starting scheduled options chain hydration...');
}
window.runOptionsFlowDailyHydration = runOptionsFlowDailyHydration;

async function runOptionsFlowOptionabilityRefresh() {
  await runMiSchedulerJobNow('options_optionability_refresh', 'Starting optionability map refresh...');
}
window.runOptionsFlowOptionabilityRefresh = runOptionsFlowOptionabilityRefresh;

async function runOptionsFlowCollectEnhanced() {
  const el = document.getElementById('s-options-flow-status');
  if (el) { el.textContent = 'Starting full optionable-universe options flow collection...'; el.style.color = '#f59e0b'; }
  try {
    const res = await fetch(`${API_URL}/api/options-flow/run-collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (json?.data?.started) {
      if (el) el.textContent = 'Collection started... polling for updates.';
      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`${API_URL}/api/options-flow/status`);
          const sj = await sr.json();
          if (sj?.data && !sj.data.running) {
            clearInterval(poll);
            if (el) { el.textContent = `Done: ${sj.data.last_message || 'Collection complete.'}`; el.style.color = '#4ade80'; }
            loadOptionsFlowOptionabilityStatus();
          } else if (sj?.data?.last_message && el) {
            el.textContent = sj.data.last_message;
          }
        } catch { /* ignore */ }
      }, 5000);
    } else if (el) {
      el.textContent = json?.data?.message || 'Already running.';
    }
  } catch (err) {
    if (el) { el.textContent = 'Failed to start collection.'; el.style.color = '#f87171'; }
  }
}

loadOptionsFlowStatus = loadOptionsFlowStatusEnhanced;
runOptionsFlowCollect = runOptionsFlowCollectEnhanced;
window.loadOptionsFlowStatus = loadOptionsFlowStatusEnhanced;
window.runOptionsFlowCollect = runOptionsFlowCollectEnhanced;

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadBackendAISettings();
  loadHydrationScheduleSettings();
  loadSocialScheduleSettings();
  loadMiSchedulerStatus();
  loadCalibrationStatus();
  loadEdgarSettings();
  load13fStatus();
  loadOptionsFlowStatus();
  toggleStopFields();
});
