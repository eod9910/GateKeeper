// =========================================================================
// copilot-core.js — State, contracts, settings, position sizing, P&L
// Split from copilot.js for maintainability. Load before copilot-chart.js.
// =========================================================================

    // State
    let chart = null;
    let candleSeries = null;
    let copilotMarkersPrimitive = null;
    let currentCandidate = null;
    let markerMode = null; // 'entry', 'stopLoss', or 'takeProfit'
    let entryPrice = null;
    let stopLossPrice = null;
    let takeProfitPrice = null;
    let entryLine = null;
    
    // Order type: 'market' (open) or 'limit' (planned)
    let orderType = 'market';
    
    // Saved drawings/annotations from Pattern Detector
    let savedDrawings = {};
    let drawingLines = []; // Store line references for cleanup
    let stopLossLine = null;
    let takeProfitLine = null;

    // Initialize
    document.addEventListener('DOMContentLoaded', async () => {
      loadSettings();
      loadSavedCandidates();
      initChart();
      await loadSymbolCatalog();
      initCopilotSymbolAutocomplete();
      
      // Check if we're loading a trade from Position Book
      const loadedTrade = typeof checkForTradeLoad === 'function'
        ? await checkForTradeLoad()
        : false;
      if (loadedTrade) return;

      // Auto-load symbol from URL params (e.g. from Scanner "Analyze in Trading Desk")
      const _urlParams = new URLSearchParams(window.location.search);
      const _urlSymbol   = (_urlParams.get('symbol')   || '').trim().toUpperCase();
      const _urlInterval = (_urlParams.get('interval') || '').trim();
      const _scannerHandoffId = (_urlParams.get('scannerHandoffId') || '').trim();
      let _scannerHandoff = null;

      if (_scannerHandoffId && window.ScannerTradingDeskHandoff?.consume) {
        _scannerHandoff = window.ScannerTradingDeskHandoff.consume(_scannerHandoffId);
        if (_scannerHandoff && typeof applyScannerTradingDeskHandoff === 'function') {
          applyScannerTradingDeskHandoff(_scannerHandoff);
        }
      }

      const _bootstrapSymbol = (_urlSymbol || _scannerHandoff?.symbol || '').trim().toUpperCase();
      const _bootstrapInterval = (_urlInterval || _scannerHandoff?.interval || '').trim();
      const _activeTradePlan = window.TradePlanStore?.getActivePlan ? window.TradePlanStore.getActivePlan() : null;
      const _matchingTradePlan = _activeTradePlan?.symbol
        && (!_bootstrapSymbol || String(_activeTradePlan.symbol).trim().toUpperCase() === _bootstrapSymbol)
          ? _activeTradePlan
          : (!_bootstrapSymbol ? _activeTradePlan : null);

      if (_matchingTradePlan && typeof window.queueTradePlanBootstrap === 'function') {
        window.queueTradePlanBootstrap(_matchingTradePlan);
      }

      if (_bootstrapSymbol) {
        const symbolInput   = document.getElementById('copilot-symbol');
        const intervalSelect = document.getElementById('copilot-interval');
        if (symbolInput) symbolInput.value = _bootstrapSymbol;
        if (intervalSelect && _bootstrapInterval) {
          // Set the matching option if it exists, otherwise leave default
          const option = Array.from(intervalSelect.options).find(o => o.value === _bootstrapInterval);
          if (option) intervalSelect.value = _bootstrapInterval;
        }
        if (typeof runCopilotAnalysis === 'function') {
          runCopilotAnalysis();
        }
      } else if (_matchingTradePlan?.symbol) {
        const symbolInput = document.getElementById('copilot-symbol');
        const intervalSelect = document.getElementById('copilot-interval');
        if (symbolInput) symbolInput.value = String(_matchingTradePlan.symbol).trim().toUpperCase();
        if (intervalSelect && _matchingTradePlan.interval) {
          const option = Array.from(intervalSelect.options).find((item) => item.value === _matchingTradePlan.interval);
          if (option) intervalSelect.value = _matchingTradePlan.interval;
        }
        if (typeof runCopilotAnalysis === 'function') {
          runCopilotAnalysis();
        }
      }
    });

    // ========== CONTRACT SPECIFICATIONS LOOKUP ==========
    // Maps symbols to their contract specs for auto-populating instrument settings and P&L calculation.
    // Futures: pointValue = dollar value per 1-point price move per contract
    const MARKET_SYMBOL_ALIASES = {
      'MSMES': 'MES=F',
      'MSMNQ': 'MNQ=F',
      'MSMYM': 'MYM=F',
      'MSM2K': 'M2K=F',
      'MES': 'MES=F',
      'MNQ': 'MNQ=F',
      'MYM': 'MYM=F',
      'M2K': 'M2K=F',
    };

    function normalizeTradingDeskSymbol(raw) {
      const input = String(raw || '').trim().toUpperCase();
      if (!input) return '';
      const collapsed = input.replace(/\s+/g, '');
      const unslashed = collapsed.replace(/^\//, '');
      return MARKET_SYMBOL_ALIASES[unslashed] || unslashed;
    }

    window.normalizeTradingDeskSymbol = normalizeTradingDeskSymbol;

    const CONTRACT_SPECS = {
      // --- Micro Index Futures ---
      'MES=F':  { type: 'futures', name: 'Micro E-mini S&P 500',    pointValue: 5,     tickSize: 0.25, margin: 2676  },
      'MNQ=F':  { type: 'futures', name: 'Micro E-mini Nasdaq-100', pointValue: 2,     tickSize: 0.25, margin: 1760  },
      'MYM=F':  { type: 'futures', name: 'Micro E-mini Dow',        pointValue: 0.50,  tickSize: 1.0,  margin: 880   },
      'M2K=F':  { type: 'futures', name: 'Micro E-mini Russell',    pointValue: 5,     tickSize: 0.10, margin: 660   },
      // --- E-mini Index Futures ---
      'ES=F':   { type: 'futures', name: 'E-mini S&P 500',          pointValue: 50,    tickSize: 0.25, margin: 13200 },
      'NQ=F':   { type: 'futures', name: 'E-mini Nasdaq-100',       pointValue: 20,    tickSize: 0.25, margin: 17600 },
      'YM=F':   { type: 'futures', name: 'E-mini Dow',              pointValue: 5,     tickSize: 1.0,  margin: 8800  },
      'RTY=F':  { type: 'futures', name: 'E-mini Russell 2000',     pointValue: 50,    tickSize: 0.10, margin: 6600  },
      // --- Metals ---
      'GC=F':   { type: 'futures', name: 'Gold',                    pointValue: 100,   tickSize: 0.10, margin: 10000 },
      'SI=F':   { type: 'futures', name: 'Silver',                  pointValue: 5000,  tickSize: 0.005,margin: 14000 },
      'MGC=F':  { type: 'futures', name: 'Micro Gold',              pointValue: 10,    tickSize: 0.10, margin: 1000  },
      'SIL=F':  { type: 'futures', name: 'Micro Silver',            pointValue: 1000,  tickSize: 0.005,margin: 1400  },
      // --- Energy ---
      'CL=F':   { type: 'futures', name: 'Crude Oil',               pointValue: 1000,  tickSize: 0.01, margin: 6000  },
      'NG=F':   { type: 'futures', name: 'Natural Gas',             pointValue: 10000, tickSize: 0.001,margin: 2500  },
      'MCL=F':  { type: 'futures', name: 'Micro Crude Oil',         pointValue: 100,   tickSize: 0.01, margin: 600   },
      'MNG=F':  { type: 'futures', name: 'Micro Natural Gas',       pointValue: 1000,  tickSize: 0.001,margin: 0     },
      'QM=F':   { type: 'futures', name: 'E-mini Crude Oil',        pointValue: 500,   tickSize: 0.025,margin: 3000  },
      // --- Micro Crypto Futures ---
      'MBT=F':  { type: 'futures', name: 'Micro Bitcoin',           pointValue: 0.1,   tickSize: 5,    margin: 0     },
      'MET=F':  { type: 'futures', name: 'Micro Ether',             pointValue: 0.1,   tickSize: 0.50, margin: 0     },
      // --- Grains ---
      'ZC=F':   { type: 'futures', name: 'Corn',                    pointValue: 50,    tickSize: 0.25, margin: 1500  },
      'ZW=F':   { type: 'futures', name: 'Wheat',                   pointValue: 50,    tickSize: 0.25, margin: 2000  },
      'ZS=F':   { type: 'futures', name: 'Soybeans',                pointValue: 50,    tickSize: 0.25, margin: 2500  },
      // --- Bonds / Rates ---
      'ZN=F':   { type: 'futures', name: '10-Year T-Note',          pointValue: 1000,  tickSize: 0.015625, margin: 2000 },
      'ZB=F':   { type: 'futures', name: '30-Year T-Bond',          pointValue: 1000,  tickSize: 0.03125,  margin: 3500 },
      'ZT=F':   { type: 'futures', name: '2-Year T-Note',           pointValue: 2000,  tickSize: 0.0078125,margin: 1000 },
      'ZF=F':   { type: 'futures', name: '5-Year T-Note',           pointValue: 1000,  tickSize: 0.0078125,margin: 1500 },
      // --- Forex (major pairs, pip values for standard lot) ---
      'EURUSD=X': { type: 'forex', name: 'EUR/USD', pipValue: 10, pipSize: 0.0001 },
      'GBPUSD=X': { type: 'forex', name: 'GBP/USD', pipValue: 10, pipSize: 0.0001 },
      'USDJPY=X': { type: 'forex', name: 'USD/JPY', pipValue: 6.7, pipSize: 0.01  },
      'AUDUSD=X': { type: 'forex', name: 'AUD/USD', pipValue: 10, pipSize: 0.0001 },
      'USDCAD=X': { type: 'forex', name: 'USD/CAD', pipValue: 7.5, pipSize: 0.0001 },
      'USDCHF=X': { type: 'forex', name: 'USD/CHF', pipValue: 10, pipSize: 0.0001 },
      'NZDUSD=X': { type: 'forex', name: 'NZD/USD', pipValue: 10, pipSize: 0.0001 },
      // --- Crypto ---
      'BTC-USD':  { type: 'crypto', name: 'Bitcoin',  exchangeFee: 0.1 },
      'ETH-USD':  { type: 'crypto', name: 'Ethereum', exchangeFee: 0.1 },
      'SOL-USD':  { type: 'crypto', name: 'Solana',   exchangeFee: 0.1 },
      'DOGE-USD': { type: 'crypto', name: 'Dogecoin', exchangeFee: 0.1 },
    };

    // Helper: look up specs for a symbol (strips =F suffix for matching)
    function getContractSpec(symbol) {
      if (!symbol) return null;
      const upper = normalizeTradingDeskSymbol(symbol);
      if (CONTRACT_SPECS[upper]) return CONTRACT_SPECS[upper];
      // Try with =F suffix for futures typed without it
      if (CONTRACT_SPECS[upper + '=F']) return CONTRACT_SPECS[upper + '=F'];
      return null;
    }

    // Detect instrument type from symbol
    function detectInstrumentType(symbol) {
      if (!symbol) return 'stock';
      const upper = normalizeTradingDeskSymbol(symbol);
      const spec = getContractSpec(upper);
      if (spec) return spec.type;
      if (upper.endsWith('=F')) return 'futures';
      if (upper.endsWith('=X')) return 'forex';
      if (upper.includes('-USD') || upper.includes('-USDT')) return 'crypto';
      return 'stock';
    }

    // Symbol lists for autocomplete (loaded from API; fallback keeps page usable)
    const FALLBACK_COPILOT_SYMBOL_LISTS = {
      commodities: [],
      futures: [],
      indices: ["SPY", "QQQ"],
      sectors: [],
      international: [],
      bonds: [],
      smallcaps: [],
      all: ["SPY", "QQQ"],
    };
    let COPILOT_SYMBOL_LISTS = { ...FALLBACK_COPILOT_SYMBOL_LISTS };

    function normalizeCopilotSymbolLists(raw) {
      const keys = ['commodities', 'futures', 'indices', 'sectors', 'international', 'bonds', 'smallcaps'];
      const src = raw && typeof raw === 'object' ? raw : {};
      const out = {};
      for (const key of keys) {
        const arr = Array.isArray(src[key]) ? src[key] : [];
        out[key] = Array.from(new Set(arr.map(s => String(s || '').trim().toUpperCase()).filter(Boolean)));
      }
      const allSet = new Set(Array.isArray(src.all) ? src.all.map(s => String(s || '').trim().toUpperCase()).filter(Boolean) : []);
      for (const key of keys) out[key].forEach(sym => allSet.add(sym));
      out.all = Array.from(allSet);
      return out;
    }

    async function loadSymbolCatalog() {
      try {
        const res = await fetch('/api/candidates/symbols');
        const data = await res.json();
        if (!data || !data.success || !data.data) throw new Error(data?.error || 'Failed to load symbol catalog');
        COPILOT_SYMBOL_LISTS = normalizeCopilotSymbolLists(data.data);
      } catch (err) {
        console.warn('Failed to load Trading Desk symbol catalog, using fallback:', err.message || err);
        COPILOT_SYMBOL_LISTS = { ...FALLBACK_COPILOT_SYMBOL_LISTS };
      }
    }

    // Auto-populate instrument settings from CONTRACT_SPECS when symbol changes
    function autoPopulateInstrumentSettings(symbol) {
      if (!symbol) return;
      const upper = normalizeTradingDeskSymbol(symbol);
      const detectedType = detectInstrumentType(upper);
      const spec = getContractSpec(upper);

      const input = document.getElementById('copilot-symbol');
      if (input && input.value !== upper) {
        input.value = upper;
      }

      // Switch the instrument type dropdown
      const typeSelect = document.getElementById('instrument-type');
      if (typeSelect.value !== detectedType) {
        typeSelect.value = detectedType;
        toggleInstrumentSettings();
      }

      // Fill in instrument-specific fields from the spec
      if (detectedType === 'futures' && spec) {
        document.getElementById('futures-point-value').value = spec.pointValue;
        document.getElementById('futures-margin').value = spec.margin;
        document.getElementById('futures-tick-size').value = spec.tickSize;
      } else if (detectedType === 'forex' && spec) {
        document.getElementById('pip-value').value = spec.pipValue;
      } else if (detectedType === 'crypto' && spec) {
        document.getElementById('exchange-fee').value = spec.exchangeFee;
      }

      saveSettings();
    }

    function initCopilotSymbolAutocomplete() {
      const input = document.getElementById('copilot-symbol');
      const suggestionsEl = document.getElementById('copilot-symbol-suggestions');
      if (!input || !suggestionsEl) return;

      // Auto-populate on blur (when user finishes typing)
      input.addEventListener('change', () => autoPopulateInstrumentSettings(input.value.trim()));

      function getSymbolsList() {
        const allSymbols = new Set();
        Object.values(COPILOT_SYMBOL_LISTS).forEach(list => list.forEach(s => allSymbols.add(s)));
        savedChartsList.forEach(item => item.symbol && allSymbols.add(item.symbol));
        return Array.from(allSymbols).sort();
      }

      let selectedIdx = -1;
      let filtered = [];

      function showSuggestions(q, highlightIdx) {
        const qq = (q || '').toUpperCase().trim();
        if (!qq) {
          suggestionsEl.classList.add('hidden');
          suggestionsEl.innerHTML = '';
          selectedIdx = -1;
          return;
        }
        const symbolsList = getSymbolsList();
        filtered = symbolsList.filter(s => s.toUpperCase().startsWith(qq) || s.toUpperCase().includes(qq));
        filtered = filtered.slice(0, 12);
        if (highlightIdx === undefined) selectedIdx = -1;
        else selectedIdx = Math.max(-1, Math.min(highlightIdx, filtered.length - 1));

        if (filtered.length === 0) {
          suggestionsEl.classList.add('hidden');
          suggestionsEl.innerHTML = '';
          selectedIdx = -1;
          return;
        }

        suggestionsEl.innerHTML = filtered.map((sym, i) =>
          `<div style="padding:var(--space-8) var(--space-12);cursor:pointer;font-size:var(--text-small);font-family:var(--font-mono);background:${i === selectedIdx ? 'var(--color-accent-dim, rgba(99,102,241,.18))' : 'transparent'};color:${i === selectedIdx ? 'var(--color-text)' : 'var(--color-text-muted)'};" data-symbol="${sym}" data-idx="${i}" onmouseover="this.style.background='var(--color-accent-dim,rgba(99,102,241,.18))';this.style.color='var(--color-text)'" onmouseout="this.style.background='${i === selectedIdx ? 'var(--color-accent-dim,rgba(99,102,241,.18))' : 'transparent'}';this.style.color='${i === selectedIdx ? 'var(--color-text)' : 'var(--color-text-muted)'}'">${sym}</div>`
        ).join('');
        suggestionsEl.classList.remove('hidden');
      }

      function hideSuggestions() {
        suggestionsEl.classList.add('hidden');
        suggestionsEl.innerHTML = '';
        selectedIdx = -1;
      }

      function selectSymbol(sym, andRun = false) {
        const normalized = normalizeTradingDeskSymbol(sym);
        input.value = normalized || sym;
        hideSuggestions();
        input.focus();
        autoPopulateInstrumentSettings(normalized || sym);
        if (andRun && typeof runCopilotAnalysis === 'function') runCopilotAnalysis();
      }

      input.addEventListener('input', () => showSuggestions(input.value));
      input.addEventListener('focus', () => showSuggestions(input.value));
      input.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && !suggestionsEl.classList.contains('hidden') && filtered.length > 0) {
          e.preventDefault();
          showSuggestions(input.value, selectedIdx + 1);
          suggestionsEl.querySelector(`[data-idx="${selectedIdx}"]`)?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'ArrowUp' && !suggestionsEl.classList.contains('hidden') && filtered.length > 0) {
          e.preventDefault();
          showSuggestions(input.value, selectedIdx - 1);
          suggestionsEl.querySelector(`[data-idx="${selectedIdx}"]`)?.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'Escape') {
          hideSuggestions();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!suggestionsEl.classList.contains('hidden') && filtered.length > 0) {
            if (selectedIdx >= 0 && filtered[selectedIdx]) {
              selectSymbol(filtered[selectedIdx], true);
              return;
            }
            if (filtered[0]) {
              selectSymbol(filtered[0], true);
              return;
            }
          }

          const typed = input.value.trim().toUpperCase();
          if (typed) {
            selectSymbol(typed, true);
          }
        }
      });

      suggestionsEl.addEventListener('mousedown', (e) => {
        const row = e.target.closest('[data-symbol]');
        if (row) {
          e.preventDefault();
          selectSymbol(row.dataset.symbol, true);
        }
      });

      // Fallback for normal click interactions (in addition to mousedown)
      suggestionsEl.addEventListener('click', (e) => {
        const row = e.target.closest('[data-symbol]');
        if (row) {
          e.preventDefault();
          selectSymbol(row.dataset.symbol, true);
        }
      });
    }

    // ========== SIDEBAR FUNCTIONS ==========
    // Sidebar toggle & state restore handled by app.js

    function toggleSection(sectionId) {
      var section = document.getElementById(sectionId);
      if (!section) return;
      section.classList.toggle('collapsed');
      // Persist collapsed sections in localStorage
      var key = 'section-collapsed';
      var stored = {};
      try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
      stored[sectionId] = section.classList.contains('collapsed');
      localStorage.setItem(key, JSON.stringify(stored));
    }

    // Restore collapsed sections on load
    (function restoreSectionStates() {
      try {
        var stored = JSON.parse(localStorage.getItem('section-collapsed') || '{}');
        Object.keys(stored).forEach(function(id) {
          if (stored[id]) {
            var el = document.getElementById(id);
            if (el) el.classList.add('collapsed');
          }
        });
      } catch(e) {}
    })();

    // ========== SETTINGS FUNCTIONS ==========

    function toggleInstrumentSettings() {
      const type = document.getElementById('instrument-type').value;
      // Hide all instrument panels
      document.getElementById('futures-settings').classList.add('hidden');
      document.getElementById('options-settings').classList.add('hidden');
      document.getElementById('forex-settings').classList.add('hidden');
      document.getElementById('crypto-settings').classList.add('hidden');
      // Show the selected one
      const panelMap = { futures: 'futures-settings', options: 'options-settings', forex: 'forex-settings', crypto: 'crypto-settings' };
      if (panelMap[type]) document.getElementById(panelMap[type]).classList.remove('hidden');
      
      // Update position size label based on instrument type
      const unitLabels = { stock: 'shares', futures: 'contracts', options: 'contracts', forex: 'lots', crypto: 'units' };
      const unitEl = document.getElementById('position-size-unit');
      if (unitEl) unitEl.textContent = unitLabels[type] || 'shares';
      
      // Update step size â€” stocks allow larger quantities, others typically small
      const input = document.getElementById('manual-position-size');
      if (input) {
        if (type === 'stock') {
          input.step = '10';
          input.min = '1';
        } else if (type === 'forex') {
          input.step = '1';
          input.min = '1';
        } else {
          input.step = '1';
          input.min = '1';
        }
      }
      
      // Update tick-step on price level inputs when instrument changes
      updatePriceInputSteps();
      
      // Options-specific UI: relabel inputs, disable stop loss
      applyOptionsMode(type === 'options');
      if (typeof window.syncExecutionRouteSelection === 'function') {
        window.syncExecutionRouteSelection(true);
      }
    }

    // Apply or remove Options mode on the trade level inputs
    function applyOptionsMode(isOptions) {
      const entryInput = document.getElementById('entry-price-input');
      const stopInput = document.getElementById('stop-loss-price-input');
      const tpInput = document.getElementById('take-profit-price-input');
      const entryContainer = entryInput?.parentElement; // the wrapping div
      const stopContainer = stopInput?.parentElement;
      const rrContainer = document.getElementById('risk-reward')?.parentElement;
      const tpLabel = tpInput?.parentElement?.querySelector('.text-gray-400');
      
      // Entry/Stop/TP buttons
      const btnEntry = document.getElementById('btn-entry');
      const btnStop = document.getElementById('btn-stop-loss');
      const btnTP = document.getElementById('btn-take-profit');
      
      // Tip text
      const tipEl = document.querySelector('#trade-levels .italic');
      
      if (isOptions) {
        // Hide entry and stop inputs entirely â€” premiums come from sidebar
        if (entryContainer) entryContainer.classList.add('hidden');
        if (stopContainer) stopContainer.classList.add('hidden');
        
        // Relabel TP as stock price target
        if (tpLabel) tpLabel.textContent = 'Stock Price Target';
        if (tpInput) tpInput.title = 'Click chart or type the stock price you expect';
        
        // R:R shows % return for options
        if (rrContainer) {
          const rrLabel = rrContainer.querySelector('.text-gray-400');
          if (rrLabel) rrLabel.textContent = '% Return';
        }
        
        // Auto-fill entry from sidebar entry premium (internally)
        const settings = getSettings();
        if (settings.optionPrice > 0) {
          entryPrice = settings.optionPrice;
        }
        stopLossPrice = 0;
        
        // Hide entry/stop chart-click buttons, keep TP
        if (btnEntry) { btnEntry.classList.add('hidden'); }
        if (btnStop) { btnStop.classList.add('hidden'); }
        if (btnTP) { btnTP.textContent = 'Set Price Target'; }
        
        // Update tip text
        if (tipEl) tipEl.textContent = 'Click chart to set stock price target. P&L uses intrinsic value at that price.';
        
        // Update options P&L summary in sidebar
        updateOptionsPnLSummary();
      } else {
        // Show entry and stop inputs
        if (entryContainer) entryContainer.classList.remove('hidden');
        if (stopContainer) stopContainer.classList.remove('hidden');
        
        // Restore labels
        const tpLabelRestore = tpInput?.parentElement?.querySelector('.text-gray-400');
        if (tpLabelRestore) tpLabelRestore.textContent = 'Take Profit';
        if (tpInput) tpInput.title = 'Type price or click chart to set take profit';
        
        // Restore R:R label
        if (rrContainer) {
          const rrLabel = rrContainer.querySelector('.text-gray-400');
          if (rrLabel) rrLabel.textContent = 'Risk/Reward';
        }
        
        // Re-enable stop loss
        if (stopInput) {
          stopInput.disabled = false;
          stopInput.style.opacity = '1';
        }
        
        // Restore chart-click buttons
        if (btnEntry) { btnEntry.classList.remove('hidden'); }
        if (btnStop) { btnStop.classList.remove('hidden'); }
        if (btnTP) { btnTP.textContent = 'Set Take Profit'; }
        
        // Restore tip
        if (tipEl) tipEl.textContent = 'Tip: drag lines on chart or type prices above to adjust levels';
        
        // Hide options P&L summary
        const summary = document.getElementById('options-pnl-summary');
        if (summary) summary.classList.add('hidden');
      }
    }

    // Called when entry premium or current premium changes in sidebar
    function onOptionPremiumChange() {
      saveSettings();
      
      const settings = getSettings();
      const entryInput = document.getElementById('entry-price-input');
      
      // Sync sidebar entry premium to the trade level entry input
      if (settings.instrumentType === 'options' && entryInput && settings.optionPrice > 0) {
        entryInput.value = settings.optionPrice.toFixed(2);
        entryPrice = settings.optionPrice;
        // Update entry line on chart (shows premium level for reference)
        if (entryLine && candleSeries) {
          candleSeries.removePriceLine(entryLine);
        }
        // Don't draw entry line on chart for options â€” premium != stock price
        entryLine = null;
      }
      
      // Auto-set stop loss to 0 for options (max loss = premium)
      stopLossPrice = 0;
      
      updateOptionsPnLSummary();
      updateLivePnL();
      if (typeof window.renderExecutionRouteSummary === 'function') {
        window.renderExecutionRouteSummary();
      }
    }

    // Update the options P&L summary in the sidebar
    function updateOptionsPnLSummary() {
      const summary = document.getElementById('options-pnl-summary');
      if (!summary) return;
      
      const settings = getSettings();
      if (settings.instrumentType !== 'options') {
        summary.classList.add('hidden');
        return;
      }
      
      const sizingContext = getPositionSizingContext(settings, settings.optionPrice || entryPrice || 0, 0);
      const contracts = sizingContext.effectiveSizing?.units || 0;
      const result = calcOptionsPremiumPnL(settings, contracts);
      
      if (!result || contracts <= 0) {
        summary.classList.add('hidden');
        return;
      }
      
      summary.classList.remove('hidden');
      
      // Live P&L
      const livePnlEl = document.getElementById('options-live-pnl-display');
      if (livePnlEl) {
        if (result.livePnL !== null) {
          livePnlEl.textContent = `${result.livePnL >= 0 ? '+' : ''}$${result.livePnL.toFixed(2)}`;
          livePnlEl.className = `font-bold ${result.livePnL >= 0 ? 'text-green-400' : 'text-red-400'}`;
        } else {
          livePnlEl.textContent = '--';
          livePnlEl.className = 'font-bold';
        }
      }
      
      // Max Loss
      const maxLossEl = document.getElementById('options-max-loss-display');
      if (maxLossEl) {
        maxLossEl.textContent = `-$${result.maxLoss.toFixed(2)}`;
      }
      
      // Breakeven
      const beEl = document.getElementById('options-breakeven-display');
      if (beEl) {
        if (result.breakeven !== null) {
          beEl.textContent = `$${result.breakeven.toFixed(2)}`;
        } else {
          beEl.textContent = '--';
        }
      }
    }

    // Legacy alias for backwards compatibility
    function toggleFuturesSettings() { toggleInstrumentSettings(); }

    function saveSettings() {
      let existingSettings = {};
      try {
        existingSettings = JSON.parse(localStorage.getItem('copilotSettings') || '{}') || {};
      } catch (error) {
        existingSettings = {};
      }

      const settings = {
        ...existingSettings,
        // Account
        accountSize: document.getElementById('account-size').value,
        availableBalance: document.getElementById('available-balance').value,
        dailyLossLimit: document.getElementById('daily-loss-limit').value,
        maxOpenPositions: document.getElementById('max-open-positions').value,
        // Instrument
        instrumentType: document.getElementById('instrument-type').value,
        manualPositionSize: document.getElementById('manual-position-size').value,
        // Futures
        futuresMargin: document.getElementById('futures-margin').value,
        futuresPointValue: document.getElementById('futures-point-value').value,
        futuresTickSize: document.getElementById('futures-tick-size').value,
        // Options
        optionStrike: document.getElementById('option-strike').value,
        optionExpiry: document.getElementById('option-expiry').value,
        optionPrice: document.getElementById('option-price').value,
        optionCurrentPremium: document.getElementById('option-current-premium').value,
        optionType: document.getElementById('option-type').value,
        contractMultiplier: document.getElementById('contract-multiplier').value,
        // Forex
        lotSize: document.getElementById('lot-size').value,
        pipValue: document.getElementById('pip-value').value,
        leverage: document.getElementById('leverage').value,
        // Crypto
        exchangeFee: document.getElementById('exchange-fee').value,
        // Risk Rules
        riskPercent: document.getElementById('risk-percent').value,
        minRR: document.getElementById('min-rr').value,
        maxPosition: document.getElementById('max-position').value,
        maxDailyTrades: document.getElementById('max-daily-trades').value,
        maxConsecutiveLosses: document.getElementById('max-consecutive-losses').value,
        maxDrawdown: document.getElementById('max-drawdown').value,
        requireApproval: document.getElementById('require-approval').checked,
        // Analysis
        swingSensitivity: document.getElementById('swing-sensitivity').value,
        // AI
        aiProvider: document.getElementById('ai-provider').value,
        aiModel: document.getElementById('ai-model').value,
        aiTemperature: document.getElementById('ai-temperature').value,
      };
      localStorage.setItem('copilotSettings', JSON.stringify(settings));
    }

    function loadSettings() {
      const saved = localStorage.getItem('copilotSettings');
      if (!saved) return;
      
      try {
        applyTradingDeskSettingsSnapshot(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }

    function applyTradingDeskSettingsSnapshot(settings) {
      if (!settings || typeof settings !== 'object') return;
      const fieldMap = {
        'account-size': 'accountSize',
        'available-balance': 'availableBalance',
        'daily-loss-limit': 'dailyLossLimit',
        'max-open-positions': 'maxOpenPositions',
        'instrument-type': 'instrumentType',
        'manual-position-size': 'manualPositionSize',
        'futures-margin': 'futuresMargin',
        'futures-point-value': 'futuresPointValue',
        'futures-tick-size': 'futuresTickSize',
        'option-strike': 'optionStrike',
        'option-expiry': 'optionExpiry',
        'option-price': 'optionPrice',
        'option-current-premium': 'optionCurrentPremium',
        'option-type': 'optionType',
        'contract-multiplier': 'contractMultiplier',
        'lot-size': 'lotSize',
        'pip-value': 'pipValue',
        'leverage': 'leverage',
        'exchange-fee': 'exchangeFee',
        'risk-percent': 'riskPercent',
        'min-rr': 'minRR',
        'max-position': 'maxPosition',
        'max-daily-trades': 'maxDailyTrades',
        'max-consecutive-losses': 'maxConsecutiveLosses',
        'max-drawdown': 'maxDrawdown',
        'swing-sensitivity': 'swingSensitivity',
        'ai-provider': 'aiProvider',
        'ai-model': 'aiModel',
      };
      for (const [elemId, key] of Object.entries(fieldMap)) {
        const el = document.getElementById(elemId);
        if (el && settings[key] !== undefined && settings[key] !== null) {
          el.value = settings[key];
        }
      }
      if (settings.aiTemperature !== undefined && settings.aiTemperature !== null) {
        document.getElementById('ai-temperature').value = settings.aiTemperature;
        updateTempDisplay();
      }
      if (settings.requireApproval !== undefined) {
        document.getElementById('require-approval').checked = settings.requireApproval;
      }
      toggleInstrumentSettings();
      updateSwingSensitivityLabel();
      const savedSize = parseInt(document.getElementById('manual-position-size').value);
      manualSizeOverride = savedSize && savedSize > 0 ? savedSize : null;
    }
    window.applyTradingDeskSettingsSnapshot = applyTradingDeskSettingsSnapshot;

    function updateSwingSensitivityLabel() {
      const slider = document.getElementById('swing-sensitivity');
      const label = document.getElementById('swing-sensitivity-label');
      if (slider && label) label.textContent = slider.value;
    }
    // Update label on input (live while dragging)
    document.getElementById('swing-sensitivity')?.addEventListener('input', updateSwingSensitivityLabel);

    function updateTempDisplay() {
      document.getElementById('temp-value').textContent = document.getElementById('ai-temperature').value;
    }

    function getSettings() {
      return {
        // Account
        accountSize: parseFloat(document.getElementById('account-size').value) || 50000,
        availableBalance: parseFloat(document.getElementById('available-balance').value) || 50000,
        dailyLossLimit: parseFloat(document.getElementById('daily-loss-limit').value) || 5,
        maxOpenPositions: parseInt(document.getElementById('max-open-positions').value) || 5,
        // Instrument
        instrumentType: document.getElementById('instrument-type').value || 'stock',
        // Futures
        futuresMargin: parseFloat(document.getElementById('futures-margin').value) || 10000,
        futuresPointValue: parseFloat(document.getElementById('futures-point-value').value) || 5000,
        futuresTickSize: parseFloat(document.getElementById('futures-tick-size').value) || 0.005,
        // Options
        optionStrike: parseFloat(document.getElementById('option-strike').value) || 0,
        optionExpiry: document.getElementById('option-expiry').value || '',
        optionPrice: parseFloat(document.getElementById('option-price').value) || 0, // Entry premium
        optionCurrentPremium: parseFloat(document.getElementById('option-current-premium').value) || 0,
        optionType: document.getElementById('option-type').value || 'call',
        contractMultiplier: parseInt(document.getElementById('contract-multiplier').value) || 100,
        // Forex
        lotSize: document.getElementById('lot-size').value || 'standard',
        pipValue: parseFloat(document.getElementById('pip-value').value) || 10,
        leverage: parseInt(document.getElementById('leverage').value) || 50,
        // Crypto
        exchangeFee: parseFloat(document.getElementById('exchange-fee').value) || 0.1,
        // Risk Rules
        riskPercent: parseFloat(document.getElementById('risk-percent').value) || 2,
        minRR: parseFloat(document.getElementById('min-rr').value) || 1.5,
        maxPosition: parseFloat(document.getElementById('max-position').value) || 25,
        maxDailyTrades: parseInt(document.getElementById('max-daily-trades').value) || 3,
        maxConsecutiveLosses: parseInt(document.getElementById('max-consecutive-losses').value) || 3,
        maxDrawdown: parseFloat(document.getElementById('max-drawdown').value) || 10,
        requireApproval: document.getElementById('require-approval').checked,
        // Analysis
        swingSensitivity: parseInt(document.getElementById('swing-sensitivity').value) || 5,
        // AI
        aiProvider: document.getElementById('ai-provider').value,
        aiModel: document.getElementById('ai-model').value,
        aiTemperature: parseFloat(document.getElementById('ai-temperature').value) || 0.7,
      };
    }

    // ========== POSITION SIZING FUNCTIONS ==========

    function calculatePositionSize(settings, entryPx, stopPx) {
      const riskBudget = settings.accountSize * (settings.riskPercent / 100);
      const priceDiff = Math.abs(entryPx - stopPx);
      
      switch (settings.instrumentType) {
        case 'futures': return sizeFutures(settings, riskBudget, priceDiff);
        case 'options': return sizeOptions(settings, riskBudget, priceDiff, entryPx);
        case 'forex':   return sizeForex(settings, riskBudget, priceDiff);
        case 'crypto':  return sizeCrypto(settings, riskBudget, priceDiff, entryPx);
        default:        return sizeStock(settings, riskBudget, priceDiff, entryPx);
      }
    }

    function getManualPositionSizeValue() {
      const input = document.getElementById('manual-position-size');
      const raw = String(input?.value || '').trim();
      if (!raw) return manualSizeOverride !== null ? manualSizeOverride : null;
      const val = parseInt(raw, 10);
      return Number.isFinite(val) && val > 0 ? val : null;
    }

    function buildSizingForUnits(settings, entryPx, stopPx, units) {
      const normalizedUnits = Number(units);
      if (!Number.isFinite(normalizedUnits) || normalizedUnits <= 0) {
        return {
          units: 0,
          unitLabel: settings.instrumentType === 'forex' ? 'lots' : 'shares',
          positionValue: 0,
          maxLoss: 0,
          requiredCapital: 0,
          details: '0 units'
        };
      }

      const sym = document.getElementById('copilot-symbol')?.value?.trim().toUpperCase() || '';
      const spec = getContractSpec(sym);
      const stopDist = Math.abs(Number(entryPx || 0) - Number(stopPx || 0));

      switch (settings.instrumentType) {
        case 'futures': {
          const pointValue = settings.futuresPointValue || spec?.pointValue || 1;
          const margin = settings.futuresMargin || spec?.margin || 0;
          const positionValue = normalizedUnits * margin;
          const maxLoss = normalizedUnits * stopDist * pointValue;
          return {
            units: normalizedUnits,
            unitLabel: normalizedUnits === 1 ? 'contract' : 'contracts',
            positionValue,
            maxLoss,
            requiredCapital: positionValue,
            details: `${normalizedUnits} contract${normalizedUnits !== 1 ? 's' : ''} | Margin: $${positionValue.toLocaleString()} | Risk/contract: $${(stopDist * pointValue).toLocaleString()}`
          };
        }
        case 'options': {
          const premiumPerContract = (settings.optionPrice || 0) * (settings.contractMultiplier || 100);
          const totalPremium = normalizedUnits * premiumPerContract;
          return {
            units: normalizedUnits,
            unitLabel: normalizedUnits === 1 ? 'contract' : 'contracts',
            positionValue: totalPremium,
            maxLoss: totalPremium,
            requiredCapital: totalPremium,
            details: `${normalizedUnits} ${settings.optionType || 'option'} contract${normalizedUnits !== 1 ? 's' : ''} @ $${(settings.optionPrice || 0).toFixed(2)} x ${settings.contractMultiplier || 100} = $${totalPremium.toLocaleString()} premium`
          };
        }
        case 'forex': {
          const lotUnits = { standard: 100000, mini: 10000, micro: 1000 };
          const unitsPerLot = lotUnits[settings.lotSize] || 100000;
          const pipSize = spec?.pipSize || 0.0001;
          const pipValue = settings.pipValue || spec?.pipValue || 10;
          const pipScale = unitsPerLot / 100000;
          const pips = pipSize > 0 ? stopDist / pipSize : 0;
          const riskPerLot = pips * pipValue * pipScale;
          const notionalValue = normalizedUnits * unitsPerLot;
          const marginRequired = settings.leverage > 0 ? notionalValue / settings.leverage : notionalValue;
          return {
            units: normalizedUnits,
            unitLabel: normalizedUnits === 1 ? `${settings.lotSize} lot` : `${settings.lotSize} lots`,
            positionValue: marginRequired,
            maxLoss: normalizedUnits * riskPerLot,
            requiredCapital: marginRequired,
            details: `${normalizedUnits} ${settings.lotSize} lots | Notional: $${notionalValue.toLocaleString()} | Margin: $${marginRequired.toLocaleString()} (${settings.leverage}:1)`
          };
        }
        case 'crypto': {
          const positionValue = normalizedUnits * entryPx;
          const grossRisk = normalizedUnits * stopDist;
          const feesCost = positionValue * ((settings.exchangeFee || 0) / 100) * 2;
          return {
            units: normalizedUnits,
            unitLabel: 'units',
            positionValue,
            maxLoss: grossRisk + feesCost,
            requiredCapital: positionValue,
            details: `${normalizedUnits} units @ $${entryPx.toFixed(2)} = $${positionValue.toLocaleString()} | Est. fees: $${feesCost.toFixed(2)}`
          };
        }
        default: {
          const positionValue = normalizedUnits * entryPx;
          const maxLoss = normalizedUnits * stopDist;
          return {
            units: normalizedUnits,
            unitLabel: normalizedUnits === 1 ? 'share' : 'shares',
            positionValue,
            maxLoss,
            requiredCapital: positionValue,
            details: `${normalizedUnits} shares @ $${entryPx.toFixed(2)} = $${positionValue.toLocaleString()}`
          };
        }
      }
    }

    function getPositionSizingContext(settings, entryPx, stopPx) {
      const autoSizing = calculatePositionSize(settings, entryPx, stopPx);
      const manualUnits = getManualPositionSizeValue();
      if (manualUnits === null) {
        autoSizing._autoUnits = autoSizing.units;
        autoSizing._manualOverride = false;
        return { autoSizing, effectiveSizing: autoSizing, manualUnits: null };
      }

      const effectiveSizing = buildSizingForUnits(settings, entryPx, stopPx, manualUnits);
      effectiveSizing._autoUnits = autoSizing.units;
      effectiveSizing._manualOverride = true;
      return { autoSizing, effectiveSizing, manualUnits };
    }

    function sizeStock(settings, riskBudget, riskPerShare, entryPx) {
      const shares = Math.floor(riskBudget / riskPerShare);
      const positionValue = shares * entryPx;
      const maxLoss = shares * riskPerShare;
      return {
        units: shares,
        unitLabel: shares === 1 ? 'share' : 'shares',
        positionValue,
        maxLoss,
        requiredCapital: positionValue,
        details: `${shares} shares @ $${entryPx.toFixed(2)} = $${positionValue.toLocaleString()}`
      };
    }

    function sizeFutures(settings, riskBudget, priceDiff) {
      const riskPerContract = priceDiff * settings.futuresPointValue;
      const contractsByRisk = Math.floor(riskBudget / riskPerContract);
      const contractsByMargin = settings.futuresMargin > 0 ? Math.floor(settings.accountSize / settings.futuresMargin) : 0;
      let contracts = Math.max(0, Math.min(contractsByRisk, contractsByMargin));
      let limitedBy = contractsByRisk <= contractsByMargin ? 'risk budget' : 'margin';
      let riskWarning = '';

      // If risk budget gives 0 contracts but margin allows at least 1,
      // allow 1 contract â€” the trader accepts higher risk per trade
      if (contracts === 0 && contractsByMargin >= 1 && riskPerContract > 0) {
        contracts = 1;
        const actualRiskPct = (riskPerContract / settings.accountSize * 100).toFixed(1);
        limitedBy = 'minimum (1 contract)';
        riskWarning = ` | âš ï¸ Risk: ${actualRiskPct}% of account (exceeds ${settings.riskPercent}% target)`;
      }

      const totalMargin = contracts * settings.futuresMargin;
      const maxLoss = contracts * riskPerContract;
      return {
        units: contracts,
        unitLabel: contracts === 1 ? 'contract' : 'contracts',
        positionValue: totalMargin,
        maxLoss,
        requiredCapital: totalMargin,
        details: `${contracts} contract${contracts !== 1 ? 's' : ''} | Margin: $${totalMargin.toLocaleString()} | Risk/contract: $${riskPerContract.toLocaleString()} | Limited by: ${limitedBy}${riskWarning}`
      };
    }

    function sizeOptions(settings, riskBudget, priceDiff, entryPx) {
      const premiumPerContract = settings.optionPrice * settings.contractMultiplier;
      // For long options, max loss = premium paid
      const contracts = Math.floor(riskBudget / premiumPerContract);
      const totalPremium = contracts * premiumPerContract;
      return {
        units: contracts,
        unitLabel: contracts === 1 ? 'contract' : 'contracts',
        positionValue: totalPremium,
        maxLoss: totalPremium, // Long options: max loss = premium
        requiredCapital: totalPremium,
        details: `${contracts} ${settings.optionType} contracts @ $${settings.optionPrice.toFixed(2)} x ${settings.contractMultiplier} = $${totalPremium.toLocaleString()} premium`
      };
    }

    function sizeForex(settings, riskBudget, pipDiff) {
      const lotUnits = { standard: 100000, mini: 10000, micro: 1000 };
      const unitsPerLot = lotUnits[settings.lotSize] || 100000;
      // Risk per lot = pip difference * pip value (adjusted for lot size)
      // pipValue from settings is for a standard lot; scale for mini/micro
      const pipScale = unitsPerLot / 100000;
      const riskPerLot = pipDiff * settings.pipValue * pipScale;
      const lots = Math.floor(riskBudget / riskPerLot);
      const notionalValue = lots * unitsPerLot;
      const marginRequired = notionalValue / settings.leverage;
      const maxLoss = lots * riskPerLot;
      return {
        units: lots,
        unitLabel: lots === 1 ? `${settings.lotSize} lot` : `${settings.lotSize} lots`,
        positionValue: marginRequired,
        maxLoss,
        requiredCapital: marginRequired,
        details: `${lots} ${settings.lotSize} lots | Notional: $${notionalValue.toLocaleString()} | Margin: $${marginRequired.toLocaleString()} (${settings.leverage}:1)`
      };
    }

    function sizeCrypto(settings, riskBudget, riskPerUnit, entryPx) {
      // Crypto allows fractional units
      const rawUnits = riskBudget / riskPerUnit;
      const units = parseFloat(rawUnits.toFixed(6)); // 6 decimal places
      const positionValue = units * entryPx;
      const maxLoss = units * riskPerUnit;
      const feesCost = positionValue * (settings.exchangeFee / 100) * 2; // buy + sell
      return {
        units,
        unitLabel: 'units',
        positionValue,
        maxLoss: maxLoss + feesCost,
        requiredCapital: positionValue,
        details: `${units} units @ $${entryPx.toFixed(2)} = $${positionValue.toLocaleString()} | Est. fees: $${feesCost.toFixed(2)}`
      };
    }

    // ========== P&L CALCULATION ENGINE ==========
    // direction: 1 = long, -1 = short

    function calcStockPnL(entryPrice, exitPrice, shares, direction = 1) {
      return (exitPrice - entryPrice) * shares * direction;
    }

    function calcFuturesPnL(entryPrice, exitPrice, pointValue, contracts, direction = 1) {
      return (exitPrice - entryPrice) * pointValue * contracts * direction;
    }

    function calcOptionsPnL(entryPremium, exitPremium, contractMultiplier, contracts) {
      // For long options, P&L = (exit premium - entry premium) * multiplier * contracts
      return (exitPremium - entryPremium) * contractMultiplier * contracts;
    }

    // Options premium-based P&L using sidebar fields
    function calcOptionsPremiumPnL(settings, contracts) {
      const entry = settings.optionPrice; // entry premium per share
      const current = settings.optionCurrentPremium; // current premium per share
      const mult = settings.contractMultiplier;
      if (!entry || entry <= 0 || !contracts || contracts <= 0) return null;
      return {
        livePnL: current > 0 ? (current - entry) * mult * contracts : null,
        maxLoss: entry * mult * contracts,
        breakeven: settings.optionStrike > 0
          ? (settings.optionType === 'call' ? settings.optionStrike + entry : settings.optionStrike - entry)
          : null,
        entryPremium: entry,
        currentPremium: current,
        totalCost: entry * mult * contracts
      };
    }

    function calcForexPnL(entryPrice, exitPrice, pipValue, lotSize, direction = 1) {
      const lotUnits = { standard: 100000, mini: 10000, micro: 1000 };
      const unitsPerLot = lotUnits[lotSize] || 100000;
      const pipScale = unitsPerLot / 100000;
      // pipValue is per standard lot; scale for actual lot size
      const priceDiff = (exitPrice - entryPrice) * direction;
      // For most pairs, 1 pip = 0.0001; price diff / 0.0001 = pips
      // But we can just use the raw price diff * (units / pipSize) * pipValue approach
      // Simpler: P&L = priceDiff * unitsPerLot * lots
      // Actually use pip-based: pips = priceDiff / pipSize, P&L = pips * pipValue * pipScale * lots
      // For simplicity, since pipValue already incorporates the per-pip dollar value:
      return priceDiff * unitsPerLot;
    }

    function calcCryptoPnL(entryPrice, exitPrice, units, direction = 1, exchangeFeePct = 0.1) {
      const grossPnL = (exitPrice - entryPrice) * units * direction;
      const entryFee = entryPrice * units * (exchangeFeePct / 100);
      const exitFee = exitPrice * units * (exchangeFeePct / 100);
      return grossPnL - entryFee - exitFee;
    }

    // Universal P&L calculator using current settings
    function calculatePnL(entryPx, exitPx, settings, sizing, direction = 1) {
      if (!settings || !sizing) return null;
      switch (settings.instrumentType) {
        case 'futures':
          if (!entryPx || !exitPx) return null;
          return calcFuturesPnL(entryPx, exitPx, settings.futuresPointValue, sizing.units, direction);
        case 'options':
          // Options P&L is premium-based, not underlying price based
          // entryPx/exitPx are ignored; we use sidebar premium fields
          return null; // Handled separately by calcOptionsPremiumPnL
        case 'forex':
          if (!entryPx || !exitPx) return null;
          return calcForexPnL(entryPx, exitPx, settings.pipValue, settings.lotSize, direction);
        case 'crypto':
          if (!entryPx || !exitPx) return null;
          return calcCryptoPnL(entryPx, exitPx, sizing.units, direction, settings.exchangeFee);
        default: // stock
          return calcStockPnL(entryPx, exitPx, sizing.units, direction);
      }
    }

    // ========== TRADE DIRECTION ==========

  let tradeDirection = 0; // 1 = long, -1 = short, 0 = unset

  function setTradeDirection(dir) {
    const normalized = dir === -1 || String(dir).toUpperCase() === 'SHORT'
      ? -1
      : dir === 1 || String(dir).toUpperCase() === 'LONG'
        ? 1
        : 0;
    tradeDirection = normalized;
    const longBtn = document.getElementById('btn-direction-long');
    const shortBtn = document.getElementById('btn-direction-short');
    if (longBtn) {
      longBtn.classList.toggle('direction-toggle-btn--active', normalized === 1);
      longBtn.classList.toggle('active', normalized === 1);
    }
    if (shortBtn) {
      shortBtn.classList.toggle('direction-toggle-btn--active', normalized === -1);
      shortBtn.classList.toggle('active', normalized === -1);
    }
    updateLivePnL();
    if (typeof window.syncRiskPlanFromDeskLevels === 'function') {
      window.syncRiskPlanFromDeskLevels();
    }
    if (typeof window.renderExecutionRouteSummary === 'function') {
      window.renderExecutionRouteSummary();
    }
    if (typeof window.syncTradePlanStoreFromDesk === 'function') {
      window.syncTradePlanStoreFromDesk('direction_changed');
    }
      
      // If an analysis has already been run, automatically re-run with the new direction
      const symbol = document.getElementById('copilot-symbol')?.value?.trim();
      if (symbol && lastCopilotResult && normalized !== 0) {
        runCopilotAnalysis();
      }
    }

    // ========== LIVE P&L UPDATER ==========

    let lastChartPrice = null;
    let livePnLSizing = null;
    let lastAutoPositionSize = 0;
    let manualSizeOverride = null; // User's manually set position size (null = use auto-calculated)

    function onManualSizeChange() {
      const input = document.getElementById('manual-position-size');
      const val = parseInt(input.value);

      if (isNaN(val) || val < 1 || input.value === '') {
        // Cleared — revert to auto
        manualSizeOverride = null;
        const warningEl = document.getElementById('position-size-warning');
        if (warningEl) { warningEl.textContent = ''; warningEl.classList.add('hidden'); }
        // Re-run auto calc so the display reverts
        const entryEl = document.getElementById('entry-price-input');
        const stopEl  = document.getElementById('stop-loss-price-input');
        if (entryEl && stopEl) calcAutoPositionSize(entryEl.value, stopEl.value);
        if (typeof window.renderExecutionRouteSummary === 'function') {
          window.renderExecutionRouteSummary();
        }
        if (typeof window.syncTradePlanStoreFromDesk === 'function') {
          window.syncTradePlanStoreFromDesk('size_cleared');
        }
        return;
      }

      manualSizeOverride = val;

      // Reflect override in sidebar auto-display too
      const sidebarEl = document.getElementById('sidebar-pos-size');
      const klSizeEl  = document.getElementById('kl-size');
      const unit = document.getElementById('position-size-unit')?.textContent || 'contracts';
      if (sidebarEl) { sidebarEl.textContent = val; sidebarEl.style.color = '#f59e0b'; }
      if (klSizeEl)  { klSizeEl.textContent = val + ' ' + unit; klSizeEl.style.color = '#f59e0b'; }

      // Show how much this overridden size actually risks
      const entryEl = document.getElementById('entry-price-input');
      const stopEl  = document.getElementById('stop-loss-price-input');
      if ((entryEl?.value && stopEl?.value) || getSettings().instrumentType === 'options') {
        const settings = getSettings();
        const entry = settings.instrumentType === 'options'
          ? (settings.optionPrice || parseFloat(entryEl?.value) || 0)
          : (parseFloat(entryEl?.value) || 0);
        const stop = settings.instrumentType === 'options'
          ? 0
          : (parseFloat(stopEl?.value) || 0);
        const effectiveSizing = buildSizingForUnits(settings, entry, stop, val);
        const riskAmt = effectiveSizing.maxLoss || 0;
        const warningEl   = document.getElementById('position-size-warning');
        const hintEl      = document.getElementById('position-size-calc');
        const klHintEl    = document.getElementById('kl-size-hint');
        const budget      = (settings.accountSize || 0) * ((settings.riskPercent || 0) / 100);
        const over        = riskAmt > budget;
        const msg = `Risk: $${riskAmt.toFixed(0)}${over ? ` ⚠ over $${budget.toFixed(0)} budget` : ''}`;
        if (hintEl)    hintEl.textContent   = msg;
        if (klHintEl)  klHintEl.textContent  = msg;
        if (warningEl) {
          if (over) { warningEl.textContent = `⚠ $${riskAmt.toFixed(0)} risk (budget $${budget.toFixed(0)})`; warningEl.classList.remove('hidden'); }
          else      { warningEl.textContent = ''; warningEl.classList.add('hidden'); }
        }
      }

      // Recalculate P&L with new size so take-profit dollar value updates
      const settings = getSettings();
      if (settings.instrumentType === 'options') {
        updateLivePnL();
      } else if (lastChartPrice || entryEl?.value) {
        updateLivePnL(lastChartPrice);
      }
      if (typeof window.renderExecutionRouteSummary === 'function') {
        window.renderExecutionRouteSummary();
      }
      if (typeof window.syncTradePlanStoreFromDesk === 'function') {
        window.syncTradePlanStoreFromDesk('size_changed');
      }
    }
    
    function updateSizeWarning() {
      const input = document.getElementById('manual-position-size');
      const warningEl = document.getElementById('position-size-warning');
      const calcEl = document.getElementById('position-size-calc');
      if (!input || !warningEl) return;
      
      const manualSize = parseInt(input.value) || 0;
      const calcSize = livePnLSizing?._autoUnits || livePnLSizing?.units || lastAutoPositionSize || 0;
      
      // Update "System max" display
      if (calcEl) {
        calcEl.textContent = calcSize > 0 ? `System max: ${calcSize}` : 'System max: --';
      }
      
      if (calcSize === 0) {
        // No calculation yet â€” neutral state
        input.style.borderColor = '';
        warningEl.classList.add('hidden');
        return;
      }
      
      if (manualSize > calcSize) {
        // Over the calculated max â€” red warning
        input.style.borderColor = '#ef4444';
        input.style.color = '#f87171';
        warningEl.textContent = `âš ï¸ Exceeds risk limit (max ${calcSize})`;
        warningEl.className = 'text-xs mt-1 text-red-400 animate-pulse';
        warningEl.classList.remove('hidden');
      } else {
        // At or under â€” normal
        input.style.borderColor = '';
        input.style.color = '';
        warningEl.classList.add('hidden');
      }
    }

    /**
     * Auto-calculate position size from account size, risk %, entry and stop prices.
     * Updates kl-size, kl-size-hint, sidebar-pos-size, and manual-position-size hidden input.
     * Returns the calculated size (or 0 if inputs insufficient).
     *
     * Formulas by instrument:
     *   Futures : floor(riskAmt / (stopDist × pointValue))
     *   Stocks  : floor(riskAmt / stopDist)
     *   Forex   : floor((riskAmt / (stopDistPips × pipValue)) × 100) / 100
     *   Options : floor(riskAmt / (premium × multiplier × 100))
     *   Crypto  : (riskAmt / stopDist)  — no floor, fractional OK
     */
    function calcAutoPositionSize(entryVal, stopVal) {
      const klSizeEl   = document.getElementById('kl-size');
      const klHintEl   = document.getElementById('kl-size-hint');
      const sidebarEl  = document.getElementById('sidebar-pos-size');
      const sideHintEl = document.getElementById('position-size-calc');

      function clear() {
        if (klSizeEl)   klSizeEl.textContent  = '--';
        if (klHintEl)   klHintEl.textContent  = '';
        if (sidebarEl)  sidebarEl.textContent = '--';
        if (sideHintEl) sideHintEl.textContent = 'Set entry & stop on chart';
      }

      // Read account/risk directly from localStorage so we always get the latest saved values
      // (the hidden DOM inputs may be stale if Settings was saved after this page loaded)
      let accountSize = 0, riskPct = 0;
      try {
        const raw = localStorage.getItem('copilotSettings');
        if (raw) {
          const ls = JSON.parse(raw);
          accountSize = parseFloat(ls.accountSize) || 0;
          riskPct     = parseFloat(ls.riskPercent)  || 0;
        }
      } catch(e) {}
      // Fallback to DOM values
      if (!accountSize) accountSize = parseFloat(document.getElementById('account-size')?.value) || 0;
      if (!riskPct)     riskPct     = parseFloat(document.getElementById('risk-percent')?.value)  || 0;

      if (!accountSize || !riskPct) { clear(); if (sideHintEl) sideHintEl.textContent = 'Set account & risk % in Settings'; return 0; }
      const settings = getSettings();
      const type     = settings.instrumentType || 'stock';
      const entry = type === 'options'
        ? (parseFloat(document.getElementById('option-price')?.value) || parseFloat(entryVal))
        : parseFloat(entryVal);
      const stop  = type === 'options' ? 0 : parseFloat(stopVal);
      if (!entry || (type !== 'options' && (!stop || entry === stop))) { clear(); return 0; }

      const riskAmt  = accountSize * (riskPct / 100);
      const stopDist = Math.abs(entry - stop);
      const sym      = document.getElementById('copilot-symbol')?.value?.trim().toUpperCase() || '';
      const spec     = getContractSpec(sym);

      let size = 0;
      let unit = 'shares';
      let riskDollar = riskAmt;

      if (type === 'futures') {
        const pv = parseFloat(document.getElementById('futures-point-value')?.value) || spec?.pointValue || 1;
        unit = 'contracts';
        size = Math.floor(riskAmt / (stopDist * pv));
        riskDollar = size * stopDist * pv;
      } else if (type === 'forex') {
        const pipSz  = spec?.pipSize  || 0.0001;
        const pipVal = parseFloat(document.getElementById('pip-value')?.value) || spec?.pipValue || 10;
        unit = 'lots';
        const pips = stopDist / pipSz;
        size = Math.round((riskAmt / (pips * pipVal)) * 100) / 100;
        riskDollar = size * pips * pipVal;
      } else if (type === 'options') {
        const premium    = parseFloat(document.getElementById('option-price')?.value) || 0;
        const multiplier = parseFloat(document.getElementById('contract-multiplier')?.value) || 100;
        unit = 'contracts';
        if (premium > 0) {
          size = Math.floor(riskAmt / (premium * multiplier));
          riskDollar = size * premium * multiplier;
        }
      } else if (type === 'crypto') {
        unit = 'units';
        size = Math.round((riskAmt / stopDist) * 10000) / 10000;
        riskDollar = size * stopDist;
      } else {
        // Stocks
        unit = 'shares';
        size = Math.floor(riskAmt / stopDist);
        riskDollar = size * stopDist;
      }

      // For futures/options/forex, 1 is the practical minimum — show it with a warning
      const minSize = (type === 'futures' || type === 'options') ? 1 : (type === 'forex' ? 0.01 : 0);
      const overBudget = size < minSize;
      if (overBudget) {
        // Calculate what the actual risk of 1 unit would be
        let actualRisk = 0;
        if (type === 'futures') {
          const pv = parseFloat(document.getElementById('futures-point-value')?.value) || spec?.pointValue || 1;
          actualRisk = stopDist * pv;
          size = 1;
          riskDollar = actualRisk;
        } else if (type === 'stocks') {
          actualRisk = stopDist;
          size = 1;
        } else {
          // Stock account too small — just show 0
          if (klSizeEl)   { klSizeEl.textContent = '0 shares'; klSizeEl.style.color = '#ef4444'; }
          if (klHintEl)   klHintEl.textContent = `Need $${(stopDist).toFixed(0)} risk budget (have $${riskAmt.toFixed(0)})`;
          if (sidebarEl)  { sidebarEl.textContent = '0'; sidebarEl.style.color = '#ef4444'; }
          if (sideHintEl) sideHintEl.textContent = `Risk budget too small — increase account or tighten stop`;
          return 0;
        }
      }

      const sizeStr = type === 'forex' ? size.toFixed(2) : String(size);
      const overBudgetWarning = overBudget
        ? ` ⚠ Exceeds ${riskPct}% budget ($${riskAmt.toFixed(0)})`
        : '';
      const hint = `Risk: $${riskDollar.toFixed(0)} of $${riskAmt.toFixed(0)} (${riskPct}%)${overBudgetWarning}`;

      lastAutoPositionSize = Number(size) || 0;

      // Update unit label in sidebar
      const unitEl = document.getElementById('position-size-unit');
      if (unitEl) unitEl.textContent = unit;

      const manualUnits = getManualPositionSizeValue();
      if (manualUnits !== null) {
        manualSizeOverride = manualUnits;
        const effectiveSizing = buildSizingForUnits(settings, entry, stop, manualUnits);
        const effectiveUnits = type === 'forex' ? manualUnits.toFixed(2) : String(manualUnits);
        const effectiveHint = `Risk: $${effectiveSizing.maxLoss.toFixed(0)} of $${riskAmt.toFixed(0)} (${riskPct}%) | System max: ${sizeStr} ${unit}`;
        if (klSizeEl) {
          klSizeEl.textContent = effectiveUnits + ' ' + unit;
          klSizeEl.style.color = '#f59e0b';
        }
        if (klHintEl) klHintEl.textContent = effectiveHint;
        if (sidebarEl) {
          sidebarEl.textContent = effectiveUnits;
          sidebarEl.style.color = '#f59e0b';
        }
        if (sideHintEl) sideHintEl.textContent = effectiveHint;
        updateSizeWarning();
        return size;
      }

      if (klSizeEl) {
        klSizeEl.textContent = sizeStr + ' ' + unit;
        klSizeEl.style.color = overBudget ? '#f59e0b' : 'var(--color-accent)';
      }
      if (klHintEl) klHintEl.textContent = hint;
      if (sidebarEl) {
        sidebarEl.textContent = sizeStr;
        sidebarEl.style.color = overBudget ? '#f59e0b' : 'var(--color-accent)';
      }
      if (sideHintEl) sideHintEl.textContent = hint;

      manualSizeOverride = null; // auto mode

      return size;
    }
    window.calcAutoPositionSize = calcAutoPositionSize;

    function updateLivePnL(currentPrice) {
      if (currentPrice !== undefined) lastChartPrice = currentPrice;

      const settings = getSettings();
      
      // ===== OPTIONS MODE: premium-based P&L =====
      if (settings.instrumentType === 'options') {
        updateLivePnLOptions(settings);
        return;
      }
      
      // ===== NORMAL MODE: chart price-based P&L =====
      if (!entryPrice || !lastChartPrice) return;

      const stopPx = stopLossPrice || entryPrice; // fallback if no stop set
      
      // Recalculate sizing if needed
      if (!livePnLSizing || livePnLSizing._entryPx !== entryPrice || livePnLSizing._stopPx !== stopPx || livePnLSizing._manualUnits !== getManualPositionSizeValue()) {
        const sizingContext = getPositionSizingContext(settings, entryPrice, stopPx);
        livePnLSizing = sizingContext.effectiveSizing;
        livePnLSizing._entryPx = entryPrice;
        livePnLSizing._stopPx = stopPx;
        livePnLSizing._autoUnits = sizingContext.autoSizing.units;
        livePnLSizing._manualUnits = sizingContext.manualUnits;
        
        // Update the sidebar unit label
        const unitLabelEl = document.getElementById('position-size-unit');
        if (unitLabelEl) unitLabelEl.textContent = livePnLSizing.unitLabel;
        
        // Update warning/calc display after recalc
        updateSizeWarning();
      }
      
      const effectiveSize = livePnLSizing.units;
      const pnl = calculatePnL(entryPrice, lastChartPrice, settings, livePnLSizing, tradeDirection);
      if (pnl === null) return;

      const pnlPct = entryPrice > 0 ? ((lastChartPrice - entryPrice) / entryPrice * 100 * tradeDirection) : 0;

      // Show the panel
      const panel = document.getElementById('live-pnl-panel');
      panel.classList.remove('hidden');

      // Update dollar P&L
      const dollarEl = document.getElementById('live-pnl-dollar');
      dollarEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
      dollarEl.className = `text-xl font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`;

      // Update percent P&L
      const pctEl = document.getElementById('live-pnl-percent');
      pctEl.textContent = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`;
      pctEl.className = `text-lg font-bold ${pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`;

      // Position size display (read-only in P&L panel)
      const pnlSizeEl = document.getElementById('live-pnl-size');
      if (pnlSizeEl) pnlSizeEl.textContent = `${effectiveSize} ${livePnLSizing.unitLabel}`;

      // Current price
      document.getElementById('live-pnl-current').textContent = `$${lastChartPrice.toFixed(2)}`;

      // Instrument label
      const spec = getContractSpec(document.getElementById('copilot-symbol')?.value);
      const instLabel = spec ? spec.name : (settings.instrumentType === 'stock' ? 'Stock' : settings.instrumentType);
      document.getElementById('pnl-instrument-label').textContent = instLabel;
      
      // Instrument badge in trade levels
      const badge = document.getElementById('instrument-badge');
      if (badge) badge.textContent = instLabel;

      // Target/max-loss preview now lives in Key Levels.
      const targetRow = document.getElementById('target-pnl-row');
      if (targetRow) targetRow.classList.add('hidden');
    }
    
    // Options-specific Live P&L: uses premium fields from sidebar, not chart prices
    function updateLivePnLOptions(settings) {
      const sizingContext = getPositionSizingContext(settings, settings.optionPrice || entryPrice || 0, 0);
      const contracts = sizingContext.effectiveSizing?.units || 0;
      const result = calcOptionsPremiumPnL(settings, contracts);
      
      if (!result || contracts <= 0) return;
      
      // Show the panel
      const panel = document.getElementById('live-pnl-panel');
      panel.classList.remove('hidden');
      
      // Dollar P&L
      const dollarEl = document.getElementById('live-pnl-dollar');
      if (result.livePnL !== null) {
        dollarEl.textContent = `${result.livePnL >= 0 ? '+' : ''}$${result.livePnL.toFixed(2)}`;
        dollarEl.className = `text-xl font-bold ${result.livePnL >= 0 ? 'text-green-400' : 'text-red-400'}`;
      } else {
        dollarEl.textContent = '--';
        dollarEl.className = 'text-xl font-bold text-gray-400';
      }
      
      // Percent P&L (based on premium cost)
      const pctEl = document.getElementById('live-pnl-percent');
      if (result.livePnL !== null && result.totalCost > 0) {
        const pct = (result.livePnL / result.totalCost) * 100;
        pctEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
        pctEl.className = `text-lg font-bold ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`;
      } else {
        pctEl.textContent = '--';
        pctEl.className = 'text-lg font-bold text-gray-400';
      }
      
      // Position size
      const pnlSizeEl = document.getElementById('live-pnl-size');
      if (pnlSizeEl) pnlSizeEl.textContent = `${contracts} contracts`;
      
      // Current premium (not stock price)
      const currentEl = document.getElementById('live-pnl-current');
      if (currentEl) currentEl.textContent = result.currentPremium > 0 ? `$${result.currentPremium.toFixed(2)} prem` : '--';
      
      // Instrument label
      const optType = settings.optionType.toUpperCase();
      const strike = settings.optionStrike > 0 ? `$${settings.optionStrike}` : '';
      const expiry = settings.optionExpiry || '';
      const instLabel = `${strike} ${optType} ${expiry}`.trim() || 'Option';
      document.getElementById('pnl-instrument-label').textContent = instLabel;
      
      const badge = document.getElementById('instrument-badge');
      if (badge) badge.textContent = instLabel;
      
      // Target/max-loss preview now lives in Key Levels and the size hint.
      const targetRow = document.getElementById('target-pnl-row');
      if (targetRow) targetRow.classList.add('hidden');

      // Also update sidebar summary.
      updateOptionsPnLSummary();
      return;
      /*
      
      // Target: the take-profit input may contain a STOCK PRICE (from chart click)
      // or a premium value (typed manually). We need to convert stock prices to intrinsic value.
      const tpInput = document.getElementById('take-profit-price-input');
      const tpValue = tpInput ? parseFloat(tpInput.value) : 0;
      if (tpValue > 0 && settings.optionStrike > 0) {
        // Convert stock price target to option intrinsic value at that price
        const intrinsic = settings.optionType === 'call'
          ? Math.max(0, tpValue - settings.optionStrike)
          : Math.max(0, settings.optionStrike - tpValue);
        const targetPnl = (intrinsic - result.entryPremium) * settings.contractMultiplier * contracts;
        
        // Show the intrinsic conversion info
        const tpDollarEl = document.getElementById('target-pnl-dollar');
        tpDollarEl.textContent = targetPnl >= 0 ? `+$${targetPnl.toFixed(2)}` : `-$${Math.abs(targetPnl).toFixed(2)}`;
        tpDollarEl.className = `text-sm font-bold ${targetPnl >= 0 ? 'text-green-400' : 'text-red-400'}`;
        
        // Update the Target P&L label to show the conversion
        const tpLabelEl = document.getElementById('target-pnl-row')?.querySelector('.text-gray-500');
        if (tpLabelEl) tpLabelEl.textContent = `Target P&L (stock@$${tpValue.toFixed(2)} = $${intrinsic.toFixed(2)} intrinsic)`;
      } else if (tpValue > 0) {
        // No strike set â€” treat as raw premium
        const targetPnl = (tpValue - result.entryPremium) * settings.contractMultiplier * contracts;
        document.getElementById('target-pnl-dollar').textContent = targetPnl >= 0 ? `+$${targetPnl.toFixed(2)}` : `-$${Math.abs(targetPnl).toFixed(2)}`;
      } else {
        document.getElementById('target-pnl-dollar').textContent = '--';
        const tpLabelEl = document.getElementById('target-pnl-row')?.querySelector('.text-gray-500');
        if (tpLabelEl) tpLabelEl.textContent = 'Target P&L (at TP)';
      }
      
      // Max loss = premium paid (always)
      document.getElementById('max-loss-pnl-dollar').textContent = `-$${result.maxLoss.toFixed(2)}`;
      
      */
      // Also update sidebar summary
      updateOptionsPnLSummary();
    }

    function hideLivePnL() {
      document.getElementById('live-pnl-panel')?.classList.add('hidden');
    }

    // ========== TRADE HISTORY STATS ==========

    let tradeStats = { dailyLoss: 0, tradesToday: 0, consecutiveLosses: 0, openPositions: 0, peakBalance: 0, currentBalance: 0 };

    async function loadTradeStats() {
      try {
        const res = await fetch('/api/trades');
        const data = await res.json();
        if (!data.success || !data.data) return tradeStats;
        
        const trades = data.data;
        const today = new Date().toISOString().split('T')[0];
        
        // Count trades today
        tradeStats.tradesToday = trades.filter(t => 
          t.createdAt && t.createdAt.startsWith(today)
        ).length;
        
        // Count open positions
        tradeStats.openPositions = trades.filter(t => 
          t.status === 'open' || t.status === 'planned'
        ).length;
        
        // Calculate daily P&L from closed trades today
        const closedToday = trades.filter(t => 
          t.status === 'closed' && t.closedAt && t.closedAt.startsWith(today)
        );
        tradeStats.dailyLoss = closedToday.reduce((sum, t) => {
          if (t.outcome === 'loss' && t.actualPnL) return sum + Math.abs(t.actualPnL);
          return sum;
        }, 0);
        
        // Consecutive losses (most recent closed trades)
        const closedTrades = trades
          .filter(t => t.status === 'closed' && t.outcome)
          .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
        tradeStats.consecutiveLosses = 0;
        for (const t of closedTrades) {
          if (t.outcome === 'loss') tradeStats.consecutiveLosses++;
          else break;
        }
        
        // Peak balance tracking: start from account size and replay closed trade P&L
        const settings = getSettings();
        let runningBalance = settings.accountSize;
        let peak = settings.accountSize;
        // Replay all closed trades in chronological order to find the peak
        const allClosed = trades
          .filter(t => t.status === 'closed' && t.actualPnL != null)
          .sort((a, b) => (a.closedAt || '').localeCompare(b.closedAt || ''));
        for (const t of allClosed) {
          runningBalance += t.actualPnL;
          if (runningBalance > peak) peak = runningBalance;
        }
        tradeStats.peakBalance = peak;
        tradeStats.currentBalance = runningBalance;
        
      } catch (e) {
        console.error('Failed to load trade stats:', e);
      }
      return tradeStats;
    }
