let autoLabelState = {
  activeJobId: null,
  pollTimer: null,
  jobs: [],
};

function setAutoStatus(text) {
  const el = document.getElementById('auto-status');
  if (el) el.textContent = text || 'Ready';
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n * 100)}%`;
}

function splitCandidateIds(raw) {
  return String(raw || '')
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter((x) => !!x);
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running') return 'running';
  if (s === 'failed') return 'failed';
  if (s === 'completed') return 'completed';
  if (s === 'cancelled') return 'cancelled';
  return '';
}

function renderJobsTable() {
  const body = document.getElementById('auto-jobs-body');
  if (!body) return;
  const jobs = Array.isArray(autoLabelState.jobs) ? autoLabelState.jobs : [];
  if (!jobs.length) {
    body.innerHTML = '<tr><td colspan="8" class="text-muted">No jobs yet.</td></tr>';
    return;
  }

  body.innerHTML = jobs.map((job) => {
    const counters = job.counters || {};
    const processed = Number(counters.processed || 0);
    const total = Number(counters.total || 0);
    const isActive = autoLabelState.activeJobId && String(autoLabelState.activeJobId) === String(job.jobId);
    return `
      <tr class="auto-job-row ${isActive ? 'active' : ''}" onclick="selectAutoLabelJob('${String(job.jobId).replace(/'/g, '')}')">
        <td title="${escapeHtml(job.jobId)}">${escapeHtml(String(job.jobId || '').slice(-16))}</td>
        <td><span class="auto-pill ${statusClass(job.status)}">${escapeHtml(job.status || 'unknown')}</span></td>
        <td>${processed}/${total}</td>
        <td>${Number(counters.autoLabeled || 0)}</td>
        <td>${Number(counters.autoCorrected || 0)}</td>
        <td>${Number(counters.reviewRequired || 0)}</td>
        <td>${Number(counters.errors || 0)}</td>
        <td>${job?.request?.dryRun ? 'yes' : 'no'}</td>
      </tr>
    `;
  }).join('');
}

function renderActiveJob(job) {
  const active = document.getElementById('auto-active-job');
  const progressBar = document.getElementById('auto-progress-bar');
  const progressText = document.getElementById('auto-progress-text');
  if (!active || !progressBar || !progressText) return;

  if (!job) {
    active.textContent = 'Active: none';
    progressBar.style.width = '0%';
    progressText.textContent = 'No active job.';
    return;
  }

  const counters = job.counters || {};
  const processed = Number(counters.processed || 0);
  const total = Number(counters.total || 0);
  const progress = Number.isFinite(Number(job.progress)) ? Number(job.progress) : (total ? processed / total : 0);
  active.textContent = `Active: ${job.jobId}`;
  progressBar.style.width = formatPct(clamp01(progress));
  progressText.textContent = `${String(job.status || 'unknown').toUpperCase()} | ${processed}/${total} processed | Auto labels ${Number(counters.autoLabeled || 0)} | Auto corr ${Number(counters.autoCorrected || 0)} | Review ${Number(counters.reviewRequired || 0)} | Errors ${Number(counters.errors || 0)}`;
}

function stopAutoPolling() {
  if (autoLabelState.pollTimer) {
    clearInterval(autoLabelState.pollTimer);
    autoLabelState.pollTimer = null;
  }
}

async function pollActiveJob() {
  const jobId = autoLabelState.activeJobId;
  if (!jobId) return;
  try {
    const res = await fetch(`/api/auto-label/job/${encodeURIComponent(jobId)}`);
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    const job = data.data;
    const idx = autoLabelState.jobs.findIndex((j) => String(j.jobId) === String(job.jobId));
    if (idx >= 0) autoLabelState.jobs[idx] = job;
    renderJobsTable();
    renderActiveJob(job);

    const status = String(job.status || '');
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      stopAutoPolling();
      setAutoStatus(`Job ${status}`);
      await refreshAutoLabelJobs();
    }
  } catch (error) {
    stopAutoPolling();
    setAutoStatus(`Poll failed: ${error.message || 'Unknown error'}`);
  }
}

function startAutoPolling(jobId) {
  autoLabelState.activeJobId = jobId;
  stopAutoPolling();
  void pollActiveJob();
  autoLabelState.pollTimer = setInterval(pollActiveJob, 1500);
}

async function loadPatternOptions() {
  const select = document.getElementById('auto-pattern');
  if (!select) return;
  select.innerHTML = '<option value="">Loading patterns...</option>';
  try {
    const res = await fetch('/api/plugins/scanner/options');
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    const patterns = data.data.filter((item) => String(item?.artifact_type || '').toLowerCase() === 'pattern');
    if (!patterns.length) {
      select.innerHTML = '<option value="">No patterns found</option>';
      return;
    }
    select.innerHTML = patterns.map((item) => {
      const pid = String(item?.pattern_id || '');
      const name = String(item?.name || pid);
      return `<option value="${escapeHtml(pid)}">${escapeHtml(name)}</option>`;
    }).join('');
  } catch (error) {
    select.innerHTML = '<option value="">Failed to load patterns</option>';
    setAutoStatus(`Pattern load failed: ${error.message || 'Unknown error'}`);
  }
}

async function refreshAutoLabelJobs() {
  try {
    const res = await fetch('/api/auto-label/jobs');
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.data)) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    autoLabelState.jobs = data.data;
    renderJobsTable();

    if (autoLabelState.activeJobId) {
      const active = autoLabelState.jobs.find((j) => String(j.jobId) === String(autoLabelState.activeJobId));
      renderActiveJob(active || null);
    } else {
      renderActiveJob(null);
    }
    setAutoStatus('Jobs refreshed');
  } catch (error) {
    setAutoStatus(`Job load failed: ${error.message || 'Unknown error'}`);
  }
}

async function startAutoLabelJob() {
  const patternEl = document.getElementById('auto-pattern');
  const timeframeEl = document.getElementById('auto-timeframe');
  const maxItemsEl = document.getElementById('auto-max-items');
  const dryRunEl = document.getElementById('auto-dry-run');
  const saveCorrectionsEl = document.getElementById('auto-save-corrections');
  const unreviewedOnlyEl = document.getElementById('auto-unreviewed-only');
  const labelThresholdEl = document.getElementById('auto-label-threshold');
  const correctionThresholdEl = document.getElementById('auto-correction-threshold');
  const idsEl = document.getElementById('auto-candidate-ids');

  const patternId = String(patternEl?.value || '').trim();
  if (!patternId) {
    setAutoStatus('Pick a pattern first.');
    return;
  }

  const payload = {
    patternId,
    timeframe: String(timeframeEl?.value || 'W'),
    maxItems: Number(maxItemsEl?.value || 200),
    dryRun: !!(dryRunEl && dryRunEl.checked),
    saveCorrections: !!(saveCorrectionsEl && saveCorrectionsEl.checked),
    unreviewedOnly: !!(unreviewedOnlyEl && unreviewedOnlyEl.checked),
    labelThreshold: clamp01(Number(labelThresholdEl?.value || 0.9)),
    correctionThreshold: clamp01(Number(correctionThresholdEl?.value || 0.92)),
    candidateIds: splitCandidateIds(idsEl?.value || ''),
    userId: 'ai',
  };

  try {
    setAutoStatus('Starting job...');
    const res = await fetch('/api/auto-label/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data?.jobId) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    const jobId = String(data.data.jobId);
    setAutoStatus(`Started ${jobId}`);
    await refreshAutoLabelJobs();
    startAutoPolling(jobId);
  } catch (error) {
    setAutoStatus(`Start failed: ${error.message || 'Unknown error'}`);
  }
}

function selectAutoLabelJob(jobId) {
  autoLabelState.activeJobId = jobId;
  const job = autoLabelState.jobs.find((j) => String(j.jobId) === String(jobId));
  renderJobsTable();
  renderActiveJob(job || null);
  if (job && String(job.status) === 'running') {
    startAutoPolling(jobId);
  } else {
    stopAutoPolling();
  }
}

async function cancelActiveAutoLabelJob() {
  const jobId = autoLabelState.activeJobId;
  if (!jobId) {
    setAutoStatus('No active job selected.');
    return;
  }
  try {
    const res = await fetch(`/api/auto-label/job/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    setAutoStatus(`Cancel requested: ${jobId}`);
    await refreshAutoLabelJobs();
  } catch (error) {
    setAutoStatus(`Cancel failed: ${error.message || 'Unknown error'}`);
  }
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadPatternOptions();
  await refreshAutoLabelJobs();
});

window.startAutoLabelJob = startAutoLabelJob;
window.refreshAutoLabelJobs = refreshAutoLabelJobs;
window.cancelActiveAutoLabelJob = cancelActiveAutoLabelJob;
window.selectAutoLabelJob = selectAutoLabelJob;

