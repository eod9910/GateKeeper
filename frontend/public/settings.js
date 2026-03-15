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

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadBackendAISettings();
  toggleStopFields();
});
