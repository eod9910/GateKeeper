// =========================================================================
// scanner.js — Scan execution, indicator loading, symbol library, results
// =========================================================================

// ─── Universe Management ──────────────────────────────────────────────────────

let _universeStatusPollTimer = null;
const UNIVERSE_WEEKLY_CHECK_KEY = 'universe.lastUpdateCheck';

async function universeRefreshStatus() {
  const bar = document.getElementById('universe-status-bar');
  if (!bar) return;
  try {
    const res = await fetch(`${API_URL}/api/universe/status`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const d = json.data;

    if (!d.built) {
      bar.innerHTML = `<span style="color:var(--color-text-muted)">Universe not built yet.</span> Run <strong>Build Universe</strong> to download the full Russell 2000 source universe and derive the optionable subset.`;
      document.getElementById('btn-update-universe').disabled = true;
    } else {
      const updated = d.last_updated ? new Date(d.last_updated).toLocaleDateString() : 'unknown';
      const staleWarn = d.needs_update
        ? `<span style="color:var(--color-warning);margin-left:8px;">⚠ ${d.stale_count} symbols need update</span>`
        : `<span style="color:var(--color-success);margin-left:8px;">✓ Up to date</span>`;
      const sourceCount = Number(d.source_symbol_count || d.symbol_count || 0).toLocaleString();
      const downloadedCount = Number(d.downloaded_symbol_count || d.symbol_count || 0).toLocaleString();
      const optionableCount = Number(d.optionable_count || 0).toLocaleString();
      bar.innerHTML = `<strong>${sourceCount}</strong> source &nbsp;|&nbsp; <strong>${optionableCount}</strong> optionable &nbsp;|&nbsp; <strong>${downloadedCount}</strong> downloaded &nbsp;|&nbsp; Last updated: ${updated}${staleWarn}`;
      document.getElementById('btn-update-universe').disabled = false;
    }

    // Show active job if running
    if (d.active_job && d.active_job.status === 'running') {
      _universeShowProgress(d.active_job);
      _universeStartPolling();
    } else if (d.active_job && d.active_job.status !== 'running') {
      _universeShowProgress(d.active_job);
      _universeStopPolling();
    }
  } catch (err) {
    if (bar) bar.textContent = `Status unavailable: ${err.message}`;
  }
}

function _universeShowProgress(job) {
  const wrap = document.getElementById('universe-progress-wrap');
  const bar = document.getElementById('universe-progress-bar');
  const label = document.getElementById('universe-progress-label');
  const log = document.getElementById('universe-log');
  if (!wrap) return;

  wrap.style.display = 'block';
  if (bar) bar.style.width = `${job.progress ?? 0}%`;
  if (label) {
    const status = job.status === 'completed' ? '✓ Done' : job.status === 'failed' ? '✗ Failed' : '…';
    label.textContent = `${status} — ${job.progress_label || ''}`;
    label.style.color = job.status === 'failed' ? 'var(--color-danger)' : job.status === 'completed' ? 'var(--color-success)' : 'var(--color-text-subtle)';
  }
  if (log && job.log_tail && job.log_tail.length > 0) {
    log.style.display = 'block';
    log.textContent = job.log_tail.join('\n');
    log.scrollTop = log.scrollHeight;
  }
}

function _universeStartPolling() {
  if (_universeStatusPollTimer) return;
  _universeStatusPollTimer = setInterval(universeRefreshStatus, 3000);
}

function _universeStopPolling() {
  if (_universeStatusPollTimer) {
    clearInterval(_universeStatusPollTimer);
    _universeStatusPollTimer = null;
  }
}

async function universeBuild() {
  const confirmed = confirm(
    'Build Universe will download the full Russell 2000 source universe, keep the optionable subset, and save 5 years of price history.\n\n' +
    'This takes 45–90 minutes and uses significant bandwidth.\n\n' +
    'Continue?'
  );
  if (!confirmed) return;

  document.getElementById('btn-build-universe').disabled = true;
  document.getElementById('btn-update-universe').disabled = true;

  const wrap = document.getElementById('universe-progress-wrap');
  const bar = document.getElementById('universe-progress-bar');
  const label = document.getElementById('universe-progress-label');
  const log = document.getElementById('universe-log');
  if (wrap) wrap.style.display = 'block';
  if (bar) bar.style.width = '0%';
  if (label) label.textContent = 'Starting build…';
  if (log) { log.style.display = 'block'; log.textContent = ''; }

  try {
    const res = await fetch(`${API_URL}/api/universe/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    _universeStartPolling();
  } catch (err) {
    alert('Failed to start build: ' + err.message);
    document.getElementById('btn-build-universe').disabled = false;
  }
}

async function universeUpdate() {
  document.getElementById('btn-update-universe').disabled = true;

  const wrap = document.getElementById('universe-progress-wrap');
  const bar = document.getElementById('universe-progress-bar');
  const label = document.getElementById('universe-progress-label');
  const log = document.getElementById('universe-log');
  if (wrap) wrap.style.display = 'block';
  if (bar) bar.style.width = '0%';
  if (label) label.textContent = 'Starting update…';
  if (log) { log.style.display = 'block'; log.textContent = ''; }

  try {
    const res = await fetch(`${API_URL}/api/universe/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    localStorage.setItem(UNIVERSE_WEEKLY_CHECK_KEY, new Date().toISOString());
    _universeStartPolling();
  } catch (err) {
    alert('Failed to start update: ' + err.message);
    document.getElementById('btn-update-universe').disabled = false;
  }
}

async function universeRefreshStatus() {
  const bar = document.getElementById('universe-status-bar');
  if (!bar) return;
  try {
    const res = await fetch(`${API_URL}/api/universe/status`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const d = json.data;

    if (!d.built) {
      bar.innerHTML = `<span style="color:var(--color-text-muted)">Universe not built yet.</span> Run <strong>Build Universe</strong> to download the full source universe and derive the optionable subset.`;
      document.getElementById('btn-update-universe').disabled = true;
    } else {
      const updated = d.last_updated ? new Date(d.last_updated).toLocaleDateString() : 'unknown';
      const sourceLabel = String(d.source_label || d.source || 'Optionable universe');
      const staleWarn = d.needs_update
        ? `<span style="color:var(--color-warning);margin-left:8px;">${String.fromCharCode(9888)} ${d.stale_count} symbols need update</span>`
        : `<span style="color:var(--color-success);margin-left:8px;">Up to date</span>`;
      const sourceCount = Number(d.source_symbol_count || d.symbol_count || 0).toLocaleString();
      const downloadedCount = Number(d.downloaded_symbol_count || d.symbol_count || 0).toLocaleString();
      const optionableCount = Number(d.optionable_count || 0).toLocaleString();
      bar.innerHTML = `<strong>${sourceLabel}</strong> &nbsp;|&nbsp; <strong>${sourceCount}</strong> source &nbsp;|&nbsp; <strong>${optionableCount}</strong> optionable &nbsp;|&nbsp; <strong>${downloadedCount}</strong> downloaded &nbsp;|&nbsp; Last updated: ${updated}${staleWarn}`;
      document.getElementById('btn-update-universe').disabled = false;
    }

    if (d.active_job && d.active_job.status === 'running') {
      _universeShowProgress(d.active_job);
      _universeStartPolling();
    } else if (d.active_job && d.active_job.status !== 'running') {
      _universeShowProgress(d.active_job);
      _universeStopPolling();
    }
  } catch (err) {
    if (bar) bar.textContent = `Status unavailable: ${err.message}`;
  }
}

async function universeBuild() {
  const confirmed = confirm(
    'Build Universe will download a broad US-listed source universe, derive the optionable subset, and save 5 years of price history.\n\n' +
    'This can take 60-180 minutes and uses significant bandwidth.\n\n' +
    'Continue?'
  );
  if (!confirmed) return;

  document.getElementById('btn-build-universe').disabled = true;
  document.getElementById('btn-update-universe').disabled = true;

  const wrap = document.getElementById('universe-progress-wrap');
  const bar = document.getElementById('universe-progress-bar');
  const label = document.getElementById('universe-progress-label');
  const log = document.getElementById('universe-log');
  if (wrap) wrap.style.display = 'block';
  if (bar) bar.style.width = '0%';
  if (label) label.textContent = 'Starting build...';
  if (log) { log.style.display = 'block'; log.textContent = ''; }

  try {
    const res = await fetch(`${API_URL}/api/universe/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'nasdaq-trader-us', min_volume: 0 }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    _universeStartPolling();
  } catch (err) {
    alert('Failed to start build: ' + err.message);
    document.getElementById('btn-build-universe').disabled = false;
  }
}

function _universeCheckWeeklyUpdate() {
  const last = localStorage.getItem(UNIVERSE_WEEKLY_CHECK_KEY);
  if (!last) return; // never run — don't auto-trigger, let user do it manually first
  const daysSince = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince >= 7) {
    console.log('[Universe] Auto-update triggered (7+ days since last update)');
    universeUpdate();
  }
}

const UNIVERSE_STATUS_POLL_MS = 3000;

function _formatUniverseTimestamp(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function _formatUniverseElapsed(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '-';
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function _formatUniverseStage(stage, type) {
  const labels = {
    starting: type === 'update'
      ? 'Starting Update'
      : type === 'rebuild_optionable'
        ? 'Starting Optionable Rebuild'
        : 'Starting Build',
    loading_source: 'Loading Source Universe',
    checking_optionability: 'Checking Option Chains',
    options_filtered: 'Option Filter Complete',
    retrying_unknown: 'Retrying Unknown Symbols',
    volume_filter: 'Checking Average Volume',
    downloading_history: 'Downloading History',
    writing_manifest: 'Writing Manifest',
    completed: 'Completed',
    failed: 'Failed',
  };
  return labels[String(stage || '').trim()] || (
    type === 'update'
      ? 'Updating Universe'
      : type === 'rebuild_optionable'
        ? 'Rebuilding Optionable Subset'
        : 'Building Universe'
  );
}

function _formatUniverseSource(job) {
  const sourceLabel = String(job?.source_label || '').trim();
  if (sourceLabel) return sourceLabel;
  const source = String(job?.source || '').trim();
  if (!source) return '-';
  if (source === 'nasdaq-trader-us') return 'Nasdaq Trader US-listed underlyings';
  return source;
}

function _setUniverseActionState({ running = false, built = false } = {}) {
  const buildBtn = document.getElementById('btn-build-universe');
  const updateBtn = document.getElementById('btn-update-universe');
  const rebuildBtn = document.getElementById('btn-rebuild-optionable');
  const regimeBtn = document.getElementById('btn-classify-regimes');
  const cancelBtn = document.getElementById('btn-cancel-universe-job');
  if (buildBtn) buildBtn.disabled = running;
  if (updateBtn) updateBtn.disabled = running || !built;
  if (rebuildBtn) rebuildBtn.disabled = running || !built;
  if (regimeBtn) regimeBtn.disabled = running;
  if (cancelBtn) {
    cancelBtn.style.display = running ? '' : 'none';
    cancelBtn.disabled = !running;
  }
}

function _hideUniverseProgress() {
  const wrap = document.getElementById('universe-progress-wrap');
  const meta = document.getElementById('universe-job-meta');
  const metrics = document.getElementById('universe-metrics');
  const logShell = document.getElementById('universe-log-shell');
  if (wrap) wrap.style.display = 'none';
  if (meta) {
    meta.style.display = 'none';
    meta.innerHTML = '';
  }
  if (metrics) {
    metrics.style.display = 'none';
    metrics.innerHTML = '';
  }
  if (logShell) logShell.style.display = 'none';
}

function _toggleUniverseProgressBar(bar, progress, isRunning) {
  if (!bar) return;
  const hasProgress = Number.isFinite(progress);
  const indeterminate = isRunning && !hasProgress;
  bar.classList.toggle('universe-progress-bar--indeterminate', indeterminate);
  if (indeterminate) {
    bar.style.width = '35%';
  } else if (hasProgress) {
    const pct = Math.max(0, Math.min(100, Number(progress)));
    bar.style.width = `${pct}%`;
  } else {
    bar.style.width = '0%';
  }
}

function _renderUniverseJobMeta(job) {
  const container = document.getElementById('universe-job-meta');
  if (!container) return;
  const statusLabel = job.status === 'completed' ? 'Done' : job.status === 'failed' ? 'Failed' : 'Running';
  const rows = [
    { label: 'Status', value: statusLabel },
    { label: 'Stage', value: _formatUniverseStage(job.stage, job.type) },
    { label: 'Started', value: _formatUniverseTimestamp(job.started_at) },
    { label: 'Elapsed', value: _formatUniverseElapsed(job.elapsed_seconds) },
  ];
  if (job.type === 'build') {
    rows.push({ label: 'Source', value: _formatUniverseSource(job) });
    rows.push({
      label: 'Config',
      value: `${job.lookback || '-'} / ${job.interval || '-'} / ${job.workers || '-'} workers`,
    });
  } else if (job.type === 'rebuild_optionable') {
    rows.push({ label: 'Source', value: _formatUniverseSource(job) });
    rows.push({
      label: 'Mode',
      value: `${job.interval || '-'} / ${job.workers || '-'} workers / optionable only`,
    });
  } else {
    rows.push({ label: 'Interval', value: job.interval || '-' });
    rows.push({ label: 'Last Output', value: _formatUniverseTimestamp(job.last_log_at) });
  }

  container.innerHTML = rows.map((row) => `
    <div class="universe-job-card">
      <div class="universe-job-card-label">${row.label}</div>
      <div class="universe-job-card-value">${row.value}</div>
    </div>
  `).join('');
  container.style.display = '';
}

function _renderUniverseMetrics(metrics) {
  const container = document.getElementById('universe-metrics');
  if (!container) return;
  const items = [];
  const fmt = (value) => Number(value).toLocaleString();
  if (Number.isFinite(metrics?.source_symbols)) {
    items.push({ label: 'Source Symbols', value: fmt(metrics.source_symbols) });
  }
  if (Number.isFinite(metrics?.option_checked) && Number.isFinite(metrics?.option_total)) {
    items.push({ label: 'Options Checked', value: `${fmt(metrics.option_checked)} / ${fmt(metrics.option_total)}` });
  }
  if (Number.isFinite(metrics?.optionable_so_far)) {
    items.push({ label: 'Optionable', value: fmt(metrics.optionable_so_far) });
  }
  if (Number.isFinite(metrics?.retry_checked) && Number.isFinite(metrics?.retry_total)) {
    items.push({ label: 'Retries', value: `${fmt(metrics.retry_checked)} / ${fmt(metrics.retry_total)}` });
  }
  if (Number.isFinite(metrics?.retry_recovered)) {
    items.push({ label: 'Recovered', value: fmt(metrics.retry_recovered) });
  }
  if (Number.isFinite(metrics?.volume_checked) && Number.isFinite(metrics?.volume_total)) {
    items.push({ label: 'Volume Checked', value: `${fmt(metrics.volume_checked)} / ${fmt(metrics.volume_total)}` });
  }
  if (Number.isFinite(metrics?.download_batch) && Number.isFinite(metrics?.download_batches)) {
    items.push({ label: 'History Batch', value: `${fmt(metrics.download_batch)} / ${fmt(metrics.download_batches)}` });
  }
  if (Number.isFinite(metrics?.download_total)) {
    items.push({ label: 'History Symbols', value: fmt(metrics.download_total) });
  }

  if (!items.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.innerHTML = items.map((item) => `
    <div class="universe-metric-pill">
      <span class="universe-metric-pill-label">${item.label}</span>
      <span class="universe-metric-pill-value">${item.value}</span>
    </div>
  `).join('');
  container.style.display = '';
}

function _universeShowProgress(job) {
  const wrap = document.getElementById('universe-progress-wrap');
  const bar = document.getElementById('universe-progress-bar');
  const label = document.getElementById('universe-progress-label');
  const logShell = document.getElementById('universe-log-shell');
  const log = document.getElementById('universe-log');
  const logUpdated = document.getElementById('universe-log-updated');
  if (!wrap) return;

  wrap.style.display = 'block';
  _toggleUniverseProgressBar(bar, job.progress, job.status === 'running');

  if (label) {
    const statusPrefix = job.status === 'completed' ? 'Done' : job.status === 'failed' ? 'Failed' : 'Running';
    const progressText = Number.isFinite(job.progress) ? ` ${Math.round(job.progress)}%` : '';
    const detail = job.progress_label || _formatUniverseStage(job.stage, job.type);
    label.textContent = `${statusPrefix}${progressText} - ${detail}`;
    label.style.color = job.status === 'failed'
      ? 'var(--color-danger)'
      : job.status === 'completed'
        ? 'var(--color-success)'
        : 'var(--color-text-subtle)';
  }

  _renderUniverseJobMeta(job);
  _renderUniverseMetrics(job.metrics || {});

  if (log && Array.isArray(job.log_tail) && job.log_tail.length > 0) {
    if (logShell) logShell.style.display = 'block';
    log.textContent = job.log_tail.join('\n');
    log.scrollTop = log.scrollHeight;
    if (logUpdated) {
      logUpdated.textContent = job.last_log_at ? `Updated ${_formatUniverseTimestamp(job.last_log_at)}` : '';
    }
  } else if (logShell) {
    logShell.style.display = 'none';
  }
}

function _universeStartPolling() {
  if (_universeStatusPollTimer) return;
  _universeStatusPollTimer = setInterval(universeRefreshStatus, UNIVERSE_STATUS_POLL_MS);
}

function _universeStopPolling() {
  if (_universeStatusPollTimer) {
    clearInterval(_universeStatusPollTimer);
    _universeStatusPollTimer = null;
  }
}

async function universeRefreshStatus() {
  const bar = document.getElementById('universe-status-bar');
  if (!bar) return;
  try {
    const res = await fetch(`${API_URL}/api/universe/status`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const d = json.data || {};
    const running = d.active_job && d.active_job.status === 'running';

    if (!d.built) {
      const activeNote = running ? `<span style="color:var(--color-warning);margin-left:8px;">Build running</span>` : '';
      bar.innerHTML = `<span style="color:var(--color-text-muted)">Universe not built yet.</span> Run <strong>Build Universe</strong> to download a broad US-listed source universe and derive the optionable subset.${activeNote}`;
    } else {
      const updated = d.last_updated ? new Date(d.last_updated).toLocaleDateString() : 'unknown';
      const sourceLabel = String(d.source_label || d.source || 'Optionable universe');
      const staleWarn = d.needs_update
        ? `<span style="color:var(--color-warning);margin-left:8px;">${String.fromCharCode(9888)} ${d.stale_count} symbols need update</span>`
        : `<span style="color:var(--color-success);margin-left:8px;">Up to date</span>`;
      const optionableWarn = d.optionable_complete === false
        ? `<span style="color:var(--color-warning);margin-left:8px;">${String.fromCharCode(9888)} Optionable subset incomplete (${Number(d.optionable_unclassified_count || 0).toLocaleString()} unclassified)</span>`
        : '';
      const activeNote = running
        ? `<span style="color:var(--color-accent);margin-left:8px;">${d.active_job.type === 'update' ? 'Update' : d.active_job.type === 'rebuild_optionable' ? 'Optionable rebuild' : d.active_job.type === 'classify_regimes' ? 'Regime classification' : 'Build'} running</span>`
        : '';
      const sourceCount = Number(d.source_symbol_count || d.symbol_count || 0).toLocaleString();
      const downloadedCount = Number(d.downloaded_symbol_count || d.symbol_count || 0).toLocaleString();
      const optionableCount = Number(d.optionable_count || 0).toLocaleString();
      bar.innerHTML = `<strong>${sourceLabel}</strong> &nbsp;|&nbsp; <strong>${sourceCount}</strong> source &nbsp;|&nbsp; <strong>${optionableCount}</strong> optionable &nbsp;|&nbsp; <strong>${downloadedCount}</strong> downloaded &nbsp;|&nbsp; Last updated: ${updated}${staleWarn}${optionableWarn}${activeNote}`;
    }

    _setUniverseActionState({ running, built: Boolean(d.built) });

    if (d.active_job) {
      _universeShowProgress(d.active_job);
      if (running) _universeStartPolling();
      else _universeStopPolling();
    } else {
      _hideUniverseProgress();
      _universeStopPolling();
    }

    // Refresh regime snapshot card (non-blocking)
    _loadRegimeSnapshot();
  } catch (err) {
    if (bar) bar.textContent = `Status unavailable: ${err.message}`;
  }
}

async function _loadRegimeSnapshot() {
  const card = document.getElementById('regime-snapshot-card');
  const barsEl = document.getElementById('regime-snapshot-bars');
  const ageEl = document.getElementById('regime-snapshot-age');
  if (!card || !barsEl || !ageEl) return;
  try {
    const res = await fetch(`${API_URL}/api/universe/regime-snapshot`);
    const json = await res.json();
    if (!json.success || !json.data) { card.style.display = 'none'; return; }
    const snap = json.data;
    card.style.display = '';

    // Age label
    if (snap.generated_at) {
      const age = Date.now() - new Date(snap.generated_at).getTime();
      const hours = Math.floor(age / 3600000);
      const days = Math.floor(hours / 24);
      ageEl.textContent = days >= 1 ? `${days}d ago` : hours >= 1 ? `${hours}h ago` : 'Just now';
    }

    // Regime bars
    const REGIME_COLORS = {
      expansion:    'var(--color-success, #22c55e)',
      distribution: 'var(--color-warning, #f59e0b)',
      accumulation: 'var(--color-accent, #4f8ef7)',
      markdown:     'var(--color-negative, #ef4444)',
      unknown:      'var(--color-text-subtle, #666)',
    };
    const summary = snap.summary || {};
    const total = Object.values(summary).reduce((a, b) => a + b, 0) || 1;
    const order = ['expansion', 'distribution', 'accumulation', 'markdown', 'unknown'];
    barsEl.innerHTML = order.filter(r => summary[r]).map(regime => {
      const count = summary[regime] || 0;
      const pct = ((count / total) * 100).toFixed(1);
      const color = REGIME_COLORS[regime] || 'var(--color-text-subtle)';
      return `
        <div style="flex:1;min-width:80px;background:var(--color-surface);border-radius:var(--radius-sm);padding:8px 10px;border-left:3px solid ${color};">
          <div style="font-size:10px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">${regime}</div>
          <div style="font-size:var(--text-small);font-weight:600;color:${color};">${count.toLocaleString()}</div>
          <div style="font-size:10px;color:var(--color-text-subtle);">${pct}%</div>
        </div>`;
    }).join('');
  } catch {
    if (card) card.style.display = 'none';
  }
}

async function universeBuild() {
  const confirmed = confirm(
    'Build Universe will download a broad US-listed source universe, derive the optionable subset, and save 5 years of price history.\n\n' +
    'This can take 60-180 minutes and uses significant bandwidth.\n\n' +
    'Continue?'
  );
  if (!confirmed) return;

  _setUniverseActionState({ running: true, built: true });
  _universeShowProgress({
    type: 'build',
    status: 'running',
    stage: 'starting',
    started_at: new Date().toISOString(),
    elapsed_seconds: 0,
    progress: null,
    progress_label: 'Starting build...',
    source: 'nasdaq-trader-us',
    source_label: 'Nasdaq Trader US-listed underlyings',
    lookback: '5y',
    interval: '1d',
    workers: 10,
    metrics: {},
    log_tail: [],
  });

  try {
    const res = await fetch(`${API_URL}/api/universe/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'nasdaq-trader-us', min_volume: 0 }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    if (json.data?.job) _universeShowProgress(json.data.job);
    _universeStartPolling();
  } catch (err) {
    alert('Failed to start build: ' + err.message);
    _setUniverseActionState({ running: false, built: true });
    universeRefreshStatus();
  }
}

async function universeUpdate() {
  _setUniverseActionState({ running: true, built: true });
  _universeShowProgress({
    type: 'update',
    status: 'running',
    stage: 'starting',
    started_at: new Date().toISOString(),
    elapsed_seconds: 0,
    progress: null,
    progress_label: 'Starting update...',
    interval: '1d',
    metrics: {},
    log_tail: [],
  });

  try {
    const res = await fetch(`${API_URL}/api/universe/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    localStorage.setItem(UNIVERSE_WEEKLY_CHECK_KEY, new Date().toISOString());
    if (json.data?.job) _universeShowProgress(json.data.job);
    _universeStartPolling();
  } catch (err) {
    alert('Failed to start update: ' + err.message);
    _setUniverseActionState({ running: false, built: true });
    universeRefreshStatus();
  }
}

async function universeRebuildOptionable() {
  const confirmed = confirm(
    'Rebuild Optionable will refresh the optionable subset against the full source universe.\n\n' +
    'This does not redownload price history.\n\n' +
    'Continue?'
  );
  if (!confirmed) return;

  _setUniverseActionState({ running: true, built: true });
  _universeShowProgress({
    type: 'rebuild_optionable',
    status: 'running',
    stage: 'starting',
    started_at: new Date().toISOString(),
    elapsed_seconds: 0,
    progress: null,
    progress_label: 'Starting optionable subset rebuild...',
    source: 'nasdaq-trader-us',
    source_label: 'Nasdaq Trader US-listed underlyings',
    interval: '1d',
    workers: 5,
    metrics: {},
    log_tail: [],
  });

  try {
    const res = await fetch(`${API_URL}/api/universe/rebuild-optionable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'nasdaq-trader-us', workers: 5 }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    if (json.data?.job) _universeShowProgress(json.data.job);
    _universeStartPolling();
  } catch (err) {
    alert('Failed to start optionable rebuild: ' + err.message);
    _setUniverseActionState({ running: false, built: true });
    universeRefreshStatus();
  }
}

async function universeClassifyRegimes() {
  _setUniverseActionState({ running: true, built: true });
  _universeShowProgress({
    type: 'classify_regimes',
    status: 'running',
    stage: 'classifying',
    started_at: new Date().toISOString(),
    elapsed_seconds: 0,
    progress: 0,
    progress_label: 'Classifying stocks by market regime...',
    source: 'local_csv',
    source_label: 'Local CSV cache',
    interval: '1d',
    workers: 1,
    metrics: {},
    log_tail: [],
  });

  try {
    const res = await fetch(`${API_URL}/api/universe/classify-regimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval: '1d' }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    if (json.data?.job) _universeShowProgress(json.data.job);
    _universeStartPolling();
    // Refresh regime snapshot card when done (polling will call universeRefreshStatus)
  } catch (err) {
    alert('Failed to start regime classification: ' + err.message);
    _setUniverseActionState({ running: false, built: true });
    universeRefreshStatus();
  }
}

async function universeCancelJob() {
  const confirmed = confirm('Cancel the active universe job?');
  if (!confirmed) return;
  try {
    const res = await fetch(`${API_URL}/api/universe/cancel`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    await universeRefreshStatus();
  } catch (err) {
    alert('Failed to cancel job: ' + err.message);
  }
}

function _universeCheckWeeklyUpdate() {
  const last = localStorage.getItem(UNIVERSE_WEEKLY_CHECK_KEY);
  if (!last) return;
  const daysSince = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince >= 7) {
    console.log('[Universe] Auto-update triggered (7+ days since last update)');
    universeUpdate();
  }
}

let _scannerIndicatorOptions = [];
let _activeScanJobId = null;
const ACTIVE_SCAN_JOB_STORAGE_KEY = 'scanner.activeBatchJob';
const SAVED_SCAN_RESULTS_STORAGE_KEY = 'scanner.savedResults.v1';

function persistActiveScanJob(state) {
  try {
    if (!state || !state.jobId) return;
    localStorage.setItem(ACTIVE_SCAN_JOB_STORAGE_KEY, JSON.stringify({
      jobId: String(state.jobId || '').trim(),
      totalSymbols: Number(state.totalSymbols || 0),
      pluginId: String(state.pluginId || '').trim(),
      interval: String(state.interval || '').trim(),
      period: String(state.period || '').trim(),
      timeframe: String(state.timeframe || '').trim(),
      progress: Number(state.progress || 0),
      completed: Number(state.completed || 0),
      stage: String(state.stage || '').trim(),
      detail: String(state.detail || '').trim(),
      updatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('Failed to persist active scan job:', err);
  }
}

function getPersistedActiveScanJob() {
  try {
    const raw = localStorage.getItem(ACTIVE_SCAN_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const jobId = String(parsed.jobId || '').trim();
    if (!jobId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedActiveScanJob() {
  try {
    localStorage.removeItem(ACTIVE_SCAN_JOB_STORAGE_KEY);
  } catch {}
}

function getSavedScanResultKey(candidate) {
  if (!candidate) return '';
  const symbol = String(candidate.symbol || '').trim().toUpperCase();
  const patternType = String(candidate.pattern_type || candidate._plugin_id || '').trim().toLowerCase();
  const timeframe = String(candidate.timeframe || candidate.interval || '').trim().toUpperCase();
  return `${symbol}::${patternType}::${timeframe}`;
}

function buildSavedScanCandidate(candidate) {
  if (!candidate) return null;
  const key = getSavedScanResultKey(candidate);
  if (!key) return null;

  // Save the full candidate so restore doesn't need to re-scan.
  // Strip only the heavy chart_data/bars arrays to stay within localStorage limits.
  const saved = {};
  for (const k of Object.keys(candidate)) {
    if (k === 'chart_data' || k === 'bars' || k === 'ohlcv') continue;
    saved[k] = candidate[k];
  }
  saved.id = candidate.id || candidate.candidate_id || key;
  saved.candidate_id = candidate.candidate_id || candidate.id || key;
  saved._saved_scan_key = key;
  saved.__savedScanStub = false;
  saved._plugin_id = candidate._plugin_id || candidate.pattern_type || '';
  saved.symbol = String(candidate.symbol || '').trim().toUpperCase();
  saved.scanned_at = candidate.scanned_at || new Date().toISOString();
  return saved;
}

function getSavedScanResultsSnapshot() {
  try {
    const raw = localStorage.getItem(SAVED_SCAN_RESULTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    return {
      savedAt: parsed.savedAt || null,
      rows,
      selectedKey: parsed.selectedKey || null,
      selectedIndex: Number.isFinite(Number(parsed.selectedIndex)) ? Number(parsed.selectedIndex) : 0,
      source: parsed.source || 'manual',
    };
  } catch (err) {
    console.warn('Failed to read saved scan results:', err);
    return null;
  }
}

function updateSavedScanStatus() {
  const statusEl = document.getElementById('saved-scan-status');
  const saveBtn = document.getElementById('btn-save-scan-results');
  const restoreBtn = document.getElementById('btn-restore-scan-results');
  const clearBtn = document.getElementById('btn-clear-scan-results');
  const snapshot = getSavedScanResultsSnapshot();
  if (saveBtn) saveBtn.disabled = !Array.isArray(candidates) || candidates.length === 0;
  if (restoreBtn) restoreBtn.disabled = !snapshot || !Array.isArray(snapshot.rows) || snapshot.rows.length === 0;
  if (clearBtn) clearBtn.disabled = !snapshot || !Array.isArray(snapshot.rows) || snapshot.rows.length === 0;
  if (!statusEl) return;
  if (!snapshot || !Array.isArray(snapshot.rows) || snapshot.rows.length === 0) {
    statusEl.textContent = 'No saved scan results yet.';
    return;
  }
  const savedAt = snapshot.savedAt ? new Date(snapshot.savedAt) : null;
  const when = savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt.toLocaleString() : 'unknown time';
  statusEl.textContent = `${snapshot.rows.length} saved result${snapshot.rows.length === 1 ? '' : 's'} • last saved ${when}`;
}

function saveCurrentScanResults(options = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const snapshotRows = rows
    .map((candidate) => buildSavedScanCandidate(candidate))
    .filter(Boolean);
  if (!snapshotRows.length) {
    if (!options.silent) {
      alert('No scan results are loaded yet.');
    }
    updateSavedScanStatus();
    return false;
  }

  const existing = getSavedScanResultsSnapshot();
  const merged = [];
  const seen = new Set();
  snapshotRows.forEach((row) => {
    const key = row._saved_scan_key;
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });
  if (existing?.rows?.length) {
    existing.rows.forEach((row) => {
      const key = getSavedScanResultKey(row) || row?._saved_scan_key;
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push({ ...row, _saved_scan_key: key });
    });
  }

  const selected = rows[currentIndex] || snapshotRows[0] || null;
  const payload = {
    savedAt: new Date().toISOString(),
    source: options.auto ? 'auto' : 'manual',
    selectedKey: selected ? getSavedScanResultKey(selected) : null,
    selectedIndex: Math.max(0, Number(currentIndex || 0)),
    rows: merged,
  };

  try {
    const jsonStr = JSON.stringify(payload);
    localStorage.setItem(SAVED_SCAN_RESULTS_STORAGE_KEY, jsonStr);
    updateSavedScanStatus();
    if (!options.silent) {
      const statusEl = document.getElementById('scan-status');
      const sizeMB = (jsonStr.length / (1024 * 1024)).toFixed(1);
      if (statusEl) statusEl.textContent = `Saved ${snapshotRows.length} result(s) (${sizeMB}MB). Duplicates overwritten.`;
    }
    return true;
  } catch (err) {
    // localStorage quota exceeded — strip heavy fields and retry with stubs
    console.warn('Full save failed, falling back to lightweight stubs:', err);
    const _HEAVY_KEYS = new Set([
      'chart_data', 'bars', 'ohlcv', 'candles', 'raw_bars',
      'swing_labels', 'swing_points', 'structure_legs', 'pattern_points',
      'annotations', 'drawing_data', 'aiAssessment', 'rule_checklist',
    ]);
    payload.rows = payload.rows.map((row) => {
      const slim = {};
      for (const k of Object.keys(row)) {
        if (_HEAVY_KEYS.has(k)) continue;
        const v = row[k];
        if (Array.isArray(v) && v.length > 50) continue;
        slim[k] = v;
      }
      slim.__savedScanStub = true;
      return slim;
    });
    try {
      localStorage.setItem(SAVED_SCAN_RESULTS_STORAGE_KEY, JSON.stringify(payload));
      updateSavedScanStatus();
      if (!options.silent) {
        const statusEl = document.getElementById('scan-status');
        if (statusEl) statusEl.textContent = `Saved ${snapshotRows.length} result(s) (lightweight mode — storage was full).`;
      }
      return true;
    } catch (err2) {
      console.warn('Lightweight save also failed:', err2);
      if (!options.silent) {
        alert(`Failed to save scan results: storage quota exceeded.`);
      }
      return false;
    }
  }
}

function clearSavedScanResults() {
  const snapshot = getSavedScanResultsSnapshot();
  if (!snapshot?.rows?.length) {
    updateSavedScanStatus();
    return;
  }
  if (!confirm('Clear all saved scan results?')) return;
  try {
    localStorage.removeItem(SAVED_SCAN_RESULTS_STORAGE_KEY);
  } catch {}
  updateSavedScanStatus();
  const statusEl = document.getElementById('scan-status');
  if (statusEl) statusEl.textContent = 'Saved scan results cleared.';
}

async function hydrateSavedScanCandidate(index) {
  const candidate = Array.isArray(candidates) ? candidates[index] : null;
  if (!candidate || !candidate.__savedScanStub) return candidate;

  const statusEl = document.getElementById('scan-status');
  const symbol = String(candidate.symbol || '').trim().toUpperCase();
  const pluginId = String(candidate._plugin_id || '').trim();
  const interval = String(candidate.interval || '').trim() || '1wk';
  const period = String(candidate.period || '').trim() || getDefaultPeriodForInterval(interval) || 'max';
  const timeframe = String(candidate.timeframe || '').trim() || getScanTimeframeFromInterval(interval);

  if (!symbol || !pluginId) {
    if (statusEl) statusEl.textContent = `Saved result for ${symbol || 'unknown symbol'} is missing scanner metadata.`;
    return null;
  }

  if (statusEl) statusEl.textContent = `Loading ${symbol} from saved scan results...`;
  const res = await fetch(`${API_URL}/api/candidates/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, pluginId, interval, period, timeframe }),
  });
  const data = await res.json();
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Failed to load ${symbol}`);
  }

  const found = normalizeScanCandidates(Array.isArray(data?.data?.candidates) ? data.data.candidates : [], pluginId);
  const desiredKey = candidate._saved_scan_key || getSavedScanResultKey(candidate);
  const hydrated = found.find((row) => getSavedScanResultKey(row) === desiredKey) || found[0] || null;
  if (!hydrated) {
    throw new Error(`No candidate payload returned for ${symbol}`);
  }

  const merged = {
    ...candidate,
    ...hydrated,
    __savedScanStub: false,
    _saved_scan_key: desiredKey || getSavedScanResultKey(hydrated),
  };
  candidates[index] = merged;
  return merged;
}

async function restoreSavedScanResults(options = {}) {
  const snapshot = getSavedScanResultsSnapshot();
  if (!snapshot?.rows?.length) {
    if (!options.silent) alert('No saved scan results are available.');
    updateSavedScanStatus();
    return false;
  }

  candidates = snapshot.rows.map((row, index) => ({
    ...row,
    id: row.id || row.candidate_id || row._saved_scan_key || `saved-${index}`,
    _saved_scan_key: row._saved_scan_key || getSavedScanResultKey(row),
  }));
  const desiredIndex = Math.max(0, Math.min(Number(snapshot.selectedIndex || 0), candidates.length - 1));
  currentIndex = desiredIndex;
  renderScanResults(candidates);

  const totalCountEl = document.getElementById('total-count');
  const currentIndexEl = document.getElementById('current-index');
  if (totalCountEl) totalCountEl.textContent = String(candidates.length);
  if (currentIndexEl) currentIndexEl.textContent = candidates.length ? String(currentIndex + 1) : '0';
  if (typeof updateCandidateNavButtons === 'function') updateCandidateNavButtons();
  updateSavedScanStatus();

  const statusEl = document.getElementById('scan-status');
  if (statusEl) {
    statusEl.textContent = `Restored ${candidates.length} saved result(s).`;
  }

  try {
    await selectCandidate(currentIndex);
  } catch (err) {
    console.error('Failed to load restored scan candidate:', err);
    if (statusEl) {
      statusEl.textContent = `Restored ${candidates.length} saved result(s). Click a row to load details.`;
    }
  }
  return true;
}

function normalizeScanCandidates(rawCandidates, pluginId) {
  const source = Array.isArray(rawCandidates) ? rawCandidates : [];
  return source.map((cand) => ({
    ...cand,
    id: cand.id || cand.candidate_id,
    symbol: cand.symbol || 'N/A',
    _plugin_id: pluginId,
    ...(_lastScanInsiderScreenMap.get(String(cand.symbol || '').trim().toUpperCase()) || {}),
  }));
}

function rankScanCandidates(rows) {
  const source = Array.isArray(rows) ? rows.slice() : [];
  return source.sort((a, b) => {
    const aMl = Number(a?.ml_confidence);
    const bMl = Number(b?.ml_confidence);
    const aMlOk = Number.isFinite(aMl);
    const bMlOk = Number.isFinite(bMl);
    if (aMlOk && bMlOk && bMl !== aMl) return bMl - aMl;
    if (aMlOk && !bMlOk) return -1;
    if (!aMlOk && bMlOk) return 1;
    return (Number(b?.score) || 0) - (Number(a?.score) || 0);
  });
}

function _mlClamp01(v, fallback = 0.5) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function _mlDefaultAiScoresFromCandidate(candidate) {
  const mlScores = candidate?.aiAssessment?.mlScores;
  if (mlScores) {
    return [
      _mlClamp01(mlScores.patternLikeness),
      _mlClamp01(mlScores.structuralClarity),
      _mlClamp01(mlScores.phaseCompleteness),
      _mlClamp01(mlScores.failureRisk),
      _mlClamp01(mlScores.entryQuality),
    ];
  }
  return [0.5, 0.5, 0.5, 0.5, 0.5];
}

function _buildMlFeatureVector(candidate) {
  const scannerVector = (typeof buildScannerVector === 'function')
    ? buildScannerVector(candidate)
    : [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const aiScores = _mlDefaultAiScoresFromCandidate(candidate);
  const aiValid = _mlClamp01(
    candidate?.ai_valid != null
      ? candidate.ai_valid
      : (candidate?.aiAssessment?.isValidPattern ? 1 : 0)
  );
  const aiConfidence = _mlClamp01(
    candidate?.ai_confidence != null
      ? candidate.ai_confidence
      : (candidate?.aiAssessment?.confidence != null
          ? Number(candidate.aiAssessment.confidence) / 100
          : (Number(candidate?.score) || 0.5))
  );
  return [
    ...scannerVector.map((x) => _mlClamp01(x)),
    ...aiScores.map((x) => _mlClamp01(x)),
    aiValid,
    aiConfidence,
  ];
}

async function scoreCandidatesWithML(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  try {
    if (typeof window.__mlPredictReady === 'undefined') {
      window.__mlPredictReady = null;
    }

    if (window.__mlPredictReady !== true) {
      const statusRes = await fetch(`${API_URL}/api/ml/status`);
      const statusData = await statusRes.json().catch(() => null);
      window.__mlPredictReady = !!(statusRes.ok && statusData?.success && statusData?.data?.ready);
    }

    if (!window.__mlPredictReady) {
      return rows;
    }

    const vectors = rows.map((c, idx) => ({
      id: String(c?.id ?? c?.candidate_id ?? idx),
      vector: _buildMlFeatureVector(c),
    }));

    const res = await fetch(`${API_URL}/api/ml/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors }),
    });
    if (res.status === 404) {
      window.__mlPredictReady = false;
      return rows;
    }
    const data = await res.json();
    if (!res.ok || !data?.success) return rows;

    const predictions = Array.isArray(data?.data?.predictions) ? data.data.predictions : [];
    const byId = new Map(predictions.map((p) => [String(p.id), p]));
    const enriched = rows.map((c, idx) => {
      const id = String(c?.id ?? c?.candidate_id ?? idx);
      const pred = byId.get(id);
      if (!pred) return c;
      return {
        ...c,
        ml_prediction: pred.prediction,
        ml_is_valid: !!pred.is_valid,
        ml_confidence: Number(pred.confidence),
        ml_confidence_pct: pred.confidence_pct,
        ml_explanation: pred.explanation,
      };
    });
    return rankScanCandidates(enriched);
  } catch (err) {
    window.__mlPredictReady = false;
    console.warn('ML scoring unavailable:', err);
    return rows;
  }
}

