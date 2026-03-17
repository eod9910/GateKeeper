(function () {
  var STORAGE_KEY = 'scannerTradingDeskHandoffV1';
  var MAX_AGE_MS = 15 * 60 * 1000;

  function asFiniteNumber(value) {
    var num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function firstFiniteNumber() {
    for (var i = 0; i < arguments.length; i += 1) {
      var num = asFiniteNumber(arguments[i]);
      if (num !== null) return num;
    }
    return null;
  }

  function normalizeInterval(value) {
    var raw = String(value || '').trim();
    if (!raw) return '1wk';

    var upper = raw.toUpperCase();
    if (upper === 'W' || upper === '1W' || upper === '1WK') return '1wk';
    if (upper === 'D' || upper === '1D') return '1d';
    if (upper === 'M' || upper === '1M' || upper === '1MO') return '1mo';
    if (upper === '4H') return '4h';
    if (upper === '1H' || upper === 'H') return '1h';
    if (upper === '15M' || upper === '15MIN') return '15m';
    if (upper === '5M' || upper === '5MIN') return '5m';
    if (upper === '1MIN') return '1m';
    return raw;
  }

  function normalizeRuleChecklist(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).map(function (rule) {
      return {
        rule_name: rule && rule.rule_name ? String(rule.rule_name) : null,
        passed: !!(rule && rule.passed),
        value: rule && Object.prototype.hasOwnProperty.call(rule, 'value') ? rule.value : null,
        threshold: rule && Object.prototype.hasOwnProperty.call(rule, 'threshold') ? rule.threshold : null,
      };
    });
  }

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.slice(0, 12).map(function (tag) {
      if (tag && typeof tag === 'object') {
        return {
          label: tag.label ? String(tag.label) : null,
          tone: tag.tone ? String(tag.tone) : null,
        };
      }
      return { label: String(tag || ''), tone: null };
    }).filter(function (tag) { return tag.label; });
  }

  function buildDetectorContext(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;

    var anchors = candidate.anchors && typeof candidate.anchors === 'object' ? candidate.anchors : {};
    var base = candidate.base && typeof candidate.base === 'object' ? candidate.base : {};

    return {
      patternType: candidate.pattern_type || null,
      candidateRole: candidate.candidate_role || null,
      candidateActionability: candidate.candidate_actionability || null,
      semanticSummary: candidate.candidate_semantic_summary || null,
      activeBaseState: anchors.base_state || null,
      activeBaseTop: firstFiniteNumber(anchors.base_top, base.high),
      activeBaseBottom: firstFiniteNumber(anchors.base_bottom, base.low),
      activeBaseAtr: asFiniteNumber(anchors.active_base_atr),
      activeBaseExtensionAtr: asFiniteNumber(anchors.active_base_extension_atr),
      activeBaseDownsideAtr: asFiniteNumber(anchors.active_base_downside_atr),
      activeBaseBreakoutAgeBars: asFiniteNumber(anchors.active_base_breakout_age_bars),
      baseStartDate: base.start_date || null,
      baseEndDate: base.end_date || null,
      baseDurationBars: asFiniteNumber(base.duration),
      peakPrice: asFiniteNumber(anchors.peak_price),
      retracementPct: candidate.retracement_pct ?? null,
      rankScore: firstFiniteNumber(anchors.rank_score, candidate.score),
      structuralScore: asFiniteNumber(anchors.structural_score),
      scale: anchors.scale || null,
      recovered: typeof anchors.recovered === 'boolean' ? anchors.recovered : null,
    };
  }

  function buildFundamentalsContext(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    return {
      companyName: snapshot.companyName || null,
      sector: snapshot.sector || null,
      industry: snapshot.industry || null,
      marketCap: snapshot.marketCap ?? null,
      earningsDate: snapshot.earningsDate || null,
      daysUntilEarnings: snapshot.daysUntilEarnings ?? null,
      lastEarningsDate: snapshot.lastEarningsDate || null,
      shortFloatPct: snapshot.shortFloatPct ?? null,
      shortRatio: snapshot.shortRatio ?? null,
      relativeVolume: snapshot.relativeVolume ?? null,
      revenueGrowthPct: snapshot.revenueGrowthPct ?? null,
      earningsGrowthPct: snapshot.earningsGrowthPct ?? null,
      grossMarginPct: snapshot.grossMarginPct ?? null,
      profitMarginPct: snapshot.profitMarginPct ?? null,
      debtToEquity: snapshot.debtToEquity ?? null,
      currentRatio: snapshot.currentRatio ?? null,
      operatingCashFlowTTM: snapshot.operatingCashFlowTTM ?? null,
      freeCashFlowTTM: snapshot.freeCashFlowTTM ?? null,
      quarterlyCashBurn: snapshot.quarterlyCashBurn ?? null,
      cashRunwayQuarters: snapshot.cashRunwayQuarters ?? null,
      cashPctMarketCap: snapshot.cashPctMarketCap ?? null,
      revenueYoYGrowthPct: snapshot.revenueYoYGrowthPct ?? null,
      revenueQoQGrowthPct: snapshot.revenueQoQGrowthPct ?? null,
      revenueTrendFlag: snapshot.revenueTrendFlag || null,
      epsYoYGrowthPct: snapshot.epsYoYGrowthPct ?? null,
      epsQoQGrowthPct: snapshot.epsQoQGrowthPct ?? null,
      epsSurprisePct: snapshot.epsSurprisePct ?? null,
      salesSurprisePct: snapshot.salesSurprisePct ?? null,
      sharesOutstandingYoYChangePct: snapshot.sharesOutstandingYoYChangePct ?? null,
      dilutionFlag: snapshot.dilutionFlag ?? null,
      recentFinancingFlag: snapshot.recentFinancingFlag ?? null,
      catalystFlag: snapshot.catalystFlag || null,
      squeezePressureScore: snapshot.squeezePressureScore ?? null,
      squeezePressureLabel: snapshot.squeezePressureLabel || null,
      enterpriseValue: snapshot.enterpriseValue ?? null,
      enterpriseToSales: snapshot.enterpriseToSales ?? null,
      netCash: snapshot.netCash ?? null,
      lowEnterpriseValueFlag: snapshot.lowEnterpriseValueFlag ?? null,
      quality: snapshot.quality || null,
      holdContext: snapshot.holdContext || null,
      tacticalGrade: snapshot.tacticalGrade || null,
      tacticalScore: snapshot.tacticalScore ?? null,
      riskNote: snapshot.riskNote || null,
      tags: normalizeTags(snapshot.tags),
    };
  }

  function buildScannerAIAnalysisContext(aiAnalysis) {
    if (!aiAnalysis || typeof aiAnalysis !== 'object') return null;
    return {
      isValidPattern: !!aiAnalysis.isValidPattern,
      confidence: asFiniteNumber(aiAnalysis.confidence),
      explanation: aiAnalysis.explanation || null,
      timestamp: aiAnalysis.timestamp || null,
      levels: aiAnalysis.levels && typeof aiAnalysis.levels === 'object' ? {
        suggestedEntry: asFiniteNumber(aiAnalysis.levels.suggestedEntry),
        suggestedStop: asFiniteNumber(aiAnalysis.levels.suggestedStop),
        suggestedTarget: asFiniteNumber(aiAnalysis.levels.suggestedTarget),
        baseHigh: asFiniteNumber(aiAnalysis.levels.baseHigh),
        baseLow: asFiniteNumber(aiAnalysis.levels.baseLow),
        baseTop: asFiniteNumber(aiAnalysis.levels.baseTop),
        baseBottom: asFiniteNumber(aiAnalysis.levels.baseBottom),
      } : null,
      review: aiAnalysis.review && typeof aiAnalysis.review === 'object' ? {
        primaryPattern: aiAnalysis.review.primaryPattern || null,
        alternativePattern: aiAnalysis.review.alternativePattern || null,
        detectorVerdict: aiAnalysis.review.detectorVerdict || null,
        detectorAgreement: aiAnalysis.review.detectorAgreement || null,
        stateAssessment: aiAnalysis.review.stateAssessment || null,
        timingAssessment: aiAnalysis.review.timingAssessment || null,
        isTooLate: !!aiAnalysis.review.isTooLate,
        topReasons: Array.isArray(aiAnalysis.review.topReasons) ? aiAnalysis.review.topReasons.slice(0, 5) : [],
        topRisks: Array.isArray(aiAnalysis.review.topRisks) ? aiAnalysis.review.topRisks.slice(0, 5) : [],
      } : null,
    };
  }

  function buildCandidateContext(candidate, interval) {
    if (!candidate || typeof candidate !== 'object') return null;
    return {
      id: candidate.id || candidate.candidate_id || null,
      symbol: candidate.symbol ? String(candidate.symbol).trim().toUpperCase() : null,
      timeframe: candidate.timeframe || null,
      interval: normalizeInterval(interval || candidate.interval || candidate.timeframe || null),
      pattern_type: candidate.pattern_type || null,
      strategy_version_id: candidate.strategy_version_id || null,
      score: asFiniteNumber(candidate.score),
      retracement_pct: asFiniteNumber(candidate.retracement_pct),
      entry_ready: typeof candidate.entry_ready === 'boolean' ? candidate.entry_ready : null,
      candidate_role: candidate.candidate_role || null,
      candidate_role_label: candidate.candidate_role_label || null,
      candidate_actionability: candidate.candidate_actionability || null,
      candidate_actionability_label: candidate.candidate_actionability_label || null,
      candidate_semantic_summary: candidate.candidate_semantic_summary || null,
      candidate_origin_role: candidate.candidate_origin_role || null,
      candidate_entry_type: candidate.candidate_entry_type || null,
      rule_checklist: normalizeRuleChecklist(candidate.rule_checklist),
      detector: buildDetectorContext(candidate),
    };
  }

  function generatePacketId() {
    return 'scanner-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function buildPacket(options) {
    var input = options && typeof options === 'object' ? options : {};
    var candidate = buildCandidateContext(input.candidate, input.interval || input.timeframe);
    var interval = normalizeInterval(input.interval || candidate && candidate.interval || input.timeframe || candidate && candidate.timeframe || '1wk');
    return {
      id: input.id || generatePacketId(),
      version: 1,
      source: 'scanner',
      createdAt: input.createdAt || new Date().toISOString(),
      symbol: input.symbol || candidate && candidate.symbol || null,
      interval: interval,
      timeframe: input.timeframe || candidate && candidate.timeframe || null,
      candidate: candidate,
      fundamentals: buildFundamentalsContext(input.fundamentals),
      scannerAIAnalysis: buildScannerAIAnalysisContext(input.aiAnalysis),
    };
  }

  function readPacket() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var activePlan = window.TradePlanStore?.getActivePlan ? window.TradePlanStore.getActivePlan() : null;
        return activePlan?.scannerHandoff || null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      var createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : NaN;
      if (Number.isFinite(createdAt) && (Date.now() - createdAt) > MAX_AGE_MS) {
        localStorage.removeItem(STORAGE_KEY);
        var fallbackPlan = window.TradePlanStore?.getActivePlan ? window.TradePlanStore.getActivePlan() : null;
        return fallbackPlan?.scannerHandoff || null;
      }
      return parsed;
    } catch (error) {
      console.warn('Failed to read scanner Trading Desk handoff:', error);
      return null;
    }
  }

  function writePacket(packet) {
    if (!packet || typeof packet !== 'object') return null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packet));
    if (window.TradePlanStore?.fromScannerPacket && window.TradePlanStore?.upsertActivePlan) {
      var plan = window.TradePlanStore.fromScannerPacket(packet);
      if (plan) {
        window.TradePlanStore.upsertActivePlan(plan, { reason: 'scanner-handoff-write' });
      }
    }
    return packet;
  }

  function consumePacket(packetId) {
    var packet = readPacket();
    if (!packet) return null;
    if (packetId && packet.id !== packetId) return null;
    localStorage.removeItem(STORAGE_KEY);
    return packet;
  }

  function clearPacket() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function describePacket(packet) {
    if (!packet || !packet.candidate) return 'Scanner handoff unavailable.';
    var parts = ['Loaded scanner setup for ' + (packet.symbol || packet.candidate.symbol || 'unknown symbol')];
    var scannerPattern = packet.scannerAIAnalysis && packet.scannerAIAnalysis.review && packet.scannerAIAnalysis.review.primaryPattern
      ? packet.scannerAIAnalysis.review.primaryPattern
      : null;
    if (scannerPattern) parts.push(scannerPattern);
    else if (packet.candidate.pattern_type) parts.push(packet.candidate.pattern_type);
    if (packet.candidate.candidate_actionability_label) parts.push(packet.candidate.candidate_actionability_label);
    if (packet.fundamentals && packet.fundamentals.quality) parts.push('Quality: ' + packet.fundamentals.quality);
    if (packet.fundamentals && packet.fundamentals.tacticalGrade) parts.push('Tactical: ' + packet.fundamentals.tacticalGrade);
    return parts.join(' · ');
  }

  window.ScannerTradingDeskHandoff = {
    STORAGE_KEY: STORAGE_KEY,
    normalizeInterval: normalizeInterval,
    buildDetectorContext: buildDetectorContext,
    buildFundamentalsContext: buildFundamentalsContext,
    buildScannerAIAnalysisContext: buildScannerAIAnalysisContext,
    buildCandidateContext: buildCandidateContext,
    buildPacket: buildPacket,
    read: readPacket,
    write: writePacket,
    consume: consumePacket,
    clear: clearPacket,
    describe: describePacket,
  };
})();
