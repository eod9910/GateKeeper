// =========================================================================
// browse-asset-class.js
//
// Shared "Browse" controller used by Scanner / Trading Desk / Training Desk.
// Lets the user pick an asset class (Forex, Futures, Indices, etc.) and pan
// through every symbol in it with ←/→ — no indicator scan or AI analysis is
// run, the host page only fetches OHLCV bars on demand.
//
// Each host page calls installBrowseAssetClass(config) once after DOM is ready.
//
//   installBrowseAssetClass({
//     selectId:    'td-browse-asset-class',  // <select> element (existing)
//     buttonId:    'td-browse-button',       // <button> element (existing)
//     statusElId:  'td-browse-status',       // optional <span>
//     getInterval: () => '1d',               // returns Yahoo-style interval
//     loadSymbol:  async (symbol, ctx) => {} // host-specific chart loader
//   });
//
// The controller also wires document-level ←/→ keys so the user can pan
// without needing the prev/next buttons.
// =========================================================================
(function () {
  'use strict';

  // Shared cache so we don't re-fetch the symbol library for every install.
  let _symbolLibraryPromise = null;
  function fetchSymbolLibrary() {
    if (_symbolLibraryPromise) return _symbolLibraryPromise;
    _symbolLibraryPromise = fetch('/api/candidates/symbols', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (json && json.success && json.data) return json.data;
        throw new Error('symbol library fetch returned no data');
      })
      .catch((err) => {
        _symbolLibraryPromise = null; // allow retry
        throw err;
      });
    return _symbolLibraryPromise;
  }

  function annotateSelectCounts(select, library) {
    if (!select || !library) return;
    for (const opt of select.options) {
      const key = opt.value;
      if (!key) continue;
      const arr = key === 'all' ? (library.all || []) : (library[key] || []);
      const baseName = opt.textContent.replace(/\s*\(\d+\)$/, '');
      opt.textContent = `${baseName} (${arr.length})`;
    }
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
  }

  function installBrowseAssetClass(config) {
    const select = document.getElementById(config.selectId);
    const button = document.getElementById(config.buttonId);
    const statusEl = config.statusElId ? document.getElementById(config.statusElId) : null;

    if (!select || !button) {
      console.warn('[browse-asset-class] missing select or button:', config);
      return null;
    }

    const setStatus = (msg) => {
      if (statusEl) statusEl.textContent = msg || '';
      if (typeof config.onStatus === 'function') {
        try { config.onStatus(msg); } catch (e) {}
      }
    };

    // Per-controller state. Each host page has its own controller.
    const state = {
      symbols: [],       // string[]
      index: -1,         // current pointer
      loading: false,    // chart-load in flight
      assetClass: '',
      assetLabel: '',
    };

    // Annotate counts on the select once the library lands.
    fetchSymbolLibrary()
      .then((lib) => annotateSelectCounts(select, lib))
      .catch((err) => console.warn('[browse-asset-class] symbol library load failed', err));

    async function loadCurrent() {
      if (state.index < 0 || state.index >= state.symbols.length) return;
      if (state.loading) return;
      const symbol = state.symbols[state.index];
      const interval = typeof config.getInterval === 'function' ? config.getInterval() : '';
      state.loading = true;
      try {
        setStatus(`[${state.index + 1}/${state.symbols.length}] ${symbol} — loading…`);
        await config.loadSymbol(symbol, { interval, index: state.index, total: state.symbols.length });
        setStatus(`[${state.index + 1}/${state.symbols.length}] ${state.assetLabel} • ${symbol} — ←/→ to pan`);
      } catch (err) {
        console.error('[browse-asset-class] loadSymbol failed', symbol, err);
        setStatus(`[${state.index + 1}/${state.symbols.length}] ${symbol} — failed: ${err.message || err}`);
      } finally {
        state.loading = false;
      }
    }

    async function browse() {
      if (state.loading) return;

      let library;
      try {
        setStatus('Loading symbol library…');
        library = await fetchSymbolLibrary();
        annotateSelectCounts(select, library);
      } catch (err) {
        setStatus('Failed to load symbol library');
        return;
      }

      const assetClass = String(select.value || '').trim() || 'all';
      const assetLabel = (select.options[select.selectedIndex]?.text || assetClass).replace(/\s*\(\d+\)$/, '');
      let symbols = (library[assetClass] || library.all || []).slice();
      symbols = symbols
        .map((s) => String(s || '').trim().toUpperCase())
        .filter(Boolean);
      symbols = Array.from(new Set(symbols));

      // Optional per-host filter (e.g. apply price/criteria chips).
      if (typeof config.filterSymbols === 'function') {
        try {
          symbols = await config.filterSymbols(symbols, { library, assetClass });
        } catch (err) {
          console.warn('[browse-asset-class] filterSymbols threw', err);
        }
      }

      if (!symbols.length) {
        setStatus(`No symbols for "${assetLabel}"`);
        return;
      }

      const SOFT_CAP = 500;
      if (symbols.length > SOFT_CAP) {
        const ok = window.confirm(
          `${assetLabel} contains ${symbols.length} symbols. Browse mode loads them all `
          + `(charts are fetched on demand as you pan).\n\nLoad all of them anyway?`
        );
        if (!ok) {
          setStatus('Browse cancelled');
          return;
        }
      }

      state.symbols = symbols;
      state.index = 0;
      state.assetClass = assetClass;
      state.assetLabel = assetLabel;

      await loadCurrent();
    }

    function step(delta) {
      if (!state.symbols.length) return false;
      const next = state.index + delta;
      if (next < 0 || next >= state.symbols.length) {
        const edge = next < 0 ? 'first' : 'last';
        setStatus(`Already at the ${edge} ${state.assetLabel} symbol`);
        return false;
      }
      state.index = next;
      void loadCurrent();
      return true;
    }

    button.addEventListener('click', () => {
      void browse();
    });

    document.addEventListener('keydown', (e) => {
      if (!state.symbols.length) return;
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      }
    });

    return {
      browse,
      next: () => step(1),
      prev: () => step(-1),
      getSymbols: () => state.symbols.slice(),
      getIndex: () => state.index,
    };
  }

  window.installBrowseAssetClass = installBrowseAssetClass;
})();