function applyPartialScanResults(rawCandidates, pluginId, options = {}) {
  const rows = rankScanCandidates(
    options.preNormalized
      ? (Array.isArray(rawCandidates) ? rawCandidates : [])
      : normalizeScanCandidates(rawCandidates, pluginId)
  );

  const previousRows = Array.isArray(candidates) ? candidates : [];
  const previousSelectedId = previousRows[currentIndex]?.id || null;
  const previousCount = previousRows.length;

  candidates = rows;
  renderScanResults(rows);

  if (rows.length > 0) {
    let nextIndex = 0;
    if (previousSelectedId) {
      const matched = rows.findIndex((row) => String(row.id || '') === String(previousSelectedId));
      if (matched >= 0) nextIndex = matched;
    }
    currentIndex = Math.max(0, Math.min(nextIndex, rows.length - 1));
    if (options.forceShow || previousCount === 0 || options.showActive) {
      showCandidate(currentIndex);
    }
  } else {
    currentIndex = 0;
    const panelEl = document.getElementById('candidate-info-panel');
    const detailsEl = document.getElementById('candidate-details');
    if (panelEl) panelEl.classList.add('hidden');
    if (detailsEl) detailsEl.classList.add('hidden');
  }

  const totalCountEl = document.getElementById('total-count');
  const currentIndexEl = document.getElementById('current-index');
  if (totalCountEl) totalCountEl.textContent = String(rows.length);
  if (currentIndexEl) currentIndexEl.textContent = rows.length ? String(currentIndex + 1) : '0';
  if (typeof updateCandidateNavButtons === 'function') updateCandidateNavButtons();
  updateSavedScanStatus();
}

