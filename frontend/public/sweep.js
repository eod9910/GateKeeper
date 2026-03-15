/**
 * Parameter Sweep — Frontend Logic
 */

const API = '/api';
let selectedPreset = null;
let customValues = [];
let activeSweepId = null;
let pollTimer = null;

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadStrategies();
  loadRecentSweeps();
  setupPresetButtons();
  setupAddValueOnEnter();
});

function setupAddValueOnEnter() {
  document.getElementById('add-value-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCustomValue();
  });
  document.getElementById('custom-param-path').addEventListener('input', updateRunButton);
  document.getElementById('custom-param-label').addEventListener('input', updateRunButton);
}

// ─── Strategy loading ──────────────────────────────────────────────────────────

async function loadStrategies() {
  try {
    const res = await fetch(`${API}/sweep/strategies/list`);
    const data = await res.json();
    const select = document.getElementById('sweep-strategy-select');
    select.innerHTML = '<option value="">— Select a strategy —</option>';

    const items = data.data || [];
    const groups = {
      composite: items.filter(s => s.source === 'composite'),
      user: items.filter(s => s.source === 'user'),
      research: items.filter(s => s.source === 'research'),
    };

    const addGroup = (label, strategies) => {
      if (strategies.length === 0) return;
      const group = document.createElement('optgroup');
      group.label = label;
      strategies.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.strategy_version_id;
        opt.textContent = `${s.name} (${s.interval || '?'}) [${s.status}]`;
        group.appendChild(opt);
      });
      select.appendChild(group);
    };

    addGroup('Composite Strategies', groups.composite);
    addGroup('User Strategies', groups.user);
    addGroup('Research Candidates', groups.research);

    select.addEventListener('change', updateRunButton);
  } catch (e) {
    console.error('Failed to load strategies', e);
  }
}

// ─── Presets ───────────────────────────────────────────────────────────────────

function setupPresetButtons() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (selectedPreset === preset) {
        selectedPreset = null;
        btn.classList.remove('active');
      } else {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        selectedPreset = preset;
        btn.classList.add('active');
        // Clear custom values since preset is selected
        customValues = [];
        renderValuePills();
      }
      updateSelectedSummary();
      updateRunButton();
    });
  });
}

// ─── Custom values ─────────────────────────────────────────────────────────────

function addCustomValue() {
  const input = document.getElementById('add-value-input');
  const raw = input.value.trim();
  if (!raw) return;

  // Try to parse as number, fallback to string
  const val = isNaN(Number(raw)) ? raw : Number(raw);
  if (!customValues.includes(val)) {
    customValues.push(val);
    // Selecting a custom value clears preset
    selectedPreset = null;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    renderValuePills();
    updateSelectedSummary();
    updateRunButton();
  }
  input.value = '';
  input.focus();
}

function removeCustomValue(idx) {
  customValues.splice(idx, 1);
  renderValuePills();
  updateSelectedSummary();
  updateRunButton();
}

function renderValuePills() {
  const container = document.getElementById('values-pills');
  container.innerHTML = '';
  customValues.forEach((v, i) => {
    const pill = document.createElement('span');
    pill.className = 'value-pill';
    pill.innerHTML = `${v} <button onclick="removeCustomValue(${i})" title="Remove">×</button>`;
    container.appendChild(pill);
  });
}

// ─── UI state ──────────────────────────────────────────────────────────────────

