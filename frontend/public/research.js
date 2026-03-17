/**
 * Research Agent UI
 *
 * Handles session management, live SSE streaming, generation timeline,
 * leaderboard, and hypothesis detail panel.
 */

const API = '/api/research';

// ─── State ────────────────────────────────────────────────────────────────────

let sessions = [];
let activeSessionId = null;
let activeEventSource = null;
let selectedGeneration = null;
let showArchived = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  setInterval(loadSessions, 30_000);

  // Check for seed hypothesis from URL
  const params = new URLSearchParams(window.location.search);
  const seed = params.get('seed');
  if (seed) {
    const seedInput = document.getElementById('new-session-seed');
    if (seedInput) {
      seedInput.value = decodeURIComponent(seed);
    }
  }
});

// ─── Session list ─────────────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const res = await fetch(`${API}/sessions`);
    const payload = await res.json();
    if (!payload.success) return;
    sessions = payload.data || [];
    renderSessionList();
  } catch {}
}

function renderSessionList() {
  const el = document.getElementById('session-list');
  const count = document.getElementById('session-count');
  const archivedCount = sessions.filter(s => s.archived).length;
  const visibleSessions = showArchived ? sessions : sessions.filter(s => !s.archived);
  if (count) count.textContent = `${visibleSessions.length}${archivedCount ? ` (${archivedCount} archived)` : ''}`;

  if (!visibleSessions.length) {
    el.innerHTML = '<div class="empty-state" style="padding:var(--space-24);"><div class="empty-state-sub">No sessions yet.<br>Start one above.</div></div>';
    return;
  }

  el.innerHTML = visibleSessions.map(s => {
    const isRunning = s.status === 'running';
    const isArchived = s.archived;
    return `
    <div class="session-item ${s.session_id === activeSessionId ? 'active' : ''} ${isArchived ? 'archived' : ''}"
         onclick="selectSession('${s.session_id}')">
      <div class="session-item-name">
        ${escHtml(s.config.name)}
        <span class="badge badge-${s.status}">${s.status}</span>
        ${isRunning ? '<span class="pulse-dot"></span>' : ''}
        ${!isRunning ? `<div class="session-item-actions" onclick="event.stopPropagation()">
          ${(s.status === 'completed' || s.status === 'stopped') && !isArchived
            ? `<button title="Continue with mandated params" onclick="continueSessionFrom('${s.session_id}')" style="color:#6366f1;font-weight:600;">continue →</button>`
            : ''}
          ${isArchived
            ? `<button title="Unarchive" onclick="unarchiveSession('${s.session_id}')">restore</button>`
            : `<button title="Archive" onclick="archiveSession('${s.session_id}')">archive</button>`
          }
          <button class="btn-delete" title="Delete permanently" onclick="deleteSessionConfirm('${s.session_id}', '${escHtml(s.config.name)}')">delete</button>
        </div>` : ''}
      </div>
      <div class="session-item-meta">
        Gen ${s.generation}/${s.max_generations} &middot;
        ${s.genome_count} tested &middot;
        ${s.config.target_interval}
        ${s.best ? ` &middot; best fitness: ${s.best.fitness_score.toFixed(3)}` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─── Session select ───────────────────────────────────────────────────────────

async function selectSession(sessionId) {
  activeSessionId = sessionId;
  selectedGeneration = null;
  renderSessionList();

  // Close existing SSE
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  try {
    const res = await fetch(`${API}/sessions/${sessionId}`);
    const payload = await res.json();
    if (!payload.success) return;
    renderSessionDetail(payload.data);
    connectSSE(sessionId);
  } catch (err) {
    console.error('Failed to load session', err);
  }
}

// ─── SSE connection ───────────────────────────────────────────────────────────

function connectSSE(sessionId) {
  const es = new EventSource(`${API}/sessions/${sessionId}/stream`);
  activeEventSource = es;

  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) {
      Object.assign(session, {
        status: data.status,
        generation: data.generation,
        genome_count: (data.genome || []).length,
        best: data.best,
        current_hypothesis: data.current_hypothesis,
      });
      renderSessionList();
    }
    renderSessionDetail(data);
  });

  es.addEventListener('hypothesis', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: ${data.hypothesis}`, 'highlight');
    updateLiveHypothesis(data.hypothesis);
    updateProgress(data.generation);
  });

  es.addEventListener('backtest_started', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: Backtest started (job ${data.job_id?.slice(0, 8)})`, '');
  });

  es.addEventListener('backtest_progress', (e) => {
    const data = JSON.parse(e.data);
    updateBtProgress(data.stage, data.detail, data.pct);
  });

  es.addEventListener('reflecting', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: AI reflecting on backtest results...`, 'highlight');
  });

  es.addEventListener('reflection_complete', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: Reflection complete`, 'success');
  });

  es.addEventListener('reflection_error', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation}: Reflection failed — ${data.error}`, 'warn');
  });

  es.addEventListener('generation_complete', (e) => {
    const data = JSON.parse(e.data);
    const verdict = data.verdict;
    const cls = verdict === 'promoted' ? 'success' : verdict === 'kept' ? 'highlight' : '';
    appendLog(`Gen ${data.generation} complete — fitness: ${data.fitness_score?.toFixed(3)} — ${verdict}`, cls);
    addOrUpdateGenomeEntry(data);
    updateProgress(data.generation);
    const session = sessions.find(s => s.session_id === activeSessionId);
    if (session) session.genome_count = (session.genome_count || 0);
    renderLeaderboard();
    renderSessionList();
  });

  es.addEventListener('plugin_created', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Plugin created: ${data.pattern_id}`, 'highlight');
  });

  es.addEventListener('promoted', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Gen ${data.generation} PROMOTED to Tier-2! Fitness: ${data.fitness_score}`, 'success');
  });

  es.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    appendLog(data.message, '');
    updateLiveHypothesis(data.message);
  });

  es.addEventListener('warning', (e) => {
    const data = JSON.parse(e.data);
    appendLog(data.message, 'warn');
  });

  es.addEventListener('error', (e) => {
    if (e.data) {
      try {
        const data = JSON.parse(e.data);
        appendLog(`Error: ${data.error || data.message}`, 'error');
      } catch { appendLog('Connection error', 'error'); }
    }
  });

  es.addEventListener('session_end', (e) => {
    const data = JSON.parse(e.data);
    appendLog(`Session ${data.status}.`, data.status === 'completed' ? 'success' : '');
    es.close();
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) session.status = data.status;
    renderSessionList();
    updateLiveHypothesis(null);
    // Update the status badge and remove pulse dot in the detail header
    const statusEl = document.querySelector('.session-detail-status');
    if (statusEl) {
      const badgeClass = data.status === 'completed' ? 'badge-completed'
        : data.status === 'stopped' ? 'badge-stopped'
        : data.status === 'error' ? 'badge-error' : 'badge-completed';
      statusEl.className = `badge ${badgeClass} session-detail-status`;
      statusEl.innerHTML = data.status.toUpperCase();
    }
    const pulseEl = document.querySelector('.session-detail-pulse');
    if (pulseEl) pulseEl.remove();
  });

  es.onerror = () => {
    // Reconnect handled by browser
  };
}