function getIndicatorTypeFilter() {
  const typeEl = document.getElementById('scan-indicator-type');
  return String(typeEl ? typeEl.value : 'all').trim().toLowerCase() || 'all';
}

function isFundamentalSignalOption(item) {
  const haystack = [
    item?.pattern_id,
    item?.name,
    item?.category,
    item?.indicator_role,
    ...(Array.isArray(item?.search_tags) ? item.search_tags : []),
  ].join(' ').toLowerCase();
  return /\b(fundamental|valuation|dcf|earnings|revenue|cash flow|free_cash_flow|fcf|quality|survivability|roe|eps|sales|debt)\b/.test(haystack);
}

function scannerSignalFamily(item) {
  const artifactType = String(item?.artifact_type || 'indicator').toLowerCase();
  const composition = String(item?.composition || 'composite').toLowerCase();
  if (artifactType === 'pattern') return 'pattern';
  if (composition === 'composite') return 'composite';
  if (isFundamentalSignalOption(item)) return 'fundamental';
  return 'technical';
}

function indicatorMatchesType(item, typeFilter) {
  if (!typeFilter || typeFilter === 'all') return true;
  return scannerSignalFamily(item) === typeFilter;
}

function isScannerSignalCandidate(item) {
  const artifactType = String(item?.artifact_type || '').trim().toLowerCase();
  const composition = String(item?.composition || '').trim().toLowerCase();
  if (artifactType === 'strategy' || composition === 'strategy') return false;
  return artifactType === 'pattern' || composition === 'composite' || composition === 'primitive' || artifactType === 'indicator';
}

