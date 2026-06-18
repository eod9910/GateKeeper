(function () {
  var summaryState = null;
  var monitorState = null;
  var CATEGORY_GROUPS = {
    highly_cyclical: [
      'motor_vehicles_parts',
      'furnishings_household_equipment',
      'recreational_goods_vehicles',
      'transportation_services',
      'other_durable_goods',
      'residential_investment',
      'business_equipment_investment'
    ],
    mildly_cyclical: [
      'clothing_footwear',
      'other_nondurable_goods',
      'food_service_accommodations',
      'other_services',
      'gas_energy_goods'
    ],
    stable: [
      'recreation_services',
      'food_beverages_home',
      'housing_utilities',
      'healthcare',
      'financial_services_insurance'
    ]
  };

  var CATEGORY_LABELS = {
    motor_vehicles_parts: 'Motor Vehicles & Parts',
    furnishings_household_equipment: 'Furnishings & Household Equipment',
    recreational_goods_vehicles: 'Recreational Goods & Vehicles',
    transportation_services: 'Transportation Services',
    other_durable_goods: 'Other Durable Goods',
    residential_investment: 'Residential Investment',
    business_equipment_investment: 'Business Equipment Investment',
    clothing_footwear: 'Clothing & Footwear',
    other_nondurable_goods: 'Other Nondurable Goods',
    food_service_accommodations: 'Food Service & Accommodations',
    other_services: 'Other Services',
    gas_energy_goods: 'Gasoline & Energy Goods',
    recreation_services: 'Recreation Services',
    food_beverages_home: 'Food & Beverages (Home)',
    housing_utilities: 'Housing & Utilities',
    healthcare: 'Health Care',
    financial_services_insurance: 'Financial Services & Insurance'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function titleCase(value) {
    return String(value || '')
      .split('_')
      .filter(Boolean)
      .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
      .join(' ');
  }

  function fmtPct(value) {
    if (value == null || !isFinite(Number(value))) return '—';
    var num = Number(value);
    return (num >= 0 ? '+' : '') + num.toFixed(1) + '%';
  }

  function fmtNumber(value, digits) {
    if (value == null || !isFinite(Number(value))) return 'â€”';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    });
  }

  function getFilters() {
    return {
      q: $('consumer-search').value.trim(),
      cycleBucket: $('consumer-sensitivity').value,
      spendClass: $('consumer-spend-class').value,
      category: $('consumer-bucket').value,
      profile: $('consumer-profile').value,
      preference: $('consumer-preference').value,
      optionableOnly: $('consumer-optionable').checked ? 'true' : '',
      limit: $('consumer-limit').value || '250'
    };
  }

  function toQuery(params) {
    var query = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      if (params[key]) query.set(key, params[key]);
    });
    return query.toString();
  }

  function renderKpis(data) {
    var el = $('consumer-kpis');
    el.innerHTML = [
      { label: 'Tradable Stocks', value: data.filteredCount, hint: 'Filtered rows from the tradable-stock default universe.', filter: '' },
      { label: 'Slowdown Longs', value: data.preferInSlowdownCount, hint: 'Resilient names that are usually safer when the cycle cools.' },
      { label: 'Slowdown Avoids', value: data.avoidInSlowdownCount, hint: 'Cyclical pockets likely to weaken first as demand rolls over.' },
      { label: 'Highly Cyclical', value: data.highlyCyclicalCount, hint: 'The swingiest part of consumer demand, usually big-ticket and finance-sensitive.', filter: 'highly_cyclical' },
      { label: 'Defensive', value: data.defensiveCount, hint: 'Healthcare, staples, and housing-utility style exposures.', filter: 'stable' },
      { label: 'Optionable', value: data.optionableCount, hint: 'Subset currently optionable inside the filtered universe.' }
    ].map(function (item) {
      var attrs = item.filter != null
        ? ' role="button" tabindex="0" class="consumer-kpi consumer-kpi--filter" data-cycle-filter="' + item.filter + '"'
        : ' class="consumer-kpi"';
      return (
        '<div' + attrs + '>' +
          '<div class="consumer-kpi-label">' + item.label + '</div>' +
          '<div class="consumer-kpi-value">' + Number(item.value || 0).toLocaleString() + '</div>' +
          '<div class="consumer-kpi-hint">' + item.hint + '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderBucketChips(data) {
    var rows = data.byCategory || [];
    var counts = {};
    rows.forEach(function (row) {
      counts[row.key] = Number(row.count || 0);
    });

    [
      { id: 'consumer-group-highly', key: 'highly_cyclical', empty: 'No highly cyclical categories matched this filter set.' },
      { id: 'consumer-group-mildly', key: 'mildly_cyclical', empty: 'No mildly cyclical categories matched this filter set.' },
      { id: 'consumer-group-stable', key: 'stable', empty: 'No stable categories matched this filter set.' }
    ].forEach(function (group) {
      var el = $(group.id);
      if (!el) return;
      var keys = CATEGORY_GROUPS[group.key] || [];
      var chips = keys.map(function (key) {
          return (
            '<button type="button" class="consumer-chip consumer-chip--filter" data-category-filter="' + escapeHtml(key) + '">' +
              '<strong>' + (CATEGORY_LABELS[key] || titleCase(key)) + '</strong>' +
              '<span>' + Number(counts[key] || 0).toLocaleString() + ' symbols</span>' +
            '</button>'
          );
        });
      el.innerHTML = chips.length
        ? chips.join('')
        : '<div class="consumer-empty">' + group.empty + '</div>';
    });
  }

  function renderSpendClassChips(data) {
    var el = $('consumer-spend-classes');
    if (!el) return;
    var rows = data.bySpendClass || [];
    if (!rows.length) {
      el.innerHTML = '<div class="consumer-empty">No spend-class classifications matched this filter set yet.</div>';
      return;
    }
    el.innerHTML = rows.map(function (row) {
      return (
        '<button type="button" class="consumer-chip consumer-chip--filter" data-spend-class-filter="' + escapeHtml(row.key) + '">' +
          '<strong>' + titleCase(row.key) + '</strong>' +
          '<span>' + Number(row.count || 0).toLocaleString() + ' symbols</span>' +
        '</button>'
      );
    }).join('');
  }

  function monitorStatusLabel(value) {
    return titleCase(value || 'unknown');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function seriesCard(row) {
    return (
      '<div class="monitor-card">' +
        '<div class="monitor-card-title">' +
          '<span>' + escapeHtml(row.label) + '</span>' +
          '<span class="monitor-status ' + row.status + '">' + monitorStatusLabel(row.status) + '</span>' +
        '</div>' +
        '<div class="monitor-card-copy">' + escapeHtml(row.description || '') + '</div>' +
        '<div class="monitor-metrics">' +
          '<div class="monitor-metric">' +
            '<span class="monitor-metric-label">YoY</span>' +
            '<span class="monitor-metric-value">' + fmtPct(row.yoyPct) + '</span>' +
          '</div>' +
          '<div class="monitor-metric">' +
            '<span class="monitor-metric-label">QoQ Ann.</span>' +
            '<span class="monitor-metric-value">' + fmtPct(row.qoqAnnualizedPct) + '</span>' +
          '</div>' +
          '<div class="monitor-metric">' +
            '<span class="monitor-metric-label">2Q Trend</span>' +
            '<span class="monitor-metric-value">' + fmtPct(row.twoQuarterPct) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function deviationMetric(label, value, hint, detail, status) {
    return (
      '<div class="deviation-metric deviation-metric--' + escapeHtml(status || 'neutral') + '" tabindex="0">' +
        '<span class="deviation-metric-head">' +
          '<span class="monitor-metric-label">' + escapeHtml(label) + '</span>' +
          '<span class="deviation-metric-tools">' +
            (status ? '<span class="monitor-status ' + escapeHtml(status) + '">' + monitorStatusLabel(status) + '</span>' : '') +
            '<span class="deviation-info" aria-label="' + escapeHtml(label) + ' explanation">i</span>' +
          '</span>' +
        '</span>' +
        '<span class="deviation-metric-value">' + escapeHtml(value) + '</span>' +
        (hint ? '<span class="consumer-kpi-hint">' + escapeHtml(hint) + '</span>' : '') +
        (detail ? '<span class="deviation-popout">' + escapeHtml(detail) + '</span>' : '') +
      '</div>'
    );
  }

  function zStatus(value, thresholds) {
    if (value == null || !isFinite(Number(value))) return 'neutral';
    var z = Number(value);
    if (z >= thresholds.red) return 'red';
    if (z >= thresholds.orange) return 'orange';
    if (z >= thresholds.yellow) return 'yellow';
    return 'green';
  }

  function logZStatus(value) {
    return zStatus(value, { yellow: 1, orange: 1.5, red: 2.25 });
  }

  function linearZStatus(value) {
    return zStatus(value, { yellow: 2, orange: 3, red: 4 });
  }

  function sectorPercentileStatus(value, highIsStress) {
    if (value == null || !isFinite(Number(value))) return 'neutral';
    var pct = Number(value);
    if (highIsStress) {
      if (pct >= 90) return 'red';
      if (pct >= 75) return 'orange';
      if (pct >= 60) return 'yellow';
      return 'green';
    }
    if (pct <= 10) return 'red';
    if (pct <= 25) return 'orange';
    if (pct <= 40) return 'yellow';
    return 'green';
  }

  function statusRank(status) {
    return { neutral: 0, green: 1, yellow: 2, orange: 3, red: 4 }[status || 'neutral'] || 0;
  }

  function worstStatus(statuses) {
    return statuses.reduce(function (worst, status) {
      return statusRank(status) > statusRank(worst) ? status : worst;
    }, 'neutral');
  }

  function linearCrashEventText(linear) {
    var events = linear && linear.crashEvents ? linear.crashEvents : [];
    if (!events.length) return '';
    return events.map(function (event) {
      var z = event.zScore == null ? 'n/a' : ((Number(event.zScore) >= 0 ? '+' : '') + Number(event.zScore).toFixed(2));
      return event.date + ' ' + event.name + ': ' + z;
    }).join('; ');
  }

  function signedSigma(value) {
    if (value == null || !isFinite(Number(value))) return 'n/a';
    return (Number(value) >= 0 ? '+' : '') + Number(value).toFixed(2);
  }

  function crashSummaryTable(model, statusFn) {
    var rows = [
      ['All crash events after 1987', model.averageCrashZ],
      ['Median crash event', model.medianCrashZ],
      ['Positive-stretch crashes only', model.positiveCrashAverageZ],
      ['Stretched crashes only, Z >= 1', model.stretchedCrashAverageZ]
    ];
    return (
      '<table class="deviation-table">' +
        '<thead><tr><th>Group</th><th>Average Z</th></tr></thead>' +
        '<tbody>' + rows.map(function (row) {
          var status = statusFn(row[1]);
          return '<tr class="deviation-row deviation-row--' + escapeHtml(status) + '"><td>' + escapeHtml(row[0]) + '</td><td><span class="monitor-status ' + escapeHtml(status) + '">' + signedSigma(row[1]) + '</span></td></tr>';
        }).join('') + '</tbody>' +
      '</table>'
    );
  }

  function currentReadingTable(model, trendLabel, includeResidual, statusFn) {
    var residual = model.latestClose != null && model.trendPrice != null
      ? Number(model.latestClose) - Number(model.trendPrice)
      : null;
    var status = statusFn(model.zScore);
    return (
      '<table class="deviation-table">' +
        '<thead><tr><th>Current SPX</th><th>' + escapeHtml(trendLabel) + '</th>' + (includeResidual ? '<th>Residual</th>' : '') + '<th>Sigma</th><th>Z</th></tr></thead>' +
        '<tbody><tr class="deviation-row deviation-row--' + escapeHtml(status) + '">' +
          '<td>' + fmtNumber(model.latestClose, 2) + '</td>' +
          '<td>' + fmtNumber(model.trendPrice, 2) + '</td>' +
          (includeResidual ? '<td>' + fmtNumber(residual, 2) + '</td>' : '') +
          '<td>' + fmtNumber(model.residualSigma, 2) + '</td>' +
          '<td><span class="monitor-status ' + escapeHtml(status) + '">' + signedSigma(model.zScore) + '</span></td>' +
        '</tr></tbody>' +
      '</table>'
    );
  }

  function marketStretchTable(model) {
    var rows = model && Array.isArray(model.rows) ? model.rows : [];
    if (!rows.length) return '<div class="consumer-empty">Cross-market stretch data is unavailable.</div>';
    return (
      '<table class="deviation-table">' +
        '<thead><tr><th>Market</th><th>Raw Z</th><th>Log Z</th><th>21D</th><th>63D</th></tr></thead>' +
        '<tbody>' + rows.map(function (row) {
          var status = linearZStatus(row.linearZ);
          var symbol = String(row.symbol || '').trim().toUpperCase();
          return (
            '<tr class="deviation-row deviation-row--' + escapeHtml(status) + ' deviation-row--clickable" data-chart-symbol="' + escapeHtml(symbol) + '" tabindex="0" title="Open ' + escapeHtml(symbol) + ' in Trading Desk">' +
              '<td><span class="deviation-symbol-link">' + escapeHtml(row.label || row.symbol || '') + '</span></td>' +
              '<td><span class="monitor-status ' + escapeHtml(status) + '">' + signedSigma(row.linearZ) + '</span></td>' +
              '<td>' + signedSigma(row.logZ) + '</td>' +
              '<td>' + fmtPct(row.return21dPct) + '</td>' +
              '<td>' + fmtPct(row.return63dPct) + '</td>' +
            '</tr>'
          );
        }).join('') + '</tbody>' +
      '</table>'
    );
  }

  function openTradingDeskSymbol(symbol, interval) {
    var normalized = String(symbol || '').trim().toUpperCase();
    if (!normalized) return;
    var params = new URLSearchParams({
      symbol: normalized,
      interval: interval || '1d'
    });
    window.open('/trading-desk?' + params.toString(), '_blank');
  }

  function leadershipStretchTable(model) {
    var rows = model && Array.isArray(model.topRows) ? model.topRows : [];
    if (!rows.length) return '<div class="consumer-empty">Extreme stock-basket scan is unavailable.</div>';
    return (
      '<table class="deviation-table">' +
        '<thead><tr><th>Symbol</th><th>Raw Z</th><th>Log Z</th><th>21D</th><th>63D</th><th>Valuation</th></tr></thead>' +
        '<tbody>' + rows.slice(0, 12).map(function (row) {
          var z = Math.max(Number(row.rawZ) || -Infinity, Number(row.logZ) || -Infinity);
          var status = linearZStatus(z);
          var valuation = row.valuationGapPct == null ? 'n/a' : fmtPct(row.valuationGapPct);
          return (
            '<tr class="deviation-row deviation-row--' + escapeHtml(status) + '">' +
              '<td>' + escapeHtml(row.symbol || '') + '</td>' +
              '<td><span class="monitor-status ' + escapeHtml(linearZStatus(row.rawZ)) + '">' + signedSigma(row.rawZ) + '</span></td>' +
              '<td>' + signedSigma(row.logZ) + '</td>' +
              '<td>' + fmtPct(row.return21dPct) + '</td>' +
              '<td>' + fmtPct(row.return63dPct) + '</td>' +
              '<td>' + escapeHtml(valuation) + '</td>' +
            '</tr>'
          );
        }).join('') + '</tbody>' +
      '</table>'
    );
  }

  function deviationSection(title, subtitle, status, body) {
    return (
      '<details class="deviation-section deviation-section--' + escapeHtml(status || 'neutral') + '">' +
        '<summary class="deviation-section-title"><span>' + escapeHtml(title) + '</span><span class="deviation-section-meta"><span class="consumer-status">' + escapeHtml(subtitle || '') + '</span><span class="monitor-status ' + escapeHtml(status || 'neutral') + '">' + monitorStatusLabel(status || 'neutral') + '</span></span></summary>' +
        '<div class="deviation-section-body">' + body + '</div>' +
      '</details>'
    );
  }

  function renderStatisticalDeviation(data) {
    var container = $('consumer-statistical-deviation');
    if (!container) return;
    if (!data) {
      container.innerHTML = '<div class="consumer-empty">Statistical deviation model is unavailable right now.</div>';
      return;
    }
    var regression = data.regression || {};
    var linear = data.linearCrashStretch || {};
    var geometry = data.sectorGeometry || {};
    var marketStretch = data.marketStretch || {};
    var leadershipStretch = data.leadershipStretch || {};
    var status = data.status || 'yellow';
    var logStatus = logZStatus(regression.zScore);
    var linearStatus = linearZStatus(linear.zScore);
    var marketStatus = marketStretch.status || linearZStatus(marketStretch.maxLinearZ);
    var leadershipStatus = leadershipStretch.status || 'neutral';
    var corrStatus = sectorPercentileStatus(geometry.averageCorrelationPercentile, true);
    var wedgeStatus = sectorPercentileStatus(geometry.wedgeVolumePercentile, false);
    var sectorStatus = worstStatus([corrStatus, wedgeStatus]);
    container.innerHTML =
      '<div class="monitor-banner deviation-banner">' +
        '<div class="monitor-banner-text">' +
          '<div class="monitor-banner-title">' +
            '<span class="monitor-status ' + status + '">' + monitorStatusLabel(status) + '</span>' +
            '<span>' + escapeHtml(titleCase(data.regime || 'unknown')) + '</span>' +
          '</div>' +
          '<div class="monitor-banner-copy">' + escapeHtml(data.summary || '') + '</div>' +
        '</div>' +
        '<div class="consumer-status">As of ' + escapeHtml(data.asOf || 'n/a') + '</div>' +
      '</div>' +
      '<div class="deviation-brief-grid">' +
        deviationMetric(
          'SPX Linear Stretch',
          linear.zScore == null ? 'n/a' : (signedSigma(linear.zScore) + ' sigma'),
          '1987 raw-price channel',
          '',
          linearStatus
        ) +
        deviationMetric(
          'SPX Log Stretch',
          regression.zScore == null ? 'n/a' : (signedSigma(regression.zScore) + ' sigma'),
          '1987 compound-growth channel',
          '',
          logStatus
        ) +
        deviationMetric(
          'Extreme Markets',
          marketStretch.extremeCount == null ? 'n/a' : String(marketStretch.extremeCount),
          'Cross-market confirmation',
          '',
          marketStatus
        ) +
        deviationMetric(
          'Extreme Stocks Rolling Over',
          leadershipStretch.rollingOverCount == null ? 'n/a' : String(leadershipStretch.rollingOverCount),
          'Leadership basket warning count',
          '',
          leadershipStretch.rollingOverCount >= 4 ? 'orange' : 'green'
        ) +
      '</div>' +
      deviationSection(
        'Logarithmic Regression',
        'compound-growth fair-value channel',
        logStatus,
        '<div class="deviation-grid">' +
          deviationMetric(
            'Log Regression Z',
            regression.zScore == null ? 'n/a' : (signedSigma(regression.zScore) + ' sigma'),
            '1987-anchored S&P log channel',
            'How far the S&P 500 is above or below its fixed 1987-anchored log regression trend, measured in residual standard deviations. Above +1.5 is stretched; above +2 is historically hot. Events: ' + linearCrashEventText(regression),
            logStatus
          ) +
          deviationMetric(
            'Above Trend',
            fmtPct(regression.percentAboveTrend),
            'Current index vs fixed log trend',
            'The same log-regression channel in plain percent terms: current S&P price divided by the long-run compound-growth trend price.',
            logStatus
          ) +
        '</div>' +
        crashSummaryTable(regression, logZStatus) +
        currentReadingTable(regression, 'Log trend', false, logZStatus)
      ) +
      deviationSection(
        'Linear Regression',
        'TradingView-style crash-stretch channel',
        linearStatus,
        '<div class="deviation-grid">' +
          deviationMetric(
            'Linear Crash Z',
            linear.zScore == null ? 'n/a' : (signedSigma(linear.zScore) + ' sigma'),
            '1987-anchored linear price channel',
            'Your TradingView-style gauge: raw SPX price distance above the fixed 1987-anchored linear regression channel. Useful for melt-up exhaustion, but not the same as log-regression fair-value stretch. Events: ' + linearCrashEventText(linear),
            linearStatus
          ) +
          deviationMetric(
            'Crash Avg Z',
            linear.stretchedCrashAverageZ == null ? 'n/a' : (signedSigma(linear.stretchedCrashAverageZ) + ' sigma'),
            linear.averageCrashZ == null ? 'All-event avg n/a' : ('All-event avg ' + signedSigma(linear.averageCrashZ)),
            'Average linear crash-stretch Z for prior stretched crashes since 1987. The all-event average includes crashes that started from normal or low stretch, such as 2007 and 2011.',
            linearZStatus(linear.stretchedCrashAverageZ)
          ) +
        '</div>' +
        crashSummaryTable(linear, linearZStatus) +
        currentReadingTable(linear, 'Linear trend', true, linearZStatus)
      ) +
      deviationSection(
        'Cross-Market Stretch',
        'index / sector confirmation',
        marketStatus,
        '<div class="deviation-grid">' +
          deviationMetric(
            'Extreme Markets',
            marketStretch.extremeCount == null ? 'n/a' : String(marketStretch.extremeCount),
            'Raw Z >= +4',
            'How many index/sector proxies are above the raw 1987-anchored +4 sigma danger threshold. This checks whether SPX stretch is isolated or confirmed by Nasdaq, tech, semis, small caps, and equal-weight.',
            marketStatus
          ) +
          deviationMetric(
            'Max Raw Z',
            marketStretch.maxLinearZ == null ? 'n/a' : (signedSigma(marketStretch.maxLinearZ) + ' sigma'),
            'Most stretched market proxy',
            'The highest raw linear channel Z score across SPX, Nasdaq, QQQ, IWM, RSP, DIA, XLK, SMH, and SOXX.',
            linearZStatus(marketStretch.maxLinearZ)
          ) +
        '</div>' +
        marketStretchTable(marketStretch)
      ) +
      deviationSection(
        'Leadership Basket',
        'extreme stocks + rollover check',
        leadershipStatus,
        '<div class="deviation-grid">' +
          deviationMetric(
            'Extreme Stocks',
            leadershipStretch.combinedExtremeCount == null ? 'n/a' : String(leadershipStretch.combinedExtremeCount),
            'Raw>=6 or log>=5 scan',
            'Count of stocks in the precomputed full-history deviation scans. This is the leadership/speculation basket: the names statistically furthest above their own channels.',
            leadershipStatus
          ) +
          deviationMetric(
            'Rolling Over',
            leadershipStretch.rollingOverCount == null ? 'n/a' : String(leadershipStretch.rollingOverCount),
            'Negative 21D among top extremes',
            'A warning count for extreme-stretch stocks whose latest 21-day return has already turned negative. This is the lead-lag confirmation layer.',
            leadershipStretch.rollingOverCount >= 4 ? 'orange' : 'green'
          ) +
          deviationMetric(
            'Overvalued Extremes',
            leadershipStretch.overvaluedExtremeCount == null ? 'n/a' : String(leadershipStretch.overvaluedExtremeCount),
            'DCF gap <= -20%',
            'How many top extreme names also have a current DCF/fair-value gap that is meaningfully negative in the precomputed scan output.',
            leadershipStretch.overvaluedExtremeCount >= 5 ? 'orange' : 'green'
          ) +
        '</div>' +
        leadershipStretchTable(leadershipStretch) +
        '<div class="consumer-status deviation-source">' + escapeHtml(leadershipStretch.source || '') + (leadershipStretch.generatedAt ? (' Generated ' + escapeHtml(leadershipStretch.generatedAt)) : '') + '</div>'
      ) +
      deviationSection(
        'Sector Geometry',
        '60-day sector ETF correlation structure',
        sectorStatus,
        '<div class="deviation-grid">' +
          deviationMetric(
            'Avg Sector Corr.',
            fmtNumber(geometry.averageCorrelation, 3),
            geometry.averageCorrelationPercentile == null ? 'Percentile n/a' : (Number(geometry.averageCorrelationPercentile).toFixed(1) + ' percentile'),
            'Average 60-day pairwise correlation across the S&P sector ETFs. High readings mean sectors are moving together and diversification is weakening. Low readings mean the market is still rotating.',
            corrStatus
          ) +
          deviationMetric(
            'Wedge Volume',
            fmtNumber(geometry.wedgeVolume, 6),
            geometry.wedgeVolumePercentile == null ? 'Percentile n/a' : (Number(geometry.wedgeVolumePercentile).toFixed(1) + ' percentile'),
            'A geometric diversification score from the sector correlation matrix. High volume means sector returns still span a broad space. Low volume means the market is collapsing into one trade.',
            wedgeStatus
          ) +
        '</div>'
      ) +
      '<div class="consumer-status deviation-source">' + escapeHtml(data.source || '') + '</div>';
  }

  function renderMonitor(data) {
    monitorState = data;
    $('consumer-monitor-status').textContent = 'Official macro input: ' + (data.source || 'FRED');
    $('consumer-monitor-status-pill').className = 'monitor-status ' + (data.overallStatus || 'yellow');
    $('consumer-monitor-status-pill').textContent = monitorStatusLabel(data.overallStatus);
    $('consumer-monitor-title').textContent = 'Overall cyclical-demand regime: ' + monitorStatusLabel(data.overallStatus);
    $('consumer-monitor-copy').textContent = data.scoreHint || 'No score narrative available yet.';
    $('consumer-monitor-meta').textContent =
      'As of ' + (data.asOf || 'n/a') +
      ' · severity ' + Number(data.averageSeverity || 0).toFixed(2) +
      ' · primary weak buckets ' + Number(data.weakeningPrimaryCount || 0) +
      ' · total weak buckets ' + Number(data.weakeningTotalCount || 0);

    var rows = []
      .concat(data.cyclicalConsumerSeries || [])
      .concat(data.companionSeries || []);
    var container = $('consumer-monitor-series');
    container.innerHTML = rows.length
      ? rows.map(seriesCard).join('')
      : '<div class="consumer-empty">No macro series were available.</div>';

    var producerRows = data.industrialProducerSeries || [];
    var producerContainer = $('consumer-monitor-producer-series');
    if (producerContainer) {
      producerContainer.innerHTML = producerRows.length
        ? producerRows.map(seriesCard).join('')
        : '<div class="consumer-empty">No producer/freight series available right now.</div>';
    }
    renderStatisticalDeviation(data.statisticalDeviation || null);
  }

  function lensCard(lens) {
    if (!lens) return '';
    var conf = String(lens.confidence || 'medium').toLowerCase();
    var evidence = (lens.key_evidence || []).map(function (item) {
      return '<li>' + escapeHtml(item) + '</li>';
    }).join('');
    return (
      '<div class="analysis-lens">' +
        '<div class="analysis-lens-q">' + escapeHtml(lens.question) + '</div>' +
        '<div class="analysis-verdict">' + escapeHtml(lens.verdict) + '</div>' +
        '<div><span class="analysis-conf ' + conf + '">' + conf + ' confidence</span></div>' +
        '<div class="analysis-rationale">' + escapeHtml(lens.rationale) + '</div>' +
        (evidence ? '<ul class="analysis-evidence">' + evidence + '</ul>' : '') +
        (lens.what_would_change_view ? '<div class="analysis-change">Flips if: ' + escapeHtml(lens.what_would_change_view) + '</div>' : '') +
      '</div>'
    );
  }

  function renderAnalysis(data) {
    var body = $('consumer-analysis-body');
    if (!body) return;
    var synth = data.regimeSynthesis || {};
    var modelLabel = data.model ? ('AI · ' + data.model) : 'Rule-based fallback (AI unavailable)';
    var generated = String(data.generatedAt || '').replace('T', ' ').slice(0, 16);
    body.innerHTML =
      '<div class="analysis-grid">' +
        lensCard(data.consumerLens) +
        lensCard(data.reindustrializationLens) +
      '</div>' +
      '<div class="analysis-synth">' +
        '<div class="consumer-kpi-label">Regime Synthesis · ' + escapeHtml(titleCase(synth.dominant_regime || 'balanced')) + '</div>' +
        '<div class="analysis-synth-headline">' + escapeHtml(synth.headline || '') + '</div>' +
        '<div class="analysis-rationale">' + escapeHtml(synth.detail || '') + '</div>' +
      '</div>' +
      '<div class="analysis-meta" style="margin-top:var(--space-12);">' +
        escapeHtml(modelLabel) + ' · as of ' + escapeHtml(data.asOf || 'n/a') +
        (generated ? (' · generated ' + escapeHtml(generated) + ' UTC') : '') +
      '</div>';
  }

  async function runAnalysis(forceRefresh) {
    var btn = $('consumer-analysis-run');
    var status = $('consumer-analysis-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Analyzing…';
    try {
      var res = await fetch('/api/consumer-cycle/analysis' + (forceRefresh ? '?refresh=true' : ''));
      var payload = await res.json();
      if (!payload.success) throw new Error(payload.error || 'Analysis failed');
      renderAnalysis(payload.data);
      if (status) status.textContent = payload.data.model ? '' : 'AI unavailable — showing rule-based read';
    } catch (error) {
      if (status) status.textContent = (error && error.message) || 'Analysis failed';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderTable(data) {
    var body = $('consumer-table-body');
    var rows = data.rows || [];
    $('consumer-table-status').textContent = rows.length
      ? ('Showing ' + rows.length.toLocaleString() + ' of ' + Number(data.total || 0).toLocaleString() + ' matching symbols')
      : 'No matching symbols';
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="consumer-empty">No symbols matched this filter set.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (row) {
      return (
        '<tr>' +
          '<td><code>' + (row.symbol || '') + '</code></td>' +
          '<td>' + (row.name || '—') + '</td>' +
          '<td><span class="consumer-badge">' + titleCase(row.consumerCycleBucket || 'unknown') + '</span></td>' +
          '<td><span class="consumer-badge">' + titleCase(row.consumerSpendingCategory || 'unknown') + '</span></td>' +
          '<td><span class="consumer-badge">' + titleCase(row.consumerSpendClass || 'unknown') + '</span></td>' +
          '<td>' + titleCase(row.recessionProfile || 'unknown') + '</td>' +
          '<td>' + titleCase(row.macroRegimePreference || 'unknown') + '</td>' +
          '<td>' + (row.optionable ? 'Yes' : 'No') + '</td>' +
          '<td>' + titleCase(row.classificationSource || 'name_rule') +
            (row.classificationConfidence != null ? (' · ' + Math.round(Number(row.classificationConfidence) * 100) + '%') : '') +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function fillSelect(selectId, rows, currentValue) {
    var select = $(selectId);
    var current = currentValue || select.value || '';
    var options = ['<option value="">All</option>'];
    (rows || []).forEach(function (row) {
      options.push('<option value="' + row.key + '">' + titleCase(row.key) + ' (' + row.count + ')</option>');
    });
    select.innerHTML = options.join('');
    select.value = current;
  }

  function updateStatus(message) {
    $('consumer-filter-status').textContent = message;
  }

  function persistState() {
    if (!window.AppState || !window.AppState.save) return;
    var filters = getFilters();
    filters.q = '';
    window.AppState.save(filters);
  }

  function restoreState() {
    if (!window.AppState || !window.AppState.restore) return;
    var saved = window.AppState.restore();
    if (!saved) return;
    $('consumer-search').value = '';
    $('consumer-sensitivity').value = saved.cycleBucket || '';
    if ($('consumer-spend-class')) $('consumer-spend-class').value = saved.spendClass || '';
    $('consumer-bucket').value = saved.category || '';
    $('consumer-profile').value = saved.profile || '';
    $('consumer-preference').value = saved.preference || '';
    $('consumer-limit').value = saved.limit || '250';
    $('consumer-optionable').checked = String(saved.optionableOnly || '') === 'true';
  }

  function applyTaxonomyFilter(kind, value) {
    $('consumer-search').value = '';
    if (kind === 'cycle') {
      $('consumer-sensitivity').value = value || '';
      $('consumer-bucket').value = '';
      if ($('consumer-spend-class')) $('consumer-spend-class').value = '';
    } else if (kind === 'category') {
      $('consumer-bucket').value = value || '';
      $('consumer-sensitivity').value = '';
      if ($('consumer-spend-class')) $('consumer-spend-class').value = '';
    } else if (kind === 'spendClass') {
      if ($('consumer-spend-class')) $('consumer-spend-class').value = value || '';
      $('consumer-bucket').value = '';
      $('consumer-sensitivity').value = '';
    }
    refresh();
  }

  function clearFilters() {
    $('consumer-search').value = '';
    $('consumer-sensitivity').value = '';
    if ($('consumer-spend-class')) $('consumer-spend-class').value = '';
    $('consumer-bucket').value = '';
    $('consumer-profile').value = '';
    $('consumer-preference').value = '';
    $('consumer-optionable').checked = false;
    refresh();
  }

  async function refresh() {
    var filters = getFilters();
    persistState();
    updateStatus('Refreshing consumer-cycle map…');
    try {
      var summaryQuery = toQuery(filters);
      var symbolsQuery = toQuery(filters);
      var results = await Promise.all([
        fetch('/api/consumer-cycle/monitor'),
        fetch('/api/consumer-cycle/summary' + (summaryQuery ? ('?' + summaryQuery) : '')),
        fetch('/api/consumer-cycle/symbols' + (symbolsQuery ? ('?' + symbolsQuery) : ''))
      ]);
      var monitorPayload = await results[0].json();
      var summaryPayload = await results[1].json();
      var symbolsPayload = await results[2].json();
      if (!monitorPayload.success) throw new Error(monitorPayload.error || 'Failed to load monitor');
      if (!summaryPayload.success) throw new Error(summaryPayload.error || 'Failed to load summary');
      if (!symbolsPayload.success) throw new Error(symbolsPayload.error || 'Failed to load symbols');
      renderMonitor(monitorPayload.data);
      summaryState = summaryPayload.data;
      renderKpis(summaryPayload.data);
      renderSpendClassChips(summaryPayload.data);
      renderBucketChips(summaryPayload.data);
      fillSelect('consumer-sensitivity', summaryPayload.data.byCycleBucket, filters.cycleBucket);
      fillSelect('consumer-spend-class', summaryPayload.data.bySpendClass, filters.spendClass);
      fillSelect('consumer-bucket', summaryPayload.data.byCategory, filters.category);
      fillSelect('consumer-profile', summaryPayload.data.byProfile, filters.profile);
      fillSelect('consumer-preference', summaryPayload.data.byPreference, filters.preference);
      renderTable(symbolsPayload.data);
      updateStatus('Using tradable-stock default universe (' + Number(summaryPayload.data.totalTradableStocks || 0).toLocaleString() + ' symbols) with consumer-cycle classifications.');
    } catch (error) {
      updateStatus((error && error.message) || 'Failed to load consumer-cycle page.');
      $('consumer-monitor-status').textContent = (error && error.message) || 'Failed to load macro monitor.';
      $('consumer-monitor-status-pill').className = 'monitor-status red';
      $('consumer-monitor-status-pill').textContent = 'Offline';
      $('consumer-monitor-title').textContent = 'Cyclical-demand monitor unavailable';
      $('consumer-monitor-copy').textContent = 'The macro series could not be loaded right now.';
      $('consumer-monitor-meta').textContent = '';
      $('consumer-monitor-series').innerHTML = '<div class="consumer-empty">Failed to load macro series.</div>';
      if ($('consumer-statistical-deviation')) $('consumer-statistical-deviation').innerHTML = '<div class="consumer-empty">Failed to load statistical deviation model.</div>';
      if ($('consumer-spend-classes')) $('consumer-spend-classes').innerHTML = '<div class="consumer-empty">Failed to load spend classes.</div>';
      ['consumer-group-highly', 'consumer-group-mildly', 'consumer-group-stable'].forEach(function (id) {
        if ($(id)) $(id).innerHTML = '<div class="consumer-empty">Failed to load categories.</div>';
      });
      $('consumer-table-body').innerHTML = '<tr><td colspan="9" class="consumer-empty">Failed to load consumer-cycle data.</td></tr>';
    }
  }

  async function refreshStatisticalDeviation() {
    var button = $('consumer-stat-refresh');
    var status = $('consumer-stat-refresh-status');
    if (button) button.disabled = true;
    if (status) status.textContent = 'Refreshing market deviation...';
    try {
      var response = await fetch('/api/consumer-cycle/monitor?refresh=true');
      var payload = await response.json();
      if (!payload.success) throw new Error(payload.error || 'Failed to refresh statistical deviation');
      renderMonitor(payload.data);
      var deviation = payload.data && payload.data.statisticalDeviation;
      if (status) status.textContent = deviation && deviation.asOf ? ('Updated ' + deviation.asOf) : 'Updated';
    } catch (error) {
      if (status) status.textContent = (error && error.message) || 'Refresh failed';
    } finally {
      if (button) button.disabled = false;
    }
  }

  function wire() {
    [
      'consumer-spend-class',
      'consumer-bucket',
      'consumer-sensitivity',
      'consumer-profile',
      'consumer-preference',
      'consumer-limit',
      'consumer-optionable'
    ].forEach(function (id) {
      $(id).addEventListener('change', refresh);
    });
    $('consumer-search').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') refresh();
    });
    $('consumer-refresh').addEventListener('click', refresh);
    if ($('consumer-stat-refresh')) {
      $('consumer-stat-refresh').addEventListener('click', refreshStatisticalDeviation);
    }
    if ($('consumer-clear-filters')) {
      $('consumer-clear-filters').addEventListener('click', clearFilters);
    }
    document.addEventListener('click', function (event) {
      var chartRow = event.target && event.target.closest ? event.target.closest('[data-chart-symbol]') : null;
      if (chartRow) {
        openTradingDeskSymbol(chartRow.getAttribute('data-chart-symbol'), '1d');
        return;
      }
      var target = event.target && event.target.closest ? event.target.closest('[data-category-filter], [data-spend-class-filter], [data-cycle-filter]') : null;
      if (!target) return;
      if (target.hasAttribute('data-category-filter')) applyTaxonomyFilter('category', target.getAttribute('data-category-filter') || '');
      if (target.hasAttribute('data-spend-class-filter')) applyTaxonomyFilter('spendClass', target.getAttribute('data-spend-class-filter') || '');
      if (target.hasAttribute('data-cycle-filter')) applyTaxonomyFilter('cycle', target.getAttribute('data-cycle-filter') || '');
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var chartRow = event.target && event.target.closest ? event.target.closest('[data-chart-symbol]') : null;
      if (chartRow) {
        event.preventDefault();
        openTradingDeskSymbol(chartRow.getAttribute('data-chart-symbol'), '1d');
        return;
      }
      var target = event.target && event.target.closest ? event.target.closest('[data-cycle-filter]') : null;
      if (!target) return;
      event.preventDefault();
      applyTaxonomyFilter('cycle', target.getAttribute('data-cycle-filter') || '');
    });
    var analysisBtn = $('consumer-analysis-run');
    if (analysisBtn) {
      analysisBtn.addEventListener('click', function () { runAnalysis(false); });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    restoreState();
    wire();
    refresh();
  });
})();
