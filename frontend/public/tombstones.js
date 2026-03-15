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

function tombstonesRender(store) {
  const entries = Array.isArray(store?.entries) ? store.entries.slice() : [];
  const subtitleEl = document.getElementById('tombstones-subtitle');
  const countEl = document.getElementById('tombstones-stat-count');
  const updatedEl = document.getElementById('tombstones-stat-updated');
  const sourceEl = document.getElementById('tombstones-stat-source');
  const listEl = document.getElementById('tombstones-list');

  entries.sort((a, b) => {
    const at = new Date(a?.tombstoned_at || 0).getTime();
    const bt = new Date(b?.tombstoned_at || 0).getTime();
    return bt - at;
  });

  if (subtitleEl) {
    subtitleEl.textContent = entries.length
      ? `${entries.length} tombstoned method${entries.length === 1 ? '' : 's'}`
      : 'No tombstoned methods yet.';
  }
  if (countEl) countEl.textContent = String(entries.length);
  if (updatedEl) updatedEl.textContent = tombstonesFormatDateTime(store?.updated_at);

  const sourceCounts = {};
  entries.forEach((entry) => {
    const key = String(entry?.source || 'unknown').trim() || 'unknown';
    sourceCounts[key] = (sourceCounts[key] || 0) + 1;
  });
  const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0];
  if (sourceEl) sourceEl.textContent = topSource ? `${topSource[0]} (${topSource[1]})` : '--';

  if (!listEl) return;
  if (!entries.length) {
    listEl.innerHTML = '<div class="text-muted">No tombstones recorded.</div>';
    return;
  }

  listEl.innerHTML = entries.map((entry) => {
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
        <div style="padding:4px 8px;border:1px solid var(--color-border);font-size:var(--text-caption);font-family:var(--font-mono);color:#ef9a9a;">
          TOMBSTONED
        </div>
      </div>
    `;
  }).join('');
}

async function loadTombstonesPage() {
  const listEl = document.getElementById('tombstones-list');
  const subtitleEl = document.getElementById('tombstones-subtitle');
  if (listEl) listEl.innerHTML = '<div class="text-muted">Loading...</div>';
  if (subtitleEl) subtitleEl.textContent = 'Loading tombstoned methods...';

  try {
    const res = await fetch('/api/plugins/scanner/tombstones');
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.data) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    tombstonesRender(data.data);
  } catch (error) {
    if (listEl) listEl.innerHTML = `<div class="text-muted">Failed to load tombstones: ${tombstonesSafeHtml(error.message || 'Unknown error')}</div>`;
    if (subtitleEl) subtitleEl.textContent = 'Failed to load tombstoned methods.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadTombstonesPage();
});

window.loadTombstonesPage = loadTombstonesPage;