function renderIndicatorOptions() {
  const select = document.getElementById('scan-indicator-select');
  if (!select) return;

  const selectedBefore = String(select.value || '').trim();
  const typeFilter = getIndicatorTypeFilter();
  const curated = _scannerIndicatorOptions.some((item) => item.scanner_favorite === true)
    ? _scannerIndicatorOptions.filter((item) => item.scanner_favorite === true)
    : _scannerIndicatorOptions.slice();
  const filtered = curated.filter((item) => indicatorMatchesType(item, typeFilter));

  select.innerHTML = '<option value="">-- Select a signal --</option>';

  const byType = { technical: [], fundamental: [], pattern: [], composite: [] };
  filtered.forEach((item) => {
    byType[scannerSignalFamily(item)].push(item);
  });

  const groups = [
    { key: 'technical', label: 'Technical Primitives', items: byType.technical },
    { key: 'fundamental', label: 'Fundamental Primitives', items: byType.fundamental },
    { key: 'pattern', label: 'Pattern Scanners', items: byType.pattern },
    { key: 'composite', label: 'Composites', items: byType.composite },
  ];

  groups.forEach((group) => {
    if (group.items.length === 0) return;
    
    const items = group.items.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    
    // Only create optgroup if we have multiple groups
    const hasMultipleGroups = groups.filter(g => g.items.length > 0).length > 1;
    
    if (hasMultipleGroups) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.label;
      items.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.pattern_id;
        option.textContent = item.name || item.pattern_id;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    } else {
      items.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.pattern_id;
        option.textContent = item.name || item.pattern_id;
        select.appendChild(option);
      });
    }
  });

  const optionExists = Array.from(select.querySelectorAll('option')).some((opt) => opt.value === selectedBefore);
  if (selectedBefore && optionExists) {
    select.value = selectedBefore;
  } else if (selectedBefore) {
    select.value = '';
  }

  if (!filtered.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No matching signals';
    select.appendChild(option);
    select.value = '';
  }
}

