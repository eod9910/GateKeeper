// =========================================================================
// watch-list.js — Shared scanner Watch List store
// Persists scanner hits in localStorage across Scanner and Trading Desk.
// =========================================================================

const WATCH_LIST_KEY = 'scanner-watchlist-v1';
const WATCH_LIST_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 trading days

function _wlLoad() {
  try {
    const raw = localStorage.getItem(WATCH_LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function _wlSave(entries) {
  try {
    localStorage.setItem(WATCH_LIST_KEY, JSON.stringify(entries));
  } catch {}
}

function _wlPrune(entries) {
  const cutoff = Date.now() - WATCH_LIST_TTL_MS;
  return entries.filter((e) => new Date(e.saved_at).getTime() > cutoff);
}

/**
 * Returns all non-expired Watch List entries, sorted newest first.
 */
function watchListGetAll() {
  const entries = _wlPrune(_wlLoad());
  _wlSave(entries);
  return entries.slice().sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
}

/**
 * Returns true if the symbol is already on the Watch List.
 */
function watchListHas(symbol) {
  if (!symbol) return false;
  const needle = String(symbol).toUpperCase().trim();
  return _wlPrune(_wlLoad()).some((e) => e.symbol === needle);
}

/**
 * Adds or updates a Watch List entry for a scanner hit.
 * @param {object} entry
 *   symbol        {string}  — ticker
 *   score         {number}  — composite score
 *   composite_id  {string}  — pattern / composite id used for the scan
 *   interval      {string}  — e.g. "1d"
 *   price_box     {object}  — { top, bottom } price levels from output_ports
 *   entry_price   {number}  — last close / suggested entry
 *   note          {string}  — optional free-text note
 */
function watchListAdd(entry) {
  if (!entry || !entry.symbol) return;
  const symbol = String(entry.symbol).toUpperCase().trim();
  let entries = _wlPrune(_wlLoad());
  entries = entries.filter((e) => e.symbol !== symbol);
  entries.unshift({
    symbol,
    score: Number(entry.score) || 0,
    composite_id: String(entry.composite_id || ''),
    interval: String(entry.interval || '1d'),
    price_box: entry.price_box || null,
    entry_price: Number(entry.entry_price) || 0,
    note: String(entry.note || ''),
    saved_at: new Date().toISOString(),
  });
  _wlSave(entries);
  _wlNotify();
}

/**
 * Removes a symbol from the Watch List.
 */
function watchListRemove(symbol) {
  if (!symbol) return;
  const needle = String(symbol).toUpperCase().trim();
  const entries = _wlPrune(_wlLoad()).filter((e) => e.symbol !== needle);
  _wlSave(entries);
  _wlNotify();
}

/**
 * Clears all Watch List entries.
 */
function watchListClear() {
  _wlSave([]);
  _wlNotify();
}

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
