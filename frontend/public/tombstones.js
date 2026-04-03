async function archiveRejected() {
  const btn = document.getElementById('btn-archive-rejected');
  if (!confirm('This counts rejected strategies. Files are preserved and can be restored.\n\nContinue?')) return;
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    const res = await fetch('/api/strategies/archive-rejected', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Archive failed');
    const count = data.data?.archived ?? 0;
    alert(`${count} rejected ${count === 1 ? 'strategy' : 'strategies'} found. All files are preserved.`);
    await loadTombstonesPage();
  } catch (e) {
    alert(`Failed: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Archive Rejected'; }
  }
}

async function restoreMethod(patternId) {
  if (!patternId) return;
  if (!confirm('Restore "' + patternId + '" back to the active method library?')) return;
  try {
    const res = await fetch('/api/plugins/scanner/tombstones/' + encodeURIComponent(patternId), { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Restore failed');
    await loadTombstonesPage();
  } catch (e) {
    alert('Restore failed: ' + e.message);
  }
}

async function restoreStrategy(strategyVersionId) {
  if (!strategyVersionId) return;
  if (!confirm('Restore "' + strategyVersionId + '" back to draft status?')) return;
  try {
    const res = await fetch('/api/strategies/' + encodeURIComponent(strategyVersionId) + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'draft' }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Restore failed');
    await loadTombstonesPage();
  } catch (e) {
    alert('Restore failed: ' + e.message);
  }
}

function tombstonesFormatDateTime(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function tombstonesSafeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tombstonesFmtNumber(value, digits = 2) {
  if (value == null || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(digits);
}

function tombstonesFmtPct(value, digits = 1) {
  if (value == null || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(digits)}%`;
}

function tombstonesRender(methodStore, strategyStore) {
  const methodEntries = Array.isArray(methodStore?.entries) ? methodStore.entries.slice() : [];
  const strategyEntries = Array.isArray(strategyStore?.entries) ? strategyStore.entries.slice() : [];
  const allEntries = methodEntries.concat(strategyEntries);
  const subtitleEl = document.getElementById('tombstones-subtitle');
  const countEl = document.getElementById('tombstones-stat-count');
  const methodsEl = document.getElementById('tombstones-stat-methods');
  const strategiesEl = document.getElementById('tombstones-stat-strategies');
  const updatedEl = document.getElementById('tombstones-stat-updated');
  const sourceEl = document.getElementById('tombstones-stat-source');
  const listEl = document.getElementById('tombstones-list');
  const strategyListEl = document.getElementById('strategy-tombstones-list');

  methodEntries.sort((a, b) => {
    const at = new Date(a?.tombstoned_at || 0).getTime();
    const bt = new Date(b?.tombstoned_at || 0).getTime();
    return bt - at;
  });
  strategyEntries.sort((a, b) => {
    const at = new Date(a?.tombstoned_at || 0).getTime();
    const bt = new Date(b?.tombstoned_at || 0).getTime();
    return bt - at;
  });

  if (subtitleEl) {
    subtitleEl.textContent = allEntries.length
      ? `${allEntries.length} total tombstone entr${allEntries.length === 1 ? 'y' : 'ies'} across methods and strategies.`
      : 'No tombstones recorded yet.';
  }
  if (countEl) countEl.textContent = String(allEntries.length);
  if (methodsEl) methodsEl.textContent = String(methodEntries.length);
  if (strategiesEl) strategiesEl.textContent = String(strategyEntries.length);

  const latestUpdatedAt = [methodStore?.updated_at, strategyStore?.updated_at]
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  if (updatedEl) updatedEl.textContent = tombstonesFormatDateTime(latestUpdatedAt);

  const sourceCounts = {};
  allEntries.forEach((entry) => {
    const key = String(entry?.source || 'unknown').trim() || 'unknown';
    sourceCounts[key] = (sourceCounts[key] || 0) + 1;
  });
  const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0];
  if (sourceEl) sourceEl.textContent = topSource ? `${topSource[0]} (${topSource[1]})` : '--';

  if (!listEl) return;
  if (!methodEntries.length) {
    listEl.innerHTML = '<div class="text-muted">No tombstones recorded.</div>';
  } else {
    listEl.innerHTML = methodEntries.map((entry) => {
      const name = tombstonesSafeHtml(entry?.name || entry?.pattern_id || 'Unknown');
      const patternId = tombstonesSafeHtml(entry?.pattern_id || '--');
      const source = tombstonesSafeHtml(entry?.source || '--');
      const reason = tombstonesSafeHtml(entry?.reason || '--');
      const time = tombstonesSafeHtml(tombstonesFormatDateTime(entry?.tombstoned_at));
      return `
        <div class="panel" style="padding:var(--space-16);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-16);align-items:start;">
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:var(--space-8);margin-bottom:var(--space-8);flex-wrap:wrap;">
              <div style="font-weight:700;">${name}</div>
              <div class="text-mono text-muted">${patternId}</div>
            </div>
            <div class="text-muted" style="font-size:var(--text-small);margin-bottom:var(--space-8);">${reason}</div>
            <div style="display:flex;gap:var(--space-12);flex-wrap:wrap;font-size:var(--text-caption);">
              <span class="text-mono">source: ${source}</span>
              <span class="text-mono">tombstoned: ${time}</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
            <div style="padding:4px 8px;border:1px solid var(--color-border);font-size:var(--text-caption);font-family:var(--font-mono);color:#ef9a9a;">
              TOMBSTONED
            </div>
            <button class="btn btn-ghost btn-sm" onclick="restoreMethod('${patternId}')" style="font-size:11px;padding:3px 10px;color:var(--color-positive,#4ade80);border-color:var(--color-positive,#4ade80);">Restore</button>
          </div>
        </div>
      `;
    }).join('');
  }

  if (!strategyListEl) return;
  if (!strategyEntries.length) {
    strategyListEl.innerHTML = '<div class="text-muted">No rejected strategies recorded.</div>';
    return;
  }

  strategyListEl.innerHTML = strategyEntries.map((entry) => {
    const name = tombstonesSafeHtml(entry?.name || entry?.strategy_version_id || 'Unknown strategy');
    const strategyId = tombstonesSafeHtml(entry?.strategy_version_id || '--');
    const strategyFamily = tombstonesSafeHtml(entry?.strategy_id || '--');
    const assetClass = tombstonesSafeHtml(entry?.asset_class || '--');
    const interval = tombstonesSafeHtml(entry?.interval || '--');
    const reason = tombstonesSafeHtml(entry?.reason || 'Strategy marked rejected.');
    const time = tombstonesSafeHtml(tombstonesFormatDateTime(entry?.tombstoned_at));
    const reportId = tombstonesSafeHtml(entry?.latest_report_id || '--');
    const tier = tombstonesSafeHtml(entry?.latest_validation_tier || '--');
    const passFail = tombstonesSafeHtml(entry?.latest_pass_fail || '--');
    const metrics = entry?.latest_metrics || {};
    return `
      <div class="panel" style="padding:var(--space-16);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-16);align-items:start;">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:var(--space-8);margin-bottom:var(--space-8);flex-wrap:wrap;">
            <div style="font-weight:700;">${name}</div>
            <div class="text-mono text-muted">${strategyId}</div>
          </div>
          <div class="text-muted" style="font-size:var(--text-small);margin-bottom:var(--space-8);">${reason}</div>
          <div style="display:flex;gap:var(--space-12);flex-wrap:wrap;font-size:var(--text-caption);margin-bottom:var(--space-8);">
            <span class="text-mono">family: ${strategyFamily}</span>
            <span class="text-mono">asset: ${assetClass}</span>
            <span class="text-mono">interval: ${interval}</span>
            <span class="text-mono">tier: ${tier}</span>
            <span class="text-mono">report: ${reportId}</span>
            <span class="text-mono">verdict: ${passFail}</span>
            <span class="text-mono">tombstoned: ${time}</span>
          </div>
          <div style="display:flex;gap:var(--space-12);flex-wrap:wrap;font-size:var(--text-caption);">
            <span class="text-mono">trades: ${tombstonesFmtNumber(metrics.total_trades, 0)}</span>
            <span class="text-mono">expectancy: ${tombstonesFmtNumber(metrics.expectancy_R)}R</span>
            <span class="text-mono">pf: ${tombstonesFmtNumber(metrics.profit_factor)}</span>
            <span class="text-mono">win rate: ${tombstonesFmtPct(metrics.win_rate)}</span>
            <span class="text-mono">max dd: ${tombstonesFmtPct(metrics.max_drawdown_pct)}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
          <div style="padding:4px 8px;border:1px solid var(--color-border);font-size:var(--text-caption);font-family:var(--font-mono);color:#ef9a9a;">
            REJECTED
          </div>
          <button class="btn btn-ghost btn-sm" onclick="restoreStrategy('${strategyId}')" style="font-size:11px;padding:3px 10px;color:var(--color-positive,#4ade80);border-color:var(--color-positive,#4ade80);">Restore</button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadTombstonesPage() {
  const listEl = document.getElementById('tombstones-list');
  const strategyListEl = document.getElementById('strategy-tombstones-list');
  const subtitleEl = document.getElementById('tombstones-subtitle');
  if (listEl) listEl.innerHTML = '<div class="text-muted">Loading...</div>';
  if (strategyListEl) strategyListEl.innerHTML = '<div class="text-muted">Loading...</div>';
  if (subtitleEl) subtitleEl.textContent = 'Loading tombstones...';

  try {
    const [methodRes, strategyRes] = await Promise.all([
      fetch('/api/plugins/scanner/tombstones'),
      fetch('/api/strategies/tombstones'),
    ]);
    const [methodData, strategyData] = await Promise.all([
      methodRes.json(),
      strategyRes.json(),
    ]);
    if (!methodRes.ok || !methodData?.success || !methodData?.data) {
      throw new Error(methodData?.error || `HTTP ${methodRes.status}`);
    }
    if (!strategyRes.ok || !strategyData?.success || !strategyData?.data) {
      throw new Error(strategyData?.error || `HTTP ${strategyRes.status}`);
    }
    tombstonesRender(methodData.data, strategyData.data);
  } catch (error) {
    if (listEl) listEl.innerHTML = `<div class="text-muted">Failed to load tombstones: ${tombstonesSafeHtml(error.message || 'Unknown error')}</div>`;
    if (strategyListEl) strategyListEl.innerHTML = `<div class="text-muted">Failed to load tombstones: ${tombstonesSafeHtml(error.message || 'Unknown error')}</div>`;
    if (subtitleEl) subtitleEl.textContent = 'Failed to load tombstones.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadTombstonesPage();
});

window.loadTombstonesPage = loadTombstonesPage;