function handleScanIndicatorTypeChange() {
  renderIndicatorOptions();
}

async function loadIndicators() {
  const select = document.getElementById('scan-indicator-select');
  if (!select) return;

  try {
    const res = await fetch(`${API_URL}/api/plugins/scanner/options`);
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.data)) return;

    _scannerIndicatorOptions = data.data
      .filter((item) => item && typeof item === 'object' && item.pattern_id)
      .map((item) => ({
        pattern_id: String(item.pattern_id || '').trim(),
        name: String(item.name || item.pattern_id || '').trim(),
        category: String(item.category || 'other').trim() || 'other',
        pattern_type: String(item.pattern_type || item.pattern_id || '').trim(),
        status: String(item.status || 'unknown').trim() || 'unknown',
        artifact_type: String(item.artifact_type || 'indicator').trim() || 'indicator',
        composition: String(item.composition || 'composite').trim() || 'composite',
        indicator_role: String(item.indicator_role || '').trim(),
        search_tags: Array.isArray(item.search_tags) ? item.search_tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [],
        scanner_favorite: item.scanner_favorite === true,
      }))
      .filter((item) => !!item.pattern_id && isScannerSignalCandidate(item));

    const typeEl = document.getElementById('scan-indicator-type');
    if (typeEl && !typeEl.dataset.bound) {
      typeEl.addEventListener('change', handleScanIndicatorTypeChange);
      typeEl.dataset.bound = '1';
    }

    renderIndicatorOptions();
  } catch (err) {
    console.error('Failed to load indicators:', err);
  }
}

// ── Symbol library (fetched from backend/data/symbols.json) ──────────────

let _symbolLibrary = null;
let _universePriceSnapshot = null;
let _lastScanInsiderScreenMap = new Map();

async function loadSymbolLibrary(forceRefresh = false) {
  if (_symbolLibrary && !forceRefresh) return _symbolLibrary;
  try {
    const requestUrl = forceRefresh
      ? `${API_URL}/api/candidates/symbols?refresh=${Date.now()}`
      : `${API_URL}/api/candidates/symbols`;
    const res = await fetch(requestUrl, { cache: 'no-store' });
    const json = await res.json();
    if (json.success && json.data) {
      _symbolLibrary = json.data;
      const updateSelectCounts = (selectId) => {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        for (const opt of sel.options) {
          const key = opt.value;
          if (!key || key === 'any') continue;
          const symbols = key === 'all' ? _symbolLibrary.all || [] : _symbolLibrary[key] || [];
          const count = symbols.length;
          const baseName = opt.textContent.replace(/\s*\(\d+\)$/, '');
          opt.textContent = `${baseName} (${count})`;
        }
      };
      updateSelectCounts('scan-asset-class');
      updateSelectCounts('scan-secondary-filter');
      console.log('Symbol library loaded:', Object.keys(_symbolLibrary).filter(k => k !== 'description' && k !== 'all').map(k => `${k}: ${(_symbolLibrary[k] || []).length}`).join(', '));
      populateSymbolSuggestions();
      return _symbolLibrary;
    }
  } catch (err) {
    console.error('Failed to load symbol library:', err);
  }
  _symbolLibrary = {
    indices: ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI'],
    sectors: ['XLF', 'XLE', 'XLK', 'XLV', 'XLI'],
    forex: [],
    optionable: [],
    smallcaps: [],
    largecaps: [],
    undervalued: [],
    fairvalue: [],
    overvalued: [],
    socialbullish: [],
    socialbearish: [],
    socialhot: [],
    socialrising: [],
    socialconfirmed: [],
    all: ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'XLF', 'XLE', 'XLK', 'XLV', 'XLI'],
  };
  return _symbolLibrary;
}

async function reloadSymbolLibrary() {
  const button = document.getElementById('btn-reload-symbol-library');
  const status = document.getElementById('scan-status');
  const previousLabel = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Reloading...';
  }
  if (status) status.textContent = 'Refreshing symbol library...';
  try {
    await loadSymbolLibrary(true);
    if (status) {
      const count = Array.isArray(_symbolLibrary?.all) ? _symbolLibrary.all.length : 0;
      status.textContent = `Symbol library refreshed (${count} symbols).`;
    }
  } catch (err) {
    console.error('Failed to refresh symbol library:', err);
    if (status) status.textContent = 'Failed to refresh symbol library.';
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousLabel || 'Reload Symbols';
    }
  }
}

async function loadUniversePriceSnapshot() {
  if (_universePriceSnapshot) return _universePriceSnapshot;
  const res = await fetch(`${API_URL}/api/universe/prices`);
  const json = await res.json();
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || 'Failed to load universe prices');
  }
  _universePriceSnapshot = json.data?.prices || {};
  return _universePriceSnapshot;
}

function getScanInsiderControls() {
  const rankEl = document.getElementById('scan-universe-rank');
  const filterEl = document.getElementById('scan-insider-filter');
  return {
    rank: String(rankEl ? rankEl.value : 'default').trim().toLowerCase() || 'default',
    filter: String(filterEl ? filterEl.value : 'all').trim().toLowerCase() || 'all',
  };
}

function normalizeInsiderScreenRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  return source.map((row) => ({
    ...row,
    symbol: String(row?.symbol || '').trim().toUpperCase(),
    insider_buy_score: Number(row?.insider_buy_score || 0),
    recent_buy_count: Number(row?.recent_buy_count || 0),
    recent_sell_count: Number(row?.recent_sell_count || 0),
    recent_buy_value: Number.isFinite(Number(row?.recent_buy_value)) ? Number(row.recent_buy_value) : null,
    recent_sell_value: Number.isFinite(Number(row?.recent_sell_value)) ? Number(row.recent_sell_value) : null,
    has_recent_insider_buying: Boolean(row?.has_recent_insider_buying),
    is_net_insider_buying: Boolean(row?.is_net_insider_buying),
    insider_buy_signal: String(row?.insider_buy_signal || 'quiet').trim().toLowerCase() || 'quiet',
  })).filter((row) => !!row.symbol);
}