function updateSelectedSummary() {
  const summary = document.getElementById('selected-config-summary');
  const text = document.getElementById('selected-config-text');

  if (selectedPreset) {
    const presetNames = {
      stop_type: 'Stop Type: percentage, atr, swing_low',
      atr_multiplier: 'ATR Multiplier: 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0',
      stop_pct: 'Stop %: 3%, 5%, 8%, 10%, 12%, 15%',
      take_profit_r: 'Take Profit R: 1.5, 2.0, 2.5, 3.0, 4.0',
      max_hold_bars: 'Max Hold Bars: 13, 26, 39, 52',
      rsi_oversold: 'RSI Oversold: 20, 25, 30, 35, 40',
      rdp_epsilon: 'RDP Epsilon %: 1%, 2%, 3%, 5%, 7%, 10%, 15%',
      max_concurrent: 'Max Concurrent Positions: 3, 5, 8, 10, 15, 20',
    };
    text.textContent = presetNames[selectedPreset] || selectedPreset;
    summary.style.display = 'block';
  } else if (customValues.length > 0) {
    const path = document.getElementById('custom-param-path').value.trim();
    const label = document.getElementById('custom-param-label').value.trim() || path;
    text.textContent = `${label}: ${customValues.join(', ')}`;
    summary.style.display = 'block';
  } else {
    summary.style.display = 'none';
  }
}

function updateRunButton() {
  const strategy = document.getElementById('sweep-strategy-select').value;
  const hasParam = selectedPreset || (
    customValues.length > 0 &&
    document.getElementById('custom-param-path').value.trim()
  );
  document.getElementById('btn-run-sweep').disabled = !strategy || !hasParam;
}

// ─── Run sweep ─────────────────────────────────────────────────────────────────

