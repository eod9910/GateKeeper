    let trades = [];
    let currentTab = 'planned';
    let deskSettings = {
      dailyLimit: 500,
      maxPositions: 3,
      maxRiskPercent: 2
    };
    let livePrices = {}; // { symbol: { price, change, changePct } }
    let priceRefreshInterval = null;

    function fmtUSD(n) {
      if (n == null || isNaN(n)) return '--';
      return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _safeNumber(value, fallback = 0) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function _isBridgeManagedTrade(trade) {
      return Boolean(trade && (trade._bridgeManaged || trade.executionManaged));
    }

    function _bridgeTradeId(seed) {
      const input = String(seed || 'bridge-position');
      let hash = 0;
      for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
      }
      const normalized = Math.abs(hash || 1);
      return -normalized;
    }

    function _guardBridgeManagedTrade(trade, actionLabel) {
      if (!_isBridgeManagedTrade(trade)) return false;
      alert(`${trade.symbol} is managed by the Execution Desk. Use Execution Desk to ${actionLabel}.`);
      return true;
    }

    function openExecutionPanelForTrade(id) {
      const trade = trades.find(t => t.id == id);
      if (trade) {
        localStorage.setItem('executionFocusTrade', JSON.stringify({
          symbol: trade.symbol,
          strategyVersionId: trade.strategy_version_id || null,
          source: trade._bridgeMode || 'paper',
          timestamp: Date.now(),
        }));
      }
      window.location.href = 'execution.html';
    }

    function openPositionPanelAction(id, event) {
      if (event) {
        event.stopPropagation();
      }
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      if (_isBridgeManagedTrade(trade)) {
        openExecutionPanelForTrade(id);
        return;
      }
      openEditModal(id);
    }

    function buildManagedBridgeTrade(pos, bridgeState) {
      const entry = _safeNumber(pos.entry_price, 0);
      const stop = _safeNumber(pos.stop_price, 0);
      const target = _safeNumber(pos.take_profit_price, 0);
      const qty = _safeNumber(pos.qty, 0);
      const risk = Math.abs(entry - stop);
      const reward = Math.abs(target - entry);
      const strategyVersionId = String(pos.strategy_version_id || '').trim();
      const mode = String(bridgeState?.mode || 'paper').toLowerCase() === 'live' ? 'live' : 'paper';
      const entryTime = pos.entry_time || new Date().toISOString();
      const idSeed = `${pos.entry_order_id || pos.symbol}:${entryTime}:${strategyVersionId}`;

      return {
        id: _bridgeTradeId(idSeed),
        symbol: String(pos.symbol || '').trim().toUpperCase(),
        status: 'open',
        direction: String(pos.side || 'long').toLowerCase() === 'short' ? -1 : 1,
        instrumentType: String(pos.signal_data?.asset_class || 'stock').toLowerCase(),
        plannedEntry: entry,
        actualEntry: entry,
        plannedStop: stop,
        currentStop: stop,
        plannedTarget: target,
        plannedShares: qty,
        actualShares: qty,
        plannedRR: (risk > 0 && reward > 0) ? (reward / risk).toFixed(2) : '--',
        plannedRiskAmount: (risk * qty).toFixed(2),
        executionTime: entryTime,
        createdAt: entryTime,
        savedAt: entryTime,
        displayDate: new Date(entryTime).toLocaleDateString(),
        patternType: 'Execution Desk',
        strategy: 'execution',
        strategy_version_id: strategyVersionId,
        verdict: null,
        preTradePlan: `Managed by Execution Desk (${mode.toUpperCase()} mode). Position Book mirrors the position but does not control it.`,
        chartImage: null,
        _bridgeManaged: true,
        _bridgeMode: mode,
        _entryOrderId: pos.entry_order_id || null,
        _signalData: pos.signal_data || {},
      };
    }

    function _normalizeImportedBrokerSize(pos, instrumentType) {
      const qty = Math.abs(_safeNumber(pos && pos.qty, 0));
      if (instrumentType === 'forex') {
        return {
          size: qty / 1000,
          lotSize: 'micro',
          brokerUnits: qty,
        };
      }
      return {
        size: qty,
        lotSize: null,
        brokerUnits: qty,
      };
    }

    function _externalBrokerPositionKey(provider, pos) {
      const explicit = String((pos && (pos.external_position_id || pos.option_id || pos.position_id || pos.id)) || '').trim();
      if (explicit) return explicit;

      const instrumentType = String(pos && pos.instrument_type || '').trim().toLowerCase() || 'stock';
      const symbol = String(pos && pos.symbol || '').trim().toUpperCase();
      const side = String(pos && pos.side || 'long').trim().toLowerCase() === 'short' ? 'short' : 'long';
      const strike = instrumentType === 'options' ? _safeNumber(pos && pos.strike_price, 0) : 0;
      const expiry = instrumentType === 'options' ? String(pos && pos.expiration_date || '').trim() : '';
      const optionType = instrumentType === 'options' ? String(pos && pos.option_type || '').trim().toLowerCase() : '';
      return [provider, symbol, side, instrumentType, strike > 0 ? strike : '', expiry, optionType].filter(Boolean).join(':');
    }

    function buildImportedBrokerTrade(pos, providerEntry) {
      const provider = String(providerEntry && providerEntry.provider || '').trim().toLowerCase() || 'broker';
      const providerLabel = String(providerEntry && providerEntry.label || provider).trim() || provider.toUpperCase();
      const mode = String(providerEntry && providerEntry.mode || 'live').trim().toLowerCase() === 'paper' ? 'paper' : 'live';
      const instrumentType = String(pos && pos.instrument_type || (provider === 'oanda' ? 'forex' : 'stock')).trim().toLowerCase();
      const sizeMeta = _normalizeImportedBrokerSize(pos, instrumentType);
      const isOptions = instrumentType === 'options';
      const entry = _safeNumber(pos && pos.avg_entry_price, 0);
      const current = _safeNumber(pos && pos.current_price, 0);
      const stop = pos && pos.suggested_stop_price != null ? _safeNumber(pos.suggested_stop_price, 0) : null;
      const target = pos && pos.suggested_take_profit_price != null ? _safeNumber(pos.suggested_take_profit_price, 0) : null;
      const strategyVersionId = String(pos && pos.strategy_version_id || '').trim();
      const strategyName = String(pos && pos.strategy_name || strategyVersionId || 'Broker Import').trim();
      const externalPositionKey = _externalBrokerPositionKey(provider, pos);
      const idSeed = externalPositionKey || `${provider}:${pos && pos.symbol}:${entry}:${strategyVersionId || 'broker-import'}`;
      const risk = stop != null ? Math.abs(entry - stop) : null;
      const reward = target != null ? Math.abs(target - entry) : null;
      const importedAt = String(
        (pos && (pos.opened_at || pos.created_at || pos.updated_at || (pos.raw && (pos.raw.opened_at || pos.raw.created_at || pos.raw.updated_at))))
        || new Date().toISOString()
      );
      const planSummary = String(pos && pos.import_reason || `${providerLabel} position imported into Position Book using ${strategyName}.`).trim();
      const optionStrike = _safeNumber(pos && pos.strike_price, 0);
      const optionExpiry = String(pos && pos.expiration_date || '').trim();
      const optionType = String(pos && pos.option_type || 'call').trim().toLowerCase();
      const contractMultiplier = Math.max(1, _safeNumber(pos && pos.contract_multiplier, 100));
      const futuresMultiplier = Math.max(1, _safeNumber(pos && pos.contract_multiplier, 1));
      const optionPremiumRisk = entry > 0 && sizeMeta.brokerUnits > 0
        ? entry * contractMultiplier * sizeMeta.brokerUnits
        : 0;
      const futuresRiskAmount = risk != null && risk > 0 && sizeMeta.brokerUnits > 0
        ? risk * sizeMeta.brokerUnits * futuresMultiplier
        : 0;
      const plannedRiskAmount = isOptions
        ? String(optionPremiumRisk.toFixed(2))
        : (instrumentType === 'futures'
          ? String(futuresRiskAmount.toFixed(2))
          : ((risk != null && risk > 0 && sizeMeta.brokerUnits > 0) ? String((risk * sizeMeta.brokerUnits).toFixed(2)) : '0'));

      return {
        id: _bridgeTradeId(idSeed),
        symbol: String(pos && pos.symbol || '').trim().toUpperCase(),
        status: 'open',
        direction: String(pos && pos.side || 'long').toLowerCase() === 'short' ? -1 : 1,
        instrumentType,
        plannedEntry: entry,
        actualEntry: entry,
        plannedStop: stop,
        currentStop: stop,
        plannedTarget: target,
        plannedShares: sizeMeta.size,
        actualShares: sizeMeta.size,
        lotSize: sizeMeta.lotSize || undefined,
        plannedRR: (risk != null && reward != null && risk > 0 && reward > 0) ? (reward / risk).toFixed(2) : '--',
        plannedRiskAmount,
        executionTime: importedAt,
        createdAt: importedAt,
        savedAt: importedAt,
        displayDate: new Date(importedAt).toLocaleDateString(),
        patternType: strategyName,
        strategy: 'broker_import',
        strategy_version_id: strategyVersionId || null,
        verdict: null,
        preTradePlan: `${planSummary} Manage execution at the broker / Execution Desk, not from Position Book.`,
        chartImage: null,
        optionPrice: isOptions ? entry : undefined,
        optionCurrentPremium: isOptions && current > 0 ? current : undefined,
        optionStrike: isOptions && optionStrike > 0 ? optionStrike : undefined,
        optionExpiry: isOptions && optionExpiry ? optionExpiry : undefined,
        optionType: isOptions ? optionType : undefined,
        contractMultiplier: (isOptions || instrumentType === 'futures')
          ? (instrumentType === 'futures' ? futuresMultiplier : contractMultiplier)
          : undefined,
        _bridgeManaged: true,
        _bridgeMode: mode,
        _bridgeLabel: `${providerLabel} ${mode.toUpperCase()}`,
        _externalProvider: provider,
        _externalPositionKey: externalPositionKey,
        _externalBrokerPosition: true,
        _brokerUnits: sizeMeta.brokerUnits,
      };
    }

    function mergeExecutionBrokerTrades(storedTrades, executionStatus) {
      const baseTrades = Array.isArray(storedTrades) ? storedTrades.slice() : [];
      const managedPositions = executionStatus?.state?.managed_positions;
      const connectedBrokers = Array.isArray(executionStatus?.connected_brokers) ? executionStatus.connected_brokers : [];
      const executionProvider = String(executionStatus?.execution_broker_provider || 'alpaca').trim().toLowerCase();
      const existingKeys = new Set(
        baseTrades
          .filter((trade) => trade && trade.status === 'open')
          .map((trade) => {
            const orderKey = String(trade._entryOrderId || trade.entry_order_id || '').trim();
            if (orderKey) return `order:${orderKey}`;
            const externalProvider = String(trade._externalProvider || '').trim().toLowerCase();
            if (externalProvider) {
              const externalPositionKey = String(trade._externalPositionKey || '').trim();
              if (externalPositionKey) {
                return `broker:${externalProvider}:${externalPositionKey}`;
              }
              const sym = String(trade.symbol || '').trim().toUpperCase();
              const strat = String(trade.strategy_version_id || trade.strategyVersionId || '').trim();
              return `broker:${externalProvider}:${sym}:${strat}`;
            }
            const sym = String(trade.symbol || '').trim().toUpperCase();
            const strat = String(trade.strategy_version_id || trade.strategyVersionId || '').trim();
            return `open:${sym}:${strat}`;
          })
      );

      const managedBrokerKeys = new Set(
        (Array.isArray(managedPositions) ? managedPositions : []).map((pos) => {
          const sym = String(pos?.symbol || '').trim().toUpperCase();
          const side = String(pos?.side || 'long').trim().toLowerCase() === 'short' ? 'short' : 'long';
          return `${executionProvider}:${sym}:${side}`;
        })
      );

      for (const pos of Array.isArray(managedPositions) ? managedPositions : []) {
        const orderKey = String(pos?.entry_order_id || '').trim();
        const symbolKey = String(pos?.symbol || '').trim().toUpperCase();
        const strategyKey = String(pos?.strategy_version_id || '').trim();
        const dedupeKey = orderKey ? `order:${orderKey}` : `open:${symbolKey}:${strategyKey}`;
        if (existingKeys.has(dedupeKey)) continue;
        baseTrades.push(buildManagedBridgeTrade(pos, executionStatus?.state || executionStatus));
        existingKeys.add(dedupeKey);
      }

      for (const brokerEntry of connectedBrokers) {
        const provider = String(brokerEntry?.provider || '').trim().toLowerCase();
        const positions = Array.isArray(brokerEntry?.positions) ? brokerEntry.positions : [];
        for (const pos of positions) {
          const sym = String(pos?.symbol || '').trim().toUpperCase();
          const side = String(pos?.side || 'long').trim().toLowerCase() === 'short' ? 'short' : 'long';
          if (managedBrokerKeys.has(`${provider}:${sym}:${side}`)) continue;
          const strategyKey = String(pos?.strategy_version_id || executionStatus?.default_import_strategy_version_id || '').trim();
          const externalPositionKey = _externalBrokerPositionKey(provider, pos);
          const dedupeKey = externalPositionKey
            ? `broker:${provider}:${externalPositionKey}`
            : `broker:${provider}:${sym}:${strategyKey}`;
          if (existingKeys.has(dedupeKey)) continue;
          baseTrades.push(buildImportedBrokerTrade(pos, brokerEntry));
          existingKeys.add(dedupeKey);
        }
      }

      return baseTrades;
    }

    // ========== EXECUTION LADDER ENGINE ==========
    //
    // This is the harvest + behavioral lock layer.
    // It computes EXACT STOP PRICES for each rule, shows them on the card,
    // and tells the trader what to do RIGHT NOW.
    //
    // Used for: futures, stocks, forex, crypto (stop-price based).
    // Options use a separate % multiple display (scale-out based).
    //

    /**
     * Get the execution config for a trade.
     * Priority: trade.execution_config > instrument-type default.
     */
    function getTradeExecutionConfig(trade) {
      if (trade.execution_config) return trade.execution_config;

      if (trade.instrumentType === 'options') {
        return {
          scale_out_rules: [
            { at_multiple: 2.0, pct_close: 0.50 },
            { at_multiple: 3.0, pct_close: 0.25 }
          ],
          winner_never_to_red_r: 3.0,
          time_stop: { max_days_in_trade: 10, max_loss_pct: -40, action: 'close_market' },
          profit_retrace_exit: { peak_r: 2.0, giveback_r: 1.0, action: 'close_market' },
          production_lock: false
        };
      }

      return {
        auto_breakeven_r: 1.0,
        lock_in_r_ladder: [
          { at_r: 2, lock_r: 1 },
          { at_r: 3, lock_r: 2 },
          { at_r: 4, lock_r: 3 }
        ],
        green_to_red_protection: { trigger_r: 1.5, floor_r: 0.25, action: 'close_market' },
        daily_profit_cap_usd: 500,
        daily_profit_cap_action: 'close_all_and_pause',
        production_lock: false
      };
    }

    // ---- R Calculation (standardized) ----

    /**
     * Compute risk_per_unit_price = the price distance that equals 1R.
     * For LONG:  entry - initial_stop  (positive if stop below entry)
     * For SHORT: initial_stop - entry  (positive if stop above entry)
     * Returns null if trade is INVALID (no stop or stop on wrong side).
     */
    function getRiskPerUnit(trade) {
      const entry = trade.actualEntry || trade.plannedEntry;
      // initial_stop_price is the IMMUTABLE stop at trade open.
      // Fall back to current/planned stop if not yet persisted.
      const stop = trade.initial_stop_price || trade.currentStop || trade.plannedStop;
      if (!entry || !stop) return null;

      const isShort = (trade.direction === -1);
      const risk = isShort ? (stop - entry) : (entry - stop);
      // Risk must be positive (stop on the correct side of entry)
      if (risk <= 0) return null;
      return risk;
    }

    /**
     * Compute current R for any instrument given a live price.
     * For LONG:  (current - entry) / risk_per_unit
     * For SHORT: (entry - current) / risk_per_unit
     */
    function calcTradeR(trade, currentPrice) {
      if (trade.instrumentType === 'options') {
        return calcOptionsR(trade);
      }
      const entry = trade.actualEntry || trade.plannedEntry;
      const rpu = getRiskPerUnit(trade);
      if (!entry || !rpu) return null;
      const isShort = (trade.direction === -1);
      return isShort
        ? (entry - currentPrice) / rpu
        : (currentPrice - entry) / rpu;
    }

    /**
     * Options R: based on premium cost. 1R = total premium paid.
     */
    function calcOptionsR(trade) {
      const entryPrem = trade.optionPrice || 0;
      const currPrem = trade.optionCurrentPremium || 0;
      if (entryPrem <= 0) return null;
      return (currPrem - entryPrem) / entryPrem;
    }

    // ---- Execution Ladder ----

    /**
     * Compute the full execution ladder for a position.
     * Returns ExecutionStep[] sorted by armed_at_R ascending.
     *
     * Each step:
     *   key:               string identifier
     *   label:             human-readable name
     *   armed_at_R:        R level that activates this step
     *   lock_R:            R profit guaranteed once active
     *   stop_price_target: exact price to set the stop at
     *   is_active:         current_R >= armed_at_R (or peak_R for G2R)
     *   is_current:        this is the step with the highest lock_R among active steps
     */
    function computeExecutionLadder(trade, currentR, peakR) {
      const config = getTradeExecutionConfig(trade);
      if (!config) return [];

      const entry = trade.actualEntry || trade.plannedEntry;
      const rpu = getRiskPerUnit(trade);
      if (!entry || !rpu) return [];

      const isShort = (trade.direction === -1);
      const steps = [];

      function stopPrice(lockR) {
        // For LONG:  entry + lockR * rpu  (move stop UP to lock profit)
        // For SHORT: entry - lockR * rpu  (move stop DOWN to lock profit)
        return isShort
          ? entry - (lockR * rpu)
          : entry + (lockR * rpu);
      }

      // 1. Auto breakeven
      if (config.auto_breakeven_r != null) {
        steps.push({
          key: 'BE',
          label: 'BE',
          armed_at_R: config.auto_breakeven_r,
          lock_R: 0,
          stop_price_target: stopPrice(0), // = entry price
          is_active: currentR >= config.auto_breakeven_r,
        });
      }

      // 2. Green-to-red protection floor
      if (config.green_to_red_protection) {
        const g = config.green_to_red_protection;
        steps.push({
          key: 'G2R',
          label: 'G2R',
          armed_at_R: g.trigger_r,
          lock_R: g.floor_r,
          stop_price_target: stopPrice(g.floor_r),
          // G2R is armed based on PEAK R (once reached, always active)
          is_active: peakR >= g.trigger_r,
        });
      }

      // 3. Profit-lock ladder rungs (defined)
      let highestDefinedAt = 0;
      let ladderGap = 1; // default: each rung trails 1R behind trigger
      if (config.lock_in_r_ladder && config.lock_in_r_ladder.length > 0) {
        for (const rung of config.lock_in_r_ladder) {
          steps.push({
            key: `LOCK_${rung.lock_r}R`,
            label: `Lock +${rung.lock_r}R`,
            armed_at_R: rung.at_r,
            lock_R: rung.lock_r,
            stop_price_target: stopPrice(rung.lock_r),
            is_active: currentR >= rung.at_r,
          });
          if (rung.at_r > highestDefinedAt) {
            highestDefinedAt = rung.at_r;
            ladderGap = rung.at_r - rung.lock_r; // infer the gap (e.g. at_r:4, lock_r:3 → gap=1)
          }
        }
      }

      // 4. Auto-extend ladder beyond defined rungs
      //    Pattern: every +1R above last defined rung, lock 1R more.
      //    Extends up to floor(currentR) so it's always relevant.
      if (highestDefinedAt > 0 && currentR > highestDefinedAt) {
        const maxRung = Math.floor(currentR);
        for (let at = highestDefinedAt + 1; at <= maxRung; at++) {
          const lock = at - ladderGap;
          steps.push({
            key: `LOCK_${lock}R`,
            label: `Lock +${lock}R`,
            armed_at_R: at,
            lock_R: lock,
            stop_price_target: stopPrice(lock),
            is_active: currentR >= at,
            _dynamic: true, // flag: auto-generated rung
          });
        }
      }

      // Sort by armed_at_R ascending
      steps.sort((a, b) => a.armed_at_R - b.armed_at_R);

      // Mark steps that user has confirmed as DONE
      const doneKeys = new Set(
        (trade.ladder_actions || [])
          .filter(a => a.action === 'done')
          .map(a => a.step)
      );
      for (const s of steps) {
        s.is_done = doneKeys.has(s.key);
        s.is_current = false;
      }

      // Current required = highest lock_R among ACTIVE steps that are NOT yet done
      let currentRequired = null;
      for (const s of steps) {
        if (s.is_active && !s.is_done) {
          if (!currentRequired || s.lock_R > currentRequired.lock_R) {
            currentRequired = s;
          }
        }
      }
      if (currentRequired) currentRequired.is_current = true;

      return steps;
    }

    /**
     * Options-specific ladder: uses % multiples and scale-out instructions.
     */
    function computeOptionsLadder(trade, currentR, peakR) {
      const config = getTradeExecutionConfig(trade);
      if (!config) return [];

      const entryPrem = trade.optionPrice || 0;
      const contracts = trade.actualShares || trade.plannedShares || 1;
      const mult = trade.contractMultiplier || 100;
      const steps = [];

      if (config.scale_out_rules) {
        for (const rule of config.scale_out_rules) {
          const targetPrem = entryPrem * rule.at_multiple;
          const pctToClose = Math.round(rule.pct_close * 100);
          const contractsToClose = Math.max(1, Math.round(contracts * rule.pct_close));
          steps.push({
            key: `SCALE_${rule.at_multiple}x`,
            label: `${rule.at_multiple}x (+${Math.round((rule.at_multiple - 1) * 100)}%)`,
            armed_at_R: rule.at_multiple - 1, // e.g. 2x = +1R (100% gain)
            lock_R: null,
            stop_price_target: null,
            target_premium: targetPrem,
            action: `Sell ${contractsToClose} of ${contracts} contracts at $${fmtUSD(targetPrem)}`,
            is_active: (currentR != null) && (currentR >= (rule.at_multiple - 1)),
            is_current: false,
          });
        }
      }

      // Winner-never-to-red
      if (config.winner_never_to_red_r != null) {
        steps.push({
          key: 'WINNER_LOCK',
          label: `Lock entry at +${config.winner_never_to_red_r}R`,
          armed_at_R: config.winner_never_to_red_r,
          lock_R: 0,
          stop_price_target: null,
          action: `Stop ≥ entry premium ($${fmtUSD(entryPrem)})`,
          is_active: (peakR || 0) >= config.winner_never_to_red_r,
          is_current: false,
        });
      }

      // Time stop
      if (config.time_stop) {
        const ts = config.time_stop;
        steps.push({
          key: 'TIME_STOP',
          label: `Kill @ ${ts.max_days_in_trade}d/${ts.max_loss_pct}%`,
          armed_at_R: null,
          lock_R: null,
          stop_price_target: null,
          action: `Close if ${ts.max_days_in_trade}+ days AND P&L ≤ ${ts.max_loss_pct}%`,
          is_active: false,
          is_current: false,
        });
      }

      // Retrace exit
      if (config.profit_retrace_exit) {
        const pre = config.profit_retrace_exit;
        steps.push({
          key: 'RETRACE',
          label: `Retrace: peak ${pre.peak_r}R, give ${pre.giveback_r}R`,
          armed_at_R: pre.peak_r,
          lock_R: null,
          stop_price_target: null,
          action: `If peak ≥ +${pre.peak_r}R and drops ${pre.giveback_r}R from peak → close`,
          is_active: (peakR || 0) >= pre.peak_r,
          is_current: false,
        });
      }

      // Sort by armed_at_R ascending
      steps.sort((a, b) => (a.armed_at_R || 99) - (b.armed_at_R || 99));

      // Mark done steps
      const doneKeys = new Set(
        (trade.ladder_actions || [])
          .filter(a => a.action === 'done')
          .map(a => a.step)
      );
      for (const s of steps) {
        s.is_done = doneKeys.has(s.key);
      }

      // Current = highest active step with an action that is NOT done
      let current = null;
      for (const s of steps) {
        if (s.is_active && s.action && !s.is_done) {
          current = s;
        }
      }
      if (current) current.is_current = true;

      return steps;
    }

    // ---- Render the execution ladder on trade cards ----

    /**
     * Render the full execution ladder + next action panel.
     */
    function renderExecutionBar(trade, currentR, peakR) {
      const isOptions = trade.instrumentType === 'options';
      const entry = trade.actualEntry || trade.plannedEntry;
      const rpu = getRiskPerUnit(trade);

      // ---- INVALID: no stop defined ----
      if (!isOptions && !rpu) {
        return `<div style="margin-top:var(--space-12);padding:var(--space-8) var(--space-12);border-top:1px solid var(--color-border);font-size:var(--text-caption);color:var(--color-text-subtle);font-style:italic;">
          Define initial stop to enable R rules.
        </div>`;
      }

      const steps = isOptions
        ? computeOptionsLadder(trade, currentR, peakR)
        : computeExecutionLadder(trade, currentR, peakR);

      if (steps.length === 0) return '';

      // --- R header ---
      const rColor = (currentR >= 0) ? '#4a8a60' : '#9a5050';
      const rSign = (currentR >= 0) ? '+' : '';
      const peakColor = (peakR >= 0) ? '#4a8a60' : '#9a5050';

      let html = `<div style="margin-top:var(--space-12);padding-top:var(--space-12);border-top:1px solid var(--color-border);">`;

      // Row 1: R display + 1R info
      html += `<div style="display:flex;align-items:baseline;gap:var(--space-16);margin-bottom:var(--space-8);">`;
      html += `<div style="display:flex;align-items:baseline;gap:var(--space-6);">
        <span style="font-size:var(--text-caption);color:var(--color-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">R</span>
        <span style="font-size:1.5rem;font-weight:700;font-family:var(--font-mono);color:${rColor};line-height:1;">${rSign}${currentR.toFixed(2)}</span>
      </div>`;
      html += `<span style="font-size:var(--text-caption);color:var(--color-text-subtle);">Peak: <span style="color:${peakColor};font-family:var(--font-mono);">${peakR >= 0 ? '+' : ''}${peakR.toFixed(2)}R</span></span>`;
      if (!isOptions && rpu) {
        html += `<span style="font-size:var(--text-caption);color:var(--color-text-subtle);">1R = $${fmtUSD(rpu)}</span>`;
      }

      const config = getTradeExecutionConfig(trade);
      if (config && config.production_lock) {
        html += `<span title="Production mode: manual edits disabled" style="margin-left:auto;font-size:0.6rem;color:var(--color-text-subtle);text-transform:uppercase;letter-spacing:0.08em;">🔒 PROD</span>`;
      }
      html += `</div>`;

      // Row 2: Ladder chips
      html += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:var(--space-8);">`;
      for (const step of steps) {
        let bg, color, border, statusIcon;
        if (step.is_done) {
          // Completed: dimmed with checkmark
          bg = 'rgba(79,170,114,0.08)';
          color = '#4a8a60';
          border = '1px solid rgba(79,170,114,0.2)';
          statusIcon = '✓';
        } else if (step.is_current) {
          // Current required: bright highlight
          bg = 'rgba(79,170,114,0.2)';
          color = '#4faa72';
          border = '1px solid #4faa72';
          statusIcon = '▲';
        } else if (step.is_active) {
          // Active but not current: amber/warning (should have been done)
          bg = 'rgba(200,160,60,0.12)';
          color = '#c8a03c';
          border = '1px solid rgba(200,160,60,0.3)';
          statusIcon = '!';
        } else {
          // Inactive: muted
          bg = 'rgba(93,122,146,0.06)';
          color = 'var(--color-text-subtle)';
          border = '1px solid var(--color-border)';
          statusIcon = '○';
        }

        const priceStr = step.stop_price_target != null
          ? `$${fmtUSD(step.stop_price_target)}`
          : (step.target_premium != null ? `$${fmtUSD(step.target_premium)}` : '');

        const tooltip = [
          step.label + (step.is_done ? ' ✓ DONE' : ''),
          step.armed_at_R != null ? `Armed at: +${step.armed_at_R}R` : '',
          step.lock_R != null ? `Locks: +${step.lock_R}R` : '',
          step.stop_price_target != null ? `Stop target: $${fmtUSD(step.stop_price_target)}` : '',
          step.action || '',
          `Current R: ${rSign}${currentR.toFixed(2)} | Peak R: ${peakR.toFixed(2)}`,
        ].filter(Boolean).join('\\n');

        html += `<div title="${tooltip}" style="display:flex;flex-direction:column;align-items:center;padding:3px 8px;border-radius:3px;background:${bg};border:${border};cursor:help;min-width:56px;${step.is_done ? 'opacity:0.7;' : ''}">`;
        html += `<span style="font-size:0.6rem;font-weight:600;color:${color};letter-spacing:0.02em;white-space:nowrap;">${statusIcon} ${step.label}</span>`;
        if (priceStr) {
          html += `<span style="font-size:0.7rem;font-weight:700;font-family:var(--font-mono);color:${color};margin-top:1px;">${priceStr}</span>`;
        }
        if (step.is_current) {
          html += `<span style="font-size:0.5rem;color:#4faa72;margin-top:1px;">NOW</span>`;
        }
        html += `</div>`;
      }
      html += `</div>`;

      // Row 3: NEXT ACTION panel
      const currentStep = steps.find(s => s.is_current);
      const allActiveAreDone = steps.filter(s => s.is_active).every(s => s.is_done);

      if (currentStep) {
        let actionText;
        if (currentStep.stop_price_target != null) {
          actionText = `MOVE STOP TO <strong style="font-family:var(--font-mono);font-size:var(--text-small);">$${fmtUSD(currentStep.stop_price_target)}</strong> (locks +${currentStep.lock_R}R)`;
        } else if (currentStep.action) {
          actionText = currentStep.action;
        } else {
          actionText = currentStep.label;
        }

        html += `<div id="ladder-action-${trade.id}" style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-6) var(--space-10);background:rgba(79,170,114,0.08);border:1px solid rgba(79,170,114,0.25);border-radius:3px;">`;
        html += `<span style="font-size:0.65rem;font-weight:700;color:#4faa72;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;">NEXT →</span>`;
        html += `<span style="font-size:var(--text-caption);color:var(--color-text-primary);flex:1;">${actionText}</span>`;
        html += `<button onclick="event.stopPropagation(); logLadderAction(${trade.id}, '${currentStep.key}', 'done')" style="padding:2px 10px;font-size:0.65rem;font-weight:600;background:#4faa72;color:#fff;border:none;border-radius:2px;cursor:pointer;letter-spacing:0.03em;">DONE</button>`;
        html += `<button onclick="event.stopPropagation(); logLadderAction(${trade.id}, '${currentStep.key}', 'override')" style="padding:2px 10px;font-size:0.65rem;font-weight:600;background:transparent;color:var(--color-text-subtle);border:1px solid var(--color-border);border-radius:2px;cursor:pointer;letter-spacing:0.03em;">SKIP</button>`;
        html += `</div>`;
      } else if (allActiveAreDone && steps.some(s => s.is_done)) {
        // All active steps are confirmed done
        html += `<div style="display:flex;align-items:center;gap:var(--space-8);padding:var(--space-6) var(--space-10);background:rgba(79,170,114,0.05);border:1px solid rgba(79,170,114,0.15);border-radius:3px;">`;
        html += `<span style="font-size:0.65rem;font-weight:600;color:#4a8a60;letter-spacing:0.03em;">✓ All active rules confirmed — stop is where it should be</span>`;
        html += `</div>`;
      }

      html += `</div>`;
      return html;
    }

    /**
     * Log a ladder action (DONE or OVERRIDE) and persist to trade.
     */
    async function logLadderAction(tradeId, stepKey, action) {
      const trade = trades.find(t => t.id === tradeId);
      if (!trade) return;
      if (_isBridgeManagedTrade(trade)) return;

      if (action === 'override') {
        const reason = prompt('Override reason (required):');
        if (!reason) return;
        if (!trade.ladder_overrides) trade.ladder_overrides = [];
        trade.ladder_overrides.push({
          step: stepKey,
          action: 'override',
          reason: reason,
          timestamp: new Date().toISOString()
        });
      } else {
        if (!trade.ladder_actions) trade.ladder_actions = [];
        trade.ladder_actions.push({
          step: stepKey,
          action: 'done',
          timestamp: new Date().toISOString()
        });
      }

      trade.last_instruction_key = stepKey;
      trade.last_instruction_status = action;

      // Flash the action bar green to confirm
      const actionBar = document.getElementById(`ladder-action-${tradeId}`);
      if (actionBar) {
        actionBar.style.transition = 'background 0.2s, border-color 0.2s';
        actionBar.style.background = action === 'done'
          ? 'rgba(79,170,114,0.3)'
          : 'rgba(200,160,60,0.2)';
        actionBar.innerHTML = `<span style="font-size:0.7rem;font-weight:700;color:${action === 'done' ? '#4faa72' : '#c8a03c'};letter-spacing:0.04em;">${action === 'done' ? '✓ Confirmed — stop moved' : '⚠ Override logged'}</span>`;
      }

      await saveOneTrade(trade);

      // Brief pause so user sees the confirmation, then re-render
      setTimeout(() => renderTrades(), 800);
    }

    /**
     * Ensure initial_stop_price is persisted on a trade (immutable after first set).
     * Called when trade first loads or when live prices arrive.
     */
    function ensureInitialStop(trade) {
      if (trade.initial_stop_price) return; // already set
      const stop = trade.currentStop || trade.plannedStop;
      if (stop) {
        trade.initial_stop_price = stop;
        saveOneTrade(trade); // persist once
      }
    }

    // ========== SIDEBAR SECTION TOGGLE ==========
    function toggleSection(sectionId) {
      var section = document.getElementById(sectionId);
      if (!section) return;
      section.classList.toggle('collapsed');
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
    
    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      loadSettings();
      loadTrades();
    });
    
    // Load settings
    function loadSettings() {
      const saved = localStorage.getItem('deskSettings');
      if (saved) deskSettings = JSON.parse(saved);
      document.getElementById('setting-daily-limit').value = deskSettings.dailyLimit;
      document.getElementById('setting-max-positions').value = deskSettings.maxPositions;
      document.getElementById('setting-max-risk').value = deskSettings.maxRiskPercent;
      document.getElementById('max-loss').textContent = `-$${deskSettings.dailyLimit}`;
    }
    
    // Save settings
    function saveSettings() {
      deskSettings.dailyLimit = parseFloat(document.getElementById('setting-daily-limit').value) || 500;
      deskSettings.maxPositions = parseInt(document.getElementById('setting-max-positions').value) || 3;
      deskSettings.maxRiskPercent = parseFloat(document.getElementById('setting-max-risk').value) || 2;
      localStorage.setItem('deskSettings', JSON.stringify(deskSettings));
      document.getElementById('max-loss').textContent = `-$${deskSettings.dailyLimit}`;
      closeModal('settings-modal');
      updateStats();
    }
    
    // Load trades from backend
    async function loadTrades() {
      let executionStatus = null;
      try {
        const [tradesRes, executionRes] = await Promise.allSettled([
          fetch('/api/trades'),
          fetch('/api/execution/status'),
        ]);

        if (tradesRes.status === 'fulfilled') {
          const data = await tradesRes.value.json();
          trades = (data.success && data.data) ? data.data : [];
        } else {
          trades = [];
        }

        if (executionRes.status === 'fulfilled') {
          const execData = await executionRes.value.json();
          executionStatus = execData?.success ? execData?.data : null;
        }
      } catch (e) {
        console.error('Failed to load trades from backend:', e);
        trades = [];
      }
      
      // Migrate old trades if needed
      trades = trades.map(t => ({
        ...t,
        status: t.status || 'planned',
        plannedEntry: t.plannedEntry || t.entry,
        plannedStop: t.plannedStop || t.stopLoss,
        plannedTarget: t.plannedTarget || t.takeProfit,
        plannedRR: t.plannedRR || t.riskReward,
        plannedShares: t.plannedShares || t.positionSize
      }));
      trades = mergeExecutionBrokerTrades(trades, executionStatus);
      
      // Default to Open Positions tab if there are open trades
      const openCount = trades.filter(t => t.status === 'open').length;
      if (openCount > 0) {
        switchTab('open');
      } else {
        renderTrades();
      }
      updateStats();
      
      // Start fetching live prices for open positions
      if (openCount > 0) {
        startPriceRefresh();
      }
    }
    
    // Save trades to backend - updates each modified trade
    async function saveTrades() {
      for (const trade of trades) {
        await saveOneTrade(trade);
      }
    }
    
    // Save a single trade to backend
    async function saveOneTrade(trade) {
      if (_isBridgeManagedTrade(trade)) return;
      try {
        await fetch(`/api/trades/${trade.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trade)
        });
      } catch (e) {
        console.error('Failed to save trade:', e);
      }
    }
    
    // Switch tabs
    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab, .tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      renderTrades();
      
      // Start/stop price refresh based on tab
      if (tab === 'open') {
        startPriceRefresh();
      } else {
        stopPriceRefresh();
      }
    }
    
    // Render trades
    function renderTrades() {
      const container = document.getElementById('trade-list');
      const filtered = trades.filter(t => {
        if (currentTab === 'planned') return t.status === 'planned';
        if (currentTab === 'open') return t.status === 'open';
        if (currentTab === 'closed') return t.status === 'closed';
        return true;
      });
      
      if (filtered.length === 0) {
        const messages = {
          planned: { icon: '📋', title: 'No Planned Trades', desc: 'Save trade setups from the Trading Desk' },
          open: { icon: '📭', title: 'No Open Positions', desc: 'Execute a planned trade to see it here' },
          closed: { icon: '📊', title: 'No Closed Trades', desc: 'Close a position to see it here' }
        };
        const msg = messages[currentTab];
        container.innerHTML = `
          <div style="text-align:center;padding:var(--space-32) 0;">
            <div style="font-size:4rem;margin-bottom:var(--space-16);">${msg.icon}</div>
            <h3 style="font-size:var(--text-h2);font-weight:700;margin-bottom:var(--space-8);">${msg.title}</h3>
            <p style="color:var(--color-text-muted);">${msg.desc}</p>
          </div>
        `;
        return;
      }
      
      container.innerHTML = filtered.map(trade => renderTradeCard(trade)).join('');
    }
    
    // Render single trade card
    function renderTradeCard(t) {
      const statusClass = t.outcome ? `outcome-${t.outcome}` : `status-${t.status}`;
      const isOpt = t.instrumentType === 'options';
      // For options, show premium as entry, not underlying stock price
      const entry = isOpt ? (t.optionPrice || 0) : (t.actualEntry || t.plannedEntry);
      const shares = t.actualShares || t.plannedShares;
      const unitLabel = getTradeUnitLabel(t);
      const instNames = { stock: 'Stock', futures: 'Futures', options: 'Options', forex: 'Forex', crypto: 'Crypto' };
      const instLabel = instNames[t.instrumentType] || 'Stock';
      const dirLabel = t.direction === -1 ? 'SHORT' : 'LONG';
      const dirColor = t.direction === -1 ? '#9a5050' : '#4a8a60';
      
      // Build Performance Display (P&L must dominate)
      let pnlHtml = '';
      
      if (t.status === 'closed' && t.actualPnL !== null && t.actualPnL !== undefined) {
        // Closed: Large final P&L
        const pnlColor = t.actualPnL >= 0 ? '#4a8a60' : '#9a5050';
        const rMultiple = t.actualRMultiple ? `${t.actualRMultiple.toFixed(2)}R` : '';
        pnlHtml = `
          <div style="font-size:2rem;font-weight:700;font-family:var(--font-mono);color:${pnlColor};line-height:1;">
            ${t.actualPnL >= 0 ? '+' : ''}$${fmtUSD(t.actualPnL)}
          </div>
          ${rMultiple ? `<div style="font-size:var(--text-small);color:var(--color-text-muted);margin-top:var(--space-4);">${rMultiple}</div>` : ''}
        `;
        
      } else if (t.status === 'open') {
        const isOpt = t.instrumentType === 'options';
        
        if (isOpt) {
          // Options: Show P&L if premiums are set
          const entryPrem = t.optionPrice || 0;
          const currPrem = t.optionCurrentPremium || 0;
          const mult = t.contractMultiplier || 100;
          const units = t.actualShares || t.plannedShares || 1;
          
          if (entryPrem > 0 && currPrem > 0) {
            const totalCost = entryPrem * mult * units;
            const totalValue = currPrem * mult * units;
            const optPnl = totalValue - totalCost;
            const pctReturn = ((currPrem - entryPrem) / entryPrem * 100).toFixed(1);
            const pnlColor = optPnl >= 0 ? '#4a8a60' : '#9a5050';
            const sign = optPnl >= 0 ? '+' : '';
            
            pnlHtml = `
              <div style="font-size:2rem;font-weight:700;font-family:var(--font-mono);color:${pnlColor};line-height:1;">
                ${sign}$${fmtUSD(optPnl)}
              </div>
              <div style="font-size:var(--text-small);color:${pnlColor};margin-top:var(--space-4);">${sign}${pctReturn}%</div>
              ${t._optionBid || t._optionAsk ? `<div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:var(--space-4);">Bid/Ask: $${fmtUSD(t._optionBid || 0)}/$${fmtUSD(t._optionAsk || 0)}</div>` : ''}
            `;
          } else {
            pnlHtml = `
              <div style="font-size:var(--text-small);color:var(--color-text-subtle);font-style:italic;">
                Click EDIT to set premiums
              </div>
            `;
          }
          
        } else {
          // Non-options: Live P&L placeholder (updated by fetchLivePrices)
          pnlHtml = `<div id="live-pnl-${t.id}" style="font-size:2rem;font-weight:700;font-family:var(--font-mono);color:var(--color-text-muted);line-height:1;">--</div>`;
        }
        
        // Add projections for all open trades
        let projTarget = null;
        let projStop = null;

        if (isOpt) {
          const entryPrem = t.optionPrice || 0;
          const mult = t.contractMultiplier || 100;
          const units = t.actualShares || t.plannedShares || 1;
          const uPrice = t.underlyingEntry || t._underlyingPrice || 0;
          if (t.optionTargetPremium && entryPrem > 0) {
            projTarget = (t.optionTargetPremium - entryPrem) * mult * units;
          } else if (t.plannedTarget && entryPrem > 0 && uPrice > 0 && (t._optionDelta || t._optionIV)) {
            const delta = t._optionDelta || ((t.optionType === 'put') ? -0.4 : 0.4);
            const estPremAtTarget = entryPrem + (t.plannedTarget - uPrice) * delta;
            projTarget = (Math.max(0, estPremAtTarget) - entryPrem) * mult * units;
          }
          if (t.optionStopPremium && entryPrem > 0) {
            projStop = (t.optionStopPremium - entryPrem) * mult * units;
          } else if (entryPrem > 0) {
            projStop = -entryPrem * mult * units;
          }
        } else {
          projTarget = t.plannedTarget ? computeTradePnL(t, t.plannedTarget) : null;
          const stopPrice = t.currentStop || t.plannedStop;
          projStop = stopPrice ? computeTradePnL(t, stopPrice) : null;
        }
        
        if (projTarget !== null || projStop !== null) {
          pnlHtml += `<div style="margin-top:var(--space-12);display:flex;flex-direction:column;gap:var(--space-4);font-size:var(--text-caption);">`;
          if (projTarget !== null) {
            const tgtLabel = isOpt && !t.optionTargetPremium ? (t._optionDelta ? ' (delta est)' : ' (est)') : '';
            pnlHtml += `<div style="color:#4a8a60;">Target: ${projTarget >= 0 ? '+' : ''}$${fmtUSD(projTarget)}${tgtLabel}</div>`;
          }
          if (projStop !== null) {
            const stopLabel = isOpt && !t.optionStopPremium ? (t._optionDelta ? ' (delta est)' : t.plannedStop ? ' (est)' : ' (max loss)') : '';
            pnlHtml += `<div style="color:#9a5050;">Stop: ${projStop >= 0 ? '+' : '-'}$${fmtUSD(Math.abs(projStop))}${stopLabel}</div>`;
          }
          pnlHtml += `</div>`;
        }
        
      } else {
        // Planned: Show projected target
        const isOptPlanned = t.instrumentType === 'options';
        let projTargetPlanned = null;
        if (isOptPlanned) {
          const entryPrem = t.optionPrice || 0;
          const mult = t.contractMultiplier || 100;
          const units = t.plannedShares || 1;
          if (t.optionTargetPremium && entryPrem > 0) {
            projTargetPlanned = (t.optionTargetPremium - entryPrem) * mult * units;
          }
        } else {
          projTargetPlanned = t.plannedTarget ? computeTradePnL(t, t.plannedTarget) : null;
        }
        if (projTargetPlanned !== null) {
          pnlHtml = `
            <div style="font-size:var(--text-large);font-weight:600;color:var(--color-text-muted);">
              ${projTargetPlanned >= 0 ? '+' : ''}$${fmtUSD(projTargetPlanned)}
            </div>
            <div style="font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:var(--space-4);">projected</div>
          `;
        }
      }
      
      let actionButtons = '';
      if (t._bridgeManaged && t.status === 'open') {
        actionButtons = `
          <button onclick="event.stopPropagation(); openExecutionPanelForTrade(${t.id})" class="btn btn-primary" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);">
            Manage in Execution Desk
          </button>
        `;
      } else if (t.status === 'planned') {
        actionButtons = `
          <button onclick="event.stopPropagation(); openExecutionModal(${t.id})" class="btn btn-primary" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);">
            📈 Execute
          </button>
          <button onclick="event.stopPropagation(); openEditModal(${t.id})" class="btn" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);">✏️ Edit</button>
          <button onclick="event.stopPropagation(); deleteTrade(${t.id})" class="btn btn-ghost" style="padding:var(--space-4) var(--space-8);color:#9a5050;">🗑️</button>
        `;
      } else if (t.status === 'open') {
        const execConfig = getTradeExecutionConfig(t);
        const isLocked = execConfig && execConfig.production_lock;
        actionButtons = `
          <button onclick="event.stopPropagation(); openCloseoutModal(${t.id})" class="btn btn-success" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);">
            🏁 Close
          </button>
          ${isLocked
            ? `<button disabled class="btn" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);opacity:0.3;cursor:not-allowed;" title="Editing disabled — production mode">🔒 Locked</button>`
            : `<button onclick="event.stopPropagation(); openEditModal(${t.id})" class="btn" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);">✏️ Edit</button>`
          }
          <button onclick="event.stopPropagation(); deleteTrade(${t.id})" class="btn btn-ghost" style="padding:var(--space-4) var(--space-8);color:#9a5050;">🗑️</button>
        `;
      } else {
        actionButtons = `
          <button onclick="event.stopPropagation(); reopenTrade(${t.id})" class="btn" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);">
            &#8634; Reopen
          </button>
          <button onclick="event.stopPropagation(); openEditModal(${t.id})" class="btn btn-ghost" style="padding:var(--space-4) var(--space-12);font-size:var(--text-small);">&#9998; Edit</button>
          <button onclick="event.stopPropagation(); deleteTrade(${t.id})" class="btn btn-ghost" style="padding:var(--space-4) var(--space-8);color:#9a5050;">&#128465;</button>
        `;
      }
      
      // Build Position Details Box (Column 2)
      const optVol = t._optionVolume;
      const optOI = t._optionOI;
      const optIV = t._optionIV;
      // Liquidity warning: if your position is >5% of daily volume or >2% of OI
      const positionContracts = shares || 0;
      const volWarning = (optVol && positionContracts > 0 && positionContracts / optVol > 0.05);
      const oiWarning = (optOI && positionContracts > 0 && positionContracts / optOI > 0.02);
      const liquidityFlag = volWarning || oiWarning;

      const positionBox = isOpt ? `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:var(--space-4) var(--space-12);font-size:var(--text-small);">
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">PREMIUM</div>
          <div style="font-weight:600;font-family:var(--font-mono);">$${fmtUSD(entry)}/sh</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">CONTRACTS</div>
          <div style="font-weight:600;font-family:var(--font-mono);">${shares || '--'}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">COST</div>
          <div style="font-weight:600;font-family:var(--font-mono);">$${fmtUSD((entry || 0) * (t.contractMultiplier || 100) * (shares || 0))}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">STRIKE</div>
          <div style="font-weight:600;font-family:var(--font-mono);">$${t.optionStrike || '--'}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">EXPIRY</div>
          <div style="font-weight:600;font-family:var(--font-mono);">${t.optionExpiry || '<span style="color:#c8a03c;">not set</span>'}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">TARGET</div>
          <div style="font-weight:600;font-family:var(--font-mono);color:#4a8a60;">$${fmtUSD(t.plannedTarget)}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">STOP</div>
          <div style="font-weight:600;font-family:var(--font-mono);color:#9a5050;">$${fmtUSD(t.currentStop || t.plannedStop)}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">VOL / OI</div>
          <div style="font-weight:600;font-family:var(--font-mono);${liquidityFlag ? 'color:#c8a03c;' : ''}">
            ${optVol != null ? optVol.toLocaleString() : '--'} / ${optOI != null ? optOI.toLocaleString() : '--'}
            ${liquidityFlag ? ' <span title="Your position is a significant % of daily volume or open interest — exits may have slippage" style="cursor:help;">⚠</span>' : ''}
          </div>
          ${optIV != null ? `
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">IV</div>
          <div style="font-weight:600;font-family:var(--font-mono);">${optIV.toFixed(1)}%</div>
          ` : ''}
          ${t._optionDelta != null ? `
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">DELTA</div>
          <div style="font-weight:600;font-family:var(--font-mono);">${t._optionDelta.toFixed(3)}</div>
          ` : ''}
          ${t._optionTheta != null ? `
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">THETA</div>
          <div style="font-weight:600;font-family:var(--font-mono);color:#9a5050;">${t._optionTheta.toFixed(3)}/day</div>
          ` : ''}
        </div>
      ` : `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:var(--space-4) var(--space-12);font-size:var(--text-small);">
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">ENTRY</div>
          <div style="font-weight:600;font-family:var(--font-mono);color:var(--color-accent);">$${fmtUSD(entry)}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">STOP</div>
          <div style="font-weight:600;font-family:var(--font-mono);color:#9a5050;">$${fmtUSD(t.currentStop || t.plannedStop)}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">TARGET</div>
          <div style="font-weight:600;font-family:var(--font-mono);color:#4a8a60;">$${fmtUSD(t.plannedTarget)}</div>
          <div style="color:var(--color-text-subtle);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">SIZE</div>
          <div style="font-weight:600;font-family:var(--font-mono);">${shares || '--'} ${unitLabel}</div>
        </div>
      `;
      
      const missingFields = [];
      if (isOpt) {
        if (!t.optionExpiry) missingFields.push('expiry');
        if (!t.plannedTarget && !t.optionTargetPremium) missingFields.push('target');
        if (!t.plannedStop && !t.currentStop && !t.optionStopPremium) missingFields.push('stop');
      }
      const missingWarning = missingFields.length > 0
        ? `<div style="margin-top:var(--space-8);padding:var(--space-4) var(--space-8);background:rgba(200,160,60,0.1);border:1px solid rgba(200,160,60,0.3);border-radius:var(--radius);font-size:var(--text-caption);color:#c8a03c;">
            ⚠ Set ${missingFields.join(', ')} via Edit for live greeks &amp; projections
          </div>`
        : '';

      // Conditionally show badge: hide it if viewing trades in their matching tab
      const showBadge = !(
        (currentTab === 'planned' && t.status === 'planned') ||
        (currentTab === 'open' && t.status === 'open') ||
        (currentTab === 'closed' && t.status === 'closed')
      );
      
      return `
        <div class="trade-card ${statusClass}" style="cursor:pointer;position:relative;" onclick="loadTradeInCopilot(${t.id}, event)">
          <!-- Status Badge Top Right (hidden when viewing tab that matches status) -->
          ${showBadge ? `<span class="badge ${getStatusBadgeClass(t)}" style="position:absolute;top:var(--space-12);right:var(--space-12);">${getStatusLabel(t)}</span>` : ''}
          
          <!-- 3 Column Grid: Identity | Position | Performance -->
          <div style="display:grid;grid-template-columns:auto 1fr auto;gap:var(--space-24);align-items:start;">
            
            <!-- COLUMN 1: Identity -->
            <div style="display:flex;flex-direction:column;gap:var(--space-8);min-width:120px;">
              ${t.chartImage ? `<img src="data:image/png;base64,${t.chartImage}" style="width:120px;height:80px;object-fit:cover;border-radius:var(--radius);border:1px solid var(--color-border);">` : 
                `<div style="width:120px;height:80px;background:var(--color-surface-alt);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;font-size:2.5rem;">📈</div>`}
              
              <div style="font-size:var(--text-h2);font-weight:700;font-family:var(--font-mono);line-height:1;">${t.symbol}</div>
              <div style="font-size:var(--text-small);color:var(--color-text-muted);line-height:1.4;">
                ${instLabel} <span style="color:${dirColor};font-weight:600;">${dirLabel}</span>
              </div>
              <div style="font-size:var(--text-caption);color:var(--color-text-subtle);line-height:1.3;">
                ${t.displayDate}
              </div>
              ${t.patternType ? `<div style="font-size:var(--text-caption);color:var(--color-text-subtle);text-transform:uppercase;letter-spacing:0.05em;">${t.patternType}</div>` : ''}
              ${t._bridgeManaged ? `<div style="font-size:10px;color:#4a8a60;text-transform:uppercase;letter-spacing:0.08em;font-family:var(--font-mono);font-weight:700;">${String(t._bridgeLabel || ('Execution ' + String(t._bridgeMode || 'paper').toUpperCase()))}</div>` : ''}
            </div>
            
            <!-- COLUMN 2: Position Details Box -->
            <div
              style="background:var(--color-void);border:1px solid var(--color-border);border-radius:var(--radius);padding:var(--space-12);min-width:200px;cursor:pointer;transition:border-color 120ms ease, transform 120ms ease;"
              onclick="openPositionPanelAction(${t.id}, event)"
              title="${t._bridgeManaged ? 'Open in Execution Desk to manage stop and target' : 'Edit stop, target, and position details'}"
            >
              <div style="font-size:var(--text-caption);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:var(--space-8);font-weight:600;">Position</div>
              ${positionBox}
              ${missingWarning}
              <div style="margin-top:var(--space-10);font-size:10px;color:var(--color-text-subtle);text-transform:uppercase;letter-spacing:0.08em;font-family:var(--font-mono);">
                ${t._bridgeManaged ? 'Click to manage in Execution Desk' : 'Click to edit levels'}
              </div>
            </div>
            
            <!-- COLUMN 3: Performance & Actions -->
            <div style="display:flex;flex-direction:column;gap:var(--space-12);min-width:180px;align-items:flex-end;">
              <div style="text-align:right;">
                ${pnlHtml}
              </div>
              <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;justify-content:flex-end;">
                ${actionButtons}
              </div>
            </div>
            
          </div>
          
          ${t.status === 'open' ? renderExecutionBarForCard(t) : ''}
          ${t.preTradePlan ? `<div style="margin-top:var(--space-16);padding-top:var(--space-12);border-top:1px solid var(--color-border);font-size:var(--text-small);color:var(--color-text-muted);">📝 ${t.preTradePlan.substring(0, 100)}...</div>` : ''}
        </div>
      `;
    }

    /**
     * Build the execution ladder container for a trade card.
     * Outputs a div that gets filled/updated by price refresh.
     */
    function renderExecutionBarForCard(t) {
      if (_isBridgeManagedTrade(t)) {
        return `
          <div id="exec-bar-${t.id}" style="margin-top:var(--space-12);padding:var(--space-8) var(--space-12);border-top:1px solid var(--color-border);font-size:var(--text-caption);color:var(--color-text-subtle);">
            Managed by Execution Desk (${String(t._bridgeMode || 'paper').toUpperCase()} mode). Use Execution Desk to modify or close this position.
          </div>
        `;
      }
      // Ensure initial stop is persisted
      ensureInitialStop(t);

      // Try rendering immediately if we can calculate R
      let currentR = null;
      if (t.instrumentType === 'options') {
        currentR = calcOptionsR(t);
      } else {
        const liveData = livePrices[t.symbol];
        const currentPrice = liveData ? liveData.price : null;
        if (currentPrice) {
          currentR = calcTradeR(t, currentPrice);
        }
      }

      let innerHtml = '';
      if (currentR !== null) {
        if (!t._peakR || currentR > t._peakR) t._peakR = currentR;
        innerHtml = renderExecutionBar(t, currentR, t._peakR);
      } else {
        // Show placeholder even without price — may have "define stop" message
        const rpu = getRiskPerUnit(t);
        if (!rpu && t.instrumentType !== 'options') {
          innerHtml = `<div style="margin-top:var(--space-12);padding:var(--space-8) var(--space-12);border-top:1px solid var(--color-border);font-size:var(--text-caption);color:var(--color-text-subtle);font-style:italic;">
            Define initial stop to enable R rules.
          </div>`;
        }
      }

      return `<div id="exec-bar-${t.id}">${innerHtml}</div>`;
    }
    
    function getStatusBadgeClass(t) {
      if (t.outcome === 'won') return 'badge--won';
      if (t.outcome === 'lost') return 'badge--lost';
      if (t.outcome === 'breakeven') return 'badge--breakeven';
      if (t.outcome === 'cancelled') return 'badge--cancelled';
      if (t.status === 'open') return 'badge--open';
      return 'badge--planned';
    }
    
    function getStatusLabel(t) {
      if (t.outcome) return t.outcome.toUpperCase();
      return t.status.toUpperCase();
    }
    
    // Update statistics
    function updateStats() {
      const planned = trades.filter(t => t.status === 'planned').length;
      const openCount = trades.filter(t => t.status === 'open').length;
      const closed = trades.filter(t => t.status === 'closed');
      
      const won = closed.filter(t => t.outcome === 'won').length;
      const lost = closed.filter(t => t.outcome === 'lost').length;
      const winRate = closed.length > 0 ? Math.round((won / closed.length) * 100) : 0;
      
      const totalPnL = closed.reduce((sum, t) => sum + (t.actualPnL || 0), 0);
      const avgR = closed.length > 0 ? closed.reduce((sum, t) => sum + (t.actualRMultiple || 0), 0) / closed.length : 0;

      // Max Drawdown calculation
      let peak = 0, maxDD = 0, equity = 0;
      const sortedClosed = [...closed].sort((a, b) => new Date(a.exitTime || a.createdAt) - new Date(b.exitTime || b.createdAt));
      sortedClosed.forEach(t => {
        equity += (t.actualPnL || 0);
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDD) maxDD = dd;
      });

      // Expectancy: avgWin * winRate - avgLoss * lossRate
      const avgWin = won > 0 ? closed.filter(t => t.outcome === 'won').reduce((s, t) => s + (t.actualPnL || 0), 0) / won : 0;
      const avgLoss = lost > 0 ? Math.abs(closed.filter(t => t.outcome === 'lost').reduce((s, t) => s + (t.actualPnL || 0), 0) / lost) : 0;
      const expectancy = closed.length > 0 ? ((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss) : 0;
      
      // Today's P&L
      const today = new Date().toDateString();
      const todayTrades = closed.filter(t => new Date(t.exitTime || t.createdAt).toDateString() === today);
      const dailyPnL = todayTrades.reduce((sum, t) => sum + (t.actualPnL || 0), 0);
      
      // Open risk (instrument-aware)
      const openRisk = trades.filter(t => t.status === 'open').reduce((sum, t) => {
        const entry = t.actualEntry || t.plannedEntry;
        const stop = t.currentStop || t.plannedStop;
        const units = t.actualShares || t.plannedShares;
        if (!entry || !stop || !units) return sum;
        const riskPnl = computeTradePnL(t, stop);
        return sum + Math.abs(riskPnl || (Math.abs(entry - stop) * units));
      }, 0);
      
      const totalTrades = trades.length;
      
      // === Update main content stat cards ===
      
      // Row 1
      const pnlEl = document.getElementById('stat-pnl');
      pnlEl.textContent = `${totalPnL >= 0 ? '+' : ''}$${fmtUSD(totalPnL)}`;
      pnlEl.style.color = totalPnL >= 0 ? 'var(--color-positive, #4a8a60)' : 'var(--color-negative, #9a5050)';
      
      document.getElementById('stat-winrate').textContent = winRate + '%';
      
      document.getElementById('stat-avgr').textContent = avgR.toFixed(1);
      
      const maxddEl = document.getElementById('stat-maxdd');
      maxddEl.textContent = maxDD > 0 ? `-${maxDD.toFixed(1)}%` : '0%';
      if (maxDD > 0) maxddEl.style.color = 'var(--color-negative, #9a5050)';
      
      const expEl = document.getElementById('stat-expectancy');
      expEl.textContent = `${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(2)}`;
      expEl.style.color = expectancy >= 0 ? 'var(--color-positive, #4a8a60)' : 'var(--color-negative, #9a5050)';
      
      // Row 2
      document.getElementById('stat-total').textContent = totalTrades;
      document.getElementById('stat-open').textContent = openCount;
      document.getElementById('stat-wins').textContent = won;
      document.getElementById('stat-losses').textContent = lost;
      
      // Badges
      document.getElementById('badge-planned').textContent = planned;
      document.getElementById('badge-open').textContent = openCount;
      document.getElementById('badge-closed').textContent = closed.length;
      
      // Trade count subtitle
      document.getElementById('trade-count-subtitle').textContent = totalTrades + ' trade' + (totalTrades !== 1 ? 's' : '');
      
      // Hidden compat elements
      var spEl = document.getElementById('stat-planned');
      if (spEl) spEl.textContent = planned;
      var scEl = document.getElementById('stat-closed');
      if (scEl) scEl.textContent = closed.length;
      var dpEl = document.getElementById('daily-pnl');
      if (dpEl) dpEl.textContent = `${dailyPnL >= 0 ? '+' : ''}$${fmtUSD(dailyPnL)}`;
      var orEl = document.getElementById('open-risk');
      if (orEl) orEl.textContent = `$${fmtUSD(openRisk)}`;
      
      // Risk bar
      var riskBar = document.getElementById('risk-bar');
      if (riskBar) {
        const riskPercent = Math.min((Math.abs(dailyPnL) / deskSettings.dailyLimit) * 100, 100);
        riskBar.style.width = riskPercent + '%';
        riskBar.style.background = dailyPnL < 0 ? (riskPercent > 80 ? '#9a5050' : '#8a8a4a') : '#4a8a60';
      }
      
      // Draw equity curve
      drawEquityCurve(sortedClosed);
    }
    
    // ========== EQUITY CURVE ==========
    function drawEquityCurve(sortedClosed) {
      var canvas = document.getElementById('equity-canvas');
      var emptyLabel = document.getElementById('equity-empty');
      if (!canvas) return;
      
      var ctx = canvas.getContext('2d');
      var rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = rect.height * (window.devicePixelRatio || 1);
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      var w = rect.width, h = rect.height;
      ctx.clearRect(0, 0, w, h);
      
      // Always draw grid lines
      var gridCols = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (var gi = 1; gi < gridCols; gi++) {
        var gx = Math.round((gi / gridCols) * w) + 0.5;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      // Horizontal grid lines
      var gridRows = 4;
      for (var gj = 1; gj < gridRows; gj++) {
        var gy = Math.round((gj / gridRows) * h) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
      
      if (!sortedClosed || sortedClosed.length < 1) {
        if (emptyLabel) emptyLabel.style.display = 'flex';
        return;
      }
      if (emptyLabel) emptyLabel.style.display = 'none';
      
      // Build equity series
      var equitySeries = [0];
      var eq = 0;
      sortedClosed.forEach(function(t) {
        eq += (t.actualPnL || 0);
        equitySeries.push(eq);
      });
      
      var minY = Math.min.apply(null, equitySeries);
      var maxY = Math.max.apply(null, equitySeries);
      if (minY === maxY) { minY -= 1; maxY += 1; }
      var pad = 12;
      var plotW = w - pad * 2;
      var plotH = h - pad * 2;
      
      // Draw zero line
      var zeroY = pad + plotH - ((0 - minY) / (maxY - minY)) * plotH;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad, zeroY);
      ctx.lineTo(w - pad, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw equity line
      ctx.strokeStyle = equitySeries[equitySeries.length - 1] >= 0 ? '#4a8a60' : '#9a5050';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      equitySeries.forEach(function(val, i) {
        var x = pad + (i / (equitySeries.length - 1)) * plotW;
        var y = pad + plotH - ((val - minY) / (maxY - minY)) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      
      // Fill under curve
      var lastX = pad + plotW;
      ctx.lineTo(lastX, zeroY);
      ctx.lineTo(pad, zeroY);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      if (equitySeries[equitySeries.length - 1] >= 0) {
        grad.addColorStop(0, 'rgba(74,138,96,0.15)');
        grad.addColorStop(1, 'rgba(74,138,96,0)');
      } else {
        grad.addColorStop(0, 'rgba(154,80,80,0)');
        grad.addColorStop(1, 'rgba(154,80,80,0.15)');
      }
      ctx.fillStyle = grad;
      ctx.fill();
    }
    
    // Redraw equity on resize
    window.addEventListener('resize', function() { updateStats(); });

    // ========== FILTERS ==========
    function applyFilters() {
      renderTrades();
      updateStats();
    }
    
    function getFilteredTrades() {
      var period = document.getElementById('filter-period');
      var status = document.getElementById('filter-status');
      var strategy = document.getElementById('filter-strategy');
      
      var filtered = trades.slice();
      
      // Period filter
      if (period && period.value !== 'all') {
        var now = new Date();
        var cutoff = new Date();
        switch (period.value) {
          case 'today': cutoff.setHours(0,0,0,0); break;
          case 'week': cutoff.setDate(now.getDate() - now.getDay()); cutoff.setHours(0,0,0,0); break;
          case 'month': cutoff.setDate(1); cutoff.setHours(0,0,0,0); break;
          case 'quarter': cutoff.setMonth(Math.floor(now.getMonth() / 3) * 3, 1); cutoff.setHours(0,0,0,0); break;
          case 'year': cutoff.setMonth(0, 1); cutoff.setHours(0,0,0,0); break;
        }
        filtered = filtered.filter(function(t) {
          var d = new Date(t.exitTime || t.executionTime || t.createdAt);
          return d >= cutoff;
        });
      }
      
      // Status filter
      if (status && status.value !== 'all') {
        filtered = filtered.filter(function(t) { return t.status === status.value; });
      }
      
      // Strategy filter
      if (strategy && strategy.value !== 'all') {
        filtered = filtered.filter(function(t) { return (t.strategy || '').toLowerCase() === strategy.value; });
      }
      
      return filtered;
    }

    // EXECUTION MODAL
    function openExecutionModal(id) {
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      if (_guardBridgeManagedTrade(trade, 'manage this position')) return;
      
      const unitLabel = getTradeUnitLabel(trade);
      const fillPrice = trade.limitPrice || trade.plannedEntry;
      const orderLabel = trade.limitPrice ? `Limit @ $${fmtUSD(trade.limitPrice)}` : `Entry @ $${fmtUSD(trade.plannedEntry)}`;
      
      document.getElementById('exec-trade-id').value = trade.id;
      document.getElementById('exec-summary').innerHTML = `
        <strong>${trade.symbol}</strong> - ${trade.patternType || 'Manual'}<br>
        ${orderLabel} | ${trade.plannedShares} ${unitLabel}
      `;
      document.getElementById('exec-fill-price').value = fillPrice?.toFixed(2) || '';
      document.getElementById('exec-shares').value = trade.plannedShares || '';
      document.getElementById('exec-time').value = new Date().toISOString().slice(0, 16);
      document.getElementById('exec-notes').value = '';
      
      document.getElementById('execution-modal').classList.add('active');
    }
    
    function submitExecution() {
      const id = parseInt(document.getElementById('exec-trade-id').value);
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      
      const fillPrice = parseFloat(document.getElementById('exec-fill-price').value);
      const shares = parseInt(document.getElementById('exec-shares').value);
      
      if (!fillPrice || !shares) {
        alert('Please enter fill price and shares.');
        return;
      }
      
      trade.actualEntry = fillPrice;
      trade.actualShares = shares;
      trade.executionTime = document.getElementById('exec-time').value;
      trade.slippage = fillPrice - trade.plannedEntry;
      trade.status = 'open';
      
      saveTrades();
      closeModal('execution-modal');
      renderTrades();
      updateStats();
    }
    
    // ========== INSTRUMENT-AWARE P&L CALCULATION ==========
    
    function computeTradePnL(trade, exitPrice) {
      const entry = trade.actualEntry || trade.plannedEntry;
      const units = trade.actualShares || trade.plannedShares;
      const dir = trade.direction || 1; // default long
      
      if (!entry || !exitPrice || !units) return null;
      
      const type = trade.instrumentType || 'stock';
      
      switch (type) {
        case 'futures': {
          const ptVal = trade.futuresPointValue || 50; // default ES
          return (exitPrice - entry) * ptVal * units * dir;
        }
        case 'options': {
          const mult = trade.contractMultiplier || 100;
          return (exitPrice - entry) * mult * units;
        }
        case 'forex': {
          const lotUnits = { standard: 100000, mini: 10000, micro: 1000 };
          const unitsPerLot = lotUnits[trade.lotSize] || 100000;
          return (exitPrice - entry) * unitsPerLot * units * dir;
        }
        case 'crypto': {
          const feePct = trade.exchangeFee || 0.1;
          const gross = (exitPrice - entry) * units * dir;
          const entryFee = entry * units * (feePct / 100);
          const exitFee = exitPrice * units * (feePct / 100);
          return gross - entryFee - exitFee;
        }
        default: // stock
          return (exitPrice - entry) * units * dir;
      }
    }

    function getTradeUnitLabel(trade) {
      const type = trade.instrumentType || 'stock';
      const units = trade.actualShares || trade.plannedShares || 0;
      if (type === 'futures') return units === 1 ? 'contract' : 'contracts';
      if (type === 'options') return units === 1 ? 'contract' : 'contracts';
      if (type === 'forex') return (trade.lotSize || 'standard') + ' ' + (units === 1 ? 'lot' : 'lots');
      if (type === 'crypto') return 'units';
      return units === 1 ? 'share' : 'shares';
    }

    // CLOSEOUT MODAL
    async function openCloseoutModal(id) {
      try {
        const trade = trades.find(t => t.id == id);
        if (!trade) { alert('Trade not found'); return; }
        if (_guardBridgeManagedTrade(trade, 'close this position')) return;
        
        const isOpt = trade.instrumentType === 'options';
        const entry = trade.actualEntry || trade.plannedEntry;
        const units = trade.actualShares || trade.plannedShares;
        const unitLabel = getTradeUnitLabel(trade);
        const instNames = { stock: 'Stock', futures: 'Futures', options: 'Options', forex: 'Forex', crypto: 'Crypto' };
        const instType = instNames[trade.instrumentType] || 'Stock';
        const dirLabel = trade.direction === -1 ? 'SHORT' : 'LONG';
        const dirColor = trade.direction === -1 ? '#9a5050' : '#4a8a60';
        
        // For options, entry = premium paid per share (never use stock price)
        const entryDisplay = isOpt ? (trade.optionPrice || 0) : entry;
        
        document.getElementById('close-trade-id').value = trade.id;
        document.getElementById('close-summary').innerHTML = `
          <strong>${trade.symbol}</strong> (${instType}) 
          <span style="color:${dirColor};font-weight:700;">${dirLabel}</span>
          ${isOpt ? '<br><span style="font-size:var(--text-caption);color:#8a8a4a;">Options: enter the premium you sold at below</span>' : ''}
        `;
        
        // Show entry, size in the display
        document.getElementById('close-entry-display').textContent = entryDisplay != null ? '$' + fmtUSD(entryDisplay) + (isOpt ? '/sh' : '') : '--';
        document.getElementById('close-size-display').textContent = units ? units + ' ' + unitLabel : '--';
        document.getElementById('close-exit-display').textContent = isOpt ? 'Enter below' : 'Fetching...';
        
        // For options, pre-fill with current premium if available
        document.getElementById('close-exit-price').value = isOpt && trade.optionCurrentPremium ? trade.optionCurrentPremium.toFixed(2) : '';
        document.getElementById('close-reason').value = 'manual';
        document.getElementById('close-time').value = new Date().toISOString().slice(0, 16);
        document.getElementById('close-review').value = trade.postTradeReview || '';
        document.getElementById('close-pnl-value').textContent = '--';
        document.getElementById('close-r-value').textContent = '-- R';
        document.getElementById('close-price-hint').textContent = isOpt 
          ? '(enter the premium per share you sold/closed at)' 
          : '(fetching current price...)';
        
        // Live P&L preview on manual edit
        document.getElementById('close-exit-price').oninput = () => updateCloseoutPreview(trade);
        
        // Show the modal immediately
        document.getElementById('closeout-modal').classList.add('active');
        
        // For options, trigger preview right away if current premium is set
        if (isOpt && trade.optionCurrentPremium) {
          updateCloseoutPreview(trade);
        }
        
        // For non-options, fetch current stock price and auto-fill
        if (!isOpt) {
          try {
            const res = await fetch('/api/quotes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbols: [trade.symbol] })
            });
            const data = await res.json();
            if (data.success && data.data && data.data[trade.symbol] && data.data[trade.symbol].price) {
              const currentPrice = data.data[trade.symbol].price;
              document.getElementById('close-exit-price').value = currentPrice.toFixed(2);
              document.getElementById('close-exit-display').textContent = '$' + fmtUSD(currentPrice);
              document.getElementById('close-price-hint').textContent = '(auto-filled with current price - you can change it)';
              updateCloseoutPreview(trade);
            } else {
              document.getElementById('close-exit-display').textContent = 'Enter below';
              document.getElementById('close-price-hint').textContent = '(could not fetch - enter manually)';
            }
          } catch (e) {
            document.getElementById('close-exit-display').textContent = 'Enter below';
            document.getElementById('close-price-hint').textContent = '(could not fetch - enter manually)';
          }
        }
      } catch (e) {
        alert('Error: ' + e.message);
        console.error('openCloseoutModal error:', e);
      }
    }
    
    function updateCloseoutPreview(trade) {
      const exitPrice = parseFloat(document.getElementById('close-exit-price').value);
      const isOpt = trade.instrumentType === 'options';
      const units = trade.actualShares || trade.plannedShares;
      if (!exitPrice || !units) return;
      
      // Update exit display
      document.getElementById('close-exit-display').textContent = '$' + fmtUSD(exitPrice) + (isOpt ? '/sh' : '');
      
      let pnl;
      if (isOpt) {
        // Options: P&L = (exit premium - entry premium) × multiplier × contracts
        const entryPrem = trade.optionPrice || 0;
        const mult = trade.contractMultiplier || 100;
        pnl = (exitPrice - entryPrem) * mult * units;
      } else {
        pnl = computeTradePnL(trade, exitPrice);
      }
      
      if (pnl === null) return;
      
      const entry = isOpt ? (trade.optionPrice || 0) : (trade.actualEntry || trade.plannedEntry);
      const riskAmount = isOpt 
        ? (entry * (trade.contractMultiplier || 100) * units) // Options risk = total premium paid
        : (parseFloat(trade.plannedRiskAmount) || Math.abs(entry - (trade.currentStop || trade.plannedStop || entry)) * units);
      const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
      
      document.getElementById('close-pnl-value').textContent = `${pnl >= 0 ? '+' : ''}$${fmtUSD(pnl)}`;
      document.getElementById('close-pnl-value').className = `text-3xl font-bold ${pnl >= 0 ? 'stat-positive' : 'stat-negative'}`;
      document.getElementById('close-r-value').textContent = `${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(2)}R`;
      
      // Auto-suggest outcome based on P&L
      const outcomeSelect = document.getElementById('close-outcome');
      if (pnl > 0.50) outcomeSelect.value = 'won';
      else if (pnl < -0.50) outcomeSelect.value = 'lost';
      else outcomeSelect.value = 'breakeven';
    }
    
    function submitCloseout() {
      const id = document.getElementById('close-trade-id').value;
      const trade = trades.find(t => t.id == id);
      if (!trade) { alert('Trade not found'); return; }
      
      const exitPrice = parseFloat(document.getElementById('close-exit-price').value);
      
      if (!exitPrice) {
        alert('Please enter or confirm the exit price.');
        return;
      }
      
      const isOpt = trade.instrumentType === 'options';
      const units = trade.actualShares || trade.plannedShares;
      const reason = document.getElementById('close-reason').value || 'manual';
      
      let pnl;
      let entry;
      if (isOpt) {
        // Options: P&L based on premium difference (never use plannedEntry - that's stock price)
        entry = trade.optionPrice || 0;
        const mult = trade.contractMultiplier || 100;
        pnl = (exitPrice - entry) * mult * units;
      } else {
        entry = trade.actualEntry || trade.plannedEntry;
        pnl = computeTradePnL(trade, exitPrice);
      }
      
      const riskAmount = isOpt
        ? (entry * (trade.contractMultiplier || 100) * units) // For options: total premium paid
        : (parseFloat(trade.plannedRiskAmount) || Math.abs(entry - (trade.currentStop || trade.plannedStop || entry)) * units);
      const rMultiple = riskAmount > 0 ? (pnl || 0) / riskAmount : 0;
      
      // Record everything
      trade.actualEntry = trade.actualEntry || trade.plannedEntry;
      trade.actualShares = trade.actualShares || trade.plannedShares;
      trade.exitPrice = exitPrice;
      trade.exitTime = document.getElementById('close-time').value;
      trade.exitReason = reason;
      trade.actualPnL = pnl || 0;
      trade.actualRMultiple = rMultiple;
      trade.postTradeReview = document.getElementById('close-review').value;
      trade.status = 'closed';
      
      // For options, also save the exit premium
      if (isOpt) {
        trade.optionExitPremium = exitPrice;
      }
      
      // Use user-selected outcome
      trade.outcome = document.getElementById('close-outcome').value;
      
      saveTrades();
      closeModal('closeout-modal');
      switchTab('closed');
      updateStats();
    }
    
    // JOURNAL MODAL
    function openJournalModal(id) {
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      
      document.getElementById('journal-trade-id').value = id;
      document.getElementById('journal-plan').value = trade.preTradePlan || '';
      document.getElementById('journal-tags').value = (trade.tags || []).join(', ');
      
      document.getElementById('journal-modal').classList.add('active');
    }
    
    function saveJournal() {
      const id = parseInt(document.getElementById('journal-trade-id').value);
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      
      trade.preTradePlan = document.getElementById('journal-plan').value;
      trade.tags = document.getElementById('journal-tags').value.split(',').map(t => t.trim()).filter(t => t);
      
      saveTrades();
      closeModal('journal-modal');
      renderTrades();
    }
    
    // DETAIL MODAL
    function openDetailModal(id) {
      const t = trades.find(trade => trade.id == id);
      if (!t) return;
      
      const unitLabel = getTradeUnitLabel(t);
      const entry = t.actualEntry || t.plannedEntry;
      const units = t.actualShares || t.plannedShares;
      
      // Build projected / live P&L section for open trades
      let openPnlSection = '';
      if (t.status === 'open') {
        const isOptDetail = t.instrumentType === 'options';
        let projTarget = null;
        let projStop = null;

        if (isOptDetail) {
          const entryPrem = t.optionPrice || 0;
          const mult = t.contractMultiplier || 100;
          const dUnits = t.actualShares || t.plannedShares || 1;
          const uPrice = t.underlyingEntry || t._underlyingPrice || 0;
          if (t.optionTargetPremium && entryPrem > 0) {
            projTarget = (t.optionTargetPremium - entryPrem) * mult * dUnits;
          } else if (t.plannedTarget && entryPrem > 0 && uPrice > 0 && (t._optionDelta || t._optionIV)) {
            const delta = t._optionDelta || ((t.optionType === 'put') ? -0.4 : 0.4);
            const estPrem = entryPrem + (t.plannedTarget - uPrice) * delta;
            projTarget = (Math.max(0, estPrem) - entryPrem) * mult * dUnits;
          }
          if (t.optionStopPremium && entryPrem > 0) {
            projStop = (t.optionStopPremium - entryPrem) * mult * dUnits;
          } else if (entryPrem > 0) {
            projStop = -entryPrem * mult * dUnits;
          }
        } else {
          projTarget = t.plannedTarget ? computeTradePnL(t, t.plannedTarget) : null;
          projStop = computeTradePnL(t, t.currentStop || t.plannedStop);
        }
        const quote = livePrices[t.symbol];
        
        openPnlSection = `
          <div>
            <h4 style="font-weight:700;color:var(--color-text-muted);margin-bottom:var(--space-8);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">POSITION P&L</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-8);font-size:var(--text-small);">
              ${isOptDetail && t.optionCurrentPremium && t.optionPrice ? (() => {
                const _ep = t.optionPrice;
                const _cp = t.optionCurrentPremium;
                const _m = t.contractMultiplier || 100;
                const _u = t.actualShares || t.plannedShares || 1;
                const _pnl = (_cp - _ep) * _m * _u;
                const _pct = ((_cp - _ep) / _ep * 100).toFixed(1);
                const _col = _pnl >= 0 ? '#4a8a60' : '#9a5050';
                return `
                <div style="grid-column:1/-1;background:var(--color-surface);border-radius:var(--radius);padding:var(--space-12);margin-bottom:var(--space-8);text-align:center;">
                  <div style="font-size:var(--text-caption);color:var(--color-text-muted);">Current Premium</div>
                  <div style="font-size:var(--text-large);font-weight:700;">$${fmtUSD(_cp)}/sh
                    <span style="font-size:var(--text-caption);color:${_col};">(${_pnl >= 0 ? '+' : ''}${_pct}%)</span>
                  </div>
                  ${t._optionBid || t._optionAsk ? `<div style="font-size:var(--text-caption);color:var(--color-text-subtle);">Bid/Ask: $${fmtUSD(t._optionBid || 0)}/$${fmtUSD(t._optionAsk || 0)}</div>` : ''}
                  <div style="font-size:var(--text-caption);color:var(--color-text-muted);margin-top:var(--space-4);">Unrealized P&L</div>
                  <div style="font-size:var(--text-h3);font-weight:700;"><span style="color:${_col};">${_pnl >= 0 ? '+' : ''}$${fmtUSD(_pnl)}</span></div>
                </div>`;
              })() : quote && quote.price ? `
                <div style="grid-column:1/-1;background:var(--color-surface);border-radius:var(--radius);padding:var(--space-12);margin-bottom:var(--space-8);text-align:center;">
                  <div style="font-size:var(--text-caption);color:var(--color-text-muted);">Current Price</div>
                  <div style="font-size:var(--text-large);font-weight:700;">$${fmtUSD(quote.price)}
                    <span style="font-size:var(--text-caption);color:${quote.changePct >= 0 ? '#4a8a60' : '#9a5050'};">(${quote.changePct >= 0 ? '+' : ''}${quote.changePct}%)</span>
                  </div>
                  <div style="font-size:var(--text-caption);color:var(--color-text-muted);margin-top:var(--space-4);">Unrealized P&L</div>
                  <div id="detail-live-pnl-${t.id}" style="font-size:var(--text-h3);font-weight:700;">${(() => {
                    const pnl = computeTradePnL(t, quote.price);
                    if (pnl === null) return '--';
                    const pnlColor = pnl >= 0 ? '#4a8a60' : '#9a5050';
                    return `<span style="color:${pnlColor};">${pnl >= 0 ? '+' : ''}$${fmtUSD(pnl)}</span>`;
                  })()}</div>
                </div>
              ` : `
                <div style="grid-column:1/-1;background:var(--color-surface);border-radius:var(--radius);padding:var(--space-12);margin-bottom:var(--space-8);text-align:center;color:var(--color-text-subtle);font-size:var(--text-small);">Live price loading...</div>
              `}
              ${projTarget !== null ? `
                <div>\uD83C\uDFAF If Target Hit:</div>
                <div style="color:#4a8a60;font-weight:700;">${projTarget >= 0 ? '+' : ''}$${fmtUSD(projTarget)}</div>
              ` : ''}
              ${projStop !== null ? `
                <div>\uD83D\uDED1 If Stopped Out:</div>
                <div style="color:#9a5050;font-weight:700;">${projStop >= 0 ? '+' : '-'}$${fmtUSD(Math.abs(projStop))}</div>
              ` : ''}
            </div>
          </div>
        `;
      }
      
      document.getElementById('detail-title').textContent = `${t.symbol} - ${t.displayDate}`;
      document.getElementById('detail-content').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-24);">
          <div>
            ${t.chartImage ? `<img src="data:image/png;base64,${t.chartImage}" style="width:100%;border-radius:var(--radius);border:1px solid var(--color-border);margin-bottom:var(--space-16);">` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-16);">
            <div>
              <h4 style="font-weight:700;color:var(--color-text-muted);margin-bottom:var(--space-8);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">PLANNED</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-8);font-size:var(--text-small);">
                <div>Entry: <span style="color:var(--color-accent);">$${fmtUSD(t.plannedEntry)}</span></div>
                <div>Stop: <span style="color:#9a5050;">$${fmtUSD(t.plannedStop)}</span></div>
                <div>Target: <span style="color:#4a8a60;">$${fmtUSD(t.plannedTarget)}</span></div>
                <div>R:R: <span style="color:#8a8a4a;">1:${t.plannedRR}</span></div>
                <div>Size: ${units} ${unitLabel}</div>
                <div>Risk: $${t.plannedRiskAmount}</div>
              </div>
            </div>
            ${t.actualEntry ? `
              <div>
                <h4 style="font-weight:700;color:var(--color-text-muted);margin-bottom:var(--space-8);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">EXECUTION</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-8);font-size:var(--text-small);">
                  <div>Fill: $${fmtUSD(t.actualEntry)}</div>
                  <div>Shares: ${t.actualShares}</div>
                  <div>Slippage: ${t.slippage?.toFixed(2) || '--'}</div>
                  <div>Time: ${t.executionTime ? new Date(t.executionTime).toLocaleString() : '--'}</div>
                </div>
              </div>
            ` : ''}
            ${openPnlSection}
            ${t.exitPrice ? `
              <div>
                <h4 style="font-weight:700;color:var(--color-text-muted);margin-bottom:var(--space-8);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">CLOSEOUT</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-8);font-size:var(--text-small);">
                  <div>Exit: $${fmtUSD(t.exitPrice)}</div>
                  <div>Reason: ${t.exitReason}</div>
                  <div>P&L: <span style="color:${t.actualPnL >= 0 ? '#4a8a60' : '#9a5050'};">$${fmtUSD(t.actualPnL)}</span></div>
                  <div>R Multiple: ${t.actualRMultiple?.toFixed(2)}R</div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
        ${t.verdict ? `<div style="margin-top:var(--space-16);padding-top:var(--space-16);border-top:1px solid var(--color-border);"><h4 style="font-weight:700;color:var(--color-text-muted);margin-bottom:var(--space-8);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">AI VERDICT</h4><div style="background:var(--color-surface);border-radius:var(--radius);padding:var(--space-12);font-size:var(--text-small);white-space:pre-wrap;">${t.verdict}</div></div>` : ''}
        ${t.preTradePlan ? `<div style="margin-top:var(--space-16);padding-top:var(--space-16);border-top:1px solid var(--color-border);"><h4 style="font-weight:700;color:var(--color-text-muted);margin-bottom:var(--space-8);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">PRE-TRADE PLAN</h4><p style="font-size:var(--text-small);">${t.preTradePlan}</p></div>` : ''}
        ${t.postTradeReview ? `<div style="margin-top:var(--space-16);padding-top:var(--space-16);border-top:1px solid var(--color-border);"><h4 style="font-weight:700;color:var(--color-text-muted);margin-bottom:var(--space-8);font-size:var(--text-caption);text-transform:uppercase;letter-spacing:0.05em;">POST-TRADE REVIEW</h4><p style="font-size:var(--text-small);">${t.postTradeReview}</p></div>` : ''}
        <div style="margin-top:var(--space-16);padding-top:var(--space-16);border-top:1px solid var(--color-border);display:flex;gap:var(--space-8);justify-content:flex-end;flex-wrap:wrap;">
          ${t.status === 'planned' ? `<button onclick="closeModal('detail-modal'); openExecutionModal(${t.id})" class="btn btn-primary">\uD83D\uDCC8 Execute Trade</button>` : ''}
          ${t.status === 'open' ? `<button onclick="closeModal('detail-modal'); openCloseoutModal(${t.id})" class="btn btn-success">\uD83C\uDFC1 Close Position</button>` : ''}
          ${t.status === 'closed' ? `<button onclick="closeModal('detail-modal'); reopenTrade(${t.id})" class="btn">\u21BA Reopen</button>` : ''}
          <button onclick="closeModal('detail-modal'); openEditModal(${t.id})" class="btn">\u270E Edit</button>
          <button onclick="closeModal('detail-modal'); deleteTrade(${t.id})" class="btn" style="background:#9a5050;border-color:#9a5050;">\uD83D\uDDD1\uFE0F Delete</button>
        </div>
      `;
      
      document.getElementById('detail-modal').classList.add('active');
    }
    
    // Load trade chart in Trading Desk
    function loadTradeInCopilot(id, event) {
      // If clicking on action buttons, don't navigate
      if (event && event.target.closest('button')) {
        return;
      }
      
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      
      // Store trade data for Trading Desk to load
      const copilotData = {
        symbol: trade.symbol,
        interval: trade.interval || '1d',
        direction: trade.direction || 1,
        tradeId: trade.id,
        chartImage: trade.chartImage,
        patternData: trade.patternData || {},
        verdict: trade.verdict,
        preTradePlan: trade.preTradePlan,
        timestamp: Date.now()
      };
      
      localStorage.setItem('copilotLoadTrade', JSON.stringify(copilotData));
      
      // Navigate to Trading Desk
      window.location.href = 'copilot.html';
    }
    
    // Update option entry premium (what you paid)
    function updateOptionEntry(id, value) {
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      
      const newEntry = parseFloat(value);
      if (isNaN(newEntry) || newEntry < 0) return;
      
      trade.optionPrice = newEntry;
      saveOneTrade(trade);
      renderTrades();
    }
    
    // Update option current premium (what it's worth now)
    function updateOptionPremium(id, value) {
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      
      const newPremium = parseFloat(value);
      if (isNaN(newPremium) || newPremium < 0) return;
      
      trade.optionCurrentPremium = newPremium;
      saveOneTrade(trade);
      renderTrades();
    }
    
    // Reopen a closed trade (undo close)
    function reopenTrade(id) {
      const trade = trades.find(t => t.id == id);
      if (!trade) { alert('Trade not found'); return; }
      if (_guardBridgeManagedTrade(trade, 'reopen this position')) return;
      
      if (!confirm(`Reopen ${trade.symbol}? This will undo the close and move it back to Open Positions.`)) return;
      
      // Clear closeout data
      trade.exitPrice = null;
      trade.exitTime = null;
      trade.exitReason = null;
      trade.actualPnL = null;
      trade.actualRMultiple = null;
      trade.outcome = null;
      trade.status = 'open';
      
      saveOneTrade(trade);
      switchTab('open');
      updateStats();
    }
    
    // Cancel trade
    function cancelTrade(id) {
      if (!confirm('Cancel this trade setup?')) return;
      const trade = trades.find(t => t.id == id);
      if (trade) {
        trade.status = 'closed';
        trade.outcome = 'cancelled';
        trade.actualPnL = 0;
        saveTrades();
        renderTrades();
        updateStats();
      }
    }
    
    // Update outcome on closed trade
    function updateOutcome(id, outcome) {
      const trade = trades.find(t => t.id == id);
      if (trade) {
        trade.outcome = outcome;
        saveTrades();
        renderTrades();
        updateStats();
      }
    }
    
    // Delete trade permanently
    async function deleteTrade(id) {
      const trade = trades.find(t => t.id == id);
      if (_guardBridgeManagedTrade(trade, 'delete this position from the book')) return;
      if (!confirm('Permanently delete this trade?')) return;
      try {
        await fetch(`/api/trades/${id}`, { method: 'DELETE' });
      } catch (e) {
        console.error('Failed to delete trade:', e);
      }
      trades = trades.filter(t => t.id != id);
      renderTrades();
      updateStats();
    }
    
    // EDIT TRADE MODAL
    function openEditModal(id) {
      try {
        // Match by loose equality to handle string/number mismatch
        const trade = trades.find(t => t.id == id);
        if (!trade) {
          alert('Trade not found (id=' + id + '). Try refreshing the page.');
          return;
        }
        if (_guardBridgeManagedTrade(trade, 'edit this position')) return;
        
        const entry = trade.actualEntry || trade.plannedEntry;
        const units = trade.actualShares || trade.plannedShares;
        
        document.getElementById('edit-trade-id').value = trade.id;
        document.getElementById('edit-summary').innerHTML = `<strong>${trade.symbol}</strong> - ${trade.displayDate || 'No date'}`;
        document.getElementById('edit-direction').value = String(trade.direction || 1);
        document.getElementById('edit-instrument').value = trade.instrumentType || 'stock';
        document.getElementById('edit-entry').value = entry ? entry.toFixed(2) : '';
        document.getElementById('edit-size').value = units || '';
        document.getElementById('edit-stop').value = (trade.currentStop || trade.plannedStop) ? (trade.currentStop || trade.plannedStop).toFixed(2) : '';
        document.getElementById('edit-target').value = trade.plannedTarget ? trade.plannedTarget.toFixed(2) : '';
        document.getElementById('edit-status').value = trade.status || 'open';
        
        // Show/hide options premium field
        const optPremRow = document.getElementById('edit-option-premium-row');
        if (optPremRow) {
          if (trade.instrumentType === 'options') {
            optPremRow.style.display = '';
            document.getElementById('edit-option-premium').value = trade.optionPrice || '';
            document.getElementById('edit-option-strike').value = trade.optionStrike || '';
            document.getElementById('edit-option-expiry').value = trade.optionExpiry || '';
            document.getElementById('edit-option-type').value = trade.optionType || 'call';
            document.getElementById('edit-underlying-entry').value = trade.underlyingEntry || '';
            document.getElementById('edit-option-target-premium').value = trade.optionTargetPremium || '';
            document.getElementById('edit-option-stop-premium').value = trade.optionStopPremium || '';
          } else {
            optPremRow.style.display = 'none';
          }
        }
        
        document.getElementById('edit-modal').classList.add('active');
      } catch (e) {
        alert('Error opening edit: ' + e.message);
        console.error('openEditModal error:', e);
      }
    }
    
    function submitEdit() {
      const id = document.getElementById('edit-trade-id').value;
      const trade = trades.find(t => t.id == id);
      if (!trade) { alert('Trade not found'); return; }
      
      const newEntry = parseFloat(document.getElementById('edit-entry').value);
      const newSize = parseInt(document.getElementById('edit-size').value);
      const newStop = parseFloat(document.getElementById('edit-stop').value);
      const newTarget = parseFloat(document.getElementById('edit-target').value);
      const newDirection = parseInt(document.getElementById('edit-direction').value);
      const newInstrument = document.getElementById('edit-instrument').value;
      const newStatus = document.getElementById('edit-status').value;
      
      if (!newEntry || !newSize) {
        alert('Entry price and position size are required.');
        return;
      }
      
      // Update planned levels
      trade.plannedEntry = newEntry;
      trade.plannedShares = newSize;
      trade.plannedStop = newStop || 0;
      trade.currentStop = newStop || 0;
      trade.plannedTarget = newTarget || null;
      trade.direction = newDirection;
      trade.instrumentType = newInstrument;
      trade.status = newStatus;
      
      // If options, save option premium + contract details
      if (newInstrument === 'options') {
        const premiumInput = document.getElementById('edit-option-premium');
        if (premiumInput && premiumInput.value) {
          trade.optionPrice = parseFloat(premiumInput.value);
        }
        const strikeInput = document.getElementById('edit-option-strike');
        if (strikeInput && strikeInput.value) {
          trade.optionStrike = parseFloat(strikeInput.value);
        }
        const expiryInput = document.getElementById('edit-option-expiry');
        if (expiryInput && expiryInput.value) {
          trade.optionExpiry = expiryInput.value;
        }
        const typeInput = document.getElementById('edit-option-type');
        if (typeInput && typeInput.value) {
          trade.optionType = typeInput.value;
        }
        const ueInput = document.getElementById('edit-underlying-entry');
        trade.underlyingEntry = ueInput && ueInput.value ? parseFloat(ueInput.value) : null;
        const targetPremInput = document.getElementById('edit-option-target-premium');
        trade.optionTargetPremium = targetPremInput && targetPremInput.value ? parseFloat(targetPremInput.value) : null;
        const stopPremInput = document.getElementById('edit-option-stop-premium');
        trade.optionStopPremium = stopPremInput && stopPremInput.value ? parseFloat(stopPremInput.value) : null;
      }
      
      // If trade has actual execution data, update that too
      if (trade.actualEntry) trade.actualEntry = newEntry;
      if (trade.actualShares) trade.actualShares = newSize;
      
      // Recalculate R:R
      const risk = newStop ? Math.abs(newEntry - newStop) : 0;
      const reward = newTarget ? Math.abs(newTarget - newEntry) : 0;
      trade.plannedRR = (reward > 0 && risk > 0) ? (reward / risk).toFixed(2) : '--';
      trade.plannedRiskAmount = (risk * newSize).toFixed(2);
      
      saveOneTrade(trade);
      closeModal('edit-modal');
      renderTrades();
      updateStats();

      // If options trade was edited, fetch quotes immediately (don't wait for interval)
      if (newInstrument === 'options' && trade.optionStrike && trade.optionExpiry) {
        setTimeout(() => fetchLivePrices(), 500);
      }
    }
    
    // Adjust stop (simple prompt for now)
    function adjustStop(id) {
      const trade = trades.find(t => t.id == id);
      if (!trade) return;
      
      const newStop = prompt(`Current stop: $${fmtUSD(trade.currentStop)}\nEnter new stop price:`);
      if (!newStop) return;
      
      const stopPrice = parseFloat(newStop);
      if (isNaN(stopPrice)) return;
      
      trade.stopAdjustments = trade.stopAdjustments || [];
      trade.stopAdjustments.push({ from: trade.currentStop, to: stopPrice, time: new Date().toISOString() });
      trade.currentStop = stopPrice;
      
      saveTrades();
      renderTrades();
    }
    
    // Modal helpers
    function closeModal(id, event) {
      if (event && event.target !== event.currentTarget) return;
      document.getElementById(id).classList.remove('active');
    }
    
    function openSettingsModal() {
      document.getElementById('settings-modal').classList.add('active');
    }
    
    // Export
    function exportTrades() {
      const headers = ['Date', 'Symbol', 'Pattern', 'Status', 'Outcome', 'Planned Entry', 'Actual Entry', 'Planned Stop', 'Exit Price', 'Shares', 'P&L', 'R Multiple', 'Exit Reason'];
      const rows = trades.map(t => [
        t.displayDate,
        t.symbol,
        t.patternType || '',
        t.status,
        t.outcome || '',
        t.plannedEntry?.toFixed(2) || '',
        t.actualEntry?.toFixed(2) || '',
        t.plannedStop?.toFixed(2) || '',
        t.exitPrice?.toFixed(2) || '',
        t.actualShares || t.plannedShares || '',
        t.actualPnL?.toFixed(2) || '',
        t.actualRMultiple?.toFixed(2) || '',
        t.exitReason || ''
      ]);
      
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trades_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    }
    
    // Sidebar toggle & state restore handled by app.js
    
    // ========== LIVE PRICE & P&L ==========
    
    // Fetch current prices for all open positions (stocks + options)
    async function fetchLivePrices() {
      const openTrades = trades.filter(t => t.status === 'open');
      if (openTrades.length === 0) {
        stopPriceRefresh();
        return;
      }
      
      const nonOptionTrades = openTrades.filter(t => t.instrumentType !== 'options');
      const optionTrades = openTrades.filter(t => t.instrumentType === 'options');
      
      // Fetch stock/futures prices
      if (nonOptionTrades.length > 0) {
        const symbols = [...new Set(nonOptionTrades.map(t => t.symbol))];
        try {
          const res = await fetch('/api/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols })
          });
          const data = await res.json();
          if (data.success && data.data) {
            livePrices = data.data;
            updateLivePnLCards(nonOptionTrades);
          }
        } catch (e) {
          console.error('Failed to fetch live prices:', e);
        }
      }
      
      // Fetch option premiums
      if (optionTrades.length > 0) {
        await fetchOptionPremiums(optionTrades);
      }
    }
    
    // Fetch live option premiums from the options chain
    async function fetchOptionPremiums(optionTrades) {
      // Build request: each trade needs symbol, strike, expiry, type, and id
      const requests = optionTrades
        .filter(t => t.optionStrike && t.optionExpiry) // Need strike + expiry to look up
        .map(t => ({
          symbol: t.symbol,
          strike: t.optionStrike,
          expiry: t.optionExpiry,
          type: t.optionType || 'call',
          id: String(t.id)
        }));
      
      if (requests.length === 0) return;
      
      try {
        const res = await fetch('/api/quotes/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ options: requests })
        });
        const data = await res.json();
        
        if (data.success && data.data) {
          let anyUpdated = false;
          console.log('[Options Quote] Raw response:', data.data);
          
          for (const t of optionTrades) {
            const quote = data.data[String(t.id)];
            if (!quote || quote.error) {
              console.warn(`Option quote for ${t.symbol} (id ${t.id}):`, quote?.error || 'no data');
              continue;
            }
            
            console.log(`[Options Quote] ${t.symbol}: premium=${quote.premium}, vol=${quote.volume}, OI=${quote.openInterest}, iv=${quote.iv}, delta=${quote.delta}, theta=${quote.theta}`);
            
            t._optionBid = quote.bid;
            t._optionAsk = quote.ask;
            t._optionIV = quote.iv;
            t._optionDelta = quote.delta;
            t._optionTheta = quote.theta;
            t._underlyingPrice = quote.underlyingPrice;
            t._optionVolume = quote.volume;
            t._optionOI = quote.openInterest;
            anyUpdated = true;

            // Keep broker-mirrored option premiums aligned with the broker feed.
            // External option positions already arrive with a broker mark; replacing
            // that with a third-party chain quote can create book vs execution drift.
            const preserveBrokerPremium = Boolean(
              t._externalBrokerPosition
              && t.instrumentType === 'options'
              && _safeNumber(t.optionCurrentPremium, 0) > 0
            );

            // Update premium if available
            const newPremium = quote.premium || quote.mark || quote.lastPrice;
            if (!preserveBrokerPremium && newPremium && newPremium > 0) {
              t.optionCurrentPremium = newPremium;
              // Save the updated premium
              saveOneTrade(t);
            }
          }
          
          // Re-render cards if any premiums were updated
          if (anyUpdated) {
            renderTrades();
            // Re-apply live prices to non-option cards (renderTrades resets their P&L elements)
            const nonOptOpen = trades.filter(t => t.status === 'open' && t.instrumentType !== 'options');
            if (nonOptOpen.length > 0 && Object.keys(livePrices).length > 0) {
              updateLivePnLCards(nonOptOpen);
            }
          }
        }
      } catch (e) {
        console.error('Failed to fetch option premiums:', e);
      }
    }
    
    // Update the live P&L display on each open trade card
    function updateLivePnLCards(openTrades) {
      for (const t of openTrades) {
        const el = document.getElementById(`live-pnl-${t.id}`);
        if (!el) continue;
        
        const quote = livePrices[t.symbol];
        if (!quote || quote.error || !quote.price) {
          el.innerHTML = `<span style="color:var(--color-text-subtle);font-size:var(--text-caption);">Price unavailable</span>`;
          continue;
        }
        
        const currentPrice = quote.price;
        const isOptions = t.instrumentType === 'options';
        
        let unrealizedPnL;
        if (isOptions && t.optionCurrentPremium) {
          // Options: use premium-based P&L
          const mult = t.contractMultiplier || 100;
          const units = t.actualShares || t.plannedShares || 1;
          const entryPremium = t.optionPrice || 0;
          // For options, "currentPrice" from the underlying isn't the premium
          // Use stored current premium if available, otherwise compute intrinsic
          const intrinsic = t.optionType === 'put'
            ? Math.max(0, t.optionStrike - currentPrice)
            : Math.max(0, currentPrice - t.optionStrike);
          unrealizedPnL = (intrinsic - entryPremium) * mult * units;
        } else {
          unrealizedPnL = computeTradePnL(t, currentPrice);
        }
        
        if (unrealizedPnL === null) {
          el.innerHTML = `<span style="color:var(--color-text-subtle);font-size:var(--text-caption);">Cannot calculate</span>`;
          continue;
        }
        
        const pnlColor = unrealizedPnL >= 0 ? '#4a8a60' : '#9a5050';
        const sign = unrealizedPnL >= 0 ? '+' : '';
        const changeColor = quote.changePct >= 0 ? '#4a8a60' : '#9a5050';
        const changeStr = quote.changePct !== undefined
          ? `<span style="font-size:var(--text-caption);color:${changeColor};">(${quote.changePct >= 0 ? '+' : ''}${quote.changePct}%)</span>`
          : '';
        
        el.innerHTML = `
          <div style="font-size:2rem;font-weight:700;font-family:var(--font-mono);color:${pnlColor};line-height:1;">${sign}$${fmtUSD(unrealizedPnL)}</div>
          <div style="font-size:var(--text-caption);color:var(--color-text-muted);margin-top:var(--space-4);">@ $${fmtUSD(currentPrice)} ${changeStr}</div>
        `;

        // --- Update execution rules bar ---
        updateExecBar(t, currentPrice);
      }
    }

    /** Update the execution ladder for a single trade on price tick */
    function updateExecBar(t, currentPrice) {
      ensureInitialStop(t);
      const currentR = calcTradeR(t, currentPrice);
      if (currentR === null) return;

      // Track peak R (persist to trade object for save)
      if (!t._peakR || currentR > t._peakR) {
        t._peakR = currentR;
        t.peak_R = currentR; // persisted field
      }
      t.current_R = currentR; // persisted field

      const execBarEl = document.getElementById(`exec-bar-${t.id}`);
      if (execBarEl) {
        execBarEl.innerHTML = renderExecutionBar(t, currentR, t._peakR);
      }
    }
    
    // Start periodic price refresh (every 30 seconds)
    function startPriceRefresh() {
      // Fetch immediately
      fetchLivePrices();
      // Then every 30 seconds
      if (priceRefreshInterval) clearInterval(priceRefreshInterval);
      priceRefreshInterval = setInterval(fetchLivePrices, 30000);
    }
    
    function stopPriceRefresh() {
      if (priceRefreshInterval) {
        clearInterval(priceRefreshInterval);
        priceRefreshInterval = null;
      }
    }