async function applyInsiderScreenToSymbols(symbols, statusEl) {
  const { rank, filter } = getScanInsiderControls();
  _lastScanInsiderScreenMap = new Map();
  if ((!rank || rank === 'default') && (!filter || filter === 'all')) {
    return symbols;
  }
  if (!Array.isArray(symbols) || !symbols.length) {
    return [];
  }
  if (symbols.length > 50) {
    throw new Error('Insider sort/filter is limited to 50 symbols for stability. Reduce Limit Symbols first.');
  }

  if (statusEl) {
    statusEl.textContent = `Loading insider activity for ${symbols.length} symbols...`;
  }

  const res = await fetch(`${API_URL}/api/fundamentals/screen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  });
  const json = await res.json();
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || 'Failed to load insider activity');
  }

  let rows = normalizeInsiderScreenRows(json?.data?.rows);
  if (filter === 'recent_buy') {
    rows = rows.filter((row) => row.has_recent_insider_buying);
  } else if (filter === 'net_buying') {
    rows = rows.filter((row) => row.is_net_insider_buying);
  }

  if (rank === 'insider_buy_score') {
    rows.sort((a, b) => {
      const scoreDiff = (Number(b.insider_buy_score) || 0) - (Number(a.insider_buy_score) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const buyValueDiff = (Number(b.recent_buy_value) || 0) - (Number(a.recent_buy_value) || 0);
      if (buyValueDiff !== 0) return buyValueDiff;
      return (Number(b.recent_buy_count) || 0) - (Number(a.recent_buy_count) || 0);
    });
  }

  rows.forEach((row) => {
    _lastScanInsiderScreenMap.set(row.symbol, row);
  });

  if (statusEl) {
    if (filter === 'recent_buy') {
      statusEl.textContent = `Insider filter kept ${rows.length}/${symbols.length} symbols with recent insider buys.`;
    } else if (filter === 'net_buying') {
      statusEl.textContent = `Insider filter kept ${rows.length}/${symbols.length} symbols with net insider buying.`;
    } else {
      const buyCount = rows.filter((row) => row.has_recent_insider_buying).length;
      statusEl.textContent = `Loaded insider activity for ${symbols.length} symbols. ${buyCount} show recent buying.`;
    }
  }

  return rows.map((row) => row.symbol);
}

function populateSymbolSuggestions() {
  const datalist = document.getElementById('symbol-suggestions');
  if (!datalist || !_symbolLibrary) return;
  
  const allSymbols = _symbolLibrary.all || [];
  datalist.innerHTML = '';
  
  allSymbols.forEach((symbol) => {
    const option = document.createElement('option');
    option.value = symbol;
    datalist.appendChild(option);
  });
}

function normalizeSingleSymbol(raw) {
  let s = raw.trim().toUpperCase();
  if (!s) return '';
  const cryptoBases = ['BTC','ETH','SOL','XRP','ADA','DOGE','AVAX','DOT','LINK','MATIC','UNI','ATOM','LTC','BCH','NEAR','APT'];
  const forexCompact = s.replace(/[\s\/\-_]/g, '');
  if (/^[A-Z]{6}(=X)?$/.test(forexCompact)) {
    const core = forexCompact.replace(/=X$/, '');
    return `${core}=X`;
  }
  const cleaned = s.replace(/[\s\/]+/g, '-');
  for (const base of cryptoBases) {
    if (cleaned === base || cleaned === base + 'USD' || cleaned === base + '-USD') {
      return base + '-USD';
    }
  }
  return cleaned;
}

function getScanPriceFilters() {
  const minEl = document.getElementById('scan-min-price');
  const maxEl = document.getElementById('scan-max-price');
  const min = minEl && String(minEl.value || '').trim() ? Number(minEl.value) : null;
  const max = maxEl && String(maxEl.value || '').trim() ? Number(maxEl.value) : null;

  return {
    min: Number.isFinite(min) ? Number(min) : null,
    max: Number.isFinite(max) ? Number(max) : null,
  };
}

async function getScanSymbols(statusEl) {
  // Check for single symbol override
  const singleSymbolEl = document.getElementById('scan-single-symbol');
  const singleSymbol = normalizeSingleSymbol(singleSymbolEl ? String(singleSymbolEl.value || '') : '');
  if (singleSymbol) {
    _lastScanInsiderScreenMap = new Map();
    return [singleSymbol];
  }

  // Get symbols from asset class
  const assetClassEl = document.getElementById('scan-asset-class');
  const assetClass = assetClassEl ? assetClassEl.value : 'all';
  const criteriaEl = document.getElementById('scan-secondary-filter');
  const criteria = criteriaEl ? String(criteriaEl.value || 'any').trim().toLowerCase() : 'any';
  if (!_symbolLibrary) return [];
  let symbols = (_symbolLibrary[assetClass] || _symbolLibrary.all || []).slice();

  if (criteria && criteria !== 'any') {
    const criteriaSet = new Set((_symbolLibrary[criteria] || []).slice());
    symbols = symbols.filter((symbol) => criteriaSet.has(symbol));
  }

  const { min, max } = getScanPriceFilters();
  if (min != null || max != null) {
    const priceSnapshot = await loadUniversePriceSnapshot();
    symbols = symbols.filter((symbol) => {
      const price = Number(priceSnapshot?.[symbol]?.last_close);
      if (!Number.isFinite(price)) return false;
      if (min != null && price < min) return false;
      if (max != null && price > max) return false;
      return true;
    });
  }

  // Apply limit if specified
  const limitEl = document.getElementById('scan-limit');
  const limit = limitEl && limitEl.value ? parseInt(limitEl.value, 10) : 0;
  if (limit > 0 && limit < symbols.length) {
    symbols = symbols.slice(0, limit);
  }

  return applyInsiderScreenToSymbols(symbols, statusEl);
}

function getScanTimeframeFromInterval(interval) {
  if (interval === '1h') return '1h';
  if (interval === '4h') return '4h';
  if (interval === '1d') return 'D';
  if (interval === '1wk') return 'W';
  return 'M';
}

// ── Browse mode: load an entire asset class without running an indicator ──
//
// Builds a list of bare candidate stubs from the selected asset class so the
// user can pan through them with ←/→ (or the prev/next buttons). Each chart
// is fetched on demand by drawPatternChart when it sees __browseStub: true.
async function browseAssetClass() {
  const statusEl = document.getElementById('scan-status');
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  if (_activeScanJobId) {
    alert('A scan is currently running. Cancel it first.');
    return;
  }

  setStatus('Loading symbol library…');
  try {
    await loadSymbolLibrary();
  } catch (err) {
    console.error('browseAssetClass: failed to load symbol library', err);
    setStatus('Failed to load symbol library');
    return;
  }
  if (!_symbolLibrary) {
    setStatus('Symbol library unavailable');
    return;
  }

  const assetClassEl = document.getElementById('scan-asset-class');
  const assetClass = assetClassEl ? assetClassEl.value : 'all';
  const assetLabel = assetClassEl?.options[assetClassEl.selectedIndex]?.text?.replace(/\s*\(\d+\)$/, '') || assetClass;

  const criteriaEl = document.getElementById('scan-secondary-filter');
  const criteria = criteriaEl ? String(criteriaEl.value || 'any').trim().toLowerCase() : 'any';

  let symbols = (_symbolLibrary[assetClass] || _symbolLibrary.all || []).slice();
  if (criteria && criteria !== 'any') {
    const criteriaSet = new Set((_symbolLibrary[criteria] || []).slice());
    symbols = symbols.filter((s) => criteriaSet.has(s));
  }

  // Optional price filters (reuse the existing inputs).
  const { min, max } = getScanPriceFilters();
  if (min != null || max != null) {
    setStatus('Applying price filters…');
    try {
      const priceSnapshot = await loadUniversePriceSnapshot();
      symbols = symbols.filter((s) => {
        const price = Number(priceSnapshot?.[s]?.last_close);
        if (!Number.isFinite(price)) return false;
        if (min != null && price < min) return false;
        if (max != null && price > max) return false;
        return true;
      });
    } catch (err) {
      console.warn('browseAssetClass: price filter snapshot failed', err);
    }
  }

  // Optional limit (reuse existing input).
  const limitEl = document.getElementById('scan-limit');
  const limit = limitEl && limitEl.value ? parseInt(limitEl.value, 10) : 0;
  if (limit > 0 && limit < symbols.length) {
    symbols = symbols.slice(0, limit);
  }

  if (symbols.length === 0) {
    setStatus(`No symbols found for "${assetLabel}"`);
    return;
  }

  // Soft cap for very large asset classes so the UI stays responsive. The
  // actual cost per pan is just one OHLCV fetch, so we mainly want to keep the
  // results list manageable.
  const SOFT_CAP = 500;
  if (symbols.length > SOFT_CAP) {
    const ok = confirm(
      `${assetLabel} contains ${symbols.length} symbols. Browse mode loads them all into memory `
      + `(charts are fetched on demand as you pan).\n\nLoad all of them anyway?`
    );
    if (!ok) {
      setStatus('Browse cancelled');
      return;
    }
  }

  // Resolve the timeframe for the candidate stubs from the existing interval
  // dropdown so the chart router uses the right OHLCV endpoint.
  const intervalEl = document.getElementById('scan-interval');
  const interval = intervalEl ? intervalEl.value : '1wk';
  const timeframe = getScanTimeframeFromInterval(interval);

  candidates = symbols.map((symbol) => ({
    symbol,
    timeframe,
    interval,
    __browseStub: true,
    score: 0,
  }));
  currentIndex = 0;

  // Mirror the bookkeeping that runScan/applyPartialScanResults do so the
  // existing UI surfaces (count, list, prev/next nav) reflect the new set.
  try { renderScanResults(candidates); } catch (e) { console.warn('browseAssetClass: renderScanResults failed', e); }
  try {
    const totalEl = document.getElementById('total-count');
    if (totalEl) totalEl.textContent = String(candidates.length);
    const idxEl = document.getElementById('current-index');
    if (idxEl) idxEl.textContent = '1';
  } catch (e) {}

  setStatus(`Browsing ${candidates.length} ${assetLabel} symbols — use ←/→ to pan`);
  try {
    await selectCandidate(0);
  } catch (err) {
    console.error('browseAssetClass: failed to load first chart', err);
    setStatus(`Loaded ${candidates.length} symbols, but first chart failed: ${err.message || err}`);
  }
}
window.browseAssetClass = browseAssetClass;

function getDefaultPeriodForInterval(interval) {
  if (interval === '1h') return '60d';
  return null;
}

// ── Run scan ─────────────────────────────────────────────────────────────

async function runScan() {
  if (_activeScanJobId) {
    alert('A scan is already running. Cancel it first or wait for completion.');
    return;
  }

  const indicatorSelect = document.getElementById('scan-indicator-select');
  const pluginId = indicatorSelect ? String(indicatorSelect.value || '').trim() : '';
  if (!pluginId) { alert('Please select a signal.'); return; }

  const periodEl = document.getElementById('scan-period');
  const intervalEl = document.getElementById('scan-interval');
  const interval = intervalEl ? intervalEl.value : '1wk';
  const autoperiod = getDefaultPeriodForInterval(interval);
  const period = autoperiod || (periodEl ? periodEl.value : 'max');
  const timeframe = getScanTimeframeFromInterval(interval);
  const swingEpsilon = (typeof getScannerSwingEpsilon === 'function')
    ? Number(getScannerSwingEpsilon())
    : undefined;

  const { min: minPrice, max: maxPrice } = getScanPriceFilters();
  if (minPrice != null && minPrice < 0) { alert('Min Price must be zero or greater.'); return; }
  if (maxPrice != null && maxPrice < 0) { alert('Max Price must be zero or greater.'); return; }
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    alert('Min Price cannot be greater than Max Price.');
    return;
  }

  const statusEl = document.getElementById('scan-status');
  if (!_symbolLibrary) await loadSymbolLibrary();
  let symbols = [];
  try {
    symbols = await getScanSymbols(statusEl);
  } catch (err) {
    alert(`Unable to apply scan filters: ${err.message || 'Unknown error'}`);
    return;
  }
  if (!symbols.length) { alert('No symbols to scan. Check your symbol library and price filters.'); return; }

  // Reset previous scan output so first live hit from this run immediately owns the chart.
  candidates = [];
  currentIndex = 0;
  renderScanResults([]);
  const resetTotalCountEl = document.getElementById('total-count');
  const resetCurrentIndexEl = document.getElementById('current-index');
  const panelEl = document.getElementById('candidate-info-panel');
  const detailsEl = document.getElementById('candidate-details');
  if (resetTotalCountEl) resetTotalCountEl.textContent = '0';
  if (resetCurrentIndexEl) resetCurrentIndexEl.textContent = '0';
  if (panelEl) panelEl.classList.add('hidden');
  if (detailsEl) detailsEl.classList.add('hidden');
  if (typeof updateCandidateNavButtons === 'function') updateCandidateNavButtons();

  const btnEl = document.getElementById('btn-scan');
  const progressDiv = document.getElementById('batch-progress');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const progressCount = document.getElementById('progress-count');
  const cancelBtn = document.getElementById('btn-scan-cancel');

  if (statusEl) statusEl.textContent = 'Scanning...';
  if (btnEl) btnEl.disabled = true;
  if (progressDiv) progressDiv.classList.remove('hidden');
  if (progressBar) progressBar.style.width = '0%';
  if (progressCount) progressCount.textContent = `0/${symbols.length}`;
  if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.disabled = false; }

  const results = [];
  let finalJobStatus = 'completed';
  let finalCompletedSymbols = symbols.length;
  let lastPartialCount = 0;
  try {
    if (progressText) progressText.textContent = `Queueing batch scan (${symbols.length} symbols)...`;
    if (progressCount) progressCount.textContent = `0/${symbols.length}`;
    if (progressBar) progressBar.style.width = '2%';

    const startRes = await fetch(`${API_URL}/api/candidates/scan-batch/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols,
        pluginId,
        interval,
        period,
        timeframe,
        swingEpsilon: Number.isFinite(swingEpsilon) ? swingEpsilon : undefined,
        scanScope: 'research',
      }),
    });

    const startData = await startRes.json();
    if (!startRes.ok || !startData?.success || !startData?.data?.job_id) {
      throw new Error(startData?.error || `HTTP ${startRes.status}`);
    }
    const jobId = String(startData.data.job_id);
    _activeScanJobId = jobId;
    persistActiveScanJob({
      jobId,
      totalSymbols: symbols.length,
      pluginId,
      interval,
      period,
      timeframe,
      progress: 0.02,
      completed: 0,
      stage: 'queued',
      detail: `Queued batch scan (${symbols.length} symbols)`,
    });

    const data = await pollBatchScanJob(jobId, symbols.length, {
      progressText,
      progressCount,
      progressBar,
    }, (job, pct) => {
      persistActiveScanJob({
        jobId,
        totalSymbols: Number(job.total_symbols || symbols.length || 0),
        pluginId,
        interval,
        period,
        timeframe,
        progress: Number.isFinite(pct) ? pct / 100 : Number(job.progress || 0),
        completed: Number(job.completed_symbols || 0),
        stage: String(job.stage || 'running'),
        detail: String(job.detail || ''),
      });

      const partialCandidates = Array.isArray(job?.result?.candidates) ? job.result.candidates : [];
      if (partialCandidates.length > lastPartialCount) {
        lastPartialCount = partialCandidates.length;
        applyPartialScanResults(partialCandidates, pluginId, { forceShow: lastPartialCount === 1 });
        if (statusEl) {
          const completed = Number(job.completed_symbols || 0);
          const total = Number(job.total_symbols || symbols.length || 0);
          statusEl.textContent = `Scanning... ${partialCandidates.length} candidate(s) so far (${completed}/${total} symbols)`;
        }
      }
    });

    const batchCandidates = Array.isArray(data?.data?.result?.candidates)
      ? data.data.result.candidates
      : (Array.isArray(data?.data?.candidates) ? data.data.candidates : []);
    normalizeScanCandidates(batchCandidates, pluginId).forEach((cand) => results.push(cand));

    finalJobStatus = String(data?.data?.status || 'completed');
    finalCompletedSymbols = Number(data?.data?.completed_symbols || symbols.length);
    if (finalJobStatus === 'cancelled') {
      const total = Number(data?.data?.total_symbols || symbols.length);
      if (statusEl) {
        statusEl.textContent = `Scan cancelled at ${finalCompletedSymbols}/${total} symbols. Loaded ${results.length} candidate(s).`;
      }
    }
  } catch (err) {
    console.error('Batch scan failed:', err);
    if (statusEl) statusEl.textContent = `Scan failed: ${err.message || 'Unknown error'}`;
    if (btnEl) btnEl.disabled = false;
    if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.classList.add('hidden'); }
    if (progressDiv) { setTimeout(() => progressDiv.classList.add('hidden'), 1200); }
    _activeScanJobId = null;
    clearPersistedActiveScanJob();
    return;
  }

  let finalRows = normalizeScanCandidates(results, pluginId);
  if (statusEl && finalRows.length > 0) statusEl.textContent = `Scored ${finalRows.length} candidates. Running ML ranking...`;
  finalRows = await scoreCandidatesWithML(finalRows);
  applyPartialScanResults(finalRows, pluginId, { forceShow: true, preNormalized: true });
  saveCurrentScanResults({ silent: true, auto: true });

  if (statusEl && finalJobStatus !== 'cancelled') {
    statusEl.textContent = `Found ${results.length} candidate(s) across ${finalCompletedSymbols} scanned symbol(s)`;
  }
  if (btnEl) btnEl.disabled = false;
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.classList.add('hidden'); }
  if (progressDiv) { setTimeout(() => progressDiv.classList.add('hidden'), 1200); }
  _activeScanJobId = null;
  clearPersistedActiveScanJob();

  const totalCountEl = document.getElementById('total-count');
  const currentIndexEl = document.getElementById('current-index');
  if (totalCountEl) totalCountEl.textContent = String(results.length);
  if (currentIndexEl) currentIndexEl.textContent = results.length ? String(currentIndex + 1) : '0';
  if (typeof updateCandidateNavButtons === 'function') updateCandidateNavButtons();
}