async function runSweep() {
  const strategyVersionId = document.getElementById('sweep-strategy-select').value;
  if (!strategyVersionId) return;

  const btn = document.getElementById('btn-run-sweep');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const tier = document.getElementById('sweep-tier-select')?.value || 'tier1';
    const body = { strategy_version_id: strategyVersionId, tier };

    if (selectedPreset) {
      body.preset = selectedPreset;
    } else {
      const path = document.getElementById('custom-param-path').value.trim();
      const label = document.getElementById('custom-param-label').value.trim() || path;
      body.sweep_params = [{ label, param_path: path, values: customValues }];
    }

    const res = await fetch(`${API}/sweep/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to start sweep');

    activeSweepId = data.data.sweep_id;
    startPolling(activeSweepId);
    loadRecentSweeps();
  } catch (e) {
    alert(`Failed to start sweep: ${e.message}`);
  } finally {
    btn.textContent = 'Run Sweep';
    updateRunButton();
  }
}

// ─── Cancel sweep ───────────────────────────────────────────────────────────────

async function cancelSweep(sweepId) {
  const btn = document.getElementById('cancel-sweep-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelling...'; }
  try {
    const res = await fetch(`${API}/sweep/${sweepId}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    fetchAndRenderSweep(sweepId);
  } catch (e) {
    alert(`Failed to cancel: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Cancel Sweep'; }
  }
}

// ─── Polling ───────────────────────────────────────────────────────────────────

function startPolling(sweepId) {
  if (pollTimer) clearInterval(pollTimer);
  renderLoadingState(sweepId);
  pollTimer = setInterval(() => fetchAndRenderSweep(sweepId), 5000);
  fetchAndRenderSweep(sweepId);
}

async function fetchAndRenderSweep(sweepId) {
  try {
    const res = await fetch(`${API}/sweep/${sweepId}`);
    const data = await res.json();
    if (!data.success) return;
    renderSweepResults(data.data);
    if (data.data.status === 'completed' || data.data.status === 'failed' || data.data.status === 'cancelled') {
      clearInterval(pollTimer);
      pollTimer = null;
      loadRecentSweeps();
    }
  } catch {}
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

function renderLoadingState(sweepId) {
  document.getElementById('results-sweep-id').textContent = sweepId;
  document.getElementById('results-body').innerHTML = `
    <div class="sweep-progress">
      <div class="sweep-progress-bar-track"><div class="sweep-progress-bar-fill" style="width:5%"></div></div>
      <span class="sweep-progress-label">Starting sweep...</span>
    </div>
  `;
}

function renderSweepResults(sweep) {
  document.getElementById('results-sweep-id').textContent = sweep.sweep_id;

  const completed = sweep.variants.filter(v => v.status === 'completed').length;
  const total = sweep.variants.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const progressLabel = sweep.status === 'completed'
    ? `All ${total} variants complete`
    : `${completed} / ${total} variants complete`;

  let html = '';

  // Progress bar + cancel button (while running)
  if (sweep.status === 'running') {
    html += `
      <div class="sweep-progress" style="display:flex;align-items:center;gap:var(--space-12);">
        <div style="flex:1;">
          <div class="sweep-progress-bar-track">
            <div class="sweep-progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="sweep-progress-label">${progressLabel}</span>
        </div>
        <button id="cancel-sweep-btn" onclick="cancelSweep('${sweep.sweep_id}')"
          style="padding:var(--space-6) var(--space-14);border:1px solid var(--color-negative);border-radius:var(--radius-sm);background:transparent;color:var(--color-negative);cursor:pointer;font-size:var(--text-caption);font-weight:600;white-space:nowrap;">
          Cancel Sweep
        </button>
      </div>
    `;
  } else if (sweep.status === 'cancelled') {
    html += `
      <div style="padding:var(--space-8);font-size:var(--text-caption);color:var(--color-text-subtle);">${progressLabel} — Cancelled</div>
    `;
  }

  // Results table
  const paramLabel = sweep.sweep_params?.[0]?.label || 'Parameter';
  html += `
    <div style="overflow-x:auto;">
      <table class="results-table">
        <thead>
          <tr>
            <th>${paramLabel}</th>
            <th>Status</th>
            <th>Trades</th>
            <th>Expectancy</th>
            <th>Win Rate</th>
            <th>Profit Factor</th>
            <th>Max DD</th>
            <th>Sharpe</th>
            <th>Fitness</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Sort: completed (by fitness desc) first, then running, then pending, then failed
  const sorted = [...sweep.variants].sort((a, b) => {
    const order = { completed: 0, running: 1, pending: 2, failed: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    const fa = a.metrics?.fitness_score ?? -1;
    const fb = b.metrics?.fitness_score ?? -1;
    return fb - fa;
  });

  sorted.forEach(v => {
    const isWinner = sweep.winner?.variant_id === v.variant_id;
    const rowClass = isWinner ? 'winner-row' : v.status === 'running' ? 'running-row' : v.status === 'failed' ? 'failed-row' : '';
    const statusBadge = isWinner
      ? '<span class="badge-status badge-winner">★ Winner</span>'
      : `<span class="badge-status badge-${v.status}">${v.status}</span>`;

    const m = v.metrics;
    const fmt = (n, digits = 2) => n != null ? Number(n).toFixed(digits) : '—';
    const fmtPct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—';

    html += `
      <tr class="${rowClass}">
        <td style="font-weight:600; color:${isWinner ? 'var(--color-positive)' : 'var(--color-text)'}">
          ${v.param_value}${typeof v.param_value === 'number' && v.param_value < 1 && v.param_path?.includes('stop_value') ? ' (' + (v.param_value * 100).toFixed(0) + '%)' : ''}
        </td>
        <td>${statusBadge}</td>
        <td>${m ? m.total_trades : '—'}</td>
        <td style="color:${m && m.expectancy_R > 0 ? 'var(--color-positive)' : m && m.expectancy_R < 0 ? 'var(--color-negative)' : 'inherit'}">${m ? fmt(m.expectancy_R) + 'R' : '—'}</td>
        <td>${m ? fmtPct(m.win_rate * 100) : '—'}</td>
        <td>${m ? fmt(m.profit_factor) : '—'}</td>
        <td style="color:${m && m.max_drawdown_pct > 30 ? 'var(--color-negative)' : 'inherit'}">${m ? fmtPct(m.max_drawdown_pct) : '—'}</td>
        <td>${m ? fmt(m.sharpe_ratio) : '—'}</td>
        <td style="font-weight:600; color:${m && m.fitness_score > 0.5 ? 'var(--color-positive)' : 'inherit'}">${m ? fmt(m.fitness_score, 3) : '—'}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';

  // Build copy text
  const copyHeader = `${paramLabel}\tStatus\tTrades\tExpectancy\tWin Rate\tProfit Factor\tMax DD\tSharpe\tFitness`;
  const copyRows = sorted.map(v => {
    const m = v.metrics;
    const isWinner = sweep.winner?.variant_id === v.variant_id;
    const status = isWinner ? 'Winner' : v.status;
    if (!m) return `${v.param_value}\t${status}\t—\t—\t—\t—\t—\t—\t—`;
    return `${v.param_value}\t${status}\t${m.total_trades}\t${m.expectancy_R.toFixed(2)}R\t${(m.win_rate * 100).toFixed(1)}%\t${m.profit_factor.toFixed(2)}\t${m.max_drawdown_pct.toFixed(1)}%\t${m.sharpe_ratio.toFixed(2)}\t${m.fitness_score.toFixed(3)}`;
  }).join('\n');
  window.__sweepCopyText = `${copyHeader}\n${copyRows}`;

  html += `
    <div style="margin-top:var(--space-8);display:flex;justify-content:flex-end;">
      <button id="copy-sweep-btn" style="font-size:var(--text-caption);padding:var(--space-4) var(--space-10);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-bg-subtle);color:var(--color-text-subtle);cursor:pointer;">
        Copy Results
      </button>
    </div>
  `;

  // Winner banner
  if (sweep.status === 'completed' && sweep.winner?.metrics) {
    const w = sweep.winner;
    html += `
      <div class="winner-banner">
        <div class="winner-banner-text">
          ★ Winner: <strong>${paramLabel} = ${w.param_value}</strong>
          &nbsp;·&nbsp; ${w.metrics.total_trades} trades
          &nbsp;·&nbsp; ${w.metrics.expectancy_R.toFixed(3)}R expectancy
          &nbsp;·&nbsp; fitness ${w.metrics.fitness_score.toFixed(3)}
        </div>
        <button class="btn-promote" onclick="promoteWinner('${sweep.sweep_id}')">
          Promote Winner →
        </button>
      </div>
    `;
  }

  document.getElementById('results-body').innerHTML = html;

  setTimeout(() => {
    const btn = document.getElementById('copy-sweep-btn');
    if (btn) btn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.__sweepCopyText).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Results', 1500);
      });
    });
  }, 0);
}

// ─── Promote winner ────────────────────────────────────────────────────────────

async function promoteWinner(sweepId) {
  try {
    const res = await fetch(`${API}/sweep/${sweepId}/promote`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    alert(`Winner promoted as new strategy version:\n${data.data.strategy_version_id}\n\nYou can now run a full Tier 2 validation on it in the Validator.`);
  } catch (e) {
    alert(`Failed to promote: ${e.message}`);
  }
}

// ─── Recent sweeps ─────────────────────────────────────────────────────────────

async function loadRecentSweeps() {
  try {
    const res = await fetch(`${API}/sweep/`);
    const data = await res.json();
    const list = document.getElementById('sweep-history-list');
    const sweeps = (data.data || []).slice(0, 10);

    if (sweeps.length === 0) {
      list.innerHTML = '<div style="font-size:var(--text-caption); color:var(--color-text-muted);">No sweeps yet.</div>';
      return;
    }

    list.innerHTML = sweeps.map(s => {
      const paramLabel = s.sweep_params?.[0]?.label || 'Parameter';
      const variantCount = s.variants?.length || 0;
      const completedCount = s.variants?.filter(v => v.status === 'completed').length || 0;
      const statusColor = s.status === 'completed' ? 'var(--color-positive)' : s.status === 'running' ? 'var(--color-accent)' : 'var(--color-text-muted)';
      return `
        <div class="sweep-history-item ${activeSweepId === s.sweep_id ? 'active' : ''}" onclick="loadSweep('${s.sweep_id}')">
          <div class="sweep-name">${paramLabel}</div>
          <div class="sweep-meta">
            <span style="color:${statusColor}">${s.status}</span>
            · ${completedCount}/${variantCount} variants
            ${s.winner ? `· winner: ${s.winner.param_value}` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch {}
}

function loadSweep(sweepId) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  activeSweepId = sweepId;
  startPolling(sweepId);
  loadRecentSweeps();
}
