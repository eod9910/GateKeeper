// =========================================================================
// watch-list.js — Shared Watch List store
// Persists entries to the backend API with localStorage as local cache.
// =========================================================================

const WATCH_LIST_KEY = 'scanner-watchlist-v1';
let _wlCache = null;

function _wlLoadLocal() {
  try {
    const raw = localStorage.getItem(WATCH_LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function _wlSaveLocal(entries) {
  try {
    localStorage.setItem(WATCH_LIST_KEY, JSON.stringify(entries));
  } catch {}
  _wlCache = entries;
}

async function _wlFetchFromServer() {
  try {
    const res = await fetch('/api/watchlist');
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      _wlSaveLocal(json.data);
      return json.data;
    }
  } catch {}
  return null;
}

async function _wlPostToServer(entry) {
  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      _wlSaveLocal(json.data);
      return json.data;
    }
  } catch {}
  return null;
}

async function _wlDeleteFromServer(symbol) {
  try {
    const res = await fetch('/api/watchlist/' + encodeURIComponent(symbol), { method: 'DELETE' });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      _wlSaveLocal(json.data);
      return json.data;
    }
  } catch {}
  return null;
}

async function _wlClearOnServer() {
  try {
    const res = await fetch('/api/watchlist', { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      _wlSaveLocal([]);
      return [];
    }
  } catch {}
  return null;
}

function _wlGetCached() {
  if (_wlCache) return _wlCache;
  _wlCache = _wlLoadLocal();
  return _wlCache;
}

function _wlPrune(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const now = new Date().toISOString();
  const seen = new Set();
  return source
    .map((entry) => {
      const symbol = String(entry?.symbol || '').toUpperCase().trim();
      if (!symbol) return null;
      const savedAt = new Date(entry?.saved_at || '').getTime();
      return {
        ...entry,
        symbol,
        saved_at: Number.isFinite(savedAt) ? entry.saved_at : now,
      };
    })
    .filter((entry) => {
      if (!entry || seen.has(entry.symbol)) return false;
      seen.add(entry.symbol);
      return true;
    });
}

function watchListGetAll() {
  return _wlPrune(_wlGetCached()).slice().sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
}

function watchListHas(symbol) {
  if (!symbol) return false;
  const needle = String(symbol).toUpperCase().trim();
  return _wlGetCached().some((e) => e.symbol === needle);
}

function watchListAdd(entry) {
  if (!entry || !entry.symbol) return;
  const symbol = String(entry.symbol).toUpperCase().trim();

  // Optimistic local update
  let entries = _wlPrune(_wlGetCached());
  entries = entries.filter((e) => e.symbol !== symbol);
  entries.unshift({
    symbol,
    score: Number(entry.score) || 0,
    composite_id: String(entry.composite_id || ''),
    interval: String(entry.interval || '1d'),
    price_box: entry.price_box || null,
    entry_price: Number(entry.entry_price) || 0,
    stop_price: entry.stop_price != null ? Number(entry.stop_price) : undefined,
    take_profit: entry.take_profit != null ? Number(entry.take_profit) : undefined,
    take_profit_2: entry.take_profit_2 != null ? Number(entry.take_profit_2) : undefined,
    take_profit_3: entry.take_profit_3 != null ? Number(entry.take_profit_3) : undefined,
    direction: entry.direction != null ? Number(entry.direction) : undefined,
    instrument_type: entry.instrument_type || undefined,
    futures_margin: entry.futures_margin != null ? Number(entry.futures_margin) : undefined,
    point_value: entry.point_value != null ? Number(entry.point_value) : undefined,
    tick_size: entry.tick_size != null ? Number(entry.tick_size) : undefined,
    risk_percent: entry.risk_percent != null ? Number(entry.risk_percent) : undefined,
    manual_size: entry.manual_size != null ? Number(entry.manual_size) : undefined,
    note: String(entry.note || ''),
    saved_at: new Date().toISOString(),
  });
  _wlSaveLocal(entries);
  _wlNotify();

  // Persist to server in background
  _wlPostToServer(entries[0]);
}

function watchListRemove(symbol) {
  if (!symbol) return;
  const needle = String(symbol).toUpperCase().trim();
  const entries = _wlPrune(_wlGetCached()).filter((e) => e.symbol !== needle);
  _wlSaveLocal(entries);
  _wlNotify();
  _wlDeleteFromServer(needle);
}

function watchListClear() {
  _wlSaveLocal([]);
  _wlNotify();
  _wlClearOnServer();
}

// ── Boot: hydrate from server ─────────────────────────────────────────────
_wlFetchFromServer().then((serverData) => {
  if (serverData) {
    // Merge any localStorage-only entries into server data
    const local = _wlLoadLocal();
    const serverSymbols = new Set(serverData.map((e) => e.symbol));
    const missing = local.filter((e) => e.symbol && !serverSymbols.has(e.symbol));
    if (missing.length > 0) {
      missing.forEach((e) => _wlPostToServer(e));
    }
    _wlNotify();
  }
});

// ── Change notification (lightweight pub/sub) ─────────────────────────────
const _wlListeners = new Set();

function watchListSubscribe(fn) {
  _wlListeners.add(fn);
  return () => _wlListeners.delete(fn);
}

function _wlNotify() {
  const entries = watchListGetAll();
  _wlListeners.forEach((fn) => { try { fn(entries); } catch {} });
}

// ── Expose globally ───────────────────────────────────────────────────────
window.watchListGetAll    = watchListGetAll;
window.watchListHas       = watchListHas;
window.watchListAdd       = watchListAdd;
window.watchListRemove    = watchListRemove;
window.watchListClear     = watchListClear;
window.watchListSubscribe = watchListSubscribe;