async function runBatchScan() { return runScan(); }

async function pollBatchScanJob(jobId, totalSymbols, ui, onUpdate) {
  const startedAt = Date.now();
  const timeoutMs = 60 * 60 * 1000; // 1 hour hard timeout

  while (true) {
    const res = await fetch(`${API_URL}/api/candidates/scan-batch/job/${encodeURIComponent(jobId)}`);
    const payload = await res.json();
    if (!res.ok || !payload?.success || !payload?.data) {
      throw new Error(payload?.error || `Failed to poll scan job ${jobId}`);
    }

    const job = payload.data;
    const completed = Number(job.completed_symbols || 0);
    const total = Number(job.total_symbols || totalSymbols || 0);
    const pct = Math.max(0, Math.min(100, Math.round((Number(job.progress || 0)) * 100)));

    if (ui.progressText) {
      const stage = String(job.stage || 'running').replaceAll('_', ' ');
      const detail = job.detail ? ` - ${job.detail}` : '';
      ui.progressText.textContent = `${stage}${detail}`;
    }
    if (ui.progressCount) {
      ui.progressCount.textContent = `${completed}/${total || totalSymbols}`;
    }
    if (ui.progressBar) {
      ui.progressBar.style.width = `${pct}%`;
    }

    if (typeof onUpdate === 'function') {
      try { onUpdate(job, pct); } catch (err) { console.warn('scan job update callback failed:', err); }
    }

    if (job.status === 'completed') return payload;
    if (job.status === 'cancelled') return payload;
    if (job.status === 'failed') {
      throw new Error(job.error || 'Batch scan job failed');
    }
    if ((Date.now() - startedAt) > timeoutMs) {
      throw new Error('Batch scan timed out');
    }

    await new Promise((resolve) => setTimeout(resolve, 900));
  }
}

async function cancelActiveScan() {
  const statusEl = document.getElementById('scan-status');
  const cancelBtn = document.getElementById('btn-scan-cancel');

  if (!_activeScanJobId) return;

  try {
    if (cancelBtn) cancelBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Cancelling scan...';
    const persisted = getPersistedActiveScanJob();
    if (persisted?.jobId) {
      persistActiveScanJob({
        ...persisted,
        stage: 'cancelling',
        detail: 'Cancelling scan...',
      });
    }
    await fetch(`${API_URL}/api/candidates/scan-batch/job/${encodeURIComponent(_activeScanJobId)}/cancel`, {
      method: 'POST',
    });
  } catch (err) {
    console.error('Failed to cancel scan job:', err);
    if (statusEl) statusEl.textContent = `Cancel request failed: ${err.message || 'Unknown error'}`;
  }
}

async function resumeActiveScanIfNeeded() {
  if (_activeScanJobId) return;

  const persisted = getPersistedActiveScanJob();
  if (!persisted || !persisted.jobId) return;

  const jobId = String(persisted.jobId || '').trim();
  if (!jobId) return;

  const totalSymbols = Number(persisted.totalSymbols || 0);
  const statusEl = document.getElementById('scan-status');
  const btnEl = document.getElementById('btn-scan');
  const progressDiv = document.getElementById('batch-progress');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const progressCount = document.getElementById('progress-count');
  const cancelBtn = document.getElementById('btn-scan-cancel');

  _activeScanJobId = jobId;
  if (statusEl) statusEl.textContent = 'Resuming scan...';
  if (btnEl) btnEl.disabled = true;
  if (progressDiv) progressDiv.classList.remove('hidden');
  if (cancelBtn) { cancelBtn.classList.remove('hidden'); cancelBtn.disabled = false; }

  const persistedPct = Math.max(0, Math.min(100, Math.round(Number(persisted.progress || 0) * 100)));
  const persistedCompleted = Number(persisted.completed || 0);
  const persistedStage = String(persisted.stage || 'running').replaceAll('_', ' ');
  const persistedDetail = String(persisted.detail || '').trim();
  if (progressText) progressText.textContent = `${persistedStage}${persistedDetail ? ` - ${persistedDetail}` : ''}`;
  if (progressCount) progressCount.textContent = `${persistedCompleted}/${totalSymbols || 0}`;
  if (progressBar) progressBar.style.width = `${persistedPct}%`;

  try {
    let lastPartialCount = 0;
    const data = await pollBatchScanJob(jobId, totalSymbols, {
      progressText,
      progressCount,
      progressBar,
    }, (job, pct) => {
      persistActiveScanJob({
        ...persisted,
        jobId,
        totalSymbols: Number(job.total_symbols || totalSymbols || 0),
        progress: Number.isFinite(pct) ? pct / 100 : Number(job.progress || 0),
        completed: Number(job.completed_symbols || 0),
        stage: String(job.stage || 'running'),
        detail: String(job.detail || ''),
      });

      const pluginId = String(persisted.pluginId || '').trim();
      const partialCandidates = Array.isArray(job?.result?.candidates) ? job.result.candidates : [];
      if (partialCandidates.length > lastPartialCount) {
        lastPartialCount = partialCandidates.length;
        applyPartialScanResults(partialCandidates, pluginId, { showActive: true });
      }
    });

    const pluginId = String(data?.data?.request?.pluginId || persisted.pluginId || '').trim();
    const batchCandidates = Array.isArray(data?.data?.result?.candidates) ? data.data.result.candidates : [];
    let results = normalizeScanCandidates(batchCandidates, pluginId);
    results = await scoreCandidatesWithML(results);
    applyPartialScanResults(results, pluginId, { forceShow: true, preNormalized: true });

    const finalJobStatus = String(data?.data?.status || 'completed');
    const finalCompletedSymbols = Number(data?.data?.completed_symbols || totalSymbols || 0);
    if (statusEl) {
      if (finalJobStatus === 'cancelled') {
        const total = Number(data?.data?.total_symbols || totalSymbols || 0);
        statusEl.textContent = `Scan cancelled at ${finalCompletedSymbols}/${total} symbols. Loaded ${results.length} candidate(s).`;
      } else {
        statusEl.textContent = `Found ${results.length} candidate(s) across ${finalCompletedSymbols} scanned symbol(s)`;
      }
    }
    if (btnEl) btnEl.disabled = false;
    if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.classList.add('hidden'); }
    if (progressDiv) { setTimeout(() => progressDiv.classList.add('hidden'), 1200); }
    _activeScanJobId = null;
    clearPersistedActiveScanJob();

    const totalCountEl = document.getElementById('total-count');
    const currentIndexEl = document.getElementById('current-index');
    if (totalCountEl) totalCountEl.textContent = String(results.length);
    if (currentIndexEl) currentIndexEl.textContent = results.length ? String(currentIndex + 1) : '0';
    if (typeof updateCandidateNavButtons === 'function') updateCandidateNavButtons();
  } catch (err) {
    console.error('Failed to resume scan:', err);
    const msg = String(err?.message || '');
    if (statusEl) {
      statusEl.textContent = msg.toLowerCase().includes('not found')
        ? 'Previous scan job no longer exists. Start a new scan.'
        : `Failed to resume scan: ${msg || 'Unknown error'}`;
    }
    if (btnEl) btnEl.disabled = false;
    if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.classList.add('hidden'); }
    if (progressDiv) progressDiv.classList.add('hidden');
    _activeScanJobId = null;
    clearPersistedActiveScanJob();
  }
}