// ─── Session detail rendering ─────────────────────────────────────────────────

let currentGenome = [];

function renderSessionDetail(data) {
  currentGenome = data.genome || [];
  selectedGeneration = null;

  const isRunning = data.status === 'running';
  const pct = data.max_generations > 0 ? (data.generation / data.max_generations) * 100 : 0;

  document.getElementById('research-main').innerHTML = `
    <!-- Header -->
    <div class="panel">
      <div class="panel-body">
        <div class="session-detail-header">
          <div>
            <div class="session-name">${escHtml(data.config?.name || 'Session')}</div>
            <div class="session-meta">
              <div class="meta-item">
                <div class="meta-label">Status</div>
                <div class="meta-value">
                  <span class="badge badge-${data.status} session-detail-status">${data.status}</span>
                  ${isRunning ? '<span class="pulse-dot session-detail-pulse" style="margin-left:6px;"></span>' : ''}
                </div>
              </div>
              <div class="meta-item">
                <div class="meta-label">Generation</div>
                <div class="meta-value" id="session-detail-gen">${data.generation} / ${data.max_generations}</div>
              </div>
              <div class="meta-item">
                <div class="meta-label">Interval</div>
                <div class="meta-value">${data.config?.target_interval || '1wk'}</div>
              </div>
              <div class="meta-item">
                <div class="meta-label">Tested</div>
                <div class="meta-value" id="session-detail-tested">${currentGenome.length}</div>
              </div>
              ${data.best ? `<div class="meta-item">
                <div class="meta-label">Best Fitness</div>
                <div class="meta-value" style="color:var(--color-accent)">${data.best.fitness_score.toFixed(3)}</div>
              </div>` : ''}
            </div>
          </div>
          ${isRunning ? `<button class="btn-danger" onclick="stopCurrentSession()">Stop Session</button>` : ''}
        </div>

        <!-- Progress -->
        <div class="progress-container">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" id="gen-progress-bar" style="width:${pct.toFixed(1)}%"></div>
          </div>
          <div class="progress-label">
            <span id="gen-progress-label">${data.generation} of ${data.max_generations} generations</span>
            <span id="bt-progress-label"></span>
          </div>
        </div>

        <!-- Live hypothesis -->
        <div id="live-hypothesis" class="hypothesis-live ${data.current_hypothesis ? '' : 'empty'}">
          ${escHtml(data.current_hypothesis || 'Waiting for next generation...')}
        </div>

        <!-- Live log -->
        <div id="live-log" class="live-log"></div>
      </div>
    </div>

    <!-- Leaderboard -->
    <div class="panel" id="leaderboard-panel">
      <div class="panel-header">Leaderboard</div>
      <div id="leaderboard-body">
        ${renderLeaderboardHtml(currentGenome)}
      </div>
    </div>

    <!-- Generation timeline -->
    <div class="panel">
      <div class="panel-header">
        Generation Timeline
        <span style="font-size:11px;font-weight:400;color:var(--color-text-subtle)">${currentGenome.length} entries</span>
      </div>
      <div class="panel-body">
        <div id="generation-timeline" class="generation-timeline">
          ${renderTimelineHtml(currentGenome)}
        </div>
      </div>
    </div>

    <!-- Detail drawer -->
    <div id="detail-drawer" style="display:none;"></div>
  `;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function renderLeaderboard() {
  const el = document.getElementById('leaderboard-body');
  if (el) el.innerHTML = renderLeaderboardHtml(currentGenome);
}

function renderLeaderboardHtml(genome) {
  if (!genome.length) {
    return '<div class="empty-state" style="padding:var(--space-24);"><div class="empty-state-sub">No results yet.</div></div>';
  }
  const sorted = [...genome]
    .filter(e => e.report_summary)
    .sort((a, b) => b.fitness_score - a.fitness_score);

  if (!sorted.length) {
    return '<div class="empty-state" style="padding:var(--space-24);"><div class="empty-state-sub">No completed backtests yet.</div></div>';
  }

  const rows = sorted.map((e, rank) => {
    const r = e.report_summary;
    return `
      <tr onclick="showDetail(${e.generation})" style="cursor:pointer;">
        <td class="mono">#${rank + 1}</td>
        <td class="mono" style="color:var(--color-text-subtle)">Gen ${e.generation}</td>
        <td style="max-width:260px;font-size:12px;color:var(--color-text-muted);line-height:1.3">${escHtml(truncate(e.hypothesis, 80))}</td>
        <td>
          <div class="fitness-bar-inline">
            <div class="fitness-bar-bg">
              <div class="fitness-bar-fill" style="width:${(e.fitness_score * 100).toFixed(1)}%"></div>
            </div>
            <span class="fitness-val" style="color:${fitnessColor(e.fitness_score)}">${e.fitness_score.toFixed(3)}</span>
          </div>
        </td>
        <td class="mono">${r.total_trades}</td>
        <td class="mono">${(r.win_rate * 100).toFixed(1)}%</td>
        <td class="mono" style="color:${r.expectancy_R > 0 ? '#50b478' : '#e05c5c'}">${r.expectancy_R.toFixed(3)}R</td>
        <td class="mono">${r.sharpe_ratio?.toFixed(2) || '—'}</td>
        <td><span class="badge badge-${e.verdict}">${e.verdict}</span></td>
        <td>
          ${e.verdict !== 'promoted'
            ? `<button class="btn-ghost" onclick="event.stopPropagation();manualPromote(${e.generation})">Promote</button>`
            : '<span style="color:#82c850;font-size:11px;">&#10003; promoted</span>'}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>#</th><th>Gen</th><th>Hypothesis</th><th>Fitness</th>
          <th>Trades</th><th>Win%</th><th>Exp</th><th>Sharpe</th>
          <th>Verdict</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function renderTimelineHtml(genome) {
  if (!genome.length) {
    return '<div class="empty-state" style="padding:var(--space-24);"><div class="empty-state-sub">No generations yet.</div></div>';
  }
  return [...genome].reverse().map(e => {
    const r = e.report_summary;
    const metricsHtml = r ? `
      <div class="gen-metrics">
        <div class="gen-metric"><div class="gen-metric-label">Trades</div><div class="gen-metric-value">${r.total_trades}</div></div>
        <div class="gen-metric"><div class="gen-metric-label">Win%</div><div class="gen-metric-value">${(r.win_rate * 100).toFixed(1)}%</div></div>
        <div class="gen-metric"><div class="gen-metric-label">Exp</div><div class="gen-metric-value" style="color:${r.expectancy_R > 0 ? '#50b478' : '#e05c5c'}">${r.expectancy_R.toFixed(3)}R</div></div>
        <div class="gen-metric"><div class="gen-metric-label">Fitness</div><div class="gen-metric-value" style="color:${fitnessColor(e.fitness_score)}">${e.fitness_score.toFixed(3)}</div></div>
      </div>
    ` : '<div style="font-size:11px;color:var(--color-text-subtle);margin-top:var(--space-4);">No backtest results</div>';

    return `
      <div class="gen-entry ${selectedGeneration === e.generation ? 'selected' : ''}"
           onclick="showDetail(${e.generation})">
        <div class="gen-entry-header">
          <span class="gen-number">G${e.generation}</span>
          <span class="gen-hypothesis">${escHtml(truncate(e.hypothesis, 100))}</span>
          <span class="badge badge-${e.verdict}">${e.verdict}</span>
        </div>
        ${metricsHtml}
      </div>
    `;
  }).join('');
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function showDetail(generation) {
  selectedGeneration = generation;
  const entry = currentGenome.find(e => e.generation === generation);
  if (!entry) return;

  // Re-render timeline with selection
  const tl = document.getElementById('generation-timeline');
  if (tl) tl.innerHTML = renderTimelineHtml(currentGenome);

  const r = entry.report_summary;
  const drawer = document.getElementById('detail-drawer');
  if (!drawer) return;
  drawer.style.display = 'block';

  const metricsHtml = r ? `
    <div class="detail-section">
      <div class="detail-section-title">Backtest Metrics</div>
      <div class="metrics-grid">
        <div class="metric-card"><div class="metric-card-label">Trades</div><div class="metric-card-value ${r.total_trades >= 200 ? 'good' : 'bad'}">${r.total_trades}</div></div>
        <div class="metric-card"><div class="metric-card-label">Win Rate</div><div class="metric-card-value ${r.win_rate >= 0.5 ? 'good' : 'bad'}">${(r.win_rate * 100).toFixed(1)}%</div></div>
        <div class="metric-card"><div class="metric-card-label">Expectancy</div><div class="metric-card-value ${r.expectancy_R > 0 ? 'good' : 'bad'}">${r.expectancy_R.toFixed(3)}R</div></div>
        <div class="metric-card"><div class="metric-card-label">Profit Factor</div><div class="metric-card-value ${r.profit_factor >= 1.5 ? 'good' : r.profit_factor < 1 ? 'bad' : ''}">${r.profit_factor?.toFixed(2) || '—'}</div></div>
        <div class="metric-card"><div class="metric-card-label">Max Drawdown</div><div class="metric-card-value ${r.max_drawdown_pct < 20 ? 'good' : r.max_drawdown_pct > 40 ? 'bad' : ''}">${r.max_drawdown_pct?.toFixed(1) || '—'}%</div></div>
        <div class="metric-card"><div class="metric-card-label">Sharpe</div><div class="metric-card-value ${r.sharpe_ratio >= 1 ? 'good' : r.sharpe_ratio < 0 ? 'bad' : ''}">${r.sharpe_ratio?.toFixed(2) || '—'}</div></div>
        <div class="metric-card"><div class="metric-card-label">OOS Degradation</div><div class="metric-card-value ${r.oos_degradation_pct < 30 ? 'good' : r.oos_degradation_pct > 60 ? 'bad' : ''}">${r.oos_degradation_pct?.toFixed(1) || '—'}%</div></div>
        <div class="metric-card"><div class="metric-card-label">Pass/Fail</div><div class="metric-card-value ${r.pass_fail === 'PASS' ? 'good' : 'bad'}">${r.pass_fail}</div></div>
        <div class="metric-card"><div class="metric-card-label">Fitness Score</div><div class="metric-card-value" style="color:${fitnessColor(entry.fitness_score)}">${entry.fitness_score.toFixed(3)}</div></div>
      </div>
    </div>
    <div class="section-divider"></div>
  ` : '<div style="color:var(--color-text-subtle);font-size:var(--text-small);margin-bottom:var(--space-16);">No backtest results available.</div>';

  drawer.innerHTML = `
    <div class="detail-drawer">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-12);">
        <div style="font-size:var(--text-small);font-weight:700;color:var(--color-text);">Generation ${entry.generation} Detail</div>
        <div style="display:flex;gap:var(--space-8);align-items:center;">
          <span class="badge badge-${entry.verdict}">${entry.verdict}</span>
          ${entry.verdict !== 'promoted'
            ? `<button class="btn-ghost" onclick="manualPromote(${entry.generation})">Promote to Tier-2</button>`
            : ''}
          <button class="btn-ghost" onclick="closeDetail()">&#10005; Close</button>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Hypothesis</div>
        <div style="font-size:var(--text-small);color:var(--color-text);line-height:1.6;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid var(--color-accent);border-radius:var(--radius);padding:var(--space-12);">
          ${escHtml(entry.hypothesis)}
        </div>
      </div>

      ${entry.new_plugins_created?.length ? `
        <div class="detail-section">
          <div class="detail-section-title">New Plugins Created</div>
          <div style="display:flex;gap:var(--space-8);flex-wrap:wrap;">
            ${entry.new_plugins_created.map(p => `<span class="badge badge-kept">${escHtml(p)}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      <div class="section-divider"></div>
      ${metricsHtml}

      <div class="detail-section">
        <div class="detail-section-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span>AI Reflection</span>
          ${entry.report_summary ? `<button class="btn-sm-outline" id="btn-regen-reflection" onclick="regenReflection(${entry.generation})" style="font-size:10px;padding:2px 8px;cursor:pointer;background:transparent;border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text-muted);">Regenerate</button>` : ''}
        </div>
        ${entry.reflection
          ? `<div id="reflection-content" style="font-size:var(--text-small);color:var(--color-text);line-height:1.6;background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid #f59e0b;border-radius:var(--radius);padding:var(--space-12);white-space:pre-wrap;">${escHtml(entry.reflection)}</div>`
          : `<div id="reflection-content" style="font-size:var(--text-small);color:var(--color-text-subtle);font-style:italic;">No reflection yet. Click Regenerate to analyze this backtest.</div>`
        }
        ${entry.suggested_params ? `
        <div style="margin-top:var(--space-8);background:var(--color-bg);border:1px solid var(--color-border);border-left:3px solid #6366f1;border-radius:var(--radius);padding:var(--space-8) var(--space-12);">
          <div style="font-size:10px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:var(--space-4);">Mandated for Next Gen</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${Object.entries(entry.suggested_params).map(([k, v]) =>
              `<span style="font-size:10px;padding:2px 6px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);border-radius:4px;color:var(--color-text);font-family:monospace;">${escHtml(k)}: <strong>${escHtml(String(v))}</strong></span>`
            ).join('')}
          </div>
        </div>` : ''}
      </div>
      <div class="section-divider"></div>

      <div class="detail-section">
        <div class="detail-section-title">Strategy Spec</div>
        <div class="json-viewer" id="spec-json-viewer">Loading...</div>
      </div>
    </div>
  `;

  // Load the strategy spec from the validator strategies endpoint
  loadStrategySpec(entry.strategy_version_id);
}

async function loadStrategySpec(stratVersionId) {
  try {
    const res = await fetch(`/api/strategies/${encodeURIComponent(stratVersionId)}`);
    if (!res.ok) throw new Error('Not found');
    const payload = await res.json();
    const spec = payload?.data || payload;
    const el = document.getElementById('spec-json-viewer');
    if (el) el.textContent = JSON.stringify(spec, null, 2);
  } catch {
    const el = document.getElementById('spec-json-viewer');
    if (el) el.textContent = '// Spec not found (may not be registered yet)';
  }
}

function closeDetail() {
  selectedGeneration = null;
  const drawer = document.getElementById('detail-drawer');
  if (drawer) drawer.style.display = 'none';
  const tl = document.getElementById('generation-timeline');
  if (tl) tl.innerHTML = renderTimelineHtml(currentGenome);
}

async function regenReflection(generation) {
  if (!activeSessionId) return;

  const btn = document.getElementById('btn-regen-reflection');
  const contentEl = document.getElementById('reflection-content');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing...'; }
  if (contentEl) {
    contentEl.style.borderLeftColor = '#6366f1';
    contentEl.textContent = 'Regenerating reflection with current model...';
  }

  let storedSettings = {};
  try { storedSettings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) {}
  const model = storedSettings.researchAnalystModel || undefined;

  try {
    const res = await fetch(`${API}/sessions/${activeSessionId}/reflect/${generation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed');

    const entry = currentGenome.find(e => e.generation === generation);
    if (entry) {
      entry.reflection = payload.data.reflection;
      if (payload.data.param_changes) entry.suggested_params = payload.data.param_changes;
    }

    if (contentEl) {
      contentEl.style.borderLeftColor = '#f59e0b';
      contentEl.textContent = payload.data.reflection;
    }

    // Re-render detail to show new mandated params badge
    if (entry) renderGenerationDetail(entry);
  } catch (err) {
    if (contentEl) {
      contentEl.style.borderLeftColor = '#e05c5c';
      contentEl.textContent = err.message.includes('404')
        ? 'Session no longer exists on server (lost after restart). Start a new session to use this feature.'
        : `Reflection failed: ${err.message}`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Regenerate'; }
  }
}

// ─── Live update helpers ──────────────────────────────────────────────────────

function updateLiveHypothesis(text) {
  const el = document.getElementById('live-hypothesis');
  if (!el) return;
  if (text) {
    el.classList.remove('empty');
    el.textContent = text;
  } else {
    el.classList.add('empty');
    el.textContent = 'Session complete.';
  }
}

function updateProgress(generation) {
  const session = sessions.find(s => s.session_id === activeSessionId);
  if (!session) return;
  const max = session.max_generations || 1;
  const pct = (generation / max) * 100;
  const bar = document.getElementById('gen-progress-bar');
  const label = document.getElementById('gen-progress-label');
  if (bar) bar.style.width = `${pct.toFixed(1)}%`;
  if (label) label.textContent = `${generation} of ${max} generations`;
  const genEl = document.getElementById('session-detail-gen');
  if (genEl) genEl.textContent = `${generation} / ${max}`;
  const testedEl = document.getElementById('session-detail-tested');
  if (testedEl) testedEl.textContent = `${currentGenome.length}`;
}

function updateBtProgress(stage, detail, pct) {
  const el = document.getElementById('bt-progress-label');
  if (el) el.textContent = detail ? `${stage}: ${truncate(detail, 40)}` : stage;
}

function appendLog(message, cls) {
  const el = document.getElementById('live-log');
  if (!el) return;
  const now = new Date().toTimeString().slice(0, 8);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-ts">${now}</span><span class="log-msg ${cls}">${escHtml(message)}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  // Keep only last 100 lines
  while (el.children.length > 100) el.removeChild(el.firstChild);
}

function addOrUpdateGenomeEntry(entry) {
  const existing = currentGenome.findIndex(e => e.generation === entry.generation);
  if (existing >= 0) currentGenome[existing] = entry;
  else currentGenome.push(entry);

  const tl = document.getElementById('generation-timeline');
  if (tl) tl.innerHTML = renderTimelineHtml(currentGenome);
}

// ─── Start session ────────────────────────────────────────────────────────────

async function startSession() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { alert('Please enter a session name.'); return; }

  let storedSettings = {};
  try { storedSettings = JSON.parse(localStorage.getItem('copilotSettings') || '{}'); } catch(e) {}

  // Build risk defaults from Settings for the research agent
  let riskDefaults = undefined;
  if (storedSettings.defaultStopType || storedSettings.defaultTakeProfitR || storedSettings.defaultMaxHold) {
    riskDefaults = {
      defaultStopType: storedSettings.defaultStopType || 'atr_multiple',
      defaultStopValue: storedSettings.defaultStopValue || '2.0',
      defaultStopBuffer: storedSettings.defaultStopBuffer || '2',
      minRR: storedSettings.minRR || '1.5',
      defaultTakeProfitR: storedSettings.defaultTakeProfitR || '2.0',
      defaultMaxHold: storedSettings.defaultMaxHold || '30',
      defaultBreakevenR: storedSettings.defaultBreakevenR || '1.0',
      defaultTrailingType: storedSettings.defaultTrailingType || 'none',
      defaultTrailingValue: storedSettings.defaultTrailingValue || '2.0',
      riskPercent: storedSettings.riskPercent || '2',
    };
  }

  const config = {
    name,
    max_generations: parseInt(document.getElementById('input-gens').value, 10) || 5,
    target_interval: document.getElementById('input-interval').value,
    target_asset_class: document.getElementById('input-asset').value,
    seed_hypothesis: document.getElementById('input-seed').value.trim() || undefined,
    promotion_min_fitness: parseFloat(document.getElementById('input-threshold').value) || 0.6,
    promotion_requires_pass: true,
    allow_new_primitives: document.getElementById('input-allow-primitives').checked,
    hypothesis_model: storedSettings.researchStrategistModel || undefined,
    reflection_model: storedSettings.researchAnalystModel || undefined,
    risk_defaults: riskDefaults,
  };

  const btn = document.getElementById('btn-start');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const res = await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed');

    sessions.unshift(payload.data);
    renderSessionList();
    await selectSession(payload.data.session_id);

    // Reset form
    document.getElementById('input-name').value = '';
    document.getElementById('input-seed').value = '';
  } catch (err) {
    alert(`Failed to start session: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start Research Session';
  }
}

// ─── Stop session ─────────────────────────────────────────────────────────────

async function stopCurrentSession() {
  if (!activeSessionId) return;
  if (!confirm('Stop this session?')) return;
  try {
    await fetch(`${API}/sessions/${activeSessionId}/stop`, { method: 'POST' });
    const session = sessions.find(s => s.session_id === activeSessionId);
    if (session) session.status = 'stopped';
    renderSessionList();
  } catch (err) {
    alert(`Failed to stop: ${err.message}`);
  }
}

// ─── Manual promotion ─────────────────────────────────────────────────────────

async function manualPromote(generation) {
  if (!activeSessionId) return;
  if (!confirm(`Promote generation ${generation} to Tier-2 backtesting?`)) return;
  try {
    const res = await fetch(`${API}/sessions/${activeSessionId}/promote/${generation}`, { method: 'POST' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    const entry = currentGenome.find(e => e.generation === generation);
    if (entry) {
      entry.verdict = 'promoted';
      renderLeaderboard();
      const tl = document.getElementById('generation-timeline');
      if (tl) tl.innerHTML = renderTimelineHtml(currentGenome);
      if (selectedGeneration === generation) showDetail(generation);
    }
  } catch (err) {
    alert(`Promotion failed: ${err.message}`);
  }
}

// ─── Delete / Archive / Unarchive ─────────────────────────────────────────────

async function continueSessionFrom(sessionId) {
  try {
    const res = await fetch(`${API}/sessions/${sessionId}/continue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed');
    await loadSessions();
    selectSession(payload.data.session_id);
  } catch (err) {
    alert(`Continue failed: ${err.message}`);
  }
}

async function deleteSessionConfirm(sessionId, name) {
  if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
  try {
    const res = await fetch(`${API}/sessions/${sessionId}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    sessions = sessions.filter(s => s.session_id !== sessionId);
    if (activeSessionId === sessionId) {
      activeSessionId = null;
      document.getElementById('research-main').innerHTML = '<div class="empty-state"><div class="empty-state-sub">Select a session from the sidebar.</div></div>';
    }
    renderSessionList();
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
}

async function archiveSession(sessionId) {
  try {
    const res = await fetch(`${API}/sessions/${sessionId}/archive`, { method: 'POST' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) session.archived = true;
    renderSessionList();
  } catch (err) {
    alert(`Archive failed: ${err.message}`);
  }
}

async function unarchiveSession(sessionId) {
  try {
    const res = await fetch(`${API}/sessions/${sessionId}/unarchive`, { method: 'POST' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error);
    const session = sessions.find(s => s.session_id === sessionId);
    if (session) session.archived = false;
    renderSessionList();
  } catch (err) {
    alert(`Unarchive failed: ${err.message}`);
  }
}

function toggleShowArchived(checked) {
  showArchived = checked;
  renderSessionList();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function fitnessColor(score) {
  if (score >= 0.7) return '#82c850';
  if (score >= 0.5) return '#50b478';
  if (score >= 0.3) return 'var(--color-accent)';
  if (score > 0)    return 'var(--color-text-muted)';
  return 'var(--color-text-subtle)';
}