function renderScanResults(rows) {
  const panel = document.getElementById('scan-results-panel');
  const list = document.getElementById('scan-results-list');
  const count = document.getElementById('scan-results-count');
  if (!panel || !list || !count) return;

  count.textContent = `${rows.length} candidate${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) { panel.classList.add('hidden'); list.innerHTML = ''; return; }

  panel.classList.remove('hidden');

  const gridCols = 'grid-template-columns:70px 120px 82px 70px 70px 80px 90px 100px 80px 100px 90px 32px;';
  const headerHtml = `
    <div style="display:grid;${gridCols}gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--color-border);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-text-muted);">
      <span>Symbol</span><span>Type</span><span>State</span><span>Score</span><span>ML</span><span>Status</span><span>Insider</span><span>Trend</span><span>Zone</span><span>Date</span><span></span><span></span>
    </div>`;

  const rowsHtml = rows.map((c, i) => {
    const score = Number(c.score || 0).toFixed(2);
    const entryLabel = c.candidate_actionability_label || (c.entry_ready ? 'Entry Ready' : 'Watch');
    const entryColor = c.candidate_actionability === 'context_only'
      ? 'color:var(--color-text-muted);'
      : c.candidate_actionability === 'entry_ready'
        ? 'color:var(--color-positive,#4ade80);font-weight:700;'
        : 'color:#fcd34d;font-weight:600;';
    const endDate = c.pattern_end_date || (c.created_at ? String(c.created_at).slice(0, 10) : '\u2014');
    const patternName = c.candidate_role_label || c.pattern_type || c._plugin_id || 'indicator';
    const signalState = String(c.state || c.signal_state || c.composite_state || c.current_state || '').trim();
    const stateText = signalState || '\u2014';
    const mlConfidence = Number(c.ml_confidence);
    const mlText = Number.isFinite(mlConfidence) ? `${(mlConfidence * 100).toFixed(0)}%` : '—';
    const mlColor = Number.isFinite(mlConfidence)
      ? (mlConfidence >= 0.7 ? 'color:#4ade80;' : mlConfidence >= 0.5 ? 'color:#facc15;' : 'color:#f87171;')
      : 'color:var(--color-text-muted);';
    const swing = c.swing_structure || {};
    const trend = swing.trend_alignment || swing.primary_trend || c.trend || '\u2014';
    const trendColor = trend === 'ALIGNED' ? 'color:#4ade80;' : trend === 'CONFLICTING' ? 'color:#f87171;' : '';
    const buyZone = swing.in_buy_zone ? 'BUY ZONE' : (swing.status || '\u2014');
    const buyZoneColor = swing.in_buy_zone ? 'color:#4ade80;font-weight:700;' : '';
    const insiderSignal = String(c.insider_buy_signal || '').toLowerCase();
    const insiderScore = Number(c.insider_buy_score);
    const edgarCluster = Boolean(c.edgar_cluster_alert);
    const edgarCsuite = Boolean(c.edgar_csuite_purchase);
    const edgarSource = String(c.data_source || '').includes('edgar');
    let insiderText = insiderSignal === 'buying'
      ? `BUY ${Number.isFinite(insiderScore) ? insiderScore.toFixed(0) : ''}`.trim()
      : insiderSignal === 'selling'
        ? 'SELLING'
        : insiderSignal === 'mixed'
          ? 'MIXED'
          : '\u2014';
    if (edgarCluster) insiderText = '\u26A0 ' + insiderText;
    if (edgarCsuite && insiderSignal === 'buying') insiderText += ' C';
    const insiderColor = insiderSignal === 'buying'
      ? (edgarCluster ? 'color:#22d3ee;font-weight:700;' : 'color:#4ade80;font-weight:700;')
      : insiderSignal === 'selling'
        ? 'color:#f87171;font-weight:600;'
        : insiderSignal === 'mixed'
          ? 'color:#facc15;font-weight:600;'
          : 'color:var(--color-text-muted);';
    const insiderTitle = edgarSource
      ? `SEC EDGAR: ${c.edgar_buy_count || 0} buys, ${c.edgar_sell_count || 0} sells` + (edgarCluster ? ' | CLUSTER BUYING' : '') + (edgarCsuite ? ' | C-SUITE' : '')
      : '';
    const isSelected = i === currentIndex ? 'background:rgba(59,130,246,0.12);' : '';
    return `
      <div style="display:grid;${gridCols}gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--color-border);${isSelected}cursor:pointer;" onclick="selectCandidate(${i})" onmouseenter="this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.background='${i === currentIndex ? 'rgba(59,130,246,0.12)' : ''}'">
        <span class="text-mono" style="font-weight:700;font-size:13px;">${c.symbol || 'N/A'}</span>
        <span title="${c.candidate_semantic_summary || ''}" style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;${c.candidate_role === 'context_indicator' ? 'color:#cbd5e1;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);' : c.candidate_role === 'pattern_detector' ? 'color:#93c5fd;background:rgba(96,165,250,0.10);border:1px solid rgba(96,165,250,0.28);' : 'color:#6ee7b7;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);'}">${patternName}</span>
        <span class="text-mono" title="${signalState || 'No signal state'}" style="font-size:11px;color:${signalState ? 'var(--color-accent)' : 'var(--color-text-muted)'};">${stateText}</span>
        <span class="text-mono" style="font-size:13px;">${score}</span>
        <span class="text-mono" style="font-size:12px;${mlColor}">${mlText}</span>
        <span title="${c.candidate_semantic_summary || ''}" style="font-size:12px;${entryColor}">${entryLabel}</span>
        <span style="font-size:12px;${insiderColor}" title="${insiderTitle}">${insiderText}</span>
        <span style="font-size:12px;${trendColor}">${trend}</span>
        <span style="font-size:12px;${buyZoneColor}">${buyZone}</span>
        <span style="font-size:11px;color:var(--color-text-muted);">${endDate}</span>
        <button class="btn btn-ghost btn-sm" style="font-size:11px;" onclick="event.stopPropagation();sendToTradingDesk(${i})">Trade &rarr;</button>
        <button type="button" onclick="event.stopPropagation();scannerToggleWatchList(${i})"
          title="${(typeof watchListHas === 'function' && watchListHas(c.symbol)) ? 'Remove from Watch List' : 'Save to Watch List'}"
          style="background:none;border:none;cursor:pointer;font-size:16px;padding:0 4px;color:${(typeof watchListHas === 'function' && watchListHas(c.symbol)) ? '#f59e0b' : 'rgba(255,255,255,0.2)'};"
        >${(typeof watchListHas === 'function' && watchListHas(c.symbol)) ? '★' : '☆'}</button>
      </div>`;
  }).join('');

  list.innerHTML = headerHtml + rowsHtml;
}

async function selectCandidate(index) {
  if (!Array.isArray(candidates) || index < 0 || index >= candidates.length) return;
  currentIndex = index;
  const candidate = candidates[index];
  const currentIndexEl = document.getElementById('current-index');
  if (currentIndexEl) currentIndexEl.textContent = String(index + 1);
  try {
    if (candidate?.__savedScanStub) {
      await hydrateSavedScanCandidate(index);
      showCandidate(index);
      renderScanResults(candidates);
      return;
    }
    showCandidate(index);
  } catch (err) {
    console.error('Failed to select candidate:', err);
    const statusEl = document.getElementById('scan-status');
    if (statusEl) statusEl.textContent = `Failed to load ${candidate?.symbol || 'candidate'}: ${err.message || 'Unknown error'}`;
  }
}

function scannerToggleWatchList(candidateIndex) {
  if (typeof watchListAdd !== 'function') return;
  const c = candidates[candidateIndex];
  if (!c) return;
  const symbol = String(c.symbol || '').toUpperCase().trim();
  if (watchListHas(symbol)) {
    watchListRemove(symbol);
  } else {
    const entryPrice = Number(c.close || c.entry_price || c.last_close || 0);
    const interval = String(c.timeframe || c.interval || '1d');
    watchListAdd({
      symbol,
      score: Number(c.score || c.top_score || 0),
      composite_id: String(c.composite_id || c.pattern_id || c.method_id || ''),
      interval,
      price_box: null,
      entry_price: entryPrice,
      note: '',
    });
  }
  // Re-render rows to update star state
  renderScanResults(candidates);
}

function sendToTradingDesk(candidateIndex) {
  const candidate = candidates[candidateIndex];
  if (!candidate) return;
  const handoffApi = window.ScannerTradingDeskHandoff || null;
  const symbol = String(candidate.symbol || '').trim().toUpperCase();
  const intervalValue = handoffApi?.normalizeInterval
    ? handoffApi.normalizeInterval(candidate.timeframe || candidate.interval || '1wk')
    : (candidate.timeframe || candidate.interval || '1wk');
  let handoff = null;

  if (handoffApi?.buildPacket && handoffApi?.write) {
    handoff = handoffApi.buildPacket({
      candidate,
      symbol,
      interval: intervalValue,
      timeframe: candidate.timeframe || null,
      aiAnalysis: typeof lastAIAnalysis !== 'undefined' ? lastAIAnalysis : null,
    });
    handoffApi.write(handoff);
  }

  const params = new URLSearchParams({
    symbol,
    interval: intervalValue,
  });
  if (handoff?.id) {
    params.set('scannerHandoffId', handoff.id);
  }

  window.location.href = `/trading-desk?${params.toString()}`;
}
